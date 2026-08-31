import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadPaperCatalog, parsePaperCatalog } from "./catalog-adapter.mjs"

test("parses one explicit catalog line by its PDF unit path", () => {
  const markdown = "- [x] [ ] **A Paper** — Liu H, Yu W — *Automatica*, 2024 — [DOI](https://doi.org/10.1/example) — `Liu24-AP` `离散时间` 📎 [PDF](<论文/02_topic/Liu (2024) A Paper/A Paper.pdf>)"

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.deepEqual(catalog.papers["main_papers::02_topic/Liu (2024) A Paper"], {
    paper_id: "Liu24-AP",
    title_original: "A Paper",
    authors: ["Liu H", "Yu W"],
    publication_year: 2024,
    year: 2024,
    venue: "Automatica",
    doi_or_url: "https://doi.org/10.1/example",
    metadata_provenance: {
      paper_id: "catalog", title_original: "catalog", authors: "catalog",
      publication_year: "catalog", year: "catalog", venue: "catalog", doi_or_url: "catalog",
    },
  })
})

test("parses an Obsidian PDF link using the PDF parent as its unit path", () => {
  const markdown = "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [[论文/topic/unit/paper.pdf|PDF]]"

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.equal(catalog.papers["main_papers::topic/unit"].paper_id, "Liu24-AP")
})

test("parses an explicit OCR Markdown link without needing a PDF link", () => {
  const markdown = "- [ ] **有向图 Distributed Optimization** — Zhang S — *控制理论与应用*, 2025 — `Zhang25-DGDO` 📎 [OCR](<论文/03_优化/Zhang (2025) 有向图/全文 OCR.md>)"

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.deepEqual(catalog.papers["main_papers::03_优化/Zhang (2025) 有向图"].authors, ["Zhang S"])
})

test("parses an explicit OCR Obsidian link without needing a PDF link", () => {
  const markdown = "- [ ] **OCR Only** — Wang Q — *Venue*, 2025 — `Wang25-OCR` 📎 [[论文/topic/ocr-only/全文 OCR.md|OCR]]"

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.equal(catalog.papers["main_papers::topic/ocr-only"].paper_id, "Wang25-OCR")
})

test("keeps a mixed-script title verbatim while paths, not titles, form distinct keys", () => {
  const title = "中文 Title: Directed 图优化"
  const markdown = [
    `- [ ] **${title}** — Zhang S — *Venue*, 2025 — \`Zhang25-DGDO\` 📎 [PDF](<论文/topic/first/paper.pdf>)`,
    `- [ ] **${title}** — Li M — *Venue*, 2025 — \`Li25-DGDO\` 📎 [PDF](<论文/topic/second/paper.pdf>)`,
  ].join("\n")

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.equal(catalog.papers["main_papers::topic/first"].title_original, title)
  assert.equal(catalog.papers["main_papers::topic/second"].title_original, title)
  assert.deepEqual(Object.keys(catalog.papers), ["main_papers::topic/first", "main_papers::topic/second"])
})

test("rejects duplicate unit paths instead of fuzzy-merging titles", () => {
  const line = "- [x] [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [PDF](<论文/topic/unit/paper.pdf>)"

  assert.throws(() => parsePaperCatalog(`${line}\n${line}`, { sourceId: "main_papers" }), /目录路径重复/)
})

test("rejects non-catalog PDF paths that are absolute or traverse parents", () => {
  const absolute = "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [PDF](</论文/topic/unit/paper.pdf>)"
  const traversal = "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [[论文/topic/../unit/paper.pdf|PDF]]"

  assert.throws(() => parsePaperCatalog(absolute, { sourceId: "main_papers" }), /PDF 路径无效/)
  assert.throws(() => parsePaperCatalog(traversal, { sourceId: "main_papers" }), /PDF 路径无效/)
})

test("rejects Windows drive, UNC, and non-论文 PDF paths", () => {
  const drivePath = ["C:", "论文", "topic", "unit", "paper.pdf"].join("\\")
  const uncPath = ["", "", "server", "papers", "topic", "unit", "paper.pdf"].join("\\")
  const drive = `- [ ] **A Paper** — Liu H — *Venue*, 2024 — \`Liu24-AP\` 📎 [PDF](<${drivePath}>)`
  const unc = `- [ ] **A Paper** — Liu H — *Venue*, 2024 — \`Liu24-AP\` 📎 [PDF](<${uncPath}>)`
  const wrongRoot = "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [PDF](<archive/topic/unit/paper.pdf>)"

  assert.throws(() => parsePaperCatalog(drive, { sourceId: "main_papers" }), /PDF 路径无效/)
  assert.throws(() => parsePaperCatalog(unc, { sourceId: "main_papers" }), /PDF 路径无效/)
  assert.throws(() => parsePaperCatalog(wrongRoot, { sourceId: "main_papers" }), /PDF 路径无效/)
})

test("rejects malformed source IDs and lines without a canonical first paper code", () => {
  const withoutCanonicalCode = "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `2024-AP` 📎 [PDF](<论文/topic/unit/paper.pdf>)"

  assert.throws(() => parsePaperCatalog("", { sourceId: "Main Papers" }), /sourceId 格式无效/)
  assert.throws(() => parsePaperCatalog(withoutCanonicalCode, { sourceId: "main_papers" }), /paper_id 格式无效/)
})

test("loads a catalog file through the same parser", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-catalog-"))
  const catalogPath = join(root, "1.目录.md")
  await writeFile(catalogPath, "- [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [PDF](<论文/topic/unit/paper.pdf>)")

  const catalog = await loadPaperCatalog(catalogPath, { sourceId: "main_papers" })

  assert.equal(catalog.papers["main_papers::topic/unit"].title_original, "A Paper")
})

test("retains an unmatched catalog candidate as a warning instead of a record", () => {
  const markdown = "- [ ] this is prose 📎 [PDF](<论文/topic/unit/paper.pdf>)"

  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })

  assert.deepEqual(catalog.papers, {})
  assert.deepEqual(catalog.warnings, ["catalog_line_unmatched:1"])
})
