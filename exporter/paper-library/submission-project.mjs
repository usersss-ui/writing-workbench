import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, rename, unlink } from "node:fs/promises"
import { extname, isAbsolute, join } from "node:path"

export const SUBMISSION_STATE_REQUEST_MAX_BYTES = 1_500_000
const CONFIG_MAX_BYTES = 2 * 1024 * 1024
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const TEXT_FIELDS = {
  algorithmFacts: ["id", "title", "finding", "status", "sourceDocumentId"],
  scenarios: ["id", "title", "summary", "decisionVariable", "nextStep", "writingTitle"],
  datasets: ["id", "name", "url", "description"],
  journals: ["id", "name", "url", "fit", "formatNote"],
  references: ["id", "title", "journalId", "doi", "url", "versionNote", "structure", "lesson", "documentId"],
  experiments: ["id", "title", "purpose", "comparison"],
  outline: ["title", "purpose", "source"],
  documents: ["id", "title", "kind", "description"],
}
const ARRAY_FIELDS = {
  scenarios: ["datasetIds", "journalIds", "advantages", "requirements", "metrics"],
  datasets: ["caveats"],
  experiments: ["metrics", "scenarioIds"],
}
const STATE_KEYS = ["version", "projectId", "revision", "scenarioId", "journalId", "experiments", "notes", "draft"]

function failure(code) {
  return Object.assign(new Error(code), { code })
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function identifier(value) {
  return typeof value === "string" && value.length <= 128 && ID.test(value)
}

function safeText(value, maximum = 200_000) {
  return typeof value === "string" && value.length <= maximum && !value.includes("\u0000")
}

function configurationDirectory(repoRoot) {
  return join(repoRoot, "local_library_config")
}

async function readBoundedFile(path, maximum, unavailableCode, oversizedCode = unavailableCode) {
  let handle
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) throw failure(unavailableCode)
    if (before.size > maximum) throw failure(oversizedCode)
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || before.ino !== opened.ino || before.dev !== opened.dev) throw failure(unavailableCode)
    if (opened.size > maximum) throw failure(oversizedCode)
    // A fixed buffer also bounds a file which grows after the initial stat.
    const buffer = Buffer.alloc(opened.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await handle.stat()
    if (after.size > maximum) throw failure(oversizedCode)
    if (after.size !== opened.size || length !== opened.size || after.mtimeMs !== opened.mtimeMs) throw failure(unavailableCode)
    return buffer.subarray(0, length)
  } catch (error) {
    if (error?.code === "ENOENT") throw error
    if ([unavailableCode, oversizedCode].includes(error?.code)) throw error
    throw failure(unavailableCode)
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

function projectProjection(value) {
  const invalid = () => { throw failure("SUBMISSION_PROJECT_INVALID") }
  if (!plain(value) || value.schema !== "research-submission-project" || value.version !== 1 || !identifier(value.id)) invalid()
  const result = { schema: value.schema, version: 1, id: value.id }
  for (const key of ["title", "updatedAt", "summary", "statusLabel", "recommendation"]) {
    if (!safeText(value[key])) invalid()
    result[key] = value[key]
  }
  for (const [collection, fields] of Object.entries(TEXT_FIELDS)) {
    if (!Array.isArray(value[collection]) || value[collection].length > 500) invalid()
    if (collection === "scenarios" && value[collection].length === 0) invalid()
    const seen = new Set()
    result[collection] = value[collection].map((record) => {
      if (!plain(record)) invalid()
      const item = {}
      if (collection !== "outline") {
        if (!identifier(record.id) || seen.has(record.id)) invalid()
        seen.add(record.id)
      }
      for (const field of fields) {
        if (!safeText(record[field])) invalid()
        item[field] = record[field]
      }
      for (const field of ARRAY_FIELDS[collection] ?? []) {
        if (!Array.isArray(record[field]) || record[field].length > 500 || record[field].some((entry) => !safeText(entry))) invalid()
        item[field] = [...record[field]]
      }
      if (collection === "scenarios") {
        if (!Number.isSafeInteger(record.priority) || record.priority < 0) invalid()
        item.priority = record.priority
      }
      if (collection === "references") {
        if (!Number.isSafeInteger(record.year) || record.year < 1900 || record.year > 2200) invalid()
        item.year = record.year
      }
      if (collection === "documents") {
        if (!safeText(record.path, 4096) || !isAbsolute(record.path) || !["report", "pdf", "source"].includes(record.kind)) invalid()
        item.url = `/api/v1/submission-project/documents/${record.id}`
      }
      return item
    })
  }
  const ids = Object.fromEntries(Object.keys(TEXT_FIELDS).map((key) => [key, new Set(result[key].map((item) => item.id))]))
  const contains = (collection, id) => identifier(id) && ids[collection].has(id)
  for (const item of result.scenarios) {
    if (!item.datasetIds.every((id) => contains("datasets", id)) || !item.journalIds.every((id) => contains("journals", id))) invalid()
  }
  for (const item of result.experiments) if (!item.scenarioIds.every((id) => contains("scenarios", id))) invalid()
  for (const item of result.references) {
    if (item.journalId !== undefined && !contains("journals", item.journalId)) invalid()
    if (item.documentId !== undefined && !contains("documents", item.documentId)) invalid()
  }
  for (const item of result.algorithmFacts) {
    if (item.sourceDocumentId !== undefined && !contains("documents", item.sourceDocumentId)) invalid()
    if (item.status !== undefined && !["verified", "gap"].includes(item.status)) invalid()
  }
  for (const item of result.outline) if (item.source !== undefined && !contains("documents", item.source)) invalid()
  return result
}

async function readProject(repoRoot) {
  try {
    const raw = await readBoundedFile(join(configurationDirectory(repoRoot), "submission-project.json"), CONFIG_MAX_BYTES, "SUBMISSION_PROJECT_INVALID")
    const configuration = JSON.parse(raw.toString("utf8"))
    return { configuration, project: projectProjection(configuration) }
  } catch (error) {
    if (error?.code === "ENOENT") throw failure("SUBMISSION_PROJECT_NOT_FOUND")
    throw failure("SUBMISSION_PROJECT_INVALID")
  }
}

export function createSubmissionProjectState(projectId) {
  return { version: 1, projectId, revision: 0, scenarioId: null, journalId: null, experiments: {}, notes: "", draft: "" }
}

export function validateSubmissionProjectState(state, project) {
  const invalid = () => { throw failure("SUBMISSION_STATE_INVALID") }
  if (!exact(state, STATE_KEYS) || state.version !== 1 || state.projectId !== project.id || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision >= Number.MAX_SAFE_INTEGER) invalid()
  const scenario = project.scenarios.find((item) => item.id === state.scenarioId)
  if (state.scenarioId !== null && !scenario) invalid()
  if (state.journalId !== null && (!scenario || !scenario.journalIds.includes(state.journalId))) invalid()
  if (!safeText(state.notes, 20_000) || !safeText(state.draft, 200_000) || !plain(state.experiments)) invalid()
  const experimentIds = new Set(project.experiments.map((item) => item.id))
  const experiments = {}
  for (const [id, value] of Object.entries(state.experiments)) {
    if (!experimentIds.has(id) || !exact(value, ["status", "evidence"]) || !["planned", "running", "done"].includes(value.status) || !safeText(value.evidence, 10_000)) invalid()
    if (value.status === "done" && !value.evidence.trim()) invalid()
    experiments[id] = { status: value.status, evidence: value.evidence }
  }
  return { version: 1, projectId: project.id, revision: state.revision, scenarioId: state.scenarioId, journalId: state.journalId, experiments, notes: state.notes, draft: state.draft }
}

async function readState(repoRoot, project) {
  try {
    const raw = await readBoundedFile(join(configurationDirectory(repoRoot), "submission-project-state.json"), SUBMISSION_STATE_REQUEST_MAX_BYTES, "SUBMISSION_STATE_CORRUPT")
    return validateSubmissionProjectState(JSON.parse(raw.toString("utf8")), project)
  } catch (error) {
    if (error?.code === "ENOENT") return createSubmissionProjectState(project.id)
    throw failure("SUBMISSION_STATE_CORRUPT")
  }
}

export async function loadSubmissionProject({ repoRoot }) {
  const { project } = await readProject(repoRoot)
  return { project, state: await readState(repoRoot, project) }
}

export async function saveSubmissionProjectState({ repoRoot, request }) {
  if (!exact(request, ["expectedRevision", "state"]) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw failure("SUBMISSION_STATE_INVALID")
  const { project } = await readProject(repoRoot)
  const state = validateSubmissionProjectState(request.state, project)
  const current = await readState(repoRoot, project)
  if (request.expectedRevision !== current.revision || state.revision !== current.revision) throw failure("SUBMISSION_REVISION_CONFLICT")
  const saved = { ...state, revision: current.revision + 1 }
  const directory = configurationDirectory(repoRoot)
  const temporary = join(directory, `.submission-state-${randomUUID()}.tmp`)
  let handle
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure("SUBMISSION_WRITE_FAILED")
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(`${JSON.stringify(saved, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, join(directory, "submission-project-state.json"))
    return { state: saved }
  } catch {
    throw failure("SUBMISSION_WRITE_FAILED")
  } finally {
    if (handle) await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
}

export async function readSubmissionDocument({ repoRoot, documentId }) {
  if (!identifier(documentId)) throw failure("SUBMISSION_DOCUMENT_NOT_FOUND")
  const { configuration } = await readProject(repoRoot)
  const document = configuration.documents.find((item) => item.id === documentId)
  if (!document) throw failure("SUBMISSION_DOCUMENT_NOT_FOUND")
  const extension = extname(document.path).toLowerCase()
  if (![".pdf", ".md", ".txt"].includes(extension)) throw failure("SUBMISSION_DOCUMENT_NOT_FOUND")
  const pdf = extension === ".pdf"
  try {
    const body = await readBoundedFile(document.path, pdf ? 30 * 1024 * 1024 : 2 * 1024 * 1024, "SUBMISSION_DOCUMENT_NOT_FOUND", "SUBMISSION_DOCUMENT_TOO_LARGE")
    return { body, contentType: pdf ? "application/pdf" : "text/plain; charset=utf-8" }
  } catch (error) {
    if (error?.code === "ENOENT") throw failure("SUBMISSION_DOCUMENT_NOT_FOUND")
    throw error
  }
}
