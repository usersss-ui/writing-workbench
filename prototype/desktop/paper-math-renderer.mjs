import katex from "./vendor/katex/katex.mjs"

const MATH_SELECTOR = ".math-inline, .math-display"

export function normalizePreviewTex(tex) {
  if (typeof tex !== "string") return tex
  const normalizedMathcal = tex.replace(/\\mathcal\s+Ḋ\s+([A-Za-z])\s+Ḍ/gu, "\\mathcal{$1}")
  if (!normalizedMathcal.includes("\\middle")) return normalizedMathcal
  let delimiterDepth = 0
  return normalizedMathcal.replace(/\\left\b|\\right\b|\\middle\s*\|/gu, (token) => {
    if (token.startsWith("\\left")) {
      delimiterDepth += 1
      return token
    }
    if (token.startsWith("\\right")) {
      delimiterDepth = Math.max(0, delimiterDepth - 1)
      return token
    }
    return delimiterDepth === 0 ? "\\mid" : token
  })
}

export function renderPreviewMath(root, { renderer = katex } = {}) {
  const result = { rendered: 0, failed: 0, skipped: 0 }
  if (typeof root?.querySelectorAll !== "function" || typeof renderer?.render !== "function") return result

  for (const node of root.querySelectorAll(MATH_SELECTOR)) {
    if (node.closest?.("pre, code")) {
      result.skipped += 1
      continue
    }

    const tex = node.textContent ?? ""
    const normalizedTex = normalizePreviewTex(tex)
    try {
      if (normalizedTex !== tex) node.setAttribute("data-math-source", tex)
      renderer.render(normalizedTex, node, {
        displayMode: node.classList?.contains("math-display") === true,
        throwOnError: false,
        strict: "ignore",
        trust: false,
      })
      node.setAttribute("data-math-rendered", "true")
      result.rendered += 1
    } catch {
      node.textContent = tex
      node.setAttribute("data-math-rendered", "false")
      result.failed += 1
    }
  }

  return result
}
