import {
  PERSONAL_READING_MARKER,
  P02_ROLES,
  buildLibraryViewState,
  describePaperIdentity,
  filterLibrary,
  groupRowsByNoteStatus,
  summarizeMetadataCoverage,
  translateState,
} from "./paper-library-model.mjs"
import { createWorkspaceStore } from "./paper-library-storage.mjs"
import { createUserTagStore } from "./paper-user-tags.mjs"
import {
  mountSafeControlledPreview,
  mountSafeSourceOcrPreview,
  renderInspector,
  renderReaderOverview,
  renderReaderWriting,
  resolveSafePreviewAssetUrl,
  resolveSafeSourceDocumentUrl,
} from "./paper-inspector.mjs"

const INDEX_URL = "../../local_library_data/paper-index.json"
const LOCAL_CAPABILITY_FIELDS = Object.freeze([
  "note_import", "source_path", "candidate_archive", "archive_rebuild", "discovery", "agent_task_center",
])
const LOCAL_CAPABILITY_CATEGORIES = Object.freeze([
  Object.freeze({ value: "note", label: "论文精读", target_tab: "note" }),
  Object.freeze({ value: "derivation", label: "推导过程", target_tab: "derivation" }),
  Object.freeze({ value: "source_map", label: "来源映射", target_tab: "derivation" }),
  Object.freeze({ value: "modeling", label: "建模复盘", target_tab: "simulation" }),
  Object.freeze({ value: "simulation", label: "仿真描述", target_tab: "simulation" }),
  Object.freeze({ value: "code_compare", label: "代码对照", target_tab: "code_compare" }),
  Object.freeze({ value: "reproduction_report", label: "复现报告", target_tab: "simulation" }),
])
const LOCAL_CAPABILITY_ROOT_FIELDS = Object.freeze([
  "api_version", ...LOCAL_CAPABILITY_FIELDS, "archive_source_id", "categories", "recovery",
])
const LOCAL_RECOVERY_FIELDS = Object.freeze([
  "required", "kind", "reason_code", "archive_source_id", "paper_id", "openalex_id",
])
const MATERIAL_FILTER_AXES = Object.freeze([
  "personalReadingMarkers",
  "sourceStatuses",
  "evidenceStatuses",
  "reproductionStatuses",
  "shelfRoles",
])
const FACET_PANEL_PATHS = Object.freeze({
  research: Object.freeze(["research.domain", "research.mode"]),
  constraints: Object.freeze(["constraints.scope", "constraints.form", "constraints.consistency"]),
  oracle: Object.freeze(["oracle.information", "oracle.estimation"]),
  methods: Object.freeze(["methods.framework", "methods.coordination", "methods.operator"]),
  more: Object.freeze([
    "objective", "network.direction", "network.time", "network.balance", "network.mixing",
    "privacy_robustness", "results", "applications",
  ]),
})
const FACET_PATHS = Object.freeze(Object.values(FACET_PANEL_PATHS).flat())
const FACET_STATE_VALUES = Object.freeze(["unrecorded", "not_applicable", "pending_verification"])
const CANONICAL_FACET_GROUPS = Object.freeze([
  ["research", "research.domain", "研究领域", ["分布式优化", "分布式学习", "联邦学习"]],
  ["research", "research.mode", "任务范式", ["静态优化", "在线优化", "随机优化", "鲁棒优化"]],
  ["more", "objective", "目标函数", ["凸", "强凸", "非凸", "光滑", "非光滑", "随机目标"]],
  ["constraints", "constraints.scope", "作用范围", ["无显式约束", "本地约束", "耦合约束", "决策耦合约束"]],
  ["constraints", "constraints.form", "数学形式", ["集合约束", "等式约束", "不等式约束", "不确定约束"]],
  ["constraints", "constraints.consistency", "节点关系", ["本地一致约束", "本地非一致约束"]],
  ["oracle", "oracle.information", "信息来源", ["精确梯度", "次梯度", "随机梯度", "函数值反馈"]],
  ["oracle", "oracle.estimation", "估计与跟踪", ["梯度跟踪", "单点估计", "双点估计", "残差反馈", "次梯度重缩放"]],
  ["methods", "methods.framework", "主框架", ["次梯度法", "对偶平均", "镜像下降", "对偶分解", "ADMM", "原始—对偶", "增广拉格朗日", "算子分裂", "原始松弛"]],
  ["methods", "methods.coordination", "协调机制", ["普通共识", "Push-Sum", "Perron 修正", "动态跟踪", "有限时间共识"]],
  ["methods", "methods.operator", "更新算子", ["投影", "近端", "预测—校正", "Nesterov 加速"]],
  ["more", "network.direction", "网络方向", ["有向", "无向", "中心化服务器"]],
  ["more", "network.time", "网络时变性", ["固定", "时变"]],
  ["more", "network.balance", "网络平衡性", ["平衡", "不平衡"]],
  ["more", "network.mixing", "混合矩阵", ["行随机", "列随机", "双随机"]],
  ["more", "privacy_robustness", "隐私与鲁棒", ["差分隐私", "Laplace 机制", "Gaussian 机制", "安全多方计算", "结构化扰动", "拜占庭鲁棒", "不确定性鲁棒"]],
  ["more", "results", "理论结果", ["渐近收敛", "精确收敛", "线性收敛", "次线性收敛", "静态遗憾", "动态遗憾", "约束违反界", "隐私保证", "鲁棒保证", "通信复杂度"]],
  ["more", "applications", "应用领域", ["车联网", "无线物联网", "临床机器学习", "工业信息物理系统"]],
].map(([panel, path, label, values]) => Object.freeze({ panel, path, label, values: Object.freeze(values) })))
const RECORD_TYPES = Object.freeze(["外部论文", "学位论文", "学位论文章节", "专题综述"])
const LEGACY_ACADEMIC_FIELDS = Object.freeze([
  "topic_l1", "topic_l2", "research_scopes", "method_tags", "network_tags", "problem_tags", "property_tags", "theory_tags",
])
const PUBLIC_PAPER_FIELDS = Object.freeze([
  "paper_id", "slug", "source_id", "relative_path", "identity_source", "unit_type", "parent_paper_id",
  "title_original", "title_zh", "title_en", "publication_year", "version_date", "year", "venue", "doi_or_url",
  "record_type", "contribution_role", "p02_relevance", "source_status", "evidence_status", "reproduction_status",
  "writing_material_count", "note_status", "preferred_note", "note_preview_url", "authors", "source_terms", "warnings",
  "facets", "facet_states", "metadata_provenance", "artifacts", "artifact_availability", "controlled_previews",
  "controlled_preview_documents", "source_documents",
])
const V3_LEGACY_PUBLIC_PAPER_FIELDS = Object.freeze(PUBLIC_PAPER_FIELDS.filter((field) => field !== "controlled_preview_documents"))
const V2_PUBLIC_PAPER_FIELDS = Object.freeze(PUBLIC_PAPER_FIELDS.filter((field) => field !== "facet_states"))
const V2_LEGACY_PUBLIC_PAPER_FIELDS = Object.freeze(V2_PUBLIC_PAPER_FIELDS.filter((field) => field !== "controlled_preview_documents"))
const EXPLICIT_PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const FALLBACK_PAPER_ID = /^LIB-[A-F0-9]{12}$/u
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const IDENTITY_SOURCES = Object.freeze(["catalog", "override", "frontmatter", "note_shortcode", "path_hash"])
const UNIT_TYPES = Object.freeze(["article", "review", "thesis", "chapter"])
const CONTRIBUTION_ROLES = Object.freeze(["foundational", "key_method_turn", "theory_improvement", "application", "combination", "unclassified"])
const SOURCE_STATUSES = Object.freeze(["not_checked", "located", "verified"])
const EVIDENCE_STATUSES = Object.freeze(["none", "partial", "core_verified"])
const REPRODUCTION_STATUSES = Object.freeze([
  "none", "description_only", "code_unrun", "ran_no_record", "results_recorded", "consistency_verified",
])
const NOTE_STATUS = Object.freeze(["notes_ready", "ocr_only", "pdf_only", "metadata_only"])
const ARTIFACT_KEYS = Object.freeze([
  "pdf", "ocr", "translation", "note", "derivation", "source_map",
  "modeling", "simulation", "code_compare", "script", "result", "reproduction_report",
])
const ARTIFACT_ENTRY_FIELDS = Object.freeze(["relative_path", "file_name", "size_bytes"])
const ENGLISH_TITLE_PLACEHOLDERS = new Set(["unknown", "not reported", "n/a", "na", "tbd"])
const PRIVATE_URL_DECODE_ROUNDS = 6
const PRIVATE_URL_VALUE_LIMIT = 16 * 1024
const METADATA_PROVENANCE_SOURCES = Object.freeze(["override", "tag_catalog", "catalog", "frontmatter", "note_shortcode", "adapter", "default"])
const METADATA_PROVENANCE_FIELDS = Object.freeze([
  "paper_id", "title_original", "title_zh", "title_en", "authors", "publication_year", "version_date", "year", "venue", "doi_or_url",
  "unit_type", "parent_paper_id", "record_type", "facets", "facet_states", "source_terms", "contribution_role", "p02_relevance",
])
export const READER_TAB_KEYS = Object.freeze(["overview", "source", "note", "derivation", "simulation", "code_compare", "writing"])
const CONTROLLED_PREVIEW_KEYS = Object.freeze(["note", "derivation", "simulation", "code_compare"])
const CONTROLLED_PREVIEW_DOCUMENT_KEYS = Object.freeze([
  "note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report",
])
const CONTROLLED_PREVIEW_DOCUMENT_FIELDS = Object.freeze(["label", "url", "size_bytes", "is_default"])
const CONTROLLED_PREVIEW_DOCUMENT_LIMIT = 1024 * 1024
const CONTROLLED_PREVIEW_DOCUMENT_FILE = /^[a-f0-9]{64}\.html$/u
const READER_PREVIEW_DOCUMENT_CATEGORIES = Object.freeze({
  note: Object.freeze(["note"]),
  derivation: Object.freeze(["derivation", "source_map"]),
  simulation: Object.freeze(["simulation", "modeling", "reproduction_report"]),
  code_compare: Object.freeze(["code_compare"]),
})
const PREVIEW_DOCUMENT_CATEGORY_LABELS = Object.freeze({
  note: "论文精读",
  derivation: "推导",
  source_map: "来源映射",
  modeling: "建模",
  simulation: "仿真",
  code_compare: "代码对照",
  reproduction_report: "复现报告",
})
const SOURCE_DOCUMENT_KINDS = Object.freeze(["pdf", "ocr"])
const SOURCE_DOCUMENT_LIMITS = Object.freeze({ pdf: 64 * 1024 * 1024, ocr: 8 * 1024 * 1024 })
const SOURCE_DOCUMENT_URL = Object.freeze({
  pdf: /^\.\.\/\.\.\/local_library_data\/sources\/[a-z0-9]+(?:-[a-z0-9]+)*\/pdf\/[a-f0-9]{64}\.pdf$/u,
  ocr: /^\.\.\/\.\.\/local_library_data\/sources\/[a-z0-9]+(?:-[a-z0-9]+)*\/ocr\/[a-f0-9]{64}\.html$/u,
})
const PREVIEW_LOADING_LABELS = Object.freeze({
  note: "论文精读",
  derivation: "推导过程",
  simulation: "仿真描述",
  code_compare: "代码对照",
})
const READER_STATUS_LABELS = Object.freeze({
  note: "论文精读",
  derivation: "推导过程",
  simulation: "仿真描述",
  code_compare: "代码对照",
})

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
  })
}

function validPaperId(paperId) {
  return typeof paperId === "string" && (EXPLICIT_PAPER_ID.test(paperId) || FALLBACK_PAPER_ID.test(paperId))
}

function validMetadataProvenance(value) {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([field, source]) => (
    METADATA_PROVENANCE_FIELDS.includes(field) && METADATA_PROVENANCE_SOURCES.includes(source)
  ))
}

function validTagList(value, { required = false } = {}) {
  return Array.isArray(value)
    && (!required || value.length > 0)
    && value.every((item) => typeof item === "string" && item.length > 0 && item === item.trim())
}

function validStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function validSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/")) return false
  const segments = value.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function validYear(value) {
  return value === null || (Number.isInteger(value) && value >= 1000 && value <= 9999)
}

function validArtifactArray(value) {
  return Array.isArray(value) && value.every((artifact) => (
    exactStringKeys(artifact, ARTIFACT_ENTRY_FIELDS)
    && validSafeRelativePath(artifact.relative_path)
    && typeof artifact.file_name === "string"
    && artifact.file_name.length > 0
    && artifact.file_name === artifact.relative_path.split("/").at(-1)
    && Number.isInteger(artifact.size_bytes)
    && artifact.size_bytes >= 0
  ))
}

function validArtifacts(value) {
  return exactStringKeys(value, ARTIFACT_KEYS) && ARTIFACT_KEYS.every((key) => validArtifactArray(value[key]))
}

function validArtifactAvailability(value) {
  return exactStringKeys(value, ARTIFACT_KEYS) && ARTIFACT_KEYS.every((key) => typeof value[key] === "boolean")
}

function parseHttpUrl(value) {
  if (typeof value !== "string" || !/^https?:/iu.test(value.trim())) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function containsNonHttpPrivateLocator(value) {
  const trimmed = value.trim()
  return /f[\s\u0000-\u001f]*i[\s\u0000-\u001f]*l[\s\u0000-\u001f]*e[\s\u0000-\u001f]*:/iu.test(value)
    || trimmed.startsWith("/")
    || /(?:^|[\s"'(=?#&])\/(?:Users|home|private|var|Volumes|tmp|opt|etc)(?:\/|$)/iu.test(value)
    || /(?:^|[\s"'(=])[A-Za-z]:[\\/]/u.test(value)
    || /(?:^|[\s"'(=])(?:\\\\|\/\/)[^\\/]+[\\/]/u.test(value)
}

function decodeUrlLayer(value) {
  const formDecoded = value.replaceAll("+", " ")
  try {
    return decodeURIComponent(formDecoded)
  } catch {
    return formDecoded.replace(/%([a-f0-9]{2})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
  }
}

function containsDecodedPrivateLocator(value) {
  let current = value
  for (let round = 0; round < PRIVATE_URL_DECODE_ROUNDS; round += 1) {
    if (current.length > PRIVATE_URL_VALUE_LIMIT || containsNonHttpPrivateLocator(current)) return true
    const decoded = decodeUrlLayer(current)
    if (decoded === current) return false
    current = decoded
  }
  return current !== value
}

function containsPrivateLocator(value) {
  if (typeof value !== "string") return false
  const httpUrl = parseHttpUrl(value)
  if (!httpUrl) return containsDecodedPrivateLocator(value)
  const candidates = [httpUrl.search.slice(1), httpUrl.hash.slice(1)]
  for (const [key, parameterValue] of httpUrl.searchParams) candidates.push(key, parameterValue)
  return candidates.some((candidate) => candidate.length > 0 && containsDecodedPrivateLocator(candidate))
}

function containsPrivateLocatorDeep(value) {
  if (typeof value === "string") return containsPrivateLocator(value)
  if (value === null || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some(containsPrivateLocatorDeep)
  return Object.values(value).some(containsPrivateLocatorDeep)
}

function exactStringKeys(value, expected) {
  if (!isPlainObject(value)) return false
  const keys = Reflect.ownKeys(value).sort()
  const required = [...expected].sort()
  return keys.length === required.length && keys.every((key, index) => key === required[index])
}

function validFacetSchema(value, expectedVersion) {
  if (!exactStringKeys(value, ["version", "groups"]) || value.version !== expectedVersion || !Array.isArray(value.groups)) return false
  if (value.groups.length !== CANONICAL_FACET_GROUPS.length) return false
  for (const [index, group] of value.groups.entries()) {
    const canonical = CANONICAL_FACET_GROUPS[index]
    if (!exactStringKeys(group, ["panel", "path", "label", "values"])) return false
    if (group.panel !== canonical.panel || group.path !== canonical.path || group.label !== canonical.label) return false
    if (!Array.isArray(group.values) || group.values.length !== canonical.values.length) return false
    if (!group.values.every((item, valueIndex) => item === canonical.values[valueIndex])) return false
  }
  return true
}

function facetValueAt(facets, path) {
  return path.split(".").reduce((value, key) => value?.[key], facets)
}

function validPaperFacets(facets, facetSchema) {
  if (!isPlainObject(facets)) return false
  const rootPaths = new Map()
  for (const path of FACET_PATHS) {
    const [root, leaf] = path.split(".")
    if (!rootPaths.has(root)) rootPaths.set(root, [])
    if (leaf) rootPaths.get(root).push(leaf)
  }
  if (!exactStringKeys(facets, [...rootPaths.keys()])) return false
  for (const [root, leaves] of rootPaths) {
    if (leaves.length > 0 && !exactStringKeys(facets[root], leaves)) return false
  }
  const schemaGroups = new Map((facetSchema?.groups ?? []).map((group) => [group.path, group]))
  for (const path of FACET_PATHS) {
    const values = facetValueAt(facets, path)
    if (!validTagList(values) || new Set(values).size !== values.length) return false
    const allowed = schemaGroups.get(path)?.values
    if (Array.isArray(allowed) && values.some((value) => !allowed.includes(value))) return false
  }
  return true
}

function validFacetStates(facets, facetStates) {
  if (!isPlainObject(facetStates)) return false
  return Object.entries(facetStates).every(([path, state]) => (
    FACET_PATHS.includes(path)
    && FACET_STATE_VALUES.includes(state)
    && facetValueAt(facets, path).length === 0
  ))
}

function validPaperRecord(paper, facetSchema, indexVersion) {
  const hasPreviewDocuments = isPlainObject(paper) && Object.hasOwn(paper, "controlled_preview_documents")
  const expectedFields = indexVersion === 3
    ? (hasPreviewDocuments ? PUBLIC_PAPER_FIELDS : V3_LEGACY_PUBLIC_PAPER_FIELDS)
    : (hasPreviewDocuments ? V2_PUBLIC_PAPER_FIELDS : V2_LEGACY_PUBLIC_PAPER_FIELDS)
  return exactStringKeys(paper, expectedFields)
    && LEGACY_ACADEMIC_FIELDS.every((field) => !Object.hasOwn(paper, field))
    && validPaperId(paper.paper_id)
    && SLUG.test(paper.slug)
    && SOURCE_ID.test(paper.source_id)
    && validSafeRelativePath(paper.relative_path)
    && IDENTITY_SOURCES.includes(paper.identity_source)
    && UNIT_TYPES.includes(paper.unit_type)
    && (paper.parent_paper_id === null || validPaperId(paper.parent_paper_id))
    && typeof paper.title_original === "string"
    && typeof paper.title_zh === "string"
    && typeof paper.title_en === "string"
    && [paper.title_original, paper.title_zh, paper.title_en].every((title) => !ENGLISH_TITLE_PLACEHOLDERS.has(title.trim().toLowerCase()))
    && validStringArray(paper.authors)
    && validYear(paper.publication_year)
    && validYear(paper.year)
    && typeof paper.venue === "string"
    && typeof paper.doi_or_url === "string"
    && RECORD_TYPES.includes(paper.record_type)
    && validPaperFacets(paper.facets, facetSchema)
    && (indexVersion === 2 || validFacetStates(paper.facets, paper.facet_states))
    && validTagList(paper.source_terms)
    && new Set(paper.source_terms).size === paper.source_terms.length
    && (paper.version_date === null || typeof paper.version_date === "string")
    && validMetadataProvenance(paper.metadata_provenance)
    && CONTRIBUTION_ROLES.includes(paper.contribution_role)
    && (paper.p02_relevance === null || (Number.isInteger(paper.p02_relevance) && paper.p02_relevance >= 0 && paper.p02_relevance <= 3))
    && SOURCE_STATUSES.includes(paper.source_status)
    && EVIDENCE_STATUSES.includes(paper.evidence_status)
    && REPRODUCTION_STATUSES.includes(paper.reproduction_status)
    && Number.isInteger(paper.writing_material_count)
    && paper.writing_material_count >= 0
    && NOTE_STATUS.includes(paper.note_status)
    && (paper.preferred_note === null || validSafeRelativePath(paper.preferred_note))
    && (paper.note_preview_url === null || paper.note_preview_url === `../../local_library_data/notes/${paper.slug}/preferred.html`)
    && validStringArray(paper.warnings)
    && validArtifacts(paper.artifacts)
    && validArtifactAvailability(paper.artifact_availability)
    && validControlledPreviews(paper.controlled_previews, paper.slug)
    && paper.note_preview_url === paper.controlled_previews.note
    && (!hasPreviewDocuments || validControlledPreviewDocuments(paper.controlled_preview_documents, paper.slug))
    && validSourceDocuments(paper.source_documents, paper.slug)
    && !containsPrivateLocatorDeep(paper)
}

function validControlledPreviews(value, slug) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.join("|") !== [...CONTROLLED_PREVIEW_KEYS].sort().join("|")) return false
  return keys.every((key) => value[key] === null || value[key] === `../../local_library_data/notes/${slug}/${key === "note" ? "preferred" : key}.html`)
}

function validControlledPreviewDocuments(value, slug) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.join("|") !== [...CONTROLLED_PREVIEW_DOCUMENT_KEYS].sort().join("|")) return false
  return CONTROLLED_PREVIEW_DOCUMENT_KEYS.every((category) => {
    const documents = value[category]
    if (!Array.isArray(documents)) return false
    for (const document of documents) {
      if (!exactStringKeys(document, CONTROLLED_PREVIEW_DOCUMENT_FIELDS)) return false
      if (
        typeof document.label !== "string"
        || document.label.length === 0
        || document.label.length > 1024
        || document.label !== document.label.trim()
        || !validSafeRelativePath(document.label)
        || /[\u0000-\u001f\u007f]/u.test(document.label)
      ) return false
      const prefix = `../../local_library_data/notes/${slug}/${category}/`
      if (typeof document.url !== "string" || !document.url.startsWith(prefix)) return false
      const fileName = document.url.slice(prefix.length)
      if (!CONTROLLED_PREVIEW_DOCUMENT_FILE.test(fileName)) return false
      if (!Number.isInteger(document.size_bytes) || document.size_bytes < 0 || document.size_bytes > CONTROLLED_PREVIEW_DOCUMENT_LIMIT) return false
      if (typeof document.is_default !== "boolean") return false
    }
    return true
  })
}

function validSourceDocuments(value, slug) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.join("|") !== [...SOURCE_DOCUMENT_KINDS].sort().join("|")) return false
  return SOURCE_DOCUMENT_KINDS.every((kind) => Array.isArray(value[kind]) && value[kind].every((item) => (
    isPlainObject(item)
    && Object.keys(item).sort().join("|") === "label|size_bytes|url"
    && typeof item.label === "string"
    && item.label.length > 0
    && item.label.length <= 240
    && !/[\\/\u0000-\u001f\u007f]/u.test(item.label)
    && typeof item.url === "string"
    && SOURCE_DOCUMENT_URL[kind].test(item.url)
    && item.url.startsWith(`../../local_library_data/sources/${slug}/${kind}/`)
    && Number.isInteger(item.size_bytes)
    && item.size_bytes >= 0
    && item.size_bytes <= SOURCE_DOCUMENT_LIMITS[kind]
  )))
}

export function defaultSourceViewMode(sourceDocuments) {
  const hasPdf = Array.isArray(sourceDocuments?.pdf) && sourceDocuments.pdf.length > 0
  const hasOcr = Array.isArray(sourceDocuments?.ocr) && sourceDocuments.ocr.length > 0
  if (hasPdf && hasOcr) return "compare"
  if (hasPdf) return "pdf"
  if (hasOcr) return "ocr"
  return "compare"
}

export function nextReaderTabKey({ current, key } = {}) {
  const index = READER_TAB_KEYS.indexOf(current)
  if (index === -1) return READER_TAB_KEYS[0]
  if (key === "Home") return READER_TAB_KEYS[0]
  if (key === "End") return READER_TAB_KEYS.at(-1)
  if (key === "ArrowRight") return READER_TAB_KEYS[(index + 1) % READER_TAB_KEYS.length]
  if (key === "ArrowLeft") return READER_TAB_KEYS[(index - 1 + READER_TAB_KEYS.length) % READER_TAB_KEYS.length]
  return current
}

export function previewLoadingMessage(kind) {
  return `正在读取${PREVIEW_LOADING_LABELS[kind] ?? "材料"}…`
}

export function readerTabStatusMessage(tab, state, { selected = true, placeholder = "" } = {}) {
  const label = READER_STATUS_LABELS[tab]
  if (!label) return ""
  if (!selected) return typeof placeholder === "string" ? placeholder : ""
  if (state === "loading") return `正在读取${label}…`
  if (state === "ready") return `${label}已读取`
  return ""
}

export function sourceReaderStatusMessage({ showPdf = false, showOcr = false, ocrState = "idle" } = {}) {
  const messages = []
  if (showOcr && ocrState === "loading") messages.push("正在读取 OCR 文本…")
  if (showOcr && ocrState === "ready") messages.push("OCR 文本已读取")
  if (showPdf) messages.push("PDF 由浏览器加载")
  return messages.join("；")
}

export function syncSourcePdfFrame({ frame, show = false, url = null, label = "" } = {}) {
  if (!frame) return false
  const safeUrl = typeof url === "string" && url.length > 0 ? url : null
  let sourceChanged = false
  frame.hidden = !(show && safeUrl)
  if (safeUrl) {
    if (frame.getAttribute("src") !== safeUrl) {
      frame.setAttribute("src", safeUrl)
      sourceChanged = true
    }
    frame.title = label ? `PDF 原文：${label}` : "PDF 原文"
  } else {
    if (frame.getAttribute("src") !== null) {
      frame.removeAttribute("src")
      sourceChanged = true
    }
    frame.title = "PDF 原文"
  }
  return sourceChanged
}

export function previewKindsForReaderTab(tab) {
  return CONTROLLED_PREVIEW_KEYS.includes(tab) ? [tab] : []
}

export function controlledPreviewDocumentsForReaderTab(paper, tab) {
  const categories = READER_PREVIEW_DOCUMENT_CATEGORIES[tab]
  if (!categories) return []
  const catalog = paper?.controlled_preview_documents
  if (!isPlainObject(catalog)) {
    const legacyUrl = paper?.controlled_previews?.[tab] ?? (tab === "note" ? paper?.note_preview_url : null)
    if (typeof legacyUrl !== "string" || !legacyUrl) return []
    return [{
      category: tab,
      label: READER_STATUS_LABELS[tab],
      url: legacyUrl,
      size_bytes: 0,
      is_default: true,
      isLegacy: true,
      selectionKey: `legacy:${tab}:0`,
      optionLabel: `${READER_STATUS_LABELS[tab]}（首选）`,
    }]
  }

  const mergedCategories = categories.length > 1
  return categories.flatMap((category) => {
    const documents = Array.isArray(catalog[category]) ? catalog[category] : []
    return documents.map((document, categoryIndex) => {
      const baseLabel = mergedCategories
        ? `${PREVIEW_DOCUMENT_CATEGORY_LABELS[category]} · ${document.label}`
        : document.label
      return {
        ...document,
        category,
        selectionKey: `${category}:${categoryIndex}`,
        optionLabel: document.is_default ? `${baseLabel}（首选）` : baseLabel,
      }
    })
  })
}

export function controlledPreviewSelectionModel(paper, tab, selectedKey = null) {
  const documents = controlledPreviewDocumentsForReaderTab(paper, tab)
  let selectedDocument = typeof selectedKey === "string"
    ? documents.find((document) => document.selectionKey === selectedKey) ?? null
    : null
  if (!selectedDocument && documents.length === 1) selectedDocument = documents[0]
  const defaults = documents.filter((document) => document.is_default === true)
  if (!selectedDocument && documents.length > 1 && defaults.length === 1) selectedDocument = defaults[0]
  const placeholder = documents.length > 1 && !selectedDocument ? `请选择一份材料（${documents.length}）` : null
  const label = READER_STATUS_LABELS[tab] ?? "材料"
  return {
    documents,
    selectedDocument,
    showSelect: documents.length > 1,
    placeholder,
    emptyMessage: placeholder ? "请选择一份材料后预览。" : `尚无${label}材料。`,
  }
}

export function renderReaderMaterialSelector({ document, control, select, paper, tab, selectedKey = null }) {
  const model = controlledPreviewSelectionModel(paper, tab, selectedKey)
  if (control) control.hidden = !model.showSelect
  if (!select) return model

  const fragment = document.createDocumentFragment()
  if (model.placeholder) {
    const option = document.createElement("option")
    option.value = ""
    option.textContent = model.placeholder
    option.disabled = true
    option.selected = true
    fragment.append(option)
  }
  for (const previewDocument of model.documents) {
    const option = document.createElement("option")
    option.value = previewDocument.selectionKey
    option.textContent = previewDocument.optionLabel
    option.title = previewDocument.optionLabel
    option.selected = previewDocument.selectionKey === model.selectedDocument?.selectionKey
    fragment.append(option)
  }
  select.replaceChildren(fragment)
  select.disabled = !model.showSelect
  select.value = model.selectedDocument?.selectionKey ?? ""
  const label = READER_STATUS_LABELS[tab] ?? "材料"
  const currentLabel = model.selectedDocument?.optionLabel ?? ""
  select.setAttribute("aria-label", currentLabel ? `选择${label}材料，当前：${currentLabel}` : `选择${label}材料`)
  select.setAttribute("title", currentLabel || model.placeholder || model.emptyMessage)
  return model
}

export function changeReaderMaterialSelection({ selectionByTab, tab, url, render, findSelect }) {
  if (
    !isPlainObject(selectionByTab)
    || !CONTROLLED_PREVIEW_KEYS.includes(tab)
    || typeof url !== "string"
    || !url
    || typeof render !== "function"
  ) return false
  selectionByTab[tab] = url
  const result = render()
  const select = typeof findSelect === "function" ? findSelect(tab) : null
  if (typeof select?.focus === "function") select.focus()
  return result
}

export function readerContextLabel({ detailOpen, paper } = {}) {
  return detailOpen === true && validPaperId(paper?.paper_id) ? paper.paper_id : "论文库"
}

export function readerHeadingLabel(heading) {
  if (!heading) return ""
  if (typeof heading.cloneNode !== "function") return heading.textContent?.trim() ?? ""

  const clone = heading.cloneNode(true)
  for (const wrapper of clone.querySelectorAll?.(".math-inline, .math-display") ?? []) {
    const mathml = wrapper.querySelector?.(".katex-mathml")?.cloneNode?.(true) ?? null
    for (const annotation of mathml?.querySelectorAll?.("annotation") ?? []) annotation.remove()
    const label = mathml?.textContent?.replace(/\s+/gu, " ").trim()
      || wrapper.getAttribute?.("data-math-source")?.trim()
      || wrapper.textContent?.trim()
      || ""
    const textNode = clone.ownerDocument?.createTextNode?.(label)
    if (textNode && typeof wrapper.replaceWith === "function") wrapper.replaceWith(textNode)
    else wrapper.textContent = label
  }
  return clone.textContent?.replace(/\s+/gu, " ").trim() ?? ""
}

export function applyReaderTocVisibility({ document, toc, toggle, detailOpen, expanded, forceHidden = false } = {}) {
  const readerOpen = detailOpen === true
  const visible = readerOpen && expanded === true && forceHidden !== true
  if (toc) toc.hidden = !visible
  if (toggle) {
    toggle.hidden = readerOpen && forceHidden === true
    toggle.setAttribute("aria-expanded", String(visible))
    toggle.textContent = visible ? "隐藏目录" : "显示目录"
  }
  document?.body?.classList?.toggle("library-reader-toc-hidden", readerOpen && !visible)
}

export function chooseDisplayedPaperId({ selectedPaper }) {
  return validPaperId(selectedPaper?.paper_id) ? selectedPaper.paper_id : null
}

export function chooseActivePaper({ papers, detailOpen, detailPaperId, listSelectedPaper } = {}) {
  if (!detailOpen) return validPaperId(listSelectedPaper?.paper_id) ? listSelectedPaper : null
  if (!Array.isArray(papers) || !validPaperId(detailPaperId)) return null
  return paperById(papers, detailPaperId)
}

export function paperActionLabel({ action, paper } = {}) {
  if (!validPaperId(paper?.paper_id)) return ""
  const identity = describePaperIdentity(paper)
  const context = `，论文 ID ${paper.paper_id}${identity.identityPending ? "，待整理身份" : ""}`
  if (action === "select-paper") return `选择论文《${identity.displayTitle}》${context}`
  if (action === "open-detail") return `打开论文《${identity.displayTitle}》的详情${context}`
  return ""
}

export class LocalLibraryApiError extends Error {
  constructor(code, message, { fileName = null } = {}) {
    super(message)
    this.name = "LocalLibraryApiError"
    this.code = code
    this.fileName = fileName
  }
}

function validApiText(value, { maxLength = 240 } = {}) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !containsPrivateLocator(value)
}

function validLocalFileName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && value === value.trim()
    && /\.md$/iu.test(value)
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..")
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function validInspectionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,200}$/u.test(value)
}

function validIsoInstant(value) {
  if (typeof value !== "string") return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function validRecovery(value, root) {
  if (!exactStringKeys(value, LOCAL_RECOVERY_FIELDS) || typeof value.required !== "boolean") return false
  if (value.required === false) {
    return value.kind === null
      && value.reason_code === null
      && value.archive_source_id === null
      && value.paper_id === null
      && value.openalex_id === null
  }
  if (value.kind === "candidate_archive") {
    return value.reason_code === "ARCHIVE_REBUILD_FAILED"
      && SOURCE_ID.test(value.archive_source_id ?? "")
      && value.archive_source_id === root.archive_source_id
      && validPaperId(value.paper_id)
      && /^W[1-9]\d*$/u.test(value.openalex_id ?? "")
      && root.note_import === false
      && root.candidate_archive === false
      && root.archive_rebuild === true
  }
  if (value.kind === "manual_note") {
    return ["ROLLBACK_FAILED", "BUILD_OUTPUT_INVALID"].includes(value.reason_code)
      && value.archive_source_id === null
      && value.paper_id === null
      && value.openalex_id === null
      && root.note_import === false
      && root.candidate_archive === false
      && root.archive_rebuild === false
  }
  return false
}

function validateCapabilitiesResponse(value) {
  if (!exactStringKeys(value, LOCAL_CAPABILITY_ROOT_FIELDS) || value.api_version !== 1) {
    throw new Error("本地服务响应格式无效")
  }
  if (!LOCAL_CAPABILITY_FIELDS.every((field) => typeof value[field] === "boolean")) {
    throw new Error("本地服务响应格式无效")
  }
  if (value.archive_source_id !== null && !SOURCE_ID.test(value.archive_source_id)) {
    throw new Error("本地服务响应格式无效")
  }
  if ((value.candidate_archive || value.archive_rebuild) && value.archive_source_id === null) {
    throw new Error("本地服务响应格式无效")
  }
  if (!Array.isArray(value.categories) || value.categories.length !== LOCAL_CAPABILITY_CATEGORIES.length) {
    throw new Error("本地服务响应格式无效")
  }
  for (const [index, category] of value.categories.entries()) {
    if (!exactStringKeys(category, ["value", "label", "target_tab"])) throw new Error("本地服务响应格式无效")
    const expected = LOCAL_CAPABILITY_CATEGORIES[index]
    if (category.value !== expected.value || category.label !== expected.label || category.target_tab !== expected.target_tab) {
      throw new Error("本地服务响应格式无效")
    }
  }
  if (!validRecovery(value.recovery, value) || containsPrivateLocatorDeep(value)) {
    throw new Error("本地服务响应格式无效")
  }
  return structuredClone(value)
}

function validateChecks(value) {
  if (!exactStringKeys(value, ["items", "blocking_codes", "warning_codes", "can_import"])) return false
  if (!Array.isArray(value.items) || typeof value.can_import !== "boolean") return false
  if (!value.items.every((item) => (
    exactStringKeys(item, ["code", "severity", "message"])
    && /^[A-Z][A-Z0-9_]*$/u.test(item.code)
    && ["pass", "warning", "blocking"].includes(item.severity)
    && validApiText(item.message)
  ))) return false
  const blocking = value.items.filter((item) => item.severity === "blocking").map((item) => item.code)
  const warnings = value.items.filter((item) => item.severity === "warning").map((item) => item.code)
  return Array.isArray(value.blocking_codes)
    && Array.isArray(value.warning_codes)
    && JSON.stringify(value.blocking_codes) === JSON.stringify(blocking)
    && JSON.stringify(value.warning_codes) === JSON.stringify(warnings)
    && value.can_import === (blocking.length === 0)
}

function validateInspectionResponse(value, { paperId, category }) {
  const contract = LOCAL_CAPABILITY_CATEGORIES.find((item) => item.value === category)
  if (
    !contract
    || !exactStringKeys(value, ["inspection_id", "suggested_file_name", "checks", "target_tab", "expires_at"])
    || !validInspectionId(value.inspection_id)
    || !validLocalFileName(value.suggested_file_name)
    || !value.suggested_file_name.includes(`${paperId}_`)
    || value.target_tab !== contract.target_tab
    || !validIsoInstant(value.expires_at)
    || !validateChecks(value.checks)
    || containsPrivateLocatorDeep(value)
  ) throw new Error("本地服务响应格式无效")
  return structuredClone(value)
}

function validImportedPreviewUrl(value) {
  return typeof value === "string"
    && /^\.\.\/\.\.\/local_library_data\/notes\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:note|derivation|source_map|modeling|simulation|code_compare|reproduction_report)\/[a-f0-9]{64}\.html$/u.test(value)
}

function validateImportResponse(value, { requestedFileName }) {
  const extension = ".md"
  const stem = requestedFileName.toLowerCase().endsWith(extension)
    ? requestedFileName.slice(0, -extension.length)
    : requestedFileName
  const expectedVersion = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}_v[2-9][0-9]*\\.md$`, "u")
  if (
    !exactStringKeys(value, ["paper_id", "actual_file_name", "target_tab", "new_preview_url", "index_version"])
    || !validPaperId(value.paper_id)
    || !validLocalFileName(value.actual_file_name)
    || (value.actual_file_name !== requestedFileName && !expectedVersion.test(value.actual_file_name))
    || !["note", "derivation", "simulation", "code_compare"].includes(value.target_tab)
    || !validImportedPreviewUrl(value.new_preview_url)
    || !/^[a-f0-9]{64}$/u.test(value.index_version ?? "")
    || containsPrivateLocatorDeep(value)
  ) throw new Error("本地服务响应格式无效")
  return structuredClone(value)
}

function validateSourcePathResponse(value, { paperId }) {
  if (
    !exactStringKeys(value, ["paper_id", "source_path"])
    || value.paper_id !== paperId
    || typeof value.source_path !== "string"
    || value.source_path.length === 0
    || value.source_path.length > 32_768
    || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(value.source_path)
    || /[\u0000\r\n]/u.test(value.source_path)
  ) throw new Error("本地服务响应格式无效")
  return { paper_id: value.paper_id, source_path: value.source_path }
}

async function parseLocalJsonResponse(response, validator) {
  let payload
  try { payload = await response?.json?.() } catch { throw new Error("本地服务响应格式无效") }
  if (!response?.ok) {
    const error = isPlainObject(payload?.error) ? payload.error : {}
    const code = typeof error.code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(error.code)
      ? error.code
      : "LOCAL_LIBRARY_REQUEST_FAILED"
    const message = validApiText(error.message) ? error.message : "本地论文库请求失败"
    const fileName = validLocalFileName(error.file_name) ? error.file_name : null
    throw new LocalLibraryApiError(code, message, { fileName })
  }
  return validator(payload)
}

function requestLocalJson(fetchImpl, url, body, validator) {
  if (typeof fetchImpl !== "function") return Promise.reject(new Error("本地服务不可用"))
  return Promise.resolve(fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  })).then((response) => parseLocalJsonResponse(response, validator))
}

export async function loadLocalLibraryCapabilities(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("本地服务不可用")
  const response = await fetchImpl("/api/v1/capabilities", {
    cache: "no-store",
    credentials: "same-origin",
  })
  return parseLocalJsonResponse(response, validateCapabilitiesResponse)
}

export function inspectLocalMarkdownNote({ fetchImpl = globalThis.fetch, paperId, category, originalFileName, markdown }) {
  return requestLocalJson(fetchImpl, "/api/v1/notes/inspect", {
    paper_id: paperId,
    category,
    original_file_name: originalFileName,
    markdown,
  }, (value) => validateInspectionResponse(value, { paperId, category }))
}

export function importLocalMarkdownNote({ fetchImpl = globalThis.fetch, inspectionId, requestedFileName }) {
  return requestLocalJson(fetchImpl, "/api/v1/notes/import", {
    inspection_id: inspectionId,
    requested_file_name: requestedFileName,
    conflict_policy: "version",
  }, (value) => validateImportResponse(value, { requestedFileName }))
}

export function loadPrivateSourcePath({ fetchImpl = globalThis.fetch, paperId }) {
  return requestLocalJson(
    fetchImpl,
    "/api/v1/papers/source-path",
    { paper_id: paperId },
    (value) => validateSourcePathResponse(value, { paperId }),
  ).then((result) => result.source_path)
}

export async function decodeUtf8MarkdownFile(file) {
  if (!file || !/\.(?:md|markdown)$/iu.test(file.name ?? "")) throw new Error("请选择 Markdown 文件")
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("Markdown 文件不是有效 UTF-8")
  }
}

export function createRetryableLoader(load) {
  if (typeof load !== "function") throw new TypeError("加载函数无效")
  let state = "idle"
  let value = null
  let inFlight = null
  let generation = 0

  function invalidate() {
    generation += 1
    state = "idle"
    value = null
    inFlight = null
  }

  function run() {
    if (state === "ready") return Promise.resolve({ ok: true, value })
    if (inFlight) return inFlight
    const token = generation
    state = "loading"
    const operation = Promise.resolve()
      .then(() => load())
      .then((loaded) => {
        if (token !== generation) return { ok: false, value: null }
        value = loaded
        state = "ready"
        return { ok: true, value }
      })
      .catch(() => {
        if (token === generation) {
          value = null
          state = "error"
        }
        return { ok: false, value: null }
      })
      .finally(() => {
        if (token === generation && inFlight === operation) inFlight = null
      })
    inFlight = operation
    return operation
  }

  return { getState: () => state, invalidate, run }
}

export function computeLoadVisibility({ loadState, viewEmpty }) {
  const failed = loadState === "error"
  return {
    errorHidden: !failed,
    emptyHidden: failed || !viewEmpty,
  }
}

export function toggleExclusiveShelfRole(activeRoles, role) {
  if (!P02_ROLES.includes(role)) return []
  return Array.isArray(activeRoles) && activeRoles.includes(role) ? [] : [role]
}

export function focusResultCount(target) {
  if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" })
  if (typeof target?.focus === "function") target.focus()
}

export function focusDetailEntry(target) {
  if (typeof target?.focus === "function") target.focus()
}

export function restoreInspectorActionFocus(root, { action, role, marker } = {}) {
  let selector = null
  if (action === "toggle-shelf" && P02_ROLES.includes(role)) {
    selector = `[data-action="toggle-shelf"][data-role="${role}"]`
  } else if (action === "set-reading" && PERSONAL_READING_MARKER.includes(marker)) {
    selector = `[data-action="set-reading"][data-marker="${marker}"]`
  }
  const target = selector && typeof root?.querySelector === "function" ? root.querySelector(selector) : null
  if (typeof target?.focus === "function") target.focus()
}

export function restorePaperSelectionFocus(root, paperId) {
  if (!validPaperId(paperId) || typeof root?.querySelector !== "function") return
  const target = root.querySelector(`[data-paper-id="${paperId}"] [data-action="select-paper"]`)
  if (typeof target?.focus === "function") target.focus()
}

export function createPrivatePathCopyGuard(clearStatus) {
  if (typeof clearStatus !== "function") throw new TypeError("复制状态清理函数无效")
  let selectedPaperId = null
  let generation = 0

  function syncSelection(paperId) {
    if (paperId === selectedPaperId) return false
    selectedPaperId = paperId
    generation += 1
    clearStatus()
    return true
  }

  function begin(paperId) {
    generation += 1
    clearStatus()
    return Object.freeze({ paperId, generation })
  }

  function isCurrent(request) {
    return request?.paperId === selectedPaperId && request?.generation === generation
  }

  return { syncSelection, begin, isCurrent }
}

export function createPreviewCoordinator({
  loadPreview,
  commitPreview,
  clearPreview,
  AbortControllerImpl = globalThis.AbortController,
}) {
  if (typeof loadPreview !== "function" || typeof commitPreview !== "function" || typeof clearPreview !== "function") {
    throw new TypeError("笔记预览协调器配置无效")
  }
  let requestToken = 0
  let activeRequestKey = null
  let open = false
  let abortController = null
  let activeLoadPromise = null

  function invalidate() {
    requestToken += 1
    if (abortController) abortController.abort()
    abortController = null
    activeLoadPromise = null
  }

  function close() {
    invalidate()
    open = false
    activeRequestKey = null
    clearPreview()
  }

  async function sync({ detailOpen, paper, previewKey = "note" }) {
    const paperId = validPaperId(paper?.paper_id) ? paper.paper_id : null
    if (!detailOpen || !paperId) {
      close()
      return false
    }
    const requestKey = `${paperId}:${previewKey}`
    if (open && activeRequestKey === requestKey) return activeLoadPromise ?? false

    invalidate()
    open = true
    activeRequestKey = requestKey
    clearPreview()
    const token = requestToken
    abortController = typeof AbortControllerImpl === "function" ? new AbortControllerImpl() : null

    let previewPromise
    try {
      previewPromise = Promise.resolve(loadPreview(paper, { signal: abortController?.signal, previewKey }))
    } catch (error) {
      previewPromise = Promise.reject(error)
    }
    const operation = (async () => {
      try {
        const preview = await previewPromise
        if (token !== requestToken || !open || activeRequestKey !== requestKey) return false
        commitPreview(preview, paper)
        return true
      } catch (error) {
        if (token !== requestToken || !open || activeRequestKey !== requestKey || error?.name === "AbortError") return false
        throw error
      } finally {
        if (token === requestToken) {
          abortController = null
          activeLoadPromise = null
        }
      }
    })()
    activeLoadPromise = operation
    return operation
  }

  return { close, isOpen: () => open, sync }
}

export async function loadPaperIndex(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("论文库索引不可用")
  let response
  try {
    response = await fetchImpl(INDEX_URL, { cache: "no-store" })
  } catch {
    throw new Error("论文库索引不可用")
  }
  if (!response?.ok || typeof response.json !== "function") throw new Error("论文库索引不可用")

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error("论文库索引格式无效")
  }
  const schemaVersion = payload?.version === 3 ? 2 : payload?.version === 2 ? 1 : null
  if (
    !exactStringKeys(payload, ["version", "facet_schema", "warning_count", "papers"])
    || schemaVersion === null
    || !validFacetSchema(payload.facet_schema, schemaVersion)
    || !Array.isArray(payload.papers)
    || !payload.papers.every((paper) => validPaperRecord(paper, payload.facet_schema, payload.version))
  ) {
    throw new Error("论文库索引格式无效")
  }
  const paperIds = payload.papers.map((paper) => paper.paper_id)
  if (new Set(paperIds).size !== paperIds.length) throw new Error("论文库索引格式无效")
  const warningCount = Number.isInteger(payload.warning_count) && payload.warning_count >= 0 ? payload.warning_count : null
  return {
    version: payload.version,
    facet_schema: payload.facet_schema,
    warning_count: warningCount,
    papers: payload.papers.map((paper) => (
      payload.version === 2 ? { ...paper, facet_states: {} } : paper
    )),
  }
}

function displayAuthors(paper) {
  const authors = Array.isArray(paper?.authors)
    ? paper.authors.filter((author) => typeof author === "string" && author.trim()).map((author) => author.trim())
    : []
  return authors.length > 0 ? authors.join("、") : "作者未记录"
}

function setFieldText(root, selector, text) {
  const target = root.querySelector(selector)
  if (target) target.textContent = text
}

export function renderPaperRows({ document, rows, selectedPaperId, facetSchema }) {
  const container = document.getElementById("library-results")
  const template = document.getElementById("library-paper-row-template")
  if (!container || !(template instanceof document.defaultView.HTMLTemplateElement)) return
  const fragment = document.createDocumentFragment()
  const validRows = (Array.isArray(rows) ? rows : []).filter((rowState) => validPaperRecord(rowState?.paper, facetSchema, 3))

  for (const group of groupRowsByNoteStatus(validRows)) {
    const section = document.createElement("section")
    const heading = document.createElement("h3")
    const headingId = `library-note-group-${group.status}`
    section.className = "library-note-group"
    section.dataset.noteGroup = group.status
    section.setAttribute("aria-labelledby", headingId)
    heading.className = "library-note-group-heading"
    heading.dataset.noteGroupHeading = ""
    heading.setAttribute("id", headingId)
    heading.textContent = `${group.label} ${group.rows.length}`
    section.append(heading)

    for (const rowState of group.rows) {
      const paper = rowState?.paper
      const instance = template.content.cloneNode(true)
      const row = instance.querySelector(".library-paper-row")
      const selectButton = instance.querySelector('[data-action="select-paper"]')
      const detailButton = instance.querySelector('[data-action="open-detail"]')
      if (!row || !selectButton || !detailButton) continue
      const identity = describePaperIdentity(paper)

      row.dataset.paperId = paper.paper_id
      const selected = paper.paper_id === selectedPaperId
      row.classList.toggle("library-paper-row--selected", selected)
      if (selected) row.setAttribute("aria-current", "true")
      else row.removeAttribute("aria-current")
      selectButton.setAttribute("aria-pressed", String(selected))
      selectButton.setAttribute("aria-label", paperActionLabel({ action: "select-paper", paper }))
      detailButton.setAttribute("aria-label", paperActionLabel({ action: "open-detail", paper }))
      setFieldText(instance, '[data-field="reading-marker"]', translateState("personal_reading_marker", rowState.personalReadingMarker))
      setFieldText(instance, '[data-field="paper-id"]', paper.paper_id)
      setFieldText(instance, '[data-field="year"]', Number.isInteger(paper.year) ? String(paper.year) : "年份未记录")
      setFieldText(instance, '[data-field="title"]', identity.displayTitle)
      setFieldText(instance, '[data-field="authors"]', displayAuthors(paper))
      setFieldText(instance, '[data-field="availability"]', rowState.availabilitySummary || "材料状态待确认")
      const identityStatus = instance.querySelector('[data-field="identity-status"]')
      if (identityStatus) {
        identityStatus.hidden = !identity.identityPending
        if (identity.identityPending) identityStatus.dataset.identityStatus = "pending"
        else delete identityStatus.dataset.identityStatus
      }
      const sourceDirectory = instance.querySelector('[data-field="source-directory"]')
      if (sourceDirectory) sourceDirectory.hidden = !identity.showSourceDirectory
      setFieldText(instance, '[data-field="relative-path"]', identity.showSourceDirectory ? identity.relativePath : "")
      const hits = Array.isArray(rowState.hits) ? rowState.hits : []
      row.dataset.hitFields = hits
        .map((hit) => hit?.field)
        .filter((field) => typeof field === "string" && field.trim())
        .map((field) => field.trim())
        .join("、")
      setFieldText(
        instance,
        '[data-field="search-hits"]',
        hits.length > 0 ? hits.map((hit) => `命中${hit.field}：${hit.snippet}`).join("；") : "",
      )
      section.append(instance)
    }
    fragment.append(section)
  }
  container.replaceChildren(fragment)
}

export function nextOpenFacetPanel(current, requested) {
  if (!Object.hasOwn(FACET_PANEL_PATHS, requested)) return current ?? null
  return current === requested ? null : requested
}

function optionCount({ papers, filters, workspaceState, userTagState, facetSchema, path, value }) {
  const facets = { ...(filters?.facets ?? {}) }
  delete facets[path]
  facets[path] = [value]
  return filterLibrary(papers, { ...filters, facets, facetSchema }, workspaceState, userTagState).length
}

function recordTypeCount({ papers, filters, workspaceState, userTagState, facetSchema, value }) {
  return filterLibrary(papers, { ...filters, recordTypes: [value], facetSchema }, workspaceState, userTagState).length
}

export function buildFacetPanelModel({
  panel, facetSchema, papers = [], filters = {}, workspaceState = {}, userTagState = {},
} = {}) {
  const groups = (facetSchema?.groups ?? [])
    .filter((group) => group.panel === panel)
    .map((group) => ({
      path: group.path,
      label: group.label,
      options: group.values.map((value) => {
        const selected = Array.isArray(filters?.facets?.[group.path]) && filters.facets[group.path].includes(value)
        const count = optionCount({ papers, filters, workspaceState, userTagState, facetSchema, path: group.path, value })
        return { value, count, selected, disabled: count === 0 && !selected }
      }),
    }))
  const recordTypes = panel === "more" ? RECORD_TYPES.map((value) => {
    const selected = Array.isArray(filters?.recordTypes) && filters.recordTypes.includes(value)
    const count = recordTypeCount({ papers, filters, workspaceState, userTagState, facetSchema, value })
    return { value, count, selected, disabled: count === 0 && !selected }
  }) : []
  return { panel, groups, recordTypes }
}

function appendFilterOption(document, parent, option, { kind, path = "" }) {
  const label = document.createElement("label")
  label.className = "facet-option"
  if (option.disabled) label.dataset.empty = ""
  const input = document.createElement("input")
  input.type = "checkbox"
  input.checked = option.selected
  input.disabled = option.disabled
  input.value = option.value
  input.dataset.filterKind = kind
  if (path) input.dataset.facetPath = path
  const text = document.createElement("span")
  text.textContent = option.value
  const count = document.createElement("small")
  count.textContent = option.disabled ? `${option.count} 篇，当前不可选` : `${option.count} 篇`
  label.append(input, text, count)
  parent.append(label)
}

export function renderFacetPanel({ document, mount, model }) {
  if (!mount) return
  const fragment = document.createDocumentFragment()
  for (const group of model?.groups ?? []) {
    const section = document.createElement("section")
    section.className = "facet-group"
    section.dataset.facetPath = group.path
    const heading = document.createElement("h3")
    heading.textContent = group.label
    const options = document.createElement("div")
    options.className = "facet-options"
    for (const option of group.options) appendFilterOption(document, options, option, { kind: "facet", path: group.path })
    section.append(heading, options)
    fragment.append(section)
  }
  if ((model?.recordTypes ?? []).length > 0) {
    const section = document.createElement("section")
    section.className = "facet-group facet-group--record-type"
    const heading = document.createElement("h3")
    heading.textContent = "记录类型"
    const options = document.createElement("div")
    options.className = "facet-options"
    for (const option of model.recordTypes) appendFilterOption(document, options, option, { kind: "recordType" })
    section.append(heading, options)
    fragment.append(section)
  }
  mount.replaceChildren(fragment)
}

function selectedChipModels({ filters, facetSchema, papers = [], workspaceState = {}, userTagState = {} }) {
  const chips = []
  for (const group of facetSchema?.groups ?? []) {
    for (const value of filters?.facets?.[group.path] ?? []) {
      chips.push({
        kind: "facet", path: group.path, value, label: group.label,
        count: optionCount({ papers, filters, workspaceState, userTagState, facetSchema, path: group.path, value }),
      })
    }
  }
  for (const value of RECORD_TYPES) {
    if (!filters?.recordTypes?.includes(value)) continue
    chips.push({
      kind: "recordType", path: "", value, label: "记录类型",
      count: recordTypeCount({ papers, filters, workspaceState, userTagState, facetSchema, value }),
    })
  }
  return chips
}

export function renderSelectedFacetChips({
  document, mount, filters = {}, facetSchema, papers = [], workspaceState = {}, userTagState = {},
}) {
  if (!mount) return
  const fragment = document.createDocumentFragment()
  const chips = selectedChipModels({ filters, facetSchema, papers, workspaceState, userTagState })
  if (chips.length === 0) {
    const empty = document.createElement("p")
    empty.textContent = "尚未选择学术条件"
    fragment.append(empty)
  }
  for (const chip of chips) {
    const item = document.createElement("span")
    item.className = "selected-facet-chip"
    item.append(document.createTextNode(`${chip.label}：${chip.value}`))
    if (papers.length > 0) {
      const count = document.createElement("small")
      count.textContent = `${chip.count} 篇`
      item.append(count)
    }
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.removeFilter = ""
    button.dataset.filterKind = chip.kind
    button.dataset.facetPath = chip.path
    button.dataset.filterValue = chip.value
    button.setAttribute("aria-label", `移除${chip.label}：${chip.value}`)
    button.textContent = "移除"
    item.append(button)
    fragment.append(item)
  }
  mount.replaceChildren(fragment)
}

export function removeFilterSelection(filters = {}, { kind, path, value } = {}) {
  if (kind === "recordType") {
    return { ...filters, recordTypes: (filters.recordTypes ?? []).filter((item) => item !== value) }
  }
  if (kind !== "facet" || typeof path !== "string") return filters
  const facets = { ...(filters.facets ?? {}) }
  const remaining = (facets[path] ?? []).filter((item) => item !== value)
  if (remaining.length > 0) facets[path] = remaining
  else delete facets[path]
  return { ...filters, facets }
}

function toggleFilterSelection(filters, { kind, path, value, selected }) {
  const without = removeFilterSelection(filters, { kind, path, value })
  if (!selected) return without
  if (kind === "recordType") return { ...without, recordTypes: [...(without.recordTypes ?? []), value] }
  const current = without.facets?.[path] ?? []
  return { ...without, facets: { ...(without.facets ?? {}), [path]: [...current, value] } }
}

export function resetLibraryFilters() {
  return {
    query: "", facets: {}, recordTypes: [], personalReadingMarkers: [], sourceStatuses: [],
    evidenceStatuses: [], reproductionStatuses: [], shelfRoles: [],
  }
}

export function buildDesktopLibraryViewState(options = {}) {
  const filters = options.facetSchema === undefined
    ? options.filters
    : { ...(options.filters ?? {}), facetSchema: options.facetSchema }
  return buildLibraryViewState({ ...options, filters })
}

function readCheckedFilters(form, query, shelfRoles, facets, recordTypes) {
  const filters = { query, facets: { ...(facets ?? {}) }, recordTypes: [...(recordTypes ?? [])] }
  for (const axis of MATERIAL_FILTER_AXES) filters[axis] = axis === "shelfRoles" ? [...shelfRoles] : []
  for (const input of form.querySelectorAll('input[type="checkbox"]:checked')) {
    if (MATERIAL_FILTER_AXES.includes(input.name) && input.name !== "shelfRoles") filters[input.name].push(input.value)
  }
  return filters
}

function renderShelfSummaries(document, summaries, activeRoles) {
  for (const summary of summaries) {
    const button = document.querySelector(`#p02-shelf [data-shelf-role="${summary.role}"]`)
    if (!button) continue
    button.setAttribute("aria-pressed", String(activeRoles.includes(summary.role)))
    button.classList.toggle("library-shelf-slot--active", activeRoles.includes(summary.role))
    setFieldText(button, '[data-field="shelf-count"]', `${summary.count} 篇`)
    setFieldText(button, '[data-field="shelf-titles"]', summary.titles.length > 0 ? summary.titles.join(" · ") : "尚未加入论文")
    const overflow = button.querySelector('[data-field="shelf-overflow"]')
    if (overflow) {
      overflow.hidden = summary.overflow === 0
      overflow.textContent = summary.overflow > 0 ? `另有 ${summary.overflow} 篇` : ""
    }
  }
}

function warningSummary(count) {
  if (!Number.isInteger(count) || count < 0) return "扫描警告数量未提供"
  if (count === 0) return "扫描未记录警告"
  return `${count} 条扫描警告；详细信息仅保存在本地审计中`
}

function paperById(papers, paperId) {
  return papers.find((paper) => paper.paper_id === paperId) ?? null
}

function sourceDocumentsFor(paper, kind) {
  return Array.isArray(paper?.source_documents?.[kind]) ? paper.source_documents[kind] : []
}

function normalizedSourceViewMode(mode, sourceDocuments) {
  const hasPdf = sourceDocumentsFor({ source_documents: sourceDocuments }, "pdf").length > 0
  const hasOcr = sourceDocumentsFor({ source_documents: sourceDocuments }, "ocr").length > 0
  if (mode === "compare" && (hasPdf === hasOcr)) return mode
  if (mode === "pdf" && hasPdf) return mode
  if (mode === "ocr" && hasOcr) return mode
  return defaultSourceViewMode(sourceDocuments)
}

function sourceSizeLabel(sizeBytes) {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) return "大小未记录"
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

function replaceSourceOptions(document, select, control, documents, selectedIndex) {
  if (!select) return
  const fragment = document.createDocumentFragment()
  for (const [index, sourceDocument] of documents.entries()) {
    const option = document.createElement("option")
    option.value = String(index)
    option.textContent = documents.length > 1
      ? `${index + 1}. ${sourceDocument.label}（${sourceSizeLabel(sourceDocument.size_bytes)}）`
      : sourceDocument.label
    option.selected = index === selectedIndex
    fragment.append(option)
  }
  select.replaceChildren(fragment)
  select.disabled = documents.length <= 1
  if (control) control.hidden = documents.length <= 1
}

export function downloadUserTagJson({ document, json, fileName = "paper-user-tags.json" }) {
  const BlobImpl = document?.defaultView?.Blob
  const URLImpl = document?.defaultView?.URL
  if (typeof json !== "string" || typeof BlobImpl !== "function"
      || typeof URLImpl?.createObjectURL !== "function" || typeof URLImpl?.revokeObjectURL !== "function") {
    throw new Error("当前浏览器不支持标签导出")
  }
  const url = URLImpl.createObjectURL(new BlobImpl([json], { type: "application/json" }))
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    URLImpl.revokeObjectURL(url)
  }
}

export function createLibraryController({ document, storage, fetchImpl = globalThis.fetch }) {
  const store = createWorkspaceStore(storage)
  const userTagStore = createUserTagStore(storage)
  let userTagNotice = ""
  let papers = []
  let facetSchema = null
  let warningCount = null
  let localCapabilities = null
  let filters = resetLibraryFilters()
  let openFacetPanel = null
  let sortMode = "default"
  let eventsBound = false
  let loadState = "idle"
  let detailOpen = false
  let detailPaperId = null
  let activeReaderTab = "note"
  let sourceViewMode = "compare"
  let sourcePdfIndex = 0
  let sourceOcrIndex = 0
  let readerMaterialSelection = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [kind, null]))
  let readerTocExpanded = true
  let readerLoadGeneration = 0
  let detailTriggerPaperId = null
  let activePaperId = null
  let imageLightboxTrigger = null
  const indexLoader = createRetryableLoader(() => loadPaperIndex(fetchImpl))
  const privatePathCopyGuard = createPrivatePathCopyGuard(() => {
    const status = elements().inspectorStatus
    if (status) status.textContent = ""
  })

  function elements() {
    return {
      search: document.getElementById("library-search"),
      shelf: document.getElementById("p02-shelf"),
      filterForm: document.getElementById("library-filters"),
      facetPanelTriggers: [...document.querySelectorAll("[data-facet-panel-trigger]")],
      facetPanel: document.querySelector("[data-facet-panel]"),
      selectedFacets: document.querySelector("[data-selected-facets]"),
      sort: document.getElementById("library-sort"),
      reset: document.getElementById("library-reset"),
      userTagImport: document.getElementById("library-user-tags-import"),
      results: document.getElementById("library-results"),
      count: document.getElementById("library-count"),
      coverage: document.getElementById("library-coverage-summary"),
      warning: document.getElementById("library-warning-summary"),
      empty: document.getElementById("library-empty"),
      error: document.getElementById("library-error"),
      inspector: document.querySelector("#library-inspector [data-inspector-content]"),
      inspectorRoot: document.getElementById("library-inspector"),
      inspectorStatus: document.querySelector("#library-inspector [data-inspector-status]"),
      contextTitle: document.getElementById("library-context-title"),
      listView: document.querySelector('[data-view="list"]'),
      detail: document.getElementById("library-detail"),
      detailBack: document.getElementById("library-detail-back"),
      readerTabs: document.getElementById("library-reader-tabs"),
      readerLoadStatus: document.querySelector("[data-reader-load-status]"),
      readerPanels: [...document.querySelectorAll("[data-reader-panel]")],
      readerOverview: document.querySelector("[data-reader-overview-content]"),
      readerWriting: document.querySelector("[data-reader-writing-content]"),
      readerToc: document.getElementById("library-reader-toc"),
      readerTocToggle: document.getElementById("library-reader-toc-toggle"),
      addNote: document.getElementById("library-add-note"),
      noteImportHelp: document.getElementById("library-note-import-help"),
      indexReloadStatus: document.querySelector("[data-index-reload-status]"),
      indexReload: document.getElementById("library-index-reload"),
      readerTocLinks: document.querySelector("#library-reader-toc [data-reader-toc-links]"),
      inspectorTitle: document.getElementById("library-inspector-title"),
      notePreview: document.getElementById("library-note-preview"),
      derivationPreview: document.getElementById("library-derivation-preview"),
      simulationPreview: document.getElementById("library-simulation-preview"),
      codeComparePreview: document.getElementById("library-code-compare-preview"),
      readerMaterialControls: Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [
        kind,
        document.querySelector(`[data-reader-material-control="${kind}"]`),
      ])),
      readerMaterialSelects: Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [
        kind,
        document.querySelector(`[data-reader-material-select="${kind}"]`),
      ])),
      sourceWorkspace: document.querySelector("[data-source-workspace]"),
      sourceModeButtons: [...document.querySelectorAll("button[data-source-mode]")],
      sourcePdfControl: document.querySelector('[data-source-version-control="pdf"]'),
      sourceOcrControl: document.querySelector('[data-source-version-control="ocr"]'),
      sourcePdfSelect: document.getElementById("library-source-pdf-select"),
      sourceOcrSelect: document.getElementById("library-source-ocr-select"),
      sourcePdfPane: document.querySelector('[data-source-pane="pdf"]'),
      sourceOcrPane: document.querySelector('[data-source-pane="ocr"]'),
      sourcePdfLabel: document.querySelector("[data-source-pdf-label]"),
      sourceOcrLabel: document.querySelector("[data-source-ocr-label]"),
      sourcePdfEmpty: document.querySelector("[data-source-pdf-empty]"),
      sourcePdfFrame: document.getElementById("library-source-pdf-frame"),
      sourcePdfOpen: document.getElementById("library-source-pdf-open"),
      sourceOcrPreview: document.getElementById("library-source-ocr-preview"),
      imageLightbox: document.getElementById("library-image-lightbox"),
      imageLightboxImage: document.getElementById("library-image-lightbox-image"),
      imageLightboxCaption: document.getElementById("library-image-lightbox-caption"),
      imageLightboxClose: document.getElementById("library-image-lightbox-close"),
    }
  }

  function closeImageLightbox() {
    const dialog = elements().imageLightbox
    if (dialog?.open && typeof dialog.close === "function") dialog.close()
  }

  function openImageLightbox(trigger) {
    const ui = elements()
    const source = trigger?.querySelector?.("img.note-image")
    const paper = paperById(papers, detailPaperId)
    const safeSrc = resolveSafePreviewAssetUrl({
      candidate: source?.getAttribute?.("src"),
      slug: paper?.slug,
      baseUrl: document?.defaultView?.location?.href ?? "",
    })
    if (!safeSrc || !ui.imageLightbox || !ui.imageLightboxImage || typeof ui.imageLightbox.showModal !== "function") return
    imageLightboxTrigger = trigger
    const alt = source?.getAttribute?.("alt")?.trim() || "论文图片"
    ui.imageLightboxImage.src = safeSrc
    ui.imageLightboxImage.alt = alt
    if (ui.imageLightboxCaption) ui.imageLightboxCaption.textContent = alt
    document.body?.classList.add("library-image-lightbox-open")
    ui.imageLightbox.showModal()
    ui.imageLightboxClose?.focus()
  }

  function previewMount(ui, kind) {
    if (kind === "note") return ui.notePreview
    if (kind === "derivation") return ui.derivationPreview
    if (kind === "simulation") return ui.simulationPreview
    if (kind === "code_compare") return ui.codeComparePreview
    return null
  }

  const previewCoordinators = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [
    kind,
    createPreviewCoordinator({
      loadPreview: (paper, { signal, previewKey }) => {
        const model = controlledPreviewSelectionModel(paper, kind, previewKey)
        return mountSafeControlledPreview({
          document,
          paper,
          kind,
          previewDocument: model.selectedDocument,
          emptyMessage: model.emptyMessage,
          fetchImpl,
          baseUrl: document?.defaultView?.location?.href ?? "",
          signal,
        })
      },
      commitPreview: (preview) => {
        const mount = previewMount(elements(), kind)
        if (mount) {
          mount.classList.toggle("library-preview-loading", false)
          mount.classList.toggle("library-reader-placeholder", false)
          mount.replaceChildren(preview)
        }
        updateReaderToc()
      },
      clearPreview: () => {
        const mount = previewMount(elements(), kind)
        if (mount) {
          mount.classList.toggle("library-preview-loading", true)
          mount.replaceChildren(document.createTextNode(previewLoadingMessage(kind)))
        }
      },
      AbortControllerImpl: document?.defaultView?.AbortController ?? globalThis.AbortController,
    }),
  ]))

  const sourceOcrCoordinator = createPreviewCoordinator({
    loadPreview: (paper, { signal, previewKey }) => {
      const sourceDocument = sourceDocumentsFor(paper, "ocr").find((item) => item.url === previewKey) ?? null
      return mountSafeSourceOcrPreview({
        document,
        paper,
        sourceDocument,
        fetchImpl,
        baseUrl: document?.defaultView?.location?.href ?? "",
        signal,
      })
    },
    commitPreview: (preview) => {
      const mount = elements().sourceOcrPreview
      if (mount) {
        mount.classList.toggle("library-preview-loading", false)
        mount.replaceChildren(preview)
      }
    },
    clearPreview: () => {
      const mount = elements().sourceOcrPreview
      if (mount) {
        mount.classList.toggle("library-preview-loading", true)
        mount.replaceChildren(document.createTextNode("正在读取 OCR 文本…"))
      }
    },
    AbortControllerImpl: document?.defaultView?.AbortController ?? globalThis.AbortController,
  })

  function clearSourceMedia() {
    const ui = elements()
    if (ui.sourcePdfFrame) {
      ui.sourcePdfFrame.hidden = true
      ui.sourcePdfFrame.removeAttribute("src")
    }
    if (ui.sourcePdfOpen) {
      ui.sourcePdfOpen.hidden = true
      ui.sourcePdfOpen.removeAttribute("href")
    }
  }

  function closeAllPreviews() {
    closeImageLightbox()
    readerLoadGeneration += 1
    for (const coordinator of Object.values(previewCoordinators)) coordinator.close()
    sourceOcrCoordinator.close()
    clearSourceMedia()
    const status = elements().readerLoadStatus
    if (status) status.textContent = ""
  }

  function activeReaderPanel(ui) {
    return ui.readerPanels.find((panel) => panel.dataset.readerPanel === activeReaderTab) ?? null
  }

  function updateReaderToc() {
    const ui = elements()
    const mount = ui.readerTocLinks
    const panel = activeReaderPanel(ui)
    if (!mount || !panel || !detailOpen) return
    const headings = [...panel.querySelectorAll("h1, h2, h3")]
    const fragment = document.createDocumentFragment()
    if (headings.length === 0) {
      const empty = document.createElement("p")
      empty.className = "library-reader-toc-empty"
      empty.textContent = "当前页暂无目录"
      fragment.append(empty)
    } else {
      const list = document.createElement("ol")
      for (const [index, heading] of headings.entries()) {
        const id = `reader-${activeReaderTab}-${index + 1}`
        heading.id = id
        const item = document.createElement("li")
        item.dataset.tocLevel = heading.tagName.toLowerCase()
        const link = document.createElement("a")
        link.href = `#${id}`
        link.textContent = readerHeadingLabel(heading) || `第 ${index + 1} 节`
        item.append(link)
        list.append(item)
      }
      fragment.append(list)
    }
    mount.replaceChildren(fragment)
  }

  function renderSourceReader(ui, paper) {
    const pdfDocuments = sourceDocumentsFor(paper, "pdf")
    const ocrDocuments = sourceDocumentsFor(paper, "ocr")
    sourcePdfIndex = Math.min(Math.max(sourcePdfIndex, 0), Math.max(pdfDocuments.length - 1, 0))
    sourceOcrIndex = Math.min(Math.max(sourceOcrIndex, 0), Math.max(ocrDocuments.length - 1, 0))
    sourceViewMode = normalizedSourceViewMode(sourceViewMode, paper.source_documents)

    replaceSourceOptions(document, ui.sourcePdfSelect, ui.sourcePdfControl, pdfDocuments, sourcePdfIndex)
    replaceSourceOptions(document, ui.sourceOcrSelect, ui.sourceOcrControl, ocrDocuments, sourceOcrIndex)

    const hasPdf = pdfDocuments.length > 0
    const hasOcr = ocrDocuments.length > 0
    for (const button of ui.sourceModeButtons) {
      const mode = button.dataset.sourceMode
      const available = mode === "compare" ? hasPdf === hasOcr : mode === "pdf" ? hasPdf : hasOcr
      button.disabled = !available
      button.setAttribute("aria-pressed", String(mode === sourceViewMode))
    }
    if (ui.sourceWorkspace) ui.sourceWorkspace.dataset.sourceMode = sourceViewMode

    const showPdf = sourceViewMode !== "ocr" && (hasPdf || (!hasPdf && !hasOcr))
    const showOcr = sourceViewMode !== "pdf" && (hasOcr || (!hasPdf && !hasOcr))
    if (ui.sourcePdfPane) ui.sourcePdfPane.hidden = !showPdf
    if (ui.sourceOcrPane) ui.sourceOcrPane.hidden = !showOcr

    const pdfDocument = pdfDocuments[sourcePdfIndex] ?? null
    const safePdfUrl = resolveSafeSourceDocumentUrl({
      candidate: pdfDocument?.url,
      slug: paper.slug,
      kind: "pdf",
      baseUrl: document?.defaultView?.location?.href ?? "",
    })
    if (ui.sourcePdfLabel) ui.sourcePdfLabel.textContent = pdfDocument?.label ?? "PDF"
    if (ui.sourcePdfEmpty) {
      ui.sourcePdfEmpty.hidden = Boolean(showPdf && safePdfUrl)
      ui.sourcePdfEmpty.textContent = pdfDocument && !safePdfUrl ? "PDF 原文地址无效。" : "未发现 PDF 文件。"
    }
    syncSourcePdfFrame({
      frame: ui.sourcePdfFrame,
      show: Boolean(showPdf && safePdfUrl),
      url: safePdfUrl,
      label: pdfDocument?.label ?? "",
    })
    if (ui.sourcePdfOpen) {
      ui.sourcePdfOpen.hidden = !(showPdf && safePdfUrl)
      if (showPdf && safePdfUrl) ui.sourcePdfOpen.href = safePdfUrl
      else ui.sourcePdfOpen.removeAttribute("href")
    }

    const ocrDocument = ocrDocuments[sourceOcrIndex] ?? null
    if (ui.sourceOcrLabel) ui.sourceOcrLabel.textContent = ocrDocument?.label ?? "Markdown"
    return {
      ocrDocument,
      showOcr: Boolean(showOcr && ocrDocument),
      showPdf: Boolean(showPdf && safePdfUrl),
    }
  }

  function renderReaderState(ui, paper, workspaceState, userTagState) {
    for (const tab of ui.readerTabs?.querySelectorAll('[role="tab"]') ?? []) {
      const selected = tab.dataset.readerTab === activeReaderTab
      tab.setAttribute("aria-selected", String(selected))
      tab.tabIndex = selected ? 0 : -1
    }
    for (const panel of ui.readerPanels) panel.hidden = panel.dataset.readerPanel !== activeReaderTab
    if (ui.readerOverview) {
      ui.readerOverview.replaceChildren(renderReaderOverview({
        document,
        paper,
        facetSchema,
        userTags: userTagState.papers[paper.paper_id] ?? [],
        userTagNotice,
      }))
    }
    if (ui.readerWriting) ui.readerWriting.replaceChildren(renderReaderWriting({ document, paper, workspaceState }))

    const previewModels = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [
      kind,
      renderReaderMaterialSelector({
        document,
        control: ui.readerMaterialControls?.[kind],
        select: ui.readerMaterialSelects?.[kind],
        paper,
        tab: kind,
        selectedKey: readerMaterialSelection[kind],
      }),
    ]))

    const activeKinds = previewKindsForReaderTab(activeReaderTab)
    const statusGeneration = ++readerLoadGeneration
    const statusTab = activeReaderTab
    const activePreviewModel = previewModels[statusTab] ?? null
    const previewStatusContext = activePreviewModel
      ? { selected: Boolean(activePreviewModel.selectedDocument), placeholder: activePreviewModel.placeholder ?? "" }
      : undefined
    const loadOperations = []
    let sourceStatus = null
    if (ui.readerLoadStatus) {
      ui.readerLoadStatus.textContent = readerTabStatusMessage(statusTab, "loading", previewStatusContext)
    }
    for (const kind of CONTROLLED_PREVIEW_KEYS) {
      if (activeKinds.includes(kind)) {
        const model = previewModels[kind]
        const previewKey = model.selectedDocument?.selectionKey ?? `${kind}:unselected:${model.documents.length}`
        loadOperations.push(previewCoordinators[kind].sync({ detailOpen: true, paper, previewKey }))
      } else if (previewCoordinators[kind].isOpen()) {
        previewCoordinators[kind].close()
      }
    }
    if (activeReaderTab === "source") {
      const { ocrDocument, showOcr, showPdf } = renderSourceReader(ui, paper)
      sourceStatus = { showPdf, showOcr }
      if (showOcr) {
        if (ui.readerLoadStatus) {
          ui.readerLoadStatus.textContent = sourceReaderStatusMessage({ ...sourceStatus, ocrState: "loading" })
        }
        loadOperations.push(sourceOcrCoordinator.sync({
          detailOpen: true,
          paper,
          previewKey: ocrDocument.url,
        }))
      } else {
        sourceOcrCoordinator.close()
        if (ui.sourceOcrPreview) {
          ui.sourceOcrPreview.classList.toggle("library-preview-loading", false)
          ui.sourceOcrPreview.textContent = "未发现 OCR Markdown。"
        }
        if (ui.readerLoadStatus) {
          ui.readerLoadStatus.textContent = sourceReaderStatusMessage({ ...sourceStatus, ocrState: "idle" })
        }
      }
    } else {
      sourceOcrCoordinator.close()
      clearSourceMedia()
    }
    if (loadOperations.length > 0) {
      void Promise.allSettled(loadOperations).then(() => {
        if (
          statusGeneration !== readerLoadGeneration
          || !detailOpen
          || detailPaperId !== paper.paper_id
          || activeReaderTab !== statusTab
        ) return
        const status = elements().readerLoadStatus
        if (status) {
          status.textContent = statusTab === "source"
            ? sourceReaderStatusMessage({ ...sourceStatus, ocrState: "ready" })
            : readerTabStatusMessage(statusTab, "ready", previewStatusContext)
        }
      })
    }
    updateReaderToc()
  }

  function renderCurrentInspector(mount, paper, workspaceState, userTagState) {
    if (!mount) return
    if (!paper) {
      const empty = document.createElement("div")
      empty.className = "library-inspector-empty"
      const title = document.createElement("strong")
      title.textContent = "请选择一篇论文"
      const description = document.createElement("p")
      description.textContent = "这里显示材料数量、阅读标记与 P02 用途，不展示私有文件路径。"
      empty.append(title, description)
      mount.replaceChildren(empty)
      return
    }
    mount.replaceChildren(renderInspector({
      document,
      paper,
      workspaceState,
      facetSchema,
      userTags: userTagState.papers[paper.paper_id] ?? [],
      userTagNotice,
      sourcePathAvailable: localCapabilities?.source_path === true,
    }))
  }

  function render() {
    const ui = elements()
    const workspaceState = store.read()
    const userTagState = userTagStore.read()
    const view = buildDesktopLibraryViewState({
      papers, filters, facetSchema, sortMode, workspaceState, userTagState,
    })
    const listSelectedPaper = view.selectedPaper
    const selectedPaperId = chooseDisplayedPaperId({
      selectedPaper: listSelectedPaper,
      persistedPaperId: workspaceState.selectedPaperId,
    })
    let activePaper = chooseActivePaper({ papers, detailOpen, detailPaperId, listSelectedPaper })
    if (detailOpen && !activePaper) {
      detailOpen = false
      detailPaperId = null
      readerMaterialSelection = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [kind, null]))
      closeAllPreviews()
      activePaper = listSelectedPaper
    }
    activePaperId = detailOpen ? activePaper?.paper_id ?? null : selectedPaperId
    privatePathCopyGuard.syncSelection(activePaperId)

    renderShelfSummaries(document, view.shelfSummaries, filters.shelfRoles ?? [])
    renderPaperRows({ document, rows: view.rows, selectedPaperId, facetSchema })
    for (const trigger of ui.facetPanelTriggers) {
      const expanded = trigger.dataset.facetPanelTrigger === openFacetPanel
      trigger.setAttribute("aria-expanded", String(expanded))
      trigger.classList.toggle("facet-entry--active", expanded)
    }
    if (ui.facetPanel) {
      ui.facetPanel.hidden = openFacetPanel === null
      if (openFacetPanel) {
        renderFacetPanel({
          document,
          mount: ui.facetPanel,
          model: buildFacetPanelModel({
            panel: openFacetPanel, facetSchema, papers, filters, workspaceState, userTagState,
          }),
        })
      } else ui.facetPanel.replaceChildren()
    }
    renderSelectedFacetChips({
      document, mount: ui.selectedFacets, filters, facetSchema, papers, workspaceState, userTagState,
    })
    if (ui.count) {
      ui.count.textContent = loadState === "error"
        ? "论文库不可用"
        : `显示 ${view.resultCount} 篇，共 ${view.totalCount} 篇`
    }
    if (ui.coverage) ui.coverage.textContent = summarizeMetadataCoverage(papers).text
    if (ui.warning) ui.warning.textContent = warningSummary(warningCount)
    if (ui.contextTitle) ui.contextTitle.textContent = readerContextLabel({ detailOpen, paper: activePaper })
    if (ui.addNote) ui.addNote.disabled = localCapabilities?.note_import !== true
    if (ui.noteImportHelp) ui.noteImportHelp.hidden = localCapabilities?.note_import === true
    const visibility = computeLoadVisibility({ loadState, viewEmpty: view.empty })
    if (ui.empty) ui.empty.hidden = visibility.emptyHidden
    if (ui.error) ui.error.hidden = visibility.errorHidden
    document.body?.classList.toggle("library-reader-open", detailOpen)
    document.body?.classList.toggle("library-source-view-open", detailOpen && activeReaderTab === "source")
    applyReaderTocVisibility({
      document,
      toc: ui.readerToc,
      toggle: ui.readerTocToggle,
      detailOpen,
      expanded: readerTocExpanded,
      forceHidden: activeReaderTab === "source",
    })
    if (ui.listView) ui.listView.hidden = detailOpen
    if (ui.detail) ui.detail.hidden = !detailOpen
    if (detailOpen && activePaper) {
      if (ui.inspector) ui.inspector.hidden = true
      if (ui.inspectorTitle) ui.inspectorTitle.textContent = "本页目录"
      renderReaderState(ui, activePaper, workspaceState, userTagState)
    } else {
      closeAllPreviews()
      if (ui.inspector) ui.inspector.hidden = false
      if (ui.inspectorTitle) ui.inspectorTitle.textContent = "论文检查器"
      renderCurrentInspector(ui.inspector, listSelectedPaper, workspaceState, userTagState)
    }
    return activePaper
  }

  async function copyPrivatePath(paperId) {
    const ui = elements()
    const request = privatePathCopyGuard.begin(paperId)
    let sourcePath = null
    try {
      if (localCapabilities?.source_path !== true) throw new Error("source path unavailable")
      sourcePath = await loadPrivateSourcePath({ fetchImpl, paperId })
      if (!privatePathCopyGuard.isCurrent(request)) return
      const clipboard = document.defaultView?.navigator?.clipboard
      if (typeof clipboard?.writeText !== "function") throw new Error("clipboard unavailable")
      await clipboard.writeText(sourcePath)
      if (privatePathCopyGuard.isCurrent(request) && ui.inspectorStatus) ui.inspectorStatus.textContent = "原始路径已复制"
    } catch {
      if (privatePathCopyGuard.isCurrent(request) && ui.inspectorStatus) ui.inspectorStatus.textContent = "原始路径暂不可用"
    } finally {
      sourcePath = null
    }
  }

  function personalTagPaperId() {
    return detailOpen ? detailPaperId : activePaperId
  }

  function focusUserTagInput(root) {
    root?.querySelector?.("[data-user-tag-input]")?.focus()
  }

  function mutateUserTag(action, root) {
    const paperId = personalTagPaperId()
    if (!paperById(papers, paperId)) return
    try {
      if (action.dataset.action === "remove-user-tag") {
        const result = userTagStore.remove(paperId, action.dataset.userTagLabel)
        userTagNotice = result.removed ? `已移除标签“${action.dataset.userTagLabel}”` : "标签未发生变化"
      } else if (action.dataset.action === "export-user-tags") {
        downloadUserTagJson({ document, json: userTagStore.exportJson() })
        userTagNotice = "个人标签 JSON 已导出"
      } else if (action.dataset.action === "import-user-tags") {
        elements().userTagImport?.click()
        return
      } else return
    } catch (error) {
      userTagNotice = error instanceof Error ? error.message : "个人标签操作失败"
    }
    render()
    if (action.dataset.action === "remove-user-tag") focusUserTagInput(root)
  }

  function bindUserTagEditor(root) {
    root?.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-user-tag-form]")
      if (!form || !root.contains(form)) return
      event.preventDefault()
      const input = form.querySelector("[data-user-tag-input]")
      const paperId = personalTagPaperId()
      if (!input || !paperById(papers, paperId)) return
      try {
        const result = userTagStore.add(paperId, input.value)
        userTagNotice = result.added ? `已添加标签“${result.label}”` : `标签“${result.label}”已存在`
      } catch (error) {
        userTagNotice = error instanceof Error ? error.message : "个人标签操作失败"
      }
      render()
      focusUserTagInput(detailOpen ? elements().detail : elements().inspectorRoot)
    })
    root?.addEventListener("click", (event) => {
      const action = event.target.closest('[data-action="remove-user-tag"], [data-action="export-user-tags"], [data-action="import-user-tags"]')
      if (action && root.contains(action)) mutateUserTag(action, root)
    })
  }

  function bindEvents() {
    const ui = elements()
    bindUserTagEditor(ui.inspectorRoot)
    bindUserTagEditor(ui.detail)
    ui.userTagImport?.addEventListener("change", async () => {
      const file = ui.userTagImport.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const result = userTagStore.importJson(text, {
          mode: "merge",
          knownPaperIds: new Set(papers.map((paper) => paper.paper_id)),
        })
        userTagNotice = [
          `新增 ${result.addedCount} 个标签`,
          `跳过 ${result.duplicateCount} 个重复标签`,
          `未匹配 ${result.unmatchedPaperCount} 篇论文`,
        ].join("；")
      } catch (error) {
        userTagNotice = error instanceof Error ? error.message : "个人标签导入失败"
      } finally {
        ui.userTagImport.value = ""
      }
      render()
      focusUserTagInput(detailOpen ? elements().detail : elements().inspectorRoot)
    })
    ui.search?.addEventListener("input", () => {
      filters = readCheckedFilters(
        ui.filterForm, ui.search.value, filters.shelfRoles ?? [], filters.facets, filters.recordTypes,
      )
      render()
    })
    ui.filterForm?.addEventListener("change", (event) => {
      const input = event.target
      if (input?.dataset?.filterKind === "facet" || input?.dataset?.filterKind === "recordType") {
        filters = toggleFilterSelection(filters, {
          kind: input.dataset.filterKind,
          path: input.dataset.facetPath ?? "",
          value: input.value,
          selected: input.checked,
        })
      } else {
        filters = readCheckedFilters(
          ui.filterForm, ui.search?.value ?? "", filters.shelfRoles ?? [], filters.facets, filters.recordTypes,
        )
      }
      render()
    })
    ui.filterForm?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-facet-panel-trigger]")
      if (trigger) {
        openFacetPanel = nextOpenFacetPanel(openFacetPanel, trigger.dataset.facetPanelTrigger)
        render()
        if (openFacetPanel) elements().facetPanel?.querySelector("input:not(:disabled)")?.focus()
        else trigger.focus()
        return
      }
      const remove = event.target.closest("[data-remove-filter]")
      if (!remove) return
      filters = removeFilterSelection(filters, {
        kind: remove.dataset.filterKind,
        path: remove.dataset.facetPath,
        value: remove.dataset.filterValue,
      })
      render()
      const refreshed = elements()
      const nextChip = refreshed.selectedFacets?.querySelector("[data-remove-filter]")
      const activeTrigger = refreshed.facetPanelTriggers.find((item) => item.dataset.facetPanelTrigger === openFacetPanel)
      const focusTarget = nextChip ?? activeTrigger ?? refreshed.count
      focusTarget?.focus()
    })
    ui.sort?.addEventListener("change", () => {
      sortMode = ui.sort.value
      render()
    })
    ui.reset?.addEventListener("click", () => {
      if (ui.search) ui.search.value = ""
      ui.filterForm?.reset()
      filters = resetLibraryFilters()
      render()
      ui.count?.focus()
    })
    ui.shelf?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shelf-role]")
      const role = button?.dataset.shelfRole
      if (!P02_ROLES.includes(role)) return
      filters = { ...filters, shelfRoles: toggleExclusiveShelfRole(filters.shelfRoles, role) }
      render()
      focusResultCount(elements().count)
    })
    ui.results?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")
      const row = action?.closest("[data-paper-id]")
      const paperId = row?.dataset.paperId
      if (!paperById(papers, paperId)) return
      if (action.dataset.action === "select-paper") {
        store.setSelectedPaper(paperId)
        render()
        restorePaperSelectionFocus(elements().results, paperId)
      } else if (action.dataset.action === "open-detail") {
        store.setSelectedPaper(paperId)
        detailOpen = true
        detailPaperId = paperId
        activeReaderTab = "note"
        sourceViewMode = defaultSourceViewMode(paperById(papers, paperId)?.source_documents)
        sourcePdfIndex = 0
        sourceOcrIndex = 0
        readerMaterialSelection = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [kind, null]))
        detailTriggerPaperId = paperId
        render()
        focusDetailEntry(elements().detailBack)
      }
    })
    ui.readerTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-reader-tab]")
      if (!READER_TAB_KEYS.includes(tab?.dataset.readerTab)) return
      closeImageLightbox()
      activeReaderTab = tab.dataset.readerTab
      render()
    })
    ui.readerTabs?.addEventListener("keydown", (event) => {
      if (!READER_TAB_KEYS.includes(event.target?.dataset?.readerTab)) return
      const next = nextReaderTabKey({ current: event.target.dataset.readerTab, key: event.key })
      if (next === event.target.dataset.readerTab && !["Home", "End"].includes(event.key)) return
      event.preventDefault()
      activeReaderTab = next
      render()
      ui.readerTabs.querySelector(`[data-reader-tab="${next}"]`)?.focus()
    })
    ui.readerTocToggle?.addEventListener("click", () => {
      if (!detailOpen) return
      readerTocExpanded = !readerTocExpanded
      applyReaderTocVisibility({
        document,
        toc: ui.readerToc,
        toggle: ui.readerTocToggle,
        detailOpen,
        expanded: readerTocExpanded,
        forceHidden: activeReaderTab === "source",
      })
    })
    ui.detail?.addEventListener("click", (event) => {
      const modeButton = event.target.closest("button[data-source-mode]")
      if (modeButton && !modeButton.disabled && ["compare", "pdf", "ocr"].includes(modeButton.dataset.sourceMode)) {
        sourceViewMode = modeButton.dataset.sourceMode
        render()
        modeButton.focus()
        return
      }
      const trigger = event.target.closest("[data-image-lightbox-trigger]")
      if (!trigger || !ui.detail.contains(trigger)) return
      openImageLightbox(trigger)
    })
    ui.detail?.addEventListener("change", (event) => {
      const materialSelect = event.target?.closest?.("[data-reader-material-select]") ?? null
      const materialTab = materialSelect?.dataset.readerMaterialSelect
      if (CONTROLLED_PREVIEW_KEYS.includes(materialTab) && materialTab === activeReaderTab) {
        const paper = paperById(papers, detailPaperId)
        const selectable = controlledPreviewDocumentsForReaderTab(paper, materialTab)
        if (!selectable.some((previewDocument) => previewDocument.selectionKey === materialSelect.value)) return
        changeReaderMaterialSelection({
          selectionByTab: readerMaterialSelection,
          tab: materialTab,
          url: materialSelect.value,
          render,
          findSelect: (tab) => elements().readerMaterialSelects?.[tab],
        })
      } else if (event.target === ui.sourcePdfSelect) {
        const index = Number.parseInt(ui.sourcePdfSelect.value, 10)
        if (!Number.isInteger(index)) return
        sourcePdfIndex = index
        render()
        elements().sourcePdfSelect?.focus()
      } else if (event.target === ui.sourceOcrSelect) {
        const index = Number.parseInt(ui.sourceOcrSelect.value, 10)
        if (!Number.isInteger(index)) return
        sourceOcrIndex = index
        render()
        elements().sourceOcrSelect?.focus()
      }
    })
    ui.imageLightboxClose?.addEventListener("click", closeImageLightbox)
    ui.imageLightbox?.addEventListener("click", (event) => {
      if (event.target === ui.imageLightbox) closeImageLightbox()
    })
    ui.imageLightbox?.addEventListener("close", () => {
      document.body?.classList.remove("library-image-lightbox-open")
      if (ui.imageLightboxImage) {
        ui.imageLightboxImage.removeAttribute("src")
        ui.imageLightboxImage.alt = ""
      }
      if (ui.imageLightboxCaption) ui.imageLightboxCaption.textContent = ""
      const trigger = imageLightboxTrigger
      imageLightboxTrigger = null
      if (trigger?.isConnected) trigger.focus()
    })
    ui.inspectorRoot?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")
      const selectedId = activePaperId
      if (!action || !paperById(papers, selectedId)) return
      if (action.dataset.action === "toggle-shelf" && P02_ROLES.includes(action.dataset.role)) {
        const role = action.dataset.role
        store.toggleShelfRole(selectedId, role)
        render()
        restoreInspectorActionFocus(elements().inspectorRoot, { action: "toggle-shelf", role })
      } else if (action.dataset.action === "set-reading" && PERSONAL_READING_MARKER.includes(action.dataset.marker)) {
        const marker = action.dataset.marker
        store.setPersonalReadingMarker(selectedId, marker)
        render()
        restoreInspectorActionFocus(elements().inspectorRoot, { action: "set-reading", marker })
      } else if (action.dataset.action === "copy-private-path") {
        void copyPrivatePath(selectedId)
      }
    })
    ui.detailBack?.addEventListener("click", () => {
      closeAllPreviews()
      detailOpen = false
      detailPaperId = null
      activeReaderTab = "note"
      sourceViewMode = "compare"
      sourcePdfIndex = 0
      sourceOcrIndex = 0
      readerMaterialSelection = Object.fromEntries(CONTROLLED_PREVIEW_KEYS.map((kind) => [kind, null]))
      render()
      const trigger = detailTriggerPaperId
        ? document.querySelector(`#library-results [data-paper-id="${detailTriggerPaperId}"] [data-action="open-detail"]`)
        : null
      detailTriggerPaperId = null
      if (trigger) trigger.focus()
      else ui.count?.focus()
    })
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ui.imageLightbox?.open) {
        return
      } else if (detailOpen && event.key === "Escape") {
        event.preventDefault()
        ui.detailBack?.click()
      } else if (!detailOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        ui.search?.focus()
      }
    })
  }

  async function start() {
    if (!document) return { ok: false, paperCount: 0 }
    if (!eventsBound) {
      bindEvents()
      eventsBound = true
    }
    const loadOperation = indexLoader.run()
    const capabilityOperation = loadLocalLibraryCapabilities(fetchImpl).catch(() => null)
    loadState = indexLoader.getState()
    const [outcome, capabilities] = await Promise.all([loadOperation, capabilityOperation])
    localCapabilities = capabilities
    loadState = indexLoader.getState()
    if (outcome.ok) {
      const index = outcome.value
      papers = index.papers
      facetSchema = index.facet_schema
      warningCount = index.warning_count
      const persistedSelection = store.read().selectedPaperId
      if (!paperById(papers, persistedSelection) && papers.length > 0) store.setSelectedPaper(papers[0].paper_id)
      render()
      return { ok: true, paperCount: papers.length }
    }

    papers = []
    facetSchema = null
    warningCount = null
    render()
    return { ok: false, paperCount: 0 }
  }

  return { start }
}
