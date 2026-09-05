import { isValidDiscoveryRecord, classifyDiscoveryScope } from './discovery-record.mjs'
import { canonicalChineseJournalTitle, evaluateJournalGate } from './journal-review.mjs'

const RESULT_KEYS = ['result_id', 'record_ids', 'preferred_record_id', 'alias_ids', 'identity_status', 'conflicts']
const EVALUATION_KEYS = ['result_id', 'status', 'confirmed_ids', 'missing', 'reasons', 'group_id', 'limit']
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const unique = values => [...new Set(values)]
const fail = label => { throw new TypeError(`${label} 无效`) }
const nonempty = (value, max = 2048) => typeof value === 'string' && !!value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
const conditionId = value => typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(value)
const journalTitleIdentity = value => canonicalChineseJournalTitle(value) ?? value

function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Reflect.ownKeys(value).length === keys.length && keys.every(key =>
    descriptors[key]?.enumerable && 'value' in descriptors[key])
}

function array(value, max = 1000) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    if (!descriptor?.enumerable || !('value' in descriptor)) return false
  }
  return true
}

function validEvidence(value, ownedIds) {
  return exact(value, ['record_ids', 'locator', 'reason', 'method', 'checked_at'])
    && array(value.record_ids) && value.record_ids.length > 0
    && unique(value.record_ids).length === value.record_ids.length && value.record_ids.every(id => ownedIds.has(id))
    && nonempty(value.locator, 2048) && nonempty(value.reason, 2000) && ['manual', 'local_tag'].includes(value.method)
    && typeof value.checked_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.checked_at)
    && Number.isFinite(Date.parse(value.checked_at)) && new Date(value.checked_at).toISOString() === value.checked_at
}

function validateConditions(conditions) {
  if (!array(conditions, 50)) fail('条件')
  for (const condition of conditions) {
    if (!exact(condition, ['id', 'label', 'terms', 'role']) || !conditionId(condition.id)
      || !nonempty(condition.label, 500) || !array(condition.terms, 20) || !condition.terms.length
      || !condition.terms.every(term => nonempty(term, 500)) || !['problem', 'network', 'method', 'other'].includes(condition.role)) fail('条件')
  }
  if (unique(conditions.map(condition => condition.id)).length !== conditions.length) fail('条件 ID')
}

function validResult(result) {
  return exact(result, RESULT_KEYS) && nonempty(result.result_id) && array(result.record_ids)
    && result.record_ids.length > 0 && result.record_ids.every(id => nonempty(id))
    && unique(result.record_ids).length === result.record_ids.length
    && result.record_ids.includes(result.preferred_record_id) && array(result.alias_ids)
    && result.alias_ids.every(id => nonempty(id)) && array(result.conflicts)
    && result.conflicts.every(value => nonempty(value, 10000)) && ['clear', 'conflict'].includes(result.identity_status)
}

function sourceConflicts(records) {
  const reasons = []
  for (const field of ['doi', 'language', 'year', 'work_type']) {
    if (unique(records.map(record => record.bibliography[field]).filter(value => value !== null)).length > 1) reasons.push(`来源 ${field} 冲突`)
  }
  for (let i = 0; i < records.length; i++) {
    for (let j = i+1; j < records.length; j++) {
      const a = records[i].bibliography.journal, b = records[j].bibliography.journal
      const knownIdentity = canonicalChineseJournalTitle(a.title) || canonicalChineseJournalTitle(b.title)
      if ((a.issns.length && b.issns.length && !a.issns.some(issn => b.issns.includes(issn)))
        || (a.source_type && b.source_type && a.source_type !== b.source_type)
        || (a.title && b.title && journalTitleIdentity(a.title) !== journalTitleIdentity(b.title)
          && (knownIdentity || /[\p{Script=Han}]/u.test(a.title + b.title)))
        || (records[i].provenance.provider === records[j].provenance.provider && a.source_id && b.source_id && a.source_id !== b.source_id)) {
        reasons.push('来源期刊身份冲突')
      }
    }
  }
  return unique(reasons)
}

/** Evaluate only supplied current evidence; no source, query score, citation threshold, or online lookup confers eligibility. */
export function evaluateDiscoveryRecommendation({ result, records, conditions, condition_reviews, scope_reviews,
  representative_reviews, journal_reviews, rules, scope }) {
  validateConditions(conditions)
  if (![records, condition_reviews, scope_reviews, representative_reviews, journal_reviews].every(value => array(value, 50000))) fail('推荐输入列表')
  const output = { result_id: result?.result_id ?? null, status: 'pending', confirmed_ids: [], missing: [], reasons: [], group_id: null, limit: null }
  const finish = (status, reasons = [], missing = []) => ({ ...output, status,
    reasons: unique([...output.reasons, ...reasons]), missing: unique(missing) })
  if (!validResult(result)) return finish('pending', [], ['汇总结果身份或来源引用无效'])
  const byId = new Map(records.filter(isValidDiscoveryRecord).map(record => [record.record_id, record]))
  const current = result.record_ids.map(id => byId.get(id)).filter(Boolean)
  // Historical positive retraction evidence cannot be erased by a later non-report.
  if (current.some(record => record.retraction.state === 'retracted')) return finish('excluded', ['来源已标记撤稿'])
  if (current.length !== result.record_ids.length || byId.size !== records.length) return finish('pending', [], ['当前来源记录缺失或无效'])
  if (result.identity_status !== 'clear' || result.conflicts.length) return finish('pending', result.conflicts, ['论文身份冲突待核验'])
  const conflicts = sourceConflicts(current)
  if (conflicts.length) return finish('pending', conflicts, ['来源元数据冲突待核验'])
  const ownedIds = new Set(result.record_ids)
  // Merges preserve result aliases; splits preserve evidence only in the partition that still owns its records.
  const reviewIds = new Set([result.result_id, ...result.alias_ids])
  const localScopes = scope_reviews.filter(review => exact(review, ['result_id', 'field', 'value', 'evidence']) && reviewIds.has(review.result_id))
  const eligibleScopes = localScopes.filter(review => ['language', 'work_type', 'retraction', 'journal_identity'].includes(review.field)
    && nonempty(review.value) && validEvidence(review.evidence, ownedIds))
  if (eligibleScopes.some(review => review.field === 'retraction' && review.value === 'retracted')) return finish('excluded', ['用户证据确认撤稿'])
  if (eligibleScopes.length !== localScopes.length) return finish('pending', [], ['范围核验证据缺失或已失效'])
  if (eligibleScopes.some(review => review.field === 'retraction' && review.value !== 'screened_clear')) {
    return finish('pending', [], ['撤稿状态尚未核验清楚'])
  }
  const preferred = byId.get(result.preferred_record_id)
  const bibliography = structuredClone(preferred.bibliography)
  // Compatible current sources may complete missing fields only. Keep originals
  // and the record owning each supplement available in the evaluation basis.
  for (const field of ['title', 'source_type', 'issns']) {
    const missing = field === 'issns' ? !bibliography.journal[field].length : bibliography.journal[field] === null
    if (!missing) continue
    const source = current.find(record => field === 'issns' ? record.bibliography.journal[field].length : record.bibliography.journal[field] !== null)
    if (source) {
      bibliography.journal[field] = structuredClone(source.bibliography.journal[field])
      output.reasons.push(`期刊 ${field} 补充依据：${source.provenance.provider} · ${source.record_id}`)
    }
  }
  const journalIdentities = unique(eligibleScopes.filter(review => review.field === 'journal_identity').map(review => journalTitleIdentity(review.value)))
  if (journalIdentities.length > 1 || (bibliography.journal.title && journalIdentities.length
    && journalTitleIdentity(bibliography.journal.title) !== journalIdentities[0])) return finish('pending', [], ['期刊身份核验证据冲突'])
  // Unreported fields can use another current source or an explicit review, never a guessed default.
  for (const field of ['language', 'work_type']) {
    const reported = current.map(record => record.bibliography[field]).find(value => value !== null) ?? null
    const values = unique(eligibleScopes.filter(review => review.field === field).map(review => review.value))
    if (values.length > 1 || (reported !== null && values.length && reported !== values[0])) return finish('pending', [], [`${field} 核验证据冲突`])
    bibliography[field] = reported ?? values[0] ?? null
  }
  bibliography.year ??= current.map(record => record.bibliography.year).find(value => value !== null) ?? null
  const clearReviews = eligibleScopes.filter(review => review.field === 'retraction' && review.value === 'screened_clear')
  const unknownRetraction = current.filter(record => record.retraction.state === 'unknown')
  const retractionClear = unknownRetraction.every(record => clearReviews.some(review => review.evidence.record_ids.includes(record.record_id)))
  const scopeRecord = { ...preferred, bibliography, retraction: retractionClear
    ? { ...preferred.retraction, state: 'screened_clear' } : { ...preferred.retraction, state: 'unknown' } }
  const scopeStatus = classifyDiscoveryScope(scopeRecord, scope)
  if (scopeStatus.status === 'excluded') return finish('excluded', scopeStatus.reasons)
  if (scopeStatus.status === 'pending') return finish('pending', [], scopeStatus.reasons)
  const gate = evaluateJournalGate({ bibliography, journal_reviews, rules,
    scope_reviews: eligibleScopes.map(review => ({ ...review, result_id: result.result_id })), result_id: result.result_id })
  output.reasons.push(...gate.basis)
  if (gate.status === 'pending') return finish('pending', [], gate.missing)
  if (gate.status === 'fail') return finish('not_recommended')

  const evidenceProblems = []
  for (const condition of conditions) {
    const reviews = condition_reviews.filter(review => exact(review, ['result_id', 'condition_id', 'status', 'evidence'])
      && reviewIds.has(review.result_id) && review.condition_id === condition.id)
    if (unique(reviews.map(review => review.status)).length > 1) {
      evidenceProblems.push(`条件 ${condition.id} 核验冲突`); continue
    }
    const confirmed = reviews.filter(review => review.status === 'confirmed')
    if (confirmed.some(review => !validEvidence(review.evidence, ownedIds))) {
      evidenceProblems.push(`条件 ${condition.id} 证据缺失或已失效`); continue
    }
    if (confirmed.length) {
      output.confirmed_ids.push(condition.id)
      output.reasons.push(`条件 ${condition.id}：${confirmed[0].evidence.method === 'local_tag' ? '本地人工标签依据' : '人工核验证据'} · ${confirmed[0].evidence.locator}`)
    }
  }
  output.confirmed_ids.sort(compare)
  const k = output.confirmed_ids.length, n = conditions.length
  const highMatch = k >= 4 && n > 0 && k/n >= 0.8
  output.group_id = k ? output.confirmed_ids.join('|') : null
  output.limit = highMatch ? 25 : 5
  if (evidenceProblems.length) return finish('pending', [], evidenceProblems)
  if (!k) return finish('not_recommended', ['零条条件已确认，保留在线索中'], ['缺少已确认条件证据'])
  output.reasons.push(`${k}/${n} 条件已确认`)
  if (highMatch) return finish('recommended', ['至少四条且覆盖至少 80% 条件；不设引用次数或代表性门槛'])
  const roles = k === 1 ? ['origin', 'baseline', 'survey'] : ['intersection']
  const representatives = representative_reviews.filter(review => exact(review, ['result_id', 'role', 'evidence'])
    && reviewIds.has(review.result_id) && roles.includes(review.role))
  if (!representatives.length || representatives.some(review => !validEvidence(review.evidence, ownedIds))) {
    return finish('pending', [], [`缺少可追溯的 ${roles.join('/')} 代表性依据`])
  }
  return finish('recommended', representatives.map(review => `代表性 ${review.role}：${review.evidence.reason} · ${review.evidence.locator}`))
}

function sortRecords(sort, byResult, byRecord) {
  const bibliography = id => byRecord.get(byResult.get(id).preferred_record_id).bibliography
  const newest = (a, b) => a.year === null ? (b.year === null ? 0 : 1) : b.year === null ? -1 : b.year - a.year
  return (left, right) => {
    const a = bibliography(left), b = bibliography(right)
    if (sort === 'newest') return newest(a, b) || compare(left, right)
    if (sort === 'citations') {
      const usableA = a.citations !== null && a.year !== null, usableB = b.citations !== null && b.year !== null
      if (usableA !== usableB) return usableA ? -1 : 1
      if (usableA) return compare(a.citations.provider, b.citations.provider) || newest(a, b)
        || b.citations.count - a.citations.count || compare(left, right)
    }
    // Every member of a group has the same confirmed condition set. Query relevance scores are not comparable.
    return compare(left, right)
  }
}

/** Inputs are evaluations from one batch and one selected condition set. Quotas never remove source results. */
export function selectDiscoveryRecommendations({ evaluations, results, records, sort, page = 1 }) {
  if (!Number.isSafeInteger(page) || page < 1) fail('页码')
  if (!['relevance', 'newest', 'citations'].includes(sort)) fail('排序方式')
  if (![evaluations, results, records].every(value => array(value, 1000))) fail('推荐列表')
  if (!records.every(isValidDiscoveryRecord) || !results.every(validResult)) fail('当前结果')
  const byResult = new Map(results.map(result => [result.result_id, result]))
  const byRecord = new Map(records.map(record => [record.record_id, record]))
  if (byResult.size !== results.length || byRecord.size !== records.length) fail('重复结果或记录')
  const seen = new Map(), groups = new Map()
  for (const evaluation of evaluations) {
    if (!exact(evaluation, EVALUATION_KEYS) || !['recommended', 'pending', 'not_recommended', 'excluded'].includes(evaluation.status)) fail('推荐评价')
    if (evaluation.status !== 'recommended') continue
    const result = byResult.get(evaluation.result_id)
    if (!result || result.identity_status !== 'clear' || result.conflicts.length || result.record_ids.some(id => !byRecord.has(id))) fail('推荐来源引用')
    const ids = evaluation.confirmed_ids
    if (!array(ids, 50) || !ids.length || !ids.every(conditionId) || unique(ids).length !== ids.length
      || ids.join('|') !== [...ids].sort(compare).join('|') || evaluation.group_id !== ids.join('|')
      || ![5, 25].includes(evaluation.limit)) fail('推荐条件分组')
    const previous = seen.get(evaluation.result_id)
    if (previous) {
      if (previous.group_id !== evaluation.group_id || previous.limit !== evaluation.limit) fail('重复推荐冲突')
      continue
    }
    seen.set(evaluation.result_id, evaluation)
    if (!groups.has(evaluation.group_id)) groups.set(evaluation.group_id, { id: evaluation.group_id, k: ids.length, limit: evaluation.limit, ids: [] })
    const group = groups.get(evaluation.group_id)
    if (group.limit !== evaluation.limit) fail('同组推荐规则不一致')
    group.ids.push(evaluation.result_id)
  }
  const orderedGroups = [...groups.values()].sort((a, b) => b.k - a.k || compare(a.id, b.id))
  const included = [], overflow_ids = [], compareResults = sortRecords(sort, byResult, byRecord)
  for (const group of orderedGroups) {
    group.ids.sort(compareResults)
    if (group.limit === 5) { included.push(...group.ids.slice(0, 5)); overflow_ids.push(...group.ids.slice(5)) }
    else included.push(...group.ids)
  }
  const start = (page-1)*25
  return { visible_ids: included.slice(start, start+25), overflow_ids, has_more: start+25 < included.length }
}
