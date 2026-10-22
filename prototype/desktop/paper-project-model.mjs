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

function libraryEntry(row, papers) {
  const code = row["短码"]
  const year = Number.parseInt(row["年份"], 10)
  let result
  try {
    result = matchLocalPaper({ doi: row.DOI || null, paperId: null, title: row["题名"], authors: splitValues(row["作者"]), year: Number.isInteger(year) ? year : null }, papers)
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

export function buildProjectModel(project, papers) {
  const references = new Map()
  for (const row of project.references ?? []) {
    references.set(row["短码"], { code: row["短码"], row, library: libraryEntry(row, papers) })
  }
  const uses = new Map()
  for (const file of [...(project.tables ?? []), ...(project.reviews ?? [])]) collectTableUses(uses, file)
  for (const draft of project.drafts ?? []) {
    for (const code of draft.codes) addUse(uses, code, { path: draft.path, title: "稿件", heading: null, row: draft.path, column: null, location: null })
  }
  return { references, uses }
}

export function sourceLinks(reference, entry) {
  const library = entry?.library
  if (!library?.paperId || !["confirmed", "code_hint"].includes(library.status)) return { pdfPage: null, library: null }
  const page = /^p\.\s?(\d+)/u.exec(reference?.location ?? "")?.[1]
  return {
    pdfPage: library.status === "confirmed" && library.pdfUrl && page ? `${library.pdfUrl}#page=${page}` : null,
    library: `${paperLibraryDetailHref(library.paperId)}&tab=source`,
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
  }))
}
