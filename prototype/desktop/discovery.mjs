import { createCandidateStore } from "./candidate-storage.mjs"
import { resolveInstitutionAccess } from "./institution-access.mjs"
import {
  archiveConfirmedCandidate,
  isValidLocalPaperId,
  loadLocalLibraryCapabilities,
  loadPaperIndex,
  markCandidateArchivedAfterIndexRefresh,
  requestArchiveRebuild,
} from "./library.mjs"
import { searchOpenAlexWorks } from "./openalex-search.mjs"

const ARCHIVE_DISCLOSURE = "仅归档书目信息，不含 PDF/OCR/证据核验"

const KEYWORDS = Object.freeze([
  ["时变非平衡有向网络", "time-varying unbalanced directed graph"],
  ["时变有向网络", "time-varying directed graph"],
  ["分布式在线约束优化", "distributed online constrained optimization"],
  ["分布式约束优化", "distributed constrained optimization"],
  ["低通信", "communication-efficient"],
  ["事件触发", "event-triggered"],
  ["耦合约束", "coupled constraints"],
  ["隐私", "privacy-preserving"],
  ["零阶", "zeroth-order"],
  ["联邦学习", "federated learning"],
])

function text(value) { return typeof value === "string" ? value.trim() : "" }

export function buildKeywordSearchExpression(value) {
  const source = text(value)
  if (!source) throw new Error("请输入研究方向或关键词")
  if (!/[\u3400-\u9fff]/u.test(source)) return source
  let remainder = source.replace(/[的中在上与和及、，,。；;（）()\s]/gu, "")
  const terms = []
  for (const [chinese, english] of KEYWORDS) {
    if (!remainder.includes(chinese)) continue
    remainder = remainder.replace(chinese, "")
    terms.push(`"${english}"`)
  }
  if (remainder || terms.length === 0) throw new Error("不能可靠转换全部中文关键词；请改用英文检索式")
  return `(${terms.join(" AND ")})`
}

function node(root, selector) { return root?.querySelector?.(selector) ?? null }
function nodes(root, selector) { return [...(root?.querySelectorAll?.(selector) ?? [])] }
function setText(root, selector, value) { const element = node(root, selector); if (element) element.textContent = value }
function setHref(element, value) { if (!element) return; if (typeof value === "string" && value.startsWith("https://")) element.href = value; else element.removeAttribute?.("href") }
function setHidden(element, hidden) { if (element) element.hidden = hidden }
function normalizeSearchSort(value) {
  return ({ relevance: "relevance", citations: "citations", newest: "newest", cited_by_count: "citations", publication_date: "newest" })[value] ?? "relevance"
}

function workCard(root, work, addCandidate) {
  const article = root.createElement("article")
  article.className = "discovery-result-card"
  article.dataset.paperId = work.paperId
  const title = root.createElement("h3")
  title.textContent = work.title
  const meta = root.createElement("p")
  meta.textContent = [work.year ?? "年份未报告", work.source, `被引 ${work.citations}`].join(" · ")
  const actions = root.createElement("div")
  const open = root.createElement("a")
  open.textContent = "打开公开落地页 ↗"
  open.href = work.landingPageUrl
  open.target = "_blank"
  open.rel = "noopener noreferrer"
  const add = root.createElement("button")
  add.type = "button"
  add.dataset.addCandidate = work.paperId
  add.textContent = "加入候选"
  add.addEventListener("click", () => addCandidate(work))
  actions.appendChild(open); actions.appendChild(add)
  article.appendChild(title); article.appendChild(meta); article.appendChild(actions)
  return article
}

function candidateCard(root, candidate, actions) {
  const article = root.createElement("article")
  article.dataset.queuePaper = candidate.paperId
  article.className = "candidate-queue-card"
  const title = root.createElement("h3"); title.textContent = candidate.title
  const stage = root.createElement("p")
  stage.textContent = candidate.stage === "metadata_archived"
    ? "元数据已归档"
    : candidate.stage === "confirmed_for_archive"
      ? "元数据待核验 · 待归档"
      : "待筛选"
  article.appendChild(title); article.appendChild(stage)
  const buttons = root.createElement("div")
  if (candidate.stage === "pending_screening") {
    const confirm = root.createElement("button"); confirm.type = "button"; confirm.textContent = "确认待归档"; confirm.addEventListener("click", () => actions.confirm(candidate.paperId)); buttons.appendChild(confirm)
  } else if (candidate.stage === "confirmed_for_archive") {
    const back = root.createElement("button"); back.type = "button"; back.textContent = "移回待筛选"; back.addEventListener("click", () => actions.moveToPending(candidate.paperId)); buttons.appendChild(back)
  }
  const remove = root.createElement("button"); remove.type = "button"; remove.textContent = "移除"; remove.addEventListener("click", () => actions.remove(candidate.paperId)); buttons.appendChild(remove)
  article.appendChild(buttons)
  if (candidate.stage === "confirmed_for_archive") {
    const archiveSection = root.createElement("section")
    archiveSection.className = "candidate-archive-section"
    const label = root.createElement("label")
    label.textContent = "本地论文 ID"
    const input = root.createElement("input")
    input.type = "text"
    input.autocomplete = "off"
    input.spellcheck = false
    input.dataset.archivePaperId = candidate.paperId
    input.value = actions.localPaperId(candidate.paperId)
    const help = root.createElement("small")
    help.dataset.archivePaperIdHelp = candidate.paperId
    help.textContent = "格式示例：Wang23-DIO；兼容 LIB-ABCDEF123456。不会从 OpenAlex ID 推断。"
    const disclosure = root.createElement("p")
    disclosure.className = "candidate-archive-disclosure"
    disclosure.textContent = ARCHIVE_DISCLOSURE
    const archiveButton = root.createElement("button")
    archiveButton.type = "button"
    archiveButton.dataset.archiveCandidate = candidate.paperId
    archiveButton.textContent = "归档书目信息"
    const status = root.createElement("p")
    status.dataset.archiveStatus = candidate.paperId
    status.setAttribute?.("role", "status")
    status.setAttribute?.("aria-live", "polite")
    const sync = () => {
      actions.setLocalPaperId(candidate.paperId, input.value)
      archiveButton.disabled = !actions.canArchive(input.value)
    }
    input.addEventListener("input", sync)
    archiveButton.addEventListener("click", () => actions.archive(candidate, {
      localPaperId: input.value,
      input,
      button: archiveButton,
      status,
      sync,
    }))
    label.append?.(input)
    archiveSection.append?.(label, help, disclosure, archiveButton, status)
    sync()
    article.appendChild(archiveSection)
  }
  return article
}

export function createKeywordDiscoveryController({
  root,
  prepareAccess = () => {},
  searchWorks = searchOpenAlexWorks,
  candidateStore,
  fetchImpl = globalThis.fetch,
  loadIndex = () => loadPaperIndex(fetchImpl),
  confirmArchive = (message) => globalThis.confirm?.(message) === true,
} = {}) {
  if (!root || !candidateStore) throw new TypeError("关键词发现控制器缺少必要依赖")
  let works = []
  let localCapabilities = null
  let recoveryBanner = null
  const localPaperIds = new Map()

  const canArchive = (paperId) => localCapabilities?.candidate_archive === true
    && localCapabilities?.recovery?.required === false
    && isValidLocalPaperId(paperId)

  const ensureRecoveryBanner = () => {
    if (recoveryBanner) return recoveryBanner
    const panel = node(root, "#candidate-queue-panel")
    if (!panel) return null
    recoveryBanner = root.createElement("section")
    recoveryBanner.className = "archive-recovery-banner"
    recoveryBanner.dataset.archiveRecoveryBanner = ""
    recoveryBanner.setAttribute?.("role", "status")
    recoveryBanner.setAttribute?.("aria-live", "polite")
    recoveryBanner.hidden = true
    panel.appendChild?.(recoveryBanner)
    return recoveryBanner
  }

  const runRecovery = async (button, status) => {
    const recovery = localCapabilities?.recovery
    if (
      recovery?.required !== true
      || recovery.kind !== "candidate_archive"
      || localCapabilities?.archive_rebuild !== true
    ) return
    button.disabled = true
    status.textContent = "正在重建论文库索引…"
    try {
      const result = await requestArchiveRebuild({
        fetchImpl,
        archiveSourceId: recovery.archive_source_id,
        paperId: recovery.paper_id,
        openAlexId: recovery.openalex_id,
      })
      const freshIndex = await loadIndex()
      const marked = markCandidateArchivedAfterIndexRefresh({
        candidateStore,
        paperIndex: freshIndex,
        localPaperId: result.paper_id,
        openAlexId: recovery.openalex_id,
      })
      status.textContent = marked
        ? "恢复完成，元数据归档完成。"
        : "恢复完成；未找到本地候选或严格身份不匹配，未更改本地候选状态。"
      if (marked) renderQueue()
      await refreshCapabilities()
    } catch (error) {
      status.textContent = error?.name === "LocalLibraryApiError"
        ? error.message
        : "论文库恢复未完成，请稍后重试。"
      button.disabled = false
    }
  }

  const renderRecoveryBanner = () => {
    const banner = ensureRecoveryBanner()
    if (!banner) return
    banner.replaceChildren?.()
    const recovery = localCapabilities?.recovery
    if (recovery?.required !== true) {
      banner.hidden = true
      return
    }
    banner.hidden = false
    const message = root.createElement("p")
    const tuple = root.createElement("p")
    tuple.className = "archive-recovery-tuple"
    const status = root.createElement("p")
    status.dataset.archiveRecoveryStatus = ""
    if (recovery.kind === "candidate_archive") {
      message.textContent = "上次元数据归档已写入，但论文库索引重建失败。请显式重建后再核对候选状态。"
      tuple.textContent = `归档来源 ${recovery.archive_source_id} · 本地论文 ID ${recovery.paper_id} · OpenAlex ${recovery.openalex_id}`
      const button = root.createElement("button")
      button.type = "button"
      button.dataset.archiveRecoveryAction = "rebuild"
      button.textContent = "重建论文库索引"
      button.disabled = localCapabilities.archive_rebuild !== true
      button.addEventListener("click", () => runRecovery(button, status))
      banner.append?.(message, tuple, button, status)
      return
    }
    if (recovery.kind === "manual_note") {
      message.textContent = "笔记导入需要人工恢复；写入操作已停用，仍可浏览上一次可用的论文库。"
    } else {
      message.textContent = "候选归档事务状态不明确，需要人工核验；写入操作已停用，仍可浏览上一次可用的论文库。"
    }
    banner.append?.(message, status)
  }

  const refreshCapabilities = async () => {
    try { localCapabilities = await loadLocalLibraryCapabilities(fetchImpl) } catch { localCapabilities = null }
    renderRecoveryBanner()
    renderQueue()
    return localCapabilities
  }

  const archiveCandidate = async (candidate, context) => {
    const current = candidateStore.read().candidates.filter((item) => item.paperId === candidate.paperId)
    if (current.length !== 1 || current[0].stage !== "confirmed_for_archive" || !canArchive(context.localPaperId)) return
    const confirmation = [
      `本地论文 ID：${context.localPaperId}`,
      `归档来源：${localCapabilities.archive_source_id}`,
      ARCHIVE_DISCLOSURE,
    ].join("\n")
    let confirmed = false
    try { confirmed = await Promise.resolve(confirmArchive(confirmation)) } catch { confirmed = false }
    if (!confirmed) return
    context.button.disabled = true
    context.status.textContent = "正在归档书目信息…"
    let completed = false
    try {
      const result = await archiveConfirmedCandidate({
        fetchImpl,
        archiveSourceId: localCapabilities.archive_source_id,
        paperId: context.localPaperId,
        candidate: current[0],
      })
      if (result.rebuild_status === "failed") {
        context.status.textContent = "元数据已写入，但论文库索引重建失败；请使用恢复操作。"
        await refreshCapabilities()
        return
      }
      const freshIndex = await loadIndex()
      const marked = markCandidateArchivedAfterIndexRefresh({
        candidateStore,
        paperIndex: freshIndex,
        localPaperId: result.paper_id,
        openAlexId: candidate.paperId,
      })
      if (!marked) {
        context.status.textContent = "归档响应已完成，但新索引未严格匹配该候选；本地候选状态未更改。"
        return
      }
      completed = true
      context.status.textContent = "元数据归档完成。"
      context.button.disabled = true
    } catch (error) {
      context.status.textContent = error?.name === "LocalLibraryApiError"
        ? error.message
        : "归档操作未完成，请稍后重试。"
      await refreshCapabilities()
    } finally {
      if (!completed) context.sync()
    }
  }

  const renderQueue = () => {
    const state = candidateStore.read()
    const candidates = state.candidates
    const pending = candidates.filter((candidate) => candidate.stage === "pending_screening").length
    const confirmed = candidates.filter((candidate) => candidate.stage === "confirmed_for_archive").length
    setText(root, "[data-candidate-count]", String(candidates.length)); setText(root, "[data-candidate-pending-count]", String(pending)); setText(root, "[data-candidate-confirmed-count]", String(confirmed))
    const list = node(root, "#candidate-queue-list"); const empty = node(root, "[data-candidate-empty]")
    if (!list) return
    if (empty) empty.hidden = candidates.length > 0
    const cards = candidates.map((candidate) => candidateCard(root, candidate, {
      confirm(id) { candidateStore.confirm(id); renderQueue() },
      moveToPending(id) { localPaperIds.delete(id); candidateStore.moveToPending(id); renderQueue() },
      remove(id) { localPaperIds.delete(id); candidateStore.remove(id); renderQueue() },
      localPaperId(id) { return localPaperIds.get(id) ?? "" },
      setLocalPaperId(id, value) { localPaperIds.set(id, typeof value === "string" ? value : "") },
      canArchive,
      archive: archiveCandidate,
    }))
    list.replaceChildren(...(cards.length ? cards : empty ? [empty] : []))
  }
  const activate = (mode) => {
    const keyword = mode === "keyword"
    setHidden(node(root, "#keyword-discovery-panel"), !keyword)
    setHidden(node(root, "#known-paper-panel"), keyword)
    setHidden(node(root, "#candidate-queue-panel"), !keyword)
    setHidden(node(root, "#access-guide-panel"), keyword)
    for (const tab of nodes(root, "[data-discovery-mode]")) { const selected = tab.dataset.discoveryMode === mode; tab.setAttribute("aria-selected", String(selected)); tab.setAttribute("tabindex", selected ? "0" : "-1") }
  }
  const runSearch = async () => {
    const query = text(node(root, "#english-query")?.value)
    if (!query) { setText(root, "#keyword-search-status", "请先生成或填写英文检索式。"); return }
    const button = node(root, "#keyword-live-search"); if (button) button.disabled = true
    try {
      const result = await searchWorks({ query, sort: normalizeSearchSort(node(root, "#keyword-sort")?.value) })
      works = result.works
      const list = node(root, "#keyword-live-results-list")
      list?.replaceChildren(...works.map((work) => workCard(root, work, (item) => { candidateStore.add(item); renderQueue() })))
      setText(root, "[data-live-result-count]", `${works.length} 条真实结果`)
      setText(root, "#keyword-search-status", `OpenAlex 共匹配 ${result.total} 条；当前显示 ${works.length} 条。`)
      node(root, "#keyword-search-results")?.focus?.()
    } catch (error) { setText(root, "#keyword-search-status", error?.message || "OpenAlex 检索失败") } finally { if (button) button.disabled = false }
  }
  return {
    async start() {
      const tabs = nodes(root, "[data-discovery-mode]")
      const selectTab = (tab) => { activate(tab.dataset.discoveryMode); tab.focus?.() }
      for (const [index, tab] of tabs.entries()) {
        tab.addEventListener("click", () => activate(tab.dataset.discoveryMode))
        tab.addEventListener("keydown", (event) => {
          let nextIndex = null
          if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length
          else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length
          else if (event.key === "Home") nextIndex = 0
          else if (event.key === "End") nextIndex = tabs.length - 1
          if (nextIndex === null) return
          event.preventDefault()
          selectTab(tabs[nextIndex])
        })
      }
      node(root, "#keyword-search-form")?.addEventListener("submit", (event) => { event.preventDefault(); try { const expression = buildKeywordSearchExpression(node(root, "#keyword-query")?.value); const input = node(root, "#english-query"); if (input) input.value = expression; setText(root, "#keyword-search-status", "已生成英文检索式；确认后搜索 OpenAlex。"); node(root, "#keyword-search-results")?.focus?.() } catch (error) { setText(root, "#keyword-search-status", error.message) } })
      node(root, "#keyword-live-search")?.addEventListener("click", runSearch)
      renderQueue(); activate("keyword")
      await refreshCapabilities()
    },
    prepareAccess(locator) { prepareAccess(locator) },
    getWorks() { return [...works] },
  }
}

export async function loadInstitutionProfile(fetchImpl = fetch) {
  const response = await fetchImpl("./assets/nuist.institution.json", { credentials: "same-origin", cache: "no-store" })
  if (!response?.ok) throw new Error("学校访问配置不可用")
  const profile = await response.json()
  if (
    !profile || profile.version !== 1 || profile.institution_id !== "nuist" ||
    typeof profile.display_name !== "string" || profile.access_mode !== "carsi" ||
    !Array.isArray(profile.providers) || profile.providers.length === 0 ||
    profile.providers.some((provider) => !provider || typeof provider.provider_id !== "string" || typeof provider.display_name !== "string")
  ) throw new Error("学校访问配置无效")
  return profile
}

export function createDiscoveryController({
  root,
  loadInstitution = loadInstitutionProfile,
  clipboard = globalThis.navigator?.clipboard,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  loadIndex,
  confirmArchive,
} = {}) {
  const store = createCandidateStore(storage)
  const keyword = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    fetchImpl,
    ...(typeof loadIndex === "function" ? { loadIndex } : {}),
    ...(typeof confirmArchive === "function" ? { confirmArchive } : {}),
    prepareAccess(locator) { const input = node(root, "#access-locator"); if (input) { input.value = locator; input.focus() } },
  })
  let profile = null
  let accessResult = null
  const renderAccess = () => {
    const result = accessResult; if (!result) return
    setHidden(node(root, "#access-result"), false)
    setText(root, "[data-provider-name]", result.provider?.display_name ?? "平台尚未识别")
    const access = result.institutionAccess
    setHref(node(root, "#institution-step-open"), result.openAccess.url ?? access.articleUrl)
    setHref(node(root, "#institution-step-auth"), access.authenticationUrl)
    setHref(node(root, "#institution-step-library"), access.libraryLookupUrl)
    const copy = node(root, "#access-copy-target"); if (copy) copy.value = result.copyTarget.value
    const warnings = node(root, "#access-warnings"); if (warnings) warnings.replaceChildren(...result.warnings.map((warning) => { const item = root.createElement("li"); item.textContent = warning; return item }))
  }
  return {
    async start() {
      await keyword.start()
      try {
        profile = await loadInstitution()
        const select = node(root, "#access-provider")
        for (const provider of profile.providers) { const option = root.createElement("option"); option.value = provider.provider_id; option.textContent = provider.display_name; select?.append(option) }
      } catch { setText(root, "#access-status", "学校访问配置暂不可用；仍可使用公开 DOI 或落地页人工核验。") }
      node(root, "#institution-access-form")?.addEventListener("submit", (event) => { event.preventDefault(); if (!profile) { setText(root, "#access-status", "学校访问配置暂不可用。") ; return } try { accessResult = resolveInstitutionAccess({ rawInput: node(root, "#access-locator")?.value, explicitProviderId: node(root, "#access-provider")?.value, institution: profile }); renderAccess(); setText(root, "#access-status", "已生成不携带凭据的人工访问步骤。") } catch (error) { setText(root, "#access-status", error.message) } })
      node(root, "#access-copy")?.addEventListener("click", async () => { try { if (!accessResult || typeof clipboard?.writeText !== "function") throw new Error("clipboard") ; await clipboard.writeText(accessResult.copyTarget.value); setText(root, "#access-copy-status", "已复制") } catch { setText(root, "#access-copy-status", "复制失败，请手动选择上方 DOI/题名") } })
    },
    prepareLocator(locator) { keyword.prepareAccess(locator) },
  }
}

if (typeof document !== "undefined") createDiscoveryController({ root: document }).start()
