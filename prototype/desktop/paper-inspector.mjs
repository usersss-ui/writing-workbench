import {
  P02_ROLES,
  describePaperIdentity,
  displayPaperTitle,
  facetValues,
  translateState,
} from "./paper-library-model.mjs"
import { renderPreviewMath } from "./paper-math-renderer.mjs"

const ARTIFACT_LABELS = Object.freeze([
  Object.freeze(["pdf", "PDF"]),
  Object.freeze(["note", "阅读笔记"]),
  Object.freeze(["script", "仿真代码"]),
  Object.freeze(["result", "结果记录"]),
])
const ALLOWED_PREVIEW_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "ul", "li", "pre", "code",
  "strong", "em", "span", "div", "aside", "table", "thead", "tbody", "tr", "th", "td", "hr", "img",
])
const SAFE_LANGUAGE_CLASS = /^language-[A-Za-z0-9_-]+$/u
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SAFE_IMAGE_ASSET = /^[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)$/u
const SAFE_PREVIEW_DOCUMENT = /^[a-f0-9]{64}\.html$/u
const CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES = new Set([
  "note", "derivation", "source_map", "modeling", "simulation", "code_compare", "reproduction_report",
])
const SAFE_SOURCE_DOCUMENT = Object.freeze({
  pdf: /^[a-f0-9]{64}\.pdf$/u,
  ocr: /^[a-f0-9]{64}\.html$/u,
})
const HASHED_IMAGE_LABEL = /^[a-f0-9]{32,}\.(?:gif|jpe?g|png|webp)$/iu
const REPRODUCTION_IMAGE_LABEL = /^reproduce(?:[_-].*)?\.(?:gif|jpe?g|png|webp)$/iu
const CONTROLLED_PREVIEW_FILES = Object.freeze({
  note: "preferred.html",
  derivation: "derivation.html",
  simulation: "simulation.html",
  code_compare: "code_compare.html",
})
const CONTROLLED_PREVIEW_LABELS = Object.freeze({
  note: "论文精读",
  derivation: "推导过程",
  simulation: "仿真描述",
  code_compare: "代码对照",
})
const SAFE_CALLOUT_CLASSES = new Set([
  "note-callout--note", "note-callout--info", "note-callout--tip", "note-callout--warning",
  "note-callout--caution", "note-callout--important", "note-callout--quote", "note-callout--algorithm",
])

function readablePreviewImageLabel(value) {
  const label = typeof value === "string" ? value.trim() : ""
  const fileName = label.split(/[\\/]/u).at(-1) ?? ""
  if (HASHED_IMAGE_LABEL.test(fileName)) return "论文原图"
  if (REPRODUCTION_IMAGE_LABEL.test(fileName)) return "复现结果图"
  return label || "论文图片"
}

function appendTextElement(document, parent, tagName, text, className = "") {
  const element = document.createElement(tagName)
  if (className) element.className = className
  element.textContent = text
  parent.append(element)
  return element
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : []
}

function artifactCount(paper, key) {
  return Array.isArray(paper?.artifacts?.[key]) ? paper.artifacts[key].length : 0
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function appendStatusBadges(document, parent, paper) {
  const list = document.createElement("div")
  list.className = "library-status-list"
  for (const [field, value, modifier] of [
    ["source_status", paper?.source_status, "source"],
    ["evidence_status", paper?.evidence_status, "evidence"],
    ["reproduction_status", paper?.reproduction_status, "reproduction"],
  ]) {
    appendTextElement(document, list, "span", translateState(field, value), `library-status-badge library-status-${modifier}`)
  }
  parent.append(list)
}

function appendArtifactCounts(document, parent, paper) {
  const section = document.createElement("section")
  section.className = "library-inspector-section"
  appendTextElement(document, section, "h3", "材料数量")
  const list = document.createElement("dl")
  list.className = "library-artifact-counts"
  for (const [key, label] of ARTIFACT_LABELS) {
    const row = document.createElement("div")
    appendTextElement(document, row, "dt", label)
    appendTextElement(document, row, "dd", `${artifactCount(paper, key)} 份`)
    list.append(row)
  }
  const writing = document.createElement("div")
  appendTextElement(document, writing, "dt", "写作材料")
  appendTextElement(document, writing, "dd", `${nonnegativeInteger(paper?.writing_material_count)} 条`)
  list.append(writing)
  section.append(list)
  parent.append(section)
}

function appendReadingControl(document, parent, paper, workspaceState) {
  const fieldset = document.createElement("fieldset")
  fieldset.className = "library-inspector-control library-reading-options"
  appendTextElement(document, fieldset, "legend", "个人阅读标记")
  const selected = workspaceState?.personalReading?.[paper?.paper_id] ?? "unread"
  for (const [value, label] of [["unread", "未读"], ["reading", "在读"], ["read", "读过"]]) {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = "set-reading"
    button.dataset.marker = value
    button.setAttribute("aria-label", `将《${displayPaperTitle(paper)}》标记为${label}`)
    button.setAttribute("aria-pressed", String(selected === value))
    button.textContent = label
    fieldset.append(button)
  }
  parent.append(fieldset)
}

function appendShelfControls(document, parent, paper, workspaceState) {
  const fieldset = document.createElement("fieldset")
  fieldset.className = "library-inspector-control library-inspector-roles"
  appendTextElement(document, fieldset, "legend", "加入 P02 用途架")
  const activeRoles = new Set(workspaceState?.shelf?.[paper?.paper_id] ?? [])
  for (const role of P02_ROLES) {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = "toggle-shelf"
    button.dataset.role = role
    button.setAttribute("aria-pressed", String(activeRoles.has(role)))
    button.textContent = translateState("p02_role", role)
    fieldset.append(button)
  }
  parent.append(fieldset)
}

function appendIdentityContext(document, parent, paper) {
  const identity = describePaperIdentity(paper)
  if (!identity.identityPending && !identity.showSourceDirectory) return
  const context = document.createElement("div")
  context.className = "library-identity-context"
  if (identity.identityPending) {
    const badge = appendTextElement(document, context, "span", "待整理身份", "library-identity-badge")
    badge.dataset.identityStatus = "pending"
  }
  if (identity.showSourceDirectory) {
    const source = document.createElement("p")
    source.className = "library-source-directory"
    source.dataset.sourceDirectory = ""
    appendTextElement(document, source, "strong", "来源目录")
    const relativePath = appendTextElement(document, source, "span", identity.relativePath)
    relativePath.dataset.relativePath = ""
    context.append(source)
  }
  parent.append(context)
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function appendBibliography(document, parent, paper) {
  const section = document.createElement("section")
  section.className = "library-detail-section"
  appendTextElement(document, section, "h3", "书目信息")
  const list = document.createElement("dl")
  list.className = "library-detail-metadata"
  for (const [label, value] of [
    ["作者", stringList(paper?.authors).join("、") || "作者未记录"],
    ["年份", Number.isInteger(paper?.year) ? String(paper.year) : "年份未记录"],
    ["发表信息", typeof paper?.venue === "string" && paper.venue.trim() ? paper.venue.trim() : "发表信息未记录"],
  ]) {
    const row = document.createElement("div")
    appendTextElement(document, row, "dt", label)
    appendTextElement(document, row, "dd", value)
    list.append(row)
  }
  const doiRow = document.createElement("div")
  appendTextElement(document, doiRow, "dt", "DOI 或网页")
  const doiValue = typeof paper?.doi_or_url === "string" && paper.doi_or_url.trim() ? paper.doi_or_url.trim() : "未记录"
  const doiCell = document.createElement("dd")
  const url = safeHttpUrl(doiValue)
  if (url) {
    const link = document.createElement("a")
    link.href = url.href
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.textContent = doiValue
    doiCell.append(link)
  } else {
    doiCell.textContent = doiValue
  }
  doiRow.append(doiCell)
  list.append(doiRow)
  section.append(list)
  parent.append(section)
}

function appendResearchProfile(document, parent, paper, facetSchema) {
  const section = document.createElement("section")
  section.className = "library-inspector-section library-research-profile"
  appendTextElement(document, section, "h3", "论文研究画像")
  for (const schemaGroup of facetSchema?.groups ?? []) {
    const group = document.createElement("div")
    group.className = "library-profile-group"
    group.dataset.profilePath = schemaGroup.path
    appendTextElement(document, group, "strong", schemaGroup.label)
    const values = facetValues(paper, schemaGroup.path)
    if (values.length === 0) {
      appendTextElement(document, group, "span", "待核验", "library-profile-pending")
    } else {
      const list = document.createElement("ul")
      for (const value of values) appendTextElement(document, list, "li", value)
      group.append(list)
    }
    section.append(group)
  }

  const sourceTerms = document.createElement("details")
  sourceTerms.className = "library-source-terms"
  sourceTerms.dataset.sourceTerms = ""
  appendTextElement(document, sourceTerms, "summary", "原文术语与算法名称")
  const terms = stringList(paper?.source_terms)
  if (terms.length === 0) appendTextElement(document, sourceTerms, "p", "待核验")
  else {
    const list = document.createElement("ul")
    for (const term of terms) appendTextElement(document, list, "li", term)
    sourceTerms.append(list)
  }
  section.append(sourceTerms)
  parent.append(section)
}

export function renderInspector({ document, paper, workspaceState, facetSchema }) {
  const root = document.createElement("div")
  root.className = "library-inspector-paper"
  const heading = document.createElement("div")
  heading.className = "library-inspector-paper-heading"
  appendTextElement(document, heading, "code", paper?.paper_id || "论文编号待补")
  appendTextElement(document, heading, "h3", displayPaperTitle(paper))
  const englishTitle = typeof paper?.title_en === "string" ? paper.title_en.trim() : ""
  if (englishTitle && englishTitle !== displayPaperTitle(paper)) appendTextElement(document, heading, "p", englishTitle)
  root.append(heading)
  appendIdentityContext(document, root, paper)
  appendStatusBadges(document, root, paper)
  appendResearchProfile(document, root, paper, facetSchema)
  appendArtifactCounts(document, root, paper)
  appendReadingControl(document, root, paper, workspaceState)
  appendShelfControls(document, root, paper, workspaceState)

  const copyButton = document.createElement("button")
  copyButton.type = "button"
  copyButton.className = "button button--secondary button--full"
  copyButton.dataset.action = "copy-private-path"
  copyButton.textContent = "复制原始路径"
  root.append(copyButton)
  return root
}

export function renderReaderOverview({ document, paper, facetSchema }) {
  const root = document.createElement("div")
  root.className = "library-reader-overview"
  const introduction = document.createElement("section")
  introduction.className = "library-reader-summary-card"
  appendTextElement(document, introduction, "p", "快速概览", "eyebrow")
  appendTextElement(document, introduction, "h3", displayPaperTitle(paper))
  appendTextElement(
    document,
    introduction,
    "p",
    "这里汇总已记录的书目、材料与研究画像；未记录的结论不会从文件名或正文自动推断。",
  )
  root.append(introduction)
  appendBibliography(document, root, paper)
  appendArtifactCounts(document, root, paper)
  appendResearchProfile(document, root, paper, facetSchema)
  return root
}

export function renderReaderWriting({ document, paper, workspaceState }) {
  const root = document.createElement("div")
  root.className = "library-reader-writing"
  const roles = (workspaceState?.shelf?.[paper?.paper_id] ?? []).filter((role) => P02_ROLES.includes(role))

  const roleSection = document.createElement("section")
  roleSection.className = "library-reader-summary-card"
  appendTextElement(document, roleSection, "p", "写作用途", "eyebrow")
  appendTextElement(document, roleSection, "h3", "这篇论文目前怎样服务于 P02")
  appendTextElement(
    document,
    roleSection,
    "p",
    roles.length > 0 ? roles.map((role) => translateState("p02_role", role)).join("、") : "尚未加入 P02 用途架",
  )
  root.append(roleSection)

  const statusSection = document.createElement("section")
  statusSection.className = "library-detail-section"
  appendTextElement(document, statusSection, "h3", "可用程度")
  const list = document.createElement("dl")
  list.className = "library-detail-metadata"
  for (const [label, field] of [
    ["原文核验", "source_status"],
    ["证据结构", "evidence_status"],
    ["仿真复现", "reproduction_status"],
  ]) {
    const row = document.createElement("div")
    appendTextElement(document, row, "dt", label)
    appendTextElement(document, row, "dd", translateState(field, paper?.[field]))
    list.append(row)
  }
  const materialRow = document.createElement("div")
  appendTextElement(document, materialRow, "dt", "已提取写作材料")
  appendTextElement(document, materialRow, "dd", `${nonnegativeInteger(paper?.writing_material_count)} 条`)
  list.append(materialRow)
  statusSection.append(list)
  root.append(statusSection)

  const boundary = document.createElement("aside")
  boundary.className = "library-writing-boundary"
  appendTextElement(document, boundary, "strong", "使用边界")
  appendTextElement(document, boundary, "p", "读过或已有笔记，不等于已经形成可直接写入稿件的证据；仍需核验来源、条件和允许措辞。")
  root.append(boundary)
  return root
}

export function resolveSafeControlledPreviewUrl({ candidate, slug, kind, baseUrl }) {
  if (typeof candidate !== "string" || typeof slug !== "string" || typeof kind !== "string" || typeof baseUrl !== "string") return null
  if (!SAFE_SLUG.test(slug)) return null
  let expectedRelative = null
  const legacyFileName = CONTROLLED_PREVIEW_FILES[kind]
  const legacyRelative = legacyFileName ? `../../local_library_data/notes/${slug}/${legacyFileName}` : null
  if (candidate === legacyRelative) {
    expectedRelative = legacyRelative
  } else if (CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES.has(kind)) {
    const prefix = `../../local_library_data/notes/${slug}/${kind}/`
    if (!candidate.startsWith(prefix)) return null
    const fileName = candidate.slice(prefix.length)
    if (!SAFE_PREVIEW_DOCUMENT.test(fileName)) return null
    expectedRelative = `${prefix}${fileName}`
  }
  if (!expectedRelative || candidate !== expectedRelative) return null
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== "http:" && base.protocol !== "https:") return null
    const resolved = new URL(candidate, base)
    const expected = new URL(expectedRelative, base)
    if (resolved.origin !== base.origin || resolved.href !== expected.href || resolved.search || resolved.hash) return null
    return resolved.href
  } catch {
    return null
  }
}

export function resolveSafeNotePreviewUrl({ candidate, slug, baseUrl }) {
  return resolveSafeControlledPreviewUrl({ candidate, slug, kind: "note", baseUrl })
}

export function resolveSafePreviewAssetUrl({ candidate, slug, baseUrl }) {
  if (typeof candidate !== "string" || typeof slug !== "string" || typeof baseUrl !== "string") return null
  if (!SAFE_SLUG.test(slug)) return null
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== "http:" && base.protocol !== "https:") return null
    const resolved = new URL(candidate, base)
    if (resolved.origin !== base.origin || resolved.search || resolved.hash) return null
    for (const group of ["notes", "sources"]) {
      const prefix = `../../local_library_data/${group}/${slug}/assets/`
      const expectedDirectory = new URL(prefix, base)
      if (!resolved.pathname.startsWith(expectedDirectory.pathname)) continue
      const fileName = resolved.pathname.slice(expectedDirectory.pathname.length)
      if (!SAFE_IMAGE_ASSET.test(fileName)) return null
      const expected = new URL(`${prefix}${fileName}`, base)
      return resolved.href === expected.href ? resolved.href : null
    }
    return null
  } catch {
    return null
  }
}

export function resolveSafeSourceDocumentUrl({ candidate, slug, kind, baseUrl }) {
  if (typeof candidate !== "string" || typeof slug !== "string" || typeof kind !== "string" || typeof baseUrl !== "string") return null
  if (!SAFE_SLUG.test(slug) || !SAFE_SOURCE_DOCUMENT[kind]) return null
  const prefix = `../../local_library_data/sources/${slug}/${kind}/`
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== "http:" && base.protocol !== "https:") return null
    const resolved = new URL(candidate, base)
    const expectedDirectory = new URL(prefix, base)
    if (resolved.origin !== base.origin || resolved.search || resolved.hash) return null
    if (!resolved.pathname.startsWith(expectedDirectory.pathname)) return null
    const fileName = resolved.pathname.slice(expectedDirectory.pathname.length)
    if (!SAFE_SOURCE_DOCUMENT[kind].test(fileName)) return null
    const expected = new URL(`${prefix}${fileName}`, base)
    return resolved.href === expected.href ? resolved.href : null
  } catch {
    return null
  }
}

export function noteAvailabilityMessage(paper) {
  if (typeof paper?.controlled_previews?.note === "string" && paper.controlled_previews.note) return "已有网页笔记预览"
  if (typeof paper?.note_preview_url === "string" && paper.note_preview_url) return "已有网页笔记预览"
  if (artifactCount(paper, "note") > 1) return "存在多篇阅读笔记，待选择首选文件"
  if (artifactCount(paper, "note") > 0 || paper?.artifact_availability?.note === true) {
    return "已有阅读笔记；首版尚未生成网页预览"
  }
  return "尚无阅读笔记"
}

export function controlledPreviewAvailabilityMessage(paper, kind) {
  const labels = {
    note: "论文精读",
    derivation: "推导过程",
    simulation: "仿真描述",
    code_compare: "代码对照",
  }
  if (!labels[kind]) return "材料预览暂不可用"
  const candidate = paper?.controlled_previews?.[kind] ?? (kind === "note" ? paper?.note_preview_url : null)
  if (typeof candidate === "string" && candidate) return `已有${labels[kind]}预览`
  const count = artifactCount(paper, kind)
  if (count > 1) return `存在多份${labels[kind]}，待选择首选文件`
  if (count === 1 || paper?.artifact_availability?.[kind] === true) return `已有${labels[kind]}；尚未生成网页预览`
  return `尚无${labels[kind]}`
}

export function controlledPreviewFailureMessage(kind) {
  const label = CONTROLLED_PREVIEW_LABELS[kind]
  return label ? `${label}预览暂不可用` : "材料预览暂不可用"
}

function appendSanitizedNode({ source, destination, document, slug, baseUrl }) {
  if (source.nodeType === 3) {
    destination.append(document.createTextNode(source.textContent ?? ""))
    return
  }
  if (source.nodeType !== 1) return
  const tagName = source.tagName.toLowerCase()
  if (!ALLOWED_PREVIEW_TAGS.has(tagName)) return
  if (tagName === "img") {
    const safeSrc = resolveSafePreviewAssetUrl({ candidate: source.getAttribute("src"), slug, baseUrl })
    if (!safeSrc) return
    const alt = readablePreviewImageLabel(source.getAttribute("alt"))
    const trigger = document.createElement("button")
    trigger.type = "button"
    trigger.className = "note-image-trigger"
    trigger.dataset.imageLightboxTrigger = ""
    trigger.setAttribute("aria-haspopup", "dialog")
    trigger.setAttribute("aria-controls", "library-image-lightbox")
    trigger.setAttribute("aria-label", `放大查看：${alt}`)
    const copy = document.createElement("img")
    copy.className = "note-image"
    copy.src = safeSrc
    copy.alt = alt
    copy.loading = "lazy"
    copy.decoding = "async"
    for (const attribute of ["width", "height"]) {
      const raw = source.getAttribute(attribute)
      if (/^[1-9]\d{0,3}$/u.test(raw ?? "")) copy.setAttribute(attribute, raw)
    }
    trigger.append(copy)
    destination.append(trigger)
    return
  }
  const copy = document.createElement(tagName)
  if (tagName === "code") {
    const safeClass = [...source.classList].find((className) => SAFE_LANGUAGE_CLASS.test(className))
    if (safeClass) copy.className = safeClass
  } else if (tagName === "span" && source.classList.contains("math-inline")) {
    copy.className = "math-inline"
  } else if (tagName === "span" && source.classList.contains("note-image-placeholder")) {
    copy.className = "note-image-placeholder"
  } else if (tagName === "div" && source.classList.contains("note-table-scroll")) {
    copy.className = "note-table-scroll"
  } else if (tagName === "div" && source.classList.contains("math-display")) {
    copy.className = "math-display"
    copy.setAttribute("role", "math")
  } else if (tagName === "aside" && source.classList.contains("note-callout")) {
    const modifier = [...source.classList].find((className) => SAFE_CALLOUT_CLASSES.has(className))
    copy.className = modifier ? `note-callout ${modifier}` : "note-callout note-callout--note"
  } else if (tagName === "strong" && source.classList.contains("note-callout-title")) {
    copy.className = "note-callout-title"
  }
  for (const child of source.childNodes) appendSanitizedNode({ source: child, destination: copy, document, slug, baseUrl })
  destination.append(copy)
}

function textPreviewFragment(document, message) {
  const fragment = document.createDocumentFragment()
  fragment.append(document.createTextNode(message))
  return fragment
}

export async function mountSafeControlledPreview({
  document,
  paper,
  kind,
  previewDocument = null,
  emptyMessage = "",
  fetchImpl,
  baseUrl,
  signal,
}) {
  const hasPreviewDocumentCatalog = paper !== null
    && typeof paper === "object"
    && Object.hasOwn(paper, "controlled_preview_documents")
  const legacyCandidate = paper?.controlled_previews?.[kind] ?? (kind === "note" ? paper?.note_preview_url : null)
  const candidate = previewDocument?.url ?? (hasPreviewDocumentCatalog ? null : legacyCandidate)
  const candidateKind = previewDocument?.category ?? kind
  const safeUrl = resolveSafeControlledPreviewUrl({ candidate, slug: paper?.slug, kind: candidateKind, baseUrl })
  if (!candidate) {
    const message = typeof emptyMessage === "string" && emptyMessage
      ? emptyMessage
      : kind === "note" ? noteAvailabilityMessage(paper) : controlledPreviewAvailabilityMessage(paper, kind)
    return textPreviewFragment(document, message)
  }
  if (!safeUrl || typeof fetchImpl !== "function") {
    return textPreviewFragment(document, controlledPreviewFailureMessage(kind))
  }

  try {
    const response = await fetchImpl(safeUrl, { cache: "no-store", signal })
    if (!response?.ok || typeof response.text !== "function") throw new Error("preview unavailable")
    const sourceHtml = await response.text()
    const Parser = document?.defaultView?.DOMParser
    if (typeof Parser !== "function") throw new Error("preview unavailable")
    const parsed = new Parser().parseFromString(sourceHtml, "text/html")
    const fragment = document.createDocumentFragment()
    for (const child of parsed.body.childNodes) {
      appendSanitizedNode({ source: child, destination: fragment, document, slug: paper.slug, baseUrl })
    }
    renderPreviewMath(fragment)
    return fragment
  } catch (error) {
    if (error?.name === "AbortError") throw error
    return textPreviewFragment(document, controlledPreviewFailureMessage(kind))
  }
}

export async function mountSafeSourceOcrPreview({ document, paper, sourceDocument, fetchImpl, baseUrl, signal }) {
  const candidate = sourceDocument?.url
  if (!candidate) return textPreviewFragment(document, "未发现 OCR Markdown")
  const safeUrl = resolveSafeSourceDocumentUrl({ candidate, slug: paper?.slug, kind: "ocr", baseUrl })
  if (!safeUrl || typeof fetchImpl !== "function") return textPreviewFragment(document, "OCR 文本预览暂不可用")

  try {
    const response = await fetchImpl(safeUrl, { cache: "no-store", signal })
    if (!response?.ok || typeof response.text !== "function") throw new Error("OCR unavailable")
    const sourceHtml = await response.text()
    const Parser = document?.defaultView?.DOMParser
    if (typeof Parser !== "function") throw new Error("OCR unavailable")
    const parsed = new Parser().parseFromString(sourceHtml, "text/html")
    const fragment = document.createDocumentFragment()
    for (const child of parsed.body.childNodes) {
      appendSanitizedNode({ source: child, destination: fragment, document, slug: paper.slug, baseUrl })
    }
    renderPreviewMath(fragment)
    return fragment
  } catch (error) {
    if (error?.name === "AbortError") throw error
    return textPreviewFragment(document, "OCR 文本预览暂不可用")
  }
}

export async function mountSafeNotePreview(options) {
  return mountSafeControlledPreview({ ...options, kind: "note" })
}
