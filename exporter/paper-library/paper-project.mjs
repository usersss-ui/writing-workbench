import { constants } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"

import { redactPrivateLocators, renderControlledMarkdown } from "./note-preview.mjs"

// Paper project directories follow the paper-writing-workflow layout and are
// the single source for writing materials. They are read live and never
// written here; responses carry project-relative paths only.

const CONFIG_MAX_BYTES = 64 * 1024
const FILE_MAX_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 2000
const MAX_DEPTH = 6
const LAYOUT = "paper-writing-workflow"
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SKIPPED_DIRECTORIES = new Set(["__pycache__", "node_modules"])
// In a workflow project only these top-level folders are listed in full;
// others (code, datasets) can hold tens of thousands of files and are only named.
const WORKFLOW_DIRECTORIES = new Set(["00_课题", "01_稿件", "02_规划与记录", "03_范文对照", "审稿", "相关论文", "试转", "latex", "figures", "归档"])
const REVIEW_TABLE_PATH = /^审稿\/第\d+轮\/处理表\.md$/u

const SHORT_CODE = "[A-Z][A-Za-z]*\\d{2}(?:-[A-Za-z0-9]+)+"
const LOCATION = "§[A-Za-z0-9][A-Za-z0-9.\\-]*|p\\.\\s?\\d+(?:[-–]\\d+)?|(?:定理|引理|命题|推论|定义|假设|式|表|图|算法)\\s?\\(?[A-Za-z0-9.]+\\)?"
const REFERENCE = new RegExp(`(?<![A-Za-z0-9])(${SHORT_CODE})(?![A-Za-z0-9])(?:[·・](${LOCATION}))?`, "gu")
const BRACKETED_LOCATION = new RegExp(`〔(${LOCATION})〕`, "gu")

// Fixed headers from docs/superpowers/specs/2026-10-23-paper-project-table-contract.md.
// `references` lists the columns whose short codes are sources by definition,
// so an unknown code there is reported as a broken link.
const TABLE_FILES = Object.freeze([
  { key: "references", title: "文献清单", path: "相关论文/文献清单.md", tables: [
    // Other columns repeat the code inside PDF file names; they are not sources.
    { heading: "文献", columns: ["短码", "作者", "年份", "题名", "期刊或会议", "DOI", "角色", "PDF", "核实"], references: ["短码"], onlyReferenceColumns: true },
  ] },
  { key: "benchmark", title: "期刊基准表", path: "03_范文对照/期刊基准表.md", tables: [
    { heading: "取样", columns: ["短码", "题名", "期刊", "年份", "本刊", "阅读程度"], references: ["短码"] },
    { heading: "检查项", matrix: { first: "检查项", last: "本刊常见水平" } },
    { heading: "硬性规定", columns: ["规定", "内容", "来源", "访问日期", "冲突"], references: [] },
  ] },
  { key: "mapping", title: "小节范文映射表", path: "03_范文对照/小节范文映射表.md", tables: [
    { heading: "映射", columns: ["小节编号", "本文小节", "稿件文件", "本刊范文", "非本刊范文", "本刊容忍度要点", "目标篇幅", "起草方式"], references: ["本刊范文", "非本刊范文"] },
  ] },
  { key: "style", title: "本刊写法清单", path: "03_范文对照/本刊写法清单.md", tables: [
    { heading: "写法", columns: ["编号", "类别", "写法要求", "出处"], references: ["出处"] },
    { heading: "术语译法", columns: ["英文", "本刊译法", "出处"], references: ["出处"] },
  ] },
  { key: "reviewers", title: "潜在审稿人", path: "03_范文对照/潜在审稿人.md", tables: [
    { heading: "作者组", columns: ["作者组", "代表论文", "本文引用数"], references: ["代表论文"] },
    { heading: "检查项", matrix: { first: "检查项", last: "审稿人可接受水平" } },
  ] },
])
const REVIEW_TABLES = Object.freeze([
  { heading: "意见", columns: ["编号", "意见", "级别", "依据", "处理成本", "处理方式", "决定"], references: ["依据"] },
  { heading: "定位问题", columns: ["编号", "对比", "条件", "结果", "影响的说法", "可选处理", "决定"], references: [] },
])

function failure(code) {
  return Object.assign(new Error(code), { code })
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

async function readBoundedText(path, maximum, { missing, oversized, unreadable }) {
  let handle
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) throw failure(unreadable)
    if (before.size > maximum) throw failure(oversized)
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (before.ino !== opened.ino || before.dev !== opened.dev || opened.size > maximum) throw failure(unreadable)
    return new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile())
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw failure(missing)
    if (error?.code === oversized) throw error
    throw failure(unreadable)
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

export async function loadPaperProjectConfig({ repoRoot }) {
  let raw
  try {
    raw = await readBoundedText(join(repoRoot, "local_library_config", "paper-projects.local.json"), CONFIG_MAX_BYTES, {
      missing: "PAPER_PROJECT_CONFIG_MISSING",
      oversized: "PAPER_PROJECT_CONFIG_INVALID",
      unreadable: "PAPER_PROJECT_CONFIG_INVALID",
    })
  } catch (error) {
    if (error.code === "PAPER_PROJECT_CONFIG_MISSING") return []
    throw failure("PAPER_PROJECT_CONFIG_INVALID")
  }
  let config
  try { config = JSON.parse(raw) } catch { throw failure("PAPER_PROJECT_CONFIG_INVALID") }
  if (!plain(config) || config.version !== 1 || !Array.isArray(config.projects)) throw failure("PAPER_PROJECT_CONFIG_INVALID")
  const seen = new Set()
  return config.projects.map((project) => {
    if (
      !plain(project)
      || typeof project.project_id !== "string" || !PROJECT_ID.test(project.project_id) || seen.has(project.project_id)
      || typeof project.path !== "string" || !isAbsolute(project.path)
      || (project.layout !== undefined && project.layout !== LAYOUT)
    ) throw failure("PAPER_PROJECT_CONFIG_INVALID")
    seen.add(project.project_id)
    return { project_id: project.project_id, path: project.path, layout: project.layout ?? null }
  })
}

async function projectRoot(project) {
  try {
    const info = await lstat(project.path)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    return await realpath(project.path)
  } catch {
    return null
  }
}

export async function listPaperProjects({ repoRoot }) {
  const projects = await loadPaperProjectConfig({ repoRoot })
  const listed = []
  for (const project of projects) {
    listed.push({ project_id: project.project_id, layout: project.layout, available: await projectRoot(project) !== null })
  }
  return { version: 1, projects: listed }
}

async function findProject(repoRoot, projectId) {
  const project = (await loadPaperProjectConfig({ repoRoot })).find((candidate) => candidate.project_id === projectId)
  if (!project) throw failure("PAPER_PROJECT_NOT_FOUND")
  const root = await projectRoot(project)
  if (!root) throw failure("PAPER_PROJECT_UNAVAILABLE")
  return { ...project, root }
}

async function listFiles(root, { workflow }) {
  const files = []
  const collapsed = []
  let skippedLinks = 0
  let truncated = false
  async function walk(directory, depth) {
    if (depth > MAX_DEPTH) return
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) { truncated = true; return }
      if (entry.name.startsWith(".")) continue
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) { skippedLinks += 1; continue }
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        if (workflow && depth === 0 && !WORKFLOW_DIRECTORIES.has(entry.name)) { collapsed.push(entry.name); continue }
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const path = relative(root, absolute).split(sep).join("/")
      let size = null
      try { size = (await lstat(absolute)).size } catch { size = null }
      files.push({ path, size })
    }
  }
  await walk(root, 0)
  return { files, collapsed, skippedLinks, truncated }
}

function splitRow(line) {
  let body = line.trim()
  if (body.startsWith("|")) body = body.slice(1)
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1)
  const cells = []
  let current = ""
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === "\\" && body[index + 1] === "|") { current += "|"; index += 1; continue }
    if (character === "|") { cells.push(current.trim()); current = ""; continue }
    current += character
  }
  cells.push(current.trim())
  return cells
}

function findTable(lines, heading) {
  let fence = false
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:```|~~~)/u.test(lines[index])) { fence = !fence; continue }
    if (!fence && lines[index].trim() === `## ${heading}`) { start = index; break }
  }
  if (start === -1) return { status: "missing" }
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (/^#{1,2}\s/u.test(line)) break
    if (!line.startsWith("|")) continue
    const block = []
    while (index < lines.length && lines[index].trim().startsWith("|")) { block.push(lines[index]); index += 1 }
    if (block.length < 2 || !/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/u.test(block[1].trim())) return { status: "unparseable", reason: "表格缺少分隔行" }
    return { status: "ok", headers: splitRow(block[0]), rows: block.slice(2).map(splitRow) }
  }
  return { status: "unparseable", reason: "标题下没有表格" }
}

function segmentText(text, { knownCodes, strict, matrixCode = null }) {
  const segments = []
  const pattern = new RegExp(`${REFERENCE.source}|${BRACKETED_LOCATION.source}`, "gu")
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const [whole, code, codeLocation, bracketLocation] = match
    let reference = null
    if (code && (strict || knownCodes.has(code))) {
      reference = { code, location: codeLocation ?? null, known: knownCodes.has(code) }
    } else if (bracketLocation && matrixCode) {
      reference = { code: matrixCode, location: bracketLocation, known: knownCodes.has(matrixCode) }
    }
    if (!reference) continue
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) })
    segments.push({ text: whole, reference })
    cursor = match.index + whole.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

function parseTable(lines, spec, knownCodes) {
  const found = findTable(lines, spec.heading)
  if (found.status !== "ok") return { heading: spec.heading, status: found.status, ...(found.reason ? { reason: found.reason } : {}) }
  const { headers } = found
  let referenceColumns
  let codeColumns = []
  if (spec.matrix) {
    const last = headers.indexOf(spec.matrix.last)
    if (headers[0] !== spec.matrix.first || last < 1) {
      return { heading: spec.heading, status: "unparseable", reason: `表头应以“${spec.matrix.first}”开头，并含“${spec.matrix.last}”列` }
    }
    codeColumns = headers.slice(1, last)
    referenceColumns = new Set(codeColumns)
  } else {
    if (spec.columns.some((column, index) => headers[index] !== column)) {
      return { heading: spec.heading, status: "unparseable", reason: `固定表头应为：${spec.columns.join(" | ")}` }
    }
    referenceColumns = new Set(spec.references)
  }
  const rows = found.rows.map((cells) => headers.map((header, index) => segmentText(redactPrivateLocators(cells[index] ?? ""), {
    knownCodes: spec.onlyReferenceColumns && !referenceColumns.has(header) ? new Set() : knownCodes,
    strict: referenceColumns.has(header) && !codeColumns.includes(header),
    matrixCode: codeColumns.includes(header) ? header : null,
  })))
  return { heading: spec.heading, status: "ok", headers, ...(spec.matrix ? { code_columns: codeColumns } : {}), rows }
}

async function readProjectText(root, path) {
  return readBoundedText(join(root, ...path.split("/")), FILE_MAX_BYTES, {
    missing: "PAPER_PROJECT_FILE_NOT_FOUND",
    oversized: "PAPER_PROJECT_FILE_TOO_LARGE",
    unreadable: "PAPER_PROJECT_FILE_UNREADABLE",
  })
}

async function parseTableFile(root, file, tables, knownCodes) {
  let text
  try {
    text = await readProjectText(root, file.path)
  } catch (error) {
    return { key: file.key, title: file.title, path: file.path, status: error.code === "PAPER_PROJECT_FILE_NOT_FOUND" ? "missing" : "unreadable", tables: [] }
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n")
  const parsed = tables.map((spec) => parseTable(lines, spec, knownCodes))
  return { key: file.key, title: file.title, path: file.path, status: parsed.every((table) => table.status === "ok") ? "ok" : "partial", tables: parsed }
}

function cellText(segments) {
  return segments.map((segment) => segment.text).join("")
}

export async function readPaperProject({ repoRoot, projectId }) {
  const project = await findProject(repoRoot, projectId)
  const listing = await listFiles(project.root, { workflow: project.layout === LAYOUT })
  const base = { version: 1, project_id: project.project_id, layout: project.layout, files: listing.files, collapsed_directories: listing.collapsed, skipped_links: listing.skippedLinks, truncated: listing.truncated }
  if (project.layout !== LAYOUT) return { ...base, tables: [], reviews: [], drafts: [], references: [] }

  // The reference list is parsed first so every other table knows which codes exist.
  const referenceFile = await parseTableFile(project.root, TABLE_FILES[0], TABLE_FILES[0].tables, new Set())
  const referenceTable = referenceFile.tables[0]
  const references = referenceTable?.status === "ok"
    ? referenceTable.rows.map((row) => Object.fromEntries(referenceTable.headers.map((header, index) => [header, cellText(row[index])])))
      .filter((row) => new RegExp(`^${SHORT_CODE}$`, "u").test(row["短码"]))
    : []
  const knownCodes = new Set(references.map((row) => row["短码"]))

  const tables = [await parseTableFile(project.root, TABLE_FILES[0], TABLE_FILES[0].tables, knownCodes)]
  for (const file of TABLE_FILES.slice(1)) tables.push(await parseTableFile(project.root, file, file.tables, knownCodes))
  const reviewPaths = ["00_课题/课题卡片审稿.md", ...listing.files.map((file) => file.path).filter((path) => REVIEW_TABLE_PATH.test(path))]
  const reviews = []
  for (const path of reviewPaths) {
    const review = await parseTableFile(project.root, { key: "review", title: path.startsWith("00_课题/") ? "课题卡片审稿" : path.split("/")[1], path }, REVIEW_TABLES, knownCodes)
    if (review.status !== "missing" || path.startsWith("00_课题/")) reviews.push(review)
  }

  const drafts = []
  for (const file of listing.files.filter((candidate) => /^01_稿件\/[^/]+\.md$/u.test(candidate.path))) {
    let text = ""
    try { text = await readProjectText(project.root, file.path) } catch { text = "" }
    const codes = [...new Set([...text.matchAll(REFERENCE)].map((match) => match[1]).filter((code) => knownCodes.has(code)))]
    drafts.push({ path: file.path, codes })
  }
  return { ...base, tables, reviews, drafts, references }
}

export async function readPaperProjectFile({ repoRoot, projectId, encodedPath }) {
  let path
  try { path = decodeURIComponent(encodedPath) } catch { throw failure("PAPER_PROJECT_FILE_NOT_FOUND") }
  if (
    path.length === 0 || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes("\0")
    || !path.endsWith(".md") || path.split("/").some((part) => part === "" || part === "." || part === ".." || part.startsWith("."))
  ) throw failure("PAPER_PROJECT_FILE_NOT_FOUND")
  const project = await findProject(repoRoot, projectId)
  const absolute = join(project.root, ...path.split("/"))
  let resolved
  try { resolved = await realpath(absolute) } catch { throw failure("PAPER_PROJECT_FILE_NOT_FOUND") }
  const inside = relative(project.root, resolved)
  if (inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).join("/") !== path) throw failure("PAPER_PROJECT_FILE_NOT_FOUND")
  const markdown = await readProjectText(project.root, path)
  return { path, html: renderControlledMarkdown(markdown, { resolveImage: () => null }) }
}
