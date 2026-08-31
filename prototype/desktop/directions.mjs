import { countByReadingState, filterPapers, rankPapers } from "./paper-filter.mjs"
import { contributionLabel, defaultDirectionSelection, papers, stateLabel } from "./papers-data.mjs"

const selected = {}
let activeState = "all"
let searchTerm = ""

const filters = document.querySelector("#direction-filters")
const paperList = document.querySelector("#paper-list")
const sortSelect = document.querySelector("#paper-sort")
const dialog = document.querySelector("#search-dialog")
const toast = document.querySelector("#toast")

function valuesForSelection() {
  return Object.values(selected).flat()
}

function setSelection(nextSelection) {
  Object.keys(selected).forEach((axis) => delete selected[axis])
  Object.entries(nextSelection).forEach(([axis, values]) => {
    if (values.length > 0) selected[axis] = [...values]
  })

  filters?.querySelectorAll(".filter-group").forEach((group) => {
    const axis = group.dataset.axis
    group.querySelectorAll(".filter-chip").forEach((chip) => {
      const isSelected = selected[axis]?.includes(chip.dataset.value) ?? false
      chip.classList.toggle("filter-chip--selected", isSelected)
      chip.setAttribute("aria-pressed", String(isSelected))
    })
  })

  render()
}

function showToast(message) {
  if (!toast) return
  toast.textContent = message
  toast.classList.add("toast--visible")
  window.clearTimeout(showToast.timeout)
  showToast.timeout = window.setTimeout(() => toast.classList.remove("toast--visible"), 2200)
}

function activePapers() {
  const matched = filterPapers(papers, selected)
  const byState = activeState === "all"
    ? matched
    : matched.filter((paper) => paper.readingState === activeState)
  const bySearch = searchTerm
    ? byState.filter((paper) => `${paper.id} ${paper.title} ${paper.venue} ${paper.note}`.toLowerCase().includes(searchTerm))
    : byState
  return rankPapers(bySearch, sortSelect?.value ?? "relevance")
}

function createPaperRow(paper) {
  const article = document.createElement("article")
  article.className = "paper-row"

  const state = document.createElement("span")
  state.className = `paper-state paper-state--${paper.readingState}`
  state.textContent = stateLabel[paper.readingState] ?? paper.readingState

  const main = document.createElement("div")
  main.className = "paper-main"
  const meta = document.createElement("div")
  meta.className = "paper-title-row"
  meta.textContent = `${paper.year} · ${paper.venue} · ${paper.id}`
  const title = document.createElement("h3")
  title.textContent = paper.title
  const note = document.createElement("p")
  note.textContent = paper.note
  main.append(meta, title, note)

  const contribution = document.createElement("div")
  contribution.className = "paper-contribution"
  const badge = document.createElement("span")
  badge.className = `contribution contribution--${paper.contribution}`
  badge.textContent = contributionLabel[paper.contribution] ?? paper.contribution
  const simulation = document.createElement("small")
  simulation.textContent = paper.simulation
  contribution.append(badge, simulation)

  const action = document.createElement("button")
  action.className = "paper-action"
  action.type = "button"
  action.setAttribute("aria-label", `打开《${paper.title}》的结构化阅读`)
  action.textContent = "→"
  action.addEventListener("click", () => showToast(`已定位《${paper.title}》的阅读入口`))

  article.append(state, main, contribution, action)
  return article
}

function renderPapers() {
  if (!paperList) return
  paperList.replaceChildren()
  const visiblePapers = activePapers()

  if (visiblePapers.length === 0) {
    const empty = document.createElement("div")
    empty.className = "empty-state"
    const title = document.createElement("strong")
    title.textContent = searchTerm ? "没有符合搜索词的论文" : "当前状态下没有匹配论文"
    const hint = document.createElement("span")
    hint.textContent = "可减少组合条件、切换阅读状态，或搜索新论文补齐证据。"
    empty.append(title, hint)
    paperList.append(empty)
    return
  }

  visiblePapers.forEach((paper) => paperList.append(createPaperRow(paper)))
}

function renderTabs(matched) {
  const counts = countByReadingState(matched)
  const allCounts = { all: matched.length, ...counts }

  document.querySelectorAll("[data-count]").forEach((element) => {
    element.textContent = allCounts[element.dataset.count] ?? 0
  })

  document.querySelectorAll(".state-tab").forEach((tab) => {
    const isActive = tab.dataset.state === activeState
    tab.classList.toggle("state-tab--active", isActive)
    tab.setAttribute("aria-selected", String(isActive))
    tab.tabIndex = isActive ? 0 : -1
    if (isActive) paperList?.setAttribute("aria-labelledby", tab.id)
  })
}

function activateStateTab(tab, { focus = false } = {}) {
  if (!tab?.dataset.state) return
  activeState = tab.dataset.state
  render()
  if (focus) tab.focus()
}

function renderInspector(matched) {
  const selection = valuesForSelection()
  const counts = countByReadingState(matched)
  const tags = document.querySelector("#combination-tags")
  const metricMatches = document.querySelector("#metric-matches")
  const metricCompleted = document.querySelector("#metric-completed")
  const metricReading = document.querySelector("#metric-reading")
  const combinationStatus = document.querySelector("#combination-status")
  const axisCount = document.querySelector("#axis-count")
  const combinationName = document.querySelector("#combination-name")
  const explanation = document.querySelector("#combination-explanation")
  const gapList = document.querySelector("#gap-list")

  tags?.replaceChildren(...selection.map((value) => {
    const tag = document.createElement("span")
    tag.textContent = value
    return tag
  }))
  if (tags && selection.length === 0) {
    const tag = document.createElement("span")
    tag.textContent = "尚未选择条件"
    tags.append(tag)
  }

  if (metricMatches) metricMatches.textContent = matched.length
  if (metricCompleted) metricCompleted.textContent = counts.completed
  if (metricReading) metricReading.textContent = counts.reading
  if (combinationStatus) combinationStatus.textContent = `直接匹配 ${matched.length}`
  if (axisCount) axisCount.textContent = `${Object.keys(selected).length} 个维度`

  if (combinationName) {
    combinationName.textContent = selection.length === 0
      ? "全部研究方向"
      : selection.slice(0, 4).join(" · ")
  }
  if (explanation) {
    explanation.textContent = selection.length === 0
      ? "未限定研究维度，当前显示论文库中的全部演示文献。"
      : `当前以 ${selection.length} 个条件交叉筛选，重点检查这些条件是否已被同一篇工作同时覆盖。`
  }

  if (gapList) {
    const coverage = matched.length === 0
      ? ["暂无直接覆盖", "当前论文库中没有工作同时满足全部条件，需扩大检索范围。"]
      : matched.length === 1
        ? ["组合覆盖仍然稀疏", "目前只有 1 篇论文同时满足所选条件，尚不足以确认稳定贡献边界。"]
        : ["已有直接覆盖", `已有 ${matched.length} 篇论文满足组合，需要从机制或理论保证上进一步缩小差异。`]
    gapList.querySelector("strong").textContent = coverage[0]
    gapList.querySelector("small").textContent = coverage[1]
  }
}

function render() {
  const matched = filterPapers(papers, selected)
  const selectionCount = valuesForSelection().length
  const selectedCount = document.querySelector("#selected-count")
  const resultsSummary = document.querySelector("#results-summary")

  if (selectedCount) selectedCount.textContent = `${selectionCount} 个条件`
  if (resultsSummary) {
    resultsSummary.textContent = `当前组合找到 ${matched.length} 篇直接匹配论文；列表显示 ${activePapers().length} 篇。`
  }

  renderTabs(matched)
  renderPapers()
  renderInspector(matched)
}

filters?.addEventListener("click", (event) => {
  const chip = event.target.closest(".filter-chip")
  if (!chip) return
  const axis = chip.closest(".filter-group")?.dataset.axis
  const value = chip.dataset.value
  if (!axis || !value) return

  const axisValues = selected[axis] ?? []
  selected[axis] = axisValues.includes(value)
    ? axisValues.filter((item) => item !== value)
    : [...axisValues, value]
  if (selected[axis].length === 0) delete selected[axis]

  chip.classList.toggle("filter-chip--selected")
  chip.setAttribute("aria-pressed", String(chip.classList.contains("filter-chip--selected")))
  activeState = "all"
  render()
})

document.querySelector("#reset-direction")?.addEventListener("click", () => {
  activeState = "all"
  searchTerm = ""
  const search = document.querySelector("#paper-search")
  if (search) search.value = ""
  setSelection(defaultDirectionSelection)
})

document.querySelector("#clear-direction")?.addEventListener("click", () => {
  activeState = "all"
  setSelection({})
})

document.querySelectorAll(".state-tab").forEach((tab) => {
  tab.addEventListener("click", () => activateStateTab(tab))
})

document.querySelector(".state-tabs")?.addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll(".state-tab")]
  const currentIndex = tabs.indexOf(document.activeElement)
  if (currentIndex === -1) return

  const keyTargets = {
    ArrowLeft: (currentIndex - 1 + tabs.length) % tabs.length,
    ArrowRight: (currentIndex + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  }
  const targetIndex = keyTargets[event.key]
  if (targetIndex === undefined) return

  event.preventDefault()
  activateStateTab(tabs[targetIndex], { focus: true })
})

sortSelect?.addEventListener("change", render)

document.querySelector("#paper-search")?.addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase()
  render()
})

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
  event.preventDefault()
  if (!dialog?.open) document.querySelector("#paper-search")?.focus()
})

document.querySelector("#search-new-paper")?.addEventListener("click", () => {
  const topic = document.querySelector("#search-topic")
  if (topic && valuesForSelection().length > 0) topic.value = valuesForSelection().join(" ")
  dialog?.showModal()
})

document.querySelector("#save-search")?.addEventListener("click", () => {
  showToast("检索任务已保存，等待接入学术搜索")
})

function saveCandidate() {
  const count = valuesForSelection().length
  showToast(count === 0 ? "请先选择研究条件" : `已保存包含 ${count} 个条件的课题候选`)
}

document.querySelector("#save-candidate")?.addEventListener("click", saveCandidate)
document.querySelector("#save-candidate-side")?.addEventListener("click", saveCandidate)

setSelection(defaultDirectionSelection)

requestAnimationFrame(() => {
  if (!location.hash) return
  document.querySelector(location.hash)?.scrollIntoView({ behavior: "auto", block: "start" })
})
