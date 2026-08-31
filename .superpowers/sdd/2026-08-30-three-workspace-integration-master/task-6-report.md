# Task 6 report — desktop literature discovery

## Revision boundary

- Review BASE: `f92e4a1165b69ac96c1252ad32baa452f92cc6b3`
- Implementation HEAD: `020f55dc19385330bff190b9e57a19d59ec91f2d`
- Implementation commit: `feat: add desktop literature discovery page`

## TDD evidence

RED was recorded with the brief command before the production page existed:

```text
node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/desktop-pages.test.mjs
ERR_MODULE_NOT_FOUND: prototype/desktop/discovery.mjs
```

The same RED run also showed the new navigation assertion failing because the discovery route was absent. The failure was due to the missing feature, not a test harness error.

GREEN was re-run after implementation:

```text
node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs
48 passed, 0 failed

node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/desktop-pages.test.mjs exporter/paper-library/build.test.mjs exporter/paper-library/runtime.test.mjs exporter/paper-library/institution-config.test.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/openalex-search.test.mjs prototype/desktop/institution-access.test.mjs
115 passed, 0 failed
```

`node --check` passed for `discovery.mjs`, `build.mjs`, `runtime.mjs`, and the unchanged build CLI. `git diff --check` also passed. No real configured build, real-paper mutation, generated-output write, service, or port was used.

## Delivered boundary

- New Chinese desktop discovery template and controller: editable English query, three visible sort choices, OpenAlex result staging, persisted candidate states, and keyboard-reachable discovery/access tabs.
- Known-paper flow gives an explicit provider/open-access clue followed by NUIST/CARSI or library links and a copyable locator. It displays provider conflicts and does not embed logins, forward cookies, download in the background, or hide navigation.
- Candidate copy states that archive confirmation is **metadata pending verification**, never an existing PDF or reading note.
- Builder uses a resource union: current library, KaTeX, preview, catalog/tag and personal-tag assets remain, and it adds `discovery.html`, the four approved browser modules, and validated `assets/nuist.institution.json`.
- Runtime retains its existing test injection seams, adds only `loadInstitution = loadInstitutionConfig`, returns validated institution context, and forwards it to the builder. CLI injection was not expanded.
- Navigation was changed only in the four allowed existing HTML templates. Source pages point to the generated discovery route; generated discovery and library pages use same-directory links.

## File boundary audit

Only the Task 6 listed production/test/navigation/style files were committed. The required SDD report is committed separately after this file. `progress.md`, `audits/`, and `tmp/` were observed as controller/ignored state and were neither edited nor staged by this task.

## Risks / follow-up

- The checked-in public institution descriptor is validated during runtime loading and again by the builder before emission. The browser reads only that fixed same-origin public asset; it performs a small shape check because the browser bundle intentionally remains limited to the four approved modules.
- Real local-config builds and visual/browser acceptance are intentionally deferred by the master plan; temporary-root build tests cover generated discovery output and the public institution asset.
