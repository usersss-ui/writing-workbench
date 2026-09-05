import { normalizeDiscoveryRecord } from "./discovery-record.mjs"
import { normalizeDoi, safeHttpsUrl } from "./bibliography-normalization.mjs"

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 500
const BIB_FIELDS = new Set(["title", "author", "year", "doi", "url", "journal", "issn", "abstract", "language"])
const RIS_FIELDS = new Map([
  ["TI", "title"], ["T1", "title"], ["AU", "author"], ["A1", "author"],
  ["PY", "year"], ["Y1", "year"], ["DO", "doi"], ["UR", "url"],
  ["JO", "journal"], ["JF", "journal"], ["T2", "journal"],
  ["SN", "issn"], ["AB", "abstract"], ["LA", "language"],
])
const LANGUAGES = new Map([
  ["en", "en"], ["eng", "en"], ["english", "en"], ["英文", "en"], ["英语", "en"],
  ["zh", "zh"], ["zho", "zh"], ["chi", "zh"], ["chinese", "zh"], ["中文", "zh"], ["汉语", "zh"],
])
const UNREPORTED_LANGUAGES = new Set(["unknown", "und", "not reported", "n/a", "未知", "未报告"])
const BIB_TYPES = new Map([["article", "article"], ["book", "book"], ["inbook", "book-chapter"],
  ["incollection", "book-chapter"], ["inproceedings", "proceedings-article"], ["proceedings", "proceedings"],
  ["phdthesis", "dissertation"], ["mastersthesis", "dissertation"], ["techreport", "report"]])
const RIS_TYPES = new Map([["JOUR", "article"], ["BOOK", "book"], ["CHAP", "book-chapter"],
  ["CPAPER", "proceedings-article"], ["CONF", "proceedings"], ["THES", "dissertation"], ["RPRT", "report"]])

function syntax(message, offset) { throw new SyntaxError(`${message}：${offset}`) }
function checkFormat(format) {
  if (format !== "bibtex" && format !== "ris") throw new TypeError("仅支持 BibTeX 或 RIS")
}
function checkSize(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new RangeError("导入文件超过 2 MiB")
}
function addEntry(entries, entry) {
  if (entries.length >= MAX_ENTRIES) throw new RangeError("导入题录超过 500 条")
  entries.push(entry)
}
function addField(entry, name, value) {
  const field = { name, parts: [value] }
  entry.fields.push(field)
  return field
}

function parseRis(text, warnings) {
  const entries = []
  let current = null
  let previous = null
  let offset = 0
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9]{2}) {2}- ?(.*)$/u.exec(line)
    if (match) {
      const [, tag, value] = match
      if (tag === "TY") {
        if (current || !value.trim()) syntax("RIS TY 无效", offset)
        current = { type: value.trim(), fields: [] }
        previous = null
      } else if (tag === "ER") {
        if (!current || value.trim()) syntax("RIS ER 无效", offset)
        addEntry(entries, current)
        current = null
        previous = null
      } else {
        if (!current) syntax("RIS 字段缺少 TY", offset)
        const name = RIS_FIELDS.get(tag)
        previous = name ? addField(current, name, value) : null
        if (!name) warnings.push(`忽略 RIS 字段 ${tag}（位置 ${offset}）`)
      }
    } else if (line.trim()) {
      if (!current || !/^\s/u.test(line)) syntax("RIS 续行无效", offset)
      if (previous) previous.parts.push(line)
    }
    offset += line.length + 1
  }
  if (current) syntax("RIS 缺少 ER", offset)
  return entries
}

// Each cursor advances monotonically. Backslash pairs are consumed together,
// so an even run never hides a structural quote or brace.
function parseBibtex(text, warnings) {
  const entries = []
  let cursor = 0
  function skipSpace() {
    while (cursor < text.length) {
      if (/\s/u.test(text[cursor])) cursor += 1
      else if (text[cursor] === "%") {
        while (cursor < text.length && text[cursor] !== "\n") cursor += 1
      } else break
    }
  }
  function identifier() {
    const start = cursor
    while (cursor < text.length && /[a-z0-9_-]/iu.test(text[cursor])) cursor += 1
    if (cursor === start) syntax("缺少 BibTeX 标识符", cursor)
    return text.slice(start, cursor).toLowerCase()
  }
  function grouped(open, baseDepth) {
    const start = cursor++
    const begin = cursor
    let depth = baseDepth + (open === "{" ? 1 : 0)
    const minimum = baseDepth
    if (depth > 16) syntax("花括号层级无效", start)
    while (cursor < text.length) {
      const character = text[cursor]
      if (character === "\\") {
        cursor += 2
        continue
      }
      if (character === "{") {
        depth += 1
        if (depth > 16) syntax("花括号层级无效", cursor)
      } else if (character === "}") {
        depth -= 1
        if (open === "{" && depth === minimum) return text.slice(begin, cursor++)
        if (depth < minimum) syntax("花括号层级无效", cursor)
      } else if (character === '"' && open === '"' && depth === minimum) {
        return text.slice(begin, cursor++)
      }
      cursor += 1
    }
    syntax("BibTeX 内容未闭合", start)
  }
  function skipComment(open) {
    if (open === "{") { grouped("{", 0); return }
    const start = cursor++
    while (cursor < text.length) {
      if (text[cursor] === "{") grouped("{", 0)
      else if (text[cursor] === '"') grouped('"', 0)
      else if (text[cursor] === "\\") cursor += 2
      else if (text[cursor] === ")") { cursor += 1; return }
      else if (text[cursor] === "}") syntax("花括号层级无效", cursor)
      else cursor += 1
    }
    syntax("BibTeX 注释未闭合", start)
  }
  skipSpace()
  while (cursor < text.length) {
    if (text[cursor++] !== "@") syntax("缺少 BibTeX entry", cursor - 1)
    const type = identifier()
    if (type === "string" || type === "preamble") syntax(`不支持 @${type}`, cursor)
    skipSpace()
    const open = text[cursor]
    if (open !== "{" && open !== "(") syntax("缺少 entry 起始符", cursor)
    if (type === "comment") { skipComment(open); skipSpace(); continue }
    const close = open === "{" ? "}" : ")"
    const baseDepth = open === "{" ? 1 : 0
    cursor += 1
    skipSpace()
    const keyStart = cursor
    while (cursor < text.length && !/[\s,{}()="%#]/u.test(text[cursor])) cursor += 1
    if (cursor === keyStart) syntax("缺少引用 key", cursor)
    skipSpace()
    const entry = { type, fields: [] }
    if (text[cursor] !== "," && text[cursor] !== close) syntax("缺少 key 分隔符", cursor)
    if (text[cursor] === ",") cursor += 1
    skipSpace()
    while (cursor < text.length && text[cursor] !== close) {
      const fieldOffset = cursor
      const name = identifier()
      skipSpace()
      if (text[cursor++] !== "=") syntax("缺少字段等号", cursor - 1)
      skipSpace()
      let value
      if (text[cursor] === "{" || text[cursor] === '"') value = grouped(text[cursor], baseDepth)
      else {
        const start = cursor
        while (cursor < text.length && /[0-9]/u.test(text[cursor])) cursor += 1
        if (cursor === start) syntax("不支持宏或无效字段值", cursor)
        value = text.slice(start, cursor)
      }
      if (BIB_FIELDS.has(name)) addField(entry, name, value)
      else warnings.push(`忽略 BibTeX 字段 ${name.slice(0, 80)}（位置 ${fieldOffset}）`)
      skipSpace()
      if (text[cursor] === "#") syntax("不支持宏拼接", cursor)
      if (text[cursor] === ",") { cursor += 1; skipSpace() }
      else if (text[cursor] !== close) syntax("缺少字段分隔符", cursor)
    }
    if (text[cursor] !== close) syntax("BibTeX entry 未闭合", cursor)
    cursor += 1
    addEntry(entries, entry)
    skipSpace()
  }
  return entries
}

function decodeBibtex(value) {
  return value.replace(/\\([\\{}"%&#_$])/gu, "$1")
}
function splitAuthors(value) {
  const authors = []
  let depth = 0
  let start = 0
  for (let offset = 0; offset < value.length; offset += 1) {
    if (value[offset] === "\\") { offset += 1; continue }
    if (value[offset] === "{") depth += 1
    else if (value[offset] === "}") depth -= 1
    else if (depth === 0 && value.slice(offset, offset + 3).toLowerCase() === "and" &&
      /\s/u.test(value[offset - 1] || "") && /\s/u.test(value[offset + 3] || "")) {
      authors.push(value.slice(start, offset - 1))
      start = offset + 4
      offset += 3
    }
  }
  authors.push(value.slice(start))
  return authors.map((author) => {
    // Strip only a complete structural group; escaped and inner braces are
    // descriptive text. Preserve surrounding whitespace for Record's bounds.
    const group = author.trim()
    if (group.startsWith("{")) {
      let groupDepth = 0
      for (let offset = 0; offset < group.length; offset += 1) {
        if (group[offset] === "\\") { offset += 1; continue }
        if (group[offset] === "{") groupDepth += 1
        else if (group[offset] === "}") groupDepth -= 1
        if (groupDepth === 0) {
          if (offset === group.length - 1) {
            const begin = author.indexOf("{")
            return decodeBibtex(author.slice(0, begin) + group.slice(1, -1) + author.slice(begin + group.length))
          }
          break
        }
      }
    }
    return decodeBibtex(author)
  })
}
function boundedText(value, maximum, label) {
  if ([...value].length > maximum) throw new TypeError(`${label} 过长`)
  return value.trim() ? value : null
}
function convertEntry(entry, index, format, warnings) {
  const values = new Map()
  for (const { name, parts } of entry.fields) {
    const raw = parts.join(" ")
    const value = format === "bibtex" && name !== "author" ? decodeBibtex(raw) : raw
    if (!values.has(name)) values.set(name, [])
    values.get(name).push(value)
  }
  function first(name, maximum) {
    const items = values.get(name) || []
    for (const item of items) boundedText(item, maximum, name)
    if (items.length > 1) warnings.push(`第 ${index + 1} 条重复字段 ${name}，仅保留首项`)
    return items.length ? boundedText(items[0], maximum, name) : null
  }
  const title = first("title", 1000)
  if (title === null) {
    warnings.push(`第 ${index + 1} 条缺少题名，已排除`)
    return null
  }
  const authors = (values.get("author") || [])
    .flatMap((raw) => format === "bibtex" ? splitAuthors(raw) : [raw])
    .filter((author) => boundedText(author, 300, "作者") !== null)
  const year = first("year", 100)
  const language = first("language", 100)
  const languageLabel = language?.trim().replace(/\s+/gu, " ").toLowerCase() || null
  const rawDoi = first("doi", 2048)
  const rawUrl = first("url", 2048)
  const doi = rawDoi ? normalizeDoi(rawDoi) : null
  const url = rawUrl ? safeHttpsUrl(rawUrl) : null
  if (rawDoi && !doi) warnings.push(`第 ${index + 1} 条 DOI 无效，已忽略`)
  if (rawUrl && !url) warnings.push(`第 ${index + 1} 条 URL 不是安全公开链接，已忽略`)
  const issns = []
  for (const raw of values.get("issn") || []) {
    for (const token of raw.split(/[;,\s]+/u).filter(Boolean)) {
      if (/^\d{4}-\d{3}[\dX]$/iu.test(token)) issns.push(token.toUpperCase())
      else warnings.push(`第 ${index + 1} 条无效 ISSN 已忽略`)
    }
  }
  const types = format === "bibtex" ? BIB_TYPES : RIS_TYPES
  const workType = types.get(entry.type) || null
  const parsedYear = year && /^(\d{4})(?:$|[/-]\d{1,2}(?:[/-]\d{1,2})?\/?$)/u.exec(year.trim())
  const normalizedYear = parsedYear && Number(parsedYear[1]) >= 1000 ? Number(parsedYear[1]) : null
  return {
    title, authors, year: normalizedYear, doi, url, abstract: first("abstract", 20000),
    language: languageLabel && !UNREPORTED_LANGUAGES.has(languageLabel)
      ? LANGUAGES.get(languageLabel) || languageLabel : null,
    work_type: workType,
    journal: { title: first("journal", 500), source_id: null, issns, source_type: workType === "article" ? "journal" : null },
    citations: null,
  }
}

/** Parse a whole import for preview. No persistence, network access, or API trust. */
export function parseBibliography({ text, format, provider, batch_id, import_id, now, idFactory }) {
  checkFormat(format)
  if (typeof text !== "string") throw new TypeError("导入内容必须是文本")
  if (!["scholar", "cnki", "manual"].includes(provider)) throw new TypeError("导入仅支持声明的 Scholar、CNKI 或 manual 来源")
  if (typeof idFactory !== "function") throw new TypeError("缺少记录 ID 工厂")
  checkSize(text)
  const input = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n")
  const warnings = []
  const entries = format === "bibtex" ? parseBibtex(input, warnings) : parseRis(input, warnings)
  const bibliographies = entries.map((entry, index) => convertEntry(entry, index, format, warnings)).filter(Boolean)
  const ids = new Set()
  const records = bibliographies.map((bibliography) => {
    const record = normalizeDiscoveryRecord({
      record_id: idFactory(), provider_id: null, bibliography,
      provenance: { provider, method: "import", batch_id, query_id: null, import_id, retrieved_at: now,
        public_url: bibliography.url, verification: "declared" },
      retraction: { state: "unknown", source_url: null, checked_at: null },
    })
    if (ids.has(record.record_id)) throw new TypeError("记录 ID 重复")
    ids.add(record.record_id)
    return record
  })
  return { records, warnings }
}

function escapeBibtex(value) { return value.replace(/[\\{}"%&#_$]/gu, "\\$&") }

/** Standard bibliographic exchange only; full provenance belongs in workspace backups. */
export function exportBibliography(records, { format }) {
  checkFormat(format)
  if (!Array.isArray(records)) throw new TypeError("导出记录必须是数组")
  if (records.length > MAX_ENTRIES) throw new RangeError("导出题录超过 500 条")
  const output = records.map((input, index) => {
    const record = normalizeDiscoveryRecord(input)
    const bib = record.bibliography
    const url = bib.url || record.provenance.public_url
    if (format === "ris") {
      const type = [...RIS_TYPES].find(([, value]) => value === bib.work_type)?.[0] || "GEN"
      const fields = [["TY", type], ["TI", bib.title], ...bib.authors.map((author) => ["AU", author]),
        ["PY", bib.year], ["DO", bib.doi], ["UR", url], ["JO", bib.journal.title],
        ...bib.journal.issns.map((issn) => ["SN", issn]), ["AB", bib.abstract], ["LA", bib.language], ["ER", ""]]
      return fields.filter(([, value]) => value !== null).map(([tag, value]) => `${tag}  - ${value}`).join("\n") + "\n"
    }
    const type = [...BIB_TYPES].find(([, value]) => value === bib.work_type)?.[0] || "misc"
    const authors = bib.authors.map((author) => {
      const escaped = escapeBibtex(author)
      return /\band\b/iu.test(author) ? `{${escaped}}` : escaped
    }).join(" and ")
    const fields = [["title", bib.title], ["author", authors || null], ["year", bib.year], ["doi", bib.doi],
      ["url", url], ["journal", bib.journal.title], ["issn", bib.journal.issns.join(", ") || null],
      ["abstract", bib.abstract], ["language", bib.language]]
    return `@${type}{record${index + 1},\n${fields.filter(([, value]) => value !== null)
      .map(([name, value]) => `  ${name} = {${name === "author" ? value : escapeBibtex(String(value))}}`).join(",\n")}\n}\n`
  }).join("\n")
  checkSize(output)
  return output
}
