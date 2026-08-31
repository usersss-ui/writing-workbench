import { readFile } from "node:fs/promises"

const MAX_CONFIG_BYTES = 100_000
const MAX_URL_CHARACTERS = 2_048
const MAX_PROVIDERS = 50
const MAX_HOSTS = 20
const MAX_DOI_PREFIXES = 20

const TOP_LEVEL_FIELDS = new Set([
  "version", "institution_id", "display_name", "access_mode",
  "library_home", "fallback_page", "providers",
])
const PROVIDER_FIELDS = new Set([
  "provider_id", "display_name", "hosts", "doi_prefixes", "library_page",
  "carsi_entry_url", "carsi_supported",
])
const CREDENTIAL_KEYS = new Set([
  ["user", "name"].join(""), "account", ["pass", "word"].join(""),
  ["coo", "kie"].join(""), "session", ["to", "ken"].join(""),
  ["api", "key"].join(""), ["private", "key"].join(""),
  ["client", "secret"].join(""), ["sec", "ret"].join(""),
  ["creden", "tials"].join(""), ["access", "token"].join(""),
  ["refresh", "token"].join(""), ["id", "token"].join(""),
  ["auth", "token"].join(""), ["bearer", "token"].join(""),
  ["secret", "key"].join(""), ["session", "id"].join(""),
  ["pass", "phrase"].join(""), ["authori", "zation"].join(""),
  ["xapi", "key"].join(""),
])

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u
const DOI_PREFIX_PATTERN = /^10\.[0-9]{4,9}$/u
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u

function credentialKey(key) {
  return key.toLowerCase().replace(/[\s_.-]/gu, "")
}

function rejectCredentialFields(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) rejectCredentialFields(item, seen)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEYS.has(credentialKey(key))) throw new Error("配置包含凭据字段")
    rejectCredentialFields(child, seen)
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
}

function assertExactFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 存在未知字段`)
  }
}

function assertRequiredFields(value, required, label) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} 缺失`)
  }
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string" || value.trim() === "" || value !== value.trim() ||
    [...value].length > maximum || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  ) throw new Error(`${label} 必须是长度受限且不含控制字符的非空字符串`)
  return value
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

function rejectPathLikeString(value, label) {
  if (
    value.startsWith("/") || value.startsWith("\\") || value.startsWith("~/") ||
    value.startsWith("../") || value.startsWith("./") || /^[a-z]:[\\/]/iu.test(value) ||
    rawPathHasDotSegment(value)
  ) throw new Error(`${label} 不能是本地路径或包含路径穿越段`)
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

function hasCredentialQuery(parsed) {
  for (const key of parsed.searchParams.keys()) {
    if (CREDENTIAL_KEYS.has(credentialKey(key))) return true
  }
  return false
}

function validateHttpsUrl(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_URL_CHARACTERS) {
    throw new Error(`${label} 必须是长度受限的 HTTPS URL`)
  }
  rejectPathLikeString(value, label)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} URL 无效`)
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} 只允许 HTTPS URL`)
  if (parsed.username || parsed.password) throw new Error(`${label} URL 不得包含用户信息`)
  if (parsed.hash) throw new Error(`${label} URL 不得包含片段`)
  if (parsed.port) throw new Error(`${label} URL 不得指定端口`)
  if (!isPublicHostname(parsed.hostname)) throw new Error(`${label} URL 必须使用公网主机`)
  if (hasCredentialQuery(parsed)) throw new Error(`${label} URL 不得包含凭据参数`)
  return parsed.href
}

function validateHost(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 253) {
    throw new Error(`${label} 主机不能为空且长度必须受限`)
  }
  let host = value.toLowerCase()
  if (host.endsWith(".")) host = host.slice(0, -1)
  if (
    host.includes("://") || host.includes("/") || host.includes(":") || host.includes("*") ||
    /\s/u.test(host) || !isPublicHostname(host)
  ) throw new Error(`${label} 主机格式无效或不是公网主机`)
  const labels = host.split(".")
  if (
    labels.length < 2 || labels.some((part) => part.length === 0 || part.length > 63 || !HOST_LABEL_PATTERN.test(part)) ||
    labels.at(-1).length < 2
  ) throw new Error(`${label} 主机格式无效`)
  return host
}

function hostsOverlap(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function validateDoiPrefix(value, label) {
  if (typeof value !== "string" || !DOI_PREFIX_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${label} DOI 前缀格式无效`)
  }
  return value.toLowerCase()
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freezeDeep(child, seen)
  return Object.freeze(value)
}

function validateProvider(raw, index, seenProviderIds, seenHosts, seenDoiPrefixes) {
  const label = `providers[${index}]`
  assertObject(raw, label)
  assertExactFields(raw, PROVIDER_FIELDS, label)
  assertRequiredFields(raw, PROVIDER_FIELDS, label)

  const providerId = boundedText(raw.provider_id, `${label}.provider_id`, 80)
  if (!ID_PATTERN.test(providerId)) throw new Error(`${label}.provider_id 格式无效`)
  if (seenProviderIds.has(providerId)) throw new Error(`${label}.provider_id 包含重复项`)
  seenProviderIds.add(providerId)

  const displayName = boundedText(raw.display_name, `${label}.display_name`, 200)
  if (!Array.isArray(raw.hosts) || raw.hosts.length === 0 || raw.hosts.length > MAX_HOSTS) {
    throw new Error(`${label}.hosts 必须是数量受限的非空数组`)
  }
  const hosts = raw.hosts.map((host, hostIndex) => {
    const normalized = validateHost(host, `${label}.hosts[${hostIndex}]`)
    if ([...seenHosts].some((existing) => hostsOverlap(existing, normalized))) {
      throw new Error(`${label}.hosts 与其他主机重复或重叠`)
    }
    seenHosts.add(normalized)
    return normalized
  })

  if (!Array.isArray(raw.doi_prefixes) || raw.doi_prefixes.length > MAX_DOI_PREFIXES) {
    throw new Error(`${label}.doi_prefixes 必须是数量受限的数组`)
  }
  const doiPrefixes = raw.doi_prefixes.map((prefix, prefixIndex) => {
    const normalized = validateDoiPrefix(prefix, `${label}.doi_prefixes[${prefixIndex}]`)
    if (seenDoiPrefixes.has(normalized)) throw new Error(`${label}.doi_prefixes 包含重复项`)
    seenDoiPrefixes.add(normalized)
    return normalized
  })

  if (typeof raw.carsi_supported !== "boolean") throw new Error(`${label}.carsi_supported 必须是布尔值`)
  const libraryPage = raw.library_page === null ? null : validateHttpsUrl(raw.library_page, `${label}.library_page`)
  if (raw.carsi_supported && libraryPage === null) {
    throw new Error(`${label}.carsi_supported 为 true 时必须有合法 library_page`)
  }
  const carsiEntryUrl = validateHttpsUrl(raw.carsi_entry_url, `${label}.carsi_entry_url`, { nullable: true })
  if (!raw.carsi_supported && carsiEntryUrl !== null) {
    throw new Error(`${label}.carsi_supported 为 false 时 carsi_entry_url 必须为空`)
  }

  return {
    provider_id: providerId,
    display_name: displayName,
    hosts,
    doi_prefixes: doiPrefixes,
    library_page: libraryPage,
    carsi_entry_url: carsiEntryUrl,
    carsi_supported: raw.carsi_supported,
  }
}

export function validateInstitutionConfig(raw) {
  rejectCredentialFields(raw)
  assertObject(raw, "配置")
  assertExactFields(raw, TOP_LEVEL_FIELDS, "配置")
  assertRequiredFields(raw, TOP_LEVEL_FIELDS, "配置")
  if (raw.version !== 1) throw new Error("配置 version 必须为 1")
  const institutionId = boundedText(raw.institution_id, "配置.institution_id", 80)
  if (!ID_PATTERN.test(institutionId)) throw new Error("配置.institution_id 格式无效")
  const displayName = boundedText(raw.display_name, "配置.display_name", 200)
  if (raw.access_mode !== "carsi") throw new Error("配置 access_mode 必须为 carsi")

  const libraryHome = validateHttpsUrl(raw.library_home, "配置.library_home")
  const fallbackPage = validateHttpsUrl(raw.fallback_page, "配置.fallback_page")
  if (!Array.isArray(raw.providers) || raw.providers.length === 0 || raw.providers.length > MAX_PROVIDERS) {
    throw new Error("配置.providers 必须是数量受限的非空数组")
  }
  const seenProviderIds = new Set()
  const seenHosts = new Set()
  const seenDoiPrefixes = new Set()
  const providers = raw.providers.map((provider, index) => (
    validateProvider(provider, index, seenProviderIds, seenHosts, seenDoiPrefixes)
  ))

  const profile = {
    version: 1,
    institution_id: institutionId,
    display_name: displayName,
    access_mode: "carsi",
    library_home: libraryHome,
    fallback_page: fallbackPage,
    providers,
  }
  if (JSON.stringify(profile).length > MAX_CONFIG_BYTES) throw new Error("配置大小超限")
  return freezeDeep(profile)
}

export async function loadInstitutionConfig(configPath) {
  let bytes
  try {
    bytes = await readFile(configPath)
  } catch {
    throw new Error("配置文件读取失败")
  }
  if (bytes.length > MAX_CONFIG_BYTES) throw new Error("配置文件大小超限")

  let contents
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("配置文件必须是有效的 UTF-8")
  }
  let raw
  try {
    raw = JSON.parse(contents)
  } catch {
    throw new Error("配置 JSON 无效")
  }
  return validateInstitutionConfig(raw)
}
