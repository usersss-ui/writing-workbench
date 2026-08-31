import test from "node:test"
import assert from "node:assert/strict"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  realpath,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { parseArchiveMetadata } from "./archive-metadata.mjs"
import {
  archiveCandidateMetadata,
  validateArchiveRequest,
} from "./candidate-archive.mjs"

const CANDIDATE = Object.freeze({
  paperId: "W4387886124",
  doi: "10.1109/access.2023.3327199",
  title: "Distributed Interval Optimization Over Time-Varying Networks",
  authors: Object.freeze(["Yinghui Wang", "Jiuwei Wang"]),
  year: 2023,
  source: "IEEE Access",
  citations: 12,
  isOpenAccess: true,
  openAccessUrl: "https://example.org/open-paper",
  landingPageUrl: "https://doi.org/10.1109/access.2023.3327199",
  topics: Object.freeze(["Distributed optimization"]),
  abstract: "Source-provided discovery text that is not archive metadata.",
  stage: "confirmed_for_archive",
})

function request(overrides = {}) {
  return {
    version: 1,
    confirmation: "create_metadata_only",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    candidate: { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ...overrides,
  }
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

test("validates the exact archive request without invoking accessors", () => {
  const raw = request()
  const validated = validateArchiveRequest(raw)
  assert.deepEqual(validated, raw)
  assert.notEqual(validated, raw)

  for (const invalid of [
    { ...request(), extra: true },
    { ...request(), archive_source_id: "../main_papers" },
    { ...request(), confirmation: "yes" },
    { ...request(), version: 2 },
    { ...request(), candidate: { ...request().candidate, stage: "pending_screening" } },
  ]) assert.throws(() => validateArchiveRequest(invalid), /归档|确认|来源|候选|格式/u)

  let getterCalls = 0
  const withAccessor = request()
  Object.defineProperty(withAccessor, "paper_id", {
    enumerable: true,
    get() { getterCalls += 1; return "Wang23-DIO" },
  })
  assert.throws(() => validateArchiveRequest(withAccessor), /归档|格式/u)
  assert.equal(getterCalls, 0)
})

test("creates one metadata-only package through exclusive no-follow temporary write and same-directory rename", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
  let observedFlags = null
  let renamed = null
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    now: () => new Date("2026-08-30T04:05:06.000Z"),
    fileSystem: {
      open: async (path, flags, mode) => {
        observedFlags = flags
        return openFile(path, flags, mode)
      },
      rename: async (from, to) => {
        renamed = { from, to }
        const { rename } = await import("node:fs/promises")
        return rename(from, to)
      },
    },
  })

  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  assert.deepEqual(await readdir(sourceRoot), ["Wang23-DIO"])
  assert.deepEqual(await readdir(join(sourceRoot, "Wang23-DIO")), ["metadata.yaml"])
  assert.equal(dirname(renamed.from), dirname(renamed.to))
  assert.equal(renamed.to, join(await realpath(sourceRoot), "Wang23-DIO/metadata.yaml"))
  assert.equal(observedFlags & constants.O_EXCL, constants.O_EXCL)
  if (typeof constants.O_NOFOLLOW === "number") {
    assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
  }
  assert.deepEqual(parseArchiveMetadata(await readFile(renamed.to, "utf8")), {
    metadata: {
      paper_id: "Wang23-DIO",
      title_original: "Distributed Interval Optimization Over Time-Varying Networks",
      authors: ["Yinghui Wang", "Jiuwei Wang"],
      year: 2023,
      venue: "IEEE Access",
      doi_or_url: "10.1109/access.2023.3327199",
      unit_type: "article",
    },
    archive_source_id: "main_papers",
    candidate_source: "openalex",
    openalex_id: "W4387886124",
    archive_identity: "openalex:W4387886124",
    archived_at: "2026-08-30T04:05:06.000Z",
  })
})

test("rejects local ID, normalized DOI, OpenAlex URL, and composite identity duplicates before mutation", async () => {
  const duplicateCases = [
    { existingPapers: [{ paper_id: "Wang23-DIO", doi_or_url: "10.1234/other" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://openalex.org/W4387886124" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "" }], existingArchiveIdentities: ["openalex:W4387886124"] },
  ]
  for (const duplicateCase of duplicateCases) {
    const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
    await assert.rejects(() => archiveCandidateMetadata({
      sourceRoot,
      sourceId: "main_papers",
      request: request(),
      ...duplicateCase,
    }), /已存在|重复|DOI|来源身份/u)
    assert.deepEqual(await readdir(sourceRoot), [])
  }

  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    existingArchiveIdentities: ["W4387886124"],
    request: request(),
  }), /身份索引|格式/u)
  assert.deepEqual(await readdir(sourceRoot), [])
})

test("requires one exact configured source and a canonical ordinary source root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "paper-archive-parent-"))
  const sourceRoot = join(parent, "real")
  await mkdir(sourceRoot)
  const linkedRoot = join(parent, "linked")
  await symlink(sourceRoot, linkedRoot)
  const fileRoot = join(parent, "file")
  await writeFile(fileRoot, "not a directory")

  for (const options of [
    { sourceRoot, sourceId: "other_papers", request: request() },
    { sourceRoot, sourceId: "main_papers", request: request({ archive_source_id: "other_papers" }) },
    { sourceRoot: "relative/root", sourceId: "main_papers", request: request() },
    { sourceRoot: join(parent, "missing"), sourceId: "main_papers", request: request() },
    { sourceRoot: linkedRoot, sourceId: "main_papers", request: request() },
    { sourceRoot: fileRoot, sourceId: "main_papers", request: request() },
  ]) {
    await assert.rejects(() => archiveCandidateMetadata({
      existingPapers: [],
      ...options,
    }), /来源|根目录|路径|格式/u)
  }
  assert.deepEqual(await readdir(sourceRoot), [])
})

test("preserves an existing destination package and never overwrites its bytes", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
  await mkdir(join(sourceRoot, "Wang23-DIO"))
  await writeFile(join(sourceRoot, "Wang23-DIO/sentinel.txt"), "keep")
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
  }), /目标|目录|已存在|覆盖/u)
  assert.equal(await readFile(join(sourceRoot, "Wang23-DIO/sentinel.txt"), "utf8"), "keep")
})

test("write or rename failure removes only the transaction-owned temporary package", async () => {
  for (const fileSystem of [
    {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        return {
          stat: (...args) => handle.stat(...args),
          writeFile: async () => { throw new Error("injected write failure") },
          sync: () => handle.sync(),
          close: () => handle.close(),
        }
      },
    },
    { rename: async () => { throw new Error("injected rename failure") } },
  ]) {
    const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
    await assert.rejects(() => archiveCandidateMetadata({
      sourceRoot,
      sourceId: "main_papers",
      existingPapers: [],
      request: request(),
      fileSystem,
    }), /归档写入失败/u)
    assert.deepEqual(await readdir(sourceRoot), [])
  }
})

test("cleanup preserves an unowned destination created during the rename window", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      rename: async (_from, to) => {
        await writeFile(to, "keep")
        const error = new Error("destination appeared")
        error.code = "EEXIST"
        throw error
      },
    },
  }), /清理未完成|未覆盖/u)
  assert.equal(await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml"), "utf8"), "keep")
  assert.equal(await exists(join(sourceRoot, "Wang23-DIO/.metadata.yaml.tmp")), false)
})

test("rejects an injected temporary symlink without deleting it or changing its target", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-archive-outside-"))
  const outsideFile = join(outside, "outside.txt")
  await writeFile(outsideFile, "keep")
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        await symlink(outsideFile, path)
        return openFile(path, flags, mode)
      },
    },
  }), /临时|清理未完成|归档写入失败/u)
  assert.equal(await readFile(outsideFile, "utf8"), "keep")
  assert.equal((await lstat(join(sourceRoot, "Wang23-DIO/.metadata.yaml.tmp"))).isSymbolicLink(), true)
})

test("rejects unavailable no-follow support and oversized metadata before reserving a package", async () => {
  for (const options of [
    { fileSystem: { noFollowFlag: null }, request: request() },
    {
      fileSystem: {},
      request: request({
        candidate: {
          ...CANDIDATE,
          authors: Array.from({ length: 50 }, (_, index) => `Author-${index}-${"x".repeat(280)}`),
          topics: [...CANDIDATE.topics],
        },
      }),
    },
  ]) {
    const sourceRoot = await mkdtemp(join(tmpdir(), "paper-archive-root-"))
    await assert.rejects(() => archiveCandidateMetadata({
      sourceRoot,
      sourceId: "main_papers",
      existingPapers: [],
      ...options,
    }), /归档|上限|安全写入/u)
    assert.deepEqual(await readdir(sourceRoot), [])
  }
})
