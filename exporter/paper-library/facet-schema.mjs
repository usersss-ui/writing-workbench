const groups = [
  ["research", "research.domain", "研究领域", ["分布式优化", "分布式学习", "联邦学习"]],
  ["research", "research.mode", "任务范式", ["静态优化", "在线优化", "随机优化", "鲁棒优化"]],
  ["more", "objective", "目标函数", ["凸", "强凸", "非凸", "光滑", "非光滑", "随机目标"]],
  ["constraints", "constraints.scope", "作用范围", ["无显式约束", "本地约束", "耦合约束", "决策耦合约束"]],
  ["constraints", "constraints.form", "数学形式", ["集合约束", "等式约束", "不等式约束", "不确定约束"]],
  ["constraints", "constraints.consistency", "节点关系", ["本地一致约束", "本地非一致约束"]],
  ["oracle", "oracle.information", "信息来源", ["精确梯度", "次梯度", "随机梯度", "函数值反馈"]],
  ["oracle", "oracle.estimation", "估计与跟踪", ["梯度跟踪", "单点估计", "双点估计", "残差反馈", "次梯度重缩放"]],
  ["methods", "methods.framework", "主框架", ["次梯度法", "对偶平均", "镜像下降", "对偶分解", "ADMM", "原始—对偶", "增广拉格朗日", "算子分裂", "原始松弛"]],
  ["methods", "methods.coordination", "协调机制", ["普通共识", "Push-Sum", "Perron 修正", "动态跟踪", "有限时间共识"]],
  ["methods", "methods.operator", "更新算子", ["投影", "近端", "预测—校正", "Nesterov 加速"]],
  ["more", "network.direction", "网络方向", ["有向", "无向", "中心化服务器"]],
  ["more", "network.time", "网络时变性", ["固定", "时变"]],
  ["more", "network.balance", "网络平衡性", ["平衡", "不平衡"]],
  ["more", "network.mixing", "混合矩阵", ["行随机", "列随机", "双随机"]],
  ["more", "privacy_robustness", "隐私与鲁棒", ["差分隐私", "Laplace 机制", "Gaussian 机制", "安全多方计算", "结构化扰动", "拜占庭鲁棒", "不确定性鲁棒"]],
  ["more", "results", "理论结果", ["渐近收敛", "精确收敛", "线性收敛", "次线性收敛", "静态遗憾", "动态遗憾", "约束违反界", "隐私保证", "鲁棒保证", "通信复杂度"]],
  ["more", "applications", "应用领域", ["车联网", "无线物联网", "临床机器学习", "工业信息物理系统"]],
]

export const FACET_GROUPS = Object.freeze(groups.map(([panel, path, label, values]) =>
  Object.freeze({ panel, path, label, values: Object.freeze([...values]) })))

export const FACET_PATHS = Object.freeze(FACET_GROUPS.map(({ path }) => path))

export const FACET_STATE_VALUES = Object.freeze([
  "unrecorded",
  "not_applicable",
  "pending_verification",
])
const facetStateValueSet = new Set(FACET_STATE_VALUES)

const rootKeys = Object.freeze(["research", "objective", "constraints", "oracle", "methods", "network", "privacy_robustness", "results", "applications"])
const leafPaths = new Map(FACET_GROUPS.map(({ path, values }) => [path, new Set(values)]))

export function isOrdinaryJsonObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
  })
}

export function hasExactJsonObjectKeys(value, expectedKeys) {
  if (!isOrdinaryJsonObject(value)) return false
  const actual = Reflect.ownKeys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function getAtPath(object, path) {
  return path.split(".").reduce((value, key) => value[key], object)
}

function setAtPath(object, path, value) {
  const keys = path.split(".")
  const leaf = keys.pop()
  const parent = keys.reduce((current, key) => {
    current[key] ??= {}
    return current[key]
  }, object)
  parent[leaf] = value
}

export function validateFacetStates(facets, facetStates) {
  validatePaperFacets(facets)
  if (!isOrdinaryJsonObject(facetStates)) throw new TypeError("facet_states 必须是对象")
  for (const path of Reflect.ownKeys(facetStates)) {
    if (typeof path !== "string" || !FACET_PATHS.includes(path)) {
      throw new TypeError("facet_states 路径无效")
    }
    if (!facetStateValueSet.has(facetStates[path])) {
      throw new TypeError("facet_states 状态无效")
    }
    if (getAtPath(facets, path).length > 0) {
      throw new TypeError("facet_states 不能覆盖已有分面值")
    }
  }
  return facetStates
}

export function createEmptyFacets() {
  const facets = {}
  for (const path of FACET_PATHS) setAtPath(facets, path, [])
  return facets
}

export function validatePaperFacets(facets) {
  if (!isRecord(facets)) throw new TypeError("分面对象必须是对象")
  if (Reflect.ownKeys(facets).some((key) => typeof key !== "string" || !rootKeys.includes(key))) {
    throw new TypeError("未知分面字段")
  }
  for (const key of rootKeys) {
    if (!Object.hasOwn(facets, key)) throw new TypeError("分面字段缺失")
  }
  for (const group of FACET_GROUPS) {
    const parentPath = group.path.includes(".") ? group.path.split(".")[0] : null
    const parent = parentPath ? facets[parentPath] : facets
    if (parentPath && !isRecord(parent)) throw new TypeError("分面嵌套字段必须是对象")
    if (parentPath && Reflect.ownKeys(parent).some((key) => typeof key !== "string" || !FACET_PATHS.some((path) => path === `${parentPath}.${key}`))) {
      throw new TypeError("未知分面字段")
    }
    const leaf = parentPath ? group.path.slice(parentPath.length + 1) : group.path
    if (!Object.hasOwn(parent, leaf)) throw new TypeError("分面字段缺失")
    const values = getAtPath(facets, group.path)
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
      throw new TypeError("分面字段必须是字符串数组")
    }
    if (new Set(values).size !== values.length) throw new TypeError("分面数组不能重复")
    for (const value of values) {
      if (value.trim() !== value) throw new TypeError("分面值不能包含首尾空白")
      if (!leafPaths.get(group.path).has(value)) throw new TypeError("分面值不在受控词表")
    }
  }
  return facets
}

export function serializeFacetSchema() {
  return {
    version: 2,
    groups: FACET_GROUPS.map(({ panel, path, label, values }) => ({ panel, path, label, values: [...values] })),
  }
}

export function flattenFacetValues(facets) {
  const values = []
  const seen = new Set()
  for (const path of FACET_PATHS) {
    for (const value of getAtPath(facets, path)) {
      if (!seen.has(value)) {
        seen.add(value)
        values.push(value)
      }
    }
  }
  return values
}
