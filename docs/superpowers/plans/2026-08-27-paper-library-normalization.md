# 论文库统一目录与笔记整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `1.目录.md` 和现有论文材料生成统一、稳定、可浏览的 48 条本地论文记录，并安全清理 Deng 错配附件、排除连续时间论文。

**Architecture:** 新增一个只读 catalog adapter，将目录中的显式书目信息按 PDF/OCR 精确相对路径匹配到现有扫描单元。扫描器按 `人工 override > catalog > frontmatter > 适配默认` 合并记录，显式计算笔记状态与排除审计；页面只消费生成的规范 JSON。

**Tech Stack:** Node.js ESM、`node:test`、现有静态 HTML/CSS/JavaScript 构建器、macOS 本地文件系统。

**Spec:** `docs/superpowers/specs/2026-08-27-paper-library-normalization-design.md`

## Global Constraints

- 不安装 npm 或 Python 依赖。
- 不批量改写、重命名或移动旧笔记。
- `1.目录.md` 和论文源目录只读；唯一例外是把用户已确认的 Deng 错配附件移动到 macOS 废纸篓。
- 连续时间论文只按精确路径显式排除，不按标题、标签或正文关键词自动过滤。
- `paper-index.json` 和 `paper-catalog.json` 是可删除、可重建的私有构建产物，不是新的事实来源。
- PDF、OCR、全文翻译、绝对路径和私人笔记不得进入公开 Quartz 或 GitHub 打包结果。
- 不从修改时间、正文或文件夹顺序猜测学术事实。
- 原文件夹层级只用于物理定位和溯源，不得自动成为网页分类、方向或标签；本轮不删除或迁移原文件夹。
- 所有行为变更先写失败测试并确认预期失败，再写最小实现。
- 本轮不创建分支、不提交 Git、不发布网站。

---

### Task 1: 目录文件适配器与本机配置

**Files:**
- Create: `exporter/paper-library/catalog-adapter.mjs`
- Create: `exporter/paper-library/catalog-adapter.test.mjs`
- Modify: `exporter/paper-library/config.mjs`
- Modify: `exporter/paper-library/config.test.mjs`

**Interfaces:**
- Produces: `parsePaperCatalog(markdown, { sourceId }) -> { version: 1, papers: Record<string, CatalogRecord>, warnings: string[] }`
- Produces: `loadPaperCatalog(catalogPath, { sourceId }) -> Promise<Catalog>`
- Produces: `loadLibraryConfig()` returns each source as `{ source_id, path, catalog_path }`.
- `CatalogRecord` fields: `paper_id`, `title_original`, `authors`, `publication_year`, `year`, `venue`, `doi_or_url`, `metadata_provenance`.

- [ ] **Step 1: Write failing catalog parsing tests**

```js
test("parses one explicit catalog line by its PDF unit path", () => {
  const markdown = "- [x] [ ] **A Paper** — Liu H, Yu W — *Automatica*, 2024 — [DOI](https://doi.org/10.1/example) — `Liu24-AP` `离散时间` 📎 [PDF](<论文/02_topic/Liu (2024) A Paper/A Paper.pdf>)"
  const catalog = parsePaperCatalog(markdown, { sourceId: "main_papers" })
  assert.deepEqual(catalog.papers["main_papers::02_topic/Liu (2024) A Paper"], {
    paper_id: "Liu24-AP",
    title_original: "A Paper",
    authors: ["Liu H", "Yu W"],
    publication_year: 2024,
    year: 2024,
    venue: "Automatica",
    doi_or_url: "https://doi.org/10.1/example",
    metadata_provenance: {
      paper_id: "catalog", title_original: "catalog", authors: "catalog",
      publication_year: "catalog", year: "catalog", venue: "catalog", doi_or_url: "catalog",
    },
  })
})

test("rejects duplicate unit paths instead of fuzzy-merging titles", () => {
  const line = "- [x] [ ] **A Paper** — Liu H — *Venue*, 2024 — `Liu24-AP` 📎 [PDF](<论文/topic/unit/paper.pdf>)"
  assert.throws(() => parsePaperCatalog(`${line}\n${line}`, { sourceId: "main_papers" }), /目录路径重复/)
})
```

- [ ] **Step 2: Run catalog tests and verify RED**

Run: `node --test exporter/paper-library/catalog-adapter.test.mjs`

Expected: FAIL because `catalog-adapter.mjs` does not exist.

- [ ] **Step 3: Implement strict line and link parsing**

```js
export function parsePaperCatalog(markdown, { sourceId }) {
  const papers = {}
  const warnings = []
  for (const [index, line] of String(markdown).split(/\r?\n/).entries()) {
    if (!line.startsWith("- [") || !line.includes("📎")) continue
    const record = parseCatalogLine(line, { sourceId, lineNumber: index + 1 })
    if (!record) { warnings.push(`catalog_line_unmatched:${index + 1}`); continue }
    if (papers[record.key]) throw new Error(`目录路径重复: ${record.key}`)
    papers[record.key] = Object.freeze(record.metadata)
  }
  return Object.freeze({ version: 1, papers: Object.freeze(papers), warnings: Object.freeze(warnings) })
}
```

Implementation requirements:

- support both `[PDF](<论文/.../file.pdf>)` and `[[论文/.../file.pdf|PDF]]`;
- remove only the leading `论文/`, then use the PDF parent directory as the unit key;
- reject absolute links, `..`, malformed source IDs and duplicate paths;
- accept only a canonical first short code matching `^[A-Za-z][A-Za-z]*\d{2}-[A-Za-z0-9-]+$`;
- keep the catalog title language-neutral as `title_original`;
- preserve author order; split only the explicit author segment;
- keep unmatched non-paper prose as warnings, never as records.

- [ ] **Step 4: Add optional `catalog_path` config with failure tests first**

```js
test("loads an absolute catalog_path beside a source", async () => {
  // write config with catalog_path: join(root, "1.目录.md")
  const config = await loadLibraryConfig(configPath)
  assert.equal(config.sources[0].catalog_path, join(root, "1.目录.md"))
})

test("rejects a relative catalog_path", async () => {
  await assert.rejects(() => loadLibraryConfig(configPath), /catalog_path 必须是绝对路径/)
})
```

Run RED then GREEN: `node --test exporter/paper-library/config.test.mjs exporter/paper-library/catalog-adapter.test.mjs`

- [ ] **Step 5: Record task evidence without Git**

Write the RED command/output, GREEN command/output, changed files and self-review to the task report in this plan's SDD workspace. Do not run `git add` or `git commit`.

---

### Task 2: Catalog 合并、稳定身份与字段来源

**Files:**
- Modify: `exporter/paper-library/frontmatter.mjs`
- Create: `exporter/paper-library/frontmatter.test.mjs`
- Modify: `exporter/paper-library/overrides.mjs`
- Modify: `exporter/paper-library/overrides.test.mjs`
- Modify: `exporter/paper-library/status.mjs`
- Modify: `exporter/paper-library/status.test.mjs`
- Modify: `exporter/paper-library/scanner.mjs`
- Modify: `exporter/paper-library/scanner.test.mjs`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`

**Interfaces:**
- Consumes: Task 1 `Catalog` keyed by `source_id::relative_path`.
- Changes: `scanPaperSources({ config, overrides, catalogs })`.
- Changes: `mergePaperRecord({ adapted, explicit, catalog, override })`.
- Produces: generated records with `title_original`, `publication_year`, `version_date`, `metadata_provenance`, and `identity_source: "catalog" | "override" | "frontmatter" | "note_shortcode" | "path_hash"`.

- [ ] **Step 1: Write failing neutral-title and priority tests**

```js
test("generic frontmatter title remains language neutral", () => {
  const parsed = parsePaperFrontmatter("---\ntitle: 中文标题\nyear: 2024\n---\n")
  assert.equal(parsed.data.title_original, "中文标题")
  assert.equal(parsed.data.title_en, undefined)
})

test("merge priority is override then catalog then frontmatter then adapted", () => {
  const paper = mergePaperRecord({
    adapted: { title_original: "adapted" },
    explicit: { title_original: "frontmatter" },
    catalog: { title_original: "catalog", year: 2024 },
    override: { title_original: "override" },
  })
  assert.equal(paper.title_original, "override")
  assert.equal(paper.year, 2024)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test exporter/paper-library/frontmatter.test.mjs exporter/paper-library/status.test.mjs`

Expected failures: `title_original` is absent and `mergePaperRecord` ignores `catalog`.

- [ ] **Step 3: Implement neutral title, catalog priority and provenance**

```js
function pick(field, adapted, explicit, catalog, override, fallback) {
  for (const source of [override, catalog, explicit, adapted]) {
    const value = ownValue(source, field)
    if (value !== undefined) return value
  }
  return fallback
}
```

Add `title_original: ""`, `publication_year: null`, `version_date: null`, and `metadata_provenance: {}` to fixed record defaults and validation. Retain `year` and current `artifacts` as compatibility fields used by the existing desktop page.

Extend override validation for `title_original`, `publication_year`, `version_date` and `metadata_provenance`; reject unknown provenance values and any provenance value outside `override | catalog | frontmatter | note_shortcode | adapter | default`. Extend the public fixed-field serializer and privacy validator for the new safe fields.

- [ ] **Step 4: Write failing scanner identity tests**

```js
test("catalog identity replaces a misleading hyphenated filename token", async () => {
  await put(root, "Paper Unit/First-Order algorithm.pdf", "pdf")
  const catalogs = { main_papers: {
    version: 1,
    papers: { "main_papers::Paper Unit": {
      paper_id: "Shi15-EXTRA", title_original: "EXTRA", year: 2015,
      publication_year: 2015, authors: ["Shi W"], venue: "SIAM", doi_or_url: "",
      metadata_provenance: { paper_id: "catalog" },
    } }, warnings: [],
  } }
  const result = await scanPaperSources({ config, overrides, catalogs })
  assert.equal(result.papers[0].paper_id, "Shi15-EXTRA")
  assert.equal(result.papers[0].identity_source, "catalog")
})

test("an arbitrary hyphenated filename never becomes paper_id", async () => {
  await put(root, "Paper Unit/First-Order algorithm.pdf", "pdf")
  const result = await scanPaperSources({ config, overrides, catalogs: {} })
  assert.match(result.papers[0].paper_id, /^LIB-[A-F0-9]{12}$/)
})

test("folder hierarchy never becomes semantic classification", async () => {
  await put(root, "02_约束分布式优化/耦合约束/Unit/paper.pdf", "pdf")
  const result = await scanPaperSources({ config, overrides, catalogs: {} })
  assert.equal(result.papers[0].topic_l1, "")
  assert.equal(result.papers[0].topic_l2, "")
  assert.deepEqual(result.papers[0].research_scopes, [])
})
```

- [ ] **Step 5: Run scanner RED, implement canonical note-shortcode fallback, then GREEN**

Remove the broad `filenameShortCode()` search. Accept only a short code anchored at the start of a recognized note filename such as `Shi15-EXTRA_论文精读.md`; conflicting note short codes block instead of selecting the first.

Run: `node --test exporter/paper-library/scanner.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/frontmatter.test.mjs`

- [ ] **Step 6: Record task evidence without Git**

Append RED/GREEN outputs, interface changes and self-review to the task report. Do not commit.

---

### Task 3: 显式排除、笔记状态与全部受控预览

**Files:**
- Modify: `exporter/paper-library/overrides.mjs`
- Create: `exporter/paper-library/overrides.test.mjs`
- Modify: `exporter/paper-library/status.mjs`
- Modify: `exporter/paper-library/status.test.mjs`
- Modify: `exporter/paper-library/scanner.mjs`
- Modify: `exporter/paper-library/scanner.test.mjs`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`

**Interfaces:**
- Override fields: `include?: boolean`, `exclude_reason?: string`.
- Generated paper field: `note_status: "notes_ready" | "ocr_only" | "pdf_only" | "metadata_only"`.
- Private audit field: `excluded_units: Array<{ source_id, relative_path, reason }>`.
- Build behavior: every included paper with one resolved `preferred_note` receives a controlled preview URL.

- [ ] **Step 1: Write failing override validation tests**

```js
test("an exclusion requires a non-empty reason", () => {
  assert.throws(() => validatePaperOverride("main_papers::Paper A", { include: false }), /exclude_reason/)
  assert.doesNotThrow(() => validatePaperOverride("main_papers::Paper A", {
    include: false,
    exclude_reason: "continuous_time_out_of_scope",
  }))
})
```

- [ ] **Step 2: Verify RED, implement the two fields, verify GREEN**

Run: `node --test exporter/paper-library/overrides.test.mjs`

Unknown fields remain rejected; `exclude_reason` without `include: false` is rejected.

- [ ] **Step 3: Write failing exact-exclusion and note-status scanner tests**

```js
test("excludes only the exact configured unit and audits the reason", async () => {
  await put(root, "Continuous Paper/paper.pdf", "pdf")
  await put(root, "Continuous Mention/paper.pdf", "pdf")
  overrides.papers["main_papers::Continuous Paper"] = {
    include: false,
    exclude_reason: "continuous_time_out_of_scope",
  }
  const result = await scanPaperSources({ config, overrides, catalogs: {} })
  assert.deepEqual(result.papers.map((paper) => paper.relative_path), ["Continuous Mention"])
  assert.deepEqual(result.audit.excluded_units, [{
    source_id: "main_papers", relative_path: "Continuous Paper", reason: "continuous_time_out_of_scope",
  }])
})

test("classifies note, OCR and PDF-only units without upgrading evidence", async () => {
  // create three PDF units with a canonical note, matching OCR, or PDF only
  const result = await scanPaperSources({ config, overrides, catalogs })
  assert.deepEqual(result.papers.map((paper) => paper.note_status), ["notes_ready", "ocr_only", "pdf_only"])
  assert.ok(result.papers.every((paper) => paper.evidence_status === "none"))
})

test("does not classify translation logs or OCR bodies as reading notes", () => {
  assert.equal(classifyArtifact({ relativePath: "translation.log", siblingPdfStems: [] }), null)
  assert.equal(classifyArtifact({ relativePath: "Paper Title.md", siblingPdfStems: ["Paper Title"] }), "ocr")
  assert.equal(classifyArtifact({ relativePath: "Paper01_论文精读.md", siblingPdfStems: ["Paper Title"] }), "note")
})
```

- [ ] **Step 4: Implement exact exclusion, automatic preferred note and note status**

Selection rules must be: explicit override, unique `{paper_id}_论文精读.md`, unique recognized historical note, otherwise `null`. OCR and translations never qualify as a preferred note.

- [ ] **Step 5: Write failing multi-preview build test**

```js
test("builds one controlled preview for every resolved preferred note", async () => {
  // two units, each with a canonical short-code note and matching catalog ID
  const result = await buildPrivateLibrary(fixture)
  assert.equal(result.previewCount, 2)
  assert.equal(result.pageCount, 3)
})
```

- [ ] **Step 6: Remove the one-preview milestone cap and verify privacy**

Delete the `countPreviewApprovals()` limit and the post-loop `previews.length > 1` failure. Keep `readControlledNote()`, size limits, UTF-8 validation, Markdown sanitization and exact same-origin preview URLs unchanged.

Run: `node --test exporter/paper-library/overrides.test.mjs exporter/paper-library/scanner.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`

- [ ] **Step 7: Record task evidence without Git**

Append RED/GREEN outputs, privacy checks and self-review to the task report. Do not commit.

---

### Task 4: 中文笔记分组与桌面页面

**Files:**
- Modify: `prototype/desktop/paper-library-model.mjs`
- Modify: `prototype/desktop/paper-library-model.test.mjs`
- Modify: `prototype/desktop/library.mjs`
- Modify: `prototype/desktop/paper-library-dom.test.mjs`
- Modify: `prototype/desktop/library.template.html`
- Modify: `prototype/desktop/styles.css`

**Interfaces:**
- Produces: `groupRowsByNoteStatus(rows) -> Array<{ status, label, rows }>`.
- Fixed order: `notes_ready`, `ocr_only`, `pdf_only`, `metadata_only`.
- Chinese labels: `已有笔记`, `OCR 待精读`, `仅 PDF 待阅读`, `材料待补`.
- The desktop record boundary accepts and validates `title_original`, `publication_year`, `version_date`, `metadata_provenance` and `note_status`; display title priority is `title_zh > title_original > title_en`.

- [ ] **Step 1: Write failing model grouping test**

```js
test("groups papers by note status in writing-first order", () => {
  const groups = groupRowsByNoteStatus([
    { paper: { paper_id: "A-01", note_status: "pdf_only" } },
    { paper: { paper_id: "B-01", note_status: "notes_ready" } },
  ])
  assert.deepEqual(groups.map((group) => [group.status, group.label, group.rows.length]), [
    ["notes_ready", "已有笔记", 1],
    ["pdf_only", "仅 PDF 待阅读", 1],
  ])
})
```

- [ ] **Step 2: Verify RED, implement the pure grouping function, verify GREEN**

Run: `node --test prototype/desktop/paper-library-model.test.mjs`

- [ ] **Step 3: Write failing DOM test for headings and counts**

```js
test("renders Chinese note-status group headings with counts", () => {
  renderPaperRows({ document, rows, selectedPaperId: null })
  assert.deepEqual(
    [...document.querySelectorAll("[data-note-group-heading]")].map((node) => node.textContent),
    ["已有笔记 1", "仅 PDF 待阅读 1"],
  )
})
```

- [ ] **Step 4: Implement semantic groups without changing the three-column shell**

Render a heading before each non-empty group and keep each existing row button, ARIA label, selection behavior and detail action unchanged. Add scoped CSS under `.paper-library-page`; do not introduce global `header` or generic `section` selectors.

- [ ] **Step 5: Verify desktop behavior tests**

Run: `node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/paper-library-storage.test.mjs`

- [ ] **Step 6: Record task evidence without Git**

Append RED/GREEN outputs and keyboard/ARIA self-review to the task report. Do not commit.

---

### Task 5: 真实目录接入、可恢复清理、重建与验收

**Files:**
- Modify: `exporter/scripts/build-private-library.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/scanner.mjs`
- Modify: `exporter/paper-library/scanner.test.mjs`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/config/github-package-files.json`
- Modify: `local_library_config/library.local.json`
- Modify: `local_library_config/paper-overrides.json`
- Modify: `README.md`
- Create: `audits/2026-08-27-paper-library-cleanup.md`
- Generate: `local_library_data/paper-catalog.json`
- Generate: `local_library_data/paper-index.json`
- Generate: `local_library_data/paper-library-audit.json`
- Generate: `local_library_output/desktop/library.html`

**Interfaces:**
- CLI loads every source's `catalog_path`, passes `catalogs` to `buildPrivateLibrary`, and prints record/preview/exclusion counts.
- Local config uses `/Users/yangfan/Desktop/papers/1.目录.md` for `main_papers.catalog_path`.
- Exact continuous-time exclusion key is `main_papers::02_约束分布式优化/耦合约束与原始对偶/Liu (2022) Continuous-time finite-time consensus distributed optimization`.

- [ ] **Step 1: Write failing CLI integration test**

```js
test("CLI loads catalogs before building and keeps private details out of errors", async () => {
  const seen = []
  const code = await runBuildCli({
    repoRoot,
    loadConfig: async () => config,
    loadOverrides: async () => overrides,
    loadCatalog: async (path, options) => { seen.push([path, options.sourceId]); return catalog },
    build: async (input) => { assert.equal(input.catalogs.main_papers, catalog); return { paperCount: 48, previewCount: 29, pageCount: 30, excludedCount: 1 } },
    stdout: () => {}, stderr: () => {},
  })
  assert.equal(code, 0)
  assert.deepEqual(seen, [[config.sources[0].catalog_path, "main_papers"]])
})
```

- [ ] **Step 2: Verify RED, wire catalog loading and generated `paper-catalog.json`, verify GREEN**

Run: `node --test exporter/paper-library/build.test.mjs`

The build writes a sanitized catalog artifact with source-relative keys only; it must contain no absolute path and no note/OCR body.

- [ ] **Step 3: Update private configuration and thesis overrides**

Add `catalog_path` to `library.local.json`. Replace temporary `LIB-*` identities that now come from the catalog; retain only real manual decisions, including:

```json
{
  "paper_id": "Li25-TSGF",
  "unit_type": "thesis",
  "title_original": "Li25-TSGF：时变不平衡网络下非光滑凸优化的分布式随机算法研究"
}
```

and chapter records `Li25-TSGF-C03` / `Li25-TSGF-C05` with `unit_type: "chapter"` and `parent_paper_id: "Li25-TSGF"`. Add the exact `Liu22-FTCO` exclusion with reason `continuous_time_out_of_scope`.

- [ ] **Step 4: Revalidate the Deng cleanup inventory before mutation**

Run exact read-only checks:

```bash
find '/Users/yangfan/Desktop/papers/论文/02_约束分布式优化/耦合约束与原始对偶/Deng (2023) Tseng分裂鲁棒' -type f -print
shasum -a 256 '/Users/yangfan/Desktop/papers/论文/02_约束分布式优化/耦合约束与原始对偶/Deng (2023) Tseng分裂鲁棒'/Deng23-TSR_*.md
```

Require exactly 103 files, exactly 99 approved mismatch files, and exactly four retained `Deng23-TSR_*.md` files before moving anything.

- [ ] **Step 5: Move only the approved mismatch set to a timestamped Trash directory**

Create an explicit directory under `/Users/yangfan/.Trash/` and move exactly:

```text
Distributed robust optimization with coupled constraints via Tseng’s splitting method.pdf
Distributed robust optimization with coupled constraints via Tseng’s splitting method.md
具有耦合不确定约束的分布式鲁棒优化问题.md
images/
```

Do not use `rm`, globs, `$HOME`, `~`, or unresolved variables. Afterward, verify the source directory contains exactly the four retained notes and that their SHA-256 values match the pre-move manifest. Record Trash recovery path and counts in `audits/2026-08-27-paper-library-cleanup.md`.

- [ ] **Step 6: Rebuild from empty generated directories**

Delete only the two validated generated directories `local_library_data/` and `local_library_output/`, then run:

```bash
node exporter/scripts/build-private-library.mjs
```

Expected semantic results:

- 48 included records;
- zero `path_hash` identities;
- one excluded unit (`Liu22-FTCO`);
- no Deng record;
- every included record has a stable ID and a non-empty display title;
- all four note-status group counts sum to 48;
- every resolved preferred note has a generated controlled preview;
- public package audit contains no private title, absolute path, note body, OCR body or generated private index.

- [ ] **Step 7: Run the complete automated suite**

Run:

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
```

Require zero failures and no unexpected warnings.

- [ ] **Step 8: Perform HTTP and desktop visual verification**

Serve `local_library_output` locally on port 4176, open `/desktop/library.html`, and verify:

- HTTP 200 for page, assets, index, audit and all generated note previews;
- browser console has no uncaught errors;
- 1280×720 and 1440×900 show the four Chinese groups without horizontal page overflow;
- selecting rows, opening details, returning, searching and filtering remain keyboard accessible;
- `Not Reported` and `Unknown` do not appear in the rendered library.

- [ ] **Step 9: Write final task report without Git**

Record all commands, exit codes, record/group counts, Trash recovery path, source-manifest comparison and visual findings. Do not commit, publish, push or create a repository.

---

## Plan self-review checklist

- Spec coverage: Tasks 1–5 cover catalog parsing, provenance, stable identity, note classification, exclusions, previews, thesis mapping, Deng cleanup, UI grouping, private/public boundaries and verification.
- Type consistency: `CatalogRecord`, `Catalog`, `note_status`, `identity_source`, `catalogs`, exclusion fields and audit fields use the same names across producers and consumers.
- Destructive boundary: only Task 5 moves the four explicitly named Deng entries; continuous-time source files remain untouched.
- No Git boundary: every task records evidence in the SDD workspace instead of committing.
