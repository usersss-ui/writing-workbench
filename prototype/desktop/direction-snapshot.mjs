export const DIRECTION_STORAGE_KEY = "research-console.direction-snapshot.v1"

export const DIRECTION_AXIS_VALUES = Object.freeze({
  problem: Object.freeze(["分布式优化", "在线优化", "联邦学习"]),
  direction: Object.freeze(["有向网络", "无向网络"]),
  topology: Object.freeze(["时变拓扑", "静态拓扑"]),
  balance: Object.freeze(["非平衡网络", "平衡网络"]),
  coupling: Object.freeze(["耦合约束", "无耦合约束"]),
  feedback: Object.freeze(["一阶反馈", "零阶反馈"]),
  communication: Object.freeze(["低通信", "每轮通信"]),
  privacy: Object.freeze(["隐私保护", "无隐私机制"]),
  algorithm: Object.freeze(["次梯度", "梯度跟踪", "原始—对偶", "ADMM"]),
  guarantee: Object.freeze(["渐近收敛", "线性收敛", "遗憾界"]),
})

const ROOT_KEYS = Object.freeze(["version", "project_id", "saved_at", "axes"])
const AXIS_KEYS = Object.freeze(Object.keys(DIRECTION_AXIS_VALUES))

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string") return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function cloneSnapshot(snapshot) {
  return {
    version: 1,
    project_id: "P02",
    saved_at: snapshot.saved_at,
    axes: Object.fromEntries(AXIS_KEYS.map((axis) => [axis, [...snapshot.axes[axis]]])),
  }
}

export function isValidDirectionSnapshot(value) {
  if (!hasExactKeys(value, ROOT_KEYS) || value.version !== 1 || value.project_id !== "P02") return false
  if (!isCanonicalIsoDate(value.saved_at) || !hasExactKeys(value.axes, AXIS_KEYS)) return false

  let selectionCount = 0
  for (const axis of AXIS_KEYS) {
    const values = value.axes[axis]
    const allowed = DIRECTION_AXIS_VALUES[axis]
    if (!Array.isArray(values) || new Set(values).size !== values.length) return false
    if (!values.every((item) => typeof item === "string" && allowed.includes(item))) return false
    const canonical = allowed.filter((item) => values.includes(item))
    if (canonical.some((item, index) => item !== values[index])) return false
    selectionCount += values.length
  }
  return selectionCount > 0
}

export function createDirectionSnapshot(selection, { savedAt = new Date().toISOString() } = {}) {
  if (!isPlainObject(selection)) throw new TypeError("研究方向选择无效")
  const axes = Object.fromEntries(AXIS_KEYS.map((axis) => {
    const provided = selection[axis] ?? []
    if (!Array.isArray(provided)) throw new TypeError(`研究方向维度 ${axis} 无效`)
    const unique = new Set(provided)
    if (unique.size !== provided.length || [...unique].some((value) => !DIRECTION_AXIS_VALUES[axis].includes(value))) {
      throw new TypeError(`研究方向维度 ${axis} 包含无效选项`)
    }
    return [axis, DIRECTION_AXIS_VALUES[axis].filter((value) => unique.has(value))]
  }))
  const snapshot = { version: 1, project_id: "P02", saved_at: savedAt, axes }
  if (!isValidDirectionSnapshot(snapshot)) throw new TypeError("研究方向至少需要一个有效条件")
  return cloneSnapshot(snapshot)
}

export function createDirectionSnapshotStore(storage) {
  return {
    read() {
      try {
        if (!storage || typeof storage.getItem !== "function") return null
        const raw = storage.getItem(DIRECTION_STORAGE_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        return isValidDirectionSnapshot(parsed) ? cloneSnapshot(parsed) : null
      } catch {
        return null
      }
    },

    save(snapshot) {
      if (!isValidDirectionSnapshot(snapshot)) return false
      try {
        if (!storage || typeof storage.setItem !== "function") return false
        storage.setItem(DIRECTION_STORAGE_KEY, JSON.stringify(cloneSnapshot(snapshot)))
        return true
      } catch {
        return false
      }
    },
  }
}

export function createDirectionSaveController({ store, getSelection, renderSaved, notify, now = () => new Date().toISOString() } = {}) {
  if (!store || typeof store.read !== "function" || typeof store.save !== "function") {
    throw new TypeError("研究方向存储不可用")
  }
  if (typeof getSelection !== "function" || typeof renderSaved !== "function" || typeof notify !== "function" || typeof now !== "function") {
    throw new TypeError("研究方向保存接线无效")
  }

  function save() {
    const selection = getSelection()
    const count = isPlainObject(selection) ? Object.values(selection).flat().length : 0
    if (count === 0) {
      notify("请先选择研究条件")
      return false
    }
    let snapshot
    try {
      snapshot = createDirectionSnapshot(selection, { savedAt: now() })
    } catch {
      notify("当前研究条件无效，未保存课题候选")
      return false
    }
    if (!store.save(snapshot)) {
      notify("浏览器存储不可用，课题候选未保存")
      return false
    }
    renderSaved(snapshot)
    notify(`已显式保存包含 ${count} 个条件的课题候选`)
    return true
  }

  return {
    initialize() {
      const snapshot = store.read()
      renderSaved(snapshot)
      return snapshot
    },
    save,
  }
}

export function wireDirectionSaveButtons(buttons, save) {
  if (!buttons || typeof save !== "function") return 0
  let wired = 0
  for (const button of buttons) {
    if (!button || typeof button.addEventListener !== "function") continue
    button.addEventListener("click", save)
    wired += 1
  }
  return wired
}
