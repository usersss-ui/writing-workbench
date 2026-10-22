import assert from "node:assert/strict"
import test from "node:test"

const workflow = await import("./p02-workflow.mjs")
const absoluteUsersPath = (...parts) => ["", "Users", ...parts].join("/")
const absoluteTmpPath = (...parts) => ["", "tmp", ...parts].join("/")
const externalPaperUrl = () => ["https:", "", "example.com", "paper"].join("/")

function fakeStorage(initial = new Map()) {
  return {
    getItem(key) { return initial.has(key) ? initial.get(key) : null },
    setItem(key, value) { initial.set(key, String(value)) },
    removeItem(key) { initial.delete(key) },
    raw(key) { return initial.get(key) },
  }
}

const ALGORITHM = Object.freeze({
  problem_type: "offline",
  research_objective: "在时变非平衡有向网络下减少通信并保持耦合约束可行性",
  mechanisms: ["M01", "M03", "M04"],
  update_plan: "接收保留状态，完成局部原始对偶更新，再按触发条件决定是否广播。",
  contribution_boundary: "把低通信触发误差引入时变非平衡网络的耦合约束协调；贡献仍待文献和证明核验。",
})

const THEORY_TARGET = Object.freeze({
  outcomes: ["convergence", "constraint", "communication"],
  theorem_target: "希望证明算法收敛到最优可行解，并给出约束违背与通信次数的界。",
})

const THEORY_ANALYSIS = Object.freeze({
  assumptions: "联合强连通、凸目标、Slater 条件；触发阈值条件仍待原文核验。",
  lemma_chain: "混合误差 → 触发扰动可和性 → 原始对偶误差 → 主定理。",
  proof_gaps: "尚未证明触发扰动在时变非平衡权重下可和。",
})

const SIMULATION = Object.freeze({
  metrics: "最优性误差、累计约束违背、累计通信次数",
  baselines: "无触发版本与固定周期通信版本",
  communication_budget: "统一消息次数与停止阈值，并同时报告迭代数",
  result_status: "not_run",
  result_summary: "先做二维凸算例，检查降低通信后是否仍保持可行。",
})

const WRITING = Object.freeze({
  target_venue: "IEEE Transactions on Automatic Control（候选）",
  venue_references: "待从相关工作用途架选择 3 篇同刊论文",
  problem_algorithm: "拟研究……",
  theory_section: "希望证明……；当前缺口……",
  experiment_section: "实验尚未运行，仅记录设计。",
})

const PAPER_ROLES = Object.freeze({
  algorithm_mechanism: ["Xi18-ADDOPT"],
  theory_evidence: ["Nedic17-DIGing"],
  simulation_baseline: ["Falsone17-DD"],
  related_work: ["Liu24-LCT"],
})

function prepareAllSources(store) {
  const result = store.syncPaperRoles(PAPER_ROLES)
  assert.equal(result.persisted, true)
}

test("P02 闭环公开五阶段状态接口并从算法草稿开始", () => {
  assert.equal(typeof workflow.createP02WorkflowStore, "function")
  assert.equal(typeof workflow.createEmptyP02WorkflowState, "function")
  assert.equal(typeof workflow.getWorkflowStageStatus, "function")
  assert.deepEqual(workflow.WORKFLOW_STAGES, [
    "algorithm", "theory_target", "theory_analysis", "simulation", "writing",
  ])

  const state = workflow.createEmptyP02WorkflowState()
  assert.deepEqual(state.accepted_stages, [])
  assert.equal(workflow.getWorkflowStageStatus(state, "algorithm"), "draft")
  assert.equal(workflow.getWorkflowStageStatus(state, "theory_target"), "locked")
})

test("五阶段只能依次确认且确认规划不冒充理论或实验已经成立", () => {
  const store = workflow.createP02WorkflowStore(fakeStorage())
  prepareAllSources(store)
  assert.equal(store.acceptStage("theory_target").reason, "prerequisite_not_accepted")
  assert.equal(store.acceptStage("algorithm").reason, "content_incomplete")

  assert.equal(store.updateStage("algorithm", ALGORITHM).changed, true)
  assert.equal(store.acceptStage("algorithm").accepted, true)
  assert.equal(workflow.getWorkflowStageStatus(store.read(), "algorithm"), "accepted")
  assert.equal(workflow.getWorkflowStageStatus(store.read(), "theory_target"), "draft")

  store.updateStage("theory_target", { outcomes: ["regret"], theorem_target: "希望证明次线性遗憾界。" })
  assert.equal(store.acceptStage("theory_target").reason, "regret_requires_online")
  store.updateStage("theory_target", THEORY_TARGET)
  assert.equal(store.acceptStage("theory_target").accepted, true)

  store.updateStage("theory_analysis", THEORY_ANALYSIS)
  assert.equal(store.acceptStage("theory_analysis").accepted, true)
  store.updateStage("simulation", SIMULATION)
  assert.equal(store.acceptStage("simulation").accepted, true)
  store.updateStage("writing", WRITING)
  assert.equal(store.acceptStage("writing").accepted, true)

  assert.deepEqual(store.read().accepted_stages, workflow.WORKFLOW_STAGES)
  const materials = workflow.buildWritingMaterials(store.read())
  assert.equal(materials.theory.readiness, "pending_verification")
  assert.equal(materials.simulation.readiness, "planning_only")
  assert.match(materials.theory.body, /理论目标：收敛性、约束违背、通信复杂度/u)
  assert.match(materials.theory.body, /希望证明/u)
  assert.match(materials.theory.body, /尚未形成已经成立的理论结论/u)
  assert.match(materials.simulation.body, /尚未运行/u)
})

test("闭环状态可以持久化并由新的页面实例完整读取", () => {
  const storage = fakeStorage()
  const first = workflow.createP02WorkflowStore(storage)
  assert.equal(first.updateStage("algorithm", ALGORITHM).persisted, true)
  assert.equal(first.acceptStage("algorithm").persisted, true)
  assert.deepEqual(JSON.parse(storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY)), first.read())

  const second = workflow.createP02WorkflowStore(storage)
  assert.deepEqual(second.read(), first.read())
  assert.deepEqual(second.readValidatedState(), { status: "valid", state: first.read() })
})

test("修改已经确认的上游会保留下游内容但把全部后续阶段降为待复核", () => {
  const store = workflow.createP02WorkflowStore(fakeStorage())
  prepareAllSources(store)
  for (const [stage, value] of [
    ["algorithm", ALGORITHM],
    ["theory_target", THEORY_TARGET],
    ["theory_analysis", THEORY_ANALYSIS],
    ["simulation", { ...SIMULATION, result_status: "verified", result_summary: "已有曲线并人工核对实现。" }],
    ["writing", WRITING],
  ]) {
    store.updateStage(stage, value)
    assert.equal(store.acceptStage(stage).accepted, true)
  }
  const before = store.read()

  const changed = store.updateStage("algorithm", {
    contribution_boundary: `${ALGORITHM.contribution_boundary} 现在改为事件触发。`,
  })
  assert.deepEqual(changed.invalidatedStages, ["theory_target", "theory_analysis", "simulation", "writing"])
  assert.deepEqual(changed.state.accepted_stages, [])
  assert.equal(workflow.getWorkflowStageStatus(changed.state, "algorithm"), "draft")
  for (const stage of changed.invalidatedStages) {
    assert.equal(workflow.getWorkflowStageStatus(changed.state, stage), "needs_review")
    assert.deepEqual(changed.state[stage], before[stage])
  }

  const staleMaterials = workflow.buildWritingMaterials(changed.state)
  assert.notEqual(staleMaterials.simulation.readiness, "verified")
  assert.match(staleMaterials.simulation.body, /上游方案已经修改/u)
})

test("存储写入失败不会在内存中伪装成已保存", () => {
  const store = workflow.createP02WorkflowStore({
    getItem() { return null },
    setItem() { throw new Error("quota") },
    removeItem() { throw new Error("denied") },
  })
  const before = store.read()
  const result = store.updateStage("algorithm", ALGORITHM)

  assert.deepEqual(
    { changed: result.changed, persisted: result.persisted, reason: result.reason },
    { changed: false, persisted: false, reason: "persistence_failed" },
  )
  assert.deepEqual(store.read(), before)
})

test("论文用途架只传递稳定论文编号并按四类用途汇总", () => {
  const summary = workflow.summarizeP02Shelf({
    shelf: {
      "Xi18-ADDOPT": ["algorithm_mechanism", "related_work"],
      "Nedic17-DIGing": ["algorithm_mechanism", "theory_evidence"],
      "Falsone17-DD": ["simulation_baseline"],
    },
  })

  assert.deepEqual(summary.algorithm_mechanism, ["Xi18-ADDOPT", "Nedic17-DIGing"])
  assert.deepEqual(summary.theory_evidence, ["Nedic17-DIGing"])
  assert.deepEqual(summary.simulation_baseline, ["Falsone17-DD"])
  assert.deepEqual(summary.related_work, ["Xi18-ADDOPT"])
})

test("闭环状态保存四类用途的稳定论文 ID 并拒绝路径与 URL", () => {
  const privatePaperPath = absoluteUsersPath("private", "paper.pdf")
  const paperUrl = externalPaperUrl()
  const state = workflow.createEmptyP02WorkflowState()
  assert.deepEqual(state.paper_roles, {
    algorithm_mechanism: [],
    theory_evidence: [],
    simulation_baseline: [],
    related_work: [],
  })

  const store = workflow.createP02WorkflowStore(fakeStorage())
  const synced = store.syncPaperRoles(PAPER_ROLES)
  assert.equal(synced.persisted, true)
  assert.deepEqual(synced.state.paper_roles, PAPER_ROLES)

  assert.throws(() => store.syncPaperRoles({
    ...PAPER_ROLES,
    algorithm_mechanism: [privatePaperPath],
  }), /论文 ID/u)
  assert.throws(() => store.syncPaperRoles({
    ...PAPER_ROLES,
    theory_evidence: [paperUrl],
  }), /论文 ID/u)

  const summary = workflow.summarizeP02Shelf({
    shelf: {
      "Xi18-ADDOPT": ["algorithm_mechanism"],
      [privatePaperPath]: ["algorithm_mechanism"],
      [paperUrl]: ["theory_evidence"],
    },
  })
  assert.deepEqual(summary.algorithm_mechanism, ["Xi18-ADDOPT"])
  assert.deepEqual(summary.theory_evidence, [])
})

test("算法、理论目标、仿真与写作分别要求对应用途论文后才能确认", () => {
  const store = workflow.createP02WorkflowStore(fakeStorage())
  store.updateStage("algorithm", ALGORITHM)
  const blocked = store.acceptStage("algorithm")
  assert.equal(blocked.reason, "source_required")
  assert.deepEqual(blocked.missingRoles, ["algorithm_mechanism"])

  prepareAllSources(store)
  assert.equal(store.acceptStage("algorithm").accepted, true)
  store.updateStage("theory_target", THEORY_TARGET)
  assert.equal(store.acceptStage("theory_target").accepted, true)
  store.updateStage("theory_analysis", THEORY_ANALYSIS)
  assert.equal(store.acceptStage("theory_analysis").accepted, true)
  store.updateStage("simulation", SIMULATION)
  assert.equal(store.acceptStage("simulation").accepted, true)
  store.updateStage("writing", WRITING)
  assert.equal(store.acceptStage("writing").accepted, true)
})

test("用途架变化从最早受影响阶段失效并保留下游内容", () => {
  const store = workflow.createP02WorkflowStore(fakeStorage())
  prepareAllSources(store)
  for (const [stage, value] of [
    ["algorithm", ALGORITHM],
    ["theory_target", THEORY_TARGET],
    ["theory_analysis", THEORY_ANALYSIS],
    ["simulation", SIMULATION],
    ["writing", WRITING],
  ]) {
    store.updateStage(stage, value)
    assert.equal(store.acceptStage(stage).accepted, true)
  }
  const before = store.read()

  const changed = store.syncPaperRoles({
    ...PAPER_ROLES,
    theory_evidence: ["Duchi12-DA"],
    related_work: ["Qu18-HS"],
  })
  assert.deepEqual(changed.invalidatedStages, ["theory_target", "theory_analysis", "simulation", "writing"])
  assert.deepEqual(changed.state.accepted_stages, ["algorithm"])
  assert.deepEqual(changed.state.theory_target, before.theory_target)
  assert.deepEqual(changed.state.writing, before.writing)
  assert.equal(workflow.getWorkflowStageStatus(changed.state, "theory_target"), "draft")
  assert.equal(workflow.getWorkflowStageStatus(changed.state, "theory_analysis"), "needs_review")
})

test("无效现存状态 fail closed 且只有显式重置后才能编辑", () => {
  const storage = fakeStorage(new Map([[workflow.P02_WORKFLOW_STORAGE_KEY, "{not-json"]]))
  const store = workflow.createP02WorkflowStore(storage)
  const rawBefore = storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY)

  assert.equal(store.readValidatedState().status, "invalid")
  assert.equal(store.updateStage("algorithm", ALGORITHM).reason, "invalid_state")
  assert.equal(store.syncPaperRoles(PAPER_ROLES).reason, "invalid_state")
  assert.equal(store.acceptStage("algorithm").reason, "invalid_state")
  assert.equal(storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY), rawBefore)

  const reset = store.clear()
  assert.equal(reset.cleared, true)
  assert.equal(store.readValidatedState().status, "missing")
  assert.equal(store.syncPaperRoles(PAPER_ROLES).persisted, true)
  assert.equal(store.updateStage("algorithm", ALGORITHM).persisted, true)
})

test("生成材料纳入候选期刊与同刊论文但只允许学习结构表达", () => {
  const store = workflow.createP02WorkflowStore(fakeStorage())
  prepareAllSources(store)
  store.updateStage("algorithm", ALGORITHM)
  store.acceptStage("algorithm")
  store.updateStage("theory_target", THEORY_TARGET)
  store.acceptStage("theory_target")
  store.updateStage("theory_analysis", THEORY_ANALYSIS)
  store.acceptStage("theory_analysis")
  store.updateStage("simulation", SIMULATION)
  store.acceptStage("simulation")
  store.updateStage("writing", WRITING)

  const materials = workflow.buildWritingMaterials(store.read())
  assert.equal(materials.venue.readiness, "pending_verification")
  assert.match(materials.venue.body, /IEEE Transactions on Automatic Control\(候选\)/u)
  assert.match(materials.venue.body, /待从相关工作用途架选择 3 篇同刊论文/u)
  assert.match(materials.venue.body, /只学习结构与表达/u)
  assert.match(materials.venue.body, /格式仍待核验/u)
  assert.match(materials.venue.body, /不直接拼接文字/u)
})

test("原子替换接口只接受严格有效状态并写入后回读", () => {
  const storage = fakeStorage()
  const store = workflow.createP02WorkflowStore(storage)
  const next = workflow.createEmptyP02WorkflowState()
  next.paper_roles = { ...PAPER_ROLES }
  next.algorithm = { ...ALGORITHM, mechanisms: [...ALGORITHM.mechanisms] }

  assert.equal(typeof store.replaceValidated, "function")
  const replaced = store.replaceValidated(next, { expectedCurrent: workflow.createEmptyP02WorkflowState() })
  assert.deepEqual(
    { replaced: replaced.replaced, persisted: replaced.persisted, reason: replaced.reason },
    { replaced: true, persisted: true, reason: null },
  )
  assert.deepEqual(JSON.parse(storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY)), next)
  assert.deepEqual(store.read(), next)

  const invalidNext = structuredClone(next)
  invalidNext.paper_roles.algorithm_mechanism = [absoluteTmpPath("paper.pdf")]
  assert.throws(() => store.replaceValidated(invalidNext), /闭环状态无效/u)
})

test("原子替换绝不覆盖无效、不可读或已经漂移的当前记录", () => {
  const invalidStorage = fakeStorage(new Map([[workflow.P02_WORKFLOW_STORAGE_KEY, "{bad"]]))
  const invalidStore = workflow.createP02WorkflowStore(invalidStorage)
  assert.equal(invalidStore.replaceValidated(workflow.createEmptyP02WorkflowState()).reason, "invalid_current")
  assert.equal(invalidStorage.raw(workflow.P02_WORKFLOW_STORAGE_KEY), "{bad")

  const unavailableStore = workflow.createP02WorkflowStore({
    getItem() { throw new Error("denied") },
    setItem() { throw new Error("denied") },
  })
  assert.equal(unavailableStore.replaceValidated(workflow.createEmptyP02WorkflowState()).reason, "current_unavailable")

  const initial = workflow.createEmptyP02WorkflowState()
  const storage = fakeStorage(new Map([[workflow.P02_WORKFLOW_STORAGE_KEY, JSON.stringify(initial)]]))
  const store = workflow.createP02WorkflowStore(storage)
  const external = structuredClone(initial)
  external.algorithm.research_objective = "另一个页面已经修改"
  storage.setItem(workflow.P02_WORKFLOW_STORAGE_KEY, JSON.stringify(external))
  const wanted = structuredClone(initial)
  wanted.algorithm.research_objective = "迁移希望写入"
  assert.equal(store.replaceValidated(wanted).reason, "stale_current")
  assert.deepEqual(JSON.parse(storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY)), external)
})

test("原子替换回读失败会恢复原始记录而不是留下半写状态", () => {
  const initial = workflow.createEmptyP02WorkflowState()
  const initialRaw = JSON.stringify(initial)
  let raw = initialRaw
  let corruptNextWrite = true
  const storage = {
    getItem() { return raw },
    setItem(_key, value) {
      if (corruptNextWrite) {
        corruptNextWrite = false
        raw = "{corrupted"
      } else raw = String(value)
    },
    removeItem() { raw = null },
  }
  const store = workflow.createP02WorkflowStore(storage)
  const next = structuredClone(initial)
  next.algorithm.research_objective = "新状态"
  const result = store.replaceValidated(next)

  assert.deepEqual(
    { replaced: result.replaced, persisted: result.persisted, reason: result.reason, rolledBack: result.rolledBack },
    { replaced: false, persisted: false, reason: "write_verification_failed", rolledBack: true },
  )
  assert.equal(raw, initialRaw)
  assert.deepEqual(store.read(), initial)
})

test("严格读取会刷新有效基线并在外部损坏后锁定当前实例", () => {
  const initial = workflow.createEmptyP02WorkflowState()
  const storage = fakeStorage(new Map([[workflow.P02_WORKFLOW_STORAGE_KEY, JSON.stringify(initial)]]))
  const store = workflow.createP02WorkflowStore(storage)
  const external = structuredClone(initial)
  external.algorithm.research_objective = "外部窗口保存的目标"
  storage.setItem(workflow.P02_WORKFLOW_STORAGE_KEY, JSON.stringify(external))

  assert.deepEqual(store.readValidatedState(), { status: "valid", state: external })
  const replacement = structuredClone(external)
  replacement.algorithm.update_plan = "基于刷新后的状态替换"
  assert.equal(store.replaceValidated(replacement, { expectedCurrent: external }).replaced, true)

  storage.setItem(workflow.P02_WORKFLOW_STORAGE_KEY, "{broken")
  assert.equal(store.readValidatedState().status, "invalid")
  const before = storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY)
  assert.equal(store.updateStage("algorithm", ALGORITHM).reason, "invalid_state")
  assert.equal(storage.raw(workflow.P02_WORKFLOW_STORAGE_KEY), before)
})
