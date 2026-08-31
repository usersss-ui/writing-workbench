# Task 2 Implementation Report

## Status

- Status: complete for the master-plan Task 2 scope.
- Governing facet-state subplan Tasks 1–6 were implemented.
- Facet-state Task 7 Steps 1–6 and 9 were implemented.
- Facet-state Task 7 Steps 7–8 were intentionally skipped per the master-plan supersession.
- Existing `4176` service was not stopped, replaced, or used for acceptance.
- No donor worktree or real paper/note source file was modified.

## Base and implementation head

- Base: `8ce9950ae890bdc8d465e2404ee6ad8d2534cbb9`
- Public implementation head before this report-only commit: `af472e7a1ee8aeb68626b820b47438716cfcce1e`
- Branch: `codex/three-workspace-integration`

## Commits

1. `0621500 feat: define paper facet empty states`
2. `2038475 feat: add deterministic paper tag migration`
3. `9cd7fee feat: accept facet states in paper tag catalog`
4. `7c6ca87 feat: publish paper facet states in index v3`
5. `d387865 feat: read facet states with index v2 compatibility`
6. `0179298 feat: render conservative paper facet states`
7. `af472e7 test: accept paper facet state migration`

## Files changed

- `README.md`
- `exporter/config/github-package-files.json`
- `exporter/paper-library/build.mjs`
- `exporter/paper-library/build.test.mjs`
- `exporter/paper-library/facet-schema.mjs`
- `exporter/paper-library/facet-schema.test.mjs`
- `exporter/paper-library/overrides.mjs`
- `exporter/paper-library/overrides.test.mjs`
- `exporter/paper-library/package-audit.mjs`
- `exporter/paper-library/package-audit.test.mjs`
- `exporter/paper-library/paper-tag-migration.mjs`
- `exporter/paper-library/paper-tag-migration.test.mjs`
- `exporter/paper-library/status.mjs`
- `exporter/paper-library/status.test.mjs`
- `exporter/paper-library/tag-catalog.mjs`
- `exporter/paper-library/tag-catalog.test.mjs`
- `exporter/scripts/migrate-paper-tags-v3.mjs`
- `exporter/verification/private_library_e2e.py`
- `prototype/desktop/README.md`
- `prototype/desktop/library.mjs`
- `prototype/desktop/paper-inspector.mjs`
- `prototype/desktop/paper-library-dom.test.mjs`
- `prototype/desktop/paper-library-model.mjs`
- `prototype/desktop/paper-library-model.test.mjs`
- `prototype/desktop/styles.css`

## RED/GREEN evidence

### Baseline

- Command: `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`
- Result: exit 0; 357 tests passed, 0 failed.

### Task 1: facet-state contract

- RED command: `node --test exporter/paper-library/facet-schema.test.mjs`
- RED result: exit 1; module loading failed because `FACET_STATE_VALUES` was not exported; 0 passed, 1 failed.
- GREEN command: `node --test exporter/paper-library/facet-schema.test.mjs`
- GREEN result: exit 0; 13 passed, 0 failed.

### Task 2: deterministic v3 migration

- RED command: `node --test exporter/paper-library/paper-tag-migration.test.mjs`
- RED result: exit 1; `ERR_MODULE_NOT_FOUND` for `paper-tag-migration.mjs`; 0 passed, 1 failed.
- GREEN command: `node --test exporter/paper-library/paper-tag-migration.test.mjs`
- GREEN result: exit 0; 3 passed, 0 failed.

### Task 3: v3 catalog validation and merge

- RED command: `node --test exporter/paper-library/tag-catalog.test.mjs`
- RED result: exit 1; loader still required version 2 and rejected/ignored `facet_states`; 3 passed, 9 failed.
- GREEN command: `node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/paper-tag-migration.test.mjs exporter/paper-library/tag-catalog.test.mjs`
- GREEN result: exit 0; 28 passed, 0 failed, including the migrated real catalog contract.

### Task 4: public wire propagation

- RED command: `node --test exporter/paper-library/overrides.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs`
- RED result: exit 1; generated-record field/provenance validation and index version remained old; 55 passed, 9 failed.
- GREEN command: `node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/overrides.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/build.test.mjs`
- GREEN result: exit 0; 89 passed, 0 failed.
- Refactor recheck: `node --test exporter/paper-library/status.test.mjs` exited 0 with 20 passed.

### Task 5: strict v3/2 reader with v2/1 normalization

- RED command: `node --test prototype/desktop/paper-library-dom.test.mjs`
- RED result: exit 1; v3 was rejected and normalized rows with the new field failed the old exact-key reader; 83 passed, 3 failed.
- GREEN command: `node --test prototype/desktop/paper-library-dom.test.mjs`
- GREEN result: exit 0; 86 passed, 0 failed, including both approved wire pairs and malformed-pair/state rejection.

### Task 6: conservative rendering

- RED command: `node --test prototype/desktop/paper-library-model.test.mjs`
- RED result: exit 1; module loading failed because `facetEmptyLabel` was not exported; 0 passed, 1 failed.
- Model GREEN command: `node --test prototype/desktop/paper-library-model.test.mjs`
- Model GREEN result: exit 0; 33 passed, 0 failed.
- DOM RED command: `node --test --test-name-pattern='inspector renders the schema-ordered research profile' prototype/desktop/paper-library-dom.test.mjs`
- DOM RED result: exit 1; empty `constraints.consistency` rendered `待核验` instead of `未记录`; 0 passed, 1 failed.
- Combined GREEN command: `node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs`
- Combined GREEN result: exit 0; 119 passed, 0 failed.

### Task 7: package boundary

- RED command: `node --test exporter/paper-library/package-audit.test.mjs`
- RED result: exit 1; production policy/manifest omitted the three reusable migration files; 26 passed, 6 failed.
- GREEN command: `node --test exporter/paper-library/package-audit.test.mjs`
- GREEN result: exit 0; 32 passed, 0 failed.

## Private backup and migration evidence

- Pre-migration source: ignored `local_library_config/paper-tags.json`.
- Private ignored backup: `local_library_config/.backups/paper-tags.v2-pre-v3-20260831T135528+0800.json`.
- Pre-migration source SHA-256: `58b08667bbd46a9cf96c47dccc34438f299c0b921dd056d6e685dd77cf4c44c6`.
- Backup SHA-256 before migration: `58b08667bbd46a9cf96c47dccc34438f299c0b921dd056d6e685dd77cf4c44c6`.
- `cmp -s` and both hashes confirmed byte identity before replacement.
- Migration command result: `标签目录已迁移到 version 3：52 条记录`.
- Post-migration structural probe: `version=3 papers=52`; every initial `facet_states` object is empty.
- The backup is retained because the full real build/browser acceptance is deferred to master Task 14.
- Neither the catalog nor the backup was staged, tracked, committed, or added to the public package.

## Skipped runtime steps

The following were explicitly skipped under the master plan:

- no real configured `build-private-library.mjs` run;
- no generated `paper-index.json` inspection;
- no server start, service replacement, or live browser acceptance;
- no Playwright screenshots or real-library E2E;
- no handoff, push, merge, publish, or cutover.

Master Task 14 owns the combined real build, generated-index inspection, and live browser acceptance after subsequent integration phases.

## Final verification

- Exact focused suite:
  - Command: `node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/paper-tag-migration.test.mjs exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs`
  - Result: exit 0; 202 passed, 0 failed.
- JavaScript syntax:
  - `node --check` passed for the modified schema, migration CLI/library, catalog, status, build, reader, model, and inspector modules.
- Python syntax:
  - `python3 -m py_compile exporter/verification/private_library_e2e.py` exited 0.
- Package audit:
  - Command: `node exporter/scripts/audit-github-package.mjs`
  - Result: exit 0; `GitHub 打包审计：通过（73 个候选文件）`.

## Git boundary checks

- `git check-ignore -v` attributes both the real catalog and backup to `.gitignore:2:local_library_config/`.
- `git ls-files local_library_config/paper-tags.json 'local_library_config/.backups/*'` returned no tracked paths.
- Base-to-head committed-path scan contains no `local_library_config/`, `local_library_data/`, or `local_library_output/` path.
- Staged-path scan contains no private catalog, backup, generated data, or generated output.
- `exporter/config/github-package-files.json` does not contain `local_library_config/paper-tags.json`.
- Pre-existing untracked `audits/` and `tmp/` remain untouched and uncommitted.

## Concerns / follow-up

- The real generated output was deliberately not rebuilt, so the currently served output may remain the legacy `2/1` pair until master Task 14 performs the combined runtime acceptance.
- `private_library_e2e.py` now expects the new `3/2` generated wire shape but was syntax-checked only; live execution is intentionally deferred.
- Keep the private v2 backup until Task 14's real build and browser acceptance pass and an operator explicitly decides it is no longer needed.
