// Literal terminology only. These pairs do not establish semantic relevance,
// source language, or evidence that a paper actually uses the named method.
const TERMINOLOGY = [
  ['时变非平衡有向网络', 'time-varying unbalanced directed graph'],
  ['时变有向网络', 'time-varying directed graph'],
  ['梯度跟踪', 'gradient tracking'], ['分布式优化', 'distributed optimization'],
  ['分布式约束优化', 'distributed constrained optimization'], ['在线优化', 'online optimization'],
  ['分布式在线约束优化', 'distributed online constrained optimization'],
  ['联邦学习', 'federated learning'], ['有向网络', 'directed network'], ['无向网络', 'undirected network'],
  ['时变拓扑', 'time-varying topology'], ['静态拓扑', 'static topology'],
  ['非平衡网络', 'unbalanced network'], ['平衡网络', 'balanced network'],
  ['事件触发', 'event-triggered'], ['耦合约束', 'coupled constraints'],
  ['无耦合约束', 'uncoupled constraints'], ['一阶反馈', 'first-order oracle'], ['零阶反馈', 'zeroth-order oracle'],
  ['低通信', 'communication-efficient'], ['每轮通信', 'communication at every iteration'],
  ['无隐私机制', 'without privacy mechanism'], ['隐私保护', '隐私', 'privacy-preserving'],
  ['原始—对偶', '原始-对偶', 'primal-dual'], ['次梯度', 'subgradient'], ['零阶', 'zeroth-order'],
  ['线性收敛', 'linear convergence'], ['渐近收敛', 'asymptotic convergence'],
  ['收敛性', 'convergence'], ['遗憾界', 'regret bound'],
]
const TEXT_FIELDS = ['title_original', 'title_en', 'title_zh', 'abstract', 'note_preview', 'note_preview_text']
const LOCAL_PAPER_ID = /^(?:[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|LIB-[A-F0-9]{12})$/u
const FACET_PATHS = ['research.domain', 'research.mode', 'objective', 'constraints.scope', 'constraints.form',
  'constraints.consistency', 'oracle.information', 'oracle.estimation', 'methods.framework',
  'methods.coordination', 'methods.operator', 'network.direction', 'network.time', 'network.balance',
  'network.mixing', 'privacy_robustness', 'results', 'applications']
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim() : ''
const atPath = (value, path) => path.split('.').reduce((node, key) => node?.[key], value)

function termsFor(values) {
  const terms = new Set(values.map(normalize).filter(Boolean))
  for (const pair of TERMINOLOGY) {
    if (pair.some(term => terms.has(normalize(term)))) pair.forEach(term => terms.add(normalize(term)))
  }
  return [...terms]
}

function contains(value, term) {
  const content = normalize(value)
  if (!content || !term) return false
  if (/\p{Script=Han}/u.test(term)) return content.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(content)
}

function searchableFields(paper) {
  const fields = TEXT_FIELDS.filter(field => typeof paper[field] === 'string').map(field => [field, [paper[field]]])
  for (const path of FACET_PATHS) {
    const values = atPath(paper.facets, path)
    if (Array.isArray(values)) fields.push([`facets.${path}`, values.filter(value => typeof value === 'string')])
  }
  if (Array.isArray(paper.source_terms)) fields.push(['source_terms', paper.source_terms.filter(value => typeof value === 'string')])
  return fields
}

function publicPaper(paper) {
  // Never spread an index record: it also contains private artifact paths.
  const copy = {}
  for (const field of ['paper_id', ...TEXT_FIELDS, 'venue']) {
    if (typeof paper[field] === 'string') copy[field] = paper[field]
  }
  copy.authors = Array.isArray(paper.authors) ? paper.authors.filter(author => typeof author === 'string') : []
  copy.year = Number.isInteger(paper.year) ? paper.year : null
  copy.publication_year = Number.isInteger(paper.publication_year) ? paper.publication_year : null
  copy.language = typeof paper.language === 'string' && paper.language.trim() ? paper.language.trim().toLowerCase() : null
  copy.facets = {}
  for (const path of FACET_PATHS) {
    const values = atPath(paper.facets, path)
    if (!Array.isArray(values)) continue
    const keys = path.split('.')
    const leaf = keys.pop()
    const parent = keys.reduce((node, key) => (node[key] ??= {}), copy.facets)
    parent[leaf] = values.filter(value => typeof value === 'string')
  }
  copy.facet_states = Object.fromEntries(FACET_PATHS.filter(path =>
    ['unrecorded', 'not_applicable', 'pending_verification'].includes(paper.facet_states?.[path]))
    .map(path => [path, paper.facet_states[path]]))
  copy.source_terms = Array.isArray(paper.source_terms) ? paper.source_terms.filter(term => typeof term === 'string') : []
  copy.metadata_provenance = Object.fromEntries(['facets', 'facet_states', 'source_terms'].filter(field =>
    typeof paper.metadata_provenance?.[field] === 'string' && /^[a-z_]+$/u.test(paper.metadata_provenance[field]))
    .map(field => [field, paper.metadata_provenance[field]]))
  return copy
}

/** Synchronous, read-only topical hints from supplied fields, never URLs or fulltext.
 * Conditions are broad OR recall. Raw input is one literal phrase (not parsed
 * as an online Boolean query). Unknown scope values remain eligible for review.
 */
export function searchLocalDiscovery({ papers, conditions = [], raw = '', scope = {} } = {}) {
  if (!Array.isArray(papers)) throw new TypeError('请先载入有效的本地论文索引')
  if (!Array.isArray(conditions) || typeof raw !== 'string') throw new TypeError('本地检索条件无效')
  const groups = conditions.map(condition => {
    if (!condition || typeof condition.id !== 'string' || !Array.isArray(condition.terms)) throw new TypeError('本地检索条件无效')
    return { id: condition.id, terms: termsFor([condition.label, ...condition.terms]) }
  })
  const rawTerms = termsFor([raw])
  const hits = []
  for (const paper of papers) {
    if (!paper || typeof paper !== 'object' || Array.isArray(paper) || !LOCAL_PAPER_ID.test(paper.paper_id ?? '')) continue
    const year = Number.isInteger(paper.publication_year) ? paper.publication_year : paper.year
    if (Number.isInteger(year) && ((Number.isInteger(scope.startYear) && year < scope.startYear)
      || (Number.isInteger(scope.endYear) && year > scope.endYear))) continue
    const language = normalize(paper.language)
    if (['en', 'zh'].includes(scope.language) && language && !['unknown', 'und'].includes(language) && language !== scope.language) continue
    const fields = searchableFields(paper)
    const matched = new Set()
    const ids = new Set()
    for (const { id, terms } of [...groups, { id: null, terms: rawTerms }]) {
      for (const [field, values] of fields) {
        if (!values.some(value => terms.some(term => contains(value, term)))) continue
        matched.add(field)
        if (id !== null) ids.add(id)
      }
    }
    if (matched.size) hits.push({ paper: publicPaper(paper), hint_condition_ids: [...ids],
      matched_fields: fields.map(([field]) => field).filter(field => matched.has(field)) })
  }
  return hits
}
