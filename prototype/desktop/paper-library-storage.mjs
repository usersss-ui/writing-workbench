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
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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

function validateState(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, ROOT_KEYS) || value.version !== 1) return false
  if (!isPlainObject(value.shelf) || !isPlainObject(value.personalReading)) return false

  for (const [paperId, roles] of Object.entries(value.shelf)) {
    if (!validPaperId(paperId) || !rolesAreCanonical(roles)) return false
  }
  for (const [paperId, marker] of Object.entries(value.personalReading)) {
    if (!validPaperId(paperId) || !PERSONAL_READING_MARKER.includes(marker)) return false
  }
  return value.selectedPaperId === null || validPaperId(value.selectedPaperId)
}

function loadInitialState(storage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return emptyState()
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw === null) return emptyState()
    const parsed = JSON.parse(raw)
    return validateState(parsed) ? cloneState(parsed) : emptyState()
  } catch {
    return emptyState()
  }
}

export function createWorkspaceStore(storage) {
  let state = loadInitialState(storage)

  function persist(nextState) {
    if (!validateState(nextState)) throw new TypeError("工作台状态无效")
    state = cloneState(nextState)
    try {
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(cloneState(state)))
      }
    } catch {
      // Storage can be disabled or full. The in-memory state remains authoritative.
    }
  }

  return {
    read() {
      return cloneState(state)
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
        if (storage && typeof storage.removeItem === "function") storage.removeItem(WORKSPACE_STORAGE_KEY)
      } catch {
        // Keep the deterministic empty in-memory state when storage removal is denied.
      }
      return cloneState(state)
    },
  }
}
