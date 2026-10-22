import test from "node:test"
import assert from "node:assert/strict"
import { createServer, request as httpRequest } from "node:http"
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPrivateLibraryRequestHandler } from "./local-server.mjs"
import { createWriteCoordinator } from "./write-coordinator.mjs"

async function fixture(t, { coordinator = createWriteCoordinator() } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "submission-api-"))
  const directory = join(repoRoot, "local_library_config")
  await mkdir(directory)
  const report = join(repoRoot, "research.md")
  const pdf = join(repoRoot, "paper.pdf")
  await writeFile(report, "# 应用研究\n未开展实验。\n")
  await writeFile(pdf, "%PDF-1.4\nfixture\n")
  const project = {
    schema: "research-submission-project", version: 1, id: "online-optimization",
    title: "在线优化算法应用投稿", updatedAt: "2026-09-09", summary: "应用实验尚未完成", statusLabel: "待验证",
    recommendation: "楼宇负荷校准优先，优势待验证",
    algorithmFacts: [],
    scenarios: [{ id: "buildings", title: "楼宇负荷校准", priority: 1, summary: "低维在线校准", decisionVariable: "校准系数", nextStep: "建立基线", writingTitle: "Online calibration", datasetIds: ["bdg2"], journalIds: ["energy-buildings"], advantages: ["待验证协作收益"], requirements: ["因果时间切分"], metrics: ["MAE"] }],
    datasets: [{ id: "bdg2", name: "BDG2", url: "https://example.org/dataset", description: "楼宇负荷数据", caveats: ["检查缺测"] }],
    journals: [{ id: "energy-buildings", name: "Energy and Buildings", url: "https://example.org/journal", fit: "建筑能源", formatNote: "参考同刊应用论文" }, { id: "sensors", name: "Sensors", url: "https://example.org/sensors", fit: "传感器", formatNote: "对齐格式" }],
    references: [], experiments: [{ id: "privacy", title: "隐私代价", purpose: "验证隐私与预测权衡", comparison: "不同隐私预算", metrics: ["MAE"], scenarioIds: ["buildings"] }], outline: [],
    documents: [{ id: "report", title: "报告", path: report, kind: "report", description: "已完成调研" }, { id: "paper", title: "论文", path: pdf, kind: "pdf", description: "原稿" }],
    privateDirectory: repoRoot,
  }
  const configPath = join(directory, "submission-project.json")
  const statePath = join(directory, "submission-project-state.json")
  const saveConfig = () => writeFile(configPath, JSON.stringify(project))
  await saveConfig()
  let origin
  const server = createServer(createPrivateLibraryRequestHandler({ repoRoot, getOrigin: () => origin, coordinator }))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(repoRoot, { recursive: true, force: true }) })
  const get = (path = "") => fetch(`${origin}/api/v1/submission-project${path}`)
  const post = (body, headers = {}) => fetch(`${origin}/api/v1/submission-project/state`, { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) })
  return { repoRoot, configPath, statePath, project, saveConfig, get, post, origin }
}

test("project API exposes configured research and a blank durable state without local paths", async (t) => {
  const f = await fixture(t)
  const response = await f.get()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  const body = await response.json()
  assert.equal(body.project.title, "在线优化算法应用投稿")
  assert.deepEqual(body.project.documents[0], { id: "report", title: "报告", kind: "report", description: "已完成调研", url: "/api/v1/submission-project/documents/report" })
  assert.equal(JSON.stringify(body).includes(f.repoRoot), false)
  assert.deepEqual(body.state, { version: 1, projectId: "online-optimization", revision: 0, scenarioId: null, journalId: null, experiments: {}, notes: "", draft: "" })
})

test("state saves survive requests and stale revisions cannot overwrite research decisions", async (t) => {
  const f = await fixture(t)
  const initial = await f.get().then((response) => response.json())
  const desired = { ...initial.state, scenarioId: "buildings", journalId: "energy-buildings", notes: "先做预测基线", draft: "# Introduction", experiments: { privacy: { status: "done", evidence: "结果已记录于本地报告" } } }
  const saved = await f.post({ expectedRevision: 0, state: desired })
  assert.equal(saved.status, 200)
  const result = await saved.json()
  assert.equal(result.state.revision, 1)
  assert.equal(result.state.notes, "先做预测基线")
  assert.deepEqual(JSON.parse(await readFile(f.statePath, "utf8")), result.state)
  assert.deepEqual((await f.get().then((response) => response.json())).state, result.state)
  const stale = await f.post({ expectedRevision: 0, state: { ...desired, notes: "stale tab" } })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, "SUBMISSION_REVISION_CONFLICT")
  assert.equal(JSON.parse(await readFile(f.statePath, "utf8")).notes, "先做预测基线")
})

test("state rejects mismatched project, invalid selections, unsupported status and completion without evidence", async (t) => {
  const f = await fixture(t)
  const { state } = await f.get().then((response) => response.json())
  for (const update of [
    { projectId: "unknown" }, { scenarioId: "../../secret" },
    { scenarioId: "buildings", journalId: "sensors" }, { journalId: "energy-buildings" },
    { experiments: { unknown: { status: "planned", evidence: "" } } },
    { experiments: { privacy: { status: "done", evidence: "  " } } },
    { experiments: { privacy: { status: "magic", evidence: "" } } },
    { experiments: { privacy: { status: "planned", evidence: "e".repeat(10_001) } } },
    { notes: "n".repeat(20_001) }, { draft: "d".repeat(200_001) }, { unexpected: true },
  ]) {
    const response = await f.post({ expectedRevision: 0, state: { ...state, ...update } })
    assert.equal(response.status, 400, JSON.stringify(update).slice(0, 100))
    assert.equal((await response.json()).error.code, "SUBMISSION_STATE_INVALID")
  }
})

test("state corruption blocks reading and saving without replacing the damaged file", async (t) => {
  const f = await fixture(t)
  const { state } = await f.get().then((response) => response.json())
  await writeFile(f.statePath, "damaged private state")
  for (const response of [await f.get(), await f.post({ expectedRevision: 0, state })]) {
    assert.equal(response.status, 500)
    assert.equal((await response.json()).error.code, "SUBMISSION_STATE_CORRUPT")
  }
  assert.equal(await readFile(f.statePath, "utf8"), "damaged private state")
})

test("a symbolic-link state cannot redirect reads or overwrite another local file", async (t) => {
  const f = await fixture(t)
  const { state } = await f.get().then((response) => response.json())
  const outside = join(f.repoRoot, "outside-state.json")
  await writeFile(outside, JSON.stringify(state))
  await symlink(outside, f.statePath)
  assert.equal((await f.get()).status, 500)
  const response = await f.post({ expectedRevision: 0, state })
  assert.equal(response.status, 500)
  assert.equal((await response.json()).error.code, "SUBMISSION_STATE_CORRUPT")
  assert.deepEqual(JSON.parse(await readFile(outside, "utf8")), state)
})

test("submission saves share the existing write coordinator and do not write during another operation", async (t) => {
  const coordinator = createWriteCoordinator()
  const f = await fixture(t, { coordinator })
  const { state } = await f.get().then((response) => response.json())
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const activeWrite = coordinator.run(() => blocked)
  try {
    const response = await f.post({ expectedRevision: 0, state })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, "LIBRARY_WRITE_BUSY")
    await assert.rejects(readFile(f.statePath), { code: "ENOENT" })
  } finally {
    release()
    await activeWrite
  }
  assert.equal((await f.post({ expectedRevision: 0, state })).status, 200)
})

test("project configuration failures are explicit and do not leak private paths", async (t) => {
  const f = await fixture(t)
  await rm(f.configPath)
  const missing = await f.get()
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, "SUBMISSION_PROJECT_NOT_FOUND")
  f.project.scenarios[0].datasetIds = ["missing"]
  await f.saveConfig()
  const invalid = await f.get()
  assert.equal(invalid.status, 500)
  const body = await invalid.text()
  assert.match(body, /SUBMISSION_PROJECT_INVALID/)
  assert.equal(body.includes(f.repoRoot), false)
})

test("incomplete project records and an empty scenario list fail clearly before reaching the UI", async (t) => {
  const f = await fixture(t)
  const original = JSON.stringify(f.project)
  for (const [collection, field] of [["scenarios", "title"], ["scenarios", "metrics"], ["scenarios", "advantages"], ["datasets", "name"], ["experiments", "purpose"], ["documents", "description"], ["scenarios", null]]) {
    const project = JSON.parse(original)
    if (field === null) project[collection] = []
    else delete project[collection][0][field]
    await writeFile(f.configPath, JSON.stringify(project))
    const response = await f.get()
    assert.equal(response.status, 500, `${collection}.${field}`)
    assert.equal((await response.json()).error.code, "SUBMISSION_PROJECT_INVALID")
  }
})

test("document ID routes serve bounded PDF and plain text but reject traversal, symlinks and directories", async (t) => {
  const f = await fixture(t)
  const report = await f.get("/documents/report")
  assert.equal(report.status, 200)
  assert.equal(report.headers.get("content-type"), "text/plain; charset=utf-8")
  assert.equal(await report.text(), "# 应用研究\n未开展实验。\n")
  const pdf = await f.get("/documents/paper")
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers.get("content-type"), "application/pdf")
  assert.match(await pdf.text(), /^%PDF-/)
  for (const suffix of ["/documents/unknown", "/documents/%2e%2e%2fsecret", "/documents/report?path=/etc/passwd"]) {
    assert.equal((await f.get(suffix)).status, 404)
  }
  const linked = join(f.repoRoot, "link.md")
  await symlink(f.project.documents[0].path, linked)
  for (const path of [linked, f.repoRoot]) {
    f.project.documents[0].path = path
    await f.saveConfig()
    const response = await f.get("/documents/report")
    assert.equal(response.status, 404)
    assert.equal((await response.text()).includes(f.repoRoot), false)
  }
})

test("document extension and size limits prevent arbitrary file access", async (t) => {
  const f = await fixture(t)
  const forbidden = join(f.repoRoot, "secret.json")
  await writeFile(forbidden, "secret")
  f.project.documents[0].path = forbidden
  await f.saveConfig()
  assert.equal((await f.get("/documents/report")).status, 404)
  const oversized = join(f.repoRoot, "oversized.md")
  await writeFile(oversized, "")
  await truncate(oversized, 2 * 1024 * 1024 + 1)
  f.project.documents[0].path = oversized
  await f.saveConfig()
  assert.equal((await f.get("/documents/report")).status, 413)
})

test("submission writes inherit local host, origin and JSON guards", async (t) => {
  const f = await fixture(t)
  const { state } = await f.get().then((response) => response.json())
  const body = { expectedRevision: 0, state }
  assert.equal((await f.post(body, { origin: "https://untrusted.example" })).status, 403)
  assert.equal((await f.post(body, { "sec-fetch-site": "cross-site" })).status, 403)
  assert.equal((await f.post(body, { "content-type": "text/plain" })).status, 415)
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.origin}/api/v1/submission-project/state`, { method: "POST", headers: { host: "evil.example", "content-type": "application/json" } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)) })
    request.on("error", reject)
    request.end(JSON.stringify(body))
  })
  assert.equal(hostileHostStatus, 400)
})
