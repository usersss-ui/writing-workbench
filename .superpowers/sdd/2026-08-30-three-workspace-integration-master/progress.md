# SDD ledger — plan: /Users/yangfan/.codex/worktrees/22dd/html/docs/superpowers/plans/2026-08-30-three-workspace-integration-master.md

## Setup evidence

- Workspace: `/Users/yangfan/.codex/worktrees/22dd/html`
- Isolation: linked git worktree (`git-dir` differs from `git-common-dir`), not a submodule.
- Initial branch: detached HEAD; Task 1 owns attachment to `codex/three-workspace-integration`.
- Baseline command: `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`
- Baseline result: 357 tests passed, 0 failed on 2026-08-31.
- Current 4176 service remains outside this worktree until Task 15; no setup action stopped or replaced it.

## Pre-flight rulings

- Ruling: Execute `1 → 2 → 3 → 8 → 9 → 4 → 5 → 6 → 7 → 10 → 11 → 12 → 13 → 14 → 15`, not numeric section order — the master plan explicitly makes dependency order authoritative — if wrong, later tasks may require rebase/rework around runtime and schema interfaces.
- Ruling: Task 1 will checkpoint the reviewed pre-existing public baseline before feature edits, even though this creates a large first commit — the authoritative worktree is detached and nearly all source is currently untracked — if wrong, the cost is an unnecessarily broad but recoverable baseline commit.
- Ruling: For Tasks 2 and 3, skip the governing subplans' real configured build/live browser handoff steps exactly where the master plan says to defer them to Task 14 — this preserves the atomic schema/package boundary — if wrong, live-only defects surface later and require Task 14 rework.
- Ruling: Task 9 may implement and test the pure client validator for Task 10's final capabilities shape before the live server exists; static read-only fallback remains the runtime behavior — this resolves the forward reference without inventing an interim server — if wrong, Task 10 may require validator adjustments.
- Ruling: Before Task 2 runs the operator-owned version-3 migration, create and hash an ignored private backup of `local_library_config/paper-tags.json`; do not run the replacing migration unless the backup is verified — the governing subplan requires keeping a pre-migration backup although its sample CLI command does not create one — if wrong, the cost is one extra ignored backup file.
- Ruling: The user's explicit choice of Subagent-Driven execution authorizes Task 15's planned reversible local preview cutover after all gates pass; it does not authorize push, merge, publish, real-paper mutation, or unbounded process termination — if wrong, the cost is a reversible local service switch protected by recorded PIDs and rollback.
- Ruling: In personal-tag subplan Task 6, execute Steps 1, 3, 4, 7, and 8 but skip Step 2 together with Steps 5–6 — Step 2 itself runs Playwright, which conflicts with the master plan's non-runtime deferral and Task 14 ownership of combined browser acceptance — if wrong, Task 14 will still exercise the already-written E2E assertions before cutover.

## Cross-task interface and shared-file scan

| Producer task | Consumer task | Shared file or interface | Pre-flight finding |
| --- | --- | --- | --- |
| 1 | 2–15 | Entire public source baseline and named branch | Clean: checkpoint precedes every feature edit; private/generated/audit paths are excluded. |
| 2 | 3 | `build*`, `paper-library-model*`, `paper-inspector.mjs`, `styles.css`, package files | Clean: facet wire/schema lands first; personal tags remain an independent browser layer. |
| 2 | 5 | `facet_states`, conservative status/index generation | Clean: metadata-only papers consume empty states and existing conservative status values. |
| 2 | 9 | `build*`, library model/inspector/styles/DOM | Clean: note UI must preserve the post-facet inspector contract. |
| 2 | 13 | generated assets and package manifest | Clean: Task 13 unions rather than replaces schema assets. |
| 3 | 7 | personal tags vs Agent snapshot data | Clean: Agent inputs explicitly exclude personal tags. |
| 3 | 9 | inspector signature, `library.mjs`, styles, build/package files | Clean: Task 9 preserves `userTags` and `userTagNotice`. |
| 3 | 12 | `paper-user-tags.mjs` owner-store API | Clean: Task 12 adds validated replace/restore without raw storage writes. |
| 8 | 9 | process-wide coordinator | Clean: Task 8 produces immediate-reject writer; Task 9 consumes it and stays lock-agnostic below the wrapper. |
| 8 | 10 | coordinator recovery schema | Clean: server routes expose fixed 409/recovery behavior. |
| 9 | 6 | `runtime.mjs`, build CLI/context, `build.mjs` | Clean under ruling: Task 6 extends only the post-Task-9 context with institution data. |
| 9 | 10 | note inspection/import transaction and final API | Clean: Task 10 supplies the first server wiring and consumes inspection only after lock acquisition. |
| 4 | 5 | candidate identity fields and DOI/OpenAlex normalization | Clean: browser candidate identity remains provider-qualified; local `paper_id` is separate. |
| 4 | 6 | discovery primitives, institution config, candidate store | Clean: Task 6 builds UI/controller around Task 4 modules. |
| 4 | 11 | candidate-store transition API | Clean: Task 11 marks archived only after index reconciliation. |
| 5 | 10 | archive transaction, config/scanner identity audit | Clean: Task 10 wraps the pure transaction with full rescan/rebuild/recovery. |
| 5 | 11 | local `paper_id` vs external identity | Clean: DOI-first/canonical-OpenAlex reconciliation is explicit; no ID equality guess. |
| 6 | 7 | navigation templates, build assets, desktop routes | Clean: Task 7 adds Agent route after discovery exists. |
| 6 | 10 | runtime context, generated discovery assets, static allowlist | Clean: server starts only after discovery/runtime is complete. |
| 7 | 12 | direction and Agent snapshot owner stores | Clean: Task 12 extends validated transactional replace APIs. |
| 10 | 11 | capabilities/archive/recovery API and clients | Clean: exact schema and response mapping are specified before UI wiring. |
| 10 | 12 | `local-server*`, build assets, static allowlist | Clean: Task 12 adds only the exact transfer page and eight-file dependency closure. |
| 11 | 12 | `library.mjs`, `discovery.mjs`, `styles.css` and persisted candidate state | Clean: archive UI lands before migration support; migration preserves candidate identity. |
| 12 | 13 | `build.mjs`, generated transfer assets, package list | Clean: Task 13 reconciles exact generated closure and package equality. |
| 13 | 14 | package audit and three ordered package lists | Clean: Task 14 appends E2E sources and splits private-path sentinel before audit. |
| 14 | 15 | verified commit, fixture tests, operator documentation | Clean: cutover is forbidden until all automated and visual gates pass. |

## Per-task self-consistency scan

| Task | Tests vs code/files | Finding |
| --- | --- | --- |
| 1 | Read-only evidence/tests, then branch and public checkpoint | Clean; staged boundary must be reviewed before commit. |
| 2 | Governing facet-state tasks, focused compatibility suite, deferred live steps | Clean under pre-flight ruling. |
| 3 | Governing personal-tag tasks, isolated store/search/DOM/package tests | Clean under pre-flight ruling. |
| 4 | Four RED module tests followed by four bounded primitives | Clean; donor files are reference-only and core files untouched. |
| 5 | Parser/config/scanner/archive RED/GREEN over temporary roots | Clean; no status enum change and no real archive write. |
| 6 | Discovery DOM/build tests match page, controller, institution and runtime-context changes | Clean; post-Task-9 CLI contract is explicit. |
| 7 | Direction/Agent stores, pages and build tests match read-only snapshot scope | Clean; no executor/model API. |
| 8 | Coordinator concurrency/recovery tests match the two exact recovery variants | Clean; no domain state in coordinator. |
| 9 | Note subplan core/UI tests match shared coordinator substitution | Clean under forward-validator ruling; no interim server. |
| 10 | Exact route/security/concurrency/recovery tests match server/action/CLI files | Clean; startup failure never listens and last-good recovery is post-write only. |
| 11 | DOM/client tests match archive reconciliation and recovery UI | Clean; DOI/URL identity and local-ID index check are explicit. |
| 12 | Pure/DOM/server tests match five store APIs and exact eight-file closure | Clean; rollback after partial merge is explicitly tested. |
| 13 | Build/package deep-equality tests match exact template/asset/source lists | Clean; listed snippets are lexically ordered. |
| 14 | Temporary Node/Python E2E and two viewport QA match modified/new files | Clean; screenshots use ignored output path and private sentinel is fragment-built. |
| 15 | Preflight, state transfer, cutover, smoke and double-compensated rollback | Clean under authorization ruling; every stopped PID is revalidated and reversible. |

## Task status

- Task 1: complete (commits `4eedc11..8ce9950`; independent review approved with no Critical or Important findings)
- Task 1 base: `4eedc11e980e39fe1fcf08d3bdf50fee495aa53a`
- Task 1 head: `8ce9950ae890bdc8d465e2404ee6ad8d2534cbb9`
- Task 1 verification: controller baseline and implementer rerun both passed `357/357`; scanner alias boundary passed `6/6`.
- Task 1 branch evidence: reflog records checkout from detached `4eedc11` to `codex/three-workspace-integration`, followed by the authoritative baseline commit.
- Task 1 service evidence: port `4176` is still served by PID `14105`, started at 13:10:18 before the 13:35:44 checkpoint commit, with cwd `/Users/yangfan/.codex/worktrees/2c10/html`; Task 1 did not stop or replace it.
- Task 1 donor evidence: the commit diff is confined to this worktree's public baseline. Both donor worktrees remain independently dirty, so historical byte-for-byte nonmutation is accepted as a static-evidence limitation rather than inferred from their present status.
- Task 1 minor (deferred): `README.md:107` says no code was committed; Task 14 documentation must distinguish a local authority checkpoint from remote push/publication.
- Task 2: complete (commits `8ce9950..84bfb76`; two fix loops; final independent review PASS with no findings)
- Task 2 verification: focused suite `214/214`; full implementer suite `384/384`; migration suite `8/8`; package audit approved 73 candidates. Live build/browser acceptance remains intentionally deferred to Task 14.
- Task 2 private migration: retained ignored v2 backup; v3 catalog remains ignored/untracked; final cleanup verifies temp `dev/ino` before unlinking and preserves replacement/unowned paths.
- Task 3: complete (commits `84bfb76..45cfbcd`; one fix loop; final independent review PASS with no findings)
- Task 3 verification: store `10/10`; focused `209/209`; full `404/404`; package audit approved 75 candidates. Real build/browser/viewport checks remain intentionally deferred to Task 14.
- Task 3 boundary: browser-only key `research-console.paper-user-tags.v1`; personal labels remain outside formal facets, generated papers/index, catalog, workspace storage, and package data.
- Task 8: complete (commits `45cfbcd..7013fc2`; one fix loop; final independent review PASS with no findings)
- Task 8 verification: focused coordinator suite `11/11`; full exporter/desktop suite `415/415`; immediate busy rejection, no queue, lock release, exact recovery records, staged candidate recovery clear, manual recovery block, detached state, and synchronous/asynchronous logger isolation are covered.
- Task 8 boundary: coordinator owns only process write exclusion and recovery state; no note tokens, candidate state, paths, private/generated/live data, service, or queue was introduced.
- Task 9: complete (commits `7013fc2..4edf23c`; final formal review and independent security review both PASS with 0 Critical/Important findings)
- Task 9 verification: focused runtime/note/transaction/desktop suite `183/183`; write coordinator `11/11`; aggregate excluding the Task-13 package-policy test `490/490`; full aggregate `504/505`, with the sole known `dependency_unlisted: exporter/scripts/build-private-library.mjs` deferred to Task 13.
- Task 9 boundary: note import is lock-agnostic below the shared coordinator, uses exclusive no-follow creation, identity/fingerprint guarded rollback, complete v3 index reconciliation, strict client capabilities and static fallback, and conservative Markdown/LaTeX inspection aligned with the controlled renderer. No real archive, generated library, service, or port was modified.
- Task 9 non-blocking follow-up: pure Node cannot close the final same-permission pathname nanorace without an `openat`-style helper; stale verified `.previous-*` cleanup may require manual removal before a later build; future renderer syntax extensions must add matching inspector tests.
- Task 4: complete (commits `4edf23c..7977b5d`; two security fix loops; final formal review and independent security review both PASS with 0 Critical/Important findings)
- Task 4 verification: exact focused suite `63/63`; all four production modules passed `node --check`; `git diff --check` passed; 11/11 adversarial probe classes passed, including repeated percent-encoded credential aliases and the OpenAlex-to-candidate persistence chain.
- Task 4 boundary: exactly nine public primitive/config files plus the ignored SDD report; no live network, browser, build, generated output, server, port, archive write, real-paper mutation, donor modification, credential, or private path was introduced.
- Task 4 non-blocking follow-up: `response.json()` has no pre-parse total-byte cap; path-like input with a query suffix can be interpreted as a title without any filesystem access; one test title is stale wording only.
- Task 5: complete (commits `7977b5d..46f59db`; final formal review and independent quality/privacy review both PASS with 0 Critical/Important/Minor findings)
- Task 5 verification: exact focused suite `169/169`; four production modules passed `node --check`; `git diff --check` passed; independent matrices passed 942 metadata fields, 28 URLs, 6 DOIs, 13 legitimate scholarly-punctuation round trips, and the 40-test marker/transaction subset.
- Task 5 boundary: direct exclusive final creation of `metadata.yaml` plus SHA-256-bound `.metadata.commit`; scanner admits only complete matching pairs and keeps archive identity private. All tests used temporary roots; no live build, archive, paper, note, server, port, `audits/`, or `tmp/` mutation occurred.
- Task 5 non-blocking boundary: portable Node lacks an `openat`-style directory capability; uncertain incomplete recovery material is never path-deleted and remains unscannable until manually resolved.
- Task 6: complete (commits `f92e4a1..a3d0490`; one fix loop; final scoped independent review PASS with 0 Critical/Important/Minor findings)
- Task 6 Ruling: “do not restore legacy CLI injection” applies to `build-private-library.mjs` public `main`, while the already-reviewed Task 9 dependency-injection parameters inside `loadPrivateLibraryContext` remain for temporary-root tests; Task 6 adds only `loadInstitution` to that runtime context and does not expose loader/build injection through the CLI — removing the existing runtime test seam would contradict the accepted Task 9 contract, while adding it to the CLI would broaden production authority — if wrong, the cost is a later small runtime-signature refactor rather than data migration.
- Task 6 verification: controller rerun passed `118/118`; discovery/build/runtime/build-CLI syntax checks and `git diff --check` passed. The fix round proves all three visible sorts, ArrowLeft/ArrowRight/Home/End roving tabs, a real temporary-root rebuild with discovery assets and validated NUIST descriptor, private-path absence, and the corrected two-page baseline.
- Task 6 boundary: Chinese desktop discovery and explicit CARSI two-step guidance were added without login embedding, background download, hidden redirect, real network access, generated-output write, service/port change, archive write, or real-paper mutation. Real configured build and 1280/1440 browser acceptance remain intentionally deferred to Task 14.
- Task 6 visual follow-up for Task 14: verify 1280x720 sidebar-plan overlap, long provider/URL wrapping, actual navigation paths, focus rings and horizontal overflow; the static/DOM suites do not substitute for this viewport evidence.
