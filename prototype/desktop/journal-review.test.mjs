import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJournalCsv, validateJournalReview, evaluateJournalGate } from './journal-review.mjs'
import { recordInput } from './discovery-test-fixtures.mjs'

const now = '2026-09-05T00:00:00.000Z'
const rules = { version: 1, data_year: null, category: 'Automation & Control Systems', low_match_limit: 5 }
function review(patch = {}) {
  return { review_id: 'j-1', title: 'Synthetic Journal', issns: ['1234-5678'], identity_confirmed: true,
    metric: 'JIF', data_year: 2025, release_year: 2026, category: rules.category, quartile: 'Q1',
    source_url: 'https://example.org/journal', import_description: null, checked_at: now, method: 'user', ...patch }
}
function bibliography(patch = {}) {
  return { ...recordInput().bibliography, language: 'en', work_type: 'article',
    journal: { title: 'Synthetic Journal', source_id: null, issns: ['1234-5678'], source_type: 'journal' }, ...patch }
}
const gate = (journal_reviews = [], patch = {}) => evaluateJournalGate({ bibliography: bibliography(), journal_reviews, rules, ...patch })
const mapping = { title: 'Journal', issns: 'ISSN', metric: 'Metric', data_year: 'Year', category: 'Category', quartile: 'Q', source_url: 'Source' }
const header = 'Journal,ISSN,Metric,Year,Category,Q,Source'
const csvRow = 'Synthetic Journal,1234-5678,JIF,2025,Automation & Control Systems,Q1,https://example.org/journal'
const parse = (text, patch = {}) => parseJournalCsv({ text, mapping, now, idFactory: index => `csv-${index}`, ...patch })

test('unknown quartile stays pending and incomplete SJR is not JIF', () => {
  assert.equal(gate().status, 'pending')
  assert.equal(validateJournalReview({ metric: 'SJR', quartile: 'Q1' }), false)
})
for (const [quartile, status] of [['Q1', 'pass'], ['Q2', 'pass'], ['Q3', 'fail'], ['Q4', 'fail'], [null, 'pending']]) {
  test(`JIF ${quartile} has ${status} eligibility`, () => assert.equal(gate([review({ quartile })]).status, status))
}
for (const metric of ['SJR', 'JCI', 'Impact Factor', 'jif']) {
  test(`${metric} cannot be relabelled JIF`, () => {
    assert.equal(validateJournalReview(review({ metric })), false)
    assert.equal(gate([review({ metric })]).status, 'pending')
  })
}
test('latest confirmed data year is global, without borrowing an older covered year', () => {
  const rows = [review({ data_year: 2024 }), review({ review_id: 'other', issns: ['2345-6789'], data_year: 2025 })]
  assert.equal(gate(rows).status, 'pending')
  assert.equal(gate(rows, { rules: { ...rules, data_year: 2024 } }).status, 'pass')
  assert.equal(gate([rows[0], { ...rows[1], identity_confirmed: false }]).status, 'pass')
})
test('wrong category and same-year conflicting quartiles stay pending', () => {
  assert.equal(gate([review({ category: 'Other' })]).status, 'pending')
  assert.equal(gate([review(), review({ review_id: 'j-2', quartile: 'Q3' })]).status, 'pending')
  assert.equal(gate([review(), review({ review_id: 'j-2', category: 'Other', quartile: 'Q3' })]).status, 'pass')
})
test('unconfirmed identity, name-only JCR match and missing source do not pass', () => {
  for (const patch of [{ identity_confirmed: false }, { issns: [] }, { source_url: null }, { data_year: null }, { category: '' }]) {
    assert.equal(gate([review(patch)]).status, 'pending')
  }
  assert.equal(gate([review({ issns: ['2345-6789'] })]).status, 'pending')
})
test('JCR cannot expand the Chinese whitelist or infer unknown publication language', () => {
  for (const [language, status] of [['en','pass'],['zh','fail'],[null,'pending'],['fr','fail']]) {
    assert.equal(gate([review()], {bibliography:bibliography({language})}).status,status)
  }
})
test('a confirmed print ISSN accepts incomplete electronic coverage without hiding quartile conflicts', () => {
  const b = bibliography({journal:{title:'Synthetic Journal',source_id:null,source_type:'journal',issns:['1234-5678','2345-6789']}})
  assert.equal(gate([review()], {bibliography:b}).status,'pass')
  assert.equal(gate([review(), review({review_id:'j-2',issns:['2345-6789'],quartile:'Q3'})], {bibliography:b}).status,'pending')
  assert.equal(gate([review({issns:['3456-7890']})], {bibliography:b}).status,'pending')
})
for (const [title,issn,canonical] of [['Acta Automatica Sinica','0254-4156','自动化学报'],['Control Theory & Applications','1000-8152','控制理论与应用']]) {
  test(`${title} is an exact whitelist alias only with compatible identity evidence`, () => {
    const b = bibliography({language:'zh',journal:{title,issns:[issn],source_id:null,source_type:'journal'}})
    const result = gate([], {bibliography:b})
    assert.equal(result.status,'pass')
    assert.match(result.basis.join(' '),new RegExp(canonical,'u'))
    assert.equal(gate([], {bibliography:{...b,journal:{...b.journal,issns:[issn === '0254-4156' ? '1000-8152' : '0254-4156']}}}).status,'pending')
    assert.equal(gate([], {bibliography:{...b,journal:{...b.journal,issns:[]}}}).status,'pending')
    const evidence = {record_ids:['r-1'],locator:'Masthead',reason:'Exact identity verified',method:'manual',checked_at:now}
    assert.equal(gate([], {bibliography:{...b,journal:{...b.journal,issns:[]}},result_id:'result-1',
      scope_reviews:[{result_id:'result-1',field:'journal_identity',value:canonical,evidence}]}).status,'pass')
  })
}
test('Control Theory and Technology and substring extensions never acquire whitelist identity', () => {
  for (const title of ['Control Theory and Technology','Acta Automatica Sinica Supplement','Control Theory & Applications International']) {
    assert.equal(gate([], {bibliography:bibliography({language:'zh',journal:{title,issns:['1000-8152'],source_id:null,source_type:'journal'}})}).status,'pending')
  }
})
test('distinct English lookalike journals may qualify through their own confirmed JCR identity', () => {
  for (const title of ['IEEE/CAA Journal of Automatica Sinica','Control Theory and Technology']) {
    const result = gate([review({title})], {bibliography:bibliography({journal:{title,issns:['1234-5678'],source_id:null,source_type:'journal'}})})
    assert.equal(result.status,'pass')
    assert.match(result.basis.join(' '),/JIF/u)
    assert.doesNotMatch(result.basis.join(' '),/中文期刊名单/u)
  }
})
test('JournalReview validates exact bounded plain data without invoking accessors', () => {
  assert.equal(validateJournalReview(review()), true)
  assert.equal(validateJournalReview(review({ source_url: null, import_description: 'User supplied CSV' })), true)
  for (const patch of [{ extra: true }, { source_url: 'javascript:alert(1)' }, { checked_at: 'yesterday' }, { method: 'api' }, { release_year: 2 }, { issns: ['bad'] }]) {
    assert.equal(validateJournalReview(review(patch)), false)
  }
  let calls = 0
  const value = review()
  Object.defineProperty(value, 'metric', { enumerable: true, get() { calls++; return 'JIF' } })
  assert.equal(validateJournalReview(value), false)
  assert.equal(calls, 0)
})
for (const [title, issn] of [['自动化学报', '0254-4156'], ['控制理论与应用', '1000-8152']]) {
  test(`${title} has Chinese whitelist admission by unique ISSN, without JCR claims`, () => {
    const b = bibliography({ language: 'zh', journal: { title, issns: [issn], source_id: null, source_type: 'journal' } })
    const result = gate([], { bibliography: b })
    assert.equal(result.status, 'pass')
    assert.match(result.basis.join(' '), /中文期刊名单准入/u)
    assert.doesNotMatch(result.basis.join(' '), /JIF|Q1|Q2/u)
    assert.equal(gate([], { bibliography: { ...b, language: 'en' } }).status, 'pending')
    assert.equal(gate([], { bibliography: { ...b, journal: { ...b.journal, issns: [issn, '2345-6789'] } } }).status, 'pending')
  })
}
for (const title of ['IEEE/CAA Journal of Automatica Sinica', 'Control and Decision']) {
  test(`${title} cannot acquire whitelist eligibility by similar name`, () => {
    assert.equal(gate([], { bibliography: bibliography({ language: 'zh', journal: { title, source_id: null, source_type: 'journal', issns: [] } }) }).status, 'pending')
    assert.equal(gate([], { bibliography: bibliography({ language: 'zh', journal: { title, source_id: null, source_type: 'journal', issns: ['0254-4156'] } }) }).status, 'pending')
  })
}
test('no-ISSN Chinese identity needs this result, exact Chinese title and complete evidence', () => {
  const b = bibliography({ language: 'zh', journal: { title: '自动化学报', source_id: null, source_type: 'journal', issns: [] } })
  const evidence = { record_ids: ['r-1'], locator: 'Journal masthead', reason: 'Exact journal identity verified', method: 'manual', checked_at: now }
  const identity = { result_id: 'result-1', field: 'journal_identity', value: '自动化学报', evidence }
  const args = { bibliography: b, result_id: 'result-1', scope_reviews: [identity] }
  assert.equal(gate([], args).status, 'pass')
  for (const patch of [{ result_id: 'other' }, { value: 'IEEE/CAA Journal of Automatica Sinica' }, { evidence: {} }]) {
    assert.equal(gate([], { ...args, scope_reviews: [{ ...identity, ...patch }] }).status, 'pending')
  }
})
test('1000-8152 exact-name confirmation admits 控制理论与应用 but never 控制与决策', () => {
  const evidence = { record_ids: ['r-1'], locator: 'Journal masthead', reason: 'Journal identity checked', method: 'manual', checked_at: now }
  for (const [title,status] of [['控制理论与应用','pass'],['控制与决策','pending']]) {
    const b = bibliography({language:'zh', journal:{title,issns:[],source_id:null,source_type:'journal'}})
    const scope_reviews = [{result_id:'result-1',field:'journal_identity',value:title,evidence}]
    assert.equal(gate([], {bibliography:b,result_id:'result-1',scope_reviews}).status,status)
    assert.equal(gate([], {bibliography:{...b,journal:{...b.journal,issns:['1000-8152']}}}).status,status)
  }
})
for (const work_type of ['preprint', 'conference-paper', 'dissertation']) {
  test(`${work_type} cannot borrow journal eligibility`, () => assert.equal(gate([review()], { bibliography: bibliography({ work_type }) }).status, 'fail'))
}
test('CSV parses quoted commas, escaped quotes, CRLF and multiline fields as inert preview', () => {
  const text = `${header},Unknown\r\n"Synthetic, ""Journal""\nVolume",1234-5678,JIF,2025,Automation & Control Systems,Q2,https://example.org/journal,"=HYPERLINK(""bad"")"\r\n`
  const result = parse(text)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].title, 'Synthetic, "Journal"\nVolume')
  assert.equal(result.rows[0].identity_confirmed, false)
  assert.equal(result.rows[0].method, 'user')
  assert.ok(result.warnings.some(w => w.includes('Unknown')))
  assert.equal(gate(result.rows).status, 'pending')
  assert.equal(gate([]).status, 'pending') // Discarding preview has no persisted effect.
})
test('CSV requires explicit complete mapping and rejects other metric rows with a warning', () => {
  const invalidMapping = { ...mapping }; delete invalidMapping.metric
  assert.throws(() => parse(`${header}\n${csvRow}`, { mapping: invalidMapping }), /映射/u)
  const result = parse(`${header}\n${csvRow.replace(',JIF,', ',SJR,')}\n${csvRow}`)
  assert.equal(result.rows.length, 1)
  assert.ok(result.warnings.length)
  assert.equal(parse(`${header}\n${csvRow}`, { mapping: { ...mapping, source_url: 'Missing' } }).rows.length, 0)
})
test('CSV formulas remain literal text and cannot become a year, URL or metric', () => {
  const literal = parse(`${header}\n${csvRow.replace('Synthetic Journal', '=1+1')}`)
  assert.equal(literal.rows[0].title, '=1+1')
  for (const text of [csvRow.replace('2025', '=2025'), csvRow.replace('JIF', '=JIF'), csvRow.replace('https://example.org/journal', '"=HYPERLINK(""bad"")"')]) {
    assert.equal(parse(`${header}\n${text}`).rows.length, 0)
  }
})
test('CSV fails closed on malformed quoting, duplicate headings, row and byte limits', () => {
  assert.throws(() => parse(`${header}\n"unfinished`), /CSV/u)
  assert.throws(() => parse(`${header},Journal\n${csvRow},x`), /CSV/u)
  assert.equal(parse(`${header}\n${Array(500).fill(csvRow).join('\n')}`).rows.length, 500)
  assert.throws(() => parse(`${header}\n${Array(501).fill(csvRow).join('\n')}`), /500/u)
  assert.throws(() => parse('中'.repeat(699051)), /2 MiB/u)
})
