import assert from 'node:assert/strict'
import test from 'node:test'
import { searchLocalDiscovery } from './local-discovery.mjs'

const condition = { id: 'gradient-tracking', label: '梯度跟踪', terms: ['gradient tracking'], role: 'method' }
const paper = (patch = {}) => ({ paper_id: 'Local-01', title_original: 'Gradient tracking on networks', ...patch })
const search = (papers, patch = {}) => searchLocalDiscovery({ papers, conditions: [condition], raw: '',
  scope: { startYear: null, endYear: null, language: 'all' }, ...patch })

test('local topical evidence is a hint even without online identity', () => {
  const [hit] = search([paper({ doi_or_url: '' })])
  assert.deepEqual(hit.hint_condition_ids, ['gradient-tracking'])
  assert.deepEqual(hit.matched_fields, ['title_original'])
  assert.deepEqual(Object.keys(hit).sort(), ['hint_condition_ids', 'matched_fields', 'paper'])
})

test('explicit multilingual titles and known bilingual phrases are searched with exact field attribution', () => {
  for (const field of ['title_original', 'title_en', 'title_zh']) {
    const [hit] = search([paper({ title_original: '', [field]: '有向网络上的梯度跟踪算法' })])
    assert.deepEqual(hit.matched_fields, [field])
  }
  assert.equal(search([paper({ title_original: '梯度估计与跟踪' })]).length, 0)
  assert.equal(search([paper({ title_original: 'Agent cooperation with shared estimates' })]).length, 0)
})

test('NFKC and English word boundaries avoid substring inventions', () => {
  assert.equal(search([paper({ title_original: 'ＧＲＡＤＩＥＮＴ　ＴＲＡＣＫＩＮＧ' })]).length, 1)
  for (const title_original of ['subgradient tracking', 'gradient trackings']) {
    assert.equal(search([paper({ title_original })]).length, 0)
  }
  const directed = [{ id: 'directed', label: '有向网络', terms: ['directed network'], role: 'network' }]
  assert.equal(search([paper({ title_original: 'undirected network' })], { conditions: directed }).length, 0)
})

test('explicit inline abstract and note preview mentions are hints including negation and background', () => {
  const [hit] = search([paper({ title_original: 'Unrelated title',
    abstract: 'We do not use gradient tracking.', note_preview: 'Background: 梯度跟踪 is prior work.' })])
  assert.deepEqual(hit.matched_fields, ['abstract', 'note_preview'])
  assert.deepEqual(hit.hint_condition_ids, ['gradient-tracking'])
  assert.equal(hit.status, undefined)
})

test('structured facets retain existing states and provenance without upgrading pending terms', () => {
  const source = paper({ title_original: 'Unrelated title', facets: { oracle: { estimation: ['梯度跟踪'] }, network: { direction: [] } },
    facet_states: { 'network.direction': 'pending_verification' }, source_terms: ['directed network'],
    metadata_provenance: { facets: 'tag_catalog', facet_states: 'tag_catalog', source_terms: 'frontmatter' } })
  const before = structuredClone(source)
  const [hit] = search([source], { conditions: [condition, { id: 'directed', label: '有向网络', terms: ['directed network'], role: 'network' }] })
  assert.deepEqual(hit.matched_fields, ['facets.oracle.estimation', 'source_terms'])
  assert.deepEqual(hit.hint_condition_ids, ['gradient-tracking', 'directed'])
  assert.deepEqual(hit.paper.facet_states, { 'network.direction': 'pending_verification' })
  assert.deepEqual(hit.paper.metadata_provenance, source.metadata_provenance)
  hit.paper.facets.oracle.estimation.push('changed')
  assert.deepEqual(source, before)
})

test('raw text provides literal topical recall without manufacturing condition IDs', () => {
  const [hit] = search([paper({ title_original: 'Distributed optimization on graphs' })], { conditions: [], raw: '分布式优化' })
  assert.deepEqual(hit.hint_condition_ids, [])
  assert.deepEqual(hit.matched_fields, ['title_original'])
  assert.deepEqual(search([paper()], { conditions: [], raw: '' }), [])
})

test('query-plan network terminology can recall an explicitly stored Chinese phrase', () => {
  const [hit] = search([paper({ title_original: '时变非平衡有向网络' })], {
    conditions: [{ id: 'network', label: 'Network', terms: ['time-varying unbalanced directed graph'], role: 'network' }],
  })
  assert.deepEqual(hit.hint_condition_ids, ['network'])
  assert.deepEqual(hit.matched_fields, ['title_original'])
})

test('scope excludes known mismatches while missing years and source language remain unknown', () => {
  const papers = [paper({ paper_id: 'Local-01', year: 2010, language: 'en' }),
    paper({ paper_id: 'Local-02', year: 2024, language: 'zh' }),
    paper({ paper_id: 'Local-03', publication_year: 2024, language: 'en' }),
    paper({ paper_id: 'Local-04', title_en: 'Gradient tracking', title_zh: '梯度跟踪' })]
  const hits = search(papers, { scope: { startYear: 2020, endYear: 2025, language: 'en' } })
  assert.deepEqual(hits.map(hit => hit.paper.paper_id), ['Local-03', 'Local-04'])
  assert.equal(hits[1].paper.language, null)
})

test('unloaded or invalid paper collections throw rather than claim an empty successful search', () => {
  for (const papers of [null, undefined, {}, { papers: [] }]) assert.throws(() => search(papers), TypeError)
  assert.deepEqual(search([]), [])
})

test('invalid local identifiers cannot leak private locations into public results', () => {
  assert.deepEqual(search([paper({ paper_id: '/private/paper' }), paper({ paper_id: '../escape' })]), [])
})

test('malformed index members throw even alongside hits or when scope would exclude them', () => {
  for (const member of [null, 42, {}, [], new Date(), { paper_id: 42 }, Object.create({ paper_id: 'Local-02' })]) {
    assert.throws(() => search([member]), TypeError)
    assert.throws(() => search([paper(), member]), TypeError)
  }
  assert.throws(() => search([{ year: 2010 }], { scope: { startYear: 2020, endYear: null, language: 'all' } }), TypeError)
  assert.throws(() => search(new Array(1)), TypeError)
  assert.deepEqual(search([{ paper_id: 'Local-02' }]), [])
  assert.deepEqual(search([{ paper_id: '../unsafe' }]), [])
})

test('canonical network facets recall exact field-specific hints and distinguish opposing values', () => {
  const cases = [
    ['direction', '有向', '无向', 'directed network'],
    ['direction', '无向', '有向', 'undirected network'],
    ['balance', '平衡', '不平衡', 'balanced network'],
    ['balance', '不平衡', '平衡', 'unbalanced network'],
    ['time', '固定', '时变', 'static topology'],
    ['time', '时变', '固定', 'time-varying topology'],
  ]
  for (const [field, value, opposite, term] of cases) {
    const conditions = [{ id: 'network-condition', label: 'Network condition', terms: [term], role: 'network' }]
    const source = paper({ title_original: 'Unrelated title', facets: { network: { [field]: [value] } },
      facet_states: { 'oracle.estimation': 'pending_verification' },
      metadata_provenance: { facets: 'tag_catalog', facet_states: 'tag_catalog' } })
    const hits = search([source], { conditions })
    assert.equal(hits.length, 1, term)
    assert.deepEqual(hits[0].hint_condition_ids, ['network-condition'])
    assert.deepEqual(hits[0].matched_fields, [`facets.network.${field}`])
    assert.deepEqual(hits[0].paper.facets, source.facets)
    assert.deepEqual(hits[0].paper.facet_states, source.facet_states)
    assert.deepEqual(hits[0].paper.metadata_provenance, source.metadata_provenance)
    assert.equal(search([paper({ title_original: 'Unrelated title', facets: { network: { [field]: [opposite] } } })], { conditions }).length, 0, `${term}: opposite`)
    assert.equal(search([paper({ title_original: value, source_terms: [value], facets: { objective: [value] } })], { conditions }).length, 0, `${term}: no global short aliases`)
  }
})

test('only supplied topical fields are read and public hit projections exclude private locations', () => {
  const source = paper({ relative_path: '/private/paper', source_path: '/private/source',
    artifacts: { note: [{ relative_path: '/private/note' }] }, preferred_note: '/private/note',
    source_documents: { pdf: [{ url: 'file:///private/paper.pdf' }] }, doi_or_url: 'file:///private/identity',
    metadata_provenance: { facets: 'tag_catalog', source_path: '/private/provenance' } })
  Object.defineProperty(source, 'note_preview_url', { get() { throw new Error('must not read a preview URL') } })
  Object.defineProperty(source, 'fulltext', { get() { throw new Error('must not read fulltext') } })
  const [hit] = search([source])
  assert.doesNotMatch(JSON.stringify(hit), /private|source_path|relative_path|fulltext|note_preview_url/)
  assert.equal(search([paper({ title_original: 'Other topic', note_preview_url: 'https://example.org/gradient-tracking' })]).length, 0)
})
