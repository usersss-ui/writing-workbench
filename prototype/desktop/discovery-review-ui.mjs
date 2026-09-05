import { isValidDiscoveryWorkspaceState } from './discovery-workspace.mjs'
import { splitDiscoveryResult } from './discovery-identity.mjs'

/** Shared review panel: no storage access; commits are validated, generation-bound proposals. */
export function createDiscoveryReviewController({ root, getContext, onCommit }) {
  const panel = root.querySelector('#discovery-review-panel')
  let opened = null
  const make = (tag, value) => { const node = root.createElement(tag); if (value !== undefined) node.textContent = value; return node }
  const close = () => { opened = null; if (panel) panel.hidden = true }
  function open(resultId) {
    if (!panel) return
    const context = getContext(), state = structuredClone(context.state)
    const result = state.results.find(item => item.result_id === resultId)
    if (!result) return
    opened = { resultId, generation: context.generation, revision: state.revision, source: JSON.stringify(result) }
    const ticket = opened, fields = new Map(), content = [], sourceChoices = [], corrections = []
    const title = state.records.find(item => item.record_id === result.preferred_record_id)?.bibliography.title
    content.push(make('h3', `核验依据：${title}`), make('p', '请核对来源、定位与理由。自动关键词匹配只能作为提示，不能替代人工确认。'))
    function field(key, label, options = null, value = '') {
      const wrapper = make('label', label), input = make(options ? 'select' : 'input')
      input.dataset.reviewField = key
      if (options) for (const [value, label] of options) { const option = make('option', label); option.value = value; input.append(option) }
      input.value = value; wrapper.append(input); content.push(wrapper); fields.set(key, input); return input
    }
    field('language', '语言', [['', '保留原记录'], ['en', '英文'], ['zh', '中文']])
    field('work_type', '文献类型', [['', '保留原记录'], ['article', '期刊论文'], ['review', '综述'], ['preprint', '预印本'], ['other', '其他']])
    field('retraction', '撤稿核验', [['', '保留原记录'], ['screened_clear', '已核查，无撤稿标记'], ['retracted', '确认已撤稿']])
    field('journal_identity', '确认期刊名称（可选）')
    const conditions = context.batch?.plan.conditions ?? []
    for (const condition of conditions) field(`condition:${condition.id}`, condition.label,
      [['', '保留现有核验'], ['hint', '关键词提示'], ['confirmed', '人工确认'], ['false', '不符合'], ['unrecorded', '尚未核验']])
    field('role', '代表性角色', [['', '不新增'], ['origin', '起源'], ['baseline', '基线'], ['survey', '综述'], ['intersection', '交叉条件代表作']])
    content.push(make('p', '勾选实际支持本次判断的来源；未勾选的来源不视为已经核验。'))
    for (const recordId of result.record_ids) {
      const record = state.records.find(item => item.record_id === recordId), checkbox = make('input'); checkbox.type = 'checkbox'
      checkbox.checked = recordId === result.preferred_record_id; checkbox.dataset.reviewSource = recordId
      const label = make('label', `${record.provenance.provider} · ${record.bibliography.title}`); label.append(checkbox); content.push(label)
      sourceChoices.push({ recordId, checkbox })
    }
    for (const collection of ['condition_reviews', 'scope_reviews', 'representative_reviews']) for (const [index, entry] of state[collection].entries()) {
      if (![resultId, ...result.alias_ids].includes(entry.result_id)) continue
      const labelText = collection === 'condition_reviews' ? conditions.find(item => item.id === entry.condition_id)?.label ?? '历史条件'
        : collection === 'scope_reviews' ? ({ language: '语言', work_type: '文献类型', retraction: '撤稿', journal_identity: '期刊身份' })[entry.field] : '代表性角色'
      const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.dataset.replaceReview = `${collection}:${index}`
      const label = make('label', `更正此条核验：${labelText} · ${entry.status ?? entry.value ?? entry.role} · ${entry.evidence?.locator ?? '尚无证据'}。勾选后用本次填写的新判断替换；其他历史判断保留。`)
      label.append(checkbox); content.push(label); corrections.push({ collection, index, entry, checkbox })
    }
    field('locator', '来源定位（公开网址、章节、页码等）')
    field('reason', '判断理由')
    const manual = field('manual', '我已人工核对以上来源与判断'); manual.type = 'checkbox'
    const status = make('p'); status.setAttribute('role', 'status'); content.push(status)
    const save = make('button', '保存核验'); save.type = 'button'; save.dataset.reviewField = 'save'
    save.addEventListener('click', async () => {
      const live = getContext(), liveResult = live.state.results.find(item => item.result_id === resultId)
      if (opened !== ticket || live.generation !== ticket.generation || live.state.revision !== ticket.revision
        || JSON.stringify(liveResult) !== ticket.source) { status.textContent = '结果或工作区已变化，请重新打开核验。'; return }
      const value = key => fields.get(key)?.value?.trim() ?? ''
      const evidenceNeeded = ['language', 'work_type', 'retraction', 'journal_identity', 'role'].some(key => value(key))
        || conditions.some(condition => value(`condition:${condition.id}`) === 'confirmed')
      const ownedSources = sourceChoices.filter(choice => choice.checkbox.checked).map(choice => choice.recordId)
      if (evidenceNeeded && (!manual.checked || !value('locator') || !value('reason') || !ownedSources.length)) { status.textContent = '人工确认必须选择依据来源、填写来源定位和理由，并勾选已核对。'; return }
      const replacing = corrections.filter(item => item.checkbox.checked)
      if (replacing.some(item => !manual.checked || !(item.collection === 'condition_reviews' ? value(`condition:${item.entry.condition_id}`)
        : item.collection === 'scope_reviews' ? value(item.entry.field) : value('role')))) { status.textContent = '更正旧核验时，请填写对应的新判断并确认已人工核对。'; return }
      const evidence = { record_ids: ownedSources, locator: value('locator'), reason: value('reason'), method: 'manual', checked_at: new Date().toISOString() }
      const next = structuredClone(state)
      for (const collection of ['condition_reviews', 'scope_reviews', 'representative_reviews']) next[collection] = next[collection].filter((entry, index) => !replacing.some(item => item.collection === collection && item.index === index))
      // Only explicitly checked entries are replaced; untouched contradictions remain pending.
      for (const condition of conditions) {
        const status = value(`condition:${condition.id}`)
        if (status) next.condition_reviews.push({ result_id: resultId, condition_id: condition.id, status, evidence: status === 'confirmed' ? evidence : null })
      }
      for (const field of ['language', 'work_type', 'retraction', 'journal_identity']) if (value(field)) next.scope_reviews.push({ result_id: resultId, field, value: value(field), evidence })
      if (value('role')) next.representative_reviews.push({ result_id: resultId, role: value('role'), evidence })
      if (!isValidDiscoveryWorkspaceState(next)) { status.textContent = '核验内容或来源引用无效，请检查输入。'; return }
      save.disabled = true; panel.setAttribute('aria-busy', 'true')
      try {
        const outcome = await onCommit({ state: next, expectedRevision: ticket.revision, expectedGeneration: ticket.generation })
        status.textContent = outcome?.persisted ? '核验已保存。' : '核验未保存，请保留输入并重试或重新载入。'
      } catch (error) { status.textContent = error.message || '核验未保存。' }
      finally { save.disabled = false; panel.setAttribute('aria-busy', 'false') }
    })
    const cancel = make('button', '取消'); cancel.type = 'button'; cancel.addEventListener('click', close)
    panel.replaceChildren(...content, save, cancel); panel.hidden = false; panel.setAttribute('tabindex', '-1'); panel.focus?.()
    if (result.record_ids.length > 1) {
      const details = make('details'), summary = make('summary', '来源身份不一致？确认拆分为两篇论文')
      details.append(summary, make('p', '原候选随原首选来源保留。证据只随实际来源迁移；跨两组的条件证据转为待核验。跨组的范围和代表性判断将退出有效核验，需要重新核对。'))
      const groups = []
      for (const recordId of result.record_ids) {
        const record = state.records.find(item => item.record_id === recordId), label = make('label', `${record.provenance.provider} · ${record.bibliography.title}`), select = make('select')
        for (const [value, text] of [['original', '原论文'], ['separate', '另一篇论文']]) { const option = make('option', text); option.value = value; select.append(option) }
        select.value = recordId === result.preferred_record_id ? 'original' : 'separate'; select.dataset.splitSource = recordId
        if (recordId === result.preferred_record_id) select.disabled = true
        label.append(select); details.append(label); groups.push({ recordId, select })
      }
      const revokedPreview = make('div'), revoke = make('input'); revoke.type = 'checkbox'; revoke.dataset.revokeSplitReviews = resultId
      const revokeLabel = make('label', '撤销以上无法归属的核验后继续拆分（只撤销所列判断，不删除原题录或候选；不会保存额外审计历史）'); revokeLabel.append(revoke)
      const partitionsNow = () => ['original', 'separate'].map(value => groups.filter(item => item.select.value === value).map(item => item.recordId))
      function spanningReviews() {
        const partitions = partitionsNow()
        return ['scope_reviews', 'representative_reviews'].flatMap(collection => state[collection].filter(entry => [resultId, ...result.alias_ids].includes(entry.result_id)
          && !partitions.some(partition => entry.evidence.record_ids.every(recordId => partition.includes(recordId)))))
      }
      function refreshRevocationPreview() {
        revoke.checked = false
        const spanning = spanningReviews(); revokeLabel.hidden = spanning.length === 0
        revokedPreview.replaceChildren(...spanning.map(entry => make('p', `需要独立撤销确认：${entry.field ?? '代表性角色'} · ${entry.value ?? entry.role} · ${entry.evidence.locator} · ${entry.evidence.reason}`)))
      }
      for (const { select } of groups) select.addEventListener('change', refreshRevocationPreview)
      details.append(revokedPreview, revokeLabel); refreshRevocationPreview()
      const confirmed = make('input'); confirmed.type = 'checkbox'; confirmed.dataset.confirmSplit = resultId
      const label = make('label', '我已核对来源分组，并确认以上证据处理'); label.append(confirmed); details.append(label)
      const split = make('button', '确认拆分来源'); split.type = 'button'; split.dataset.splitResult = resultId
      split.addEventListener('click', async () => {
        const live = getContext()
        if (opened !== ticket || live.generation !== ticket.generation || live.state.revision !== ticket.revision
          || JSON.stringify(live.state.results.find(item => item.result_id === resultId)) !== ticket.source) { status.textContent = '结果或工作区已变化，请重新打开核验。'; return }
        if (!confirmed.checked) { status.textContent = '请先核对分组并确认拆分。'; return }
        if (spanningReviews().length && !revoke.checked) { status.textContent = '存在无法归属的核验，请先逐条阅读并独立确认撤销后再拆分。'; return }
        try {
          const partitions = partitionsNow()
          const divided = splitDiscoveryResult({ records: state.records, results: state.results, result_id: resultId, groups: partitions, idFactory: () => crypto.randomUUID() })
          const next = { ...structuredClone(state), records: divided.records, results: divided.results }
          const replacements = next.results.filter(item => item.record_ids.some(recordId => result.record_ids.includes(recordId)))
          for (const collection of ['condition_reviews', 'scope_reviews', 'representative_reviews']) next[collection] = state[collection].flatMap(entry => {
            if (![resultId, ...result.alias_ids].includes(entry.result_id) || !entry.evidence) return [structuredClone(entry)]
            const owner = replacements.find(item => entry.evidence.record_ids.every(recordId => item.record_ids.includes(recordId)))
            if (owner) return [{ ...structuredClone(entry), result_id: owner.result_id }]
            if (collection !== 'condition_reviews') return []
            return replacements.flatMap(item => {
              const recordIds = entry.evidence.record_ids.filter(recordId => item.record_ids.includes(recordId))
              return recordIds.length ? [{ ...structuredClone(entry), result_id: item.result_id, status: 'unrecorded', evidence: { ...structuredClone(entry.evidence), record_ids: recordIds } }] : []
            })
          })
          if (!isValidDiscoveryWorkspaceState(next)) throw new Error('拆分后的来源或证据引用无效')
          const outcome = await onCommit({ state: next, expectedRevision: ticket.revision, expectedGeneration: ticket.generation })
          status.textContent = outcome?.persisted ? '来源已拆分；请按各篇实际来源继续核验。' : '拆分未保存，原结果与输入保留。'
        } catch (error) { status.textContent = error.message }
      })
      details.append(split); panel.append(details)
    }
  }
  return { open, close }
}
