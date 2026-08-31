import test from "node:test"
import assert from "node:assert/strict"
import { validateMetadataProvenance, validatePaperOverride } from "./overrides.mjs"

test("override validation accepts normalized metadata fields and provenance", () => {
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper", {
    title_original: "语言中立标题",
    publication_year: 2024,
    version_date: "2024-03-15",
    metadata_provenance: {
      title_original: "override",
      publication_year: "catalog",
      version_date: "frontmatter",
    },
  }))
})

test("metadata provenance accepts the generated facet_states field", () => {
  assert.doesNotThrow(() => validateMetadataProvenance({ facet_states: "tag_catalog" }))
})

test("override validation rejects unknown provenance fields and sources", () => {
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { metadata_provenance: { title_original: "inferred" } }),
    /metadata_provenance/,
  )
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { metadata_provenance: { secret_path: "override" } }),
    /metadata_provenance/,
  )
})

test("override validation rejects malformed normalized dates", () => {
  assert.throws(() => validatePaperOverride("main_papers::Paper", { publication_year: 24 }), /publication_year/)
  assert.throws(() => validatePaperOverride("main_papers::Paper", { version_date: 20240101 }), /version_date/)
})

test("an exclusion requires a non-empty reason", () => {
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { include: false }),
    /exclude_reason/,
  )
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { include: false, exclude_reason: "   " }),
    /exclude_reason/,
  )
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper", {
    include: false,
    exclude_reason: "continuous_time_out_of_scope",
  }))
})

test("exclude_reason is valid only for an explicit exclusion", () => {
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { exclude_reason: "continuous_time_out_of_scope" }),
    /exclude_reason/,
  )
  assert.throws(
    () => validatePaperOverride("main_papers::Paper", { include: true, exclude_reason: "continuous_time_out_of_scope" }),
    /exclude_reason/,
  )
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper", { include: true }))
})

test("note override paths reject artifacts that can never be reading notes", () => {
  for (const path of [
    "Paper/paper.pdf",
    "Paper/legacy-note.txt",
    "Paper/run.py",
    "Paper/translation.log",
    "Paper/Paper_中文翻译.md",
    "Paper/Paper_translation.markdown",
    "Paper/paper_OCR.md",
    "Paper/paper-ocr.markdown",
    "Paper/PaPeR_oCr.md",
    "Paper/proof-notes.md",
    "Paper/simulation.md",
  ]) {
    assert.throws(
      () => validatePaperOverride("main_papers::Paper", { artifact_overrides: { note: [path] } }),
      /artifact_overrides\.note/,
      path,
    )
  }
})

test("preferred_note rejects path-only forbidden targets", () => {
  for (const path of [
    "paper.pdf",
    "legacy-note.txt",
    "translation.log",
    "Paper_中文翻译.md",
    "paper_OCR.md",
    "paper-ocr.markdown",
    "PaPeR_oCr.md",
    "proof-notes.md",
    "simulation.md",
  ]) {
    assert.throws(
      () => validatePaperOverride("main_papers::Paper", { preferred_note: path }),
      /preferred_note/,
      path,
    )
  }
})

test("keeps legitimate Markdown note overrides and other artifact categories", () => {
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper", {
    artifact_overrides: {
      note: ["Paper/historical.md"],
      translation: ["Paper/paper.pdf"],
      ocr: ["Paper/scan.bin"],
    },
    preferred_note: "historical.md",
  }))
})
