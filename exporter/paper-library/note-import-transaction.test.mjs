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

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function makeFixture() {
  const lexicalRoot = await fsPromises.mkdtemp(join(tmpdir(), "note-import-"))
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

async function writeIndex(repoRoot, labels) {
  const documents = labels.map((label) => ({
    label,
    url: previewUrl(label.includes("_v3") ? "c" : label.includes("_v2") ? "b" : "a"),
    size_bytes: 10,
    is_default: false,
  }))
  await fsPromises.mkdir(join(repoRoot, "local_library_data"), { recursive: true })
  await fsPromises.writeFile(join(repoRoot, "local_library_data/paper-index.json"), JSON.stringify({
    version: 3,
    papers: [{ paper_id: "Paper-01", controlled_preview_documents: { note: documents } }],
  }))
}

async function successfulRebuild(fixture) {
  const labels = (await fsPromises.readdir(fixture.unitDirectory)).filter((name) => name.endsWith(".md")).sort()
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

test("exclusive version naming creates v2 then v3 without changing the existing note", async () => {
  const fixture = await makeFixture()
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

test("current scan identity, path, and snapshot hash changes fail before any write", async () => {
  const fixture = await makeFixture()
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

test("rejects source, unit, or target symlinks and uses exclusive no-follow creation flags", async () => {
  const sourceFixture = await makeFixture()
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

  const unitFixture = await makeFixture()
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

  const targetFixture = await makeFixture()
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

  const flagsFixture = await makeFixture()
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

test("build failure removes an unchanged new note and preserves old generated output", async () => {
  const fixture = await makeFixture()
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

test("changed created-file fingerprint prevents rollback and returns a fixed recovery code", async () => {
  const fixture = await makeFixture()
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

test("successful build with missing or duplicate reconciliation keeps the new note and blocks completion", async () => {
  const fixture = await makeFixture()
  await assert.rejects(() => importInspectedNote({
    repoRoot: fixture.repoRoot,
    snapshot: noteSnapshot(fixture),
    requestedFileName: "Paper-01_论文精读.md",
    conflictPolicy: "version",
    loadContext: async () => fixture.context,
    rebuild: async () => writeIndex(fixture.repoRoot, []),
  }), { code: "BUILD_OUTPUT_INVALID" })
  assert.equal((await fsPromises.readFile(join(fixture.unitDirectory, "Paper-01_论文精读.md"))).length > 0, true)
})

test("successful import reconciles one preview and hashes the exact generated index bytes", async () => {
  const fixture = await makeFixture()
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
