import { readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/

export async function loadLibraryConfig(configPath) {
  const contents = await readFile(configPath, "utf8")
  const raw = JSON.parse(contents)

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("配置必须是 JSON 对象")
  }
  if (raw.version !== 1) {
    throw new Error("配置 version 必须为 1")
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new Error("配置 sources 必须是非空数组")
  }

  const seen = new Set()
  const sources = raw.sources.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`sources[${index}] 必须是对象`)
    }
    const { source_id: sourceId, path, catalog_path: catalogPath } = source
    if (typeof sourceId !== "string" || !SOURCE_ID_PATTERN.test(sourceId)) {
      throw new Error(`sources[${index}].source_id 格式无效`)
    }
    if (seen.has(sourceId)) {
      throw new Error(`source_id 重复: ${sourceId}`)
    }
    seen.add(sourceId)
    if (typeof path !== "string" || !isAbsolute(path)) {
      throw new Error(`sources[${index}].path 必须是绝对路径`)
    }
    if (catalogPath !== undefined && (typeof catalogPath !== "string" || !isAbsolute(catalogPath))) {
      throw new Error(`sources[${index}].catalog_path 必须是绝对路径`)
    }
    return Object.freeze({ source_id: sourceId, path, catalog_path: catalogPath ?? null })
  })

  return Object.freeze({ version: 1, sources: Object.freeze(sources) })
}
