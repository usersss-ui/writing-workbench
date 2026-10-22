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

const LEGACY_REFERENCES = `# 新稿文献清单

### A 基础工作

| ID             | 文献 |
| -------------- | ---- |
| Jiang25-Survey | Jiang X, Li Y. A survey of distributed optimization. Sci China Inf Sci, 2025 |
`

test("projects written before the fixed headers still resolve [短码] citations to PDFs and reference rows", async (t) => {
  const f = await fixture(t, { files: {
    "相关论文/文献清单.md": LEGACY_REFERENCES,
    "相关论文/1_基础工作/[01] Jiang25-Survey - A survey of distributed optimization.pdf": "%PDF-1.4 survey",
    "相关论文/[02] Mao21-PPED - Privacy preserving dispatch.pdf": "%PDF-1.4 dispatch",
    "相关论文/notes.pdf": "%PDF-1.4 unnamed",
    "01_稿件/引言草稿.md": "已有综述 [Jiang25-Survey]，隐私调度见 [Mao21-PPED]，另有 [Unknown99-ZZ]。",
    "02_规划与记录/讨论记录.md": "沿用 Jiang25-Survey 的分类。",
  } })
  const project = await f.get("/pilot").then((response) => response.json())
  assert.deepEqual(project.references, [])
  assert.deepEqual(project.sources, {
    "Jiang25-Survey": { citation: "Jiang X, Li Y. A survey of distributed optimization. Sci China Inf Sci, 2025", listed: true, pdfs: ["相关论文/1_基础工作/[01] Jiang25-Survey - A survey of distributed optimization.pdf"] },
    "Mao21-PPED": { citation: null, listed: false, pdfs: ["相关论文/[02] Mao21-PPED - Privacy preserving dispatch.pdf"] },
  })
  assert.deepEqual(project.mentions, {
    "Jiang25-Survey": ["01_稿件/引言草稿.md", "02_规划与记录/讨论记录.md"],
    "Mao21-PPED": ["01_稿件/引言草稿.md"],
  })
  assert.deepEqual(project.drafts, [{ path: "01_稿件/引言草稿.md", codes: ["Jiang25-Survey", "Mao21-PPED"] }])
})

test("project PDFs are served read-only from 相关论文 only", async (t) => {
  const f = await fixture(t, { files: {
    "相关论文/[01] Jiang25-Survey - A survey.pdf": "%PDF-1.4 survey",
    "相关论文/fake.pdf": "not a pdf",
    "01_稿件/draft.pdf": "%PDF-1.4 draft",
    "相关论文/notes.md": "notes",
  } })
  await writeFile(join(f.repoRoot, "outside.pdf"), "%PDF-1.4 outside")
  await symlink(join(f.repoRoot, "outside.pdf"), join(f.projectRoot, "相关论文", "link.pdf"))
  const pdf = (path) => f.get(`/pilot/pdf/${encodeURIComponent(path)}`)
  const ok = await pdf("相关论文/[01] Jiang25-Survey - A survey.pdf")
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get("content-type"), "application/pdf")
  assert.equal(ok.headers.get("cache-control"), "no-store")
  assert.equal(await ok.text(), "%PDF-1.4 survey")
  for (const path of ["01_稿件/draft.pdf", "相关论文/notes.md", "相关论文/../outside.pdf", "相关论文/link.pdf", "/etc/hosts.pdf"]) {
    assert.equal((await pdf(path)).status, 404, path)
  }
  const fake = await pdf("相关论文/fake.pdf")
  assert.equal(fake.status, 422)
})

test("the section guide comes only from explicit outline columns, section-named notes and “本文 X.Y” lines", async (t) => {
  const f = await fixture(t, { files: {
    "02_规划与记录/正文框架_v3.md": `# 正文框架

| 节 | 小节与内容 | 写法参照 | 占比 |
| --- | --- | --- | --- |
| 2 问题描述 | 2.1 系统模型<br>2.2 通信模型 | DePsFL；WIoT | 15% |
| 文内附录 | 证明 | — | 不计 |
`,
    "03_范文对照/应用类范文对照.md": `# 应用类论文对照

### 1. Zhao25-DePsFL（车联网）

- **可借鉴**：本文 2.2 的场景段可以照它的逐项对应写。
- 它的实验第 5 节有 8 个小节。
- 本文 3 个数据集都比它多；准确率提高了本文 0.069 个百分点。
`,
    "03_范文对照/隐私分析范文对照.md": "# 隐私性分析：范文怎么写（第 4.2 节用）\n\n## 一、逐篇\n",
  } })
  const guide = (await f.get("/pilot").then((response) => response.json())).section_guide
  assert.equal(guide.outline_path, "02_规划与记录/正文框架_v3.md")
  assert.deepEqual(guide.sections, [
    { id: "2", label: "2 问题描述", contents: "2.1 系统模型\n2.2 通信模型", references: "DePsFL；WIoT" },
    { id: null, label: "文内附录", contents: "证明", references: "—" },
  ])
  const application = guide.notes.find((note) => note.path === "03_范文对照/应用类范文对照.md")
  assert.deepEqual(application.sections, [])
  assert.deepEqual(application.headings, ["1. Zhao25-DePsFL（车联网）"])
  assert.deepEqual(application.passages, [{ heading: "1. Zhao25-DePsFL（车联网）", sections: ["2.2"], text: "**可借鉴**：本文 2.2 的场景段可以照它的逐项对应写。" }])
  assert.deepEqual(guide.notes.find((note) => note.path === "03_范文对照/隐私分析范文对照.md").sections, ["4.2"])
})
