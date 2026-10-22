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
import { createDiscoveryWorkspaceStore } from "./discovery-workspace.mjs"
import { createDiscoverySessionUI } from "./discovery-session-ui.mjs"
import { buildDiscoveryQueryPlan, decodeDirectionAxes, translateDiscoveryKeywords } from "./discovery-query-plan.mjs"

const ARCHIVE_DISCLOSURE = "仅归档书目信息，不含 PDF/OCR/证据核验"
const ARCHIVE_RECONCILIATION_PENDING = "恢复已完成，但新索引或本地候选状态尚未核对。"

function text(value) { return typeof value === "string" ? value.trim() : "" }

export function buildKeywordSearchExpression(value) {
  return translateDiscoveryKeywords(value)
}

function node(root, selector) { return root?.querySelector?.(selector) ?? null }
function nodes(root, selector) { return [...(root?.querySelectorAll?.(selector) ?? [])] }
function setText(root, selector, value) { const element = node(root, selector); if (element) element.textContent = value }
function setHref(element, value) { if (!element) return; if (typeof value === "string" && value.startsWith("https://")) element.href = value; else element.removeAttribute?.("href") }
function setHidden(element, hidden) { if (element) element.hidden = hidden }
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
  const archiveBusy = actions.isArchiveBusy(candidate.paperId)
  if (candidate.stage === "pending_screening") {
    const confirm = root.createElement("button"); confirm.type = "button"; confirm.textContent = "确认待归档"; confirm.addEventListener("click", () => actions.confirm(candidate.paperId)); buttons.appendChild(confirm)
  } else if (candidate.stage === "confirmed_for_archive") {
    const back = root.createElement("button"); back.type = "button"; back.textContent = "移回待筛选"; back.disabled = archiveBusy; back.addEventListener("click", () => actions.moveToPending(candidate.paperId)); buttons.appendChild(back)
  }
  const remove = root.createElement("button"); remove.type = "button"; remove.textContent = "移除"; remove.disabled = archiveBusy; remove.addEventListener("click", () => actions.remove(candidate.paperId)); buttons.appendChild(remove)
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
    input.disabled = archiveBusy
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
    status.textContent = actions.archiveStatus(candidate.paperId)
    const sync = () => {
      actions.setLocalPaperId(candidate.paperId, input.value)
      archiveButton.disabled = actions.isArchiveBusy(candidate.paperId) || !actions.canArchive(input.value)
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
  initialQuery = "",
  initialScope = {},
  initialDirection = null,
  initialDirectionError = "",
  autoSearch = false,
  prepareAccess = () => {},
  searchWorks,
  searchPage,
  batchController,
  workspaceStore,
  candidateStore,
  fetchImpl = globalThis.fetch,
  loadIndex = () => loadPaperIndex(fetchImpl),
  confirmArchive = (message) => globalThis.confirm?.(message) === true,
} = {}) {
  if (!root || !candidateStore) throw new TypeError("关键词发现控制器缺少必要依赖")
  let indexGeneration = 0
  let localIndex = { status: "loading", papers: [] }
  let localCapabilities = null
  let recoveryBanner = null
  let recoveryNotice = ""
  let completedRecoveryKey = null
  const localPaperIds = new Map()
  const archiveStates = new Map()

  const session = createDiscoverySessionUI({ root, workspaceStore, searchWorks, searchPage, batchController,
    candidateStore, fetchImpl, confirmArchive, initialDirection, onQueueChange: () => renderQueue() })
  const renderLocalStatus = () => {
    setText(root, "#local-match-status", localIndex.status === "ready"
      ? `已核对当前本地索引 ${localIndex.papers.length} 篇。仅确认 PDF 是否在索引中可打开；疑似项需人工核对。`
      : localIndex.status === "loading" ? "正在核对本地索引；读取完成前，本地状态为未知。"
        : "本地索引读取失败，不能判断是否已收录。网上检索仍可使用，请刷新本地状态。")
    session.updateLocal(localIndex.status === "ready" ? localIndex.papers : null)
  }
  const acceptLocalIndex = (index) => {
    if (!Array.isArray(index?.papers)) throw new Error("本地索引格式无效")
    localIndex = { status: "ready", papers: index.papers }
    renderLocalStatus()
  }
  const refreshLocalIndex = async () => {
    const generation = ++indexGeneration
    localIndex = { status: "loading", papers: [] }
    renderLocalStatus()
    try {
      const index = await loadIndex()
      if (generation !== indexGeneration) return
      acceptLocalIndex(index)
    } catch {
      if (generation !== indexGeneration) return
      localIndex = { status: "error", papers: [] }
      renderLocalStatus()
    }
  }

  const archiveState = (paperId) => archiveStates.get(paperId) ?? { busy: false, status: "" }
  const updateArchiveState = (paperId, patch) => {
    archiveStates.set(paperId, { ...archiveState(paperId), ...patch })
  }

  const recoveryKey = (recovery) => [
    recovery?.archive_source_id,
    recovery?.paper_id,
    recovery?.openalex_id,
  ].join("\u0000")

  const canArchive = (paperId) => localCapabilities?.candidate_archive === true
    && localCapabilities?.recovery?.required === false
    && isValidLocalPaperId(paperId)

  const capabilityTuple = (capabilities) => {
    if (capabilities?.candidate_archive !== true || capabilities?.recovery?.required !== false) return null
    return JSON.stringify({
      archive_source_id: capabilities.archive_source_id,
      archive_rebuild: capabilities.archive_rebuild,
      recovery: capabilities.recovery,
    })
  }

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
      || recoveryKey(recovery) === completedRecoveryKey
    ) return
    button.disabled = true
    status.textContent = "正在重建论文库索引…"
    let result
    try {
      result = await requestArchiveRebuild({
        fetchImpl,
        archiveSourceId: recovery.archive_source_id,
        paperId: recovery.paper_id,
        openAlexId: recovery.openalex_id,
      })
    } catch (error) {
      status.textContent = error?.name === "LocalLibraryApiError"
        ? error.message
        : "论文库恢复未完成，请稍后重试。"
      button.disabled = false
      return
    }
    completedRecoveryKey = recoveryKey(recovery)
    let marked = false
    try {
      const matchingCandidates = candidateStore.read().candidates.filter((candidate) => (
        candidate?.paperId === recovery.openalex_id
        && candidate.stage === "confirmed_for_archive"
      ))
      const hadConfirmedCandidate = matchingCandidates.length === 1
      const freshIndex = await loadIndex()
      indexGeneration += 1
      acceptLocalIndex(freshIndex)
      marked = markCandidateArchivedAfterIndexRefresh({
        candidateStore,
        paperIndex: freshIndex,
        localPaperId: result.paper_id,
        openAlexId: recovery.openalex_id,
      })
      recoveryNotice = marked
        ? "恢复完成，元数据归档完成。"
        : hadConfirmedCandidate
          ? ARCHIVE_RECONCILIATION_PENDING
          : "恢复完成；未找到本地候选或严格身份不匹配，未更改本地候选状态。"
    } catch {
      recoveryNotice = ARCHIVE_RECONCILIATION_PENDING
    }
    status.textContent = recoveryNotice
    await refreshCapabilities()
  }

  const renderRecoveryBanner = () => {
    const banner = ensureRecoveryBanner()
    if (!banner) return
    banner.replaceChildren?.()
    const recovery = localCapabilities?.recovery
    const completedCurrentRecovery = recovery?.required === true
      && recovery.kind === "candidate_archive"
      && recoveryKey(recovery) === completedRecoveryKey
    if (recoveryNotice && (recovery?.required !== true || completedCurrentRecovery)) {
      const message = root.createElement("p")
      message.textContent = recoveryNotice
      banner.hidden = false
      banner.append?.(message)
      return
    }
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
    if (
      archiveState(candidate.paperId).busy
      || current.length !== 1
      || current[0].stage !== "confirmed_for_archive"
      || !canArchive(context.localPaperId)
    ) return
    const confirmedPaperId = context.localPaperId
    const confirmedCapabilities = capabilityTuple(localCapabilities)
    const confirmation = [
      `本地论文 ID：${confirmedPaperId}`,
      `归档来源：${localCapabilities.archive_source_id}`,
      ARCHIVE_DISCLOSURE,
    ].join("\n")
    updateArchiveState(candidate.paperId, { busy: true, status: "等待确认归档…" })
    renderQueue()
    let confirmed = false
    try { confirmed = await Promise.resolve(confirmArchive(confirmation)) } catch { confirmed = false }
    if (!confirmed) {
      updateArchiveState(candidate.paperId, { busy: false, status: "" })
      renderQueue()
      return
    }
    let reloadStatus = null
    try { reloadStatus = candidateStore.reload?.()?.status ?? null } catch { reloadStatus = null }
    const freshCandidates = candidateStore.read().candidates.filter((item) => item.paperId === candidate.paperId)
    if (
      reloadStatus !== "ready"
      || freshCandidates.length !== 1
      || freshCandidates[0].stage !== "confirmed_for_archive"
      || capabilityTuple(localCapabilities) !== confirmedCapabilities
      || localPaperIds.get(candidate.paperId) !== confirmedPaperId
      || !canArchive(confirmedPaperId)
    ) {
      updateArchiveState(candidate.paperId, {
        busy: false,
        status: "候选状态或归档能力已变化，未执行归档。",
      })
      renderQueue()
      return
    }
    updateArchiveState(candidate.paperId, { status: "正在归档书目信息…" })
    renderQueue()
    try {
      const result = await archiveConfirmedCandidate({
        fetchImpl,
        archiveSourceId: localCapabilities.archive_source_id,
        paperId: confirmedPaperId,
        candidate: freshCandidates[0],
      })
      if (result.rebuild_status === "failed") {
        updateArchiveState(candidate.paperId, {
          busy: false,
          status: "元数据已写入，但论文库索引重建失败；请使用恢复操作。",
        })
        await refreshCapabilities()
        return
      }
      const freshIndex = await loadIndex()
      indexGeneration += 1
      acceptLocalIndex(freshIndex)
      const marked = markCandidateArchivedAfterIndexRefresh({
        candidateStore,
        paperIndex: freshIndex,
        localPaperId: result.paper_id,
        openAlexId: candidate.paperId,
      })
      if (!marked) {
        updateArchiveState(candidate.paperId, {
          busy: false,
          status: "归档响应已完成，但新索引未严格匹配该候选；本地候选状态未更改。",
        })
        renderQueue()
        return
      }
      archiveStates.delete(candidate.paperId)
      renderQueue()
    } catch (error) {
      updateArchiveState(candidate.paperId, {
        busy: false,
        status: error?.name === "LocalLibraryApiError"
          ? error.message
          : "归档操作未完成，请稍后重试。",
      })
      await refreshCapabilities()
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
      confirm(id) { if (archiveState(id).busy) return; candidateStore.confirm(id); renderQueue() },
      moveToPending(id) { if (archiveState(id).busy) return; archiveStates.delete(id); localPaperIds.delete(id); candidateStore.moveToPending(id); renderQueue() },
      remove(id) { if (archiveState(id).busy) return; archiveStates.delete(id); localPaperIds.delete(id); candidateStore.remove(id); renderQueue() },
      localPaperId(id) { return localPaperIds.get(id) ?? "" },
      setLocalPaperId(id, value) { localPaperIds.set(id, typeof value === "string" ? value : "") },
      isArchiveBusy(id) { return archiveState(id).busy },
      archiveStatus(id) { return archiveState(id).status },
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
  const syncLocalSearchLink = () => {
    const link = node(root, "#search-local-library")
    if (!link) return
    const query = text(node(root, "#keyword-query")?.value)
    link.href = `./library.html${query ? `?q=${encodeURIComponent(query)}` : ""}`
  }
  return {
    async start() {
      recoveryNotice = ""
      completedRecoveryKey = null
      const initialQueryValue = typeof initialQuery === "string" ? initialQuery : ""
      const keywordInput = node(root, "#keyword-query")
      if (keywordInput && initialQueryValue) keywordInput.value = initialQueryValue
      let entryWarning = initialDirectionError
      if (initialQueryValue) {
        try { buildDiscoveryQueryPlan({ raw: initialQueryValue }) } catch (error) { entryWarning = error.message }
      }
      if (initialDirection?.conditions.length && !entryWarning) {
        const plan = buildDiscoveryQueryPlan({ conditions: initialDirection.conditions, expand: false })
        const englishInput = node(root, "#english-query")
        if (englishInput) englishInput.value = plan.selected[0].expression
        entryWarning = initialDirection.conditions.map(condition => condition.label).join("；") + "。" + initialDirection.warnings.join(" ")
      }
      for (const [key, selector] of [["startYear", "#keyword-start-year"], ["endYear", "#keyword-end-year"], ["language", "#keyword-language"]]) {
        const field = node(root, selector)
        if (field && typeof initialScope[key] === "string") field.value = initialScope[key]
      }
      setHidden(node(root, "#keyword-load-more"), true)
      syncLocalSearchLink()
      session.start()
      keywordInput?.addEventListener("input", syncLocalSearchLink)
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
      node(root, "#refresh-local-matches")?.addEventListener("click", refreshLocalIndex)
      root.defaultView?.addEventListener?.("focus", refreshLocalIndex)
      root.defaultView?.addEventListener?.("pageshow", (event) => { if (event.persisted) void refreshLocalIndex() })
      renderQueue(); activate("keyword")
      const startup = [refreshCapabilities(), refreshLocalIndex()]
      if (entryWarning) setText(root, "#keyword-search-status", entryWarning)
      if (autoSearch && initialQueryValue && !entryWarning) startup.push(session.search())
      await Promise.all(startup)
    },
    prepareAccess(locator) { prepareAccess(locator) },
    getWorks() { return session.getWorks() },
    getDiscoverySnapshot() { return session.getSnapshot() },
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
  location = globalThis.location,
} = {}) {
  const store = createCandidateStore(storage)
  const parameters = new URLSearchParams(
    typeof location?.search === "string" ? location.search : "",
  )
  const initialQuery = parameters.get("q") ?? ""
  let initialDirection = null
  let initialDirectionError = ""
  if (parameters.has("axes")) {
    try {
      if (parameters.getAll("axes").length !== 1) throw new Error("研究方向参数无效；请返回方向页重新选择")
      initialDirection = decodeDirectionAxes(parameters.get("axes"))
    } catch (error) { initialDirectionError = error.message }
  }
  const keyword = createKeywordDiscoveryController({
    root,
    initialQuery,
    initialDirection,
    initialDirectionError,
    initialScope: Object.fromEntries(["startYear", "endYear", "language"].filter((key) => parameters.has(key)).map((key) => [key, parameters.get(key)])),
    autoSearch: parameters.get("search") === "1",
    candidateStore: store,
    workspaceStore: createDiscoveryWorkspaceStore(storage),
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
