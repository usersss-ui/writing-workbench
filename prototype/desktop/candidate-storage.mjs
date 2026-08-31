export const DISCOVERY_CANDIDATE_STORAGE_KEY = "research-console.discovery-candidates.v1"

const MAX_CANDIDATES = 100
const MAX_RAW_LENGTH = 5_500_000
const STAGES = Object.freeze(["pending_screening", "confirmed_for_archive", "metadata_archived"])
const WORK_KEYS = Object.freeze([
  "paperId",
  "doi",
  "title",
  "authors",
  "year",
  "source",
  "citations",
  "isOpenAccess",
  "openAccessUrl",
  "landingPageUrl",
  "topics",
  "abstract",
])
const CANDIDATE_KEYS = Object.freeze([...WORK_KEYS, "stage"])
const ROOT_KEYS = Object.freeze(["version", "candidates"])
const OPENALEX_ID = /^W\d+$/u
const DOI = /^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u
const CREDENTIAL_QUERY_KEYS = new Set([
  ["access", "token"].join(""), ["api", "key"].join(""), ["auth", "token"].join(""),
  ["authori", "zation"].join(""), ["bearer", "token"].join(""),
  ["client", "secret"].join(""), ["coo", "kie"].join(""), ["creden", "tials"].join(""),
  ["id", "token"].join(""), ["pass", "phrase"].join(""), ["pass", "word"].join(""),
  ["oauth", "token"].join(""),
  ["private", "key"].join(""), ["refresh", "token"].join(""), ["sec", "ret"].join(""),
  ["secret", "key"].join(""), "session", ["session", "id"].join(""),
  ["to", "ken"].join(""), ["xapi", "key"].join(""),
])

function emptyState() {
  return { version: 1, candidates: [] }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function hasExactKeys(value, expectedKeys) {
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
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && actual.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key])
}

function isCanonicalText(value, maximum, nullable = false) {
  if (value === null && nullable) return true
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > maximum) return false
  return value === value.trim().replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, " ").replace(/\s+/gu, " ")
}

function isCanonicalTextList(value, { maximumItems, maximumText }) {
  if (!Array.isArray(value) || value.length > maximumItems) return false
  const seen = new Set()
  for (const item of value) {
    if (!isCanonicalText(item, maximumText) || seen.has(item)) return false
    seen.add(item)
  }
  return true
}

function normalizedQueryKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "")
}

function decodedQueryKey(value) {
  if (
    typeof value !== "string" || value.length > 512 ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  ) return null
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (!/%[0-9a-f]{2}/iu.test(decoded)) return decoded
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded || next.length > 512 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(next)) return null
      decoded = next
    } catch {
      return null
    }
  }
  return /%[0-9a-f]{2}/iu.test(decoded) ? null : decoded
}

function isCredentialQueryKey(value) {
  const decoded = decodedQueryKey(value)
  if (decoded === null) return true
  const key = normalizedQueryKey(decoded)
  return CREDENTIAL_QUERY_KEYS.has(key) || [
    ["to", "ken"].join(""), ["sec", "ret"].join(""), ["pass", "word"].join(""),
    ["pass", "phrase"].join(""), ["api", "key"].join(""), ["private", "key"].join(""),
    ["signa", "ture"].join(""), ["j", "wt"].join(""),
    ["creden", "tial"].join(""), ["coo", "kie"].join(""),
  ].some((marker) => key.includes(marker))
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((part) => part > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19))
}

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "")
  if (
    !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".home.arpa") || host.includes(":") || !host.includes(".")
  ) return false
  return !isPrivateIpv4(host)
}

function isSafeCanonicalHttpsUrl(value, nullable = false) {
  if (value === null && nullable) return true
  if (!isCanonicalText(value, 2_048) || value.includes("\\")) return false
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash || !isPublicHostname(url.hostname) || url.href !== value
    ) return false
    for (const key of url.searchParams.keys()) {
      if (isCredentialQueryKey(key)) return false
    }
    return true
  } catch {
    return false
  }
}

function isCanonicalDoi(value) {
  if (value === null) return true
  if (!isCanonicalText(value, 255) || value !== value.toLowerCase() || !DOI.test(value)) return false
  const suffix = value.slice(value.indexOf("/") + 1)
  if (!suffix || value.includes("//")) return false
  return !suffix.split("/").some((segment) => segment === "." || segment === "..")
}

function validOpenAlexId(value) {
  return typeof value === "string" && value.length <= 100 && OPENALEX_ID.test(value)
}

function validateOpenAlexId(value) {
  if (!validOpenAlexId(value)) throw new TypeError("OpenAlex ID 无效")
}

function validCandidate(candidate) {
  return hasExactKeys(candidate, CANDIDATE_KEYS)
    && validOpenAlexId(candidate.paperId)
    && isCanonicalDoi(candidate.doi)
    && isCanonicalText(candidate.title, 1_000)
    && isCanonicalTextList(candidate.authors, { maximumItems: 50, maximumText: 300 })
    && (candidate.year === null || (Number.isInteger(candidate.year) && candidate.year >= 1_000 && candidate.year <= 9_999))
    && isCanonicalText(candidate.source, 500)
    && Number.isSafeInteger(candidate.citations)
    && candidate.citations >= 0
    && typeof candidate.isOpenAccess === "boolean"
    && isSafeCanonicalHttpsUrl(candidate.openAccessUrl, true)
    && isSafeCanonicalHttpsUrl(candidate.landingPageUrl)
    && isCanonicalTextList(candidate.topics, { maximumItems: 20, maximumText: 300 })
    && isCanonicalText(candidate.abstract, 20_000, true)
    && STAGES.includes(candidate.stage)
}

export function isValidCandidateState(value) {
  if (!hasExactKeys(value, ROOT_KEYS) || value.version !== 1 || !Array.isArray(value.candidates)) return false
  if (value.candidates.length > MAX_CANDIDATES || !value.candidates.every(validCandidate)) return false
  const ids = new Set()
  const dois = new Set()
  for (const candidate of value.candidates) {
    const qualifiedId = `openalex:${candidate.paperId}`
    if (ids.has(qualifiedId)) return false
    ids.add(qualifiedId)
    if (candidate.doi !== null) {
      if (dois.has(candidate.doi)) return false
      dois.add(candidate.doi)
    }
  }
  try {
    return JSON.stringify(value).length <= MAX_RAW_LENGTH
  } catch {
    return false
  }
}

function cloneCandidate(candidate) {
  return {
    paperId: candidate.paperId,
    doi: candidate.doi,
    title: candidate.title,
    authors: [...candidate.authors],
    year: candidate.year,
    source: candidate.source,
    citations: candidate.citations,
    isOpenAccess: candidate.isOpenAccess,
    openAccessUrl: candidate.openAccessUrl,
    landingPageUrl: candidate.landingPageUrl,
    topics: [...candidate.topics],
    abstract: candidate.abstract,
    stage: candidate.stage,
  }
}

function cloneState(state) {
  return { version: 1, candidates: state.candidates.map(cloneCandidate) }
}

function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getCandidateRaw(storage, attempts = 1) {
  if (!storage || typeof storage.getItem !== "function") return { known: false, raw: null }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return { known: true, raw: storage.getItem(DISCOVERY_CANDIDATE_STORAGE_KEY) }
    } catch {
      // Retry once when a storage implementation reports a transient read fault.
    }
  }
  return { known: false, raw: null }
}

function inspectCandidateState(storage) {
  const stored = getCandidateRaw(storage)
  if (!stored.known) return { status: "unavailable", state: emptyState(), raw: null }
  if (stored.raw === null) return { status: "missing", state: emptyState(), raw: null }
  if (typeof stored.raw !== "string" || stored.raw.length > MAX_RAW_LENGTH) {
    return { status: "invalid", state: emptyState(), raw: stored.raw }
  }
  try {
    const parsed = JSON.parse(stored.raw)
    return isValidCandidateState(parsed)
      ? { status: "valid", state: cloneState(parsed), raw: stored.raw }
      : { status: "invalid", state: emptyState(), raw: stored.raw }
  } catch {
    return { status: "invalid", state: emptyState(), raw: stored.raw }
  }
}

function loadInitialState(storage) {
  const inspected = inspectCandidateState(storage)
  const baseline = { known: inspected.status !== "unavailable", raw: inspected.raw }
  if (inspected.status === "unavailable") return { state: emptyState(), status: "unavailable", baseline }
  if (inspected.status === "invalid") return { state: emptyState(), status: "recovered_invalid", baseline }
  return { state: cloneState(inspected.state), status: "ready", baseline }
}

function writeCandidateRaw(storage, raw) {
  try {
    if (raw === null) {
      if (!storage || typeof storage.removeItem !== "function") return false
      storage.removeItem(DISCOVERY_CANDIDATE_STORAGE_KEY)
    } else {
      if (!storage || typeof storage.setItem !== "function") return false
      storage.setItem(DISCOVERY_CANDIDATE_STORAGE_KEY, raw)
    }
    return true
  } catch {
    return false
  }
}

function candidateRawMatches(storage, raw) {
  const stored = getCandidateRaw(storage, 2)
  return stored.known && stored.raw === raw
}

function candidateFromWork(work) {
  if (!hasExactKeys(work, WORK_KEYS)) throw new TypeError("候选论文字段无效")
  const candidate = {
    ...work,
    doi: typeof work.doi === "string" ? work.doi.toLowerCase() : work.doi,
    stage: "pending_screening",
  }
  if (!validCandidate(candidate)) throw new TypeError("候选论文格式无效")
  return cloneCandidate(candidate)
}

function staleStorageError() {
  const error = new Error("候选队列已在另一个页面更新，请先重新载入")
  error.name = "CandidateStorageConflictError"
  error.code = "stale_storage"
  return error
}

export function createCandidateStore(storage) {
  const initial = loadInitialState(storage)
  let state = initial.state
  let loadStatus = initial.status
  let persistedState = loadStatus === "ready"
  let detachedFromStorage = loadStatus === "unavailable"
  let detachedBase = detachedFromStorage ? emptyState() : null
  let committedBaseline = { ...initial.baseline }

  function rememberBaseline(baseline) {
    committedBaseline = { known: baseline.known, raw: baseline.raw }
  }

  function captureInternalState() {
    return {
      state: cloneState(state),
      loadStatus,
      persistedState,
      detachedFromStorage,
      detachedBase: detachedBase ? cloneState(detachedBase) : null,
    }
  }

  function restoreInternalState(snapshot) {
    state = cloneState(snapshot.state)
    loadStatus = snapshot.loadStatus
    persistedState = snapshot.persistedState
    detachedFromStorage = snapshot.detachedFromStorage
    detachedBase = snapshot.detachedBase ? cloneState(snapshot.detachedBase) : null
  }

  function persist(baseState) {
    const serialized = JSON.stringify(state)
    if (serialized.length > MAX_RAW_LENGTH) throw new RangeError("候选队列存储大小超限")
    if (!storage || typeof storage.setItem !== "function" || loadStatus === "unavailable") {
      persistedState = false
      loadStatus = "unavailable"
      detachedFromStorage = true
      detachedBase ??= cloneState(baseState)
      return false
    }
    try {
      storage.setItem(DISCOVERY_CANDIDATE_STORAGE_KEY, serialized)
      rememberBaseline({ known: true, raw: serialized })
      persistedState = true
      loadStatus = "ready"
      detachedFromStorage = false
      detachedBase = null
      return true
    } catch {
      persistedState = false
      loadStatus = "unavailable"
      detachedFromStorage = true
      detachedBase ??= cloneState(baseState)
      return false
    }
  }

  function refreshBeforeMutation() {
    const reloaded = loadInitialState(storage)
    if (!detachedFromStorage) {
      if (reloaded.status === "unavailable") {
        loadStatus = "unavailable"
        persistedState = false
        detachedFromStorage = true
        detachedBase = cloneState(state)
        return
      }
      state = reloaded.state
      loadStatus = reloaded.status
      persistedState = loadStatus === "ready"
      rememberBaseline(reloaded.baseline)
      return
    }

    if (reloaded.status === "unavailable") {
      loadStatus = "unavailable"
      persistedState = false
      return
    }
    if (reloaded.status !== "ready") throw staleStorageError()
    if (detachedBase && !statesEqual(reloaded.state, detachedBase) && !statesEqual(reloaded.state, state)) {
      throw staleStorageError()
    }
    if (statesEqual(reloaded.state, state)) persistedState = true
    loadStatus = "ready"
    detachedFromStorage = false
    detachedBase = null
    rememberBaseline(reloaded.baseline)
  }

  function transition(paperId, fromStage, toStage) {
    validateOpenAlexId(paperId)
    refreshBeforeMutation()
    const candidate = state.candidates.find((item) => item.paperId === paperId)
    if (!candidate || candidate.stage !== fromStage) {
      return { changed: false, persisted: persistedState, reason: null, state: cloneState(state) }
    }
    const before = cloneState(state)
    candidate.stage = toStage
    let didPersist
    try {
      didPersist = persist(before)
    } catch (error) {
      state = before
      throw error
    }
    if (!didPersist) {
      state = before
      return { changed: false, persisted: false, reason: "persistence_failed", state: cloneState(state) }
    }
    return { changed: true, persisted: true, reason: null, state: cloneState(state) }
  }

  return {
    read() {
      return cloneState(state)
    },

    readValidatedState() {
      const inspected = inspectCandidateState(storage)
      rememberBaseline({ known: inspected.status !== "unavailable", raw: inspected.raw })
      return { status: inspected.status, state: cloneState(inspected.state) }
    },

    replaceValidated(nextState) {
      if (!isValidCandidateState(nextState)) throw new TypeError("候选队列状态无效")
      const replacement = cloneState(nextState)
      const original = captureInternalState()
      const before = inspectCandidateState(storage)
      if (before.status === "invalid" || before.status === "unavailable") {
        restoreInternalState(original)
        return { replaced: false, status: before.status, state: cloneState(state) }
      }
      if (!committedBaseline.known || before.raw !== committedBaseline.raw) {
        restoreInternalState(original)
        return { replaced: false, status: "stale", state: cloneState(state) }
      }

      const beforeInternal = original
      if (!storage || typeof storage.setItem !== "function") {
        restoreInternalState(beforeInternal)
        return { replaced: false, status: "unavailable", state: cloneState(state) }
      }
      const nextRaw = JSON.stringify(replacement)
      if (before.raw === nextRaw) {
        state = cloneState(replacement)
        loadStatus = "ready"
        persistedState = true
        detachedFromStorage = false
        detachedBase = null
        rememberBaseline({ known: true, raw: nextRaw })
        return { replaced: true, state: cloneState(state) }
      }

      writeCandidateRaw(storage, nextRaw)
      if (candidateRawMatches(storage, nextRaw)) {
        state = cloneState(replacement)
        loadStatus = "ready"
        persistedState = true
        detachedFromStorage = false
        detachedBase = null
        rememberBaseline({ known: true, raw: nextRaw })
        return { replaced: true, state: cloneState(state) }
      }

      let restored = candidateRawMatches(storage, before.raw)
      if (!restored) {
        writeCandidateRaw(storage, before.raw)
        restored = candidateRawMatches(storage, before.raw)
      }
      restoreInternalState(beforeInternal)
      return {
        replaced: false,
        status: restored ? "persistence_failed" : "rollback_failed",
        state: cloneState(state),
      }
    },

    getLoadStatus() {
      return loadStatus
    },

    reload() {
      const reloaded = loadInitialState(storage)
      state = reloaded.state
      loadStatus = reloaded.status
      persistedState = loadStatus === "ready"
      detachedFromStorage = loadStatus === "unavailable"
      detachedBase = detachedFromStorage ? emptyState() : null
      rememberBaseline(reloaded.baseline)
      return { status: loadStatus, state: cloneState(state) }
    },

    add(work) {
      const candidate = candidateFromWork(work)
      refreshBeforeMutation()
      if (state.candidates.some(({ paperId }) => paperId === candidate.paperId)) {
        return { added: false, persisted: persistedState, reason: "duplicate_id", state: cloneState(state) }
      }
      if (candidate.doi !== null && state.candidates.some(({ doi }) => doi === candidate.doi)) {
        return { added: false, persisted: persistedState, reason: "duplicate_doi", state: cloneState(state) }
      }
      if (state.candidates.length >= MAX_CANDIDATES) throw new RangeError("候选队列已满")
      const before = cloneState(state)
      const next = cloneState(state)
      next.candidates.push(candidate)
      if (!isValidCandidateState(next)) throw new RangeError("候选队列存储大小超限")
      state = next
      return { added: true, persisted: persist(before), reason: null, state: cloneState(state) }
    },

    confirm(paperId) {
      return transition(paperId, "pending_screening", "confirmed_for_archive")
    },

    markMetadataArchived(paperId) {
      return transition(paperId, "confirmed_for_archive", "metadata_archived")
    },

    moveToPending(paperId) {
      return transition(paperId, "confirmed_for_archive", "pending_screening")
    },

    remove(paperId) {
      validateOpenAlexId(paperId)
      refreshBeforeMutation()
      const nextCandidates = state.candidates.filter((item) => item.paperId !== paperId)
      if (nextCandidates.length === state.candidates.length) {
        return { changed: false, persisted: persistedState, reason: null, state: cloneState(state) }
      }
      const before = cloneState(state)
      state = { version: 1, candidates: nextCandidates }
      let didPersist
      try {
        didPersist = persist(before)
      } catch (error) {
        state = before
        throw error
      }
      if (!didPersist) {
        state = before
        return { changed: false, persisted: false, reason: "persistence_failed", state: cloneState(state) }
      }
      return { changed: true, persisted: true, reason: null, state: cloneState(state) }
    },
  }
}
