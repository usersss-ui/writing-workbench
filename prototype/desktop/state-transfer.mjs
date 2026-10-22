import * as directionModule from "./direction-snapshot.mjs"
import * as taskInputModule from "./agent-task-input.mjs"
import * as workspaceModule from "./paper-library-storage.mjs"
import * as userTagModule from "./paper-user-tags.mjs"
import * as candidateModule from "./candidate-storage.mjs"
import * as p02Module from "./p02-workflow.mjs"
import * as discoveryWorkspaceModule from "./discovery-workspace.mjs"

const BUNDLE_SCHEMA = "research-console.state-transfer"
const PLAN_SCHEMA = "research-console.state-transfer-plan"
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_CANDIDATES = 100
const MAX_CANDIDATE_STATE_LENGTH = 5_500_000
const MAX_TAGS_PER_PAPER = 20
const MAX_TAG_ASSIGNMENTS = 500
const ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:4176",
  "http://127.0.0.1:4177",
  "http://127.0.0.1:4178",
])
const BUNDLE_KEYS = Object.freeze([
  "schema", "version", "origin", "exported_at", "counts", "conflict_report", "state", "sha256",
])
const V1_COUNT_KEYS = Object.freeze([
  "direction_snapshots", "workspace_shelf_entries", "workspace_reading_entries",
  "user_tag_assignments", "candidates", "agent_snapshots",
])
const V2_COUNT_KEYS = Object.freeze([...V1_COUNT_KEYS, "p02_accepted_stages"])
const V3_COUNT_KEYS = Object.freeze([...V2_COUNT_KEYS, "discovery_results", "discovery_external_candidates"])
const V1_STATE_KEYS = Object.freeze([
  "direction_snapshot", "paper_workspace", "personal_tags", "discovery_candidates", "agent_task_input",
])
const V2_STATE_KEYS = Object.freeze([...V1_STATE_KEYS, "p02_workflow"])
const V3_STATE_KEYS = Object.freeze([...V2_STATE_KEYS, "discovery_workspace"])
const STATE_KEYS_BY_VERSION = Object.freeze({ 1: V1_STATE_KEYS, 2: V2_STATE_KEYS, 3: V3_STATE_KEYS })
const COUNT_KEYS_BY_VERSION = Object.freeze({ 1: V1_COUNT_KEYS, 2: V2_COUNT_KEYS, 3: V3_COUNT_KEYS })
const CONFLICT_KEYS = Object.freeze(["id", "group", "kind", "identity", "sources", "allowed_actions"])
const SOURCE_KEYS = Object.freeze(["origin", "sha256"])
const PLAN_KEYS = Object.freeze([
  "schema", "version", "current_state_sha256", "bundle_sha256s", "proposed_state", "conflicts", "exclusions",
])

const bundleMetadata = new WeakMap()
const planMetadata = new WeakMap()

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try {
    return Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false
  let ownKeys
  let descriptors
  try {
    ownKeys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return false
  }
  if (ownKeys.some((key) => typeof key !== "string")) return false
  const actual = ownKeys.sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && actual.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key])
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function frozenClone(value) {
  return deepFreeze(clone(value))
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("状态迁移数据无效")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isPlainObject(value)) throw new TypeError("状态迁移数据无效")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
}

async function sha256Text(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
    throw new Error("当前浏览器不支持状态迁移校验")
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function hashState(state) {
  return sha256Text(canonicalJson(state))
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string") return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function stateIsValid(state, version = 3) {
  const keys = STATE_KEYS_BY_VERSION[version]
  if (!Array.isArray(keys)) return false
  return hasExactKeys(state, keys)
    && (state.direction_snapshot === null || directionModule.isValidDirectionSnapshot?.(state.direction_snapshot) === true)
    && workspaceModule.isValidWorkspaceState?.(state.paper_workspace) === true
    && userTagModule.isValidUserTagState?.(state.personal_tags) === true
    && candidateModule.isValidCandidateState?.(state.discovery_candidates) === true
    && taskInputModule.isValidTaskInputStoreState?.(state.agent_task_input) === true
    && (version === 1 || p02Module.isValidP02WorkflowState?.(state.p02_workflow) === true)
    && (version !== 3 || discoveryWorkspaceModule.isValidDiscoveryWorkspaceState?.(state.discovery_workspace) === true)
}

function countsFor(state, version = 3) {
  const counts = {
    direction_snapshots: state.direction_snapshot === null ? 0 : 1,
    workspace_shelf_entries: Object.keys(state.paper_workspace.shelf).length,
    workspace_reading_entries: Object.keys(state.paper_workspace.personalReading).length,
    user_tag_assignments: Object.values(state.personal_tags.papers).reduce((sum, labels) => sum + labels.length, 0),
    candidates: state.discovery_candidates.candidates.length,
    agent_snapshots: state.agent_task_input.snapshots.length,
  }
  if (version >= 2) counts.p02_accepted_stages = state.p02_workflow.accepted_stages.length
  if (version === 3) {
    counts.discovery_results = state.discovery_workspace.results.length
    counts.discovery_external_candidates = state.discovery_workspace.external_candidates.length
  }
  return counts
}

function countsAreValid(value, state, version) {
  const keys = COUNT_KEYS_BY_VERSION[version]
  if (!Array.isArray(keys) || !hasExactKeys(value, keys)) return false
  const expected = countsFor(state, version)
  return keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] === expected[key])
}

function sourceRef(bundle) {
  return { origin: bundle.origin, sha256: bundle.sha256 }
}

function sourcesAreValid(value) {
  return Array.isArray(value) && value.length > 0 && value.every((source) => (
    hasExactKeys(source, SOURCE_KEYS)
    && ALLOWED_ORIGINS.includes(source.origin)
    && /^[a-f0-9]{64}$/u.test(source.sha256)
  ))
}

function conflictIsValid(value) {
  return hasExactKeys(value, CONFLICT_KEYS)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.group === "string" && value.group.length > 0
    && typeof value.kind === "string" && value.kind.length > 0
    && typeof value.identity === "string" && value.identity.length > 0
    && sourcesAreValid(value.sources)
    && (JSON.stringify(value.allowed_actions) === JSON.stringify(["skip"])
      || JSON.stringify(value.allowed_actions) === JSON.stringify(["skip", "replace"]))
}

function exactJsonEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function buildStores(storage) {
  const stores = {
    agent_task_input: taskInputModule.createTaskInputSnapshotStore?.(storage),
    direction_snapshot: directionModule.createDirectionSnapshotStore?.(storage),
    paper_workspace: workspaceModule.createWorkspaceStore?.(storage),
    personal_tags: userTagModule.createUserTagStore?.(storage),
    discovery_candidates: candidateModule.createCandidateStore?.(storage),
    p02_workflow: p02Module.createP02WorkflowStore?.(storage),
    discovery_workspace: discoveryWorkspaceModule.createDiscoveryWorkspaceStore?.(storage),
  }
  if (Object.values(stores).some((store) => !store || typeof store.readValidatedState !== "function")) {
    throw new Error("浏览器状态无法导出")
  }
  return stores
}

function readCurrentStates(storage) {
  const stores = buildStores(storage)
  const state = {}
  let discoveryWorkspaceMissing = false
  for (const key of ["agent_task_input", "direction_snapshot", "paper_workspace", "personal_tags", "discovery_candidates", "p02_workflow", "discovery_workspace"]) {
    let result
    try {
      result = stores[key].readValidatedState()
    } catch {
      throw new Error("浏览器状态无法导出")
    }
    const allowedStatuses = key === "p02_workflow" ? ["valid"] : ["valid", "missing"]
    if (!isPlainObject(result) || !allowedStatuses.includes(result.status)) {
      throw new Error("浏览器状态无法导出")
    }
    state[key] = result.state
    if (key === "discovery_workspace") discoveryWorkspaceMissing = result.status === "missing"
  }
  if (!stateIsValid(state)) throw new Error("浏览器状态无法导出")
  const orderedState = Object.fromEntries(V3_STATE_KEYS.map((key) => [key, state[key]]))
  return { stores, state: clone(orderedState), discoveryWorkspaceMissing }
}

function bundleBody({ origin, exportedAt, state }) {
  return {
    schema: BUNDLE_SCHEMA,
    version: 3,
    origin,
    exported_at: exportedAt,
    counts: countsFor(state),
    conflict_report: { status: "not_evaluated", conflicts: [] },
    state: clone(state),
  }
}

function brandBundle(bundle, rawBytes) {
  const frozen = frozenClone(bundle)
  bundleMetadata.set(frozen, { rawBytes })
  return frozen
}

export async function exportStateBundle({ storage, originLabel, exportedAt } = {}) {
  if (!ALLOWED_ORIGINS.includes(originLabel) || !isCanonicalIsoDate(exportedAt)) {
    throw new TypeError("状态迁移导出参数无效")
  }
  const { state } = readCurrentStates(storage)
  const body = bundleBody({ origin: originLabel, exportedAt, state })
  const bundle = { ...body, sha256: await sha256Text(canonicalJson(body)) }
  const byteLength = new TextEncoder().encode(JSON.stringify(bundle)).byteLength
  if (byteLength > MAX_BUNDLE_BYTES) throw new RangeError("浏览器状态超过迁移文件大小限制，状态无法导出")
  return brandBundle(bundle, byteLength)
}

function rawBytes(raw) {
  if (typeof raw === "string") return new TextEncoder().encode(raw)
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  throw new TypeError("状态迁移文件无效")
}

function bundleShapeIsValid(value) {
  if (!hasExactKeys(value, BUNDLE_KEYS)
    || value.schema !== BUNDLE_SCHEMA
    || ![1, 2, 3].includes(value.version)
    || !ALLOWED_ORIGINS.includes(value.origin)
    || !isCanonicalIsoDate(value.exported_at)
    || !hasExactKeys(value.conflict_report, ["status", "conflicts"])
    || value.conflict_report.status !== "not_evaluated"
    || !Array.isArray(value.conflict_report.conflicts)
    || value.conflict_report.conflicts.length !== 0
    || !stateIsValid(value.state, value.version)
    || !countsAreValid(value.counts, value.state, value.version)
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.sha256)) return false
  return true
}

export async function validateStateBundle(raw) {
  let bytes
  try {
    bytes = rawBytes(raw)
  } catch {
    throw new TypeError("状态迁移文件无效")
  }
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new RangeError("状态迁移文件过大")
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new TypeError("状态迁移文件无效")
  }
  if (!bundleShapeIsValid(parsed)) throw new TypeError("状态迁移文件无效")
  const { sha256, ...body } = parsed
  let computed
  try {
    computed = await sha256Text(canonicalJson(body))
  } catch {
    throw new TypeError("状态迁移文件无效")
  }
  if (computed !== sha256) throw new TypeError("状态迁移文件无效")
  return brandBundle(parsed, bytes.byteLength)
}

async function ensureValidatedBundle(value) {
  if (bundleMetadata.has(value) && bundleShapeIsValid(value)) return value
  if (!isPlainObject(value)) throw new TypeError("状态迁移文件无效")
  return validateStateBundle(JSON.stringify(value))
}

function compareBundles(left, right) {
  return compareText(left.origin, right.origin)
    || compareText(left.exported_at, right.exported_at)
    || compareText(left.sha256, right.sha256)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeConflictId(group, index = null) {
  return index === null ? group : `${group}-${String(index).padStart(3, "0")}`
}

function wholeDocumentConflict({ key, group, identity, current, bundles, conflicts, alternatives }) {
  const differing = bundles.filter((bundle) => !exactJsonEqual(bundle.state[key], current.state[key]))
  if (differing.length === 0) return
  const id = safeConflictId(group)
  conflicts.push({
    id,
    group,
    kind: "whole_document",
    identity,
    sources: differing.map(sourceRef),
    allowed_actions: ["skip", "replace"],
  })
  alternatives.set(id, new Map(differing.map((bundle) => [bundle.sha256, clone(bundle.state[key])])))
}

function tagComparisonKey(label) {
  return label.normalize("NFKC").trim().toLocaleLowerCase("en-US")
}

function exclusion({ id, group, kind, identity, bundle }) {
  return { id, group, kind, identity, source: sourceRef(bundle) }
}

function mergeTags(current, bundles, knownPaperIds, exclusions) {
  const state = clone(current.state.personal_tags)
  const known = new Set(knownPaperIds)
  let assignmentCount = Object.values(state.papers).reduce((sum, labels) => sum + labels.length, 0)
  let exclusionIndex = 0
  const excluded = new Set()
  const addExclusion = (kind, paperId, bundle) => {
    const key = `${kind}\u0000${paperId}\u0000${bundle.sha256}`
    if (excluded.has(key)) return
    excluded.add(key)
    exclusionIndex += 1
    exclusions.push(exclusion({
      id: `personal-tags-exclusion-${String(exclusionIndex).padStart(3, "0")}`,
      group: "personal_tags",
      kind,
      identity: paperId,
      bundle,
    }))
  }
  for (const bundle of bundles) {
    for (const paperId of Object.keys(bundle.state.personal_tags.papers).sort()) {
      if (!known.has(paperId)) {
        addExclusion("unknown_paper", paperId, bundle)
        continue
      }
      const labels = state.papers[paperId] ? [...state.papers[paperId]] : []
      const seen = new Set(labels.map(tagComparisonKey))
      for (const label of bundle.state.personal_tags.papers[paperId]) {
        const key = tagComparisonKey(label)
        if (seen.has(key)) continue
        if (labels.length >= MAX_TAGS_PER_PAPER || assignmentCount >= MAX_TAG_ASSIGNMENTS) {
          addExclusion("capacity_limit", paperId, bundle)
          continue
        }
        labels.push(label)
        seen.add(key)
        assignmentCount += 1
      }
      if (labels.length > 0) state.papers[paperId] = labels
    }
  }
  return state
}

class DisjointSet {
  constructor(length) {
    this.parent = Array.from({ length }, (_, index) => index)
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index])
    return this.parent[index]
  }

  union(left, right) {
    const a = this.find(left)
    const b = this.find(right)
    if (a !== b) this.parent[b] = a
  }
}

function candidateIdentities(candidate) {
  const identities = [`openalex:${candidate.paperId}`]
  if (candidate.doi !== null) identities.push(`doi:${candidate.doi.toLowerCase()}`)
  return identities
}

function mergeCandidates(current, bundles, conflicts, exclusions) {
  const records = current.state.discovery_candidates.candidates.map((candidate, index) => ({
    candidate, bundle: current, current: true, sequence: index,
  }))
  for (const bundle of bundles) {
    bundle.state.discovery_candidates.candidates.forEach((candidate, sequence) => {
      records.push({ candidate, bundle, current: false, sequence })
    })
  }
  const dsu = new DisjointSet(records.length)
  const identityOwner = new Map()
  records.forEach((record, index) => {
    for (const identity of candidateIdentities(record.candidate)) {
      if (identityOwner.has(identity)) dsu.union(index, identityOwner.get(identity))
      else identityOwner.set(identity, index)
    }
  })
  const components = new Map()
  records.forEach((record, index) => {
    const root = dsu.find(index)
    if (!components.has(root)) components.set(root, [])
    components.get(root).push(record)
  })
  const ordered = [...components.values()]
  const output = current.state.discovery_candidates.candidates.map(clone)
  let conflictIndex = 0
  let exclusionIndex = 0
  for (const component of ordered) {
    const bodies = new Map()
    for (const record of component) {
      const body = canonicalJson(record.candidate)
      if (!bodies.has(body)) bodies.set(body, [])
      bodies.get(body).push(record)
    }
    const currentRecords = component.filter((record) => record.current)
    if (bodies.size > 1) {
      conflictIndex += 1
      const identities = [...new Set(component.flatMap((record) => candidateIdentities(record.candidate)))].sort()
      const sources = []
      const seenSources = new Set()
      for (const record of component.filter((item) => !item.current)) {
        if (!seenSources.has(record.bundle.sha256)) {
          seenSources.add(record.bundle.sha256)
          sources.push(sourceRef(record.bundle))
        }
      }
      conflicts.push({
        id: safeConflictId("discovery-candidates", conflictIndex),
        group: "discovery_candidates",
        kind: "identity_body_mismatch",
        identity: identities.join(" | "),
        sources,
        allowed_actions: ["skip"],
      })
      continue
    }
    const representative = component[0]
    if (currentRecords.length > 0) continue
    const proposed = { version: 1, candidates: [...output, clone(representative.candidate)] }
    if (proposed.candidates.length > MAX_CANDIDATES || JSON.stringify(proposed).length > MAX_CANDIDATE_STATE_LENGTH) {
      exclusionIndex += 1
      exclusions.push(exclusion({
        id: `discovery-candidates-exclusion-${String(exclusionIndex).padStart(3, "0")}`,
        group: "discovery_candidates",
        kind: "capacity_limit",
        identity: candidateIdentities(representative.candidate).sort().join(" | "),
        bundle: representative.bundle,
      }))
      continue
    }
    output.push(clone(representative.candidate))
  }
  return { version: 1, candidates: output }
}

function mergeAgentInput(current, bundles, conflicts, alternatives, exclusions) {
  const byId = new Map()
  const orderedIds = []
  const occurrences = new Map()
  const addOccurrence = (snapshot, bundle, isCurrent) => {
    if (!occurrences.has(snapshot.snapshot_id)) occurrences.set(snapshot.snapshot_id, [])
    occurrences.get(snapshot.snapshot_id).push({ snapshot, bundle, isCurrent })
    if (!byId.has(snapshot.snapshot_id)) {
      byId.set(snapshot.snapshot_id, clone(snapshot))
      orderedIds.push(snapshot.snapshot_id)
    }
  }
  current.state.agent_task_input.snapshots.forEach((snapshot) => addOccurrence(snapshot, current, true))
  bundles.forEach((bundle) => bundle.state.agent_task_input.snapshots.forEach((snapshot) => addOccurrence(snapshot, bundle, false)))

  const survivors = new Map()
  let conflictIndex = 0
  for (const snapshotId of [...occurrences.keys()].sort()) {
    const items = occurrences.get(snapshotId)
    const bodies = new Set(items.map((item) => canonicalJson(item.snapshot)))
    const currentItem = items.find((item) => item.isCurrent)
    if (bodies.size > 1) {
      conflictIndex += 1
      const seen = new Set()
      const sources = []
      for (const item of items.filter((candidate) => !candidate.isCurrent)) {
        if (!seen.has(item.bundle.sha256)) {
          seen.add(item.bundle.sha256)
          sources.push(sourceRef(item.bundle))
        }
      }
      conflicts.push({
        id: safeConflictId("agent-snapshots", conflictIndex),
        group: "agent_task_input",
        kind: "snapshot_body_mismatch",
        identity: snapshotId,
        sources,
        allowed_actions: ["skip"],
      })
      if (currentItem) survivors.set(snapshotId, clone(currentItem.snapshot))
    } else {
      survivors.set(snapshotId, clone(items[0].snapshot))
    }
  }
  const snapshots = []
  for (const snapshotId of orderedIds) {
    if (survivors.has(snapshotId)) snapshots.push(survivors.get(snapshotId))
  }

  const currentPointer = current.state.agent_task_input.current_snapshot_id
  const pointerBundles = bundles.filter((bundle) => {
    const pointer = bundle.state.agent_task_input.current_snapshot_id
    if (pointer === currentPointer || pointer === null || !survivors.has(pointer)) return false
    const sourceSnapshot = bundle.state.agent_task_input.snapshots.find(({ snapshot_id: id }) => id === pointer)
    return sourceSnapshot !== undefined && exactJsonEqual(sourceSnapshot, survivors.get(pointer))
  })
  if (pointerBundles.length > 0) {
    const id = "agent-current-pointer"
    conflicts.push({
      id,
      group: "agent_task_input",
      kind: "current_pointer",
      identity: "current_snapshot_id",
      sources: pointerBundles.map(sourceRef),
      allowed_actions: ["skip", "replace"],
    })
    alternatives.set(id, new Map(pointerBundles.map((bundle) => [
      bundle.sha256, bundle.state.agent_task_input.current_snapshot_id,
    ])))
  }
  for (const bundle of bundles) {
    const pointer = bundle.state.agent_task_input.current_snapshot_id
    const sourceSnapshot = pointer === null
      ? null
      : bundle.state.agent_task_input.snapshots.find(({ snapshot_id: id }) => id === pointer)
    const sourceTargetSurvives = pointer !== null
      && survivors.has(pointer)
      && sourceSnapshot !== undefined
      && exactJsonEqual(sourceSnapshot, survivors.get(pointer))
    if (pointer !== null && pointer !== currentPointer && !sourceTargetSurvives) {
      exclusions.push(exclusion({
        id: `agent-pointer-exclusion-${String(exclusions.length + 1).padStart(3, "0")}`,
        group: "agent_task_input",
        kind: "pointer_target_conflicted",
        identity: pointer,
        bundle,
      }))
    }
  }
  return { version: 1, current_snapshot_id: currentPointer, snapshots }
}

function planIsStructurallyValid(plan) {
  return hasExactKeys(plan, PLAN_KEYS)
    && plan.schema === PLAN_SCHEMA
    && plan.version === 1
    && /^[a-f0-9]{64}$/u.test(plan.current_state_sha256)
    && Array.isArray(plan.bundle_sha256s)
    && plan.bundle_sha256s.every((sha) => /^[a-f0-9]{64}$/u.test(sha))
    && stateIsValid(plan.proposed_state)
    && Array.isArray(plan.conflicts)
    && plan.conflicts.every(conflictIsValid)
    && new Set(plan.conflicts.map(({ id }) => id)).size === plan.conflicts.length
    && Array.isArray(plan.exclusions)
}

export async function previewStateMerge({ current, bundles, knownPaperIds } = {}) {
  const currentBundle = await ensureValidatedBundle(current)
  if (currentBundle.version !== 3) {
    throw new TypeError("当前状态必须是包含有效 P02 与检索工作区的 v3 状态")
  }
  if (!Array.isArray(bundles) || bundles.length < 1 || bundles.length > 3) {
    throw new RangeError("请选择一至三个状态迁移文件")
  }
  if (!Array.isArray(knownPaperIds) || knownPaperIds.some((paperId) => typeof paperId !== "string")) {
    throw new TypeError("已知论文列表无效")
  }
  const validated = await Promise.all(bundles.map(ensureValidatedBundle))
  const totalBytes = validated.reduce((sum, bundle) => sum + (bundleMetadata.get(bundle)?.rawBytes ?? 0), 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new RangeError("状态迁移文件总大小过大")
  if (new Set(validated.map(({ origin }) => origin)).size !== validated.length) {
    throw new TypeError("状态迁移文件来源重复")
  }
  const sorted = [...validated].sort(compareBundles)
  const conflicts = []
  const exclusions = []
  const alternatives = new Map()
  wholeDocumentConflict({
    key: "direction_snapshot", group: "direction_snapshot", identity: "P02",
    current: currentBundle, bundles: sorted, conflicts, alternatives,
  })
  wholeDocumentConflict({
    key: "paper_workspace", group: "paper_workspace", identity: "paper_workspace",
    current: currentBundle, bundles: sorted, conflicts, alternatives,
  })
  wholeDocumentConflict({
    key: "p02_workflow", group: "p02_workflow", identity: "P02 workflow",
    current: currentBundle, bundles: sorted.filter(({ version }) => version >= 2), conflicts, alternatives,
  })
  wholeDocumentConflict({
    key: "discovery_workspace", group: "discovery_workspace", identity: "discovery_workspace",
    current: currentBundle, bundles: sorted.filter(({ version }) => version === 3), conflicts, alternatives,
  })
  const proposedState = clone(currentBundle.state)
  proposedState.personal_tags = mergeTags(currentBundle, sorted, knownPaperIds, exclusions)
  proposedState.discovery_candidates = mergeCandidates(currentBundle, sorted, conflicts, exclusions)
  proposedState.agent_task_input = mergeAgentInput(currentBundle, sorted, conflicts, alternatives, exclusions)
  if (!stateIsValid(proposedState)) throw new RangeError("合并后的浏览器状态超出限制")
  const plan = {
    schema: PLAN_SCHEMA,
    version: 1,
    current_state_sha256: await hashState(currentBundle.state),
    bundle_sha256s: sorted.map(({ sha256 }) => sha256),
    proposed_state: proposedState,
    conflicts,
    exclusions,
  }
  if (!planIsStructurallyValid(plan)) throw new TypeError("状态迁移合并计划无效")
  const frozen = frozenClone(plan)
  planMetadata.set(frozen, { alternatives, applied: false })
  return frozen
}

function decisionsFor(plan, decisions, alternatives) {
  if (!hasExactKeys(decisions, plan.conflicts.map(({ id }) => id))) {
    throw new TypeError("冲突决定不完整")
  }
  const target = clone(plan.proposed_state)
  for (const conflict of plan.conflicts) {
    const decision = decisions[conflict.id]
    if (!isPlainObject(decision)) throw new TypeError("冲突决定无效")
    if (decision.action === "skip") {
      if (!hasExactKeys(decision, ["action"])) throw new TypeError("冲突决定无效")
      continue
    }
    if (decision.action !== "replace" || !hasExactKeys(decision, ["action", "source_sha256"])
      || !conflict.allowed_actions.includes("replace")
      || typeof decision.source_sha256 !== "string") {
      throw new TypeError("冲突决定无效")
    }
    const replacement = alternatives.get(conflict.id)?.get(decision.source_sha256)
    if (replacement === undefined) throw new TypeError("冲突替换来源无效")
    if (conflict.group === "direction_snapshot") target.direction_snapshot = clone(replacement)
    else if (conflict.group === "paper_workspace") target.paper_workspace = clone(replacement)
    else if (conflict.group === "p02_workflow") target.p02_workflow = clone(replacement)
    else if (conflict.group === "discovery_workspace") target.discovery_workspace = clone(replacement)
    else if (conflict.id === "agent-current-pointer") target.agent_task_input.current_snapshot_id = replacement
    else throw new TypeError("冲突替换决定无效")
  }
  if (!stateIsValid(target)) throw new TypeError("冲突决定产生了无效状态")
  return target
}

function replacementOperations(stores, state) {
  return [
    ["direction_snapshot", () => stores.direction_snapshot.replaceValidated(state.direction_snapshot)],
    ["paper_workspace", () => stores.paper_workspace.replaceValidated(state.paper_workspace)],
    ["p02_workflow", () => stores.p02_workflow.replaceValidated(state.p02_workflow)],
    ["discovery_workspace", () => stores.discovery_workspace.replaceValidated(state.discovery_workspace)],
    ["personal_tags", () => stores.personal_tags.replaceValidated(state.personal_tags)],
    ["discovery_candidates", () => stores.discovery_candidates.replaceValidated(state.discovery_candidates)],
    ["agent_task_input", () => stores.agent_task_input.replaceAllValidated(state.agent_task_input)],
  ]
}

async function replacementSucceeded(operation) {
  try {
    const result = await operation()
    return isPlainObject(result) && result.replaced === true
  } catch {
    return false
  }
}

export async function applyStateMerge({ storage, plan, decisions } = {}) {
  const metadata = planMetadata.get(plan)
  if (!metadata || metadata.applied || !planIsStructurallyValid(plan)) {
    throw new TypeError("状态迁移合并计划无效或已使用")
  }
  const target = decisionsFor(plan, decisions, metadata.alternatives)
  const captured = readCurrentStates(storage)
  if (await hashState(captured.state) !== plan.current_state_sha256) {
    const error = new Error("浏览器状态已变化，请重新预览")
    error.code = "stale_plan"
    throw error
  }
  metadata.applied = true
  let applyFailed = false
  let discoveryWorkspaceAttempted = false
  for (const [key, operation] of replacementOperations(captured.stores, target)) {
    if (exactJsonEqual(captured.state[key], target[key])) continue
    if (key === "discovery_workspace") discoveryWorkspaceAttempted = true
    if (!await replacementSucceeded(operation)) {
      applyFailed = true
      break
    }
  }
  if (!applyFailed) {
    let verified
    try { verified = readCurrentStates(storage).state } catch { verified = null }
    if (verified && exactJsonEqual(verified, target)) {
      return frozenClone({ status: "success", state: target })
    }
  }

  let rollbackProven = true
  const rollback = replacementOperations(captured.stores, captured.state).reverse()
  for (const [key, operation] of rollback) {
    let restoreOperation = operation
    if (key === "discovery_workspace") {
      if (!discoveryWorkspaceAttempted) continue
      // Inspect independently: refreshing the captured store would discard its CAS baseline.
      // A failed owner write may already have proven its local rollback to a missing key.
      const live = discoveryWorkspaceModule.createDiscoveryWorkspaceStore(storage).readValidatedState()
      const samePresence = (live.status === "missing") === captured.discoveryWorkspaceMissing
      if (["valid", "missing"].includes(live.status) && samePresence && exactJsonEqual(live.state, captured.state[key])) continue
      if (captured.discoveryWorkspaceMissing) restoreOperation = () => captured.stores.discovery_workspace.restoreMissingValidated()
    }
    if (!await replacementSucceeded(restoreOperation)) rollbackProven = false
  }
  try {
    const restored = readCurrentStates(storage)
    if (!exactJsonEqual(restored.state, captured.state)
      || restored.discoveryWorkspaceMissing !== captured.discoveryWorkspaceMissing) rollbackProven = false
  } catch {
    rollbackProven = false
  }
  return deepFreeze({ status: rollbackProven ? "apply_failed_rolled_back" : "rollback_failed" })
}

function setBusy(elements, busy) {
  elements.root?.setAttribute("aria-busy", busy ? "true" : "false")
  for (const control of [elements.exportButton, elements.files, elements.previewButton]) {
    if (control) control.disabled = busy
  }
  if (elements.confirm) elements.confirm.disabled = busy
  for (const control of elements.conflicts?.querySelectorAll?.("select") ?? []) control.disabled = busy
  if (busy && elements.applyButton) elements.applyButton.disabled = true
}

function focusStatus(elements, message, tone = "neutral") {
  if (!elements.status) return
  elements.status.textContent = message
  elements.status.dataset.tone = tone
  elements.status.focus?.()
}

function createTextElement(documentRef, tag, text, className = "") {
  const element = documentRef.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}

function countSummary(counts) {
  const p02 = Object.prototype.hasOwnProperty.call(counts, "p02_accepted_stages")
    ? `P02 已确认阶段 ${counts.p02_accepted_stages}`
    : "P02 旧版未包含"
  const discovery = Object.prototype.hasOwnProperty.call(counts, "discovery_results")
    ? `检索结果 ${counts.discovery_results}；外部候选 ${counts.discovery_external_candidates}`
    : "检索工作区旧版未包含，保留当前状态"
  return `方向 ${counts.direction_snapshots}；书架 ${counts.workspace_shelf_entries}；阅读标记 ${counts.workspace_reading_entries}；标签 ${counts.user_tag_assignments}；候选 ${counts.candidates}；Agent 快照 ${counts.agent_snapshots}；${p02}；${discovery}`
}

function groupLabel(group) {
  return ({
    direction_snapshot: "研究方向",
    paper_workspace: "论文工作区",
    personal_tags: "个人标签",
    discovery_candidates: "发现候选",
    agent_task_input: "Agent 输入快照",
    p02_workflow: "P02 研究闭环",
    discovery_workspace: "检索工作区",
  })[group] ?? "浏览器状态"
}

function kindLabel(kind) {
  return ({
    whole_document: "整份状态不同",
    unknown_paper: "目标论文库中没有该论文",
    capacity_limit: "超过现有容量限制",
    identity_body_mismatch: "同一候选身份的记录不同",
    snapshot_body_mismatch: "同一快照标识的记录不同",
    current_pointer: "当前快照指针不同",
    pointer_target_conflicted: "指针目标因快照冲突被排除",
  })[kind] ?? "不可自动合并"
}

function knownPaperIdsFromCurrent(current) {
  const known = new Set()
  const workspace = current.state.paper_workspace
  Object.keys(workspace.shelf).forEach((paperId) => known.add(paperId))
  Object.keys(workspace.personalReading).forEach((paperId) => known.add(paperId))
  if (workspace.selectedPaperId) known.add(workspace.selectedPaperId)
  for (const snapshot of current.state.agent_task_input.snapshots) {
    for (const paper of snapshot.papers) known.add(paper.paper_id)
  }
  return known
}

async function loadKnownPaperIds(windowRef, current) {
  const known = knownPaperIdsFromCurrent(current)
  try {
    if (typeof windowRef.fetch !== "function") return [...known].sort()
    const indexUrl = new URL("../../local_library_data/paper-index.json", windowRef.location.href)
    const response = await windowRef.fetch(indexUrl, { cache: "no-store", credentials: "same-origin" })
    if (!response?.ok) return [...known].sort()
    const index = await response.json()
    if (!isPlainObject(index) || ![2, 3].includes(index.version) || !Array.isArray(index.papers)) {
      return [...known].sort()
    }
    for (const paper of index.papers) {
      if (isPlainObject(paper)
        && typeof paper.paper_id === "string"
        && /^(?:[A-Za-z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|LIB-[A-F0-9]{12})$/u.test(paper.paper_id)) {
        known.add(paper.paper_id)
      }
    }
  } catch {
    // Transitional old-port pages intentionally have no public index route.
  }
  return [...known].sort()
}

function wireOperatorPage(documentRef, windowRef) {
  const elements = {
    root: documentRef.querySelector("#state-transfer-app"),
    origin: documentRef.querySelector("#state-transfer-origin"),
    exportButton: documentRef.querySelector("#state-transfer-export"),
    files: documentRef.querySelector("#state-transfer-files"),
    previewButton: documentRef.querySelector("#state-transfer-preview"),
    previewTitle: documentRef.querySelector("#state-transfer-preview-title"),
    bundles: documentRef.querySelector("#state-transfer-bundles"),
    conflicts: documentRef.querySelector("#state-transfer-conflicts"),
    exclusions: documentRef.querySelector("#state-transfer-exclusions"),
    confirmation: documentRef.querySelector("#state-transfer-confirmation"),
    confirm: documentRef.querySelector("#state-transfer-confirm"),
    applyButton: documentRef.querySelector("#state-transfer-apply"),
    status: documentRef.querySelector("#state-transfer-status"),
  }
  if (!elements.root || !elements.exportButton || !elements.files || !elements.previewButton
    || !elements.bundles || !elements.conflicts || !elements.exclusions || !elements.confirmation
    || !elements.confirm || !elements.applyButton || !elements.status) return

  const origin = windowRef.location?.origin
  if (elements.origin) elements.origin.textContent = ALLOWED_ORIGINS.includes(origin) ? origin : "不受支持的来源"
  let plan = null
  let applied = false
  let busy = false

  const beginBusy = () => {
    if (busy) return false
    busy = true
    setBusy(elements, true)
    return true
  }

  const endBusy = () => {
    busy = false
    setBusy(elements, false)
    if (applied || !plan) {
      elements.confirm.disabled = true
      for (const control of elements.conflicts.querySelectorAll?.("select") ?? []) control.disabled = true
    }
  }

  const selection = () => {
    if (!plan) return null
    const decisions = {}
    for (const conflict of plan.conflicts) {
      const select = elements.conflicts.querySelector?.(`[data-conflict-id="${conflict.id}"]`)
      if (!select?.value) return null
      if (select.value === "skip") decisions[conflict.id] = { action: "skip" }
      else if (select.value.startsWith("replace:")) {
        decisions[conflict.id] = { action: "replace", source_sha256: select.value.slice("replace:".length) }
      } else return null
    }
    return decisions
  }

  const updateApply = () => {
    elements.applyButton.disabled = applied || !plan || !elements.confirm.checked || selection() === null
  }

  const invalidatePlan = (message = "尚未生成可应用的合并预览。") => {
    plan = null
    elements.confirm.checked = false
    elements.confirm.disabled = true
    elements.applyButton.disabled = true
    elements.confirmation.textContent = message
    for (const control of elements.conflicts.querySelectorAll?.("select") ?? []) control.disabled = true
  }

  const renderPreview = (current, imports, nextPlan) => {
    elements.bundles.replaceChildren()
    for (const bundle of imports) {
      const card = documentRef.createElement("article")
      card.className = "state-transfer-bundle"
      card.append(
        createTextElement(documentRef, "h3", bundle.origin),
        createTextElement(documentRef, "p", countSummary(bundle.counts)),
        createTextElement(documentRef, "code", bundle.sha256),
      )
      elements.bundles.appendChild(card)
    }
    elements.conflicts.replaceChildren()
    for (const conflict of nextPlan.conflicts) {
      const row = documentRef.createElement("div")
      row.className = "state-transfer-conflict"
      row.appendChild(createTextElement(
        documentRef, "p", `${groupLabel(conflict.group)}：${kindLabel(conflict.kind)}（${conflict.identity}）`,
      ))
      const label = documentRef.createElement("label")
      label.textContent = "处理方式"
      const select = documentRef.createElement("select")
      select.dataset.conflictId = conflict.id
      select.setAttribute("data-conflict-id", conflict.id)
      const placeholder = documentRef.createElement("option")
      placeholder.value = ""
      placeholder.textContent = "请选择"
      select.appendChild(placeholder)
      const skip = documentRef.createElement("option")
      skip.value = "skip"
      skip.textContent = "保留当前状态"
      select.appendChild(skip)
      if (conflict.allowed_actions.includes("replace")) {
        for (const source of conflict.sources) {
          const option = documentRef.createElement("option")
          option.value = `replace:${source.sha256}`
          option.textContent = `替换为 ${source.origin}（${source.sha256.slice(0, 12)}）`
          select.appendChild(option)
        }
      }
      if (conflict.group === "discovery_workspace") select.value = "skip"
      select.addEventListener("change", updateApply)
      label.appendChild(select)
      row.appendChild(label)
      elements.conflicts.appendChild(row)
    }
    elements.exclusions.replaceChildren()
    for (const item of nextPlan.exclusions) {
      elements.exclusions.appendChild(createTextElement(
        documentRef, "li", `${groupLabel(item.group)}：${kindLabel(item.kind)}（${item.identity}，${item.source.origin}）`,
      ))
    }
    elements.confirmation.textContent = `将合并 ${imports.length} 个来源；需处理 ${nextPlan.conflicts.length} 个冲突；已排除 ${nextPlan.exclusions.length} 项。当前来源 ${current.origin}。`
    elements.confirm.checked = false
    elements.confirm.disabled = false
    plan = nextPlan
    updateApply()
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    for (const control of [elements.exportButton, elements.files, elements.previewButton, elements.confirm, elements.applyButton]) {
      control.disabled = true
    }
    focusStatus(elements, "此页只允许在三个指定的本地端口使用。", "error")
    return
  }

  elements.exportButton.addEventListener("click", async () => {
    if (!ALLOWED_ORIGINS.includes(origin) || !beginBusy()) return
    focusStatus(elements, "正在校验并导出…")
    try {
      const bundle = await exportStateBundle({ storage: windowRef.localStorage, originLabel: origin, exportedAt: new Date().toISOString() })
      const blob = new windowRef.Blob([JSON.stringify(bundle)], { type: "application/json" })
      const url = windowRef.URL.createObjectURL(blob)
      try {
        const anchor = documentRef.createElement("a")
        anchor.href = url
        anchor.download = "research-console-state-transfer.json"
        anchor.click()
      } finally {
        windowRef.URL.revokeObjectURL(url)
      }
      focusStatus(elements, "状态迁移文件已导出。", "success")
    } catch {
      focusStatus(elements, "导出失败：当前浏览器状态不可用。", "error")
    } finally {
      endBusy()
      updateApply()
    }
  })

  elements.files.addEventListener("change", () => {
    if (applied || busy) return
    invalidatePlan("所选文件已变化，请重新生成合并预览。")
  })

  elements.previewButton.addEventListener("click", async () => {
    if (!ALLOWED_ORIGINS.includes(origin) || applied || busy) return
    invalidatePlan()
    const files = [...(elements.files.files ?? [])]
    if (files.length < 1 || files.length > 3) {
      focusStatus(elements, "请选择一至三个 JSON 文件。", "error")
      return
    }
    const declaredSizes = files.map((file) => file?.size)
    if (declaredSizes.some((size) => !Number.isSafeInteger(size) || size < 0 || size > MAX_BUNDLE_BYTES)
      || declaredSizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_BYTES) {
      focusStatus(elements, "所选状态迁移文件的大小超出限制。", "error")
      return
    }
    if (!beginBusy()) return
    focusStatus(elements, "正在校验并生成合并预览…")
    try {
      const imports = []
      for (const file of files) imports.push(await validateStateBundle(await file.arrayBuffer()))
      const current = await exportStateBundle({ storage: windowRef.localStorage, originLabel: origin, exportedAt: new Date().toISOString() })
      const nextPlan = await previewStateMerge({
        current,
        bundles: imports,
        knownPaperIds: await loadKnownPaperIds(windowRef, current),
      })
      renderPreview(current, imports, nextPlan)
      focusStatus(elements, "预览已生成；请选择每个冲突的处理方式。", "success")
      elements.previewTitle?.focus?.()
    } catch {
      invalidatePlan()
      elements.bundles.replaceChildren()
      elements.conflicts.replaceChildren()
      elements.exclusions.replaceChildren()
      focusStatus(elements, "文件校验或合并预览失败。", "error")
    } finally {
      endBusy()
      updateApply()
    }
  })

  elements.confirm.addEventListener("change", updateApply)
  elements.applyButton.addEventListener("click", async () => {
    const decisions = selection()
    if (!plan || !elements.confirm.checked || !decisions || applied || !beginBusy()) return
    elements.applyButton.disabled = true
    focusStatus(elements, "正在应用并验证浏览器状态…")
    try {
      const result = await applyStateMerge({ storage: windowRef.localStorage, plan, decisions })
      if (result.status === "success") {
        applied = true
        focusStatus(elements, "状态迁移成功；本页不会再次应用。", "success")
      } else if (result.status === "apply_failed_rolled_back") {
        invalidatePlan()
        focusStatus(elements, "应用失败，已验证恢复原状态；请重新生成预览。", "error")
      } else {
        applied = true
        focusStatus(elements, "应用与恢复均未能验证，请停止操作并人工检查。", "error")
      }
    } catch {
      invalidatePlan()
      focusStatus(elements, "状态已变化或计划无效，请重新载入后预览。", "error")
    } finally {
      endBusy()
      if (applied) {
        elements.files.disabled = true
        elements.previewButton.disabled = true
        elements.confirm.disabled = true
        for (const control of elements.conflicts.querySelectorAll?.("select") ?? []) control.disabled = true
      } else if (!plan) {
        elements.confirm.disabled = true
        for (const control of elements.conflicts.querySelectorAll?.("select") ?? []) control.disabled = true
      }
      updateApply()
    }
  })
  updateApply()
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => wireOperatorPage(document, window), { once: true })
  } else {
    wireOperatorPage(document, window)
  }
}
