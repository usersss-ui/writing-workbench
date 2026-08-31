# Private Paper Library First Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, read-only, desktop paper library that indexes the heterogeneous paper folders under the configured source root, shows conservative research states in Chinese, and lets the user organize papers into the four P02 roles without changing the source files.

**Architecture:** A zero-dependency Node.js build CLI reads a private JSON configuration, scans configured roots through a guarded adapter, merges private manual overrides, and writes rebuildable private JSON plus safe note previews. A generated static desktop page consumes that JSON over a local HTTP server and keeps personal reading markers and the P02 shelf only in `localStorage`. The public Quartz pipeline is not touched in this milestone; a separate package-boundary audit proves that local paths, notes, PDFs, and generated private data cannot enter a future GitHub package.

**Tech Stack:** Node.js 22 built-ins (`node:fs`, `node:path`, `node:crypto`, `node:test`), semantic HTML, existing CSS, browser ES modules, `localStorage`, Python's existing static HTTP server, and the already available Playwright CLI for desktop screenshots. No npm or Python dependency installation.

**Spec:** `docs/superpowers/specs/2026-08-27-paper-library-design.md`

## Global Constraints

- Do not write, rename, move, delete, or add metadata to `/Users/yangfan/Desktop/papers/`.
- The only allowed scan root for the first real build is the path resolved from `local_library_config/library.local.json`; never hard-code it in program modules.
- Keep the same `source_id` when the user moves a whole source root. Stable identity is `source_id + normalized relative path`, unless an explicit `paper_id` or private override supplies the identity.
- Use JSON for local configuration and overrides in this milestone. There is no YAML dependency and none may be installed without a new user confirmation.
- Only write generated material under `local_library_data/` and `local_library_output/`. Both must be safely deletable and completely rebuildable.
- Do not copy, embed, upload, or serve PDFs. Record existence and private original paths only in the private audit/index.
- Do not expose OCR full text, translations, private notes, code, result images, absolute paths, or overrides to Quartz or the future GitHub package.
- Do not infer academic or research states from file names, folders, modification times, or file existence. In particular: PDF does not mean read; note does not mean evidence; source map does not mean verified; code does not mean reproduced.
- User-facing missing values must be Chinese phrases such as `暂无书目信息`, `尚无阅读笔记`, `未检查原文`, `尚未建立仿真记录`, `有代码，运行状态未记录`, `写作材料 0 条`, and `尚未分类`. Never render `Unknown`, `Not Reported`, or a fabricated percentage.
- This milestone is desktop-only and must be verified at 1280×720 and 1440×900.
- Do not create a Git branch, commit, repository, remote, deployment, or public site. Each task ends with a local verification checkpoint instead of a Git commit.
- Do not integrate Quartz in this milestone. Quartz work begins only after the real index and interaction semantics have been accepted.

## Fixed Data Contracts

Use these machine enums in JSON and translate them in the rendering layer:

```js
export const SOURCE_STATUS = ["not_checked", "located", "verified"]
export const EVIDENCE_STATUS = ["none", "partial", "core_verified"]
export const REPRODUCTION_STATUS = [
  "none",
  "description_only",
  "code_unrun",
  "ran_no_record",
  "results_recorded",
  "consistency_verified",
]
export const PERSONAL_READING_MARKER = ["unread", "reading", "read"]
export const P02_ROLES = [
  "algorithm_mechanism",
  "theory_evidence",
  "simulation_baseline",
  "related_work",
]
```

Every generated paper record must have this stable shape; absent values use empty strings, empty arrays, `null`, `0`, or the conservative enums above rather than English display copy:

```js
{
  paper_id: "Xi18-ADDOPT",
  slug: "xi18-addopt",
  source_id: "main_papers",
  relative_path: "Xi (2018) ADD-OPT",
  identity_source: "override",
  unit_type: "article",
  parent_paper_id: null,
  title_zh: "",
  title_en: "",
  authors: [],
  year: null,
  venue: "",
  doi_or_url: "",
  topic_l1: "",
  topic_l2: "",
  research_scopes: [],
  method_tags: [],
  network_tags: [],
  problem_tags: [],
  contribution_role: "unclassified",
  p02_relevance: null,
  artifacts: {
    pdf: [],
    ocr: [],
    translation: [],
    note: [],
    derivation: [],
    source_map: [],
    modeling: [],
    simulation: [],
    code_compare: [],
    script: [],
    result: [],
    reproduction_report: [],
  },
  artifact_availability: {},
  source_status: "not_checked",
  evidence_status: "none",
  reproduction_status: "none",
  writing_material_count: 0,
  preferred_note: null,
  note_preview_url: null,
  warnings: [],
}
```

Private override records use `source_id + relative_path` as their lookup key and may provide only the following reviewed fields:

```json
{
  "version": 1,
  "papers": {
    "main_papers::Xi (2018) ADD-OPT": {
      "paper_id": "Xi18-ADDOPT",
      "title_zh": "ADD-OPT：加速分布式有向优化",
      "title_en": "ADD-OPT: Accelerated Distributed Directed Optimization",
      "authors": ["Xi", "Khan"],
      "year": 2018,
      "venue": "IEEE Transactions on Automatic Control",
      "doi_or_url": "https://doi.org/example",
      "unit_type": "article",
      "topic_l1": "分布式优化",
      "topic_l2": "有向网络优化",
      "research_scopes": ["受约束优化"],
      "method_tags": ["梯度跟踪"],
      "network_tags": ["有向网络", "静态拓扑"],
      "problem_tags": ["凸优化"],
      "contribution_role": "key_method_turn",
      "p02_relevance": 3,
      "source_status": "located",
      "evidence_status": "partial",
      "reproduction_status": "description_only",
      "writing_material_count": 0,
      "preferred_note": "Xi18-ADDOPT_论文精读.md",
      "preview_note": true,
      "artifact_overrides": {
        "translation": ["ADD-OPT 中文题名.md"]
      }
    }
  }
}
```

The generated audit shape is fixed:

```js
{
  version: 1,
  generated_at: "ISO-8601 timestamp",
  sources: [{ source_id, root_path, scanned_directories }],
  counts: {
    paper_units: 0,
    standard_units: 0,
    identity_pending_units: 0,
    generated_note_previews: 0,
    generated_pages: 0,
  },
  private_path_lookup: { "Xi18-ADDOPT": "/absolute/private/path" },
  blocking: {
    duplicate_explicit_ids: [],
    path_escapes: [],
    slug_collisions: [],
  },
  warnings: {
    multiple_versions: [],
    unreadable_markdown: [],
    broken_paths: [],
    external_symlinks: [],
    unrecognized_artifacts: [],
  },
}
```

`identity_source` is one of `override`, `frontmatter`, `filename_shortcode`, or `path_hash`. Audit `standard_units` counts the first three; `identity_pending_units` counts only `path_hash`. `private_path_lookup` exists only in the ignored private audit and is never copied into `paper-index.json`, rendered as text, or included in any package candidate.

---

### Task 1: Establish Private Configuration, Ignore Boundaries, and Stable IDs

**Files:**
- Modify: `.gitignore`
- Create: `exporter/config/library.example.json`
- Create: `local_library_config/library.local.json` (ignored private file)
- Create: `local_library_config/paper-overrides.json` (ignored private file)
- Create: `exporter/paper-library/config.mjs`
- Create: `exporter/paper-library/ids.mjs`
- Create: `exporter/paper-library/config.test.mjs`
- Create: `exporter/paper-library/ids.test.mjs`

- [ ] **Step 1: Add the failing configuration tests**

Write tests that prove the local path is configuration, not identity:

```js
// exporter/paper-library/config.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadLibraryConfig } from "./config.mjs"

test("loads one absolute private source with a stable source_id", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: join(root, "papers") }],
  }))

  const config = await loadLibraryConfig(configPath)
  assert.equal(config.sources[0].source_id, "main_papers")
  assert.equal(config.sources[0].path, join(root, "papers"))
})

test("rejects duplicate source_id values", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [
      { source_id: "main_papers", path: join(root, "a") },
      { source_id: "main_papers", path: join(root, "b") },
    ],
  }))

  await assert.rejects(() => loadLibraryConfig(configPath), /source_id 重复/)
})

test("rejects a relative source path", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: "../papers" }],
  }))

  await assert.rejects(() => loadLibraryConfig(configPath), /必须是绝对路径/)
})
```

- [ ] **Step 2: Run the configuration test and confirm RED**

Run:

```bash
node --test exporter/paper-library/config.test.mjs
```

Expected: FAIL because `config.mjs` does not exist.

- [ ] **Step 3: Implement strict JSON configuration loading**

Implement exactly this public interface in `config.mjs`:

```js
export async function loadLibraryConfig(configPath)
```

It must:

1. parse UTF-8 JSON;
2. require `version === 1`;
3. require a non-empty `sources` array;
4. require `source_id` to match `/^[a-z][a-z0-9_-]*$/`;
5. require every `path` to be absolute;
6. reject duplicate `source_id` values;
7. return frozen normalized records without checking whether the directories exist yet.

The build CLI, not this parser, reports a missing source directory so tests can use future/moved paths.

- [ ] **Step 4: Add the failing stable-ID tests**

```js
// exporter/paper-library/ids.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { makePathPaperId, normalizeRelativePath, makeSlug } from "./ids.mjs"

test("fallback identity is a fixed digest of source_id and relative path only", () => {
  const id = makePathPaperId({
    sourceId: "main_papers",
    relativePath: "Xi (2018) ADD-OPT",
  })
  assert.equal(id, "LIB-25A49551EB04")
})

test("source_id participates in fallback identity", () => {
  const relativePath = "Xi (2018) ADD-OPT"
  assert.notEqual(
    makePathPaperId({ sourceId: "main_papers", relativePath }),
    makePathPaperId({ sourceId: "archive", relativePath }),
  )
})

test("relative paths use slash separators and cannot escape the root", () => {
  assert.equal(normalizeRelativePath("A\\B/../C"), "A/C")
  assert.throws(() => normalizeRelativePath("../../outside"), /越出扫描根/)
})

test("slug generation is deterministic and URL safe", () => {
  assert.equal(makeSlug("Xi18-ADDOPT"), "xi18-addopt")
  assert.equal(makeSlug("LIB-ABC123456789"), "lib-abc123456789")
})
```

- [ ] **Step 5: Run the ID test and confirm RED**

Run:

```bash
node --test exporter/paper-library/ids.test.mjs
```

Expected: FAIL because `ids.mjs` does not exist.

- [ ] **Step 6: Implement the stable ID functions**

`ids.mjs` exports:

```js
export function normalizeRelativePath(relativePath)
export function makePathPaperId({ sourceId, relativePath })
export function makeSlug(paperId)
export function makeOverrideKey({ sourceId, relativePath })
```

Use `posix.normalize(relativePath.replaceAll("\\", "/"))`, reject empty, absolute, `..`, or `../` results, and compute the fallback ID with:

```js
const digest = createHash("sha256")
  .update(`${sourceId}\0${normalizedRelativePath}`, "utf8")
  .digest("hex")
  .slice(0, 12)
  .toUpperCase()
return `LIB-${digest}`
```

`makeSlug` lowercases, replaces non-ASCII alphanumeric runs with `-`, trims dashes, and throws when the result is empty. Explicit Chinese-only IDs are therefore invalid; Chinese belongs in titles, not route identity.

The scanner test in Task 2 must additionally create the same relative paper folder under two different temporary absolute roots and assert equal `paper_id` values. A second test renames an internal folder while keeping the same explicit frontmatter `paper_id` and asserts that the ID remains unchanged. These are the non-tautological source-move and internal-rename proofs.

- [ ] **Step 7: Add private and public configuration files plus ignore rules**

Append these exact entries to `.gitignore`:

```gitignore
local_library_config/
local_library_data/
local_library_output/
```

Create `exporter/config/library.example.json` without a real absolute path:

```json
{
  "version": 1,
  "sources": [
    {
      "source_id": "main_papers",
      "path": "REPLACE_WITH_ABSOLUTE_PATH"
    }
  ]
}
```

Create the ignored local files:

```json
// local_library_config/library.local.json
{
  "version": 1,
  "sources": [
    {
      "source_id": "main_papers",
      "path": "/Users/yangfan/Desktop/papers/论文"
    }
  ]
}
```

```json
// local_library_config/paper-overrides.json
{
  "version": 1,
  "papers": {}
}
```

- [ ] **Step 8: Verify Task 1 GREEN**

Run:

```bash
node --test exporter/paper-library/config.test.mjs exporter/paper-library/ids.test.mjs
node --check exporter/paper-library/config.mjs
node --check exporter/paper-library/ids.mjs
git check-ignore -v local_library_config/library.local.json
```

Expected: all tests pass, syntax checks are silent, and `git check-ignore` names the new ignore rule. Do not commit.

---

### Task 2: Build the Read-Only Scanner and Artifact Adapter

**Files:**
- Create: `exporter/paper-library/artifacts.mjs`
- Create: `exporter/paper-library/frontmatter.mjs`
- Create: `exporter/paper-library/scanner.mjs`
- Create: `exporter/paper-library/scanner.test.mjs`

- [ ] **Step 1: Add temporary-tree scanner tests**

Tests create their own fake trees at runtime so no fake PDF enters the repository:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { scanPaperSources } from "./scanner.mjs"

async function put(root, relativePath, content = "fixture") {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  return target
}

test("indexes a PDF leaf once and keeps multiple PDFs as versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Xi (2018) ADD-OPT/paper.pdf")
  await put(root, "Xi (2018) ADD-OPT/paper-v2.pdf")
  await put(root, "Xi (2018) ADD-OPT/Xi18-ADDOPT_论文精读.md", "# 精读")

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(result.papers.length, 1)
  assert.equal(result.papers[0].artifacts.pdf.length, 2)
  assert.equal(result.papers[0].artifacts.note.length, 1)
  assert.equal(result.audit.warnings.multiple_versions.length, 1)
})

test("does not index candidate tables, empty folders, or non-paper projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "候选表.md")
  await put(root, "website/index.html")
  await mkdir(join(root, "空目录"), { recursive: true })

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })
  assert.equal(result.papers.length, 0)
})

test("turns thesis chapter PDF directories into child units", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Doctoral Thesis/thesis.pdf")
  await put(root, "Doctoral Thesis/Chapter 03/chapter-03.pdf")

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: {
      version: 1,
      papers: {
        "main_papers::Doctoral Thesis": {
          paper_id: "THESIS-01",
          unit_type: "thesis"
        },
      },
    },
  })

  assert.equal(result.papers.length, 2)
  const chapter = result.papers.find((paper) => paper.unit_type === "chapter")
  assert.equal(chapter.parent_paper_id, "THESIS-01")
})

test("warns and refuses to read a symlink that resolves outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-outside-"))
  await put(outside, "secret.pdf")
  await mkdir(join(root, "Linked Paper"), { recursive: true })
  await symlink(join(outside, "secret.pdf"), join(root, "Linked Paper", "secret.pdf"))

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })
  assert.equal(result.papers.length, 0)
  assert.equal(result.audit.warnings.external_symlinks.length, 1)
})

test("moving the configured source root preserves a path-hash ID", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-root-a-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-root-b-"))
  await put(firstRoot, "Same Relative Paper/paper.pdf")
  await put(secondRoot, "Same Relative Paper/paper.pdf")
  const overrides = { version: 1, papers: {} }
  const first = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: firstRoot }] }, overrides,
  })
  const second = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: secondRoot }] }, overrides,
  })
  assert.equal(first.papers[0].paper_id, second.papers[0].paper_id)
})

test("renaming an internal directory preserves an explicit frontmatter ID", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-root-a-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-root-b-"))
  await put(firstRoot, "Old Name/paper.pdf")
  await put(firstRoot, "Old Name/note.md", "---\npaper_id: Xi18-ADDOPT\n---\n")
  await put(secondRoot, "New Name/paper.pdf")
  await put(secondRoot, "New Name/note.md", "---\npaper_id: Xi18-ADDOPT\n---\n")
  const overrides = { version: 1, papers: {} }
  const first = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: firstRoot }] }, overrides,
  })
  const second = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: secondRoot }] }, overrides,
  })
  assert.equal(first.papers[0].paper_id, "Xi18-ADDOPT")
  assert.equal(second.papers[0].paper_id, "Xi18-ADDOPT")
})
```

Also add cases for OCR, translation, derivation, `source_map`, modeling, simulation, code comparison, scripts, results, reproduction reports, an unreadable Markdown file, and an override-declared parent container.

- [ ] **Step 2: Run the scanner test and confirm RED**

Run:

```bash
node --test exporter/paper-library/scanner.test.mjs
```

Expected: FAIL because scanner modules do not exist.

- [ ] **Step 3: Implement deterministic artifact classification**

`artifacts.mjs` exports:

```js
export const ARTIFACT_KEYS
export function createEmptyArtifacts()
export function classifyArtifact({ relativePath, siblingPdfStems = [], explicitCategory = null })
export function summarizeArtifactAvailability(artifacts)
```

Classification order is first-match and case-insensitive:

1. a validated private `artifact_overrides` entry → its explicit artifact category;
2. `.pdf` → `pdf`;
3. names containing `source_map` → `source_map`;
4. names containing `复现报告` or `reproduction-report` → `reproduction_report`;
5. names containing `仿真描述`, `simulation`, or `实验设置` → `simulation`;
6. names containing `代码对比` or `code-compare` → `code_compare`;
7. `.py`, `.m`, `.mlx`, `.ipynb`, `.jl`, or `.r` → `script`;
8. image files under a path segment named `result`, `results`, `结果`, or `figures` → `result`;
9. names containing `推导过程`, `derivation`, or `proof-notes` → `derivation`;
10. names containing `建模复盘`, `modeling`, or `model-review` → `modeling`;
11. names containing `论文精读`, `精读笔记`, or `reading-note` → `note`;
12. names containing `中文翻译`, `_zh`, `translation`, or `翻译` → `translation`;
13. Markdown names matching the PDF stem or containing `ocr` → `ocr`;
14. otherwise → `null` and record as unrecognized only when it is inside an included paper unit.

The scanner first enumerates the complete directory, builds `siblingPdfStems` from PDF names, and only then classifies each entry. `classifyArtifact` receives the normalized path relative to the paper unit, so result-directory detection uses path segments rather than a bare file name and OCR detection can compare a Markdown stem with the known sibling PDF stems. Each stored artifact item has `{ relative_path, file_name, size_bytes }`. Keep all versions sorted by normalized relative path.

Some historical full translations use only a Chinese paper title as the file name and contain no reliable translation suffix. Do not guess from Chinese characters or body text. `artifact_overrides` is the explicit compatibility mechanism: it maps an `ARTIFACT_KEYS` category to source-relative file paths. Validate each path as in-root, existing, regular, unique across categories, and owned by that paper unit. A pure-Chinese-title translation without an override remains `unrecognized_artifacts` with a warning until the private factual mapping is added.

Implement a narrow, dependency-free frontmatter reader in `frontmatter.mjs`:

```js
export function parsePaperFrontmatter(markdownPrefix)
```

It only inspects a `---` block that starts on the first line and closes within the first 8 KiB. It recognizes these existing scalar keys and aliases:

```text
paper_id
title -> title_en when title_en is absent
title_zh
title_en
year
venue
doi -> doi_or_url
url -> doi_or_url when doi is absent
unit_type
topic_l1
topic_l2
contribution_role
p02_relevance
```

It recognizes these list keys written as a one-line bracket list or YAML dash list:

```text
authors
research_scope -> research_scopes
research_scopes
method_tags
network_tags
problem_tags
```

Quoted scalar values have their matching outer quotes removed; `year` must be a four-digit integer; `unit_type` must be one of `article`, `review`, `thesis`, or `chapter`; `p02_relevance` must be an integer from 0 to 3. Nested maps, anchors, tags, multiline scalars, and every unrecognized key are ignored with a scanner warning. The parser never executes YAML features and never upgrades formal source/evidence/reproduction status. Add parser cases using the exact aliases above to `scanner.test.mjs` before implementation so existing notes do not need duplicate overrides.

- [ ] **Step 4: Implement guarded source walking and paper-unit rules**

`scanner.mjs` exports:

```js
export async function scanPaperSources({ config, overrides })
```

Implementation rules:

- Call `realpath` for each source and every symlink target.
- A target is inside a root only when `relative(realRoot, realTarget)` is non-empty/non-absolute and does not start with `..`, or when it equals the root.
- Do not follow external symlinks. Add the private relative source path to `audit.warnings.external_symlinks`.
- Walk directory entries in `localeCompare` order for stable output.
- Include a leaf directory containing one or more in-root PDFs.
- Include a directory explicitly declared by an override with `unit_type: "thesis"` or `unit_type: "review"`, even if it is a container.
- If an included thesis directory has descendant PDF leaves, each descendant becomes a `chapter` and links to the thesis ID.
- Do not recursively count a child PDF in both the parent and child article.
- For identity, use override `paper_id`, then an explicit short code detected in a frontmatter block or stable filename, then `makePathPaperId`.
- Treat a short code as explicit only when it matches `/^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/`; never construct one from title guesses.
- Collect duplicate explicit IDs and slug collisions in `audit.blocking`; throw one Chinese summary error after the scan if any blocking list is non-empty.
- Do not read Markdown bodies except the first 8 KiB needed to inspect frontmatter/explicit IDs. Note rendering is a separate task.
- Never use `mtime`, directory ordering, or folder names to assign reading, evidence, publication, or reproduction status.
- Keep the absolute resolved paper directory only in an internal scan record. During generation, remove it from `paper-index.json` and place it in the ignored audit's `private_path_lookup[paper_id]`. Never render it in visible HTML, put it in an HTTP link, or print it from the CLI.
- Set `identity_source` explicitly. A fallback path hash is `path_hash`; it contributes to `identity_pending_units`. Override/frontmatter/filename codes contribute to `standard_units`.
- Identify all paper-unit boundaries before collecting artifacts. For each unit, recursively collect descendant files but stop at every nested paper-unit root; this includes code/result subdirectories without double-counting chapter PDFs or nested papers.

- [ ] **Step 5: Verify Task 2 GREEN**

Run:

```bash
node --test exporter/paper-library/scanner.test.mjs
node --check exporter/paper-library/artifacts.mjs
node --check exporter/paper-library/frontmatter.mjs
node --check exporter/paper-library/scanner.mjs
```

Expected: all tests pass and no file outside a test root was changed. Do not scan the real source yet and do not commit.

---

### Task 3: Merge Private Overrides and Enforce Conservative Research States

**Files:**
- Create: `exporter/paper-library/overrides.mjs`
- Create: `exporter/paper-library/status.mjs`
- Create: `exporter/paper-library/status.test.mjs`
- Modify: `exporter/paper-library/scanner.mjs`
- Modify: `exporter/paper-library/scanner.test.mjs`

- [ ] **Step 1: Write failing precedence and non-inference tests**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { deriveFormalState, mergePaperRecord } from "./status.mjs"

const artifacts = (overrides = {}) => ({
  pdf: [], ocr: [], translation: [], note: [], derivation: [], source_map: [],
  modeling: [], simulation: [], code_compare: [], script: [], result: [],
  reproduction_report: [], ...overrides,
})

test("PDF and notes do not upgrade formal reading or evidence states", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ pdf: [{ relative_path: "paper.pdf" }], note: [{ relative_path: "note.md" }] }),
    override: {},
  })
  assert.deepEqual(state, {
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    writing_material_count: 0,
  })
})

test("code existence reports code_unrun but never reproduced", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ script: [{ relative_path: "run.py" }] }),
    override: {},
  })
  assert.equal(state.reproduction_status, "code_unrun")
})

test("a code-comparison note alone is not treated as executable code", () => {
  const state = deriveFormalState({
    artifacts: artifacts({ code_compare: [{ relative_path: "代码对比提示.md" }] }),
    override: {},
  })
  assert.equal(state.reproduction_status, "none")
})

test("an override wins over an adapter title and fallback state", () => {
  const merged = mergePaperRecord({
    adapted: { title_zh: "路径标题", year: null },
    explicit: { title_zh: "frontmatter 标题", year: 2018 },
    override: { title_zh: "人工确认标题", evidence_status: "partial" },
  })
  assert.equal(merged.title_zh, "人工确认标题")
  assert.equal(merged.year, 2018)
  assert.equal(merged.evidence_status, "partial")
})

test("writing material count rejects negative or non-integer values", () => {
  assert.throws(
    () => deriveFormalState({ artifacts: artifacts(), override: { writing_material_count: 1.5 } }),
    /写作材料数量/,
  )
})
```

Add validation tests for every enum, unknown override keys, duplicate override `paper_id`, override keys that reference no scanned unit, and `preferred_note` paths that escape the paper directory.

- [ ] **Step 2: Run the status test and confirm RED**

Run:

```bash
node --test exporter/paper-library/status.test.mjs
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement override loading and validation**

`overrides.mjs` exports:

```js
export async function loadPaperOverrides(overridesPath)
export function validatePaperOverride(overrideKey, override)
```

Allow only these fields from the fixed override contract: `paper_id`, `title_zh`, `title_en`, `authors`, `year`, `venue`, `doi_or_url`, `unit_type`, `parent_paper_id`, `topic_l1`, `topic_l2`, `research_scopes`, `method_tags`, `network_tags`, `problem_tags`, `contribution_role`, `p02_relevance`, `source_status`, `evidence_status`, `reproduction_status`, `writing_material_count`, `preferred_note`, `preview_note`, and `artifact_overrides`. Unknown keys are errors, not silently ignored. Require `version === 1`; allow an empty `papers` object. An override lookup key is exactly `${source_id}::${normalizeRelativePath(relative_path)}`.

Every explicit or override `paper_id` must match `/^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/`; fallback IDs must match `/^LIB-[A-F0-9]{12}$/`. Validate `p02_relevance` as `null` or an integer from 0 to 3, tags as trimmed unique string arrays, and `preview_note` as boolean. Add a test that rejects `paper_id: "../escape"` and proves no generated path is constructed from it.

- [ ] **Step 4: Implement merge and formal-state derivation**

`status.mjs` exports:

```js
export function deriveFormalState({ artifacts, override })
export function mergePaperRecord({ adapted, explicit, override })
export function validateGeneratedPaper(paper)
```

Rules:

- `override > explicit > adapted > conservative default` per field.
- `source_status` defaults to `not_checked` even when PDF/OCR/source map exists.
- `evidence_status` defaults to `none` even when note/derivation/source map exists.
- `reproduction_status` defaults to `code_unrun` only when a real script/code file with an approved executable/source extension exists; a `code_compare` Markdown note alone remains `none`. It defaults to `description_only` when a simulation description exists but no real code file exists; otherwise `none`.
- Only the override may upgrade to `ran_no_record`, `results_recorded`, or `consistency_verified`.
- `writing_material_count` defaults to `0` and only the override may set a positive integer in this milestone.
- Topic, method, network, problem, contribution, venue, DOI/URL, and P02 relevance fields remain empty unless frontmatter or an override explicitly supplies them; the scanner never guesses them from a folder name. These explicit override fields are what make real-data filtering meaningful without fabricating classification.
- No field reads modification time.
- `validateGeneratedPaper` requires the fixed data contract and rejects English display placeholders in title fields.

- [ ] **Step 5: Integrate override precedence into scanner output**

The scanner returns records sorted by `(source_id, relative_path)`. It adds non-blocking warnings for override keys with no unit and blocks duplicate explicit/override IDs. Preserve all source-relative artifact arrays after metadata merge.

- [ ] **Step 6: Verify Task 3 GREEN**

Run:

```bash
node --test exporter/paper-library/status.test.mjs exporter/paper-library/scanner.test.mjs
node --check exporter/paper-library/overrides.mjs
node --check exporter/paper-library/status.mjs
```

Expected: all semantic tests pass; no status is upgraded by file existence except the explicitly worded `code_unrun`/`description_only` availability states. Do not commit.

---

### Task 4: Generate Safe Preferred-Note Previews and Atomic Private Build Outputs

**Files:**
- Create: `exporter/paper-library/note-preview.mjs`
- Create: `exporter/paper-library/note-preview.test.mjs`
- Create: `exporter/paper-library/build.mjs`
- Create: `exporter/paper-library/build.test.mjs`
- Create: `exporter/scripts/build-private-library.mjs`

- [ ] **Step 1: Write failing safe-render tests**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { renderControlledMarkdown } from "./note-preview.mjs"

test("renders a small approved Markdown subset", () => {
  const html = renderControlledMarkdown("# 标题\n\n正文 **不解释扩展语法**。\n\n> 待核验")
  assert.match(html, /<h1>标题<\/h1>/)
  assert.match(html, /<p>正文 \*\*不解释扩展语法\*\*。<\/p>/)
  assert.match(html, /<blockquote>待核验<\/blockquote>/)
})

test("escapes raw HTML, scripts, event handlers, and absolute local links", () => {
  const privatePath = ["", "Users", "example", "secret.pdf"].join("/")
  const html = renderControlledMarkdown(`<script>alert(1)</script>\n\n[本机](${privatePath})`)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /href=/)
  assert.match(html, /\[本机\]\(\/Users\/example\/secret\.pdf\)/)
})

test("wraps fenced code without executing it", () => {
  const html = renderControlledMarkdown("```python\nprint('<x>')\n```")
  assert.equal(html, '<pre><code class="language-python">print(&#39;&lt;x&gt;&#39;)</code></pre>')
})
```

The approved subset is headings, paragraphs, block quotes, unordered lists, and fenced code. Inline Markdown, wikilinks, embeds, raw HTML, Mermaid, and local file links remain escaped text in this first preview.

- [ ] **Step 2: Run note tests and confirm RED**

Run:

```bash
node --test exporter/paper-library/note-preview.test.mjs
```

Expected: FAIL because `note-preview.mjs` does not exist.

- [ ] **Step 3: Implement the controlled renderer**

`note-preview.mjs` exports:

```js
export function escapeHtml(value)
export function renderControlledMarkdown(markdown)
export function choosePreferredNote({ paper, override })
```

`choosePreferredNote` returns `null` unless the private override has `preview_note: true`. For that one marked paper, it uses `preferred_note` when the normalized path exactly matches one in-root note artifact; if `preferred_note` is absent, it may choose only when exactly one note artifact exists. With zero notes it returns `null` and warns `已请求预览，但尚无阅读笔记`; with multiple notes and no explicit choice it returns `null` and warns `存在多个笔记版本，待选择首选文件`. Never choose by modification time.

The build validates that no more than one override has `preview_note: true`. This enforces the first-milestone boundary of one controlled example. Papers with note artifacts but without a generated preview display `已有阅读笔记；首版尚未生成网页预览`; papers with no note artifacts display `尚无阅读笔记`. Bulk note rendering remains a second-phase task.

- [ ] **Step 4: Write failing build-output tests**

The build test uses a temporary repository and a temporary paper source. It calls the exported function, never the real source:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { buildPrivateLibrary } from "./build.mjs"

async function put(root, relativePath, content = "fixture") {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  return target
}

test("writes only rebuildable private outputs and leaves source bytes unchanged", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "paper-build-repo-"))
  const sourceRoot = await mkdtemp(join(tmpdir(), "paper-build-source-"))
  const templateRoot = join(repoRoot, "templates")
  const pdf = await put(sourceRoot, "Paper A/paper.pdf", "pdf bytes")
  await put(sourceRoot, "Paper A/reading-note.md", "# 私人笔记")
  await put(templateRoot, "library.template.html", "<!doctype html><html lang=\"zh-CN\"><main id=\"library-results\"></main></html>")
  const before = await readFile(pdf)

  const result = await buildPrivateLibrary({
    repoRoot,
    config: { version: 1, sources: [{ source_id: "main_papers", path: sourceRoot }] },
    overrides: { version: 1, papers: {} },
    templateRoot,
  })

  assert.equal((await readFile(pdf)).compare(before), 0)
  await stat(join(repoRoot, "local_library_data/paper-index.json"))
  await stat(join(repoRoot, "local_library_data/paper-library-audit.json"))
  await stat(join(repoRoot, "local_library_output/desktop/library.html"))
  assert.equal(result.paperCount, 1)
})
```

Also test that a build fails before swapping output when a blocking duplicate ID occurs, rejects two `preview_note: true` overrides, rejects a path-escaping explicit ID before generation, and that target guards reject any output directory outside the exact generated-name family under `repoRoot`.

- [ ] **Step 5: Run build tests and confirm RED**

Run:

```bash
node --test exporter/paper-library/build.test.mjs
```

Expected: FAIL because `build.mjs` does not exist.

- [ ] **Step 6: Implement guarded atomic build generation**

`build.mjs` exports:

```js
export async function buildPrivateLibrary({ repoRoot, config, overrides, templateRoot })
export async function guardedReplaceGeneratedDirectory({ repoRoot, basename, populate })
export function assertGeneratedPath({ repoRoot, candidate, targetBasename, kind })
```

Generation sequence:

1. scan and fully validate in memory;
2. create sibling stages named `.local_library_data.next-<pid>` and `.local_library_output.next-<pid>`;
3. write pretty JSON ending with a newline;
4. remove internal absolute paper directories from index records and write them only to `audit.private_path_lookup`;
5. write at most one controlled preferred-note HTML fragment to `notes/{validated-slug}/preferred.html` and set its URL to `../../local_library_data/notes/{validated-slug}/preferred.html`;
6. in Task 4 copy only `library.template.html`; Task 6 extends this step to the explicit approved asset list;
7. rename an existing allowed target to `.previous-<pid>`, rename stage to target, then remove the previous generated directory;
8. if swap fails, restore the previous target;
9. on any failure, remove only the exact guarded stage paths.

Before any recursive removal or rename, call `assertGeneratedPath`. It requires `dirname(resolve(candidate)) === resolve(repoRoot)` and permits only these exact basename patterns for the given `targetBasename`:

```text
kind=target:   local_library_data | local_library_output
kind=stage:    .local_library_data.next-<current pid> | .local_library_output.next-<current pid>
kind=previous: .local_library_data.previous-<current pid> | .local_library_output.previous-<current pid>
```

Reject every other basename, parent, PID, `..`, or symlink-resolved destination. Tests cover valid target/stage/previous names plus outside-parent, wrong-PID, and traversal attempts. Never accept an arbitrary output path or environment variable.

- [ ] **Step 7: Implement the CLI entry point**

`exporter/scripts/build-private-library.mjs` resolves the repository root from its own file URL, then loads:

```text
local_library_config/library.local.json
local_library_config/paper-overrides.json
```

It calls `buildPrivateLibrary`, prints only counts and generated relative paths, and exits non-zero with a Chinese error summary. It must not print note content or absolute paper paths. The command remains:

```bash
node exporter/scripts/build-private-library.mjs
```

- [ ] **Step 8: Verify Task 4 GREEN on fixtures only**

Run:

```bash
node --test exporter/paper-library/note-preview.test.mjs exporter/paper-library/build.test.mjs
node --check exporter/paper-library/build.mjs
node --check exporter/scripts/build-private-library.mjs
```

Expected: all tests pass; the real source has still not been scanned. Do not commit.

---

### Task 5: Implement Browser Filtering, Stable Sorting, P02 Shelf, and Personal Reading Markers

**Files:**
- Create: `prototype/desktop/paper-library-model.mjs`
- Create: `prototype/desktop/paper-library-storage.mjs`
- Create: `prototype/desktop/paper-library-model.test.mjs`
- Create: `prototype/desktop/paper-library-storage.test.mjs`

- [ ] **Step 1: Write failing model tests**

Use three fixed records to prove search, within-axis OR, cross-axis AND, default order, and formal-state separation:

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  filterLibrary, matchPaperQuery, sortLibrary, summarizeShelfRole, translateState,
} from "./paper-library-model.mjs"

const papers = [
  { paper_id: "A", title_zh: "时变有向网络", title_en: "Directed", authors: ["张三"], year: 2024,
    research_scopes: ["分布式优化"], method_tags: ["梯度跟踪"], network_tags: ["有向网络"], problem_tags: ["耦合约束"],
    source_status: "located", evidence_status: "partial", reproduction_status: "description_only",
    contribution_role: "key_method_turn", p02_relevance: 3, writing_material_count: 1 },
  { paper_id: "B", title_zh: "静态网络基线", title_en: "Static baseline", authors: ["Li"], year: 2018,
    research_scopes: ["分布式优化"], method_tags: ["推送求和"], network_tags: ["有向网络"], problem_tags: [],
    source_status: "verified", evidence_status: "core_verified", reproduction_status: "results_recorded",
    contribution_role: "foundational", p02_relevance: 2, writing_material_count: 2 },
  { paper_id: "C", title_zh: "隐私零阶优化", title_en: "Private zeroth order", authors: ["Wang"], year: 2025,
    research_scopes: ["隐私优化"], method_tags: ["零阶"], network_tags: ["无向网络"], problem_tags: [],
    source_status: "not_checked", evidence_status: "none", reproduction_status: "none",
    contribution_role: "unclassified", p02_relevance: null, writing_material_count: 0 },
]

test("searches Chinese, English, author, ID, and tag metadata", () => {
  assert.deepEqual(filterLibrary(papers, { query: "Directed" }).map((p) => p.paper_id), ["A"])
  assert.deepEqual(filterLibrary(papers, { query: "张三" }).map((p) => p.paper_id), ["A"])
  assert.deepEqual(filterLibrary(papers, { query: "零阶" }).map((p) => p.paper_id), ["C"])
})

test("reports which metadata fields matched without searching note bodies", () => {
  assert.deepEqual(matchPaperQuery(papers[0], "张三"), {
    matched: true, hits: [{ field: "作者", snippet: "张三" }],
  })
  assert.deepEqual(matchPaperQuery(papers[0], "A"), {
    matched: true, hits: [{ field: "论文 ID", snippet: "A" }],
  })
  assert.deepEqual(matchPaperQuery({ ...papers[0], note_text: "私有关键词" }, "私有关键词"), {
    matched: false, hits: [],
  })
})

test("uses OR inside one axis and AND between axes", () => {
  const result = filterLibrary(papers, {
    topics: ["分布式优化", "隐私优化"],
    networkTags: ["有向网络"],
    evidenceStatuses: ["partial", "core_verified"],
  })
  assert.deepEqual(result.map((p) => p.paper_id), ["A", "B"])
})

test("default order is shelf, relevance, role, materials, year, then title", () => {
  const shelf = { A: ["algorithm_mechanism"] }
  assert.deepEqual(sortLibrary(papers, "default", shelf).map((p) => p.paper_id), ["A", "B", "C"])
})

test("translates missing machine states into explicit Chinese", () => {
  assert.equal(translateState("source_status", "not_checked"), "未检查原文")
  assert.equal(translateState("evidence_status", "none"), "无证据卡")
  assert.equal(translateState("reproduction_status", "code_unrun"), "有代码，运行状态未记录")
})

test("shelf summaries show at most three titles and an overflow count", () => {
  const shelf = { A: ["theory_evidence"], B: ["theory_evidence"], C: ["theory_evidence"] }
  const extra = { ...papers[0], paper_id: "D", title_zh: "第四篇" }
  shelf.D = ["theory_evidence"]
  assert.deepEqual(summarizeShelfRole("theory_evidence", [...papers, extra], shelf), {
    count: 4,
    titles: ["时变有向网络", "静态网络基线", "隐私零阶优化"],
    overflow: 1,
  })
})
```

- [ ] **Step 2: Run model tests and confirm RED**

Run:

```bash
node --test prototype/desktop/paper-library-model.test.mjs
```

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement the pure library model**

`paper-library-model.mjs` exports:

```js
export function searchableText(paper)
export function matchPaperQuery(paper, query)
export function filterLibrary(papers, filters, workspaceState = {})
export function sortLibrary(papers, mode, shelf)
export function summarizeShelfRole(role, papers, shelf)
export function buildLibraryViewState({ papers, filters, sortMode, workspaceState })
export function summarizeAvailability(paper)
export function translateState(field, value)
```

Filters support `query`, `topics`, `methodTags`, `networkTags`, `problemTags`, `personalReadingMarkers`, `sourceStatuses`, `evidenceStatuses`, `reproductionStatuses`, and `shelfRoles`. Empty axes do not filter. Text search uses Unicode lowercase and space-normalized metadata only; it never searches OCR or note bodies. `matchPaperQuery` returns `{ matched, hits: [{ field, snippet }] }` using the fixed Chinese field labels `中文标题`, `英文标题`, `作者`, `论文 ID`, `研究方向`, `方法标签`, `网络标签`, and `问题标签`; each snippet is the complete matched metadata value, capped to 120 Unicode characters, and result rows show it beside the field label.

`summarizeShelfRole` follows the current stable paper order, returns at most three display titles, and returns `overflow: Math.max(0, count - 3)`. Clicking a shelf role sets `filters.shelfRoles` to exactly that role and scrolls/focuses the result-count heading; clicking the active role again clears only that shelf filter. `buildLibraryViewState` is the pure, directly tested source for result count, rows, four shelf summaries, selected record, empty state, and hit fields.

Use a fixed contribution-role weight map only for manually confirmed roles:

```js
const CONTRIBUTION_WEIGHT = {
  foundational: 5,
  key_method_turn: 4,
  theory_improvement: 3,
  application: 2,
  combination: 1,
  unclassified: 0,
}
```

The default comparator is: shelf membership descending, numeric `p02_relevance` descending with `null` last, role weight descending, material count descending, year descending with `null` last, Chinese/English/title/ID locale order. Explicit modes are `title`, `year`, `contribution`, and `evidence`.

- [ ] **Step 4: Write failing localStorage tests**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { createWorkspaceStore } from "./paper-library-storage.mjs"

function fakeStorage() {
  const data = new Map()
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}

test("persists four P02 roles without changing paper formal state", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.toggleShelfRole("Xi18-ADDOPT", "algorithm_mechanism")
  store.toggleShelfRole("Xi18-ADDOPT", "theory_evidence")
  assert.deepEqual(store.read().shelf["Xi18-ADDOPT"], ["algorithm_mechanism", "theory_evidence"])
})

test("personal reading markers are stored separately from the shelf", () => {
  const storage = fakeStorage()
  const store = createWorkspaceStore(storage)
  store.setPersonalReadingMarker("Xi18-ADDOPT", "reading")
  assert.equal(store.read().personalReading["Xi18-ADDOPT"], "reading")
  assert.deepEqual(store.read().shelf, {})
})

test("invalid persisted JSON safely returns an empty versioned state", () => {
  const storage = fakeStorage()
  storage.setItem("research-console.paper-library.v1", "{")
  assert.deepEqual(createWorkspaceStore(storage).read(), {
    version: 1, shelf: {}, personalReading: {}, selectedPaperId: null,
  })
})
```

- [ ] **Step 5: Run storage tests and confirm RED**

Run:

```bash
node --test prototype/desktop/paper-library-storage.test.mjs
```

Expected: FAIL because the storage module does not exist.

- [ ] **Step 6: Implement the versioned browser store**

`paper-library-storage.mjs` exports:

```js
export const WORKSPACE_STORAGE_KEY = "research-console.paper-library.v1"
export function createWorkspaceStore(storage)
```

The returned object exposes `read`, `toggleShelfRole`, `setPersonalReadingMarker`, `setSelectedPaper`, and `clear`. Validate paper IDs and enum values on every mutation, sort role arrays in the fixed `P02_ROLES` order, and recover from malformed/older data by returning the empty version-1 state. It must never write into a paper record or generated JSON.

- [ ] **Step 7: Verify Task 5 GREEN**

Run:

```bash
node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-storage.test.mjs
node --check prototype/desktop/paper-library-model.mjs
node --check prototype/desktop/paper-library-storage.mjs
```

Expected: all tests pass. Do not commit.

---

### Task 6: Build the Desktop Library Page, Inspector, and Same-Page Detail

**Files:**
- Create: `prototype/desktop/library.template.html`
- Create: `prototype/desktop/library.mjs`
- Create: `prototype/desktop/paper-inspector.mjs`
- Create: `prototype/desktop/paper-library-dom.test.mjs`
- Modify: `prototype/desktop/styles.css`
- Modify: `prototype/desktop/index.html`
- Modify: `prototype/desktop/directions.html`
- Modify: `prototype/desktop/p02.html`
- Modify: `exporter/paper-library/build.mjs`

- [ ] **Step 1: Add a failing static DOM-contract test**

Read `library.template.html` as text and assert the required accessible anchors exist:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const html = await readFile(new URL("./library.template.html", import.meta.url), "utf8")

test("library template exposes the complete desktop interaction contract", () => {
  for (const id of [
    "library-search", "p02-shelf", "library-filters", "library-results",
    "library-inspector", "library-detail", "library-empty", "library-error",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`))

  assert.match(html, /aria-label="论文库主导航"/)
  assert.match(html, /<html lang="zh-CN">/)
  assert.doesNotMatch(html, /Unknown|Not Reported/)
})
```

- [ ] **Step 2: Run the DOM test and confirm RED**

Run:

```bash
node --test prototype/desktop/paper-library-dom.test.mjs
```

Expected: FAIL because the template does not exist.

- [ ] **Step 3: Create the desktop semantic template**

Use the existing application shell and internal glass visual language. The exact page order is:

```text
window bar
├─ left navigation (224–260px)
├─ center main column (minmax(650px, 1fr))
│  ├─ title + search + “搜索新论文” disabled/explanatory entry
│  ├─ P02 four-slot shelf
│  ├─ filters + sort + reset
│  ├─ result count + warning summary
│  ├─ compact paper list
│  ├─ explicit empty/error states
│  └─ same-page detail panel with safe preferred-note preview
└─ right inspector (276–320px)
```

Required IDs and behavior hooks:

```text
library-search                 search input
p02-shelf                     four role buttons with data-role
library-filters               fieldsets for tag/status axes
library-sort                  select with default/title/year/contribution/evidence
library-reset                 reset filters only
library-results               table/list body
library-count                 visible filtered/total count
library-warning-summary       scan warning count, no absolute paths
library-empty                 no matching papers
library-error                 index load/build error
library-inspector             selected paper summary
library-detail                same-page detail view
library-detail-back           return to list
library-note-preview          safe fragment mount point
```

All controls use real `<button>`, `<input>`, `<select>`, `<fieldset>`, and `<legend>` elements. Status badges contain Chinese text. The table container, not the whole page, may scroll horizontally.

- [ ] **Step 4: Implement DOM rendering as small functions**

`paper-inspector.mjs` exports:

```js
export function renderInspector({ document, paper, workspaceState })
export function renderSamePageDetail({ document, paper, workspaceState })
```

Both functions return DOM nodes, not unsanitized HTML strings. Artifact paths are shown as counts. The inspector may copy the original private path only after a user clicks `复制原始路径`; that click fetches the ignored private audit, reads `private_path_lookup[selectedPaperId]`, writes it directly to the clipboard, then discards it. The absolute path is never placed in `paper-index.json`, visible HTML, a data attribute, a public URL, or console output. A missing clipboard/audit entry shows `原始路径暂不可用`.

`library.mjs` exports pure or injectable functions for testing:

```js
export async function loadPaperIndex(fetchImpl = fetch)
export function createLibraryController({ document, storage, fetchImpl })
export function renderPaperRows({ document, papers, workspaceState })
```

Runtime sequence:

1. fetch `../../local_library_data/paper-index.json`;
2. validate `{ version: 1, papers: [] }` before rendering;
3. restore the browser workspace store;
4. search/filter/sort through the pure model;
5. render every shelf role with total count, at most three stable titles, and `另有 N 篇`; clicking a role toggles its shelf filter;
6. render row buttons with hit-field labels and select the persisted paper when it still exists;
7. update inspector after selection;
8. update shelf and reading marker in localStorage only;
9. open same-page detail without changing route;
10. fetch `note_preview_url` only when the detail panel is opened;
11. show `已有阅读笔记；首版尚未生成网页预览` when notes exist without a preview, and `尚无阅读笔记` when no note exists;
12. fetch the private audit only after `复制原始路径`, never during initial page load;
13. focus search on `Cmd/Ctrl + K` and preserve visible focus rings.

Never fetch a `file://` or `/Users/...` URL. If index fetch fails, show `论文库尚未构建，请先运行本地构建命令` and keep navigation functional.

- [ ] **Step 5: Add the library-specific CSS**

Prefix new component selectors with `.library-` to avoid the prior generic `header` grid collision. Add:

- `.library-shell` three-column grid;
- `.library-main` bright white content layer;
- `.library-shelf-grid` four equal slots at 1440 and two-by-two at 1280;
- `.library-toolbar` wrapping controls;
- `.library-table-wrap` internal overflow;
- `.library-paper-row` selected, focus, and keyboard states;
- `.library-inspector` sticky internal panel;
- `.library-detail` readable max-width and note typography;
- `.library-status-*` badges with icon/text as well as color;
- `.library-empty-state` and `.library-error-state`.

Do not add broad gray panels, forced equal-height cards, decorative full-page glass, hover-only affordances, fake charts, or completion percentages. Keep metadata near the upper left and research content on white-based layers.

- [ ] **Step 6: Link the paper library from all three existing desktop pages**

Replace the existing paper-library hash links in:

```text
prototype/desktop/index.html
prototype/desktop/directions.html
prototype/desktop/p02.html
```

with:

```html
<a class="nav-item" href="../../local_library_output/desktop/library.html"><span aria-hidden="true">▤</span><span>论文库</span></a>
```

Keep the current dashboard library summary section; only its `查看全部论文` action should point to the generated library page.

- [ ] **Step 7: Make the build copy only the approved desktop assets**

`buildPrivateLibrary` copies these files into `local_library_output/desktop/assets/`:

```text
styles.css
library.mjs
paper-inspector.mjs
paper-library-model.mjs
paper-library-storage.mjs
```

It copies `library.template.html` to `local_library_output/desktop/library.html` without embedding private JSON or notes. The generated page links back to:

```text
../../prototype/desktop/index.html
../../prototype/desktop/directions.html
../../prototype/desktop/p02.html
```

- [ ] **Step 8: Add pure view-state and static DOM tests**

Extend `paper-library-model.test.mjs` with exact `buildLibraryViewState` assertions and extend `paper-library-dom.test.mjs` with template hooks. Required assertions:

- zero papers shows `library-empty`;
- failed index fetch shows the Chinese build instruction;
- selecting a row changes only `selectedPaperId`;
- adding a shelf role changes localStorage but leaves the frozen paper record byte-for-byte equal;
- setting `read` does not change `source_status` or `evidence_status`;
- multi-value same-axis filters use OR;
- clear filters preserves shelf and personal reading markers;
- a shelf role summary contains only three titles plus `overflow`;
- clicking-contract buttons have `data-role` and `aria-pressed` hooks;
- hit-field placeholders exist in each row template contract;
- a paper with note artifacts but no preview uses `已有阅读笔记；首版尚未生成网页预览`;
- `Unknown` and `Not Reported` never appear in rendered text.

Do not invent a partial fake DOM. Pure state is covered by `buildLibraryViewState`; HTML structure is covered by the static contract; actual event wiring, clipboard behavior, focus, persistence, and console errors are covered by the Playwright acceptance script in Task 8.

- [ ] **Step 9: Verify Task 6 GREEN before real data**

Run:

```bash
node --test prototype/desktop/paper-library-dom.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-storage.test.mjs
node --check prototype/desktop/library.mjs
node --check prototype/desktop/paper-inspector.mjs
node --test prototype/desktop/*.test.mjs
```

Expected: all old and new prototype tests pass, and no dependency was installed. Do not commit.

---

### Task 7: Add the Future GitHub Package-Boundary Audit and User Documentation

**Files:**
- Create: `exporter/paper-library/package-audit.mjs`
- Create: `exporter/paper-library/package-audit.test.mjs`
- Create: `exporter/scripts/audit-github-package.mjs`
- Create: `exporter/config/github-package-files.json`
- Create: `README.md`
- Modify: `prototype/desktop/README.md`

- [ ] **Step 1: Write failing package-boundary tests**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { auditPackageCandidates } from "./package-audit.mjs"

test("allows program, templates, tests, and sanitized examples", () => {
  const result = auditPackageCandidates([
    { path: "exporter/paper-library/scanner.mjs", content: "export {}" },
    { path: "exporter/config/library.example.json", content: '"REPLACE_WITH_ABSOLUTE_PATH"' },
    { path: "prototype/desktop/library.template.html", content: "<main></main>" },
  ])
  assert.deepEqual(result.blocking, [])
})

test("blocks private directories and real paper artifacts", () => {
  const result = auditPackageCandidates([
    { path: "local_library_config/library.local.json", content: "{}" },
    { path: "local_library_data/paper-index.json", content: "{}" },
    { path: "papers/paper.pdf", content: "" },
    { path: "notes/paper_论文精读.md", content: "私人笔记" },
  ])
  assert.equal(result.blocking.length, 4)
})

test("blocks absolute paths, secrets, OCR, translations, and private results", () => {
  const privatePath = ["", "Users", "example", "papers", "论文"].join("/")
  const apiKey = ["API", "KEY=secret"].join("_")
  const result = auditPackageCandidates([
    { path: "exporter/leak.txt", content: privatePath },
    { path: ".env", content: apiKey },
    { path: "data/paper_ocr.md", content: "全文" },
    { path: "data/paper_中文翻译.md", content: "全文" },
    { path: "results/private-result.png", content: "" },
  ])
  assert.equal(result.blocking.length, 5)
})
```

- [ ] **Step 2: Run the package audit test and confirm RED**

Run:

```bash
node --test exporter/paper-library/package-audit.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement explicit allowlist plus leak detection**

`package-audit.mjs` exports:

```js
export function auditPackageCandidates(candidates)
export async function collectPackageCandidates({ repoRoot, manifestPath })
```

The candidate collector reads `exporter/config/github-package-files.json`, which contains an explicit sorted `files` array. It must not expand directory wildcards. The first milestone manifest lists only:

```text
.gitignore
README.md
exporter/config/library.example.json
exporter/config/github-package-files.json
each named exporter/paper-library/*.mjs module and *.test.mjs test
exporter/scripts/build-private-library.mjs
exporter/scripts/audit-github-package.mjs
prototype/desktop/library.template.html
prototype/desktop/library.mjs
prototype/desktop/paper-inspector.mjs
prototype/desktop/paper-library-model.mjs
prototype/desktop/paper-library-model.test.mjs
prototype/desktop/paper-library-storage.mjs
prototype/desktop/paper-library-storage.test.mjs
prototype/desktop/paper-library-dom.test.mjs
prototype/desktop/styles.css
prototype/desktop/README.md
```

Write the manifest as a versioned JSON object with these exact relative paths, sorted lexically by the implementation before validation:

```json
{
  "version": 1,
  "files": [
    ".gitignore",
    "README.md",
    "exporter/config/github-package-files.json",
    "exporter/config/library.example.json",
    "exporter/paper-library/artifacts.mjs",
    "exporter/paper-library/build.mjs",
    "exporter/paper-library/build.test.mjs",
    "exporter/paper-library/config.mjs",
    "exporter/paper-library/config.test.mjs",
    "exporter/paper-library/frontmatter.mjs",
    "exporter/paper-library/ids.mjs",
    "exporter/paper-library/ids.test.mjs",
    "exporter/paper-library/note-preview.mjs",
    "exporter/paper-library/note-preview.test.mjs",
    "exporter/paper-library/overrides.mjs",
    "exporter/paper-library/package-audit.mjs",
    "exporter/paper-library/package-audit.test.mjs",
    "exporter/paper-library/scanner.mjs",
    "exporter/paper-library/scanner.test.mjs",
    "exporter/paper-library/status.mjs",
    "exporter/paper-library/status.test.mjs",
    "exporter/scripts/audit-github-package.mjs",
    "exporter/scripts/build-private-library.mjs",
    "prototype/desktop/README.md",
    "prototype/desktop/library.mjs",
    "prototype/desktop/library.template.html",
    "prototype/desktop/paper-inspector.mjs",
    "prototype/desktop/paper-library-dom.test.mjs",
    "prototype/desktop/paper-library-model.mjs",
    "prototype/desktop/paper-library-model.test.mjs",
    "prototype/desktop/paper-library-storage.mjs",
    "prototype/desktop/paper-library-storage.test.mjs",
    "prototype/desktop/styles.css"
  ]
}
```

The collector rejects duplicate, missing, absolute, `..`, directory, symlink, and unlisted paths. Existing unrelated prototype pages, design specifications, local verification scripts, runtime output, and screenshots are not package candidates until separately reviewed and added by exact path. This avoids treating the entire existing prototype as automatically sanitized.

The audit blocks:

- candidate path segments named `local_library_config`, `local_library_data`, or `local_library_output` (textual documentation of these names in `.gitignore`/README is allowed);
- `.pdf`, `.env`, private key, database, archive, or cache extensions;
- candidate file names containing `ocr`, `中文翻译`, `全文翻译`, `论文精读`, `secret`, or `result`;
- content containing `/Users/`, `/home/`, Windows drive absolute paths, `API_KEY=`, `TOKEN=`, or `PASSWORD=`;
- generated JSON that contains `root_path`, `paper_dir`, or artifact source paths.

The one allowed path placeholder is the exact text `REPLACE_WITH_ABSOLUTE_PATH` inside `exporter/config/library.example.json`. Both tests and the audit implementation construct forbidden absolute-root and secret signatures from string fragments at runtime, so the audit source files do not contain the forbidden literals they are designed to detect and can audit themselves honestly.

- [ ] **Step 4: Implement a read-only package audit CLI**

`exporter/scripts/audit-github-package.mjs` prints:

```text
GitHub 打包审计：通过（N 个候选文件）
```

or exits non-zero with each relative path and reason. It does not create an archive, repository, commit, or remote.

- [ ] **Step 5: Document the local workflow and the user's three future GitHub decisions**

The root `README.md` must explain in Chinese:

1. the private source is read-only;
2. copy `library.example.json` to the ignored local config and replace the path;
3. run `node exporter/scripts/build-private-library.mjs`;
4. serve the repository root with `python3 -m http.server 4176 --bind 127.0.0.1`;
5. open `http://127.0.0.1:4176/local_library_output/desktop/library.html`;
6. deleting `local_library_data/` and `local_library_output/` is safe because they rebuild;
7. moving the whole source root requires changing only `path` while preserving `source_id`;
8. renaming an internal paper folder with only a path-hash ID requires a private override to keep the old ID;
9. future GitHub packaging includes program/templates/tests/sanitized examples only;
10. the user later decides only repository name, public/private visibility, and license;
11. remote creation, push, Quartz integration, and deployment require separate confirmation.

Update `prototype/desktop/README.md` with the generated library URL and the build command. Do not claim that Quartz is already integrated.

- [ ] **Step 6: Verify Task 7 GREEN**

Run:

```bash
node --test exporter/paper-library/package-audit.test.mjs
node --check exporter/paper-library/package-audit.mjs
node --check exporter/scripts/audit-github-package.mjs
node exporter/scripts/audit-github-package.mjs
```

Expected: tests pass and the CLI reports a passing allowlisted candidate set without creating anything. Do not commit.

---

### Task 8: Run the First Real Private Build and Complete Desktop Acceptance

**Files:**
- Modify if required by discovered real formats: `local_library_config/paper-overrides.json` (ignored private file only)
- Modify if required by a reproducible adapter defect: `exporter/paper-library/*.mjs` and matching tests
- Generate: `local_library_data/paper-index.json`
- Generate: `local_library_data/paper-library-audit.json`
- Create: `exporter/verification/private_library_e2e.py` (local acceptance helper; excluded from package manifest)
- Generate: `local_library_data/notes/{validated-slug}/preferred.html`
- Generate: `local_library_output/desktop/library.html`
- Generate: `local_library_output/desktop/assets/*`
- Generate: `output/playwright/paper-library-1280.png`
- Generate: `output/playwright/paper-library-1440.png`

- [ ] **Step 1: Run the complete automated suite before touching real data**

Run:

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
for PAPER_LIBRARY_FILE in exporter/paper-library/*.mjs; do node --check "$PAPER_LIBRARY_FILE" || exit 1; done
for PAPER_LIBRARY_FILE in exporter/scripts/*.mjs; do node --check "$PAPER_LIBRARY_FILE" || exit 1; done
for PAPER_LIBRARY_FILE in prototype/desktop/*.mjs; do node --check "$PAPER_LIBRARY_FILE" || exit 1; done
node exporter/scripts/audit-github-package.mjs
```

Expected: zero failures. Stop and fix with a new regression test if anything fails.

- [ ] **Step 2: Record a read-only source snapshot**

Use two fixed, task-specific temporary paths so separate command invocations do not lose shell variables. Record file path, byte size, and modification timestamp. Do not hash or print note bodies:

```bash
find /Users/yangfan/Desktop/papers/论文 -type f -exec stat -f '%N|%z|%m' {} \; | LC_ALL=C sort > /tmp/codex-paper-library-source-before-20260827.txt
```

The snapshot is only verification data in `/tmp`; it is not a project artifact.

- [ ] **Step 3: Run the real private build once**

Run:

```bash
node exporter/scripts/build-private-library.mjs
```

Expected output names only counts and these relative targets:

```text
local_library_data/paper-index.json
local_library_data/paper-library-audit.json
local_library_output/desktop/library.html
```

If the build reports a duplicate explicit ID, external symlink, ambiguous multi-note choice, or unrecognized real layout:

- do not rename or edit the source;
- add a minimal private override only when it is a factual identity, preferred-file, or pure-Chinese-title artifact classification decision;
- otherwise add a failing fixture test, repair the adapter, rerun all scanner tests, then rebuild;
- do not infer titles, contribution roles, evidence states, or P02 relevance merely to make the page look complete.

After the first successful index, ensure the milestone has exactly one controlled preview without making an academic judgment: select the lexically first record by `paper_id` whose `identity_source !== "path_hash"` and whose `artifacts.note.length === 1`. Add only `preview_note: true` and that exact source-relative `preferred_note` to its ignored private override using `apply_patch`, preserving any existing confirmed fields, then rebuild. If no such unambiguous record exists, stop and report that the one-note preview gate cannot be met without a user choice; do not choose among multiple notes or render all notes.

- [ ] **Step 4: Validate the generated private data semantics**

Run a Node assertion without printing private records:

```bash
node -e "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync('local_library_data/paper-index.json','utf8'));if(x.version!==1||!Array.isArray(x.papers)||x.papers.length===0)throw Error('索引为空或版本错误');for(const p of x.papers){if(!p.paper_id||!p.source_id||!p.relative_path)throw Error('身份字段缺失');if(JSON.stringify(p).match(/Unknown|Not Reported/))throw Error('存在英文缺失占位');}console.log('私有索引语义检查：通过，共 '+x.papers.length+' 条');"
```

Inspect only aggregate audit counts and warning categories. Do not paste absolute paths, note bodies, or private filenames into tracked documentation.

Assert from the aggregate audit that `generated_note_previews === 1`, `generated_pages === 2` (library page plus one preview), and `standard_units + identity_pending_units === paper_units`.

- [ ] **Step 5: Prove the source directory was not modified**

Run:

```bash
find /Users/yangfan/Desktop/papers/论文 -type f -exec stat -f '%N|%z|%m' {} \; | LC_ALL=C sort > /tmp/codex-paper-library-source-after-20260827.txt
cmp /tmp/codex-paper-library-source-before-20260827.txt /tmp/codex-paper-library-source-after-20260827.txt
```

Expected: `cmp` is silent and exits 0. If it differs, stop immediately, preserve both snapshots for diagnosis, and do not claim acceptance.

- [ ] **Step 6: Start the existing local static server**

Run in a dedicated terminal:

```bash
python3 -m http.server 4176 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4176/local_library_output/desktop/library.html
```

Verify HTTP 200 for the page, index, assets, and one generated note preview. Verify there are no `file://` or absolute local HTTP requests.

- [ ] **Step 7: Exercise the actual interactions**

On real records, verify:

- Chinese, English, author, ID, and tag search;
- same-axis OR and cross-axis AND filters;
- stable default/title/year/contribution/evidence sorting;
- clear filters without clearing workspace state;
- row selection and right-inspector synchronization;
- each of the four P02 roles can be added and removed;
- `未读`, `在读`, and `读过` persist after reload;
- shelf and reading markers do not alter formal status text;
- one approved note preview renders safely;
- no-note and multi-note entries show explicit Chinese empty/warning states;
- `Cmd/Ctrl + K`, tab focus, buttons, and visible focus rings work without hover.

- [ ] **Step 8: Capture and inspect both required desktop widths**

Create `exporter/verification/private_library_e2e.py` with the existing local Playwright Python API. It must listen for `console` warning/error, `pageerror`, failed requests, `file://` requests, and HTTP URLs containing `/Users/`; exercise the first paper row, search by its stable ID, add/remove one P02 role, persist a reading marker across reload, toggle the shelf filter, verify `Cmd+K` focus, check `document.documentElement.scrollWidth <= window.innerWidth`, and save both screenshots.

Use these fixed DOM hooks in the template/controller and script:

```text
[data-paper-id]
[data-action="open-detail"]
[data-action="toggle-shelf"][data-role]
[data-action="set-reading"]
[data-shelf-role]
[data-hit-fields]
```

The script exits non-zero on any assertion, console warning/error, page error, failed request, forbidden request, or horizontal overflow. It creates a fresh browser context, clears the versioned localStorage key before interaction, and does not print paper titles, paths, or note content.

Use this executable structure rather than an informal screenshot-only check:

```python
from pathlib import Path
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4176/local_library_output/desktop/library.html"
OUT = Path("output/playwright")
OUT.mkdir(parents=True, exist_ok=True)

def verify_page(browser, width, height, exercise):
    context = browser.new_context(viewport={"width": width, "height": height})
    page = context.new_page()
    problems = []
    page.on("console", lambda message: problems.append(f"console:{message.type}")
            if message.type in ("warning", "error") else None)
    page.on("pageerror", lambda error: problems.append("pageerror"))
    page.on("requestfailed", lambda request: problems.append("requestfailed"))
    page.on("request", lambda request: problems.append("forbidden-request")
            if request.url.startswith("file:") or "/Users/" in unquote(request.url) else None)
    page.goto(URL, wait_until="networkidle")
    page.evaluate("localStorage.removeItem('research-console.paper-library.v1')")
    page.reload(wait_until="networkidle")
    assert page.locator("[data-paper-id]").count() > 0
    assert "Unknown" not in page.locator("body").inner_text()
    assert "Not Reported" not in page.locator("body").inner_text()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

    if exercise:
        first = page.locator("[data-paper-id]").first
        paper_id = first.get_attribute("data-paper-id")
        page.locator("#library-search").fill(paper_id)
        assert page.locator(f'[data-paper-id="{paper_id}"]').count() == 1
        page.locator("#library-search").fill("")
        page.locator(f'[data-paper-id="{paper_id}"]').click()
        page.locator('[data-action="toggle-shelf"][data-role="algorithm_mechanism"]').click()
        page.locator('[data-action="set-reading"][data-marker="read"]').click()
        page.reload(wait_until="networkidle")
        page.locator(f'[data-paper-id="{paper_id}"]').click()
        assert page.locator('[data-action="toggle-shelf"][data-role="algorithm_mechanism"]').get_attribute("aria-pressed") == "true"
        assert page.locator('[data-action="set-reading"][data-marker="read"]').get_attribute("aria-pressed") == "true"
        page.locator('[data-shelf-role="algorithm_mechanism"]').click()
        assert page.locator(f'[data-paper-id="{paper_id}"]').count() == 1
        page.keyboard.press("Meta+K")
        assert page.evaluate("document.activeElement.id") == "library-search"
        page.locator(f'[data-paper-id="{paper_id}"] [data-action="open-detail"]').click()
        assert page.locator("#library-detail").is_visible()

    page.screenshot(path=str(OUT / f"paper-library-{width}.png"), full_page=True)
    assert not problems, problems
    context.close()
    print(f"桌面论文库自动验收：{width}×{height} 通过")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome")
    verify_page(browser, 1280, 720, True)
    verify_page(browser, 1440, 900, False)
    browser.close()
print("控制台与请求检查：通过")
```

Run the acceptance script using the already installed interpreter; do not install Playwright:

```bash
/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py
```

Expected terminal summary:

```text
桌面论文库自动验收：1280×720 通过
桌面论文库自动验收：1440×900 通过
控制台与请求检查：通过
```

Inspect both screenshots. Acceptance requires:

- no page-level horizontal overflow;
- left navigation 224–260px and right inspector 276–320px remain readable;
- shelf is four columns at 1440 and two-by-two at 1280;
- the paper table scrolls internally when necessary;
- long IDs/titles/tags do not overlap controls;
- content stays white-based and visually calmer than navigation/tool surfaces;
- no giant empty regions, forced equal-height cards, or English UI remnants.

- [ ] **Step 9: Verify rebuildability and ignore boundaries**

First record aggregate counts and sorted paper IDs. Then remove only the two exact generated directories with this basename and parent guard:

```bash
node -e "const fs=require('node:fs');const path=require('node:path');const root=path.resolve(process.cwd());for(const name of ['local_library_data','local_library_output']){const target=path.resolve(root,name);if(path.dirname(target)!==root||path.basename(target)!==name)throw Error('拒绝清理非生成目录');fs.rmSync(target,{recursive:true,force:true});}console.log('已清理两个可重建私有生成目录');"
```

Re-run the build and compare semantic counts and sorted paper IDs rather than `generated_at` timestamps. Finally run:

```bash
git check-ignore -v local_library_data/paper-index.json
git check-ignore -v local_library_output/desktop/library.html
git check-ignore -v local_library_config/paper-overrides.json
node exporter/scripts/audit-github-package.mjs
```

Expected: all three private paths are ignored and the GitHub package audit passes.

- [ ] **Step 10: Final acceptance report without deployment**

Report only:

- number of indexed paper units;
- standard vs identity-pending counts;
- number of controlled note previews;
- aggregate warning categories and counts;
- automated test result;
- 1280/1440 visual result;
- confirmation that source snapshots match;
- local library URL;
- remaining private override decisions, if any;
- explicit statement that Quartz integration, GitHub creation, PDF upload, and public deployment were not performed.

Do not include private note text, absolute paper paths, or the override file contents in the report. Do not commit.

---

## Milestone Exit Gate

The first milestone is complete only when all of the following are true:

- every automated test passes;
- the real source before/after snapshot is identical;
- the generated index has stable IDs and no blocking identity/slug conflict;
- conservative research-state rules are preserved;
- all missing information is rendered in explicit Chinese;
- search, filters, sorting, inspector, four-slot shelf, personal reading markers, detail panel, and one safe note preview work;
- the 1280×720 and 1440×900 screenshots pass visual inspection;
- the three private directories are ignored;
- the GitHub package audit passes;
- no dependency, Quartz integration, Git operation, remote repository, upload, or deployment occurred.

Only after this gate and the user's visual/data-semantic acceptance should a separate plan add five-tab paper routes and the Quartz adapter.
