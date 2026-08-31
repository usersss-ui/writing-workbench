import { createHash } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { ARCHIVE_COMMIT_FILE, serializeArchiveCommit, serializeArchiveMetadata } from "./archive-metadata.mjs"
import { isValidPaperId } from "./overrides.mjs"

const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const OPENALEX_ID = /^W[1-9]\d*$/u
const OPENALEX_IDENTITY = /^openalex:W[1-9]\d*$/u
const OPENALEX_RESOLVER = /^https:\/\/(?:openalex\.org\/|api\.openalex\.org\/works\/)(W[1-9]\d*)\/?$/iu
const DOI = /^10\.\d{4,9}\/[\-._;()/:a-z0-9]+$/u
const REQUEST_KEYS = Object.freeze(["version", "confirmation", "archive_source_id", "paper_id", "candidate"])
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
const DEFAULT_FILE_SYSTEM = Object.freeze({
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  noFollowFlag: constants.O_NOFOLLOW,
})

export class CandidateArchiveError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "CandidateArchiveError"
    this.code = code
  }
}

function archiveError(code, message) {
  return new CandidateArchiveError(code, message)
}

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

function denseArrayValues(value) {
  if (!Array.isArray(value)) return null
  let descriptors
  let keys
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return null
  }
  const length = descriptors.length?.value
  if (!Number.isInteger(length) || length < 0) return null
  const expected = [...Array.from({ length }, (_, index) => String(index)), "length"]
  if (keys.some((key) => typeof key !== "string") || keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return null
  const items = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null
    items.push(descriptor.value)
  }
  return items
}

export function validateArchiveRequest(raw) {
  const data = exactOwnData(raw, REQUEST_KEYS)
  if (!data || data.version !== 1) throw new TypeError("归档请求格式无效")
  if (data.confirmation !== "create_metadata_only") throw new TypeError("缺少元数据归档二次确认")
  if (typeof data.archive_source_id !== "string" || !SOURCE_ID.test(data.archive_source_id)) {
    throw new TypeError("归档请求来源格式无效")
  }
  if (!isValidPaperId(data.paper_id) || data.paper_id.includes("/") || data.paper_id.includes("\\")) {
    throw new TypeError("归档请求 paper_id 格式无效")
  }
  const candidateData = exactOwnData(data.candidate, CANDIDATE_KEYS)
  if (!candidateData) throw new TypeError("候选归档请求格式无效")
  if (typeof candidateData.paperId !== "string" || !OPENALEX_ID.test(candidateData.paperId)) {
    throw new TypeError("候选 OpenAlex 身份格式无效")
  }
  if (candidateData.stage !== "confirmed_for_archive") throw new TypeError("候选论文尚未确认进入待归档区")
  serializeArchiveMetadata({
    paperId: data.paper_id,
    archiveSourceId: data.archive_source_id,
    candidate: data.candidate,
    archivedAt: "2000-01-01T00:00:00.000Z",
  })
  const authors = denseArrayValues(candidateData.authors)
  const topics = denseArrayValues(candidateData.topics)
  if (!authors || !topics) throw new TypeError("候选归档请求格式无效")
  const candidate = Object.freeze({ ...candidateData, authors: Object.freeze(authors), topics: Object.freeze(topics) })
  return Object.freeze({
    version: 1,
    confirmation: "create_metadata_only",
    archive_source_id: data.archive_source_id,
    paper_id: data.paper_id,
    candidate,
  })
}

function normalizeDoi(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
    .replace(/^doi:\s*/iu, "")
    .toLocaleLowerCase("en-US")
  if (normalized.length === 0 || normalized.length > 512 || !DOI.test(normalized) || normalized.includes("//")) return null
  const suffix = normalized.slice(normalized.indexOf("/") + 1)
  if (suffix.split("/").some((segment) => segment === "." || segment === "..")) return null
  return normalized
}

function normalizeOpenAlexIdentity(value) {
  if (typeof value !== "string") return null
  const match = OPENALEX_RESOLVER.exec(value.trim())
  return match ? `openalex:W${match[1].slice(1)}` : null
}

function paperFields(paper) {
  if (!isPlainObject(paper)) throw new TypeError("既有论文索引格式无效")
  const paperId = Object.getOwnPropertyDescriptor(paper, "paper_id")
  const doiOrUrl = Object.getOwnPropertyDescriptor(paper, "doi_or_url")
  if (
    !paperId?.enumerable
    || !Object.hasOwn(paperId, "value")
    || typeof paperId.value !== "string"
    || !doiOrUrl?.enumerable
    || !Object.hasOwn(doiOrUrl, "value")
    || typeof doiOrUrl.value !== "string"
  ) throw new TypeError("既有论文索引格式无效")
  return { paperId: paperId.value, doiOrUrl: doiOrUrl.value }
}

function validateExistingArchiveIdentities(value) {
  const identities = denseArrayValues(value)
  if (!identities || identities.some((identity) => typeof identity !== "string" || !OPENALEX_IDENTITY.test(identity))) {
    throw new TypeError("既有归档来源身份索引格式无效")
  }
  if (new Set(identities).size !== identities.length) throw new TypeError("既有归档来源身份索引格式无效")
  return new Set(identities)
}

function assertNoDuplicate({ existingPapers, existingArchiveIdentities, request }) {
  const papers = denseArrayValues(existingPapers)
  if (!papers) throw new TypeError("既有论文索引格式无效")
  const identities = validateExistingArchiveIdentities(existingArchiveIdentities)
  const requestedDoi = normalizeDoi(request.candidate.doi)
  const requestedIdentity = `openalex:${request.candidate.paperId}`
  if (identities.has(requestedIdentity)) throw archiveError("ARCHIVE_CONFLICT", "相同归档来源身份已存在，未执行归档")

  for (const paper of papers) {
    const existing = paperFields(paper)
    if (existing.paperId === request.paper_id) throw archiveError("ARCHIVE_CONFLICT", "论文 ID 已存在，未执行归档")
    const existingDoi = normalizeDoi(existing.doiOrUrl)
    if (requestedDoi && existingDoi === requestedDoi) throw archiveError("ARCHIVE_CONFLICT", "相同 DOI 已存在，未执行归档")
    if (normalizeOpenAlexIdentity(existing.doiOrUrl) === requestedIdentity) {
      throw archiveError("ARCHIVE_CONFLICT", "相同归档来源身份已存在，未执行归档")
    }
  }
}

function isInside(root, target) {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === "" || (
    pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  )
}

function identityFingerprint(info) {
  return `${info.dev}:${info.ino}`
}

function contentFingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function acquireSourceRoot(sourceRoot, io) {
  if (typeof sourceRoot !== "string" || !isAbsolute(sourceRoot) || resolve(sourceRoot) !== sourceRoot) {
    throw new Error("论文根目录必须是规范绝对路径")
  }
  let before
  let canonical
  let handle = null
  try {
    before = await io.lstat(sourceRoot, { bigint: true })
    canonical = await io.realpath(sourceRoot)
    if (canonical !== sourceRoot || before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error("invalid root")
    }
    handle = await io.open(
      canonical,
      constants.O_RDONLY | constants.O_DIRECTORY | io.noFollowFlag,
    )
    const opened = await handle.stat({ bigint: true })
    const after = await io.lstat(sourceRoot, { bigint: true })
    const canonicalAfter = await io.realpath(sourceRoot)
    const identity = identityFingerprint(before)
    if (
      !opened.isDirectory()
      || after.isSymbolicLink()
      || !after.isDirectory()
      || identityFingerprint(opened) !== identity
      || identityFingerprint(after) !== identity
      || canonicalAfter !== canonical
    ) throw new Error("invalid root")
    return Object.freeze({ requestedPath: sourceRoot, path: canonical, identity, handle })
  } catch {
    if (handle) {
      try { await handle.close() } catch { /* the validation error remains authoritative */ }
    }
    throw new Error("论文根目录不存在或不可访问")
  }
}

async function assertRootAnchor(anchor, io) {
  const opened = await anchor.handle.stat({ bigint: true })
  const lexical = await io.lstat(anchor.requestedPath, { bigint: true })
  const canonical = await io.realpath(anchor.requestedPath)
  const canonicalInfo = await io.lstat(anchor.path, { bigint: true })
  if (
    !opened.isDirectory()
    || lexical.isSymbolicLink()
    || !lexical.isDirectory()
    || canonicalInfo.isSymbolicLink()
    || !canonicalInfo.isDirectory()
    || identityFingerprint(opened) !== anchor.identity
    || identityFingerprint(lexical) !== anchor.identity
    || identityFingerprint(canonicalInfo) !== anchor.identity
    || canonical !== anchor.path
  ) throw new Error("论文根目录锚点在事务期间发生变化")
}

async function lstatIfPresent(path, io) {
  try {
    return await io.lstat(path, { bigint: true })
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io }) {
  await assertRootAnchor(rootAnchor, io)
  const info = await io.lstat(packagePath, { bigint: true })
  const canonical = await io.realpath(packagePath)
  if (
    info.isSymbolicLink()
    || !info.isDirectory()
    || identityFingerprint(info) !== packageIdentity
    || canonical !== packagePath
    || !isInside(rootAnchor.path, canonical)
  ) throw new Error("归档目标目录在事务期间发生变化")
  await assertRootAnchor(rootAnchor, io)
}

async function verifyExpectedFile({ path, expectedIdentity, expectedSize, expectedHash, io }) {
  let handle = null
  try {
    const lexical = await io.lstat(path, { bigint: true })
    if (
      lexical.isSymbolicLink()
      || !lexical.isFile()
      || identityFingerprint(lexical) !== expectedIdentity
      || Number(lexical.size) !== expectedSize
      || Number(lexical.nlink) !== 1
    ) throw new Error("归档文件身份或大小校验失败")
    handle = await io.open(path, constants.O_RDONLY | io.noFollowFlag)
    const before = await handle.stat({ bigint: true })
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || identityFingerprint(before) !== expectedIdentity
      || Number(before.size) !== expectedSize
      || Number(before.nlink) !== 1
    ) throw new Error("归档文件身份或大小校验失败")
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (
      !after.isFile()
      || identityFingerprint(after) !== expectedIdentity
      || Number(after.size) !== expectedSize
      || Number(after.nlink) !== 1
      || bytes.length !== expectedSize
      || contentFingerprint(bytes) !== expectedHash
    ) throw new Error("归档文件内容校验失败")
    return Object.freeze({ identity: expectedIdentity, size: expectedSize, hash: expectedHash })
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* verification failure remains authoritative */ }
    }
  }
}

async function writeArchiveCommitMarker({
  markerPath,
  markerBytes,
  packagePath,
  packageIdentity,
  rootAnchor,
  metadataPath,
  metadataIdentity,
  metadataSize,
  metadataHash,
  io,
}) {
  const markerSize = markerBytes.length
  const markerHash = contentFingerprint(markerBytes)
  let markerIdentity = null
  let handle = null
  let phase = "precommit"

  const proveMetadataAndParent = async () => {
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
    await verifyExpectedFile({
      path: metadataPath,
      expectedIdentity: metadataIdentity,
      expectedSize: metadataSize,
      expectedHash: metadataHash,
      io,
    })
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
  }

  const validateHandle = async (candidateHandle) => {
    const before = await candidateHandle.stat({ bigint: true })
    if (
      !before.isFile()
      || identityFingerprint(before) !== markerIdentity
      || Number(before.size) !== markerSize
      || Number(before.nlink) !== 1
    ) throw new Error("归档提交标记身份校验失败")
    if (typeof candidateHandle.sync !== "function") throw new Error("归档提交标记同步不可用")
    await candidateHandle.sync()
    const observed = Buffer.alloc(markerSize)
    const { bytesRead } = await candidateHandle.read(observed, 0, markerSize, 0)
    const after = await candidateHandle.stat({ bigint: true })
    if (
      bytesRead !== markerSize
      || !after.isFile()
      || identityFingerprint(after) !== markerIdentity
      || Number(after.size) !== markerSize
      || Number(after.nlink) !== 1
      || contentFingerprint(observed) !== markerHash
    ) throw new Error("归档提交标记内容校验失败")
  }

  try {
    await proveMetadataAndParent()
    handle = await io.open(
      markerPath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | io.noFollowFlag,
      0o600,
    )
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || Number(opened.size) !== 0 || Number(opened.nlink) !== 1) {
      throw new Error("归档提交标记无效")
    }
    markerIdentity = identityFingerprint(opened)
    phase = "commit_io"
    await handle.writeFile(markerBytes)
    await validateHandle(handle)
    await handle.close()
    handle = null
    phase = "post_validation"
    await proveMetadataAndParent()
    await verifyExpectedFile({
      path: markerPath,
      expectedIdentity: markerIdentity,
      expectedSize: markerSize,
      expectedHash: markerHash,
      io,
    })
    await proveMetadataAndParent()
    return Object.freeze({ identity: markerIdentity, size: markerSize, hash: markerHash })
  } catch (error) {
    if (["commit_io", "post_validation"].includes(phase) && markerIdentity) {
      let reconciliationHandle = handle
      try {
        await proveMetadataAndParent()
        if (reconciliationHandle) {
          try {
            await reconciliationHandle.stat({ bigint: true })
          } catch (handleError) {
            if (handleError?.code !== "EBADF") throw handleError
            try { await reconciliationHandle.close() } catch { /* already closed */ }
            if (reconciliationHandle === handle) handle = null
            reconciliationHandle = null
          }
        }
        if (!reconciliationHandle) reconciliationHandle = await io.open(markerPath, constants.O_RDWR | io.noFollowFlag)
        await validateHandle(reconciliationHandle)
        await reconciliationHandle.close()
        if (reconciliationHandle === handle) handle = null
        reconciliationHandle = null
        await proveMetadataAndParent()
        await verifyExpectedFile({
          path: markerPath,
          expectedIdentity: markerIdentity,
          expectedSize: markerSize,
          expectedHash: markerHash,
          io,
        })
        await proveMetadataAndParent()
        return Object.freeze({ identity: markerIdentity, size: markerSize, hash: markerHash })
      } catch {
        if (reconciliationHandle) {
          try { await reconciliationHandle.close() } catch { /* recovery remains blocked */ }
          if (reconciliationHandle === handle) handle = null
        }
      }
    }
    throw error
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* recovery remains blocked */ }
    }
  }
}

const ARCHIVE_PACKAGE_ENTRIES = Object.freeze([ARCHIVE_COMMIT_FILE, "metadata.yaml"].sort())

async function captureArchiveRecoveryProof({
  request,
  rootAnchor,
  packagePath,
  packageIdentity,
  metadataPath,
  metadataIdentity,
  metadataSize,
  metadataHash,
  markerPath,
  markerProof,
  io,
}) {
  await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
  const entries = (await io.readdir(packagePath)).sort((left, right) => left.localeCompare(right))
  if (
    entries.length !== ARCHIVE_PACKAGE_ENTRIES.length
    || !entries.every((entry, index) => entry === ARCHIVE_PACKAGE_ENTRIES[index])
  ) throw archiveError("ARCHIVE_TRANSACTION_AMBIGUOUS", "归档资料包内容无法确认")
  await verifyExpectedFile({
    path: metadataPath,
    expectedIdentity: metadataIdentity,
    expectedSize: metadataSize,
    expectedHash: metadataHash,
    io,
  })
  await verifyExpectedFile({
    path: markerPath,
    expectedIdentity: markerProof.identity,
    expectedSize: markerProof.size,
    expectedHash: markerProof.hash,
    io,
  })
  await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
  return Object.freeze({
    version: 1,
    archive_source_id: request.archive_source_id,
    paper_id: request.paper_id,
    openalex_id: request.candidate.paperId,
    source_root: rootAnchor.path,
    source_root_identity: rootAnchor.identity,
    package_path: packagePath,
    package_identity: packageIdentity,
    entries: ARCHIVE_PACKAGE_ENTRIES,
    metadata: Object.freeze({
      path: metadataPath,
      identity: metadataIdentity,
      size: metadataSize,
      hash: metadataHash,
    }),
    commit: Object.freeze({
      path: markerPath,
      identity: markerProof.identity,
      size: markerProof.size,
      hash: markerProof.hash,
    }),
  })
}

function archiveResult(request, recoveryProof) {
  const result = {
    status: "created",
    paper_id: request.paper_id,
    folder_name: request.paper_id,
  }
  Object.defineProperty(result, "recoveryProof", { value: recoveryProof })
  return Object.freeze(result)
}

function proofMatchesRequest(proof, request) {
  return proof?.version === 1
    && request?.confirmation === "retry_archive_rebuild"
    && request.archive_source_id === proof.archive_source_id
    && request.paper_id === proof.paper_id
    && request.openalex_id === proof.openalex_id
    && typeof proof.source_root === "string"
    && typeof proof.package_path === "string"
    && typeof proof.source_root_identity === "string"
    && typeof proof.package_identity === "string"
    && Array.isArray(proof.entries)
    && proof.entries.length === ARCHIVE_PACKAGE_ENTRIES.length
    && proof.entries.every((entry, index) => entry === ARCHIVE_PACKAGE_ENTRIES[index])
}

export async function verifyArchiveRecoveryProof({ proof, request, fileSystem = {} } = {}) {
  const io = { ...DEFAULT_FILE_SYSTEM, ...fileSystem }
  try {
    if (!proofMatchesRequest(proof, request)) throw new Error("invalid proof")
    for (const method of ["lstat", "open", "readdir", "realpath"]) {
      if (typeof io[method] !== "function") throw new Error("invalid filesystem")
    }
    if (!Number.isInteger(io.noFollowFlag) || io.noFollowFlag <= 0) throw new Error("invalid filesystem")
    const rootInfo = await io.lstat(proof.source_root, { bigint: true })
    const canonicalRoot = await io.realpath(proof.source_root)
    if (
      rootInfo.isSymbolicLink()
      || !rootInfo.isDirectory()
      || identityFingerprint(rootInfo) !== proof.source_root_identity
      || canonicalRoot !== proof.source_root
      || join(proof.source_root, proof.paper_id) !== proof.package_path
    ) throw new Error("changed root")
    const packageInfo = await io.lstat(proof.package_path, { bigint: true })
    const canonicalPackage = await io.realpath(proof.package_path)
    if (
      packageInfo.isSymbolicLink()
      || !packageInfo.isDirectory()
      || identityFingerprint(packageInfo) !== proof.package_identity
      || canonicalPackage !== proof.package_path
      || !isInside(proof.source_root, canonicalPackage)
    ) throw new Error("changed package")
    const entries = (await io.readdir(proof.package_path)).sort((left, right) => left.localeCompare(right))
    if (
      entries.length !== ARCHIVE_PACKAGE_ENTRIES.length
      || !entries.every((entry, index) => entry === ARCHIVE_PACKAGE_ENTRIES[index])
    ) throw new Error("changed entries")
    for (const file of [proof.metadata, proof.commit]) {
      if (
        !file
        || typeof file.path !== "string"
        || typeof file.identity !== "string"
        || !Number.isInteger(file.size)
        || !/^[a-f0-9]{64}$/u.test(file.hash)
      ) throw new Error("invalid file proof")
      await verifyExpectedFile({
        path: file.path,
        expectedIdentity: file.identity,
        expectedSize: file.size,
        expectedHash: file.hash,
        io,
      })
    }
    const packageAfter = await io.lstat(proof.package_path, { bigint: true })
    if (identityFingerprint(packageAfter) !== proof.package_identity || !packageAfter.isDirectory()) {
      throw new Error("changed package")
    }
    return true
  } catch {
    throw archiveError("ARCHIVE_CONFLICT", "归档恢复证明不匹配")
  }
}

export async function archiveCandidateMetadata({
  sourceRoot,
  sourceId,
  existingPapers,
  existingArchiveIdentities = [],
  request: rawRequest,
  now = () => new Date(),
  fileSystem = {},
} = {}) {
  const request = validateArchiveRequest(rawRequest)
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId) || request.archive_source_id !== sourceId) {
    throw archiveError("ARCHIVE_CONFLICT", "归档请求来源与配置来源不匹配")
  }
  assertNoDuplicate({ existingPapers, existingArchiveIdentities, request })

  const io = { ...DEFAULT_FILE_SYSTEM, ...fileSystem }
  for (const method of ["lstat", "mkdir", "open", "readdir", "realpath"]) {
    if (typeof io[method] !== "function") throw new TypeError(`归档文件系统缺少 ${method}`)
  }
  if (!Number.isInteger(io.noFollowFlag) || io.noFollowFlag <= 0) throw new Error("当前平台不支持归档安全写入")

  let archivedAt
  try {
    const instant = now()
    if (!(instant instanceof Date)) throw new Error("invalid")
    archivedAt = instant.toISOString()
  } catch {
    throw new Error("归档时间无效")
  }
  const metadata = serializeArchiveMetadata({
    paperId: request.paper_id,
    archiveSourceId: sourceId,
    candidate: request.candidate,
    archivedAt,
  })
  const expectedBytes = Buffer.from(metadata, "utf8")
  const expectedSize = expectedBytes.length
  const expectedHash = contentFingerprint(expectedBytes)
  const rootAnchor = await acquireSourceRoot(sourceRoot, io)
  const packagePath = join(rootAnchor.path, request.paper_id)
  if (dirname(packagePath) !== rootAnchor.path || !isInside(rootAnchor.path, packagePath)) {
    try { await rootAnchor.handle.close() } catch { /* invalid path remains authoritative */ }
    throw new Error("归档目标路径无效")
  }
  const metadataPath = join(packagePath, "metadata.yaml")
  const markerPath = join(packagePath, ARCHIVE_COMMIT_FILE)
  const markerBytes = Buffer.from(serializeArchiveCommit(metadata), "utf8")
  let packageIdentity = null
  let metadataIdentity = null
  let handle = null
  let mutated = false
  let phase = "precommit"
  let recoveryProof = null

  try {
    await assertRootAnchor(rootAnchor, io)
    if (await lstatIfPresent(packagePath, io)) throw archiveError("ARCHIVE_CONFLICT", "目标论文目录已存在，拒绝覆盖")
    await assertRootAnchor(rootAnchor, io)
    try {
      await io.mkdir(packagePath, { recursive: false, mode: 0o700 })
    } catch (error) {
      if (error?.code === "EEXIST") throw archiveError("ARCHIVE_CONFLICT", "目标论文目录已存在，拒绝覆盖")
      throw new Error("无法创建归档目标目录")
    }
    mutated = true
    const packageInfo = await io.lstat(packagePath, { bigint: true })
    if (packageInfo.isSymbolicLink() || !packageInfo.isDirectory()) throw new Error("归档目标目录无效")
    packageIdentity = identityFingerprint(packageInfo)
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
    handle = await io.open(
      metadataPath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | io.noFollowFlag,
      0o600,
    )
    const openedBefore = await handle.stat({ bigint: true })
    if (
      openedBefore.isSymbolicLink()
      || !openedBefore.isFile()
      || Number(openedBefore.size) !== 0
      || Number(openedBefore.nlink) !== 1
    ) {
      throw new Error("归档目标文件无效")
    }
    metadataIdentity = identityFingerprint(openedBefore)
    phase = "commit_io"
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
    await handle.writeFile(expectedBytes)
    if (typeof handle.sync === "function") await handle.sync()
    const openedAfterWrite = await handle.stat({ bigint: true })
    if (
      !openedAfterWrite.isFile()
      || identityFingerprint(openedAfterWrite) !== metadataIdentity
      || Number(openedAfterWrite.size) !== expectedSize
      || Number(openedAfterWrite.nlink) !== 1
    ) throw new Error("归档目标文件校验失败")
    const observedBytes = Buffer.alloc(expectedSize)
    const { bytesRead } = await handle.read(observedBytes, 0, expectedSize, 0)
    const openedAfterRead = await handle.stat({ bigint: true })
    if (
      bytesRead !== expectedSize
      || !openedAfterRead.isFile()
      || identityFingerprint(openedAfterRead) !== metadataIdentity
      || Number(openedAfterRead.size) !== expectedSize
      || Number(openedAfterRead.nlink) !== 1
      || contentFingerprint(observedBytes) !== expectedHash
    ) throw new Error("归档目标文件内容校验失败")
    await handle.close()
    handle = null
    phase = "post_validation"
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
    await verifyExpectedFile({
      path: metadataPath,
      expectedIdentity: metadataIdentity,
      expectedSize,
      expectedHash,
      io,
    })
    await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
    const markerProof = await writeArchiveCommitMarker({
      markerPath,
      markerBytes,
      packagePath,
      packageIdentity,
      rootAnchor,
      metadataPath,
      metadataIdentity,
      metadataSize: expectedSize,
      metadataHash: expectedHash,
      io,
    })
    recoveryProof = await captureArchiveRecoveryProof({
      request,
      rootAnchor,
      packagePath,
      packageIdentity,
      metadataPath,
      metadataIdentity,
      metadataSize: expectedSize,
      metadataHash: expectedHash,
      markerPath,
      markerProof,
      io,
    })
  } catch (error) {
    if (phase === "commit_io" && mutated && packageIdentity && metadataIdentity) {
      let reconciliationHandle = handle
      try {
        await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
        if (reconciliationHandle) {
          try {
            await reconciliationHandle.stat({ bigint: true })
          } catch (handleError) {
            if (handleError?.code !== "EBADF") throw handleError
            try { await reconciliationHandle.close() } catch { /* already closed */ }
            if (reconciliationHandle === handle) handle = null
            reconciliationHandle = null
          }
        }
        if (!reconciliationHandle) {
          reconciliationHandle = await io.open(metadataPath, constants.O_RDWR | io.noFollowFlag)
        }
        const before = await reconciliationHandle.stat({ bigint: true })
        if (
          !before.isFile()
          || identityFingerprint(before) !== metadataIdentity
          || Number(before.size) !== expectedSize
          || Number(before.nlink) !== 1
        ) throw new Error("ambiguous archive state")
        if (typeof reconciliationHandle.sync !== "function") throw new Error("ambiguous archive state")
        await reconciliationHandle.sync()
        const observedBytes = Buffer.alloc(expectedSize)
        const { bytesRead } = await reconciliationHandle.read(observedBytes, 0, expectedSize, 0)
        const after = await reconciliationHandle.stat({ bigint: true })
        if (
          bytesRead !== expectedSize
          || !after.isFile()
          || identityFingerprint(after) !== metadataIdentity
          || Number(after.size) !== expectedSize
          || Number(after.nlink) !== 1
          || contentFingerprint(observedBytes) !== expectedHash
        ) throw new Error("ambiguous archive state")
        await reconciliationHandle.close()
        if (reconciliationHandle === handle) handle = null
        reconciliationHandle = null
        await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
        await verifyExpectedFile({
          path: metadataPath,
          expectedIdentity: metadataIdentity,
          expectedSize,
          expectedHash,
          io,
        })
        await assertOwnedPackage({ packagePath, rootAnchor, packageIdentity, io })
        const markerProof = await writeArchiveCommitMarker({
          markerPath,
          markerBytes,
          packagePath,
          packageIdentity,
          rootAnchor,
          metadataPath,
          metadataIdentity,
          metadataSize: expectedSize,
          metadataHash: expectedHash,
          io,
        })
        const proof = await captureArchiveRecoveryProof({
          request,
          rootAnchor,
          packagePath,
          packageIdentity,
          metadataPath,
          metadataIdentity,
          metadataSize: expectedSize,
          metadataHash: expectedHash,
          markerPath,
          markerProof,
          io,
        })
        return archiveResult(request, proof)
      } catch {
        if (reconciliationHandle) {
          try { await reconciliationHandle.close() } catch { /* recovery remains blocked */ }
          if (reconciliationHandle === handle) handle = null
        }
      }
    }
    if (handle) {
      try { await handle.close() } catch { /* recovery result below remains authoritative */ }
      handle = null
    }
    if (!mutated && error instanceof CandidateArchiveError) throw error
    if (mutated) throw archiveError("ARCHIVE_TRANSACTION_AMBIGUOUS", "归档写入失败且恢复受阻，清理未完成；请人工检查，未声称已清理")
    throw archiveError("ARCHIVE_WRITE_FAILED", "归档写入失败，未保留不完整资料包")
  } finally {
    try { await rootAnchor.handle.close() } catch { /* transaction result remains authoritative */ }
  }

  return archiveResult(request, recoveryProof)
}
