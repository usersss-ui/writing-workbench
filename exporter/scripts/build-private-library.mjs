import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildPrivateLibrary } from "../paper-library/build.mjs"
import { loadPaperCatalog } from "../paper-library/catalog-adapter.mjs"
import { loadLibraryConfig } from "../paper-library/config.mjs"
import { loadPaperOverrides } from "../paper-library/overrides.mjs"
import { loadPaperTagCatalog } from "../paper-library/tag-catalog.mjs"

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export async function main({
  repoRoot = SCRIPT_REPO_ROOT,
  loadConfig = loadLibraryConfig,
  loadOverrides = loadPaperOverrides,
  loadTags = loadPaperTagCatalog,
  loadCatalog = loadPaperCatalog,
  build = buildPrivateLibrary,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const configPath = join(repoRoot, "local_library_config/library.local.json")
  const overridesPath = join(repoRoot, "local_library_config/paper-overrides.json")
  try {
    const config = await loadConfig(configPath)
    const overrides = await loadOverrides(overridesPath)
    const tagCatalog = await loadTags(join(repoRoot, "local_library_config/paper-tags.json"))
    const catalogs = {}
    for (const source of config.sources) {
      if (source.catalog_path === null || source.catalog_path === undefined) continue
      catalogs[source.source_id] = await loadCatalog(source.catalog_path, { sourceId: source.source_id })
    }
    const result = await build({
      repoRoot,
      config,
      overrides,
      catalogs,
      tagCatalog,
      templateRoot: join(repoRoot, "prototype/desktop"),
    })
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
