import test from "node:test"
import assert from "node:assert/strict"

import {
  PERSONAL_READING_MARKER,
  P02_ROLES,
  buildLibraryViewState,
  displayPaperTitle,
  facetEmptyLabel,
  facetStateAt,
  facetValues,
  filterLibrary,
  groupRowsByNoteStatus,
  matchFacetFilters,
  matchPaperQuery,
  searchableText,
  sortLibrary,
  summarizeAvailability,
  summarizeShelfRole,
  translateState,
} from "./paper-library-model.mjs"

test("empty facet labels default to 未记录 and honor explicit states", () => {
  const facets = structuredClone(papers[0].facets)
  facets.results = []
  facets.applications = []
  facets.privacy_robustness = []
  const paper = {
    facets,
    facet_states: {
      applications: "not_applicable",
      results: "pending_verification",
    },
  }
  assert.deepEqual(facetEmptyLabel(paper, "privacy_robustness"), { state: "unrecorded", label: "未记录" })
  assert.deepEqual(facetEmptyLabel(paper, "applications"), { state: "not_applicable", label: "不适用" })
  assert.deepEqual(facetEmptyLabel(paper, "results"), { state: "pending_verification", label: "待核验" })
  assert.equal(facetEmptyLabel(paper, "research.domain"), null)
  assert.equal(facetStateAt({ facets, facet_states: { results: "waiting" } }, "results"), "unrecorded")
})

const facetSchema = Object.freeze({
  version: 1,
  groups: Object.freeze([
    Object.freeze({ path: "research.domain", label: "研究领域", values: Object.freeze(["分布式优化", "联邦学习"]) }),
    Object.freeze({ path: "research.mode", label: "任务范式", values: Object.freeze(["在线优化"]) }),
    Object.freeze({ path: "constraints.scope", label: "作用范围", values: Object.freeze(["耦合约束"]) }),
    Object.freeze({ path: "constraints.form", label: "数学形式", values: Object.freeze(["等式约束", "不等式约束"]) }),
    Object.freeze({ path: "oracle.information", label: "信息来源", values: Object.freeze(["函数值反馈"]) }),
    Object.freeze({ path: "oracle.estimation", label: "估计与跟踪", values: Object.freeze(["单点估计"]) }),
    Object.freeze({ path: "methods.framework", label: "主框架", values: Object.freeze(["对偶分解", "ADMM"]) }),
    Object.freeze({ path: "network.time", label: "网络时变性", values: Object.freeze(["时变"]) }),
    Object.freeze({ path: "privacy_robustness", label: "隐私与鲁棒", values: Object.freeze(["差分隐私"]) }),
  ]),
})

const papers = [
  {
    paper_id: "Paper-A",
    title_zh: "时变有向网络",
    title_en: "Directed Networks",
    authors: ["张三"],
    year: 2024,
    topic_l1: "分布式优化",
    topic_l2: "有向网络优化",
    research_scopes: ["受约束优化"],
    method_tags: ["梯度跟踪"],
    network_tags: ["有向网络"],
    problem_tags: ["耦合约束"],
    property_tags: ["差分隐私"],
    theory_tags: ["线性收敛"],
    facets: {
      research: { domain: ["分布式优化"], mode: [] },
      constraints: { scope: ["耦合约束"], form: ["不等式约束"] },
      oracle: { information: [], estimation: [] },
      methods: { framework: ["对偶分解"] },
      network: { time: ["时变"] },
      privacy_robustness: ["差分隐私"],
    },
    source_terms: ["Dual Decomposition"],
    source_status: "located",
    evidence_status: "partial",
    reproduction_status: "description_only",
    contribution_role: "key_method_turn",
    p02_relevance: 3,
    writing_material_count: 1,
    artifacts: { pdf: [{}], note: [{}], script: [], result: [] },
    artifact_availability: { pdf: true, note: true, script: false, result: false },
  },
  {
    paper_id: "Paper-B",
    title_zh: "静态网络基线",
    title_en: "Static baseline",
    authors: ["Li"],
    year: 2018,
    topic_l1: "分布式优化",
    topic_l2: "静态拓扑",
    research_scopes: ["无约束优化"],
    method_tags: ["推送求和"],
    network_tags: ["有向网络"],
    problem_tags: [],
    property_tags: ["通信高效"],
    theory_tags: ["次线性收敛"],
    facets: {
      research: { domain: ["分布式优化"], mode: [] },
      constraints: { scope: ["耦合约束"], form: ["等式约束"] },
      oracle: { information: [], estimation: [] },
      methods: { framework: ["ADMM"] },
      network: { time: [] },
      privacy_robustness: [],
    },
    source_terms: ["Tracking-ADMM"],
    source_status: "verified",
    evidence_status: "core_verified",
    reproduction_status: "results_recorded",
    contribution_role: "foundational",
    p02_relevance: 2,
    writing_material_count: 2,
    artifacts: { pdf: [{}], note: [], script: [{}], result: [{}, {}] },
    artifact_availability: { pdf: true, note: false, script: true, result: true },
  },
  {
    paper_id: "Paper-C",
    title_zh: "隐私零阶优化",
    title_en: "Private zeroth order",
    authors: ["Wang"],
    year: 2025,
    topic_l1: "隐私优化",
    topic_l2: "零阶方法",
    research_scopes: ["在线优化"],
    method_tags: ["零阶"],
    network_tags: ["无向网络"],
    problem_tags: [],
    property_tags: ["隐私保护"],
    theory_tags: [],
    facets: {
      research: { domain: [], mode: ["在线优化"] },
      constraints: { scope: [], form: [] },
      oracle: { information: ["函数值反馈"], estimation: ["单点估计"] },
      methods: { framework: [] },
      network: { time: [] },
      privacy_robustness: ["差分隐私"],
    },
    source_terms: ["One-Point Residual Feedback"],
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    contribution_role: "unclassified",
    p02_relevance: null,
    writing_material_count: 0,
    artifacts: { pdf: [], note: [], script: [], result: [] },
    artifact_availability: { pdf: false, note: false, script: false, result: false },
  },
]

const userTagState = Object.freeze({
  version: 1,
  papers: Object.freeze({
    "Paper-A": Object.freeze(["必读", "可作基线"]),
    "Paper-C": Object.freeze(["隐私方向候选"]),
  }),
})

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

test("uses the language-neutral original title between Chinese and English", () => {
  assert.equal(displayPaperTitle({ title_zh: " 中文题名 ", title_original: "Original title", title_en: "English title" }), "中文题名")
  assert.equal(displayPaperTitle({ title_zh: "", title_original: " Original title ", title_en: "English title" }), "Original title")
  assert.equal(displayPaperTitle({ title_zh: "", title_original: "", title_en: " English title " }), "English title")
  assert.equal(displayPaperTitle({ title_zh: "", title_original: "", title_en: "" }), "暂无书目信息")
})

test("groups papers by note status in writing-first order and omits empty groups", () => {
  const notesReady = { paper: { paper_id: "Paper-B", note_status: "notes_ready" } }
  const pdfOnly = { paper: { paper_id: "Paper-A", note_status: "pdf_only" } }
  const rows = deepFreeze([pdfOnly, notesReady])

  const groups = groupRowsByNoteStatus(rows)

  assert.deepEqual(groups.map((group) => [group.status, group.label, group.rows.length]), [
    ["notes_ready", "已有笔记", 1],
    ["pdf_only", "仅 PDF 待阅读", 1],
  ])
  assert.equal(groups[0].rows[0], notesReady)
  assert.equal(groups[1].rows[0], pdfOnly)
})

test("groups every supported note status under its exact Chinese label", () => {
  const rows = [
    { paper: { paper_id: "Paper-M", note_status: "metadata_only" } },
    { paper: { paper_id: "Paper-P", note_status: "pdf_only" } },
    { paper: { paper_id: "Paper-O", note_status: "ocr_only" } },
    { paper: { paper_id: "Paper-N", note_status: "notes_ready" } },
    { paper: { paper_id: "Paper-X", note_status: "conflict" } },
  ]

  assert.deepEqual(groupRowsByNoteStatus(rows).map(({ status, label }) => [status, label]), [
    ["notes_ready", "已有笔记"],
    ["ocr_only", "OCR 待精读"],
    ["pdf_only", "仅 PDF 待阅读"],
    ["metadata_only", "材料待补"],
  ])
})

test("searches bibliographic fields, schema-driven facets, and source terms", () => {
  const cases = [
    ["Directed", ["Paper-A"]],
    ["张三", ["Paper-A"]],
    ["paper-b", ["Paper-B"]],
    ["耦合约束", ["Paper-A", "Paper-B"]],
    ["差分隐私", ["Paper-A", "Paper-C"]],
    ["Tracking-ADMM", ["Paper-B"]],
  ]

  for (const [query, expected] of cases) {
    assert.deepEqual(filterLibrary(papers, { query, facetSchema }).map((paper) => paper.paper_id), expected)
  }
})

test("searches personal tags through a separate state and reports a user-tag hit", () => {
  assert.deepEqual(matchPaperQuery(papers[0], "可作基线", facetSchema, userTagState.papers["Paper-A"]), {
    matched: true,
    hits: [{ field: "我的标签", snippet: "可作基线" }],
  })
  assert.deepEqual(
    filterLibrary(papers, { query: "隐私方向候选", facetSchema }, {}, userTagState).map((paper) => paper.paper_id),
    ["Paper-C"],
  )
  assert.match(searchableText(papers[0], facetSchema, userTagState.papers["Paper-A"]), /可作基线/u)
})

test("personal tags never become formal facet values or facet filters", () => {
  const tagged = { ...papers[0], user_tags: ["伪造正式分面"] }
  assert.deepEqual(facetValues(tagged, "user_tags"), [])
  assert.deepEqual(
    filterLibrary([tagged], { facets: { "research.domain": ["可作基线"] } }, {}, userTagState),
    [],
  )
  assert.equal(matchPaperQuery(tagged, "伪造正式分面", facetSchema).matched, false)
})

test("buildLibraryViewState carries personal-tag hits without mutating either state", () => {
  const frozenTags = deepFreeze(structuredClone(userTagState))
  const frozenWorkspace = deepFreeze({ shelf: {}, personalReading: {}, selectedPaperId: "Paper-A" })
  const view = buildLibraryViewState({
    papers,
    filters: { query: "必读" },
    facetSchema,
    workspaceState: frozenWorkspace,
    userTagState: frozenTags,
  })

  assert.deepEqual(view.rows.map((row) => row.paper.paper_id), ["Paper-A"])
  assert.deepEqual(view.rows[0].hits, [{ field: "我的标签", snippet: "必读" }])
  assert.deepEqual(frozenTags, userTagState)
})

test("searches a real index record's original title when translated titles are absent", () => {
  const realisticRecord = {
    ...papers[0],
    title_zh: "",
    title_en: "",
    title_original: "Distributed Optimization Over Directed Networks",
  }

  assert.deepEqual(matchPaperQuery(realisticRecord, "directed networks", facetSchema), {
    matched: true,
    hits: [{ field: "原始标题", snippet: "Distributed Optimization Over Directed Networks" }],
  })
})

test("does not duplicate an identical original title already matched as another title", () => {
  const paper = {
    ...papers[0],
    title_zh: "共享标题",
    title_en: "",
    title_original: "共享标题",
  }

  assert.deepEqual(matchPaperQuery(paper, "共享", facetSchema), {
    matched: true,
    hits: [{ field: "中文标题", snippet: "共享标题" }],
  })
})

test("normalizes Unicode case and repeated spaces in searchable metadata", () => {
  const paper = { ...papers[0], title_en: "Directed   Optimization" }
  assert.equal(matchPaperQuery(paper, "  directed optimization ", facetSchema).matched, true)
  assert.match(searchableText(paper), /directed optimization/u)
  assert.match(searchableText(paper, facetSchema), /directed optimization/u)
})

test("matches every direction keyword across metadata fields and rejects partial coverage", () => {
  const paper = { ...papers[0], title_zh: "有向网络算法", title_en: "", source_terms: ["时变拓扑"] }
  const result = matchPaperQuery(paper, "分布式优化 有向网络 时变拓扑", facetSchema)
  assert.equal(result.matched, true)
  assert.ok(result.hits.some((hit) => hit.field === "中文标题" && hit.snippet === "有向网络算法"))
  assert.ok(result.hits.some((hit) => hit.field === "研究领域" && hit.snippet === "分布式优化"))
  assert.ok(result.hits.some((hit) => hit.field === "原文术语" && hit.snippet === "时变拓扑"))
  assert.deepEqual(matchPaperQuery(paper, "分布式优化 未知方向", facetSchema), { matched: false, hits: [] })
})

test("direction labels match canonical network facets without matching the opposite balance", () => {
  const schema = { groups: [
    { path: "network.direction", label: "网络方向", values: ["有向", "无向"] },
    { path: "network.time", label: "网络时变性", values: ["时变", "固定"] },
    { path: "network.balance", label: "网络平衡性", values: ["平衡", "不平衡"] },
  ] }
  const paper = { paper_id: "Graph-01", title_zh: "网络算法", facets: {
    network: { direction: ["有向"], time: ["时变"], balance: ["不平衡"] },
  } }
  assert.equal(matchPaperQuery(paper, "有向网络 时变拓扑 非平衡网络", schema).matched, true)
  assert.equal(matchPaperQuery(paper, "有向网络 平衡网络", schema).matched, false)
  assert.equal(matchPaperQuery(paper, "无向网络", schema).matched, false)
  assert.equal(matchPaperQuery(paper, "静态拓扑", schema).matched, false)
})

test("facet filters use OR within one path and AND across paths", () => {
  const result = filterLibrary(papers, {
    facets: {
      "constraints.scope": ["耦合约束"],
      "constraints.form": ["等式约束", "不等式约束"],
      "methods.framework": ["对偶分解"],
    },
  })

  assert.deepEqual(result.map((paper) => paper.paper_id), ["Paper-A"])
})

test("reports schema Chinese facet labels and source-term hits without conflating them", () => {
  const paper = {
    ...papers[0],
    source_terms: ["原文算法术语"],
  }

  assert.deepEqual(matchPaperQuery(paper, "对偶", facetSchema), {
    matched: true,
    hits: [{ field: "主框架", snippet: "对偶分解" }],
  })
  assert.deepEqual(matchPaperQuery(paper, "原文算法", facetSchema), {
    matched: true,
    hits: [{ field: "原文术语", snippet: "原文算法术语" }],
  })
})

test("source terms remain searchable without becoming facet values", () => {
  assert.equal(matchPaperQuery(papers[1], "Tracking-ADMM", facetSchema).matched, true)
  assert.deepEqual(facetValues(papers[1], "methods.framework"), ["ADMM"])
  assert.deepEqual(facetValues(papers[1], "source_terms"), [])
})

test("facet readers and filters ignore malformed paths and selections", () => {
  const frozenPaper = deepFreeze(structuredClone(papers[0]))
  const filters = deepFreeze({
    "constraints.scope": ["耦合约束"],
    "constraints..scope": ["耦合约束"],
    "methods.framework": "对偶分解",
    "": ["ignored"],
  })

  assert.deepEqual(facetValues(frozenPaper, null), [])
  assert.deepEqual(facetValues(frozenPaper, "constraints..scope"), [])
  assert.equal(matchFacetFilters(frozenPaper, filters), false)
  assert.equal(matchFacetFilters(frozenPaper, null), true)
  assert.equal(matchFacetFilters(frozenPaper, { "methods.framework": ["ADMM"] }), false)
})

test("legacy academic filters and fields do not affect faceted filtering or search", () => {
  const legacyOnly = {
    ...papers[0],
    facets: { research: { domain: [], mode: [] } },
    source_terms: [],
    topic_l1: "旧 topics 标签",
    topic_l2: "旧复合标签",
    research_scopes: ["旧研究范围"],
    method_tags: ["旧方法"],
    network_tags: ["旧网络"],
    problem_tags: ["旧问题"],
    property_tags: ["旧性质"],
    theory_tags: ["旧理论"],
  }
  const legacyFilters = [
    ["topics", "旧 topics 标签"],
    ["methodTags", "旧方法"],
    ["networkTags", "旧网络"],
    ["problemTags", "旧问题"],
    ["propertyTags", "旧性质"],
    ["theoryTags", "旧理论"],
  ]
  const legacyQueries = ["旧 topics 标签", "旧复合标签", "旧研究范围", "旧方法", "旧网络", "旧问题", "旧性质", "旧理论"]

  assert.deepEqual(filterLibrary([legacyOnly], { facets: { "methods.framework": ["旧方法"] } }), [])
  for (const [key, value] of legacyFilters) {
    assert.deepEqual(filterLibrary([legacyOnly], { [key]: [value] }), [legacyOnly])
  }
  for (const query of legacyQueries) {
    assert.deepEqual(matchPaperQuery(legacyOnly, query, facetSchema), { matched: false, hits: [] })
  }
})

test("never searches notes, OCR, artifact paths, venue, DOI, or arbitrary fields", () => {
  const privateValues = {
    note_text: "私有笔记词",
    ocr_text: "OCR全文词",
    venue: "Private Venue Keyword",
    doi_or_url: "https://doi.org/private-keyword",
    preferred_note: "notes/private-path-keyword.md",
    note_preview_url: "private-preview-keyword.html",
    relative_path: "private-relative-keyword",
    artifacts: {
      pdf: [{ relative_path: "private-artifact-keyword.pdf" }],
      note: [{ relative_path: "private-note-path-keyword.md" }],
    },
  }
  const paper = { ...papers[0], ...privateValues }

  for (const query of [
    "私有笔记词",
    "OCR全文词",
    "Private Venue Keyword",
    "private-keyword",
    "private-path-keyword",
    "private-preview-keyword",
    "private-relative-keyword",
    "private-artifact-keyword",
    "private-note-path-keyword",
  ]) {
    assert.deepEqual(matchPaperQuery(paper, query, facetSchema), { matched: false, hits: [] })
    assert.deepEqual(filterLibrary([paper], { query }), [])
    assert.doesNotMatch(searchableText(paper, facetSchema), new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"))
  }
})

test("caps hit snippets at 120 Unicode code points without splitting surrogate pairs", () => {
  const longTitle = `${"研".repeat(119)}😀后续文本`
  const result = matchPaperQuery({ ...papers[0], title_zh: longTitle }, "研", facetSchema)
  const snippet = result.hits[0].snippet

  assert.equal(Array.from(snippet).length, 120)
  assert.equal(snippet.endsWith("😀"), true)
  assert.equal(snippet.includes("后续"), false)
})

test("combines facet filters with material-state filters", () => {
  const result = filterLibrary(papers, {
    facets: { "constraints.scope": ["耦合约束"] },
    evidenceStatuses: ["partial", "core_verified"],
  })

  assert.deepEqual(result.map((paper) => paper.paper_id), ["Paper-A", "Paper-B"])
})

test("preserves source, evidence, reproduction, reading, and shelf filters", () => {
  assert.deepEqual(filterLibrary(papers, { sourceStatuses: ["verified"] }).map((paper) => paper.paper_id), ["Paper-B"])
  assert.deepEqual(filterLibrary(papers, { evidenceStatuses: ["none"] }).map((paper) => paper.paper_id), ["Paper-C"])
  assert.deepEqual(filterLibrary(papers, { reproductionStatuses: ["description_only"] }).map((paper) => paper.paper_id), ["Paper-A"])
})

test("filters independent record types with OR, preserves exact unknown values, and never searches them", () => {
  const records = deepFreeze([
    { ...papers[0], record_type: "外部论文" },
    { ...papers[1], record_type: "专题综述" },
    { ...papers[2], record_type: "旧未知类型" },
  ])
  const filters = deepFreeze({ recordTypes: ["专题综述", "旧未知类型"] })
  const beforeRecords = structuredClone(records)
  const beforeFilters = structuredClone(filters)

  assert.deepEqual(filterLibrary(records, filters).map((paper) => paper.paper_id), ["Paper-B", "Paper-C"])
  assert.deepEqual(filterLibrary(records, { recordTypes: [] }).map((paper) => paper.paper_id), ["Paper-A", "Paper-B", "Paper-C"])
  assert.deepEqual(filterLibrary(records, {
    recordTypes: ["专题综述"],
    facets: { "constraints.scope": ["耦合约束"] },
    evidenceStatuses: ["core_verified"],
  }).map((paper) => paper.paper_id), ["Paper-B"])
  assert.deepEqual(filterLibrary(records, { recordTypes: ["旧未知类型"] }).map((paper) => paper.paper_id), ["Paper-C"])
  assert.deepEqual(filterLibrary(records, { recordTypes: ["未知类型"] }), [])
  assert.deepEqual(matchPaperQuery(records[2], "旧未知类型", facetSchema), { matched: false, hits: [] })
  assert.deepEqual(records, beforeRecords)
  assert.deepEqual(filters, beforeFilters)
})

test("treats a missing personal marker as unread only in the view and filters shelf roles", () => {
  const workspaceState = {
    personalReading: { "Paper-A": "reading", "Paper-B": "read" },
    shelf: { "Paper-A": ["algorithm_mechanism"], "Paper-B": ["theory_evidence", "related_work"] },
  }

  assert.deepEqual(
    filterLibrary(papers, { personalReadingMarkers: ["unread"] }, workspaceState).map((paper) => paper.paper_id),
    ["Paper-C"],
  )
  assert.deepEqual(
    filterLibrary(papers, { shelfRoles: ["algorithm_mechanism", "related_work"] }, workspaceState).map((paper) => paper.paper_id),
    ["Paper-A", "Paper-B"],
  )
  assert.deepEqual(workspaceState.personalReading, { "Paper-A": "reading", "Paper-B": "read" })
})

test("default sorting treats any shelf membership as one binary priority", () => {
  const ranked = [
    { ...papers[0], paper_id: "Paper-A", title_zh: "甲", p02_relevance: 1 },
    { ...papers[1], paper_id: "Paper-B", title_zh: "乙", p02_relevance: 3 },
    { ...papers[2], paper_id: "Paper-C", title_zh: "丙", p02_relevance: 3 },
  ]
  const shelf = {
    "Paper-A": ["algorithm_mechanism", "theory_evidence", "related_work"],
    "Paper-B": ["simulation_baseline"],
  }

  assert.deepEqual(sortLibrary(ranked, "default", shelf).map((paper) => paper.paper_id), ["Paper-B", "Paper-A", "Paper-C"])
})

test("default sorting keeps zero numeric values valid and null values last", () => {
  const ranked = [
    { ...papers[0], paper_id: "Paper-Null", title_zh: "甲", p02_relevance: null, writing_material_count: 9, year: 2026 },
    { ...papers[0], paper_id: "Paper-Zero", title_zh: "乙", p02_relevance: 0, writing_material_count: 0, year: null },
    { ...papers[0], paper_id: "Paper-One", title_zh: "丙", p02_relevance: 0, writing_material_count: 1, year: 2020 },
  ]

  assert.deepEqual(sortLibrary(ranked, "default", {}).map((paper) => paper.paper_id), ["Paper-One", "Paper-Zero", "Paper-Null"])
})

test("default sorting follows contribution, writing count, year, title, and ID tie breakers", () => {
  const ranked = [
    { ...papers[0], paper_id: "Paper-Z", title_zh: "同名", p02_relevance: 2, contribution_role: "combination", writing_material_count: 9, year: 2026 },
    { ...papers[0], paper_id: "Paper-D", title_zh: "同名", p02_relevance: 2, contribution_role: "foundational", writing_material_count: 0, year: 2010 },
    { ...papers[0], paper_id: "Paper-C", title_zh: "同名", p02_relevance: 2, contribution_role: "foundational", writing_material_count: 1, year: 2020 },
    { ...papers[0], paper_id: "Paper-B", title_zh: "同名", p02_relevance: 2, contribution_role: "foundational", writing_material_count: 1, year: 2021 },
    { ...papers[0], paper_id: "Paper-A", title_zh: "同名", p02_relevance: 2, contribution_role: "foundational", writing_material_count: 1, year: 2021 },
  ]

  assert.deepEqual(sortLibrary(ranked, "default", {}).map((paper) => paper.paper_id), [
    "Paper-A", "Paper-B", "Paper-C", "Paper-D", "Paper-Z",
  ])
})

test("explicit title, year, contribution, and evidence modes are deterministic and unknown mode falls back", () => {
  const ranked = [papers[2], papers[0], papers[1]]

  assert.deepEqual(sortLibrary(ranked, "title", {}).map((paper) => paper.paper_id), ["Paper-B", "Paper-A", "Paper-C"])
  assert.deepEqual(sortLibrary(ranked, "year", {}).map((paper) => paper.paper_id), ["Paper-C", "Paper-A", "Paper-B"])
  assert.deepEqual(sortLibrary(ranked, "contribution", {}).map((paper) => paper.paper_id), ["Paper-B", "Paper-A", "Paper-C"])
  assert.deepEqual(sortLibrary(ranked, "evidence", {}).map((paper) => paper.paper_id), ["Paper-B", "Paper-A", "Paper-C"])
  assert.deepEqual(sortLibrary(ranked, "not-a-mode", { "Paper-A": ["related_work"] }).map((paper) => paper.paper_id), ["Paper-A", "Paper-B", "Paper-C"])
})

test("personal reading markers never affect default sorting", () => {
  const equal = [
    { ...papers[0], paper_id: "Paper-B", title_zh: "乙" },
    { ...papers[0], paper_id: "Paper-A", title_zh: "甲" },
  ]
  const workspaceState = { personalReading: { "Paper-A": "unread", "Paper-B": "read" }, shelf: {} }
  const view = buildLibraryViewState({ papers: equal, filters: {}, sortMode: "default", workspaceState })

  assert.deepEqual(view.rows.map((row) => row.paper.paper_id), ["Paper-A", "Paper-B"])
})

test("buildLibraryViewState accepts an optional facet schema for query hits", () => {
  const view = buildLibraryViewState({
    papers,
    filters: { query: "对偶" },
    facetSchema,
    workspaceState: { shelf: {}, personalReading: {} },
  })

  assert.deepEqual(view.rows.map((row) => row.paper.paper_id), ["Paper-A"])
  assert.deepEqual(view.rows[0].hits, [{ field: "主框架", snippet: "对偶分解" }])
})

test("shelf summaries follow stable input order, use the bibliographic placeholder, and cap titles at three", () => {
  const extra = { ...papers[0], paper_id: "Paper-D", title_zh: "", title_en: "Fourth paper" }
  const shelf = {
    "Paper-A": ["theory_evidence"],
    "Paper-B": ["theory_evidence"],
    "Paper-C": ["theory_evidence"],
    "Paper-D": ["theory_evidence"],
  }

  assert.deepEqual(summarizeShelfRole("theory_evidence", [...papers, extra], shelf), {
    count: 4,
    titles: ["时变有向网络", "静态网络基线", "隐私零阶优化"],
    overflow: 1,
  })
  assert.deepEqual(
    summarizeShelfRole("theory_evidence", [
      { paper_id: "Paper-Only", title_zh: "", title_en: "" },
      { paper_id: "", title_zh: "", title_en: "" },
    ], { "Paper-Only": ["theory_evidence"], "": ["theory_evidence"] }).titles,
    ["暂无书目信息", "暂无书目信息"],
  )
})

test("describes pending identity without turning an ID or unsafe path into bibliography", async () => {
  const model = await import("./paper-library-model.mjs")
  assert.equal(typeof model.describePaperIdentity, "function")

  assert.deepEqual(model.describePaperIdentity({
    paper_id: "Paper-Only",
    title_zh: "",
    title_en: "",
    identity_source: "path_hash",
    relative_path: "专题/论文单元",
  }), {
    displayTitle: "暂无书目信息",
    bibliographyMissing: true,
    identityPending: true,
    showSourceDirectory: true,
    relativePath: "专题/论文单元",
  })
  assert.equal(
    model.describePaperIdentity({
      title_zh: "",
      title_en: "",
      identity_source: "path_hash",
      relative_path: "专题/保留  空格",
    }).relativePath,
    "专题/保留  空格",
  )

  for (const relativePath of [
    ["", "outside", "paper"].join("/"),
    ["C:", "outside", "paper"].join("/"),
    ["https:", "", "example.test", "outside", "paper"].join("/"),
    ["..", "outside", "paper"].join("/"),
  ]) {
    assert.equal(model.describePaperIdentity({
      title_zh: "",
      title_en: "",
      identity_source: "path_hash",
      relative_path: relativePath,
    }).relativePath, null)
  }
})

test("computes metadata coverage from the supplied records without fixed library totals", async () => {
  const model = await import("./paper-library-model.mjs")
  assert.equal(typeof model.summarizeMetadataCoverage, "function")

  assert.deepEqual(model.summarizeMetadataCoverage([
    { title_zh: "中文题名", identity_source: "frontmatter" },
    { title_zh: " ", identity_source: "path_hash" },
    { title_zh: null, identity_source: "override" },
  ]), {
    totalCount: 3,
    chineseTitleCount: 1,
    identityPendingCount: 1,
    text: "中文标题 1/3；待整理身份 1/3",
  })
  assert.deepEqual(model.summarizeMetadataCoverage(null), {
    totalCount: 0,
    chineseTitleCount: 0,
    identityPendingCount: 0,
    text: "中文标题 0/0；待整理身份 0/0",
  })
})

test("availability summary stays conservative and uses only formal state and artifact counts", () => {
  const paper = {
    ...papers[0],
    note_text: "已经完成证明并完全复现",
    ocr_text: "核心证据已核验",
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "code_unrun",
    writing_material_count: 0,
    artifacts: { pdf: [{}, {}], note: [{}], script: [{}], result: [] },
    artifact_availability: { pdf: true, note: true, script: true, result: false },
  }

  assert.equal(
    summarizeAvailability(paper),
    "已有 PDF 2 份；已有阅读笔记 1 份；未检查原文；无证据卡；有代码，运行状态未记录；写作材料 0 条",
  )
  assert.doesNotMatch(summarizeAvailability(paper), /完全复现|核心证据已核验/u)
})

test("translates every fixed machine enum and never leaks unknown machine values", () => {
  assert.deepEqual(PERSONAL_READING_MARKER, ["unread", "reading", "read"])
  assert.deepEqual(P02_ROLES, ["algorithm_mechanism", "theory_evidence", "simulation_baseline", "related_work"])

  const cases = [
    ["source_status", "not_checked", "未检查原文"],
    ["source_status", "located", "来源已定位"],
    ["source_status", "verified", "关键来源已核验"],
    ["evidence_status", "none", "无证据卡"],
    ["evidence_status", "partial", "部分证据"],
    ["evidence_status", "core_verified", "核心证据结构已核验"],
    ["reproduction_status", "none", "尚未建立仿真记录"],
    ["reproduction_status", "description_only", "已有仿真描述"],
    ["reproduction_status", "code_unrun", "有代码，运行状态未记录"],
    ["reproduction_status", "ran_no_record", "已运行，结果未记录"],
    ["reproduction_status", "results_recorded", "已有结果记录"],
    ["reproduction_status", "consistency_verified", "结果一致性已核验"],
    ["contribution_role", "foundational", "奠基工作"],
    ["contribution_role", "key_method_turn", "关键方法转折"],
    ["contribution_role", "theory_improvement", "理论改进"],
    ["contribution_role", "application", "应用研究"],
    ["contribution_role", "combination", "组合型工作"],
    ["contribution_role", "unclassified", "尚未分类"],
    ["personal_reading_marker", "unread", "未读"],
    ["personal_reading_marker", "reading", "在读"],
    ["personal_reading_marker", "read", "读过"],
    ["p02_role", "algorithm_mechanism", "算法机制来源"],
    ["p02_role", "theory_evidence", "理论分析来源"],
    ["p02_role", "simulation_baseline", "仿真比较基线"],
    ["p02_role", "related_work", "相关工作与写作引用"],
  ]

  for (const [field, value, expected] of cases) assert.equal(translateState(field, value), expected)
  assert.equal(translateState("source_status", "private_machine_value"), "状态待确认")
  assert.equal(translateState("private_machine_field", "private_machine_value"), "状态待确认")
})

test("builds the exact view shape, wraps records, and selects only a visible paper", () => {
  const workspaceState = {
    personalReading: { "Paper-A": "reading" },
    shelf: {
      "Paper-A": ["algorithm_mechanism"],
      "Paper-C": ["related_work"],
    },
    selectedPaperId: "Paper-C",
  }
  const view = buildLibraryViewState({
    papers,
    filters: { facets: { "research.domain": ["分布式优化"] } },
    facetSchema,
    sortMode: "year",
    workspaceState,
  })

  assert.deepEqual(Object.keys(view), ["totalCount", "resultCount", "rows", "shelfSummaries", "selectedPaper", "empty"])
  assert.equal(view.totalCount, 3)
  assert.equal(view.resultCount, 2)
  assert.deepEqual(view.rows.map((row) => Object.keys(row)), [
    ["paper", "hits", "personalReadingMarker", "shelfRoles", "availabilitySummary"],
    ["paper", "hits", "personalReadingMarker", "shelfRoles", "availabilitySummary"],
  ])
  assert.deepEqual(view.rows.map((row) => row.paper.paper_id), ["Paper-A", "Paper-B"])
  assert.equal(view.rows[0].personalReadingMarker, "reading")
  assert.equal(view.rows[1].personalReadingMarker, "unread")
  assert.equal(view.selectedPaper.paper_id, "Paper-A")
  assert.equal(view.empty, false)
  assert.deepEqual(view.shelfSummaries.map(({ role, count }) => [role, count]), [
    ["algorithm_mechanism", 1],
    ["theory_evidence", 0],
    ["simulation_baseline", 0],
    ["related_work", 1],
  ])
})

test("keeps the selected full-index paper when visible and returns a null empty selection", () => {
  const visible = buildLibraryViewState({
    papers,
    filters: { facets: { "research.mode": ["在线优化"] } },
    facetSchema,
    sortMode: "default",
    workspaceState: { selectedPaperId: "Paper-C", shelf: {}, personalReading: {} },
  })
  assert.equal(visible.selectedPaper.paper_id, "Paper-C")

  const empty = buildLibraryViewState({
    papers,
    filters: { query: "不存在的关键词" },
    sortMode: "default",
    workspaceState: { selectedPaperId: "Paper-C", shelf: {}, personalReading: {} },
  })
  assert.equal(empty.resultCount, 0)
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.selectedPaper, null)
  assert.equal(empty.empty, true)
})

test("filtering, sorting, and view construction never mutate frozen papers or workspace state", () => {
  const frozenPapers = deepFreeze(structuredClone(papers))
  const workspaceState = deepFreeze({
    personalReading: { "Paper-A": "read" },
    shelf: { "Paper-A": ["algorithm_mechanism"] },
    selectedPaperId: "Paper-A",
  })
  const beforePapers = structuredClone(frozenPapers)
  const beforeWorkspace = structuredClone(workspaceState)

  const frozenFilters = deepFreeze({
    query: "有向",
    facets: { "constraints.scope": ["耦合约束"] },
    facetSchema,
    shelfRoles: ["algorithm_mechanism"],
  })
  filterLibrary(frozenPapers, frozenFilters, workspaceState)
  sortLibrary(frozenPapers, "default", workspaceState.shelf)
  const view = buildLibraryViewState({ papers: frozenPapers, filters: frozenFilters, facetSchema, sortMode: "default", workspaceState })
  view.rows[0].shelfRoles.push("related_work")

  assert.deepEqual(frozenPapers, beforePapers)
  assert.deepEqual(workspaceState, beforeWorkspace)
  assert.deepEqual(frozenFilters, {
    query: "有向",
    facets: { "constraints.scope": ["耦合约束"] },
    facetSchema,
    shelfRoles: ["algorithm_mechanism"],
  })
})
