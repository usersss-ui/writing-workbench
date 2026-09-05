import test from "node:test"
import assert from "node:assert/strict"
import {
  classifyDiscoveryScope,
  isValidDiscoveryRecord,
  normalizeDiscoveryRecord,
} from "./discovery-record.mjs"
import { normalizeDoi, safeHttpsUrl } from "./openalex-search.mjs"
import { deferred, memoryStorage, recordInput } from "./discovery-test-fixtures.mjs"

function withBibliography(patch = {}) {
  const base = recordInput().bibliography
  return recordInput({ bibliography: { ...base, ...patch } })
}

function withJournal(patch = {}) {
  const base = recordInput().bibliography
  return withBibliography({ journal: { ...base.journal, ...patch } })
}

function withProvenance(patch = {}) {
  return recordInput({ provenance: { ...recordInput().provenance, ...patch } })
}

function withRetraction(patch = {}) {
  return recordInput({ retraction: { ...recordInput().retraction, ...patch } })
}

function objectWithGetter(base, key, getter) {
  const descriptors = Object.getOwnPropertyDescriptors(base)
  descriptors[key] = { enumerable: true, configurable: true, get: getter }
  return Object.defineProperties({}, descriptors)
}

test("normalizes an exact source record without manufacturing unknown metadata", () => {
  const record = normalizeDiscoveryRecord(recordInput())

  assert.deepEqual(record, recordInput())
  assert.equal(record.bibliography.citations, null)
  assert.equal(record.bibliography.language, null)
  assert.equal(record.bibliography.work_type, null)
  assert.equal(isValidDiscoveryRecord(record), true)
  assert.notEqual(record, recordInput())
})

test("accepts canonical exact records regardless of object insertion order", () => {
  const base = normalizeDiscoveryRecord(recordInput())
  const reordered = {
    retraction: { checked_at: base.retraction.checked_at, source_url: base.retraction.source_url, state: base.retraction.state },
    provenance: {
      verification: base.provenance.verification,
      public_url: base.provenance.public_url,
      retrieved_at: base.provenance.retrieved_at,
      import_id: base.provenance.import_id,
      query_id: base.provenance.query_id,
      batch_id: base.provenance.batch_id,
      method: base.provenance.method,
      provider: base.provenance.provider,
    },
    bibliography: {
      citations: base.bibliography.citations,
      journal: {
        source_type: base.bibliography.journal.source_type,
        issns: base.bibliography.journal.issns,
        source_id: base.bibliography.journal.source_id,
        title: base.bibliography.journal.title,
      },
      work_type: base.bibliography.work_type,
      language: base.bibliography.language,
      abstract: base.bibliography.abstract,
      url: base.bibliography.url,
      doi: base.bibliography.doi,
      year: base.bibliography.year,
      authors: base.bibliography.authors,
      title: base.bibliography.title,
    },
    provider_id: base.provider_id,
    record_id: base.record_id,
  }

  assert.equal(isValidDiscoveryRecord(reordered), true)
})

test("normalizes bounded descriptive metadata while retaining author multiplicity and unknown values", () => {
  const record = normalizeDiscoveryRecord(withBibliography({
    title: "  A   bounded title  ",
    authors: ["  Alice   Example  ", "Alice Example", "Bob Example"],
    abstract: "  A   bounded abstract.  ",
    language: " FR ",
    work_type: " proceedings-article ",
    journal: {
      title: " Example Journal ",
      source_id: "S-1",
      issns: ["0254-4156", "1234-567X", "0254-4156"],
      source_type: " journal ",
    },
  }))

  assert.equal(record.bibliography.title, "A bounded title")
  assert.equal(record.bibliography.abstract, "A bounded abstract.")
  assert.deepEqual(record.bibliography.authors, ["Alice Example", "Alice Example", "Bob Example"])
  assert.equal(record.bibliography.language, "fr")
  assert.equal(record.bibliography.work_type, "proceedings-article")
  assert.equal(record.bibliography.journal.title, "Example Journal")
  assert.deepEqual(record.bibliography.journal.issns, ["0254-4156", "1234-567X"])
  assert.equal(record.bibliography.journal.source_type, "journal")
})

test("accepts exact metadata boundaries and rejects values one step over each limit", () => {
  const boundary = normalizeDiscoveryRecord(withBibliography({
    title: "T".repeat(1_000),
    abstract: "A".repeat(20_000),
    authors: Array.from({ length: 50 }, (_, index) => index === 0 ? "N".repeat(300) : `Author ${index}`),
    url: `https://example.org/${"u".repeat(2_028)}`,
    journal: {
      ...recordInput().bibliography.journal,
      title: "J".repeat(500),
      issns: Array.from({ length: 10 }, (_, index) => `1234-56${String(index).padStart(2, "0")}`),
    },
  }))
  assert.equal([...boundary.bibliography.title].length, 1_000)
  assert.equal([...boundary.bibliography.abstract].length, 20_000)
  assert.equal(boundary.bibliography.authors.length, 50)
  assert.equal([...boundary.bibliography.authors[0]].length, 300)
  assert.equal([...boundary.bibliography.journal.title].length, 500)
  assert.equal(boundary.bibliography.journal.issns.length, 10)
  assert.equal(boundary.bibliography.url.length, 2_048)

  const invalid = [
    withBibliography({ title: "T".repeat(1_001) }),
    withBibliography({ title: `A${" ".repeat(999)}B` }),
    withBibliography({ abstract: "A".repeat(20_001) }),
    withBibliography({ abstract: `A${" ".repeat(19_999)}B` }),
    withBibliography({ authors: ["N".repeat(301)] }),
    withBibliography({ authors: [`A${" ".repeat(299)}B`] }),
    withBibliography({ authors: Array.from({ length: 51 }, (_, index) => `Author ${index}`) }),
    withBibliography({ url: `https://example.org/${"u".repeat(2_029)}` }),
    withBibliography({ url: 3 }),
    withJournal({ title: "J".repeat(501) }),
    withJournal({ title: `A${" ".repeat(499)}B` }),
  ]
  for (const value of invalid) assert.throws(() => normalizeDiscoveryRecord(value), TypeError)
})

test("normalizes DOI case and preserves zero citations distinctly from missing citations", () => {
  const zero = normalizeDiscoveryRecord(withBibliography({
    doi: " HTTPS://DOI.ORG/10.1234/FIXTURE.1 ",
    citations: {
      count: 0,
      provider: "OpenAlex",
      retrieved_at: "2026-09-05T00:00:00.000Z",
    },
  }))

  assert.equal(zero.bibliography.doi, "10.1234/fixture.1")
  assert.deepEqual(zero.bibliography.citations, {
    count: 0,
    provider: "OpenAlex",
    retrieved_at: "2026-09-05T00:00:00.000Z",
  })
  assert.equal(normalizeDiscoveryRecord(recordInput()).bibliography.citations, null)
})

test("shared DOI and public URL exports retain their existing behavioral normalization", () => {
  assert.equal(normalizeDoi(" DOI:10.1109/ABC.123 "), "10.1109/abc.123")
  assert.equal(safeHttpsUrl(" https://example.org/paper?a=1 "), "https://example.org/paper?a=1")
  assert.equal(safeHttpsUrl("https://reader:secret@example.org/paper"), null)
  assert.equal(safeHttpsUrl("https://example.org/paper?api%255Fkey=secret"), null)
})

test("drops unsafe optional public URLs without retaining credentials or encoded credential keys", () => {
  const record = normalizeDiscoveryRecord(withBibliography({
    url: "https://reader:secret@example.org/paper",
  }))
  const encoded = normalizeDiscoveryRecord(withProvenance({
    public_url: "https://example.org/paper?oauth%255Ftoken=secret",
  }))
  const retraction = normalizeDiscoveryRecord(withRetraction({
    source_url: "https://example.org/paper#access_token=secret",
  }))

  assert.equal(record.bibliography.url, null)
  assert.equal(encoded.provenance.public_url, null)
  assert.equal(retraction.retraction.source_url, null)
})

test("rejects malformed identities instead of truncating or silently changing them", () => {
  const invalid = [
    recordInput({ record_id: " r-1 " }),
    recordInput({ record_id: "" }),
    recordInput({ provider_id: "provider\nid" }),
    withProvenance({ batch_id: "x".repeat(2_049) }),
    withBibliography({ doi: "10.1234/../../admin" }),
    withJournal({ source_id: " source-1 " }),
    withJournal({ issns: ["not-an-issn"] }),
    withJournal({ issns: Array.from({ length: 11 }, (_, index) => `1234-56${index % 10}${index % 2 ? "X" : "0"}`) }),
  ]

  for (const value of invalid) {
    assert.throws(() => normalizeDiscoveryRecord(value), TypeError)
    assert.equal(isValidDiscoveryRecord(value), false)
  }
})

test("rejects extra fields, dangerous keys, non-plain nested objects, and accessors without invoking them", () => {
  let getterCalls = 0
  const getterBibliography = objectWithGetter(recordInput().bibliography, "title", () => {
    getterCalls += 1
    return "must not be read"
  })
  const dangerous = recordInput()
  Object.defineProperty(dangerous.provenance, "__proto__", {
    value: "polluted",
    enumerable: true,
  })
  const inherited = Object.assign(Object.create({ hidden: true }), recordInput().retraction)
  const invalid = [
    { ...recordInput(), extra: true },
    withBibliography({ extra: true }),
    withJournal({ prototype: "dangerous" }),
    withProvenance({ constructor: "dangerous" }),
    dangerous,
    recordInput({ retraction: inherited }),
    recordInput({ bibliography: getterBibliography }),
  ]

  for (const value of invalid) {
    assert.throws(() => normalizeDiscoveryRecord(value), TypeError)
    assert.equal(isValidDiscoveryRecord(value), false)
  }
  assert.equal(getterCalls, 0)
})

test("rejects accessors in author and ISSN arrays without invoking them", () => {
  let getterCalls = 0
  const authors = ["Example Author"]
  Object.defineProperty(authors, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1
      return "Getter Author"
    },
  })
  const issns = ["0254-4156"]
  Object.defineProperty(issns, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1
      return "0254-4156"
    },
  })

  assert.throws(() => normalizeDiscoveryRecord(withBibliography({ authors })), TypeError)
  assert.throws(() => normalizeDiscoveryRecord(withJournal({ issns })), TypeError)
  assert.equal(getterCalls, 0)
})

test("rejects invalid scalar, timestamp, citation, and enumeration values", () => {
  const invalid = [
    withBibliography({ title: " \n " }),
    withBibliography({ authors: ["valid", 3] }),
    withBibliography({ year: 999 }),
    withBibliography({ year: 10_000 }),
    withBibliography({ year: 2024.5 }),
    withBibliography({ citations: { count: -1, provider: "OpenAlex", retrieved_at: "2026-09-05T00:00:00.000Z" } }),
    withBibliography({ citations: { count: 1, provider: "OpenAlex", retrieved_at: "yesterday" } }),
    withProvenance({ provider: "unknown-provider" }),
    withProvenance({ method: "scrape" }),
    withProvenance({ verification: "guessed" }),
    withProvenance({ retrieved_at: "2026-09-05" }),
    withRetraction({ state: "clear" }),
    withRetraction({ checked_at: "not-a-date" }),
  ]

  for (const value of invalid) assert.throws(() => normalizeDiscoveryRecord(value), TypeError)
})

test("classifies retraction first, known mismatches second, missing comparisons third, and matches last", () => {
  const clear = normalizeDiscoveryRecord(withRetraction({
    state: "screened_clear",
    source_url: "https://example.org/retraction-check/r-1",
    checked_at: "2026-09-05T00:00:00.000Z",
  }))
  const retracted = normalizeDiscoveryRecord(withRetraction({
    state: "retracted",
    source_url: "https://example.org/retractions/r-1",
    checked_at: "2026-09-05T00:00:00.000Z",
  }))

  assert.deepEqual(
    classifyDiscoveryScope(retracted, { startYear: 2025, endYear: 2026, language: "zh" }),
    { status: "excluded", reasons: ["retracted"] },
  )
  assert.deepEqual(
    classifyDiscoveryScope(clear, { startYear: 2025, endYear: 2026, language: "zh" }),
    { status: "excluded", reasons: ["year_before_start"] },
  )
  assert.deepEqual(
    classifyDiscoveryScope(normalizeDiscoveryRecord(recordInput()), { startYear: null, endYear: null, language: "zh" }),
    { status: "pending", reasons: ["language_unknown", "retraction_unknown"] },
  )
  assert.deepEqual(
    classifyDiscoveryScope(clear, { startYear: null, endYear: null, language: "all" }),
    { status: "included", reasons: [] },
  )
})

test("scope checks only requested metadata and never treats pending as included", () => {
  const unknown = normalizeDiscoveryRecord(withBibliography({ year: null, language: null }))
  const clearUnknown = normalizeDiscoveryRecord({
    ...withBibliography({ year: null, language: null }),
    retraction: {
      state: "screened_clear",
      source_url: "https://example.org/retraction-check/r-1",
      checked_at: "2026-09-05T00:00:00.000Z",
    },
  })

  assert.equal(classifyDiscoveryScope(unknown, { startYear: null, endYear: null, language: "all" }).status, "pending")
  assert.deepEqual(
    classifyDiscoveryScope(clearUnknown, { startYear: null, endYear: null, language: "all" }),
    { status: "included", reasons: [] },
  )
  assert.deepEqual(
    classifyDiscoveryScope(clearUnknown, { startYear: 2020, endYear: null, language: "all" }),
    { status: "pending", reasons: ["year_unknown"] },
  )
  assert.deepEqual(
    classifyDiscoveryScope(clearUnknown, { startYear: null, endYear: null, language: "en" }),
    { status: "pending", reasons: ["language_unknown"] },
  )
})

test("validates the exact scope shape before classification", () => {
  const record = normalizeDiscoveryRecord(recordInput())
  for (const scope of [
    { startYear: null, endYear: null, language: "all", extra: true },
    { startYear: 2020, endYear: 2019, language: "all" },
    { startYear: "2020", endYear: null, language: "all" },
    { startYear: null, endYear: null, language: "fr" },
  ]) assert.throws(() => classifyDiscoveryScope(record, scope), TypeError)
})

test("fixture helpers provide isolated records, Web Storage behavior, and controllable promises", async () => {
  const first = recordInput()
  first.bibliography.authors.push("Mutated")
  assert.deepEqual(recordInput().bibliography.authors, ["Example Author"])

  const storage = memoryStorage([["existing", "1"]])
  assert.equal(storage.getItem("existing"), "1")
  assert.equal(storage.getItem("missing"), null)
  storage.setItem("number", 2)
  assert.equal(storage.getItem("number"), "2")
  storage.removeItem("existing")
  assert.equal(storage.getItem("existing"), null)

  const operation = deferred()
  operation.resolve("ready")
  assert.equal(await operation.promise, "ready")
})
