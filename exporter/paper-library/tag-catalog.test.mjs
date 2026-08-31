import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createEmptyFacets } from "./facet-schema.mjs"
import { PAPER_RECORD_TYPES, applyPaperTagCatalog, loadPaperTagCatalog, validatePaperTagRecord } from "./tag-catalog.mjs"

const validRecord = (overrides = {}) => ({
  record_type: "外部论文",
  facets: {
    ...createEmptyFacets(),
    research: { domain: ["分布式优化"], mode: [] },
  },
  facet_states: {},
  source_terms: ["Dual Decomposition"],
  ...overrides,
})

const expectedRepresentativeRecordsWithoutStates = {
  "Falsone17-DD": {
    record_type: "外部论文",
    facets: {
      research: { domain: ["分布式优化"], mode: [] },
      objective: ["凸"],
      constraints: { scope: ["耦合约束"], form: ["不等式约束"], consistency: [] },
      oracle: { information: ["次梯度"], estimation: [] },
      methods: { framework: ["对偶分解"], coordination: [], operator: ["近端"] },
      network: { direction: ["无向"], time: ["时变"], balance: [], mixing: ["双随机"] },
      privacy_robustness: [],
      results: [],
      applications: [],
    },
    source_terms: ["Dual Decomposition", "Proximal Subgradient"],
  },
  "Falsone20-TADMM": {
    record_type: "外部论文",
    facets: {
      research: { domain: ["分布式优化"], mode: ["静态优化"] },
      objective: ["凸"],
      constraints: { scope: ["耦合约束"], form: ["等式约束"], consistency: [] },
      oracle: { information: ["精确梯度"], estimation: [] },
      methods: { framework: ["ADMM"], coordination: ["动态跟踪"], operator: [] },
      network: { direction: ["无向"], time: ["固定"], balance: ["平衡"], mixing: ["双随机"] },
      privacy_robustness: [],
      results: [],
      applications: [],
    },
    source_terms: ["Tracking-ADMM"],
  },
  "Tang26-DPPDS": {
    record_type: "外部论文",
    facets: {
      research: { domain: ["分布式优化"], mode: ["静态优化"] },
      objective: ["凸"],
      constraints: { scope: ["耦合约束"], form: ["等式约束", "不等式约束"], consistency: [] },
      oracle: { information: ["精确梯度"], estimation: [] },
      methods: { framework: ["原始—对偶", "算子分裂"], coordination: ["Perron 修正"], operator: ["近端", "预测—校正"] },
      network: { direction: ["有向"], time: [], balance: ["不平衡"], mixing: ["行随机"] },
      privacy_robustness: [],
      results: [],
      applications: [],
    },
    source_terms: ["Distributed Proximal Primal-Dual Splitting"],
  },
  "Zhao24-OPRF": {
    record_type: "外部论文",
    facets: {
      research: { domain: ["分布式优化"], mode: ["在线优化"] },
      objective: ["凸"],
      constraints: { scope: [], form: [], consistency: [] },
      oracle: { information: ["函数值反馈"], estimation: ["单点估计", "残差反馈"] },
      methods: { framework: [], coordination: [], operator: [] },
      network: { direction: ["有向"], time: ["时变"], balance: ["不平衡"], mixing: ["行随机"] },
      privacy_robustness: ["差分隐私", "Laplace 机制"],
      results: ["动态遗憾", "隐私保证"],
      applications: [],
    },
    source_terms: ["One-Point Residual Feedback", "Path Variation"],
  },
}

const expectedRepresentativeRecords = Object.fromEntries(
  Object.entries(expectedRepresentativeRecordsWithoutStates).map(([paperId, record]) => [
    paperId,
    { ...record, facet_states: {} },
  ]),
)

const writeCatalog = async (catalog) => {
  const root = await mkdtemp(join(tmpdir(), "paper-tags-v3-"))
  const path = join(root, "paper-tags.json")
  await writeFile(path, JSON.stringify(catalog))
  return path
}

test("loads a version-3 stable-ID facet catalog", async () => {
  const path = await writeCatalog({ version: 3, papers: { "Falsone17-DD": validRecord() } })

  const catalog = await loadPaperTagCatalog(path)

  assert.equal(catalog.version, 3)
  assert.deepEqual(catalog.papers["Falsone17-DD"].facet_states, {})
  assert.deepEqual(catalog.papers["Falsone17-DD"].facets.research.domain, ["分布式优化"])
  assert.deepEqual(catalog.papers["Falsone17-DD"].source_terms, ["Dual Decomposition"])
})

test("the real version-3 catalog covers every currently included stable paper ID without inferred states", async () => {
  const catalog = await loadPaperTagCatalog(new URL("../../local_library_config/paper-tags.json", import.meta.url))
  assert.equal(catalog.version, 3)
  assert.ok(Object.keys(catalog.papers).length > 0)
  assert.equal(Object.values(catalog.papers).every((record) => (
    Object.keys(record.facet_states).length === 0
  )), true)
  for (const [paperId, expectedRecord] of Object.entries(expectedRepresentativeRecords)) {
    assert.deepEqual(catalog.papers[paperId], expectedRecord)
  }
})

test("the shared record type contract keeps thesis chapters as 学位论文章节", async () => {
  assert.deepEqual(PAPER_RECORD_TYPES, ["外部论文", "学位论文", "学位论文章节", "专题综述"])
  const catalog = await loadPaperTagCatalog(new URL("../../local_library_config/paper-tags.json", import.meta.url))
  assert.equal(catalog.papers["Li25-TSGF-C03"].record_type, "学位论文章节")
  assert.equal(catalog.papers["Li25-TSGF-C05"].record_type, "学位论文章节")
  assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({ record_type: "章节材料" })), /record_type/u)
})

test("the real catalog keeps the approved Tseng split without promoting broad robustness", async () => {
  const catalog = await loadPaperTagCatalog(new URL("../../local_library_config/paper-tags.json", import.meta.url))
  const record = catalog.papers["Deng23-TSR"]

  assert.deepEqual(record.facets.methods.framework, ["算子分裂"])
  assert.deepEqual(record.facets.methods.operator, ["预测—校正"])
  assert.deepEqual(record.facets.privacy_robustness, [])
})

test("rejects legacy compound tag fields", () => {
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    topic_l2: "耦合约束对偶分解",
  }), /未知标签字段/u)
})

test("requires exactly record_type, facets, facet_states, and source_terms", () => {
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    record_type: "外部论文",
    facets: createEmptyFacets(),
  }), /字段缺失/u)
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    extra: true,
  }), /未知标签字段/u)
})

test("catalog requires facet_states and rejects collisions with populated facets", () => {
  const missing = validRecord()
  delete missing.facet_states
  assert.throws(() => validatePaperTagRecord("Paper-01", missing), /字段缺失: facet_states/u)
  assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({
    facet_states: { "research.domain": "pending_verification" },
  })), /不能覆盖已有分面值/u)
  assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({
    facet_states: { applications: "not_applicable", private: "unrecorded" },
  })), /路径无效/u)
})

test("catalog records reject facet states that cannot round-trip through JSON", () => {
  const inherited = Object.create({ applications: "not_applicable" })
  const hidden = {}
  Object.defineProperty(hidden, "applications", { value: "not_applicable", enumerable: false })
  const symbol = { applications: "not_applicable" }
  symbol[Symbol("private")] = "unrecorded"
  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, "applications", {
    enumerable: true,
    get() {
      accessorReads += 1
      return "not_applicable"
    },
  })

  for (const facetStates of [inherited, hidden, symbol, accessor]) {
    assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({ facet_states: facetStates })), /facet_states/u)
  }
  assert.equal(accessorReads, 0)
})

test("catalog merge refuses a state that object spread would silently drop", () => {
  const facetStates = {}
  Object.defineProperty(facetStates, "applications", { value: "not_applicable", enumerable: false })
  assert.throws(() => applyPaperTagCatalog({
    papers: [{ paper_id: "Paper-01", unit_type: "article", metadata_provenance: {}, warnings: [] }],
    tagCatalog: { version: 3, papers: { "Paper-01": validRecord({ facet_states: facetStates }) } },
  }), /facet_states/u)
})

test("catalog merge clones sparse states and records their provenance", () => {
  const tagCatalog = {
    version: 3,
    papers: { "Paper-01": validRecord({ facet_states: { results: "pending_verification" } }) },
  }
  const input = [{ paper_id: "Paper-01", unit_type: "article", metadata_provenance: {}, warnings: [] }]
  const result = applyPaperTagCatalog({ papers: input, tagCatalog })
  assert.deepEqual(result.papers[0].facet_states, { results: "pending_verification" })
  assert.equal(result.papers[0].metadata_provenance.facet_states, "tag_catalog")
  assert.notStrictEqual(result.papers[0].facet_states, tagCatalog.papers["Paper-01"].facet_states)
})

test("validates record type, controlled facets, and source terms", () => {
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    record_type: "会议论文",
  }), /record_type/u)
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    facets: { ...createEmptyFacets(), research: { domain: ["未知领域"], mode: [] } },
  }), /受控词表/u)
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    source_terms: ["Dual Decomposition", "Dual Decomposition"],
  }), /唯一/u)
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    source_terms: [" Dual Decomposition"],
  }), /去除空白/u)
})

test("merges facet records by stable paper_id and preserves inputs", () => {
  const papers = [
    { paper_id: "Falsone17-DD", unit_type: "article", metadata_provenance: {}, warnings: [] },
    { paper_id: "New-01", unit_type: "review", metadata_provenance: {}, warnings: [] },
  ]
  const tagCatalog = { version: 3, papers: { "Falsone17-DD": validRecord() } }
  const originalPapers = structuredClone(papers)
  const originalCatalog = structuredClone(tagCatalog)

  const result = applyPaperTagCatalog({ papers, tagCatalog })

  assert.equal(result.papers[0].record_type, "外部论文")
  assert.deepEqual(result.papers[0].facets.research.domain, ["分布式优化"])
  assert.deepEqual(result.papers[0].source_terms, ["Dual Decomposition"])
  assert.deepEqual(result.papers[0].metadata_provenance, {
    record_type: "tag_catalog",
    facets: "tag_catalog",
    facet_states: "tag_catalog",
    source_terms: "tag_catalog",
  })
  assert.deepEqual(papers, originalPapers)
  assert.deepEqual(tagCatalog, originalCatalog)
  assert.notStrictEqual(result.papers[0].facets, tagCatalog.papers["Falsone17-DD"].facets)
  assert.notStrictEqual(result.papers[0].source_terms, tagCatalog.papers["Falsone17-DD"].source_terms)
})

test("keeps unmatched papers visible with empty facets and pending warning", () => {
  const papers = [
    { paper_id: "Article-01", unit_type: "article", metadata_provenance: {}, warnings: [] },
    { paper_id: "Review-01", unit_type: "review", metadata_provenance: {}, warnings: ["已有警告"] },
    { paper_id: "Thesis-01", unit_type: "thesis", metadata_provenance: {}, warnings: [] },
    { paper_id: "Chapter-01", unit_type: "chapter", metadata_provenance: {}, warnings: [] },
  ]

  const result = applyPaperTagCatalog({ papers, tagCatalog: { version: 3, papers: {} } })

  assert.deepEqual(result.tagging, {
    tagged_count: 0,
    pending_paper_ids: ["Article-01", "Chapter-01", "Review-01", "Thesis-01"],
    unmatched_paper_ids: [],
  })
  assert.deepEqual(result.papers.map((paper) => paper.record_type), [
    "外部论文", "专题综述", "学位论文", "学位论文章节",
  ])
  for (const paper of result.papers) {
    assert.deepEqual(paper.facets, createEmptyFacets())
    assert.deepEqual(paper.facet_states, {})
    assert.deepEqual(paper.source_terms, [])
    assert.match(paper.warnings.join(" "), /标签待整理/u)
  }
  assert.match(result.papers[1].warnings.join(" "), /已有警告/u)
})

test("rejects catalog records that no scanned paper_id can consume", () => {
  assert.throws(() => applyPaperTagCatalog({
    papers: [{ paper_id: "Paper-01", unit_type: "article", metadata_provenance: {}, warnings: [] }],
    tagCatalog: { version: 3, papers: { "Paper-99": validRecord() } },
  }), /未匹配论文/u)
})
