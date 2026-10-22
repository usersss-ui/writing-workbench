// Storage-shaped adapter that keeps research state on the local Node server
// instead of in this browser's localStorage. Reads come from a snapshot loaded
// once per page; writes go to disk synchronously so a module's existing
// "未保存" handling still sees real failures, and closing a tab cannot drop a
// pending write. Keys outside the whitelist (the P02 workflow) stay in
// localStorage.

export const WORKBENCH_STATE_ENDPOINT = "/api/v1/workbench-state"
const CHANNEL_NAME = "research-console.workbench-state"
const EXACT_KEYS = new Set([
  "research-console.direction-snapshot.v1",
  "research-console.paper-library.v1",
  "research-console.paper-user-tags.v1",
  "research-console.discovery-candidates.v1",
  "research-console.discovery-workspace.v1",
  "research-console.agent-task-input.v1",
])
const AGENT_TASK_SUBKEY = /^research-console\.agent-task-input\.v1\.(?:current|(?:snapshot|pending)\.[A-Z0-9-]{1,96})$/u
const ALERT_CLASS = "workbench-state-alert"
const opened = new WeakMap()

export function isWorkbenchStateKey(key) {
  return typeof key === "string" && (EXACT_KEYS.has(key) || AGENT_TASK_SUBKEY.test(key))
}

function validEntry(entry) {
  return entry !== null && typeof entry === "object"
    && Number.isSafeInteger(entry.revision) && entry.revision >= 0
    && (entry.value === null || typeof entry.value === "string")
}

function request(windowRef, method, body) {
  const xhr = new windowRef.XMLHttpRequest()
  xhr.open(method, WORKBENCH_STATE_ENDPOINT, false)
  if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json")
  xhr.send(body === undefined ? null : JSON.stringify(body))
  let payload = null
  try { payload = JSON.parse(xhr.responseText) } catch { payload = null }
  return { status: xhr.status, payload }
}

function errorMessage(payload, fallback) {
  const message = payload?.error?.message
  return typeof message === "string" && message.length > 0 ? message : fallback
}

function localStorageOf(windowRef) {
  try { return windowRef.localStorage ?? null } catch { return null }
}

export function openWorkbenchStorage({ windowRef = globalThis, legacyFallback = false } = {}) {
  if (opened.has(windowRef)) return opened.get(windowRef)
  const local = localStorageOf(windowRef)
  const entries = new Map()
  let available = false
  let channel = null

  function report(message) {
    const body = windowRef.document?.body
    if (!body) return
    let alert = body.querySelector(`.${ALERT_CLASS}`)
    if (!alert) {
      alert = windowRef.document.createElement("div")
      alert.className = ALERT_CLASS
      alert.setAttribute("role", "alert")
      body.append(alert)
    }
    alert.textContent = message
    alert.hidden = false
  }

  function clearReport() {
    const alert = windowRef.document?.body?.querySelector(`.${ALERT_CLASS}`)
    if (alert) alert.hidden = true
  }

  function dispatchChange(key, oldValue, newValue) {
    if (typeof windowRef.dispatchEvent !== "function") return
    const init = { key, oldValue, newValue, url: windowRef.location?.href ?? "" }
    const event = typeof windowRef.StorageEvent === "function"
      ? new windowRef.StorageEvent("storage", init)
      : Object.assign(new windowRef.Event("storage"), init)
    windowRef.dispatchEvent(event)
  }

  function load() {
    const { status, payload } = request(windowRef, "GET")
    const loaded = payload?.entries
    if (status !== 200 || payload?.version !== 1 || loaded === null || typeof loaded !== "object") {
      throw Object.assign(new Error("WORKBENCH_STATE_UNAVAILABLE"), { status, payload })
    }
    const next = new Map()
    for (const [key, entry] of Object.entries(loaded)) {
      if (isWorkbenchStateKey(key) && validEntry(entry)) next.set(key, { revision: entry.revision, value: entry.value })
    }
    return next
  }

  function reloadAfterConflict() {
    const next = load()
    const keys = new Set([...entries.keys(), ...next.keys()])
    const changes = []
    for (const key of keys) {
      const oldValue = entries.get(key)?.value ?? null
      const newValue = next.get(key)?.value ?? null
      if (oldValue !== newValue) changes.push([key, oldValue, newValue])
    }
    entries.clear()
    for (const [key, entry] of next) entries.set(key, entry)
    for (const change of changes) dispatchChange(...change)
  }

  function write(key, value) {
    if (!available) {
      report("本机研究状态不可用，本次修改未保存到磁盘。")
      throw new Error("WORKBENCH_STATE_UNAVAILABLE")
    }
    let result
    try {
      result = request(windowRef, "POST", { key, expectedRevision: entries.get(key)?.revision ?? 0, value })
    } catch {
      report("无法连接本机服务，本次修改未保存到磁盘。")
      throw new Error("WORKBENCH_STATE_WRITE_FAILED")
    }
    if (result.status === 200 && validEntry(result.payload) && result.payload.key === key) {
      entries.set(key, { revision: result.payload.revision, value })
      channel?.postMessage({ key, revision: result.payload.revision, value })
      clearReport()
      return
    }
    if (result.status === 409) {
      try { reloadAfterConflict() } catch { /* The alert below still reports the failed save. */ }
    }
    report(`${errorMessage(result.payload, "研究状态写入磁盘失败")}；本次修改未保存。`)
    throw new Error(result.payload?.error?.code ?? "WORKBENCH_STATE_WRITE_FAILED")
  }

  function keys() {
    const diskKeys = [...entries].filter(([, entry]) => entry.value !== null).map(([key]) => key)
    const localKeys = []
    if (local) {
      for (let index = 0; index < local.length; index += 1) {
        const key = local.key(index)
        if (typeof key === "string" && !isWorkbenchStateKey(key)) localKeys.push(key)
      }
    }
    return [...diskKeys, ...localKeys]
  }

  try {
    for (const [key, entry] of load()) entries.set(key, entry)
    available = true
  } catch (error) {
    // The standalone legacy export server has no state API; there the page
    // must still read this origin's localStorage.
    const noStateApi = error?.status === 404 || typeof windowRef.XMLHttpRequest !== "function"
    if (legacyFallback && noStateApi && local) {
      opened.set(windowRef, local)
      return local
    }
    report(`${errorMessage(error?.payload, "无法读取本机研究状态")}；页面暂时显示为空，修改不会保存。`)
  }

  if (available && typeof windowRef.BroadcastChannel === "function") {
    channel = new windowRef.BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = ({ data }) => {
      if (!isWorkbenchStateKey(data?.key) || !validEntry(data)) return
      const current = entries.get(data.key)
      if (current && current.revision >= data.revision) return
      entries.set(data.key, { revision: data.revision, value: data.value })
      dispatchChange(data.key, current?.value ?? null, data.value)
    }
  }

  const storage = {
    get length() { return keys().length },
    key(index) { return keys()[index] ?? null },
    getItem(key) {
      if (isWorkbenchStateKey(key)) return entries.get(key)?.value ?? null
      return local ? local.getItem(key) : null
    },
    setItem(key, value) {
      if (isWorkbenchStateKey(key)) { write(key, String(value)); return }
      if (!local) throw new Error("LOCAL_STORAGE_UNAVAILABLE")
      local.setItem(key, value)
    },
    removeItem(key) {
      if (isWorkbenchStateKey(key)) {
        if ((entries.get(key)?.value ?? null) !== null) write(key, null)
        return
      }
      local?.removeItem(key)
    },
  }
  opened.set(windowRef, storage)
  return storage
}
