# Paper Library Facet States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict `facet_states` semantics so an empty academic facet is shown as “未记录” by default and only explicit catalog decisions can show “不适用” or “待核验”.

**Architecture:** Keep the authoritative state contract beside the existing 18-path facet schema, propagate a sparse `facet_states` object from the version-3 local tag catalog through generated paper records into a version-3 public index, and render it conservatively in the desktop inspector. The browser accepts both the old index/schema pair `2/1` and the new pair `3/2`, but normalizes old papers to `facet_states: {}` so downstream UI has one shape.

**Tech Stack:** Node.js ESM, `node:test`, JSON, browser DOM modules, CSS, Python Playwright acceptance checks

**Spec:** `docs/superpowers/specs/2026-08-30-paper-library-manual-curation-design.md`

## Global Constraints

- This phase is desktop-only and must not add mobile or tablet layouts.
- `facet_states` is a sparse plain object whose keys are exactly the existing 18 `FACET_PATHS` values.
- Allowed values are exactly `unrecorded`, `not_applicable`, and `pending_verification`.
- An empty facet with no explicit state displays “未记录”.
- “不适用” and “待核验” are explicit catalog decisions; no code may infer them from an empty array.
- A path with one or more facet values must not also have a `facet_states` entry.
- Empty `source_terms` always displays “未记录”.
- `local_library_config/paper-tags.json` moves from version 2 to version 3; migration adds only `facet_states: {}` and preserves every existing facet value and source term.
- New builds emit `paper-index.json` version 3 and `facet_schema.version` 2.
- The desktop reader must continue to accept index version 2 with facet schema version 1 and normalize missing states to `{}`.
- Tasks 4 and 5 are one deployment unit: Task 4 may commit source and temporary-fixture tests, but do not rebuild the real library, publish generated `3/2` output, start a server against it, or hand off the branch until Task 5's compatible reader is committed and its tests pass.
- This phase must not depend on personal tags or the local note-import service.
- Do not move, rename, overwrite, or edit source PDF, OCR, note, code, or result files.
- Generated public records, errors, and tests must not expose local absolute paths.
- Do not use a fixed historical passing-test count as acceptance evidence; run the named suites and report their actual results.

---

## File Map

- `exporter/paper-library/facet-schema.mjs`: authoritative facet-state enum, sparse-object validator, and schema version.
- `exporter/paper-library/paper-tag-migration.mjs`: pure deterministic version-2 to version-3 catalog migration.
- `exporter/scripts/migrate-paper-tags-v3.mjs`: one-shot local catalog migration CLI.
- `exporter/paper-library/tag-catalog.mjs`: strict version-3 catalog validation and stable-ID merge.
- `exporter/paper-library/status.mjs`: generated-record shape and state validation.
- `exporter/paper-library/overrides.mjs`: metadata-provenance field allowlist.
- `exporter/paper-library/build.mjs`: version-3 public serialization and tagging audit version.
- `prototype/desktop/library.mjs`: strict version-pair reader and v2 normalization.
- `prototype/desktop/paper-library-model.mjs`: state-to-label helper with conservative fallback.
- `prototype/desktop/paper-inspector.mjs`: three-state empty-facet and source-term rendering.
- `prototype/desktop/styles.css`: visible but quiet semantic styles for the three empty states.
- `exporter/verification/private_library_e2e.py`: generated-index and live-browser acceptance.
- `README.md`, `prototype/desktop/README.md`: schema and migration/operator documentation.
- `exporter/config/github-package-files.json`, `exporter/paper-library/package-audit.mjs`: include only the new reusable program and tests, never the real catalog.

---

### Task 1: Define and validate the facet-state contract

**Files:**
- Modify: `exporter/paper-library/facet-schema.mjs:1-104`
- Modify: `exporter/paper-library/facet-schema.test.mjs:1-104`

**Interfaces:**
- Consumes: existing `FACET_PATHS: readonly string[]`, `validatePaperFacets(facets): object`, and the internal path lookup used by facet validation.
- Produces: `FACET_STATE_VALUES: readonly ["unrecorded", "not_applicable", "pending_verification"]`; `validateFacetStates(facets: object, facetStates: object): object`; `serializeFacetSchema(): { version: 2, groups: Array<object> }`.

- [ ] **Step 1: Write failing enum and valid-state tests**

Add the imports and tests below to `facet-schema.test.mjs`:

```js
import {
  FACET_GROUPS,
  FACET_PATHS,
  FACET_STATE_VALUES,
  createEmptyFacets,
  flattenFacetValues,
  serializeFacetSchema,
  validateFacetStates,
  validatePaperFacets,
} from "./facet-schema.mjs"

test("facet states are sparse and use only the three approved meanings", () => {
  assert.deepEqual(FACET_STATE_VALUES, ["unrecorded", "not_applicable", "pending_verification"])
  const facets = createEmptyFacets()
  const states = {
    applications: "not_applicable",
    results: "pending_verification",
    "network.time": "unrecorded",
  }
  assert.equal(validateFacetStates(facets, states), states)
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test exporter/paper-library/facet-schema.test.mjs`

Expected: FAIL during module loading because `FACET_STATE_VALUES` and `validateFacetStates` are not exported.

- [ ] **Step 3: Add rejection tests for every contract boundary**

Append:

```js
test("facet states reject unknown paths, unknown states, and non-objects", () => {
  const facets = createEmptyFacets()
  assert.throws(() => validateFacetStates(facets, []), /facet_states 必须是对象/u)
  assert.throws(() => validateFacetStates(facets, { "research.unknown": "unrecorded" }), /facet_states 路径无效/u)
  assert.throws(() => validateFacetStates(facets, { results: "waiting" }), /facet_states 状态无效/u)
  const hidden = {}
  Object.defineProperty(hidden, "private", { value: "unrecorded", enumerable: false })
  assert.throws(() => validateFacetStates(facets, hidden), /facet_states 路径无效/u)
})

test("a populated facet cannot also carry an empty-value state", () => {
  const facets = createEmptyFacets()
  facets.results = ["线性收敛"]
  assert.throws(
    () => validateFacetStates(facets, { results: "pending_verification" }),
    /facet_states 不能覆盖已有分面值/u,
  )
})

test("serialized facet schema announces empty-state support", () => {
  assert.equal(serializeFacetSchema().version, 2)
})
```

- [ ] **Step 4: Implement the minimal shared validator and schema version**

Add beside `FACET_PATHS` and before `createEmptyFacets` in `facet-schema.mjs`:

```js
export const FACET_STATE_VALUES = Object.freeze([
  "unrecorded",
  "not_applicable",
  "pending_verification",
])
const facetStateValueSet = new Set(FACET_STATE_VALUES)

export function validateFacetStates(facets, facetStates) {
  validatePaperFacets(facets)
  if (!isRecord(facetStates)) throw new TypeError("facet_states 必须是对象")
  for (const path of Reflect.ownKeys(facetStates)) {
    if (typeof path !== "string" || !FACET_PATHS.includes(path)) {
      throw new TypeError("facet_states 路径无效")
    }
    if (!facetStateValueSet.has(facetStates[path])) {
      throw new TypeError("facet_states 状态无效")
    }
    if (getAtPath(facets, path).length > 0) {
      throw new TypeError("facet_states 不能覆盖已有分面值")
    }
  }
  return facetStates
}
```

Change only the version literal in `serializeFacetSchema`:

```js
export function serializeFacetSchema() {
  return {
    version: 2,
    groups: FACET_GROUPS.map(({ panel, path, label, values }) => ({ panel, path, label, values: [...values] })),
  }
}
```

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: `node --test exporter/paper-library/facet-schema.test.mjs`

Expected: PASS; the 18-path list remains unchanged and every new state-contract case passes.

- [ ] **Step 6: Commit the contract**

```bash
git add exporter/paper-library/facet-schema.mjs exporter/paper-library/facet-schema.test.mjs
git commit -m "feat: define paper facet empty states"
```

---

### Task 2: Add a deterministic version-3 catalog migrator

**Files:**
- Create: `exporter/paper-library/paper-tag-migration.mjs`
- Create: `exporter/paper-library/paper-tag-migration.test.mjs`
- Create: `exporter/scripts/migrate-paper-tags-v3.mjs`

**Interfaces:**
- Consumes: a parsed version-2 catalog shaped as `{ version: 2, papers: Record<string, { record_type, facets, source_terms }> }`.
- Produces: `migratePaperTagCatalogV2(raw): { version: 3, papers: Record<string, { record_type, facets, facet_states: {}, source_terms }> }`; `main({ catalogPath, stdout, stderr }): Promise<number>`.

- [ ] **Step 1: Write the failing pure-migration test**

Create `paper-tag-migration.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createEmptyFacets } from "./facet-schema.mjs"
import { migratePaperTagCatalogV2 } from "./paper-tag-migration.mjs"
import { main as migrateCatalog } from "../scripts/migrate-paper-tags-v3.mjs"

function legacyCatalog() {
  const facets = createEmptyFacets()
  facets.results = ["线性收敛"]
  return {
    version: 2,
    papers: {
      "Paper-01": {
        record_type: "外部论文",
        facets,
        source_terms: ["Algorithm One"],
      },
    },
  }
}

test("v2 migration adds only an empty sparse facet_states object", () => {
  const before = legacyCatalog()
  const migrated = migratePaperTagCatalogV2(before)
  assert.equal(migrated.version, 3)
  assert.deepEqual(migrated.papers["Paper-01"], {
    ...before.papers["Paper-01"],
    facet_states: {},
  })
  assert.deepEqual(before, legacyCatalog())
  assert.notStrictEqual(migrated.papers["Paper-01"].facets, before.papers["Paper-01"].facets)
  assert.notStrictEqual(migrated.papers["Paper-01"].source_terms, before.papers["Paper-01"].source_terms)
})
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test exporter/paper-library/paper-tag-migration.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `paper-tag-migration.mjs` or the migration CLI.

- [ ] **Step 3: Add strict rejection and CLI round-trip tests**

Append:

```js
test("migration refuses wrong versions and legacy records with extra fields", () => {
  assert.throws(() => migratePaperTagCatalogV2({ version: 3, papers: {} }), /version 2/u)
  const invalid = legacyCatalog()
  invalid.papers["Paper-01"].facet_states = {}
  assert.throws(() => migratePaperTagCatalogV2(invalid), /version-2 标签记录字段无效/u)
})

test("migration CLI rewrites one catalog deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-tag-migration-"))
  const catalogPath = join(root, "paper-tags.json")
  await writeFile(catalogPath, `${JSON.stringify(legacyCatalog(), null, 2)}\n`, "utf8")
  const lines = []
  const code = await migrateCatalog({ catalogPath, stdout: (line) => lines.push(line), stderr: assert.fail })
  const migrated = JSON.parse(await readFile(catalogPath, "utf8"))
  assert.equal(code, 0)
  assert.deepEqual(migrated.papers["Paper-01"].facet_states, {})
  assert.deepEqual(lines, ["标签目录已迁移到 version 3：1 条记录"])
})
```

- [ ] **Step 4: Implement the pure migration**

Create `paper-tag-migration.mjs`:

```js
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function migratePaperTagCatalogV2(raw) {
  if (!isPlainObject(raw) || raw.version !== 2 || !isPlainObject(raw.papers)) {
    throw new Error("标签目录必须是 version 2")
  }
  const papers = {}
  for (const [paperId, record] of Object.entries(raw.papers)) {
    if (!isPlainObject(record) || Object.keys(record).sort().join("|") !== "facets|record_type|source_terms") {
      throw new Error(`version-2 标签记录字段无效: ${paperId}`)
    }
    papers[paperId] = {
      record_type: record.record_type,
      facets: structuredClone(record.facets),
      facet_states: {},
      source_terms: [...record.source_terms],
    }
  }
  return { version: 3, papers }
}
```

- [ ] **Step 5: Implement the atomic one-file CLI**

Create `migrate-paper-tags-v3.mjs`:

```js
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { migratePaperTagCatalogV2 } from "../paper-library/paper-tag-migration.mjs"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_CATALOG = join(REPO_ROOT, "local_library_config/paper-tags.json")

export async function main({
  catalogPath = DEFAULT_CATALOG,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const target = resolve(catalogPath)
  const temporary = `${target}.next-${process.pid}`
  try {
    const migrated = migratePaperTagCatalogV2(JSON.parse(await readFile(target, "utf8")))
    await writeFile(temporary, `${JSON.stringify(migrated, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, target)
    stdout(`标签目录已迁移到 version 3：${Object.keys(migrated.papers).length} 条记录`)
    return 0
  } catch {
    await rm(temporary, { force: true })
    stderr("标签目录迁移失败；原文件未被替换。")
    return 1
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invoked === import.meta.url) process.exitCode = await main({ catalogPath: process.argv[2] ?? DEFAULT_CATALOG })
```

- [ ] **Step 6: Run the migration tests and confirm GREEN**

Run: `node --test exporter/paper-library/paper-tag-migration.test.mjs`

Expected: PASS; the pure transform preserves source data and the CLI produces version 3 without leaving a `.next-*` file.

- [ ] **Step 7: Commit the migration tool**

```bash
git add exporter/paper-library/paper-tag-migration.mjs exporter/paper-library/paper-tag-migration.test.mjs exporter/scripts/migrate-paper-tags-v3.mjs
git commit -m "feat: add deterministic paper tag migration"
```

---

### Task 3: Upgrade the tag catalog and migrate the real local data

**Files:**
- Modify: `exporter/paper-library/tag-catalog.mjs:1-111`
- Modify: `exporter/paper-library/tag-catalog.test.mjs:1-290`
- Local runtime migration only, never stage or commit: `local_library_config/paper-tags.json:1-end`

**Interfaces:**
- Consumes: `validateFacetStates(facets, facetStates)` from Task 1 and the migration CLI from Task 2.
- Produces: `loadPaperTagCatalog(path): Promise<{ version: 3, papers: object }>`; merged papers always contain `facet_states: object`; `metadata_provenance.facet_states === "tag_catalog"` for catalog-matched papers.

- [ ] **Step 1: Convert test fixtures to the required version-3 shape**

Change the `validRecord` helper and version assertions in `tag-catalog.test.mjs`:

```js
const validRecord = (overrides = {}) => ({
  record_type: "外部论文",
  facets: {
    ...createEmptyFacets(),
    research: { domain: ["分布式优化"], mode: [] },
  },
  facet_states: {},
  source_terms: ["Dual Decomposition"],
  ...overrides,
})

test("loads a version-3 stable-ID facet catalog", async () => {
  const path = await writeCatalog({ version: 3, papers: { "Falsone17-DD": validRecord() } })
  const catalog = await loadPaperTagCatalog(path)
  assert.equal(catalog.version, 3)
  assert.deepEqual(catalog.papers["Falsone17-DD"].facet_states, {})
})
```

Update `writeCatalog`’s temporary-directory prefix to `paper-tags-v3-` and all inline tag-catalog fixtures from `version: 2` to `version: 3` with `facet_states: {}`.

- [ ] **Step 2: Add strict state and merge tests**

Append:

```js
test("catalog requires facet_states and rejects collisions with populated facets", () => {
  const missing = validRecord()
  delete missing.facet_states
  assert.throws(() => validatePaperTagRecord("Paper-01", missing), /字段缺失: facet_states/u)
  assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({
    facet_states: { "research.domain": "pending_verification" },
  })), /不能覆盖已有分面值/u)
  assert.throws(() => validatePaperTagRecord("Paper-01", validRecord({
    facet_states: { applications: "not_applicable", private: "unrecorded" },
  })), /路径无效/u)
})

test("catalog merge clones sparse states and records their provenance", () => {
  const tagCatalog = {
    version: 3,
    papers: { "Paper-01": validRecord({ facet_states: { results: "pending_verification" } }) },
  }
  const input = [{ paper_id: "Paper-01", unit_type: "article", metadata_provenance: {}, warnings: [] }]
  const result = applyPaperTagCatalog({ papers: input, tagCatalog })
  assert.deepEqual(result.papers[0].facet_states, { results: "pending_verification" })
  assert.equal(result.papers[0].metadata_provenance.facet_states, "tag_catalog")
  assert.notStrictEqual(result.papers[0].facet_states, tagCatalog.papers["Paper-01"].facet_states)
})
```

- [ ] **Step 3: Run the catalog tests and confirm RED**

Run: `node --test exporter/paper-library/tag-catalog.test.mjs`

Expected: FAIL because the loader still requires version 2 and the record allowlist does not accept `facet_states`.

- [ ] **Step 4: Upgrade the strict catalog loader and merge**

Apply these exact contract changes in `tag-catalog.mjs`:

```js
import { createEmptyFacets, validateFacetStates, validatePaperFacets } from "./facet-schema.mjs"

const RECORD_FIELDS = new Set(["record_type", "facets", "facet_states", "source_terms"])
```

After `validatePaperFacets(record.facets)` add:

```js
validateFacetStates(record.facets, record.facet_states)
```

Change every catalog version check and frozen return from `2` to `3`. In the matched merge branch add:

```js
facet_states: { ...record.facet_states },
```

and add this provenance entry:

```js
facet_states: "tag_catalog",
```

In the unmatched branch add:

```js
facet_states: {},
```

- [ ] **Step 5: Run the deterministic migration on the real catalog**

Run:

```bash
node exporter/scripts/migrate-paper-tags-v3.mjs local_library_config/paper-tags.json
node -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync("local_library_config/paper-tags.json","utf8"));if(p.version!==3)process.exit(1);for(const r of Object.values(p.papers)){if(JSON.stringify(r.facet_states)!=="{}")process.exit(2)}console.log(`version=${p.version} papers=${Object.keys(p.papers).length}`)'
```

Expected: the first command reports a successful version-3 migration; the second matches `^version=3 papers=[1-9][0-9]*$` and exits 0. Do not hand-edit any nonempty state in this migration task. This is an operator-owned local data migration: keep the pre-migration backup until the full build and browser acceptance pass, and never stage or package the migrated catalog.

- [ ] **Step 6: Update the real-catalog test to prove no inferred states**

In the real-catalog test, assert the migrated condition without a fixed record count:

```js
const catalog = await loadPaperTagCatalog(new URL("../../local_library_config/paper-tags.json", import.meta.url))
assert.equal(catalog.version, 3)
assert.ok(Object.keys(catalog.papers).length > 0)
assert.equal(Object.values(catalog.papers).every((record) => (
  Object.keys(record.facet_states).length === 0
)), true)
```

Rename the current representative fixture to `expectedRepresentativeRecordsWithoutStates`, then derive the version-3 expectation without changing any facet/source-term values:

```js
const expectedRepresentativeRecords = Object.fromEntries(
  Object.entries(expectedRepresentativeRecordsWithoutStates).map(([paperId, record]) => [
    paperId,
    { ...record, facet_states: {} },
  ]),
)
```

Retain this exact assertion loop after the derived fixture:

```js
for (const [paperId, expectedRecord] of Object.entries(expectedRepresentativeRecords)) {
  assert.deepEqual(catalog.papers[paperId], expectedRecord)
}
```

- [ ] **Step 7: Run catalog and migration tests and confirm GREEN**

Run:

```bash
node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/paper-tag-migration.test.mjs exporter/paper-library/tag-catalog.test.mjs
```

Expected: PASS; the real catalog loads as version 3, every migrated state map is empty, and malformed or conflicting state maps are rejected.

- [ ] **Step 8: Prove the private catalog remains outside Git, then commit only the version-3 program contract**

Run:

```bash
git check-ignore -v local_library_config/paper-tags.json
git status --short --ignored local_library_config/paper-tags.json
```

Expected: `.gitignore` is reported as the owning rule and the catalog is shown only as ignored local state; it is not tracked or staged.

```bash
git add exporter/paper-library/tag-catalog.mjs exporter/paper-library/tag-catalog.test.mjs
git commit -m "feat: accept facet states in paper tag catalog"
```

Expected: the commit contains only the loader and its tests. `local_library_config/paper-tags.json` remains an ignored, operator-owned runtime file.

---

### Task 4: Propagate states into generated records and the version-3 index

**Files:**
- Modify: `exporter/paper-library/overrides.mjs:20-33`
- Modify: `exporter/paper-library/overrides.test.mjs:1-30`
- Modify: `exporter/paper-library/status.mjs:1-266`
- Modify: `exporter/paper-library/status.test.mjs:1-270`
- Modify: `exporter/paper-library/build.mjs:60-90, 510-565, 901-1032`
- Modify: `exporter/paper-library/build.test.mjs:1-1070`

**Interfaces:**
- Consumes: version-3 tag catalog records from Task 3 and `validateFacetStates` from Task 1.
- Produces: every internal and public paper record has `facet_states: object`; generated index is `{ version: 3, facet_schema: { version: 2, groups }, warning_count, papers }`; tagging audit has `schema_version: 3`.

- [ ] **Step 1: Write failing generated-record validation tests**

Add `facet_states: {}` to `validPaper()` in `status.test.mjs`, then append:

```js
test("generated paper validates sparse facet states against its facet values", () => {
  const paper = validPaper({ facet_states: { applications: "not_applicable" } })
  assert.doesNotThrow(() => validateGeneratedPaper(paper))
  assert.throws(() => validateGeneratedPaper({ ...paper, facet_states: { private: "unrecorded" } }), /路径无效/u)
  assert.throws(() => validateGeneratedPaper({
    ...paper,
    facets: { ...paper.facets, results: ["线性收敛"] },
    facet_states: { results: "pending_verification" },
  }), /不能覆盖已有分面值/u)
})

test("facet state participates in merge defaults and metadata provenance", () => {
  const paper = mergePaperRecord({ catalog: { facet_states: { results: "pending_verification" } } })
  assert.deepEqual(paper.facet_states, { results: "pending_verification" })
  assert.equal(paper.metadata_provenance.facet_states, "catalog")
})
```

In `overrides.test.mjs`, add:

```js
test("metadata provenance accepts the generated facet_states field", () => {
  assert.doesNotThrow(() => validateMetadataProvenance({ facet_states: "tag_catalog" }))
})
```

- [ ] **Step 2: Write a failing build serialization test**

Update the tag catalog fixture in `build.test.mjs` to version 3 and add `facet_states`, then assert the new wire versions and field:

```js
const tagCatalog = {
  version: 3,
  papers: {
    "PaperA-01": {
      record_type: "外部论文",
      facets: createEmptyFacets(),
      facet_states: { results: "pending_verification", applications: "not_applicable" },
      source_terms: [],
    },
  },
}

assert.equal(index.version, 3)
assert.equal(index.facet_schema.version, 2)
assert.deepEqual(index.papers[0].facet_states, {
  results: "pending_verification",
  applications: "not_applicable",
})
assert.equal(index.papers[0].metadata_provenance.facet_states, "tag_catalog")
assert.equal(audit.tagging.schema_version, 3)
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
node --test exporter/paper-library/overrides.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs
```

Expected: FAIL because generated records and metadata provenance do not yet allow `facet_states`, and the build still emits index version 2.

- [ ] **Step 4: Extend provenance and generated-record contracts**

Add `facet_states` beside `facets` in `METADATA_PROVENANCE_FIELDS` in `overrides.mjs`.

In `status.mjs`:

```js
import { createEmptyFacets, validateFacetStates, validatePaperFacets } from "./facet-schema.mjs"
```

Add `facet_states` to `PAPER_FIELDS` and `PROVENANCE_FIELDS`. Add this default beside `facets`:

```js
facet_states: {},
```

After `validatePaperFacets(paper.facets)` add:

```js
validateFacetStates(paper.facets, paper.facet_states)
```

Keep `facet_states` out of `overrides.mjs`’s override `FIELDS`; this phase records states only in the tag catalog, while merely allowing their provenance in generated records.

- [ ] **Step 5: Serialize states and upgrade wire versions**

In `build.mjs`, add `facet_states` manually after serializing `facets`:

```js
record.facets = structuredClone(paper.facets)
record.facet_states = { ...paper.facet_states }
```

Change the tagging audit and index literals:

```js
audit.tagging = { ...tagged.tagging, schema_version: 3 }
```

```js
const index = {
  version: 3,
  facet_schema: serializeFacetSchema(),
  warning_count: aggregateWarningCount(audit),
  papers: papers.map((paper) => serializePublicPaper(
    paper,
    controlledPreviewsByPaperId.get(paper.paper_id),
    controlledPreviewDocumentsByPaperId.get(paper.paper_id),
    sourceDocumentsByPaperId.get(paper.paper_id),
  )),
}
```

- [ ] **Step 6: Update the remaining fixture literals and exact-key assertions**

Make these mechanical test-fixture replacements:

```js
// exporter/paper-library/status.test.mjs: validPaper()
record_type: "外部论文", facets: createEmptyFacets(), facet_states: {}, source_terms: [],

// exporter/paper-library/build.test.mjs: empty catalog fixtures at the current
// makeFixture(), CLI, missing-catalog, and build-boundary test sites
tagCatalog: { version: 3, papers: {} },
const tagCatalog = { version: 3, papers: {} }

// exporter/paper-library/build.test.mjs: every nonempty tag record
record_type: "外部论文",
facets: createEmptyFacets(),
facet_states: {},
source_terms: [],
```

For the controlled-facet build fixture, use the nonempty state map from Step 2 instead of `{}`. Change build-produced expectations to `index.version === 3`, `index.facet_schema.version === 2`, and `audit.tagging.schema_version === 3`. Leave only `paper-tag-migration.test.mjs` with a version-2 catalog fixture.

Run: `rg -n 'version: 2|schema_version: 2|facet_schema\.version, 1' exporter/paper-library/*.test.mjs`

Expected: matches occur only in `paper-tag-migration.test.mjs` and assertions that deliberately reject or migrate version 2.

- [ ] **Step 7: Run exporter tests and confirm GREEN**

Run:

```bash
node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/overrides.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/build.test.mjs
```

Expected: PASS; generated records reject malformed state maps, build output is version `3/2`, and privacy checks still accept the state field without exposing paths.

- [ ] **Step 8: Commit source-only generated-record propagation without publishing `3/2` yet**

```bash
git add exporter/paper-library/overrides.mjs exporter/paper-library/overrides.test.mjs exporter/paper-library/status.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs
git commit -m "feat: publish paper facet states in index v3"
```

Expected: the commit contains source and tests only. Do not run the real configured build or replace the currently served `2/1` generated output at this checkpoint; continue immediately to Task 5.

---

### Task 5: Read index v3 strictly while normalizing legacy index v2

**Files:**
- Modify: `prototype/desktop/library.mjs:1-335, 800-835`
- Modify: `prototype/desktop/paper-library-dom.test.mjs:380-450, 1400-1510`

**Interfaces:**
- Consumes: wire index pair `version: 3` and `facet_schema.version: 2`, plus the temporary legacy pair `2/1`.
- Produces: `loadPaperIndex(fetchImpl): Promise<{ version: 2|3, facet_schema: object, warning_count: number, papers: Array<Paper & { facet_states: object }> }>`; all returned papers have a `facet_states` object.

- [ ] **Step 1: Add v3 and v2-normalization test fixtures**

In `paper-library-dom.test.mjs`, change the helpers to make both wire shapes explicit:

```js
function validFacetSchema(version = 2) {
  return {
    version,
    groups: facetGroups.map(([panel, path, label, values]) => ({ panel, path, label, values: [...values] })),
  }
}

function v2Index(papers = [normalizedPaper()]) {
  return {
    version: 2,
    facet_schema: validFacetSchema(1),
    warning_count: 0,
    papers: papers.map(({ facet_states: _facetStates, ...paper }) => ({
      ...paper,
      metadata_provenance: Object.fromEntries(
        Object.entries(paper.metadata_provenance).filter(([field]) => field !== "facet_states"),
      ),
    })),
  }
}

function v3Index(papers = [normalizedPaper()]) {
  return { version: 3, facet_schema: validFacetSchema(2), warning_count: 0, papers }
}
```

Add `facet_states: {}` beside `facets` and `facet_states: "tag_catalog"` beside the existing `metadata_provenance.facets` entry in `normalizedPaper()`.

- [ ] **Step 2: Add strict compatibility tests**

Append:

```js
test("loadPaperIndex accepts v3 states and normalizes v2 papers to empty states", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const current = await loadPaperIndex(async () => ({
    ok: true,
    json: async () => v3Index([normalizedPaper({ facet_states: { results: "pending_verification" } })]),
  }))
  assert.equal(current.version, 3)
  assert.deepEqual(current.papers[0].facet_states, { results: "pending_verification" })

  const legacy = await loadPaperIndex(async () => ({ ok: true, json: async () => v2Index() }))
  assert.equal(legacy.version, 2)
  assert.deepEqual(legacy.papers[0].facet_states, {})
})

test("loadPaperIndex enforces version pairs and facet-state consistency", async () => {
  const { loadPaperIndex } = await import("./library.mjs")
  const invalid = [
    { ...v3Index(), facet_schema: validFacetSchema(1) },
    { ...v2Index(), facet_schema: validFacetSchema(2) },
    v3Index([{ ...normalizedPaper(), facet_states: { private: "unrecorded" } }]),
    v3Index([{ ...normalizedPaper(), facet_states: { results: "waiting" } }]),
    v3Index([{ ...normalizedPaper(), facet_states: { results: "pending_verification" } }]),
    (() => {
      const paper = normalizedPaper()
      delete paper.facet_states
      return v3Index([paper])
    })(),
    { ...v2Index(), papers: [normalizedPaper()] },
  ]
  invalid[4].papers[0].facets.results = ["线性收敛"]
  for (const payload of invalid) {
    await assert.rejects(
      () => loadPaperIndex(async () => ({ ok: true, json: async () => payload })),
      /论文库索引格式无效/u,
    )
  }
})
```

- [ ] **Step 3: Run the DOM test and confirm RED**

Run: `node --test prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL because `loadPaperIndex` accepts only index version 2 and schema version 1.

- [ ] **Step 4: Add the browser-side state validator**

In `library.mjs`, add:

```js
const FACET_STATE_VALUES = Object.freeze(["unrecorded", "not_applicable", "pending_verification"])
```

Add `facet_states` to `PUBLIC_PAPER_FIELDS`, and define the legacy field sets:

```js
const V3_LEGACY_PUBLIC_PAPER_FIELDS = Object.freeze(PUBLIC_PAPER_FIELDS.filter((field) => field !== "controlled_preview_documents"))
const V2_PUBLIC_PAPER_FIELDS = Object.freeze(PUBLIC_PAPER_FIELDS.filter((field) => field !== "facet_states"))
const V2_LEGACY_PUBLIC_PAPER_FIELDS = Object.freeze(V2_PUBLIC_PAPER_FIELDS.filter((field) => field !== "controlled_preview_documents"))
```

Replace `validFacetSchema`’s fixed version check with an argument:

```js
function validFacetSchema(value, expectedVersion) {
  if (!exactStringKeys(value, ["version", "groups"]) || value.version !== expectedVersion || !Array.isArray(value.groups)) return false
  if (value.groups.length !== CANONICAL_FACET_GROUPS.length) return false
  for (const [index, group] of value.groups.entries()) {
    const canonical = CANONICAL_FACET_GROUPS[index]
    if (!exactStringKeys(group, ["panel", "path", "label", "values"])) return false
    if (group.panel !== canonical.panel || group.path !== canonical.path || group.label !== canonical.label) return false
    if (!Array.isArray(group.values) || group.values.length !== canonical.values.length) return false
    if (!group.values.every((item, valueIndex) => item === canonical.values[valueIndex])) return false
  }
  return true
}
```

Add:

```js
function validFacetStates(facets, facetStates) {
  if (!isPlainObject(facetStates)) return false
  return Object.entries(facetStates).every(([path, state]) => (
    FACET_PATHS.includes(path)
    && FACET_STATE_VALUES.includes(state)
    && facetValueAt(facets, path).length === 0
  ))
}
```

- [ ] **Step 5: Make record validation wire-version aware**

Change the signature and replace the existing expected-key expression with:

```js
function validPaperRecord(paper, facetSchema, indexVersion) {
  const hasPreviewDocuments = isPlainObject(paper) && Object.hasOwn(paper, "controlled_preview_documents")
  const expectedFields = indexVersion === 3
    ? (hasPreviewDocuments ? PUBLIC_PAPER_FIELDS : V3_LEGACY_PUBLIC_PAPER_FIELDS)
    : (hasPreviewDocuments ? V2_PUBLIC_PAPER_FIELDS : V2_LEGACY_PUBLIC_PAPER_FIELDS)
  return exactStringKeys(paper, expectedFields)
    && LEGACY_ACADEMIC_FIELDS.every((field) => !Object.hasOwn(paper, field))
    && validPaperId(paper.paper_id)
}
```

The snippet replaces only the function opening through the existing `validPaperId` predicate; the current predicates beginning with `SLUG.test(paper.slug)` remain directly after it. Immediately after the existing line `&& validPaperFacets(paper.facets, facetSchema)`, insert:

```js
&& (indexVersion === 2 || validFacetStates(paper.facets, paper.facet_states))
```

Add `facet_states` to `METADATA_PROVENANCE_FIELDS` so v3 provenance is accepted. The provenance validator already accepts sparse objects, so a v2 record remains valid without that provenance key.

- [ ] **Step 6: Accept only the two approved wire pairs and normalize v2**

Replace the final payload gate and return in `loadPaperIndex` with:

```js
const schemaVersion = payload?.version === 3 ? 2 : payload?.version === 2 ? 1 : null
if (
  !exactStringKeys(payload, ["version", "facet_schema", "warning_count", "papers"])
  || schemaVersion === null
  || !validFacetSchema(payload.facet_schema, schemaVersion)
  || !Array.isArray(payload.papers)
  || !payload.papers.every((paper) => validPaperRecord(paper, payload.facet_schema, payload.version))
) {
  throw new Error("论文库索引格式无效")
}
const paperIds = payload.papers.map((paper) => paper.paper_id)
if (new Set(paperIds).size !== paperIds.length) throw new Error("论文库索引格式无效")
const warningCount = Number.isInteger(payload.warning_count) && payload.warning_count >= 0 ? payload.warning_count : 0
return {
  version: payload.version,
  facet_schema: payload.facet_schema,
  warning_count: warningCount,
  papers: payload.papers.map((paper) => (
    payload.version === 2 ? { ...paper, facet_states: {} } : paper
  )),
}
```

- [ ] **Step 7: Run strict loader tests and confirm GREEN**

Run: `node --test prototype/desktop/paper-library-dom.test.mjs`

Expected: PASS; v3 state maps survive intact, v2 papers receive `{}`, malformed version pairs fail, and existing private-path rejection tests still pass.

- [ ] **Step 8: Commit the compatibility reader**

```bash
git add prototype/desktop/library.mjs prototype/desktop/paper-library-dom.test.mjs
git commit -m "feat: read facet states with index v2 compatibility"
```

Expected: Tasks 4 and 5 are now complete as one deployable unit. Only from this point may a real build publish index/schema `3/2`; the reader still accepts the existing `2/1` output during the transition.

---

### Task 6: Render “未记录 / 不适用 / 待核验” conservatively

**Files:**
- Modify: `prototype/desktop/paper-library-model.mjs:1-275`
- Modify: `prototype/desktop/paper-library-model.test.mjs:1-310`
- Modify: `prototype/desktop/paper-inspector.mjs:1-250`
- Modify: `prototype/desktop/paper-library-dom.test.mjs:1010-1060`
- Modify: `prototype/desktop/styles.css` at the existing `.library-profile-pending` rules

**Interfaces:**
- Consumes: normalized `paper.facet_states` from Task 5 and existing `facetValues(paper, path): string[]`.
- Produces: `facetStateAt(paper, path): "unrecorded"|"not_applicable"|"pending_verification"`; `facetEmptyLabel(paper, path): null|{ state: string, label: string }`.

- [ ] **Step 1: Write failing model tests for display semantics**

Add these imports and tests to `paper-library-model.test.mjs`:

```js
import {
  facetEmptyLabel,
  facetStateAt,
  facetValues,
} from "./paper-library-model.mjs"

test("empty facet labels default to 未记录 and honor explicit states", () => {
  const paper = {
    facets: {
      ...validFacets(),
      results: [],
      applications: [],
      privacy_robustness: [],
    },
    facet_states: {
      applications: "not_applicable",
      results: "pending_verification",
    },
  }
  assert.deepEqual(facetEmptyLabel(paper, "privacy_robustness"), { state: "unrecorded", label: "未记录" })
  assert.deepEqual(facetEmptyLabel(paper, "applications"), { state: "not_applicable", label: "不适用" })
  assert.deepEqual(facetEmptyLabel(paper, "results"), { state: "pending_verification", label: "待核验" })
  assert.equal(facetEmptyLabel(paper, "research.domain"), null)
  assert.equal(facetStateAt({ facets: validFacets(), facet_states: { results: "waiting" } }, "results"), "unrecorded")
})
```

- [ ] **Step 2: Run the model test and confirm RED**

Run: `node --test prototype/desktop/paper-library-model.test.mjs`

Expected: FAIL because `facetEmptyLabel` and `facetStateAt` are not exported.

- [ ] **Step 3: Implement the defensive display helper**

Add near `facetValues` in `paper-library-model.mjs`:

```js
const FACET_EMPTY_LABELS = Object.freeze({
  unrecorded: "未记录",
  not_applicable: "不适用",
  pending_verification: "待核验",
})

export function facetStateAt(paper, path) {
  const state = paper?.facet_states?.[path]
  return Object.hasOwn(FACET_EMPTY_LABELS, state) ? state : "unrecorded"
}

export function facetEmptyLabel(paper, path) {
  if (facetValues(paper, path).length > 0) return null
  const state = facetStateAt(paper, path)
  return { state, label: FACET_EMPTY_LABELS[state] }
}
```

- [ ] **Step 4: Replace inspector’s inferred “待核验” and add DOM assertions**

Import `facetEmptyLabel` in `paper-inspector.mjs`. Replace the empty facet branch with:

```js
const empty = facetEmptyLabel(paper, schemaGroup.path)
if (empty) {
  appendTextElement(
    document,
    group,
    "span",
    empty.label,
    `library-profile-empty library-profile-empty--${empty.state.replaceAll("_", "-")}`,
  )
} else {
  const list = document.createElement("ul")
  for (const value of values) appendTextElement(document, list, "li", value)
  group.append(list)
}
```

Change only the empty source-term text:

```js
if (terms.length === 0) appendTextElement(document, sourceTerms, "p", "未记录")
```

Replace the old inspector expectation in `paper-library-dom.test.mjs` with:

```js
const paper = normalizedPaper({
  facets: {
    ...validFacets(),
    constraints: { ...validFacets().constraints, consistency: [] },
    results: [],
    applications: [],
  },
  facet_states: {
    results: "pending_verification",
    applications: "not_applicable",
  },
  source_terms: [],
})
const root = renderInspector({ document, paper, workspaceState: {}, facetSchema: validFacetSchema(2) })
assert.match(root.querySelector('[data-profile-path="constraints.consistency"]').textContent, /节点关系未记录/u)
assert.match(root.querySelector('[data-profile-path="results"]').textContent, /理论结果待核验/u)
assert.match(root.querySelector('[data-profile-path="applications"]').textContent, /应用领域不适用/u)
assert.match(root.querySelector("[data-source-terms]").textContent, /原文术语与算法名称未记录/u)
assert.equal(root.querySelectorAll(".library-profile-empty--pending-verification").length, 1)
```

- [ ] **Step 5: Add distinct, restrained desktop styles**

Replace the old pending-only rule in `styles.css` with:

```css
.library-profile-empty {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  color: #64748b;
  font-size: 12px;
}

.library-profile-empty--not-applicable {
  color: #7c6f64;
}

.library-profile-empty--pending-verification {
  color: #9a6700;
  font-weight: 650;
}
```

Do not color “未记录” as an error and do not add an interactive control; states remain catalog-authored data in this phase.

- [ ] **Step 6: Run model and DOM tests and confirm GREEN**

Run:

```bash
node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs
```

Expected: PASS; a blank state no longer renders as “待核验”, explicit states render exactly once, source terms show “未记录”, and the inspector still avoids `innerHTML`.

- [ ] **Step 7: Commit three-state rendering**

```bash
git add prototype/desktop/paper-library-model.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-inspector.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/styles.css
git commit -m "feat: render conservative paper facet states"
```

---

### Task 7: Document, package, rebuild, and accept the phase

**Files:**
- Modify: `README.md` in the paper-library operation section
- Modify: `prototype/desktop/README.md` in the local-preview and verification sections
- Modify: `exporter/config/github-package-files.json`
- Modify: `exporter/paper-library/package-audit.mjs:12-70`
- Modify: `exporter/paper-library/package-audit.test.mjs:1-280`
- Modify: `exporter/verification/private_library_e2e.py:112-130, 160-180` and the reader-inspector acceptance section
- Generated by command, do not commit: `local_library_data/paper-index.json`
- Generated by command, do not commit: `local_library_data/paper-library-audit.json`
- Generated by command, do not commit: `local_library_output/desktop/**`

**Interfaces:**
- Consumes: completed Tasks 1–6 and the existing `node exporter/scripts/build-private-library.mjs` build entrypoint.
- Produces: documented migration/meaning, package allowlist coverage for reusable code only, a generated index with the `3/2` pair, and browser evidence that only explicit pending states display “待核验”.

- [ ] **Step 1: Write failing package-boundary assertions**

Add these exact entries to the expected-file array in `package-audit.test.mjs` before updating production manifests:

```js
"exporter/paper-library/paper-tag-migration.mjs",
"exporter/paper-library/paper-tag-migration.test.mjs",
"exporter/scripts/migrate-paper-tags-v3.mjs",
```

Add a negative assertion proving the real catalog remains excluded:

```js
assert.equal(EXPECTED_PACKAGE_FILES.includes("local_library_config/paper-tags.json"), false)
```

- [ ] **Step 2: Run the package test and confirm RED**

Run: `node --test exporter/paper-library/package-audit.test.mjs`

Expected: FAIL because the production package list and JSON manifest do not yet include the three reusable migration files.

- [ ] **Step 3: Update both fixed package allowlists**

Add the same three program/test paths, in sorted positions, to:

```text
exporter/paper-library/package-audit.mjs
exporter/config/github-package-files.json
```

Do not add `local_library_config/paper-tags.json`, generated index/audit files, source papers, or local paths.

- [ ] **Step 4: Document the schema and operator commands**

Add this content to the paper-library section in both READMEs, adapting only the surrounding heading level:

````markdown
### 研究画像空值

正式分面值仍来自 `local_library_config/paper-tags.json`。目录 version 3 为每篇记录增加稀疏 `facet_states`：空数组且没有状态时显示“未记录”；只有人工明确写入 `not_applicable` 或 `pending_verification` 时，页面才显示“不适用”或“待核验”。已有分面值与同路径状态不能同时存在，空的原文术语也只显示“未记录”。

旧 version-2 目录只迁移结构，不推断结论：

```bash
node exporter/scripts/migrate-paper-tags-v3.mjs local_library_config/paper-tags.json
node exporter/scripts/build-private-library.mjs
```

新构建输出 index version 3 和 facet schema version 2；桌面页面仍可临时读取旧的 `2/1` 生成物，并把缺失状态按“未记录”处理。
````

- [ ] **Step 5: Upgrade generated-index acceptance checks**

In `private_library_e2e.py`, change the wire assertions and add strict state validation:

```python
ensure(payload.get("version") == 3, "index_version")
facet_schema = payload.get("facet_schema")
ensure(isinstance(facet_schema, dict), "facet_schema")
ensure(facet_schema.get("version") == 2, "facet_schema_version")
```

After the existing `papers` array and unique `paper_ids` checks in `load_index`, add:

```python
allowed_states = {"unrecorded", "not_applicable", "pending_verification"}

def values_at_path(paper: dict, path: str) -> list[object]:
    current: object = paper.get("facets")
    for part in path.split("."):
        if not isinstance(current, dict):
            return []
        current = current.get(part)
    return current if isinstance(current, list) else []

for paper in papers:
    states = paper.get("facet_states")
    ensure(isinstance(states, dict), "facet_states_object")
    ensure(set(states).issubset(set(paths)), "facet_states_paths")
    ensure(set(states.values()).issubset(allowed_states), "facet_states_values")
    for path, state in states.items():
        ensure(state in allowed_states, "facet_state_value")
        ensure(values_at_path(paper, path) == [], "facet_state_value_collision")
```

Do not assert a fixed number of nonempty state maps: the migration intentionally creates none.

- [ ] **Step 6: Add live inspector semantics to browser acceptance**

In the existing reader/inspector check, select a paper with at least one empty facet, open its inspector, and add:

```python
empty_paths = [
    path for path in FACET_GROUP_BY_PATH
    if facet_values(PREVIEW_PAPER, path) == []
]
ensure(empty_paths, "facet_state_empty_fixture")
for path in empty_paths:
    expected = {
        "unrecorded": "未记录",
        "not_applicable": "不适用",
        "pending_verification": "待核验",
    }[PREVIEW_PAPER.get("facet_states", {}).get(path, "unrecorded")]
    profile = page.locator(f'[data-profile-path="{path}"]')
    ensure(profile.count() == 1, f"facet_profile_{path}")
    ensure(expected in profile.inner_text(), f"facet_profile_state_{path}")
```

Also assert that the count of `.library-profile-empty--pending-verification` equals the number of explicit `pending_verification` entries among the selected paper’s empty paths. This proves the page does not infer pending work.

- [ ] **Step 7: Run unit, package, build, and browser acceptance and confirm GREEN**

Run in order:

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
node exporter/scripts/audit-github-package.mjs
node exporter/scripts/build-private-library.mjs
/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py
```

Expected:

- every named Node test file passes;
- package audit exits 0 and includes only allowlisted program/test files;
- build reports success and writes an index whose versions are `3/2`;
- browser acceptance exits 0, with empty states matching catalog data and no private-path/network/console regressions.

- [ ] **Step 8: Inspect the generated index without committing it**

Run:

```bash
node -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync("local_library_data/paper-index.json","utf8"));if(p.version!==3||p.facet_schema.version!==2)process.exit(1);if(p.papers.some(x=>!x.facet_states||Array.isArray(x.facet_states)))process.exit(2);console.log(`papers=${p.papers.length} version=${p.version}/${p.facet_schema.version}`)'
git status --short local_library_data local_library_output
```

Expected: the first command prints the current paper count and `version=3/2`; generated paths remain ignored or untracked and are not staged.

- [ ] **Step 9: Commit documentation, package boundaries, and acceptance updates**

```bash
git add README.md prototype/desktop/README.md exporter/config/github-package-files.json exporter/paper-library/package-audit.mjs exporter/paper-library/package-audit.test.mjs exporter/verification/private_library_e2e.py
git commit -m "test: accept paper facet state migration"
```

---

## Final Acceptance Checklist

- [ ] `paper-tags.json` is version 3 and migration changed no existing facet values or source terms.
- [ ] All catalog records have a sparse `facet_states` object; the initial migration leaves all of them empty.
- [ ] Unknown paths, unknown state values, and state/value collisions fail in exporter and browser validators.
- [ ] New generated records and public records carry `facet_states`; metadata provenance accepts and records its catalog source.
- [ ] New builds emit index/schema `3/2`; the desktop loader still accepts `2/1` and normalizes states to `{}`.
- [ ] Empty facets default to “未记录”; only explicit entries show “不适用” or “待核验”.
- [ ] Empty `source_terms` displays “未记录”.
- [ ] Existing filters continue to use only actual facet values; empty-state labels do not become filter values.
- [ ] Public package boundaries include reusable migration code and exclude the real catalog, generated data, and private paths.
- [ ] Existing PDF/OCR/note preview, filtering, reading markers, P02 shelf, and desktop viewport tests still pass.
