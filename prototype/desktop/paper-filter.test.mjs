import test from "node:test"
import assert from "node:assert/strict"

import {
  countByReadingState,
  filterPapers,
  rankPapers,
} from "./paper-filter.mjs"

const papers = Object.freeze([
  {
    id: "A",
    year: 2024,
    readingState: "reading",
    contribution: "method",
    dimensions: {
      direction: ["有向网络"],
      topology: ["时变拓扑"],
      coupling: ["耦合约束"],
      communication: ["低通信"],
    },
  },
  {
    id: "B",
    year: 2018,
    readingState: "completed",
    contribution: "foundational",
    dimensions: {
      direction: ["有向网络"],
      topology: ["静态拓扑"],
      coupling: ["无耦合约束"],
      communication: ["每轮通信"],
    },
  },
  {
    id: "C",
    year: 2025,
    readingState: "queued",
    contribution: "combination",
    dimensions: {
      direction: ["无向网络"],
      topology: ["时变拓扑"],
      coupling: ["耦合约束"],
      communication: ["低通信"],
    },
  },
])

test("互斥选项同轴取并集、独立研究维度跨轴取交集", () => {
  const result = filterPapers(papers, {
    direction: ["有向网络", "无向网络"],
    topology: ["时变拓扑"],
    coupling: ["耦合约束"],
    communication: ["低通信"],
  })

  assert.deepEqual(result.map((paper) => paper.id), ["A", "C"])
})

test("阅读状态统计独立于筛选结果的排列方式", () => {
  assert.deepEqual(countByReadingState(papers), {
    completed: 1,
    reading: 1,
    queued: 1,
  })
})

test("贡献排序优先展示开创性工作，而不是简单按年份倒序", () => {
  const result = rankPapers(papers, "contribution")

  assert.deepEqual(result.map((paper) => paper.id), ["B", "A", "C"])
})
