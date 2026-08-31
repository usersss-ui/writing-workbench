const DOI_PATTERN = /^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u
const OPEN_ACCESS_HOSTS = ["arxiv.org", "export.arxiv.org", "openreview.net", "pmc.ncbi.nlm.nih.gov"]
const DOI_RESOLVER_HOSTS = new Set(["doi.org", "dx.doi.org"])
const SUBSCRIPTION_WARNING = "学校入口不代表目标论文已订购"
const LOCAL_DOCUMENT_SUFFIX = /\.(?:docx?|html?|markdown|md|pdf|rtf|tex|txt)$/iu
const CREDENTIAL_QUERY_KEYS = new Set([
  ["access", "token"].join(""), ["api", "key"].join(""), ["auth", "token"].join(""),
  ["authori", "zation"].join(""), ["bearer", "token"].join(""),
  ["client", "secret"].join(""), ["coo", "kie"].join(""), ["creden", "tials"].join(""),
  ["id", "token"].join(""), ["pass", "phrase"].join(""), ["pass", "word"].join(""),
  ["oauth", "token"].join(""),
  ["private", "key"].join(""), ["refresh", "token"].join(""), ["sec", "ret"].join(""),
  ["secret", "key"].join(""), "session", ["session", "id"].join(""),
  ["to", "ken"].join(""), ["xapi", "key"].join(""),
])

function rawPathHasDotSegment(value) {
  const schemeIndex = value.indexOf("://")
  if (schemeIndex < 0) return false
  const authorityStart = schemeIndex + 3
  const authorityEnd = ["/", "?", "#"]
    .map((delimiter) => value.indexOf(delimiter, authorityStart))
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), value.length)
  if (authorityEnd === value.length || value[authorityEnd] !== "/") return false
  const rawPathTail = value.slice(authorityEnd)
  const pathEnd = rawPathTail.search(/[?#]/u)
  const rawPath = rawPathTail.slice(0, pathEnd < 0 ? rawPathTail.length : pathEnd)
  return rawPath.split("/").some((segment) => {
    if (segment === "." || segment === "..") return true
    try {
      return decodeURIComponent(segment).split("/").some((part) => part === "." || part === "..")
    } catch {
      return true
    }
  })
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
    host.endsWith(".home.arpa") || host.includes(":") || !host.includes(".")
  ) return false
  return !isPrivateIpv4(host)
}

function normalizedQueryKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "")
}

function isCredentialQueryKey(value) {
  const key = normalizedQueryKey(value)
  return CREDENTIAL_QUERY_KEYS.has(key) || [
    ["to", "ken"].join(""), ["sec", "ret"].join(""), ["pass", "word"].join(""),
    ["pass", "phrase"].join(""), ["api", "key"].join(""), ["private", "key"].join(""),
    ["signa", "ture"].join(""), ["j", "wt"].join(""),
    ["creden", "tial"].join(""), ["coo", "kie"].join(""),
  ].some((marker) => key.includes(marker))
}

function hasCredentialQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (isCredentialQueryKey(key)) return true
  }
  return false
}

function looksPathLike(value) {
  return value.includes("\\") || value.startsWith("/") || value.startsWith("~/") ||
    value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") ||
    value.startsWith(".\\") || value.startsWith("..\\") || value.startsWith("~\\") ||
    /^[a-z]:[\\/]/iu.test(value) || LOCAL_DOCUMENT_SUFFIX.test(value)
}

function matchesHost(hostname, configuredHost) {
  return hostname === configuredHost || hostname.endsWith(`.${configuredHost}`)
}

function isDoiResolverHost(hostname) {
  return DOI_RESOLVER_HOSTS.has(hostname.toLowerCase().replace(/\.$/u, ""))
}

function isDoiResolverReference(value) {
  if (/^(?:https?:\/\/)?(?:dx\.)?doi\.org(?:[/?#]|$)/iu.test(value)) return true
  try {
    return isDoiResolverHost(new URL(value).hostname)
  } catch {
    return false
  }
}

function normalizedExplicitProviderId(explicitProviderId) {
  if (explicitProviderId === undefined || explicitProviderId === null) return ""
  if (typeof explicitProviderId !== "string") throw new Error("平台选择格式无效")
  return explicitProviderId.trim()
}

function uniqueProviderMatch(providers, label) {
  if (providers.length > 1) throw new Error(`${label}匹配到多个平台，请检查公开配置`)
  return providers[0] ?? null
}

function providerByDoi(input, institution) {
  if (!input.doi) return null
  return uniqueProviderMatch(institution.providers.filter((provider) => (
    provider.doi_prefixes.some((prefix) => input.doi.startsWith(`${prefix}/`))
  )), "DOI 前缀")
}

function providerByHost(input, institution) {
  if (!input.sourceUrl) return null
  const hostname = new URL(input.sourceUrl).hostname.toLowerCase().replace(/\.$/u, "")
  return uniqueProviderMatch(institution.providers.filter((provider) => (
    provider.hosts.some((host) => matchesHost(hostname, host))
  )), "网址域名")
}

function conflictWarning(selected, source, inferred) {
  return `${selected.display_name} 与${source}识别的 ${inferred.display_name} 不一致，请核对平台。`
}

export function normalizeDoi(rawValue) {
  if (typeof rawValue !== "string") return null
  if (
    rawValue.length > 255 || rawValue.includes("\\") ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(rawValue)
  ) return null
  let value = rawValue.trim()
  if (
    value.length === 0 || value.length > 255 ||
    /[\u0000-\u001f\u007f\u2028\u2029\s]/u.test(value)
  ) return null

  if (/^doi:/iu.test(value)) value = value.slice(4)
  else if (/^https?:\/\//iu.test(value)) {
    let doiUrl
    try {
      doiUrl = new URL(value)
    } catch {
      return null
    }
    if (!isDoiResolverHost(doiUrl.hostname)) return null
    if (
      doiUrl.protocol !== "https:" || doiUrl.username || doiUrl.password ||
      doiUrl.port || doiUrl.search || doiUrl.hash || rawPathHasDotSegment(value)
    ) return null
    value = doiUrl.pathname.slice(1)
  }

  const normalized = value.toLowerCase()
  if (!normalized || normalized.length > 255 || !DOI_PATTERN.test(normalized)) return null
  const suffix = normalized.slice(normalized.indexOf("/") + 1)
  if (!suffix || normalized.includes("//") || suffix.split("/").some((part) => part === "." || part === "..")) return null
  return normalized
}

export function normalizeExternalHttpsUrl(rawValue) {
  if (typeof rawValue !== "string") return null
  if (
    rawValue.length > 2_048 || rawValue.includes("\\") ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(rawValue)
  ) return null
  const value = rawValue.trim()
  if (!value || value.length > 2_048 || value.includes("\\") || rawPathHasDotSegment(value)) return null

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (
    parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password ||
    parsed.port || parsed.hash || !isPublicHostname(parsed.hostname) || hasCredentialQuery(parsed)
  ) return null
  return parsed.href
}

export function parsePaperInput(rawValue) {
  if (typeof rawValue !== "string") throw new Error("请输入 DOI、英文题名或 HTTPS 原文网址")
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(rawValue)) {
    throw new Error("题名必须是 4 至 500 个字符的单行文本")
  }
  const value = rawValue.trim()
  if (!value) throw new Error("请输入 DOI、英文题名或 HTTPS 原文网址")

  const doi = normalizeDoi(value)
  if (doi) return { kind: "doi", doi, sourceUrl: null, title: null }
  if (isDoiResolverReference(value)) throw new Error("DOI 解析地址格式无效；请输入有效 DOI")

  const sourceUrl = normalizeExternalHttpsUrl(value)
  if (sourceUrl) return { kind: "url", doi: null, sourceUrl, title: null }

  if (
    value.includes("://") || /^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith("//") ||
    /^(?:doi\s*:?\s*)?10\./iu.test(value) || looksPathLike(value)
  ) throw new Error("DOI 或网址格式不安全；请输入有效 DOI 或 HTTPS 原文网址")
  if (
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) ||
    [...value].length < 4 || [...value].length > 500
  ) throw new Error("题名必须是 4 至 500 个字符的单行文本")
  return { kind: "title", doi: null, sourceUrl: null, title: value }
}

export function detectProvider({ explicitProviderId, input, institution }) {
  if (!institution || !Array.isArray(institution.providers)) throw new Error("学校访问配置不可用")
  const explicitId = normalizedExplicitProviderId(explicitProviderId)
  const explicit = explicitId
    ? institution.providers.find((provider) => provider.provider_id === explicitId) ?? null
    : null
  if (explicitId && !explicit) throw new Error("所选平台不存在")

  const doiProvider = providerByDoi(input, institution)
  const hostProvider = providerByHost(input, institution)
  const selected = explicit ?? doiProvider ?? hostProvider
  const basis = explicit ? "explicit" : doiProvider ? "doi_prefix" : hostProvider ? "host" : null
  const conflicts = []
  for (const [source, inferred] of [["DOI 前缀", doiProvider], ["网址域名", hostProvider]]) {
    if (selected && inferred && selected.provider_id !== inferred.provider_id) {
      conflicts.push(conflictWarning(selected, source, inferred))
    }
  }
  return { provider: selected, basis, conflicts }
}

function isOpenAccessUrl(sourceUrl) {
  if (!sourceUrl) return false
  const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/\.$/u, "")
  return OPEN_ACCESS_HOSTS.some((host) => matchesHost(hostname, host))
}

export function resolveInstitutionAccess({ rawInput, explicitProviderId, institution }) {
  const input = parsePaperInput(rawInput)
  const detection = detectProvider({ explicitProviderId, input, institution })
  const provider = detection.provider
  const articleUrl = input.kind === "doi"
    ? `https://doi.org/${input.doi}`
    : input.kind === "url" ? input.sourceUrl : null
  const openAccess = isOpenAccessUrl(input.sourceUrl)
    ? { status: "open_access", url: input.sourceUrl }
    : { status: "not_checked", url: null }
  const institutionAccess = provider && provider.carsi_supported && provider.carsi_entry_url
    ? {
      status: "carsi_available",
      authenticationUrl: provider.carsi_entry_url,
      articleUrl,
      libraryLookupUrl: provider.library_page,
    }
    : {
      status: "library_lookup_required",
      authenticationUrl: null,
      articleUrl,
      libraryLookupUrl: provider?.library_page ?? institution.fallback_page,
    }
  const warnings = [...detection.conflicts, SUBSCRIPTION_WARNING]

  return {
    input,
    provider: provider ? { provider_id: provider.provider_id, display_name: provider.display_name } : null,
    detection: { basis: detection.basis, conflicts: detection.conflicts },
    openAccess,
    institutionAccess,
    copyTarget: input.kind === "doi"
      ? { kind: "doi", value: input.doi }
      : input.kind === "url"
        ? { kind: "url", value: input.sourceUrl }
        : { kind: "title", value: input.title },
    warnings,
  }
}
