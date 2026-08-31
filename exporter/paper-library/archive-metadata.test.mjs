import test from "node:test"
import assert from "node:assert/strict"
import {
  ARCHIVE_METADATA_FILE,
  ARCHIVE_METADATA_MAX_BYTES,
  ARCHIVE_COMMIT_FILE,
  ARCHIVE_COMMIT_MAX_BYTES,
  archiveMetadataSha256,
  parseArchiveCommit,
  parseArchiveMetadata,
  serializeArchiveCommit,
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

test("archive commit marker binds one exact metadata payload with a fixed private format", () => {
  const metadata = serialize()
  const marker = serializeArchiveCommit(metadata)
  assert.equal(ARCHIVE_COMMIT_FILE, ".metadata.commit")
  assert.equal(ARCHIVE_COMMIT_MAX_BYTES, 72)
  assert.equal(Buffer.byteLength(marker, "utf8"), ARCHIVE_COMMIT_MAX_BYTES)
  assert.equal(parseArchiveCommit(marker), archiveMetadataSha256(metadata))
  for (const invalid of [marker.toUpperCase(), marker.slice(0, -1), `${marker}x`, `sha256:${"0".repeat(64)} `]) {
    assert.throws(() => parseArchiveCommit(invalid), /提交标记|格式/u)
  }
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

test("metadata text rejects bidi spoofing, zero-width space, internal BOM, and noncharacters", () => {
  const unsafeCodePoints = [
    0x0085, 0x00ad, 0x0600, 0x061c, 0x070f, 0x180e,
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x200e, 0x200f,
    0x2066, 0x2067, 0x2068, 0x2069,
    0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xfffe, 0xffff, 0xe0001,
  ]
  for (const codePoint of unsafeCodePoints) {
    const unsafeText = `safe${String.fromCodePoint(codePoint)}text`
    assert.throws(() => serialize({
      candidate: { ...CANDIDATE, title: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    }), /元数据|字段|控制|格式/u)
    const invalid = serialize().replace(CANDIDATE.title, unsafeText)
    assert.throws(() => parseArchiveMetadata(invalid), /元数据|字段|控制|格式/u)
  }
})

test("serializer and parser reject obvious private locators in every public free bibliographic field", () => {
  const unsafeLocators = [
    ["", "Users", "researcher", "paper.pdf"].join("/"),
    ["~", "notes", "paper.md"].join("/"),
    ["file:", "", "private", "source.pdf"].join("/"),
    ["C:", "Users", "researcher", "document.txt"].join("\\"),
    ["", "", "server", "share", "paper.pdf"].join("\\"),
    ["..", "private-paper.pdf"].join("/"),
    ["notes", "paper.pdf"].join("/"),
    `Results loaded from ${["", "etc", "passwd"].join("/")} for evaluation`,
    `Results loaded from ${["", "opt", "private", "paper.pdf"].join("/")} for evaluation`,
    `See ${[".", "private", "paper.md"].join("/")} for details`,
    `See:${["", "etc", "passwd"].join("/")}`,
    `path=${["", "opt", "private", "data"].join("/")}`,
    `Read[${["", "home", "person", "paper"].join("/")}]`,
    `Location:${["C:", "Users", "person", "paper"].join("\\")}`,
    `UNC=${["", "", "server", "share", "folder"].join("\\")}`,
    ...[")", ",", ";", "|", "]", "}"].map((punctuation) => `See${punctuation}${["", "etc", "passwd"].join("/")}`),
    ["private", "notes", "research"].join("/"),
    ["folder", "private"].join("/"),
    ["papers", "2024", "W4387886124"].join("/"),
    ["relative", "path"].join("/"),
  ]
  const valid = serialize()

  for (const locator of unsafeLocators) {
    for (const candidate of [
      { ...CANDIDATE, title: locator, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, authors: [locator], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, source: locator, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ]) {
      assert.throws(() => serialize({ candidate }), /元数据|字段|路径|定位/u)
    }

    for (const document of [
      valid.replace(`title: ${JSON.stringify(CANDIDATE.title)}`, `title: ${JSON.stringify(locator)}`),
      valid.replace(`  - ${JSON.stringify(CANDIDATE.authors[0])}`, `  - ${JSON.stringify(locator)}`),
      valid.replace(`venue: ${JSON.stringify(CANDIDATE.source)}`, `venue: ${JSON.stringify(locator)}`),
    ]) {
      assert.throws(() => parseArchiveMetadata(document), /元数据|字段|路径|定位/u)
    }
  }
})

test("serializer and parser reject compact bare credential assignments in public bibliographic text", () => {
  const keys = [
    ["api", "key"].join("_"),
    ["access", "key"].join("_"),
    ["auth", "token"].join("_"),
    ["pass", "word"].join(""),
    ["client", "secret"].join("_"),
  ]
  const marker = ["hidden", "marker"].join("-")
  const valid = serialize()
  for (const key of keys) {
    const unsafeText = `Replication ${key}=${marker}`
    for (const candidate of [
      { ...CANDIDATE, title: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, authors: [unsafeText], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, source: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ]) assert.throws(() => serialize({ candidate }), /元数据|字段|凭据|格式/u)

    for (const document of [
      valid.replace(`title: ${JSON.stringify(CANDIDATE.title)}`, `title: ${JSON.stringify(unsafeText)}`),
      valid.replace(`  - ${JSON.stringify(CANDIDATE.authors[0])}`, `  - ${JSON.stringify(unsafeText)}`),
      valid.replace(`venue: ${JSON.stringify(CANDIDATE.source)}`, `venue: ${JSON.stringify(unsafeText)}`),
    ]) assert.throws(() => parseArchiveMetadata(document), /元数据|字段|凭据|格式/u)
  }

  const spacedCredentials = [
    `Replication ${["api", "key"].join("_")} = ${marker}`,
    `Replication ${["access", "token"].join("_")} : ${marker}`,
    `Replication ${JSON.stringify(["client", "secret"].join("_"))}: ${JSON.stringify(marker)}`,
    `${["Authori", "zation"].join("")}: ${["Bear", "er"].join("")} ${marker}`,
    `Replication ${["api", "key"].join(" ")} = ${marker}`,
    `Replication ${["private", "key"].join(" ")}: ${marker}`,
    `Replication ${["secret", "key"].join(" ")} = ${marker}`,
    `${["api", "key"].join("_")}=x`,
    `${["access", "token"].join("_")}:ab`,
    `${["to", "ken"].join("")}=abc`,
    `${["pass", "word"].join("")}=123`,
    `${["sec", "ret"].join("")}=xyz`,
    `${["api", "key"].join("_")}=`,
  ]
  for (const unsafeText of spacedCredentials) {
    for (const candidate of [
      { ...CANDIDATE, title: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, authors: [unsafeText], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, source: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ]) assert.throws(() => serialize({ candidate }), /元数据|字段|凭据|格式/u)

    for (const document of [
      valid.replace(`title: ${JSON.stringify(CANDIDATE.title)}`, `title: ${JSON.stringify(unsafeText)}`),
      valid.replace(`  - ${JSON.stringify(CANDIDATE.authors[0])}`, `  - ${JSON.stringify(unsafeText)}`),
      valid.replace(`venue: ${JSON.stringify(CANDIDATE.source)}`, `venue: ${JSON.stringify(unsafeText)}`),
    ]) assert.throws(() => parseArchiveMetadata(document), /元数据|字段|凭据|格式/u)
  }

  const scholarly = "Shared-secret = latent variable in the proof"
  assert.doesNotThrow(() => serialize({
    candidate: { ...CANDIDATE, title: scholarly, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
  }))
})

test("serializer and parser repeatedly decode bibliographic percent escapes before privacy validation", () => {
  const credentialKey = ["api", "key"].join("_")
  const encodedCredentialKey = ["api", "key"].join("%5F")
  const hiddenMarker = ["hidden", "marker"].join("-")
  const unsafeTexts = [
    "Reference file%3A%2F%2F%2Fprivate%2Fpaper.pdf",
    "See .%2Fprivate%2Fpaper.md for details",
    `Paper https%3A%2F%2Fexample.org%2Fview%3F${credentialKey}%3D${hiddenMarker}`,
    `Replication ${encodedCredentialKey}=${hiddenMarker}`,
    "Reference file%253A%252F%252F%252Fprivate%252Fpaper.pdf",
    "Malformed %E0%A4%A locator",
    "Deep file%252525253A%252525252F%252525252F%252525252Fprivate%252525252Fpaper.pdf",
  ]
  const valid = serialize()

  for (const unsafeText of unsafeTexts) {
    for (const candidate of [
      { ...CANDIDATE, title: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, authors: [unsafeText], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, source: unsafeText, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ]) assert.throws(() => serialize({ candidate }), /元数据|字段|路径|定位|凭据|编码/u)

    for (const document of [
      valid.replace(`title: ${JSON.stringify(CANDIDATE.title)}`, `title: ${JSON.stringify(unsafeText)}`),
      valid.replace(`  - ${JSON.stringify(CANDIDATE.authors[0])}`, `  - ${JSON.stringify(unsafeText)}`),
      valid.replace(`venue: ${JSON.stringify(CANDIDATE.source)}`, `venue: ${JSON.stringify(unsafeText)}`),
    ]) assert.throws(() => parseArchiveMetadata(document), /元数据|字段|路径|定位|凭据|编码/u)
  }

  for (const ordinary of ["95% confidence intervals", "Accuracy improved by 10% in simulation"]) {
    assert.doesNotThrow(() => serialize({
      candidate: { ...CANDIDATE, title: ordinary, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    }))
  }
})

test("serializer and parser reject URL-like bibliographic text carrying hidden credentials or repeated encoding", () => {
  const credentialKey = ["api", "key"].join("_")
  const hiddenValue = ["hidden", "value"].join("-")
  const unsafeUrls = [
    "https://reader@example.org/paper",
    "https://example.org/paper#private-section",
    `https://example.org/paper?${credentialKey}=${hiddenValue}`,
    `https://example.org/view?foo=${["private", "marker"].join("-")}`,
    "https://example.org/paper?ref=%252fprivate",
  ]
  const valid = serialize()

  for (const unsafeUrl of unsafeUrls) {
    for (const candidate of [
      { ...CANDIDATE, title: unsafeUrl, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, authors: [unsafeUrl], topics: [...CANDIDATE.topics] },
      { ...CANDIDATE, source: unsafeUrl, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ]) assert.throws(() => serialize({ candidate }), /元数据|字段|路径|定位|凭据/u)

    for (const document of [
      valid.replace(`title: ${JSON.stringify(CANDIDATE.title)}`, `title: ${JSON.stringify(unsafeUrl)}`),
      valid.replace(`  - ${JSON.stringify(CANDIDATE.authors[0])}`, `  - ${JSON.stringify(unsafeUrl)}`),
      valid.replace(`venue: ${JSON.stringify(CANDIDATE.source)}`, `venue: ${JSON.stringify(unsafeUrl)}`),
    ]) assert.throws(() => parseArchiveMetadata(document), /元数据|字段|路径|定位|凭据/u)
  }
})

test("free bibliographic text still permits ordinary scholarly slash and colon punctuation", () => {
  const candidate = {
    ...CANDIDATE,
    title: "Push/Pull Optimization: A Unified View",
    authors: ["Alpha/Beta Collaboration"],
    source: "IEEE/CAA Journal: Automatica Sinica",
    topics: [...CANDIDATE.topics],
  }
  const text = serialize({ candidate })
  const parsed = parseArchiveMetadata(text)
  assert.equal(parsed.metadata.title_original, candidate.title)
  assert.deepEqual(parsed.metadata.authors, candidate.authors)
  assert.equal(parsed.metadata.venue, candidate.source)
  assert.doesNotThrow(() => serialize({
    candidate: {
      ...CANDIDATE,
      title: "Control/Optimization: Methods for x/y Coupling",
      authors: [...CANDIDATE.authors],
      topics: [...CANDIDATE.topics],
    },
  }))
})

test("strict archive JSON scalars round trip scholarly YAML marker characters without shared-parser warnings", () => {
  const candidate = {
    ...CANDIDATE,
    title: "R&D Optimization",
    authors: ["A&B Research Group", "Star * Methods"],
    source: "Theory ! [Robust] {Systems}",
    topics: [...CANDIDATE.topics],
  }
  const parsed = parseArchiveMetadata(serialize({ candidate }))
  assert.equal(parsed.metadata.title_original, candidate.title)
  assert.deepEqual(parsed.metadata.authors, candidate.authors)
  assert.equal(parsed.metadata.venue, candidate.source)
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
