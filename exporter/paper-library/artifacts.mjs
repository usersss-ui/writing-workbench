import path from "node:path/posix"

export const ARTIFACT_KEYS = Object.freeze([
  "pdf", "ocr", "translation", "note", "derivation", "source_map",
  "modeling", "simulation", "code_compare", "script", "result", "reproduction_report",
])

export function createEmptyArtifacts() {
  return Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, []]))
}

export function classifyArtifact({ relativePath, siblingPdfStems = [], explicitCategory = null }) {
  if (explicitCategory !== null) return ARTIFACT_KEYS.includes(explicitCategory) ? explicitCategory : null
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase()
  const fileName = path.basename(normalized)
  const extension = path.extname(fileName)
  const fileStem = path.basename(fileName, extension)
  const isMarkdown = extension === ".md" || extension === ".markdown"
  if (extension === ".pdf") return "pdf"
  if (fileName.includes("source_map")) return "source_map"
  if (fileName.includes("复现报告") || fileName.includes("reproduction-report")) return "reproduction_report"
  if (fileName.includes("仿真描述") || fileName.includes("simulation") || fileName.includes("实验设置")) return "simulation"
  if (fileName.includes("代码对比") || fileName.includes("code-compare")) return "code_compare"
  if ([".py", ".m", ".mlx", ".ipynb", ".jl", ".r"].includes(extension)) return "script"
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension)
    && normalized.split("/").slice(0, -1).some((segment) => ["result", "results", "结果", "figures"].includes(segment))) return "result"
  if (fileName.includes("推导过程") || fileName.includes("derivation") || fileName.includes("proof-notes")) return "derivation"
  if (fileName.includes("建模复盘") || fileName.includes("modeling") || fileName.includes("model-review")) return "modeling"
  if (fileName.includes("中文翻译") || fileName.includes("_zh") || fileName.includes("translation") || fileName.includes("翻译")) return "translation"
  if (isMarkdown && (fileName.includes("ocr") || siblingPdfStems.map((stem) => stem.toLowerCase()).includes(fileStem))) return "ocr"
  if (isMarkdown && (
    fileName.includes("论文精读")
    || fileName.includes("精读笔记")
    || fileName.includes("reading-note")
    || (extension === ".md" && fileStem.startsWith("依赖式精读"))
    || fileStem.endsWith("_精读")
  )) return "note"
  return null
}

export function summarizeArtifactAvailability(artifacts) {
  return Object.fromEntries(Object.entries(artifacts).map(([key, items]) => [key, Array.isArray(items) && items.length > 0]))
}
