import test from "node:test"
import assert from "node:assert/strict"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join, posix } from "node:path"
import { tmpdir } from "node:os"
import {
  EXPECTED_PACKAGE_FILES,
  PACKAGE_SIZE_LIMIT_BYTES,
  PackageBoundaryError,
  auditPackageCandidates,
  auditPackageDependencyClosure,
  collectPackageCandidates,
} from "./package-audit.mjs"
import { main as auditCliMain } from "../scripts/audit-github-package.mjs"

const EXPECTED_FILES = [
  ".gitignore",
  "README.md",
  "exporter/config/github-package-files.json",
  "exporter/config/institutions/nuist.json",
  "exporter/config/library.example.json",
  "exporter/paper-library/archive-metadata.mjs",
  "exporter/paper-library/archive-metadata.test.mjs",
  "exporter/paper-library/artifacts.mjs",
  "exporter/paper-library/build.mjs",
  "exporter/paper-library/build.test.mjs",
  "exporter/paper-library/candidate-archive-action.mjs",
  "exporter/paper-library/candidate-archive-action.test.mjs",
  "exporter/paper-library/candidate-archive.mjs",
  "exporter/paper-library/candidate-archive.test.mjs",
  "exporter/paper-library/catalog-adapter.mjs",
  "exporter/paper-library/catalog-adapter.test.mjs",
  "exporter/paper-library/config.mjs",
  "exporter/paper-library/config.test.mjs",
  "exporter/paper-library/facet-schema.mjs",
  "exporter/paper-library/frontmatter.mjs",
  "exporter/paper-library/ids.mjs",
  "exporter/paper-library/ids.test.mjs",
  "exporter/paper-library/institution-config.mjs",
  "exporter/paper-library/institution-config.test.mjs",
  "exporter/paper-library/local-server.mjs",
  "exporter/paper-library/local-server.test.mjs",
  "exporter/paper-library/note-import-transaction.test.mjs",
  "exporter/paper-library/note-import.mjs",
  "exporter/paper-library/note-import.test.mjs",
  "exporter/paper-library/note-preview.mjs",
  "exporter/paper-library/note-preview.test.mjs",
  "exporter/paper-library/overrides.mjs",
  "exporter/paper-library/package-audit.mjs",
  "exporter/paper-library/package-audit.test.mjs",
  "exporter/paper-library/paper-tag-migration.mjs",
  "exporter/paper-library/paper-tag-migration.test.mjs",
  "exporter/paper-library/runtime.mjs",
  "exporter/paper-library/runtime.test.mjs",
  "exporter/paper-library/scanner.mjs",
  "exporter/paper-library/scanner.test.mjs",
  "exporter/paper-library/status.mjs",
  "exporter/paper-library/status.test.mjs",
  "exporter/paper-library/tag-catalog.mjs",
  "exporter/paper-library/tag-catalog.test.mjs",
  "exporter/paper-library/write-coordinator.mjs",
  "exporter/paper-library/write-coordinator.test.mjs",
  "exporter/scripts/audit-github-package.mjs",
  "exporter/scripts/build-private-library.mjs",
  "exporter/scripts/migrate-paper-tags-v3.mjs",
  "exporter/scripts/serve-private-library.mjs",
  "exporter/scripts/serve-state-transfer.mjs",
  "exporter/scripts/serve-state-transfer.test.mjs",
  "prototype/desktop/README.md",
  "prototype/desktop/agent-task-input.mjs",
  "prototype/desktop/agent-task-input.test.mjs",
  "prototype/desktop/agent-tasks.css",
  "prototype/desktop/agent-tasks.html",
  "prototype/desktop/agent-tasks.mjs",
  "prototype/desktop/agent-tasks.test.mjs",
  "prototype/desktop/app.mjs",
  "prototype/desktop/candidate-storage.mjs",
  "prototype/desktop/candidate-storage.test.mjs",
  "prototype/desktop/desktop-pages.test.mjs",
  "prototype/desktop/direction-snapshot.mjs",
  "prototype/desktop/direction-snapshot.test.mjs",
  "prototype/desktop/directions.html",
  "prototype/desktop/directions.mjs",
  "prototype/desktop/discovery-dom.test.mjs",
  "prototype/desktop/discovery.mjs",
  "prototype/desktop/discovery.template.html",
  "prototype/desktop/index.html",
  "prototype/desktop/institution-access.mjs",
  "prototype/desktop/institution-access.test.mjs",
  "prototype/desktop/library.mjs",
  "prototype/desktop/library.template.html",
  "prototype/desktop/openalex-search.mjs",
  "prototype/desktop/openalex-search.test.mjs",
  "prototype/desktop/p02.html",
  "prototype/desktop/paper-filter.mjs",
  "prototype/desktop/paper-inspector.mjs",
  "prototype/desktop/paper-library-dom.test.mjs",
  "prototype/desktop/paper-library-model.mjs",
  "prototype/desktop/paper-library-model.test.mjs",
  "prototype/desktop/paper-library-storage.mjs",
  "prototype/desktop/paper-library-storage.test.mjs",
  "prototype/desktop/paper-math-renderer.mjs",
  "prototype/desktop/paper-math-renderer.test.mjs",
  "prototype/desktop/paper-user-tags.mjs",
  "prototype/desktop/paper-user-tags.test.mjs",
  "prototype/desktop/papers-data.mjs",
  "prototype/desktop/state-transfer-dom.test.mjs",
  "prototype/desktop/state-transfer.html",
  "prototype/desktop/state-transfer.mjs",
  "prototype/desktop/state-transfer.test.mjs",
  "prototype/desktop/styles.css",
  "prototype/desktop/vendor/katex/LICENSE",
  "prototype/desktop/vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Math-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Script-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size1-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size2-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size3-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size4-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "prototype/desktop/vendor/katex/katex.min.css",
  "prototype/desktop/vendor/katex/katex.mjs",
]

const TASK_13_NET_NEW_FILES = Object.freeze([
  "exporter/config/institutions/nuist.json",
  "exporter/paper-library/archive-metadata.mjs",
  "exporter/paper-library/archive-metadata.test.mjs",
  "exporter/paper-library/candidate-archive-action.mjs",
  "exporter/paper-library/candidate-archive-action.test.mjs",
  "exporter/paper-library/candidate-archive.mjs",
  "exporter/paper-library/candidate-archive.test.mjs",
  "exporter/paper-library/institution-config.mjs",
  "exporter/paper-library/institution-config.test.mjs",
  "exporter/paper-library/local-server.mjs",
  "exporter/paper-library/local-server.test.mjs",
  "exporter/paper-library/note-import-transaction.test.mjs",
  "exporter/paper-library/note-import.mjs",
  "exporter/paper-library/note-import.test.mjs",
  "exporter/paper-library/runtime.mjs",
  "exporter/paper-library/runtime.test.mjs",
  "exporter/paper-library/write-coordinator.mjs",
  "exporter/paper-library/write-coordinator.test.mjs",
  "exporter/scripts/serve-private-library.mjs",
  "exporter/scripts/serve-state-transfer.mjs",
  "exporter/scripts/serve-state-transfer.test.mjs",
  "prototype/desktop/agent-task-input.mjs",
  "prototype/desktop/agent-task-input.test.mjs",
  "prototype/desktop/agent-tasks.css",
  "prototype/desktop/agent-tasks.html",
  "prototype/desktop/agent-tasks.mjs",
  "prototype/desktop/agent-tasks.test.mjs",
  "prototype/desktop/candidate-storage.mjs",
  "prototype/desktop/candidate-storage.test.mjs",
  "prototype/desktop/desktop-pages.test.mjs",
  "prototype/desktop/direction-snapshot.mjs",
  "prototype/desktop/direction-snapshot.test.mjs",
  "prototype/desktop/discovery-dom.test.mjs",
  "prototype/desktop/discovery.mjs",
  "prototype/desktop/discovery.template.html",
  "prototype/desktop/institution-access.mjs",
  "prototype/desktop/institution-access.test.mjs",
  "prototype/desktop/openalex-search.mjs",
  "prototype/desktop/openalex-search.test.mjs",
  "prototype/desktop/state-transfer-dom.test.mjs",
  "prototype/desktop/state-transfer.html",
  "prototype/desktop/state-transfer.mjs",
  "prototype/desktop/state-transfer.test.mjs",
])

const TASK_14_DEFERRED_FILES = Object.freeze([
  "exporter/paper-library/unified-local-server.e2e.test.mjs",
  "exporter/verification/institution_access_e2e.py",
  "exporter/verification/integrated-server-fixture.mjs",
  "exporter/verification/integrated-server-fixture.test.mjs",
  "exporter/verification/private_library_e2e.py",
  "exporter/verification/workbench_integration_e2e.py",
])

const TASK_13_PRIVATE_SENTINEL_TEST_FILES = Object.freeze([
  "exporter/paper-library/note-import.test.mjs",
  "exporter/paper-library/write-coordinator.test.mjs",
  "exporter/scripts/serve-state-transfer.test.mjs",
  "prototype/desktop/discovery-dom.test.mjs",
  "prototype/desktop/state-transfer-dom.test.mjs",
])

const REGULAR_DESKTOP_ASSET_SOURCES = Object.freeze([
  "prototype/desktop/agent-task-input.mjs",
  "prototype/desktop/candidate-storage.mjs",
  "prototype/desktop/direction-snapshot.mjs",
  "prototype/desktop/discovery.mjs",
  "prototype/desktop/institution-access.mjs",
  "prototype/desktop/library.mjs",
  "prototype/desktop/openalex-search.mjs",
  "prototype/desktop/paper-inspector.mjs",
  "prototype/desktop/paper-library-model.mjs",
  "prototype/desktop/paper-library-storage.mjs",
  "prototype/desktop/paper-math-renderer.mjs",
  "prototype/desktop/paper-user-tags.mjs",
  "prototype/desktop/state-transfer.mjs",
  "prototype/desktop/styles.css",
])

const GENERATED_PAGE_CLOSURES = Object.freeze([
  Object.freeze({
    name: "library",
    template: "prototype/desktop/library.template.html",
    regular: Object.freeze([
      "prototype/desktop/candidate-storage.mjs",
      "prototype/desktop/library.mjs",
      "prototype/desktop/paper-inspector.mjs",
      "prototype/desktop/paper-library-model.mjs",
      "prototype/desktop/paper-library-storage.mjs",
      "prototype/desktop/paper-math-renderer.mjs",
      "prototype/desktop/paper-user-tags.mjs",
      "prototype/desktop/styles.css",
    ]),
    vendor: Object.freeze([
      "prototype/desktop/vendor/katex/katex.min.css",
      "prototype/desktop/vendor/katex/katex.mjs",
    ]),
  }),
  Object.freeze({
    name: "discovery",
    template: "prototype/desktop/discovery.template.html",
    regular: Object.freeze([
      "prototype/desktop/candidate-storage.mjs",
      "prototype/desktop/discovery.mjs",
      "prototype/desktop/institution-access.mjs",
      "prototype/desktop/library.mjs",
      "prototype/desktop/openalex-search.mjs",
      "prototype/desktop/paper-inspector.mjs",
      "prototype/desktop/paper-library-model.mjs",
      "prototype/desktop/paper-library-storage.mjs",
      "prototype/desktop/paper-math-renderer.mjs",
      "prototype/desktop/paper-user-tags.mjs",
      "prototype/desktop/styles.css",
    ]),
    vendor: Object.freeze([
      "prototype/desktop/vendor/katex/katex.mjs",
    ]),
  }),
  Object.freeze({
    name: "state-transfer",
    template: "prototype/desktop/state-transfer.html",
    regular: Object.freeze([
      "prototype/desktop/agent-task-input.mjs",
      "prototype/desktop/candidate-storage.mjs",
      "prototype/desktop/direction-snapshot.mjs",
      "prototype/desktop/paper-library-model.mjs",
      "prototype/desktop/paper-library-storage.mjs",
      "prototype/desktop/paper-user-tags.mjs",
      "prototype/desktop/state-transfer.mjs",
      "prototype/desktop/styles.css",
    ]),
    vendor: Object.freeze([]),
  }),
])

const manifestRelativePath = "exporter/config/github-package-files.json"
const exampleRelativePath = "exporter/config/library.example.json"
const absoluteUsersPath = (...parts) => ["", "Users", ...parts].join("/")
const absoluteHomePath = (...parts) => ["", "home", ...parts].join("/")
const windowsPath = (...parts) => ["C:", ...parts].join("\\")
const uncPath = (...parts) => ["", "", ...parts].join("\\")
const secretAssignment = (name, value = "secret") => `${name}=${value}`

async function writeFixtureFile(root, relativePath, content = "export {}\n") {
  const destination = join(root, ...relativePath.split("/"))
  await mkdir(join(destination, ".."), { recursive: true })
  await writeFile(destination, content)
}

async function writeManifest(root, files = EXPECTED_FILES, extra = {}) {
  await writeFixtureFile(
    root,
    manifestRelativePath,
    `${JSON.stringify({ version: 1, files, ...extra }, null, 2)}\n`,
  )
}

async function createFixtureRepo({ files = EXPECTED_FILES, extra = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "github-package-audit-"))
  for (const relativePath of EXPECTED_FILES) {
    if (relativePath === manifestRelativePath) continue
    if (relativePath === "exporter/config/institutions/nuist.json") {
      await writeFixtureFile(root, relativePath, "{}\n")
    } else if (relativePath === exampleRelativePath) {
      await writeFixtureFile(root, relativePath, `${JSON.stringify({
        version: 1,
        sources: [{ source_id: "fixture", path: "REPLACE_WITH_ABSOLUTE_PATH" }],
      }, null, 2)}\n`)
    } else if (relativePath.startsWith("prototype/desktop/vendor/katex/fonts/")) {
      await writeFixtureFile(root, relativePath, Buffer.from("wOF2fixture"))
    } else {
      await writeFixtureFile(root, relativePath)
    }
  }
  await writeManifest(root, files, extra)
  return root
}

async function captureBoundaryError(operation) {
  try {
    await operation()
  } catch (error) {
    assert.ok(error instanceof PackageBoundaryError)
    return error
  }
  assert.fail("expected PackageBoundaryError")
}

function staticImportSpecifiers(text) {
  const fromImports = [...text.matchAll(/\bfrom\s+(?:"([^"]+)"|'([^']+)')/gu)]
    .map((match) => match[1] ?? match[2])
  const bareImports = [...text.matchAll(/(?:^|\n)\s*import\s*(?:"([^"]+)"|'([^']+)')/gu)]
    .map((match) => match[1] ?? match[2])
  return [...fromImports, ...bareImports]
}

function templateAssetSpecifiers(text) {
  const attributes = [...text.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]+)"|'([^']+)')/gu)]
    .map((match) => match[1] ?? match[2])
  return [...attributes, ...staticImportSpecifiers(text)].filter((specifier) => specifier.startsWith("./assets/"))
}

async function collectGeneratedPageSourceClosure(templatePath) {
  const template = await readFile(new URL(`../../${templatePath}`, import.meta.url), "utf8")
  const pending = templateAssetSpecifiers(template).map((specifier) => {
    const assetPath = specifier.slice("./assets/".length).split(/[?#]/u, 1)[0]
    return `prototype/desktop/${assetPath}`
  })
  const visited = new Set()
  while (pending.length > 0) {
    const sourcePath = pending.shift()
    if (visited.has(sourcePath)) continue
    visited.add(sourcePath)
    if (!sourcePath.endsWith(".mjs")) continue
    const source = await readFile(new URL(`../../${sourcePath}`, import.meta.url), "utf8")
    for (const specifier of staticImportSpecifiers(source)) {
      assert.match(specifier, /^\.\/[A-Za-z0-9_./-]+$/u, `${sourcePath}: ${specifier}`)
      const dependency = posix.normalize(posix.join(posix.dirname(sourcePath), specifier))
      assert.equal(dependency.startsWith("prototype/desktop/"), true, `${sourcePath}: ${specifier}`)
      pending.push(dependency)
    }
  }
  const paths = [...visited].sort()
  return {
    regular: paths.filter((path) => REGULAR_DESKTOP_ASSET_SOURCES.includes(path)),
    vendor: paths.filter((path) => path.startsWith("prototype/desktop/vendor/katex/")),
    unexpected: paths.filter((path) => (
      !REGULAR_DESKTOP_ASSET_SOURCES.includes(path)
      && !path.startsWith("prototype/desktop/vendor/katex/")
    )),
  }
}

test("keeps the manifest and both independent policies at the exact lexical 118-file Task 13 union", async () => {
  const manifest = JSON.parse(await readFile(new URL("../config/github-package-files.json", import.meta.url), "utf8"))
  assert.equal(EXPECTED_FILES.length, 118)
  assert.equal(TASK_13_NET_NEW_FILES.length, 43)
  assert.deepEqual(TASK_13_NET_NEW_FILES, [...TASK_13_NET_NEW_FILES].sort())
  assert.deepEqual(
    EXPECTED_FILES.filter((path) => TASK_13_NET_NEW_FILES.includes(path)),
    TASK_13_NET_NEW_FILES,
  )
  assert.deepEqual(manifest.files, EXPECTED_FILES)
  assert.deepEqual(EXPECTED_PACKAGE_FILES, EXPECTED_FILES)
  assert.equal(Object.isFrozen(EXPECTED_PACKAGE_FILES), true)
  assert.deepEqual(EXPECTED_PACKAGE_FILES, [...EXPECTED_FILES].sort())
  assert.throws(() => EXPECTED_PACKAGE_FILES.push("notes/innocent.md"), TypeError)
  assert.equal(EXPECTED_PACKAGE_FILES.includes("local_library_config/paper-tags.json"), false)
})

test("keeps private, generated, donor, legacy, artifact, and Task 14-only files outside the 118-file policy", () => {
  const excluded = [
    "local_library_config/library.local.json",
    "local_library_data/paper-index.json",
    "local_library_output/desktop/library.html",
    "papers/paper.pdf",
    "notes/paper-reading.md",
    "private/audits/package.json",
    "output/screenshots/library.png",
    "donor/serve-private-library.mjs",
    "prototype/paper-library-v2/library.mjs",
    ...TASK_14_DEFERRED_FILES,
  ]
  assert.equal(EXPECTED_FILES.some((path) => excluded.includes(path)), false)
  assert.equal(auditPackageCandidates(excluded.map((path) => ({ path, content: "fixture" }))).blocking.length, excluded.length)
})

for (const closure of GENERATED_PAGE_CLOSURES) {
  test(`the generated ${closure.name} page closes independently through its exact packaged source dependencies`, async () => {
    const actual = await collectGeneratedPageSourceClosure(closure.template)
    assert.deepEqual(actual, {
      regular: closure.regular,
      vendor: closure.vendor,
      unexpected: [],
    })
    const omittedMember = closure.regular[0]
    const incompletePolicy = new Set(closure.regular.slice(1))
    assert.deepEqual(actual.regular.filter((path) => !incompletePolicy.has(path)), [omittedMember])

    const sourcePaths = [closure.template, ...closure.regular, ...closure.vendor]
    assert.equal(sourcePaths.every((path) => EXPECTED_FILES.includes(path)), true)
    const candidates = await Promise.all(sourcePaths.map(async (path) => ({
      path,
      content: await readFile(new URL(`../../${path}`, import.meta.url)),
    })))
    const result = auditPackageDependencyClosure(candidates)
    assert.deepEqual(result.blocking, [])
    assert.ok(result.checkedCount > 0)
  })
}

test("the three generated pages use exactly the 14 regular desktop assets", () => {
  const union = [...new Set(GENERATED_PAGE_CLOSURES.flatMap((closure) => closure.regular))].sort()
  assert.deepEqual(union, REGULAR_DESKTOP_ASSET_SOURCES)
})

test("dynamic generated resources stay outside the 118-file and regular-asset maps", () => {
  assert.equal(EXPECTED_FILES.includes("exporter/config/institutions/nuist.json"), true)
  for (const generatedPath of [
    "local_library_output/desktop/assets/nuist.institution.json",
    "local_library_data/paper-index.json",
  ]) {
    assert.equal(EXPECTED_FILES.includes(generatedPath), false)
    assert.equal(REGULAR_DESKTOP_ASSET_SOURCES.includes(generatedPath), false)
    assert.equal(auditPackageCandidates([{ path: generatedPath, content: "fixture" }]).blocking.length, 1)
  }
})

test("KaTeX font references remain an exact dedicated vendor closure", async () => {
  const css = await readFile(new URL("../../prototype/desktop/vendor/katex/katex.min.css", import.meta.url), "utf8")
  const referencedFonts = [...new Set([...css.matchAll(/url\(["']?(fonts\/[A-Za-z0-9_.-]+\.woff2)["']?\)/gu)]
    .map((match) => `prototype/desktop/vendor/katex/${match[1]}`))].sort()
  const packagedFonts = EXPECTED_FILES.filter((path) => path.startsWith("prototype/desktop/vendor/katex/fonts/"))
  assert.ok(referencedFonts.length > 0)
  assert.deepEqual(referencedFonts, packagedFonts)
  assert.equal(referencedFonts.some((path) => REGULAR_DESKTOP_ASSET_SOURCES.includes(path)), false)
})

test("the five Task 13 test candidates preserve private-path assertions without shipping private signatures", async () => {
  const candidates = await Promise.all(TASK_13_PRIVATE_SENTINEL_TEST_FILES.map(async (path) => ({
    path,
    content: await readFile(new URL(`../../${path}`, import.meta.url)),
  })))
  assert.deepEqual(auditPackageCandidates(candidates).blocking, [])
})

test("the exact policy includes all three back-navigation pages and their runtime dependencies", () => {
  for (const requiredPath of [
    "prototype/desktop/index.html",
    "prototype/desktop/directions.html",
    "prototype/desktop/p02.html",
    "prototype/desktop/app.mjs",
    "prototype/desktop/directions.mjs",
    "prototype/desktop/paper-filter.mjs",
    "prototype/desktop/papers-data.mjs",
  ]) {
    assert.equal(EXPECTED_PACKAGE_FILES.includes(requiredPath), true, requiredPath)
  }
})

test("every packaged relative HTML and static-import dependency closes inside the fixed policy", async () => {
  const candidates = await Promise.all(EXPECTED_FILES.map(async (path) => ({
    path,
    content: await readFile(new URL(`../../${path}`, import.meta.url)),
  })))
  const result = auditPackageDependencyClosure(candidates)
  assert.deepEqual(result.blocking, [])
  assert.ok(result.checkedCount >= 30)
})

test("dependency closure rejects an unlisted relative runtime reference", () => {
  const result = auditPackageDependencyClosure([{
    path: "prototype/desktop/index.html",
    content: '<script type="module" src="./missing-runtime.mjs"></script>',
  }])
  assert.deepEqual(result.blocking, [{
    path: "prototype/desktop/index.html",
    code: "dependency_unlisted",
  }])
})

test("allows only named program, template, test, and sanitized-example candidates", () => {
  const result = auditPackageCandidates([
    { path: "exporter/paper-library/scanner.mjs", content: "export {}" },
    {
      path: exampleRelativePath,
      content: JSON.stringify({
        version: 1,
        sources: [{ source_id: "fixture", path: "REPLACE_WITH_ABSOLUTE_PATH" }],
      }),
    },
    { path: "prototype/desktop/library.template.html", content: "<main></main>" },
  ])
  assert.deepEqual(result.blocking, [])
  assert.equal(result.checkedCount, 3)
})

test("blocks private directories and paper-result artifact filenames", () => {
  const result = auditPackageCandidates([
    { path: "local_library_config/library.local.json", content: "{}" },
    { path: "local_library_data/paper-index.json", content: "{}" },
    { path: "local_library_data/notes/paper-01/preferred.html", content: "private preview" },
    { path: "papers/paper.pdf", content: "" },
    { path: "notes/paper_论文精读.md", content: "私人笔记" },
    { path: "results/private-result.png", content: "" },
  ])
  assert.equal(result.blocking.length, 6)
})

test("rejects a harmless file that is not in the independent package policy", () => {
  const result = auditPackageCandidates([{ path: "notes/innocent.md", content: "公开说明" }])
  assert.equal(result.blocking.length, 1)
  assert.equal(result.blocking[0].code, "candidate_unlisted")
  assert.equal(result.blocking[0].path, "候选第 1 项")
})

test("blocks absolute roots and secret assignments without embedding their signatures in this source", () => {
  const result = auditPackageCandidates([
    { path: "README.md", content: absoluteUsersPath("example", "papers") },
    { path: ".gitignore", content: absoluteHomePath("example", "papers") },
    { path: "prototype/desktop/README.md", content: windowsPath("private", "paper.md") },
    { path: "exporter/paper-library/artifacts.mjs", content: secretAssignment(["API", "KEY"].join("_")) },
    { path: "exporter/paper-library/config.mjs", content: secretAssignment("TOKEN") },
    { path: "exporter/paper-library/frontmatter.mjs", content: secretAssignment("PASSWORD") },
  ])
  assert.equal(result.blocking.length, 6)
  assert.ok(result.blocking.every((entry) => entry.code === "content_private_signature"))
})

test("blocks UNC absolute roots in candidate content", () => {
  const result = auditPackageCandidates([{
    path: "README.md",
    content: uncPath("private-server", "research", "paper.md"),
  }])
  assert.equal(result.blocking[0].code, "content_private_signature")
})

test("does not confuse lowercase program variables or CSS assertion syntax with private signatures", () => {
  const result = auditPackageCandidates([
    { path: "exporter/paper-library/note-preview.mjs", content: "const token = 'safe'" },
    { path: "prototype/desktop/paper-library-dom.test.mjs", content: String.raw`/overflow-x:\s*auto/u` },
    { path: "prototype/desktop/paper-math-renderer.mjs", content: String.raw`/\\mathcal\s+Ḋ\s+([A-Za-z])\s+Ḍ/gu` },
  ])
  assert.deepEqual(result.blocking, [])
})

test("blocks binary, malformed UTF-8, and oversized candidate content", () => {
  const result = auditPackageCandidates([
    { path: "README.md", content: Buffer.from([0]) },
    { path: ".gitignore", content: Buffer.from([0xff]) },
    { path: "prototype/desktop/README.md", content: Buffer.alloc(PACKAGE_SIZE_LIMIT_BYTES + 1, 0x61) },
  ])
  assert.deepEqual(result.blocking.map((entry) => entry.code), [
    "content_binary",
    "content_not_utf8",
    "content_oversized",
  ])
})

test("allows only valid WOFF2 bytes for the fixed KaTeX font assets", () => {
  const fontPath = "prototype/desktop/vendor/katex/fonts/KaTeX_AMS-Regular.woff2"
  const valid = auditPackageCandidates([{ path: fontPath, content: Buffer.from("wOF2fixture") }])
  const invalid = auditPackageCandidates([{ path: fontPath, content: Buffer.from("not-a-font") }])

  assert.deepEqual(valid.blocking, [])
  assert.equal(invalid.blocking[0]?.code, "content_binary")
})

test("recursively blocks sensitive JSON keys", () => {
  for (const sensitiveKey of [
    "root_path",
    "paper_dir",
    "absolute_path",
    "source_path",
    "source_root",
    "private_path_lookup",
  ]) {
    const result = auditPackageCandidates([{
      path: exampleRelativePath,
      content: JSON.stringify({ version: 1, nested: [{ deeper: { [sensitiveKey]: "value" } }] }),
    }])
    assert.equal(result.blocking[0].code, "json_sensitive_key")
  }
})

test("blocks case and separator variants of sensitive JSON keys", () => {
  for (const sensitiveKey of [
    "RootPath",
    "PAPER-DIR",
    "privatePathLookup",
    "artifact_source_path",
    "ARTIFACT-SOURCE-PATHS",
    "source_paths",
    "ArtifactPaths",
    "artifactPath",
    "paper_source_path",
    "Paper-Source-Paths",
  ]) {
    const result = auditPackageCandidates([{
      path: exampleRelativePath,
      content: JSON.stringify({ nested: { [sensitiveKey]: "value" } }),
    }])
    assert.equal(result.blocking[0].code, "json_sensitive_key")
  }
})

test("preserves harmless taxonomy, contract, and relative JSON keys", () => {
  const result = auditPackageCandidates([{
    path: exampleRelativePath,
    content: JSON.stringify({
      source_id: "main_papers",
      source_status: "verified",
      sources: [{ source_type: "folder", relative_path: "paper/note.md" }],
    }),
  }])
  assert.deepEqual(result.blocking, [])
})

test("allows the path placeholder only at the example source path", () => {
  const allowed = auditPackageCandidates([{
    path: exampleRelativePath,
    content: JSON.stringify({
      version: 1,
      sources: [
        { source_id: "first", path: "REPLACE_WITH_ABSOLUTE_PATH" },
        { source_id: "second", path: "REPLACE_WITH_ABSOLUTE_PATH" },
      ],
    }),
  }])
  assert.deepEqual(allowed.blocking, [])

  const wrongFile = auditPackageCandidates([{
    path: manifestRelativePath,
    content: JSON.stringify({ version: 1, files: ["REPLACE_WITH_ABSOLUTE_PATH"] }),
  }])
  const wrongLocation = auditPackageCandidates([{
    path: exampleRelativePath,
    content: JSON.stringify({ version: 1, path: "REPLACE_WITH_ABSOLUTE_PATH" }),
  }])
  assert.equal(wrongFile.blocking[0].code, "json_placeholder_location")
  assert.equal(wrongLocation.blocking[0].code, "json_placeholder_location")
})

test("rejects malformed JSON candidates", () => {
  const result = auditPackageCandidates([{ path: exampleRelativePath, content: "{" }])
  assert.equal(result.blocking[0].code, "json_invalid")
})

test("rejects non-canonical, absolute, traversal, duplicate, and case-variant candidate paths", () => {
  const unsafePaths = [
    " README.md",
    "README.md ",
    "README.md\0suffix",
    "./README.md",
    "docs/../README.md",
    "docs//README.md",
    ["", "private", "README.md"].join("/"),
    windowsPath("private", "README.md"),
    ["C:", "private", "README.md"].join("/"),
    uncPath("server", "share", "README.md"),
    "readme.md",
  ]
  for (const path of unsafePaths) {
    const result = auditPackageCandidates([{ path, content: "safe" }])
    assert.equal(result.blocking.length, 1)
  }

  const duplicate = auditPackageCandidates([
    { path: "README.md", content: "safe" },
    { path: "README.md", content: "safe" },
  ])
  assert.equal(duplicate.blocking[0].code, "candidate_duplicate")
  assert.equal(duplicate.blocking[0].path, "候选第 2 项")
})

test("classifies private-artifact and environment directory segments before the allowlist", () => {
  for (const path of [
    "results/safe.mjs",
    "ocr/safe.mjs",
    "deep-notes/safe.mjs",
    ".env.local/safe.mjs",
  ]) {
    const result = auditPackageCandidates([{ path, content: "safe" }])
    assert.notEqual(result.blocking[0].code, "candidate_unlisted")
  }
})

test("collects every exact manifest candidate from a real temporary repository", async () => {
  const root = await createFixtureRepo()
  const candidates = await collectPackageCandidates({
    repoRoot: root,
    manifestPath: join(root, manifestRelativePath),
  })
  assert.equal(candidates.length, EXPECTED_FILES.length)
  assert.deepEqual(candidates.map((candidate) => candidate.path), EXPECTED_FILES)
  assert.ok(candidates.every((candidate) => Buffer.isBuffer(candidate.content)))
  assert.deepEqual(auditPackageCandidates(candidates).blocking, [])
})

test("rejects manifest schema, version, duplicate, unsorted, missing, and extra entries", async () => {
  const cases = [
    {
      name: "extra top-level key",
      prepare: () => createFixtureRepo({ extra: { description: "not allowed" } }),
      code: "manifest_schema",
    },
    {
      name: "wrong version",
      prepare: async () => {
        const root = await createFixtureRepo()
        await writeFixtureFile(root, manifestRelativePath, JSON.stringify({ version: 2, files: EXPECTED_FILES }))
        return root
      },
      code: "manifest_version",
    },
    {
      name: "duplicate",
      prepare: () => createFixtureRepo({ files: [...EXPECTED_FILES, EXPECTED_FILES.at(-1)] }),
      code: "manifest_item_duplicate",
    },
    {
      name: "unsorted",
      prepare: () => createFixtureRepo({ files: [EXPECTED_FILES[1], EXPECTED_FILES[0], ...EXPECTED_FILES.slice(2)] }),
      code: "manifest_unsorted",
    },
    {
      name: "missing",
      prepare: () => createFixtureRepo({ files: EXPECTED_FILES.slice(1) }),
      code: "manifest_set_mismatch",
    },
    {
      name: "extra",
      prepare: () => createFixtureRepo({ files: [...EXPECTED_FILES, "notes/innocent.md"].sort() }),
      code: "manifest_item_unlisted",
    },
  ]

  for (const item of cases) {
    const root = await item.prepare()
    const error = await captureBoundaryError(() => collectPackageCandidates({
      repoRoot: root,
      manifestPath: join(root, manifestRelativePath),
    }))
    assert.equal(error.code, item.code, item.name)
  }
})

test("rejects invalid manifest values by ordinal without retaining the illegal value", async () => {
  const invalidValues = [
    " README.md",
    "README.md ",
    "./README.md",
    "docs/../README.md",
    ["", "private", "README.md"].join("/"),
    windowsPath("private", "README.md"),
    ["C:", "private", "README.md"].join("/"),
    uncPath("server", "share", "README.md"),
    "README.md\0suffix",
    "readme.md",
  ]
  for (const illegalValue of invalidValues) {
    const files = [...EXPECTED_FILES]
    files[1] = illegalValue
    const root = await createFixtureRepo({ files })
    const error = await captureBoundaryError(() => collectPackageCandidates({
      repoRoot: root,
      manifestPath: join(root, manifestRelativePath),
    }))
    assert.equal(error.itemIndex, 2)
    assert.equal(JSON.stringify(error).includes(illegalValue), false)
    assert.equal(error.message.includes(illegalValue), false)
  }
})

test("rejects missing files, directories, and non-UTF8 content", async () => {
  const missingRoot = await createFixtureRepo()
  await rm(join(missingRoot, "README.md"))
  const missingError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: missingRoot,
    manifestPath: join(missingRoot, manifestRelativePath),
  }))
  assert.equal(missingError.code, "candidate_missing")

  const directoryRoot = await createFixtureRepo()
  await rm(join(directoryRoot, "README.md"))
  await mkdir(join(directoryRoot, "README.md"))
  const directoryError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: directoryRoot,
    manifestPath: join(directoryRoot, manifestRelativePath),
  }))
  assert.equal(directoryError.code, "candidate_not_regular")

  const nonUtf8Root = await createFixtureRepo()
  await writeFile(join(nonUtf8Root, "README.md"), Buffer.from([0xff]))
  const candidates = await collectPackageCandidates({
    repoRoot: nonUtf8Root,
    manifestPath: join(nonUtf8Root, manifestRelativePath),
  })
  assert.equal(auditPackageCandidates(candidates).blocking[0].code, "content_not_utf8")
})

test("rejects final external and internal symlinks without exposing their targets", async () => {
  const externalRoot = await createFixtureRepo()
  const externalTarget = join(await mkdtemp(join(tmpdir(), "github-package-target-")), "private.md")
  await writeFile(externalTarget, "private")
  await rm(join(externalRoot, "README.md"))
  await symlink(externalTarget, join(externalRoot, "README.md"))
  const externalError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: externalRoot,
    manifestPath: join(externalRoot, manifestRelativePath),
  }))
  assert.equal(externalError.code, "candidate_symlink")
  assert.equal(externalError.message.includes(externalTarget), false)

  const internalRoot = await createFixtureRepo()
  await rm(join(internalRoot, "README.md"))
  await symlink(".gitignore", join(internalRoot, "README.md"))
  const internalError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: internalRoot,
    manifestPath: join(internalRoot, manifestRelativePath),
  }))
  assert.equal(internalError.code, "candidate_symlink")
  assert.equal(internalError.message.includes(internalRoot), false)
})

test("rejects external and internal symlinked parent directories", async () => {
  const externalRoot = await createFixtureRepo()
  const externalParent = join(await mkdtemp(join(tmpdir(), "github-package-parent-")), "paper-library")
  await mkdir(externalParent)
  for (const relativePath of EXPECTED_FILES.filter((path) => path.startsWith("exporter/paper-library/"))) {
    await writeFixtureFile(join(externalParent, ".."), `paper-library/${relativePath.split("/").at(-1)}`)
  }
  await rm(join(externalRoot, "exporter/paper-library"), { recursive: true })
  await symlink(externalParent, join(externalRoot, "exporter/paper-library"))
  const externalError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: externalRoot,
    manifestPath: join(externalRoot, manifestRelativePath),
  }))
  assert.equal(externalError.code, "candidate_symlink")
  assert.equal(externalError.message.includes(externalParent), false)

  const internalRoot = await createFixtureRepo()
  const original = join(internalRoot, "exporter/paper-library")
  const moved = join(internalRoot, "exporter/paper-library-real")
  await rename(original, moved)
  await symlink("paper-library-real", original)
  const internalError = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: internalRoot,
    manifestPath: join(internalRoot, manifestRelativePath),
  }))
  assert.equal(internalError.code, "candidate_symlink")
  assert.equal(internalError.message.includes(internalRoot), false)
})

test("the collector reads only the fixed manifest location", async () => {
  const root = await createFixtureRepo()
  const alternateManifest = join(root, "alternate.json")
  await writeFile(alternateManifest, JSON.stringify({ version: 1, files: EXPECTED_FILES }))
  const error = await captureBoundaryError(() => collectPackageCandidates({
    repoRoot: root,
    manifestPath: alternateManifest,
  }))
  assert.equal(error.code, "manifest_location")
})

test("the CLI uses fixed paths and prints a deterministic success message", async () => {
  const output = []
  let received
  const code = await auditCliMain({
    collectCandidates: async (options) => {
      received = options
      return [{ path: "README.md", content: "safe" }]
    },
    auditCandidates: () => ({ blocking: [], checkedCount: 1 }),
    stdout: (line) => output.push(line),
    stderr: () => assert.fail("unexpected stderr"),
  })
  assert.equal(code, 0)
  assert.match(received.repoRoot, /html$/u)
  assert.equal(received.manifestPath, join(received.repoRoot, manifestRelativePath))
  assert.deepEqual(output, ["GitHub 打包审计：通过（1 个候选文件）"])
})

test("the CLI redacts raw errors, illegal items, and symlink targets", async () => {
  const privatePath = absoluteUsersPath("private", "papers", "secret.md")
  const output = []
  const firstCode = await auditCliMain({
    collectCandidates: async () => { throw new Error(privatePath) },
    stdout: () => assert.fail("unexpected stdout"),
    stderr: (line) => output.push(line),
  })
  assert.equal(firstCode, 1)
  assert.equal(output.join("\n").includes(privatePath), false)
  assert.deepEqual(output, [
    "GitHub 打包审计：失败",
    "- 打包边界无法安全读取",
  ])

  const manifestOutput = []
  const secondCode = await auditCliMain({
    collectCandidates: async () => {
      throw new PackageBoundaryError("manifest_item_invalid", { itemIndex: 7 })
    },
    stdout: () => assert.fail("unexpected stdout"),
    stderr: (line) => manifestOutput.push(line),
  })
  assert.equal(secondCode, 1)
  assert.deepEqual(manifestOutput, [
    "GitHub 打包审计：失败",
    "- 清单第 7 项：路径格式不安全",
  ])
})

test("the CLI maps post-validation collector ordinals to fixed safe candidate paths", async () => {
  const cases = [
    ["candidate_missing", 2, "README.md", "候选文件不存在"],
    ["candidate_symlink", 1, ".gitignore", "候选路径含符号链接"],
    ["candidate_not_regular", 5, "exporter/config/library.example.json", "候选路径不是普通文件"],
    ["candidate_read", 8, "exporter/paper-library/artifacts.mjs", "候选文件无法安全读取"],
    ["candidate_changed", 9, "exporter/paper-library/build.mjs", "候选文件读取期间发生变化"],
    ["candidate_escape", 10, "exporter/paper-library/build.test.mjs", "候选文件解析到项目边界之外"],
    ["candidate_parent_invalid", 17, "exporter/paper-library/config.mjs", "候选路径的父级不是目录"],
  ]
  for (const [errorCode, itemIndex, safePath, reason] of cases) {
    const output = []
    const code = await auditCliMain({
      collectCandidates: async () => {
        throw new PackageBoundaryError(errorCode, { itemIndex })
      },
      stdout: () => assert.fail("unexpected stdout"),
      stderr: (line) => output.push(line),
    })
    assert.equal(code, 1)
    assert.deepEqual(output, [
      "GitHub 打包审计：失败",
      `- ${safePath}：${reason}`,
    ])
  }
})

test("the CLI keeps unsafe manifest-value failures ordinal-only", async () => {
  const privatePath = absoluteUsersPath("private", "illegal-manifest-value")
  const output = []
  const code = await auditCliMain({
    collectCandidates: async () => {
      const error = new PackageBoundaryError("manifest_item_unlisted", { itemIndex: 2 })
      error.illegalValue = privatePath
      throw error
    },
    stdout: () => assert.fail("unexpected stdout"),
    stderr: (line) => output.push(line),
  })
  assert.equal(code, 1)
  assert.deepEqual(output, [
    "GitHub 打包审计：失败",
    "- 清单第 2 项：路径不在固定候选集合中",
  ])
  assert.equal(output.join("\n").includes(privatePath), false)
})

test("the CLI maps blocking codes to fixed reasons and never prints injected details", async () => {
  const privatePath = absoluteUsersPath("private", "secret.md")
  const output = []
  const code = await auditCliMain({
    collectCandidates: async () => [{ path: "README.md", content: "safe" }],
    auditCandidates: () => ({
      checkedCount: 1,
      blocking: [{ path: privatePath, code: privatePath }],
    }),
    stdout: () => assert.fail("unexpected stdout"),
    stderr: (line) => output.push(line),
  })
  assert.equal(code, 1)
  assert.equal(output.join("\n").includes(privatePath), false)
  assert.deepEqual(output, [
    "GitHub 打包审计：失败（1 个候选文件）",
    "- 候选项：候选内容或路径不符合固定打包边界",
  ])
})

test("fixture construction creates ordinary files rather than paper artifacts", async () => {
  const root = await createFixtureRepo()
  const info = await lstat(join(root, "README.md"))
  assert.equal(info.isFile(), true)
  assert.equal((await readFile(join(root, "README.md"), "utf8")), "export {}\n")
})
