import { openWorkbenchStorage } from "./workbench-storage.mjs"
import { P02_WRITING_DATA, validateP02WritingData } from "./p02-writing-data.mjs"
import { buildWritingMaterials, createP02WorkflowStore, isValidP02WorkflowState, P02_WORKFLOW_STORAGE_KEY, summarizeP02Shelf } from "./p02-workflow.mjs"
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY } from "./paper-library-storage.mjs"
import { createDirectionSnapshotStore, DIRECTION_STORAGE_KEY, paperLibraryDetailHref } from "./direction-snapshot.mjs"

const WRITING_FIELDS = Object.freeze(["target_venue", "venue_references", "problem_algorithm", "theory_section", "experiment_section"])
const SOURCE_ROLE_LABELS = Object.freeze({
  algorithm_mechanism: "算法来源", theory_evidence: "理论来源", simulation_baseline: "实验基线", related_work: "相关工作",
})

export function buildCurrentWritingView(state) {
  const materials = buildWritingMaterials(state)
  return {
    targetVenue: state.writing.target_venue || "尚未选择期刊",
    draft: { ...state.writing },
    materials: [
      { title: "研究问题与方法记录", body: materials.algorithm.body },
      { title: "理论分析与待补证明", body: materials.theory.body },
      { title: "实验设计与结果记录", body: materials.simulation.body },
    ],
  }
}

export function saveCurrentWritingDraft(store, baseline, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)
    || Reflect.ownKeys(patch).some((key) => !WRITING_FIELDS.includes(key))) throw new TypeError("写作草稿无效")
  const inspection = store.readValidatedState()
  if (inspection.status !== "valid" && inspection.status !== "missing") {
    return { persisted: false, reason: inspection.status, state: inspection.state }
  }
  const current = inspection.state
  if (WRITING_FIELDS.some((field) => current.writing[field] !== baseline[field])) {
    return { persisted: false, reason: "stale_current", state: current }
  }
  const next = { ...current, writing: { ...current.writing, ...patch } }
  if (WRITING_FIELDS.some((field) => next.writing[field] !== current.writing[field])) {
    next.accepted_stages = current.accepted_stages.filter((stage) => stage !== "writing")
  }
  if (!isValidP02WorkflowState(next)) throw new TypeError("写作草稿无效")
  return store.replaceValidated(next, { expectedCurrent: current })
}

export function exportCurrentWritingMarkdown(state, { direction = "", sourceRoles = state.paper_roles } = {}) {
  const view = buildCurrentWritingView(state)
  const sources = Object.entries(SOURCE_ROLE_LABELS).map(([role, label]) =>
    `- ${label}：${sourceRoles[role]?.join("、") || "尚未加入"}`)
  return [
    "# P02 论文草稿", "", "> 当前编辑内容与研究记录；理论目标和实验计划仍按记录保留待核验说明。", "",
    "## 候选期刊", "", state.writing.target_venue || "尚未选择", "",
    "## 期刊选择理由与写作参考", "", state.writing.venue_references || "尚未填写", "",
    "## 问题与方法", "", state.writing.problem_algorithm || "待撰写", "",
    "## 理论分析", "", state.writing.theory_section || "待撰写", "",
    "## 实验与结果", "", state.writing.experiment_section || "待撰写", "",
    "---", "", "# 当前研究材料", "",
    ...(direction ? ["## 已保存方向", "", direction, ""] : []),
    ...view.materials.flatMap((material) => [`## ${material.title}`, "", material.body, ""]),
    "## 来源论文", "", ...sources, "",
  ].join("\n")
}

const CROSS_STATUS_LABELS = Object.freeze({
  source_located: "已定位官方来源",
  needs_full_text_verification: "待全文核验",
})
const STYLE_STATUS_LABELS = Object.freeze({
  metadata_verified: "元数据已核验",
  abstract_verified: "摘要已核验",
  partial_full_text_verified: "部分全文已核验",
})
const CLAIM_STATUS_LABELS = Object.freeze({
  design_fixed: "研究决定已固定",
  partially_supported: "部分证据支持",
  proof_blocked: "证明阻塞",
  experiment_blocked: "实验阻塞",
  prohibited_claim: "禁止主张",
})

export function buildP02WritingView(data) {
  if (!validateP02WritingData(data)) throw new TypeError("P02 写作材料数据无效")

  return {
    submissionLabel: "研究脚手架 · 尚不可投稿",
    manuscript: { ...data.manuscript },
    traceabilityLabel: `静态审查快照 · 更新于 ${data.updatedAt}`,
    targetVenue: { ...data.targetVenue },
    crossVenue: {
      heading: "同类论文 · 不同期刊",
      usageLabel: "相关工作与实质证据",
      boundary: "仅在原文核验范围内支撑相关工作、机制比较与差异矩阵；待全文核验的记录不能支撑完成式主张。",
      cards: data.crossVenueEvidence.map((record) => ({
        ...record,
        statusLabel: CROSS_STATUS_LABELS[record.verificationStatus],
      })),
    },
    inVenue: {
      heading: "TCNS 同刊相似论文",
      usageLabel: "仅用于排版与写作风格",
      boundary: "不计入最近邻证据，不支撑算法新颖性、理论正确性或性能优势，也不直接拼接原文。",
      cards: data.inVenueStyleSamples.map((record) => ({
        ...record,
        statusLabel: STYLE_STATUS_LABELS[record.verificationStatus],
      })),
    },
    materials: data.materials.map((record) => ({ ...record, statusLabel: "整理中" })),
    claims: data.claimSummary.map((record) => ({
      ...record,
      statusLabel: CLAIM_STATUS_LABELS[record.status],
    })),
    blockers: data.blockers.map((record) => ({ ...record, statusLabel: "阻塞" })),
  }
}

function createTextElement(documentRef, tagName, className, value) {
  const element = documentRef.createElement(tagName)
  if (className) element.className = className
  element.textContent = value
  return element
}

function createHttpsLink(documentRef, label, value) {
  const url = new URL(value)
  if (url.protocol !== "https:") throw new TypeError("P02 写作材料数据无效")
  const link = createTextElement(documentRef, "a", "writing-source-link", label)
  link.href = url.href
  link.setAttribute("target", "_blank")
  link.setAttribute("rel", "noreferrer")
  return link
}

function createTagList(documentRef, values) {
  const list = documentRef.createElement("ul")
  list.className = "writing-tag-list"
  for (const value of values) {
    list.append(createTextElement(documentRef, "li", "", value))
  }
  return list
}

function appendLabeledText(documentRef, parent, label, value, className = "") {
  const row = documentRef.createElement("div")
  if (className) row.className = className
  row.append(
    createTextElement(documentRef, "strong", "writing-field-label", label),
    createTextElement(documentRef, "p", "", value),
  )
  parent.append(row)
}

function createCrossVenueCard(documentRef, card) {
  const article = documentRef.createElement("article")
  article.className = "writing-paper-card writing-paper-card--evidence"

  const meta = documentRef.createElement("div")
  meta.className = "writing-card-meta"
  meta.append(
    createTextElement(documentRef, "code", "", card.paperId),
    createTextElement(documentRef, "span", "writing-status writing-status--evidence", card.statusLabel),
  )
  article.append(
    meta,
    createTextElement(documentRef, "h3", "", card.title),
    createTextElement(documentRef, "p", "writing-paper-citation", `${card.venue} · ${card.year}`),
    createTagList(documentRef, card.dimensions),
  )
  appendLabeledText(documentRef, article, "可使用章节", card.usableSections.join(" · "))
  appendLabeledText(documentRef, article, "可支撑用途", card.supportedUse, "writing-card-use")
  appendLabeledText(documentRef, article, "不可继承", card.unsupportedUse, "writing-card-boundary")
  article.append(createHttpsLink(documentRef, card.sourceUrl, card.sourceUrl))
  return article
}

function createStyleSampleCard(documentRef, card) {
  const article = documentRef.createElement("article")
  article.className = "writing-paper-card writing-paper-card--style"

  const meta = documentRef.createElement("div")
  meta.className = "writing-card-meta"
  meta.append(
    createTextElement(documentRef, "code", "", card.paperId),
    createTextElement(documentRef, "span", "writing-status writing-status--style", card.statusLabel),
  )
  article.append(
    meta,
    createTextElement(documentRef, "h3", "", card.title),
    createTextElement(documentRef, "p", "writing-paper-citation", `${card.venue} · ${card.year}`),
    createTextElement(documentRef, "span", "writing-claims-boundary", "不支撑论文主张"),
  )
  appendLabeledText(documentRef, article, "已核验页数", card.verifiedPages)
  appendLabeledText(documentRef, article, "章节组织", card.sectionOrder)
  appendLabeledText(documentRef, article, "摘要结构", card.abstractPattern)
  appendLabeledText(documentRef, article, "定理/证明放置", card.proofPlacement)
  appendLabeledText(documentRef, article, "实验呈现", card.experimentPresentation)
  appendLabeledText(documentRef, article, "写作用途", card.styleUse, "writing-card-use")
  appendLabeledText(documentRef, article, "禁止用途", card.prohibitedUse, "writing-card-boundary")
  article.append(createHttpsLink(documentRef, card.sourceUrl, card.sourceUrl))
  return article
}

function createMaterialCard(documentRef, card) {
  const article = documentRef.createElement("article")
  article.className = "writing-material-card"
  article.setAttribute("data-writing-material-card", "")
  article.append(
    createTextElement(documentRef, "code", "", card.materialId),
    createTextElement(documentRef, "span", "writing-status", card.statusLabel),
    createTextElement(documentRef, "h3", "", card.title),
    createTextElement(documentRef, "p", "", card.roleSummary),
  )
  return article
}

function createClaimCard(documentRef, card) {
  const article = documentRef.createElement("article")
  article.className = "writing-claim-card"
  const heading = documentRef.createElement("div")
  heading.className = "writing-card-meta"
  heading.append(
    createTextElement(documentRef, "code", "", card.claimId),
    createTextElement(documentRef, "span", "writing-status", card.statusLabel),
  )
  article.append(heading, createTextElement(documentRef, "h3", "", card.title))
  appendLabeledText(documentRef, article, "允许措辞", card.allowedWording, "writing-card-use")
  appendLabeledText(documentRef, article, "禁止措辞", card.prohibitedWording, "writing-card-boundary")
  return article
}

function createBlockerCard(documentRef, card) {
  const article = documentRef.createElement("article")
  article.className = "writing-blocker-card"
  const heading = documentRef.createElement("div")
  heading.className = "writing-card-meta"
  heading.append(
    createTextElement(documentRef, "code", "", card.blockerId),
    createTextElement(documentRef, "span", "writing-status writing-status--blocked", card.statusLabel),
  )
  article.append(heading, createTextElement(documentRef, "h3", "", card.workflow))
  appendLabeledText(documentRef, article, "下一步", card.nextStep)
  appendLabeledText(documentRef, article, "完成条件", card.completionCondition)
  return article
}

function replaceCollection(documentRef, selector, records, createCard) {
  const container = documentRef.querySelector(selector)
  if (!container) return
  container.replaceChildren(...records.map((record) => createCard(documentRef, record)))
}

function setText(documentRef, selector, value) {
  const element = documentRef.querySelector(selector)
  if (element) element.textContent = value
}

export function initializeP02Writing({ document: documentRef, data, storage, window: windowRef, download }) {
  const view = buildP02WritingView(data)
  setText(documentRef, "#submission-label", view.submissionLabel)
  setText(documentRef, "#manuscript-title", view.manuscript.title)
  setText(documentRef, "#manuscript-summary", view.manuscript.summary)
  setText(documentRef, "#traceability-summary", view.traceabilityLabel)
  setText(documentRef, "#target-venue-name", `${view.targetVenue.name} (${view.targetVenue.acronym})`)
  setText(documentRef, "#target-venue-fit", view.targetVenue.fitSummary)

  const venueLinks = documentRef.querySelector("#target-venue-links")
  if (venueLinks) {
    venueLinks.replaceChildren(
      createHttpsLink(documentRef, "期刊范围 ↗", view.targetVenue.scopeUrl),
      createHttpsLink(documentRef, "作者信息 ↗", view.targetVenue.authorInfoUrl),
    )
  }

  replaceCollection(documentRef, "#cross-venue-evidence", view.crossVenue.cards, createCrossVenueCard)
  replaceCollection(documentRef, "#in-venue-style-samples", view.inVenue.cards, createStyleSampleCard)
  replaceCollection(documentRef, "#writing-materials", view.materials, createMaterialCard)
  replaceCollection(documentRef, "#claim-summary", view.claims, createClaimCard)
  replaceCollection(documentRef, "#submission-blockers", view.blockers, createBlockerCard)
  initializeCurrentWriting({ document: documentRef, storage, window: windowRef, download })
  return view
}

function writingSaveMessage(result) {
  if (result.persisted) return "已保存到当前浏览器，可在 P02 研究记录中继续编辑。"
  if (result.reason === "stale_current") return "另一个页面已修改草稿，本次未覆盖。请先导出保留当前编辑，再刷新页面合并。"
  if (result.reason === "invalid") return "已保存的研究记录无法读取，本次未覆盖。可先导出当前编辑，再到状态迁移页检查记录。"
  return "保存未成功，编辑内容仍在页面中。请先导出 Markdown 保留草稿，再检查浏览器存储。"
}

function downloadMarkdown(documentRef, windowRef, markdown) {
  const url = windowRef.URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
  const link = documentRef.createElement("a")
  link.href = url
  link.download = "P02-writing-draft.md"
  documentRef.body.append(link)
  link.click()
  link.remove()
  windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 1000)
}

function initializeCurrentWriting({ document: documentRef, storage, window: windowRef, download }) {
  const form = documentRef.querySelector("#current-writing-form")
  if (!form) return
  const store = createP02WorkflowStore(storage)
  let inspection = store.readValidatedState()
  let baseline = { ...inspection.state.writing }
  let dirty = false
  let direction = ""
  let sourceRoles = inspection.state.paper_roles
  const field = (name) => documentRef.querySelector(`#writing-${name}`)
  const message = (value) => setText(documentRef, "#current-writing-message", value)
  const readDraft = () => Object.fromEntries(WRITING_FIELDS.map((name) => [name, field(name)?.value ?? baseline[name]]))
  const render = ({ fill = false } = {}) => {
    inspection = store.readValidatedState()
    const current = buildCurrentWritingView(inspection.state)
    const unavailable = !["valid", "missing"].includes(inspection.status)
    if (fill) {
      baseline = { ...current.draft }
      for (const name of WRITING_FIELDS) if (field(name)) field(name).value = baseline[name]
    }
    setText(documentRef, "#current-target-venue", unavailable ? "研究记录暂不可读取" : current.targetVenue)
    setText(documentRef, "#current-research-status", unavailable ? "当前研究材料暂不可读取，原记录未改动。" : "来自本浏览器保存的研究记录；可随时开始写草稿。")
    replaceCollection(documentRef, "#current-writing-materials", unavailable ? [] : current.materials, (doc, material) => {
      const item = doc.createElement("details")
      item.className = "writing-current-material"
      item.append(createTextElement(doc, "summary", "", material.title), createTextElement(doc, "pre", "", material.body))
      return item
    })
    const snapshot = createDirectionSnapshotStore(storage).read()
    direction = snapshot ? Object.values(snapshot.axes).flat().join(" · ") : ""
    setText(documentRef, "#current-writing-direction", direction || "尚未保存方向，可先到方向页确定研究问题。")
    const shelf = createWorkspaceStore(storage).readValidatedState()
    const shelfReadable = shelf.status === "valid" || shelf.status === "missing"
    sourceRoles = shelfReadable ? summarizeP02Shelf(shelf.state) : inspection.state.paper_roles
    const sourceContainer = documentRef.querySelector("#current-writing-sources")
    if (sourceContainer) {
      sourceContainer.replaceChildren()
      if (!shelfReadable) sourceContainer.append(createTextElement(documentRef, "p", "", "论文库用途暂不可读取；以下是研究记录中上次保存的来源。"))
      for (const [role, label] of Object.entries(SOURCE_ROLE_LABELS)) {
        const row = createTextElement(documentRef, "p", "", `${label}：`)
        if (!sourceRoles[role].length) row.append(createTextElement(documentRef, "span", "", "尚未加入"))
        for (const paperId of sourceRoles[role]) {
          const link = createTextElement(documentRef, "a", "writing-source-link", paperId)
          link.href = paperLibraryDetailHref(paperId)
          row.append(link)
        }
        sourceContainer.append(row)
      }
    }
    if (unavailable) message(writingSaveMessage({ reason: inspection.status }))
  }
  render({ fill: true })
  form.addEventListener("input", () => {
    dirty = true
    message("有未保存的修改。保存草稿，或直接导出当前编辑。")
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    try {
      const result = saveCurrentWritingDraft(store, baseline, readDraft())
      if (result.persisted) {
        baseline = { ...result.state.writing }
        dirty = false
        render()
      }
      message(writingSaveMessage(result))
    } catch {
      message("草稿暂不能保存：每个字段最多 12000 字符，且不能含无效控制字符。当前编辑已保留。")
    }
  })
  documentRef.querySelector("#export-current-writing")?.addEventListener("click", () => {
    render()
    const state = { ...inspection.state, writing: readDraft() }
    if (state.accepted_stages.includes("writing")) state.accepted_stages = state.accepted_stages.filter((stage) => stage !== "writing")
    try {
      const content = exportCurrentWritingMarkdown(state, { direction, sourceRoles })
      if (download) download(content)
      else downloadMarkdown(documentRef, windowRef, content)
      message(dirty ? "已导出当前编辑内容（含未保存修改）；浏览器中的草稿未更新。" : "已导出 Markdown 草稿和当前研究材料。")
    } catch {
      message("导出未成功，请保留当前页面并检查草稿字段是否超长。")
    }
  })
  windowRef?.addEventListener("storage", (event) => {
    if (event.key !== null && ![P02_WORKFLOW_STORAGE_KEY, WORKSPACE_STORAGE_KEY, DIRECTION_STORAGE_KEY].includes(event.key)) return
    render({ fill: !dirty })
    if (dirty) message("其他页面更新了研究记录。当前编辑已保留；保存时会检查草稿冲突。")
  })
  windowRef?.addEventListener("beforeunload", (event) => {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ""
  })
}

if (typeof document !== "undefined") {
  let storage
  try { storage = openWorkbenchStorage({ windowRef: globalThis }) } catch { /* The editor remains available for Markdown export. */ }
  initializeP02Writing({ document, data: P02_WRITING_DATA, storage, window: globalThis.window })
}
