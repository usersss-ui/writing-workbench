import {
  constants as fsConstants,
  lstatSync,
  realpathSync,
} from "node:fs"
import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { ARTIFACT_KEYS } from "./artifacts.mjs"
import { makeOverrideKey, normalizeRelativePath } from "./ids.mjs"
import { choosePreferredNote, renderControlledMarkdown } from "./note-preview.mjs"
import { scanPaperSources } from "./scanner.mjs"
import {
  CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES,
  validateControlledPreviewDocuments,
  validateGeneratedPaper,
} from "./status.mjs"
import { hasExactJsonObjectKeys, serializeFacetSchema } from "./facet-schema.mjs"
import { METADATA_PROVENANCE_FIELDS } from "./overrides.mjs"
import { applyPaperTagCatalog } from "./tag-catalog.mjs"
import { validateInstitutionConfig } from "./institution-config.mjs"

const GENERATED_BASENAMES = new Set(["local_library_data", "local_library_output"])
const NOTE_SIZE_LIMIT = 1024 * 1024
const OCR_SIZE_LIMIT = 8 * 1024 * 1024
const PDF_SIZE_LIMIT = 64 * 1024 * 1024
const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024
const SOURCE_DOCUMENT_KINDS = Object.freeze(["pdf", "ocr"])
const SOURCE_DOCUMENT_LIMITS = Object.freeze({ pdf: PDF_SIZE_LIMIT, ocr: OCR_SIZE_LIMIT })
const SOURCE_DOCUMENT_URL = Object.freeze({
  pdf: /^\.\.\/\.\.\/local_library_data\/sources\/[a-z0-9]+(?:-[a-z0-9]+)*\/pdf\/[a-f0-9]{64}\.pdf$/u,
  ocr: /^\.\.\/\.\.\/local_library_data\/sources\/[a-z0-9]+(?:-[a-z0-9]+)*\/ocr\/[a-f0-9]{64}\.html$/u,
})
const SOURCE_DOCUMENT_LABEL_LIMIT = 240
const IMAGE_MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
])
const CONTROLLED_PREVIEW_FILES = Object.freeze({
  note: "preferred.html",
  derivation: "derivation.html",
  simulation: "simulation.html",
  code_compare: "code_compare.html",
})
const GENERATED_DESKTOP_TEMPLATES = new Map([
  ["library.template.html", "library.html"],
  ["discovery.template.html", "discovery.html"],
  ["state-transfer.html", "state-transfer.html"],
])
const DESKTOP_TEMPLATE_MESSAGES = new Map([
  ["library.template.html", Object.freeze({
    missing: "固定论文库模板不存在",
    invalid: "论文库模板必须是项目内普通非符号链接文件",
  })],
  ["discovery.template.html", Object.freeze({
    missing: "固定论文发现模板不存在",
    invalid: "论文发现模板必须是项目内普通非符号链接文件",
  })],
  ["state-transfer.html", Object.freeze({
    missing: "固定浏览器状态迁移模板不存在",
    invalid: "浏览器状态迁移模板必须是项目内普通非符号链接文件",
  })],
])
const REQUIRED_DESKTOP_ASSETS = Object.freeze([
  "styles.css",
  "state-transfer.mjs",
  "bibliography-import.mjs",
  "discovery-candidate-bridge.mjs",
  "discovery-recommendation.mjs",
  "discovery-results-ui.mjs",
  "discovery-review-ui.mjs",
  "discovery-session-ui.mjs",
  "local-discovery.mjs",
  "discovery-workspace.mjs",
  "discovery-batch.mjs",
  "discovery-identity.mjs",
  "journal-review.mjs",
  "p02-workflow.mjs",
  "library.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
  "candidate-storage.mjs",
  "discovery.mjs",
  "discovery-query-plan.mjs",
  "institution-access.mjs",
  "openalex-search.mjs",
  "bibliography-normalization.mjs",
  "discovery-record.mjs",
  "local-paper-match.mjs",
])
const KATEX_VENDOR_ROOT = "vendor/katex"
const KATEX_REQUIRED_FILES = Object.freeze(["katex.mjs", "katex.min.css", "LICENSE"])
const KATEX_FONT_REFERENCE = /url\(["']?(fonts\/[A-Za-z0-9_.-]+\.(?:woff2?|ttf))["']?\)/gu
const PAPER_SCALAR_FIELDS = Object.freeze([
  "paper_id", "slug", "source_id", "relative_path", "identity_source", "unit_type", "parent_paper_id",
  "title_original", "title_zh", "title_en", "publication_year", "version_date", "year", "venue", "doi_or_url", "record_type", "contribution_role",
  "p02_relevance", "source_status", "evidence_status", "reproduction_status", "writing_material_count",
  "note_status", "preferred_note", "note_preview_url",
])
const PAPER_ARRAY_FIELDS = Object.freeze([
  "authors", "source_terms", "warnings",
])
const CATALOG_SCALAR_FIELDS = Object.freeze([
  "paper_id", "title_original", "publication_year", "version_date", "year", "venue", "doi_or_url", "unit_type", "parent_paper_id",
])
const FORBIDDEN_PUBLIC_KEY_TOKENS = new Set([
  "privatepathlookup", "rootpath", "absolutepath", "paperdir", "sourceroot", "reporoot",
])

function rawPathHasTraversal(candidate) {
  return String(candidate).split(/[\\/]+/u).includes("..")
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function expectedGeneratedBasename(targetBasename, kind) {
  if (!GENERATED_BASENAMES.has(targetBasename)) throw new Error("拒绝非生成目录路径")
  if (kind === "target") return targetBasename
  if (kind === "stage") return `.${targetBasename}.next-${process.pid}`
  if (kind === "previous") return `.${targetBasename}.previous-${process.pid}`
  throw new Error("拒绝非生成目录路径")
}

export function assertGeneratedPath({ repoRoot, candidate, targetBasename, kind }) {
  if (typeof repoRoot !== "string" || typeof candidate !== "string" || !isAbsolute(repoRoot) || !isAbsolute(candidate)) {
    throw new Error("拒绝非生成目录路径")
  }
  if (rawPathHasTraversal(candidate)) throw new Error("拒绝非生成目录路径")
  const expectedBasename = expectedGeneratedBasename(targetBasename, kind)
  const lexicalRoot = resolve(repoRoot)
  const lexicalCandidate = resolve(candidate)
  if (dirname(lexicalCandidate) !== lexicalRoot || basename(lexicalCandidate) !== expectedBasename) {
    throw new Error("拒绝非生成目录路径")
  }

  let canonicalRoot
  let canonicalParent
  try {
    canonicalRoot = realpathSync(lexicalRoot)
    canonicalParent = realpathSync(dirname(lexicalCandidate))
  } catch {
    throw new Error("生成目录父级无效")
  }
  if (canonicalParent !== canonicalRoot) throw new Error("拒绝非生成目录路径")

  const existing = lstatIfPresent(lexicalCandidate)
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error("生成目录不能是符号链接")
    if (!existing.isDirectory()) throw new Error("生成路径必须是目录")
    let canonicalCandidate
    try {
      canonicalCandidate = realpathSync(lexicalCandidate)
    } catch {
      throw new Error("生成目录无法解析")
    }
    if (dirname(canonicalCandidate) !== canonicalRoot || basename(canonicalCandidate) !== expectedBasename) {
      throw new Error("拒绝非生成目录路径")
    }
  }
  return lexicalCandidate
}

async function pathExistsNoFollow(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function assertAbsentGeneratedPath(options, message) {
  const candidate = assertGeneratedPath(options)
  if (await pathExistsNoFollow(candidate)) throw new Error(message)
  return candidate
}

async function removeGuardedDirectory(options, removePath = rm) {
  const candidate = assertGeneratedPath(options)
  if (!await pathExistsNoFollow(candidate)) return
  assertGeneratedPath(options)
  await removePath(candidate, { recursive: true, force: false })
}

function canonicalRepositoryRoot(repoRoot) {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) throw new Error("项目根目录必须是绝对路径")
  const lexicalRoot = resolve(repoRoot)
  let info
  let canonicalRoot
  try {
    info = lstatSync(lexicalRoot)
    canonicalRoot = realpathSync(lexicalRoot)
  } catch {
    throw new Error("项目根目录不存在")
  }
  if ((!info.isDirectory() && !info.isSymbolicLink()) || !lstatSync(canonicalRoot).isDirectory()) {
    throw new Error("项目根目录必须是目录")
  }
  return canonicalRoot
}

function prepareSpecification(repoRoot, specification) {
  if (!specification || typeof specification !== "object" || !GENERATED_BASENAMES.has(specification.basename) || typeof specification.populate !== "function") {
    throw new Error("生成目录规格无效")
  }
  const basenameValue = specification.basename
  return {
    basename: basenameValue,
    populate: specification.populate,
    target: join(repoRoot, basenameValue),
    stage: join(repoRoot, `.${basenameValue}.next-${process.pid}`),
    previous: join(repoRoot, `.${basenameValue}.previous-${process.pid}`),
    previousMoved: false,
    targetHasNew: false,
  }
}

async function preflightGeneratedSpecification(repoRoot, prepared) {
  assertGeneratedPath({ repoRoot, candidate: prepared.target, targetBasename: prepared.basename, kind: "target" })
  await assertAbsentGeneratedPath(
    { repoRoot, candidate: prepared.stage, targetBasename: prepared.basename, kind: "stage" },
    "构建暂存目录已存在，拒绝覆盖",
  )
  await assertAbsentGeneratedPath(
    { repoRoot, candidate: prepared.previous, targetBasename: prepared.basename, kind: "previous" },
    "旧备份目录已存在，拒绝覆盖",
  )
}

async function cleanupStages(repoRoot, preparedItems, removePath) {
  for (const item of preparedItems) {
    await removeGuardedDirectory({ repoRoot, candidate: item.stage, targetBasename: item.basename, kind: "stage" }, removePath)
  }
}

async function rollbackSwaps(repoRoot, preparedItems, renamePath, removePath) {
  for (const item of [...preparedItems].reverse()) {
    if (item.targetHasNew) {
      await removeGuardedDirectory({ repoRoot, candidate: item.target, targetBasename: item.basename, kind: "target" }, removePath)
      item.targetHasNew = false
    }
    if (item.previousMoved) {
      assertGeneratedPath({ repoRoot, candidate: item.previous, targetBasename: item.basename, kind: "previous" })
      await assertAbsentGeneratedPath(
        { repoRoot, candidate: item.target, targetBasename: item.basename, kind: "target" },
        "回滚目标目录仍然存在",
      )
      await renamePath(item.previous, item.target)
      item.previousMoved = false
    }
  }
}

export async function guardedReplaceGeneratedDirectories({ repoRoot, specifications, renamePath = rename, removePath = rm }) {
  const canonicalRoot = canonicalRepositoryRoot(repoRoot)
  if (!Array.isArray(specifications) || specifications.length === 0) throw new Error("生成目录规格不能为空")
  const preparedItems = specifications.map((specification) => prepareSpecification(canonicalRoot, specification))
  if (new Set(preparedItems.map((item) => item.basename)).size !== preparedItems.length) throw new Error("生成目录规格不能重复")

  for (const item of preparedItems) await preflightGeneratedSpecification(canonicalRoot, item)
  const staged = []
  try {
    for (const item of preparedItems) {
      assertGeneratedPath({ repoRoot: canonicalRoot, candidate: item.stage, targetBasename: item.basename, kind: "stage" })
      await mkdir(item.stage)
      staged.push(item)
      await item.populate(item.stage)
      assertGeneratedPath({ repoRoot: canonicalRoot, candidate: item.stage, targetBasename: item.basename, kind: "stage" })
    }
  } catch {
    try { await cleanupStages(canonicalRoot, staged, removePath) } catch { /* fail closed without deleting unverified paths */ }
    throw new Error("生成目录暂存失败")
  }

  try {
    for (const item of preparedItems) {
      if (await pathExistsNoFollow(item.target)) {
        assertGeneratedPath({ repoRoot: canonicalRoot, candidate: item.target, targetBasename: item.basename, kind: "target" })
        await assertAbsentGeneratedPath(
          { repoRoot: canonicalRoot, candidate: item.previous, targetBasename: item.basename, kind: "previous" },
          "旧备份目录已存在，拒绝覆盖",
        )
        await renamePath(item.target, item.previous)
        item.previousMoved = true
      }
      assertGeneratedPath({ repoRoot: canonicalRoot, candidate: item.stage, targetBasename: item.basename, kind: "stage" })
      await assertAbsentGeneratedPath(
        { repoRoot: canonicalRoot, candidate: item.target, targetBasename: item.basename, kind: "target" },
        "生成目标目录未清空",
      )
      await renamePath(item.stage, item.target)
      item.targetHasNew = true
    }
  } catch {
    let rollbackComplete = true
    try { await rollbackSwaps(canonicalRoot, preparedItems, renamePath, removePath) } catch { rollbackComplete = false }
    try { await cleanupStages(canonicalRoot, preparedItems, removePath) } catch { rollbackComplete = false }
    if (!rollbackComplete) throw new Error("生成目录切换失败且回滚未完成")
    throw new Error("生成目录切换失败；已回滚现有生成目录")
  }

  for (const item of preparedItems) {
    if (item.previousMoved) {
      try {
        await removeGuardedDirectory(
          { repoRoot: canonicalRoot, candidate: item.previous, targetBasename: item.basename, kind: "previous" },
          removePath,
        )
        item.previousMoved = false
      } catch {
        // Both new directories are already published. A stale backup is recoverable
        // housekeeping, not a failed build that should roll back a newly imported note.
      }
    }
  }
}

export async function guardedReplaceGeneratedDirectory({ repoRoot, basename: targetBasename, populate }) {
  return guardedReplaceGeneratedDirectories({
    repoRoot,
    specifications: [{ basename: targetBasename, populate }],
  })
}

function inside(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
}

function normalizedKeyToken(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function leadingScheme(value) {
  const match = /^\s*([A-Za-z](?:[\s\u0000-\u001f]*[A-Za-z])*)[\s\u0000-\u001f]*:/u.exec(value)
  return match ? match[1].replaceAll(/[\s\u0000-\u001f]/gu, "").toLowerCase() : null
}

function isSyntacticallyValidHttpUrl(value) {
  const trimmed = value.trim()
  if (!/^https?:/iu.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isAbsolutePathValue(value) {
  const trimmed = value.trim()
  return trimmed.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(trimmed)
    || /^(?:\\\\|\/\/)[^\\/]+[\\/]/u.test(trimmed)
}

function containsConfiguredRoot(value, privateRoots) {
  const normalizedValue = value.replaceAll("\\", "/")
  const lowerValue = normalizedValue.toLowerCase()
  return privateRoots.some((root) => {
    if (typeof root !== "string" || root.length === 0) return false
    const normalizedRoot = resolve(root).replaceAll("\\", "/")
    if (normalizedRoot === "/") return isAbsolutePathValue(value)
    return lowerValue.includes(normalizedRoot.toLowerCase())
  })
}

function assertPublicIndexPrivacy(value, privateRoots, seen = new Set()) {
  if (typeof value === "string") {
    if (containsConfiguredRoot(value, privateRoots)) throw new Error("公开索引包含私有定位信息")
    if (isSyntacticallyValidHttpUrl(value)) return
    if (leadingScheme(value) === "file" || isAbsolutePathValue(value)) {
      throw new Error("公开索引包含私有定位信息")
    }
    return
  }
  if (value === null || typeof value !== "object") return
  if (seen.has(value)) throw new Error("公开索引结构包含循环引用")
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertPublicIndexPrivacy(item, privateRoots, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_PUBLIC_KEY_TOKENS.has(normalizedKeyToken(key))) throw new Error("公开索引包含审计专用字段")
      assertPublicIndexPrivacy(item, privateRoots, seen)
    }
  }
  seen.delete(value)
}

async function resolveApprovedTemplateRoot(repoRoot, templateRoot) {
  if (typeof templateRoot !== "string" || !isAbsolute(templateRoot)) throw new Error("模板目录必须是绝对路径")
  let canonicalTemplateRoot
  try {
    canonicalTemplateRoot = await realpath(resolve(templateRoot))
  } catch {
    throw new Error("模板目录不存在")
  }
  if (!inside(repoRoot, canonicalTemplateRoot) || canonicalTemplateRoot === repoRoot) throw new Error("模板目录必须位于项目内")
  return canonicalTemplateRoot
}

async function loadApprovedDesktopFile({ repoRoot, templateRoot, fileName, missingMessage, invalidMessage }) {
  if (typeof fileName !== "string" || fileName.includes("\\")) throw new Error(invalidMessage)
  const normalizedFileName = normalizeRelativePath(fileName)
  if (normalizedFileName !== fileName) throw new Error(invalidMessage)
  const candidate = join(templateRoot, normalizedFileName)
  let info
  try {
    info = await lstat(candidate)
  } catch {
    throw new Error(missingMessage)
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(invalidMessage)
  let canonicalFile
  try {
    canonicalFile = await realpath(candidate)
  } catch {
    throw new Error(invalidMessage)
  }
  if (!inside(repoRoot, canonicalFile) || !inside(templateRoot, canonicalFile)) {
    throw new Error(invalidMessage)
  }
  return readFile(canonicalFile)
}

async function loadApprovedKaTeXBundle(repoRoot, templateRoot) {
  const assets = new Map()
  for (const fileName of KATEX_REQUIRED_FILES) {
    const relativePath = `${KATEX_VENDOR_ROOT}/${fileName}`
    const bytes = await loadApprovedDesktopFile({
      repoRoot,
      templateRoot,
      fileName: relativePath,
      missingMessage: `批准的 KaTeX 资源 ${relativePath} 不存在`,
      invalidMessage: `批准的 KaTeX 资源 ${relativePath} 必须是项目内普通非符号链接文件`,
    })
    assets.set(relativePath, bytes)
  }

  const css = assets.get(`${KATEX_VENDOR_ROOT}/katex.min.css`).toString("utf8")
  const fontPaths = new Set()
  for (const match of css.matchAll(KATEX_FONT_REFERENCE)) fontPaths.add(match[1])
  if (fontPaths.size === 0) throw new Error("KaTeX 样式未声明字体资源")
  for (const fontPath of [...fontPaths].sort()) {
    const relativePath = `${KATEX_VENDOR_ROOT}/${fontPath}`
    const bytes = await loadApprovedDesktopFile({
      repoRoot,
      templateRoot,
      fileName: relativePath,
      missingMessage: `批准的 KaTeX 字体 ${relativePath} 不存在`,
      invalidMessage: `批准的 KaTeX 字体 ${relativePath} 必须是项目内普通非符号链接文件`,
    })
    assets.set(relativePath, bytes)
  }
  return assets
}

async function loadApprovedDesktopBundle(repoRoot, templateRoot) {
  const canonicalTemplateRoot = await resolveApprovedTemplateRoot(repoRoot, templateRoot)
  const templates = new Map()
  for (const [sourceName, runtimeName] of GENERATED_DESKTOP_TEMPLATES) {
    const messages = DESKTOP_TEMPLATE_MESSAGES.get(sourceName)
    const bytes = await loadApprovedDesktopFile({
      repoRoot,
      templateRoot: canonicalTemplateRoot,
      fileName: sourceName,
      missingMessage: messages.missing,
      invalidMessage: messages.invalid,
    })
    templates.set(runtimeName, bytes)
  }
  const assets = new Map()
  for (const fileName of REQUIRED_DESKTOP_ASSETS) {
    const bytes = await loadApprovedDesktopFile({
      repoRoot,
      templateRoot: canonicalTemplateRoot,
      fileName,
      missingMessage: `批准的桌面资源 ${fileName} 不存在`,
      invalidMessage: `批准的桌面资源 ${fileName} 必须是项目内普通非符号链接文件`,
    })
    assets.set(fileName, bytes)
  }
  const katexAssets = await loadApprovedKaTeXBundle(repoRoot, canonicalTemplateRoot)
  for (const [relativePath, bytes] of katexAssets) assets.set(relativePath, bytes)
  return { templates, assets }
}

function cloneArtifactEntry(artifact) {
  return {
    relative_path: artifact.relative_path,
    file_name: artifact.file_name,
    size_bytes: artifact.size_bytes,
  }
}

function safeSourceDocumentLabel(value, kind, index) {
  const fallback = `${kind === "pdf" ? "PDF 原文" : "OCR 原文"} ${index + 1}`
  let label = typeof value === "string"
    ? value.replace(/[\\/\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()
    : ""
  if (!label) label = fallback
  if (label.length <= SOURCE_DOCUMENT_LABEL_LIMIT) return label
  const lower = label.toLowerCase()
  const suffix = kind === "pdf" ? ".pdf" : lower.endsWith(".markdown") ? ".markdown" : ".md"
  const prefixLimit = SOURCE_DOCUMENT_LABEL_LIMIT - suffix.length - 1
  const prefix = label.slice(0, prefixLimit).trimEnd() || fallback.slice(0, prefixLimit)
  return `${prefix}…${suffix}`
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function validateBuiltSourceDocuments(value) {
  const invalid = () => { throw new Error("原文材料索引无效") }
  if (!isPlainRecord(value)) invalid()
  const keys = Object.keys(value).sort()
  if (keys.join("|") !== [...SOURCE_DOCUMENT_KINDS].sort().join("|")) invalid()
  for (const kind of SOURCE_DOCUMENT_KINDS) {
    if (!Array.isArray(value[kind])) invalid()
    for (const item of value[kind]) {
      if (
        !isPlainRecord(item)
        || Object.keys(item).sort().join("|") !== "label|size_bytes|url"
        || typeof item.label !== "string"
        || item.label.length === 0
        || item.label.length > SOURCE_DOCUMENT_LABEL_LIMIT
        || /[\\/\u0000-\u001f\u007f]/u.test(item.label)
        || typeof item.url !== "string"
        || !SOURCE_DOCUMENT_URL[kind].test(item.url)
        || !Number.isInteger(item.size_bytes)
        || item.size_bytes < 0
        || item.size_bytes > SOURCE_DOCUMENT_LIMITS[kind]
      ) invalid()
    }
  }
  return value
}

function validateBuiltControlledPreviews({ slug, notePreviewUrl, value }) {
  const invalid = () => { throw new Error("论文预览索引无效") }
  const fileNames = {
    note: "preferred.html",
    derivation: "derivation.html",
    simulation: "simulation.html",
    code_compare: "code_compare.html",
  }
  if (!hasExactJsonObjectKeys(value, Object.keys(fileNames))) invalid()
  for (const [category, fileName] of Object.entries(fileNames)) {
    const preview = value[category]
    if (preview !== null && preview !== `../../local_library_data/notes/${slug}/${fileName}`) invalid()
  }
  if (value.note !== notePreviewUrl) invalid()
  return value
}

export function validateBuiltPaperIndex(value, { privateRoots = [] } = {}) {
  const invalid = () => { throw new Error("公开论文索引无效") }
  if (
    !hasExactJsonObjectKeys(value, ["facet_schema", "papers", "version", "warning_count"])
    || value.version !== 3
    || !Number.isInteger(value.warning_count)
    || value.warning_count < 0
    || !Array.isArray(value.papers)
    || JSON.stringify(value.facet_schema) !== JSON.stringify(serializeFacetSchema())
    || !Array.isArray(privateRoots)
  ) invalid()

  const paperIds = new Set()
  for (const paper of value.papers) {
    if (!isPlainRecord(paper)) invalid()
    const hasExtras = ["controlled_previews", "controlled_preview_documents", "source_documents"]
      .every((field) => Object.hasOwn(paper, field))
    if (!hasExtras) invalid()
    const {
      controlled_previews: controlledPreviews,
      controlled_preview_documents: controlledPreviewDocuments,
      source_documents: sourceDocuments,
      ...generatedPaper
    } = paper
    if (!hasExactJsonObjectKeys(paper, [
      ...Object.keys(generatedPaper),
      "controlled_previews",
      "controlled_preview_documents",
      "source_documents",
    ])) invalid()
    validateGeneratedPaper(generatedPaper)
    validateBuiltControlledPreviews({
      slug: generatedPaper.slug,
      notePreviewUrl: generatedPaper.note_preview_url,
      value: controlledPreviews,
    })
    validateControlledPreviewDocuments({ slug: generatedPaper.slug, documents: controlledPreviewDocuments })
    validateBuiltSourceDocuments(sourceDocuments)
    if (paperIds.has(generatedPaper.paper_id)) invalid()
    paperIds.add(generatedPaper.paper_id)
  }
  assertPublicIndexPrivacy(value, privateRoots)
  return value
}

function hasNearTailPdfEofMarker(bytes) {
  const tail = bytes.subarray(Math.max(0, bytes.byteLength - 16 * 1024)).toString("latin1")
  return /(?:^|[\r\n])%%EOF(?:[\u0000\t\n\f\r ]|$)/u.test(tail)
}

function serializePublicPaper(paper, controlledPreviews, controlledPreviewDocuments, sourceDocuments) {
  const record = {}
  for (const field of PAPER_SCALAR_FIELDS) record[field] = paper[field]
  for (const field of PAPER_ARRAY_FIELDS) record[field] = [...paper[field]]
  record.facets = structuredClone(paper.facets)
  record.facet_states = { ...paper.facet_states }
  record.metadata_provenance = Object.fromEntries(
    Object.entries(paper.metadata_provenance).filter(([field]) => METADATA_PROVENANCE_FIELDS.has(field)),
  )
  record.artifacts = Object.fromEntries(ARTIFACT_KEYS.map((field) => [field, paper.artifacts[field].map(cloneArtifactEntry)]))
  record.artifact_availability = Object.fromEntries(ARTIFACT_KEYS.map((field) => [field, paper.artifact_availability[field]]))
  validateGeneratedPaper(record)
  record.controlled_previews = { ...controlledPreviews }
  validateControlledPreviewDocuments({ slug: paper.slug, documents: controlledPreviewDocuments })
  record.controlled_preview_documents = Object.fromEntries(CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES.map((category) => [
    category,
    controlledPreviewDocuments[category].map((item) => ({ ...item })),
  ]))
  validateControlledPreviewDocuments({ slug: paper.slug, documents: record.controlled_preview_documents })
  record.source_documents = {
    pdf: sourceDocuments.pdf.map((item) => ({ ...item })),
    ocr: sourceDocuments.ocr.map((item) => ({ ...item })),
  }
  validateBuiltSourceDocuments(record.source_documents)
  return record
}

function serializeCatalogRecord(record) {
  const sanitized = {}
  for (const field of CATALOG_SCALAR_FIELDS) {
    if (Object.hasOwn(record, field)) sanitized[field] = record[field]
  }
  if (Object.hasOwn(record, "authors")) sanitized.authors = [...record.authors]
  if (Object.hasOwn(record, "metadata_provenance")) sanitized.metadata_provenance = { ...record.metadata_provenance }
  return sanitized
}

function serializeCatalogs(catalogs) {
  const sources = {}
  for (const [sourceId, catalog] of Object.entries(catalogs).sort(([left], [right]) => left.localeCompare(right))) {
    const papers = {}
    const prefix = `${sourceId}::`
    for (const [key, record] of Object.entries(catalog.papers).sort(([left], [right]) => left.localeCompare(right))) {
      if (!key.startsWith(prefix)) throw new Error("目录记录来源不匹配")
      const relativePath = normalizeRelativePath(key.slice(prefix.length))
      if (makeOverrideKey({ sourceId, relativePath }) !== key) throw new Error("目录记录路径无效")
      papers[relativePath] = serializeCatalogRecord(record)
    }
    const warnings = [...catalog.warnings]
    if (warnings.some((warning) => typeof warning !== "string" || !/^catalog_line_unmatched:\d+$/u.test(warning))) {
      throw new Error("目录警告格式无效")
    }
    sources[sourceId] = { papers, warnings }
  }
  return { version: 1, sources }
}

function assertMarkdownExtension(relativePath) {
  const extension = extname(relativePath).toLowerCase()
  if (extension !== ".md" && extension !== ".markdown") throw new Error("受控预览只允许 Markdown 笔记")
}

async function readControlledNote({ unitDirectory, note }) {
  assertMarkdownExtension(note.relative_path)
  const expectedUnit = resolve(unitDirectory)
  const assertUnitContinuity = async () => {
    let unitInfo
    try {
      unitInfo = await lstat(expectedUnit)
    } catch {
      throw new Error("论文单元在扫描后发生变化")
    }
    if (unitInfo.isSymbolicLink()) throw new Error("论文单元不能是符号链接")
    if (!unitInfo.isDirectory()) throw new Error("论文单元在扫描后发生变化")
    let currentUnit
    try {
      currentUnit = await realpath(expectedUnit)
    } catch {
      throw new Error("论文单元在扫描后发生变化")
    }
    if (currentUnit !== expectedUnit) throw new Error("论文单元在扫描后发生变化")
    return currentUnit
  }
  const canonicalUnit = await assertUnitContinuity()
  const candidate = resolve(canonicalUnit, ...note.relative_path.split("/"))
  if (!inside(canonicalUnit, candidate) || candidate === canonicalUnit) throw new Error("首选笔记越出论文单元")

  let lexicalInfo
  try {
    lexicalInfo = await lstat(candidate)
  } catch {
    throw new Error("首选笔记不存在")
  }
  if (lexicalInfo.isSymbolicLink()) throw new Error("首选笔记不能是符号链接")
  let canonicalNote
  try {
    canonicalNote = await realpath(candidate)
  } catch {
    throw new Error("首选笔记无法解析")
  }
  if (!inside(canonicalUnit, canonicalNote) || canonicalNote === canonicalUnit) throw new Error("首选笔记越出论文单元")
  assertMarkdownExtension(canonicalNote)

  const handle = await open(canonicalNote, "r")
  let bytes
  try {
    const noteInfo = await handle.stat()
    if (!noteInfo.isFile()) throw new Error("首选笔记必须是普通文件")
    if (noteInfo.size > NOTE_SIZE_LIMIT) throw new Error("首选笔记超过大小限制")
    bytes = await handle.readFile()
  } finally {
    await handle.close()
  }
  if (bytes.byteLength > NOTE_SIZE_LIMIT) throw new Error("首选笔记超过大小限制")
  await assertUnitContinuity()
  if (await realpath(candidate) !== canonicalNote || !inside(canonicalUnit, canonicalNote)) throw new Error("首选笔记在读取期间发生变化")
  try {
    return { markdown: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes }
  } catch {
    throw new Error("首选笔记不是有效 UTF-8")
  }
}

async function readControlledSourceFile({ unitDirectory, artifact, category }) {
  const expectedUnit = resolve(unitDirectory)
  const label = category === "pdf" ? "PDF 原文" : "OCR 原文"
  const sizeLimit = category === "pdf" ? PDF_SIZE_LIMIT : OCR_SIZE_LIMIT
  const extension = extname(artifact.relative_path).toLowerCase()
  if (category === "pdf" && extension !== ".pdf") throw new Error(`${label}文件类型无效`)
  if (category === "ocr" && extension !== ".md" && extension !== ".markdown") throw new Error(`${label}文件类型无效`)

  let unitInfo
  try { unitInfo = await lstat(expectedUnit) } catch { throw new Error("论文单元在扫描后发生变化") }
  if (unitInfo.isSymbolicLink() || !unitInfo.isDirectory()) throw new Error("论文单元在扫描后发生变化")
  const canonicalUnit = await realpath(expectedUnit)
  if (canonicalUnit !== expectedUnit) throw new Error("论文单元在扫描后发生变化")

  const candidate = resolve(canonicalUnit, ...artifact.relative_path.split("/"))
  if (!inside(canonicalUnit, candidate) || candidate === canonicalUnit) throw new Error(`${label}越出论文单元`)
  let lexicalInfo
  try { lexicalInfo = await lstat(candidate) } catch { throw new Error(`${label}不存在`) }
  if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isFile()) throw new Error(`${label}必须是普通文件`)
  if (!Number.isInteger(artifact.size_bytes) || lexicalInfo.size !== artifact.size_bytes) throw new Error(`${label}在扫描后大小发生变化`)
  if (lexicalInfo.size > sizeLimit) throw new Error(`${label}超过大小限制`)
  const canonicalFile = await realpath(candidate)
  if (!inside(canonicalUnit, canonicalFile) || canonicalFile !== candidate) throw new Error(`${label}越出论文单元`)

  let handle
  let bytes
  try {
    handle = await open(canonicalFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size !== artifact.size_bytes || opened.size !== lexicalInfo.size || opened.size > sizeLimit) throw new Error(`${label}在读取期间发生变化`)
    bytes = await handle.readFile()
  } finally {
    if (handle) await handle.close()
  }
  if (bytes.byteLength !== artifact.size_bytes || bytes.byteLength !== lexicalInfo.size || await realpath(candidate) !== canonicalFile) throw new Error(`${label}在读取期间发生变化`)
  if (category === "pdf" && (
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    || !hasNearTailPdfEofMarker(bytes)
  )) throw new Error("PDF 原文格式无效")
  return bytes
}

function safeImageReferenceTarget(value) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.includes("\0") || value.includes("\\")) return null
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  for (const candidate of [value, decoded]) {
    if (
      candidate.startsWith("/")
      || /^[A-Za-z]:/u.test(candidate)
      || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(candidate)
      || candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) return null
  }
  return IMAGE_MIME_TYPES.has(extname(value).toLowerCase()) ? value : null
}

function imageSignatureMatches(extension, bytes) {
  if (extension === ".png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === ".jpg" || extension === ".jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (extension === ".gif") return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
  if (extension === ".webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  return false
}

async function readSafeImage({ canonicalUnit, candidate, extension }) {
  let lexicalInfo
  try {
    lexicalInfo = await lstat(candidate)
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { status: "missing" }
    return { status: "unsafe" }
  }
  if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isFile()) return { status: "unsafe" }
  let canonicalCandidate
  try {
    canonicalCandidate = await realpath(candidate)
  } catch {
    return { status: "unsafe" }
  }
  if (!inside(canonicalUnit, canonicalCandidate) || canonicalCandidate !== candidate) return { status: "unsafe" }
  if (lexicalInfo.size > IMAGE_SIZE_LIMIT) return { status: "too_large" }

  let handle
  let bytes
  try {
    handle = await open(canonicalCandidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size !== lexicalInfo.size || opened.size > IMAGE_SIZE_LIMIT) return { status: "unsafe" }
    bytes = await handle.readFile()
  } catch {
    return { status: "unsafe" }
  } finally {
    if (handle) await handle.close()
  }
  if (bytes.byteLength !== lexicalInfo.size || !imageSignatureMatches(extension, bytes)) return { status: "invalid_type" }
  if (await realpath(candidate) !== canonicalCandidate || !inside(canonicalUnit, canonicalCandidate)) return { status: "unsafe" }
  return { status: "resolved", bytes, canonicalCandidate }
}

async function findFilesByBasename(directory, fileName, matches = []) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return matches
  }
  for (const entry of entries) {
    const candidate = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await findFilesByBasename(candidate, fileName, matches)
    else if (entry.isFile() && entry.name === fileName) matches.push(candidate)
  }
  return matches
}

async function resolveImageReference({ unitDirectory, noteRelativePath, reference }) {
  const target = safeImageReferenceTarget(reference.target)
  if (!target) return { status: "unsupported" }
  const canonicalUnit = await realpath(resolve(unitDirectory))
  if (canonicalUnit !== resolve(unitDirectory)) return { status: "unsafe" }
  const extension = extname(target).toLowerCase()
  let candidates
  if (target.includes("/")) {
    const noteDirectory = dirname(resolve(canonicalUnit, ...noteRelativePath.split("/")))
    candidates = [...new Set([
      resolve(noteDirectory, ...target.split("/")),
      resolve(canonicalUnit, ...target.split("/")),
    ])].filter((candidate) => inside(canonicalUnit, candidate) && candidate !== canonicalUnit)
  } else {
    candidates = await findFilesByBasename(canonicalUnit, target)
    if (candidates.length > 1) return { status: "ambiguous" }
  }
  if (candidates.length === 0) return { status: "missing" }

  for (const candidate of candidates) {
    const result = await readSafeImage({ canonicalUnit, candidate, extension })
    if (result.status === "missing") continue
    if (result.status !== "resolved") return result
    const hash = createHash("sha256").update(result.bytes).digest("hex")
    const fileName = `${hash}${extension}`
    const sourceRelativePath = relative(canonicalUnit, result.canonicalCandidate).split(sep).join("/")
    return {
      status: "resolved",
      bytes: result.bytes,
      fileName,
      mimeType: IMAGE_MIME_TYPES.get(extension),
      sizeBytes: result.bytes.byteLength,
      sourceRelativePath,
    }
  }
  return { status: "missing" }
}

export async function inspectControlledImageReferences({ markdown, unitDirectory, noteRelativePath }) {
  const references = []
  renderControlledMarkdown(markdown, {
    resolveImage(reference) {
      references.push({ ...reference })
      return { status: "collecting" }
    },
  })
  const byTarget = new Map()
  const results = []
  for (const reference of references) {
    if (!byTarget.has(reference.target)) {
      byTarget.set(reference.target, await resolveImageReference({ unitDirectory, noteRelativePath, reference }))
    }
    results.push({ target: reference.target, ...byTarget.get(reference.target) })
  }
  return results
}

async function preparePreviewImages({ markdown, paper, category, artifact, unitDirectory, audit, assetFiles }) {
  const inspected = await inspectControlledImageReferences({
    markdown,
    unitDirectory,
    noteRelativePath: artifact.relative_path,
  })
  const resolvedByTarget = new Map()
  for (const { target, ...result } of inspected) {
    if (resolvedByTarget.has(target)) continue
    if (result.status === "resolved") {
      const assetGroup = category === "ocr" ? "sources" : "notes"
      const generatedRelativePath = `${assetGroup}/${paper.slug}/assets/${result.fileName}`
      assetFiles.set(generatedRelativePath, result.bytes)
      resolvedByTarget.set(target, {
        ...result,
        src: `../../local_library_data/${generatedRelativePath}`,
        generatedRelativePath,
      })
    } else {
      resolvedByTarget.set(target, result)
    }
  }
  for (const reference of inspected) {
    const result = resolvedByTarget.get(reference.target) ?? { status: "missing" }
    audit.image_assets.push({
      paper_id: paper.paper_id,
      preview_kind: category,
      reference: reference.target,
      status: result.status,
      source_relative_path: result.sourceRelativePath ?? null,
      generated_relative_path: result.generatedRelativePath ?? null,
      mime_type: result.mimeType ?? null,
      size_bytes: result.sizeBytes ?? null,
    })
    if (result.status !== "resolved") {
      audit.warnings.image_references.push(`${paper.paper_id}:${category}:${reference.target}:${result.status}`)
    }
  }
  return {
    resolveImage(reference) {
      const result = resolvedByTarget.get(reference.target)
      return result?.status === "resolved"
        ? { status: "resolved", src: result.src }
        : { status: result?.status ?? "missing" }
    },
  }
}

function singleMarkdownArtifact(paper, category) {
  const candidates = markdownArtifacts(paper, category)
  return candidates.length === 1 ? candidates[0] : null
}

function markdownArtifacts(paper, category) {
  return paper.artifacts[category].filter((artifact) => {
    const extension = extname(artifact.relative_path).toLowerCase()
    return extension === ".md" || extension === ".markdown"
  }).sort((left, right) => left.relative_path.localeCompare(right.relative_path))
}

function addContentAddressedPreview({ previewFiles, slug, category, bytes, html }) {
  let hash = createHash("sha256").update(bytes).digest("hex")
  let generatedRelativePath = `notes/${slug}/${category}/${hash}.html`
  const existing = previewFiles.get(generatedRelativePath)
  if (existing !== undefined && existing !== html) {
    hash = createHash("sha256").update(bytes).update("\0").update(html).digest("hex")
    generatedRelativePath = `notes/${slug}/${category}/${hash}.html`
  }
  const resolved = previewFiles.get(generatedRelativePath)
  if (resolved !== undefined && resolved !== html) throw new Error("受控预览内容哈希冲突")
  previewFiles.set(generatedRelativePath, html)
  return {
    generatedRelativePath,
    url: `../../local_library_data/${generatedRelativePath}`,
  }
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function aggregateWarningCount(audit) {
  const warnings = audit?.warnings
  if (!warnings || typeof warnings !== "object" || Array.isArray(warnings)) return 0
  return Object.values(warnings).reduce(
    (total, warningItems) => total + (Array.isArray(warningItems) ? warningItems.length : 0),
    0,
  )
}

export async function buildPrivateLibrary({ repoRoot, config, overrides, catalogs = {}, tagCatalog = null, institution, templateRoot, scan = scanPaperSources }) {
  const canonicalRoot = canonicalRepositoryRoot(repoRoot)
  const {
    templates: desktopTemplates,
    assets: desktopAssets,
  } = await loadApprovedDesktopBundle(canonicalRoot, templateRoot)
  const validatedInstitution = validateInstitutionConfig(institution)
  const scanned = await scan({ config, overrides, catalogs })
  const audit = scanned.audit
  const tagged = tagCatalog
    ? applyPaperTagCatalog({ papers: scanned.papers, tagCatalog })
    : { papers: scanned.papers, tagging: { tagged_count: 0, pending_paper_ids: [], unmatched_paper_ids: [] } }
  const papers = tagged.papers
  audit.tagging = { ...tagged.tagging, schema_version: 3 }
  const previewFiles = new Map()
  const imageAssetFiles = new Map()
  const sourceDocumentFiles = new Map()
  const controlledPreviewsByPaperId = new Map()
  const controlledPreviewDocumentsByPaperId = new Map()
  const sourceDocumentsByPaperId = new Map()
  audit.image_assets = []
  audit.warnings.image_references = []

  for (const paper of papers) {
    const overrideKey = makeOverrideKey({ sourceId: paper.source_id, relativePath: paper.relative_path })
    const override = overrides?.papers?.[overrideKey] ?? null
    const selectedNote = choosePreferredNote({ paper, override: { ...(override ?? {}), preview_note: true } })
    const sourceDocuments = { pdf: [], ocr: [] }
    const unitDirectory = audit.private_path_lookup[paper.paper_id]
    if (typeof unitDirectory !== "string") throw new Error("论文原文缺少受控源目录")
    for (const [index, artifact] of paper.artifacts.pdf.entries()) {
      const bytes = await readControlledSourceFile({ unitDirectory, artifact, category: "pdf" })
      const hash = createHash("sha256").update(bytes).digest("hex")
      const generatedRelativePath = `sources/${paper.slug}/pdf/${hash}.pdf`
      sourceDocumentFiles.set(generatedRelativePath, bytes)
      sourceDocuments.pdf.push({
        label: safeSourceDocumentLabel(artifact.file_name, "pdf", index),
        url: `../../local_library_data/${generatedRelativePath}`,
        size_bytes: bytes.byteLength,
      })
    }
    for (const [index, artifact] of paper.artifacts.ocr.entries()) {
      const bytes = await readControlledSourceFile({ unitDirectory, artifact, category: "ocr" })
      let markdown
      try { markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { throw new Error("OCR 原文不是有效 UTF-8") }
      const hash = createHash("sha256").update(bytes).digest("hex")
      const generatedRelativePath = `sources/${paper.slug}/ocr/${hash}.html`
      const imageOptions = await preparePreviewImages({
        markdown,
        paper,
        category: "ocr",
        artifact,
        unitDirectory,
        audit,
        assetFiles: imageAssetFiles,
      })
      sourceDocumentFiles.set(generatedRelativePath, `${renderControlledMarkdown(markdown, imageOptions)}\n`)
      sourceDocuments.ocr.push({
        label: safeSourceDocumentLabel(artifact.file_name, "ocr", index),
        url: `../../local_library_data/${generatedRelativePath}`,
        size_bytes: bytes.byteLength,
      })
    }
    const selectedArtifacts = {
      note: selectedNote,
      derivation: singleMarkdownArtifact(paper, "derivation"),
      simulation: singleMarkdownArtifact(paper, "simulation"),
      code_compare: singleMarkdownArtifact(paper, "code_compare"),
    }
    const controlledPreviews = Object.fromEntries(Object.keys(CONTROLLED_PREVIEW_FILES).map((category) => [category, null]))
    const controlledPreviewDocuments = Object.fromEntries(
      CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES.map((category) => [category, []]),
    )
    for (const category of CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES) {
      for (const artifact of markdownArtifacts(paper, category)) {
        const isDefault = selectedArtifacts[category]?.relative_path === artifact.relative_path
        const { markdown, bytes } = await readControlledNote({ unitDirectory, note: artifact })
        const imageOptions = await preparePreviewImages({
          markdown,
          paper,
          category,
          artifact,
          unitDirectory,
          audit,
          assetFiles: imageAssetFiles,
        })
        const html = renderControlledMarkdown(markdown, imageOptions)
        const preview = addContentAddressedPreview({ previewFiles, slug: paper.slug, category, bytes, html })
        controlledPreviewDocuments[category].push({
          label: artifact.relative_path,
          url: preview.url,
          size_bytes: bytes.byteLength,
          is_default: isDefault,
        })
        if (!isDefault) continue
        const fileName = CONTROLLED_PREVIEW_FILES[category]
        const previewUrl = `../../local_library_data/notes/${paper.slug}/${fileName}`
        controlledPreviews[category] = previewUrl
        previewFiles.set(`notes/${paper.slug}/${fileName}`, html)
        if (category === "note") paper.note_preview_url = previewUrl
      }
    }
    validateControlledPreviewDocuments({ slug: paper.slug, documents: controlledPreviewDocuments })
    controlledPreviewsByPaperId.set(paper.paper_id, controlledPreviews)
    controlledPreviewDocumentsByPaperId.set(paper.paper_id, controlledPreviewDocuments)
    sourceDocumentsByPaperId.set(paper.paper_id, sourceDocuments)
  }

  const controlledPreviewDocumentCount = [...controlledPreviewDocumentsByPaperId.values()].reduce(
    (total, documents) => total + CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES.reduce(
      (paperTotal, category) => paperTotal + documents[category].length,
      0,
    ),
    0,
  )
  audit.counts.generated_note_previews = controlledPreviewDocumentCount
  audit.counts.generated_image_assets = imageAssetFiles.size
  audit.counts.generated_source_documents = [...sourceDocumentsByPaperId.values()].reduce(
    (total, documents) => total + documents.pdf.length + documents.ocr.length,
    0,
  )
  audit.counts.generated_pages = 3 + controlledPreviewDocumentCount + [...sourceDocumentsByPaperId.values()].reduce(
    (total, documents) => total + documents.ocr.length,
    0,
  )
  const index = {
    version: 3,
    facet_schema: serializeFacetSchema(),
    warning_count: aggregateWarningCount(audit),
    papers: papers.map((paper) => serializePublicPaper(
      paper,
      controlledPreviewsByPaperId.get(paper.paper_id),
      controlledPreviewDocumentsByPaperId.get(paper.paper_id),
      sourceDocumentsByPaperId.get(paper.paper_id),
    )),
  }
  validateBuiltPaperIndex(index, { privateRoots: [
    canonicalRoot,
    ...config.sources.map((source) => source.path),
    ...audit.sources.map((source) => source.root_path),
  ] })
  const indexJson = prettyJson(index)
  const auditJson = prettyJson(audit)
  const generatedCatalog = serializeCatalogs(catalogs)
  assertPublicIndexPrivacy(generatedCatalog, [
    canonicalRoot,
    ...config.sources.map((source) => source.path),
    ...audit.sources.map((source) => source.root_path),
  ])
  const catalogJson = prettyJson(generatedCatalog)

  await guardedReplaceGeneratedDirectories({
    repoRoot: canonicalRoot,
    specifications: [
      {
        basename: "local_library_data",
        populate: async (stage) => {
          await writeFile(join(stage, "paper-catalog.json"), catalogJson, "utf8")
          await writeFile(join(stage, "paper-index.json"), indexJson, "utf8")
          await writeFile(join(stage, "paper-library-audit.json"), auditJson, "utf8")
          for (const [relativePath, html] of previewFiles) {
            const previewPath = join(stage, ...relativePath.split("/"))
            await mkdir(dirname(previewPath), { recursive: true })
            await writeFile(previewPath, `${html}\n`, "utf8")
          }
          for (const [relativePath, bytes] of imageAssetFiles) {
            const assetPath = join(stage, ...relativePath.split("/"))
            await mkdir(dirname(assetPath), { recursive: true })
            await writeFile(assetPath, bytes)
          }
          for (const [relativePath, content] of sourceDocumentFiles) {
            const sourcePath = join(stage, ...relativePath.split("/"))
            await mkdir(dirname(sourcePath), { recursive: true })
            await writeFile(sourcePath, content)
          }
        },
      },
      {
        basename: "local_library_output",
        populate: async (stage) => {
          const desktopDirectory = join(stage, "desktop")
          const assetDirectory = join(desktopDirectory, "assets")
          await mkdir(assetDirectory, { recursive: true })
          for (const [runtimeName, bytes] of desktopTemplates) {
            await writeFile(join(desktopDirectory, runtimeName), bytes)
          }
          await writeFile(join(assetDirectory, "nuist.institution.json"), prettyJson(validatedInstitution), "utf8")
          for (const [fileName, bytes] of desktopAssets) {
            const assetPath = join(assetDirectory, fileName)
            await mkdir(dirname(assetPath), { recursive: true })
            await writeFile(assetPath, bytes)
          }
        },
      },
    ],
  })

  return {
    paperCount: index.papers.length,
    previewCount: controlledPreviewDocumentCount,
    imageAssetCount: imageAssetFiles.size,
    sourceDocumentCount: audit.counts.generated_source_documents,
    pageCount: audit.counts.generated_pages,
    excludedCount: audit.excluded_units.length,
  }
}
