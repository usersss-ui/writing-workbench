import { paperLibraryDetailHref } from "./direction-snapshot.mjs"
import { matchLocalPaper } from "./local-paper-match.mjs"

// Joins a parsed paper project with the local paper index. A reference counts
// as a local paper only through the same identity rule as the discovery page
// (a unique DOI); an equal short code is shown as a hint, never as a match.

export function splitValues(text) {
  return String(text ?? "").split("；").map((value) => value.trim()).filter(Boolean)
}

export function segmentsText(segments) {
  return (segments ?? []).map((segment) => segment.text).join("")
}

function firstUrl(documents) {
  return Array.isArray(documents) ? documents.find((document) => typeof document?.url === "string" && document.url)?.url ?? null : null
}

const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s,，;；)）|]+/u

// `work` comes from a fixed-header row, or only a code and citation text for
// projects written before the fixed headers.
function libraryEntry({ code, doi, title, authors, year }, papers) {
  let result
  try {
    result = matchLocalPaper({ doi: doi || null, paperId: null, title: title ?? null, authors: authors ?? [], year: Number.isInteger(year) ? year : null }, papers)
  } catch {
    result = { status: "unknown", matches: [], reason: "本地论文索引不可用，无法对照。" }
  }
  const confirmedId = ["existing_pdf", "missing_pdf"].includes(result.status) ? result.matches[0]?.paperId ?? null : null
  const hintId = !confirmedId && Array.isArray(papers) && papers.some((paper) => paper?.paper_id === code) ? code : null
  const paper = confirmedId ? papers.find((candidate) => candidate.paper_id === confirmedId) : null
  if (confirmedId) {
    return {
      status: "confirmed",
      paperId: confirmedId,
      reason: result.reason,
      pdfUrl: firstUrl(paper?.source_documents?.pdf),
      hasOcr: Boolean(firstUrl(paper?.source_documents?.ocr)),
      hasNote: result.matches[0]?.hasNote === true,
      candidates: [],
    }
  }
  return {
    status: hintId ? "code_hint" : result.status === "possible_match" ? "possible" : result.status === "unknown" ? "unknown" : "not_found",
    paperId: hintId,
    reason: hintId ? "短码与论文库编号相同，但没有 DOI 核验，需人工核对是否同一篇。" : result.reason,
    pdfUrl: null,
    hasOcr: false,
    hasNote: false,
    candidates: (result.matches ?? []).map((match) => ({ paperId: match.paperId, title: match.title })),
  }
}

function addUse(uses, code, use) {
  const list = uses.get(code) ?? []
  const key = JSON.stringify(use)
  if (!list.some((existing) => JSON.stringify(existing) === key)) list.push(use)
  uses.set(code, list)
}

function collectTableUses(uses, file) {
  for (const table of file.tables ?? []) {
    if (table.status !== "ok") continue
    for (const row of table.rows) {
      const rowLabel = segmentsText(row[0])
      row.forEach((segments, columnIndex) => {
        for (const segment of segments) {
          if (!segment.reference) continue
          if (file.key === "references" && columnIndex === 0) continue
          addUse(uses, segment.reference.code, {
            path: file.path,
            title: file.title,
            heading: table.heading,
            row: rowLabel,
            column: table.headers[columnIndex],
            location: segment.reference.location,
          })
        }
      })
    }
  }
}

function workFor(code, row, citation) {
  if (row) {
    const year = Number.parseInt(row["年份"], 10)
    return { code, doi: row.DOI, title: row["题名"], authors: splitValues(row["作者"]), year }
  }
  return { code, doi: DOI_IN_TEXT.exec(citation ?? "")?.[0]?.replace(/[.。]$/u, "") ?? null, title: null, authors: [], year: null }
}

export function buildProjectModel(project, papers) {
  const rows = new Map((project.references ?? []).map((row) => [row["短码"], row]))
  const sources = project.sources ?? Object.fromEntries([...rows.keys()].map((code) => [code, { citation: null, listed: true, pdfs: [] }]))
  const references = new Map()
  for (const [code, source] of Object.entries(sources)) {
    const row = rows.get(code) ?? null
    references.set(code, {
      code,
      row,
      citation: row ? null : source.citation,
      listed: source.listed,
      pdfs: source.pdfs ?? [],
      library: libraryEntry(workFor(code, row, source.citation), papers),
    })
  }
  const uses = new Map()
  for (const file of [...(project.tables ?? []), ...(project.reviews ?? [])]) collectTableUses(uses, file)
  if (project.mentions) {
    for (const [code, paths] of Object.entries(project.mentions)) {
      for (const path of paths) addUse(uses, code, { path, title: "文件", heading: null, row: path, column: null, location: null })
    }
  } else {
    for (const draft of project.drafts ?? []) {
      for (const code of draft.codes) addUse(uses, code, { path: draft.path, title: "稿件", heading: null, row: draft.path, column: null, location: null })
    }
  }
  return { references, uses }
}

export function sourceLinks(reference, entry, { projectId = null } = {}) {
  const page = /^p\.\s?(\d+)/u.exec(reference?.location ?? "")?.[1]
  const anchor = page ? `#page=${page}` : ""
  const projectPdfs = projectId
    ? (entry?.pdfs ?? []).map((path) => ({ path, url: `/api/v1/paper-projects/${encodeURIComponent(projectId)}/pdf/${encodeURIComponent(path)}${anchor}` }))
    : []
  const library = entry?.library
  if (!library?.paperId || !["confirmed", "code_hint"].includes(library.status)) return { pdfPage: null, library: null, projectPdfs }
  return {
    pdfPage: library.status === "confirmed" && library.pdfUrl && page ? `${library.pdfUrl}${anchor}` : null,
    library: `${paperLibraryDetailHref(library.paperId)}&tab=source`,
    projectPdfs,
  }
}

export function sectionModels(project) {
  const mapping = project.tables?.find((file) => file.key === "mapping")?.tables?.[0]
  if (mapping?.status !== "ok") return []
  const column = (name) => mapping.headers.indexOf(name)
  return mapping.rows.map((row, index) => ({
    index,
    id: segmentsText(row[column("小节编号")]),
    title: segmentsText(row[column("本文小节")]),
    file: segmentsText(row[column("稿件文件")]),
    journalExamples: row[column("本刊范文")],
    otherExamples: row[column("非本刊范文")],
    tolerance: segmentsText(row[column("本刊容忍度要点")]),
    length: segmentsText(row[column("目标篇幅")]),
    mode: segmentsText(row[column("起草方式")]),
    // Optional column after the fixed ones: what was borrowed from the exemplars.
    borrowed: column("借鉴内容") === -1 ? "" : segmentsText(row[column("借鉴内容")]),
  }))
}

const WORKFLOW_ORDER = Object.freeze(["00_课题", "01_稿件", "02_规划与记录", "03_范文对照", "审稿", "相关论文", "试转", "latex", "figures", "归档"])
export const ROOT_GROUP = "项目根目录"

// Groups the file list by top-level folder, workflow folders first in their
// skill order. Only Markdown files are opened in the reader; others are counted.
export function groupProjectFiles(project) {
  const groups = new Map()
  for (const file of project.files ?? []) {
    const slash = file.path.indexOf("/")
    const name = slash === -1 ? ROOT_GROUP : file.path.slice(0, slash)
    const group = groups.get(name) ?? { name, markdown: [], otherCount: 0 }
    if (file.path.endsWith(".md")) group.markdown.push(file.path)
    else group.otherCount += 1
    groups.set(name, group)
  }
  const rank = (name) => name === ROOT_GROUP ? -1 : WORKFLOW_ORDER.includes(name) ? WORKFLOW_ORDER.indexOf(name) : WORKFLOW_ORDER.length
  return [...groups.values()].sort((left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name, "zh-CN"))
}

// The table files the reader can show as parsed tables, keyed by path.
export function tableFilesByPath(project) {
  return new Map([...(project.tables ?? []), ...(project.reviews ?? [])]
    .filter((file) => file.status !== "missing")
    .map((file) => [file.path, file]))
}

export function defaultProjectPath(project) {
  const paths = new Set((project.files ?? []).map((file) => file.path))
  const table = [...tableFilesByPath(project).values()].find((file) => file.tables.some((entry) => entry.status === "ok"))
  if (table) return table.path
  if (paths.has("README.md")) return "README.md"
  return groupProjectFiles(project).find((group) => group.markdown.length)?.markdown[0] ?? null
}

// Resolves a Markdown link target written inside `fromPath` to another
// project-relative path. External, anchor-only and escaping targets give null.
export function resolveProjectLink(fromPath, target) {
  let decoded
  try { decoded = decodeURI(String(target ?? "").split("#")[0]) } catch { return null }
  if (!decoded || /^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.startsWith("/") || decoded.includes("\\")) return null
  const parts = String(fromPath).split("/").slice(0, -1)
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length ? parts.join("/") : null
}

// A note record about section `noteId` applies to section `sectionId` when it
// names that section or the whole chapter it belongs to.
function appliesTo(noteId, sectionId) {
  if (!noteId || !sectionId) return false
  return noteId === sectionId || noteId === sectionId.split(".")[0] || noteId.startsWith(`${sectionId}.`)
}

// Exemplar names as written in the outline, e.g. “李天成 2025、DePsFL（框内公式）”.
function exemplarNames(text) {
  return String(text ?? "").split(/[、；;，,\n]/u).map((part) => part.trim()).filter((part) => part && part !== "—")
    .map((part) => ({ text: part, name: part.split(/[（(]/u)[0].trim().split(/\s+/u)[0] }))
}

export function buildSectionGuide(project) {
  const guide = project.section_guide ?? { sections: [], notes: [] }
  const notes = guide.notes ?? []
  const headingLinks = (name) => notes.flatMap((note) => note.headings.filter((heading) => name && heading.includes(name)).map((heading) => ({ path: note.path, title: note.title, heading })))
  const mapping = sectionModels(project)
  const base = mapping.length
    ? mapping.map((section) => ({ key: `m${section.index}`, id: section.id, label: `${section.id} ${section.title}`.trim(), contents: "", exemplars: [], mapping: section }))
    : (guide.sections ?? []).map((section, index) => ({
      key: `o${index}`,
      id: section.id,
      label: section.label,
      contents: section.contents,
      exemplars: exemplarNames(section.references).map((exemplar) => ({ ...exemplar, links: headingLinks(exemplar.name) })),
      mapping: null,
    }))
  const sections = base.map((section) => ({
    ...section,
    files: notes.filter((note) => note.sections.some((id) => appliesTo(id, section.id))).map((note) => ({ path: note.path, title: note.title })),
    passages: notes.flatMap((note) => note.passages
      .filter((passage) => passage.sections.some((id) => appliesTo(id, section.id)))
      .map((passage) => ({ path: note.path, title: note.title, heading: passage.heading, text: passage.text, sections: passage.sections }))),
  }))
  const byExemplar = new Map()
  const addExemplar = (link, sectionLabel) => {
    const key = `${link.path}#${link.heading}`
    const entry = byExemplar.get(key) ?? { path: link.path, title: link.title, heading: link.heading, sections: [] }
    if (!entry.sections.includes(sectionLabel)) entry.sections.push(sectionLabel)
    byExemplar.set(key, entry)
  }
  for (const section of sections) {
    for (const exemplar of section.exemplars) for (const link of exemplar.links) addExemplar(link, section.label)
    for (const passage of section.passages) addExemplar(passage, section.label)
  }
  return {
    source: mapping.length ? "mapping" : sections.length ? "outline" : null,
    outlinePath: guide.outline_path ?? null,
    sections,
    byExemplar: [...byExemplar.values()],
  }
}
