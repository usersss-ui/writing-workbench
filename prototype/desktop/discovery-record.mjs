import { normalizeDoi, safeHttpsUrl } from "./openalex-search.mjs"

const RECORD_KEYS = Object.freeze(["record_id", "provider_id", "bibliography", "provenance", "retraction"])
const BIBLIOGRAPHY_KEYS = Object.freeze([
  "title", "authors", "year", "doi", "url", "abstract", "language", "work_type", "journal", "citations",
])
const JOURNAL_KEYS = Object.freeze(["title", "source_id", "issns", "source_type"])
const CITATION_KEYS = Object.freeze(["count", "provider", "retrieved_at"])
const PROVENANCE_KEYS = Object.freeze([
  "provider", "method", "batch_id", "query_id", "import_id", "retrieved_at", "public_url", "verification",
])
const RETRACTION_KEYS = Object.freeze(["state", "source_url", "checked_at"])
const SCOPE_KEYS = Object.freeze(["startYear", "endYear", "language"])
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"])
const PROVIDERS = Object.freeze(["openalex", "scholar", "cnki", "local", "manual"])
const METHODS = Object.freeze(["api", "import", "local", "manual"])
const VERIFICATIONS = Object.freeze(["api", "user", "declared"])
const RETRACTION_STATES = Object.freeze(["retracted", "screened_clear", "unknown"])
const SCOPE_LANGUAGES = Object.freeze(["all", "en", "zh"])
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const ISSN = /^\d{4}-\d{3}[\dX]$/u
const MAX_IDENTITY_CHARACTERS = 2_048

function fail(label) {
  throw new TypeError(`${label} 无效`)
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function readExactObject(value, keys, label) {
  if (!isPlainObject(value)) fail(label)
  let ownKeys
  let descriptors
  try {
    ownKeys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    fail(label)
  }
  if (
    ownKeys.some((key) => typeof key !== "string" || DANGEROUS_KEYS.has(key)) ||
    ownKeys.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key)) ||
    ownKeys.some((key) => !keys.includes(key)) ||
    keys.some((key) => descriptors[key]?.enumerable !== true || !("value" in descriptors[key]))
  ) fail(label)
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))
}

function readDenseArray(value, maximum, label) {
  if (!Array.isArray(value)) fail(label)
  let prototype
  let ownKeys
  let descriptors
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    fail(label)
  }
  const length = descriptors.length?.value
  if (
    prototype !== Array.prototype || !Number.isSafeInteger(length) || length < 0 ||
    length > maximum ||
    ownKeys.some((key) => typeof key !== "string" || DANGEROUS_KEYS.has(key)) ||
    ownKeys.length !== length + 1 ||
    descriptors.length?.enumerable !== false || !("value" in descriptors.length)
  ) fail(label)
  const items = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) fail(label)
    items.push(descriptor.value)
  }
  return items
}

function text(value, maximum, label, { nullable = false, lowercase = false } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== "string") fail(label)
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
  if (!normalized) fail(label)
  if ([...normalized].length > maximum) fail(label)
  return lowercase ? normalized.toLowerCase() : normalized
}

function optionalText(value, maximum, label, options = {}) {
  return text(value, maximum, label, { ...options, nullable: true })
}

function identity(value, label, { nullable = false } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== "string") fail(label)
  const characters = [...value]
  if (
    characters.length === 0 || characters.length > MAX_IDENTITY_CHARACTERS || value !== value.trim() ||
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  ) fail(label)
  return value
}

function instant(value, label, { nullable = false } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) fail(label)
  try {
    if (new Date(value).toISOString() !== value) fail(label)
  } catch {
    fail(label)
  }
  return value
}

function enumeration(value, allowed, label) {
  if (!allowed.includes(value)) fail(label)
  return value
}

function year(value, label, { nullable = true } = {}) {
  if (value === null && nullable) return null
  if (!Number.isInteger(value) || value < 1_000 || value > 9_999) fail(label)
  return value
}

function publicUrl(value) {
  if (value === null) return null
  if (typeof value !== "string" || value.length > 2_048) fail("公开 URL")
  return safeHttpsUrl(value)
}

function bibliographyDoi(value) {
  if (value === null) return null
  const normalized = normalizeDoi(value)
  if (normalized === null) fail("DOI")
  return normalized
}

function normalizeAuthors(value) {
  const authors = readDenseArray(value, 50, "作者")
  const normalized = []
  const seen = new Set()
  for (const author of authors) {
    const name = text(author, 300, "作者")
    if (seen.has(name)) continue
    seen.add(name)
    normalized.push(name)
  }
  return normalized
}

function normalizeIssns(value) {
  const issns = readDenseArray(value, 10, "ISSN")
  const normalized = []
  const seen = new Set()
  for (const rawIssn of issns) {
    if (typeof rawIssn !== "string") fail("ISSN")
    const issn = rawIssn.trim().toUpperCase()
    if (!ISSN.test(issn)) fail("ISSN")
    if (seen.has(issn)) continue
    seen.add(issn)
    normalized.push(issn)
  }
  return normalized
}

function normalizeJournal(value) {
  const journal = readExactObject(value, JOURNAL_KEYS, "期刊")
  return {
    title: optionalText(journal.title, 500, "期刊题名"),
    source_id: identity(journal.source_id, "期刊来源 ID", { nullable: true }),
    issns: normalizeIssns(journal.issns),
    source_type: optionalText(journal.source_type, 100, "来源类型", { lowercase: true }),
  }
}

function normalizeCitations(value) {
  if (value === null) return null
  const citations = readExactObject(value, CITATION_KEYS, "引用信息")
  if (!Number.isSafeInteger(citations.count) || citations.count < 0) fail("引用次数")
  return {
    count: citations.count,
    provider: text(citations.provider, 300, "引用来源"),
    retrieved_at: instant(citations.retrieved_at, "引用获取时间"),
  }
}

function normalizeBibliography(value) {
  const bibliography = readExactObject(value, BIBLIOGRAPHY_KEYS, "书目信息")
  return {
    title: text(bibliography.title, 1_000, "题名"),
    authors: normalizeAuthors(bibliography.authors),
    year: year(bibliography.year, "年份"),
    doi: bibliographyDoi(bibliography.doi),
    url: publicUrl(bibliography.url),
    abstract: optionalText(bibliography.abstract, 20_000, "摘要"),
    language: optionalText(bibliography.language, 100, "语言", { lowercase: true }),
    work_type: optionalText(bibliography.work_type, 100, "文献类型", { lowercase: true }),
    journal: normalizeJournal(bibliography.journal),
    citations: normalizeCitations(bibliography.citations),
  }
}

function normalizeProvenance(value) {
  const provenance = readExactObject(value, PROVENANCE_KEYS, "出处")
  return {
    provider: enumeration(provenance.provider, PROVIDERS, "来源提供方"),
    method: enumeration(provenance.method, METHODS, "来源方法"),
    batch_id: identity(provenance.batch_id, "批次 ID"),
    query_id: identity(provenance.query_id, "查询 ID", { nullable: true }),
    import_id: identity(provenance.import_id, "导入 ID", { nullable: true }),
    retrieved_at: instant(provenance.retrieved_at, "来源获取时间"),
    public_url: publicUrl(provenance.public_url),
    verification: enumeration(provenance.verification, VERIFICATIONS, "来源核验状态"),
  }
}

function normalizeRetraction(value) {
  const retraction = readExactObject(value, RETRACTION_KEYS, "撤稿信息")
  return {
    state: enumeration(retraction.state, RETRACTION_STATES, "撤稿状态"),
    source_url: publicUrl(retraction.source_url),
    checked_at: instant(retraction.checked_at, "撤稿核验时间", { nullable: true }),
  }
}

export function normalizeDiscoveryRecord(input) {
  const record = readExactObject(input, RECORD_KEYS, "来源记录")
  return {
    record_id: identity(record.record_id, "记录 ID"),
    provider_id: identity(record.provider_id, "提供方 ID", { nullable: true }),
    bibliography: normalizeBibliography(record.bibliography),
    provenance: normalizeProvenance(record.provenance),
    retraction: normalizeRetraction(record.retraction),
  }
}

function samePlainData(left, right) {
  if (left === right) return true
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
  let leftPrototype
  let rightPrototype
  let leftKeys
  let rightKeys
  let leftDescriptors
  let rightDescriptors
  try {
    leftPrototype = Object.getPrototypeOf(left)
    rightPrototype = Object.getPrototypeOf(right)
    leftKeys = Reflect.ownKeys(left)
    rightKeys = Reflect.ownKeys(right)
    leftDescriptors = Object.getOwnPropertyDescriptors(left)
    rightDescriptors = Object.getOwnPropertyDescriptors(right)
  } catch {
    return false
  }
  if (leftPrototype !== rightPrototype || leftKeys.length !== rightKeys.length) return false
  const rightKeySet = new Set(rightKeys)
  for (const key of leftKeys) {
    if (!rightKeySet.has(key)) return false
    const leftDescriptor = leftDescriptors[key]
    const rightDescriptor = rightDescriptors[key]
    if (!("value" in leftDescriptor) || !("value" in rightDescriptor)) return false
    if (!samePlainData(leftDescriptor.value, rightDescriptor.value)) return false
  }
  return true
}

export function isValidDiscoveryRecord(value) {
  try {
    const normalized = normalizeDiscoveryRecord(value)
    return samePlainData(normalized, value)
  } catch {
    return false
  }
}

function normalizeScope(value) {
  const scope = readExactObject(value, SCOPE_KEYS, "检索范围")
  const normalized = {
    startYear: year(scope.startYear, "起始年份"),
    endYear: year(scope.endYear, "结束年份"),
    language: enumeration(scope.language, SCOPE_LANGUAGES, "范围语言"),
  }
  if (normalized.startYear !== null && normalized.endYear !== null && normalized.startYear > normalized.endYear) {
    fail("检索范围")
  }
  return normalized
}

export function classifyDiscoveryScope(record, scope) {
  if (!isValidDiscoveryRecord(record)) fail("来源记录")
  const normalizedScope = normalizeScope(scope)

  if (record.retraction.state === "retracted") {
    return { status: "excluded", reasons: ["retracted"] }
  }

  const excluded = []
  const publicationYear = record.bibliography.year
  if (publicationYear !== null && normalizedScope.startYear !== null && publicationYear < normalizedScope.startYear) {
    excluded.push("year_before_start")
  }
  if (publicationYear !== null && normalizedScope.endYear !== null && publicationYear > normalizedScope.endYear) {
    excluded.push("year_after_end")
  }
  if (
    record.bibliography.language !== null && normalizedScope.language !== "all" &&
    record.bibliography.language !== normalizedScope.language
  ) excluded.push("language_mismatch")
  if (excluded.length > 0) return { status: "excluded", reasons: excluded }

  const pending = []
  if (publicationYear === null && (normalizedScope.startYear !== null || normalizedScope.endYear !== null)) {
    pending.push("year_unknown")
  }
  if (record.bibliography.language === null && normalizedScope.language !== "all") {
    pending.push("language_unknown")
  }
  if (record.retraction.state === "unknown") pending.push("retraction_unknown")
  if (pending.length > 0) return { status: "pending", reasons: pending }

  return { status: "included", reasons: [] }
}
