import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { Agent as HttpAgent, createServer as createHttpServer, request as httpRequest } from "node:http"
import {
  cp,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  APPROVED_PROTOTYPE_FILES,
  ARCHIVE_REBUILD_REQUEST_MAX_BYTES,
  ARCHIVE_REQUEST_MAX_BYTES,
  SOURCE_PATH_REQUEST_MAX_BYTES,
  createPrivateLibraryRequestHandler,
  startPrivateLibraryServer,
} from "./local-server.mjs"
import { CandidateArchiveActionError } from "./candidate-archive-action.mjs"
import { createInspectionStore } from "./note-import.mjs"
import { scanPaperSources } from "./scanner.mjs"
import { rebuildConfiguredLibrary } from "./runtime.mjs"
import { createWriteCoordinator } from "./write-coordinator.mjs"
import { main, parseServeArguments } from "../scripts/serve-private-library.mjs"

const NOTE_CATEGORIES = [
  { value: "note", label: "论文精读", target_tab: "note" },
  { value: "derivation", label: "推导过程", target_tab: "derivation" },
  { value: "source_map", label: "来源映射", target_tab: "derivation" },
  { value: "modeling", label: "建模复盘", target_tab: "simulation" },
  { value: "simulation", label: "仿真描述", target_tab: "simulation" },
  { value: "code_compare", label: "代码对照", target_tab: "code_compare" },
  { value: "reproduction_report", label: "复现报告", target_tab: "simulation" },
]
const workspaceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))

const EXPECTED_KATEX_FONTS = [
  "KaTeX_AMS-Regular.woff2",
  "KaTeX_Caligraphic-Bold.woff2",
  "KaTeX_Caligraphic-Regular.woff2",
  "KaTeX_Fraktur-Bold.woff2",
  "KaTeX_Fraktur-Regular.woff2",
  "KaTeX_Main-Bold.woff2",
  "KaTeX_Main-BoldItalic.woff2",
  "KaTeX_Main-Italic.woff2",
  "KaTeX_Main-Regular.woff2",
  "KaTeX_Math-BoldItalic.woff2",
  "KaTeX_Math-Italic.woff2",
  "KaTeX_SansSerif-Bold.woff2",
  "KaTeX_SansSerif-Italic.woff2",
  "KaTeX_SansSerif-Regular.woff2",
  "KaTeX_Script-Regular.woff2",
  "KaTeX_Size1-Regular.woff2",
  "KaTeX_Size2-Regular.woff2",
  "KaTeX_Size3-Regular.woff2",
  "KaTeX_Size4-Regular.woff2",
  "KaTeX_Typewriter-Regular.woff2",
]
const EXPECTED_KATEX_FILES = [
  "vendor/katex/katex.mjs",
  "vendor/katex/katex.min.css",
  ...EXPECTED_KATEX_FONTS.map((fileName) => `vendor/katex/fonts/${fileName}`),
]
const EXPECTED_PROTOTYPE_FILES = [
  "index.html",
  "directions.html",
  "p02.html",
  "p02-writing.html",
  "p02-writing-data.mjs",
  "p02-writing.mjs",
  "submission-project.html",
  "submission-project.css",
  "submission-project.mjs",
  "submission-project-model.mjs",
  "submission-project-ui.mjs",
  "p02-workflow.mjs",
  "p02-workflow-ui.mjs",
  "agent-tasks.html",
  "app.mjs",
  "research-home.mjs",
  "directions.mjs",
  "bibliography-normalization.mjs",
  "discovery-record.mjs",
  "discovery-query-plan.mjs",
  "direction-snapshot.mjs",
  "papers-data.mjs",
  "paper-filter.mjs",
  "agent-tasks.mjs",
  "agent-task-input.mjs",
  "agent-tasks.css",
  "styles.css",
  "library.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-user-tags.mjs",
  "workbench-storage.mjs",
  ...EXPECTED_KATEX_FILES,
]
const EXPECTED_GENERATED_ASSETS = [
  "bibliography-import.mjs",
  "discovery-candidate-bridge.mjs",
  "discovery-recommendation.mjs",
  "discovery-results-ui.mjs",
  "discovery-review-ui.mjs",
  "discovery-session-ui.mjs",
  "local-discovery.mjs",
  "discovery-workspace.mjs",
  "discovery-batch.mjs",
  "discovery-identity.mjs",
  "journal-review.mjs",
  "styles.css",
  "state-transfer.mjs",
  "p02-workflow.mjs",
  "library.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
  "candidate-storage.mjs",
  "discovery.mjs",
  "discovery-query-plan.mjs",
  "institution-access.mjs",
  "openalex-search.mjs",
  "bibliography-normalization.mjs",
  "discovery-record.mjs",
  "local-paper-match.mjs",
  "nuist.institution.json",
  "workbench-storage.mjs",
  ...EXPECTED_KATEX_FILES,
]

const CANDIDATE = {
  paperId: "W4387886124",
  doi: "10.1109/access.2023.3327199",
  title: "Distributed Interval Optimization Over Time-Varying Networks",
  authors: ["Yinghui Wang", "Jiuwei Wang"],
  year: 2023,
  source: "IEEE Access",
  citations: 12,
  isOpenAccess: true,
  openAccessUrl: "https://example.org/open-paper",
  landingPageUrl: "https://doi.org/10.1109/access.2023.3327199",
  topics: ["Distributed optimization"],
  abstract: "Discovery text",
  stage: "confirmed_for_archive",
}

function candidateRequest() {
  return {
    version: 1,
    confirmation: "create_metadata_only",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    candidate: structuredClone(CANDIDATE),
  }
}

function recoveryRequest() {
  return {
    confirmation: "retry_archive_rebuild",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  }
}

function context({ archiveSourceId = "main_papers" } = {}) {
  const paper = {
    paper_id: "Paper-01",
    source_id: "main_papers",
    relative_path: "Paper-01",
    title_original: "Paper One",
    authors: ["Researcher"],
    year: 2026,
  }
  return {
    config: {
      version: 1,
      archive_source_id: archiveSourceId,
      sources: [{ source_id: "main_papers", path: "/fixture/source", catalog_path: null }],
    },
    scanned: {
      papers: [paper],
      audit: {
        sources: [{ source_id: "main_papers", root_path: "/fixture/source", scanned_directories: 1 }],
        private_path_lookup: { "Paper-01": "/fixture/source/Paper-01" },
        archive_identity_lookup: {},
        blocking: { duplicate_archive_source_ids: [] },
      },
    },
    papersById: new Map([[paper.paper_id, paper]]),
    unitDirectoryByPaperId: new Map([[paper.paper_id, "/fixture/source/Paper-01"]]),
  }
}

async function scannedArchiveContext(sourceRoot) {
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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function listenHandler(t, dependencies = {}) {
  const { observeRequest, ...handlerDependencies } = dependencies
  let origin = null
  const handler = createPrivateLibraryRequestHandler({
    repoRoot: handlerDependencies.repoRoot ?? "/fixture/repo",
    getOrigin: () => origin,
    loadContext: async () => context(),
    rebuild: async () => ({ paperCount: 1 }),
    inspectionStore: createInspectionStore(),
    coordinator: createWriteCoordinator(),
    inspect: async () => ({
      publicResult: {
        suggested_file_name: "Paper-01_论文精读.md",
        target_tab: "note",
        checks: { items: [], blocking_codes: [], warning_codes: [], can_import: true },
      },
      snapshot: {
        bytes: Buffer.from("# Imported note"),
        sha256: "a".repeat(64),
        paper_id: "Paper-01",
        source_id: "main_papers",
        relative_path: "Paper-01",
        category: "note",
        suggested_file_name: "Paper-01_论文精读.md",
        target_tab: "note",
        checks: { items: [], blocking_codes: [], warning_codes: [], can_import: true },
      },
    }),
    importNote: async ({ snapshot }) => ({
      paper_id: snapshot.paper_id,
      actual_file_name: "Paper-01_论文精读.md",
      target_tab: "note",
      new_preview_url: `../../local_library_data/notes/paper-01/note/${"b".repeat(64)}.html`,
      index_version: "c".repeat(64),
    }),
    archiveAction: async () => ({
      status: "created",
      paper_id: "Wang23-DIO",
      folder_name: "Wang23-DIO",
      rebuild_status: "complete",
      paper_count: 2,
    }),
    recoveryAction: async () => ({
      status: "recovered",
      paper_id: "Wang23-DIO",
      rebuild_status: "complete",
      paper_count: 2,
    }),
    ...handlerDependencies,
  })
  const server = createHttpServer((request, response) => {
    if (typeof observeRequest === "function") observeRequest(request)
    handler(request, response)
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  origin = `http://127.0.0.1:${address.port}`
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { origin, server }
}

async function post(origin, pathname, body, { headers = {}, rawBody = null } = {}) {
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: rawBody ?? JSON.stringify(body),
  })
}

async function rawRequest(origin, path, { method = "GET", headers = {}, body = "", chunks = null, setHost = true } = {}) {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: Number(url.port),
      method,
      path,
      headers,
      setHost,
    }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    request.once("error", reject)
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) request.write(chunk)
      request.end()
    } else request.end(body)
  })
}

async function slowOversizedRequest(origin, path, { limit, tailBytes, onResponseHeaders }) {
  const url = new URL(origin)
  const agent = new HttpAgent({ keepAlive: true })
  let socket = null
  let socketClosed = false
  let responseSeen = false
  let resolveHeaders
  let rejectHeaders
  const headersReady = new Promise((resolve, reject) => {
    resolveHeaders = resolve
    rejectHeaders = reject
  })
  let resolveResponse
  let rejectResponse
  const responseDone = new Promise((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const request = httpRequest({
    hostname: "127.0.0.1",
    port: Number(url.port),
    method: "POST",
    path,
    agent,
    headers: {
      connection: "keep-alive",
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
    },
  }, (response) => {
    responseSeen = true
    const chunks = []
    resolveHeaders()
    response.on("data", (chunk) => chunks.push(chunk))
    response.once("end", () => resolveResponse({
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks),
    }))
    response.once("error", rejectResponse)
  })
  request.once("socket", (value) => {
    socket = value
    socket.once("close", () => { socketClosed = true })
  })
  request.on("error", (error) => {
    if (!responseSeen) rejectHeaders(error)
  })
  request.flushHeaders()
  request.write(Buffer.alloc(limit + 1, 0x61))
  await headersReady
  if (typeof onResponseHeaders === "function") onResponseHeaders()
  try { request.write(Buffer.alloc(tailBytes, 0x62)) } catch { /* closed as required */ }
  try { request.end() } catch { /* closed as required */ }
  const response = await responseDone
  if (response.headers.connection === "close" && socket && !socketClosed) {
    await new Promise((resolveClose) => socket.once("close", resolveClose))
  }
  agent.destroy()
  return { ...response, socketClosed }
}

function runNodeImport(moduleUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }))
  })
}

function jsonBodyAtBytes(bytes) {
  const prefix = '{"padding":"'
  const suffix = '"}'
  return `${prefix}${"a".repeat(bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`
}

async function json(response) {
  return JSON.parse(await response.text())
}

test("exports fixed request limits, an explicit prototype allowlist, and a production CLI with no arguments", async () => {
  assert.equal(SOURCE_PATH_REQUEST_MAX_BYTES, 16 * 1024)
  assert.equal(ARCHIVE_REQUEST_MAX_BYTES, 65_536)
  assert.equal(ARCHIVE_REBUILD_REQUEST_MAX_BYTES, 8_192)
  assert.deepEqual(parseServeArguments([]), { port: 4176 })
  for (const argv of [["--host", "0.0.0.0"], ["--port", "4180"], ["--port", "0"], ["--port"], ["extra"]]) {
    assert.throws(() => parseServeArguments(argv), /参数无效/u)
  }
  for (const required of [
    "index.html", "directions.html", "p02.html", "p02-writing.html", "p02-writing-data.mjs",
    "p02-writing.mjs", "p02-workflow.mjs", "p02-workflow-ui.mjs",
    "agent-tasks.html", "app.mjs", "directions.mjs",
    "direction-snapshot.mjs", "papers-data.mjs", "paper-filter.mjs", "agent-tasks.mjs",
    "agent-task-input.mjs", "agent-tasks.css", "styles.css", "library.mjs",
    "paper-library-model.mjs", "paper-library-storage.mjs", "paper-inspector.mjs",
    "paper-math-renderer.mjs", "paper-user-tags.mjs", "vendor/katex/katex.mjs",
    "vendor/katex/katex.min.css", "vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  ]) assert.equal(APPROVED_PROTOTYPE_FILES.includes(required), true, required)
  for (const denied of ["README.md", "library.template.html", "discovery.template.html", "state-transfer.html", "paper-library-dom.test.mjs"] ) {
    assert.equal(APPROVED_PROTOTYPE_FILES.includes(denied), false, denied)
  }

  let started = null
  const stdout = { writes: [], write(value) { this.writes.push(value) } }
  const stderr = { writes: [], write(value) { this.writes.push(value) } }
  const exitCode = await main({
    argv: [],
    repoRoot: "/fixture/repo",
    start: async (options) => {
      started = options
      return { origin: "http://127.0.0.1:4176", close: async () => {} }
    },
    stdout,
    stderr,
  })
  assert.equal(exitCode, 0)
  assert.deepEqual(started, { repoRoot: "/fixture/repo", port: 4176 })
  assert.deepEqual(stdout.writes, ["本地论文库服务：http://127.0.0.1:4176/local_library_output/desktop/library.html\n"])
  assert.deepEqual(stderr.writes, [])

  const failedStdout = { writes: [], write(value) { this.writes.push(value) } }
  const failedStderr = { writes: [], write(value) { this.writes.push(value) } }
  assert.equal(await main({
    argv: [],
    repoRoot: "/fixture/repo",
    start: async () => { throw new Error(["/", "Users", "private", "config.json"].join("/")) },
    stdout: failedStdout,
    stderr: failedStderr,
  }), 1)
  assert.deepEqual(failedStdout.writes, [])
  assert.deepEqual(failedStderr.writes, ["本地论文库服务启动失败。请检查本机配置和构建边界。\n"])

  const imported = await runNodeImport(new URL("../scripts/serve-private-library.mjs", import.meta.url).href)
  assert.deepEqual(imported, { code: 0, signal: null, stdout: "", stderr: "" })
})

test("capabilities expose exact normal, candidate-recovery, both manual-recovery, and no-archive states", async (t) => {
  const coordinator = createWriteCoordinator()
  const fixture = await listenHandler(t, { coordinator })
  const normal = await fetch(`${fixture.origin}/api/v1/capabilities`)
  assert.equal(normal.status, 200)
  assert.deepEqual(await json(normal), {
    api_version: 1,
    note_import: true,
    source_path: true,
    candidate_archive: true,
    archive_rebuild: true,
    discovery: true,
    agent_task_center: true,
    archive_source_id: "main_papers",
    categories: NOTE_CATEGORIES,
    recovery: {
      required: false,
      kind: null,
      reason_code: null,
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
  })

  await coordinator.markRecovery({
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  })
  const candidateRecovery = await json(await fetch(`${fixture.origin}/api/v1/capabilities`))
  assert.deepEqual(candidateRecovery, {
    ...candidateRecovery,
    note_import: false,
    source_path: true,
    candidate_archive: false,
    archive_rebuild: true,
    archive_source_id: "main_papers",
    recovery: {
      required: true,
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
  })

  const manualCoordinator = createWriteCoordinator()
  await manualCoordinator.markRecovery({ kind: "manual_note", reason_code: "ROLLBACK_FAILED" })
  const manualFixture = await listenHandler(t, { coordinator: manualCoordinator })
  const manual = await json(await fetch(`${manualFixture.origin}/api/v1/capabilities`))
  assert.equal(manual.note_import, false)
  assert.equal(manual.source_path, true)
  assert.equal(manual.candidate_archive, false)
  assert.equal(manual.archive_rebuild, false)
  assert.deepEqual(manual.recovery, {
    required: true,
    kind: "manual_note",
    reason_code: "ROLLBACK_FAILED",
    archive_source_id: null,
    paper_id: null,
    openalex_id: null,
  })

  const manualArchiveCoordinator = createWriteCoordinator()
  await manualArchiveCoordinator.markRecovery({
    kind: "manual_archive",
    reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
  })
  const manualArchiveFixture = await listenHandler(t, { coordinator: manualArchiveCoordinator })
  const manualArchive = await json(await fetch(`${manualArchiveFixture.origin}/api/v1/capabilities`))
  assert.equal(manualArchive.note_import, false)
  assert.equal(manualArchive.candidate_archive, false)
  assert.equal(manualArchive.archive_rebuild, false)
  assert.deepEqual(manualArchive.recovery, {
    required: true,
    kind: "manual_archive",
    reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
    archive_source_id: null,
    paper_id: null,
    openalex_id: null,
  })

  const noArchive = await listenHandler(t, { loadContext: async () => context({ archiveSourceId: null }) })
  const absent = await json(await fetch(`${noArchive.origin}/api/v1/capabilities`))
  assert.equal(absent.archive_source_id, null)
  assert.equal(absent.candidate_archive, false)
  assert.equal(absent.archive_rebuild, false)
  assert.equal(absent.note_import, true)
})

test("recovery capabilities come from coordinator state even when a blocking scan would throw", async (t) => {
  const candidateCoordinator = createWriteCoordinator()
  await candidateCoordinator.markRecovery({
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  })
  let candidateLoads = 0
  const candidateFixture = await listenHandler(t, {
    coordinator: candidateCoordinator,
    loadContext: async () => {
      candidateLoads += 1
      throw Object.assign(new Error("private scan blocked"), { code: "ARCHIVE_SCAN_INCOMPLETE" })
    },
  })
  const candidateResponse = await fetch(`${candidateFixture.origin}/api/v1/capabilities`)
  assert.equal(candidateResponse.status, 200)
  assert.equal(candidateLoads, 0)
  assert.deepEqual(await json(candidateResponse), {
    api_version: 1,
    note_import: false,
    source_path: true,
    candidate_archive: false,
    archive_rebuild: true,
    discovery: true,
    agent_task_center: true,
    archive_source_id: "main_papers",
    categories: NOTE_CATEGORIES,
    recovery: {
      required: true,
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
  })

  const manualCoordinator = createWriteCoordinator()
  await manualCoordinator.markRecovery({ kind: "manual_archive", reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS" })
  let manualLoads = 0
  const manualFixture = await listenHandler(t, {
    coordinator: manualCoordinator,
    loadContext: async () => {
      manualLoads += 1
      throw Object.assign(new Error("private scan blocked"), { code: "ARCHIVE_SCAN_INCOMPLETE" })
    },
  })
  const manualResponse = await fetch(`${manualFixture.origin}/api/v1/capabilities`)
  assert.equal(manualResponse.status, 200)
  assert.equal(manualLoads, 0)
  assert.deepEqual((await json(manualResponse)).recovery, {
    required: true,
    kind: "manual_archive",
    reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
    archive_source_id: null,
    paper_id: null,
    openalex_id: null,
  })

  let normalLoads = 0
  const normalFixture = await listenHandler(t, {
    loadContext: async () => {
      normalLoads += 1
      throw Object.assign(new Error("private scan blocked"), { code: "ARCHIVE_SCAN_INCOMPLETE" })
    },
  })
  const normalResponse = await fetch(`${normalFixture.origin}/api/v1/capabilities`)
  assert.equal(normalResponse.status, 409)
  assert.equal((await json(normalResponse)).error.code, "ARCHIVE_SCAN_INCOMPLETE")
  assert.equal(normalLoads, 1)
})

test("POST guards enforce Host, Origin, fetch-site, JSON, endpoint limits, action headers, and no CORS", async (t) => {
  let inspectCalls = 0
  let importCalls = 0
  let archiveCalls = 0
  let recoveryCalls = 0
  const fixture = await listenHandler(t, {
    inspect: async () => { inspectCalls += 1; throw new Error("should not run") },
    importNote: async () => { importCalls += 1; throw new Error("should not run") },
    archiveAction: async () => { archiveCalls += 1; throw new Error("should not run") },
    recoveryAction: async () => { recoveryCalls += 1; throw new Error("should not run") },
  })
  const validInspect = { paper_id: "Paper-01", category: "note", original_file_name: "note.md", markdown: "# Note" }
  const trustedHost = new URL(fixture.origin).host
  for (const host of ["", `localhost:${new URL(fixture.origin).port}`, `[::1]:${new URL(fixture.origin).port}`, "127.0.0.1:9", `${trustedHost},example.invalid`]) {
    const headers = {
      origin: fixture.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...(host ? { host } : {}),
    }
    const response = await rawRequest(fixture.origin, "/api/v1/notes/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify(validInspect),
      setHost: host !== "",
    })
    assert.equal(response.status, 400, host || "missing Host")
    if (host === "") {
      assert.equal(response.body.length, 0, "Node rejects HTTP/1.1 without Host before dispatch")
    } else {
      assert.equal(JSON.parse(response.body.toString("utf8")).error.code, "HOST_FORBIDDEN")
    }
  }
  const guardCases = [
    [await rawRequest(fixture.origin, "/api/v1/notes/inspect", {
      method: "POST",
      headers: { host: "example.invalid", origin: fixture.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify(validInspect),
    }), 400, "HOST_FORBIDDEN"],
    [await post(fixture.origin, "/api/v1/notes/inspect", validInspect, { headers: { origin: "http://127.0.0.1:9" } }), 403, "ORIGIN_FORBIDDEN"],
    [await post(fixture.origin, "/api/v1/notes/inspect", validInspect, { headers: { "sec-fetch-site": "cross-site" } }), 403, "CROSS_SITE_FORBIDDEN"],
    [await post(fixture.origin, "/api/v1/notes/inspect", validInspect, { headers: { "content-type": "text/plain" } }), 415, "JSON_REQUIRED"],
    [await post(fixture.origin, "/api/v1/notes/inspect", validInspect, { headers: { "content-type": "application/json; profile=test" } }), 415, "JSON_REQUIRED"],
    [await post(fixture.origin, "/api/v1/notes/inspect", validInspect, { headers: { "content-encoding": "gzip" } }), 415, "JSON_REQUIRED"],
    [await post(fixture.origin, "/api/v1/notes/inspect", null, { rawBody: "{" }), 400, "INVALID_JSON"],
    [await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest()), 400, "ACTION_CONFIRMATION_REQUIRED"],
    [await post(fixture.origin, "/api/v1/archive/rebuild", recoveryRequest()), 400, "ACTION_CONFIRMATION_REQUIRED"],
  ]
  for (const [response, status, code] of guardCases) {
    assert.equal(response.status ?? response.statusCode, status)
    const body = response instanceof Response ? await json(response) : JSON.parse(response.body.toString("utf8"))
    assert.deepEqual(Object.keys(body), ["error"])
    assert.equal(body.error.code, code)
    const headers = response instanceof Response ? response.headers : new Headers(response.headers)
    assert.equal(headers.get("access-control-allow-origin"), null)
  }

  const acceptedContentTypes = ["application/json", " APPLICATION/JSON ; CHARSET=UTF-8 "]
  for (const contentType of acceptedContentTypes) {
    const response = await post(fixture.origin, "/api/v1/papers/source-path", { paper_id: "Paper-01" }, {
      headers: { "content-type": contentType },
    })
    assert.equal(response.status, 200, contentType)
  }

  const oversized = [
    ["/api/v1/notes/inspect", 1_100_000],
    ["/api/v1/notes/import", 16 * 1024],
    ["/api/v1/papers/source-path", SOURCE_PATH_REQUEST_MAX_BYTES],
    ["/api/v1/archive/candidates", ARCHIVE_REQUEST_MAX_BYTES],
    ["/api/v1/archive/rebuild", ARCHIVE_REBUILD_REQUEST_MAX_BYTES],
  ]
  for (const [path, limit] of oversized) {
    const actionHeaders = path.endsWith("/candidates")
      ? { "x-research-console-action": "archive-candidate" }
      : path.endsWith("/rebuild")
        ? { "x-research-console-action": "rebuild-library" }
        : {}
    const exact = await post(fixture.origin, path, null, {
      headers: actionHeaders,
      rawBody: jsonBodyAtBytes(limit),
    })
    assert.equal(exact.status, 400, `${path} exact limit`)
    assert.equal((await json(exact)).error.code, "INVALID_REQUEST", `${path} exact limit`)
    const response = await post(fixture.origin, path, null, {
      headers: actionHeaders,
      rawBody: jsonBodyAtBytes(limit + 1),
    })
    assert.equal(response.status, 413, `${path} limit + 1`)
    assert.equal((await json(response)).error.code, "REQUEST_TOO_LARGE", `${path} limit + 1`)
  }

  const exactChunkedBody = jsonBodyAtBytes(1_100_000)
  const exactChunked = await rawRequest(fixture.origin, "/api/v1/notes/inspect", {
    method: "POST",
    headers: {
      host: trustedHost,
      origin: fixture.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    chunks: [exactChunkedBody.slice(0, 700_000), exactChunkedBody.slice(700_000)],
  })
  assert.equal(exactChunked.status, 400)
  assert.equal(JSON.parse(exactChunked.body.toString("utf8")).error.code, "INVALID_REQUEST")

  const chunkedBody = jsonBodyAtBytes(1_100_001)
  const chunked = await rawRequest(fixture.origin, "/api/v1/notes/inspect", {
    method: "POST",
    headers: {
      host: trustedHost,
      origin: fixture.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    chunks: [chunkedBody.slice(0, 700_000), chunkedBody.slice(700_000)],
  })
  assert.equal(chunked.status, 413)
  assert.equal(JSON.parse(chunked.body.toString("utf8")).error.code, "REQUEST_TOO_LARGE")
  assert.deepEqual({ inspectCalls, importCalls, archiveCalls, recoveryCalls }, {
    inspectCalls: 0,
    importCalls: 0,
    archiveCalls: 0,
    recoveryCalls: 0,
  })
})

test("an oversized slow request stops consuming tail bytes, removes body listeners, and closes only its connection", async (t) => {
  let serverRequest = null
  let emittedBodyBytes = 0
  let bytesAtResponse = null
  const fixture = await listenHandler(t, {
    observeRequest(request) {
      if (serverRequest !== null) return
      serverRequest = request
      const emit = request.emit
      request.emit = function instrumentedEmit(event, ...args) {
        if (event === "data" && Buffer.isBuffer(args[0])) emittedBodyBytes += args[0].length
        return Reflect.apply(emit, this, [event, ...args])
      }
    },
  })
  const response = await slowOversizedRequest(fixture.origin, "/api/v1/papers/source-path", {
    limit: SOURCE_PATH_REQUEST_MAX_BYTES,
    tailBytes: 2 * 1024 * 1024,
    onResponseHeaders: () => { bytesAtResponse = emittedBodyBytes },
  })
  assert.equal(response.status, 413)
  assert.equal(JSON.parse(response.body.toString("utf8")).error.code, "REQUEST_TOO_LARGE")
  assert.equal(response.headers.connection, "close")
  assert.equal(response.socketClosed, true)
  assert.equal(emittedBodyBytes, bytesAtResponse)
  for (const event of ["data", "end", "error"]) {
    assert.equal(
      serverRequest.listeners(event).some((listener) => ["onData", "onEnd", "onError"].includes(listener.name)),
      false,
      event,
    )
  }
  assert.equal(serverRequest.readableFlowing, false)

  const nextResponse = await post(fixture.origin, "/api/v1/papers/source-path", { paper_id: "Paper-01" })
  assert.equal(nextResponse.status, 200)
  assert.deepEqual(await json(nextResponse), {
    paper_id: "Paper-01",
    source_path: "/fixture/source/Paper-01",
  })
})

test("the route table is exactly six endpoints and old or unknown API paths are explicit 404", async (t) => {
  const fixture = await listenHandler(t)
  for (const path of [
    "/api/archive-candidate", "/api/tasks", "/api/health", "/api/v1/candidates/archive",
    "/api/v1/library/rebuild", "/api/v1/unknown", "/api/v1/capabilities/",
    "/api/v1/capabilities?version=1",
  ]) {
    const response = await fetch(`${fixture.origin}${path}`)
    assert.equal(response.status, 404, path)
    assert.equal(response.headers.get("access-control-allow-origin"), null)
  }
  const wrongMethod = await post(fixture.origin, "/api/v1/capabilities", {})
  assert.equal(wrongMethod.status, 404)
  assert.equal((await fetch(`${fixture.origin}/api/v1/notes/inspect`)).status, 404)
  assert.equal((await fetch(`${fixture.origin}/api/v1/capabilities`, { method: "OPTIONS" })).status, 404)
})

test("root redirect and static files use only the fixed generated/prototype/path-shape allowlists", async (t) => {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-")))
  t.after(() => rm(repoRoot, { recursive: true, force: true }))
  const hash = "a".repeat(64)
  assert.deepEqual(APPROVED_PROTOTYPE_FILES, EXPECTED_PROTOTYPE_FILES)
  const files = new Map([
    ["local_library_output/desktop/library.html", "<h1>Library</h1>"],
    ["local_library_output/desktop/discovery.html", "<h1>Discovery</h1>"],
    ["local_library_output/desktop/state-transfer.html", "<h1>State transfer</h1>"],
    ["local_library_data/paper-index.json", "{\"version\":4}"],
    [`local_library_data/notes/paper-01/note/${hash}.html`, "<h1>Note</h1>"],
    [`local_library_data/notes/paper-01/assets/${hash}.png`, "image"],
    [`local_library_data/sources/paper-01/pdf/${hash}.pdf`, "%PDF"],
    [`local_library_data/sources/paper-01/ocr/${hash}.html`, "<h1>OCR</h1>"],
  ])
  for (const resource of EXPECTED_GENERATED_ASSETS) {
    files.set(`local_library_output/desktop/assets/${resource}`, resource.endsWith(".json") ? "{}" : "fixture")
  }
  for (const resource of EXPECTED_PROTOTYPE_FILES) {
    files.set(`prototype/desktop/${resource}`, "fixture")
  }
  for (const [relative, contents] of files) {
    const target = join(repoRoot, relative)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, contents)
  }
  for (const [relative, contents] of [
    ["local_library_config/library.local.json", "PRIVATE"],
    ["local_library_data/paper-library-audit.json", "PRIVATE"],
    ["local_library_output/desktop/assets/unlisted.mjs", "PRIVATE"],
    ["local_library_output/desktop/assets/state-transfer.test.mjs", "PRIVATE"],
    ["prototype/desktop/README.md", "PRIVATE"],
    ["prototype/desktop/p02-writing.test.mjs", "PRIVATE"],
    ["prototype/desktop/p02-writing-view.test.mjs", "PRIVATE"],
    ["prototype/desktop/library.template.html", "PRIVATE"],
    ["prototype/desktop/state-transfer.html", "PRIVATE"],
    ["prototype/desktop/state-transfer.mjs", "PRIVATE"],
    ["prototype/desktop/vendor/katex/LICENSE", "PRIVATE"],
    ["local_library_output/desktop/assets/vendor/katex/LICENSE", "PRIVATE"],
    ["exporter/paper-library/local-server.test.mjs", "PRIVATE"],
    ["arbitrary.txt", "PRIVATE"],
  ]) {
    const target = join(repoRoot, relative)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, contents)
  }
  const fixture = await listenHandler(t, { repoRoot })
  const root = await fetch(`${fixture.origin}/`, { redirect: "manual" })
  assert.equal(root.status, 302)
  assert.equal(root.headers.get("location"), "/local_library_output/desktop/library.html")
  assert.equal(await root.text(), "")

  for (const path of [...files.keys()].map((relative) => `/${relative}`)) {
    const response = await fetch(`${fixture.origin}${path}`)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  }
  const head = await fetch(`${fixture.origin}/local_library_data/paper-index.json`, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  assert.equal((await fetch(`${fixture.origin}/prototype/desktop/index.html?v=1`)).status, 200)
  for (const fileName of [
    "state-transfer.mjs",
    "bibliography-import.mjs",
    "discovery-candidate-bridge.mjs",
    "discovery-recommendation.mjs",
    "discovery-results-ui.mjs",
    "discovery-review-ui.mjs",
    "discovery-session-ui.mjs",
    "local-discovery.mjs",
    "discovery-workspace.mjs",
    "discovery-batch.mjs",
    "discovery-identity.mjs",
    "discovery-record.mjs",
    "openalex-search.mjs",
    "bibliography-normalization.mjs",
    "journal-review.mjs",
    "p02-workflow.mjs",
    "direction-snapshot.mjs",
    "agent-task-input.mjs",
    "paper-library-storage.mjs",
    "paper-user-tags.mjs",
    "candidate-storage.mjs",
    "paper-library-model.mjs",
    "styles.css",
  ]) {
    const pathname = `/local_library_output/desktop/assets/${fileName}`
    const transferHead = await fetch(`${fixture.origin}${pathname}`, { method: "HEAD" })
    assert.equal(transferHead.status, 200, pathname)
    assert.equal(await transferHead.text(), "", pathname)
  }

  await unlink(join(repoRoot, "prototype/desktop/p02.html"))
  await symlink(join(repoRoot, "arbitrary.txt"), join(repoRoot, "prototype/desktop/p02.html"))

  for (const path of [
    "/local_library_config/library.local.json",
    "/local_library_data/paper-library-audit.json",
    "/local_library_output/desktop/assets/unlisted.mjs",
    "/local_library_output/desktop/assets/state-transfer.test.mjs",
    "/prototype/desktop/README.md",
    "/prototype/desktop/p02-writing.test.mjs",
    "/prototype/desktop/p02-writing-view.test.mjs",
    "/prototype/desktop/library.template.html",
    "/prototype/desktop/state-transfer.html",
    "/prototype/desktop/state-transfer.mjs",
    "/prototype/desktop/vendor/katex/LICENSE",
    "/local_library_output/desktop/assets/vendor/katex/LICENSE",
    "/prototype/desktop/p02.html",
    "/exporter/paper-library/local-server.test.mjs",
    "/arbitrary.txt",
    "/local_library_data/notes/paper-01/note/not-a-hash.html",
    "/local_library_data/sources/paper-01/pdf/a.pdf",
  ]) assert.equal((await fetch(`${fixture.origin}${path}`)).status, 404, path)

  for (const path of ["/%2e%2e/arbitrary.txt", "/prototype%2fdesktop/index.html", "/prototype/desktop//index.html", "/prototype/desktop/%2e/index.html", "/prototype\\desktop\\index.html"]) {
    const response = await rawRequest(fixture.origin, path, { headers: { host: new URL(fixture.origin).host } })
    assert.equal(response.status, 404, path)
  }
})

test("static serving rejects prototype, generated, data, and repository root aliases", async (t) => {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-roots-")))
  const outsideRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-outside-")))
  const canonicalRepo = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-canonical-")))
  const aliasParent = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-alias-parent-")))
  const repoAlias = join(aliasParent, "repo-alias")
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
    await rm(canonicalRepo, { recursive: true, force: true })
    await rm(aliasParent, { recursive: true, force: true })
  })

  await mkdir(join(outsideRoot, "prototype"), { recursive: true })
  await writeFile(join(outsideRoot, "prototype/index.html"), "outside prototype")
  await mkdir(join(repoRoot, "prototype"), { recursive: true })
  await symlink(join(outsideRoot, "prototype"), join(repoRoot, "prototype/desktop"))

  await mkdir(join(outsideRoot, "output/desktop/assets"), { recursive: true })
  await writeFile(join(outsideRoot, "output/desktop/assets/styles.css"), "outside generated")
  await symlink(join(outsideRoot, "output"), join(repoRoot, "local_library_output"))

  await mkdir(join(outsideRoot, "data"), { recursive: true })
  await writeFile(join(outsideRoot, "data/paper-index.json"), "{}")
  await symlink(join(outsideRoot, "data"), join(repoRoot, "local_library_data"))

  const aliasedRoots = await listenHandler(t, { repoRoot })
  for (const path of [
    "/prototype/desktop/index.html",
    "/local_library_output/desktop/assets/styles.css",
    "/local_library_data/paper-index.json",
  ]) assert.equal((await fetch(`${aliasedRoots.origin}${path}`)).status, 404, path)

  await mkdir(join(canonicalRepo, "prototype/desktop"), { recursive: true })
  await writeFile(join(canonicalRepo, "prototype/desktop/index.html"), "canonical")
  await symlink(canonicalRepo, repoAlias)
  const aliasedRepo = await listenHandler(t, { repoRoot: repoAlias })
  assert.equal((await fetch(`${aliasedRepo.origin}/prototype/desktop/index.html`)).status, 404)
})

test("static serving rejects a terminal file swapped after its no-follow open", async (t) => {
  const swapRepo = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-swap-")))
  t.after(() => rm(swapRepo, { recursive: true, force: true }))
  const target = join(swapRepo, "prototype/desktop/index.html")
  const displaced = join(swapRepo, "prototype/desktop/.displaced-index")
  await mkdir(join(target, ".."), { recursive: true })
  await writeFile(target, "owned bytes")
  let swapped = false
  const terminalSwap = await listenHandler(t, {
    repoRoot: swapRepo,
    staticFileSystem: {
      open: async (path, flags, mode) => {
        const handle = await openFile(path, flags, mode)
        if (!swapped && path === target) {
          swapped = true
          await rename(target, displaced)
          await writeFile(target, "replacement bytes")
        }
        return handle
      },
    },
  })
  const swappedResponse = await fetch(`${terminalSwap.origin}/prototype/desktop/index.html`)
  assert.equal(swappedResponse.status, 404)
  assert.equal(await swappedResponse.text(), "")
  assert.equal(swapped, true)
})

test("static serving opens an approved terminal file with O_NOFOLLOW", async (t) => {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-static-nofollow-")))
  t.after(() => rm(repoRoot, { recursive: true, force: true }))
  const target = join(repoRoot, "prototype/desktop/index.html")
  await mkdir(join(target, ".."), { recursive: true })
  await writeFile(target, "owned bytes")
  let observedFlags = null
  const fixture = await listenHandler(t, {
    repoRoot,
    staticFileSystem: {
      open: async (path, flags, mode) => {
        if (path === target) observedFlags = flags
        return openFile(path, flags, mode)
      },
    },
  })

  const response = await fetch(`${fixture.origin}/prototype/desktop/index.html`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "owned bytes")
  assert.notEqual(observedFlags, null)
  assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
})

test("inspect, source-path, and import return exact shapes while a locked import consumes its inspection first", async (t) => {
  const store = createInspectionStore({ randomId: (() => { let id = 0; return () => `inspection-${++id}` })() })
  const gate = deferred()
  let importSnapshot = null
  const fixture = await listenHandler(t, {
    inspectionStore: store,
    importNote: async ({ snapshot }) => {
      importSnapshot = snapshot
      await gate.promise
      return {
        paper_id: "Paper-01",
        actual_file_name: "Paper-01_论文精读.md",
        target_tab: "note",
        new_preview_url: `../../local_library_data/notes/paper-01/note/${"b".repeat(64)}.html`,
        index_version: "c".repeat(64),
      }
    },
  })
  const inspectionResponse = await post(fixture.origin, "/api/v1/notes/inspect", {
    paper_id: "Paper-01",
    category: "note",
    original_file_name: "note.md",
    markdown: "# Imported note",
  })
  assert.equal(inspectionResponse.status, 200)
  const inspection = await json(inspectionResponse)
  assert.deepEqual(Object.keys(inspection).sort(), ["checks", "expires_at", "inspection_id", "suggested_file_name", "target_tab"])

  const source = await post(fixture.origin, "/api/v1/papers/source-path", { paper_id: "Paper-01" })
  assert.equal(source.status, 200)
  assert.equal(source.headers.get("cache-control"), "no-store")
  assert.deepEqual(await json(source), { paper_id: "Paper-01", source_path: "/fixture/source/Paper-01" })

  const importing = post(fixture.origin, "/api/v1/notes/import", {
    inspection_id: inspection.inspection_id,
    requested_file_name: "Paper-01_论文精读.md",
    conflict_policy: "version",
  })
  while (importSnapshot === null) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.size(), 0)
  await assert.rejects(async () => store.peek(inspection.inspection_id), { code: "INSPECTION_INVALID" })
  gate.resolve()
  const imported = await importing
  assert.equal(imported.status, 200)
  assert.deepEqual(await json(imported), {
    paper_id: "Paper-01",
    actual_file_name: "Paper-01_论文精读.md",
    target_tab: "note",
    new_preview_url: `../../local_library_data/notes/paper-01/note/${"b".repeat(64)}.html`,
    index_version: "c".repeat(64),
  })
})

test("note import, candidate archive, and recovery share one immediate-reject coordinator without consuming busy work", async (t) => {
  const store = createInspectionStore({ randomId: (() => { let id = 0; return () => `inspection-${++id}` })() })
  const archiveGate = deferred()
  const archiveEntered = deferred()
  let archiveCalls = 0
  let importCalls = 0
  const coordinator = createWriteCoordinator()
  const fixture = await listenHandler(t, {
    inspectionStore: store,
    coordinator,
    archiveAction: async () => {
      archiveCalls += 1
      archiveEntered.resolve()
      await archiveGate.promise
      return { status: "created", paper_id: "Wang23-DIO", folder_name: "Wang23-DIO", rebuild_status: "complete", paper_count: 2 }
    },
    importNote: async () => { importCalls += 1; return {} },
  })
  const token = store.create({ bytes: Buffer.from("note"), marker: "busy reusable" })
  const archiving = post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  await archiveEntered.promise
  const busyImport = await post(fixture.origin, "/api/v1/notes/import", {
    inspection_id: token.inspection_id,
    requested_file_name: "Paper-01_论文精读.md",
    conflict_policy: "version",
  })
  assert.equal(busyImport.status, 409)
  assert.equal((await json(busyImport)).error.code, "LIBRARY_WRITE_BUSY")
  assert.equal(store.peek(token.inspection_id).marker, "busy reusable")
  assert.equal(importCalls, 0)

  const secondArchive = await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(secondArchive.status, 409)
  assert.equal((await json(secondArchive)).error.code, "LIBRARY_WRITE_BUSY")
  assert.equal(archiveCalls, 1)
  archiveGate.resolve()
  assert.equal((await archiving).status, 201)

  await coordinator.markRecovery({
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  })
  const recoveryGate = deferred()
  const recoveryEntered = deferred()
  const recoveryFixture = await listenHandler(t, {
    coordinator,
    recoveryAction: async ({ clearRecovery }) => {
      recoveryEntered.resolve()
      await recoveryGate.promise
      await clearRecovery()
      return { status: "recovered", paper_id: "Wang23-DIO", rebuild_status: "complete", paper_count: 2 }
    },
  })
  const recovering = post(recoveryFixture.origin, "/api/v1/archive/rebuild", recoveryRequest(), {
    headers: { "x-research-console-action": "rebuild-library" },
  })
  await recoveryEntered.promise
  const busyDuringRecovery = await post(recoveryFixture.origin, "/api/v1/notes/import", {
    inspection_id: "unused",
    requested_file_name: "Paper-01_论文精读.md",
    conflict_policy: "version",
  })
  assert.equal(busyDuringRecovery.status, 409)
  assert.equal((await json(busyDuringRecovery)).error.code, "LIBRARY_WRITE_BUSY")
  recoveryGate.resolve()
  assert.equal((await recovering).status, 200)
  assert.equal(coordinator.getState().recovery, null)
})

test("the real archive route preserves its package, returns last-good status, and enters candidate recovery", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "local-server-archive-route-"))
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-archive-source-")))
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  })
  const coordinator = createWriteCoordinator()
  const fixture = await listenHandler(t, {
    repoRoot,
    coordinator,
    loadContext: async () => scannedArchiveContext(sourceRoot),
    rebuild: async () => { throw new Error("induced candidate build failure") },
    archiveAction: undefined,
    recoveryAction: undefined,
  })

  const response = await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(response.status, 201)
  assert.deepEqual(await json(response), {
    status: "created",
    paper_id: "Wang23-DIO",
    folder_name: "Wang23-DIO",
    rebuild_status: "failed",
    index_state: "last_good",
    recovery_required: true,
  })
  assert.equal((await readFile(join(sourceRoot, "Wang23-DIO/metadata.yaml"), "utf8")).includes("openalex_id: W4387886124"), true)
  assert.deepEqual(coordinator.getState().recovery, {
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  })
  const capabilities = await json(await fetch(`${fixture.origin}/api/v1/capabilities`))
  assert.equal(capabilities.note_import, false)
  assert.equal(capabilities.candidate_archive, false)
  assert.equal(capabilities.archive_rebuild, true)
  assert.deepEqual(capabilities.recovery, {
    required: true,
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "main_papers",
    paper_id: "Wang23-DIO",
    openalex_id: "W4387886124",
  })
})

test("a temporary workbench completes archive-build-index then note inspect-import-build-preview", async (t) => {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-e2e-repo-")))
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "local-server-e2e-source-")))
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  })
  await mkdir(join(repoRoot, "prototype"), { recursive: true })
  await cp(join(workspaceRoot, "prototype/desktop"), join(repoRoot, "prototype/desktop"), { recursive: true })
  await writeFile(join(repoRoot, "prototype/desktop/state-transfer.html"), "<!doctype html><title>State transfer fixture</title>")
  await writeFile(join(repoRoot, "prototype/desktop/state-transfer.mjs"), "export const fixture = true\n")
  await mkdir(join(sourceRoot, "Seed-Paper"), { recursive: true })
  await writeFile(join(sourceRoot, "Seed-Paper/paper.pdf"), "%PDF-1.7\nfixture\n%%EOF\n")
  const institution = JSON.parse(await readFile(
    join(workspaceRoot, "exporter/config/institutions/nuist.json"),
    "utf8",
  ))
  const loadContext = async () => ({
    ...await scannedArchiveContext(sourceRoot),
    institution,
  })
  const fixture = await listenHandler(t, {
    repoRoot,
    loadContext,
    rebuild: rebuildConfiguredLibrary,
    inspect: undefined,
    importNote: undefined,
    archiveAction: undefined,
    recoveryAction: undefined,
  })

  const archived = await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(archived.status, 201)
  assert.deepEqual(await json(archived), {
    status: "created",
    paper_id: "Wang23-DIO",
    folder_name: "Wang23-DIO",
    rebuild_status: "complete",
    paper_count: 2,
  })
  const archiveIndex = JSON.parse(await readFile(join(repoRoot, "local_library_data/paper-index.json"), "utf8"))
  assert.equal(archiveIndex.papers.some((paper) => paper.paper_id === "Wang23-DIO"), true)

  const markdown = "# Candidate note\n\nBounded temporary integration preview."
  const inspectedResponse = await post(fixture.origin, "/api/v1/notes/inspect", {
    paper_id: "Wang23-DIO",
    category: "note",
    original_file_name: "candidate-note.md",
    markdown,
  })
  assert.equal(inspectedResponse.status, 200)
  const inspected = await json(inspectedResponse)
  assert.equal(inspected.checks.can_import, true)
  const importedResponse = await post(fixture.origin, "/api/v1/notes/import", {
    inspection_id: inspected.inspection_id,
    requested_file_name: inspected.suggested_file_name,
    conflict_policy: "version",
  })
  assert.equal(importedResponse.status, 200)
  const imported = await json(importedResponse)
  assert.equal(imported.paper_id, "Wang23-DIO")
  assert.match(imported.index_version, /^[a-f0-9]{64}$/u)
  const previewPrefix = "../../local_library_data/"
  assert.equal(imported.new_preview_url.startsWith(previewPrefix), true)
  const preview = await readFile(
    join(repoRoot, "local_library_data", imported.new_preview_url.slice(previewPrefix.length)),
    "utf8",
  )
  assert.match(preview, /Bounded temporary integration preview\./u)
  assert.equal(
    await readFile(join(sourceRoot, "Wang23-DIO", imported.actual_file_name), "utf8"),
    markdown,
  )
})

test("an ambiguous archive HTTP action enters fail-closed manual archive recovery", async (t) => {
  const coordinator = createWriteCoordinator()
  const fixture = await listenHandler(t, {
    coordinator,
    archiveAction: async ({ markRecovery }) => {
      await markRecovery({ kind: "manual_archive", reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS" })
      throw new CandidateArchiveActionError(
        "ARCHIVE_TRANSACTION_AMBIGUOUS",
        "/private/archive transaction is ambiguous",
      )
    },
  })
  const response = await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(response.status, 500)
  assert.deepEqual(await json(response), {
    error: { code: "ARCHIVE_TRANSACTION_AMBIGUOUS", message: "候选归档需要人工恢复" },
  })
  assert.deepEqual(coordinator.getState().recovery, {
    kind: "manual_archive",
    reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
  })
  const capabilities = await json(await fetch(`${fixture.origin}/api/v1/capabilities`))
  assert.equal(capabilities.note_import, false)
  assert.equal(capabilities.candidate_archive, false)
  assert.equal(capabilities.archive_rebuild, false)
  assert.deepEqual(capabilities.recovery, {
    required: true,
    kind: "manual_archive",
    reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
    archive_source_id: null,
    paper_id: null,
    openalex_id: null,
  })
})

test("manual note recovery blocks writes, candidate failure remains recoverable, and every failure is sanitized", async (t) => {
  const secret = ["/", "Users", "private", "paper.md"].join("/")
  const logs = []
  const failedImportCoordinator = createWriteCoordinator()
  const failedImportStore = createInspectionStore()
  const failedImportFixture = await listenHandler(t, {
    coordinator: failedImportCoordinator,
    inspectionStore: failedImportStore,
    importNote: async () => {
      throw Object.assign(new Error("rolled back incompletely"), { code: "ROLLBACK_FAILED" })
    },
  })
  const failedImportToken = failedImportStore.create({ bytes: Buffer.from("note") })
  const failedImport = await post(failedImportFixture.origin, "/api/v1/notes/import", {
    inspection_id: failedImportToken.inspection_id,
    requested_file_name: "Paper-01_论文精读.md",
    conflict_policy: "version",
  })
  assert.equal(failedImport.status, 500)
  assert.deepEqual(failedImportCoordinator.getState().recovery, {
    kind: "manual_note",
    reason_code: "ROLLBACK_FAILED",
  })

  const manual = createWriteCoordinator()
  await manual.markRecovery({ kind: "manual_note", reason_code: "BUILD_OUTPUT_INVALID" })
  const manualFixture = await listenHandler(t, { coordinator: manual })
  const blocked = await post(manualFixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(blocked.status, 503)
  assert.equal((await json(blocked)).error.code, "RECOVERY_REQUIRED")
  const blockedRecovery = await post(manualFixture.origin, "/api/v1/archive/rebuild", recoveryRequest(), {
    headers: { "x-research-console-action": "rebuild-library" },
  })
  assert.equal(blockedRecovery.status, 503)

  const fixture = await listenHandler(t, {
    inspect: async () => {
      throw Object.assign(new Error(`${secret}\nstack`), { code: "ROLLBACK_FAILED", fileName: secret })
    },
    logger: (event) => logs.push(event),
  })
  const response = await post(fixture.origin, "/api/v1/notes/inspect", {
    paper_id: "Paper-01", category: "note", original_file_name: "note.md", markdown: "# Note",
  })
  assert.equal(response.status, 500)
  const text = await response.text()
  assert.doesNotMatch(text, /Users|private|file:\/\/|stack/u)
  assert.deepEqual(JSON.parse(text), {
    error: { code: "ROLLBACK_FAILED", message: "笔记导入需要人工恢复", file_name: "paper.md" },
  })
  assert.deepEqual(logs, [{ event: "local_server_request_failed", code: "ROLLBACK_FAILED" }])
  assert.doesNotMatch(JSON.stringify(logs), /Users|private|paper\.md/u)
})

test("incomplete archive scans are a fixed 409 conflict and never expose raw errors", async (t) => {
  const fixture = await listenHandler(t, {
    archiveAction: async () => {
      throw Object.assign(new Error("/private/source could not be scanned"), {
        code: "ARCHIVE_SCAN_INCOMPLETE",
      })
    },
  })
  const response = await post(fixture.origin, "/api/v1/archive/candidates", candidateRequest(), {
    headers: { "x-research-console-action": "archive-candidate" },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await json(response), {
    error: { code: "ARCHIVE_SCAN_INCOMPLETE", message: "论文来源扫描不完整" },
  })
})

test("startup loads and builds before creating one server bound only to 127.0.0.1 with test port zero", async (t) => {
  const events = []
  const started = await startPrivateLibraryServer({
    repoRoot: "/fixture/repo",
    port: 0,
    loadContext: async () => { events.push("load"); return context() },
    rebuild: async () => { events.push("build"); return { paperCount: 1 } },
    createServer(handler) {
      events.push("create")
      const server = createHttpServer(handler)
      const listen = server.listen.bind(server)
      server.listen = (port, host, callback) => {
        events.push(`listen:${port}:${host}`)
        return listen(port, host, callback)
      }
      return server
    },
  })
  t.after(started.close)
  assert.deepEqual(events, ["load", "build", "create", "listen:0:127.0.0.1"])
  assert.match(started.origin, /^http:\/\/127\.0\.0\.1:\d+$/u)
  assert.equal(started.server.address().address, "127.0.0.1")
})

test("startup build failure never creates or listens and leaves an older output tree byte-identical", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "local-server-start-failure-"))
  t.after(() => rm(repoRoot, { recursive: true, force: true }))
  const oldData = Buffer.from("OLD-INDEX-BYTES")
  const oldOutput = Buffer.from("OLD-HTML-BYTES")
  await mkdir(join(repoRoot, "local_library_data"), { recursive: true })
  await mkdir(join(repoRoot, "local_library_output/desktop"), { recursive: true })
  await writeFile(join(repoRoot, "local_library_data/paper-index.json"), oldData)
  await writeFile(join(repoRoot, "local_library_output/desktop/library.html"), oldOutput)
  let createCalls = 0

  await assert.rejects(startPrivateLibraryServer({
    repoRoot,
    port: 0,
    loadContext: async () => context(),
    rebuild: async () => { throw new Error("private startup failure") },
    createServer: () => { createCalls += 1; return createHttpServer() },
  }), /启动|构建|startup/u)
  assert.equal(createCalls, 0)
  assert.deepEqual(await readFile(join(repoRoot, "local_library_data/paper-index.json")), oldData)
  assert.deepEqual(await readFile(join(repoRoot, "local_library_output/desktop/library.html")), oldOutput)
})

test("a new process owns a fresh in-memory inspection store", async (t) => {
  const firstStore = createInspectionStore({ randomId: () => "process-one-token" })
  const first = await listenHandler(t, { inspectionStore: firstStore })
  const inspected = await json(await post(first.origin, "/api/v1/notes/inspect", {
    paper_id: "Paper-01", category: "note", original_file_name: "note.md", markdown: "# Note",
  }))
  assert.equal(inspected.inspection_id, "process-one-token")

  const restarted = await listenHandler(t, { inspectionStore: createInspectionStore() })
  const response = await post(restarted.origin, "/api/v1/notes/import", {
    inspection_id: inspected.inspection_id,
    requested_file_name: "Paper-01_论文精读.md",
    conflict_policy: "version",
  })
  assert.equal(response.status, 409)
  assert.equal((await json(response)).error.code, "INSPECTION_INVALID")
})
