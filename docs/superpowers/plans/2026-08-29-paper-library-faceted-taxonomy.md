# 论文库正交分面标签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将49条论文记录从复合“研究方向”标签迁移为可组合的版本2正交分面，并用五入口桌面筛选界面替换当前超过160项的平铺复选框。

**Architecture:** 由 exporter 侧单一 `facet-schema.mjs` 定义分面路径、中文标签、受控词表和顺序；`paper-tags.json` 只保存按稳定 `paper_id` 组织的分面值。构建器把分面模式和论文分面一并写入版本2 `paper-index.json`，浏览器以模式驱动通用筛选、搜索和详情展示，不再硬编码论文专属组合标签。

**Tech Stack:** Node.js ES modules、`node:test`、静态 HTML/CSS/JavaScript、Python Playwright、Quartz 外围静态构建目录。

**Spec:** `docs/superpowers/specs/2026-08-29-paper-library-faceted-taxonomy-design.md`

## Global Constraints

- 继续以稳定 `paper_id` 关联标签，不依赖文件夹路径分类。
- 不移动、不改名、不覆盖 `/Users/yangfan/Desktop/papers/论文/` 中的 PDF、OCR、笔记、代码和结果。
- 不修改私人 Markdown frontmatter，不安装依赖，不发布网站，不提交 Git。
- 同一分面小组内为 OR，不同分面小组之间为 AND。
- `topic_l2`、章节名称、应用领域和论文专属算法名不得进入通用筛选项。
- 只有显式目录标签、已有结构化笔记或已核验原文能够支持细粒度分面；依据不足时保持空数组并进入待核验清单。
- 当前49条包含记录必须全部由版本2目录覆盖；此前明确排除的连续时间论文继续排除。
- 每项代码变更遵循 RED → GREEN → REFACTOR；配置迁移也必须先有会失败的契约测试。

---

### Task 1: 建立唯一的分面模式与受控词表

**Files:**
- Create: `exporter/paper-library/facet-schema.mjs`
- Create: `exporter/paper-library/facet-schema.test.mjs`

**Interfaces:**
- Produces: `FACET_GROUPS: readonly FacetGroup[]`
- Produces: `FACET_PATHS: readonly string[]`
- Produces: `createEmptyFacets(): PaperFacets`
- Produces: `validatePaperFacets(facets: unknown): PaperFacets`
- Produces: `serializeFacetSchema(): { version: 1, groups: FacetGroup[] }`
- Produces: `flattenFacetValues(facets: PaperFacets): string[]`

- [ ] **Step 1: 写分面模式失败测试**

在 `facet-schema.test.mjs` 中先定义期望行为：路径唯一、受控值唯一、空对象结构稳定、未知字段和复合旧标签被拒绝。

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  FACET_PATHS,
  createEmptyFacets,
  flattenFacetValues,
  validatePaperFacets,
} from "./facet-schema.mjs"

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
```

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `node --test exporter/paper-library/facet-schema.test.mjs`

Expected: FAIL，因为 `facet-schema.mjs` 尚不存在。

- [ ] **Step 3: 实现最小分面模式**

模式条目固定使用以下结构，所有受控词完整写入该文件；`getAtPath` 和 `setAtPath` 保持模块内部私有。

```js
export const FACET_GROUPS = Object.freeze([
  Object.freeze({ panel: "research", path: "research.domain", label: "研究领域", values: ["分布式优化", "分布式学习", "联邦学习"] }),
  Object.freeze({ panel: "research", path: "research.mode", label: "任务范式", values: ["静态优化", "在线优化", "随机优化", "鲁棒优化"] }),
  Object.freeze({ panel: "more", path: "objective", label: "目标函数", values: ["凸", "强凸", "非凸", "光滑", "非光滑", "随机目标"] }),
  Object.freeze({ panel: "constraints", path: "constraints.scope", label: "作用范围", values: ["无显式约束", "本地约束", "耦合约束", "决策耦合约束"] }),
  Object.freeze({ panel: "constraints", path: "constraints.form", label: "数学形式", values: ["集合约束", "等式约束", "不等式约束", "不确定约束"] }),
  Object.freeze({ panel: "constraints", path: "constraints.consistency", label: "节点关系", values: ["本地一致约束", "本地非一致约束"] }),
  Object.freeze({ panel: "oracle", path: "oracle.information", label: "信息来源", values: ["精确梯度", "次梯度", "随机梯度", "函数值反馈"] }),
  Object.freeze({ panel: "oracle", path: "oracle.estimation", label: "估计与跟踪", values: ["梯度跟踪", "单点估计", "双点估计", "残差反馈", "次梯度重缩放"] }),
  Object.freeze({ panel: "methods", path: "methods.framework", label: "主框架", values: ["次梯度法", "对偶平均", "镜像下降", "对偶分解", "ADMM", "原始—对偶", "增广拉格朗日", "算子分裂", "原始松弛"] }),
  Object.freeze({ panel: "methods", path: "methods.coordination", label: "协调机制", values: ["普通共识", "Push-Sum", "Perron 修正", "动态跟踪", "有限时间共识"] }),
  Object.freeze({ panel: "methods", path: "methods.operator", label: "更新算子", values: ["投影", "近端", "预测—校正", "Nesterov 加速"] }),
  Object.freeze({ panel: "more", path: "network.direction", label: "网络方向", values: ["有向", "无向", "中心化服务器"] }),
  Object.freeze({ panel: "more", path: "network.time", label: "网络时变性", values: ["固定", "时变"] }),
  Object.freeze({ panel: "more", path: "network.balance", label: "网络平衡性", values: ["平衡", "不平衡"] }),
  Object.freeze({ panel: "more", path: "network.mixing", label: "混合矩阵", values: ["行随机", "列随机", "双随机"] }),
  Object.freeze({ panel: "more", path: "privacy_robustness", label: "隐私与鲁棒", values: ["差分隐私", "Laplace 机制", "Gaussian 机制", "安全多方计算", "结构化扰动", "拜占庭鲁棒", "不确定性鲁棒"] }),
  Object.freeze({ panel: "more", path: "results", label: "理论结果", values: ["渐近收敛", "精确收敛", "线性收敛", "次线性收敛", "静态遗憾", "动态遗憾", "约束违反界", "隐私保证", "鲁棒保证", "通信复杂度"] }),
  Object.freeze({ panel: "more", path: "applications", label: "应用领域", values: ["车联网", "无线物联网", "临床机器学习", "工业信息物理系统"] }),
])
```

`validatePaperFacets` 必须检查精确嵌套字段、字符串去空白、同数组无重复、值属于对应词表，并返回原对象。`serializeFacetSchema` 只复制 `panel/path/label/values`，不输出函数或私有路径。

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run: `node --test exporter/paper-library/facet-schema.test.mjs`

Expected: PASS，0 failures。

- [ ] **Step 5: 完成无提交检查点**

Run: `node --check exporter/paper-library/facet-schema.mjs`

Expected: exit 0。本项目按用户要求不执行 Git commit。

---

### Task 2: 将标签目录契约升级为版本2

**Files:**
- Modify: `exporter/paper-library/tag-catalog.mjs`
- Modify: `exporter/paper-library/tag-catalog.test.mjs`

**Interfaces:**
- Consumes: `createEmptyFacets`, `validatePaperFacets` from Task 1
- Produces: `loadPaperTagCatalog(path): Promise<{ version: 2, papers: Record<string, FacetRecord> }>`
- Produces: `validatePaperTagRecord(paperId, record)` where `FacetRecord = { record_type, facets, source_terms }`
- Produces: `applyPaperTagCatalog({ papers, tagCatalog }): { papers, tagging }`

- [ ] **Step 1: 写版本2目录失败测试**

替换版本1 fixture，并加入精确字段、来源术语、未匹配 ID 和待标注行为测试。

```js
const validRecord = () => ({
  record_type: "外部论文",
  facets: {
    ...createEmptyFacets(),
    research: { domain: ["分布式优化"], mode: [] },
  },
  source_terms: ["Dual Decomposition"],
})

test("loads a version-2 stable-ID facet catalog", async () => {
  const path = await writeCatalog({ version: 2, papers: { "Falsone17-DD": validRecord() } })
  const catalog = await loadPaperTagCatalog(path)
  assert.equal(catalog.version, 2)
  assert.deepEqual(catalog.papers["Falsone17-DD"].facets.research.domain, ["分布式优化"])
})

test("rejects legacy compound tag fields", () => {
  assert.throws(() => validatePaperTagRecord("Falsone17-DD", {
    ...validRecord(),
    topic_l2: "耦合约束对偶分解",
  }), /未知标签字段/u)
})
```

- [ ] **Step 2: 运行测试并确认因旧契约失败**

Run: `node --test exporter/paper-library/tag-catalog.test.mjs`

Expected: FAIL，错误显示版本1要求或缺少 `facets` 支持。

- [ ] **Step 3: 实现版本2目录加载与合并**

固定记录字段为：

```js
const RECORD_FIELDS = new Set(["record_type", "facets", "source_terms"])
const RECORD_TYPES = new Set(["外部论文", "学位论文", "学位论文章节", "专题综述"])
```

合并成功时写入：

```js
return {
  ...paper,
  record_type: record.record_type,
  facets: structuredClone(record.facets),
  source_terms: [...record.source_terms],
  metadata_provenance: {
    ...(paper.metadata_provenance ?? {}),
    record_type: "tag_catalog",
    facets: "tag_catalog",
    source_terms: "tag_catalog",
  },
}
```

未命中目录的新论文保持可见：使用空 `facets`、由 `unit_type` 映射的 `record_type`、空 `source_terms`，向 `warnings` 加入“标签待整理”，并把 ID 放入 `pending_paper_ids`。目录包含不存在的 ID 时在写入生成目录前抛错。

- [ ] **Step 4: 运行目录测试并确认通过**

Run: `node --test exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/facet-schema.test.mjs`

Expected: PASS，0 failures。

- [ ] **Step 5: 完成无提交检查点**

Run: `node --check exporter/paper-library/tag-catalog.mjs`

Expected: exit 0。

---

### Task 3: 显式迁移当前49条论文记录

**Files:**
- Modify: `local_library_config/paper-tags.json`
- Create: `audits/paper-facets-v2-2026-08-29.md`
- Modify: `exporter/paper-library/tag-catalog.test.mjs`

**Interfaces:**
- Consumes: version2 catalog contract from Task 2
- Produces: exactly 49 stable-ID `FacetRecord` objects
- Produces: a human-readable migration audit with old terms, new facets, evidence basis and unresolved fields

- [ ] **Step 1: 先写真实目录失败测试**

```js
test("the real version-2 catalog covers every currently included stable paper ID", async () => {
  const catalog = await loadPaperTagCatalog(new URL("../../local_library_config/paper-tags.json", import.meta.url))
  assert.equal(catalog.version, 2)
  assert.equal(Object.keys(catalog.papers).length, 49)
  assert.equal(new Set(Object.keys(catalog.papers)).size, 49)
  assert.deepEqual(
    Object.values(catalog.papers).filter((record) => (
      record.facets.research.domain.length === 0 && record.facets.research.mode.length === 0
    )),
    [],
  )
})
```

- [ ] **Step 2: 运行测试并确认版本1配置失败**

Run: `node --test exporter/paper-library/tag-catalog.test.mjs`

Expected: FAIL，真实目录版本仍为1。

- [ ] **Step 3: 重写49条显式分面记录**

每条记录完整写出 `record_type/facets/source_terms`。以下拆分是必须保持的代表性契约：

```json
"Falsone17-DD": {
  "record_type": "外部论文",
  "facets": {
    "research": {"domain": ["分布式优化"], "mode": []},
    "objective": ["凸"],
    "constraints": {"scope": ["耦合约束"], "form": ["不等式约束"], "consistency": []},
    "oracle": {"information": ["次梯度"], "estimation": []},
    "methods": {"framework": ["对偶分解"], "coordination": [], "operator": ["近端"]},
    "network": {"direction": ["无向"], "time": ["时变"], "balance": [], "mixing": ["双随机"]},
    "privacy_robustness": [], "results": [], "applications": []
  },
  "source_terms": ["Dual Decomposition", "Proximal Subgradient"]
}
```

```json
"Falsone20-TADMM": {
  "record_type": "外部论文",
  "facets": {
    "research": {"domain": ["分布式优化"], "mode": ["静态优化"]},
    "objective": ["凸"],
    "constraints": {"scope": ["耦合约束"], "form": ["等式约束"], "consistency": []},
    "oracle": {"information": ["精确梯度"], "estimation": []},
    "methods": {"framework": ["ADMM"], "coordination": ["动态跟踪"], "operator": []},
    "network": {"direction": ["无向"], "time": ["固定"], "balance": ["平衡"], "mixing": ["双随机"]},
    "privacy_robustness": [], "results": [], "applications": []
  },
  "source_terms": ["Tracking-ADMM"]
}
```

```json
"Tang26-DPPDS": {
  "record_type": "外部论文",
  "facets": {
    "research": {"domain": ["分布式优化"], "mode": ["静态优化"]},
    "objective": ["凸"],
    "constraints": {"scope": ["耦合约束"], "form": ["等式约束", "不等式约束"], "consistency": []},
    "oracle": {"information": ["精确梯度"], "estimation": []},
    "methods": {"framework": ["原始—对偶", "算子分裂"], "coordination": ["Perron 修正"], "operator": ["近端", "预测—校正"]},
    "network": {"direction": ["有向"], "time": [], "balance": ["不平衡"], "mixing": ["行随机"]},
    "privacy_robustness": [], "results": [], "applications": []
  },
  "source_terms": ["Distributed Proximal Primal-Dual Splitting"]
}
```

```json
"Zhao24-OPRF": {
  "record_type": "外部论文",
  "facets": {
    "research": {"domain": ["分布式优化"], "mode": ["在线优化"]},
    "objective": ["凸"],
    "constraints": {"scope": [], "form": [], "consistency": []},
    "oracle": {"information": ["函数值反馈"], "estimation": ["单点估计", "残差反馈"]},
    "methods": {"framework": [], "coordination": [], "operator": []},
    "network": {"direction": ["有向"], "time": ["时变"], "balance": ["不平衡"], "mixing": ["行随机"]},
    "privacy_robustness": ["差分隐私", "Laplace 机制"], "results": ["动态遗憾", "隐私保证"], "applications": []
  },
  "source_terms": ["One-Point Residual Feedback", "Path Variation"]
}
```

其余记录按以下无歧义规则拆分：

- “不等式耦合/等式耦合/等式与不等式耦合”分别拆到 `constraints.scope` 与 `constraints.form`。
- “非一致约束/非一致性约束”只在目录或笔记明确说明本地集合不相同时写为 `本地非一致约束`。
- OPBF/单点 Bandit 写为“函数值反馈 + 单点估计”；TPGE 写为“函数值反馈 + 双点估计”；OPRF 写为“函数值反馈 + 单点估计 + 残差反馈”。
- Proximal-Tracking 写为“近端 + 梯度跟踪”；Tracking-ADMM 写为“ADMM + 动态跟踪”。
- Push-Sum、Perron 修正、有限时间共识只进入 `methods.coordination`。
- 论文专名和缩写只进入 `source_terms`。
- 只有标题的论文不补写无法确认的约束一致性、理论速率或混合矩阵。

- [ ] **Step 4: 写迁移审计报告**

报告固定包含：49/49覆盖、排除项、每个分面值计数、复合旧标签移除清单、只有 PDF 记录的待核验字段、四个代表查询的预期 ID。不要复制私人绝对路径。

- [ ] **Step 5: 运行真实目录契约测试**

Run: `node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/tag-catalog.test.mjs`

Expected: PASS；49个唯一 ID；没有未知值、复合旧字段或未标注记录。

---

### Task 4: 让构建产物输出版本2分面模式

**Files:**
- Modify: `exporter/paper-library/status.mjs`
- Modify: `exporter/paper-library/status.test.mjs`
- Modify: `exporter/paper-library/build.mjs`
- Modify: `exporter/paper-library/build.test.mjs`
- Modify: `exporter/paper-library/overrides.mjs`
- Modify: `exporter/scripts/build-private-library.mjs`

**Interfaces:**
- Consumes: `serializeFacetSchema`, `validatePaperFacets`
- Produces: `{ version: 2, facet_schema, warning_count, papers }` in `paper-index.json`
- Produces per paper: `record_type`, `facets`, `source_terms`
- Stops serializing: `topic_l1`, `topic_l2`, `research_scopes`, `method_tags`, `network_tags`, `problem_tags`, `property_tags`, `theory_tags`

- [ ] **Step 1: 写生成记录与构建失败测试**

```js
test("generated paper accepts only version-2 facet fields", () => {
  const paper = generatedPaperFixture()
  paper.record_type = "外部论文"
  paper.facets = validFacets()
  paper.source_terms = ["Tracking-ADMM"]
  delete paper.topic_l1
  delete paper.topic_l2
  delete paper.research_scopes
  delete paper.method_tags
  delete paper.network_tags
  delete paper.problem_tags
  delete paper.property_tags
  delete paper.theory_tags
  assert.equal(validateGeneratedPaper(paper), paper)
})

test("build writes the facet schema and strips legacy composite filters", async () => {
  const fixture = await makeFixture()
  fixture.tagCatalog = version2TagCatalogFor("PaperA-01")
  await buildPrivateLibrary(fixture)
  const index = await readJson(join(fixture.repoRoot, "local_library_data/paper-index.json"))
  assert.equal(index.version, 2)
  assert.equal(index.facet_schema.version, 1)
  assert.deepEqual(index.papers[0].facets.constraints.scope, ["耦合约束"])
  assert.equal(Object.hasOwn(index.papers[0], "topic_l2"), false)
})
```

- [ ] **Step 2: 运行测试并确认旧版序列化失败**

Run: `node --test exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs`

Expected: FAIL，因为生成记录仍要求旧标签字段且索引版本为1。

- [ ] **Step 3: 更新固定字段与隐私校验**

`status.mjs` 的公开固定字段改为包含 `record_type/facets/source_terms`；`validateGeneratedPaper` 对 `facets` 调用 Task 1 验证器，对 `source_terms` 检查去空白和唯一性。`metadata_provenance` 允许 `record_type/facets/source_terms`，不再要求旧标签字段来源。

`build.mjs` 的 `serializePublicPaper` 显式深复制嵌套分面，不使用对象展开复制未知字段：

```js
record.record_type = paper.record_type
record.facets = structuredClone(paper.facets)
record.source_terms = [...paper.source_terms]
```

构建循环不得再把包含扫描器内部字段的 `paper` 直接交给精确公开契约校验。删除序列化前的 `validateGeneratedPaper(paper)` 调用，仅对 `serializePublicPaper(paper)` 返回的公开记录执行 `validateGeneratedPaper(record)`；这样内部扫描字段不会泄露，也不会因公开字段白名单而误报。

索引根对象改为：

```js
const index = {
  version: 2,
  facet_schema: serializeFacetSchema(),
  warning_count: aggregateWarningCount(audit),
  papers: papers.map(/* existing controlled serialization */),
}
```

递归私有路径检查必须覆盖 `facets` 和 `source_terms`。构建审计增加 `tagging.schema_version: 2`。

- [ ] **Step 4: 更新 CLI fixture 与构建测试**

所有测试 fixture 使用 `{ version: 2, papers: {} }` 或显式版本2记录。CLI 仍从 `local_library_config/paper-tags.json` 读取，不新增第二个事实源。

- [ ] **Step 5: 运行构建层测试并确认通过**

Run: `node --test exporter/paper-library/facet-schema.test.mjs exporter/paper-library/tag-catalog.test.mjs exporter/paper-library/status.test.mjs exporter/paper-library/build.test.mjs`

Expected: PASS，0 failures；旧生成目录在失败测试中保持不变。

---

### Task 5: 将搜索与筛选模型改成模式驱动

**Files:**
- Modify: `prototype/desktop/paper-library-model.mjs`
- Modify: `prototype/desktop/paper-library-model.test.mjs`

**Interfaces:**
- Produces: `facetValues(paper, path): string[]`
- Produces: `matchFacetFilters(paper, facetFilters): boolean`
- Changes: `filterLibrary(papers, filters, workspaceState)` reads `filters.facets: Record<string, string[]>`
- Changes: `matchPaperQuery(paper, query, facetSchema)` searches facets and `source_terms`

- [ ] **Step 1: 写正交组合与搜索失败测试**

```js
test("facet filters use OR within one path and AND across paths", () => {
  const papers = [
    paper("A", { "constraints.scope": ["耦合约束"], "constraints.form": ["不等式约束"], "methods.framework": ["对偶分解"] }),
    paper("B", { "constraints.scope": ["耦合约束"], "constraints.form": ["等式约束"], "methods.framework": ["ADMM"] }),
  ]
  const result = filterLibrary(papers, {
    facets: {
      "constraints.scope": ["耦合约束"],
      "constraints.form": ["不等式约束"],
      "methods.framework": ["对偶分解"],
    },
  })
  assert.deepEqual(result.map((entry) => entry.paper_id), ["A"])
})

test("source terms remain searchable without becoming facet values", () => {
  const candidate = paper("A", { "methods.framework": ["ADMM"] }, ["Tracking-ADMM"])
  assert.equal(matchPaperQuery(candidate, "Tracking-ADMM", schema).matched, true)
  assert.deepEqual(facetValues(candidate, "methods.framework"), ["ADMM"])
})
```

- [ ] **Step 2: 运行模型测试并确认旧硬编码失败**

Run: `node --test prototype/desktop/paper-library-model.test.mjs`

Expected: FAIL，因为模型仍读取 `topics/methodTags/...`。

- [ ] **Step 3: 实现通用路径读取与组合逻辑**

```js
export function facetValues(paper, path) {
  const value = path.split(".").reduce((current, key) => current?.[key], paper?.facets)
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
}

export function matchFacetFilters(paper, facetFilters = {}) {
  return Object.entries(facetFilters).every(([path, selected]) => {
    const choices = Array.isArray(selected) ? selected : []
    return choices.length === 0 || choices.some((choice) => facetValues(paper, path).includes(choice))
  })
}
```

保留阅读状态、原文核验、证据、仿真和用途架的原逻辑；仅替换学术标签筛选。搜索命中结果用 schema 的中文 `label`，`source_terms` 的命中标签固定为“原文术语”。

- [ ] **Step 4: 运行完整模型测试**

Run: `node --test prototype/desktop/paper-library-model.test.mjs prototype/desktop/paper-library-storage.test.mjs`

Expected: PASS，现有排序和本地状态行为无回归。

---

### Task 6: 重做桌面筛选入口与论文研究画像

**Files:**
- Modify: `prototype/desktop/library.template.html`
- Modify: `prototype/desktop/library.mjs`
- Modify: `prototype/desktop/paper-inspector.mjs`
- Modify: `prototype/desktop/styles.css`
- Modify: `prototype/desktop/paper-library-dom.test.mjs`

**Interfaces:**
- Changes: `loadPaperIndex()` accepts only index version2 and returns `facet_schema`
- Produces DOM: `[data-facet-panel-trigger]`, `[data-facet-panel]`, `[data-selected-facets]`
- Preserves DOM: material-progress filters, results list, reader, right inspector and P02 shelf actions

- [ ] **Step 1: 写版本2边界与五入口 DOM 失败测试**

```js
test("loadPaperIndex requires the version-2 facet schema", async () => {
  const loaded = await loadPaperIndex(async () => ({
    ok: true,
    json: async () => ({ version: 2, facet_schema: validFacetSchema(), warning_count: 0, papers: [validFacetPaper()] }),
  }))
  assert.equal(loaded.version, 2)
  assert.equal(loaded.facet_schema.groups.length, 18)
})

test("the template exposes five facet entry buttons and one selected-chip region", async () => {
  const html = await readFile(new URL("./library.template.html", import.meta.url), "utf8")
  assert.equal((html.match(/data-facet-panel-trigger=/gu) ?? []).length, 5)
  assert.match(html, /data-selected-facets/u)
  assert.doesNotMatch(html, /data-filter-axis="topics"/u)
})
```

- [ ] **Step 2: 运行 DOM 测试并确认旧界面失败**

Run: `node --test prototype/desktop/paper-library-dom.test.mjs`

Expected: FAIL，因为索引版本、六个旧 fieldset 和入口数量不符合新契约。

- [ ] **Step 3: 更新模板和渲染状态**

模板保留“材料进度”折叠区，并把学术筛选替换为：

```html
<div class="facet-entry-bar" aria-label="学术筛选">
  <button type="button" data-facet-panel-trigger="research">研究任务</button>
  <button type="button" data-facet-panel-trigger="constraints">约束结构</button>
  <button type="button" data-facet-panel-trigger="oracle">梯度与反馈</button>
  <button type="button" data-facet-panel-trigger="methods">方法体系</button>
  <button type="button" data-facet-panel-trigger="more">更多条件</button>
</div>
<div class="selected-facet-chips" data-selected-facets aria-live="polite"></div>
<section class="facet-panel" data-facet-panel hidden></section>
```

`library.mjs` 用 `facet_schema.groups` 渲染当前面板；每次只打开一个入口。每个选项旁显示基于“其他已选条件已应用、当前路径暂不应用”的动态计数。点击已选标签的删除按钮立即更新结果；“重置筛选”同时清空旧状态筛选和 `filters.facets`。

- [ ] **Step 4: 更新详情页为论文研究画像**

`paper-inspector.mjs` 按 schema 顺序显示非空分面；空的约束一致性、理论结果等显示“待核验”，而不是 `Unknown`。`source_terms` 放入折叠的“原文术语与算法名称”，不渲染为可点筛选标签。

- [ ] **Step 5: 更新桌面样式**

取消旧 `.library-dynamic-filter` 的62px内部滚动高度。五个入口在1440px单行、1280px允许两行；展开面板使用正常页面流、二级小标题和自动换行选项。触控目标最小高度36px，已选标签具有文字“移除”辅助名称，不依赖颜色或 hover。

- [ ] **Step 6: 运行 DOM 与模型测试**

Run: `node --test prototype/desktop/paper-library-dom.test.mjs prototype/desktop/paper-library-model.test.mjs`

Expected: PASS；页面不再包含旧六轴筛选挂载点。

---

### Task 7: 更新打包边界和浏览器端到端验收

**Files:**
- Modify: `exporter/config/github-package-files.json`
- Modify: `exporter/paper-library/package-audit.mjs`
- Modify: `exporter/paper-library/package-audit.test.mjs`
- Modify: `exporter/verification/private_library_e2e.py`

**Interfaces:**
- Adds package candidate: `exporter/paper-library/facet-schema.mjs`
- Verifies four representative cross-facet queries
- Verifies five panel triggers, selected chips, counts, reset, search aliases and desktop overflow

- [ ] **Step 1: 先写打包和 E2E 新契约**

在 package audit 测试的精确文件清单加入 `facet-schema.mjs`，并确认该模块和版本2生成索引不含绝对路径。更新 E2E 断言：

```python
ensure(page.locator("[data-facet-panel-trigger]").count() == 5, "facet_entry_count")
select_facet(page, "constraints.scope", "耦合约束")
select_facet(page, "constraints.form", "不等式约束")
select_facet(page, "methods.framework", "对偶分解")
ids = visible_paper_ids(page)
ensure("Falsone17-DD" in ids, "coupled_dual_query_contains_reference")
ensure(all_visible_rows_match_selected_facets(page), "coupled_dual_query_has_no_false_positive")
```

另外分别验证：

- 本地非一致约束 AND 时变；
- 函数值反馈 AND 单点估计 AND 在线优化；
- 差分隐私 AND 联邦学习；
- 搜索 `Tracking-ADMM` 命中论文，但筛选面板没有该复合术语；
- 重置后恢复49条记录。

- [ ] **Step 2: 运行聚焦测试并确认新资产尚未纳入**

Run: `node --test exporter/paper-library/package-audit.test.mjs`

Expected: FAIL，精确清单或依赖闭包缺少新模块。

- [ ] **Step 3: 更新精确打包策略**

把 `facet-schema.mjs` 加入固定候选文件。标签配置、生成索引、迁移审计和私人论文材料继续排除在 GitHub 包之外。不能通过放宽目录通配符解决依赖闭包。

- [ ] **Step 4: 运行打包测试和 CLI 审计**

Run: `node --test exporter/paper-library/package-audit.test.mjs && node exporter/scripts/audit-github-package.mjs`

Expected: PASS；审计报告候选数量增加1且无私人路径。

- [ ] **Step 5: 运行浏览器验收并检查截图**

Run: `/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py`

Expected: 1280×720和1440×900均通过；控制台错误、失败请求、HTTP>=400和禁止请求均为0。截图必须展示五入口、一个展开面板、已选标签与更新后的结果数。

---

### Task 8: 完整重建与最终一致性核验

**Files:**
- Regenerate: `local_library_data/paper-index.json`
- Regenerate: `local_library_data/paper-library-audit.json`
- Regenerate: `local_library_output/desktop/library.html`
- Regenerate: `local_library_output/desktop/assets/*`
- Update: `audits/paper-facets-v2-2026-08-29.md` only with observed final counts

**Interfaces:**
- Produces rebuildable local static library at `http://127.0.0.1:4176/local_library_output/desktop/library.html`

- [ ] **Step 1: 在任何重建前记录只读源材料指纹**

用只读 Node 脚本扫描 `/Users/yangfan/Desktop/papers/论文/`，按扩展名记录文件数量、总字节数，并对稳定排序后的首尾各10个 PDF、Markdown、代码和图片文件计算 SHA-256。把基线写到系统临时目录（例如 `/tmp/paper-source-fingerprint-before.json`），不得写回论文目录。

Expected: 指纹文件存在，包含扫描根目录、记录时间、分类统计和抽样相对路径；不包含文件正文。

- [ ] **Step 2: 运行完整 Node 回归**

Run: `node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs`

Expected: all tests PASS，0 failures、0 skipped、0 cancelled。

- [ ] **Step 3: 重建私有论文库**

Run: `node exporter/scripts/build-private-library.mjs`

Expected: 49条论文记录、0个未匹配标签 ID、0个待标注 ID；生成目录可完整替换。

- [ ] **Step 4: 验证生成索引契约**

Run:

```bash
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync("local_library_data/paper-index.json"));const bad=x.papers.filter(p=>Object.hasOwn(p,"topic_l2")||!p.facets||!Array.isArray(p.source_terms));console.log(JSON.stringify({version:x.version,papers:x.papers.length,groups:x.facet_schema.groups.length,bad:bad.map(p=>p.paper_id)},null,2));if(x.version!==2||x.papers.length!==49||bad.length)process.exit(1)'
```

Expected: `version: 2`、`papers: 49`、`groups: 18`、`bad: []`。

- [ ] **Step 5: 运行最终 E2E 与打包边界审计**

Run: `/opt/anaconda3/bin/python3.13 exporter/verification/private_library_e2e.py && node exporter/scripts/audit-github-package.mjs`

Expected: 两种桌面尺寸通过，GitHub候选边界通过。

- [ ] **Step 6: 只读核对源材料未变化**

以同一脚本和相同抽样规则生成 `/tmp/paper-source-fingerprint-after.json`，与 Step 1 的基线比较。Expected: PDF、Markdown、代码和结果的数量、总字节数与抽样哈希一致；仅 `local_library_data/`、`local_library_output/`、本地配置、审计和项目源码发生变化。

- [ ] **Step 7: 完成无提交交付**

报告：版本2标签覆盖49/49、四个代表组合的命中结果、测试总数、浏览器尺寸、待核验细分面数量以及没有执行的 Git/部署/源文件修改操作。
