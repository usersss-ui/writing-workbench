import test from 'node:test'
import assert from 'node:assert/strict'
import { makeElement, findElement, memoryStorage, recordInput, deferred } from './discovery-test-fixtures.mjs'
import { createDiscoveryWorkspaceStore, createEmptyDiscoveryWorkspaceState, DISCOVERY_WORKSPACE_STORAGE_KEY } from './discovery-workspace.mjs'
import { createCandidateStore } from './candidate-storage.mjs'
const ui = await import('./discovery-session-ui.mjs').catch(() => ({}))
function setup({ storage = memoryStorage(), searchPage, searchWorks, batchController, candidateStore, confirmArchive, fetchImpl, initialDirection } = {}) {
  const elements = new Map()
  for (const id of ['keyword-query', 'english-query', 'keyword-language', 'keyword-sort', 'keyword-start-year', 'keyword-end-year', 'keyword-live-search', 'keyword-load-more', 'keyword-search-status', 'actual-search-query', 'keyword-search-results', 'keyword-live-results-list', 'discovery-import-preview', 'discovery-review-panel', 'discovery-source-status', 'discovery-query-plan', 'discovery-history', 'discovery-status', 'discovery-export-preview']) elements.set(`#${id}`, makeElement())
  elements.get('#keyword-query').value = 'optimization'; elements.get('#keyword-language').value = 'all'; elements.get('#keyword-sort').value = 'relevance'
  const tabs = ['all', 'curated'].map(view => makeElement({ dataset: { discoveryView: view } }))
  const root = { elements, createElement: tagName => makeElement({ tagName }), querySelector: selector => elements.get(selector)
    ?? [...elements.values()].map(element => findElement(element, child => child?.id && selector === `#${child.id}`)).find(Boolean), querySelectorAll: selector => selector === '[data-discovery-view]' ? tabs : [] }
  let calls = 0
  const workspaceStore = createDiscoveryWorkspaceStore(storage)
  const session = ui.createDiscoverySessionUI({ root, workspaceStore, searchWorks, batchController, fetchImpl, initialDirection, candidateStore: candidateStore ?? { read: () => ({ candidates: [] }), add() { throw new Error('external select must not add old candidate') } }, confirmArchive,
    searchPage: searchPage ?? (async options => { calls++; const record = recordInput({ record_id: options.idFactory(), provider_id: 'W123', provenance: { ...recordInput().provenance, provider: 'openalex', method: 'api', verification: 'api', batch_id: options.batch_id, query_id: options.query_id } }); return { records: [record], works: [], total: 1, nextCursor: null } }), onQueueChange() {} })
  return { session, root, tabs, storage, workspaceStore, calls: () => calls }
}
test('default all view, keyboard tabs and read-only reload do not start new queries or create storage', async () => {
  assert.equal(typeof ui.createDiscoverySessionUI, 'function')
  const env = setup(); env.session.start(); assert.equal(env.storage.data.size, 0)
  await env.session.search(); assert.equal(env.session.getSnapshot().view, 'all')
  await env.tabs[0].dispatch('keydown', { key: 'ArrowRight' })
  assert.equal(env.session.getSnapshot().view, 'curated'); assert.equal(env.tabs[1].focusCount, 1); assert.equal(env.calls(), 1)
  const before = env.storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY); env.session.reload()
  assert.equal(env.storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY), before); assert.equal(env.calls(), 1)
})
test('repeated searches preserve global result and external candidate identity', async () => {
  assert.equal(typeof ui.createDiscoverySessionUI, 'function')
  const env = setup(); env.session.start(); await env.session.search()
  const id = env.session.getSnapshot().results[0].result_id; env.session.select(id)
  await env.session.search()
  assert.equal(env.session.getSnapshot().results[0].result_id, id)
  assert.equal(env.workspaceStore.read().external_candidates.length, 1)
  assert.equal(env.workspaceStore.read().batches.length, 2)
})
test('import preview cancellation and stale revision never overwrite another window', async () => {
  assert.equal(typeof ui.createDiscoverySessionUI, 'function')
  const env = setup(); env.session.start()
  await env.session.previewImport({ text: '@article{a,title={Imported title},doi={10.1234/import.1},year={2024}}', format: 'bibtex', provider: 'scholar' })
  assert.equal(env.workspaceStore.read().records.length, 0); env.session.cancelImport(); assert.equal(env.workspaceStore.read().records.length, 0)
  await env.session.previewImport({ text: '@article{a,title={Imported title},doi={10.1234/import.1},year={2024}}', format: 'bibtex', provider: 'scholar' })
  const other = createDiscoveryWorkspaceStore(env.storage); other.commit(other.read())
  assert.equal(env.session.confirmImport().persisted, false); assert.equal(other.read().records.length, 0)
  assert.match(env.root.elements.get('#discovery-import-preview').textContent, /已变化/)
})
test('failed search persistence retains temporary results and selected bibliography export', async () => {
  assert.equal(typeof ui.createDiscoverySessionUI, 'function')
  const storage = memoryStorage(); storage.setItem = () => { throw new Error('full') }
  const env = setup({ storage }); env.session.start(); await env.session.search()
  const snapshot = env.session.getSnapshot(); assert.equal(snapshot.results.length, 1); assert.equal(env.workspaceStore.read().records.length, 0)
  env.session.setExportSelected(snapshot.results[0].result_id, true)
  assert.match(env.session.exportSelected('bibtex'), /Synthetic distributed optimization study/)
})
test('late pages after invalidation cannot populate results or legacy compatibility cache', async () => {
  assert.equal(typeof ui.createDiscoverySessionUI, 'function')
  const pending = deferred(); const env = setup({ searchPage: () => pending.promise }); env.session.start()
  const running = env.session.search(); env.session.invalidate(); pending.resolve({ records: [], works: [{ paperId: 'W999' }], total: 0, nextCursor: null }); await running
  assert.equal(env.session.getSnapshot().results.length, 0); assert.deepEqual(env.session.getWorks(), [])
})

test('legacy injection stays declared and unknown in displayed and persisted records', async () => {
  const work = { paperId: 'W123', doi: null, title: 'Legacy study', authors: [], year: 2024, source: '', citations: 0, isOpenAccess: false, openAccessUrl: null, landingPageUrl: 'https://openalex.org/W123', topics: [], abstract: null }
  const env = setup({ searchWorks: async () => ({ works: [work], total: 1, nextCursor: null }) }); env.session.start(); await env.session.search()
  assert.equal(env.workspaceStore.read().records[0].provenance.verification, 'declared')
  assert.equal(env.session.getSnapshot().state.records[0].bibliography.citations, null)
  assert.equal(env.session.getSnapshot().state.records[0].bibliography.language, null)
  assert.equal(env.session.getSnapshot().state.records[0].retraction.state, 'unknown')
  assert.deepEqual(env.session.getWorks(), [work])
})

test('same source across expanded queries has unique results but independent loaded counts', async () => {
  const env = setup({ initialDirection: { conditions: [{ id: 'condition-a', label: 'Optimization', terms: ['optimization'], role: 'problem' }, { id: 'condition-b', label: 'Network', terms: ['network'], role: 'network' }] } })
  env.session.start(); env.root.querySelector('#discovery-expand').checked = true; await env.session.search()
  const snapshot = env.session.getSnapshot(); assert.equal(snapshot.results.length, 1); assert.ok(snapshot.batch.queries.length > 1)
  assert.equal(snapshot.batch.queries.every(query => query.loaded === 1), true); assert.equal(snapshot.state.records.length, snapshot.batch.queries.length)
})

test('changing a condition meaning mints a new identity and removing all does not restore old meanings', async () => {
  const env = setup({ initialDirection: { conditions: [{ id: 'condition-a', label: 'Optimization', terms: ['optimization'], role: 'problem' }] } })
  env.session.start(); await env.session.search(); const before = env.session.getSnapshot().batch.plan.conditions[0].id
  const area = env.root.elements.get('#discovery-query-plan'), input = findElement(area, node => node.tagName === 'INPUT' && node.value === 'optimization')
  input.value = 'control'; await env.session.search()
  assert.notEqual(env.session.getSnapshot().batch.plan.conditions[0].id, before)
  await findElement(area, node => node.tagName === 'BUTTON' && node.textContent === '移除此条件').dispatch('click')
  await env.session.search(); assert.equal(env.session.getSnapshot().batch.plan.conditions.length, 0)
})

test('editing an auto-filled direction expression clears its old declared meaning', async () => {
  const env = setup({ initialDirection: { conditions: [{ id: 'condition-a', label: 'Optimization', terms: ['optimization'], role: 'problem' }] } })
  env.session.start(); env.root.elements.get('#english-query').value = 'unrelated question'
  await env.root.elements.get('#english-query').dispatch('input'); await env.session.search()
  assert.deepEqual(env.session.getSnapshot().batch.plan.conditions, [])
})

test('cleanup preview shows exact counts and stale confirmation cannot delete a newer batch', async () => {
  const env = setup(); env.session.start(); await env.session.search()
  let area = env.root.elements.get('#discovery-history')
  await findElement(area, node => node.tagName === 'BUTTON' && node.textContent === '预览清理此批次').dispatch('click')
  assert.match(area.textContent, /移除 1 条/); assert.doesNotMatch(area.textContent, /undefined/)
  const confirm = findElement(area, node => node.dataset?.cleanupBatch)
  const other = createDiscoveryWorkspaceStore(env.storage); other.commit(other.read())
  await confirm.dispatch('click'); assert.equal(other.read().batches.length, 1)
})

test('local recall rejoins only a public bibliography projection and keeps non-DOI links out of DOI', async () => {
  const env = setup({ searchPage: async () => ({ records: [], works: [], total: 0, nextCursor: null }) }); env.session.start()
  env.session.updateLocal([{ paper_id: 'Local-01', title_original: 'Optimization test', authors: ['Example'], year: 2024,
    doi_or_url: 'https://example.org/local', unit_type: 'article', source_path: '/synthetic/private/source.pdf', artifact_availability: { note: true } }])
  await env.session.search(); const records = env.session.getSnapshot().state.records
  assert.equal(records.length, 1); assert.equal(records[0].bibliography.work_type, null); assert.equal(records[0].bibliography.doi, null)
  assert.doesNotMatch(JSON.stringify(records), /source_path|private\/source/)
})

const officialWork = patch => ({ id: 'https://openalex.org/W123', doi: '10.1234/fixture.1', title: 'Synthetic distributed optimization study', publication_year: 2024,
  authorships: [{ author: { display_name: 'API Author' } }], type: 'article', is_retracted: false, ...patch })
const fetchOfficial = patch => async () => ({ ok: true, status: 200, json: async () => officialWork(patch) })
async function selectedEnv(options = {}) { const env = setup({ fetchImpl: fetchOfficial(), confirmArchive: () => true, ...options }); env.session.start(); await env.session.search(); const resultId = env.session.getSnapshot().results[0].result_id; env.session.select(resultId); return { ...env, resultId } }

test('conversion rechecks generation after asynchronous confirmation and bridge rejects title conflicts', async () => {
  let adds = 0
  const candidateStore = { read: () => ({ candidates: [] }), add: () => { adds++; return { added: true, persisted: true } } }
  const confirmation = deferred(), env = await selectedEnv({ candidateStore, confirmArchive: () => confirmation.promise })
  const conversion = env.session.convert(env.resultId); await new Promise(resolve => setImmediate(resolve)); env.session.invalidate(); confirmation.resolve(true); await conversion
  assert.equal(adds, 0)
  const conflict = await selectedEnv({ candidateStore, fetchImpl: fetchOfficial({ title: 'Unrelated marine ecosystem biology' }) })
  await conflict.session.convert(conflict.resultId); assert.equal(adds, 0); assert.match(conflict.root.elements.get('#discovery-status').textContent, /title_mismatch/)
})

test('temporary legacy candidate is not saved and successful old write survives cross-reference failure', async () => {
  const temporary = await selectedEnv({ candidateStore: { read: () => ({ candidates: [] }), add: () => ({ added: true, persisted: false }) } })
  await temporary.session.convert(temporary.resultId)
  assert.equal(temporary.workspaceStore.read().external_candidates[0].openalex_id, null)
  assert.match(temporary.root.elements.get('#discovery-status').textContent, /尚未保存/)
  const storage = memoryStorage(), saved = []
  const env = await selectedEnv({ storage, candidateStore: { read: () => ({ candidates: saved }), add(work) { saved.push(work); storage.setItem = () => { throw new Error('full') }; return { added: true, persisted: true } }, remove() { throw new Error('must never compensate by delete') } } })
  await env.session.convert(env.resultId); assert.equal(saved.length, 1); assert.equal(env.workspaceStore.read().external_candidates[0].openalex_id, null)
  assert.match(env.root.elements.get('#discovery-status').textContent, /交叉引用待同步/)
})

test('JCR mapped CSV is previewed literally and latest verified year freezes only on explicit apply', async () => {
  const env = setup()
  const add = (name, value = '') => { const element = makeElement(); element.value = value; env.root.elements.set(`#${name}`, element); return element }
  add('discovery-journal-file').files = [{ size: 300, text: async () => 'Name,ISSN,Metric,Year,Category,Quartile,Source\n<img literal>,1234-5679,JIF,2024,Automation & Control Systems,Q1,https://example.org/jcr\n' }]
  for (const [key, value] of Object.entries({ title: 'Name', issns: 'ISSN', metric: 'Metric', data_year: 'Year', category: 'Category', quartile: 'Quartile', source_url: 'Source' })) add(`discovery-jcr-${key}`, value)
  add('discovery-journal-preview-button'); const area = add('discovery-journal-preview'); add('discovery-rule-year'); add('discovery-rule-category', 'Automation & Control Systems'); add('discovery-apply-rules')
  env.session.start(); await env.session.search()
  await env.root.elements.get('#discovery-journal-preview-button').dispatch('click')
  assert.equal(env.workspaceStore.read().journal_reviews.length, 0); assert.match(area.textContent, /<img literal>/)
  findElement(area, node => node.dataset?.journalIdentity).checked = true
  await findElement(area, node => node.tagName === 'BUTTON' && node.textContent === '确认保存 JCR 核验').dispatch('click')
  assert.equal(env.workspaceStore.read().journal_reviews.length, 1)
  await env.root.elements.get('#discovery-apply-rules').dispatch('click')
  assert.equal(env.workspaceStore.read().rules.data_year, null)
  assert.equal(env.session.getSnapshot().batch.rule_snapshot.data_year, 2024)
})

test('external selected candidates remain reachable across searches without entering old archive queue', async () => {
  const env = setup(); const area = makeElement(); env.root.elements.set('#discovery-external-candidates', area)
  env.session.start(); await env.session.search(); env.session.select(env.session.getSnapshot().results[0].result_id)
  assert.match(area.textContent, /Synthetic distributed optimization study/)
  assert.match(area.textContent, /核验并转入归档候选/)
})

test('failed import save retains its preview and confirmation controls for retry', async () => {
  const env = setup(); env.session.start()
  await env.session.previewImport({ text: '@article{a,title={Temporary import},doi={10.1234/temporary}}', format: 'bibtex', provider: 'manual' })
  env.storage.setItem = () => { throw new Error('quota') }
  assert.equal(env.session.confirmImport().persisted, false)
  const area = env.root.elements.get('#discovery-import-preview')
  assert.match(area.textContent, /Temporary import/)
  assert.ok(findElement(area, node => node.tagName === 'BUTTON' && node.textContent === '确认导入'))
  assert.equal(env.workspaceStore.read().records.length, 0)
})

test('oversized bibliography input cannot replace a prior loaded batch', async () => {
  const env = setup(); env.session.start(); await env.session.search(); const before = env.workspaceStore.read()
  await env.session.previewImport({ text: 'x'.repeat(2 * 1024 * 1024 + 1), format: 'bibtex', provider: 'manual' })
  assert.deepEqual(env.workspaceStore.read(), before); assert.equal(env.session.getSnapshot().results.length, 1)
  assert.match(env.root.elements.get('#discovery-import-preview').textContent, /2 MiB/)
})

test('a full saved workspace still displays and exports newly loaded temporary results', async () => {
  const storage = memoryStorage(), store = createDiscoveryWorkspaceStore(storage), state = createEmptyDiscoveryWorkspaceState()
  state.batches.push({ batch_id: 'b-1', created_at: '2026-09-05T00:00:00.000Z', scope: { startYear: null, endYear: null, language: 'all' }, plan: { conditions: [], selected: [], suggested: [], warnings: [] }, rule_snapshot: state.rules, queries: [], record_ids: [], excluded_record_ids: [] })
  for (let number = 0; number < 1000; number++) {
    const record = recordInput({ record_id: `existing-${number}` }); record.bibliography.doi = `10.1234/existing.${number}`
    state.records.push(record); state.batches[0].record_ids.push(record.record_id)
    state.results.push({ result_id: `result-${number}`, record_ids: [record.record_id], preferred_record_id: record.record_id, alias_ids: [], identity_status: 'clear', conflicts: [] })
  }
  assert.equal(store.commit(state).persisted, true)
  const env = setup({ storage }); env.session.start(); await env.session.search()
  const result = env.session.getSnapshot().results[0]
  assert.match(env.root.elements.get('#keyword-live-results-list').textContent, /Synthetic distributed optimization study/)
  assert.equal(env.workspaceStore.read().records.length, 1000)
  env.session.setExportSelected(result.result_id, true); assert.match(env.session.exportSelected('ris'), /10.1234\/fixture.1/)
})

test('successful conversion stores the canonical OpenAlex URL cross-reference and never repeats old add', async () => {
  const saved = [], env = await selectedEnv({ candidateStore: { read: () => ({ candidates: saved }), add(work) { saved.push(work); return { added: true, persisted: true } } } })
  await env.session.convert(env.resultId)
  assert.equal(env.workspaceStore.read().external_candidates[0].openalex_id, 'https://openalex.org/W123')
  await env.session.convert(env.resultId); assert.equal(saved.length, 1)
})

test('conversion rejects a competing saved DOI identity created during the old-store add', async () => {
  const storage = memoryStorage(), oldStore = createCandidateStore(storage)
  const env = await selectedEnv({ candidateStore: { read: oldStore.read, reload: oldStore.reload, add(work) {
    createCandidateStore(storage).add({ ...work, paperId: 'W456', source: 'Synthetic Journal' })
    return oldStore.add(work)
  } } })
  await env.session.convert(env.resultId)
  assert.deepEqual(createCandidateStore(storage).read().candidates.map(item => item.paperId), ['W456'])
  assert.equal(env.workspaceStore.read().external_candidates[0].openalex_id, null)
  assert.match(env.root.elements.get('#discovery-status').textContent, /身份.*冲突/)
  assert.doesNotMatch(env.root.elements.get('#discovery-status').textContent, /已转入/)
})

test('explicit batch rules survive another page, a failed page and its retry', async () => {
  let calls = 0
  const env = setup({ searchPage: async options => {
    calls++
    if (calls === 3) throw new Error('Synthetic page failure')
    const record = recordInput({ record_id: options.idFactory(), provider_id: `W${calls}`, provenance: { ...recordInput().provenance, provider: 'openalex', method: 'api', verification: 'api', batch_id: options.batch_id, query_id: options.query_id } })
    record.bibliography.doi = `10.1234/page.${calls}`
    return { records: [record], works: [], total: 3, nextCursor: calls < 4 ? `page-${calls + 1}` : null }
  } })
  for (const [id, value] of [['discovery-rule-year', '2024'], ['discovery-rule-category', 'Control'], ['discovery-apply-rules', '']]) {
    const element = makeElement(); element.value = value; env.root.elements.set(`#${id}`, element)
  }
  env.session.start(); await env.session.search(); await env.root.elements.get('#discovery-apply-rules').dispatch('click')
  const rules = { version: 1, data_year: 2024, category: 'Control', low_match_limit: 5 }
  for (let page = 0; page < 3; page++) {
    await env.session.search(true)
    assert.deepEqual(env.session.getSnapshot().batch.rule_snapshot, rules)
    assert.deepEqual(env.workspaceStore.read().batches.at(-1).rule_snapshot, rules)
    assert.deepEqual(env.workspaceStore.read().rules, rules)
  }
  assert.equal(calls, 4); assert.equal(env.session.getSnapshot().batch.queries[0].status, 'finished')
})

test('later-page candidate identity conflicts retain results and release search controls', async () => {
  const storage = memoryStorage(), seed = createDiscoveryWorkspaceStore(storage), state = createEmptyDiscoveryWorkspaceState()
  const a = recordInput(), b = recordInput({ record_id: 'r-2', provider_id: 'W123' })
  b.bibliography.doi = null; b.provenance = { ...b.provenance, provider: 'openalex', method: 'api', verification: 'api' }
  state.records = [a, b]
  state.results = [a, b].map((record, index) => ({ result_id: `result-${index}`, record_ids: [record.record_id], preferred_record_id: record.record_id, alias_ids: [], identity_status: 'clear', conflicts: [] }))
  state.batches = [{ batch_id: 'b-1', created_at: a.provenance.retrieved_at, scope: { startYear: null, endYear: null, language: 'all' }, plan: { conditions: [], selected: [], suggested: [], warnings: [] }, rule_snapshot: state.rules, queries: [], record_ids: ['r-1', 'r-2'], excluded_record_ids: [] }]
  state.external_candidates = state.results.map((result, index) => ({ result_id: result.result_id, selected_at: a.provenance.retrieved_at, openalex_id: index ? 'https://openalex.org/W456' : 'https://openalex.org/W123' }))
  assert.equal(seed.commit(state).persisted, true)
  let calls = 0
  const env = setup({ storage, searchPage: async options => {
    calls++
    const record = recordInput({ record_id: options.idFactory(), provider_id: calls === 1 ? 'W789' : 'W123', provenance: { ...a.provenance, provider: 'openalex', method: 'api', verification: 'api', batch_id: options.batch_id, query_id: options.query_id } })
    if (calls === 1) { record.bibliography.doi = '10.1234/unrelated'; record.bibliography.title = 'Synthetic unrelated paper retained' }
    return { records: [record], works: [], total: 2, nextCursor: calls === 1 ? 'next' : null }
  } })
  env.session.start(); await env.session.search()
  const saved = env.workspaceStore.read(), visible = env.session.getSnapshot().results
  await assert.doesNotReject(env.session.search(true))
  assert.equal(env.session.getSnapshot().busy, false)
  assert.equal(env.root.elements.get('#keyword-live-search').disabled, false)
  assert.equal(env.root.elements.get('#keyword-load-more').disabled, false)
  assert.equal(env.root.elements.get('#keyword-search-results').getAttribute('aria-busy'), 'false')
  assert.deepEqual(env.workspaceStore.read(), saved); assert.deepEqual(env.session.getSnapshot().results, visible)
  assert.match(env.root.elements.get('#keyword-live-results-list').textContent, /Synthetic unrelated paper retained/)
  assert.match(env.root.elements.get('#keyword-search-status').textContent, /交叉引用.*冲突/)
})

test('identity bridge across historical candidates canonicalizes references without dropping review evidence', async () => {
  const storage = memoryStorage(), seed = createDiscoveryWorkspaceStore(storage), state = createEmptyDiscoveryWorkspaceState(), a = recordInput(), b = recordInput({ record_id: 'r-2', provider_id: 'W123' })
  b.bibliography.doi = null; b.provenance = { ...b.provenance, provider: 'openalex', method: 'api', verification: 'api' }
  state.records = [a, b]; state.results = [a, b].map((record, index) => ({ result_id: `result-${index}`, record_ids: [record.record_id], preferred_record_id: record.record_id, alias_ids: [], identity_status: 'clear', conflicts: [] }))
  state.batches = [{ batch_id: 'b-1', created_at: a.provenance.retrieved_at, scope: { startYear: null, endYear: null, language: 'all' }, plan: { conditions: [], selected: [], suggested: [], warnings: [] }, rule_snapshot: state.rules, queries: [], record_ids: ['r-1', 'r-2'], excluded_record_ids: [] }]
  state.external_candidates = state.results.map(result => ({ result_id: result.result_id, selected_at: a.provenance.retrieved_at, openalex_id: null }))
  state.scope_reviews = [{ result_id: 'result-1', field: 'language', value: 'en', evidence: { record_ids: ['r-2'], locator: 'Source 2', reason: 'Explicit language', method: 'manual', checked_at: a.provenance.retrieved_at } }]
  assert.equal(seed.commit(state).persisted, true)
  const env = setup({ storage }); env.session.start(); await env.session.search(); const saved = env.workspaceStore.read()
  assert.equal(saved.results.length, 1); assert.equal(saved.external_candidates.length, 1)
  assert.equal(saved.external_candidates[0].result_id, saved.results[0].result_id)
  assert.equal(saved.scope_reviews.length, 1); assert.deepEqual(saved.scope_reviews[0].evidence.record_ids, ['r-2'])
  const conflicting = structuredClone(state)
  conflicting.external_candidates[0].openalex_id = 'https://openalex.org/W123'
  conflicting.external_candidates[1].openalex_id = 'https://openalex.org/W456'
  const conflictStorage = memoryStorage(), conflictStore = createDiscoveryWorkspaceStore(conflictStorage)
  conflictStore.commit(conflicting); const previous = conflictStore.read()
  const other = setup({ storage: conflictStorage }); other.session.start(); await other.session.search()
  assert.deepEqual(other.workspaceStore.read(), previous)
  assert.match(other.root.elements.get('#keyword-search-status').textContent, /交叉引用.*冲突/)
})

test('a current batch growing from 1000 to 1025 remains visible and exportable but never claims saved or curated', async () => {
  const storage = memoryStorage(), seed = createDiscoveryWorkspaceStore(storage), state = createEmptyDiscoveryWorkspaceState()
  const query = { query_id: 'q-1', expression: 'optimization', condition_ids: [], kind: 'original' }
  const active = { batch_id: 'b-1', created_at: '2026-09-05T00:00:00.000Z', scope: { startYear: null, endYear: null, language: 'all' }, plan: { conditions: [], selected: [query], suggested: [], warnings: [] },
    rule_snapshot: state.rules, queries: [{ query, cursor: 'next', total: 1025, accepted_cursors: ['*'], loaded: 1000, status: 'ready', error: null }], record_ids: [], excluded_record_ids: [] }
  state.batches = [active]
  const append = number => {
    const record = recordInput({ record_id: `batch-${number}` }); record.bibliography.doi = `10.1234/batch.${number}`; record.bibliography.title = `Synthetic unique paper ${number}`
    state.records.push(record); active.record_ids.push(record.record_id)
    state.results.push({ result_id: `result-${number}`, record_ids: [record.record_id], preferred_record_id: record.record_id, alias_ids: [], identity_status: 'clear', conflicts: [] })
  }
  for (let number = 0; number < 1000; number++) append(number)
  assert.equal(seed.commit(state).persisted, true)
  const batchController = { cancel() {}, async start() {}, read: () => structuredClone({ batch: active, records: state.records, results: state.results, generation: 1 }),
    async loadMore() { for (let number = 1000; number < 1025; number++) append(number); active.queries[0].cursor = null; active.queries[0].status = 'finished' } }
  const env = setup({ storage, batchController }); env.session.start(); await env.session.search(); await env.session.search(true)
  assert.equal(env.session.getSnapshot().results.length, 1025)
  assert.match(env.root.elements.get('#keyword-live-results-list').textContent, /Synthetic unique paper 1024/)
  assert.equal(env.workspaceStore.read().records.length, 1000)
  const selected = env.session.getSnapshot().results.find(result => result.record_ids.includes('batch-1024'))
  env.session.setExportSelected(selected.result_id, true); assert.match(env.session.exportSelected('bibtex'), /batch.1024/)
  await env.tabs[1].dispatch('click'); assert.match(env.root.elements.get('#keyword-live-results-list').textContent, /重点推荐暂不可用/)
})
