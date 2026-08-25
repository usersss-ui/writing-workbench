# 学术研究工作台静态网站设计规格

**状态：** 已由用户于 2026-08-25 批准第一阶段方案；等待用户审阅本规格后进入实施计划。

## 1. 目标

在不公开完整私人 Obsidian vault 的前提下，构建一个面向桌面、平板和手机的静态学术研究控制台，清晰展示：

```text
研究问题
→ 系列论文
→ 主张、定理和实验
→ 已发表成果
→ 学位论文章节
```

网站使用 Quartz 5 构建，不依赖数据库或后端服务。Markdown 和显式结构化 YAML 是事实来源；HTML、CSS、JavaScript、搜索索引及派生 JSON 均为可删除、可重建的构建产物。

## 2. 已审计基线

- 私人内容根目录：`/Users/yangfan/Desktop/papers/`。
- 网站工程根目录：`/Users/yangfan/Documents/ChatGPT/html/`，与私人 vault 物理隔离。
- 主要研究内容 Markdown 共 264 份；127 份具有合法 frontmatter，137 份无 frontmatter。
- 10 份文件具有 `publish: true`，但没有任何文件具有 `visibility`；按本规格的新白名单规则，当前真实内容可发布数量为 0。
- 现有 `.research-site` 使用 Quartz 5.0.0，固定提交为 `075afd3f712da0088a07f5284a7b3aba37dd61b6`。其配置、样式和测试思路可作为参考，但不得复制其内容、构建产物、Git 历史或 `node_modules`。
- 当前内容包含大量 PDF、OCR、全文翻译、图片、代码和实验结果，均保持默认排除。
- 当前没有 P01/P02 实体、主张实体、资产实体、学位论文映射或显式学术时间线数据，因此第一轮采用明确标注的脱敏示例。

## 3. 技术决策

采用以下组合：

```text
Node.js 导出器
+ YAML/JSON Schema 数据校验
+ Quartz 5 静态构建
+ 本地 TSX/JavaScript 研究组件
+ MathJax
+ 本地 Mermaid runtime
+ 静态搜索索引
```

约束如下：

- Quartz 只读取 `site_content/`，绝不读取私人 vault。
- 导出器是唯一可以只读访问私人 vault 的网站组件。
- 第一轮允许在新项目 `quartz/` 中执行一次 `npm ci`，但不安装 Python 依赖。
- 不使用远程字体、CDN Mermaid 或其他运行时外部依赖。
- 不创建远程仓库，不配置部署，不发布网站。
- 继承 Quartz 上游源码时不继承其 GitHub 部署工作流。

## 4. 项目结构

```text
/Users/yangfan/Documents/ChatGPT/html/
├── README.md
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── exporter/
│   ├── config/
│   │   ├── prototype-allowlist.yml
│   │   └── assets.yml
│   ├── fixtures/
│   ├── schemas/
│   ├── src/
│   └── tests/
├── site_content/              # 自动生成，可完整删除
├── quartz/                    # 固定版本 Quartz 5
├── site_output/               # 自动生成，可完整删除
└── audits/                    # 自动生成的私有审计产物
```

`site_content/`、`site_output/` 和 `audits/` 不作为事实来源。它们删除后必须能从脱敏示例或经批准的源 Markdown 重建。

## 5. 发布白名单

Markdown 只有同时满足以下全部条件才可导出：

1. `publish` 严格等于布尔值 `true`；
2. `visibility` 是 YAML 列表；
3. `visibility` 至少包含 `public_notes` 或 `published`；
4. 文件出现在 `prototype-allowlist.yml`；
5. `content_type` 属于允许的公开类型；
6. 文件为 vault 根目录内的普通文件，不是符号链接；
7. 通过 frontmatter、ID、链接、隐私和附件预检。

缺失 `publish`、缺失 `visibility`、将 `visibility` 写成字符串、使用 `advisor_only` 或 `group_internal`，均视为不允许发布。导出器不得自动修改这些字段。

默认硬排除：

```text
PDF
OCR 全文
全文翻译
原始实验数据
模型权重
未公开算法
未提交论文草稿
导师交流记录
审稿意见
私有代码
环境变量与账号信息
绝对路径
缓存和临时文件
符号链接
```

## 6. 附件策略

第一轮 `assets.yml` 为空，任何本地附件引用都会使公开候选预检失败。后续启用附件时，每个附件必须具有唯一记录：

```yaml
asset_id: A-P01-001
source: relative/path/to/image.png
publish: true
visibility:
  - published
rights_status: cleared
media_type: image/png
alt: 可独立理解的替代文本
```

导出器处理附件的固定顺序为：扫描显式引用、解析目标、匹配 `asset_id`、检查权限和 MIME、复制到独立资产目录、重写链接、生成附件审计表。PDF 在本原型中始终拒绝。

## 7. 导出与构建流程

```text
源目录（私人 vault 或脱敏 fixtures）
→ 读取显式 allowlist
→ 校验发布元数据
→ 校验实体 Schema 与唯一性
→ 扫描敏感信息和禁止类型
→ 解析 wikilink、Markdown link 与附件
→ 处理公开、私有、不存在和歧义目标
→ 清理只供内部使用的 frontmatter
→ 生成脱敏 Markdown 与派生 JSON
→ 写入临时 site_content.next/
→ 全部预检成功后替换 site_content/
→ Quartz 读取 site_content/
→ 输出 site_output/
→ 构建后执行隐私、搜索、路由和响应式审计
```

链接规则：

- 指向公开目标：重写为稳定公开路由。
- 指向私有目标：不泄露路径或私有 ID；渲染为非链接的“未公开关联项”，或在允许的上下文中省略。
- 指向不存在或歧义目标：构建硬失败。
- 新导出器不得像旧原型一样把所有未知目标静默退化为纯文本。

机械格式兼容转换只能发生在 `site_content/`，例如规范化同一行闭合的 `$$...$$`。任何不平衡或语义不明确的公式必须失败，不得猜测修复。

## 8. 内容实体

### 8.1 Paper

每篇系列论文有且只有一个 Paper 实体。关键字段：

```text
paper_id
slug
title_zh
title_en
role
research_questions
predecessors
changed_dimensions
status
core_claims
theory_status
experiment_status
thesis_role
target_chapters
published_snapshot
venue
doi
accepted_date
published_date
canonical_version
code_commit
frozen_at
errata_status
superseded_by
```

`paper_id` 在 Paper 实体内唯一；其他实体可以把它作为外键引用。显示 ID 保留大写，公开路径使用显式小写 `slug`。

论文状态只允许：

```text
Idea
Scoped
Active
Submitted
Revision
Accepted
Published
Frozen
Corrected
Superseded
```

`Published` 表示论文工作流状态，`Frozen` 表示已发表版本的快照状态。P01 使用 `status: Published`，并在 `published_snapshot.state: Frozen` 中记录冻结状态，不能用其中一个覆盖另一个。`published_snapshot` 同时承载 venue、DOI、录用/发表日期、canonical version、code commit、frozen at、errata 和 superseded by。

### 8.2 Claim

每个可点击主张有独立实体：

```text
claim_id
statement
scope
paper_id
claim_type
status
conditions
evidence_ids
theorem_ids
experiment_ids
allowed_wording
limitations
target_chapter
blocking
epistemic_status
```

`claim_id` 只在 Claim 实体定义处检查唯一性；引用同一主张不构成重复。

`claim_type` 只允许 `theoretical | empirical | comparative | interpretive | novelty`；支持状态只允许 `supported | partial | unsupported`。`blocking` 是独立布尔字段，不能从支持状态推断。

### 8.3 Relation

关系来自 `relations.yml`，不得从论文顺序、正文或目录结构推断：

```yaml
- relation_id: REL-P01-P02-01
  source: P01
  type: extends_to_dynamic_setting
  target: P02
```

### 8.4 Timeline、Thesis、Reading、Asset

- `timeline.yml`：只保存显式学术事件和日期。
- `thesis-map.yml`：保存论文、论文主张、学位论文主张和章节的显式映射。
- `reading-queue.yml`：保存 Candidate 至 Completed 的阅读状态。
- `assets.yml`：保存附件权限和权利状态。

阅读状态只允许：

```text
Candidate
Screening
Structured Reading
Evidence Ready
Reproduction Planned
Completed
```

## 9. 脱敏原型数据

第一轮只使用 `demo: true` 的示例内容：

- P01：显示为 `Published`，并具有明确的 `Frozen` 快照状态；`frozen_at`、DOI 或 venue 未提供时显示 `Not Reported`，不生成看似真实的值。
- P02：显示为独立 `Active` 项目，不继承 P01 的发表状态。
- P03：首页保留状态卡位置，显示 `Not Reported`，不生成详情页。
- P01→P02 关系只来自 `relations.yml`。
- D-C01 显式引用 P01/P02 主张，支持从学位论文主张回链。
- 原型不包含真实 PDF、真实研究项目正文或真实附件。

## 10. 顶层导航和路由

顶层导航固定为七项：

```text
研究首页
研究主线
系列论文
学位论文
主张与证据
知识库
搜索
```

路由：

```text
/
/program/
/program/questions/
/program/timeline/
/program/failures/
/papers/
/papers/p01/
/papers/p02/
/papers/relations/
/publications/
/thesis/
/thesis/claims/
/thesis/chapters/
/claims/
/claims/<claim-id>/
/evidence/
/knowledge/
/knowledge/math/
/reading-queue/
/search/
```

中文文件名不得成为唯一稳定路由。页面标题可以改变，ID 和显式 slug 不改变。

## 11. 页面设计

### 11.1 Dashboard

首页采用宽布局，不加载完整全局图谱。模块包括：总研究问题、阶段、P01/P02/P03 状态卡、已发表/在研数量、学位论文映射完成度、路线图、阻塞项、最近更新、待核验证据、开放问题和搜索入口。

### 11.2 研究主线

包含范围、排除范围、RQ0、子问题树、论文路线、统一模型/符号/假设、评价指标、开放问题、失败记录、学位论文映射和可筛选研究维度矩阵。

### 11.3 单篇论文

桌面使用左导航、正文、右目录与关联信息三栏。正文按用户规定的 18 个段落顺序组织。P01 显示 Published Snapshot；P02 明确显示 Active 和未公开边界。

### 11.4 关系、学位论文与主张

- 关系页面同时提供 Mermaid/可视图和语义表格。
- 学位论文页面区分 Published Result、Cross-paper Synthesis、New Thesis Derivation、Author Interpretation 和 Research Hypothesis。
- 主张页面提供静态客户端筛选，并为每个主张生成稳定详情路由。

### 11.5 搜索

`/search/` 使用从公开派生数据生成的静态索引。支持中英文标题、作者、paper/claim/theorem ID 及研究、方法、网络和问题标签。结果显示标题、内容类型、项目、命中片段、状态和可见性。

## 12. 响应式与可访问性

- 桌面 `>=1200px`：左栏 264px，正文弹性，右栏 240px。
- 平板 `768–1199px`：左导航改为抽屉，目录可关闭。
- 手机 `<768px`：单栏、16px 边距、状态卡单列。
- 375px、768px、1440px 是强制验收宽度。
- 根页面不得通过裁切隐藏溢出；公式、表格和关系图各自具有横向滚动容器。
- 触控目标至少 44×44px。
- 搜索入口始终可见。
- 元数据用原生 `<details>` 折叠。
- 不依赖 hover；键盘可操作全部筛选和导航。
- 状态必须具有文字标签，不能只用颜色。
- 图表提供文本/表格替代视图。
- `source_path` 只进入私有审计，不进入公开 UI 或搜索索引。

页面必须为下列状态提供文字、图标和视觉样式：

```text
Published
Active
Hypothesis
Blocked
Corrected
Superseded
Private
```

必须支持并明确标注以下 Callout：

```text
Problem
Assumption
Algorithm
Theorem
Proof Dependency
Experiment
Evidence
Interpretation
Limitation
Warning
Open Question
Erratum
```

## 13. 组件边界

- `ResearchShell`：响应式页面骨架。
- `PrimaryNav`、`MobileDrawer`、`SearchTrigger`：全局导航。
- `StatusBadge`：状态文字、图标和视觉样式。
- `MetricCard`、`PaperStatusCard`、`BlockerPanel`：Dashboard 单元。
- `ResearchRoadmap`、`RelationGraph`、`RelationTable`：论文关系。
- `PaperDimensionMatrix`：研究维度筛选。
- `ClaimExplorer`、`EvidenceChain`：主张和证据。
- `PublishedSnapshot`：已发表冻结快照。
- `ThesisClaimTable`、`PaperChapterMap`：学位论文映射。
- `Timeline`、`ReadingQueueBoard`：时间线和阅读队列。
- `MetadataDisclosure`、`ResponsiveTable`、`MathScroller`：移动阅读。
- `PreviousNextNav`：触控友好的论文顺序导航。
- `UnknownValue`、`PrivateTarget`：未知和私有目标的统一呈现。

每个组件只消费脱敏 JSON 或当前公开页面 frontmatter，不访问源 vault。

## 14. 派生数据

构建生成：

```text
papers.json
claims.json
relations.json
timeline.json
thesis-map.json
reading-status.json
search-documents.json
```

约束：

- 只包含通过发布门禁的实体和边。
- 不从正文、mtime、目录名或论文顺序补充事实。
- 缺失值为 `unknown`，明确检查但未报告为 `not_reported`；UI 分别显示 `Unknown` 和 `Not Reported`。
- 输出按稳定 ID 排序，不加入会破坏确定性重建的当前时间戳。
- 私有目标和内部路径不得进入派生 JSON。

## 15. 审计产物

`audits/` 至少生成：

```text
publication-manifest.json
excluded-files.csv
attachment-audit.csv
link-audit.json
id-audit.json
privacy-audit.json
search-audit.json
build-reproducibility.json
prototype-audit.md
```

审计报告可以包含私有源相对路径，因此 `audits/` 不进入 `site_output/`。

## 16. 错误处理

以下情况构建必须非零退出，且不得部分替换已成功的 `site_content/`：

- 白名单字段类型或值不合法；
- Paper、Claim 或 Asset 实体定义重复；
- 公开关系端点不存在或不可发布；
- 链接目标不存在或歧义；
- 出现未经授权的附件、PDF、OCR 或全文翻译；
- 检测到绝对路径、凭据模式或路径穿越；
- LaTeX 分隔符不平衡；
- 派生搜索索引包含不在发布清单中的实体。

失败时保留上一份成功构建，并把原因写入私有审计输出。

## 17. 测试与验收

### 单元测试

- `publish`、`visibility`、allowlist 和 `content_type` 的交集。
- 缺失字段、错误字段类型和非法状态。
- 目录穿越、绝对路径和符号链接。
- Paper/Claim/Asset 实体唯一性和外键完整性。
- 公开、私有、不存在和歧义链接。
- 附件权限、MIME、权利状态和链接重写。
- `unknown` 与 `not_reported` 的稳定映射。
- 派生 JSON 的稳定排序和搜索字段。

### 集成测试

- 从空的 `site_content/` 和 `site_output/` 完整重建。
- 构建前后私人源文件哈希完全一致。
- 输出无 PDF、OCR、全文翻译、私有代码、绝对路径或凭据。
- 搜索索引只包含发布清单实体。
- P01 为 Published/Frozen，P02 为 Active。
- P01→P02 来自显式关系文件。
- D-C01 可以回链到论文主张。
- 所有公开内部链接解析。
- MathJax 无错误节点，Mermaid 使用本地 runtime。

### 浏览器测试

- 375px、768px、1440px 自动截图。
- 首页卡片列数、侧栏开关和移动抽屉。
- 根页面无横向溢出。
- 公式与表格容器可独立横向滚动。
- 搜索始终可访问。
- 触控目标尺寸、键盘操作和焦点可见性。
- 元数据折叠和上一篇/下一篇导航。
- 关系图存在表格替代视图。

### 确定性测试

连续两次清洁构建的 `site_content/`、派生 JSON 和 `site_output/` 文件清单及内容哈希一致。审计运行时间等非确定信息不得进入公开构建产物。

## 18. 原型范围

第一轮只交付：研究首页、一个研究主线页、P01 页面、P02 页面、P01→P02 图和表、学位论文映射页、主张与证据页、静态搜索、移动布局以及公开发布白名单审计。

不交付：完整 vault 发布、真实在研论文、真实学位论文正文、PDF、OCR、全文翻译、真实附件、全局图谱、后端服务、账号系统、远程仓库或部署配置。

## 19. 实施门禁

本规格获用户审阅确认后，下一步是创建详细实施计划。实施计划必须按可独立测试的任务拆分，并在写入实现代码前明确每个任务的文件、接口、失败测试、最小实现和验证命令。
