import { openWorkbenchStorage } from "./workbench-storage.mjs"
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY } from "./paper-library-storage.mjs"

const INDEX = "../../local_library_data/paper-index.json"
const PROJECTS = "/api/v1/paper-projects"
const KEYS = new Set([WORKSPACE_STORAGE_KEY])

export function summarizeHome({ workspace, papers }) {
  const records = Array.isArray(papers) ? papers : null
  const knownIds = new Set(records?.map((paper) => paper.paper_id) ?? [])
  const markedRead = Object.entries(workspace?.personalReading ?? {})
    .filter(([id, marker]) => knownIds.has(id) && marker === "read").length
  return {
    paperCount: records === null ? "—" : String(records.length),
    noteCount: records === null ? "—" : String(records.filter((paper) => paper.note_status === "notes_ready").length),
    readCount: records === null || !workspace ? "—" : String(markedRead),
  }
}

export function readHomeState(storage) {
  const workspace = createWorkspaceStore(storage).readValidatedState()
  return {
    workspace: ["valid", "missing"].includes(workspace.status) ? workspace.state : null,
    trouble: ["invalid", "unavailable"].includes(workspace.status),
  }
}

// Registered writing projects as the home page lists them; `null` means the list could not be read.
export function summarizeProjects(payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.projects)) return null
  return payload.projects
    .filter((project) => typeof project?.project_id === "string")
    .map((project) => ({
      id: project.project_id,
      available: project.available === true,
      href: `./paper-project.html?project=${encodeURIComponent(project.project_id)}`,
    }))
}

export async function initializeResearchHome({ document: doc, window: win, storage, fetchImpl }) {
  let papers = null
  let indexMessage = ""
  let latestIndexRequest = 0
  const text = (id, value) => { const el = doc.getElementById(id); if (el) el.textContent = value }
  function render() {
    const state = readHomeState(storage)
    const view = summarizeHome({ ...state, papers })
    text("home-paper-count", view.paperCount)
    text("home-note-count", view.noteCount)
    text("home-read-count", view.readCount)
    const status = [
      state.trouble ? "部分保存记录无法读取，原记录已保留。可从“更多工具 → 备份与恢复”检查。" : "",
      indexMessage,
    ].filter(Boolean).join(" ")
    text("home-status", status || "")
  }
  async function loadProjects() {
    const list = doc.getElementById("home-projects")
    if (typeof list?.replaceChildren !== "function" || typeof doc.createElement !== "function") return
    let projects = null
    try {
      const response = await fetchImpl(PROJECTS, { cache: "no-store" })
      projects = response.ok ? summarizeProjects(await response.json()) : null
    } catch {
      projects = null
    }
    const note = (message) => {
      const item = doc.createElement("li")
      item.className = "home-project-empty"
      item.textContent = message
      return item
    }
    if (projects === null) { list.replaceChildren(note("写作项目列表读取失败，请检查本地服务后刷新。")); return }
    if (projects.length === 0) {
      list.replaceChildren(note("还没有登记写作项目：在 平台/local_library_config/paper-projects.local.json 中登记后刷新本页。"))
      return
    }
    list.replaceChildren(...projects.map((project) => {
      const item = doc.createElement("li")
      item.className = "home-project"
      const name = doc.createElement("strong")
      name.textContent = project.id
      item.append(name)
      if (project.available) {
        const open = doc.createElement("a")
        open.className = "button button--primary button--small"
        open.href = project.href
        open.textContent = "打开小节—范文 →"
        item.append(open)
      } else {
        const missing = doc.createElement("span")
        missing.className = "home-project-unavailable"
        missing.textContent = "目录不可用"
        item.append(missing)
      }
      return item
    }))
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
  await Promise.all([refreshIndex(), loadProjects()])
  return { refresh: refreshIndex }
}

if (typeof document !== "undefined" && document.getElementById("home-paper-count")) {
  let storage
  try { storage = openWorkbenchStorage({ windowRef: window }) } catch { storage = undefined }
  initializeResearchHome({ document, window, storage, fetchImpl: window.fetch.bind(window) })
}
