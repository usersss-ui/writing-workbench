import test from 'node:test'
import assert from 'node:assert/strict'
import { makeElement, findElement, recordInput } from './discovery-test-fixtures.mjs'
import { evaluateDiscoveryRecommendation } from './discovery-recommendation.mjs'
const ui = await import('./discovery-results-ui.mjs').catch(() => ({}))
const record = recordInput()
const result = { result_id: 'result-1', record_ids: ['r-1'], preferred_record_id: 'r-1', alias_ids: [], identity_status: 'clear', conflicts: [] }
function setup() {
  const list = makeElement()
  return { list, root: { createElement: tagName => makeElement({ tagName }), querySelector: () => list } }
}
for (const [reason, patch] of [['来源已标记撤稿', 'retracted'], ['发表年份早于本轮起始年份', 'year'], ['语言不在本轮范围', 'language']]) {
  test(`excluded papers leave ordinary cards and counts but retain provenance: ${reason}`, () => {
    const { root, list } = setup()
    const candidates = [{ result_id: 'result-1', selected_at: '2026-09-05T00:00:00.000Z', openalex_id: null }]
    const before = structuredClone({ result, record, candidates })
    const source = structuredClone(record)
    source.retraction = { state: patch === 'retracted' ? 'retracted' : 'screened_clear', source_url: 'https://example.org/status', checked_at: '2026-09-05T00:00:00.000Z' }
    source.bibliography.language = patch === 'language' ? 'zh' : 'en'
    const evaluation = evaluateDiscoveryRecommendation({ result, records: [source], conditions: [], condition_reviews: [], scope_reviews: [],
      representative_reviews: [], journal_reviews: [], rules: { version: 1, data_year: null, category: 'Automation & Control Systems', low_match_limit: 5 },
      scope: { startYear: patch === 'year' ? 2025 : null, endYear: null, language: 'en' } })
    assert.equal(evaluation.status, 'excluded')
    ui.renderDiscoveryResults({ root, results: [result], records: [source], candidates,
      evaluations: [evaluation],
      onSelect() {}, onReview() {}, onConvert() {} })
    assert.equal(findElement(list, node => node.tagName === 'ARTICLE'), null)
    assert.match(list.textContent, /去重后已加载 0 篇/u)
    const summary = findElement(list, node => node.dataset?.exclusionSummary)
    assert.ok(summary); assert.match(summary.textContent, /已排除 1 篇/u)
    assert.ok(summary.textContent.includes(reason)); assert.match(summary.textContent, /manual/u)
    assert.ok(summary.textContent.includes(record.bibliography.title))
    assert.equal(findElement(summary, node => node.dataset?.selectResult || node.dataset?.convertResult), null)
    assert.deepEqual({ result, record, candidates }, before)
  })
}
test('conflict cards summarize types and source count without exposing internal record IDs or hiding evidence', () => {
  const { root, list } = setup()
  const conflicts = ['doi_mismatch:["private-record-1","private-record-2"]', 'doi_mismatch:["private-record-1","private-record-3"]', 'year_mismatch:["private-record-2","private-record-3"]']
  const input = { ...result, identity_status: 'conflict', conflicts, record_ids: ['r-1', 'r-2', 'r-3'] }
  const before = structuredClone(input)
  ui.renderDiscoveryResults({ root, results: [input], records: [record], evaluations: [{ result_id: 'result-1', status: 'pending', missing: ['论文身份冲突待核验', '缺少已确认 JIF 证据'], reasons: [...conflicts, '来源已标记撤稿'] }], onSelect() {}, onReview() {} })
  assert.match(list.textContent, /DOI 不一致/)
  assert.match(list.textContent, /发表年份不一致/)
  assert.match(list.textContent, /3 条来源记录/)
  assert.match(list.textContent, /缺少已确认 JIF 证据/)
  assert.match(list.textContent, /来源已标记撤稿/)
  assert.doesNotMatch(list.textContent, /private-record-|doi_mismatch|year_mismatch/)
  assert.deepEqual(input, before)
})
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

test('curated cards follow ranked page IDs while all results retain discovery order', () => {
  const { root, list } = setup()
  const results = ['A', 'B', 'C'].map(result_id => ({ ...result, result_id }))
  const options = { root, results, records: [record], evaluations: results.map(item => ({ result_id: item.result_id, status: 'recommended', missing: [], reasons: [] })), onSelect() {}, onReview() {} }
  const cards = () => list.children.filter(node => node.dataset?.resultId).map(node => node.dataset.resultId)
  ui.renderDiscoveryResults({ ...options, view: 'curated', visibleIds: ['B', 'A'], page: 1, hasMore: true })
  assert.deepEqual(cards(), ['B', 'A'])
  ui.renderDiscoveryResults({ ...options, view: 'curated', visibleIds: ['C'], page: 2 })
  assert.deepEqual(cards(), ['C'])
  ui.renderDiscoveryResults({ ...options, view: 'all', visibleIds: ['B', 'A'] })
  assert.deepEqual(cards(), ['A', 'B', 'C'])
})
