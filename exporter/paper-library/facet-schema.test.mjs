import test from "node:test"
import assert from "node:assert/strict"
import {
  FACET_GROUPS,
  FACET_PATHS,
  FACET_STATE_VALUES,
  createEmptyFacets,
  flattenFacetValues,
  serializeFacetSchema,
  validateFacetStates,
  validatePaperFacets,
} from "./facet-schema.mjs"

test("facet states are sparse and use only the three approved meanings", () => {
  assert.deepEqual(FACET_STATE_VALUES, ["unrecorded", "not_applicable", "pending_verification"])
  const facets = createEmptyFacets()
  const states = {
    applications: "not_applicable",
    results: "pending_verification",
    "network.time": "unrecorded",
  }
  assert.equal(validateFacetStates(facets, states), states)
})

test("facet states reject unknown paths, unknown states, and non-objects", () => {
  const facets = createEmptyFacets()
  assert.throws(() => validateFacetStates(facets, []), /facet_states 必须是对象/u)
  assert.throws(() => validateFacetStates(facets, { "research.unknown": "unrecorded" }), /facet_states 路径无效/u)
  assert.throws(() => validateFacetStates(facets, { results: "waiting" }), /facet_states 状态无效/u)
  const hidden = {}
  Object.defineProperty(hidden, "private", { value: "unrecorded", enumerable: false })
  assert.throws(() => validateFacetStates(facets, hidden), /facet_states 路径无效/u)
})

test("a populated facet cannot also carry an empty-value state", () => {
  const facets = createEmptyFacets()
  facets.results = ["线性收敛"]
  assert.throws(
    () => validateFacetStates(facets, { results: "pending_verification" }),
    /facet_states 不能覆盖已有分面值/u,
  )
})

test("serialized facet schema announces empty-state support", () => {
  assert.equal(serializeFacetSchema().version, 2)
})

test("facet schema exposes unique orthogonal paths", () => {
  assert.equal(new Set(FACET_PATHS).size, FACET_PATHS.length)
  assert.deepEqual(FACET_PATHS, [
    "research.domain", "research.mode", "objective",
    "constraints.scope", "constraints.form", "constraints.consistency",
    "oracle.information", "oracle.estimation",
    "methods.framework", "methods.coordination", "methods.operator",
    "network.direction", "network.time", "network.balance", "network.mixing",
    "privacy_robustness", "results", "applications",
  ])
  assert.equal(new Set(FACET_GROUPS.flatMap(({ values }) => values)).size,
    FACET_GROUPS.flatMap(({ values }) => values).length)
})

test("empty facets has a stable nested object shape", () => {
  assert.deepEqual(createEmptyFacets(), {
    research: { domain: [], mode: [] },
    objective: [],
    constraints: { scope: [], form: [], consistency: [] },
    oracle: { information: [], estimation: [] },
    methods: { framework: [], coordination: [], operator: [] },
    network: { direction: [], time: [], balance: [], mixing: [] },
    privacy_robustness: [],
    results: [],
    applications: [],
  })
})

test("facet values must come from the controlled vocabulary", () => {
  const facets = createEmptyFacets()
  facets.constraints.scope = ["耦合约束对偶分解"]
  assert.throws(() => validatePaperFacets(facets), /分面值不在受控词表/u)
})

test("flattenFacetValues returns every atomic value once", () => {
  const facets = createEmptyFacets()
  facets.constraints.scope = ["耦合约束"]
  facets.constraints.form = ["不等式约束"]
  facets.methods.framework = ["对偶分解"]
  assert.deepEqual(flattenFacetValues(facets), ["耦合约束", "不等式约束", "对偶分解"])
})

test("facet validation rejects unknown fields and composite legacy labels", () => {
  const unknown = createEmptyFacets()
  unknown.legacy = []
  assert.throws(() => validatePaperFacets(unknown), /未知分面字段/u)

  const nestedUnknown = createEmptyFacets()
  nestedUnknown.research.extra = []
  assert.throws(() => validatePaperFacets(nestedUnknown), /未知分面字段/u)

  const composite = createEmptyFacets()
  composite.methods.framework = ["有向网络-梯度跟踪"]
  assert.throws(() => validatePaperFacets(composite), /分面值不在受控词表/u)
})

test("facet validation rejects malformed arrays, duplicates, and whitespace", () => {
  const malformed = createEmptyFacets()
  malformed.objective = "凸"
  assert.throws(() => validatePaperFacets(malformed), /分面字段必须是字符串数组/u)

  const duplicate = createEmptyFacets()
  duplicate.objective = ["凸", "凸"]
  assert.throws(() => validatePaperFacets(duplicate), /分面数组不能重复/u)

  const whitespace = createEmptyFacets()
  whitespace.objective = [" 凸"]
  assert.throws(() => validatePaperFacets(whitespace), /分面值不能包含首尾空白/u)
})

test("facet validation returns the original object and schema serialization is data-only", () => {
  const facets = createEmptyFacets()
  facets.research.domain = ["分布式优化"]
  assert.equal(validatePaperFacets(facets), facets)

  const serialized = serializeFacetSchema()
  assert.deepEqual(Object.keys(serialized), ["version", "groups"])
  assert.equal(serialized.version, 2)
  assert.deepEqual(serialized.groups, FACET_GROUPS)
  assert.notEqual(serialized.groups, FACET_GROUPS)
  assert.notEqual(serialized.groups[0], FACET_GROUPS[0])
  assert.notEqual(serialized.groups[0].values, FACET_GROUPS[0].values)
})

test("facet validation requires own root fields rather than inherited fields", () => {
  const inherited = Object.create(createEmptyFacets())
  assert.throws(() => validatePaperFacets(inherited), /分面字段缺失/u)
})

test("facet validation rejects non-enumerable unknown fields", () => {
  const facets = createEmptyFacets()
  Object.defineProperty(facets, "hidden", { value: [], enumerable: false })
  assert.throws(() => validatePaperFacets(facets), /未知分面字段/u)
})
