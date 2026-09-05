import { DIRECTION_AXIS_VALUES } from './direction-snapshot.mjs'

// Shared vocabulary; matching uses longest terms first, display keeps this order.
const KEYWORDS = [
  ['时变非平衡有向网络', 'time-varying unbalanced directed graph'],
  ['时变有向网络', 'time-varying directed graph'],
  ['分布式在线约束优化', 'distributed online constrained optimization'],
  ['分布式约束优化', 'distributed constrained optimization'],
  ['分布式优化', 'distributed optimization'], ['在线优化', 'online optimization'],
  ['联邦学习', 'federated learning'], ['有向网络', 'directed network'], ['无向网络', 'undirected network'],
  ['时变拓扑', 'time-varying topology'], ['静态拓扑', 'static topology'],
  ['非平衡网络', 'unbalanced network'], ['平衡网络', 'balanced network'],
  ['事件触发', 'event-triggered'], ['无耦合约束', 'uncoupled constraints'], ['耦合约束', 'coupled constraints'],
  ['一阶反馈', 'first-order oracle'], ['零阶反馈', 'zeroth-order oracle'],
  ['低通信', 'communication-efficient'], ['每轮通信', 'communication at every iteration'],
  ['无隐私机制', 'without privacy mechanism'], ['隐私保护', 'privacy-preserving'], ['隐私', 'privacy-preserving'],
  ['零阶', 'zeroth-order'], ['次梯度', 'subgradient'], ['梯度跟踪', 'gradient tracking'],
  ['原始—对偶', 'primal-dual'], ['原始-对偶', 'primal-dual'], ['ADMM', 'ADMM'],
  ['渐近收敛', 'asymptotic convergence'], ['线性收敛', 'linear convergence'],
  ['收敛性', 'convergence'], ['遗憾界', 'regret bound'],
]
const vocabulary = new Map(KEYWORDS)
const safeId = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u
const axisRoles = { problem: 'problem', direction: 'network', topology: 'network', balance: 'network', algorithm: 'method' }

function checkedQuery(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('请输入研究方向或关键词')
  let size
  try { size = encodeURIComponent(raw).length } catch { throw new Error('检索式包含无效字符，请修改') }
  if ([...raw].length > 1000 || size > 8000) throw new Error('检索式过长，请缩短检索式后重试；未裁剪任何词语')
  if (/[\u0000-\u001f\u007f]/u.test(raw)) throw new Error('检索式包含无效控制字符')
  return raw
}

export function translateDiscoveryKeywords(value) {
  const source = checkedQuery(value)
  if (!/[\u3400-\u9fff]/u.test(source)) return source
  let remainder = source
  const found = new Set()
  for (const [chinese, english] of [...KEYWORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (!remainder.includes(chinese)) continue
    remainder = remainder.split(chinese).join(' ')
    found.add(english)
  }
  remainder = remainder.replace(/[的中在上与和及、，,。；;（）()\s]/gu, '')
  if (remainder || !found.size) throw new Error('不能可靠转换全部中文关键词；请改用英文检索式')
  const terms = [...new Set(KEYWORDS.map(([, english]) => english))].filter(term => found.has(term))
  return checkedQuery(`(${terms.map(term => `"${term}"`).join(' AND ')})`)
}

function exactObject(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable
    && 'value' in Object.getOwnPropertyDescriptor(value, key))
}

export function directionToConditions(axes) {
  if (!exactObject(axes, Object.keys(DIRECTION_AXIS_VALUES))) throw new Error('研究方向参数无效')
  const conditions = []
  for (const [axis, allowed] of Object.entries(DIRECTION_AXIS_VALUES)) {
    const values = Object.hasOwn(axes, axis) ? axes[axis] : []
    if (!Array.isArray(values) || values.length > allowed.length || new Set(values).size !== values.length
      || values.some(value => typeof value !== 'string' || !allowed.includes(value))) throw new Error('研究方向包含无效选项')
    const canonical = allowed.filter(value => values.includes(value))
    if (!canonical.length) continue
    conditions.push({
      id: `axis-${axis}-${canonical.map(value => allowed.indexOf(value)).join('-')}`,
      label: canonical.join('或'), terms: canonical.map(value => vocabulary.get(value)), role: axisRoles[axis] ?? 'other',
    })
  }
  return { conditions, warnings: conditions.length ? ['研究方向已按同轴 OR 分组；请确认条件后搜索，扩展检索需另行确认。'] : [] }
}

export function encodeDirectionAxes(axes) {
  directionToConditions(axes)
  const canonical = Object.fromEntries(Object.entries(DIRECTION_AXIS_VALUES)
    .filter(([axis]) => axes[axis]?.length).map(([axis, values]) => [axis, values.filter(value => axes[axis].includes(value))]))
  const raw = JSON.stringify({ version: 1, axes: canonical })
  if (encodeURIComponent(raw).length > 8000) throw new Error('研究方向参数过长，请减少条件')
  return raw
}

export function decodeDirectionAxes(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 8000 || encodeURIComponent(raw).length > 8000) throw new Error()
    const parsed = JSON.parse(raw)
    if (!exactObject(parsed, ['version', 'axes']) || Object.keys(parsed).length !== 2 || parsed.version !== 1) throw new Error()
    return directionToConditions(parsed.axes)
  } catch { throw new Error('研究方向参数无效或过长；请返回方向页重新选择') }
}

function normalizeConditions(values) {
  if (!Array.isArray(values) || values.length > 50) throw new Error('研究条件无效或过多')
  const byId = new Map()
  for (const c of values) {
    if (!exactObject(c, ['id', 'label', 'terms', 'role']) || Object.keys(c).length !== 4
      || typeof c.id !== 'string' || c.id.length > 160 || !safeId.test(c.id)
      || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 500
      || !['problem', 'network', 'method', 'other'].includes(c.role)
      || !Array.isArray(c.terms) || !c.terms.length || c.terms.length > 20
      || c.terms.some(t => typeof t !== 'string' || !t.trim() || t.length > 500 || /["\\\u0000-\u001f\u007f]/u.test(t))) {
      throw new Error('研究条件或术语无效；请修改需要引号转义的词语')
    }
    const copy = { id: c.id, label: c.label, terms: [...new Set(c.terms)], role: c.role }
    if (byId.has(c.id) && JSON.stringify(byId.get(c.id)) !== JSON.stringify(copy)) throw new Error('研究条件 ID 冲突')
    byId.set(c.id, copy)
  }
  return [...byId.values()]
}

const conditionExpression = c => c.terms.length === 1 ? `"${c.terms[0]}"` : `(${c.terms.map(t => `"${t}"`).join(' OR ')})`

export function buildDiscoveryQueryPlan({ raw = '', conditions: input = [], expand = false, primary_ids = [] } = {}) {
  const conditions = normalizeConditions(input)
  if (typeof raw !== 'string') throw new Error('检索式无效')
  if (!Array.isArray(primary_ids) || primary_ids.some(id => !conditions.some(c => c.id === id))) throw new Error('主问题条件 ID 无效')
  const queries = []
  function add(group, kind = 'expanded') {
    if (!group.length) return null
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id, 'en'))
    const roles = ['problem', 'network', 'method', 'other']
    const displayOrder = [...ordered].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role))
    const expression = checkedQuery(`(${displayOrder.map(conditionExpression).join(' AND ')})`)
    const existing = queries.find(q => q.expression === expression)
    if (existing) return existing
    const ids = ordered.map(c => c.id)
    // Length prefixes avoid collisions between IDs containing hyphens.
    const query = { query_id: `q-${ids.map(id => `${id.length}-${id}`).join('-')}`, expression, condition_ids: ids, kind }
    queries.push(query)
    return query
  }
  const original = raw.trim() ? { query_id: 'original', expression: checkedQuery(raw), condition_ids: [], kind: 'original' } : null
  if (original) queries.push(original)
  const primary = conditions.filter(c => primary_ids.length ? primary_ids.includes(c.id) : c.role === 'problem')
  add(primary)
  for (const role of ['network', 'method']) {
    for (const c of [...conditions].sort((a, b) => a.id.localeCompare(b.id, 'en')).filter(c => c.role === role && !primary.includes(c))) {
      if (primary.length) add([...primary, c])
    }
  }
  const intersection = add(conditions)
  for (const c of [...conditions].sort((a, b) => a.id.localeCompare(b.id, 'en'))) add([c], 'single')
  if (!queries.length) throw new Error('请输入研究方向或关键词')
  let selected = expand === true ? queries.slice(0, 6) : [original ?? intersection]
  if (expand === true && intersection && !selected.includes(intersection)) selected[selected.length - 1] = intersection
  const suggested = queries.filter(q => !selected.includes(q))
  const warnings = []
  if (suggested.length) warnings.push(expand === true
    ? `还有 ${suggested.length} 条建议未执行；本批最多 6 条，请按需继续。`
    : `还有 ${suggested.length} 条扩展建议未执行；请明确确认后运行。`)
  return { conditions, selected, suggested, warnings }
}

export function buildExternalSearchLinks({ query, scope = {} }) {
  checkedQuery(query)
  const year = value => {
    if (value === null || value === undefined || value === '') return null
    if (!/^\d{4}$/u.test(String(value)) || Number(value) < 1000) throw new Error('年份无效')
    return Number(value)
  }
  const start = year(scope.startYear), end = year(scope.endYear)
  if (start !== null && end !== null && start > end) throw new Error('起始年份不能晚于结束年份')
  if (scope.language !== undefined && !['all', 'en', 'zh'].includes(scope.language)) throw new Error('语言范围无效')
  const params = new URLSearchParams({ q: query })
  if (start !== null) params.set('as_ylo', start)
  if (end !== null) params.set('as_yhi', end)
  return { scholar: `https://scholar.google.com/scholar?${params}`, cnki: 'https://kns.cnki.net/kns8s/', cnki_terms: query,
    scope_notice: '外部语言筛选未自动设置；请在来源页面确认年份、语言和文献范围。知网请复制中文关键词后检索。' }
}
