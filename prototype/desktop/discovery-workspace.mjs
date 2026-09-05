import { isValidDiscoveryRecord } from './discovery-record.mjs'
import { validateDiscoveryQueryPlan } from './discovery-batch.mjs'
import { validateJournalReview } from './journal-review.mjs'

export const DISCOVERY_WORKSPACE_STORAGE_KEY = 'research-console.discovery-workspace.v1'
const MAX_BYTES = 4 * 1024 * 1024
const clone = value => structuredClone(value)
const fail = () => { throw new TypeError('检索工作区状态无效或超出容量') }
const require = value => { if (!value) fail() }
const text = (value, max = 2048) => typeof value === 'string' && !!value.trim()
  && [...value].length <= max && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
const id = value => text(value) && value === value.trim()
const integer = value => Number.isSafeInteger(value) && value >= 0
const year = value => value === null || (Number.isInteger(value) && value >= 1000 && value <= 9999)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const bytes = raw => new TextEncoder().encode(raw).byteLength

function exact(value, keys) {
  require(value && Object.getPrototypeOf(value) === Object.prototype)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  require(Reflect.ownKeys(value).length === keys.length && keys.every(key =>
    descriptors[key]?.enumerable && 'value' in descriptors[key]))
}

function array(value, max = MAX_BYTES) {
  require(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max
    && Reflect.ownKeys(value).length === value.length + 1)
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    require(descriptor?.enumerable && 'value' in descriptor)
  }
  return value
}

function ids(value, max = 1000) {
  array(value, max); require(value.every(id) && new Set(value).size === value.length)
  return value
}

function rules(value) {
  exact(value, ['version', 'data_year', 'category', 'low_match_limit'])
  require(value.version === 1 && value.low_match_limit === 5 && year(value.data_year) && text(value.category, 500))
}

function sameQuery(left, right) {
  exact(left, ['query_id', 'expression', 'condition_ids', 'kind'])
  ids(left.condition_ids, 50)
  return left.query_id === right.query_id && left.expression === right.expression && left.kind === right.kind
    && left.condition_ids.length === right.condition_ids.length
    && left.condition_ids.every((value, index) => value === right.condition_ids[index])
}

function conditionMeaning(condition) {
  const terms = [...new Set(condition.terms.map(term => term.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()))].sort()
  return JSON.stringify([condition.role, terms])
}

export function createEmptyDiscoveryWorkspaceState() {
  return { version: 1, revision: 0, batches: [], records: [], results: [], external_candidates: [],
    condition_reviews: [], scope_reviews: [], representative_reviews: [], journal_reviews: [],
    rules: { version: 1, data_year: null, category: 'Automation & Control Systems', low_match_limit: 5 } }
}

function validate(value) {
  exact(value, ['version', 'revision', 'batches', 'records', 'results', 'external_candidates',
    'condition_reviews', 'scope_reviews', 'representative_reviews', 'journal_reviews', 'rules'])
  require(value.version === 1 && integer(value.revision)); rules(value.rules)
  const batches = new Map(), conditions = new Map(), records = new Map(), results = new Map(), resolved = new Map()
  for (const batch of array(value.batches, 100)) {
    exact(batch, ['batch_id', 'created_at', 'scope', 'plan', 'rule_snapshot', 'queries', 'record_ids', 'excluded_record_ids'])
    require(id(batch.batch_id) && !batches.has(batch.batch_id) && instant(batch.created_at))
    batches.set(batch.batch_id, batch)
    exact(batch.scope, ['startYear', 'endYear', 'language'])
    require(year(batch.scope.startYear) && year(batch.scope.endYear) && ['all', 'en', 'zh'].includes(batch.scope.language)
      && (batch.scope.startYear === null || batch.scope.endYear === null || batch.scope.startYear <= batch.scope.endYear))
    rules(batch.rule_snapshot)
    const plan = validateDiscoveryQueryPlan(batch.plan)
    for (const condition of plan.conditions) {
      const meaning = conditionMeaning(condition)
      require(!conditions.has(condition.id) || conditions.get(condition.id) === meaning)
      conditions.set(condition.id, meaning)
    }
    array(batch.queries, 6); require(batch.queries.length === plan.selected.length)
    const queryIds = new Set()
    for (const state of batch.queries) {
      exact(state, ['query', 'cursor', 'total', 'accepted_cursors', 'loaded', 'status', 'error'])
      exact(state.query, ['query_id', 'expression', 'condition_ids', 'kind'])
      const selected = plan.selected.find(query => query.query_id === state.query.query_id)
      require(selected && sameQuery(state.query, selected) && !queryIds.has(selected.query_id))
      queryIds.add(selected.query_id)
      require(state.cursor === null || id(state.cursor))
      require(state.total === null || integer(state.total)); require(integer(state.loaded))
      ids(state.accepted_cursors, MAX_BYTES)
      require(['idle', 'loading', 'ready', 'failed', 'finished', 'interrupted'].includes(state.status)
        && (state.error === null || text(state.error, 10000)))
    }
    ids(batch.record_ids); ids(batch.excluded_record_ids)
    require(batch.excluded_record_ids.every(recordId => batch.record_ids.includes(recordId)))
  }
  for (const record of array(value.records, 1000)) {
    require(isValidDiscoveryRecord(record) && !records.has(record.record_id))
    records.set(record.record_id, record)
    const batch = batches.get(record.provenance.batch_id)
    require(batch && batch.record_ids.includes(record.record_id)
      && (record.provenance.query_id === null || batch.plan.selected.some(query => query.query_id === record.provenance.query_id)))
  }
  for (const batch of batches.values()) require(batch.record_ids.every(recordId => records.has(recordId)))
  const owned = new Set()
  for (const result of array(value.results, 1000)) {
    exact(result, ['result_id', 'record_ids', 'preferred_record_id', 'alias_ids', 'identity_status', 'conflicts'])
    require(id(result.result_id)); ids(result.record_ids, 10); ids(result.alias_ids, MAX_BYTES)
    require(result.record_ids.length > 0 && result.record_ids.includes(result.preferred_record_id)
      && ['clear', 'conflict'].includes(result.identity_status))
    array(result.conflicts).forEach(conflict => require(text(conflict, 10000)))
    for (const resultId of [result.result_id, ...result.alias_ids]) {
      require(!resolved.has(resultId)); resolved.set(resultId, result)
    }
    results.set(result.result_id, result)
    for (const recordId of result.record_ids) {
      require(records.has(recordId) && !owned.has(recordId)); owned.add(recordId)
    }
  }
  require(owned.size === records.size)
  const candidates = new Set()
  for (const candidate of array(value.external_candidates, 1000)) {
    exact(candidate, ['result_id', 'selected_at', 'openalex_id'])
    require(results.has(candidate.result_id) && !candidates.has(candidate.result_id) && instant(candidate.selected_at)
      && (candidate.openalex_id === null || (typeof candidate.openalex_id === 'string' && /^https:\/\/openalex\.org\/W\d+$/u.test(candidate.openalex_id))))
    candidates.add(candidate.result_id)
  }
  function evidence(value, result) {
    exact(value, ['record_ids', 'locator', 'reason', 'method', 'checked_at'])
    ids(value.record_ids, 10)
    require(value.record_ids.length > 0 && value.record_ids.every(recordId => result.record_ids.includes(recordId))
      && text(value.locator, 2048) && text(value.reason, 2000) && ['manual', 'local_tag'].includes(value.method) && instant(value.checked_at))
  }
  function reviews(items, keys, allowed, optionalEvidence = false) {
    for (const review of array(items)) {
      exact(review, keys)
      const result = resolved.get(review.result_id)
      require(result && allowed(review))
      if (review.evidence !== null || !optionalEvidence) evidence(review.evidence, result)
      else require(review.status !== 'confirmed')
    }
  }
  reviews(value.condition_reviews, ['result_id', 'condition_id', 'status', 'evidence'],
    review => conditions.has(review.condition_id) && ['confirmed', 'hint', 'false', 'unrecorded'].includes(review.status), true)
  reviews(value.scope_reviews, ['result_id', 'field', 'value', 'evidence'],
    review => ['language', 'work_type', 'retraction', 'journal_identity'].includes(review.field) && text(review.value, 2048))
  reviews(value.representative_reviews, ['result_id', 'role', 'evidence'],
    review => ['origin', 'baseline', 'survey', 'intersection'].includes(review.role))
  const journalIds = new Set()
  for (const review of array(value.journal_reviews)) {
    require(validateJournalReview(review) && !journalIds.has(review.review_id)); journalIds.add(review.review_id)
  }
  require(bytes(JSON.stringify(value)) <= MAX_BYTES)
}

export function isValidDiscoveryWorkspaceState(value) {
  try { validate(value); return true } catch { return false }
}

function checkedCopy(value) {
  if (!isValidDiscoveryWorkspaceState(value)) fail()
  return clone(value)
}

function interrupted(value) {
  const state = clone(value)
  for (const batch of state.batches) for (const query of batch.queries) {
    if (query.status === 'loading') { query.status = 'interrupted'; query.error = null }
  }
  return state
}

/** Separate owner: no network requests, candidate-owner writes, or filesystem effects. */
export function createDiscoveryWorkspaceStore(storage) {
  function inspect() {
    let raw
    try {
      if (!storage || typeof storage.getItem !== 'function') throw new Error('unavailable')
      raw = storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY)
    } catch { return { status: 'unavailable', raw: null, state: createEmptyDiscoveryWorkspaceState() } }
    if (raw === null) return { status: 'missing', raw, state: createEmptyDiscoveryWorkspaceState() }
    try {
      require(typeof raw === 'string' && bytes(raw) <= MAX_BYTES)
      const state = JSON.parse(raw); validate(state)
      return { status: 'valid', raw, state }
    } catch { return { status: 'invalid', raw, state: createEmptyDiscoveryWorkspaceState() } }
  }
  const initial = inspect()
  let baseline = initial.raw, known = initial.status !== 'unavailable'
  let state = interrupted(initial.state), loadStatus = initial.status
  const read = () => clone(state)
  function matches(raw) {
    try { return storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY) === raw } catch { return false }
  }
  function write(raw) {
    try {
      if (raw === null) storage.removeItem(DISCOVERY_WORKSPACE_STORAGE_KEY)
      else storage.setItem(DISCOVERY_WORKSPACE_STORAGE_KEY, raw)
    } catch { /* Read-back, not the thrown error, determines whether persistence happened. */ }
  }
  function replace(nextState, increment) {
    const replacement = checkedCopy(nextState)
    const before = inspect()
    const failure = status => ({ replaced: false, status, state: read() })
    if (before.status === 'invalid' || before.status === 'unavailable') return failure(before.status)
    if (!known || before.raw !== baseline) return failure('stale')
    if (!storage || typeof storage.setItem !== 'function') return failure('unavailable')
    if (increment) {
      replacement.revision = before.state.revision + 1
      validate(replacement)
    }
    const raw = JSON.stringify(replacement)
    if (before.raw !== raw) write(raw)
    if (matches(raw)) {
      state = replacement; loadStatus = 'valid'; baseline = raw; known = true
      return { replaced: true, state: read() }
    }
    if (!matches(before.raw)) write(before.raw)
    return failure(matches(before.raw) ? 'persistence_failed' : 'rollback_failed')
  }
  return {
    read,
    getLoadStatus: () => loadStatus,
    reload() {
      const inspected = inspect(); baseline = inspected.raw; known = inspected.status !== 'unavailable'
      state = interrupted(inspected.state); loadStatus = inspected.status
      return { status: loadStatus, state: read() }
    },
    readValidatedState() {
      // Refresh the transaction baseline, but leave the caller's session view intact.
      const inspected = inspect(); baseline = inspected.raw; known = inspected.status !== 'unavailable'
      return { status: inspected.status, state: clone(inspected.state) }
    },
    replaceValidated: nextState => replace(nextState, false),
    commit(nextState) {
      const result = replace(nextState, true)
      return result.replaced ? { persisted: true, state: result.state }
        : { persisted: false, reason: result.status, state: result.state }
    },
  }
}

/** Pure preview only. Task 11 must confirm this specific batch before committing it. */
export function previewDiscoveryBatchCleanup(input, batchId) {
  const state = checkedCopy(input)
  const batch = state.batches.find(batch => batch.batch_id === batchId)
  if (!batch) fail()
  const resolved = new Map(state.results.flatMap(result => [result.result_id, ...result.alias_ids].map(id => [id, result])))
  const protectedRecords = new Set()
  for (const reference of [...state.external_candidates, ...state.condition_reviews, ...state.scope_reviews, ...state.representative_reviews]) {
    for (const recordId of resolved.get(reference.result_id).record_ids) protectedRecords.add(recordId)
  }
  for (const other of state.batches) if (other.batch_id !== batchId) {
    for (const recordId of other.record_ids) protectedRecords.add(recordId)
  }
  const removable = new Set(state.records.filter(record => record.provenance.batch_id === batchId
    && !protectedRecords.has(record.record_id)).map(record => record.record_id))
  state.records = state.records.filter(record => !removable.has(record.record_id))
  state.results = state.results.flatMap(result => {
    result.record_ids = result.record_ids.filter(id => !removable.has(id))
    if (!result.record_ids.length) return []
    if (!result.record_ids.includes(result.preferred_record_id)) result.preferred_record_id = result.record_ids[0]
    return [result]
  })
  batch.record_ids = batch.record_ids.filter(id => !removable.has(id))
  batch.excluded_record_ids = batch.excluded_record_ids.filter(id => !removable.has(id))
  const otherConditionIds = new Set(state.batches.filter(item => item !== batch).flatMap(item => item.plan.conditions.map(condition => condition.id)))
  const definesReferencedCondition = state.condition_reviews.some(review => !otherConditionIds.has(review.condition_id))
  const retained = batch.record_ids.length > 0 || definesReferencedCondition
  if (!retained) state.batches = state.batches.filter(item => item !== batch)
  validate(state)
  return { batch_id: batchId, state, removed_records: removable.size, retained_records: batch.record_ids.length,
    removed_batches: retained ? 0 : 1, retained_batches: retained ? 1 : 0 }
}
