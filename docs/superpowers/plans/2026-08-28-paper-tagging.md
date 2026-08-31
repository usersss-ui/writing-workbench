# Paper Tagging Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-08-28-paper-tagging-design.md`

## Global Constraints

- Preserve every source PDF/Markdown/code/result file and its path.
- Never infer a research direction from the legacy folder name.
- Use stable `paper_id` as the tag join key.
- Keep theory tags empty unless a title, catalog tag, existing note/knowledge entry, or checked PDF explicitly supports them.
- Generated public data must not contain absolute private paths.

### Task 1: Add the tag-catalog contract

**Files:**
- Create: `exporter/paper-library/tag-catalog.mjs`
- Create: `exporter/paper-library/tag-catalog.test.mjs`
- Modify: `exporter/scripts/build-private-library.mjs`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`

Write failing tests for validation, stable-ID merging, missing/unmatched tag audit, and CLI loading. Implement the smallest loader and merger that makes those tests pass.

### Task 2: Extend the generated-record schema and desktop model

**Files:**
- Modify: `exporter/paper-library/status.mjs`
- Modify: `exporter/paper-library/overrides.mjs`
- Modify: `exporter/paper-library/frontmatter.mjs`
- Modify: `exporter/paper-library/*.test.mjs`
- Modify: `prototype/desktop/paper-library-model.mjs`
- Modify: `prototype/desktop/paper-library-model.test.mjs`
- Modify: `prototype/desktop/library.mjs`
- Modify: `prototype/desktop/paper-inspector.mjs`
- Modify: `exporter/verification/private_library_e2e.py`

Add `property_tags` and `theory_tags` to validation, serialization, search, filters, detail metadata, and private-library verification. Tests must fail before production changes.

### Task 3: Tag all current papers

**Files:**
- Create: `local_library_config/paper-tags.json`
- Create: `audits/paper-tagging-report.md`
- Modify: `local_library_config/paper-overrides.json` only if thesis hierarchy needs metadata not expressible by stable ID tags.

Populate all 49 included `paper_id` records with controlled Chinese tags. Record evidence basis and explicitly list axes left empty. Do not assign contribution role or P02 relevance without a separate review.

### Task 4: Rebuild and verify

Run the focused Node tests first, then the complete exporter/prototype suite, rebuild the private library, run the Python E2E audit, and visually inspect the desktop filters and one tagged paper detail at 1440px-equivalent viewport.
