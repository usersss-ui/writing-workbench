export function filterPapers(papers, selected = {}) {
  const activeAxes = Object.entries(selected).filter(
    ([, values]) => Array.isArray(values) && values.length > 0,
  )

  return papers.filter((paper) =>
    activeAxes.every(([axis, values]) => {
      const paperValues = paper.dimensions?.[axis] ?? []
      return values.some((value) => paperValues.includes(value))
    }),
  )
}

export function countByReadingState(papers) {
  return papers.reduce(
    (counts, paper) => {
      if (paper.readingState in counts) counts[paper.readingState] += 1
      return counts
    },
    { completed: 0, reading: 0, queued: 0 },
  )
}

export function rankPapers(papers, mode = "relevance") {
  const result = [...papers]

  if (mode === "year") {
    return result.sort((left, right) => right.year - left.year)
  }

  if (mode === "contribution") {
    const weight = {
      foundational: 4,
      method: 3,
      practical: 2,
      combination: 1,
    }
    return result.sort(
      (left, right) =>
        (weight[right.contribution] ?? 0) -
          (weight[left.contribution] ?? 0) ||
        right.year - left.year,
    )
  }

  return result
}
