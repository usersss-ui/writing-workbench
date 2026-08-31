export const USER_TAG_STORAGE_KEY = "research-console.paper-user-tags.v1"

const EXPORT_SCHEMA = "research-console.paper-user-tags"
const EXPLICIT_PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const FALLBACK_PAPER_ID = /^LIB-[A-F0-9]{12}$/u
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u
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
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
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

function validateCanonicalState(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, STATE_KEYS) || value.version !== 1 || !isPlainObject(value.papers)) return false
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

function loadInitialState(storage) {
  try {
    const raw = storage?.getItem?.(USER_TAG_STORAGE_KEY)
    if (raw === null || raw === undefined) return emptyState()
    const parsed = JSON.parse(raw)
    return validateCanonicalState(parsed) ? cloneState(parsed) : emptyState()
  } catch {
    return emptyState()
  }
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
  let state = loadInitialState(storage)

  function persist(nextState) {
    if (!validateCanonicalState(nextState)) throw new TypeError("个人标签状态无效")
    state = cloneState(nextState)
    try { storage?.setItem?.(USER_TAG_STORAGE_KEY, JSON.stringify(state)) } catch {}
  }

  function findExisting(labels, label) {
    const key = comparisonKey(label)
    return labels.find((candidate) => comparisonKey(candidate) === key) ?? null
  }

  return {
    read: () => cloneState(state),

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
      try { storage?.removeItem?.(USER_TAG_STORAGE_KEY) } catch {}
      return cloneState(state)
    },
  }
}
