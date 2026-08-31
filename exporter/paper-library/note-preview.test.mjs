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

test("renderControlledMarkdown escapes active markup and redacts private file locators", () => {
  const privateHomeRoot = ["", "Users", "example", ""].join("/")
  const privatePath = ["", "Users", "example", "secret.pdf"].join("/")
  const html = renderControlledMarkdown([
    `<img src=x onerror="alert(1)">`,
    "",
    `[本机](${privatePath}) ![[secret.pdf]] [[内部]]`,
  ].join("\n"))

  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /<(?:a|img)\b/i)
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
  assert.equal(html.includes(privateHomeRoot), false)
  assert.match(html, /【本机路径已隐藏】/u)
  assert.match(html, /!\[\[secret\.pdf\]\]/)
})

test("renderControlledMarkdown removes absolute locator roots from prose and code", () => {
  const macPath = ["", "Users", "example", "My Papers", "Paper (final)", "secret results.csv"].join("/")
  const linuxPath = ["", "home", "researcher", "Private Lab", "results", "note.md"].join("/")
  const mountedPath = ["", "mnt", "c", "Users", "dave", "Private", "paper.md"].join("/")
  const windowsPath = ["C:", "Users", "example", "Grant (2026)", "draft.docx"].join("\\")
  const uncPath = ["", "", "server", "share", "Trial [blind]", "subjects.csv"].join("\\")
  const fileUrl = ["file:", "", "", "Users", "example", "My Papers", "secret.pdf"].join("/")
  const encodedFileUrl = ["file%3A", "%2F%2F%2FUsers%2Fexample%2FEncoded%20Project%2Fsecret.pdf"].join("")
  const transientPath = ["", "var", "folders", "private-session", "capture.png"].join("/")
  const temporaryPath = ["", "tmp", "private-build", "audit.json"].join("/")
  const forbiddenRoots = [
    ["", "Users", ""].join("/"),
    ["", "home", ""].join("/"),
    ["C:", "Users", ""].join("\\"),
    ["file:", "", ""].join("/"),
  ]
  const html = renderControlledMarkdown([
    `正文 \`${macPath}\`，继续说明。`,
    "",
    `\`${linuxPath}\`，保留说明。`,
    "",
    "```text",
    mountedPath,
    windowsPath,
    uncPath,
    fileUrl,
    encodedFileUrl,
    transientPath,
    temporaryPath,
    "```",
    "",
    "安全链接 https://example.org/papers/note.md",
  ].join("\n"))

  const sensitiveSuffixes = [
    "Paper (final)",
    "Private Lab",
    "Grant (2026)",
    "Trial [blind]",
    "My Papers",
    "Encoded%20Project",
    "private.png",
    "paper.md",
    "result.csv",
    "secret.pdf",
    "(final)/secret results.csv",
    "(2026)\\draft.docx",
    "[blind]\\subjects.csv",
    "private-session",
    "private-build",
  ]
  for (const forbidden of [
    macPath,
    linuxPath,
    mountedPath,
    windowsPath,
    uncPath,
    fileUrl,
    encodedFileUrl,
    transientPath,
    temporaryPath,
    ...forbiddenRoots,
    ...sensitiveSuffixes,
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden)
  }
  assert.match(html, /【本机路径已隐藏】/u)
  assert.match(html, /保留说明/u)
  assert.match(html, /https:\/\/example\.org\/papers\/note\.md/u)
})

test("renderControlledMarkdown removes home shorthand and encoded drive locators", () => {
  const privateLocators = [
    ["~", "Documents", "Secret Grant", "private.csv"].join("/"),
    ["$HOME", "Documents", "Secret Grant", "private.csv"].join("/"),
    ["${HOME}", "Documents", "Secret Grant", "private.csv"].join("/"),
    ["%USERPROFILE%", "Documents", "Secret Grant", "private.csv"].join("\\"),
    "C%3A%5CUsers%5Cexample%5CSecret%20Grant%5Cprivate.csv",
  ]
  const html = renderControlledMarkdown(privateLocators.map((locator) => `source: \`${locator}\``).join("\n"))

  for (const locator of privateLocators) assert.equal(html.includes(locator), false, locator)
  assert.equal(html.match(/【本机路径已隐藏】/gu)?.length, privateLocators.length)
})

test("renderControlledMarkdown preserves LaTeX spacing, references, and citations while hiding real UNC paths", () => {
  const latex = String.raw`$$A &= B \\[-2mm]\mathbf{x} &= \mathbf{y}$$`
  const reference = String.raw`As shown in Theorem~\ref{thm:main}, the claim follows.`
  const citation = String.raw`Prior work~\cite{nedic2017} proves the baseline.`
  const uncPath = ["", "", "server-01", "private-share", "secret.csv"].join("\\")
  const html = renderControlledMarkdown([latex, reference, citation, uncPath].join("\n"))

  assert.match(html, /\\\\\[-2mm\]\\mathbf\{x\}/u)
  assert.match(html, /Theorem~\\ref\{thm:main\}/u)
  assert.match(html, /work~\\cite\{nedic2017\}/u)
  assert.equal(html.includes(uncPath), false)
  assert.equal(html.match(/【本机路径已隐藏】/gu)?.length, 1)
})

test("renderControlledMarkdown does not treat mathematical primes or possessives as path quotes", () => {
  const privatePath = ["", "Users", "example", "Papers", "file.csv"].join("/")
  const primeLine = `Compare x' from ${privatePath} with y' in Theorem 2.`
  const derivativeLine = `Derivative f' is bounded whereas g' is symbolic.`
  const possessiveLine = `The authors' proof and reviewers' notes agree.`
  const html = renderControlledMarkdown([primeLine, derivativeLine, possessiveLine].join("\n"))

  assert.equal(html.includes(privatePath), false)
  assert.match(html, /Compare x&#39; from 【本机路径已隐藏】 with y&#39; in Theorem 2/u)
  assert.match(html, /Derivative f&#39; is bounded whereas g&#39; is symbolic/u)
  assert.match(html, /authors&#39; proof and reviewers&#39; notes agree/u)
})

test("renderControlledMarkdown preserves ordinary prose after an unquoted private locator", () => {
  const macPath = ["", "Users", "example", "run.csv"].join("/")
  const linuxPath = ["", "home", "example", "result.csv"].join("/")
  const directoryPath = ["", "Users", "example", "results"].join("/")
  const html = renderControlledMarkdown([
    `The result is stored at ${macPath}. The proof rate is O(1/T).`,
    `See ${linuxPath} and compare against Theorem 2.`,
    `Directory ${directoryPath}, compare x/y with the baseline.`,
    `目录 ${directoryPath}，比较 x/y 与基线。`,
    `目录 ${directoryPath}，随后比较 x/y 与基线。`,
    `目录 ${directoryPath}，接着分析 A/B。`,
    `目录 ${directoryPath}，本文比较 x/y。`,
    `Directory ${directoryPath}, next compare x/y.`,
    `Directory ${directoryPath}, we compare x/y.`,
    `Directory ${directoryPath}, the ratio x/y is bounded.`,
  ].join("\n"))

  assert.equal(html.includes(macPath), false)
  assert.equal(html.includes(linuxPath), false)
  assert.match(html, /The proof rate is O\(1\/T\)/u)
  assert.match(html, /and compare against Theorem 2/u)
  assert.match(html, /compare x\/y with the baseline/u)
  assert.match(html, /比较 x\/y 与基线/u)
  assert.match(html, /随后比较 x\/y 与基线/u)
  assert.match(html, /接着分析 A\/B/u)
  assert.match(html, /本文比较 x\/y/u)
  assert.match(html, /next compare x\/y/u)
  assert.match(html, /we compare x\/y/u)
  assert.match(html, /the ratio x\/y is bounded/u)
})

test("renderControlledMarkdown preserves slash-separated academic ratios and workflow terms", () => {
  const ordinaryText = [
    "The competitive ratio ALG/OPT/T is bounded.",
    "The loss/OPT/n term vanishes.",
    "The mean/var/n statistic converges.",
    "The build/run/test workflow is reported.",
  ].join("\n")
  const html = renderControlledMarkdown(ordinaryText)

  for (const value of ["ALG/OPT/T", "loss/OPT/n", "mean/var/n", "build/run/test"]) {
    assert.equal(html.includes(value), true, value)
  }
  assert.equal(html.includes("【本机路径已隐藏】"), false)
})

test("renderControlledMarkdown preserves public HTTPS and DOI text containing path-like terms", () => {
  const safeUrls = [
    ["https://example.org", "Users", "example", "paper.pdf"].join("/"),
    ["https://example.org", "mnt", "c", "Users", "example", "paper.md"].join("/"),
    ["https://example.org/articles_(2026)", "Users", "example", "paper.pdf"].join("/"),
    ["https://example.org/a,b", "Users", "example", "paper.pdf"].join("/"),
    ["https://example.org/a;b", "Users", "example", "paper.pdf"].join("/"),
    "https://doi.org/10.1000/file:appendix",
  ]
  const html = renderControlledMarkdown(safeUrls.join("\n"))

  for (const safeUrl of safeUrls) assert.equal(html.includes(safeUrl), true, safeUrl)
})

test("renderControlledMarkdown does not extend the public URL exemption into queries, fragments, or following prose", () => {
  const queryPath = ["", "Users", "query-owner", "Hidden Query", "private.csv"].join("/")
  const fragmentPath = ["file:", "", "", "Users", "fragment-owner", "Hidden Fragment", "private.csv"].join("/")
  const adjacentPath = ["", "Users", "adjacent-owner", "Hidden Adjacent", "private.csv"].join("/")
  const privateValues = [
    `https://example.org/open?path=${queryPath}`,
    `https://example.org/#file=${fragmentPath}`,
    `公开：https://example.org/paper；本机：${adjacentPath}`,
    `参考(https://example.org/paper)，路径(${adjacentPath})`,
    `https://example.org/paper,${adjacentPath}`,
  ]
  const html = renderControlledMarkdown(privateValues.join("\n"))

  for (const forbidden of [queryPath, fragmentPath, adjacentPath, "Hidden Query", "Hidden Fragment", "Hidden Adjacent"]) {
    assert.equal(html.includes(forbidden), false, forbidden)
  }
  assert.equal(html.match(/【本机路径已隐藏】/gu)?.length, 5)
})

test("renderControlledMarkdown finds private locators adjacent to prose without redacting public URLs", () => {
  const posixPath = ["", "Users", "example", "Secret Grant", "private.csv"].join("/")
  const punctuatedPath = ["", "Users", "example", "Optimization, Control and Learning", "results", "private.csv"].join("/")
  const fullwidthPath = ["", "Users", "example", "隐私保护：方法与应用", "results", "private.csv"].join("/")
  const vscodePath = `vscode://file${posixPath}`
  const publicUrl = `https://example.org${posixPath}`
  const html = renderControlledMarkdown([
    `结果位于${posixPath}，请核验。`,
    `stored-at: ${posixPath} and continue.`,
    `标点路径位于${punctuatedPath}，然后继续。`,
    `全角标点位于${fullwidthPath}；然后继续。`,
    `编辑器：\`${vscodePath}\`。`,
    `公开链接：${publicUrl}`,
  ].join("\n"))

  assert.equal(html.includes(vscodePath), false)
  assert.equal(html.includes(punctuatedPath), false)
  assert.equal(html.includes(fullwidthPath), false)
  assert.equal(html.includes("Control/results"), false)
  assert.equal(html.includes("方法与应用/results"), false)
  assert.equal(html.includes(publicUrl), true)
  assert.equal(html.match(/【本机路径已隐藏】/gu)?.length, 5)
  assert.match(html, /结果位于【本机路径已隐藏】，请核验/u)
  assert.match(html, /stored-at: 【本机路径已隐藏】 and continue/u)
})

test("renderControlledMarkdown redacts locators immediately following metadata keys", () => {
  const posixPath = ["", "Users", "example", "SecretProject", "result.csv"].join("/")
  const fileUrl = ["file:", "", "", "Users", "example", "SecretProject", "result.csv"].join("/")
  const windowsPath = ["C:", "Users", "example", "SecretProject", "result.csv"].join("\\")
  const html = renderControlledMarkdown([
    `Path:${posixPath}`,
    `source:${fileUrl}`,
    `path:${windowsPath}`,
  ].join("\n"))

  for (const privateValue of [posixPath, fileUrl, windowsPath, "SecretProject", "result.csv"]) {
    assert.equal(html.includes(privateValue), false, privateValue)
  }
})

test("renderControlledMarkdown handles unquoted spaces and apostrophes without leaking suffixes", () => {
  const spacedPath = ["", "Users", "example", "My Research Papers", "Secret Draft", "result final.csv"].join("/")
  const academicPath = ["", "Users", "example", "Optimization Control and Learning", "results", "private.csv"].join("/")
  const apostrophePath = ["C:", "Users", "O'Brien", "Secret", "result.csv"].join("\\")
  const html = renderControlledMarkdown(`Compare ${spacedPath} and ${apostrophePath} with ${academicPath} against the baseline.`)

  for (const privateValue of [spacedPath, academicPath, apostrophePath, "Research Papers", "Secret Draft", "result final.csv", "Control and Learning", "O'Brien", "Secret\\result.csv"]) {
    assert.equal(html.includes(privateValue), false, privateValue)
  }
  assert.match(html, / and /u)
  assert.match(html, / with /u)
  assert.match(html, /against the baseline/u)
})

test("renderControlledMarkdown hides bare extensionless directories with title punctuation", () => {
  const privateDirectory = ["", "Users", "alice", "Papers", "Optimization, Control and Learning", "results"].join("/")
  const html = renderControlledMarkdown([
    `目录 ${privateDirectory}，后文。`,
    `Directory ${privateDirectory}, later text.`,
    "The competitive ratio x/y remains visible.",
  ].join("\n"))

  assert.equal(html.includes(privateDirectory), false)
  assert.equal(html.includes("Control and Learning/results"), false)
  assert.match(html, /目录 【本机路径已隐藏】，后文/u)
  assert.match(html, /Directory 【本机路径已隐藏】, later text/u)
  assert.match(html, /competitive ratio x\/y remains visible/u)
})

test("renderControlledMarkdown preserves code surrounding a redacted locator", () => {
  const privatePath = ["", "Users", "example", "My Papers", "file.csv"].join("/")
  const html = renderControlledMarkdown([
    `code \`load(${privatePath}); theorem()\` stays`,
    `quoted "See ${privatePath} for details" stays`,
    "",
    "```python",
    `data = load(${privatePath}); theorem = prove(data)`,
    "```",
  ].join("\n"))

  assert.equal(html.includes(privatePath), false)
  assert.match(html, /theorem\(\)/u)
  assert.match(html, /See 【本机路径已隐藏】 for details/u)
  assert.match(html, /theorem = prove\(data\)/u)
  assert.match(html, /stays/u)
})

test("renderControlledMarkdown treats academic-title punctuation as part of delimited paths", () => {
  const englishPath = ["", "Users", "example", "Papers", "Optimization, Control, and Learning", "results", "private.csv"].join("/")
  const chinesePath = ["", "Users", "example", "论文", "优化，控制与学习", "结果", "private.csv"].join("/")
  const windowsPath = ["C:", "Users", "example", "Optimization; Control", "private.csv"].join("\\")
  const curvedDirectoryPath = ["", "Users", "example", "Papers", "Optimization, Control", "results"].join("/")
  const curvedFilePath = ["", "Users", "example", "Papers", "file.csv backup"].join("/")
  const html = renderControlledMarkdown([
    `inline \`${englishPath}\` after-inline`,
    `[link](${chinesePath}) after-link`,
    `中文双引号“${curvedDirectoryPath}”结束`,
    `中文单引号‘${curvedFilePath}’结束`,
    "```text",
    `load(\"${windowsPath}\"); keep()`,
    "```",
  ].join("\n"))

  for (const privateValue of [
    englishPath,
    chinesePath,
    windowsPath,
    curvedDirectoryPath,
    curvedFilePath,
    "Control, and Learning",
    "控制与学习",
    "Control\\private.csv",
    "Control/results",
    "file.csv backup",
  ]) {
    assert.equal(html.includes(privateValue), false, privateValue)
  }
  assert.match(html, /after-inline/u)
  assert.match(html, /after-link/u)
  assert.match(html, /keep\(\)/u)
})

test("renderControlledMarkdown redacts extensionless directories and ignores dotted intermediate segments", () => {
  const directoryPath = ["", "Users", "example", "Papers", "Optimization, Control and Learning", "results"].join("/")
  const versionedPath = ["", "Users", "example", "Papers", "Paper v1.2, final", "results", "private.csv"].join("/")
  const dottedDirectoryPath = ["", "Users", "example", "Papers", "file.csv backup", "results", "private.png"].join("/")
  const pseudoExtensionTail = ["", "Users", "example", "Papers", "file.csv backup"].join("/")
  const parenthesizedTail = ["", "Users", "example", "Papers", "file.csv (backup)"].join("/")
  const html = renderControlledMarkdown([
    `directory \`${directoryPath}\` remains-private`,
    `versioned \`${versionedPath}\` remains-private`,
    `dotted \`${dottedDirectoryPath}\` remains-private`,
    `assigned \`source=${directoryPath}\` remains-private`,
    `suffix \`${pseudoExtensionTail}\` remains-private`,
    `parenthesized \`${parenthesizedTail}\` remains-private`,
  ].join("\n"))

  for (const privateValue of [
    directoryPath,
    versionedPath,
    dottedDirectoryPath,
    pseudoExtensionTail,
    parenthesizedTail,
    "Control and Learning/results",
    "final/results/private.csv",
    "backup/results/private.png",
    "file.csv backup",
    "file.csv (backup)",
  ]) {
    assert.equal(html.includes(privateValue), false, privateValue)
  }
  assert.equal(html.match(/remains-private/gu)?.length, 6)
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
