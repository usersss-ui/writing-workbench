const SCALAR_ALIASES = new Map([
  ["paper_id", "paper_id"], ["title", "title_original"], ["title_original", "title_original"],
  ["title_zh", "title_zh"], ["title_en", "title_en"], ["year", "year"],
  ["publication_year", "publication_year"], ["version_date", "version_date"],
  ["venue", "venue"], ["doi", "doi_or_url"], ["url", "doi_or_url"],
  ["unit_type", "unit_type"], ["topic_l1", "topic_l1"], ["topic_l2", "topic_l2"],
  ["contribution_role", "contribution_role"], ["p02_relevance", "p02_relevance"],
])
const LIST_ALIASES = new Map([
  ["authors", "authors"], ["research_scope", "research_scopes"], ["research_scopes", "research_scopes"],
  ["method_tags", "method_tags"], ["network_tags", "network_tags"], ["problem_tags", "problem_tags"],
  ["property_tags", "property_tags"], ["theory_tags", "theory_tags"],
])
const EXPLICIT_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) return trimmed.slice(1, -1)
  return trimmed
}

function listFromInline(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null
  return trimmed.slice(1, -1).split(",").map((item) => unquote(item)).filter(Boolean)
}

export function parsePaperFrontmatter(markdownPrefix) {
  const data = {}
  const warnings = []
  const prefix = String(markdownPrefix).slice(0, 8192)
  const lines = prefix.split(/\r?\n/)
  if (lines[0] !== "---") return { data, warnings }
  const closingIndex = lines.slice(1).findIndex((line) => line === "---")
  if (closingIndex === -1) return { data, warnings }
  const block = lines.slice(1, closingIndex + 1)
  for (let index = 0; index < block.length; index += 1) {
    const line = block[index]
    if (!line.trim() || line.startsWith("#")) continue
    const match = /^([^:\s][^:]*):(?:\s*(.*))?$/.exec(line)
    if (!match || /^\s/.test(line)) continue
    const [, rawKey, rawValue = ""] = match
    const key = rawKey.trim()
    const listKey = LIST_ALIASES.get(key)
    const scalarKey = SCALAR_ALIASES.get(key)
    if (!listKey && !scalarKey) { warnings.push(key); continue }
    if (rawValue.includes("&") || rawValue.includes("*") || rawValue.includes("!") || rawValue === "|" || rawValue === ">") { warnings.push(key); continue }
    if (listKey) {
      const inline = listFromInline(rawValue)
      if (inline !== null) { data[listKey] = inline; continue }
      if (rawValue.trim() !== "") { warnings.push(key); continue }
      const values = []
      while (index + 1 < block.length && /^\s+-\s+/.test(block[index + 1])) values.push(unquote(block[++index].replace(/^\s+-\s+/, "")))
      if (values.length) data[listKey] = values
      else warnings.push(key)
      continue
    }
    const value = unquote(rawValue)
    if (!value || rawValue.includes("[") || rawValue.includes("{") || rawValue.includes("&") || rawValue.includes("*")) { warnings.push(key); continue }
    if (key === "title" && data.title_original !== undefined) continue
    if (key === "url" && data.doi_or_url !== undefined) continue
    if (key === "year" || key === "publication_year") {
      if (!/^\d{4}$/.test(value)) { warnings.push(key); continue }
      data[scalarKey] = Number(value); continue
    }
    if (key === "unit_type" && !["article", "review", "thesis", "chapter"].includes(value)) { warnings.push(key); continue }
    if (key === "p02_relevance" && !/^[0-3]$/.test(value)) { warnings.push(key); continue }
    if (key === "paper_id" && !EXPLICIT_ID.test(value)) { warnings.push(key); continue }
    data[scalarKey] = key === "p02_relevance" ? Number(value) : value
  }
  return { data, warnings }
}
