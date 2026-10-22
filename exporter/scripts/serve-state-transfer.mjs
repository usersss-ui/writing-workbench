import { createServer as createHttpServer } from "node:http"
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const STATE_TRANSFER_ASSET_FILES = Object.freeze([
  "state-transfer.mjs",
  "p02-workflow.mjs",
  "discovery-workspace.mjs",
  "discovery-batch.mjs",
  "discovery-identity.mjs",
  "discovery-record.mjs",
  "openalex-search.mjs",
  "bibliography-normalization.mjs",
  "journal-review.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "candidate-storage.mjs",
  "paper-library-model.mjs",
  "styles.css",
])

const ALLOWED_PORTS = new Set([4176, 4177, 4178])
const ASSET_SET = new Set(STATE_TRANSFER_ASSET_FILES)
const FAILURE_MESSAGE = "浏览器状态迁移工具启动失败。请检查本机文件边界。\n"
const DEFAULT_FILE_SYSTEM = Object.freeze({
  lstat,
  open,
  realpath,
  noFollowFlag: constants.O_NOFOLLOW,
})

function inside(root, target) {
  const fromRoot = relative(root, target)
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  )
}

function responseHeaders(path, length) {
  const type = extname(path).toLowerCase() === ".css"
    ? "text/css; charset=utf-8"
    : extname(path).toLowerCase() === ".html"
      ? "text/html; charset=utf-8"
      : "text/javascript; charset=utf-8"
  return {
    "Cache-Control": "no-store",
    "Content-Length": length,
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
  }
}

function endEmpty(response, status, headers = {}) {
  response.writeHead(status, {
    "Content-Length": 0,
    "X-Content-Type-Options": "nosniff",
    ...headers,
  })
  response.end()
}

function exactRoute(rawTarget) {
  if (
    typeof rawTarget !== "string"
    || !rawTarget.startsWith("/")
    || rawTarget.includes("?")
    || rawTarget.includes("#")
    || rawTarget.includes("%")
    || rawTarget.includes("\\")
    || rawTarget.includes("\0")
  ) return null
  if (rawTarget === "/state-transfer.html") return "state-transfer.html"
  const prefix = "/assets/"
  if (!rawTarget.startsWith(prefix)) return null
  const fileName = rawTarget.slice(prefix.length)
  return ASSET_SET.has(fileName) ? fileName : null
}

function trustedHost(request, getOrigin) {
  let expected
  try { expected = new URL(getOrigin()).host } catch { return false }
  return typeof request.headers?.host === "string" && request.headers.host === expected
}

async function readApprovedFile({ repoRoot, fileName, fileSystem: io }) {
  let handle = null
  try {
    for (const method of ["lstat", "open", "realpath"]) if (typeof io?.[method] !== "function") return null
    if (!Number.isInteger(io.noFollowFlag) || io.noFollowFlag <= 0) return null
    const lexicalRepo = resolve(repoRoot)
    const repoInfo = await io.lstat(lexicalRepo, { bigint: true })
    const canonicalRepo = await io.realpath(lexicalRepo)
    if (repoInfo.isSymbolicLink() || !repoInfo.isDirectory() || canonicalRepo !== lexicalRepo) return null
    const repoIdentity = `${repoInfo.dev}:${repoInfo.ino}`

    const lexicalRoot = join(canonicalRepo, "prototype/desktop")
    if (!inside(canonicalRepo, lexicalRoot)) return null
    const rootInfo = await io.lstat(lexicalRoot, { bigint: true })
    const canonicalRoot = await io.realpath(lexicalRoot)
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || canonicalRoot !== lexicalRoot) return null
    const rootIdentity = `${rootInfo.dev}:${rootInfo.ino}`

    const lexicalFile = join(canonicalRoot, fileName)
    if (!inside(canonicalRoot, lexicalFile)) return null
    const fileInfo = await io.lstat(lexicalFile, { bigint: true })
    const canonicalFile = await io.realpath(lexicalFile)
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || canonicalFile !== lexicalFile) return null
    const fileIdentity = `${fileInfo.dev}:${fileInfo.ino}`
    const fileSize = Number(fileInfo.size)

    handle = await io.open(canonicalFile, constants.O_RDONLY | io.noFollowFlag)
    const openedBefore = await handle.stat({ bigint: true })
    if (
      !openedBefore.isFile()
      || `${openedBefore.dev}:${openedBefore.ino}` !== fileIdentity
      || Number(openedBefore.size) !== fileSize
    ) return null
    const bytes = await handle.readFile()
    const openedAfter = await handle.stat({ bigint: true })
    const fileAfter = await io.lstat(lexicalFile, { bigint: true })
    const rootAfter = await io.lstat(lexicalRoot, { bigint: true })
    const repoAfter = await io.lstat(lexicalRepo, { bigint: true })
    if (
      !openedAfter.isFile()
      || `${openedAfter.dev}:${openedAfter.ino}` !== fileIdentity
      || Number(openedAfter.size) !== fileSize
      || bytes.length !== fileSize
      || fileAfter.isSymbolicLink()
      || !fileAfter.isFile()
      || `${fileAfter.dev}:${fileAfter.ino}` !== fileIdentity
      || Number(fileAfter.size) !== fileSize
      || await io.realpath(lexicalFile) !== canonicalFile
      || rootAfter.isSymbolicLink()
      || !rootAfter.isDirectory()
      || `${rootAfter.dev}:${rootAfter.ino}` !== rootIdentity
      || await io.realpath(lexicalRoot) !== canonicalRoot
      || repoAfter.isSymbolicLink()
      || !repoAfter.isDirectory()
      || `${repoAfter.dev}:${repoAfter.ino}` !== repoIdentity
      || await io.realpath(lexicalRepo) !== canonicalRepo
    ) return null
    return { bytes, path: canonicalFile }
  } catch {
    return null
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* the validated read remains authoritative */ }
    }
  }
}

export function createStateTransferRequestHandler({
  repoRoot,
  getOrigin,
  staticFileSystem = {},
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0 || typeof getOrigin !== "function") {
    throw new TypeError("浏览器状态迁移服务配置无效")
  }
  const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...staticFileSystem }
  return async function stateTransferRequestHandler(request, response) {
    if (!trustedHost(request, getOrigin)) {
      endEmpty(response, 400)
      return
    }
    const fileName = exactRoute(request.url)
    if (!fileName) {
      endEmpty(response, 404)
      return
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      endEmpty(response, 405, { Allow: "GET, HEAD" })
      return
    }
    const resource = await readApprovedFile({ repoRoot, fileName, fileSystem })
    if (!resource) {
      endEmpty(response, 404)
      return
    }
    response.writeHead(200, responseHeaders(resource.path, resource.bytes.length))
    response.end(request.method === "HEAD" ? undefined : resource.bytes)
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
    try { server.listen(port, "127.0.0.1") } catch (error) {
      server.removeListener("error", onError)
      server.removeListener("listening", onListening)
      rejectListen(error)
    }
  })
}

export async function startStateTransferServer({
  repoRoot,
  port,
  createServer = createHttpServer,
  ...dependencies
} = {}) {
  if (
    typeof repoRoot !== "string"
    || repoRoot.length === 0
    || !Number.isInteger(port)
    || (port !== 0 && !ALLOWED_PORTS.has(port))
  ) throw new TypeError("浏览器状态迁移服务启动参数无效")
  let origin = null
  const handler = createStateTransferRequestHandler({
    repoRoot,
    getOrigin: () => origin,
    ...dependencies,
  })
  const server = createServer(handler)
  await waitForListen(server, port)
  const address = server.address()
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise((resolveClose) => server.close(resolveClose))
    throw new Error("浏览器状态迁移服务监听地址无效")
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

export function parseStateTransferArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== "--port" || !/^(?:4176|4177|4178)$/u.test(argv[1])) {
    throw new TypeError("浏览器状态迁移工具参数无效")
  }
  return { port: Number(argv[1]) }
}

export async function main({
  argv = process.argv.slice(2),
  repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  start = startStateTransferServer,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const { port } = parseStateTransferArguments(argv)
    const server = await start({ repoRoot, port })
    stdout.write(`浏览器状态迁移工具：${server.origin}/state-transfer.html\n`)
    return 0
  } catch {
    stderr.write(FAILURE_MESSAGE)
    return 1
  }
}

const invokedPath = typeof process.argv[1] === "string"
  ? pathToFileURL(resolve(process.argv[1])).href
  : null

if (invokedPath === import.meta.url) process.exitCode = await main()
