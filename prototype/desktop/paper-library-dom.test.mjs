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
      preventDefault: () => {},
    }
    for (let node = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(type) ?? []) listener(event)
    }
    return event
  }

  click() {
    this.dispatch("click")
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node
    return null
  }

  reset() {
    for (const input of this.querySelectorAll("input")) input.checked = false
  }

  matches(selector) {
    if (selector === "input") return this.tagName === "INPUT"
    if (selector === "input:not(:disabled)") return this.tagName === "INPUT" && !this.disabled
    if (selector.startsWith(".")) return this.className.split(/\s+/u).includes(selector.slice(1))
    const dataMatch = /^\[data-([a-z-]+)(?:="([^"]+)")?\]$/u.exec(selector)
    if (!dataMatch) return false
    const key = camelDataName(dataMatch[1])
    return Object.hasOwn(this.dataset, key) && (dataMatch[2] === undefined || this.dataset[key] === dataMatch[2])
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
  }
  for (const node of [form, search, reset, count, panel, selected, document.body, ...triggers]) node.ownerDocument = document
  return { document, form, search, reset, count, panel, selected, triggers }
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

function validFacetSchema() {
  return {
    version: 1,
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
  return { version: 2, facet_schema: validFacetSchema(), warning_count: 0, papers }
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

test("library template links only the approved runtime assets and three prototype destinations", () => {
  assert.match(html, /href="\.\/assets\/styles\.css\?v=[a-z0-9._-]+"/u)
  assert.match(html, /src="\.\/assets\/library\.mjs"/u)
  for (const destination of [
    "../../prototype/desktop/index.html",
    "../../prototype/desktop/directions.html",
    "../../prototype/desktop/p02.html",
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
    },
    source_terms: ["Tracking-ADMM", "Proximal Subgradient"],
  })
  const root = renderInspector({ document, paper, workspaceState: {}, facetSchema: validFacetSchema() })
  assert.deepEqual(
    root.querySelectorAll("[data-profile-path]").map((node) => node.dataset.profilePath),
    facetGroups.map(([, path]) => path),
  )
  const consistency = root.querySelector('[data-profile-path="constraints.consistency"]')
  const results = root.querySelector('[data-profile-path="results"]')
  assert.match(consistency.textContent, /节点关系待核验/u)
  assert.match(results.textContent, /理论结果待核验/u)
  assert.match(root.textContent, /论文研究画像/u)
  assert.match(root.textContent, /原文术语与算法名称Tracking-ADMMProximal Subgradient/u)
  assert.equal(root.querySelectorAll("[data-source-terms]").length, 1)
  assert.equal(root.querySelectorAll("[data-filter-path]").length, 0)
  assert.equal(root.querySelectorAll('[data-action="set-reading"]').length, 3)
  assert.equal(root.querySelectorAll('[data-action="toggle-shelf"]').length, 4)
  assert.equal(root.querySelectorAll('[data-action="copy-private-path"]').length, 1)
})

test("facet UI and inspector never assign uncontrolled innerHTML", () => {
  assert.doesNotMatch(`${librarySource}\n${inspectorSource}`, /\.innerHTML\s*=/u)
})

test("window bar exposes inert status ornaments instead of dead buttons", () => {
  assert.doesNotMatch(html, /<button[^>]*(?:aria-label="论文库说明"|aria-label="用户菜单")/u)
  assert.match(html, /<span class="icon-button"[^>]*aria-hidden="true"/u)
  assert.match(html, /<span class="avatar-button"[^>]*aria-label="当前用户：杨"/u)
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

test("loadPaperIndex accepts only a version-2 schema-driven index and keeps warning uncertainty explicit", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const payload = { ...v2Index(), warning_count: 3 }
  const loaded = await loadPaperIndex(async (url, options) => {
    assert.equal(url, "../../local_library_data/paper-index.json")
    assert.deepEqual(options, { cache: "no-store" })
    return { ok: true, json: async () => payload }
  })
  assert.deepEqual(loaded, payload)

  for (const warningCount of [undefined, -1, 1.5, "0"]) {
    const uncertain = await loadPaperIndex(async () => ({
      ok: true,
      json: async () => ({ ...v2Index([]), warning_count: warningCount }),
    }))
    assert.equal(uncertain.warning_count, null)
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
      /<a class="nav-item" href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html"><span aria-hidden="true">▤<\/span><span>论文库<\/span><\/a>/u,
      name,
    )
    assert.doesNotMatch(source, /href="(?:\.\/index\.html)?#library"[^>]*>[^<]*(?:<[^>]+>)*论文库/u, name)
  }
  const dashboard = existingPages.find(([name]) => name === "index.html")[1]
  assert.match(dashboard, /href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html">查看全部论文 →<\/a>/u)
})

test("paper-library CSS is page-scoped and provides the desktop three-column breakpoints", () => {
  assert.match(styles, /\.library-page \.library-shell\s*\{/u)
  assert.match(styles, /\.library-page \.library-shelf-grid\s*\{/u)
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
