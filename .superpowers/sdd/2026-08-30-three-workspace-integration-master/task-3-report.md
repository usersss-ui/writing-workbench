# Task 3 Implementation Report

## Status

- Status: complete for the authorized non-runtime scope of master-plan Task 3.
- Personal-tag subplan Tasks 1–5 were implemented test-first with task-level commits.
- Personal-tag Task 6 Steps 1, 3, 4, 7, and 8 were executed.
- Task 6 Step 2 and Steps 5–6 were skipped under the controller ruling.
- No configured build, generated-output inspection, Playwright run, screenshot capture, browser-localStorage mutation, or service acceptance was performed.
- The existing `4176` service was not stopped, replaced, or used for acceptance.

## Base and implementation head

- Base: `84bfb76caaa0fd437c58623bf51ff5e28fafa8ae`
- Verified implementation head before this report-only commit: `c09ba9e704555aecf53b36df3fa0ac41b10c8284`
- Branch: `codex/three-workspace-integration`

## Commits

1. `01925bb feat: add isolated paper user tag store`
2. `3684da8 feat: search paper user tags`
3. `d7fa9fc feat: render personal tag editors`
4. `db84d9e feat: manage personal tags in paper library`
5. `a0d66b7 build: ship paper user tag module`
6. `c09ba9e test: verify paper user tag workflow`

## Files changed

- `README.md`
- `exporter/config/github-package-files.json`
- `exporter/paper-library/build.mjs`
- `exporter/paper-library/build.test.mjs`
- `exporter/paper-library/package-audit.mjs`
- `exporter/paper-library/package-audit.test.mjs`
- `exporter/verification/private_library_e2e.py`
- `prototype/desktop/README.md`
- `prototype/desktop/library.mjs`
- `prototype/desktop/library.template.html`
- `prototype/desktop/paper-inspector.mjs`
- `prototype/desktop/paper-library-dom.test.mjs`
- `prototype/desktop/paper-library-model.mjs`
- `prototype/desktop/paper-library-model.test.mjs`
- `prototype/desktop/paper-user-tags.mjs`
- `prototype/desktop/paper-user-tags.test.mjs`
- `prototype/desktop/styles.css`

## RED/GREEN evidence

### Baseline

- Command: `node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`
- Result: exit 0; 189 passed, 0 failed.

### Task 1: isolated browser store

- RED command: `node --test prototype/desktop/paper-user-tags.test.mjs`
- RED result: exit 1 with `ERR_MODULE_NOT_FOUND` for `prototype/desktop/paper-user-tags.mjs`.
- GREEN command: the same command.
- GREEN result: exit 0; 8 passed, 0 failed.
- Covered exact key isolation, NFKC normalization, first-spelling Latin-case dedupe, Unicode code-point limits, 20/500 assignment limits, malformed-storage resilience, clone-on-return, strict export, merge-only import, unknown-paper reporting, and invalid-import atomicity.

### Task 2: separate search state

- RED command: `node --test --test-name-pattern="personal tags|personal-tag" prototype/desktop/paper-library-model.test.mjs`
- RED result: exit 1; 1 passed and 2 failed because search/view construction ignored the separate tag state.
- GREEN command: `node --test prototype/desktop/paper-library-model.test.mjs`
- GREEN result: exit 0; 36 passed, 0 failed.
- Formal facet readers/options remained paper-facet-only; tag hits use the label `我的标签`.

### Task 3: safe reusable renderer

- RED command: `node --test --test-name-pattern="personal tag editor|place personal tags" prototype/desktop/paper-library-dom.test.mjs`
- RED result: exit 1; 2 failed because `renderUserTagEditor` did not exist and neither placement rendered it.
- GREEN command: `node --test prototype/desktop/paper-library-dom.test.mjs`
- GREEN result: exit 0; 91 passed, 0 failed.
- The plan's initial concatenated-text assertion omitted the visible `移除` button text; the expectation was corrected after implementation while retaining the behavioral assertions for literal label text, zero injected images, stable action hooks, and no `innerHTML`.
- Existing `renderInspector` research-profile order and `facet_states` rendering remain intact; the optional editor is inserted immediately before the profile.

### Task 4: controller, counts, import/export, and desktop layout

- Static RED: `node --test --test-name-pattern="private JSON import|desktop containment" prototype/desktop/paper-library-dom.test.mjs` exited 1; 2 failed.
- Static GREEN: the same command exited 0; 2 passed.
- Helper RED: `node --test --test-name-pattern="downloadUserTagJson|personal-tag query" prototype/desktop/paper-library-dom.test.mjs` exited 1; 2 failed.
- Helper GREEN: the same command exited 0; 2 passed.
- Controller RED: `node --test --test-name-pattern="separate store and merge-only" prototype/desktop/paper-library-dom.test.mjs` exited 1; 1 failed.
- Controller GREEN: the same command exited 0; 1 passed.
- Combined regression: `node --test prototype/desktop/paper-user-tags.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs prototype/desktop/paper-library-storage.test.mjs` exited 0; 151 passed, 0 failed.
- The controller keeps workspace and personal-tag stores separate, uses one immutable snapshot of each per render, forwards tag state to result and facet counts, revokes export object URLs, imports only against current stable IDs, and leaves the existing workspace-store bytes/contracts unchanged.

### Task 5: generated asset and public package boundary

- RED command: `node --test exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`
- RED result: exit 1; 59 passed and 8 failed because the builder, package policy, manifest, mapping, and dependency closure omitted the new module/test.
- GREEN command: the same command.
- GREEN result: exit 0; 67 passed, 0 failed.
- Package audit: `node exporter/scripts/audit-github-package.mjs` exited 0 with `GitHub 打包审计：通过（75 个候选文件）`.
- The builder's generated mapping is byte-for-byte from `prototype/desktop/paper-user-tags.mjs`; the package contains the module/test but no personal-tag JSON or browser data.

### Task 6: deferred E2E source and documentation

- Added the required asset assertion and browser acceptance source for add, reload persistence, search, removal, workspace-byte preservation, merge import, exact unmatched count, and unknown-ID exclusion.
- Added browser-only storage, limits, merge behavior, and backup guidance to both documentation entry points.
- The E2E source was syntax-checked only and was not executed.

## Final verification

- Exact focused suite from the Task 3 brief:
  - Command: `node --test prototype/desktop/paper-user-tags.test.mjs prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-dom.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/package-audit.test.mjs`
  - Result: exit 0; 207 passed, 0 failed.
- Full exporter/desktop suite:
  - Command: `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`
  - Result: exit 0; 402 passed, 0 failed.
- Dedicated package-audit tests:
  - Command: `node --test exporter/paper-library/package-audit.test.mjs`
  - Result: exit 0; 32 passed, 0 failed.
- Package audit:
  - Command: `node exporter/scripts/audit-github-package.mjs`
  - Result: exit 0; 75 candidates accepted.
- Syntax:
  - `node --check` passed for every changed `.mjs` implementation and test module.
  - `python3 -m py_compile exporter/verification/private_library_e2e.py` exited 0.

## Skipped runtime steps

- Personal-tag Task 6 Step 2: no Playwright RED run.
- Personal-tag Task 6 Steps 5–6: no configured real build, live browser acceptance, screenshots, or visual inspection.
- No generated `paper-index.json` or generated desktop asset was inspected.
- No request was sent to the existing service and no browser localStorage was read or written.
- Master Task 14 owns the combined real build, generated-output inspection, Playwright acceptance, and 1280/1440 screenshots.

## Package and privacy checks

- `research-console.paper-user-tags.v1` is the only production storage key introduced for personal labels.
- Personal labels are not added to paper records, `facets`, `facet_states`, `source_terms`, the tag catalog, generated index, package JSON, workspace storage, Agent data, or source files.
- Manifest probe found no `paper-user-tags.json`, `local_library_config/`, `local_library_data/`, or `local_library_output/` entry; it contains exactly 75 public source paths.
- `git ls-files local_library_config local_library_data local_library_output output/playwright` returned no paths.
- Base-to-head committed-path scan contains no private/generated/runtime output path.
- Real catalog SHA-256 remained `ad980b7fe101b8b65c6db6e8bdeb4690464e06711176a8264dd9d8346398d423`.
- Retained backup SHA-256 remained `58b08667bbd46a9cf96c47dccc34438f299c0b921dd056d6e685dd77cf4c44c6`.
- Both private files remain ignored and untracked.
- Pre-existing untracked `audits/` and `tmp/` remain untouched and uncommitted.

## Concerns and follow-up

- The real generated output was deliberately not rebuilt, so it will not contain `assets/paper-user-tags.mjs` until master Task 14 runs the combined build.
- The new E2E flow is source-complete and syntax-valid but has not been exercised against a browser or the real 3/2 output; Task 14 must supply that evidence.
- Keep the existing private catalog backup until the combined build/browser acceptance passes and an operator explicitly decides it is no longer required.
