import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { createInterface } from "node:readline"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  FIXTURE_IDS,
  startIntegratedServerFixture,
} from "./integrated-server-fixture.mjs"

const workspaceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const launcherPath = fileURLToPath(new URL("./integrated-server-fixture.mjs", import.meta.url))
const forbiddenHomeMarker = ["", "Users", ""].join("/")

function withTimeout(promise, label, milliseconds = 10_000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function publicJson(origin, pathname) {
  const response = await fetch(`${origin}${pathname}`)
  assert.equal(response.status, 200)
  return { response, text: await response.text() }
}

test("imported fixture builds a complete deterministic library entirely below its owned temporary root", async (context) => {
  const fixture = await startIntegratedServerFixture({ busyDelayMs: 250 })
  context.after(() => fixture.close())

  assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/u)
  assert.equal([4176, 4177, 4178].includes(Number(new URL(fixture.origin).port)), false)
  const { response, text } = await publicJson(fixture.origin, "/local_library_data/paper-index.json")
  const index = JSON.parse(text)
  assert.deepEqual(index.papers.map((paper) => paper.paper_id).sort(), [
    FIXTURE_IDS.metadataOnlyPaper,
    FIXTURE_IDS.richPaper,
    'Fixture24-Note',
  ].sort())
  const rich = index.papers.find((paper) => paper.paper_id === FIXTURE_IDS.richPaper)
  const metadataOnly = index.papers.find((paper) => paper.paper_id === FIXTURE_IDS.metadataOnlyPaper)
  assert.equal(rich.source_documents.pdf.length, 1)
  assert.equal(rich.source_documents.ocr.length, 1)
  for (const category of ["note", "derivation", "simulation", "code_compare", "reproduction_report"]) {
    assert.ok(rich.controlled_preview_documents[category].length > 0, category)
  }
  assert.equal(metadataOnly.relative_path, FIXTURE_IDS.metadataOnlyPaper)
  assert.equal(metadataOnly.source_documents.pdf.length, 0)
  assert.equal(Object.values(metadataOnly.artifact_availability).some(Boolean), false)
  assert.equal(text.includes(fixture.repoRoot), false)
  assert.equal(text.includes(fixture.sourceRoot), false)
  for (const value of response.headers.values()) {
    assert.equal(value.includes(fixture.repoRoot), false)
    assert.equal(value.includes(fixture.sourceRoot), false)
  }

  for (const route of [
    "/local_library_output/desktop/library.html",
    "/local_library_output/desktop/discovery.html",
    "/local_library_output/desktop/state-transfer.html",
    "/prototype/desktop/index.html",
    "/prototype/desktop/directions.html",
    "/prototype/desktop/p02.html",
    "/prototype/desktop/agent-tasks.html",
  ]) {
    const page = await fetch(`${fixture.origin}${route}`)
    assert.equal(page.status, 200, route)
  }
})

async function exerciseExecutableShutdown(mode) {
  const ownedParent = await mkdtemp(join(tmpdir(), `integrated-launcher-${mode}-`))
  const stdoutLines = []
  let stderr = ""
  const child = spawn(process.execPath, [launcherPath], {
    cwd: workspaceRoot,
    env: { ...process.env, WORKBENCH_FIXTURE_TEMP_PARENT: ownedParent },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => stdoutLines.push(line))
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })

  try {
    const [readinessLine] = await withTimeout(once(lines, "line"), `${mode} readiness`)
    const readiness = JSON.parse(readinessLine)
    assert.deepEqual(Object.keys(readiness), ["origin"])
    assert.match(readiness.origin, /^http:\/\/127\.0\.0\.1:\d+$/u)
    assert.equal([4176, 4177, 4178].includes(Number(new URL(readiness.origin).port)), false)
    assert.equal(readinessLine.includes(ownedParent), false)
    assert.equal(readinessLine.includes(forbiddenHomeMarker), false)
    assert.equal((await readdir(ownedParent)).length, 1)

    const capabilities = await publicJson(readiness.origin, "/api/v1/capabilities")
    const index = await publicJson(readiness.origin, "/local_library_data/paper-index.json")
    assert.equal(JSON.parse(capabilities.text).api_version, 1)
    const fixturePapers = JSON.parse(index.text).papers
    assert.equal(fixturePapers.length, 3)
    const noteOnly = fixturePapers.find(paper => paper.paper_id === 'Fixture24-Note')
    assert.equal(noteOnly.title_original, 'Note-Only Controlled Search Fixture')
    assert.deepEqual(noteOnly.source_documents.pdf, [])
    assert.equal(noteOnly.controlled_preview_documents.note.length, 1)
    for (const publicText of [capabilities.text, index.text, ...capabilities.response.headers.values(), ...index.response.headers.values()]) {
      assert.equal(publicText.includes(ownedParent), false)
      assert.equal(publicText.includes(forbiddenHomeMarker), false)
    }

    if (mode === "signal") child.kill("SIGTERM")
    else child.stdin.end()
    const [code, signal] = await withTimeout(once(child, "exit"), `${mode} exit`)
    assert.equal(code, 0)
    assert.equal(signal, null)
    assert.deepEqual(stdoutLines, [readinessLine])
    assert.equal(stderr.includes(ownedParent), false)
    assert.equal(stderr.includes(forbiddenHomeMarker), false)
    assert.deepEqual(await readdir(ownedParent), [])
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    lines.close()
    await rm(ownedParent, { recursive: true, force: true })
  }
}

test("executable fixture emits one origin-only readiness line and cleans up on SIGTERM", async () => {
  await exerciseExecutableShutdown("signal")
})

test("executable fixture emits one origin-only readiness line and cleans up on stdin EOF", async () => {
  await exerciseExecutableShutdown("eof")
})
