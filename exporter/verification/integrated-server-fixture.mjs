import { setTimeout as delay } from "node:timers/promises"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  APPROVED_PROTOTYPE_FILES,
  startPrivateLibraryServer,
} from "../paper-library/local-server.mjs"
import {
  FACET_PATHS,
  createEmptyFacets,
} from "../paper-library/facet-schema.mjs"
import {
  serializeArchiveCommit,
  serializeArchiveMetadata,
} from "../paper-library/archive-metadata.mjs"
import { rebuildConfiguredLibrary } from "../paper-library/runtime.mjs"

export const FIXTURE_ARCHIVE_SOURCE_ID = "fixture_papers"
export const FIXTURE_IDS = Object.freeze({
  richPaper: "Fixture24-Rich",
  metadataOnlyPaper: "Fixture26-Meta",
  metadataOnlyOpenAlex: "W9000000002",
  recoveryPaper: "Fixture26-Recover",
  recoveryOpenAlex: "W9000000003",
  busyPaper: "Fixture26-Busy",
  busyOpenAlex: "W9000000004",
  newPaper: "Fixture26-New",
  newOpenAlex: "W9000000005",
})

const workspaceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const fixturePrefix = "integrated-workbench-"
const buildDesktopFiles = Object.freeze([
  "discovery-workspace.mjs",
  "discovery-batch.mjs",
  "discovery-identity.mjs",
  "journal-review.mjs",
  "library.template.html",
  "discovery.template.html",
  "state-transfer.html",
  "styles.css",
  "state-transfer.mjs",
  "library.mjs",
  "paper-inspector.mjs",
  "paper-math-renderer.mjs",
  "paper-library-model.mjs",
  "paper-library-storage.mjs",
  "paper-user-tags.mjs",
  "candidate-storage.mjs",
  "discovery.mjs",
  "institution-access.mjs",
  "openalex-search.mjs",
  "direction-snapshot.mjs",
  "agent-task-input.mjs",
  "vendor/katex/LICENSE",
])
const desktopFiles = Object.freeze([...new Set([
  ...APPROVED_PROTOTYPE_FILES,
  ...buildDesktopFiles,
])].sort())
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

function archiveCandidate({ paperId, title, year, openAlexId }) {
  return {
    paperId: openAlexId,
    doi: null,
    title,
    authors: ["Fixture Author"],
    year,
    source: "Fixture Journal",
    citations: 0,
    isOpenAccess: true,
    openAccessUrl: `https://openalex.org/${openAlexId}`,
    landingPageUrl: `https://openalex.org/${openAlexId}`,
    topics: ["Distributed optimization"],
    abstract: `Metadata-only fixture for ${paperId}.`,
    stage: "confirmed_for_archive",
  }
}

function explicitEmptyTagRecord() {
  return {
    record_type: "外部论文",
    facets: createEmptyFacets(),
    facet_states: Object.fromEntries(FACET_PATHS.map((path) => [path, "unrecorded"])),
    source_terms: [],
  }
}

async function put(root, relativePath, contents) {
  const destination = join(root, relativePath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, contents)
  return destination
}

async function copyDesktopRuntime(repoRoot) {
  for (const relativePath of desktopFiles) {
    const source = join(workspaceRoot, "prototype/desktop", relativePath)
    const destination = join(repoRoot, "prototype/desktop", relativePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
}

async function createRichPaper(sourceRoot) {
  const unit = "Rich Paper"
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}.pdf`, Buffer.from(
    "%PDF-1.7\nDeterministic integrated fixture PDF\n%%EOF\n",
    "utf8",
  ))
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_OCR.md`, [
    "# OCR 原文",
    "",
    "受控 OCR 文本，包含公式 $x_{k+1}=x_k-\\alpha g_k$。",
    "",
    "![OCR 图](images/ocr.png)",
  ].join("\n"))
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_论文精读.md`, [
    "# Fixture 论文精读",
    "",
    "该笔记验证行内公式 $O(\\sqrt{T})$ 与展示公式：",
    "",
    "$$x_{k+1}=\\Pi_{\\Omega}(x_k-\\alpha_k g_k).$$",
    "",
    "![算法示意](images/diagram.png)",
  ].join("\n"))
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_推导过程.md`, [
    "# 推导过程",
    "",
    "由 $V_{k+1}\\leq \\rho V_k$ 得到线性收敛。",
  ].join("\n"))
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_source_map.md`, "# 原文映射\n\n定理 1 对应受控夹具第 2 页。\n")
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_modeling.md`, "# 建模复盘\n\n目标函数与约束均为测试数据。\n")
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_仿真描述.md`, "# 仿真描述\n\n固定 4 个节点与 20 次迭代。\n")
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_code-compare.md`, "# 代码对比\n\n公式与 fixture_simulation.py 一一对应。\n")
  await put(sourceRoot, `${unit}/${FIXTURE_IDS.richPaper}_复现报告.md`, "# 复现报告\n\n运行完成，结果文件为 results/curve.png。\n")
  await put(sourceRoot, `${unit}/fixture_simulation.py`, "print('deterministic fixture result')\n")
  await put(sourceRoot, `${unit}/images/ocr.png`, onePixelPng)
  await put(sourceRoot, `${unit}/images/diagram.png`, onePixelPng)
  await put(sourceRoot, `${unit}/results/curve.png`, onePixelPng)
}

async function createMetadataOnlyPaper(sourceRoot) {
  const candidate = archiveCandidate({
    paperId: FIXTURE_IDS.metadataOnlyPaper,
    title: "Metadata-Only Integrated Fixture",
    year: 2026,
    openAlexId: FIXTURE_IDS.metadataOnlyOpenAlex,
  })
  const metadata = serializeArchiveMetadata({
    paperId: FIXTURE_IDS.metadataOnlyPaper,
    archiveSourceId: FIXTURE_ARCHIVE_SOURCE_ID,
    candidate,
    archivedAt: "2026-09-01T00:00:00.000Z",
  })
  await put(sourceRoot, `${FIXTURE_IDS.metadataOnlyPaper}/metadata.yaml`, metadata)
  await put(sourceRoot, `${FIXTURE_IDS.metadataOnlyPaper}/.metadata.commit`, serializeArchiveCommit(metadata))
}

async function createConfiguration(repoRoot, sourceRoot) {
  await put(repoRoot, "local_library_config/library.local.json", `${JSON.stringify({
    version: 1,
    archive_source_id: FIXTURE_ARCHIVE_SOURCE_ID,
    sources: [{ source_id: FIXTURE_ARCHIVE_SOURCE_ID, path: sourceRoot }],
  }, null, 2)}\n`)
  await put(repoRoot, "local_library_config/paper-overrides.json", `${JSON.stringify({
    version: 1,
    papers: {
      [`${FIXTURE_ARCHIVE_SOURCE_ID}::Rich Paper`]: {
        paper_id: FIXTURE_IDS.richPaper,
        title_original: "Rich Integrated Fixture for Distributed Optimization",
        title_zh: "分布式优化完整集成测试论文",
        authors: ["Fixture Author", "Second Author"],
        publication_year: 2024,
        venue: "Fixture Journal",
        doi_or_url: "10.1234/fixture.rich",
        unit_type: "article",
        source_status: "verified",
        evidence_status: "core_verified",
        reproduction_status: "results_recorded",
        writing_material_count: 2,
        preferred_note: `${FIXTURE_IDS.richPaper}_论文精读.md`,
      },
    },
  }, null, 2)}\n`)
  await put(repoRoot, "local_library_config/paper-tags.json", `${JSON.stringify({
    version: 3,
    papers: {
      [FIXTURE_IDS.richPaper]: explicitEmptyTagRecord(),
      [FIXTURE_IDS.metadataOnlyPaper]: explicitEmptyTagRecord(),
    },
  }, null, 2)}\n`)
  const institutionSource = join(workspaceRoot, "exporter/config/institutions/nuist.json")
  const institutionDestination = join(repoRoot, "exporter/config/institutions/nuist.json")
  await mkdir(dirname(institutionDestination), { recursive: true })
  await copyFile(institutionSource, institutionDestination)
}

function temporaryParent(value) {
  if (value === undefined || value === null || value === "") return tmpdir()
  if (typeof value !== "string" || !isAbsolute(value)) throw new TypeError("临时夹具父目录无效")
  return resolve(value)
}

export async function createIntegratedRepositoryFixture({ tempParent } = {}) {
  const parent = temporaryParent(tempParent)
  const parentInfo = await lstat(parent)
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new TypeError("临时夹具父目录无效")
  const root = await realpath(await mkdtemp(join(parent, fixturePrefix)))
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await rm(root, { recursive: true, force: true })
  }
  try {
    const sourceRoot = join(root, "fixture-papers")
    await mkdir(sourceRoot, { recursive: true })
    await copyDesktopRuntime(root)
    await createRichPaper(sourceRoot)
    await createMetadataOnlyPaper(sourceRoot)
    await createConfiguration(root, sourceRoot)
    return Object.freeze({
      root,
      repoRoot: root,
      sourceRoot,
      cleanup,
    })
  } catch (error) {
    await cleanup()
    throw error
  }
}

function contextHasPaper(context, paperId) {
  if (context?.papersById instanceof Map) return context.papersById.has(paperId)
  return Array.isArray(context?.scanned?.papers)
    && context.scanned.papers.some((paper) => paper?.paper_id === paperId)
}

function controlledRebuild({ busyDelayMs }) {
  let recoveryFailureUsed = false
  let busyDelayUsed = false
  let signalBusyEntered
  const busyEntered = new Promise((resolveBusyEntered) => {
    signalBusyEntered = resolveBusyEntered
  })
  const rebuild = async (options) => {
    if (contextHasPaper(options?.context, FIXTURE_IDS.recoveryPaper) && !recoveryFailureUsed) {
      recoveryFailureUsed = true
      throw new Error("deterministic fixture rebuild failure")
    }
    if (contextHasPaper(options?.context, FIXTURE_IDS.busyPaper) && !busyDelayUsed) {
      busyDelayUsed = true
      signalBusyEntered()
      await delay(busyDelayMs)
    }
    return rebuildConfiguredLibrary(options)
  }
  return {
    rebuild,
    async waitForBusyRebuild() {
      await Promise.race([
        busyEntered,
        delay(5_000, undefined, { ref: false }).then(() => {
          throw new Error("临时夹具未进入受控重建")
        }),
      ])
    },
  }
}

export async function startIntegratedServerFixture({ tempParent, busyDelayMs = 1_000 } = {}) {
  if (!Number.isInteger(busyDelayMs) || busyDelayMs < 0 || busyDelayMs > 5_000) {
    throw new TypeError("临时夹具延迟无效")
  }
  const repository = await createIntegratedRepositoryFixture({ tempParent })
  const controls = controlledRebuild({ busyDelayMs })
  let active = null
  let closed = false
  const start = async () => startPrivateLibraryServer({
    repoRoot: repository.repoRoot,
    port: 0,
    rebuild: controls.rebuild,
  })
  try {
    active = await start()
  } catch (error) {
    await repository.cleanup()
    throw error
  }
  return {
    get origin() { return active?.origin ?? null },
    repoRoot: repository.repoRoot,
    sourceRoot: repository.sourceRoot,
    waitForBusyRebuild: controls.waitForBusyRebuild,
    async restart() {
      if (closed || !active) throw new Error("临时夹具已关闭")
      await active.close()
      active = await start()
      return active.origin
    },
    async close() {
      if (closed) return
      closed = true
      try {
        if (active) await active.close()
      } finally {
        active = null
        await repository.cleanup()
      }
    },
  }
}

export async function runIntegratedServerFixtureProcess({
  tempParent = process.env.WORKBENCH_FIXTURE_TEMP_PARENT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let fixture
  try {
    fixture = await startIntegratedServerFixture({ tempParent })
    stdout.write(`${JSON.stringify({ origin: fixture.origin })}\n`)
    await new Promise((resolveShutdown) => {
      let requested = false
      const requestShutdown = () => {
        if (requested) return
        requested = true
        resolveShutdown()
      }
      process.once("SIGTERM", requestShutdown)
      process.once("SIGINT", requestShutdown)
      process.stdin.once("end", requestShutdown)
      process.stdin.once("error", requestShutdown)
      process.stdin.resume()
    })
    process.stdin.pause()
    await fixture.close()
    return 0
  } catch {
    if (fixture) {
      try { await fixture.close() } catch { /* fixed diagnostic remains authoritative */ }
    }
    stderr.write("集成测试服务启动失败\n")
    return 1
  }
}

const invokedPath = process.argv[1]
if (typeof invokedPath === "string" && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  process.exitCode = await runIntegratedServerFixtureProcess()
}
