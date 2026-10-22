# P02 Writing Materials and TCNS Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a traceable six-note writing-material layer for `P02_ET_ZO` and expose a sanitized TCNS-oriented status snapshot on a bounded independent page served at port 4176.

**Architecture:** The Desktop research directory remains the source of truth for private Obsidian notes. The web workbench contains a separately reviewed static data snapshot with strict validation; substantive cross-venue evidence and same-venue style samples use different arrays and incompatible usage enums. The existing P02 workflow state machine is not changed.

**Tech Stack:** Obsidian Markdown, vanilla HTML/CSS/ES modules, Node.js built-in test runner, existing local private-library server.

**Spec:** `docs/superpowers/specs/2026-09-03-p02-writing-materials-design.md`

## Global Constraints

- The current manuscript is a scaffold with open proofs and must not be described as submission-ready.
- `crossVenueEvidence` is only for substantive related-work and technical evidence.
- `inVenueStyleSamples` is only for TCNS formatting and writing-style observations.
- Same-venue samples must never satisfy a claim-evidence requirement.
- Do not invent citations, DOI values, theorems, experiment results, page counts, or novelty claims.
- Do not expose Desktop absolute paths, `file://` URLs, Windows drive paths, or UNC paths in web assets.
- Keep the implementation desktop-only and bounded to one independent page.
- Preserve all unrelated changes in the already-dirty `codex/three-workspace-integration` worktree.
- Do not create a Git commit from this shared dirty worktree; inspect the targeted diff instead.

---

### Task 1: Create the traceable Obsidian writing-material layer

**Files:**
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/00_初稿生成与来源说明.md`
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/01_目标期刊与同刊样本.md`
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/02_主张证据台账.md`
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/03_相关工作与差异矩阵.md`
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/04_章节写作材料.md`
- Create: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/05_投稿缺口与任务清单.md`
- Modify: `/Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/论文初稿.md:1-35`

**Interfaces:**
- Consumes: the current manuscript, the Zhang (2024) PDF, official journal pages, and verified publisher metadata.
- Produces: six source-of-truth notes linked from `论文初稿.md`; the later web snapshot uses only their non-private summaries.

- [ ] **Step 1: Record the content contract before writing prose**

Use these exact frontmatter fields in every note:

```yaml
---
project_id: P02_ET_ZO
document_type: writing_material
status: working
updated: 2026-09-03
tags:
  - research/writing-material
  - p02
---
```

Add `material_id`, `title`, and the role-specific `evidence_policy` to each file. Use `substantive_evidence` only in `03_相关工作与差异矩阵.md`, and `format_and_style_only` only for the same-venue sample section of `01_目标期刊与同刊样本.md`.

- [ ] **Step 2: Write the provenance note**

Include a table with literal columns:

```markdown
| 输入 | 本轮实际用途 | 进入位置 | 核验状态 | 禁止外推 |
|---|---|---|---|---|
```

Record the manuscript-generation chain as: Zhang (2024) mechanism anchor → confirmed P02 problem contract → candidate algorithm interface → L1–L10 proof obligations → explicit experiment pause → manuscript scaffold. State that no journal template or 4176 generator produced version 0.1.

- [ ] **Step 3: Write the journal and same-venue style note**

Record TCNS official scope, 12-page maximum, 10-page main-text plus 2-page appendix guidance, 300-word abstract limit, ORCID requirement, and prescreening criteria with official URLs and access date `2026-09-03`. Add TAC, Automatica, and TNSE as non-primary routes with bounded fit conditions.

Create a section titled `同刊样本只用于排版与风格` and give each TCNS sample these fields: official link/DOI, verified page range or `未从全文核验`, observed section order, abstract pattern, theorem/proof placement, experiment presentation, usable style practice, and prohibited substantive use.

- [ ] **Step 4: Write the claim ledger and cross-venue difference matrix**

Use claim statuses `design_fixed`, `partially_supported`, `proof_blocked`, `experiment_blocked`, and `prohibited_claim`. Every row must include allowed wording and prohibited wording. The difference matrix must compare online setting, decision structure, network, oracle, coupling constraints, communication mechanism, theory outputs, and experiment outputs.

- [ ] **Step 5: Write the section pack and submission-gap checklist**

For each manuscript section, record paragraph job, author claim, available evidence, missing evidence, and permitted tense. The checklist must give a concrete acceptance condition for algorithm, theory, literature, experiment, writing, and format work.

- [ ] **Step 6: Link the material layer from the manuscript**

Add these frontmatter fields to `论文初稿.md`:

```yaml
target_venue: IEEE Transactions on Control of Network Systems
venue_status: candidate
submission_readiness: not_ready
writing_materials: "[[写作材料/00_初稿生成与来源说明]]"
```

After the existing boundary callouts, add a short `目标期刊与写作材料` callout that links all six notes and says the target venue is a working choice, not a submission-readiness claim.

- [ ] **Step 7: Run the Markdown content audit**

Run:

```bash
for file in /Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO/写作材料/*.md; do
  test -s "$file" || exit 1
  sed -n '1p' "$file" | grep -qx -- '---' || exit 1
done
rg -n 'substantive_evidence|format_and_style_only|not_ready|不可声称|尚未证明' /Users/yangfan/Desktop/papers/研究项目/P02_ET_ZO
```

Expected: six non-empty notes, valid frontmatter opening, both evidence policies present, and explicit non-ready/prohibited-claim boundaries present.

---

### Task 2: Define and validate the sanitized web data contract

**Files:**
- Create: `prototype/desktop/p02-writing-data.test.mjs`
- Create: `prototype/desktop/p02-writing-data.mjs`

**Interfaces:**
- Consumes: hand-reviewed public summaries from Task 1.
- Produces: `P02_WRITING_DATA` and `validateP02WritingData(value): boolean` for the page renderer and server tests.

- [ ] **Step 1: Write a failing data-contract test**

Create literal fixtures that assert:

```js
assert.equal(validateP02WritingData(P02_WRITING_DATA), true)
assert.equal(validateP02WritingData({
  ...P02_WRITING_DATA,
  crossVenueEvidence: [{ ...P02_WRITING_DATA.crossVenueEvidence[0], usage: "format_and_style_only" }],
}), false)
assert.equal(validateP02WritingData({
  ...P02_WRITING_DATA,
  inVenueStyleSamples: [{ ...P02_WRITING_DATA.inVenueStyleSamples[0], supportsClaims: true }],
}), false)
```

Also test duplicate `paperId` across the two pools, missing HTTPS source, unknown status, an unexpected root key, `/Users/yangfan/` text, `file://`, `C:\\` and `\\\\server\\share`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test prototype/desktop/p02-writing-data.test.mjs
```

Expected: FAIL because `p02-writing-data.mjs` does not exist.

- [ ] **Step 3: Implement the minimal exact-key validator and dataset**

Use the root keys from the design spec. Each cross-venue record must have `usage: "substantive_evidence"`; each TCNS record must have `usage: "format_and_style_only"` and `supportsClaims: false`. Require HTTPS publisher/DOI URLs and globally unique `paperId` values. Recursively reject private path signatures in every string.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test prototype/desktop/p02-writing-data.test.mjs
```

Expected: all data-contract tests pass with zero failures.

---

### Task 3: Build the independent writing-material page using TDD

**Files:**
- Create: `prototype/desktop/p02-writing-view.test.mjs`
- Create: `prototype/desktop/p02-writing.mjs`
- Create: `prototype/desktop/p02-writing.html`
- Modify: `prototype/desktop/p02.html:63-67,197-220,309-322`
- Modify: `prototype/desktop/styles.css`
- Modify: `prototype/desktop/desktop-pages.test.mjs`

**Interfaces:**
- Consumes: `validateP02WritingData` and `P02_WRITING_DATA` from Task 2.
- Produces: `buildP02WritingView(data)` and `initializeP02Writing({ document, data })` plus the route `/prototype/desktop/p02-writing.html`.

- [ ] **Step 1: Write a failing view-model test**

Assert hand-derived output labels:

```js
const view = buildP02WritingView(P02_WRITING_DATA)
assert.equal(view.submissionLabel, "研究脚手架 · 尚不可投稿")
assert.equal(view.crossVenue.heading, "同类论文 · 不同期刊")
assert.equal(view.crossVenue.usageLabel, "相关工作与实质证据")
assert.equal(view.inVenue.heading, "TCNS 同刊相似论文")
assert.equal(view.inVenue.usageLabel, "仅用于排版与写作风格")
assert.equal(view.materials.length, 6)
assert.equal(view.inVenue.cards.every((card) => card.supportsClaims === false), true)
```

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
node --test prototype/desktop/p02-writing-view.test.mjs
```

Expected: FAIL because `p02-writing.mjs` does not exist.

- [ ] **Step 3: Implement the pure view builder and safe DOM renderer**

`buildP02WritingView` must call the validator and throw `TypeError("P02 写作材料数据无效")` on invalid input. `initializeP02Writing` must create elements through `document.createElement`, assign user-visible values with `textContent`, and assign only validated HTTPS links to `href`; do not concatenate records into `innerHTML`.

- [ ] **Step 4: Add failing route/DOM assertions before updating HTML**

Extend `desktop-pages.test.mjs` to fetch the new page and assert status 200, both-direction navigation, both literature headings, both usage labels, six material cards, and the module script path. Run the single file before changing the HTML and confirm that it fails on the missing route.

- [ ] **Step 5: Create the page shell and route links**

The HTML must contain separate containers `#cross-venue-evidence`, `#in-venue-style-samples`, `#writing-materials`, `#claim-summary`, and `#submission-blockers`. Add visible boundary text to both literature pools. Change the existing P02 `#writing-entry` action to link to `./p02-writing.html` while leaving the five-stage forms intact.

- [ ] **Step 6: Add minimal responsive styles and verify GREEN**

Reuse existing tokens and cards. Add a two-column literature grid above 1180 px and one column below it; ensure `min-width: 0`, wrapping URLs, and visible text labels. Run:

```bash
node --test prototype/desktop/p02-writing-data.test.mjs prototype/desktop/p02-writing-view.test.mjs prototype/desktop/desktop-pages.test.mjs
```

Expected: all focused page and data tests pass.

---

### Task 4: Add the new page to the 4176 private-server allowlist

**Files:**
- Modify: `exporter/paper-library/local-server.test.mjs:76-95,839-918`
- Modify: `exporter/paper-library/local-server.mjs:55-78`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/config/github-package-files.json`
- Modify: `prototype/desktop/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: three web files from Tasks 2–3.
- Produces: HTTP 200 for the exact approved routes while keeping all other prototype files denied.

- [ ] **Step 1: Extend the allowlist test before production code**

Add these exact literals to the expected approved set and fixture map:

```js
"p02-writing.html",
"p02-writing-data.mjs",
"p02-writing.mjs",
```

Assert each exact GET returns 200 and `/prototype/desktop/p02-writing.test.mjs` remains 404.

- [ ] **Step 2: Run the focused server test and verify RED**

Run:

```bash
node --test exporter/paper-library/local-server.test.mjs
```

Expected: FAIL because the production allowlist lacks the three resources.

- [ ] **Step 3: Add only the three approved resources**

Insert the same literals in `APPROVED_PROTOTYPE_FILES`; do not broaden the prefix, add a glob, or serve the Desktop research directory.

- [ ] **Step 4: Write the failing package-closure expectation**

Add the three files to the expected package closure in `package-audit.test.mjs`, then run:

```bash
node --test exporter/paper-library/package-audit.test.mjs
```

Expected: FAIL because the production package list and JSON configuration do not yet include the new page assets.

- [ ] **Step 5: Synchronize the package closure and documentation**

Add the three exact paths to `package-audit.mjs` and `github-package-files.json`. Add `http://127.0.0.1:4176/prototype/desktop/p02-writing.html` to both README files as a writing-material entry; do not add private research-directory paths.

- [ ] **Step 6: Run server and package tests and verify GREEN**

Run:

```bash
node --test \
  exporter/paper-library/local-server.test.mjs \
  exporter/paper-library/package-audit.test.mjs
```

Expected: all local-server and package-closure tests pass with zero failures.

---

### Task 5: Run full verification and make the 4176 deliverable visible

**Files:**
- Verify all files above; no new production files.

**Interfaces:**
- Consumes: completed notes, web page, validator, navigation, and server allowlist.
- Produces: a running localhost deliverable and fresh evidence for the handoff.

- [ ] **Step 1: Run the targeted unit and integration suites**

```bash
node --test \
  prototype/desktop/p02-writing-data.test.mjs \
  prototype/desktop/p02-writing-view.test.mjs \
  prototype/desktop/desktop-pages.test.mjs \
  exporter/paper-library/local-server.test.mjs \
  exporter/paper-library/package-audit.test.mjs
```

Expected: zero failed tests.

- [ ] **Step 2: Run the existing P02 regression suites**

```bash
node --test \
  prototype/desktop/p02-workflow.test.mjs \
  prototype/desktop/p02-workflow-ui.test.mjs
```

Expected: zero failed tests and no change to the five-stage state semantics.

- [ ] **Step 3: Audit the targeted diff and private-path boundary**

```bash
git diff --check
git status --short
rg -n '/Users/|file://|[A-Za-z]:\\\\|\\\\\\\\[^ ]+\\\\' \
  prototype/desktop/p02-writing.html \
  prototype/desktop/p02-writing-data.mjs \
  prototype/desktop/p02-writing.mjs
```

Expected: `git diff --check` exits 0 and the path scan returns no matches in web assets.

- [ ] **Step 4: Start the existing local service after confirming port ownership**

Run `lsof -nP -iTCP:4176 -sTCP:LISTEN`. If empty, start `node exporter/scripts/serve-private-library.mjs` from this repository. If occupied, identify the PID, command, and cwd and do not terminate or replace it without a separate user decision.

- [ ] **Step 5: Perform browser QA on the actual route**

Open `http://127.0.0.1:4176/prototype/desktop/p02-writing.html`. Verify visible headings, two literature-policy labels, external links, return navigation, console errors, vertical scrolling, and no horizontal overflow at 1440×900 and 1280×720. Keep the resulting page open as the user-facing deliverable.

- [ ] **Step 6: Report exact status**

Report the source-of-truth directory, page URL, test counts, browser viewport checks, remaining manuscript blockers, and whether the background service is still running. Do not say “可投稿” unless every blocker in `05_投稿缺口与任务清单.md` has verified evidence.
