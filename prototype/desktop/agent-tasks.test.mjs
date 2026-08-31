import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { DIRECTION_STORAGE_KEY, createDirectionSnapshot } from "./direction-snapshot.mjs"
import { TASK_INPUT_STORAGE_KEY } from "./agent-task-input.mjs"
import { WORKSPACE_STORAGE_KEY } from "./paper-library-storage.mjs"
import { defaultDirectionSelection } from "./papers-data.mjs"

const desktopRoot = path.dirname(fileURLToPath(import.meta.url))

function memoryStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    values,
  }
}

function paperIndex(version = 3, title = "Distributed Constrained Optimization") {
  return {
    version,
    facet_schema: { version: version === 3 ? 2 : version === 2 ? 1 : 0 },
    papers: [{
      paper_id: "Liu24-LCT",
      title_zh: "时变非平衡网络约束优化",
      title_en: title,
      title_original: title,
      authors: ["Liu H"],
      year: 2024,
      source_status: "verified",
      evidence_status: "partial",
      reproduction_status: "results_recorded",
    }],
  }
}

function seedWorkspace(storage) {
  storage.setItem(DIRECTION_STORAGE_KEY, JSON.stringify(createDirectionSnapshot(defaultDirectionSelection, {
    savedAt: "2026-08-29T07:00:00.000Z",
  })))
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
    version: 1,
    shelf: { "Liu24-LCT": ["algorithm_mechanism", "theory_evidence"] },
    personalReading: { "Liu24-LCT": "read" },
    selectedPaperId: "Liu24-LCT",
  }))
}

test("只读任务会话必须显式确认才追加固定输入快照", async () => {
  const module = await import("./agent-tasks.mjs")
  const storage = memoryStorage()
  seedWorkspace(storage)
  const session = module.createAgentTaskSession({ storage, paperIndex: paperIndex() })

  assert.equal(session.readPreview().ready, true)
  assert.deepEqual(session.readHistory(), [])
  assert.deepEqual(session.saveCurrentInput({ confirmed: false }), { ok: false, reason: "confirmation_required" })
  assert.equal(storage.getItem(TASK_INPUT_STORAGE_KEY), null)

  const saved = session.saveCurrentInput({
    confirmed: true,
    createdAt: "2026-08-29T08:00:00.000Z",
    snapshotNonce: "AAAAAAAAAAAAAAAA",
  })
  assert.equal(saved.ok, true)
  assert.equal(session.readHistory().length, 1)
  assert.equal(session.readCurrent().snapshot_id, saved.snapshot.snapshot_id)
  assert.deepEqual(saved.snapshot.note_fragment_refs, [])
  assert.doesNotMatch(JSON.stringify(saved.snapshot), /conclusion|candidate|personalReading|source_path|note_body/u)
})

test("历史视图最新在前，来源变化只发出警告而不覆盖旧快照", async () => {
  const module = await import("./agent-tasks.mjs")
  const storage = memoryStorage()
  seedWorkspace(storage)
  const session = module.createAgentTaskSession({ storage, paperIndex: paperIndex() })
  const first = session.saveCurrentInput({
    confirmed: true,
    createdAt: "2026-08-29T08:00:00.000Z",
    snapshotNonce: "AAAAAAAAAAAAAAAA",
  }).snapshot
  const second = session.saveCurrentInput({
    confirmed: true,
    createdAt: "2026-08-29T09:00:00.000Z",
    snapshotNonce: "BBBBBBBBBBBBBBBB",
  }).snapshot

  assert.deepEqual(session.readHistory().map((entry) => entry.snapshot.snapshot_id), [second.snapshot_id, first.snapshot_id])
  assert.equal(session.readHistory().every((entry) => entry.source_changed === false), true)

  const changedSelection = { ...defaultDirectionSelection, feedback: ["零阶反馈"] }
  storage.setItem(DIRECTION_STORAGE_KEY, JSON.stringify(createDirectionSnapshot(changedSelection, {
    savedAt: "2026-08-29T10:00:00.000Z",
  })))
  session.refresh({ paperIndex: paperIndex(3, "A changed source title") })
  assert.equal(session.readHistory().every((entry) => entry.source_changed), true)
  assert.equal(session.readHistory()[1].snapshot.papers[0].title_en, "Distributed Constrained Optimization")

  assert.equal(session.selectSnapshot(first.snapshot_id), true)
  assert.equal(session.readCurrent().snapshot_id, first.snapshot_id)
})

test("历史视图按 created_at 降序并以 snapshot_id 稳定打破同一时刻平局", async () => {
  const module = await import("./agent-tasks.mjs")
  const storage = memoryStorage()
  seedWorkspace(storage)
  const session = module.createAgentTaskSession({ storage, paperIndex: paperIndex() })
  const saved = [
    ["2026-08-29T09:00:00.000Z", "MMMMMMMMMMMMMMMM"],
    ["2026-08-29T11:00:00.000Z", "AAAAAAAAAAAAAAAA"],
    ["2026-08-29T10:00:00.000Z", "AAAAAAAAAAAAAAAA"],
    ["2026-08-29T10:00:00.000Z", "ZZZZZZZZZZZZZZZZ"],
  ].map(([createdAt, snapshotNonce]) => session.saveCurrentInput({
    confirmed: true, createdAt, snapshotNonce,
  }).snapshot)
  const oldestSnapshotKey = `${TASK_INPUT_STORAGE_KEY}.snapshot.${saved[0].snapshot_id}`
  const oldestBytes = storage.getItem(oldestSnapshotKey)

  assert.deepEqual(session.readHistory().map((entry) => entry.snapshot.snapshot_id), [
    saved[1].snapshot_id,
    saved[3].snapshot_id,
    saved[2].snapshot_id,
    saved[0].snapshot_id,
  ])
  session.refresh({ paperIndex: paperIndex(3, "Changed after snapshots") })
  assert.equal(session.readHistory().every((entry) => entry.source_changed), true)
  assert.equal(storage.getItem(oldestSnapshotKey), oldestBytes)
})

test("任务页论文数据只经过 canonical library loader 且 v1 仍被拒绝", async () => {
  const module = await import("./agent-tasks.mjs")
  const requests = []
  await assert.rejects(
    () => module.loadAgentTaskPaperIndex(async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ version: 1, facet_schema: {}, warning_count: 0, papers: [] }) }
    }),
    /论文库索引格式无效/u,
  )
  assert.deepEqual(requests, [{ url: "../../local_library_data/paper-index.json", options: { cache: "no-store" } }])
})

test("任务页只呈现输入预览、显式快照和历史，不提供执行、生成结论或导出入口", async () => {
  const html = await readFile(path.join(desktopRoot, "agent-tasks.html"), "utf8")
  const css = await readFile(path.join(desktopRoot, "agent-tasks.css"), "utf8")
  const runtime = await readFile(path.join(desktopRoot, "agent-tasks.mjs"), "utf8")
  assert.match(html, /研究任务输入/u)
  assert.match(html, /确认并固定输入快照/u)
  assert.match(html, /历史输入快照/u)
  assert.match(html, /未连接任何执行器或模型/u)
  assert.match(html, /id="snapshot-confirm"/u)
  assert.match(html, /id="snapshot-history"/u)
  assert.doesNotMatch(`${html}\n${runtime}`, /id="(?:run-agent|create-revision|export-results)"|run_demo|\/api\/(?:health|tasks)|local-task-client/u)
  assert.match(css, /\.agent-snapshot-history/u)
})

test("任务页初始化只通过 canonical loader 请求一次论文索引", async () => {
  const module = await import("./agent-tasks.mjs")
  const requests = []
  const storage = memoryStorage()
  const documentRef = { querySelector() { return null } }
  const windowRef = { localStorage: storage, addEventListener() {} }

  await module.initializeAgentTasks({
    document: documentRef,
    window: windowRef,
    loadIndex: () => module.loadAgentTaskPaperIndex(async (url, options) => {
      requests.push({ url, options })
      return {
        ok: true,
        json: async () => ({ version: 1, facet_schema: {}, warning_count: 0, papers: [] }),
      }
    }),
  })

  assert.deepEqual(requests, [{
    url: "../../local_library_data/paper-index.json",
    options: { cache: "no-store" },
  }])
  const forbiddenRoutes = [
    ["/api/", "tasks"].join(""),
    ["/api/", "health"].join(""),
    ["/model/", "run"].join(""),
    ["/agent/", "run"].join(""),
  ]
  assert.equal(requests.some(({ url }) => forbiddenRoutes.some((route) => url.includes(route))), false)
})
