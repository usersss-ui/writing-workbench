import { cleanText, normalizeDoi, safeHttpsUrl } from "./bibliography-normalization.mjs"
import { normalizeDiscoveryRecord } from "./discovery-record.mjs"
export { normalizeDoi, safeHttpsUrl } from "./bibliography-normalization.mjs"

const OPENALEX_WORKS_ENDPOINT = "https://api.openalex.org/works"
const MAX_QUERY_CHARACTERS = 1_000
const MAX_CURSOR_CHARACTERS = 2_048
const MAX_PER_PAGE = 50
const MAX_TOTAL = 100_000_000
const MAX_ABSTRACT_ENTRIES = 5_000
const MAX_ABSTRACT_POSITIONS = 5_000

const SELECT_FIELDS = [
  "id",
  "doi",
  "title",
  "authorships",
  "publication_year",
  "primary_location",
  "cited_by_count",
  "open_access",
  "best_oa_location",
  "topics",
  "abstract_inverted_index",
  "language",
  "type",
  "is_retracted",
]

const SORTS = Object.freeze({
  relevance: Object.freeze({ parameter: "relevance_score:desc", basis: "OpenAlex 综合相关度" }),
  newest: Object.freeze({ parameter: "publication_date:desc", basis: "出版时间（新到旧）" }),
  citations: Object.freeze({ parameter: "cited_by_count:desc", basis: "OpenAlex 引用次数（高到低）" }),
})

function searchError(code, message, details = {}) {
  const error = new Error(message)
  error.name = "OpenAlexSearchError"
  error.code = code
  Object.assign(error, details)
  return error
}

function normalizeQuery(query) {
  if (typeof query !== "string") throw searchError("request_failed", "请输入检索关键词")
  const value = query.trim()
  if (!value || [...value].length > MAX_QUERY_CHARACTERS || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw searchError("request_failed", "检索关键词格式无效")
  }
  return value
}

function isValidCursor(value) {
  // Cursors are opaque: preserve them exactly, and encode them only as a query value.
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CURSOR_CHARACTERS &&
    /^[\u0021-\u007e]+$/u.test(value)
}

function normalizePaperId(value) {
  if (typeof value !== "string" || value.length > 100) return null
  const match = cleanText(value, 100).match(/^https:\/\/openalex\.org\/(W\d+)\/?$/iu)
  return match ? match[1].toUpperCase() : null
}

function normalizeNames(value, selector, maximumItems) {
  if (!Array.isArray(value)) return []
  const names = []
  const seen = new Set()
  for (const item of value.slice(0, maximumItems)) {
    const name = cleanText(selector(item), 300)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function reconstructAbstract(index) {
  if (index === null || index === undefined) return null
  if (typeof index !== "object" || Array.isArray(index)) return null
  const positionedWords = new Map()
  for (const [rawWord, rawPositions] of Object.entries(index)) {
    const word = cleanText(rawWord, 300)
    if (!word || !Array.isArray(rawPositions)) continue
    for (const position of rawPositions) {
      if (!Number.isInteger(position) || position < 0 || position > 10_000) continue
      if (!positionedWords.has(position)) positionedWords.set(position, word)
      if (positionedWords.size >= 5_000) break
    }
    if (positionedWords.size >= 5_000) break
  }
  if (positionedWords.size === 0) return null
  return [...positionedWords.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, word]) => word)
    .join(" ")
    .slice(0, 20_000) || null
}

function hasAbusiveNestedFields(work) {
  if (typeof work.id === "string" && work.id.length > 100) return true
  if (typeof work.doi === "string" && work.doi.length > 512) return true
  if (typeof work.title === "string" && work.title.length > 1_000) return true
  if (Array.isArray(work.authorships) && work.authorships.length > 50) return true
  if (Array.isArray(work.authorships) && work.authorships.some((authorship) => (
    typeof authorship?.author?.display_name === "string" && authorship.author.display_name.length > 300
  ))) return true
  if (Array.isArray(work.topics) && work.topics.length > 20) return true
  if (Array.isArray(work.topics) && work.topics.some((topic) => (
    typeof topic?.display_name === "string" && topic.display_name.length > 300
  ))) return true
  if (
    typeof work.primary_location?.source?.display_name === "string" &&
    work.primary_location.source.display_name.length > 500
  ) return true
  for (const url of [
    work.primary_location?.landing_page_url,
    work.open_access?.oa_url,
    work.best_oa_location?.pdf_url,
    work.best_oa_location?.landing_page_url,
  ]) {
    if (typeof url === "string" && url.length > 2_048) return true
  }
  const index = work.abstract_inverted_index
  if (index === null || index === undefined) return false
  if (typeof index !== "object" || Array.isArray(index)) return true
  let entries = 0
  let rawPositions = 0
  for (const word in index) {
    if (!Object.hasOwn(index, word)) continue
    entries += 1
    if (entries > MAX_ABSTRACT_ENTRIES || word.length > 300) return true
    const values = index[word]
    if (!Array.isArray(values)) continue
    if (values.length > MAX_ABSTRACT_POSITIONS) return true
    rawPositions += values.length
    if (rawPositions > MAX_ABSTRACT_POSITIONS) return true
    for (const position of values) {
      if (!Number.isInteger(position)) {
        if (
          typeof position !== "string" || position.length > 300 ||
          /[\u0000-\u001f\u007f\u2028\u2029]/u.test(position)
        ) return true
        continue
      }
      if (position < 0 || position > 10_000) return true
    }
  }
  return false
}

function normalizeWork(work) {
  if (!work || typeof work !== "object" || Array.isArray(work)) return null
  if (hasAbusiveNestedFields(work)) return null
  const paperId = normalizePaperId(work.id)
  if (!paperId) return null

  const doi = normalizeDoi(work.doi)
  const title = cleanText(work.title, 1_000) || "Not Reported"
  const authors = normalizeNames(work.authorships, (authorship) => authorship?.author?.display_name, 50)
  const year = Number.isInteger(work.publication_year) && work.publication_year >= 1000 && work.publication_year <= 9999
    ? work.publication_year
    : null
  const source = cleanText(work.primary_location?.source?.display_name, 500) || "Not Reported"
  const citations = Number.isSafeInteger(work.cited_by_count) && work.cited_by_count >= 0 ? work.cited_by_count : 0
  const isOpenAccess = work.open_access?.is_oa === true
  const openAccessUrl = isOpenAccess
    ? safeHttpsUrl(work.open_access?.oa_url) ??
      safeHttpsUrl(work.best_oa_location?.pdf_url) ??
      safeHttpsUrl(work.best_oa_location?.landing_page_url)
    : null
  const landingPageUrl = safeHttpsUrl(work.primary_location?.landing_page_url) ??
    (doi ? `https://doi.org/${doi}` : `https://openalex.org/${paperId}`)
  const topics = normalizeNames(work.topics, (topic) => topic?.display_name, 20)

  return {
    paperId,
    doi,
    title,
    authors,
    year,
    source,
    citations,
    isOpenAccess,
    openAccessUrl,
    landingPageUrl,
    topics,
    abstract: reconstructAbstract(work.abstract_inverted_index),
  }
}

export function buildOpenAlexSearchUrl({
  query,
  sort = "relevance",
  startYear = null,
  endYear = null,
  language = "all",
  cursor = "*",
  perPage = 25,
} = {}) {
  const normalizedQuery = normalizeQuery(query)
  if ([startYear, endYear].some((year) => year !== null && (
    !Number.isInteger(year) || year < 1000 || year > 9999
  ))) {
    throw searchError("request_failed", "检索年份无效")
  }
  if (startYear !== null && endYear !== null && startYear > endYear) {
    throw searchError("request_failed", "起始年份不能晚于结束年份")
  }
  if (!["all", "en", "zh"].includes(language)) throw searchError("request_failed", "检索语言无效")
  if (!isValidCursor(cursor)) throw searchError("request_failed", "检索分页位置无效")
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    throw searchError("request_failed", "检索数量无效")
  }
  if (!Object.hasOwn(SORTS, sort)) throw searchError("request_failed", "检索排序方式无效")

  const filters = []
  if (startYear !== null) filters.push(`from_publication_date:${startYear}-01-01`)
  if (endYear !== null) filters.push(`to_publication_date:${endYear}-12-31`)
  if (language !== "all") filters.push(`language:${language}`)
  filters.push("is_retracted:false")

  const url = new URL(OPENALEX_WORKS_ENDPOINT)
  url.searchParams.set("search", normalizedQuery)
  url.searchParams.set("filter", filters.join(","))
  url.searchParams.set("sort", SORTS[sort].parameter)
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("cursor", cursor)
  url.searchParams.set("select", SELECT_FIELDS.join(","))
  return url.toString()
}

async function readSearchPage({
  query,
  fetchImpl = fetch,
  signal,
  sort = "relevance",
  startYear = null,
  endYear = null,
  language = "all",
  cursor = "*",
  perPage = 25,
} = {}) {
  if (typeof fetchImpl !== "function") throw searchError("request_failed", "检索请求函数无效")
  const normalizedQuery = normalizeQuery(query)
  const url = buildOpenAlexSearchUrl({ query: normalizedQuery, sort, startYear, endYear, language, cursor, perPage })

  const payload = await fetchOpenAlexPayload({ url, fetchImpl, signal })
  if (
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    !payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta) ||
    !Array.isArray(payload.results) || payload.results.length > perPage ||
    !Number.isSafeInteger(payload.meta.count) || payload.meta.count < 0 || payload.meta.count > MAX_TOTAL ||
    payload.meta.count < payload.results.length
  ) {
    throw searchError("invalid_response", "OpenAlex 返回的数据结构无效")
  }

  const nextCursor = payload.meta.next_cursor
  if (
    (nextCursor !== null && (!isValidCursor(nextCursor) || nextCursor === "*" || nextCursor === cursor)) ||
    (payload.results.length === 0 && nextCursor !== null) ||
    (cursor === "*" && payload.meta.count > payload.results.length && nextCursor === null)
  ) {
    throw searchError("invalid_response", "OpenAlex 返回的分页信息不完整或无效")
  }

  const works = payload.results.map(normalizeWork)
  if (works.some((work) => work === null)) {
    throw searchError("invalid_response", "OpenAlex 返回的论文记录无效")
  }
  const rawCost = payload.meta.cost_usd
  if (rawCost !== undefined && (typeof rawCost !== "number" || !Number.isFinite(rawCost) || rawCost < 0 || rawCost > 1)) {
    throw searchError("invalid_response", "OpenAlex 返回的计费信息无效")
  }
  return { rawWorks: payload.results, page: {
    total: payload.meta.count,
    nextCursor,
    works,
    costUsd: rawCost ?? 0,
    query: normalizedQuery,
    sort,
    sortBasis: SORTS[sort].basis,
    emptyMessage: works.length === 0
      ? cursor === "*" ? "当前检索条件未返回结果。" : "已加载完当前检索条件的结果。"
      : null,
  } }
}

async function fetchOpenAlexPayload({ url, fetchImpl, signal, singleton = false }) {
  let response
  try {
    response = await fetchImpl(url, {
      method: "GET",
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      headers: { Accept: "application/json" },
    })
  } catch (error) {
    if (error?.name === "AbortError") throw error
    throw searchError("network", "无法连接 OpenAlex", { cause: error, retryable: true })
  }

  if (!response || typeof response.ok !== "boolean" || !Number.isInteger(response.status)) {
    throw searchError("invalid_response", "OpenAlex 返回了无效响应")
  }
  if (response.status === 429) throw searchError("rate_limited", "OpenAlex 暂时限流", { status: 429, retryable: true })
  if (singleton && response.status === 404) throw searchError("unverified", "未找到 DOI 对应的 OpenAlex 记录", { status: 404, retryable: false })
  if (!response.ok || response.status < 200 || response.status >= 300 || response.redirected) {
    throw searchError("request_failed", "OpenAlex 检索失败", { status: response.status, retryable: false })
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === "AbortError") throw error
    throw searchError("invalid_response", "OpenAlex 返回的 JSON 无法解析", { cause: error })
  }
  // Bound the whole parsed payload as well as the known nested work fields.
  // Fetch/JSON parsing is the existing transport boundary; no secondary fetch is made.
  try {
    const serialized = JSON.stringify(payload)
    const maximum = singleton ? 2 * 1024 * 1024 : 8 * 1024 * 1024
    if (typeof serialized !== "string" || serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) {
      throw new Error("oversized")
    }
  } catch {
    throw searchError("invalid_response", "OpenAlex 返回的数据过大或无效")
  }
  return payload
}

export async function searchOpenAlexWorks(options = {}) {
  return (await readSearchPage(options)).page
}

function richMetadata(raw, work, retrievedAt) {
  const source = raw.primary_location?.source
  if ([raw.language, raw.type, source?.type].some(value => typeof value === "string" && value.length > 100) ||
    (typeof source?.id === "string" && source.id.length > 2048) ||
    (typeof source?.issn_l === "string" && source.issn_l.length > 32) ||
    (Array.isArray(source?.issn) && (source.issn.length > 10 || source.issn.some(value => typeof value === "string" && value.length > 32)))) {
    throw searchError("invalid_response", "OpenAlex 返回的来源字段过大")
  }
  const issns = [...(Array.isArray(source?.issn) ? source.issn : []), source?.issn_l]
    .filter(value => typeof value === "string" && /^\d{4}-\d{3}[\dX]$/u.test(value.trim().toUpperCase()))
    .map(value => value.trim().toUpperCase())
  if (new Set(issns).size > 10) throw searchError("invalid_response", "OpenAlex 返回的 ISSN 数量过多")
  const state = raw.is_retracted === true ? "retracted" : raw.is_retracted === false ? "screened_clear" : "unknown"
  return {
    bibliography: {
      title: work.title,
      authors: Array.isArray(raw.authorships)
        ? raw.authorships.map(item => cleanText(item?.author?.display_name, 300)).filter(Boolean) : [],
      year: work.year, doi: work.doi, url: work.landingPageUrl, abstract: work.abstract,
      language: cleanText(raw.language, 100).toLowerCase() || null,
      work_type: cleanText(raw.type, 100).toLowerCase() || null,
      journal: { title: cleanText(source?.display_name, 500) || null,
        source_id: typeof source?.id === "string" && /^https:\/\/openalex\.org\/S\d+$/u.test(source.id) ? source.id : null,
        issns: [...new Set(issns)], source_type: cleanText(source?.type, 100).toLowerCase() || null },
      citations: Number.isSafeInteger(raw.cited_by_count) && raw.cited_by_count >= 0
        ? { count: raw.cited_by_count, provider: "openalex", retrieved_at: retrievedAt } : null,
    },
    retraction: { state, source_url: state === "unknown" ? null : `https://openalex.org/${work.paperId}`,
      checked_at: state === "unknown" ? null : retrievedAt },
  }
}

export async function searchOpenAlexDiscoveryPage({ batch_id, query_id, now = () => new Date().toISOString(),
  idFactory = () => crypto.randomUUID(), ...options } = {}) {
  const retrievedAt = typeof now === "function" ? now() : now
  if (typeof idFactory !== "function") throw new TypeError("缺少记录 ID 工厂")
  const { rawWorks, page } = await readSearchPage(options)
  const records = rawWorks.map((raw, index) => normalizeDiscoveryRecord({
    record_id: idFactory(), provider_id: page.works[index].paperId,
    ...richMetadata(raw, page.works[index], retrievedAt),
    provenance: { provider: "openalex", method: "api", batch_id, query_id, import_id: null,
      retrieved_at: retrievedAt, public_url: `https://openalex.org/${page.works[index].paperId}`, verification: "api" },
  }))
  if (new Set(records.map(record => record.record_id)).size !== records.length) throw new TypeError("记录 ID 重复")
  return { records, works: page.works, total: page.total, nextCursor: page.nextCursor }
}

const verifiedWorks = new WeakMap()

export async function fetchOpenAlexWorkByDoi({ doi, fetchImpl = fetch, signal } = {}) {
  const normalizedDoi = normalizeDoi(doi)
  if (!normalizedDoi || typeof fetchImpl !== "function") throw searchError("request_failed", "DOI 核验参数无效")
  const url = new URL(`${OPENALEX_WORKS_ENDPOINT}/doi:${encodeURIComponent(normalizedDoi)}`)
  url.searchParams.set("select", SELECT_FIELDS.join(","))
  const raw = await fetchOpenAlexPayload({ url: url.href, fetchImpl, signal, singleton: true })
  const work = normalizeWork(raw)
  if (!work) throw searchError("invalid_response", "OpenAlex 返回的论文记录无效")
  if (work.doi !== normalizedDoi) throw searchError("doi_mismatch", "返回记录的 DOI 与原 DOI 不符")
  const token = Object.freeze({})
  const metadata = richMetadata(raw, work, new Date().toISOString())
  // Validate the same bibliography contract used by discovery records before branding.
  const record = normalizeDiscoveryRecord({ record_id: "verification", provider_id: work.paperId, ...metadata,
    provenance: { provider: "openalex", method: "api", batch_id: "verification", query_id: null, import_id: null,
      retrieved_at: new Date().toISOString(), public_url: `https://openalex.org/${work.paperId}`, verification: "api" },
  })
  verifiedWorks.set(token, structuredClone({ work, bibliography: record.bibliography, retraction: record.retraction }))
  return token
}

export function readVerifiedOpenAlexWork(token) {
  if (!verifiedWorks.has(token)) throw new TypeError("缺少真实 OpenAlex 核验凭据")
  return structuredClone(verifiedWorks.get(token))
}
