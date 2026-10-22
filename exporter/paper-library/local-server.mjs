import { createServer as createHttpServer } from "node:http"
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { validateArchiveRequest } from "./candidate-archive.mjs"
import {
  archiveCandidateAndRebuild,
  createArchiveRecoveryStore,
  rebuildArchivedCandidate,
} from "./candidate-archive-action.mjs"
import {
  IMPORT_REQUEST_MAX_BYTES,
  INSPECT_REQUEST_MAX_BYTES,
  NOTE_IMPORT_CATEGORIES,
  createInspectionStore,
  importInspectedNote,
  inspectMarkdownNote,
} from "./note-import.mjs"
import { loadPrivateLibraryContext, rebuildConfiguredLibrary } from "./runtime.mjs"
import { createWriteCoordinator } from "./write-coordinator.mjs"
import {
  SUBMISSION_STATE_REQUEST_MAX_BYTES,
  loadSubmissionProject,
  readSubmissionDocument,
  saveSubmissionProjectState,
} from "./submission-project.mjs"
import { WORKBENCH_STATE_REQUEST_MAX_BYTES, createWorkbenchStateStore } from "./workbench-state.mjs"

export const SOURCE_PATH_REQUEST_MAX_BYTES = 16 * 1024
export const ARCHIVE_REQUEST_MAX_BYTES = 65_536
export const ARCHIVE_REBUILD_REQUEST_MAX_BYTES = 8_192

const KATEX_FONT_FILES = Object.freeze([
  "KaTeX_AMS-Regular.woff2",
  "KaTeX_Caligraphic-Bold.woff2",
  "KaTeX_Caligraphic-Regular.woff2",
  "KaTeX_Fraktur-Bold.woff2",
  "KaTeX_Fraktur-Regular.woff2",
  "KaTeX_Main-Bold.woff2",
  "KaTeX_Main-BoldItalic.woff2",
  "KaTeX_Main-Italic.woff2",
  "KaTeX_Main-Regular.woff2",
  "KaTeX_Math-BoldItalic.woff2",
  "KaTeX_Math-Italic.woff2",
  "KaTeX_SansSerif-Bold.woff2",
  "KaTeX_SansSerif-Italic.woff2",
  "KaTeX_SansSerif-Regular.woff2",
  "KaTeX_Script-Regular.woff2",
  "KaTeX_Size1-Regular.woff2",
  "KaTeX_Size2-Regular.woff2",
  "KaTeX_Size3-Regular.woff2",
  "KaTeX_Size4-Regular.woff2",
  "KaTeX_Typewriter-Regular.woff2",
])
const KATEX_BROWSER_FILES = Object.freeze([
  "vendor/katex/katex.mjs",
  "vendor/katex/katex.min.css",
  ...KATEX_FONT_FILES.map((fileName) => `vendor/katex/fonts/${fileName}`),
])

export const APPROVED_PROTOTYPE_FILES = Object.freeze([
  "index.html",
  "directions.html",
  "p02.html",
  "p02-writing.html",
  "p02-writing-data.mjs",
  "p02-writing.mjs",
  "submission-project.html",
  "submission-project.css",
  "submission-project.mjs",
  "submission-project-model.mjs",
  "submission-project-ui.mjs",
  "p02-workflow.mjs",
  "p02-workflow-ui.mjs",
  "agent-tasks.html",
  "app.mjs",
  "research-home.mjs",
  "directions.mjs",
  "bibliography-normalization.mjs",
  "discovery-record.mjs",
  "discovery-query-plan.mjs",
  "direction-snapshot.mjs",
  "papers-data.mjs",
  "paper-filter.mjs",
  "agent-tasks.mjs",
  "agent-task-input.mjs",
  "agent-tasks.css",
  "styles.css",
  "library.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-user-tags.mjs",
  "workbench-storage.mjs",
  ...KATEX_BROWSER_FILES,
])

const APPROVED_PROTOTYPE_SET = new Set(APPROVED_PROTOTYPE_FILES)
const DEFAULT_STATIC_FILE_SYSTEM = Object.freeze({
  lstat,
  open,
  realpath,
  noFollowFlag: constants.O_NOFOLLOW,
})
const APPROVED_GENERATED_ASSET_SET = new Set([
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
  "styles.css",
  "state-transfer.mjs",
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
  "nuist.institution.json",
  "workbench-storage.mjs",
  ...KATEX_BROWSER_FILES,
])
const NOTE_CATEGORY = "(?:note|derivation|source_map|modeling|simulation|code_compare|reproduction_report)"
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*"
const HASH = "[a-f0-9]{64}"
const IMAGE_EXTENSION = "(?:gif|jpe?g|png|webp)"
const NOTE_PREVIEW_PATH = new RegExp(`^notes/${SLUG}/${NOTE_CATEGORY}/${HASH}\\.html$`, "u")
const NOTE_ALIAS_PATH = new RegExp(`^notes/${SLUG}/(?:preferred|derivation|simulation|code_compare)\\.html$`, "u")
const NOTE_ASSET_PATH = new RegExp(`^notes/${SLUG}/assets/${HASH}\\.${IMAGE_EXTENSION}$`, "u")
const SOURCE_DOCUMENT_PATH = new RegExp(`^sources/${SLUG}/(?:pdf/${HASH}\\.pdf|ocr/${HASH}\\.html)$`, "u")
const SOURCE_ASSET_PATH = new RegExp(`^sources/${SLUG}/assets/${HASH}\\.${IMAGE_EXTENSION}$`, "u")

const ERROR_STATUS = Object.freeze({
  HOST_FORBIDDEN: 400,
  ORIGIN_FORBIDDEN: 403,
  CROSS_SITE_FORBIDDEN: 403,
  JSON_REQUIRED: 415,
  REQUEST_TOO_LARGE: 413,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_CATEGORY: 400,
  INVALID_FILE_NAME: 400,
  INVALID_INSPECTION: 400,
  ACTION_CONFIRMATION_REQUIRED: 400,
  PAPER_NOT_FOUND: 404,
  INSPECTION_INVALID: 409,
  INSPECTION_EXPIRED: 409,
  PAPER_MAPPING_CHANGED: 409,
  LIBRARY_WRITE_BUSY: 409,
  ARCHIVE_CONFLICT: 409,
  ARCHIVE_REBUILD_REQUIRED: 409,
  RECOVERY_REQUIRED: 503,
  BUILD_FAILED: 500,
  ROLLBACK_FAILED: 500,
  BUILD_OUTPUT_INVALID: 500,
  WRITE_FAILED: 500,
  ARCHIVE_SCAN_INCOMPLETE: 409,
  ARCHIVE_WRITE_FAILED: 500,
  ARCHIVE_TRANSACTION_AMBIGUOUS: 500,
  ARCHIVE_RECOVERY_FAILED: 500,
  SUBMISSION_PROJECT_NOT_FOUND: 404,
  SUBMISSION_PROJECT_INVALID: 500,
  SUBMISSION_STATE_INVALID: 400,
  SUBMISSION_STATE_CORRUPT: 500,
  SUBMISSION_REVISION_CONFLICT: 409,
  SUBMISSION_WRITE_FAILED: 500,
  SUBMISSION_DOCUMENT_NOT_FOUND: 404,
  SUBMISSION_DOCUMENT_TOO_LARGE: 413,
  WORKBENCH_STATE_INVALID: 400,
  WORKBENCH_STATE_CONFLICT: 409,
  WORKBENCH_STATE_CORRUPT: 500,
  WORKBENCH_STATE_WRITE_FAILED: 500,
  INTERNAL_ERROR: 500,
})

const ERROR_MESSAGE = Object.freeze({
  HOST_FORBIDDEN: "请求主机无效",
  ORIGIN_FORBIDDEN: "请求来源无效",
  CROSS_SITE_FORBIDDEN: "拒绝跨站请求",
  JSON_REQUIRED: "请求必须使用 JSON",
  REQUEST_TOO_LARGE: "请求体超过固定上限",
  INVALID_JSON: "JSON 请求无效",
  INVALID_REQUEST: "请求格式无效",
  INVALID_CATEGORY: "笔记类型无效",
  INVALID_FILE_NAME: "笔记文件名无效",
  INVALID_INSPECTION: "笔记检查请求无效",
  ACTION_CONFIRMATION_REQUIRED: "缺少固定操作确认",
  PAPER_NOT_FOUND: "论文不存在",
  INSPECTION_INVALID: "检查记录无效",
  INSPECTION_EXPIRED: "检查记录已过期",
  PAPER_MAPPING_CHANGED: "论文目录映射已变化",
  LIBRARY_WRITE_BUSY: "论文库正在执行另一项写入",
  ARCHIVE_CONFLICT: "候选归档与当前资料冲突",
  ARCHIVE_REBUILD_REQUIRED: "受控资料包需要重新构建",
  RECOVERY_REQUIRED: "论文库需要先完成恢复",
  BUILD_FAILED: "论文库重建失败",
  ROLLBACK_FAILED: "笔记导入需要人工恢复",
  BUILD_OUTPUT_INVALID: "笔记导入需要人工恢复",
  WRITE_FAILED: "笔记写入失败",
  ARCHIVE_SCAN_INCOMPLETE: "论文来源扫描不完整",
  ARCHIVE_WRITE_FAILED: "候选归档事务失败",
  ARCHIVE_TRANSACTION_AMBIGUOUS: "候选归档需要人工恢复",
  ARCHIVE_RECOVERY_FAILED: "论文库恢复构建失败",
  SUBMISSION_PROJECT_NOT_FOUND: "尚未配置本地投稿项目",
  SUBMISSION_PROJECT_INVALID: "本地投稿项目配置无效，请检查配置文件",
  SUBMISSION_STATE_INVALID: "投稿项目状态无效；请检查选题、期刊及实验依据",
  SUBMISSION_STATE_CORRUPT: "本地投稿状态已损坏；已停止读写以保留原文件",
  SUBMISSION_REVISION_CONFLICT: "投稿项目已在其他页面更新，请先重新载入",
  SUBMISSION_WRITE_FAILED: "投稿项目保存失败",
  SUBMISSION_DOCUMENT_NOT_FOUND: "投稿材料不存在或不允许读取",
  SUBMISSION_DOCUMENT_TOO_LARGE: "投稿材料超过读取大小上限",
  WORKBENCH_STATE_INVALID: "研究状态保存请求无效",
  WORKBENCH_STATE_CONFLICT: "研究状态已在其他页面更新，已重新载入最新内容",
  WORKBENCH_STATE_CORRUPT: "本机研究状态文件已损坏；已停止读写以保留原文件",
  WORKBENCH_STATE_WRITE_FAILED: "研究状态写入磁盘失败",
  INTERNAL_ERROR: "本地论文库请求失败",
})

class RequestError extends Error {
  constructor(code, { closeConnection = false } = {}) {
    super(code)
    this.code = code
    this.closeConnection = closeConnection
  }
}

function requestError(code, options) {
  return new RequestError(code, options)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) return null
  const actual = Reflect.ownKeys(value)
  if (actual.some((key) => typeof key !== "string")) return null
  const expected = [...keys].sort()
  const sorted = [...actual].sort()
  if (sorted.length !== expected.length || !sorted.every((key, index) => key === expected[index])) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result = Object.create(null)
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null
    result[key] = descriptor.value
  }
  return result
}

function safeFileName(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) return null
  const fileName = basename(value.replaceAll("\\", "/"))
  if (fileName.length === 0 || fileName.length > 255 || [".", ".."].includes(fileName)) return null
  return fileName
}

function normalizedFailure(error) {
  const code = typeof error?.code === "string" && Object.hasOwn(ERROR_STATUS, error.code)
    ? error.code
    : "INTERNAL_ERROR"
  const fileName = safeFileName(error?.fileName)
  return { code, ...(fileName ? { file_name: fileName } : {}) }
}

function safeLog(logger, code) {
  if (typeof logger !== "function") return
  try {
    Promise.resolve(logger({ event: "local_server_request_failed", code })).catch(() => {})
  } catch {
    // Logging cannot alter the response or expose the original error.
  }
}

function baseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  }
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8")
  response.writeHead(status, {
    ...baseHeaders("application/json; charset=utf-8"),
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    ...extraHeaders,
  })
  response.end(body)
}

function sendFailure(response, error, logger) {
  const failure = normalizedFailure(error)
  safeLog(logger, failure.code)
  const closeConnection = error instanceof RequestError && error.closeConnection === true
  if (closeConnection) response.shouldKeepAlive = false
  sendJson(response, ERROR_STATUS[failure.code], {
    error: {
      code: failure.code,
      message: ERROR_MESSAGE[failure.code],
      ...(failure.file_name ? { file_name: failure.file_name } : {}),
    },
  }, closeConnection ? { Connection: "close" } : {})
}

function sendNotFound(request, response, api = false) {
  if (api) {
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "未找到请求资源" } })
    return
  }
  response.writeHead(404, { ...baseHeaders("text/plain; charset=utf-8"), "Content-Length": 0 })
  response.end()
}

function trustedOrigin(getOrigin) {
  let origin
  try {
    origin = new URL(getOrigin())
  } catch {
    throw requestError("INTERNAL_ERROR")
  }
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password || origin.pathname !== "/") {
    throw requestError("INTERNAL_ERROR")
  }
  return origin
}

function assertTrustedHost(request, getOrigin) {
  const origin = trustedOrigin(getOrigin)
  if (typeof request.headers.host !== "string" || request.headers.host !== origin.host) {
    throw requestError("HOST_FORBIDDEN")
  }
  return origin.origin
}

function assertPostGuards(request, origin) {
  const suppliedOrigin = request.headers.origin
  if (suppliedOrigin !== undefined && suppliedOrigin !== origin) throw requestError("ORIGIN_FORBIDDEN")
  const fetchSite = request.headers["sec-fetch-site"]
  if (fetchSite !== undefined && !["same-origin", "none"].includes(fetchSite)) {
    throw requestError("CROSS_SITE_FORBIDDEN")
  }
  const contentType = request.headers["content-type"]
  if (
    typeof contentType !== "string"
    || !/^\s*application\/json\s*(?:;\s*charset\s*=\s*utf-8\s*)?$/iu.test(contentType)
    || request.headers["content-encoding"] !== undefined
  ) throw requestError("JSON_REQUIRED")
}

function readBody(request, limit) {
  return new Promise((resolveBody, rejectBody) => {
    let total = 0
    let settled = false
    const chunks = []
    const cleanup = () => {
      request.removeListener("data", onData)
      request.removeListener("end", onEnd)
      request.removeListener("error", onError)
    }
    const onData = (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > limit) {
        settled = true
        chunks.length = 0
        cleanup()
        request.pause()
        rejectBody(requestError("REQUEST_TOO_LARGE", { closeConnection: true }))
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    const onEnd = () => {
      if (!settled) {
        settled = true
        cleanup()
        resolveBody(Buffer.concat(chunks, total))
      }
    }
    const onError = () => {
      if (!settled) {
        settled = true
        cleanup()
        rejectBody(requestError("INVALID_JSON"))
      }
    }
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
  })
}

async function readJsonBody(request, limit) {
  const bytes = await readBody(request, limit)
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return JSON.parse(text)
  } catch {
    throw requestError("INVALID_JSON")
  }
}

function requestPath(request) {
  if (typeof request.url !== "string" || !request.url.startsWith("/")) return null
  return request.url
}

function safeStaticPath(rawTarget) {
  const queryIndex = rawTarget.indexOf("?")
  const rawPath = queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex)
  if (rawPath.includes("#") || rawPath.includes("\0") || rawPath.includes("\\") || /%2f|%5c/iu.test(rawPath)) return null
  let decoded
  try { decoded = decodeURIComponent(rawPath) } catch { return null }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return null
  if (decoded !== "/") {
    const segments = decoded.slice(1).split("/")
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null
  }
  return { pathname: decoded, hasQuery: queryIndex !== -1 }
}

function staticMapping(pathname) {
  const outputPrefix = "/local_library_output/desktop/assets/"
  if (pathname === "/local_library_output/desktop/library.html") {
    return { root: "local_library_output/desktop", relativePath: "library.html" }
  }
  if (pathname === "/local_library_output/desktop/discovery.html") {
    return { root: "local_library_output/desktop", relativePath: "discovery.html" }
  }
  if (pathname === "/local_library_output/desktop/state-transfer.html") {
    return { root: "local_library_output/desktop", relativePath: "state-transfer.html" }
  }
  if (pathname.startsWith(outputPrefix)) {
    const relativePath = pathname.slice(outputPrefix.length)
    if (APPROVED_GENERATED_ASSET_SET.has(relativePath)) {
      return { root: "local_library_output/desktop/assets", relativePath }
    }
    return null
  }
  const prototypePrefix = "/prototype/desktop/"
  if (pathname.startsWith(prototypePrefix)) {
    const relativePath = pathname.slice(prototypePrefix.length)
    if (APPROVED_PROTOTYPE_SET.has(relativePath)) return { root: "prototype/desktop", relativePath }
    return null
  }
  if (pathname === "/local_library_data/paper-index.json") {
    return { root: "local_library_data", relativePath: "paper-index.json" }
  }
  const notePrefix = "/local_library_data/"
  if (pathname.startsWith(notePrefix)) {
    const relativePath = pathname.slice(notePrefix.length)
    if (
      NOTE_PREVIEW_PATH.test(relativePath)
      || NOTE_ALIAS_PATH.test(relativePath)
      || NOTE_ASSET_PATH.test(relativePath)
      || SOURCE_DOCUMENT_PATH.test(relativePath)
      || SOURCE_ASSET_PATH.test(relativePath)
    ) return { root: "local_library_data", relativePath }
  }
  return null
}

function inside(root, target) {
  const fromRoot = relative(root, target)
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  )
}

function mimeType(path) {
  const extension = extname(path).toLowerCase()
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extension] ?? "application/octet-stream"
}

async function serveStatic({ request, response, repoRoot, pathname, fileSystem: io }) {
  const mapping = staticMapping(pathname)
  if (!mapping) return false
  let handle = null
  try {
    for (const method of ["lstat", "open", "realpath"]) if (typeof io?.[method] !== "function") return false
    if (!Number.isInteger(io.noFollowFlag) || io.noFollowFlag <= 0) return false
    const lexicalRepoRoot = resolve(repoRoot)
    const repoInfo = await io.lstat(lexicalRepoRoot, { bigint: true })
    const canonicalRepoRoot = await io.realpath(lexicalRepoRoot)
    if (
      repoInfo.isSymbolicLink()
      || !repoInfo.isDirectory()
      || canonicalRepoRoot !== lexicalRepoRoot
    ) return false
    const repoIdentity = `${repoInfo.dev}:${repoInfo.ino}`
    const lexicalRoot = resolve(canonicalRepoRoot, mapping.root)
    if (!inside(canonicalRepoRoot, lexicalRoot)) return false
    const rootInfo = await io.lstat(lexicalRoot, { bigint: true })
    const canonicalRoot = await io.realpath(lexicalRoot)
    if (
      rootInfo.isSymbolicLink()
      || !rootInfo.isDirectory()
      || canonicalRoot !== lexicalRoot
      || !inside(canonicalRepoRoot, canonicalRoot)
    ) return false
    const rootIdentity = `${rootInfo.dev}:${rootInfo.ino}`
    const lexicalFile = resolve(lexicalRoot, mapping.relativePath)
    if (!inside(canonicalRoot, lexicalFile)) return false
    const lexicalInfo = await io.lstat(lexicalFile, { bigint: true })
    const canonicalFile = await io.realpath(lexicalFile)
    if (
      lexicalInfo.isSymbolicLink()
      || !lexicalInfo.isFile()
      || canonicalFile !== lexicalFile
      || !inside(canonicalRoot, canonicalFile)
    ) return false
    const fileIdentity = `${lexicalInfo.dev}:${lexicalInfo.ino}`
    const fileSize = Number(lexicalInfo.size)
    handle = await io.open(canonicalFile, constants.O_RDONLY | io.noFollowFlag)
    const openedBefore = await handle.stat({ bigint: true })
    if (
      !openedBefore.isFile()
      || `${openedBefore.dev}:${openedBefore.ino}` !== fileIdentity
      || Number(openedBefore.size) !== fileSize
    ) return false
    const bytes = await handle.readFile()
    const openedAfter = await handle.stat({ bigint: true })
    const lexicalAfter = await io.lstat(lexicalFile, { bigint: true })
    const canonicalAfter = await io.realpath(lexicalFile)
    const rootAfter = await io.lstat(lexicalRoot, { bigint: true })
    const repoAfter = await io.lstat(lexicalRepoRoot, { bigint: true })
    if (
      !openedAfter.isFile()
      || `${openedAfter.dev}:${openedAfter.ino}` !== fileIdentity
      || Number(openedAfter.size) !== fileSize
      || bytes.length !== fileSize
      || lexicalAfter.isSymbolicLink()
      || !lexicalAfter.isFile()
      || `${lexicalAfter.dev}:${lexicalAfter.ino}` !== fileIdentity
      || Number(lexicalAfter.size) !== fileSize
      || canonicalAfter !== canonicalFile
      || rootAfter.isSymbolicLink()
      || !rootAfter.isDirectory()
      || `${rootAfter.dev}:${rootAfter.ino}` !== rootIdentity
      || await io.realpath(lexicalRoot) !== canonicalRoot
      || repoAfter.isSymbolicLink()
      || !repoAfter.isDirectory()
      || `${repoAfter.dev}:${repoAfter.ino}` !== repoIdentity
      || await io.realpath(lexicalRepoRoot) !== canonicalRepoRoot
    ) return false
    response.writeHead(200, {
      ...baseHeaders(mimeType(canonicalFile)),
      "Content-Length": bytes.length,
    })
    response.end(request.method === "HEAD" ? undefined : bytes)
    return true
  } catch {
    return false
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* static validation result remains authoritative */ }
    }
  }
}

function categories() {
  return Object.entries(NOTE_IMPORT_CATEGORIES).map(([value, category]) => ({
    value,
    label: category.label,
    target_tab: category.target_tab,
  }))
}

function configuredArchiveSourceId(context) {
  const value = context?.config?.archive_source_id
  if (typeof value !== "string") return null
  return context.config.sources?.filter((source) => source?.source_id === value).length === 1 ? value : null
}

function capabilityResponse(context, recovery) {
  const candidateRecovery = recovery?.kind === "candidate_archive"
  const manualRecovery = recovery?.kind === "manual_note" || recovery?.kind === "manual_archive"
  const archiveSourceId = candidateRecovery
    ? recovery.archive_source_id
    : recovery === null
      ? configuredArchiveSourceId(context)
      : null
  return {
    api_version: 1,
    note_import: recovery === null,
    source_path: true,
    candidate_archive: recovery === null && archiveSourceId !== null,
    archive_rebuild: !manualRecovery && (candidateRecovery || archiveSourceId !== null),
    discovery: true,
    agent_task_center: true,
    archive_source_id: archiveSourceId,
    categories: categories(),
    recovery: recovery === null
      ? {
          required: false,
          kind: null,
          reason_code: null,
          archive_source_id: null,
          paper_id: null,
          openalex_id: null,
        }
      : candidateRecovery
        ? {
            required: true,
            kind: "candidate_archive",
            reason_code: recovery.reason_code,
            archive_source_id: recovery.archive_source_id,
            paper_id: recovery.paper_id,
            openalex_id: recovery.openalex_id,
          }
        : {
            required: true,
            kind: recovery.kind,
            reason_code: recovery.reason_code,
            archive_source_id: null,
            paper_id: null,
            openalex_id: null,
          },
  }
}

function inspectBody(value) {
  const body = exactObject(value, ["paper_id", "category", "original_file_name", "markdown"])
  if (
    !body
    || typeof body.paper_id !== "string"
    || typeof body.category !== "string"
    || typeof body.original_file_name !== "string"
    || typeof body.markdown !== "string"
  ) throw requestError("INVALID_REQUEST")
  return body
}

function importBody(value) {
  const body = exactObject(value, ["inspection_id", "requested_file_name", "conflict_policy"])
  if (
    !body
    || typeof body.inspection_id !== "string"
    || typeof body.requested_file_name !== "string"
    || body.conflict_policy !== "version"
  ) throw requestError("INVALID_REQUEST")
  return body
}

function sourcePathBody(value) {
  const body = exactObject(value, ["paper_id"])
  if (!body || typeof body.paper_id !== "string") throw requestError("INVALID_REQUEST")
  return body
}

function recoveryBody(value) {
  const body = exactObject(value, ["confirmation", "archive_source_id", "paper_id", "openalex_id"])
  if (
    !body
    || body.confirmation !== "retry_archive_rebuild"
    || typeof body.archive_source_id !== "string"
    || typeof body.paper_id !== "string"
    || typeof body.openalex_id !== "string"
    || !/^W[1-9]\d*$/u.test(body.openalex_id)
  ) throw requestError("INVALID_REQUEST")
  return Object.freeze({
    confirmation: body.confirmation,
    archive_source_id: body.archive_source_id,
    paper_id: body.paper_id,
    openalex_id: body.openalex_id,
  })
}

export function createPrivateLibraryRequestHandler({
  repoRoot,
  getOrigin,
  loadContext = loadPrivateLibraryContext,
  rebuild = rebuildConfiguredLibrary,
  inspectionStore = createInspectionStore(),
  coordinator = createWriteCoordinator(),
  inspect = inspectMarkdownNote,
  importNote = importInspectedNote,
  archiveAction = archiveCandidateAndRebuild,
  recoveryAction = rebuildArchivedCandidate,
  recoveryStore = createArchiveRecoveryStore(),
  staticFileSystem = {},
  logger = () => {},
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0 || typeof getOrigin !== "function") {
    throw new TypeError("本地论文库服务配置无效")
  }
  const staticIo = { ...DEFAULT_STATIC_FILE_SYSTEM, ...staticFileSystem }
  const workbenchState = createWorkbenchStateStore({ repoRoot })

  return async function privateLibraryRequestHandler(request, response) {
    const target = requestPath(request)
    const api = target?.startsWith("/api/") === true
    try {
      const origin = assertTrustedHost(request, getOrigin)
      if (api) {
        if (target.includes("?")) {
          sendNotFound(request, response, true)
          return
        }
        if (request.method === "GET" && target === "/api/v1/submission-project") {
          sendJson(response, 200, await loadSubmissionProject({ repoRoot }))
          return
        }
        const submissionDocument = /^\/api\/v1\/submission-project\/documents\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(target)
        if (request.method === "GET" && submissionDocument) {
          const document = await readSubmissionDocument({ repoRoot, documentId: submissionDocument[1] })
          response.writeHead(200, {
            ...baseHeaders(document.contentType),
            "Cache-Control": "no-store",
            "Content-Length": document.body.length,
            "Content-Disposition": "inline",
          })
          response.end(document.body)
          return
        }
        if (request.method === "GET" && target === "/api/v1/workbench-state") {
          sendJson(response, 200, await workbenchState.load())
          return
        }
        if (request.method === "GET" && target === "/api/v1/capabilities") {
          let recovery = coordinator.getState().recovery
          let context = null
          if (recovery === null) {
            context = await loadContext({ repoRoot })
            recovery = coordinator.getState().recovery
          }
          sendJson(response, 200, capabilityResponse(recovery === null ? context : null, recovery))
          return
        }
        const route = new Map([
          ["/api/v1/submission-project/state", SUBMISSION_STATE_REQUEST_MAX_BYTES],
          ["/api/v1/workbench-state", WORKBENCH_STATE_REQUEST_MAX_BYTES],
          ["/api/v1/papers/source-path", SOURCE_PATH_REQUEST_MAX_BYTES],
          ["/api/v1/notes/inspect", INSPECT_REQUEST_MAX_BYTES],
          ["/api/v1/notes/import", IMPORT_REQUEST_MAX_BYTES],
          ["/api/v1/archive/candidates", ARCHIVE_REQUEST_MAX_BYTES],
          ["/api/v1/archive/rebuild", ARCHIVE_REBUILD_REQUEST_MAX_BYTES],
        ])
        if (request.method !== "POST" || !route.has(target)) {
          sendNotFound(request, response, true)
          return
        }
        assertPostGuards(request, origin)
        if (
          target === "/api/v1/archive/candidates"
          && request.headers["x-research-console-action"] !== "archive-candidate"
        ) throw requestError("ACTION_CONFIRMATION_REQUIRED")
        if (
          target === "/api/v1/archive/rebuild"
          && request.headers["x-research-console-action"] !== "rebuild-library"
        ) throw requestError("ACTION_CONFIRMATION_REQUIRED")
        const rawBody = await readJsonBody(request, route.get(target))

        if (target === "/api/v1/submission-project/state") {
          const result = await coordinator.run(() => saveSubmissionProjectState({ repoRoot, request: rawBody }))
          sendJson(response, 200, result)
          return
        }

        if (target === "/api/v1/workbench-state") {
          sendJson(response, 200, await workbenchState.save(rawBody))
          return
        }

        if (target === "/api/v1/papers/source-path") {
          const body = sourcePathBody(rawBody)
          const context = await loadContext({ repoRoot })
          const sourcePath = context?.unitDirectoryByPaperId?.get(body.paper_id)
          if (typeof sourcePath !== "string" || sourcePath.length === 0) throw requestError("PAPER_NOT_FOUND")
          sendJson(response, 200, { paper_id: body.paper_id, source_path: sourcePath })
          return
        }

        if (target === "/api/v1/notes/inspect") {
          const body = inspectBody(rawBody)
          const context = await loadContext({ repoRoot })
          const paper = context?.papersById?.get(body.paper_id)
          const unitDirectory = context?.unitDirectoryByPaperId?.get(body.paper_id)
          if (!paper || typeof unitDirectory !== "string") throw requestError("PAPER_NOT_FOUND")
          const inspected = await inspect({
            paper,
            unitDirectory,
            category: body.category,
            originalFileName: body.original_file_name,
            markdown: body.markdown,
          })
          const snapshot = { ...inspected.snapshot, unit_real_path: unitDirectory }
          const token = inspectionStore.create(snapshot)
          sendJson(response, 200, { ...inspected.publicResult, ...token })
          return
        }

        if (target === "/api/v1/notes/import") {
          const body = importBody(rawBody)
          const result = await coordinator.run(async () => {
            const snapshot = inspectionStore.take(body.inspection_id)
            try {
              return await importNote({
                repoRoot,
                snapshot,
                requestedFileName: body.requested_file_name,
                conflictPolicy: body.conflict_policy,
                loadContext,
                rebuild,
              })
            } catch (error) {
              if (["ROLLBACK_FAILED", "BUILD_OUTPUT_INVALID"].includes(error?.code)) {
                await coordinator.markRecovery({ kind: "manual_note", reason_code: error.code })
              }
              throw error
            }
          })
          sendJson(response, 200, result)
          return
        }

        if (target === "/api/v1/archive/candidates") {
          let body
          try { body = validateArchiveRequest(rawBody) } catch { throw requestError("INVALID_REQUEST") }
          const result = await coordinator.run(() => archiveAction({
            repoRoot,
            request: body,
            loadContext,
            rebuild,
            markRecovery: (details) => coordinator.markRecovery(details),
            recoveryStore,
          }))
          if (result.rebuild_status === "failed") {
            sendJson(response, 201, {
              status: "created",
              paper_id: result.paper_id,
              folder_name: result.folder_name,
              rebuild_status: "failed",
              index_state: "last_good",
              recovery_required: true,
            })
          } else {
            sendJson(response, 201, result)
          }
          return
        }

        const body = recoveryBody(rawBody)
        const result = await coordinator.runRecovery(() => recoveryAction({
          repoRoot,
          request: body,
          recovery: coordinator.getState().recovery,
          loadContext,
          rebuild,
          clearRecovery: () => coordinator.clearRecovery("candidate_archive"),
          recoveryStore,
        }))
        sendJson(response, 200, result)
        return
      }

      if (!["GET", "HEAD"].includes(request.method)) {
        sendNotFound(request, response)
        return
      }
      const path = safeStaticPath(target)
      if (!path) {
        sendNotFound(request, response)
        return
      }
      if (path.pathname === "/" && !path.hasQuery) {
        response.writeHead(302, {
          Location: "/local_library_output/desktop/library.html",
          "Content-Length": 0,
          "X-Content-Type-Options": "nosniff",
        })
        response.end()
        return
      }
      if (!await serveStatic({ request, response, repoRoot, pathname: path.pathname, fileSystem: staticIo })) {
        sendNotFound(request, response)
      }
    } catch (error) {
      sendFailure(response, error, logger)
    }
  }
}

function waitForListen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.removeListener("listening", onListening)
      rejectListen(error)
    }
    const onListening = () => {
      server.removeListener("error", onError)
      resolveListen()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    try {
      server.listen(port, "127.0.0.1")
    } catch (error) {
      server.removeListener("error", onError)
      server.removeListener("listening", onListening)
      rejectListen(error)
    }
  })
}

export async function startPrivateLibraryServer({
  repoRoot,
  port = 4176,
  loadContext = loadPrivateLibraryContext,
  rebuild = rebuildConfiguredLibrary,
  createServer = createHttpServer,
  inspectionStore = createInspectionStore(),
  coordinator = createWriteCoordinator(),
  recoveryStore = createArchiveRecoveryStore(),
  ...dependencies
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0 || ![0, 4176].includes(port)) {
    throw new TypeError("本地论文库启动参数无效")
  }
  let context
  try {
    context = await loadContext({ repoRoot })
    await rebuild({ repoRoot, context })
  } catch {
    throw new Error("本地论文库启动构建失败")
  }

  let origin = null
  const handler = createPrivateLibraryRequestHandler({
    repoRoot,
    getOrigin: () => origin,
    loadContext,
    rebuild,
    inspectionStore,
    coordinator,
    recoveryStore,
    ...dependencies,
  })
  const server = createServer(handler)
  await waitForListen(server, port)
  const address = server.address()
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise((resolveClose) => server.close(resolveClose))
    throw new Error("本地论文库监听地址无效")
  }
  origin = `http://127.0.0.1:${address.port}`
  let closed = false
  return {
    server,
    origin,
    close: () => new Promise((resolveClose, rejectClose) => {
      if (closed) { resolveClose(); return }
      closed = true
      server.close((error) => error ? rejectClose(error) : resolveClose())
    }),
  }
}
