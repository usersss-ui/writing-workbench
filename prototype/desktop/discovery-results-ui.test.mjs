import test from 'node:test'
import assert from 'node:assert/strict'
import { makeElement, findElement, recordInput } from './discovery-test-fixtures.mjs'
const ui = await import('./discovery-results-ui.mjs').catch(() => ({}))
const record = recordInput()
const result = { result_id: 'result-1', record_ids: ['r-1'], preferred_record_id: 'r-1', alias_ids: [], identity_status: 'clear', conflicts: [] }
function setup() {
  const list = makeElement()
  return { list, root: { createElement: tagName => makeElement({ tagName }), querySelector: () => list } }
}
test('all results retain pending and nonrecommended papers, render literal titles and material labels', () => {
  assert.equal(typeof ui.renderDiscoveryResults, 'function')
  const { root, list } = setup(); const selected = []
  ui.renderDiscoveryResults({ root, results: [result], records: [{ ...record, bibliography: { ...record.bibliography, title: '<img onerror=alert(1)>' } }],
    evaluations: [{ result_id: 'result-1', status: 'pending', missing: ['语言待核验'], reasons: [] }], view: 'all',
    localMatches: new Map([['result-1', { status: 'missing_pdf', matches: [{ hasPdf: false, hasNote: true, href: './library.html?paper_id=Test26-A', title: 'Indexed note' }] }]]),
    onSelect: id => selected.push(id), onReview() {} })
  assert.match(list.textContent, /<img onerror=alert\(1\)>/)
  assert.match(list.textContent, /待核验/); assert.match(list.textContent, /笔记/); assert.match(list.textContent, /缺 PDF/)
  findElement(list, node => node.dataset?.selectResult === 'result-1').dispatch('click')
  assert.deepEqual(selected, ['result-1'])
})
test('curated empty state explains evidence and returns to all without hiding original records', () => {
  assert.equal(typeof ui.renderDiscoveryResults, 'function')
  const { root, list } = setup(); let view
  ui.renderDiscoveryResults({ root, results: [result], records: [record], evaluations: [{ result_id: 'result-1', status: 'pending', missing: ['语言待核验'], reasons: [] }], view: 'curated', onSelect() {}, onReview() {}, onView: next => { view = next } })
  assert.match(list.textContent, /语言待核验/)
  findElement(list, node => node.dataset?.returnAll).dispatch('click')
  assert.equal(view, 'all')
})

test('curated paging exposes loaded recommendations beyond page one without querying again', async () => {
  const { root, list } = setup(); let page
  ui.renderDiscoveryResults({ root, results: [result], records: [record], evaluations: [{ result_id: 'result-1', status: 'recommended', missing: [], reasons: [] }], view: 'curated',
    visibleIds: ['result-1'], page: 1, hasMore: true, onPage: value => { page = value }, onSelect() {}, onReview() {} })
  const next = findElement(list, node => node.dataset?.recommendationPage === 'next')
  assert.ok(next); await next.dispatch('click'); assert.equal(page, 2)
})
