import { renderPreviewMath } from "./paper-math-renderer.mjs"
import { ROOT_GROUP, buildProjectModel, defaultProjectPath, groupProjectFiles, resolveProjectLink, sectionModels, segmentsText, sourceLinks, tableFilesByPath } from "./paper-project-model.mjs"

const PROJECTS_ENDPOINT = "/api/v1/paper-projects"
const INDEX_URL = "../../local_library_data/paper-index.json"
const FILE_STATUS = Object.freeze({ ok: "已读取", partial: "部分可读", missing: "尚未生成", unreadable: "无法读取" })
const TABLE_STATUS = Object.freeze({ missing: "缺少这张表", unparseable: "无法解析" })
// The controlled renderer leaves Markdown links as text; the reader turns them
// into in-project navigation, external links, or plain labels.
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/gu
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
    tableStatus: $("#pp-table-status"),
    browser: $("#pp-browser"),
    tree: $("#pp-tree"),
    readerPath: $("#pp-reader-path"),
    readerTitle: $("#pp-reader-title"),
    readerActions: $("#pp-reader-actions"),
    readerBody: $("#pp-reader-body"),
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

  function statusChip(file) {
    const available = file.status !== "missing"
    const chip = element(documentRef, available ? "button" : "span", `pp-chip pp-chip--${file.status}`)
    const label = file.status === "partial" && !file.tables.some((table) => table.status === "ok") ? "未按固定表头" : FILE_STATUS[file.status] ?? file.status
    chip.append(element(documentRef, "strong", null, file.title), element(documentRef, "span", null, label))
    if (available) {
      chip.type = "button"
      chip.addEventListener("click", () => openPath(file.path))
    } else {
      chip.title = `目录中还没有 ${file.path}`
    }
    return chip
  }

  function renderTree() {
    ui.tree.replaceChildren()
    const tableFiles = tableFilesByPath(current)
    for (const group of groupProjectFiles(current)) {
      const details = element(documentRef, "details", "pp-tree-group")
      details.open = group.markdown.length > 0 && group.markdown.length <= 40
      const summary = element(documentRef, "summary")
      summary.append(element(documentRef, "span", null, group.name), element(documentRef, "span", "pp-tree-count", String(group.markdown.length + group.otherCount)))
      details.append(summary)
      const list = element(documentRef, "ul")
      for (const path of group.markdown) {
        const item = element(documentRef, "li")
        const button = element(documentRef, "button", "pp-tree-item", group.name === ROOT_GROUP ? path : path.slice(group.name.length + 1))
        button.type = "button"
        button.dataset.path = path
        button.title = path
        if (tableFiles.has(path)) button.append(element(documentRef, "span", "pp-tree-badge", "表"))
        button.addEventListener("click", () => openPath(path))
        item.append(button)
        list.append(item)
      }
      if (group.otherCount) list.append(element(documentRef, "li", "pp-tree-note", `另有 ${group.otherCount} 个非 Markdown 文件`))
      details.append(list)
      ui.tree.append(details)
    }
    for (const name of current.collapsed_directories ?? []) ui.tree.append(element(documentRef, "p", "pp-tree-note", `${name}/ 未展开：不属于写作流程`))
    if (current.skipped_links > 0) ui.tree.append(element(documentRef, "p", "pp-tree-note", `跳过了 ${current.skipped_links} 个符号链接`))
    if (current.truncated) ui.tree.append(element(documentRef, "p", "pp-tree-note", "文件过多，只列出前 2000 个"))
    if (current.files.length === 0) ui.tree.append(element(documentRef, "p", "pp-tree-note", "目录是空的。"))
  }

  function setReader(path, title) {
    // After scrolling deep into a long file, bring the next file's title back into view.
    const main = ui.browser.closest(".main-column")
    const headTop = ui.readerTitle.getBoundingClientRect().top
    const mainTop = main?.getBoundingClientRect().top ?? 0
    if (main && headTop < mainTop) main.scrollTop += headTop - mainTop - 60
    ui.readerPath.textContent = path
    ui.readerTitle.textContent = title
    ui.readerActions.replaceChildren()
    ui.readerBody.replaceChildren()
    for (const button of ui.tree.querySelectorAll(".pp-tree-item")) {
      if (button.dataset.path === path) button.setAttribute("aria-current", "true")
      else button.removeAttribute("aria-current")
    }
    const url = new URL(windowRef.location.href)
    url.searchParams.set("project", current.project_id)
    url.searchParams.set("file", path)
    windowRef.history.replaceState(null, "", url)
  }

  function readerButton(label, onClick) {
    const button = element(documentRef, "button", "button button--secondary button--small", label)
    button.type = "button"
    button.addEventListener("click", onClick)
    ui.readerActions.append(button)
  }

  function showTables(file) {
    setReader(file.path, file.title)
    readerButton("按原文显示", () => showMarkdown(file.path, { title: file.title, tableFile: file }))
    for (const table of file.tables) {
      ui.readerBody.append(element(documentRef, "h3", "pp-table-title", table.heading))
      if (table.status === "ok") ui.readerBody.append(tableNode(table))
      else ui.readerBody.append(element(documentRef, "p", "pp-warning", `${TABLE_STATUS[table.status] ?? table.status}${table.reason ? `：${table.reason}` : `：文件中没有“## ${table.heading}”`}`))
    }
    if (file.key === "mapping") {
      const viewer = sectionViewer()
      if (viewer) ui.readerBody.append(viewer)
    }
  }

  function linkifyMarkdown(root, fromPath) {
    const available = new Set(current.files.map((file) => file.path))
    const walker = documentRef.createTreeWalker(root, windowRef.NodeFilter?.SHOW_TEXT ?? 4)
    const nodes = []
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement?.closest("code, pre, .math-inline, .math-display")) nodes.push(walker.currentNode)
    }
    for (const node of nodes) {
      const text = node.nodeValue
      const matches = [...text.matchAll(MARKDOWN_LINK)]
      if (matches.length === 0) continue
      const fragment = documentRef.createDocumentFragment()
      let cursor = 0
      for (const match of matches) {
        const [whole, label, target] = match
        fragment.append(text.slice(cursor, match.index))
        const resolved = resolveProjectLink(fromPath, target)
        if (resolved?.endsWith(".md") && available.has(resolved)) {
          const button = element(documentRef, "button", "pp-inline-link", label)
          button.type = "button"
          button.title = resolved
          button.addEventListener("click", () => openPath(resolved))
          fragment.append(button)
        } else if (/^https?:\/\//iu.test(target)) {
          const link = element(documentRef, "a", "pp-inline-link", label)
          link.href = target
          link.target = "_blank"
          link.rel = "noopener noreferrer"
          fragment.append(link)
        } else {
          const plain = element(documentRef, "span", null, label)
          plain.title = target
          fragment.append(plain)
        }
        cursor = match.index + whole.length
      }
      fragment.append(text.slice(cursor))
      node.replaceWith(fragment)
    }
  }

  async function showMarkdown(path, { title = path.split("/").pop(), tableFile = null, notice = null } = {}) {
    setReader(path, title)
    if (tableFile?.tables.some((table) => table.status === "ok")) readerButton("按表格显示", () => showTables(tableFile))
    if (notice) ui.readerBody.append(element(documentRef, "p", "pp-warning", notice))
    const body = element(documentRef, "div", "pp-markdown")
    body.append(element(documentRef, "p", "pp-muted", "正在读取…"))
    ui.readerBody.append(body)
    try {
      const file = await fetchJson(fetchImpl, `${PROJECTS_ENDPOINT}/${encodeURIComponent(current.project_id)}/files/${encodeURIComponent(path)}`)
      if (ui.readerPath.textContent !== path) return
      // The server renders through the same controlled Markdown renderer as note previews.
      const template = documentRef.createElement("template")
      template.innerHTML = file.html
      body.replaceChildren(template.content)
      linkifyMarkdown(body, path)
      renderPreviewMath(body)
    } catch (error) {
      body.replaceChildren(element(documentRef, "p", "pp-warning", error.message))
    }
  }

  function openPath(path) {
    const file = tableFilesByPath(current).get(path)
    if (!file) { showMarkdown(path); return }
    if (file.tables.some((table) => table.status === "ok")) { showTables(file); return }
    const expected = file.tables.map((table) => `“## ${table.heading}”`).join("、")
    showMarkdown(path, {
      title: file.title,
      tableFile: file,
      notice: file.status === "unreadable" ? null : `这个文件还没按固定表头组织（缺少或无法解析 ${expected}），下面按原文显示，其中的出处不会变成链接。`,
    })
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

  function render() {
    ui.title.textContent = current.project_id
    const verified = current.references.filter((row) => row["核实"]?.startsWith("已核实")).length
    const local = [...model.references.values()].filter((entry) => entry.library.status === "confirmed").length
    ui.summary.textContent = current.layout
      ? `文献 ${current.references.length} 篇（已核实 ${verified}，论文库已有 ${local}）· 稿件 ${current.drafts.length} 个文件 · 目录共 ${current.files.length} 个文件`
      : "这个目录未声明 paper-writing-workflow 布局，只列出文件，不解析表格。"
    ui.tableStatus.replaceChildren()
    for (const file of current.layout ? [...current.tables, ...current.reviews] : []) ui.tableStatus.append(statusChip(file))
    ui.tableStatus.hidden = !current.layout
    renderTree()
    ui.browser.hidden = false
    const requested = new URLSearchParams(windowRef.location?.search ?? "").get("file")
    const available = new Set(current.files.map((file) => file.path))
    const initial = requested?.endsWith(".md") && available.has(requested) ? requested : defaultProjectPath(current)
    if (initial) openPath(initial)
    else {
      ui.readerTitle.textContent = "没有可阅读的 Markdown 文件"
      ui.readerPath.textContent = ""
    }
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
      ui.browser.hidden = true
      ui.tableStatus.hidden = true
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
      url.searchParams.delete("file")
      windowRef.history.replaceState(null, "", url)
      loadProject(ui.select.value)
    })
    await loadProject(initial.project_id)
  }

  return { start }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializePaperProject({ document, window }).start()
}
