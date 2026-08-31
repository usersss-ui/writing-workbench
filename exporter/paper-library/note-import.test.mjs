import test from "node:test"
import assert from "node:assert/strict"
import {
  NOTE_IMPORT_CATEGORIES,
  inspectMarkdownNote,
  suggestNoteFileName,
  validateRequestedFileName,
} from "./note-import.mjs"

const windowsPath = (...parts) => ["C:", ...parts].join("\\")

const PAPER = Object.freeze({
  paper_id: "Zhao24-DFL",
  source_id: "main",
  relative_path: "Topic/Zhao",
  title_original: "Canonical title",
  title_zh: "规范标题",
  title_en: "Canonical title",
  authors: ["A. Author"],
  publication_year: 2024,
})

function inspect(overrides = {}) {
  return inspectMarkdownNote({
    paper: PAPER,
    unitDirectory: "/vault/Topic/Zhao",
    category: "note",
    originalFileName: "note.md",
    markdown: "# note",
    imageInspector: async () => [],
    ...overrides,
  })
}

test("exports the exact seven category, marker, and reader-tab contracts", () => {
  assert.deepEqual(NOTE_IMPORT_CATEGORIES, {
    note: { label: "论文精读", marker: "论文精读", target_tab: "note" },
    derivation: { label: "推导过程", marker: "推导过程", target_tab: "derivation" },
    source_map: { label: "来源映射", marker: "source_map", target_tab: "derivation" },
    modeling: { label: "建模复盘", marker: "建模复盘", target_tab: "simulation" },
    simulation: { label: "仿真描述", marker: "仿真描述", target_tab: "simulation" },
    code_compare: { label: "代码对照", marker: "代码对比", target_tab: "code_compare" },
    reproduction_report: { label: "复现报告", marker: "复现报告", target_tab: "simulation" },
  })
  assert.equal(suggestNoteFileName("Zhao24-DFL", "note"), "Zhao24-DFL_论文精读.md")
})

test("accepts one marked basename and rejects overwrite-shaped or path-shaped names", () => {
  assert.equal(
    validateRequestedFileName("Zhao24-DFL_论文精读_补充.md", { paperId: "Zhao24-DFL", category: "note" }),
    "Zhao24-DFL_论文精读_补充.md",
  )
  for (const name of [
    "../论文精读.md", "dir/论文精读.md", "dir\\论文精读.md", "/tmp/论文精读.md",
    "Zhao24-DFL_补充.md", "Zhao24-DFL_论文精读.txt", "Zhao24-DFL_论文精读\u0000.md",
    " Zhao24-DFL_论文精读.md", "Zhao24-DFL_论文精读..md", windowsPath("Zhao24-DFL_论文精读.md"),
  ]) {
    assert.throws(
      () => validateRequestedFileName(name, { paperId: "Zhao24-DFL", category: "note" }),
      { code: "INVALID_FILE_NAME" },
    )
  }
})

test("reports blocking identity, math, and unsafe-image issues plus metadata and missing-image warnings", async () => {
  const { publicResult } = await inspect({
    markdown: "---\npaper_id: Other-01\ntitle: Different\nyear: 2023\n---\n# Note\n$open\n![bad](../escape.png)\n![missing](missing.png)",
    imageInspector: async () => [
      { target: "../escape.png", status: "unsupported" },
      { target: "missing.png", status: "missing" },
    ],
  })
  assert.deepEqual(publicResult.checks.blocking_codes, ["PAPER_ID_MISMATCH", "LATEX_UNBALANCED", "IMAGE_UNSAFE"])
  assert.deepEqual(publicResult.checks.warning_codes, ["TITLE_MISMATCH", "YEAR_MISMATCH", "IMAGE_MISSING"])
  assert.equal(publicResult.checks.can_import, false)
})

test("measures the one MiB boundary in UTF-8 bytes", async () => {
  const exact = await inspect({ markdown: "a".repeat(1_048_576) })
  const over = await inspect({ markdown: `${"a".repeat(1_048_575)}中` })
  assert.equal(exact.publicResult.checks.blocking_codes.includes("MARKDOWN_TOO_LARGE"), false)
  assert.equal(over.publicResult.checks.blocking_codes.includes("MARKDOWN_TOO_LARGE"), true)
})

test("accepts md and markdown source names while blocking any other extension", async () => {
  assert.equal((await inspect({ originalFileName: "local.markdown" })).publicResult.checks.can_import, true)
  const invalid = await inspect({ originalFileName: "local.txt" })
  assert.equal(invalid.publicResult.checks.blocking_codes.includes("MARKDOWN_EXTENSION"), true)
})

test("blocks unclosed first-line frontmatter but treats absent metadata as passing", async () => {
  const unclosed = await inspect({ markdown: "---\npaper_id: Zhao24-DFL\n# note" })
  assert.equal(unclosed.publicResult.checks.blocking_codes.includes("FRONTMATTER_UNCLOSED"), true)
  const absent = await inspect({ markdown: "# note" })
  assert.deepEqual(absent.publicResult.checks.warning_codes, [])
  assert.equal(absent.publicResult.checks.can_import, true)
})

test("blocks frontmatter whose closing delimiter is beyond the parser window", async () => {
  const markdown = [
    "---",
    "paper_id: Other-01",
    `ignored_padding: ${"x".repeat(8_192)}`,
    "---",
    "# note",
  ].join("\n")
  const result = await inspect({ markdown })

  assert.equal(result.publicResult.checks.blocking_codes.includes("FRONTMATTER_TOO_LARGE"), true)
  assert.equal(result.publicResult.checks.can_import, false)
})

test("normalizes metadata but warns when the ordered author list differs", async () => {
  const result = await inspect({
    markdown: "---\npaper_id: Zhao24-DFL\ntitle: canonical   TITLE\nauthors: [Other Author, A. Author]\nyear: 2024\n---\n# note",
  })
  assert.deepEqual(result.publicResult.checks.warning_codes, ["AUTHORS_MISMATCH"])
})

test("accepts closed dollar, display, parenthesis, and bracket LaTeX delimiters", async () => {
  const result = await inspect({
    markdown: [
      "$x$ and $$y$$ and \\(z\\) and \\[w\\]",
      "`$ignored`",
      "```tex",
      "$ignored",
      "```",
      "escaped \\$ not a delimiter",
    ].join("\n"),
  })
  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), false)
})

test("ignores variable-length backtick inline code before checking LaTeX delimiters", async () => {
  const result = await inspect({ markdown: "Prose before ``$HOME`` and prose after." })

  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), false)
})

test("does not let escaped backticks hide an unbalanced prose formula", async () => {
  const result = await inspect({ markdown: "Escaped literals: \\`$unclosed\\`" })

  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), true)
})

test("closes a code span when its matching backtick follows a backslash inside code", async () => {
  const result = await inspect({ markdown: "Visible `$HOME\\` prose." })

  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), false)
})

test("ignores single- and double-backtick code spans that cross a prose line break", async (t) => {
  for (const markdown of [
    "Visible `code starts\n$HOME\nends` prose.",
    "Visible ``code starts\n$HOME\nends`` prose.",
  ]) {
    await t.test(markdown.startsWith("Visible ``") ? "double backticks" : "single backticks", async () => {
      const result = await inspect({ markdown })
      assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), false)
    })
  }
})

test("does not let an inline code span cross a blank-line block boundary", async (t) => {
  for (const markdown of [
    "`code starts\n\n$unclosed\n`",
    "``code starts\n \t \n$unclosed\n``",
  ]) {
    await t.test(markdown.startsWith("``") ? "double backticks" : "single backticks", async () => {
      const result = await inspect({ markdown })
      assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), true)
    })
  }
})

test("does not let an inline code span cross a recognizable Markdown block boundary", async (t) => {
  const cases = [
    ["ATX heading", "`code starts\n# Heading $unclosed\n`"],
    ["blockquote", "``code starts\n> $unclosed\n``"],
    ["unordered list", "`code starts\n- item $unclosed\n`"],
    ["ordered list", "``code starts\n1. item $unclosed\n``"],
    ["setext heading", "`code starts\nHeading $unclosed\n---\n`"],
    ["thematic break", "``code starts\n***\n$unclosed\n``"],
    ["indented code", "`code starts\n    $unclosed\n`"],
    ["HTML block", "``code starts\n<div>$unclosed</div>\n``"],
    ["link reference", "`code starts\n[label]: https://example.test/$unclosed\n`"],
    ["leading-pipe table", "`code starts\n| h $unclosed |\n| --- |\n`"],
    ["pipe-delimited table", "``code starts\nh $unclosed | h2\n--- | ---\n``"],
  ]
  for (const [name, markdown] of cases) {
    await t.test(name, async () => {
      const result = await inspect({ markdown })
      assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), true)
    })
  }
})

test("does not let an inline code span cross a display-math block boundary", async (t) => {
  const cases = [
    ["single-line dollars", "`code starts\n$$x$$\n$unclosed\n`"],
    ["in-paragraph dollars", "`code starts\nprefix $$x$$ suffix\n$unclosed\n`"],
    ["multiline dollars", "``code starts\n$$\nx\n$$\n$unclosed\n``"],
    ["bracket display", "`code starts\n\\[\nx\n\\]\n$unclosed\n`"],
  ]
  for (const [name, markdown] of cases) {
    await t.test(name, async () => {
      const result = await inspect({ markdown })
      assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), true)
    })
  }
})

test("isolates no-leading-pipe GFM rows after a delimiter row", async () => {
  const result = await inspect({
    markdown: [
      "heading | other",
      "--- | ---",
      "`code starts | value",
      "$unclosed | value",
      "` | end",
    ].join("\n"),
  })

  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), true)
})

test("keeps a longer backtick fence open across a shorter backtick line", async () => {
  const result = await inspect({
    markdown: [
      "````text",
      "a shell token: $HOME",
      "```",
      "another shell token: $PATH",
      "````",
      "Visible prose after the fence.",
    ].join("\n"),
  })

  assert.equal(result.publicResult.checks.blocking_codes.includes("LATEX_UNBALANCED"), false)
})

test("blocks unsafe image statuses and warns only for missing images in source order", async () => {
  const statuses = ["unsafe", "unsupported", "ambiguous", "invalid_type", "too_large", "missing", "resolved"]
  const result = await inspect({
    imageInspector: async () => statuses.map((status, index) => ({ target: `image-${index}.png`, status })),
  })
  assert.deepEqual(result.publicResult.checks.blocking_codes, [
    "IMAGE_UNSAFE", "IMAGE_UNSAFE", "IMAGE_UNSAFE", "IMAGE_UNSAFE", "IMAGE_UNSAFE",
  ])
  assert.deepEqual(result.publicResult.checks.warning_codes, ["IMAGE_MISSING"])
})

test("clones snapshot bytes and exposes no private image or directory details", async () => {
  const result = await inspect({
    markdown: "# note\n![figure](images/figure.png)",
    imageInspector: async () => [{
      target: "images/figure.png",
      status: "resolved",
      bytes: Buffer.from("private-image"),
      canonicalCandidate: "/vault/Topic/Zhao/images/figure.png",
      sourceRelativePath: "images/figure.png",
    }],
  })
  const original = Buffer.from(result.snapshot.bytes)
  result.snapshot.bytes[0] = 0
  const again = await inspect({ markdown: "# note\n![figure](images/figure.png)" })
  assert.notEqual(result.snapshot.bytes[0], original[0])
  assert.equal(again.snapshot.bytes[0], original[0])
  const publicText = JSON.stringify(result.publicResult)
  assert.equal(publicText.includes("/vault/"), false)
  assert.equal(publicText.includes("private-image"), false)
  assert.deepEqual(Object.keys(result.snapshot).sort(), [
    "bytes", "category", "checks", "original_file_name", "paper_id", "relative_path", "sha256",
    "source_id", "suggested_file_name", "target_tab",
  ])
})
