import assert from "node:assert/strict"
import test from "node:test"
import * as inspector from "./paper-inspector.mjs"
import { inspectMarkdownNote } from "../../exporter/paper-library/note-import.mjs"

const paper = Object.freeze({
  paper_id: "TEST-PAPER-01", title_zh: "一个研究问题", title_en: "A research question",
  authors: ["A. Author", "B. Author"], publication_year: 2024,
  doi_or_url: "https://doi.org/10.1234/paper", source_id: "test", relative_path: "paper",
  source_path: "/private/hidden", note_body: "这段旧笔记必须保留且不自动复制",
})

class Element {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = document
    this.children = []
    this.dataset = {}
    this.attributes = new Map()
    this.listeners = new Map()
    this.textContent = ""
    this.value = ""
    this.open = false
  }
  append(...nodes) { this.children.push(...nodes) }
  setAttribute(name, value) { this.attributes.set(name, value) }
  addEventListener(name, listener) { this.listeners.set(name, listener) }
  async fire(name, event = {}) { return this.listeners.get(name)?.({ target: this, ...event }) }
  async click() { if (!this.disabled) return this.fire("click") }
  showModal() { this.open = true }
  close() { this.open = false; this.listeners.get("close")?.({ target: this }) }
  focus() { this.ownerDocument.activeElement = this }
  remove() { this.removed = true }
}

function documentFixture() {
  const document = { createElement: (name) => new Element(name, document) }
  const copies = []
  const downloads = []
  const windowListeners = new Map()
  document.body = new Element("body", document)
  document.defaultView = {
    navigator: { clipboard: { async writeText(text) { copies.push(text) } } },
    Blob,
    URL: {
      createObjectURL(blob) { downloads.push(blob); return "blob:draft" },
      revokeObjectURL() {},
    },
    setTimeout(fn) { fn() },
    addEventListener(name, listener) { windowListeners.set(name, listener) },
  }
  return { document, copies, downloads, windowListeners }
}

function find(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const result = find(child, predicate)
    if (result) return result
  }
  return null
}
const draftAction = (root, action) => find(root, (node) => node.dataset.noteDraftAction === action)
const textarea = (document) => find(document.body, (node) => node.tagName === "TEXTAREA")
const dialog = (document) => find(document.body, (node) => node.tagName === "DIALOG")
const status = (document) => find(document.body, (node) => node.attributes.get("role") === "status")

test("manual note scaffolds retain paper identity and leave all research conclusions for the reader", async () => {
  assert.equal(typeof inspector.buildManualNoteDraft, "function")
  const draft = inspector.buildManualNoteDraft(paper)
  assert.equal(draft.paperId, "TEST-PAPER-01")
  assert.equal(draft.originalFileName, "TEST-PAPER-01_论文精读.md")
  assert.match(draft.markdown, /^---\npaper_id: TEST-PAPER-01\n---\n/u)
  assert.match(draft.markdown, /一个研究问题/u)
  assert.match(draft.markdown, /A\. Author/u)
  assert.match(draft.markdown, /2024/u)
  assert.match(draft.markdown, /TODO.*研究问题/u)
  assert.match(draft.markdown, /TODO.*方法/u)
  assert.match(draft.markdown, /TODO.*结果/u)
  assert.match(draft.markdown, /TODO.*页码/u)
  assert.doesNotMatch(draft.markdown, /private|hidden|这段旧笔记/u)
  const inspected = await inspectMarkdownNote({ paper, unitDirectory: "/unused", category: "note", originalFileName: draft.originalFileName, markdown: draft.markdown, imageInspector: async () => [] })
  assert.equal(inspected.publicResult.checks.can_import, true)
  assert.throws(() => inspector.buildManualNoteDraft({ ...paper, paper_id: "../bad" }), TypeError)
})

test("editing a draft preserves exact text across reader rerenders and transfers only after an explicit import action", async () => {
  assert.equal(typeof inspector.installNoteDraftEditor, "function")
  const { document, copies, downloads } = documentFixture()
  const received = []
  inspector.installNoteDraftEditor({ document, onImport: async (value) => { received.push(value); return true } })
  const entry = inspector.renderManualAnalysisEntry({ document, paper })
  await draftAction(entry, "open").click()
  const edited = "# 我的分析\n\n$x_{k+1}$  \nTODO：检查式 (4)"
  textarea(document).value = edited
  await textarea(document).fire("input")
  dialog(document).close()
  const rerendered = inspector.renderManualAnalysisEntry({ document, paper })
  await draftAction(rerendered, "open").click()
  assert.equal(textarea(document).value, edited)
  assert.equal(received.length, 0)
  await draftAction(dialog(document), "copy").click()
  assert.deepEqual(copies, [edited])
  await draftAction(dialog(document), "download").click()
  assert.equal(await downloads[0].text(), edited)
  await draftAction(dialog(document), "import").click()
  assert.deepEqual(received, [{ paperId: "TEST-PAPER-01", markdown: edited, originalFileName: "TEST-PAPER-01_论文精读.md" }])
  assert.equal(dialog(document).open, false)
  assert.equal(paper.note_body, "这段旧笔记必须保留且不自动复制")
})

test("paper switching, failed import and offline mode preserve drafts without sending unconfirmed text", async () => {
  assert.equal(typeof inspector.installNoteDraftEditor, "function")
  const { document } = documentFixture()
  let calls = 0
  inspector.installNoteDraftEditor({ document, onImport: async () => { calls += 1; return false } })
  const entry = inspector.renderManualAnalysisEntry({ document, paper })
  await draftAction(entry, "open").click()
  textarea(document).value = "我的未完成草稿"
  await textarea(document).fire("input")
  await draftAction(dialog(document), "import").click()
  assert.equal(calls, 1)
  assert.equal(dialog(document).open, true)
  assert.equal(textarea(document).value, "我的未完成草稿")
  dialog(document).close()
  const other = inspector.renderManualAnalysisEntry({ document, paper: { ...paper, paper_id: "TEST-PAPER-02" } })
  await draftAction(other, "open").click()
  assert.match(textarea(document).value, /paper_id: TEST-PAPER-02/u)
  dialog(document).close()
  inspector.installNoteDraftEditor({ document, onImport: async () => { calls += 1; return true }, canImport: () => false })
  await draftAction(entry, "open").click()
  assert.equal(textarea(document).value, "我的未完成草稿")
  assert.equal(draftAction(dialog(document), "import").disabled, true)
  await draftAction(dialog(document), "import").click()
  assert.equal(calls, 1)
})

test("empty or oversized notes cannot enter import and clipboard failures keep editable text available", async () => {
  assert.equal(typeof inspector.installNoteDraftEditor, "function")
  const { document } = documentFixture()
  let calls = 0
  inspector.installNoteDraftEditor({ document, onImport: async () => { calls += 1; return true } })
  await draftAction(inspector.renderManualAnalysisEntry({ document, paper }), "open").click()
  for (const text of ["  \n", "文".repeat(350000)]) {
    textarea(document).value = text
    await textarea(document).fire("input")
    await draftAction(dialog(document), "import").click()
  }
  assert.equal(calls, 0)
  document.defaultView.navigator.clipboard.writeText = async () => { throw new Error("clipboard unavailable") }
  textarea(document).value = "保留这份草稿"
  await textarea(document).fire("input")
  await draftAction(dialog(document), "copy").click()
  assert.equal(textarea(document).value, "保留这份草稿")
  assert.match(status(document).textContent, /复制.*失败/u)
})

test("initiating an unconfirmed or canceled download keeps the unsaved draft navigation reminder", async () => {
  const { document, windowListeners } = documentFixture()
  const entry = inspector.renderManualAnalysisEntry({ document, paper })
  await draftAction(entry, "open").click()
  const navigationEvent = () => ({ prevented: false, preventDefault() { this.prevented = true } })
  const untouched = navigationEvent()
  windowListeners.get("beforeunload")(untouched)
  assert.equal(untouched.prevented, false)
  textarea(document).value = "这份编辑草稿尚未确认保存"
  await textarea(document).fire("input")
  await draftAction(dialog(document), "download").click()
  dialog(document).close()
  const afterDownload = navigationEvent()
  windowListeners.get("beforeunload")(afterDownload)
  assert.equal(afterDownload.prevented, true)
  assert.equal(afterDownload.returnValue, "")
  await draftAction(entry, "open").click()
  assert.equal(textarea(document).value, "这份编辑草稿尚未确认保存")
})
