import assert from "node:assert/strict"
import test from "node:test"
import * as matching from "./local-paper-match.mjs"

function match(work, papers) {
  assert.equal(typeof matching.matchLocalPaper, "function")
  return matching.matchLocalPaper(work, papers)
}

const online = (patch = {}) => ({
  paperId: "W123456789", doi: "10.1234/example.2024", title: "Distributed optimization over directed communication networks",
  year: 2024, authors: ["Alice Zhang", "Bob Smith"], ...patch,
})
const local = (patch = {}) => ({
  paper_id: "Zhang24-Example", slug: "zhang24-example", title_original: "Distributed optimization over directed communication networks",
  title_en: "", title_zh: "", doi_or_url: "https://doi.org/10.1234/example.2024",
  publication_year: 2024, year: 2024, authors: ["Alice Zhang", "Bob Smith"],
  source_documents: { pdf: [{ label: "paper.pdf", url: `../../local_library_data/sources/zhang24-example/pdf/${"a".repeat(64)}.pdf`, size_bytes: 2048 }], ocr: [] },
  ...patch,
})

test("a unique normalized DOI identifies a local PDF and returns only public match fields", () => {
  const result = match(online({ doi: " DOI: 10.1234/EXAMPLE.2024 " }), [local({ doi_or_url: "http://dx.doi.org/10.1234/example.2024", title_zh: "有向网络上的分布式优化" })])
  assert.equal(result.status, "existing_pdf")
  assert.deepEqual(result.matches, [{ paperId: "Zhang24-Example", title: "有向网络上的分布式优化", href: "./library.html?paper_id=Zhang24-Example", hasPdf: true, hasNote: false }])
  assert.match(result.reason, /DOI/u)
  assert.deepEqual(Object.keys(result).sort(), ["matches", "reason", "status"])
})

test("metadata and artifact flags cannot claim a PDF absent from the available source documents", () => {
  const result = match(online(), [local({
    artifact_availability: { pdf: true }, artifacts: { pdf: [{ file_name: "paper.pdf" }] },
    source_documents: { pdf: [], ocr: [{ label: "OCR.md", url: "ocr.html" }] },
  })])
  assert.equal(result.status, "missing_pdf")
  assert.equal(result.matches[0].hasPdf, false)
})

test("an explicit OpenAlex identity can identify a local record even when the online DOI is newly known", () => {
  for (const doi_or_url of ["https://openalex.org/W123456789", "https://api.openalex.org/works/W123456789/"]) {
    const result = match(online(), [local({ doi_or_url })])
    assert.equal(result.status, "existing_pdf")
    assert.match(result.reason, /OpenAlex/u)
  }
})

test("title and year agreement is possible evidence and never a definite duplicate", () => {
  const result = match(online({ doi: null, title: "  DISTRIBUTED optimization over directed communication networks! " }), [local({ doi_or_url: "", authors: [] })])
  assert.equal(result.status, "possible_match")
  assert.equal(result.matches[0].paperId, "Zhang24-Example")
})

test("an exact title with an overlapping full author may be suggested when years are missing", () => {
  const result = match(online({ doi: null, year: null, authors: [" ALICE   ZHANG "] }), [local({ doi_or_url: "", publication_year: null, year: null })])
  assert.equal(result.status, "possible_match")
})

test("an identical distinctive title flags possible preprint versions despite different years and abbreviated authors", () => {
  const title = "Dual Averaging for Distributed Optimization: Convergence Analysis and Network Scaling"
  const result = match(online({ doi: null, title, year: 2010, authors: ["John C. Duchi"] }), [local({
    title_original: title, publication_year: 2012, year: 2012, authors: ["Duchi JC"],
  })])
  assert.equal(result.status, "possible_match")
  assert.equal(result.matches[0].hasPdf, true)
  assert.match(result.reason, /题名相同.*版本/u)
  assert.equal(match(online({ doi: null, year: null, authors: [] }), [local({ doi_or_url: "", publication_year: null, year: null, authors: [] })]).status, "possible_match")
})

test("a close title needs both matching year and an author, not just a few shared terms", () => {
  const work = online({ doi: null, title: "Distributed optimization methods over directed communication networks" })
  assert.equal(match(work, [local({ doi_or_url: "" })]).status, "possible_match")
  assert.equal(match(work, [local({ doi_or_url: "", authors: ["Someone Else"] })]).status, "not_found")
  assert.equal(match(work, [local({ doi_or_url: "", title_original: "Communication networks for robotic control" })]).status, "not_found")
})

test("all explicitly stored title variants participate but translations are never inferred", () => {
  const bilingual = local({ title_zh: "有向网络优化", title_original: "", title_en: online().title, doi_or_url: "" })
  const result = match(online({ doi: null }), [bilingual])
  assert.equal(result.status, "possible_match")
  assert.equal(result.matches[0].title, "有向网络优化")
  assert.equal(match(online({ doi: null }), [local({ title_original: "有向通信网络上的分布式优化", title_en: "", doi_or_url: "" })]).status, "not_found")
})

test("conflicting DOIs remain a possible bibliographic match even when a PDF exists", () => {
  const result = match(online(), [local({ doi_or_url: "10.1234/different.paper" })])
  assert.equal(result.status, "possible_match")
  assert.match(result.reason, /DOI.*不一致/u)
  assert.equal(result.matches[0].hasPdf, true)
})

test("multiple identifier matches and identifier-plus-title matches never choose one record automatically", () => {
  const duplicate = local({ paper_id: "Zhang24-Another" })
  const result = match(online(), [local(), duplicate])
  assert.equal(result.status, "possible_match")
  assert.deepEqual(result.matches.map(({ paperId }) => paperId), ["Zhang24-Example", "Zhang24-Another"])
  assert.match(result.reason, /多条/u)
  assert.equal(match(online(), [local(), { ...duplicate, doi_or_url: "" }]).status, "possible_match")
})

test("missing or unknown identifiers cannot match each other and unsupported titles are not guessed", () => {
  const work = online({ doi: null, title: "Not Reported", authors: [], year: null })
  const result = match(work, [local({ doi_or_url: "unknown", title_original: "Not Reported", publication_year: null, year: null, authors: [] })])
  assert.deepEqual(result.matches, [])
  assert.equal(result.status, "not_found")
  assert.equal(match(online({ doi: null, title: "Optimization theory", authors: [], year: null }), [local({ title_original: "Optimization theory", doi_or_url: "", authors: [], publication_year: null, year: null })]).status, "not_found")
  assert.equal(match(online(), []).status, "not_found")
})

test("unsafe or ambiguous DOI locators are never shortened into a definite identifier", () => {
  const invalid = [
    "https://doi.org/10.1234/example.2024?download=1", "https://doi.org/10.1234/example.2024#section",
    "10.1234/example.2024?x=1", "https://doi.org.evil.example/10.1234/example.2024",
    "https://user:pass@doi.org/10.1234/example.2024", "https://doi.org:8443/10.1234/example.2024",
    "https://doi.org/10.1234/other/../example.2024", "https://doi.org/10.1234/%65xample.2024",
    "https://example.org/?doi=10.1234/example.2024", "10.1234/example.2024\n",
  ]
  for (const doi_or_url of invalid) {
    const result = match(online(), [local({ doi_or_url, title_original: "Unrelated study of plant communities" })])
    assert.equal(result.status, "not_found", doi_or_url)
  }
})

test("OpenAlex parameters, credentials and similar local ids do not manufacture shared identity", () => {
  for (const doi_or_url of ["https://openalex.org/W123456789?x=1", "https://user@openalex.org/W123456789", "https://openalex.org.evil.example/W123456789"]) {
    assert.equal(match(online({ doi: null }), [local({ doi_or_url, title_original: "Unrelated study of plant communities" })]).status, "not_found")
  }
  assert.equal(match(online({ doi: null }), [local({ paper_id: "OA-W123456789", doi_or_url: "", title_original: "Unrelated study of plant communities" })]).status, "not_found")
})

test("invalid ids cannot enter links and matching does not mutate either input or expose source paths", () => {
  const work = Object.freeze(online())
  const record = Object.freeze(local({ source_path: "/private/not-for-links" }))
  const records = Object.freeze([record, local({ paper_id: "../escape" }), local({ paper_id: 'Bad-01\" onclick=\"alert(1)' })])
  const before = JSON.stringify({ work, records })
  const result = match(work, records)
  assert.equal(result.status, "existing_pdf")
  assert.equal(result.matches.length, 1)
  assert.equal(JSON.stringify({ work, records }), before)
  assert.doesNotMatch(JSON.stringify(result), /source_path|not-for-links|onclick|escape/u)
  result.matches[0].title = "Edited result label"
  assert.equal(record.title_original, "Distributed optimization over directed communication networks")
})

test("an unloaded local index is rejected rather than reported as a completed empty search", () => {
  for (const papers of [null, undefined, {}]) assert.throws(() => match(online(), papers), TypeError)
})

test("note availability means indexed material and remains independent of a readable PDF", () => {
  for (const patch of [{ artifacts: { note: [{ relative_path: '/private/note.md' }] } }, { artifact_availability: { note: true } }]) {
    const result = match(online(), [local({ ...patch, source_documents: { pdf: [] } })])
    assert.equal(result.status, 'missing_pdf')
    assert.equal(result.matches[0].hasNote, true)
    assert.equal(result.matches[0].hasPdf, false)
    assert.doesNotMatch(JSON.stringify(result), /private|quality|质量/)
  }
  for (const patch of [{}, { artifacts: { note: [] } }, { note_status: 'notes_ready', note_preview_url: 'note.html' }]) {
    assert.equal(match(online(), [local(patch)]).matches[0].hasNote, false)
  }
})

test("same DOI plus an obviously unrelated original title remains a possible match despite PDF availability", () => {
  const result = match(online(), [local({ title_original: 'Seasonal migration patterns of tropical birds' })])
  assert.equal(result.status, 'possible_match')
  assert.equal(result.matches[0].hasPdf, true)
  assert.match(result.reason, /DOI.*题名.*冲突/)
})

test("subtitle containment, translations, placeholders and year-only differences do not contradict a shared DOI", () => {
  for (const patch of [
    { title_original: online().title + ': A new approach' },
    { title_original: '有向通信网络上的分布式优化' },
    { title_original: 'Unrelated original title', title_en: online().title },
    { title_original: 'Not Reported' }, { title_original: 'N/A' },
    { year: 2023, publication_year: 2023 },
  ]) assert.equal(match(online(), [local(patch)]).status, 'existing_pdf', JSON.stringify(patch))
})

test("an unrelated Han translation cannot erase an affirmative same-script DOI title conflict", () => {
  const bilingual = local({ title_original: 'Seasonal migration patterns of tropical birds',
    title_zh: '热带鸟类的季节性迁徙模式' })
  assert.equal(match(online(), [bilingual]).status, 'possible_match')
  assert.equal(match(online(), [{ ...bilingual, title_en: 'Local paper' }]).status, 'possible_match')
  assert.equal(match(online(), [{ ...bilingual, title_en: online().title }]).status, 'existing_pdf')
  assert.equal(match(online(), [{ ...bilingual, title_en: `${online().title}: Convergence results` }]).status, 'existing_pdf')
  assert.equal(match(online(), [{ ...bilingual, title_original: '' }]).status, 'existing_pdf')
})

test("a nonmatching Latin variant with generic overlap cannot erase an independent DOI title contradiction", () => {
  const record = local({ title_original: 'Seasonal migration patterns of tropical birds',
    title_zh: '热带鸟类的季节性迁徙模式', title_en: 'Distributed ecology of tropical forests' })
  const result = match(online(), [record])
  assert.equal(result.status, 'possible_match')
  assert.equal(result.matches[0].hasPdf, true)
  assert.match(result.reason, /DOI.*题名.*冲突/)
  for (const title_en of [online().title, `${online().title}: A new approach`,
    'Distributed optimization methods over directed communication networks']) {
    assert.equal(match(online(), [{ ...record, title_en }]).status, 'existing_pdf')
  }
})
