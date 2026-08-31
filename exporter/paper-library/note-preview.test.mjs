import test from "node:test"
import assert from "node:assert/strict"
import { choosePreferredNote, escapeHtml, renderControlledMarkdown } from "./note-preview.mjs"

function paperWithNotes(paths, preferredNote = null) {
  return {
    relative_path: "Paper A",
    preferred_note: preferredNote,
    warnings: [],
    artifacts: {
      note: paths.map((relative_path) => ({
        relative_path,
        file_name: relative_path.split("/").at(-1),
        size_bytes: 12,
      })),
    },
  }
}

test("escapeHtml escapes every HTML-significant character", () => {
  assert.equal(escapeHtml(`<a data-x="'">&`), "&lt;a data-x=&quot;&#39;&quot;&gt;&amp;")
})

test("renderControlledMarkdown renders the approved academic reading subset", () => {
  const html = renderControlledMarkdown([
    "# 标题",
    "",
    "正文 **突出结论**，保留 [[内部链接]] 为不可点击文字。",
    "",
    "> 待核验",
    "",
    "- 条目一",
    "- 条目二 `x[k]`",
  ].join("\n"))

  assert.equal(html, [
    "<h1>标题</h1>",
    "<p>正文 <strong>突出结论</strong>，保留 [[内部链接]] 为不可点击文字。</p>",
    "<blockquote>待核验</blockquote>",
    "<ul><li>条目一</li><li>条目二 <code>x[k]</code></li></ul>",
  ].join("\n"))
})

test("renderControlledMarkdown renders tables, Obsidian callouts, and readable math wrappers", () => {
  const html = renderControlledMarkdown([
    "## 收敛结论",
    "",
    "| 条件 | 结论 |",
    "| :--- | ---: |",
    "| **单调性** | $y^k \\to y^*$ |",
    "",
    "> [!warning] 证据边界",
    "> 论文只证明 *渐近收敛*。",
    "",
    "$$",
    "0 < \\gamma < 1/\\kappa",
    "$$",
  ].join("\n"))

  assert.match(html, /<div class="note-table-scroll"><table>/u)
  assert.match(html, /<th>条件<\/th><th>结论<\/th>/u)
  assert.match(html, /<td><strong>单调性<\/strong><\/td><td><span class="math-inline">y\^k \\to y\^\*<\/span><\/td>/u)
  assert.match(html, /<aside class="note-callout note-callout--warning">/u)
  assert.match(html, /<strong class="note-callout-title">证据边界<\/strong>/u)
  assert.match(html, /<p>论文只证明 <em>渐近收敛<\/em>。<\/p>/u)
  assert.match(html, /<div class="math-display" role="math"><code>0 &lt; \\gamma &lt; 1\/\\kappa<\/code><\/div>/u)
  assert.doesNotMatch(html, /<(?:script|a|img)\b/iu)
})

test("renderControlledMarkdown turns standalone Markdown separators into safe rules", () => {
  assert.equal(
    renderControlledMarkdown("上文\n\n---\n\n下文"),
    "<p>上文</p>\n<hr>\n<p>下文</p>",
  )
})

test("renderControlledMarkdown strips only closed frontmatter at the start of a note", () => {
  assert.equal(
    renderControlledMarkdown([
      "---",
      "title: \"Xiong20-PDO_论文精读\"",
      "tags:",
      "  - private-note",
      "---",
      "",
      "# 论文精读",
      "",
      "---",
      "",
      "正文",
    ].join("\n")),
    "<h1>论文精读</h1>\n<hr>\n<p>正文</p>",
  )

  assert.equal(
    renderControlledMarkdown("---\ntitle: 未闭合\n# 仍是正文"),
    "<hr>\n<p>title: 未闭合</p>\n<h1>仍是正文</h1>",
  )

  assert.equal(
    renderControlledMarkdown("---\n文件开头的普通分隔内容\n---"),
    "<hr>\n<p>文件开头的普通分隔内容</p>\n<hr>",
  )
})

test("renderControlledMarkdown recognizes multiline and in-paragraph display math outside fenced code", () => {
  const html = renderControlledMarkdown([
    "引入 $$x_t < y_t$$ 后文",
    "",
    "$$\\begin{aligned}",
    "x_{t+1} &\\leq y_t \\\\",
    "y_{t+1} &= z_t",
    "\\end{aligned}$$",
    "",
    "```text",
    "$$\\begin{aligned}",
    "code &\\leq sample",
    "\\end{aligned}$$",
    "```",
  ].join("\n"))

  assert.equal(html, [
    "<p>引入</p>",
    '<div class="math-display" role="math"><code>x_t &lt; y_t</code></div>',
    "<p>后文</p>",
    '<div class="math-display" role="math"><code>\\begin{aligned}\nx_{t+1} &amp;\\leq y_t \\\\\ny_{t+1} &amp;= z_t\n\\end{aligned}</code></div>',
    "<pre><code class=\"language-text\">$$\\begin{aligned}\ncode &amp;\\leq sample\n\\end{aligned}$$</code></pre>",
  ].join("\n"))
})

test("renderControlledMarkdown escapes raw HTML, handlers, links, wikilinks, and embeds", () => {
  const privatePath = ["", "Users", "example", "secret.pdf"].join("/")
  const html = renderControlledMarkdown([
    `<img src=x onerror="alert(1)">`,
    "",
    `[本机](${privatePath}) ![[secret.pdf]] [[内部]]`,
  ].join("\n"))

  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /<(?:a|img)\b/i)
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
  assert.match(html, /\[本机\]\(\/Users\/example\/secret\.pdf\)/)
  assert.match(html, /!\[\[secret\.pdf\]\]/)
})

test("renderControlledMarkdown activates only exporter-approved Obsidian image embeds", () => {
  const seen = []
  const html = renderControlledMarkdown(
    "| 论文原图 | 复现结果 |\n| --- | --- |\n| ![[figure.png]] | ![[result.png|收敛结果]] |",
    {
      resolveImage(reference) {
        seen.push(reference)
        const fileName = reference.target === "figure.png" ? "a".repeat(64) : "b".repeat(64)
        return {
          status: "resolved",
          src: `../../local_library_data/notes/paper-01/assets/${fileName}.png`,
        }
      },
    },
  )

  assert.deepEqual(seen, [
    { target: "figure.png", label: null, width: null, height: null },
    { target: "result.png", label: "收敛结果", width: null, height: null },
  ])
  assert.match(html, /<img class="note-image" src="\.\.\/\.\.\/local_library_data\/notes\/paper-01\/assets\/a{64}\.png" alt="figure\.png" loading="lazy" decoding="async">/u)
  assert.match(html, /<img class="note-image" src="\.\.\/\.\.\/local_library_data\/notes\/paper-01\/assets\/b{64}\.png" alt="收敛结果" loading="lazy" decoding="async">/u)
  assert.doesNotMatch(html, /!\[\[/u)
})

test("renderControlledMarkdown resolves standard Markdown images used by OCR output", () => {
  const seen = []
  const html = renderControlledMarkdown(
    "正文 ![通信图](images/network.png)；代码：`![不应解析](literal.png)`",
    {
      resolveImage(reference) {
        seen.push(reference)
        return {
          status: "resolved",
          src: `../../local_library_data/sources/paper-01/assets/${"c".repeat(64)}.png`,
        }
      },
    },
  )

  assert.deepEqual(seen, [
    { target: "images/network.png", label: "通信图", width: null, height: null },
  ])
  assert.match(html, /<img class="note-image"[^>]*alt="通信图"/u)
  assert.match(html, /<code>!\[不应解析\]\(literal\.png\)<\/code>/u)
  assert.doesNotMatch(html, /!\[通信图\]/u)
})

test("renderControlledMarkdown shows a passive placeholder for unresolved image embeds", () => {
  const html = renderControlledMarkdown(
    "缺图：![[missing.png]]；代码：`![[literal.png]]`；附件：![[paper.pdf]]",
    { resolveImage: () => ({ status: "missing" }) },
  )

  assert.match(html, /<span class="note-image-placeholder">图片未解析：missing\.png<\/span>/u)
  assert.match(html, /<code>!\[\[literal\.png\]\]<\/code>/u)
  assert.match(html, /!\[\[paper\.pdf\]\]/u)
  assert.doesNotMatch(html, /<img/u)
})

test("renderControlledMarkdown wraps closed fenced code and sanitizes its language token", () => {
  assert.equal(
    renderControlledMarkdown("```python\r\nprint('<x>')\r\n```"),
    '<pre><code class="language-python">print(&#39;&lt;x&gt;&#39;)</code></pre>',
  )
  assert.equal(
    renderControlledMarkdown("```python\" onmouseover=\"x\n<x>\n```"),
    "<pre><code>&lt;x&gt;</code></pre>",
  )
  assert.equal(
    renderControlledMarkdown("```mermaid\ngraph LR; A-->B\n```"),
    "<pre><code>graph LR; A--&gt;B</code></pre>",
  )
})

test("renderControlledMarkdown leaves an unclosed fence as escaped paragraph text", () => {
  assert.equal(
    renderControlledMarkdown("```html\n<script>alert(1)</script>"),
    "<p>```html &lt;script&gt;alert(1)&lt;/script&gt;</p>",
  )
})

test("choosePreferredNote requires preview approval and an exact scanner-selected note", () => {
  const paper = paperWithNotes(["notes/a.md", "notes/b.md"], "notes/b.md")

  assert.equal(choosePreferredNote({ paper, override: {} }), null)
  assert.deepEqual(
    choosePreferredNote({ paper, override: { preview_note: true, preferred_note: "notes/b.md" } }),
    { relative_path: "notes/b.md", file_name: "b.md", size_bytes: 12 },
  )
})

test("choosePreferredNote fails closed when an explicit selection does not match", () => {
  const paper = paperWithNotes(["a.md", "b.md"], null)

  assert.equal(
    choosePreferredNote({ paper, override: { preview_note: true, preferred_note: "missing.md" } }),
    null,
  )
  assert.deepEqual(paper.warnings, ["首选笔记与扫描结果不匹配"])
})

test("choosePreferredNote trusts the scanner-normalized preferred note for a source-relative override", () => {
  const paper = paperWithNotes(["reading-note.md"], "reading-note.md")
  assert.deepEqual(
    choosePreferredNote({
      paper,
      override: { preview_note: true, preferred_note: "Paper A/reading-note.md" },
    }),
    { relative_path: "reading-note.md", file_name: "reading-note.md", size_bytes: 12 },
  )
})

test("choosePreferredNote fails closed when explicit and scanner-selected notes differ", () => {
  const paper = paperWithNotes(["notes/a.md", "notes/b.md"], "notes/b.md")
  assert.equal(
    choosePreferredNote({
      paper,
      override: { preview_note: true, preferred_note: "notes/a.md" },
    }),
    null,
  )
  assert.deepEqual(paper.warnings, ["首选笔记与扫描结果不匹配"])
})

test("choosePreferredNote auto-selects only one note and explains zero or ambiguous notes", () => {
  const single = paperWithNotes(["only.md"])
  assert.deepEqual(
    choosePreferredNote({ paper: single, override: { preview_note: true } }),
    { relative_path: "only.md", file_name: "only.md", size_bytes: 12 },
  )

  const empty = paperWithNotes([])
  assert.equal(choosePreferredNote({ paper: empty, override: { preview_note: true } }), null)
  assert.deepEqual(empty.warnings, ["已请求预览，但尚无阅读笔记"])

  const multiple = paperWithNotes(["a.md", "b.md"])
  assert.equal(choosePreferredNote({ paper: multiple, override: { preview_note: true } }), null)
  assert.deepEqual(multiple.warnings, ["存在多个笔记版本，待选择首选文件"])
})
