import { readFile } from "node:fs/promises"
import posix from "node:path/posix"

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
const PAPER_ID_PATTERN = /^[A-Za-z][A-Za-z]*\d{2}-[A-Za-z0-9-]+$/

function validateSourceId(sourceId) {
  if (typeof sourceId !== "string" || !SOURCE_ID_PATTERN.test(sourceId)) throw new Error("sourceId 格式无效")
}

function extractCatalogAsset(line) {
  const markdownLink = line.match(/\[(PDF|OCR)\]\(\s*<([^>]+)>\s*\)/u)
  if (markdownLink) return { kind: markdownLink[1].toLowerCase(), path: markdownLink[2] }
  const wikiLink = line.match(/\[\[([^\]|]+)\|(PDF|OCR)\]\]/u)
  if (wikiLink) return { kind: wikiLink[2].toLowerCase(), path: wikiLink[1] }
  return null
}

function unitPathFromCatalogAsset({ kind, path: rawPath }) {
  if (
    typeof rawPath !== "string"
    || rawPath.startsWith("/")
    || rawPath.startsWith("\\")
    || /^[A-Za-z]:[\\/]/u.test(rawPath)
    || rawPath.split(/[\\/]+/u).includes("..")
  ) throw new Error("PDF 路径无效")

  const normalized = posix.normalize(rawPath.replaceAll("\\", "/"))
  const requiredExtension = kind === "pdf" ? ".pdf" : ".md"
  if (!normalized.startsWith("论文/") || !normalized.toLowerCase().endsWith(requiredExtension)) throw new Error("PDF 路径无效")
  const relativePdfPath = normalized.slice("论文/".length)
  const unitPath = posix.dirname(relativePdfPath)
  if (!relativePdfPath || unitPath === "." || unitPath === ".." || unitPath.startsWith("../")) throw new Error("PDF 路径无效")
  return unitPath
}

function parseCatalogLine(line, { sourceId }) {
  const title = line.match(/\*\*([^*]+)\*\*/u)?.[1]?.trim()
  const details = line.match(/\*\*[^*]+\*\*\s+—\s+(.+?)\s+—\s+\*([^*]+)\*,\s*(\d{4})/u)
  const asset = extractCatalogAsset(line)
  if (!title || !details || !asset) return null

  const codes = [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1].trim())
  const paperId = codes[0]
  if (!PAPER_ID_PATTERN.test(paperId)) throw new Error("paper_id 格式无效")

  const unitPath = unitPathFromCatalogAsset(asset)
  const authors = details[1].split(",").map((author) => author.trim()).filter(Boolean)
  const venue = details[2].trim()
  const year = Number(details[3])
  const doiOrUrl = line.match(/\[DOI\]\((https?:\/\/[^)\s]+)\)/u)?.[1] ?? ""
  const metadata = Object.freeze({
    paper_id: paperId,
    title_original: title,
    authors: Object.freeze(authors),
    publication_year: year,
    year,
    venue,
    doi_or_url: doiOrUrl,
    metadata_provenance: Object.freeze({
      paper_id: "catalog", title_original: "catalog", authors: "catalog",
      publication_year: "catalog", year: "catalog", venue: "catalog", doi_or_url: "catalog",
    }),
  })
  return { key: `${sourceId}::${unitPath}`, metadata }
}

export function parsePaperCatalog(markdown, { sourceId } = {}) {
  validateSourceId(sourceId)
  const papers = {}
  const warnings = []
  for (const [index, line] of String(markdown).split(/\r?\n/u).entries()) {
    if (!line.startsWith("- [") || !line.includes("📎")) continue
    const record = parseCatalogLine(line, { sourceId })
    if (!record) {
      warnings.push(`catalog_line_unmatched:${index + 1}`)
      continue
    }
    if (papers[record.key]) throw new Error(`目录路径重复: ${record.key}`)
    papers[record.key] = record.metadata
  }
  return Object.freeze({ version: 1, papers: Object.freeze(papers), warnings: Object.freeze(warnings) })
}

export async function loadPaperCatalog(catalogPath, { sourceId } = {}) {
  const markdown = await readFile(catalogPath, "utf8")
  return parsePaperCatalog(markdown, { sourceId })
}
