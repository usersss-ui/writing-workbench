# 本地 Markdown 笔记导入服务与居中对话框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不暴露论文源目录、不覆盖已有文件且不破坏静态浏览的前提下，为当前论文详情提供七类 Markdown 材料的检查、一次性授权导入、原子重建、索引刷新和居中原生对话框。

**Architecture:** `runtime.mjs` 统一加载本机配置、目录和当前扫描映射；`note-import.mjs` 负责纯检查、十分钟一次性检查记录与带指纹回滚的文件事务；`local-server.mjs` 在 `127.0.0.1` 上提供严格同源 API 和生成物白名单静态服务。浏览器以独立 API 客户端和对话框控制器接入现有 `library.mjs`，导入成功后显式失效索引缓存并恢复当前论文、目标页签、目录显隐和新增预览选择；本地服务不可用时只降级写入与复制路径操作。

**Tech Stack:** Node.js ES modules、Node 22 built-ins (`node:http`、`node:fs/promises`、`node:crypto`、`node:test`)、原生 `<dialog>`、静态 HTML/CSS/JavaScript、Python Playwright。

**Spec:** `docs/superpowers/specs/2026-08-30-paper-library-manual-curation-design.md`，仅实现第三阶段“本地服务与笔记导入”。

## Global Constraints

- 不实现或改动“我的标签”与 `facet_states`；本计划明确在这两个阶段之后执行，消费已经完成的独立个人标签模块、version-3 标签目录和可兼容 `3/2`、`2/1` 的 `loadPaperIndex`。
- 不移动、改名或改写任何既有论文、OCR、笔记、图片、代码和结果；事务只能排他新建一份 Markdown，构建失败时只删除指纹仍相同的本次新建文件。
- 浏览器和 API 都只提交稳定 `paper_id`，不得提交目标目录或浏览器本机路径；除显式 `source-path` 响应外，任何 HTTP 响应、生成索引、DOM、localStorage 和浏览器日志都不得包含绝对路径。
- 服务只绑定 `127.0.0.1`，不提供 `--host`；启动前构建失败时不得监听。静态路由不得提供 `local_library_config/`、`paper-library-audit.json`、源论文目录或任意仓库文件。
- 本计划采用后续确认的端口覆盖：Node 服务的正式 CLI 固定为 `http://127.0.0.1:4176`，替代 Python 临时预览作为主入口；Python 只读 fallback 只能在 Node 服务停止时复用同一端口，二者不得同时启动。底层启动函数允许测试注入系统分配端口，但不向操作员暴露生产端口参数。
- `/api/v1/` 使用独立精确路由表，未知路由固定 404；该边界允许以后增加同源路由，但本计划不实现文献发现或候选归档能力，也不迁移其数据。
- 写请求必须通过精确 Host、同源 Origin（若存在）、`Sec-Fetch-Site`、JSON 内容类型和请求体大小检查；不得发出 CORS 允许头。
- 七类、标记和目标页签是固定契约：`note/论文精读/note`、`derivation/推导过程/derivation`、`source_map/source_map/derivation`、`modeling/建模复盘/simulation`、`simulation/仿真描述/simulation`、`code_compare/代码对比/code_compare`、`reproduction_report/复现报告/simulation`。
- 检查编号只在服务内存保存十分钟，单次使用；忙碌拒绝不消费，取得写锁后立即消费，无论后续成功或失败都不可复用。
- 检查正文上限为 UTF-8 原始字节 `1_048_576`，检查 JSON 请求上限为 `1_100_000` 字节，导入 JSON 请求上限为 `16 * 1024` 字节。
- 每一项实现变更严格执行 RED → GREEN → REFACTOR；先实际看到指定失败，再写生产代码。每个任务末尾的 commit 命令由未来执行者运行，本轮只创建计划且不提交。
- 不安装 npm 或 Python 依赖；使用仓库当前 Node 与已配置 Playwright Python 环境。

---

### Task 1: 抽取唯一的本机运行时与重建入口

**Files:**
- Create: `exporter/paper-library/runtime.mjs`
- Create: `exporter/paper-library/runtime.test.mjs`
- Modify: `exporter/scripts/build-private-library.mjs:1-58`
- Modify: `exporter/paper-library/build.test.mjs:950-1030`

**Interfaces:**
- Consumes: `loadLibraryConfig(path)`, `loadPaperOverrides(path)`, `loadPaperTagCatalog(path)`, `loadPaperCatalog(path, { sourceId })`, `scanPaperSources({ config, overrides, catalogs })`, `buildPrivateLibrary(options)`.
- Produces: `loadPrivateLibraryContext({ repoRoot, loadConfig?, loadOverrides?, loadTags?, loadCatalog?, scan? }): Promise<PrivateLibraryContext>`.
- Produces: `rebuildConfiguredLibrary({ repoRoot, context, build? }): Promise<BuildResult>`.
- `PrivateLibraryContext = { config, overrides, tagCatalog, catalogs, scanned, papersById, unitDirectoryByPaperId }`;两个 Map 只在服务进程内使用，不可 JSON 序列化或返回客户端。
- Preserves: `build-private-library.mjs` 的成功输出、失败脱敏和 import-safe 行为。

- [ ] **Step 1: 写运行时加载的最小失败测试（2–5 分钟）**

在 `runtime.test.mjs` 写三个测试：固定配置路径与目录加载、重复 `paper_id`/缺失路径映射拒绝、重建参数复用。

```js
import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import {
  loadPrivateLibraryContext,
  rebuildConfiguredLibrary,
} from "./runtime.mjs"

test("loads one configured context and indexes the current scan by stable paper id", async () => {
  const repoRoot = "/fixture/repo"
  const loads = []
  const config = { version: 1, sources: [{ source_id: "main", path: "/vault", catalog_path: "/catalog.md" }] }
  const overrides = { version: 1, papers: {} }
  const tagCatalog = { version: 3, papers: {} }
  const paper = { paper_id: "Paper-01", source_id: "main", relative_path: "Topic/Paper" }
  const context = await loadPrivateLibraryContext({
    repoRoot,
    loadConfig: async (path) => { loads.push(path); return config },
    loadOverrides: async (path) => { loads.push(path); return overrides },
    loadTags: async (path) => { loads.push(path); return tagCatalog },
    loadCatalog: async (path, options) => { loads.push(`${path}:${options.sourceId}`); return { version: 1, papers: {} } },
    scan: async () => ({ papers: [paper], audit: { private_path_lookup: { "Paper-01": "/vault/Topic/Paper" } } }),
  })
  assert.deepEqual(loads, [
    join(repoRoot, "local_library_config/library.local.json"),
    join(repoRoot, "local_library_config/paper-overrides.json"),
    join(repoRoot, "local_library_config/paper-tags.json"),
    "/catalog.md:main",
  ])
  assert.equal(context.papersById.get("Paper-01"), paper)
  assert.equal(context.unitDirectoryByPaperId.get("Paper-01"), "/vault/Topic/Paper")
})

test("rebuild passes exactly the loaded configuration and the approved template root", async () => {
  const context = { config: {}, overrides: {}, tagCatalog: {}, catalogs: {} }
  const calls = []
  const result = await rebuildConfiguredLibrary({
    repoRoot: "/fixture/repo",
    context,
    build: async (options) => { calls.push(options); return { paperCount: 1 } },
  })
  assert.equal(result.paperCount, 1)
  assert.deepEqual(calls[0], {
    repoRoot: "/fixture/repo",
    config: context.config,
    overrides: context.overrides,
    catalogs: context.catalogs,
    tagCatalog: context.tagCatalog,
    templateRoot: join("/fixture/repo", "prototype/desktop"),
  })
})
```

- [ ] **Step 2: 运行 RED（2–5 分钟）**

Run: `node --test exporter/paper-library/runtime.test.mjs`

Expected: exit 1；测试文件因 `ERR_MODULE_NOT_FOUND` 找不到 `runtime.mjs` 而失败，0 tests passed。

- [ ] **Step 3: 实现上下文加载（2–5 分钟）**

`runtime.mjs` 必须使用以下入口和一致性检查；Map 的值来自同一次扫描。

```js
import { join } from "node:path"
import { buildPrivateLibrary } from "./build.mjs"
import { loadPaperCatalog } from "./catalog-adapter.mjs"
import { loadLibraryConfig } from "./config.mjs"
import { loadPaperOverrides } from "./overrides.mjs"
import { scanPaperSources } from "./scanner.mjs"
import { loadPaperTagCatalog } from "./tag-catalog.mjs"

export async function loadPrivateLibraryContext({
  repoRoot,
  loadConfig = loadLibraryConfig,
  loadOverrides = loadPaperOverrides,
  loadTags = loadPaperTagCatalog,
  loadCatalog = loadPaperCatalog,
  scan = scanPaperSources,
} = {}) {
  if (typeof repoRoot !== "string" || !repoRoot) throw new TypeError("论文库根目录无效")
  const config = await loadConfig(join(repoRoot, "local_library_config/library.local.json"))
  const overrides = await loadOverrides(join(repoRoot, "local_library_config/paper-overrides.json"))
  const tagCatalog = await loadTags(join(repoRoot, "local_library_config/paper-tags.json"))
  const catalogs = {}
  for (const source of config.sources) {
    if (source.catalog_path !== null && source.catalog_path !== undefined) {
      catalogs[source.source_id] = await loadCatalog(source.catalog_path, { sourceId: source.source_id })
    }
  }
  const scanned = await scan({ config, overrides, catalogs })
  const papersById = new Map()
  const unitDirectoryByPaperId = new Map()
  for (const paper of scanned.papers) {
    const directory = scanned.audit?.private_path_lookup?.[paper.paper_id]
    if (papersById.has(paper.paper_id) || typeof directory !== "string" || !directory) {
      throw new Error("当前论文扫描映射无效")
    }
    papersById.set(paper.paper_id, paper)
    unitDirectoryByPaperId.set(paper.paper_id, directory)
  }
  return { config, overrides, tagCatalog, catalogs, scanned, papersById, unitDirectoryByPaperId }
}

export function rebuildConfiguredLibrary({ repoRoot, context, build = buildPrivateLibrary } = {}) {
  if (!context?.config || !context?.overrides || !context?.catalogs) throw new TypeError("论文库运行上下文无效")
  return build({
    repoRoot,
    config: context.config,
    overrides: context.overrides,
    catalogs: context.catalogs,
    tagCatalog: context.tagCatalog,
    templateRoot: join(repoRoot, "prototype/desktop"),
  })
}
```

- [ ] **Step 4: 让现有构建 CLI 只调用运行时（2–5 分钟）**

将 `main` 的可注入项改为 `loadContext` 与 `rebuild`，保留脱敏 catch：

```js
export async function main({
  repoRoot = SCRIPT_REPO_ROOT,
  loadContext = loadPrivateLibraryContext,
  rebuild = rebuildConfiguredLibrary,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  try {
    const context = await loadContext({ repoRoot })
    const result = await rebuild({ repoRoot, context })
    stdout("私有论文库构建完成")
    stdout(`论文记录：${result.paperCount}`)
    stdout(`笔记预览：${result.previewCount}`)
    stdout(`生成页面：${result.pageCount}`)
    stdout(`排除记录：${result.excludedCount}`)
    stdout("生成：local_library_data/paper-index.json")
    stdout("生成：local_library_data/paper-library-audit.json")
    stdout("生成：local_library_output/desktop/library.html")
    return 0
  } catch {
    stderr("私有论文库构建失败。请检查本机配置、覆盖映射和审计边界。")
    return 1
  }
}
```

同步改写 `build.test.mjs` 的 CLI 注入测试，断言 `loadContext({ repoRoot })` 与 `rebuild({ repoRoot, context })` 各调用一次，且私有错误文本不进入 stderr。

- [ ] **Step 5: 运行 GREEN 与回归（2–5 分钟）**

Run: `node --test exporter/paper-library/runtime.test.mjs`

Expected: exit 0；3 passed，0 failed。

Run: `node --test --test-name-pattern='CLI main|CLI loads catalogs' exporter/paper-library/build.test.mjs`

Expected: exit 0；所有匹配到的 CLI 子测试通过，0 failed；未匹配子测试仅显示 skipped。

- [ ] **Step 6: 独立 commit 步骤（2–5 分钟）**

```bash
git add exporter/paper-library/runtime.mjs exporter/paper-library/runtime.test.mjs exporter/scripts/build-private-library.mjs exporter/paper-library/build.test.mjs
git commit -m "refactor(paper-library): share private runtime loading"
```

Expected: 只提交上述四个文件；`git show --stat --oneline HEAD` 不包含本机配置或生成目录。

---

### Task 2: 实现七类 Markdown 检查与共享图片边界

**Files:**
- Create: `exporter/paper-library/note-import.mjs`
- Create: `exporter/paper-library/note-import.test.mjs`
- Modify: `exporter/paper-library/build.mjs:690-858`
- Modify: `exporter/paper-library/build.test.mjs:530-560`

**Interfaces:**
- Produces: `NOTE_IMPORT_CATEGORIES: Readonly<Record<Category, { label, marker, target_tab }>>`。
- Produces: `NOTE_IMPORT_MAX_BYTES = 1_048_576`, `INSPECT_REQUEST_MAX_BYTES = 1_100_000`, `IMPORT_REQUEST_MAX_BYTES = 16_384`。
- Produces: `NoteImportError extends Error`，公开 `code` 与可选 `fileName`，不把绝对路径写入 `message`。
- Produces: `suggestNoteFileName(paperId, category): string`。
- Produces: `validateRequestedFileName(name, { paperId, category }): string`；返回 NFKC 后的单个 `.md` 基名。
- Produces: `inspectMarkdownNote({ paper, unitDirectory, category, originalFileName, markdown, imageInspector? }): Promise<{ publicResult, snapshot }>`。
- Produces from `build.mjs`: `inspectControlledImageReferences({ markdown, unitDirectory, noteRelativePath }): Promise<Array<{ target, status }>>`；构建与导入调用同一个现有 `resolveImageReference`。
- `publicResult = { suggested_file_name, target_tab, checks }`；`snapshot = { bytes, sha256, paper_id, source_id, relative_path, category, original_file_name, suggested_file_name, target_tab, checks }`，绝不直接发给 HTTP 客户端；Task 4 在存入 token 前只追加内部 `unit_real_path`。

- [ ] **Step 1: 写类别、文件名和边界 RED 测试（2–5 分钟）**

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  NOTE_IMPORT_CATEGORIES,
  inspectMarkdownNote,
  suggestNoteFileName,
  validateRequestedFileName,
} from "./note-import.mjs"

test("exports the exact seven category, marker, and reader-tab contracts", () => {
  assert.deepEqual(NOTE_IMPORT_CATEGORIES, {
    note: { label: "论文精读", marker: "论文精读", target_tab: "note" },
    derivation: { label: "推导过程", marker: "推导过程", target_tab: "derivation" },
    source_map: { label: "来源映射", marker: "source_map", target_tab: "derivation" },
    modeling: { label: "建模复盘", marker: "建模复盘", target_tab: "simulation" },
    simulation: { label: "仿真描述", marker: "仿真描述", target_tab: "simulation" },
    code_compare: { label: "代码对照", marker: "代码对比", target_tab: "code_compare" },
    reproduction_report: { label: "复现报告", marker: "复现报告", target_tab: "simulation" },
  })
  assert.equal(suggestNoteFileName("Zhao24-DFL", "note"), "Zhao24-DFL_论文精读.md")
})

test("accepts one marked basename and rejects overwrite-shaped or path-shaped names", () => {
  assert.equal(
    validateRequestedFileName("Zhao24-DFL_论文精读_补充.md", { paperId: "Zhao24-DFL", category: "note" }),
    "Zhao24-DFL_论文精读_补充.md",
  )
  for (const name of ["../论文精读.md", "dir/论文精读.md", "dir\\论文精读.md", "/tmp/论文精读.md", "Zhao24-DFL_补充.md", "Zhao24-DFL_论文精读.txt", "Zhao24-DFL_论文精读\u0000.md"]) {
    assert.throws(() => validateRequestedFileName(name, { paperId: "Zhao24-DFL", category: "note" }), { code: "INVALID_FILE_NAME" })
  }
})
```

- [ ] **Step 2: 写内容检查 RED 测试（2–5 分钟）**

在同一测试文件加入精确断言：

```js
test("reports blocking paper-id/frontmatter/math/image issues and non-blocking metadata or missing-image warnings", async () => {
  const paper = {
    paper_id: "Zhao24-DFL",
    source_id: "main",
    relative_path: "Topic/Zhao",
    title_original: "Canonical title",
    title_zh: "规范标题",
    title_en: "Canonical title",
    authors: ["A. Author"],
    publication_year: 2024,
  }
  const { publicResult } = await inspectMarkdownNote({
    paper,
    unitDirectory: "/vault/Topic/Zhao",
    category: "note",
    originalFileName: "note.md",
    markdown: "---\npaper_id: Other-01\ntitle: Different\nyear: 2023\n---\n# Note\n$open\n![bad](../escape.png)\n![missing](missing.png)",
    imageInspector: async () => [
      { target: "../escape.png", status: "unsupported" },
      { target: "missing.png", status: "missing" },
    ],
  })
  assert.deepEqual(publicResult.checks.blocking_codes, ["PAPER_ID_MISMATCH", "LATEX_UNBALANCED", "IMAGE_UNSAFE"])
  assert.deepEqual(publicResult.checks.warning_codes, ["TITLE_MISMATCH", "YEAR_MISMATCH", "IMAGE_MISSING"])
  assert.equal(publicResult.checks.can_import, false)
})

test("measures the 1 MiB boundary in UTF-8 bytes", async () => {
  const paper = { paper_id: "Paper-01", source_id: "main", relative_path: "Paper" }
  const exact = await inspectMarkdownNote({ paper, unitDirectory: "/vault/Paper", category: "note", originalFileName: "note.md", markdown: "a".repeat(1_048_576), imageInspector: async () => [] })
  const over = await inspectMarkdownNote({ paper, unitDirectory: "/vault/Paper", category: "note", originalFileName: "note.md", markdown: `${"a".repeat(1_048_575)}中`, imageInspector: async () => [] })
  assert.equal(exact.publicResult.checks.blocking_codes.includes("MARKDOWN_TOO_LARGE"), false)
  assert.equal(over.publicResult.checks.blocking_codes.includes("MARKDOWN_TOO_LARGE"), true)
})
```

测试文件固定为 10 个顶层测试，另外覆盖：`.markdown` 可检查；非 Markdown 阻塞；未闭合 frontmatter 阻塞；作者不一致为 warning；闭合 `$`/`$$`/`\(`/`\)`/`\[`/`\]` 全部通过；`unsafe/unsupported/ambiguous/invalid_type/too_large` 图片状态阻塞而 `missing` 只警告；snapshot 的 `Buffer` 与调用者后续修改隔离。

- [ ] **Step 3: 运行 RED（2–5 分钟）**

Run: `node --test exporter/paper-library/note-import.test.mjs`

Expected: exit 1；`ERR_MODULE_NOT_FOUND` 指向 `note-import.mjs`，0 tests passed。

- [ ] **Step 4: 导出共享图片检查器（2–5 分钟）**

保留 `resolveImageReference` 的现有安全读取算法；只新增导出层，并让 `preparePreviewImages` 也调用它，避免两份解析规则：

```js
export async function inspectControlledImageReferences({ markdown, unitDirectory, noteRelativePath }) {
  const references = []
  renderControlledMarkdown(markdown, {
    resolveImage(reference) {
      references.push({ ...reference })
      return { status: "collecting" }
    },
  })
  const results = []
  const byTarget = new Map()
  for (const reference of references) {
    if (!byTarget.has(reference.target)) {
      byTarget.set(reference.target, await resolveImageReference({ unitDirectory, noteRelativePath, reference }))
    }
    results.push({ target: reference.target, ...byTarget.get(reference.target) })
  }
  return results
}
```

`preparePreviewImages` 消费该函数的结果生成 asset/audit；不得改变现有图片复制、哈希 URL 或旧笔记缺图占位行为。`build.test.mjs` 增加一项测试，确认同一 `../escape.png` 在共享检查器中为 `unsupported` 且构建审计也记录 `unsupported`；再加一项确认最终文件名位于单元根时，`images/figure.png` 在检查与构建中都解析为同一个 `sourceRelativePath`。

- [ ] **Step 5: 实现检查结果的固定结构（2–5 分钟）**

`note-import.mjs` 使用以下不可变类别表与结果形状：

```js
import { createHash, randomUUID } from "node:crypto"
import { parsePaperFrontmatter } from "./frontmatter.mjs"
import { inspectControlledImageReferences } from "./build.mjs"

export const NOTE_IMPORT_MAX_BYTES = 1024 * 1024
export const INSPECT_REQUEST_MAX_BYTES = 1_100_000
export const IMPORT_REQUEST_MAX_BYTES = 16 * 1024
export const NOTE_IMPORT_CATEGORIES = Object.freeze(Object.fromEntries(Object.entries({
  note: { label: "论文精读", marker: "论文精读", target_tab: "note" },
  derivation: { label: "推导过程", marker: "推导过程", target_tab: "derivation" },
  source_map: { label: "来源映射", marker: "source_map", target_tab: "derivation" },
  modeling: { label: "建模复盘", marker: "建模复盘", target_tab: "simulation" },
  simulation: { label: "仿真描述", marker: "仿真描述", target_tab: "simulation" },
  code_compare: { label: "代码对照", marker: "代码对比", target_tab: "code_compare" },
  reproduction_report: { label: "复现报告", marker: "复现报告", target_tab: "simulation" },
}).map(([key, value]) => [key, Object.freeze(value)])))

export class NoteImportError extends Error {
  constructor(code, message, { fileName = null } = {}) {
    super(message)
    this.name = "NoteImportError"
    this.code = code
    this.fileName = fileName
  }
}

function finishChecks(items) {
  const blocking_codes = items.filter((item) => item.severity === "blocking").map((item) => item.code)
  const warning_codes = items.filter((item) => item.severity === "warning").map((item) => item.code)
  return { items, blocking_codes, warning_codes, can_import: blocking_codes.length === 0 }
}
```

检查项按固定顺序追加：`UTF8_VALID`、`MARKDOWN_EXTENSION`、`MARKDOWN_SIZE`、`FRONTMATTER_CLOSED`、`PAPER_ID_MATCH`、`TITLE_MATCH`、`AUTHORS_MATCH`、`YEAR_MATCH`、`LATEX_BALANCED`，随后按正文出现顺序追加图片项。前八项没有相应 frontmatter 字段时使用 pass 而非 warning。frontmatter 仅在第一行精确为 `---` 时要求后续独立一行 `---`；闭合后调用现有 `parsePaperFrontmatter`。元数据比较先 NFKC、合并空白并对拉丁字母转小写；标题匹配 `title_original/title_zh/title_en` 任一非空值，作者按规范化后的有序数组，年份匹配 `publication_year ?? year`。

LaTeX 检查先移除 fenced code 和 inline code，再忽略反斜杠转义字符；分别验证未转义单 `$`、`$$` 数量为偶数，并用栈验证 `\(`/`\)`、`\[`/`\]` 成对且不交叉。正文若有 `�`（U+FFFD）返回 `UTF8_REPLACEMENT_CHARACTER` 阻塞；浏览器端 Task 5 仍必须用 fatal decoder 阻止非 UTF-8 原始字节。

`validateRequestedFileName` 必须同时满足：输入等于 trim 后值、NFKC 后不含控制字符、`/`、`\` 或 `..`；不是 POSIX/Windows/UNC 绝对形式；以 `.md` 结尾；包含 `${paperId}_` 与所选 marker。建议名始终为 `${paperId}_${marker}.md`。

- [ ] **Step 6: 运行 GREEN 与共享规则回归（2–5 分钟）**

Run: `node --test exporter/paper-library/note-import.test.mjs`

Expected: exit 0；10 passed，0 failed。

Run: `node --test --test-name-pattern='image|图片' exporter/paper-library/build.test.mjs`

Expected: exit 0；所有匹配图片子测试通过，0 failed；旧预览的缺图行为未改变。

- [ ] **Step 7: 独立 commit 步骤（2–5 分钟）**

```bash
git add exporter/paper-library/note-import.mjs exporter/paper-library/note-import.test.mjs exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs
git commit -m "feat(paper-library): inspect markdown note imports"
```

Expected: commit 不包含真实 Markdown、图片、`local_library_config/`、`local_library_data/` 或 `local_library_output/`。

---

### Task 3: 实现一次性检查记录、单写锁与安全文件事务

**Files:**
- Modify: `exporter/paper-library/note-import.mjs`
- Create: `exporter/paper-library/note-import-transaction.test.mjs`

**Interfaces:**
- Produces: `createInspectionStore({ now?, randomId?, ttlMs? }): InspectionStore`。
- `InspectionStore.create(snapshot): { inspection_id, expires_at }`；`peek(id)` 不消费；`take(id)` 立即消费并返回内部快照；`size()` 先清理过期记录。
- Produces: `createSingleWriter({ logger? }): { run(operation), isBusy(), isWriteBlocked() }`；忙碌抛 `NoteImportError("IMPORT_BUSY")`，恢复阻塞抛 `NoteImportError("RECOVERY_REQUIRED")`。
- Produces: `importInspectedNote({ repoRoot, inspectionStore, inspectionId, requestedFileName, conflictPolicy, loadContext?, rebuild?, logger?, fs? }): Promise<ImportResult>`；此函数只能从已取得写锁的 `run` 内调用。
- `ImportResult = { paper_id, actual_file_name, target_tab, new_preview_url, index_version }`，其中 `index_version` 是重建后 `paper-index.json` UTF-8 字节的 SHA-256 十六进制值。

- [ ] **Step 1: 写令牌与写锁 RED 测试（2–5 分钟）**

```js
test("inspection ids expire after ten minutes and are consumed exactly once", () => {
  let now = 1_000
  let sequence = 0
  const store = createInspectionStore({ now: () => now, randomId: () => `inspection-${++sequence}` })
  const created = store.create({ bytes: Buffer.from("# note"), sha256: "hash", paper_id: "Paper-01" })
  assert.equal(created.expires_at, new Date(601_000).toISOString())
  assert.equal(store.take(created.inspection_id).paper_id, "Paper-01")
  assert.throws(() => store.take(created.inspection_id), { code: "INSPECTION_INVALID" })
  const expired = store.create({ bytes: Buffer.from("# second"), sha256: "hash2", paper_id: "Paper-01" })
  now = 601_001
  assert.throws(() => store.take(expired.inspection_id), { code: "INSPECTION_EXPIRED" })
})

test("a busy writer rejects immediately without invoking the second operation", async () => {
  let release
  let secondRan = false
  const writer = createSingleWriter()
  const first = writer.run(() => new Promise((resolve) => { release = resolve }))
  await assert.rejects(() => writer.run(async () => { secondRan = true }), { code: "IMPORT_BUSY" })
  assert.equal(secondRan, false)
  release("done")
  assert.equal(await first, "done")
})
```

- [ ] **Step 2: 写事务 RED 测试（2–5 分钟）**

在临时来源根创建真实普通目录与现有文件，固定 8 个顶层测试：

1. 请求名已存在时排他创建 `_v2`，再次导入选择 `_v3`，原文件字节不变；
2. 写入只使用检查快照保存的 bytes，调用者后续修改原 Buffer 不影响落盘；
3. 当前重新扫描不再包含 `paper_id` 或 source/relative_path/realpath 改变时返回 `PAPER_MAPPING_CHANGED` 且零写入；
4. 来源根、单元目录、目标文件任一为符号链接时返回 `UNSAFE_TARGET`；
5. 使用 `O_CREAT | O_EXCL | O_NOFOLLOW`，测试注入的 `open` 精确记录 flags；
6. build 失败且指纹未变时删除新文件、保留旧生成 sentinel、返回 `BUILD_FAILED`；
7. build 失败后文件 dev/inode/size/hash 任一改变时不删除，返回 `ROLLBACK_FAILED`，writer 进入永久 `RECOVERY_REQUIRED`；
8. build 成功时从新索引定位 `category + actual_file_name`，返回该哈希预览 URL 与 64 位 `index_version`。

关键成功断言：

```js
const result = await writer.run(() => importInspectedNote({
  repoRoot,
  inspectionStore: store,
  inspectionId: created.inspection_id,
  requestedFileName: "Paper-01_论文精读.md",
  conflictPolicy: "version",
  loadContext,
  rebuild,
}))
assert.deepEqual(result, {
  paper_id: "Paper-01",
  actual_file_name: "Paper-01_论文精读_v2.md",
  target_tab: "note",
  new_preview_url: "../../local_library_data/notes/paper-01/note/" + "a".repeat(64) + ".html",
  index_version: result.index_version,
})
assert.match(result.index_version, /^[a-f0-9]{64}$/u)
```

- [ ] **Step 3: 运行 RED（2–5 分钟）**

Run: `node --test exporter/paper-library/note-import-transaction.test.mjs`

Expected: exit 1；导入失败提示 `createInspectionStore`、`createSingleWriter` 或 `importInspectedNote` 尚未从 `note-import.mjs` 导出，0 passed。

- [ ] **Step 4: 实现十分钟内存记录与 writer 状态机（2–5 分钟）**

```js
export function createInspectionStore({ now = Date.now, randomId = randomUUID, ttlMs = 10 * 60 * 1000 } = {}) {
  const records = new Map()
  function prune() {
    const instant = now()
    for (const [id, record] of records) if (record.expiresAt <= instant) records.delete(id)
  }
  function create(snapshot) {
    prune()
    const inspection_id = randomId()
    const expiresAt = now() + ttlMs
    records.set(inspection_id, {
      ...structuredClone({ ...snapshot, bytes: undefined }),
      bytes: Buffer.from(snapshot.bytes),
      expiresAt,
    })
    return { inspection_id, expires_at: new Date(expiresAt).toISOString() }
  }
  function read(id, consume) {
    const record = records.get(id)
    if (!record) throw new NoteImportError("INSPECTION_INVALID", "检查记录无效")
    if (record.expiresAt <= now()) {
      records.delete(id)
      throw new NoteImportError("INSPECTION_EXPIRED", "检查记录已过期")
    }
    if (consume) records.delete(id)
    return { ...record, bytes: Buffer.from(record.bytes) }
  }
  return { create, peek: (id) => read(id, false), take: (id) => read(id, true), size: () => { prune(); return records.size } }
}

export function createSingleWriter({ logger = console.error } = {}) {
  let busy = false
  let writeBlocked = false
  async function run(operation) {
    if (writeBlocked) throw new NoteImportError("RECOVERY_REQUIRED", "写入已停用，需要人工检查")
    if (busy) throw new NoteImportError("IMPORT_BUSY", "正在重建，请稍后重试")
    busy = true
    try {
      return await operation()
    } catch (error) {
      if (["ROLLBACK_FAILED", "BUILD_OUTPUT_INVALID"].includes(error?.code)) {
        writeBlocked = true
        logger(error.recoveryPath)
      }
      throw error
    } finally {
      busy = false
    }
  }
  return { run, isBusy: () => busy, isWriteBlocked: () => writeBlocked }
}
```

`logger` 只接收 `ROLLBACK_FAILED` 的精确本机路径，供终端人工恢复；HTTP 映射必须丢弃 `recoveryPath`。

- [ ] **Step 5: 实现路径重验、排他创建与版本命名（2–5 分钟）**

事务取得 writer 后第一条语句必须是 `const snapshot = inspectionStore.take(inspectionId)`。随后重新计算 `sha256(snapshot.bytes)`，检查 `checks.can_import === true` 与 `conflictPolicy === "version"`，再 `await loadContext({ repoRoot })`。用当前 `paper_id` 查 `papersById` 和 `unitDirectoryByPaperId`，并与 snapshot 中的 `source_id`、`relative_path`、`unit_real_path` 精确比较。

安全目录检查固定执行：

- 从 `context.config.sources` 按 `source_id` 取唯一来源；`lstat(source.path)` 与 `lstat(unitDirectory)` 都必须是非符号链接目录；
- `realpath(source.path) === resolve(source.path)`，`realpath(unitDirectory) === resolve(unitDirectory)`；
- `relative(realSourceRoot, realUnitDirectory)` 不为空绝对路径、不等于 `..` 且不以 `../` 开头；
- 对来源根到单元目录的每个相对目录段逐级 `lstat`，任一符号链接或非目录立即 `UNSAFE_TARGET`；
- 目标只用 `join(realUnitDirectory, validatedBasename)` 生成，不接受客户端路径。

该实现段在 `note-import.mjs` 顶部显式导入 `constants` from `node:fs`，`lstat/open/readFile/realpath/unlink` from `node:fs/promises`，`basename/dirname/extname/isAbsolute/join/relative/resolve/sep` from `node:path`；测试注入的 `fs` 对象必须提供同名方法和 `constants`，不得在函数内部读取全局工作目录。

版本创建必须位于同一 writer 临界区：先尝试请求基名；`EEXIST` 后按 `_v2`、`_v3` 递增。每次直接调用：

```js
const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
const handle = await open(candidatePath, flags, 0o600)
await handle.writeFile(snapshot.bytes)
await handle.sync()
await handle.close()
```

任何非 `EEXIST` open 错误转换为 `WRITE_FAILED`；错误 message 固定为“无法新建笔记”，仅携带安全 `fileName`。

- [ ] **Step 6: 实现精确指纹回滚与成功定位（2–5 分钟）**

写入完成后用 `lstat`、`open(O_RDONLY | O_NOFOLLOW)`、handle `stat` 与内容 SHA-256 记录 `{ dev, ino, size, sha256 }`。调用 `rebuild({ repoRoot, context })`；若抛错，再次读取同四项，只有完全相同才 `unlink`。读取失败、指纹变化或 unlink 失败都抛：

```js
const error = new NoteImportError("ROLLBACK_FAILED", "自动回滚失败", { fileName: actualFileName })
error.recoveryPath = createdPath
throw error
```

重建成功后读取 `local_library_data/paper-index.json` 原始 bytes，解析论文，查找 `paper.controlled_preview_documents[snapshot.category]` 中 `label === actualFileName` 的唯一项。不存在或不唯一时创建 `BUILD_OUTPUT_INVALID`，设置 `recoveryPath = join(repoRoot, "local_library_data/paper-index.json")` 后抛出，并让 writer 进入与 `ROLLBACK_FAILED` 相同的恢复阻塞状态；新生成目录已经发布，不能只删除源文件。找到后返回：

```js
return {
  paper_id: snapshot.paper_id,
  actual_file_name: actualFileName,
  target_tab: snapshot.target_tab,
  new_preview_url: preview.url,
  index_version: createHash("sha256").update(indexBytes).digest("hex"),
}
```

- [ ] **Step 7: 运行 GREEN（2–5 分钟）**

Run: `node --test exporter/paper-library/note-import-transaction.test.mjs`

Expected: exit 0；8 passed，0 failed；测试临时目录中没有失败事务遗留的新 Markdown。

Run: `node --test exporter/paper-library/note-import.test.mjs exporter/paper-library/runtime.test.mjs`

Expected: exit 0；13 passed，0 failed。

- [ ] **Step 8: 独立 commit 步骤（2–5 分钟）**

```bash
git add exporter/paper-library/note-import.mjs exporter/paper-library/note-import-transaction.test.mjs
git commit -m "feat(paper-library): commit note imports safely"
```

Expected: commit 仅含导入服务代码和临时目录驱动测试，不含测试运行产生的文件。

---

### Task 4: 建立回环本地服务、严格 API 边界与启动 CLI

**Files:**
- Create: `exporter/paper-library/local-server.mjs`
- Create: `exporter/paper-library/local-server.test.mjs`
- Create: `exporter/scripts/serve-private-library.mjs`
- Modify: `exporter/paper-library/note-import.mjs`
- Modify: `exporter/paper-library/note-import-transaction.test.mjs`

**Interfaces:**
- Produces: `createPrivateLibraryRequestHandler({ repoRoot, getOrigin, loadContext?, rebuild?, inspectionStore?, writer?, inspect?, importNote?, logger? }): http.RequestListener`。
- Produces: `startPrivateLibraryServer({ repoRoot, port = 4176, loadContext?, rebuild?, createServer? }): Promise<{ server, origin, close }>`。
- Produces: `parseServeArguments(argv): { port: 4176 }`；只接受空参数列表，任何 CLI 参数都拒绝。底层 `startPrivateLibraryServer` 的 `port` 依赖仅供测试用 `0` 或受控集成注入，不属于正式操作入口。
- Produces: CLI `main({ argv?, repoRoot?, start?, stdout?, stderr? }): Promise<number>`，直接执行时只在成功监听后输出脱敏 URL。
- HTTP success contracts:
  - `GET /api/v1/capabilities` → `{ api_version: 1, note_import: true, source_path: true, categories: [{ value, label, target_tab }] }`。
  - `POST /api/v1/papers/source-path` → `{ paper_id, source_path }` 且 `Cache-Control: no-store`。
  - `POST /api/v1/notes/inspect` → `{ inspection_id, suggested_file_name, checks, target_tab, expires_at }`。
  - `POST /api/v1/notes/import` → Task 3 的 `ImportResult`。
- HTTP error contract: `{ error: { code, message, file_name? } }`；只允许固定中文 message 和安全基名。

- [ ] **Step 1: 写请求边界 RED 测试（2–5 分钟）**

用真实 `http.createServer` 监听系统分配的回环端口，通过 `fetch` 覆盖固定 12 个顶层测试：

1. capabilities 精确字段与七类顺序，不含路径；
2. 错误 Host 返回 400 `HOST_FORBIDDEN`；
3. 不同 Origin 返回 403 `ORIGIN_FORBIDDEN`；
4. `Sec-Fetch-Site: cross-site` 返回 403 `CROSS_SITE_FORBIDDEN`；
5. `text/plain` 返回 415 `JSON_REQUIRED`；
6. inspect 原始 body 为 1,100,001 bytes 返回 413 `REQUEST_TOO_LARGE`；
7. import 原始 body 为 16,385 bytes 返回 413；
8. 非法 JSON 返回 400 `INVALID_JSON`；
9. 所有响应无 `Access-Control-Allow-Origin`；
10. `/local_library_config/library.local.json`、审计 JSON、任意 `../` 路由均 404；
11. 只读生成索引、notes、sources、生成 desktop 页面与 assets 可读且 MIME 固定；
12. 错误对象注入 `/Users/private/paper.md` 后，响应 body 不含该值、`file://` 或 stack。

请求 helper 必须显式设置合法 Host/Origin，避免测试绕过真实边界：

```js
const response = await fetch(`${origin}/api/v1/notes/inspect`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
    "sec-fetch-site": "same-origin",
  },
  body: JSON.stringify(payload),
})
```

- [ ] **Step 2: 写 API 生命周期、忙锁与启动 RED 测试（2–5 分钟）**

增加 9 个顶层测试：合法 inspect 精确返回；阻塞检查不能 import；过期/重复 inspection 不能写；第一项 import 持锁时第二项立即 409 且第二 token 稍后可成功；取得锁后构建失败 token 失效；source-path 只有已扫描 paper 可查且 no-store；启动先构建后 listen；构建失败时 createServer/listen 均未调用；真实临时仓库完成 `inspect → import → buildPrivateLibrary → paper-index → hashed preview`。

真实集成测试只能使用 `mkdtemp` 的 repo/source，写最小 config/override/version-3 tag catalog、一个显式 `Paper-01` 单元和完整 desktop template/assets fixture。fixture 必须从生产 `REQUIRED_DESKTOP_ASSETS` 的同一来源生成或显式包含先行阶段加入的 `paper-user-tags.mjs`，不得维护会遗漏新资产的旧副本。成功后断言源单元新增 `Paper-01_论文精读.md`、index 的 `controlled_preview_documents.note[0].label` 匹配、HTTP 可读取 64 位哈希预览且正文含 `<h1>Imported note</h1>`；`t.after` 删除临时目录，绝不加载真实 `local_library_config`。

CLI 测试固定断言：

```js
assert.deepEqual(parseServeArguments([]), { port: 4176 })
for (const argv of [["--host", "0.0.0.0"], ["--port", "4180"], ["--port", "0"], ["--port"], ["extra"]]) {
  assert.throws(() => parseServeArguments(argv), /参数无效/u)
}
```

- [ ] **Step 3: 运行 RED（2–5 分钟）**

Run: `node --test exporter/paper-library/local-server.test.mjs`

Expected: exit 1；`ERR_MODULE_NOT_FOUND` 指向 `local-server.mjs`，0 passed。

- [ ] **Step 4: 实现固定请求守卫和 body reader（2–5 分钟）**

每次请求先以 `getOrigin()` 得到精确 `http://127.0.0.1:<actual-port>`。Host 必须等于该 URL 的 host；有 Origin 时必须等于 origin；写请求有 `sec-fetch-site` 时只允许 `same-origin` 或 `none`。JSON 内容类型只接受大小写无关的 `application/json` 或 `application/json; charset=utf-8`。

`readJsonBody(request, limit)` 对每个 Buffer chunk 累计原始字节；超过 limit 时停止收集并返回 `REQUEST_TOO_LARGE`，不得先转字符串。`TextDecoder("utf-8", { fatal: true })` 解码失败返回 `INVALID_JSON`，`JSON.parse` 失败同码。所有 API 响应设置 `Content-Type: application/json; charset=utf-8`、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`，并且不设置 CORS header。

固定错误状态映射：`HOST_FORBIDDEN` 400、`ORIGIN_FORBIDDEN/CROSS_SITE_FORBIDDEN` 403、`JSON_REQUIRED` 415、`REQUEST_TOO_LARGE` 413、`INVALID_JSON/INVALID_REQUEST/INVALID_FILE_NAME` 400、`PAPER_NOT_FOUND` 404、`INSPECTION_INVALID/INSPECTION_EXPIRED/PAPER_MAPPING_CHANGED` 409、`IMPORT_BUSY` 409、`RECOVERY_REQUIRED` 503、`BUILD_FAILED/ROLLBACK_FAILED/BUILD_OUTPUT_INVALID/WRITE_FAILED` 500。未知异常统一 500 `INTERNAL_ERROR`。

- [ ] **Step 5: 实现 API 路由与一次性快照（2–5 分钟）**

inspect route 只接受精确四字段对象 `{ paper_id, category, original_file_name, markdown }`。每次加载新 context，用 `papersById` 和 `unitDirectoryByPaperId` 解析；调用 `inspectMarkdownNote` 后给 snapshot 加上 `unit_real_path: await realpath(unitDirectory)`，再 `inspectionStore.create(snapshot)`。响应只展开 `publicResult` 与 token 元数据。

import route 只接受精确三字段 `{ inspection_id, requested_file_name, conflict_policy }`，调用顺序必须是：

```js
const result = await writer.run(() => importNote({
  repoRoot,
  inspectionStore,
  inspectionId: body.inspection_id,
  requestedFileName: body.requested_file_name,
  conflictPolicy: body.conflict_policy,
  loadContext,
  rebuild,
  logger,
}))
```

因此 busy 在 `importNote` 前发生且不消费 token。source-path route 只接受 `{ paper_id }`，每次加载当前 context，返回 Map 中的绝对路径；不得 log body 或 response，必须显式 `Cache-Control: no-store`。

- [ ] **Step 6: 实现静态白名单与回环启动（2–5 分钟）**

静态路由只允许：

- `/local_library_output/desktop/library.html` 与 `/local_library_output/desktop/assets/` 下的构建生成文件；
- `/local_library_data/paper-index.json`；
- `/local_library_data/notes/` 与 `/local_library_data/sources/` 下的构建生成文件；
- `/prototype/desktop/index.html`、`directions.html`、`p02.html` 以及它们在 `github-package-files.json` 已列出的固定脚本、CSS 和 `vendor/katex/` 依赖。

路由先 `decodeURIComponent` 一次；NUL、反斜杠、空段、`.`、`..`、重复分隔符立即 404。目标 `realpath` 必须仍位于对应允许根内且 `lstat` 为普通非符号链接文件。`paper-library-audit.json` 和 `paper-catalog.json` 不在白名单。

`startPrivateLibraryServer` 先 `loadContext`、再 `rebuild`，两者成功后才 `createServer(handler)`，最后使用 `server.listen(port, "127.0.0.1")`。返回 `origin` 使用实际端口；测试 port 0 可用，CLI parser 不接受 0。

- [ ] **Step 7: 实现 import-safe CLI（2–5 分钟）**

`serve-private-library.mjs` 使用与现有构建脚本相同的 `pathToFileURL(resolve(process.argv[1]))` 直接执行守卫。成功只输出：`本地论文库服务：http://127.0.0.1:<port>/local_library_output/desktop/library.html`；失败只输出：`本地论文库服务启动失败。请检查本机配置和构建边界。`，不拼接 error。

- [ ] **Step 8: 运行 GREEN（2–5 分钟）**

Run: `node --test exporter/paper-library/local-server.test.mjs`

Expected: exit 0；21 passed，0 failed；所有测试 server 在 `t.after` 中关闭，真实集成只改动临时 source。

Run: `node --test exporter/paper-library/note-import-transaction.test.mjs exporter/paper-library/runtime.test.mjs`

Expected: exit 0；11 passed，0 failed。

- [ ] **Step 9: 独立 commit 步骤（2–5 分钟）**

```bash
git add exporter/paper-library/local-server.mjs exporter/paper-library/local-server.test.mjs exporter/scripts/serve-private-library.mjs exporter/paper-library/note-import.mjs exporter/paper-library/note-import-transaction.test.mjs
git commit -m "feat(paper-library): serve loopback note import api"
```

Expected: commit 中没有监听公网的选项，没有私有路径 fixture 常量进入生产响应。

---

### Task 5: 增加居中对话框 DOM、严格浏览器 API 客户端与静态降级

**Files:**
- Modify: `prototype/desktop/library.template.html:215-224,367-381`
- Modify: `prototype/desktop/styles.css:796-880,1175-1230`
- Modify: `prototype/desktop/library.mjs:1-25,624-653,795-828,1154-1218,1530-1660`
- Modify: `prototype/desktop/paper-inspector.mjs:249-274`
- Modify: `prototype/desktop/paper-library-dom.test.mjs:535-620,1020-1060,1450-1550,1850-1920,2280-2320`

**Interfaces:**
- Produces DOM: `#library-add-note`, `#library-note-import-help`, `[data-index-reload-status]`, `#library-index-reload`。
- Produces DOM: `#library-note-import-dialog`, `#library-note-import-form`, `[data-note-import-paper-id]`, `#library-note-import-category`, `#library-note-import-file`, `#library-note-import-checks`, `#library-note-import-file-name`, `[data-note-import-status]`, `#library-note-import-close`, `#library-note-import-cancel`, `#library-note-import-submit`。
- Produces from `library.mjs`: `loadLocalLibraryCapabilities(fetchImpl?)`, `inspectLocalMarkdownNote({ fetchImpl, paperId, category, originalFileName, markdown })`, `importLocalMarkdownNote({ fetchImpl, inspectionId, requestedFileName })`, `loadPrivateSourcePath({ fetchImpl, paperId })`, `decodeUtf8MarkdownFile(file)`。
- Extends: `createRetryableLoader(load)` → `{ getState, run, invalidate }`；失效前启动的请求不得恢复 ready cache。
- Extends the post-personal-tags signature exactly as `renderInspector({ document, paper, workspaceState, facetSchema, userTags = [], userTagNotice = "", sourcePathAvailable = false })`；只新增 `sourcePathAvailable`，不得删除、重命名或绕过 `userTags`、`userTagNotice`，也不改变分面状态参数。

- [ ] **Step 1: 写模板和 CSS 合约 RED 测试（2–5 分钟）**

在现有静态 DOM 合约中精确断言每个 ID 只出现一次、“添加笔记”位于 `.library-reader-toolbar`、dialog 不包含任何路径输入、表单没有 `method="dialog"`：

```js
test("detail reader owns one centered native note-import dialog with no path input", () => {
  for (const id of [
    "library-add-note", "library-index-reload", "library-note-import-dialog",
    "library-note-import-form", "library-note-import-category", "library-note-import-file",
    "library-note-import-checks", "library-note-import-file-name", "library-note-import-close",
    "library-note-import-cancel", "library-note-import-submit",
  ]) assert.equal(countMatches(html, new RegExp(`id="${id}"`, "gu")), 1, id)
  assert.match(html, /library-reader-toolbar[\s\S]*id="library-add-note"[\s\S]*library-reader-tabs/u)
  assert.match(html, /<dialog[^>]*id="library-note-import-dialog"/u)
  assert.doesNotMatch(html, /library-note-import-form[^>]*method="dialog"/u)
  assert.doesNotMatch(html, /note-import[^>]*(?:source-path|target-path|directory)/u)
  assert.match(styles, /\.paper-library-page \.library-note-import-dialog\s*\{[^}]*margin:\s*auto/isu)
  assert.match(styles, /\.library-note-import-body\s*\{[^}]*overflow-y:\s*auto/isu)
})
```

- [ ] **Step 2: 写 API 与 loader RED 测试（2–5 分钟）**

增加测试覆盖 capabilities 精确字段、四个 endpoint/body、非法响应拒绝、fatal UTF-8 和 cache generation：

```js
test("invalidating a ready or in-flight loader forces one fresh fetch", async () => {
  const releases = []
  const loader = createRetryableLoader(() => new Promise((resolve) => releases.push(resolve)))
  const stale = loader.run()
  loader.invalidate()
  const fresh = loader.run()
  releases[0]("old")
  assert.deepEqual(await stale, { ok: false, value: null })
  releases[1]("new")
  assert.deepEqual(await fresh, { ok: true, value: "new" })
  assert.equal(loader.getState(), "ready")
})

test("the local API client sends only stable ids and markdown content", async () => {
  const calls = []
  const result = await inspectLocalMarkdownNote({
    fetchImpl: async (url, options) => {
      calls.push([url, JSON.parse(options.body)])
      return jsonResponse({ inspection_id: "i-1", suggested_file_name: "Paper-01_论文精读.md", checks: { items: [], blocking_codes: [], warning_codes: [], can_import: true }, target_tab: "note", expires_at: "2030-01-01T00:00:00.000Z" })
    },
    paperId: "Paper-01",
    category: "note",
    originalFileName: "local.md",
    markdown: "# note",
  })
  assert.equal(result.inspection_id, "i-1")
  assert.deepEqual(calls, [["/api/v1/notes/inspect", {
    paper_id: "Paper-01", category: "note", original_file_name: "local.md", markdown: "# note",
  }]])
  assert.equal(JSON.stringify(calls).includes("path"), false)
})

test("file decoding rejects invalid UTF-8 before inspection", async () => {
  const file = { name: "bad.md", arrayBuffer: async () => Uint8Array.from([0xff]).buffer }
  await assert.rejects(() => decodeUtf8MarkdownFile(file), /UTF-8/u)
})
```

- [ ] **Step 3: 运行 RED（2–5 分钟）**

Run: `node --test --test-name-pattern='note-import dialog|local API client|invalidating|UTF-8' prototype/desktop/paper-library-dom.test.mjs`

Expected: exit 1；至少一个匹配测试失败，首个失败为模板缺少 `library-add-note` 或 `createRetryableLoader(...).invalidate is not a function`。

- [ ] **Step 4: 加入固定对话框结构（2–5 分钟）**

在 reader toolbar trailing 内加入默认 disabled 的入口、帮助和刷新状态：

```html
<button class="text-button library-add-note" id="library-add-note" type="button" disabled>添加笔记</button>
<span class="library-note-import-help" id="library-note-import-help">需使用本地论文库服务启动</span>
<span class="library-index-reload-status" data-index-reload-status role="status" aria-live="polite" hidden>
  笔记已导入，但索引刷新失败。
  <button class="text-button" id="library-index-reload" type="button">重新载入索引</button>
</span>
```

在图片 lightbox 前加入完整 native dialog；七个 option 的 value 与 Task 2 精确一致：

```html
<dialog class="library-note-import-dialog" id="library-note-import-dialog" aria-labelledby="library-note-import-title">
  <form class="library-note-import-shell" id="library-note-import-form">
    <header class="library-note-import-heading">
      <div><p class="eyebrow">本地材料</p><h2 id="library-note-import-title">添加 Markdown 笔记</h2></div>
      <button class="text-button" id="library-note-import-close" type="button" aria-label="关闭添加笔记对话框">关闭</button>
    </header>
    <div class="library-note-import-body">
      <p>当前论文 ID：<code data-note-import-paper-id></code></p>
      <label>材料类型<select id="library-note-import-category" required>
        <option value="note">论文精读</option><option value="derivation">推导过程</option>
        <option value="source_map">来源映射</option><option value="modeling">建模复盘</option>
        <option value="simulation">仿真描述</option><option value="code_compare">代码对照</option>
        <option value="reproduction_report">复现报告</option>
      </select></label>
      <label>Markdown 文件<input id="library-note-import-file" type="file" accept=".md,.markdown,text/markdown" required></label>
      <section aria-labelledby="library-note-import-checks-title"><h3 id="library-note-import-checks-title">格式检查</h3><ul id="library-note-import-checks"></ul></section>
      <label>保存名<input id="library-note-import-file-name" type="text" autocomplete="off" spellcheck="false" required></label>
      <p>同名文件不会覆盖；服务会自动使用 <code>_v2</code>、<code>_v3</code> 递增名称。</p>
      <p data-note-import-status role="status" aria-live="polite"></p>
    </div>
    <footer class="library-note-import-actions">
      <button class="text-button" id="library-note-import-cancel" type="button">取消</button>
      <button class="button primary" id="library-note-import-submit" type="submit" disabled>导入并重建论文库</button>
    </footer>
  </form>
</dialog>
```

- [ ] **Step 5: 实现页面级居中与内部滚动 CSS（2–5 分钟）**

```css
.paper-library-page .library-note-import-dialog {
  width: min(720px, calc(100vw - 64px));
  max-width: 720px;
  max-height: min(86vh, 760px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.9);
  border-radius: 18px;
  background: rgba(250,252,255,.98);
  color: var(--ink);
  box-shadow: 0 34px 100px rgba(26,41,62,.3);
}
.paper-library-page .library-note-import-dialog::backdrop { background: rgba(30,44,63,.28); backdrop-filter: blur(8px); }
.paper-library-page .library-note-import-shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: min(86vh, 760px); }
.paper-library-page .library-note-import-heading,
.paper-library-page .library-note-import-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; }
.paper-library-page .library-note-import-body { display: grid; gap: 14px; min-width: 0; padding: 4px 20px 18px; overflow-y: auto; overflow-x: hidden; }
.paper-library-page .library-note-import-actions { justify-content: flex-end; border-top: 1px solid var(--line); }
.paper-library-page .library-reader-toolbar-trailing { min-width: 0; flex-wrap: wrap; }
.paper-library-page #library-add-note,
.paper-library-page #library-index-reload { white-space: nowrap; }
@media (max-width: 1320px) {
  .paper-library-page .library-note-import-dialog { width: min(680px, calc(100vw - 40px)); max-height: calc(100vh - 32px); }
  .paper-library-page .library-note-import-shell { max-height: calc(100vh - 32px); }
}
```

检查项必须有 `data-check-severity="pass|warning|blocking"` 的非纯颜色样式，并显示“通过/提醒/阻止”文字。所有 selector 以 `.paper-library-page` 限定，不能复用全局 `.search-dialog`。

- [ ] **Step 6: 实现严格 API 客户端与 fatal 文件解码（2–5 分钟）**

所有写请求固定使用相对 API URL、`Content-Type: application/json`、`cache: "no-store"`、`credentials: "same-origin"`；失败解析 `{ error: { code, message, file_name? } }` 为只含这些安全字段的 `LocalLibraryApiError`，不保留 response body。

```js
export async function decodeUtf8MarkdownFile(file) {
  if (!file || !/\.(?:md|markdown)$/iu.test(file.name ?? "")) throw new Error("请选择 Markdown 文件")
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("Markdown 文件不是有效 UTF-8")
  }
}

export function inspectLocalMarkdownNote({ fetchImpl = globalThis.fetch, paperId, category, originalFileName, markdown }) {
  return requestLocalJson(fetchImpl, "/api/v1/notes/inspect", {
    paper_id: paperId,
    category,
    original_file_name: originalFileName,
    markdown,
  }, validateInspectionResponse)
}

export function importLocalMarkdownNote({ fetchImpl = globalThis.fetch, inspectionId, requestedFileName }) {
  return requestLocalJson(fetchImpl, "/api/v1/notes/import", {
    inspection_id: inspectionId,
    requested_file_name: requestedFileName,
    conflict_policy: "version",
  }, validateImportResponse)
}
```

capabilities validator 要求 `api_version === 1`、两个布尔能力、categories 恰好七项且每项精确 `{ value, label, target_tab }`。inspection validator 要求精确五字段与 `checks = { items, blocking_codes, warning_codes, can_import }`；每个 item 精确 `{ code, severity, message }`。import validator 要求 Task 3 的五字段、`paper_id` 合法、`actual_file_name` 是基名、目标页签属于现有四个材料页签、预览 URL 符合现有受控 URL validator、`index_version` 为 64 位小写哈希。source-path validator 是唯一允许绝对路径值的客户端函数，返回后不得缓存。

capabilities 和 source-path 的实际客户端入口固定为：

```js
export async function loadLocalLibraryCapabilities(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/v1/capabilities", {
    cache: "no-store",
    credentials: "same-origin",
  })
  return parseLocalJsonResponse(response, validateCapabilitiesResponse)
}

export async function loadPrivateSourcePath({ fetchImpl = globalThis.fetch, paperId }) {
  const result = await requestLocalJson(
    fetchImpl,
    "/api/v1/papers/source-path",
    { paper_id: paperId },
    validateSourcePathResponse,
  )
  return result.source_path
}
```

- [ ] **Step 7: 实现 generation-safe loader 失效（2–5 分钟）**

```js
export function createRetryableLoader(load) {
  let state = "idle"
  let value = null
  let inFlight = null
  let generation = 0
  function invalidate() {
    generation += 1
    state = "idle"
    value = null
    inFlight = null
  }
  function run() {
    if (state === "ready") return Promise.resolve({ ok: true, value })
    if (inFlight) return inFlight
    const token = generation
    state = "loading"
    const operation = Promise.resolve().then(load).then((loaded) => {
      if (token !== generation) return { ok: false, value: null }
      value = loaded
      state = "ready"
      return { ok: true, value }
    }).catch(() => {
      if (token === generation) { value = null; state = "error" }
      return { ok: false, value: null }
    }).finally(() => { if (token === generation && inFlight === operation) inFlight = null })
    inFlight = operation
    return operation
  }
  return { getState: () => state, invalidate, run }
}
```

- [ ] **Step 8: 接入能力降级与 source-path API（2–5 分钟）**

`start()` 并行运行首次 index load 和 capability probe；capability 失败转换为 `null`，不得令 index load 失败。模板入口默认 disabled；只有 `note_import === true` 才启用添加按钮并隐藏帮助。`renderInspector` 用 `sourcePathAvailable` 设置复制按钮 `disabled` 与 title“需使用本地论文库服务启动”。

删除 `PRIVATE_AUDIT_URL`。`copyPrivatePath` 改为 `await loadPrivateSourcePath({ fetchImpl, paperId })`，并将返回值直接传给 `navigator.clipboard.writeText(sourcePath)`；finally 置局部变量为 null。禁止把 sourcePath 写入 status、dataset、title、console 或 storage。现有 `createPrivatePathCopyGuard` 继续阻止选择切换后的旧响应写状态。

- [ ] **Step 9: 运行 GREEN（2–5 分钟）**

Run: `node --test --test-name-pattern='note-import dialog|local API client|invalidating|UTF-8|copy-private-path' prototype/desktop/paper-library-dom.test.mjs`

Expected: exit 0；所有匹配子测试通过，0 failed；未匹配项 skipped。

Run: `node --check prototype/desktop/library.mjs prototype/desktop/paper-inspector.mjs`

Expected: 两个命令均 exit 0，无语法输出。

- [ ] **Step 10: 独立 commit 步骤（2–5 分钟）**

```bash
git add prototype/desktop/library.template.html prototype/desktop/styles.css prototype/desktop/library.mjs prototype/desktop/paper-inspector.mjs prototype/desktop/paper-library-dom.test.mjs
git commit -m "feat(paper-library): add local note import dialog shell"
```

Expected: commit 只包含模板、页面级样式、严格 API 客户端和静态降级，不包含生成后的 `library.html`。

---

### Task 6: 完成对话框状态机、导入后索引刷新与材料定位

**Files:**
- Modify: `prototype/desktop/library.mjs:1154-1910`
- Modify: `prototype/desktop/paper-library-dom.test.mjs:40-260,1850-2280`

**Interfaces:**
- Produces: `findImportedPreviewSelection({ paper, targetTab, previewUrl, fileName }): string | null`，返回现有材料 selector 使用的 `selectionKey`。
- Extends: `createLibraryController(...).start()`；控制器仍只公开 `{ start }`，事件继续 import-safe 且只绑定一次。
- Internal state contract: `localCapabilities`, `noteImportBusy`, `noteInspection`, `noteInspectGeneration`, `pendingImportedResult`, `indexRefreshFailed`。
- Preserves: `detailPaperId`, `detailOpen`, `readerTocExpanded`,现有 filters/sort/storage 和四个 preview coordinator。

- [ ] **Step 1: 扩充 fake dialog 并写焦点/取消 RED 测试（2–5 分钟）**

给测试 `MemoryNode` 精确增加 `open = false`、`showModal(){ this.open = true }`、`close(){ if (!this.open) return; this.open = false; this.dispatch("close") }`、`isConnected = true`；document keydown dispatch 必须支持 `preventDefault` 计数。

测试流程：打开详情→点击添加笔记→dialog open 且焦点 category；点击取消或非忙 Esc 只关闭 dialog、不退出详情、焦点回添加按钮；导入中 close/cancel/Esc 均不关闭；成功 close 后仍在详情。

```js
ui.addNote.click()
assert.equal(ui.noteDialog.open, true)
assert.equal(ui.document.activeElement, ui.noteCategory)
ui.noteDialog.dispatch("cancel")
assert.equal(ui.noteDialog.open, false)
assert.equal(ui.detail.hidden, false)
assert.equal(ui.document.activeElement, ui.addNote)
```

- [ ] **Step 2: 写检查与忙碌重试 RED 测试（2–5 分钟）**

固定验证：重选文件或切 category 时旧 inspect 响应不渲染；checks 用 textContent 逐项创建；blocking 时 submit disabled；warning 时可导入；`IMPORT_BUSY` 保留 inspection id/filename/dialog，解除 busy 后同 token 再提交；其他 import 错误清空 inspection 并要求重新检查。

测试必须检查 DOM 中没有 `source_path`、原文件浏览器路径、API 原始错误 body；服务返回的 `file_name` 只以 basename 显示。

- [ ] **Step 3: 写索引刷新与失败降级 RED 测试（2–5 分钟）**

```js
test("successful import refetches the index and selects the new controlled preview", async () => {
  const selection = findImportedPreviewSelection({
    paper: normalizedPaper({ controlled_preview_documents: previewCatalog({
      source_map: [{ label: "Paper-01_source_map.md", url: hashedPreview("paper-01", "source_map", "b"), size_bytes: 10, is_default: false }],
    }) }),
    targetTab: "derivation",
    previewUrl: hashedPreview("paper-01", "source_map", "b"),
    fileName: "Paper-01_source_map.md",
  })
  assert.equal(selection, "source_map:0")
})
```

控制器集成测试让首次 index 成功、import 成功、第二次 index 返回带新增项；断言 index fetch 恰好 2 次，保留同 paper/detail/TOC，active tab 为 response target，select.value 为 `source_map:0`。另一个测试令第二次 index 失败：旧 paper rows 与当前内容不清空，全页 `library-error` 不出现，dialog 已关闭，`#library-index-reload` 可见；按钮第三次获取成功后隐藏状态并定位新增材料。

- [ ] **Step 4: 运行 RED（2–5 分钟）**

Run: `node --test --test-name-pattern='note dialog focus|stale note inspection|IMPORT_BUSY|successful import refetches|index reload' prototype/desktop/paper-library-dom.test.mjs`

Expected: exit 1；匹配测试因 `findImportedPreviewSelection` 未导出或入口事件未绑定而失败。

- [ ] **Step 5: 实现材料定位和安全 check 渲染（2–5 分钟）**

```js
export function findImportedPreviewSelection({ paper, targetTab, previewUrl, fileName }) {
  const matches = controlledPreviewDocumentsForReaderTab(paper, targetTab).filter((document) => (
    document.url === previewUrl && document.label === fileName
  ))
  return matches.length === 1 ? matches[0].selectionKey : null
}

function renderNoteImportChecks(document, mount, checks) {
  const fragment = document.createDocumentFragment()
  for (const check of checks.items) {
    const item = document.createElement("li")
    item.dataset.checkSeverity = check.severity
    const prefix = check.severity === "blocking" ? "阻止" : check.severity === "warning" ? "提醒" : "通过"
    item.textContent = `${prefix}：${check.message}`
    fragment.append(item)
  }
  mount.replaceChildren(fragment)
}
```

不使用 `innerHTML`。`noteInspection` 只保留公开 token、建议名、checks、target tab、expiry，不保留 Markdown；Markdown 只在 file change handler 的局部变量中用于 inspect request，结束后置空。

- [ ] **Step 6: 实现打开、检查和 busy 状态（2–5 分钟）**

打开前确认当前详情 paper 与 capability；清空 file/check/status，填只读 paper ID，将 category 设为 `note`，`showModal()` 后 focus category。file change 与 category change 都递增 `noteInspectGeneration`；file handler 使用 `decodeUtf8MarkdownFile`，记录 generation，等待 API 后只有 generation/current paper/category/file name 全匹配才写 UI。

`setNoteImportBusy(true)` 必须禁用 category、file、filename、close、cancel、submit。dialog `cancel` listener 在 busy 时 `preventDefault()`；全局 keydown 的第一分支改为：

```js
if (ui.noteImportDialog?.open) {
  if (noteImportBusy && event.key === "Escape") event.preventDefault()
  return
}
```

从而 Esc 不会继续执行详情返回。dialog `close` 事件清空公开检查状态并仅在 trigger `isConnected` 时 focus 添加按钮。

- [ ] **Step 7: 实现 import 提交、忙碌重试与成功关闭（2–5 分钟）**

submit 必须验证 `noteInspection.checks.can_import`、当前 paper 与 generation，再调用 import。`IMPORT_BUSY` 只显示“正在重建，请稍后重试”，恢复 controls 并保留 token。其他失败清空 token、禁用 submit、显示固定 API message；用户需要重选或切 category 触发新 inspect。

成功时先保存 response 为局部 `importResult`，清空 token，关闭 dialog，设置 `activeReaderTab = importResult.target_tab`，再调用 `refreshIndexAfterImport(importResult)`。不把 import result 写 storage。

- [ ] **Step 8: 实现保留旧内容的真实刷新（2–5 分钟）**

`refreshIndexAfterImport` 先 `closeAllPreviews()` 和 `indexLoader.invalidate()`，但不清空 `papers/facetSchema/warningCount`。等待 `indexLoader.run()`；失败时设置 `pendingImportedResult`、`indexRefreshFailed = true`、保持 `loadState` 原值并 render。成功时先在局部变量验证 paper 仍存在，再一次性替换三个 index 字段，保持 `detailOpen = true`、`detailPaperId = result.paper_id`、`readerTocExpanded` 不变，设置目标 tab，并通过 `findImportedPreviewSelection` 写对应 `readerMaterialSelection[target_tab]`。

找不到唯一新增项时按刷新失败处理：不替换旧 index，显示重新载入，不能伪装为导入失败。reload button 使用同一 `pendingImportedResult` 再运行上述刷新；成功后清空 pending/status。

- [ ] **Step 9: 运行 GREEN 与全 DOM 回归（2–5 分钟）**

Run: `node --test --test-name-pattern='note dialog focus|stale note inspection|IMPORT_BUSY|successful import refetches|index reload' prototype/desktop/paper-library-dom.test.mjs`

Expected: exit 0；所有匹配子测试通过，0 failed。

Run: `node --test prototype/desktop/paper-library-dom.test.mjs`

Expected: exit 0；该文件报告的全部顶层与嵌套测试通过，0 failed；不得用固定历史总数替代实际输出。

- [ ] **Step 10: 独立 commit 步骤（2–5 分钟）**

```bash
git add prototype/desktop/library.mjs prototype/desktop/paper-library-dom.test.mjs
git commit -m "feat(paper-library): complete note import workflow"
```

Expected: commit 不改动存储版本，不包含任何用户选择的 Markdown 内容。

---

### Task 7: 完成真实重建集成、浏览器验收、文档与固定发布边界

**Files:**
- Modify: `exporter/verification/private_library_e2e.py:1-180,2260-2395`
- Modify: `README.md:1-50,86-100`
- Modify: `prototype/desktop/README.md:1-40`
- Modify: `exporter/paper-library/package-audit.mjs:15-80`
- Modify: `exporter/paper-library/package-audit.test.mjs:25-100,150-180`
- Modify: `exporter/config/github-package-files.json:3-90`

**Interfaces:**
- Re-verifies: Task 4 的真实临时仓库 `inspect → import → buildPrivateLibrary → paper-index → hashed preview` 路径。
- Extends browser acceptance: 4176 Node 主服务、模拟 capability 不可用时的静态降级、同源 import dialog 行为、source-path API privacy、1280×720 and 1440×900 dialog layout。
- Documents: writable Node 4176 service replaces Python as primary preview; Python may reuse 4176 only as a separately started read-only fallback。
- Publishes only source/tests/docs: adds `runtime*`, `note-import*`, `local-server*`, `serve-private-library.mjs`; never adds private config, generated data/output, source notes or screenshots。

- [ ] **Step 1: 重跑真实临时仓库集成门（2–5 分钟）**

Task 4 已在生产代码前加入真实集成测试。先单独重跑并核对响应、源文件、索引和预览四层：

```js
assert.equal(importResponse.paper_id, "Paper-01")
assert.equal(importResponse.actual_file_name, "Paper-01_论文精读.md")
assert.match(importResponse.new_preview_url, /^\.\.\/\.\.\/local_library_data\/notes\/paper-01\/note\/[a-f0-9]{64}\.html$/u)
assert.equal(await readFile(join(sourceRoot, "Paper", importResponse.actual_file_name), "utf8"), "# Imported note\n")
const index = JSON.parse(await readFile(join(repoRoot, "local_library_data/paper-index.json"), "utf8"))
assert.equal(index.papers[0].controlled_preview_documents.note[0].label, importResponse.actual_file_name)
const preview = await fetch(new URL(importResponse.new_preview_url.replace("../../", "/"), origin))
assert.equal(preview.status, 200)
assert.match(await preview.text(), /<h1>Imported note<\/h1>/u)
```

测试只能操作临时路径；不得读取真实 `local_library_config` 或写真实 source。

- [ ] **Step 2: 确认真实集成仍为 GREEN（2–5 分钟）**

Run: `node --test --test-name-pattern='real temporary repository' exporter/paper-library/local-server.test.mjs`

Expected: exit 0；1 matched test passed，0 failed；其余测试 skipped；临时目录由 `t.after` 删除。

- [ ] **Step 3: 扩展 Playwright 验收而不写真实论文（2–5 分钟）**

保留唯一 origin `127.0.0.1:4176`。主流程连接 Node 服务，capabilities 必须为 200。另建一个 browser context，用 `page.route("**/api/v1/capabilities", route => route.fulfill({ status: 404, body: "" }))` 模拟只读 fallback；NetworkGuard 只在该 context 把这一项识别为预期降级，其他 HTTP >=400 仍失败。降级 context 断言添加笔记与复制路径 disabled、说明可见，浏览/筛选/PDF/OCR/旧预览仍可用且 audit 请求始终为 0。

为 dialog 交互使用 `page.route("**/api/v1/**", handler)` 提供内存响应，不触发真实写入：capabilities 200、inspect 200、第一次 import 409 `IMPORT_BUSY`、第二次 import 200、随后 paper-index route 返回加入新 preview 的结构化副本。断言焦点、Esc、取消、busy 禁用、成功目标 tab、材料 selection 和刷新失败 reload。source-path mock 返回测试绝对路径，只验证 clipboard 非空；页面 text、HTML、localStorage 和 console 不得包含该路径。

在两个 viewport 打开 dialog 并计算：

```python
metrics = page.locator("#library-note-import-dialog").evaluate("""dialog => ({
  left: dialog.getBoundingClientRect().left,
  right: dialog.getBoundingClientRect().right,
  top: dialog.getBoundingClientRect().top,
  bottom: dialog.getBoundingClientRect().bottom,
  viewportWidth: innerWidth,
  viewportHeight: innerHeight,
  bodyScrollWidth: document.documentElement.scrollWidth,
  actionsBottom: dialog.querySelector('.library-note-import-actions').getBoundingClientRect().bottom,
})""")
ensure(metrics["left"] >= 0 and metrics["right"] <= metrics["viewportWidth"], "note_dialog_horizontal_bounds")
ensure(metrics["top"] >= 0 and metrics["bottom"] <= metrics["viewportHeight"], "note_dialog_vertical_bounds")
ensure(metrics["actionsBottom"] <= metrics["bottom"], "note_dialog_actions_visible")
ensure(metrics["bodyScrollWidth"] <= metrics["viewportWidth"], "note_dialog_page_overflow")
```

保存 `output/playwright/paper-library-note-import-1280.png` 与 `paper-library-note-import-1440.png`；截图不进入 Git 清单。

- [ ] **Step 4: 更新启动文档（2–5 分钟）**

README 主流程改为：

```bash
node exporter/scripts/serve-private-library.mjs
```

打开 `http://127.0.0.1:4176/local_library_output/desktop/library.html`。明确说明：Node 服务取代 Python 临时预览作为主入口；服务先构建；导入只在选定论文单元中新建 Markdown、永不覆盖；失败按指纹回滚；服务只绑定回环；停止进程即使检查 token 失效。保留以下只读 fallback，且只能在 Node 服务停止后使用同一端口：

```bash
node exporter/scripts/build-private-library.mjs
python3 -m http.server 4176 --bind 127.0.0.1
```

静态模式必须写明浏览、筛选、PDF/OCR 和既有预览可用，“添加笔记”“复制原始路径”禁用。把“源论文目录始终只读”改为“默认扫描只读；用户明确确认导入时只排他新建一份 Markdown”。两个 README 的端口和差异必须一致。

- [ ] **Step 5: 先写固定发布清单并运行 RED（2–5 分钟）**

在 `package-audit.test.mjs` 的 `EXPECTED_FILES` 加入并按字典序排列：

```text
exporter/paper-library/local-server.mjs
exporter/paper-library/local-server.test.mjs
exporter/paper-library/note-import.mjs
exporter/paper-library/note-import.test.mjs
exporter/paper-library/note-import-transaction.test.mjs
exporter/paper-library/runtime.mjs
exporter/paper-library/runtime.test.mjs
exporter/scripts/serve-private-library.mjs
```

Run: `node --test --test-name-pattern='exact package policy' exporter/paper-library/package-audit.test.mjs`

Expected: exit 1；`EXPECTED_PACKAGE_FILES` 或 manifest 与新期望数组不一致；不得通过删除期望项使测试变绿。

- [ ] **Step 6: 同步三份精确清单并运行 GREEN（2–5 分钟）**

把同一字典序集合写入 `package-audit.mjs`、`package-audit.test.mjs`、`github-package-files.json`。该集合必须是三个先行计划新增程序/测试的并集：既保留 `paper-user-tags.*` 与 facet migration/schema 测试，又加入本计划的 runtime/import/server 文件；增加 `assert.deepEqual(files, [...files].sort())` 和三份清单完全相等断言，防止后执行的计划覆盖先前条目。再加一项审计测试，候选中出现 `local_library_config/library.local.json`、`local_library_data/paper-index.json`、`local_library_output/desktop/library.html`、`Paper-01_论文精读.md` 任一项都被 fixed policy 拒绝。

Run: `node --test exporter/paper-library/package-audit.test.mjs`

Expected: exit 0；该文件全部测试通过，0 failed。

Run: `node exporter/scripts/audit-github-package.mjs`

Expected: exit 0，输出固定候选文件全部通过；输出不含绝对本机路径。

- [ ] **Step 7: 完整自动验证（2–5 分钟一个命令）**

Run: `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`

Expected: exit 0；实际发现的全部测试通过，0 failed；不得以计划中的历史数量覆盖实际结果。

Run: `node --check exporter/paper-library/*.mjs exporter/scripts/*.mjs prototype/desktop/*.mjs`

Expected: exit 0，无语法错误。

Run: `python3 -m py_compile exporter/verification/private_library_e2e.py`

Expected: exit 0，不生成被 Git 跟踪的文件。

Run after starting the Node 4176 service: `python3 exporter/verification/private_library_e2e.py`

Expected: 1280×720 与 1440×900 均输出“通过”；控制台、页面异常、非预期失败请求、HTTP>=400、路径泄漏和页面级横向溢出均为 0。

- [ ] **Step 8: 手工安全核对（2–5 分钟）**

```bash
rg -n '/Users/|file://|local_library_config|paper-library-audit|source_path' \
  local_library_data/paper-index.json local_library_output/desktop/library.html
git status --short
```

Expected: 第一条无匹配且 exit 1；第二条只列本计划预期的程序、测试、模板、样式和文档文件，不列真实配置、源 Markdown、生成目录或截图。

- [ ] **Step 9: 独立 commit 步骤（2–5 分钟）**

```bash
git add exporter/verification/private_library_e2e.py README.md prototype/desktop/README.md exporter/paper-library/package-audit.mjs exporter/paper-library/package-audit.test.mjs exporter/config/github-package-files.json
git commit -m "test(paper-library): verify local note import end to end"
```

Expected: `git show --name-only --format= HEAD` 只列上述六个文件；真实笔记、配置、生成物和 screenshots 不在 commit。

---

## Completion Review

- [ ] **Spec coverage:** 用下列命令逐项确认计划显式覆盖 runtime、七类、inspect/import/source-path/capabilities、10 分钟 token、单写锁、忙碌不消费、取得锁即消费、版本命名、`O_EXCL|O_NOFOLLOW`、指纹回滚、重建、缓存失效、刷新失败、静态降级、焦点/Esc、两种 viewport 与发布边界：

  ```bash
  rg -n 'runtime|七类|capabilities|source-path|十分钟|单写锁|IMPORT_BUSY|O_EXCL|O_NOFOLLOW|指纹|回滚|重建|invalidate|重新载入索引|静态模式|焦点|Escape|1280|1440|package' docs/superpowers/plans/2026-08-30-paper-library-note-import.md
  ```

  Expected: 每个关键词至少一处命中；`inspect`、`import` 和 `source-path` 各有接口、测试与实现步骤。

- [ ] **Placeholder scan:**

  ```bash
  sed '/^## Completion Review/,$d' docs/superpowers/plans/2026-08-30-paper-library-note-import.md \
    | rg -n 'TODO|TBD|FIXME|XXX|similar to|类似处理|适当处理|其余同理|省略'
  ```

  Expected: 无匹配，exit 1。代码里的 spread syntax 是真实 JavaScript，不视为占位符。

- [ ] **Interface consistency:**

  ```bash
  rg -n 'actual_file_name|new_preview_url|index_version|suggested_file_name|target_tab|inspection_id|checks|source_path' docs/superpowers/plans/2026-08-30-paper-library-note-import.md
  ```

  Expected: server、客户端、控制器和测试统一使用这些 snake_case 字段；不得同时出现 `file_name` 作为成功字段或 `preview_url` 作为成功字段。

- [ ] **File boundary:**

  ```bash
  git diff --name-only -- docs/superpowers/plans/2026-08-30-paper-library-note-import.md
  git status --short -- docs/superpowers/plans/2026-08-30-paper-library-note-import.md
  ```

  Expected for this planning turn: 计划文件是本任务唯一新增/修改文件；不执行任何 commit。
