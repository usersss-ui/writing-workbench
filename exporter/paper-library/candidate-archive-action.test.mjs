import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, mkdtemp, open as openFile, readFile, readdir, realpath, rename, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  archiveCandidateAndRebuild,
  createArchiveRecoveryStore,
  rebuildArchivedCandidate,
} from "./candidate-archive-action.mjs"
import { archiveMetadataSha256 } from "./archive-metadata.mjs"
import { scanPaperSources } from "./scanner.mjs"

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

function archiveRequest(overrides = {}) {
  return {
    version: 1,
    confirmation: "create_metadata_only",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    candidate: { ...CANDIDATE, authors: [...CANDIDATE.authors], topics: [...CANDIDATE.topics] },
    ...overrides,
  }
}

function recoveryRequest(overrides = {}) {
  return {
    confirmation: "retry_archive_rebuild",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
    ...overrides,
  }
}

function completeContext({
  sourceRoot = "/vault/main",
  archiveSourceId = "main_papers",
  sources = [{ source_id: "main_papers", path: sourceRoot, catalog_path: null }],
  papers = [],
  archiveIdentityLookup = {},
  auditSources = sources.map((source) => ({ source_id: source.source_id, root_path: source.path, scanned_directories: 1 })),
} = {}) {
  return {
    config: { version: 1, archive_source_id: archiveSourceId, sources },
    overrides: { version: 1, papers: {} },
    tagCatalog: { version: 3, papers: {} },
    catalogs: {},
    institution: { institution_id: "fixture", providers: [] },
    scanned: {
      papers,
      audit: {
        sources: auditSources,
        archive_identity_lookup: archiveIdentityLookup,
        private_path_lookup: Object.fromEntries(papers.map((paper) => [paper.paper_id, join(sourceRoot, paper.relative_path)])),
        blocking: { duplicate_archive_source_ids: [] },
      },
    },
    papersById: new Map(papers.map((paper) => [paper.paper_id, paper])),
    unitDirectoryByPaperId: new Map(papers.map((paper) => [paper.paper_id, join(sourceRoot, paper.relative_path)])),
  }
}

function archivedPaper(overrides = {}) {
  return {
    paper_id: "Wang23-DIO",
    source_id: "main_papers",
    relative_path: "Wang23-DIO",
    title_original: CANDIDATE.title,
    authors: [...CANDIDATE.authors],
    year: CANDIDATE.year,
    venue: CANDIDATE.source,
    doi_or_url: CANDIDATE.doi,
    ...overrides,
  }
}

async function scanContext(sourceRoot) {
  const config = {
    version: 1,
    archive_source_id: "main_papers",
    sources: [{ source_id: "main_papers", path: sourceRoot, catalog_path: null }],
  }
  const overrides = { version: 1, papers: {} }
  const scanned = await scanPaperSources({ config, overrides, catalogs: {} })
  return {
    config,
    overrides,
    tagCatalog: { version: 3, papers: {} },
    catalogs: {},
    institution: { institution_id: "fixture", providers: [] },
    scanned,
    papersById: new Map(scanned.papers.map((paper) => [paper.paper_id, paper])),
    unitDirectoryByPaperId: new Map(scanned.papers.map((paper) => [paper.paper_id, scanned.audit.private_path_lookup[paper.paper_id]])),
  }
}

async function treeDigest(root) {
  const hash = createHash("sha256")
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      hash.update(relative)
      if (entry.isDirectory()) await visit(join(directory, entry.name), relative)
      else hash.update(await readFile(join(directory, entry.name)))
    }
  }
  await visit(root)
  return hash.digest("hex")
}

test("archives only after one complete all-source scan and rebuilds from a refreshed context", async () => {
  const first = completeContext({
    sources: [
      { source_id: "main_papers", path: "/vault/main", catalog_path: null },
      { source_id: "other_papers", path: "/vault/other", catalog_path: null },
    ],
  })
  const paper = archivedPaper()
  const second = completeContext({
    sources: first.config.sources,
    papers: [paper],
    archiveIdentityLookup: { "Wang23-DIO": "openalex:W4387886124" },
  })
  const loads = []
  const archiveCalls = []
  const rebuildCalls = []
  const result = await archiveCandidateAndRebuild({
    repoRoot: "/fixture/repo",
    request: archiveRequest(),
    loadContext: async () => {
      loads.push(loads.length)
      return loads.length === 1 ? first : second
    },
    archive: async (options) => {
      archiveCalls.push(options)
      return { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO" }
    },
    rebuild: async (options) => {
      rebuildCalls.push(options)
      return { paperCount: 1 }
    },
    markRecovery: async () => assert.fail("successful rebuild must not enter recovery"),
  })

  assert.deepEqual(result, {
    status: "created",
    paper_id: "Wang23-DIO",
    folder_name: "Wang23-DIO",
    rebuild_status: "complete",
    paper_count: 1,
  })
  assert.equal(loads.length, 2)
  assert.equal(archiveCalls.length, 1)
  assert.equal(archiveCalls[0].sourceRoot, "/vault/main")
  assert.equal(archiveCalls[0].sourceId, "main_papers")
  assert.equal(archiveCalls[0].existingPapers, first.scanned.papers)
  assert.deepEqual(archiveCalls[0].existingArchiveIdentities, [])
  assert.deepEqual(rebuildCalls, [{ repoRoot: "/fixture/repo", context: second }])
})

test("stale source selection, incomplete scans, and ambiguous archive identities fail before archive mutation", async () => {
  const base = completeContext()
  const cases = [
    { request: archiveRequest({ archive_source_id: "other_papers" }), context: base },
    { request: archiveRequest(), context: completeContext({ archiveSourceId: null }) },
    { request: archiveRequest(), context: completeContext({ auditSources: [] }) },
    {
      request: archiveRequest(),
      context: {
        ...base,
        scanned: {
          ...base.scanned,
          audit: {
            ...base.scanned.audit,
            blocking: { duplicate_archive_source_ids: ["openalex:W4387886124"] },
          },
        },
      },
    },
  ]

  for (const fixture of cases) {
    let archiveCalls = 0
    await assert.rejects(archiveCandidateAndRebuild({
      repoRoot: "/fixture/repo",
      request: fixture.request,
      loadContext: async () => fixture.context,
      archive: async () => { archiveCalls += 1 },
      rebuild: async () => assert.fail("invalid scan must not rebuild"),
      markRecovery: async () => assert.fail("pre-write failure must not enter recovery"),
    }), (error) => ["ARCHIVE_CONFLICT", "ARCHIVE_SCAN_INCOMPLETE"].includes(error?.code))
    assert.equal(archiveCalls, 0)
  }
})

test("scan completeness requires exact one-to-one source coverage, matching roots, and positive integer directory counts", async () => {
  const sources = [
    { source_id: "main_papers", path: "/vault/main", catalog_path: null },
    { source_id: "other_papers", path: "/vault/other", catalog_path: null },
  ]
  const invalidAudits = [
    [
      { source_id: "main_papers", root_path: "/vault/main", scanned_directories: 1 },
      { source_id: "main_papers", root_path: "/vault/main", scanned_directories: 1 },
      { source_id: "other_papers", root_path: "/vault/other", scanned_directories: 1 },
    ],
    [{ source_id: "main_papers", root_path: "/vault/main", scanned_directories: 1 }],
    [
      { source_id: "main_papers", root_path: "/vault/main", scanned_directories: 1 },
      { source_id: "extra_papers", root_path: "/vault/extra", scanned_directories: 1 },
    ],
    [
      { source_id: "main_papers", root_path: "/vault/stale", scanned_directories: 1 },
      { source_id: "other_papers", root_path: "/vault/other", scanned_directories: 1 },
    ],
    [
      { source_id: "main_papers", root_path: "/vault/main", scanned_directories: 0 },
      { source_id: "other_papers", root_path: "/vault/other", scanned_directories: 1 },
    ],
    [
      { source_id: "main_papers", root_path: "/vault/main", scanned_directories: 1.5 },
      { source_id: "other_papers", root_path: "/vault/other", scanned_directories: 1 },
    ],
  ]

  for (const auditSources of invalidAudits) {
    let archiveCalls = 0
    await assert.rejects(archiveCandidateAndRebuild({
      repoRoot: "/fixture/repo",
      request: archiveRequest(),
      loadContext: async () => completeContext({ sources, auditSources }),
      archive: async () => { archiveCalls += 1 },
      rebuild: async () => assert.fail("incomplete scan cannot rebuild"),
      markRecovery: async () => assert.fail("pre-write scan rejection cannot mark recovery"),
      recoveryStore: createArchiveRecoveryStore(),
    }), { code: "ARCHIVE_SCAN_INCOMPLETE" })
    assert.equal(archiveCalls, 0)
  }
})

test("an ambiguous post-mutation archive transaction marks manual-archive recovery before the action rejects", async () => {
  const events = []
  const ambiguous = Object.assign(new Error("fixed archive ambiguity"), { code: "ARCHIVE_TRANSACTION_AMBIGUOUS" })
  await assert.rejects(archiveCandidateAndRebuild({
    repoRoot: "/fixture/repo",
    request: archiveRequest(),
    loadContext: async () => completeContext(),
    archive: async () => { events.push("archive"); throw ambiguous },
    rebuild: async () => assert.fail("ambiguous archive must not rebuild"),
    markRecovery: async (details) => events.push(details),
    recoveryStore: createArchiveRecoveryStore(),
  }), ambiguous)
  assert.deepEqual(events, [
    "archive",
    { kind: "manual_archive", reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS" },
  ])
})

test("an exact controlled package requires rebuild while any metadata or identity mismatch is a conflict", async () => {
  const exact = completeContext({
    papers: [archivedPaper()],
    archiveIdentityLookup: { "Wang23-DIO": "openalex:W4387886124" },
  })
  const mismatch = completeContext({
    papers: [archivedPaper({ title_original: "Changed title" })],
    archiveIdentityLookup: { "Wang23-DIO": "openalex:W4387886124" },
  })

  for (const [context, code] of [[exact, "ARCHIVE_REBUILD_REQUIRED"], [mismatch, "ARCHIVE_CONFLICT"]]) {
    await assert.rejects(archiveCandidateAndRebuild({
      repoRoot: "/fixture/repo",
      request: archiveRequest(),
      loadContext: async () => context,
      archive: async () => assert.fail("existing package must never be rewritten"),
      rebuild: async () => assert.fail("re-submit uses the explicit recovery route"),
      markRecovery: async () => assert.fail("re-submit does not create recovery state"),
    }), { code })
  }
})

test("candidate build failure preserves the controlled package and both last-good trees before marking recovery", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "candidate-action-repo-"))
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-action-source-")))
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  })
  for (const [directory, file, bytes] of [
    ["local_library_data", "paper-index.json", "LAST-GOOD-DATA"],
    ["local_library_output/desktop", "library.html", "LAST-GOOD-OUTPUT"],
  ]) {
    await mkdir(join(repoRoot, directory), { recursive: true })
    await writeFile(join(repoRoot, directory, file), bytes)
  }
  const beforeData = await treeDigest(join(repoRoot, "local_library_data"))
  const beforeOutput = await treeDigest(join(repoRoot, "local_library_output"))
  const recovery = []
  const recoveryStore = createArchiveRecoveryStore()
  const submitted = archiveRequest()

  const result = await archiveCandidateAndRebuild({
    repoRoot,
    request: submitted,
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => { throw new Error("/private/build/failure") },
    markRecovery: async (details) => recovery.push(details),
    recoveryStore,
  })

  assert.deepEqual(result, {
    status: "created",
    paper_id: "Wang23-DIO",
    folder_name: "Wang23-DIO",
    rebuild_status: "failed",
    paper_count: null,
  })
  assert.deepEqual(recovery, [{
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  }])
  assert.equal(submitted.candidate.stage, "confirmed_for_archive")
  assert.equal((await lstat(join(sourceRoot, "Wang23-DIO/metadata.yaml"))).isFile(), true)
  assert.equal((await lstat(join(sourceRoot, "Wang23-DIO/.metadata.commit"))).isFile(), true)
  assert.equal(await treeDigest(join(repoRoot, "local_library_data")), beforeData)
  assert.equal(await treeDigest(join(repoRoot, "local_library_output")), beforeOutput)
  assert.equal(recoveryStore.size(), 1)

  await assert.rejects(archiveCandidateAndRebuild({
    repoRoot,
    request: archiveRequest(),
    loadContext: async () => scanContext(sourceRoot),
    archive: async () => assert.fail("preserved package must not be rewritten"),
    rebuild: async () => assert.fail("re-submit must not rebuild implicitly"),
    markRecovery: async () => assert.fail("existing recovery is owned by the coordinator"),
  }), { code: "ARCHIVE_REBUILD_REQUIRED" })
})

test("recovery verifies the preserved controlled identity, rebuilds without rewriting metadata, and clears only on success", async (t) => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-recovery-source-")))
  t.after(() => rm(sourceRoot, { recursive: true, force: true }))
  const request = archiveRequest()
  const recoveryStore = createArchiveRecoveryStore()
  await archiveCandidateAndRebuild({
    repoRoot: "/fixture/repo",
    request,
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => { throw new Error("induced") },
    markRecovery: async () => {},
    recoveryStore,
  })
  const before = await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml"))
  let clears = 0
  const recovered = await rebuildArchivedCandidate({
    repoRoot: "/fixture/repo",
    request: recoveryRequest(),
    recovery: {
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => ({ paperCount: 1 }),
    clearRecovery: async () => { clears += 1 },
    recoveryStore,
  })
  assert.deepEqual(recovered, {
    status: "recovered",
    paper_id: "Wang23-DIO",
    rebuild_status: "complete",
    paper_count: 1,
  })
  assert.equal(clears, 1)
  assert.equal(recoveryStore.size(), 0)
  assert.deepEqual(await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml")), before)

  const wrongIdentity = completeContext({
    sourceRoot,
    papers: [archivedPaper()],
    archiveIdentityLookup: { "Wang23-DIO": "openalex:W999" },
  })
  clears = 0
  await assert.rejects(rebuildArchivedCandidate({
    repoRoot: "/fixture/repo",
    request: recoveryRequest(),
    recovery: {
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
    loadContext: async () => wrongIdentity,
    rebuild: async () => assert.fail("identity mismatch must not rebuild"),
    clearRecovery: async () => { clears += 1 },
    recoveryStore: createArchiveRecoveryStore(),
  }), { code: "ARCHIVE_CONFLICT" })
  assert.equal(clears, 0)
})

test("a fresh process with no private archive proof cannot recover an untouched on-disk package", async (t) => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-proof-restart-")))
  t.after(() => rm(sourceRoot, { recursive: true, force: true }))
  const populatedStore = createArchiveRecoveryStore()
  await archiveCandidateAndRebuild({
    repoRoot: "/fixture/repo",
    request: archiveRequest(),
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => { throw new Error("induced") },
    markRecovery: async () => {},
    recoveryStore: populatedStore,
  })

  const freshStore = createArchiveRecoveryStore()
  let rebuildCalls = 0
  let clearCalls = 0
  await assert.rejects(rebuildArchivedCandidate({
    repoRoot: "/fixture/repo",
    request: recoveryRequest(),
    recovery: {
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => { rebuildCalls += 1 },
    clearRecovery: async () => { clearCalls += 1 },
    recoveryStore: freshStore,
  }), { code: "ARCHIVE_CONFLICT" })
  assert.equal(rebuildCalls, 0)
  assert.equal(clearCalls, 0)
  assert.equal(freshStore.size(), 0)
})

test("recovery proof rejects re-hashed rewrites, inode replacement, added files, and tuple mismatch without clearing", async (t) => {
  const mutations = [
    {
      name: "metadata and commit rewritten together",
      mutate: async (sourceRoot) => {
        const metadataPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
        const metadata = (await readFile(metadataPath, "utf8")).replace(CANDIDATE.title, "Tampered title")
        await writeFile(metadataPath, metadata)
        await writeFile(join(sourceRoot, "Wang23-DIO/.metadata.commit"), `sha256:${archiveMetadataSha256(metadata)}\n`)
      },
      request: recoveryRequest(),
    },
    {
      name: "metadata inode replaced with identical bytes",
      mutate: async (sourceRoot) => {
        const metadataPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
        const displaced = join(sourceRoot, "Wang23-DIO/.old-metadata")
        const bytes = await readFile(metadataPath)
        await rename(metadataPath, displaced)
        await writeFile(metadataPath, bytes)
        await rm(displaced)
      },
      request: recoveryRequest(),
    },
    {
      name: "unexpected package file added",
      mutate: async (sourceRoot) => writeFile(join(sourceRoot, "Wang23-DIO/extra.txt"), "unexpected"),
      request: recoveryRequest(),
    },
    {
      name: "request tuple changed",
      mutate: async () => {},
      request: recoveryRequest({ openalex_id: "W999" }),
    },
  ]

  for (const mutation of mutations) {
    const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-proof-tamper-")))
    t.after(() => rm(sourceRoot, { recursive: true, force: true }))
    const recoveryStore = createArchiveRecoveryStore()
    await archiveCandidateAndRebuild({
      repoRoot: "/fixture/repo",
      request: archiveRequest(),
      loadContext: async () => scanContext(sourceRoot),
      rebuild: async () => { throw new Error("induced") },
      markRecovery: async () => {},
      recoveryStore,
    })
    await mutation.mutate(sourceRoot)
    let rebuildCalls = 0
    let clearCalls = 0
    await assert.rejects(rebuildArchivedCandidate({
      repoRoot: "/fixture/repo",
      request: mutation.request,
      recovery: {
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: "W4387886124",
      },
      loadContext: async () => scanContext(sourceRoot),
      rebuild: async () => { rebuildCalls += 1 },
      clearRecovery: async () => { clearCalls += 1 },
      recoveryStore,
    }), (error) => error?.code === "ARCHIVE_CONFLICT", mutation.name)
    assert.equal(rebuildCalls, 0, mutation.name)
    assert.equal(clearCalls, 0, mutation.name)
    assert.equal(recoveryStore.size(), 1, mutation.name)
  }
})

test("recovery rechecks proof after rebuild mutations before clearing coordinator or private store", async (t) => {
  const mutations = [
    {
      name: "metadata and commit rewritten during rebuild",
      mutate: async (sourceRoot) => {
        const metadataPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
        const metadata = (await readFile(metadataPath, "utf8")).replace(CANDIDATE.title, "Tampered title")
        await writeFile(metadataPath, metadata)
        await writeFile(join(sourceRoot, "Wang23-DIO/.metadata.commit"), `sha256:${archiveMetadataSha256(metadata)}\n`)
      },
    },
    {
      name: "source root replaced during rebuild",
      mutate: async (sourceRoot, cleanupPaths) => {
        const displaced = `${sourceRoot}-displaced`
        await rename(sourceRoot, displaced)
        cleanupPaths.push(displaced)
        await mkdir(sourceRoot)
      },
    },
    {
      name: "package directory replaced during rebuild",
      mutate: async (sourceRoot) => {
        await rename(join(sourceRoot, "Wang23-DIO"), join(sourceRoot, ".displaced-package"))
        await mkdir(join(sourceRoot, "Wang23-DIO"))
      },
    },
    {
      name: "metadata inode replaced during rebuild",
      mutate: async (sourceRoot) => {
        const metadataPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
        const displaced = join(sourceRoot, "Wang23-DIO/.displaced-metadata")
        const bytes = await readFile(metadataPath)
        await rename(metadataPath, displaced)
        await writeFile(metadataPath, bytes)
        await rm(displaced)
      },
    },
    {
      name: "package member added during rebuild",
      mutate: async (sourceRoot) => writeFile(join(sourceRoot, "Wang23-DIO/extra.txt"), "unexpected"),
    },
  ]

  for (const mutation of mutations) {
    const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-proof-rebuild-race-")))
    const cleanupPaths = []
    t.after(async () => {
      await rm(sourceRoot, { recursive: true, force: true })
      for (const path of cleanupPaths) await rm(path, { recursive: true, force: true })
    })
    const recoveryStore = createArchiveRecoveryStore()
    await archiveCandidateAndRebuild({
      repoRoot: "/fixture/repo",
      request: archiveRequest(),
      loadContext: async () => scanContext(sourceRoot),
      rebuild: async () => { throw new Error("induced initial rebuild failure") },
      markRecovery: async () => {},
      recoveryStore,
    })
    let clearCalls = 0
    await assert.rejects(rebuildArchivedCandidate({
      repoRoot: "/fixture/repo",
      request: recoveryRequest(),
      recovery: {
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: "W4387886124",
      },
      loadContext: async () => scanContext(sourceRoot),
      rebuild: async () => {
        await mutation.mutate(sourceRoot, cleanupPaths)
        return { paperCount: 1 }
      },
      clearRecovery: async () => { clearCalls += 1 },
      recoveryStore,
    }), (error) => error?.code === "ARCHIVE_CONFLICT", mutation.name)
    assert.equal(clearCalls, 0, mutation.name)
    assert.equal(recoveryStore.size(), 1, mutation.name)
  }
})

test("recovery rejects a metadata rewrite inside the final proof pass before clearing either recovery state", async (t) => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "candidate-proof-final-pass-race-")))
  t.after(() => rm(sourceRoot, { recursive: true, force: true }))
  const recoveryStore = createArchiveRecoveryStore()
  await archiveCandidateAndRebuild({
    repoRoot: "/fixture/repo",
    request: archiveRequest(),
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => { throw new Error("induced initial rebuild failure") },
    markRecovery: async () => {},
    recoveryStore,
  })

  const metadataPath = join(sourceRoot, "Wang23-DIO/metadata.yaml")
  const commitPath = join(sourceRoot, "Wang23-DIO/.metadata.commit")
  const original = await readFile(metadataPath)
  const changed = Buffer.from(original)
  changed[0] = changed[0] === 0x23 ? 0x24 : 0x23
  const before = await lstat(metadataPath)
  let commitOpens = 0
  let clearCalls = 0

  await assert.rejects(rebuildArchivedCandidate({
    repoRoot: "/fixture/repo",
    request: recoveryRequest(),
    recovery: {
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
    loadContext: async () => scanContext(sourceRoot),
    rebuild: async () => ({ paperCount: 1 }),
    clearRecovery: async () => { clearCalls += 1 },
    recoveryStore,
    recoveryFileSystem: {
      open: async (path, flags, mode) => {
        if (path === commitPath) {
          commitOpens += 1
          if (commitOpens === 4) await writeFile(metadataPath, changed)
        }
        return openFile(path, flags, mode)
      },
    },
  }), { code: "ARCHIVE_CONFLICT" })
  const after = await lstat(metadataPath)
  assert.equal(commitOpens, 4)
  assert.equal(clearCalls, 0)
  assert.equal(recoveryStore.size(), 1)
  assert.equal(after.dev, before.dev)
  assert.equal(after.ino, before.ino)
  assert.equal(after.size, before.size)
})
