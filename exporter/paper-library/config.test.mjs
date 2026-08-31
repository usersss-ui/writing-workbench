import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadLibraryConfig } from "./config.mjs"

test("loads one absolute private source with a stable source_id", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: join(root, "papers") }],
  }))

  const config = await loadLibraryConfig(configPath)
  assert.equal(config.sources[0].source_id, "main_papers")
  assert.equal(config.sources[0].path, join(root, "papers"))
  assert.equal(config.sources[0].catalog_path, null)
})

test("loads an absolute catalog_path beside a source", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  const catalogPath = join(root, "1.目录.md")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: join(root, "papers"), catalog_path: catalogPath }],
  }))

  const config = await loadLibraryConfig(configPath)
  assert.equal(config.sources[0].catalog_path, catalogPath)
})

test("rejects a relative catalog_path", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: join(root, "papers"), catalog_path: "1.目录.md" }],
  }))

  await assert.rejects(() => loadLibraryConfig(configPath), /catalog_path 必须是绝对路径/)
})

test("rejects duplicate source_id values", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [
      { source_id: "main_papers", path: join(root, "a") },
      { source_id: "main_papers", path: join(root, "b") },
    ],
  }))

  await assert.rejects(() => loadLibraryConfig(configPath), /source_id 重复/)
})

test("rejects a relative source path", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "main_papers", path: "../papers" }],
  }))

  await assert.rejects(() => loadLibraryConfig(configPath), /必须是绝对路径/)
})

test("loads an explicit archive_source_id only when it matches one configured source", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    archive_source_id: "archive_papers",
    sources: [
      { source_id: "main_papers", path: join(root, "main") },
      { source_id: "archive_papers", path: join(root, "archive") },
    ],
  }))

  const config = await loadLibraryConfig(configPath)
  assert.equal(config.archive_source_id, "archive_papers")
})

test("does not infer archive capability when archive_source_id is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  await writeFile(configPath, JSON.stringify({
    version: 1,
    sources: [{ source_id: "only_source", path: join(root, "papers") }],
  }))

  const config = await loadLibraryConfig(configPath)
  assert.equal(config.archive_source_id, null)
})

test("rejects unknown, path-like, empty, non-string, or ambiguous archive_source_id values", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-library-config-"))
  const configPath = join(root, "library.local.json")
  for (const archiveSourceId of [
    "missing_source",
    "../main_papers",
    "/main_papers",
    "main\\papers",
    "",
    42,
    ["main_papers"],
    "MAIN_PAPERS",
    " main_papers ",
  ]) {
    await writeFile(configPath, JSON.stringify({
      version: 1,
      archive_source_id: archiveSourceId,
      sources: [{ source_id: "main_papers", path: join(root, "papers") }],
    }))
    await assert.rejects(() => loadLibraryConfig(configPath), /archive_source_id/u)
  }
})
