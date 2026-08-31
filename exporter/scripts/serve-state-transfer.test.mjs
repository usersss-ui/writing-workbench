import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { createServer as createHttpServer, request as httpRequest } from "node:http"
import {
  mkdir,
  mkdtemp,
  open as openFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  STATE_TRANSFER_ASSET_FILES,
  createStateTransferRequestHandler,
  main,
  parseStateTransferArguments,
  startStateTransferServer,
} from "./serve-state-transfer.mjs"

const EXPECTED_ASSETS = Object.freeze([
  "state-transfer.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "candidate-storage.mjs",
  "paper-library-model.mjs",
  "styles.css",
])

const absoluteUsersPath = (...parts) => ["", "Users", ...parts].join("/")

async function put(root, relativePath, contents = relativePath) {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
  return target
}

async function makeFixture(t) {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), "state-transfer-server-")))
  t.after(() => rm(repoRoot, { recursive: true, force: true }))
  await put(repoRoot, "prototype/desktop/state-transfer.html", "<!doctype html><title>状态迁移</title>")
  for (const fileName of EXPECTED_ASSETS) {
    await put(repoRoot, `prototype/desktop/${fileName}`, `approved:${fileName}`)
  }
  for (const [relativePath, contents] of [
    ["prototype/desktop/state-transfer.test.mjs", "PRIVATE"],
    ["prototype/desktop/state-transfer-dom.test.mjs", "PRIVATE"],
    ["prototype/desktop/library.template.html", "PRIVATE"],
    ["prototype/desktop/library.mjs", "PRIVATE"],
    ["local_library_output/desktop/state-transfer.html", "GENERATED"],
    ["local_library_data/paper-index.json", "PRIVATE"],
    ["exporter/scripts/serve-state-transfer.test.mjs", "PRIVATE"],
  ]) await put(repoRoot, relativePath, contents)
  return repoRoot
}

async function listenFixture(t, { repoRoot, ...dependencies }) {
  const started = await startStateTransferServer({ repoRoot, port: 0, ...dependencies })
  t.after(() => started.close())
  return started
}

function rawRequest(origin, path, { method = "GET", headers = {} } = {}) {
  const url = new URL(origin)
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: Number(url.port),
      path,
      method,
      headers,
    }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolveResponse({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    request.once("error", rejectResponse)
    request.end()
  })
}

function runNodeImport(moduleUrl) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.once("error", rejectChild)
    child.once("exit", (code, signal) => resolveChild({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }))
  })
}

test("transitional CLI accepts only an explicit old-port choice and is import-safe", async () => {
  assert.deepEqual(STATE_TRANSFER_ASSET_FILES, EXPECTED_ASSETS)
  for (const port of [4176, 4177, 4178]) {
    assert.deepEqual(parseStateTransferArguments(["--port", String(port)]), { port })
  }
  for (const argv of [
    [], ["--port"], ["--port", "0"], ["--port", "4175"], ["--port", "4179"],
    ["--port", "4176", "extra"], ["--host", "127.0.0.1"], ["--port=4176"],
  ]) assert.throws(() => parseStateTransferArguments(argv), /参数无效/u, JSON.stringify(argv))

  let startedWith = null
  const stdout = { writes: [], write(value) { this.writes.push(value) } }
  const stderr = { writes: [], write(value) { this.writes.push(value) } }
  assert.equal(await main({
    argv: ["--port", "4178"],
    repoRoot: "/fixture/repo",
    start: async (options) => {
      startedWith = options
      return { origin: "http://127.0.0.1:4178", close: async () => {} }
    },
    stdout,
    stderr,
  }), 0)
  assert.deepEqual(startedWith, { repoRoot: "/fixture/repo", port: 4178 })
  assert.deepEqual(stdout.writes, ["浏览器状态迁移工具：http://127.0.0.1:4178/state-transfer.html\n"])
  assert.deepEqual(stderr.writes, [])

  const failedStdout = { writes: [], write(value) { this.writes.push(value) } }
  const failedStderr = { writes: [], write(value) { this.writes.push(value) } }
  assert.equal(await main({
    argv: ["--port", "4177"],
    repoRoot: "/fixture/repo",
    start: async () => { throw new Error(absoluteUsersPath("private", "repo")) },
    stdout: failedStdout,
    stderr: failedStderr,
  }), 1)
  assert.deepEqual(failedStdout.writes, [])
  assert.deepEqual(failedStderr.writes, ["浏览器状态迁移工具启动失败。请检查本机文件边界。\n"])

  const imported = await runNodeImport(new URL("./serve-state-transfer.mjs", import.meta.url).href)
  assert.deepEqual(imported, { code: 0, signal: null, stdout: "", stderr: "" })
})

test("transitional server serves only the page and exact eight-file closure by GET and HEAD", async (t) => {
  const repoRoot = await makeFixture(t)
  const fixture = await listenFixture(t, { repoRoot })
  assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/u)

  const resources = [
    ["/state-transfer.html", "<!doctype html><title>状态迁移</title>"],
    ...EXPECTED_ASSETS.map((fileName) => [`/assets/${fileName}`, `approved:${fileName}`]),
  ]
  for (const [pathname, expected] of resources) {
    const response = await fetch(`${fixture.origin}${pathname}`)
    assert.equal(response.status, 200, pathname)
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", pathname)
    assert.equal(await response.text(), expected, pathname)

    const head = await fetch(`${fixture.origin}${pathname}`, { method: "HEAD" })
    assert.equal(head.status, 200, `HEAD ${pathname}`)
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(expected)), pathname)
    assert.equal(await head.text(), "", pathname)
  }
})

test("transitional server returns 404 for every alias/private route and 405 only for known-route methods", async (t) => {
  const repoRoot = await makeFixture(t)
  const fixture = await listenFixture(t, { repoRoot })

  for (const pathname of [
    "/", "/state-transfer.html/", "/state-transfer.html?copy=1", "/assets", "/assets/",
    "/assets/styles.css?copy=1", "/assets/unknown.mjs", "/assets/library.mjs",
    "/assets/state-transfer.test.mjs", "/assets/state-transfer-dom.test.mjs",
    "/prototype/desktop/state-transfer.html", "/prototype/desktop/library.template.html",
    "/local_library_output/desktop/state-transfer.html", "/local_library_data/paper-index.json",
    "/api/v1/capabilities", "/exporter/scripts/serve-state-transfer.test.mjs",
  ]) assert.equal((await fetch(`${fixture.origin}${pathname}`, { redirect: "manual" })).status, 404, pathname)

  for (const pathname of [
    "/%73tate-transfer.html", "/assets%2fstyles.css", "/assets/%73tyles.css",
    "/assets//styles.css", "/assets/./styles.css", "/assets/../state-transfer.html",
    "/assets\\styles.css", "/%2e%2e/local_library_data/paper-index.json",
  ]) {
    const response = await rawRequest(fixture.origin, pathname, {
      headers: { host: new URL(fixture.origin).host },
    })
    assert.equal(response.status, 404, pathname)
  }

  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const known = await fetch(`${fixture.origin}/state-transfer.html`, { method })
    assert.equal(known.status, 405, method)
    assert.equal(known.headers.get("allow"), "GET, HEAD", method)
  }
  assert.equal((await fetch(`${fixture.origin}/unknown`, { method: "POST" })).status, 404)
})

test("transitional server rejects aliased roots and symlinked files and opens terminal files no-follow", async (t) => {
  const repoRoot = await makeFixture(t)
  const outside = await realpath(await mkdtemp(join(tmpdir(), "state-transfer-outside-")))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await put(outside, "secret.mjs", "outside")
  await rm(join(repoRoot, "prototype/desktop/state-transfer.mjs"))
  await symlink(join(outside, "secret.mjs"), join(repoRoot, "prototype/desktop/state-transfer.mjs"))

  let observedFlags = null
  const fixture = await listenFixture(t, {
    repoRoot,
    staticFileSystem: {
      open: async (path, flags, mode) => {
        if (path === join(repoRoot, "prototype/desktop/styles.css")) observedFlags = flags
        return openFile(path, flags, mode)
      },
    },
  })
  assert.equal((await fetch(`${fixture.origin}/assets/state-transfer.mjs`)).status, 404)
  assert.equal((await fetch(`${fixture.origin}/assets/styles.css`)).status, 200)
  assert.notEqual(observedFlags, null)
  assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)

  const aliasRepo = join(dirname(repoRoot), `${repoRoot.split("/").at(-1)}-alias`)
  await symlink(repoRoot, aliasRepo)
  t.after(() => rm(aliasRepo, { force: true }))
  const aliased = await listenFixture(t, { repoRoot: aliasRepo })
  assert.equal((await fetch(`${aliased.origin}/state-transfer.html`)).status, 404)
})

test("request handler rejects a non-loopback Host without exposing source bytes", async (t) => {
  const repoRoot = await makeFixture(t)
  let origin = "http://127.0.0.1:4178"
  const handler = createStateTransferRequestHandler({ repoRoot, getOrigin: () => origin })
  const server = createHttpServer(handler)
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)))
  const address = server.address()
  origin = `http://127.0.0.1:${address.port}`

  const response = await rawRequest(origin, "/state-transfer.html", { headers: { host: "attacker.example" } })
  assert.equal(response.status, 400)
  assert.equal(response.body.toString("utf8"), "")
})
