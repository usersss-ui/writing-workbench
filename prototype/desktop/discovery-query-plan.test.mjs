import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscoveryQueryPlan, translateDiscoveryKeywords, directionToConditions, encodeDirectionAxes, decodeDirectionAxes, buildExternalSearchLinks } from './discovery-query-plan.mjs'

const conditions = [
  { id: 'p', label: '在线优化', terms: ['online optimization', 'online convex optimization'], role: 'problem' },
  { id: 'n1', label: '有向网络', terms: ['directed network'], role: 'network' },
  { id: 'n2', label: '时变', terms: ['time-varying topology'], role: 'network' },
  { id: 'm1', label: '梯度跟踪', terms: ['gradient tracking'], role: 'method' },
  { id: 'm2', label: '零阶', terms: ['zeroth-order'], role: 'method' },
]

test('unparsed raw Boolean expression retains whitespace, NOT and parentheses and has no inferred condition counts', () => {
  const raw = '  ("online optimization" AND NOT ("gradient tracking" OR stochastic))  '
  const plan = buildDiscoveryQueryPlan({ raw, conditions: [], expand: false, primary_ids: [] })
  assert.equal(plan.selected[0].expression, raw)
  assert.equal(plan.selected[0].kind, 'original')
  assert.deepEqual(plan.selected[0].condition_ids, [])
  assert.deepEqual(plan.conditions, [])
})

test('translation matches longest terms before connectors, deduplicates and rejects unknown residuals', () => {
  assert.equal(translateDiscoveryKeywords('在线优化'), '("online optimization")')
  assert.equal(translateDiscoveryKeywords('在分布式在线约束优化中的在线优化 在线优化'), '("distributed online constrained optimization" AND "online optimization")')
  assert.equal(translateDiscoveryKeywords('无耦合约束与耦合约束'), '("uncoupled constraints" AND "coupled constraints")')
  assert.throws(() => translateDiscoveryKeywords('在线优化与量子通信'), /不能可靠转换/)
})

test('same-axis selections remain one stable OR group independent of order and input is untouched', () => {
  const axes = { problem: ['在线优化', '分布式优化'], algorithm: ['梯度跟踪'] }
  const before = JSON.stringify(axes)
  const result = directionToConditions(axes)
  assert.equal(result.conditions.length, 2)
  assert.equal(result.conditions[0].label, '分布式优化或在线优化')
  assert.deepEqual(result.conditions[0].terms, ['distributed optimization', 'online optimization'])
  assert.equal(result.conditions[0].id, directionToConditions({ problem: ['分布式优化', '在线优化'] }).conditions[0].id)
  assert.match(result.conditions[0].id, /^[a-zA-Z0-9-]+$/)
  assert.equal(JSON.stringify(axes), before)
  const plan = buildDiscoveryQueryPlan({ raw: '', conditions: result.conditions, expand: false })
  assert.equal(plan.selected[0].expression, '(("distributed optimization" OR "online optimization") AND "gradient tracking")')
  assert.equal(plan.selected[0].condition_ids.length, 2)
})

test('expansion requires explicit boolean consent, leaves suggestions visible and preserves raw query', () => {
  const plan = buildDiscoveryQueryPlan({ raw: 'manual NOT query', conditions, expand: '1', primary_ids: ['p'] })
  assert.equal(plan.selected.length, 1)
  assert.equal(plan.selected[0].expression, 'manual NOT query')
  assert.deepEqual(plan.selected[0].condition_ids, [])
  assert.ok(plan.suggested.length > 6)
  assert.match(plan.warnings.join(' '), /确认/)
})

test('five independent conditions yield at most six prioritized queries including full intersection with visible remainder', () => {
  const plan = buildDiscoveryQueryPlan({ raw: 'original NOT query', conditions, expand: true, primary_ids: ['p'] })
  assert.equal(plan.selected.length, 6)
  assert.equal(plan.selected[0].expression, 'original NOT query')
  assert.deepEqual(plan.selected[1].condition_ids, ['p'])
  assert.deepEqual(plan.selected[2].condition_ids, ['n1', 'p'])
  assert.ok(plan.selected.some(q => q.condition_ids.length === 5))
  assert.ok(plan.suggested.length > 0)
  assert.match(plan.warnings.join(' '), /未执行/)
  assert.equal(new Set([...plan.selected, ...plan.suggested].map(q => q.expression)).size, plan.selected.length + plan.suggested.length)
})

test('condition IDs deduplicate safely, conflicting IDs and operator-escaping terms are rejected', () => {
  const plan = buildDiscoveryQueryPlan({ raw: '', conditions: [conditions[0], conditions[0]], expand: true })
  assert.equal(plan.conditions.length, 1)
  for (const invalid of [ { ...conditions[0], id: 'p|m' }, { ...conditions[0], terms: ['x" OR "y'] }, { ...conditions[0], terms: ['x\\y'] } ]) {
    assert.throws(() => buildDiscoveryQueryPlan({ conditions: [invalid] }), /条件|术语/)
  }
  assert.throws(() => buildDiscoveryQueryPlan({ conditions: [conditions[0], { ...conditions[0], label: 'different' }] }), /ID/)
})

test('reordered input produces identical queries and unique stable query IDs', () => {
  const a = buildDiscoveryQueryPlan({ conditions, expand: true })
  const b = buildDiscoveryQueryPlan({ conditions: [...conditions].reverse(), expand: true })
  assert.deepEqual(a.selected, b.selected)
  assert.deepEqual(a.suggested, b.suggested)
  const pair = buildDiscoveryQueryPlan({ conditions: [conditions[1], conditions[0]], expand: true })
  assert.equal(new Set([...pair.selected, ...pair.suggested].map(q => q.query_id)).size, pair.selected.length + pair.suggested.length)
})

test('direction transfer is versioned, bounded, strict against pollution and does not silently discard invalid values', () => {
  const serialized = encodeDirectionAxes({ problem: ['在线优化'] })
  assert.deepEqual(JSON.parse(serialized), { version: 1, axes: { problem: ['在线优化'] } })
  assert.equal(decodeDirectionAxes(serialized).conditions[0].label, '在线优化')
  for (const raw of ['x'.repeat(9000), '{', '{"version":2,"axes":{}}', '{"version":1,"axes":{"__proto__":[]}}', '{"version":1,"axes":{"problem":["污染"]}}', '{"version":1,"axes":{},"extra":true}']) {
    assert.throws(() => decodeDirectionAxes(raw), /方向/)
  }
  assert.throws(() => directionToConditions({ problem: ['在线优化', '在线优化'] }), /方向/)
  assert.throws(() => directionToConditions({ unknown: [] }), /方向/)
  assert.throws(() => directionToConditions({ problem: null }), /方向/)
})

test('encoded request boundary rejects excessive queries without truncation', () => {
  assert.throws(() => buildDiscoveryQueryPlan({ raw: '研'.repeat(950) }), /缩短/)
  assert.throws(() => buildDiscoveryQueryPlan({ raw: 'x'.repeat(1001) }), /缩短/)
})

test('external searches preserve query, omit empty years and disclose manual language and source checks', () => {
  const links = buildExternalSearchLinks({ query: '在线优化 AND "gradient tracking"', scope: { startYear: '', endYear: null, language: 'zh' } })
  const scholar = new URL(links.scholar)
  assert.equal(scholar.origin + scholar.pathname, 'https://scholar.google.com/scholar')
  assert.equal(scholar.searchParams.get('q'), '在线优化 AND "gradient tracking"')
  assert.equal(scholar.searchParams.has('as_ylo'), false)
  assert.equal(scholar.searchParams.has('as_yhi'), false)
  assert.equal(links.cnki, 'https://kns.cnki.net/kns8s/')
  assert.equal(links.cnki_terms, '在线优化 AND "gradient tracking"')
  assert.match(links.scope_notice, /语言.*未自动设置/)
  assert.match(links.scope_notice, /来源页面.*确认/)
  const years = new URL(buildExternalSearchLinks({ query: 'query', scope: { startYear: 2000, endYear: 2025, language: 'en' } }).scholar)
  assert.equal(years.searchParams.get('as_ylo'), '2000')
  assert.equal(years.searchParams.get('as_yhi'), '2025')
  assert.throws(() => buildExternalSearchLinks({ query: 'query', scope: { startYear: 2025, endYear: 2000 } }), /年份/)
})
