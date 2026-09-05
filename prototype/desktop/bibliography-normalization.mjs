const CREDENTIAL_QUERY_KEYS = new Set([
  ["access", "token"].join(""), ["api", "key"].join(""), ["auth", "token"].join(""),
  ["authori", "zation"].join(""), ["bearer", "token"].join(""), ["xapi", "key"].join(""),
  ["client", "secret"].join(""), ["coo", "kie"].join(""), ["creden", "tials"].join(""),
  ["oauth", "token"].join(""),
  ["pass", "word"].join(""), ["private", "key"].join(""), ["refresh", "token"].join(""),
  ["sec", "ret"].join(""), ["secret", "key"].join(""), "session",
  ["session", "id"].join(""), ["to", "ken"].join(""),
])

export function cleanText(value, maximum = 20_000) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum)
}

function identityTitleText(value) {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim()
}

function publicationLabel(value) {
  const title = (value ?? '').normalize('NFKC').toLowerCase().trim()
  const label = '(?:correction|corrigendum|erratum|retraction|preprint(?:\\s+version\\s+\\d+)?|version\\s+\\d+)'
  // Publication labels must occur at a title boundary, never merely in its subject.
  const match = title.match(new RegExp(`^(?:a\\s+)?(${label})(?:\\s+(?:to|of))?\\s*:`, 'u')) ??
    title.match(new RegExp(`^[[(]\\s*(${label})\\s*[\\])]\\s*`, 'u')) ??
    title.match(/^(version\s+\d+)\s+of\s+/u) ??
    title.match(/^(?:a\s+)?(correction|corrigendum|erratum|retraction)\s+(?:to|of)\s+/u) ??
    title.match(new RegExp(`(?:[:;,]\\s*(?:a\\s+)?(${label})|[[(]\\s*(${label})\\s*[\\])])\\.?$`, 'u'))
  return identityTitleText(match?.[1] ?? match?.[2] ?? '')
}

function comparableTitleScript(value) {
  const letters = value.match(/\p{L}/gu)?.length ?? 0
  if ((value.match(/\p{Script=Latin}/gu)?.length ?? 0) > letters / 2) return 'latin'
  if ((value.match(/\p{Script=Han}/gu)?.length ?? 0) > letters / 2) return 'han'
  return null
}

/** Affirmative title contradictions only; a missing title or translation cannot disprove a DOI. */
export function discoveryTitleConflict(left, right) {
  const a = identityTitleText(left), b = identityTitleText(right)
  if (a === b || !a || !b || a === 'not reported' || b === 'not reported') return false
  if (publicationLabel(left) !== publicationLabel(right)) return true
  const script = comparableTitleScript(a)
  if (script === null || script !== comparableTitleScript(b)) return false
  if (a.includes(b) || b.includes(a)) return false
  const grams = value => {
    const characters = [...value]
    return new Set(characters.slice(1).map((character, index) => characters[index] + character))
  }
  const ag = grams(a), bg = grams(b), common = [...ag].filter(gram => bg.has(gram)).length
  return [...a].length >= 12 && [...b].length >= 12 && 2 * common / (ag.size + bg.size) < 0.3
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
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "")
}

function decodedQueryKey(value) {
  if (
    typeof value !== "string" || value.length > 512 ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  ) return null
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (!/%[0-9a-f]{2}/iu.test(decoded)) return decoded
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded || next.length > 512 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(next)) return null
      decoded = next
    } catch {
      return null
    }
  }
  return /%[0-9a-f]{2}/iu.test(decoded) ? null : decoded
}

function isCredentialQueryKey(value) {
  const decoded = decodedQueryKey(value)
  if (decoded === null) return true
  const key = normalizedQueryKey(decoded)
  return CREDENTIAL_QUERY_KEYS.has(key) || [
    ["to", "ken"].join(""), ["sec", "ret"].join(""), ["pass", "word"].join(""),
    ["pass", "phrase"].join(""), ["api", "key"].join(""), ["private", "key"].join(""),
    ["signa", "ture"].join(""), ["j", "wt"].join(""),
    ["creden", "tial"].join(""), ["coo", "kie"].join(""),
  ].some((marker) => key.includes(marker))
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

export function safeHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) return null
  const text = value.trim()
  if (!text || text.length > 2_048 || text.includes("\\") || rawPathHasDotSegment(text)) return null
  try {
    const url = new URL(text)
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash || !isPublicHostname(url.hostname)
    ) return null
    for (const key of url.searchParams.keys()) {
      if (isCredentialQueryKey(key)) return null
    }
    return url.href
  } catch {
    return null
  }
}

export function normalizeDoi(value) {
  if (
    typeof value !== "string" || value.length > 512 || value.includes("\\") ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  ) return null
  let doi = cleanText(value, 512)
  if (!doi) return null
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").replace(/^doi:\s*/iu, "").toLowerCase()
  if (!/^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u.test(doi) || doi.includes("//")) return null
  const suffix = doi.slice(doi.indexOf("/") + 1)
  return suffix.split("/").some((part) => part === "." || part === "..") ? null : doi
}
