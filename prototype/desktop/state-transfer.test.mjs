import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import { createEmptyP02WorkflowState } from "./p02-workflow.mjs"
import { createEmptyDiscoveryWorkspaceState, createDiscoveryWorkspaceStore, DISCOVERY_WORKSPACE_STORAGE_KEY } from "./discovery-workspace.mjs"
import { recordInput } from "./discovery-test-fixtures.mjs"

import {
  applyStateMerge,
  exportStateBundle,
  previewStateMerge,
  validateStateBundle,
} from "./state-transfer.mjs"

const ORIGINS = Object.freeze([
  "http://127.0.0.1:4176",
  "http://127.0.0.1:4177",
  "http://127.0.0.1:4178",
])
const EXPORTED_AT = "2026-09-01T00:00:00.000Z"

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries))
    this.writes = 0
  }

  get length() {
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.writes += 1
    this.values.set(String(key), String(value))
  }

  removeItem(key) {
    this.writes += 1
    this.values.delete(key)
  }
}

function emptyState() {
  return {
    direction_snapshot: null,
    paper_workspace: { version: 1, shelf: {}, personalReading: {}, selectedPaperId: null },
    personal_tags: { version: 1, papers: {} },
    discovery_candidates: { version: 1, candidates: [] },
    agent_task_input: { version: 1, current_snapshot_id: null, snapshots: [] },
    p02_workflow: createEmptyP02WorkflowState(),
    discovery_workspace: createEmptyDiscoveryWorkspaceState(),
  }
}

function acceptedAlgorithmWorkflow(objective = "验证低通信约束优化机制") {
  const workflow = createEmptyP02WorkflowState()
  workflow.paper_roles.algorithm_mechanism = ["Paper-01"]
  workflow.accepted_stages = ["algorithm"]
  workflow.algorithm = {
    problem_type: "offline",
    research_objective: objective,
    mechanisms: ["M01", "M03", "M04"],
    update_plan: "先混合，再触发通信，最后执行约束协调更新。",
    contribution_boundary: "只记录相对基线的候选差异，不把规划写成已证明结论。",
  }
  return workflow
}

function validDirection(savedAt = "2026-08-30T08:00:00.000Z") {
  return {
    version: 1,
    project_id: "P02",
    saved_at: savedAt,
    axes: {
      problem: ["分布式优化"],
      direction: ["有向网络"],
      topology: ["时变拓扑"],
      balance: ["非平衡网络"],
      coupling: ["耦合约束"],
      feedback: ["一阶反馈"],
      communication: ["低通信"],
      privacy: [],
      algorithm: ["原始—对偶"],
      guarantee: ["渐近收敛"],
    },
  }
}

function validCandidate({ paperId = "W1001", doi = "10.1000/example", title = "Example" } = {}) {
  return {
    paperId,
    doi,
    title,
    authors: ["Author"],
    year: 2025,
    source: "OpenAlex",
    citations: 3,
    isOpenAccess: true,
    openAccessUrl: "https://example.org/paper.pdf",
    landingPageUrl: "https://example.org/paper",
    topics: ["Optimization"],
    abstract: null,
    stage: "pending_screening",
  }
}

function validTaskSnapshot({
  nonce = "ABCDEFGHIJKLMNOP",
  createdAt = "2026-08-30T08:00:00.000Z",
  title = "安全标题",
} = {}) {
  return {
    version: 1,
    snapshot_id: `INPUT-P02-${createdAt.replace(/[-:.]/gu, "")}-${nonce}`,
    created_at: createdAt,
    project_id: "P02",
    direction_snapshot: validDirection(),
    papers: [{
      paper_id: "Paper-01",
      shelf_roles: ["algorithm_mechanism"],
      title_zh: title,
      title_en: null,
      authors: ["作者"],
      year: 2025,
      source_status: "verified",
      evidence_status: "core_verified",
      reproduction_status: "results_recorded",
    }],
    note_fragment_refs: [],
  }
}

async function bundleFor(state, origin = ORIGINS[1], exportedAt = EXPORTED_AT, extra = {}) {
  return exportStateBundle({ storage: stateStorage(state, extra), originLabel: origin, exportedAt })
}

function stateStorage(state, extra = {}) {
  const entries = {
    ...extra,
    "research-console.paper-library.v1": JSON.stringify(state.paper_workspace),
    "research-console.paper-user-tags.v1": JSON.stringify(state.personal_tags),
    "research-console.discovery-candidates.v1": JSON.stringify(state.discovery_candidates),
    "research-console.agent-task-input.v1": JSON.stringify(state.agent_task_input),
    "research-console.p02-workflow.v1": JSON.stringify(state.p02_workflow),
    [DISCOVERY_WORKSPACE_STORAGE_KEY]: JSON.stringify(state.discovery_workspace),
  }
  if (state.direction_snapshot !== null) {
    entries["research-console.direction-snapshot.v1"] = JSON.stringify(state.direction_snapshot)
  }
  if (state.agent_task_input.current_snapshot_id !== null) {
    entries["research-console.agent-task-input.v1.current"] = state.agent_task_input.current_snapshot_id
  }
  for (const snapshot of state.agent_task_input.snapshots) {
    entries[`research-console.agent-task-input.v1.snapshot.${snapshot.snapshot_id}`] = JSON.stringify(snapshot)
  }
  return new MemoryStorage(entries)
}

function canonicalJsonForTest(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`).join(",")}}`
}

async function legacyV1BundleFromV2(bundle) {
  const body = {
    schema: bundle.schema,
    version: 1,
    origin: bundle.origin,
    exported_at: bundle.exported_at,
    counts: {
      direction_snapshots: bundle.counts.direction_snapshots,
      workspace_shelf_entries: bundle.counts.workspace_shelf_entries,
      workspace_reading_entries: bundle.counts.workspace_reading_entries,
      user_tag_assignments: bundle.counts.user_tag_assignments,
      candidates: bundle.counts.candidates,
      agent_snapshots: bundle.counts.agent_snapshots,
    },
    conflict_report: bundle.conflict_report,
    state: {
      direction_snapshot: bundle.state.direction_snapshot,
      paper_workspace: bundle.state.paper_workspace,
      personal_tags: bundle.state.personal_tags,
      discovery_candidates: bundle.state.discovery_candidates,
      agent_task_input: bundle.state.agent_task_input,
    },
  }
  const sha256 = createHash("sha256").update(canonicalJsonForTest(body)).digest("hex")
  return validateStateBundle(JSON.stringify({ ...body, sha256 }))
}

function exactBundle(bundle, overrides = {}) {
  return {
    schema: bundle.schema,
    version: bundle.version,
    origin: bundle.origin,
    exported_at: bundle.exported_at,
    counts: bundle.counts,
    conflict_report: bundle.conflict_report,
    state: bundle.state,
    sha256: bundle.sha256,
    ...overrides,
  }
}

function signedRaw(bundle) {
  const { sha256, ...body } = cloneForTest(bundle)
  return JSON.stringify({ ...body, sha256: createHash('sha256').update(canonicalJsonForTest(body)).digest('hex') })
}

async function legacyV2Bundle(bundle) {
  const value = cloneForTest(bundle)
  value.version = 2
  delete value.state.discovery_workspace
  delete value.counts.discovery_results
  delete value.counts.discovery_external_candidates
  return validateStateBundle(signedRaw(value))
}

function discoveryWorkspace(revision = 7) {
  const state = createEmptyDiscoveryWorkspaceState()
  const query = { query_id: 'q-1', expression: 'distributed optimization', condition_ids: [], kind: 'original' }
  state.revision = revision
  state.batches = [{ batch_id: 'b-1', created_at: EXPORTED_AT,
    scope: { startYear: null, endYear: null, language: 'all' },
    plan: { conditions: [], selected: [query], suggested: [], warnings: [] }, rule_snapshot: state.rules,
    queries: [{ query, cursor: null, total: null, accepted_cursors: [], loaded: 0, status: 'loading', error: null }],
    record_ids: ['r-1'], excluded_record_ids: [] }]
  state.records = [recordInput()]
  state.results = [{ result_id: 'result-1', record_ids: ['r-1'], preferred_record_id: 'r-1',
    alias_ids: ['alias-1'], identity_status: 'clear', conflicts: [] }]
  state.external_candidates = [{ result_id: 'result-1', selected_at: EXPORTED_AT, openalex_id: null }]
  return state
}

test('v3 backs up persisted loading states and verifies nonzero discovery counts', async () => {
  const state = emptyState(); state.discovery_workspace = discoveryWorkspace()
  const storage = stateStorage(state)
  const store = createDiscoveryWorkspaceStore(storage)
  assert.equal(store.read().batches[0].queries[0].status, 'interrupted')
  const bundle = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  assert.deepEqual(bundle.state.discovery_workspace, state.discovery_workspace)
  assert.equal(bundle.counts.discovery_results, 1)
  assert.equal(bundle.counts.discovery_external_candidates, 1)
  assert.equal(storage.writes, 0)
})

test('independent v1/v2/v3 schemas reject wrong-version owner/count keys, count drift and cross references even with valid hashes', async () => {
  const state = emptyState(); state.discovery_workspace = discoveryWorkspace()
  const v3 = await bundleFor(state)
  const v2 = await legacyV2Bundle(v3), v1 = await legacyV1BundleFromV2(v2)
  assert.deepEqual([Object.keys(v1.state).length, Object.keys(v2.state).length, Object.keys(v3.state).length], [5, 6, 7])
  assert.deepEqual([Object.keys(v1.counts).length, Object.keys(v2.counts).length, Object.keys(v3.counts).length], [6, 7, 9])
  for (const [base, mutate] of [
    [v3, v => { v.version = 2 }], [v2, v => { v.version = 3 }], [v2, v => { v.version = 1 }],
    [v1, v => { v.state.discovery_workspace = createEmptyDiscoveryWorkspaceState() }],
    [v2, v => { v.counts.discovery_results = 0 }],
    [v3, v => { v.counts.discovery_results = 2 }],
    [v3, v => { v.counts.discovery_external_candidates = 0 }],
    [v3, v => { v.state.discovery_workspace.external_candidates[0].result_id = 'orphan' }],
    [v3, v => { v.state.discovery_workspace.results[0].record_ids = ['orphan'] }],
  ]) {
    const value = cloneForTest(base); mutate(value)
    await assert.rejects(() => validateStateBundle(signedRaw(value)), /状态迁移文件无效/u)
  }
})

test('v1 preserves P02 and discovery; v2 still offers P02 replacement but preserves discovery', async () => {
  for (const version of [1, 2]) {
    const state = emptyState(); state.discovery_workspace = discoveryWorkspace()
    state.p02_workflow = acceptedAlgorithmWorkflow('current')
    const storage = stateStorage(state), current = await bundleFor(state, ORIGINS[0])
    const incomingState = emptyState(); incomingState.p02_workflow = acceptedAlgorithmWorkflow('incoming')
    const exported = await bundleFor(incomingState)
    const incoming = version === 1 ? await legacyV1BundleFromV2(exported) : await legacyV2Bundle(exported)
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
    assert.deepEqual(plan.proposed_state.discovery_workspace, state.discovery_workspace)
    assert.equal(plan.conflicts.some(c => c.group === 'discovery_workspace'), false)
    assert.equal(plan.conflicts.some(c => c.group === 'p02_workflow'), version === 2)
    const result = await applyStateMerge({ storage, plan, decisions: version === 1 ? {} : {
      p02_workflow: { action: 'replace', source_sha256: incoming.sha256 },
    } })
    assert.equal(result.status, 'success')
    assert.deepEqual(result.state.discovery_workspace, state.discovery_workspace)
    assert.deepEqual(result.state.p02_workflow, version === 1 ? state.p02_workflow : incomingState.p02_workflow)
  }
})

test('v3 whole discovery owner stays current in preview and skip; explicit replacement preserves requested revision and graph', async () => {
  for (const action of ['skip', 'replace']) {
    const state = emptyState(); state.discovery_workspace = discoveryWorkspace(20)
    const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(3)
    incomingState.discovery_workspace.results[0].alias_ids.push('other-alias')
    const storage = stateStorage(state), current = await bundleFor(state, ORIGINS[0]), incoming = await bundleFor(incomingState)
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
    assert.deepEqual(plan.proposed_state.discovery_workspace, state.discovery_workspace)
    assert.equal(plan.version, 1)
    assert.deepEqual(Object.keys(plan).sort(), ['schema', 'version', 'current_state_sha256', 'bundle_sha256s', 'proposed_state', 'conflicts', 'exclusions'].sort())
    assert.deepEqual(plan.conflicts.map(c => [c.group, c.kind, c.allowed_actions]), [['discovery_workspace', 'whole_document', ['skip', 'replace']]])
    assert.equal(storage.writes, 0)
    const result = await applyStateMerge({ storage, plan, decisions: { discovery_workspace: action === 'skip'
      ? { action } : { action, source_sha256: incoming.sha256 } } })
    assert.equal(result.status, 'success')
    assert.deepEqual(result.state.discovery_workspace, action === 'skip' ? state.discovery_workspace : incomingState.discovery_workspace)
    assert.deepEqual(JSON.parse(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)), result.state.discovery_workspace)
    if (action === 'skip') assert.equal(storage.writes, 0)
    await assert.rejects(() => applyStateMerge({ storage, plan, decisions: {} }), /已使用/u)
  }
})

test('discovery missing stays missing during export and no-op apply; invalid and unavailable reject export', async () => {
  const storage = stateStorage(emptyState()); storage.values.delete(DISCOVERY_WORKSPACE_STORAGE_KEY)
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(emptyState())
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
  assert.equal((await applyStateMerge({ storage, plan, decisions: {} })).status, 'success')
  assert.equal(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY), null)
  assert.equal(storage.writes, 0)
  for (const mode of ['invalid', 'unavailable']) {
    const bad = stateStorage(emptyState())
    if (mode === 'invalid') bad.values.set(DISCOVERY_WORKSPACE_STORAGE_KEY, '{broken')
    else { const get = bad.getItem.bind(bad); bad.getItem = key => { if (key === DISCOVERY_WORKSPACE_STORAGE_KEY) throw Error('private'); return get(key) } }
    await assert.rejects(() => exportStateBundle({ storage: bad, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT }), /状态无法导出/u)
    assert.equal(bad.writes, 0)
  }
})

test('discovery-only stale plan rejects before any owner write', async () => {
  const state = emptyState(), storage = stateStorage(state), current = await bundleFor(state, ORIGINS[0])
  const incomingState = emptyState(); incomingState.personal_tags.papers['Paper-01'] = ['incoming']
  const plan = await previewStateMerge({ current, bundles: [await bundleFor(incomingState)], knownPaperIds: ['Paper-01'] })
  storage.values.set(DISCOVERY_WORKSPACE_STORAGE_KEY, JSON.stringify(discoveryWorkspace()))
  await assert.rejects(() => applyStateMerge({ storage, plan, decisions: {} }), error => error.code === 'stale_plan')
  assert.equal(storage.writes, 0)
})

test('rollback of another owner does not materialize a missing unchanged discovery key', async () => {
  const state = emptyState(), original = stateStorage(state)
  original.values.delete(DISCOVERY_WORKSPACE_STORAGE_KEY)
  const storage = new FailingStorage(original, ({ key, value }) => key === 'research-console.paper-user-tags.v1' && value.includes('incoming'))
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incomingState = emptyState(); incomingState.personal_tags.papers['Paper-01'] = ['incoming']
  const incoming = await bundleFor(incomingState)
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
  assert.equal((await applyStateMerge({ storage, plan, decisions: {} })).status, 'apply_failed_rolled_back')
  assert.equal(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY), null)
})

for (const deleteMode of ['normal', 'throw-after-delete', 'drop-delete']) {
  test(`successful discovery replacement restores original missing presence after later failure: ${deleteMode}`, async () => {
    const state = emptyState(), original = stateStorage(state)
    original.values.delete(DISCOVERY_WORKSPACE_STORAGE_KEY)
    let sawPersistedReplacement = false
    const storage = new FailingStorage(original, ({ key, value }) => {
      if (key !== 'research-console.paper-user-tags.v1' || !value.includes('incoming')) return false
      sawPersistedReplacement = JSON.parse(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)).revision === 1
      return true
    })
    const remove = storage.removeItem.bind(storage)
    storage.removeItem = key => {
      if (key === DISCOVERY_WORKSPACE_STORAGE_KEY && deleteMode === 'drop-delete') return
      remove(key)
      if (key === DISCOVERY_WORKSPACE_STORAGE_KEY && deleteMode === 'throw-after-delete') throw Error('after delete')
    }
    const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
    const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(1)
    incomingState.personal_tags.papers['Paper-01'] = ['incoming']
    const incoming = await bundleFor(incomingState)
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
    const result = await applyStateMerge({ storage, plan, decisions: { discovery_workspace: { action: 'replace', source_sha256: incoming.sha256 } } })
    assert.equal(sawPersistedReplacement, true)
    assert.equal(result.status, deleteMode === 'drop-delete' ? 'rollback_failed' : 'apply_failed_rolled_back')
    if (deleteMode === 'drop-delete') assert.equal(JSON.parse(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)).revision, 1)
    else assert.equal(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY), null)
  })
}

test('global rollback proof rejects an empty discovery key reappearing after missing restoration', async () => {
  const state = emptyState(), original = stateStorage(state)
  original.values.delete(DISCOVERY_WORKSPACE_STORAGE_KEY)
  const storage = new FailingStorage(original, ({ key, value }) => key === 'research-console.paper-user-tags.v1' && value.includes('incoming'))
  const originalSet = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    originalSet(key, value)
    if (key === 'research-console.p02-workflow.v1' && JSON.parse(value).accepted_stages.length === 0) {
      storage.values.set(DISCOVERY_WORKSPACE_STORAGE_KEY, JSON.stringify(createEmptyDiscoveryWorkspaceState()))
    }
  }
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(1)
  incomingState.p02_workflow = acceptedAlgorithmWorkflow()
  incomingState.personal_tags.papers['Paper-01'] = ['incoming']
  const incoming = await bundleFor(incomingState)
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
  const decisions = Object.fromEntries(plan.conflicts.map(c => [c.id, { action: 'replace', source_sha256: incoming.sha256 }]))
  assert.equal((await applyStateMerge({ storage, plan, decisions })).status, 'rollback_failed')
  assert.deepEqual(JSON.parse(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)), createEmptyDiscoveryWorkspaceState())
})

for (const failedOwner of ['direction_snapshot', 'discovery_workspace']) {
  test(`missing discovery stays missing when ${failedOwner} fails before a replacement persists`, async () => {
    const state = emptyState(), original = stateStorage(state)
    original.values.delete(DISCOVERY_WORKSPACE_STORAGE_KEY)
    const storage = new FailingStorage(original, ({ key, value }) => failedOwner === 'direction_snapshot'
      ? key === 'research-console.direction-snapshot.v1' && value !== null
      : key === DISCOVERY_WORKSPACE_STORAGE_KEY && value.includes('result-1'))
    const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
    const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace()
    incomingState.direction_snapshot = validDirection()
    const incoming = await bundleFor(incomingState)
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
    const decisions = Object.fromEntries(plan.conflicts.map(c => [c.id, { action: 'replace', source_sha256: incoming.sha256 }]))
    assert.equal((await applyStateMerge({ storage, plan, decisions })).status, 'apply_failed_rolled_back')
    assert.equal(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY), null)
    assert.deepEqual((await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })).state, state)
  })
}

test('final readback detects concurrent owner drift, reverses discovery and reports that rollback is unproven', async () => {
  const state = emptyState(); state.discovery_workspace = discoveryWorkspace(1)
  const storage = stateStorage(state), originalSet = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    originalSet(key, value)
    if (key === 'research-console.agent-task-input.v1' && JSON.parse(value).snapshots.length) {
      storage.values.set('research-console.paper-user-tags.v1', JSON.stringify({ version: 1, papers: { 'Paper-01': ['unexpected'] } }))
    }
  }
  const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(2)
  incomingState.agent_task_input.snapshots = [validTaskSnapshot()]
  const current = await bundleFor(state, ORIGINS[0]), incoming = await bundleFor(incomingState)
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
  const result = await applyStateMerge({ storage, plan, decisions: { discovery_workspace: { action: 'replace', source_sha256: incoming.sha256 } } })
  assert.equal(result.status, 'rollback_failed')
  const after = (await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })).state
  assert.deepEqual(after.discovery_workspace, state.discovery_workspace)
  assert.deepEqual(after.agent_task_input, state.agent_task_input)
  assert.deepEqual(after.personal_tags.papers, { 'Paper-01': ['unexpected'] })
})

test('rollback inspection retains discovery CAS and never overwrites a concurrent distinct workspace', async () => {
  const state = emptyState(); state.discovery_workspace = discoveryWorkspace(1)
  const concurrent = discoveryWorkspace(999)
  const storage = stateStorage(state), originalSet = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    originalSet(key, value)
    if (key === 'research-console.agent-task-input.v1' && JSON.parse(value).snapshots.length) {
      storage.values.set(DISCOVERY_WORKSPACE_STORAGE_KEY, JSON.stringify(concurrent))
    }
  }
  const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(2)
  incomingState.agent_task_input.snapshots = [validTaskSnapshot()]
  const current = await bundleFor(state, ORIGINS[0]), incoming = await bundleFor(incomingState)
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
  const result = await applyStateMerge({ storage, plan, decisions: { discovery_workspace: { action: 'replace', source_sha256: incoming.sha256 } } })
  assert.equal(result.status, 'rollback_failed')
  assert.deepEqual(JSON.parse(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)), concurrent)
  assert.deepEqual((await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })).state.agent_task_input, state.agent_task_input)
})

test('later owner failure restores all seven owners including persisted loading; discovery rollback failure is not claimed restored', async () => {
  for (const failRollback of [false, true]) {
    const state = emptyState(); state.discovery_workspace = discoveryWorkspace(7)
    const incomingState = emptyState(); incomingState.discovery_workspace = discoveryWorkspace(8)
    incomingState.direction_snapshot = validDirection()
    incomingState.p02_workflow = acceptedAlgorithmWorkflow()
    incomingState.paper_workspace.shelf['Paper-01'] = ['related_work']
    incomingState.personal_tags.papers['Paper-01'] = ['incoming']
    const storage = new FailingStorage(stateStorage(state), ({ key, value }) => key === 'research-console.paper-user-tags.v1'
      && value.includes('incoming') || failRollback && key === DISCOVERY_WORKSPACE_STORAGE_KEY && JSON.parse(value).revision === 7)
    const current = await bundleFor(state, ORIGINS[0]), incoming = await bundleFor(incomingState)
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ['Paper-01'] })
    const decisions = Object.fromEntries(plan.conflicts.map(c => [c.id, { action: 'replace', source_sha256: incoming.sha256 }]))
    const result = await applyStateMerge({ storage, plan, decisions })
    assert.equal(result.status, failRollback ? 'rollback_failed' : 'apply_failed_rolled_back')
    const after = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
    if (!failRollback) assert.deepEqual(after.state, state)
    else assert.equal(after.state.discovery_workspace.revision, 8)
  }
})

test('new exports contain an empty seventh owner with verified counts', async () => {
  const bundle = await bundleFor(emptyState())
  assert.equal(bundle.version, 3)
  assert.equal(bundle.counts.discovery_results, 0)
  assert.equal(bundle.counts.discovery_external_candidates, 0)
  assert.equal(bundle.state.discovery_workspace.version, 1)
})

test("exportStateBundle emits the exact canonical empty envelope without touching excluded keys", async () => {
  const storage = new MemoryStorage({
    unrelated: "byte-identical",
    "research-console.agent-task-input.v1.pending.ABC": "pending-byte-identical",
    "research-console.p02-workflow.v1": JSON.stringify(createEmptyP02WorkflowState()),
  })

  const bundle = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })

  assert.deepEqual(Object.keys(bundle), [
    "schema", "version", "origin", "exported_at", "counts", "conflict_report", "state", "sha256",
  ])
  assert.deepEqual(bundle, {
    schema: "research-console.state-transfer",
    version: 3,
    origin: ORIGINS[0],
    exported_at: EXPORTED_AT,
    counts: {
      direction_snapshots: 0,
      workspace_shelf_entries: 0,
      workspace_reading_entries: 0,
      user_tag_assignments: 0,
      candidates: 0,
      agent_snapshots: 0,
      p02_accepted_stages: 0,
      discovery_results: 0,
      discovery_external_candidates: 0,
    },
    conflict_report: { status: "not_evaluated", conflicts: [] },
    state: emptyState(),
    sha256: bundle.sha256,
  })
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(Object.isFrozen(bundle), true)
  assert.equal(Object.isFrozen(bundle.state.paper_workspace), true)
  assert.equal(storage.getItem("unrelated"), "byte-identical")
  assert.equal(storage.getItem("research-console.agent-task-input.v1.pending.ABC"), "pending-byte-identical")
})

test("exportStateBundle emits v3 and recomputes all nine counts including accepted P02 stages", async () => {
  const state = emptyState()
  state.direction_snapshot = validDirection()
  state.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism"], "Paper-02": ["related_work"] },
    personalReading: { "Paper-01": "read" },
    selectedPaperId: "Paper-01",
  }
  state.personal_tags = { version: 1, papers: { "Paper-01": ["必读", "基线"], "Paper-02": ["理论"] } }
  state.discovery_candidates = { version: 1, candidates: [validCandidate()] }
  state.p02_workflow = acceptedAlgorithmWorkflow()

  const bundle = await exportStateBundle({
    storage: stateStorage(state),
    originLabel: ORIGINS[1],
    exportedAt: EXPORTED_AT,
  })

  assert.deepEqual(bundle.counts, {
    direction_snapshots: 1,
    workspace_shelf_entries: 2,
    workspace_reading_entries: 1,
    user_tag_assignments: 3,
    candidates: 1,
    agent_snapshots: 0,
    p02_accepted_stages: 1,
    discovery_results: 0,
    discovery_external_candidates: 0,
  })
})

test("exportStateBundle fails closed when P02 is missing, invalid, or storage is unavailable", async () => {
  await assert.rejects(
    () => exportStateBundle({ storage: new MemoryStorage(), originLabel: ORIGINS[0], exportedAt: EXPORTED_AT }),
    /状态无法导出/u,
  )

  for (const malformed of [
    new MemoryStorage({
      "research-console.p02-workflow.v1": "{not-json",
    }),
    new MemoryStorage({
      "research-console.p02-workflow.v1": JSON.stringify(createEmptyP02WorkflowState()),
      "research-console.direction-snapshot.v1": "{not-json",
    }),
  ]) {
    await assert.rejects(
      () => exportStateBundle({ storage: malformed, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT }),
      /状态无法导出/u,
    )
  }

  const unavailable = {
    get length() { throw new Error("private failure") },
    key() { throw new Error("private failure") },
    getItem() { throw new Error("private failure") },
  }
  await assert.rejects(
    () => exportStateBundle({ storage: unavailable, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT }),
    /状态无法导出/u,
  )
})

test("validateStateBundle accepts whitespace-varied bytes by canonical-body hash and returns an immutable clone", async () => {
  const exported = await bundleFor(emptyState(), ORIGINS[0])
  const raw = new TextEncoder().encode(`\n  ${JSON.stringify(exported, null, 2)}\n`)

  const validated = await validateStateBundle(raw)

  assert.deepEqual(validated, exported)
  assert.notEqual(validated, exported)
  assert.equal(Object.isFrozen(validated), true)
  assert.equal(Object.isFrozen(validated.counts), true)
})

test("validateStateBundle rejects envelope extras, count drift, state drift, and noncanonical declarations", async () => {
  const exported = await bundleFor(emptyState(), ORIGINS[0])
  const invalids = [
    { ...exported, extra: true },
    exactBundle(exported, { counts: { ...exported.counts, candidates: 1 } }),
    exactBundle(exported, { state: { ...exported.state, personal_tags: { version: 1, papers: { bad: [] } } } }),
    exactBundle(exported, { conflict_report: { status: "evaluated", conflicts: [] } }),
    exactBundle(exported, { origin: "http://localhost:4176" }),
    exactBundle(exported, { exported_at: "2026-09-01" }),
    exactBundle(exported, { sha256: "A".repeat(64) }),
  ]

  for (const value of invalids) {
    await assert.rejects(() => validateStateBundle(JSON.stringify(value)), /状态迁移文件无效/u)
  }
})

test("validateStateBundle accepts a strict legacy v1 bundle while preview preserves the current P02 document", async () => {
  const currentState = emptyState()
  currentState.p02_workflow = acceptedAlgorithmWorkflow("当前端口的 P02 目标")
  const current = await bundleFor(currentState, ORIGINS[0])
  const incomingState = emptyState()
  incomingState.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  incomingState.p02_workflow = acceptedAlgorithmWorkflow("旧文件中本不应存在的 P02")
  const legacy = await legacyV1BundleFromV2(await bundleFor(incomingState, ORIGINS[1]))

  assert.equal(legacy.version, 1)
  assert.equal("p02_workflow" in legacy.state, false)
  assert.equal("p02_accepted_stages" in legacy.counts, false)
  const plan = await previewStateMerge({ current, bundles: [legacy], knownPaperIds: ["Paper-01"] })

  assert.deepEqual(plan.proposed_state.p02_workflow, currentState.p02_workflow)
  assert.equal(plan.conflicts.some(({ group }) => group === "p02_workflow"), false)
  await assert.rejects(
    () => previewStateMerge({ current: legacy, bundles: [current], knownPaperIds: ["Paper-01"] }),
    /当前.*P02|当前.*v2|当前状态/u,
  )
})

test("v2 P02 differences are whole-document conflicts that keep current unless replace is explicit", async () => {
  const currentState = emptyState()
  currentState.p02_workflow = acceptedAlgorithmWorkflow("当前方案")
  const incomingState = emptyState()
  incomingState.p02_workflow = acceptedAlgorithmWorkflow("导入方案")
  const keepStorage = stateStorage(currentState)
  const current = await exportStateBundle({ storage: keepStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const keepPlan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
  const conflict = keepPlan.conflicts.find(({ group }) => group === "p02_workflow")

  assert.deepEqual(conflict, {
    id: "p02_workflow",
    group: "p02_workflow",
    kind: "whole_document",
    identity: "P02 workflow",
    sources: [{ origin: ORIGINS[1], sha256: incoming.sha256 }],
    allowed_actions: ["skip", "replace"],
  })
  assert.deepEqual(keepPlan.proposed_state.p02_workflow, currentState.p02_workflow)
  const kept = await applyStateMerge({
    storage: keepStorage,
    plan: keepPlan,
    decisions: { p02_workflow: { action: "skip" } },
  })
  assert.deepEqual(kept.state.p02_workflow, currentState.p02_workflow)

  const replaceStorage = stateStorage(currentState)
  const replaceCurrent = await exportStateBundle({ storage: replaceStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const replacePlan = await previewStateMerge({ current: replaceCurrent, bundles: [incoming], knownPaperIds: [] })
  const replaced = await applyStateMerge({
    storage: replaceStorage,
    plan: replacePlan,
    decisions: { p02_workflow: { action: "replace", source_sha256: incoming.sha256 } },
  })
  assert.deepEqual(replaced.state.p02_workflow, incomingState.p02_workflow)
  assert.deepEqual(
    JSON.parse(replaceStorage.getItem("research-console.p02-workflow.v1")),
    incomingState.p02_workflow,
  )
})

test("validateStateBundle enforces the 16 MiB raw-byte ceiling before parsing", async () => {
  const oversized = new Uint8Array((16 * 1024 * 1024) + 1)
  oversized.fill(0x20)
  await assert.rejects(() => validateStateBundle(oversized), /状态迁移文件过大/u)
  await assert.rejects(
    () => validateStateBundle(Uint8Array.from([0xc3, 0x28])),
    /状态迁移文件无效/u,
  )
})

test("exportStateBundle refuses to create a bundle that cannot pass its own 16 MiB ceiling", async () => {
  const state = emptyState()
  const snapshot = validTaskSnapshot({ title: "A".repeat(17 * 1024 * 1024) })
  state.agent_task_input = { version: 1, current_snapshot_id: null, snapshots: [snapshot] }
  await assert.rejects(
    () => bundleFor(state, ORIGINS[0]),
    /大小限制.*状态无法导出/u,
  )
})

test("previewStateMerge sorts sources deterministically and binds an immutable six-state plan", async () => {
  const currentState = emptyState()
  const from4178 = emptyState()
  from4178.direction_snapshot = validDirection("2026-08-30T09:00:00.000Z")
  const from4177 = emptyState()
  from4177.direction_snapshot = validDirection("2026-08-30T07:00:00.000Z")

  const current = await bundleFor(currentState, ORIGINS[0])
  const laterOrigin = await bundleFor(from4178, ORIGINS[2], "2026-08-29T00:00:00.000Z")
  const earlierOrigin = await bundleFor(from4177, ORIGINS[1], "2026-09-01T12:00:00.000Z")
  const plan = await previewStateMerge({ current, bundles: [laterOrigin, earlierOrigin], knownPaperIds: [] })

  assert.equal(plan.schema, "research-console.state-transfer-plan")
  assert.deepEqual(plan.bundle_sha256s, [earlierOrigin.sha256, laterOrigin.sha256])
  assert.deepEqual(plan.proposed_state, currentState)
  assert.deepEqual(plan.conflicts, [{
    id: "direction_snapshot",
    group: "direction_snapshot",
    kind: "whole_document",
    identity: "P02",
    sources: [
      { origin: ORIGINS[1], sha256: earlierOrigin.sha256 },
      { origin: ORIGINS[2], sha256: laterOrigin.sha256 },
    ],
    allowed_actions: ["skip", "replace"],
  }])
  assert.equal(Object.isFrozen(plan), true)
  assert.equal(Object.isFrozen(plan.conflicts[0].sources), true)
  assert.match(plan.current_state_sha256, /^[a-f0-9]{64}$/u)
})

test("previewStateMerge rejects duplicate origins, too many bundles, and over-32-MiB validated input", async () => {
  const current = await bundleFor(emptyState(), ORIGINS[0])
  const first = await bundleFor(emptyState(), ORIGINS[1])
  const duplicate = await bundleFor(emptyState(), ORIGINS[1], "2026-09-01T00:00:01.000Z")
  await assert.rejects(
    () => previewStateMerge({ current, bundles: [first, duplicate], knownPaperIds: [] }),
    /来源重复/u,
  )
  await assert.rejects(
    () => previewStateMerge({ current, bundles: [first, first, first, first], knownPaperIds: [] }),
    /一至三个/u,
  )

  const large = []
  for (let index = 0; index < 3; index += 1) {
    const exported = await bundleFor(emptyState(), ORIGINS[index], `2026-09-01T00:00:0${index}.000Z`)
    const json = JSON.stringify(exported)
    large.push(await validateStateBundle(`${json}${" ".repeat((11 * 1024 * 1024) - json.length)}`))
  }
  await assert.rejects(
    () => previewStateMerge({ current, bundles: large, knownPaperIds: [] }),
    /总大小过大/u,
  )
})

test("personal tags merge current spelling/order first and report unknown/capacity exclusions", async () => {
  const currentState = emptyState()
  currentState.personal_tags = { version: 1, papers: { "Paper-01": ["必读", "Baseline"] } }
  const incomingState = emptyState()
  incomingState.personal_tags = {
    version: 1,
    papers: {
      "Paper-01": ["必读", "BASELINE", "补充"],
      "Paper-02": ["未知论文标签"],
    },
  }
  const current = await bundleFor(currentState, ORIGINS[0])
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01"] })

  assert.deepEqual(plan.proposed_state.personal_tags, {
    version: 1,
    papers: { "Paper-01": ["必读", "Baseline", "补充"] },
  })
  assert.deepEqual(plan.exclusions, [{
    id: "personal-tags-exclusion-001",
    group: "personal_tags",
    kind: "unknown_paper",
    identity: "Paper-02",
    source: { origin: ORIGINS[1], sha256: incoming.sha256 },
  }])
})

test("personal tags and candidates exclude additions at their existing capacity boundaries", async () => {
  const currentState = emptyState()
  currentState.personal_tags = {
    version: 1,
    papers: { "Paper-01": Array.from({ length: 20 }, (_, index) => `标签${index}`) },
  }
  currentState.discovery_candidates = {
    version: 1,
    candidates: Array.from({ length: 100 }, (_, index) => validCandidate({
      paperId: `W${1000 + index}`,
      doi: `10.1000/item-${index}`,
      title: `Current ${index}`,
    })),
  }
  const incomingState = emptyState()
  incomingState.personal_tags = { version: 1, papers: { "Paper-01": ["新增"] } }
  incomingState.discovery_candidates = {
    version: 1,
    candidates: [validCandidate({ paperId: "W9999", doi: "10.1000/new", title: "New" })],
  }
  const current = await bundleFor(currentState, ORIGINS[0])
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01"] })

  assert.deepEqual(plan.proposed_state.personal_tags, currentState.personal_tags)
  assert.deepEqual(plan.proposed_state.discovery_candidates, currentState.discovery_candidates)
  assert.equal(plan.exclusions.filter(({ kind }) => kind === "capacity_limit").length, 2)
})

test("candidate connected identity mismatches are one hard skip-only conflict while exact duplicates are no-ops", async () => {
  const currentState = emptyState()
  currentState.discovery_candidates = {
    version: 1,
    candidates: [validCandidate({ paperId: "W1001", doi: "10.1000/a", title: "Current" })],
  }
  const sameState = emptyState()
  sameState.discovery_candidates = cloneForTest(currentState.discovery_candidates)
  const connectedState = emptyState()
  connectedState.discovery_candidates = {
    version: 1,
    candidates: [validCandidate({ paperId: "W1002", doi: "10.1000/a", title: "Different" })],
  }
  const current = await bundleFor(currentState, ORIGINS[0])
  const same = await bundleFor(sameState, ORIGINS[1])
  const connected = await bundleFor(connectedState, ORIGINS[2])
  const plan = await previewStateMerge({ current, bundles: [connected, same], knownPaperIds: [] })

  assert.deepEqual(plan.proposed_state.discovery_candidates, currentState.discovery_candidates)
  const conflict = plan.conflicts.find(({ group }) => group === "discovery_candidates")
  assert.ok(conflict)
  assert.deepEqual(conflict.allowed_actions, ["skip"])
  assert.match(conflict.identity, /openalex:W1001/u)
  assert.match(conflict.identity, /openalex:W1002/u)
  assert.match(conflict.identity, /doi:10\.1000\/a/u)
})

test("candidate merge preserves the current queue order even when imports are empty or exact duplicates", async () => {
  const currentState = emptyState()
  currentState.discovery_candidates = {
    version: 1,
    candidates: [
      validCandidate({ paperId: "W9", doi: "10.1000/nine", title: "Nine" }),
      validCandidate({ paperId: "W1", doi: "10.1000/one", title: "One" }),
    ],
  }
  const duplicateState = emptyState()
  duplicateState.discovery_candidates = {
    version: 1,
    candidates: [cloneForTest(currentState.discovery_candidates.candidates[1])],
  }
  const current = await bundleFor(currentState, ORIGINS[0])
  const empty = await bundleFor(emptyState(), ORIGINS[1])
  const duplicate = await bundleFor(duplicateState, ORIGINS[2])
  const plan = await previewStateMerge({ current, bundles: [duplicate, empty], knownPaperIds: [] })

  assert.deepEqual(
    plan.proposed_state.discovery_candidates.candidates.map(({ paperId }) => paperId),
    ["W9", "W1"],
  )
})

test("Agent snapshots union by id, preserve a null current pointer, and hard-skip a body mismatch", async () => {
  const shared = validTaskSnapshot()
  const currentState = emptyState()
  currentState.agent_task_input = { version: 1, current_snapshot_id: null, snapshots: [shared] }
  const incomingState = emptyState()
  incomingState.agent_task_input = {
    version: 1,
    current_snapshot_id: shared.snapshot_id,
    snapshots: [{ ...shared, papers: [{ ...shared.papers[0], title_zh: "不同正文" }] }],
  }
  const current = await bundleFor(currentState, ORIGINS[0])
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01"] })

  assert.deepEqual(plan.proposed_state.agent_task_input, currentState.agent_task_input)
  const snapshotConflict = plan.conflicts.find(({ kind }) => kind === "snapshot_body_mismatch")
  assert.ok(snapshotConflict)
  assert.deepEqual(snapshotConflict.allowed_actions, ["skip"])
  assert.equal(plan.conflicts.some(({ kind }) => kind === "current_pointer"), false)
  assert.equal(plan.exclusions.some(({ kind }) => kind === "pointer_target_conflicted"), true)
})

test("applyStateMerge requires exact decisions, applies whole documents explicitly, and consumes a plan once", async () => {
  const currentState = emptyState()
  currentState.direction_snapshot = validDirection("2026-08-30T07:00:00.000Z")
  currentState.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["algorithm_mechanism"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  const incomingState = emptyState()
  incomingState.direction_snapshot = validDirection("2026-08-30T09:00:00.000Z")
  incomingState.paper_workspace = {
    version: 1,
    shelf: { "Paper-02": ["related_work"] },
    personalReading: { "Paper-02": "read" },
    selectedPaperId: "Paper-02",
  }
  incomingState.personal_tags = { version: 1, papers: { "Paper-01": ["必读"] } }
  const storage = stateStorage(currentState, { unrelated: "preserve" })
  storage.setItem("research-console.agent-task-input.v1.pending.PRIVATE", "pending-preserve")
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01", "Paper-02"] })
  const directionConflict = plan.conflicts.find(({ group }) => group === "direction_snapshot")
  const workspaceConflict = plan.conflicts.find(({ group }) => group === "paper_workspace")

  await assert.rejects(
    () => applyStateMerge({ storage, plan, decisions: { [directionConflict.id]: { action: "skip" } } }),
    /不完整/u,
  )
  const result = await applyStateMerge({
    storage,
    plan,
    decisions: {
      [directionConflict.id]: { action: "replace", source_sha256: incoming.sha256 },
      [workspaceConflict.id]: { action: "skip" },
    },
  })
  assert.equal(result.status, "success")
  assert.deepEqual(result.state.direction_snapshot, incomingState.direction_snapshot)
  assert.deepEqual(result.state.paper_workspace, currentState.paper_workspace)
  assert.deepEqual(result.state.personal_tags, incomingState.personal_tags)
  assert.equal(storage.getItem("unrelated"), "preserve")
  assert.equal(storage.getItem("research-console.agent-task-input.v1.pending.PRIVATE"), "pending-preserve")
  await assert.rejects(
    () => applyStateMerge({ storage, plan, decisions: {} }),
    /已使用/u,
  )
})

test("applyStateMerge rejects extra and invalid replacement decisions before writes", async () => {
  const currentState = emptyState()
  const incomingState = emptyState()
  incomingState.direction_snapshot = validDirection()
  const storage = stateStorage(currentState)
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
  const conflict = plan.conflicts[0]
  const before = storage.writes

  await assert.rejects(
    () => applyStateMerge({
      storage,
      plan,
      decisions: { [conflict.id]: { action: "skip" }, extra: { action: "skip" } },
    }),
    /不完整/u,
  )
  await assert.rejects(
    () => applyStateMerge({
      storage,
      plan,
      decisions: { [conflict.id]: { action: "replace", source_sha256: "0".repeat(64) } },
    }),
    /替换来源无效/u,
  )
  assert.equal(storage.writes, before)
})

test("applyStateMerge performs a semantic no-op without materializing missing stores", async () => {
  const storage = new MemoryStorage({
    unrelated: "preserve",
    "research-console.p02-workflow.v1": JSON.stringify(createEmptyP02WorkflowState()),
  })
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(emptyState(), ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
  const before = Object.fromEntries(storage.values)
  const writes = storage.writes
  const result = await applyStateMerge({ storage, plan, decisions: {} })

  assert.equal(result.status, "success")
  assert.equal(storage.writes, writes)
  assert.deepEqual(Object.fromEntries(storage.values), before)
})

test("Agent current pointer changes only after an explicit surviving-source replacement", async () => {
  const first = validTaskSnapshot({ nonce: "ABCDEFGHIJKLMNOP" })
  const second = validTaskSnapshot({ nonce: "QRSTUVWXYZABCDEF", createdAt: "2026-08-30T09:00:00.000Z" })
  const currentState = emptyState()
  currentState.agent_task_input = { version: 1, current_snapshot_id: first.snapshot_id, snapshots: [first] }
  const incomingState = emptyState()
  incomingState.agent_task_input = { version: 1, current_snapshot_id: second.snapshot_id, snapshots: [second] }
  const storage = stateStorage(currentState)
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01"] })
  const pointer = plan.conflicts.find(({ kind }) => kind === "current_pointer")

  assert.deepEqual(plan.proposed_state.agent_task_input.snapshots.map(({ snapshot_id }) => snapshot_id), [
    first.snapshot_id, second.snapshot_id,
  ])
  assert.equal(plan.proposed_state.agent_task_input.current_snapshot_id, first.snapshot_id)
  const result = await applyStateMerge({
    storage,
    plan,
    decisions: { [pointer.id]: { action: "replace", source_sha256: incoming.sha256 } },
  })
  assert.equal(result.status, "success")
  assert.equal(result.state.agent_task_input.current_snapshot_id, second.snapshot_id)
})

test("applyStateMerge detects a stale approved state before the first write", async () => {
  const state = emptyState()
  const storage = stateStorage(state)
  const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(emptyState(), ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
  storage.setItem("research-console.paper-library.v1", JSON.stringify({
    version: 1, shelf: { "Paper-01": ["related_work"] }, personalReading: {}, selectedPaperId: null,
  }))
  const before = storage.writes
  await assert.rejects(
    () => applyStateMerge({ storage, plan, decisions: {} }),
    (error) => error?.code === "stale_plan",
  )
  assert.equal(storage.writes, before)
})

test("applyStateMerge detects P02 staleness before writes and includes P02 in proven rollback", async () => {
  const currentState = emptyState()
  currentState.p02_workflow = acceptedAlgorithmWorkflow("回滚前方案")
  const incomingState = emptyState()
  incomingState.p02_workflow = acceptedAlgorithmWorkflow("拟替换方案")
  incomingState.personal_tags = { version: 1, papers: { "Paper-01": ["触发后续失败"] } }

  const staleStorage = stateStorage(currentState)
  const staleCurrent = await exportStateBundle({ storage: staleStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const stalePlan = await previewStateMerge({ current: staleCurrent, bundles: [incoming], knownPaperIds: ["Paper-01"] })
  staleStorage.setItem("research-console.p02-workflow.v1", JSON.stringify(acceptedAlgorithmWorkflow("预览后已变化")))
  const before = staleStorage.writes
  await assert.rejects(
    () => applyStateMerge({
      storage: staleStorage,
      plan: stalePlan,
      decisions: { p02_workflow: { action: "skip" } },
    }),
    (error) => error?.code === "stale_plan",
  )
  assert.equal(staleStorage.writes, before)

  const rollbackStorage = new FailingStorage(stateStorage(currentState), ({ key, value }) => (
    key === "research-console.paper-user-tags.v1" && value.includes("触发后续失败")
  ))
  const rollbackCurrent = await exportStateBundle({ storage: rollbackStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const rollbackPlan = await previewStateMerge({ current: rollbackCurrent, bundles: [incoming], knownPaperIds: ["Paper-01"] })
  const result = await applyStateMerge({
    storage: rollbackStorage,
    plan: rollbackPlan,
    decisions: { p02_workflow: { action: "replace", source_sha256: incoming.sha256 } },
  })
  assert.equal(result.status, "apply_failed_rolled_back")
  assert.deepEqual(
    JSON.parse(rollbackStorage.getItem("research-console.p02-workflow.v1")),
    currentState.p02_workflow,
  )
})

test("applyStateMerge fails closed without writes when the live P02 document becomes missing or invalid", async () => {
  for (const replacement of [null, "{invalid-json"]) {
    const state = emptyState()
    const storage = stateStorage(state)
    const current = await exportStateBundle({ storage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
    const incoming = await bundleFor(emptyState(), ORIGINS[1])
    const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: [] })
    if (replacement === null) storage.removeItem("research-console.p02-workflow.v1")
    else storage.setItem("research-console.p02-workflow.v1", replacement)
    const writes = storage.writes

    await assert.rejects(
      () => applyStateMerge({ storage, plan, decisions: {} }),
      /状态无法导出/u,
    )
    assert.equal(storage.writes, writes)
  }
})

test("applyStateMerge reports proven rollback separately from an unprovable rollback", async () => {
  const currentState = emptyState()
  const incomingState = emptyState()
  incomingState.paper_workspace = {
    version: 1,
    shelf: { "Paper-01": ["related_work"] },
    personalReading: {},
    selectedPaperId: "Paper-01",
  }
  incomingState.personal_tags = { version: 1, papers: { "Paper-01": ["必读"] } }

  const rolledBackStorage = new FailingStorage(stateStorage(currentState), ({ key, value }) => (
    key === "research-console.paper-user-tags.v1" && value.includes("必读")
  ))
  const current = await exportStateBundle({ storage: rolledBackStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const incoming = await bundleFor(incomingState, ORIGINS[1])
  const plan = await previewStateMerge({ current, bundles: [incoming], knownPaperIds: ["Paper-01"] })
  const workspaceConflict = plan.conflicts.find(({ group }) => group === "paper_workspace")
  const rolledBack = await applyStateMerge({
    storage: rolledBackStorage,
    plan,
    decisions: { [workspaceConflict.id]: { action: "replace", source_sha256: incoming.sha256 } },
  })
  assert.equal(rolledBack.status, "apply_failed_rolled_back")
  await assert.rejects(
    () => applyStateMerge({
      storage: rolledBackStorage,
      plan,
      decisions: { [workspaceConflict.id]: { action: "replace", source_sha256: incoming.sha256 } },
    }),
    /已使用/u,
  )
  assert.deepEqual(
    (await exportStateBundle({ storage: rolledBackStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })).state,
    currentState,
  )

  const brokenRollbackStorage = new FailingStorage(stateStorage(currentState), ({ key, value }) => (
    key === "research-console.paper-user-tags.v1"
      || (key === "research-console.paper-library.v1" && value?.includes('"shelf":{}'))
  ))
  const brokenCurrent = await exportStateBundle({ storage: brokenRollbackStorage, originLabel: ORIGINS[0], exportedAt: EXPORTED_AT })
  const brokenPlan = await previewStateMerge({ current: brokenCurrent, bundles: [incoming], knownPaperIds: ["Paper-01"] })
  const brokenWorkspaceConflict = brokenPlan.conflicts.find(({ group }) => group === "paper_workspace")
  const broken = await applyStateMerge({
    storage: brokenRollbackStorage,
    plan: brokenPlan,
    decisions: { [brokenWorkspaceConflict.id]: { action: "replace", source_sha256: incoming.sha256 } },
  })
  assert.equal(broken.status, "rollback_failed")
})

function cloneForTest(value) {
  return JSON.parse(JSON.stringify(value))
}

class FailingStorage extends MemoryStorage {
  constructor(source, shouldFail = () => false) {
    super(Object.fromEntries(source.values))
    this.shouldFail = shouldFail
    this.writes = 0
  }

  setItem(key, value) {
    const nextWrite = this.writes + 1
    if (this.shouldFail({ key: String(key), value: String(value), writes: nextWrite })) {
      this.writes = nextWrite
      throw new Error("private storage failure")
    }
    super.setItem(key, value)
  }

  removeItem(key) {
    const nextWrite = this.writes + 1
    if (this.shouldFail({ key: String(key), value: null, writes: nextWrite })) {
      this.writes = nextWrite
      throw new Error("private storage failure")
    }
    super.removeItem(key)
  }
}
