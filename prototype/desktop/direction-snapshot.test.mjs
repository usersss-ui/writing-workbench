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
