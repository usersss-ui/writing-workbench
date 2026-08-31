import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { migratePaperTagCatalogV2 } from "../paper-library/paper-tag-migration.mjs"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_CATALOG = join(REPO_ROOT, "local_library_config/paper-tags.json")

export async function main({
  catalogPath = DEFAULT_CATALOG,
  renameFile = rename,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const target = resolve(catalogPath)
  const temporary = `${target}.next-${process.pid}`
  let migrated
  let temporaryIdentity = null
  try {
    migrated = migratePaperTagCatalogV2(JSON.parse(await readFile(target, "utf8")))
    await writeFile(temporary, `${JSON.stringify(migrated, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    const created = await lstat(temporary)
    temporaryIdentity = { dev: created.dev, ino: created.ino }
    await renameFile(temporary, target)
    temporaryIdentity = null
  } catch {
    if (temporaryIdentity !== null) {
      try {
        const current = await lstat(temporary)
        if (current.dev === temporaryIdentity.dev && current.ino === temporaryIdentity.ino) {
          await unlink(temporary)
        }
      } catch {
        // An absent or unverifiable path is never safe to delete.
      }
    }
    stderr("标签目录迁移失败；原文件未被替换。")
    return 1
  }
  stdout(`标签目录已迁移到 version 3：${Object.keys(migrated.papers).length} 条记录`)
  return 0
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invoked === import.meta.url) process.exitCode = await main({ catalogPath: process.argv[2] ?? DEFAULT_CATALOG })
