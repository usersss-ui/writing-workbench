import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const html = await readFile(new URL("./library.template.html", import.meta.url), "utf8")
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8")
const librarySource = await readFile(new URL("./library.mjs", import.meta.url), "utf8")
const inspectorSource = await readFile(new URL("./paper-inspector.mjs", import.meta.url), "utf8")
const existingPages = await Promise.all(
  ["index.html", "directions.html", "p02.html"].map(async (name) => [
    name,
    await readFile(new URL(`./${name}`, import.meta.url), "utf8"),
  ]),
)

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

const forwardSeparator = String.fromCharCode(47)
const reverseSeparator = String.fromCharCode(92)

function rootedValue(...segments) {
  return ["", ...segments].join(forwardSeparator)
}

function driveValue(...segments) {
  return ["C:", ...segments].join(reverseSeparator)
}

function networkValue(...segments) {
  return `${reverseSeparator.repeat(2)}${segments.join(reverseSeparator)}`
}

function localProtocolValue(...segments) {
  const scheme = ["fi", "le"].join("")
  return `${scheme}:${forwardSeparator.repeat(3)}${segments.join(forwardSeparator)}`
}

function webValue(suffix = "") {
  return `https://example.org${suffix}`
}

function queryValue(name, value, { fragment = false } = {}) {
  return webValue(`${forwardSeparator}${fragment ? "#" : "?"}${name}=${value}`)
}

function camelDataName(name) {
  return name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
}

class MemoryNode {
  constructor(tagName = "") {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.dataset = {}
    this.attributes = new Map()
    this.className = ""
    this.hidden = false
    this.parentNode = null
    this.ownerDocument = null
    this.ownText = ""
    this.listeners = new Map()
    this.checked = false
    this.disabled = false
    this.value = ""
    this.files = []
    this.open = false
    this.isConnected = true
    this.tabIndex = 0
    this.classList = {
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/u).filter(Boolean))
        if (enabled) names.add(name)
        else names.delete(name)
        this.className = [...names].join(" ")
      },
      add: (...added) => {
        const names = new Set(this.className.split(/\s+/u).filter(Boolean))
        for (const name of added) names.add(name)
        this.className = [...names].join(" ")
      },
      remove: (...removed) => {
        const names = new Set(this.className.split(/\s+/u).filter(Boolean))
        for (const name of removed) names.delete(name)
        this.className = [...names].join(" ")
      },
    }
  }

  set textContent(value) {
    this.ownText = String(value)
    this.children = []
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("")
  }

  append(...nodes) {
    for (const node of nodes) {
      const children = node instanceof MemoryFragment ? [...node.children] : [node]
      for (const child of children) {
        child.parentNode = this
        child.ownerDocument ??= this.ownerDocument
        this.children.push(child)
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = []
    this.ownText = ""
    this.append(...nodes)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type, init = {}) {
    const event = {
      target: init.target ?? this,
      key: init.key ?? "",
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      defaultPrevented: false,
      preventDefaultCount: 0,
      preventDefault() {
        this.defaultPrevented = true
        this.preventDefaultCount += 1
      },
    }
    for (let node = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(type) ?? []) listener(event)
    }
    if (type === "cancel" && this.tagName === "DIALOG" && this.open && !event.defaultPrevented) this.close()
    return event
  }

  click() {
    if (this.disabled) return
    this.dispatch("click")
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node
    return null
  }

  contains(candidate) {
    for (let node = candidate; node; node = node.parentNode) if (node === this) return true
    return false
  }

  showModal() {
    this.open = true
  }

  close() {
    if (!this.open) return
    this.open = false
    this.dispatch("close")
  }

  reset() {
    for (const input of this.querySelectorAll("input")) input.checked = false
  }

  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()))
    if (selector === "input") return this.tagName === "INPUT"
    if (selector === "input:not(:disabled)") return this.tagName === "INPUT" && !this.disabled
    if (selector.startsWith(".")) return this.className.split(/\s+/u).includes(selector.slice(1))
    if (selector.startsWith("#")) return this.getAttribute("id") === selector.slice(1)
    const compoundMatch = /^([a-z][a-z0-9-]*)?(\[[^\]]+\])?$/iu.exec(selector)
    if (!compoundMatch) return false
    if (compoundMatch[1] && this.tagName !== compoundMatch[1].toUpperCase()) return false
    if (!compoundMatch[2]) return Boolean(compoundMatch[1])
    const attributeMatch = /^\[([a-z][a-z0-9-]*)(?:="([^"]+)")?\]$/iu.exec(compoundMatch[2])
    if (!attributeMatch) return false
    const [, name, expected] = attributeMatch
    const actual = name.startsWith("data-")
      ? this.dataset[camelDataName(name.slice(5))]
      : this.getAttribute(name)
    return actual !== undefined && actual !== null && (expected === undefined || actual === expected)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const matches = []
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child)
      matches.push(...child.querySelectorAll(selector))
    }
    return matches
  }
}

class MemoryFragment extends MemoryNode {}

function createPaperRowInstance() {
  const fragment = new MemoryFragment()
  const row = new MemoryNode("article")
  row.className = "library-paper-row"
  row.dataset.hitFields = ""
  const selectButton = new MemoryNode("button")
  selectButton.dataset.action = "select-paper"
  const readingMarker = new MemoryNode("span")
  readingMarker.dataset.field = "reading-marker"
  selectButton.append(readingMarker)
  const main = new MemoryNode("div")
  main.className = "library-row-main"
  const detailButton = new MemoryNode("button")
  detailButton.dataset.action = "open-detail"
  const title = new MemoryNode("strong")
  title.dataset.field = "title"
  detailButton.append(title)
  main.append(detailButton)
  for (const field of [
    "paper-id", "year", "authors", "identity-status", "source-directory", "relative-path", "search-hits",
  ]) {
    const node = new MemoryNode("span")
    node.dataset.field = field
    main.append(node)
  }
  const availability = new MemoryNode("span")
  availability.dataset.field = "availability"
  row.append(selectButton, main, availability)
  fragment.append(row)
  return fragment
}

class MemoryTemplateElement extends MemoryNode {
  constructor() {
    super("template")
    this.content = { cloneNode: () => createPaperRowInstance() }
  }
}

function createRenderDocument() {
  const results = new MemoryNode("div")
  const template = new MemoryTemplateElement()
  const document = {
    defaultView: { HTMLTemplateElement: MemoryTemplateElement },
    getElementById: (id) => id === "library-results" ? results : id === "library-paper-row-template" ? template : null,
    createDocumentFragment: () => new MemoryFragment(),
    createElement: (tagName) => new MemoryNode(tagName),
  }
  return { document, results }
}

function createControllerDocument() {
  const form = new MemoryNode("form")
  const search = new MemoryNode("input")
  const reset = new MemoryNode("button")
  const count = new MemoryNode("h2")
  const warning = new MemoryNode("p")
  const panel = new MemoryNode("section")
  const selected = new MemoryNode("div")
  panel.dataset.facetPanel = ""
  panel.hidden = true
  selected.dataset.selectedFacets = ""
  const triggers = ["research", "constraints", "oracle", "methods", "more"].map((name) => {
    const trigger = new MemoryNode("button")
    trigger.dataset.facetPanelTrigger = name
    trigger.setAttribute("aria-expanded", "false")
    return trigger
  })
  form.append(...triggers, selected, panel)
  const ids = new Map([
    ["library-search", search],
    ["library-filters", form],
    ["library-reset", reset],
    ["library-count", count],
    ["library-warning-summary", warning],
  ])
  const documentListeners = new Map()
  const document = {
    activeElement: null,
    defaultView: {
      AbortController: globalThis.AbortController,
      HTMLTemplateElement: MemoryTemplateElement,
      location: { href: "http://127.0.0.1:4176/local_library_output/desktop/library.html" },
    },
    body: new MemoryNode("body"),
    getElementById: (id) => ids.get(id) ?? null,
    querySelector: (selector) => {
      if (selector === "[data-facet-panel]") return panel
      if (selector === "[data-selected-facets]") return selected
      return null
    },
    querySelectorAll: (selector) => selector === "[data-facet-panel-trigger]" ? triggers : [],
    createDocumentFragment: () => {
      const fragment = new MemoryFragment()
      fragment.ownerDocument = document
      return fragment
    },
    createElement: (tagName) => {
      const node = new MemoryNode(tagName)
      node.ownerDocument = document
      return node
    },
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.ownerDocument = document
      node.textContent = value
      return node
    },
    addEventListener: (type, listener) => {
      const listeners = documentListeners.get(type) ?? []
      listeners.push(listener)
      documentListeners.set(type, listeners)
    },
    dispatch(type, init = {}) {
      const event = {
        target: init.target ?? document,
        key: init.key ?? "",
        metaKey: init.metaKey ?? false,
        ctrlKey: init.ctrlKey ?? false,
        defaultPrevented: false,
        preventDefaultCount: 0,
        preventDefault() {
          this.defaultPrevented = true
          this.preventDefaultCount += 1
        },
      }
      for (const listener of documentListeners.get(type) ?? []) listener(event)
      return event
    },
  }
  for (const node of [form, search, reset, count, warning, panel, selected, document.body, ...triggers]) node.ownerDocument = document
  return { document, form, search, reset, count, warning, panel, selected, triggers, ids, documentListeners }
}

function finalLocalCapabilities(overrides = {}) {
  const categories = [
    ["note", "论文精读", "note"],
    ["derivation", "推导过程", "derivation"],
    ["source_map", "来源映射", "derivation"],
    ["modeling", "建模复盘", "simulation"],
    ["simulation", "仿真描述", "simulation"],
    ["code_compare", "代码对照", "code_compare"],
    ["reproduction_report", "复现报告", "simulation"],
  ].map(([value, label, target_tab]) => ({ value, label, target_tab }))
  return {
    api_version: 1,
    note_import: true,
    source_path: true,
    candidate_archive: false,
    archive_rebuild: false,
    discovery: true,
    agent_task_center: true,
    archive_source_id: null,
    categories,
    recovery: {
      required: false,
      kind: null,
      reason_code: null,
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
    ...overrides,
  }
}

function noteInspection(overrides = {}) {
  return {
    inspection_id: "inspection-1",
    suggested_file_name: "Paper-01_论文精读.md",
    checks: {
      items: [{ code: "MARKER_MATCH", severity: "pass", message: "笔记类型标记正确" }],
      blocking_codes: [],
      warning_codes: [],
      can_import: true,
    },
    target_tab: "note",
    expires_at: "2030-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function importedNote(overrides = {}) {
  return {
    paper_id: "Paper-01",
    actual_file_name: "Paper-01_论文精读.md",
    target_tab: "note",
    new_preview_url: `../../local_library_data/notes/paper-01/note/${"b".repeat(64)}.html`,
    index_version: "c".repeat(64),
    ...overrides,
  }
}

function createNoteImportControllerDocument() {
  const ui = createControllerDocument()
  const { document, ids } = ui
  const make = (id, tagName = "div") => {
    const node = new MemoryNode(tagName)
    node.ownerDocument = document
    node.setAttribute("id", id)
    ids.set(id, node)
    return node
  }

  const results = make("library-results")
  const empty = make("library-empty")
  const error = make("library-error")
  error.hidden = true
  const template = new MemoryTemplateElement()
  template.ownerDocument = document
  ids.set("library-paper-row-template", template)
  const listView = make("library-list-view", "section")
  listView.dataset.view = "list"
  listView.append(results, empty, error)
  const detail = make("library-detail", "section")
  detail.hidden = true
  const detailBack = make("library-detail-back", "button")
  const readerTabs = make("library-reader-tabs")
  const tabs = ["overview", "source", "note", "derivation", "simulation", "code_compare", "writing"].map((key) => {
    const tab = new MemoryNode("button")
    tab.ownerDocument = document
    tab.dataset.readerTab = key
    tab.setAttribute("role", "tab")
    readerTabs.append(tab)
    return tab
  })
  const readerPanels = tabs.map((tab) => {
    const panel = new MemoryNode("section")
    panel.ownerDocument = document
    panel.dataset.readerPanel = tab.dataset.readerTab
    panel.setAttribute("role", "tabpanel")
    detail.append(panel)
    return panel
  })
  const readerLoadStatus = new MemoryNode("span")
  readerLoadStatus.ownerDocument = document
  readerLoadStatus.dataset.readerLoadStatus = ""
  const readerToc = make("library-reader-toc", "aside")
  const readerTocToggle = make("library-reader-toc-toggle", "button")
  readerTocToggle.setAttribute("aria-expanded", "true")
  const readerTocLinks = new MemoryNode("nav")
  readerTocLinks.ownerDocument = document
  readerTocLinks.dataset.readerTocLinks = ""
  readerToc.append(readerTocLinks)
  const addNote = make("library-add-note", "button")
  addNote.disabled = true
  const noteImportHelp = make("library-note-import-help", "span")
  const indexReloadStatus = new MemoryNode("span")
  indexReloadStatus.ownerDocument = document
  indexReloadStatus.dataset.indexReloadStatus = ""
  indexReloadStatus.ownText = "笔记已导入，但索引刷新失败。"
  indexReloadStatus.hidden = true
  const indexReload = make("library-index-reload", "button")
  indexReloadStatus.append(indexReload)
  detail.append(detailBack, readerTabs, readerLoadStatus, readerTocToggle, addNote, noteImportHelp, indexReloadStatus)

  const recoveryBanner = new MemoryNode("section")
  recoveryBanner.ownerDocument = document
  recoveryBanner.dataset.libraryRecoveryBanner = ""
  recoveryBanner.hidden = true
  const recoveryMessage = new MemoryNode("p")
  recoveryMessage.ownerDocument = document
  recoveryMessage.dataset.libraryRecoveryMessage = ""
  const recoveryTuple = new MemoryNode("p")
  recoveryTuple.ownerDocument = document
  recoveryTuple.dataset.libraryRecoveryTuple = ""
  const recoveryAction = make("library-archive-rebuild", "button")
  recoveryAction.hidden = true
  const recoveryStatus = new MemoryNode("p")
  recoveryStatus.ownerDocument = document
  recoveryStatus.dataset.libraryRecoveryStatus = ""
  recoveryBanner.append(recoveryMessage, recoveryTuple, recoveryAction, recoveryStatus)

  const previewMounts = {}
  const materialControls = {}
  const materialSelects = {}
  for (const kind of ["note", "derivation", "simulation", "code_compare"]) {
    const mountId = kind === "code_compare" ? "library-code-compare-preview" : `library-${kind}-preview`
    previewMounts[kind] = make(mountId)
    materialControls[kind] = new MemoryNode("label")
    materialControls[kind].ownerDocument = document
    materialControls[kind].dataset.readerMaterialControl = kind
    materialSelects[kind] = new MemoryNode("select")
    materialSelects[kind].ownerDocument = document
    materialSelects[kind].dataset.readerMaterialSelect = kind
    materialControls[kind].append(materialSelects[kind])
    const panel = readerPanels.find((candidate) => candidate.dataset.readerPanel === kind)
    panel.append(materialControls[kind], previewMounts[kind])
  }

  const inspectorRoot = make("library-inspector", "aside")
  const inspector = new MemoryNode("div")
  inspector.ownerDocument = document
  inspector.dataset.inspectorContent = ""
  const inspectorStatus = new MemoryNode("p")
  inspectorStatus.ownerDocument = document
  inspectorStatus.dataset.inspectorStatus = ""
  inspectorRoot.append(inspector, inspectorStatus)
  const inspectorTitle = make("library-inspector-title", "h2")
  const contextTitle = make("library-context-title", "span")

  const noteDialog = make("library-note-import-dialog", "dialog")
  const noteForm = make("library-note-import-form", "form")
  const notePaperId = new MemoryNode("code")
  notePaperId.ownerDocument = document
  notePaperId.dataset.noteImportPaperId = ""
  const noteCategory = make("library-note-import-category", "select")
  noteCategory.value = "note"
  const noteFileLabel = make("library-note-import-file-label", "div")
  const fileInputLabel = new MemoryNode("label")
  const noteFile = make("library-note-import-file", "input")
  noteFile.required = true
  fileInputLabel.append(noteFile)
  noteFileLabel.append(fileInputLabel)
  const noteDraftSource = make("library-note-import-draft-source", "p")
  noteDraftSource.hidden = true
  const noteChecks = make("library-note-import-checks", "ul")
  const noteFileName = make("library-note-import-file-name", "input")
  const noteStatus = new MemoryNode("p")
  noteStatus.ownerDocument = document
  noteStatus.dataset.noteImportStatus = ""
  const noteClose = make("library-note-import-close", "button")
  const noteCancel = make("library-note-import-cancel", "button")
  const noteSubmit = make("library-note-import-submit", "button")
  noteSubmit.disabled = true
  noteForm.append(notePaperId, noteCategory, noteFileLabel, noteDraftSource, noteChecks, noteFileName, noteStatus, noteClose, noteCancel, noteSubmit)
  noteDialog.append(noteForm)

  const baseQuery = document.querySelector
  const baseQueryAll = document.querySelectorAll
  const selectorNodes = new Map([
    ['[data-view="list"]', listView],
    ["#library-inspector [data-inspector-content]", inspector],
    ["#library-inspector [data-inspector-status]", inspectorStatus],
    ["[data-reader-load-status]", readerLoadStatus],
    ["[data-index-reload-status]", indexReloadStatus],
    ["#library-reader-toc [data-reader-toc-links]", readerTocLinks],
    ["[data-note-import-paper-id]", notePaperId],
    ["[data-note-import-status]", noteStatus],
    ["[data-library-recovery-banner]", recoveryBanner],
    ["[data-library-recovery-message]", recoveryMessage],
    ["[data-library-recovery-tuple]", recoveryTuple],
    ["[data-library-recovery-status]", recoveryStatus],
  ])
  for (const kind of ["note", "derivation", "simulation", "code_compare"]) {
    selectorNodes.set(`[data-reader-material-control="${kind}"]`, materialControls[kind])
    selectorNodes.set(`[data-reader-material-select="${kind}"]`, materialSelects[kind])
  }
  document.querySelector = (selector) => {
    if (selectorNodes.has(selector)) return selectorNodes.get(selector)
    if (selector.startsWith('#library-results [data-paper-id="')) {
      return results.querySelector('[data-action="open-detail"]')
    }
    return baseQuery(selector)
  }
  document.querySelectorAll = (selector) => {
    if (selector === "[data-reader-panel]") return readerPanels
    if (selector === "button[data-source-mode]") return []
    return baseQueryAll(selector)
  }

  document.body.append(recoveryBanner, listView, detail, readerToc, inspectorRoot, noteDialog)
  return {
    ...ui,
    results,
    empty,
    error,
    listView,
    detail,
    detailBack,
    readerTabs,
    tabs,
    readerPanels,
    readerToc,
    readerTocToggle,
    addNote,
    noteImportHelp,
    recoveryBanner,
    recoveryMessage,
    recoveryTuple,
    recoveryAction,
    recoveryStatus,
    indexReloadStatus,
    indexReload,
    materialSelects,
    noteDialog,
    noteForm,
    notePaperId,
    noteCategory,
    noteFileLabel,
    noteFile,
    noteDraftSource,
    noteChecks,
    noteFileName,
    noteStatus,
    noteClose,
    noteCancel,
    noteSubmit,
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function markdownFile(name, markdown) {
  const bytes = new TextEncoder().encode(markdown)
  return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

function localJsonResponse(payload, { ok = true, status = ok ? 200 : 400 } = {}) {
  return { ok, status, json: async () => structuredClone(payload) }
}

async function settleControllerEvents() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function normalizedPaper(overrides = {}) {
  const artifacts = Object.fromEntries([
    "pdf", "ocr", "translation", "note", "derivation", "source_map",
    "modeling", "simulation", "code_compare", "script", "result", "reproduction_report",
  ].map((key) => [key, []]))
  const artifactAvailability = Object.fromEntries(Object.keys(artifacts).map((key) => [key, false]))
  return {
    paper_id: "Paper-01",
    slug: "paper-01",
    source_id: "main_papers",
    relative_path: "Topic/Paper",
    identity_source: "catalog",
    unit_type: "article",
    parent_paper_id: null,
    title_original: "Original title",
    title_zh: "",
    title_en: "English title",
    publication_year: 2024,
    version_date: null,
    authors: ["Author"],
    year: 2024,
    venue: "Journal",
    doi_or_url: "https://doi.org/10.1000/example",
    record_type: "外部论文",
    facets: validFacets(),
    facet_states: {},
    source_terms: ["Tracking-ADMM"],
    contribution_role: "unclassified",
    p02_relevance: null,
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    writing_material_count: 0,
    preferred_note: null,
    note_preview_url: null,
    warnings: [],
    note_status: "pdf_only",
    metadata_provenance: {
      paper_id: "catalog",
      title_original: "catalog",
      title_zh: "default",
      title_en: "catalog",
      authors: "catalog",
      publication_year: "catalog",
      version_date: "default",
      year: "catalog",
      venue: "catalog",
      doi_or_url: "catalog",
      unit_type: "adapter",
      parent_paper_id: "adapter",
      record_type: "tag_catalog",
      facets: "tag_catalog",
      facet_states: "tag_catalog",
      source_terms: "tag_catalog",
      contribution_role: "default",
      p02_relevance: "default",
    },
    artifacts,
    artifact_availability: artifactAvailability,
    controlled_previews: { note: null, derivation: null, simulation: null, code_compare: null },
    source_documents: { pdf: [], ocr: [] },
    ...overrides,
  }
}

const controlledPreviewDocumentCategories = Object.freeze([
  "note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report",
])

function controlledPreviewDocuments(overrides = {}) {
  return Object.fromEntries(controlledPreviewDocumentCategories.map((category) => [category, overrides[category] ?? []]))
}

function controlledPreviewDocument(category, {
  label = `${category}.md`,
  hashCharacter = "a",
  sizeBytes = 1024,
  isDefault = false,
} = {}) {
  return {
    label,
    url: `../../local_library_data/notes/paper-01/${category}/${hashCharacter.repeat(64)}.html`,
    size_bytes: sizeBytes,
    is_default: isDefault,
  }
}

const facetGroups = Object.freeze([
  ["research", "research.domain", "研究领域", ["分布式优化", "分布式学习", "联邦学习"]],
  ["research", "research.mode", "任务范式", ["静态优化", "在线优化", "随机优化", "鲁棒优化"]],
  ["more", "objective", "目标函数", ["凸", "强凸", "非凸", "光滑", "非光滑", "随机目标"]],
  ["constraints", "constraints.scope", "作用范围", ["无显式约束", "本地约束", "耦合约束", "决策耦合约束"]],
  ["constraints", "constraints.form", "数学形式", ["集合约束", "等式约束", "不等式约束", "不确定约束"]],
  ["constraints", "constraints.consistency", "节点关系", ["本地一致约束", "本地非一致约束"]],
  ["oracle", "oracle.information", "信息来源", ["精确梯度", "次梯度", "随机梯度", "函数值反馈"]],
  ["oracle", "oracle.estimation", "估计与跟踪", ["梯度跟踪", "单点估计", "双点估计", "残差反馈", "次梯度重缩放"]],
  ["methods", "methods.framework", "主框架", ["次梯度法", "对偶平均", "镜像下降", "对偶分解", "ADMM", "原始—对偶", "增广拉格朗日", "算子分裂", "原始松弛"]],
  ["methods", "methods.coordination", "协调机制", ["普通共识", "Push-Sum", "Perron 修正", "动态跟踪", "有限时间共识"]],
  ["methods", "methods.operator", "更新算子", ["投影", "近端", "预测—校正", "Nesterov 加速"]],
  ["more", "network.direction", "网络方向", ["有向", "无向", "中心化服务器"]],
  ["more", "network.time", "网络时变性", ["固定", "时变"]],
  ["more", "network.balance", "网络平衡性", ["平衡", "不平衡"]],
  ["more", "network.mixing", "混合矩阵", ["行随机", "列随机", "双随机"]],
  ["more", "privacy_robustness", "隐私与鲁棒", ["差分隐私", "Laplace 机制", "Gaussian 机制", "安全多方计算", "结构化扰动", "拜占庭鲁棒", "不确定性鲁棒"]],
  ["more", "results", "理论结果", ["渐近收敛", "精确收敛", "线性收敛", "次线性收敛", "静态遗憾", "动态遗憾", "约束违反界", "隐私保证", "鲁棒保证", "通信复杂度"]],
  ["more", "applications", "应用领域", ["车联网", "无线物联网", "临床机器学习", "工业信息物理系统"]],
])

function validFacetSchema(version = 2) {
  return {
    version,
    groups: facetGroups.map(([panel, path, label, values]) => ({ panel, path, label, values: [...values] })),
  }
}

function validFacets() {
  return {
    research: { domain: ["分布式优化"], mode: ["静态优化"] },
    objective: ["凸"],
    constraints: { scope: ["耦合约束"], form: ["不等式约束"], consistency: [] },
    oracle: { information: ["精确梯度"], estimation: ["梯度跟踪"] },
    methods: { framework: ["对偶分解"], coordination: ["动态跟踪"], operator: ["近端"] },
    network: { direction: ["有向"], time: ["时变"], balance: ["不平衡"], mixing: ["列随机"] },
    privacy_robustness: [],
    results: ["线性收敛"],
    applications: [],
  }
}

function v2Index(papers = [normalizedPaper()]) {
  return {
    version: 2,
    facet_schema: validFacetSchema(1),
    warning_count: 0,
    papers: papers.map(({ facet_states: _facetStates, ...paper }) => ({
      ...paper,
      metadata_provenance: Object.fromEntries(
        Object.entries(paper.metadata_provenance).filter(([field]) => field !== "facet_states"),
      ),
    })),
  }
}

function v3Index(papers = [normalizedPaper()]) {
  return { version: 3, facet_schema: validFacetSchema(2), warning_count: 0, papers }
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"))
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

function cssDeclaration(rule, property) {
  const match = rule.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "u"))
  assert.ok(match, `missing CSS declaration: ${property}`)
  return match[1].trim()
}

function cssSpecificity(selector) {
  const ids = selector.match(/#[\w-]+/gu)?.length ?? 0
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/gu)?.length ?? 0
  const elements = selector
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/gu, " ")
    .match(/\b[a-z][\w-]*\b/giu)?.length ?? 0
  return [ids, classes, elements]
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function matchesCssCompound(compound, element) {
  if (/[>+~]/u.test(compound)) return false
  const tag = compound.match(/^[a-z][\w-]*/iu)?.[0]
  if (tag && tag.toLowerCase() !== element.tag) return false
  const classes = [...compound.matchAll(/\.([\w-]+)/gu)].map((match) => match[1])
  return classes.every((className) => element.classes.includes(className))
}

function matchesCssSelector(selector, elements) {
  const compounds = selector.trim().split(/\s+/u)
  let elementIndex = elements.length - 1
  if (!matchesCssCompound(compounds.at(-1), elements[elementIndex])) return false

  for (let compoundIndex = compounds.length - 2; compoundIndex >= 0; compoundIndex -= 1) {
    elementIndex -= 1
    while (elementIndex >= 0 && !matchesCssCompound(compounds[compoundIndex], elements[elementIndex])) {
      elementIndex -= 1
    }
    if (elementIndex < 0) return false
  }
  return true
}

function cascadedCssDeclaration(elements, property) {
  const candidates = []
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu
  let ruleMatch
  let sourceOrder = 0
  while ((ruleMatch = rulePattern.exec(styles)) !== null) {
    const declaration = ruleMatch[2].match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "u"))
    if (!declaration) continue
    for (const selector of ruleMatch[1].split(",")) {
      if (!selector.trim().startsWith("@") && matchesCssSelector(selector, elements)) {
        candidates.push({
          value: declaration[1].trim(),
          important: /\s*!important\s*$/u.test(declaration[1]),
          specificity: cssSpecificity(selector),
          sourceOrder,
        })
      }
    }
    sourceOrder += 1
  }
  assert.ok(candidates.length > 0, `missing cascaded CSS declaration: ${property}`)
  candidates.sort((left, right) => (
    Number(left.important) - Number(right.important)
    || compareSpecificity(left.specificity, right.specificity)
    || left.sourceOrder - right.sourceOrder
  ))
  return candidates.at(-1).value.replace(/\s*!important\s*$/u, "")
}

function resolveCssColor(token) {
  const variable = token.match(/^var\((--[\w-]+)\)$/u)?.[1]
  if (!variable) return token
  const match = styles.match(new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, "iu"))
  assert.ok(match, `missing CSS color variable: ${variable}`)
  return match[1]
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu).map((value) => Number.parseInt(value, 16) / 255)
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test("library template exposes every desktop interaction anchor exactly once", () => {
  for (const id of [
    "library-search",
    "p02-shelf",
    "library-filters",
    "library-sort",
    "library-reset",
    "library-results",
    "library-count",
    "library-coverage-summary",
    "library-warning-summary",
    "library-inspector",
    "library-detail",
    "library-detail-back",
    "library-reader-toc-toggle",
    "library-reader-tabs",
    "library-context-title",
    "library-reader-panel-overview",
    "library-reader-panel-source",
    "library-reader-panel-note",
    "library-reader-panel-derivation",
    "library-reader-panel-simulation",
    "library-reader-panel-code_compare",
    "library-reader-panel-writing",
    "library-note-preview",
    "library-derivation-preview",
    "library-simulation-preview",
    "library-code-compare-preview",
    "library-source-pdf-select",
    "library-source-ocr-select",
    "library-source-pdf-frame",
    "library-source-pdf-open",
    "library-source-ocr-preview",
    "library-reader-toc",
    "library-empty",
    "library-error",
  ]) {
    assert.equal(countMatches(html, new RegExp(`id=["']${id}["']`, "gu")), 1, id)
  }
})

test("dedicated reader exposes seven exact Chinese tabs with paired panels", () => {
  const expected = [
    ["overview", "快速概览"],
    ["source", "原文材料"],
    ["note", "论文精读"],
    ["derivation", "推导过程"],
    ["simulation", "仿真描述"],
    ["code_compare", "代码对照"],
    ["writing", "写作用途"],
  ]
  assert.match(html, /id="library-reader-tabs"[^>]*role="tablist"/u)
  for (const [key, label] of expected) {
    assert.match(
      html,
      new RegExp(`role="tab"[^>]*data-reader-tab="${key}"[^>]*aria-controls="library-reader-panel-${key}"[^>]*>${label}<`, "u"),
    )
    assert.match(
      html,
      new RegExp(`id="library-reader-panel-${key}"[^>]*role="tabpanel"[^>]*aria-labelledby="library-reader-tab-${key}"[^>]*data-reader-panel="${key}"`, "u"),
    )
  }
  assert.doesNotMatch(html, /id="library-note-preview"[^>]*aria-live/u)
  assert.match(inspectorSource, /const ALLOWED_PREVIEW_TAGS = new Set\(\[[\s\S]*?"hr"[\s\S]*?\]\)/u)
})

test("source reader exposes compare, PDF, and OCR modes with explicit version controls", () => {
  const panel = html.match(/<section class="library-reader-panel library-source-panel" id="library-reader-panel-source"[\s\S]*?<\/section>\s*<section class="library-reader-panel" id="library-reader-panel-note"/u)?.[0] ?? ""
  for (const [mode, label] of [["compare", "并排"], ["pdf", "PDF"], ["ocr", "OCR"]]) {
    assert.match(panel, new RegExp(`data-source-mode="${mode}"[^>]*>${label}<`, "u"))
  }
  assert.match(panel, /id="library-source-pdf-select"[^>]*aria-label="选择 PDF 版本"/u)
  assert.match(panel, /id="library-source-ocr-select"[^>]*aria-label="选择 OCR 版本"/u)
  assert.match(panel, /id="library-source-pdf-frame"[^>]*title="PDF 原文"/u)
  assert.match(panel, /id="library-source-pdf-open"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/u)
  assert.match(panel, /id="library-source-ocr-preview"/u)
  assert.match(panel, /OCR 仅供检索与浏览，关键公式和结论以 PDF 原文为准/u)
})

test("source mode controls exclude the workspace state container", () => {
  assert.match(
    librarySource,
    /sourceModeButtons:\s*\[\.\.\.document\.querySelectorAll\("button\[data-source-mode\]"\)\]/u,
  )
  assert.match(librarySource, /event\.target\.closest\("button\[data-source-mode\]"\)/u)
  assert.doesNotMatch(librarySource, /querySelectorAll\("\[data-source-mode\]"\)/u)
})

test("all controlled preview tabs use one full-width embedded reader structure", () => {
  const notePanel = html.match(/<section class="library-reader-panel" id="library-reader-panel-note"[\s\S]*?<\/section>/u)?.[0] ?? ""
  const derivationPanel = html.match(/<section class="library-reader-panel" id="library-reader-panel-derivation"[\s\S]*?<\/section>/u)?.[0] ?? ""
  const simulationPanel = html.match(/<section class="library-reader-panel" id="library-reader-panel-simulation"[\s\S]*?<\/section>/u)?.[0] ?? ""
  const codeComparePanel = html.match(/<section class="library-reader-panel" id="library-reader-panel-code_compare"[\s\S]*?<\/section>/u)?.[0] ?? ""

  assert.match(notePanel, /<div class="library-reader-section-heading">[\s\S]*?<h3 id="library-note-title">论文精读<\/h3>/u)
  assert.match(notePanel, /<div class="library-reader-document" id="library-note-preview">/u)
  assert.doesNotMatch(notePanel, /library-note-section|class="library-note-preview/u)
  assert.match(derivationPanel, /<div class="library-reader-section-heading">[\s\S]*?<div class="library-reader-document/u)
  assert.match(simulationPanel, /<h3>仿真描述<\/h3>[\s\S]*?<div class="library-reader-document library-reader-placeholder" id="library-simulation-preview">/u)
  assert.match(codeComparePanel, /<h3>代码对照<\/h3>[\s\S]*?<div class="library-reader-document library-reader-placeholder" id="library-code-compare-preview">/u)
  assert.doesNotMatch(`${simulationPanel}${codeComparePanel}`, /library-reader-simulation-grid|library-reader-preview-card/u)
})

test("four controlled reader panels expose accessible material selectors without adding tabs", () => {
  assert.equal(countMatches(html, /role="tab"/gu), 7)
  assert.equal(countMatches(html, /data-reader-material-select=/gu), 4)
  for (const [tab, label] of [
    ["note", "论文精读"],
    ["derivation", "推导过程"],
    ["simulation", "仿真描述"],
    ["code_compare", "代码对照"],
  ]) {
    const panel = html.match(new RegExp(`<section class="library-reader-panel" id="library-reader-panel-${tab}"[\\s\\S]*?<\\/section>`, "u"))?.[0] ?? ""
    assert.match(panel, new RegExp(`data-reader-material-control="${tab}"`, "u"))
    assert.match(panel, /<span>选择材料<\/span>/u)
    assert.match(
      panel,
      new RegExp(`id="library-${tab.replace("_", "-")}-material-select"[^>]*data-reader-material-select="${tab}"[^>]*aria-label="选择${label}材料"`, "u"),
    )
  }
})

test("material selection models cover empty, single, defaulted, and undecided collections", async () => {
  const { controlledPreviewSelectionModel } = await import("./library.mjs")
  const empty = controlledPreviewSelectionModel(
    normalizedPaper({ controlled_preview_documents: controlledPreviewDocuments() }),
    "note",
  )
  assert.deepEqual(
    {
      count: empty.documents.length,
      selected: empty.selectedDocument,
      showSelect: empty.showSelect,
      placeholder: empty.placeholder,
      emptyMessage: empty.emptyMessage,
    },
    { count: 0, selected: null, showSelect: false, placeholder: null, emptyMessage: "尚无论文精读材料。" },
  )

  const only = controlledPreviewDocument("note", { label: "唯一精读.md" })
  const single = controlledPreviewSelectionModel(
    normalizedPaper({ controlled_preview_documents: controlledPreviewDocuments({ note: [only] }) }),
    "note",
  )
  assert.equal(single.selectedDocument.url, only.url)
  assert.equal(single.showSelect, false)

  const first = controlledPreviewDocument("note", { label: "第一份.md", hashCharacter: "a" })
  const preferred = controlledPreviewDocument("note", { label: "第二份.md", hashCharacter: "b", isDefault: true })
  const defaulted = controlledPreviewSelectionModel(
    normalizedPaper({ controlled_preview_documents: controlledPreviewDocuments({ note: [first, preferred] }) }),
    "note",
  )
  assert.equal(defaulted.selectedDocument.url, preferred.url)
  assert.equal(defaulted.documents[1].optionLabel, "第二份.md（首选）")
  assert.equal(defaulted.showSelect, true)
  assert.equal(defaulted.placeholder, null)

  const undecided = controlledPreviewSelectionModel(
    normalizedPaper({ controlled_preview_documents: controlledPreviewDocuments({ note: [first, { ...preferred, is_default: false }] }) }),
    "note",
  )
  assert.equal(undecided.selectedDocument, null)
  assert.equal(undecided.showSelect, true)
  assert.equal(undecided.placeholder, "请选择一份材料（2）")
  assert.equal(undecided.emptyMessage, "请选择一份材料后预览。")
})

test("merged reader tabs keep category order and prefix every option with a Chinese type", async () => {
  const { controlledPreviewDocumentsForReaderTab } = await import("./library.mjs")
  const paper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({
      derivation: [controlledPreviewDocument("derivation", { label: "公式推导.md", hashCharacter: "a" })],
      source_map: [controlledPreviewDocument("source_map", { label: "出处映射.md", hashCharacter: "b" })],
      simulation: [controlledPreviewDocument("simulation", { label: "仿真说明.md", hashCharacter: "c" })],
      modeling: [controlledPreviewDocument("modeling", { label: "建模过程.md", hashCharacter: "d" })],
      reproduction_report: [controlledPreviewDocument("reproduction_report", { label: "复现报告.md", hashCharacter: "e" })],
    }),
  })

  assert.deepEqual(
    controlledPreviewDocumentsForReaderTab(paper, "derivation").map(({ category, optionLabel }) => [category, optionLabel]),
    [["derivation", "推导 · 公式推导.md"], ["source_map", "来源映射 · 出处映射.md"]],
  )
  assert.deepEqual(
    controlledPreviewDocumentsForReaderTab(paper, "simulation").map(({ category, optionLabel }) => [category, optionLabel]),
    [
      ["simulation", "仿真 · 仿真说明.md"],
      ["modeling", "建模 · 建模过程.md"],
      ["reproduction_report", "复现报告 · 复现报告.md"],
    ],
  )
})

test("path-distinct materials that reuse one content URL remain separately selectable", async () => {
  const {
    controlledPreviewDocumentsForReaderTab,
    controlledPreviewSelectionModel,
    renderReaderMaterialSelector,
  } = await import("./library.mjs")
  const shared = controlledPreviewDocument("note", { label: "目录甲/共同内容.md" })
  const paper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({
      note: [shared, { ...shared, label: "目录乙/共同内容.md" }],
    }),
  })
  const documents = controlledPreviewDocumentsForReaderTab(paper, "note")
  assert.notEqual(documents[0].selectionKey, documents[1].selectionKey)

  const selected = controlledPreviewSelectionModel(paper, "note", documents[1].selectionKey)
  assert.equal(selected.selectedDocument.label, "目录乙/共同内容.md")
  assert.equal(selected.selectedDocument.url, shared.url)

  const { document } = createRenderDocument()
  const select = document.createElement("select")
  renderReaderMaterialSelector({ document, control: document.createElement("label"), select, paper, tab: "note" })
  assert.notEqual(select.children[1].value, select.children[2].value)
})

test("material selector keeps a long full label in its option and accessible name", async () => {
  const { renderReaderMaterialSelector } = await import("./library.mjs")
  const { document } = createRenderDocument()
  const control = document.createElement("label")
  const select = document.createElement("select")
  const longLabel = `${"动态有向网络低通信约束优化推导材料".repeat(8)}.md`
  const preferred = controlledPreviewDocument("note", { label: longLabel, hashCharacter: "b", isDefault: true })
  const paper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({
      note: [controlledPreviewDocument("note", { label: "简短材料.md" }), preferred],
    }),
  })

  const model = renderReaderMaterialSelector({ document, control, select, paper, tab: "note" })

  assert.equal(model.selectedDocument.url, preferred.url)
  assert.equal(control.hidden, false)
  assert.equal(select.children[1].textContent, `${longLabel}（首选）`)
  assert.equal(select.getAttribute("aria-label"), `选择论文精读材料，当前：${longLabel}（首选）`)
  assert.equal(select.getAttribute("title"), `${longLabel}（首选）`)
})

test("reader moves the short paper id into the top context and removes the large heading row", () => {
  assert.match(html, /<strong id="library-context-title">论文库<\/strong>/u)
  assert.match(html, /<section class="library-detail library-reader"[^>]*aria-labelledby="library-context-title"/u)
  assert.doesNotMatch(html, /data-detail-content|library-reader-paper-heading|id="library-detail-title"/u)
  assert.match(html, /<link rel="stylesheet" href="\.\/assets\/styles\.css\?v=[a-z0-9._-]+"\s*\/?>/u)
})

test("reader directory toggle exposes its controlled region and expanded state", () => {
  assert.match(
    html,
    /<button[^>]*id="library-reader-toc-toggle"[^>]*aria-controls="library-reader-toc"[^>]*aria-expanded="true"[^>]*>隐藏目录<\/button>/u,
  )
})

test("reader directory visibility synchronizes the region, button, and layout class", async () => {
  const libraryModule = await import("./library.mjs")
  assert.equal(typeof libraryModule.applyReaderTocVisibility, "function")

  const body = new MemoryNode("body")
  const toc = new MemoryNode("aside")
  const toggle = new MemoryNode("button")
  const document = { body }

  libraryModule.applyReaderTocVisibility({ document, toc, toggle, detailOpen: true, expanded: false })
  assert.equal(toc.hidden, true)
  assert.equal(toggle.getAttribute("aria-expanded"), "false")
  assert.equal(toggle.textContent, "显示目录")
  assert.match(body.className, /(?:^|\s)library-reader-toc-hidden(?:\s|$)/u)

  libraryModule.applyReaderTocVisibility({ document, toc, toggle, detailOpen: true, expanded: true })
  assert.equal(toc.hidden, false)
  assert.equal(toggle.getAttribute("aria-expanded"), "true")
  assert.equal(toggle.textContent, "隐藏目录")
  assert.doesNotMatch(body.className, /(?:^|\s)library-reader-toc-hidden(?:\s|$)/u)

  libraryModule.applyReaderTocVisibility({ document, toc, toggle, detailOpen: false, expanded: false })
  assert.equal(toc.hidden, true)
  assert.doesNotMatch(body.className, /(?:^|\s)library-reader-toc-hidden(?:\s|$)/u)
})

test("library template is Chinese, accessible, and safe to ship as a static page", () => {
  assert.match(html, /<html lang="zh-CN">/u)
  assert.match(html, /<body class="library-page paper-library-page">/u)
  assert.match(html, /aria-label="论文库主导航"/u)
  assert.match(html, /id="library-count"[^>]*tabindex="-1"/u)
  assert.match(html, /id="library-error"[^>]*role="alert"[^>]*hidden/u)
  assert.match(html, /id="library-empty"[^>]*hidden/u)
  assert.doesNotMatch(html, /Unknown|Not Reported|on(?:click|change|input)=/iu)
  assert.equal(html.includes(rootedValue("Users", "")), false)
  assert.equal(html.includes(`${["fi", "le"].join("")}:`), false)
})

test("template exposes one private JSON import input without adding a formal facet control", () => {
  assert.equal(countMatches(html, /id="library-user-tags-import"/gu), 1)
  assert.match(html, /id="library-user-tags-import"[^>]*type="file"[^>]*accept="\.json,application\/json"[^>]*hidden/u)
  assert.doesNotMatch(html, /data-filter-axis="userTags"|data-facet-path="user_tags"/u)
})

test("personal tag controls have desktop containment and visible focus styles", () => {
  assert.match(styles, /\.library-page \.library-user-tags\s*\{[^}]*min-width:\s*0/u)
  assert.match(styles, /\.library-page \.library-user-tag-list\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/u)
  assert.match(styles, /\.library-page \.library-user-tag-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u)
  assert.match(styles, /\.library-page \.library-user-tags button:focus-visible[^}]*outline/u)
  assert.match(styles, /@media \(max-width:\s*1320px\)[\s\S]*?\.library-page \.library-user-tag-form/u)
})

test("renders Chinese note-status group headings with counts and preserves row actions", async () => {
  const { renderPaperRows } = await import("./library.mjs")
  const { document, results } = createRenderDocument()
  const rows = [
    { paper: normalizedPaper({ paper_id: "Paper-P", note_status: "pdf_only" }), personalReadingMarker: "unread" },
    { paper: normalizedPaper({ paper_id: "Paper-N", note_status: "notes_ready", title_zh: "已有标题" }), personalReadingMarker: "read" },
  ]

  renderPaperRows({ document, rows, selectedPaperId: "Paper-N" })

  assert.deepEqual(
    results.querySelectorAll("[data-note-group-heading]").map((node) => node.textContent),
    ["已有笔记 1", "仅 PDF 待阅读 1"],
  )
  assert.deepEqual(
    results.querySelectorAll("[data-note-group]").map((node) => node.dataset.noteGroup),
    ["notes_ready", "pdf_only"],
  )
  assert.equal(results.querySelectorAll('[data-action="select-paper"]').length, 2)
  assert.equal(results.querySelectorAll('[data-action="open-detail"]').length, 2)
  const selectedRow = results.querySelectorAll(".library-paper-row").find((row) => row.dataset.paperId === "Paper-N")
  assert.equal(selectedRow.getAttribute("aria-current"), "true")
  assert.equal(selectedRow.querySelector('[data-action="select-paper"]').getAttribute("aria-pressed"), "true")
  assert.match(selectedRow.querySelector('[data-action="select-paper"]').getAttribute("aria-label"), /选择论文《已有标题》/u)
  assert.match(selectedRow.querySelector('[data-action="open-detail"]').getAttribute("aria-label"), /打开论文《已有标题》的详情/u)
})

test("counts only strictly valid normalized rows when valid and malformed rows are mixed", async () => {
  const { renderPaperRows } = await import("./library.mjs")
  const { document, results } = createRenderDocument()
  const rows = [
    { paper: normalizedPaper({ paper_id: "Paper-Ready", note_status: "notes_ready" }), personalReadingMarker: "read" },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-Provenance", note_status: "notes_ready", metadata_provenance: { paper_id: "inferred" } }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-Title", note_status: "notes_ready", title_original: null }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-Date", note_status: "ocr_only", version_date: 20240101 }) },
    { paper: normalizedPaper({ paper_id: "Paper-Pdf", note_status: "pdf_only" }), personalReadingMarker: "unread" },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-Year", note_status: "pdf_only", publication_year: "2024" }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-Status", note_status: "conflict" }) },
  ]

  renderPaperRows({ document, rows, selectedPaperId: null })

  assert.deepEqual(
    results.querySelectorAll("[data-note-group-heading]").map((node) => node.textContent),
    ["已有笔记 1", "仅 PDF 待阅读 1"],
  )
  assert.deepEqual(
    results.querySelectorAll("[data-note-group]").map((node) => node.dataset.noteGroup),
    ["notes_ready", "pdf_only"],
  )
  assert.deepEqual(
    results.querySelectorAll(".library-paper-row").map((row) => row.dataset.paperId),
    ["Paper-Ready", "Paper-Pdf"],
  )
  assert.equal(results.querySelectorAll('[data-action="select-paper"]').length, 2)
  assert.equal(results.querySelectorAll('[data-action="open-detail"]').length, 2)
})

test("renders no counted section when every supported group contains only malformed records", async () => {
  const { renderPaperRows } = await import("./library.mjs")
  const { document, results } = createRenderDocument()
  const rows = [
    { paper: normalizedPaper({ paper_id: "Paper-Bad-N", note_status: "notes_ready", metadata_provenance: [] }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-O", note_status: "ocr_only", version_date: 20240101 }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-P", note_status: "pdf_only", publication_year: 24 }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-M", note_status: "metadata_only", title_original: 7 }) },
    { paper: normalizedPaper({ paper_id: "Paper-Bad-X", note_status: "not_a_status" }) },
  ]

  renderPaperRows({ document, rows, selectedPaperId: null })

  assert.deepEqual(results.querySelectorAll("[data-note-group-heading]"), [])
  assert.deepEqual(results.querySelectorAll("[data-note-group]"), [])
  assert.deepEqual(results.querySelectorAll(".library-paper-row"), [])
  assert.equal(results.querySelectorAll('[data-action="select-paper"]').length, 0)
  assert.equal(results.querySelectorAll('[data-action="open-detail"]').length, 0)
})

test("library template embeds its favicon without another local or HTTP request", () => {
  const favicon = html.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*>/u)?.[1]
  assert.ok(favicon)
  assert.match(favicon, /^data:image\/svg\+xml,/u)
  assert.equal(new URL(favicon).protocol, "data:")
  assert.equal(favicon.includes(rootedValue("Users", "")), false)
  assert.equal(favicon.includes(`${["fi", "le"].join("")}:`), false)
})

test("library template links only the approved runtime assets and two prototype destinations", () => {
  assert.match(html, /href="\.\/assets\/styles\.css\?v=[a-z0-9._-]+"/u)
  assert.match(html, /src="\.\/assets\/library\.mjs"/u)
  for (const destination of [
    "../../prototype/desktop/index.html",
    "../../prototype/desktop/paper-project.html",
  ]) assert.match(html, new RegExp(`href=["']${destination.replaceAll(".", "\\.")}["']`, "u"))
})

test("P02 shelf and result templates expose the fixed controller contract", () => {
  const shelfRoles = [
    "algorithm_mechanism",
    "theory_evidence",
    "simulation_baseline",
    "related_work",
  ]
  for (const role of shelfRoles) {
    assert.match(
      html,
      new RegExp(`<button[^>]*data-shelf-role=["']${role}["'][^>]*data-role=["']${role}["'][^>]*aria-pressed=["']false["']`, "u"),
    )
  }
  assert.match(html, /<template id="library-paper-row-template">/u)
  assert.match(html, /<article class="library-paper-row"[^>]*data-hit-fields=""/u)
  assert.match(html, /data-action="select-paper"/u)
  assert.match(html, /data-action="open-detail"/u)
  assert.match(html, /<button class="library-paper-title"[^>]*data-action="open-detail"[\s\S]*?data-field="title"/u)
  assert.doesNotMatch(html, /library-open-detail|>→<|&rarr;|&#x2192;/u)
  assert.match(html, /data-field="search-hits"/u)
  assert.match(html, /data-field="identity-status"/u)
  assert.match(html, /data-field="source-directory"/u)
  assert.match(html, /data-field="relative-path"/u)
})

test("coverage and identity hooks expose explicit Chinese missing states", () => {
  assert.match(html, /id="library-coverage-summary"[^>]*aria-live="polite"/u)
  assert.match(html, /id="library-coverage-summary"[^>]*>中文标题 0\/0；待整理身份 0\/0</u)
  assert.match(html, /data-field="identity-status"[^>]*>待整理身份</u)
  assert.doesNotMatch(html, /data-field="identity-status"[^>]*data-identity-status/u)
  assert.match(html, /data-field="source-directory"[^>]*>[\s\S]*?来源目录/u)
  assert.match(html, /data-field="title"[^>]*>暂无书目信息</u)
  assert.doesNotMatch(styles, /\.library-identity-badge::before/u)
  assert.match(styles, /\.library-page \.library-identity-badge\[hidden\],[\s\S]*?\.library-page \.library-row-source\[hidden\][^}]*display:\s*none\s*!important/u)
})

test("paper row action names distinguish records without turning IDs into titles", async () => {
  const { paperActionLabel } = await import("./library.mjs")
  assert.equal(typeof paperActionLabel, "function")
  const untitledA = { paper_id: "Paper-Untitled-A", title_zh: "", title_en: "", identity_source: "frontmatter" }
  const untitledB = { paper_id: "Paper-Untitled-B", title_zh: "", title_en: "", identity_source: "frontmatter" }
  const pending = { paper_id: "LIB-ABCDEF123456", title_zh: "", title_en: "", identity_source: "path_hash" }
  const titled = { paper_id: "Paper-Titled-01", title_zh: "已有标题", title_en: "", identity_source: "frontmatter" }

  const untitledLabels = [untitledA, untitledB].map((paper) => paperActionLabel({ action: "select-paper", paper }))
  assert.deepEqual(untitledLabels, [
    "选择论文《暂无书目信息》，论文 ID Paper-Untitled-A",
    "选择论文《暂无书目信息》，论文 ID Paper-Untitled-B",
  ])
  assert.notEqual(untitledLabels[0], untitledLabels[1])
  const untitledDetailLabels = [untitledA, untitledB].map((paper) => paperActionLabel({ action: "open-detail", paper }))
  assert.deepEqual(untitledDetailLabels, [
    "打开论文《暂无书目信息》的详情，论文 ID Paper-Untitled-A",
    "打开论文《暂无书目信息》的详情，论文 ID Paper-Untitled-B",
  ])
  assert.notEqual(untitledDetailLabels[0], untitledDetailLabels[1])
  assert.equal(
    paperActionLabel({ action: "open-detail", paper: pending }),
    "打开论文《暂无书目信息》的详情，论文 ID LIB-ABCDEF123456，待整理身份",
  )
  assert.equal(
    paperActionLabel({ action: "select-paper", paper: titled }),
    "选择论文《已有标题》，论文 ID Paper-Titled-01",
  )
})

test("pending identity and source-directory labels meet readable contrast", () => {
  const badge = cssRule(".library-page .library-identity-badge")
  const badgeRatio = contrastRatio(
    resolveCssColor(cssDeclaration(badge, "color")),
    resolveCssColor(cssDeclaration(badge, "background")),
  )
  assert.ok(badgeRatio >= 4.5, `pending identity contrast ${badgeRatio.toFixed(2)} is below 4.5`)
  assert.ok(Number.parseFloat(cssDeclaration(badge, "font-size")) >= 9)

  for (const selector of [
    ".library-page .library-row-source strong",
    ".library-page .library-source-directory strong",
  ]) {
    const rule = cssRule(selector)
    const ratio = contrastRatio(resolveCssColor(cssDeclaration(rule, "color")), "#ffffff")
    assert.ok(ratio >= 4.5, `${selector} contrast ${ratio.toFixed(2)} is below 4.5`)
    assert.ok(Number.parseFloat(cssDeclaration(rule, "font-size")) >= 9)
  }
})

test("inspector uses the fixed Task 8 shelf and reading action hooks only", () => {
  assert.match(inspectorSource, /dataset\.action = "toggle-shelf"/u)
  assert.match(inspectorSource, /dataset\.role = role/u)
  assert.match(inspectorSource, /dataset\.action = "set-reading"/u)
  assert.match(inspectorSource, /dataset\.marker = value/u)
  assert.match(inspectorSource, /setAttribute\("aria-pressed",/u)
  assert.doesNotMatch(`${librarySource}\n${inspectorSource}`, /toggle-shelf-role|set-reading-marker/u)
})

test("inspector renders the schema-ordered research profile and plain source terms conservatively", async () => {
  const { renderInspector } = await import("./paper-inspector.mjs")
  const document = {
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const paper = normalizedPaper({
    facets: {
      ...validFacets(),
      constraints: { ...validFacets().constraints, consistency: [] },
      results: [],
      applications: [],
    },
    facet_states: {
      results: "pending_verification",
      applications: "not_applicable",
    },
    source_terms: [],
  })
  const root = renderInspector({ document, paper, workspaceState: {}, facetSchema: validFacetSchema(2) })
  assert.deepEqual(
    root.querySelectorAll("[data-profile-path]").map((node) => node.dataset.profilePath),
    facetGroups.map(([, path]) => path),
  )
  assert.match(root.querySelector('[data-profile-path="constraints.consistency"]').textContent, /节点关系未记录/u)
  assert.match(root.querySelector('[data-profile-path="results"]').textContent, /理论结果待核验/u)
  assert.match(root.querySelector('[data-profile-path="applications"]').textContent, /应用领域不适用/u)
  assert.match(root.querySelector("[data-source-terms]").textContent, /原文术语与算法名称未记录/u)
  assert.equal(root.querySelectorAll(".library-profile-empty--pending-verification").length, 1)
  assert.match(root.textContent, /论文研究画像/u)
  assert.equal(root.querySelectorAll("[data-source-terms]").length, 1)
  assert.equal(root.querySelectorAll("[data-filter-path]").length, 0)
  assert.equal(root.querySelectorAll('[data-action="set-reading"]').length, 3)
  assert.equal(root.querySelectorAll('[data-action="toggle-shelf"]').length, 4)
  assert.equal(root.querySelectorAll('[data-action="copy-private-path"]').length, 1)
  assert.equal(root.querySelector('[data-action="copy-private-path"]').disabled, true)
  assert.equal(root.querySelector('[data-action="copy-private-path"]').getAttribute("title"), "需使用本地论文库服务启动")

  const available = renderInspector({
    document, paper, workspaceState: {}, facetSchema: validFacetSchema(2), sourcePathAvailable: true,
  })
  assert.equal(available.querySelector('[data-action="copy-private-path"]').disabled, false)
})

test("personal tag editor renders safe add, remove, import, and export controls", async () => {
  const { renderUserTagEditor } = await import("./paper-inspector.mjs")
  const document = {
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const paper = normalizedPaper({ paper_id: "Paper-01", title_zh: "测试论文" })
  const root = renderUserTagEditor({
    document,
    paper,
    userTags: ["必读", "<img src=x onerror=alert(1)>"],
    userTagNotice: "已添加标签“必读”",
  })

  assert.match(root.textContent, /我的标签必读移除<img src=x onerror=alert\(1\)>/u)
  assert.equal(root.querySelectorAll("img").length, 0)
  assert.equal(root.querySelectorAll("[data-user-tag-form]").length, 1)
  assert.equal(root.querySelectorAll("[data-user-tag-input]").length, 1)
  assert.deepEqual(
    root.querySelectorAll('[data-action="remove-user-tag"]').map((button) => button.dataset.userTagLabel),
    ["必读", "<img src=x onerror=alert(1)>"],
  )
  assert.equal(root.querySelectorAll('[data-action="export-user-tags"]').length, 1)
  assert.equal(root.querySelectorAll('[data-action="import-user-tags"]').length, 1)
  assert.match(root.querySelector("[data-user-tag-notice]").textContent, /已添加标签/u)
})

test("inspector and reader overview each place personal tags before the research profile", async () => {
  const { renderInspector, renderReaderOverview } = await import("./paper-inspector.mjs")
  const document = {
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const paper = normalizedPaper()
  const inspector = renderInspector({
    document, paper, workspaceState: {}, facetSchema: validFacetSchema(), userTags: ["必读"], userTagNotice: "",
  })
  const overview = renderReaderOverview({
    document, paper, facetSchema: validFacetSchema(), userTags: ["必读"], userTagNotice: "",
  })

  for (const root of [inspector, overview]) {
    assert.equal(root.querySelectorAll("[data-user-tags]").length, 1)
    const children = root.children
    assert.ok(children.indexOf(root.querySelector("[data-user-tags]")) < children.indexOf(root.querySelector(".library-research-profile")))
  }
})

test("facet UI and inspector never assign uncontrolled innerHTML", () => {
  assert.doesNotMatch(`${librarySource}\n${inspectorSource}`, /\.innerHTML\s*=/u)
})

test("window bar exposes inert status ornaments instead of dead buttons", () => {
  assert.doesNotMatch(html, /<button[^>]*(?:aria-label="论文库说明"|aria-label="用户菜单")/u)
  assert.match(html, /<span class="icon-button"[^>]*aria-hidden="true"/u)
  assert.match(html, /<span class="avatar-button"[^>]*aria-label="当前用户：杨"/u)
})

test("论文库侧栏标记论文库为当前页，不再列出学位论文占位入口", () => {
  assert.match(
    html,
    /<a class="nav-item nav-item--active" href="\.\/library\.html" aria-current="page"><span aria-hidden="true">▤<\/span><span>论文库<\/span><\/a>/u,
  )
  assert.doesNotMatch(html, /index\.html#thesis/u)
})

test("template keeps four material-progress groups and exposes exactly five facet entries", () => {
  assert.match(html, /<fieldset[^>]*data-filter-axis="personalReadingMarkers"/u)
  assert.match(html, /<fieldset[^>]*data-filter-axis="sourceStatuses"/u)
  assert.match(html, /<fieldset[^>]*data-filter-axis="evidenceStatuses"/u)
  assert.match(html, /<fieldset[^>]*data-filter-axis="reproductionStatuses"/u)
  assert.equal(countMatches(html, /<fieldset[^>]*data-filter-axis=/gu), 4)
  const entries = [...html.matchAll(/data-facet-panel-trigger="([^"]+)"[^>]*>([^<]+)<\/button>/gu)]
    .map((match) => [match[1], match[2].trim()])
  assert.deepEqual(entries, [
    ["research", "研究任务"],
    ["constraints", "约束结构"],
    ["oracle", "梯度与反馈"],
    ["methods", "方法体系"],
    ["more", "更多条件"],
  ])
  assert.equal(countMatches(html, /data-facet-panel(?:=|\s|>)/gu), 1)
  assert.equal(countMatches(html, /data-selected-facets(?:=|\s|>)/gu), 1)
  for (const retired of ["topics", "methodTags", "networkTags", "problemTags", "propertyTags", "theoryTags"]) {
    assert.doesNotMatch(html, new RegExp(`data-filter-axis=["']${retired}["']`, "u"))
  }
  assert.match(html, /<option value="default">默认顺序<\/option>/u)
  assert.match(html, /<option value="title">标题<\/option>/u)
  assert.match(html, /<option value="year">年份<\/option>/u)
  assert.match(html, /<option value="contribution">贡献类型<\/option>/u)
  assert.match(html, /<option value="evidence">证据完整度<\/option>/u)
})

test("facet panel mapping follows schema order and keeps record type outside academic facets", async () => {
  const { buildFacetPanelModel, nextOpenFacetPanel } = await import("./library.mjs")
  const schema = validFacetSchema()
  const papers = [
    normalizedPaper({ paper_id: "Paper-Article", record_type: "外部论文" }),
    normalizedPaper({ paper_id: "Paper-Review", record_type: "专题综述" }),
  ]
  assert.deepEqual(
    buildFacetPanelModel({ panel: "constraints", facetSchema: schema, papers, filters: {} }).groups.map((group) => group.path),
    ["constraints.scope", "constraints.form", "constraints.consistency"],
  )
  const more = buildFacetPanelModel({ panel: "more", facetSchema: schema, papers, filters: {} })
  assert.deepEqual(more.groups.map((group) => group.path), [
    "objective", "network.direction", "network.time", "network.balance", "network.mixing",
    "privacy_robustness", "results", "applications",
  ])
  assert.deepEqual(more.recordTypes.map((option) => option.value), ["外部论文", "学位论文", "学位论文章节", "专题综述"])
  assert.ok(more.groups.every((group) => group.path !== "record_type"))
  assert.equal(nextOpenFacetPanel(null, "research"), "research")
  assert.equal(nextOpenFacetPanel("research", "constraints"), "constraints")
  assert.equal(nextOpenFacetPanel("constraints", "constraints"), null)
})

test("downloadUserTagJson downloads exact JSON and revokes its object URL", async () => {
  const { downloadUserTagJson } = await import("./library.mjs")
  const clicks = []
  const revoked = []
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type }
  }
  const document = {
    defaultView: {
      Blob: FakeBlob,
      URL: {
        createObjectURL(blob) {
          assert.deepEqual(blob.parts, ['{"schema":"research-console.paper-user-tags"}'])
          assert.equal(blob.type, "application/json")
          return "blob:paper-user-tags"
        },
        revokeObjectURL: (url) => revoked.push(url),
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "a")
      return { click() { clicks.push([this.href, this.download]) } }
    },
  }

  downloadUserTagJson({ document, json: '{"schema":"research-console.paper-user-tags"}' })
  assert.deepEqual(clicks, [["blob:paper-user-tags", "paper-user-tags.json"]])
  assert.deepEqual(revoked, ["blob:paper-user-tags"])
})

test("controller wires personal tags through a separate store and merge-only file import", () => {
  assert.match(librarySource, /const userTagStore = createUserTagStore\(storage\)/u)
  assert.match(librarySource, /userTagStore\.add\(paperId,\s*input\.value\)/u)
  assert.match(librarySource, /userTagStore\.remove\(paperId,\s*action\.dataset\.userTagLabel\)/u)
  assert.match(librarySource, /userTagStore\.importJson\(text,\s*\{\s*mode:\s*"merge",\s*knownPaperIds:/u)
  assert.match(librarySource, /userTagStore\.exportJson\(\)/u)
  assert.match(librarySource, /const userTagState = userTagStore\.read\(\)/u)
  assert.doesNotMatch(librarySource, /store\.(?:add|remove|importJson|exportJson)\(/u)
})

test("desktop view and facet counts honor personal-tag query through separate state", async () => {
  const { buildDesktopLibraryViewState, buildFacetPanelModel } = await import("./library.mjs")
  const paper = normalizedPaper({ paper_id: "Paper-01" })
  const userTagState = { version: 1, papers: { "Paper-01": ["基线候选"] } }
  const view = buildDesktopLibraryViewState({
    papers: [paper], filters: { query: "基线候选" }, facetSchema: validFacetSchema(), userTagState,
  })
  assert.equal(view.resultCount, 1)
  const panel = buildFacetPanelModel({
    panel: "research", facetSchema: validFacetSchema(), papers: [paper],
    filters: { query: "基线候选", facets: {} }, workspaceState: {}, userTagState,
  })
  assert.ok(panel.groups.some((group) => group.options.some((option) => option.count === 1)))
})

test("facet option counts ignore the current path and keep every other active condition", async () => {
  const { buildFacetPanelModel } = await import("./library.mjs")
  const schema = validFacetSchema()
  const papers = [
    normalizedPaper({ paper_id: "Paper-Coupled", facets: validFacets(), source_status: "verified" }),
    normalizedPaper({
      paper_id: "Paper-Local",
      source_status: "verified",
      facets: { ...validFacets(), constraints: { ...validFacets().constraints, scope: ["本地约束"] } },
    }),
    normalizedPaper({
      paper_id: "Paper-Unchecked",
      source_status: "not_checked",
      facets: { ...validFacets(), constraints: { ...validFacets().constraints, scope: ["决策耦合约束"] } },
    }),
  ]
  const filters = {
    facets: { "constraints.scope": ["耦合约束"], "methods.framework": ["对偶分解"] },
    sourceStatuses: ["verified"],
  }
  const scope = buildFacetPanelModel({ panel: "constraints", facetSchema: schema, papers, filters })
    .groups.find((group) => group.path === "constraints.scope")
  assert.deepEqual(
    scope.options.map(({ value, count, selected, disabled }) => ({ value, count, selected, disabled })),
    [
      { value: "无显式约束", count: 0, selected: false, disabled: true },
      { value: "本地约束", count: 1, selected: false, disabled: false },
      { value: "耦合约束", count: 1, selected: true, disabled: false },
      { value: "决策耦合约束", count: 0, selected: false, disabled: true },
    ],
  )
})

test("selected chips are removable by text, refresh immutably, and reset clears every condition", async () => {
  const { removeFilterSelection, renderSelectedFacetChips, resetLibraryFilters } = await import("./library.mjs")
  const document = {
    createDocumentFragment: () => new MemoryFragment(),
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const mount = new MemoryNode("div")
  const filters = {
    query: "Tracking-ADMM",
    facets: { "constraints.scope": ["耦合约束"] },
    recordTypes: ["专题综述"],
    personalReadingMarkers: ["reading"],
    sourceStatuses: ["verified"],
    evidenceStatuses: ["partial"],
    reproductionStatuses: ["code_unrun"],
    shelfRoles: ["related_work"],
  }
  renderSelectedFacetChips({ document, mount, filters, facetSchema: validFacetSchema() })
  const buttons = mount.querySelectorAll("[data-remove-filter]")
  assert.equal(buttons.length, 2)
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-label")), [
    "移除作用范围：耦合约束",
    "移除记录类型：专题综述",
  ])
  assert.match(mount.textContent, /作用范围：耦合约束/u)
  assert.match(mount.textContent, /记录类型：专题综述/u)

  const removed = removeFilterSelection(filters, { kind: "facet", path: "constraints.scope", value: "耦合约束" })
  assert.deepEqual(removed.facets, {})
  assert.deepEqual(filters.facets, { "constraints.scope": ["耦合约束"] })
  assert.deepEqual(resetLibraryFilters(filters), {
    query: "",
    facets: {},
    recordTypes: [],
    personalReadingMarkers: [],
    sourceStatuses: [],
    evidenceStatuses: [],
    reproductionStatuses: [],
    shelfRoles: [],
  })
})

test("desktop view state passes schema labels and source-term labels through query results", async () => {
  const { buildDesktopLibraryViewState } = await import("./library.mjs")
  const schema = validFacetSchema()
  const paper = normalizedPaper({ source_terms: ["Tracking-ADMM"] })
  const facetView = buildDesktopLibraryViewState({ papers: [paper], filters: { query: "对偶分解" }, facetSchema: schema })
  assert.deepEqual(facetView.rows[0].hits, [{ field: "主框架", snippet: "对偶分解" }])
  const sourceView = buildDesktopLibraryViewState({ papers: [paper], filters: { query: "Tracking-ADMM" }, facetSchema: schema })
  assert.deepEqual(sourceView.rows[0].hits, [{ field: "原文术语", snippet: "Tracking-ADMM" }])
})

test("loadPaperIndex accepts approved version pairs and keeps warning uncertainty explicit", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const payload = { ...v2Index(), warning_count: 3 }
  const loaded = await loadPaperIndex(async (url, options) => {
    assert.equal(url, "../../local_library_data/paper-index.json")
    assert.deepEqual(options, { cache: "no-store" })
    return { ok: true, json: async () => payload }
  })
  assert.equal(loaded.version, 2)
  assert.equal(loaded.warning_count, 3)
  assert.deepEqual(loaded.facet_schema, payload.facet_schema)
  assert.deepEqual(loaded.papers[0].facet_states, {})

  for (const warningCount of [undefined, -1, 1.5, "0"]) {
    const uncertain = await loadPaperIndex(async () => ({
      ok: true,
      json: async () => ({ ...v2Index([]), warning_count: warningCount }),
    }))
    assert.equal(uncertain.warning_count, null)
  }
})

test("loadPaperIndex accepts v3 states and normalizes v2 papers to empty states", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const current = await loadPaperIndex(async () => ({
    ok: true,
    json: async () => v3Index([normalizedPaper({
      facets: { ...validFacets(), results: [] },
      facet_states: { results: "pending_verification" },
    })]),
  }))
  assert.equal(current.version, 3)
  assert.deepEqual(current.papers[0].facet_states, { results: "pending_verification" })

  const legacy = await loadPaperIndex(async () => ({ ok: true, json: async () => v2Index() }))
  assert.equal(legacy.version, 2)
  assert.deepEqual(legacy.papers[0].facet_states, {})
})

test("loadPaperIndex enforces version pairs and facet-state consistency", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const invalid = [
    { ...v3Index(), facet_schema: validFacetSchema(1) },
    { ...v2Index(), facet_schema: validFacetSchema(2) },
    v3Index([{ ...normalizedPaper(), facet_states: { private: "unrecorded" } }]),
    v3Index([{ ...normalizedPaper(), facet_states: { results: "waiting" } }]),
    v3Index([normalizedPaper({
      facets: { ...validFacets(), results: [] },
      facet_states: { results: "pending_verification" },
    })]),
    (() => {
      const paper = normalizedPaper()
      delete paper.facet_states
      return v3Index([paper])
    })(),
    { ...v2Index(), papers: [normalizedPaper()] },
  ]
  invalid[4].papers[0].facets.results = ["线性收敛"]
  for (const payload of invalid) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => payload })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex rejects facet states that are not ordinary JSON data objects", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const inherited = Object.create({ applications: "not_applicable" })
  const hidden = {}
  Object.defineProperty(hidden, "applications", { value: "not_applicable", enumerable: false })
  const symbol = { applications: "not_applicable" }
  symbol[Symbol("private")] = "unrecorded"
  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, "applications", {
    enumerable: true,
    get() {
      accessorReads += 1
      return "not_applicable"
    },
  })

  for (const facetStates of [inherited, hidden, symbol, accessor]) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({
        ok: true,
        json: async () => v3Index([normalizedPaper({ facet_states: facetStates })]),
      })),
      /论文库索引格式无效/u,
    )
  }
  assert.equal(accessorReads, 0)
})

test("loadPaperIndex rejects non-enumerable and symbol extras on strict records", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const hidden = v3Index()
  Object.defineProperty(hidden, "private", { value: true, enumerable: false })
  const symbol = v3Index()
  symbol[Symbol("private")] = true

  for (const payload of [hidden, symbol]) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => payload })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex requires the complete exact public paper contract", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const invalidPapers = [
    (() => { const paper = normalizedPaper(); delete paper.slug; return paper })(),
    normalizedPaper({ slug: "Paper 01" }),
    normalizedPaper({ source_id: "Main Papers" }),
    normalizedPaper({ identity_source: "guessed" }),
    normalizedPaper({ unit_type: "dataset" }),
    normalizedPaper({ parent_paper_id: "../parent" }),
    normalizedPaper({ authors: ["Author", 7] }),
    normalizedPaper({ year: 24 }),
    normalizedPaper({ venue: 7 }),
    normalizedPaper({ doi_or_url: 7 }),
    normalizedPaper({ contribution_role: "important" }),
    normalizedPaper({ p02_relevance: 4 }),
    normalizedPaper({ source_status: "ready" }),
    normalizedPaper({ evidence_status: "verified" }),
    normalizedPaper({ reproduction_status: "done" }),
    normalizedPaper({ writing_material_count: -1 }),
    normalizedPaper({ note_status: "ready" }),
    normalizedPaper({ warnings: [7] }),
  ]
  for (const paper of invalidPapers) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([paper]) })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex validates exact artifact and availability shapes", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const validArtifact = { relative_path: "paper.pdf", file_name: "paper.pdf", size_bytes: 12 }
  const withPdfArtifact = () => {
    const paper = normalizedPaper()
    paper.artifacts.pdf = [validArtifact]
    paper.artifact_availability.pdf = true
    return paper
  }
  const invalidPapers = [
    normalizedPaper({ artifacts: {} }),
    normalizedPaper({ artifact_availability: {} }),
    (() => { const paper = withPdfArtifact(); paper.artifacts.pdf[0] = { ...validArtifact, private_path: rootedValue("private", "paper.pdf") }; return paper })(),
    (() => { const paper = withPdfArtifact(); paper.artifacts.pdf[0].file_name = "other.pdf"; return paper })(),
    (() => { const paper = withPdfArtifact(); paper.artifacts.pdf[0].size_bytes = -1; return paper })(),
    (() => { const paper = withPdfArtifact(); paper.artifact_availability.pdf = "yes"; return paper })(),
  ]
  for (const paper of invalidPapers) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([paper]) })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex accepts only safe generated paths and controlled preview URLs", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const previewPath = "../../local_library_data/notes/paper-01/preferred.html"
  const legitimate = normalizedPaper({
    doi_or_url: "https://example.org/file:appendix",
    preferred_note: "notes/reading-note.md",
    note_preview_url: previewPath,
    controlled_previews: {
      note: previewPath,
      derivation: "../../local_library_data/notes/paper-01/derivation.html",
      simulation: "../../local_library_data/notes/paper-01/simulation.html",
      code_compare: "../../local_library_data/notes/paper-01/code_compare.html",
    },
  })
  const loaded = await loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([legitimate]) }))
  assert.equal(loaded.papers[0].doi_or_url, "https://example.org/file:appendix")

  const invalidPapers = [
    normalizedPaper({ relative_path: rootedValue("Users", "example", "private", "paper") }),
    normalizedPaper({ relative_path: driveValue("Users", "example", "paper") }),
    normalizedPaper({ relative_path: ["..", "private", "paper"].join(forwardSeparator) }),
    normalizedPaper({ preferred_note: rootedValue("private", "reading-note.md") }),
    normalizedPaper({ preferred_note: ["..", "private", "reading-note.md"].join(reverseSeparator) }),
    normalizedPaper({ note_preview_url: localProtocolValue("private", "preferred.html") }),
    normalizedPaper({ note_preview_url: "../../local_library_data/notes/other/preferred.html" }),
    normalizedPaper({ controlled_previews: { note: previewPath, derivation: null, simulation: null, code_compare: null } }),
    normalizedPaper({ note_preview_url: previewPath }),
    normalizedPaper({ controlled_previews: { note: null, derivation: localProtocolValue("private", "note.html"), simulation: null, code_compare: null } }),
    normalizedPaper({ controlled_previews: { note: null, derivation: "../../local_library_data/notes/paper-01/note.html", simulation: null, code_compare: null } }),
  ]
  for (const paper of invalidPapers) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([paper]) })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex accepts the optional hashed preview catalog and strictly validates every document", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const catalog = controlledPreviewDocuments({
    note: [controlledPreviewDocument("note", { label: "精读笔记.md", isDefault: true })],
    source_map: [controlledPreviewDocument("source_map", { label: "来源映射.md", hashCharacter: "b" })],
  })
  const current = normalizedPaper({ controlled_preview_documents: catalog })
  const loaded = await loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([current]) }))
  assert.equal(loaded.papers[0].controlled_preview_documents.note[0].label, "精读笔记.md")

  const legacy = await loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([normalizedPaper()]) }))
  assert.equal(Object.hasOwn(legacy.papers[0], "controlled_preview_documents"), false)

  const validNote = controlledPreviewDocument("note")
  const invalidCatalogs = [
    { ...catalog, note: [{ ...validNote, url: `../../local_library_data/notes/other/note/${"a".repeat(64)}.html` }] },
    { ...catalog, note: [{ ...validNote, url: `../../local_library_data/notes/paper-01/source_map/${"a".repeat(64)}.html` }] },
    { ...catalog, note: [{ ...validNote, url: `../../local_library_data/notes/paper-01/note/${"A".repeat(64)}.html` }] },
    { ...catalog, note: [{ ...validNote, url: `${validNote.url}?raw=1` }] },
    { ...catalog, note: [{ ...validNote, url: `${validNote.url}#section` }] },
    { ...catalog, note: [{ ...validNote, url: `../../local_library_data/notes/paper-01/note/../${"a".repeat(64)}.html` }] },
    { ...catalog, note: [{ ...validNote, url: `http://127.0.0.1:4176/local_library_data/notes/paper-01/note/${"a".repeat(64)}.html` }] },
    { ...catalog, note: [{ ...validNote, size_bytes: -1 }] },
    { ...catalog, note: [{ ...validNote, is_default: "yes" }] },
    { ...catalog, note: [{ ...validNote, label: "" }] },
    { ...catalog, note: [{ ...validNote, extra: true }] },
    Object.fromEntries(Object.entries(catalog).filter(([category]) => category !== "note")),
  ]
  for (const controlled_preview_documents of invalidCatalogs) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({
        ok: true,
        json: async () => v2Index([normalizedPaper({ controlled_preview_documents })]),
      })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex recursively rejects private locator values in every public container", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const invalidPapers = [
    normalizedPaper({ title_zh: rootedValue("secret", "research", "paper.md") }),
    normalizedPaper({ title_zh: `私有定位 ${rootedValue("Users", "example", "research", "paper.md")}` }),
    normalizedPaper({ doi_or_url: webValue(`/view?source=${rootedValue("Users", "example", "research")}`) }),
    normalizedPaper({ authors: [driveValue("Users", "example", "research", "paper.md")] }),
    normalizedPaper({ warnings: [localProtocolValue("private", "research", "paper.md")] }),
    normalizedPaper({ source_terms: [rootedValue("home", "example", "research", "paper.md")] }),
    (() => {
      const paper = normalizedPaper()
      paper.artifacts.note = [{ relative_path: rootedValue("private", "research", "note.md"), file_name: "note.md", size_bytes: 1 }]
      return paper
    })(),
    normalizedPaper({ source_documents: {
      pdf: [{ label: driveValue("private", "paper.pdf"), url: `../../local_library_data/sources/paper-01/pdf/${"a".repeat(64)}.pdf`, size_bytes: 1 }],
      ocr: [],
    } }),
  ]
  for (const paper of invalidPapers) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => v2Index([paper]) })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex rejects private locators hidden in HTTP query values and fragments", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const privateUrls = [
    queryValue("path", rootedValue("private", "example", "paper.pdf")),
    queryValue("path", rootedValue("var", "folders", "abc", "paper.pdf")),
    queryValue("path", encodeURIComponent(rootedValue("Users", "example", "research", "paper.pdf"))),
    queryValue("path", encodeURIComponent(rootedValue("Volumes", "research", "paper.pdf"))),
    queryValue("path", rootedValue("tmp", "research", "paper.pdf")),
    queryValue("path", rootedValue("opt", "research", "paper.pdf")),
    queryValue("path", rootedValue("etc", "passwd")),
    queryValue("next", localProtocolValue("private", "x")),
    queryValue("path", encodeURIComponent(driveValue("Users", "example", "research", "paper.pdf"))),
    queryValue("path", encodeURIComponent(networkValue("server", "share", "paper.pdf"))),
    queryValue("path", `${encodeURIComponent(encodeURIComponent(rootedValue("private", "research")))}%ZZ`),
    queryValue("path", encodeURIComponent(rootedValue("home", "example", "research", "paper.pdf")), { fragment: true }),
    queryValue("path", `+${encodeURIComponent(rootedValue("private", "research", "paper.pdf"))}`, { fragment: true }),
    queryValue("path", encodeURIComponent(encodeURIComponent(encodeURIComponent(rootedValue("Users", "example", "research", "paper.pdf")))), { fragment: true }),
  ]
  for (const doi_or_url of privateUrls) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({
        ok: true,
        json: async () => v2Index([normalizedPaper({ doi_or_url })]),
      })),
      /论文库索引格式无效/u,
    )
  }
})

test("loadPaperIndex preserves ordinary HTTP paths, DOI URLs, and non-locator file text", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const publicUrls = [
    "https://doi.org/10.1000/example",
    "https://example.org/file:appendix",
    webValue(rootedValue("private", "example", "paper.html")),
    webValue(rootedValue("Users", "example", "guide.html")),
    "https://example.org/?next=https%3A%2F%2Fdocs.example.org%2Fguide",
    "https://example.org/?q=100%",
  ]
  for (const doi_or_url of publicUrls) {
    const loaded = await loadPaperIndex(async () => ({
      ok: true,
      json: async () => v2Index([normalizedPaper({ doi_or_url })]),
    }))
    assert.equal(loaded.papers[0].doi_or_url, doi_or_url)
  }
})

test("loadPaperIndex rejects any drift from the canonical facet schema", async (t) => {
  const { loadPaperIndex } = await import("./library.mjs")
  const mutations = [
    ["伪造中文标签", (schema) => { schema.groups[0].label = "论文专名" }],
    ["增加论文专名", (schema) => { schema.groups[0].values.push("DPZO-TVUD") }],
    ["删除受控值", (schema) => { schema.groups[0].values.pop() }],
    ["交换受控值顺序", (schema) => { schema.groups[0].values.reverse() }],
    ["交换分面组顺序", (schema) => { [schema.groups[0], schema.groups[1]] = [schema.groups[1], schema.groups[0]] }],
  ]
  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const schema = structuredClone(validFacetSchema())
      mutate(schema)
      await assert.rejects(
        () => loadPaperIndex(async () => ({ ok: true, json: async () => ({ ...v2Index(), facet_schema: schema }) })),
        /论文库索引格式无效/u,
      )
    })
  }
})

test("loadPaperIndex rejects failed fetches and malformed index boundaries", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  await assert.rejects(
    () => loadPaperIndex(async () => ({ ok: false, json: async () => ({}) })),
    /论文库索引不可用/u,
  )
  for (const payload of [
    null,
    { version: 2, warning_count: 0, papers: [] },
    { ...v2Index(), version: 1 },
    { ...v2Index(), private_path: rootedValue("private", "papers") },
    { ...v2Index(), papers: {} },
    { ...v2Index(), papers: [null] },
    { ...v2Index(), facet_schema: { ...validFacetSchema(), groups: validFacetSchema().groups.slice(0, -1) } },
    { ...v2Index(), facet_schema: { ...validFacetSchema(), groups: [...validFacetSchema().groups, validFacetSchema().groups[0]] } },
    { ...v2Index(), facet_schema: { ...validFacetSchema(), groups: validFacetSchema().groups.map((group, index) => index === 0 ? { ...group, path: "research.unknown" } : group) } },
    { ...v2Index(), papers: [{ ...normalizedPaper(), paper_id: "" }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), paper_id: ["..", "private"].join(forwardSeparator) }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), paper_id: 'Paper-01"] [data-action="open-detail' }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), title_original: 7 }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), publication_year: "2024" }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), publication_year: 24 }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), version_date: 20240101 }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), metadata_provenance: [] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), metadata_provenance: new Date(0) }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), metadata_provenance: { private_path: "catalog" } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), metadata_provenance: { paper_id: "inferred" } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), metadata_provenance: { topic_l1: "catalog" } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), private_path: rootedValue("private", "papers", "paper.pdf") }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), topic_l1: "分布式优化" }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), research_scopes: ["分布式优化"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), method_tags: ["梯度跟踪"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), network_tags: ["有向网络"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), problem_tags: ["凸优化"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), property_tags: ["差分隐私"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), theory_tags: ["线性收敛"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), record_type: "章节材料" }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), facets: null }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), facets: { ...validFacets(), unknown: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), facets: { ...validFacets(), results: ["未经模式允许的结果"] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_terms: ["Tracking-ADMM", "Tracking-ADMM"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_terms: [" Tracking-ADMM"] }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), note_status: "conflict" }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: null }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [], ocr: [], private: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [{}], ocr: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [{ label: "../paper.pdf", url: "../../local_library_data/sources/paper-01/pdf/a.pdf", size_bytes: 1 }], ocr: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [{ label: "paper.pdf", url: localProtocolValue("private", "paper.pdf"), size_bytes: 1 }], ocr: [] } }] },
    { ...v2Index(), papers: [{ ...normalizedPaper(), source_documents: { pdf: [{ label: "paper.pdf", url: "../../local_library_data/sources/paper-01/pdf/a.pdf", size_bytes: -1 }], ocr: [] } }] },
  ]) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => payload })),
      /论文库索引格式无效/u,
    )
  }

  await assert.rejects(
    () => loadPaperIndex(async () => ({
      ok: true,
      json: async () => ({
        ...v2Index(),
        papers: [normalizedPaper(), normalizedPaper()],
      }),
    })),
    /论文库索引格式无效/u,
  )
})

test("retryable loader keeps explicit error state and performs a real retry", async () => {
  const { createRetryableLoader } = await import("./library.mjs")
  let calls = 0
  let release
  const loader = createRetryableLoader(async () => {
    calls += 1
    if (calls === 1) throw new Error("first failure")
    return new Promise((resolve) => { release = resolve })
  })

  assert.equal(loader.getState(), "idle")
  assert.deepEqual(await loader.run(), { ok: false, value: null })
  assert.equal(loader.getState(), "error")

  const retry = loader.run()
  const sameRetry = loader.run()
  assert.equal(retry, sameRetry)
  assert.equal(loader.getState(), "loading")
  await Promise.resolve()
  release("ready")
  assert.deepEqual(await retry, { ok: true, value: "ready" })
  assert.equal(loader.getState(), "ready")
  assert.equal(calls, 2)
})

test("invalidating a ready or in-flight loader forces one fresh fetch", async () => {
  const { createRetryableLoader } = await import("./library.mjs")
  const releases = []
  const loader = createRetryableLoader(() => new Promise((resolve) => releases.push(resolve)))
  const stale = loader.run()
  loader.invalidate()
  const fresh = loader.run()
  await Promise.resolve()
  await Promise.resolve()
  releases[0]("old")
  assert.deepEqual(await stale, { ok: false, value: null })
  releases[1]("new")
  assert.deepEqual(await fresh, { ok: true, value: "new" })
  assert.equal(loader.getState(), "ready")
})

test("local API client validates final capabilities and sends only stable ids and Markdown content", async () => {
  const {
    importLocalMarkdownNote,
    inspectLocalMarkdownNote,
    loadLocalLibraryCapabilities,
    loadPrivateSourcePath,
  } = await import("./library.mjs")
  const categories = [
    ["note", "论文精读", "note"],
    ["derivation", "推导过程", "derivation"],
    ["source_map", "来源映射", "derivation"],
    ["modeling", "建模复盘", "simulation"],
    ["simulation", "仿真描述", "simulation"],
    ["code_compare", "代码对照", "code_compare"],
    ["reproduction_report", "复现报告", "simulation"],
  ].map(([value, label, target_tab]) => ({ value, label, target_tab }))
  const noRecovery = {
    required: false, kind: null, reason_code: null, archive_source_id: null, paper_id: null, openalex_id: null,
  }
  const capabilities = {
    api_version: 1,
    note_import: true,
    source_path: true,
    candidate_archive: true,
    archive_rebuild: true,
    discovery: true,
    agent_task_center: true,
    archive_source_id: "main_papers",
    categories,
    recovery: noRecovery,
  }
  const calls = []
  const response = (payload, ok = true, status = 200) => ({ ok, status, json: async () => payload })

  assert.deepEqual(await loadLocalLibraryCapabilities(async (url, options) => {
    calls.push([url, options])
    return response(capabilities)
  }), capabilities)

  const inspected = await inspectLocalMarkdownNote({
    fetchImpl: async (url, options) => {
      calls.push([url, options])
      return response({
        inspection_id: "i-1",
        suggested_file_name: "Paper-01_论文精读.md",
        checks: { items: [], blocking_codes: [], warning_codes: [], can_import: true },
        target_tab: "note",
        expires_at: "2030-01-01T00:00:00.000Z",
      })
    },
    paperId: "Paper-01",
    category: "note",
    originalFileName: "local.md",
    markdown: "# note",
  })
  assert.equal(inspected.inspection_id, "i-1")

  const imported = await importLocalMarkdownNote({
    fetchImpl: async (url, options) => {
      calls.push([url, options])
      return response({
        paper_id: "Paper-01",
        actual_file_name: "Paper-01_论文精读.md",
        target_tab: "note",
        new_preview_url: `../../local_library_data/notes/paper-01/note/${"a".repeat(64)}.html`,
        index_version: "b".repeat(64),
      })
    },
    inspectionId: "i-1",
    requestedFileName: "Paper-01_论文精读.md",
  })
  assert.equal(imported.target_tab, "note")

  const sourcePath = rootedValue("private", "papers", "Paper")
  assert.equal(await loadPrivateSourcePath({
    fetchImpl: async (url, options) => {
      calls.push([url, options])
      return response({ paper_id: "Paper-01", source_path: sourcePath })
    },
    paperId: "Paper-01",
  }), sourcePath)

  assert.deepEqual(calls.map(([url]) => url), [
    "/api/v1/capabilities", "/api/v1/notes/inspect", "/api/v1/notes/import", "/api/v1/papers/source-path",
  ])
  assert.equal(calls[0][1].cache, "no-store")
  assert.equal(calls[0][1].credentials, "same-origin")
  for (const [, options] of calls.slice(1)) {
    assert.equal(options.cache, "no-store")
    assert.equal(options.credentials, "same-origin")
    assert.equal(options.headers["Content-Type"], "application/json")
  }
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    paper_id: "Paper-01", category: "note", original_file_name: "local.md", markdown: "# note",
  })
  assert.deepEqual(JSON.parse(calls[2][1].body), {
    inspection_id: "i-1", requested_file_name: "Paper-01_论文精读.md", conflict_policy: "version",
  })
  assert.deepEqual(JSON.parse(calls[3][1].body), { paper_id: "Paper-01" })
  assert.equal(JSON.stringify(calls.slice(1).map(([, options]) => JSON.parse(options.body))).includes("source_path"), false)
})

test("final capability validator rejects contradictions and all local errors retain safe fields only", async () => {
  const { importLocalMarkdownNote, loadLocalLibraryCapabilities } = await import("./library.mjs")
  const categories = [
    ["note", "论文精读", "note"], ["derivation", "推导过程", "derivation"],
    ["source_map", "来源映射", "derivation"], ["modeling", "建模复盘", "simulation"],
    ["simulation", "仿真描述", "simulation"], ["code_compare", "代码对照", "code_compare"],
    ["reproduction_report", "复现报告", "simulation"],
  ].map(([value, label, target_tab]) => ({ value, label, target_tab }))
  const base = {
    api_version: 1, note_import: true, source_path: true, candidate_archive: false,
    archive_rebuild: false, discovery: true, agent_task_center: true, archive_source_id: null, categories,
    recovery: { required: false, kind: null, reason_code: null, archive_source_id: null, paper_id: null, openalex_id: null },
  }
  const invalid = [
    { ...base, candidate_archive: true },
    {
      ...base,
      note_import: false,
      source_path: false,
      discovery: false,
      agent_task_center: false,
    },
    { ...base, categories: [...categories].reverse() },
    { ...base, extra: true },
    { ...base, recovery: { ...base.recovery, required: true, kind: "manual_note", reason_code: "ROLLBACK_FAILED", paper_id: "Paper-01" } },
  ]
  for (const payload of invalid) {
    await assert.rejects(
      () => loadLocalLibraryCapabilities(async () => ({ ok: true, status: 200, json: async () => payload })),
      /响应格式无效/u,
    )
  }

  const recoveryStates = [
    {
      ...base,
      note_import: false,
      archive_rebuild: true,
      archive_source_id: "main_papers",
      recovery: {
        required: true,
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Paper-01",
        openalex_id: "W123",
      },
    },
    {
      ...base,
      note_import: false,
      recovery: {
        required: true,
        kind: "manual_note",
        reason_code: "ROLLBACK_FAILED",
        archive_source_id: null,
        paper_id: null,
        openalex_id: null,
      },
    },
  ]
  for (const payload of recoveryStates) {
    assert.deepEqual(
      await loadLocalLibraryCapabilities(async () => ({ ok: true, status: 200, json: async () => payload })),
      payload,
    )
  }

  let caught
  try {
    await importLocalMarkdownNote({
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "LIBRARY_WRITE_BUSY",
            message: "正在重建，请稍后重试",
            file_name: "Paper-01_论文精读.md",
            source_path: rootedValue("private", "papers"),
          },
        }),
      }),
      inspectionId: "i-1",
      requestedFileName: "Paper-01_论文精读.md",
    })
  } catch (error) {
    caught = error
  }
  assert.equal(caught.code, "LIBRARY_WRITE_BUSY")
  assert.equal(caught.fileName, "Paper-01_论文精读.md")
  assert.equal(JSON.stringify(caught).includes("private"), false)
  assert.equal(Object.hasOwn(caught, "response"), false)
  assert.equal(Object.hasOwn(caught, "body"), false)
})

test("note import normalizes a fullwidth requested filename before sending and accepts its versioned basename", async () => {
  const { importLocalMarkdownNote } = await import("./library.mjs")
  const fullwidth = "Ｐａｐｅｒ－０１＿论文精读．ｍｄ"
  const normalized = "Paper-01_论文精读.md"
  let requestBody = null
  const result = await importLocalMarkdownNote({
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return localJsonResponse(importedNote({ actual_file_name: "Paper-01_论文精读_v2.md" }))
    },
    inspectionId: "inspection-1",
    requestedFileName: fullwidth,
  })

  assert.equal(requestBody.requested_file_name, normalized)
  assert.equal(result.actual_file_name, "Paper-01_论文精读_v2.md")
})

test("note import accepts every canonical server version integer including 10 through 19 and the upper bound", async (t) => {
  const { importLocalMarkdownNote } = await import("./library.mjs")
  for (const version of [10, 19, 100, 99_999]) {
    await t.test(`v${version}`, async () => {
      const actualFileName = `Paper-01_论文精读_v${version}.md`
      const result = await importLocalMarkdownNote({
        fetchImpl: async () => localJsonResponse(importedNote({ actual_file_name: actualFileName })),
        inspectionId: "inspection-1",
        requestedFileName: "Paper-01_论文精读.md",
      })

      assert.equal(result.actual_file_name, actualFileName)
    })
  }
})

test("note import accepts a canonical versioned response with the requested uppercase Markdown extension", async () => {
  const { importLocalMarkdownNote } = await import("./library.mjs")
  const result = await importLocalMarkdownNote({
    fetchImpl: async () => localJsonResponse(importedNote({ actual_file_name: "Paper-01_论文精读_v2.MD" })),
    inspectionId: "inspection-1",
    requestedFileName: "Paper-01_论文精读.MD",
  })

  assert.equal(result.actual_file_name, "Paper-01_论文精读_v2.MD")
})

test("note import rejects noncanonical versions and extension-case changes", async (t) => {
  const { importLocalMarkdownNote } = await import("./library.mjs")
  for (const [requestedFileName, actualFileName] of [
    ["Paper-01_论文精读.md", "Paper-01_论文精读_v1.md"],
    ["Paper-01_论文精读.md", "Paper-01_论文精读_v02.md"],
    ["Paper-01_论文精读.md", "Paper-01_论文精读_v100000.md"],
    ["Paper-01_论文精读.MD", "Paper-01_论文精读_v2.md"],
    ["Paper-01_论文精读.md", "Paper-01_论文精读_copy.md"],
  ]) {
    await t.test(actualFileName, async () => {
      await assert.rejects(
        () => importLocalMarkdownNote({
          fetchImpl: async () => localJsonResponse(importedNote({ actual_file_name: actualFileName })),
          inspectionId: "inspection-1",
          requestedFileName,
        }),
        /本地服务响应格式无效/u,
      )
    })
  }
})

test("file decoding uses fatal UTF-8 before inspection", async () => {
  const { decodeUtf8MarkdownFile } = await import("./library.mjs")
  const valid = { name: "note.md", arrayBuffer: async () => new TextEncoder().encode("# 中文").buffer }
  assert.equal(await decodeUtf8MarkdownFile(valid), "# 中文")
  const invalid = { name: "bad.md", arrayBuffer: async () => Uint8Array.from([0xff]).buffer }
  await assert.rejects(() => decodeUtf8MarkdownFile(invalid), /UTF-8/u)
  await assert.rejects(
    () => decodeUtf8MarkdownFile({ name: "note.txt", arrayBuffer: async () => new ArrayBuffer() }),
    /Markdown/u,
  )
})

test("controller keeps static index browsing usable and local writes disabled without capabilities", async (t) => {
  const { createLibraryController } = await import("./library.mjs")
  for (const capabilityMode of ["request-failed", "endpoint-missing"]) {
    await t.test(capabilityMode, async () => {
      const ui = createNoteImportControllerDocument()
      const calls = []
      const controller = createLibraryController({
        document: ui.document,
        storage: memoryStorage(),
        fetchImpl: async (url) => {
          calls.push(url)
          if (url === "/api/v1/capabilities") {
            if (capabilityMode === "request-failed") throw new Error("local API unavailable")
            return localJsonResponse(
              { error: { code: "NOT_FOUND", message: "本地能力接口不存在" } },
              { ok: false, status: 404 },
            )
          }
          if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
          throw new Error(`unexpected ${url}`)
        },
      })

      assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
      assert.match(ui.count.textContent, /显示 1 篇，共 1 篇/u)
      assert.equal(ui.error.hidden, true)
      assert.ok(ui.results.querySelector('[data-action="open-detail"]'))
      ui.results.querySelector('[data-action="open-detail"]').click()
      assert.equal(ui.detail.hidden, false)
      assert.equal(ui.addNote.disabled, true)
      assert.equal(ui.noteImportHelp.hidden, false)
      assert.equal(ui.document.getElementById("library-inspector").querySelector('[data-action="copy-private-path"]').disabled, true)
      assert.deepEqual([...calls].sort(), [
        "../../local_library_data/paper-index.json",
        "/api/v1/capabilities",
      ].sort())
    })
  }
})

test("paper_id 深链在索引加载后直接打开对应论文详情", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const requestedPaper = normalizedPaper({
    paper_id: "Paper-02",
    slug: "paper-02",
    title_original: "Requested paper",
    title_en: "Requested paper",
  })
  const controller = createLibraryController({
    document: ui.document,
    location: { search: "?paper_id=Paper-02" },
    storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index([normalizedPaper(), requestedPaper]))
      throw new Error(`unexpected ${url}`)
    },
  })

  assert.deepEqual(await controller.start(), { ok: true, paperCount: 2 })
  assert.equal(ui.listView.hidden, true)
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.ids.get("library-context-title").textContent, "Paper-02")
})

test("q 深链筛选本地论文，并把当前搜索词带到网上检索", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const onlineLink = ui.document.createElement("a")
  ui.ids.set("search-new-paper", onlineLink)
  const onlineModeLink = ui.document.createElement("a")
  ui.ids.set("search-online-library", onlineModeLink)
  const controller = createLibraryController({
    document: ui.document,
    location: { search: "?q=Requested%20paper" },
    storage: memoryStorage(),
    fetchImpl: async (url) => url.endsWith("paper-index.json")
      ? localJsonResponse(v3Index([normalizedPaper(), normalizedPaper({
          paper_id: "Paper-02", slug: "paper-02", title_original: "Requested paper", title_en: "Requested paper",
        })]))
      : localJsonResponse(finalLocalCapabilities()),
  })
  await controller.start()
  assert.equal(ui.search.value, "Requested paper")
  assert.match(ui.count.textContent, /显示 1 篇，共 2 篇/u)
  assert.equal(onlineLink.href, "./discovery.html?q=Requested%20paper")
  assert.equal(onlineModeLink.href, "./discovery.html?q=Requested%20paper")
  ui.search.value = "新的关键词 & ADMM"
  ui.search.dispatch("input")
  assert.equal(new URL(onlineLink.href, "https://example.org/").searchParams.get("q"), "新的关键词 & ADMM")
  assert.equal(ui.empty.hidden, false)
  ui.reset.click()
  assert.equal(onlineLink.href, "./discovery.html")
  assert.equal(onlineModeLink.href, "./discovery.html")
})

test("失效的 paper_id 深链显示未匹配状态，不误选其他论文", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const controller = createLibraryController({
    document: ui.document, location: { search: "?paper_id=Missing-01" }, storage: memoryStorage(),
    fetchImpl: async (url) => localJsonResponse(url.endsWith("paper-index.json") ? v3Index() : finalLocalCapabilities()),
  })
  await controller.start()
  assert.equal(ui.detail.hidden, true)
  assert.equal(ui.search.value, "Missing-01")
  assert.equal(ui.empty.hidden, false)
  assert.match(ui.count.textContent, /显示 0 篇/u)
})

test("successful import refetches only when URL and filename identify one preview", async () => {
  const { findImportedPreviewSelection } = await import("./library.mjs")
  const previewUrl = controlledPreviewDocument("source_map", {
    label: "Paper-01_source_map.md",
    hashCharacter: "b",
  }).url
  const paper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({
      source_map: [
        controlledPreviewDocument("source_map", { label: "Paper-01_source_map.md", hashCharacter: "b" }),
        controlledPreviewDocument("source_map", { label: "another.md", hashCharacter: "c" }),
      ],
    }),
  })
  assert.equal(findImportedPreviewSelection({
    paper,
    targetTab: "derivation",
    previewUrl,
    fileName: "Paper-01_source_map.md",
  }), "source_map:0")
  assert.equal(findImportedPreviewSelection({
    paper,
    targetTab: "derivation",
    previewUrl,
    fileName: "another.md",
  }), null)
})

test("note dialog focus and cancel stay inside an open paper detail", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  let inspectSignal = null
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url === "/api/v1/notes/inspect") {
        inspectSignal = options.signal
        return new Promise(() => {})
      }
      return localJsonResponse(v3Index())
    },
  })

  assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
  ui.results.querySelector('[data-action="open-detail"]').click()
  assert.equal(ui.detail.hidden, false)
  ui.addNote.click()
  assert.equal(ui.noteDialog.open, true)
  assert.equal(ui.notePaperId.textContent, "Paper-01")
  assert.equal(ui.document.activeElement, ui.noteCategory)
  ui.noteFile.files = [markdownFile("local.md", "# 本地笔记")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  assert.equal(inspectSignal?.aborted, false)

  const cancel = ui.noteDialog.dispatch("cancel")
  assert.equal(cancel.defaultPrevented, false)
  assert.equal(ui.noteDialog.open, false)
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.document.activeElement, ui.addNote)
  assert.equal(inspectSignal?.aborted, true)
})

test("手工分析草稿通过现有检查导入流程绑定原论文，检查后等待确认保存", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const inspected = []
  const controller = createLibraryController({
    document: ui.document, storage: memoryStorage(),
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
      if (url === "/api/v1/notes/inspect") {
        inspected.push(JSON.parse(options.body))
        return localJsonResponse(noteInspection())
      }
      throw new Error(`检查草稿不应调用其他写入接口：${url}`)
    },
  })
  await controller.start()
  ui.document.body.querySelector('[data-note-draft-action="open"]').click()
  const draft = ui.document.body.querySelector(".library-note-draft-dialog")
  const textarea = draft.querySelector("textarea")
  textarea.value = "# Paper-01 论文精读\n\n按原文记录的方法。"
  textarea.dispatch("input")
  const submit = draft.querySelector('[data-note-draft-action="import"]')
  assert.equal(submit.disabled, false)
  submit.click()
  await settleControllerEvents()
  assert.equal(inspected.length, 1)
  assert.equal(inspected[0].paper_id, "Paper-01")
  assert.equal(inspected[0].category, "note")
  assert.equal(inspected[0].markdown, textarea.value)
  assert.equal(draft.open, false)
  assert.equal(ui.noteDialog.open, true)
  assert.equal(ui.notePaperId.textContent, "Paper-01")
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.noteSubmit.disabled, false)
  assert.equal(ui.noteFileLabel.hidden, true)
  assert.equal(ui.noteFile.disabled, true)
  assert.equal(ui.noteFile.required, false)
  assert.equal(ui.noteDraftSource.hidden, false)
  assert.match(ui.noteDraftSource.textContent, /来自当前页面的笔记草稿：Paper-01_论文精读\.md/u)
  assert.match(ui.noteDraftSource.textContent, /无需另选文件/u)

  ui.noteCancel.click()
  ui.addNote.click()
  assert.equal(ui.noteFileLabel.hidden, false)
  assert.equal(ui.noteFile.disabled, false)
  assert.equal(ui.noteFile.required, true)
  assert.equal(ui.noteDraftSource.hidden, true)
  assert.equal(ui.noteDraftSource.textContent, "")
  assert.equal(ui.noteSubmit.disabled, true)
  ui.noteFile.files = [markdownFile("ordinary-file.md", "# 从文件导入的论文精读")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  assert.equal(inspected.length, 2)
  assert.equal(inspected[1].original_file_name, "ordinary-file.md")
  assert.equal(inspected[1].markdown, "# 从文件导入的论文精读")
  assert.equal(ui.noteSubmit.disabled, false)
})

test("旧页面检查草稿时保留另一页面新增的阅读标记与用途架", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const { createWorkspaceStore, WORKSPACE_STORAGE_KEY } = await import("./paper-library-storage.mjs")
  const storage = memoryStorage()
  const oldPage = createNoteImportControllerDocument()
  const otherPage = createNoteImportControllerDocument()
  const inspected = []
  const index = v3Index([normalizedPaper(), normalizedPaper({ paper_id: "Paper-02", slug: "paper-02" })])
  const fetchImpl = async (url, options = {}) => {
    if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
    if (url.endsWith("paper-index.json")) return localJsonResponse(index)
    if (url === "/api/v1/notes/inspect") {
      inspected.push(JSON.parse(options.body))
      return localJsonResponse(noteInspection())
    }
    throw new Error(`unexpected ${url}`)
  }
  await createLibraryController({ document: oldPage.document, storage, fetchImpl }).start()
  await createLibraryController({ document: otherPage.document, storage, fetchImpl }).start()
  otherPage.results.querySelector('[data-paper-id="Paper-02"]').querySelector('[data-action="select-paper"]').click()
  otherPage.document.body.querySelectorAll('[data-action="set-reading"]').find((button) => button.dataset.marker === "read").click()
  otherPage.document.body.querySelectorAll('[data-action="toggle-shelf"]').find((button) => button.dataset.role === "theory_evidence").click()
  const savedBeforeCheck = storage.getItem(WORKSPACE_STORAGE_KEY)
  assert.equal(createWorkspaceStore(storage).read().personalReading["Paper-02"], "read")
  assert.deepEqual(createWorkspaceStore(storage).read().shelf["Paper-02"], ["theory_evidence"])

  oldPage.document.body.querySelector('[data-note-draft-action="open"]').click()
  const draft = oldPage.document.body.querySelector(".library-note-draft-dialog")
  draft.querySelector('[data-note-draft-action="import"]').click()
  await settleControllerEvents()

  assert.equal(inspected[0].paper_id, "Paper-01")
  assert.equal(oldPage.noteDialog.open, true)
  assert.equal(oldPage.notePaperId.textContent, "Paper-01")
  assert.equal(oldPage.detail.hidden, false)
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), savedBeforeCheck)
  assert.equal(createWorkspaceStore(storage).read().personalReading["Paper-02"], "read")
  assert.deepEqual(createWorkspaceStore(storage).read().shelf["Paper-02"], ["theory_evidence"])
  assert.equal(createWorkspaceStore(storage).read().selectedPaperId, "Paper-02")
})

test("草稿检查失败时回到编辑器并保留正文，不误报笔记已导入", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const controller = createLibraryController({
    document: ui.document, storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
      throw new Error("local inspection unavailable")
    },
  })
  await controller.start()
  ui.document.body.querySelector('[data-note-draft-action="open"]').click()
  const draft = ui.document.body.querySelector(".library-note-draft-dialog")
  const textarea = draft.querySelector("textarea")
  textarea.value = "# 不应丢失的手工分析"
  textarea.dispatch("input")
  draft.querySelector('[data-note-draft-action="import"]').click()
  await settleControllerEvents()
  assert.equal(draft.open, true)
  assert.equal(ui.noteDialog.open, false)
  assert.equal(textarea.value, "# 不应丢失的手工分析")
  assert.equal(ui.noteSubmit.disabled, true)
})

test("stale note inspection cannot replace newer warning or blocking checks", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const inspectionRequests = []
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
      if (url === "/api/v1/notes/inspect") {
        return new Promise((resolve) => inspectionRequests.push({
          body: JSON.parse(options.body),
          resolve,
          signal: options.signal,
        }))
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.addNote.click()
  ui.noteFile.files = [markdownFile("local.md", "# 本地笔记")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  assert.equal(inspectionRequests.length, 1)

  ui.noteCategory.value = "simulation"
  ui.noteCategory.dispatch("change")
  await settleControllerEvents()
  assert.equal(inspectionRequests.length, 2)
  assert.equal(inspectionRequests[0].signal?.aborted, true)
  inspectionRequests[1].resolve(localJsonResponse(noteInspection({
    inspection_id: "inspection-new",
    suggested_file_name: "Paper-01_仿真描述.md",
    target_tab: "simulation",
    checks: {
      items: [
        { code: "MARKER_MATCH", severity: "pass", message: "仿真描述标记正确" },
        { code: "FRONTMATTER_MISSING", severity: "warning", message: "建议补充 frontmatter" },
      ],
      blocking_codes: [],
      warning_codes: ["FRONTMATTER_MISSING"],
      can_import: true,
    },
  })))
  await settleControllerEvents()
  assert.equal(ui.noteFileName.value, "Paper-01_仿真描述.md")
  assert.match(ui.noteChecks.textContent, /通过：仿真描述标记正确/u)
  assert.match(ui.noteChecks.textContent, /提醒：建议补充 frontmatter/u)
  assert.equal(ui.noteChecks.children[1].dataset.checkSeverity, "warning")
  assert.equal(ui.noteSubmit.disabled, false)

  inspectionRequests[0].resolve(localJsonResponse(noteInspection({
    inspection_id: "inspection-stale",
    checks: {
      items: [{ code: "MARKER_MISMATCH", severity: "blocking", message: "旧检查不应出现" }],
      blocking_codes: ["MARKER_MISMATCH"],
      warning_codes: [],
      can_import: false,
    },
  })))
  await settleControllerEvents()
  assert.equal(ui.noteFileName.value, "Paper-01_仿真描述.md")
  assert.doesNotMatch(ui.noteChecks.textContent, /旧检查/u)

  ui.noteCategory.value = "code_compare"
  ui.noteCategory.dispatch("change")
  await settleControllerEvents()
  inspectionRequests[2].resolve(localJsonResponse(noteInspection({
    inspection_id: "inspection-blocking",
    suggested_file_name: "Paper-01_代码对比.md",
    target_tab: "code_compare",
    checks: {
      items: [{ code: "MARKER_MISMATCH", severity: "blocking", message: "缺少代码对比标记" }],
      blocking_codes: ["MARKER_MISMATCH"],
      warning_codes: [],
      can_import: false,
    },
  })))
  await settleControllerEvents()
  assert.equal(ui.noteChecks.children[0].dataset.checkSeverity, "blocking")
  assert.match(ui.noteChecks.textContent, /阻止：缺少代码对比标记/u)
  assert.equal(ui.noteSubmit.disabled, true)
})

test("LIBRARY_WRITE_BUSY alone preserves the inspection and blocks every dialog escape path", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const importBodies = []
  let indexCount = 0
  let releaseBusy
  const imported = importedNote()
  const refreshedPaper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({
      note: [controlledPreviewDocument("note", {
        label: imported.actual_file_name,
        hashCharacter: "b",
      })],
    }),
  })
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) {
        indexCount += 1
        return localJsonResponse(indexCount === 1 ? v3Index() : v3Index([refreshedPaper]))
      }
      if (url === "/api/v1/notes/inspect") return localJsonResponse(noteInspection())
      if (url === "/api/v1/notes/import") {
        importBodies.push(JSON.parse(options.body))
        if (importBodies.length === 1) return new Promise((resolve) => { releaseBusy = resolve })
        return localJsonResponse(imported)
      }
      return { ok: false, text: async () => "" }
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.addNote.click()
  ui.noteFile.files = [markdownFile("local.md", "# 论文精读")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  assert.equal(ui.noteSubmit.disabled, false)
  const retainedName = ui.noteFileName.value
  const retainedChecks = ui.noteChecks.textContent

  ui.noteForm.dispatch("submit")
  await settleControllerEvents()
  for (const control of [
    ui.noteCategory, ui.noteFile, ui.noteFileName, ui.noteClose, ui.noteCancel, ui.noteSubmit,
  ]) assert.equal(control.disabled, true)
  ui.noteClose.click()
  ui.noteCancel.click()
  const cancel = ui.noteDialog.dispatch("cancel")
  const escape = ui.document.dispatch("keydown", { key: "Escape" })
  ui.detailBack.click()
  assert.equal(cancel.defaultPrevented, true)
  assert.equal(escape.defaultPrevented, true)
  assert.equal(ui.noteDialog.open, true)
  assert.equal(ui.detail.hidden, false)

  releaseBusy(localJsonResponse({
    error: {
      code: "LIBRARY_WRITE_BUSY",
      message: "正在重建，请稍后重试",
      file_name: retainedName,
    },
  }, { ok: false, status: 409 }))
  await settleControllerEvents()
  assert.equal(ui.noteDialog.open, true)
  assert.equal(ui.noteFileName.value, retainedName)
  assert.equal(ui.noteChecks.textContent, retainedChecks)
  assert.equal(ui.noteSubmit.disabled, false)
  assert.match(ui.noteStatus.textContent, /正在重建，请稍后重试/u)

  ui.noteForm.dispatch("submit")
  await settleControllerEvents()
  assert.equal(importBodies.length, 2)
  assert.equal(importBodies[0].inspection_id, "inspection-1")
  assert.equal(importBodies[1].inspection_id, "inspection-1")
  assert.equal(ui.noteDialog.open, false)
  assert.equal(ui.detail.hidden, false)
  assert.equal(indexCount, 2)
})

test("stale note inspection is required again after any non-busy import error", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  let importCount = 0
  const privatePath = rootedValue("private", "papers", "Paper-01")
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
      if (url === "/api/v1/notes/inspect") return localJsonResponse(noteInspection())
      if (url === "/api/v1/notes/import") {
        importCount += 1
        return localJsonResponse({
          error: {
            code: "INSPECTION_EXPIRED",
            message: "检查结果已过期，请重新选择文件",
            file_name: "local.md",
            source_path: privatePath,
            raw_body: `do not render ${privatePath}`,
          },
        }, { ok: false, status: 409 })
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.addNote.click()
  ui.noteFile.files = [markdownFile("local.md", "# 论文精读")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  ui.noteForm.dispatch("submit")
  await settleControllerEvents()

  assert.equal(ui.noteDialog.open, true)
  assert.equal(ui.noteSubmit.disabled, true)
  assert.equal(ui.noteChecks.children.length, 0)
  assert.match(ui.noteStatus.textContent, /检查结果已过期，请重新选择文件/u)
  assert.match(ui.noteStatus.textContent, /local\.md/u)
  assert.doesNotMatch(ui.noteDialog.textContent, /private|source_path|raw_body/u)
  ui.noteForm.dispatch("submit")
  await settleControllerEvents()
  assert.equal(importCount, 1)
})

test("successful import refetches the index, preserves detail and TOC, and selects the new preview", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  let indexCount = 0
  const preview = controlledPreviewDocument("source_map", {
    label: "Paper-01_source_map.md",
    hashCharacter: "d",
  })
  const importResult = importedNote({
    actual_file_name: preview.label,
    target_tab: "derivation",
    new_preview_url: preview.url,
  })
  const refreshedPaper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({ source_map: [preview] }),
  })
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) {
        indexCount += 1
        return localJsonResponse(indexCount === 1 ? v3Index() : v3Index([refreshedPaper]))
      }
      if (url === "/api/v1/notes/inspect") {
        const body = JSON.parse(options.body)
        assert.equal(body.category, "source_map")
        return localJsonResponse(noteInspection({
          inspection_id: "source-map-inspection",
          suggested_file_name: preview.label,
          target_tab: "derivation",
        }))
      }
      if (url === "/api/v1/notes/import") return localJsonResponse(importResult)
      return { ok: false, text: async () => "" }
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.readerTocToggle.click()
  assert.equal(ui.readerTocToggle.getAttribute("aria-expanded"), "false")
  ui.addNote.click()
  ui.noteCategory.value = "source_map"
  ui.noteCategory.dispatch("change")
  ui.noteFile.files = [markdownFile("source.md", "source_map\n")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  ui.noteForm.dispatch("submit")
  await settleControllerEvents()

  assert.equal(indexCount, 2)
  assert.equal(ui.noteDialog.open, false)
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.readerTocToggle.getAttribute("aria-expanded"), "false")
  assert.equal(ui.tabs.find((tab) => tab.dataset.readerTab === "derivation").getAttribute("aria-selected"), "true")
  assert.equal(ui.materialSelects.derivation.value, "source_map:0")
  assert.equal(ui.indexReloadStatus.hidden, true)
  assert.equal(ui.error.hidden, true)
})

test("index reload failure preserves the old view and a retry reconciles the imported preview", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  let indexCount = 0
  const preview = controlledPreviewDocument("source_map", {
    label: "Paper-01_source_map.md",
    hashCharacter: "e",
  })
  const importResult = importedNote({
    actual_file_name: preview.label,
    target_tab: "derivation",
    new_preview_url: preview.url,
  })
  const refreshedPaper = normalizedPaper({
    controlled_preview_documents: controlledPreviewDocuments({ source_map: [preview] }),
  })
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return localJsonResponse(finalLocalCapabilities())
      if (url.endsWith("paper-index.json")) {
        indexCount += 1
        if (indexCount === 2) throw new Error("temporary index failure")
        return localJsonResponse(indexCount === 1 ? v3Index() : v3Index([refreshedPaper]))
      }
      if (url === "/api/v1/notes/inspect") return localJsonResponse(noteInspection({
        inspection_id: "reload-inspection",
        suggested_file_name: preview.label,
        target_tab: "derivation",
      }))
      if (url === "/api/v1/notes/import") return localJsonResponse(importResult)
      return { ok: false, text: async () => "" }
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.addNote.click()
  ui.noteCategory.value = "source_map"
  ui.noteCategory.dispatch("change")
  ui.noteFile.files = [markdownFile("source.md", "source_map\n")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  ui.noteForm.dispatch("submit")
  await settleControllerEvents()

  assert.equal(indexCount, 2)
  assert.equal(ui.noteDialog.open, false)
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.results.querySelectorAll('[data-paper-id="Paper-01"]').length, 1)
  assert.equal(ui.error.hidden, true)
  assert.equal(ui.indexReloadStatus.hidden, false)
  assert.match(ui.indexReloadStatus.textContent, /笔记已导入，但索引刷新失败/u)

  ui.indexReload.click()
  await settleControllerEvents()
  assert.equal(indexCount, 3)
  assert.equal(ui.indexReloadStatus.hidden, true)
  assert.equal(ui.detail.hidden, false)
  assert.equal(ui.materialSelects.derivation.value, "source_map:0")
})

test("load visibility preserves a failure instead of replacing it with empty results", async () => {
  const { computeLoadVisibility } = await import("./library.mjs")
  assert.deepEqual(computeLoadVisibility({ loadState: "error", viewEmpty: true }), {
    errorHidden: false,
    emptyHidden: true,
  })
  assert.deepEqual(computeLoadVisibility({ loadState: "ready", viewEmpty: true }), {
    errorHidden: true,
    emptyHidden: false,
  })
})

test("preview coordinator never commits a stale request that ignores abort", async () => {
  const { createPreviewCoordinator } = await import("./library.mjs")
  const pending = new Map()
  const commits = []
  const coordinator = createPreviewCoordinator({
    loadPreview: (paper) => new Promise((resolve) => pending.set(paper.paper_id, resolve)),
    commitPreview: (result, paper) => commits.push(`${paper.paper_id}:${result}`),
    clearPreview: () => {},
  })

  const oldRequest = coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" } })
  const newRequest = coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-B" } })
  pending.get("Paper-B")("new")
  assert.equal(await newRequest, true)
  pending.get("Paper-A")("old")
  assert.equal(await oldRequest, false)
  assert.deepEqual(commits, ["Paper-B:new"])
})

test("preview coordinator reloads a changed visible detail once and closes on no selection", async () => {
  const { createPreviewCoordinator } = await import("./library.mjs")
  const loads = []
  let clears = 0
  const coordinator = createPreviewCoordinator({
    loadPreview: async (paper) => {
      loads.push(paper.paper_id)
      return paper.paper_id
    },
    commitPreview: () => {},
    clearPreview: () => { clears += 1 },
  })

  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" } }), true)
  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" } }), false)
  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-B" } }), true)
  assert.equal(await coordinator.sync({ detailOpen: true, paper: null }), false)
  assert.deepEqual(loads, ["Paper-A", "Paper-B"])
  assert.equal(coordinator.isOpen(), false)
  assert.ok(clears >= 3)
})

test("preview coordinator reloads when the controlled preview kind changes on the same paper", async () => {
  const { createPreviewCoordinator } = await import("./library.mjs")
  const loads = []
  const coordinator = createPreviewCoordinator({
    loadPreview: async (paper, { previewKey }) => {
      loads.push(`${paper.paper_id}:${previewKey}`)
      return previewKey
    },
    commitPreview: () => {},
    clearPreview: () => {},
  })

  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" }, previewKey: "note" }), true)
  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" }, previewKey: "note" }), false)
  assert.equal(await coordinator.sync({ detailOpen: true, paper: { paper_id: "Paper-A" }, previewKey: "derivation" }), true)
  assert.deepEqual(loads, ["Paper-A:note", "Paper-A:derivation"])
})

test("changing material loads the selected URL, keeps select focus, and suppresses the older request", async () => {
  const { changeReaderMaterialSelection, createPreviewCoordinator } = await import("./library.mjs")
  const pending = new Map()
  const commits = []
  const selectionByTab = { note: null }
  let focused = 0
  const coordinator = createPreviewCoordinator({
    loadPreview: (_paper, { previewKey }) => new Promise((resolve) => pending.set(previewKey, resolve)),
    commitPreview: (result) => commits.push(result),
    clearPreview: () => {},
  })
  const render = () => coordinator.sync({
    detailOpen: true,
    paper: { paper_id: "Paper-A" },
    previewKey: selectionByTab.note,
  })
  const firstUrl = controlledPreviewDocument("note", { hashCharacter: "a" }).url
  const secondUrl = controlledPreviewDocument("note", { hashCharacter: "b" }).url

  const oldRequest = changeReaderMaterialSelection({
    selectionByTab,
    tab: "note",
    url: firstUrl,
    render,
    findSelect: () => ({ focus: () => { focused += 1 } }),
  })
  const newRequest = changeReaderMaterialSelection({
    selectionByTab,
    tab: "note",
    url: secondUrl,
    render,
    findSelect: () => ({ focus: () => { focused += 1 } }),
  })
  pending.get(secondUrl)("second")
  assert.equal(await newRequest, true)
  pending.get(firstUrl)("first")
  assert.equal(await oldRequest, false)

  assert.equal(selectionByTab.note, secondUrl)
  assert.equal(focused, 2)
  assert.deepEqual(commits, ["second"])
})

test("preview coordinator joins the same in-flight OCR request after a mode rerender", async () => {
  const { createPreviewCoordinator } = await import("./library.mjs")
  let releasePreview
  let loadCount = 0
  const coordinator = createPreviewCoordinator({
    loadPreview: async () => {
      loadCount += 1
      return new Promise((resolve) => { releasePreview = resolve })
    },
    commitPreview: () => {},
    clearPreview: () => {},
  })
  const request = { detailOpen: true, paper: { paper_id: "Paper-A" }, previewKey: "ocr-a" }

  const first = coordinator.sync(request)
  await Promise.resolve()
  let duplicateSettled = false
  const duplicate = coordinator.sync(request).then((value) => {
    duplicateSettled = true
    return value
  })
  await Promise.resolve()

  assert.equal(loadCount, 1)
  assert.equal(duplicateSettled, false)
  releasePreview("OCR")
  assert.equal(await first, true)
  assert.equal(await duplicate, true)
})

test("reader loading status names the material currently being fetched", async () => {
  const { previewLoadingMessage, readerTabStatusMessage } = await import("./library.mjs")
  assert.equal(previewLoadingMessage("note"), "正在读取论文精读…")
  assert.equal(previewLoadingMessage("derivation"), "正在读取推导过程…")
  assert.equal(previewLoadingMessage("simulation"), "正在读取仿真描述…")
  assert.equal(previewLoadingMessage("code_compare"), "正在读取代码对照…")
  assert.equal(readerTabStatusMessage("simulation", "loading"), "正在读取仿真描述…")
  assert.equal(readerTabStatusMessage("simulation", "ready"), "仿真描述已读取")
  assert.equal(readerTabStatusMessage("code_compare", "loading"), "正在读取代码对照…")
  assert.equal(readerTabStatusMessage("code_compare", "ready"), "代码对照已读取")
  assert.equal(
    readerTabStatusMessage("note", "ready", { selected: false, placeholder: "请选择一份材料（3）" }),
    "请选择一份材料（3）",
  )
  assert.equal(readerTabStatusMessage("note", "loading", { selected: false }), "")
  assert.equal(readerTabStatusMessage("overview", "loading"), "")
})

test("each controlled reader tab loads only its own preview kind", async () => {
  const { previewKindsForReaderTab } = await import("./library.mjs")
  assert.deepEqual(previewKindsForReaderTab("note"), ["note"])
  assert.deepEqual(previewKindsForReaderTab("derivation"), ["derivation"])
  assert.deepEqual(previewKindsForReaderTab("simulation"), ["simulation"])
  assert.deepEqual(previewKindsForReaderTab("code_compare"), ["code_compare"])
  assert.deepEqual(previewKindsForReaderTab("writing"), [])
})

test("source reader chooses the most useful available view without guessing a version", async () => {
  const { defaultSourceViewMode } = await import("./library.mjs")
  const pdf = [{ label: "paper.pdf", url: "../../local_library_data/sources/paper-01/pdf/a.pdf", size_bytes: 1 }]
  const ocr = [{ label: "paper.md", url: "../../local_library_data/sources/paper-01/ocr/a.html", size_bytes: 1 }]
  assert.equal(defaultSourceViewMode({ pdf, ocr }), "compare")
  assert.equal(defaultSourceViewMode({ pdf, ocr: [] }), "pdf")
  assert.equal(defaultSourceViewMode({ pdf: [], ocr }), "ocr")
  assert.equal(defaultSourceViewMode({ pdf: [], ocr: [] }), "compare")
})

test("source reader status distinguishes OCR completion from native PDF loading", async () => {
  const { sourceReaderStatusMessage } = await import("./library.mjs")

  assert.equal(
    sourceReaderStatusMessage({ showPdf: true, showOcr: true, ocrState: "loading" }),
    "正在读取 OCR 文本…；PDF 由浏览器加载",
  )
  assert.equal(
    sourceReaderStatusMessage({ showPdf: true, showOcr: true, ocrState: "ready" }),
    "OCR 文本已读取；PDF 由浏览器加载",
  )
  assert.equal(
    sourceReaderStatusMessage({ showPdf: true, showOcr: false, ocrState: "idle" }),
    "PDF 由浏览器加载",
  )
  assert.equal(
    sourceReaderStatusMessage({ showPdf: false, showOcr: true, ocrState: "ready" }),
    "OCR 文本已读取",
  )
})

test("source PDF frame keeps the same document across OCR mode toggles", async () => {
  const { syncSourcePdfFrame } = await import("./library.mjs")
  let source = null
  let sourceAssignments = 0
  const frame = {
    hidden: true,
    title: "PDF 原文",
    getAttribute(name) {
      return name === "src" ? source : null
    },
    setAttribute(name, value) {
      if (name !== "src") return
      source = String(value)
      sourceAssignments += 1
    },
    removeAttribute(name) {
      if (name === "src") source = null
    },
  }
  const url = "http://127.0.0.1:4176/local_library_data/sources/paper-01/pdf/a.pdf"

  syncSourcePdfFrame({ frame, show: true, url, label: "paper.pdf" })
  syncSourcePdfFrame({ frame, show: false, url, label: "paper.pdf" })
  syncSourcePdfFrame({ frame, show: true, url, label: "paper.pdf" })

  assert.equal(sourceAssignments, 1)
  assert.equal(source, url)
  assert.equal(frame.hidden, false)
  assert.equal(frame.title, "PDF 原文：paper.pdf")
})

test("reader top context shows only the stable short paper id while detail is open", async () => {
  const { readerContextLabel } = await import("./library.mjs")
  assert.equal(readerContextLabel({ detailOpen: false, paper: { paper_id: "Liu24-LCT" } }), "论文库")
  assert.equal(readerContextLabel({ detailOpen: true, paper: { paper_id: "Liu24-LCT" } }), "Liu24-LCT")
  assert.equal(readerContextLabel({ detailOpen: true, paper: { paper_id: "" } }), "论文库")
})

test("exclusive shelf filtering toggles one role and then focuses the result count", async () => {
  const { focusResultCount, toggleExclusiveShelfRole } = await import("./library.mjs")
  assert.deepEqual(toggleExclusiveShelfRole(["algorithm_mechanism"], "theory_evidence"), ["theory_evidence"])
  assert.deepEqual(toggleExclusiveShelfRole(["theory_evidence"], "theory_evidence"), [])

  const calls = []
  focusResultCount({
    scrollIntoView: (options) => calls.push(["scroll", options]),
    focus: () => calls.push(["focus"]),
  })
  assert.deepEqual(calls, [["scroll", { block: "nearest" }], ["focus"]])
})

test("detail and rerendered inspector focus helpers target fixed equivalent controls", async () => {
  const { focusDetailEntry, restoreInspectorActionFocus } = await import("./library.mjs")
  const focusCalls = []
  const back = { focus: () => focusCalls.push("back") }
  focusDetailEntry(back)
  assert.deepEqual(focusCalls, ["back"])

  let selector = ""
  const root = {
    querySelector(value) {
      selector = value
      return { focus: () => focusCalls.push(value) }
    },
  }
  restoreInspectorActionFocus(root, { action: "toggle-shelf", role: "theory_evidence" })
  assert.equal(selector, '[data-action="toggle-shelf"][data-role="theory_evidence"]')
  restoreInspectorActionFocus(root, { action: "set-reading", marker: "read" })
  assert.equal(selector, '[data-action="set-reading"][data-marker="read"]')
  assert.equal(focusCalls.length, 3)
})

test("rerendered selected row restores focus to the same select button", async () => {
  const { restorePaperSelectionFocus } = await import("./library.mjs")
  const focusCalls = []
  let selector = ""
  const results = {
    querySelector(value) {
      selector = value
      return { focus: () => focusCalls.push(value) }
    },
  }

  restorePaperSelectionFocus(results, "Paper-Visible")

  assert.equal(selector, '[data-paper-id="Paper-Visible"] [data-action="select-paper"]')
  assert.deepEqual(focusCalls, ['[data-paper-id="Paper-Visible"] [data-action="select-paper"]'])
})

test("private-path copy guard clears stale status and invalidates a request after selection changes", async () => {
  const { createPrivatePathCopyGuard } = await import("./library.mjs")
  const status = { textContent: "旧论文路径已复制" }
  const guard = createPrivatePathCopyGuard(() => { status.textContent = "" })

  guard.syncSelection("Paper-A")
  const firstRequest = guard.begin("Paper-A")
  assert.equal(guard.isCurrent(firstRequest), true)
  status.textContent = "原始路径已复制"

  guard.syncSelection("Paper-B")
  assert.equal(status.textContent, "")
  assert.equal(guard.isCurrent(firstRequest), false)

  const secondRequest = guard.begin("Paper-B")
  assert.equal(guard.isCurrent(secondRequest), true)
})

test("creating the controller is import-safe and does not fetch before explicit start", async () => {
  let fetchCount = 0
  const { createLibraryController } = await import("./library.mjs")
  const controller = createLibraryController({
    document: null,
    storage: null,
    fetchImpl: async () => { fetchCount += 1; throw new Error("unexpected") },
  })

  assert.equal(typeof controller.start, "function")
  assert.equal(fetchCount, 0)
})

test("controller explains that scan warning totals are not missing-file counts", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createControllerDocument()
  const controller = createLibraryController({
    document: ui.document,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...v3Index(), warning_count: 145 }) }),
  })
  await controller.start()
  assert.match(ui.warning.textContent, /145 条扫描提示/u)
  assert.match(ui.warning.textContent, /不等于文件缺失/u)
  assert.match(ui.warning.textContent, /本地审计/u)
})

test("controller renders unknown warning counts as user-visible uncertainty", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createControllerDocument()
  const values = new Map()
  const controller = createLibraryController({
    document: ui.document,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ...v3Index(), warning_count: "unknown" }),
    }),
  })

  assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
  assert.equal(ui.warning.textContent, "扫描警告数量未提供")
})

test("controller drives all five facet entries, selections, chip removal, record type, and reset", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createControllerDocument()
  const secondFacets = validFacets()
  secondFacets.constraints.scope = ["本地约束"]
  const papers = [
    normalizedPaper(),
    normalizedPaper({
      paper_id: "Paper-02",
      slug: "paper-02",
      relative_path: "Topic/Second Paper",
      title_original: "Second paper",
      record_type: "学位论文",
      facets: secondFacets,
    }),
  ]
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const controller = createLibraryController({
    document: ui.document,
    storage,
    fetchImpl: async () => ({ ok: true, json: async () => v2Index(papers) }),
  })

  assert.deepEqual(await controller.start(), { ok: true, paperCount: 2 })
  assert.equal(ui.count.textContent, "显示 2 篇，共 2 篇")
  assert.equal(ui.panel.hidden, true)

  for (const trigger of ui.triggers) {
    trigger.click()
    assert.equal(ui.panel.hidden, false)
    assert.equal(trigger.getAttribute("aria-expanded"), "true")
    assert.equal(ui.triggers.filter((item) => item.getAttribute("aria-expanded") === "true").length, 1)
    assert.equal(ui.panel.querySelectorAll("input").includes(ui.document.activeElement), true)
  }

  const constraintsTrigger = ui.triggers.find((trigger) => trigger.dataset.facetPanelTrigger === "constraints")
  constraintsTrigger.click()
  const coupled = ui.panel.querySelectorAll('[data-filter-kind="facet"]')
    .find((input) => input.dataset.facetPath === "constraints.scope" && input.value === "耦合约束")
  coupled.checked = true
  coupled.dispatch("change")
  assert.equal(ui.count.textContent, "显示 1 篇，共 2 篇")
  assert.match(ui.selected.textContent, /作用范围：耦合约束/u)

  const removeFacet = ui.selected.querySelector("[data-remove-filter]")
  removeFacet.focus()
  removeFacet.click()
  assert.equal(ui.count.textContent, "显示 2 篇，共 2 篇")
  assert.equal(ui.document.activeElement, constraintsTrigger)

  const moreTrigger = ui.triggers.find((trigger) => trigger.dataset.facetPanelTrigger === "more")
  moreTrigger.click()
  const thesis = ui.panel.querySelectorAll('[data-filter-kind="recordType"]')
    .find((input) => input.value === "学位论文")
  thesis.checked = true
  thesis.dispatch("change")
  assert.equal(ui.count.textContent, "显示 1 篇，共 2 篇")
  assert.match(ui.selected.textContent, /记录类型：学位论文/u)

  ui.reset.click()
  assert.equal(ui.count.textContent, "显示 2 篇，共 2 篇")
  assert.match(ui.selected.textContent, /尚未选择学术条件/u)
  assert.equal(ui.document.activeElement, ui.count)
})

test("controller actions target the paper actually displayed after filtering", async () => {
  const { chooseDisplayedPaperId } = await import("./library.mjs")
  assert.equal(
    chooseDisplayedPaperId({ selectedPaper: { paper_id: "Paper-Visible" }, persistedPaperId: "Paper-Hidden" }),
    "Paper-Visible",
  )
  assert.equal(chooseDisplayedPaperId({ selectedPaper: null, persistedPaperId: "Paper-Hidden" }), null)
})

test("an open reader keeps its paper when list filtering selects another paper", async () => {
  const { chooseActivePaper } = await import("./library.mjs")
  const deng = normalizedPaper({ paper_id: "Deng23-TSR" })
  const mcmahan = normalizedPaper({ paper_id: "McMahan17-FedAvg" })

  assert.equal(
    chooseActivePaper({
      papers: [deng, mcmahan],
      detailOpen: true,
      detailPaperId: deng.paper_id,
      listSelectedPaper: mcmahan,
    }),
    deng,
  )
  assert.equal(
    chooseActivePaper({
      papers: [deng, mcmahan],
      detailOpen: false,
      detailPaperId: deng.paper_id,
      listSelectedPaper: mcmahan,
    }),
    mcmahan,
  )
})

test("preferred-note URLs are accepted only for the exact generated same-origin location", async () => {
  const { resolveSafeNotePreviewUrl } = await import("./paper-inspector.mjs")
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  assert.equal(
    resolveSafeNotePreviewUrl({
      candidate: "../../local_library_data/notes/paper-01/preferred.html",
      slug: "paper-01",
      baseUrl,
    }),
    "http://127.0.0.1:4176/local_library_data/notes/paper-01/preferred.html",
  )

  for (const candidate of [
    "../../local_library_data/notes/paper-01/preferred.html?raw=1",
    "../../local_library_data/notes/paper-01/preferred.html#note",
    "../../local_library_data/notes/../paper-01/preferred.html",
    "https://example.org/local_library_data/notes/paper-01/preferred.html",
    rootedValue("Users", "example", "private-note.html"),
    localProtocolValue("private", "preferred.html"),
  ]) {
    assert.equal(resolveSafeNotePreviewUrl({ candidate, slug: "paper-01", baseUrl }), null)
  }
})

test("controlled preview URLs accept only their fixed kind and same-origin location", async () => {
  const { resolveSafeControlledPreviewUrl } = await import("./paper-inspector.mjs")
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  assert.equal(
    resolveSafeControlledPreviewUrl({
      candidate: "../../local_library_data/notes/paper-01/derivation.html",
      slug: "paper-01",
      kind: "derivation",
      baseUrl,
    }),
    "http://127.0.0.1:4176/local_library_data/notes/paper-01/derivation.html",
  )
  for (const [kind, candidate] of [
    ["derivation", "../../local_library_data/notes/paper-01/simulation.html"],
    ["simulation", "../../local_library_data/notes/paper-01/simulation.html?raw=1"],
    ["code_compare", "https://example.org/local_library_data/notes/paper-01/code_compare.html"],
    ["unknown", "../../local_library_data/notes/paper-01/unknown.html"],
  ]) {
    assert.equal(resolveSafeControlledPreviewUrl({ candidate, slug: "paper-01", kind, baseUrl }), null)
  }
})

test("hashed preview URLs accept only the current slug, category, origin, and lowercase sha256 file", async () => {
  const { resolveSafeControlledPreviewUrl } = await import("./paper-inspector.mjs")
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  const hash = "c".repeat(64)
  const candidate = `../../local_library_data/notes/paper-01/source_map/${hash}.html`
  assert.equal(
    resolveSafeControlledPreviewUrl({ candidate, slug: "paper-01", kind: "source_map", baseUrl }),
    `http://127.0.0.1:4176/local_library_data/notes/paper-01/source_map/${hash}.html`,
  )

  for (const [kind, unsafe] of [
    ["source_map", `../../local_library_data/notes/paper-02/source_map/${hash}.html`],
    ["derivation", candidate],
    ["source_map", `../../local_library_data/notes/paper-01/source_map/${"C".repeat(64)}.html`],
    ["source_map", `../../local_library_data/notes/paper-01/source_map/${"c".repeat(63)}.html`],
    ["source_map", `${candidate}?raw=1`],
    ["source_map", `${candidate}#section`],
    ["source_map", `../../local_library_data/notes/paper-01/source_map/../${hash}.html`],
    ["source_map", `http://127.0.0.1:4176/local_library_data/notes/paper-01/source_map/${hash}.html`],
    ["source_map", `https://example.org/local_library_data/notes/paper-01/source_map/${hash}.html`],
  ]) {
    assert.equal(resolveSafeControlledPreviewUrl({ candidate: unsafe, slug: "paper-01", kind, baseUrl }), null)
  }
})

test("controlled preview mounting fetches the selected hashed document and keeps legacy fallback", async () => {
  const { mountSafeControlledPreview } = await import("./paper-inspector.mjs")
  const { document } = createRenderDocument()
  document.createTextNode = (value) => {
    const node = new MemoryNode("#text")
    node.textContent = value
    return node
  }
  document.defaultView.DOMParser = class {
    parseFromString() {
      return { body: { childNodes: [] } }
    }
  }
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    return { ok: true, text: async () => "<p>preview</p>" }
  }
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  const selected = controlledPreviewDocument("note", { hashCharacter: "b" })
  await mountSafeControlledPreview({
    document,
    paper: normalizedPaper({ controlled_preview_documents: controlledPreviewDocuments({ note: [selected] }) }),
    kind: "note",
    previewDocument: { ...selected, category: "note" },
    fetchImpl,
    baseUrl,
  })
  const legacyUrl = "../../local_library_data/notes/paper-01/preferred.html"
  await mountSafeControlledPreview({
    document,
    paper: normalizedPaper({
      note_preview_url: legacyUrl,
      controlled_previews: { note: legacyUrl, derivation: null, simulation: null, code_compare: null },
    }),
    kind: "note",
    fetchImpl,
    baseUrl,
  })

  assert.deepEqual(requests, [
    `http://127.0.0.1:4176/local_library_data/notes/paper-01/note/${"b".repeat(64)}.html`,
    "http://127.0.0.1:4176/local_library_data/notes/paper-01/preferred.html",
  ])
})

test("preview image URLs accept only hashed assets for the current paper and origin", async () => {
  const { resolveSafePreviewAssetUrl } = await import("./paper-inspector.mjs")
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  const hash = "a".repeat(64)
  const candidate = `../../local_library_data/notes/paper-01/assets/${hash}.png`
  assert.equal(
    resolveSafePreviewAssetUrl({ candidate, slug: "paper-01", baseUrl }),
    `http://127.0.0.1:4176/local_library_data/notes/paper-01/assets/${hash}.png`,
  )
  assert.equal(
    resolveSafePreviewAssetUrl({
      candidate: `../../local_library_data/sources/paper-01/assets/${hash}.jpg`,
      slug: "paper-01",
      baseUrl,
    }),
    `http://127.0.0.1:4176/local_library_data/sources/paper-01/assets/${hash}.jpg`,
  )
  assert.equal(
    resolveSafePreviewAssetUrl({
      candidate: `http://127.0.0.1:4176/local_library_data/notes/paper-01/assets/${hash}.png`,
      slug: "paper-01",
      baseUrl,
    }),
    `http://127.0.0.1:4176/local_library_data/notes/paper-01/assets/${hash}.png`,
  )

  for (const unsafe of [
    `../../local_library_data/notes/paper-02/assets/${hash}.png`,
    `../../local_library_data/notes/paper-01/assets/${hash}.svg`,
    `../../local_library_data/notes/paper-01/assets/${hash}.png?raw=1`,
    `../../local_library_data/notes/paper-01/assets/${hash}.png#figure`,
    `../../local_library_data/notes/paper-01/assets/../${hash}.png`,
    `https://example.org/local_library_data/notes/paper-01/assets/${hash}.png`,
    localProtocolValue("private", `${hash}.png`),
  ]) {
    assert.equal(resolveSafePreviewAssetUrl({ candidate: unsafe, slug: "paper-01", baseUrl }), null)
  }
})

test("source-document URLs accept only the exact generated PDF or OCR location", async () => {
  const { resolveSafeSourceDocumentUrl } = await import("./paper-inspector.mjs")
  const baseUrl = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
  const hash = "b".repeat(64)
  assert.equal(
    resolveSafeSourceDocumentUrl({
      candidate: `../../local_library_data/sources/paper-01/pdf/${hash}.pdf`,
      slug: "paper-01",
      kind: "pdf",
      baseUrl,
    }),
    `http://127.0.0.1:4176/local_library_data/sources/paper-01/pdf/${hash}.pdf`,
  )
  assert.equal(
    resolveSafeSourceDocumentUrl({
      candidate: `../../local_library_data/sources/paper-01/ocr/${hash}.html`,
      slug: "paper-01",
      kind: "ocr",
      baseUrl,
    }),
    `http://127.0.0.1:4176/local_library_data/sources/paper-01/ocr/${hash}.html`,
  )
  for (const [kind, candidate] of [
    ["pdf", `../../local_library_data/sources/paper-02/pdf/${hash}.pdf`],
    ["pdf", `../../local_library_data/sources/paper-01/pdf/${hash}.html`],
    ["ocr", `../../local_library_data/sources/paper-01/pdf/${hash}.pdf`],
    ["ocr", `../../local_library_data/sources/paper-01/ocr/${hash}.html?raw=1`],
    ["ocr", `../../local_library_data/sources/paper-01/ocr/${hash}.html#page`],
    ["pdf", `../../local_library_data/sources/paper-01/pdf/../${hash}.pdf`],
    ["pdf", `https://example.org/local_library_data/sources/paper-01/pdf/${hash}.pdf`],
    ["pdf", localProtocolValue("private", `${hash}.pdf`)],
  ]) assert.equal(resolveSafeSourceDocumentUrl({ candidate, slug: "paper-01", kind, baseUrl }), null)
})

test("controlled preview failures name the unavailable material", async () => {
  const { controlledPreviewFailureMessage } = await import("./paper-inspector.mjs")
  assert.equal(controlledPreviewFailureMessage("note"), "论文精读预览暂不可用")
  assert.equal(controlledPreviewFailureMessage("derivation"), "推导过程预览暂不可用")
  assert.equal(controlledPreviewFailureMessage("simulation"), "仿真描述预览暂不可用")
  assert.equal(controlledPreviewFailureMessage("code_compare"), "代码对照预览暂不可用")
  assert.equal(controlledPreviewFailureMessage("unknown"), "材料预览暂不可用")
})

test("reader tab keyboard model cycles in fixed order and supports Home and End", async () => {
  const { nextReaderTabKey } = await import("./library.mjs")
  assert.equal(nextReaderTabKey({ current: "note", key: "ArrowRight" }), "derivation")
  assert.equal(nextReaderTabKey({ current: "overview", key: "ArrowLeft" }), "writing")
  assert.equal(nextReaderTabKey({ current: "simulation", key: "ArrowRight" }), "code_compare")
  assert.equal(nextReaderTabKey({ current: "code_compare", key: "ArrowLeft" }), "simulation")
  assert.equal(nextReaderTabKey({ current: "simulation", key: "Home" }), "overview")
  assert.equal(nextReaderTabKey({ current: "note", key: "End" }), "writing")
  assert.equal(nextReaderTabKey({ current: "note", key: "Enter" }), "note")
})

test("note availability remains conservative when no generated preview exists", async () => {
  const { noteAvailabilityMessage } = await import("./paper-inspector.mjs")
  assert.equal(
    noteAvailabilityMessage({
      note_preview_url: null,
      artifacts: { note: [{}, {}] },
      artifact_availability: { note: true },
    }),
    "存在多篇阅读笔记，待选择首选文件",
  )
  assert.equal(
    noteAvailabilityMessage({
      note_preview_url: null,
      artifacts: { note: [{}] },
      artifact_availability: { note: true },
    }),
    "已有阅读笔记；首版尚未生成网页预览",
  )
  assert.equal(
    noteAvailabilityMessage({
      note_preview_url: null,
      artifacts: { note: [] },
      artifact_availability: { note: false },
    }),
    "尚无阅读笔记",
  )
})

test("all three desktop pages route their paper-library actions to the generated page", () => {
  for (const [name, source] of existingPages) {
    assert.match(
      source,
      /<a class="nav-item" href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html"><span aria-hidden="true">▤<\/span><span>[^<]+<\/span><\/a>/u,
      name,
    )
    assert.doesNotMatch(source, /href="(?:\.\/index\.html)?#library"[^>]*>[^<]*(?:<[^>]+>)*论文库/u, name)
  }
  const dashboard = existingPages.find(([name]) => name === "index.html")[1]
  assert.match(dashboard, /href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html">打开论文库 →<\/a>/u)
})

test("paper-library CSS is page-scoped and provides the desktop three-column breakpoints", () => {
  assert.match(styles, /\.library-page \.library-shell\s*\{/u)
  assert.match(styles, /\.library-page \.library-shelf-grid\s*\{/u)
  assert.equal(cssDeclaration(cssRule(".library-page .library-sidebar"), "display"), "flex")
  assert.equal(cssDeclaration(cssRule(".library-page .library-sidebar"), "flex-direction"), "column")
  assert.equal(cssDeclaration(cssRule(".library-page .library-sidebar .sidebar-plan"), "position"), "static")
  assert.equal(cssDeclaration(cssRule(".library-page .library-sidebar .sidebar-plan"), "margin-top"), "auto")
  assert.match(styles, /@media \(max-width: 1320px\)[\s\S]*?\.library-page \.library-shelf-grid/u)
  assert.match(styles, /\.library-page \.library-table-wrap[^}]*overflow-x:\s*auto/u)
  assert.match(styles, /\.library-page \.library-inspector[^}]*overflow-y:\s*auto/u)
  assert.match(styles, /\.library-page \.library-toolbar[^}]*flex-wrap:\s*wrap/u)
  assert.doesNotMatch(styles, /^[ \t]*\.library-toolbar\b/mu)
  assert.match(styles, /\.paper-library-page \.library-note-group\s*\{/u)
  assert.match(styles, /\.paper-library-page \.library-note-group-heading\s*\{/u)
  assert.match(styles, /\.paper-library-page\.library-reader-open \.library-shell\s*\{/u)
  assert.equal(
    cssDeclaration(cssRule(".paper-library-page.library-reader-open.library-reader-toc-hidden .library-shell"), "grid-template-columns"),
    "minmax(0, 1fr)",
  )
  assert.match(styles, /\.paper-library-page \.library-reader-tabs\s*\{/u)
  assert.match(styles, /\.paper-library-page \.library-reader-toc\s*\{/u)
  assert.equal(
    cssDeclaration(cssRule(".paper-library-page .library-reader-tabs"), "grid-template-columns"),
    "repeat(7, minmax(0, 1fr))",
  )
  assert.equal(
    cssDeclaration(cssRule(".paper-library-page.library-reader-open .library-detail:not([hidden])"), "grid-template-rows"),
    "auto auto minmax(0, 1fr)",
  )
  assert.doesNotMatch(styles, /library-reader-simulation-grid|library-reader-preview-card/u)
  assert.match(styles, /\.paper-library-page \.note-table-scroll[^}]*overflow-x:\s*auto/u)
  assert.match(styles, /\.paper-library-page \.math-display[^}]*overflow-x:\s*auto/u)
  assert.doesNotMatch(styles, /^[ \t]*(?:header|section)\b/mu)
})

test("detail reader owns one centered native note-import dialog with no path input", () => {
  for (const id of [
    "library-add-note", "library-index-reload", "library-note-import-dialog",
    "library-note-import-form", "library-note-import-category", "library-note-import-file",
    "library-note-import-checks", "library-note-import-file-name", "library-note-import-close",
    "library-note-import-cancel", "library-note-import-submit",
  ]) assert.equal(countMatches(html, new RegExp(`id="${id}"`, "gu")), 1, id)
  assert.match(html, /library-reader-toolbar[\s\S]*id="library-add-note"[\s\S]*library-reader-tabs/u)
  assert.match(html, /<dialog[^>]*id="library-note-import-dialog"/u)
  assert.doesNotMatch(html, /library-note-import-form[^>]*method="dialog"/u)
  assert.doesNotMatch(html, /note-import[^>]*(?:source-path|target-path|directory)/u)
  assert.match(styles, /\.paper-library-page \.library-note-import-dialog\s*\{[^}]*margin:\s*auto/isu)
  assert.match(styles, /\.paper-library-page \.library-note-import-body\s*\{[^}]*overflow-y:\s*auto/isu)
  assert.doesNotMatch(styles, /^[ \t]*\.library-note-import-dialog\b/mu)
})

test("material selectors reuse compact source-version styling and truncate only the visible long label", () => {
  const control = cssRule(".paper-library-page .library-reader-material-control")
  const select = cssRule(".paper-library-page .library-reader-material-control select")
  assert.equal(cssDeclaration(control, "display"), "flex")
  assert.equal(cssDeclaration(control, "min-width"), "0")
  assert.equal(cssDeclaration(select, "min-height"), "32px")
  assert.equal(cssDeclaration(select, "text-overflow"), "ellipsis")
  assert.equal(cssDeclaration(select, "white-space"), "nowrap")
  assert.match(cssDeclaration(select, "max-width"), /px|%|vw/u)
})

test("facet entries and chips meet desktop wrapping, flow, and 36px target contracts", () => {
  assert.equal(cssDeclaration(cssRule(".library-page .facet-entry-bar"), "grid-template-columns"), "repeat(5, minmax(0, 1fr))")
  assert.equal(cssDeclaration(cssRule(".library-page .facet-entry-bar button"), "min-height"), "36px")
  assert.equal(cssDeclaration(cssRule(".library-page .library-filter-panel .facet-option"), "min-height"), "36px")
  assert.equal(cssDeclaration(cssRule(".library-page .selected-facet-chip button"), "min-height"), "36px")
  assert.equal(cssDeclaration(cssRule(".library-page .facet-panel"), "overflow"), "visible")
  assert.doesNotMatch(styles, /\.library-page \.library-dynamic-filter/u)
  assert.match(styles, /@media \(max-width: 1320px\)[\s\S]*?\.library-page \.facet-entry-bar\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u)
})

test("facet option target height wins the real label cascade without changing material labels", () => {
  const page = { tag: "main", classes: ["library-page"] }
  const filterPanel = { tag: "section", classes: ["library-filter-panel"] }
  const facetOption = { tag: "label", classes: ["facet-option"] }
  const materialOption = { tag: "label", classes: [] }

  assert.equal(cascadedCssDeclaration([page, filterPanel, facetOption], "min-height"), "36px")
  assert.equal(cascadedCssDeclaration([page, filterPanel, materialOption], "min-height"), "24px")
})

test("source PDF frame can shrink inside the 1280 by 720 reader pane", () => {
  const workspace = cssRule(".paper-library-page .library-source-workspace")
  const pdfPane = cssRule(".paper-library-page .library-source-pane--pdf")
  const ocrPane = cssRule(".paper-library-page .library-source-pane--ocr")
  const frame = cssRule(".paper-library-page .library-source-pdf-frame")
  const ocr = cssRule(".paper-library-page .library-source-pane .library-source-ocr-preview")

  assert.equal(cssDeclaration(workspace, "min-height"), "0")
  assert.equal(cssDeclaration(pdfPane, "grid-template-columns"), "minmax(0, 1fr)")
  assert.equal(cssDeclaration(ocrPane, "grid-template-columns"), "minmax(0, 1fr)")
  assert.equal(cssDeclaration(frame, "height"), "100%")
  assert.equal(cssDeclaration(frame, "min-width"), "0")
  assert.equal(cssDeclaration(frame, "max-width"), "100%")
  assert.equal(cssDeclaration(frame, "min-height"), "0")
  assert.equal(cssDeclaration(ocr, "min-width"), "0")
  assert.equal(cssDeclaration(ocr, "max-width"), "100%")
})

test("all inline math avoids scroll containers while display math remains horizontally scrollable", () => {
  const inlineMath = cssRule(".paper-library-page .math-inline")
  assert.equal(cssDeclaration(inlineMath, "display"), "inline")
  assert.equal(cssDeclaration(inlineMath, "overflow"), "visible")

  const displayMath = cssRule('.paper-library-page .math-display[data-math-rendered="true"] > .katex-display')
  assert.equal(cssDeclaration(displayMath, "overflow-x"), "auto")
  assert.equal(cssDeclaration(displayMath, "overflow-y"), "hidden")
})

function task11Candidate(overrides = {}) {
  return {
    paperId: "W4387886124",
    doi: "10.1109/access.2023.3327199",
    title: "Distributed online optimization over directed networks",
    authors: ["Yinghui Wang", "Jiuwei Wang"],
    year: 2023,
    source: "IEEE Access",
    citations: 12,
    isOpenAccess: true,
    openAccessUrl: "https://example.org/open-paper",
    landingPageUrl: "https://openalex.org/W4387886124",
    topics: ["Distributed optimization"],
    abstract: "Discovery text",
    stage: "confirmed_for_archive",
    ...overrides,
  }
}

function task11CandidateStore(candidates, transition = null) {
  let state = { version: 1, candidates: structuredClone(candidates) }
  const marked = []
  return {
    marked,
    read: () => structuredClone(state),
    markMetadataArchived(openAlexId) {
      marked.push(openAlexId)
      if (transition) return transition(openAlexId, structuredClone(state))
      state = {
        version: 1,
        candidates: state.candidates.map((candidate) => (
          candidate.paperId === openAlexId
            ? { ...candidate, stage: "metadata_archived" }
            : candidate
        )),
      }
      return { changed: true, persisted: true, reason: null, state: structuredClone(state) }
    },
  }
}

test("Task 11 RED1 archive and recovery clients send exact protected requests and accept only exact responses", async () => {
  const {
    archiveConfirmedCandidate,
    requestArchiveRebuild,
  } = await import("./library.mjs")
  const candidate = task11Candidate()
  const calls = []
  const archiveResult = await archiveConfirmedCandidate({
    fetchImpl: async (url, options) => {
      calls.push([url, options])
      return localJsonResponse({
        status: "created",
        paper_id: "Wang23-DIO",
        folder_name: "Wang23-DIO",
        rebuild_status: "complete",
        paper_count: 2,
      }, { status: 201 })
    },
    archiveSourceId: "main_papers",
    paperId: "Wang23-DIO",
    candidate,
  })
  assert.deepEqual(archiveResult, {
    status: "created",
    paper_id: "Wang23-DIO",
    folder_name: "Wang23-DIO",
    rebuild_status: "complete",
    paper_count: 2,
  })
  assert.deepEqual(calls[0], [
    "/api/v1/archive/candidates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Research-Console-Action": "archive-candidate",
      },
      body: JSON.stringify({
        version: 1,
        confirmation: "create_metadata_only",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        candidate,
      }),
      cache: "no-store",
      credentials: "same-origin",
    },
  ])

  const recovered = await requestArchiveRebuild({
    fetchImpl: async (url, options) => {
      calls.push([url, options])
      return localJsonResponse({
        status: "recovered",
        paper_id: "Wang23-DIO",
        rebuild_status: "complete",
        paper_count: 2,
      }, { status: 200 })
    },
    archiveSourceId: "main_papers",
    paperId: "Wang23-DIO",
    openAlexId: "W4387886124",
  })
  assert.deepEqual(recovered, {
    status: "recovered",
    paper_id: "Wang23-DIO",
    rebuild_status: "complete",
    paper_count: 2,
  })
  assert.deepEqual(calls[1], [
    "/api/v1/archive/rebuild",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Research-Console-Action": "rebuild-library",
      },
      body: JSON.stringify({
        confirmation: "retry_archive_rebuild",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: "W4387886124",
      }),
      cache: "no-store",
      credentials: "same-origin",
    },
  ])

  let fallbackRequest = null
  await archiveConfirmedCandidate({
    fetchImpl: async (_url, options) => {
      fallbackRequest = JSON.parse(options.body)
      return localJsonResponse({
        status: "created",
        paper_id: "LIB-ABCDEF123456",
        folder_name: "LIB-ABCDEF123456",
        rebuild_status: "failed",
        index_state: "last_good",
        recovery_required: true,
      }, { status: 201 })
    },
    archiveSourceId: "main_papers",
    paperId: "LIB-ABCDEF123456",
    candidate,
  })
  assert.equal(fallbackRequest.paper_id, "LIB-ABCDEF123456")
})

test("Task 11 RED1 clients reject inferred ids, busy writes, malformed bodies, and private locators without leaking raw failures", async () => {
  const { archiveConfirmedCandidate, requestArchiveRebuild } = await import("./library.mjs")
  const candidate = Object.freeze(task11Candidate())
  let fetchCount = 0
  for (const paperId of [undefined, "", candidate.paperId, "Paper01", "../Paper-01", "paper id-01"]) {
    await assert.rejects(
      () => archiveConfirmedCandidate({
        fetchImpl: async () => { fetchCount += 1 },
        archiveSourceId: "main_papers",
        paperId,
        candidate,
      }),
      /论文 ID|请求格式/u,
    )
  }
  assert.equal(fetchCount, 0, "invalid or inferred local ids must fail before fetch")

  let busyError = null
  try {
    await archiveConfirmedCandidate({
      fetchImpl: async () => localJsonResponse({
        error: {
          code: "LIBRARY_WRITE_BUSY",
          message: `private ${rootedValue("Users", "alice", "papers")}`,
          source_path: rootedValue("Users", "alice", "papers"),
        },
      }, { ok: false, status: 409 }),
      archiveSourceId: "main_papers",
      paperId: "Wang23-DIO",
      candidate,
    })
  } catch (error) {
    busyError = error
  }
  assert.ok(busyError)
  assert.match(busyError.message, /正在执行|稍后|冲突/u)
  assert.doesNotMatch(String(busyError.message), /alice|Users|source_path|private/iu)
  assert.equal(candidate.stage, "confirmed_for_archive")

  const malformedResponses = [
    { status: 201, payload: { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO", rebuild_status: "complete" } },
    { status: 201, payload: { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO", rebuild_status: "complete", paper_count: 2, extra: true } },
    { status: 201, payload: { status: "created", paper_id: "Other-01", folder_name: "Other-01", rebuild_status: "complete", paper_count: 2 } },
    { status: 201, payload: { status: "created", paper_id: "Wang23-DIO", folder_name: rootedValue("Users", "alice", "papers"), rebuild_status: "complete", paper_count: 2 } },
    { status: 200, payload: { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO", rebuild_status: "complete", paper_count: 2 } },
  ]
  for (const { status, payload } of malformedResponses) {
    let caught = null
    try {
      await archiveConfirmedCandidate({
        fetchImpl: async () => localJsonResponse(payload, { status }),
        archiveSourceId: "main_papers",
        paperId: "Wang23-DIO",
        candidate,
      })
    } catch (error) {
      caught = error
    }
    assert.ok(caught)
    assert.match(caught.message, /响应格式无效/u)
    assert.doesNotMatch(String(caught.message), /alice|Users|Other-01|extra/iu)
  }

  await assert.rejects(
    () => requestArchiveRebuild({
      fetchImpl: async () => localJsonResponse({
        status: "recovered", paper_id: "Other-01", rebuild_status: "complete", paper_count: 2,
      }),
      archiveSourceId: "main_papers",
      paperId: "Wang23-DIO",
      openAlexId: "W4387886124",
    }),
    /响应格式无效/u,
  )
})

test("Task 11 RED1 fresh-index marking requires one returned-id DOI or DOI-less OpenAlex identity match", async () => {
  const { markCandidateArchivedAfterIndexRefresh } = await import("./library.mjs")
  const doiCandidate = task11Candidate()
  const doiStore = task11CandidateStore([doiCandidate])
  const doiIndex = {
    papers: [normalizedPaper({
      paper_id: "Wang23-DIO",
      doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199",
    })],
  }
  assert.equal(markCandidateArchivedAfterIndexRefresh({
    candidateStore: doiStore,
    paperIndex: doiIndex,
    localPaperId: "Wang23-DIO",
    openAlexId: doiCandidate.paperId,
  }), true)
  assert.deepEqual(doiStore.marked, [doiCandidate.paperId])

  const doiFailures = [
    { name: "missing DOI never falls back", papers: [normalizedPaper({ paper_id: "Wang23-DIO", doi_or_url: "https://openalex.org/W4387886124" })] },
    { name: "duplicate DOI", papers: [
      normalizedPaper({ paper_id: "Wang23-DIO", doi_or_url: "https://doi.org/10.1109/access.2023.3327199" }),
      normalizedPaper({ paper_id: "Other-01", doi_or_url: "10.1109/access.2023.3327199" }),
    ] },
    { name: "conflicting local id", papers: [
      normalizedPaper({ paper_id: "Other-01", doi_or_url: "10.1109/access.2023.3327199" }),
      normalizedPaper({ paper_id: "Wang23-DIO", doi_or_url: "https://openalex.org/W4387886124" }),
    ] },
  ]
  for (const fixture of doiFailures) {
    const store = task11CandidateStore([doiCandidate])
    assert.equal(markCandidateArchivedAfterIndexRefresh({
      candidateStore: store,
      paperIndex: { papers: fixture.papers },
      localPaperId: "Wang23-DIO",
      openAlexId: doiCandidate.paperId,
    }), false, fixture.name)
    assert.deepEqual(store.marked, [], fixture.name)
  }

  const openAlexCandidate = task11Candidate({ doi: null, paperId: "W987654321" })
  const openAlexStore = task11CandidateStore([openAlexCandidate])
  assert.equal(markCandidateArchivedAfterIndexRefresh({
    candidateStore: openAlexStore,
    paperIndex: { papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://openalex.org/W987654321" })] },
    localPaperId: "Local-OpenAlex",
    openAlexId: openAlexCandidate.paperId,
  }), true)
  assert.deepEqual(openAlexStore.marked, [openAlexCandidate.paperId])

  const openAlexFailures = [
    { name: "missing", papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://example.org/paper" })] },
    { name: "duplicate", papers: [
      normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://openalex.org/W987654321" }),
      normalizedPaper({ paper_id: "Other-01", doi_or_url: "https://openalex.org/W987654321" }),
    ] },
    { name: "trailing slash is not canonical", papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://openalex.org/W987654321/" })] },
    { name: "surrounding whitespace is not canonical", papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: " https://openalex.org/W987654321 " })] },
    { name: "API works URL is not the public canonical identity", papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://api.openalex.org/works/W987654321" })] },
    { name: "lowercase work id is not canonical", papers: [normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://openalex.org/w987654321" })] },
    { name: "conflicting local id", papers: [normalizedPaper({ paper_id: "Other-01", doi_or_url: "https://openalex.org/W987654321" })] },
    { name: "direct W id equality", localPaperId: "W987654321", papers: [normalizedPaper({ paper_id: "W987654321", doi_or_url: "https://example.org/not-openalex" })] },
    { name: "title author year guess", papers: [normalizedPaper({
      paper_id: "Local-OpenAlex",
      doi_or_url: "https://example.org/not-openalex",
      title_original: openAlexCandidate.title,
      authors: openAlexCandidate.authors,
      publication_year: openAlexCandidate.year,
      year: openAlexCandidate.year,
    })] },
  ]
  for (const fixture of openAlexFailures) {
    const store = task11CandidateStore([openAlexCandidate])
    assert.equal(markCandidateArchivedAfterIndexRefresh({
      candidateStore: store,
      paperIndex: { papers: fixture.papers },
      localPaperId: fixture.localPaperId ?? "Local-OpenAlex",
      openAlexId: openAlexCandidate.paperId,
    }), false, fixture.name)
    assert.deepEqual(store.marked, [], fixture.name)
  }

  const failedStore = task11CandidateStore([doiCandidate], () => ({
    changed: false,
    persisted: false,
    reason: "persistence_failed",
    state: { version: 1, candidates: [doiCandidate] },
  }))
  assert.throws(() => markCandidateArchivedAfterIndexRefresh({
    candidateStore: failedStore,
    paperIndex: doiIndex,
    localPaperId: "Wang23-DIO",
    openAlexId: doiCandidate.paperId,
  }), /候选状态|保存/u)
})

test("Task 11 RED1 reload reconciliation advances only confirmed candidates with a unique strict identity", async () => {
  const { reconcileArchivedCandidates } = await import("./library.mjs")
  const candidates = [
    task11Candidate({ paperId: "W100", doi: "10.1000/unique" }),
    task11Candidate({ paperId: "W200", doi: null }),
    task11Candidate({ paperId: "W300", doi: "10.1000/missing" }),
    task11Candidate({ paperId: "W400", doi: "10.1000/duplicate" }),
    task11Candidate({ paperId: "W500", doi: null }),
    task11Candidate({ paperId: "W600", doi: "10.1000/already", stage: "metadata_archived" }),
    task11Candidate({ paperId: "W700", doi: "10.1000/pending", stage: "pending_screening" }),
  ]
  const store = task11CandidateStore(candidates)
  const result = reconcileArchivedCandidates({
    candidateStore: store,
    paperIndex: {
      papers: [
        normalizedPaper({ paper_id: "Local-Doi", doi_or_url: "https://doi.org/10.1000/UNIQUE" }),
        normalizedPaper({ paper_id: "Local-OpenAlex", doi_or_url: "https://openalex.org/W200" }),
        normalizedPaper({ paper_id: "Duplicate-01", doi_or_url: "10.1000/duplicate" }),
        normalizedPaper({ paper_id: "Duplicate-02", doi_or_url: "https://doi.org/10.1000/duplicate" }),
        normalizedPaper({ paper_id: "W500", doi_or_url: "https://example.org/not-openalex" }),
        normalizedPaper({ paper_id: "Local-Already", doi_or_url: "10.1000/already" }),
        normalizedPaper({ paper_id: "Local-Pending", doi_or_url: "10.1000/pending" }),
      ],
    },
  })
  assert.deepEqual(store.marked, ["W100", "W200"])
  assert.deepEqual(result, { archived: ["W100", "W200"], unchanged: ["W300", "W400", "W500"] })
})

test("Task 11 RED2 direct archive helpers reject private, credential-bearing, noncanonical, and accessor candidates before fetch", async () => {
  const { archiveConfirmedCandidate } = await import("./library.mjs")
  const accessorAuthors = []
  Object.defineProperty(accessorAuthors, "0", { enumerable: true, get: () => "Author" })
  accessorAuthors.length = 1
  const invalidCandidates = [
    task11Candidate({ openAccessUrl: "https://10.0.0.1/private-paper" }),
    task11Candidate({ landingPageUrl: "https://example.org/paper?access_token=sensitive" }),
    task11Candidate({ title: "Distributed  online optimization" }),
    task11Candidate({ authors: accessorAuthors }),
    task11Candidate({ paperId: `W${"1".repeat(101)}` }),
    task11Candidate({ doi: `10.1234/${"a".repeat(256)}` }),
  ]
  let fetchCount = 0
  for (const candidate of invalidCandidates) {
    await assert.rejects(() => archiveConfirmedCandidate({
      fetchImpl: async () => { fetchCount += 1 },
      archiveSourceId: "main_papers",
      paperId: "Wang23-DIO",
      candidate,
    }), /候选归档请求格式无效/u)
  }
  assert.equal(fetchCount, 0)
})

test("Task 11 RED2 capability validator accepts manual archive only as the exact fixed blocking state", async () => {
  const { loadLocalLibraryCapabilities } = await import("./library.mjs")
  const manualArchive = finalLocalCapabilities({
    note_import: false,
    candidate_archive: false,
    archive_rebuild: false,
    archive_source_id: null,
    recovery: {
      required: true,
      kind: "manual_archive",
      reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
  })
  assert.deepEqual(await loadLocalLibraryCapabilities(async () => localJsonResponse(manualArchive)), manualArchive)
  for (const invalid of [
    { ...manualArchive, archive_rebuild: true },
    { ...manualArchive, archive_source_id: "main_papers" },
    { ...manualArchive, recovery: { ...manualArchive.recovery, reason_code: "ROLLBACK_FAILED" } },
    { ...manualArchive, recovery: { ...manualArchive.recovery, paper_id: "Paper-01" } },
  ]) {
    await assert.rejects(
      () => loadLocalLibraryCapabilities(async () => localJsonResponse(invalid)),
      /响应格式无效/u,
    )
  }
})

test("Task 11 RED3 manual note capabilities require a null top-level archive source", async () => {
  const { loadLocalLibraryCapabilities } = await import("./library.mjs")
  const manualNote = finalLocalCapabilities({
    note_import: false,
    candidate_archive: false,
    archive_rebuild: false,
    archive_source_id: null,
    recovery: {
      required: true,
      kind: "manual_note",
      reason_code: "ROLLBACK_FAILED",
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
  })
  assert.deepEqual(await loadLocalLibraryCapabilities(async () => localJsonResponse(manualNote)), manualNote)
  await assert.rejects(
    () => loadLocalLibraryCapabilities(async () => localJsonResponse({
      ...manualNote,
      archive_source_id: "main_papers",
    })),
    /响应格式无效/u,
  )
})

test("Task 11 RED2 library template provides one quiet recovery banner and candidate-only rebuild action", () => {
  assert.equal(countMatches(html, /data-library-recovery-banner(?:=|\s|>)/gu), 1)
  assert.equal(countMatches(html, /data-library-recovery-message(?:=|\s|>)/gu), 1)
  assert.equal(countMatches(html, /data-library-recovery-tuple(?:=|\s|>)/gu), 1)
  assert.equal(countMatches(html, /data-library-recovery-status(?:=|\s|>)/gu), 1)
  assert.equal(countMatches(html, /id="library-archive-rebuild"/gu), 1)
  assert.match(html, /data-library-recovery-banner[^>]*role="status"[^>]*hidden/u)
  assert.match(styles, /\.paper-library-page \.library-recovery-banner\s*\{/u)
})

test("Task 11 RED2 library candidate recovery keeps browsing available and reloads before reconciling browser state", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const candidate = task11Candidate()
  const candidateStore = task11CandidateStore([candidate])
  const recoveryCapabilities = finalLocalCapabilities({
    note_import: false,
    candidate_archive: false,
    archive_rebuild: true,
    archive_source_id: "main_papers",
    recovery: {
      required: true,
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: candidate.paperId,
    },
  })
  const normalCapabilities = finalLocalCapabilities()
  let capabilityReads = 0
  let indexReads = 0
  const calls = []
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    candidateStore,
    fetchImpl: async (url, options = {}) => {
      calls.push([url, options])
      if (url === "/api/v1/capabilities") {
        capabilityReads += 1
        return localJsonResponse(capabilityReads === 1 ? recoveryCapabilities : normalCapabilities)
      }
      if (url === "/api/v1/archive/rebuild") return localJsonResponse({
        status: "recovered",
        paper_id: "Wang23-DIO",
        rebuild_status: "complete",
        paper_count: 1,
      })
      if (url.endsWith("paper-index.json")) {
        indexReads += 1
        return localJsonResponse(indexReads === 1
          ? v3Index([normalizedPaper()])
          : v3Index([normalizedPaper({
              paper_id: "Wang23-DIO",
              slug: "wang23-dio",
              doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199",
            })]))
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
  assert.equal(ui.recoveryBanner.hidden, false)
  assert.match(ui.recoveryMessage.textContent, /论文库索引重建失败/u)
  assert.match(ui.recoveryTuple.textContent, /main_papers/u)
  assert.match(ui.recoveryTuple.textContent, /Wang23-DIO/u)
  assert.match(ui.recoveryTuple.textContent, /W4387886124/u)
  assert.equal(ui.recoveryAction.hidden, false)
  assert.equal(ui.recoveryAction.disabled, false)
  assert.equal(ui.addNote.disabled, true)
  assert.match(ui.count.textContent, /显示 1 篇，共 1 篇/u)
  ui.recoveryAction.click()
  await settleControllerEvents()
  assert.equal(indexReads, 2)
  assert.deepEqual(candidateStore.marked, [candidate.paperId])
  assert.equal(capabilityReads, 2, "successful recovery must re-read capabilities")
  assert.equal(ui.recoveryBanner.hidden, false, "the current session keeps a neutral recovery result")
  assert.match(ui.recoveryMessage.textContent, /元数据归档完成/u)
  assert.equal(ui.recoveryAction.hidden, true)
  assert.equal(ui.addNote.disabled, false, "normal server capabilities must restore eligible writes")
  const rebuildCall = calls.find(([url]) => url === "/api/v1/archive/rebuild")
  assert.deepEqual(JSON.parse(rebuildCall[1].body), {
    confirmation: "retry_archive_rebuild",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: candidate.paperId,
  })
})

test("Task 11 RED4 library treats exact rebuild 200 as final when index or candidate reconciliation fails", async (t) => {
  const { createLibraryController } = await import("./library.mjs")
  const fixedNotice = "恢复已完成，但新索引或本地候选状态尚未核对。"
  const scenarios = [
    { name: "fresh index fails", indexFails: true, transition: null },
    {
      name: "candidate persistence is rejected",
      indexFails: false,
      transition: () => ({ changed: false, persisted: false, reason: "persistence_failed" }),
    },
    {
      name: "candidate persistence throws",
      indexFails: false,
      transition: () => { throw new Error("local storage unavailable") },
    },
  ]

  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const ui = createNoteImportControllerDocument()
    const candidate = task11Candidate()
    const candidateStore = task11CandidateStore([candidate], scenario.transition)
    let capabilityReads = 0
    let indexReads = 0
    let rebuildCalls = 0
    const recoveryCapabilities = finalLocalCapabilities({
      note_import: false,
      candidate_archive: false,
      archive_rebuild: true,
      archive_source_id: "main_papers",
      recovery: {
        required: true,
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: candidate.paperId,
      },
    })
    const controller = createLibraryController({
      document: ui.document,
      storage: memoryStorage(),
      candidateStore,
      fetchImpl: async (url) => {
        if (url === "/api/v1/capabilities") {
          capabilityReads += 1
          return localJsonResponse(capabilityReads === 1 ? recoveryCapabilities : finalLocalCapabilities())
        }
        if (url === "/api/v1/archive/rebuild") {
          rebuildCalls += 1
          return localJsonResponse({
            status: "recovered",
            paper_id: "Wang23-DIO",
            rebuild_status: "complete",
            paper_count: 1,
          })
        }
        if (url.endsWith("paper-index.json")) {
          indexReads += 1
          if (indexReads === 2 && scenario.indexFails) throw new Error("invalid fresh index")
          return localJsonResponse(indexReads === 1
            ? v3Index()
            : v3Index([normalizedPaper({
                paper_id: "Wang23-DIO",
                slug: "wang23-dio",
                doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199",
              })]))
        }
        throw new Error(`unexpected ${url}`)
      },
    })

    assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
    const oldRebuild = ui.recoveryAction
    oldRebuild.click()
    await settleControllerEvents()

    assert.equal(rebuildCalls, 1)
    assert.equal(capabilityReads, 2, "post-200 verification failure must still refresh capabilities")
    assert.equal(candidateStore.read().candidates[0].stage, "confirmed_for_archive")
    assert.equal(ui.recoveryBanner.hidden, false)
    assert.equal(ui.recoveryMessage.textContent, fixedNotice)
    assert.equal(ui.recoveryTuple.hidden, true)
    assert.equal(ui.recoveryAction.hidden, true)
    assert.doesNotMatch(ui.recoveryBanner.textContent, /恢复未完成|正在重建/u)
    assert.equal(ui.addNote.disabled, false, "normal capabilities must re-enable eligible writes")
    assert.match(ui.count.textContent, /显示 1 篇，共 1 篇/u, "last-good browsing remains available")
    oldRebuild.click()
    await settleControllerEvents()
    assert.equal(rebuildCalls, 1, "the consumed recovery tuple must never be retried")
  })
})

test("Task 11 RED2 both manual recovery variants are fixed read-only library banners with no action", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const manualStates = [
    ["manual_note", "ROLLBACK_FAILED", "笔记导入需要人工恢复"],
    ["manual_archive", "ARCHIVE_TRANSACTION_AMBIGUOUS", "候选归档事务状态不明确"],
  ]
  for (const [kind, reasonCode, message] of manualStates) {
    const ui = createNoteImportControllerDocument()
    const controller = createLibraryController({
      document: ui.document,
      storage: memoryStorage(),
      candidateStore: task11CandidateStore([]),
      fetchImpl: async (url) => {
        if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
        return localJsonResponse(finalLocalCapabilities({
          note_import: false,
          candidate_archive: false,
          archive_rebuild: false,
          archive_source_id: null,
          recovery: {
            required: true,
            kind,
            reason_code: reasonCode,
            archive_source_id: null,
            paper_id: null,
            openalex_id: null,
          },
        }))
      },
    })
    assert.deepEqual(await controller.start(), { ok: true, paperCount: 1 })
    assert.equal(ui.recoveryBanner.hidden, false, kind)
    assert.match(ui.recoveryMessage.textContent, new RegExp(message, "u"), kind)
    assert.equal(ui.recoveryAction.hidden, true, kind)
    assert.equal(ui.addNote.disabled, true, kind)
    assert.match(ui.count.textContent, /显示 1 篇，共 1 篇/u)
  }
})

test("Task 11 RED3 note import 500 refreshes capabilities into fixed manual recovery and disables writes", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  let capabilityReads = 0
  const manualNote = finalLocalCapabilities({
    note_import: false,
    candidate_archive: false,
    archive_rebuild: false,
    archive_source_id: null,
    recovery: {
      required: true,
      kind: "manual_note",
      reason_code: "ROLLBACK_FAILED",
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
  })
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") {
        capabilityReads += 1
        return localJsonResponse(capabilityReads === 1 ? finalLocalCapabilities() : manualNote)
      }
      if (url.endsWith("paper-index.json")) return localJsonResponse(v3Index())
      if (url === "/api/v1/notes/inspect") return localJsonResponse(noteInspection())
      if (url === "/api/v1/notes/import") return localJsonResponse({
        error: {
          code: "ROLLBACK_FAILED",
          message: `${rootedValue("Users", "alice", "private")} raw rollback failure`,
          file_name: rootedValue("Users", "alice", "private", "note.md"),
          raw_body: "do not render",
        },
      }, { ok: false, status: 500 })
      throw new Error(`unexpected ${url}`)
    },
  })

  await controller.start()
  ui.results.querySelector('[data-action="open-detail"]').click()
  ui.addNote.click()
  ui.noteFile.files = [markdownFile("local.md", "# 论文精读")]
  ui.noteFile.dispatch("change")
  await settleControllerEvents()
  assert.equal(ui.noteSubmit.disabled, false)
  ui.noteForm.dispatch("submit")
  await settleControllerEvents()

  assert.equal(capabilityReads, 2, "a failed write can change server recovery state")
  assert.equal(ui.recoveryBanner.hidden, false)
  assert.match(ui.recoveryMessage.textContent, /笔记导入需要人工恢复/u)
  assert.equal(ui.recoveryAction.hidden, true)
  assert.equal(ui.addNote.disabled, true)
  assert.equal(ui.noteSubmit.disabled, true)
  assert.doesNotMatch(
    ui.recoveryBanner.textContent + ui.noteDialog.textContent,
    /Users|alice|private|raw rollback|raw_body|do not render/iu,
  )
})

test("Task 11 RED2 recovery can finish truthfully when no browser candidate exists", async () => {
  const { createLibraryController } = await import("./library.mjs")
  const ui = createNoteImportControllerDocument()
  const candidateStore = task11CandidateStore([])
  let capabilityReads = 0
  let indexReads = 0
  const controller = createLibraryController({
    document: ui.document,
    storage: memoryStorage(),
    candidateStore,
    fetchImpl: async (url) => {
      if (url.endsWith("paper-index.json")) {
        indexReads += 1
        return localJsonResponse(v3Index())
      }
      if (url === "/api/v1/archive/rebuild") return localJsonResponse({
        status: "recovered", paper_id: "Wang23-DIO", rebuild_status: "complete", paper_count: 1,
      })
      capabilityReads += 1
      return localJsonResponse(capabilityReads === 1
        ? finalLocalCapabilities({
            note_import: false,
            candidate_archive: false,
            archive_rebuild: true,
            archive_source_id: "main_papers",
            recovery: {
              required: true,
              kind: "candidate_archive",
              reason_code: "ARCHIVE_REBUILD_FAILED",
              archive_source_id: "main_papers",
              paper_id: "Wang23-DIO",
              openalex_id: "W4387886124",
            },
          })
        : finalLocalCapabilities())
    },
  })
  await controller.start()
  ui.recoveryAction.click()
  await settleControllerEvents()
  assert.equal(indexReads, 2)
  assert.deepEqual(candidateStore.marked, [])
  assert.equal(capabilityReads, 2)
  assert.equal(ui.recoveryBanner.hidden, false)
  assert.match(ui.recoveryMessage.textContent, /未找到本地候选|未更改本地候选/u)
  assert.doesNotMatch(ui.recoveryMessage.textContent, /元数据归档完成/u)
  assert.equal(ui.recoveryAction.hidden, true)
})
