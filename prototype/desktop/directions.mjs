import { defaultDirectionSelection } from "./papers-data.mjs"
import { openWorkbenchStorage } from "./workbench-storage.mjs"
import { directionToConditions, encodeDirectionAxes } from "./discovery-query-plan.mjs"
import {
  createDirectionSaveController,
  createDirectionSnapshotStore,
  wireDirectionSaveButtons,
} from "./direction-snapshot.mjs"

export function initializeDirections({ document, window, storage: providedStorage = null }) {
  const selected = {}
  const filters = document.querySelector("#direction-filters")
  const form = document.querySelector("#direction-search-form")
  const queryInput = document.querySelector("#paper-search")
  const axesInput = document.createElement("input")
  axesInput.type = "hidden"
  axesInput.name = "axes"
  axesInput.disabled = true
  form?.append(axesInput)
  let appliedQuery = null
  const startYear = document.querySelector("#search-start-year")
  const endYear = document.querySelector("#search-end-year")
  const language = document.querySelector("#search-language")
  const toast = document.querySelector("#toast")
  let toastTimeout = null
  let storage = providedStorage
  if (!storage) try { storage = window.localStorage } catch {}
  const directionStore = createDirectionSnapshotStore(storage)
  const selectionValues = () => Object.values(selected).flat()

  function showToast(message) {
    if (!toast) return
    toast.textContent = message
    toast.classList.add("toast--visible")
    window.clearTimeout(toastTimeout)
    toastTimeout = window.setTimeout(() => toast.classList.remove("toast--visible"), 2200)
  }

  function renderSavedDirection(snapshot) {
    const state = document.querySelector("#direction-save-state")
    const axes = document.querySelector("#direction-save-axes")
    if (state) {
      const date = snapshot ? new Date(snapshot.saved_at) : null
      state.textContent = snapshot
        ? "已显式保存 · " + new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
        : "尚未显式保存研究方向"
    }
    if (!axes) return
    axes.replaceChildren()
    const values = snapshot ? Object.values(snapshot.axes).flat() : []
    for (const value of values.length ? values : ["选择条件后点击“保存研究方向”固定当前输入"]) {
      const tag = document.createElement("span")
      tag.textContent = value
      axes.append(tag)
    }
  }

  function render() {
    const values = selectionValues()
    const count = document.querySelector("#selected-count")
    if (count) count.textContent = directionToConditions(selected).conditions.length + " 个条件"
    const localLink = document.querySelector("#search-local-library")
    const localQuery = queryInput?.value.trim() ?? ""
    if (localLink) localLink.href = "../../local_library_output/desktop/library.html"
      + (localQuery ? "?q=" + encodeURIComponent(localQuery) : "")

    const advancedLink = document.querySelector("#search-new-paper")
    if (advancedLink) {
      const params = new URLSearchParams({ q: values.join(" "), search: "1" })
      params.set("axes", encodeDirectionAxes(selected))
      if (startYear?.value) params.set("startYear", startYear.value)
      if (endYear?.value) params.set("endYear", endYear.value)
      params.set("language", language?.value || "all")
      advancedLink.href = "../../local_library_output/desktop/discovery.html?" + params
      advancedLink.setAttribute("aria-disabled", String(values.length === 0))
    }
    const apply = document.querySelector("#use-direction-in-search")
    if (apply) apply.disabled = values.length === 0
  }

  function setSelection(nextSelection) {
    for (const axis of Object.keys(selected)) delete selected[axis]
    for (const [axis, values] of Object.entries(nextSelection)) {
      if (values.length) selected[axis] = [...values]
    }
    filters?.querySelectorAll(".filter-group").forEach((group) => {
      group.querySelectorAll(".filter-chip").forEach((chip) => {
        const active = selected[group.dataset.axis]?.includes(chip.dataset.value) ?? false
        chip.classList.toggle("filter-chip--selected", active)
        chip.setAttribute("aria-pressed", String(active))
      })
    })
    render()
  }

  filters?.addEventListener("click", (event) => {
    const chip = event.target.closest(".filter-chip")
    const axis = chip?.closest(".filter-group")?.dataset.axis
    const value = chip?.dataset.value
    if (!axis || !value) return
    const values = selected[axis] ?? []
    setSelection({ ...selected, [axis]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] })
  })
  document.querySelector("#reset-direction")?.addEventListener("click", () => setSelection(defaultDirectionSelection))
  document.querySelector("#clear-direction")?.addEventListener("click", () => setSelection({}))
  document.querySelector("#use-direction-in-search")?.addEventListener("click", () => {
    if (!queryInput || selectionValues().length === 0) return
    queryInput.value = selectionValues().join(" ")
    appliedQuery = queryInput.value
    axesInput.value = encodeDirectionAxes(selected)
    axesInput.disabled = false
    queryInput.setCustomValidity("")
    render()
    queryInput.focus()
    showToast("已将研究条件填入关键词，可继续修改后搜索。")
  })
  document.querySelector("#search-new-paper")?.addEventListener("click", (event) => {
    if (selectionValues().length > 0) return
    event.preventDefault()
    showToast("请先选择研究条件，或在上方输入关键词搜索。")
  })

  for (const control of [queryInput, startYear, endYear, language]) {
    control?.addEventListener("input", () => {
      if (control === queryInput) {
        appliedQuery = null
        axesInput.value = ""
        axesInput.disabled = true
      }
      queryInput?.setCustomValidity("")
      endYear?.setCustomValidity("")
      render()
    })
    control?.addEventListener("change", render)
  }
  form?.addEventListener("submit", (event) => {
    if (!queryInput) return
    queryInput.value = queryInput.value.trim()
    if (queryInput.value !== appliedQuery) {
      axesInput.value = ""
      axesInput.disabled = true
    }
    queryInput.setCustomValidity(queryInput.value ? "" : "请输入搜索关键词。")
    const reversedYears = startYear?.value && endYear?.value && Number(startYear.value) > Number(endYear.value)
    endYear?.setCustomValidity(reversedYears ? "结束年份不能早于开始年份。" : "")
    if (!queryInput.value || reversedYears) {
      event.preventDefault()
      ;(queryInput.value ? endYear : queryInput)?.reportValidity()
    }
    render()
  })
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
    event.preventDefault()
    document.querySelector("#paper-search")?.focus()
  })

  const saveController = createDirectionSaveController({
    store: directionStore,
    getSelection: () => selected,
    renderSaved: renderSavedDirection,
    notify: showToast,
  })
  wireDirectionSaveButtons([
    document.querySelector("#save-candidate"),
    document.querySelector("#save-candidate-side"),
  ], saveController.save)
  const saved = saveController.initialize()
  setSelection(saved?.axes ?? defaultDirectionSelection)
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeDirections({ document, window, storage: openWorkbenchStorage({ windowRef: window }) })
}
