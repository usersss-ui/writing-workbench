import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  loadPrivateLibraryContext,
  rebuildConfiguredLibrary,
} from "../paper-library/runtime.mjs"

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export async function main({
  repoRoot = SCRIPT_REPO_ROOT,
  loadContext = loadPrivateLibraryContext,
  rebuild = rebuildConfiguredLibrary,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  try {
    const context = await loadContext({ repoRoot })
    const result = await rebuild({ repoRoot, context })
    stdout("私有论文库构建完成")
    stdout(`论文记录：${result.paperCount}`)
    stdout(`笔记预览：${result.previewCount}`)
    stdout(`生成页面：${result.pageCount}`)
    stdout(`排除记录：${result.excludedCount}`)
    stdout("生成：local_library_data/paper-index.json")
    stdout("生成：local_library_data/paper-library-audit.json")
    stdout("生成：local_library_output/desktop/library.html")
    return 0
  } catch {
    stderr("私有论文库构建失败。请检查本机配置、覆盖映射和审计边界。")
    return 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) process.exitCode = await main()
