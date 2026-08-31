# Three-Workspace Academic Workbench Integration Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the approved paper-library, literature-discovery, direction-snapshot, read-only agent-input, and local Markdown-import work into the authoritative `22dd` workspace, then replace the temporary preview with one privacy-bounded Node service at `http://127.0.0.1:4176` without losing valid browser state.

**Architecture:** `22dd` remains the only source of truth. The `aa09` and `2c10` worktrees are read-only donors for small, named modules; same-named scanner, builder, reader, inspector, status, preview, math, and storage files are never copied wholesale. Browser-only research state remains in versioned localStorage documents, generated library data remains read-only, and every filesystem mutation passes through one immediate-fail write coordinator. The final loopback server exposes an exact static allowlist plus six exact `/api/v1/` routes; it never serves the repository, source roots, local configuration, or private audit.

**Tech Stack:** Node.js 22 ES modules and built-ins, browser ES modules, Web Storage, native DOM and `<dialog>`, OpenAlex public Works API, JSON/YAML-compatible controlled metadata, existing KaTeX bundle, `node:test`, and the repository's Python Playwright acceptance harness.

**Spec:** `docs/superpowers/specs/2026-08-30-three-workspace-integration-design.md`

## Governing subplans

This master plan coordinates the following approved, detailed subplans. Their RED/GREEN code snippets and file-level steps remain mandatory unless this document explicitly supersedes a server, packaging, build, or cutover step.

1. `docs/superpowers/plans/2026-08-30-paper-library-facet-states.md`
2. `docs/superpowers/plans/2026-08-30-paper-library-personal-tags.md`
3. `docs/superpowers/plans/2026-08-30-paper-library-note-import.md`

Where there is a conflict, this master plan wins. In particular:

- Run the facet-state plan before the personal-tag plan so the canonical catalog/index upgrade lands before the independent browser tag layer.
- Treat facet-state Tasks 4 and 5 as one deployment unit; never publish or serve a real `3/2` index between them.
- Do not perform an intermediate real-library rebuild or public-package handoff at the end of either first subplan. Defer the combined build, package audit, and browser acceptance to Task 14 below.
- In the note-import plan, execute Tasks 1–3 and 5–6, but replace its `createSingleWriter` and standalone server/cutover with Tasks 9–11 below.
- The final package manifest is the lexical union of all three subplans and this plan. A later phase must never overwrite an earlier phase's entries.

## Global constraints

- Desktop only. Do not add mobile or tablet variants.
- `/Users/yangfan/.codex/worktrees/22dd/html` is already the authoritative isolated integration worktree. Do not create another worktree from its older HEAD, because that would omit the current reviewed untracked/dirty baseline. `aa09` and `2c10` remain read-only donors.
- Do not modify, move, rename, overwrite, or bulk reorganize any existing PDF, OCR output, note, image, code, or result file.
- Do not copy any donor file wholesale when the same path already exists in `22dd`; merge only the named interface after first writing a failing `22dd` test.
- Preserve the current scanner's passing symlink, alias, duplicate-root, thesis-parent, catalog, override, preview, and path-privacy boundaries.
- Use stable local `paper_id` as the archive/index/workspace identity. Discovery candidates keep provider-qualified OpenAlex identity plus DOI; never compare candidate `W…` IDs directly with local `paper_id`. Metadata-only archive records keep the same local ID when a PDF or note is added later.
- OpenAlex search is explicit and user-triggered, browser-direct, fixed to `https://api.openalex.org/works`, credential-free, and limited to ten results per request. It does not auto-download PDF, OCR, source, or supplements.
- NUIST/CARSI integration contains public links and provider hints only. Never store or proxy usernames, passwords, cookies, API keys, tokens, or automated login state.
- Metadata archive means “candidate recorded”, not “source checked”, “evidence verified”, or “paper read”.
- Candidate archive is enabled only when private configuration contains an explicit valid `archive_source_id`. Never infer a source, even when only one source is configured.
- The Agent task page is a read-only input and snapshot-history surface. It makes no model calls, executes no agent, exports no research conclusion, and reads no private full text.
- All server writes use one process-wide coordinator with immediate `409`; do not queue writes.
- HTTP errors and logs exposed to the browser must be fixed, sanitized codes/messages. Absolute paths may appear only in the successful `source-path` response and must never enter DOM, localStorage, generated assets, browser console, or general API errors.
- Bind only `127.0.0.1`. The production CLI has no host or port override and uses exactly `4176`; lower-level tests may ask the operating system for port `0`.
- All filesystem tests use temporary roots. No test may read or write the user's real paper archive.
- Do not install new npm or Python dependencies.
- Do not stop the current `4176` process until Task 15 has completed every pre-cutover check and recorded a rollback command.
- Each implementation task follows RED → GREEN → focused regression → commit. This planning turn itself creates no implementation commit.

## Mandatory execution order

The sections below are grouped partly by subsystem so their file maps stay readable, but implementation must follow this dependency order:

```text
Task 1 → Task 2 → Task 3 → Task 8 → Task 9
       → Task 4 → Task 5 → Task 6 → Task 7
       → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 → Task 15
```

This places the Phase A schema, personal curation, shared coordinator, and note-import core/UI before Phase B discovery/archive and Phase C Agent inputs. Do not execute the sections in numeric display order, do not parallelize tasks that modify `build.mjs`, `library.mjs`, `styles.css`, package manifests, or the server, and do not begin Task 10 until Tasks 4–9 are all GREEN.

---

### Task 1: Freeze authority and prove the existing safety baseline

**Files:**

- Inspect only: `exporter/paper-library/scanner.mjs`
- Test only: `exporter/paper-library/scanner.test.mjs`
- Inspect only: the three governing subplans and `git worktree list --porcelain`
- Checkpoint after review: `.gitignore`, `README.md`, `docs/superpowers/`, `exporter/`, `prototype/`

**Interfaces:**

- Records `22dd` as authoritative.
- Records `/Users/yangfan/.codex/worktrees/aa09/html` and `/Users/yangfan/.codex/worktrees/2c10/html` as donor-only.
- Creates no source changes when the baseline passes.

- [ ] **Step 1: Record worktree and dirty-state evidence**

Run:

```bash
git worktree list --porcelain
git status --short
```

Expected: the three named worktrees are distinguishable; all pre-existing dirty files are recorded and preserved.

- [ ] **Step 2: Prove the scanner alias boundary is already GREEN**

Run:

```bash
node --test --test-name-pattern='symlink|directory alias' exporter/paper-library/scanner.test.mjs
```

Expected: all six matching tests pass. If this command is RED in the future, stop and create a separate root-cause scanner task using `superpowers:systematic-debugging`; do not import the `aa09` scanner.

- [ ] **Step 3: Run the authoritative unit baseline**

Run:

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
```

Expected: exit 0. Record actual counts; do not hard-code an old total.

- [ ] **Step 4: Attach the authoritative detached worktree to a named branch**

Confirm `git branch --show-current` is empty and `git show-ref --verify refs/heads/codex/three-workspace-integration` does not already resolve. Then run:

```bash
git switch -c codex/three-workspace-integration
```

Expected: the current 22dd bytes remain unchanged and all future task commits form one named, recoverable branch. If the branch already exists, inspect it and stop instead of choosing a new name silently.

- [ ] **Step 5: Create a reviewed authority checkpoint before feature edits**

Review every staged path and explicitly exclude `local_library_config/`, `local_library_data/`, `local_library_output/`, real papers/notes, screenshots, transfer bundles, `tmp/`, and local audits. Then stage only the named public source/docs trees and run:

```bash
git diff --cached --check
git diff --cached --name-only
git commit -m "chore: checkpoint authoritative workbench baseline"
```

Expected: the checkpoint makes the current `22dd` source baseline recoverable before later task commits; private/generated files remain untracked or ignored. If the staged review cannot prove that boundary, stop rather than creating a new worktree from stale HEAD.

---

### Task 2: Execute the facet-state subplan as the schema foundation

**Files:**

- Follow exactly: `docs/superpowers/plans/2026-08-30-paper-library-facet-states.md`
- Key creates: `exporter/paper-library/paper-tag-migration.mjs`, `exporter/paper-library/paper-tag-migration.test.mjs`, `exporter/scripts/migrate-paper-tags-v3.mjs`
- Key modifies: `facet-schema*`, `tag-catalog*`, `overrides*`, `status*`, `build*`, `library.mjs`, `paper-library-model*`, `paper-inspector.mjs`, `styles.css`, DOM/E2E/docs/package files

**Interfaces:**

- Canonical catalog: version `3` with sparse `facet_states`.
- Generated index/schema: version pair `3/2`.
- Reader accepts `3/2` and legacy `2/1`, normalizing missing states to `{}`.
- Empty academic values render “未记录” unless the catalog explicitly says `not_applicable` or `pending_verification`.

- [ ] **Step 1: Execute Tasks 1–6 of the facet-state plan with every RED/GREEN checkpoint**

Do not skip the migration, conflict, public-wire, legacy-reader, or conservative-rendering tests.

- [ ] **Step 2: Preserve the atomic deployment boundary**

After facet-state Task 4, do not rebuild the real library, serve the generated output, or hand off the branch. Complete Task 5 and its compatibility tests first.

- [ ] **Step 3: Execute exact non-runtime portions of Task 7**

Execute facet-state Task 7 Steps 1–6 and 9. Skip Steps 7–8 (real configured build, generated-index inspection, and live browser acceptance); Task 14 of this plan performs the combined versions.

- [ ] **Step 4: Run the focused post-phase suite**

Run:

```bash
node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/paper-tag-migration.test.mjs exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs
```

Expected: exit 0 with both index-version pairs covered.

- [ ] **Step 5: Commit using the subplan's task-level commits**

Expected: ignored `local_library_config/paper-tags.json` is never staged or included in the public package.

---

### Task 3: Execute the personal-tag subplan without contaminating academic facets

**Files:**

- Follow exactly: `docs/superpowers/plans/2026-08-30-paper-library-personal-tags.md`
- Create: `prototype/desktop/paper-user-tags.mjs`
- Create: `prototype/desktop/paper-user-tags.test.mjs`
- Modify incrementally: `paper-library-model*`, `paper-inspector.mjs`, `library.mjs`, `library.template.html`, `styles.css`, build/package/E2E/docs files

**Interfaces:**

- Storage key: `research-console.paper-user-tags.v1`.
- Stored shape: `{ version: 1, papers: Record<paper_id, string[]> }`.
- Search consumes personal tags separately; personal tags never become facet paths, source terms, or generated paper metadata.
- JSON import is strict, atomic, merge-only, and skips valid unknown paper IDs with an exact report.

- [ ] **Step 1: Execute Tasks 1–5 of the personal-tag plan**

Keep the post-facet `renderInspector` signature and `facet_states` arguments intact while adding `userTags` and `userTagNotice`.

- [ ] **Step 2: Execute exact non-runtime portions of Task 6**

Execute personal-tag Task 6 Steps 1–4 and 7–8. Skip Steps 5–6 (real configured build, Playwright, and screenshots); Task 14 performs the combined versions.

- [ ] **Step 3: Run focused store, search, DOM, build, and package tests**

Run:

```bash
node --test prototype/desktop/paper-user-tags.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs
```

Expected: exit 0; academic facet options are unchanged and no personal tag appears in the public paper index.

- [ ] **Step 4: Commit using the subplan's task-level commits**

Expected: only code/tests/docs are committed; browser data remains local.

---

### Task 4: Port the three isolated literature-discovery primitives from `aa09`

**Files:**

- Create: `prototype/desktop/openalex-search.mjs`
- Create: `prototype/desktop/openalex-search.test.mjs`
- Create: `prototype/desktop/candidate-storage.mjs`
- Create: `prototype/desktop/candidate-storage.test.mjs`
- Create: `prototype/desktop/institution-access.mjs`
- Create: `prototype/desktop/institution-access.test.mjs`
- Create: `exporter/paper-library/institution-config.mjs`
- Create: `exporter/paper-library/institution-config.test.mjs`
- Create: `exporter/config/institutions/nuist.json`
- Read donor only: the same paths under `/Users/yangfan/.codex/worktrees/aa09/html`

**Interfaces:**

```js
buildOpenAlexSearchUrl({ query, currentYear = 2026, perPage = 10, sort = "relevance" })
searchOpenAlexWorks({ query, fetchImpl, signal, currentYear, perPage, sort })
createCandidateStore(storage)
validateInstitutionConfig(raw)
loadInstitutionConfig(configPath)
normalizeDoi(rawValue)
normalizeExternalHttpsUrl(rawValue)
parsePaperInput(rawValue)
detectProvider({ explicitProviderId, input, institution })
resolveInstitutionAccess({ rawInput, explicitProviderId, institution })
```

Candidate storage stays at `research-console.discovery-candidates.v1` and exposes `read`, `getLoadStatus`, `reload`, `add`, `confirm`, `markMetadataArchived`, `moveToPending`, and `remove`.

- [ ] **Step 1: Port the donor tests first and prove RED**

Use `apply_patch` to create the four test files after reviewing them. Run:

```bash
node --test prototype/desktop/openalex-search.test.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/institution-access.test.mjs exporter/paper-library/institution-config.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for the four production modules.

- [ ] **Step 2: Port the minimal production modules and public institution config**

Keep the fixed OpenAlex endpoint, `GET`, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, ten-result cap, five-year filter, English works only, retracted works excluded, strict HTTPS normalization, 100-candidate limit, ID/DOI dedupe, stale-tab reload, and defensive clones. Support exactly three user-visible sort modes—relevance, newest year, and cited count—with the active basis shown beside results. The final English query expression is placed in an editable field before the user runs the request; no hidden query broadening occurs. Reject every credential-like key recursively in the institution config.

- [ ] **Step 3: Prove GREEN and privacy**

Run the Step 1 command again. Expected: exit 0, and tests separately cover network failure, HTTP 429, malformed response, and zero results. Zero results must say only that the current expression returned no results, never that the research direction does not exist. Serialized config/results contain no password, cookie, token, API key, local path, or auto-login instruction.

- [ ] **Step 4: Commit the isolated primitives**

```bash
git add prototype/desktop/openalex-search.mjs prototype/desktop/openalex-search.test.mjs prototype/desktop/candidate-storage.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/institution-access.mjs prototype/desktop/institution-access.test.mjs exporter/paper-library/institution-config.mjs exporter/paper-library/institution-config.test.mjs exporter/config/institutions/nuist.json
git commit -m "feat: add bounded literature discovery primitives"
```

---

### Task 5: Add one controlled metadata-only archive contract

**Files:**

- Create: `exporter/paper-library/archive-metadata.mjs`
- Create: `exporter/paper-library/archive-metadata.test.mjs`
- Create: `exporter/paper-library/candidate-archive.mjs`
- Create: `exporter/paper-library/candidate-archive.test.mjs`
- Modify: `exporter/paper-library/scanner.mjs`
- Modify: `exporter/paper-library/scanner.test.mjs`
- Modify: `exporter/paper-library/config.mjs`
- Modify: `exporter/paper-library/config.test.mjs`
- Modify: `exporter/config/library.example.json`
- Modify: `exporter/paper-library/build.test.mjs`
- Read donor only: `aa09/exporter/paper-library/candidate-archive.mjs` and its test

**Interfaces:**

```js
export const ARCHIVE_METADATA_FILE = "metadata.yaml"
export const ARCHIVE_METADATA_MAX_BYTES = 8_000
serializeArchiveMetadata({ paperId, archiveSourceId, candidate, archivedAt })
parseArchiveMetadata(text)
validateArchiveRequest(raw)
archiveCandidateMetadata({
  sourceRoot,
  sourceId,
  existingPapers,
  existingArchiveIdentities = [],
  request,
  now,
  fileSystem,
})
```

The archive request is exact `{ version: 1, confirmation: "create_metadata_only", archive_source_id, paper_id, candidate }`; `candidate.stage` must be `confirmed_for_archive`. The result is `{ status: "created", paper_id, folder_name }`.

- [ ] **Step 1: Write the archive metadata RED tests**

Cover exact fields, 8,000-byte limit, control/path rejection, deterministic serialization, safe parsing, unknown-key rejection, and round-trip identity. Run:

```bash
node --test exporter/paper-library/archive-metadata.test.mjs
```

Expected: module-not-found RED.

- [ ] **Step 2: Implement the controlled parser/serializer**

Reuse the existing frontmatter parser only for approved bibliographic fields. Consume archive-only keys, including `archive_source_id`, inside this module so the generic frontmatter parser does not emit false warnings. Do not add a YAML dependency.

- [ ] **Step 3: Add the explicit archive-source config contract**

Extend the private library config with optional `archive_source_id`. When present it must match exactly one configured `source_id`; an unknown, duplicate, path-like, or non-string value invalidates the config. When absent, scanning/building/browsing remain available but candidate archive capability is disabled. Do not infer the only source.

- [ ] **Step 4: Write scanner/build RED tests for metadata-only packages**

Prove that a direct, non-symlink `metadata.yaml` is read through the existing no-follow/size boundary, does not become an ordinary artifact, and produces:

```js
{
  source_status: "not_checked",
  evidence_status: "none",
  reproduction_status: "none",
  note_status: "metadata_only",
  facet_states: {},
}
```

Also prove the public index has no independent `openalex_id`, `candidate_source`, local path, or private archive lookup field. A DOI-less record may expose its canonical `https://openalex.org/W…` landing URL through the existing public URL field. Private audit may add `archive_identity_lookup` and blocking `duplicate_archive_source_ids`.

Add a blocking scanner case where `metadata.yaml.archive_source_id` differs from the actual configured `source.source_id`; it must not emit a usable paper record. Add duplicate composite-identity cases across two configured sources.

- [ ] **Step 5: Incrementally extend the authoritative scanner**

Do not replace any `22dd` core file. Preserve catalog/override/frontmatter conflict rules, note eligibility, thesis handling, symlink rejection, and current warnings. Use one canonical composite archive identity such as `openalex:W123…` for private audit, duplicate checks, and candidate archive; never compare an unqualified external ID whose provider is ambiguous. Existing `mergePaperRecord` already yields the conservative formal states and `metadata_only`, so no new status enum or status-module edit belongs to this task.

- [ ] **Step 6: Port candidate archive tests first, then the pure write transaction**

Use temporary roots only. Cover ID/DOI/OpenAlex/destination duplicate rejection, exact confirmation and exact `archive_source_id`, source-root canonicalization, temporary file plus rename, cleanup, and no downloads.

- [ ] **Step 7: Run the focused suite**

```bash
node --test exporter/paper-library/archive-metadata.test.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/config.test.mjs exporter/paper-library/scanner.test.mjs exporter/paper-library/build.test.mjs
```

Expected: exit 0; the six scanner alias tests from Task 1 remain GREEN.

- [ ] **Step 8: Commit the metadata-only archive layer**

```bash
git add exporter/paper-library/archive-metadata.mjs exporter/paper-library/archive-metadata.test.mjs exporter/paper-library/candidate-archive.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/config.mjs exporter/paper-library/config.test.mjs exporter/config/library.example.json exporter/paper-library/scanner.mjs exporter/paper-library/scanner.test.mjs exporter/paper-library/build.test.mjs
git commit -m "feat: support metadata-only paper archives"
```

---

### Task 6: Build the Chinese desktop discovery page without replacing `22dd` UI cores

**Files:**

- Create: `prototype/desktop/discovery.template.html`
- Create: `prototype/desktop/discovery.mjs`
- Create: `prototype/desktop/discovery-dom.test.mjs`
- Modify incrementally: `prototype/desktop/styles.css`
- Modify navigation only: `prototype/desktop/index.html`, `prototype/desktop/directions.html`, `prototype/desktop/p02.html`, `prototype/desktop/library.template.html`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/scripts/build-private-library.mjs`
- Modify: `exporter/paper-library/runtime.mjs`
- Modify: `exporter/paper-library/runtime.test.mjs`

**Interfaces:**

```js
buildKeywordSearchExpression(value)
createKeywordDiscoveryController({ root, prepareAccess, searchWorks, candidateStore })
loadInstitutionProfile(fetchImpl)
createDiscoveryController({ root, loadInstitution, clipboard })
```

Preserve the complete builder contract while adding the institution input:

```js
buildPrivateLibrary({
  repoRoot,
  config,
  overrides,
  catalogs = {},
  tagCatalog = null,
  institution,
  templateRoot,
  scan,
})
```

It emits `local_library_output/desktop/discovery.html`, approved browser modules, and `assets/nuist.institution.json`. Because Task 9 has already replaced the legacy CLI injection surface, do not restore `loadConfig`, `loadOverrides`, `loadTags`, `loadCatalog`, or direct `build` injection here. Extend only `loadPrivateLibraryContext({ loadInstitution = loadInstitutionConfig })` so it returns validated `institution`, and let `rebuildConfiguredLibrary` pass the complete context into the builder.

- [ ] **Step 1: Adapt the donor DOM test to the `22dd` navigation and prove RED**

Run:

```bash
node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/desktop-pages.test.mjs
```

Expected: discovery page/module missing or new navigation assertions fail.

- [ ] **Step 2: Create the page and controller manually from the donor concepts**

Use Chinese labels, the current desktop shell, current glass/navigation style, `textContent`, semantic buttons, and keyboard-reachable tabs. The page may edit the final English query, choose one of the three sorts, search, stage, confirm, move back, and remove candidates. It must label metadata archiving as unverified and never claim a PDF or reading note exists.

Institution access remains an explicit two-step manual flow: first show the detected provider/open-access landing clue, then show the NUIST/CARSI public entry and the paper locator to copy. Every provider/CARSI/DOI/OpenAlex destination is a visible ordinary HTTPS link opened in a new window with `rel="noopener noreferrer"`; there is no embedded login, cookie forwarding, background download, or hidden navigation. DOM tests cover provider conflict warnings, missing institution config, ordinary-link semantics, and the explanatory text.

- [ ] **Step 3: Extend the builder by union, not replacement**

Add `discovery.template.html` and the four approved modules (`candidate-storage`, `discovery`, `institution-access`, `openalex-search`) to the existing bundle alongside library assets, KaTeX, previews, catalog/tag inputs, and `paper-user-tags.mjs`. Load the public NUIST config without deleting existing catalog/tag loaders.

Because Task 9's runtime already exists at this point in the mandatory execution order, extend `loadPrivateLibraryContext` and `rebuildConfiguredLibrary` to load and preserve `institution` through the complete builder signature. Add a regression where a runtime rebuild still emits discovery output and the validated public institution asset.

- [ ] **Step 4: Run DOM and build GREEN tests**

```bash
node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
```

Expected: exit 0; every generated URL is relative/approved and no generated file contains a private path.

- [ ] **Step 5: Commit the discovery surface**

```bash
git add prototype/desktop/discovery.template.html prototype/desktop/discovery.mjs prototype/desktop/discovery-dom.test.mjs prototype/desktop/styles.css prototype/desktop/index.html prototype/desktop/directions.html prototype/desktop/p02.html prototype/desktop/library.template.html exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs exporter/scripts/build-private-library.mjs exporter/paper-library/runtime.mjs exporter/paper-library/runtime.test.mjs
git commit -m "feat: add desktop literature discovery page"
```

---

### Task 7: Port direction snapshots and a read-only Agent task input history from `2c10`

**Files:**

- Create: `prototype/desktop/direction-snapshot.mjs`
- Create: `prototype/desktop/direction-snapshot.test.mjs`
- Modify: `prototype/desktop/directions.mjs`
- Modify: `prototype/desktop/directions.html`
- Create: `prototype/desktop/agent-task-input.mjs`
- Create: `prototype/desktop/agent-task-input.test.mjs`
- Create: `prototype/desktop/agent-tasks.mjs`
- Create: `prototype/desktop/agent-tasks.test.mjs`
- Create: `prototype/desktop/agent-tasks.html`
- Create: `prototype/desktop/agent-tasks.css`
- Modify navigation only: `prototype/desktop/index.html`, `prototype/desktop/p02.html`, `prototype/desktop/library.template.html`, `prototype/desktop/discovery.template.html`
- Modify: `prototype/desktop/desktop-pages.test.mjs`
- Modify: `exporter/paper-library/build.mjs`, `exporter/paper-library/build.test.mjs`

**Interfaces:**

```js
export const DIRECTION_STORAGE_KEY = "research-console.direction-snapshot.v1"
createDirectionSnapshot(selection, { savedAt })
createDirectionSnapshotStore(storage)
export const TASK_INPUT_STORAGE_KEY = "research-console.agent-task-input.v1"
buildTaskInputPreview({ directionSnapshot, workspaceState, paperIndex })
createTaskInputSnapshot(preview, { createdAt, snapshotNonce })
createTaskInputSnapshotStore(storage) // append, readCurrent, readAll, selectCurrent
```

Agent snapshot storage includes the root document plus `.current`, `.snapshot.*`, and transaction-only `.pending.*` keys.

- [ ] **Step 1: Port direction tests first and prove RED**

Run `node --test prototype/desktop/direction-snapshot.test.mjs`. Expected: module-not-found RED.

- [ ] **Step 2: Port the pure direction store and wire explicit saving into Directions**

Only valid P02 axes are stored. Show saved time and selected axes; do not change the existing direction-selection meaning or auto-save incomplete choices.

- [ ] **Step 3: Adapt agent-input tests to canonical `22dd` data**

Accept only wire index versions `3` and `2` through the canonical `./library.mjs` loader; version `1` remains rejected. The associated schema compatibility stays `3/2` and legacy `2/1`. Remove the donor import from `../paper-library-v2/library.mjs`. Construct banned-path/API-key fixture strings from fragments so the public package audit does not mistake fixtures for real secrets while still exercising rejection.

- [ ] **Step 4: Replace the donor demo executor with snapshot history**

Remove `run_demo`, generated candidate conclusions, revision controls, and export. The page may:

- preview current direction plus selected shelf roles;
- create a fixed input snapshot after explicit confirmation;
- list stored snapshots newest first;
- select an older snapshot and show source-change warnings;
- state clearly that no executor/model is connected.

Each snapshot contains only the validated direction, P02 role assignments, minimal bibliography/status fields, and `note_fragment_refs: []`. It excludes note bodies, source paths, personal tags, discovery candidates, access history, and credentials.

`selectCurrent(snapshotId)` validates the complete store transaction, rejects unknown IDs, returns `false` on storage failure without changing the in-memory current pointer, and re-reads cross-tab state before mutation. Tests cover corrupt root/current/snapshot entries, same-millisecond nonce uniqueness, append-only history, newest-first rendering, selection, and source-change warnings without overwriting old snapshots.

- [ ] **Step 5: Prove the read-only boundary**

Run:

```bash
node --test prototype/desktop/direction-snapshot.test.mjs prototype/desktop/agent-task-input.test.mjs prototype/desktop/agent-tasks.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
```

Expected: exit 0; tests prove no fetch to model/agent routes, no note bodies in snapshots, no absolute path, and no auto-generated research conclusion.

- [ ] **Step 6: Commit the snapshot surfaces**

```bash
git add prototype/desktop/direction-snapshot.mjs prototype/desktop/direction-snapshot.test.mjs prototype/desktop/directions.mjs prototype/desktop/directions.html prototype/desktop/agent-task-input.mjs prototype/desktop/agent-task-input.test.mjs prototype/desktop/agent-tasks.mjs prototype/desktop/agent-tasks.test.mjs prototype/desktop/agent-tasks.html prototype/desktop/agent-tasks.css prototype/desktop/index.html prototype/desktop/p02.html prototype/desktop/library.template.html prototype/desktop/discovery.template.html prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs
git commit -m "feat: add fixed research input snapshots"
```

---

### Task 8: Introduce the single process-wide write coordinator

**Files:**

- Create: `exporter/paper-library/write-coordinator.mjs`
- Create: `exporter/paper-library/write-coordinator.test.mjs`

**Interfaces:**

```js
createWriteCoordinator({ logger }) => ({
  run(operation),
  runRecovery(operation),
  markRecovery(details),
  clearRecovery(expectedKind),
  getState(),
})
```

Recovery is exactly one of:

```js
null
{ kind: "candidate_archive", reason_code: "ARCHIVE_REBUILD_FAILED", archive_source_id, paper_id, openalex_id }
{ kind: "manual_note", reason_code: "ROLLBACK_FAILED" | "BUILD_OUTPUT_INVALID" }
```

`run` and `runRecovery` receive an async function. A busy call returns an already-rejected Promise with code `LIBRARY_WRITE_BUSY`; it does not synchronously throw and it never queues. `run` also rejects with `RECOVERY_REQUIRED` while recovery is active. `runRecovery` accepts only `candidate_archive`; `clearRecovery("candidate_archive")` succeeds only inside the validated successful recovery callback. A note rollback whose safety is uncertain remains a manual block and cannot be cleared by the archive rebuild route. `getState()` returns a clone `{ busy, recovery }`; logger messages and manual recovery contain no path.

- [ ] **Step 1: Write concurrency and recovery RED tests**

Cover already-rejected busy Promise, no queue, lock release after success/failure, both exact recovery variants, wrong-kind recovery/clear rejection, blocked normal writes, allowed candidate recovery, manual-note non-recoverability, cloned state, and sanitized logger input.

Run `node --test exporter/paper-library/write-coordinator.test.mjs`. Expected: module-not-found RED.

- [ ] **Step 2: Implement the minimal coordinator**

Do not place note-import tokens or candidate-store state inside the coordinator. It owns only process write exclusion and recovery status.

- [ ] **Step 3: Prove GREEN**

Run the Step 1 command again. Expected: exit 0, including a test where a second operation rejects before the first deferred operation resolves.

- [ ] **Step 4: Commit the coordinator**

```bash
git add exporter/paper-library/write-coordinator.mjs exporter/paper-library/write-coordinator.test.mjs
git commit -m "feat: coordinate local library writes"
```

---

### Task 9: Execute the note-import core and dialog subplan against the shared coordinator

**Files:**

- Follow: `docs/superpowers/plans/2026-08-30-paper-library-note-import.md` Tasks 1–3 and 5–6
- Create: `exporter/paper-library/runtime.mjs`, `runtime.test.mjs`, `note-import.mjs`, `note-import.test.mjs`, `note-import-transaction.test.mjs`
- Modify: `exporter/scripts/build-private-library.mjs`, `build.mjs`, `build.test.mjs`
- Modify: `library.template.html`, `styles.css`, `library.mjs`, `paper-inspector.mjs`, `paper-library-dom.test.mjs`

**Interfaces:**

- Preserve all seven note categories and exact marker/tab mappings from the subplan.
- Preserve ten-minute single-use inspection records, 1 MiB Markdown limit, safe image inspection, `O_EXCL|O_NOFOLLOW`, content fingerprint, rollback rules, cache invalidation, and index-refresh recovery.
- The post-integration inspector signature remains:

```js
renderInspector({
  document,
  paper,
  workspaceState,
  facetSchema,
  userTags = [],
  userTagNotice = "",
  sourcePathAvailable = false,
})
```

- [ ] **Step 1: Execute note-import subplan Tasks 1 and 2 exactly**

Run every runtime, category, filename, image-reference, and size-boundary RED/GREEN checkpoint.

- [ ] **Step 2: Execute Task 3 with one substitution**

Implement `createInspectionStore` and a completely lock-agnostic `importInspectedNote`, but do not export or use `createSingleWriter`. Replace the subplan's writer tests with Task 8 coordinator tests and server integration expectations. The server contract is exactly:

```js
coordinator.run(async () => {
  const snapshot = inspectionStore.take(inspectionId) // first statement after lock acquisition
  return importInspectedNote({ snapshot, ...dependencies })
})
```

A busy rejection therefore leaves the inspection ID reusable; after lock acquisition the token is consumed even if validation, filesystem, or build later fails. Replace all old `IMPORT_BUSY` expectations in transaction, DOM, and client tests with `LIBRARY_WRITE_BUSY`. A note rollback failure marks the exact Task 8 `manual_note` recovery before the coordinator releases the lock.

- [ ] **Step 3: Execute UI Tasks 5 and 6 with the integrated inspector signature**

Update the capability validator for the final Task 10 schema rather than the note subplan's smaller interim schema. Keep static read-only browsing functional if the API is absent.

- [ ] **Step 4: Run focused note and DOM tests**

```bash
node --test exporter/paper-library/runtime.test.mjs exporter/paper-library/note-import.test.mjs exporter/paper-library/note-import-transaction.test.mjs prototype/desktop/paper-library-dom.test.mjs
```

Expected: exit 0; no test touches the real paper archive.

- [ ] **Step 5: Commit using the subplan's core/UI task commits, excluding server/cutover files**

Expected: `local-server.mjs` and `serve-private-library.mjs` are not created until Task 10.

---

### Task 10: Build the single loopback server, exact route table, and recovery mode

**Files:**

- Create: `exporter/paper-library/local-server.mjs`
- Create: `exporter/paper-library/local-server.test.mjs`
- Create: `exporter/paper-library/candidate-archive-action.mjs`
- Create: `exporter/paper-library/candidate-archive-action.test.mjs`
- Create: `exporter/scripts/serve-private-library.mjs`
- Modify: `exporter/paper-library/runtime.mjs`, `runtime.test.mjs`
- Modify: `exporter/paper-library/note-import.mjs`, `note-import-transaction.test.mjs`
- Modify: `exporter/paper-library/candidate-archive.mjs`, `candidate-archive.test.mjs`

**Interfaces:**

```js
createPrivateLibraryRequestHandler({
  repoRoot,
  getOrigin,
  loadContext,
  rebuild,
  inspectionStore,
  coordinator,
  inspect,
  importNote,
  archiveAction,
  recoveryAction,
  logger,
})
startPrivateLibraryServer({ repoRoot, port = 4176, ...dependencies })
parseServeArguments([]) // => { port: 4176 }
```

Exact API routes:

```text
GET  /api/v1/capabilities
POST /api/v1/papers/source-path
POST /api/v1/notes/inspect
POST /api/v1/notes/import
POST /api/v1/archive/candidates
POST /api/v1/archive/rebuild
```

Retain the note subplan's exact inspect/import body limits; add `ARCHIVE_REQUEST_MAX_BYTES = 65_536` and `ARCHIVE_REBUILD_REQUEST_MAX_BYTES = 8_192`. Source-path uses the existing small JSON limit. No handler reads beyond its endpoint limit.

Capabilities returns exact versioned fields:

```js
{
  api_version: 1,
  note_import: true,
  source_path: true,
  candidate_archive: true,
  archive_rebuild: true,
  discovery: true,
  agent_task_center: true,
  archive_source_id: "main_papers",
  categories: [{ value, label, target_tab }],
  recovery: {
    required: false,
    kind: null,
    reason_code: null,
    archive_source_id: null,
    paper_id: null,
    openalex_id: null,
  },
}
```

When `archive_source_id` is absent, `candidate_archive` is false and the field is `null`; scanning and browsing still work. During a running-process candidate recovery, normal write capabilities are false, `archive_rebuild` remains true, and `recovery` returns the exact safe archive identity needed after a page refresh. During a manual note-recovery block, the three archive identity fields are null and all write capabilities are false.

**Static allowlist at this task:** `/` redirects exactly to generated `library.html`; generated `library.html`, `discovery.html`, paper index, generated note/source previews, exact approved desktop pages/modules/CSS/KaTeX/fonts/public institution JSON, and the new Agent task/direction assets are allowed. Task 12 later adds the generated migration page plus its complete fixed eight-file runtime dependency closure—never a single guessed asset and never a directory wildcard. Everything else—including `local_library_config`, `local_library_data/paper-library-audit.json`, source roots, tests, templates, Git metadata, and arbitrary repository files—returns 404.

The server owns an explicit `APPROVED_PROTOTYPE_FILES` list, independent of the GitHub package manifest. It includes only `index.html`, `directions.html`, `p02.html`, `agent-tasks.html`, `app.mjs`, `directions.mjs`, `direction-snapshot.mjs`, `papers-data.mjs`, `paper-filter.mjs`, `agent-tasks.mjs`, `agent-task-input.mjs`, `agent-tasks.css`, `styles.css`, `library.mjs`, `paper-library-model.mjs`, `paper-library-storage.mjs`, `paper-inspector.mjs`, `paper-math-renderer.mjs`, `paper-user-tags.mjs`, and the exact approved KaTeX CSS/module/font files. Tests, templates, transfer source page, README, and every unlisted file stay denied. Generated notes/sources remain governed by existing slug/hash/extension/realpath rules, never a directory wildcard.

- [ ] **Step 1: Write server security and exact-route RED tests**

Cover bind host, test-only port `0`, exact root redirect, Host/Origin/Sec-Fetch-Site/JSON/body rules, no CORS, unknown API 404, traversal rejection, all denied static paths, source-path `no-store`, and sanitized failures.

Add a startup-build-failure test that spies on server creation/listen and proves neither occurs, even when an older output tree exists; the older data/output bytes remain untouched.

- [ ] **Step 2: Write shared-writer integration RED tests**

Prove:

- note import, candidate archive, and rebuild share one coordinator;
- a second operation receives immediate 409;
- busy note import does not consume inspection ID;
- a busy archive request does not invoke the archive callback or filesystem dependency;
- a locked note import consumes the inspection ID before filesystem/build work;
- candidate build failure keeps the metadata package, keeps the candidate confirmed, and enters recovery;
- note build failure rolls back the newly created note only if its fingerprint still matches;
- normal writes are disabled in recovery and explicit rebuild remains available.

Hash the last-good data/output trees before the induced candidate build failure and prove every file byte remains unchanged. Tampering with the preserved metadata package or changing its composite identity makes recovery fail without clearing the block. A simulated process restart invalidates all in-memory note inspections.

- [ ] **Step 3: Create the candidate archive-and-rebuild action**

Implement:

```js
archiveCandidateAndRebuild({
  repoRoot,
  request,
  loadContext,
  archive,
  rebuild,
  markRecovery,
})
```

It reloads config and scans all sources after acquiring the shared lock, validates stable ID/DOI/OpenAlex identity/destination across the complete scan, calls the pure archive transaction, then rebuilds. It returns `{ status: "created", paper_id, folder_name, rebuild_status: "complete"|"failed", paper_count: number|null }`. A build failure keeps the new package and marks safe candidate recovery before releasing the lock.

If any configured source is unreadable, its scan is incomplete, or the private archive identity audit is ambiguous, the action fails before writing even when the target source itself is writable. Re-submitting an exact matching controlled package that is absent from the current index returns `ARCHIVE_REBUILD_REQUIRED`; any metadata or identity mismatch returns `ARCHIVE_CONFLICT`.

- [ ] **Step 4: Implement exact source selection for candidate archive**

Use only the private configured `archive_source_id`, require the request to repeat the same ID, and resolve that source after reloading config. If it is absent, stale, unknown, duplicated, unreadable, or mismatched, fail without creating a directory. Never infer the first or only source.

- [ ] **Step 5: Implement startup and last-good recovery**

Startup order is load context → attempt full build → validate output → create/listen. Any startup build failure leaves the on-disk last-good untouched but does not listen; it is an operator-visible startup failure, not an automatic recovery server. Last-good recovery mode begins only after a write in an already-running service creates a controlled source transaction whose rebuild fails. A successful archive rebuild refreshes context and clears candidate recovery.

- [ ] **Step 6: Implement the exact static allowlist and six API handlers**

No handler accepts a filesystem path from the browser. Candidate archive accepts the exact Task 5 request and requires `X-Research-Console-Action: archive-candidate`. Archive recovery accepts only `{ "confirmation": "retry_archive_rebuild", "archive_source_id", "paper_id", "openalex_id" }` and requires `X-Research-Console-Action: rebuild-library`; it re-scans and verifies the same controlled package without rewriting metadata. All POST responses use `Cache-Control: no-store`. Old `/api/archive-candidate`, `/api/tasks`, `/api/health`, `/api/v1/candidates/archive`, and `/api/v1/library/rebuild` are explicit 404 cases.

Response mapping is exact:

- archive + rebuild complete: HTTP 201, `{ status: "created", paper_id, folder_name, rebuild_status: "complete", paper_count }`;
- package created but rebuild failed: HTTP 201, `{ status: "created", paper_id, folder_name, rebuild_status: "failed", index_state: "last_good", recovery_required: true }`;
- validated archive recovery complete: HTTP 200, `{ status: "recovered", paper_id, rebuild_status: "complete", paper_count }`;
- shared busy: HTTP 409 with `error.code: "LIBRARY_WRITE_BUSY"`;
- archive conflict/rebuild-required: HTTP 409 with the corresponding fixed code;
- recovery rebuild fails: HTTP 500 and candidate recovery remains active;
- manual note recovery: HTTP 503 and no automatic clear action.

Every error is exactly `{ error: { code, message, file_name? } }`; `file_name` is a basename only.

- [ ] **Step 7: Implement the fixed production CLI**

`serve-private-library.mjs` binds `127.0.0.1:4176`, has no production host/port argument, uses an import-safe direct-execution guard, prints only the safe local URL on success, and prints one fixed Chinese failure line on error.

- [ ] **Step 8: Run server and transaction GREEN tests**

```bash
node --test exporter/paper-library/write-coordinator.test.mjs exporter/paper-library/runtime.test.mjs exporter/paper-library/note-import-transaction.test.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/candidate-archive-action.test.mjs exporter/paper-library/local-server.test.mjs
```

Expected: exit 0, including a complete temporary-repository archive/rebuild/index flow and note inspect/import/rebuild/preview flow.

- [ ] **Step 9: Commit the unified server**

```bash
git add exporter/paper-library/local-server.mjs exporter/paper-library/local-server.test.mjs exporter/paper-library/candidate-archive-action.mjs exporter/paper-library/candidate-archive-action.test.mjs exporter/scripts/serve-private-library.mjs exporter/paper-library/runtime.mjs exporter/paper-library/runtime.test.mjs exporter/paper-library/note-import.mjs exporter/paper-library/note-import-transaction.test.mjs exporter/paper-library/candidate-archive.mjs exporter/paper-library/candidate-archive.test.mjs
git commit -m "feat: serve one bounded local research workbench"
```

---

### Task 11: Connect candidate archive and recovery UI to the unified service

**Files:**

- Modify: `prototype/desktop/discovery.mjs`
- Modify: `prototype/desktop/discovery-dom.test.mjs`
- Modify: `prototype/desktop/library.mjs`
- Modify: `prototype/desktop/paper-library-dom.test.mjs`
- Modify: `prototype/desktop/library.template.html`
- Modify: `prototype/desktop/styles.css`

**Interfaces:**

```js
archiveConfirmedCandidate({ fetchImpl, archiveSourceId, paperId, candidate })
requestArchiveRebuild({ fetchImpl, archiveSourceId, paperId, openAlexId })
reconcileArchivedCandidates({ candidateStore, paperIndex })
markCandidateArchivedAfterIndexRefresh({ candidateStore, paperIndex, localPaperId, openAlexId })
```

The library client validates the expanded exact capabilities document from Task 10. Neither client caches raw error bodies or paths.

- [ ] **Step 1: Write client-validator and state-transition RED tests**

Cover valid archive, 409 busy without changing the confirmed candidate in localStorage, recovery-required, page reload followed by recovery using the safe identity from capabilities, successful rebuild, malformed responses, and refusal to mark `metadata_archived` before the rebuilt index contains the returned local ID. Add separate reconciliation fixtures for a unique normalized DOI match and a DOI-less unique canonical `https://openalex.org/W…` match. Also cover missing, duplicate, and conflicting matches, and prove a candidate OpenAlex `W…` ID is never compared directly with local `paper_id`.

- [ ] **Step 2: Add explicit archive actions**

Only a confirmed candidate can call the API, and the UI repeats the capability-provided `archive_source_id` in the confirmation without ever receiving its path. Display “仅归档书目信息，不含 PDF/OCR/证据核验”. On `rebuild_status: "complete"`, reload the index and only then mark archived. The immediate/recovery response's local `paper_id` must locate exactly one public index record whose external identity matches the stored candidate: normalized DOI first, otherwise canonical OpenAlex URL from the existing public `doi_or_url` field. Then call `candidateStore.markMetadataArchived(openAlexId)`. `reconcileArchivedCandidates` uses the same DOI/URL rule after reload and never guesses by title, author, year, or local-ID equality. On `rebuild_status: "failed"`, retain the confirmed candidate and show the controlled archive-recovery action.

- [ ] **Step 3: Add a quiet recovery banner to library and discovery**

The banner shows the fixed reason, disables note/archive actions, and offers the explicit rebuild button. Browsing the last-good library remains available.

- [ ] **Step 4: Run DOM GREEN tests**

```bash
node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/paper-library-dom.test.mjs
```

Expected: exit 0; no DOM/localStorage/console contains a server path or raw response.

- [ ] **Step 5: Commit the archive/recovery UI**

```bash
git add prototype/desktop/discovery.mjs prototype/desktop/discovery-dom.test.mjs prototype/desktop/library.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/library.template.html prototype/desktop/styles.css
git commit -m "feat: archive confirmed literature candidates"
```

---

### Task 12: Add a strict one-time browser-state transfer for old ports

**Files:**

- Create: `prototype/desktop/state-transfer.mjs`
- Create: `prototype/desktop/state-transfer.test.mjs`
- Create: `prototype/desktop/state-transfer.html`
- Create: `prototype/desktop/state-transfer-dom.test.mjs`
- Create: `exporter/scripts/serve-state-transfer.mjs`
- Create: `exporter/scripts/serve-state-transfer.test.mjs`
- Modify: `prototype/desktop/styles.css`
- Modify: `prototype/desktop/direction-snapshot.mjs`
- Modify: `prototype/desktop/direction-snapshot.test.mjs`
- Modify: `prototype/desktop/paper-library-storage.mjs`
- Modify: `prototype/desktop/paper-library-storage.test.mjs`
- Modify: `prototype/desktop/paper-user-tags.mjs`
- Modify: `prototype/desktop/paper-user-tags.test.mjs`
- Modify: `prototype/desktop/candidate-storage.mjs`
- Modify: `prototype/desktop/candidate-storage.test.mjs`
- Modify: `prototype/desktop/agent-task-input.mjs`
- Modify: `prototype/desktop/agent-task-input.test.mjs`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/local-server.mjs`
- Modify: `exporter/paper-library/local-server.test.mjs`

**Interfaces:**

```js
exportStateBundle({ storage, originLabel, exportedAt })
validateStateBundle(raw)
previewStateMerge({ current, bundles, knownPaperIds })
applyStateMerge({ storage, plan, decisions })
```

Only these namespaces are eligible:

```text
research-console.direction-snapshot.v1
research-console.paper-library.v1
research-console.paper-user-tags.v1
research-console.discovery-candidates.v1
research-console.agent-task-input.v1
research-console.agent-task-input.v1.current
research-console.agent-task-input.v1.snapshot.*
```

- [ ] **Step 1: Write pure whitelist/validation/merge RED tests**

Prove arbitrary localStorage and all `.pending.*` keys are excluded; invalid documents cause no writes; personal tags use merge-only semantics; candidates dedupe by OpenAlex ID/DOI and reject identity-equal/body-different records; Agent snapshots union by ID, reject conflicting same-ID bodies, and keep the current 4176 pointer by default. Direction and paper-workspace documents keep the current 4176 value by default and change only after an explicit per-group `replace` decision; the workspace document is replaced as one validated unit rather than guessing reading-state priority.

- [ ] **Step 2: Implement atomic bundle validation and merge**

Use a versioned JSON envelope with exact keys, origin, timestamp, counts, SHA-256, and a conflict report. Recover Agent store transactions through its public reader first, then export committed root/current/snapshot data only. Validate every namespace before any storage write. Apply changes through each store's public API; if any write fails, restore the pre-import whitelist snapshot. Never include paper contents, paths, notes, auth data, or unrelated site state.

The envelope origin is exactly one of `http://127.0.0.1:4176`, `http://127.0.0.1:4177`, or `http://127.0.0.1:4178`. Compute SHA-256 over a canonical JSON body that excludes the hash field, and verify it before conflict preview or writes.

Add strict transfer APIs to the five owner stores rather than writing raw keys from the migration module:

```js
directionStore.replaceValidated(snapshotOrNull)
workspaceStore.replaceValidated(state)
userTagStore.replaceValidated(state)
candidateStore.replaceValidated(state)
taskInputSnapshotStore.replaceAllValidated(state)
```

Every method validates the complete document, clones inputs/outputs, re-reads before mutation where the store already has cross-tab protection, and returns failure without changing either persisted or in-memory state. `applyStateMerge` first captures all five current documents, requires explicit decisions for every conflict, then applies through these APIs; on any failure it restores all captured documents through the same validated APIs and reports failure. Tests must force a failure after at least one successful group write and prove full rollback.

- [ ] **Step 3: Build an operator-only import/export page**

The page exports the current origin's whitelisted bundle as a JSON download and imports one or more selected bundles into the current origin after previewing counts/conflicts and explicit `skip|replace` choices. It is not linked from normal navigation. The normal builder emits it as `local_library_output/desktop/state-transfer.html` plus its approved asset so the final 4176 service can import bundles.

The transfer page's exact runtime dependency closure is:

```text
state-transfer.mjs
direction-snapshot.mjs
agent-task-input.mjs
paper-library-storage.mjs
paper-user-tags.mjs
candidate-storage.mjs
paper-library-model.mjs
styles.css
```

No runtime import may fall outside this list.

- [ ] **Step 4: Build the transitional old-port server**

`serve-state-transfer.mjs` binds loopback and accepts only `--port 4176`, `--port 4177`, or `--port 4178`. It serves the source transfer page at `/state-transfer.html` plus exactly the eight-file runtime dependency closure listed in Step 3 and no API, other repository file, generated library, or source data. Tests request every closure member and require 200, then require 404 for source tests, templates, unrelated modules, directories, and traversal attempts. Port 4176 is allowed only during the controlled cutover after the old preview has stopped and before the final Node service starts. This separate migration CLI does not change the production server's fixed `4176` rule.

Extend the unified server's exact allowlist only for generated `state-transfer.html` and all eight named closure members from Step 3. In `local-server.test.mjs`, request the final generated route for each closure member and require 200; then require 404 for unknown transfer files, source templates, tests, and unrelated modules.

- [ ] **Step 5: Run pure, DOM, and server GREEN tests**

```bash
node --test prototype/desktop/state-transfer.test.mjs prototype/desktop/state-transfer-dom.test.mjs prototype/desktop/direction-snapshot.test.mjs prototype/desktop/paper-library-storage.test.mjs prototype/desktop/paper-user-tags.test.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/agent-task-input.test.mjs exporter/scripts/serve-state-transfer.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/local-server.test.mjs
```

Expected: exit 0; all writes are atomic and only approved keys can change.

- [ ] **Step 6: Commit the migration utility**

```bash
git add prototype/desktop/state-transfer.mjs prototype/desktop/state-transfer.test.mjs prototype/desktop/state-transfer.html prototype/desktop/state-transfer-dom.test.mjs prototype/desktop/direction-snapshot.mjs prototype/desktop/direction-snapshot.test.mjs prototype/desktop/paper-library-storage.mjs prototype/desktop/paper-library-storage.test.mjs prototype/desktop/paper-user-tags.mjs prototype/desktop/paper-user-tags.test.mjs prototype/desktop/candidate-storage.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/agent-task-input.mjs prototype/desktop/agent-task-input.test.mjs exporter/scripts/serve-state-transfer.mjs exporter/scripts/serve-state-transfer.test.mjs prototype/desktop/styles.css exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs exporter/paper-library/local-server.mjs exporter/paper-library/local-server.test.mjs
git commit -m "feat: migrate bounded browser research state"
```

---

### Task 13: Unify generated assets and the public package boundary

**Files:**

- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/config/github-package-files.json`

**Interfaces:**

- Generated template map is exact:

```text
prototype/desktop/library.template.html   -> local_library_output/desktop/library.html
prototype/desktop/discovery.template.html -> local_library_output/desktop/discovery.html
prototype/desktop/state-transfer.html     -> local_library_output/desktop/state-transfer.html
```

- Generated `REQUIRED_DESKTOP_ASSETS` is exactly the existing six (`styles.css`, `library.mjs`, `paper-inspector.mjs`, `paper-math-renderer.mjs`, `paper-library-model.mjs`, `paper-library-storage.mjs`) plus `paper-user-tags.mjs`, `candidate-storage.mjs`, `discovery.mjs`, `institution-access.mjs`, `openalex-search.mjs`, `state-transfer.mjs`, `direction-snapshot.mjs`, and `agent-task-input.mjs`. Thus the state-transfer page's complete eight-file runtime closure is present in generated output. KaTeX remains under the existing dedicated approved-vendor bundle; `nuist.institution.json` is copied separately from the validated public config.
- Direction, home, P02, and Agent task pages remain exact `/prototype/desktop/` routes and use Task 10's fixed prototype-static allowlist; they are not copied into generated assets.
- Replace `GENERATED_LIBRARY_PATH` with an exact source-template/runtime-output map and extend `GENERATED_ASSET_SOURCE` only with the named generated mappings. Tests prove dependency closure independently for library, discovery, and state transfer.
- Parsed `manifest.files`, exported `EXPECTED_PACKAGE_FILES`, and the package-audit test's `EXPECTED_FILES` have identical elements in identical lexical order via `deepEqual`; their source file bytes/containers need not be identical.

- [ ] **Step 1: Write failing union/equality tests**

Require every new reusable source/test/public config and reject every generated output, real local config, real catalog, paper/note file, private audit, screenshot, donor private server, and `paper-library-v2` path.

- [ ] **Step 2: Add the exact new public additions**

Add these exact source/test entries in lexical order (alongside the unchanged existing manifest entries):

```text
exporter/config/institutions/nuist.json
exporter/paper-library/archive-metadata.mjs
exporter/paper-library/archive-metadata.test.mjs
exporter/paper-library/candidate-archive-action.mjs
exporter/paper-library/candidate-archive-action.test.mjs
exporter/paper-library/candidate-archive.mjs
exporter/paper-library/candidate-archive.test.mjs
exporter/paper-library/institution-config.mjs
exporter/paper-library/institution-config.test.mjs
exporter/paper-library/local-server.mjs
exporter/paper-library/local-server.test.mjs
exporter/paper-library/note-import-transaction.test.mjs
exporter/paper-library/note-import.mjs
exporter/paper-library/note-import.test.mjs
exporter/paper-library/paper-tag-migration.mjs
exporter/paper-library/paper-tag-migration.test.mjs
exporter/paper-library/runtime.mjs
exporter/paper-library/runtime.test.mjs
exporter/paper-library/write-coordinator.mjs
exporter/paper-library/write-coordinator.test.mjs
exporter/scripts/migrate-paper-tags-v3.mjs
exporter/scripts/serve-private-library.mjs
exporter/scripts/serve-state-transfer.mjs
exporter/scripts/serve-state-transfer.test.mjs
prototype/desktop/agent-task-input.mjs
prototype/desktop/agent-task-input.test.mjs
prototype/desktop/agent-tasks.css
prototype/desktop/agent-tasks.html
prototype/desktop/agent-tasks.mjs
prototype/desktop/agent-tasks.test.mjs
prototype/desktop/candidate-storage.mjs
prototype/desktop/candidate-storage.test.mjs
prototype/desktop/desktop-pages.test.mjs
prototype/desktop/direction-snapshot.mjs
prototype/desktop/direction-snapshot.test.mjs
prototype/desktop/discovery-dom.test.mjs
prototype/desktop/discovery.mjs
prototype/desktop/discovery.template.html
prototype/desktop/institution-access.mjs
prototype/desktop/institution-access.test.mjs
prototype/desktop/openalex-search.mjs
prototype/desktop/openalex-search.test.mjs
prototype/desktop/paper-user-tags.mjs
prototype/desktop/paper-user-tags.test.mjs
prototype/desktop/state-transfer-dom.test.mjs
prototype/desktop/state-transfer.html
prototype/desktop/state-transfer.mjs
prototype/desktop/state-transfer.test.mjs
```

- [ ] **Step 3: Run package/build GREEN tests**

```bash
node --test exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs
node exporter/scripts/audit-github-package.mjs
```

Expected: exit 0; list equality and lexical sorting pass; no private signature is reported.

- [ ] **Step 4: Commit the runtime build/package union**

```bash
git add exporter/paper-library/build.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.mjs exporter/paper-library/package-audit.test.mjs exporter/config/github-package-files.json
git commit -m "build: package the integrated research workbench"
```

---

### Task 14: Add temporary-root E2E, desktop visual QA, and operator documentation

**Files:**

- Modify: `exporter/verification/private_library_e2e.py`
- Create: `exporter/paper-library/unified-local-server.e2e.test.mjs`
- Create: `exporter/verification/integrated-server-fixture.mjs`
- Create: `exporter/verification/integrated-server-fixture.test.mjs`
- Create: `exporter/verification/institution_access_e2e.py`
- Create: `exporter/verification/workbench_integration_e2e.py`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/config/github-package-files.json`
- Modify: `README.md`
- Modify: `prototype/desktop/README.md`

**Interfaces:**

- Acceptance creates its own temporary source/config/output roots.
- Browser QA runs at `1440×900` and `1280×720`.
- Documentation distinguishes external literature, project evidence, metadata-only candidates, personal labels, formal facets, snapshots, note import, and recovery.

- [ ] **Step 1: Add a single-server temporary-repository E2E**

`unified-local-server.e2e.test.mjs` creates temporary repo/source/config/tag-v3/output roots, starts the lower-level server on port `0`, and covers startup build, startup-build failure with no listener, note inspect/import, process-restart inspection invalidation, candidate archive, cross-operation 409, candidate build failure with package preserved, byte-identical last-good data/output, blocked normal writes, successful archive rebuild recovery, tampered/wrong-identity recovery refusal, index appearance, exact static allowlist/404s, and response path privacy. Cleanup removes only the temporary root.

Run:

```bash
node --test exporter/paper-library/unified-local-server.e2e.test.mjs
```

Expected: exit 0; no real `local_library_config` or paper source is opened.

- [ ] **Step 2: Add an executable fixture launcher for Python QA**

`integrated-server-fixture.mjs` creates a complete temporary repo/source/config/tag-v3/output fixture, calls `startPrivateLibraryServer({ repoRoot: temporaryRoot, port: 0 })`, and prints one JSON readiness line containing only `{ origin }`. It remains alive until SIGTERM/EOF, then closes the server and removes only its own temporary root. Python fetches the public paper index from that origin rather than receiving a temp path. Its test spawns the launcher, validates the readiness line, performs a safe capabilities request, terminates it, and proves cleanup.

`workbench_integration_e2e.py` and `institution_access_e2e.py` start this launcher as a subprocess, read the readiness line, use that origin, and always terminate/wait in `finally`. They do not expect a manually pre-started server and never use production `4176`.

- [ ] **Step 3: Extend the browser E2E fixture without real user data**

Include a normal PDF/note paper, a metadata-only paper, multi-preview math/images, personal tags, each facet empty state, discovery mocks, candidate archive, direction save, Agent input snapshot, note inspect/import, concurrent 409, rebuild failure/recovery, denied static paths, and path-leak guards. Construct every forbidden private-path fixture marker from string fragments so the public package never contains the literal signature it is testing.

- [ ] **Step 4: Add deterministic OpenAlex and API mocks**

No acceptance test depends on live OpenAlex, CARSI, or an external provider. Mock only the exact public response shapes; keep the browser network guard strict for all unapproved traffic.

- [ ] **Step 5: Add desktop visual/interaction assertions**

At both viewports verify navigation, overflow, discovery cards, candidate queue, centered note dialog, recoverable banner, PDF/OCR/source previews, right TOC toggle, KaTeX, personal tag editor, direction save, Agent snapshot history, keyboard focus, Escape, and console errors. Write screenshots only to the existing ignored paths under `output/playwright/workbench-integration/1280x720/` and `output/playwright/workbench-integration/1440x900/`; do not create a new unignored `tmp/` artifact tree.

- [ ] **Step 6: Document the operator flow and boundaries**

Document:

1. build/start/stop/rollback commands;
2. metadata-only archive and later PDF/note enrichment;
3. source selection when multiple roots exist;
4. what “待核验” and “metadata-only” mean;
5. localStorage backup and old-port transfer;
6. recovery rebuild behavior;
7. static read-only fallback;
8. GitHub package inclusions/exclusions.

- [ ] **Step 7: Finalize the package list with the E2E sources**

Add these exact new entries to all three ordered package lists and re-run their deep-equality tests:

```text
exporter/paper-library/unified-local-server.e2e.test.mjs
exporter/verification/institution_access_e2e.py
exporter/verification/integrated-server-fixture.mjs
exporter/verification/integrated-server-fixture.test.mjs
exporter/verification/private_library_e2e.py
exporter/verification/workbench_integration_e2e.py
```

Before adding `exporter/verification/private_library_e2e.py`, replace its literal private-path sentinel with an equivalent fragment-built value (for example `"/" + "Users" + "/"`) and preserve the same negative assertion. Apply the same rule to all new E2E path-leak fixtures. Run the package audit after this refactor so `content_private_signature` cannot be hidden by list timing.

- [ ] **Step 8: Run the complete pre-cutover suite**

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs exporter/scripts/*.test.mjs exporter/verification/*.test.mjs
python3 -m py_compile exporter/verification/private_library_e2e.py exporter/verification/institution_access_e2e.py exporter/verification/workbench_integration_e2e.py
node exporter/scripts/audit-github-package.mjs
```

Before browser QA, verify the repository's currently documented Playwright interpreter without installing dependencies:

```bash
task_python=/opt/anaconda3/bin/python3.13
"$task_python" -c 'import playwright'
```

If that exact interpreter no longer exists, use the workspace dependency locator to identify the configured Python runtime, update `task_python`, and repeat the import probe; do not install a new package. Then run:

```bash
"$task_python" exporter/verification/private_library_e2e.py --temporary-fixture
"$task_python" exporter/verification/institution_access_e2e.py
"$task_python" exporter/verification/workbench_integration_e2e.py
```

Refactor `private_library_e2e.py` so `--temporary-fixture` launches/consumes the same fixture protocol; it must not resolve `local_library_data/paper-index.json` at import time. Expected: all tests pass with actual counts reported; no private path or unexpected network request appears.

- [ ] **Step 9: Commit docs, package reconciliation, and acceptance**

```bash
git add exporter/paper-library/unified-local-server.e2e.test.mjs exporter/verification/integrated-server-fixture.mjs exporter/verification/integrated-server-fixture.test.mjs exporter/verification/private_library_e2e.py exporter/verification/institution_access_e2e.py exporter/verification/workbench_integration_e2e.py exporter/paper-library/package-audit.mjs exporter/paper-library/package-audit.test.mjs exporter/config/github-package-files.json README.md prototype/desktop/README.md
git commit -m "test: accept the integrated academic workbench"
```

---

### Task 15: Perform a controlled browser-state migration and final `4176` cutover

**Files:**

- No source edits expected.
- Runtime outputs remain ignored: `local_library_data/`, `local_library_output/`, local configuration, transfer bundles, logs, and PID files.

**Interfaces:**

- Final URL: `http://127.0.0.1:4176/local_library_output/desktop/library.html`.
- Old servers are stopped only after their PID, command, cwd, and restart command are recorded.
- State transfer is explicit JSON export/import; there is no silent cross-origin copy.

- [ ] **Step 1: Re-run full verification on the exact cutover commit**

Run the complete Task 14 suite plus:

```bash
node exporter/scripts/audit-github-package.mjs
git status --short
```

Expected: all tests pass; dirty files are understood; no private/generated file is staged.

- [ ] **Step 2: Record the current `4176`, `4177`, and `4178` processes**

For each port run:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN
ps -ww -p <validated-pid> -o pid=,ppid=,command=
lsof -a -p <validated-pid> -d cwd -Fn
```

Do not use `ps -o cwd=` on macOS. Write down exact PID, command, cwd, and restart command before sending any signal. Revalidate at cutover even if earlier evidence showed Python PID 59489 on 4176 and no 4177/4178 listeners.

- [ ] **Step 3: Resolve every old origin, export selected state, and free 4177/4178**

Create a private ignored transfer directory first:

```bash
transfer_dir=$(mktemp -d /tmp/research-console-transfer.XXXXXX)
chmod 700 "$transfer_dir"
```

For each of 4177 and 4178, first record exactly one decision: `migrate whitelisted state` or `no state required`. For a migrate decision:

1. if an old listener exists, stop only its revalidated PID;
2. start `node exporter/scripts/serve-state-transfer.mjs --port <4177-or-4178>`;
3. open `http://127.0.0.1:<port>/state-transfer.html` and export the JSON bundle;
4. stop the exact transitional PID;
5. save the bundle under `$transfer_dir`, run `shasum -a 256` on it, and record the digest.

For a no-state decision, stop any revalidated old listener without starting the transitional server. At the end, require `lsof` to show no listener on either 4177 or 4178. Keep a list of every displaced old PID's command/cwd/restart command. Do not start a transitional server while an old server still owns the port. If any export, hash, stop, or ownership check fails, stop the transitional PID, restore every old service already displaced in this step, smoke-check it, leave the current 4176 untouched, and stop the cutover.

- [ ] **Step 4: Build the real configured library before taking over `4176`**

Run:

```bash
node exporter/scripts/build-private-library.mjs
```

Expected: success, valid public index/output, no audit leak, and no source file mutation. If it fails, keep the current `4176` service running, restore and smoke-check every 4177/4178 service displaced in Step 3, and stop the cutover.

- [ ] **Step 5: Export the current 4176 state after stopping only the validated old preview**

Re-run the Step 2 checks, send `TERM` only to the still-matching old PID, and poll `lsof` until 4176 is free. Do not use `kill -9`. In a separate terminal start:

```bash
node exporter/scripts/serve-state-transfer.mjs --port 4176
```

Open `http://127.0.0.1:4176/state-transfer.html`, export the 4176 bundle into `$transfer_dir`, record its SHA-256, then stop this exact transitional PID and confirm the port is free.

- [ ] **Step 6: Start the final Node service in a separate terminal**

From the `22dd` cwd run `node exporter/scripts/serve-private-library.mjs` in a separate terminal/session, record its PID, and leave it running. Confirm with `lsof` that only that Node PID owns `127.0.0.1:4176` and its cwd is `22dd`.

- [ ] **Step 7: Import old-port bundles into the final origin**

Open `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html`, verify every recorded SHA-256, preview all bundles, resolve conflicts explicitly, import, reload the library, and confirm direction, shelf roles, reading state, personal tags, candidates, and Agent snapshot history. Do not automatically delete the bundles after import.

Steps 3–7 are one abort-gated cutover transaction beginning when the first old listener is stopped. If the transitional server fails to start or own the expected port, an export/JSON/SHA-256 check fails, the final Node process fails to start or own 4176 from `22dd`, capabilities do not return the exact valid document, bundle validation/import fails, or 4177/4178 is not free, immediately:

1. send `TERM` only to the exact transitional or Node PID started by this cutover;
2. confirm with `lsof` that 4176 is free;
3. from the recorded old cwd, restart the exact recorded Python command and record its new PID;
4. restore every original 4177/4178 service displaced since Step 3 from its recorded cwd/command;
5. use PID/cwd/`lsof` plus page smoke checks to prove the prior running topology is restored;
6. stop this cutover without continuing to Step 8, preserving transfer bundles, digests, localStorage, and last-good outputs.

Do not leave the machine with no listener while investigating a Step 5–7 failure. Step 9 remains the planned successful-cutover rollback rehearsal and is separate from this mandatory failure branch.

- [ ] **Step 8: Run live smoke/security checks**

Verify library/discovery/directions/Agent pages, PDF/OCR/previews, note dialog, candidate archive controls, source-path copy, no console error, and no absolute path in DOM/storage/logs. Do not perform a real write merely to prove a button unless a disposable test paper is explicitly prepared. Also run safe HTTP checks:

```bash
curl --fail --silent http://127.0.0.1:4176/api/v1/capabilities
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:4176/local_library_data/paper-library-audit.json
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:4176/local_library_config/library.local.json
```

Expected: capabilities 200 and both protected resources 404.

- [ ] **Step 9: Exercise the complete rollback and return to Node**

Send TERM to the recorded Node PID and confirm 4176 is free. From the recorded old cwd, start the exact recorded Python command in a separate terminal and record its new PID.

- If Python startup, ownership, cwd, or smoke fails, stop that exact Python PID if it exists, confirm 4176 is free, immediately restart Node from `22dd`, and use PID/cwd/`lsof`, capabilities, and protected-404 checks to prove Node is again serving. Leave Node running and report the rehearsal failure; do not call the cutover complete.
- If Python passes, send TERM only to that recorded Python PID and confirm the port is free. Restart Node from `22dd` in a separate terminal and re-run ownership, capabilities, and protected-404 checks. If this Node restart fails, stop any partial Node PID, confirm the port is free, restart the already-proven Python command again, verify it, leave Python running, and report the failed cutover.

The rehearsal may finish only with a verified Node or verified Python listener on 4176; it must never stop at “no listener”. A successful final state is the verified Node service, with 4177 and 4178 still free.

- [ ] **Step 10: Final verification and handoff**

Run `git status --short`; use `lsof` plus cwd inspection to prove 4176 has only the final Node PID in `22dd`, and use `lsof` to prove 4177 and 4178 have no listener; record operator start/stop/rollback commands; and report actual test/E2E counts, bundle SHA-256 values, state-transfer conflict counts, recovery state, and final URL. No commit is required for runtime-only cutover evidence.

## Completion gate

The integration is complete only when all of the following are true:

- `22dd` contains every approved feature and no core file was wholesale replaced from a donor.
- Facet catalog/index/reader compatibility and personal tags pass independently and together.
- Metadata-only candidates stay explicitly unverified and can later gain PDF/notes under the same stable ID.
- Direction and Agent input snapshots contain only approved structured input and no private full text/path.
- One write coordinator protects note import, candidate archive, and rebuild with immediate 409 semantics.
- The final server owns only `127.0.0.1:4176`, serves only the allowlist, and has tested first-start and last-good recovery behavior.
- Old-port state was exported/imported through the strict whitelist or explicitly declared unnecessary.
- Complete Node, package-audit, Python compile, Playwright, 1280, and 1440 checks pass with current counts.
- The current `4176` service has a recorded and tested rollback procedure.
