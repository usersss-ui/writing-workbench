export const PERSONAL_READING_MARKER = Object.freeze(["unread", "reading", "read"])
export const P02_ROLES = Object.freeze([
  "algorithm_mechanism",
  "theory_evidence",
  "simulation_baseline",
  "related_work",
])

const CONTRIBUTION_WEIGHT = Object.freeze({
  foundational: 5,
  key_method_turn: 4,
  theory_improvement: 3,
  application: 2,
  combination: 1,
  unclassified: 0,
})

const EVIDENCE_WEIGHT = Object.freeze({ none: 0, partial: 1, core_verified: 2 })
const SOURCE_WEIGHT = Object.freeze({ not_checked: 0, located: 1, verified: 2 })
const REPRODUCTION_WEIGHT = Object.freeze({
  none: 0,
  description_only: 1,
  code_unrun: 2,
  ran_no_record: 3,
  results_recorded: 4,
  consistency_verified: 5,
})

const NOTE_STATUS_GROUPS = Object.freeze([
  Object.freeze({ status: "notes_ready", label: "已有笔记" }),
  Object.freeze({ status: "ocr_only", label: "OCR 待精读" }),
  Object.freeze({ status: "pdf_only", label: "仅 PDF 待阅读" }),
  Object.freeze({ status: "metadata_only", label: "材料待补" }),
])

const STATE_TRANSLATIONS = Object.freeze({
  source_status: Object.freeze({
    not_checked: "未检查原文",
    located: "来源已定位",
    verified: "关键来源已核验",
  }),
  evidence_status: Object.freeze({
    none: "无证据卡",
    partial: "部分证据",
    core_verified: "核心证据结构已核验",
  }),
  reproduction_status: Object.freeze({
    none: "尚未建立仿真记录",
    description_only: "已有仿真描述",
    code_unrun: "有代码，运行状态未记录",
    ran_no_record: "已运行，结果未记录",
    results_recorded: "已有结果记录",
    consistency_verified: "结果一致性已核验",
  }),
  contribution_role: Object.freeze({
    foundational: "奠基工作",
    key_method_turn: "关键方法转折",
    theory_improvement: "理论改进",
    application: "应用研究",
    combination: "组合型工作",
    unclassified: "尚未分类",
  }),
  personal_reading_marker: Object.freeze({ unread: "未读", reading: "在读", read: "读过" }),
  p02_role: Object.freeze({
    algorithm_mechanism: "算法机制来源",
    theory_evidence: "理论分析来源",
    simulation_baseline: "仿真比较基线",
    related_work: "相关工作与写作引用",
  }),
})

const SEARCH_FIELDS = Object.freeze([
  Object.freeze({ key: "title_zh", label: "中文标题", list: false, dedupeKey: "标题" }),
  Object.freeze({ key: "title_original", label: "原始标题", list: false, dedupeKey: "标题" }),
  Object.freeze({ key: "title_en", label: "英文标题", list: false, dedupeKey: "标题" }),
  Object.freeze({ key: "authors", label: "作者", list: true }),
  Object.freeze({ key: "paper_id", label: "论文 ID", list: false }),
])

const DIRECTION_QUERY_FACETS = Object.freeze({
  "有向网络": ["network.direction", "有向"],
  "无向网络": ["network.direction", "无向"],
  "时变拓扑": ["network.time", "时变"],
  "静态拓扑": ["network.time", "固定"],
  "非平衡网络": ["network.balance", "不平衡"],
  "平衡网络": ["network.balance", "平衡"],
})

const TITLE_COLLATOR = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
})

function normalizeText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN")
    : ""
}

function displayText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ")
    : ""
}

function fieldValues(paper, field) {
  const value = paper?.[field.key]
  if (field.list) return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
  return typeof value === "string" ? [value] : []
}

function schemaGroups(facetSchema) {
  return Array.isArray(facetSchema?.groups)
    ? facetSchema.groups.filter((group) => typeof group?.path === "string" && typeof group?.label === "string")
    : []
}

function capCodePoints(value, maximum = 120) {
  return Array.from(value).slice(0, maximum).join("")
}

export function displayPaperTitle(paper) {
  return displayText(paper?.title_zh)
    || displayText(paper?.title_original)
    || displayText(paper?.title_en)
    || "暂无书目信息"
}

export function groupRowsByNoteStatus(rows) {
  const source = Array.isArray(rows) ? rows : []
  return NOTE_STATUS_GROUPS
    .map(({ status, label }) => ({
      status,
      label,
      rows: source.filter((row) => row?.paper?.note_status === status),
    }))
    .filter((group) => group.rows.length > 0)
}

function safeSourceRelativePath(value) {
  const candidate = typeof value === "string" ? value.trim() : ""
  if (!candidate || candidate.includes("\\")) return null
  if (/^(?:\/|[A-Za-z]:\/|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(candidate)) return null
  if (candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null
  return candidate
}

export function describePaperIdentity(paper) {
  const bibliographyMissing = !displayText(paper?.title_zh)
    && !displayText(paper?.title_original)
    && !displayText(paper?.title_en)
  const identityPending = paper?.identity_source === "path_hash"
  const relativePath = safeSourceRelativePath(paper?.relative_path)
  return {
    displayTitle: displayPaperTitle(paper),
    bibliographyMissing,
    identityPending,
    showSourceDirectory: Boolean(relativePath) && (identityPending || bibliographyMissing),
    relativePath,
  }
}

export function summarizeMetadataCoverage(papers) {
  const records = Array.isArray(papers) ? papers : []
  const totalCount = records.length
  const chineseTitleCount = records.filter((paper) => Boolean(displayText(paper?.title_zh))).length
  const identityPendingCount = records.filter((paper) => paper?.identity_source === "path_hash").length
  return {
    totalCount,
    chineseTitleCount,
    identityPendingCount,
    text: `中文标题 ${chineseTitleCount}/${totalCount}；待整理身份 ${identityPendingCount}/${totalCount}`,
  }
}

function titleAndId(left, right) {
  return TITLE_COLLATOR.compare(displayPaperTitle(left), displayPaperTitle(right))
    || TITLE_COLLATOR.compare(displayText(left?.paper_id), displayText(right?.paper_id))
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function compareNumberDescendingNullLast(left, right) {
  const leftNumber = finiteNumber(left)
  const rightNumber = finiteNumber(right)
  if (leftNumber === null && rightNumber === null) return 0
  if (leftNumber === null) return 1
  if (rightNumber === null) return -1
  return rightNumber - leftNumber
}

function selectedValues(filters, key) {
  return Array.isArray(filters?.[key]) ? filters[key] : []
}

function matchesAxis(selected, available) {
  return selected.length === 0 || selected.some((value) => available.includes(value))
}

export function facetValues(paper, path) {
  if (typeof path !== "string" || !path) return []
  const keys = path.split(".")
  if (keys.some((key) => !key)) return []
  const value = keys.reduce((current, key) => current?.[key], paper?.facets)
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
}

const FACET_EMPTY_LABELS = Object.freeze({
  unrecorded: "未记录",
  not_applicable: "不适用",
  pending_verification: "待核验",
})

export function facetStateAt(paper, path) {
  const state = paper?.facet_states?.[path]
  return Object.hasOwn(FACET_EMPTY_LABELS, state) ? state : "unrecorded"
}

export function facetEmptyLabel(paper, path) {
  if (facetValues(paper, path).length > 0) return null
  const state = facetStateAt(paper, path)
  return { state, label: FACET_EMPTY_LABELS[state] }
}

export function matchFacetFilters(paper, facetFilters = {}) {
  if (!facetFilters || typeof facetFilters !== "object" || Array.isArray(facetFilters)) return true
  return Object.entries(facetFilters).every(([path, selected]) => {
    const choices = Array.isArray(selected) ? selected : []
    return choices.length === 0 || choices.some((choice) => facetValues(paper, path).includes(choice))
  })
}

function shelfRolesFor(paper, shelf) {
  const roles = shelf?.[paper?.paper_id]
  return Array.isArray(roles) ? roles.filter((role) => P02_ROLES.includes(role)) : []
}

function personalMarkerFor(paper, personalReading) {
  const marker = personalReading?.[paper?.paper_id]
  return PERSONAL_READING_MARKER.includes(marker) ? marker : "unread"
}

function defaultComparator(shelf) {
  return (left, right) => {
    const membershipDifference = Number(shelfRolesFor(right, shelf).length > 0) - Number(shelfRolesFor(left, shelf).length > 0)
    return membershipDifference
      || compareNumberDescendingNullLast(left?.p02_relevance, right?.p02_relevance)
      || (CONTRIBUTION_WEIGHT[right?.contribution_role] ?? 0) - (CONTRIBUTION_WEIGHT[left?.contribution_role] ?? 0)
      || compareNumberDescendingNullLast(left?.writing_material_count, right?.writing_material_count)
      || compareNumberDescendingNullLast(left?.year, right?.year)
      || titleAndId(left, right)
  }
}

function userTagsForPaper(userTagState, paperId) {
  const labels = userTagState?.papers?.[paperId]
  return Array.isArray(labels) ? labels.filter((label) => typeof label === "string") : []
}

export function searchableText(paper, facetSchema, userTags = []) {
  const values = [
    ...SEARCH_FIELDS.flatMap((field) => fieldValues(paper, field)),
    ...schemaGroups(facetSchema).flatMap((group) => facetValues(paper, group.path)),
    ...(Array.isArray(paper?.source_terms) ? paper.source_terms.filter((value) => typeof value === "string") : []),
    ...(Array.isArray(userTags) ? userTags.filter((value) => typeof value === "string") : []),
  ]
  return values
    .map(normalizeText)
    .filter(Boolean)
    .join(" ")
}

export function matchPaperQuery(paper, query, facetSchema, userTags = []) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return { matched: true, hits: [] }
  const terms = [...new Set(normalizedQuery.split(" "))]
  const matchedTerms = new Set()

  const hits = []
  const seen = new Set()
  const fields = [
    ...SEARCH_FIELDS.map((field) => ({
      label: field.label,
      dedupeKey: field.dedupeKey ?? field.label,
      values: fieldValues(paper, field),
    })),
    ...schemaGroups(facetSchema).map((group) => ({ label: group.label, path: group.path, values: facetValues(paper, group.path) })),
    { label: "原文术语", values: Array.isArray(paper?.source_terms) ? paper.source_terms.filter((value) => typeof value === "string") : [] },
    { label: "我的标签", values: Array.isArray(userTags) ? userTags.filter((value) => typeof value === "string") : [] },
  ]
  for (const field of fields) {
    for (const rawValue of field.values) {
      const value = normalizeText(rawValue)
      const fieldTerms = terms.filter((term) => {
        if (value.includes(term)) return true
        const alias = DIRECTION_QUERY_FACETS[term]
        return alias && field.path === alias[0] && value === alias[1]
      })
      if (fieldTerms.length === 0) continue
      fieldTerms.forEach((term) => matchedTerms.add(term))
      const snippet = capCodePoints(displayText(rawValue))
      if (!snippet) continue
      const dedupeKey = `${field.dedupeKey ?? field.label}\u0000${snippet}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      hits.push({ field: field.label, snippet })
    }
  }
  return matchedTerms.size === terms.length
    ? { matched: true, hits }
    : { matched: false, hits: [] }
}

export function filterLibrary(papers, filters = {}, workspaceState = {}, userTagState = {}) {
  const source = Array.isArray(papers) ? papers : []
  const shelf = workspaceState?.shelf ?? {}
  const personalReading = workspaceState?.personalReading ?? {}
  const facets = filters?.facets
  const recordTypes = selectedValues(filters, "recordTypes")
  const personalReadingMarkers = selectedValues(filters, "personalReadingMarkers")
  const sourceStatuses = selectedValues(filters, "sourceStatuses")
  const evidenceStatuses = selectedValues(filters, "evidenceStatuses")
  const reproductionStatuses = selectedValues(filters, "reproductionStatuses")
  const shelfRoles = selectedValues(filters, "shelfRoles")

  return source.filter((paper) => {
    const userTags = userTagsForPaper(userTagState, paper?.paper_id)
    if (!matchPaperQuery(paper, filters?.query ?? "", filters?.facetSchema, userTags).matched) return false
    if (!matchFacetFilters(paper, facets)) return false
    if (!matchesAxis(recordTypes, [paper?.record_type])) return false
    if (!matchesAxis(personalReadingMarkers, [personalMarkerFor(paper, personalReading)])) return false
    if (!matchesAxis(sourceStatuses, [paper?.source_status])) return false
    if (!matchesAxis(evidenceStatuses, [paper?.evidence_status])) return false
    if (!matchesAxis(reproductionStatuses, [paper?.reproduction_status])) return false
    return matchesAxis(shelfRoles, shelfRolesFor(paper, shelf))
  })
}

export function sortLibrary(papers, mode = "default", shelf = {}) {
  const result = Array.isArray(papers) ? [...papers] : []
  let comparator

  if (mode === "title") comparator = titleAndId
  else if (mode === "year") {
    comparator = (left, right) => compareNumberDescendingNullLast(left?.year, right?.year) || titleAndId(left, right)
  } else if (mode === "contribution") {
    comparator = (left, right) =>
      (CONTRIBUTION_WEIGHT[right?.contribution_role] ?? 0) - (CONTRIBUTION_WEIGHT[left?.contribution_role] ?? 0)
      || compareNumberDescendingNullLast(left?.year, right?.year)
      || titleAndId(left, right)
  } else if (mode === "evidence") {
    comparator = (left, right) =>
      (EVIDENCE_WEIGHT[right?.evidence_status] ?? 0) - (EVIDENCE_WEIGHT[left?.evidence_status] ?? 0)
      || (SOURCE_WEIGHT[right?.source_status] ?? 0) - (SOURCE_WEIGHT[left?.source_status] ?? 0)
      || (REPRODUCTION_WEIGHT[right?.reproduction_status] ?? 0) - (REPRODUCTION_WEIGHT[left?.reproduction_status] ?? 0)
      || compareNumberDescendingNullLast(left?.writing_material_count, right?.writing_material_count)
      || titleAndId(left, right)
  } else comparator = defaultComparator(shelf)

  return result.sort(comparator)
}

export function summarizeShelfRole(role, papers, shelf = {}) {
  const members = (Array.isArray(papers) ? papers : []).filter((paper) => shelfRolesFor(paper, shelf).includes(role))
  return {
    count: members.length,
    titles: members.slice(0, 3).map(displayPaperTitle),
    overflow: Math.max(0, members.length - 3),
  }
}

function artifactCount(paper, key) {
  const artifacts = paper?.artifacts?.[key]
  return Array.isArray(artifacts) ? artifacts.length : 0
}

function artifactAvailable(paper, key) {
  return artifactCount(paper, key) > 0 || paper?.artifact_availability?.[key] === true
}

function availablePhrase(paper, key, present, absent) {
  if (!artifactAvailable(paper, key)) return absent
  const count = artifactCount(paper, key)
  return count > 0 ? `${present} ${count} 份` : present
}

export function summarizeAvailability(paper) {
  const writingCount = Number.isInteger(paper?.writing_material_count) && paper.writing_material_count >= 0
    ? paper.writing_material_count
    : 0
  return [
    availablePhrase(paper, "pdf", "已有 PDF", "未记录 PDF"),
    availablePhrase(paper, "note", "已有阅读笔记", "尚无阅读笔记"),
    translateState("source_status", paper?.source_status),
    translateState("evidence_status", paper?.evidence_status),
    translateState("reproduction_status", paper?.reproduction_status),
    `写作材料 ${writingCount} 条`,
  ].join("；")
}

export function translateState(field, value) {
  return STATE_TRANSLATIONS[field]?.[value] ?? "状态待确认"
}

export function buildLibraryViewState({
  papers = [], filters = {}, facetSchema, sortMode = "default", workspaceState = {}, userTagState = {},
} = {}) {
  const allPapers = Array.isArray(papers) ? papers : []
  const shelf = workspaceState?.shelf ?? {}
  const personalReading = workspaceState?.personalReading ?? {}
  const queryFacetSchema = facetSchema ?? filters?.facetSchema
  const filtersWithSchema = facetSchema === undefined || filters?.facetSchema === facetSchema
    ? filters
    : { ...filters, facetSchema }
  const filtered = filterLibrary(allPapers, filtersWithSchema, workspaceState, userTagState)
  const visible = sortLibrary(filtered, sortMode, shelf)
  const rows = visible.map((paper) => ({
    paper,
    hits: matchPaperQuery(
      paper,
      filters?.query ?? "",
      queryFacetSchema,
      userTagsForPaper(userTagState, paper.paper_id),
    ).hits,
    personalReadingMarker: personalMarkerFor(paper, personalReading),
    shelfRoles: [...shelfRolesFor(paper, shelf)],
    availabilitySummary: summarizeAvailability(paper),
  }))
  const stableAllPapers = sortLibrary(allPapers, "default", shelf)
  const shelfSummaries = P02_ROLES.map((role) => ({
    role,
    ...summarizeShelfRole(role, stableAllPapers, shelf),
  }))
  const selectedPaperId = workspaceState?.selectedPaperId
  const selectedExists = allPapers.some((paper) => paper?.paper_id === selectedPaperId)
  const selectedPaper = selectedExists
    ? visible.find((paper) => paper?.paper_id === selectedPaperId) ?? visible[0] ?? null
    : visible[0] ?? null

  return {
    totalCount: allPapers.length,
    resultCount: rows.length,
    rows,
    shelfSummaries,
    selectedPaper,
    empty: rows.length === 0,
  }
}
