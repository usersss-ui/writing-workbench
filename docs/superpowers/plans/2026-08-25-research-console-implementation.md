# Academic Research Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic Quartz 5 static research console from explicitly public, sanitized Markdown/YAML fixtures without exposing or modifying the private vault.

**Architecture:** A Node.js exporter validates a deny-by-default allowlist, rewrites safe links, derives public JSON, renders generated dashboard sections, and atomically creates `site_content/`. A pinned Quartz 5 checkout reads only `site_content/` and emits `site_output/`; local browser JavaScript supplies static filtering and search, while post-build audits prove privacy, link integrity, responsive behavior, and reproducibility.

**Tech Stack:** Node.js 22.22.3, npm 10.9.8, Quartz 5.0.0 at commit `075afd3f712da0088a07f5284a7b3aba37dd61b6`, ECMAScript modules, Node test runner, TypeScript/Preact components already provided by Quartz, YAML 2.8.2, MathJax, Mermaid 11.17.1, headless Chrome CDP.

**Spec:** `docs/superpowers/specs/2026-08-25-research-console-design.md`

## Global Constraints

- Private vault root is `/Users/yangfan/Desktop/papers/` and remains read-only.
- Site repository root is `/Users/yangfan/Documents/ChatGPT/html/`.
- Quartz reads only `site_content/`; it never reads the private vault.
- First prototype data comes only from `exporter/fixtures/` and every public fixture has `demo: true`.
- Publication requires `publish: true`, list-valued `visibility` containing `public_notes` or `published`, an explicit allowlist entry, an allowed `content_type`, and successful privacy/link/asset checks.
- PDF, OCR, full translation, private code, raw data, credentials, absolute paths, caches, temporary files, and symlink sources are rejected.
- `assets.yml` is empty for the prototype; any local attachment embed fails preflight.
- P01 is `Published` with `published_snapshot.state: Frozen`; P02 is independently `Active`; P03 is `Not Reported` and has no detail page.
- P01→P02 comes only from `relations.yml`; D-C01 explicitly links to supporting paper claims.
- Routes use lowercase explicit slugs; Chinese filenames are never the routing source.
- Missing values render as `Unknown`; explicit `not_reported` renders as `Not Reported`.
- Public UI and search never contain `source_path` or private relative paths.
- Required browser widths are 375px, 768px, and 1440px; touch targets are at least 44×44px.
- Tables, display math, and relation diagrams scroll within local containers; the root page must not clip content.
- Site has no database, backend, authentication, remote fonts, CDN runtime, remote repository, deployment configuration, or deployment step.
- Every production behavior follows red-green-refactor. Configuration and mechanically vendored Quartz source are still covered by failing integration tests before customization.

---

### Task 1: Pin the Quartz baseline and repository skeleton

**Files:**

- Create: `.gitignore`
- Create: `README.md`
- Create: `exporter/tests/quartz-baseline.test.mjs`
- Create mechanically from approved local baseline: `quartz/`
- Modify: `quartz/package.json`
- Create: `quartz/quartz-pin.json`
- Create: `quartz/scripts/preview.mjs`

**Interfaces:**

- Consumes: approved local Quartz source at `/Users/yangfan/Desktop/papers/.research-site/`.
- Produces: a non-nested-Git `quartz/` directory with `npm ci`-reproducible dependencies and no deployment workflows, private content, generated output, or inherited `node_modules`.

- [ ] **Step 1: Write the failing Quartz baseline test**

```js
// exporter/tests/quartz-baseline.test.mjs
import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "../..")

test("pins an isolated Quartz 5 baseline without deployment workflows", async () => {
  const pin = JSON.parse(await readFile(path.join(root, "quartz/quartz-pin.json"), "utf8"))
  assert.equal(pin.quartz_version, "5.0.0")
  assert.equal(pin.commit, "075afd3f712da0088a07f5284a7b3aba37dd61b6")
  await access(path.join(root, "quartz/quartz/build.ts"))
  await assert.rejects(access(path.join(root, "quartz/.git")))
  await assert.rejects(access(path.join(root, "quartz/.github/workflows/deploy-v5.yaml")))
})
```

- [ ] **Step 2: Run the baseline test and verify the expected failure**

Run: `node --test exporter/tests/quartz-baseline.test.mjs`

Expected: FAIL because `quartz/quartz-pin.json` does not exist.

- [ ] **Step 3: Add generated-directory exclusions**

```gitignore
.worktrees/
site_content/
site_output/
audits/
quartz/node_modules/
quartz/.quartz-cache/
quartz/public/
quartz/staging/
*.log
.DS_Store
```

- [ ] **Step 4: Vendor the approved Quartz source without private/generated material**

Run from repository root:

```bash
rsync -a \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='node_modules' \
  --exclude='docs' \
  --exclude='public' \
  --exclude='staging' \
  --exclude='output' \
  --exclude='audit' \
  --exclude='tests' \
  --exclude='scripts' \
  --exclude='schema' \
  --exclude='prototype-allowlist.json' \
  /Users/yangfan/Desktop/papers/.research-site/ quartz/
```

Create `quartz/quartz-pin.json` with the exact repository, branch, commit, version, and pin date from the approved design.

- [ ] **Step 5: Normalize Quartz scripts for the external content/output directories**

`quartz/package.json` must expose:

```json
{
  "scripts": {
    "check": "tsc --noEmit && npx prettier . --check",
    "test": "tsx --test",
    "bundle:mermaid": "node scripts/bundle-mermaid.mjs",
    "export:research": "node ../exporter/bin/export.mjs",
    "build:research": "npm run bundle:mermaid && npm run export:research && npx quartz build -d ../site_content -o ../site_output && node scripts/copy-research-assets.mjs && node ../exporter/bin/audit-built-site.mjs",
    "preview:research": "node scripts/preview.mjs"
  }
}
```

Preserve all existing dependency and engine declarations. Remove scripts whose targets were intentionally excluded.

- [ ] **Step 6: Install only the pinned Quartz dependency tree**

Run: `npm ci`

Working directory: `quartz/`

Expected: exit 0 with Node 22 and npm 10.

- [ ] **Step 7: Run the baseline test and Quartz type baseline**

Run: `node --test exporter/tests/quartz-baseline.test.mjs`

Expected: PASS.

Run: `npm run check -- --ignore-unknown`

If the inherited command does not accept the appended option, run `npx tsc --noEmit` as the type baseline and record that exact command in README.

- [ ] **Step 8: Commit the baseline**

```bash
git add .gitignore README.md exporter/tests/quartz-baseline.test.mjs quartz
git commit -m "chore: pin isolated Quartz 5 baseline"
```

---

### Task 2: Implement frontmatter parsing and deny-by-default publication policy

**Files:**

- Create: `exporter/src/yaml-runtime.mjs`
- Create: `exporter/src/frontmatter.mjs`
- Create: `exporter/src/policy.mjs`
- Create: `exporter/src/schema.mjs`
- Create: `exporter/schemas/base-content.schema.json`
- Create: `exporter/schemas/paper.schema.json`
- Create: `exporter/schemas/claim.schema.json`
- Create: `exporter/tests/policy.test.mjs`

**Interfaces:**

- Produces: `parseMarkdown(source, sourcePath) -> { data, body }`.
- Produces: `renderMarkdown(data, body) -> string`.
- Produces: `validateEntity(entityType, data, sourcePath) -> void`, throwing `PreflightError` on invalid records.
- Produces: `assertPublishable({ data, entry, sourcePath, sourceStats }) -> void`.
- Produces: `scanSensitiveContent(source, sourcePath) -> void`.

- [ ] **Step 1: Read the TDD test-quality reference before writing tests**

Read completely: `/Users/yangfan/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/test-driven-development/writing-good-tests.md`.

- [ ] **Step 2: Write failing publication-policy tests**

Cover these independent behaviors with one test each:

```js
test("accepts only publish true with list-valued public visibility", () => {
  assert.doesNotThrow(() => assertPublishable(validContext()))
})

test("rejects a missing publish flag", () => {
  assert.throws(() => assertPublishable(validContext({ publish: undefined })), /publish/i)
})

test("rejects string-valued visibility", () => {
  assert.throws(() => assertPublishable(validContext({ visibility: "published" })), /list/i)
})

test("rejects advisor-only content even when publish is true", () => {
  assert.throws(
    () => assertPublishable(validContext({ visibility: ["advisor_only"] })),
    /public_notes|published/i,
  )
})

test("rejects absolute paths and credential markers", () => {
  assert.throws(() => scanSensitiveContent("/Users/example/private.csv", "note.md"), /absolute/i)
  assert.throws(() => scanSensitiveContent("sk-abcdefghijklmnopqrstuvwxyz1234", "note.md"), /credential/i)
})
```

Also test malformed frontmatter, missing title, symlink metadata, disallowed content types, `publish_pdf: true`, and `publish_ocr: true`.

- [ ] **Step 3: Run policy tests and verify missing-module failures**

Run: `node --test exporter/tests/policy.test.mjs`

Expected: FAIL because policy/frontmatter modules do not exist.

- [ ] **Step 4: Implement the minimal YAML/frontmatter and policy modules**

Use `createRequire(path.join(siteRoot, "quartz/package.json"))` to load the already installed `yaml` package; do not add a second dependency tree. Implement an error type:

```js
export class PreflightError extends Error {
  constructor(message) {
    super(`publish preflight: ${message}`)
    this.name = "PreflightError"
  }
}
```

Runtime schema validation must read the committed JSON schema definitions and support the exact keywords used by them: `type`, `required`, `enum`, `const`, `items`, `minItems`, `uniqueItems`, and nested `properties`. Unsupported schema keywords cause a startup error instead of being ignored.

- [ ] **Step 5: Run policy tests to green and refactor shared fixtures**

Run: `node --test exporter/tests/policy.test.mjs`

Expected: all policy tests PASS with no warnings.

- [ ] **Step 6: Commit publication policy**

```bash
git add exporter/src exporter/schemas exporter/tests/policy.test.mjs
git commit -m "feat: enforce public content policy"
```

---

### Task 3: Implement safe links, empty-asset enforcement, and atomic staging

**Files:**

- Create: `exporter/src/paths.mjs`
- Create: `exporter/src/links.mjs`
- Create: `exporter/src/assets.mjs`
- Create: `exporter/src/publisher.mjs`
- Create: `exporter/tests/publisher.test.mjs`
- Create: `exporter/config/assets.yml`

**Interfaces:**

- Produces: `resolveInside(root, relativePath, label) -> string`.
- Produces: `rewritePublishedLinks(body, document, publicIndex) -> { body, links }`.
- Produces: `assertNoUnauthorizedAssets(body, sourcePath, assetRegistry) -> void`.
- Produces: `stagePublishedContent(options) -> Promise<PublicationManifest>`.
- `stagePublishedContent` writes to `<site_content>.next` and replaces `site_content/` only after every file passes.

- [ ] **Step 1: Write failing publisher tests**

Tests must use `mkdtemp()` outside the repository and real files. Cover:

```js
test("rewrites links between published documents to stable destinations", async () => {
  const ws = await makeWorkspace({
    "p01.md": publicNote("P01", "papers/p01", "See [[p02|后续论文]]."),
    "p02.md": publicNote("P02", "papers/p02", "P02 body"),
  })
  const result = await stageFixture(ws)
  assert.match(await readFile(join(result.outputRoot, "papers/p01.md"), "utf8"), /\[后续论文\]\(\/papers\/p02\/\)/)
})

test("redacts links to explicitly private documents without exposing their path", async () => {
  const ws = await makeWorkspace({
    "public.md": publicNote("P01", "papers/p01", "See [[导师交流/秘密方案|内部记录]]."),
    "导师交流/秘密方案.md": "---\npublish: false\n---\nprivate sentinel",
  })
  const result = await stageFixture(ws)
  const published = await readFile(join(result.outputRoot, "papers/p01.md"), "utf8")
  assert.match(published, /内部记录/)
  assert.doesNotMatch(published, /导师交流|秘密方案|private sentinel/)
})

test("hard-fails missing and ambiguous public targets", async () => {
  await assert.rejects(() => stageFixture(await makeMissingLinkWorkspace()), /missing public target/i)
  await assert.rejects(() => stageFixture(await makeAmbiguousLinkWorkspace()), /ambiguous public target/i)
})

test("rejects every local embed while assets.yml is empty", async () => {
  const ws = await makeWorkspace({ "p01.md": publicNote("P01", "papers/p01", "![[figure.png]]") })
  await assert.rejects(() => stageFixture(ws), /asset is not explicitly authorized/i)
})

test("rejects source and destination path traversal", async () => {
  assert.throws(() => resolveInside("/safe/root", "../secret.md", "source"), /escapes source root/i)
  const ws = await makeWorkspace({ "p01.md": publicNote("P01", "../escape", "body") })
  await assert.rejects(() => stageFixture(ws), /invalid destination/i)
})

test("preserves the previous site_content when a later document fails", async () => {
  const ws = await makeWorkspace({ "p01.md": publicNote("P01", "papers/p01", "![[blocked.pdf]]") })
  await mkdir(ws.outputRoot, { recursive: true })
  await writeFile(join(ws.outputRoot, "sentinel.txt"), "previous-success")
  await assert.rejects(() => stageFixture(ws), /not explicitly authorized/i)
  assert.equal(await readFile(join(ws.outputRoot, "sentinel.txt"), "utf8"), "previous-success")
})

test("produces a deterministic manifest sorted by destination", async () => {
  const ws = await makeWorkspace({
    "z.md": publicNote("P02", "papers/p02", "body"),
    "a.md": publicNote("P01", "papers/p01", "body"),
  })
  const first = await stageFixture(ws)
  const second = await stageFixture(ws)
  assert.deepEqual(first.manifest, second.manifest)
  assert.deepEqual(first.manifest.documents.map((item) => item.destination), ["papers/p01.md", "papers/p02.md"])
})
```

Define `publicNote()`, `makeWorkspace()`, and `stageFixture()` in the test file; they only create temporary source/config/output trees and call the public interfaces above. The atomicity test writes a sentinel into the existing successful output, triggers a failing export, and asserts the sentinel remains unchanged.

- [ ] **Step 2: Run publisher tests and verify expected failures**

Run: `node --test exporter/tests/publisher.test.mjs`

Expected: FAIL because publisher/link/asset modules are missing.

- [ ] **Step 3: Implement safe path and link resolution**

Wikilink handling must support alias, heading, block ID, escaped table pipe, same-page heading, and embeds. Index aliases include normalized source path, path without extension, basename, title, and frontmatter aliases. Duplicate aliases are marked ambiguous, not resolved by first match.

Private targets return only the chosen display label. Missing or ambiguous targets throw `PreflightError`.

- [ ] **Step 4: Implement the prototype attachment gate**

Parse the empty registry from:

```yaml
version: 1
assets: []
```

Reject local Markdown images, Obsidian embeds, PDF links, and local downloadable files. External HTTP links may remain normal links but external image embeds are rejected for the offline prototype.

- [ ] **Step 5: Implement atomic staging and deterministic manifest hashes**

Manifest record:

```js
{
  source_id: data.entity_id ?? data.paper_id ?? data.claim_id ?? data.slug,
  destination: entry.destination,
  content_type: entry.content_type,
  sha256: createHash("sha256").update(stagedMarkdown).digest("hex")
}
```

The public staged frontmatter contains only a committed safe-field allowlist. It never contains source filesystem paths.

- [ ] **Step 6: Run publisher tests to green**

Run: `node --test exporter/tests/publisher.test.mjs`

Expected: all publisher tests PASS.

- [ ] **Step 7: Commit publisher pipeline**

```bash
git add exporter/src exporter/config/assets.yml exporter/tests/publisher.test.mjs
git commit -m "feat: stage sanitized public content"
```

---

### Task 4: Derive public research data and private audit records

**Files:**

- Create: `exporter/src/derive-data.mjs`
- Create: `exporter/src/audits.mjs`
- Create: `exporter/schemas/relation.schema.json`
- Create: `exporter/schemas/timeline.schema.json`
- Create: `exporter/schemas/thesis-map.schema.json`
- Create: `exporter/schemas/reading-queue.schema.json`
- Create: `exporter/tests/derive-data.test.mjs`

**Interfaces:**

- Produces: `derivePublicData({ documents, relations, timeline, thesisMap, readingQueue }) -> PublicDataBundle`.
- Produces exactly: `papers`, `claims`, `relations`, `timeline`, `thesisMap`, `readingStatus`, `searchDocuments`.
- Produces: `writeAuditBundle(auditRoot, auditData) -> Promise<void>`.

- [ ] **Step 1: Write failing derivation tests**

Cover:

```js
test("sorts papers and claims by stable identifiers", () => {
  const result = derivePublicData(fixtureBundle({ paperOrder: ["P02", "P01"], claimOrder: ["P02-C01", "P01-C01"] }))
  assert.deepEqual(result.papers.map(({ paper_id }) => paper_id), ["P01", "P02"])
  assert.deepEqual(result.claims.map(({ claim_id }) => claim_id), ["P01-C01", "P02-C01"])
})

test("preserves unknown separately from not_reported", () => {
  const result = derivePublicData(fixtureBundle({ venue: "not_reported", accepted_date: "unknown" }))
  assert.equal(result.papers[0].venue, "not_reported")
  assert.equal(result.papers[0].accepted_date, "unknown")
})

test("rejects duplicate paper, claim, relation, and asset entity definitions", () => {
  for (const duplicate of ["paper", "claim", "relation", "asset"]) {
    assert.throws(() => derivePublicData(duplicateFixture(duplicate)), new RegExp(`duplicate ${duplicate}`, "i"))
  }
})

test("rejects relation endpoints outside the public entity set", () => {
  assert.throws(() => derivePublicData(fixtureBundle({ relationTarget: "P99" })), /unknown public relation target P99/i)
})

test("derives D-C01 backlinks to supporting paper claims", () => {
  const result = derivePublicData(fixtureBundle())
  assert.deepEqual(result.thesisMap.claims[0].supporting_claims, ["P01-C01", "P02-C01"])
  assert.deepEqual(result.claims.find(({ claim_id }) => claim_id === "P01-C01").thesis_claims, ["D-C01"])
})

test("indexes Chinese and English titles plus all requested identifier and tag fields", () => {
  const [document] = derivePublicData(fixtureBundle()).searchDocuments
  assert.deepEqual(document.identifiers, ["P01", "P01-C01", "P01-T01"])
  assert.match(document.search_text, /脱敏论文一|Sanitized Paper One|作者甲|distributed optimization|directed/i)
})

test("omits source paths and private entities from search documents", () => {
  const result = derivePublicData(fixtureBundle({ includePrivateDocument: true }))
  assert.equal(result.searchDocuments.some(({ id }) => id === "PRIVATE-01"), false)
  for (const document of result.searchDocuments) assert.equal(Object.hasOwn(document, "source_path"), false)
})
```

The test file defines deterministic `fixtureBundle()`, `duplicateFixture()`, and representative public entities; it never points at the private Vault.

- [ ] **Step 2: Run derivation tests and verify RED**

Run: `node --test exporter/tests/derive-data.test.mjs`

Expected: FAIL because `derive-data.mjs` does not exist.

- [ ] **Step 3: Implement schema-backed structured YAML loading**

Relation, timeline, thesis, and reading files must include `version: 1`. Dates are explicit `YYYY-MM-DD`, `unknown`, or `not_reported`; the loader never reads filesystem times.

- [ ] **Step 4: Implement deterministic public JSON**

Write the following under `site_content/_data/` with two-space indentation and trailing newline:

```text
papers.json
claims.json
relations.json
timeline.json
thesis-map.json
reading-status.json
search-documents.json
```

Do not include build timestamps.

- [ ] **Step 5: Implement private audit writers**

Write publication, exclusion, attachment, link, ID, privacy, and search audits under `audits/`. CSV writers must quote commas, quotes, and newlines. No audit file is copied to public output.

- [ ] **Step 6: Run derivation tests to green**

Run: `node --test exporter/tests/derive-data.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit data derivation**

```bash
git add exporter/src exporter/schemas exporter/tests/derive-data.test.mjs
git commit -m "feat: derive public research datasets"
```

---

### Task 5: Create the sanitized P01/P02 source and generated research pages

**Files:**

- Create: `exporter/config/prototype-allowlist.yml`
- Create: `exporter/fixtures/pages/index.md`
- Create: `exporter/fixtures/pages/program/index.md`
- Create: `exporter/fixtures/pages/program/questions.md`
- Create: `exporter/fixtures/pages/program/timeline.md`
- Create: `exporter/fixtures/pages/program/failures.md`
- Create: `exporter/fixtures/pages/papers/index.md`
- Create: `exporter/fixtures/pages/papers/p01.md`
- Create: `exporter/fixtures/pages/papers/p02.md`
- Create: `exporter/fixtures/pages/papers/relations.md`
- Create: `exporter/fixtures/pages/publications.md`
- Create: `exporter/fixtures/pages/thesis/index.md`
- Create: `exporter/fixtures/pages/thesis/claims.md`
- Create: `exporter/fixtures/pages/thesis/chapters.md`
- Create: `exporter/fixtures/pages/claims/index.md`
- Create: `exporter/fixtures/pages/claims/p01-c01.md`
- Create: `exporter/fixtures/pages/claims/p02-c01.md`
- Create: `exporter/fixtures/pages/claims/d-c01.md`
- Create: `exporter/fixtures/pages/evidence/index.md`
- Create: `exporter/fixtures/pages/knowledge/index.md`
- Create: `exporter/fixtures/pages/knowledge/math.md`
- Create: `exporter/fixtures/pages/reading-queue.md`
- Create: `exporter/fixtures/pages/search/index.md`
- Create: `exporter/fixtures/data/relations.yml`
- Create: `exporter/fixtures/data/timeline.yml`
- Create: `exporter/fixtures/data/thesis-map.yml`
- Create: `exporter/fixtures/data/reading-queue.yml`
- Create: `exporter/src/render-pages.mjs`
- Create: `exporter/bin/export.mjs`
- Create: `exporter/tests/prototype.test.mjs`

**Interfaces:**

- `renderGeneratedSections(document, publicData) -> document` replaces only named `<!-- GENERATED:<NAME> -->` markers.
- CLI defaults to fixture source and repository-local outputs; private-vault source requires an explicit future CLI flag and is not used in this plan.
- CLI exit code is nonzero on every preflight error.

- [ ] **Step 1: Write the failing prototype integration test**

The test stages fixtures to a temporary directory and asserts:

```js
assert.deepEqual(manifest.files.map((file) => file.destination), expectedRoutes)
assert.match(p01, /status:\s*Published/)
assert.match(p01, /state:\s*Frozen/)
assert.match(p02, /status:\s*Active/)
assert.match(relations, /extends_to_dynamic_setting/)
assert.match(thesisClaim, /P01-C01/)
assert.match(thesisClaim, /P02-C01/)
assert.doesNotMatch(allStagedText, /\/Users\/yangfan\//)
assert.doesNotMatch(allStagedText, /\.pdf\b|OCR 全文|全文翻译/i)
```

Also assert every fixture is `demo: true`, every allowlisted Markdown satisfies the whitelist, P03 has no route, and `source_path` is absent.

- [ ] **Step 2: Run the prototype test and verify RED**

Run: `node --test exporter/tests/prototype.test.mjs`

Expected: FAIL because fixtures, CLI, and renderer are missing.

- [ ] **Step 3: Create explicit allowlist and structured demo data**

P01 facts use only clearly synthetic wording. Missing publication values are `not_reported`; do not invent a DOI, venue, accepted date, published date, or frozen date. P02 is an independent active demo project. Timeline dates are prefixed by a visible “脱敏示例时间线” notice.

- [ ] **Step 4: Create page Markdown and required semantic content**

Every page has a short visible demo banner. P01 and P02 use the 18-section body order from the design. Tables use semantic headers. Relation page contains both a Mermaid graph generated from relation data and a relation table. Claim detail pages show statement, conditions, evidence chain, non-claims, history, and use locations.

- [ ] **Step 5: Implement generated dashboard, matrices, cards, and maps**

Generated HTML uses stable class names and data attributes:

```html
<article class="paper-card" data-paper="P01" data-status="Published" data-theory="supported">
  <header><code>P01</code><span class="status status-published">Published</span></header>
  <h3><a href="/papers/p01/">脱敏论文一</a></h3>
  <dl>
    <div><dt>角色</dt><dd>系列论文起点</dd></div>
    <div><dt>理论状态</dt><dd>Supported</dd></div>
    <div><dt>学位论文角色</dt><dd>支持 D-C01</dd></div>
  </dl>
</article>
```

No generated block reads prose to infer facts.

- [ ] **Step 6: Implement CLI orchestration**

`exporter/bin/export.mjs` resolves repository paths, loads config/fixtures, calls `stagePublishedContent`, derives JSON, renders generated sections, atomically replaces `site_content/`, and writes audits. It prints only counts and output paths, never private note content.

- [ ] **Step 7: Run all exporter tests to green**

Run: `node --test exporter/tests/*.test.mjs`

Expected: all exporter tests PASS.

- [ ] **Step 8: Commit sanitized prototype source**

```bash
git add exporter
git commit -m "feat: add sanitized research console prototype"
```

---

### Task 6: Configure Quartz shell, navigation, academic rendering, and local assets

**Files:**

- Create: `quartz/quartz.config.yaml`
- Modify: `quartz/quartz.ts`
- Create: `quartz/quartz/components/ResearchNav.tsx`
- Create: `quartz/quartz/components/ResearchMobileHeader.tsx`
- Modify: `quartz/quartz/components/frames/DefaultFrame.tsx`
- Modify: `quartz/quartz/components/Head.tsx`
- Modify: `quartz/quartz/styles/custom.scss`
- Create: `quartz/quartz/static/research-console.js`
- Create: `quartz/scripts/bundle-mermaid.mjs`
- Create: `quartz/scripts/copy-research-assets.mjs`
- Create: `quartz/tests/research-shell.test.tsx`

**Interfaces:**

- `ResearchNav()` renders exactly seven primary links and six secondary links using static stable routes.
- `ResearchMobileHeader()` renders menu, site title, and always-visible search link.
- `Head` loads `/static/research-console.js` as a deferred module without external hosts.
- Copy script emits local Mermaid and generated `_data/*.json` to `site_output/static/`.

- [ ] **Step 1: Write failing shell component tests**

Use `preact-render-to-string` and assert real markup:

```ts
test("renders the seven-item research navigation", () => {
  const html = render(<ResearchNav {...propsFor("papers/p01")} />)
  for (const label of ["研究首页", "研究主线", "系列论文", "学位论文", "主张与证据", "知识库", "搜索"]) {
    assert.match(html, new RegExp(label))
  }
  assert.match(html, /aria-current="page"/)
})

test("mobile header exposes menu and search without hover", () => {
  const html = render(<ResearchMobileHeader {...propsFor("papers/p01")} />)
  assert.match(html, /<details[^>]*class="[^"]*mobile-nav/)
  assert.match(html, /<summary[^>]*>[^<]*菜单/)
  assert.match(html, /href="\/search\/"[^>]*>[^<]*搜索/)
})
```

Also test that `source_path` is not part of note-properties configuration and all required callout type identifiers appear in the stylesheet.

- [ ] **Step 2: Run shell tests and verify RED**

Run: `npx tsx --test tests/research-shell.test.tsx`

Working directory: `quartz/`

Expected: FAIL because research components do not exist.

- [ ] **Step 3: Implement navigation components and frame integration**

Desktop left sidebar order: site title, search shortcut, primary navigation, collapsible secondary navigation, theme/reader controls. Mobile header uses `<details>` for a no-JavaScript drawer. Existing right sidebar retains table of contents and backlinks on content pages and is hidden on the Dashboard.

- [ ] **Step 4: Configure Quartz plugins**

Enable Obsidian-flavored Markdown, GFM, Table of Contents, Crawl Links, Description, MathJax, Explicit Publish, Content Index, Folder/Tag/Content pages, Backlinks, Dark Mode, Reader Mode, Breadcrumbs, and Footer. Disable graph, Canvas, comments, encrypted pages, remote fonts, and public note-properties display.

- [ ] **Step 5: Add local Mermaid bundling and data copy**

Bundle the installed Mermaid ESM into `quartz/quartz/static/mermaid.esm.min.mjs`. Rewrite only the known Quartz CDN import to `/static/mermaid.esm.min.mjs`. Copy generated JSON to `site_output/static/data/` after build.

- [ ] **Step 6: Implement academic callout and status primitives**

CSS must include these callout identifiers:

```text
problem assumption algorithm theorem proof-dependency experiment evidence
interpretation limitation warning open-question erratum
```

Status badges include visible text and icon glyphs for Published, Active, Hypothesis, Blocked, Corrected, Superseded, and Private.

- [ ] **Step 7: Run shell tests and typecheck to green**

Run: `npx tsx --test tests/research-shell.test.tsx`

Run: `npx tsc --noEmit`

Expected: both PASS.

- [ ] **Step 8: Commit Quartz shell**

```bash
git add quartz
git commit -m "feat: add Quartz research console shell"
```

---

### Task 7: Implement static filtering and search

**Files:**

- Create: `quartz/quartz/static/research-console-core.mjs`
- Modify: `quartz/quartz/static/research-console.js`
- Create: `quartz/tests/research-interactions.test.mjs`
- Modify generated templates under: `exporter/fixtures/pages/`

**Interfaces:**

- `normalizeSearchText(value) -> string`.
- `searchDocuments(documents, query) -> SearchResult[]`.
- `matchesClaim(record, filters) -> boolean`.
- `matchesPaper(record, filters) -> boolean`.
- Browser script initializes on `DOMContentLoaded` and Quartz `nav`, but does not require SPA routing.

- [ ] **Step 1: Write failing pure interaction tests**

```js
test("searches Chinese and English titles, authors, and stable IDs", () => {
  for (const query of ["脱敏论文一", "Sanitized Paper One", "作者甲", "P01-C01"]) {
    assert.equal(searchDocuments(searchFixture, query)[0].id, "P01")
  }
})

test("returns a bounded contextual snippet and public status", () => {
  const results = searchDocuments(searchFixture, "distributed")
  assert.ok(results.length <= 20)
  assert.ok(results[0].snippet.length <= 180)
  assert.equal(results[0].visibility, "published")
  assert.equal(results[0].status, "Published")
})

test("filters claims by paper, scope, type, support, activity, and blocking", () => {
  const filters = { paper: "P02", scope: "thesis", type: "theory", support: "partial", activity: "active", blocking: "blocking" }
  assert.equal(matchesClaim(claimFixture[0], filters), true)
  assert.equal(matchesClaim(claimFixture[1], filters), false)
})

test("treats an empty filter as all records", () => {
  assert.equal(claimFixture.every((record) => matchesClaim(record, {})), true)
  assert.equal(paperFixture.every((record) => matchesPaper(record, {})), true)
})

test("never returns fields outside the public search document shape", () => {
  const [result] = searchDocuments([{ ...searchFixture[0], source_path: "/private/vault/note.md", secret: "sentinel" }], "P01")
  assert.deepEqual(Object.keys(result).sort(), ["id", "project", "snippet", "status", "title", "type", "url", "visibility"].sort())
  assert.doesNotMatch(JSON.stringify(result), /private|sentinel/)
})
```

Define `searchFixture`, `claimFixture`, and `paperFixture` as frozen inline records so the tests remain independent of generated output.

- [ ] **Step 2: Run interaction tests and verify RED**

Run: `node --test tests/research-interactions.test.mjs`

Working directory: `quartz/`

Expected: FAIL because the core interaction module is missing.

- [ ] **Step 3: Implement pure search and filter functions**

Use locale-neutral lowercase normalization plus Unicode NFC. Search all requested fields, score exact ID/title matches above substring matches, and cap results at 20. The browser renderer creates DOM nodes through `document.createElement` and `textContent`, not string interpolation of indexed text.

- [ ] **Step 4: Implement browser bindings**

- Claim and paper filters update `[hidden]` and a live result count.
- Search page fetches `/static/data/search-documents.json` and renders title, type, project, snippet, status, and visibility.
- Reset buttons restore all records.
- Controls have labels and work with keyboard activation.

- [ ] **Step 5: Run interaction tests to green**

Run: `node --test tests/research-interactions.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit interactions**

```bash
git add quartz/quartz/static quartz/tests exporter/fixtures/pages
git commit -m "feat: add static research filtering and search"
```

---

### Task 8: Build and verify responsive desktop/tablet/mobile rendering

**Files:**

- Create: `quartz/tests/built-research-site.test.mjs`
- Create: `quartz/tests/research-visual.test.mjs`
- Modify: `quartz/quartz/styles/custom.scss`
- Modify if required by failing tests: `quartz/quartz/components/frames/DefaultFrame.tsx`
- Generate: `site_output/` and `audits/screenshots/` (ignored)

**Interfaces:**

- Built-site tests consume only `site_output/`.
- Visual tests start an ephemeral localhost server, launch installed Chrome through CDP, and clean up their temporary profile.

- [ ] **Step 1: Export and perform the first Quartz build**

Run: `npm run build:research`

Working directory: `quartz/`

Expected on first attempt: either successful baseline output or actionable failures from missing post-build/visual assertions. Fix only build wiring required before writing behavioral style changes.

- [ ] **Step 2: Write failing built-site assertions**

Assert all required routes, local Mermaid, local data JSON, MathJax containers, absence of unresolved wikilinks, no external runtime URLs, no forbidden file names, valid internal hrefs, P01/P02 states, relation table, and D-C01 backlinks.

- [ ] **Step 3: Run built-site tests and verify RED where behavior is incomplete**

Run: `node --test tests/built-research-site.test.mjs`

Working directory: `quartz/`

Expected: at least one intentional failure for incomplete output behavior before its implementation.

- [ ] **Step 4: Write failing CDP responsive tests**

For 375, 768, and 1440 pixels assert:

```js
rootScrollWidth <= viewportWidth
all visible interactive controls have width >= 44 and height >= 44 when touch-target class applies
dashboard card columns === 1 at 375
desktop left sidebar visible at 1440
mobile drawer visible and desktop sidebar hidden at 375
right TOC visible at 1440 and collapsible/hidden at 768 and 375
table and display-math containers use overflow-x: auto
search link is visible at all widths
```

Also save one screenshot per required width for `/`, `/papers/p01/`, and `/claims/`.

- [ ] **Step 5: Run visual tests and verify RED**

Run: `node --test tests/research-visual.test.mjs`

Working directory: `quartz/`

Expected: FAIL on at least the not-yet-applied responsive rules.

- [ ] **Step 6: Implement responsive CSS and any minimal frame fixes**

Use CSS grid with `minmax(0, 1fr)`, never global horizontal clipping. Dashboard becomes wide at desktop; content pages use 264px/main/240px. At 768 both sidebars collapse. At 375 use 16px gutters, one-column cards, folded metadata, and full-width previous/next controls.

- [ ] **Step 7: Rebuild and run built/visual tests to green**

Run: `npm run build:research`

Run: `node --test tests/built-research-site.test.mjs tests/research-visual.test.mjs`

Expected: all tests PASS with no browser-console errors.

- [ ] **Step 8: Commit responsive implementation**

```bash
git add quartz exporter
git commit -m "feat: complete responsive research console"
```

---

### Task 9: Add post-build privacy/reproducibility audits and operator documentation

**Files:**

- Create: `exporter/bin/audit-built-site.mjs`
- Create: `exporter/tests/postbuild-audit.test.mjs`
- Create: `exporter/tests/rebuild.test.mjs`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**

- `auditBuiltSite({ outputRoot, manifestPath }) -> Promise<AuditSummary>`.
- `hashTree(root, ignoredNames = []) -> Promise<Record<string,string>>`.
- Audit CLI exits nonzero on any privacy, search, internal-link, runtime-resource, or manifest violation.

- [ ] **Step 1: Write failing post-build audit tests**

Use synthetic temporary outputs to prove detection of:

```text
private sentinel text
/Users/... absolute paths
credential patterns
PDF/OCR/translation file names
search entries not present in publication manifest
missing internal hrefs
external CDN scripts/fonts/images
audits copied into public output
```

- [ ] **Step 2: Write failing clean-rebuild determinism test**

The test exports fixtures twice to separate temporary roots and compares file lists and SHA-256 hashes. It fails if any generated JSON includes current time or nondeterministic ordering.

- [ ] **Step 3: Run audit tests and verify RED**

Run: `node --test exporter/tests/postbuild-audit.test.mjs exporter/tests/rebuild.test.mjs`

Expected: FAIL because audit CLI and tree hasher are missing.

- [ ] **Step 4: Implement post-build audit and determinism helpers**

Scan only readable text formats for content markers, but scan every filename and extension. Parse generated HTML hrefs and resolve extensionless candidates. Compare search entity IDs against the manifest-derived public ID set.

- [ ] **Step 5: Document the exact local workflow**

README includes:

```text
prerequisites
npm ci location
fixture-only default source
export command
build command
preview command
test command
clean-rebuild command
generated-directory ownership
privacy rules
explicit statement that no deploy command exists
```

Do not include a command that points the exporter at the private vault in the prototype README.

- [ ] **Step 6: Run complete clean verification**

Run from repository root:

```bash
node --test exporter/tests/*.test.mjs
```

Run from `quartz/`:

```bash
npx tsc --noEmit
npx tsx --test
npm run build:research
node --test tests/built-research-site.test.mjs tests/research-visual.test.mjs
```

Run the post-build audit a second time explicitly:

```bash
node ../exporter/bin/audit-built-site.mjs
```

Expected: every command exits 0.

- [ ] **Step 7: Verify no private-source mutation and no remote/deployment state**

Compare the pre-recorded private-vault metadata/hash audit with current values for all files read during the original audit. Confirm repository remotes are empty and `.github/workflows` is absent from the site checkout.

- [ ] **Step 8: Commit documentation and audit tooling**

```bash
git add README.md .gitignore exporter
git commit -m "test: add privacy and rebuild audits"
```

- [ ] **Step 9: Invoke required completion skills**

Read and follow `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`. Because the user instructed the agent to decide and continue, choose the safe local integration path that preserves all commits and never pushes or deploys.
