import { join } from "node:path"
import { buildPrivateLibrary } from "./build.mjs"
import { loadPaperCatalog } from "./catalog-adapter.mjs"
import { loadLibraryConfig } from "./config.mjs"
import { loadPaperOverrides } from "./overrides.mjs"
import { scanPaperSources } from "./scanner.mjs"
import { loadPaperTagCatalog } from "./tag-catalog.mjs"

export async function loadPrivateLibraryContext({
  repoRoot,
  loadConfig = loadLibraryConfig,
  loadOverrides = loadPaperOverrides,
  loadTags = loadPaperTagCatalog,
  loadCatalog = loadPaperCatalog,
  scan = scanPaperSources,
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new TypeError("论文库根目录无效")
  const config = await loadConfig(join(repoRoot, "local_library_config/library.local.json"))
  const overrides = await loadOverrides(join(repoRoot, "local_library_config/paper-overrides.json"))
  const tagCatalog = await loadTags(join(repoRoot, "local_library_config/paper-tags.json"))
  const catalogs = {}
  for (const source of config.sources) {
    if (source.catalog_path === null || source.catalog_path === undefined) continue
    catalogs[source.source_id] = await loadCatalog(source.catalog_path, { sourceId: source.source_id })
  }

  const scanned = await scan({ config, overrides, catalogs })
  const papersById = new Map()
  const unitDirectoryByPaperId = new Map()
  for (const paper of scanned.papers) {
    const directory = scanned.audit?.private_path_lookup?.[paper.paper_id]
    if (papersById.has(paper.paper_id) || typeof directory !== "string" || directory.length === 0) {
      throw new Error("当前论文扫描映射无效")
    }
    papersById.set(paper.paper_id, paper)
    unitDirectoryByPaperId.set(paper.paper_id, directory)
  }
  return { config, overrides, tagCatalog, catalogs, scanned, papersById, unitDirectoryByPaperId }
}

export function rebuildConfiguredLibrary({ repoRoot, context, build = buildPrivateLibrary } = {}) {
  if (!context?.config || !context?.overrides || !context?.catalogs || !context?.tagCatalog) {
    throw new TypeError("论文库运行上下文无效")
  }
  return build({
    repoRoot,
    config: context.config,
    overrides: context.overrides,
    catalogs: context.catalogs,
    tagCatalog: context.tagCatalog,
    templateRoot: join(repoRoot, "prototype/desktop"),
  })
}
