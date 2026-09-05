import { safeHttpsUrl } from './bibliography-normalization.mjs'

const REVIEW_KEYS = ['review_id', 'title', 'issns', 'identity_confirmed', 'metric', 'data_year', 'release_year',
  'category', 'quartile', 'source_url', 'import_description', 'checked_at', 'method']
const EVIDENCE_KEYS = ['record_ids', 'locator', 'reason', 'method', 'checked_at']
const CHINESE_JOURNALS = new Map([['0254-4156', '自动化学报'], ['1000-8152', '控制理论与应用']])
const CHINESE_JOURNAL_NAMES = new Map([
  ['自动化学报', '自动化学报'], ['Acta Automatica Sinica', '自动化学报'],
  ['控制理论与应用', '控制理论与应用'], ['Control Theory & Applications', '控制理论与应用'],
])
const CONFLICTING_WHITELIST_NAMES = new Set([
  'IEEE/CAA Journal of Automatica Sinica', 'Control Theory and Technology', 'Control and Decision', '控制与决策',
])

/** Exact approved bilingual names only; this resolves names, not ISSN or language eligibility. */
export function canonicalChineseJournalTitle(title) {
  return CHINESE_JOURNAL_NAMES.get(title) ?? null
}

const year = value => Number.isInteger(value) && value >= 1000 && value <= 9999
const text = (value, max = 2048) => typeof value === 'string' && !!value.trim() && value.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const id = value => text(value) && value === value.trim() && !/\s/u.test(value)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Reflect.ownKeys(value).length === keys.length
    && keys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])
}

function array(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    if (!descriptor?.enumerable || !('value' in descriptor)) return false
  }
  return true
}

/** A user-supplied review, never a claim of a live official JCR response. */
export function validateJournalReview(value) {
  try {
    return exact(value, REVIEW_KEYS) && id(value.review_id) && text(value.title, 500)
      && array(value.issns, 10) && value.issns.length > 0
      && value.issns.every(issn => typeof issn === 'string' && /^\d{4}-\d{3}[\dX]$/u.test(issn))
      && new Set(value.issns).size === value.issns.length
      && typeof value.identity_confirmed === 'boolean' && value.metric === 'JIF' && year(value.data_year)
      && (value.release_year === null || year(value.release_year)) && text(value.category, 500)
      && ['Q1', 'Q2', 'Q3', 'Q4'].includes(value.quartile)
      && (value.source_url === null || !!safeHttpsUrl(value.source_url))
      && (value.import_description === null || text(value.import_description, 2000))
      && (value.source_url !== null || value.import_description !== null)
      && instant(value.checked_at) && value.method === 'user'
  } catch { return false }
}

function validEvidence(value) {
  return exact(value, EVIDENCE_KEYS) && array(value.record_ids, 1000) && value.record_ids.length > 0
    && value.record_ids.every(id) && new Set(value.record_ids).size === value.record_ids.length
    && text(value.locator, 2000) && text(value.reason, 2000)
    && ['manual', 'local_tag'].includes(value.method) && instant(value.checked_at)
}

function readRules(rules) {
  if (!exact(rules, ['version', 'data_year', 'category', 'low_match_limit']) || rules.version !== 1
    || rules.low_match_limit !== 5 || (rules.data_year !== null && !year(rules.data_year)) || !text(rules.category, 500)) {
    throw new TypeError('推荐规则无效')
  }
}

/** This standalone gate checks evidence shape; the Result evaluator checks current record ownership. */
export function evaluateJournalGate({ bibliography, journal_reviews, rules, scope_reviews = [], result_id = null }) {
  readRules(rules)
  const pending = missing => ({ status: 'pending', basis: [], missing: [missing] })
  const publication = bibliography?.work_type
  const journal = bibliography?.journal
  if (!publication || !journal?.source_type) return pending('文献类型或期刊类型待核验')
  if (!['article', 'journal-article', 'review'].includes(publication) || journal.source_type !== 'journal') {
    return { status: 'fail', basis: ['非已核验期刊论文，保留在全部结果'], missing: [] }
  }
  if (!array(journal.issns, 10)) return pending('期刊身份待核验')
  const whiteMatches = journal.issns.filter(issn => CHINESE_JOURNALS.has(issn))
  const canonicalTitle = canonicalChineseJournalTitle(journal.title)
  if (whiteMatches.length || canonicalTitle || (bibliography.language === 'zh' && CONFLICTING_WHITELIST_NAMES.has(journal.title))) {
    if (bibliography.language !== 'zh') return pending('中文书目语言待核验')
    if (whiteMatches.length === 1 && journal.issns.length === 1
      && (!journal.title || canonicalTitle === CHINESE_JOURNALS.get(whiteMatches[0]))) {
      return { status: 'pass', basis: [`中文期刊名单准入：${CHINESE_JOURNALS.get(whiteMatches[0])} (${whiteMatches[0]})`], missing: [] }
    }
    if (journal.issns.length === 0 && canonicalTitle && result_id !== null && scope_reviews.some(review =>
      exact(review, ['result_id', 'field', 'value', 'evidence']) && review.result_id === result_id
      && review.field === 'journal_identity' && review.value === canonicalTitle && validEvidence(review.evidence))) {
      return { status: 'pass', basis: [`中文期刊名单准入：用户核验 ${canonicalTitle}`], missing: [] }
    }
    return pending('中文期刊身份缺失或冲突')
  }
  if (bibliography.language === null || bibliography.language === undefined) return pending('书目语言待核验')
  if (bibliography.language !== 'en') {
    return { status: 'fail', basis: [bibliography.language === 'zh'
      ? '未在本轮中文期刊名单内，保留在全部结果' : '本轮仅提供英文期刊与指定中文期刊推荐规则，保留在全部结果'], missing: [] }
  }
  const confirmed = journal_reviews.filter(review => validateJournalReview(review) && review.identity_confirmed)
  // The selected year comes from the whole supplied batch, not this journal's history.
  const dataYear = rules.data_year ?? (confirmed.length ? Math.max(...confirmed.map(review => review.data_year)) : null)
  if (dataYear === null) return pending('缺少已确认 JIF 数据年和期刊证据')
  const matches = confirmed.filter(review => review.data_year === dataYear && review.category === rules.category
    && journal.issns.length > 0 && journal.issns.some(issn => review.issns.includes(issn)))
  if (!matches.length) return pending(`缺少 ${dataYear} 年 ${rules.category} 的已确认 JIF 期刊身份及分区`)
  // A confirmed overlapping ISSN is sufficient; an omitted secondary ISSN is incomplete coverage, not contradictory identity.
  const quartiles = [...new Set(matches.map(review => review.quartile))]
  if (quartiles.length !== 1) return pending(`同年同学科 JIF 分区冲突：${quartiles.sort().join(' / ')}`)
  const quartile = quartiles[0]
  return { status: ['Q1', 'Q2'].includes(quartile) ? 'pass' : 'fail', missing: [],
    basis: [`用户核验记录：JIF ${dataYear} · ${rules.category} · ${quartile}`,
      ...matches.map(review => `${review.review_id}: ${review.source_url ?? review.import_description}`)] }
}

function csvCells(text) {
  const rows = [], row = []
  let field = '', quoted = false, closed = false
  const finishField = () => { row.push(field); field = ''; closed = false }
  const finishRow = () => {
    finishField()
    if (row.some(value => value.length)) rows.push([...row])
    row.length = 0
    if (rows.length > 501) throw new RangeError('CSV 最多 500 行数据')
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i+1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === ',') finishField()
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[i+1] === '\n') i++; finishRow() }
    else if (char === '"' && !field && !closed) quoted = true
    else {
      if (closed || char === '"') throw new TypeError('CSV 引号格式无效')
      field += char
    }
  }
  if (quoted) throw new TypeError('CSV 引号未闭合')
  if (field.length || closed || row.length) finishRow()
  return rows
}

/** Pure bounded preview. Dropping this return value cancels import without any mutation. */
export function parseJournalCsv({ text: input, mapping, now, idFactory }) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > 2 * 1024 * 1024) throw new RangeError('CSV 最多 2 MiB')
  const fields = ['title', 'issns', 'metric', 'data_year', 'release_year', 'category', 'quartile', 'source_url', 'import_description']
  if (!mapping || Object.getPrototypeOf(mapping) !== Object.prototype) throw new TypeError('CSV 列映射无效')
  const mapped = Reflect.ownKeys(mapping)
  if (mapped.some(key => !fields.includes(key) || !('value' in Object.getOwnPropertyDescriptor(mapping, key)) || !text(mapping[key], 500))
    || ['title', 'issns', 'metric', 'data_year', 'category', 'quartile'].some(key => !mapped.includes(key))
    || (!mapped.includes('source_url') && !mapped.includes('import_description'))
    || new Set(Object.values(mapping)).size !== mapped.length) throw new TypeError('CSV 列映射无效')
  if (!instant(now) || typeof idFactory !== 'function') throw new TypeError('CSV 核验时间或 ID 工厂无效')
  const cells = csvCells(input.replace(/^\uFEFF/u, ''))
  if (!cells.length) return { rows: [], warnings: [] }
  const headings = cells.shift().map(value => value.trim())
  if (new Set(headings).size !== headings.length) throw new TypeError('CSV 重复列名')
  const warnings = headings.filter(heading => !Object.values(mapping).includes(heading)).map(heading => `未知列仅作预览、不执行：${heading}`)
  if (Object.values(mapping).some(heading => !headings.includes(heading))) return { rows: [], warnings: [...warnings, 'CSV 缺少映射列'] }
  const rows = [], usedIds = new Set()
  for (const [index, cell] of cells.entries()) {
    if (cell.length !== headings.length) { warnings.push(`第 ${index+2} 行列数不符，未导入`); continue }
    const value = key => mapping[key] ? cell[headings.indexOf(mapping[key])].trim() : ''
    const candidate = { review_id: idFactory(index), title: value('title'),
      issns: [...new Set(value('issns').split(/[;,\s]+/u).filter(Boolean).map(issn => issn.toUpperCase()))],
      identity_confirmed: false, metric: value('metric'), data_year: /^\d{4}$/u.test(value('data_year')) ? Number(value('data_year')) : null,
      release_year: value('release_year') ? (/^\d{4}$/u.test(value('release_year')) ? Number(value('release_year')) : NaN) : null,
      category: value('category'), quartile: value('quartile'), source_url: value('source_url') || null,
      import_description: value('import_description') || null, checked_at: now, method: 'user' }
    if (!validateJournalReview(candidate) || usedIds.has(candidate.review_id)) {
      warnings.push(`第 ${index+2} 行身份、JIF 指标、年份、学科、分区、来源或 ID 无效，未导入`)
      continue
    }
    usedIds.add(candidate.review_id); rows.push(candidate)
  }
  return { rows, warnings }
}
