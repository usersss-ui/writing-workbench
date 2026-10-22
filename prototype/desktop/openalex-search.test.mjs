import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenAlexSearchUrl, searchOpenAlexWorks } from "./openalex-search.mjs"
import * as openAlex from "./openalex-search.mjs"
import { isValidDiscoveryRecord } from "./discovery-record.mjs"

const SENSITIVE_MARKER = ["sensitive", "marker"].join("-")
const BLOCKED_QUERY_KEY = ["api", "key"].join("_")

function credentialQueryUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.searchParams.set(keyParts.join("_"), SENSITIVE_MARKER)
  return url.href
}

function obfuscatedCredentialQueryUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.searchParams.set(keyParts.join(""), SENSITIVE_MARKER)
  return url.href
}

function repeatedlyEncodedCredentialQueryUrl(keyParts, passes, path = "/paper") {
  let key = keyParts.join("")
  for (let index = 0; index < passes; index += 1) key = encodeURIComponent(key)
  return `https://public.example${path}?${key}=${encodeURIComponent(SENSITIVE_MARKER)}`
}

function credentialFragmentUrl(keyParts, path = "/paper") {
  const url = new URL(`https://public.example${path}`)
  url.hash = `${keyParts.join("_")}=${SENSITIVE_MARKER}`
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

test("buildOpenAlexSearchUrl defaults to 25 works with no hidden year or language limits", () => {
  const url = new URL(buildOpenAlexSearchUrl({
    query: '"distributed optimization" AND privacy',
  }))

  assert.equal(url.origin + url.pathname, "https://api.openalex.org/works")
  assert.equal(url.searchParams.get("search"), '"distributed optimization" AND privacy')
  assert.equal(
    url.searchParams.get("filter"),
    "is_retracted:false",
  )
  assert.equal(url.searchParams.get("sort"), "relevance_score:desc")
  assert.equal(url.searchParams.get("per_page"), "25")
  assert.equal(url.searchParams.get("cursor"), "*")
  assert.equal(url.searchParams.has("page"), false)
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
      "language",
      "type",
      "is_retracted",
    ].join(","),
  )
  assert.equal(url.searchParams.has(BLOCKED_QUERY_KEY), false)
  assert.equal(url.username, "")
  assert.equal(url.password, "")
})

const DISCOVERY_NOW = "2026-09-05T08:00:00.000Z"
function richWork(overrides = {}) {
  return {
    id: "https://openalex.org/W123", doi: "https://doi.org/10.1234/example",
    title: "Distributed optimization", publication_year: 2025,
    authorships: [{ author: { display_name: " Alice " } }, { author: { display_name: "Alice" } }],
    primary_location: { landing_page_url: "https://publisher.example/paper", source: {
      id: "https://openalex.org/S123", display_name: "Control Journal", type: "journal",
      issn: ["1234-567X"], issn_l: "2345-6789",
    } }, language: "en", type: "article", is_retracted: false,
    ...overrides,
  }
}

test("discovery page produces rich records and compatible works from one bounded request", async () => {
  assert.equal(typeof openAlex.searchOpenAlexDiscoveryPage, "function")
  let requests = 0
  const page = await openAlex.searchOpenAlexDiscoveryPage({
    query: "optimization", batch_id: "batch-1", query_id: "query-1", now: () => DISCOVERY_NOW,
    idFactory: () => "record-1", fetchImpl: async () => {
      requests += 1
      return jsonResponse({ meta: { count: 1, next_cursor: null }, results: [richWork()] })
    },
  })
  assert.equal(requests, 1)
  assert.deepEqual(Object.keys(page).sort(), ["nextCursor", "records", "total", "works"])
  assert.equal(page.total, 1)
  assert.equal(page.nextCursor, null)
  assert.equal(isValidDiscoveryRecord(page.records[0]), true)
  assert.deepEqual(page.records[0], {
    record_id: "record-1", provider_id: "W123",
    bibliography: { title: "Distributed optimization", authors: ["Alice", "Alice"], year: 2025,
      doi: "10.1234/example", url: "https://publisher.example/paper", abstract: null,
      language: "en", work_type: "article", journal: { title: "Control Journal",
        source_id: "https://openalex.org/S123", issns: ["1234-567X", "2345-6789"], source_type: "journal" }, citations: null },
    provenance: { provider: "openalex", method: "api", batch_id: "batch-1", query_id: "query-1",
      import_id: null, retrieved_at: DISCOVERY_NOW, public_url: "https://openalex.org/W123", verification: "api" },
    retraction: { state: "screened_clear", source_url: "https://openalex.org/W123", checked_at: DISCOVERY_NOW },
  })
  assert.deepEqual(page.works[0].authors, ["Alice"])
  assert.equal(page.works[0].citations, 0)
  assert.deepEqual(Object.keys(page.works[0]).sort(), ["abstract", "authors", "citations", "doi", "isOpenAccess", "landingPageUrl", "openAccessUrl", "paperId", "source", "title", "topics", "year"])
})

test("rich records preserve unknown source, scope and retraction and known zero citations", async () => {
  assert.equal(typeof openAlex.searchOpenAlexDiscoveryPage, "function")
  const page = await openAlex.searchOpenAlexDiscoveryPage({ query: "x", batch_id: "b", query_id: "q",
    now: () => DISCOVERY_NOW, idFactory: () => "r",
    fetchImpl: async () => jsonResponse({ meta: { count: 1, next_cursor: null }, results: [richWork({
      primary_location: null, language: null, type: null, is_retracted: null, cited_by_count: 0,
    })] }),
  })
  assert.deepEqual(page.records[0].bibliography.journal, { title: null, source_id: null, issns: [], source_type: null })
  assert.equal(page.records[0].bibliography.language, null)
  assert.equal(page.records[0].bibliography.work_type, null)
  assert.deepEqual(page.records[0].bibliography.citations, { count: 0, provider: "openalex", retrieved_at: DISCOVERY_NOW })
  assert.deepEqual(page.records[0].retraction, { state: "unknown", source_url: null, checked_at: null })
})

test("verified DOI lookup uses official endpoint and uncopyable defensive capability", async () => {
  assert.equal(typeof openAlex.fetchOpenAlexWorkByDoi, "function")
  assert.equal(typeof openAlex.readVerifiedOpenAlexWork, "function")
  const signal = new AbortController().signal
  const token = await openAlex.fetchOpenAlexWorkByDoi({ doi: "https://doi.org/10.1234/EXAMPLE", signal,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      assert.equal(parsed.origin + decodeURIComponent(parsed.pathname), "https://api.openalex.org/works/doi:10.1234/example")
      assert.equal(options.redirect, "error")
      assert.equal(options.credentials, "omit")
      assert.equal(options.referrerPolicy, "no-referrer")
      assert.equal(options.signal, signal)
      return jsonResponse(richWork({ open_access: { is_oa: true, oa_url: "https://127.0.0.1/file" } }))
    },
  })
  assert.equal(Object.isFrozen(token), true)
  const data = openAlex.readVerifiedOpenAlexWork(token)
  assert.equal(data.work.paperId, "W123")
  assert.equal(data.work.openAccessUrl, null)
  assert.deepEqual(data.bibliography.authors, ["Alice", "Alice"])
  data.work.title = "forged"
  data.bibliography.authors.push("forged")
  assert.equal(openAlex.readVerifiedOpenAlexWork(token).work.title, "Distributed optimization")
  assert.deepEqual(openAlex.readVerifiedOpenAlexWork(token).bibliography.authors, ["Alice", "Alice"])
  for (const forged of [{}, { paperId: "W123", verified: true }, { verification: "api" }, { ...token }, JSON.parse(JSON.stringify(token)), structuredClone(token), null]) {
    assert.throws(() => openAlex.readVerifiedOpenAlexWork(forged), TypeError)
  }
})

test("DOI lookup rejects invalid identity, mismatching DOI and bounded nested payloads", async () => {
  assert.equal(typeof openAlex.fetchOpenAlexWorkByDoi, "function")
  let requests = 0
  await rejectsWithCode(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "https://attacker.example/W123", fetchImpl: async () => { requests += 1 } }), "request_failed")
  assert.equal(requests, 0)
  for (const [body, code] of [
    [richWork({ doi: null }), "doi_mismatch"], [richWork({ doi: "10.1234/other" }), "doi_mismatch"],
    [richWork({ id: "W123" }), "invalid_response"], [richWork({ id: "https://attacker.example/W123" }), "invalid_response"],
    [richWork({ title: "x".repeat(1001) }), "invalid_response"],
    [richWork({ authorships: Array(51).fill({}) }), "invalid_response"],
    [richWork({ abstract_inverted_index: { x: Array(5001).fill(1) } }), "invalid_response"],
    [richWork({ primary_location: { source: { issn: Array(11).fill("1234-567X") } } }), "invalid_response"],
    [richWork({ language: "x".repeat(101) }), "invalid_response"],
    [richWork({ unexpected: "x".repeat(2 * 1024 * 1024) }), "invalid_response"],
    [richWork({ unexpected: "汉".repeat(750_000) }), "invalid_response"],
    [richWork({ primary_location: { source: { issn_l: "x".repeat(1000) } } }), "invalid_response"],
  ]) await rejectsWithCode(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "10.1234/example", fetchImpl: async () => jsonResponse(body) }), code)
})

test("DOI lookup preserves aborts and marks only recoverable transport failures retryable", async () => {
  assert.equal(typeof openAlex.fetchOpenAlexWorkByDoi, "function")
  for (const [status, code, retryable] of [[301, "request_failed", false], [404, "unverified", false], [429, "rate_limited", true]]) {
    await assert.rejects(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "10.1234/example", fetchImpl: async () => jsonResponse(null, status) }), error => error.code === code && error.retryable === retryable)
  }
  await assert.rejects(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "10.1234/example", fetchImpl: async () => { throw new Error("offline") } }), error => error.code === "network" && error.retryable === true)
  for (const stage of ["fetch", "json"]) {
    const abort = new DOMException("cancelled", "AbortError")
    await assert.rejects(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "10.1234/example", fetchImpl: async () => {
      if (stage === "fetch") throw abort
      return { ok: true, status: 200, json: async () => { throw abort } }
    } }), error => error === abort)
  }
})

test("DOI lookup refuses a redirect response even when it reports success", async () => {
  await rejectsWithCode(() => openAlex.fetchOpenAlexWorkByDoi({ doi: "10.1234/example",
    fetchImpl: async () => ({ ...jsonResponse(richWork()), redirected: true }),
  }), "request_failed")
})

test("uses the validated expression exactly and supports only three visible sorts", () => {
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

test("buildOpenAlexSearchUrl applies only explicitly selected year and language filters", () => {
  for (const [options, filter] of [
    [{ startYear: 2001, endYear: 2026, language: "en" }, "from_publication_date:2001-01-01,to_publication_date:2026-12-31,language:en,is_retracted:false"],
    [{ startYear: 2020, language: "zh" }, "from_publication_date:2020-01-01,language:zh,is_retracted:false"],
    [{ endYear: 2010 }, "to_publication_date:2010-12-31,is_retracted:false"],
    [{ startYear: 2000, endYear: 2000 }, "from_publication_date:2000-01-01,to_publication_date:2000-12-31,is_retracted:false"],
    [{ startYear: null, endYear: null, language: "all" }, "is_retracted:false"],
  ]) {
    const url = new URL(buildOpenAlexSearchUrl({ query: "分布式优化", ...options }))
    assert.equal(url.searchParams.get("search"), "分布式优化")
    assert.equal(url.searchParams.get("filter"), filter)
  }
})

test("buildOpenAlexSearchUrl preserves the opaque cursor and explicit page sizes up to 50", () => {
  const cursor = "Ils+/=_opaque-cursor"
  for (const perPage of [1, 10, 25, 50]) {
    const url = new URL(buildOpenAlexSearchUrl({ query: "privacy", cursor, perPage }))
    assert.equal(url.searchParams.get("per_page"), String(perPage))
    assert.equal(url.searchParams.get("cursor"), cursor)
  }
})

test("buildOpenAlexSearchUrl encodes the cursor as one value without accepting parameter injection", () => {
  const cursor = `next&filter=language:en#fragment?${BLOCKED_QUERY_KEY}=${SENSITIVE_MARKER}`
  const url = new URL(buildOpenAlexSearchUrl({ query: "privacy", language: "zh", cursor }))
  assert.equal(url.searchParams.get("cursor"), cursor)
  assert.deepEqual(url.searchParams.getAll("filter"), ["language:zh,is_retracted:false"])
  assert.equal(url.searchParams.has(BLOCKED_QUERY_KEY), false)
  assert.equal(url.hash, "")
  assert.equal(url.origin + url.pathname, "https://api.openalex.org/works")
})

test("rejects blank or malformed request values without accepting endpoint or key overrides", () => {
  for (const options of [
    { query: "  " },
    { query: "line\nbreak" },
    { query: "x".repeat(1_001) },
    ...["startYear", "endYear"].flatMap((key) => [999, 10_000, "2026", 2020.5, "", Number.NaN, Number.POSITIVE_INFINITY]
      .map((value) => ({ query: "x", [key]: value }))),
    { query: "x", startYear: 2026, endYear: 2020 },
    ...["", "english", "EN", "fr", null, 1].map((language) => ({ query: "x", language })),
    ...["", " ", "a b", "a\nb", "a\u007fb", "a\u2028b", "x".repeat(2_049), null, 1, {}]
      .map((cursor) => ({ query: "x", cursor })),
    { query: "x", perPage: 0 },
    { query: "x", perPage: -1 },
    { query: "x", perPage: 1.5 },
    { query: "x", perPage: "10" },
    { query: "x", perPage: Number.NaN },
    { query: "x", perPage: Number.POSITIVE_INFINITY },
    { query: "x", perPage: 51 },
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
      meta: { count: 127, cost_usd: 0.0001, next_cursor: "next-page" },
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
    startYear: 2010,
    endYear: 2025,
    language: "en",
    perPage: 50,
    cursor: "previous-page",
  })

  assert.equal(request.url, buildOpenAlexSearchUrl({
    query: "distributed optimization", startYear: 2010, endYear: 2025, language: "en", perPage: 50, cursor: "previous-page",
  }))
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
    nextCursor: "next-page",
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
        return jsonResponse({ meta: { count: 0, next_cursor: null }, results: [] })
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
      meta: { count: 1, next_cursor: null },
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
  for (const doi of [
    "10.1234/../../admin", "doi:10.1234/../x", "10.1234//admin",
    ["https://doi.org/10.1234/a", "..", "b"].join("\\"),
    "https://doi.org/10.1234/a\n",
  ]) {
    const result = await searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({
        meta: { count: 1, next_cursor: null },
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
    "https://exa\nmple.org/paper",
    "https://example.org/pa\tper",
    "https://\texample.org/paper",
    "https://example.org/pa\u2028per",
    credentialQueryUrl(["access", "token"]),
    credentialQueryUrl(["api", "key"]),
    credentialQueryUrl(["x-api", "key"]),
    credentialFragmentUrl(["access", "token"]),
    obfuscatedCredentialQueryUrl(["oauth", "_", "token"]),
    obfuscatedCredentialQueryUrl(["token", "[", "]"]),
    obfuscatedCredentialQueryUrl(["api", "[", "key", "]"]),
    obfuscatedCredentialQueryUrl(["api", "key", "[", "]"]),
    obfuscatedCredentialQueryUrl(["oauth", "2_", "token"]),
    obfuscatedCredentialQueryUrl(["my", "_", "token"]),
    obfuscatedCredentialQueryUrl(["service", "_", "api", "_", "key"]),
    obfuscatedCredentialQueryUrl(["x", "-", "amz", "-", "signa", "ture"]),
    obfuscatedCredentialQueryUrl(["j", "wt"]),
  ]) {
    const result = await searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({
        meta: { count: 1, next_cursor: null },
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

test("searchOpenAlexWorks removes links with repeatedly encoded credential keys", async () => {
  for (const unsafeUrl of [
    repeatedlyEncodedCredentialQueryUrl(["api", "[", "key", "]"], 2),
    repeatedlyEncodedCredentialQueryUrl(["api", "_", "key"], 2),
    repeatedlyEncodedCredentialQueryUrl(["access", "_", "token"], 3),
    repeatedlyEncodedCredentialQueryUrl(["bearer", "_", "token"], 8),
  ]) {
    const result = await searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({
        meta: { count: 1, next_cursor: null },
        results: [{
          id: "https://openalex.org/W9",
          doi: null,
          title: "Safe title",
          authorships: [],
          publication_year: 2026,
          primary_location: { landing_page_url: unsafeUrl, source: { display_name: "Source" } },
          cited_by_count: 0,
          open_access: { is_oa: true, oa_url: unsafeUrl },
          best_oa_location: null,
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
    { ...baseWork, id: `${baseWork.id}${" ".repeat(100_000)}` },
    { ...baseWork, doi: `https://doi.org/10.1234/a${" ".repeat(100_000)}` },
    { ...baseWork, title: "x".repeat(1_001) },
    { ...baseWork, authorships: Array.from({ length: 51 }, () => ({ author: { display_name: "A" } })) },
    { ...baseWork, authorships: [{ author: { display_name: "x".repeat(301) } }] },
    { ...baseWork, primary_location: { ...baseWork.primary_location, source: { display_name: "x".repeat(501) } } },
    {
      ...baseWork,
      primary_location: { ...baseWork.primary_location, landing_page_url: `https://example.org/paper${" ".repeat(100_000)}` },
    },
    {
      ...baseWork,
      open_access: { is_oa: true, oa_url: `https://example.org/paper${" ".repeat(100_000)}` },
    },
    {
      ...baseWork,
      open_access: { is_oa: true, oa_url: null },
      best_oa_location: { pdf_url: `https://example.org/paper.pdf${" ".repeat(100_000)}` },
    },
    {
      ...baseWork,
      open_access: { is_oa: true, oa_url: null },
      best_oa_location: { landing_page_url: `https://example.org/paper${" ".repeat(100_000)}` },
    },
    { ...baseWork, topics: Array.from({ length: 21 }, () => ({ display_name: "T" })) },
    { ...baseWork, topics: [{ display_name: "x".repeat(301) }] },
    { ...baseWork, abstract_inverted_index: { word: [20_001] } },
    { ...baseWork, abstract_inverted_index: { ["x".repeat(301)]: [0] } },
    {
      ...baseWork,
      abstract_inverted_index: Object.fromEntries(
        Array.from({ length: 10_001 }, (_, index) => [`word-${index}`, []]),
      ),
    },
    { ...baseWork, abstract_inverted_index: { word: Array.from({ length: 20_000 }, () => "invalid") } },
    { ...baseWork, abstract_inverted_index: { word: ["x".repeat(10_001)] } },
    { ...baseWork, abstract_inverted_index: { word: [1.5] } },
    {
      ...baseWork,
      abstract_inverted_index: {
        first: Array.from({ length: 3_000 }, (_, index) => index),
        second: Array.from({ length: 3_000 }, (_, index) => index + 3_000),
      },
    },
  ]
  for (const work of invalidWorks) {
    await rejectsWithCode(searchOpenAlexWorks({
      query: "privacy",
      fetchImpl: async () => jsonResponse({ meta: { count: 1, next_cursor: null }, results: [work] }),
    }), "invalid_response")
  }
})

test("searchOpenAlexWorks returns a bounded empty result without claiming the direction is absent", async () => {
  const query = "no matching paper"
  const result = await searchOpenAlexWorks({
    query,
    fetchImpl: async () => jsonResponse({ meta: { count: 0, cost_usd: 0, next_cursor: null }, results: [] }),
  })
  assert.deepEqual(result, {
    total: 0,
    nextCursor: null,
    works: [],
    costUsd: 0,
    query,
    sort: "relevance",
    sortBasis: "OpenAlex 综合相关度",
    emptyMessage: "当前检索条件未返回结果。",
  })
  assert.doesNotMatch(result.emptyMessage, /方向不存在|论文不存在|没有该方向/u)
})

test("searchOpenAlexWorks fetches one requested page and preserves scope through cursor paging", async () => {
  const scope = { query: "分布式优化", startYear: 2000, endYear: 2026, language: "zh", sort: "citations", perPage: 25 }
  const cursors = ["*", "cursor+/page-two=", "cursor_last"]
  const pages = [
    { meta: { count: 27, next_cursor: cursors[1] }, results: Array.from({ length: 25 }, (_, i) => ({ id: `https://openalex.org/W${i + 1}` })) },
    { meta: { count: 27, next_cursor: cursors[2] }, results: [{ id: "https://openalex.org/W26" }, { id: "https://openalex.org/W27" }] },
    { meta: { count: 27, next_cursor: null }, results: [] },
  ]
  let calls = 0
  const fetchImpl = async (request) => {
    const url = new URL(request)
    assert.equal(url.searchParams.get("cursor"), cursors[calls])
    assert.equal(url.searchParams.get("search"), scope.query)
    assert.equal(url.searchParams.get("filter"), "from_publication_date:2000-01-01,to_publication_date:2026-12-31,language:zh,is_retracted:false")
    assert.equal(url.searchParams.get("per_page"), "25")
    assert.equal(url.searchParams.get("sort"), "cited_by_count:desc")
    return jsonResponse(pages[calls++])
  }
  let cursor = "*"
  const collected = []
  for (let page = 0; page < 3; page += 1) {
    const result = await searchOpenAlexWorks({ ...scope, cursor, fetchImpl })
    assert.equal(calls, page + 1)
    assert.equal(result.total, 27)
    assert.equal(result.nextCursor, pages[page].meta.next_cursor)
    if (page === 2) assert.equal(result.emptyMessage, "已加载完当前检索条件的结果。")
    collected.push(...result.works)
    cursor = result.nextCursor
  }
  assert.equal(collected.length, 27)
  assert.equal(new Set(collected.map((work) => work.paperId)).size, 27)
  assert.equal(cursor, null)
})

test("searchOpenAlexWorks bounds each response by the requested page size, not ten", async () => {
  for (const perPage of [1, 25, 50]) {
    const results = Array.from({ length: perPage }, (_, i) => ({ id: `https://openalex.org/W${i + 1}` }))
    const result = await searchOpenAlexWorks({
      query: "privacy", perPage,
      fetchImpl: async () => jsonResponse({ meta: { count: perPage, next_cursor: null }, results }),
    })
    assert.equal(result.works.length, perPage)
    await rejectsWithCode(searchOpenAlexWorks({
      query: "privacy", perPage,
      fetchImpl: async () => jsonResponse({
        meta: { count: perPage + 1, next_cursor: "next" },
        results: [...results, { id: `https://openalex.org/W${perPage + 1}` }],
      }),
    }), "invalid_response")
  }
})

test("searchOpenAlexWorks accepts a nonempty final page after earlier results", async () => {
  const result = await searchOpenAlexWorks({
    query: "privacy", cursor: "previous-page",
    fetchImpl: async () => jsonResponse({
      meta: { count: 27, next_cursor: null },
      results: [{ id: "https://openalex.org/W26" }, { id: "https://openalex.org/W27" }],
    }),
  })
  assert.equal(result.total, 27)
  assert.equal(result.works.length, 2)
  assert.equal(result.nextCursor, null)
  assert.equal(result.emptyMessage, null)
})

test("searchOpenAlexWorks rejects missing, malformed, or non-advancing response cursors", async () => {
  for (const nextCursor of [undefined, "", " ", "a b", "a\nb", "a\u007fb", "a\u2028b", "x".repeat(2_049), "*", "previous-page", 1, {}]) {
    await rejectsWithCode(searchOpenAlexWorks({
      query: "privacy", cursor: "previous-page",
      fetchImpl: async () => jsonResponse({
        meta: { count: 2, next_cursor: nextCursor }, results: [{ id: "https://openalex.org/W1" }],
      }),
    }), "invalid_response")
  }
})

test("searchOpenAlexWorks rejects incomplete initial or intermediate pages instead of reporting exhaustion", async () => {
  for (const [cursor, meta, results] of [
    ["*", { count: 5, next_cursor: null }, []],
    ["*", { count: 5, next_cursor: null }, [{ id: "https://openalex.org/W1" }]],
    ["*", { count: 5, next_cursor: "next" }, []],
    ["previous-page", { count: 5, next_cursor: "next" }, []],
    ["*", { count: 0, next_cursor: "next" }, []],
  ]) {
    await rejectsWithCode(searchOpenAlexWorks({
      query: "privacy", cursor, fetchImpl: async () => jsonResponse({ meta, results }),
    }), "invalid_response")
  }
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
    { meta: { count: 1, next_cursor: null }, results: "not-an-array" },
    { meta: { count: -1, next_cursor: null }, results: [] },
    { meta: { next_cursor: null }, results: [] },
    { meta: { count: 9_007_199_254_740_991, next_cursor: null }, results: [] },
    { meta: { count: 5, next_cursor: null }, results: [] },
    { meta: { count: 1, next_cursor: null }, results: [{ id: "malformed" }] },
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
