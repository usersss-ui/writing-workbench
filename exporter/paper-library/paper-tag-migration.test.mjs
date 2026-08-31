import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createEmptyFacets } from "./facet-schema.mjs"
import { migratePaperTagCatalogV2 } from "./paper-tag-migration.mjs"
import { main as migrateCatalog } from "../scripts/migrate-paper-tags-v3.mjs"

function legacyCatalog() {
  const facets = createEmptyFacets()
  facets.results = ["线性收敛"]
  return {
    version: 2,
    papers: {
      "Paper-01": {
        record_type: "外部论文",
        facets,
        source_terms: ["Algorithm One"],
      },
    },
  }
}

test("v2 migration adds only an empty sparse facet_states object", () => {
  const before = legacyCatalog()
  const migrated = migratePaperTagCatalogV2(before)
  assert.equal(migrated.version, 3)
  assert.deepEqual(migrated.papers["Paper-01"], {
    ...before.papers["Paper-01"],
    facet_states: {},
  })
  assert.deepEqual(before, legacyCatalog())
  assert.notStrictEqual(migrated.papers["Paper-01"].facets, before.papers["Paper-01"].facets)
  assert.notStrictEqual(migrated.papers["Paper-01"].source_terms, before.papers["Paper-01"].source_terms)
})

test("migration refuses wrong versions and legacy records with extra fields", () => {
  assert.throws(() => migratePaperTagCatalogV2({ version: 3, papers: {} }), /version 2/u)
  const invalid = legacyCatalog()
  invalid.papers["Paper-01"].facet_states = {}
  assert.throws(() => migratePaperTagCatalogV2(invalid), /version-2 标签记录字段无效/u)
})

test("migration CLI rewrites one catalog deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-tag-migration-"))
  const catalogPath = join(root, "paper-tags.json")
  await writeFile(catalogPath, `${JSON.stringify(legacyCatalog(), null, 2)}\n`, "utf8")
  const lines = []
  const code = await migrateCatalog({ catalogPath, stdout: (line) => lines.push(line), stderr: assert.fail })
  const migrated = JSON.parse(await readFile(catalogPath, "utf8"))
  assert.equal(code, 0)
  assert.deepEqual(migrated.papers["Paper-01"].facet_states, {})
  assert.deepEqual(lines, ["标签目录已迁移到 version 3：1 条记录"])
})
