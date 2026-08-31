import test from "node:test"
import assert from "node:assert/strict"
import { makeOverrideKey, makePathPaperId, normalizeRelativePath, makeSlug } from "./ids.mjs"

test("fallback identity is a fixed digest of source_id and relative path only", () => {
  const id = makePathPaperId({
    sourceId: "main_papers",
    relativePath: "Xi (2018) ADD-OPT",
  })
  assert.equal(id, "LIB-25A49551EB04")
})

test("source_id participates in fallback identity", () => {
  const relativePath = "Xi (2018) ADD-OPT"
  assert.notEqual(
    makePathPaperId({ sourceId: "main_papers", relativePath }),
    makePathPaperId({ sourceId: "archive", relativePath }),
  )
})

test("relative paths use slash separators and cannot escape the root", () => {
  assert.equal(normalizeRelativePath("A\\B/../C"), "A/C")
  assert.throws(() => normalizeRelativePath("../../outside"), /越出扫描根/)
})

test("slug generation is deterministic and URL safe", () => {
  assert.equal(makeSlug("Xi18-ADDOPT"), "xi18-addopt")
  assert.equal(makeSlug("LIB-ABC123456789"), "lib-abc123456789")
})

test("override keys use the canonical double-colon separator", () => {
  assert.equal(makeOverrideKey({ sourceId: "main_papers", relativePath: "A\\B" }), "main_papers::A/B")
})
