import { createHash } from "node:crypto"
import { basename, extname, isAbsolute, win32 } from "node:path"
import { inspectControlledImageReferences } from "./build.mjs"
import { parsePaperFrontmatter } from "./frontmatter.mjs"

export const NOTE_IMPORT_MAX_BYTES = 1024 * 1024
export const INSPECT_REQUEST_MAX_BYTES = 1_100_000
export const IMPORT_REQUEST_MAX_BYTES = 16 * 1024

export const NOTE_IMPORT_CATEGORIES = Object.freeze(Object.fromEntries(Object.entries({
  note: { label: "论文精读", marker: "论文精读", target_tab: "note" },
  derivation: { label: "推导过程", marker: "推导过程", target_tab: "derivation" },
  source_map: { label: "来源映射", marker: "source_map", target_tab: "derivation" },
  modeling: { label: "建模复盘", marker: "建模复盘", target_tab: "simulation" },
  simulation: { label: "仿真描述", marker: "仿真描述", target_tab: "simulation" },
  code_compare: { label: "代码对照", marker: "代码对比", target_tab: "code_compare" },
  reproduction_report: { label: "复现报告", marker: "复现报告", target_tab: "simulation" },
}).map(([key, value]) => [key, Object.freeze(value)])))

export class NoteImportError extends Error {
  constructor(code, message, { fileName = null } = {}) {
    super(message)
    this.name = "NoteImportError"
    this.code = code
    this.fileName = fileName
  }
}

function categoryContract(category) {
  const contract = NOTE_IMPORT_CATEGORIES[category]
  if (!contract) throw new NoteImportError("INVALID_CATEGORY", "笔记类型无效")
  return contract
}

export function suggestNoteFileName(paperId, category) {
  return `${paperId}_${categoryContract(category).marker}.md`
}

export function validateRequestedFileName(name, { paperId, category } = {}) {
  const marker = categoryContract(category).marker
  if (typeof name !== "string" || name.length === 0 || name !== name.trim()) {
    throw new NoteImportError("INVALID_FILE_NAME", "笔记文件名无效")
  }
  const normalized = name.normalize("NFKC")
  if (
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.includes("..")
    || isAbsolute(normalized)
    || win32.isAbsolute(normalized)
    || basename(normalized) !== normalized
    || extname(normalized).toLowerCase() !== ".md"
    || !normalized.includes(`${paperId}_`)
    || !normalized.includes(marker)
  ) {
    throw new NoteImportError("INVALID_FILE_NAME", "笔记文件名无效")
  }
  return normalized
}

function normalizeMetadata(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US")
}

function frontmatterState(markdown) {
  const lines = markdown.split(/\r?\n/u)
  if (lines[0] !== "---") return { closed: true, data: {} }
  const closing = lines.slice(1).findIndex((line) => line === "---")
  if (closing === -1) return { closed: false, data: {} }
  return { closed: true, data: parsePaperFrontmatter(markdown).data }
}

function withoutCode(markdown) {
  const lines = markdown.split(/\r?\n/u)
  let fence = null
  const visible = []
  for (const line of lines) {
    const match = /^\s*(```+|~~~+)/u.exec(line)
    if (match) {
      const marker = match[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      visible.push("")
      continue
    }
    visible.push(fence === null ? line.replace(/`[^`\r\n]*`/gu, "") : "")
  }
  return visible.join("\n")
}

function escapedAt(value, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function latexBalanced(markdown) {
  const source = withoutCode(markdown)
  let singles = 0
  let doubles = 0
  const stack = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && !escapedAt(source, index)) {
      if (source[index + 1] === "$" && !escapedAt(source, index + 1)) {
        doubles += 1
        index += 1
      } else {
        singles += 1
      }
      continue
    }
    if (source[index] !== "\\" || escapedAt(source, index) || index + 1 >= source.length) continue
    const token = source.slice(index, index + 2)
    if (token === "\\(" || token === "\\[") stack.push(token)
    else if (token === "\\)" || token === "\\]") {
      const expected = token === "\\)" ? "\\(" : "\\["
      if (stack.pop() !== expected) return false
    }
    if (["\\(", "\\)", "\\[", "\\]"].includes(token)) index += 1
  }
  return singles % 2 === 0 && doubles % 2 === 0 && stack.length === 0
}

function finishChecks(items) {
  const blocking_codes = items.filter((item) => item.severity === "blocking").map((item) => item.code)
  const warning_codes = items.filter((item) => item.severity === "warning").map((item) => item.code)
  return { items, blocking_codes, warning_codes, can_import: blocking_codes.length === 0 }
}

function check(items, ok, passCode, failureCode, severity, passMessage, failureMessage) {
  items.push(ok
    ? { code: passCode, severity: "pass", message: passMessage }
    : { code: failureCode, severity, message: failureMessage })
}

export async function inspectMarkdownNote({
  paper,
  unitDirectory,
  category,
  originalFileName,
  markdown,
  imageInspector = inspectControlledImageReferences,
} = {}) {
  const contract = categoryContract(category)
  if (!paper || typeof paper.paper_id !== "string" || typeof markdown !== "string") {
    throw new NoteImportError("INVALID_INSPECTION", "笔记检查参数无效")
  }
  const bytes = Buffer.from(markdown, "utf8")
  const items = []
  check(items, !markdown.includes("\uFFFD"), "UTF8_VALID", "UTF8_REPLACEMENT_CHARACTER", "blocking", "UTF-8 文本有效", "正文包含无效替换字符")
  check(items, /\.(?:md|markdown)$/iu.test(originalFileName ?? ""), "MARKDOWN_EXTENSION_VALID", "MARKDOWN_EXTENSION", "blocking", "Markdown 扩展名有效", "文件必须是 Markdown")
  check(items, bytes.byteLength <= NOTE_IMPORT_MAX_BYTES, "MARKDOWN_SIZE_VALID", "MARKDOWN_TOO_LARGE", "blocking", "Markdown 大小有效", "Markdown 超过大小限制")

  const frontmatter = frontmatterState(markdown)
  check(items, frontmatter.closed, "FRONTMATTER_CLOSED", "FRONTMATTER_UNCLOSED", "blocking", "Frontmatter 已闭合或未使用", "Frontmatter 未闭合")
  const metadata = frontmatter.closed ? frontmatter.data : {}
  const idMatches = metadata.paper_id === undefined || metadata.paper_id === paper.paper_id
  check(items, idMatches, "PAPER_ID_MATCH", "PAPER_ID_MISMATCH", "blocking", "论文编号匹配或未填写", "Frontmatter 论文编号不匹配")

  const titleCandidates = [paper.title_original, paper.title_zh, paper.title_en].filter((value) => normalizeMetadata(value))
  const titleMatches = metadata.title_original === undefined
    || titleCandidates.some((value) => normalizeMetadata(value) === normalizeMetadata(metadata.title_original))
  check(items, titleMatches, "TITLE_MATCH", "TITLE_MISMATCH", "warning", "标题匹配或未填写", "Frontmatter 标题与论文记录不同")

  const authorsMatch = metadata.authors === undefined
    || (Array.isArray(paper.authors)
      && metadata.authors.length === paper.authors.length
      && metadata.authors.every((author, index) => normalizeMetadata(author) === normalizeMetadata(paper.authors[index])))
  check(items, authorsMatch, "AUTHORS_MATCH", "AUTHORS_MISMATCH", "warning", "作者匹配或未填写", "Frontmatter 作者与论文记录不同")

  const expectedYear = paper.publication_year ?? paper.year
  const suppliedYear = metadata.publication_year ?? metadata.year
  const yearMatches = suppliedYear === undefined || expectedYear === undefined || suppliedYear === expectedYear
  check(items, yearMatches, "YEAR_MATCH", "YEAR_MISMATCH", "warning", "年份匹配或未填写", "Frontmatter 年份与论文记录不同")

  check(items, latexBalanced(markdown), "LATEX_BALANCED", "LATEX_UNBALANCED", "blocking", "LaTeX 分隔符闭合", "LaTeX 分隔符未闭合")

  const imageResults = await imageInspector({
    markdown,
    unitDirectory,
    noteRelativePath: suggestNoteFileName(paper.paper_id, category),
  })
  for (const result of imageResults) {
    if (result.status === "resolved") items.push({ code: "IMAGE_RESOLVED", severity: "pass", message: "图片引用可解析" })
    else if (result.status === "missing") items.push({ code: "IMAGE_MISSING", severity: "warning", message: "图片文件尚未找到" })
    else items.push({ code: "IMAGE_UNSAFE", severity: "blocking", message: "图片引用不满足安全边界" })
  }

  const checks = finishChecks(items)
  const suggested_file_name = suggestNoteFileName(paper.paper_id, category)
  const publicResult = {
    suggested_file_name,
    target_tab: contract.target_tab,
    checks: structuredClone(checks),
  }
  const snapshot = {
    bytes: Buffer.from(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    paper_id: paper.paper_id,
    source_id: paper.source_id,
    relative_path: paper.relative_path,
    category,
    original_file_name: originalFileName,
    suggested_file_name,
    target_tab: contract.target_tab,
    checks: structuredClone(checks),
  }
  return { publicResult, snapshot }
}
