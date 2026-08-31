import { PERSONAL_READING_MARKER, P02_ROLES } from "./paper-library-model.mjs"

export const WORKSPACE_STORAGE_KEY = "research-console.paper-library.v1"

const EXPLICIT_PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const FALLBACK_PAPER_ID = /^LIB-[A-F0-9]{12}$/u
const ROOT_KEYS = Object.freeze(["version", "shelf", "personalReading", "selectedPaperId"])

function emptyState() {
  return { version: 1, shelf: {}, personalReading: {}, selectedPaperId: null }
}

function cloneState(state) {
  return {
    version: 1,
    shelf: Object.fromEntries(Object.entries(state.shelf).map(([paperId, roles]) => [paperId, [...roles]])),
    personalReading: { ...state.personalReading },
    selectedPaperId: state.selectedPaperId,
  }
}

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

function isPlainDataRecord(value) {
  if (!isPlainObject(value)) return false
  try {
    const keys = Reflect.ownKeys(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    return keys.every((key) => typeof key === "string"
      && descriptors[key]?.enumerable === true
      && "value" in descriptors[key])
  } catch {
    return false
  }
}

function validPaperId(paperId) {
  return typeof paperId === "string" && (EXPLICIT_PAPER_ID.test(paperId) || FALLBACK_PAPER_ID.test(paperId))
}

function validatePaperId(paperId) {
  if (!validPaperId(paperId)) throw new TypeError("论文 ID 格式无效")
}

function rolesAreCanonical(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return false
  let previousIndex = -1
  for (const role of roles) {
    const currentIndex = P02_ROLES.indexOf(role)
    if (currentIndex < 0 || currentIndex <= previousIndex) return false
    previousIndex = currentIndex
  }
  return true
}

export function isValidWorkspaceState(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, ROOT_KEYS) || value.version !== 1) return false
  if (!isPlainDataRecord(value.shelf) || !isPlainDataRecord(value.personalReading)) return false

  for (const [paperId, roles] of Object.entries(value.shelf)) {
    if (!validPaperId(paperId) || !rolesAreCanonical(roles)) return false
  }
  for (const [paperId, marker] of Object.entries(value.personalReading)) {
    if (!validPaperId(paperId) || !PERSONAL_READING_MARKER.includes(marker)) return false
  }
  return value.selectedPaperId === null || validPaperId(value.selectedPaperId)
}

function getWorkspaceRaw(storage, attempts = 1) {
  if (!storage || typeof storage.getItem !== "function") return { known: false, raw: null }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return { known: true, raw: storage.getItem(WORKSPACE_STORAGE_KEY) }
    } catch {
      // Retry once when a storage implementation reports a transient read fault.
    }
  }
  return { known: false, raw: null }
}

function inspectWorkspaceState(storage) {
  const stored = getWorkspaceRaw(storage)
  if (!stored.known) return { status: "unavailable", state: emptyState(), raw: null }
  if (stored.raw === null) return { status: "missing", state: emptyState(), raw: null }
  if (typeof stored.raw !== "string") return { status: "invalid", state: emptyState(), raw: stored.raw }
  try {
    const parsed = JSON.parse(stored.raw)
    return isValidWorkspaceState(parsed)
      ? { status: "valid", state: cloneState(parsed), raw: stored.raw }
      : { status: "invalid", state: emptyState(), raw: stored.raw }
  } catch {
    return { status: "invalid", state: emptyState(), raw: stored.raw }
  }
}

function writeWorkspaceRaw(storage, raw) {
  try {
    if (raw === null) {
      if (!storage || typeof storage.removeItem !== "function") return false
      storage.removeItem(WORKSPACE_STORAGE_KEY)
    } else {
      if (!storage || typeof storage.setItem !== "function") return false
      storage.setItem(WORKSPACE_STORAGE_KEY, raw)
    }
    return true
  } catch {
    return false
  }
}

function workspaceRawMatches(storage, raw) {
  const stored = getWorkspaceRaw(storage, 2)
  return stored.known && stored.raw === raw
}

export function createWorkspaceStore(storage) {
  const initial = inspectWorkspaceState(storage)
  let state = cloneState(initial.state)
  let committedBaseline = {
    known: initial.status !== "unavailable",
    raw: initial.raw,
  }

  function rememberBaseline(inspected) {
    committedBaseline = {
      known: inspected.status !== "unavailable",
      raw: inspected.raw,
    }
  }

  function persist(nextState) {
    if (!isValidWorkspaceState(nextState)) throw new TypeError("工作台状态无效")
    state = cloneState(nextState)
    try {
      if (storage && typeof storage.setItem === "function") {
        const raw = JSON.stringify(cloneState(state))
        storage.setItem(WORKSPACE_STORAGE_KEY, raw)
        rememberBaseline({ status: "valid", raw })
      }
    } catch {
      // Storage can be disabled or full. The in-memory state remains authoritative.
    }
  }

  return {
    read() {
      return cloneState(state)
    },

    readValidatedState() {
      const inspected = inspectWorkspaceState(storage)
      rememberBaseline(inspected)
      return { status: inspected.status, state: cloneState(inspected.state) }
    },

    replaceValidated(nextState) {
      if (!isValidWorkspaceState(nextState)) throw new TypeError("工作台状态无效")
      const replacement = cloneState(nextState)
      const memoryBefore = cloneState(state)
      const before = inspectWorkspaceState(storage)
      if (before.status === "invalid" || before.status === "unavailable") {
        return { replaced: false, status: before.status, state: cloneState(memoryBefore) }
      }
      if (!committedBaseline.known || before.raw !== committedBaseline.raw) {
        return { replaced: false, status: "stale", state: cloneState(memoryBefore) }
      }
      if (!storage || typeof storage.setItem !== "function") {
        return { replaced: false, status: "unavailable", state: cloneState(memoryBefore) }
      }

      const nextRaw = JSON.stringify(replacement)
      if (before.raw === nextRaw) {
        state = cloneState(replacement)
        rememberBaseline({ status: "valid", raw: nextRaw })
        return { replaced: true, state: cloneState(state) }
      }
      writeWorkspaceRaw(storage, nextRaw)
      if (workspaceRawMatches(storage, nextRaw)) {
        state = cloneState(replacement)
        rememberBaseline({ status: "valid", raw: nextRaw })
        return { replaced: true, state: cloneState(state) }
      }

      let restored = workspaceRawMatches(storage, before.raw)
      if (!restored) {
        writeWorkspaceRaw(storage, before.raw)
        restored = workspaceRawMatches(storage, before.raw)
      }
      state = cloneState(memoryBefore)
      return {
        replaced: false,
        status: restored ? "persistence_failed" : "rollback_failed",
        state: cloneState(state),
      }
    },

    toggleShelfRole(paperId, role) {
      validatePaperId(paperId)
      if (!P02_ROLES.includes(role)) throw new TypeError("P02 用途无效")
      const next = cloneState(state)
      const roles = new Set(next.shelf[paperId] ?? [])
      if (roles.has(role)) roles.delete(role)
      else roles.add(role)
      const ordered = P02_ROLES.filter((candidate) => roles.has(candidate))
      if (ordered.length === 0) delete next.shelf[paperId]
      else next.shelf[paperId] = ordered
      persist(next)
      return cloneState(state)
    },

    setPersonalReadingMarker(paperId, marker) {
      validatePaperId(paperId)
      if (!PERSONAL_READING_MARKER.includes(marker)) throw new TypeError("个人阅读标记无效")
      const next = cloneState(state)
      next.personalReading[paperId] = marker
      persist(next)
      return cloneState(state)
    },

    setSelectedPaper(paperId) {
      if (paperId !== null) validatePaperId(paperId)
      const next = cloneState(state)
      next.selectedPaperId = paperId
      persist(next)
      return cloneState(state)
    },

    clear() {
      state = emptyState()
      try {
        if (storage && typeof storage.removeItem === "function") {
          storage.removeItem(WORKSPACE_STORAGE_KEY)
          rememberBaseline({ status: "missing", raw: null })
        }
      } catch {
        // Keep the deterministic empty in-memory state when storage removal is denied.
      }
      return cloneState(state)
    },
  }
}
