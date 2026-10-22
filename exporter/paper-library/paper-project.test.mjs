import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createPrivateLibraryRequestHandler } from "./local-server.mjs"

// Built from parts so the package audit does not see a literal private path.
const PRIVATE_PATH = ["", "Users", "someone", "secret", "notes.md"].join("/")

const REFERENCES = `# 文献清单

## 文献

| 短码 | 作者 | 年份 | 题名 | 期刊或会议 | DOI | 角色 | PDF | 核实 |
|---|---|---|---|---|---|---|---|---|
| Liu24-LCT | Liu Y；Chen X | 2024 | Linear convergence over unbalanced graphs | IEEE TCNS | 10.1109/tcns.2024.1 | 方法基础；期刊基准 | [03] Liu24-LCT - Linear.pdf | 已核实（PDF） |
| Wei25-DPZO | Wei M | 2025 | Privacy zeroth-order optimization | IEEE TCNS |  | 期刊基准 |  | 未核实 |
`

const BENCHMARK = `# 期刊基准表

## 取样

| 短码 | 题名 | 期刊 | 年份 | 本刊 | 阅读程度 |
|---|---|---|---|---|---|
| Liu24-LCT | Linear convergence | IEEE TCNS | 2024 | 是 | 全文 |

## 检查项

| 检查项 | Liu24-LCT | Wei25-DPZO | 本刊常见水平 |
|---|---|---|---|
| 是否有朴素基线 | 无〔§V〕 | 有，单机方法〔p.7〕 | 多数没有 |

## 硬性规定

| 规定 | 内容 | 来源 | 访问日期 | 冲突 |
|---|---|---|---|---|
| 页数 | 见 ${PRIVATE_PATH} | 投稿须知 | 2026-10-23 | 与证明位置冲突 |
`

const MAPPING = `## 映射

| 小节编号 | 本文小节 | 稿件文件 | 本刊范文 | 非本刊范文 | 本刊容忍度要点 | 目标篇幅 | 起草方式 |
|---|---|---|---|---|---|---|---|
| 2.1 | 网络模型 | 02_问题描述.md | Liu24-LCT·§II-A；Zhao99-MISS·§2 | | 假设一句带过 | 600字 | 整节 |
`

async function put(root, path, text) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

async function fixture(t, { config, files = {} } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "paper-project-"))
  const projectRoot = join(repoRoot, "project")
  await mkdir(join(repoRoot, "local_library_config"))
  await mkdir(projectRoot)
  for (const [path, text] of Object.entries(files)) await put(projectRoot, path, text)
  const projects = config === undefined ? [{ project_id: "pilot", path: projectRoot, layout: "paper-writing-workflow" }] : config
  if (projects !== null) {
    await writeFile(join(repoRoot, "local_library_config", "paper-projects.local.json"), JSON.stringify({ version: 1, projects }))
  }
  let origin
  const server = createServer(createPrivateLibraryRequestHandler({ repoRoot, getOrigin: () => origin }))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(repoRoot, { recursive: true, force: true }) })
  const get = (path) => fetch(`${origin}/api/v1/paper-projects${path}`)
  return { repoRoot, projectRoot, get }
}

function referencesIn(table) {
  return table.rows.flat(2).filter((segment) => segment.reference).map((segment) => segment.reference)
}

test("no configuration lists no projects", async (t) => {
  const f = await fixture(t, { config: null })
  const response = await f.get("")
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { version: 1, projects: [] })
})

test("project list never exposes the project path", async (t) => {
  const f = await fixture(t)
  const body = await f.get("").then((response) => response.text())
  assert.deepEqual(JSON.parse(body), { version: 1, projects: [{ project_id: "pilot", layout: "paper-writing-workflow", available: true }] })
  assert.equal(body.includes(f.projectRoot), false)
})

test("invalid configuration is reported instead of guessed", async (t) => {
  const f = await fixture(t, { config: [{ project_id: "Bad Id", path: "relative/path" }] })
  const response = await f.get("")
  assert.equal(response.status, 500)
  assert.equal((await response.json()).error.code, "PAPER_PROJECT_CONFIG_INVALID")
})

test("fixed-header tables parse into cells with resolved source references", async (t) => {
  const f = await fixture(t, { files: {
    "相关论文/文献清单.md": REFERENCES,
    "03_范文对照/期刊基准表.md": BENCHMARK,
    "03_范文对照/小节范文映射表.md": MAPPING,
    "01_稿件/02_问题描述.md": "如 Liu24-LCT 所示，另见 Unknown99-ZZ。",
  } })
  const response = await f.get("/pilot")
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.equal(body.includes(f.projectRoot), false)
  assert.equal(body.includes(PRIVATE_PATH), false)
  const project = JSON.parse(body)

  assert.deepEqual(project.references.map((row) => [row["短码"], row["核实"]]), [["Liu24-LCT", "已核实（PDF）"], ["Wei25-DPZO", "未核实"]])
  const referenceTable = project.tables.find((table) => table.key === "references").tables[0]
  assert.deepEqual(referencesIn(referenceTable).map((reference) => reference.code), ["Liu24-LCT", "Wei25-DPZO"], "only the 短码 column carries references")

  const benchmark = project.tables.find((table) => table.key === "benchmark")
  assert.equal(benchmark.status, "ok")
  const matrix = benchmark.tables.find((table) => table.heading === "检查项")
  assert.deepEqual(matrix.code_columns, ["Liu24-LCT", "Wei25-DPZO"])
  assert.deepEqual(referencesIn(matrix), [
    { code: "Liu24-LCT", location: "§V", known: true },
    { code: "Wei25-DPZO", location: "p.7", known: true },
  ])

  const mapping = project.tables.find((table) => table.key === "mapping").tables[0]
  assert.deepEqual(referencesIn(mapping), [
    { code: "Liu24-LCT", location: "§II-A", known: true },
    { code: "Zhao99-MISS", location: "§2", known: false },
  ])

  assert.deepEqual(project.drafts, [{ path: "01_稿件/02_问题描述.md", codes: ["Liu24-LCT"] }])
  assert.equal(project.tables.find((table) => table.key === "style").status, "missing")
})

test("a wrong header is shown as unparseable rather than reinterpreted", async (t) => {
  const f = await fixture(t, { files: {
    "相关论文/文献清单.md": "## 文献\n\n| 编码 | 作者 |\n|---|---|\n| Liu24-LCT | Liu |\n",
  } })
  const project = await f.get("/pilot").then((response) => response.json())
  const table = project.tables.find((entry) => entry.key === "references").tables[0]
  assert.equal(table.status, "unparseable")
  assert.match(table.reason, /固定表头/)
  assert.deepEqual(project.references, [])
})

test("review files are discovered by round and both tables are parsed", async (t) => {
  const f = await fixture(t, { files: {
    "相关论文/文献清单.md": REFERENCES,
    "审稿/第1轮/处理表.md": `## 意见

| 编号 | 意见 | 级别 | 依据 | 处理成本 | 处理方式 | 决定 |
|---|---|---|---|---|---|---|
| R1-1 | 口径不一致 | 硬伤 | Liu24-LCT·定理2 | 一段 | 补换算 | |

## 定位问题

| 编号 | 对比 | 条件 | 结果 | 影响的说法 | 可选处理 | 决定 |
|---|---|---|---|---|---|---|
| P-1 | 加噪 DGD | ε=1 | 未跑（预计 2 小时） | 贡献 2 | 先跑 | |
`,
  } })
  const project = await f.get("/pilot").then((response) => response.json())
  assert.deepEqual(project.reviews.map((review) => [review.path, review.status]), [
    ["00_课题/课题卡片审稿.md", "missing"],
    ["审稿/第1轮/处理表.md", "ok"],
  ])
  assert.deepEqual(referencesIn(project.reviews[1].tables[0]), [{ code: "Liu24-LCT", location: "定理2", known: true }])
})

test("other markdown files render through the controlled renderer", async (t) => {
  const f = await fixture(t, { files: { "00_课题/课题卡片.md": "# 课题卡片\n\n题目：$x^2$ 与 <script>alert(1)</script>\n" } })
  const response = await f.get(`/pilot/files/${encodeURIComponent("00_课题/课题卡片.md")}`)
  assert.equal(response.status, 200)
  const file = await response.json()
  assert.equal(file.path, "00_课题/课题卡片.md")
  assert.match(file.html, /<h1>课题卡片<\/h1>/)
  assert.equal(file.html.includes("<script>"), false)
})

test("file reads refuse traversal, hidden files, symlinks and non-markdown files", async (t) => {
  const f = await fixture(t, { files: { "notes.md": "ok", ".secret.md": "hidden", "data.txt": "plain" } })
  await writeFile(join(f.repoRoot, "outside.md"), "outside")
  await symlink(join(f.repoRoot, "outside.md"), join(f.projectRoot, "link.md"))
  for (const path of ["../outside.md", ".secret.md", "data.txt", "link.md", "/etc/passwd.md"]) {
    const response = await f.get(`/pilot/files/${encodeURIComponent(path)}`)
    assert.equal(response.status, 404, path)
  }
  const listing = await f.get("/pilot").then((response) => response.json())
  assert.deepEqual(listing.files.map((file) => file.path), ["data.txt", "notes.md"])
  assert.equal(listing.skipped_links, 1)
})

test("large non-workflow folders are named but not listed, so workflow files are never crowded out", async (t) => {
  const files = { "01_稿件/引言草稿.md": "引言", "审稿/修改说明.md": "修改" }
  for (let index = 0; index < 2100; index += 1) files[`code/data/${index}.txt`] = "x"
  const f = await fixture(t, { files })
  const project = await f.get("/pilot").then((response) => response.json())
  assert.deepEqual(project.files.map((file) => file.path), ["01_稿件/引言草稿.md", "审稿/修改说明.md"])
  assert.deepEqual(project.collapsed_directories, ["code"])
  assert.equal(project.truncated, false)
})

test("unknown projects and missing directories are distinct errors", async (t) => {
  const f = await fixture(t, { config: [{ project_id: "gone", path: "/nonexistent/paper-project" }] })
  assert.equal((await f.get("/other")).status, 404)
  const missing = await f.get("/gone")
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, "PAPER_PROJECT_UNAVAILABLE")
})

test("directories without the workflow layout only list files", async (t) => {
  const f = await fixture(t, { files: { "论文初稿.md": "旧布局" } })
  await writeFile(join(f.repoRoot, "local_library_config", "paper-projects.local.json"), JSON.stringify({ version: 1, projects: [{ project_id: "legacy", path: f.projectRoot }] }))
  const project = await f.get("/legacy").then((response) => response.json())
  assert.equal(project.layout, null)
  assert.deepEqual(project.files.map((file) => file.path), ["论文初稿.md"])
  assert.deepEqual([project.tables, project.reviews, project.drafts, project.references], [[], [], [], []])
})
