import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises"
import { join } from "node:path"

// Browser research state that used to live in localStorage. Values are the
// exact strings the page modules write; each module validates its own schema.
export const WORKBENCH_STATE_REQUEST_MAX_BYTES = 16 * 1024 * 1024
const FILE_MAX_BYTES = WORKBENCH_STATE_REQUEST_MAX_BYTES
const EXACT_KEYS = new Set([
  "research-console.direction-snapshot.v1",
  "research-console.paper-library.v1",
  "research-console.paper-user-tags.v1",
  "research-console.discovery-candidates.v1",
  "research-console.discovery-workspace.v1",
  "research-console.agent-task-input.v1",
])
const AGENT_TASK_SUBKEY = /^research-console\.agent-task-input\.v1\.(?:current|(?:snapshot|pending)\.[A-Z0-9-]{1,96})$/u
const FILE_SUFFIX = ".json"

export function isWorkbenchStateKey(key) {
  return typeof key === "string" && (EXACT_KEYS.has(key) || AGENT_TASK_SUBKEY.test(key))
}

function failure(code) {
  return Object.assign(new Error(code), { code })
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validValue(value) {
  return value === null || (typeof value === "string" && !value.includes("\u0000"))
}

async function realDirectory(path) {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure("WORKBENCH_STATE_WRITE_FAILED")
}

async function readEntryFile(path, key) {
  let handle
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size > FILE_MAX_BYTES) throw failure("WORKBENCH_STATE_CORRUPT")
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (before.ino !== opened.ino || before.dev !== opened.dev || opened.size > FILE_MAX_BYTES) throw failure("WORKBENCH_STATE_CORRUPT")
    const entry = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()))
    if (!exact(entry, ["version", "key", "revision", "value"]) || entry.version !== 1 || entry.key !== key || !validRevision(entry.revision) || !validValue(entry.value)) {
      throw failure("WORKBENCH_STATE_CORRUPT")
    }
    return { revision: entry.revision, value: entry.value }
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw failure("WORKBENCH_STATE_CORRUPT")
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

export function createWorkbenchStateStore({ repoRoot }) {
  const configDirectory = join(repoRoot, "local_library_config")
  const stateDirectory = join(configDirectory, "workbench-state")
  const queues = new Map()

  function entryPath(key) {
    return join(stateDirectory, `${key}${FILE_SUFFIX}`)
  }

  async function load() {
    let names
    try {
      await realDirectory(stateDirectory)
      names = await readdir(stateDirectory)
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, entries: {} }
      throw failure("WORKBENCH_STATE_CORRUPT")
    }
    const entries = {}
    for (const name of names.sort()) {
      if (!name.endsWith(FILE_SUFFIX)) continue
      const key = name.slice(0, -FILE_SUFFIX.length)
      if (!isWorkbenchStateKey(key)) continue
      const entry = await readEntryFile(entryPath(key), key)
      if (entry) entries[key] = entry
    }
    return { version: 1, entries }
  }

  async function write(key, entry) {
    await realDirectory(configDirectory)
    await mkdir(stateDirectory, { mode: 0o700 }).catch((error) => { if (error?.code !== "EEXIST") throw error })
    await realDirectory(stateDirectory)
    const temporary = join(stateDirectory, `.${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      await handle.writeFile(`${JSON.stringify({ version: 1, key, ...entry })}\n`, "utf8")
      await handle.sync()
      await handle.close()
      handle = null
      await rename(temporary, entryPath(key))
    } finally {
      if (handle) await handle.close().catch(() => {})
      await unlink(temporary).catch(() => {})
    }
  }

  async function saveNow(key, expectedRevision, value) {
    const current = await readEntryFile(entryPath(key), key)
    const revision = current?.revision ?? 0
    if (expectedRevision !== revision) throw failure("WORKBENCH_STATE_CONFLICT")
    const saved = { revision: revision + 1, value }
    try {
      await write(key, saved)
    } catch {
      throw failure("WORKBENCH_STATE_WRITE_FAILED")
    }
    return { key, ...saved }
  }

  function save(request) {
    if (!exact(request, ["key", "expectedRevision", "value"]) || !isWorkbenchStateKey(request.key) || !validRevision(request.expectedRevision) || !validValue(request.value)) {
      return Promise.reject(failure("WORKBENCH_STATE_INVALID"))
    }
    const { key, expectedRevision, value } = request
    // Writes to one key run one at a time so revisions stay strictly ordered.
    const previous = queues.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(() => saveNow(key, expectedRevision, value))
    const settled = result.catch(() => {})
    queues.set(key, settled)
    settled.then(() => { if (queues.get(key) === settled) queues.delete(key) })
    return result
  }

  return { load, save }
}
