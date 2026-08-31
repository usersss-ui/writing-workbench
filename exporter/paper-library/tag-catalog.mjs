import { readFile } from "node:fs/promises"

import { createEmptyFacets, validatePaperFacets } from "./facet-schema.mjs"

const PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const RECORD_FIELDS = new Set(["record_type", "facets", "source_terms"])
export const PAPER_RECORD_TYPES = Object.freeze(["外部论文", "学位论文", "学位论文章节", "专题综述"])
const UNIT_TYPE_RECORD_TYPES = Object.freeze({
  article: "外部论文",
  review: "专题综述",
  thesis: "学位论文",
  chapter: "学位论文章节",
})

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validateText(field, value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} 必须是非空字符串`)
  if (value !== value.trim()) throw new Error(`${field} 必须去除空白`)
}

function validateSourceTerms(values) {
  if (!Array.isArray(values)) throw new Error("source_terms 必须是数组")
  const seen = new Set()
  for (const value of values) {
    validateText("source_terms", value)
    if (seen.has(value)) throw new Error("source_terms 条目必须唯一")
    seen.add(value)
  }
}

export function validatePaperTagRecord(paperId, record) {
  if (typeof paperId !== "string" || !PAPER_ID.test(paperId)) throw new Error("paper_id 格式无效")
  if (!isPlainObject(record)) throw new Error(`标签记录必须是对象: ${paperId}`)
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !RECORD_FIELDS.has(key)) throw new Error(`未知标签字段: ${String(key)}`)
  }
  for (const field of RECORD_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new Error(`标签记录字段缺失: ${field}`)
  }
  if (typeof record.record_type !== "string" || !PAPER_RECORD_TYPES.includes(record.record_type)) {
    throw new Error("record_type 枚举值无效")
  }
  validatePaperFacets(record.facets)
  validateSourceTerms(record.source_terms)
  return record
}

export async function loadPaperTagCatalog(catalogPath) {
  const raw = JSON.parse(await readFile(catalogPath, "utf8"))
  if (!isPlainObject(raw) || raw.version !== 2 || !isPlainObject(raw.papers)) {
    throw new Error("标签目录必须是 version 为 2 的 papers 对象")
  }
  for (const [paperId, record] of Object.entries(raw.papers)) validatePaperTagRecord(paperId, record)
  return Object.freeze({ version: 2, papers: Object.freeze(raw.papers) })
}

function recordTypeForUnit(unitType) {
  return Object.hasOwn(UNIT_TYPE_RECORD_TYPES, unitType) ? UNIT_TYPE_RECORD_TYPES[unitType] : "外部论文"
}

export function applyPaperTagCatalog({ papers, tagCatalog }) {
  if (!Array.isArray(papers)) throw new Error("论文集合必须是数组")
  if (!isPlainObject(tagCatalog) || tagCatalog.version !== 2 || !isPlainObject(tagCatalog.papers)) {
    throw new Error("标签目录必须是 version 为 2 的 papers 对象")
  }
  for (const [paperId, record] of Object.entries(tagCatalog.papers)) validatePaperTagRecord(paperId, record)

  const paperIds = new Set(papers.map((paper) => paper?.paper_id))
  const unmatched = Object.keys(tagCatalog.papers).filter((paperId) => !paperIds.has(paperId)).sort()
  if (unmatched.length > 0) throw new Error(`标签目录包含未匹配论文: ${unmatched.join(", ")}`)

  const pending = []
  let taggedCount = 0
  const mergedPapers = papers.map((paper) => {
    const record = Object.hasOwn(tagCatalog.papers, paper.paper_id) ? tagCatalog.papers[paper.paper_id] : null
    if (record) {
      taggedCount += 1
      return {
        ...paper,
        record_type: record.record_type,
        facets: structuredClone(record.facets),
        source_terms: [...record.source_terms],
        metadata_provenance: {
          ...(paper.metadata_provenance ?? {}),
          record_type: "tag_catalog",
          facets: "tag_catalog",
          source_terms: "tag_catalog",
        },
      }
    }
    pending.push(paper.paper_id)
    return {
      ...paper,
      record_type: recordTypeForUnit(paper.unit_type),
      facets: createEmptyFacets(),
      source_terms: [],
      warnings: [...(Array.isArray(paper.warnings) ? paper.warnings : []), "标签待整理"],
    }
  })
  return {
    papers: mergedPapers,
    tagging: {
      tagged_count: taggedCount,
      pending_paper_ids: pending.sort(),
      unmatched_paper_ids: unmatched,
    },
  }
}
