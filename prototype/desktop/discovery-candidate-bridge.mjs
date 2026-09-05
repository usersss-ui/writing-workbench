import { fetchOpenAlexWorkByDoi, readVerifiedOpenAlexWork } from "./openalex-search.mjs"
import { isValidDiscoveryRecord, normalizeDiscoveryRecord } from "./discovery-record.mjs"

const unavailable = reason => ({ status: "unverified", reason })
const conflict = reason => ({ status: "conflict", reason })
const RESULT_KEYS = ["result_id", "record_ids", "preferred_record_id", "alias_ids", "identity_status", "conflicts"]
const validId = value => typeof value === "string" && value.length > 0 && value.length <= 2048 &&
  value === value.trim() && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)

function titleText(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim()
}

function publicationLabel(value) {
  const title = value.normalize("NFKC").toLowerCase().trim()
  const label = "(?:correction|corrigendum|erratum|retraction|preprint(?:\\s+version\\s+\\d+)?|version\\s+\\d+)"
  // Require a publication label at a title boundary, not a word in the subject.
  const match = title.match(new RegExp(`^(?:a\\s+)?(${label})(?:\\s+(?:to|of))?\\s*:`, "u")) ??
    title.match(/^(?:a\s+)?(correction|corrigendum|erratum|retraction)\s+(?:to|of)\s+/u) ??
    title.match(new RegExp(`(?:[:;,]\\s*(?:a\\s+)?(${label})|[[(]\\s*(${label})\\s*[\\])])\\.?$`, "u"))
  return titleText(match?.[1] ?? match?.[2] ?? "")
}

function comparableTitleScript(value) {
  const letters = value.match(/\p{L}/gu)?.length ?? 0
  // Lexical dissimilarity is usable only for comparable title text. Other or
  // mixed scripts remain unknown; a matching DOI is not disproved by translation.
  if ((value.match(/\p{Script=Latin}/gu)?.length ?? 0) > letters / 2) return "latin"
  if ((value.match(/\p{Script=Han}/gu)?.length ?? 0) > letters / 2) return "han"
  return null
}

function titleConflict(left, right) {
  const a = titleText(left)
  const b = titleText(right)
  if (a === b) return false
  // The API adapter's missing-title fallback is not bibliographic evidence.
  if (!a || !b || a === "not reported" || b === "not reported") return false
  // Correction/retraction/version labels must not be hidden by a shared base title.
  if (publicationLabel(left) !== publicationLabel(right)) return true
  const script = comparableTitleScript(a)
  if (script === null || script !== comparableTitleScript(b)) return false
  if (a.includes(b) || b.includes(a)) return false
  const grams = value => {
    const characters = [...value]
    return new Set(characters.slice(1).map((character, index) => characters[index] + character))
  }
  const ag = grams(a)
  const bg = grams(b)
  const common = [...ag].filter(gram => bg.has(gram)).length
  return [...a].length >= 12 && [...b].length >= 12 && 2 * common / (ag.size + bg.size) < 0.3
}

export async function prepareExternalCandidateConversion({ result, records, fetchImpl, signal } = {}) {
  if (!result || Object.getPrototypeOf(result) !== Object.prototype ||
    Reflect.ownKeys(result).length !== RESULT_KEYS.length || !RESULT_KEYS.every(key => Object.hasOwn(result, key)) ||
    !validId(result.result_id) || !Array.isArray(result.alias_ids) || result.alias_ids.length > 1000 ||
    !result.alias_ids.every(validId) || new Set([result.result_id, ...result.alias_ids]).size !== result.alias_ids.length + 1) {
    return unavailable("invalid_identity")
  }
  if (result?.identity_status === "conflict" || (Array.isArray(result?.conflicts) && result.conflicts.length)) {
    return conflict("identity_conflict")
  }
  if (result?.identity_status !== "clear" || !Array.isArray(result.conflicts) ||
    !Array.isArray(result.record_ids) || !result.record_ids.length || result.record_ids.length > 1000 || !result.record_ids.every(validId) ||
    new Set(result.record_ids).size !== result.record_ids.length ||
    !result.record_ids.includes(result.preferred_record_id) || !Array.isArray(records) || records.length > 1000) {
    return unavailable("invalid_identity")
  }
  const selected = []
  for (const id of result.record_ids) {
    const matches = records.filter(record => record?.record_id === id)
    if (matches.length !== 1 || !isValidDiscoveryRecord(matches[0])) return unavailable("missing_or_invalid_record")
    // Snapshot before awaiting the request; UI confirmation must separately recheck live batch/result.
    selected.push(normalizeDiscoveryRecord(matches[0]))
  }
  const dois = new Set(selected.map(record => record.bibliography.doi).filter(Boolean))
  if (dois.size > 1) return conflict("doi_conflict")
  if (!dois.size) return unavailable("doi_missing")
  if (selected.some(record => record.retraction.state === "retracted")) return conflict("retracted")

  let token
  try {
    token = await fetchOpenAlexWorkByDoi({ doi: [...dois][0], fetchImpl, signal })
  } catch (error) {
    if (error?.name === "AbortError" || error?.retryable) throw error
    if (error?.code === "doi_mismatch") return conflict("doi_mismatch")
    return unavailable(error?.code ?? "invalid_response")
  }
  const verified = readVerifiedOpenAlexWork(token)
  if (verified.retraction.state === "retracted") return conflict("retracted")
  for (const record of selected) {
    const original = record.bibliography
    if (titleConflict(original.title, verified.bibliography.title)) return conflict("title_mismatch")
    if (original.work_type && verified.bibliography.work_type && original.work_type !== verified.bibliography.work_type) {
      return conflict("publication_type_mismatch")
    }
  }
  return { status: "verified", token, work: verified.work }
}
