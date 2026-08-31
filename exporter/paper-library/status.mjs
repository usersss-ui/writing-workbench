import { basename, extname } from "node:path/posix"
import { ARTIFACT_KEYS, createEmptyArtifacts } from "./artifacts.mjs"
import { createEmptyFacets, validatePaperFacets } from "./facet-schema.mjs"
import { normalizeRelativePath } from "./ids.mjs"
import { PAPER_RECORD_TYPES } from "./tag-catalog.mjs"
import {
  CONTRIBUTION_ROLES, EVIDENCE_STATUS, REPRODUCTION_STATUS, SOURCE_STATUS, UNIT_TYPES,
  isValidPaperId, validateMetadataProvenance,
} from "./overrides.mjs"

const EXECUTABLE_EXTENSIONS = new Set([".py", ".m", ".mlx", ".ipynb", ".jl", ".r", ".sh", ".js", ".mjs", ".c", ".cc", ".cpp", ".h", ".hpp", ".java", ".go", ".rs"])
const ENGLISH_PLACEHOLDERS = new Set(["unknown", "not reported", "n/a", "na", "tbd"])
const IDENTITY_SOURCES = new Set(["catalog", "override", "frontmatter", "note_shortcode", "path_hash"])
export const NOTE_STATUS = Object.freeze(["notes_ready", "ocr_only", "pdf_only", "metadata_only"])
export const CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES = Object.freeze([
  "note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report",
])
const SOURCE_ID = /^[a-z][a-z0-9_-]*$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ARTIFACT_ENTRY_FIELDS = Object.freeze(["relative_path", "file_name", "size_bytes"])
const CONTROLLED_PREVIEW_DOCUMENT_FIELDS = Object.freeze(["label", "url", "size_bytes", "is_default"])
const CONTROLLED_PREVIEW_DEFAULT_CATEGORIES = new Set(["note", "derivation", "simulation", "code_compare"])
const CONTROLLED_PREVIEW_SIZE_LIMIT = 1024 * 1024
const HASHED_HTML_NAME = /^[a-f0-9]{64}\.html$/u
const PAPER_FIELDS = Object.freeze([
  "paper_id", "slug", "source_id", "relative_path", "identity_source", "unit_type", "parent_paper_id", "title_original", "title_zh", "title_en", "authors",
  "publication_year", "version_date", "year", "venue", "doi_or_url", "metadata_provenance",
  "record_type", "facets", "source_terms", "contribution_role", "p02_relevance",
  "artifacts", "artifact_availability", "source_status", "evidence_status", "reproduction_status", "writing_material_count", "preferred_note", "note_preview_url", "warnings",
  "note_status",
])
const DEFAULTS = Object.freeze({
  title_original: "", title_zh: "", title_en: "", authors: [], publication_year: null, version_date: null,
  year: null, venue: "", doi_or_url: "", metadata_provenance: {}, unit_type: "article", parent_paper_id: null,
  topic_l1: "", topic_l2: "", research_scopes: [], method_tags: [], network_tags: [], problem_tags: [], property_tags: [], theory_tags: [],
  record_type: "外部论文", facets: createEmptyFacets(), source_terms: [], contribution_role: "unclassified",
  p02_relevance: null, note_status: "metadata_only", preferred_note: null, note_preview_url: null, warnings: [],
})
const PROVENANCE_FIELDS = Object.freeze([
  "title_original", "title_zh", "title_en", "authors", "publication_year", "version_date", "year", "venue", "doi_or_url",
  "unit_type", "parent_paper_id", "record_type", "facets", "source_terms",
  "contribution_role", "p02_relevance",
])

function ownValue(object, field) {
  return object && Object.hasOwn(object, field) && object[field] !== undefined ? object[field] : undefined
}

function pick(field, adapted, explicit, catalog, override, fallback) {
  for (const source of [override, catalog, explicit, adapted]) {
    const value = ownValue(source, field)
    if (value !== undefined) return value
  }
  return fallback
}

function hasExecutableScript(artifacts) {
  return Array.isArray(artifacts?.script) && artifacts.script.some((artifact) => {
    const filePath = typeof artifact?.relative_path === "string" ? artifact.relative_path : ""
    return EXECUTABLE_EXTENSIONS.has(extname(filePath).toLowerCase())
  })
}

function validateFormalOverride(override) {
  if (!override || typeof override !== "object") return
  if (override.source_status !== undefined && !SOURCE_STATUS.includes(override.source_status)) throw new Error("source_status 枚举值无效")
  if (override.evidence_status !== undefined && !EVIDENCE_STATUS.includes(override.evidence_status)) throw new Error("evidence_status 枚举值无效")
  if (override.reproduction_status !== undefined && !REPRODUCTION_STATUS.includes(override.reproduction_status)) throw new Error("reproduction_status 枚举值无效")
  if (override.writing_material_count !== undefined && (!Number.isInteger(override.writing_material_count) || override.writing_material_count < 0)) {
    throw new Error("写作材料数量必须是非负整数")
  }
}

export function deriveFormalState({ artifacts, override = {} }) {
  validateFormalOverride(override)
  const reproduction_status = override.reproduction_status
    ?? (hasExecutableScript(artifacts) ? "code_unrun" : Array.isArray(artifacts?.simulation) && artifacts.simulation.length > 0 ? "description_only" : "none")
  return {
    source_status: override.source_status ?? "not_checked",
    evidence_status: override.evidence_status ?? "none",
    reproduction_status,
    writing_material_count: override.writing_material_count ?? 0,
  }
}

function provenanceFor(field, adapted, explicit, catalog, override) {
  for (const [source, defaultProvenance] of [
    [override, "override"], [catalog, "catalog"], [explicit, "frontmatter"], [adapted, "adapter"],
  ]) {
    if (ownValue(source, field) === undefined) continue
    return ownValue(source?.metadata_provenance, field) ?? defaultProvenance
  }
  return "default"
}

export function mergePaperRecord({ adapted = {}, explicit = {}, catalog = {}, override = {} }) {
  const artifacts = pick("artifacts", adapted, explicit, catalog, override, createEmptyArtifacts())
  const merged = { ...adapted }
  for (const [field, fallback] of Object.entries(DEFAULTS)) merged[field] = pick(field, adapted, explicit, catalog, override, fallback)
  merged.metadata_provenance = Object.fromEntries(
    PROVENANCE_FIELDS.map((field) => [field, provenanceFor(field, adapted, explicit, catalog, override)]),
  )
  merged.artifacts = artifacts
  merged.artifact_availability = pick("artifact_availability", adapted, explicit, catalog, override, {})
  Object.assign(merged, deriveFormalState({ artifacts, override }))
  return merged
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function assertString(field, value) {
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`)
}

function assertSafeRelativePath(field, value) {
  assertString(field, value)
  let normalized
  try { normalized = normalizeRelativePath(value) } catch { throw new Error(`${field} 必须是安全相对路径`) }
  if (normalized !== value || normalized === ".") throw new Error(`${field} 必须是安全相对路径`)
}

function assertStringArray(field, value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} 必须是字符串数组`)
}

function assertCanonicalStringArray(field, value) {
  assertStringArray(field, value)
  if (value.some((item) => item.trim() === "" || item !== item.trim())) throw new Error(`${field} 条目必须去除空白`)
  if (new Set(value).size !== value.length) throw new Error(`${field} 条目必须唯一`)
}

function assertArtifactArray(field, value) {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  for (const artifact of value) {
    if (!isPlainObject(artifact) || !hasExactKeys(artifact, ARTIFACT_ENTRY_FIELDS)) throw new Error(`${field} 条目结构无效`)
    assertSafeRelativePath(field, artifact.relative_path)
    if (typeof artifact.file_name !== "string" || artifact.file_name.length === 0 || artifact.file_name !== basename(artifact.relative_path)) throw new Error(`${field} 文件名无效`)
    if (!Number.isInteger(artifact.size_bytes) || artifact.size_bytes < 0) throw new Error(`${field} 文件大小无效`)
  }
}

export function validateControlledPreviewDocuments({ slug, documents }) {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error("controlled_preview_documents slug 无效")
  if (!isPlainObject(documents) || !hasExactKeys(documents, CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES)) {
    throw new Error("controlled_preview_documents 必须包含全部固定类别")
  }
  for (const category of CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES) {
    const items = documents[category]
    if (!Array.isArray(items)) throw new Error(`controlled_preview_documents.${category} 必须是数组`)
    let previousLabel = null
    let defaultCount = 0
    for (const item of items) {
      if (!isPlainObject(item) || !hasExactKeys(item, CONTROLLED_PREVIEW_DOCUMENT_FIELDS)) {
        throw new Error(`controlled_preview_documents.${category} 条目结构无效`)
      }
      try { assertSafeRelativePath(`controlled_preview_documents.${category}.label`, item.label) } catch {
        throw new Error(`controlled_preview_documents.${category}.label 必须是安全相对路径`)
      }
      const extension = extname(item.label).toLowerCase()
      if (extension !== ".md" && extension !== ".markdown") {
        throw new Error(`controlled_preview_documents.${category}.label 必须是 Markdown`)
      }
      if (previousLabel !== null && previousLabel.localeCompare(item.label) > 0) {
        throw new Error(`controlled_preview_documents.${category} 顺序无效`)
      }
      previousLabel = item.label
      assertString(`controlled_preview_documents.${category}.url`, item.url)
      const urlPrefix = `../../local_library_data/notes/${slug}/${category}/`
      if (!item.url.startsWith(urlPrefix) || !HASHED_HTML_NAME.test(item.url.slice(urlPrefix.length))) {
        throw new Error(`controlled_preview_documents.${category}.url 必须是受控内容哈希 URL`)
      }
      if (!Number.isInteger(item.size_bytes) || item.size_bytes < 0 || item.size_bytes > CONTROLLED_PREVIEW_SIZE_LIMIT) {
        throw new Error(`controlled_preview_documents.${category}.size_bytes 无效`)
      }
      if (typeof item.is_default !== "boolean") throw new Error(`controlled_preview_documents.${category}.is_default 必须是布尔值`)
      if (item.is_default) {
        defaultCount += 1
        if (!CONTROLLED_PREVIEW_DEFAULT_CATEGORIES.has(category) || defaultCount > 1) {
          throw new Error(`controlled_preview_documents.${category}.is_default 无效`)
        }
      }
    }
  }
  return documents
}

export function validateGeneratedPaper(paper) {
  if (!paper || typeof paper !== "object" || Array.isArray(paper)) throw new Error("论文记录必须是对象")
  if (!hasExactKeys(paper, PAPER_FIELDS)) throw new Error("论文记录必须只包含固定字段")
  for (const field of ["paper_id", "slug", "source_id", "unit_type", "title_original", "title_zh", "title_en", "venue", "doi_or_url", "record_type", "contribution_role"]) assertString(field, paper[field])
  assertSafeRelativePath("relative_path", paper.relative_path)
  if (!isValidPaperId(paper.paper_id)) throw new Error("paper_id 格式无效")
  if (!SLUG.test(paper.slug)) throw new Error("slug 格式无效")
  if (!SOURCE_ID.test(paper.source_id)) throw new Error("source_id 格式无效")
  if (!IDENTITY_SOURCES.has(paper.identity_source)) throw new Error("identity_source 枚举值无效")
  if (!UNIT_TYPES.includes(paper.unit_type)) throw new Error("unit_type 枚举值无效")
  if (!PAPER_RECORD_TYPES.includes(paper.record_type)) throw new Error("record_type 枚举值无效")
  if (paper.parent_paper_id !== null && !isValidPaperId(paper.parent_paper_id)) throw new Error("parent_paper_id 格式无效")
  if (!CONTRIBUTION_ROLES.includes(paper.contribution_role)) throw new Error("contribution_role 枚举值无效")
  assertStringArray("authors", paper.authors)
  validatePaperFacets(paper.facets)
  assertCanonicalStringArray("source_terms", paper.source_terms)
  if (paper.year !== null && (!Number.isInteger(paper.year) || paper.year < 1000 || paper.year > 9999)) throw new Error("year 必须是四位整数或 null")
  if (paper.publication_year !== null && (!Number.isInteger(paper.publication_year) || paper.publication_year < 1000 || paper.publication_year > 9999)) throw new Error("publication_year 必须是四位整数或 null")
  if (paper.version_date !== null) assertString("version_date", paper.version_date)
  validateMetadataProvenance(paper.metadata_provenance)
  if (paper.p02_relevance !== null && (!Number.isInteger(paper.p02_relevance) || paper.p02_relevance < 0 || paper.p02_relevance > 3)) throw new Error("p02_relevance 枚举值无效")
  if (!SOURCE_STATUS.includes(paper.source_status) || !EVIDENCE_STATUS.includes(paper.evidence_status) || !REPRODUCTION_STATUS.includes(paper.reproduction_status)) throw new Error("论文状态枚举值无效")
  if (!NOTE_STATUS.includes(paper.note_status)) throw new Error("note_status 枚举值无效")
  if (!Number.isInteger(paper.writing_material_count) || paper.writing_material_count < 0) throw new Error("写作材料数量必须是非负整数")
  for (const field of ["title_original", "title_zh", "title_en"]) {
    if (typeof paper[field] !== "string") throw new Error(`${field} 必须是字符串`)
    if (ENGLISH_PLACEHOLDERS.has(paper[field].trim().toLowerCase())) throw new Error("标题不能使用英文占位")
  }
  if (!isPlainObject(paper.artifacts) || !hasExactKeys(paper.artifacts, ARTIFACT_KEYS)) throw new Error("artifacts 必须包含全部固定类别")
  for (const field of ARTIFACT_KEYS) assertArtifactArray(`artifacts.${field}`, paper.artifacts[field])
  if (!isPlainObject(paper.artifact_availability) || !hasExactKeys(paper.artifact_availability, ARTIFACT_KEYS)) throw new Error("artifact_availability 必须包含全部固定类别")
  for (const field of ARTIFACT_KEYS) if (typeof paper.artifact_availability[field] !== "boolean") throw new Error(`artifact_availability.${field} 必须是布尔值`)
  if (paper.preferred_note !== null) assertSafeRelativePath("preferred_note", paper.preferred_note)
  if (paper.note_preview_url !== null) {
    assertString("note_preview_url", paper.note_preview_url)
    if (paper.note_preview_url !== `../../local_library_data/notes/${paper.slug}/preferred.html`) throw new Error("note_preview_url 必须是受控相对 URL")
  }
  assertStringArray("warnings", paper.warnings)
  return paper
}
