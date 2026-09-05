import { createDiscoveryWorkspaceStore, isValidDiscoveryWorkspaceState, previewDiscoveryBatchCleanup } from './discovery-workspace.mjs'
import { createDiscoveryBatchController } from './discovery-batch.mjs'
import { buildDiscoveryQueryPlan, buildExternalSearchLinks, translateDiscoveryKeywords } from './discovery-query-plan.mjs'
import { normalizeDiscoveryRecord, classifyDiscoveryScope } from './discovery-record.mjs'
import { mergeDiscoveryRecords } from './discovery-identity.mjs'
import { searchOpenAlexDiscoveryPage } from './openalex-search.mjs'
import { prepareExternalCandidateConversion } from './discovery-candidate-bridge.mjs'
import { parseBibliography, exportBibliography } from './bibliography-import.mjs'
import { evaluateDiscoveryRecommendation, selectDiscoveryRecommendations } from './discovery-recommendation.mjs'
import { parseJournalCsv } from './journal-review.mjs'
import { searchLocalDiscovery } from './local-discovery.mjs'
import { matchLocalPaper } from './local-paper-match.mjs'
import { renderDiscoveryResults } from './discovery-results-ui.mjs'
import { createDiscoveryReviewController } from './discovery-review-ui.mjs'
import { normalizeDoi, safeHttpsUrl } from './bibliography-normalization.mjs'

const copy = value => structuredClone(value)
const id = () => crypto.randomUUID()
const instant = () => new Date().toISOString()
const legacyKeys = ['paperId', 'doi', 'title', 'authors', 'year', 'source', 'citations', 'isOpenAccess', 'openAccessUrl', 'landingPageUrl', 'topics', 'abstract']
const legacy = work => Object.fromEntries(legacyKeys.map(key => [key, copy(work[key])]))
const sortValue = value => ({ cited_by_count: 'citations', publication_date: 'newest' })[value] ?? (['relevance', 'citations', 'newest'].includes(value) ? value : 'relevance')

/** Owns all discovery search/result events. Archive and access flows remain in discovery.mjs. */
export function createDiscoverySessionUI({ root, workspaceStore = createDiscoveryWorkspaceStore(), searchPage, searchWorks,
  batchController, candidateStore, fetchImpl = globalThis.fetch, confirmArchive = message => globalThis.confirm?.(message) === true,
  onQueueChange = () => {}, initialDirection = null }) {
  const node = selector => root.querySelector(selector)
  const message = (value, selector = '#discovery-status') => { const target = node(selector); if (target) target.textContent = value }
  const make = (tag, text) => { const element = root.createElement(tag); if (text !== undefined) element.textContent = text; return element }
  const button = (label, action, data = {}) => { const element = make('button', label); element.type = 'button'; Object.assign(element.dataset, data); element.addEventListener('click', action); return element }
  let state = workspaceStore.read(), generation = 0, activeBatchId = state.batches.at(-1)?.batch_id ?? null
  let view = 'all', recommendationPage = 1, busy = false, preview = null, journalPreview = null, localIndex = null, sessionBatch = false
  let conditions = copy(initialDirection?.conditions ?? []), conditionRows = []
  let directionMeaning = Boolean(initialDirection)
  const exportSelection = new Set(), cache = new Map(), conversionBusy = new Set()
  const currentBatch = () => state.batches.find(item => item.batch_id === activeBatchId) ?? null
  function resolvedRules(rules) {
    const years = state.journal_reviews.filter(row => row.identity_confirmed && row.category === rules.category).map(row => row.data_year)
    return { ...copy(rules), data_year: rules.data_year ?? (years.length ? Math.max(...years) : null) }
  }
  const currentResults = () => {
    const owned = new Set(currentBatch()?.record_ids ?? [])
    return state.results.filter(result => result.record_ids.some(recordId => owned.has(recordId)))
  }
  const getContext = () => ({ state: copy(state), generation, batch: copy(currentBatch()) })
  function commit({ state: next, expectedRevision = state.revision, expectedGeneration = generation }) {
    const actual = workspaceStore.readValidatedState()
    if (expectedGeneration !== generation || actual.state.revision !== expectedRevision || !['missing', 'valid'].includes(actual.status)) {
      message('工作区已变化或不可读取，请重新载入后再操作。'); return { persisted: false, reason: 'stale' }
    }
    try {
      const outcome = workspaceStore.commit(next)
      if (outcome.persisted) { state = outcome.state; render() }
      else message('未保存到浏览器。当前临时结果保留，可选择题录导出；完整备份只包含已保存状态。')
      return outcome
    } catch (error) { message(`未保存：${error.message}。当前临时结果仍可选择导出。`); return { persisted: false, reason: 'invalid' } }
  }
  const review = createDiscoveryReviewController({ root, getContext, onCommit: commit })
  const provider = async options => {
    const owner = generation
    let page
    if (searchWorks) {
      const response = await searchWorks(Object.fromEntries(['query', 'sort', 'startYear', 'endYear', 'language', 'cursor', 'perPage'].map(key => [key, options[key]])))
      const works = response.works.map(legacy)
      page = { works, total: response.total, nextCursor: response.nextCursor ?? null,
        records: works.map(work => normalizeDiscoveryRecord({ record_id: id(), provider_id: work.paperId,
          bibliography: { title: work.title, authors: work.authors, year: work.year, doi: work.doi, url: work.landingPageUrl,
            abstract: work.abstract, language: null, work_type: null, journal: { title: work.source || null, source_id: null, issns: [], source_type: null }, citations: null },
          provenance: { provider: 'openalex', method: 'api', batch_id: options.batch_id, query_id: options.query_id, import_id: null,
            retrieved_at: instant(), public_url: work.landingPageUrl, verification: 'declared' }, retraction: { state: 'unknown', source_url: null, checked_at: null } })) }
    } else page = await (searchPage ?? searchOpenAlexDiscoveryPage)({ ...options, fetchImpl })
    if (owner === generation) for (const record of page.records) {
      const work = page.works.find(item => item.paperId === record.provider_id)
      if (work) cache.set(record.record_id, legacy(work))
    }
    return page
  }
  const batch = batchController ?? createDiscoveryBatchController({ searchPage: provider, allowDeclaredPages: typeof searchWorks === 'function' })
  function readScope() {
    const year = selector => {
      const input = node(selector), value = input?.value?.trim() ?? ''
      if (input?.validity?.badInput || (value && !/^[1-9]\d{3}$/.test(value))) throw new Error('请输入有效的四位年份，或留空表示不限。')
      return value ? Number(value) : null
    }
    const scope = { startYear: year('#keyword-start-year'), endYear: year('#keyword-end-year'), language: node('#keyword-language')?.value || 'all' }
    if (scope.startYear !== null && scope.endYear !== null && scope.startYear > scope.endYear) throw new Error('起始年份不能晚于结束年份。')
    if (!['all', 'en', 'zh'].includes(scope.language)) throw new Error('请选择有效语言范围。')
    return scope
  }
  const rawQuery = () => node('#english-query')?.value?.trim() ? node('#english-query').value : node('#keyword-query')?.value ?? ''
  function declaredConditions() {
    if (!conditionRows.length) return copy(conditions)
    conditions = conditionRows.filter(row => row.label.value.trim() && row.terms.value.trim()).map(row => {
      const value = { label: row.label.value.trim(), terms: row.terms.value.split(/[;；\n]/u).map(term => term.trim()).filter(Boolean), role: row.role.value }
      const semantic = JSON.stringify([value.role, [...new Set(value.terms.map(term => term.normalize('NFKC').toLowerCase().trim()))].sort()])
      if (row.semantic !== semantic) { row.id = id(); row.semantic = semantic }
      return { id: row.id, ...value }
    })
    return copy(conditions)
  }
  function plan() {
    const raw = rawQuery(), declared = declaredConditions()
    if (!raw.trim() && !declared.length) throw new Error('请输入研究关键词或论文题名。')
    return buildDiscoveryQueryPlan({ raw, conditions: declared, expand: node('#discovery-expand')?.checked === true })
  }
  function setBusy(value) {
    busy = value
    for (const selector of ['#keyword-live-search', '#keyword-load-more']) if (node(selector)) node(selector).disabled = value
    node('#keyword-search-results')?.setAttribute('aria-busy', String(value))
  }
  function render() {
    const active = currentBatch(), results = currentResults()
    const sourceById = new Map(state.records.map(record => [record.record_id, record]))
    const currentSourceIds = new Set(results.flatMap(result => result.record_ids)), records = state.records.filter(record => currentSourceIds.has(record.record_id))
    const evaluations = results.map(result => evaluateDiscoveryRecommendation({ result, records: result.record_ids.map(recordId => sourceById.get(recordId)), conditions: active?.plan.conditions ?? [],
      condition_reviews: state.condition_reviews, scope_reviews: state.scope_reviews, representative_reviews: state.representative_reviews,
      journal_reviews: active?.rule_snapshot.data_year === null ? [] : state.journal_reviews, rules: active?.rule_snapshot ?? state.rules, scope: active?.scope ?? { startYear: null, endYear: null, language: 'all' } }))
    const localMatches = new Map()
    for (const result of results) if (localIndex) {
      const record = state.records.find(item => item.record_id === result.preferred_record_id), bib = record.bibliography
      localMatches.set(result.result_id, matchLocalPaper({ title: bib.title, authors: bib.authors, year: bib.year, doi: bib.doi, paperId: record.provider_id }, localIndex))
    }
    const recommendation = records.length <= 1000 && results.length <= 1000
      ? selectDiscoveryRecommendations({ evaluations, results, records, sort: sortValue(node('#keyword-sort')?.value), page: recommendationPage }) : { visible_ids: [], has_more: false }
    renderDiscoveryResults({ root, results, records: state.records, evaluations, view, localMatches, visibleIds: recommendation.visible_ids,
      unavailableReason: records.length > 1000 || results.length > 1000 ? '临时结果超出工作区保存上限，重点推荐暂不可用；可返回全部查看或导出，清理后重试。' : '',
      page: recommendationPage, hasMore: recommendation.has_more, onPage: page => { recommendationPage = page; render(); node('#keyword-search-results')?.focus?.() },
      candidates: state.external_candidates, selected: exportSelection, onSelect: select, onReview: review.open,
      onView: changeView, onExportSelect: setExportSelected, onConvert: convert })
    message(`${results.length} 篇唯一已加载结果`, '[data-live-result-count]')
    for (const tab of root.querySelectorAll?.('[data-discovery-view]') ?? []) {
      const selected = tab.dataset.discoveryView === view; tab.setAttribute('aria-selected', String(selected)); tab.setAttribute('tabindex', selected ? '0' : '-1')
    }
    const source = node('#discovery-source-status')
    if (source) {
      const counts = new Map()
      for (const record of state.records.filter(record => active?.record_ids.includes(record.record_id))) counts.set(record.provenance.provider, (counts.get(record.provenance.provider) ?? 0) + 1)
      const rows = [make('p', [...counts].map(([provider, count]) => `${provider} 已加载来源记录 ${count}`).join('；') || '尚无已加载来源记录')]
      for (const query of active?.queries ?? []) {
        const row = make('p', `${query.query.expression} · 来源匹配 ${query.total ?? '未知'} · 已加载 ${query.loaded} · ${query.status}${query.error ? `：${query.error}` : ''}`)
        if (sessionBatch && ['ready', 'failed'].includes(query.status)) row.append(button(query.status === 'failed' ? '重试此组合' : '加载此组合下一页', () => more(query.query.query_id, query.status === 'failed')))
        rows.push(row)
      }
      for (const query of active?.plan.suggested ?? []) rows.push(button(`按需检索：${query.expression}`, () => search(false, query), { suggestedQuery: query.query_id }))
      source.replaceChildren(...rows)
    }
    if (node('#keyword-load-more')) node('#keyword-load-more').hidden = !sessionBatch || !active?.queries.some(query => ['ready', 'failed'].includes(query.status))
    renderHistory()
    const candidateArea = node('#discovery-external-candidates')
    candidateArea?.replaceChildren(...state.external_candidates.map(candidate => {
      const result = state.results.find(result => result.result_id === candidate.result_id || result.alias_ids.includes(candidate.result_id))
      const source = state.records.find(record => record.record_id === result?.preferred_record_id)
      const row = make('article', source?.bibliography.title ?? '来源暂不可用')
      row.append(make('p', candidate.openalex_id ? '已衔接归档候选' : '独立外部候选 · 尚未转入归档队列'))
      const show = () => { generation++; batch.cancel(); sessionBatch = false; cache.clear(); review.close(); activeBatchId = source.provenance.batch_id; render() }
      row.append(button('查看来源与核验', show))
      if (!candidate.openalex_id && source?.bibliography.doi) row.append(button('核验并转入归档候选', () => { show(); return convert(result.result_id) }))
      return row
    }))
  }
  function changeView(value) { view = value === 'curated' ? 'curated' : 'all'; recommendationPage = 1; render() }
  function invalidate() {
    generation++; batch.cancel(); sessionBatch = false; activeBatchId = null; recommendationPage = 1; preview = null; journalPreview = null; cache.clear(); exportSelection.clear(); review.close(); setBusy(false)
    node('#keyword-live-results-list')?.replaceChildren(); if (node('#keyword-load-more')) node('#keyword-load-more').hidden = true
    message('尚未检索', '[data-live-result-count]'); message('', '#actual-search-query')
  }
  function mergeBatch(snapshot) {
    const merged = mergeDiscoveryRecords({ records: state.records, results: state.results, incoming: snapshot.records, idFactory: id })
    const next = { ...copy(state), records: merged.records, results: merged.results }
    next.batches = next.batches.filter(item => item.batch_id !== snapshot.batch.batch_id); next.batches.push(copy(snapshot.batch))
    canonicalizeCandidates(next)
    return next
  }
  function canonicalizeCandidates(next) {
    const canonical = new Map(next.results.flatMap(result => [result.result_id, ...result.alias_ids].map(alias => [alias, result.result_id])))
    const candidates = new Map()
    for (const candidate of next.external_candidates) {
      const resultId = canonical.get(candidate.result_id), previous = candidates.get(resultId)
      if (!previous) candidates.set(resultId, { ...candidate, result_id: resultId })
      else if (previous.openalex_id && candidate.openalex_id && previous.openalex_id !== candidate.openalex_id) throw new Error('候选 OpenAlex 交叉引用存在冲突；旧候选和输入已保留，请先核对身份')
      else if (!previous.openalex_id && candidate.openalex_id) previous.openalex_id = candidate.openalex_id
    }
    next.external_candidates = [...candidates.values()]
  }
  function acceptLoaded(owner) {
    if (owner !== generation) return
    const snapshot = batch.read(); if (!snapshot.batch) return
    const accepted = new Set(snapshot.records.map(record => record.record_id))
    for (const key of cache.keys()) if (!accepted.has(key)) cache.delete(key)
    const next = mergeBatch(snapshot); activeBatchId = snapshot.batch.batch_id; state = next
    commit({ state: next, expectedGeneration: owner, expectedRevision: next.revision }); render()
    const failed = snapshot.batch.queries.filter(query => query.status === 'failed')
    message(failed.length ? `${failed.map(query => query.error).join('；')}；已有结果已保留，可重试加载下一页。`
      : currentResults().length ? `去重后已加载 ${currentResults().length} 篇；仅代表本轮已加载范围。` : '未找到匹配论文，可减少关键词或先搜索本地论文。', '#keyword-search-status')
  }
  async function search(append = false, suggested = null) {
    if (busy) return
    if (append) { const next = currentBatch()?.queries.find(query => ['ready', 'failed'].includes(query.status)); if (next) return more(next.query.query_id, next.status === 'failed'); return }
    let planned, scope
    try { planned = plan(); scope = readScope(); if (suggested) planned = { ...copy(currentBatch().plan), selected: [copy(suggested)], suggested: currentBatch().plan.suggested.filter(item => item.query_id !== suggested.query_id) } }
    catch (error) { message(error.message, '#keyword-search-status'); return }
    invalidate(); const owner = generation; sessionBatch = true; setBusy(true)
    message(`实际检索词：${planned.selected.map(query => query.expression).join('；')}；年份 ${scope.startYear ?? '不限'} — ${scope.endYear ?? '不限'}；语言 ${{ all: '不限', en: '英文', zh: '中文' }[scope.language]}。`, '#actual-search-query')
    message('正在检索 OpenAlex…', '#keyword-search-status')
    try {
      await batch.start({ plan: planned, scope, rules: resolvedRules(state.rules), sort: sortValue(node('#keyword-sort')?.value) })
      if (owner !== generation) return
      // Local recall is literal for raw expressions; an explicit condition list supplies individual synonym groups.
      if (localIndex) {
        const snapshot = batch.read(), hits = searchLocalDiscovery({ papers: localIndex, conditions: planned.conditions, raw: rawQuery(), scope })
        const incoming = hits.map(hit => localRecord(hit.paper.paper_id, snapshot.batch.batch_id))
        if (incoming.length) batch.acceptImported({ generation: snapshot.generation, records: incoming })
      }
      acceptLoaded(owner); node('#keyword-search-results')?.focus?.()
    } catch (error) { if (owner === generation) message(error.message, '#keyword-search-status') }
    finally { if (owner === generation) setBusy(false) }
  }
  function localRecord(paperId, batchId) {
    const paper = localIndex.find(item => item.paper_id === paperId)
    return normalizeDiscoveryRecord({ record_id: id(), provider_id: paperId,
      bibliography: { title: paper.title_original || paper.title_en || paper.title_zh, authors: Array.isArray(paper.authors) ? paper.authors : [],
        year: paper.publication_year ?? paper.year ?? null, doi: normalizeDoi(paper.doi_or_url), url: safeHttpsUrl(paper.doi_or_url), abstract: null,
        language: paper.language ?? null, work_type: null, journal: { title: null, source_id: null, issns: [], source_type: null }, citations: null },
      provenance: { provider: 'local', method: 'local', batch_id: batchId, query_id: null, import_id: null, retrieved_at: instant(), public_url: null, verification: 'declared' },
      retraction: { state: 'unknown', source_url: null, checked_at: null } })
  }
  async function more(queryId, retry) {
    if (busy || !sessionBatch) return
    const owner = generation; setBusy(true)
    await (retry ? batch.retry(queryId) : batch.loadMore(queryId)); acceptLoaded(owner)
    if (owner === generation) setBusy(false)
  }
  function emptyImportBatch() {
    return { batch_id: id(), created_at: instant(), scope: readScope(), plan: { conditions: declaredConditions(), selected: [], suggested: [], warnings: [] },
      rule_snapshot: resolvedRules(state.rules), queries: [], record_ids: [], excluded_record_ids: [] }
  }
  async function previewImport(input) {
    const owner = generation, revision = state.revision
    try {
      const active = copy(currentBatch() ?? emptyImportBatch())
      const parsed = parseBibliography({ ...input, batch_id: active.batch_id, import_id: id(), now: instant(), idFactory: id })
      const merged = mergeDiscoveryRecords({ records: state.records, results: state.results, incoming: parsed.records, idFactory: id })
      active.record_ids = [...new Set([...active.record_ids, ...parsed.records.map(record => record.record_id)])]
      active.excluded_record_ids = [...new Set([...active.excluded_record_ids, ...parsed.records.filter(record => classifyDiscoveryScope(record, active.scope).status === 'excluded').map(record => record.record_id)])]
      const next = { ...copy(state), records: merged.records, results: merged.results, batches: [...state.batches.filter(item => item.batch_id !== active.batch_id), active] }
      canonicalizeCandidates(next)
      if (!isValidDiscoveryWorkspaceState(next)) throw new Error('题录超出工作区容量或字段无效')
      preview = { state: next, expectedGeneration: owner, expectedRevision: revision, records: parsed.records, batch: active }
      const panel = node('#discovery-import-preview')
      panel?.replaceChildren(make('p', `${input.provider} · ${parsed.records.length} 条题录；范围 ${active.scope.startYear ?? '不限'}–${active.scope.endYear ?? '不限'} / ${active.scope.language}；排除 ${active.excluded_record_ids.length} 条。只支持 BibTeX / RIS，未知知网格式不兼容。`),
        ...parsed.records.map(record => make('p', `${record.bibliography.title} · ${classifyDiscoveryScope(record, active.scope).reasons.join('；')}`)),
        ...parsed.warnings.map(warning => make('p', warning)), button('确认导入', confirmImport), button('取消', cancelImport))
      return preview
    } catch (error) { preview = null; message(error.message, '#discovery-import-preview'); return null }
  }
  function confirmImport() {
    if (!preview) return { persisted: false, reason: 'missing_preview' }
    const ticket = preview, outcome = commit(ticket)
    if (outcome.persisted) {
      activeBatchId = ticket.batch.batch_id
      const snapshot = batch.read()
      if (sessionBatch && snapshot.batch?.batch_id === activeBatchId) batch.acceptImported({ generation: snapshot.generation, records: ticket.records })
      preview = null; message('题录已导入；范围和人工核验仍需确认。', '#discovery-import-preview'); render()
    } else node('#discovery-import-preview')?.append(make('p', outcome.reason === 'stale' ? '工作区已变化，请重新预览；之前结果已保留。' : '导入未保存；预览与之前结果已保留，可重试确认。'))
    return outcome
  }
  function cancelImport() { preview = null; message('已取消导入，之前结果未更改。', '#discovery-import-preview') }
  function select(resultId) {
    const result = currentResults().find(item => item.result_id === resultId); if (!result) return { persisted: false }
    if (state.external_candidates.some(item => [resultId, ...result.alias_ids].includes(item.result_id))) return { persisted: true }
    const next = copy(state); next.external_candidates.push({ result_id: resultId, selected_at: instant(), openalex_id: null })
    const outcome = commit({ state: next }); if (outcome.persisted) message('已保存到外部候选；需要归档时再核验 OpenAlex。'); return outcome
  }
  async function convert(resultId) {
    if (conversionBusy.has(resultId)) return
    const result = currentResults().find(item => item.result_id === resultId)
    const source = state.records.find(record => record.record_id === result?.preferred_record_id)
    const candidate = state.external_candidates.find(item => item.result_id === resultId || result?.alias_ids.includes(item.result_id))
    if (!source?.bibliography.doi || result.identity_status !== 'clear' || !candidate || candidate.openalex_id) return
    const ticket = { generation, revision: state.revision, result: JSON.stringify(result), source: JSON.stringify(source) }
    conversionBusy.add(resultId)
    try {
      const verified = await prepareExternalCandidateConversion({ result, records: state.records, fetchImpl })
      if (verified.status !== 'verified') { message(`不能转入归档候选：${verified.reason}。请先核对来源身份。`); return }
      if (!await confirmArchive(`核验 DOI：${source.bibliography.doi}\n来源题名：${source.bibliography.title}\nOpenAlex：${verified.work.title}\n转入归档候选？仅归档书目信息，不含 PDF/OCR/证据核验。`)) return
      const actual = workspaceStore.readValidatedState(), liveResult = currentResults().find(item => item.result_id === resultId)
      const liveSource = state.records.find(record => record.record_id === source.record_id)
      if (generation !== ticket.generation || actual.state.revision !== ticket.revision || state.revision !== ticket.revision
        || !['valid', 'missing'].includes(actual.status) || JSON.stringify(liveResult) !== ticket.result || JSON.stringify(liveSource) !== ticket.source
        || liveResult?.identity_status !== 'clear') { message('核验期间结果或工作区已变化，未转入归档候选。'); return }
      const loaded = candidateStore.reload?.(); if (loaded && loaded.status !== 'ready') { message('旧候选队列不可读取，未转换。'); return }
      const existing = candidateStore.read().candidates.filter(item => item.paperId === verified.work.paperId || item.doi === verified.work.doi)
      if (existing.some(item => item.paperId !== verified.work.paperId || item.doi !== verified.work.doi)) { message('归档候选身份存在冲突，请先核对。'); return }
      const outcome = existing.length ? { persisted: true } : candidateStore.add(verified.work)
      onQueueChange()
      if (!outcome.persisted) { message('归档候选只在临时内存中，尚未保存。外部记录保留。'); return }
      const next = copy(state); next.external_candidates.find(item => item.result_id === candidate.result_id).openalex_id = `https://openalex.org/${verified.work.paperId}`
      const crossref = commit({ state: next, expectedRevision: ticket.revision, expectedGeneration: ticket.generation })
      message(crossref.persisted ? '已转入归档候选。请继续在原队列确认和归档。' : '归档候选已保存；交叉引用待同步。外部记录保留。')
    } catch (error) { message(`DOI 核验或转换未完成：${error.message}`) }
    finally { conversionBusy.delete(resultId) }
  }
  function setExportSelected(resultId, checked) { if (checked) exportSelection.add(resultId); else exportSelection.delete(resultId) }
  function exportSelected(format) { return exportBibliography(currentResults().filter(result => exportSelection.has(result.result_id)).map(result => state.records.find(record => record.record_id === result.preferred_record_id)), { format }) }
  function reload() { invalidate(); state = workspaceStore.reload().state; activeBatchId = state.batches.at(-1)?.batch_id ?? null; render(); message('已重新载入已保存批次；未自动重试任何查询。') }
  function renderHistory() {
    const container = node('#discovery-history'); if (!container) return
    container.replaceChildren(...state.batches.map(item => {
      const row = make('p', `${item.created_at.slice(0, 10)} · ${item.plan.selected.map(query => query.expression).join('；') || '手动导入'} · ${item.record_ids.length} 条来源记录`)
      row.append(button('查看此批次', () => { generation++; batch.cancel(); sessionBatch = false; cache.clear(); review.close(); activeBatchId = item.batch_id; render() }),
        button('预览清理此批次', () => {
          try {
            const cleanup = previewDiscoveryBatchCleanup(state, item.batch_id), expectedRevision = state.revision, expectedGeneration = generation
            const confirm = button('确认清理此批次', () => {
              const outcome = commit({ state: cleanup.state, expectedRevision, expectedGeneration })
              if (outcome.persisted) { batch.cancel(); sessionBatch = false; generation++; activeBatchId = state.batches.at(-1)?.batch_id ?? null; render() }
            }, { cleanupBatch: cleanup.batch_id })
            row.append(make('p', `所选批次：移除 ${cleanup.removed_records} 条；保留 ${cleanup.retained_records} 条；保留批次 ${cleanup.retained_batches} 个（候选或核验证据仍有引用）。`), confirm)
          } catch (error) { message(error.message) }
        }))
      return row
    }))
  }
  function renderConditionEditor() {
    const area = node('#discovery-query-plan'); if (!area) return
    const rows = make('div'); conditionRows = []
    const addRow = condition => {
      const row = make('div'); row.className = 'discovery-condition-row'
      const label = make('input'), terms = make('input'), role = make('select')
      label.value = condition?.label ?? ''; terms.value = condition?.terms.join('; ') ?? ''
      for (const [value, name] of [['problem', '研究问题'], ['network', '网络'], ['method', '方法'], ['other', '其他']]) { const option = make('option', name); option.value = value; role.append(option) }
      role.value = condition?.role ?? 'other'
      for (const [name, input] of [['条件名称', label], ['术语与同义词（分号分隔）', terms], ['条件类别', role]]) { const wrapper = make('label', name); wrapper.append(input); row.append(wrapper) }
      const item = { id: condition?.id ?? id(), label, terms, role, semantic: condition ? JSON.stringify([condition.role, [...new Set(condition.terms.map(term => term.normalize('NFKC').toLowerCase().trim()))].sort()]) : null }
      conditionRows.push(item); rows.append(row)
      row.append(button('移除此条件', () => { conditionRows = conditionRows.filter(value => value !== item); conditions = conditions.filter(value => value.id !== item.id); row.hidden = true; invalidate() }))
    }
    conditions.forEach(addRow)
    const label = make('label', '明确扩展条件组合（每批最多六条查询）'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.id = 'discovery-expand'; label.append(checkbox)
    area.replaceChildren(make('p', '条件用于人工核验。手写检索式默认原样执行；原始式在本地仅作字面召回，不解析布尔含义。'), rows,
      button('添加条件', () => addRow()), label,
      button('预览检索组合', () => { try { const planned = plan(); message([...planned.selected.map(query => `本批执行：${query.expression}`), ...planned.suggested.map(query => `待执行：${query.expression}`), ...planned.warnings].join('\n'), '#discovery-plan-preview') } catch (error) { message(error.message, '#discovery-plan-preview') } }))
    const output = make('p'); output.id = 'discovery-plan-preview'; area.append(output)
  }
  function start() {
    renderConditionEditor(); render()
    const tabs = [...(root.querySelectorAll?.('[data-discovery-view]') ?? [])]
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => changeView(tab.dataset.discoveryView))
      tab.addEventListener('keydown', event => {
        const target = ({ ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 })[event.key]
        if (target === undefined) return; event.preventDefault(); changeView(tabs[target].dataset.discoveryView); tabs[target].focus?.()
      })
    })
    node('#keyword-live-search')?.addEventListener('click', () => search())
    node('#keyword-search-form')?.addEventListener('submit', event => { event.preventDefault(); return search() })
    node('#keyword-load-more')?.addEventListener('click', () => search(true))
    node('#generate-english-query')?.addEventListener('click', () => {
      invalidate()
      try { const expression = conditions.length ? buildDiscoveryQueryPlan({ conditions: declaredConditions() }).selected[0].expression : translateDiscoveryKeywords(node('#keyword-query')?.value)
        if (node('#english-query')) node('#english-query').value = expression; message('已生成英文检索式；确认后搜索 OpenAlex。', '#keyword-search-status'); node('#english-query')?.focus?.() }
      catch (error) { message(error.message, '#keyword-search-status') }
    })
    for (const selector of ['#keyword-query', '#english-query', '#keyword-start-year', '#keyword-end-year', '#keyword-language', '#keyword-sort']) {
      const change = () => { if (selector === '#keyword-query' || (selector === '#english-query' && directionMeaning)) { conditions = []; directionMeaning = false; renderConditionEditor(); if (selector === '#keyword-query' && node('#english-query')) node('#english-query').value = '' }
        invalidate(); message('范围或关键词已更新，请重新搜索。', '#keyword-search-status') }
      node(selector)?.addEventListener('input', change); node(selector)?.addEventListener('change', change)
    }
    node('#discovery-reload')?.addEventListener('click', reload)
    node('#discovery-import-file')?.addEventListener('change', async event => {
      const file = event.currentTarget.files?.[0], ticket = generation; if (!file) return
      if (file.size > 2 * 1024 * 1024) { message('外部文件最多 2 MiB。', '#discovery-import-preview'); return }
      try { const text = await file.text(); if (ticket !== generation) { message('选择文件期间查询已变化，请重新选择文件。', '#discovery-import-preview'); return }
        await previewImport({ text, format: node('#discovery-import-format')?.value ?? 'bibtex', provider: node('#discovery-import-provider')?.value ?? 'manual' }) }
      catch (error) { message(error.message, '#discovery-import-preview') }
    })
    node('#discovery-manual-preview')?.addEventListener('click', () => {
      const value = name => node(`#discovery-manual-${name}`)?.value?.trim() ?? ''
      const clean = value => value.replace(/[\r\n]/g, ' ')
      return previewImport({ text: `TY  - JOUR\nTI  - ${clean(value('title'))}\nDO  - ${clean(value('doi'))}\nPY  - ${clean(value('year'))}\nAU  - ${clean(value('author'))}\nER  -\n`, format: 'ris', provider: 'manual' })
    })
    for (const provider of ['scholar', 'cnki']) node(`#discovery-open-${provider}`)?.addEventListener('click', event => {
      try { const links = buildExternalSearchLinks({ query: rawQuery(), scope: readScope() }); event.currentTarget.href = links[provider]; message(`${provider} 待导入；${links.scope_notice}`, '#discovery-external-status') }
      catch (error) { event.preventDefault(); message(error.message, '#discovery-external-status') }
    })
    node('#discovery-export')?.addEventListener('click', () => {
      try { const format = node('#discovery-export-format')?.value ?? 'bibtex', text = exportSelected(format); message(text || '请先选择要导出的论文。', '#discovery-export-preview')
        if (text && root.defaultView?.URL?.createObjectURL) { const url = root.defaultView.URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const link = make('a', '下载所选题录'); link.href = url; link.download = `selected.${format === 'bibtex' ? 'bib' : 'ris'}`; node('#discovery-export-preview')?.append(link) }
      } catch (error) { message(error.message, '#discovery-export-preview') }
    })
    bindJournalControls()
  }
  function bindJournalControls() {
    node('#discovery-journal-preview-button')?.addEventListener('click', async () => {
      const file = node('#discovery-journal-file')?.files?.[0], ticket = generation, revision = state.revision
      if (!file) { message('请选择 CSV 文件。', '#discovery-journal-preview'); return }
      if (file.size > 2 * 1024 * 1024) { message('CSV 最多 2 MiB。', '#discovery-journal-preview'); return }
      try {
        const text = await file.text(), mapping = {}
        for (const name of ['title', 'issns', 'metric', 'data_year', 'release_year', 'category', 'quartile', 'source_url', 'import_description']) {
          const value = node(`#discovery-jcr-${name}`)?.value?.trim(); if (value) mapping[name] = value
        }
        if (generation !== ticket) throw new Error('查询已变化，请重新预览')
        const parsed = parseJournalCsv({ text, mapping, now: instant(), idFactory: id })
        journalPreview = { ...parsed, generation: ticket, revision }
        const area = node('#discovery-journal-preview'), identity = make('input'); identity.type = 'checkbox'; identity.dataset.journalIdentity = 'confirmed'
        const label = make('label', '我已逐项核对期刊名称和 ISSN 身份'); label.append(identity)
        area?.replaceChildren(...parsed.rows.map(row => make('p', `${row.title} · ${row.issns.join('/')} · ${row.data_year} · ${row.category} · ${row.quartile} · ${row.source_url ?? row.import_description}`)),
          ...parsed.warnings.map(warning => make('p', warning)), label, button('确认保存 JCR 核验', () => {
            if (!journalPreview || generation !== ticket || state.revision !== revision) { message('工作区已变化，请重新预览。', '#discovery-journal-preview'); return }
            if (!identity.checked) { message('请先确认期刊身份。'); return }
            const next = copy(state); next.journal_reviews.push(...parsed.rows.map(row => ({ ...row, identity_confirmed: true })))
            const outcome = commit({ state: next, expectedRevision: revision, expectedGeneration: ticket })
            if (outcome.persisted) { journalPreview = null; message('JCR 核验已保存。请选择年度和学科并确认应用规则。', '#discovery-journal-preview') }
          }), button('取消', () => { journalPreview = null; message('已取消 JCR 导入。', '#discovery-journal-preview') }))
      } catch (error) { message(error.message, '#discovery-journal-preview') }
    })
    node('#discovery-apply-rules')?.addEventListener('click', () => {
      const rawYear = node('#discovery-rule-year')?.value?.trim() ?? '', category = node('#discovery-rule-category')?.value?.trim() || 'Automation & Control Systems'
      if (rawYear && !/^[1-9]\d{3}$/.test(rawYear)) { message('规则年度应为四位年份。'); return }
      const next = copy(state); next.rules = { version: 1, data_year: rawYear ? Number(rawYear) : null, category, low_match_limit: 5 }
      if (currentBatch()) next.batches.find(item => item.batch_id === activeBatchId).rule_snapshot = resolvedRules(next.rules)
      const outcome = commit({ state: next }); if (outcome.persisted) message('规则快照已按本次确认更新并重算；以后不会自动修改年度或学科。')
    })
  }
  return { start, search, invalidate, reload, previewImport, confirmImport, cancelImport, select, convert, setExportSelected, exportSelected,
    updateLocal(index) { localIndex = Array.isArray(index) ? index : null; if (activeBatchId) render() },
    getWorks() { const accepted = new Set(sessionBatch ? batch.read().records.map(record => record.record_id) : []); return [...new Map([...cache].filter(([key]) => accepted.has(key)).map(([, work]) => [work.paperId, work])).values()].map(copy) },
    getSnapshot() { return copy({ ...getContext(), results: currentResults(), view, busy }) },
  }
}
