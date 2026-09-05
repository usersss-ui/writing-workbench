import { safeHttpsUrl } from './bibliography-normalization.mjs'

function displayReasons(values) {
  const conflictLabels = { doi_mismatch: 'DOI 不一致', year_mismatch: '发表年份不一致',
    publication_type_mismatch: '文献类型不一致', title_mismatch: '题名不一致',
    journal_mismatch: '期刊身份不一致', title_similarity: '题名相似，身份待核对' }
  return [...new Set(values.map(value => {
    const code = /^([a-z_]+):\[/u.exec(value)?.[1]
    return code ? conflictLabels[code] ?? '来源身份不一致，需核对来源' : value
  }))].join('；')
}

/** Render only supplied public projections. All source text remains literal text. */
export function renderDiscoveryResults({ root, results, records, evaluations, view = 'all',
  onSelect, onReview, localMatches = new Map(), onView = () => {}, onExportSelect = () => {}, selected = new Set(),
  onConvert, candidates = [], visibleIds = null, page = 1, hasMore = false, onPage = () => {}, unavailableReason = '' }) {
  const list = root.querySelector('#keyword-live-results-list')
  if (!list) return
  const make = (tag, value) => { const element = root.createElement(tag); if (value !== undefined) element.textContent = value; return element }
  const byRecord = new Map(records.map(record => [record.record_id, record]))
  const byEvaluation = new Map(evaluations.map(item => [item.result_id, item]))
  const byResult = new Map(results.map(result => [result.result_id, result]))
  const visible = view === 'all' ? results : visibleIds
    ? visibleIds.map(id => byResult.get(id)).filter(Boolean)
    : results.filter(result => byEvaluation.get(result.result_id)?.status === 'recommended')
  const summary = make('p', `去重后已加载 ${results.length} 篇；仅代表本轮已加载范围`)
  summary.className = 'discovery-loaded-summary'
  const children = [summary]
  if (view === 'curated' && !visible.length) {
    children.push(make('p', unavailableReason || `暂无符合严格规则的重点推荐。${displayReasons(evaluations.flatMap(item => [...item.missing, ...item.reasons])) || '请先设置条件，并补充期刊、范围和人工条件证据。'}`))
    const back = make('button', '回到全部结果'); back.type = 'button'; back.dataset.returnAll = 'true'
    back.addEventListener('click', () => onView('all')); children.push(back)
  }
  for (const pending of [false, true]) {
    const group = visible.filter(result => (byEvaluation.get(result.result_id)?.status === 'pending') === pending)
    if (!group.length) continue
    children.push(make('h4', pending ? '待核验结果' : '常规结果'))
    for (const result of group) {
      const record = byRecord.get(result.preferred_record_id); if (!record) continue
      const bib = record.bibliography, evaluation = byEvaluation.get(result.result_id)
      const card = make('article'); card.className = 'discovery-result-card'; card.dataset.resultId = result.result_id
      if (record.provider_id) card.dataset.paperId = record.provider_id
      const local = localMatches.get(result.result_id) ?? { status: 'unknown', matches: [] }
      card.dataset.localStatus = local.status
      card.append(make('h3', bib.title), make('p', [bib.year ?? '年份未报告', bib.journal.title ?? '期刊未报告',
        bib.citations ? `${bib.citations.provider} 被引 ${bib.citations.count}` : '引用次数未核验'].join(' · ')))
      card.append(make('p', [...new Set(result.record_ids.map(id => byRecord.get(id)?.provenance.provider).filter(Boolean))].join(' / ')))
      const localText = ({ existing_pdf: '本地已有 PDF · 当前索引可打开', missing_pdf: '本地有记录 · 当前索引缺 PDF',
        not_found: '当前本地索引未匹配', possible_match: '疑似重复 · 请先核对', unknown: '本地状态未知 · 索引不可用' })[local.status]
      card.append(make('p', localText), make('p', local.reason ?? ''), make('p', local.matches.some(item => item.hasNote) ? '本地索引已有笔记' : '本地索引未标记笔记'))
      for (const match of local.matches) {
        const link = make('a', match.title || match.paperId); link.href = match.href; card.append(link)
      }
      if (evaluation) card.append(make('p', displayReasons([...evaluation.reasons, ...evaluation.missing])))
      if (result.conflicts.length) card.append(make('p', `本篇包含 ${result.record_ids.length} 条来源记录；请打开“核验依据”逐项核对来源。`))
      const url = safeHttpsUrl(bib.url || record.provenance.public_url)
      if (url) { const link = make('a', '出版来源 / 全文线索 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link) }
      const choice = make('label', '选择导出'); const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(result.result_id)
      checkbox.dataset.exportResult = result.result_id; checkbox.addEventListener('change', () => onExportSelect(result.result_id, checkbox.checked)); choice.append(checkbox); card.append(choice)
      const candidate = candidates.find(item => item.result_id === result.result_id || result.alias_ids.includes(item.result_id))
      const select = make('button', candidate ? '已加入外部候选' : '加入候选'); select.type = 'button'; select.disabled = Boolean(candidate)
      select.dataset.selectResult = result.result_id; select.addEventListener('click', () => onSelect(result.result_id)); card.append(select)
      const review = make('button', '核验依据'); review.type = 'button'; review.dataset.reviewResult = result.result_id
      review.addEventListener('click', () => onReview(result.result_id)); card.append(review)
      if (candidate && onConvert) {
        const convert = make('button', candidate.openalex_id ? '已衔接归档候选' : '核验并转入归档候选'); convert.type = 'button'
        convert.disabled = Boolean(candidate.openalex_id) || !bib.doi || result.identity_status !== 'clear'
        convert.dataset.convertResult = result.result_id; convert.addEventListener('click', () => onConvert(result.result_id)); card.append(convert)
      }
      children.push(card)
    }
  }
  if (view === 'curated' && (page > 1 || hasMore)) {
    for (const [direction, label, next, disabled] of [['previous', '上一页推荐', page - 1, page === 1], ['next', '下一页推荐', page + 1, !hasMore]]) {
      const control = make('button', label); control.type = 'button'; control.disabled = disabled; control.dataset.recommendationPage = direction
      control.addEventListener('click', () => onPage(next)); children.push(control)
    }
  }
  list.replaceChildren(...children)
}
