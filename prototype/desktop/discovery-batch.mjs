import { isValidDiscoveryRecord, classifyDiscoveryScope } from './discovery-record.mjs'
import { mergeDiscoveryRecords } from './discovery-identity.mjs'
import { buildOpenAlexSearchUrl } from './openalex-search.mjs'

const DEFAULT_RULES = { version: 1, data_year: null, category: 'Automation & Control Systems', low_match_limit: 5 }
const clone = value => structuredClone(value)
const fail = label => { throw new TypeError(`${label} 无效`) }

function exact(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(label)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key =>
    !descriptors[key]?.enumerable || !('value' in descriptors[key]))) fail(label)
  return value
}

function array(value, maximum, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) fail(label)
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(label)
  }
  return value
}

function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum
    || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) fail(label)
  return value
}

function identity(value, label) {
  text(value, 2048, label)
  if (value !== value.trim()) fail(label)
  return value
}

function unique(values, label) {
  if (new Set(values).size !== values.length) fail(label)
}

function year(value) {
  if (value !== null && (!Number.isInteger(value) || value < 1000 || value > 9999)) fail('年份')
}

/** Exact pure-data validation and defensive copy for controller and persisted plans. */
export function validateDiscoveryQueryPlan(input) {
  exact(input, ['conditions', 'selected', 'suggested', 'warnings'], '查询计划')
  const conditions = array(input.conditions, 50, '条件')
  for (const condition of conditions) {
    exact(condition, ['id', 'label', 'terms', 'role'], '条件')
    if (typeof condition.id !== 'string' || condition.id.length > 160
      || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(condition.id)) fail('条件 ID')
    text(condition.label, 500, '条件名称')
    const terms = array(condition.terms, 20, '条件术语')
    if (!terms.length) fail('条件术语')
    terms.forEach(term => text(term, 500, '条件术语'))
    if (!['problem', 'network', 'method', 'other'].includes(condition.role)) fail('条件角色')
  }
  const ids = conditions.map(condition => condition.id)
  unique(ids, '条件 ID')
  const queries = [...array(input.selected, 6, '实际查询'), ...array(input.suggested, 200, '建议查询')]
  for (const query of queries) {
    exact(query, ['query_id', 'expression', 'condition_ids', 'kind'], '查询')
    identity(query.query_id, '查询 ID')
    text(query.expression, 1000, '检索式')
    buildOpenAlexSearchUrl({ query: query.expression })
    const references = array(query.condition_ids, 50, '查询条件')
    if (references.some(id => !ids.includes(id))) fail('查询条件引用')
    unique(references, '查询条件引用')
    if (!['original', 'expanded', 'single'].includes(query.kind)) fail('查询类型')
  }
  unique(queries.map(query => query.query_id), '查询 ID')
  array(input.warnings, 500, '警告').forEach(warning => text(warning, 10000, '警告'))
  return clone(input)
}

function validateStart({ plan, scope, sort, rules = DEFAULT_RULES }) {
  const copiedPlan = validateDiscoveryQueryPlan(plan)
  exact(scope, ['startYear', 'endYear', 'language'], '检索范围')
  year(scope.startYear); year(scope.endYear)
  if (!['all', 'en', 'zh'].includes(scope.language)) fail('范围语言')
  // Also validate scope and sort for an import-only batch, with no network activity.
  buildOpenAlexSearchUrl({ query: 'validation', ...scope, sort })
  exact(rules, ['version', 'data_year', 'category', 'low_match_limit'], '推荐规则')
  if (rules.version !== 1 || rules.low_match_limit !== 5) fail('推荐规则')
  year(rules.data_year)
  text(rules.category, 500, '学科')
  return { plan: copiedPlan, scope: clone(scope), rules: clone(rules), sort }
}

export function createDiscoveryBatchController({ searchPage, onChange = () => {},
  now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  if ([searchPage, onChange, now, idFactory].some(value => typeof value !== 'function')) fail('批次依赖')
  let generation = 0
  let session = null
  let batch = null
  let records = []
  let results = []
  const read = () => clone({ batch, records, results, generation })
  function emit() {
    // Subscriber failures must not turn an accepted provider page into a failed page.
    try { onChange(read()) } catch { /* The subscriber owns its rendering errors. */ }
  }
  const current = (owner, job) => session === owner && !owner.stopped && owner.pending.get(job.id) === job

  function stop() {
    generation++
    const owner = session
    if (!owner) return
    owner.stopped = true
    for (const job of owner.pending.values()) {
      job.state.status = 'interrupted'
      job.state.error = null
      job.controller.abort()
      job.resolve()
    }
    owner.pending.clear()
    owner.queue.length = 0
  }

  function merge(incoming) {
    const merged = mergeDiscoveryRecords({ records, results, incoming, idFactory })
    const recordIds = merged.records.map(record => record.record_id)
    const excluded = merged.records.filter(record => classifyDiscoveryScope(record, batch.scope).status === 'excluded')
      .map(record => record.record_id)
    return { records: merged.records, results: merged.results, recordIds, excluded }
  }

  function commit(merged) {
    records = merged.records
    results = merged.results
    batch.record_ids = merged.recordIds
    batch.excluded_record_ids = merged.excluded
  }

  function validatePage(page, job) {
    exact(page, ['records', 'works', 'total', 'nextCursor'], '来源页面')
    const incoming = array(page.records, 25, '页面题录')
    array(page.works, 25, '兼容题录')
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 100000000) fail('来源总数')
    if (page.nextCursor !== null) {
      identity(page.nextCursor, '分页游标')
      if (page.nextCursor === job.cursor || job.state.accepted_cursors.includes(page.nextCursor)) fail('分页游标循环')
    }
    for (const record of incoming) {
      if (!isValidDiscoveryRecord(record) || record.provenance.batch_id !== batch.batch_id
        || record.provenance.query_id !== job.id || record.provenance.provider !== 'openalex'
        || record.provenance.method !== 'api' || record.provenance.verification !== 'api'
        || record.provenance.import_id !== null) fail('在线来源记录')
    }
    unique(incoming.map(record => record.record_id), '页面记录 ID')
    return merge(incoming)
  }

  async function run(owner, job) {
    try {
      // The provider owns its network operation; only this generation owns the result.
      const page = await searchPage({ query: job.state.query.expression, query_id: job.id,
        batch_id: owner.batchId, ...clone(owner.scope), sort: owner.sort,
        cursor: job.cursor, perPage: 25, signal: job.controller.signal, now, idFactory })
      if (!current(owner, job)) return
      if (job.state.accepted_cursors.includes(job.cursor)) return
      const merged = validatePage(page, job)
      if (!current(owner, job)) return
      commit(merged)
      job.state.accepted_cursors.push(job.cursor)
      job.state.loaded += page.records.length
      job.state.total = page.total
      job.state.cursor = page.nextCursor
      job.state.status = page.nextCursor === null ? 'finished' : 'ready'
      job.state.error = null
    } catch (error) {
      if (current(owner, job)) {
        job.state.status = 'failed'
        job.state.error = error instanceof Error ? error.message : '来源请求失败'
      }
    } finally {
      if (current(owner, job)) {
        owner.pending.delete(job.id)
        owner.active--
        job.resolve()
        emit()
        pump(owner)
      }
    }
  }

  function pump(owner) {
    while (session === owner && !owner.stopped && owner.active < 2 && owner.queue.length) {
      const job = owner.queue.shift()
      owner.active++
      void run(owner, job)
    }
  }

  function enqueue(owner, state) {
    if (owner.pending.has(state.query.query_id)) return owner.pending.get(state.query.query_id).promise
    let resolve
    const promise = new Promise(done => { resolve = done })
    const job = { id: state.query.query_id, state, cursor: state.cursor ?? '*',
      controller: new AbortController(), promise, resolve }
    state.status = 'loading'
    state.error = null
    owner.pending.set(job.id, job)
    owner.queue.push(job)
    return promise
  }

  function request(queryId, retrying) {
    const owner = session
    if (!owner || owner.stopped) return Promise.resolve()
    if (owner.pending.has(queryId)) return owner.pending.get(queryId).promise
    const state = batch.queries.find(item => item.query.query_id === queryId)
    if (!state || (retrying ? state.status !== 'failed' : state.status !== 'ready')) return Promise.resolve()
    const promise = enqueue(owner, state)
    emit()
    pump(owner)
    return promise
  }

  return {
    async start(input) {
      const checked = validateStart(input)
      const batchId = identity(idFactory(), '批次 ID')
      const createdAt = now()
      if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(createdAt)
        || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) fail('创建时间')
      const expectedGeneration = generation + 1
      stop()
      // An abort listener may have synchronously started a newer generation.
      if (generation !== expectedGeneration) return
      batch = { batch_id: batchId, created_at: createdAt, scope: checked.scope, plan: checked.plan,
        rule_snapshot: checked.rules, queries: checked.plan.selected.map(query => ({ query: clone(query),
          cursor: '*', total: null, accepted_cursors: [], loaded: 0, status: 'idle', error: null })),
        record_ids: [], excluded_record_ids: [] }
      records = []
      results = []
      const owner = { batchId, scope: checked.scope, sort: checked.sort, active: 0, stopped: false,
        queue: [], pending: new Map() }
      session = owner
      const pending = batch.queries.map(state => enqueue(owner, state))
      emit()
      pump(owner)
      await Promise.all(pending)
    },
    loadMore: queryId => request(queryId, false),
    retry: queryId => request(queryId, true),
    cancel() { stop(); emit() },
    read,
    acceptImported({ generation: expected, records: incoming } = {}) {
      const owner = session
      if (!owner || owner.stopped || expected !== generation) return false
      try {
        array(incoming, 500, '导入记录')
        for (const record of incoming) {
          if (!isValidDiscoveryRecord(record) || record.provenance.batch_id !== batch.batch_id
            || record.provenance.query_id !== null || !['import', 'local', 'manual'].includes(record.provenance.method)
            || (record.provenance.method === 'local' && record.provenance.provider !== 'local')) fail('导入来源')
        }
        const merged = merge(incoming)
        // Identity allocation can synchronously cancel or replace the owning batch.
        if (session !== owner || owner.stopped || expected !== generation) return false
        commit(merged)
        emit()
        return true
      } catch { return false }
    },
  }
}
