import { normalizeRelativePath } from "./ids.mjs"

const SAFE_LANGUAGE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const IMAGE_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/iu

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function safeLanguageToken(rawLanguage) {
  const token = rawLanguage.trim().toLowerCase()
  if (!SAFE_LANGUAGE.test(token) || token === "mermaid") return null
  return token
}

const CALLOUT_TYPES = new Set([
  "algorithm", "caution", "important", "info", "note", "quote", "tip", "warning",
])

function escapedAt(value, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function closingToken(value, token, from) {
  for (let index = from; index <= value.length - token.length; index += 1) {
    if (value.startsWith(token, index) && !escapedAt(value, index)) return index
  }
  return -1
}

function stripLeadingFrontmatter(lines, calloutDepth) {
  if (calloutDepth !== 0 || lines[0]?.trim() !== "---") return lines
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex === -1) return lines
  const hasYamlProperty = lines
    .slice(1, closingIndex)
    .some((line) => /^[\p{L}\p{N}_-]+[ \t]*:/u.test(line))
  return hasYamlProperty ? lines.slice(closingIndex + 1) : lines
}

function displayMathAt(lines, lineIndex, openingIndex) {
  const firstLine = lines[lineIndex].slice(openingIndex + 2)
  const sameLineClosing = closingToken(firstLine, "$$", 0)
  if (sameLineClosing !== -1) {
    return {
      closingLineIndex: lineIndex,
      suffix: firstLine.slice(sameLineClosing + 2),
      value: firstLine.slice(0, sameLineClosing).trim(),
    }
  }

  const mathLines = [firstLine]
  for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
    if (/^```/u.test(lines[cursor])) return null
    const closingIndex = closingToken(lines[cursor], "$$", 0)
    if (closingIndex !== -1) {
      mathLines.push(lines[cursor].slice(0, closingIndex))
      return {
        closingLineIndex: cursor,
        suffix: lines[cursor].slice(closingIndex + 2),
        value: mathLines.join("\n").trim(),
      }
    }
    mathLines.push(lines[cursor])
  }
  return null
}

function imageEmbedAt(source, index) {
  if (!source.startsWith("![[", index) || escapedAt(source, index)) return null
  const closing = closingToken(source, "]]", index + 3)
  if (closing === -1) return null
  const raw = source.slice(index + 3, closing)
  const separator = raw.indexOf("|")
  const target = (separator === -1 ? raw : raw.slice(0, separator)).trim()
  if (!IMAGE_EXTENSION.test(target)) return null
  const modifier = separator === -1 ? "" : raw.slice(separator + 1).trim()
  const dimensions = /^(\d{1,4})(?:x(\d{1,4}))?$/u.exec(modifier)
  return {
    closing,
    reference: {
      target,
      label: modifier && !dimensions ? modifier : null,
      width: dimensions ? Number(dimensions[1]) : null,
      height: dimensions?.[2] ? Number(dimensions[2]) : null,
    },
  }
}

function markdownImageAt(source, index) {
  if (!source.startsWith("![", index) || source.startsWith("![[", index) || escapedAt(source, index)) return null
  const labelClosing = closingToken(source, "]", index + 2)
  if (labelClosing === -1 || source[labelClosing + 1] !== "(") return null
  const targetClosing = closingToken(source, ")", labelClosing + 2)
  if (targetClosing === -1) return null
  let target = source.slice(labelClosing + 2, targetClosing).trim()
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim()
  if (!IMAGE_EXTENSION.test(target)) return null
  const label = source.slice(index + 2, labelClosing).trim()
  return {
    closing: targetClosing,
    reference: {
      target,
      label: label || null,
      width: null,
      height: null,
    },
  }
}

function imageAlt(reference) {
  if (reference.label) return reference.label
  return reference.target.split("/").at(-1) || "论文图片"
}

function renderInline(value, depth = 0, options = {}) {
  const source = String(value ?? "")
  if (depth > 8) return escapeHtml(source)
  const output = []

  for (let index = 0; index < source.length;) {
    if (
      source[index] === "`"
      && source[index - 1] !== "`"
      && source[index + 1] !== "`"
      && !escapedAt(source, index)
    ) {
      const closing = closingToken(source, "`", index + 1)
      if (closing > index + 1 && source[closing - 1] !== "`" && source[closing + 1] !== "`") {
        output.push(`<code>${escapeHtml(source.slice(index + 1, closing))}</code>`)
        index = closing + 1
        continue
      }
    }

    const imageEmbed = imageEmbedAt(source, index)
    if (imageEmbed) {
      const resolved = typeof options.resolveImage === "function"
        ? options.resolveImage({ ...imageEmbed.reference })
        : null
      if (resolved?.status === "resolved" && typeof resolved.src === "string" && resolved.src) {
        const dimensions = [
          imageEmbed.reference.width ? ` width="${imageEmbed.reference.width}"` : "",
          imageEmbed.reference.height ? ` height="${imageEmbed.reference.height}"` : "",
        ].join("")
        output.push(`<img class="note-image" src="${escapeHtml(resolved.src)}" alt="${escapeHtml(imageAlt(imageEmbed.reference))}" loading="lazy" decoding="async"${dimensions}>`)
      } else if (typeof options.resolveImage === "function") {
        output.push(`<span class="note-image-placeholder">图片未解析：${escapeHtml(imageAlt(imageEmbed.reference))}</span>`)
      } else {
        output.push(escapeHtml(source.slice(index, imageEmbed.closing + 2)))
      }
      index = imageEmbed.closing + 2
      continue
    }

    const markdownImage = markdownImageAt(source, index)
    if (markdownImage) {
      const resolved = typeof options.resolveImage === "function"
        ? options.resolveImage({ ...markdownImage.reference })
        : null
      if (resolved?.status === "resolved" && typeof resolved.src === "string" && resolved.src) {
        output.push(`<img class="note-image" src="${escapeHtml(resolved.src)}" alt="${escapeHtml(imageAlt(markdownImage.reference))}" loading="lazy" decoding="async">`)
      } else if (typeof options.resolveImage === "function") {
        output.push(`<span class="note-image-placeholder">图片未解析：${escapeHtml(imageAlt(markdownImage.reference))}</span>`)
      } else {
        output.push(escapeHtml(source.slice(index, markdownImage.closing + 1)))
      }
      index = markdownImage.closing + 1
      continue
    }

    if (source.startsWith("\\(", index) && !escapedAt(source, index)) {
      const closing = closingToken(source, "\\)", index + 2)
      if (closing !== -1 && closing > index + 2) {
        output.push(`<span class="math-inline">${escapeHtml(source.slice(index + 2, closing))}</span>`)
        index = closing + 2
        continue
      }
    }

    if (source[index] === "$" && source[index + 1] !== "$" && !escapedAt(source, index)) {
      const closing = closingToken(source, "$", index + 1)
      if (closing !== -1 && closing > index + 1 && source[closing + 1] !== "$") {
        output.push(`<span class="math-inline">${escapeHtml(source.slice(index + 1, closing))}</span>`)
        index = closing + 1
        continue
      }
    }

    if (source.startsWith("**", index) && !escapedAt(source, index)) {
      const closing = closingToken(source, "**", index + 2)
      if (closing !== -1 && closing > index + 2) {
        output.push(`<strong>${renderInline(source.slice(index + 2, closing), depth + 1, options)}</strong>`)
        index = closing + 2
        continue
      }
    }

    if (source[index] === "*" && !escapedAt(source, index)) {
      const closing = closingToken(source, "*", index + 1)
      if (closing !== -1 && closing > index + 1) {
        output.push(`<em>${renderInline(source.slice(index + 1, closing), depth + 1, options)}</em>`)
        index = closing + 1
        continue
      }
    }

    output.push(escapeHtml(source[index]))
    index += 1
  }

  return output.join("")
}

function tableCells(line) {
  const source = line.trim()
  if (!source.startsWith("|") || !source.endsWith("|")) return null
  const cells = []
  let cell = ""
  let inCode = false
  let inMath = false

  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index]
    if (character === "\\" && source[index + 1] === "|") {
      cell += "\\|"
      index += 1
      continue
    }
    if (character === "`" && !escapedAt(source, index)) inCode = !inCode
    if (character === "$" && !inCode && !escapedAt(source, index)) inMath = !inMath
    if (character === "|" && !inCode && !inMath) {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

function tableDelimiter(cells) {
  return Array.isArray(cells)
    && cells.length > 0
    && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replaceAll(/[ \t]/gu, "")))
}

function renderTable(header, rows, options) {
  const head = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell, 0, options)}</th>`).join("")}</tr></thead>`
  const body = rows.length === 0
    ? ""
    : `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, 0, options)}</td>`).join("")}</tr>`).join("")}</tbody>`
  return `<div class="note-table-scroll"><table>${head}${body}</table></div>`
}

function renderMath(value) {
  return `<div class="math-display" role="math"><code>${escapeHtml(value)}</code></div>`
}

export function renderControlledMarkdown(markdown, options = {}, calloutDepth = 0) {
  const normalizedLines = String(markdown ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
  const lines = stripLeadingFrontmatter(normalizedLines, calloutDepth)
  const output = []
  let paragraph = []
  let quote = []
  let list = []

  function flushParagraph() {
    if (paragraph.length === 0) return
    output.push(`<p>${renderInline(paragraph.join(" "), 0, options)}</p>`)
    paragraph = []
  }

  function flushQuote() {
    if (quote.length === 0) return
    output.push(`<blockquote>${renderInline(quote.join(" "), 0, options)}</blockquote>`)
    quote = []
  }

  function flushList() {
    if (list.length === 0) return
    output.push(`<ul>${list.map((item) => `<li>${renderInline(item, 0, options)}</li>`).join("")}</ul>`)
    list = []
  }

  function flushTextBlocks() {
    flushParagraph()
    flushQuote()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const closingIndex = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && /^```\s*$/.test(candidate))
      if (closingIndex !== -1) {
        flushTextBlocks()
        const language = safeLanguageToken(fence[1])
        const code = escapeHtml(lines.slice(index + 1, closingIndex).join("\n"))
        const className = language ? ` class="language-${language}"` : ""
        output.push(`<pre><code${className}>${code}</code></pre>`)
        index = closingIndex
        continue
      }
    }

    const displayOpening = closingToken(line, "$$", 0)
    if (displayOpening !== -1) {
      const displayMath = displayMathAt(lines, index, displayOpening)
      if (displayMath) {
        const prefix = line.slice(0, displayOpening).trimEnd()
        if (prefix) paragraph.push(prefix)
        flushTextBlocks()
        output.push(renderMath(displayMath.value))
        const suffix = displayMath.suffix.trimStart()
        if (suffix) paragraph.push(suffix)
        index = displayMath.closingLineIndex
        continue
      }
    }

    const headerCells = tableCells(line)
    const delimiterCells = index + 1 < lines.length ? tableCells(lines[index + 1]) : null
    if (headerCells && delimiterCells && headerCells.length === delimiterCells.length && tableDelimiter(delimiterCells)) {
      flushTextBlocks()
      const rows = []
      let cursor = index + 2
      while (cursor < lines.length) {
        const cells = tableCells(lines[cursor])
        if (!cells || cells.length !== headerCells.length) break
        rows.push(cells)
        cursor += 1
      }
      output.push(renderTable(headerCells, rows, options))
      index = cursor - 1
      continue
    }

    if (line.trim() === "") {
      flushTextBlocks()
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      flushTextBlocks()
      output.push("<hr>")
      continue
    }

    const heading = /^(#{1,6})[ \t]+(.+)$/.exec(line)
    if (heading) {
      flushTextBlocks()
      const level = heading[1].length
      output.push(`<h${level}>${renderInline(heading[2].trim(), 0, options)}</h${level}>`)
      continue
    }

    const blockQuote = /^>[ \t]?(.*)$/.exec(line)
    if (blockQuote) {
      const callout = /^\[!([a-z]+)\][+-]?[ \t]*(.*)$/iu.exec(blockQuote[1])
      const calloutType = callout?.[1]?.toLowerCase()
      if (callout && CALLOUT_TYPES.has(calloutType) && calloutDepth < 8) {
        flushTextBlocks()
        const body = []
        let cursor = index + 1
        while (cursor < lines.length) {
          const continuation = /^>[ \t]?(.*)$/u.exec(lines[cursor])
          if (!continuation) break
          body.push(continuation[1])
          cursor += 1
        }
        const title = callout[2].trim() || calloutType
        const bodyHtml = renderControlledMarkdown(body.join("\n"), options, calloutDepth + 1)
        output.push(`<aside class="note-callout note-callout--${calloutType}"><strong class="note-callout-title">${renderInline(title, 0, options)}</strong>${bodyHtml}</aside>`)
        index = cursor - 1
        continue
      }
      flushParagraph()
      flushList()
      quote.push(blockQuote[1])
      continue
    }

    const unordered = /^[*+-][ \t]+(.*)$/.exec(line)
    if (unordered) {
      flushParagraph()
      flushQuote()
      list.push(unordered[1])
      continue
    }

    flushQuote()
    flushList()
    paragraph.push(line)
  }

  flushTextBlocks()
  return output.join("\n")
}

function addWarning(paper, warning) {
  if (!Array.isArray(paper.warnings)) paper.warnings = []
  if (!paper.warnings.includes(warning)) paper.warnings.push(warning)
}

function canonicalRelativePath(value) {
  if (typeof value !== "string") return null
  try {
    const normalized = normalizeRelativePath(value)
    return normalized === value ? normalized : null
  } catch {
    return null
  }
}

export function choosePreferredNote({ paper, override }) {
  if (override?.preview_note !== true) return null
  const notes = Array.isArray(paper?.artifacts?.note) ? paper.artifacts.note : []

  if (override.preferred_note !== undefined) {
    const selectedPath = canonicalRelativePath(paper.preferred_note)
    const explicitPath = canonicalRelativePath(override.preferred_note)
    const paperPath = canonicalRelativePath(paper.relative_path)
    const sourceRelativeSelection = paperPath && selectedPath
      ? canonicalRelativePath(`${paperPath}/${selectedPath}`)
      : null
    const selectionsAgree = explicitPath !== null
      && (explicitPath === selectedPath || explicitPath === sourceRelativeSelection)
    const selected = selectionsAgree
      ? notes.find((note) => canonicalRelativePath(note.relative_path) === selectedPath)
      : null
    if (!selected) {
      addWarning(paper, "首选笔记与扫描结果不匹配")
      return null
    }
    return selected
  }

  if (paper.preferred_note !== null && paper.preferred_note !== undefined) {
    const selectedPath = canonicalRelativePath(paper.preferred_note)
    const selected = notes.find((note) => canonicalRelativePath(note.relative_path) === selectedPath)
    if (!selected) {
      addWarning(paper, "首选笔记与扫描结果不匹配")
      return null
    }
    return selected
  }

  if (notes.length === 1) return notes[0]
  if (notes.length === 0) addWarning(paper, "已请求预览，但尚无阅读笔记")
  else addWarning(paper, "存在多个笔记版本，待选择首选文件")
  return null
}
