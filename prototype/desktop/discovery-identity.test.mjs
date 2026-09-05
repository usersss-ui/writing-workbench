import test from "node:test"
import assert from "node:assert/strict"
import { recordInput } from "./discovery-test-fixtures.mjs"
import { normalizeDiscoveryRecord } from "./discovery-record.mjs"
import { mergeDiscoveryRecords, splitDiscoveryResult } from "./discovery-identity.mjs"

function record(id, bibliography = {}, provenance = {}, extra = {}) {
  const input = recordInput({ record_id: id, ...extra })
  return normalizeDiscoveryRecord({ ...input,
    bibliography: { ...input.bibliography, ...bibliography },
    provenance: { ...input.provenance, ...provenance },
  })
}

function ids() {
  let next = 0
  return () => `result-${++next}`
}

function merge(incoming, state = { records: [], results: [] }, idFactory = ids()) {
  return mergeDiscoveryRecords({ ...state, incoming, idFactory })
}

for (const title of ['Not Reported', '时变有向网络上的分布式在线优化方法']) {
  test(`same DOI with non-comparable title ${title} retains a clear identity on initial and late merge`, () => {
    const factory = ids(), a = record('a'), b = record('b', { title })
    assert.equal(merge([a, b]).results.length, 1)
    const initial = merge([a], undefined, factory)
    const next = merge([b], initial, factory)
    assert.equal(next.results.length, 1)
    assert.equal(next.results[0].result_id, initial.results[0].result_id)
    assert.equal(next.results[0].identity_status, 'clear')
    assert.deepEqual(next.records, [a, b])
  })
}
for (const title of ['Correction: Synthetic distributed optimization study',
  'Version 2 of Synthetic distributed optimization study', '[Preprint] Synthetic distributed optimization study']) {
  test(`explicit publication label blocks DOI merge: ${title}`, () => {
    const factory = ids(), initial = merge([record('a'), record('b')], undefined, factory)
    const next = merge([record('c', { title, work_type: 'article' })], initial, factory)
    assert.equal(next.results.length, 2)
    assert.deepEqual(next.results[0].record_ids, ['a', 'b'])
    assert.ok(next.results.every(result => result.identity_status === 'conflict' && result.conflicts.some(clue => clue.startsWith('title_mismatch:'))))
    assert.equal(next.records.length, 3)
  })
}
test('ordinary error correction subtitles are incomplete title evidence rather than publication labels', () => {
  const state = merge([record('a', { title: 'Distributed optimization' }),
    record('b', { title: 'Distributed optimization: error correction over unreliable links' })])
  assert.equal(state.results.length, 1)
  assert.equal(state.results[0].identity_status, 'clear')
})

test("same normalized DOI retains both original sources in one exact Result", () => {
  const a = record("r-1", { doi: "https://doi.org/10.1234/FIXTURE.1" })
  const b = record("r-2")
  const state = merge([a, b])
  assert.deepEqual(state.records, [a, b])
  assert.deepEqual(state.results, [{ result_id: "result-1", record_ids: ["r-1", "r-2"],
    preferred_record_id: "r-1", alias_ids: [], identity_status: "clear", conflicts: [] }])
  assert.deepEqual(state.changed_result_ids, ["result-1"])
})

test("provider ID is identity evidence only when both sources are API verified by the same provider", () => {
  const a = record("a", { doi: null }, { provider: "openalex", verification: "api", method: "api" }, { provider_id: "W1" })
  const b = record("b", { doi: null }, { provider: "openalex", verification: "api", method: "import" }, { provider_id: "W1" })
  assert.equal(merge([a, b]).results.length, 1)
  for (const provenance of [{ provider: "scholar", verification: "api" }, { provider: "openalex", verification: "declared" }]) {
    const c = record("c", { doi: null }, provenance, { provider_id: "W1" })
    assert.equal(merge([a, c]).results.length, 2)
  }
})

test("different nonempty DOIs cannot merge through a shared verified provider ID", () => {
  const provenance = { provider: "openalex", verification: "api", method: "api" }
  const state = merge([record("a", {}, provenance, { provider_id: "W1" }),
    record("b", { doi: "10.1234/different" }, provenance, { provider_id: "W1" })])
  assert.equal(state.results.length, 2)
  assert.ok(state.results.every(result => result.identity_status === "conflict" && result.conflicts.length > 0))
})

test("an unrelated title sharing a DOI is kept separate and flags both identities", () => {
  const state = merge([record("a"), record("b", { title: "Marine plankton evolution in polar waters" })])
  assert.equal(state.results.length, 2)
  assert.ok(state.results.every(result => result.identity_status === "conflict"))
  assert.equal(state.records.length, 2)
})

test("a shortened title sharing a DOI remains compatible with its longer full title", () => {
  const short = record("a", { title: "Distributed optimization over networks" })
  const full = record("b", { title: "Distributed optimization over networks with communication delays and packet losses" })
  const state = merge([short, full])
  assert.equal(state.results.length, 1)
  assert.deepEqual(state.results[0].record_ids, ["a", "b"])
  assert.equal(state.results[0].identity_status, "clear")
})

test("abbreviated and full journal labels without contradictory identifiers do not split a DOI", () => {
  const journal = { title: "IEEE Trans. Autom. Control", source_id: null, issns: [], source_type: "journal" }
  const state = merge([record("a", { journal }),
    record("b", { journal: { ...journal, title: "IEEE Transactions on Automatic Control" } })])
  assert.equal(state.results.length, 1)
  assert.deepEqual(state.results[0].record_ids, ["a", "b"])
  assert.equal(state.results[0].identity_status, "clear")
})

test("explicit year, publication type and journal conflicts prevent merging", () => {
  const journal = { title: "Synthetic Journal A", source_id: null, issns: ["1234-5678"], source_type: "journal" }
  const a = record("a", { work_type: "article", journal })
  const variants = [{ year: 2023 }, { work_type: "preprint" },
    { journal: { ...journal, title: "Synthetic Journal B", issns: ["8765-4321"] } }]
  for (const variant of variants) {
    const state = merge([a, record("b", { work_type: "article", journal, ...variant })])
    assert.equal(state.results.length, 2)
    assert.ok(state.results.every(result => result.identity_status === "conflict"))
  }
})

test("a late contradictory source marks the existing merged identity without losing A or B", () => {
  const factory = ids()
  const previous = merge([record("a"), record("b")], undefined, factory)
  const state = merge([record("c", { year: 2025 })], previous, factory)
  assert.deepEqual(state.results[0].record_ids, ["a", "b"])
  assert.equal(state.results[0].result_id, "result-1")
  assert.equal(state.results[0].identity_status, "conflict")
  assert.deepEqual(state.changed_result_ids, ["result-1", "result-2"])
  assert.equal(state.records.length, 3)
})

test("similar titles without a strong identifier yield clues and never merge transitively", () => {
  const state = merge([
    record("a", { doi: null, title: "Distributed optimization over changing networks" }),
    record("b", { doi: null, title: "Distributed optimization over changing networks with delays" }),
    record("c", { doi: null, title: "Optimization over changing networks with delays" }),
  ])
  assert.equal(state.results.length, 3)
  assert.ok(state.results.every(result => result.identity_status === "conflict" && result.conflicts.length > 0))
})

test("preferred source is stable under response ordering and retains a retracted original", () => {
  const retracted = record("a", {}, {}, { retraction: { state: "retracted", source_url: "https://example.org/retraction", checked_at: "2026-09-05T00:00:00.000Z" } })
  const verified = record("z", {}, { verification: "api", provider: "openalex", method: "api" })
  const complete = record("b", { abstract: "Additional synthetic abstract" }, { verification: "api", provider: "openalex", method: "api" })
  for (const incoming of [[retracted, verified, complete], [complete, verified, retracted]]) {
    const state = merge(incoming)
    assert.equal(state.results[0].preferred_record_id, "b")
    assert.equal(state.records.find(item => item.record_id === "a").retraction.state, "retracted")
  }
})

test("identical repeated pages are a no-op while a changed duplicate record ID never overwrites its source", () => {
  const factory = ids()
  const previous = merge([record("a")], undefined, factory)
  const repeated = merge([structuredClone(previous.records[0])], previous, factory)
  assert.deepEqual(repeated.records, previous.records)
  assert.deepEqual(repeated.results, previous.results)
  assert.deepEqual(repeated.changed_result_ids, [])
  const changed = merge([record("a", { year: 2022 })], previous, factory)
  assert.deepEqual(changed.records, previous.records)
  assert.equal(changed.results[0].identity_status, "conflict")
  assert.deepEqual(changed.changed_result_ids, ["result-1"])
})

test("merging existing compatible identities keeps a canonical ID and all alias references", () => {
  const records = [record("a"), record("b")]
  const results = [
    { result_id: "keep", record_ids: ["a"], preferred_record_id: "a", alias_ids: ["older"], identity_status: "clear", conflicts: [] },
    { result_id: "retire", record_ids: ["b"], preferred_record_id: "b", alias_ids: ["oldest"], identity_status: "clear", conflicts: [] },
  ]
  const state = merge([record("c")], { records, results })
  assert.equal(state.results.length, 1)
  assert.equal(state.results[0].result_id, "keep")
  assert.deepEqual(new Set(state.results[0].alias_ids), new Set(["older", "retire", "oldest"]))
  assert.deepEqual(state.results[0].record_ids, ["a", "b", "c"])
  assert.ok(state.changed_result_ids.includes("keep") && state.changed_result_ids.includes("retire"))
})

test("a missing DOI cannot bridge two incompatible DOI clusters", () => {
  const provenance = { provider: "openalex", method: "api", verification: "api" }
  const extra = { provider_id: "W1" }
  const state = merge([record("a", {}, provenance, extra), record("b", { doi: null }, provenance, extra),
    record("c", { doi: "10.1234/other" }, provenance, extra)])
  assert.equal(state.results.length, 2)
  assert.ok(state.results.every(result => result.identity_status === "conflict"))
  assert.ok(!state.results.some(result => result.record_ids.includes("a") && result.record_ids.includes("c")))
})

test("reordering a page cannot change source grouping or preferred IDs", () => {
  const provenance = { provider: "openalex", method: "api", verification: "api" }
  const extra = { provider_id: "W1" }
  const a = record("a", {}, provenance, extra)
  const b = record("b", { doi: null }, provenance, extra)
  const c = record("c", { doi: "10.1234/other" }, provenance, extra)
  const forward = merge([a, b, c])
  const reverse = merge([c, b, a])
  assert.deepEqual(reverse.results, forward.results)
})

test("a sparse record matching two already contradictory clusters is kept separate", () => {
  const provenance = { provider: "openalex", method: "api", verification: "api" }
  const extra = { provider_id: "W1" }
  const factory = ids()
  const state = merge([record("a", {}, provenance, extra), record("c", { doi: "10.1234/other" }, provenance, extra)], undefined, factory)
  const next = merge([record("b", { doi: null }, provenance, extra)], state, factory)
  assert.deepEqual(next.results.map(result => result.record_ids), [["a"], ["c"], ["b"]])
  assert.ok(next.results.every(result => result.identity_status === "conflict"))
  assert.deepEqual(next.changed_result_ids, ["result-1", "result-2", "result-3"])
})

test("split accepts an alias, preserves the preferred group's ID, and invalidates all old references", () => {
  const records = [record("a"), record("b"), record("c", { year: 2025 })]
  const results = [{ result_id: "keep", record_ids: ["a", "b", "c"], preferred_record_id: "a",
    alias_ids: ["old"], identity_status: "conflict", conflicts: ["earlier conflict"] }]
  const state = splitDiscoveryResult({ records, results, result_id: "old", groups: [["c"], ["a", "b"]], idFactory: ids() })
  assert.deepEqual(state.invalidated_result_ids, ["keep", "old"])
  const kept = state.results.find(result => result.result_id === "keep")
  assert.deepEqual(kept.record_ids, ["a", "b"])
  assert.deepEqual(kept.alias_ids, ["old"])
  assert.ok(state.results.every(result => result.identity_status === "clear" && result.conflicts.length === 0))
  assert.equal(state.records.length, 3)
  assert.deepEqual(Object.keys(state).sort(), ["invalidated_result_ids", "records", "results"])
})

test("split rejects incomplete, overlapping, empty and unknown partitions", () => {
  const state = merge([record("a"), record("b")])
  for (const groups of [[["a"]], [["a"], ["a", "b"]], [["a"], []], [["a"], ["b", "missing"]]]) {
    assert.throws(() => splitDiscoveryResult({ ...state, result_id: "result-1", groups, idFactory: ids() }), TypeError)
  }
  assert.throws(() => splitDiscoveryResult({ ...state, result_id: "missing", groups: [["a"], ["b"]], idFactory: ids() }), TypeError)
})

test("split retains contradictions inside a group and leaves an unrelated result unchanged", () => {
  const records = [record("a"), record("b", { year: 2023 }), record("c"), record("d", { doi: null, title: "Marine plankton" })]
  const results = [
    { result_id: "old", record_ids: ["a", "b", "c"], preferred_record_id: "a", alias_ids: [], identity_status: "conflict", conflicts: ["prior"] },
    { result_id: "unrelated", record_ids: ["d"], preferred_record_id: "d", alias_ids: [], identity_status: "clear", conflicts: [] },
  ]
  const state = splitDiscoveryResult({ records, results, result_id: "old", groups: [["a", "b"], ["c"]], idFactory: ids() })
  assert.equal(state.results.find(result => result.result_id === "old").identity_status, "conflict")
  assert.equal(state.results.find(result => result.result_id === "result-1").identity_status, "clear")
  assert.deepEqual(state.results.find(result => result.result_id === "unrelated"), results[1])
})

test("generated IDs cannot replace a canonical result or an alias", () => {
  const state = { records: [record("a"), record("b")], results: [{ result_id: "keep", record_ids: ["a", "b"],
    preferred_record_id: "a", alias_ids: ["old"], identity_status: "clear", conflicts: [] }] }
  for (const id of ["keep", "old", ""]) {
    assert.throws(() => merge([record("c", { doi: null, title: "Marine plankton" })], state, () => id), TypeError)
    assert.throws(() => splitDiscoveryResult({ ...state, result_id: "keep", groups: [["a"], ["b"]], idFactory: () => id }), TypeError)
  }
})

test("merge and split never mutate input records, result arrays or aliases", () => {
  const source = merge([record("a"), record("b")])
  const snapshot = structuredClone(source)
  const incoming = [record("c")]
  const incomingSnapshot = structuredClone(incoming)
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
  }
  freeze(source)
  freeze(incoming)
  merge(incoming, source)
  splitDiscoveryResult({ ...source, result_id: "result-1", groups: [["a"], ["b"]], idFactory: () => "new" })
  assert.deepEqual(source, snapshot)
  assert.deepEqual(incoming, incomingSnapshot)
})
