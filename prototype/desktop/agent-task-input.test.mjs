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

function adversarialStorage(initial = new Map()) {
  const values = new Map(initial)
  const faults = []

  function takeFault(method, key) {
    const index = faults.findIndex((fault) => fault.method === method && fault.key === key)
    if (index < 0) return null
    const fault = faults[index]
    if (fault.skip > 0) {
      fault.skip -= 1
      return null
    }
    faults.splice(index, 1)
    return fault
  }

  function maybeThrow(fault, phase) {
    if (fault?.phase === phase) throw new Error(`${fault.method} ${phase}`)
  }

  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) {
      const fault = takeFault("getItem", key)
      maybeThrow(fault, "before")
      const value = values.get(key) ?? null
      maybeThrow(fault, "after")
      return value
    },
    setItem(key, value) {
      const fault = takeFault("setItem", key)
      maybeThrow(fault, "before")
      values.set(key, String(value))
      maybeThrow(fault, "after")
    },
    removeItem(key) {
      const fault = takeFault("removeItem", key)
      maybeThrow(fault, "before")
      values.delete(key)
      maybeThrow(fault, "after")
    },
    failOnce(method, key, phase = "before", skip = 0) {
      faults.push({ method, key, phase, skip })
    },
    raw(key) { return values.get(key) },
    values,
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

test("授权头、OAuth 令牌、客户端密钥、私钥和 URL 用户信息都会阻止任务输入", async () => {
  const module = await import("./agent-task-input.mjs")
  const forbiddenMetadata = [
    ["Author", "ization: Bear", "er fixture-token"].join(""),
    ["Author", "ization: Bas", "ic Zml4dHVyZQ=="].join(""),
    ["refresh", "_token=fixture-value"].join(""),
    ["id", "_token: fixture-value"].join(""),
    ["access", "_token=fixture-value"].join(""),
    ["client", "_secret: fixture-value"].join(""),
    ["-----BEGIN PRI", "VATE KEY-----"].join(""),
    ["https://fixture-user", ":fixture-pass@example.invalid/path"].join(""),
  ]

  for (const unsafeValue of forbiddenMetadata) {
    const index = structuredClone(paperIndex())
    index.papers[0].title_zh = unsafeValue
    const preview = module.buildTaskInputPreview({
      directionSnapshot: directionSnapshot(), workspaceState: workspaceState(), paperIndex: index,
    })
    assert.equal(preview.status, "unsafe_metadata")
    assert.equal(preview.ready, false)
    assert.equal(JSON.stringify(preview).includes(unsafeValue), false)
  }
})

test("任意授权方案、通用令牌赋值和仅用户名 URL userinfo 被拒绝但学术 token 用语保留", async () => {
  const module = await import("./agent-task-input.mjs")
  const forbiddenMetadata = [
    ["Author", "ization: Dig", "est fixture-response"].join(""),
    ["oauth", "_token=fixture-value"].join(""),
    ["to", "ken: fixture-value"].join(""),
    ["https://secret", "-token@example.invalid/path"].join(""),
  ]

  for (const unsafeValue of forbiddenMetadata) {
    const index = structuredClone(paperIndex())
    index.papers[0].title_zh = unsafeValue
    const preview = module.buildTaskInputPreview({
      directionSnapshot: directionSnapshot(), workspaceState: workspaceState(), paperIndex: index,
    })
    assert.equal(preview.status, "unsafe_metadata", unsafeValue.split(":", 1)[0])
    assert.equal(preview.ready, false)
  }

  const academicIndex = structuredClone(paperIndex())
  academicIndex.papers[0].title_zh = "Token passing methods for distributed optimization"
  const academicPreview = module.buildTaskInputPreview({
    directionSnapshot: directionSnapshot(), workspaceState: workspaceState(), paperIndex: academicIndex,
  })
  assert.equal(academicPreview.status, "ready")
  assert.equal(academicPreview.ready, true)
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

test("append 对 pending、current、committed 的 write-then-throw 与 pending 删除失败诚实返回成功", async () => {
  const module = await import("./agent-task-input.mjs")
  const scenarios = [
    { method: "setItem", suffix: "pending", phase: "after" },
    { method: "setItem", suffix: "current", phase: "after" },
    { method: "setItem", suffix: "snapshot", phase: "after" },
    { method: "setItem", suffix: "snapshot", phase: "after", readFailures: 2 },
    { method: "removeItem", suffix: "pending", phase: "before" },
  ]

  for (const [index, scenario] of scenarios.entries()) {
    const storage = adversarialStorage()
    const store = module.createTaskInputSnapshotStore(storage)
    const snapshot = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: `2026-08-29T11:0${index}:00.000Z`,
      snapshotNonce: `${String.fromCharCode(71 + index).repeat(16)}`,
    })
    const key = scenario.suffix === "current"
      ? `${module.TASK_INPUT_STORAGE_KEY}.current`
      : `${module.TASK_INPUT_STORAGE_KEY}.${scenario.suffix}.${snapshot.snapshot_id}`
    storage.failOnce(scenario.method, key, scenario.phase)
    if (scenario.readFailures) {
      storage.failOnce("getItem", key, "before", 1)
      storage.failOnce("getItem", key, "before")
    }

    assert.equal(store.append(snapshot), true, `${scenario.suffix} ${scenario.phase}`)
    assert.equal(store.readCurrent().snapshot_id, snapshot.snapshot_id)
    assert.deepEqual(store.readAll().map((item) => item.snapshot_id), [snapshot.snapshot_id])
  }
})

test("append 的 committed throw-before 不产生逻辑历史并可从 pending 重试同一 ID", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const first = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:10:00.000Z", snapshotNonce: "KKKKKKKKKKKKKKKK",
  })
  const retryable = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:11:00.000Z", snapshotNonce: "LLLLLLLLLLLLLLLL",
  })
  assert.equal(store.append(first), true)
  storage.failOnce("setItem", `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${retryable.snapshot_id}`, "before")

  assert.equal(store.append(retryable), false)
  assert.equal(store.readCurrent().snapshot_id, first.snapshot_id)
  assert.deepEqual(store.readAll().map((item) => item.snapshot_id), [first.snapshot_id])
  assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, first.snapshot_id)

  assert.equal(store.append(retryable), true)
  assert.equal(store.readCurrent().snapshot_id, retryable.snapshot_id)
})

test("append 的 current throw-before 即使 pending 删除失败也可重试同一 ID", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const first = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:20:00.000Z", snapshotNonce: "MMMMMMMMMMMMMMMM",
  })
  const retryable = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:21:00.000Z", snapshotNonce: "NNNNNNNNNNNNNNNN",
  })
  assert.equal(store.append(first), true)
  storage.failOnce("setItem", `${module.TASK_INPUT_STORAGE_KEY}.current`, "before")
  storage.failOnce("removeItem", `${module.TASK_INPUT_STORAGE_KEY}.pending.${retryable.snapshot_id}`, "before")

  assert.equal(store.append(retryable), false)
  assert.equal(store.readCurrent().snapshot_id, first.snapshot_id)
  assert.deepEqual(store.readAll().map((item) => item.snapshot_id), [first.snapshot_id])
  assert.equal(store.append(retryable), true)
  assert.equal(store.readCurrent().snapshot_id, retryable.snapshot_id)
})

test("append 无法复核 write-then-throw 的 current 时保留可恢复 pending 而不破坏旧当前项", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const first = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:25:00.000Z", snapshotNonce: "VVVVVVVVVVVVVVVV",
  })
  const retryable = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:26:00.000Z", snapshotNonce: "WWWWWWWWWWWWWWWW",
  })
  assert.equal(store.append(first), true)
  const currentKey = `${module.TASK_INPUT_STORAGE_KEY}.current`
  storage.failOnce("setItem", currentKey, "after")
  storage.failOnce("getItem", currentKey, "before", 2)
  storage.failOnce("getItem", currentKey, "before")

  assert.equal(store.append(retryable), false)
  assert.equal(store.readCurrent().snapshot_id, first.snapshot_id)
  assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, first.snapshot_id)
  assert.equal(store.append(retryable), true)
  assert.equal(store.readCurrent().snapshot_id, retryable.snapshot_id)
})

test("跨 store 重试 stale pending 会把回退基准刷新为最新 durable current", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const storeA = module.createTaskInputSnapshotStore(storage)
  const storeB = module.createTaskInputSnapshotStore(storage)
  const previous = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:40:00.000Z", snapshotNonce: "XXXXXXXXXXXXXXXX",
  })
  const stale = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:41:00.000Z", snapshotNonce: "YYYYYYYYYYYYYYYY",
  })
  const latest = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:42:00.000Z", snapshotNonce: "ZZZZZZZZZZZZZZZZ",
  })
  const staleCommittedKey = `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${stale.snapshot_id}`
  const stalePendingKey = `${module.TASK_INPUT_STORAGE_KEY}.pending.${stale.snapshot_id}`

  assert.equal(storeA.append(previous), true)
  storage.failOnce("setItem", staleCommittedKey, "before")
  assert.equal(storeA.append(stale), false)
  assert.equal(JSON.parse(storage.raw(stalePendingKey)).previous_current_id, previous.snapshot_id)
  assert.equal(storeB.append(latest), true)
  assert.equal(storeB.readCurrent().snapshot_id, latest.snapshot_id)

  storage.failOnce("setItem", staleCommittedKey, "before")
  assert.equal(storeA.append(stale), false)
  assert.equal(JSON.parse(storage.raw(stalePendingKey)).previous_current_id, latest.snapshot_id)
  const reopened = module.createTaskInputSnapshotStore(storage)
  assert.equal(reopened.readCurrent().snapshot_id, latest.snapshot_id)
  assert.deepEqual(reopened.readAll().map((item) => item.snapshot_id), [previous.snapshot_id, latest.snapshot_id])

  assert.equal(storeA.append(stale), true)
  assert.equal(storeA.readCurrent().snapshot_id, stale.snapshot_id)
})

test("stale pending refresh 的写前、写后和读复核故障都保持最新 durable current", async () => {
  const module = await import("./agent-task-input.mjs")

  for (const scenario of ["write_before", "write_after", "read_unknown"]) {
    const storage = adversarialStorage()
    const storeA = module.createTaskInputSnapshotStore(storage)
    const storeB = module.createTaskInputSnapshotStore(storage)
    const previous = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T11:50:00.000Z", snapshotNonce: "1111111111111111",
    })
    const stale = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T11:51:00.000Z", snapshotNonce: "2222222222222222",
    })
    const latest = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T11:52:00.000Z", snapshotNonce: "3333333333333333",
    })
    const pendingKey = `${module.TASK_INPUT_STORAGE_KEY}.pending.${stale.snapshot_id}`
    const committedKey = `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${stale.snapshot_id}`

    assert.equal(storeA.append(previous), true)
    storage.failOnce("setItem", committedKey, "before")
    assert.equal(storeA.append(stale), false)
    assert.equal(storeB.append(latest), true)

    if (scenario === "write_before") {
      storage.failOnce("setItem", pendingKey, "before")
    } else {
      storage.failOnce("setItem", pendingKey, "after")
      if (scenario === "read_unknown") {
        storage.failOnce("getItem", pendingKey, "before", 1)
        storage.failOnce("getItem", pendingKey, "before")
      } else {
        storage.failOnce("setItem", committedKey, "before")
      }
    }

    assert.equal(storeA.append(stale), false, scenario)
    assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, latest.snapshot_id, scenario)
    const refreshedPending = JSON.parse(storage.raw(pendingKey))
    assert.equal(
      refreshedPending.previous_current_id,
      scenario === "write_before" ? previous.snapshot_id : latest.snapshot_id,
      scenario,
    )
    assert.equal(storeA.append(stale), true, `${scenario} retry`)
    assert.equal(storeA.readCurrent().snapshot_id, stale.snapshot_id, scenario)
  }
})

test("重试时 raw current 等于 pending snapshot 不会写出自环回退", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const previous = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:55:00.000Z", snapshotNonce: "4444444444444444",
  })
  const pendingSnapshot = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:56:00.000Z", snapshotNonce: "5555555555555555",
  })
  const pendingKey = `${module.TASK_INPUT_STORAGE_KEY}.pending.${pendingSnapshot.snapshot_id}`
  const committedKey = `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${pendingSnapshot.snapshot_id}`

  assert.equal(store.append(previous), true)
  storage.failOnce("setItem", committedKey, "before")
  assert.equal(store.append(pendingSnapshot), false)
  storage.failOnce("setItem", committedKey, "before")
  assert.equal(store.append(pendingSnapshot), false)
  assert.equal(JSON.parse(storage.raw(pendingKey)).previous_current_id, previous.snapshot_id)
  assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, previous.snapshot_id)
  assert.equal(store.append(pendingSnapshot), true)
})

test("重试 pending 只采用已提交 raw current 作为回退以避免跨 pending 成环", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const previous = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:57:00.000Z", snapshotNonce: "6666666666666666",
  })
  const pendingA = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:58:00.000Z", snapshotNonce: "7777777777777777",
  })
  const pendingC = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:59:00.000Z", snapshotNonce: "8888888888888888",
  })
  const currentKey = `${module.TASK_INPUT_STORAGE_KEY}.current`
  const pendingAKey = `${module.TASK_INPUT_STORAGE_KEY}.pending.${pendingA.snapshot_id}`
  const pendingCKey = `${module.TASK_INPUT_STORAGE_KEY}.pending.${pendingC.snapshot_id}`
  const committedAKey = `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${pendingA.snapshot_id}`
  const committedCKey = `${module.TASK_INPUT_STORAGE_KEY}.snapshot.${pendingC.snapshot_id}`

  assert.equal(store.append(previous), true)
  storage.failOnce("setItem", committedAKey, "before")
  assert.equal(store.append(pendingA), false)
  storage.failOnce("setItem", committedCKey, "before")
  assert.equal(store.append(pendingC), false)
  assert.equal(storage.raw(currentKey), pendingC.snapshot_id)
  assert.equal(JSON.parse(storage.raw(pendingAKey)).previous_current_id, previous.snapshot_id)
  assert.equal(JSON.parse(storage.raw(pendingCKey)).previous_current_id, previous.snapshot_id)

  storage.failOnce("setItem", committedAKey, "before")
  assert.equal(store.append(pendingA), false)
  assert.equal(store.readCurrent().snapshot_id, previous.snapshot_id)
  assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, previous.snapshot_id)
  assert.equal(JSON.parse(storage.raw(pendingAKey)).previous_current_id, previous.snapshot_id)
  assert.equal(JSON.parse(storage.raw(pendingCKey)).previous_current_id, previous.snapshot_id)

  assert.equal(store.append(pendingA), true)
  assert.equal(store.readCurrent().snapshot_id, pendingA.snapshot_id)
  assert.equal(store.append(pendingC), true)
  assert.equal(store.readCurrent().snapshot_id, pendingC.snapshot_id)
  assert.deepEqual(store.readAll().map((snapshot) => snapshot.snapshot_id), [
    previous.snapshot_id,
    pendingA.snapshot_id,
    pendingC.snapshot_id,
  ])
  assert.equal(storage.raw(pendingAKey), undefined)
  assert.equal(storage.raw(pendingCKey), undefined)
})

test("raw current 指向未知或损坏 pending 时 append 保持存储不变并 fail closed", async () => {
  const module = await import("./agent-task-input.mjs")

  for (const scenario of ["unknown", "damaged_pending"]) {
    const storage = adversarialStorage()
    const seedStore = module.createTaskInputSnapshotStore(storage)
    const previous = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:00:00.000Z", snapshotNonce: "9999999999999999",
    })
    const candidate = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:01:00.000Z", snapshotNonce: "0000000000000000",
    })
    const currentKey = `${module.TASK_INPUT_STORAGE_KEY}.current`
    assert.equal(seedStore.append(previous), true)
    if (scenario === "unknown") {
      storage.setItem(currentKey, "UNKNOWN-PENDING-ID")
    } else {
      storage.setItem(currentKey, candidate.snapshot_id)
      storage.setItem(`${module.TASK_INPUT_STORAGE_KEY}.pending.${candidate.snapshot_id}`, "{broken")
    }
    const before = new Map(storage.values)
    const store = module.createTaskInputSnapshotStore(storage)

    assert.equal(store.append(candidate), false, scenario)
    assert.deepEqual(storage.values, before, scenario)
    assert.equal(store.readCurrent(), null, scenario)
  }
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

test("聚合 root 只是缓存，缺少独立 snapshot 与 current 时不能成为快照权威", async () => {
  const module = await import("./agent-task-input.mjs")
  const snapshot = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T11:30:00.000Z", snapshotNonce: "UUUUUUUUUUUUUUUU",
  })
  const rootOnly = new Map([[
    module.TASK_INPUT_STORAGE_KEY,
    JSON.stringify({ version: 1, current_snapshot_id: snapshot.snapshot_id, snapshots: [snapshot] }),
  ]])
  const storage = fakeStorage(rootOnly)
  const store = module.createTaskInputSnapshotStore(storage)

  assert.equal(store.readCurrent(), null)
  assert.deepEqual(store.readAll(), [])
  assert.equal(store.append(snapshot), false)
  assert.deepEqual(storage.map, rootOnly)
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

test("selectCurrent 守护初始与写前 getItem 失败且 false 不会选中新快照", async () => {
  const module = await import("./agent-task-input.mjs")
  for (const fault of [
    { key: module.TASK_INPUT_STORAGE_KEY, skip: 0 },
    { key: `${module.TASK_INPUT_STORAGE_KEY}.current`, skip: 1 },
  ]) {
    const storage = adversarialStorage()
    const store = module.createTaskInputSnapshotStore(storage)
    const first = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:00:00.000Z", snapshotNonce: "OOOOOOOOOOOOOOOO",
    })
    const current = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:01:00.000Z", snapshotNonce: "PPPPPPPPPPPPPPPP",
    })
    assert.equal(store.append(first), true)
    assert.equal(store.append(current), true)
    storage.failOnce("getItem", fault.key, "before", fault.skip)

    assert.equal(store.selectCurrent(first.snapshot_id), false)
    assert.equal(store.readCurrent().snapshot_id, current.snapshot_id)
    assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, current.snapshot_id)
  }
})

test("selectCurrent 将 current write-then-throw、root 缓存失败和一次性复核失败判为已提交", async () => {
  const module = await import("./agent-task-input.mjs")
  const scenarios = [
    { method: "setItem", key: "current", phase: "after" },
    { method: "setItem", key: "root", phase: "before" },
    { method: "setItem", key: "root", phase: "after" },
    { method: "getItem", key: "current", phase: "before", skip: 2 },
  ]

  for (const scenario of scenarios) {
    const storage = adversarialStorage()
    const store = module.createTaskInputSnapshotStore(storage)
    const selected = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:10:00.000Z", snapshotNonce: "QQQQQQQQQQQQQQQQ",
    })
    const current = module.createTaskInputSnapshot(readyPreview(module), {
      createdAt: "2026-08-29T12:11:00.000Z", snapshotNonce: "RRRRRRRRRRRRRRRR",
    })
    assert.equal(store.append(selected), true)
    assert.equal(store.append(current), true)
    const key = scenario.key === "current"
      ? `${module.TASK_INPUT_STORAGE_KEY}.current`
      : module.TASK_INPUT_STORAGE_KEY
    storage.failOnce(scenario.method, key, scenario.phase, scenario.skip ?? 0)

    assert.equal(store.selectCurrent(selected.snapshot_id), true, `${scenario.key} ${scenario.phase}`)
    assert.equal(store.readCurrent().snapshot_id, selected.snapshot_id)
    assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, selected.snapshot_id)
  }
})

test("selectCurrent 在 write-then-throw 后回滚也失败时按 durable current 报告成功", async () => {
  const module = await import("./agent-task-input.mjs")
  const storage = adversarialStorage()
  const store = module.createTaskInputSnapshotStore(storage)
  const selected = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T12:20:00.000Z", snapshotNonce: "SSSSSSSSSSSSSSSS",
  })
  const current = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T12:21:00.000Z", snapshotNonce: "TTTTTTTTTTTTTTTT",
  })
  assert.equal(store.append(selected), true)
  assert.equal(store.append(current), true)
  const currentKey = `${module.TASK_INPUT_STORAGE_KEY}.current`
  storage.failOnce("setItem", currentKey, "after")
  storage.failOnce("setItem", currentKey, "before")
  storage.failOnce("getItem", currentKey, "before", 2)
  storage.failOnce("getItem", currentKey, "before")

  assert.equal(store.selectCurrent(selected.snapshot_id), true)
  assert.equal(store.readCurrent().snapshot_id, selected.snapshot_id)
  assert.equal(module.createTaskInputSnapshotStore(storage).readCurrent().snapshot_id, selected.snapshot_id)
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

test("任务快照拒绝自定义原型、symbol、不可枚举字段和访问器", async () => {
  const module = await import("./agent-task-input.mjs")
  const snapshot = module.createTaskInputSnapshot(readyPreview(module), {
    createdAt: "2026-08-29T10:00:00.000Z", snapshotNonce: "FFFFFFFFFFFFFFFF",
  })
  const customPrototype = structuredClone(snapshot)
  Object.setPrototypeOf(customPrototype, { inherited: true })
  const symbolField = structuredClone(snapshot)
  symbolField[Symbol("hidden")] = true
  const nonEnumerable = structuredClone(snapshot)
  Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false })
  const accessor = structuredClone(snapshot)
  Object.defineProperty(accessor, "version", { enumerable: true, get: () => 1 })

  for (const candidate of [customPrototype, symbolField, nonEnumerable, accessor]) {
    assert.equal(module.isValidTaskInputSnapshot(candidate), false)
  }
})
