# Paper Library Personal Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-only personal paper tags with isolated browser storage, immediate add/remove/search behavior, and strict merge-only JSON backup without changing academic facets or the existing workspace state.

**Architecture:** A new `paper-user-tags.mjs` owns all normalization, validation, persistence, and JSON exchange under its own localStorage key. The library model receives a separate `userTagState` only for text matching, while one reusable renderer places the same editor in the list inspector and the detail overview. The generated desktop bundle and GitHub package explicitly include the new module and its tests.

**Tech Stack:** Browser ES modules, Web Storage API, native DOM and file APIs, Node.js built-in test runner (`node:test`), existing memory-DOM test harness, existing private-library builder and package auditor.

**Spec:** `docs/superpowers/specs/2026-08-30-paper-library-manual-curation-design.md`

## Global Constraints

- Implement only the independent **personal tags** delivery phase; do not implement `facet_states`, the local Node import service, or Markdown note import in this plan.
- Desktop only; do not add mobile or tablet layouts.
- Use the exact storage key `research-console.paper-user-tags.v1`; do not add fields to `research-console.paper-library.v1` or change its version.
- Persist exactly `{ "version": 1, "papers": { "<paper_id>": ["<label>"] } }` and keep empty paper entries out of storage.
- Normalize each label with Unicode NFKC and trim only leading/trailing whitespace; reject control characters, line breaks, `/`, and `\\`.
- Limit one label to 24 Unicode code points, one paper to 20 labels, and the whole library to 500 stored paper-label assignments.
- Compare labels case-insensitively for Latin letters while preserving the first accepted display spelling.
- Personal tags participate in the title search box but never become academic facet values, facet filters, source terms, generated paper metadata, or `paper-tags.json` data.
- JSON import is merge-only. Any structural or label error rejects the entire import without changing localStorage; valid but unknown `paper_id` entries are skipped and counted.
- JSON export contains only `schema`, `version`, and `papers`; it must not contain paths, bibliography records, notes, or formal facets.
- Storage read/write failures must leave a deterministic in-memory store usable, matching the existing workspace-store resilience pattern.
- Do not modify, move, rename, or overwrite any PDF, OCR, existing note, code, or result file.
- Do not use `innerHTML`; all user labels and status messages must be assigned through `textContent`.
- Preserve static browsing: personal tags must work without the future local Node assistant.
- Use a fresh isolated worktree created with `superpowers:using-git-worktrees` when executing this plan.

---

### Task 1: Implement the isolated personal-tag store

**Files:**
- Create: `prototype/desktop/paper-user-tags.mjs`
- Create: `prototype/desktop/paper-user-tags.test.mjs`

**Interfaces:**
- Consumes: a Web-Storage-compatible object with `getItem(key)`, `setItem(key, value)`, and `removeItem(key)`; `knownPaperIds` as an iterable of stable paper IDs.
- Produces: `USER_TAG_STORAGE_KEY: "research-console.paper-user-tags.v1"`; `createUserTagStore(storage)` returning `read()`, `tagsFor(paperId)`, `add(paperId, label)`, `remove(paperId, label)`, `exportJson()`, `importJson(text, { mode: "merge", knownPaperIds })`, and `clear()`.
- Produces: `add()` result `{ added: boolean, label: string, state: UserTagState }`; `remove()` result `{ removed: boolean, state: UserTagState }`; `importJson()` result `{ state: UserTagState, addedCount: number, duplicateCount: number, unmatchedPaperCount: number, unmatchedPaperIds: string[] }`.
- Produces: every returned state/list is a clone; callers cannot mutate internal state through returned references.

- [ ] **Step 1: Write the failing normalization, mutation, and isolation tests**

Create `prototype/desktop/paper-user-tags.test.mjs` with the fake storage helper and the first behavioral group:

```js
import test from "node:test"
import assert from "node:assert/strict"

import {
  USER_TAG_STORAGE_KEY,
  createUserTagStore,
} from "./paper-user-tags.mjs"

function fakeStorage(initial = new Map()) {
  const data = initial
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: (key) => data.get(key),
  }
}

test("stores personal tags under an isolated key with NFKC normalization and first-spelling dedupe", () => {
  const storage = fakeStorage(new Map([[
    "research-console.paper-library.v1",
    JSON.stringify({ version: 1, shelf: {}, personalReading: {}, selectedPaperId: null }),
  ]]))
  const store = createUserTagStore(storage)

  assert.deepEqual(store.add("Zhao24-DFL", "  Ｂａｓｅｌｉｎｅ  "), {
    added: true,
    label: "Baseline",
    state: { version: 1, papers: { "Zhao24-DFL": ["Baseline"] } },
  })
  assert.deepEqual(store.add("Zhao24-DFL", "baseline"), {
    added: false,
    label: "Baseline",
    state: { version: 1, papers: { "Zhao24-DFL": ["Baseline"] } },
  })
  assert.equal(JSON.parse(storage.raw(USER_TAG_STORAGE_KEY)).papers["Zhao24-DFL"][0], "Baseline")
  assert.match(storage.raw("research-console.paper-library.v1"), /selectedPaperId/u)
})

test("adds, lists, removes, clears, and clones personal tag state", () => {
  const storage = fakeStorage()
  const store = createUserTagStore(storage)
  store.add("Paper-01", "必读")
  store.add("Paper-01", "可作基线")
  const tags = store.tagsFor("Paper-01")
  tags.push("泄漏")
  const snapshot = store.read()
  snapshot.papers["Paper-01"].push("泄漏")

  assert.deepEqual(store.tagsFor("Paper-01"), ["必读", "可作基线"])
  assert.deepEqual(store.remove("Paper-01", "必读"), {
    removed: true,
    state: { version: 1, papers: { "Paper-01": ["可作基线"] } },
  })
  assert.deepEqual(store.remove("Paper-01", "不存在"), {
    removed: false,
    state: { version: 1, papers: { "Paper-01": ["可作基线"] } },
  })
  assert.deepEqual(store.clear(), { version: 1, papers: {} })
  assert.equal(storage.raw(USER_TAG_STORAGE_KEY), undefined)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test prototype/desktop/paper-user-tags.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `prototype/desktop/paper-user-tags.mjs`.

- [ ] **Step 3: Write the failing validation, limit, resilience, and JSON tests**

Append these exact tests to `prototype/desktop/paper-user-tags.test.mjs`:

```js
test("rejects invalid paper IDs and labels without changing prior state", () => {
  const store = createUserTagStore(fakeStorage())
  store.add("Paper-01", "保留")
  const before = store.read()
  for (const [paperId, label, expected] of [
    ["bad", "标签", /论文 ID 格式无效/u],
    ["../escape", "标签", /论文 ID 格式无效/u],
    ["Paper-01", "", /标签不能为空/u],
    ["Paper-01", "a/b", /路径分隔符/u],
    ["Paper-01", "a\\b", /路径分隔符/u],
    ["Paper-01", "换行\n标签", /控制字符或换行/u],
    ["Paper-01", "a".repeat(25), /24 个 Unicode 码点/u],
  ]) assert.throws(() => store.add(paperId, label), expected)
  assert.deepEqual(store.read(), before)
})

test("counts Unicode code points and enforces per-paper and whole-library assignment limits", () => {
  const perPaper = createUserTagStore(fakeStorage())
  perPaper.add("Paper-01", "😀".repeat(24))
  for (let index = 1; index < 20; index += 1) perPaper.add("Paper-01", `标签${index}`)
  assert.throws(() => perPaper.add("Paper-01", "第21个"), /每篇论文最多 20 个/u)

  const papers = {}
  for (let paper = 0; paper < 25; paper += 1) {
    papers[`Paper-${paper + 1}`] = Array.from({ length: 20 }, (_, tag) => `T${paper}-${tag}`)
  }
  const storage = fakeStorage(new Map([[USER_TAG_STORAGE_KEY, JSON.stringify({ version: 1, papers })]]))
  const wholeLibrary = createUserTagStore(storage)
  assert.throws(() => wholeLibrary.add("Paper-26", "overflow"), /整个论文库最多 500 个/u)
})

test("resets malformed persisted data and remains usable when storage throws", () => {
  for (const raw of [
    "{",
    JSON.stringify({ version: 2, papers: {} }),
    JSON.stringify({ version: 1, papers: [], extra: true }),
    JSON.stringify({ version: 1, papers: { "../escape": ["标签"] } }),
    JSON.stringify({ version: 1, papers: { "Paper-01": ["重复", "重复"] } }),
    JSON.stringify({ version: 1, papers: { "Paper-01": ["a/b"] } }),
  ]) {
    const store = createUserTagStore(fakeStorage(new Map([[USER_TAG_STORAGE_KEY, raw]])))
    assert.deepEqual(store.read(), { version: 1, papers: {} })
  }

  const denied = {
    getItem() { throw new Error("denied") },
    setItem() { throw new Error("quota") },
    removeItem() { throw new Error("denied") },
  }
  const store = createUserTagStore(denied)
  store.add("Paper-01", "离线可用")
  assert.deepEqual(store.tagsFor("Paper-01"), ["离线可用"])
  assert.deepEqual(store.clear(), { version: 1, papers: {} })
})

test("exports only the strict personal-tag document", () => {
  const store = createUserTagStore(fakeStorage())
  store.add("Paper-01", "必读")
  assert.deepEqual(JSON.parse(store.exportJson()), {
    schema: "research-console.paper-user-tags",
    version: 1,
    papers: { "Paper-01": ["必读"] },
  })
  assert.doesNotMatch(store.exportJson(), /relative_path|facets|authors|notes/u)
})

test("merge import dedupes, skips valid unknown papers, and reports exact counts", () => {
  const storage = fakeStorage()
  const store = createUserTagStore(storage)
  store.add("Paper-01", "必读")
  const result = store.importJson(JSON.stringify({
    schema: "research-console.paper-user-tags",
    version: 1,
    papers: {
      "Paper-01": ["必读", "可作基线", "可作基线"],
      "Paper-Unknown": ["未知论文标签"],
    },
  }), { mode: "merge", knownPaperIds: new Set(["Paper-01", "Paper-02"]) })

  assert.deepEqual(result, {
    state: { version: 1, papers: { "Paper-01": ["必读", "可作基线"] } },
    addedCount: 1,
    duplicateCount: 2,
    unmatchedPaperCount: 1,
    unmatchedPaperIds: ["Paper-Unknown"],
  })
  assert.deepEqual(JSON.parse(storage.raw(USER_TAG_STORAGE_KEY)).papers["Paper-01"], ["必读", "可作基线"])
})

test("any import structure or label error rejects the whole document without persisting", () => {
  const invalidDocuments = [
    { schema: "wrong", version: 1, papers: {} },
    { schema: "research-console.paper-user-tags", version: 2, papers: {} },
    { schema: "research-console.paper-user-tags", version: 1, papers: {}, extra: true },
    { schema: "research-console.paper-user-tags", version: 1, papers: [] },
    { schema: "research-console.paper-user-tags", version: 1, papers: { bad: ["标签"] } },
    { schema: "research-console.paper-user-tags", version: 1, papers: { "Paper-01": "标签" } },
    { schema: "research-console.paper-user-tags", version: 1, papers: { "Paper-01": ["a/b"] } },
  ]
  for (const document of invalidDocuments) {
    const storage = fakeStorage()
    const store = createUserTagStore(storage)
    store.add("Paper-01", "保留")
    const before = storage.raw(USER_TAG_STORAGE_KEY)
    assert.throws(
      () => store.importJson(JSON.stringify(document), { mode: "merge", knownPaperIds: ["Paper-01"] }),
      /个人标签导入文件/u,
    )
    assert.equal(storage.raw(USER_TAG_STORAGE_KEY), before)
    assert.deepEqual(store.tagsFor("Paper-01"), ["保留"])
  }
  assert.throws(
    () => createUserTagStore(fakeStorage()).importJson("{", { mode: "merge", knownPaperIds: [] }),
    /个人标签导入文件不是有效 JSON/u,
  )
  assert.throws(
    () => createUserTagStore(fakeStorage()).importJson("{}", { mode: "replace", knownPaperIds: [] }),
    /只支持 merge/u,
  )
})
```

- [ ] **Step 4: Implement the store with strict validation and transactional import**

Create `prototype/desktop/paper-user-tags.mjs` with the following implementation. Keep import validation in a temporary normalized object; call `persist()` only after every root, paper, label, and limit check passes.

```js
export const USER_TAG_STORAGE_KEY = "research-console.paper-user-tags.v1"

const EXPORT_SCHEMA = "research-console.paper-user-tags"
const EXPLICIT_PAPER_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u
const FALLBACK_PAPER_ID = /^LIB-[A-F0-9]{12}$/u
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u
const PATH_SEPARATOR = /[\\/]/u
const STATE_KEYS = Object.freeze(["version", "papers"])
const EXPORT_KEYS = Object.freeze(["schema", "version", "papers"])
const MAX_LABEL_CODE_POINTS = 24
const MAX_TAGS_PER_PAPER = 20
const MAX_LIBRARY_ASSIGNMENTS = 500

function emptyState() {
  return { version: 1, papers: {} }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

function validPaperId(value) {
  return typeof value === "string" && (EXPLICIT_PAPER_ID.test(value) || FALLBACK_PAPER_ID.test(value))
}

function validatePaperId(value) {
  if (!validPaperId(value)) throw new TypeError("论文 ID 格式无效")
}

function normalizeLabel(value) {
  if (typeof value !== "string") throw new TypeError("标签必须是文本")
  const label = value.normalize("NFKC").trim()
  if (!label) throw new TypeError("标签不能为空")
  if (CONTROL_CHARACTER.test(label)) throw new TypeError("标签不能包含控制字符或换行")
  if (PATH_SEPARATOR.test(label)) throw new TypeError("标签不能包含路径分隔符")
  if (Array.from(label).length > MAX_LABEL_CODE_POINTS) throw new TypeError("标签最多 24 个 Unicode 码点")
  return label
}

function comparisonKey(label) {
  return label.toLocaleLowerCase("en-US")
}

function assignmentCount(state) {
  return Object.values(state.papers).reduce((sum, labels) => sum + labels.length, 0)
}

function cloneState(state) {
  return {
    version: 1,
    papers: Object.fromEntries(Object.entries(state.papers).map(([paperId, labels]) => [paperId, [...labels]])),
  }
}

function validateCanonicalState(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, STATE_KEYS) || value.version !== 1 || !isPlainObject(value.papers)) return false
  let total = 0
  for (const [paperId, labels] of Object.entries(value.papers)) {
    if (!validPaperId(paperId) || !Array.isArray(labels) || labels.length === 0 || labels.length > MAX_TAGS_PER_PAPER) return false
    const seen = new Set()
    for (const label of labels) {
      let normalized
      try { normalized = normalizeLabel(label) } catch { return false }
      if (normalized !== label || seen.has(comparisonKey(label))) return false
      seen.add(comparisonKey(label))
    }
    total += labels.length
  }
  return total <= MAX_LIBRARY_ASSIGNMENTS
}

function loadInitialState(storage) {
  try {
    const raw = storage?.getItem?.(USER_TAG_STORAGE_KEY)
    if (raw === null || raw === undefined) return emptyState()
    const parsed = JSON.parse(raw)
    return validateCanonicalState(parsed) ? cloneState(parsed) : emptyState()
  } catch {
    return emptyState()
  }
}

function normalizeImportDocument(text) {
  let value
  try { value = JSON.parse(text) } catch { throw new TypeError("个人标签导入文件不是有效 JSON") }
  if (!isPlainObject(value) || !hasExactKeys(value, EXPORT_KEYS)
      || value.schema !== EXPORT_SCHEMA || value.version !== 1 || !isPlainObject(value.papers)) {
    throw new TypeError("个人标签导入文件结构无效")
  }
  const papers = {}
  for (const [paperId, labels] of Object.entries(value.papers)) {
    if (!validPaperId(paperId) || !Array.isArray(labels)) throw new TypeError("个人标签导入文件论文记录无效")
    papers[paperId] = labels.map((label) => {
      try { return normalizeLabel(label) } catch { throw new TypeError("个人标签导入文件包含无效标签") }
    })
  }
  return papers
}

export function createUserTagStore(storage) {
  let state = loadInitialState(storage)

  function persist(nextState) {
    if (!validateCanonicalState(nextState)) throw new TypeError("个人标签状态无效")
    state = cloneState(nextState)
    try { storage?.setItem?.(USER_TAG_STORAGE_KEY, JSON.stringify(state)) } catch {}
  }

  function findExisting(labels, label) {
    const key = comparisonKey(label)
    return labels.find((candidate) => comparisonKey(candidate) === key) ?? null
  }

  return {
    read: () => cloneState(state),

    tagsFor(paperId) {
      validatePaperId(paperId)
      return [...(state.papers[paperId] ?? [])]
    },

    add(paperId, rawLabel) {
      validatePaperId(paperId)
      const label = normalizeLabel(rawLabel)
      const labels = state.papers[paperId] ?? []
      const existing = findExisting(labels, label)
      if (existing) return { added: false, label: existing, state: cloneState(state) }
      if (labels.length >= MAX_TAGS_PER_PAPER) throw new RangeError("每篇论文最多 20 个标签")
      if (assignmentCount(state) >= MAX_LIBRARY_ASSIGNMENTS) throw new RangeError("整个论文库最多 500 个标签")
      persist({ ...cloneState(state), papers: { ...cloneState(state).papers, [paperId]: [...labels, label] } })
      return { added: true, label, state: cloneState(state) }
    },

    remove(paperId, rawLabel) {
      validatePaperId(paperId)
      const label = normalizeLabel(rawLabel)
      const key = comparisonKey(label)
      const labels = state.papers[paperId] ?? []
      const nextLabels = labels.filter((candidate) => comparisonKey(candidate) !== key)
      if (nextLabels.length === labels.length) return { removed: false, state: cloneState(state) }
      const next = cloneState(state)
      if (nextLabels.length === 0) delete next.papers[paperId]
      else next.papers[paperId] = nextLabels
      persist(next)
      return { removed: true, state: cloneState(state) }
    },

    exportJson() {
      return `${JSON.stringify({ schema: EXPORT_SCHEMA, version: 1, papers: cloneState(state).papers }, null, 2)}\n`
    },

    importJson(text, { mode, knownPaperIds } = {}) {
      if (mode !== "merge") throw new TypeError("个人标签导入只支持 merge 模式")
      const incoming = normalizeImportDocument(text)
      const known = new Set(knownPaperIds ?? [])
      const next = cloneState(state)
      let addedCount = 0
      let duplicateCount = 0
      const unmatchedPaperIds = []
      for (const [paperId, labels] of Object.entries(incoming)) {
        if (!known.has(paperId)) {
          unmatchedPaperIds.push(paperId)
          continue
        }
        const merged = [...(next.papers[paperId] ?? [])]
        for (const label of labels) {
          if (findExisting(merged, label)) duplicateCount += 1
          else {
            if (merged.length >= MAX_TAGS_PER_PAPER) throw new RangeError("个人标签导入后每篇论文将超过 20 个标签")
            merged.push(label)
            addedCount += 1
          }
        }
        if (merged.length > 0) next.papers[paperId] = merged
      }
      if (assignmentCount(next) > MAX_LIBRARY_ASSIGNMENTS) throw new RangeError("个人标签导入后整个论文库将超过 500 个标签")
      if (addedCount > 0) persist(next)
      return {
        state: cloneState(state), addedCount, duplicateCount,
        unmatchedPaperCount: unmatchedPaperIds.length, unmatchedPaperIds,
      }
    },

    clear() {
      state = emptyState()
      try { storage?.removeItem?.(USER_TAG_STORAGE_KEY) } catch {}
      return cloneState(state)
    },
  }
}
```

- [ ] **Step 5: Run the store tests and verify GREEN**

Run: `node --test prototype/desktop/paper-user-tags.test.mjs`

Expected: PASS for all personal-tag store tests, including exactly one 500-assignment boundary test and the no-persistence invalid-import assertions.

- [ ] **Step 6: Commit the isolated store**

```bash
git add prototype/desktop/paper-user-tags.mjs prototype/desktop/paper-user-tags.test.mjs
git commit -m "feat: add isolated paper user tag store"
```

### Task 2: Add personal tags to text search without creating a facet

**Files:**
- Modify: `prototype/desktop/paper-library-model.mjs`
- Modify: `prototype/desktop/paper-library-model.test.mjs`

**Interfaces:**
- Consumes: `UserTagState = { version: 1, papers: Record<string, string[]> }` from Task 1.
- Produces: `searchableText(paper, facetSchema, userTags = [])` and `matchPaperQuery(paper, query, facetSchema, userTags = [])` with hit label `我的标签`.
- Produces: `filterLibrary(papers, filters = {}, workspaceState = {}, userTagState = {})` and `buildLibraryViewState({ ..., userTagState = {} })`.
- Preserves: `facetValues()` and `matchFacetFilters()` read only `paper.facets`; personal labels are never available as academic facet choices.

- [ ] **Step 1: Write failing model tests for search hits and facet separation**

Add `userTagState` and the following tests to `prototype/desktop/paper-library-model.test.mjs`:

```js
const userTagState = Object.freeze({
  version: 1,
  papers: Object.freeze({
    "Paper-A": Object.freeze(["必读", "可作基线"]),
    "Paper-C": Object.freeze(["隐私方向候选"]),
  }),
})

test("searches personal tags through a separate state and reports a user-tag hit", () => {
  assert.deepEqual(matchPaperQuery(papers[0], "可作基线", facetSchema, userTagState.papers["Paper-A"]), {
    matched: true,
    hits: [{ field: "我的标签", snippet: "可作基线" }],
  })
  assert.deepEqual(
    filterLibrary(papers, { query: "隐私方向候选", facetSchema }, {}, userTagState).map((paper) => paper.paper_id),
    ["Paper-C"],
  )
  assert.match(searchableText(papers[0], facetSchema, userTagState.papers["Paper-A"]), /可作基线/u)
})

test("personal tags never become formal facet values or facet filters", () => {
  const tagged = { ...papers[0], user_tags: ["伪造正式分面"] }
  assert.deepEqual(facetValues(tagged, "user_tags"), [])
  assert.deepEqual(
    filterLibrary([tagged], { facets: { "research.domain": ["可作基线"] } }, {}, userTagState),
    [],
  )
  assert.equal(matchPaperQuery(tagged, "伪造正式分面", facetSchema).matched, false)
})

test("buildLibraryViewState carries personal-tag hits without mutating either state", () => {
  const frozenTags = deepFreeze(structuredClone(userTagState))
  const frozenWorkspace = deepFreeze({ shelf: {}, personalReading: {}, selectedPaperId: "Paper-A" })
  const view = buildLibraryViewState({
    papers,
    filters: { query: "必读" },
    facetSchema,
    workspaceState: frozenWorkspace,
    userTagState: frozenTags,
  })

  assert.deepEqual(view.rows.map((row) => row.paper.paper_id), ["Paper-A"])
  assert.deepEqual(view.rows[0].hits, [{ field: "我的标签", snippet: "必读" }])
  assert.deepEqual(frozenTags, userTagState)
})
```

- [ ] **Step 2: Run the focused model test and verify RED**

Run: `node --test --test-name-pattern="personal tags|personal-tag" prototype/desktop/paper-library-model.test.mjs`

Expected: FAIL because `matchPaperQuery`, `filterLibrary`, and `buildLibraryViewState` ignore the new separate tag argument.

- [ ] **Step 3: Thread personal tags through search and view-state construction**

In `prototype/desktop/paper-library-model.mjs`, add the helper and change the four signatures/call sites exactly as follows:

```js
function userTagsForPaper(userTagState, paperId) {
  const labels = userTagState?.papers?.[paperId]
  return Array.isArray(labels) ? labels.filter((label) => typeof label === "string") : []
}

export function searchableText(paper, facetSchema, userTags = []) {
  const values = [
    ...SEARCH_FIELDS.flatMap((field) => fieldValues(paper, field)),
    ...schemaGroups(facetSchema).flatMap((group) => facetValues(paper, group.path)),
    ...(Array.isArray(paper?.source_terms) ? paper.source_terms.filter((value) => typeof value === "string") : []),
    ...(Array.isArray(userTags) ? userTags.filter((value) => typeof value === "string") : []),
  ]
  return values.map(normalizeText).filter(Boolean).join(" ")
}

export function matchPaperQuery(paper, query, facetSchema, userTags = []) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return { matched: true, hits: [] }
  const hits = []
  const seen = new Set()
  const fields = [
    ...SEARCH_FIELDS.map((field) => ({
      label: field.label,
      dedupeKey: field.dedupeKey ?? field.label,
      values: fieldValues(paper, field),
    })),
    ...schemaGroups(facetSchema).map((group) => ({ label: group.label, values: facetValues(paper, group.path) })),
    { label: "原文术语", values: Array.isArray(paper?.source_terms) ? paper.source_terms.filter((value) => typeof value === "string") : [] },
    { label: "我的标签", values: Array.isArray(userTags) ? userTags.filter((value) => typeof value === "string") : [] },
  ]
  for (const field of fields) {
    for (const rawValue of field.values) {
      if (!normalizeText(rawValue).includes(normalizedQuery)) continue
      const snippet = capCodePoints(displayText(rawValue))
      if (!snippet) continue
      const dedupeKey = `${field.dedupeKey ?? field.label}\u0000${snippet}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      hits.push({ field: field.label, snippet })
    }
  }
  return { matched: hits.length > 0, hits }
}

export function filterLibrary(papers, filters = {}, workspaceState = {}, userTagState = {}) {
  const source = Array.isArray(papers) ? papers : []
  const shelf = workspaceState?.shelf ?? {}
  const personalReading = workspaceState?.personalReading ?? {}
  const facets = filters?.facets
  const recordTypes = selectedValues(filters, "recordTypes")
  const personalReadingMarkers = selectedValues(filters, "personalReadingMarkers")
  const sourceStatuses = selectedValues(filters, "sourceStatuses")
  const evidenceStatuses = selectedValues(filters, "evidenceStatuses")
  const reproductionStatuses = selectedValues(filters, "reproductionStatuses")
  const shelfRoles = selectedValues(filters, "shelfRoles")

  return source.filter((paper) => {
    const userTags = userTagsForPaper(userTagState, paper?.paper_id)
    if (!matchPaperQuery(paper, filters?.query ?? "", filters?.facetSchema, userTags).matched) return false
    if (!matchFacetFilters(paper, facets)) return false
    if (!matchesAxis(recordTypes, [paper?.record_type])) return false
    if (!matchesAxis(personalReadingMarkers, [personalMarkerFor(paper, personalReading)])) return false
    if (!matchesAxis(sourceStatuses, [paper?.source_status])) return false
    if (!matchesAxis(evidenceStatuses, [paper?.evidence_status])) return false
    if (!matchesAxis(reproductionStatuses, [paper?.reproduction_status])) return false
    return matchesAxis(shelfRoles, shelfRolesFor(paper, shelf))
  })
}

export function buildLibraryViewState({
  papers = [], filters = {}, facetSchema, sortMode = "default", workspaceState = {}, userTagState = {},
} = {}) {
  const allPapers = Array.isArray(papers) ? papers : []
  const shelf = workspaceState?.shelf ?? {}
  const personalReading = workspaceState?.personalReading ?? {}
  const queryFacetSchema = facetSchema ?? filters?.facetSchema
  const filtersWithSchema = facetSchema === undefined || filters?.facetSchema === facetSchema
    ? filters
    : { ...filters, facetSchema }
  const filtered = filterLibrary(allPapers, filtersWithSchema, workspaceState, userTagState)
  const visible = sortLibrary(filtered, sortMode, shelf)
  const rows = visible.map((paper) => ({
    paper,
    hits: matchPaperQuery(
      paper,
      filters?.query ?? "",
      queryFacetSchema,
      userTagsForPaper(userTagState, paper.paper_id),
    ).hits,
    personalReadingMarker: personalMarkerFor(paper, personalReading),
    shelfRoles: [...shelfRolesFor(paper, shelf)],
    availabilitySummary: summarizeAvailability(paper),
  }))
  const stableAllPapers = sortLibrary(allPapers, "default", shelf)
  const shelfSummaries = P02_ROLES.map((role) => ({
    role,
    ...summarizeShelfRole(role, stableAllPapers, shelf),
  }))
  const selectedPaperId = workspaceState?.selectedPaperId
  const selectedExists = allPapers.some((paper) => paper?.paper_id === selectedPaperId)
  const selectedPaper = selectedExists
    ? visible.find((paper) => paper?.paper_id === selectedPaperId) ?? visible[0] ?? null
    : visible[0] ?? null
  return {
    totalCount: allPapers.length,
    resultCount: rows.length,
    rows,
    shelfSummaries,
    selectedPaper,
    empty: rows.length === 0,
  }
}
```

Do not add `user_tags` to `SEARCH_FIELDS`, `facetValues`, the paper object, or the canonical facet schema. Replace only the existing function bodies/signatures shown above; retain all unshown current declarations and return fields byte-for-byte.

- [ ] **Step 4: Run model tests and verify GREEN**

Run: `node --test prototype/desktop/paper-library-model.test.mjs`

Expected: PASS for the complete model suite; existing searches still return the same bibliographic, facet, and source-term hits, and the three new tests pass.

- [ ] **Step 5: Commit the search integration**

```bash
git add prototype/desktop/paper-library-model.mjs prototype/desktop/paper-library-model.test.mjs
git commit -m "feat: search paper user tags"
```

### Task 3: Render one reusable personal-tag editor in both required locations

**Files:**
- Modify: `prototype/desktop/paper-inspector.mjs`
- Modify: `prototype/desktop/paper-library-dom.test.mjs`

**Interfaces:**
- Consumes: `userTags: string[]` and `userTagNotice: string` supplied by the controller; `paper.paper_id` and `displayPaperTitle(paper)` from the normalized index.
- Produces: `renderUserTagEditor({ document, paper, userTags = [], userTagNotice = "" }) -> HTMLElement`.
- Produces: exact stable action hooks `data-user-tag-form`, `data-user-tag-input`, `data-action="remove-user-tag"`, `data-user-tag-label`, `data-action="export-user-tags"`, and `data-action="import-user-tags"`.
- Changes: `renderInspector({ ..., userTags, userTagNotice })` and `renderReaderOverview({ ..., userTags, userTagNotice })` render the editor once, ahead of the research profile.

- [ ] **Step 1: Write failing renderer tests for both placements and safe text handling**

Extend the existing inspector-rendering area of `prototype/desktop/paper-library-dom.test.mjs` with:

```js
test("personal tag editor renders safe add, remove, import, and export controls", async () => {
  const { renderUserTagEditor } = await import("./paper-inspector.mjs")
  const document = {
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const paper = normalizedPaper({ paper_id: "Paper-01", title_zh: "测试论文" })
  const root = renderUserTagEditor({
    document,
    paper,
    userTags: ["必读", "<img src=x onerror=alert(1)>"],
    userTagNotice: "已添加标签“必读”",
  })

  assert.match(root.textContent, /我的标签必读<img src=x onerror=alert\(1\)>/u)
  assert.equal(root.querySelectorAll("img").length, 0)
  assert.equal(root.querySelectorAll('[data-user-tag-form]').length, 1)
  assert.equal(root.querySelectorAll('[data-user-tag-input]').length, 1)
  assert.deepEqual(
    root.querySelectorAll('[data-action="remove-user-tag"]').map((button) => button.dataset.userTagLabel),
    ["必读", "<img src=x onerror=alert(1)>"],
  )
  assert.equal(root.querySelectorAll('[data-action="export-user-tags"]').length, 1)
  assert.equal(root.querySelectorAll('[data-action="import-user-tags"]').length, 1)
  assert.match(root.querySelector('[data-user-tag-notice]').textContent, /已添加标签/u)
})

test("inspector and reader overview each place personal tags before the research profile", async () => {
  const { renderInspector, renderReaderOverview } = await import("./paper-inspector.mjs")
  const document = {
    createElement: (tagName) => new MemoryNode(tagName),
    createTextNode: (value) => {
      const node = new MemoryNode("#text")
      node.textContent = value
      return node
    },
  }
  const paper = normalizedPaper()
  const inspector = renderInspector({
    document, paper, workspaceState: {}, facetSchema: validFacetSchema(), userTags: ["必读"], userTagNotice: "",
  })
  const overview = renderReaderOverview({
    document, paper, facetSchema: validFacetSchema(), userTags: ["必读"], userTagNotice: "",
  })

  for (const root of [inspector, overview]) {
    assert.equal(root.querySelectorAll('[data-user-tags]').length, 1)
    const children = root.children
    assert.ok(children.indexOf(root.querySelector('[data-user-tags]')) < children.indexOf(root.querySelector('.library-research-profile')))
  }
})
```

Also add `maxLength = -1` to `MemoryNode`'s constructor only if the implementation assigns that property; no renderer may rely on `innerHTML`.

- [ ] **Step 2: Run the focused DOM tests and verify RED**

Run: `node --test --test-name-pattern="personal tag editor|place personal tags" prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL because `renderUserTagEditor` is not exported and neither renderer accepts personal-tag arguments.

- [ ] **Step 3: Implement the reusable safe editor**

Add the following function to `prototype/desktop/paper-inspector.mjs` after `appendArtifactCounts`:

```js
export function renderUserTagEditor({ document, paper, userTags = [], userTagNotice = "" }) {
  const section = document.createElement("section")
  section.className = "library-inspector-section library-user-tags"
  section.dataset.userTags = ""
  appendTextElement(document, section, "h3", "我的标签")

  const labels = Array.isArray(userTags)
    ? userTags.filter((label) => typeof label === "string" && label.trim())
    : []
  if (labels.length === 0) appendTextElement(document, section, "p", "尚未添加个人标签", "library-user-tags-empty")
  else {
    const list = document.createElement("ul")
    list.className = "library-user-tag-list"
    for (const label of labels) {
      const item = document.createElement("li")
      appendTextElement(document, item, "span", label)
      const remove = document.createElement("button")
      remove.type = "button"
      remove.dataset.action = "remove-user-tag"
      remove.dataset.userTagLabel = label
      remove.setAttribute("aria-label", `从《${displayPaperTitle(paper)}》移除个人标签“${label}”`)
      remove.textContent = "移除"
      item.append(remove)
      list.append(item)
    }
    section.append(list)
  }

  const form = document.createElement("form")
  form.className = "library-user-tag-form"
  form.dataset.userTagForm = ""
  const input = document.createElement("input")
  input.type = "text"
  input.name = "userTag"
  input.dataset.userTagInput = ""
  input.autocomplete = "off"
  input.placeholder = "例如：必读、可作基线"
  input.setAttribute("aria-label", `为《${displayPaperTitle(paper)}》添加个人标签`)
  const add = document.createElement("button")
  add.type = "submit"
  add.textContent = "添加"
  form.append(input, add)
  section.append(form)

  const backup = document.createElement("div")
  backup.className = "library-user-tag-backup"
  for (const [action, label] of [["export-user-tags", "导出标签"], ["import-user-tags", "导入标签"]]) {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = action
    button.textContent = label
    backup.append(button)
  }
  section.append(backup)

  const notice = appendTextElement(document, section, "p", userTagNotice, "library-user-tag-notice")
  notice.dataset.userTagNotice = ""
  notice.setAttribute("role", "status")
  notice.setAttribute("aria-live", "polite")
  return section
}
```

Then update the existing renderer signatures and insertion order with these exact calls:

```js
export function renderInspector({
  document, paper, workspaceState, facetSchema, userTags = [], userTagNotice = "",
}) {
  // Replace only the existing `appendResearchProfile(...)` statement with the two statements below.
  root.append(renderUserTagEditor({ document, paper, userTags, userTagNotice }))
  appendResearchProfile(document, root, paper, facetSchema)
}

export function renderReaderOverview({
  document, paper, facetSchema, userTags = [], userTagNotice = "",
}) {
  // Replace only the existing `appendResearchProfile(...)` statement with the two statements below.
  root.append(renderUserTagEditor({ document, paper, userTags, userTagNotice }))
  appendResearchProfile(document, root, paper, facetSchema)
}
```

In both existing functions, replace only the current direct `appendResearchProfile(...)` line with `root.append(renderUserTagEditor(...))` followed by that same profile line; do not duplicate or reorder any other existing section.

- [ ] **Step 4: Run the complete DOM suite and verify GREEN**

Run: `node --test prototype/desktop/paper-library-dom.test.mjs`

Expected: PASS; the existing action-count assertion is updated to expect three reading actions, four shelf actions, one copy-path action, and the new user-tag controls without changing formal facet hooks.

- [ ] **Step 5: Commit the shared renderer**

```bash
git add prototype/desktop/paper-inspector.mjs prototype/desktop/paper-library-dom.test.mjs
git commit -m "feat: render personal tag editors"
```

### Task 4: Wire add/remove/search and strict JSON exchange into the controller

**Files:**
- Modify: `prototype/desktop/library.template.html`
- Modify: `prototype/desktop/library.mjs`
- Modify: `prototype/desktop/paper-library-dom.test.mjs`
- Modify: `prototype/desktop/styles.css`

**Interfaces:**
- Consumes: `createUserTagStore(storage)` and result contracts from Task 1; search/view-state contracts from Task 2; editor action hooks from Task 3.
- Produces: one hidden file input `#library-user-tags-import` accepting `.json,application/json`.
- Produces: `downloadUserTagJson({ document, json, fileName = "paper-user-tags.json" }) -> void`, using the document window's `Blob` and `URL` APIs and revoking the object URL after the click.
- Produces: controller status messages rendered via `userTagNotice`; add/remove/import rerender immediately and preserve the current paper, search text, workspace state, and detail mode.
- Preserves: `createLibraryController({ document, storage, fetchImpl })` public signature and `{ start }` return value.

- [ ] **Step 1: Write failing static contract and layout tests**

Add these tests to `prototype/desktop/paper-library-dom.test.mjs`:

```js
test("template exposes one private JSON import input without adding a formal facet control", () => {
  assert.equal(countMatches(html, /id="library-user-tags-import"/gu), 1)
  assert.match(html, /id="library-user-tags-import"[^>]*type="file"[^>]*accept="\.json,application\/json"[^>]*hidden/u)
  assert.doesNotMatch(html, /data-filter-axis="userTags"|data-facet-path="user_tags"/u)
})

test("personal tag controls have desktop containment and visible focus styles", () => {
  assert.match(styles, /\.library-page \.library-user-tags\s*\{[^}]*min-width:\s*0/u)
  assert.match(styles, /\.library-page \.library-user-tag-list\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/u)
  assert.match(styles, /\.library-page \.library-user-tag-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u)
  assert.match(styles, /\.library-page \.library-user-tags button:focus-visible[^}]*outline/u)
  assert.match(styles, /@media \(max-width:\s*1320px\)[\s\S]*?\.library-page \.library-user-tag-form/u)
})
```

- [ ] **Step 2: Run static contract tests and verify RED**

Run: `node --test --test-name-pattern="private JSON import|desktop containment" prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL because the file input and personal-tag CSS rules do not exist.

- [ ] **Step 3: Add the hidden import input and bounded desktop styles**

Insert this immediately before the existing image-lightbox `<dialog>` in `prototype/desktop/library.template.html`:

```html
<input
  id="library-user-tags-import"
  type="file"
  accept=".json,application/json"
  hidden
  aria-label="导入个人标签 JSON"
>
```

Add these scoped rules alongside existing `.library-inspector-section` and reader-card rules in `prototype/desktop/styles.css`:

```css
.library-page .library-user-tags { min-width: 0; display: grid; gap: 9px; }
.library-page .library-user-tags > h3 { margin: 0; }
.library-page .library-user-tags-empty,
.library-page .library-user-tag-notice { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.45; }
.library-page .library-user-tag-notice:empty { display: none; }
.library-page .library-user-tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.library-page .library-user-tag-list li { min-width: 0; display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 5px 7px; border: 1px solid #cfe0f5; border-radius: 999px; background: #f2f7ff; color: var(--blue-deep); }
.library-page .library-user-tag-list li > span { min-width: 0; overflow-wrap: anywhere; }
.library-page .library-user-tag-list button,
.library-page .library-user-tag-backup button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.library-page .library-user-tag-list button { padding: 0 2px; color: #5e7390; }
.library-page .library-user-tag-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
.library-page .library-user-tag-form input { min-width: 0; height: 34px; padding: 0 9px; border: 1px solid var(--line-strong); border-radius: 8px; background: #fff; color: var(--ink); }
.library-page .library-user-tag-form button,
.library-page .library-user-tag-backup button { min-height: 32px; border: 1px solid var(--line-strong); border-radius: 8px; padding: 0 9px; background: #fff; color: var(--ink-soft); }
.library-page .library-user-tag-backup { display: flex; flex-wrap: wrap; gap: 7px; }
.library-page .library-user-tags button:focus-visible,
.library-page .library-user-tags input:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

@media (max-width: 1320px) {
  .library-page .library-user-tag-form { grid-template-columns: minmax(0, 1fr); }
  .library-page .library-user-tag-form button { justify-self: start; }
}
```

- [ ] **Step 4: Run static contract tests and verify GREEN**

Run: `node --test --test-name-pattern="private JSON import|desktop containment" prototype/desktop/paper-library-dom.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing controller-helper tests for download and separate-state view counts**

Add these pure helper tests to `prototype/desktop/paper-library-dom.test.mjs`:

```js
test("downloadUserTagJson downloads exact JSON and revokes its object URL", async () => {
  const { downloadUserTagJson } = await import("./library.mjs")
  const clicks = []
  const revoked = []
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type }
  }
  const document = {
    defaultView: {
      Blob: FakeBlob,
      URL: {
        createObjectURL(blob) {
          assert.deepEqual(blob.parts, ['{"schema":"research-console.paper-user-tags"}'])
          assert.equal(blob.type, "application/json")
          return "blob:paper-user-tags"
        },
        revokeObjectURL: (url) => revoked.push(url),
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "a")
      return { click() { clicks.push([this.href, this.download]) } }
    },
  }

  downloadUserTagJson({ document, json: '{"schema":"research-console.paper-user-tags"}' })
  assert.deepEqual(clicks, [["blob:paper-user-tags", "paper-user-tags.json"]])
  assert.deepEqual(revoked, ["blob:paper-user-tags"])
})

test("desktop view and facet counts honor personal-tag query through separate state", async () => {
  const { buildDesktopLibraryViewState, buildFacetPanelModel } = await import("./library.mjs")
  const paper = normalizedPaper({ paper_id: "Paper-01" })
  const userTagState = { version: 1, papers: { "Paper-01": ["基线候选"] } }
  const view = buildDesktopLibraryViewState({
    papers: [paper], filters: { query: "基线候选" }, facetSchema: validFacetSchema(), userTagState,
  })
  assert.equal(view.resultCount, 1)
  const panel = buildFacetPanelModel({
    panel: "research", facetSchema: validFacetSchema(), papers: [paper],
    filters: { query: "基线候选", facets: {} }, workspaceState: {}, userTagState,
  })
  assert.ok(panel.groups.some((group) => group.options.some((option) => option.count === 1)))
})
```

- [ ] **Step 6: Run controller-helper tests and verify RED**

Run: `node --test --test-name-pattern="downloadUserTagJson|personal-tag query" prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL because `downloadUserTagJson` is missing and `buildFacetPanelModel` does not forward `userTagState`.

- [ ] **Step 7: Implement the download helper and thread tag state through all counts**

Import the store at the top of `prototype/desktop/library.mjs`:

```js
import { createUserTagStore } from "./paper-user-tags.mjs"
```

Add this exported helper before `createLibraryController`:

```js
export function downloadUserTagJson({ document, json, fileName = "paper-user-tags.json" }) {
  const BlobImpl = document?.defaultView?.Blob
  const URLImpl = document?.defaultView?.URL
  if (typeof json !== "string" || typeof BlobImpl !== "function"
      || typeof URLImpl?.createObjectURL !== "function" || typeof URLImpl?.revokeObjectURL !== "function") {
    throw new Error("当前浏览器不支持标签导出")
  }
  const url = URLImpl.createObjectURL(new BlobImpl([json], { type: "application/json" }))
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    URLImpl.revokeObjectURL(url)
  }
}
```

Change the count helpers to accept the same fourth state used by the model:

```js
function optionCount({ papers, filters, workspaceState, userTagState, facetSchema, path, value }) {
  const facets = { ...(filters?.facets ?? {}) }
  delete facets[path]
  facets[path] = [value]
  return filterLibrary(papers, { ...filters, facets, facetSchema }, workspaceState, userTagState).length
}

function recordTypeCount({ papers, filters, workspaceState, userTagState, facetSchema, value }) {
  return filterLibrary(papers, { ...filters, recordTypes: [value], facetSchema }, workspaceState, userTagState).length
}
```

Make these four exact signature/call changes:

```diff
-export function buildFacetPanelModel({ panel, facetSchema, papers = [], filters = {}, workspaceState = {} } = {}) {
+export function buildFacetPanelModel({ panel, facetSchema, papers = [], filters = {}, workspaceState = {}, userTagState = {} } = {}) {
```

Within `buildFacetPanelModel`, add `userTagState` to the existing argument object passed to `optionCount` and the existing argument object passed to `recordTypeCount`.

```diff
-function selectedChipModels({ filters, facetSchema, papers = [], workspaceState = {} }) {
+function selectedChipModels({ filters, facetSchema, papers = [], workspaceState = {}, userTagState = {} }) {
```

Within `selectedChipModels`, add `userTagState` to the existing argument object passed to `optionCount` and the existing argument object passed to `recordTypeCount`.

```diff
-export function renderSelectedFacetChips({ document, mount, filters = {}, facetSchema, papers = [], workspaceState = {} }) {
+export function renderSelectedFacetChips({ document, mount, filters = {}, facetSchema, papers = [], workspaceState = {}, userTagState = {} }) {
   if (!mount) return
-  const chips = selectedChipModels({ filters, facetSchema, papers, workspaceState })
+  const chips = selectedChipModels({ filters, facetSchema, papers, workspaceState, userTagState })
```

The new parameter is optional and defaults to `{}`, so all existing callers and tests retain their prior behavior.

- [ ] **Step 8: Run helper tests and verify GREEN**

Run: `node --test --test-name-pattern="downloadUserTagJson|personal-tag query" prototype/desktop/paper-library-dom.test.mjs`

Expected: PASS.

- [ ] **Step 9: Write failing controller source-contract tests for mutation and import semantics**

Add this source-level contract test to `prototype/desktop/paper-library-dom.test.mjs`; its role is to ensure every store operation is wired to the separately rendered state and that imports always use current index IDs:

```js
test("controller wires personal tags through a separate store and merge-only file import", () => {
  assert.match(librarySource, /const userTagStore = createUserTagStore\(storage\)/u)
  assert.match(librarySource, /userTagStore\.add\(paperId,\s*input\.value\)/u)
  assert.match(librarySource, /userTagStore\.remove\(paperId,\s*action\.dataset\.userTagLabel\)/u)
  assert.match(librarySource, /userTagStore\.importJson\(text,\s*\{\s*mode:\s*"merge",\s*knownPaperIds:/u)
  assert.match(librarySource, /userTagStore\.exportJson\(\)/u)
  assert.match(librarySource, /const userTagState = userTagStore\.read\(\)/u)
  assert.doesNotMatch(librarySource, /store\.(?:add|remove|importJson|exportJson)\(/u)
})
```

- [ ] **Step 10: Run the controller source-contract test and verify RED**

Run: `node --test --test-name-pattern="separate store and merge-only" prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL because the controller has not instantiated or called the personal-tag store.

- [ ] **Step 11: Wire rendering, add/remove, export, and merge import**

Inside `createLibraryController`, instantiate the second store without changing the existing `store`:

```js
const store = createWorkspaceStore(storage)
const userTagStore = createUserTagStore(storage)
let userTagNotice = ""
```

Add the file input to `elements()`:

```js
userTagImport: document.getElementById("library-user-tags-import"),
```

At the start of `render()`, read both states and pass `userTagState` through the existing view/count/render calls:

```js
const workspaceState = store.read()
const userTagState = userTagStore.read()
const view = buildDesktopLibraryViewState({
  papers, filters, facetSchema, sortMode, workspaceState, userTagState,
})
```

Use these exact argument additions elsewhere in `render()` and its renderer helpers:

```js
buildFacetPanelModel({ panel: openFacetPanel, facetSchema, papers, filters, workspaceState, userTagState })
renderSelectedFacetChips({ document, mount: ui.selectedFacets, filters, facetSchema, papers, workspaceState, userTagState })
renderInspector({
  document, paper, workspaceState, facetSchema,
  userTags: userTagStore.tagsFor(paper.paper_id), userTagNotice,
})
renderReaderOverview({
  document, paper, facetSchema,
  userTags: userTagStore.tagsFor(paper.paper_id), userTagNotice,
})
```

Replace `renderCurrentInspector(mount, paper, workspaceState)` with `renderCurrentInspector(mount, paper, workspaceState, userTagState)`, and pass `userTagState.papers[paper.paper_id] ?? []` rather than reading the store again inside that renderer. Likewise change `renderReaderState(ui, paper, workspaceState)` to accept `userTagState`; this keeps each render based on one immutable pair of snapshots.

Add these controller-local helpers before `bindEvents()`:

```js
function personalTagPaperId() {
  return detailOpen ? detailPaperId : activePaperId
}

function focusUserTagInput(root) {
  root?.querySelector?.("[data-user-tag-input]")?.focus()
}

function mutateUserTag(action, root) {
  const paperId = personalTagPaperId()
  if (!paperById(papers, paperId)) return
  try {
    if (action.dataset.action === "remove-user-tag") {
      const result = userTagStore.remove(paperId, action.dataset.userTagLabel)
      userTagNotice = result.removed ? `已移除标签“${action.dataset.userTagLabel}”` : "标签未发生变化"
    } else if (action.dataset.action === "export-user-tags") {
      downloadUserTagJson({ document, json: userTagStore.exportJson() })
      userTagNotice = "个人标签 JSON 已导出"
    } else if (action.dataset.action === "import-user-tags") {
      elements().userTagImport?.click()
      return
    } else return
  } catch (error) {
    userTagNotice = error instanceof Error ? error.message : "个人标签操作失败"
  }
  render()
  if (action.dataset.action === "remove-user-tag") focusUserTagInput(root)
}

function bindUserTagEditor(root) {
  root?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-user-tag-form]")
    if (!form || !root.contains(form)) return
    event.preventDefault()
    const input = form.querySelector("[data-user-tag-input]")
    const paperId = personalTagPaperId()
    if (!input || !paperById(papers, paperId)) return
    try {
      const result = userTagStore.add(paperId, input.value)
      userTagNotice = result.added ? `已添加标签“${result.label}”` : `标签“${result.label}”已存在`
    } catch (error) {
      userTagNotice = error instanceof Error ? error.message : "个人标签操作失败"
    }
    render()
    focusUserTagInput(detailOpen ? elements().detail : elements().inspectorRoot)
  })
  root?.addEventListener("click", (event) => {
    const action = event.target.closest('[data-action="remove-user-tag"], [data-action="export-user-tags"], [data-action="import-user-tags"]')
    if (action && root.contains(action)) mutateUserTag(action, root)
  })
}
```

Call both bindings once inside `bindEvents()`:

```js
bindUserTagEditor(ui.inspectorRoot)
bindUserTagEditor(ui.detail)
```

Finally, add one change listener for the hidden import input:

```js
ui.userTagImport?.addEventListener("change", async () => {
  const file = ui.userTagImport.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const result = userTagStore.importJson(text, {
      mode: "merge",
      knownPaperIds: new Set(papers.map((paper) => paper.paper_id)),
    })
    userTagNotice = [
      `新增 ${result.addedCount} 个标签`,
      `跳过 ${result.duplicateCount} 个重复标签`,
      `未匹配 ${result.unmatchedPaperCount} 篇论文`,
    ].join("；")
  } catch (error) {
    userTagNotice = error instanceof Error ? error.message : "个人标签导入失败"
  } finally {
    ui.userTagImport.value = ""
  }
  render()
  focusUserTagInput(detailOpen ? elements().detail : elements().inspectorRoot)
})
```

Do not clear `userTagNotice` during ordinary search, sorting, tab changes, or workspace mutations; it changes only after the next personal-tag action.

- [ ] **Step 12: Run controller and model regression tests and verify GREEN**

Run: `node --test prototype/desktop/paper-user-tags.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/paper-library-storage.test.mjs`

Expected: PASS; in particular, existing workspace storage tests remain byte-for-byte valid and the source-contract test sees all four personal-tag store operations.

- [ ] **Step 13: Commit the controller and desktop UI**

```bash
git add prototype/desktop/library.template.html prototype/desktop/library.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/styles.css
git commit -m "feat: manage personal tags in paper library"
```

### Task 5: Ship the personal-tag module in generated output and the public code package

**Files:**
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/config/github-package-files.json`

**Interfaces:**
- Consumes: source assets `prototype/desktop/paper-user-tags.mjs` and `prototype/desktop/paper-user-tags.test.mjs`.
- Produces: generated asset `local_library_output/desktop/assets/paper-user-tags.mjs`, byte-identical to its source module.
- Produces: package manifest entries for the new module and unit test; no personal tag JSON, localStorage dump, source path, `local_library_config`, `local_library_data`, or `local_library_output` is packaged.

- [ ] **Step 1: Write failing build and package manifest expectations**

In both `exporter/paper-library/build.test.mjs` and the implementation constant in `exporter/paper-library/build.mjs`, the asset list must stay in the same established order. First update only the test constant in `build.test.mjs`:

```js
const REQUIRED_DESKTOP_ASSETS = Object.freeze([
  "styles.css",
  "library.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
])
```

Add these two required package entries to the `EXPECTED_PACKAGE_FILES` fixture in `exporter/paper-library/package-audit.test.mjs` at their lexical position, after `prototype/desktop/paper-math-renderer.test.mjs` and before `prototype/desktop/papers-data.mjs`:

```js
"prototype/desktop/paper-user-tags.mjs",
"prototype/desktop/paper-user-tags.test.mjs",
```

Add this generated-source mapping assertion next to the existing desktop asset assertions:

```js
assert.deepEqual(
  await readFile(join(fixture.repoRoot, "local_library_output/desktop/assets/paper-user-tags.mjs")),
  await readFile(join(fixture.templateRoot, "paper-user-tags.mjs")),
)
```

- [ ] **Step 2: Run focused build/package tests and verify RED**

Run: `node --test exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`

Expected: FAIL because the builder does not require/copy `paper-user-tags.mjs` and the production package allowlist/manifest do not contain the two new files.

- [ ] **Step 3: Add the asset and package entries to every production allowlist**

Append `"paper-user-tags.mjs"` after `"paper-library-storage.mjs"` in `REQUIRED_DESKTOP_ASSETS` in `exporter/paper-library/build.mjs`.

Insert both new source/test paths at their lexical position, after the existing paper-math-renderer entries and before `prototype/desktop/papers-data.mjs`, in:

```text
exporter/paper-library/package-audit.mjs       EXPECTED_PACKAGE_FILES
exporter/config/github-package-files.json     files
```

Add this exact generated-source mapping beside the other desktop asset mappings in `exporter/paper-library/package-audit.mjs` (the mapping table itself need not redefine the lexical package-file order):

```js
["local_library_output/desktop/assets/paper-user-tags.mjs", "prototype/desktop/paper-user-tags.mjs"],
```

Mirror the two source/test paths in the expected list in `exporter/paper-library/package-audit.test.mjs`. Do not add a JSON data file or any runtime tag state.

- [ ] **Step 4: Run focused build/package tests and verify GREEN**

Run: `node --test exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`

Expected: PASS, including the byte-equality generated-asset assertion and exact package-file-set assertion.

- [ ] **Step 5: Run the package boundary audit**

Run: `node exporter/scripts/audit-github-package.mjs`

Expected: exit code 0; output reports a valid package and does not mention a personal-tag JSON file or any private source directory.

- [ ] **Step 6: Commit build and packaging support**

```bash
git add exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.mjs exporter/paper-library/package-audit.test.mjs exporter/config/github-package-files.json
git commit -m "build: ship paper user tag module"
```

### Task 6: Document, rebuild, and verify the complete personal-tag phase

**Files:**
- Modify: `README.md`
- Modify: `prototype/desktop/README.md`
- Modify: `exporter/verification/private_library_e2e.py`
- Generated verification only, do not commit: `local_library_data/`
- Generated verification only, do not commit: `local_library_output/`
- Generated verification only, do not commit: `output/playwright/`

**Interfaces:**
- Consumes: the configured private-library build command and the existing Playwright acceptance harness.
- Produces: user documentation for local-only tags, exact JSON merge behavior, limits, and browser-local backup responsibility.
- Produces: browser acceptance proof that add/remove persist across reload, search finds a personal tag, JSON merge reports unmatched papers, and workspace state remains unchanged.

- [ ] **Step 1: Write the failing browser acceptance assertions**

In `exporter/verification/private_library_e2e.py`, add:

```py
USER_TAG_STORAGE_KEY = "research-console.paper-user-tags.v1"
REQUIRED_ASSETS = (*REQUIRED_ASSETS, "paper-user-tags.mjs")
```

Inside the existing per-viewport page exercise, after selecting the first stable paper, add this exact flow (reuse the existing `ensure` helper and selected paper ID variable):

```py
workspace_before = page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY)
tag_input = page.locator("#library-inspector [data-user-tag-input]")
tag_input.fill("验收基线")
tag_input.press("Enter")
ensure(page.locator("#library-inspector [data-user-tags]").get_by_text("验收基线", exact=True).count() == 1, "user_tag_added")

page.reload(wait_until="networkidle")
ensure(page.locator("#library-inspector [data-user-tags]").get_by_text("验收基线", exact=True).count() == 1, "user_tag_persisted")
page.locator("#library-search").fill("验收基线")
ensure(page.locator("#library-results [data-paper-id]").count() == 1, "user_tag_search_count")
ensure(page.locator("#library-results [data-paper-id]").first.get_attribute("data-paper-id") == selected_paper_id, "user_tag_search_id")
page.locator("#library-reset").click()

page.locator("#library-inspector [data-action='remove-user-tag'][data-user-tag-label='验收基线']").click()
ensure(page.locator("#library-inspector [data-user-tags]").get_by_text("验收基线", exact=True).count() == 0, "user_tag_removed")
ensure(page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY) == workspace_before, "workspace_state_unchanged_by_tags")
```

Add a merge-import check using Playwright's in-memory file payload:

```py
import_payload = {
    "schema": "research-console.paper-user-tags",
    "version": 1,
    "papers": {
        selected_paper_id: ["导入标签"],
        "Paper-Unknown": ["不会写入"],
    },
}
with page.expect_file_chooser() as chooser_info:
    page.locator("#library-inspector [data-action='import-user-tags']").click()
chooser_info.value.set_files({
    "name": "paper-user-tags.json",
    "mimeType": "application/json",
    "buffer": json.dumps(import_payload, ensure_ascii=False).encode("utf-8"),
})
ensure(page.locator("#library-inspector [data-user-tags]").get_by_text("导入标签", exact=True).count() == 1, "user_tag_imported")
ensure("未匹配 1 篇论文" in page.locator("#library-inspector [data-user-tag-notice]").inner_text(), "user_tag_unmatched_report")
stored_tags = page.evaluate("key => JSON.parse(localStorage.getItem(key))", USER_TAG_STORAGE_KEY)
ensure("Paper-Unknown" not in stored_tags["papers"], "user_tag_unknown_not_written")
```

At the end of each viewport exercise, clear only `USER_TAG_STORAGE_KEY` so the acceptance run is repeatable; do not clear `STORAGE_KEY` until the harness's existing workspace-state assertions finish.

- [ ] **Step 2: Run the browser acceptance and verify RED**

Run: `/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py`

Expected: FAIL on `user_tag_added` or missing `paper-user-tags.mjs` until Tasks 1–5 have been implemented and the private library has been rebuilt.

- [ ] **Step 3: Document the exact local behavior and backup boundary**

Add this section to `prototype/desktop/README.md`, and add a short link to it from the root `README.md` desktop-library section:

```markdown
### 我的标签

- 标签只保存在当前浏览器的 `research-console.paper-user-tags.v1`，不会写入论文目录、`paper-tags.json` 或正式研究分面。
- 单标签最多 24 个 Unicode 码点；每篇论文最多 20 个；整个库最多 500 个标签记录。
- 标签参与页面顶部搜索，可在论文检查器或详情页“快速概览”中添加和移除。
- “导出标签”下载只含论文编号与个人标签的 JSON；“导入标签”只合并，不会删除已有标签。
- 导入文件中的未知论文编号会被跳过并计数；任一结构或标签错误会取消整次导入。
- 更换浏览器、浏览器配置或电脑前，请先导出 JSON；该功能不依赖本地笔记导入服务。
```

- [ ] **Step 4: Run all unit and package tests**

Run:

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
node exporter/scripts/audit-github-package.mjs
```

Expected: both commands exit 0. Report the actual pass/fail totals printed by this run; do not substitute a historical fixed test count.

- [ ] **Step 5: Rebuild the configured private library and run browser acceptance**

Run:

```bash
node exporter/scripts/build-private-library.mjs
/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py
```

Expected: build exits 0; Playwright exits 0 at both configured desktop viewports; no console error, page error, failed required asset, horizontal overflow, or private-path leak is reported.

- [ ] **Step 6: Inspect both desktop viewports**

Open the acceptance screenshots from `output/playwright/` and verify all of the following before committing:

```text
1280×720: inspector tag chips wrap inside the sidebar; input and 添加 button stay visible.
1440×900: quick overview shows the same labels and controls ahead of the research profile.
Both: long 24-code-point labels wrap without horizontal page overflow.
Both: keyboard focus is visible on add, remove, import, and export controls.
Both: no personal label appears among academic facet checkboxes.
```

Expected: every line passes visual inspection. If any line fails, fix only the relevant scoped CSS/controller behavior, rerun Steps 4–6, and retain the new screenshot evidence.

- [ ] **Step 7: Confirm generated/private files remain untracked**

Run: `git status --short`

Expected: no path under `local_library_config/`, `local_library_data/`, `local_library_output/`, `output/playwright/`, the source paper archive, or any exported `paper-user-tags.json` is staged. Only the three documentation/acceptance files from this task are staged in the next step.

- [ ] **Step 8: Commit documentation and acceptance coverage**

```bash
git add README.md prototype/desktop/README.md exporter/verification/private_library_e2e.py
git commit -m "test: verify paper user tag workflow"
```

## Final Verification Checklist

- [ ] `research-console.paper-library.v1` remains version 1 with exactly `version`, `shelf`, `personalReading`, and `selectedPaperId`.
- [ ] `research-console.paper-user-tags.v1` is the only persistent location for personal tags.
- [ ] Invalid stored state resets only the tag store; invalid JSON import changes neither tag storage nor workspace storage.
- [ ] NFKC, 24-code-point, 20-per-paper, 500-library-assignment, path/control-character, and Latin-case dedupe rules all have passing tests.
- [ ] Personal tags are searchable with hit label `我的标签`, but are absent from `paper.facets`, `source_terms`, the canonical facet schema, and `paper-tags.json`.
- [ ] Both the list inspector and detail overview render one safe tag editor with add/remove/import/export actions.
- [ ] Exported JSON contains only `schema`, `version`, and `papers`; merge import skips and reports valid unknown paper IDs.
- [ ] Generated output includes byte-identical `assets/paper-user-tags.mjs`; package audit includes code/tests but no personal data.
- [ ] Existing PDF/OCR/previews, reading markers, P02 shelf roles, sorting, formal filters, and static browsing all pass regression tests.
- [ ] 1280×720 and 1440×900 acceptance evidence shows no horizontal overflow or clipped controls.
