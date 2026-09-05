import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, recordInput } from './discovery-test-fixtures.mjs'
import { createDiscoveryBatchController, validateDiscoveryQueryPlan } from './discovery-batch.mjs'

const timestamp = '2026-09-05T00:00:00.000Z'
const scope = { startYear: null, endYear: null, language: 'all' }
const plan = (...names) => ({ conditions: [], selected: names.map(name => ({
  query_id: name, expression: name, condition_ids: [], kind: 'original',
})), suggested: [], warnings: [] })
const page = (records = [], total = records.length, nextCursor = null) => ({ records, works: [], total, nextCursor })
const start = (c, ...names) => c.start({ plan: plan(...names), scope, sort: 'relevance' })
const tick = () => new Promise(resolve => setImmediate(resolve))
function controller(searchPage, onChange = () => {}) {
  let id = 0
  return createDiscoveryBatchController({ searchPage, onChange, now: () => timestamp, idFactory: () => `id-${++id}` })
}

// Removing generation isolation would allow this obsolete response to replace B's count.
test('late page from A cannot replace B', async () => {
  const a = deferred()
  const c = controller(args => args.query === 'A' ? a.promise : Promise.resolve(page()))
  const first = start(c, 'A')
  await start(c, 'B')
  a.resolve(page([], 100))
  await first
  assert.equal(c.read().batch?.queries[0]?.query.query_id, 'B')
  assert.equal(c.read().batch.queries[0].total, 0)
})

// An unlimited scheduler would launch all six, or automatically consume the next cursor.
test('starts at most two requests and only one page of 25 per selected query', async () => {
  const calls = []
  const c = controller(args => { const d = deferred(); calls.push({ args, ...d }); return d.promise })
  const pending = start(c, 'A', 'B', 'C', 'D', 'E', 'F')
  await tick()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(x => [x.args.query_id, x.args.cursor, x.args.perPage]), [['A', '*', 25], ['B', '*', 25]])
  calls[0].resolve(page([], 100, 'next-A'))
  await tick()
  assert.equal(calls.length, 3)
  calls[1].resolve(page())
  await tick()
  calls[2].resolve(page())
  await tick()
  calls[3].resolve(page())
  await tick()
  calls[4].resolve(page())
  await tick()
  calls[5].resolve(page())
  await pending
  assert.equal(calls.length, 6)
  assert.deepEqual(c.read().batch.queries.map(q => q.status), ['ready', 'finished', 'finished', 'finished', 'finished', 'finished'])
})

// Cancel must not rely on a cooperative provider or leave queued public promises pending.
test('cancel settles active and queued calls even when the provider ignores abort', async () => {
  const calls = []
  const c = controller(args => { calls.push(args); return new Promise(() => {}) })
  let settled = false
  const running = start(c, 'A', 'B', 'C').then(() => { settled = true })
  await tick()
  c.cancel()
  await tick()
  assert.equal(settled, true)
  await running
  assert.equal(calls.length, 2)
  assert.ok(calls.every(args => args.signal.aborted))
  assert.deepEqual(c.read().batch.queries.map(q => q.status), ['interrupted', 'interrupted', 'interrupted'])
  const before = calls.length
  await c.loadMore('A')
  assert.equal(calls.length, before)
})

// Obsolete finally blocks must not free slots owned by the new A generation.
test('A to B to A settles obsolete calls and ignores old rejection and finalization', async () => {
  const calls = []
  const c = controller(args => { const d = deferred(); calls.push({ args, ...d }); return d.promise })
  let firstSettled = false, secondSettled = false
  const first = start(c, 'A').then(() => { firstSettled = true })
  await tick()
  const second = start(c, 'B').then(() => { secondSettled = true })
  await tick()
  const third = start(c, 'A', 'C', 'D')
  await tick()
  assert.equal(firstSettled && secondSettled, true)
  calls[0].reject(new Error('obsolete 429'))
  calls[1].resolve(page([], 500))
  await tick()
  assert.equal(calls.length, 4)
  assert.equal(c.read().batch.queries[0].status, 'loading')
  calls[2].resolve(page([], 7))
  await tick()
  assert.equal(calls.length, 5)
  calls[3].resolve(page())
  calls[4].resolve(page())
  await Promise.all([first, second, third])
  assert.equal(c.read().batch.queries[0].total, 7)
})

function online(args, id, patch = {}) {
  const record = recordInput({ record_id: id })
  record.provenance = { ...record.provenance, provider: 'openalex', method: 'api', verification: 'api',
    batch_id: args.batch_id, query_id: args.query_id }
  return { ...record, ...patch }
}

// A shared cursor or duplicate enqueue would corrupt the other query or double its counters.
test('query cursors are independent and simultaneous loadMore calls share one request', async () => {
  const calls = []
  let more
  const c = controller(args => {
    calls.push(args)
    if (args.cursor === '*') return page([online(args, `first-${args.query_id}`)], args.query_id === 'A' ? 90 : 12, `next-${args.query_id}`)
    more = deferred()
    return more.promise
  })
  await start(c, 'A', 'B')
  const one = c.loadMore('B'), two = c.loadMore('B')
  await tick()
  assert.equal(calls.length, 3)
  assert.equal(calls[2].cursor, 'next-B')
  more.resolve(page([online(calls[2], 'second-B')], 12))
  await Promise.all([one, two])
  const state = c.read()
  assert.deepEqual(state.batch.queries.map(q => [q.cursor, q.loaded, q.total, q.accepted_cursors]),
    [['next-A', 1, 90, ['*']], [null, 2, 12, ['*', 'next-B']]])
  assert.equal(state.records.length, 3)
  assert.equal(state.results.length, 1)
  await c.loadMore('B')
  await c.retry('B')
  c.read(); c.read()
  assert.equal(calls.length, 3)
})

// A failed page must preserve previously accepted results, and retry the exact failed cursor once.
test('partial 429 failure preserves other queries and retry succeeds without duplicate acceptance', async () => {
  const cursors = []
  let fail = true
  const c = controller(args => {
    cursors.push([args.query_id, args.cursor])
    if (args.query_id === 'B' && fail) throw new Error('429 rate limited')
    return page([online(args, args.query_id)], 40, args.query_id === 'B' ? 'b' : null)
  })
  await start(c, 'A', 'B')
  assert.deepEqual(c.read().batch.queries.map(q => q.status), ['finished', 'failed'])
  assert.match(c.read().batch.queries[1].error, /429/)
  assert.equal(c.read().records.length, 1)
  fail = false
  await c.retry('B')
  await c.retry('B')
  assert.deepEqual(cursors, [['A', '*'], ['B', '*'], ['B', '*']])
  assert.equal(c.read().batch.queries[1].loaded, 1)
})

// Accepting counters before validating every record would consume a malformed page permanently.
test('malformed last record rejects a page atomically and permits a complete retry', async () => {
  let invalid = true
  const c = controller(args => {
    if (args.cursor === '*') return page([online(args, 'first')], 5, 'a')
    return page([online(args, 'second'), invalid ? { bad: true } : online(args, 'third')], 6)
  })
  await start(c, 'A')
  const before = c.read()
  await c.loadMore('A')
  assert.deepEqual(c.read().records, before.records)
  assert.deepEqual(c.read().results, before.results)
  assert.deepEqual(c.read().batch.queries[0].accepted_cursors, ['*'])
  assert.equal(c.read().batch.queries[0].cursor, 'a')
  assert.equal(c.read().batch.queries[0].loaded, 1)
  assert.equal(c.read().batch.queries[0].total, 5)
  assert.equal(c.read().batch.queries[0].status, 'failed')
  invalid = false
  await c.retry('A')
  assert.equal(c.read().records.length, 3)
  assert.equal(c.read().batch.queries[0].loaded, 3)
})

// Returning an earlier cursor must fail rather than silently declare completion.
test('multi-step cursor cycle is failed without accepting the cycling page', async () => {
  const c = controller(args => page([online(args, `record-${args.cursor}`)], 100, { '*': 'a', a: 'b', b: 'a' }[args.cursor]))
  await start(c, 'A')
  await c.loadMore('A')
  await c.loadMore('A')
  assert.equal(c.read().batch.queries[0].status, 'failed')
  assert.equal(c.read().batch.queries[0].cursor, 'b')
  assert.deepEqual(c.read().batch.queries[0].accepted_cursors, ['*', 'a'])
  assert.equal(c.read().records.length, 2)
})

// Imports must target the current batch without changing online totals, including import-only batches.
test('import-only batch supports idempotent current imports and rejects stale or foreign provenance', async () => {
  let calls = 0
  const c = controller(() => { calls++; return page() })
  await start(c)
  const { generation, batch } = c.read()
  const imported = recordInput()
  imported.provenance.batch_id = batch.batch_id
  imported.provenance.method = 'import'
  imported.provenance.import_id = 'import-1'
  assert.equal(c.acceptImported({ generation, records: [imported] }), true)
  assert.equal(c.acceptImported({ generation, records: [imported] }), true)
  assert.equal(c.read().records.length, 1)
  assert.deepEqual(c.read().batch.queries, [])
  assert.equal(calls, 0)
  await start(c, 'A')
  assert.equal(c.acceptImported({ generation, records: [imported] }), false)
  assert.equal(c.acceptImported({ generation: c.read().generation, records: [imported] }), false)
  const local = recordInput({ record_id: 'local' })
  local.provenance = { ...local.provenance, batch_id: c.read().batch.batch_id, provider: 'local', method: 'local' }
  assert.equal(c.acceptImported({ generation: c.read().generation, records: [local] }), true)
  assert.equal(c.read().batch.queries[0].loaded, 0)
  assert.equal(c.read().batch.queries[0].total, 0)
  c.cancel()
  assert.equal(c.acceptImported({ generation: c.read().generation, records: [local] }), false)
})

// Input and subscriber mutations must not mutate the controller's owned batch.
test('snapshots are defensive and rules and explicit original conditions retain the exact schema', async () => {
  const selected = plan('A')
  selected.conditions = [{ id: 'problem', label: 'Problem', terms: ['optimization'], role: 'problem' }]
  selected.selected[0].condition_ids = ['problem']
  const rules = { version: 1, data_year: 2024, category: 'Automation & Control Systems', low_match_limit: 5 }
  const c = controller(() => page(), snapshot => { if (snapshot.batch) snapshot.batch.plan.selected.length = 0 })
  await c.start({ plan: selected, scope, sort: 'relevance', rules })
  selected.selected[0].condition_ids.length = 0
  rules.data_year = 2020
  const snapshot = c.read()
  assert.deepEqual(Object.keys(snapshot).sort(), ['batch', 'generation', 'records', 'results'])
  assert.equal(snapshot.batch.rule_snapshot.data_year, 2024)
  assert.deepEqual(snapshot.batch.queries[0].query.condition_ids, ['problem'])
  snapshot.batch.queries[0].loaded = 88
  assert.equal(c.read().batch.queries[0].loaded, 0)
})

// Validation must happen before a partial batch sends its first external request.
test('rejects invalid plans and source identifiers before any network activity', async () => {
  let calls = 0
  const c = controller(() => { calls++; return page() })
  const invalid = [plan('A', 'B', 'C', 'D', 'E', 'F', 'G'), plan('A', 'A'), plan('x'.repeat(2049))]
  const foreign = plan('A'); foreign.selected[0].condition_ids = ['missing']; invalid.push(foreign)
  const extra = plan('A'); extra.selected[0].legacy = true; invalid.push(extra)
  for (const value of invalid) await assert.rejects(c.start({ plan: value, scope, sort: 'relevance' }))
  assert.equal(calls, 0)
  assert.equal(c.read().batch, null)
})

// An undefined language field must not produce a batch that violates the persisted Scope schema.
test('rejects an undefined scope language before creating a batch', async () => {
  let calls = 0
  const c = controller(() => { calls++; return page() })
  await assert.rejects(c.start({ plan: plan('A'), scope: { ...scope, language: undefined }, sort: 'relevance' }))
  assert.equal(calls, 0)
  assert.equal(c.read().batch, null)
})

// A merge exception after earlier incoming records must not leak partial identities or consume a cursor.
test('identity merge failure rolls back the complete page and retry is atomic', async () => {
  let serial = 0, rejectId = false
  const c = createDiscoveryBatchController({ now: () => timestamp,
    idFactory: () => { if (rejectId) throw new Error('identity allocation failed'); return `identity-${++serial}` },
    searchPage: args => {
      const fresh = online(args, `fresh-${args.cursor}`)
      fresh.bibliography = { ...fresh.bibliography, doi: '10.1234/different', title: 'Another synthetic study' }
      return args.cursor === '*' ? page([online(args, 'first')], 10, 'a')
        : page([online(args, 'duplicate-identity'), fresh], 12)
    } })
  await start(c, 'A')
  const before = c.read()
  rejectId = true
  await c.loadMore('A')
  const failed = c.read()
  assert.deepEqual(failed.records, before.records)
  assert.deepEqual(failed.results, before.results)
  assert.deepEqual(failed.batch.record_ids, ['first'])
  assert.deepEqual(failed.batch.queries[0].accepted_cursors, ['*'])
  assert.equal(failed.batch.queries[0].cursor, 'a')
  assert.equal(failed.batch.queries[0].loaded, 1)
  assert.equal(failed.batch.queries[0].total, 10)
  assert.equal(failed.batch.queries[0].status, 'failed')
  rejectId = false
  await c.retry('A')
  assert.equal(c.read().records.length, 3)
  assert.equal(c.read().results.length, 2)
  assert.equal(c.read().batch.queries[0].loaded, 3)
})

// Accepting any untrusted field before provenance/count/cursor validation would create false source evidence.
test('rejects foreign provenance and malformed page metadata without accepting records', async () => {
  const corruptions = [
    p => { p.records[0].provenance.batch_id = 'foreign' },
    p => { p.records[0].provenance.query_id = 'other' },
    p => { p.records[0].provenance.method = 'import' },
    p => { p.total = -1 },
    p => { p.nextCursor = '' },
    p => { p.extra = true },
    p => { p.records = Array.from({ length: 26 }, (_, i) => ({ ...p.records[0], record_id: `overflow-${i}` })) },
  ]
  for (const corrupt of corruptions) {
    const c = controller(args => { const response = page([online(args, 'record')]); corrupt(response); return response })
    await start(c, 'A')
    assert.equal(c.read().batch.queries[0].status, 'failed')
    assert.deepEqual(c.read().batch.queries[0].accepted_cursors, [])
    assert.equal(c.read().batch.queries[0].loaded, 0)
    assert.equal(c.read().batch.queries[0].total, null)
    assert.deepEqual(c.read().records, [])
  }
})

// Source collisions must remain visible, and excluded records remain traceable without changing source counts.
test('retains collision flags and out-of-scope source records across imports', async () => {
  const c = controller(args => page([online(args, 'online')], 80))
  await c.start({ plan: plan('A'), scope: { startYear: 2020, endYear: null, language: 'all' }, sort: 'newest' })
  const initial = c.read()
  const imported = recordInput({ record_id: 'outside' })
  imported.bibliography.year = 2019
  imported.provenance.batch_id = initial.batch.batch_id
  assert.equal(c.acceptImported({ generation: initial.generation, records: [imported] }), true)
  const after = c.read()
  assert.equal(after.records.length, 2)
  assert.deepEqual(after.batch.excluded_record_ids, ['outside'])
  assert.ok(after.results.every(result => result.identity_status === 'conflict'))
  assert.equal(after.batch.queries[0].loaded, 1)
  assert.equal(after.batch.queries[0].total, 80)
  assert.deepEqual(after.batch.rule_snapshot, { version: 1, data_year: null,
    category: 'Automation & Control Systems', low_match_limit: 5 })
})

// Discarding a generation must settle an exposed loadMore promise as well as the start aggregate.
test('replacement settles active loadMore without waiting for the obsolete provider', async () => {
  const c = controller(args => args.cursor === '*' ? page([], 100, 'a') : new Promise(() => {}))
  await start(c, 'A')
  let settled = false
  const more = c.loadMore('A').then(() => { settled = true })
  await tick()
  await start(c)
  await tick()
  assert.equal(settled, true)
  await more
  assert.deepEqual(c.read().batch.queries, [])
})

// Invalid external batches should neither cancel a running valid batch nor execute unsafe object accessors.
test('validation rejects accessors and invalid scope without disrupting an existing batch', async () => {
  const pending = deferred()
  let calls = 0, reads = 0
  const c = controller(() => { calls++; return pending.promise })
  const running = start(c, 'A')
  const invalid = plan('B')
  Object.defineProperty(invalid.selected[0], 'query_id', { enumerable: true, get() { reads++; return 'B' } })
  await assert.rejects(c.start({ plan: invalid, scope, sort: 'relevance' }))
  await assert.rejects(c.start({ plan: plan('B'), scope: { ...scope, startYear: 2025, endYear: 2020 }, sort: 'relevance' }))
  assert.equal(reads, 0)
  assert.equal(calls, 1)
  assert.equal(c.read().batch.queries[0].query.query_id, 'A')
  assert.equal(c.read().batch.queries[0].status, 'loading')
  pending.resolve(page([], 22))
  await running
  assert.equal(c.read().batch.queries[0].total, 22)
})

// External rendering failures must not reclassify a committed page as failed.
test('subscriber errors do not corrupt accepted pages and raw expressions remain verbatim', async () => {
  const raw = plan('A')
  raw.selected[0].expression = '  title:("distributed optimization")  '
  const c = controller(() => page([], 1), () => { throw new Error('render failed') })
  await c.start({ plan: raw, scope, sort: 'relevance' })
  assert.equal(c.read().batch.queries[0].status, 'finished')
  assert.equal(c.read().batch.plan.selected[0].expression, '  title:("distributed optimization")  ')
})

// Abort listeners can synchronously start a new batch; cleanup must retain its original owner.
test('cancel cleanup cannot clear a batch started synchronously by an abort listener', async () => {
  let replacement, settled = false
  const c = controller(args => {
    if (args.query === 'A') {
      args.signal.addEventListener('abort', () => { replacement = start(c, 'B').then(() => { settled = true }) })
      return new Promise(() => {})
    }
    return page([], 9)
  })
  const original = start(c, 'A')
  c.cancel()
  await tick()
  assert.equal(settled, true)
  await Promise.all([original, replacement])
  assert.equal(c.read().batch.queries[0].total, 9)
  assert.equal(c.read().batch.queries[0].status, 'finished')
})

// A later reentrant start must own the generation, and neither start promise may be stranded.
test('a reentrant start supersedes the start which triggered its abort listener', async () => {
  let newest, settled = false
  const c = controller(args => {
    if (args.query === 'A') {
      args.signal.addEventListener('abort', () => { newest = start(c, 'C').then(() => { settled = true }) })
      return new Promise(() => {})
    }
    return page([], args.query === 'C' ? 33 : 22)
  })
  const original = start(c, 'A')
  await start(c, 'B')
  await tick()
  assert.equal(settled, true)
  await Promise.all([original, newest])
  assert.equal(c.read().batch.queries[0].query.query_id, 'C')
  assert.equal(c.read().batch.queries[0].total, 33)
})

// Identity allocation may replace the batch; the old import must not commit into its successor.
test('rejects an import if identity allocation starts a replacement batch', async () => {
  let serial = 0, replace = false, replacement
  const c = createDiscoveryBatchController({ searchPage: () => page(), now: () => timestamp,
    idFactory: () => {
      const id = `import-race-${++serial}`
      if (replace) {
        replace = false
        replacement = start(c)
      }
      return id
    } })
  await start(c)
  const initial = c.read()
  const imported = recordInput()
  imported.provenance.batch_id = initial.batch.batch_id
  replace = true
  assert.equal(c.acceptImported({ generation: initial.generation, records: [imported] }), false)
  await replacement
  const next = c.read()
  assert.notEqual(next.generation, initial.generation)
  assert.notEqual(next.batch.batch_id, initial.batch.batch_id)
  assert.deepEqual(next.records, [])
  assert.deepEqual(next.results, [])
  assert.deepEqual(next.batch.record_ids, [])
})

// Cancellation during identity allocation must reject the import and preserve the last accepted snapshot.
test('rejects an import if identity allocation cancels the owning batch', async () => {
  let serial = 0, cancel = false
  const c = createDiscoveryBatchController({ searchPage: () => page(), now: () => timestamp,
    idFactory: () => {
      if (cancel) c.cancel()
      return `cancel-import-${++serial}`
    } })
  await start(c)
  const initial = c.read()
  const imported = recordInput()
  imported.provenance.batch_id = initial.batch.batch_id
  cancel = true
  assert.equal(c.acceptImported({ generation: initial.generation, records: [imported] }), false)
  const cancelled = c.read()
  assert.notEqual(cancelled.generation, initial.generation)
  assert.deepEqual(cancelled.records, initial.records)
  assert.deepEqual(cancelled.results, initial.results)
  assert.deepEqual(cancelled.batch, initial.batch)
})

// Pipe/space/oversized condition IDs can corrupt persisted condition references and quota group keys.
test('rejects condition IDs outside the planner grammar before starting any requests', async () => {
  let requests = 0
  const c = controller(() => { requests++; return page() })
  for (const id of ['left|right', 'with space', 'x'.repeat(161), '-leading', 'trailing-', 'double--dash']) {
    const invalid = plan('A')
    invalid.conditions = [{ id, label: 'Problem', terms: ['optimization'], role: 'problem' }]
    invalid.selected[0].condition_ids = [id]
    assert.throws(() => validateDiscoveryQueryPlan(invalid), TypeError)
    await assert.rejects(c.start({ plan: invalid, scope, sort: 'relevance' }), TypeError)
  }
  assert.equal(requests, 0)
  assert.equal(c.read().batch, null)
})

// Valid boundary IDs and generated axis IDs must remain usable as original-query condition references.
test('accepts planner condition ID boundaries without shrinking the query ID allowance', async () => {
  for (const id of ['x'.repeat(160), 'axis-problem-0-2', 'axis-topology-1', 'A9-b2']) {
    const valid = plan('q'.repeat(2048))
    valid.selected[0].expression = 'optimization'
    valid.conditions = [{ id, label: 'Problem', terms: ['optimization'], role: 'problem' }]
    valid.selected[0].condition_ids = [id]
    assert.deepEqual(validateDiscoveryQueryPlan(valid), valid)
    const c = controller(() => page())
    await c.start({ plan: valid, scope, sort: 'relevance' })
    assert.equal(c.read().batch.queries[0].status, 'finished')
    assert.deepEqual(c.read().batch.queries[0].query.condition_ids, [id])
  }
})
