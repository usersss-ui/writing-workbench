import { createHash } from "node:crypto"
import { isValidPaperId } from "./overrides.mjs"

export const ARCHIVE_METADATA_FILE = "metadata.yaml"
export const ARCHIVE_METADATA_MAX_BYTES = 8_000
export const ARCHIVE_COMMIT_FILE = ".metadata.commit"
export const ARCHIVE_COMMIT_MAX_BYTES = 72

const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const OPENALEX_ID = /^W\d+$/u
const DOI = /^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u
const CREDENTIAL_QUERY_KEYS = new Set([
  ["access", "key"].join(""), ["access", "token"].join(""), ["api", "key"].join(""), ["auth", "token"].join(""),
  ["authori", "zation"].join(""), ["bearer", "token"].join(""),
  ["client", "secret"].join(""), ["coo", "kie"].join(""), ["creden", "tials"].join(""),
  ["id", "token"].join(""), ["pass", "phrase"].join(""), ["pass", "word"].join(""),
  ["oauth", "token"].join(""), ["private", "key"].join(""), ["refresh", "token"].join(""),
  ["sec", "ret"].join(""), ["secret", "key"].join(""), "session", ["session", "id"].join(""),
  ["to", "ken"].join(""), ["xapi", "key"].join(""),
])
const CANDIDATE_KEYS = Object.freeze([
  "paperId",
  "doi",
  "title",
  "authors",
  "year",
  "source",
  "citations",
  "isOpenAccess",
  "openAccessUrl",
  "landingPageUrl",
  "topics",
  "abstract",
  "stage",
])
const REQUIRED_METADATA_KEYS = Object.freeze([
  "paper_id",
  "title",
  "authors",
  "venue",
  "unit_type",
  "archive_mode",
  "archive_source_id",
  "candidate_source",
  "openalex_id",
  "archived_at",
])
const OPTIONAL_METADATA_KEYS = new Set(["year", "doi", "url"])
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"])
const DOCUMENT_LOCATOR_SUFFIX = /\.(?:bib|csv|docx?|json|markdown|md|nbib|pdf|ris|rtf|tex|txt|xlsx?|ya?ml)$/iu

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactOwnData(value, expectedKeys) {
  if (!isPlainObject(value)) return null
  let keys
  let descriptors
  try {
    keys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return null
  }
  if (keys.some((key) => typeof key !== "string")) return null
  const actual = [...keys].sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) return null
  const data = Object.create(null)
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null
    data[key] = descriptor.value
  }
  return data
}

function hasInvalidUnicode(value, { allowLineFeed = false } = {}) {
  if (/\p{Cf}/u.test(value)) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (
      (code <= 0x1f && !(allowLineFeed && code === 0x0a))
      || (code >= 0x7f && code <= 0x9f)
      || code === 0x00ad
      || code === 0x061c
      || code === 0x180e
      || code === 0x200b
      || code === 0x200e
      || code === 0x200f
      || code === 0x200c
      || code === 0x200d
      || (code >= 0x2028 && code <= 0x202e)
      || (code >= 0x2066 && code <= 0x2069)
      || code === 0x2060
      || code === 0xfeff
      || code === 0xfffd
      || code === 0xfffe
      || code === 0xffff
    ) return true
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      const codePoint = value.codePointAt(index)
      if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function isCanonicalText(value, maximum, { nullable = false } = {}) {
  if (nullable && value === null) return true
  return typeof value === "string"
    && value.length > 0
    && Array.from(value).length <= maximum
    && value === value.trim()
    && !hasInvalidUnicode(value)
    && !/\s{2,}/u.test(value)
}

function isObviousPrivateLocator(value) {
  const normalized = value.trim().replaceAll("\\", "/")
  const boundary = String.raw`(?:^|[^\p{L}\p{N}])`
  if (/^(?:file:|\/|~\/|[a-z]:\/|\/\/)/iu.test(normalized)) return true
  if (new RegExp(`${boundary}(?:file:|~\\/|[a-z]:\\/|\\/\\/(?:[^/\\s]+)\\/)`, "iu").test(normalized)) return true
  if (new RegExp(`${boundary}(?:\\/(?!\\s)|\\.{1,2}\\/|~\\/|[a-z]:\\/)[^\\s"'\\x60<>]+`, "iu").test(normalized)) return true
  if (normalized.split("/").includes("..") || new RegExp(`${boundary}\\.\\.(?:\\/|$)`, "u").test(normalized)) return true
  if (!/^https?:\/\//iu.test(normalized) && /^[^/\s]+(?:\/[^/\s]+)+$/u.test(normalized)) return true
  const tokens = normalized.split(/\s+/u).map((token) => token.replace(/^[\s("'`]+|[\s)"'`,;:.]+$/gu, ""))
  if (tokens.some((token) => token.includes("/") && DOCUMENT_LOCATOR_SUFFIX.test(token))) return true
  if (!DOCUMENT_LOCATOR_SUFFIX.test(normalized)) return false
  return normalized.includes("/") || !/\s/u.test(normalized)
}

function isCredentialAssignmentKey(value) {
  const key = normalizedQueryKey(value)
  if (CREDENTIAL_QUERY_KEYS.has(key) || ["token", "password", "secret"].includes(key)) return true
  return /^(?:api|access|auth|oauth|refresh|client|private|secret|session|id|xapi)(?:key|token|secret|password|credentials?)$/u.test(key)
}

function hasBareCredentialAssignment(value) {
  const assignment = /["']?([a-z][a-z0-9_.-]*(?:\s+[a-z][a-z0-9_.-]*){0,8})["']?\s*[:=]/giu
  for (const match of value.matchAll(assignment)) {
    const words = match[1].trim().split(/\s+/u)
    for (let count = 1; count <= Math.min(3, words.length); count += 1) {
      if (isCredentialAssignmentKey(words.slice(-count).join(""))) return true
    }
  }
  return /(?:^|[^a-z0-9])authorization\s*:\s*bearer\s+["']?[^\s,;"']{4,256}/iu.test(value)
}

function isUnsafeUrlLikeBibliographicText(value) {
  const urls = value.match(/https?:\/\/[^\s<>"']+/giu) ?? []
  for (const raw of urls) {
    if (raw.includes("\\") || /%25[0-9a-f]{2}/iu.test(raw)) return true
    try {
      const url = new URL(raw)
      if (
        url.protocol !== "https:"
        || url.username
        || url.password
        || url.port
        || url.hash
        || url.search
        || !isPublicHostname(url.hostname)
      ) return true
      for (const key of url.searchParams.keys()) if (isCredentialQueryKey(key)) return true
    } catch {
      return true
    }
  }
  return false
}

function isSafeDecodedBibliographicText(value, maximum) {
  return isCanonicalText(value, maximum)
    && !isObviousPrivateLocator(value)
    && !hasBareCredentialAssignment(value)
    && !isUnsafeUrlLikeBibliographicText(value)
}

function isSafeBibliographicText(value, maximum) {
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isSafeDecodedBibliographicText(decoded, maximum)) return false
    if (!/%[0-9a-f]{2}/iu.test(decoded)) return true
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded || Array.from(next).length > maximum) return false
      decoded = next
    } catch {
      return false
    }
  }
  return isSafeDecodedBibliographicText(decoded, maximum) && !/%[0-9a-f]{2}/iu.test(decoded)
}

function isCanonicalTextList(value, maximumItems, maximumText, { bibliographic = false } = {}) {
  if (!Array.isArray(value)) return null
  let descriptors
  let keys
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return null
  }
  const lengthDescriptor = descriptors.length
  if (!Object.hasOwn(lengthDescriptor ?? {}, "value") || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value > maximumItems) return null
  const expectedKeys = [...Array.from({ length: lengthDescriptor.value }, (_, index) => String(index)), "length"]
  if (keys.some((key) => typeof key !== "string") || keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) return null
  const values = []
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[index]
    const validText = bibliographic
      ? isSafeBibliographicText(descriptor?.value, maximumText)
      : isCanonicalText(descriptor?.value, maximumText)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || !validText) return null
    values.push(descriptor.value)
  }
  return new Set(values).size === values.length ? values : null
}

function normalizedQueryKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "")
}

function decodedQueryKey(value) {
  if (typeof value !== "string" || value.length > 512 || hasInvalidUnicode(value)) return null
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (!/%[0-9a-f]{2}/iu.test(decoded)) return decoded
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded || next.length > 512 || hasInvalidUnicode(next)) return null
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
    ["signa", "ture"].join(""), ["j", "wt"].join(""), ["creden", "tial"].join(""),
    ["coo", "kie"].join(""),
  ].some((marker) => key.includes(marker))
}

function isIpv4Literal(hostname) {
  const parts = hostname.split(".")
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "")
  return Boolean(host)
    && host !== "localhost"
    && !host.endsWith(".localhost")
    && !host.endsWith(".local")
    && !host.endsWith(".home.arpa")
    && !host.includes(":")
    && host.includes(".")
    && !isIpv4Literal(host)
}

function isCanonicalHttpsUrl(value, { nullable = false } = {}) {
  if (nullable && value === null) return true
  if (!isCanonicalText(value, 2_048) || value.includes("\\")) return false
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hash
      || !isPublicHostname(url.hostname)
      || url.href !== value
    ) return false
    for (const key of url.searchParams.keys()) if (isCredentialQueryKey(key)) return false
    return true
  } catch {
    return false
  }
}

function isCanonicalDoi(value) {
  if (value === null) return true
  if (!isCanonicalText(value, 512) || value !== value.toLocaleLowerCase("en-US") || !DOI.test(value)) return false
  const suffix = value.slice(value.indexOf("/") + 1)
  return Boolean(suffix)
    && !value.includes("//")
    && !suffix.split("/").some((segment) => segment === "." || segment === "..")
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function validateCandidate(candidate) {
  const data = exactOwnData(candidate, CANDIDATE_KEYS)
  const authors = data && isCanonicalTextList(data.authors, 50, 300, { bibliographic: true })
  const topics = data && isCanonicalTextList(data.topics, 20, 300)
  if (
    !data
    || typeof data.paperId !== "string"
    || data.paperId.length > 100
    || !OPENALEX_ID.test(data.paperId)
    || !isCanonicalDoi(data.doi)
    || !isSafeBibliographicText(data.title, 1_000)
    || !authors
    || (data.year !== null && (!Number.isInteger(data.year) || data.year < 1_000 || data.year > 9_999))
    || !isSafeBibliographicText(data.source, 500)
    || !Number.isSafeInteger(data.citations)
    || data.citations < 0
    || typeof data.isOpenAccess !== "boolean"
    || !isCanonicalHttpsUrl(data.openAccessUrl, { nullable: true })
    || !isCanonicalHttpsUrl(data.landingPageUrl)
    || !topics
    || !isCanonicalText(data.abstract, 20_000, { nullable: true })
    || data.stage !== "confirmed_for_archive"
  ) throw new TypeError("候选归档元数据字段格式无效")
  return { ...data, authors, topics }
}

function quoted(value) {
  return JSON.stringify(value)
}

function appendStringList(lines, key, values) {
  if (values.length === 0) {
    lines.push(`${key}: []`)
    return
  }
  lines.push(`${key}:`)
  for (const value of values) lines.push(`  - ${quoted(value)}`)
}

export function serializeArchiveMetadata({ paperId, archiveSourceId, candidate, archivedAt } = {}) {
  if (!isValidPaperId(paperId) || paperId.includes("/") || paperId.includes("\\")) {
    throw new TypeError("归档元数据 paper_id 格式无效")
  }
  if (typeof archiveSourceId !== "string" || !SOURCE_ID.test(archiveSourceId)) {
    throw new TypeError("归档元数据 archive_source_id 格式或路径无效")
  }
  const safeCandidate = validateCandidate(candidate)
  if (!isCanonicalIsoTimestamp(archivedAt)) throw new TypeError("归档元数据时间格式无效")

  const lines = [
    `paper_id: ${paperId}`,
    `title: ${quoted(safeCandidate.title)}`,
  ]
  appendStringList(lines, "authors", safeCandidate.authors)
  if (safeCandidate.year !== null) lines.push(`year: ${safeCandidate.year}`)
  lines.push(`venue: ${quoted(safeCandidate.source)}`)
  if (safeCandidate.doi === null) lines.push(`url: ${quoted(`https://openalex.org/${safeCandidate.paperId}`)}`)
  else lines.push(`doi: ${quoted(safeCandidate.doi)}`)
  lines.push(
    "unit_type: article",
    "archive_mode: metadata_only",
    `archive_source_id: ${archiveSourceId}`,
    "candidate_source: openalex",
    `openalex_id: ${safeCandidate.paperId}`,
    `archived_at: ${quoted(archivedAt)}`,
    "",
  )
  const text = lines.join("\n")
  if (Buffer.byteLength(text, "utf8") > ARCHIVE_METADATA_MAX_BYTES) {
    throw new TypeError("归档元数据大小超过受控读取上限")
  }
  return text
}

export function archiveMetadataSha256(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > ARCHIVE_METADATA_MAX_BYTES) {
    throw new TypeError("归档元数据摘要输入无效")
  }
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function serializeArchiveCommit(text) {
  return `sha256:${archiveMetadataSha256(text)}\n`
}

export function parseArchiveCommit(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") !== ARCHIVE_COMMIT_MAX_BYTES) {
    throw new TypeError("归档提交标记格式无效")
  }
  const match = /^sha256:([a-f0-9]{64})\n$/u.exec(text)
  if (!match) throw new TypeError("归档提交标记格式无效")
  return match[1]
}

function parseQuotedString(rawValue, field, maximum, { bibliographic = false } = {}) {
  if (!rawValue.startsWith('"') || !rawValue.endsWith('"')) throw new TypeError(`归档元数据字段格式无效: ${field}`)
  let value
  try { value = JSON.parse(rawValue) } catch { throw new TypeError(`归档元数据字段格式无效: ${field}`) }
  const validText = bibliographic ? isSafeBibliographicText(value, maximum) : isCanonicalText(value, maximum)
  if (typeof value !== "string" || JSON.stringify(value) !== rawValue || !validText) {
    throw new TypeError(`归档元数据字段格式无效: ${field}`)
  }
  return value
}

function parseDocument(text) {
  if (typeof text !== "string") throw new TypeError("归档元数据必须是字符串")
  if (Buffer.byteLength(text, "utf8") > ARCHIVE_METADATA_MAX_BYTES) throw new TypeError("归档元数据大小超过受控读取上限")
  if (text.length === 0 || hasInvalidUnicode(text, { allowLineFeed: true })) throw new TypeError("归档元数据包含控制字符")
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const fields = Object.create(null)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.length === 0 || /^\s/u.test(line)) throw new TypeError("归档元数据 YAML 结构无效")
    const match = /^([a-z_]+):(?: (.*))?$/u.exec(line)
    if (!match) throw new TypeError("归档元数据 YAML 结构无效")
    const [, key, rawValue = ""] = match
    if (FORBIDDEN_OBJECT_KEYS.has(key) || (!REQUIRED_METADATA_KEYS.includes(key) && !OPTIONAL_METADATA_KEYS.has(key))) {
      throw new TypeError(`归档元数据未知字段: ${key}`)
    }
    if (Object.hasOwn(fields, key)) throw new TypeError(`归档元数据字段重复: ${key}`)

    if (key === "authors") {
      const authors = []
      if (rawValue === "[]") {
        fields.authors = authors
        continue
      }
      if (rawValue !== "") throw new TypeError("归档元数据 YAML 结构无效")
      while (index + 1 < lines.length && lines[index + 1].startsWith("  - ")) {
        const authorLine = lines[++index]
        const author = parseQuotedString(authorLine.slice(4), "authors", 300, { bibliographic: true })
        authors.push(author)
      }
      if (!isCanonicalTextList(authors, 50, 300, { bibliographic: true })) throw new TypeError("归档元数据字段格式无效: authors")
      fields.authors = authors
      continue
    }

    fields[key] = rawValue
  }
  return fields
}

export function parseArchiveMetadata(text) {
  const fields = parseDocument(text)
  for (const key of REQUIRED_METADATA_KEYS) {
    if (!Object.hasOwn(fields, key)) throw new TypeError(`归档元数据缺少字段: ${key}`)
  }
  if (Object.hasOwn(fields, "doi") === Object.hasOwn(fields, "url")) {
    throw new TypeError("归档元数据 DOI 与 URL 身份字段无效")
  }
  if (!isValidPaperId(fields.paper_id) || fields.paper_id.includes("/") || fields.paper_id.includes("\\")) {
    throw new TypeError("归档元数据 paper_id 格式无效")
  }
  const title = parseQuotedString(fields.title, "title", 1_000, { bibliographic: true })
  const venue = parseQuotedString(fields.venue, "venue", 500, { bibliographic: true })
  const year = Object.hasOwn(fields, "year") && /^\d{4}$/u.test(fields.year) ? Number(fields.year) : null
  if (Object.hasOwn(fields, "year") && (year === null || year < 1_000 || year > 9_999)) throw new TypeError("归档元数据 year 格式无效")
  if (fields.unit_type !== "article" || fields.archive_mode !== "metadata_only") throw new TypeError("归档元数据类型字段无效")
  if (!SOURCE_ID.test(fields.archive_source_id)) throw new TypeError("归档元数据 archive_source_id 路径或格式无效")
  if (fields.candidate_source !== "openalex" || !OPENALEX_ID.test(fields.openalex_id)) throw new TypeError("归档元数据来源身份无效")
  if (!isCanonicalIsoTimestamp(parseQuotedString(fields.archived_at, "archived_at", 24))) throw new TypeError("归档元数据时间格式无效")

  let doiOrUrl
  if (Object.hasOwn(fields, "doi")) {
    doiOrUrl = parseQuotedString(fields.doi, "doi", 512)
    if (!isCanonicalDoi(doiOrUrl) || doiOrUrl === null) throw new TypeError("归档元数据 DOI 身份无效")
  } else {
    doiOrUrl = parseQuotedString(fields.url, "url", 2_048)
    if (doiOrUrl !== `https://openalex.org/${fields.openalex_id}`) throw new TypeError("归档元数据 OpenAlex URL 身份无效")
  }

  const metadata = {
    paper_id: fields.paper_id,
    title_original: title,
    authors: [...fields.authors],
    ...(year === null ? {} : { year }),
    venue,
    doi_or_url: doiOrUrl,
    unit_type: "article",
  }
  return {
    metadata,
    archive_source_id: fields.archive_source_id,
    candidate_source: "openalex",
    openalex_id: fields.openalex_id,
    archive_identity: `openalex:${fields.openalex_id}`,
    archived_at: parseQuotedString(fields.archived_at, "archived_at", 24),
  }
}
