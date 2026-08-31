function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function migratePaperTagCatalogV2(raw) {
  if (!isPlainObject(raw) || raw.version !== 2 || !isPlainObject(raw.papers)) {
    throw new Error("标签目录必须是 version 2")
  }
  const papers = {}
  for (const [paperId, record] of Object.entries(raw.papers)) {
    if (!isPlainObject(record) || Object.keys(record).sort().join("|") !== "facets|record_type|source_terms") {
      throw new Error(`version-2 标签记录字段无效: ${paperId}`)
    }
    papers[paperId] = {
      record_type: record.record_type,
      facets: structuredClone(record.facets),
      facet_states: {},
      source_terms: [...record.source_terms],
    }
  }
  return { version: 3, papers }
}
