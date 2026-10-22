import { P02_ROLES } from "./paper-library-model.mjs"

export const P02_WORKFLOW_STORAGE_KEY = "research-console.p02-workflow.v1"
export const WORKFLOW_STAGES = Object.freeze([
  "algorithm",
  "theory_target",
  "theory_analysis",
  "simulation",
  "writing",
])

export const WORKFLOW_STAGE_LABELS = Object.freeze({
  algorithm: "算法规划",
  theory_target: "理论目标",
  theory_analysis: "理论分析",
  simulation: "仿真验证",
  writing: "写作与期刊",
})

const MECHANISMS = Object.freeze(["M01", "M02", "M03", "M04"])
const OUTCOMES = Object.freeze(["convergence", "rate", "tracking", "constraint", "communication", "regret"])
const PROBLEM_TYPES = Object.freeze(["", "offline", "online"])
const RESULT_STATUSES = Object.freeze(["not_run", "recorded_unverified", "verified"])
const PAPER_ID = /^(?:[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|LIB-[A-F0-9]{12})$/u
const ROOT_KEYS = Object.freeze(["version", "accepted_stages", "paper_roles", ...WORKFLOW_STAGES])
const REQUIRED_ROLE_BY_STAGE = Object.freeze({
  algorithm: "algorithm_mechanism",
  theory_target: "theory_evidence",
  simulation: "simulation_baseline",
  writing: "related_work",
})
const ROLE_STAGE_INDEX = Object.freeze({
  algorithm_mechanism: 0,
  theory_evidence: 1,
  simulation_baseline: 3,
  related_work: 4,
})
const STAGE_KEYS = Object.freeze({
  algorithm: Object.freeze(["problem_type", "research_objective", "mechanisms", "update_plan", "contribution_boundary"]),
  theory_target: Object.freeze(["outcomes", "theorem_target"]),
  theory_analysis: Object.freeze(["assumptions", "lemma_chain", "proof_gaps"]),
  simulation: Object.freeze(["metrics", "baselines", "communication_budget", "result_status", "result_summary"]),
  writing: Object.freeze(["target_venue", "venue_references", "problem_algorithm", "theory_section", "experiment_section"]),
})
const MAX_TEXT_LENGTH = 12_000
const UNSAFE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

function emptyStage(stage) {
  if (stage === "algorithm") return { problem_type: "", research_objective: "", mechanisms: [], update_plan: "", contribution_boundary: "" }
  if (stage === "theory_target") return { outcomes: [], theorem_target: "" }
  if (stage === "theory_analysis") return { assumptions: "", lemma_chain: "", proof_gaps: "" }
  if (stage === "simulation") return { metrics: "", baselines: "", communication_budget: "", result_status: "not_run", result_summary: "" }
  return { target_venue: "", venue_references: "", problem_algorithm: "", theory_section: "", experiment_section: "" }
}

export function createEmptyP02WorkflowState() {
  return {
    version: 1,
    accepted_stages: [],
    paper_roles: Object.fromEntries(P02_ROLES.map((role) => [role, []])),
    ...Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, emptyStage(stage)])),
  }
}

function cloneStage(stage, value) {
  const cloned = { ...value }
  if (stage === "algorithm") cloned.mechanisms = [...value.mechanisms]
  if (stage === "theory_target") cloned.outcomes = [...value.outcomes]
  return cloned
}

function cloneState(state) {
  return {
    version: 1,
    accepted_stages: [...state.accepted_stages],
    paper_roles: Object.fromEntries(P02_ROLES.map((role) => [role, [...state.paper_roles[role]]])),
    ...Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, cloneStage(stage, state[stage])])),
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function hasExactDataKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false
  try {
    const keys = Reflect.ownKeys(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (keys.some((key) => typeof key !== "string")) return false
    if (keys.length !== expectedKeys.length) return false
    if (!expectedKeys.every((key) => keys.includes(key))) return false
    return keys.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key])
  } catch {
    return false
  }
}

function isSafeText(value) {
  return typeof value === "string"
    && value.length <= MAX_TEXT_LENGTH
    && !UNSAFE_CONTROL.test(value)
}

function isCanonicalChoiceArray(value, allowed) {
  if (!Array.isArray(value) || value.length > allowed.length) return false
  let lastIndex = -1
  for (const item of value) {
    const index = allowed.indexOf(item)
    if (index < 0 || index <= lastIndex) return false
    lastIndex = index
  }
  return true
}

function stageIsValid(stage, value) {
  if (!hasExactDataKeys(value, STAGE_KEYS[stage])) return false
  if (stage === "algorithm") {
    return PROBLEM_TYPES.includes(value.problem_type)
      && isSafeText(value.research_objective)
      && isCanonicalChoiceArray(value.mechanisms, MECHANISMS)
      && isSafeText(value.update_plan)
      && isSafeText(value.contribution_boundary)
  }
  if (stage === "theory_target") {
    return isCanonicalChoiceArray(value.outcomes, OUTCOMES) && isSafeText(value.theorem_target)
  }
  if (stage === "theory_analysis") {
    return STAGE_KEYS[stage].every((key) => isSafeText(value[key]))
  }
  if (stage === "simulation") {
    return isSafeText(value.metrics)
      && isSafeText(value.baselines)
      && isSafeText(value.communication_budget)
      && RESULT_STATUSES.includes(value.result_status)
      && isSafeText(value.result_summary)
  }
  return STAGE_KEYS[stage].every((key) => isSafeText(value[key]))
}

function missingStageFields(state, stage) {
  const value = state[stage]
  if (stage === "algorithm") {
    return [
      !value.problem_type && "problem_type",
      !value.research_objective && "research_objective",
      value.mechanisms.length === 0 && "mechanisms",
      !value.update_plan && "update_plan",
      !value.contribution_boundary && "contribution_boundary",
    ].filter(Boolean)
  }
  if (stage === "theory_target") {
    return [value.outcomes.length === 0 && "outcomes", !value.theorem_target && "theorem_target"].filter(Boolean)
  }
  return STAGE_KEYS[stage]
    .filter((key) => key !== "result_status")
    .filter((key) => !value[key])
}

function stageCanBeAccepted(state, stage) {
  const missing = missingStageFields(state, stage)
  if (missing.length > 0) return { reason: "content_incomplete", missing }
  const requiredRole = REQUIRED_ROLE_BY_STAGE[stage]
  if (requiredRole && state.paper_roles[requiredRole].length === 0) {
    return { reason: "source_required", missing: [], missingRoles: [requiredRole] }
  }
  if (stage === "theory_target" && state.algorithm.problem_type !== "online" && state.theory_target.outcomes.includes("regret")) {
    return { reason: "regret_requires_online", missing: [] }
  }
  return { reason: null, missing: [], missingRoles: [] }
}

function isStablePaperId(value) {
  return typeof value === "string" && PAPER_ID.test(value)
}

function paperRolesAreValid(value) {
  if (!hasExactDataKeys(value, P02_ROLES)) return false
  for (const role of P02_ROLES) {
    const ids = value[role]
    if (!Array.isArray(ids) || ids.some((id) => !isStablePaperId(id))) return false
    if (new Set(ids).size !== ids.length) return false
  }
  return true
}

export function isValidP02WorkflowState(value) {
  if (!hasExactDataKeys(value, ROOT_KEYS) || value.version !== 1) return false
  if (!Array.isArray(value.accepted_stages) || value.accepted_stages.length > WORKFLOW_STAGES.length) return false
  if (!value.accepted_stages.every((stage, index) => stage === WORKFLOW_STAGES[index])) return false
  if (!paperRolesAreValid(value.paper_roles)) return false
  if (!WORKFLOW_STAGES.every((stage) => stageIsValid(stage, value[stage]))) return false
  for (const stage of value.accepted_stages) {
    if (stageCanBeAccepted(value, stage).reason !== null) return false
  }
  return true
}

function stageHasUserContent(stage, value) {
  const empty = emptyStage(stage)
  return STAGE_KEYS[stage].some((key) => {
    if (Array.isArray(value[key])) return value[key].length > 0
    if (key === "result_status") return false
    return value[key] !== empty[key]
  })
}

export function getWorkflowStageStatus(state, stage) {
  if (!isValidP02WorkflowState(state) || !WORKFLOW_STAGES.includes(stage)) throw new TypeError("P02 闭环状态无效")
  const index = WORKFLOW_STAGES.indexOf(stage)
  if (index < state.accepted_stages.length) return "accepted"
  if (index === state.accepted_stages.length) return "draft"
  return stageHasUserContent(stage, state[stage]) ? "needs_review" : "locked"
}

function normalizeText(value) {
  if (typeof value !== "string") throw new TypeError("文本字段无效")
  const normalized = value.normalize("NFKC").trim()
  if (!isSafeText(normalized)) throw new TypeError("文本字段无效")
  return normalized
}

function normalizeChoiceArray(value, allowed) {
  if (!Array.isArray(value)) throw new TypeError("多选字段无效")
  const selected = new Set(value)
  if (selected.size !== value.length || [...selected].some((item) => !allowed.includes(item))) throw new TypeError("多选字段无效")
  return allowed.filter((item) => selected.has(item))
}

function normalizePaperRoles(value) {
  if (!hasExactDataKeys(value, P02_ROLES)) throw new TypeError("论文用途输入无效")
  const normalized = {}
  for (const role of P02_ROLES) {
    if (!Array.isArray(value[role])) throw new TypeError("论文用途输入无效")
    const ids = []
    const seen = new Set()
    for (const paperId of value[role]) {
      if (!isStablePaperId(paperId)) throw new TypeError("论文 ID 格式无效")
      if (seen.has(paperId)) throw new TypeError("论文 ID 重复")
      seen.add(paperId)
      ids.push(paperId)
    }
    normalized[role] = ids
  }
  return normalized
}

function normalizeStagePatch(stage, patch) {
  if (!isPlainObject(patch)) throw new TypeError("阶段草稿无效")
  const keys = Reflect.ownKeys(patch)
  if (keys.some((key) => typeof key !== "string" || !STAGE_KEYS[stage].includes(key))) throw new TypeError("阶段草稿无效")
  const normalized = {}
  for (const key of keys) {
    if (key === "mechanisms") normalized[key] = normalizeChoiceArray(patch[key], MECHANISMS)
    else if (key === "outcomes") normalized[key] = normalizeChoiceArray(patch[key], OUTCOMES)
    else if (key === "problem_type") {
      if (!PROBLEM_TYPES.includes(patch[key])) throw new TypeError("问题类型无效")
      normalized[key] = patch[key]
    } else if (key === "result_status") {
      if (!RESULT_STATUSES.includes(patch[key])) throw new TypeError("实验状态无效")
      normalized[key] = patch[key]
    } else normalized[key] = normalizeText(patch[key])
  }
  return normalized
}

function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function inspectStoredState(storage) {
  if (!storage || typeof storage.getItem !== "function") return { status: "unavailable", state: createEmptyP02WorkflowState(), raw: null }
  let raw
  try {
    raw = storage.getItem(P02_WORKFLOW_STORAGE_KEY)
  } catch {
    return { status: "unavailable", state: createEmptyP02WorkflowState(), raw: null }
  }
  if (raw === null) return { status: "missing", state: createEmptyP02WorkflowState(), raw: null }
  try {
    const parsed = JSON.parse(raw)
    return isValidP02WorkflowState(parsed)
      ? { status: "valid", state: cloneState(parsed), raw }
      : { status: "invalid", state: createEmptyP02WorkflowState(), raw }
  } catch {
    return { status: "invalid", state: createEmptyP02WorkflowState(), raw }
  }
}

function writeAndVerify(storage, state) {
  if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") return false
  const raw = JSON.stringify(state)
  try {
    storage.setItem(P02_WORKFLOW_STORAGE_KEY, raw)
    return storage.getItem(P02_WORKFLOW_STORAGE_KEY) === raw
  } catch {
    return false
  }
}

export function createP02WorkflowStore(storage) {
  const initial = inspectStoredState(storage)
  let state = initial.state
  let availabilityStatus = initial.status
  let committedRaw = initial.raw
  let committedKnown = initial.status !== "unavailable"

  function invalidStateResult(outcome = {}) {
    return {
      ...outcome,
      changed: false,
      persisted: false,
      reason: "invalid_state",
      state: cloneState(state),
    }
  }

  function persist(next, outcome) {
    if (!isValidP02WorkflowState(next)) throw new TypeError("P02 闭环状态无效")
    if (!writeAndVerify(storage, next)) {
      return { ...outcome, changed: false, persisted: false, reason: "persistence_failed", state: cloneState(state) }
    }
    state = cloneState(next)
    availabilityStatus = "valid"
    committedRaw = JSON.stringify(next)
    committedKnown = true
    return { ...outcome, changed: true, persisted: true, reason: null, state: cloneState(state) }
  }

  return {
    read() {
      return cloneState(state)
    },

    readValidatedState() {
      if (availabilityStatus === "invalid") return { status: "invalid", state: cloneState(state) }
      const inspected = inspectStoredState(storage)
      if (inspected.status === "valid" || inspected.status === "missing") {
        state = inspected.state
        availabilityStatus = inspected.status
        committedRaw = inspected.raw
        committedKnown = true
        return { status: inspected.status, state: cloneState(state) }
      }
      if (inspected.status === "invalid") {
        availabilityStatus = "invalid"
        committedRaw = inspected.raw
        committedKnown = true
        return { status: "invalid", state: cloneState(state) }
      }
      availabilityStatus = "unavailable"
      committedKnown = false
      return { status: "unavailable", state: cloneState(state) }
    },

    updateStage(stage, patch) {
      if (!WORKFLOW_STAGES.includes(stage)) throw new TypeError("未知的 P02 阶段")
      if (availabilityStatus === "invalid") return invalidStateResult({ invalidatedStages: [] })
      const stageIndex = WORKFLOW_STAGES.indexOf(stage)
      if (stageIndex > state.accepted_stages.length) {
        return { changed: false, persisted: true, reason: "stage_locked", invalidatedStages: [], state: cloneState(state) }
      }
      const normalized = normalizeStagePatch(stage, patch)
      const next = cloneState(state)
      next[stage] = { ...next[stage], ...normalized }
      if (statesEqual(next[stage], state[stage])) {
        return { changed: false, persisted: true, reason: "no_change", invalidatedStages: [], state: cloneState(state) }
      }
      const invalidatedStages = state.accepted_stages.filter((candidate) => WORKFLOW_STAGES.indexOf(candidate) > stageIndex)
      if (stageIndex < state.accepted_stages.length) next.accepted_stages = state.accepted_stages.slice(0, stageIndex)
      return persist(next, { invalidatedStages })
    },

    acceptStage(stage) {
      if (!WORKFLOW_STAGES.includes(stage)) throw new TypeError("未知的 P02 阶段")
      if (availabilityStatus === "invalid") {
        return invalidStateResult({ accepted: false, missing: [], missingRoles: [] })
      }
      const stageIndex = WORKFLOW_STAGES.indexOf(stage)
      if (stageIndex < state.accepted_stages.length) {
        return { accepted: false, changed: false, persisted: true, reason: "already_accepted", missing: [], state: cloneState(state) }
      }
      if (stageIndex > state.accepted_stages.length) {
        return { accepted: false, changed: false, persisted: true, reason: "prerequisite_not_accepted", missing: [], state: cloneState(state) }
      }
      const readiness = stageCanBeAccepted(state, stage)
      if (readiness.reason) {
        return { accepted: false, changed: false, persisted: true, ...readiness, state: cloneState(state) }
      }
      const next = cloneState(state)
      next.accepted_stages.push(stage)
      const result = persist(next, { accepted: true, missing: [] })
      return result.persisted ? result : { ...result, accepted: false }
    },

    syncPaperRoles(paperRoles) {
      if (availabilityStatus === "invalid") return invalidStateResult({ invalidatedStages: [] })
      const normalized = normalizePaperRoles(paperRoles)
      const changedRoles = P02_ROLES.filter((role) => !statesEqual(normalized[role], state.paper_roles[role]))
      if (changedRoles.length === 0) {
        return { changed: false, persisted: true, reason: "no_change", invalidatedStages: [], state: cloneState(state) }
      }
      const next = cloneState(state)
      next.paper_roles = normalized
      const earliestStageIndex = Math.min(...changedRoles.map((role) => ROLE_STAGE_INDEX[role]))
      const invalidatedStages = state.accepted_stages.filter((stage) => WORKFLOW_STAGES.indexOf(stage) >= earliestStageIndex)
      if (earliestStageIndex < state.accepted_stages.length) {
        next.accepted_stages = state.accepted_stages.slice(0, earliestStageIndex)
      }
      return persist(next, { invalidatedStages })
    },

    replaceValidated(nextState, options = {}) {
      if (!isValidP02WorkflowState(nextState)) throw new TypeError("P02 闭环状态无效")
      if (!isPlainObject(options) || Reflect.ownKeys(options).some((key) => key !== "expectedCurrent")) {
        throw new TypeError("原子替换选项无效")
      }
      if (Object.hasOwn(options, "expectedCurrent") && !isValidP02WorkflowState(options.expectedCurrent)) {
        throw new TypeError("预期闭环状态无效")
      }

      const current = inspectStoredState(storage)
      const failed = (reason, extra = {}) => ({
        replaced: false,
        changed: false,
        persisted: false,
        reason,
        rolledBack: false,
        state: cloneState(state),
        ...extra,
      })
      if (current.status === "invalid") return failed("invalid_current")
      if (current.status === "unavailable" || !committedKnown) return failed("current_unavailable")
      if (current.raw !== committedRaw) return failed("stale_current")
      if (Object.hasOwn(options, "expectedCurrent") && !statesEqual(current.state, options.expectedCurrent)) {
        return failed("stale_current")
      }

      const next = cloneState(nextState)
      const nextRaw = JSON.stringify(next)
      if (current.raw === nextRaw) {
        state = next
        availabilityStatus = "valid"
        return { replaced: true, changed: false, persisted: true, reason: null, rolledBack: false, state: cloneState(state) }
      }

      let writeVerified = false
      try {
        if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") {
          return failed("current_unavailable")
        }
        storage.setItem(P02_WORKFLOW_STORAGE_KEY, nextRaw)
        writeVerified = storage.getItem(P02_WORKFLOW_STORAGE_KEY) === nextRaw
      } catch {
        writeVerified = false
      }
      if (!writeVerified) {
        let rolledBack = false
        try {
          if (current.raw === null) {
            if (typeof storage.removeItem !== "function") throw new Error("remove unavailable")
            storage.removeItem(P02_WORKFLOW_STORAGE_KEY)
          } else storage.setItem(P02_WORKFLOW_STORAGE_KEY, current.raw)
          rolledBack = storage.getItem(P02_WORKFLOW_STORAGE_KEY) === current.raw
        } catch {
          rolledBack = false
        }
        return failed(rolledBack ? "write_verification_failed" : "rollback_failed", { rolledBack })
      }

      state = next
      availabilityStatus = "valid"
      committedRaw = nextRaw
      committedKnown = true
      return { replaced: true, changed: true, persisted: true, reason: null, rolledBack: false, state: cloneState(state) }
    },

    clear() {
      const next = createEmptyP02WorkflowState()
      try {
        if (!storage || typeof storage.removeItem !== "function") throw new Error("unavailable")
        storage.removeItem(P02_WORKFLOW_STORAGE_KEY)
        if (typeof storage.getItem !== "function" || storage.getItem(P02_WORKFLOW_STORAGE_KEY) !== null) throw new Error("not removed")
        state = next
        availabilityStatus = "missing"
        committedRaw = null
        committedKnown = true
        return { cleared: true, persisted: true, state: cloneState(state) }
      } catch {
        return { cleared: false, persisted: false, reason: "persistence_failed", state: cloneState(state) }
      }
    },
  }
}

const MECHANISM_LABELS = Object.freeze({
  M01: "非平衡网络校正",
  M02: "梯度或状态跟踪",
  M03: "低通信触发",
  M04: "耦合约束协调",
})
const OUTCOME_LABELS = Object.freeze({
  convergence: "收敛性",
  rate: "收敛率",
  tracking: "共识/跟踪误差",
  constraint: "约束违背",
  communication: "通信复杂度",
  regret: "遗憾界",
})

export function buildWritingMaterials(state) {
  if (!isValidP02WorkflowState(state)) throw new TypeError("P02 闭环状态无效")
  const algorithmStatus = getWorkflowStageStatus(state, "algorithm")
  const theoryTargetStatus = getWorkflowStageStatus(state, "theory_target")
  const theoryAnalysisStatus = getWorkflowStageStatus(state, "theory_analysis")
  const simulationStatus = getWorkflowStageStatus(state, "simulation")
  const mechanismText = state.algorithm.mechanisms.map((id) => `${id} ${MECHANISM_LABELS[id]}`).join("、") || "尚未选择机制"
  const staleTheory = theoryTargetStatus === "needs_review" || theoryAnalysisStatus === "needs_review"
  const staleSimulation = simulationStatus === "needs_review"

  const algorithmBody = [
    `拟研究：${state.algorithm.research_objective || "研究目标尚待填写"}。`,
    `问题类型：${state.algorithm.problem_type === "online" ? "在线优化" : state.algorithm.problem_type === "offline" ? "离线优化" : "尚未确定"}。`,
    `机制组合：${mechanismText}。`,
    state.algorithm.update_plan ? `更新草案：${state.algorithm.update_plan}` : "更新草案尚待填写。",
    state.algorithm.contribution_boundary ? `待核验差异：${state.algorithm.contribution_boundary}` : "差异边界尚待填写。",
  ].join("\n")

  const theoryBody = [
    staleTheory ? "上游方案已经修改，以下理论材料必须重新核验。" : "以下内容是证明目标与结构，不代表定理已经成立。",
    `理论目标：${state.theory_target.outcomes.map((outcome) => OUTCOME_LABELS[outcome]).join("、") || "尚未选择"}。`,
    state.theory_target.theorem_target ? `希望证明：${state.theory_target.theorem_target}` : "主定理目标尚待填写。",
    state.theory_analysis.assumptions ? `候选条件：${state.theory_analysis.assumptions}` : "候选条件尚待整理。",
    state.theory_analysis.lemma_chain ? `证明链：${state.theory_analysis.lemma_chain}` : "证明链尚待整理。",
    state.theory_analysis.proof_gaps ? `当前缺口：${state.theory_analysis.proof_gaps}` : "证明缺口尚待记录。",
    "尚未形成已经成立的理论结论。",
  ].join("\n")

  let simulationReadiness = "planning_only"
  if (!staleSimulation && simulationStatus === "accepted" && state.simulation.result_status === "verified") simulationReadiness = "verified"
  else if (state.simulation.result_status === "recorded_unverified" || staleSimulation) simulationReadiness = "pending_verification"
  const simulationBody = [
    staleSimulation ? "上游方案已经修改，以下仿真材料必须重新核验。" : "以下记录严格区分实验设计、结果记录与一致性核验。",
    state.simulation.metrics ? `指标：${state.simulation.metrics}` : "指标尚待填写。",
    state.simulation.baselines ? `基线：${state.simulation.baselines}` : "基线尚待填写。",
    state.simulation.communication_budget ? `统一预算：${state.simulation.communication_budget}` : "统一预算尚待填写。",
    state.simulation.result_status === "not_run"
      ? `当前尚未运行；下一步：${state.simulation.result_summary || "待记录最小实验。"}`
      : state.simulation.result_status === "recorded_unverified"
        ? `已有结果但尚未核验：${state.simulation.result_summary || "待补结果摘要。"}`
        : `用户标记结果与实现已经核验：${state.simulation.result_summary || "待补结果摘要。"}`,
  ].join("\n")

  const venueBody = [
    state.writing.target_venue
      ? `候选投稿期刊：${state.writing.target_venue}。`
      : "候选投稿期刊尚待填写。",
    state.writing.venue_references
      ? `同刊或相近论文：${state.writing.venue_references}。`
      : "同刊或相近高质量论文尚待选择。",
    "这些材料只学习结构与表达；期刊格式仍待核验（需回到最新官方要求），不直接拼接文字。",
  ].join("\n")

  return {
    algorithm: { readiness: algorithmStatus === "accepted" ? "planning_only" : "draft", body: algorithmBody },
    theory: { readiness: "pending_verification", body: theoryBody },
    simulation: { readiness: simulationReadiness, body: simulationBody },
    venue: { readiness: "pending_verification", body: venueBody },
  }
}

export function summarizeP02Shelf(workspaceState) {
  const result = Object.fromEntries(P02_ROLES.map((role) => [role, []]))
  const shelf = isPlainObject(workspaceState?.shelf) ? workspaceState.shelf : {}
  for (const [paperId, roles] of Object.entries(shelf)) {
    if (!isStablePaperId(paperId) || !Array.isArray(roles)) continue
    for (const role of P02_ROLES) {
      if (roles.includes(role)) result[role].push(paperId)
    }
  }
  return result
}
