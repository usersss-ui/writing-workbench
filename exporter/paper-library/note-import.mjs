import { createHash, randomUUID } from "node:crypto"
import { constants as nodeFsConstants } from "node:fs"
import * as nodeFsPromises from "node:fs/promises"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path"
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

export function createInspectionStore({
  now = Date.now,
  randomId = randomUUID,
  ttlMs = 10 * 60 * 1000,
} = {}) {
  if (typeof now !== "function" || typeof randomId !== "function" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("检查记录配置无效")
  }
  const records = new Map()

  function prune() {
    const instant = now()
    for (const [id, record] of records) if (record.expiresAt <= instant) records.delete(id)
  }

  function cloneRecord(record) {
    const { bytes, expiresAt, ...data } = record
    return { ...structuredClone(data), bytes: Buffer.from(bytes), expiresAt }
  }

  function create(snapshot) {
    prune()
    const inspection_id = randomId()
    if (typeof inspection_id !== "string" || inspection_id.length === 0 || records.has(inspection_id)) {
      throw new NoteImportError("INSPECTION_INVALID", "无法创建检查记录")
    }
    const expiresAt = now() + ttlMs
    const { bytes, ...data } = snapshot ?? {}
    if (!(bytes instanceof Uint8Array)) throw new NoteImportError("INSPECTION_INVALID", "检查记录无效")
    records.set(inspection_id, { ...structuredClone(data), bytes: Buffer.from(bytes), expiresAt })
    return { inspection_id, expires_at: new Date(expiresAt).toISOString() }
  }

  function read(id, consume) {
    const record = records.get(id)
    if (!record) throw new NoteImportError("INSPECTION_INVALID", "检查记录无效")
    if (record.expiresAt <= now()) {
      records.delete(id)
      throw new NoteImportError("INSPECTION_EXPIRED", "检查记录已过期")
    }
    if (consume) records.delete(id)
    return cloneRecord(record)
  }

  return {
    create,
    peek: (id) => read(id, false),
    take: (id) => read(id, true),
    size: () => { prune(); return records.size },
  }
}

function importFs(fs) {
  return {
    constants: fs?.constants ?? nodeFsConstants,
    lstat: fs?.lstat ?? nodeFsPromises.lstat,
    open: fs?.open ?? nodeFsPromises.open,
    readFile: fs?.readFile ?? nodeFsPromises.readFile,
    realpath: fs?.realpath ?? nodeFsPromises.realpath,
    unlink: fs?.unlink ?? nodeFsPromises.unlink,
  }
}

function insideDirectory(parent, candidate) {
  const fromParent = relative(parent, candidate)
  return fromParent !== ""
    && fromParent !== ".."
    && !fromParent.startsWith(`..${sep}`)
    && !isAbsolute(fromParent)
}

function mappingChanged() {
  return new NoteImportError("PAPER_MAPPING_CHANGED", "论文目录映射已变化")
}

function unsafeTarget() {
  return new NoteImportError("UNSAFE_TARGET", "目标目录不满足安全边界")
}

async function verifyDirectory(fs, directory) {
  let lexical
  let canonical
  try {
    lexical = await fs.lstat(directory)
    canonical = await fs.realpath(directory)
  } catch {
    throw unsafeTarget()
  }
  if (lexical.isSymbolicLink() || !lexical.isDirectory() || canonical !== resolve(directory)) throw unsafeTarget()
  return canonical
}

async function verifyTargetHierarchy(fs, sourceRoot, unitDirectory) {
  const canonicalSource = await verifyDirectory(fs, sourceRoot)
  const canonicalUnit = await verifyDirectory(fs, unitDirectory)
  if (!insideDirectory(canonicalSource, canonicalUnit)) throw unsafeTarget()
  const segments = relative(canonicalSource, canonicalUnit).split(sep)
  let current = canonicalSource
  for (const segment of segments) {
    current = join(current, segment)
    let info
    try { info = await fs.lstat(current) } catch { throw unsafeTarget() }
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafeTarget()
  }
  return canonicalUnit
}

function fingerprintMatches(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.sha256 === right.sha256
}

async function fingerprintFile(fs, path) {
  let lexical
  let handle
  try {
    lexical = await fs.lstat(path)
    if (lexical.isSymbolicLink() || !lexical.isFile()) throw unsafeTarget()
    handle = await fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== lexical.dev || opened.ino !== lexical.ino || opened.size !== lexical.size) {
      throw unsafeTarget()
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== opened.size) throw unsafeTarget()
    return {
      dev: opened.dev,
      ino: opened.ino,
      size: opened.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } finally {
    if (handle) await handle.close()
  }
}

function versionedFileName(requestedFileName, version) {
  const extension = extname(requestedFileName)
  return `${requestedFileName.slice(0, -extension.length)}_v${version}${extension}`
}

async function createExclusiveNote(fs, unitDirectory, requestedFileName, bytes) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW
  for (let version = 1; version < 100_000; version += 1) {
    const fileName = version === 1 ? requestedFileName : versionedFileName(requestedFileName, version)
    const path = join(unitDirectory, fileName)
    let handle
    try {
      handle = await fs.open(path, flags, 0o600)
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw new NoteImportError("WRITE_FAILED", "无法新建笔记", { fileName })
      }
      try {
        const existing = await fs.lstat(path)
        if (existing.isSymbolicLink()) throw unsafeTarget()
      } catch (inspectionError) {
        if (inspectionError?.code === "UNSAFE_TARGET") throw inspectionError
        throw new NoteImportError("WRITE_FAILED", "无法检查同名笔记", { fileName })
      }
      continue
    }

    try {
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = null
      return { fileName, path }
    } catch {
      if (handle) {
        try { await handle.close() } catch {}
      }
      try { await fs.unlink(path) } catch {}
      throw new NoteImportError("WRITE_FAILED", "无法新建笔记", { fileName })
    }
  }
  throw new NoteImportError("WRITE_FAILED", "无法新建笔记")
}

function buildOutputError() {
  return new NoteImportError("BUILD_OUTPUT_INVALID", "重建结果无法确认新增笔记")
}

function validateGeneratedPreview(value) {
  return typeof value === "string"
    && /^\.\.\/\.\.\/local_library_data\/notes\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:note|derivation|source_map|modeling|simulation|code_compare|reproduction_report)\/[a-f0-9]{64}\.html$/u.test(value)
}

export async function importInspectedNote({
  repoRoot,
  snapshot,
  requestedFileName,
  conflictPolicy,
  loadContext,
  rebuild,
  fs: injectedFs,
} = {}) {
  const fs = importFs(injectedFs)
  if (!snapshot || !(snapshot.bytes instanceof Uint8Array)) {
    throw new NoteImportError("INSPECTION_INVALID", "检查记录无效")
  }
  const snapshotBytes = Buffer.from(snapshot.bytes)
  if (
    createHash("sha256").update(snapshotBytes).digest("hex") !== snapshot.sha256
    || snapshot.checks?.can_import !== true
    || conflictPolicy !== "version"
  ) {
    throw new NoteImportError("INSPECTION_INVALID", "检查记录无效")
  }
  const actualRequestedFileName = validateRequestedFileName(requestedFileName, {
    paperId: snapshot.paper_id,
    category: snapshot.category,
  })
  if (typeof loadContext !== "function" || typeof rebuild !== "function") {
    throw new TypeError("导入运行依赖无效")
  }

  const context = await loadContext({ repoRoot })
  const currentPaper = context?.papersById?.get(snapshot.paper_id)
  const currentUnitDirectory = context?.unitDirectoryByPaperId?.get(snapshot.paper_id)
  if (
    !currentPaper
    || currentPaper.source_id !== snapshot.source_id
    || currentPaper.relative_path !== snapshot.relative_path
    || currentUnitDirectory !== snapshot.unit_real_path
  ) throw mappingChanged()

  const matchingSources = (context.config?.sources ?? []).filter((source) => source.source_id === snapshot.source_id)
  if (matchingSources.length !== 1) throw mappingChanged()
  const canonicalUnit = await verifyTargetHierarchy(fs, matchingSources[0].path, currentUnitDirectory)
  if (canonicalUnit !== snapshot.unit_real_path) throw mappingChanged()

  const created = await createExclusiveNote(fs, canonicalUnit, actualRequestedFileName, snapshotBytes)
  const createdFingerprint = await fingerprintFile(fs, created.path)

  try {
    await rebuild({ repoRoot, context })
  } catch {
    try {
      const currentFingerprint = await fingerprintFile(fs, created.path)
      if (!fingerprintMatches(createdFingerprint, currentFingerprint)) throw new Error("fingerprint changed")
      await fs.unlink(created.path)
    } catch {
      throw new NoteImportError("ROLLBACK_FAILED", "自动回滚失败", { fileName: created.fileName })
    }
    throw new NoteImportError("BUILD_FAILED", "论文库重建失败", { fileName: created.fileName })
  }

  let indexBytes
  let index
  try {
    indexBytes = await fs.readFile(join(repoRoot, "local_library_data/paper-index.json"))
    index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes))
  } catch {
    throw buildOutputError()
  }
  const generatedPaper = Array.isArray(index?.papers)
    ? index.papers.find((paper) => paper?.paper_id === snapshot.paper_id)
    : null
  const documents = generatedPaper?.controlled_preview_documents?.[snapshot.category]
  const matches = Array.isArray(documents)
    ? documents.filter((document) => document?.label === created.fileName && validateGeneratedPreview(document?.url))
    : []
  if (matches.length !== 1) throw buildOutputError()

  return {
    paper_id: snapshot.paper_id,
    actual_file_name: created.fileName,
    target_tab: snapshot.target_tab,
    new_preview_url: matches[0].url,
    index_version: createHash("sha256").update(indexBytes).digest("hex"),
  }
}
