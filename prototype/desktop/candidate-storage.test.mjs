import test from "node:test"
import assert from "node:assert/strict"
import {
  DISCOVERY_CANDIDATE_STORAGE_KEY,
  createCandidateStore,
  isValidCandidateState,
} from "./candidate-storage.mjs"
import { searchOpenAlexWorks } from "./openalex-search.mjs"

const SENSITIVE_MARKER = ["sensitive", "marker"].join("-")

function credentialQueryUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.searchParams.set(keyParts.join("_"), SENSITIVE_MARKER)
  return url.href
}

function obfuscatedCredentialQueryUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.searchParams.set(keyParts.join(""), SENSITIVE_MARKER)
  return url.href
}

function repeatedlyEncodedCredentialQueryUrl(keyParts, passes, path = "/paper") {
  let key = keyParts.join("")
  for (let index = 0; index < passes; index += 1) key = encodeURIComponent(key)
  return `https://public.example${path}?${key}=${encodeURIComponent(SENSITIVE_MARKER)}`
}

function credentialFragmentUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.hash = `${keyParts.join("_")}=${SENSITIVE_MARKER}`
  return url.href
}

function userInfoUrl(path) {
  const url = new URL(`https://example.org${path}`)
  url.username = "reader"
  url.password = SENSITIVE_MARKER
  return url.href
}

function fakeStorage(initial = new Map()) {
  const data = initial
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: (key) => data.get(key),
  }
}

const OPENALEX_WORK = Object.freeze({
  paperId: "W1234567890",
  doi: "10.1109/tac.2025.1234567",
  title: "Time-varying distributed optimization",
  authors: Object.freeze(["Alice Zhang", "Bo Li"]),
  year: 2025,
  source: "IEEE Transactions on Automatic Control",
  citations: 37,
  isOpenAccess: true,
  openAccessUrl: "https://repository.example.edu/work/123.pdf",
  landingPageUrl: "https://doi.org/10.1109/tac.2025.1234567",
  topics: Object.freeze(["Distributed Optimization", "Directed Networks"]),
  abstract: "A source-provided abstract.",
})

test("adding an OpenAlex work persists an exact pending candidate that a new store reloads", () => {
  assert.equal(DISCOVERY_CANDIDATE_STORAGE_KEY, "research-console.discovery-candidates.v1")
  const storage = fakeStorage()
  const store = createCandidateStore(storage)
  const outcome = store.add(OPENALEX_WORK)

  assert.equal(outcome.added, true)
  assert.equal(outcome.persisted, true)
  assert.equal(outcome.reason, null)
  const expected = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: ["Alice Zhang", "Bo Li"],
      topics: ["Distributed Optimization", "Directed Networks"],
      stage: "pending_screening",
    }],
  }
  assert.deepEqual(store.read(), expected)
  assert.deepEqual(JSON.parse(storage.raw(DISCOVERY_CANDIDATE_STORAGE_KEY)), expected)
  assert.deepEqual(createCandidateStore(storage).read(), expected)
  const persistedCandidate = JSON.parse(storage.raw(DISCOVERY_CANDIDATE_STORAGE_KEY)).candidates[0]
  assert.equal(Object.hasOwn(persistedCandidate, "query"), false)
  assert.equal(Object.hasOwn(persistedCandidate, "personalTags"), false)
})

test("deduplicates provider-qualified OpenAlex ID and normalized DOI but never title or future local ID", () => {
  const store = createCandidateStore(fakeStorage())
  assert.equal(store.add(OPENALEX_WORK).added, true)

  const sameId = store.add({ ...OPENALEX_WORK, doi: "10.9999/different", title: "Changed metadata" })
  assert.deepEqual({ added: sameId.added, reason: sameId.reason }, { added: false, reason: "duplicate_id" })

  const sameDoi = store.add({
    ...OPENALEX_WORK,
    paperId: "W2222222222",
    doi: "10.1109/tac.2025.1234567".toUpperCase(),
    title: "Different title",
  })
  assert.deepEqual({ added: sameDoi.added, reason: sameDoi.reason }, { added: false, reason: "duplicate_doi" })

  assert.throws(() => store.add({
    ...OPENALEX_WORK,
    paperId: "W3333333333",
    doi: "10.5555/distinct",
    localPaperId: "P02",
  }), /候选论文/u)
  const distinctTitleOnly = store.add({ ...OPENALEX_WORK, paperId: "W3333333333", doi: "10.5555/distinct" })
  assert.equal(distinctTitleOnly.added, true)
  assert.deepEqual(store.read().candidates.map(({ paperId }) => paperId), ["W1234567890", "W3333333333"])
})

test("confirmation, metadata commit, moving back to pending, and removal are persistent idempotent transitions", () => {
  const storage = fakeStorage()
  const store = createCandidateStore(storage)
  store.add(OPENALEX_WORK)

  const confirmed = store.confirm(OPENALEX_WORK.paperId)
  assert.equal(confirmed.changed, true)
  assert.equal(confirmed.persisted, true)
  assert.equal(store.read().candidates[0].stage, "confirmed_for_archive")
  assert.equal(createCandidateStore(storage).read().candidates[0].stage, "confirmed_for_archive")
  assert.equal(store.confirm(OPENALEX_WORK.paperId).changed, false)

  const committed = store.markMetadataArchived(OPENALEX_WORK.paperId)
  assert.equal(committed.changed, true)
  assert.equal(committed.persisted, true)
  assert.equal(store.read().candidates[0].stage, "metadata_archived")
  assert.equal(createCandidateStore(storage).read().candidates[0].stage, "metadata_archived")
  assert.equal(store.markMetadataArchived(OPENALEX_WORK.paperId).changed, false)
  assert.equal(store.moveToPending(OPENALEX_WORK.paperId).changed, false)

  store.remove(OPENALEX_WORK.paperId)
  store.add(OPENALEX_WORK)
  store.confirm(OPENALEX_WORK.paperId)
  const pending = store.moveToPending(OPENALEX_WORK.paperId)
  assert.equal(pending.changed, true)
  assert.equal(store.read().candidates[0].stage, "pending_screening")
  assert.equal(createCandidateStore(storage).read().candidates[0].stage, "pending_screening")
  assert.equal(store.moveToPending("W9999999999").changed, false)

  const removed = store.remove(OPENALEX_WORK.paperId)
  assert.equal(removed.changed, true)
  assert.equal(removed.persisted, true)
  assert.deepEqual(store.read(), { version: 1, candidates: [] })
  assert.equal(store.remove(OPENALEX_WORK.paperId).changed, false)
})

test("loads only an exact canonical version-1 candidate state", () => {
  const canonicalState = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: ["Alice Zhang", "Bo Li"],
      topics: ["Distributed Optimization", "Directed Networks"],
      stage: "confirmed_for_archive",
    }],
  }
  const storage = fakeStorage(new Map([[
    DISCOVERY_CANDIDATE_STORAGE_KEY,
    JSON.stringify(canonicalState),
  ]]))
  const store = createCandidateStore(storage)
  assert.equal(store.getLoadStatus(), "ready")
  assert.deepEqual(store.read(), canonicalState)
})

test("malformed, unknown-version, extra-field, duplicate, or unsafe persisted states recover empty", () => {
  const candidate = {
    ...OPENALEX_WORK,
    authors: ["Alice Zhang", "Bo Li"],
    topics: ["Distributed Optimization", "Directed Networks"],
    stage: "pending_screening",
  }
  const invalidStates = [
    "{",
    JSON.stringify({ version: 0, candidates: [] }),
    JSON.stringify({ version: 2, candidates: [] }),
    JSON.stringify({ version: 1, candidates: [], extra: true }),
    JSON.stringify({ version: 1, candidates: {} }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, extra: true }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, stage: "accepted" }] }),
    JSON.stringify({ version: 1, candidates: [candidate, candidate] }),
    JSON.stringify({ version: 1, candidates: [candidate, { ...candidate, paperId: "W2", doi: candidate.doi.toUpperCase() }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, openAccessUrl: "http://example.org/paper.pdf" }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: userInfoUrl("/paper") }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: "https://example.org:8443/paper" }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: "https://127.0.0.1/paper" }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: "https://2130706433/paper" }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: "https://service.local/paper" }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: credentialQueryUrl(["access", "token"]) }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: credentialFragmentUrl(["access", "token"]) }] }),
    JSON.stringify({ version: 1, candidates: [{ ...candidate, landingPageUrl: obfuscatedCredentialQueryUrl(["oauth", "_", "token"]) }] }),
    JSON.stringify({ version: 1, candidates: [{
      ...candidate,
      landingPageUrl: repeatedlyEncodedCredentialQueryUrl(["api", "[", "key", "]"], 2),
    }] }),
    JSON.stringify({ version: 1, candidates: [{
      ...candidate,
      landingPageUrl: repeatedlyEncodedCredentialQueryUrl(["bearer", "_", "token"], 8),
    }] }),
    " ".repeat(2_500_001),
  ]

  for (const raw of invalidStates) {
    const store = createCandidateStore(fakeStorage(new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, raw]])))
    assert.equal(store.getLoadStatus(), "recovered_invalid")
    assert.deepEqual(store.read(), { version: 1, candidates: [] })
  }
})

test("add accepts only the strict bounded OpenAlex work shape and preserves prior state on rejection", () => {
  const store = createCandidateStore(fakeStorage())
  store.add(OPENALEX_WORK)
  const before = store.read()
  const invalidWorks = [
    { ...OPENALEX_WORK, paperId: "OpenAlex-W123" },
    { ...OPENALEX_WORK, paperId: `W${"1".repeat(100)}` },
    { ...OPENALEX_WORK, paperId: "../W123" },
    { ...OPENALEX_WORK, extra: true },
    { ...OPENALEX_WORK, doi: "10.1234/../../admin" },
    { ...OPENALEX_WORK, doi: "10.1234/../x" },
    { ...OPENALEX_WORK, doi: "10.1234//admin" },
    { ...OPENALEX_WORK, title: "x".repeat(1_001) },
    { ...OPENALEX_WORK, authors: Array.from({ length: 51 }, (_, index) => `Author ${index}`) },
    { ...OPENALEX_WORK, year: "2025" },
    { ...OPENALEX_WORK, citations: -1 },
    { ...OPENALEX_WORK, isOpenAccess: "true" },
    { ...OPENALEX_WORK, openAccessUrl: "javascript:alert(1)" },
    { ...OPENALEX_WORK, landingPageUrl: userInfoUrl("/work") },
    { ...OPENALEX_WORK, landingPageUrl: "https://example.org:8443/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://localhost/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://2130706433/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://service.local/work" },
    { ...OPENALEX_WORK, landingPageUrl: credentialQueryUrl(["api", "key"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: credentialFragmentUrl(["access", "token"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["oauth", "_", "token"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["token", "[", "]"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["api", "[", "key", "]"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["api", "key", "[", "]"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["oauth", "2_", "token"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["my", "_", "token"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["service", "_", "api", "_", "key"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["x", "-", "amz", "-", "signa", "ture"], "/work") },
    { ...OPENALEX_WORK, landingPageUrl: obfuscatedCredentialQueryUrl(["j", "wt"], "/work") },
    {
      ...OPENALEX_WORK,
      landingPageUrl: repeatedlyEncodedCredentialQueryUrl(["api", "_", "key"], 2, "/work"),
    },
    { ...OPENALEX_WORK, landingPageUrl: "https://0/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://127.1/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://0x7f000001/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://0177.0.0.1/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://172.16.0.1/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://192.168.1.1/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://100.64.0.1/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://[::]/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://[::ffff:127.0.0.1]/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://[fc00::1]/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://[fe80::1]/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://localhost./work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://sub.localhost/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://host.home.arpa/work" },
    { ...OPENALEX_WORK, landingPageUrl: "https://intranet/work" },
    { ...OPENALEX_WORK, topics: Array.from({ length: 21 }, (_, index) => `Topic ${index}`) },
    { ...OPENALEX_WORK, abstract: "x".repeat(20_001) },
  ]

  for (const work of invalidWorks) {
    assert.throws(() => store.add(work), /候选论文/u)
    assert.deepEqual(store.read(), before)
  }
  for (const mutation of [
    () => store.confirm("bad"),
    () => store.markMetadataArchived("W0/escape"),
    () => store.moveToPending("../W123"),
    () => store.remove("W0/escape"),
  ]) assert.throws(mutation, /OpenAlex ID/u)
})

test("OpenAlex sanitization prevents repeatedly encoded credential links from reaching candidate storage", async () => {
  const unsafeUrl = repeatedlyEncodedCredentialQueryUrl(["api", "[", "key", "]"], 2, "/work")
  const result = await searchOpenAlexWorks({
    query: "privacy",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          meta: { count: 1, next_cursor: null },
          results: [{
            id: "https://openalex.org/W77",
            doi: null,
            title: "Safe title",
            authorships: [],
            publication_year: 2026,
            primary_location: { landing_page_url: unsafeUrl, source: { display_name: "Source" } },
            cited_by_count: 0,
            open_access: { is_oa: true, oa_url: unsafeUrl },
            best_oa_location: null,
            topics: [],
            abstract_inverted_index: null,
          }],
        }
      },
    }),
  })
  const storage = fakeStorage()
  const outcome = createCandidateStore(storage).add(result.works[0])
  assert.equal(outcome.persisted, true)
  assert.equal(storage.raw(DISCOVERY_CANDIDATE_STORAGE_KEY).includes(SENSITIVE_MARKER), false)
})

test("caps the queue at one hundred candidates without mutating the full state", () => {
  const store = createCandidateStore(fakeStorage())
  for (let index = 1; index <= 100; index += 1) {
    store.add({ ...OPENALEX_WORK, paperId: `W${index}`, doi: null })
  }
  const before = store.read()
  assert.throws(() => store.add({ ...OPENALEX_WORK, paperId: "W101", doi: null }), /候选队列已满/u)
  assert.deepEqual(store.read(), before)
})

test("the largest accepted one-hundred-item state survives an exact storage round trip", () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    ...OPENALEX_WORK,
    paperId: `W${index + 1}`,
    doi: null,
    title: `Paper ${index} ${"t".repeat(980)}`,
    authors: Array.from({ length: 50 }, (__, author) => `Author ${author} ${"a".repeat(280)}`),
    source: `Source ${"s".repeat(490)}`,
    topics: Array.from({ length: 20 }, (__, topic) => `Topic ${topic} ${"p".repeat(285)}`),
    abstract: "x".repeat(20_000),
    stage: "pending_screening",
  }))
  const state = { version: 1, candidates }
  const serialized = JSON.stringify(state)
  assert.equal(serialized.length > 2_500_000, true)
  const storage = fakeStorage(new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, serialized]]))
  const store = createCandidateStore(storage)
  assert.equal(store.getLoadStatus(), "ready")
  assert.deepEqual(store.read(), state)
})

test("unavailable or full localStorage keeps mutations in memory and reports persisted false", () => {
  const inaccessible = {
    getItem() { throw new Error("denied") },
    setItem() { throw new Error("denied") },
  }
  const unavailableStore = createCandidateStore(inaccessible)
  assert.equal(unavailableStore.getLoadStatus(), "unavailable")
  assert.equal(unavailableStore.add(OPENALEX_WORK).persisted, false)
  const unavailableConfirm = unavailableStore.confirm(OPENALEX_WORK.paperId)
  assert.equal(unavailableConfirm.persisted, false)
  assert.equal(unavailableConfirm.changed, false)
  assert.equal(unavailableStore.read().candidates[0].stage, "pending_screening")

  const data = new Map()
  let failWrites = false
  const quotaStorage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem(key, value) {
      if (failWrites) throw new Error("quota")
      data.set(key, String(value))
    },
  }
  const quotaStore = createCandidateStore(quotaStorage)
  assert.equal(quotaStore.getLoadStatus(), "ready")
  assert.equal(quotaStore.add(OPENALEX_WORK).persisted, true)
  failWrites = true
  const failedConfirm = quotaStore.confirm(OPENALEX_WORK.paperId)
  assert.deepEqual(
    { changed: failedConfirm.changed, persisted: failedConfirm.persisted, reason: failedConfirm.reason },
    { changed: false, persisted: false, reason: "persistence_failed" },
  )
  assert.equal(quotaStore.getLoadStatus(), "unavailable")
  assert.equal(quotaStore.read().candidates[0].stage, "pending_screening")

  failWrites = false
  assert.equal(quotaStore.confirm(OPENALEX_WORK.paperId).persisted, true)
  assert.equal(quotaStore.getLoadStatus(), "ready")
  failWrites = true
  const failedArchive = quotaStore.markMetadataArchived(OPENALEX_WORK.paperId)
  assert.equal(failedArchive.changed, false)
  assert.equal(failedArchive.persisted, false)
  assert.equal(quotaStore.getLoadStatus(), "unavailable")
  assert.equal(quotaStore.read().candidates[0].stage, "confirmed_for_archive")
  const failedRemove = quotaStore.remove(OPENALEX_WORK.paperId)
  assert.equal(failedRemove.changed, false)
  assert.equal(failedRemove.persisted, false)
  assert.equal(quotaStore.read().candidates.length, 1)
  assert.equal(createCandidateStore(quotaStorage).read().candidates[0].stage, "confirmed_for_archive")
})

test("read, mutation outcomes, and input arrays never expose mutable internal references", () => {
  const mutableWork = {
    ...OPENALEX_WORK,
    authors: ["Alice Zhang", "Bo Li"],
    topics: ["Distributed Optimization", "Directed Networks"],
  }
  const store = createCandidateStore(fakeStorage())
  const outcome = store.add(mutableWork)
  mutableWork.authors.push("Mallory")
  mutableWork.topics[0] = "Changed"
  outcome.state.candidates[0].authors.push("Eve")
  outcome.state.candidates[0].stage = "confirmed_for_archive"
  const firstRead = store.read()
  firstRead.candidates[0].topics.push("Injected")
  firstRead.candidates[0].title = "Changed title"

  assert.deepEqual(store.read(), {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: ["Alice Zhang", "Bo Li"],
      topics: ["Distributed Optimization", "Directed Networks"],
      stage: "pending_screening",
    }],
  })
})

test("reload observes another store's persisted candidate and returns a defensive snapshot", () => {
  const storage = fakeStorage()
  const firstTab = createCandidateStore(storage)
  const secondTab = createCandidateStore(storage)
  assert.deepEqual(secondTab.read(), { version: 1, candidates: [] })
  firstTab.add(OPENALEX_WORK)

  const reloaded = secondTab.reload()
  assert.equal(reloaded.status, "ready")
  assert.equal(reloaded.state.candidates[0].paperId, OPENALEX_WORK.paperId)
  reloaded.state.candidates[0].authors.push("Mallory")
  reloaded.state.candidates[0].stage = "confirmed_for_archive"
  assert.deepEqual(secondTab.read().candidates[0].authors, ["Alice Zhang", "Bo Li"])
  assert.equal(secondTab.read().candidates[0].stage, "pending_screening")
})

test("a stale tab reloads authoritative state before adding and never overwrites another candidate", () => {
  const storage = fakeStorage()
  const firstTab = createCandidateStore(storage)
  const secondTab = createCandidateStore(storage)
  const secondWork = {
    ...OPENALEX_WORK,
    paperId: "W2222222222",
    doi: "10.5555/second-work",
    title: "A second distributed optimization paper",
  }
  firstTab.add(OPENALEX_WORK)
  secondTab.add(secondWork)
  assert.deepEqual(
    createCandidateStore(storage).read().candidates.map(({ paperId }) => paperId),
    [OPENALEX_WORK.paperId, secondWork.paperId],
  )
})

test("a stale tab cannot resurrect a candidate removed by another tab", () => {
  const storage = fakeStorage()
  const firstTab = createCandidateStore(storage)
  firstTab.add(OPENALEX_WORK)
  const staleTab = createCandidateStore(storage)
  firstTab.remove(OPENALEX_WORK.paperId)
  const outcome = staleTab.confirm(OPENALEX_WORK.paperId)
  assert.equal(outcome.changed, false)
  assert.deepEqual(createCandidateStore(storage).read(), { version: 1, candidates: [] })
})

test("a detached tab rejects a recovered-storage conflict instead of losing a newer W3", () => {
  const data = new Map()
  let failWrites = false
  const storage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem(key, value) {
      if (failWrites) throw new Error("quota")
      data.set(key, String(value))
    },
  }
  const originalTab = createCandidateStore(storage)
  originalTab.add({ ...OPENALEX_WORK, paperId: "W1", doi: null })
  const detachedTab = createCandidateStore(storage)

  failWrites = true
  const unsaved = detachedTab.add({ ...OPENALEX_WORK, paperId: "W2", doi: null })
  assert.equal(unsaved.persisted, false)
  assert.deepEqual(detachedTab.read().candidates.map(({ paperId }) => paperId), ["W1", "W2"])

  failWrites = false
  const newerTab = createCandidateStore(storage)
  newerTab.add({ ...OPENALEX_WORK, paperId: "W3", doi: null })
  assert.deepEqual(createCandidateStore(storage).read().candidates.map(({ paperId }) => paperId), ["W1", "W3"])

  assert.throws(() => detachedTab.confirm("W1"), (error) => {
    assert.equal(error instanceof Error, true)
    assert.equal(error.code, "stale_storage")
    return true
  })
  assert.deepEqual(createCandidateStore(storage).read().candidates.map(({ paperId }) => paperId), ["W1", "W3"])
  assert.deepEqual(detachedTab.reload().state.candidates.map(({ paperId }) => paperId), ["W1", "W3"])
})

test("reload atomically replaces memory with empty recovery state when storage becomes damaged or unavailable", () => {
  const storage = fakeStorage()
  const store = createCandidateStore(storage)
  store.add(OPENALEX_WORK)
  storage.setItem(DISCOVERY_CANDIDATE_STORAGE_KEY, "{")
  assert.deepEqual(store.reload(), { status: "recovered_invalid", state: { version: 1, candidates: [] } })
  assert.equal(store.getLoadStatus(), "recovered_invalid")

  let unavailable = false
  const toggledStorage = {
    getItem(key) {
      if (unavailable) throw new Error("denied")
      return storage.getItem(key)
    },
    setItem: storage.setItem,
  }
  storage.setItem(DISCOVERY_CANDIDATE_STORAGE_KEY, JSON.stringify({
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: ["Alice Zhang", "Bo Li"],
      topics: ["Distributed Optimization", "Directed Networks"],
      stage: "pending_screening",
    }],
  }))
  const toggledStore = createCandidateStore(toggledStorage)
  assert.equal(toggledStore.read().candidates.length, 1)
  unavailable = true
  assert.deepEqual(toggledStore.reload(), { status: "unavailable", state: { version: 1, candidates: [] } })
  assert.equal(toggledStore.getLoadStatus(), "unavailable")
})

test("candidate owner exposes a strict validator and four-state cloned reader", () => {
  const valid = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: [...OPENALEX_WORK.authors],
      topics: [...OPENALEX_WORK.topics],
      stage: "confirmed_for_archive",
    }],
  }
  assert.equal(isValidCandidateState(valid), true)
  assert.equal(isValidCandidateState({ ...valid, extra: true }), false)
  assert.equal(isValidCandidateState({ ...valid, candidates: [...valid.candidates, valid.candidates[0]] }), false)

  assert.deepEqual(createCandidateStore(fakeStorage()).readValidatedState(), {
    status: "missing",
    state: { version: 1, candidates: [] },
  })
  const validStore = createCandidateStore(fakeStorage(new Map([
    [DISCOVERY_CANDIDATE_STORAGE_KEY, JSON.stringify(valid)],
  ])))
  const inspected = validStore.readValidatedState()
  assert.deepEqual(inspected, { status: "valid", state: valid })
  inspected.state.candidates[0].authors.push("Mallory")
  assert.deepEqual(validStore.readValidatedState(), { status: "valid", state: valid })
  assert.deepEqual(createCandidateStore(fakeStorage(new Map([
    [DISCOVERY_CANDIDATE_STORAGE_KEY, "{"],
  ]))).readValidatedState(), {
    status: "invalid",
    state: { version: 1, candidates: [] },
  })
  assert.deepEqual(createCandidateStore({ getItem() { throw new Error("denied") } }).readValidatedState(), {
    status: "unavailable",
    state: { version: 1, candidates: [] },
  })
})

test("candidate replaceValidated clones, proves readback, and restores prior memory plus bytes", () => {
  const previous = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: [...OPENALEX_WORK.authors],
      topics: [...OPENALEX_WORK.topics],
      stage: "pending_screening",
    }],
  }
  const replacement = {
    version: 1,
    candidates: [{
      ...previous.candidates[0],
      stage: "confirmed_for_archive",
    }],
  }
  const storage = fakeStorage(new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, JSON.stringify(previous)]]))
  const store = createCandidateStore(storage)
  const result = store.replaceValidated(replacement)
  assert.deepEqual(result, { replaced: true, state: replacement })
  replacement.candidates[0].authors.push("Mallory")
  result.state.candidates[0].topics.push("Injected")
  assert.deepEqual(store.read().candidates[0].authors, [...OPENALEX_WORK.authors])
  assert.deepEqual(store.read().candidates[0].topics, [...OPENALEX_WORK.topics])

  const bytes = new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, JSON.stringify(previous)]])
  let failWrite = true
  const blockedStorage = {
    getItem(key) { return bytes.has(key) ? bytes.get(key) : null },
    setItem(key, value) {
      if (failWrite) {
        failWrite = false
        throw new Error("quota")
      }
      bytes.set(key, String(value))
    },
    removeItem(key) { bytes.delete(key) },
  }
  const blocked = createCandidateStore(blockedStorage)
  const next = { version: 1, candidates: [] }
  assert.deepEqual(blocked.replaceValidated(next), {
    replaced: false,
    status: "persistence_failed",
    state: previous,
  })
  assert.deepEqual(blocked.read(), previous)
  assert.equal(bytes.get(DISCOVERY_CANDIDATE_STORAGE_KEY), JSON.stringify(previous))
  assert.throws(() => blocked.replaceValidated({ version: 1 }), /候选队列状态/u)
})

test("candidate replaceValidated preserves detached memory and reports stale on cross-tab divergence", () => {
  const bytes = new Map()
  let failWrites = false
  const storage = {
    getItem(key) { return bytes.has(key) ? bytes.get(key) : null },
    setItem(key, value) {
      if (failWrites) throw new Error("quota")
      bytes.set(key, String(value))
    },
    removeItem(key) { bytes.delete(key) },
  }
  const detached = createCandidateStore(storage)
  assert.equal(detached.add({ ...OPENALEX_WORK, paperId: "W1", doi: null }).persisted, true)
  failWrites = true
  assert.equal(detached.add({ ...OPENALEX_WORK, paperId: "W2", doi: null }).persisted, false)
  const detachedBefore = detached.read()

  failWrites = false
  const newerTab = createCandidateStore(storage)
  assert.equal(newerTab.add({ ...OPENALEX_WORK, paperId: "W3", doi: null }).persisted, true)
  const durableBefore = bytes.get(DISCOVERY_CANDIDATE_STORAGE_KEY)

  assert.deepEqual(detached.replaceValidated({ version: 1, candidates: [] }), {
    replaced: false,
    status: "stale",
    state: detachedBefore,
  })
  assert.deepEqual(detached.read(), detachedBefore)
  assert.equal(bytes.get(DISCOVERY_CANDIDATE_STORAGE_KEY), durableBefore)
})

test("candidate replacement compares exact committed raw baseline and refreshes it for reverse replacement", () => {
  const previous = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: [...OPENALEX_WORK.authors],
      topics: [...OPENALEX_WORK.topics],
      stage: "pending_screening",
    }],
  }
  const replacement = {
    version: 1,
    candidates: [{ ...previous.candidates[0], stage: "confirmed_for_archive" }],
  }
  const compact = JSON.stringify(previous)
  const concurrentBytes = JSON.stringify(previous, null, 2)
  const storage = fakeStorage(new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, compact]]))
  const store = createCandidateStore(storage)

  storage.setItem(DISCOVERY_CANDIDATE_STORAGE_KEY, concurrentBytes)
  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "stale",
    state: previous,
  })
  assert.equal(storage.raw(DISCOVERY_CANDIDATE_STORAGE_KEY), concurrentBytes)

  assert.deepEqual(store.readValidatedState(), { status: "valid", state: previous })
  assert.deepEqual(store.replaceValidated(replacement), { replaced: true, state: replacement })
  assert.deepEqual(store.replaceValidated(previous), { replaced: true, state: previous })
  assert.equal(storage.raw(DISCOVERY_CANDIDATE_STORAGE_KEY), compact)
})

test("candidate replacement reports rollback_failed when rollback throws before restoring pre-bytes", () => {
  const previous = {
    version: 1,
    candidates: [{
      ...OPENALEX_WORK,
      authors: [...OPENALEX_WORK.authors],
      topics: [...OPENALEX_WORK.topics],
      stage: "pending_screening",
    }],
  }
  const replacement = { version: 1, candidates: [] }
  const previousRaw = JSON.stringify(previous)
  const bytes = new Map([[DISCOVERY_CANDIDATE_STORAGE_KEY, previousRaw]])
  let writeCount = 0
  const storage = {
    getItem(key) { return bytes.has(key) ? bytes.get(key) : null },
    setItem(key, value) {
      writeCount += 1
      if (writeCount === 1) {
        bytes.set(key, `${String(value)} `)
        throw new Error("forward write-then-throw")
      }
      throw new Error("rollback throw-before")
    },
    removeItem(key) { bytes.delete(key) },
  }
  const store = createCandidateStore(storage)

  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "rollback_failed",
    state: previous,
  })
  assert.deepEqual(store.read(), previous)
  assert.equal(bytes.get(DISCOVERY_CANDIDATE_STORAGE_KEY), `${JSON.stringify(replacement)} `)
})
