const OPENALEX_WORKS_ENDPOINT = "https://api.openalex.org/works"
const MAX_QUERY_CHARACTERS = 1_000
const MAX_TOTAL = 100_000_000

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
]

const SORTS = Object.freeze({
  relevance: Object.freeze({ parameter: "relevance_score:desc", basis: "OpenAlex 综合相关度" }),
  newest: Object.freeze({ parameter: "publication_date:desc", basis: "出版时间（新到旧）" }),
  citations: Object.freeze({ parameter: "cited_by_count:desc", basis: "OpenAlex 引用次数（高到低）" }),
})

const CREDENTIAL_QUERY_KEYS = new Set([
  ["access", "token"].join(""), ["api", "key"].join(""), ["auth", "token"].join(""),
  ["authori", "zation"].join(""), ["bearer", "token"].join(""), ["xapi", "key"].join(""),
  ["client", "secret"].join(""), ["coo", "kie"].join(""), ["creden", "tials"].join(""),
  ["pass", "word"].join(""), ["private", "key"].join(""), ["refresh", "token"].join(""),
  ["sec", "ret"].join(""), ["secret", "key"].join(""), "session",
  ["session", "id"].join(""), ["to", "ken"].join(""),
])

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

function cleanText(value, maximum = 20_000) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum)
}

function rawPathHasDotSegment(value) {
  const match = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/iu)
  if (!match?.[1]) return false
  return match[1].split("/").some((segment) => {
    if (segment === "." || segment === "..") return true
    try {
      return decodeURIComponent(segment).split("/").some((part) => part === "." || part === "..")
    } catch {
      return true
    }
  })
}

function normalizedQueryKey(value) {
  return value.toLowerCase().replace(/[\s_.-]/gu, "")
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((part) => part > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19))
}

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "")
  if (
    !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".home.arpa") || !host.includes(".")
  ) return false
  if (host.includes(":")) return false
  return !isPrivateIpv4(host)
}

function safeHttpsUrl(value) {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text || text.length > 2_048 || rawPathHasDotSegment(text)) return null
  try {
    const url = new URL(text)
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !isPublicHostname(url.hostname)
    ) return null
    for (const key of url.searchParams.keys()) {
      if (CREDENTIAL_QUERY_KEYS.has(normalizedQueryKey(key))) return null
    }
    return url.href
  } catch {
    return null
  }
}

function normalizePaperId(value) {
  const match = cleanText(value, 100).match(/^https:\/\/openalex\.org\/(W\d+)\/?$/iu)
  return match ? match[1].toUpperCase() : null
}

function normalizeDoi(value) {
  let doi = cleanText(value, 512)
  if (!doi) return null
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").replace(/^doi:\s*/iu, "").toLowerCase()
  if (!/^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u.test(doi) || doi.includes("//")) return null
  const suffix = doi.slice(doi.indexOf("/") + 1)
  return suffix.split("/").some((part) => part === "." || part === "..") ? null : doi
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
  if (typeof work.title === "string" && [...work.title].length > 1_000) return true
  if (Array.isArray(work.authorships) && work.authorships.length > 50) return true
  if (Array.isArray(work.topics) && work.topics.length > 20) return true
  const index = work.abstract_inverted_index
  if (index === null || index === undefined) return false
  if (typeof index !== "object" || Array.isArray(index)) return true
  let positions = 0
  for (const [word, values] of Object.entries(index)) {
    if ([...word].length > 300) return true
    if (!Array.isArray(values)) continue
    for (const position of values) {
      if (!Number.isInteger(position)) continue
      if (position < 0 || position > 10_000) return true
      positions += 1
      if (positions > 5_000) return true
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
  currentYear = 2026,
  perPage = 10,
  sort = "relevance",
} = {}) {
  const normalizedQuery = normalizeQuery(query)
  if (!Number.isInteger(currentYear) || currentYear < 1000 || currentYear > 9999) {
    throw searchError("request_failed", "检索年份无效")
  }
  if (!Number.isInteger(perPage) || perPage < 1) {
    throw searchError("request_failed", "检索数量无效")
  }
  if (!Object.hasOwn(SORTS, sort)) throw searchError("request_failed", "检索排序方式无效")

  const url = new URL(OPENALEX_WORKS_ENDPOINT)
  url.searchParams.set("search", normalizedQuery)
  url.searchParams.set(
    "filter",
    `from_publication_date:${currentYear - 4}-01-01,to_publication_date:${currentYear}-12-31,language:en,is_retracted:false`,
  )
  url.searchParams.set("sort", SORTS[sort].parameter)
  url.searchParams.set("per_page", String(Math.min(10, perPage)))
  url.searchParams.set("select", SELECT_FIELDS.join(","))
  return url.toString()
}

export async function searchOpenAlexWorks({
  query,
  fetchImpl = fetch,
  signal,
  currentYear = 2026,
  perPage = 10,
  sort = "relevance",
} = {}) {
  if (typeof fetchImpl !== "function") throw searchError("request_failed", "检索请求函数无效")
  const normalizedQuery = normalizeQuery(query)
  const url = buildOpenAlexSearchUrl({ query: normalizedQuery, currentYear, perPage, sort })

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
    throw searchError("network", "无法连接 OpenAlex", { cause: error })
  }

  if (!response || typeof response.ok !== "boolean" || !Number.isInteger(response.status)) {
    throw searchError("invalid_response", "OpenAlex 返回了无效响应")
  }
  if (response.status === 429) throw searchError("rate_limited", "OpenAlex 暂时限流", { status: 429 })
  if (!response.ok) throw searchError("request_failed", "OpenAlex 检索失败", { status: response.status })

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw searchError("invalid_response", "OpenAlex 返回的 JSON 无法解析", { cause: error })
  }
  if (
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    !payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta) ||
    !Array.isArray(payload.results) || payload.results.length > 10 ||
    !Number.isSafeInteger(payload.meta.count) || payload.meta.count < 0 || payload.meta.count > MAX_TOTAL ||
    payload.meta.count < payload.results.length || (payload.meta.count > 0 && payload.results.length === 0)
  ) {
    throw searchError("invalid_response", "OpenAlex 返回的数据结构无效")
  }

  const works = payload.results.map(normalizeWork)
  if (works.some((work) => work === null)) {
    throw searchError("invalid_response", "OpenAlex 返回的论文记录无效")
  }
  const rawCost = payload.meta.cost_usd
  if (rawCost !== undefined && (typeof rawCost !== "number" || !Number.isFinite(rawCost) || rawCost < 0 || rawCost > 1)) {
    throw searchError("invalid_response", "OpenAlex 返回的计费信息无效")
  }
  return {
    total: payload.meta.count,
    works,
    costUsd: rawCost ?? 0,
    query: normalizedQuery,
    sort,
    sortBasis: SORTS[sort].basis,
    emptyMessage: works.length === 0 ? "当前英文检索式未返回结果。" : null,
  }
}
