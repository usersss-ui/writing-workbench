import { normalizeRelativePath } from "./ids.mjs"

const SAFE_LANGUAGE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const IMAGE_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/iu
const PRIVATE_PATH_PLACEHOLDER = "【本机路径已隐藏】"
const PRIVATE_LOCATOR_START_RE = /(?:vscode:\/\/file(?:\/{1,3}|\/[a-z]:[\\/])|~\/|\$(?:HOME|USERPROFILE)[\\/]|\$\{(?:HOME|USERPROFILE)\}[\\/]|%(?:HOME|USERPROFILE)%[\\/]|(?<![A-Za-z0-9_])[a-z]%3a(?:%2f|%5c)|file:(?:\/{1,3}|[a-z]:[\\/])|file%3a(?:(?:%2f){1,3}|[a-z]%3a(?:%2f|%5c))|(?<![A-Za-z0-9_])[a-z]:[\\/]|\\\\[A-Za-z0-9._-]+[\\/][^\\/\s`"'<>|,;!?，。；！？：、]+|(?<![A-Za-z0-9_\/%])\/+(?:Applications|Library|Network|System|Users|Volumes|bin|data|dev|etc|home|media|mnt|opt|private|proc|root|run|sbin|srv|tmp|usr|var|workspace)(?=\/)|(?<![A-Za-z0-9_\/%])%2f(?:Applications|Library|Network|System|Users|Volumes|bin|data|dev|etc|home|media|mnt|opt|private|proc|root|run|sbin|srv|tmp|usr|var|workspace)(?=%2f))/giu
const BARE_PRIVATE_LOCATOR_TERMINATOR_RE = /[`"<>|,;!?，。；！？：、]/u
const PATH_EXTENSION_RE = /\.[\p{L}\p{N}]{1,16}\.?$/u
const PATH_EXTENSION_TOKEN_RE = /\.[\p{L}\p{N}]{1,16}/gu
const WORD_CHARACTER_RE = /[\p{L}\p{N}]/u
const PROSE_AFTER_PATH_RE = /^\s+(?:after|against|and|are|before|for|from|in|is|or|that|then|the|to|was|were|where|which|with)\b/iu
const BRACKET_PAIRS = new Map([["(", ")"], ["[", "]"], ["{", "}"]])
const CLOSING_BRACKETS = new Set(BRACKET_PAIRS.values())

function findPrivateLocator(value, fromIndex = 0) {
  PRIVATE_LOCATOR_START_RE.lastIndex = fromIndex
  for (let match = PRIVATE_LOCATOR_START_RE.exec(value); match; match = PRIVATE_LOCATOR_START_RE.exec(value)) {
    if (!isInsidePublicHttpPath(value, match.index)) return match
  }
  return null
}

function hasBalancedUrlDelimiters(value) {
  const brackets = []
  for (const character of value) {
    if (BRACKET_PAIRS.has(character)) brackets.push(BRACKET_PAIRS.get(character))
    else if (CLOSING_BRACKETS.has(character)) {
      if (brackets.at(-1) !== character) return false
      brackets.pop()
    }
  }
  return brackets.length === 0
}

function isInsidePublicHttpPath(value, locatorIndex) {
  const prefix = value.slice(0, locatorIndex)
  let schemeIndex = -1
  for (const match of prefix.matchAll(/https?:\/\//giu)) schemeIndex = match.index
  if (schemeIndex < 0) return false

  const candidate = prefix.slice(schemeIndex)
  if (/[\s`"'<>|，。；！？：、]/u.test(candidate)) return false
  if (/[?#]/u.test(candidate) || /[,;]$/u.test(candidate)) return false
  if (!hasBalancedUrlDelimiters(candidate)) return false
  try {
    const parsed = new URL(candidate)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function hasPlausiblePathExtension(value) {
  const finalSegment = String(value).split(/[\\/]/u).at(-1) ?? ""
  return PATH_EXTENSION_RE.test(finalSegment)
}

function separatorLengthAt(value, index) {
  if (value[index] === "/" || value[index] === "\\") return 1
  return /^%(?:2f|5c)/iu.test(value.slice(index, index + 3)) ? 3 : 0
}

function isStrongContinuationBoundary(value, index) {
  const character = value[index]
  if (!character || /[\n\r!?。；！？]/u.test(character)) return true
  return character === "." && (!value[index + 1] || /\s/u.test(value[index + 1]))
}

function hasLetterExtensionAhead(value, fromIndex, requireSeparator) {
  const searchEnd = Math.min(value.length, fromIndex + 256)
  let sawSeparator = !requireSeparator
  let sawPrefixContent = false
  let sawInternalPrefixWhitespace = false
  for (let index = fromIndex; index < searchEnd; index += 1) {
    if (isStrongContinuationBoundary(value, index)) return false
    const separatorLength = separatorLengthAt(value, index)
    if (separatorLength > 0) {
      if (requireSeparator && sawInternalPrefixWhitespace) return false
      sawSeparator = true
      index += separatorLength - 1
      continue
    }
    if (!sawSeparator) {
      if (/\s/u.test(value[index])) {
        if (sawPrefixContent) sawInternalPrefixWhitespace = true
      } else {
        sawPrefixContent = true
      }
    }
    if (!sawSeparator || value[index] !== ".") continue
    const extension = /^[\p{L}][\p{L}\p{N}]{0,15}/u.exec(value.slice(index + 1))?.[0] ?? null
    if (extension && extensionBoundary(value[index + extension.length + 1])) return true
  }
  return false
}

function isShortAcademicRatio(value, separatorIndex, tail) {
  let leftStart = separatorIndex
  while (leftStart > 0 && /[A-Za-z]/u.test(value[leftStart - 1])) leftStart -= 1
  const left = value.slice(leftStart, separatorIndex)
  return /^[A-Za-z]{1,3}$/u.test(left) && /^[A-Za-z]{1,3}$/u.test(tail)
}

function hasTightPathTailAhead(value, fromIndex) {
  const searchEnd = Math.min(value.length, fromIndex + 256)
  let lastSeparatorIndex = -1
  let lastSeparatorEnd = -1

  for (let index = fromIndex; index <= searchEnd; index += 1) {
    if (index < searchEnd) {
      const separatorLength = separatorLengthAt(value, index)
      if (separatorLength > 0) {
        lastSeparatorIndex = index
        lastSeparatorEnd = index + separatorLength
        index += separatorLength - 1
        continue
      }
    }

    const atCheckpoint = index === searchEnd || /[,;，；：、]/u.test(value[index] ?? "") || isStrongContinuationBoundary(value, index)
    if (!atCheckpoint) continue

    if (lastSeparatorEnd >= fromIndex) {
      const tail = value.slice(lastSeparatorEnd, index)
      if (
        tail
        && !/\s/u.test(tail)
        && !isShortAcademicRatio(value, lastSeparatorIndex, tail)
      ) return true
    }
    if (isStrongContinuationBoundary(value, index)) return false
  }
  return false
}

function shouldContinueAfterWhitespace(value, locatorStart, whitespaceIndex) {
  const prefixHasExtension = hasPlausiblePathExtension(value.slice(locatorStart, whitespaceIndex))
  const continuationStart = whitespaceIndex + 1
  return hasLetterExtensionAhead(value, continuationStart, prefixHasExtension)
    || (!prefixHasExtension && hasTightPathTailAhead(value, continuationStart))
}

function shouldContinueAfterPunctuation(value, locatorStart, punctuationIndex) {
  const prefixHasExtension = hasPlausiblePathExtension(value.slice(locatorStart, punctuationIndex))
  const continuationStart = punctuationIndex + 1
  return hasLetterExtensionAhead(value, continuationStart, true)
    || (!prefixHasExtension && hasTightPathTailAhead(value, continuationStart))
}

function collectDelimitedRanges(value) {
  const ranges = []

  for (let index = 0; index < value.length;) {
    if (value[index] !== "`") {
      index += 1
      continue
    }
    let markerLength = 1
    while (value[index + markerLength] === "`") markerLength += 1
    const marker = "`".repeat(markerLength)
    const closingIndex = value.indexOf(marker, index + markerLength)
    if (closingIndex < 0) break
    ranges.push({ start: index + markerLength, end: closingIndex })
    index = closingIndex + markerLength
  }

  for (let searchFrom = 0; searchFrom < value.length;) {
    const markerIndex = value.indexOf("](", searchFrom)
    if (markerIndex < 0) break
    const contentStart = markerIndex + 2
    let depth = 1
    let contentEnd = contentStart
    for (; contentEnd < value.length; contentEnd += 1) {
      if (value[contentEnd] === "\\") {
        contentEnd += 1
        continue
      }
      if (value[contentEnd] === "(") depth += 1
      if (value[contentEnd] === ")") depth -= 1
      if (depth === 0) break
    }
    if (depth !== 0) break
    ranges.push({ start: contentStart, end: contentEnd })
    searchFrom = contentEnd + 1
  }

  for (const [openingQuote, closingQuote] of [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"]]) {
    let openingIndex = -1
    for (let index = 0; index < value.length; index += 1) {
      if (escapedAt(value, index)) continue
      const expectedQuote = openingIndex < 0 ? openingQuote : closingQuote
      if (value[index] !== expectedQuote) continue
      if (expectedQuote === "'") {
        const adjacentCharacter = openingIndex < 0 ? value[index - 1] : value[index + 1]
        if (WORD_CHARACTER_RE.test(adjacentCharacter ?? "")) continue
      }
      if (openingIndex < 0) {
        openingIndex = index
        continue
      }
      ranges.push({ start: openingIndex + 1, end: index })
      openingIndex = -1
    }
  }

  return ranges
}

function containingDelimitedRange(ranges, index) {
  return ranges
    .filter((range) => range.start <= index && index < range.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] ?? null
}

function extensionBoundary(character) {
  return !character || /[\s`"'<>|,;!?，。；！？：、)\]}]/u.test(character)
}

function findDelimitedCodeBoundary(value, fromIndex, rangeEnd) {
  const brackets = []
  for (let index = fromIndex; index < rangeEnd; index += 1) {
    const character = value[index]
    if (BRACKET_PAIRS.has(character)) {
      brackets.push(BRACKET_PAIRS.get(character))
      continue
    }
    if (CLOSING_BRACKETS.has(character)) {
      if (brackets.at(-1) !== character) return index
      brackets.pop()
      continue
    }
    if ((character === ";" || character === "`" || character === "\"" || character === "'") && brackets.length === 0) return index
  }
  return rangeEnd
}

function pathSeparatorAheadBeforeCodeBoundary(value, fromIndex, rangeEnd) {
  for (let index = fromIndex; index < rangeEnd; index += 1) {
    if (value[index] === "/" || value[index] === "\\") return true
  }
  return false
}

function findDelimitedLocatorEnd(value, locatorStart, fromIndex, range) {
  const searchEnd = findDelimitedCodeBoundary(value, fromIndex, range.end)
  let lastExtensionEnd = null
  PATH_EXTENSION_TOKEN_RE.lastIndex = fromIndex
  for (let match = PATH_EXTENSION_TOKEN_RE.exec(value); match && match.index < searchEnd; match = PATH_EXTENSION_TOKEN_RE.exec(value)) {
    const end = match.index + match[0].length
    if (
      end <= searchEnd
      && extensionBoundary(value[end])
      && !pathSeparatorAheadBeforeCodeBoundary(value, end, searchEnd)
    ) lastExtensionEnd = end
  }
  if (searchEnd === range.end) {
    if (lastExtensionEnd !== null && PROSE_AFTER_PATH_RE.test(value.slice(lastExtensionEnd, range.end))) {
      return lastExtensionEnd
    }
    return range.end
  }
  if (lastExtensionEnd !== null) return lastExtensionEnd
  if (locatorStart === range.start) return range.end
  return searchEnd
}

function findBareLocatorEnd(value, locatorStart, fromIndex) {
  const brackets = []
  let punctuationContinuation = false
  for (let index = fromIndex; index < value.length; index += 1) {
    const character = value[index]
    if (character === "/" || character === "\\") punctuationContinuation = false
    if (/^%(?:2f|5c)/iu.test(value.slice(index, index + 3))) punctuationContinuation = false
    if (BRACKET_PAIRS.has(character)) {
      brackets.push(BRACKET_PAIRS.get(character))
      continue
    }
    if (CLOSING_BRACKETS.has(character)) {
      if (brackets.at(-1) !== character) return index
      brackets.pop()
      continue
    }
    if (/\s/u.test(character)) {
      if (brackets.length > 0 || punctuationContinuation || shouldContinueAfterWhitespace(value, locatorStart, index)) continue
      return index
    }
    if (character === "'") {
      const previous = value[index - 1] ?? ""
      const next = value[index + 1] ?? ""
      if (WORD_CHARACTER_RE.test(previous) && WORD_CHARACTER_RE.test(next)) continue
      return index
    }
    if (BARE_PRIVATE_LOCATOR_TERMINATOR_RE.test(character) && brackets.length === 0) {
      if (
        /[,;，；：、]/u.test(character)
        && (punctuationContinuation || shouldContinueAfterPunctuation(value, locatorStart, index))
      ) {
        punctuationContinuation = true
        continue
      }
      return index
    }
  }
  return value.length
}

function redactBarePrivateLocators(value, delimitedRanges = []) {
  let cursor = 0
  let output = ""
  while (cursor < value.length) {
    const match = findPrivateLocator(value, cursor)
    if (!match) break
    const delimitedRange = containingDelimitedRange(delimitedRanges, match.index)
    const delimitedEnd = delimitedRange
      ? findDelimitedLocatorEnd(value, match.index, match.index + match[0].length, delimitedRange)
      : null
    const end = delimitedEnd ?? findBareLocatorEnd(value, match.index, match.index + match[0].length)
    output += `${value.slice(cursor, match.index)}${PRIVATE_PATH_PLACEHOLDER}`
    cursor = end
  }
  return `${output}${value.slice(cursor)}`
}

function redactPrivateLocators(value) {
  const lines = String(value ?? "").split("\n")
  let fence = null
  return lines.map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null
      return redactBarePrivateLocators(line)
    }
    const ranges = fence
      ? [{ start: 0, end: line.length }, ...collectDelimitedRanges(line)]
      : collectDelimitedRanges(line)
    return redactBarePrivateLocators(line, ranges)
  }).join("\n")
}

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
  const normalizedLines = redactPrivateLocators(markdown).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
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
