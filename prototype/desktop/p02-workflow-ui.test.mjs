import assert from "node:assert/strict"
import test from "node:test"

import { createEmptyP02WorkflowState } from "./p02-workflow.mjs"

const ui = await import("./p02-workflow-ui.mjs")

test("整理研究材料只补空白章节，不覆盖已经写好的正文", () => {
  const state = createEmptyP02WorkflowState()
  state.writing.problem_algorithm = "我的方法正文\n\n$$x_k$$"
  state.writing.theory_section = "保留我的证明。"
  const patch = ui.buildMissingWritingPatch(state)
  assert.deepEqual(Object.keys(patch), ["experiment_section"])
  assert.match(patch.experiment_section, /尚未运行|未运行/u)
  assert.equal(state.writing.problem_algorithm, "我的方法正文\n\n$$x_k$$")
  state.writing.experiment_section = "已写实验计划"
  assert.deepEqual(ui.buildMissingWritingPatch(state), {})
})

test("闭环视图把首个未确认阶段标成当前项并区分锁定阶段", () => {
  assert.equal(typeof ui.buildWorkflowView, "function")
  const view = ui.buildWorkflowView(createEmptyP02WorkflowState())

  assert.equal(view.currentStage, "algorithm")
  assert.equal(view.complete, false)
  assert.equal(view.summary, "当前：算法规划")
  assert.equal(view.stages.algorithm.status, "draft")
  assert.equal(view.stages.algorithm.disabled, false)
  assert.equal(view.stages.theory_target.status, "locked")
  assert.equal(view.stages.theory_target.disabled, true)
})

test("闭环视图在五阶段确认后只声称首轮材料闭环而非论文完成", () => {
  const state = createEmptyP02WorkflowState()
  state.paper_roles = {
    algorithm_mechanism: ["Xi18-ADDOPT"],
    theory_evidence: ["Nedic17-DIGing"],
    simulation_baseline: ["Falsone17-DD"],
    related_work: ["Liu24-LCT"],
  }
  state.accepted_stages = ["algorithm", "theory_target", "theory_analysis", "simulation", "writing"]
  state.algorithm = {
    problem_type: "offline", research_objective: "目标", mechanisms: ["M01"], update_plan: "更新", contribution_boundary: "差异",
  }
  state.theory_target = { outcomes: ["convergence"], theorem_target: "希望证明收敛" }
  state.theory_analysis = { assumptions: "假设", lemma_chain: "证明链", proof_gaps: "仍有缺口" }
  state.simulation = { metrics: "指标", baselines: "基线", communication_budget: "预算", result_status: "not_run", result_summary: "待运行" }
  state.writing = { target_venue: "候选期刊", venue_references: "同刊论文", problem_algorithm: "算法材料", theory_section: "理论材料", experiment_section: "实验材料" }

  const view = ui.buildWorkflowView(state)
  assert.equal(view.currentStage, null)
  assert.equal(view.complete, true)
  assert.equal(view.summary, "首轮材料闭环已建立")
  assert.doesNotMatch(view.summary, /论文完成|理论完成|仿真通过/u)
})

test("表单读取器只生成对应阶段的白名单字段和规范多选顺序", () => {
  assert.equal(typeof ui.readStagePatch, "function")
  const formData = new FormData()
  formData.set("problem_type", "offline")
  formData.set("research_objective", "研究目标")
  formData.append("mechanisms", "M04")
  formData.append("mechanisms", "M01")
  formData.set("update_plan", "更新顺序")
  formData.set("contribution_boundary", "待核验差异")
  formData.set("ignored", "不能进入状态")

  assert.deepEqual(ui.readStagePatch("algorithm", formData), {
    problem_type: "offline",
    research_objective: "研究目标",
    mechanisms: ["M01", "M04"],
    update_plan: "更新顺序",
    contribution_boundary: "待核验差异",
  })
})

test("论文用途架不可读时不会伪装成零篇", () => {
  assert.equal(typeof ui.buildShelfView, "function")
  const invalid = ui.buildShelfView({ status: "invalid", state: { shelf: {} } })
  assert.equal(invalid.algorithm_mechanism.countText, "状态不可读")
  assert.equal(invalid.algorithm_mechanism.paperText, "请回论文库检查本地状态")

  const missing = ui.buildShelfView({ status: "missing", state: { shelf: {} } })
  assert.equal(missing.algorithm_mechanism.countText, "0 篇")
  assert.equal(missing.algorithm_mechanism.paperText, "从论文库加入")
})

test("论文库用途状态同步进闭环且不可读状态不会抹掉已有用途", () => {
  assert.equal(typeof ui.syncWorkflowShelf, "function")
  const calls = []
  const workflowStore = {
    syncPaperRoles(roles) {
      calls.push(roles)
      return { persisted: true, reason: null, invalidatedStages: [], state: createEmptyP02WorkflowState() }
    },
  }
  const validState = {
    shelf: {
      "Xi18-ADDOPT": ["algorithm_mechanism", "related_work"],
      "Nedic17-DIGing": ["theory_evidence"],
      "Falsone17-DD": ["simulation_baseline"],
    },
  }

  const valid = ui.syncWorkflowShelf(workflowStore, { status: "valid", state: validState })
  assert.equal(valid.synced, true)
  assert.deepEqual(calls[0], {
    algorithm_mechanism: ["Xi18-ADDOPT"],
    theory_evidence: ["Nedic17-DIGing"],
    simulation_baseline: ["Falsone17-DD"],
    related_work: ["Xi18-ADDOPT"],
  })
  assert.equal(ui.syncWorkflowShelf(workflowStore, { status: "invalid", state: { shelf: {} } }).synced, false)
  assert.equal(ui.syncWorkflowShelf(workflowStore, { status: "unavailable", state: { shelf: {} } }).synced, false)
  assert.equal(calls.length, 1)
})

test("即时输入保存器持久化最后一段文字并可由新实例读取", async () => {
  assert.equal(typeof ui.persistStageFormInput, "function")
  const storageMap = new Map()
  const storage = {
    getItem(key) { return storageMap.has(key) ? storageMap.get(key) : null },
    setItem(key, value) { storageMap.set(key, String(value)) },
    removeItem(key) { storageMap.delete(key) },
  }
  const { createP02WorkflowStore } = await import("./p02-workflow.mjs")
  const store = createP02WorkflowStore(storage)
  const data = new FormData()
  data.set("problem_type", "offline")
  data.set("research_objective", "最后输入的一段")
  data.append("mechanisms", "M01")
  data.set("update_plan", "即时保存")
  data.set("contribution_boundary", "仍待核验")

  const result = ui.persistStageFormInput(store, "algorithm", data)
  assert.equal(result.persisted, true)
  assert.equal(createP02WorkflowStore(storage).read().algorithm.research_objective, "最后输入的一段")
})

test("无效闭环状态显示阻断信息与显式重置操作", () => {
  assert.equal(typeof ui.buildWorkflowAvailabilityView, "function")
  assert.deepEqual(ui.buildWorkflowAvailabilityView({ status: "invalid" }), {
    blocked: true,
    message: "检测到无法安全读取的旧闭环状态。为避免覆盖原记录，当前编辑已锁定；请显式重置后重新开始。",
    showReset: true,
  })
  assert.deepEqual(ui.buildWorkflowAvailabilityView({ status: "missing" }), {
    blocked: false,
    message: "",
    showReset: false,
  })
})

test("右侧三项行动随当前阶段变化且闭环后仍保持保守表述", () => {
  assert.equal(typeof ui.buildNextActions, "function")
  const empty = createEmptyP02WorkflowState()
  const algorithmActions = ui.buildNextActions(ui.buildWorkflowView(empty))
  assert.equal(algorithmActions.length, 3)
  assert.match(algorithmActions.join(" "), /算法机制来源/u)

  empty.paper_roles = {
    algorithm_mechanism: ["Xi18-ADDOPT"],
    theory_evidence: ["Nedic17-DIGing"],
    simulation_baseline: ["Falsone17-DD"],
    related_work: ["Liu24-LCT"],
  }
  empty.algorithm = {
    problem_type: "offline", research_objective: "目标", mechanisms: ["M01"], update_plan: "更新", contribution_boundary: "差异",
  }
  empty.theory_target = { outcomes: ["convergence"], theorem_target: "希望证明收敛" }
  empty.accepted_stages = ["algorithm", "theory_target"]
  const theoryActions = ui.buildNextActions(ui.buildWorkflowView(empty))
  assert.match(theoryActions.join(" "), /假设/u)
  assert.match(theoryActions.join(" "), /证明缺口/u)

  empty.theory_analysis = { assumptions: "假设", lemma_chain: "证明链", proof_gaps: "仍有缺口" }
  empty.simulation = { metrics: "指标", baselines: "基线", communication_budget: "预算", result_status: "not_run", result_summary: "待运行" }
  empty.writing = { target_venue: "候选期刊", venue_references: "同刊论文", problem_algorithm: "算法材料", theory_section: "理论材料", experiment_section: "实验材料" }
  empty.accepted_stages = ["algorithm", "theory_target", "theory_analysis", "simulation", "writing"]
  const completedActions = ui.buildNextActions(ui.buildWorkflowView(empty))
  assert.equal(completedActions.length, 3)
  assert.match(completedActions.join(" "), /核验/u)
  assert.doesNotMatch(completedActions.join(" "), /论文完成|理论完成|仿真通过/u)
})

test("章节入口状态区分草稿、证明待核验和手工实验记录", () => {
  assert.equal(typeof ui.buildWritingEntryView, "function")
  const state = createEmptyP02WorkflowState()
  assert.deepEqual(ui.buildWritingEntryView(state), {
    algorithm: { label: "等待算法规划", ready: false },
    theory: { label: "等待理论目标", ready: false },
    simulation: { label: "等待实验设计", ready: false },
  })

  state.paper_roles = {
    algorithm_mechanism: ["Xi18-ADDOPT"],
    theory_evidence: ["Nedic17-DIGing"],
    simulation_baseline: ["Falsone17-DD"],
    related_work: ["Liu24-LCT"],
  }
  state.algorithm = {
    problem_type: "offline", research_objective: "目标", mechanisms: ["M01"], update_plan: "更新", contribution_boundary: "差异",
  }
  state.theory_target = { outcomes: ["convergence"], theorem_target: "希望证明收敛" }
  state.theory_analysis = { assumptions: "假设", lemma_chain: "证明链", proof_gaps: "仍有缺口" }
  state.accepted_stages = ["algorithm", "theory_target", "theory_analysis", "simulation"]
  state.simulation = { metrics: "指标", baselines: "基线", communication_budget: "预算", result_status: "recorded_unverified", result_summary: "结果待核验" }
  assert.deepEqual(ui.buildWritingEntryView(state), {
    algorithm: { label: "已有算法草稿", ready: true },
    theory: { label: "证明链待逐项核验", ready: false },
    simulation: { label: "结果待核验", ready: false },
  })

  state.simulation.result_status = "verified"
  assert.deepEqual(ui.buildWritingEntryView(state).simulation, {
    label: "用户标记已核验",
    ready: true,
  })
})
