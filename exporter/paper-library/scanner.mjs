import { constants } from "node:fs"
import { lstat, open, readdir, realpath, stat } from "node:fs/promises"
import * as nativePath from "node:path"
import { basename, extname, relative, resolve, sep } from "node:path"
import posix from "node:path/posix"
import { isDeepStrictEqual } from "node:util"
import { classifyArtifact as classifyBaseArtifact, createEmptyArtifacts, summarizeArtifactAvailability, ARTIFACT_KEYS } from "./artifacts.mjs"
import { parsePaperFrontmatter } from "./frontmatter.mjs"
import { makeOverrideKey, makePathPaperId, makeSlug, normalizeRelativePath } from "./ids.mjs"
import { isPathOnlyReadingNoteEligible, validatePaperOverride } from "./overrides.mjs"
import { mergePaperRecord } from "./status.mjs"

const EXPLICIT_ID = /^[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/
const MARKDOWN_PREFIX_BYTES = 8192
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])
const DEFAULT_MARKDOWN_FILE_SYSTEM = Object.freeze({ lstat, open, realpath, noFollowFlag: constants.O_NOFOLLOW })

export function classifyArtifact(options) {
  if (options.explicitCategory !== null && options.explicitCategory !== undefined && options.explicitCategory !== "note") {
    return classifyBaseArtifact(options)
  }
  if (extname(options.relativePath).toLowerCase() === ".log") return null
  const fileName = posix.basename(options.relativePath).toLowerCase()
  if (fileName.includes("中文翻译") || fileName.includes("_zh") || fileName.includes("translation") || fileName.includes("翻译")) return "translation"
  const extension = extname(fileName)
  const fileStem = posix.basename(fileName, extension)
  if (MARKDOWN_EXTENSIONS.has(extension) && (
    fileName.includes("ocr")
    || (options.siblingPdfStems ?? []).some((stem) => stem.toLowerCase() === fileStem)
  )) return "ocr"
  const automaticCategory = classifyBaseArtifact({ ...options, explicitCategory: null })
  if (options.explicitCategory !== "note") return automaticCategory
  if (!isPathOnlyReadingNoteEligible(options.relativePath)) return automaticCategory
  return automaticCategory === null || automaticCategory === "note" ? "note" : automaticCategory
}

class UnsafeMarkdownReadError extends Error {}

export function isPathInsideRoot(root, target, pathApi = nativePath) {
  const pathToTarget = pathApi.relative(root, target)
  return pathToTarget === "" || (
    !pathApi.isAbsolute(pathToTarget)
    && !pathToTarget.startsWith(`..${pathApi.sep}`)
    && pathToTarget !== ".."
    && !pathToTarget.startsWith("/")
    && !pathToTarget.startsWith("\\")
  )
}

function insideRoot(root, target) {
  return isPathInsideRoot(root, target)
}

function statFingerprint(info) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs ?? info.mtimeMs}`
}

function unsafeMarkdown(message = "Markdown 文件在安全读取期间发生变化") {
  return new UnsafeMarkdownReadError(message)
}

function createSafeMarkdownPrefixReader(fileSystem = {}) {
  const io = { ...DEFAULT_MARKDOWN_FILE_SYSTEM, ...fileSystem }
  for (const method of ["lstat", "open", "realpath"]) {
    if (typeof io[method] !== "function") throw new TypeError(`Markdown 文件系统缺少 ${method}`)
  }

  async function pathSnapshot(path, sourceRoot) {
    let info
    let canonicalPath
    try {
      info = await io.lstat(path, { bigint: true })
      canonicalPath = await io.realpath(path)
    } catch {
      throw unsafeMarkdown()
    }
    if (info.isSymbolicLink() || !info.isFile() || !insideRoot(sourceRoot, canonicalPath)) throw unsafeMarkdown()
    return { canonicalPath, fingerprint: statFingerprint(info) }
  }

  return async function readMarkdownPrefix({ file, sourceRoot }) {
    const before = await pathSnapshot(file.lexical_path, sourceRoot)
    if (before.canonicalPath !== file.absolute_path || before.fingerprint !== file.discovery_fingerprint) throw unsafeMarkdown()
    if (!Number.isInteger(io.noFollowFlag) || io.noFollowFlag <= 0) throw unsafeMarkdown("当前平台不支持安全打开 Markdown")

    let handle
    try {
      try {
        handle = await io.open(file.lexical_path, constants.O_RDONLY | io.noFollowFlag)
      } catch (error) {
        if (["ELOOP", "ENOENT", "ENOTDIR"].includes(error?.code)) throw unsafeMarkdown()
        throw error
      }
      const openedBefore = await handle.stat({ bigint: true })
      if (!openedBefore.isFile() || statFingerprint(openedBefore) !== before.fingerprint) throw unsafeMarkdown()

      const buffer = Buffer.alloc(MARKDOWN_PREFIX_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const openedAfter = await handle.stat({ bigint: true })
      const after = await pathSnapshot(file.lexical_path, sourceRoot)
      if (
        statFingerprint(openedAfter) !== statFingerprint(openedBefore)
        || after.fingerprint !== statFingerprint(openedAfter)
        || after.canonicalPath !== before.canonicalPath
      ) throw unsafeMarkdown()
      return buffer.subarray(0, bytesRead).toString("utf8")
    } finally {
      if (handle) await handle.close()
    }
  }
}

function emptyAudit() {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    sources: [],
    counts: { paper_units: 0, standard_units: 0, identity_pending_units: 0, generated_note_previews: 0, generated_pages: 0 },
    private_path_lookup: {},
    excluded_units: [],
    blocking: {
      duplicate_ids: [], duplicate_explicit_ids: [], identity_conflicts: [], metadata_conflicts: [], parent_relationships: [],
      path_escapes: [], slug_collisions: [], exclusion_targets: [], invalid_note_overrides: [], invalid_preferred_notes: [],
    },
    warnings: {
      multiple_versions: [], unreadable_markdown: [], unsafe_markdown: [], broken_paths: [], external_symlinks: [], internal_symlinks: [],
      unrecognized_artifacts: [], unmatched_overrides: [], shadowed_metadata_conflicts: [],
    },
  }
}

function blockingError(audit) {
  const labels = []
  if (audit.blocking.duplicate_ids.length > 0) labels.push("重复论文 ID")
  if (audit.blocking.identity_conflicts.length > 0) labels.push("笔记短码冲突")
  if (audit.blocking.metadata_conflicts.length > 0) labels.push("frontmatter 元数据冲突")
  const relationshipCodes = new Set(audit.blocking.parent_relationships.map((item) => item.split(":", 1)[0]))
  if (relationshipCodes.has("missing_parent")) labels.push("父项不存在")
  if (relationshipCodes.has("self_parent")) labels.push("父子引用自引用")
  if (relationshipCodes.has("parent_cycle")) labels.push("父子引用成环")
  if (relationshipCodes.has("cross_source_parent")) labels.push("父子引用跨来源")
  if (relationshipCodes.has("parent_not_thesis")) labels.push("父项必须是 thesis")
  if (relationshipCodes.has("child_not_chapter")) labels.push("子项必须是 chapter")
  if (relationshipCodes.has("orphan_chapter")) labels.push("章节缺少父项")
  if (audit.blocking.path_escapes.length > 0) labels.push("路径越界")
  if (audit.blocking.slug_collisions.length > 0) labels.push("slug 冲突")
  if (audit.blocking.exclusion_targets.length > 0) labels.push("排除键无法唯一解析")
  if (audit.blocking.invalid_note_overrides.length > 0) labels.push("笔记覆盖目标无效")
  if (audit.blocking.invalid_preferred_notes.length > 0) labels.push("首选笔记目标无效")
  const error = new Error(`扫描存在阻塞问题：${labels.join("、")}`)
  Object.defineProperty(error, "blocking", {
    value: Object.freeze(Object.fromEntries(
      Object.entries(audit.blocking).map(([key, items]) => [key, Object.freeze([...items])]),
    )),
  })
  return error
}

function cycleDescription(cycleIds) {
  const first = cycleIds.reduce((best, id, index) => id.localeCompare(cycleIds[best]) < 0 ? index : best, 0)
  const ordered = [...cycleIds.slice(first), ...cycleIds.slice(0, first)]
  return `parent_cycle:${[...ordered, ordered[0]].join("->")}`
}

function validateParentRelationships(papers, audit) {
  const papersById = new Map(papers.map((paper) => [paper.paper_id, paper]))
  const issues = new Set()

  for (const paper of papers) {
    const parentId = paper.parent_paper_id
    if (paper.unit_type === "chapter" && parentId === null) issues.add(`orphan_chapter:${paper.paper_id}`)
    if (parentId === null) continue
    if (parentId === paper.paper_id) issues.add(`self_parent:${paper.paper_id}`)
    const parent = papersById.get(parentId)
    if (!parent) {
      issues.add(`missing_parent:${paper.paper_id}->${parentId}`)
      continue
    }
    if (parent.source_id !== paper.source_id) issues.add(`cross_source_parent:${paper.paper_id}->${parentId}`)
    if (parent.unit_type !== "thesis") issues.add(`parent_not_thesis:${paper.paper_id}->${parentId}`)
    if (paper.unit_type !== "chapter") issues.add(`child_not_chapter:${paper.paper_id}->${parentId}`)
  }

  const completed = new Set()
  const activeIds = []
  const activeIndexes = new Map()
  const cycles = new Set()
  function visit(paperId) {
    if (completed.has(paperId)) return
    const activeIndex = activeIndexes.get(paperId)
    if (activeIndex !== undefined) {
      cycles.add(cycleDescription(activeIds.slice(activeIndex)))
      return
    }
    activeIndexes.set(paperId, activeIds.length)
    activeIds.push(paperId)
    const parentId = papersById.get(paperId)?.parent_paper_id
    if (parentId && parentId !== paperId && papersById.has(parentId)) visit(parentId)
    activeIds.pop()
    activeIndexes.delete(paperId)
    completed.add(paperId)
  }
  for (const paperId of [...papersById.keys()].sort((left, right) => left.localeCompare(right))) visit(paperId)
  for (const cycle of cycles) issues.add(cycle)

  audit.blocking.parent_relationships.push(...issues)
}

function throwIfBlocking(audit) {
  if (Object.values(audit.blocking).some((items) => items.length > 0)) throw blockingError(audit)
}

function relativeSourcePath(relativeDirectory, fileName = "") {
  return normalizeRelativePath([relativeDirectory, fileName].filter(Boolean).join("/"))
}

function getOverride(papers, sourceId, relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  return papers[makeOverrideKey({ sourceId, relativePath: normalized })] ?? null
}

function validateOverrideKeys(papers, sources) {
  for (const key of Object.keys(papers)) {
    const source = sources.find((item) => key.startsWith(`${item.source_id}::`))
    if (!source) throw new Error(`覆盖键格式无效: ${key}`)
    const relativePath = key.slice(`${source.source_id}::`.length)
    let canonical
    try { canonical = makeOverrideKey({ sourceId: source.source_id, relativePath }) } catch { throw new Error(`覆盖键格式无效: ${key}`) }
    if (canonical !== key) throw new Error(`覆盖键格式无效: ${key}`)
    validatePaperOverride(key, papers[key])
  }
}

function noteShortCodes(files) {
  const codes = new Set()
  for (const file of files) {
    const code = file.file_name.match(/^([A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)_论文精读\.(?:md|markdown)$/iu)?.[1]
    if (code) codes.add(code)
  }
  return [...codes].sort((left, right) => left.localeCompare(right))
}

function getCatalogRecord(catalogs, sourceId, relativePath) {
  const catalog = catalogs[sourceId]
  if (!catalog) return null
  return catalog.papers[makeOverrideKey({ sourceId, relativePath: normalizeRelativePath(relativePath) })] ?? null
}

function validateCatalogs(catalogs, sources) {
  if (!catalogs || typeof catalogs !== "object" || Array.isArray(catalogs)) throw new Error("目录集合必须是对象")
  const sourceIds = new Set(sources.map((source) => source.source_id))
  for (const [sourceId, catalog] of Object.entries(catalogs)) {
    if (!sourceIds.has(sourceId)) throw new Error(`目录来源无效: ${sourceId}`)
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || catalog.version !== 1 || !catalog.papers || typeof catalog.papers !== "object" || Array.isArray(catalog.papers)) {
      throw new Error(`目录必须是 version 为 1 的 papers 对象: ${sourceId}`)
    }
    for (const key of Object.keys(catalog.papers)) {
      if (!key.startsWith(`${sourceId}::`)) throw new Error(`目录键格式无效: ${key}`)
      const relativePath = key.slice(`${sourceId}::`.length)
      let canonical
      try { canonical = makeOverrideKey({ sourceId, relativePath }) } catch { throw new Error(`目录键格式无效: ${key}`) }
      if (canonical !== key) throw new Error(`目录键格式无效: ${key}`)
    }
  }
}

async function canonicalSourceRoots(sources) {
  const canonical = await Promise.all(sources.map(async (source) => ({ source, rootPath: await realpath(source.path) })))
  for (let leftIndex = 0; leftIndex < canonical.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < canonical.length; rightIndex += 1) {
      const left = canonical[leftIndex]
      const right = canonical[rightIndex]
      if (insideRoot(left.rootPath, right.rootPath) || insideRoot(right.rootPath, left.rootPath)) {
        throw new Error(`来源根目录重复或重叠: ${left.source.source_id} / ${right.source.source_id}`)
      }
    }
  }
  return canonical
}

async function walkSource({ source, rootPath, audit }) {
  const directories = new Map()
  const visitedDirectories = new Set()
  let scannedDirectories = 0

  async function visit(directoryPath, relativeDirectory, viaSymlink = false) {
    const realDirectory = await realpath(directoryPath)
    if (!insideRoot(rootPath, realDirectory)) {
      audit.warnings.external_symlinks.push(relativeDirectory)
      return
    }
    if (visitedDirectories.has(realDirectory)) return
    visitedDirectories.add(realDirectory)
    scannedDirectories += 1
    const record = { relative_path: relativeDirectory, absolute_path: realDirectory, files: [] }
    directories.set(relativeDirectory, record)
    const entries = await readdir(realDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const candidatePath = resolve(realDirectory, entry.name)
      const childRelative = relativeSourcePath(relativeDirectory, entry.name)
      let actualPath = candidatePath
      let info = entry
      const entryIsSymlink = entry.isSymbolicLink()
      if (entry.isSymbolicLink()) {
        try {
          actualPath = await realpath(candidatePath)
        } catch {
          audit.warnings.broken_paths.push(childRelative)
          continue
        }
        if (!insideRoot(rootPath, actualPath)) {
          audit.warnings.external_symlinks.push(childRelative)
          continue
        }
        const targetStat = await stat(actualPath)
        if (targetStat.isDirectory()) {
          audit.warnings.internal_symlinks.push(childRelative)
          continue
        }
        info = { isDirectory: () => targetStat.isDirectory(), isFile: () => targetStat.isFile() }
      }
      if (info.isDirectory()) await visit(actualPath, childRelative, viaSymlink || entryIsSymlink)
      else if (info.isFile()) {
        const fileStat = await stat(actualPath, { bigint: true })
        const resolvedRelativePath = relative(rootPath, actualPath).replaceAll("\\", "/") || "."
        record.files.push({
          relative_path: childRelative, resolved_relative_path: normalizeRelativePath(resolvedRelativePath),
          absolute_path: actualPath, lexical_path: candidatePath, discovery_fingerprint: statFingerprint(fileStat),
          file_name: entry.name, size_bytes: Number(fileStat.size), via_symlink: viaSymlink || entryIsSymlink,
        })
      }
    }
  }

  await visit(rootPath, "")
  return { rootPath, directories, scannedDirectories }
}

function directPdfFiles(directory) {
  return directory.files.filter((file) => extname(file.file_name).toLowerCase() === ".pdf" && (!file.via_symlink || isWithinUnit(file.resolved_relative_path, directory.relative_path)))
}

function isDescendant(path, parent) {
  return parent !== "" && path.startsWith(`${parent}/`)
}

function isWithinUnit(path, unitPath) {
  return unitPath === "" || path === unitPath || isDescendant(path, unitPath)
}

function higherPriorityMetadataSource(field, override, catalog) {
  if (override && Object.hasOwn(override, field) && override[field] !== undefined) return "override"
  if (catalog && Object.hasOwn(catalog, field) && catalog[field] !== undefined) return "catalog"
  return null
}

async function markdownMetadata(files, audit, { readMarkdownPrefix, sourceRoot, unitKey, override, catalog }) {
  const data = {}
  let explicitId = null
  for (const file of files.filter((item) => [".md", ".markdown"].includes(extname(item.file_name).toLowerCase()))) {
    try {
      const prefix = await readMarkdownPrefix({ file, sourceRoot })
      if (prefix.includes("\uFFFD")) { audit.warnings.unreadable_markdown.push(file.relative_path); continue }
      const parsed = parsePaperFrontmatter(prefix)
      parsed.warnings.forEach((warning) => audit.warnings.broken_paths.push(`${file.relative_path}:${warning}`))
      const parsedId = parsed.data.paper_id
      if (parsedId && explicitId && parsedId !== explicitId) throw new Error("frontmatter paper_id 冲突")
      if (parsedId) explicitId = parsedId
      const { paper_id: ignoredPaperId, ...metadata } = parsed.data
      for (const [field, candidate] of Object.entries(metadata)) {
        if (!Object.hasOwn(data, field)) {
          data[field] = candidate
          continue
        }
        if (!isDeepStrictEqual(data[field], candidate)) {
          const conflict = `${unitKey}:${field}`
          const winner = higherPriorityMetadataSource(field, override, catalog)
          if (winner) {
            const warning = `${conflict}:${winner}`
            if (!audit.warnings.shadowed_metadata_conflicts.includes(warning)) audit.warnings.shadowed_metadata_conflicts.push(warning)
          } else if (!audit.blocking.metadata_conflicts.includes(conflict)) {
            audit.blocking.metadata_conflicts.push(conflict)
          }
        }
      }
    } catch (error) {
      if (error?.message === "frontmatter paper_id 冲突") throw error
      const warning = error instanceof UnsafeMarkdownReadError ? audit.warnings.unsafe_markdown : audit.warnings.unreadable_markdown
      warning.push(file.relative_path)
    }
  }
  return { data, explicitId }
}

function validateArtifactOverrides({ override, sourceRoot, unit, allFiles, audit }) {
  const categories = new Map()
  const declared = override?.artifact_overrides
  if (!declared) return categories
  const seen = new Set()
  for (const [category, paths] of Object.entries(declared)) {
    if (!ARTIFACT_KEYS.includes(category) || !Array.isArray(paths)) { audit.blocking.path_escapes.push(`${unit.relative_path}:artifact_overrides`); continue }
    for (const rawPath of paths) {
      let normalized
      try { normalized = normalizeRelativePath(rawPath) } catch { audit.blocking.path_escapes.push(String(rawPath)); continue }
      const sourcePath = [normalized, relativeSourcePath(unit.relative_path, normalized)].find((candidate) => allFiles.has(candidate) && isWithinUnit(candidate, unit.relative_path))
      if (!sourcePath || seen.has(sourcePath)) { audit.blocking.path_escapes.push(normalized); continue }
      const match = allFiles.get(sourcePath)
      if (!match || !insideRoot(sourceRoot, match.absolute_path)) { audit.blocking.path_escapes.push(normalized); continue }
      seen.add(sourcePath)
      categories.set(sourcePath, category)
    }
  }
  return categories
}

function preferredNoteForUnit({ override, unit, artifacts, audit, paperId, sourceId }) {
  if (override?.preferred_note !== undefined) {
    const normalized = normalizeRelativePath(override.preferred_note)
    const candidates = [normalized, relativeSourcePath(unit.relative_path, normalized)]
    const relativeCandidates = candidates.map((candidate) => posix.relative(unit.relative_path, candidate))
    const note = relativeCandidates.find((relativePath) => artifacts.note.some((item) => item.relative_path === relativePath))
    if (note === undefined || note === "" || note === ".." || note.startsWith("../")) {
      const knownNonNote = relativeCandidates.some((relativePath) => Object.entries(artifacts).some(
        ([category, items]) => category !== "note" && items.some((item) => item.relative_path === relativePath),
      ))
      if (knownNonNote) audit.blocking.invalid_preferred_notes.push(`${sourceId}::${unit.relative_path}`)
      else audit.blocking.path_escapes.push(`${unit.relative_path}:preferred_note`)
      return null
    }
    return normalizeRelativePath(note)
  }

  const canonicalNames = new Set([`${paperId}_论文精读.md`, `${paperId}_论文精读.markdown`])
  const canonical = artifacts.note.filter((note) => canonicalNames.has(posix.basename(note.relative_path)))
  if (canonical.length === 1) return canonical[0].relative_path
  if (canonical.length > 1) return null
  return artifacts.note.length === 1 ? artifacts.note[0].relative_path : null
}

function noteStatusForArtifacts(artifacts) {
  if (artifacts.note.length > 0) return "notes_ready"
  if (artifacts.ocr.length > 0) return "ocr_only"
  if (artifacts.pdf.length > 0) return "pdf_only"
  return "metadata_only"
}

function sortedFilesForUnit(unit, unitRoots, directories) {
  const files = []
  for (const directory of directories.values()) {
    if (directory.relative_path !== unit.relative_path && !isDescendant(directory.relative_path, unit.relative_path)) continue
    if (directory.relative_path !== unit.relative_path && unitRoots.some((root) => root !== unit.relative_path && (directory.relative_path === root || isDescendant(directory.relative_path, root)))) continue
    files.push(...directory.files)
  }
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path))
}

async function scanPaperSourcesWithReader({ config, overrides, catalogs = {} }, readMarkdownPrefix) {
  const audit = emptyAudit()
  const papers = []
  const paperIds = new Map()
  const explicitIds = new Map()
  const slugIds = new Map()
  const overridePapers = overrides?.papers ?? {}
  if (overrides && (overrides.version !== 1 || !overridePapers || typeof overridePapers !== "object" || Array.isArray(overridePapers))) {
    throw new Error("覆盖文件必须是 version 为 1 的 papers 对象")
  }
  validateOverrideKeys(overridePapers, config.sources)
  validateCatalogs(catalogs, config.sources)
  const canonicalSources = await canonicalSourceRoots(config.sources)
  const matchedOverrideKeys = new Set()
  for (const { source, rootPath } of canonicalSources) {
    const walked = await walkSource({ source, rootPath, audit })
    audit.sources.push({ source_id: source.source_id, root_path: walked.rootPath, scanned_directories: walked.scannedDirectories })
    const unitPaths = new Set([...walked.directories.values()].filter((directory) => directPdfFiles(directory).length > 0).map((directory) => directory.relative_path))
    if (unitPaths.has("")) throw new Error("配置根目录不能直接包含论文 PDF")
    for (const directory of walked.directories.values()) {
      if (!directory.relative_path) continue
      const override = getOverride(overridePapers, source.source_id, directory.relative_path)
      if (["thesis", "review"].includes(override?.unit_type)) unitPaths.add(directory.relative_path)
    }
    const preparedUnits = [...unitPaths].sort((left, right) => left.localeCompare(right)).map((relativePath) => {
      const directory = walked.directories.get(relativePath)
      const override = getOverride(overridePapers, source.source_id, relativePath)
      const catalog = getCatalogRecord(catalogs, source.source_id, relativePath)
      const allUnitFiles = sortedFilesForUnit({ relative_path: relativePath }, [...unitPaths], walked.directories)
      if (override) matchedOverrideKeys.add(makeOverrideKey({ sourceId: source.source_id, relativePath }))
      const excluded = override?.include === false
      if (excluded) {
        audit.excluded_units.push({
          source_id: source.source_id,
          relative_path: relativePath,
          reason: override.exclude_reason,
        })
      }
      return { relative_path: relativePath, absolute_path: directory.absolute_path, override, catalog, all_unit_files: allUnitFiles, excluded }
    })
    for (const unit of preparedUnits) {
      if (unit.excluded) continue
      unit.files = unit.all_unit_files.filter((file) => {
        if (!file.via_symlink) return true
        if (isWithinUnit(file.resolved_relative_path, unit.relative_path)) {
          audit.warnings.internal_symlinks.push(file.relative_path)
        } else {
          audit.warnings.broken_paths.push(file.relative_path)
        }
        return false
      })
      unit.metadata = await markdownMetadata(unit.files, audit, {
        readMarkdownPrefix,
        sourceRoot: walked.rootPath,
        unitKey: makeOverrideKey({ sourceId: source.source_id, relativePath: unit.relative_path }),
        override: unit.override,
        catalog: unit.catalog,
      })
    }
    const thesisPaths = preparedUnits
      .filter((unit) => !unit.excluded && (unit.override?.unit_type ?? unit.catalog?.unit_type ?? unit.metadata.data.unit_type) === "thesis")
      .map((unit) => unit.relative_path)
    for (const unit of preparedUnits) {
      if (unit.excluded) continue
      const parentThesis = thesisPaths.filter((thesisPath) => isDescendant(unit.relative_path, thesisPath)).sort((a, b) => b.length - a.length)[0] ?? null
      unit.parent_thesis_path = parentThesis
      const files = unit.files
      const metadata = unit.metadata
      const noteCodes = noteShortCodes(files)
      if (noteCodes.length > 1) audit.blocking.identity_conflicts.push(`${source.source_id}::${unit.relative_path}:${noteCodes.join("|")}`)
      const noteCode = noteCodes.length === 1 ? noteCodes[0] : null
      const hasOverrideId = unit.override?.paper_id && EXPLICIT_ID.test(unit.override.paper_id)
      const hasCatalogId = unit.catalog?.paper_id && EXPLICIT_ID.test(unit.catalog.paper_id)
      const code = hasOverrideId ? unit.override.paper_id : hasCatalogId ? unit.catalog.paper_id : metadata.explicitId ?? noteCode
      const identity_source = hasOverrideId ? "override" : hasCatalogId ? "catalog" : metadata.explicitId ? "frontmatter" : noteCode ? "note_shortcode" : "path_hash"
      const paper_id = code ?? makePathPaperId({ sourceId: source.source_id, relativePath: unit.relative_path })
      const parent = unit.parent_thesis_path ? papers.find((paper) => paper.source_id === source.source_id && paper.relative_path === unit.parent_thesis_path) : null
      const artifactCategories = validateArtifactOverrides({ override: unit.override, sourceRoot: walked.rootPath, unit, allFiles: new Map(files.map((file) => [file.relative_path, file])), audit })
      const artifacts = createEmptyArtifacts()
      const siblingPdfStems = files.filter((file) => extname(file.file_name).toLowerCase() === ".pdf").map((file) => basename(file.file_name, extname(file.file_name)))
      for (const file of files) {
        const localPath = normalizeRelativePath(posix.relative(unit.relative_path, file.relative_path))
        const explicitCategory = artifactCategories.get(file.relative_path) ?? null
        const category = classifyArtifact({ relativePath: localPath, siblingPdfStems, explicitCategory })
        if (explicitCategory === "note" && category !== "note") {
          audit.blocking.invalid_note_overrides.push(`${source.source_id}::${unit.relative_path}:${localPath}`)
        }
        const item = { relative_path: localPath, file_name: file.file_name, size_bytes: file.size_bytes }
        if (category) artifacts[category].push(item)
        else audit.warnings.unrecognized_artifacts.push(file.relative_path)
      }
      for (const items of Object.values(artifacts)) items.sort((left, right) => left.relative_path.localeCompare(right.relative_path))
      const record = mergePaperRecord({
        adapted: {
          source_id: source.source_id, relative_path: unit.relative_path, identity_source,
          unit_type: unit.parent_thesis_path ? "chapter" : "article", parent_paper_id: parent?.paper_id ?? null,
          artifacts, artifact_availability: summarizeArtifactAvailability(artifacts), warnings: [],
        },
        explicit: metadata.data,
        catalog: unit.catalog ?? {},
        override: unit.override ?? {},
      })
      record.paper_id = paper_id
      record.metadata_provenance.paper_id = identity_source === "path_hash" ? "default" : identity_source
      record.slug = makeSlug(paper_id)
      record.note_status = noteStatusForArtifacts(artifacts)
      record.preferred_note = preferredNoteForUnit({
        override: unit.override, unit, artifacts, audit, paperId: paper_id, sourceId: source.source_id,
      })
      papers.push(record)
      const idMatching = paperIds.get(paper_id) ?? []
      idMatching.push(`${source.source_id}::${unit.relative_path}`)
      paperIds.set(paper_id, idMatching)
      audit.private_path_lookup[paper_id] = unit.absolute_path
      if (identity_source === "path_hash") audit.counts.identity_pending_units += 1
      else audit.counts.standard_units += 1
      if (identity_source !== "path_hash") {
        const matching = explicitIds.get(paper_id) ?? []
        matching.push(unit.relative_path)
        explicitIds.set(paper_id, matching)
      }
      const slug = makeSlug(paper_id)
      const slugMatching = slugIds.get(slug) ?? []
      slugMatching.push(paper_id)
      slugIds.set(slug, slugMatching)
      if (artifacts.pdf.length > 1) audit.warnings.multiple_versions.push(`${paper_id}:pdf`)
      if (artifacts.ocr.length > 1) audit.warnings.multiple_versions.push(`${paper_id}:ocr`)
    }
  }
  audit.counts.paper_units = papers.length
  for (const key of Object.keys(overridePapers).sort((left, right) => left.localeCompare(right))) {
    if (matchedOverrideKeys.has(key)) continue
    if (overridePapers[key].include === false) audit.blocking.exclusion_targets.push(key)
    else audit.warnings.unmatched_overrides.push(key)
  }
  for (const [id, locations] of paperIds) if (locations.length > 1) audit.blocking.duplicate_ids.push(id)
  for (const [id, locations] of explicitIds) if (locations.length > 1) audit.blocking.duplicate_explicit_ids.push(id)
  for (const [slug, ids] of slugIds) if (new Set(ids).size > 1) audit.blocking.slug_collisions.push(slug)
  for (const items of Object.values(audit.blocking)) items.sort((left, right) => left.localeCompare(right))
  if (audit.blocking.duplicate_ids.length > 0) throw blockingError(audit)
  validateParentRelationships(papers, audit)
  for (const items of Object.values(audit.blocking)) items.sort((left, right) => left.localeCompare(right))
  throwIfBlocking(audit)
  papers.sort((left, right) => left.source_id.localeCompare(right.source_id) || left.relative_path.localeCompare(right.relative_path))
  return { papers, audit }
}

export function createPaperSourceScanner({ markdownFileSystem } = {}) {
  const readMarkdownPrefix = createSafeMarkdownPrefixReader(markdownFileSystem)
  return (options) => scanPaperSourcesWithReader(options, readMarkdownPrefix)
}

export const scanPaperSources = createPaperSourceScanner()
