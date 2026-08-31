import {
  TASK_INPUT_STORAGE_KEY,
  buildTaskInputPreview,
  createTaskInputSnapshot,
  createTaskInputSnapshotStore,
} from "./agent-task-input.mjs"
import { createDirectionSnapshotStore, DIRECTION_STORAGE_KEY } from "./direction-snapshot.mjs"
import { loadPaperIndex } from "./library.mjs"
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY } from "./paper-library-storage.mjs"

const STATUS_TEXT = Object.freeze({
  ready: "输入已经就绪；确认后可固定为只读快照。",
  direction_missing: "请先在方向探索页显式保存研究方向。",
  shelf_missing: "请先在论文库把论文加入 P02 用途架。",
  index_error: "论文索引格式无效，当前不能固定输入。",
  partial: "用途架中有论文已不在当前索引，需先核对来源。",
  unsafe_metadata: "书目信息含不安全内容，当前不能固定输入。",
})

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function snapshotMatchesPreview(snapshot, preview) {
  return Boolean(preview?.ready)
    && JSON.stringify(snapshot.direction_snapshot) === JSON.stringify(preview.direction_snapshot)
    && JSON.stringify(snapshot.papers) === JSON.stringify(preview.papers)
}

export function loadAgentTaskPaperIndex(fetchImpl = globalThis.fetch) {
  return loadPaperIndex(fetchImpl)
}

export function createAgentTaskSession({ storage, paperIndex } = {}) {
  const snapshotStore = createTaskInputSnapshotStore(storage)
  let currentPaperIndex = paperIndex
  let preview = null

  function rebuildPreview() {
    const directionSnapshot = createDirectionSnapshotStore(storage).read()
    const workspaceState = createWorkspaceStore(storage).read()
    preview = buildTaskInputPreview({ directionSnapshot, workspaceState, paperIndex: currentPaperIndex })
    return clone(preview)
  }

  rebuildPreview()

  return {
    refresh({ paperIndex: nextPaperIndex = currentPaperIndex } = {}) {
      currentPaperIndex = nextPaperIndex
      return rebuildPreview()
    },

    readPreview() {
      return clone(preview)
    },

    saveCurrentInput({ confirmed = false, createdAt, snapshotNonce } = {}) {
      if (!confirmed) return { ok: false, reason: "confirmation_required" }
      rebuildPreview()
      if (!preview.ready) return { ok: false, reason: preview.status }
      let snapshot
      try {
        snapshot = createTaskInputSnapshot(preview, { createdAt, snapshotNonce })
      } catch {
        return { ok: false, reason: "snapshot_invalid" }
      }
      return snapshotStore.append(snapshot)
        ? { ok: true, snapshot: clone(snapshot) }
        : { ok: false, reason: "storage_failure" }
    },

    readCurrent() {
      return snapshotStore.readCurrent()
    },

    readHistory() {
      return snapshotStore.readAll().map((snapshot) => ({
        snapshot: clone(snapshot),
        source_changed: !snapshotMatchesPreview(snapshot, preview),
      })).reverse()
    },

    selectSnapshot(snapshotId) {
      return snapshotStore.selectCurrent(snapshotId)
    },
  }
}

function safeBrowserStorage(windowRef) {
  try {
    return windowRef?.localStorage ?? null
  } catch {
    return null
  }
}

function textElement(documentRef, name, text, className = "") {
  const element = documentRef.createElement(name)
  element.textContent = text
  if (className) element.className = className
  return element
}

function selectedAxes(snapshot) {
  return snapshot ? Object.values(snapshot.axes).flat() : []
}

function displayTitle(paper) {
  return paper.title_zh || paper.title_en || paper.paper_id
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : value
}

export function renderAgentTaskPage({ document: documentRef, session }) {
  const preview = session.readPreview()
  const current = session.readCurrent()
  const history = session.readHistory()
  const directionTags = documentRef.querySelector("#agent-direction-tags")
  const directionMeta = documentRef.querySelector("#agent-direction-meta")
  const paperList = documentRef.querySelector("#agent-paper-list")
  const inputStatus = documentRef.querySelector("#agent-input-status")
  const saveButton = documentRef.querySelector("#save-input-snapshot")
  const historyMount = documentRef.querySelector("#snapshot-history")

  directionTags?.replaceChildren(...selectedAxes(preview.direction_snapshot).map((value) => textElement(documentRef, "span", value)))
  if (directionTags && directionTags.childElementCount === 0) {
    directionTags.append(textElement(documentRef, "span", "尚未保存方向", "agent-empty-tag"))
  }
  if (directionMeta) {
    directionMeta.textContent = preview.direction_snapshot
      ? `保存于 ${formatTime(preview.direction_snapshot.saved_at)}`
      : "方向来源尚未建立"
  }

  paperList?.replaceChildren(...preview.papers.map((paper) => {
    const item = documentRef.createElement("li")
    item.append(
      textElement(documentRef, "strong", displayTitle(paper)),
      textElement(documentRef, "span", `${paper.paper_id} · ${paper.shelf_roles.length} 个用途`),
    )
    return item
  }))
  if (paperList && paperList.childElementCount === 0) {
    paperList.append(textElement(documentRef, "li", "用途架中暂无可用论文", "agent-empty-row"))
  }
  if (inputStatus) inputStatus.textContent = STATUS_TEXT[preview.status] ?? "输入状态未知。"
  if (saveButton) saveButton.disabled = !preview.ready

  historyMount?.replaceChildren(...history.map(({ snapshot, source_changed: sourceChanged }) => {
    const item = documentRef.createElement("li")
    item.className = current?.snapshot_id === snapshot.snapshot_id ? "agent-history-item agent-history-item--current" : "agent-history-item"
    const main = documentRef.createElement("div")
    main.append(
      textElement(documentRef, "strong", formatTime(snapshot.created_at)),
      textElement(documentRef, "span", `${snapshot.papers.length} 篇论文 · ${selectedAxes(snapshot.direction_snapshot).length} 个方向条件`),
    )
    if (sourceChanged) main.append(textElement(documentRef, "small", "来源已变化；旧快照保持不变", "agent-source-warning"))
    const button = textElement(documentRef, "button", current?.snapshot_id === snapshot.snapshot_id ? "当前" : "设为当前")
    button.type = "button"
    button.dataset.snapshotId = snapshot.snapshot_id
    button.disabled = current?.snapshot_id === snapshot.snapshot_id
    item.append(main, button)
    return item
  }))
  if (historyMount && historyMount.childElementCount === 0) {
    historyMount.append(textElement(documentRef, "li", "尚未固定输入快照", "agent-empty-row"))
  }
}

export async function initializeAgentTasks({
  document: documentRef,
  window: windowRef,
  loadIndex = loadAgentTaskPaperIndex,
} = {}) {
  const storage = safeBrowserStorage(windowRef)
  let paperIndex
  try {
    paperIndex = await loadIndex()
  } catch {
    paperIndex = null
  }
  const session = createAgentTaskSession({ storage, paperIndex })
  const status = documentRef?.querySelector("#agent-page-status")
  const confirm = documentRef?.querySelector("#snapshot-confirm")
  const saveButton = documentRef?.querySelector("#save-input-snapshot")
  const history = documentRef?.querySelector("#snapshot-history")

  const render = () => renderAgentTaskPage({ document: documentRef, session })
  render()

  saveButton?.addEventListener("click", () => {
    const result = session.saveCurrentInput({ confirmed: Boolean(confirm?.checked) })
    if (status) {
      status.textContent = result.ok
        ? "输入快照已固定；它不会随来源后续变化而改写。"
        : result.reason === "confirmation_required"
          ? "请先确认只保存当前输入，不运行任何模型。"
          : "输入快照未保存，请检查方向、用途架和浏览器存储。"
    }
    if (result.ok && confirm) confirm.checked = false
    render()
  })

  history?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-snapshot-id]")
    if (!button) return
    const selected = session.selectSnapshot(button.dataset.snapshotId)
    if (status) status.textContent = selected ? "已切换当前输入快照。" : "快照切换失败，历史未改动。"
    render()
  })

  windowRef?.addEventListener("storage", (event) => {
    const key = event?.key
    if (key !== DIRECTION_STORAGE_KEY
      && key !== WORKSPACE_STORAGE_KEY
      && key !== TASK_INPUT_STORAGE_KEY
      && !key?.startsWith(`${TASK_INPUT_STORAGE_KEY}.`)) return
    session.refresh()
    render()
  })
  return session
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeAgentTasks({ document, window })
}
