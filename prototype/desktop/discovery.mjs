import { createCandidateStore } from "./candidate-storage.mjs"
import { resolveInstitutionAccess } from "./institution-access.mjs"
import { searchOpenAlexWorks } from "./openalex-search.mjs"

const KEYWORDS = Object.freeze([
  ["时变非平衡有向网络", "time-varying unbalanced directed graph"],
  ["时变有向网络", "time-varying directed graph"],
  ["分布式在线约束优化", "distributed online constrained optimization"],
  ["分布式约束优化", "distributed constrained optimization"],
  ["低通信", "communication-efficient"],
  ["事件触发", "event-triggered"],
  ["耦合约束", "coupled constraints"],
  ["隐私", "privacy-preserving"],
  ["零阶", "zeroth-order"],
  ["联邦学习", "federated learning"],
])

function text(value) { return typeof value === "string" ? value.trim() : "" }

export function buildKeywordSearchExpression(value) {
  const source = text(value)
  if (!source) throw new Error("请输入研究方向或关键词")
  if (!/[\u3400-\u9fff]/u.test(source)) return source
  let remainder = source.replace(/[的中在上与和及、，,。；;（）()\s]/gu, "")
  const terms = []
  for (const [chinese, english] of KEYWORDS) {
    if (!remainder.includes(chinese)) continue
    remainder = remainder.replace(chinese, "")
    terms.push(`"${english}"`)
  }
  if (remainder || terms.length === 0) throw new Error("不能可靠转换全部中文关键词；请改用英文检索式")
  return `(${terms.join(" AND ")})`
}

function node(root, selector) { return root?.querySelector?.(selector) ?? null }
function nodes(root, selector) { return [...(root?.querySelectorAll?.(selector) ?? [])] }
function setText(root, selector, value) { const element = node(root, selector); if (element) element.textContent = value }
function setHref(element, value) { if (!element) return; if (typeof value === "string" && value.startsWith("https://")) element.href = value; else element.removeAttribute?.("href") }
function setHidden(element, hidden) { if (element) element.hidden = hidden }
function normalizeSearchSort(value) {
  return ({ relevance: "relevance", citations: "citations", newest: "newest", cited_by_count: "citations", publication_date: "newest" })[value] ?? "relevance"
}

function workCard(root, work, addCandidate) {
  const article = root.createElement("article")
  article.className = "discovery-result-card"
  article.dataset.paperId = work.paperId
  const title = root.createElement("h3")
  title.textContent = work.title
  const meta = root.createElement("p")
  meta.textContent = [work.year ?? "年份未报告", work.source, `被引 ${work.citations}`].join(" · ")
  const actions = root.createElement("div")
  const open = root.createElement("a")
  open.textContent = "打开公开落地页 ↗"
  open.href = work.landingPageUrl
  open.target = "_blank"
  open.rel = "noopener noreferrer"
  const add = root.createElement("button")
  add.type = "button"
  add.dataset.addCandidate = work.paperId
  add.textContent = "加入候选"
  add.addEventListener("click", () => addCandidate(work))
  actions.appendChild(open); actions.appendChild(add)
  article.appendChild(title); article.appendChild(meta); article.appendChild(actions)
  return article
}

function candidateCard(root, candidate, actions) {
  const article = root.createElement("article")
  article.dataset.queuePaper = candidate.paperId
  article.className = "candidate-queue-card"
  const title = root.createElement("h3"); title.textContent = candidate.title
  const stage = root.createElement("p"); stage.textContent = candidate.stage === "confirmed_for_archive" ? "元数据待核验 · 待归档" : "待筛选"
  article.appendChild(title); article.appendChild(stage)
  const buttons = root.createElement("div")
  if (candidate.stage === "pending_screening") {
    const confirm = root.createElement("button"); confirm.type = "button"; confirm.textContent = "确认待归档"; confirm.addEventListener("click", () => actions.confirm(candidate.paperId)); buttons.appendChild(confirm)
  } else {
    const back = root.createElement("button"); back.type = "button"; back.textContent = "移回待筛选"; back.addEventListener("click", () => actions.moveToPending(candidate.paperId)); buttons.appendChild(back)
  }
  const remove = root.createElement("button"); remove.type = "button"; remove.textContent = "移除"; remove.addEventListener("click", () => actions.remove(candidate.paperId)); buttons.appendChild(remove)
  article.appendChild(buttons)
  return article
}

export function createKeywordDiscoveryController({ root, prepareAccess = () => {}, searchWorks = searchOpenAlexWorks, candidateStore } = {}) {
  if (!root || !candidateStore) throw new TypeError("关键词发现控制器缺少必要依赖")
  let works = []
  const renderQueue = () => {
    const state = candidateStore.read()
    const candidates = state.candidates
    const pending = candidates.filter((candidate) => candidate.stage === "pending_screening").length
    const confirmed = candidates.filter((candidate) => candidate.stage === "confirmed_for_archive").length
    setText(root, "[data-candidate-count]", String(candidates.length)); setText(root, "[data-candidate-pending-count]", String(pending)); setText(root, "[data-candidate-confirmed-count]", String(confirmed))
    const list = node(root, "#candidate-queue-list"); const empty = node(root, "[data-candidate-empty]")
    if (!list) return
    if (empty) empty.hidden = candidates.length > 0
    const cards = candidates.map((candidate) => candidateCard(root, candidate, { confirm(id) { candidateStore.confirm(id); renderQueue() }, moveToPending(id) { candidateStore.moveToPending(id); renderQueue() }, remove(id) { candidateStore.remove(id); renderQueue() } }))
    list.replaceChildren(...(cards.length ? cards : empty ? [empty] : []))
  }
  const activate = (mode) => {
    const keyword = mode === "keyword"
    setHidden(node(root, "#keyword-discovery-panel"), !keyword)
    setHidden(node(root, "#known-paper-panel"), keyword)
    setHidden(node(root, "#candidate-queue-panel"), !keyword)
    setHidden(node(root, "#access-guide-panel"), keyword)
    for (const tab of nodes(root, "[data-discovery-mode]")) { const selected = tab.dataset.discoveryMode === mode; tab.setAttribute("aria-selected", String(selected)); tab.setAttribute("tabindex", selected ? "0" : "-1") }
  }
  const runSearch = async () => {
    const query = text(node(root, "#english-query")?.value)
    if (!query) { setText(root, "#keyword-search-status", "请先生成或填写英文检索式。"); return }
    const button = node(root, "#keyword-live-search"); if (button) button.disabled = true
    try {
      const result = await searchWorks({ query, sort: normalizeSearchSort(node(root, "#keyword-sort")?.value) })
      works = result.works
      const list = node(root, "#keyword-live-results-list")
      list?.replaceChildren(...works.map((work) => workCard(root, work, (item) => { candidateStore.add(item); renderQueue() })))
      setText(root, "[data-live-result-count]", `${works.length} 条真实结果`)
      setText(root, "#keyword-search-status", `OpenAlex 共匹配 ${result.total} 条；当前显示 ${works.length} 条。`)
      node(root, "#keyword-search-results")?.focus?.()
    } catch (error) { setText(root, "#keyword-search-status", error?.message || "OpenAlex 检索失败") } finally { if (button) button.disabled = false }
  }
  return {
    start() {
      const tabs = nodes(root, "[data-discovery-mode]")
      const selectTab = (tab) => { activate(tab.dataset.discoveryMode); tab.focus?.() }
      for (const [index, tab] of tabs.entries()) {
        tab.addEventListener("click", () => activate(tab.dataset.discoveryMode))
        tab.addEventListener("keydown", (event) => {
          let nextIndex = null
          if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length
          else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length
          else if (event.key === "Home") nextIndex = 0
          else if (event.key === "End") nextIndex = tabs.length - 1
          if (nextIndex === null) return
          event.preventDefault()
          selectTab(tabs[nextIndex])
        })
      }
      node(root, "#keyword-search-form")?.addEventListener("submit", (event) => { event.preventDefault(); try { const expression = buildKeywordSearchExpression(node(root, "#keyword-query")?.value); const input = node(root, "#english-query"); if (input) input.value = expression; setText(root, "#keyword-search-status", "已生成英文检索式；确认后搜索 OpenAlex。"); node(root, "#keyword-search-results")?.focus?.() } catch (error) { setText(root, "#keyword-search-status", error.message) } })
      node(root, "#keyword-live-search")?.addEventListener("click", runSearch)
      renderQueue(); activate("keyword")
    },
    prepareAccess(locator) { prepareAccess(locator) },
    getWorks() { return [...works] },
  }
}

export async function loadInstitutionProfile(fetchImpl = fetch) {
  const response = await fetchImpl("./assets/nuist.institution.json", { credentials: "same-origin", cache: "no-store" })
  if (!response?.ok) throw new Error("学校访问配置不可用")
  const profile = await response.json()
  if (
    !profile || profile.version !== 1 || profile.institution_id !== "nuist" ||
    typeof profile.display_name !== "string" || profile.access_mode !== "carsi" ||
    !Array.isArray(profile.providers) || profile.providers.length === 0 ||
    profile.providers.some((provider) => !provider || typeof provider.provider_id !== "string" || typeof provider.display_name !== "string")
  ) throw new Error("学校访问配置无效")
  return profile
}

export function createDiscoveryController({ root, loadInstitution = loadInstitutionProfile, clipboard = globalThis.navigator?.clipboard } = {}) {
  const store = createCandidateStore(globalThis.localStorage)
  const keyword = createKeywordDiscoveryController({ root, candidateStore: store, prepareAccess(locator) { const input = node(root, "#access-locator"); if (input) { input.value = locator; input.focus() } } })
  let profile = null
  let accessResult = null
  const renderAccess = () => {
    const result = accessResult; if (!result) return
    setHidden(node(root, "#access-result"), false)
    setText(root, "[data-provider-name]", result.provider?.display_name ?? "平台尚未识别")
    const access = result.institutionAccess
    setHref(node(root, "#institution-step-open"), result.openAccess.url ?? access.articleUrl)
    setHref(node(root, "#institution-step-auth"), access.authenticationUrl)
    setHref(node(root, "#institution-step-library"), access.libraryLookupUrl)
    const copy = node(root, "#access-copy-target"); if (copy) copy.value = result.copyTarget.value
    const warnings = node(root, "#access-warnings"); if (warnings) warnings.replaceChildren(...result.warnings.map((warning) => { const item = root.createElement("li"); item.textContent = warning; return item }))
  }
  return {
    async start() {
      keyword.start()
      try {
        profile = await loadInstitution()
        const select = node(root, "#access-provider")
        for (const provider of profile.providers) { const option = root.createElement("option"); option.value = provider.provider_id; option.textContent = provider.display_name; select?.append(option) }
      } catch { setText(root, "#access-status", "学校访问配置暂不可用；仍可使用公开 DOI 或落地页人工核验。") }
      node(root, "#institution-access-form")?.addEventListener("submit", (event) => { event.preventDefault(); if (!profile) { setText(root, "#access-status", "学校访问配置暂不可用。") ; return } try { accessResult = resolveInstitutionAccess({ rawInput: node(root, "#access-locator")?.value, explicitProviderId: node(root, "#access-provider")?.value, institution: profile }); renderAccess(); setText(root, "#access-status", "已生成不携带凭据的人工访问步骤。") } catch (error) { setText(root, "#access-status", error.message) } })
      node(root, "#access-copy")?.addEventListener("click", async () => { try { if (!accessResult || typeof clipboard?.writeText !== "function") throw new Error("clipboard") ; await clipboard.writeText(accessResult.copyTarget.value); setText(root, "#access-copy-status", "已复制") } catch { setText(root, "#access-copy-status", "复制失败，请手动选择上方 DOI/题名") } })
    },
    prepareLocator(locator) { keyword.prepareAccess(locator) },
  }
}

if (typeof document !== "undefined") createDiscoveryController({ root: document }).start()
