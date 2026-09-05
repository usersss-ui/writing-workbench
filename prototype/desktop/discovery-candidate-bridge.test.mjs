import test from "node:test"
import assert from "node:assert/strict"
import { recordInput } from "./discovery-test-fixtures.mjs"
import * as openAlex from "./openalex-search.mjs"

const bridge = await import("./discovery-candidate-bridge.mjs").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {}
  throw error
})
const resultInput = () => ({ result_id: "result-1", record_ids: ["r-1"], preferred_record_id: "r-1", alias_ids: [], identity_status: "clear", conflicts: [] })
const officialWork = (patch = {}) => ({
  id: "https://openalex.org/W123", doi: "10.1234/fixture.1", title: "Synthetic distributed optimization study",
  publication_year: 2024, authorships: [{ author: { display_name: "Real API Author" } }],
  type: "article", is_retracted: false, ...patch,
})
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

test('conversion accepts owner-valid astral result IDs at the code-point boundary and rejects excessive raw IDs', async () => {
  for (const [result_id, status] of [['😀'.repeat(2048), 'verified'], ['😀'.repeat(2049), 'unverified'], ['a'.repeat(2048) + ' ', 'unverified']]) {
    assert.equal((await convert({ result: { ...resultInput(), result_id } })).status, status)
  }
  const recordId = '😀'.repeat(2048)
  assert.equal((await convert({ result: { ...resultInput(), record_ids: [recordId], preferred_record_id: recordId, alias_ids: ['𐐀'.repeat(2048)] }, records: [recordInput({ record_id: recordId })] })).status, 'verified')
})
async function convert(options = {}) {
  assert.equal(typeof bridge.prepareExternalCandidateConversion, "function")
  return bridge.prepareExternalCandidateConversion({ result: resultInput(), records: [recordInput()], fetchImpl: async () => response(officialWork()), ...options })
}

test("conversion returns only official response metadata and real verified capability without changing inputs", async () => {
  const result = resultInput()
  const records = [recordInput({ provider_id: "W999" })]
  records[0].provenance.verification = "api"
  const before = structuredClone({ result, records })
  const output = await convert({ result, records })
  assert.deepEqual(Object.keys(output).sort(), ["status", "token", "work"])
  assert.equal(output.status, "verified")
  assert.equal(output.work.paperId, "W123")
  assert.deepEqual(output.work.authors, ["Real API Author"])
  assert.equal(openAlex.readVerifiedOpenAlexWork(output.token).work.paperId, "W123")
  assert.deepEqual({ result, records }, before)
})

test("conversion refuses conflicted, incomplete, missing DOI and nonunique DOI identities before fetching", async () => {
  const missingDoi = recordInput()
  missingDoi.bibliography.doi = null
  const second = recordInput({ record_id: "r-2" })
  second.bibliography.doi = "10.1234/other"
  let calls = 0
  const fetchImpl = async () => { calls += 1; return response(officialWork()) }
  for (const [options, status] of [
    [{ result: { ...resultInput(), identity_status: "conflict", conflicts: ["doi_conflict"] } }, "conflict"],
    [{ result: { ...resultInput(), conflicts: ["title_conflict"] } }, "conflict"],
    [{ records: [] }, "unverified"],
    [{ records: [missingDoi] }, "unverified"],
    [{ result: { ...resultInput(), preferred_record_id: "missing" } }, "unverified"],
    [{ result: { ...resultInput(), result_id: null } }, "unverified"],
    [{ result: { ...resultInput(), alias_ids: null } }, "unverified"],
    [{ result: { ...resultInput(), alias_ids: ["result-1"] } }, "unverified"],
    [{ result: { ...resultInput(), extra: true } }, "unverified"],
    [{ result: { ...resultInput(), record_ids: ["r-1", "r-2"] }, records: [recordInput(), second] }, "conflict"],
  ]) {
    const outcome = await convert({ ...options, fetchImpl })
    assert.equal(outcome.status, status)
    assert.equal(typeof outcome.reason, "string")
    assert.equal("token" in outcome, false)
  }
  assert.equal(calls, 0)
})

test("conversion checks every original title and type and rejects retraction or DOI mismatches", async () => {
  for (const patch of [
    { title: "Marine ecology of deep sea organisms" }, { title: "Synthetic distributed optimization study: a correction" },
    { type: "preprint" }, { is_retracted: true }, { doi: "10.1234/other" }, { doi: null },
  ]) {
    const original = recordInput()
    original.bibliography.work_type = "article"
    const outcome = await convert({ records: [original], fetchImpl: async () => response(officialWork(patch)) })
    assert.equal(outcome.status, "conflict")
    assert.equal("token" in outcome, false)
  }
  const second = recordInput({ record_id: "r-2" })
  second.bibliography.title = "A different paper entirely"
  assert.equal((await convert({ result: { ...resultInput(), record_ids: ["r-1", "r-2"] }, records: [recordInput(), second] })).status, "conflict")
  const originalRetraction = recordInput({ retraction: { state: "retracted", source_url: null, checked_at: null } })
  assert.equal((await convert({ records: [originalRetraction] })).status, "conflict")
})

test("conversion accepts harmless title typography and missing source fields without inventing metadata", async () => {
  const outcome = await convert({ fetchImpl: async () => response(officialWork({ title: "SYNTHETIC distributed-optimization study.", type: null })) })
  assert.equal(outcome.status, "verified")
  assert.equal(openAlex.readVerifiedOpenAlexWork(outcome.token).bibliography.journal.source_id, null)
})

for (const [name, originalTitle, apiTitle] of [
  ["Chinese to English title", "面向时变有向网络的分布式优化算法研究", "Distributed optimization over time varying directed networks"],
  ["English to Chinese title", "Distributed optimization over time varying directed networks", "面向时变有向网络的分布式优化算法研究"],
  ["ordinary correction subject", "Distributed optimization: error correction over unreliable links", "Distributed optimization"],
  ["ordinary preprint subject", "Distributed optimization: preprint dissemination in networked control", "Distributed optimization"],
  ["ordinary version subject", "Distributed optimization: version 2 of a consensus protocol", "Distributed optimization"],
  ["missing API title", "Synthetic distributed optimization study", null],
]) {
  test(`same DOI conversion accepts ${name} without replacing API metadata`, async () => {
    const original = recordInput()
    original.bibliography.title = originalTitle
    const outcome = await convert({ records: [original], fetchImpl: async () => response(officialWork({ title: apiTitle })) })
    assert.equal(outcome.status, "verified")
    assert.equal(outcome.work.title, apiTitle ?? "Not Reported")
    assert.equal(openAlex.readVerifiedOpenAlexWork(outcome.token).work.doi, "10.1234/fixture.1")
    assert.equal(original.bibliography.title, originalTitle)
  })
}

test("same DOI still rejects explicit publication labels and comparable unrelated titles", async () => {
  for (const title of [
    "Correction: Synthetic distributed optimization study",
    "Retraction of: Synthetic distributed optimization study",
    "Preprint: Synthetic distributed optimization study",
    "Synthetic distributed optimization study: a correction",
    "Synthetic distributed optimization study [preprint]",
    "Synthetic distributed optimization study (version 2)",
    "Marine ecology of deep sea organisms",
  ]) {
    const outcome = await convert({ fetchImpl: async () => response(officialWork({ title })) })
    assert.deepEqual(outcome, { status: "conflict", reason: "title_mismatch" }, title)
  }
})

for (const prefix of ["[Preprint]", "Version 2 of"]) {
  for (const side of ["original", "API"]) {
    test(`same DOI rejects publication prefix ${prefix} on the ${side} title`, async () => {
      const original = recordInput()
      const baseTitle = original.bibliography.title
      const labelledTitle = `${prefix} ${baseTitle}`
      if (side === "original") original.bibliography.title = labelledTitle
      const outcome = await convert({ records: [original], fetchImpl: async () => response(officialWork({
        title: side === "API" ? labelledTitle : baseTitle,
      })) })
      assert.deepEqual(outcome, { status: "conflict", reason: "title_mismatch" })
    })
  }
}

test("conversion returns unverified for 404 and invalid response but propagates retryable failures and abort", async () => {
  for (const [body, status] of [[null, 404], [officialWork({ id: "W123" }), 200]]) {
    assert.equal((await convert({ fetchImpl: async () => response(body, status) })).status, "unverified")
  }
  for (const fetchImpl of [async () => response(null, 429), async () => { throw new Error("offline") }]) {
    await assert.rejects(() => convert({ fetchImpl }), error => error.retryable === true)
  }
  const abort = new DOMException("cancelled", "AbortError")
  await assert.rejects(() => convert({ fetchImpl: async () => { throw abort } }), error => error === abort)
})
