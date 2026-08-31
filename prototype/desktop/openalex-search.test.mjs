import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenAlexSearchUrl, searchOpenAlexWorks } from "./openalex-search.mjs"

const SENSITIVE_MARKER = ["sensitive", "marker"].join("-")
const BLOCKED_QUERY_KEY = ["api", "key"].join("_")

function credentialQueryUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.searchParams.set(keyParts.join("_"), SENSITIVE_MARKER)
  return url.href
}

function userInfoUrl(path = "/work") {
  const url = new URL(`https://example.org${path}`)
  url.username = "reader"
  url.password = SENSITIVE_MARKER
  return url.href
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

async function rejectsWithCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof Error, true)
    assert.equal(error.code, code)
    return true
  })
}

test("buildOpenAlexSearchUrl fixes the endpoint and requests at most ten recent English works", () => {
  const url = new URL(buildOpenAlexSearchUrl({
    query: '"distributed optimization" AND privacy',
    currentYear: 2026,
    perPage: 50,
  }))

  assert.equal(url.origin + url.pathname, "https://api.openalex.org/works")
  assert.equal(url.searchParams.get("search"), '"distributed optimization" AND privacy')
  assert.equal(
    url.searchParams.get("filter"),
    "from_publication_date:2022-01-01,to_publication_date:2026-12-31,language:en,is_retracted:false",
  )
  assert.equal(url.searchParams.get("sort"), "relevance_score:desc")
  assert.equal(url.searchParams.get("per_page"), "10")
  assert.equal(
    url.searchParams.get("select"),
    [
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
    ].join(","),
  )
  assert.equal(url.searchParams.has(BLOCKED_QUERY_KEY), false)
  assert.equal(url.username, "")
  assert.equal(url.password, "")
})

test("uses the final validated English expression exactly and supports only three visible sorts", () => {
  const query = "privacy  AND  distributed optimization"
  const expected = new Map([
    ["relevance", "relevance_score:desc"],
    ["newest", "publication_date:desc"],
    ["citations", "cited_by_count:desc"],
  ])
  for (const [sort, parameter] of expected) {
    const url = new URL(buildOpenAlexSearchUrl({ query, sort }))
    assert.equal(url.searchParams.get("search"), query)
    assert.equal(url.searchParams.get("sort"), parameter)
  }
  for (const sort of ["oldest", "quality", "", null]) {
    assert.throws(
      () => buildOpenAlexSearchUrl({ query, sort }),
      (error) => error instanceof Error && error.code === "request_failed",
    )
  }
})

test("rejects blank or malformed request values without accepting endpoint or key overrides", () => {
  for (const options of [
    { query: "  " },
    { query: "line\nbreak" },
    { query: "x".repeat(1_001) },
    { query: "x", currentYear: 999 },
    { query: "x", currentYear: "2026" },
    { query: "x", perPage: 0 },
    { query: "x", perPage: -1 },
    { query: "x", perPage: 1.5 },
    { query: "x", perPage: "10" },
    { query: "x", perPage: Number.NaN },
    { query: "x", perPage: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => buildOpenAlexSearchUrl(options),
      (error) => error instanceof Error && error.code === "request_failed",
    )
  }

  const url = new URL(buildOpenAlexSearchUrl({
    query: "consensus",
    baseUrl: "https://attacker.invalid",
    [["api", "Key"].join("")]: SENSITIVE_MARKER,
  }))
  assert.equal(url.origin + url.pathname, "https://api.openalex.org/works")
  assert.equal(url.searchParams.has(BLOCKED_QUERY_KEY), false)
})

test("searchOpenAlexWorks sends a privacy-limited GET and normalizes a real work envelope", async () => {
  const abortController = new AbortController()
  let request = null
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return jsonResponse({
      meta: { count: 127, cost_usd: 0.0001 },
      results: [{
        id: "https://openalex.org/W1234567890",
        doi: "https://doi.org/10.1109/5.771073",
        title: "  Time-varying distributed optimization  ",
        authorships: [
          { author: { id: "https://openalex.org/A1", display_name: " Alice Zhang " } },
          { author: { id: "https://openalex.org/A2", display_name: "Bo Li" } },
        ],
        publication_year: 2025,
        primary_location: {
          landing_page_url: "https://doi.org/10.1109/5.771073",
          source: { id: "https://openalex.org/S1", display_name: " IEEE TAC " },
        },
        cited_by_count: 37,
        open_access: {
          is_oa: true,
          oa_url: "https://repository.example.edu/work/123",
        },
        best_oa_location: {
          landing_page_url: "https://repository.example.edu/work/123",
          pdf_url: "https://repository.example.edu/work/123.pdf",
        },
        topics: [
          { id: "https://openalex.org/T1", display_name: "Distributed Optimization", score: 0.99 },
          { id: "https://openalex.org/T2", display_name: "Directed Networks", score: 0.88 },
        ],
        abstract_inverted_index: {
          This: [0],
          abstract: [3],
          is: [1],
          grounded: [2],
        },
      }],
    })
  }

  const result = await searchOpenAlexWorks({
    query: "distributed optimization",
    fetchImpl,
    signal: abortController.signal,
    currentYear: 2026,
  })

  assert.equal(request.url, buildOpenAlexSearchUrl({ query: "distributed optimization", currentYear: 2026 }))
  assert.deepEqual(request.options, {
    method: "GET",
    signal: abortController.signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: { Accept: "application/json" },
  })
  assert.deepEqual(result, {
    total: 127,
    costUsd: 0.0001,
    query: "distributed optimization",
    sort: "relevance",
    sortBasis: "OpenAlex 综合相关度",
    emptyMessage: null,
    works: [{
      paperId: "W1234567890",
      doi: "10.1109/5.771073",
      title: "Time-varying distributed optimization",
      authors: ["Alice Zhang", "Bo Li"],
      year: 2025,
      source: "IEEE TAC",
      citations: 37,
      isOpenAccess: true,
      openAccessUrl: "https://repository.example.edu/work/123",
      landingPageUrl: "https://doi.org/10.1109/5.771073",
      topics: ["Distributed Optimization", "Directed Networks"],
      abstract: "This is grounded abstract",
    }],
  })
})

test("searchOpenAlexWorks exposes the active newest and cited-count bases", async () => {
  for (const [sort, sortBasis, parameter] of [
    ["newest", "出版时间（新到旧）", "publication_date:desc"],
    ["citations", "OpenAlex 引用次数（高到低）", "cited_by_count:desc"],
  ]) {
    let requestedUrl = null
    const result = await searchOpenAlexWorks({
      query: "distributed optimization",
      sort,
      fetchImpl: async (url) => {
        requestedUrl = new URL(url)
        return jsonResponse({ meta: { count: 0 }, results: [] })
      },
    })
    assert.equal(requestedUrl.searchParams.get("sort"), parameter)
    assert.equal(result.sort, sort)
    assert.equal(result.sortBasis, sortBasis)
  }
})

test("searchOpenAlexWorks represents missing or unsafe optional metadata conservatively", async () => {
  const result = await searchOpenAlexWorks({
    query: "constrained optimization",
    fetchImpl: async () => jsonResponse({
      meta: { count: 1 },
      results: [{
        id: "https://openalex.org/W9",
        doi: "javascript:alert(1)",
        title: "\u0000   ",
        authorships: [{ author: { display_name: null } }, null],
        publication_year: "2025",
        primary_location: {
          landing_page_url: "http://insecure.example/work",
          source: { display_name: "" },
        },
        cited_by_count: -8,
        open_access: { is_oa: "true", oa_url: "javascript:alert(1)" },
        best_oa_location: { landing_page_url: userInfoUrl() },
        topics: [{ display_name: "" }, null],
        abstract_inverted_index: { unsafe: ["zero"] },
      }],
    }),
  })

  assert.deepEqual(result.works, [{
    paperId: "W9",
    doi: null,
    title: "Not Reported",
    authors: [],
    year: null,
    source: "Not Reported",
    citations: 0,
    isOpenAccess: false,
    openAccessUrl: null,
    landingPageUrl: "https://openalex.org/W9",
    topics: [],
    abstract: null,
  }])
})

test("searchOpenAlexWorks never accepts traversal or double-separator DOI identities", async () => {
  for (const doi of ["10.1234/../../admin", "doi:10.1234/../x", "10.1234//admin"]) {
    const result = await searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({
        meta: { count: 1 },
        results: [{
          id: "https://openalex.org/W9",
          doi,
          title: "Safe title",
          authorships: [],
          publication_year: 2026,
          primary_location: { landing_page_url: null, source: { display_name: "Source" } },
          cited_by_count: 0,
          open_access: { is_oa: false, oa_url: null },
          best_oa_location: null,
          topics: [],
          abstract_inverted_index: null,
        }],
      }),
    })
    assert.equal(result.works[0].doi, null)
    assert.equal(result.works[0].landingPageUrl, "https://openalex.org/W9")
  }
})

test("searchOpenAlexWorks never exposes private, credential-like, or token-bearing result links", async () => {
  for (const unsafeUrl of [
    "https://localhost/paper",
    "https://service.local/paper",
    "https://127.0.0.1/paper",
    "https://2130706433/paper",
    "https://10.0.0.8/paper",
    "https://169.254.169.254/paper",
    "https://[::1]/paper",
    "https://intranet/paper",
    credentialQueryUrl(["access", "token"]),
    credentialQueryUrl(["api", "key"]),
    credentialQueryUrl(["x-api", "key"]),
  ]) {
    const result = await searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({
        meta: { count: 1 },
        results: [{
          id: "https://openalex.org/W9",
          doi: null,
          title: "Safe title",
          authorships: [],
          publication_year: 2026,
          primary_location: { landing_page_url: unsafeUrl, source: { display_name: "Source" } },
          cited_by_count: 0,
          open_access: { is_oa: true, oa_url: unsafeUrl },
          best_oa_location: { landing_page_url: unsafeUrl, pdf_url: unsafeUrl },
          topics: [],
          abstract_inverted_index: null,
        }],
      }),
    })
    assert.equal(result.works[0].openAccessUrl, null)
    assert.equal(result.works[0].landingPageUrl, "https://openalex.org/W9")
    assert.equal(JSON.stringify(result).includes(SENSITIVE_MARKER), false)
  }
})

test("searchOpenAlexWorks rejects abusive nested work fields instead of truncating attacker payloads", async () => {
  const baseWork = {
    id: "https://openalex.org/W9",
    doi: null,
    title: "Safe title",
    authorships: [],
    publication_year: 2026,
    primary_location: { landing_page_url: "https://example.org/paper", source: { display_name: "Source" } },
    cited_by_count: 0,
    open_access: { is_oa: false, oa_url: null },
    best_oa_location: null,
    topics: [],
    abstract_inverted_index: null,
  }
  const invalidWorks = [
    { ...baseWork, title: "x".repeat(1_001) },
    { ...baseWork, authorships: Array.from({ length: 51 }, () => ({ author: { display_name: "A" } })) },
    { ...baseWork, topics: Array.from({ length: 21 }, () => ({ display_name: "T" })) },
    { ...baseWork, abstract_inverted_index: { word: [20_001] } },
    { ...baseWork, abstract_inverted_index: { ["x".repeat(301)]: [0] } },
  ]
  for (const work of invalidWorks) {
    await rejectsWithCode(searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({ meta: { count: 1 }, results: [work] }),
    }), "invalid_response")
  }
})

test("searchOpenAlexWorks returns a bounded empty result without claiming the direction is absent", async () => {
  const query = "no matching paper"
  const result = await searchOpenAlexWorks({
    query,
    fetchImpl: async () => jsonResponse({ meta: { count: 0, cost_usd: 0 }, results: [] }),
  })
  assert.deepEqual(result, {
    total: 0,
    works: [],
    costUsd: 0,
    query,
    sort: "relevance",
    sortBasis: "OpenAlex 综合相关度",
    emptyMessage: "当前英文检索式未返回结果。",
  })
  assert.doesNotMatch(result.emptyMessage, /方向不存在|论文不存在|没有该方向/u)
})

test("searchOpenAlexWorks exposes rate limits and other HTTP failures with stable codes", async () => {
  await rejectsWithCode(
    searchOpenAlexWorks({ query: "test", fetchImpl: async () => jsonResponse({}, 429) }),
    "rate_limited",
  )
  await rejectsWithCode(
    searchOpenAlexWorks({ query: "test", fetchImpl: async () => jsonResponse({}, 503) }),
    "request_failed",
  )
})

test("searchOpenAlexWorks distinguishes network errors from invalid JSON envelopes", async () => {
  await rejectsWithCode(
    searchOpenAlexWorks({ query: "test", fetchImpl: async () => { throw new TypeError("offline") } }),
    "network",
  )
  await rejectsWithCode(
    searchOpenAlexWorks({
      query: "test",
      fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError("bad json") } }),
    }),
    "invalid_response",
  )
  for (const payload of [
    { meta: { count: 1 }, results: "not-an-array" },
    { meta: { count: -1 }, results: [] },
    { meta: {}, results: [] },
    { meta: { count: 9_007_199_254_740_991 }, results: [] },
    { meta: { count: 5 }, results: [] },
    { meta: { count: 1 }, results: [{ id: "malformed" }] },
  ]) {
    await rejectsWithCode(
      searchOpenAlexWorks({ query: "test", fetchImpl: async () => jsonResponse(payload) }),
      "invalid_response",
    )
  }
})

test("searchOpenAlexWorks preserves AbortError so callers can treat cancellation as cancellation", async () => {
  const abortError = new Error("aborted")
  abortError.name = "AbortError"

  await assert.rejects(
    searchOpenAlexWorks({ query: "test", fetchImpl: async () => { throw abortError } }),
    (error) => error === abortError,
  )
})
