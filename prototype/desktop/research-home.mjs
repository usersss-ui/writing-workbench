import { openWorkbenchStorage } from "./workbench-storage.mjs"
import { createDirectionSnapshotStore, DIRECTION_STORAGE_KEY } from "./direction-snapshot.mjs"
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY } from "./paper-library-storage.mjs"
import { createP02WorkflowStore, P02_WORKFLOW_STORAGE_KEY } from "./p02-workflow.mjs"

const LIBRARY = "../../local_library_output/desktop/library.html"
const DISCOVERY = "../../local_library_output/desktop/discovery.html"
const INDEX = "../../local_library_data/paper-index.json"
const KEYS = new Set([DIRECTION_STORAGE_KEY, WORKSPACE_STORAGE_KEY, P02_WORKFLOW_STORAGE_KEY])

export function summarizeHome({ direction, workspace, workflow, papers }) {
  const axes = direction?.axes ? Object.values(direction.axes).flat() : []
  const query = axes.join(" ")
  const records = Array.isArray(papers) ? papers : null
  const knownIds = new Set(records?.map((paper) => paper.paper_id) ?? [])
  const markedRead = Object.entries(workspace?.personalReading ?? {})
    .filter(([id, marker]) => knownIds.has(id) && marker === "read").length
  const hasWriting = Object.values(workflow?.writing ?? {}).some((value) => typeof value === "string" && value.trim())
  const selected = workspace?.selectedPaperId
  const selectedHref = knownIds.has(selected) ? `${LIBRARY}?paper_id=${encodeURIComponent(selected)}` : `${LIBRARY}#library-results`
  let next = { title: "先确定一个想研究的方向", description: "选择主题与问题条件，然后搜索本地已有论文和网上的新论文。", label: "确定方向 →", href: "./directions.html" }
  if (hasWriting) next = { title: "继续你的期刊选择与写作草稿", description: "回到已保存的材料，继续编辑章节或导出 Markdown。", label: "继续写作 →", href: "./p02-writing.html" }
  else if (axes.length && markedRead) next = { title: "把阅读笔记带进写作", description: "记录候选期刊，开始整理章节。需要补读时，随时回到论文库。", label: "开始整理写作 →", href: "./p02-writing.html" }
  else if (axes.length && records?.length) next = { title: "选一篇论文，开始阅读和记笔记", description: "本地已有资料。先打开原文或已有笔记，再记录自己的理解。", label: "继续阅读 →", href: selectedHref }
  else if (axes.length) next = { title: "按保存的方向搜索论文", description: "先查本地资料，也可以到网上搜索新论文。", label: "搜索论文 →", href: `${DISCOVERY}?q=${encodeURIComponent(query)}` }
  return {
    next, query,
    direction: axes.length ? axes.join(" · ") : "还没有保存研究方向。先从一个问题开始。",
    paperCount: records === null ? "—" : String(records.length),
    noteCount: records === null ? "—" : String(records.filter((paper) => paper.note_status === "notes_ready").length),
    readCount: records === null || !workspace ? "—" : String(markedRead),
    localHref: `${LIBRARY}${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    onlineHref: `${DISCOVERY}${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  }
}

export function readHomeState(storage) {
  const direction = createDirectionSnapshotStore(storage)
  const directionState = direction.readValidatedState()
  const workspace = createWorkspaceStore(storage).readValidatedState()
  const workflow = createP02WorkflowStore(storage).readValidatedState()
  const trouble = [directionState, workspace, workflow].some(({ status }) => ["invalid", "unavailable"].includes(status))
  return {
    direction: directionState.status === "valid" ? directionState.state : null,
    workspace: ["valid", "missing"].includes(workspace.status) ? workspace.state : null,
    workflow: ["valid", "missing"].includes(workflow.status) ? workflow.state : null,
    trouble,
  }
}

export async function initializeResearchHome({ document: doc, window: win, storage, fetchImpl }) {
  let papers = null
  let indexMessage = ""
  let latestIndexRequest = 0
  const text = (id, value) => { const el = doc.getElementById(id); if (el) el.textContent = value }
  const href = (id, value) => { const el = doc.getElementById(id); if (el) el.href = value }
  function render() {
    const state = readHomeState(storage)
    const view = summarizeHome({ ...state, papers })
    text("home-next-title", view.next.title)
    text("home-next-description", view.next.description)
    text("home-continue", view.next.label)
    href("home-continue", view.next.href)
    text("home-direction", view.direction)
    text("home-paper-count", view.paperCount)
    text("home-note-count", view.noteCount)
    text("home-read-count", view.readCount)
    href("home-local-search", view.localHref)
    href("home-online-search", view.onlineHref)
    const status = [
      state.trouble ? "部分保存记录无法读取，原记录已保留。可从“更多工具 → 备份与恢复”检查。" : "",
      indexMessage,
    ].filter(Boolean).join(" ")
    text("home-status", status || "读取本机论文索引与当前浏览器记录；下面每一步都可以直接进入。")
  }
  async function refreshIndex() {
    const request = ++latestIndexRequest
    papers = null
    indexMessage = "正在刷新论文与笔记数量…"
    render()
    try {
      const response = await fetchImpl(INDEX, { cache: "no-store" })
      if (!response.ok) throw new Error("index_unavailable")
      const index = await response.json()
      if (request !== latestIndexRequest) return
      if (![2, 3].includes(index?.version) || !Array.isArray(index.papers)
        || index.papers.some((paper) => typeof paper?.paper_id !== "string" || typeof paper.note_status !== "string")) throw new Error("invalid_index")
      papers = index.papers
      indexMessage = ""
    } catch {
      if (request !== latestIndexRequest) return
      papers = null
      indexMessage = "论文库刷新失败，数量显示为 —。请检查本地服务；返回本页或刷新可重试。"
    }
    render()
  }
  win.addEventListener("storage", (event) => { if (event.key === null || KEYS.has(event.key)) render() })
  win.addEventListener("pageshow", (event) => event.persisted ? refreshIndex() : render())
  win.addEventListener("focus", refreshIndex)
  await refreshIndex()
  return { refresh: refreshIndex }
}

if (typeof document !== "undefined" && document.getElementById("home-continue")) {
  let storage
  try { storage = openWorkbenchStorage({ windowRef: window }) } catch { storage = undefined }
  initializeResearchHome({ document, window, storage, fetchImpl: window.fetch.bind(window) })
}
