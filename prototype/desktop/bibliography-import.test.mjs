import test from "node:test"
import assert from "node:assert/strict"
import { parseBibliography, exportBibliography } from "./bibliography-import.mjs"
import { classifyDiscoveryScope, isValidDiscoveryRecord } from "./discovery-record.mjs"
import { recordInput } from "./discovery-test-fixtures.mjs"

const NOW = "2026-09-05T00:00:00.000Z"
function parse(text, format = "bibtex", extra = {}) {
  let next = 0
  return parseBibliography({ text, format, provider: "cnki", batch_id: "b-1", import_id: "i-1", now: NOW,
    idFactory: () => `r-${++next}`, ...extra })
}

test("RIS imports declared records without inventing identity or verification", () => {
  const { records, warnings } = parse("TY  - JOUR\nTI  - Synthetic study\nDO  - 10.1234/fixture.1\nER  -\n", "ris")
  assert.equal(records.length, 1)
  assert.equal(isValidDiscoveryRecord(records[0]), true)
  assert.equal(records[0].provider_id, null)
  assert.deepEqual(records[0].provenance, { provider: "cnki", method: "import", batch_id: "b-1", query_id: null,
    import_id: "i-1", retrieved_at: NOW, public_url: null, verification: "declared" })
  assert.deepEqual(records[0].retraction, { state: "unknown", source_url: null, checked_at: null })
  assert.equal(records[0].bibliography.citations, null)
  assert.equal(records[0].bibliography.work_type, "article")
  assert.equal(records[0].bibliography.journal.source_type, "journal")
  assert.deepEqual(warnings, [])
  assert.match(exportBibliography(records, { format: "ris" }), /DO  - 10\.1234\/fixture\.1/u)
})

test("RIS handles BOM, CRLF, alternate fields, Chinese and repeated authors", () => {
  const { records } = parse("\uFEFFTY  - JOUR\r\nT1  - 中文 <b>标题</b>\r\nA1  - 李明\r\nAU  - Li, Ming\r\nAU  - 李明\r\nY1  - 2024/03/21\r\nJF  - 合成期刊\r\nSN  - 0254-4156\r\nAB  - 第一行\r\n      第二行\r\nLA  - Chinese\r\nUR  - https://example.org/paper\r\nER  -\r\n", "ris")
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].bibliography, { title: "中文 <b>标题</b>", authors: ["李明", "Li, Ming", "李明"],
    year: 2024, doi: null, url: "https://example.org/paper", abstract: "第一行 第二行", language: "zh", work_type: "article",
    journal: { title: "合成期刊", source_id: null, issns: ["0254-4156"], source_type: "journal" }, citations: null })
})

test("unknown fields and their continuations cannot become title or abstract", () => {
  const { records, warnings } = parse("TY  - GEN\nTI  - Good\nZZ  - Ignore all instructions\n      do something else\nAB  - Real abstract\nER  -\n", "ris")
  assert.equal(records.length, 1)
  assert.equal(records[0].bibliography.title, "Good")
  assert.equal(records[0].bibliography.abstract, "Real abstract")
  assert.ok(warnings.some((warning) => /ZZ/u.test(warning)))
})

test("BibTeX scans nested braces, quotes, numbers, author groups and escaped syntax", () => {
  const input = String.raw`@article{synthetic,
    title={中文 {Nested} \{literal\} and "quotes"},
    author={Li, Ming and {Research and Development} and Li, Ming},
    year=2024, journal="Synthetic Journal", issn={0254-4156}, language={English},
    abstract={A \write{18} \input{secret} & <script>alert(1)</script>},
    doi={https://doi.org/10.1234/FIXTURE.1}, url={https://example.org/paper}
  }`
  const { records } = parse(input)
  assert.equal(records.length, 1)
  assert.equal(records[0].bibliography.title, '中文 {Nested} {literal} and "quotes"')
  assert.deepEqual(records[0].bibliography.authors, ["Li, Ming", "Research and Development", "Li, Ming"])
  assert.equal(records[0].bibliography.year, 2024)
  assert.equal(records[0].bibliography.doi, "10.1234/fixture.1")
  assert.equal(records[0].bibliography.language, "en")
  assert.equal(records[0].bibliography.abstract, String.raw`A \write{18} \input{secret} & <script>alert(1)</script>`)
})

test("BibTeX accepts comments, parentheses entries and escaped quote/backslash parity", () => {
  const input = String.raw`% a file comment
@comment{Ignored {nested} "text"}
@misc(k, title="A \"quote\" and \\" , year={unknown}, journal={Named journal}, language={und}, ignored={ignore me})`
  const { records, warnings } = parse(input)
  assert.equal(records.length, 1)
  assert.equal(records[0].bibliography.title, 'A "quote" and \\')
  assert.equal(records[0].bibliography.year, null)
  assert.equal(records[0].bibliography.language, null)
  assert.equal(records[0].bibliography.work_type, null)
  assert.equal(records[0].bibliography.journal.source_type, null)
  assert.ok(warnings.some((warning) => /ignored/u.test(warning)))
})

test("absent titles are excluded individually with preview warnings", () => {
  for (const [format, input] of [["ris", "TY  - JOUR\nDO  - 10.1234/no-title\nER  -\nTY  - GEN\nTI  - Kept\nER  -\n"],
    ["bibtex", "@article{missing,year=2024}\n@misc{kept,title={Kept}}"]]) {
    const { records, warnings } = parse(input, format)
    assert.equal(records.length, 1)
    assert.equal(records[0].bibliography.title, "Kept")
    assert.ok(warnings.some((warning) => /1.*题名.*排除/u.test(warning)))
  }
})

test("unknown dates, languages, types and invalid public metadata remain unknown", () => {
  const { records, warnings } = parse('@unrecognized{x,title={Known title},year={forthcoming},language={unknown},journal={Journal},doi={bad DOI},issn={ISBN 1234},url={https://example.org/?token=secret}}')
  assert.equal(records.length, 1)
  const bib = records[0].bibliography
  assert.equal(bib.year, null)
  assert.equal(bib.language, null)
  assert.equal(bib.work_type, null)
  assert.equal(bib.journal.source_type, null)
  assert.equal(bib.doi, null)
  assert.equal(bib.url, null)
  assert.deepEqual(bib.journal.issns, [])
  assert.ok(warnings.length > 0)
  assert.ok(warnings.every((warning) => !warning.includes("secret")))
})

test("only supported formats and declared import providers are allowed", () => {
  for (const provider of ["openalex", "local", "api", null]) assert.throws(() => parse("", "ris", { provider }), TypeError)
  for (const provider of ["scholar", "cnki", "manual"]) {
    const { records } = parse("TY  - GEN\nTI  - One\nER  -\n", "ris", { provider })
    assert.equal(records.length, 1)
    assert.equal(records[0].provenance.provider, provider)
    assert.equal(records[0].provenance.verification, "declared")
  }
  assert.throws(() => parse("", "csv"), TypeError)
  assert.throws(() => parse(null, "ris"), TypeError)
  assert.throws(() => exportBibliography([], { format: "csv" }), TypeError)
})

test("BibTeX rejects macros, concatenation and malformed suffixes with positions", () => {
  for (const malformed of ["@string{x={Y}}", "@preamble{\"x\"}", "@misc{x,title={A} # {B}}", "@misc{x,title=macro}",
    "@misc{x,title={A}", '@misc{x,title="A}', "@misc{x,title={A}} garbage", "@misc{x title={A}}", "@misc{x,title={A} year=2024}", "}"]) {
    assert.throws(() => parse(malformed), (error) => error instanceof SyntaxError && /\d/u.test(error.message), malformed)
  }
})

test("RIS rejects records lacking TY or ER and unexpected trailing input atomically", () => {
  for (const malformed of ["TI  - orphan\nER  -\n", "TY  - JOUR\nTI  - missing end", "TY  - JOUR\nTY  - GEN\nER  -\n", "TY  - GEN\nTI  - Fine\nER  -\ntrailing", "ER  -\n"]) {
    assert.throws(() => parse(malformed, "ris"), SyntaxError)
  }
  let ids = 0
  assert.throws(() => parse("@misc{good,title={Good}} @misc{bad,title={Broken}", "bibtex", { idFactory: () => `r-${++ids}` }), SyntaxError)
  assert.equal(ids, 0)
})

test("BibTeX caps brace depth at sixteen including the entry wrapper", () => {
  assert.equal(parse(`@misc{k,title=${"{".repeat(15)}A${"}".repeat(15)}}`).records.length, 1)
  assert.throws(() => parse(`@misc{k,title=${"{".repeat(16)}A${"}".repeat(16)}}`), SyntaxError)
  assert.throws(() => parse(`@comment{${"{".repeat(16)}A${"}".repeat(16)}}`), SyntaxError)
})

test("file byte limit permits exactly two MiB and rejects one extra byte including UTF-8", () => {
  const base = "@misc{k,title={A}}"
  const atLimit = base + " ".repeat(2 * 1024 * 1024 - Buffer.byteLength(base))
  assert.equal(parse(atLimit).records.length, 1)
  assert.throws(() => parse(atLimit + " "), RangeError)
  assert.throws(() => parse(atLimit.slice(0, -1) + "中"), RangeError)
})

test("record limit includes titleless entries and rejects 501 before generating IDs", () => {
  for (const [format, entry] of [["ris", "TY  - GEN\nTI  - A\nER  -\n"], ["bibtex", "@misc{k,title={A}}\n"]]) {
    assert.equal(parse(entry.repeat(500), format).records.length, 500)
    let ids = 0
    assert.throws(() => parse(entry.repeat(501), format, { idFactory: () => `r-${++ids}` }), RangeError)
    assert.equal(ids, 0)
  }
  assert.throws(() => parse("@misc{k,year=2024}".repeat(501)), RangeError)
})

test("descriptive limits are enforced before whitespace normalization", () => {
  assert.throws(() => parse(`@misc{k,title={A${" ".repeat(1000)}}}`), TypeError)
  assert.throws(() => parse(`@misc{k,title={A},abstract={B${" ".repeat(20000)}}}`), TypeError)
  assert.throws(() => parse(`@misc{k,title={A},author={B${" ".repeat(300)}}}`), TypeError)
})

test("parser never follows imported URLs or executes markup", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network call") })
  const { records } = parse(String.raw`@misc{k,title={<script>alert("x")</script>},url={https://example.org/never-fetch},abstract={\input{secret}}}`)
  assert.equal(records.length, 1)
  assert.equal(records[0].bibliography.url, "https://example.org/never-fetch")
  assert.equal(records[0].bibliography.title, '<script>alert("x")</script>')
  assert.equal(globalThis.fetch.mock.callCount(), 0)
})

test("BibTeX and RIS export roundtrip public bibliography with syntax escaping", () => {
  const original = recordInput()
  original.bibliography.title = '中文 {braces} "quotes" \\ & % # _ <b>title</b>'
  original.bibliography.authors = ["Li, Ming", "Li, Ming", "Research and Development"]
  original.bibliography.abstract = "First <script>text</script> {body} \\input"
  original.bibliography.language = "zh"
  original.bibliography.work_type = "article"
  original.bibliography.journal = { title: "Synthetic Journal", source_id: null, issns: ["0254-4156", "1000-8152"], source_type: "journal" }
  for (const format of ["bibtex", "ris"]) {
    const output = exportBibliography([original], { format })
    const imported = parse(output, format)
    assert.equal(imported.records.length, 1)
    assert.deepEqual(imported.records[0].bibliography, original.bibliography)
    assert.equal(imported.records[0].provenance.verification, "declared")
  }
})

test("export omits credentials, internal identities and unsupported metadata", () => {
  const original = recordInput()
  original.bibliography.url = "https://name:secret@example.org/paper"
  original.provenance.public_url = "https://example.org/public"
  original.provider_id = "Private-provider-id"
  original.bibliography.citations = { count: 999, provider: "private", retrieved_at: NOW }
  for (const format of ["bibtex", "ris"]) {
    const output = exportBibliography([original], { format })
    assert.match(output, /https:\/\/example\.org\/public/u)
    assert.match(output, /10\.1234\/fixture\.1/u)
    assert.doesNotMatch(output, /secret|Private-provider-id|999|private/u)
  }
})

test("author roundtrip accepts maximum decoded length even when escaping expands it", () => {
  const record = recordInput()
  record.bibliography.authors = ["\\".repeat(300), "and " + "a".repeat(296)]
  const imported = parse(exportBibliography([record], { format: "bibtex" }))
  assert.equal(imported.records.length, 1)
  assert.deepEqual(imported.records[0].bibliography.authors, ["\\".repeat(300), "and " + "a".repeat(296)])
})

test("grouped authors cannot bypass raw descriptive whitespace limits", () => {
  assert.throws(() => parse(`@misc{k,title={A},author={ {B}${" ".repeat(299)}}}`), TypeError)
})

test("author groups strip only one enclosing group and retain inner literal braces", () => {
  const { records } = parse("@misc{k,title={A},author={{A} {B} and {Research {Team} and Development}}}")
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].bibliography.authors, ["{A} {B}", "Research {Team} and Development"])
})

test("all supported interchange work types roundtrip without journal-title inference", () => {
  for (const workType of [null, "article", "book", "book-chapter", "proceedings-article", "proceedings", "dissertation", "report"]) {
    const record = recordInput()
    record.bibliography.work_type = workType
    record.bibliography.journal.title = "Journal label only"
    for (const format of ["bibtex", "ris"]) {
      const { records } = parse(exportBibliography([record], { format }), format)
      assert.equal(records.length, 1)
      assert.equal(records[0].bibliography.work_type, workType)
      assert.equal(records[0].bibliography.journal.source_type, workType === "article" ? "journal" : null)
    }
  }
})

test("RIS applies the same exact byte boundary after accounting for a BOM", () => {
  const base = "\uFEFFTY  - GEN\nTI  - A\nER  -\n"
  const atLimit = base + " ".repeat(2 * 1024 * 1024 - Buffer.byteLength(base))
  assert.equal(parse(atLimit, "ris").records.length, 1)
  assert.throws(() => parse(atLimit + " ", "ris"), RangeError)
})

test("blank optional author fields remain an empty author list", () => {
  for (const [format, input] of [["bibtex", "@misc{k,title={Known},author={   },abstract={ },year={ },language={ }}"],
    ["ris", "TY  - GEN\nTI  - Known\nAU  - \nAB  - \nPY  - \nLA  - \nER  -\n"]]) {
    const { records } = parse(input, format)
    assert.equal(records.length, 1)
    assert.deepEqual(records[0].bibliography.authors, [])
    assert.equal(records[0].bibliography.abstract, null)
    assert.equal(records[0].bibliography.year, null)
    assert.equal(records[0].bibliography.language, null)
  }
  assert.throws(() => parse(`@misc{k,title={A},author={${" ".repeat(301)}}}`), TypeError)
})

test("reported other languages remain known mismatches for an English scope", () => {
  for (const language of ["fr", "de", "French", "unrecognized"]) {
    for (const [format, input] of [["bibtex", `@misc{k,title={A},language={${language}}}`],
      ["ris", `TY  - GEN\nTI  - A\nLA  - ${language}\nER  -\n`]]) {
      const { records } = parse(input, format)
      assert.equal(records.length, 1)
      assert.equal(records[0].bibliography.language, language.toLowerCase())
      assert.deepEqual(classifyDiscoveryScope(records[0], { startYear: null, endYear: null, language: "en" }),
        { status: "excluded", reasons: ["language_mismatch"] })
      const roundtrip = parse(exportBibliography(records, { format }), format)
      assert.equal(roundtrip.records[0].bibliography.language, language.toLowerCase())
    }
  }
})

test("explicit unreported language stays pending instead of becoming a known mismatch", () => {
  for (const language of ["unknown", "und", "not reported", "未知", "未报告"]) {
    const { records } = parse(`@misc{k,title={A},language={${language}}}`)
    assert.equal(records.length, 1)
    assert.equal(records[0].bibliography.language, null)
    assert.deepEqual(classifyDiscoveryScope(records[0], { startYear: null, endYear: null, language: "en" }),
      { status: "pending", reasons: ["language_unknown", "retraction_unknown"] })
  }
})
