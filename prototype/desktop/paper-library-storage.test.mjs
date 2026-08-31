import test from "node:test"
import assert from "node:assert/strict"

import { P02_ROLES } from "./paper-library-model.mjs"
import {
  WORKSPACE_STORAGE_KEY,
  createWorkspaceStore,
} from "./paper-library-storage.mjs"

const EMPTY_STATE = {
  version: 1,
  shelf: {},
  personalReading: {},
  selectedPaperId: null,
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

test("persists four P02 roles in fixed order without accepting duplicates", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.toggleShelfRole("Xi18-ADDOPT", "related_work")
  store.toggleShelfRole("Xi18-ADDOPT", "algorithm_mechanism")
  store.toggleShelfRole("Xi18-ADDOPT", "simulation_baseline")
  store.toggleShelfRole("Xi18-ADDOPT", "theory_evidence")

  assert.deepEqual(store.read().shelf["Xi18-ADDOPT"], P02_ROLES)
  assert.deepEqual(JSON.parse(storage.raw(WORKSPACE_STORAGE_KEY)).shelf["Xi18-ADDOPT"], P02_ROLES)

  store.toggleShelfRole("Xi18-ADDOPT", "theory_evidence")
  assert.deepEqual(store.read().shelf["Xi18-ADDOPT"], ["algorithm_mechanism", "simulation_baseline", "related_work"])
})

test("personal reading markers and selection stay separate from the shelf", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.setPersonalReadingMarker("Xi18-ADDOPT", "reading")
  store.setSelectedPaper("Xi18-ADDOPT")

  assert.deepEqual(store.read(), {
    version: 1,
    shelf: {},
    personalReading: { "Xi18-ADDOPT": "reading" },
    selectedPaperId: "Xi18-ADDOPT",
  })
})

test("loads an exact valid version-1 state", () => {
  const storage = fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify({
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism", "related_work"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: "Paper-01",
  })]]))

  assert.deepEqual(createWorkspaceStore(storage).read(), {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism", "related_work"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: "Paper-01",
  })
})

test("malformed, older, extra, or noncanonical persisted states reset all fields together", () => {
  const invalidStates = [
    "{",
    JSON.stringify({ version: 0, shelf: {}, personalReading: {}, selectedPaperId: null }),
    JSON.stringify({ ...EMPTY_STATE, extra: true }),
    JSON.stringify({ ...EMPTY_STATE, shelf: [] }),
    JSON.stringify({ ...EMPTY_STATE, shelf: { "../escape": ["related_work"] } }),
    JSON.stringify({ ...EMPTY_STATE, shelf: { "Paper-01": ["unknown_role"] } }),
    JSON.stringify({ ...EMPTY_STATE, shelf: { "Paper-01": ["related_work", "related_work"] } }),
    JSON.stringify({ ...EMPTY_STATE, shelf: { "Paper-01": ["related_work", "algorithm_mechanism"] } }),
    JSON.stringify({ ...EMPTY_STATE, personalReading: [] }),
    JSON.stringify({ ...EMPTY_STATE, personalReading: { "../escape": "read" } }),
    JSON.stringify({ ...EMPTY_STATE, personalReading: { "Paper-01": "verified" } }),
    JSON.stringify({ ...EMPTY_STATE, selectedPaperId: "../escape" }),
    JSON.stringify({ ...EMPTY_STATE, selectedPaperId: 1 }),
  ]

  for (const raw of invalidStates) {
    const storage = fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, raw]]))
    assert.deepEqual(createWorkspaceStore(storage).read(), EMPTY_STATE)
  }
})

test("validates every mutation and leaves the prior state unchanged on rejection", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.toggleShelfRole("Paper-01", "related_work")
  const before = store.read()

  assert.throws(() => store.toggleShelfRole("../escape", "related_work"), /论文 ID/u)
  assert.throws(() => store.toggleShelfRole("Paper-01", "unknown_role"), /P02 用途/u)
  assert.throws(() => store.setPersonalReadingMarker("Paper-01", "verified"), /阅读标记/u)
  assert.throws(() => store.setPersonalReadingMarker("bad", "read"), /论文 ID/u)
  assert.throws(() => store.setSelectedPaper("bad"), /论文 ID/u)
  assert.deepEqual(store.read(), before)
})

test("accepts null selection and removes an empty shelf entry", () => {
  const store = createWorkspaceStore(fakeStorage())
  store.toggleShelfRole("Paper-01", "related_work")
  store.toggleShelfRole("Paper-01", "related_work")
  store.setSelectedPaper("Paper-01")
  store.setSelectedPaper(null)

  assert.deepEqual(store.read(), EMPTY_STATE)
})

test("read and persisted writes are cloned so mutable references never leak", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.toggleShelfRole("Paper-01", "algorithm_mechanism")
  store.setPersonalReadingMarker("Paper-01", "read")
  const first = store.read()
  first.shelf["Paper-01"].push("related_work")
  first.personalReading["Paper-01"] = "reading"

  assert.deepEqual(store.read(), {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: null,
  })
  const persisted = JSON.parse(storage.raw(WORKSPACE_STORAGE_KEY))
  persisted.shelf["Paper-01"].push("related_work")
  assert.deepEqual(store.read().shelf["Paper-01"], ["algorithm_mechanism"])
})

test("a throwing getItem uses a deterministic in-memory store", () => {
  const storage = {
    getItem() { throw new Error("denied") },
    setItem() { throw new Error("denied") },
    removeItem() { throw new Error("denied") },
  }
  const store = createWorkspaceStore(storage)

  store.toggleShelfRole("Paper-01", "algorithm_mechanism")
  store.setPersonalReadingMarker("Paper-01", "reading")
  store.setSelectedPaper("Paper-01")
  assert.deepEqual(store.read(), {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism"] },
    personalReading: { "Paper-01": "reading" },
    selectedPaperId: "Paper-01",
  })
  store.clear()
  assert.deepEqual(store.read(), EMPTY_STATE)
})

test("a throwing setItem keeps successful mutations in memory", () => {
  const storage = {
    getItem: () => null,
    setItem() { throw new Error("quota") },
    removeItem() { throw new Error("denied") },
  }
  const store = createWorkspaceStore(storage)
  store.setPersonalReadingMarker("Paper-01", "read")
  store.toggleShelfRole("Paper-01", "theory_evidence")

  assert.deepEqual(store.read(), {
    version: 1,
    shelf: { "Paper-01": ["theory_evidence"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: null,
  })
})

test("clear remains effective when removeItem throws", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem() { throw new Error("denied") },
  }
  const store = createWorkspaceStore(storage)
  store.toggleShelfRole("Paper-01", "related_work")
  store.clear()

  assert.deepEqual(store.read(), EMPTY_STATE)
})

test("does not persist an unread marker merely because the view default is unread", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)

  assert.deepEqual(store.read().personalReading, {})
  assert.equal(storage.raw(WORKSPACE_STORAGE_KEY), undefined)
})
