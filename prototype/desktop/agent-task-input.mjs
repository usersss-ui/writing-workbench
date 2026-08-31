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
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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
    || /(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]/iu.test(text)
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

function validStoreState(value) {
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

function mergeSnapshots(rootSnapshots, entrySnapshots) {
  const snapshots = rootSnapshots.map(clone)
  const byId = new Map(snapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]))
  for (const snapshot of entrySnapshots) {
    const existing = byId.get(snapshot.snapshot_id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) return null
    if (!existing) {
      snapshots.push(clone(snapshot))
      byId.set(snapshot.snapshot_id, snapshot)
    }
  }
  return snapshots
}

function resolvePendingPointer(pointer, snapshots, storage, keys, seen = new Set()) {
  if (seen.has(pointer)) return { valid: false, current: null }
  seen.add(pointer)
  const key = pendingKey(pointer)
  if (!keys.includes(key)) return { valid: false, current: null }
  const pending = JSON.parse(storage.getItem(key))
  if (!validPending(pending) || pending.snapshot.snapshot_id !== pointer) return { valid: false, current: null }
  if (pending.previous_current_id === null) return { valid: true, current: null }
  if (snapshots.some((snapshot) => snapshot.snapshot_id === pending.previous_current_id)) {
    return { valid: true, current: pending.previous_current_id }
  }
  return resolvePendingPointer(pending.previous_current_id, snapshots, storage, keys, seen)
}

function inspectStore(storage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return { status: "unavailable", state: emptyState() }
    const rawRoot = storage.getItem(TASK_INPUT_STORAGE_KEY)
    const root = rawRoot === null ? emptyState() : JSON.parse(rawRoot)
    if (!validStoreState(root)) return { status: "invalid", state: emptyState() }
    const keys = storageKeys(storage)
    if (keys === null) return { status: "invalid", state: emptyState() }
    const entries = []
    for (const key of keys.filter((candidate) => candidate.startsWith(SNAPSHOT_PREFIX))) {
      const snapshot = JSON.parse(storage.getItem(key))
      if (!isValidTaskInputSnapshot(snapshot) || key !== snapshotKey(snapshot.snapshot_id)) {
        return { status: "invalid", state: emptyState() }
      }
      entries.push(snapshot)
    }
    const snapshots = mergeSnapshots(root.snapshots, entries)
    if (snapshots === null) return { status: "invalid", state: emptyState() }
    const independentCurrent = storage.getItem(CURRENT_KEY)
    let current = independentCurrent ?? root.current_snapshot_id ?? snapshots.at(-1)?.snapshot_id ?? null
    if (current !== null && !snapshots.some((snapshot) => snapshot.snapshot_id === current)) {
      const resolved = resolvePendingPointer(current, snapshots, storage, keys)
      if (!resolved.valid) return { status: "invalid", state: emptyState() }
      current = resolved.current
    }
    return {
      status: rawRoot === null && snapshots.length === 0 ? "missing" : "valid",
      state: { version: 1, current_snapshot_id: current, snapshots },
    }
  } catch {
    return { status: "invalid", state: emptyState() }
  }
}

export function createTaskInputSnapshotStore(storage) {
  let state = inspectStore(storage).state

  return {
    append(snapshot) {
      const inspected = inspectStore(storage)
      if (!["missing", "valid"].includes(inspected.status) || !isValidTaskInputSnapshot(snapshot)) return false
      if (inspected.state.snapshots.some((item) => item.snapshot_id === snapshot.snapshot_id)) return false
      try {
        if (!storage || typeof storage.setItem !== "function") return false
        const pending = pendingKey(snapshot.snapshot_id)
        const committed = snapshotKey(snapshot.snapshot_id)
        if (storage.getItem(pending) !== null || storage.getItem(committed) !== null) return false
        const storedCurrent = storage.getItem(CURRENT_KEY)
        const previousCurrentId = storedCurrent ?? inspected.state.current_snapshot_id
        storage.setItem(pending, JSON.stringify({ version: 1, snapshot: clone(snapshot), previous_current_id: previousCurrentId }))
        try {
          storage.setItem(CURRENT_KEY, snapshot.snapshot_id)
        } catch {
          try {
            if (typeof storage.removeItem === "function") storage.removeItem(pending)
          } catch {
            // A non-current pending record is ignored by validated readers.
          }
          state = inspectStore(storage).state
          return false
        }
        try {
          storage.setItem(committed, JSON.stringify(clone(snapshot)))
        } catch {
          // Keep the pending/current pair so readers can fall back to the previous
          // committed current without racing another browser tab's newer pointer.
          state = inspectStore(storage).state
          return false
        }
        try {
          if (typeof storage.removeItem === "function") storage.removeItem(pending)
        } catch {
          // A leftover pending copy is harmless once the committed entry exists.
        }
      } catch {
        state = inspectStore(storage).state
        return false
      }
      const reconciled = inspectStore(storage)
      const committedSnapshot = reconciled.state.snapshots.find((item) => item.snapshot_id === snapshot.snapshot_id)
      if (reconciled.status !== "valid" || JSON.stringify(committedSnapshot) !== JSON.stringify(snapshot)) return false
      state = reconciled.state
      try {
        storage.setItem(TASK_INPUT_STORAGE_KEY, JSON.stringify(reconciled.state))
      } catch {
        // Independent snapshot and current records are already authoritative.
      }
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
      const previousPointer = storage.getItem(CURRENT_KEY)
      const nextState = { ...inspected.state, current_snapshot_id: snapshotId, snapshots: inspected.state.snapshots.map(clone) }
      try {
        storage.setItem(CURRENT_KEY, snapshotId)
        storage.setItem(TASK_INPUT_STORAGE_KEY, JSON.stringify(nextState))
      } catch {
        try {
          if (previousPointer === null && typeof storage.removeItem === "function") storage.removeItem(CURRENT_KEY)
          else if (previousPointer !== null) storage.setItem(CURRENT_KEY, previousPointer)
        } catch {
          // Leave the durable store to a future full validation; in-memory selection stays unchanged.
        }
        state = previousState
        return false
      }
      const reconciled = inspectStore(storage)
      if (reconciled.status !== "valid" || reconciled.state.current_snapshot_id !== snapshotId) {
        state = previousState
        return false
      }
      state = reconciled.state
      return true
    },
  }
}
