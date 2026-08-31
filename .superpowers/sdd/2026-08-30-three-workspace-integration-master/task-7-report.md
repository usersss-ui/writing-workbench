# Task 7 report — fixed research task input snapshots

## Revision boundary

- Review BASE: `8bc210bc56a8b4ff6c4d7be1509f17eede5120f7`
- Implementation HEAD: `5d662f17c32eccd9cafadb913cf542a6f36ff4d8`
- Implementation commit: `feat: add fixed research task input snapshots`

## TDD evidence

The Task 7 modules were introduced through focused RED → GREEN cycles:

- `direction-snapshot.test.mjs`: initial module absence was RED (`0/3`), then the strict ten-axis snapshot/store contract passed (`3/3`). A later behavior-level save-wiring test failed because `createDirectionSaveController` did not exist, then passed after both visible buttons were wired to one explicit save action.
- `agent-task-input.test.mjs`: initial module absence was RED (`0/6`), then the minimal preview, fixed snapshot, append-only transaction, corruption and selection contracts passed (`6/6`). Follow-up RED tests exposed root-cache and pending-cleanup behavior (`0/2`) and were made GREEN without weakening validation.
- `agent-tasks.test.mjs`: initial page/session module absence was RED (`0/4`), then explicit confirmation, newest-first view, source-change warning, canonical loader and no-executor boundaries passed (`4/4`).
- Page navigation was RED because the five source surfaces lacked the task route; the focused assertion became GREEN after the bounded navigation edits.
- The focused builder test was RED with `ENOENT` for `assets/direction-snapshot.mjs`; it became GREEN after adding exactly the two approved browser assets.
- The v3/v2 wire-to-schema mismatch test was RED until input validation required only `3/2` and legacy `2/1`; wire v1 remains rejected.

Final required verification:

```text
node --test prototype/desktop/direction-snapshot.test.mjs prototype/desktop/agent-task-input.test.mjs prototype/desktop/agent-tasks.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
60 passed, 0 failed

node --check prototype/desktop/direction-snapshot.mjs
node --check prototype/desktop/agent-task-input.mjs
node --check prototype/desktop/agent-tasks.mjs
all exit 0

git diff --cached --check
exit 0, no output
```

## Delivered boundary

- Direction selection now has a strict P02 snapshot with all ten axes. Nothing is stored while filtering; either visible save button invokes the same explicit action. The page shows the durable `saved_at` time and saved axes, while an empty selection cannot overwrite the previous snapshot.
- The new Chinese desktop `研究任务输入` page reads only the saved direction plus the read-only P02 shelf. Its preview and fixed snapshots retain only canonical shelf roles, minimal bibliography/status fields, and an always-empty `note_fragment_refs` array.
- Paper data is loaded only through `loadPaperIndex` from `library.mjs`. The task boundary accepts canonical wire/schema pairs `3/2` and `2/1` and rejects v1.
- Snapshot persistence uses validated root, independent current, committed snapshot and pending records. History is internally append order, rendered newest-first without mutating the store, and old snapshots remain immutable when sources change. Selecting a historical current re-reads the complete durable transaction and fails closed on unknown, corrupt or failed writes.
- No executor, model request, fetch route, generated conclusion, revision, candidate or export workflow was added. Snapshots exclude note bodies, private paths, personal tags, discovery candidates, access history and credentials.
- Existing Task 6 discovery/runtime behavior remains intact. Navigation points prototype pages to `./agent-tasks.html` and generated library/discovery surfaces to `../../prototype/desktop/agent-tasks.html`.
- The builder copies only `direction-snapshot.mjs` and `agent-task-input.mjs` as new approved assets. `agent-tasks.html` remains prototype-only, so generated-page accounting is unchanged.

## File boundary audit

The implementation commit contains only the 17 Task 7 production, test, template and navigation files. `progress.md`, `audits/`, `tmp/`, generated/live outputs, real papers, ports and donor files were not edited or staged.

## Risks / follow-up

- This task deliberately stops at a read-only input snapshot page. Connecting any model, executor or research-analysis workflow requires a later separately reviewed task.
- Browser-local storage can be unavailable or externally corrupted; saves fail closed and the UI reports that no snapshot was stored. The required suite covers durable transaction fallbacks, but real-paper builds and browser visual acceptance remain outside Task 7's bounded test plan.

## Fix round 1 — transaction truthfulness and boundary hardening

- Review fix implementation: `915c944a3171469a2b3a07cca663edea7272ac55` (`fix: harden research snapshot transactions`).
- Strict-object RED tests first exposed acceptance of custom prototypes, symbol keys, non-enumerable properties and accessors in both direction and task-input snapshots. Both validators now require an ordinary exact-key data object.
- Credential RED tests first returned `ready` for authorization headers, OAuth-style access/refresh/ID tokens, client secrets, private-key material and URL user information. The fixed allowlist boundary now rejects all of them; test fixtures assemble sensitive patterns from fragments.
- History RED first showed append order instead of time order. The read-only history view now sorts by `created_at` descending with `snapshot_id` as a deterministic tie-break, without reversing or mutating stored arrays; old snapshot bytes remain unchanged after source refresh.
- The initial transaction fault-injection group was RED (`0/6`) for pending/current/committed write-then-throw, throw-before retry, guarded reads, root-cache faults, post-write revalidation and rollback failure. A further committed-write plus two failed reads case was RED (`0/1`), as was an unresolved current-write case that had to preserve its recoverable pending record (`0/1`). All became GREEN after independent `.snapshot.*` and `.current` records became the proven authority and root became only a rebuildable cache.
- A stale non-current pending record can now resume the same snapshot ID. A failed append exposes neither a logical new history entry nor a new current snapshot; a write that actually committed despite throwing is reconciled and reported as success. Root-only data without matching independent snapshot/current records is rejected.
- The no-executor proof now scans runtime JavaScript as well as HTML. Initialization is behaviorally verified to issue exactly one canonical paper-index request through `loadPaperIndex` from `./library.mjs`, with no model, agent, health or task route.

Final fix-round verification (this supersedes the earlier `60 passed` count):

```text
node --test prototype/desktop/direction-snapshot.test.mjs prototype/desktop/agent-task-input.test.mjs prototype/desktop/agent-tasks.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
73 passed, 0 failed

node --check prototype/desktop/direction-snapshot.mjs
node --check prototype/desktop/direction-snapshot.test.mjs
node --check prototype/desktop/agent-task-input.mjs
node --check prototype/desktop/agent-task-input.test.mjs
node --check prototype/desktop/agent-tasks.mjs
node --check prototype/desktop/agent-tasks.test.mjs
all exit 0

git diff --cached --check
exit 0, no output
```

### Known deferred

- The current GitHub package dependency audit remains incomplete until Task 13 performs the explicitly planned manifest/resource union. Task 7 does not modify package manifests and does not claim the current package closure is complete.

## Fix round 2 — cross-tab pending recovery and credential variants

- Review fix implementation: `5045170dc6d349385fe33643b2bcdf942d525e8a` (`fix: preserve cross-tab snapshot fallback`).
- The credential extension test was RED (`0/1`): a Digest authorization value produced `ready` instead of `unsafe_metadata`. The same fragmented-fixture test now proves rejection of arbitrary authorization schemes, `oauth_token` and generic `token` assignments, plus scheme-qualified username-only URL user information. Ordinary academic prose containing the word `token` remains accepted.
- The shared-storage A/P/B regression test was RED (`0/1`): after A left `pending(previous=P)`, another store committed B, and A failed again, the logical current incorrectly resolved to P rather than B. Retrying an existing pending snapshot now refreshes its fallback from the durable pointer before changing current. If raw current already equals A, the validated logical current is retained so an A-to-A pending cycle cannot be created.
- Fault-injection coverage verifies pending-refresh writes that throw before or after mutation, unavailable post-write reads, recovery under the same snapshot ID, and a separately reopened store observing B after the failed retry. Pending refresh is proven before current changes, so an unproven refresh returns `false` while B remains durable and logical.
- Correction to the fix-round-1 wording: a failed append already hid its uncommitted candidate, but before this round an old pending fallback could still regress the logical current from a newer cross-tab B to the older P. The stronger cross-tab statement is valid only with the refresh behavior added here.
- Clarification to the original delivered-boundary wording: “no fetch route” means no executor, model, agent, health or task route. The one canonical read-only paper-index request through `loadPaperIndex` remains intentional and tested.

Final fix-round-2 verification:

```text
node --test prototype/desktop/direction-snapshot.test.mjs prototype/desktop/agent-task-input.test.mjs prototype/desktop/agent-tasks.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
77 passed, 0 failed

node --check prototype/desktop/agent-task-input.mjs
node --check prototype/desktop/agent-task-input.test.mjs
both exit 0

git diff --cached --check
exit 0, no output
```

- This round changes only `agent-task-input.mjs` and its focused test. Package manifests remain untouched, and the Task 13 package-closure deferral above remains in force.
