import test from "node:test"
import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { createHash } from "node:crypto"
import { open, readFile, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"

import { startPrivateLibraryServer } from "./local-server.mjs"
import {
  FIXTURE_ARCHIVE_SOURCE_ID,
  FIXTURE_IDS,
  createIntegratedRepositoryFixture,
  startIntegratedServerFixture,
} from "../verification/integrated-server-fixture.mjs"

const forbiddenHomeMarker = ["", "Users", ""].join("/")

function archiveRequest({ paperId, openAlexId }) {
  return {
    version: 1,
    confirmation: "create_metadata_only",
    archive_source_id: FIXTURE_ARCHIVE_SOURCE_ID,
    paper_id: paperId,
    candidate: {
      paperId: openAlexId,
      doi: `10.1234/fixture.${openAlexId.slice(1)}`,
      title: `Fixture candidate ${openAlexId}`,
      authors: ["Fixture Author"],
      year: 2026,
      source: "Fixture Journal",
      citations: 7,
      isOpenAccess: true,
      openAccessUrl: `https://openalex.org/${openAlexId}`,
      landingPageUrl: `https://openalex.org/${openAlexId}`,
      topics: ["Distributed optimization"],
      abstract: "Deterministic integrated fixture candidate.",
      stage: "confirmed_for_archive",
    },
  }
}

function recoveryRequest({ paperId = FIXTURE_IDS.recoveryPaper, openAlexId = FIXTURE_IDS.recoveryOpenAlex } = {}) {
  return {
    confirmation: "retry_archive_rebuild",
    archive_source_id: FIXTURE_ARCHIVE_SOURCE_ID,
    paper_id: paperId,
    openalex_id: openAlexId,
  }
}

async function postJson(origin, pathname, body, { action = null } = {}) {
  const headers = { "content-type": "application/json", origin }
  if (action) headers["x-research-console-action"] = action
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  return { response, body: JSON.parse(await response.text()) }
}

async function inspectNote(origin, paperId = FIXTURE_IDS.richPaper) {
  return postJson(origin, "/api/v1/notes/inspect", {
    paper_id: paperId,
    category: "note",
    original_file_name: "fixture-import.md",
    markdown: "# Imported fixture note\n\nA bounded note with $x_{k+1}=x_k$.",
  })
}

async function readTree(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await visit(root)
  const rows = []
  for (const path of files.sort()) {
    const bytes = await readFile(path)
    rows.push([relative(root, path), createHash("sha256").update(bytes).digest("hex"), bytes.length])
  }
  return rows
}

function assertNoPrivatePath(value, fixture) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  assert.equal(text.includes(fixture.repoRoot), false)
  assert.equal(text.includes(fixture.sourceRoot), false)
  assert.equal(text.includes(forbiddenHomeMarker), false)
}

function assertPublicExchange(exchange, fixture) {
  assertNoPrivatePath(exchange.body, fixture)
  for (const value of exchange.response.headers.values()) assertNoPrivatePath(value, fixture)
}

test("startup builds before listening and a startup-build failure creates no listener", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())
  const indexResponse = await fetch(`${fixture.origin}/local_library_data/paper-index.json`)
  assert.equal(indexResponse.status, 200)
  assert.deepEqual((await indexResponse.json()).papers.map((paper) => paper.paper_id).sort(), [
    FIXTURE_IDS.metadataOnlyPaper,
    'Fixture24-Note',
    FIXTURE_IDS.richPaper,
  ].sort())

  const repository = await createIntegratedRepositoryFixture()
  context.after(() => repository.cleanup())
  let createServerCalls = 0
  await assert.rejects(() => startPrivateLibraryServer({
    repoRoot: repository.repoRoot,
    port: 0,
    rebuild: async () => { throw new Error("induced startup failure") },
    createServer: (...args) => {
      createServerCalls += 1
      return createHttpServer(...args)
    },
  }), /本地论文库启动构建失败/u)
  assert.equal(createServerCalls, 0)
})

test("real note inspection/import rebuilds a preview and restart invalidates old inspection tokens", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())
  const oldInspection = await inspectNote(fixture.origin)
  assertPublicExchange(oldInspection, fixture)
  assert.equal(oldInspection.response.status, 200)
  assert.equal(oldInspection.body.checks.can_import, true)

  const restartedOrigin = await fixture.restart()
  const stale = await postJson(restartedOrigin, "/api/v1/notes/import", {
    inspection_id: oldInspection.body.inspection_id,
    requested_file_name: oldInspection.body.suggested_file_name,
    conflict_policy: "version",
  })
  assertPublicExchange(stale, fixture)
  assert.equal(stale.response.status, 409)
  assert.equal(stale.body.error.code, "INSPECTION_INVALID")

  const freshInspection = await inspectNote(restartedOrigin)
  assertPublicExchange(freshInspection, fixture)
  const imported = await postJson(restartedOrigin, "/api/v1/notes/import", {
    inspection_id: freshInspection.body.inspection_id,
    requested_file_name: freshInspection.body.suggested_file_name,
    conflict_policy: "version",
  })
  assertPublicExchange(imported, fixture)
  assert.equal(imported.response.status, 200)
  assert.equal(imported.body.paper_id, FIXTURE_IDS.richPaper)
  assert.match(imported.body.index_version, /^[a-f0-9]{64}$/u)
  assert.match(imported.body.new_preview_url, /^\.\.\/\.\.\/local_library_data\/notes\//u)
  const preview = await fetch(new URL(imported.body.new_preview_url, `${restartedOrigin}/local_library_output/desktop/library.html`))
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), /Imported fixture note/u)
})

test("metadata-only archive enters the public index and a held archive rejects a cross-operation write with 409", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 750 })
  context.after(() => fixture.close())
  const inspected = await inspectNote(fixture.origin)
  assertPublicExchange(inspected, fixture)
  assert.equal(inspected.response.status, 200)

  const heldArchive = postJson(fixture.origin, "/api/v1/archive/candidates", archiveRequest({
    paperId: FIXTURE_IDS.busyPaper,
    openAlexId: FIXTURE_IDS.busyOpenAlex,
  }), { action: "archive-candidate" })
  await fixture.waitForBusyRebuild()
  const busyImport = await postJson(fixture.origin, "/api/v1/notes/import", {
    inspection_id: inspected.body.inspection_id,
    requested_file_name: inspected.body.suggested_file_name,
    conflict_policy: "version",
  })
  assertPublicExchange(busyImport, fixture)
  assert.equal(busyImport.response.status, 409)
  assert.equal(busyImport.body.error.code, "LIBRARY_WRITE_BUSY")
  const archived = await heldArchive
  assertPublicExchange(archived, fixture)
  assert.equal(archived.response.status, 201)
  assert.equal(archived.body.rebuild_status, "complete")

  const success = await postJson(fixture.origin, "/api/v1/archive/candidates", archiveRequest({
    paperId: FIXTURE_IDS.newPaper,
    openAlexId: FIXTURE_IDS.newOpenAlex,
  }), { action: "archive-candidate" })
  assertPublicExchange(success, fixture)
  assert.equal(success.response.status, 201)
  assert.equal(success.body.rebuild_status, "complete")
  const index = await (await fetch(`${fixture.origin}/local_library_data/paper-index.json`)).json()
  for (const paperId of [FIXTURE_IDS.busyPaper, FIXTURE_IDS.newPaper]) {
    const paper = index.papers.find((entry) => entry.paper_id === paperId)
    assert.equal(paper.relative_path, paperId)
    assert.equal(Object.values(paper.artifact_availability).some(Boolean), false)
  }
})

test("failed archive rebuild preserves byte-identical last-good outputs, blocks writes, and recovers only the exact tuple", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())
  const inspected = await inspectNote(fixture.origin)
  assertPublicExchange(inspected, fixture)
  const beforeData = await readTree(join(fixture.repoRoot, "local_library_data"))
  const beforeOutput = await readTree(join(fixture.repoRoot, "local_library_output"))

  const failed = await postJson(fixture.origin, "/api/v1/archive/candidates", archiveRequest({
    paperId: FIXTURE_IDS.recoveryPaper,
    openAlexId: FIXTURE_IDS.recoveryOpenAlex,
  }), { action: "archive-candidate" })
  assertPublicExchange(failed, fixture)
  assert.equal(failed.response.status, 201)
  assert.deepEqual(failed.body, {
    status: "created",
    paper_id: FIXTURE_IDS.recoveryPaper,
    folder_name: FIXTURE_IDS.recoveryPaper,
    rebuild_status: "failed",
    index_state: "last_good",
    recovery_required: true,
  })
  assert.deepEqual(await readTree(join(fixture.repoRoot, "local_library_data")), beforeData)
  assert.deepEqual(await readTree(join(fixture.repoRoot, "local_library_output")), beforeOutput)
  assert.ok((await stat(join(fixture.sourceRoot, FIXTURE_IDS.recoveryPaper, "metadata.yaml"))).isFile())

  const blockedImport = await postJson(fixture.origin, "/api/v1/notes/import", {
    inspection_id: inspected.body.inspection_id,
    requested_file_name: inspected.body.suggested_file_name,
    conflict_policy: "version",
  })
  assertPublicExchange(blockedImport, fixture)
  assert.equal(blockedImport.response.status, 503)
  assert.equal(blockedImport.body.error.code, "RECOVERY_REQUIRED")
  const blockedArchive = await postJson(fixture.origin, "/api/v1/archive/candidates", archiveRequest({
    paperId: "Fixture26-Blocked",
    openAlexId: "W9000000006",
  }), { action: "archive-candidate" })
  assertPublicExchange(blockedArchive, fixture)
  assert.equal(blockedArchive.response.status, 503)
  assert.equal(blockedArchive.body.error.code, "RECOVERY_REQUIRED")

  const wrong = await postJson(fixture.origin, "/api/v1/archive/rebuild", recoveryRequest({
    paperId: FIXTURE_IDS.recoveryPaper,
    openAlexId: "W9000000099",
  }), { action: "rebuild-library" })
  assertPublicExchange(wrong, fixture)
  assert.equal(wrong.response.status, 409)
  assert.equal(wrong.body.error.code, "ARCHIVE_CONFLICT")

  const recovered = await postJson(fixture.origin, "/api/v1/archive/rebuild", recoveryRequest(), {
    action: "rebuild-library",
  })
  assertPublicExchange(recovered, fixture)
  assert.equal(recovered.response.status, 200)
  assert.equal(recovered.body.status, "recovered")
  const index = await (await fetch(`${fixture.origin}/local_library_data/paper-index.json`)).json()
  assert.equal(index.papers.some((paper) => paper.paper_id === FIXTURE_IDS.recoveryPaper), true)
  const capabilities = await (await fetch(`${fixture.origin}/api/v1/capabilities`)).json()
  assert.equal(capabilities.recovery.required, false)
  assert.equal(capabilities.note_import, true)
})

test("tampered recovery package is refused and leaves recovery active", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())
  const failed = await postJson(fixture.origin, "/api/v1/archive/candidates", archiveRequest({
    paperId: FIXTURE_IDS.recoveryPaper,
    openAlexId: FIXTURE_IDS.recoveryOpenAlex,
  }), { action: "archive-candidate" })
  assertPublicExchange(failed, fixture)
  assert.equal(failed.body.recovery_required, true)
  const metadataPath = join(fixture.sourceRoot, FIXTURE_IDS.recoveryPaper, "metadata.yaml")
  const handle = await open(metadataPath, "a")
  try { await handle.write("\n# changed after failure\n") } finally { await handle.close() }

  const refused = await postJson(fixture.origin, "/api/v1/archive/rebuild", recoveryRequest(), {
    action: "rebuild-library",
  })
  assertPublicExchange(refused, fixture)
  assert.equal(refused.response.status, 409)
  assert.equal(refused.body.error.code, "ARCHIVE_CONFLICT")
  const capabilities = await (await fetch(`${fixture.origin}/api/v1/capabilities`)).json()
  assert.equal(capabilities.recovery.required, true)
  assert.equal(capabilities.recovery.paper_id, FIXTURE_IDS.recoveryPaper)
})

test("static serving is an exact read-only allowlist and public responses do not expose fixture paths", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())
  for (const route of [
    "/local_library_output/desktop/library.html",
    "/local_library_output/desktop/discovery.html",
    "/local_library_output/desktop/state-transfer.html",
    "/local_library_output/desktop/assets/styles.css",
    "/local_library_data/paper-index.json",
    "/prototype/desktop/index.html",
    "/prototype/desktop/directions.html",
    "/prototype/desktop/p02.html",
    "/prototype/desktop/agent-tasks.html",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${fixture.origin}${route}`, { method })
      assert.equal(response.status, 200, `${method} ${route}`)
      assertNoPrivatePath(await response.text(), fixture)
      for (const value of response.headers.values()) assertNoPrivatePath(value, fixture)
    }
  }
  for (const route of [
    "/local_library_config/library.local.json",
    "/exporter/config/institutions/nuist.json",
    "/local_library_data/paper-library-audit.json",
    "/prototype/desktop/library.template.html",
    "/prototype/desktop/discovery.template.html",
    "/prototype/desktop/discovery.mjs",
    "/local_library_output/desktop/../library.local.json",
    "/local_library_output/desktop/%2e%2e/library.local.json",
    "/local_library_output/desktop/missing.html",
  ]) {
    const response = await fetch(`${fixture.origin}${route}`)
    assert.equal(response.status, 404, route)
    assertNoPrivatePath(await response.text(), fixture)
    for (const value of response.headers.values()) assertNoPrivatePath(value, fixture)
  }
  const malformed = await fetch(`${fixture.origin}/api/v1/notes/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: fixture.origin },
    body: "{",
  })
  assert.equal(malformed.status, 400)
  assertNoPrivatePath(await malformed.text(), fixture)
})
