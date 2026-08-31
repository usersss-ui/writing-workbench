import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pageUrl = new URL("./state-transfer.html", import.meta.url)
const moduleUrl = new URL("./state-transfer.mjs", import.meta.url)
const html = await readFile(pageUrl, "utf8")
const source = await readFile(moduleUrl, "utf8")
const absoluteUsersPath = (...parts) => ["", "Users", ...parts].join("/")

const EXPECTED_IDS = Object.freeze([
  "state-transfer-app",
  "state-transfer-title",
  "state-transfer-origin",
  "state-transfer-export-panel",
  "state-transfer-export-title",
  "state-transfer-export",
  "state-transfer-import-panel",
  "state-transfer-import-title",
  "state-transfer-files",
  "state-transfer-preview",
  "state-transfer-preview-panel",
  "state-transfer-preview-title",
  "state-transfer-bundles",
  "state-transfer-conflicts",
  "state-transfer-exclusions",
  "state-transfer-confirmation",
  "state-transfer-confirm",
  "state-transfer-apply",
  "state-transfer-status",
])

test("operator page is an unlinked Chinese desktop-only surface with only the two approved network references", async () => {
  assert.match(html, /<html lang="zh-CN">/u)
  assert.match(html, /一次性本地工具/u)
  assert.match(html, /不读取论文正文、笔记、原始路径、凭据/u)
  assert.match(html, /<body class="state-transfer-page">/u)
  assert.doesNotMatch(html, /<nav\b|class="[^"]*(?:sidebar|primary-nav|nav-item)/u)
  assert.doesNotMatch(html, /<iframe|<embed|<object|\son[a-z]+\s*=/iu)
  for (const id of EXPECTED_IDS) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, "gu"))].length, 1, id)
  }
  assert.match(html, /id="state-transfer-app"[\s\S]*?aria-busy="false"/u)
  assert.match(html, /id="state-transfer-files"[^>]*type="file"[^>]*accept="\.json,application\/json"[^>]*multiple/u)
  assert.match(html, /id="state-transfer-status"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?tabindex="-1"/u)

  const assetReferences = [...html.matchAll(/(?:href|src)="(\.\/assets\/[^"]+)"/gu)].map(([, value]) => value).sort()
  assert.deepEqual(assetReferences, ["./assets/state-transfer.mjs", "./assets/styles.css"])

  for (const name of [
    "index.html", "directions.html", "p02.html", "agent-tasks.html", "library.template.html", "discovery.template.html",
  ]) {
    const normalPage = await readFile(new URL(`./${name}`, import.meta.url), "utf8")
    assert.doesNotMatch(normalPage, /state-transfer\.html/u, name)
  }
})

test("the recursive runtime import graph is exactly the seven approved modules and has no dynamic or escaping import", async () => {
  const expected = [
    "agent-task-input.mjs",
    "candidate-storage.mjs",
    "direction-snapshot.mjs",
    "paper-library-model.mjs",
    "paper-library-storage.mjs",
    "paper-user-tags.mjs",
    "state-transfer.mjs",
  ]
  const pending = [moduleUrl]
  const visited = new Map()
  while (pending.length > 0) {
    const url = pending.shift()
    if (visited.has(url.href)) continue
    const text = await readFile(url, "utf8")
    visited.set(url.href, text)
    assert.doesNotMatch(text, /\bimport\s*\(/u, url.pathname)
    const specifiers = [
      ...text.matchAll(/^\s*import\s+(?:[^\n"']+\sfrom\s+)?["']([^"']+)["']/gmu),
      ...text.matchAll(/^\s*export\s+[^\n"']+\sfrom\s+["']([^"']+)["']/gmu),
    ].map((match) => match[1])
    for (const specifier of specifiers) {
      assert.match(specifier, /^\.\/[A-Za-z0-9-]+\.mjs$/u)
      const dependency = new URL(specifier, url)
      assert.equal(new URL("./", dependency).href, new URL("./", moduleUrl).href)
      pending.push(dependency)
    }
  }
  assert.deepEqual([...visited.keys()].map((href) => new URL(href).pathname.split("/").pop()).sort(), expected)
})

test("operator rendering has no HTML/code execution sink and no raw error channel", () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|\bFunction\s*\(/u)
  assert.doesNotMatch(source, /console\.(?:log|warn|error)|error\.(?:message|stack)|String\(error\)/u)
  assert.match(source, /\.textContent\s*=/u)
  assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/u)
})

class MemoryStorage {
  constructor(entries = {}, failure = null) {
    this.values = new Map(Object.entries(entries))
    this.failure = failure
    this.reads = 0
    this.writes = 0
  }

  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) {
    this.reads += 1
    if (this.failure) throw this.failure
    return this.values.has(key) ? this.values.get(key) : null
  }
  setItem(key, value) {
    this.writes += 1
    if (this.failure) throw this.failure
    this.values.set(String(key), String(value))
  }
  removeItem(key) {
    this.writes += 1
    if (this.failure) throw this.failure
    this.values.delete(key)
  }
}

class ConditionalFailStorage extends MemoryStorage {
  constructor(entries, shouldFail) {
    super(entries)
    this.shouldFail = shouldFail
  }

  setItem(key, value) {
    if (this.shouldFail(String(key), String(value))) {
      this.writes += 1
      throw new Error(`${absoluteUsersPath("alice", "private")} raw rollback failure`)
    }
    super.setItem(key, value)
  }
}

function matches(element, selector) {
  if (selector.startsWith("#")) return element.id === selector.slice(1)
  if (selector === "select") return element.tagName === "SELECT"
  const data = selector.match(/^\[data-conflict-id="([^"]+)"\]$/u)
  return data ? element.getAttribute("data-conflict-id") === data[1] : false
}

class FakeElement {
  constructor(tagName, documentRef, id = "") {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = documentRef
    this.id = id
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.dataset = {}
    this.className = ""
    this.disabled = false
    this.checked = false
    this.files = []
    this.value = ""
    this.href = ""
    this.download = ""
    this.focusCount = 0
    this._text = ""
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? String(child)).join("")
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  async dispatch(type, event = {}) {
    const calls = (this.listeners.get(type) ?? []).map((listener) => listener({
      preventDefault() {}, currentTarget: this, target: this, ...event,
    }))
    await Promise.all(calls)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === "id") this.id = String(value)
  }

  getAttribute(name) { return this.attributes.get(name) ?? null }
  appendChild(child) { this.children.push(child); return child }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this._text = ""; this.children = [...children] }
  querySelector(selector) {
    if (matches(this, selector)) return this
    for (const child of this.children) {
      const found = child?.querySelector?.(selector)
      if (found) return found
    }
    return null
  }
  querySelectorAll(selector) {
    const found = matches(this, selector) ? [this] : []
    for (const child of this.children) found.push(...(child?.querySelectorAll?.(selector) ?? []))
    return found
  }
  focus() { this.focusCount += 1; this.ownerDocument.activeElement = this }
  click() { this.ownerDocument.anchorClicks += 1 }
}

function fakeDom({ origin = "http://127.0.0.1:4176", storage = new MemoryStorage(), fetchImpl = null } = {}) {
  const documentRef = {
    readyState: "complete",
    activeElement: null,
    anchorClicks: 0,
    elements: new Map(),
    createElement(tag) { return new FakeElement(tag, this) },
    querySelector(selector) { return selector.startsWith("#") ? this.elements.get(selector.slice(1)) ?? null : null },
  }
  for (const id of EXPECTED_IDS) {
    let tag = "div"
    if (["state-transfer-export", "state-transfer-preview", "state-transfer-apply"].includes(id)) tag = "button"
    if (["state-transfer-files", "state-transfer-confirm"].includes(id)) tag = "input"
    documentRef.elements.set(id, new FakeElement(tag, documentRef, id))
  }
  const root = documentRef.elements.get("state-transfer-app")
  for (const element of documentRef.elements.values()) {
    if (element !== root) root.appendChild(element)
  }
  const revoked = []
  const requests = []
  let objectUrls = 0
  const windowRef = {
    location: { origin, href: `${origin}/local_library_output/desktop/state-transfer.html` },
    localStorage: storage,
    Blob,
    URL: {
      createObjectURL() { objectUrls += 1; return `blob:transfer-${objectUrls}` },
      revokeObjectURL(value) { revoked.push(value) },
    },
    fetch: async (url) => {
      requests.push(String(url))
      if (fetchImpl) return fetchImpl(url)
      return { ok: true, json: async () => ({ version: 3, papers: [{ paper_id: "Paper-01" }] }) }
    },
  }
  return { documentRef, windowRef, storage, root, revoked, requests, get objectUrls() { return objectUrls } }
}

function emptyState() {
  return {
    direction_snapshot: null,
    paper_workspace: { version: 1, shelf: {}, personalReading: {}, selectedPaperId: null },
    personal_tags: { version: 1, papers: {} },
    discovery_candidates: { version: 1, candidates: [] },
    agent_task_input: { version: 1, current_snapshot_id: null, snapshots: [] },
  }
}

function storageFor(state) {
  return new MemoryStorage({
    "research-console.paper-library.v1": JSON.stringify(state.paper_workspace),
    "research-console.paper-user-tags.v1": JSON.stringify(state.personal_tags),
    "research-console.discovery-candidates.v1": JSON.stringify(state.discovery_candidates),
    "research-console.agent-task-input.v1": JSON.stringify(state.agent_task_input),
    ...(state.direction_snapshot
      ? { "research-console.direction-snapshot.v1": JSON.stringify(state.direction_snapshot) }
      : {}),
  })
}

function validDirection() {
  return {
    version: 1,
    project_id: "P02",
    saved_at: "2026-09-01T00:00:00.000Z",
    axes: {
      problem: ["分布式优化"], direction: ["有向网络"], topology: [], balance: [], coupling: [],
      feedback: [], communication: ["低通信"], privacy: [], algorithm: [], guarantee: [],
    },
  }
}

function maliciousCandidate() {
  return {
    paperId: "W9001",
    doi: "10.1000/safe",
    title: "<img src=x onerror=privateFailure>",
    authors: ["<svg onload=privateFailure>"],
    year: 2026,
    source: "Safe source",
    citations: 0,
    isOpenAccess: false,
    openAccessUrl: null,
    landingPageUrl: "https://openalex.org/W9001",
    topics: [],
    abstract: null,
    stage: "pending_screening",
  }
}

async function bootOperator(context, label, { state = emptyState(), fetchImpl = null } = {}) {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  context.after(() => {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  const storage = storageFor(state)
  const ui = fakeDom({ storage, fetchImpl })
  globalThis.document = ui.documentRef
  globalThis.window = ui.windowRef
  const transfer = await import(`${moduleUrl.href}?${label}=${Date.now()}-${Math.random()}`)
  return { storage, transfer, ui }
}

function bundleFile(bundle, name) {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle))
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return { name, size: bytes.byteLength, arrayBuffer: async () => body }
}

async function directionBundle(transfer, originLabel, exportedAt) {
  const state = emptyState()
  state.direction_snapshot = validDirection()
  return transfer.exportStateBundle({ storage: storageFor(state), originLabel, exportedAt })
}

test("changing selected files after preview invalidates the old plan and blocks apply", async (context) => {
  const { storage, transfer, ui } = await bootOperator(context, "file-change-invalidates")
  const first = bundleFile(await directionBundle(
    transfer,
    "http://127.0.0.1:4177",
    "2026-09-01T04:00:00.000Z",
  ), "origin-4177.json")
  const second = bundleFile(await transfer.exportStateBundle({
    storage: storageFor(emptyState()),
    originLabel: "http://127.0.0.1:4178",
    exportedAt: "2026-09-01T04:01:00.000Z",
  }), "origin-4178.json")
  const files = ui.documentRef.elements.get("state-transfer-files")
  const confirm = ui.documentRef.elements.get("state-transfer-confirm")
  const apply = ui.documentRef.elements.get("state-transfer-apply")

  files.files = [first]
  await files.dispatch("change")
  await ui.documentRef.elements.get("state-transfer-preview").dispatch("click")
  const oldDecision = ui.documentRef.elements.get("state-transfer-conflicts").querySelector("select")
  oldDecision.value = "skip"
  await oldDecision.dispatch("change")
  confirm.checked = true
  await confirm.dispatch("change")
  assert.equal(apply.disabled, false)

  const writesBeforeChange = storage.writes
  files.files = [second]
  await files.dispatch("change")

  assert.equal(confirm.checked, false)
  assert.equal(confirm.disabled, true)
  assert.equal(apply.disabled, true)
  assert.equal(oldDecision.disabled, true)
  assert.match(ui.documentRef.elements.get("state-transfer-confirmation").textContent, /文件已变化.*重新生成/u)
  confirm.checked = true
  await confirm.dispatch("change")
  await apply.dispatch("click")
  assert.equal(storage.writes, writesBeforeChange)
})

test("a failed preview resets checked and enabled confirmation state", async (context) => {
  const { transfer, ui } = await bootOperator(context, "preview-failure-invalidates")
  const validFile = bundleFile(await directionBundle(
    transfer,
    "http://127.0.0.1:4177",
    "2026-09-01T04:02:00.000Z",
  ), "valid.json")
  const files = ui.documentRef.elements.get("state-transfer-files")
  const confirm = ui.documentRef.elements.get("state-transfer-confirm")
  const apply = ui.documentRef.elements.get("state-transfer-apply")

  files.files = [validFile]
  await files.dispatch("change")
  await ui.documentRef.elements.get("state-transfer-preview").dispatch("click")
  const decision = ui.documentRef.elements.get("state-transfer-conflicts").querySelector("select")
  decision.value = "skip"
  await decision.dispatch("change")
  confirm.checked = true
  await confirm.dispatch("change")
  assert.equal(apply.disabled, false)

  const malformed = new TextEncoder().encode("not json")
  files.files = [{
    name: "malformed.json",
    size: malformed.byteLength,
    arrayBuffer: async () => malformed.buffer,
  }]
  await ui.documentRef.elements.get("state-transfer-preview").dispatch("click")

  assert.equal(confirm.checked, false)
  assert.equal(confirm.disabled, true)
  assert.equal(apply.disabled, true)
  assert.equal(ui.documentRef.elements.get("state-transfer-conflicts").querySelectorAll("select").length, 0)
  assert.match(ui.documentRef.elements.get("state-transfer-confirmation").textContent, /尚未生成可应用/u)
})

test("a transitional 404 for the public index falls back to current-state paper IDs", async (context) => {
  const currentState = emptyState()
  currentState.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  const { transfer, ui } = await bootOperator(context, "index-404-fallback", {
    state: currentState,
    fetchImpl: async () => ({ ok: false }),
  })
  const incomingState = emptyState()
  incomingState.personal_tags = { version: 1, papers: { "Paper-01": ["当前书架论文"] } }
  const incoming = await transfer.exportStateBundle({
    storage: storageFor(incomingState),
    originLabel: "http://127.0.0.1:4177",
    exportedAt: "2026-09-01T04:03:00.000Z",
  })
  ui.documentRef.elements.get("state-transfer-files").files = [bundleFile(incoming, "origin-4177.json")]

  await ui.documentRef.elements.get("state-transfer-preview").dispatch("click")

  assert.deepEqual(ui.requests, ["http://127.0.0.1:4176/local_library_data/paper-index.json"])
  assert.equal(ui.documentRef.elements.get("state-transfer-exclusions").textContent, "")
  assert.equal(ui.documentRef.elements.get("state-transfer-confirm").disabled, false)
})

test("operator behavior blocks unsupported origins, sanitizes failures and bodies, stays busy-safe, and applies once", async (context) => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  context.after(() => {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })

  const unsupportedFailure = new Error(`${absoluteUsersPath("alice", "private")} Authorization: Bearer secret <img onerror=boom>`)
  const unsupported = fakeDom({ origin: "http://localhost:4176", storage: new MemoryStorage({}, unsupportedFailure) })
  globalThis.document = unsupported.documentRef
  globalThis.window = unsupported.windowRef
  await import(`${moduleUrl.href}?unsupported=${Date.now()}`)
  assert.equal(unsupported.storage.reads, 0)
  assert.equal(unsupported.documentRef.elements.get("state-transfer-export").disabled, true)
  assert.match(unsupported.documentRef.elements.get("state-transfer-status").textContent, /只允许在三个指定的本地端口/u)
  assert.doesNotMatch(unsupported.root.textContent, /Users|Authorization|secret|<img/u)

  let oversizedReads = 0
  const oversized = fakeDom()
  globalThis.document = oversized.documentRef
  globalThis.window = oversized.windowRef
  await import(`${moduleUrl.href}?oversized=${Date.now()}`)
  oversized.documentRef.elements.get("state-transfer-files").files = [{
    size: (16 * 1024 * 1024) + 1,
    async arrayBuffer() { oversizedReads += 1; return new ArrayBuffer(0) },
  }]
  await oversized.documentRef.elements.get("state-transfer-preview").dispatch("click")
  assert.equal(oversizedReads, 0)
  assert.equal(oversized.storage.reads, 0)
  assert.match(oversized.documentRef.elements.get("state-transfer-status").textContent, /大小超出限制/u)

  const storage = storageFor(emptyState())
  const ui = fakeDom({ storage })
  globalThis.document = ui.documentRef
  globalThis.window = ui.windowRef
  const transfer = await import(`${moduleUrl.href}?operator=${Date.now()}`)

  const firstExport = ui.documentRef.elements.get("state-transfer-export").dispatch("click")
  const duplicateExport = ui.documentRef.elements.get("state-transfer-export").dispatch("click")
  await Promise.all([firstExport, duplicateExport])
  assert.equal(ui.objectUrls, 1)
  assert.deepEqual(ui.revoked, ["blob:transfer-1"])
  assert.equal(ui.documentRef.anchorClicks, 1)

  const incomingState = emptyState()
  incomingState.direction_snapshot = validDirection()
  incomingState.paper_workspace = {
    version: 1,
    shelf: { "Paper-Imported": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-Imported",
  }
  incomingState.personal_tags = {
    version: 1,
    papers: { "Paper-01": ["索引已知"], "Paper-Imported": ["导入自报"] },
  }
  incomingState.discovery_candidates = { version: 1, candidates: [maliciousCandidate()] }
  const incoming = await transfer.exportStateBundle({
    storage: storageFor(incomingState),
    originLabel: "http://127.0.0.1:4177",
    exportedAt: "2026-09-01T01:00:00.000Z",
  })
  const fileBytes = new TextEncoder().encode(JSON.stringify(incoming))
  ui.documentRef.elements.get("state-transfer-files").files = [{ size: fileBytes.byteLength, arrayBuffer: async () => fileBytes.buffer }]
  await ui.documentRef.elements.get("state-transfer-preview").dispatch("click")

  assert.equal(ui.documentRef.activeElement, ui.documentRef.elements.get("state-transfer-preview-title"))
  assert.deepEqual(ui.requests, ["http://127.0.0.1:4176/local_library_data/paper-index.json"])
  assert.doesNotMatch(ui.root.textContent, /<img|<svg|privateFailure/u)
  assert.match(ui.root.textContent, /http:\/\/127\.0\.0\.1:4177/u)
  assert.match(ui.documentRef.elements.get("state-transfer-exclusions").textContent, /Paper-Imported/u)
  const conflictSelects = ui.documentRef.elements.get("state-transfer-conflicts").querySelectorAll("select")
  assert.equal(conflictSelects.length, 2)
  ui.documentRef.elements.get("state-transfer-confirm").checked = true
  await ui.documentRef.elements.get("state-transfer-confirm").dispatch("change")
  assert.equal(ui.documentRef.elements.get("state-transfer-apply").disabled, true)
  for (const conflictSelect of conflictSelects) {
    conflictSelect.value = "skip"
    await conflictSelect.dispatch("change")
  }
  assert.equal(ui.documentRef.elements.get("state-transfer-apply").disabled, false)

  await ui.documentRef.elements.get("state-transfer-apply").dispatch("click")
  const writesAfterSuccess = storage.writes
  assert.match(ui.documentRef.elements.get("state-transfer-status").textContent, /状态迁移成功/u)
  assert.equal(ui.documentRef.activeElement, ui.documentRef.elements.get("state-transfer-status"))
  assert.equal(ui.documentRef.elements.get("state-transfer-apply").disabled, true)
  assert.deepEqual(
    JSON.parse(storage.getItem("research-console.paper-user-tags.v1")),
    { version: 1, papers: { "Paper-01": ["索引已知"] } },
  )
  await ui.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.equal(storage.writes, writesAfterSuccess)

  const rollbackIncomingState = emptyState()
  rollbackIncomingState.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  rollbackIncomingState.personal_tags = { version: 1, papers: { "Paper-01": ["必读"] } }
  const rollbackIncoming = await transfer.exportStateBundle({
    storage: storageFor(rollbackIncomingState),
    originLabel: "http://127.0.0.1:4177",
    exportedAt: "2026-09-01T02:00:00.000Z",
  })
  const rollbackBase = storageFor(emptyState())
  let failRollbackTags = true
  const rollbackStorage = new ConditionalFailStorage(
    Object.fromEntries(rollbackBase.values),
    (key, value) => failRollbackTags && key === "research-console.paper-user-tags.v1" && value.includes("必读"),
  )
  const rollbackUi = fakeDom({ storage: rollbackStorage })
  globalThis.document = rollbackUi.documentRef
  globalThis.window = rollbackUi.windowRef
  await import(`${moduleUrl.href}?rollback=${Date.now()}`)
  const rollbackBytes = new TextEncoder().encode(JSON.stringify(rollbackIncoming))
  rollbackUi.documentRef.elements.get("state-transfer-files").files = [{ size: rollbackBytes.byteLength, arrayBuffer: async () => rollbackBytes.buffer }]
  await rollbackUi.documentRef.elements.get("state-transfer-preview").dispatch("click")
  const rollbackSelect = rollbackUi.documentRef.elements.get("state-transfer-conflicts").querySelector("select")
  rollbackSelect.value = `replace:${rollbackIncoming.sha256}`
  await rollbackSelect.dispatch("change")
  rollbackUi.documentRef.elements.get("state-transfer-confirm").checked = true
  await rollbackUi.documentRef.elements.get("state-transfer-confirm").dispatch("change")
  await rollbackUi.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.match(rollbackUi.documentRef.elements.get("state-transfer-status").textContent, /已验证恢复原状态；请重新生成预览/u)
  assert.equal(rollbackUi.documentRef.elements.get("state-transfer-confirm").checked, false)
  assert.equal(rollbackUi.documentRef.elements.get("state-transfer-confirm").disabled, true)
  assert.equal(rollbackUi.documentRef.elements.get("state-transfer-preview").disabled, false)
  const rollbackWrites = rollbackStorage.writes
  await rollbackUi.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.equal(rollbackStorage.writes, rollbackWrites)

  failRollbackTags = false
  await rollbackUi.documentRef.elements.get("state-transfer-preview").dispatch("click")
  assert.equal(rollbackUi.documentRef.elements.get("state-transfer-confirm").disabled, false)
  const retrySelect = rollbackUi.documentRef.elements.get("state-transfer-conflicts").querySelector("select")
  retrySelect.value = `replace:${rollbackIncoming.sha256}`
  await retrySelect.dispatch("change")
  rollbackUi.documentRef.elements.get("state-transfer-confirm").checked = true
  await rollbackUi.documentRef.elements.get("state-transfer-confirm").dispatch("change")
  await rollbackUi.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.match(rollbackUi.documentRef.elements.get("state-transfer-status").textContent, /状态迁移成功/u)

  const staleStorage = storageFor(emptyState())
  const staleUi = fakeDom({ storage: staleStorage })
  globalThis.document = staleUi.documentRef
  globalThis.window = staleUi.windowRef
  await import(`${moduleUrl.href}?stale=${Date.now()}`)
  const directionOnlyState = emptyState()
  directionOnlyState.direction_snapshot = validDirection()
  const directionOnly = await transfer.exportStateBundle({
    storage: storageFor(directionOnlyState),
    originLabel: "http://127.0.0.1:4178",
    exportedAt: "2026-09-01T03:00:00.000Z",
  })
  const staleBytes = new TextEncoder().encode(JSON.stringify(directionOnly))
  staleUi.documentRef.elements.get("state-transfer-files").files = [{ size: staleBytes.byteLength, arrayBuffer: async () => staleBytes.buffer }]
  await staleUi.documentRef.elements.get("state-transfer-preview").dispatch("click")
  const staleSelect = staleUi.documentRef.elements.get("state-transfer-conflicts").querySelector("select")
  staleSelect.value = "skip"
  await staleSelect.dispatch("change")
  staleUi.documentRef.elements.get("state-transfer-confirm").checked = true
  await staleUi.documentRef.elements.get("state-transfer-confirm").dispatch("change")
  staleStorage.setItem("research-console.paper-library.v1", JSON.stringify({
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }))
  await staleUi.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.match(staleUi.documentRef.elements.get("state-transfer-status").textContent, /状态已变化.*重新载入后预览/u)
  assert.equal(staleUi.documentRef.elements.get("state-transfer-confirm").checked, false)
  assert.equal(staleUi.documentRef.elements.get("state-transfer-confirm").disabled, true)
  assert.equal(staleUi.documentRef.elements.get("state-transfer-apply").disabled, true)
  assert.equal(staleUi.documentRef.elements.get("state-transfer-preview").disabled, false)
  const staleWrites = staleStorage.writes
  await staleUi.documentRef.elements.get("state-transfer-apply").dispatch("click")
  assert.equal(staleStorage.writes, staleWrites)

  const failing = fakeDom({ storage: new MemoryStorage({}, unsupportedFailure) })
  globalThis.document = failing.documentRef
  globalThis.window = failing.windowRef
  await import(`${moduleUrl.href}?failure=${Date.now()}`)
  await failing.documentRef.elements.get("state-transfer-export").dispatch("click")
  assert.match(failing.documentRef.elements.get("state-transfer-status").textContent, /导出失败/u)
  assert.doesNotMatch(failing.root.textContent, /Users|Authorization|secret|<img/u)
})
