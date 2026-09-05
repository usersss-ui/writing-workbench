import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryStorage, recordInput } from './discovery-test-fixtures.mjs'
import { normalizeDiscoveryRecord } from './discovery-record.mjs'

import { createEmptyDiscoveryWorkspaceState as empty, isValidDiscoveryWorkspaceState as valid,
  createDiscoveryWorkspaceStore as createStore, DISCOVERY_WORKSPACE_STORAGE_KEY as key,
  previewDiscoveryBatchCleanup as cleanup } from './discovery-workspace.mjs'
const time = '2026-09-05T00:00:00.000Z'
const copy = value => structuredClone(value)

function batch(id = 'b-1') {
  const query = { query_id: 'q-1', expression: 'distributed optimization', condition_ids: ['c-1'], kind: 'single' }
  return { batch_id: id, created_at: time, scope: { startYear: null, endYear: null, language: 'all' },
    plan: { conditions: [{ id: 'c-1', label: 'Problem', terms: ['Distributed Optimization'], role: 'problem' }],
      selected: [query], suggested: [], warnings: [] }, rule_snapshot: empty().rules,
    queries: [{ query: copy(query), cursor: null, total: null, accepted_cursors: [], loaded: 0, status: 'idle', error: null }],
    record_ids: [], excluded_record_ids: [] }
}
function workspace(count = 1) {
  const state = empty()
  state.batches.push(batch())
  for (let i = 1; i <= count; i++) {
    const id = `r-${i}`
    state.records.push(normalizeDiscoveryRecord(recordInput({ record_id: id })))
    state.batches[0].record_ids.push(id)
    state.results.push({ result_id: `result-${i}`, record_ids: [id], preferred_record_id: id,
      alias_ids: [], identity_status: 'clear', conflicts: [] })
  }
  return state
}
const evidence = (record = 'r-1') => ({ record_ids: [record], locator: 'Abstract', reason: 'Explicit statement', method: 'manual', checked_at: time })

function fullByteWorkspace(revision = 0) {
  const state = workspace(80); state.revision = revision
  for (const record of state.records) record.bibliography.abstract = '汉'.repeat(17000)
  let padding = 4194304 - Buffer.byteLength(JSON.stringify(state))
  assert.ok(padding > 0)
  // Warnings are genuine bounded persisted plan data, used to hit the byte boundary exactly.
  while (padding > 3) {
    const length = Math.min(9999, padding - (state.batches[0].plan.warnings.length ? 3 : 2))
    state.batches[0].plan.warnings.push('x'.repeat(length))
    padding = 4194304 - Buffer.byteLength(JSON.stringify(state))
  }
  if (padding) state.batches[0].plan.warnings[0] += 'x'.repeat(padding)
  assert.equal(Buffer.byteLength(JSON.stringify(state)), 4194304)
  return state
}

test('missing workspace is readable without materializing storage and all snapshots are defensive', () => {
  assert.equal(typeof createStore, 'function', 'workspace store must be implemented')
  const storage = memoryStorage(); const store = createStore(storage)
  assert.equal(key, 'research-console.discovery-workspace.v1')
  assert.deepEqual(store.readValidatedState(), { status: 'missing', state: empty() })
  assert.equal(storage.getItem(key), null)
  store.read().rules.category = 'Changed'
  assert.equal(store.read().rules.category, 'Automation & Control Systems')
  const input = workspace(); const result = store.commit(input)
  assert.equal(result.persisted, true); assert.equal(result.state.revision, 1)
  input.records[0].bibliography.title = 'Changed'; result.state.records.length = 0
  assert.equal(store.read().records[0].bibliography.title, 'Synthetic distributed optimization study')
  const live = store.readValidatedState(); live.state.batches.length = 0
  assert.equal(store.read().batches.length, 1)
})

test('strict schema rejects accessors, symbols, exotic objects, sparse arrays and unknown fields without running getters', () => {
  for (const mutate of [s => { s.extra = true }, s => { s[Symbol('extra')] = true },
    s => { Object.setPrototypeOf(s.rules, null) }, s => { s.records.length = 2 },
    s => { s.batches[0].queries[0].extra = true }, s => { s.revision = -1 },
    s => { s.revision = Number.MAX_SAFE_INTEGER + 1 }, s => { s.version = 2 }]) {
    const state = workspace(); mutate(state); assert.equal(valid(state), false)
  }
  let calls = 0; const state = workspace()
  Object.defineProperty(state.records[0].bibliography, 'title', { enumerable: true, get() { calls++; return 'bad' } })
  assert.equal(valid(state), false); assert.equal(calls, 0)
  const store = createStore(memoryStorage()); assert.throws(() => store.replaceValidated(state), TypeError)
  assert.throws(() => store.commit(state), TypeError)
})

test('cross references reject orphan records, wrong query bodies, duplicate ownership and alias cycles', () => {
  assert.equal(valid(workspace()), true)
  for (const mutate of [s => s.records.push(copy(s.records[0])), s => s.results.push(copy(s.results[0])),
    s => s.batches.push(copy(s.batches[0])), s => { s.records[0].provenance.batch_id = 'missing' },
    s => { s.records[0].provenance.query_id = 'missing' }, s => { s.batches[0].record_ids = [] },
    s => { s.results[0].record_ids = ['missing'] }, s => { s.results[0].preferred_record_id = 'missing' },
    s => { s.results[0].alias_ids = ['result-1'] }, s => { s.results[0].alias_ids = ['result-2']; s.results[1].alias_ids = ['result-1'] },
    s => { s.results[1].record_ids = ['r-1']; s.results[1].preferred_record_id = 'r-1' },
    s => { s.batches[0].queries[0].query.expression = 'different meaning' },
    s => { s.batches[0].queries = [] }, s => { s.batches[0].excluded_record_ids = ['missing'] },
    s => { s.batches[0].scope.startYear = 2025; s.batches[0].scope.endYear = 2024 }]) {
    const state = workspace(2); mutate(state); assert.equal(valid(state), false, mutate.toString())
  }
  const reordered = workspace()
  reordered.batches[0].queries[0].query = Object.fromEntries(Object.entries(reordered.batches[0].queries[0].query).reverse())
  assert.equal(valid(reordered), true, 'object key order has no semantic meaning')
})

test('condition IDs retain normalized role and term set across batches while labels and term order may change', () => {
  const state = workspace(); state.batches.push(batch('b-2'))
  state.batches[0].plan.conditions[0].terms.push('ＡＢＣ')
  state.batches[1].plan.conditions[0].terms = ['abc', ' distributed   OPTIMIZATION ']
  state.batches[1].plan.conditions[0].label = 'Renamed'
  assert.equal(valid(state), true)
  state.batches[1].plan.conditions[0].role = 'method'; assert.equal(valid(state), false)
  state.batches[1].plan.conditions[0].role = 'problem'
  state.batches[1].plan.conditions[0].terms = ['other']; assert.equal(valid(state), false)
  const importOnly = workspace(); importOnly.batches[0].plan.selected = []; importOnly.batches[0].queries = []
  assert.equal(valid(importOnly), true)
})

test('aliases resolve to current results for evidence, candidates only reference current results, and split evidence cannot leak', () => {
  const state = workspace(2); state.results[0].alias_ids = ['old-result']
  state.condition_reviews.push({ result_id: 'old-result', condition_id: 'c-1', status: 'confirmed', evidence: evidence() })
  state.scope_reviews.push({ result_id: 'old-result', field: 'language', value: 'en', evidence: evidence() })
  state.representative_reviews.push({ result_id: 'old-result', role: 'origin', evidence: evidence() })
  state.external_candidates.push({ result_id: 'result-1', selected_at: time, openalex_id: 'https://openalex.org/W123' })
  assert.equal(valid(state), true)
  for (const field of ['condition_reviews', 'scope_reviews', 'representative_reviews']) {
    const bad = copy(state); bad[field][0].evidence.record_ids = ['r-2']; assert.equal(valid(bad), false)
  }
  state.external_candidates[0].result_id = 'old-result'; assert.equal(valid(state), false)
  state.external_candidates[0].result_id = 'result-1'; state.condition_reviews[0].condition_id = 'missing'
  assert.equal(valid(state), false)
})

test('persisted invalid or inaccessible documents are not overwritten and live reads observe storage', () => {
  const storage = memoryStorage([[key, '{bad']]); const store = createStore(storage)
  assert.equal(store.getLoadStatus(), 'invalid'); assert.equal(store.readValidatedState().status, 'invalid')
  assert.equal(store.replaceValidated(empty()).status, 'invalid'); assert.equal(storage.getItem(key), '{bad')
  storage.setItem(key, JSON.stringify(workspace())); assert.equal(store.readValidatedState().status, 'valid')
  assert.equal(store.reload().state.records.length, 1)
  const unavailable = createStore({ getItem() { throw new Error('blocked') } })
  assert.equal(unavailable.getLoadStatus(), 'unavailable')
  assert.equal(unavailable.readValidatedState().status, 'unavailable')
  assert.equal(unavailable.commit(empty()).reason, 'unavailable')
  assert.equal(createStore(null).readValidatedState().status, 'unavailable')
})

test('exact byte changes are stale even for semantically identical JSON and tabs cannot overwrite each other', () => {
  const storage = memoryStorage([[key, JSON.stringify(workspace())]])
  const a = createStore(storage); const b = createStore(storage)
  storage.setItem(key, JSON.stringify(workspace(), null, 2))
  assert.equal(a.commit(a.read()).reason, 'stale')
  a.reload(); assert.equal(a.commit(a.read()).state.revision, 1)
  assert.equal(b.replaceValidated(workspace()).status, 'stale')
  assert.equal(b.read().revision, 0)
  b.reload(); const next = b.read(); next.revision = 99
  assert.equal(b.commit(next).state.revision, 2)
  next.revision = 42; assert.equal(b.replaceValidated(next).state.revision, 42)
})

test('write proof accepts write-then-throw, rejects silent loss and proves rollback to original bytes or missing key', () => {
  const written = memoryStorage(); const set = written.setItem.bind(written)
  written.setItem = (k, v) => { set(k, v); throw new Error('after write') }
  assert.equal(createStore(written).commit(workspace()).persisted, true)
  const dropped = memoryStorage(); dropped.setItem = () => {}
  const droppedStore = createStore(dropped)
  assert.equal(droppedStore.commit(workspace()).reason, 'persistence_failed')
  assert.equal(droppedStore.read().records.length, 0); assert.equal(dropped.getItem(key), null)
  const corrupt = memoryStorage(); corrupt.setItem = (k, v) => corrupt.data.set(k, 'corrupted')
  const corruptStore = createStore(corrupt)
  assert.equal(corruptStore.commit(workspace()).reason, 'persistence_failed'); assert.equal(corrupt.getItem(key), null)
  const raw = JSON.stringify(empty(), null, 2); const restoring = memoryStorage([[key, raw]])
  let writes = 0; restoring.setItem = (k, v) => restoring.data.set(k, ++writes === 1 ? 'corrupted' : v)
  assert.equal(createStore(restoring).commit(workspace()).reason, 'persistence_failed')
  assert.equal(restoring.getItem(key), raw)
  const broken = memoryStorage(); broken.setItem = (k, v) => broken.data.set(k, 'corrupted')
  broken.removeItem = () => { throw new Error('cannot restore') }
  const brokenStore = createStore(broken)
  assert.equal(brokenStore.commit(workspace()).reason, 'rollback_failed')
  assert.equal(brokenStore.read().records.length, 0)
})

test('restoreMissingValidated removes only the owned key, proves throw-after-delete and resets its session and CAS baseline', () => {
  const initial = workspace(), storage = memoryStorage([[key, JSON.stringify(initial)], ['unrelated', 'preserved']])
  const store = createStore(storage)
  assert.equal(typeof store.restoreMissingValidated, 'function')
  const remove = storage.removeItem.bind(storage)
  storage.removeItem = target => { remove(target); throw Error('after delete') }
  assert.deepEqual(store.restoreMissingValidated(), { replaced: true, state: empty() })
  assert.equal(storage.getItem(key), null); assert.equal(storage.getItem('unrelated'), 'preserved')
  assert.equal(store.getLoadStatus(), 'missing'); assert.deepEqual(store.read(), empty())
  const committed = store.commit(initial)
  assert.equal(committed.persisted, true); assert.equal(committed.state.revision, 1)
})

test('restoreMissingValidated no-ops on an absent key without creating it', () => {
  const storage = memoryStorage(); let writes = 0
  storage.setItem = storage.removeItem = () => { writes++; throw Error('must not write') }
  const store = createStore(storage)
  assert.equal(store.restoreMissingValidated?.().replaced, true)
  assert.equal(writes, 0); assert.equal(storage.getItem(key), null)
})

for (const mode of ['drop-delete', 'throw-before-delete', 'corrupt-and-restore', 'rollback-fails']) {
  test(`restoreMissingValidated distinguishes deletion proof from ${mode}`, () => {
    const initial = workspace(), raw = JSON.stringify(initial, null, 2)
    const storage = memoryStorage([[key, raw]])
    const store = createStore(storage)
    storage.removeItem = () => {
      if (mode === 'throw-before-delete') throw Error('cannot delete')
      if (mode !== 'drop-delete') storage.data.set(key, '{damaged')
    }
    if (mode === 'rollback-fails') storage.setItem = () => { throw Error('cannot restore') }
    const result = store.restoreMissingValidated?.()
    assert.equal(result?.replaced, false)
    assert.equal(result.status, mode === 'rollback-fails' ? 'rollback_failed' : 'persistence_failed')
    assert.equal(storage.getItem(key), mode === 'rollback-fails' ? '{damaged' : raw)
    assert.deepEqual(store.read(), initial)
  })
}

test('restoreMissingValidated rejects invalid, unavailable and stale current bytes without deleting anything', () => {
  for (const mode of ['invalid', 'unavailable', 'stale-bytes', 'stale-missing']) {
    const initial = workspace(), raw = JSON.stringify(initial)
    const storage = memoryStorage(mode === 'stale-missing' ? [] : [[key, raw]])
    const store = createStore(storage); let writes = 0
    storage.removeItem = storage.setItem = () => { writes++ }
    if (mode === 'invalid') storage.data.set(key, '{invalid')
    if (mode === 'unavailable') storage.getItem = () => { throw Error('unavailable') }
    if (mode === 'stale-bytes') storage.data.set(key, JSON.stringify(initial, null, 2))
    if (mode === 'stale-missing') storage.data.set(key, raw)
    const result = store.restoreMissingValidated?.()
    assert.equal(result?.replaced, false)
    assert.equal(result.status, mode.startsWith('stale') ? 'stale' : mode)
    assert.equal(writes, 0)
  }
  const storage = memoryStorage([[key, JSON.stringify(workspace())]])
  storage.removeItem = undefined
  assert.equal(createStore(storage).restoreMissingValidated?.().status, 'unavailable')
})

test('loading batches recover interrupted in memory only and never schedule work', () => {
  const state = workspace(); state.batches[0].queries[0].status = 'loading'
  const raw = JSON.stringify(state); const storage = memoryStorage([[key, raw]])
  const store = createStore(storage)
  assert.equal(store.read().batches[0].queries[0].status, 'interrupted')
  assert.equal(store.readValidatedState().state.batches[0].queries[0].status, 'loading')
  assert.equal(storage.getItem(key), raw)
  assert.equal(store.reload().state.batches[0].queries[0].status, 'interrupted')
  assert.equal(store.commit(store.read()).persisted, true)
  assert.equal(JSON.parse(storage.getItem(key)).batches[0].queries[0].status, 'interrupted')
})

test('capacity limits count source records, sources per result, batches and exact UTF-8 bytes', () => {
  assert.equal(valid(workspace(1000)), true); assert.equal(valid(workspace(1001)), false)
  const many = workspace(11); many.results = [{ ...many.results[0], record_ids: many.records.map(r => r.record_id) }]
  assert.equal(valid(many), false); many.results[0].record_ids.pop(); many.results.push({ result_id: 'last', record_ids: ['r-11'], preferred_record_id: 'r-11', alias_ids: [], identity_status: 'clear', conflicts: [] })
  assert.equal(valid(many), true)
  const batches = empty(); batches.batches = Array.from({ length: 100 }, (_, i) => batch(`b-${i}`))
  assert.equal(valid(batches), true); batches.batches.push(batch('b-100')); assert.equal(valid(batches), false)
  const bytes = fullByteWorkspace()
  assert.equal(valid(bytes), true)
  const fullStorage = memoryStorage(); const fullStore = createStore(fullStorage)
  assert.equal(fullStore.commit(bytes).persisted, true)
  assert.equal(createStore(fullStorage).readValidatedState().status, 'valid')
  bytes.batches[0].plan.warnings[bytes.batches[0].plan.warnings.length - 1] += '汉'
  assert.equal(valid(bytes), false)
  const storage = memoryStorage(); const store = createStore(storage)
  assert.throws(() => store.commit(bytes), TypeError); assert.equal(storage.getItem(key), null)
})

test('evidence length bounds allow 2048 locator and 2000 reason and journal reviews reuse strict validation', () => {
  const state = workspace(); state.condition_reviews.push({ result_id: 'result-1', condition_id: 'c-1', status: 'confirmed', evidence: evidence() })
  state.condition_reviews[0].evidence.locator = 'x'.repeat(2048); state.condition_reviews[0].evidence.reason = 'x'.repeat(2000)
  assert.equal(valid(state), true); state.condition_reviews[0].evidence.locator += 'x'; assert.equal(valid(state), false)
  state.condition_reviews[0].evidence.locator = 'Abstract'; state.condition_reviews[0].evidence.reason += 'x'; assert.equal(valid(state), false)
  const journal = { review_id: 'j-1', title: 'Example', issns: ['1234-5678'], identity_confirmed: true, metric: 'JIF', data_year: 2025,
    release_year: 2026, category: 'Automation & Control Systems', quartile: 'Q1', source_url: null, import_description: 'User table', checked_at: time, method: 'user' }
  const reviewed = workspace(); reviewed.journal_reviews.push(journal); assert.equal(valid(reviewed), true)
  journal.metric = 'JCI'; assert.equal(valid(reviewed), false)
})

test('cleanup previews remove unprotected sources but preserve candidates, reviews, provenance and condition snapshots', () => {
  const state = workspace(3); state.batches.push(batch('b-2'))
  state.batches[1].record_ids = ['r-2']
  state.external_candidates.push({ result_id: 'result-1', selected_at: time, openalex_id: null })
  const before = copy(state); const preview = cleanup(state, 'b-1')
  assert.deepEqual(state, before)
  assert.equal(preview.removed_records, 1); assert.equal(preview.retained_records, 2)
  assert.equal(preview.removed_batches, 0); assert.equal(preview.retained_batches, 1)
  assert.deepEqual(preview.state.records.map(r => r.record_id), ['r-1', 'r-2'])
  assert.equal(preview.state.records[0].provenance.batch_id, 'b-1'); assert.equal(valid(preview.state), true)
  const reviewed = workspace(2); reviewed.condition_reviews.push({ result_id: 'result-2', condition_id: 'c-1', status: 'hint', evidence: null })
  const reviewedPreview = cleanup(reviewed, 'b-1')
  assert.deepEqual(reviewedPreview.state.records.map(r => r.record_id), ['r-2'])
  assert.equal(reviewedPreview.state.batches[0].plan.conditions[0].id, 'c-1')
  const disposable = workspace(); const removed = cleanup(disposable, 'b-1')
  assert.equal(removed.removed_batches, 1); assert.equal(removed.state.records.length, 0); assert.equal(valid(removed.state), true)
  assert.throws(() => cleanup(disposable, 'unknown'), TypeError)
})

test('confirmed reviews require evidence while unrecorded and hint reviews may omit it', () => {
  const state = workspace()
  state.condition_reviews.push({ result_id: 'result-1', condition_id: 'c-1', status: 'confirmed', evidence: null })
  assert.equal(valid(state), false)
  const store = createStore(memoryStorage()); assert.throws(() => store.commit(state), TypeError)
  state.condition_reviews[0].status = 'hint'; assert.equal(store.commit(state).persisted, true)
  assert.equal(store.read().condition_reviews[0].evidence, null)
  state.condition_reviews[0].status = 'unrecorded'; assert.equal(valid(state), true)
})

test('live validated reads refresh the byte baseline without replacing the old session view', () => {
  const storage = memoryStorage(); const store = createStore(storage)
  const external = workspace(); external.revision = 17
  storage.setItem(key, JSON.stringify(external, null, 2))
  assert.equal(store.commit(workspace()).reason, 'stale')
  const inspected = store.readValidatedState()
  assert.equal(inspected.state.revision, 17); assert.equal(store.read().revision, 0)
  const saved = store.commit(inspected.state)
  assert.equal(saved.persisted, true); assert.equal(saved.state.revision, 18)
})

test('batch queries and condition IDs use the shared strict plan limits', () => {
  const state = workspace(); const b = state.batches[0]
  const conditionId = 'c'.repeat(160), queryId = 'q'.repeat(2048)
  b.plan.conditions[0].id = conditionId; b.plan.selected[0].condition_ids = [conditionId]
  b.plan.selected[0].query_id = queryId; b.queries[0].query = copy(b.plan.selected[0])
  assert.equal(valid(state), true)
  b.plan.conditions[0].id += 'c'; assert.equal(valid(state), false)
  b.plan.conditions[0].id = conditionId
  b.plan.selected[0].query_id += 'q'; b.queries[0].query.query_id += 'q'; assert.equal(valid(state), false)
  const queries = workspace(); const first = queries.batches[0]
  first.plan.selected = Array.from({ length: 6 }, (_, i) => ({ ...first.plan.selected[0], query_id: `q-${i}` }))
  first.queries = first.plan.selected.map(query => ({ ...first.queries[0], query: copy(query) }))
  assert.equal(valid(queries), true)
  first.plan.selected.push({ ...first.plan.selected[0], query_id: 'q-7' }); first.queries.push({ ...first.queries[0], query: copy(first.plan.selected[6]) })
  assert.equal(valid(queries), false)
  for (const mutate of [q => { q.loaded = -1 }, q => { q.total = 0.5 }, q => { q.cursor = 17 },
    q => { q.status = 'saved' }, q => { q.error = false }, q => { q.accepted_cursors = ['a', 'a'] }]) {
    const bad = workspace(); mutate(bad.batches[0].queries[0]); assert.equal(valid(bad), false)
  }
})

test('cleanup retains a condition-only batch snapshot needed by a review on another batch result', () => {
  const state = workspace(2); state.batches.push(batch('b-2'))
  state.records[1].provenance.batch_id = 'b-2'; state.batches[0].record_ids = ['r-1']; state.batches[1].record_ids = ['r-2']
  state.batches[1].plan = { conditions: [], selected: [], suggested: [], warnings: [] }; state.batches[1].queries = []
  state.condition_reviews.push({ result_id: 'result-2', condition_id: 'c-1', status: 'hint', evidence: evidence('r-2') })
  const result = cleanup(state, 'b-1')
  assert.equal(result.removed_records, 1); assert.equal(result.retained_records, 0); assert.equal(result.retained_batches, 1)
  assert.equal(result.state.batches[0].record_ids.length, 0); assert.equal(result.state.batches[0].plan.conditions[0].id, 'c-1')
  assert.equal(valid(result.state), true)
})

test('merged aliases preserve conflicting and repeated review evidence for downstream adjudication', () => {
  const state = workspace(); state.results[0].alias_ids = ['old-result']
  state.condition_reviews = [
    { result_id: 'result-1', condition_id: 'c-1', status: 'confirmed', evidence: evidence() },
    { result_id: 'old-result', condition_id: 'c-1', status: 'false', evidence: evidence() },
  ]
  state.scope_reviews = [
    { result_id: 'result-1', field: 'language', value: 'en', evidence: evidence() },
    { result_id: 'old-result', field: 'language', value: 'zh', evidence: evidence() },
  ]
  state.representative_reviews = [
    { result_id: 'result-1', role: 'origin', evidence: evidence() },
    { result_id: 'old-result', role: 'origin', evidence: { ...evidence(), locator: 'Section 1' } },
  ]
  assert.equal(valid(state), true)
  const store = createStore(memoryStorage()); assert.equal(store.commit(state).persisted, true)
  assert.deepEqual(store.read().condition_reviews.map(review => review.status), ['confirmed', 'false'])
  assert.deepEqual(store.read().scope_reviews.map(review => review.value), ['en', 'zh'])
  assert.equal(cleanup(store.read(), 'b-1').retained_records, 1)
})

for (const [label, inputFactory] of [
  ['safe integer revision overflow', () => ({ ...workspace(), revision: Number.MAX_SAFE_INTEGER })],
  ['revision digit growth past the UTF-8 byte limit', () => fullByteWorkspace(9)],
]) {
  test(`commit reports invalid for derived ${label} without writes or session mutation`, () => {
    const input = inputFactory(); assert.equal(valid(input), true)
    const raw = JSON.stringify(input); const storage = memoryStorage([[key, raw]])
    const store = createStore(storage); const before = store.read()
    let writes = 0
    const originalSet = storage.setItem.bind(storage); const originalRemove = storage.removeItem.bind(storage)
    storage.setItem = (...args) => { writes++; originalSet(...args) }
    storage.removeItem = (...args) => { writes++; originalRemove(...args) }
    const result = store.commit(input)
    assert.deepEqual(result, { persisted: false, reason: 'invalid', state: before })
    assert.equal(writes, 0); assert.equal(storage.getItem(key), raw)
    assert.deepEqual(store.read(), before); assert.equal(store.getLoadStatus(), 'valid')
    result.state.revision = 123
    assert.deepEqual(store.read(), before)
  })
}
