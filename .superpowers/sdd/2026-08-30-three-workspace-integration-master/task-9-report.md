# Task 9 Implementation Report

## Status and commits

- Status: complete for master-plan Task 9's shared runtime, seven-category Markdown inspection, lock-agnostic note transaction, and desktop note-import client scope.
- Base: `7013fc2` (`docs: record async logger fix evidence`).
- Branch: `codex/three-workspace-integration`.
- Checkpoint 1: `d84fb4f` (`refactor(paper-library): share private runtime loading`).
- Checkpoint 2: `01c2951` (`feat(paper-library): inspect markdown note imports`).
- Checkpoint 3: `4498226` (`feat(paper-library): commit note imports safely`).
- Checkpoint 4: `adb482a` (`feat(paper-library): add local note import dialog shell`).
- Checkpoint 5: `2feab98` (`feat(paper-library): complete note import workflow`).
- Independent-review hardening: `0d16483` (`fix(paper-library): harden note import boundaries`).
- Second-review syntax and response hardening: `24286cf` (`fix(paper-library): validate canonical note syntax`).
- Blank-block reset: `90089af` (`fix(paper-library): reset code spans at blank blocks`).
- Markdown-block segmentation: `8257649` (`fix(paper-library): segment code spans by Markdown blocks`).
- Leaf-block segmentation: `80a4572` (`fix(paper-library): bound code spans at leaf blocks`).
- Display/table segmentation: `9cae5e6` (`fix(paper-library): isolate display and table blocks`).
- Implementation head before this report update: `9cae5e6`.

## RED/GREEN evidence

### Checkpoint 1 — shared private runtime

- Runtime RED: `node --test exporter/paper-library/runtime.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `runtime.mjs`; 0 passed.
- CLI injection RED: the focused CLI contract had 0 passed and 1 failed because the command still exposed the former dependency surface instead of only `loadContext` and `rebuild`.
- Runtime GREEN: the runtime suite passed 3/3.
- CLI GREEN: `node --test --test-name-pattern='CLI main|CLI loads catalogs' exporter/paper-library/build.test.mjs` passed its one matched test, with 0 failed.

### Checkpoint 2 — seven note categories and image inspection

- RED: `node --test exporter/paper-library/note-import.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `note-import.mjs`; a second focused RED exposed the missing shared controlled-image inspection export.
- Note inspection GREEN: 10/10 passed.
- Shared image/build regression GREEN: the focused image matcher passed 3/3.
- The implementation preserves the exact seven categories, the 1,048,576-byte limit, fatal UTF-8 decoding, fixed safe checks, filename/frontmatter/metadata/LaTeX validation, and the single shared controlled-image boundary.

### Checkpoint 3 — inspection store and lock-agnostic transaction

- RED: `node --test exporter/paper-library/note-import-transaction.test.mjs` exited 1 before executing tests because `createInspectionStore` was not exported; 0 passed.
- Transaction GREEN: 8/8 passed.
- Runtime plus note-inspection regression GREEN: 13/13 passed.
- Consumed coordinator regression GREEN: 11/11 passed without modifying the coordinator.
- The transaction remains coordinator-agnostic and preserves single-use ten-minute inspections, source/hash/symlink revalidation, exclusive no-follow creation, versioned conflicts, build/index reconciliation, fingerprint-guarded rollback, and fixed safe recovery codes.

### Checkpoint 4 — dialog shell, strict client, and static fallback

- RED: the governing focused matcher reported 0 passed and 6 failed. Failures covered the copy-path capability gate, loader invalidation, strict API capability schema, fatal UTF-8 decoding, and the missing note-import dialog shell.
- Focused GREEN: all 6 matched tests passed.
- Full DOM regression at this checkpoint: 101/101 passed.

### Checkpoint 5 — state machine, refresh, and preview reconciliation

- Initial RED: 0 passed and 2 failed because `findImportedPreviewSelection` was missing and the add-note entry was not bound.
- Expanded governing RED: 0 passed and 7 failed across focus/cancel, stale inspection, `LIBRARY_WRITE_BUSY`, successful refetch, and index-reload behavior.
- Governing focused GREEN: 7/7 passed.
- Full DOM GREEN: 108/108 passed, including nested tests.
- The final controller keeps Markdown local to the file handler, rejects stale inspection results, blocks dismissal while importing, preserves the inspection only for `LIBRARY_WRITE_BUSY`, invalidates all other failures, reloads without clearing the old view, and uniquely reconciles the imported preview by URL plus filename before selecting its `selectionKey`.

### Independent-review hardening

- Initial review RED: the original focused follow-up command discovered 133 tests with 126 passed and 7 failed. The failures covered cleanup after a created-file write failure, both initial-fingerprint cleanup paths, frontmatter closing beyond the parser window, and the new static-controller fixture.
- Expanded RED: adding the directory-continuity, published-cleanup, full-index, NFKC, exact-capability-state, and abort contracts discovered 177 tests with 159 passed and 18 failed, including nested-test rollups.
- Expanded GREEN: `node --test exporter/paper-library/note-import.test.mjs exporter/paper-library/note-import-transaction.test.mjs prototype/desktop/paper-library-dom.test.mjs exporter/paper-library/build.test.mjs` passed 178/178.
- Created-file cleanup now returns an ordinary fixed write error only after the exact created inode is confirmed absent; an unconfirmed or failed cleanup returns fixed `ROLLBACK_FAILED` without exposing a path.
- The transaction retains a verified unit-directory handle and rechecks lexical `lstat`/`realpath` plus `dev`/`ino` continuity before and after create, fingerprint, and rollback operations. The injected pre-create replacement test proves zero `O_CREAT` calls and no file in the outside directory.
- Frontmatter whose complete closing delimiter lies beyond the parser's 8,192-character window is a blocking `FRONTMATTER_TOO_LARGE` result, so identity metadata cannot silently become absent.
- Build and note-import reconciliation now share `validateBuiltPaperIndex`: exact v3 root and facet schema, nonnegative warning count, exact complete paper records, controlled previews/source documents, unique paper IDs, and recursive private-locator rejection.
- A failure to remove `.previous-*` after both generated directories have been published is treated as post-commit housekeeping and does not turn a successful rebuild into a source-note rollback.
- The desktop client NFKC-normalizes requested basenames, accepts only canonical response basenames or `_vN` variants, validates only the three exact capability matrices, preserves static browsing without capabilities, and aborts obsolete inspections while retaining generation checks.

### Second-review syntax and response hardening

- Canonical-basename RED: the focused DOM command discovered 10 tests with 3 passed and 7 failed. `_v10`, `_v19`, `_v100`, uppercase `.MD`, and rejection of an extension-case change all exposed the old response matcher; nested rollups account for the remaining failures.
- Server-bound RED: after the legal range was made explicit, the focused DOM command discovered 11 tests with 9 passed and 2 failed because the client still accepted impossible `_v100000` output.
- Markdown-code RED: the first focused note command failed 2/2 for double-backtick inline code and a four-backtick fence containing a shorter three-backtick line. Separate anti-overreach, multiline, and backslash-closer RED commands then failed 0/1, 0/3, and 0/1 respectively.
- Governing GREEN: the final note syntax matcher passed 7/7, and the final basename matcher passed 12/12.
- Import responses now accept only the exact NFKC canonical requested basename or the server-generated `_vN` form for `2 <= N <= 99999`. The matcher covers 10–19 and higher integers, preserves the requested `.md` extension casing, and rejects leading zeroes, extension-case drift, arbitrary suffixes, and versions outside the server loop.
- LaTeX inspection now removes exact-length variable-backtick code spans across non-fenced line breaks, keeps escaped prose openers visible, treats backslashes inside code as ordinary content, preserves removed-span newlines, and closes fences only with the same marker character and at least the opener length.

### Final-review Markdown block segmentation

- Blank-boundary RED: the focused command discovered 3 tests with 0 passed and 3 failed because both single- and double-backtick spans crossed empty or whitespace-only block separators.
- Core-block RED: the next focused command discovered 8 tests with 0 passed and 8 failed across ATX headings, blockquotes, unordered and ordered lists, setext headings, thematic breaks, and indented blocks, including the nested rollup.
- Leaf/table RED: after the core cases passed, the expanded focused command discovered 12 tests with 7 passed and 5 failed. HTML-like lines, link-reference definitions, leading-pipe table rows, and GFM delimiter rows remained unsegmented, plus the nested rollup.
- Display/table-state RED: the final focused command discovered 5 tests with 0 passed and 5 failed. Single- and multiline `$$` blocks, bracket display math, and no-leading-pipe rows after a GFM delimiter were still swallowed by a prior unmatched code-span opener.
- Combined GREEN: the ordinary soft-line, blank-line, recognized-block, display-math, and table-state governing command passed 23/23.
- Inline code remains allowed across ordinary paragraph soft line breaks, but blank/whitespace-only lines, fences, conservative core block starters, HTML-like lines, link-reference definitions, display-math starters, and common GFM table boundaries flush the current inline segment. After a GFM delimiter, each consecutive pipe-containing row is isolated until a non-pipe, blank, or fenced line ends the conservative table state. These fail-closed boundaries prevent an unmatched opener in one block or row from hiding a real unbalanced formula later without introducing a Markdown renderer dependency.

## Final verification

- Required focused suite:
  `node --test exporter/paper-library/runtime.test.mjs exporter/paper-library/note-import.test.mjs exporter/paper-library/note-import-transaction.test.mjs prototype/desktop/paper-library-dom.test.mjs`
  exited 0 with 182 passed and 0 failed.
- Coordinator suite:
  `node --test exporter/paper-library/write-coordinator.test.mjs`
  exited 0 with 11 passed and 0 failed.
- Required aggregate:
  `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`
  discovered 504 tests and exited 1 with 503 passed and 1 failed. The sole failure was `every packaged relative HTML and static-import dependency closes inside the fixed policy`, with the exact blocker `[{ path: 'exporter/scripts/build-private-library.mjs', code: 'dependency_unlisted' }]`.
- Aggregate excluding the package-policy test:
  `zsh -o extendedglob -o pipefail -c 'node --test exporter/paper-library/^package-audit.test.mjs prototype/desktop/*.test.mjs 2>&1 | tail -30'`
  exited 0 with 489 passed and 0 failed. This proves the remaining exporter and desktop regressions are GREEN.
- Syntax checks passed independently for `runtime.mjs`, `note-import.mjs`, `library.mjs`, and `paper-inspector.mjs` using `node --check`.
- `git diff --check` and `git diff --check 7013fc2..HEAD` both passed with no output.

## Boundary statement

- Changes are limited to the Task 9 implementation/test files and this required report. `write-coordinator.mjs` and its test were consumed but not modified.
- All filesystem transaction tests used temporary directories. No real configured build CLI was run, and no real paper, note, PDF, OCR, image, private configuration, generated library output, browser storage, or live service was read or changed.
- No server, route, candidate archive, discovery, Agent, migration, cutover, package policy, package manifest, E2E, screenshot, port, or service file was created or modified.
- Pre-existing untracked `audits/` and `tmp/` remain untouched and uncommitted.
- Transaction fixtures now register temporary-directory cleanup with `t.after`; no review test uses real source or generated data.

## Deferred risks and ownership

- Task 10 owns server integration and the coordinator order: acquire through `coordinator.run`, take the inspection token as the first statement after lock acquisition, and mark `manual_note` recovery for `ROLLBACK_FAILED` or `BUILD_OUTPUT_INVALID` before rethrowing. Task 9 intentionally contains no server or coordinator knowledge in `note-import.mjs`.
- Pure Node pathname APIs do not provide portable `openat` semantics. Within the master plan's local single-user boundary, Task 9 retains a verified directory handle and performs the strongest portable continuity checks; it does not claim protection against a same-permission malicious process winning a nanosecond pathname race. Task 10 must continue to expose the service only to the local user.
- If post-publish cleanup leaves a `.previous-*` directory, the newly published build remains valid but the stale backup must be removed before a later preflight can reuse that fixed backup name.
- Task 13 owns exact build/package dependency closure. It must add the Task 9 runtime/import dependency set to the fixed package policy and manifest union. The one aggregate failure quoted above is therefore a planned Task 13 dependency-list closure item, not an in-scope Task 9 regression.
- Task 14 owns final combined package, browser, visual, and E2E acceptance after Task 13 closes the package policy. It does not own the package-list implementation itself.
