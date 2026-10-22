import { renderPreviewMath } from "./paper-math-renderer.mjs"
import { buildProjectModel, sectionModels, segmentsText, sourceLinks } from "./paper-project-model.mjs"

const PROJECTS_ENDPOINT = "/api/v1/paper-projects"
const INDEX_URL = "../../local_library_data/paper-index.json"
const FILE_STATUS = Object.freeze({ ok: "已读取", partial: "部分可读", missing: "尚未生成", unreadable: "无法读取" })
const TABLE_STATUS = Object.freeze({ missing: "缺少这张表", unparseable: "无法解析" })
const LIBRARY_STATUS = Object.freeze({
  confirmed: "论文库已有（DOI 一致）",
  code_hint: "论文库有同编号论文，未经 DOI 核验",
  possible: "论文库可能有，需人工核对",
  not_found: "论文库中没有",
  unknown: "论文库索引不可用",
})

function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = text
  return node
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: "no-store" })
  let body = null
  try { body = await response.json() } catch { body = null }
  if (!response.ok) throw new Error(body?.error?.message ?? `读取失败（${response.status}）`)
  return body
}

export function initializePaperProject({ document: documentRef, window: windowRef, fetchImpl = windowRef.fetch.bind(windowRef) }) {
  const $ = (selector) => documentRef.querySelector(selector)
  const ui = {
    select: $("#pp-project-select"),
    title: $("#pp-title"),
    summary: $("#pp-summary"),
    empty: $("#pp-empty"),
    jump: $("#pp-jump"),
    sections: $("#pp-sections"),
    fileView: $("#pp-file-view"),
    fileTitle: $("#pp-file-title"),
    fileBody: $("#pp-file-body"),
    fileClose: $("#pp-file-close"),
    inspectorTitle: $("#pp-inspector-title"),
    inspectorBody: $("#pp-inspector-body"),
  }
  let current = null
  let model = null

  function referenceNode(segment) {
    const { code, location, known } = segment.reference
    if (!known) {
      const broken = element(documentRef, "span", "pp-ref pp-ref--broken", segment.text)
      broken.title = `文献清单中找不到 ${code}`
      return broken
    }
    const button = element(documentRef, "button", "pp-ref", segment.text)
    button.type = "button"
    button.addEventListener("click", () => showReference({ code, location }))
    return button
  }

  function cellNode(segments, tag = "td") {
    const cell = element(documentRef, tag)
    for (const segment of segments ?? []) cell.append(segment.reference ? referenceNode(segment) : documentRef.createTextNode(segment.text))
    return cell
  }

  function tableNode(table) {
    const wrapper = element(documentRef, "div", "pp-table-scroll")
    const node = element(documentRef, "table", "pp-table")
    const headRow = element(documentRef, "tr")
    for (const header of table.headers) headRow.append(element(documentRef, "th", null, header))
    node.append(element(documentRef, "thead"))
    node.tHead.append(headRow)
    const body = element(documentRef, "tbody")
    for (const row of table.rows) {
      const tr = element(documentRef, "tr")
      row.forEach((segments) => tr.append(cellNode(segments)))
      body.append(tr)
    }
    if (table.rows.length === 0) {
      const tr = element(documentRef, "tr")
      const td = element(documentRef, "td", "pp-table-empty", "表格还没有内容")
      td.colSpan = table.headers.length
      tr.append(td)
      body.append(tr)
    }
    node.append(body)
    wrapper.append(node)
    return wrapper
  }

  function sectionViewer() {
    const sections = sectionModels(current)
    if (sections.length === 0) return null
    const box = element(documentRef, "div", "pp-section-view")
    const label = element(documentRef, "label", "pp-section-picker")
    label.append(element(documentRef, "span", null, "按小节看"))
    const select = element(documentRef, "select")
    for (const section of sections) {
      const option = element(documentRef, "option", null, `${section.id} ${section.title}`)
      option.value = String(section.index)
      select.append(option)
    }
    label.append(select)
    const detail = element(documentRef, "div", "pp-section-detail")
    const style = current.tables.find((file) => file.key === "style")?.tables?.find((table) => table.heading === "写法")
    const show = () => {
      const section = sections[Number(select.value)]
      detail.replaceChildren()
      const facts = element(documentRef, "dl", "pp-facts")
      const add = (term, content) => {
        facts.append(element(documentRef, "dt", null, term))
        const value = element(documentRef, "dd")
        if (typeof content === "string") value.textContent = content || "—"
        else value.append(...(content.length ? content.map((segment) => segment.reference ? referenceNode(segment) : documentRef.createTextNode(segment.text)) : [documentRef.createTextNode("—")]))
        facts.append(value)
      }
      add("稿件文件", section.file ? `01_稿件/${section.file}` : "")
      add("本刊范文", section.journalExamples ?? [])
      add("非本刊范文", section.otherExamples ?? [])
      add("本刊容忍度要点", section.tolerance)
      add("目标篇幅", section.length)
      add("起草方式", section.mode)
      detail.append(facts)
      if (!segmentsText(section.journalExamples).trim()) {
        detail.append(element(documentRef, "p", "pp-warning", "这个小节还没有本刊范文；按流程，在找到范文之前不应起草。"))
      }
      if (style?.status === "ok") {
        detail.append(element(documentRef, "h4", null, "起草时对照的本刊写法"))
        detail.append(tableNode(style))
      }
    }
    select.addEventListener("change", show)
    show()
    box.append(label, detail)
    return box
  }

  function fileSection(file) {
    const section = element(documentRef, "section", "panel pp-section")
    section.id = `pp-${file.key}-${file.path.replace(/[^A-Za-z0-9]+/gu, "-")}`
    const heading = element(documentRef, "div", "section-heading")
    const titleBox = element(documentRef, "div")
    titleBox.append(element(documentRef, "p", "eyebrow", file.path), element(documentRef, "h2", null, file.title))
    const status = element(documentRef, "span", `status ${file.status === "ok" ? "status--published" : "status--warning"}`, FILE_STATUS[file.status] ?? file.status)
    heading.append(titleBox, status)
    section.append(heading)
    if (file.status === "missing" || file.status === "unreadable") {
      section.append(element(documentRef, "p", "pp-muted", file.status === "missing" ? `目录中还没有 ${file.path}。` : `${file.path} 不是有效的 UTF-8 文本或超过大小上限。`))
      return section
    }
    for (const table of file.tables) {
      section.append(element(documentRef, "h3", "pp-table-title", table.heading))
      if (table.status === "ok") section.append(tableNode(table))
      else section.append(element(documentRef, "p", "pp-warning", `${TABLE_STATUS[table.status] ?? table.status}${table.reason ? `：${table.reason}` : `：文件中没有“## ${table.heading}”`}`))
    }
    if (file.key === "mapping") {
      const viewer = sectionViewer()
      if (viewer) section.append(viewer)
    }
    return section
  }

  function filesSection() {
    const section = element(documentRef, "section", "panel pp-section")
    section.id = "pp-files"
    const heading = element(documentRef, "div", "section-heading")
    const titleBox = element(documentRef, "div")
    titleBox.append(element(documentRef, "p", "eyebrow", "目录"), element(documentRef, "h2", null, "全部文件"))
    heading.append(titleBox)
    section.append(heading)
    const notes = []
    if (current.skipped_links > 0) notes.push(`跳过了 ${current.skipped_links} 个符号链接`)
    if (current.truncated) notes.push("文件过多，只列出前 2000 个")
    if (notes.length) section.append(element(documentRef, "p", "pp-muted", `${notes.join("；")}。`))
    const list = element(documentRef, "ul", "pp-file-list")
    for (const file of current.files) {
      const item = element(documentRef, "li")
      if (file.path.endsWith(".md")) {
        const button = element(documentRef, "button", "pp-file-link", file.path)
        button.type = "button"
        button.addEventListener("click", () => showFile(file.path))
        item.append(button)
      } else {
        item.append(element(documentRef, "span", "pp-muted", file.path))
      }
      list.append(item)
    }
    if (current.files.length === 0) list.append(element(documentRef, "li", "pp-muted", "目录是空的。"))
    section.append(list)
    return section
  }

  function showReference({ code, location }) {
    const entry = model.references.get(code)
    ui.inspectorTitle.textContent = location ? `${code}·${location}` : code
    ui.inspectorBody.replaceChildren()
    const info = element(documentRef, "section", "inspector-section")
    if (!entry) {
      info.append(element(documentRef, "p", "pp-warning", `文献清单中找不到 ${code}。`))
      ui.inspectorBody.append(info)
      return
    }
    const facts = element(documentRef, "dl", "pp-facts")
    for (const field of ["题名", "作者", "年份", "期刊或会议", "DOI", "角色", "核实"]) {
      facts.append(element(documentRef, "dt", null, field), element(documentRef, "dd", null, entry.row[field] || "—"))
    }
    info.append(element(documentRef, "h3", null, "文献清单"), facts)
    ui.inspectorBody.append(info)

    const library = element(documentRef, "section", "inspector-section")
    library.append(element(documentRef, "h3", null, "原文"))
    library.append(element(documentRef, "p", entry.library.status === "confirmed" ? null : "pp-muted", LIBRARY_STATUS[entry.library.status] ?? entry.library.status))
    if (entry.library.status === "confirmed") {
      const parts = [entry.library.pdfUrl ? "有 PDF" : "无 PDF", entry.library.hasOcr ? "有 OCR" : "无 OCR", entry.library.hasNote ? "有笔记" : "无笔记"]
      library.append(element(documentRef, "p", "pp-muted", parts.join(" · ")))
    } else if (entry.library.reason) {
      library.append(element(documentRef, "p", "pp-muted", entry.library.reason))
    }
    for (const candidate of entry.library.candidates) library.append(element(documentRef, "p", "pp-muted", `候选：${candidate.paperId} ${candidate.title}`))
    const links = sourceLinks({ code, location }, entry)
    const actions = element(documentRef, "div", "pp-actions")
    if (links.pdfPage) {
      const pdf = element(documentRef, "a", "button button--primary button--small", `打开 PDF 第 ${/\d+/u.exec(location)[0]} 页`)
      pdf.href = links.pdfPage
      pdf.target = "_blank"
      pdf.rel = "noopener"
      actions.append(pdf)
    }
    if (links.library) {
      const open = element(documentRef, "a", "button button--secondary button--small", "在论文库打开原文材料")
      open.href = links.library
      actions.append(open)
    }
    if (actions.childElementCount) library.append(actions)
    if (location && !links.pdfPage && links.library) library.append(element(documentRef, "p", "pp-muted", `打开后请在原文中找到“${location}”；平台不对小节标题做模糊匹配。`))
    if (!links.library && entry.row.PDF) library.append(element(documentRef, "p", "pp-muted", `项目内 PDF：相关论文/${entry.row.PDF}`))
    ui.inspectorBody.append(library)

    const uses = model.uses.get(code) ?? []
    const usage = element(documentRef, "section", "inspector-section")
    usage.append(element(documentRef, "h3", null, `用在哪（${uses.length} 处）`))
    const list = element(documentRef, "ul", "pp-use-list")
    for (const use of uses) {
      const parts = use.heading ? [use.title, use.heading, use.row, use.column] : [use.path]
      const item = element(documentRef, "li", null, parts.filter(Boolean).join(" · "))
      if (use.location) item.append(element(documentRef, "span", "pp-muted", ` 〔${use.location}〕`))
      list.append(item)
    }
    if (uses.length === 0) list.append(element(documentRef, "li", "pp-muted", "其他表格和稿件中都还没有用到。"))
    usage.append(list)
    ui.inspectorBody.append(usage)
  }

  async function showFile(path) {
    ui.fileView.hidden = false
    ui.fileTitle.textContent = path
    ui.fileBody.replaceChildren(element(documentRef, "p", "pp-muted", "正在读取…"))
    ui.fileView.scrollIntoView({ block: "start" })
    try {
      const file = await fetchJson(fetchImpl, `${PROJECTS_ENDPOINT}/${encodeURIComponent(current.project_id)}/files/${encodeURIComponent(path)}`)
      // The server renders through the same controlled Markdown renderer as note previews.
      const template = documentRef.createElement("template")
      template.innerHTML = file.html
      ui.fileBody.replaceChildren(template.content)
      renderPreviewMath(ui.fileBody)
    } catch (error) {
      ui.fileBody.replaceChildren(element(documentRef, "p", "pp-warning", error.message))
    }
  }

  function render() {
    ui.title.textContent = current.project_id
    ui.sections.replaceChildren()
    ui.jump.replaceChildren()
    ui.fileView.hidden = true
    const files = current.layout ? [...current.tables, ...current.reviews] : []
    const verified = current.references.filter((row) => row["核实"]?.startsWith("已核实")).length
    const local = [...model.references.values()].filter((entry) => entry.library.status === "confirmed").length
    ui.summary.textContent = current.layout
      ? `文献 ${current.references.length} 篇（已核实 ${verified}，论文库已有 ${local}）· 稿件 ${current.drafts.length} 个文件 · 目录共 ${current.files.length} 个文件`
      : `这个目录未声明 paper-writing-workflow 布局，只列出文件，不解析表格。`
    for (const file of files) {
      const section = fileSection(file)
      ui.sections.append(section)
      const link = element(documentRef, "a", null, file.title)
      link.href = `#${section.id}`
      ui.jump.append(link)
    }
    ui.sections.append(filesSection())
    const filesLink = element(documentRef, "a", null, "全部文件")
    filesLink.href = "#pp-files"
    ui.jump.append(filesLink)
    ui.jump.hidden = false
  }

  async function loadProject(projectId) {
    ui.summary.textContent = "正在读取项目目录…"
    try {
      const [project, index] = await Promise.all([
        fetchJson(fetchImpl, `${PROJECTS_ENDPOINT}/${encodeURIComponent(projectId)}`),
        fetchJson(fetchImpl, INDEX_URL).catch(() => null),
      ])
      current = project
      model = buildProjectModel(project, Array.isArray(index?.papers) ? index.papers : null)
      render()
    } catch (error) {
      current = null
      ui.sections.replaceChildren()
      ui.jump.hidden = true
      ui.summary.textContent = error.message
    }
  }

  async function start() {
    let projects
    try {
      projects = (await fetchJson(fetchImpl, PROJECTS_ENDPOINT)).projects
    } catch (error) {
      ui.summary.textContent = error.message
      return
    }
    if (projects.length === 0) {
      ui.summary.textContent = "还没有登记论文项目。"
      ui.empty.hidden = false
      return
    }
    for (const project of projects) {
      const option = element(documentRef, "option", null, project.available ? project.project_id : `${project.project_id}（目录不可用）`)
      option.value = project.project_id
      ui.select.append(option)
    }
    const requested = new URLSearchParams(windowRef.location?.search ?? "").get("project")
    const initial = projects.find((project) => project.project_id === requested) ?? projects.find((project) => project.available) ?? projects[0]
    ui.select.value = initial.project_id
    ui.select.disabled = false
    ui.select.addEventListener("change", () => {
      const url = new URL(windowRef.location.href)
      url.searchParams.set("project", ui.select.value)
      windowRef.history.replaceState(null, "", url)
      loadProject(ui.select.value)
    })
    ui.fileClose.addEventListener("click", () => { ui.fileView.hidden = true })
    await loadProject(initial.project_id)
  }

  return { start }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializePaperProject({ document, window }).start()
}
