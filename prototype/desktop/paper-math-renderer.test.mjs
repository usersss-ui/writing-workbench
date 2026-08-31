import test from "node:test"
import assert from "node:assert/strict"
import { normalizePreviewTex, renderPreviewMath } from "./paper-math-renderer.mjs"

function mathNode({ tex, display = false, insideCode = false }) {
  const attributes = new Map()
  return {
    textContent: tex,
    classList: {
      contains(className) {
        return display ? className === "math-display" : className === "math-inline"
      },
    },
    closest(selector) {
      return insideCode && selector === "pre, code" ? {} : null
    },
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    getAttribute(name) {
      return attributes.get(name) ?? null
    },
  }
}

test("renderPreviewMath typesets safe inline and display nodes but leaves code untouched", () => {
  const inline = mathNode({ tex: String.raw`\eta_{i,t}` })
  const display = mathNode({ tex: String.raw`\sum_{t=1}^{T} f_t(x_t)`, display: true })
  const code = mathNode({ tex: String.raw`$\eta_{i,t}$`, insideCode: true })
  const calls = []
  const renderer = {
    render(tex, node, options) {
      calls.push({ tex, node, options })
    },
  }
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, ".math-inline, .math-display")
      return [inline, display, code]
    },
  }

  const result = renderPreviewMath(root, { renderer })

  assert.deepEqual(result, { rendered: 2, failed: 0, skipped: 1 })
  assert.deepEqual(calls.map(({ tex }) => tex), [String.raw`\eta_{i,t}`, String.raw`\sum_{t=1}^{T} f_t(x_t)`])
  assert.equal(calls[0].options.displayMode, false)
  assert.equal(calls[1].options.displayMode, true)
  for (const { options } of calls) {
    assert.equal(options.trust, false)
    assert.equal(options.throwOnError, false)
    assert.equal(options.strict, "ignore")
  }
  assert.equal(inline.getAttribute("data-math-rendered"), "true")
  assert.equal(display.getAttribute("data-math-rendered"), "true")
  assert.equal(code.getAttribute("data-math-rendered"), null)
})

test("renderPreviewMath keeps readable TeX when one formula cannot be rendered", () => {
  const broken = mathNode({ tex: String.raw`\broken{` })
  const result = renderPreviewMath({
    querySelectorAll() {
      return [broken]
    },
  }, {
    renderer: {
      render() {
        throw new Error("invalid formula")
      },
    },
  })

  assert.deepEqual(result, { rendered: 0, failed: 1, skipped: 0 })
  assert.equal(broken.textContent, String.raw`\broken{`)
  assert.equal(broken.getAttribute("data-math-rendered"), "false")
})

test("normalizes only orphan OCR middle bars while preserving valid paired delimiters", () => {
  const orphan = String.raw`\mathbb E[\|x\|^2 \middle | \mathcal F_t]`
  const paired = String.raw`\left[\|x\|^2 \middle| \mathcal F_t\right]`

  assert.equal(normalizePreviewTex(orphan), String.raw`\mathbb E[\|x\|^2 \mid \mathcal F_t]`)
  assert.equal(normalizePreviewTex(paired), paired)

  const node = mathNode({ tex: orphan, display: true })
  const calls = []
  renderPreviewMath({ querySelectorAll: () => [node] }, {
    renderer: { render: (tex) => calls.push(tex) },
  })
  assert.deepEqual(calls, [String.raw`\mathbb E[\|x\|^2 \mid \mathcal F_t]`])
  assert.equal(node.getAttribute("data-math-source"), orphan)
})

test("normalizes OCR dot-box placeholders used as mathcal braces", () => {
  const ocr = String.raw`\forall i \in \mathcal Ḋ V Ḍ`
  assert.equal(normalizePreviewTex(ocr), String.raw`\forall i \in \mathcal{V}`)
})
