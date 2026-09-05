import test from 'node:test'
import assert from 'node:assert/strict'
import { makeElement, findElement, recordInput } from './discovery-test-fixtures.mjs'
import { createEmptyDiscoveryWorkspaceState } from './discovery-workspace.mjs'
const ui = await import('./discovery-review-ui.mjs').catch(() => ({}))
function setup() {
  const state = createEmptyDiscoveryWorkspaceState(), panel = makeElement()
  const condition = { id: 'c-1', label: 'Optimization', terms: ['optimization'], role: 'problem' }
  state.records = [recordInput()]
  state.results = [{ result_id: 'result-1', record_ids: ['r-1'], preferred_record_id: 'r-1', alias_ids: [], identity_status: 'clear', conflicts: [] }]
  state.batches = [{ batch_id: 'b-1', created_at: '2026-09-05T00:00:00.000Z', scope: { startYear: null, endYear: null, language: 'all' }, plan: { conditions: [condition], selected: [], suggested: [], warnings: [] }, rule_snapshot: state.rules, queries: [], record_ids: ['r-1'], excluded_record_ids: [] }]
  let context = { state, generation: 1, batch: state.batches[0] }, commits = []
  const root = { createElement: tagName => makeElement({ tagName }), querySelector: () => panel }
  return { panel, state, commits, root, getContext: () => context, stale() { context = { ...context, generation: 2 } }, onCommit: value => { commits.push(value); return { persisted: true } } }
}
test('confirmed review requires manual confirmation and complete owned evidence before commit', async () => {
  assert.equal(typeof ui.createDiscoveryReviewController, 'function')
  const env = setup(), controller = ui.createDiscoveryReviewController(env); controller.open('result-1')
  const field = key => findElement(env.panel, node => node.dataset?.reviewField === key)
  field('condition:c-1').value = 'confirmed'
  await field('save').dispatch('click'); assert.equal(env.commits.length, 0)
  field('locator').value = 'Abstract paragraph 2'; field('reason').value = 'Explicitly studies optimization'; field('manual').checked = true
  await field('save').dispatch('click')
  assert.equal(env.commits.length, 1)
  assert.equal(env.commits[0].state.condition_reviews[0].status, 'confirmed')
  assert.deepEqual(env.commits[0].state.condition_reviews[0].evidence.record_ids, ['r-1'])
  assert.equal(env.commits[0].expectedRevision, 0); assert.equal(env.commits[0].expectedGeneration, 1)
})
test('stale review cannot commit and cancel closes without changes', async () => {
  assert.equal(typeof ui.createDiscoveryReviewController, 'function')
  const env = setup(), controller = ui.createDiscoveryReviewController(env); controller.open('result-1'); env.stale()
  await findElement(env.panel, node => node.dataset?.reviewField === 'save').dispatch('click')
  assert.equal(env.commits.length, 0); assert.match(env.panel.textContent, /已变化/)
  controller.close(); assert.equal(env.panel.hidden, true)
})

test('review and split choices distinguish same-title sources using public DOI or provider identity', () => {
  const env = setup()
  env.state.records[0].bibliography.doi = '10.1234/source-a'
  const second = recordInput({ record_id: 'r-2', provider_id: 'W9100000099' })
  second.bibliography.doi = null
  env.state.records.push(second); env.state.results[0].record_ids.push('r-2'); env.state.batches[0].record_ids.push('r-2')
  ui.createDiscoveryReviewController(env).open('result-1')
  for (const key of ['reviewSource', 'splitSource']) {
    const firstLabel = findElement(env.panel, node => node.tagName === 'LABEL' && node.children.some(child => child.dataset?.[key] === 'r-1'))
    const secondLabel = findElement(env.panel, node => node.tagName === 'LABEL' && node.children.some(child => child.dataset?.[key] === 'r-2'))
    assert.match(firstLabel.textContent, /10\.1234\/source-a/)
    assert.match(secondLabel.textContent, /W9100000099/)
  }
  assert.doesNotMatch(env.panel.textContent, /record_id|result_id/)
})

test('review binds only user-selected source evidence and explicitly replaces the checked prior assertion', async () => {
  const env = setup()
  env.state.records.push(recordInput({ record_id: 'r-2' })); env.state.results[0].record_ids.push('r-2'); env.state.batches[0].record_ids.push('r-2')
  env.state.condition_reviews.push({ result_id: 'result-1', condition_id: 'c-1', status: 'hint', evidence: null })
  const controller = ui.createDiscoveryReviewController(env); controller.open('result-1')
  const field = key => findElement(env.panel, node => node.dataset?.reviewField === key)
  field('condition:c-1').value = 'confirmed'; field('locator').value = 'Page 4'; field('reason').value = 'Explicit formulation'; field('manual').checked = true
  const secondSource = findElement(env.panel, node => node.dataset?.reviewSource === 'r-2')
  assert.ok(secondSource); assert.equal(secondSource.checked, false)
  findElement(env.panel, node => node.dataset?.replaceReview === 'condition_reviews:0').checked = true
  await field('save').dispatch('click')
  assert.equal(env.commits[0].state.condition_reviews.length, 1)
  assert.deepEqual(env.commits[0].state.condition_reviews[0].evidence.record_ids, ['r-1'])
})

test('confirmed source split keeps the original candidate and moves wholly owned evidence to its new result', async () => {
  const env = setup(); env.state.records.push(recordInput({ record_id: 'r-2' })); env.state.results[0].record_ids.push('r-2'); env.state.batches[0].record_ids.push('r-2')
  env.state.external_candidates.push({ result_id: 'result-1', selected_at: '2026-09-05T00:00:00.000Z', openalex_id: null })
  env.state.condition_reviews.push({ result_id: 'result-1', condition_id: 'c-1', status: 'confirmed', evidence: { record_ids: ['r-2'], locator: 'Page 5', reason: 'Only source two', method: 'manual', checked_at: '2026-09-05T00:00:00.000Z' } })
  const controller = ui.createDiscoveryReviewController(env); controller.open('result-1')
  const confirm = findElement(env.panel, node => node.dataset?.confirmSplit)
  assert.ok(confirm); confirm.checked = true
  await findElement(env.panel, node => node.dataset?.splitResult).dispatch('click')
  assert.equal(env.commits.length, 1); const next = env.commits[0].state
  assert.equal(next.results.length, 2); assert.equal(next.external_candidates[0].result_id, 'result-1')
  assert.notEqual(next.condition_reviews[0].result_id, 'result-1')
  assert.equal(next.condition_reviews[0].status, 'confirmed')
  assert.deepEqual(next.condition_reviews[0].evidence.record_ids, ['r-2'])
})

test('split spanning assertions require separate explicit revocation and stale or cancelled forms write nothing', async () => {
  function splitEnv() {
    const env = setup(); env.state.records.push(recordInput({ record_id: 'r-2' })); env.state.results[0].record_ids.push('r-2'); env.state.batches[0].record_ids.push('r-2')
    const evidence = { record_ids: ['r-1', 'r-2'], locator: 'Mixed source page 3', reason: 'Old mixed rationale', method: 'manual', checked_at: '2026-09-05T00:00:00.000Z' }
    env.state.condition_reviews.push({ result_id: 'result-1', condition_id: 'c-1', status: 'confirmed', evidence })
    env.state.scope_reviews.push({ result_id: 'result-1', field: 'language', value: 'en', evidence })
    env.state.representative_reviews.push({ result_id: 'result-1', role: 'baseline', evidence })
    return env
  }
  const env = splitEnv(), controller = ui.createDiscoveryReviewController(env); controller.open('result-1')
  assert.match(env.panel.textContent, /Mixed source page 3/); assert.match(env.panel.textContent, /Old mixed rationale/)
  findElement(env.panel, node => node.dataset?.confirmSplit).checked = true
  await findElement(env.panel, node => node.dataset?.splitResult).dispatch('click'); assert.equal(env.commits.length, 0)
  const revoke = findElement(env.panel, node => node.dataset?.revokeSplitReviews); assert.ok(revoke); revoke.checked = true
  await findElement(env.panel, node => node.dataset?.splitResult).dispatch('click')
  assert.equal(env.commits.length, 1); const next = env.commits[0].state
  assert.equal(next.scope_reviews.length, 0); assert.equal(next.representative_reviews.length, 0)
  assert.equal(next.condition_reviews.length, 2); assert.equal(next.condition_reviews.every(item => item.status === 'unrecorded' && item.evidence.record_ids.length === 1), true)
  for (const stop of ['cancel', 'stale']) {
    const other = splitEnv(), control = ui.createDiscoveryReviewController(other); control.open('result-1')
    findElement(other.panel, node => node.dataset?.confirmSplit).checked = true; findElement(other.panel, node => node.dataset?.revokeSplitReviews).checked = true
    if (stop === 'cancel') control.close(); else other.stale()
    await findElement(other.panel, node => node.dataset?.splitResult).dispatch('click'); assert.equal(other.commits.length, 0)
  }
})
