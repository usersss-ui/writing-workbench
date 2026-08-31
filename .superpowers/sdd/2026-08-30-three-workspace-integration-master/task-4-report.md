# Task 4 Implementation Report

## Status

- Status: complete for the isolated, non-runtime scope authorized by master-plan Task 4.
- The four literature-discovery primitives and the public institution descriptor were implemented with strict test-first RED -> GREEN work.
- No Task 5/6 UI integration, archive mutation, generated output, package change, browser acceptance, build, service, port, or live-network work was performed.
- Pre-existing untracked `audits/` and `tmp/` remain untouched and uncommitted.

## Base and implementation head

- Base: `4edf23cd54cac7b7b614fb585b5825bfa4830d4b`
- Verified implementation head before this report-only commit: `63059c72eda0259a1d23c1236e7120384baaa09a`
- Branch: `codex/three-workspace-integration`
- Implementation commit: `63059c7 feat: add bounded literature discovery primitives`

## Exact implementation file boundary

- `prototype/desktop/openalex-search.mjs`
- `prototype/desktop/openalex-search.test.mjs`
- `prototype/desktop/candidate-storage.mjs`
- `prototype/desktop/candidate-storage.test.mjs`
- `prototype/desktop/institution-access.mjs`
- `prototype/desktop/institution-access.test.mjs`
- `exporter/paper-library/institution-config.mjs`
- `exporter/paper-library/institution-config.test.mjs`
- `exporter/config/institutions/nuist.json`

The implementation commit contains exactly these nine files. No existing runtime, UI, build, package, archive, server, Agent, migration, or E2E file was changed.

## Donor review and TDD evidence

- The matching nine reference files in the donor worktree named by the Task 4 brief were read and reviewed.
- The donor remained reference-only: no edit, format, stage, commit, build, test, or service command was run there.
- The four test files were created first with patches. No production module or public descriptor existed at the initial test run.
- Initial RED command:

```text
node --test prototype/desktop/openalex-search.test.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/institution-access.test.mjs exporter/paper-library/institution-config.test.mjs
```

- Initial RED result: exit 1; 0 passed and 4 failed. Each file-level failure was `ERR_MODULE_NOT_FOUND`, covering the four missing production modules.
- After the minimal production modules and descriptor were added, the same focused command was iterated to GREEN.
- A later semantic-hostname regression test intentionally produced a second RED: 53 passed and 4 failed because public single-label hostnames were still accepted in each boundary. One shared conservative rule was then applied within the existing four-module file boundary.
- Final focused GREEN result: exit 0; 57 passed and 0 failed.

## Implemented contracts

### OpenAlex request and response boundary

- Uses the fixed official works endpoint, injected fetch only, GET, omitted browser credentials, no referrer, redirect rejection, and caller-supplied abort signal.
- Preserves the validated English expression exactly, applies an exact five-year publication window, excludes retracted works, and caps valid result requests at ten.
- Exposes exactly relevance, newest, and cited-count sort modes together with the active sort basis.
- Rejects malformed request values and strictly bounds response envelopes and nested work fields.
- Normalized results retain only the documented candidate fields; unsafe or non-public result links are omitted.
- Zero results use the bounded statement `当前英文检索式未返回结果。` and make no claim that a research direction or paper is absent.
- Injected-fake tests cover success, zero results, rate limiting, other HTTP failures, network failure, malformed payloads, and cancellation. No live request was issued.

### Candidate persistence boundary

- Uses the required versioned browser storage key, a 100-candidate limit, an exact 13-field candidate shape, provider-qualified external identity, DOI/ID deduplication, and defensive clones.
- Pending, confirmed, metadata-archived, move-back, and removal transitions are persistent and idempotent.
- Every mutation reloads and compares the latest persistent snapshot. Known stale-tab state is rejected rather than overwriting a newer write.
- Persistence failure never advances a confirmed/archive stage and never pretends removal succeeded; the prior persisted observable state is restored.
- The maximum accepted 100-item state was proven to survive an exact storage round trip.

### Institution descriptor and access boundary

- The checked-in descriptor is public descriptive data only and contains six bounded provider records.
- Configuration validation rejects unknown fields, recursive secret-like keys, ambiguous provider host suffixes, malformed DOI prefixes, unsafe URLs/hosts, inconsistent CARSI flags, excessive strings/arrays/provider counts, and oversized serialized input.
- DOI, external URL, and paper-input parsing are deterministic and fail closed for traversal, control characters, local paths, private hosts, other path-like forms, URL user information, and credential-like query parameters.
- Provider detection follows explicit, DOI-prefix, then configured-host precedence and reports conflicts. Access resolution emits validated public links and explanations only; it performs no login and stores no credential.

## Donor conflict resolved by master-plan authority

The donor test expected stage changes and removals to remain visible in memory after a browser-storage write failure. Master section 6.3 requires the opposite: a failed persistence operation must not advance a stage or pretend an item was removed. The master plan therefore overrides the donor behavior. Tests and implementation now roll those mutations back and return a non-persisted failure outcome.

## Verification

- Focused Task 4 suite: 57 passed, 0 failed.
- `node --check` passed for all four production modules.
- `git diff --check` passed before the implementation commit.
- Cached-path review before commit listed exactly the nine authorized implementation files.
- Targeted forbidden-literal scan across the nine implementation files returned zero matches after sensitive test sentinels were constructed from harmless fragments at runtime.
- The checked-in institution descriptor is loaded directly by its test and scanned as serialized public data.

## Privacy and operational boundary

- No credential value, private path, account, cookie, token, raw provider response, or local archive content is stored by these primitives or present in the public descriptor.
- No live network, login, browser, server, port, build, generated-library, archive, or real-paper operation occurred.
- No new dependency or package configuration was introduced.
- Pre-existing untracked `audits/` and `tmp/` were not read for task logic, modified, staged, or committed.

## Deferred Task 6 integration risks

- Task 6 still owns visible page wiring, display of the active sort and zero-result state, browser interaction, and public config delivery through the existing application boundary.
- Browser storage has no true compare-and-swap primitive. Reload-and-compare prevents known stale writes, but an unavoidable same-tick race remains if two tabs mutate between the final comparison and write.
- Syntactic public-host validation cannot eliminate DNS rebinding without performing a network/DNS check; this task intentionally performed no such lookup.
- Generated output, configured build closure, real browser acceptance, screenshots, and archive-entry integration remain deferred to the later integration tasks.

## Security-review fix loop

### Status and fix head

- Independent review found a shared URL-normalization bypass class, incomplete Windows-style path rejection, missing raw OpenAlex nested-field limits, and an ambiguous storage status after a failed write.
- Fix implementation head before this report-update commit: `cdb522bd11974bb0396c6e51676d5050f34b6a26` (`fix: harden literature discovery boundaries`).
- The fix changes only the same four production modules and their four tests; the public descriptor and all other files remain unchanged.

### Additional RED evidence

- Fragment, punctuation-obfuscated query-key, path, and nested-response probes: the focused suite exited 1 with 50 passed and 7 failed. The failures occurred at the institution config, persisted-candidate recovery, candidate add, external URL, title/path, OpenAlex URL, and OpenAlex nested-response boundaries.
- Raw control-character and DOI backslash probes: the focused suite exited 1 with 53 passed and 4 failed, proving that the URL parser was canonicalizing unsafe raw inputs before validation.
- Broader secret-like key categories and raw OpenAlex string limits: the focused suite exited 1 with 51 passed and 6 failed.
- Targeted DOI-response probe: 0 passed and 1 failed because a raw trailing separator was cleaned into an accepted DOI.
- Targeted storage-status probe: 0 passed and 1 failed because a failed browser-storage write still reported `ready`.
- Targeted generic Windows-path, obvious local-document name, raw title separator, and ordinary public-query metadata probes each failed before its corresponding implementation change.

### Fixes

- Every public external link now rejects fragments, URL user information, raw backslashes, raw control/line-separator characters, non-public hosts, and secret-like query-key categories after lowercase alphanumeric normalization.
- The query-key classifier remains bounded and does not reject ordinary citation or conference-session metadata; the checked-in public federation-routing URL continues to validate.
- DOI parsing rejects raw control characters and backslashes before trimming or URL parsing.
- Paper-input parsing rejects generic Windows-style relative paths and obvious local document filenames while retaining ordinary scholarly titles that contain a slash.
- OpenAlex validation now bounds raw ID, DOI, title, author, source, topic, and all selected URL strings before cleanup; abstract entry count, per-entry positions, and total raw positions are bounded before reconstruction.
- Failed browser-storage writes now report `unavailable`; a successful subsequent reload/write returns the store to `ready`. Stage and removal rollback behavior is unchanged.

### Final verification after review fixes

- Exact focused suite: exit 0; 59 passed and 0 failed.
- `node --check` passed for all four production modules.
- `git diff --check` passed before the fix commit.
- Targeted forbidden-literal scan across the nine implementation files and this report returned zero matches.
- No live network, browser, service, port, build, generated output, archive, or real-paper operation was introduced during the fix loop.

## Repeated-encoding security fix loop

### Status and RED evidence

- A second independent review found that credential-like query keys hidden behind repeated percent encoding could survive the URL parser's first decode and then pass the four URL boundaries.
- The failing focused run had 63 tests: 56 passed and 7 failed. Failures covered institution configuration, external-link normalization, persisted candidate recovery, candidate add validation, the fake OpenAlex response boundary, the fake OpenAlex-to-candidate persistence chain, and an abusive abstract-position value.
- Fix implementation head before this report-update commit: `872a3a123cef8510ab06e7092355edd4e313514b` (`fix: reject encoded discovery credentials`).

### Fixes and final verification

- Query keys now pass through a bounded recursive percent-decoding step before classification. Invalid decoding, decoded control characters, excessive key length, or a still-encoded escape after the fixed decode budget fail closed.
- The same rule is exercised at institution configuration, external article input, OpenAlex result normalization, candidate add, and persisted candidate reload boundaries, including double, triple, and beyond-budget encodings.
- A no-network integration test proves that a malicious fake OpenAlex link is sanitized before the exact candidate shape is written and that the marker does not reach browser storage.
- Candidate OpenAlex identifiers now use the same 100-character bound as the OpenAlex response normalizer.
- OpenAlex rejects oversized raw abstract-position strings and non-integer numeric positions before reconstruction while retaining the documented conservative handling of short optional malformed text.
- Final exact focused suite: exit 0; 63 passed and 0 failed.
- `node --check` passed for all four production modules, `git diff --check` passed, and the targeted forbidden-literal scan over the nine public files plus this report returned zero matches.
- The existing privacy and operational boundary remains unchanged: no live network, browser, service, port, build, generated output, archive, or real-paper operation occurred.
