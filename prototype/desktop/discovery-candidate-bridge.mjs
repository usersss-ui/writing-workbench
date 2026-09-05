import { fetchOpenAlexWorkByDoi, readVerifiedOpenAlexWork } from "./openalex-search.mjs"
import { isValidDiscoveryRecord, normalizeDiscoveryRecord } from "./discovery-record.mjs"
import { discoveryTitleConflict } from "./bibliography-normalization.mjs"

const unavailable = reason => ({ status: "unverified", reason })
const conflict = reason => ({ status: "conflict", reason })
const RESULT_KEYS = ["result_id", "record_ids", "preferred_record_id", "alias_ids", "identity_status", "conflicts"]
const validId = value => typeof value === "string" && value.length > 0 && [...value].length <= 2048 &&
  value === value.trim() && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)

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
    if (discoveryTitleConflict(original.title, verified.bibliography.title)) return conflict("title_mismatch")
    if (original.work_type && verified.bibliography.work_type && original.work_type !== verified.bibliography.work_type) {
      return conflict("publication_type_mismatch")
    }
  }
  return { status: "verified", token, work: verified.work }
}
