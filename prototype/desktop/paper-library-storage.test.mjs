import test from "node:test"
import assert from "node:assert/strict"

import { P02_ROLES } from "./paper-library-model.mjs"
import {
  WORKSPACE_STORAGE_KEY,
  createWorkspaceStore,
  isValidWorkspaceState,
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

test("workspace owner exposes a strict validator and four-state cloned reader", () => {
  const valid = {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism", "related_work"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: "Paper-01",
  }
  assert.equal(isValidWorkspaceState(valid), true)
  assert.equal(isValidWorkspaceState({ ...valid, extra: true }), false)
  assert.equal(isValidWorkspaceState({ ...valid, shelf: { "Paper-01": ["related_work", "algorithm_mechanism"] } }), false)

  assert.deepEqual(createWorkspaceStore(fakeStorage()).readValidatedState(), {
    status: "missing",
    state: EMPTY_STATE,
  })
  const validStore = createWorkspaceStore(fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(valid)]])))
  const inspected = validStore.readValidatedState()
  assert.deepEqual(inspected, { status: "valid", state: valid })
  inspected.state.shelf["Paper-01"].push("theory_evidence")
  assert.deepEqual(validStore.readValidatedState(), { status: "valid", state: valid })
  assert.deepEqual(createWorkspaceStore(fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, "{"]]))).readValidatedState(), {
    status: "invalid",
    state: EMPTY_STATE,
  })
  assert.deepEqual(createWorkspaceStore({ getItem() { throw new Error("denied") } }).readValidatedState(), {
    status: "unavailable",
    state: EMPTY_STATE,
  })
})

test("workspace replaceValidated clones, proves readback, and rolls memory plus bytes back on failure", () => {
  const previous = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: { "Paper-01": "reading" },
    selectedPaperId: "Paper-01",
  }
  const replacement = {
    version: 1,
    shelf: { "Paper-02": ["theory_evidence"] },
    personalReading: {},
    selectedPaperId: "Paper-02",
  }
  const storage = fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(previous)]]))
  const store = createWorkspaceStore(storage)
  const result = store.replaceValidated(replacement)
  assert.deepEqual(result, { replaced: true, state: replacement })
  replacement.shelf["Paper-02"].push("related_work")
  result.state.shelf["Paper-02"].length = 0
  assert.deepEqual(store.read(), {
    version: 1,
    shelf: { "Paper-02": ["theory_evidence"] },
    personalReading: {},
    selectedPaperId: "Paper-02",
  })

  const bytes = new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(previous)]])
  let dropNextWrite = true
  const droppingStorage = {
    getItem(key) { return bytes.has(key) ? bytes.get(key) : null },
    setItem(key, value) {
      if (dropNextWrite) {
        dropNextWrite = false
        return
      }
      bytes.set(key, String(value))
    },
    removeItem(key) { bytes.delete(key) },
  }
  const blocked = createWorkspaceStore(droppingStorage)
  assert.deepEqual(blocked.replaceValidated(replacement), {
    replaced: false,
    status: "persistence_failed",
    state: previous,
  })
  assert.deepEqual(blocked.read(), previous)
  assert.equal(bytes.get(WORKSPACE_STORAGE_KEY), JSON.stringify(previous))
  assert.throws(() => blocked.replaceValidated({ version: 1 }), /工作台状态/u)
})

test("workspace replacement uses an exact creation/read baseline and refreshes it after every successful replacement", () => {
  const previous = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: { "Paper-01": "reading" },
    selectedPaperId: "Paper-01",
  }
  const replacement = {
    version: 1,
    shelf: { "Paper-02": ["theory_evidence"] },
    personalReading: {},
    selectedPaperId: "Paper-02",
  }
  const compact = JSON.stringify(previous)
  const concurrentBytes = JSON.stringify(previous, null, 2)
  const storage = fakeStorage(new Map([[WORKSPACE_STORAGE_KEY, compact]]))
  const store = createWorkspaceStore(storage)

  storage.setItem(WORKSPACE_STORAGE_KEY, concurrentBytes)
  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "stale",
    state: previous,
  })
  assert.equal(storage.raw(WORKSPACE_STORAGE_KEY), concurrentBytes)

  assert.deepEqual(store.readValidatedState(), { status: "valid", state: previous })
  assert.deepEqual(store.replaceValidated(replacement), { replaced: true, state: replacement })
  assert.deepEqual(store.replaceValidated(previous), { replaced: true, state: previous })
  assert.equal(storage.raw(WORKSPACE_STORAGE_KEY), compact)
})

test("workspace rollback status distinguishes proven write-then-throw recovery from throw-before failure", () => {
  const previous = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  const replacement = {
    version: 1,
    shelf: { "Paper-02": ["theory_evidence"] },
    personalReading: {},
    selectedPaperId: "Paper-02",
  }
  for (const [rollbackPhase, expectedStatus] of [
    ["after", "persistence_failed"],
    ["before", "rollback_failed"],
  ]) {
    const previousRaw = JSON.stringify(previous)
    const bytes = new Map([[WORKSPACE_STORAGE_KEY, previousRaw]])
    let writeCount = 0
    const storage = {
      getItem(key) { return bytes.has(key) ? bytes.get(key) : null },
      setItem(key, value) {
        writeCount += 1
        if (writeCount === 1) {
          bytes.set(key, `${String(value)} `)
          throw new Error("forward write-then-throw")
        }
        if (rollbackPhase === "before") throw new Error("rollback throw-before")
        bytes.set(key, String(value))
        throw new Error("rollback write-then-throw")
      },
      removeItem(key) { bytes.delete(key) },
    }
    const store = createWorkspaceStore(storage)

    assert.deepEqual(store.replaceValidated(replacement), {
      replaced: false,
      status: expectedStatus,
      state: previous,
    }, rollbackPhase)
    assert.deepEqual(store.read(), previous, rollbackPhase)
    assert.equal(
      bytes.get(WORKSPACE_STORAGE_KEY),
      rollbackPhase === "after" ? previousRaw : `${JSON.stringify(replacement)} `,
      rollbackPhase,
    )
  }
})
