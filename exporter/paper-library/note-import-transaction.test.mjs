import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import * as fsPromises from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createInspectionStore,
  importInspectedNote,
} from "./note-import.mjs"
import { ARTIFACT_KEYS } from "./artifacts.mjs"
import { createEmptyFacets, serializeFacetSchema } from "./facet-schema.mjs"
import { METADATA_PROVENANCE_FIELDS } from "./overrides.mjs"
import { CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES } from "./status.mjs"

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function makeFixture(t) {
  const lexicalRoot = await fsPromises.mkdtemp(join(tmpdir(), "note-import-"))
  t?.after(() => fsPromises.rm(lexicalRoot, { recursive: true, force: true }))
  const repoRoot = await fsPromises.realpath(lexicalRoot)
  const sourceRoot = join(repoRoot, "source")
  const unitDirectory = join(sourceRoot, "Topic", "Paper")
  await fsPromises.mkdir(unitDirectory, { recursive: true })
  const paper = { paper_id: "Paper-01", source_id: "main", relative_path: "Topic/Paper" }
  const context = {
    config: { version: 1, sources: [{ source_id: "main", path: sourceRoot, catalog_path: null }] },
    papersById: new Map([[paper.paper_id, paper]]),
    unitDirectoryByPaperId: new Map([[paper.paper_id, unitDirectory]]),
  }
  return { repoRoot, sourceRoot, unitDirectory, paper, context }
}

function noteSnapshot(fixture, { bytes = Buffer.from("# imported note"), overrides = {} } = {}) {
  return {
    bytes: Buffer.from(bytes),
    sha256: hash(bytes),
    paper_id: fixture.paper.paper_id,
    source_id: fixture.paper.source_id,
    relative_path: fixture.paper.relative_path,
    unit_real_path: fixture.unitDirectory,
    category: "note",
    original_file_name: "local.md",
    suggested_file_name: "Paper-01_论文精读.md",
    target_tab: "note",
    checks: { items: [], blocking_codes: [], warning_codes: [], can_import: true },
    ...overrides,
  }
}

function previewUrl(character = "a") {
  return `../../local_library_data/notes/paper-01/note/${character.repeat(64)}.html`
}

async function writeIndex(repoRoot, labels, transform = (value) => value) {
  const documents = labels.map((label) => ({
    label,
    url: previewUrl(label.includes("_v3") ? "c" : label.includes("_v2") ? "b" : "a"),
    size_bytes: 10,
    is_default: false,
  }))
  const artifacts = Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, []]))
  const artifactAvailability = Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, false]))
  const controlledPreviewDocuments = Object.fromEntries(
    CONTROLLED_PREVIEW_DOCUMENT_CATEGORIES.map((category) => [category, category === "note" ? documents : []]),
  )
  const paper = {
    paper_id: "Paper-01",
    slug: "paper-01",
    source_id: "main",
    relative_path: "Topic/Paper",
    identity_source: "override",
    unit_type: "article",
    parent_paper_id: null,
    title_original: "Paper title",
    title_zh: "",
    title_en: "Paper title",
    authors: ["Author"],
    publication_year: 2024,
    version_date: null,
    year: 2024,
    venue: "Journal",
    doi_or_url: "",
    metadata_provenance: Object.fromEntries([...METADATA_PROVENANCE_FIELDS].map((field) => [field, "default"])),
    record_type: "外部论文",
    facets: createEmptyFacets(),
    facet_states: {},
    source_terms: [],
    contribution_role: "unclassified",
    p02_relevance: null,
    artifacts,
    artifact_availability: artifactAvailability,
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    writing_material_count: 0,
    preferred_note: null,
    note_preview_url: null,
    warnings: [],
    note_status: labels.length > 0 ? "notes_ready" : "metadata_only",
    controlled_previews: { note: null, derivation: null, simulation: null, code_compare: null },
    controlled_preview_documents: controlledPreviewDocuments,
    source_documents: { pdf: [], ocr: [] },
  }
  await fsPromises.mkdir(join(repoRoot, "local_library_data"), { recursive: true })
  const index = transform({
    version: 3,
    facet_schema: serializeFacetSchema(),
    warning_count: 0,
    papers: [paper],
  })
  await fsPromises.writeFile(join(repoRoot, "local_library_data/paper-index.json"), JSON.stringify(index))
}

async function successfulRebuild(fixture) {
  const labels = (await fsPromises.readdir(fixture.unitDirectory))
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
  await writeIndex(fixture.repoRoot, labels)
  return { paperCount: 1 }
}

test("inspection records clone snapshots, expire after ten minutes, and are consumed exactly once", () => {
  let now = 1_000
  let sequence = 0
  const source = Buffer.from("# note")
  const store = createInspectionStore({ now: () => now, randomId: () => `inspection-${++sequence}` })
  const created = store.create({ bytes: source, sha256: hash(source), paper_id: "Paper-01" })
  source.fill(0)

  assert.equal(created.expires_at, new Date(601_000).toISOString())
  assert.equal(store.peek(created.inspection_id).bytes.toString(), "# note")
  const taken = store.take(created.inspection_id)
  assert.equal(taken.paper_id, "Paper-01")
  assert.equal(taken.bytes.toString(), "# note")
  assert.throws(() => store.take(created.inspection_id), { code: "INSPECTION_INVALID" })

  const expired = store.create({ bytes: Buffer.from("# second"), sha256: "hash2", paper_id: "Paper-01" })
  now = 601_001
  assert.throws(() => store.take(expired.inspection_id), { code: "INSPECTION_EXPIRED" })
  assert.equal(store.size(), 0)
})

test("exclusive version naming creates v2 then v3 without changing the existing note", async (t) => {
  const fixture = await makeFixture(t)
  const requested = "Paper-01_论文精读.md"
  const existing = Buffer.from("# existing")
  await fsPromises.writeFile(join(fixture.unitDirectory, requested), existing)
  const sourceBytes = Buffer.from("# imported")
  const store = createInspectionStore({ randomId: () => "inspection" })
  store.create(noteSnapshot(fixture, { bytes: sourceBytes }))
  sourceBytes.fill(0)
  const snapshot = store.take("inspection")

  const first = await importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot,
    requestedFileName: requested,
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => successfulRebuild(fixture),
  })
  const second = await importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot,
    requestedFileName: requested,
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => successfulRebuild(fixture),
  })

  assert.equal(first.actual_file_name, "Paper-01_论文精读_v2.md")
  assert.equal(second.actual_file_name, "Paper-01_论文精读_v3.md")
  assert.equal((await fsPromises.readFile(join(fixture.unitDirectory, requested))).compare(existing), 0)
  assert.equal((await fsPromises.readFile(join(fixture.unitDirectory, first.actual_file_name))).toString(), "# imported")
})

test("current scan identity, path, and snapshot hash changes fail before any write", async (t) => {
  const fixture = await makeFixture(t)
  const snapshot = noteSnapshot(fixture)
  const contexts = [
    { ...fixture.context, papersById: new Map() },
    { ...fixture.context, papersById: new Map([["Paper-01", { ...fixture.paper, source_id: "other" }]]) },
    { ...fixture.context, papersById: new Map([["Paper-01", { ...fixture.paper, relative_path: "Other" }]]) },
    { ...fixture.context, unitDirectoryByPaperId: new Map([["Paper-01", fixture.sourceRoot]]) },
  ]
  for (const context of contexts) {
    await assert.rejects(() => importInspectedNote({
      repoRoot: fixture.repoRoot,
      snapshot,
      requestedFileName: snapshot.suggested_file_name,
      conflictPolicy: "version",
      loadContext: async () => context,
      rebuild: async () => { throw new Error("must not rebuild") },
    }), { code: "PAPER_MAPPING_CHANGED" })
  }
  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: { ...snapshot, sha256: "0".repeat(64) },
    requestedFileName: snapshot.suggested_file_name,
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => { throw new Error("must not rebuild") },
  }), { code: "INSPECTION_INVALID" })
  assert.deepEqual(await fsPromises.readdir(fixture.unitDirectory), [])
})

test("rejects source, unit, or target symlinks and uses exclusive no-follow creation flags", async (t) => {
  const sourceFixture = await makeFixture(t)
  const sourceLink = join(sourceFixture.repoRoot, "source-link")
  await fsPromises.symlink(sourceFixture.sourceRoot, sourceLink)
  const sourceContext = {
    ...sourceFixture.context,
    config: { version: 1, sources: [{ source_id: "main", path: sourceLink, catalog_path: null }] },
  }
  await assert.rejects(() => importInspectedNote({
    repoRoot: sourceFixture.repoRoot,
    snapshot: noteSnapshot(sourceFixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => sourceContext,
    rebuild: async () => { throw new Error("must not rebuild") },
  }), { code: "UNSAFE_TARGET" })

  const unitFixture = await makeFixture(t)
  const unitLink = join(unitFixture.sourceRoot, "unit-link")
  await fsPromises.symlink(unitFixture.unitDirectory, unitLink)
  const unitContext = { ...unitFixture.context, unitDirectoryByPaperId: new Map([["Paper-01", unitLink]]) }
  await assert.rejects(() => importInspectedNote({
    repoRoot: unitFixture.repoRoot,
    snapshot: noteSnapshot(unitFixture, { overrides: { unit_real_path: unitLink } }),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => unitContext,
    rebuild: async () => { throw new Error("must not rebuild") },
  }), { code: "UNSAFE_TARGET" })

  const targetFixture = await makeFixture(t)
  const target = join(targetFixture.unitDirectory, "Paper-01_论文精读.md")
  await fsPromises.symlink(join(targetFixture.unitDirectory, "missing.md"), target)
  await assert.rejects(() => importInspectedNote({
    repoRoot: targetFixture.repoRoot,
    snapshot: noteSnapshot(targetFixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => targetFixture.context,
    rebuild: async () => { throw new Error("must not rebuild") },
  }), { code: "UNSAFE_TARGET" })

  const flagsFixture = await makeFixture(t)
  const calls = []
  const injectedFs = {
    ...fsPromises,
    constants,
    open: async (path, flags, mode) => { calls.push({ path, flags, mode }); return fsPromises.open(path, flags, mode) },
  }
  await importInspectedNote({
    repoRoot: flagsFixture.repoRoot,
    snapshot: noteSnapshot(flagsFixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => flagsFixture.context,
    rebuild: async () => successfulRebuild(flagsFixture),
    fs: injectedFs,
  })
  const creation = calls.find(({ flags }) => (flags & constants.O_WRONLY) === constants.O_WRONLY)
  assert.equal(creation.flags, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW)
  assert.equal(creation.mode, 0o600)
})

test("a unit directory replaced before O_CREAT is rejected without writing outside the source root", async (t) => {
  const fixture = await makeFixture(t)
  const outside = await fsPromises.mkdtemp(join(tmpdir(), "note-import-outside-"))
  t.after(() => fsPromises.rm(outside, { recursive: true, force: true }))
  const originalUnit = `${fixture.unitDirectory}.verified`
  let hookCalled = false
  let targetCreateCount = 0
  const injectedFs = {
    ...fsPromises,
    constants,
    beforeCreate: async () => {
      hookCalled = true
      await fsPromises.rename(fixture.unitDirectory, originalUnit)
      await fsPromises.symlink(outside, fixture.unitDirectory)
    },
    open: async (path, flags, mode) => {
      if ((flags & constants.O_CREAT) === constants.O_CREAT) targetCreateCount += 1
      return fsPromises.open(path, flags, mode)
    },
  }

  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => { throw new Error("must not rebuild") },
    fs: injectedFs,
  }), { code: "UNSAFE_TARGET" })

  assert.equal(hookCalled, true)
  assert.equal(targetCreateCount, 0)
  assert.deepEqual(await fsPromises.readdir(outside), [])
  assert.deepEqual(await fsPromises.readdir(originalUnit), [])
})

test("build failure removes an unchanged new note and preserves old generated output", async (t) => {
  const fixture = await makeFixture(t)
  await fsPromises.mkdir(join(fixture.repoRoot, "local_library_data"), { recursive: true })
  await fsPromises.writeFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "old-data")

  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => { throw new Error("private build failure") },
  }), { code: "BUILD_FAILED" })

  assert.equal(await fsPromises.readFile(join(fixture.repoRoot, "local_library_data/sentinel.txt"), "utf8"), "old-data")
  assert.deepEqual(await fsPromises.readdir(fixture.unitDirectory), [])
})

test("write failure with failed cleanup returns fixed recovery code and leaves the created file", async (t) => {
  const fixture = await makeFixture(t)
  const target = join(fixture.unitDirectory, "Paper-01_论文精读.md")
  const injectedFs = {
    ...fsPromises,
    constants,
    open: async (path, flags, mode) => {
      const handle = await fsPromises.open(path, flags, mode)
      if ((flags & constants.O_WRONLY) !== constants.O_WRONLY) return handle
      return {
        stat: (...args) => handle.stat(...args),
        writeFile: async (bytes) => {
          await handle.writeFile(Buffer.from(bytes).subarray(0, 4))
          throw Object.assign(new Error("private write failure"), { code: "EIO" })
        },
        sync: (...args) => handle.sync(...args),
        close: (...args) => handle.close(...args),
      }
    },
    unlink: async () => { throw Object.assign(new Error("private unlink failure"), { code: "EACCES" }) },
  }

  let caught
  try {
    await importInspectedNote({
      repoRoot: fixture.repoRoot,
      snapshot: noteSnapshot(fixture),
      requestedFileName: "Paper-01_论文精读.md",
      conflictPolicy: "version",
      loadContext: async () => fixture.context,
      rebuild: async () => { throw new Error("must not rebuild") },
      fs: injectedFs,
    })
  } catch (error) {
    caught = error
  }

  assert.equal(caught.code, "ROLLBACK_FAILED")
  assert.equal(caught.message, "自动回滚失败")
  assert.equal(caught.message.includes(fixture.repoRoot), false)
  assert.equal((await fsPromises.readFile(target)).length > 0, true)
})

test("initial fingerprint failure removes the safely identified created file", async (t) => {
  const fixture = await makeFixture(t)
  let failReadOpen = true
  const injectedFs = {
    ...fsPromises,
    constants,
    open: async (path, flags, mode) => {
      const isReadOnly = String(path).endsWith(".md") && (flags & (constants.O_WRONLY | constants.O_RDWR)) === 0
      if (isReadOnly && failReadOpen) {
        failReadOpen = false
        throw Object.assign(new Error("private fingerprint failure"), { code: "EIO" })
      }
      return fsPromises.open(path, flags, mode)
    },
  }

  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => { throw new Error("must not rebuild") },
    fs: injectedFs,
  }), { code: "WRITE_FAILED" })

  assert.deepEqual(await fsPromises.readdir(fixture.unitDirectory), [])
})

test("initial fingerprint failure with failed cleanup returns fixed recovery code", async (t) => {
  const fixture = await makeFixture(t)
  let failReadOpen = true
  const injectedFs = {
    ...fsPromises,
    constants,
    open: async (path, flags, mode) => {
      const isReadOnly = String(path).endsWith(".md") && (flags & (constants.O_WRONLY | constants.O_RDWR)) === 0
      if (isReadOnly && failReadOpen) {
        failReadOpen = false
        throw Object.assign(new Error("private fingerprint failure"), { code: "EIO" })
      }
      return fsPromises.open(path, flags, mode)
    },
    unlink: async () => { throw Object.assign(new Error("private unlink failure"), { code: "EACCES" }) },
  }

  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => { throw new Error("must not rebuild") },
    fs: injectedFs,
  }), { code: "ROLLBACK_FAILED" })

  assert.deepEqual(await fsPromises.readdir(fixture.unitDirectory), ["Paper-01_论文精读.md"])
})

test("changed created-file fingerprint prevents rollback and returns a fixed recovery code", async (t) => {
  const fixture = await makeFixture(t)
  const target = join(fixture.unitDirectory, "Paper-01_论文精读.md")
  let error
  try {
    await importInspectedNote({
      repoRoot: fixture.repoRoot,
      snapshot: noteSnapshot(fixture),
      requestedFileName: "Paper-01_论文精读.md",
      conflictPolicy: "version",
      loadContext: async () => fixture.context,
      rebuild: async () => {
        await fsPromises.writeFile(target, "externally changed")
        throw new Error("private build failure")
      },
    })
  } catch (caught) {
    error = caught
  }
  assert.equal(error.code, "ROLLBACK_FAILED")
  assert.equal(error.message, "自动回滚失败")
  assert.equal(error.message.includes(fixture.repoRoot), false)
  assert.equal(await fsPromises.readFile(target, "utf8"), "externally changed")
})

test("successful build with missing or duplicate reconciliation keeps the new note and blocks completion", async (t) => {
  for (const mode of ["missing", "duplicate"]) {
    const fixture = await makeFixture(t)
    await assert.rejects(() => importInspectedNote({
      repoRoot: fixture.repoRoot,
      snapshot: noteSnapshot(fixture),
      requestedFileName: "Paper-01_论文精读.md",
      conflictPolicy: "version",
      loadContext: async () => fixture.context,
      rebuild: async () => writeIndex(
        fixture.repoRoot,
        mode === "duplicate" ? ["Paper-01_论文精读.md", "Paper-01_论文精读.md"] : [],
      ),
    }), { code: "BUILD_OUTPUT_INVALID" })
    assert.equal((await fsPromises.readFile(join(fixture.unitDirectory, "Paper-01_论文精读.md"))).length > 0, true)
  }
})

test("reconciliation rejects every malformed full generated index boundary", async (t) => {
  const cases = [
    ["wrong version", (index) => ({ ...index, version: 2 })],
    ["extra private root field", (index) => ({ ...index, private_path: "/private/source" })],
    ["duplicate paper ids", (index) => ({ ...index, papers: [index.papers[0], structuredClone(index.papers[0])] })],
    ["extra private paper field", (index) => ({
      ...index,
      papers: [{ ...index.papers[0], private_path: "/private/source/Paper" }],
    })],
  ]
  for (const [label, transform] of cases) {
    await t.test(label, async (subtest) => {
      const fixture = await makeFixture(subtest)
      await assert.rejects(() => importInspectedNote({
        repoRoot: fixture.repoRoot,
        snapshot: noteSnapshot(fixture),
        requestedFileName: "Paper-01_论文精读.md",
        conflictPolicy: "version",
        loadContext: async () => fixture.context,
        rebuild: async () => writeIndex(fixture.repoRoot, ["Paper-01_论文精读.md"], transform),
      }), { code: "BUILD_OUTPUT_INVALID" })
      assert.equal(
        (await fsPromises.readFile(join(fixture.unitDirectory, "Paper-01_论文精读.md"))).toString(),
        "# imported note",
      )
    })
  }
})

test("successful import reconciles one preview and hashes the exact generated index bytes", async (t) => {
  const fixture = await makeFixture(t)
  const result = await importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => successfulRebuild(fixture),
  })
  const indexBytes = await fsPromises.readFile(join(fixture.repoRoot, "local_library_data/paper-index.json"))

  assert.deepEqual(result, {
    paper_id: "Paper-01",
    actual_file_name: "Paper-01_论文精读.md",
    target_tab: "note",
    new_preview_url: previewUrl("a"),
    index_version: hash(indexBytes),
  })
  assert.match(result.index_version, /^[a-f0-9]{64}$/u)
})
