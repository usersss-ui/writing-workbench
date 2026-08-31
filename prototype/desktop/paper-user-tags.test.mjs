import test from "node:test"
import assert from "node:assert/strict"

import {
  USER_TAG_STORAGE_KEY,
  createUserTagStore,
  isValidUserTagState,
} from "./paper-user-tags.mjs"

function fakeStorage(initial = new Map()) {
  const data = initial
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: (key) => data.get(key),
  }
}

test("stores personal tags under an isolated key with NFKC normalization and first-spelling dedupe", () => {
  const storage = fakeStorage(new Map([[
    "research-console.paper-library.v1",
    JSON.stringify({ version: 1, shelf: {}, personalReading: {}, selectedPaperId: null }),
  ]]))
  const store = createUserTagStore(storage)

  assert.deepEqual(store.add("Zhao24-DFL", "  Ｂａｓｅｌｉｎｅ  "), {
    added: true,
    label: "Baseline",
    state: { version: 1, papers: { "Zhao24-DFL": ["Baseline"] } },
  })
  assert.deepEqual(store.add("Zhao24-DFL", "baseline"), {
    added: false,
    label: "Baseline",
    state: { version: 1, papers: { "Zhao24-DFL": ["Baseline"] } },
  })
  assert.equal(JSON.parse(storage.raw(USER_TAG_STORAGE_KEY)).papers["Zhao24-DFL"][0], "Baseline")
  assert.match(storage.raw("research-console.paper-library.v1"), /selectedPaperId/u)
})

test("adds, lists, removes, clears, and clones personal tag state", () => {
  const storage = fakeStorage()
  const store = createUserTagStore(storage)
  store.add("Paper-01", "必读")
  store.add("Paper-01", "可作基线")
  const tags = store.tagsFor("Paper-01")
  tags.push("泄漏")
  const snapshot = store.read()
  snapshot.papers["Paper-01"].push("泄漏")

  assert.deepEqual(store.tagsFor("Paper-01"), ["必读", "可作基线"])
  assert.deepEqual(store.remove("Paper-01", "必读"), {
    removed: true,
    state: { version: 1, papers: { "Paper-01": ["可作基线"] } },
  })
  assert.deepEqual(store.remove("Paper-01", "不存在"), {
    removed: false,
    state: { version: 1, papers: { "Paper-01": ["可作基线"] } },
  })
  assert.deepEqual(store.clear(), { version: 1, papers: {} })
  assert.equal(storage.raw(USER_TAG_STORAGE_KEY), undefined)
})

test("rejects invalid paper IDs and labels without changing prior state", () => {
  const store = createUserTagStore(fakeStorage())
  store.add("Paper-01", "保留")
  const before = store.read()
  for (const [paperId, label, expected] of [
    ["bad", "标签", /论文 ID 格式无效/u],
    ["../escape", "标签", /论文 ID 格式无效/u],
    ["Paper-01", "", /标签不能为空/u],
    ["Paper-01", "a/b", /路径分隔符/u],
    ["Paper-01", "a\\b", /路径分隔符/u],
    ["Paper-01", "换行\n标签", /控制字符或换行/u],
    ["Paper-01", "a".repeat(25), /24 个 Unicode 码点/u],
  ]) assert.throws(() => store.add(paperId, label), expected)
  assert.deepEqual(store.read(), before)
})

test("rejects Unicode line and paragraph separators in direct labels", () => {
  const store = createUserTagStore(fakeStorage())
  store.add("Paper-01", "保留")
  const before = store.read()

  for (const separator of ["\u2028", "\u2029"]) {
    assert.throws(
      () => store.add("Paper-01", `非法${separator}标签`),
      /控制字符或换行/u,
    )
  }

  assert.deepEqual(store.read(), before)
})

test("counts Unicode code points and enforces per-paper and whole-library assignment limits", () => {
  const perPaper = createUserTagStore(fakeStorage())
  perPaper.add("Paper-01", "😀".repeat(24))
  for (let index = 1; index < 20; index += 1) perPaper.add("Paper-01", `标签${index}`)
  assert.throws(() => perPaper.add("Paper-01", "第21个"), /每篇论文最多 20 个/u)

  const papers = {}
  for (let paper = 0; paper < 25; paper += 1) {
    papers[`Paper-${paper + 1}`] = Array.from({ length: 20 }, (_, tag) => `T${paper}-${tag}`)
  }
  const storage = fakeStorage(new Map([[USER_TAG_STORAGE_KEY, JSON.stringify({ version: 1, papers })]]))
  const wholeLibrary = createUserTagStore(storage)
  assert.throws(() => wholeLibrary.add("Paper-26", "overflow"), /整个论文库最多 500 个/u)
})

test("resets malformed persisted data and remains usable when storage throws", () => {
  for (const raw of [
    "{",
    JSON.stringify({ version: 2, papers: {} }),
    JSON.stringify({ version: 1, papers: [], extra: true }),
    JSON.stringify({ version: 1, papers: { "../escape": ["标签"] } }),
    JSON.stringify({ version: 1, papers: { "Paper-01": ["重复", "重复"] } }),
    JSON.stringify({ version: 1, papers: { "Paper-01": ["a/b"] } }),
  ]) {
    const store = createUserTagStore(fakeStorage(new Map([[USER_TAG_STORAGE_KEY, raw]])))
    assert.deepEqual(store.read(), { version: 1, papers: {} })
  }

  const denied = {
    getItem() { throw new Error("denied") },
    setItem() { throw new Error("quota") },
    removeItem() { throw new Error("denied") },
  }
  const store = createUserTagStore(denied)
  store.add("Paper-01", "离线可用")
  assert.deepEqual(store.tagsFor("Paper-01"), ["离线可用"])
  assert.deepEqual(store.clear(), { version: 1, papers: {} })
})

test("exports only the strict personal-tag document", () => {
  const store = createUserTagStore(fakeStorage())
  store.add("Paper-01", "必读")
  assert.deepEqual(JSON.parse(store.exportJson()), {
    schema: "research-console.paper-user-tags",
    version: 1,
    papers: { "Paper-01": ["必读"] },
  })
  assert.doesNotMatch(store.exportJson(), /relative_path|facets|authors|notes/u)
})

test("merge import dedupes, skips valid unknown papers, and reports exact counts", () => {
  const storage = fakeStorage()
  const store = createUserTagStore(storage)
  store.add("Paper-01", "必读")
  const result = store.importJson(JSON.stringify({
    schema: "research-console.paper-user-tags",
    version: 1,
    papers: {
      "Paper-01": ["必读", "可作基线", "可作基线"],
      "Paper-Unknown": ["未知论文标签"],
    },
  }), { mode: "merge", knownPaperIds: new Set(["Paper-01", "Paper-02"]) })

  assert.deepEqual(result, {
    state: { version: 1, papers: { "Paper-01": ["必读", "可作基线"] } },
    addedCount: 1,
    duplicateCount: 2,
    unmatchedPaperCount: 1,
    unmatchedPaperIds: ["Paper-Unknown"],
  })
  assert.deepEqual(JSON.parse(storage.raw(USER_TAG_STORAGE_KEY)).papers["Paper-01"], ["必读", "可作基线"])
})

test("any import structure or label error rejects the whole document without persisting", () => {
  const invalidDocuments = [
    { schema: "wrong", version: 1, papers: {} },
    { schema: "research-console.paper-user-tags", version: 2, papers: {} },
    { schema: "research-console.paper-user-tags", version: 1, papers: {}, extra: true },
    { schema: "research-console.paper-user-tags", version: 1, papers: [] },
    { schema: "research-console.paper-user-tags", version: 1, papers: { bad: ["标签"] } },
    { schema: "research-console.paper-user-tags", version: 1, papers: { "Paper-01": "标签" } },
    { schema: "research-console.paper-user-tags", version: 1, papers: { "Paper-01": ["a/b"] } },
  ]
  for (const document of invalidDocuments) {
    const storage = fakeStorage()
    const store = createUserTagStore(storage)
    store.add("Paper-01", "保留")
    const before = storage.raw(USER_TAG_STORAGE_KEY)
    assert.throws(
      () => store.importJson(JSON.stringify(document), { mode: "merge", knownPaperIds: ["Paper-01"] }),
      /个人标签导入文件/u,
    )
    assert.equal(storage.raw(USER_TAG_STORAGE_KEY), before)
    assert.deepEqual(store.tagsFor("Paper-01"), ["保留"])
  }
  assert.throws(
    () => createUserTagStore(fakeStorage()).importJson("{", { mode: "merge", knownPaperIds: [] }),
    /个人标签导入文件不是有效 JSON/u,
  )
  assert.throws(
    () => createUserTagStore(fakeStorage()).importJson("{}", { mode: "replace", knownPaperIds: [] }),
    /只支持 merge/u,
  )
})

test("Unicode line separators reject merge imports atomically", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const storage = fakeStorage()
    const store = createUserTagStore(storage)
    store.add("Paper-01", "保留")
    const beforeState = store.read()
    const beforeBytes = storage.raw(USER_TAG_STORAGE_KEY)
    const document = {
      schema: "research-console.paper-user-tags",
      version: 1,
      papers: {
        "Paper-01": ["可作基线"],
        "Paper-02": [`非法${separator}标签`],
      },
    }

    assert.throws(
      () => store.importJson(JSON.stringify(document), {
        mode: "merge",
        knownPaperIds: ["Paper-01", "Paper-02"],
      }),
      /个人标签导入文件包含无效标签/u,
    )
    assert.deepEqual(store.read(), beforeState)
    assert.equal(storage.raw(USER_TAG_STORAGE_KEY), beforeBytes)
  }
})

test("personal-tag owner exposes a strict validator and four-state cloned reader", () => {
  const valid = { version: 1, papers: { "Paper-01": ["必读", "可作基线"] } }
  assert.equal(isValidUserTagState(valid), true)
  assert.equal(isValidUserTagState({ ...valid, papers: { "Paper-01": ["必读", "必读"] } }), false)
  assert.equal(isValidUserTagState({ ...valid, extra: true }), false)

  assert.deepEqual(createUserTagStore(fakeStorage()).readValidatedState(), {
    status: "missing",
    state: { version: 1, papers: {} },
  })
  const validStore = createUserTagStore(fakeStorage(new Map([[USER_TAG_STORAGE_KEY, JSON.stringify(valid)]])))
  const inspected = validStore.readValidatedState()
  assert.deepEqual(inspected, { status: "valid", state: valid })
  inspected.state.papers["Paper-01"].push("泄漏")
  assert.deepEqual(validStore.readValidatedState(), { status: "valid", state: valid })
  assert.deepEqual(createUserTagStore(fakeStorage(new Map([[USER_TAG_STORAGE_KEY, "{"]]))).readValidatedState(), {
    status: "invalid",
    state: { version: 1, papers: {} },
  })
  assert.deepEqual(createUserTagStore({ getItem() { throw new Error("denied") } }).readValidatedState(), {
    status: "unavailable",
    state: { version: 1, papers: {} },
  })
})

test("personal-tag replaceValidated clones, proves readback, and restores prior memory plus bytes", () => {
  const previous = { version: 1, papers: { "Paper-01": ["保留"] } }
  const replacement = { version: 1, papers: { "Paper-02": ["必读"] } }
  const storage = fakeStorage(new Map([[USER_TAG_STORAGE_KEY, JSON.stringify(previous)]]))
  const store = createUserTagStore(storage)
  const result = store.replaceValidated(replacement)
  assert.deepEqual(result, { replaced: true, state: replacement })
  replacement.papers["Paper-02"].push("泄漏")
  result.state.papers["Paper-02"].length = 0
  assert.deepEqual(store.read(), { version: 1, papers: { "Paper-02": ["必读"] } })

  const bytes = new Map([[USER_TAG_STORAGE_KEY, JSON.stringify(previous)]])
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
  const blocked = createUserTagStore(blockedStorage)
  assert.deepEqual(blocked.replaceValidated(replacement), {
    replaced: false,
    status: "persistence_failed",
    state: previous,
  })
  assert.deepEqual(blocked.read(), previous)
  assert.equal(bytes.get(USER_TAG_STORAGE_KEY), JSON.stringify(previous))
  assert.throws(() => blocked.replaceValidated({ version: 1 }), /个人标签状态/u)
})

test("personal-tag replacement refuses an exact-raw baseline change and supports same-store reverse replacement", () => {
  const previous = { version: 1, papers: { "Paper-01": ["保留"] } }
  const replacement = { version: 1, papers: { "Paper-02": ["必读"] } }
  const compact = JSON.stringify(previous)
  const concurrentBytes = JSON.stringify(previous, null, 2)
  const storage = fakeStorage(new Map([[USER_TAG_STORAGE_KEY, compact]]))
  const store = createUserTagStore(storage)

  storage.setItem(USER_TAG_STORAGE_KEY, concurrentBytes)
  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "stale",
    state: previous,
  })
  assert.equal(storage.raw(USER_TAG_STORAGE_KEY), concurrentBytes)

  assert.deepEqual(store.readValidatedState(), { status: "valid", state: previous })
  assert.deepEqual(store.replaceValidated(replacement), { replaced: true, state: replacement })
  assert.deepEqual(store.replaceValidated(previous), { replaced: true, state: previous })
  assert.equal(storage.raw(USER_TAG_STORAGE_KEY), compact)
})

test("personal-tag recovery without an exact pre-bytes readback reports rollback_failed even if bytes happen to match", () => {
  const previous = { version: 1, papers: { "Paper-01": ["保留"] } }
  const replacement = { version: 1, papers: { "Paper-02": ["必读"] } }
  const previousRaw = JSON.stringify(previous)
  const bytes = new Map([[USER_TAG_STORAGE_KEY, previousRaw]])
  let writeCount = 0
  let denyRecoveryProof = false
  const storage = {
    getItem(key) {
      if (denyRecoveryProof) throw new Error("readback denied")
      return bytes.has(key) ? bytes.get(key) : null
    },
    setItem(key, value) {
      writeCount += 1
      if (writeCount === 1) {
        bytes.set(key, `${String(value)} `)
        throw new Error("forward write-then-throw")
      }
      bytes.set(key, String(value))
      denyRecoveryProof = true
      throw new Error("rollback write-then-throw")
    },
    removeItem(key) { bytes.delete(key) },
  }
  const store = createUserTagStore(storage)

  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "rollback_failed",
    state: previous,
  })
  assert.deepEqual(store.read(), previous)
  assert.equal(bytes.get(USER_TAG_STORAGE_KEY), previousRaw)
})
