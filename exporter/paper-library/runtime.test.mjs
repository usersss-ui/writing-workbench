import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import {
  loadPrivateLibraryContext,
  rebuildConfiguredLibrary,
} from "./runtime.mjs"

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
  })

  assert.deepEqual(loads, [
    join(repoRoot, "local_library_config/library.local.json"),
    join(repoRoot, "local_library_config/paper-overrides.json"),
    join(repoRoot, "local_library_config/paper-tags.json"),
    "/catalog.md:main",
  ])
  assert.equal(context.papersById.get("Paper-01"), paper)
  assert.equal(context.unitDirectoryByPaperId.get("Paper-01"), "/vault/Topic/Paper")
  assert.equal(context.scanned.papers[0], paper)
})

test("rejects duplicate paper ids and papers without one scan path mapping", async () => {
  const base = {
    repoRoot: "/fixture/repo",
    loadConfig: async () => ({ version: 1, sources: [] }),
    loadOverrides: async () => ({ version: 1, papers: {} }),
    loadTags: async () => ({ version: 3, papers: {} }),
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

test("rebuild reuses exactly the loaded context and approved template root", async () => {
  const context = { config: {}, overrides: {}, tagCatalog: {}, catalogs: {} }
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
    templateRoot: join("/fixture/repo", "prototype/desktop"),
  }])
})
