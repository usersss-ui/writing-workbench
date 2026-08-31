# Task 5 implementation report

## Revision and scope

- Base: `7977b5de3af2abd25d8b8390cac136a5406e4a35`.
- Initial feature commit: `0ffdbff7fb4c79ea59404436bb1b0cd2dfba5269` (`feat: support metadata-only paper archives`).
- Integrity fix commit: `caab2b84b242223b7a9747834c6b1702341b7793` (`fix: harden metadata-only archive integrity`).
- The feature commit contains the ten Task 5 public files. The fix commit changes only seven of those authorized files.
- No status enum, dependency, package list, UI, server, generated library, private configuration, real paper, note, audit, or temporary-worktree file was staged.
- Pre-existing untracked `audits/` and `tmp/` remained untracked and untouched.

## RED evidence

1. `archive-metadata.test.mjs` initially failed because the module did not exist.
2. `config.test.mjs` exposed the missing explicit `archive_source_id` contract, forbidden single-source inference, and invalid values not being rejected.
3. Scanner/build tests initially failed because metadata-only packages were not recognized conservatively.
4. Candidate-archive tests initially failed because the transaction module did not exist.
5. Independent review loops added focused regressions for path and credential leakage, Unicode controls, DOI/OpenAlex normalization, source-root aliases, link identity, ambiguous write completion, and metadata/commit-marker binding before the implementation was accepted.

## Final GREEN evidence

The exact Task 5 suite passed on the committed implementation:

```text
node --test exporter/paper-library/archive-metadata.test.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/config.test.mjs exporter/paper-library/scanner.test.mjs exporter/paper-library/build.test.mjs
tests 169; pass 169; fail 0; exit 0
```

- All four production modules passed `node --check`.
- `git diff --check` passed.
- Independent quality/privacy review additionally passed a 942-case metadata field matrix, 28 URL cases, 6 DOI cases, 13 legitimate scholarly-punctuation round trips, and a 40-test marker/transaction subset.

## Metadata-only commit protocol

- The transaction validates the exact request and the configured archive source before mutation.
- It canonicalizes one ordinary non-symlink source root and records root/package identity checks.
- `metadata.yaml` is created directly at its final name with exclusive, no-follow flags. It is written, synchronized, stat-checked, reopened when necessary, byte-compared, and SHA-256 checked without a rename or writable alias.
- Only after the metadata proof succeeds is `.metadata.commit` created exclusively. The marker contains `sha256:<64 lowercase hex>` and binds the exact metadata bytes.
- The marker is the internal commit point. Ambiguous completion is accepted only after the implementation re-proves the metadata and marker identities, sizes, hashes, link counts, package identity, and source-root identity together.
- The transaction never path-deletes an uncertain file or replacement. A failed or interrupted attempt can therefore leave recovery material, but it cannot become a valid paper record without a matching commit marker.

## Scanner, identity, and public/private boundaries

- Scanner accepts a metadata-only package only when `metadata.yaml` and `.metadata.commit` are direct regular files, non-symlinks, single-linked, within fixed byte limits, and the marker hash matches the exact metadata bytes.
- Missing, malformed, aliased, or mismatched marker/metadata pairs are blocked and audited; neither internal file becomes an ordinary artifact or public field.
- The package directory basename must equal `paper_id`; `archive_source_id` must match the configured source.
- Metadata-only records remain conservative: they do not claim a PDF, reading note, evidence card, reproduction, convergence proof, or verified source.
- One provider-qualified identity form drives duplicate checks. DOI and OpenAlex values are normalized without guessing equality from local IDs.
- Archive-only lookup details stay in the private audit. The public index receives no archive source ID, candidate source, independent OpenAlex ID, absolute path, credential, or private locator.
- Bibliographic text rejects path/credential/control-character leakage, including repeated percent encoding and Unicode formatting controls, while legitimate scholarly punctuation such as `R&D`, `C*`, `[]`, `{}`, and `O(1/T)` round-trips exactly.

## Temporary-root and non-mutation evidence

- Every positive and negative archive/scanner/build test uses a fresh temporary root.
- No configured real library build, server, browser, network request, download, PDF/OCR/note creation, or real archive mutation was run.
- Donor modules were read-only references; no donor build, format, stage, commit, or service action occurred.

## Residual risks and recovery boundary

- Portable Node filesystem APIs do not provide an `openat`-style directory capability. Repeated canonical-root, parent, inode, link-count, size, byte, and hash proofs reduce but cannot mathematically remove the final pathname observation window against a hostile external filesystem actor.
- A failure after exclusive creation deliberately leaves uncertain recovery material instead of deleting by pathname. The scanner rejects it unless the matching marker and metadata proofs are complete; manual recovery may be required.
- Live configured build, browser acceptance, archive UI wiring, and service cutover remain intentionally deferred to later master-plan tasks.
