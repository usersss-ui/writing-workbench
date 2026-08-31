import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { serializeArchiveMetadata } from "./archive-metadata.mjs"
import { isValidPaperId } from "./overrides.mjs"

const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const OPENALEX_IDENTITY = /^openalex:W\d+$/u
const OPENALEX_URL = /^https:\/\/openalex\.org\/(W\d+)$/u
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
  realpath,
  rename,
  rmdir,
  unlink,
  noFollowFlag: constants.O_NOFOLLOW,
})

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
  if (identities.has(requestedIdentity)) throw new Error("相同归档来源身份已存在，未执行归档")

  for (const paper of papers) {
    const existing = paperFields(paper)
    if (existing.paperId === request.paper_id) throw new Error("论文 ID 已存在，未执行归档")
    const existingDoi = normalizeDoi(existing.doiOrUrl)
    if (requestedDoi && existingDoi === requestedDoi) throw new Error("相同 DOI 已存在，未执行归档")
    const openAlexMatch = OPENALEX_URL.exec(existing.doiOrUrl)
    if (openAlexMatch && `openalex:${openAlexMatch[1]}` === requestedIdentity) {
      throw new Error("相同归档来源身份已存在，未执行归档")
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

async function canonicalSourceRoot(sourceRoot, io) {
  if (typeof sourceRoot !== "string" || !isAbsolute(sourceRoot) || resolve(sourceRoot) !== sourceRoot) {
    throw new Error("论文根目录必须是规范绝对路径")
  }
  let lexical
  let canonical
  try {
    lexical = await io.lstat(sourceRoot, { bigint: true })
    canonical = await io.realpath(sourceRoot)
  } catch {
    throw new Error("论文根目录不存在或不可访问")
  }
  if (lexical.isSymbolicLink() || !lexical.isDirectory()) throw new Error("论文根目录必须是普通目录")
  return canonical
}

async function lstatIfPresent(path, io) {
  try {
    return await io.lstat(path, { bigint: true })
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function assertOwnedPackage({ packagePath, canonicalRoot, packageIdentity, io }) {
  const info = await io.lstat(packagePath, { bigint: true })
  const canonical = await io.realpath(packagePath)
  if (
    info.isSymbolicLink()
    || !info.isDirectory()
    || identityFingerprint(info) !== packageIdentity
    || canonical !== packagePath
    || !isInside(canonicalRoot, canonical)
  ) throw new Error("归档目标目录在事务期间发生变化")
}

async function cleanupOwnedTransaction({ packagePath, temporaryPath, canonicalRoot, packageIdentity, temporaryIdentity, io }) {
  let complete = true
  if (temporaryIdentity !== null) {
    try {
      const info = await io.lstat(temporaryPath, { bigint: true })
      if (info.isSymbolicLink() || !info.isFile() || identityFingerprint(info) !== temporaryIdentity) complete = false
      else await io.unlink(temporaryPath)
    } catch (error) {
      if (error?.code !== "ENOENT") complete = false
    }
  }
  if (packageIdentity !== null) {
    try {
      await assertOwnedPackage({ packagePath, canonicalRoot, packageIdentity, io })
      await io.rmdir(packagePath)
    } catch (error) {
      if (error?.code !== "ENOENT") complete = false
    }
  }
  return complete
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
    throw new Error("归档请求来源与配置来源不匹配")
  }
  assertNoDuplicate({ existingPapers, existingArchiveIdentities, request })

  const io = { ...DEFAULT_FILE_SYSTEM, ...fileSystem }
  for (const method of ["lstat", "mkdir", "open", "realpath", "rename", "rmdir", "unlink"]) {
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
  const canonicalRoot = await canonicalSourceRoot(sourceRoot, io)
  const packagePath = join(canonicalRoot, request.paper_id)
  if (dirname(packagePath) !== canonicalRoot || !isInside(canonicalRoot, packagePath)) throw new Error("归档目标路径无效")
  const temporaryPath = join(packagePath, ".metadata.yaml.tmp")
  const metadataPath = join(packagePath, "metadata.yaml")
  if (await lstatIfPresent(packagePath, io)) throw new Error("目标论文目录已存在，拒绝覆盖")
  let packageIdentity = null
  let temporaryIdentity = null
  let handle = null

  try {
    try {
      await io.mkdir(packagePath, { recursive: false, mode: 0o700 })
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("目标论文目录已存在，拒绝覆盖")
      throw new Error("无法创建归档目标目录")
    }
    const packageInfo = await io.lstat(packagePath, { bigint: true })
    if (packageInfo.isSymbolicLink() || !packageInfo.isDirectory()) throw new Error("归档目标目录无效")
    packageIdentity = identityFingerprint(packageInfo)
    await assertOwnedPackage({ packagePath, canonicalRoot, packageIdentity, io })

    handle = await io.open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | io.noFollowFlag,
      0o600,
    )
    const openedBefore = await handle.stat({ bigint: true })
    if (openedBefore.isSymbolicLink() || !openedBefore.isFile()) throw new Error("归档临时文件无效")
    temporaryIdentity = identityFingerprint(openedBefore)
    await handle.writeFile(metadata, { encoding: "utf8" })
    if (typeof handle.sync === "function") await handle.sync()
    const openedAfter = await handle.stat({ bigint: true })
    if (
      !openedAfter.isFile()
      || identityFingerprint(openedAfter) !== temporaryIdentity
      || Number(openedAfter.size) !== Buffer.byteLength(metadata, "utf8")
    ) throw new Error("归档临时文件校验失败")
    await handle.close()
    handle = null

    await assertOwnedPackage({ packagePath, canonicalRoot, packageIdentity, io })
    const temporaryInfo = await io.lstat(temporaryPath, { bigint: true })
    if (temporaryInfo.isSymbolicLink() || !temporaryInfo.isFile() || identityFingerprint(temporaryInfo) !== temporaryIdentity) {
      throw new Error("归档临时文件在提交前发生变化")
    }
    if (await lstatIfPresent(metadataPath, io)) throw new Error("归档目标文件已存在，拒绝覆盖")
    await io.rename(temporaryPath, metadataPath)
    const published = await io.lstat(metadataPath, { bigint: true })
    if (published.isSymbolicLink() || !published.isFile() || identityFingerprint(published) !== temporaryIdentity) {
      throw new Error("归档提交后校验失败")
    }
    await assertOwnedPackage({ packagePath, canonicalRoot, packageIdentity, io })
  } catch {
    if (handle) {
      try { await handle.close() } catch { /* cleanup result below remains authoritative */ }
      handle = null
    }
    const complete = await cleanupOwnedTransaction({
      packagePath,
      temporaryPath,
      canonicalRoot,
      packageIdentity,
      temporaryIdentity,
      io,
    })
    if (!complete) throw new Error("归档写入失败且清理未完成，未覆盖现有内容")
    throw new Error("归档写入失败，未保留不完整资料包")
  }

  return Object.freeze({ status: "created", paper_id: request.paper_id, folder_name: request.paper_id })
}
