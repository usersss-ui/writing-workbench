import test from "node:test"
import assert from "node:assert/strict"
import {
  ARCHIVE_METADATA_FILE,
  ARCHIVE_METADATA_MAX_BYTES,
  parseArchiveMetadata,
  serializeArchiveMetadata,
} from "./archive-metadata.mjs"

const CANDIDATE = Object.freeze({
  paperId: "W4387886124",
  doi: "10.1109/access.2023.3327199",
  title: "Distributed Interval Optimization Over Time-Varying Networks",
  authors: Object.freeze(["Yinghui Wang", "Jiuwei Wang"]),
  year: 2023,
  source: "IEEE Access",
  citations: 12,
  isOpenAccess: true,
  openAccessUrl: "https://example.org/open-paper",
  landingPageUrl: "https://doi.org/10.1109/access.2023.3327199",
  topics: Object.freeze(["Distributed optimization"]),
  abstract: "Source-provided discovery text that is not archive metadata.",
  stage: "confirmed_for_archive",
})

function serialize(overrides = {}) {
  return serializeArchiveMetadata({
    paperId: "Wang23-DIO",
    archiveSourceId: "main_papers",
    candidate: { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    archivedAt: "2026-08-30T04:05:06.000Z",
    ...overrides,
  })
}

test("archive metadata has one fixed filename, byte limit, and deterministic approved-field serialization", () => {
  assert.equal(ARCHIVE_METADATA_FILE, "metadata.yaml")
  assert.equal(ARCHIVE_METADATA_MAX_BYTES, 8_000)
  const expected = [
    "paper_id: Wang23-DIO",
    "title: \"Distributed Interval Optimization Over Time-Varying Networks\"",
    "authors:",
    "  - \"Yinghui Wang\"",
    "  - \"Jiuwei Wang\"",
    "year: 2023",
    "venue: \"IEEE Access\"",
    "doi: \"10.1109/access.2023.3327199\"",
    "unit_type: article",
    "archive_mode: metadata_only",
    "archive_source_id: main_papers",
    "candidate_source: openalex",
    "openalex_id: W4387886124",
    "archived_at: \"2026-08-30T04:05:06.000Z\"",
    "",
  ].join("\n")

  assert.equal(serialize(), expected)
  assert.equal(serialize(), expected)
  for (const excluded of ["abstract", "citations", "stage", "openAccessUrl", "landingPageUrl", "topics"]) {
    assert.equal(expected.includes(excluded), false)
  }
  assert.ok(Buffer.byteLength(expected, "utf8") <= ARCHIVE_METADATA_MAX_BYTES)
})

test("DOI-less metadata stores only the canonical OpenAlex landing URL", () => {
  const text = serialize({
    candidate: { ...CANDIDATE, doi: null, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
  })
  assert.match(text, /^url: "https:\/\/openalex\.org\/W4387886124"$/mu)
  assert.doesNotMatch(text, /^doi:/mu)
})

test("safe parsing returns only bibliographic metadata and provider-qualified private identity", () => {
  assert.deepEqual(parseArchiveMetadata(serialize()), {
    metadata: {
      paper_id: "Wang23-DIO",
      title_original: "Distributed Interval Optimization Over Time-Varying Networks",
      authors: ["Yinghui Wang", "Jiuwei Wang"],
      year: 2023,
      venue: "IEEE Access",
      doi_or_url: "10.1109/access.2023.3327199",
      unit_type: "article",
    },
    archive_source_id: "main_papers",
    candidate_source: "openalex",
    openalex_id: "W4387886124",
    archive_identity: "openalex:W4387886124",
    archived_at: "2026-08-30T04:05:06.000Z",
  })
})

test("serialization and parsing reject controls, paths, ambiguous IDs, and malformed identities", () => {
  for (const options of [
    { paperId: "../Wang23-DIO" },
    { archiveSourceId: "../main_papers" },
    { archiveSourceId: "/main_papers" },
    { archiveSourceId: "main\\papers" },
    { candidate: { ...CANDIDATE, paperId: "4387886124", authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] } },
    { candidate: { ...CANDIDATE, doi: "not-a-doi", authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] } },
    { candidate: { ...CANDIDATE, title: "unsafe\u0000title", authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] } },
    { archivedAt: "2026-08-30" },
  ]) {
    assert.throws(() => serialize(options), /元数据|格式|路径|身份|时间|字段/u)
  }
})

test("DOI validation rejects traversal, backslashes, and empty path segments", () => {
  for (const doi of [
    "10.1234/../paper",
    "10.1234/path/./paper",
    "10.1234/path//paper",
    "10.1234/path\\paper",
  ]) {
    assert.throws(() => serialize({
      candidate: { ...CANDIDATE, doi, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    }), /元数据|DOI|格式/u)
  }
})

test("candidate URLs reject local hosts, IP literals, fragments, and credential-like query keys", () => {
  const credentialKey = ["access", "token"].join("_")
  const unsafeUrls = [
    "https://localhost/paper",
    "https://127.0.0.1/paper",
    "https://10.0.0.1/paper",
    "https://example.org/paper#section",
    `https://example.org/paper?${credentialKey}=value`,
  ]
  for (const unsafeUrl of unsafeUrls) {
    for (const field of ["landingPageUrl", "openAccessUrl"]) {
      assert.throws(() => serialize({
        candidate: {
          ...CANDIDATE,
          authors: [...CANDIDATE.authors],
          topics: [...CANDIDATE.topics],
          [field]: unsafeUrl,
        },
      }), /元数据|字段|格式/u)
    }
  }
})

test("candidate exact-object validation rejects symbols, hidden properties, and accessors without invoking getters", () => {
  const withSymbol = { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] }
  withSymbol[Symbol("extra")] = "value"
  assert.throws(() => serialize({ candidate: withSymbol }), /元数据|字段|格式/u)

  const withHidden = { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] }
  Object.defineProperty(withHidden, "hidden", { value: "value", enumerable: false })
  assert.throws(() => serialize({ candidate: withHidden }), /元数据|字段|格式/u)

  let getterCalls = 0
  const withAccessor = { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] }
  Object.defineProperty(withAccessor, "paperId", {
    enumerable: true,
    get() { getterCalls += 1; return "W4387886124" },
  })
  assert.throws(() => serialize({ candidate: withAccessor }), /元数据|字段|格式/u)
  assert.equal(getterCalls, 0)
})

test("parser enforces serializer field limits instead of one generic scalar limit", () => {
  const valid = serialize()
  for (const invalid of [
    valid.replace('title: "Distributed Interval Optimization Over Time-Varying Networks"', `title: "${"t".repeat(1_001)}"`),
    valid.replace('venue: "IEEE Access"', `venue: "${"v".repeat(501)}"`),
    valid.replace('doi: "10.1109/access.2023.3327199"', `doi: "10.1234/${"d".repeat(505)}"`),
  ]) {
    assert.throws(() => parseArchiveMetadata(invalid), /元数据|字段|大小|格式/u)
  }
})

test("metadata text rejects line separators, replacement characters, and isolated surrogates", () => {
  for (const unsafeText of ["bad\u2028title", "bad\u2029title", "bad\uFFFDtitle", "bad\uD800title", "bad\uDC00title"]) {
    assert.throws(() => serialize({
      candidate: { ...CANDIDATE, title: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    }), /元数据|字段|格式/u)
    const invalid = serialize().replace("Distributed Interval Optimization Over Time-Varying Networks", unsafeText)
    assert.throws(() => parseArchiveMetadata(invalid), /元数据|字段|控制|格式/u)
  }
})

test("parser rejects unknown or duplicate keys and YAML structure tricks", () => {
  const valid = serialize()
  const invalidDocuments = [
    `${valid}query: "hidden"\n`,
    `${valid}paper_id: Other23-Paper\n`,
    valid.replace('title: "Distributed', 'title: &shared "Distributed'),
    valid.replace('title: "Distributed Interval Optimization Over Time-Varying Networks"', "title: |\n  folded"),
    valid.replace('venue: "IEEE Access"', 'venue: !str "IEEE Access"'),
    valid.replace("authors:", "authors: { first: Author }"),
    valid.replace("archive_mode: metadata_only", "__proto__: metadata_only"),
  ]
  for (const text of invalidDocuments) assert.throws(() => parseArchiveMetadata(text), /元数据|字段|YAML|重复/u)
})

test("parser rejects invalid UTF-8-shaped text, controls, and over-limit documents", () => {
  assert.throws(() => parseArchiveMetadata(`${serialize()}\u0000`), /元数据|控制/u)
  assert.throws(() => parseArchiveMetadata(`${serialize()}${"x".repeat(ARCHIVE_METADATA_MAX_BYTES)}`), /大小|上限/u)
  assert.throws(() => parseArchiveMetadata(Buffer.from(serialize())), /字符串/u)
})

test("round trip preserves local, source, DOI, and OpenAlex identity without adding fields", () => {
  const first = parseArchiveMetadata(serialize())
  const second = parseArchiveMetadata(serialize({
    paperId: first.metadata.paper_id,
    archiveSourceId: first.archive_source_id,
    candidate: { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    archivedAt: first.archived_at,
  }))
  assert.deepEqual(second, first)
  assert.deepEqual(Object.keys(second).sort(), [
    "archive_identity",
    "archive_source_id",
    "archived_at",
    "candidate_source",
    "metadata",
    "openalex_id",
  ])
})
