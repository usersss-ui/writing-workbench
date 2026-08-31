export const USER_TAG_STORAGE_KEY = "research-console.paper-user-tags.v1"

const EXPORT_SCHEMA = "research-console.paper-user-tags"
const EXPLICIT_PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const FALLBACK_PAPER_ID = /^LIB-[A-F0-9]{12}$/u
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u
const PATH_SEPARATOR = /[\\/]/u
const STATE_KEYS = Object.freeze(["version", "papers"])
const EXPORT_KEYS = Object.freeze(["schema", "version", "papers"])
const MAX_LABEL_CODE_POINTS = 24
const MAX_TAGS_PER_PAPER = 20
const MAX_LIBRARY_ASSIGNMENTS = 500

function emptyState() {
  return { version: 1, papers: {} }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function hasExactKeys(value, expected) {
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
  const keys = [...expected].sort()
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index])
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

function validPaperId(value) {
  return typeof value === "string" && (EXPLICIT_PAPER_ID.test(value) || FALLBACK_PAPER_ID.test(value))
}

function validatePaperId(value) {
  if (!validPaperId(value)) throw new TypeError("论文 ID 格式无效")
}

function normalizeLabel(value) {
  if (typeof value !== "string") throw new TypeError("标签必须是文本")
  const label = value.normalize("NFKC").trim()
  if (!label) throw new TypeError("标签不能为空")
  if (CONTROL_CHARACTER.test(label)) throw new TypeError("标签不能包含控制字符或换行")
  if (PATH_SEPARATOR.test(label)) throw new TypeError("标签不能包含路径分隔符")
  if (Array.from(label).length > MAX_LABEL_CODE_POINTS) throw new TypeError("标签最多 24 个 Unicode 码点")
  return label
}

function comparisonKey(label) {
  return label.toLocaleLowerCase("en-US")
}

function assignmentCount(state) {
  return Object.values(state.papers).reduce((sum, labels) => sum + labels.length, 0)
}

function cloneState(state) {
  return {
    version: 1,
    papers: Object.fromEntries(Object.entries(state.papers).map(([paperId, labels]) => [paperId, [...labels]])),
  }
}

export function isValidUserTagState(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, STATE_KEYS) || value.version !== 1 || !isPlainDataRecord(value.papers)) return false
  let total = 0
  for (const [paperId, labels] of Object.entries(value.papers)) {
    if (!validPaperId(paperId) || !Array.isArray(labels) || labels.length === 0 || labels.length > MAX_TAGS_PER_PAPER) return false
    const seen = new Set()
    for (const label of labels) {
      let normalized
      try { normalized = normalizeLabel(label) } catch { return false }
      if (normalized !== label || seen.has(comparisonKey(label))) return false
      seen.add(comparisonKey(label))
    }
    total += labels.length
  }
  return total <= MAX_LIBRARY_ASSIGNMENTS
}

function getUserTagRaw(storage, attempts = 1) {
  if (!storage || typeof storage.getItem !== "function") return { known: false, raw: null }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return { known: true, raw: storage.getItem(USER_TAG_STORAGE_KEY) }
    } catch {
      // Retry once when a storage implementation reports a transient read fault.
    }
  }
  return { known: false, raw: null }
}

function inspectUserTagState(storage) {
  const stored = getUserTagRaw(storage)
  if (!stored.known) return { status: "unavailable", state: emptyState(), raw: null }
  if (stored.raw === null) return { status: "missing", state: emptyState(), raw: null }
  if (typeof stored.raw !== "string") return { status: "invalid", state: emptyState(), raw: stored.raw }
  try {
    const parsed = JSON.parse(stored.raw)
    return isValidUserTagState(parsed)
      ? { status: "valid", state: cloneState(parsed), raw: stored.raw }
      : { status: "invalid", state: emptyState(), raw: stored.raw }
  } catch {
    return { status: "invalid", state: emptyState(), raw: stored.raw }
  }
}

function writeUserTagRaw(storage, raw) {
  try {
    if (raw === null) {
      if (!storage || typeof storage.removeItem !== "function") return false
      storage.removeItem(USER_TAG_STORAGE_KEY)
    } else {
      if (!storage || typeof storage.setItem !== "function") return false
      storage.setItem(USER_TAG_STORAGE_KEY, raw)
    }
    return true
  } catch {
    return false
  }
}

function userTagRawMatches(storage, raw) {
  const stored = getUserTagRaw(storage, 2)
  return stored.known && stored.raw === raw
}

function normalizeImportDocument(text) {
  let value
  try { value = JSON.parse(text) } catch { throw new TypeError("个人标签导入文件不是有效 JSON") }
  if (!isPlainObject(value) || !hasExactKeys(value, EXPORT_KEYS)
      || value.schema !== EXPORT_SCHEMA || value.version !== 1 || !isPlainObject(value.papers)) {
    throw new TypeError("个人标签导入文件结构无效")
  }
  const papers = {}
  for (const [paperId, labels] of Object.entries(value.papers)) {
    if (!validPaperId(paperId) || !Array.isArray(labels)) throw new TypeError("个人标签导入文件论文记录无效")
    papers[paperId] = labels.map((label) => {
      try { return normalizeLabel(label) } catch { throw new TypeError("个人标签导入文件包含无效标签") }
    })
  }
  return papers
}

export function createUserTagStore(storage) {
  const initial = inspectUserTagState(storage)
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
    if (!isValidUserTagState(nextState)) throw new TypeError("个人标签状态无效")
    state = cloneState(nextState)
    try {
      if (typeof storage?.setItem === "function") {
        const raw = JSON.stringify(state)
        storage.setItem(USER_TAG_STORAGE_KEY, raw)
        rememberBaseline({ status: "valid", raw })
      }
    } catch {}
  }

  function findExisting(labels, label) {
    const key = comparisonKey(label)
    return labels.find((candidate) => comparisonKey(candidate) === key) ?? null
  }

  return {
    read: () => cloneState(state),

    readValidatedState() {
      const inspected = inspectUserTagState(storage)
      rememberBaseline(inspected)
      return { status: inspected.status, state: cloneState(inspected.state) }
    },

    replaceValidated(nextState) {
      if (!isValidUserTagState(nextState)) throw new TypeError("个人标签状态无效")
      const replacement = cloneState(nextState)
      const memoryBefore = cloneState(state)
      const before = inspectUserTagState(storage)
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
      writeUserTagRaw(storage, nextRaw)
      if (userTagRawMatches(storage, nextRaw)) {
        state = cloneState(replacement)
        rememberBaseline({ status: "valid", raw: nextRaw })
        return { replaced: true, state: cloneState(state) }
      }

      let restored = userTagRawMatches(storage, before.raw)
      if (!restored) {
        writeUserTagRaw(storage, before.raw)
        restored = userTagRawMatches(storage, before.raw)
      }
      state = cloneState(memoryBefore)
      return {
        replaced: false,
        status: restored ? "persistence_failed" : "rollback_failed",
        state: cloneState(state),
      }
    },

    tagsFor(paperId) {
      validatePaperId(paperId)
      return [...(state.papers[paperId] ?? [])]
    },

    add(paperId, rawLabel) {
      validatePaperId(paperId)
      const label = normalizeLabel(rawLabel)
      const labels = state.papers[paperId] ?? []
      const existing = findExisting(labels, label)
      if (existing) return { added: false, label: existing, state: cloneState(state) }
      if (labels.length >= MAX_TAGS_PER_PAPER) throw new RangeError("每篇论文最多 20 个标签")
      if (assignmentCount(state) >= MAX_LIBRARY_ASSIGNMENTS) throw new RangeError("整个论文库最多 500 个标签")
      const next = cloneState(state)
      next.papers[paperId] = [...labels, label]
      persist(next)
      return { added: true, label, state: cloneState(state) }
    },

    remove(paperId, rawLabel) {
      validatePaperId(paperId)
      const label = normalizeLabel(rawLabel)
      const key = comparisonKey(label)
      const labels = state.papers[paperId] ?? []
      const nextLabels = labels.filter((candidate) => comparisonKey(candidate) !== key)
      if (nextLabels.length === labels.length) return { removed: false, state: cloneState(state) }
      const next = cloneState(state)
      if (nextLabels.length === 0) delete next.papers[paperId]
      else next.papers[paperId] = nextLabels
      persist(next)
      return { removed: true, state: cloneState(state) }
    },

    exportJson() {
      return `${JSON.stringify({ schema: EXPORT_SCHEMA, version: 1, papers: cloneState(state).papers }, null, 2)}\n`
    },

    importJson(text, { mode, knownPaperIds } = {}) {
      if (mode !== "merge") throw new TypeError("个人标签导入只支持 merge 模式")
      const incoming = normalizeImportDocument(text)
      const known = new Set(knownPaperIds ?? [])
      const next = cloneState(state)
      let addedCount = 0
      let duplicateCount = 0
      const unmatchedPaperIds = []
      for (const [paperId, labels] of Object.entries(incoming)) {
        if (!known.has(paperId)) {
          unmatchedPaperIds.push(paperId)
          continue
        }
        const merged = [...(next.papers[paperId] ?? [])]
        for (const label of labels) {
          if (findExisting(merged, label)) duplicateCount += 1
          else {
            if (merged.length >= MAX_TAGS_PER_PAPER) throw new RangeError("个人标签导入后每篇论文将超过 20 个标签")
            merged.push(label)
            addedCount += 1
          }
        }
        if (merged.length > 0) next.papers[paperId] = merged
      }
      if (assignmentCount(next) > MAX_LIBRARY_ASSIGNMENTS) throw new RangeError("个人标签导入后整个论文库将超过 500 个标签")
      if (addedCount > 0) persist(next)
      return {
        state: cloneState(state), addedCount, duplicateCount,
        unmatchedPaperCount: unmatchedPaperIds.length, unmatchedPaperIds,
      }
    },

    clear() {
      state = emptyState()
      try {
        if (typeof storage?.removeItem === "function") {
          storage.removeItem(USER_TAG_STORAGE_KEY)
          rememberBaseline({ status: "missing", raw: null })
        }
      } catch {}
      return cloneState(state)
    },
  }
}
