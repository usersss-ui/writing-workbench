import { constants as fsConstants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import {
  extname,
  isAbsolute,
  join,
  posix,
  relative as pathRelative,
  resolve,
  sep,
} from "node:path"

export const PACKAGE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024

export const EXPECTED_PACKAGE_FILES = Object.freeze([
  ".gitignore",
  "README.md",
  "exporter/config/github-package-files.json",
  "exporter/config/library.example.json",
  "exporter/paper-library/artifacts.mjs",
  "exporter/paper-library/build.mjs",
  "exporter/paper-library/build.test.mjs",
  "exporter/paper-library/catalog-adapter.mjs",
  "exporter/paper-library/catalog-adapter.test.mjs",
  "exporter/paper-library/config.mjs",
  "exporter/paper-library/config.test.mjs",
  "exporter/paper-library/facet-schema.mjs",
  "exporter/paper-library/frontmatter.mjs",
  "exporter/paper-library/ids.mjs",
  "exporter/paper-library/ids.test.mjs",
  "exporter/paper-library/note-preview.mjs",
  "exporter/paper-library/note-preview.test.mjs",
  "exporter/paper-library/overrides.mjs",
  "exporter/paper-library/package-audit.mjs",
  "exporter/paper-library/package-audit.test.mjs",
  "exporter/paper-library/paper-tag-migration.mjs",
  "exporter/paper-library/paper-tag-migration.test.mjs",
  "exporter/paper-library/scanner.mjs",
  "exporter/paper-library/scanner.test.mjs",
  "exporter/paper-library/status.mjs",
  "exporter/paper-library/status.test.mjs",
  "exporter/paper-library/tag-catalog.mjs",
  "exporter/paper-library/tag-catalog.test.mjs",
  "exporter/scripts/audit-github-package.mjs",
  "exporter/scripts/build-private-library.mjs",
  "exporter/scripts/migrate-paper-tags-v3.mjs",
  "prototype/desktop/README.md",
  "prototype/desktop/app.mjs",
  "prototype/desktop/directions.html",
  "prototype/desktop/directions.mjs",
  "prototype/desktop/index.html",
  "prototype/desktop/library.mjs",
  "prototype/desktop/library.template.html",
  "prototype/desktop/p02.html",
  "prototype/desktop/paper-filter.mjs",
  "prototype/desktop/paper-inspector.mjs",
  "prototype/desktop/paper-library-dom.test.mjs",
  "prototype/desktop/paper-library-model.mjs",
  "prototype/desktop/paper-library-model.test.mjs",
  "prototype/desktop/paper-library-storage.mjs",
  "prototype/desktop/paper-library-storage.test.mjs",
  "prototype/desktop/paper-math-renderer.mjs",
  "prototype/desktop/paper-math-renderer.test.mjs",
  "prototype/desktop/papers-data.mjs",
  "prototype/desktop/styles.css",
  "prototype/desktop/vendor/katex/LICENSE",
  "prototype/desktop/vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Math-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Script-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size1-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size2-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size3-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Size4-Regular.woff2",
  "prototype/desktop/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "prototype/desktop/vendor/katex/katex.min.css",
  "prototype/desktop/vendor/katex/katex.mjs",
])

const EXPECTED_PACKAGE_FILE_SET = new Set(EXPECTED_PACKAGE_FILES)
const MANIFEST_RELATIVE_PATH = "exporter/config/github-package-files.json"
const EXAMPLE_CONFIG_RELATIVE_PATH = "exporter/config/library.example.json"
const PATH_PLACEHOLDER = "REPLACE_WITH_ABSOLUTE_PATH"
const PRIVATE_DIRECTORY_SEGMENTS = new Set([
  "local_library_config",
  "local_library_data",
  "local_library_output",
])
const CACHE_DIRECTORY_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".npm",
  ".pytest_cache",
  "__pycache__",
  "cache",
  "node_modules",
])
const BLOCKED_EXTENSIONS = new Set([
  ".7z", ".bz2", ".cache", ".cer", ".crt", ".db", ".der", ".env", ".gz",
  ".jks", ".key", ".p12", ".pem", ".pfx", ".pyc", ".pyo", ".rar", ".sqlite",
  ".sqlite3", ".tar", ".temp", ".tmp", ".xz", ".zip", ".pdf",
])
const SENSITIVE_JSON_KEYS = new Set([
  "rootpath",
  "paperdir",
  "absolutepath",
  "sourcepath",
  "sourcepaths",
  "sourceroot",
  "privatepathlookup",
  "artifactpath",
  "artifactpaths",
  "artifactsourcepath",
  "artifactsourcepaths",
  "papersourcepath",
  "papersourcepaths",
])
const PRIVATE_POSIX_SIGNATURES = [
  ["", "Users", ""].join("/"),
  ["", "home", ""].join("/"),
]
const SECRET_NAMES = [["API", "KEY"].join("_"), "TOKEN", "PASSWORD"]
const SECRET_ASSIGNMENT_RE = new RegExp(`\\b(?:${SECRET_NAMES.join("|")})\\s*=`, "u")
const WINDOWS_ABSOLUTE_CONTENT_RE = /(?<![A-Za-z0-9_-])[A-Za-z]:[\\/]/u
// A JavaScript regular-expression literal such as /\\mathcal\s+/ contains the
// same leading slash shape as a UNC path. Exclude one-character regex escape
// tokens when they are immediately followed by regex syntax, while continuing
// to reject actual network-share roots.
const WINDOWS_UNC_CONTENT_RE = /(?<!\\)\\\\[A-Za-z0-9._$-]+\\(?![bBdDsSwW](?:[+*?{|()[\].^$]|$))[A-Za-z0-9._$-]+/u
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })
const GENERATED_LIBRARY_PATH = "local_library_output/desktop/library.html"
const KATEX_FONT_PREFIX = "prototype/desktop/vendor/katex/fonts/"
const KATEX_WOFF2_MAGIC = Buffer.from("wOF2", "ascii")
const GENERATED_ASSET_SOURCE = new Map([
  ["local_library_output/desktop/assets/styles.css", "prototype/desktop/styles.css"],
  ["local_library_output/desktop/assets/library.mjs", "prototype/desktop/library.mjs"],
  ["local_library_output/desktop/assets/paper-inspector.mjs", "prototype/desktop/paper-inspector.mjs"],
  ["local_library_output/desktop/assets/paper-math-renderer.mjs", "prototype/desktop/paper-math-renderer.mjs"],
  ["local_library_output/desktop/assets/paper-library-model.mjs", "prototype/desktop/paper-library-model.mjs"],
  ["local_library_output/desktop/assets/paper-library-storage.mjs", "prototype/desktop/paper-library-storage.mjs"],
  ["local_library_output/desktop/assets/vendor/katex/katex.min.css", "prototype/desktop/vendor/katex/katex.min.css"],
  ["local_library_output/desktop/assets/vendor/katex/katex.mjs", "prototype/desktop/vendor/katex/katex.mjs"],
])

export class PackageBoundaryError extends Error {
  constructor(code, { itemIndex = null } = {}) {
    super(`package-boundary:${code}`)
    this.name = "PackageBoundaryError"
    this.code = code
    this.itemIndex = itemIndex
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function pathFormatIssue(rawPath) {
  if (typeof rawPath !== "string" || rawPath === "") return "candidate_path_invalid"
  if (rawPath !== rawPath.trim() || rawPath.includes("\0") || rawPath.includes("\\")) {
    return "candidate_path_invalid"
  }
  if (posix.isAbsolute(rawPath) || /^[A-Za-z]:\//u.test(rawPath)) return "candidate_path_invalid"
  const segments = rawPath.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "candidate_path_invalid"
  }
  if (posix.normalize(rawPath) !== rawPath) return "candidate_path_invalid"
  return null
}

function forbiddenPathCode(rawPath) {
  const segments = rawPath.split("/")
  const lowerSegments = segments.map((segment) => segment.toLocaleLowerCase("en-US"))
  if (lowerSegments.some((segment) => PRIVATE_DIRECTORY_SEGMENTS.has(segment))) {
    return "candidate_private_directory"
  }
  if (lowerSegments.some((segment) => CACHE_DIRECTORY_SEGMENTS.has(segment))) {
    return "candidate_cache_path"
  }
  const basename = lowerSegments.at(-1)
  if (lowerSegments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    return "candidate_secret_file"
  }
  if (/^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.|$)/u.test(basename) || basename === "authorized_keys") {
    return "candidate_secret_file"
  }
  if (BLOCKED_EXTENSIONS.has(extname(basename))) return "candidate_blocked_extension"
  const privateArtifactSegment = lowerSegments.some((segment) => (
    segment.includes("ocr")
    || segment.includes("中文翻译")
    || segment.includes("全文翻译")
    || segment.includes("论文精读")
    || segment.includes("deep-note")
    || segment.includes("deep_note")
    || segment.includes("深度笔记")
    || segment.includes("secret")
    || segment.includes("result")
  ))
  if (privateArtifactSegment) {
    return "candidate_private_artifact"
  }
  return null
}

function safeCandidateLabel(rawPath, itemIndex) {
  return typeof rawPath === "string" && EXPECTED_PACKAGE_FILE_SET.has(rawPath)
    ? rawPath
    : `候选第 ${itemIndex} 项`
}

function candidateBuffer(content) {
  if (typeof content === "string") return Buffer.from(content, "utf8")
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content)
  return null
}

function decodeCandidate(buffer) {
  if (buffer.length > PACKAGE_SIZE_LIMIT_BYTES) return { code: "content_oversized" }
  if (buffer.includes(0)) return { code: "content_binary" }
  try {
    return { text: UTF8_DECODER.decode(buffer) }
  } catch {
    return { code: "content_not_utf8" }
  }
}

function inspectJsonValue(value, candidatePath, trail = []) {
  if (typeof value === "string") {
    if (value !== PATH_PLACEHOLDER) return null
    const allowed = candidatePath === EXAMPLE_CONFIG_RELATIVE_PATH
      && trail.length === 3
      && trail[0] === "sources"
      && Number.isInteger(trail[1])
      && trail[2] === "path"
    return allowed ? null : "json_placeholder_location"
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const issue = inspectJsonValue(value[index], candidatePath, [...trail, index])
      if (issue) return issue
    }
    return null
  }
  if (!isPlainObject(value)) return null
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]/gu, "")
    if (SENSITIVE_JSON_KEYS.has(normalizedKey)) return "json_sensitive_key"
    const issue = inspectJsonValue(child, candidatePath, [...trail, key])
    if (issue) return issue
  }
  return null
}

function contentIssueCode(candidatePath, content) {
  const buffer = candidateBuffer(content)
  if (!buffer) return "content_invalid"
  if (candidatePath.startsWith(KATEX_FONT_PREFIX) && candidatePath.endsWith(".woff2")) {
    if (buffer.length > PACKAGE_SIZE_LIMIT_BYTES) return "content_oversized"
    if (buffer.length < KATEX_WOFF2_MAGIC.length || !buffer.subarray(0, KATEX_WOFF2_MAGIC.length).equals(KATEX_WOFF2_MAGIC)) {
      return "content_binary"
    }
    return null
  }
  const decoded = decodeCandidate(buffer)
  if (decoded.code) return decoded.code
  const { text } = decoded
  if (
    PRIVATE_POSIX_SIGNATURES.some((signature) => text.includes(signature))
    || WINDOWS_ABSOLUTE_CONTENT_RE.test(text)
    || WINDOWS_UNC_CONTENT_RE.test(text)
    || SECRET_ASSIGNMENT_RE.test(text)
  ) {
    return "content_private_signature"
  }
  if (extname(candidatePath).toLocaleLowerCase("en-US") !== ".json") return null
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return "json_invalid"
  }
  return inspectJsonValue(parsed, candidatePath)
}

function decodedCandidateText(content) {
  const buffer = candidateBuffer(content)
  if (!buffer) return null
  const decoded = decodeCandidate(buffer)
  return decoded.code ? null : decoded.text
}

function htmlReferences(text) {
  const references = []
  const pattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/giu
  let match
  while ((match = pattern.exec(text)) !== null) references.push(match[2])
  return references
}

function staticImportReferences(text) {
  const references = []
  const fromPattern = /\bfrom\s+(["'])([^"']+)\1/gu
  const barePattern = /(?:^|\n)\s*import\s*(["'])([^"']+)\1/gu
  let match
  while ((match = fromPattern.exec(text)) !== null) references.push(match[2])
  while ((match = barePattern.exec(text)) !== null) references.push(match[2])
  return references
}

function localReferenceTarget(sourcePath, rawReference) {
  if (typeof rawReference !== "string" || rawReference === "" || rawReference.startsWith("#")) return null
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(rawReference) || rawReference.startsWith("//")) return null
  const reference = rawReference.split(/[?#]/u, 1)[0]
  if (reference === "") return null
  const runtimeSource = sourcePath === "prototype/desktop/library.template.html"
    ? GENERATED_LIBRARY_PATH
    : sourcePath
  const resolved = posix.normalize(posix.join(posix.dirname(runtimeSource), reference))
  if (posix.isAbsolute(resolved) || resolved === ".." || resolved.startsWith("../")) return false
  if (resolved === GENERATED_LIBRARY_PATH) return GENERATED_LIBRARY_PATH
  return GENERATED_ASSET_SOURCE.get(resolved) ?? resolved
}

export function auditPackageDependencyClosure(candidates) {
  const blocking = []
  let checkedCount = 0
  if (!Array.isArray(candidates)) return { blocking, checkedCount }
  const blockedSources = new Set()
  for (const candidate of candidates) {
    if (!isPlainObject(candidate) || !EXPECTED_PACKAGE_FILE_SET.has(candidate.path)) continue
    const isHtml = candidate.path.endsWith(".html")
    const isModule = candidate.path.endsWith(".mjs")
    if (!isHtml && !isModule) continue
    const text = decodedCandidateText(candidate.content)
    if (text === null) continue
    const references = [
      ...(isHtml ? htmlReferences(text) : []),
      ...staticImportReferences(text),
    ]
    for (const reference of references) {
      const target = localReferenceTarget(candidate.path, reference)
      if (target === null) continue
      checkedCount += 1
      const allowed = target !== false
        && (target === GENERATED_LIBRARY_PATH || EXPECTED_PACKAGE_FILE_SET.has(target))
      if (!allowed && !blockedSources.has(candidate.path)) {
        blockedSources.add(candidate.path)
        blocking.push({ path: candidate.path, code: "dependency_unlisted" })
      }
    }
  }
  return { blocking, checkedCount }
}

export function auditPackageCandidates(candidates) {
  const blocking = []
  if (!Array.isArray(candidates)) {
    return {
      blocking: [{ path: "候选项", code: "candidate_collection_invalid" }],
      checkedCount: 0,
    }
  }
  const seen = new Set()
  for (let index = 0; index < candidates.length; index += 1) {
    const itemIndex = index + 1
    const candidate = candidates[index]
    const rawPath = isPlainObject(candidate) ? candidate.path : null
    const label = safeCandidateLabel(rawPath, itemIndex)
    const formatIssue = pathFormatIssue(rawPath)
    if (formatIssue) {
      blocking.push({ path: label, code: formatIssue })
      continue
    }
    if (seen.has(rawPath)) {
      blocking.push({ path: `候选第 ${itemIndex} 项`, code: "candidate_duplicate" })
      continue
    }
    seen.add(rawPath)
    const forbiddenIssue = forbiddenPathCode(rawPath)
    if (forbiddenIssue) {
      blocking.push({ path: label, code: forbiddenIssue })
      continue
    }
    if (!EXPECTED_PACKAGE_FILE_SET.has(rawPath)) {
      blocking.push({ path: `候选第 ${itemIndex} 项`, code: "candidate_unlisted" })
      continue
    }
    const contentIssue = contentIssueCode(rawPath, candidate.content)
    if (contentIssue) blocking.push({ path: rawPath, code: contentIssue })
  }
  blocking.push(...auditPackageDependencyClosure(candidates).blocking)
  return { blocking, checkedCount: candidates.length }
}

function throwBoundary(code, itemIndex = null) {
  throw new PackageBoundaryError(code, { itemIndex })
}

async function canonicalRepositoryRoot(repoRoot) {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) throwBoundary("repo_root")
  const lexicalRoot = resolve(repoRoot)
  let info
  let canonicalRoot
  try {
    info = await lstat(lexicalRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) throwBoundary("repo_root")
    canonicalRoot = await realpath(lexicalRoot)
  } catch (error) {
    if (error instanceof PackageBoundaryError) throw error
    throwBoundary("repo_root")
  }
  return { lexicalRoot, canonicalRoot }
}

function isWithinRoot(root, candidate) {
  const delta = pathRelative(root, candidate)
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta))
}

function sameFileFingerprint(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

async function inspectPathComponents(root, relativePath, itemIndex, manifest = false) {
  let current = root
  const segments = relativePath.split("/")
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    let info
    try {
      info = await lstat(current, { bigint: true })
    } catch {
      throwBoundary(manifest ? "manifest_read" : "candidate_missing", itemIndex)
    }
    if (info.isSymbolicLink()) throwBoundary(manifest ? "manifest_read" : "candidate_symlink", itemIndex)
    if (index < segments.length - 1 && !info.isDirectory()) {
      throwBoundary(manifest ? "manifest_read" : "candidate_parent_invalid", itemIndex)
    }
    if (index === segments.length - 1 && !info.isFile()) {
      throwBoundary(manifest ? "manifest_read" : "candidate_not_regular", itemIndex)
    }
  }
  return current
}

async function secureReadRelative(root, relativePath, itemIndex = null, manifest = false) {
  const lexicalPath = await inspectPathComponents(root, relativePath, itemIndex, manifest)
  let initialStat
  let initialRealPath
  try {
    initialStat = await lstat(lexicalPath, { bigint: true })
    initialRealPath = await realpath(lexicalPath)
  } catch {
    throwBoundary(manifest ? "manifest_read" : "candidate_read", itemIndex)
  }
  if (!isWithinRoot(root, initialRealPath) || initialRealPath !== lexicalPath) {
    throwBoundary(manifest ? "manifest_read" : "candidate_escape", itemIndex)
  }

  let handle
  let content
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0
    handle = await open(lexicalPath, fsConstants.O_RDONLY | noFollow)
    const beforeRead = await handle.stat({ bigint: true })
    if (!beforeRead.isFile() || !sameFileFingerprint(initialStat, beforeRead)) {
      throwBoundary(manifest ? "manifest_changed" : "candidate_changed", itemIndex)
    }
    content = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    if (!sameFileFingerprint(beforeRead, afterRead) || BigInt(content.length) !== afterRead.size) {
      throwBoundary(manifest ? "manifest_changed" : "candidate_changed", itemIndex)
    }
  } catch (error) {
    if (error instanceof PackageBoundaryError) throw error
    throwBoundary(manifest ? "manifest_read" : "candidate_read", itemIndex)
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* read-only audit fails on the checks above */ }
    }
  }

  const afterPath = await inspectPathComponents(root, relativePath, itemIndex, manifest)
  let finalStat
  let finalRealPath
  try {
    finalStat = await lstat(afterPath, { bigint: true })
    finalRealPath = await realpath(afterPath)
  } catch {
    throwBoundary(manifest ? "manifest_changed" : "candidate_changed", itemIndex)
  }
  if (
    afterPath !== lexicalPath
    || finalRealPath !== initialRealPath
    || !isWithinRoot(root, finalRealPath)
    || !sameFileFingerprint(initialStat, finalStat)
  ) {
    throwBoundary(manifest ? "manifest_changed" : "candidate_changed", itemIndex)
  }
  return content
}

function decodeManifest(buffer) {
  if (buffer.length > PACKAGE_SIZE_LIMIT_BYTES || buffer.includes(0)) throwBoundary("manifest_json")
  let text
  try {
    text = UTF8_DECODER.decode(buffer)
  } catch {
    throwBoundary("manifest_json")
  }
  try {
    return JSON.parse(text)
  } catch {
    throwBoundary("manifest_json")
  }
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) throwBoundary("manifest_schema")
  const keys = Object.keys(manifest)
  if (keys.length !== 2 || !keys.includes("version") || !keys.includes("files")) {
    throwBoundary("manifest_schema")
  }
  if (manifest.version !== 1) throwBoundary("manifest_version")
  if (!Array.isArray(manifest.files)) throwBoundary("manifest_schema")

  const seen = new Set()
  for (let index = 0; index < manifest.files.length; index += 1) {
    const itemIndex = index + 1
    const rawPath = manifest.files[index]
    if (pathFormatIssue(rawPath)) throwBoundary("manifest_item_invalid", itemIndex)
    if (seen.has(rawPath)) throwBoundary("manifest_item_duplicate", itemIndex)
    seen.add(rawPath)
    if (!EXPECTED_PACKAGE_FILE_SET.has(rawPath)) throwBoundary("manifest_item_unlisted", itemIndex)
    if (index > 0 && manifest.files[index - 1] >= rawPath) {
      throwBoundary("manifest_unsorted", itemIndex)
    }
  }
  if (
    manifest.files.length !== EXPECTED_PACKAGE_FILES.length
    || EXPECTED_PACKAGE_FILES.some((expected) => !seen.has(expected))
  ) {
    throwBoundary("manifest_set_mismatch")
  }
  return manifest.files
}

export async function collectPackageCandidates({ repoRoot, manifestPath } = {}) {
  const { lexicalRoot, canonicalRoot } = await canonicalRepositoryRoot(repoRoot)
  const expectedManifestPath = join(lexicalRoot, ...MANIFEST_RELATIVE_PATH.split("/"))
  if (typeof manifestPath !== "string" || !isAbsolute(manifestPath) || resolve(manifestPath) !== expectedManifestPath) {
    throwBoundary("manifest_location")
  }
  const manifestBuffer = await secureReadRelative(canonicalRoot, MANIFEST_RELATIVE_PATH, null, true)
  const files = validateManifest(decodeManifest(manifestBuffer))
  const candidates = []
  for (let index = 0; index < files.length; index += 1) {
    const relativePath = files[index]
    const content = relativePath === MANIFEST_RELATIVE_PATH
      ? manifestBuffer
      : await secureReadRelative(canonicalRoot, relativePath, index + 1, false)
    candidates.push({ path: relativePath, content })
  }
  return candidates
}
