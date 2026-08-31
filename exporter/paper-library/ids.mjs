import { createHash } from "node:crypto"
import posix from "node:path/posix"

export function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("相对路径不能为空")
  }
  const normalized = posix.normalize(relativePath.replaceAll("\\", "/"))
  if (normalized === "" || posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("相对路径越出扫描根")
  }
  return normalized
}

export function makePathPaperId({ sourceId, relativePath }) {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const digest = createHash("sha256")
    .update(`${sourceId}\0${normalizedRelativePath}`, "utf8")
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()
  return `LIB-${digest}`
}

export function makeSlug(paperId) {
  const slug = String(paperId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("paper_id 无法生成 slug")
  return slug
}

export function makeOverrideKey({ sourceId, relativePath }) {
  return `${sourceId}::${normalizeRelativePath(relativePath)}`
}
