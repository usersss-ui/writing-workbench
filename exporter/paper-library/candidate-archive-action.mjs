import { isAbsolute } from "node:path"

import {
  CandidateArchiveError,
  archiveCandidateMetadata,
  validateArchiveRequest,
  verifyArchiveRecoveryProof,
} from "./candidate-archive.mjs"
import { loadPrivateLibraryContext, rebuildConfiguredLibrary } from "./runtime.mjs"

const RECOVERY_REQUEST_KEYS = Object.freeze([
  "confirmation",
  "archive_source_id",
  "paper_id",
  "openalex_id",
])
const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const PAPER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const OPENALEX_ID = /^W[1-9]\d*$/u
const DOI = /^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u

export class CandidateArchiveActionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "CandidateArchiveActionError"
    this.code = code
  }
}

function actionError(code, message) {
  return new CandidateArchiveActionError(code, message)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactData(value, expectedKeys) {
  if (!isPlainObject(value)) return null
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
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

function validateRecoveryRequest(raw) {
  const data = exactData(raw, RECOVERY_REQUEST_KEYS)
  if (
    !data
    || data.confirmation !== "retry_archive_rebuild"
    || typeof data.archive_source_id !== "string"
    || !SOURCE_ID.test(data.archive_source_id)
    || typeof data.paper_id !== "string"
    || !PAPER_ID.test(data.paper_id)
    || data.paper_id.includes("/")
    || data.paper_id.includes("\\")
    || typeof data.openalex_id !== "string"
    || !OPENALEX_ID.test(data.openalex_id)
  ) throw actionError("INVALID_REQUEST", "归档恢复请求无效")
  return Object.freeze({
    confirmation: "retry_archive_rebuild",
    archive_source_id: data.archive_source_id,
    paper_id: data.paper_id,
    openalex_id: data.openalex_id,
  })
}

function sameRecoveryTuple(left, right) {
  return left?.archive_source_id === right?.archive_source_id
    && left?.paper_id === right?.paper_id
    && left?.openalex_id === right?.openalex_id
}

export function createArchiveRecoveryStore() {
  let record = null
  return Object.freeze({
    save(recovery, proof) {
      if (
        record !== null
        || recovery?.kind !== "candidate_archive"
        || recovery?.reason_code !== "ARCHIVE_REBUILD_FAILED"
        || !sameRecoveryTuple(recovery, proof)
      ) throw actionError("ARCHIVE_TRANSACTION_AMBIGUOUS", "归档恢复证明无法安全保存")
      record = Object.freeze({
        recovery: Object.freeze({ ...recovery }),
        proof,
      })
    },
    require(recovery) {
      if (!record || !sameRecoveryTuple(record.recovery, recovery)) {
        throw actionError("ARCHIVE_CONFLICT", "归档恢复证明不存在或不匹配")
      }
      return record.proof
    },
    clear(recovery) {
      if (!record || !sameRecoveryTuple(record.recovery, recovery)) {
        throw actionError("ARCHIVE_CONFLICT", "归档恢复证明不存在或不匹配")
      }
      record = null
    },
    size: () => record === null ? 0 : 1,
  })
}

function validateCompleteContext(context) {
  const sources = context?.config?.sources
  const auditSources = context?.scanned?.audit?.sources
  const papers = context?.scanned?.papers
  const blocking = context?.scanned?.audit?.blocking
  const identities = context?.scanned?.audit?.archive_identity_lookup
  if (
    !Array.isArray(sources)
    || sources.length === 0
    || !Array.isArray(auditSources)
    || auditSources.length !== sources.length
    || !Array.isArray(papers)
    || !isPlainObject(blocking)
    || !isPlainObject(identities)
  ) throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描不完整")

  const configured = new Map()
  for (const source of sources) {
    if (
      !source
      || typeof source.source_id !== "string"
      || !SOURCE_ID.test(source.source_id)
      || configured.has(source.source_id)
      || typeof source.path !== "string"
      || !isAbsolute(source.path)
    ) throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描不完整")
    configured.set(source.source_id, source.path)
  }
  const observed = new Set()
  for (const source of auditSources) {
    if (
      !source
      || typeof source.source_id !== "string"
      || observed.has(source.source_id)
      || configured.get(source.source_id) !== source.root_path
      || !Number.isInteger(source.scanned_directories)
      || source.scanned_directories < 1
    ) throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描不完整")
    observed.add(source.source_id)
  }
  if (observed.size !== configured.size || [...configured.keys()].some((sourceId) => !observed.has(sourceId))) {
    throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描不完整")
  }
  for (const items of Object.values(blocking)) {
    if (!Array.isArray(items) || items.length > 0) throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描存在阻塞项")
  }
  const identityValues = Object.values(identities)
  if (
    identityValues.some((identity) => typeof identity !== "string" || !/^openalex:W[1-9]\d*$/u.test(identity))
    || new Set(identityValues).size !== identityValues.length
  ) throw actionError("ARCHIVE_SCAN_INCOMPLETE", "归档来源身份审计不明确")
  return context
}

function selectArchiveSource(context, request) {
  const configuredId = context.config?.archive_source_id
  if (typeof configuredId !== "string" || configuredId !== request.archive_source_id) {
    throw actionError("ARCHIVE_CONFLICT", "归档来源已变化")
  }
  const matches = context.config.sources.filter((source) => source.source_id === configuredId)
  if (matches.length !== 1) throw actionError("ARCHIVE_CONFLICT", "归档来源已变化")
  return matches[0]
}

function normalizeDoi(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
    .replace(/^doi:\s*/iu, "")
    .toLocaleLowerCase("en-US")
  return DOI.test(normalized) && !normalized.includes("//") ? normalized : null
}

function openAlexIdentityFromLocator(value) {
  if (typeof value !== "string") return null
  const match = /^https:\/\/(?:openalex\.org\/|api\.openalex\.org\/works\/)(W[1-9]\d*)\/?$/iu.exec(value.trim())
  return match ? `openalex:${match[1].toUpperCase()}` : null
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function exactControlledPackage(context, request) {
  const paper = context.papersById instanceof Map
    ? context.papersById.get(request.paper_id)
    : context.scanned.papers.find((candidate) => candidate?.paper_id === request.paper_id)
  const identity = `openalex:${request.candidate.paperId}`
  const expectedLocator = request.candidate.doi === null
    ? `https://openalex.org/${request.candidate.paperId}`
    : normalizeDoi(request.candidate.doi)
  const observedLocator = request.candidate.doi === null
    ? paper?.doi_or_url
    : normalizeDoi(paper?.doi_or_url)
  return Boolean(
    paper
    && paper.source_id === request.archive_source_id
    && paper.relative_path === request.paper_id
    && context.scanned.audit.archive_identity_lookup[request.paper_id] === identity
    && paper.title_original === request.candidate.title
    && arraysEqual(paper.authors, request.candidate.authors)
    && (paper.publication_year ?? paper.year ?? null) === request.candidate.year
    && paper.venue === request.candidate.source
    && observedLocator === expectedLocator
  )
}

function hasAnyConflict(context, request) {
  const requestedDoi = normalizeDoi(request.candidate.doi)
  const requestedIdentity = `openalex:${request.candidate.paperId}`
  if (Object.values(context.scanned.audit.archive_identity_lookup).includes(requestedIdentity)) return true
  return context.scanned.papers.some((paper) => (
    paper?.paper_id === request.paper_id
    || (requestedDoi !== null && normalizeDoi(paper?.doi_or_url) === requestedDoi)
    || openAlexIdentityFromLocator(paper?.doi_or_url) === requestedIdentity
  ))
}

function existingDisposition(context, request) {
  if (exactControlledPackage(context, request)) return "rebuild"
  if (hasAnyConflict(context, request)) return "conflict"
  return "available"
}

function recoveryRecord(request) {
  return Object.freeze({
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: request.archive_source_id,
    paper_id: request.paper_id,
    openalex_id: request.candidate.paperId,
  })
}

async function markManualArchive(markRecovery) {
  if (typeof markRecovery !== "function") throw actionError("ARCHIVE_TRANSACTION_AMBIGUOUS", "归档事务需要人工恢复")
  await markRecovery({ kind: "manual_archive", reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS" })
}

function paperCount(result) {
  return Number.isInteger(result?.paperCount) && result.paperCount >= 0 ? result.paperCount : null
}

export async function archiveCandidateAndRebuild({
  repoRoot,
  request: rawRequest,
  loadContext = loadPrivateLibraryContext,
  archive = archiveCandidateMetadata,
  rebuild = rebuildConfiguredLibrary,
  markRecovery,
  recoveryStore = null,
} = {}) {
  let request
  try {
    request = validateArchiveRequest(rawRequest)
  } catch {
    throw actionError("INVALID_REQUEST", "候选归档请求无效")
  }
  if (typeof loadContext !== "function" || typeof archive !== "function" || typeof rebuild !== "function") {
    throw actionError("INTERNAL_ERROR", "归档运行依赖无效")
  }

  let context
  try {
    context = validateCompleteContext(await loadContext({ repoRoot }))
  } catch (error) {
    if (error instanceof CandidateArchiveActionError) throw error
    throw actionError("ARCHIVE_SCAN_INCOMPLETE", "论文来源扫描不完整")
  }
  const source = selectArchiveSource(context, request)
  const disposition = existingDisposition(context, request)
  if (disposition === "rebuild") throw actionError("ARCHIVE_REBUILD_REQUIRED", "受控资料包已存在，需要重新构建")
  if (disposition === "conflict") throw actionError("ARCHIVE_CONFLICT", "候选归档身份与现有资料冲突")

  let archived
  try {
    archived = await archive({
      sourceRoot: source.path,
      sourceId: source.source_id,
      existingPapers: context.scanned.papers,
      existingArchiveIdentities: Object.values(context.scanned.audit.archive_identity_lookup),
      request,
    })
  } catch (error) {
    if (error?.code === "ARCHIVE_TRANSACTION_AMBIGUOUS") {
      await markManualArchive(markRecovery)
      throw error
    }
    if (error?.code === "ARCHIVE_CONFLICT") throw actionError("ARCHIVE_CONFLICT", "候选归档身份与现有资料冲突")
    if (error instanceof TypeError) throw actionError("INVALID_REQUEST", "候选归档请求无效")
    if (error instanceof CandidateArchiveError) throw actionError(error.code, "候选归档事务失败")
    throw actionError("ARCHIVE_WRITE_FAILED", "候选归档事务失败")
  }

  const proof = Object.getOwnPropertyDescriptor(archived, "recoveryProof")?.value ?? null
  try {
    const refreshed = validateCompleteContext(await loadContext({ repoRoot }))
    selectArchiveSource(refreshed, request)
    if (!exactControlledPackage(refreshed, request)) throw actionError("ARCHIVE_CONFLICT", "新归档资料包无法确认")
    const result = await rebuild({ repoRoot, context: refreshed })
    const count = paperCount(result)
    if (count === null) throw actionError("ARCHIVE_REBUILD_FAILED", "论文库重建结果无效")
    return Object.freeze({
      status: "created",
      paper_id: archived.paper_id,
      folder_name: archived.folder_name,
      rebuild_status: "complete",
      paper_count: count,
    })
  } catch {
    if (!proof || !recoveryStore || typeof recoveryStore.save !== "function") {
      await markManualArchive(markRecovery)
      throw actionError("ARCHIVE_TRANSACTION_AMBIGUOUS", "归档恢复证明不可用")
    }
    const recovery = recoveryRecord(request)
    try {
      recoveryStore.save(recovery, proof)
      await markRecovery(recovery)
    } catch (error) {
      try { recoveryStore.clear(recovery) } catch { /* coordinator state remains authoritative */ }
      throw error
    }
    return Object.freeze({
      status: "created",
      paper_id: archived.paper_id,
      folder_name: archived.folder_name,
      rebuild_status: "failed",
      paper_count: null,
    })
  }
}

function exactRecoveryPackage(context, request) {
  const paper = context.papersById instanceof Map
    ? context.papersById.get(request.paper_id)
    : context.scanned.papers.find((candidate) => candidate?.paper_id === request.paper_id)
  return Boolean(
    paper
    && paper.source_id === request.archive_source_id
    && paper.relative_path === request.paper_id
    && context.scanned.audit.archive_identity_lookup[request.paper_id] === `openalex:${request.openalex_id}`
  )
}

export async function rebuildArchivedCandidate({
  repoRoot,
  request: rawRequest,
  recovery,
  loadContext = loadPrivateLibraryContext,
  rebuild = rebuildConfiguredLibrary,
  clearRecovery,
  recoveryStore,
} = {}) {
  const request = validateRecoveryRequest(rawRequest)
  if (
    recovery?.kind !== "candidate_archive"
    || recovery?.reason_code !== "ARCHIVE_REBUILD_FAILED"
    || !sameRecoveryTuple(recovery, request)
  ) throw actionError("ARCHIVE_CONFLICT", "归档恢复身份不匹配")
  if (!recoveryStore || typeof recoveryStore.require !== "function") {
    throw actionError("ARCHIVE_CONFLICT", "归档恢复证明不存在")
  }
  const proof = recoveryStore.require(recovery)

  let context
  try {
    context = validateCompleteContext(await loadContext({ repoRoot }))
    if (!exactRecoveryPackage(context, request)) throw new Error("identity mismatch")
    await verifyArchiveRecoveryProof({ proof, request })
  } catch {
    throw actionError("ARCHIVE_CONFLICT", "归档资料包已变化，拒绝恢复")
  }

  let result
  try {
    result = await rebuild({ repoRoot, context })
  } catch {
    throw actionError("ARCHIVE_RECOVERY_FAILED", "论文库恢复构建失败")
  }
  const count = paperCount(result)
  if (count === null) throw actionError("ARCHIVE_RECOVERY_FAILED", "论文库恢复构建结果无效")
  try {
    await verifyArchiveRecoveryProof({ proof, request })
  } catch {
    throw actionError("ARCHIVE_CONFLICT", "归档资料包在恢复构建期间发生变化")
  }
  if (typeof clearRecovery !== "function") throw actionError("INTERNAL_ERROR", "归档恢复依赖无效")
  await clearRecovery()
  recoveryStore.clear(recovery)
  return Object.freeze({
    status: "recovered",
    paper_id: request.paper_id,
    rebuild_status: "complete",
    paper_count: count,
  })
}
