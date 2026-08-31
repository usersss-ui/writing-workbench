import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadPaperOverrides, validatePaperOverride } from "./overrides.mjs"
import { createEmptyFacets } from "./facet-schema.mjs"
import { deriveFormalState, mergePaperRecord, validateGeneratedPaper } from "./status.mjs"
import * as statusModule from "./status.mjs"

const artifacts = (overrides = {}) => ({
  pdf: [], ocr: [], translation: [], note: [], derivation: [], source_map: [],
  modeling: [], simulation: [], code_compare: [], script: [], result: [],
  reproduction_report: [], ...overrides,
})

const availability = (overrides = {}) => ({
  ...Object.fromEntries(Object.keys(artifacts()).map((key) => [key, false])),
  ...overrides,
})

function validPaper(overrides = {}) {
  return {
    paper_id: "Paper-01", slug: "paper-01", source_id: "main_papers", relative_path: "Paper",
    identity_source: "override", unit_type: "article", parent_paper_id: null,
    title_original: "Original title", title_zh: "中文标题", title_en: "English title", authors: [],
    publication_year: null, version_date: null, year: null, venue: "", doi_or_url: "", metadata_provenance: {},
    record_type: "外部论文", facets: createEmptyFacets(), source_terms: [],
    contribution_role: "unclassified", p02_relevance: null, artifacts: artifacts(), artifact_availability: availability(),
    source_status: "not_checked", evidence_status: "none", reproduction_status: "none", writing_material_count: 0,
    note_status: "metadata_only", preferred_note: null, note_preview_url: null, warnings: [], ...overrides,
  }
}

test("PDF and notes do not upgrade formal reading or evidence states", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ pdf: [{ relative_path: "paper.pdf" }], note: [{ relative_path: "note.md" }] }),
    override: {},
  })
  assert.deepEqual(state, {
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    writing_material_count: 0,
  })
})

test("code existence reports code_unrun but never reproduced", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ script: [{ relative_path: "run.py" }] }),
    override: {},
  })
  assert.equal(state.reproduction_status, "code_unrun")
})

test("a code-comparison note alone is not treated as executable code", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ code_compare: [{ relative_path: "代码对比提示.md" }] }),
    override: {},
  })
  assert.equal(state.reproduction_status, "none")
})

test("a simulation description is availability only when no executable script exists", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ simulation: [{ relative_path: "simulation.md" }] }),
    override: {},
  })
  assert.equal(state.reproduction_status, "description_only")
})

test("an override wins over an adapter title and fallback state", () => {
  const merged = mergePaperRecord({
    adapted: { title_zh: "路径标题", year: null },
    explicit: { title_zh: "frontmatter 标题", year: 2018 },
    override: { title_zh: "人工确认标题", evidence_status: "partial" },
  })
  assert.equal(merged.title_zh, "人工确认标题")
  assert.equal(merged.year, 2018)
  assert.equal(merged.evidence_status, "partial")
})

test("merge priority is override then catalog then frontmatter then adapted", () => {
  const paper = mergePaperRecord({
    adapted: { title_original: "adapted", venue: "adapter venue" },
    explicit: { title_original: "frontmatter", authors: ["Front Matter"] },
    catalog: { title_original: "catalog", year: 2024, authors: ["Catalog Author"] },
    override: { title_original: "override" },
  })

  assert.equal(paper.title_original, "override")
  assert.equal(paper.year, 2024)
  assert.deepEqual(paper.authors, ["Catalog Author"])
  assert.equal(paper.venue, "adapter venue")
})

test("merged metadata provenance records the winning source without upgrading formal states", () => {
  const paper = mergePaperRecord({
    adapted: { venue: "Adapter Venue" },
    explicit: { title_original: "Frontmatter title" },
    catalog: { authors: ["Catalog Author"], metadata_provenance: { authors: "catalog" } },
    override: { publication_year: 2024 },
  })

  assert.equal(paper.metadata_provenance.title_original, "frontmatter")
  assert.equal(paper.metadata_provenance.authors, "catalog")
  assert.equal(paper.metadata_provenance.publication_year, "override")
  assert.equal(paper.metadata_provenance.venue, "adapter")
  assert.equal(paper.source_status, "not_checked")
  assert.equal(paper.evidence_status, "none")
})

test("a null override intentionally clears explicit and adapted nullable values", () => {
  const merged = mergePaperRecord({
    adapted: { year: 2024, p02_relevance: 3 },
    explicit: { year: 2020, p02_relevance: 2 },
    override: { year: null, p02_relevance: null },
  })
  assert.equal(merged.year, null)
  assert.equal(merged.p02_relevance, null)
})

test("writing material count rejects negative or non-integer values", () => {
  assert.throws(
    () => deriveFormalState({ artifacts: artifacts(), override: { writing_material_count: 1.5 } }),
    /写作材料数量/,
  )
  assert.throws(
    () => deriveFormalState({ artifacts: artifacts(), override: { writing_material_count: -1 } }),
    /写作材料数量/,
  )
})

test("validates every fixed override enum without accepting near misses", () => {
  for (const unit_type of ["article", "review", "thesis", "chapter"]) {
    validatePaperOverride("main_papers::Paper", { unit_type })
  }
  for (const contribution_role of ["foundational", "key_method_turn", "theory_improvement", "application", "combination", "unclassified"]) {
    validatePaperOverride("main_papers::Paper", { contribution_role })
  }
  for (const source_status of ["not_checked", "located", "verified"]) {
    validatePaperOverride("main_papers::Paper", { source_status })
  }
  for (const evidence_status of ["none", "partial", "core_verified"]) {
    validatePaperOverride("main_papers::Paper", { evidence_status })
  }
  for (const reproduction_status of ["none", "description_only", "code_unrun", "ran_no_record", "results_recorded", "consistency_verified"]) {
    validatePaperOverride("main_papers::Paper", { reproduction_status })
  }
  assert.throws(() => validatePaperOverride("main_papers::Paper", { source_status: "checked" }), /source_status/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { contribution_role: "important" }), /contribution_role/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { artifact_overrides: { unknown: ["Paper/note.md"] } }), /artifact_overrides/)
})

test("rejects unknown and unsafe override fields before any generated path can exist", () => {
  assert.throws(() => validatePaperOverride("main_papers::Paper", { unknown: true }), /未知/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { paper_id: "../escape" }), /paper_id/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { preferred_note: "../escape.md" }), /preferred_note/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { preview_note: "true" }), /preview_note/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { method_tags: ["tag", "tag"] }), /唯一/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { method_tags: [" tag"] }), /去除空白/)
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper", { property_tags: ["差分隐私"], theory_tags: ["动态遗憾"] }))
  assert.throws(() => validatePaperOverride("main_papers::Paper", { p02_relevance: 4 }), /p02_relevance/)
})

test("loads only versioned canonical override records and rejects duplicate paper IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-overrides-"))
  const valid = join(root, "valid.json")
  await writeFile(valid, JSON.stringify({
    version: 1,
    papers: {
      "main_papers::Paper A": { paper_id: "Paper-01", artifact_overrides: { translation: ["Paper A/中文.md"] } },
    },
  }))
  const loaded = await loadPaperOverrides(valid)
  assert.equal(loaded.papers["main_papers::Paper A"].paper_id, "Paper-01")

  const duplicate = join(root, "duplicate.json")
  await writeFile(duplicate, JSON.stringify({
    version: 1,
    papers: {
      "main_papers::Paper A": { paper_id: "Paper-01" },
      "main_papers::Paper B": { paper_id: "Paper-01" },
    },
  }))
  await assert.rejects(() => loadPaperOverrides(duplicate), /paper_id 重复/)
})

test("generated paper accepts only version-2 facet fields", () => {
  const paper = validPaper()
  paper.facets.constraints.scope = ["耦合约束"]
  paper.source_terms = ["Tracking-ADMM"]
  assert.doesNotThrow(() => validateGeneratedPaper(paper))
  assert.throws(() => validateGeneratedPaper({ ...paper, topic_l1: "分布式优化" }), /固定字段/)
})

test("validates the generated contract and rejects English display placeholders", () => {
  const paper = validPaper()
  assert.throws(() => validateGeneratedPaper({ ...paper, title_zh: "Unknown" }), /英文占位/)
})

test("generated records reject values outside their fixed data enums", () => {
  const paper = validPaper()
  assert.throws(() => validateGeneratedPaper({ ...paper, unit_type: "booklet" }), /unit_type/)
  for (const record_type of ["会议论文", "", " 外部论文", "章节材料"]) {
    assert.throws(() => validateGeneratedPaper({ ...paper, record_type }), /record_type/)
  }
  for (const record_type of ["外部论文", "学位论文", "学位论文章节", "专题综述"]) {
    assert.doesNotThrow(() => validateGeneratedPaper({ ...paper, record_type }))
  }
  assert.throws(() => validateGeneratedPaper({ ...paper, contribution_role: "important" }), /contribution_role/)
  assert.throws(() => validateGeneratedPaper({ ...paper, p02_relevance: 4 }), /p02_relevance/)
  assert.throws(() => validateGeneratedPaper({ ...paper, note_status: "conflict" }), /note_status/)
  for (const note_status of ["notes_ready", "ocr_only", "pdf_only", "metadata_only"]) {
    assert.doesNotThrow(() => validateGeneratedPaper({ ...paper, note_status }))
  }
})

test("generated records reject each unsafe fixed-contract boundary", () => {
  const paper = validPaper()
  const privateNoteUrl = ["", "Users", "private", "note.html"].join("/")
  const cases = [
    [{ ...paper, identity_source: "inferred" }, /identity_source/],
    [{ ...paper, source_id: 4 }, /source_id/],
    [{ ...paper, relative_path: "../escape" }, /relative_path/],
    [{ ...paper, parent_paper_id: "../escape" }, /parent_paper_id/],
    [{ ...paper, authors: ["Alice", 2] }, /authors/],
    [{ ...paper, source_terms: ["tracking", 2] }, /source_terms/],
    [{ ...paper, source_terms: [" tracking"] }, /source_terms/],
    [{ ...paper, source_terms: ["tracking", "tracking"] }, /source_terms/],
    [{ ...paper, facets: { ...paper.facets, methods: { ...paper.facets.methods, framework: ["未知方法"] } } }, /分面/],
    [{ ...paper, year: "2024" }, /year/],
    [{ ...paper, publication_year: "2024" }, /publication_year/],
    [{ ...paper, version_date: 20240101 }, /version_date/],
    [{ ...paper, metadata_provenance: { paper_id: "inferred" } }, /metadata_provenance/],
    [{ ...paper, contribution_role: 2 }, /contribution_role/],
    [{ ...paper, artifacts: { ...artifacts(), pdf: [{ relative_path: "../paper.pdf" }] } }, /artifacts\.pdf/],
    [{ ...paper, artifacts: { ...artifacts(), extra: [] } }, /artifacts/],
    [{ ...paper, artifact_availability: availability({ pdf: "yes" }) }, /artifact_availability\.pdf/],
    [{ ...paper, artifact_availability: { pdf: false } }, /artifact_availability/],
    [{ ...paper, writing_material_count: -1 }, /写作材料数量/],
    [{ ...paper, preferred_note: "../note.md" }, /preferred_note/],
    [{ ...paper, note_preview_url: privateNoteUrl }, /note_preview_url/],
    [{ ...paper, warnings: ["ok", 2] }, /warnings/],
  ]
  for (const [candidate, expected] of cases) assert.throws(() => validateGeneratedPaper(candidate), expected)
})

test("generated records reject private fields and malformed exact artifact entries", () => {
  const paper = validPaper()
  const safeArtifact = { relative_path: "paper.pdf", file_name: "paper.pdf", size_bytes: 1 }
  const privatePaperDirectory = ["", "Users", "private", "Paper"].join("/")
  const privatePaperFile = ["", "Users", "private", "paper.pdf"].join("/")
  assert.doesNotThrow(() => validateGeneratedPaper({ ...paper, artifacts: artifacts({ pdf: [safeArtifact] }) }))
  const cases = [
    [{ ...paper, absolute_path: privatePaperDirectory }, /固定字段/],
    [{ ...paper, artifacts: artifacts({ pdf: ["paper.pdf"] }) }, /artifacts\.pdf/],
    [{ ...paper, artifacts: artifacts({ pdf: [{ relative_path: "paper.pdf" }] }) }, /artifacts\.pdf/],
    [{ ...paper, artifacts: artifacts({ pdf: [{ ...safeArtifact, absolute_path: privatePaperFile }] }) }, /artifacts\.pdf/],
    [{ ...paper, artifacts: artifacts({ pdf: [{ ...safeArtifact, file_name: "other.pdf" }] }) }, /artifacts\.pdf/],
    [{ ...paper, artifacts: artifacts({ pdf: [{ ...safeArtifact, size_bytes: -1 }] }) }, /artifacts\.pdf/],
    [{ ...paper, year: 42 }, /year/],
  ]
  for (const [candidate, expected] of cases) assert.throws(() => validateGeneratedPaper(candidate), expected)
})

test("controlled preview documents enforce exact categories, safe labels, hashed URLs, sizes, and default flags", () => {
  assert.equal(typeof statusModule.validateControlledPreviewDocuments, "function")
  const empty = {
    note: [], derivation: [], source_map: [], modeling: [], simulation: [], code_compare: [], reproduction_report: [],
  }
  const safe = {
    ...empty,
    note: [{
      label: "notes/old_精读.md",
      url: `../../local_library_data/notes/paper-01/note/${"a".repeat(64)}.html`,
      size_bytes: 42,
      is_default: true,
    }],
  }
  assert.equal(statusModule.validateControlledPreviewDocuments({ slug: "paper-01", documents: safe }), safe)
  const privateLabel = ["", "Users", "private", "note.md"].join("/")

  const cases = [
    [{ ...safe, extra: [] }, /固定类别/u],
    [{ ...safe, note: [{ ...safe.note[0], extra: true }] }, /条目结构/u],
    [{ ...safe, note: [{ ...safe.note[0], label: privateLabel }] }, /label/u],
    [{ ...safe, note: [{ ...safe.note[0], label: "../private.md" }] }, /label/u],
    [{ ...safe, note: [{ ...safe.note[0], label: "notes/private.txt" }] }, /Markdown/u],
    [{ ...safe, note: [{ ...safe.note[0], url: `../../local_library_data/notes/other/note/${"a".repeat(64)}.html` }] }, /url/u],
    [{ ...safe, note: [{ ...safe.note[0], url: `../../local_library_data/notes/paper-01/modeling/${"a".repeat(64)}.html` }] }, /url/u],
    [{ ...safe, note: [{ ...safe.note[0], size_bytes: -1 }] }, /size_bytes/u],
    [{ ...safe, note: [{ ...safe.note[0], is_default: "true" }] }, /is_default/u],
    [{ ...safe, source_map: [{ ...safe.note[0], url: `../../local_library_data/notes/paper-01/source_map/${"a".repeat(64)}.html` }] }, /is_default/u],
  ]
  for (const [documents, expected] of cases) {
    assert.throws(() => statusModule.validateControlledPreviewDocuments({ slug: "paper-01", documents }), expected)
  }
})
