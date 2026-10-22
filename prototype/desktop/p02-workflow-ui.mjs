import { openWorkbenchStorage } from "./workbench-storage.mjs"
import { WORKSPACE_STORAGE_KEY, createWorkspaceStore } from "./paper-library-storage.mjs"
import {
  P02_WORKFLOW_STORAGE_KEY,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  buildWritingMaterials,
  createP02WorkflowStore,
  getWorkflowStageStatus,
  summarizeP02Shelf,
} from "./p02-workflow.mjs"

const MECHANISM_ORDER = Object.freeze(["M01", "M02", "M03", "M04"])
const OUTCOME_ORDER = Object.freeze(["convergence", "rate", "tracking", "constraint", "communication", "regret"])
const STATUS_LABELS = Object.freeze({
  accepted: "已确认输入",
  draft: "正在填写",
  needs_review: "待重新核验",
  locked: "尚未进入",
})
const READINESS_LABELS = Object.freeze({
  draft: "草稿",
  planning_only: "仅规划材料",
  pending_verification: "待核验",
  verified: "用户已标记核验",
})
const NEXT_ACTIONS = Object.freeze({
  algorithm: Object.freeze([
    "先在论文库加入算法机制来源。",
    "明确离线或在线问题，并写清研究目标。",
    "记录机制组合、更新顺序与待验证的差异边界。",
  ]),
  theory_target: Object.freeze([
    "回到理论来源论文核验可借用的结果类型。",
    "选择收敛、跟踪、约束或通信等本轮目标。",
    "把结果写成“希望证明”的主定理目标。",
  ]),
  theory_analysis: Object.freeze([
    "列清网络、目标、约束、步长与触发条件等假设。",
    "按依赖顺序排列引理和主定理。",
    "明确当前证明缺口与仍待原文核验的位置。",
  ]),
  simulation: Object.freeze([
    "先在论文库加入仿真比较基线。",
    "让指标对应理论目标，并统一通信与停止预算。",
    "只记录手工运行状态和下一次最小实验。",
  ]),
  writing: Object.freeze([
    "确认候选期刊，并到官方页面核验格式要求。",
    "选择同刊高质量论文，只学习结构与表达。",
    "生成材料后逐项保留待核验边界，不拼接原文。",
  ]),
  complete: Object.freeze([
    "回到证明缺口，逐项完成原文和推导核验。",
    "只手工执行下一次最小实验并记录结果。",
    "核验期刊格式，继续迭代章节材料。",
  ]),
})
const STAGE_FIELDS = Object.freeze({
  algorithm: Object.freeze(["problem_type", "research_objective", "mechanisms", "update_plan", "contribution_boundary"]),
  theory_target: Object.freeze(["outcomes", "theorem_target"]),
  theory_analysis: Object.freeze(["assumptions", "lemma_chain", "proof_gaps"]),
  simulation: Object.freeze(["metrics", "baselines", "communication_budget", "result_status", "result_summary"]),
  writing: Object.freeze(["target_venue", "venue_references", "problem_algorithm", "theory_section", "experiment_section"]),
})

export function buildWorkflowView(state) {
  const complete = state.accepted_stages.length === WORKFLOW_STAGES.length
  const currentStage = complete ? null : WORKFLOW_STAGES[state.accepted_stages.length]
  const stages = Object.fromEntries(WORKFLOW_STAGES.map((stage, index) => {
    const status = getWorkflowStageStatus(state, stage)
    return [stage, {
      status,
      label: STATUS_LABELS[status],
      disabled: index > state.accepted_stages.length,
    }]
  }))
  return {
    complete,
    currentStage,
    summary: complete ? "首轮材料闭环已建立" : `当前：${WORKFLOW_STAGE_LABELS[currentStage]}`,
    stages,
  }
}

export function buildNextActions(view) {
  if (!view || typeof view !== "object") throw new TypeError("闭环视图无效")
  const key = view.complete ? "complete" : view.currentStage
  if (!Object.hasOwn(NEXT_ACTIONS, key)) throw new TypeError("闭环视图无效")
  return [...NEXT_ACTIONS[key]]
}

export function buildMissingWritingPatch(state) {
  const materials = buildWritingMaterials(state)
  const proposed = {
    problem_algorithm: `${materials.algorithm.body}\n\n${materials.venue.body}`,
    theory_section: materials.theory.body,
    experiment_section: materials.simulation.body,
  }
  return Object.fromEntries(Object.entries(proposed).filter(([key]) => !state.writing[key].trim()))
}

export function buildWritingEntryView(state) {
  const algorithmStatus = getWorkflowStageStatus(state, "algorithm")
  const theoryTargetStatus = getWorkflowStageStatus(state, "theory_target")
  const theoryAnalysisStatus = getWorkflowStageStatus(state, "theory_analysis")
  const simulationStatus = getWorkflowStageStatus(state, "simulation")
  const theoryNeedsReview = theoryTargetStatus === "needs_review" || theoryAnalysisStatus === "needs_review"

  let theoryLabel = "等待理论目标"
  if (theoryNeedsReview) theoryLabel = "理论材料待重新核验"
  else if (theoryAnalysisStatus === "accepted") theoryLabel = "证明链待逐项核验"
  else if (theoryTargetStatus === "accepted") theoryLabel = "理论目标已记录"

  let simulation = { label: "等待实验设计", ready: false }
  if (simulationStatus === "needs_review") simulation = { label: "实验材料待重新核验", ready: false }
  else if (simulationStatus === "accepted") {
    if (state.simulation.result_status === "verified") simulation = { label: "用户标记已核验", ready: true }
    else if (state.simulation.result_status === "recorded_unverified") simulation = { label: "结果待核验", ready: false }
    else simulation = { label: "实验计划已记录", ready: false }
  }

  return {
    algorithm: algorithmStatus === "accepted"
      ? { label: "已有算法草稿", ready: true }
      : algorithmStatus === "needs_review"
        ? { label: "算法材料待重新核验", ready: false }
        : { label: "等待算法规划", ready: false },
    theory: { label: theoryLabel, ready: false },
    simulation,
  }
}

function textValue(formData, name) {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function orderedValues(formData, name, order) {
  const selected = new Set(formData.getAll(name).filter((value) => typeof value === "string"))
  return order.filter((value) => selected.has(value))
}

export function readStagePatch(stage, formData) {
  if (!WORKFLOW_STAGES.includes(stage) || !formData || typeof formData.get !== "function" || typeof formData.getAll !== "function") {
    throw new TypeError("阶段表单无效")
  }
  const patch = Object.fromEntries(STAGE_FIELDS[stage]
    .filter((field) => field !== "mechanisms" && field !== "outcomes")
    .map((field) => [field, textValue(formData, field)]))
  if (stage === "algorithm") patch.mechanisms = orderedValues(formData, "mechanisms", MECHANISM_ORDER)
  if (stage === "theory_target") patch.outcomes = orderedValues(formData, "outcomes", OUTCOME_ORDER)
  return Object.fromEntries(STAGE_FIELDS[stage].map((field) => [field, patch[field]]))
}

function fillStageForm(form, stage, value) {
  for (const field of STAGE_FIELDS[stage]) {
    const controls = form.elements.namedItem(field)
    if (!controls) continue
    if (field === "mechanisms" || field === "outcomes") {
      const selected = new Set(value[field])
      for (const control of controls) control.checked = selected.has(control.value)
    } else controls.value = value[field]
  }
}

function setStageMessage(panel, message, state = "neutral") {
  const target = panel.querySelector("[data-stage-message]")
  if (!target) return
  target.textContent = message
  target.dataset.messageState = state
}

function reasonMessage(result) {
  if (result.reason === "content_incomplete") return "还缺少必填内容，暂时不能进入下一步。"
  if (result.reason === "regret_requires_online") return "当前选择的是离线问题；遗憾界只适用于目标或数据随时间变化的在线问题。"
  if (result.reason === "prerequisite_not_accepted") return "请先确认上一个环节。"
  if (result.reason === "stage_locked") return "该环节尚未解锁。"
  if (result.reason === "source_required") return "请先从论文库为本环节加入至少一篇对应的用途论文。"
  if (result.reason === "invalid_state") return "检测到无法安全读取的旧闭环状态；为避免覆盖原记录，请先显式重置。"
  if (result.reason === "persistence_failed") return "保存失败，页面没有把未保存内容伪装成成功；请检查浏览器存储设置。"
  return "当前内容尚未发生变化。"
}

function renderProjectStepper(documentRef, view) {
  const steps = [...documentRef.querySelectorAll(".project-stage")]
  for (const [index, step] of steps.entries()) {
    const stage = WORKFLOW_STAGES[index]
    if (!stage) continue
    const status = view.stages[stage].status
    step.classList.toggle("project-stage--active", stage === view.currentStage)
    step.classList.toggle("project-stage--done", status === "accepted")
    step.classList.toggle("project-stage--review", status === "needs_review")
    step.dataset.workflowState = status
  }
  const summary = documentRef.querySelector(".project-contract .path-summary")
  if (summary) summary.textContent = view.summary
}

function renderInspector(documentRef, view) {
  const status = documentRef.querySelector("[data-project-current-status]")
  const title = documentRef.querySelector("[data-project-current-title]")
  const description = documentRef.querySelector("[data-project-current-description]")
  if (status) status.textContent = view.complete ? "首轮材料已闭环" : `${WORKFLOW_STAGE_LABELS[view.currentStage]}中`
  if (title) title.textContent = view.complete ? "五个环节已经形成可回溯的首轮材料链" : `当前进入：${WORKFLOW_STAGE_LABELS[view.currentStage]}`
  if (description) description.textContent = view.complete
    ? "这不代表理论成立或论文完成；继续依据待核验项迭代即可。"
    : "只确认本阶段作为下一阶段输入，不把规划状态写成研究结论。"
  for (const stage of WORKFLOW_STAGES) {
    const field = documentRef.querySelector(`[data-inspector-stage="${stage}"]`)
    if (field) field.textContent = view.stages[stage].label
  }
  const actions = buildNextActions(view)
  for (const [index, target] of [...documentRef.querySelectorAll("[data-next-action]")].entries()) {
    if (actions[index]) target.textContent = actions[index]
  }
}

function renderWritingEntry(documentRef, state) {
  const entries = buildWritingEntryView(state)
  for (const [section, value] of Object.entries(entries)) {
    const target = documentRef.querySelector(`[data-writing-entry-status="${section}"]`)
    if (!target) continue
    target.textContent = value.label
    target.classList.toggle("writing-readiness--ready", value.ready)
  }
}

function renderWorkflow(documentRef, state) {
  const view = buildWorkflowView(state)
  const summary = documentRef.querySelector("#workflow-stage-summary")
  if (summary) {
    const strong = summary.querySelector("strong")
    const small = summary.querySelector("small")
    if (strong) strong.textContent = view.complete ? "首轮材料闭环已建立" : WORKFLOW_STAGE_LABELS[view.currentStage]
    if (small) small.textContent = view.complete
      ? "后续修改上游时，受影响的内容会转为待复核"
      : "草稿保存在当前浏览器；确认后才进入下一步"
    summary.dataset.workflowComplete = String(view.complete)
  }

  for (const stage of WORKFLOW_STAGES) {
    const panel = documentRef.querySelector(`[data-workflow-stage="${stage}"]`)
    if (!panel) continue
    const stageView = view.stages[stage]
    panel.dataset.workflowState = stageView.status
    panel.open = stage === view.currentStage
    const badge = panel.querySelector("[data-stage-status]")
    if (badge) badge.textContent = stageView.label
    const fields = panel.querySelector("[data-stage-fields]")
    if (fields) fields.disabled = stageView.disabled
    const accept = panel.querySelector(`[data-action="accept-stage"][data-stage="${stage}"]`)
    if (accept) disabledOrEnable(accept, stageView.disabled || stageView.status === "accepted")
    if (stageView.status === "accepted") setStageMessage(panel, "已确认作为下一阶段输入；仍可修改，修改后后续阶段会转为待复核。", "success")
    else if (stageView.status === "needs_review") setStageMessage(panel, "上游已经变化，原内容保留；请等待前置环节重新确认后再复核。", "warning")
    else if (stageView.status === "draft") setStageMessage(panel, "当前是可编辑草稿；填写完整后由你明确确认进入下一步。", "neutral")
    else setStageMessage(panel, "请先确认上一个环节。", "neutral")
  }
  renderProjectStepper(documentRef, view)
  renderInspector(documentRef, view)
  renderWritingEntry(documentRef, state)

  const materials = buildWritingMaterials(state)
  const algorithmOutput = documentRef.querySelector('[name="problem_algorithm"]')
  const theoryOutput = documentRef.querySelector('[name="theory_section"]')
  const simulationOutput = documentRef.querySelector('[name="experiment_section"]')
  if (algorithmOutput) algorithmOutput.dataset.readiness = materials.algorithm.readiness
  if (theoryOutput) theoryOutput.dataset.readiness = materials.theory.readiness
  if (simulationOutput) simulationOutput.dataset.readiness = materials.simulation.readiness
  for (const [control, material, label] of [
    [algorithmOutput, materials.algorithm, "问题模型与算法材料"],
    [theoryOutput, materials.theory, "理论分析材料"],
    [simulationOutput, materials.simulation, "仿真与结果材料"],
  ]) {
    if (!control) continue
    const readinessLabel = READINESS_LABELS[material.readiness] ?? material.readiness
    control.setAttribute("aria-label", `${label}（${readinessLabel}）`)
    control.title = `材料状态：${readinessLabel}`
    const visible = documentRef.querySelector(`[data-material-readiness="${control.name}"]`)
    if (visible) {
      visible.textContent = readinessLabel
      visible.dataset.readiness = material.readiness
    }
  }
  return view
}

function disabledOrEnable(control, disabled) {
  control.disabled = Boolean(disabled)
  control.setAttribute("aria-disabled", String(Boolean(disabled)))
}

export function buildShelfView(inspection) {
  const summary = summarizeP02Shelf(inspection?.state)
  const unavailable = inspection?.status === "unavailable"
  const invalid = inspection?.status === "invalid"
  return Object.fromEntries(Object.entries(summary).map(([role, ids]) => [role, {
    ids,
    countText: unavailable ? "状态不可用" : invalid ? "状态不可读" : `${ids.length} 篇`,
    paperText: unavailable || invalid
      ? "请回论文库检查本地状态"
      : ids.length > 0 ? ids.slice(0, 3).join(" · ") : "从论文库加入",
    ready: !unavailable && !invalid && ids.length > 0,
  }]))
}

export function syncWorkflowShelf(workflowStore, inspection) {
  if (!workflowStore || typeof workflowStore.syncPaperRoles !== "function") throw new TypeError("闭环存储无效")
  if (inspection?.status === "invalid" || inspection?.status === "unavailable") {
    return { synced: false, reason: `workspace_${inspection.status}`, invalidatedStages: [] }
  }
  const result = workflowStore.syncPaperRoles(summarizeP02Shelf(inspection?.state))
  return { ...result, synced: result.persisted && result.reason !== "invalid_state" }
}

export function persistStageFormInput(workflowStore, stage, formData) {
  if (!workflowStore || typeof workflowStore.updateStage !== "function") throw new TypeError("闭环存储无效")
  return workflowStore.updateStage(stage, readStagePatch(stage, formData))
}

export function buildWorkflowAvailabilityView(inspection) {
  if (inspection?.status === "invalid") {
    return {
      blocked: true,
      message: "检测到无法安全读取的旧闭环状态。为避免覆盖原记录，当前编辑已锁定；请显式重置后重新开始。",
      showReset: true,
    }
  }
  return { blocked: false, message: "", showReset: false }
}

function renderWorkflowAvailability(documentRef, inspection) {
  const view = buildWorkflowAvailabilityView(inspection)
  const alert = documentRef.querySelector("#workflow-invalid-state")
  const message = alert?.querySelector("[data-invalid-state-message]")
  const reset = documentRef.querySelector("#workflow-reset-invalid-state")
  if (alert) alert.hidden = !view.blocked
  if (message) message.textContent = view.message
  if (reset) reset.hidden = !view.showReset
  const loop = documentRef.querySelector("#workflow-loop")
  if (loop) loop.dataset.workflowBlocked = String(view.blocked)
  if (view.blocked) {
    for (const fields of documentRef.querySelectorAll("#workflow-loop [data-stage-fields]")) fields.disabled = true
    for (const button of documentRef.querySelectorAll('#workflow-loop [data-action="accept-stage"], #workflow-generate-writing')) {
      disabledOrEnable(button, true)
    }
  }
  return view
}

function renderShelf(documentRef, inspection) {
  const summary = buildShelfView(inspection)
  for (const role of Object.keys(summary)) {
    const card = documentRef.querySelector(`[data-workflow-role="${role}"]`)
    if (!card) continue
    const item = summary[role]
    const count = card.querySelector("[data-role-count]")
    const papers = card.querySelector("[data-role-papers]")
    if (count) count.textContent = item.countText
    if (papers) papers.textContent = item.paperText
    card.classList.toggle("workflow-source-card--ready", item.ready)
  }
}

function createNotifier(documentRef, windowRef) {
  return (message) => {
    const toast = documentRef.querySelector("#toast")
    if (!toast) return
    toast.textContent = message
    toast.classList.add("toast--visible")
    windowRef.setTimeout(() => toast.classList.remove("toast--visible"), 2600)
  }
}

export function initializeP02Workflow({ document: documentRef, window: windowRef, storage }) {
  const workflowStore = createP02WorkflowStore(storage)
  const workspaceStore = createWorkspaceStore(storage)
  const notify = createNotifier(documentRef, windowRef)

  const initialWorkspaceInspection = workspaceStore.readValidatedState()
  syncWorkflowShelf(workflowStore, initialWorkspaceInspection)

  for (const stage of WORKFLOW_STAGES) {
    const form = documentRef.querySelector(`[data-stage-form="${stage}"]`)
    if (form) fillStageForm(form, stage, workflowStore.read()[stage])
  }
  renderShelf(documentRef, initialWorkspaceInspection)
  renderWorkflow(documentRef, workflowStore.read())
  renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())

  documentRef.querySelector("#workflow-loop")?.addEventListener("input", (event) => {
    const form = event.target.closest("[data-stage-form]")
    if (!form) return
    const stage = form.dataset.stageForm
    const result = persistStageFormInput(workflowStore, stage, new FormData(form))
    const panel = form.closest("[data-workflow-stage]")
    if (!result.persisted) {
      setStageMessage(panel, reasonMessage(result), "error")
      fillStageForm(form, stage, workflowStore.read()[stage])
      notify(reasonMessage(result))
      return
    }
    renderWorkflow(documentRef, workflowStore.read())
    renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())
    if (result.invalidatedStages?.length > 0) notify("上游已修改，后续内容已保留并标记为待复核。")
  })

  documentRef.querySelector("#workflow-loop")?.addEventListener("submit", (event) => {
    event.preventDefault()
  })

  documentRef.querySelector("#workflow-loop")?.addEventListener("click", (event) => {
    const accept = event.target.closest('[data-action="accept-stage"]')
    if (accept) {
      const stage = accept.dataset.stage
      const form = documentRef.querySelector(`[data-stage-form="${stage}"]`)
      const panel = accept.closest("[data-workflow-stage]")
      const draftResult = workflowStore.updateStage(stage, readStagePatch(stage, new FormData(form)))
      if (draftResult.reason === "persistence_failed") {
        setStageMessage(panel, reasonMessage(draftResult), "error")
        fillStageForm(form, stage, workflowStore.read()[stage])
        notify(reasonMessage(draftResult))
        return
      }
      const result = workflowStore.acceptStage(stage)
      if (!result.accepted) {
        setStageMessage(panel, reasonMessage(result), "error")
        notify(reasonMessage(result))
        return
      }
      renderWorkflow(documentRef, workflowStore.read())
      renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())
      const next = WORKFLOW_STAGES[WORKFLOW_STAGES.indexOf(stage) + 1]
      if (next) {
        const nextPanel = documentRef.querySelector(`[data-workflow-stage="${next}"]`)
        nextPanel?.scrollIntoView({ behavior: "smooth", block: "start" })
        nextPanel?.querySelector("summary")?.focus({ preventScroll: true })
      }
      notify(next ? `已进入${WORKFLOW_STAGE_LABELS[next]}。` : "首轮材料闭环已经建立；理论与实验边界仍按记录显示。")
      return
    }

    const generate = event.target.closest("#workflow-generate-writing")
    if (!generate) return
    const patch = buildMissingWritingPatch(workflowStore.read())
    if (Object.keys(patch).length === 0) {
      notify("已有正文已保留。需要参考研究材料时，请打开写作页查看。")
      return
    }
    const result = workflowStore.updateStage("writing", patch)
    if (!result.persisted) {
      notify(reasonMessage(result))
      return
    }
    const form = documentRef.querySelector('[data-stage-form="writing"]')
    fillStageForm(form, "writing", workflowStore.read().writing)
    renderWorkflow(documentRef, workflowStore.read())
    renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())
    notify("已补充空白章节，保留已有正文和待核验标记。")
  })

  documentRef.querySelector("#workflow-reset-invalid-state")?.addEventListener("click", () => {
    const result = workflowStore.clear()
    if (!result.cleared) {
      notify("重置失败，原有无法读取的记录未被覆盖。")
      return
    }
    const workspaceInspection = createWorkspaceStore(storage).readValidatedState()
    syncWorkflowShelf(workflowStore, workspaceInspection)
    for (const stage of WORKFLOW_STAGES) {
      const form = documentRef.querySelector(`[data-stage-form="${stage}"]`)
      if (form) fillStageForm(form, stage, workflowStore.read()[stage])
    }
    renderShelf(documentRef, workspaceInspection)
    renderWorkflow(documentRef, workflowStore.read())
    renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())
    notify("无法读取的闭环记录已由你显式重置；现在可以重新填写。")
  })

  windowRef.addEventListener("storage", (event) => {
    if (event.key === null || event.key === WORKSPACE_STORAGE_KEY) {
      const inspection = createWorkspaceStore(storage).readValidatedState()
      renderShelf(documentRef, inspection)
      const result = syncWorkflowShelf(workflowStore, inspection)
      renderWorkflow(documentRef, workflowStore.read())
      renderWorkflowAvailability(documentRef, workflowStore.readValidatedState())
      if (result.invalidatedStages?.length > 0) notify("论文用途架已变化，受影响阶段的内容已保留并转为待复核。")
    }
    if (event.key === null || event.key === P02_WORKFLOW_STORAGE_KEY) {
      const inspection = workflowStore.readValidatedState()
      for (const stage of WORKFLOW_STAGES) {
        const form = documentRef.querySelector(`[data-stage-form="${stage}"]`)
        if (form) fillStageForm(form, stage, inspection.state[stage])
      }
      renderWorkflow(documentRef, inspection.state)
      renderWorkflowAvailability(documentRef, inspection)
    }
  })
  return { workflowStore, workspaceStore }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeP02Workflow({ document, window, storage: openWorkbenchStorage({ windowRef: window }) })
}
