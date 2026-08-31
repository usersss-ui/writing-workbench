import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path/posix"
import { ARTIFACT_KEYS, classifyArtifact as classifyBaseArtifact } from "./artifacts.mjs"
import { makeOverrideKey, normalizeRelativePath } from "./ids.mjs"

export const SOURCE_STATUS = Object.freeze(["not_checked", "located", "verified"])
export const EVIDENCE_STATUS = Object.freeze(["none", "partial", "core_verified"])
export const REPRODUCTION_STATUS = Object.freeze([
  "none", "description_only", "code_unrun", "ran_no_record", "results_recorded", "consistency_verified",
])
export const UNIT_TYPES = Object.freeze(["article", "review", "thesis", "chapter"])
export const CONTRIBUTION_ROLES = Object.freeze(["foundational", "key_method_turn", "theory_improvement", "application", "combination", "unclassified"])
export const METADATA_PROVENANCE_SOURCES = Object.freeze(["override", "tag_catalog", "catalog", "frontmatter", "note_shortcode", "adapter", "default"])

const EXPLICIT_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/
const FALLBACK_ID = /^LIB-[A-F0-9]{12}$/
const SOURCE_ID = /^[a-z][a-z0-9_-]*$/
const FIELDS = new Set([
  "paper_id", "title_original", "title_zh", "title_en", "authors", "publication_year", "version_date", "year", "venue", "doi_or_url", "unit_type", "parent_paper_id",
  "topic_l1", "topic_l2", "research_scopes", "method_tags", "network_tags", "problem_tags", "property_tags", "theory_tags", "contribution_role",
  "p02_relevance", "source_status", "evidence_status", "reproduction_status", "writing_material_count", "preferred_note",
  "preview_note", "artifact_overrides", "metadata_provenance", "include", "exclude_reason",
])
export const METADATA_PROVENANCE_FIELDS = new Set([
  "paper_id", "title_original", "title_zh", "title_en", "authors", "publication_year", "version_date", "year", "venue", "doi_or_url",
  "unit_type", "parent_paper_id", "record_type", "facets", "facet_states", "source_terms",
  "contribution_role", "p02_relevance",
])
const TAG_LISTS = ["research_scopes", "method_tags", "network_tags", "problem_tags", "property_tags", "theory_tags"]
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireEnum(field, value, values) {
  if (!values.includes(value)) throw new Error(`${field} 枚举值无效`)
}

function validateCanonicalKey(overrideKey) {
  if (typeof overrideKey !== "string") throw new Error("覆盖键格式无效")
  const match = /^([a-z][a-z0-9_-]*)::(.+)$/.exec(overrideKey)
  if (!match || !SOURCE_ID.test(match[1])) throw new Error(`覆盖键格式无效: ${overrideKey}`)
  const canonical = makeOverrideKey({ sourceId: match[1], relativePath: match[2] })
  if (canonical !== overrideKey) throw new Error(`覆盖键格式无效: ${overrideKey}`)
}

function validateString(field, value, { nullable = false } = {}) {
  if (nullable && value === null) return
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`)
}

function validateList(field, value, { unique = false } = {}) {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${field} 必须包含非空字符串`)
    if (item !== item.trim()) throw new Error(`${field} 条目必须去除空白`)
    if (unique && seen.has(item)) throw new Error(`${field} 条目必须唯一`)
    seen.add(item)
  }
}

export function isPathOnlyReadingNoteEligible(relativePath) {
  if (typeof relativePath !== "string" || !MARKDOWN_EXTENSIONS.has(extname(relativePath).toLowerCase())) return false
  const fileName = basename(relativePath).toLowerCase()
  if (
    fileName.includes("中文翻译")
    || fileName.includes("_zh")
    || fileName.includes("translation")
    || fileName.includes("翻译")
    || fileName.includes("ocr")
  ) return false
  const automaticCategory = classifyBaseArtifact({ relativePath })
  return automaticCategory === null || automaticCategory === "note"
}

function validateReadingNotePath(field, relativePath) {
  if (!isPathOnlyReadingNoteEligible(relativePath)) throw new Error(`${field} 只允许符合阅读笔记条件的 Markdown 文件`)
}

function validateArtifactOverrides(value) {
  if (!isObject(value)) throw new Error("artifact_overrides 必须是对象")
  const seen = new Set()
  for (const [category, paths] of Object.entries(value)) {
    if (!ARTIFACT_KEYS.includes(category)) throw new Error("artifact_overrides 类别无效")
    validateList(`artifact_overrides.${category}`, paths, { unique: true })
    for (const artifactPath of paths) {
      let normalized
      try { normalized = normalizeRelativePath(artifactPath) } catch { throw new Error("artifact_overrides 路径越出扫描根") }
      if (normalized !== artifactPath) throw new Error("artifact_overrides 路径必须规范")
      if (category === "note") validateReadingNotePath("artifact_overrides.note", normalized)
      if (seen.has(normalized)) throw new Error("artifact_overrides 路径必须唯一")
      seen.add(normalized)
    }
  }
}

export function validateMetadataProvenance(value) {
  if (!isObject(value)) throw new Error("metadata_provenance 必须是对象")
  for (const [field, source] of Object.entries(value)) {
    if (!METADATA_PROVENANCE_FIELDS.has(field)) throw new Error(`metadata_provenance 字段无效: ${field}`)
    if (!METADATA_PROVENANCE_SOURCES.includes(source)) throw new Error(`metadata_provenance 来源无效: ${field}`)
  }
  return value
}

export function isValidPaperId(paperId) {
  return typeof paperId === "string" && (EXPLICIT_ID.test(paperId) || FALLBACK_ID.test(paperId))
}

export function validatePaperOverride(overrideKey, override) {
  validateCanonicalKey(overrideKey)
  if (!isObject(override)) throw new Error(`覆盖记录必须是对象: ${overrideKey}`)
  for (const field of Object.keys(override)) {
    if (!FIELDS.has(field)) throw new Error(`未知覆盖字段: ${field}`)
  }
  if (override.paper_id !== undefined && (typeof override.paper_id !== "string" || !EXPLICIT_ID.test(override.paper_id))) {
    throw new Error("paper_id 格式无效")
  }
  if (override.include !== undefined && typeof override.include !== "boolean") throw new Error("include 必须是布尔值")
  if (override.include === false) {
    if (typeof override.exclude_reason !== "string" || override.exclude_reason.trim() === "") {
      throw new Error("include 为 false 时 exclude_reason 必须是非空字符串")
    }
  } else if (override.exclude_reason !== undefined) {
    throw new Error("exclude_reason 仅能与 include: false 一起使用")
  }
  for (const field of ["title_original", "title_zh", "title_en", "venue", "doi_or_url", "topic_l1", "topic_l2"]) {
    if (override[field] !== undefined) validateString(field, override[field])
  }
  if (override.version_date !== undefined) validateString("version_date", override.version_date, { nullable: true })
  if (override.parent_paper_id !== undefined && override.parent_paper_id !== null && !isValidPaperId(override.parent_paper_id)) throw new Error("parent_paper_id 格式无效")
  if (override.authors !== undefined) validateList("authors", override.authors)
  for (const field of TAG_LISTS) if (override[field] !== undefined) validateList(field, override[field], { unique: true })
  if (override.year !== undefined && override.year !== null && (!Number.isInteger(override.year) || override.year < 1000 || override.year > 9999)) {
    throw new Error("year 必须是四位整数或 null")
  }
  if (override.publication_year !== undefined && override.publication_year !== null && (!Number.isInteger(override.publication_year) || override.publication_year < 1000 || override.publication_year > 9999)) {
    throw new Error("publication_year 必须是四位整数或 null")
  }
  if (override.unit_type !== undefined && !UNIT_TYPES.includes(override.unit_type)) throw new Error("unit_type 枚举值无效")
  if (override.contribution_role !== undefined && !CONTRIBUTION_ROLES.includes(override.contribution_role)) throw new Error("contribution_role 枚举值无效")
  if (override.p02_relevance !== undefined && override.p02_relevance !== null && (!Number.isInteger(override.p02_relevance) || override.p02_relevance < 0 || override.p02_relevance > 3)) {
    throw new Error("p02_relevance 必须为 0 到 3 的整数或 null")
  }
  if (override.source_status !== undefined) requireEnum("source_status", override.source_status, SOURCE_STATUS)
  if (override.evidence_status !== undefined) requireEnum("evidence_status", override.evidence_status, EVIDENCE_STATUS)
  if (override.reproduction_status !== undefined) requireEnum("reproduction_status", override.reproduction_status, REPRODUCTION_STATUS)
  if (override.writing_material_count !== undefined && (!Number.isInteger(override.writing_material_count) || override.writing_material_count < 0)) {
    throw new Error("写作材料数量必须是非负整数")
  }
  if (override.preferred_note !== undefined) {
    validateString("preferred_note", override.preferred_note)
    let normalized
    try { normalized = normalizeRelativePath(override.preferred_note) } catch { throw new Error("preferred_note 路径越出扫描根") }
    if (normalized !== override.preferred_note) throw new Error("preferred_note 路径必须规范")
    validateReadingNotePath("preferred_note", normalized)
  }
  if (override.preview_note !== undefined && typeof override.preview_note !== "boolean") throw new Error("preview_note 必须是布尔值")
  if (override.artifact_overrides !== undefined) validateArtifactOverrides(override.artifact_overrides)
  if (override.metadata_provenance !== undefined) validateMetadataProvenance(override.metadata_provenance)
  return override
}

export async function loadPaperOverrides(overridesPath) {
  const raw = JSON.parse(await readFile(overridesPath, "utf8"))
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.papers)) throw new Error("覆盖文件必须是 version 为 1 的 papers 对象")
  const seenPaperIds = new Set()
  for (const [overrideKey, override] of Object.entries(raw.papers)) {
    validatePaperOverride(overrideKey, override)
    if (override.paper_id) {
      if (seenPaperIds.has(override.paper_id)) throw new Error(`paper_id 重复: ${override.paper_id}`)
      seenPaperIds.add(override.paper_id)
    }
  }
  return Object.freeze({ version: 1, papers: Object.freeze(raw.papers) })
}
