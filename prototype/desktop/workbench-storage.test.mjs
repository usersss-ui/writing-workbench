import test from "node:test"
import assert from "node:assert/strict"

import { WORKBENCH_STATE_ENDPOINT, openWorkbenchStorage } from "./workbench-storage.mjs"

const WORKSPACE_KEY = "research-console.paper-library.v1"
const TAGS_KEY = "research-console.paper-user-tags.v1"
const P02_KEY = "research-console.p02-workflow.v1"

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

function fakeServer(entries = {}) {
  const state = new Map(Object.entries(entries))
  const server = {
    state,
    requests: [],
    loadStatus: 200,
    nextWriteStatus: null,
    networkDown: false,
    handle(method, url, body) {
      assert.equal(url, WORKBENCH_STATE_ENDPOINT)
      if (server.networkDown) throw new Error("NetworkError")
      server.requests.push({ method, body: body === null ? null : JSON.parse(body) })
      if (method === "GET") {
        if (server.loadStatus !== 200) return [server.loadStatus, { error: { code: "WORKBENCH_STATE_CORRUPT", message: "本机研究状态文件已损坏" } }]
        return [200, { version: 1, entries: Object.fromEntries(state) }]
      }
      const request = JSON.parse(body)
      if (server.nextWriteStatus) {
        const status = server.nextWriteStatus
        server.nextWriteStatus = null
        return [status, { error: { code: "WORKBENCH_STATE_WRITE_FAILED", message: "研究状态写入磁盘失败" } }]
      }
      const revision = state.get(request.key)?.revision ?? 0
      if (request.expectedRevision !== revision) return [409, { error: { code: "WORKBENCH_STATE_CONFLICT", message: "研究状态已在其他页面更新，已重新载入最新内容" } }]
      state.set(request.key, { revision: revision + 1, value: request.value })
      return [200, { key: request.key, revision: revision + 1, value: request.value }]
    },
  }
  return server
}

function fakeDocument() {
  const children = []
  const body = {
    children,
    append(element) { children.push(element) },
    querySelector(selector) { return children.find((element) => `.${element.className}` === selector) ?? null },
  }
  return {
    body,
    createElement() {
      const attributes = {}
      return { className: "", textContent: "", hidden: false, setAttribute(name, value) { attributes[name] = value }, attributes }
    },
  }
}

function fakeWindow({ server = fakeServer(), local = memoryStorage(), channels = null, xhr = true } = {}) {
  const events = []
  const windowRef = {
    localStorage: local,
    document: fakeDocument(),
    location: { href: "http://127.0.0.1:4176/prototype/desktop/index.html" },
    Event: class { constructor(type) { this.type = type } },
    dispatchEvent(event) { events.push(event) },
  }
  if (xhr) {
    windowRef.XMLHttpRequest = class {
      open(method, url, asynchronous) {
        assert.equal(asynchronous, false)
        this.method = method
        this.url = url
      }
      setRequestHeader(name, value) { assert.deepEqual([name, value], ["Content-Type", "application/json"]) }
      send(body) {
        const [status, payload] = server.handle(this.method, this.url, body)
        this.status = status
        this.responseText = JSON.stringify(payload)
      }
    }
  }
  if (channels) {
    windowRef.BroadcastChannel = class {
      constructor(name) { this.name = name; channels.push(this) }
      postMessage(data) {
        for (const channel of channels) if (channel !== this && channel.name === this.name) channel.onmessage?.({ data: structuredClone(data) })
      }
    }
  }
  return { windowRef, events, server, local }
}

function alertText(windowRef) {
  const alert = windowRef.document.body.querySelector(".workbench-state-alert")
  return alert && !alert.hidden ? alert.textContent : null
}

test("reads disk state loaded at open and keeps other keys in localStorage", () => {
  const server = fakeServer({ [WORKSPACE_KEY]: { revision: 3, value: "disk" } })
  const local = memoryStorage({ [WORKSPACE_KEY]: "stale browser copy", [P02_KEY]: "p02 draft" })
  const { windowRef } = fakeWindow({ server, local })
  const storage = openWorkbenchStorage({ windowRef })
  assert.equal(storage.getItem(WORKSPACE_KEY), "disk")
  assert.equal(storage.getItem(TAGS_KEY), null)
  assert.equal(storage.getItem(P02_KEY), "p02 draft")
  assert.deepEqual(Array.from({ length: storage.length }, (_, index) => storage.key(index)), [WORKSPACE_KEY, P02_KEY])
  storage.setItem(P02_KEY, "edited draft")
  assert.equal(local.getItem(P02_KEY), "edited draft")
  assert.equal(server.requests.filter((request) => request.method === "POST").length, 0)
})

test("each page window opens the state once", () => {
  const { windowRef, server } = fakeWindow()
  assert.equal(openWorkbenchStorage({ windowRef }), openWorkbenchStorage({ windowRef }))
  assert.equal(server.requests.length, 1)
})

test("writes reach disk synchronously with the last known revision", () => {
  const { windowRef, server, local } = fakeWindow()
  const storage = openWorkbenchStorage({ windowRef })
  storage.setItem(WORKSPACE_KEY, "first")
  storage.setItem(WORKSPACE_KEY, "second")
  assert.deepEqual(server.requests.slice(1).map((request) => request.body), [
    { key: WORKSPACE_KEY, expectedRevision: 0, value: "first" },
    { key: WORKSPACE_KEY, expectedRevision: 1, value: "second" },
  ])
  assert.equal(storage.getItem(WORKSPACE_KEY), "second")
  assert.equal(local.getItem(WORKSPACE_KEY), null)
  storage.removeItem(WORKSPACE_KEY)
  assert.equal(storage.getItem(WORKSPACE_KEY), null)
  assert.deepEqual(server.state.get(WORKSPACE_KEY), { revision: 3, value: null })
  storage.removeItem(WORKSPACE_KEY)
  assert.equal(server.requests.length, 4)
})

test("a failed write throws, keeps the old value and shows an alert until a later save succeeds", () => {
  const { windowRef, server } = fakeWindow({ server: fakeServer({ [TAGS_KEY]: { revision: 1, value: "old" } }) })
  const storage = openWorkbenchStorage({ windowRef })
  server.nextWriteStatus = 500
  assert.throws(() => storage.setItem(TAGS_KEY, "new"), /WORKBENCH_STATE_WRITE_FAILED/)
  assert.equal(storage.getItem(TAGS_KEY), "old")
  assert.match(alertText(windowRef), /写入磁盘失败.*未保存/)
  storage.setItem(TAGS_KEY, "new")
  assert.equal(alertText(windowRef), null)
})

test("an unreachable server is reported as unsaved", () => {
  const { windowRef, server } = fakeWindow()
  const storage = openWorkbenchStorage({ windowRef })
  server.networkDown = true
  assert.throws(() => storage.setItem(TAGS_KEY, "x"), /WORKBENCH_STATE_WRITE_FAILED/)
  assert.match(alertText(windowRef), /无法连接本机服务/)
})

test("a revision conflict reloads the newer disk state, notifies listeners and fails the save", () => {
  const { windowRef, server, events } = fakeWindow({ server: fakeServer({ [TAGS_KEY]: { revision: 1, value: "mine" } }) })
  const storage = openWorkbenchStorage({ windowRef })
  server.state.set(TAGS_KEY, { revision: 2, value: "other browser" })
  assert.throws(() => storage.setItem(TAGS_KEY, "stale edit"), /WORKBENCH_STATE_CONFLICT/)
  assert.equal(storage.getItem(TAGS_KEY), "other browser")
  assert.deepEqual(events.map(({ type, key, oldValue, newValue }) => ({ type, key, oldValue, newValue })), [
    { type: "storage", key: TAGS_KEY, oldValue: "mine", newValue: "other browser" },
  ])
  assert.match(alertText(windowRef), /其他页面更新/)
  storage.setItem(TAGS_KEY, "after reload")
  assert.deepEqual(server.state.get(TAGS_KEY), { revision: 3, value: "after reload" })
})

test("a failed load shows empty disk state, refuses writes and leaves localStorage usable", () => {
  const server = fakeServer({ [WORKSPACE_KEY]: { revision: 1, value: "disk" } })
  server.loadStatus = 500
  const { windowRef } = fakeWindow({ server, local: memoryStorage({ [P02_KEY]: "p02" }) })
  const storage = openWorkbenchStorage({ windowRef })
  assert.match(alertText(windowRef), /已损坏.*修改不会保存/)
  assert.equal(storage.getItem(WORKSPACE_KEY), null)
  assert.throws(() => storage.setItem(WORKSPACE_KEY, "x"), /WORKBENCH_STATE_UNAVAILABLE/)
  assert.equal(server.requests.filter((request) => request.method === "POST").length, 0)
  assert.equal(storage.getItem(P02_KEY), "p02")
})

test("the legacy export page falls back to this origin's localStorage only when there is no state API", () => {
  const missing = fakeServer()
  missing.loadStatus = 404
  const local = memoryStorage({ [WORKSPACE_KEY]: "legacy" })
  const legacy = fakeWindow({ server: missing, local })
  assert.equal(openWorkbenchStorage({ windowRef: legacy.windowRef, legacyFallback: true }), local)

  const noXhr = fakeWindow({ local, xhr: false })
  assert.equal(openWorkbenchStorage({ windowRef: noXhr.windowRef, legacyFallback: true }), local)

  const broken = fakeServer()
  broken.loadStatus = 500
  const corrupt = fakeWindow({ server: broken, local })
  assert.notEqual(openWorkbenchStorage({ windowRef: corrupt.windowRef, legacyFallback: true }), local)

  const notLegacy = fakeWindow({ server: missing, local })
  assert.notEqual(openWorkbenchStorage({ windowRef: notLegacy.windowRef }), local)
})

test("saves in one tab reach other open tabs as storage events", () => {
  const channels = []
  const server = fakeServer()
  const first = fakeWindow({ server, channels })
  const second = fakeWindow({ server, channels })
  const firstStorage = openWorkbenchStorage({ windowRef: first.windowRef })
  const secondStorage = openWorkbenchStorage({ windowRef: second.windowRef })
  firstStorage.setItem(WORKSPACE_KEY, "shared")
  assert.equal(secondStorage.getItem(WORKSPACE_KEY), "shared")
  assert.deepEqual(second.events.map(({ key, oldValue, newValue }) => ({ key, oldValue, newValue })), [
    { key: WORKSPACE_KEY, oldValue: null, newValue: "shared" },
  ])
  assert.equal(first.events.length, 0)
  secondStorage.setItem(WORKSPACE_KEY, "edited in second tab")
  assert.equal(firstStorage.getItem(WORKSPACE_KEY), "edited in second tab")
  assert.deepEqual(server.state.get(WORKSPACE_KEY), { revision: 2, value: "edited in second tab" })
})
