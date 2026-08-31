# Task 5 implementation report

## Revision and scope

- Base: `7977b5de3af2abd25d8b8390cac136a5406e4a35`.
- Code head: `0ffdbff7fb4c79ea59404436bb1b0cd2dfba5269` (`feat: support metadata-only paper archives`).
- Code commit contains exactly the ten Task 5 public files. No status enum, dependency, package list, UI, server, generated library, private configuration, real paper, note, audit, or temporary-worktree file was staged.
- Pre-existing untracked `audits/` and `tmp/` remained untracked and untouched.

## RED evidence

1. `node --test exporter/paper-library/archive-metadata.test.mjs`
   - RED with `ERR_MODULE_NOT_FOUND` for `archive-metadata.mjs`.
2. `node --test exporter/paper-library/config.test.mjs`
   - RED with three expected failures: missing explicit `archive_source_id`, absent-source inference contract, and invalid source values not rejected.
3. Metadata-only scanner/build pattern run
   - Initial RED had five expected failures because metadata packages were not scanned.
   - After adding the prioritized safety cases, RED had nine expected failures covering fixed-size/no-follow/UTF-8 reads, internal symlinks, later artifact evolution, conflict/shadow behavior, source mismatch, composite duplicates, and private/public separation.
4. Archive metadata P1 regression tests
   - Five expected failures exposed permissive DOI, URL, exact-object, per-field limit, and Unicode handling before the parser/serializer was tightened.
5. `node --test exporter/paper-library/candidate-archive.test.mjs`
   - RED with `ERR_MODULE_NOT_FOUND` for `candidate-archive.mjs`.

## GREEN evidence

- Archive metadata focused suite: 12/12 passed after strict DOI, public HTTPS, descriptor-only exact-object, field-limit, and Unicode checks.
- Scanner/build metadata pattern suite: 19/19 passed.
- Candidate archive focused suite: 9/9 passed.
- Full pre-candidate archive/config/scanner/build regression: 136/136 passed.
- Exact required Task 5 focused suite:

  ```text
  node --test exporter/paper-library/archive-metadata.test.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/config.test.mjs exporter/paper-library/scanner.test.mjs exporter/paper-library/build.test.mjs
  tests 145; pass 145; fail 0; exit 0
  ```

- All four required `node --check` commands exited 0.
- Both the staged diff check and `git diff --check 7977b5d..HEAD` exited 0.

## Temporary-root and write-transaction evidence

- Every scanner, builder, and archive transaction test uses a fresh `mkdtemp(tmpdir())` root.
- No configured real library build, server, browser, network request, download, PDF/OCR/note creation, or real archive mutation was run.
- The transaction validates the exact request and configured source before mutation, canonicalizes an ordinary non-symlink root, rejects existing destinations, creates one package directory, opens a same-directory temporary file with exclusive and no-follow flags, fingerprints owned nodes, verifies the final target is absent, and then renames.
- Failure tests cover write failure, rename failure, destination appearance, unavailable no-follow support, oversized metadata, and injected temporary symlinks. Cleanup removes only fingerprint-matching transaction-owned nodes and preserves unowned bytes and paths.

## Config, scanner, and wire boundaries

- `archive_source_id` is optional. Absence returns `null` and disables candidate archiving without disabling scan/build/browse; no single-source inference occurs.
- A present value must be a strict source ID matching exactly one configured source.
- Scanner accepts only a direct non-symlink `metadata.yaml`, uses the 8,000-byte no-follow/fingerprint boundary, rejects invalid UTF-8, and excludes metadata from artifacts, source documents, and previews.
- Metadata-only records retain the existing public `source_id` and `relative_path`, keep conservative formal states, and can later gain PDF/note artifacts without changing `paper_id`.
- Archive-only fields are consumed before generic frontmatter processing. Existing catalog/override/frontmatter conflict and shadow rules remain active.
- One composite identity form, `openalex:W...`, drives private audit lookup, scanner duplicates, existing-record checks, and archive requests even when DOI is absent, added, or changed.
- Private audit may contain `archive_identity_lookup` and blocking `duplicate_archive_source_ids`. Public paper records do not gain `archive_source_id`, `candidate_source`, independent `openalex_id`, archive lookup, absolute paths, or other private locator fields. DOI-less metadata uses the existing `doi_or_url` field with the canonical OpenAlex landing URL.

## Donor and privacy evidence

- The `aa09` candidate archive module and test were read-only references. Their status was the same two untracked files before and after Task 5; no donor build, format, stage, commit, or service action occurred.
- Scope review showed exactly ten code files between base and code head.
- Changed-source privacy scans found no full private path, credential value, caller-provided filesystem path, or complete sensitive sentinel literal. Generated-data path strings occur only as existing relative test-output contracts under temporary repository fixtures.

## Residual risks

- Node's portable filesystem API does not expose `renameat2(RENAME_NOREPLACE)` or `openat` directory capabilities. The implementation uses exclusive temporary creation, repeated absence/identity checks, same-directory rename, post-rename fingerprint verification, and ownership-safe cleanup, but a hostile process could still act in the final check-to-rename nanowindow. The later process-wide single-writer layer reduces in-application concurrency but cannot eliminate an external filesystem adversary.
- Parent-directory component swaps cannot be proven atomically without an `openat`-style API. Tests cover the injectable path/fingerprint races available through the current Node interface; this task did not add a native dependency or external command.
- Live configured build, browser acceptance, and cutover remain intentionally deferred to the governing later tasks.
