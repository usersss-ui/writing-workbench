import test from "node:test"
import assert from "node:assert/strict"
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import {
  assertGeneratedPath,
  buildPrivateLibrary,
  guardedReplaceGeneratedDirectories,
  inspectControlledImageReferences,
} from "./build.mjs"
import { main as runBuildCli } from "../scripts/build-private-library.mjs"
import { loadLibraryConfig } from "./config.mjs"
import { loadPaperOverrides } from "./overrides.mjs"
import { scanPaperSources } from "./scanner.mjs"
import { createEmptyFacets } from "./facet-schema.mjs"

const REQUIRED_DESKTOP_ASSETS = Object.freeze([
  "styles.css",
  "library.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "candidate-storage.mjs",
  "discovery.mjs",
  "institution-access.mjs",
  "openalex-search.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
])

const INSTITUTION = Object.freeze({ version: 1, institution_id: "nuist", display_name: "南京信息工程大学", access_mode: "carsi", library_home: "https://lib.nuist.edu.cn/", fallback_page: "https://lib.nuist.edu.cn/zy1/wwsjk.htm", providers: [{ provider_id: "ieee", display_name: "IEEE Xplore", hosts: ["ieeexplore.ieee.org"], doi_prefixes: ["10.1109"], library_page: "https://lib.nuist.edu.cn/info/1015/1430.htm", carsi_entry_url: "https://ieeexplore.ieee.org/servlet/wayf.jsp", carsi_supported: true }] })

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

async function put(root, relativePath, content = "fixture") {
  if (/\.pdf$/iu.test(relativePath) && typeof content === "string" && !content.startsWith("%PDF-")) {
    content = `%PDF-1.7\n${content}\n%%EOF\n`
  }
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  if (relativePath.endsWith("/metadata.yaml")) {
    const digest = createHash("sha256").update(content).digest("hex")
    await writeFile(join(dirname(target), ".metadata.commit"), `sha256:${digest}\n`)
  }
  return target
}

test("buildPrivateLibrary emits rebuildable local PDF and OCR source documents without exposing source paths", async () => {
  const fixture = await makeFixture()
  const pdfBytes = Buffer.from("%PDF-1.7\ncontrolled fixture\n%%EOF\n")
  const pdfPath = await put(fixture.sourceRoot, "Paper A/paper.pdf", pdfBytes)
  const ocrPath = await put(fixture.sourceRoot, "Paper A/paper.md", "# OCR 原文\n\n正文 ![图](images/figure.png)")
  await put(fixture.sourceRoot, "Paper A/images/figure.png", ONE_PIXEL_PNG)
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }
  const pdfBefore = await readFile(pdfPath)
  const ocrBefore = await readFile(ocrPath)

  const result = await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const paper = index.papers[0]

  assert.deepEqual(paper.source_documents.pdf.map(({ label, size_bytes }) => ({ label, size_bytes })), [
    { label: "paper.pdf", size_bytes: pdfBytes.byteLength },
  ])
  assert.deepEqual(paper.source_documents.ocr.map(({ label, size_bytes }) => ({ label, size_bytes })), [
    { label: "paper.md", size_bytes: ocrBefore.byteLength },
  ])
  assert.match(paper.source_documents.pdf[0].url, /^\.\.\/\.\.\/local_library_data\/sources\/papera-01\/pdf\/[a-f0-9]{64}\.pdf$/u)
  assert.match(paper.source_documents.ocr[0].url, /^\.\.\/\.\.\/local_library_data\/sources\/papera-01\/ocr\/[a-f0-9]{64}\.html$/u)

  const pdfOutput = join(fixture.repoRoot, paper.source_documents.pdf[0].url.replace("../../local_library_data/", "local_library_data/"))
  const ocrOutput = join(fixture.repoRoot, paper.source_documents.ocr[0].url.replace("../../local_library_data/", "local_library_data/"))
  assert.equal((await readFile(pdfOutput)).compare(pdfBytes), 0)
  assert.match(await readFile(ocrOutput, "utf8"), /<h1>OCR 原文<\/h1>/u)
  assert.match(await readFile(ocrOutput, "utf8"), /<img class="note-image"/u)
  assert.equal((await readFile(pdfPath)).compare(pdfBefore), 0)
  assert.equal((await readFile(ocrPath)).compare(ocrBefore), 0)
  assert.equal(await exists(join(fixture.repoRoot, "local_library_output", "sources")), false)
  assert.equal(result.sourceDocumentCount, 2)
})

test("buildPrivateLibrary rejects a source document whose size changed after scanning", async () => {
  const fixture = await makeFixture()
  const pdfPath = await put(fixture.sourceRoot, "Paper A/paper.pdf", Buffer.from("%PDF-1.7\nfirst snapshot\n%%EOF\n"))
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")
  const scanAndReplace = async (options) => {
    const result = await scanPaperSources(options)
    await writeFile(pdfPath, "%PDF-1.7\na different and longer snapshot\n%%EOF\n")
    return result
  }

  await assert.rejects(
    () => buildPrivateLibrary({ ...fixture, scan: scanAndReplace }),
    /PDF 原文在扫描后大小发生变化/u,
  )
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
})

test("buildPrivateLibrary requires a near-tail PDF EOF marker and accepts bounded reader metadata", async () => {
  const invalid = await makeFixture()
  await put(invalid.sourceRoot, "Paper A/paper.pdf", Buffer.from("%PDF-1.7\ntruncated body\n"))
  await assert.rejects(() => buildPrivateLibrary(invalid), /PDF 原文格式无效/u)
  assert.equal(await exists(join(invalid.repoRoot, "local_library_data")), false)

  const valid = await makeFixture()
  const bytes = Buffer.from("%PDF-1.7\ncomplete body\n%%EOF\r\n \t\f\0")
  await put(valid.sourceRoot, "Paper A/paper.pdf", bytes)
  await buildPrivateLibrary(valid)
  const index = await readJson(join(valid.repoRoot, "local_library_data/paper-index.json"))
  assert.equal(index.papers[0].source_documents.pdf[0].size_bytes, bytes.byteLength)

  const vendorTagged = await makeFixture()
  const vendorBytes = Buffer.from("%PDF-1.7\ncomplete body\n%%EOF\nWebFastLoad<FileProperty><Doi>10.example/local</Doi></FileProperty>")
  await put(vendorTagged.sourceRoot, "Paper A/paper.pdf", vendorBytes)
  await buildPrivateLibrary(vendorTagged)
  const vendorIndex = await readJson(join(vendorTagged.repoRoot, "local_library_data/paper-index.json"))
  assert.equal(vendorIndex.papers[0].source_documents.pdf[0].size_bytes, vendorBytes.byteLength)

  const excessiveSuffix = await makeFixture()
  const excessiveBytes = Buffer.concat([
    Buffer.from("%PDF-1.7\ncomplete body\n%%EOF\n"),
    Buffer.alloc(16 * 1024 + 1, 0x78),
  ])
  await put(excessiveSuffix.sourceRoot, "Paper A/paper.pdf", excessiveBytes)
  await assert.rejects(() => buildPrivateLibrary(excessiveSuffix), /PDF 原文格式无效/u)
})

test("buildPrivateLibrary normalizes source labels to the frontend display contract", async () => {
  const fixture = await makeFixture()
  const longStem = "x".repeat(241)
  await put(fixture.sourceRoot, `Paper A/${longStem}.pdf`, "pdf")
  await put(fixture.sourceRoot, `Paper A/${longStem}.md`, "# OCR")
  await put(fixture.sourceRoot, "Paper A/control\nname.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/control\nname.md", "# OCR")

  await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const documents = Object.values(index.papers[0].source_documents).flat()

  assert.equal(documents.length, 4)
  assert.equal(documents.every((document) => document.label.length > 0 && document.label.length <= 240), true)
  assert.equal(documents.every((document) => !/[\\/\u0000-\u001f\u007f]/u.test(document.label)), true)
  assert.equal(documents.some((document) => document.label.includes("…")), true)
})

async function makeFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "paper-build-repo-"))
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-build-source-"))
  const templateRoot = join(repoRoot, "templates")
  await put(templateRoot, "library.template.html", "<!doctype html><html lang=\"zh-CN\"><main id=\"library-results\"></main></html>")
  await put(templateRoot, "discovery.template.html", "<!doctype html><html lang=\"zh-CN\"><main id=\"discovery-mode-tabs\"></main></html>")
  for (const asset of REQUIRED_DESKTOP_ASSETS) await put(templateRoot, asset, `approved:${asset}`)
  await put(templateRoot, "vendor/katex/katex.mjs", "export default { render() {} }")
  await put(templateRoot, "vendor/katex/katex.min.css", "@font-face{src:url(fonts/KaTeX_Test-Regular.woff2) format('woff2')}")
  await put(templateRoot, "vendor/katex/LICENSE", "MIT fixture")
  await put(templateRoot, "vendor/katex/fonts/KaTeX_Test-Regular.woff2", Buffer.from("wOF2fixture"))
  await put(templateRoot, "private-extra.txt", "must not be copied")
  return {
    repoRoot,
    sourceRoot,
    templateRoot,
    config: { version: 1, sources: [{ source_id: "main_papers", path: sourceRoot }] },
    overrides: { version: 1, papers: {} },
    tagCatalog: { version: 3, papers: {} },
    institution: INSTITUTION,
  }
}

function metadataOnlyFixture() {
  return [
    "paper_id: Wang23-DIO",
    'title: "Distributed Interval Optimization Over Time-Varying Networks"',
    "authors:",
    '  - "Yinghui Wang"',
    "year: 2023",
    'venue: "IEEE Access"',
    'url: "https://openalex.org/W4387886124"',
    "unit_type: article",
    "archive_mode: metadata_only",
    "archive_source_id: main_papers",
    "candidate_source: openalex",
    "openalex_id: W4387886124",
    'archived_at: "2026-08-30T04:05:06.000Z"',
    "",
  ].join("\n")
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function rejectedBuild(run) {
  try {
    await run()
    assert.fail("expected build to reject")
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error
    return error
  }
}

test("buildPrivateLibrary writes only rebuildable outputs and leaves source bytes unchanged", async () => {
  const fixture = await makeFixture()
  const pdf = await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf bytes")
  await put(fixture.sourceRoot, "Paper A/reading-note.md", "# 私人笔记")
  const before = await readFile(pdf)

  const result = await buildPrivateLibrary(fixture)

  assert.equal((await readFile(pdf)).compare(before), 0)
  const indexPath = join(fixture.repoRoot, "local_library_data/paper-index.json")
  const auditPath = join(fixture.repoRoot, "local_library_data/paper-library-audit.json")
  const pagePath = join(fixture.repoRoot, "local_library_output/desktop/library.html")
  const discoveryPath = join(fixture.repoRoot, "local_library_output/desktop/discovery.html")
  await stat(indexPath)
  await stat(auditPath)
  await stat(pagePath)
  await stat(discoveryPath)
  assert.equal(result.paperCount, 1)
  assert.equal(result.previewCount, 1)
  assert.equal(result.pageCount, 3)
  assert.equal((await readFile(indexPath, "utf8")).endsWith("\n"), true)
  assert.equal((await readFile(auditPath, "utf8")).endsWith("\n"), true)
  assert.deepEqual(Object.keys(await readJson(indexPath)).sort(), ["facet_schema", "papers", "version", "warning_count"])
  for (const asset of REQUIRED_DESKTOP_ASSETS) {
    assert.equal(
      await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets", asset), "utf8"),
      `approved:${asset}`,
    )
  }
  assert.deepEqual(
    await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets/paper-user-tags.mjs")),
    await readFile(join(fixture.templateRoot, "paper-user-tags.mjs")),
  )
  assert.equal(
    await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets/vendor/katex/katex.mjs"), "utf8"),
    "export default { render() {} }",
  )
  assert.equal(
    await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets/vendor/katex/katex.min.css"), "utf8"),
    "@font-face{src:url(fonts/KaTeX_Test-Regular.woff2) format('woff2')}",
  )
  assert.equal(
    (await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets/vendor/katex/fonts/KaTeX_Test-Regular.woff2"))).toString(),
    "wOF2fixture",
  )
  assert.equal(await exists(join(fixture.repoRoot, "local_library_output/desktop/assets/vendor/katex/private-extra.txt")), false)
  assert.equal(await exists(join(fixture.repoRoot, "local_library_output/desktop/assets/private-extra.txt")), false)
  assert.deepEqual(await readJson(join(fixture.repoRoot, "local_library_output/desktop/assets/nuist.institution.json")), INSTITUTION)
})

test("buildPrivateLibrary forwards catalogs and serializes normalized safe metadata fields", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const catalogs = {
    main_papers: {
      version: 1,
      papers: {
        "main_papers::Paper A": {
          paper_id: "PaperA-01",
          title_original: "语言中立 Title",
          publication_year: 2024,
          version_date: "2024-03-15",
          year: 2024,
          metadata_provenance: {
            paper_id: "catalog",
            title_original: "catalog",
            publication_year: "catalog",
            version_date: "catalog",
            year: "catalog",
          },
        },
      },
      warnings: [],
    },
  }

  await buildPrivateLibrary({ ...fixture, catalogs })
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const paper = index.papers[0]

  assert.equal(paper.paper_id, "PaperA-01")
  assert.equal(paper.identity_source, "catalog")
  assert.equal(paper.title_original, "语言中立 Title")
  assert.equal(paper.publication_year, 2024)
  assert.equal(paper.version_date, "2024-03-15")
  assert.equal(paper.metadata_provenance.paper_id, "catalog")
  assert.equal(paper.note_status, "pdf_only")
})

test("buildPrivateLibrary writes a sanitized source-relative catalog artifact", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const catalogs = {
    main_papers: {
      version: 1,
      papers: {
        "main_papers::Paper A": {
          paper_id: "PaperA-01",
          title_original: "A safe title",
          authors: ["Author A"],
          publication_year: 2024,
          year: 2024,
          venue: "Safe Venue",
          doi_or_url: "https://doi.org/10.1000/safe",
          metadata_provenance: { paper_id: "catalog", title_original: "catalog" },
          absolute_path: fixture.sourceRoot,
          note_body: "PRIVATE NOTE BODY",
          ocr_body: "PRIVATE OCR BODY",
        },
      },
      warnings: ["catalog_line_unmatched:12"],
    },
  }

  await buildPrivateLibrary({ ...fixture, catalogs })
  const catalogPath = join(fixture.repoRoot, "local_library_data/paper-catalog.json")
  const catalogText = await readFile(catalogPath, "utf8")
  const generated = JSON.parse(catalogText)

  assert.deepEqual(Object.keys(generated), ["version", "sources"])
  assert.deepEqual(Object.keys(generated.sources.main_papers.papers), ["Paper A"])
  assert.deepEqual(generated.sources.main_papers.papers["Paper A"], {
    paper_id: "PaperA-01",
    title_original: "A safe title",
    authors: ["Author A"],
    publication_year: 2024,
    year: 2024,
    venue: "Safe Venue",
    doi_or_url: "https://doi.org/10.1000/safe",
    metadata_provenance: { paper_id: "catalog", title_original: "catalog" },
  })
  assert.deepEqual(generated.sources.main_papers.warnings, ["catalog_line_unmatched:12"])
  assert.equal(catalogText.includes(fixture.sourceRoot), false)
  assert.equal(catalogText.includes("PRIVATE NOTE BODY"), false)
  assert.equal(catalogText.includes("PRIVATE OCR BODY"), false)
})

test("public index exposes only the aggregate count of audit warning arrays", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/first.pdf", "one")
  await put(fixture.sourceRoot, "Paper A/second.pdf", "two")
  await put(fixture.sourceRoot, "Paper A/unclassified.bin", "three")

  await buildPrivateLibrary(fixture)
  const indexText = await readFile(join(fixture.repoRoot, "local_library_data/paper-index.json"), "utf8")
  const index = JSON.parse(indexText)

  assert.equal(index.warning_count, 2)
  assert.equal(indexText.includes("multiple_versions"), false)
  assert.equal(indexText.includes("unrecognized_artifacts"), false)
  assert.equal(indexText.includes("unclassified.bin"), false)
})

test("metadata-only build keeps archive identity private and emits only the existing public URL field", async () => {
  const fixture = await makeFixture()
  fixture.config.archive_source_id = "main_papers"
  await put(fixture.sourceRoot, "Wang23-DIO/metadata.yaml", metadataOnlyFixture())

  await buildPrivateLibrary(fixture)
  const indexPath = join(fixture.repoRoot, "local_library_data/paper-index.json")
  const auditPath = join(fixture.repoRoot, "local_library_data/paper-library-audit.json")
  const indexText = await readFile(indexPath, "utf8")
  const index = JSON.parse(indexText)
  const audit = await readJson(auditPath)
  const paper = index.papers[0]

  assert.equal(paper.source_id, "main_papers")
  assert.equal(paper.relative_path, "Wang23-DIO")
  assert.equal(paper.doi_or_url, "https://openalex.org/W4387886124")
  assert.equal(paper.note_status, "metadata_only")
  assert.deepEqual(paper.facet_states, {})
  assert.deepEqual(paper.source_documents, { pdf: [], ocr: [] })
  assert.equal(Object.values(paper.controlled_previews).every((value) => value === null), true)
  assert.equal(Object.values(paper.controlled_preview_documents).every((items) => items.length === 0), true)
  assert.deepEqual(audit.archive_identity_lookup, { "Wang23-DIO": "openalex:W4387886124" })
  for (const forbidden of ["archive_source_id", "candidate_source", "openalex_id", "archive_identity_lookup"]) {
    assert.equal(indexText.includes(`\"${forbidden}\"`), false)
  }
  assert.equal(indexText.includes(fixture.sourceRoot), false)
})

test("shared built-index validator accepts only the complete v3 public boundary", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }
  await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const buildModule = await import("./build.mjs")

  assert.equal(typeof buildModule.validateBuiltPaperIndex, "function")
  assert.equal(buildModule.validateBuiltPaperIndex(index, { privateRoots: [fixture.sourceRoot] }), index)
  for (const candidate of [
    { ...index, version: 2 },
    { ...index, private_path: fixture.sourceRoot },
    { ...index, papers: [index.papers[0], structuredClone(index.papers[0])] },
    { ...index, papers: [{ ...index.papers[0], private_path: fixture.sourceRoot }] },
  ]) {
    assert.throws(() => buildModule.validateBuiltPaperIndex(candidate, { privateRoots: [fixture.sourceRoot] }))
  }
})

test("missing approved desktop asset fails before swapping either generated directory", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await rm(join(fixture.templateRoot, "paper-inspector.mjs"))
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")

  await assert.rejects(() => buildPrivateLibrary(fixture), /桌面资源.*不存在/u)
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
})

test("buildPrivateLibrary emits one safe explicitly approved preferred-note preview", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/reading-note.md", "# 标题\n\n<script>alert(1)</script>")
  fixture.overrides.papers["main_papers::Paper A"] = {
    paper_id: "PaperA-01",
    preferred_note: "reading-note.md",
    preview_note: true,
  }

  const result = await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))
  const previewPath = join(fixture.repoRoot, "local_library_data/notes/papera-01/preferred.html")
  const preview = await readFile(previewPath, "utf8")

  assert.equal(result.previewCount, 1)
  assert.equal(result.pageCount, 3)
  assert.equal(index.papers[0].note_preview_url, "../../local_library_data/notes/papera-01/preferred.html")
  assert.equal(preview, "<h1>标题</h1>\n<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n")
  assert.equal(audit.counts.generated_note_previews, 1)
  assert.equal(audit.counts.generated_pages, 3)
})

test("buildPrivateLibrary emits fixed controlled previews for reading, derivation, simulation, and code comparison", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/PaperA-01_论文精读.md", "# 阅读笔记")
  await put(fixture.sourceRoot, "Paper A/PaperA-01_推导过程.md", "# 推导过程")
  await put(fixture.sourceRoot, "Paper A/PaperA-01_仿真描述.md", "# 仿真描述")
  await put(fixture.sourceRoot, "Paper A/PaperA-01_代码对比提示.md", "# 代码对比")
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }

  const result = await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const paper = index.papers[0]

  assert.deepEqual(paper.controlled_previews, {
    note: "../../local_library_data/notes/papera-01/preferred.html",
    derivation: "../../local_library_data/notes/papera-01/derivation.html",
    simulation: "../../local_library_data/notes/papera-01/simulation.html",
    code_compare: "../../local_library_data/notes/papera-01/code_compare.html",
  })
  assert.equal(paper.note_preview_url, paper.controlled_previews.note)
  assert.ok(paper.controlled_preview_documents, "controlled_preview_documents must be serialized")
  assert.deepEqual(Object.keys(paper.controlled_preview_documents), [
    "note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report",
  ])
  for (const category of ["note", "derivation", "simulation", "code_compare"]) {
    assert.equal(paper.controlled_preview_documents[category].length, 1)
    assert.equal(paper.controlled_preview_documents[category][0].is_default, true)
  }
  for (const category of ["source_map", "modeling", "reproduction_report"]) {
    assert.deepEqual(paper.controlled_preview_documents[category], [])
  }
  assert.equal(result.previewCount, 4)
  assert.equal(result.pageCount, 6)
  for (const [fileName, heading] of [
    ["preferred.html", "阅读笔记"],
    ["derivation.html", "推导过程"],
    ["simulation.html", "仿真描述"],
    ["code_compare.html", "代码对比"],
  ]) {
    assert.equal(
      await readFile(join(fixture.repoRoot, "local_library_data/notes/papera-01", fileName), "utf8"),
      `<h1>${heading}</h1>\n`,
    )
  }
})

test("buildPrivateLibrary emits every categorized Markdown preview in stable order while preserving legacy defaults", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const documents = {
    note: [
      ["notes/01_精读.md", "# first note"],
      ["notes/02_精读.markdown", "# selected note"],
    ],
    derivation: [
      ["derivations/01_推导过程.md", "# derivation one"],
      ["derivations/02_derivation.markdown", "# derivation two"],
    ],
    source_map: [
      ["maps/01_source_map.md", "# shared source map"],
      ["maps/02_source_map.markdown", "# shared source map"],
    ],
    modeling: [
      ["models/01_modeling.md", "# modeling one"],
      ["models/02_modeling.markdown", "# modeling two"],
    ],
    simulation: [
      ["simulations/01_simulation.md", "# simulation one"],
      ["simulations/02_仿真描述.markdown", "# simulation two"],
    ],
    code_compare: [
      ["comparisons/01_code-compare.md", "# comparison one"],
      ["comparisons/02_代码对比.markdown", "# comparison two"],
    ],
    reproduction_report: [
      ["reports/01_reproduction-report.md", "# report one"],
      ["reports/02_复现报告.markdown", "# report two"],
    ],
  }
  for (const entries of Object.values(documents).reverse()) {
    for (const [relativePath, content] of [...entries].reverse()) {
      await put(fixture.sourceRoot, `Paper A/${relativePath}`, content)
    }
  }
  fixture.overrides.papers["main_papers::Paper A"] = {
    paper_id: "PaperA-01",
    preferred_note: "notes/02_精读.markdown",
    preview_note: true,
  }

  const result = await buildPrivateLibrary(fixture)
  const indexPath = join(fixture.repoRoot, "local_library_data/paper-index.json")
  const index = await readJson(indexPath)
  const indexText = await readFile(indexPath, "utf8")
  const paper = index.papers[0]
  const categories = ["note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report"]

  assert.deepEqual(Object.keys(paper.controlled_preview_documents), categories)
  for (const category of categories) {
    const expectedEntries = documents[category]
    assert.deepEqual(paper.controlled_preview_documents[category].map((item) => item.label), expectedEntries.map(([label]) => label))
    assert.deepEqual(paper.controlled_preview_documents[category].map((item) => item.is_default),
      category === "note" ? [false, true] : [false, false])
    for (const [index, [label, content]] of expectedEntries.entries()) {
      const item = paper.controlled_preview_documents[category][index]
      const digest = createHash("sha256").update(content).digest("hex")
      assert.deepEqual(Object.keys(item).sort(), ["is_default", "label", "size_bytes", "url"])
      assert.equal(item.label, label)
      assert.equal(item.size_bytes, Buffer.byteLength(content))
      assert.equal(item.url, `../../local_library_data/notes/papera-01/${category}/${digest}.html`)
      assert.equal(await exists(join(fixture.repoRoot, item.url.replace("../../local_library_data/", "local_library_data/"))), true)
    }
  }
  assert.equal(paper.controlled_preview_documents.source_map.length, 2)
  assert.equal(paper.controlled_preview_documents.source_map[0].url, paper.controlled_preview_documents.source_map[1].url)
  assert.deepEqual(paper.controlled_previews, {
    note: "../../local_library_data/notes/papera-01/preferred.html",
    derivation: null,
    simulation: null,
    code_compare: null,
  })
  assert.equal(paper.note_preview_url, paper.controlled_previews.note)
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/notes/papera-01/preferred.html"), "utf8"), "<h1>selected note</h1>\n")
  assert.equal(indexText.includes(fixture.sourceRoot), false)
  assert.equal(result.previewCount, 14)
  assert.equal(result.pageCount, 16)
})

test("buildPrivateLibrary skips an in-unit Markdown symlink alias and previews the canonical note once", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const target = await put(fixture.sourceRoot, "Paper A/PaperA-01_论文精读.md", "# canonical note")
  await symlink(target, join(fixture.sourceRoot, "Paper A/PaperA-01_旧入口_论文精读.md"))
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }

  const result = await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.deepEqual(index.papers[0].controlled_preview_documents.note.map((item) => item.label), ["PaperA-01_论文精读.md"])
  assert.equal(result.previewCount, 1)
  assert.ok(audit.warnings.internal_symlinks.includes("Paper A/PaperA-01_旧入口_论文精读.md"))
})

test("buildPrivateLibrary copies only explicitly embedded images and reuses duplicate references", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/PaperA-01_论文精读.md", [
    "# 阅读笔记",
    "",
    "| 原图 | 复现 |",
    "| --- | --- |",
    "| ![[used.png]] | ![[result.png]] |",
    "| ![[used.png]] | 再次引用 |",
  ].join("\n"))
  const usedPath = await put(fixture.sourceRoot, "Paper A/images/used.png", ONE_PIXEL_PNG)
  await put(fixture.sourceRoot, "Paper A/result.png", Buffer.concat([ONE_PIXEL_PNG, Buffer.from([0])]))
  await put(fixture.sourceRoot, "Paper A/images/unused.png", ONE_PIXEL_PNG)
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }
  const sourceBefore = await readFile(usedPath)

  const result = await buildPrivateLibrary(fixture)
  const preview = await readFile(
    join(fixture.repoRoot, "local_library_data/notes/papera-01/preferred.html"),
    "utf8",
  )
  const assetDirectory = join(fixture.repoRoot, "local_library_data/notes/papera-01/assets")
  const assets = (await readdir(assetDirectory)).sort()
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.equal(result.imageAssetCount, 2)
  assert.equal(audit.counts.generated_image_assets, 2)
  assert.equal(audit.image_assets.filter((entry) => entry.status === "resolved").length, 3)
  assert.equal(assets.length, 2)
  assert.equal(assets.every((name) => /^[a-f0-9]{64}\.png$/u.test(name)), true)
  assert.equal(preview.match(/<img /gu)?.length, 3)
  assert.equal(preview.includes("![["), false)
  assert.equal(preview.includes("unused.png"), false)
  assert.equal((await readFile(usedPath)).compare(sourceBefore), 0)
})

test("shared image inspection and build audit reject the same escaping reference", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const markdown = "# note\n\n![escape](../escape.png)"
  await put(fixture.sourceRoot, "Paper A/PaperA-01_论文精读.md", markdown)
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }

  const inspected = await inspectControlledImageReferences({
    markdown,
    unitDirectory: await realpath(join(fixture.sourceRoot, "Paper A")),
    noteRelativePath: "PaperA-01_论文精读.md",
  })
  await buildPrivateLibrary(fixture)
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.deepEqual(inspected.map(({ target, status }) => ({ target, status })), [
    { target: "../escape.png", status: "unsupported" },
  ])
  assert.equal(audit.image_assets[0].status, "unsupported")
})

test("shared image inspection and build resolve root-level note images identically", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const markdown = "# note\n\n![figure](images/figure.png)"
  await put(fixture.sourceRoot, "Paper A/PaperA-01_论文精读.md", markdown)
  await put(fixture.sourceRoot, "Paper A/images/figure.png", ONE_PIXEL_PNG)
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }

  const inspected = await inspectControlledImageReferences({
    markdown,
    unitDirectory: await realpath(join(fixture.sourceRoot, "Paper A")),
    noteRelativePath: "PaperA-01_论文精读.md",
  })
  await buildPrivateLibrary(fixture)
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.equal(inspected[0].status, "resolved")
  assert.equal(inspected[0].sourceRelativePath, "images/figure.png")
  assert.equal(audit.image_assets[0].source_relative_path, inspected[0].sourceRelativePath)
})

test("public index uses a deep fixed-field allowlist and never contains private roots", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const result = await buildPrivateLibrary(fixture)
  const indexText = await readFile(join(fixture.repoRoot, "local_library_data/paper-index.json"), "utf8")
  const index = JSON.parse(indexText)
  const paper = index.papers[0]

  assert.equal(indexText.includes(fixture.sourceRoot), false)
  assert.equal(indexText.includes(fixture.repoRoot), false)
  for (const forbidden of ["private_path_lookup", "root_path", "absolute_path", "sourceRoot", "repoRoot", "file" + "://"]) {
    assert.equal(indexText.includes(forbidden), false, forbidden)
  }
  assert.deepEqual(Object.keys(paper.artifacts.pdf[0]).sort(), ["file_name", "relative_path", "size_bytes"])
  assert.equal(result.paperCount, 1)
})

test("final public-value validation blocks file URLs, configured roots, and absolute paths before swap", async () => {
  const fileUrl = ["file:", "", "", "Users", "example", "private", "secret.pdf"].join("/")
  const cases = [
    (fixture) => ({ doi_or_url: fileUrl }),
    () => ({ doi_or_url: "FILE:///private/secret.pdf" }),
    () => ({ doi_or_url: " \tFi \nLe :///private/secret.pdf" }),
    (fixture) => ({ title_zh: `私有定位 ${fixture.sourceRoot} 不得公开` }),
    (fixture) => ({ doi_or_url: `https://example.org/view?source=${fixture.sourceRoot}` }),
    (fixture) => ({ doi_or_url: `https://example.org${fixture.sourceRoot}/paper` }),
    () => ({ title_en: "/private/research/secret.md" }),
    () => ({ venue: ["C:", "private", "research", "secret.md"].join("\\") }),
    () => ({ venue: ["", "", "server", "private", "secret.md"].join("\\") }),
  ]

  for (const makePrivateFields of cases) {
    const fixture = await makeFixture()
    await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
    fixture.overrides.papers["main_papers::Paper A"] = {
      paper_id: "PaperA-01",
      ...makePrivateFields(fixture),
    }
    await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
    await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")

    await assert.rejects(() => buildPrivateLibrary(fixture), /公开索引包含私有定位信息/)
    assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
    assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
  }
})

test("final public-value validation recurses through v3 source terms before swapping", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }
  fixture.tagCatalog = {
    version: 3,
    papers: {
      "PaperA-01": {
        record_type: "外部论文",
        facets: createEmptyFacets(),
        facet_states: {},
        source_terms: [fixture.sourceRoot],
      },
    },
  }
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")

  await assert.rejects(() => buildPrivateLibrary(fixture), /公开索引包含私有定位信息/)
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
})

test("final public-value validation keeps legitimate HTTP URLs containing file text and safe preview URL", async () => {
  const safeUrls = [
    "https://example.org/file:appendix",
    "http://example.org/file:appendix",
    "https://doi.org/10.1000/example",
  ]
  for (const doiOrUrl of safeUrls) {
    const fixture = await makeFixture()
    await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
    await put(fixture.sourceRoot, "Paper A/reading-note.md", "# safe")
    fixture.overrides.papers["main_papers::Paper A"] = {
      paper_id: "PaperA-01",
      doi_or_url: doiOrUrl,
      preferred_note: "reading-note.md",
      preview_note: true,
    }

    await buildPrivateLibrary(fixture)
    const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
    assert.equal(index.papers[0].doi_or_url, doiOrUrl)
    assert.equal(index.papers[0].note_preview_url, "../../local_library_data/notes/papera-01/preferred.html")
  }
})

test("builds one controlled preview for every resolved preferred note", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/Alpha-01_论文精读.md", "# Alpha")
  await put(fixture.sourceRoot, "Paper B/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper B/Beta-01_论文精读.md", "# Beta")
  const catalogs = {
    main_papers: {
      version: 1,
      papers: {
        "main_papers::Paper A": { paper_id: "Alpha-01" },
        "main_papers::Paper B": { paper_id: "Beta-01" },
      },
      warnings: [],
    },
  }

  const result = await buildPrivateLibrary({ ...fixture, catalogs })
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))

  assert.equal(result.previewCount, 2)
  assert.equal(result.pageCount, 4)
  assert.deepEqual(index.papers.map((paper) => paper.note_status), ["notes_ready", "notes_ready"])
  await stat(join(fixture.repoRoot, "local_library_data/notes/alpha-01/preferred.html"))
  await stat(join(fixture.repoRoot, "local_library_data/notes/beta-01/preferred.html"))
})

test("keeps exact exclusion audit details out of the generated paper index", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Included/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Excluded/paper.pdf", "pdf")
  fixture.overrides.papers["main_papers::Excluded"] = {
    include: false,
    exclude_reason: "continuous_time_out_of_scope",
  }

  const result = await buildPrivateLibrary(fixture)
  const indexText = await readFile(join(fixture.repoRoot, "local_library_data/paper-index.json"), "utf8")
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.equal(result.paperCount, 1)
  assert.equal(indexText.includes("Excluded"), false)
  assert.equal(indexText.includes("continuous_time_out_of_scope"), false)
  assert.deepEqual(audit.excluded_units, [{
    source_id: "main_papers",
    relative_path: "Excluded",
    reason: "continuous_time_out_of_scope",
  }])
})

test("forbidden note overrides never generate a paper index or preview body", async () => {
  const cases = [
    { label: "sibling-ocr", pdf: "Paper.pdf", candidate: "Paper.md", pathOnly: false, expected: /笔记覆盖目标无效/ },
    { label: "sibling-ocr-markdown", pdf: "Paper.pdf", candidate: "Paper.markdown", pathOnly: false, expected: /笔记覆盖目标无效/ },
    { label: "underscore-ocr", pdf: "paper.pdf", candidate: "paper_OCR.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "hyphen-ocr", pdf: "paper.pdf", candidate: "paper-ocr.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "mixed-case-ocr", pdf: "paper.pdf", candidate: "PaPeR_oCr.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "translation", pdf: "paper.pdf", candidate: "Paper_中文翻译.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "derivation", pdf: "paper.pdf", candidate: "proof-notes.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "simulation", pdf: "paper.pdf", candidate: "simulation.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "log", pdf: "paper.pdf", candidate: "translation.log", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "non-markdown", pdf: "paper.pdf", candidate: "legacy-note.txt", pathOnly: true, expected: /artifact_overrides\.note/ },
  ]

  for (const fixtureCase of cases) {
    for (const withPreferred of [false, true]) {
      const fixture = await makeFixture()
      await put(fixture.sourceRoot, `Paper/${fixtureCase.pdf}`, "pdf")
      await put(fixture.sourceRoot, `Paper/${fixtureCase.candidate}`, "PRIVATE_FORBIDDEN_PREVIEW_BODY")
      fixture.overrides.papers["main_papers::Paper"] = {
        paper_id: "Probe-01",
        artifact_overrides: { note: [`Paper/${fixtureCase.candidate}`] },
        ...(withPreferred ? { preferred_note: fixtureCase.candidate } : {}),
      }

      const error = await rejectedBuild(() => buildPrivateLibrary(fixture))
      assert.match(
        error.message,
        withPreferred && fixtureCase.pathOnly ? /preferred_note/ : fixtureCase.expected,
        `${fixtureCase.label}:${withPreferred}`,
      )
      assert.equal(error.message.includes("PRIVATE_FORBIDDEN_PREVIEW_BODY"), false)
      assert.equal(error.message.includes(fixture.sourceRoot), false)
      assert.equal(error.message.includes(fixtureCase.candidate), false)
      assert.equal(await exists(join(fixture.repoRoot, "local_library_data")), false)
      assert.equal(await exists(join(fixture.repoRoot, "local_library_output")), false)
    }
  }
})

test("an arbitrary historical Markdown note still builds one controlled preview", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper/historical.md", "# Historical note")
  fixture.overrides.papers["main_papers::Paper"] = {
    paper_id: "Probe-01",
    artifact_overrides: { note: ["Paper/historical.md"] },
    preferred_note: "historical.md",
  }

  const result = await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const preview = await readFile(join(fixture.repoRoot, "local_library_data/notes/probe-01/preferred.html"), "utf8")

  assert.equal(result.previewCount, 1)
  assert.equal(index.papers[0].note_status, "notes_ready")
  assert.equal(index.papers[0].preferred_note, "historical.md")
  assert.equal(preview, "<h1>Historical note</h1>\n")
})

test("blocking duplicate IDs fail before swapping existing generated directories", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "a")
  await put(fixture.sourceRoot, "Paper B/paper.pdf", "b")
  fixture.overrides.papers = {
    "main_papers::Paper A": { paper_id: "Duplicate-01" },
    "main_papers::Paper B": { paper_id: "Duplicate-01" },
  }
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")

  await assert.rejects(() => buildPrivateLibrary(fixture), /扫描存在阻塞问题/)
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
})

test("path-escaping explicit IDs fail before generation", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "a")
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "../escape" }

  await assert.rejects(() => buildPrivateLibrary(fixture), /paper_id 格式无效/)
  assert.equal(await exists(join(fixture.repoRoot, "local_library_data")), false)
  assert.equal(await exists(join(fixture.repoRoot, "local_library_output")), false)
})

test("assertGeneratedPath accepts only exact direct-child generated names", async () => {
  const fixture = await makeFixture()
  const valid = [
    ["local_library_data", "target"],
    [`.local_library_data.next-${process.pid}`, "stage"],
    [`.local_library_data.previous-${process.pid}`, "previous"],
  ]
  for (const [name, kind] of valid) {
    assert.equal(
      assertGeneratedPath({ repoRoot: fixture.repoRoot, candidate: join(fixture.repoRoot, name), targetBasename: "local_library_data", kind }),
      join(resolve(fixture.repoRoot), name),
    )
  }

  const rejected = [
    { candidate: join(fixture.repoRoot, "nested/local_library_data"), kind: "target" },
    { candidate: `${fixture.repoRoot}/nested/../local_library_data`, kind: "target" },
    { candidate: join(dirname(fixture.repoRoot), "local_library_data"), kind: "target" },
    { candidate: join(fixture.repoRoot, `.local_library_data.next-${process.pid + 1}`), kind: "stage" },
    { candidate: join(fixture.repoRoot, ".local_library_data.previous-x"), kind: "previous" },
  ]
  for (const entry of rejected) {
    assert.throws(
      () => assertGeneratedPath({ repoRoot: fixture.repoRoot, candidate: entry.candidate, targetBasename: "local_library_data", kind: entry.kind }),
      /拒绝非生成目录路径/,
    )
  }
})

test("assertGeneratedPath rejects existing symlinks and non-directory generated paths", async () => {
  const fixture = await makeFixture()
  const outside = await mkdtemp(join(tmpdir(), "paper-build-outside-"))
  await symlink(outside, join(fixture.repoRoot, "local_library_data"))
  assert.throws(
    () => assertGeneratedPath({ repoRoot: fixture.repoRoot, candidate: join(fixture.repoRoot, "local_library_data"), targetBasename: "local_library_data", kind: "target" }),
    /符号链接|目录/,
  )

  const second = await makeFixture()
  await put(second.repoRoot, "local_library_data", "file")
  assert.throws(
    () => assertGeneratedPath({ repoRoot: second.repoRoot, candidate: join(second.repoRoot, "local_library_data"), targetBasename: "local_library_data", kind: "target" }),
    /目录/,
  )
})

test("generated-directory transaction restores both old sentinels when the second stage swap fails", async () => {
  const fixture = await makeFixture()
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")
  const failingRename = async (from, to) => {
    if (from.endsWith(`.local_library_output.next-${process.pid}`)) throw new Error("sentinel failure")
    await rename(from, to)
  }

  await assert.rejects(
    () => guardedReplaceGeneratedDirectories({
      repoRoot: fixture.repoRoot,
      specifications: [
        { basename: "local_library_data", populate: (stage) => put(stage, "sentinel.txt", "new-data") },
        { basename: "local_library_output", populate: (stage) => put(stage, "sentinel.txt", "new-output") },
      ],
      renamePath: failingRename,
    }),
    /生成目录切换失败/,
  )

  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
  assert.equal(await exists(join(fixture.repoRoot, `.local_library_data.previous-${process.pid}`)), false)
  assert.equal(await exists(join(fixture.repoRoot, `.local_library_output.previous-${process.pid}`)), false)
  assert.equal(await exists(join(fixture.repoRoot, `.local_library_data.next-${process.pid}`)), false)
  assert.equal(await exists(join(fixture.repoRoot, `.local_library_output.next-${process.pid}`)), false)
})

test("post-publish previous cleanup failure keeps the committed generated directories successful", async () => {
  const fixture = await makeFixture()
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")
  const removePath = async (candidate, options) => {
    if (candidate.includes(`.previous-${process.pid}`)) {
      throw Object.assign(new Error("injected previous cleanup failure"), { code: "EACCES" })
    }
    return rm(candidate, options)
  }

  await guardedReplaceGeneratedDirectories({
    repoRoot: fixture.repoRoot,
    specifications: [
      { basename: "local_library_data", populate: (stage) => put(stage, "sentinel.txt", "new-data") },
      { basename: "local_library_output", populate: (stage) => put(stage, "sentinel.txt", "new-output") },
    ],
    removePath,
  })

  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "new-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "new-output")
  assert.equal(await readFile(join(fixture.repoRoot, `.local_library_data.previous-${process.pid}/sentinel.txt`), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, `.local_library_output.previous-${process.pid}/sentinel.txt`), "utf8"), "old-output")
})

test("a pre-existing previous directory fails closed without deleting it", async () => {
  const fixture = await makeFixture()
  await put(fixture.repoRoot, `.local_library_data.previous-${process.pid}/sentinel.txt`, "suspicious")

  await assert.rejects(
    () => guardedReplaceGeneratedDirectories({
      repoRoot: fixture.repoRoot,
      specifications: [{ basename: "local_library_data", populate: () => {} }],
    }),
    /旧备份目录已存在/,
  )
  assert.equal(await readFile(join(fixture.repoRoot, `.local_library_data.previous-${process.pid}/sentinel.txt`), "utf8"), "suspicious")
})

test("buildPrivateLibrary accepts only the fixed regular template inside the repository", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  const outside = await mkdtemp(join(tmpdir(), "paper-template-outside-"))
  await put(outside, "library.template.html", "outside")
  await assert.rejects(() => buildPrivateLibrary({ ...fixture, templateRoot: outside }), /模板目录必须位于项目内/)

  const second = await makeFixture()
  await put(second.sourceRoot, "Paper A/paper.pdf", "pdf")
  const externalTemplate = await put(outside, "external.template.html", "external")
  await rm(join(second.templateRoot, "library.template.html"))
  await symlink(externalTemplate, join(second.templateRoot, "library.template.html"))
  await assert.rejects(
    () => buildPrivateLibrary(second),
    /模板/,
  )
})

test("preview reading rejects non-Markdown, invalid UTF-8, and oversized note artifacts before swapping", async () => {
  const cases = [
    ["reading-note.txt", "plain", /Markdown/],
    ["reading-note.md", Buffer.from([0xff, 0xfe]), /UTF-8/],
    ["reading-note.md", Buffer.alloc(1024 * 1024 + 1, 97), /大小限制/],
  ]
  for (const [noteName, content, expected] of cases) {
    const fixture = await makeFixture()
    await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
    await put(fixture.sourceRoot, `Paper A/${noteName}`, content)
    fixture.overrides.papers["main_papers::Paper A"] = {
      paper_id: "PaperA-01",
      preferred_note: noteName,
      preview_note: true,
    }
    await assert.rejects(() => buildPrivateLibrary(fixture), expected)
    assert.equal(await exists(join(fixture.repoRoot, "local_library_data")), false)
  }
})

test("preview reading rejects a paper unit replaced by an external directory after scanning", async () => {
  const fixture = await makeFixture()
  const paperDirectory = join(fixture.sourceRoot, "Paper A")
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  await put(fixture.sourceRoot, "Paper A/reading-note.md", "# original")
  fixture.overrides.papers["main_papers::Paper A"] = {
    paper_id: "PaperA-01",
    preferred_note: "reading-note.md",
    preview_note: true,
  }
  await put(fixture.repoRoot, "local_library_data/sentinel.txt", "old-data")
  await put(fixture.repoRoot, "local_library_output/sentinel.txt", "old-output")
  const externalDirectory = await mkdtemp(join(tmpdir(), "paper-preview-external-"))
  await put(externalDirectory, "reading-note.md", "# replaced")
  const scanAndReplace = async (options) => {
    const result = await scanPaperSources(options)
    await rm(paperDirectory, { recursive: true })
    await symlink(externalDirectory, paperDirectory)
    return result
  }

  await assert.rejects(
    () => buildPrivateLibrary({ ...fixture, scan: scanAndReplace }),
    /论文单元.*变化|符号链接/,
  )
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.equal(await readFile(join(fixture.repoRoot, "local_library_output/sentinel.txt"), "utf8"), "old-output")
})

test("CLI main is import-safe, uses fixed relative config paths, and redacts build errors", async () => {
  const fixture = await makeFixture()
  const stdout = []
  const stderr = []
  const context = { marker: "loaded-context" }
  const calls = []
  const code = await runBuildCli({
    repoRoot: fixture.repoRoot,
    loadContext: async (input) => { calls.push(["load", input]); return context },
    rebuild: async (input) => {
      calls.push(["rebuild", input])
      return { paperCount: 3, previewCount: 1, pageCount: 2, excludedCount: 0 }
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  })

  assert.equal(code, 0)
  assert.deepEqual(calls, [
    ["load", { repoRoot: fixture.repoRoot }],
    ["rebuild", { repoRoot: fixture.repoRoot, context }],
  ])
  assert.match(stdout.join("\n"), /论文记录：3/)
  assert.match(stdout.join("\n"), /local_library_data\/paper-index\.json/)
  assert.deepEqual(stderr, [])

  const privateName = ["secret", "reading-note.md"].join("/")
  const failed = await runBuildCli({
    repoRoot: fixture.repoRoot,
    loadContext: async () => { throw new Error(privateName) },
    rebuild: async () => { throw new Error("unused") },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  })
  assert.equal(failed, 1)
  assert.equal(stderr.at(-1), "私有论文库构建失败。请检查本机配置、覆盖映射和审计边界。")
  assert.equal(stderr.at(-1).includes(privateName), false)
})

test("build writes the facet schema and strips legacy composite filters", async () => {
  const fixture = await makeFixture()
  await put(fixture.sourceRoot, "Paper A/paper.pdf", "pdf")
  fixture.overrides.papers["main_papers::Paper A"] = { paper_id: "PaperA-01" }
  const tagCatalog = {
    version: 3,
    papers: {
      "PaperA-01": {
        record_type: "外部论文",
        facets: {
          ...createEmptyFacets(),
          constraints: { ...createEmptyFacets().constraints, scope: ["耦合约束"] },
        },
        facet_states: { results: "pending_verification", applications: "not_applicable" },
        source_terms: ["Tracking-ADMM"],
      },
    },
  }

  await buildPrivateLibrary({ ...fixture, tagCatalog })
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  const audit = await readJson(join(fixture.repoRoot, "local_library_data/paper-library-audit.json"))

  assert.equal(index.version, 3)
  assert.equal(index.facet_schema.version, 2)
  assert.deepEqual(index.papers[0].facets.constraints.scope, ["耦合约束"])
  assert.deepEqual(index.papers[0].facet_states, {
    results: "pending_verification",
    applications: "not_applicable",
  })
  assert.deepEqual(index.papers[0].source_terms, ["Tracking-ADMM"])
  assert.equal(Object.hasOwn(index.papers[0], "topic_l2"), false)
  assert.equal(index.papers[0].metadata_provenance.facets, "tag_catalog")
  assert.equal(index.papers[0].metadata_provenance.facet_states, "tag_catalog")
  assert.deepEqual(audit.tagging, { tagged_count: 1, pending_paper_ids: [], unmatched_paper_ids: [], schema_version: 3 })
})

test("local configuration declares the real catalog and only stable manual decisions", async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const config = await loadLibraryConfig(join(repoRoot, "local_library_config/library.local.json"))
  const overrides = await loadPaperOverrides(join(repoRoot, "local_library_config/paper-overrides.json"))
  const thesisRoot = "main_papers::04_零阶与Bandit优化/综合与学位论文/Li (2025) Thesis distributed stochastic gradient-free"
  const chapter03 = `${thesisRoot}/第三章`
  const chapter05 = `${thesisRoot}/第五章`
  const excluded = "main_papers::02_约束分布式优化/耦合约束与原始对偶/Liu (2022) Continuous-time finite-time consensus distributed optimization"
  const retainedPreview = "main_papers::06_分布式学习与应用/联邦学习基础与去中心化方法/McMahan (2017) Communication-efficient learning of deep networks from decentralized data"
  const topicGuides = "main_papers::00_索引与专题综述/主题导读"
  const authorReview = "main_papers::00_索引与专题综述/作者与研究线"
  const linearGraphReport = "main_papers::01_基础与网络机制/有向_时变网络与偏斜修正/Liu (2024) Linear convergence time-varying unbalanced graphs"
  const proximalTracking = "main_papers::02_约束分布式优化/局部与非一致约束/Li (2025) 有向图分布式Proximal-Tracking"
  const primalDualSplitting = "main_papers::02_约束分布式优化/耦合约束与原始对偶/Tang (2026) 原始对偶分裂"
  const zhao24Dfl = "main_papers::06_分布式学习与应用/联邦学习基础与去中心化方法/Zhao (2024) Decentralized online bandit federated learning"
  const zhao25Depsfl = "main_papers::06_分布式学习与应用/联邦学习基础与去中心化方法/Zhao (2025) Differential privacy federated learning IoV"
  const zhaoResearchLine = "main_papers::赵中原"
  const papersRoot = ["", "Users", "yangfan", "Desktop", "papers"].join("/")

  assert.deepEqual(config.sources, [{
    source_id: "main_papers",
    path: `${papersRoot}/论文`,
    catalog_path: `${papersRoot}/1.目录.md`,
  }])
  assert.deepEqual(Object.keys(overrides.papers).sort(), [
    topicGuides,
    authorReview,
    linearGraphReport,
    proximalTracking,
    excluded,
    primalDualSplitting,
    thesisRoot,
    chapter03,
    chapter05,
    retainedPreview,
    zhao24Dfl,
    zhao25Depsfl,
    zhaoResearchLine,
  ].sort())
  assert.deepEqual(overrides.papers[thesisRoot], {
    paper_id: "Li25-TSGF",
    unit_type: "thesis",
    title_original: "Li25-TSGF：时变不平衡网络下非光滑凸优化的分布式随机算法研究",
  })
  assert.equal(overrides.papers[chapter03].paper_id, "Li25-TSGF-C03")
  assert.equal(overrides.papers[chapter03].unit_type, "chapter")
  assert.equal(overrides.papers[chapter03].parent_paper_id, "Li25-TSGF")
  assert.equal(overrides.papers[chapter05].paper_id, "Li25-TSGF-C05")
  assert.equal(overrides.papers[chapter05].unit_type, "chapter")
  assert.equal(overrides.papers[chapter05].parent_paper_id, "Li25-TSGF")
  assert.deepEqual(overrides.papers[excluded], {
    include: false,
    exclude_reason: "continuous_time_out_of_scope",
  })
  assert.ok(Object.values(overrides.papers).every((override) => !String(override.paper_id ?? "").startsWith("LIB-")))
})
