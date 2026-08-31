import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  EXPECTED_PACKAGE_FILES,
  PackageBoundaryError,
  auditPackageCandidates,
  collectPackageCandidates,
} from "../paper-library/package-audit.mjs"

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const MANIFEST_PATH = join(SCRIPT_REPO_ROOT, "exporter/config/github-package-files.json")
const EXPECTED_SET = new Set(EXPECTED_PACKAGE_FILES)
const SAFE_CANDIDATE_ORDINAL_CODES = new Set([
  "candidate_missing",
  "candidate_symlink",
  "candidate_not_regular",
  "candidate_read",
  "candidate_changed",
  "candidate_escape",
  "candidate_parent_invalid",
])

const REASONS = Object.freeze({
  candidate_blocked_extension: "文件类型属于论文、密钥、数据库、压缩包或缓存",
  candidate_cache_path: "路径属于缓存或依赖目录",
  candidate_changed: "读取期间候选文件发生变化",
  candidate_collection_invalid: "候选集合格式无效",
  candidate_duplicate: "候选文件重复",
  candidate_escape: "候选文件解析到固定项目边界之外",
  candidate_invalid: "候选内容或路径不符合固定打包边界",
  candidate_path_invalid: "路径格式不安全",
  candidate_private_artifact: "文件名属于 OCR、翻译、精读、秘密或结果材料",
  candidate_private_directory: "路径属于私有配置或生成目录",
  candidate_read: "候选文件无法安全读取",
  candidate_secret_file: "文件名属于环境变量或密钥材料",
  candidate_symlink: "候选路径含符号链接",
  candidate_unlisted: "文件不在固定候选集合中",
  content_binary: "候选内容疑似二进制",
  content_invalid: "候选内容格式无效",
  content_not_utf8: "候选内容不是有效 UTF-8",
  content_oversized: "候选文件超过固定大小上限",
  content_private_signature: "候选内容含私有绝对路径或密钥赋值",
  dependency_unlisted: "相对页面或模块依赖不在固定候选集合中",
  json_invalid: "JSON 内容无法解析",
  json_placeholder_location: "绝对路径占位符出现在未授权位置",
  json_sensitive_key: "JSON 含私有来源路径字段",
})

const BOUNDARY_ERRORS = Object.freeze({
  candidate_changed: "候选文件读取期间发生变化",
  candidate_escape: "候选文件解析到项目边界之外",
  candidate_missing: "候选文件不存在",
  candidate_not_regular: "候选路径不是普通文件",
  candidate_parent_invalid: "候选路径的父级不是目录",
  candidate_read: "候选文件无法安全读取",
  candidate_symlink: "候选路径含符号链接",
  manifest_changed: "打包清单读取期间发生变化",
  manifest_item_duplicate: "清单路径重复",
  manifest_item_invalid: "路径格式不安全",
  manifest_item_unlisted: "路径不在固定候选集合中",
  manifest_json: "打包清单不是有效的 UTF-8 JSON",
  manifest_location: "打包清单不在固定位置",
  manifest_read: "打包清单无法安全读取",
  manifest_schema: "打包清单只能包含 version 和 files",
  manifest_set_mismatch: "打包清单与固定候选集合不一致",
  manifest_unsorted: "打包清单未按字典序排列",
  manifest_version: "打包清单版本必须为 1",
  repo_root: "项目根目录无效",
})

function safeBlockingPath(path) {
  if (typeof path === "string" && EXPECTED_SET.has(path)) return path
  if (typeof path === "string" && /^(?:候选|清单)第 [1-9][0-9]* 项$/u.test(path)) return path
  return "候选项"
}

function safeBlockingReason(code) {
  return REASONS[code] ?? REASONS.candidate_invalid
}

function boundaryErrorLine(error) {
  if (!(error instanceof PackageBoundaryError)) return "打包边界无法安全读取"
  const reason = BOUNDARY_ERRORS[error.code] ?? "打包边界无法安全读取"
  if (Number.isInteger(error.itemIndex) && error.itemIndex > 0) {
    const safeCandidatePath = SAFE_CANDIDATE_ORDINAL_CODES.has(error.code)
      ? EXPECTED_PACKAGE_FILES[error.itemIndex - 1]
      : null
    if (safeCandidatePath) return `${safeCandidatePath}：${reason}`
    return `清单第 ${error.itemIndex} 项：${reason}`
  }
  return reason
}

export async function main({
  collectCandidates = collectPackageCandidates,
  auditCandidates = auditPackageCandidates,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  let candidates
  try {
    candidates = await collectCandidates({
      repoRoot: SCRIPT_REPO_ROOT,
      manifestPath: MANIFEST_PATH,
    })
  } catch (error) {
    stderr("GitHub 打包审计：失败")
    stderr(`- ${boundaryErrorLine(error)}`)
    return 1
  }

  let result
  try {
    result = auditCandidates(candidates)
  } catch {
    stderr("GitHub 打包审计：失败")
    stderr("- 候选内容或路径不符合固定打包边界")
    return 1
  }
  if (!result || !Array.isArray(result.blocking) || !Number.isInteger(result.checkedCount)) {
    stderr("GitHub 打包审计：失败")
    stderr("- 候选内容或路径不符合固定打包边界")
    return 1
  }
  if (result.blocking.length > 0) {
    stderr(`GitHub 打包审计：失败（${result.checkedCount} 个候选文件）`)
    for (const entry of result.blocking) {
      stderr(`- ${safeBlockingPath(entry?.path)}：${safeBlockingReason(entry?.code)}`)
    }
    return 1
  }
  stdout(`GitHub 打包审计：通过（${result.checkedCount} 个候选文件）`)
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) process.exitCode = await main()
