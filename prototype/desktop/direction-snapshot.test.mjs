import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { defaultDirectionSelection } from "./papers-data.mjs"

const desktopRoot = path.dirname(fileURLToPath(import.meta.url))

function fakeStorage(initial = new Map()) {
  return {
    getItem(key) { return initial.has(key) ? initial.get(key) : null },
    setItem(key, value) { initial.set(key, value) },
    removeItem(key) { initial.delete(key) },
    raw(key) { return initial.get(key) },
  }
}

test("方向快照严格保存十个有效轴并能跨页往返读取", async () => {
  const module = await import("./direction-snapshot.mjs")
  const storage = fakeStorage()
  const store = module.createDirectionSnapshotStore(storage)
  const snapshot = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T07:00:00.000Z",
  })

  assert.deepEqual(Object.keys(snapshot), ["version", "project_id", "saved_at", "axes"])
  assert.deepEqual(Object.keys(snapshot.axes), Object.keys(module.DIRECTION_AXIS_VALUES))
  assert.equal(Object.values(snapshot.axes).flat().length, 6)
  assert.deepEqual(snapshot.axes.feedback, [])
  assert.deepEqual(snapshot.axes.guarantee, [])
  assert.equal(store.save(snapshot), true)
  assert.deepEqual(store.read(), snapshot)

  const reread = store.read()
  reread.axes.problem.push("在线优化")
  assert.deepEqual(store.read().axes.problem, ["分布式优化"])
  assert.equal(JSON.parse(storage.raw(module.DIRECTION_STORAGE_KEY)).project_id, "P02")
})

test("方向快照拒绝缺轴、未知值、重复值、空选择和虚假写入成功", async () => {
  const module = await import("./direction-snapshot.mjs")
  const valid = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T07:00:00.000Z",
  })
  const invalidSnapshots = [
    { ...valid, version: 2 },
    { ...valid, extra: true },
    { ...valid, axes: { ...valid.axes, topology: undefined } },
    { ...valid, axes: { ...valid.axes, topology: ["未知拓扑"] } },
    { ...valid, axes: { ...valid.axes, topology: ["时变拓扑", "时变拓扑"] } },
    { ...valid, axes: Object.fromEntries(Object.keys(valid.axes).map((axis) => [axis, []])) },
    { ...valid, saved_at: "not-a-date" },
  ]

  for (const snapshot of invalidSnapshots) {
    const storage = fakeStorage(new Map([[module.DIRECTION_STORAGE_KEY, JSON.stringify(snapshot)]]))
    assert.equal(module.createDirectionSnapshotStore(storage).read(), null)
  }
  assert.throws(
    () => module.createDirectionSnapshot({ ...defaultDirectionSelection, topology: ["未知拓扑"] }),
    /包含无效选项/u,
  )

  const blockedStorage = { getItem() { return null }, setItem() { throw new Error("blocked") } }
  assert.equal(module.createDirectionSnapshotStore(blockedStorage).save(valid), false)
})

test("方向快照白名单与页面中的十个维度保持一致", async () => {
  const module = await import("./direction-snapshot.mjs")
  const html = await readFile(path.join(desktopRoot, "directions.html"), "utf8")
  const actual = Object.fromEntries(
    [...html.matchAll(/<fieldset class="filter-group" data-axis="([^"]+)">([\s\S]*?)<\/fieldset>/gu)]
      .map(([, axis, body]) => [axis, [...body.matchAll(/data-value="([^"]+)"/gu)].map((match) => match[1])]),
  )

  assert.deepEqual(actual, Object.fromEntries(
    Object.entries(module.DIRECTION_AXIS_VALUES).map(([axis, values]) => [axis, [...values]]),
  ))
})

test("两个保存入口共用显式保存动作，成功展示时间与轴且空选择不覆盖旧快照", async () => {
  const module = await import("./direction-snapshot.mjs")
  const storage = fakeStorage()
  const store = module.createDirectionSnapshotStore(storage)
  const rendered = []
  const notices = []
  const savedTimes = ["2026-08-29T08:00:00.000Z", "2026-08-29T09:00:00.000Z"]
  let selection = defaultDirectionSelection
  const controller = module.createDirectionSaveController({
    store,
    getSelection: () => selection,
    renderSaved: (snapshot) => rendered.push(snapshot),
    notify: (message) => notices.push(message),
    now: () => savedTimes.shift(),
  })
  const handlers = []
  const buttons = [0, 1].map(() => ({
    addEventListener(type, handler) {
      assert.equal(type, "click")
      handlers.push(handler)
    },
  }))

  assert.equal(module.wireDirectionSaveButtons(buttons, controller.save), 2)
  assert.equal(handlers[0], handlers[1])
  assert.equal(handlers[0](), true)
  assert.equal(rendered.at(-1).saved_at, "2026-08-29T08:00:00.000Z")
  assert.deepEqual(rendered.at(-1).axes.problem, ["分布式优化"])

  selection = { ...defaultDirectionSelection, feedback: ["零阶反馈"] }
  assert.equal(handlers[1](), true)
  assert.equal(store.read().saved_at, "2026-08-29T09:00:00.000Z")
  assert.deepEqual(store.read().axes.feedback, ["零阶反馈"])

  const beforeEmptySave = storage.raw(module.DIRECTION_STORAGE_KEY)
  selection = {}
  assert.equal(handlers[0](), false)
  assert.equal(storage.raw(module.DIRECTION_STORAGE_KEY), beforeEmptySave)
  assert.match(notices.at(-1), /请先选择研究条件/u)
})

test("方向快照拒绝自定义原型、symbol、不可枚举字段和访问器", async () => {
  const module = await import("./direction-snapshot.mjs")
  const valid = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T10:00:00.000Z",
  })
  const customPrototype = structuredClone(valid)
  Object.setPrototypeOf(customPrototype, { inherited: true })
  const symbolField = structuredClone(valid)
  symbolField[Symbol("hidden")] = true
  const nonEnumerable = structuredClone(valid)
  Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false })
  const accessor = structuredClone(valid)
  Object.defineProperty(accessor, "version", { enumerable: true, get: () => 1 })

  for (const candidate of [customPrototype, symbolField, nonEnumerable, accessor]) {
    assert.equal(module.isValidDirectionSnapshot(candidate), false)
  }
})

test("方向 owner strict reader 区分 valid、missing、invalid 与 unavailable 并返回克隆", async () => {
  const module = await import("./direction-snapshot.mjs")
  const snapshot = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T11:00:00.000Z",
  })

  assert.deepEqual(module.createDirectionSnapshotStore(fakeStorage()).readValidatedState(), {
    status: "missing",
    state: null,
  })

  const validStore = module.createDirectionSnapshotStore(fakeStorage(new Map([
    [module.DIRECTION_STORAGE_KEY, JSON.stringify(snapshot)],
  ])))
  const inspected = validStore.readValidatedState()
  assert.deepEqual(inspected, { status: "valid", state: snapshot })
  inspected.state.axes.problem.push("在线优化")
  assert.deepEqual(validStore.readValidatedState(), { status: "valid", state: snapshot })

  assert.deepEqual(module.createDirectionSnapshotStore(fakeStorage(new Map([
    [module.DIRECTION_STORAGE_KEY, "{"],
  ]))).readValidatedState(), { status: "invalid", state: null })
  assert.deepEqual(module.createDirectionSnapshotStore({
    getItem() { throw new Error("denied") },
  }).readValidatedState(), { status: "unavailable", state: null })
})

test("方向 owner replacement 验证克隆、持久化 readback、null 删除与失败回滚", async () => {
  const module = await import("./direction-snapshot.mjs")
  const previous = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T12:00:00.000Z",
  })
  const replacement = module.createDirectionSnapshot({
    ...defaultDirectionSelection,
    feedback: ["零阶反馈"],
  }, { savedAt: "2026-08-29T13:00:00.000Z" })

  const storage = fakeStorage(new Map([[module.DIRECTION_STORAGE_KEY, JSON.stringify(previous)]]))
  const store = module.createDirectionSnapshotStore(storage)
  const replaced = store.replaceValidated(replacement)
  assert.deepEqual(replaced, { replaced: true, state: replacement })
  replacement.axes.feedback.push("一阶反馈")
  replaced.state.axes.feedback.length = 0
  assert.deepEqual(store.readValidatedState().state.axes.feedback, ["零阶反馈"])

  assert.deepEqual(store.replaceValidated(null), { replaced: true, state: null })
  assert.equal(storage.raw(module.DIRECTION_STORAGE_KEY), undefined)

  const durable = new Map([[module.DIRECTION_STORAGE_KEY, JSON.stringify(previous)]])
  let failReplacement = true
  const blockedStorage = {
    getItem(key) { return durable.has(key) ? durable.get(key) : null },
    setItem(key, value) {
      if (failReplacement) {
        failReplacement = false
        throw new Error("quota")
      }
      durable.set(key, String(value))
    },
    removeItem(key) { durable.delete(key) },
  }
  const blocked = module.createDirectionSnapshotStore(blockedStorage)
  assert.deepEqual(blocked.replaceValidated(module.createDirectionSnapshot({
    ...defaultDirectionSelection,
    privacy: ["隐私保护"],
  }, { savedAt: "2026-08-29T14:00:00.000Z" })), {
    replaced: false,
    status: "persistence_failed",
    state: previous,
  })
  assert.equal(durable.get(module.DIRECTION_STORAGE_KEY), JSON.stringify(previous))
  assert.throws(() => blocked.replaceValidated({ version: 1 }), /方向快照/u)
})

test("方向 replacement 对创建时的 exact raw baseline 做 CAS，strict read 与成功写入都会刷新 baseline", async () => {
  const module = await import("./direction-snapshot.mjs")
  const previous = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T15:00:00.000Z",
  })
  const replacement = module.createDirectionSnapshot({
    ...defaultDirectionSelection,
    communication: ["每轮通信"],
  }, { savedAt: "2026-08-29T15:01:00.000Z" })
  const compact = JSON.stringify(previous)
  const concurrentBytes = JSON.stringify(previous, null, 2)
  const storage = fakeStorage(new Map([[module.DIRECTION_STORAGE_KEY, compact]]))
  const store = module.createDirectionSnapshotStore(storage)

  storage.setItem(module.DIRECTION_STORAGE_KEY, concurrentBytes)
  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "stale",
    state: previous,
  })
  assert.equal(storage.raw(module.DIRECTION_STORAGE_KEY), concurrentBytes)

  assert.deepEqual(store.readValidatedState(), { status: "valid", state: previous })
  assert.deepEqual(store.replaceValidated(replacement), { replaced: true, state: replacement })
  assert.deepEqual(store.replaceValidated(previous), { replaced: true, state: previous })
  assert.equal(storage.raw(module.DIRECTION_STORAGE_KEY), compact)
})

test("方向 replacement 无法恢复并精确读回 pre-bytes 时报告 rollback_failed", async () => {
  const module = await import("./direction-snapshot.mjs")
  const previous = module.createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T16:00:00.000Z",
  })
  const replacement = module.createDirectionSnapshot({
    ...defaultDirectionSelection,
    privacy: ["隐私保护"],
  }, { savedAt: "2026-08-29T16:01:00.000Z" })
  const previousRaw = JSON.stringify(previous)
  const bytes = new Map([[module.DIRECTION_STORAGE_KEY, previousRaw]])
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
  const store = module.createDirectionSnapshotStore(storage)

  assert.deepEqual(store.replaceValidated(replacement), {
    replaced: false,
    status: "rollback_failed",
    state: previous,
  })
  assert.equal(bytes.get(module.DIRECTION_STORAGE_KEY), `${JSON.stringify(replacement)} `)
})
