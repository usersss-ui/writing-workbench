import { isValidDirectionSnapshot } from "./direction-snapshot.mjs"
import { P02_ROLES } from "./paper-library-model.mjs"

export const TASK_INPUT_STORAGE_KEY = "research-console.agent-task-input.v1"
const SNAPSHOT_PREFIX = `${TASK_INPUT_STORAGE_KEY}.snapshot.`
const PENDING_PREFIX = `${TASK_INPUT_STORAGE_KEY}.pending.`
const CURRENT_KEY = `${TASK_INPUT_STORAGE_KEY}.current`

const PAPER_KEYS = Object.freeze([
  "paper_id", "shelf_roles", "title_zh", "title_en", "authors", "year",
  "source_status", "evidence_status", "reproduction_status",
])
const SNAPSHOT_KEYS = Object.freeze([
  "version", "snapshot_id", "created_at", "project_id", "direction_snapshot", "papers", "note_fragment_refs",
])
const STORE_KEYS = Object.freeze(["version", "current_snapshot_id", "snapshots"])
const PENDING_KEYS = Object.freeze(["version", "snapshot", "previous_current_id"])
const WORKSPACE_KEYS = Object.freeze(["version", "shelf", "personalReading", "selectedPaperId"])
const PAPER_ID = /^(?:[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|LIB-[A-F0-9]{12})$/u
const SNAPSHOT_NONCE = /^[A-Z0-9]{16,32}$/u
const SOURCE_STATUS = Object.freeze(["not_checked", "located", "verified"])
const EVIDENCE_STATUS = Object.freeze(["none", "partial", "core_verified"])
const REPRODUCTION_STATUS = Object.freeze([
  "none", "description_only", "code_unrun", "ran_no_record", "results_recorded", "consistency_verified",
])

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false
  let ownKeys
  let descriptors
  try {
    ownKeys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return false
  }
  if (ownKeys.some((key) => typeof key !== "string")) return false
  const actual = ownKeys.sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && actual.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key])
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string") return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function rolesAreCanonical(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return false
  let previousIndex = -1
  for (const role of roles) {
    const index = P02_ROLES.indexOf(role)
    if (index < 0 || index <= previousIndex) return false
    previousIndex = index
  }
  return true
}

function validWorkspaceState(value) {
  if (!hasExactKeys(value, WORKSPACE_KEYS) || value.version !== 1) return false
  if (!isPlainObject(value.shelf) || !isPlainObject(value.personalReading)) return false
  if (value.selectedPaperId !== null && (typeof value.selectedPaperId !== "string" || !PAPER_ID.test(value.selectedPaperId))) return false
  return Object.entries(value.shelf).every(([paperId, roles]) => PAPER_ID.test(paperId) && rolesAreCanonical(roles))
}

function validPaperIndex(value) {
  const schemaVersion = value?.version === 3 ? 2 : value?.version === 2 ? 1 : null
  if (!isPlainObject(value)
    || schemaVersion === null
    || !isPlainObject(value.facet_schema)
    || value.facet_schema.version !== schemaVersion
    || !Array.isArray(value.papers)) return false
  const ids = new Set()
  for (const paper of value.papers) {
    if (!isPlainObject(paper) || typeof paper.paper_id !== "string" || !PAPER_ID.test(paper.paper_id) || ids.has(paper.paper_id)) return false
    ids.add(paper.paper_id)
  }
  return true
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function safeAuthors(value) {
  return Array.isArray(value)
    ? value.filter((author) => typeof author === "string" && author.trim()).map((author) => author.trim())
    : []
}

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null
}

function taskTitles(paper) {
  const titleZh = safeString(paper?.title_zh)
  const titleEn = safeString(paper?.title_en)
  const original = safeString(paper?.title_original)
  if (titleZh || titleEn || !original) return { title_zh: titleZh, title_en: titleEn }
  return /\p{Script=Han}/u.test(original)
    ? { title_zh: original, title_en: null }
    : { title_zh: null, title_en: original }
}

function containsAbsolutePath(value) {
  if (/(?:file:\/\/|~[\\/](?=\S))/iu.test(value)) return true
  if (/(?:^|[^A-Za-z])[A-Za-z]:[\\/](?=\S)/u.test(value) || /\\\\[^\s\\]+\\[^\s]+/u.test(value)) return true
  const withoutWebUrls = value.replace(/\bhttps?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+=%-]+/giu, "")
  return /\/(?!\/|\s)(?:[^\s/]+\/)+[^\s/]+/u.test(withoutWebUrls)
    || /(?:^|[^\p{L}\p{N}])\/(?!\/|\s)[^\s/]+/u.test(withoutWebUrls)
}

function unsafeMetadataText(value) {
  if (typeof value !== "string") return false
  const text = value.trim()
  return Boolean(text) && (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)
    || containsAbsolutePath(text)
    || /\bauthorization\s*[:=]\s*[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*\s+\S+/iu.test(text)
    || /(?:api[_-]?key|password|(?:client[_-]?)?secret|private[_-]?key|oauth[_-]?token|token|(?:access|refresh|id|auth|session)[_-]?token)\s*["']?\s*[:=]\s*["']?\s*\S+/iu.test(text)
    || /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/iu.test(text)
    || /\b[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/iu.test(text)
  )
}

function paperHasUnsafeMetadata(paper) {
  return unsafeMetadataText(paper?.title_zh)
    || unsafeMetadataText(paper?.title_en)
    || unsafeMetadataText(paper?.title_original)
    || (Array.isArray(paper?.authors) && paper.authors.some(unsafeMetadataText))
}

function paperForTask(paper, roles) {
  return {
    paper_id: paper.paper_id,
    shelf_roles: [...roles],
    ...taskTitles(paper),
    authors: safeAuthors(paper.authors),
    year: Number.isInteger(paper.year) ? paper.year : null,
    source_status: safeEnum(paper.source_status, SOURCE_STATUS),
    evidence_status: safeEnum(paper.evidence_status, EVIDENCE_STATUS),
    reproduction_status: safeEnum(paper.reproduction_status, REPRODUCTION_STATUS),
  }
}

function basePreview(status, directionSnapshot = null) {
  return {
    version: 1,
    project_id: "P02",
    status,
    ready: status === "ready",
    direction_snapshot: directionSnapshot ? clone(directionSnapshot) : null,
    selected_paper_ids: [],
    papers: [],
    missing_paper_ids: [],
    unsafe_paper_ids: [],
    note_fragment_refs: [],
  }
}

export function buildTaskInputPreview({ directionSnapshot, workspaceState, paperIndex } = {}) {
  const shelfEntries = validWorkspaceState(workspaceState)
    ? Object.entries(workspaceState.shelf).sort(([left], [right]) => left.localeCompare(right, "en"))
    : []
  const selectedPaperIds = shelfEntries.map(([paperId]) => paperId)
  if (!isValidDirectionSnapshot(directionSnapshot)) {
    const preview = basePreview("direction_missing")
    preview.selected_paper_ids = selectedPaperIds
    return preview
  }
  if (shelfEntries.length === 0) return basePreview("shelf_missing", directionSnapshot)
  if (!validPaperIndex(paperIndex)) {
    const preview = basePreview("index_error", directionSnapshot)
    preview.selected_paper_ids = selectedPaperIds
    return preview
  }

  const byId = new Map(paperIndex.papers.map((paper) => [paper.paper_id, paper]))
  const missingPaperIds = selectedPaperIds.filter((paperId) => !byId.has(paperId))
  const unsafePaperIds = selectedPaperIds.filter((paperId) => byId.has(paperId) && paperHasUnsafeMetadata(byId.get(paperId)))
  if (unsafePaperIds.length > 0) {
    const preview = basePreview("unsafe_metadata", directionSnapshot)
    preview.selected_paper_ids = selectedPaperIds
    preview.missing_paper_ids = missingPaperIds
    preview.unsafe_paper_ids = unsafePaperIds
    return preview
  }

  const preview = basePreview(missingPaperIds.length > 0 ? "partial" : "ready", directionSnapshot)
  preview.selected_paper_ids = selectedPaperIds
  preview.missing_paper_ids = missingPaperIds
  preview.papers = shelfEntries
    .filter(([paperId]) => byId.has(paperId))
    .map(([paperId, roles]) => paperForTask(byId.get(paperId), roles))
  preview.ready = preview.status === "ready"
  return preview
}

function validTaskPaper(value) {
  if (!hasExactKeys(value, PAPER_KEYS) || !PAPER_ID.test(value.paper_id) || !rolesAreCanonical(value.shelf_roles)) return false
  if (!Array.isArray(value.authors) || !value.authors.every((author) => typeof author === "string" && !unsafeMetadataText(author))) return false
  return (value.year === null || Number.isInteger(value.year))
    && ["title_zh", "title_en"].every((key) => value[key] === null || (typeof value[key] === "string" && !unsafeMetadataText(value[key])))
    && (value.source_status === null || SOURCE_STATUS.includes(value.source_status))
    && (value.evidence_status === null || EVIDENCE_STATUS.includes(value.evidence_status))
    && (value.reproduction_status === null || REPRODUCTION_STATUS.includes(value.reproduction_status))
}

function snapshotIdMatchesCreatedAt(snapshotId, createdAt) {
  const prefix = `INPUT-P02-${createdAt.replace(/[-:.]/gu, "")}-`
  return typeof snapshotId === "string" && snapshotId.startsWith(prefix) && SNAPSHOT_NONCE.test(snapshotId.slice(prefix.length))
}

export function isValidTaskInputSnapshot(value) {
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) return false
  if (value.version !== 1
    || !isCanonicalIsoDate(value.created_at)
    || !snapshotIdMatchesCreatedAt(value.snapshot_id, value.created_at)
    || value.project_id !== "P02"
    || !isValidDirectionSnapshot(value.direction_snapshot)
    || !Array.isArray(value.papers)
    || value.papers.length === 0
    || !value.papers.every(validTaskPaper)
    || !Array.isArray(value.note_fragment_refs)
    || value.note_fragment_refs.length !== 0) return false
  const paperIds = value.papers.map((paper) => paper.paper_id)
  const canonical = [...paperIds].sort((left, right) => left.localeCompare(right, "en"))
  return new Set(paperIds).size === paperIds.length && paperIds.every((paperId, index) => paperId === canonical[index])
}

function createSnapshotNonce() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/gu, "").toUpperCase()
  }
  const time = Date.now().toString(36).toUpperCase().padStart(10, "0")
  const random = Math.random().toString(36).slice(2).toUpperCase().padEnd(22, "0")
  return `${time}${random}`.slice(0, 32)
}

export function createTaskInputSnapshot(preview, {
  createdAt = new Date().toISOString(),
  snapshotNonce = createSnapshotNonce(),
} = {}) {
  if (!preview?.ready || preview.status !== "ready") throw new Error("输入尚未就绪，不能固定快照")
  if (!isCanonicalIsoDate(createdAt)) throw new TypeError("快照时间无效")
  if (!SNAPSHOT_NONCE.test(snapshotNonce)) throw new TypeError("快照随机标识无效")
  const snapshot = {
    version: 1,
    snapshot_id: `INPUT-P02-${createdAt.replace(/[-:.]/gu, "")}-${snapshotNonce}`,
    created_at: createdAt,
    project_id: "P02",
    direction_snapshot: clone(preview.direction_snapshot),
    papers: clone(preview.papers),
    note_fragment_refs: [],
  }
  if (!isValidTaskInputSnapshot(snapshot)) throw new TypeError("任务输入快照无效")
  return clone(snapshot)
}

function emptyState() {
  return { version: 1, current_snapshot_id: null, snapshots: [] }
}

function cloneStoreState(value) {
  return {
    version: 1,
    current_snapshot_id: value.current_snapshot_id,
    snapshots: value.snapshots.map(clone),
  }
}

export function isValidTaskInputStoreState(value) {
  if (!hasExactKeys(value, STORE_KEYS) || value.version !== 1 || !Array.isArray(value.snapshots)) return false
  if (!value.snapshots.every(isValidTaskInputSnapshot)) return false
  const ids = value.snapshots.map((snapshot) => snapshot.snapshot_id)
  return new Set(ids).size === ids.length && (value.current_snapshot_id === null || ids.includes(value.current_snapshot_id))
}

function snapshotKey(snapshotId) {
  return `${SNAPSHOT_PREFIX}${snapshotId}`
}

function pendingKey(snapshotId) {
  return `${PENDING_PREFIX}${snapshotId}`
}

function storageKeys(storage) {
  if (!storage || typeof storage.key !== "function" || !Number.isInteger(storage.length) || storage.length < 0) return null
  const keys = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (typeof key === "string") keys.push(key)
  }
  return keys
}

function validPending(value) {
  return hasExactKeys(value, PENDING_KEYS)
    && value.version === 1
    && isValidTaskInputSnapshot(value.snapshot)
    && (value.previous_current_id === null || typeof value.previous_current_id === "string")
}

function orderAuthoritativeSnapshots(rootSnapshots, entrySnapshots) {
  const entries = new Map(entrySnapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]))
  const snapshots = []
  const seen = new Set()
  for (const cached of rootSnapshots) {
    const authoritative = entries.get(cached.snapshot_id)
    if (!authoritative || JSON.stringify(authoritative) !== JSON.stringify(cached)) return null
    snapshots.push(clone(authoritative))
    seen.add(cached.snapshot_id)
  }
  for (const snapshot of entrySnapshots) {
    if (!seen.has(snapshot.snapshot_id)) snapshots.push(clone(snapshot))
  }
  return snapshots
}

function resolvePendingPointer(pointer, snapshots, storage, keys, seen = new Set()) {
  if (seen.has(pointer)) return { valid: false, current: null }
  seen.add(pointer)
  const key = pendingKey(pointer)
  if (!keys.includes(key)) return { valid: false, current: null }
  let rawPending
  try {
    rawPending = storage.getItem(key)
  } catch {
    return { valid: false, current: null, unavailable: true }
  }
  let pending
  try {
    pending = JSON.parse(rawPending)
  } catch {
    return { valid: false, current: null }
  }
  if (!validPending(pending) || pending.snapshot.snapshot_id !== pointer) return { valid: false, current: null }
  if (pending.previous_current_id === null) return { valid: true, current: null }
  if (snapshots.some((snapshot) => snapshot.snapshot_id === pending.previous_current_id)) {
    return { valid: true, current: pending.previous_current_id }
  }
  return resolvePendingPointer(pending.previous_current_id, snapshots, storage, keys, seen)
}

function inspectStore(storage) {
  if (!storage || typeof storage.getItem !== "function") return { status: "unavailable", state: emptyState() }
  let rawRoot
  try {
    rawRoot = storage.getItem(TASK_INPUT_STORAGE_KEY)
  } catch {
    return { status: "unavailable", state: emptyState() }
  }
  let root
  try {
    root = rawRoot === null ? emptyState() : JSON.parse(rawRoot)
  } catch {
    return { status: "invalid", state: emptyState() }
  }
  if (!isValidTaskInputStoreState(root)) return { status: "invalid", state: emptyState() }
  let keys
  try {
    keys = storageKeys(storage)
  } catch {
    return { status: "unavailable", state: emptyState() }
  }
  if (keys === null) return { status: "invalid", state: emptyState() }
  const entries = []
  for (const key of keys.filter((candidate) => candidate.startsWith(SNAPSHOT_PREFIX))) {
    let rawSnapshot
    try {
      rawSnapshot = storage.getItem(key)
    } catch {
      return { status: "unavailable", state: emptyState() }
    }
    let snapshot
    try {
      snapshot = JSON.parse(rawSnapshot)
    } catch {
      return { status: "invalid", state: emptyState() }
    }
    if (!isValidTaskInputSnapshot(snapshot) || key !== snapshotKey(snapshot.snapshot_id)) {
      return { status: "invalid", state: emptyState() }
    }
    entries.push(snapshot)
  }
  const snapshots = orderAuthoritativeSnapshots(root.snapshots, entries)
  if (snapshots === null) return { status: "invalid", state: emptyState() }
  let independentCurrent
  try {
    independentCurrent = storage.getItem(CURRENT_KEY)
  } catch {
    return { status: "unavailable", state: emptyState() }
  }
  if (independentCurrent === null && root.current_snapshot_id !== null) {
    return { status: "invalid", state: emptyState() }
  }
  let current = independentCurrent
  if (current !== null && !snapshots.some((snapshot) => snapshot.snapshot_id === current)) {
    const resolved = resolvePendingPointer(current, snapshots, storage, keys)
    if (resolved.unavailable) return { status: "unavailable", state: emptyState() }
    if (!resolved.valid) return { status: "invalid", state: emptyState() }
    current = resolved.current
  }
  if (root.current_snapshot_id !== null && root.current_snapshot_id !== current) {
    const pendingResolution = independentCurrent === null
      ? { valid: false, current: null }
      : resolvePendingPointer(independentCurrent, snapshots, storage, keys)
    if (pendingResolution.unavailable) return { status: "unavailable", state: emptyState() }
    if (!pendingResolution.valid || pendingResolution.current !== root.current_snapshot_id) {
      return { status: "invalid", state: emptyState() }
    }
  }
  return {
    status: rawRoot === null && snapshots.length === 0 ? "missing" : "valid",
    state: { version: 1, current_snapshot_id: current, snapshots },
  }
}

function getStorageItem(storage, key, attempts = 1) {
  if (!storage || typeof storage.getItem !== "function") return { known: false, value: null }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return { known: true, value: storage.getItem(key) }
    } catch {
      // A later read can distinguish a transient fault from an unknown durable state.
    }
  }
  return { known: false, value: null }
}

function setStorageItem(storage, key, value) {
  if (!storage || typeof storage.setItem !== "function") return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeStorageItem(storage, key) {
  if (!storage || typeof storage.removeItem !== "function") return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function isAgentOwnerKey(key) {
  return key === TASK_INPUT_STORAGE_KEY
    || key === CURRENT_KEY
    || key.startsWith(SNAPSHOT_PREFIX)
    || key.startsWith(PENDING_PREFIX)
}

function captureAgentOwnerBytes(storage) {
  if (!storage || typeof storage.getItem !== "function") return { status: "unavailable", bytes: null }
  let keys
  try {
    keys = storageKeys(storage)
  } catch {
    return { status: "unavailable", bytes: null }
  }
  if (keys === null) return { status: "unavailable", bytes: null }
  const ownerKeys = [...new Set(keys.filter(isAgentOwnerKey))].sort()
  const orderedKeys = [
    TASK_INPUT_STORAGE_KEY,
    CURRENT_KEY,
    ...ownerKeys.filter((key) => key !== TASK_INPUT_STORAGE_KEY && key !== CURRENT_KEY),
  ]
  const bytes = new Map()
  for (const key of orderedKeys) {
    let value
    try {
      value = storage.getItem(key)
    } catch {
      return { status: "unavailable", bytes: null }
    }
    if (value !== null && typeof value !== "string") return { status: "invalid", bytes: null }
    if (ownerKeys.includes(key) && value === null) return { status: "stale", bytes: null }
    bytes.set(key, value)
  }
  return { status: "valid", bytes }
}

function byteMapsEqual(left, right) {
  if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false
  for (const [key, value] of left) {
    if (!right.has(key) || right.get(key) !== value) return false
  }
  return true
}

function inspectStoreAtomically(storage) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = captureAgentOwnerBytes(storage)
    if (before.status === "invalid") return { status: "invalid", state: emptyState(), bytes: null }
    if (before.status === "unavailable") return { status: "unavailable", state: emptyState(), bytes: null }
    if (before.status === "stale") continue
    const inspected = inspectStore(storage)
    const after = captureAgentOwnerBytes(storage)
    if (after.status === "invalid") return { status: "invalid", state: emptyState(), bytes: null }
    if (after.status === "unavailable") return { status: "unavailable", state: emptyState(), bytes: null }
    if (after.status === "valid" && byteMapsEqual(before.bytes, after.bytes)) {
      return { status: inspected.status, state: cloneStoreState(inspected.state), bytes: after.bytes }
    }
  }
  return { status: "unavailable", state: emptyState(), bytes: null }
}

function committedAgentBytes(bytes) {
  const committed = new Map([
    [TASK_INPUT_STORAGE_KEY, bytes.get(TASK_INPUT_STORAGE_KEY) ?? null],
    [CURRENT_KEY, bytes.get(CURRENT_KEY) ?? null],
  ])
  for (const [key, value] of bytes) {
    if (key.startsWith(SNAPSHOT_PREFIX)) committed.set(key, value)
  }
  return committed
}

function pendingAgentBytes(bytes) {
  return new Map([...bytes].filter(([key]) => key.startsWith(PENDING_PREFIX)))
}

function targetAgentBytes(nextState) {
  const target = new Map([
    [TASK_INPUT_STORAGE_KEY, JSON.stringify(cloneStoreState(nextState))],
    [CURRENT_KEY, nextState.current_snapshot_id],
  ])
  for (const snapshot of nextState.snapshots) {
    target.set(snapshotKey(snapshot.snapshot_id), JSON.stringify(clone(snapshot)))
  }
  return target
}

function ensureStorageValue(storage, key, expected) {
  const current = getStorageItem(storage, key, 2)
  if (current.known && current.value === expected) return true
  if (expected === null) removeStorageItem(storage, key)
  else setStorageItem(storage, key, expected)
  const durable = getStorageItem(storage, key, 2)
  return durable.known && durable.value === expected
}

function applyCommittedAgentBytes(storage, beforeBytes, targetBytes) {
  const beforeCommitted = committedAgentBytes(beforeBytes)
  const targetSnapshotKeys = [...targetBytes.keys()].filter((key) => key.startsWith(SNAPSHOT_PREFIX)).sort()
  for (const key of targetSnapshotKeys) {
    if (!ensureStorageValue(storage, key, targetBytes.get(key))) return false
  }
  if (!ensureStorageValue(storage, CURRENT_KEY, targetBytes.get(CURRENT_KEY))) return false
  if (!ensureStorageValue(storage, TASK_INPUT_STORAGE_KEY, targetBytes.get(TASK_INPUT_STORAGE_KEY))) return false
  for (const key of [...beforeCommitted.keys()].filter(
    (candidate) => candidate.startsWith(SNAPSHOT_PREFIX) && !targetBytes.has(candidate),
  ).sort()) {
    if (!ensureStorageValue(storage, key, null)) return false
  }
  return true
}

function restoreCommittedAgentBytes(storage, beforeBytes, targetBytes) {
  const beforeCommitted = committedAgentBytes(beforeBytes)
  const allSnapshotKeys = new Set([
    ...[...beforeCommitted.keys()].filter((key) => key.startsWith(SNAPSHOT_PREFIX)),
    ...[...targetBytes.keys()].filter((key) => key.startsWith(SNAPSHOT_PREFIX)),
  ])
  let restored = true
  for (const key of [...allSnapshotKeys].sort()) {
    const expected = beforeCommitted.has(key) ? beforeCommitted.get(key) : null
    if (!ensureStorageValue(storage, key, expected)) restored = false
  }
  if (!ensureStorageValue(storage, CURRENT_KEY, beforeCommitted.get(CURRENT_KEY))) restored = false
  if (!ensureStorageValue(storage, TASK_INPUT_STORAGE_KEY, beforeCommitted.get(TASK_INPUT_STORAGE_KEY))) restored = false
  const verified = captureAgentOwnerBytes(storage)
  return restored && verified.status === "valid" && byteMapsEqual(verified.bytes, beforeBytes)
}

function agentBytesMatchTarget(ownerBytes, targetBytes, previousPendingBytes) {
  return byteMapsEqual(committedAgentBytes(ownerBytes), targetBytes)
    && byteMapsEqual(pendingAgentBytes(ownerBytes), previousPendingBytes)
}

function parsePending(raw, snapshot) {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    return validPending(value)
      && value.snapshot.snapshot_id === snapshot.snapshot_id
      && JSON.stringify(value.snapshot) === JSON.stringify(snapshot)
      ? value
      : false
  } catch {
    return false
  }
}

function storedSnapshotMatches(raw, snapshot) {
  if (raw === null) return false
  try {
    const value = JSON.parse(raw)
    return isValidTaskInputSnapshot(value)
      && value.snapshot_id === snapshot.snapshot_id
      && JSON.stringify(value) === JSON.stringify(snapshot)
  } catch {
    return false
  }
}

function inspectStoreWithRetry(storage, attempts = 2) {
  let inspected = inspectStore(storage)
  for (let attempt = 1; attempt < attempts && inspected.status === "invalid"; attempt += 1) {
    inspected = inspectStore(storage)
  }
  return inspected
}

export function createTaskInputSnapshotStore(storage) {
  const initial = inspectStoreAtomically(storage)
  let state = cloneStoreState(initial.state)
  let committedBaseline = initial.bytes instanceof Map
    ? committedAgentBytes(initial.bytes)
    : null

  function rememberCommittedBaseline(bytes) {
    committedBaseline = bytes instanceof Map
      ? new Map(committedAgentBytes(bytes))
      : null
  }

  function refreshCommittedBaseline() {
    const captured = captureAgentOwnerBytes(storage)
    if (captured.status === "valid") rememberCommittedBaseline(captured.bytes)
  }

  return {
    readValidatedState() {
      const inspected = inspectStoreAtomically(storage)
      rememberCommittedBaseline(inspected.bytes)
      return { status: inspected.status, state: cloneStoreState(inspected.state) }
    },

    replaceAllValidated(nextState) {
      if (!isValidTaskInputStoreState(nextState)) throw new TypeError("Agent 任务输入状态无效")
      const replacement = cloneStoreState(nextState)
      const memoryBefore = cloneStoreState(state)
      const before = inspectStoreAtomically(storage)
      if (before.status === "invalid" || before.status === "unavailable") {
        return { replaced: false, status: before.status, state: cloneStoreState(memoryBefore) }
      }
      const beforeCommitted = committedAgentBytes(before.bytes)
      if (!(committedBaseline instanceof Map) || !byteMapsEqual(beforeCommitted, committedBaseline)) {
        return { replaced: false, status: "stale", state: cloneStoreState(memoryBefore) }
      }

      const latest = captureAgentOwnerBytes(storage)
      if (latest.status === "invalid") {
        return { replaced: false, status: "invalid", state: cloneStoreState(memoryBefore) }
      }
      if (latest.status === "unavailable") {
        return { replaced: false, status: "unavailable", state: cloneStoreState(memoryBefore) }
      }
      if (latest.status !== "valid" || !byteMapsEqual(before.bytes, latest.bytes)) {
        return { replaced: false, status: "stale", state: cloneStoreState(memoryBefore) }
      }

      const beforePending = pendingAgentBytes(before.bytes)
      const targetBytes = targetAgentBytes(replacement)
      if (byteMapsEqual(beforeCommitted, targetBytes)) {
        state = cloneStoreState(replacement)
        rememberCommittedBaseline(before.bytes)
        return { replaced: true, state: cloneStoreState(state) }
      }
      const allKeys = new Set([...beforeCommitted.keys(), ...targetBytes.keys()])
      const needsSet = [...allKeys].some((key) => {
        const expected = targetBytes.has(key) ? targetBytes.get(key) : null
        return expected !== null && beforeCommitted.get(key) !== expected
      })
      const needsRemove = [...allKeys].some((key) => {
        const expected = targetBytes.has(key) ? targetBytes.get(key) : null
        return expected === null && beforeCommitted.get(key) !== null && beforeCommitted.get(key) !== undefined
      })
      if ((needsSet && typeof storage?.setItem !== "function")
        || (needsRemove && typeof storage?.removeItem !== "function")) {
        return { replaced: false, status: "unavailable", state: cloneStoreState(memoryBefore) }
      }

      let applied = applyCommittedAgentBytes(storage, before.bytes, targetBytes)
      let after = null
      let reconciled = null
      if (applied) {
        after = captureAgentOwnerBytes(storage)
        applied = after.status === "valid" && agentBytesMatchTarget(after.bytes, targetBytes, beforePending)
      }
      if (applied) {
        reconciled = inspectStoreAtomically(storage)
        applied = reconciled.status === "valid"
          && JSON.stringify(reconciled.state) === JSON.stringify(replacement)
      }
      if (applied) {
        state = cloneStoreState(replacement)
        rememberCommittedBaseline(reconciled.bytes)
        return { replaced: true, state: cloneStoreState(state) }
      }

      const restored = restoreCommittedAgentBytes(storage, before.bytes, targetBytes)
      state = cloneStoreState(memoryBefore)
      return {
        replaced: false,
        status: restored ? "persistence_failed" : "rollback_failed",
        state: cloneStoreState(state),
      }
    },

    append(snapshot) {
      const inspected = inspectStore(storage)
      if (!["missing", "valid"].includes(inspected.status) || !isValidTaskInputSnapshot(snapshot)) return false
      if (inspected.state.snapshots.some((item) => item.snapshot_id === snapshot.snapshot_id)) return false
      const pending = pendingKey(snapshot.snapshot_id)
      const committed = snapshotKey(snapshot.snapshot_id)
      const pendingRead = getStorageItem(storage, pending)
      const committedRead = getStorageItem(storage, committed)
      if (!pendingRead.known || !committedRead.known || committedRead.value !== null) return false

      let pendingRecord = parsePending(pendingRead.value, snapshot)
      if (pendingRecord === false) return false
      const currentRead = getStorageItem(storage, CURRENT_KEY)
      if (!currentRead.known) return false
      const rawCurrentIsCommitted = inspected.state.snapshots.some(
        (item) => item.snapshot_id === currentRead.value,
      )
      const previousCurrentId = rawCurrentIsCommitted
        ? currentRead.value
        : inspected.state.current_snapshot_id
      if (previousCurrentId === snapshot.snapshot_id) return false
      const refreshedPending = {
        version: 1,
        snapshot: clone(snapshot),
        previous_current_id: previousCurrentId,
      }
      if (pendingRecord === null || pendingRecord.previous_current_id !== previousCurrentId) {
        const pendingWriteReturned = setStorageItem(storage, pending, JSON.stringify(refreshedPending))
        const durablePending = getStorageItem(storage, pending, 2)
        const storedPending = durablePending.known ? parsePending(durablePending.value, snapshot) : null
        const pendingProven = durablePending.known
          ? Boolean(storedPending) && storedPending.previous_current_id === previousCurrentId
          : pendingWriteReturned
        if (!pendingProven) return false
      }

      setStorageItem(storage, CURRENT_KEY, snapshot.snapshot_id)
      const durableCurrent = getStorageItem(storage, CURRENT_KEY, 2)
      if (!durableCurrent.known || durableCurrent.value !== snapshot.snapshot_id) {
        // An unknown post-write state must retain pending so any write-then-throw
        // is masked back to previous_current_id and the same ID remains resumable.
        if (durableCurrent.known) removeStorageItem(storage, pending)
        state = inspectStoreWithRetry(storage).state
        return false
      }

      const committedWriteReturned = setStorageItem(storage, committed, JSON.stringify(clone(snapshot)))
      const durableSnapshot = getStorageItem(storage, committed, 2)
      let committedProven = durableSnapshot.known
        ? storedSnapshotMatches(durableSnapshot.value, snapshot)
        : committedWriteReturned
      let commitInspection = null
      if (!committedProven && !durableSnapshot.known) {
        commitInspection = inspectStoreWithRetry(storage)
        const inspectedSnapshot = commitInspection.state.snapshots.find((item) => item.snapshot_id === snapshot.snapshot_id)
        committedProven = commitInspection.status === "valid"
          && commitInspection.state.current_snapshot_id === snapshot.snapshot_id
          && JSON.stringify(inspectedSnapshot) === JSON.stringify(snapshot)
      }
      if (!committedProven) {
        // The pending/current pair deliberately remains: validated readers resolve
        // it to previous_current_id, and the same snapshot ID can resume later.
        state = (commitInspection ?? inspectStoreWithRetry(storage)).state
        return false
      }

      removeStorageItem(storage, pending)
      const reconciled = inspectStoreWithRetry(storage)
      const committedSnapshot = reconciled.state.snapshots.find((item) => item.snapshot_id === snapshot.snapshot_id)
      if (reconciled.status === "valid" && JSON.stringify(committedSnapshot) === JSON.stringify(snapshot)) {
        state = reconciled.state
      } else {
        state = {
          version: 1,
          current_snapshot_id: snapshot.snapshot_id,
          snapshots: [...inspected.state.snapshots.map(clone), clone(snapshot)],
        }
      }
      setStorageItem(storage, TASK_INPUT_STORAGE_KEY, JSON.stringify(state))
      refreshCommittedBaseline()
      return true
    },

    readCurrent() {
      state = inspectStore(storage).state
      const current = state.snapshots.find((snapshot) => snapshot.snapshot_id === state.current_snapshot_id)
      return current ? clone(current) : null
    },

    readAll() {
      state = inspectStore(storage).state
      return state.snapshots.map(clone)
    },

    selectCurrent(snapshotId) {
      const inspected = inspectStore(storage)
      if (inspected.status !== "valid" || !inspected.state.snapshots.some((snapshot) => snapshot.snapshot_id === snapshotId)) return false
      const previousState = state
      const previousPointer = getStorageItem(storage, CURRENT_KEY)
      if (!previousPointer.known) return false
      const nextState = { ...inspected.state, current_snapshot_id: snapshotId, snapshots: inspected.state.snapshots.map(clone) }
      const currentWriteReturned = setStorageItem(storage, CURRENT_KEY, snapshotId)
      let durableCurrent = getStorageItem(storage, CURRENT_KEY, 2)
      let selected = durableCurrent.known
        ? durableCurrent.value === snapshotId
        : currentWriteReturned

      if (!selected && !durableCurrent.known) {
        const rollbackReturned = previousPointer.value === null
          ? removeStorageItem(storage, CURRENT_KEY)
          : setStorageItem(storage, CURRENT_KEY, previousPointer.value)
        durableCurrent = getStorageItem(storage, CURRENT_KEY, 2)
        if (durableCurrent.known && durableCurrent.value === snapshotId) {
          selected = true
        } else if (!durableCurrent.known && !rollbackReturned) {
          // Resolve an otherwise unknowable pair of thrown writes by explicitly
          // completing the requested selection; a normal return is durable proof.
          selected = setStorageItem(storage, CURRENT_KEY, snapshotId)
          if (!selected) {
            durableCurrent = getStorageItem(storage, CURRENT_KEY, 2)
            selected = durableCurrent.known && durableCurrent.value === snapshotId
          }
        }
      }

      if (!selected) {
        state = previousState
        return false
      }

      // The root document is only a rebuildable cache after independent
      // snapshot and current authority have both been proven.
      const serializedRoot = JSON.stringify(nextState)
      if (!ensureStorageValue(storage, TASK_INPUT_STORAGE_KEY, serializedRoot)) {
        // A one-shot root-cache fault must not leave a durable pointer/cache tear.
        ensureStorageValue(storage, TASK_INPUT_STORAGE_KEY, serializedRoot)
      }
      const reconciled = inspectStoreWithRetry(storage)
      state = reconciled.status === "valid" && reconciled.state.current_snapshot_id === snapshotId
        ? reconciled.state
        : nextState
      refreshCommittedBaseline()
      return true
    },
  }
}
