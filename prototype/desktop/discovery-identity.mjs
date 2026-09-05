import { isValidDiscoveryRecord, normalizeDiscoveryRecord } from "./discovery-record.mjs"
import { discoveryTitleConflict } from "./bibliography-normalization.mjs"

const RESULT_KEYS = ["result_id", "record_ids", "preferred_record_id", "alias_ids", "identity_status", "conflicts"]
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0
const unique = values => [...new Set(values)]
const validId = value => typeof value === "string" && value.length > 0 && value === value.trim()

function fail(label) {
  throw new TypeError(`${label} 无效`)
}

function readRecords(records) {
  if (!Array.isArray(records)) fail("来源记录列表")
  return records.map(record => {
    if (!isValidDiscoveryRecord(record)) fail("来源记录")
    return normalizeDiscoveryRecord(record)
  })
}

function readState(records, results) {
  const copiedRecords = readRecords(records)
  const byId = new Map(copiedRecords.map(record => [record.record_id, record]))
  if (byId.size !== copiedRecords.length || !Array.isArray(results)) fail("身份状态")
  const usedIds = new Set()
  const ownedRecords = new Set()
  const copiedResults = results.map(result => {
    if (!result || Object.getPrototypeOf(result) !== Object.prototype ||
      Object.keys(result).length !== RESULT_KEYS.length || !RESULT_KEYS.every(key => Object.hasOwn(result, key)) ||
      !validId(result.result_id) || !Array.isArray(result.record_ids) || !result.record_ids.length ||
      !Array.isArray(result.alias_ids) || !Array.isArray(result.conflicts) ||
      !result.conflicts.every(item => typeof item === "string") ||
      !["clear", "conflict"].includes(result.identity_status) ||
      !result.record_ids.includes(result.preferred_record_id)) fail("汇总结果")
    for (const id of [result.result_id, ...result.alias_ids]) {
      if (!validId(id) || usedIds.has(id)) fail("结果 ID")
      usedIds.add(id)
    }
    for (const id of result.record_ids) {
      if (!byId.has(id) || ownedRecords.has(id)) fail("来源记录引用")
      ownedRecords.add(id)
    }
    return { result_id: result.result_id, record_ids: [...result.record_ids],
      preferred_record_id: result.preferred_record_id, alias_ids: [...result.alias_ids],
      identity_status: result.identity_status, conflicts: [...result.conflicts] }
  })
  return { records: copiedRecords, results: copiedResults, byId, usedIds, ownedRecords }
}

function nextId(idFactory, usedIds) {
  if (typeof idFactory !== "function") fail("ID 生成器")
  const id = idFactory()
  if (!validId(id) || usedIds.has(id)) fail("新结果 ID")
  usedIds.add(id)
  return id
}

function titleText(value) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim()
}

function titleOverlap(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  // Bigrams support both spaced titles and Chinese titles.
  const grams = text => {
    const characters = Array.from(text)
    return new Set(characters.slice(1).map((character, index) => characters[index] + character))
  }
  const ag = grams(a)
  const bg = grams(b)
  const common = [...ag].filter(gram => bg.has(gram)).length
  return ag.size + bg.size ? 2 * common / (ag.size + bg.size) : 0
}

function similarTitles(left, right) {
  return titleOverlap(titleText(left), titleText(right)) >= 0.7
}

function sameVerifiedProviderId(a, b) {
  return a.provenance.verification === "api" && b.provenance.verification === "api" &&
    a.provider_id !== null && a.provider_id === b.provider_id && a.provenance.provider === b.provenance.provider
}

function relation(a, b) {
  const doiA = a.bibliography.doi
  const doiB = b.bibliography.doi
  const sameDoi = doiA !== null && doiA === doiB
  const sameProviderId = sameVerifiedProviderId(a, b)
  const similar = similarTitles(a.bibliography.title, b.bibliography.title)
  return { strong: sameDoi || ((!doiA || !doiB) && sameProviderId),
    candidate: sameDoi || sameProviderId || similar }
}

function metadataConflicts(a, b) {
  const left = a.bibliography
  const right = b.bibliography
  const reasons = []
  if (left.doi && right.doi && left.doi !== right.doi) reasons.push("doi_mismatch")
  if (left.year !== null && right.year !== null && left.year !== right.year) reasons.push("year_mismatch")
  if (left.work_type && right.work_type && left.work_type !== right.work_type) reasons.push("publication_type_mismatch")
  if (discoveryTitleConflict(left.title, right.title)) reasons.push("title_mismatch")
  const j = left.journal
  const k = right.journal
  const sharedIssn = j.issns.some(issn => k.issns.includes(issn))
  if ((j.issns.length && k.issns.length && !sharedIssn) ||
    (j.source_type && k.source_type && j.source_type !== k.source_type) ||
    (a.provenance.provider === b.provenance.provider && j.source_id && k.source_id && j.source_id !== k.source_id)) {
    reasons.push("journal_mismatch")
  }
  const pair = [a.record_id, b.record_id].sort(compareIds)
  return reasons.map(reason => `${reason}:${JSON.stringify(pair)}`)
}

function markConflict(result, clues) {
  if (!clues.length) return
  result.conflicts = unique([...result.conflicts, ...clues]).sort(compareIds)
  result.identity_status = "conflict"
}

function completeness(record) {
  const bibliography = record.bibliography
  return Object.values(bibliography).filter(value => value !== null && !Array.isArray(value) && typeof value !== "object").length +
    Number(bibliography.authors.length > 0) + Object.values(bibliography.journal).filter(value => value !== null && (!Array.isArray(value) || value.length > 0)).length
}

function preferred(recordIds, byId) {
  const trust = { api: 3, user: 2, declared: 1 }
  return [...recordIds].sort((a, b) => {
    const left = byId.get(a)
    const right = byId.get(b)
    return trust[right.provenance.verification] - trust[left.provenance.verification] ||
      completeness(right) - completeness(left) || compareIds(a, b)
  })[0]
}

function resultFor(resultId, recordIds, byId, aliasIds = []) {
  return { result_id: resultId, record_ids: [...recordIds].sort(compareIds),
    preferred_record_id: preferred(recordIds, byId), alias_ids: [...aliasIds], identity_status: "clear", conflicts: [] }
}

function withinGroupConflicts(recordIds, byId) {
  const clues = []
  for (let i = 0; i < recordIds.length; i += 1) {
    for (let j = i + 1; j < recordIds.length; j += 1) {
      clues.push(...metadataConflicts(byId.get(recordIds[i]), byId.get(recordIds[j])))
    }
  }
  return clues
}

function canCombine(candidates, record, byId, checkedGroups) {
  if (!candidates.length) return false
  for (const candidate of candidates) {
    if (!checkedGroups.has(candidate)) {
      checkedGroups.set(candidate, withinGroupConflicts(candidate.record_ids, byId).length === 0)
    }
    if (!checkedGroups.get(candidate)) return false
  }
  const groups = [...candidates.map(result => result.record_ids), [record.record_id]]
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      for (const a of groups[i]) {
        for (const b of groups[j]) {
          if (metadataConflicts(byId.get(a), byId.get(b)).length) return false
        }
      }
    }
  }
  return true
}

export function mergeDiscoveryRecords({ records, results, incoming, idFactory }) {
  const state = readState(records, results)
  const additions = readRecords(incoming)
  const previous = new Map(state.results.map(result => [result.result_id, JSON.stringify(result)]))
  const previousResults = [...state.results]
  const checkedGroups = new Map()
  // Also give any as-yet ungrouped source records a Result.
  const pending = [...state.records.filter(record => !state.ownedRecords.has(record.record_id)), ...additions]
    .sort((a, b) => compareIds(a.record_id, b.record_id))
  for (const record of pending) {
    const original = state.byId.get(record.record_id)
    const owner = state.results.find(result => result.record_ids.includes(record.record_id))
    if (owner) {
      if (JSON.stringify(original) !== JSON.stringify(record)) markConflict(owner, [`record_id_collision:${record.record_id}`])
      continue
    }
    if (!original) {
      state.records.push(record)
      state.byId.set(record.record_id, record)
    }

    const candidates = state.results.filter(result => result.record_ids.some(id => relation(state.byId.get(id), record).strong))
    const combinedIds = [...candidates.flatMap(result => result.record_ids), record.record_id]
    // Compare every member, not just the matching key. A sparse source cannot bridge contradictions.
    const canMerge = canCombine(candidates, record, state.byId, checkedGroups)
    let target
    if (canMerge) {
      target = candidates[0]
      target.record_ids = unique(combinedIds).sort(compareIds)
      target.preferred_record_id = preferred(target.record_ids, state.byId)
      checkedGroups.set(target, true)
      for (const other of candidates.slice(1)) {
        target.alias_ids = unique([...target.alias_ids, other.result_id, ...other.alias_ids])
        markConflict(target, other.conflicts)
      }
      state.results = state.results.filter(result => result === target || !candidates.includes(result))
    } else {
      target = resultFor(nextId(idFactory, state.usedIds), [record.record_id], state.byId)
      state.results.push(target)
      if (candidates.length > 1) {
        const clue = `ambiguous_identity:${record.record_id}`
        for (const candidate of candidates) markConflict(candidate, [clue])
        markConflict(target, [clue])
      }
    }

    for (const other of state.results) {
      if (other === target) continue
      for (const id of other.record_ids) {
        const source = state.byId.get(id)
        if (!relation(source, record).candidate) continue
        const reasons = metadataConflicts(source, record)
        const clues = reasons.length ? reasons : [`title_similarity:${JSON.stringify([id, record.record_id].sort(compareIds))}`]
        markConflict(other, clues)
        markConflict(target, clues)
      }
    }
  }
  const changed = []
  for (const result of state.results) {
    if (previous.get(result.result_id) !== JSON.stringify(result)) changed.push(result.result_id, ...result.alias_ids)
  }
  for (const result of previousResults) {
    if (!state.results.some(current => current.result_id === result.result_id)) changed.push(result.result_id, ...result.alias_ids)
  }
  return { records: state.records, results: state.results, changed_result_ids: unique(changed) }
}

export function splitDiscoveryResult({ records, results, result_id, groups, idFactory }) {
  const state = readState(records, results)
  const old = state.results.find(result => result.result_id === result_id || result.alias_ids.includes(result_id))
  if (!old || !Array.isArray(groups) || groups.length < 2) fail("拆分分组")
  const remaining = new Set(old.record_ids)
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) fail("拆分分组")
    for (const id of group) {
      if (!remaining.delete(id)) fail("拆分来源记录")
    }
  }
  if (remaining.size) fail("拆分来源记录")
  const replacements = groups.map(group => {
    const keepsId = group.includes(old.preferred_record_id)
    const result = resultFor(keepsId ? old.result_id : nextId(idFactory, state.usedIds), group, state.byId, keepsId ? old.alias_ids : [])
    markConflict(result, withinGroupConflicts(group, state.byId))
    return result
  })
  return { records: state.records,
    results: state.results.flatMap(result => result === old ? replacements : [result]),
    invalidated_result_ids: [old.result_id, ...old.alias_ids] }
}
