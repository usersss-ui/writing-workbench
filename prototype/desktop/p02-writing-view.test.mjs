import assert from "node:assert/strict"
import test from "node:test"

import { P02_WRITING_DATA } from "./p02-writing-data.mjs"
import { buildP02WritingView, initializeP02Writing } from "./p02-writing.mjs"
import * as writing from "./p02-writing.mjs"
import { createEmptyP02WorkflowState, createP02WorkflowStore, P02_WORKFLOW_STORAGE_KEY } from "./p02-workflow.mjs"

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.className = ""
    this.dataset = {}
    this.attributes = new Map()
    this._text = ""
    this.value = ""
    this.listeners = new Map()
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("")
  }

  set innerHTML(_value) {
    throw new Error("innerHTML must not be used")
  }

  append(...children) {
    this.children.push(...children)
  }

  replaceChildren(...children) {
    this._text = ""
    this.children = [...children]
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener)
  }

  get href() {
    return this.attributes.get("href") ?? ""
  }

  set href(value) {
    if (value.startsWith("../../local_library_output/desktop/library.html?paper_id=")) {
      this.attributes.set("href", value)
      return
    }
    const url = new URL(value)
    if (url.protocol !== "https:") throw new Error("only HTTPS links are allowed")
    this.attributes.set("href", value)
  }
}

function createStorage(state) {
  const values = new Map(state ? [[P02_WORKFLOW_STORAGE_KEY, JSON.stringify(state)]] : [])
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

test("the current writing view uses saved user materials and does not select the historical journal", () => {
  assert.equal(typeof writing.buildCurrentWritingView, "function")
  const state = createEmptyP02WorkflowState()
  state.algorithm.research_objective = "用户自己的目标"
  state.writing.target_venue = "用户选择的期刊"
  state.writing.theory_section = "已有证明草稿"
  const view = writing.buildCurrentWritingView(state)
  assert.equal(view.targetVenue, "用户选择的期刊")
  assert.match(view.materials[0].body, /用户自己的目标/u)
  assert.equal(view.draft.theory_section, "已有证明草稿")
  const empty = writing.buildCurrentWritingView(createEmptyP02WorkflowState())
  assert.equal(empty.targetVenue, "尚未选择期刊")
  assert.doesNotMatch(JSON.stringify(empty), /P02_ET_ZO|TCNS/u)
})

test("writing can be saved before stage confirmation and preserves all upstream material", () => {
  assert.equal(typeof writing.saveCurrentWritingDraft, "function")
  const initial = createEmptyP02WorkflowState()
  initial.algorithm.research_objective = "保留我的研究方向"
  const storage = createStorage(initial)
  const store = createP02WorkflowStore(storage)
  const result = writing.saveCurrentWritingDraft(store, initial.writing, {
    target_venue: "自选期刊", problem_algorithm: "# 自己写的段落\n\n$x_{k+1}$  ",
  })
  assert.equal(result.persisted, true)
  const saved = createP02WorkflowStore(storage).read()
  assert.equal(saved.writing.problem_algorithm, "# 自己写的段落\n\n$x_{k+1}$  ")
  assert.equal(saved.writing.target_venue, "自选期刊")
  assert.deepEqual(saved.algorithm, initial.algorithm)
  assert.deepEqual(saved.accepted_stages, [])
  assert.deepEqual(saved.paper_roles, initial.paper_roles)
})

test("saving a draft merges fresh upstream changes and refuses a changed draft from another tab", () => {
  assert.equal(typeof writing.saveCurrentWritingDraft, "function")
  const initial = createEmptyP02WorkflowState()
  const storage = createStorage(initial)
  const store = createP02WorkflowStore(storage)
  const fresh = structuredClone(initial)
  fresh.algorithm.research_objective = "另一个页面保存的方向"
  storage.setItem(P02_WORKFLOW_STORAGE_KEY, JSON.stringify(fresh))
  assert.equal(writing.saveCurrentWritingDraft(store, initial.writing, { theory_section: "我的草稿" }).persisted, true)
  assert.equal(createP02WorkflowStore(storage).read().algorithm.research_objective, "另一个页面保存的方向")
  const before = storage.getItem(P02_WORKFLOW_STORAGE_KEY)
  const conflict = writing.saveCurrentWritingDraft(store, initial.writing, { theory_section: "过时页面的草稿" })
  assert.equal(conflict.persisted, false)
  assert.equal(conflict.reason, "stale_current")
  assert.equal(storage.getItem(P02_WORKFLOW_STORAGE_KEY), before)
})

test("invalid saved state and invalid writing input cannot replace existing research", () => {
  assert.equal(typeof writing.saveCurrentWritingDraft, "function")
  const initial = createEmptyP02WorkflowState()
  const storage = createStorage(initial)
  const store = createP02WorkflowStore(storage)
  assert.throws(() => writing.saveCurrentWritingDraft(store, initial.writing, { problem_algorithm: "x".repeat(12001) }), TypeError)
  assert.deepEqual(createP02WorkflowStore(storage).read(), initial)
  storage.setItem(P02_WORKFLOW_STORAGE_KEY, "unreadable original record")
  const result = writing.saveCurrentWritingDraft(store, initial.writing, { target_venue: "任意期刊" })
  assert.equal(result.persisted, false)
  assert.equal(storage.getItem(P02_WORKFLOW_STORAGE_KEY), "unreadable original record")
})

test("Markdown export includes current editor text and research notes without importing the historical project", () => {
  assert.equal(typeof writing.exportCurrentWritingMarkdown, "function")
  const state = createEmptyP02WorkflowState()
  state.algorithm.research_objective = "当前研究问题"
  state.theory_analysis.proof_gaps = "缺少引理二证明"
  state.writing.target_venue = "我的候选期刊"
  state.writing.venue_references = "我的参考样本"
  state.writing.theory_section = "尚未保存的编辑文字\n\n$$a+b$$"
  state.paper_roles.related_work = ["Xi18-ADDOPT"]
  const exported = writing.exportCurrentWritingMarkdown(state)
  assert.match(exported, /当前研究问题/u)
  assert.match(exported, /缺少引理二证明/u)
  assert.match(exported, /我的候选期刊/u)
  assert.match(exported, /我的参考样本/u)
  assert.match(exported, /尚未保存的编辑文字\n\n\$\$a\+b\$\$/u)
  assert.match(exported, /Xi18-ADDOPT/u)
  assert.doesNotMatch(exported, /P02_ET_ZO|TCNS/u)
})

function createWritingDocument({ current = false } = {}) {
  const selectors = [
    "#submission-label",
    "#manuscript-title",
    "#manuscript-summary",
    "#traceability-summary",
    "#target-venue-name",
    "#target-venue-fit",
    "#target-venue-links",
    "#cross-venue-evidence",
    "#in-venue-style-samples",
    "#writing-materials",
    "#claim-summary",
    "#submission-blockers",
  ]
  if (current) selectors.push(
    "#current-writing-form", "#current-target-venue", "#current-research-status", "#current-writing-materials",
    "#current-writing-direction", "#current-writing-sources", "#current-writing-message", "#export-current-writing",
    "#writing-target_venue", "#writing-venue_references", "#writing-problem_algorithm", "#writing-theory_section", "#writing-experiment_section",
  )
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement("div")]))
  return {
    elements,
    createElement(tagName) { return new FakeElement(tagName) },
    querySelector(selector) { return elements.get(selector) ?? null },
  }
}

test("the editor loads the shared draft, saves edits, and exports unsaved text without replacing saved content", () => {
  const state = createEmptyP02WorkflowState()
  state.writing.target_venue = "原有候选期刊"
  state.writing.theory_section = "保存过的正文"
  state.algorithm.research_objective = "我的原有问题"
  const storage = createStorage(state)
  const documentRef = createWritingDocument({ current: true })
  const downloads = []
  initializeP02Writing({ document: documentRef, data: P02_WRITING_DATA, storage, download: (content) => downloads.push(content) })

  const theory = documentRef.querySelector("#writing-theory_section")
  const form = documentRef.querySelector("#current-writing-form")
  assert.equal(theory.value, "保存过的正文")
  assert.equal(documentRef.querySelector("#current-target-venue").textContent, "原有候选期刊")
  assert.match(documentRef.querySelector("#current-writing-materials").textContent, /我的原有问题/u)
  theory.value = "新写的推导\n\n$$x^2$$"
  form.listeners.get("input")({})
  form.listeners.get("submit")({ preventDefault() {} })
  assert.equal(createP02WorkflowStore(storage).read().writing.theory_section, "新写的推导\n\n$$x^2$$")
  assert.match(documentRef.querySelector("#current-writing-message").textContent, /已保存/u)

  theory.value = "导出这份未保存修改"
  form.listeners.get("input")({})
  documentRef.querySelector("#export-current-writing").listeners.get("click")({})
  assert.equal(downloads.length, 1)
  assert.match(downloads[0], /导出这份未保存修改/u)
  assert.equal(createP02WorkflowStore(storage).read().writing.theory_section, "新写的推导\n\n$$x^2$$")
  assert.match(documentRef.querySelector("#current-writing-message").textContent, /含未保存修改/u)
})

test("a storage update preserves a dirty editor and saving refuses to overwrite the other draft", () => {
  const state = createEmptyP02WorkflowState()
  state.writing.theory_section = "共同起点"
  const storage = createStorage(state)
  const documentRef = createWritingDocument({ current: true })
  const events = new Map()
  initializeP02Writing({ document: documentRef, data: P02_WRITING_DATA, storage, window: { addEventListener(name, callback) { events.set(name, callback) } } })
  const theory = documentRef.querySelector("#writing-theory_section")
  const form = documentRef.querySelector("#current-writing-form")
  theory.value = "正在输入的内容"
  form.listeners.get("input")({})
  state.writing.theory_section = "另一页已保存内容"
  storage.setItem(P02_WORKFLOW_STORAGE_KEY, JSON.stringify(state))
  events.get("storage")({ key: P02_WORKFLOW_STORAGE_KEY })
  assert.equal(theory.value, "正在输入的内容")
  form.listeners.get("submit")({ preventDefault() {} })
  assert.equal(createP02WorkflowStore(storage).read().writing.theory_section, "另一页已保存内容")
  assert.equal(theory.value, "正在输入的内容")
  assert.match(documentRef.querySelector("#current-writing-message").textContent, /本次未覆盖/u)
})

test("the writing view keeps substantive evidence and TCNS style samples visibly separate", () => {
  const view = buildP02WritingView(P02_WRITING_DATA)

  assert.equal(view.submissionLabel, "研究脚手架 · 尚不可投稿")
  assert.equal(view.crossVenue.heading, "同类论文 · 不同期刊")
  assert.equal(view.crossVenue.usageLabel, "相关工作与实质证据")
  assert.equal(view.inVenue.heading, "TCNS 同刊相似论文")
  assert.equal(view.inVenue.usageLabel, "仅用于排版与写作风格")
  assert.equal(view.materials.length, 6)
  assert.equal(view.inVenue.cards.every((card) => card.supportsClaims === false), true)
})

test("the writing view rejects data outside the closed P02 writing contract", () => {
  assert.throws(
    () => buildP02WritingView({ ...P02_WRITING_DATA, unexpected: true }),
    { name: "TypeError", message: "P02 写作材料数据无效" },
  )
})

test("the writing renderer creates the five record collections with text and HTTPS links", () => {
  const documentRef = createWritingDocument()

  const view = initializeP02Writing({ document: documentRef, data: P02_WRITING_DATA })

  assert.equal(documentRef.elements.get("#cross-venue-evidence").children.length, 8)
  assert.equal(documentRef.elements.get("#in-venue-style-samples").children.length, 5)
  assert.equal(documentRef.elements.get("#writing-materials").children.length, 6)
  assert.equal(documentRef.elements.get("#claim-summary").children.length, 5)
  assert.equal(documentRef.elements.get("#submission-blockers").children.length, 6)
  assert.match(documentRef.elements.get("#in-venue-style-samples").textContent, /不支撑论文主张/u)
  assert.equal(view.inVenue.cards.every((card) => card.supportsClaims === false), true)

  const styleCards = documentRef.elements.get("#in-venue-style-samples").children
  const requiredStyleLabels = [
    "已核验页数",
    "章节组织",
    "摘要结构",
    "定理/证明放置",
    "实验呈现",
    "写作用途",
    "禁止用途",
  ]
  for (const styleCard of styleCards) {
    for (const label of requiredStyleLabels) assert.match(styleCard.textContent, new RegExp(label, "u"))
  }
  assert.match(styleCards[0].textContent, /摘要结构未从全文核验/u)
  assert.match(styleCards[0].textContent, /定理\/证明放置未从全文核验/u)
  assert.match(styleCards[0].textContent, /实验呈现未从全文核验/u)
  assert.match(styleCards[2].textContent, /定理\/证明放置主要定理位于分析章节，较长支撑证明移至附录。/u)
  assert.match(styleCards[2].textContent, /实验呈现公开参数并报告 50 次运行的平均曲线。/u)

  const links = []
  const visibleSourceLinks = []
  const visit = (node) => {
    if (node.href) {
      links.push(node.href)
      if (node.textContent.startsWith("https://")) visibleSourceLinks.push(node.textContent)
    }
    for (const child of node.children) visit(child)
  }
  for (const element of documentRef.elements.values()) visit(element)
  assert.equal(links.length, 15)
  assert.equal(links.every((href) => new URL(href).protocol === "https:"), true)
  assert.equal(visibleSourceLinks.length, 13)
})
