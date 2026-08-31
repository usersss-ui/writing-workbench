import test from "node:test"
import assert from "node:assert/strict"
import { parsePaperFrontmatter } from "./frontmatter.mjs"

test("generic frontmatter title remains language neutral", () => {
  const parsed = parsePaperFrontmatter("---\ntitle: 中文标题\nyear: 2024\n---\n")

  assert.equal(parsed.data.title_original, "中文标题")
  assert.equal(parsed.data.title_en, undefined)
  assert.equal(parsed.data.year, 2024)
})

test("explicit language-specific frontmatter titles remain language-specific", () => {
  const parsed = parsePaperFrontmatter("---\ntitle: 原始标题\ntitle_zh: 中文题名\ntitle_en: English title\n---\n")

  assert.equal(parsed.data.title_original, "原始标题")
  assert.equal(parsed.data.title_zh, "中文题名")
  assert.equal(parsed.data.title_en, "English title")
})
