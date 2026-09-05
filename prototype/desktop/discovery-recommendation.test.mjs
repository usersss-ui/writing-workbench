import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDiscoveryRecommendation, selectDiscoveryRecommendations } from './discovery-recommendation.mjs'
import { recordInput } from './discovery-test-fixtures.mjs'

const now = '2026-09-05T00:00:00.000Z'
const rules = { version: 1, data_year: 2025, category: 'Automation & Control Systems', low_match_limit: 5 }
const evidence = (ids = ['r-1']) => ({ record_ids: ids, locator: 'Abstract, sentence 2', reason: 'Direct method contribution', method: 'manual', checked_at: now })
function input(k = 4, n = 5, role = null) {
  const record = recordInput()
  record.bibliography.language = 'en'
  record.bibliography.work_type = 'article'
  record.bibliography.journal = { title: 'Synthetic Journal', source_id: null, issns: ['1234-5678'], source_type: 'journal' }
  record.bibliography.citations = { count: 0, provider: 'openalex', retrieved_at: now }
  record.retraction = { state: 'screened_clear', source_url: 'https://example.org/status', checked_at: now }
  return {
    result: { result_id: 'result-1', record_ids: ['r-1'], preferred_record_id: 'r-1', alias_ids: [], identity_status: 'clear', conflicts: [] },
    records: [record], conditions: Array.from({ length: n }, (_, i) => ({ id: `c${i+1}`, label: `Condition ${i+1}`, terms: ['term'], role: 'method' })),
    condition_reviews: Array.from({ length: k }, (_, i) => ({ result_id: 'result-1', condition_id: `c${i+1}`, status: 'confirmed', evidence: evidence() })),
    scope_reviews: [], representative_reviews: role ? [{ result_id: 'result-1', role, evidence: evidence() }] : [],
    journal_reviews: [{ review_id: 'j-1', title: 'Synthetic Journal', issns: ['1234-5678'], identity_confirmed: true,
      metric: 'JIF', data_year: 2025, release_year: 2026, category: rules.category, quartile: 'Q1',
      source_url: 'https://example.org/journal', import_description: null, checked_at: now, method: 'user' }],
    rules, scope: { startYear: 2020, endYear: 2026, language: 'en' },
  }
}
for (const [k,n,role,status,limit] of [[0,5,null,'not_recommended',5],[1,1,null,'pending',5],[1,1,'origin','recommended',5],
  [1,5,'baseline','recommended',5],[1,5,'survey','recommended',5],[1,5,'intersection','pending',5],
  [2,2,null,'pending',5],[2,5,'intersection','recommended',5],[3,5,'intersection','recommended',5],
  [4,5,null,'recommended',25],[5,5,null,'recommended',25],[4,10,null,'pending',5],[4,10,'intersection','recommended',5]]) {
  test(`${k}/${n} with ${role} yields ${status}, limit ${limit}`, () => {
    const result = evaluateDiscoveryRecommendation(input(k,n,role))
    assert.equal(result.status, status)
    assert.equal(result.limit, limit)
    assert.equal(result.confirmed_ids.length, k)
    if (k === 4) assert.equal(result.group_id, 'c1|c2|c3|c4')
  })
}
for (const status of ['hint', 'false', 'unrecorded']) {
  test(`${status} never counts as confirmed even with evidence`, () => {
    const args = input(1,1,'origin'); args.condition_reviews[0].status = status
    const result = evaluateDiscoveryRecommendation(args)
    assert.equal(result.status, 'not_recommended')
    assert.deepEqual(result.confirmed_ids, [])
  })
}
test('same evidence has same eligibility across providers, import methods and query identities', () => {
  for (const [provider,method,query_id] of [['openalex','api','q-1'],['openalex','api','q-2'],['manual','import',null],['local','local',null]]) {
    const args = input(); Object.assign(args.records[0].provenance, { provider, method, query_id })
    assert.equal(evaluateDiscoveryRecommendation(args).status, 'recommended')
  }
})
test('only complete evidence pointing to current result records can confirm conditions', () => {
  for (const patch of [{ record_ids: ['split-away'] }, { record_ids: [] }, { locator: '' }, { reason: '' }, { method: 'auto' }, { checked_at: 'today' }]) {
    const args = input(); Object.assign(args.condition_reviews[0].evidence, patch)
    const result = evaluateDiscoveryRecommendation(args)
    assert.equal(result.status, 'pending')
    assert.deepEqual(result.confirmed_ids, ['c2','c3','c4'])
  }
})
test('stale confirmation cannot be hidden by four other valid high-match confirmations', () => {
  const args = input(5,5); args.condition_reviews[0].evidence.record_ids = ['split-away']
  const result = evaluateDiscoveryRecommendation(args)
  assert.equal(result.status,'pending')
  assert.deepEqual(result.confirmed_ids,['c2','c3','c4','c5'])
})
test('local tags remain traceable human tag evidence without becoming a full-text review', () => {
  const args = input(); args.condition_reviews[0].evidence.method = 'local_tag'
  const result = evaluateDiscoveryRecommendation(args)
  assert.equal(result.status,'recommended')
  assert.match(result.reasons.join(' '),/本地人工标签/u)
  assert.doesNotMatch(result.reasons.join(' '),/全文审查/u)
})
test('conflicting condition reviews cannot inflate eligibility or silently choose confirmed', () => {
  const args = input()
  args.condition_reviews.push({ ...args.condition_reviews[0], status: 'false' })
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'pending')
  args.condition_reviews.pop(); args.condition_reviews.push({ ...args.condition_reviews[0] })
  assert.equal(evaluateDiscoveryRecommendation(args).confirmed_ids.length, 4)
})
test('stale representative evidence leaves low-match results pending', () => {
  const args = input(2,5,'intersection'); args.representative_reviews[0].evidence.record_ids = ['split-away']
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'pending')
})
test('merged aliases retain valid condition and representative evidence on the current result', () => {
  const args = input(2,5,'intersection'); args.result.alias_ids = ['before-merge']
  for (const review of [...args.condition_reviews, ...args.representative_reviews]) review.result_id = 'before-merge'
  const result = evaluateDiscoveryRecommendation(args)
  assert.equal(result.status,'recommended')
  assert.deepEqual(result.confirmed_ids,['c1','c2'])
})
test('retained alias cannot transfer split-away condition evidence', () => {
  const args = input(); args.result.alias_ids = ['before-split']
  args.condition_reviews[0].result_id = 'before-split'; args.condition_reviews[0].evidence.record_ids = ['split-away']
  const result = evaluateDiscoveryRecommendation(args)
  assert.equal(result.status,'pending')
  assert.deepEqual(result.confirmed_ids,['c2','c3','c4'])
})
test('aliased scope evidence retains whitelist identity but not split-away records', () => {
  const args = input(); args.result.alias_ids = ['old-result']; args.scope.language = 'zh'; args.records[0].bibliography.language = 'zh'
  args.records[0].bibliography.journal = {title:'自动化学报',source_id:null,source_type:'journal',issns:[]}
  args.scope_reviews = [{result_id:'old-result',field:'journal_identity',value:'自动化学报',evidence:evidence()}]
  assert.equal(evaluateDiscoveryRecommendation(args).status,'recommended')
  args.scope_reviews[0].evidence.record_ids = ['split-away']
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('split-away representative evidence under a retained alias remains pending', () => {
  const args = input(2,5,'intersection'); args.result.alias_ids = ['old-result']
  args.representative_reviews[0].result_id = 'old-result'; args.representative_reviews[0].evidence.record_ids = ['split-away']
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('identity conflicts and missing current records invalidate evidence before confirmation', () => {
  for (const mutate of [a => a.result.identity_status = 'conflict', a => a.result.conflicts.push('journal_mismatch'), a => a.result.record_ids.push('missing')]) {
    const args = input(); mutate(args)
    const result = evaluateDiscoveryRecommendation(args)
    assert.equal(result.status, 'pending')
    assert.deepEqual(result.confirmed_ids, [])
  }
})
test('original retracted evidence wins over later clear source and user reviews', () => {
  const args = input(); const original = structuredClone(args.records[0]); original.record_id = 'original'; original.retraction.state = 'retracted'
  args.records.push(original); args.result.record_ids.push('original')
  args.scope_reviews.push({ result_id: 'result-1', field: 'retraction', value: 'screened_clear', evidence: evidence(['r-1','original']) })
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'excluded')
})
test('unknown retraction requires current sourced review and is never treated clear', () => {
  const args = input(); args.records[0].retraction.state = 'unknown'
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'pending')
  args.scope_reviews.push({ result_id: 'result-1', field: 'retraction', value: 'screened_clear', evidence: evidence(['stale']) })
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'pending')
  args.scope_reviews[0].evidence = evidence()
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'recommended')
  args.scope_reviews[0].value = 'retracted'
  assert.equal(evaluateDiscoveryRecommendation(args).status, 'excluded')
})
test('an explicit unknown retraction review stays pending despite an older clear source', () => {
  const args = input()
  args.scope_reviews = [{result_id:'result-1',field:'retraction',value:'unknown',evidence:evidence()}]
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('conflicting journal identity reviews cannot be hidden by a valid journal gate', () => {
  const args = input()
  args.scope_reviews = [{result_id:'result-1',field:'journal_identity',value:'Different Journal',evidence:evidence()}]
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('outside scope is excluded while missing year, language or work type stays pending', () => {
  for (const [patch,status] of [[{year:2019},'excluded'],[{language:'zh'},'excluded'],[{year:null},'pending'],[{language:null},'pending'],[{work_type:null},'pending']]) {
    const args = input(); Object.assign(args.records[0].bibliography,patch)
    assert.equal(evaluateDiscoveryRecommendation(args).status,status)
  }
})
test('contradictory source languages remain pending, regardless of preferred source', () => {
  const args = input(); const other = structuredClone(args.records[0]); other.record_id = 'r-2'; other.bibliography.language = 'zh'
  args.records.push(other); args.result.record_ids.push('r-2')
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('changed current DOI cannot retain confirmations through a stale clear result flag', () => {
  const args = input(); const other = structuredClone(args.records[0]); other.record_id = 'r-2'; other.bibliography.doi = '10.1234/different'
  args.records.push(other); args.result.record_ids.push('r-2')
  const result = evaluateDiscoveryRecommendation(args)
  assert.equal(result.status,'pending')
  assert.deepEqual(result.confirmed_ids,[])
})
test('no-ISSN whitelist scope evidence is checked against the actual current source', () => {
  const args = input(); args.scope.language = 'zh'; args.records[0].bibliography.language = 'zh'
  args.records[0].bibliography.journal = { title: '自动化学报', source_id: null, source_type: 'journal', issns: [] }
  args.scope_reviews = [{ result_id:'result-1', field:'journal_identity', value:'自动化学报', evidence:evidence(['stale']) }]
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
  args.scope_reviews[0].evidence = evidence()
  assert.equal(evaluateDiscoveryRecommendation(args).status,'recommended')
})
test('a conflicting source journal name cannot hide behind a preferred whitelist name and shared ISSN', () => {
  const args = input(); args.scope.language = 'zh'; args.records[0].bibliography.language = 'zh'
  args.records[0].bibliography.journal = {title:'自动化学报',issns:['0254-4156'],source_id:null,source_type:'journal'}
  const other = structuredClone(args.records[0]); other.record_id = 'r-2'; other.bibliography.journal.title = 'IEEE/CAA Journal of Automatica Sinica'
  args.records.push(other); args.result.record_ids.push('r-2')
  assert.equal(evaluateDiscoveryRecommendation(args).status,'pending')
})
test('Q3 and non-journal publications remain not recommended, never discarded as excluded', () => {
  const args = input(); args.journal_reviews[0].quartile = 'Q3'
  assert.equal(evaluateDiscoveryRecommendation(args).status,'not_recommended')
  args.journal_reviews[0].quartile = 'Q1'; args.records[0].bibliography.work_type = 'preprint'
  assert.equal(evaluateDiscoveryRecommendation(args).status,'not_recommended')
})
test('unsafe or duplicate condition IDs fail before ambiguous quota groups can form', () => {
  for (const id of ['c|1','c 1','x'.repeat(161)]) {
    const args = input(); args.conditions[0].id = id
    assert.throws(() => evaluateDiscoveryRecommendation(args), /条件/u)
  }
  const args = input(); args.conditions[1].id = 'c1'
  assert.throws(() => evaluateDiscoveryRecommendation(args), /条件/u)
})
function selectionInput(specs) {
  const evaluations = [], results = [], records = []
  for (const {id,k=1,year=2024,count=0,provider='openalex',status='recommended'} of specs) {
    const args = input(k,5,k===1?'origin':'intersection'); const rec = args.records[0]
    rec.record_id = `r-${id}`; rec.bibliography.year = year
    rec.bibliography.citations = count === null ? null : { count, provider, retrieved_at: now }
    records.push(rec)
    results.push({ ...args.result, result_id:id, record_ids:[rec.record_id], preferred_record_id:rec.record_id })
    const confirmed_ids = Array.from({length:k},(_,i)=>`c${i+1}`)
    evaluations.push({ result_id:id,status,confirmed_ids,missing:[],reasons:[],group_id:confirmed_ids.join('|'),limit:k>=4?25:5 })
  }
  return { evaluations,results,records,sort:'relevance' }
}
test('low-match full groups get five places, overflow is separate, and groups never copy to subsets', () => {
  const args = selectionInput(Array.from({length:7},(_,i)=>({id:`p${i+1}`,k:2})).concat([{id:'single',k:1},{id:'high',k:4}]))
  const result = selectDiscoveryRecommendations(args)
  assert.deepEqual(result.visible_ids,['high','p1','p2','p3','p4','p5','single'])
  assert.deepEqual(result.overflow_ids,['p6','p7'])
  assert.equal(result.has_more,false)
})
test('high matches are untruncated and paginated at 25 after combining groups', () => {
  const args = selectionInput(Array.from({length:31},(_,i)=>({id:`h${String(i).padStart(2,'0')}`,k:4})))
  assert.equal(selectDiscoveryRecommendations(args).visible_ids.length,25)
  assert.equal(selectDiscoveryRecommendations(args).has_more,true)
  const page2 = selectDiscoveryRecommendations({...args,page:2})
  assert.deepEqual(page2.visible_ids,['h25','h26','h27','h28','h29','h30'])
  assert.deepEqual(page2.overflow_ids,[])
  assert.equal(page2.has_more,false)
  assert.deepEqual(selectDiscoveryRecommendations({...args,page:3}).visible_ids,[])
})
test('explicit newest sorting is stable and missing year goes last', () => {
  const args = selectionInput([{id:'a',year:2020},{id:'b',year:2025},{id:'c',year:2025},{id:'d',year:null}])
  assert.deepEqual(selectDiscoveryRecommendations({...args,sort:'newest'}).visible_ids,['b','c','a','d'])
  assert.deepEqual(selectDiscoveryRecommendations(args).visible_ids,['a','b','c','d'])
})
test('citations compare only within source and same-year buckets, with missing evidence last', () => {
  const args = selectionInput([{id:'old',year:2020,count:10000},{id:'new-low',year:2025,count:1},{id:'new-high',year:2025,count:10},
    {id:'other',year:2025,count:999999,provider:'scholar'},{id:'missing',year:2026,count:null}])
  assert.deepEqual(selectDiscoveryRecommendations({...args,sort:'citations'}).visible_ids,['new-high','new-low','old','other','missing'])
})
test('recommendation selection is unique and ignores pending or excluded evaluations', () => {
  const args = selectionInput([{id:'a'},{id:'b',status:'pending'},{id:'c',status:'excluded'}])
  args.evaluations.push(structuredClone(args.evaluations[0]))
  assert.deepEqual(selectDiscoveryRecommendations(args).visible_ids,['a'])
  assert.throws(() => selectDiscoveryRecommendations({...args,page:0}), /页/u)
})
test('equal-sized disjoint full-condition groups use stable group IDs before per-group sorting', () => {
  const args = selectionInput([{id:'first'},{id:'second'},{id:'third',k:2}])
  args.evaluations[0].confirmed_ids = ['z']; args.evaluations[0].group_id = 'z'
  assert.deepEqual(selectDiscoveryRecommendations(args).visible_ids,['third','second','first'])
})
test('evaluation and selection leave input records, review ordering and evaluations unchanged', () => {
  const args = input(); const before = structuredClone(args)
  evaluateDiscoveryRecommendation(args)
  assert.deepEqual(args,before)
  const selection = selectionInput([{id:'z',year:2020},{id:'a',year:2025}]); const old = structuredClone(selection)
  selectDiscoveryRecommendations({...selection,sort:'newest'})
  assert.deepEqual(selection,old)
})
