import test from "node:test"
import assert from "node:assert/strict"
import { copyFile, cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  loadPrivateLibraryContext,
  rebuildConfiguredLibrary,
} from "./runtime.mjs"

const institution = Object.freeze({ institution_id: "nuist", providers: [] })
const workspaceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const DESKTOP_RESOURCES = Object.freeze([
  "discovery-workspace.mjs", "discovery-batch.mjs", "discovery-identity.mjs", "journal-review.mjs",
  "library.template.html", "discovery.template.html", "state-transfer.html", "styles.css", "library.mjs", "paper-inspector.mjs",
  "paper-math-renderer.mjs", "paper-library-model.mjs", "paper-library-storage.mjs", "paper-user-tags.mjs",
  "direction-snapshot.mjs", "agent-task-input.mjs",
  "candidate-storage.mjs", "discovery.mjs", "institution-access.mjs", "openalex-search.mjs", "state-transfer.mjs",
])

test("loads one configured context and indexes one scan by stable paper id", async () => {
  const repoRoot = "/fixture/repo"
  const loads = []
  const config = {
    version: 1,
    sources: [{ source_id: "main", path: "/vault", catalog_path: "/catalog.md" }],
  }
  const overrides = { version: 1, papers: {} }
  const tagCatalog = { version: 3, papers: {} }
  const paper = { paper_id: "Paper-01", source_id: "main", relative_path: "Topic/Paper" }
  const context = await loadPrivateLibraryContext({
    repoRoot,
    loadConfig: async (path) => { loads.push(path); return config },
    loadOverrides: async (path) => { loads.push(path); return overrides },
    loadTags: async (path) => { loads.push(path); return tagCatalog },
    loadCatalog: async (path, options) => {
      loads.push(`${path}:${options.sourceId}`)
      return { version: 1, papers: {} }
    },
    scan: async () => ({
      papers: [paper],
      audit: { private_path_lookup: { "Paper-01": "/vault/Topic/Paper" } },
    }),
    loadInstitution: async (path) => { loads.push(path); return institution },
  })

  assert.deepEqual(loads, [
    join(repoRoot, "local_library_config/library.local.json"),
    join(repoRoot, "local_library_config/paper-overrides.json"),
    join(repoRoot, "local_library_config/paper-tags.json"),
    join(repoRoot, "exporter/config/institutions/nuist.json"),
    "/catalog.md:main",
  ])
  assert.equal(context.papersById.get("Paper-01"), paper)
  assert.equal(context.unitDirectoryByPaperId.get("Paper-01"), "/vault/Topic/Paper")
  assert.equal(context.scanned.papers[0], paper)
  assert.equal(context.institution, institution)
})

test("rejects duplicate paper ids and papers without one scan path mapping", async () => {
  const base = {
    repoRoot: "/fixture/repo",
    loadConfig: async () => ({ version: 1, sources: [] }),
    loadOverrides: async () => ({ version: 1, papers: {} }),
    loadTags: async () => ({ version: 3, papers: {} }),
    loadInstitution: async () => institution,
  }
  const duplicate = { paper_id: "Paper-01", source_id: "main", relative_path: "Paper" }

  await assert.rejects(() => loadPrivateLibraryContext({
    ...base,
    scan: async () => ({
      papers: [duplicate, { ...duplicate }],
      audit: { private_path_lookup: { "Paper-01": "/vault/Paper" } },
    }),
  }), /扫描映射无效/u)
  await assert.rejects(() => loadPrivateLibraryContext({
    ...base,
    scan: async () => ({ papers: [duplicate], audit: { private_path_lookup: {} } }),
  }), /扫描映射无效/u)
})

test("rebuild reuses exactly the loaded context, validated institution and approved template root", async () => {
  const context = { config: {}, overrides: {}, tagCatalog: {}, catalogs: {}, institution }
  const calls = []
  const result = await rebuildConfiguredLibrary({
    repoRoot: "/fixture/repo",
    context,
    build: async (options) => { calls.push(options); return { paperCount: 1 } },
  })

  assert.equal(result.paperCount, 1)
  assert.deepEqual(calls, [{
    repoRoot: "/fixture/repo",
    config: context.config,
    overrides: context.overrides,
    catalogs: context.catalogs,
    tagCatalog: context.tagCatalog,
    institution,
    templateRoot: join("/fixture/repo", "prototype/desktop"),
  }])
})

test("runtime rebuild emits the discovery and state-transfer pages, complete resource union and a private-path-free validated institution asset", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "runtime-discovery-repo-"))
  const sourceRoot = await mkdtemp(join(tmpdir(), "runtime-discovery-source-"))
  const templateRoot = join(repoRoot, "prototype/desktop")
  await mkdir(templateRoot, { recursive: true })
  for (const resource of DESKTOP_RESOURCES) {
    await copyFile(join(workspaceRoot, "prototype/desktop", resource), join(templateRoot, resource))
  }
  await cp(join(workspaceRoot, "prototype/desktop/vendor/katex"), join(templateRoot, "vendor/katex"), { recursive: true })
  await mkdir(join(sourceRoot, "Paper A"), { recursive: true })
  await writeFile(join(sourceRoot, "Paper A/paper.pdf"), "%PDF-1.7\nfixture\n%%EOF\n")
  const publicInstitution = JSON.parse(await readFile(join(workspaceRoot, "exporter/config/institutions/nuist.json"), "utf8"))
  const context = {
    config: { version: 1, sources: [{ source_id: "main", path: sourceRoot }] },
    overrides: { version: 1, papers: {} },
    tagCatalog: { version: 3, papers: {} },
    catalogs: {}, institution: publicInstitution,
  }

  const result = await rebuildConfiguredLibrary({ repoRoot, context })
  const outputRoot = join(repoRoot, "local_library_output/desktop")
  await stat(join(outputRoot, "discovery.html"))
  await stat(join(outputRoot, "state-transfer.html"))
  for (const resource of DESKTOP_RESOURCES.filter((resource) => resource.endsWith(".mjs") || resource === "styles.css")) {
    await stat(join(outputRoot, "assets", resource))
  }
  await stat(join(outputRoot, "assets/vendor/katex/katex.mjs"))
  await stat(join(outputRoot, "assets/vendor/katex/katex.min.css"))
  const institutionAsset = JSON.parse(await readFile(join(outputRoot, "assets/nuist.institution.json"), "utf8"))
  assert.deepEqual(institutionAsset, publicInstitution)
  assert.equal(result.pageCount, 3)
  for (const output of [
    await readFile(join(outputRoot, "discovery.html"), "utf8"),
    await readFile(join(outputRoot, "state-transfer.html"), "utf8"),
    await readFile(join(outputRoot, "assets/state-transfer.mjs"), "utf8"),
    await readFile(join(outputRoot, "assets/nuist.institution.json"), "utf8"),
    await readFile(join(repoRoot, "local_library_data/paper-index.json"), "utf8"),
  ]) {
    assert.equal(output.includes(repoRoot), false)
    assert.equal(output.includes(sourceRoot), false)
  }
})
