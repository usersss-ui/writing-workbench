import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPrivateLibraryRequestHandler } from "./local-server.mjs"
import { createWriteCoordinator } from "./write-coordinator.mjs"
import { isWorkbenchStateKey } from "./workbench-state.mjs"
import { isWorkbenchStateKey as isBrowserWorkbenchStateKey } from "../../prototype/desktop/workbench-storage.mjs"

const WORKSPACE_KEY = "research-console.paper-library.v1"

async function fixture(t, { coordinator = createWriteCoordinator(), configDirectory = true } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "workbench-state-"))
  if (configDirectory) await mkdir(join(repoRoot, "local_library_config"))
  let origin
  const server = createServer(createPrivateLibraryRequestHandler({ repoRoot, getOrigin: () => origin, coordinator }))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(repoRoot, { recursive: true, force: true }) })
  const stateDirectory = join(repoRoot, "local_library_config", "workbench-state")
  const get = () => fetch(`${origin}/api/v1/workbench-state`)
  const post = (body, headers = {}) => fetch(`${origin}/api/v1/workbench-state`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body),
  })
  return { repoRoot, stateDirectory, get, post }
}

test("server and browser agree on which keys are stored on disk", () => {
  const samples = [
    ["research-console.direction-snapshot.v1", true],
    ["research-console.paper-library.v1", true],
    ["research-console.paper-user-tags.v1", true],
    ["research-console.discovery-candidates.v1", true],
    ["research-console.discovery-workspace.v1", true],
    ["research-console.agent-task-input.v1", true],
    ["research-console.agent-task-input.v1.current", true],
    ["research-console.agent-task-input.v1.snapshot.INPUT-P02-20261022T010203004Z-ABCDEFGHJKLMNPQR", true],
    ["research-console.agent-task-input.v1.pending.INPUT-P02-20261022T010203004Z-ABCDEFGHJKLMNPQR", true],
    ["research-console.p02-workflow.v1", false],
    ["research-console.agent-task-input.v1.snapshot.../../escape", false],
    ["research-console.agent-task-input.v1.snapshot.lowercase", false],
    ["research-console.paper-library.v2", false],
    ["", false],
    [null, false],
  ]
  for (const [key, expected] of samples) {
    assert.equal(isWorkbenchStateKey(key), expected, String(key))
    assert.equal(isBrowserWorkbenchStateKey(key), expected, String(key))
  }
})

test("an empty state directory loads as no entries", async (t) => {
  const f = await fixture(t)
  const response = await f.get()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), { version: 1, entries: {} })
})

test("saved values survive reloads, advance revisions and are private files", async (t) => {
  const f = await fixture(t)
  const first = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "{\"version\":1}" })
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { key: WORKSPACE_KEY, revision: 1, value: "{\"version\":1}" })
  const second = await f.post({ key: WORKSPACE_KEY, expectedRevision: 1, value: "{\"version\":2}" })
  assert.deepEqual(await second.json(), { key: WORKSPACE_KEY, revision: 2, value: "{\"version\":2}" })

  assert.deepEqual(await f.get().then((response) => response.json()), {
    version: 1,
    entries: { [WORKSPACE_KEY]: { revision: 2, value: "{\"version\":2}" } },
  })
  const file = join(f.stateDirectory, `${WORKSPACE_KEY}.json`)
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, key: WORKSPACE_KEY, revision: 2, value: "{\"version\":2}" })
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(f.stateDirectory)).mode & 0o777, 0o700)
})

test("removing a value keeps a tombstone so revisions never go backwards", async (t) => {
  const f = await fixture(t)
  await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "saved" })
  const removed = await f.post({ key: WORKSPACE_KEY, expectedRevision: 1, value: null })
  assert.deepEqual(await removed.json(), { key: WORKSPACE_KEY, revision: 2, value: null })
  const stale = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "older tab" })
  assert.equal(stale.status, 409)
})

test("a stale revision is rejected and the newer value is kept", async (t) => {
  const f = await fixture(t)
  await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "first tab" })
  const stale = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "second tab" })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, "WORKBENCH_STATE_CONFLICT")
  assert.deepEqual((await f.get().then((response) => response.json())).entries[WORKSPACE_KEY], { revision: 1, value: "first tab" })
})

test("concurrent writes to one key are serialized and exactly one wins each revision", async (t) => {
  const f = await fixture(t)
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: `tab ${index}` })))
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409, 409, 409, 409, 409])
  assert.equal((await f.get().then((response) => response.json())).entries[WORKSPACE_KEY].revision, 1)
})

test("library writes in progress do not block saving research state", async (t) => {
  const coordinator = createWriteCoordinator()
  let release
  const busy = coordinator.run(() => new Promise((resolve) => { release = resolve }))
  t.after(async () => { release(); await busy })
  const f = await fixture(t, { coordinator })
  const response = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "while rebuilding" })
  assert.equal(response.status, 200)
})

test("invalid requests are rejected without writing", async (t) => {
  const f = await fixture(t)
  for (const body of [
    { key: "research-console.p02-workflow.v1", expectedRevision: 0, value: "draft" },
    { key: "../escape", expectedRevision: 0, value: "x" },
    { key: WORKSPACE_KEY, expectedRevision: -1, value: "x" },
    { key: WORKSPACE_KEY, expectedRevision: 0, value: 42 },
    { key: WORKSPACE_KEY, expectedRevision: 0, value: "nul\u0000" },
    { key: WORKSPACE_KEY, expectedRevision: 0 },
    { key: WORKSPACE_KEY, expectedRevision: 0, value: "x", extra: true },
  ]) {
    const response = await f.post(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal((await response.json()).error.code, "WORKBENCH_STATE_INVALID")
  }
  assert.deepEqual(await f.get().then((response) => response.json()), { version: 1, entries: {} })
})

test("cross-site and non-JSON writes are refused", async (t) => {
  const f = await fixture(t)
  const crossSite = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "x" }, { origin: "http://example.com" })
  assert.equal(crossSite.status, 403)
  const plain = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "x" }, { "content-type": "text/plain" })
  assert.equal(plain.status, 415)
})

test("a corrupt state file stops loading and is left untouched", async (t) => {
  const f = await fixture(t)
  await mkdir(f.stateDirectory)
  const file = join(f.stateDirectory, `${WORKSPACE_KEY}.json`)
  await writeFile(file, "{not json")
  const response = await f.get()
  assert.equal(response.status, 500)
  assert.equal((await response.json()).error.code, "WORKBENCH_STATE_CORRUPT")
  const save = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "x" })
  assert.equal(save.status, 500)
  assert.equal(await readFile(file, "utf8"), "{not json")
})

test("symlinked state files and directories are refused", async (t) => {
  const f = await fixture(t)
  const outside = join(f.repoRoot, "outside")
  await mkdir(outside)
  await symlink(outside, f.stateDirectory)
  assert.equal((await f.get()).status, 500)
  const save = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "x" })
  assert.equal(save.status, 500)
  assert.equal((await save.json()).error.code, "WORKBENCH_STATE_WRITE_FAILED")
})

test("a missing configuration directory fails the save instead of creating it", async (t) => {
  const f = await fixture(t, { configDirectory: false })
  const save = await f.post({ key: WORKSPACE_KEY, expectedRevision: 0, value: "x" })
  assert.equal(save.status, 500)
  assert.equal((await save.json()).error.code, "WORKBENCH_STATE_WRITE_FAILED")
})
