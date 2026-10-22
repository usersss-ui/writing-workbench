const LOCAL_PAPER_ID = /^(?:[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|LIB-[A-F0-9]{12})$/u
const OPENALEX_ID = /^W[1-9]\d*$/u
const IDENTIFIER_CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/u
const UNKNOWN_TEXT = new Set(["not reported", "unknown", "untitled", "暂无书目信息", "无标题", "未知", "待补充"])

function identifierText(value) {
  return typeof value === "string" && value.length <= 2048 && !IDENTIFIER_CONTROL.test(value) && !value.includes("\\")
    ? value.trim()
    : ""
}

function doiIdentity(value) {
  let doi = identifierText(value)
  if (!doi) return null
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").replace(/^doi:\s*/iu, "").toLowerCase()
  // Query strings, fragments and encoded paths are not part of a verified DOI identity.
  if (!/^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u.test(doi) || doi.includes("//")) return null
  const suffix = doi.slice(doi.indexOf("/") + 1)
  return suffix.split("/").some((part) => part === "." || part === "..") ? null : doi
}

function openAlexIdentity(value) {
  const match = /^https:\/\/(?:openalex\.org\/|api\.openalex\.org\/works\/)(W[1-9]\d*)\/?$/iu.exec(identifierText(value))
  return match ? match[1].toUpperCase() : null
}

function text(value) {
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim() : ""
}

function normalizedText(value) {
  const normalized = text(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  return UNKNOWN_TEXT.has(normalized) ? "" : normalized
}

function titleVariants(paper) {
  return [...new Set([paper.title_original, paper.title_en, paper.title_zh]
    .map(normalizedText).filter((title) => title.length >= 8))]
}

function sharedAuthor(work, paper) {
  const normalizeAuthors = (authors) => Array.isArray(authors) ? authors.map(normalizedText).filter(Boolean) : []
  const authors = new Set(normalizeAuthors(work.authors))
  return normalizeAuthors(paper.authors).some((author) => authors.has(author))
}

function sameYear(work, paper) {
  const year = Number.isInteger(paper.publication_year) ? paper.publication_year : paper.year
  return Number.isInteger(work.year) && work.year >= 1000 && work.year <= 9999 && work.year === year
}

function closeTitle(left, right) {
  const first = new Set(left.split(" "))
  const second = new Set(right.split(" "))
  const common = [...first].filter((word) => second.has(word)).length
  return common >= 5 && (2 * common) / (first.size + second.size) >= 0.85
}

function bibliographicEvidence(work, paper) {
  const title = normalizedText(work.title)
  if (title.length < 8) return null
  const variants = titleVariants(paper)
  const yearMatches = sameYear(work, paper)
  const authorMatches = sharedAuthor(work, paper)
  if (variants.includes(title) && (yearMatches || authorMatches)) return "title"
  // Preprints can have an earlier year and differently abbreviated authors.
  // A distinctive identical title is a review hint only, never a confirmed identity.
  if (variants.includes(title) && (title.length >= 32 || (title.match(/\p{Script=Han}/gu)?.length ?? 0) >= 16)) return "title_version"
  return yearMatches && authorMatches && variants.some((candidate) => closeTitle(title, candidate)) ? "similar_title" : null
}

function obviousTitleConflict(work, paper) {
  const title = normalizedText(work.title)
  const variants = titleVariants(paper)
  // Cross-script and short variants are inconclusive; they cannot erase a
  // contradiction supported by a substantial same-script variant.
  const words = value => value.split(' ').filter(word => word.length >= 3)
  if (words(title).length < 4 || !variants.length) return false
  if (variants.some(candidate => candidate.includes(title) || title.includes(candidate) || closeTitle(title, candidate))) return false
  if (/\p{Script=Han}/u.test(title)) return false
  const informative = value => words(value).filter(word => !['the', 'and', 'for', 'with', 'from', 'over', 'into', 'using', 'study', 'analysis'].includes(word))
  const left = informative(title)
  const comparable = variants.filter(candidate => !/\p{Script=Han}/u.test(candidate))
    .map(informative).filter(words => words.length >= 3)
  return left.length >= 3 && comparable.length > 0
    && comparable.some(right => !left.some(word => right.includes(word)))
}

function publicMatch(paper) {
  return {
    paperId: paper.paper_id,
    title: text(paper.title_zh) || text(paper.title_original) || text(paper.title_en) || "暂无书目信息",
    href: `./library.html?paper_id=${encodeURIComponent(paper.paper_id)}`,
    hasPdf: Array.isArray(paper.source_documents?.pdf)
      && paper.source_documents.pdf.some((document) => typeof document?.url === "string" && document.url.length > 0),
    hasNote: (Array.isArray(paper.artifacts?.note) && paper.artifacts.note.length > 0)
      || paper.artifact_availability?.note === true,
  }
}

/** Read-only comparison against a successfully loaded local index; never changes candidate or library state. */
export function matchLocalPaper(work, papers) {
  if (!Array.isArray(papers)) throw new TypeError("请先载入有效的本地论文索引")
  if (!work || typeof work !== "object" || Array.isArray(work)) throw new TypeError("在线论文记录无效")
  const doi = doiIdentity(work.doi)
  const openAlex = OPENALEX_ID.test(work.paperId ?? "") ? work.paperId : null
  const found = []
  for (const paper of papers) {
    if (!paper || typeof paper !== "object" || !LOCAL_PAPER_ID.test(paper.paper_id ?? "")) continue
    const localDoi = doiIdentity(paper.doi_or_url)
    const localOpenAlex = openAlexIdentity(paper.doi_or_url)
    const identity = doi && doi === localDoi ? "DOI" : openAlex && openAlex === localOpenAlex ? "OpenAlex ID" : null
    const bibliography = identity ? null : bibliographicEvidence(work, paper)
    if (!identity && !bibliography) continue
    found.push({
      match: publicMatch(paper), identity, bibliography,
      conflict: identity && obviousTitleConflict(work, paper) ? "title"
        : doi && localDoi && doi !== localDoi ? "DOI" : openAlex && localOpenAlex && openAlex !== localOpenAlex ? "OpenAlex ID" : null,
    })
  }
  const matches = found.map((record) => record.match)
  if (!found.length) return { status: "not_found", matches, reason: "未找到相同标识或有足够书目信息支持的本地记录。" }
  if (found.length > 1) return { status: "possible_match", matches, reason: "匹配到多条本地记录，需人工核对，尚未确定对应关系。" }
  const record = found[0]
  if (record.identity && record.conflict) return {
    status: "possible_match", matches,
    reason: `${record.identity} 一致，但题名存在明显冲突，需人工核对。`,
  }
  if (record.identity) return {
    status: record.match.hasPdf ? "existing_pdf" : "missing_pdf",
    matches,
    reason: `${record.identity} 与本地唯一记录一致；${record.match.hasPdf ? "已有可查看的 PDF" : "暂无可查看的 PDF"}。`,
  }
  return {
    status: "possible_match", matches,
    reason: record.conflict ? `标题接近，但 ${record.conflict} 不一致，需人工核对。`
      : record.bibliography === "title" ? "标题与年份或作者一致，但缺少唯一标识核验。"
        : record.bibliography === "title_version" ? "完整题名相同，但年份或作者信息未对齐；请核对预印本与正式发表版本。"
        : "标题相似，年份和作者也有重合，仍需人工核对。",
  }
}
