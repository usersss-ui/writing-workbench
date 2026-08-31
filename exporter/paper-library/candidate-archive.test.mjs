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
  rename as renamePath,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { archiveMetadataSha256, parseArchiveCommit, parseArchiveMetadata } from "./archive-metadata.mjs"
import {
  archiveCandidateMetadata,
  validateArchiveRequest,
  verifyArchiveRecoveryProof,
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
    { ...request(), candidate: { ...request().candidate, paperId: "W0" } },
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

test("creates one metadata-only package through an exclusive final-file commit without a writable alias", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
  let observedFlags = null
  let observedCommitFlags = null
  let openedPath = null
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    now: () => new Date("2026-08-30T04:05:06.000Z"),
    fileSystem: {
      open: async (path, flags, mode) => {
        if (path.endsWith("/metadata.yaml") && (flags & constants.O_EXCL) !== 0) {
          observedFlags = flags
          openedPath = path
        }
        if (path.endsWith("/.metadata.commit") && (flags & constants.O_EXCL) !== 0) observedCommitFlags = flags
        return openFile(path, flags, mode)
      },
      link: async () => { throw new Error("hard links must not publish archive metadata") },
      rename: async () => { throw new Error("rename must not publish archive metadata") },
    },
  })

  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  assert.deepEqual(await readdir(sourceRoot), ["Wang23-DIO"])
  assert.deepEqual(await readdir(join(sourceRoot, "Wang23-DIO")), [".metadata.commit", "metadata.yaml"])
  assert.equal(openedPath, join(await realpath(sourceRoot), "Wang23-DIO/metadata.yaml"))
  assert.equal(observedFlags & constants.O_EXCL, constants.O_EXCL)
  if (typeof constants.O_NOFOLLOW === "number") {
    assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
    assert.equal(observedCommitFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
  }
  assert.equal((await lstat(openedPath)).nlink, 1)
  const metadataText = await readFile(openedPath, "utf8")
  assert.equal(parseArchiveCommit(await readFile(join(sourceRoot, "Wang23-DIO/.metadata.commit"), "utf8")), archiveMetadataSha256(metadataText))
  assert.deepEqual(parseArchiveMetadata(metadataText), {
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

test("returns a non-enumerable process-private proof bound to the committed directory and both exact files", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-proof-root-")))
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    now: () => new Date("2026-08-30T04:05:06.000Z"),
  })

  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  assert.deepEqual(Object.keys(outcome), ["status", "paper_id", "folder_name"])
  const descriptor = Object.getOwnPropertyDescriptor(outcome, "recoveryProof")
  assert.equal(descriptor?.enumerable, false)
  assert.equal(descriptor?.writable, false)
  assert.equal(descriptor?.configurable, false)
  assert.equal(descriptor?.value.archive_source_id, "main_papers")
  assert.equal(descriptor?.value.paper_id, "Wang23-DIO")
  assert.equal(descriptor?.value.openalex_id, "W4387886124")
  assert.deepEqual(descriptor?.value.entries, [".metadata.commit", "metadata.yaml"])
  assert.equal(await verifyArchiveRecoveryProof({
    proof: descriptor.value,
    request: {
      confirmation: "retry_archive_rebuild",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
  }), true)
})

test("rejects local ID, normalized DOI, OpenAlex URL, and composite identity duplicates before mutation", async () => {
  const duplicateCases = [
    { existingPapers: [{ paper_id: "Wang23-DIO", doi_or_url: "10.1234/other" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://openalex.org/W4387886124" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://openalex.org/W4387886124/" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://OPENALEX.ORG/W4387886124" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "https://api.openalex.org/works/W4387886124" }], existingArchiveIdentities: [] },
    { existingPapers: [{ paper_id: "Other23-Paper", doi_or_url: "" }], existingArchiveIdentities: ["openalex:W4387886124"] },
  ]
  for (const duplicateCase of duplicateCases) {
    const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
    await assert.rejects(() => archiveCandidateMetadata({
      sourceRoot,
      sourceId: "main_papers",
      request: request(),
      ...duplicateCase,
    }), /已存在|重复|DOI|来源身份/u)
    assert.deepEqual(await readdir(sourceRoot), [])
  }

  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
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
  const parent = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-parent-")))
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

test("rejects a source root reached through an intermediate symlink component", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-component-parent-")))
  const actual = join(parent, "actual")
  const sourceRoot = join(actual, "root")
  const alias = join(parent, "alias")
  await mkdir(sourceRoot, { recursive: true })
  await symlink(actual, alias)

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot: join(alias, "root"),
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
  }), /根目录|规范|符号链接/u)
  assert.deepEqual(await readdir(sourceRoot), [])
})

test("preserves an existing destination package and never overwrites its bytes", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
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

test("write failure leaves only non-scannable recovery material and never deletes by path", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: async () => { throw new Error("injected write failure") },
          sync: () => handle.sync(),
          close: () => handle.close(),
        }
      },
    },
  }), /恢复|阻塞|清理未完成/u)
  assert.deepEqual(await readdir(sourceRoot), ["Wang23-DIO"])
  assert.deepEqual(await readdir(join(sourceRoot, "Wang23-DIO")), ["metadata.yaml"])
})

test("reconciles a complete expected final file when write reports an ambiguous after-effect error", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-write-after-effect-root-")))
  let threwAfterWrite = false
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: async (...args) => {
            await handle.writeFile(...args)
            threwAfterWrite = true
            throw new Error("ambiguous write completion")
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        }
      },
    },
  })

  assert.equal(threwAfterWrite, true)
  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  const finalPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
  assert.equal((await lstat(finalPath)).nlink, 1)
  assert.equal(parseArchiveMetadata(await readFile(finalPath, "utf8")).metadata.paper_id, "Wang23-DIO")
})

test("reopens the expected final path when an ambiguous completed write also closes its original handle", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-write-closed-root-")))
  let closedBeforeThrow = false
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: async (...args) => {
            await handle.writeFile(...args)
            await handle.close()
            closedBeforeThrow = true
            throw new Error("ambiguous closed write completion")
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        }
      },
    },
  })

  assert.equal(closedBeforeThrow, true)
  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  const finalPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
  assert.equal((await lstat(finalPath)).nlink, 1)
  assert.equal(parseArchiveMetadata(await readFile(finalPath, "utf8")).metadata.paper_id, "Wang23-DIO")
})

test("reconciles an ambiguously completed commit marker only after proving marker and metadata together", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-marker-after-effect-root-")))
  let markerThrewAfterWrite = false
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/.metadata.commit") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: async (...args) => {
            await handle.writeFile(...args)
            markerThrewAfterWrite = true
            throw new Error("ambiguous marker completion")
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        }
      },
    },
  })

  assert.equal(markerThrewAfterWrite, true)
  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
  const metadataText = await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml"), "utf8")
  const markerText = await readFile(join(sourceRoot, "Wang23-DIO/.metadata.commit"), "utf8")
  assert.equal(parseArchiveCommit(markerText), archiveMetadataSha256(metadataText))
})

test("reconciles a transient first path-proof failure after the complete commit marker closes", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-marker-postproof-root-")))
  const markerPath = join(sourceRoot, "Wang23-DIO/.metadata.commit")
  let markerClosed = false
  let invalidatedOnce = false
  const outcome = await archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/.metadata.commit") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: (...args) => handle.writeFile(...args),
          sync: () => handle.sync(),
          close: async () => { await handle.close(); markerClosed = true },
        }
      },
      lstat: async (path, options) => {
        const info = await lstat(path, options)
        if (markerClosed && !invalidatedOnce && path === markerPath) {
          invalidatedOnce = true
          return new Proxy(info, {
            get(target, property, receiver) {
              if (property === "isFile") return () => false
              return Reflect.get(target, property, receiver)
            },
          })
        }
        return info
      },
    },
  })

  assert.equal(invalidatedOnce, true)
  assert.deepEqual(outcome, { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" })
})

test("exclusive final open preserves an unowned destination inserted at the no-clobber boundary", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        if (path.endsWith("/metadata.yaml") && (flags & constants.O_EXCL) !== 0) await writeFile(path, "keep")
        return openFile(path, flags, mode)
      },
    },
  }), /清理未完成|未覆盖/u)
  assert.equal(await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml"), "utf8"), "keep")
})

test("detects a replaced source-root anchor and never reports an archive created in the replacement root", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-anchor-parent-")))
  const sourceRoot = join(parent, "configured")
  const displacedRoot = join(parent, "configured-displaced")
  await mkdir(sourceRoot)
  const canonicalSourceRoot = await realpath(sourceRoot)
  let swapped = false

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      mkdir: async (path, options) => {
        if (!swapped && path === join(canonicalSourceRoot, "Wang23-DIO")) {
          await renamePath(sourceRoot, displacedRoot)
          await mkdir(sourceRoot)
          swapped = true
        }
        return mkdir(path, options)
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  assert.equal(swapped, true)
  assert.equal(await exists(join(sourceRoot, "Wang23-DIO")), true)
  assert.deepEqual(await readdir(displacedRoot), [])
})

test("hash-checks exact expected bytes after a same-inode same-size final-file tamper at close", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-tamper-root-")))
  let tampered = false
  async function tamper(from) {
    const bytes = await readFile(from)
    const marker = Buffer.from("Distributed Interval Optimization")
    const offset = bytes.indexOf(marker)
    assert.notEqual(offset, -1)
    bytes[offset] = "X".charCodeAt(0)
    await writeFile(from, bytes)
  }

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: (...args) => handle.writeFile(...args),
          sync: () => handle.sync(),
          close: async () => {
            await handle.close()
            await tamper(path)
            tampered = true
          },
        }
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  const finalPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
  assert.equal(await exists(finalPath), true)
  assert.equal(tampered, true)
})

test("never reports created when the owned package is moved behind an in-root symlink at the final-open boundary", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-open-move-root-")))
  const canonicalRoot = await realpath(sourceRoot)
  const packagePath = join(canonicalRoot, "Wang23-DIO")
  const displacedPath = join(canonicalRoot, "Wang23-DIO-displaced")
  let moved = false

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        if (path.endsWith("/metadata.yaml") && (flags & constants.O_EXCL) !== 0) {
          await renamePath(packagePath, displacedPath)
          await symlink(displacedPath, packagePath)
          moved = true
        }
        return openFile(path, flags, mode)
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  assert.equal(moved, true)
  assert.equal((await lstat(packagePath)).isSymbolicLink(), true)
  assert.equal(await readFile(join(displacedPath, "metadata.yaml"), "utf8"), "")
})

test("never reports created when the package path is swapped to an external directory at the final-open boundary", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-open-external-root-")))
  const canonicalRoot = await realpath(sourceRoot)
  const packagePath = join(canonicalRoot, "Wang23-DIO")
  const displacedPath = join(canonicalRoot, "Wang23-DIO-displaced")
  const outside = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-link-external-target-")))

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        if (path.endsWith("/metadata.yaml") && (flags & constants.O_EXCL) !== 0) {
          await renamePath(packagePath, displacedPath)
          await symlink(outside, packagePath)
        }
        return openFile(path, flags, mode)
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  assert.equal(await readFile(join(outside, "metadata.yaml"), "utf8"), "")
})

test("never reports created when the package is moved behind a symlink during the final path proof", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-postproof-move-root-")))
  const canonicalRoot = await realpath(sourceRoot)
  const packagePath = join(canonicalRoot, "Wang23-DIO")
  const displacedPath = join(canonicalRoot, "Wang23-DIO-displaced")
  const metadataPath = join(packagePath, "metadata.yaml")
  let moved = false

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      lstat: async (path, options) => {
        if (!moved && path === metadataPath) {
          await renamePath(packagePath, displacedPath)
          await symlink(displacedPath, packagePath)
          moved = true
        }
        return lstat(path, options)
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  assert.equal(moved, true)
  assert.equal((await lstat(packagePath)).isSymbolicLink(), true)
  assert.equal(parseArchiveMetadata(await readFile(join(displacedPath, "metadata.yaml"), "utf8")).metadata.paper_id, "Wang23-DIO")
})

test("post-close validation failure is a typed ambiguous transaction without deleting the published inode", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-postcheck-root-")))
  const metadataPath = join(await realpath(sourceRoot), "Wang23-DIO/metadata.yaml")
  let published = false
  let invalidated = false

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: (...args) => handle.writeFile(...args),
          sync: () => handle.sync(),
          close: async () => { await handle.close(); published = true },
        }
      },
      lstat: async (path, options) => {
        const info = await lstat(path, options)
        if (published && !invalidated && path === metadataPath) {
          invalidated = true
          return new Proxy(info, {
            get(target, property, receiver) {
              if (property === "isFile") return () => false
              return Reflect.get(target, property, receiver)
            },
          })
        }
        return info
      },
    },
  }), (error) => error?.code === "ARCHIVE_TRANSACTION_AMBIGUOUS" && /恢复|阻塞|清理未完成/u.test(error.message))

  assert.equal(published, true)
  assert.equal(invalidated, true)
  assert.equal(await exists(metadataPath), true)
})

test("never path-unlinks a replacement inserted after rollback ownership verification", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-rollback-toctou-root-")))
  const canonicalRoot = await realpath(sourceRoot)
  const metadataPath = join(canonicalRoot, "Wang23-DIO/metadata.yaml")
  const sentinelPath = join(canonicalRoot, ".unowned-sentinel")
  const ownedBypassPath = join(canonicalRoot, ".owned-metadata-bypass")
  const sentinel = ["UNOWNED", "SENTINEL"].join("-")
  await writeFile(sentinelPath, sentinel)
  let published = false
  let invalidated = false
  let swappedAtUnlink = false

  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return handle
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => handle.read(...args),
          writeFile: (...args) => handle.writeFile(...args),
          sync: () => handle.sync(),
          close: async () => { await handle.close(); published = true },
        }
      },
      lstat: async (path, options) => {
        const info = await lstat(path, options)
        if (published && !invalidated && path === metadataPath) {
          invalidated = true
          return new Proxy(info, {
            get(target, property, receiver) {
              if (property === "isFile") return () => false
              return Reflect.get(target, property, receiver)
            },
          })
        }
        return info
      },
      unlink: async (path) => {
        if (path === metadataPath && !swappedAtUnlink) {
          await renamePath(metadataPath, ownedBypassPath)
          await renamePath(sentinelPath, metadataPath)
          swappedAtUnlink = true
        }
        const { unlink } = await import("node:fs/promises")
        return unlink(path)
      },
    },
  }), /恢复|阻塞|清理未完成/u)

  assert.equal(invalidated, true)
  assert.equal(swappedAtUnlink, false)
  assert.equal(await readFile(sentinelPath, "utf8"), sentinel)
})

test("rejects an injected final symlink without deleting it or changing its target", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
  const outside = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-outside-")))
  const outsideFile = join(outside, "outside.txt")
  await writeFile(outsideFile, "keep")
  await assert.rejects(() => archiveCandidateMetadata({
    sourceRoot,
    sourceId: "main_papers",
    existingPapers: [],
    request: request(),
    fileSystem: {
      open: async (path, flags, mode) => {
        if (!path.endsWith("/metadata.yaml") || (flags & constants.O_EXCL) === 0) return openFile(path, flags, mode)
        await symlink(outsideFile, path)
        return openFile(path, flags, mode)
      },
    },
  }), /清理未完成|归档写入失败/u)
  assert.equal(await readFile(outsideFile, "utf8"), "keep")
  assert.equal((await lstat(join(await realpath(sourceRoot), "Wang23-DIO/metadata.yaml"))).isSymbolicLink(), true)
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
    const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "paper-archive-root-")))
    await assert.rejects(() => archiveCandidateMetadata({
      sourceRoot,
      sourceId: "main_papers",
      existingPapers: [],
      ...options,
    }), /归档|上限|安全写入/u)
    assert.deepEqual(await readdir(sourceRoot), [])
  }
})
