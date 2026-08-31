import assert from "node:assert/strict"
import test from "node:test"

import { createDirectionSnapshot } from "./direction-snapshot.mjs"
import { defaultDirectionSelection } from "./papers-data.mjs"

function fakeStorage(initial = new Map()) {
  let failSetKey = null
  return {
    get length() { return initial.size },
    key(index) { return [...initial.keys()][index] ?? null },
    getItem(key) { return initial.has(key) ? initial.get(key) : null },
    setItem(key, value) {
      if (failSetKey === key) throw new Error("blocked")
      initial.set(key, String(value))
    },
    removeItem(key) { initial.delete(key) },
    failNextSet(key) { failSetKey = key },
    allowSets() { failSetKey = null },
    raw(key) { return initial.get(key) },
    map: initial,
  }
}

function directionSnapshot(savedAt = "2026-08-29T07:00:00.000Z") {
  return createDirectionSnapshot(defaultDirectionSelection, { savedAt })
}

function workspaceState() {
  return {
    version: 1,
    shelf: {
      "Liu24-LCT": ["algorithm_mechanism", "theory_evidence"],
      "Zhao24-DFL": ["related_work"],
    },
    personalReading: { "Liu24-LCT": "read" },
    selectedPaperId: "Liu24-LCT",
  }
}

function paperIndex(version = 3) {
  return {
    version,
    facet_schema: { version: version === 3 ? 2 : version === 2 ? 1 : 0 },
    papers: [
      {
        paper_id: "Liu24-LCT",
        title_zh: "时变非平衡网络约束优化",
        title_en: "Distributed Constrained Optimization",
        title_original: "Distributed Constrained Optimization",
        authors: ["Liu H", "Yu W"],
        year: 2024,
        source_status: "verified",
        evidence_status: "partial",
        reproduction_status: "results_recorded",
        relative_path: "private/source.md",
        source_terms: ["私人标签"],
        note_body: "不应进入快照",
      },
      {
        paper_id: "Zhao24-DFL",
        title_zh: null,
        title_en: null,
        title_original: "Decentralized Online Bandit Federated Learning",
        authors: ["Zhao Z"],
        year: 2024,
        source_status: "located",
        evidence_status: "none",
        reproduction_status: "code_unrun",
      },
    ],
  }
}

function readyPreview(module, version = 3) {
  return module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(),
    workspaceState: workspaceState(),
    paperIndex: paperIndex(version),
  })
}

test("任务输入只保留方向、P02 用途和最小书目信息，wire v3/v2 可用而 v1 拒绝", async () => {
  const module = await import("./agent-task-input.mjs")

  for (const version of [3, 2]) {
    const preview = readyPreview(module, version)
    assert.equal(preview.ready, true)
    assert.equal(preview.status, "ready")
    assert.deepEqual(preview.papers.map((paper) => paper.paper_id), ["Liu24-LCT", "Zhao24-DFL"])
    assert.deepEqual(Object.keys(preview.papers[0]), [
      "paper_id", "shelf_roles", "title_zh", "title_en", "authors", "year",
      "source_status", "evidence_status", "reproduction_status",
    ])
    assert.deepEqual(preview.note_fragment_refs, [])
    assert.doesNotMatch(JSON.stringify(preview), /relative_path|source_terms|note_body|私人标签/u)
  }

  const rejected = readyPreview(module, 1)
  assert.equal(rejected.ready, false)
  assert.equal(rejected.status, "index_error")

  const mismatchedSchema = paperIndex(3)
  mismatchedSchema.facet_schema.version = 1
  const mismatched = module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(),
    workspaceState: workspaceState(),
    paperIndex: mismatchedSchema,
  })
  assert.equal(mismatched.ready, false)
  assert.equal(mismatched.status, "index_error")
})

test("缺少方向、用途架、论文记录或安全元数据都会阻止固定快照", async () => {
  const module = await import("./agent-task-input.mjs")
  const noDirection = module.buildTaskInputPreview({ workspaceState: workspaceState(), paperIndex: paperIndex() })
  const noShelf = module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(),
    workspaceState: { version: 1, shelf: {}, personalReading: {}, selectedPaperId: null },
    paperIndex: paperIndex(),
  })
  const missing = module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(),
    workspaceState: workspaceState(),
    paperIndex: { ...paperIndex(), papers: [paperIndex().papers[0]] },
  })
  const unsafePath = ["/", "Users", "/person/private-note.md"].join("")
  const unsafeSecret = ["api", "_key", "=fixture-value"].join("")
  const unsafeIndex = paperIndex()
  unsafeIndex.papers[0] = { ...unsafeIndex.papers[0], title_zh: unsafePath, authors: [unsafeSecret] }
  const unsafe = module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(), workspaceState: workspaceState(), paperIndex: unsafeIndex,
  })

  assert.equal(noDirection.status, "direction_missing")
  assert.equal(noShelf.status, "shelf_missing")
  assert.equal(missing.status, "partial")
  assert.deepEqual(missing.missing_paper_ids, ["Zhao24-DFL"])
  assert.equal(unsafe.status, "unsafe_metadata")
  for (const preview of [noDirection, noShelf, missing, unsafe]) {
    assert.equal(preview.ready, false)
    assert.throws(() => module.createTaskInputSnapshot(preview), /尚未就绪/u)
  }
})

test("同一毫秒创建的默认快照获得唯一 ID 且历史只追加不覆盖", async () => {
  const module = await import("./agent-task-input.mjs")
  const preview = readyPreview(module)
  const createdAt = "2026-08-29T08:00:00.000Z"
  const first = module.createTaskInputSnapshot(preview, { createdAt })
  const second = module.createTaskInputSnapshot(preview, { createdAt })
  assert.notEqual(first.snapshot_id, second.snapshot_id)

  const storage = fakeStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  assert.equal(store.append(first), true)
  assert.equal(store.append(second), true)
  assert.equal(store.append(first), false)
  assert.deepEqual(store.readAll().map((snapshot) => snapshot.snapshot_id), [first.snapshot_id, second.snapshot_id])
  assert.equal(store.readCurrent().snapshot_id, second.snapshot_id)
  assert.equal(storage.raw(module.TASK_INPUT_STORAGE_KEY) !== undefined, true)
  assert.equal(storage.raw(`${module.TASK_INPUT_STORAGE_KEY}.current`), second.snapshot_id)
  assert.equal(storage.raw(`${module.TASK_INPUT_STORAGE_KEY}.snapshot.${first.snapshot_id}`) !== undefined, true)
  assert.equal([...storage.map.keys()].some((key) => key.includes(".pending.")), false)

  const changedPreview = readyPreview(module)
  changedPreview.papers[0].title_zh = "来源后来发生变化"
  const third = module.createTaskInputSnapshot(changedPreview, {
    createdAt: "2026-08-29T09:00:00.000Z",
    snapshotNonce: "AAAAAAAAAAAAAAAA",
  })
  assert.equal(store.append(third), true)
  assert.equal(store.readAll()[0].papers[0].title_zh, "时变非平衡网络约束优化")
})

test("聚合 root 写入失败时已提交的独立快照与 current 仍被诚实报告为成功", async () => {
  const module = await import("./agent-task-input.mjs")
  const snapshot = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T09:30:00.000Z",
    snapshotNonce: "CCCCCCCCCCCCCCCC",
  })
  const values = new Map()
  const storage = {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) {
      if (key === module.TASK_INPUT_STORAGE_KEY) throw new Error("root quota")
      values.set(key, String(value))
    },
    removeItem(key) { values.delete(key) },
  }
  const store = module.createTaskInputSnapshotStore(storage)

  assert.equal(store.append(snapshot), true)
  assert.equal(store.readCurrent().snapshot_id, snapshot.snapshot_id)
  assert.deepEqual(store.readAll().map((item) => item.snapshot_id), [snapshot.snapshot_id])
})

test("current 写入失败会撤掉未提交 pending 并保持原有历史", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = fakeStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const first = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T09:40:00.000Z", snapshotNonce: "DDDDDDDDDDDDDDDD",
  })
  const second = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T09:41:00.000Z", snapshotNonce: "EEEEEEEEEEEEEEEE",
  })
  assert.equal(store.append(first), true)
  storage.failNextSet(`${module.TASK_INPUT_STORAGE_KEY}.current`)

  assert.equal(store.append(second), false)
  storage.allowSets()
  assert.equal(store.readCurrent().snapshot_id, first.snapshot_id)
  assert.deepEqual(store.readAll().map((item) => item.snapshot_id), [first.snapshot_id])
  assert.equal([...storage.map.keys()].some((key) => key.includes(second.snapshot_id)), false)
})

test("损坏 root、current 或独立 snapshot 会使完整事务失效并拒绝覆盖", async () => {
  const module = await import("./agent-task-input.mjs")
  const snapshot = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T08:00:00.000Z",
    snapshotNonce: "AAAAAAAAAAAAAAAA",
  })
  const corruptStores = [
    new Map([[module.TASK_INPUT_STORAGE_KEY, "{broken"]]),
    new Map([
      [module.TASK_INPUT_STORAGE_KEY, JSON.stringify({ version: 1, current_snapshot_id: null, snapshots: [] })],
      [`${module.TASK_INPUT_STORAGE_KEY}.current`, "UNKNOWN"],
    ]),
    new Map([
      [module.TASK_INPUT_STORAGE_KEY, JSON.stringify({ version: 1, current_snapshot_id: null, snapshots: [] })],
      [`${module.TASK_INPUT_STORAGE_KEY}.snapshot.${snapshot.snapshot_id}`, "{broken"],
    ]),
  ]

  for (const initial of corruptStores) {
    const storage = fakeStorage(initial)
    const before = new Map(initial)
    const store = module.createTaskInputSnapshotStore(storage)
    assert.deepEqual(store.readAll(), [])
    assert.equal(store.append(snapshot), false)
    assert.deepEqual(storage.map, before)
  }
})

test("选择历史快照会先重读跨窗口状态，未知或写失败不会改变当前指针", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = fakeStorage()
  const firstStore = module.createTaskInputSnapshotStore(storage)
  const secondStore = module.createTaskInputSnapshotStore(storage)
  const first = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T08:00:00.000Z", snapshotNonce: "AAAAAAAAAAAAAAAA",
  })
  const second = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T09:00:00.000Z", snapshotNonce: "BBBBBBBBBBBBBBBB",
  })
  assert.equal(firstStore.append(first), true)
  assert.equal(secondStore.append(second), true)

  assert.equal(firstStore.selectCurrent(first.snapshot_id), true)
  assert.equal(firstStore.readCurrent().snapshot_id, first.snapshot_id)
  assert.equal(firstStore.selectCurrent("UNKNOWN"), false)
  assert.equal(firstStore.readCurrent().snapshot_id, first.snapshot_id)

  storage.failNextSet(`${module.TASK_INPUT_STORAGE_KEY}.current`)
  assert.equal(firstStore.selectCurrent(second.snapshot_id), false)
  storage.allowSets()
  assert.equal(firstStore.readCurrent().snapshot_id, first.snapshot_id)
})

test("固定快照严格拒绝笔记正文、路径、乱序论文和不匹配 ID", async () => {
  const module = await import("./agent-task-input.mjs")
  const preview = readyPreview(module)
  const snapshot = module.createTaskInputSnapshot(preview, {
    createdAt: "2026-08-29T08:00:00.000Z", snapshotNonce: "AAAAAAAAAAAAAAAA",
  })
  assert.equal(module.isValidTaskInputSnapshot(snapshot), true)
  assert.equal(module.isValidTaskInputSnapshot({ ...snapshot, note_fragment_refs: ["正文"] }), false)
  assert.equal(module.isValidTaskInputSnapshot({ ...snapshot, source_path: "hidden" }), false)
  assert.equal(module.isValidTaskInputSnapshot({ ...snapshot, papers: [...snapshot.papers].reverse() }), false)
  assert.equal(module.isValidTaskInputSnapshot({ ...snapshot, snapshot_id: snapshot.snapshot_id.replace("080000", "080001") }), false)
})
