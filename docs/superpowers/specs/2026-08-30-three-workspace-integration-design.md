# 三工作区论文研究工作台整合设计

**状态：** 方案 A 已由用户于 2026-08-30 确认。本文件只确定整合边界、数据契约、迁移顺序和验收标准；本轮不修改生产代码、不迁移真实论文资料、不切换运行端口。

## 1. 目标

把三个已经分别形成能力的工作区整合为一套桌面端学术研究工作台，并消除端口和浏览器状态割裂：

```text
22dd 论文库主干
  + aa09 论文发现、学校访问和候选归档
  + 2c10 Agent 输入整理页
  → 127.0.0.1:4176 上的单一 Node 本地服务
```

整合后的主流程为：

```text
方向探索
→ OpenAlex 关键词发现 / 已知论文学校访问
→ 浏览器候选队列
→ 人工筛选与二次确认
→ 元数据资料包归档
→ 22dd 论文库扫描、分面、阅读和笔记整理
→ P02 用途架
→ Agent 中心输入预览、固定快照和历史列表
```

本设计坚持四个原则：

1. `22dd` 是唯一主项目和唯一最终运行位置；
2. 能力按模块移植，任何同名核心文件都不得整棵覆盖；
3. 候选元数据、个人标签和 Agent 输入只是工作流状态，不是经原文核验的学术证据；
4. 最终只有一个绑定 `127.0.0.1:4176` 的 Node 服务，Python 静态服务只承担切换前临时预览和失败回退。

## 2. 工作区权属

### 2.1 `22dd`：唯一主干与最终权威

主目录固定为：

```text
/Users/yangfan/.codex/worktrees/22dd/html
```

以下职责始终由 `22dd` 版本负责，其他工作区的同名文件只能作为只读参考：

- 论文来源配置、覆盖目录和稳定 `paper_id`；
- 扫描器、路径边界、symlink 边界和多来源一致性；
- PDF、OCR、翻译、精读、推导、仿真、代码和复现材料分类；
- 受控 Markdown 预览、图片复制、KaTeX 渲染和多笔记选择；
- 论文状态、标签目录、分面 schema、生成索引与私有审计；
- 论文库页面、详情阅读器、筛选排序、P02 用途架和浏览器工作区状态；
- 原子构建、GitHub 打包清单、包审计和私有验收。

不得被覆盖的核心文件包括但不限于：

```text
exporter/paper-library/build.mjs
exporter/paper-library/scanner.mjs
exporter/paper-library/status.mjs
exporter/paper-library/artifacts.mjs
exporter/paper-library/frontmatter.mjs
exporter/paper-library/note-preview.mjs
exporter/paper-library/facet-schema.mjs
exporter/paper-library/tag-catalog.mjs
exporter/paper-library/package-audit.mjs
prototype/desktop/library.mjs
prototype/desktop/library.template.html
prototype/desktop/paper-inspector.mjs
prototype/desktop/paper-library-model.mjs
prototype/desktop/paper-library-storage.mjs
prototype/desktop/styles.css
```

### 2.2 `aa09`：发现与元数据归档的模块来源

只读参考目录为：

```text
/Users/yangfan/.codex/worktrees/aa09/html
```

允许按新文件或逐函数手工移植：

- `openalex-search.mjs`：浏览器主动发起的 OpenAlex 关键词检索；
- `candidate-storage.mjs`：浏览器候选队列及阶段迁移；
- `institution-access.mjs`：DOI、题名和 HTTPS 原文地址解析；
- `discovery.mjs`、`discovery.template.html`：发现页面；
- `institution-config.mjs` 和公开的 `nuist.json`；
- `candidate-archive.mjs`：受控的 metadata-only 资料包事务；
- 上述模块各自的单元测试、DOM 测试和学校入口 E2E 思路。

以下 `aa09` 文件不得直接复制到 `22dd`：

- `scanner.mjs`、`build.mjs`、`status.mjs`；
- `library.mjs`、`library.template.html`、`paper-inspector.mjs`、`styles.css`；
- `private-server.mjs`、`serve-private-library.mjs`；
- `package-audit.mjs`、GitHub 清单和整套生成目录。

原因是这些文件落后于 `22dd` 当前的分面、元数据来源、阅读器、KaTeX 和多笔记链。需要的候选归档逻辑必须合入 `22dd` 的运行时、扫描器和统一路由，不能反向替换主干。

### 2.3 `2c10`：Agent 输入页面的模块来源

只读参考目录为：

```text
/Users/yangfan/.codex/worktrees/2c10/html
```

允许移植并适配：

- `direction-snapshot.mjs` 及测试；
- `agent-task-input.mjs` 及测试；
- `agent-tasks.html`、`agent-tasks.css`、`agent-tasks.mjs` 及测试。

必须手工合并而不能覆盖：

- `directions.html` 和 `directions.mjs` 中保存方向快照的部分；
- 研究首页、方向探索、论文库、我的论文、论文发现和 Agent 中心之间的导航；
- Agent 页面读取论文索引和 P02 用途架的 import 路径。

不得迁移：

- `paper-library-v2/` 及其重复论文库实现；
- `runner/`、任务 API、mock Markdown 生成器和文件任务队列；
- `2c10` 中与 `22dd` 同名的论文库模型、存储、样式和页面核心文件。

## 3. 最终组件边界

```text
浏览器，同一来源 http://127.0.0.1:4176
├── 研究首页 / 方向探索 / 我的论文
├── 论文发现 / NUIST-CARSI 访问
├── 论文库阅读器 / 手动整理
└── Agent 输入中心
      │
      ├── localStorage：方向、用途架、个人标签、候选、固定快照
      ├── 浏览器直接 GET OpenAlex：仅用户主动检索
      └── 同源本地 API：笔记导入、原路径复制、元数据归档和恢复构建
              │
              └── 22dd 私有运行时
                  ├── 全来源扫描与重复身份检查
                  ├── 共享立即拒绝写锁
                  ├── 排他新建源材料
                  └── buildPrivateLibrary 原子重建
```

OpenAlex 检索和 CARSI 跳转不经过本机 Node 代理。Node 服务只承担明确的静态资源和本机受控写入，不成为通用网络代理、文件浏览器或命令执行器。

## 4. 三份已批准整理计划的纳入方式

以下三份既有计划继续作为各子系统的详细实施依据：

1. `docs/superpowers/plans/2026-08-30-paper-library-personal-tags.md`；
2. `docs/superpowers/plans/2026-08-30-paper-library-facet-states.md`；
3. `docs/superpowers/plans/2026-08-30-paper-library-note-import.md`。

整合实施计划必须按本规格重新编排它们，不能并行修改相同核心文件。

### 4.1 个人标签

个人标签计划完整进入 Phase A，继续使用独立键：

```text
research-console.paper-user-tags.v1
```

个人标签只参与标题搜索和个人整理，不进入 `paper-tags.json`、受控学术分面、论文元数据或 Agent 学术事实字段。导出和导入继续遵守该计划的严格、无路径 JSON 契约。

### 4.2 分面三态

分面三态计划完整进入 Phase A。标签目录先迁移，再生成新索引，最后切换兼容读取器。迁移只把已经明确记录的状态转换为基础分面；没有证据的“性能保证”“一般约束”“路径变化量”等字段不得被填满。

三态含义保持不变：

- `unrecorded`：尚未整理；
- `not_applicable`：用户或受控目录明确标记不适用；
- `pending_verification`：存在具体核验任务但尚未完成。

### 4.3 Markdown 笔记导入

笔记导入计划中的运行时抽取、七类检查、一次性 inspection、排他新建、指纹回滚、对话框和索引刷新契约继续有效。

该计划原先面向“仅笔记”的 server 路由和最终切换步骤由本规格 Phase D、E 覆盖：最终只能有一个同时承载笔记导入与候选归档的 Node 服务。不得先长期运行一套 note-only 4176，再另建一套 archive server。

## 5. Phase A：固化 `22dd` 主干与手动整理层

Phase A 完成以下工作，顺序不可交换：

1. 记录 `22dd` 当前关键文件、生成 schema 和测试基线；
2. 固化扫描器的 symlink 回归边界；
3. 执行分面三态计划并完成目录迁移和索引兼容；
4. 执行个人标签计划，并把个人标签资产增量并入已经升级的构建与发布清单；
5. 实现笔记导入的纯运行时、检查事务和浏览器交互；
6. 保留服务端接线给 Phase D 的统一路由。

分面三态先于个人标签，是因为它先升级权威标签目录、公开索引和兼容读取器；个人标签随后只叠加独立浏览器 store、搜索参数和 UI 资产，可以避免后执行的 schema/build 变更漏掉个人标签清单。两者的真实配置构建、发布包审计和浏览器验收仍在 Phase E 统一执行，不能在中间版本切换正在使用的 4176。

当前定向测试已经证明以下 symlink 场景 6/6 通过：同论文单元内 Markdown 文件别名、目录别名、外部链接和跨论文单元链接的阻断或跳过。Phase A 的任务是把这些行为纳入回归保护；只有后续全量验收发现新的具体失败时才修复，不把它描述为已知未修缺陷。

Phase A 的通过门禁是：旧索引兼容、分面迁移、个人标签、PDF/OCR/笔记阅读器、KaTeX、多笔记预览和 P02 用途架同时通过，不得以发现页可运行替代主论文库验收。

## 6. Phase B：论文发现、学校访问与候选归档

### 6.1 OpenAlex 检索

本轮只接入 OpenAlex，不扩展 Semantic Scholar、Crossref、arXiv 全文或 IEEE API。

检索必须满足：

- 只有用户点击“搜索 OpenAlex”才发送请求；
- 页面展示并允许编辑最终英文检索式；
- 默认限制近 5 年、英文、非撤稿，最多显示 10 条；
- 可选择相关度、引用量或时间排序，并明确显示排序依据；
- 请求使用 `credentials: "omit"` 和 `referrerPolicy: "no-referrer"`；
- 不发送学校身份、候选队列、本地标签、论文目录或 P02 私有状态；
- 网络失败、限流、结构异常和零结果分别展示，零结果不能解释为方向不存在；
- 引用量和开放状态只是 OpenAlex 当次返回的线索，不是质量或可访问性的证明。

### 6.2 NUIST/CARSI 学校访问

学校访问继续采用两步式人工流程：

```text
① 打开南京信息工程大学图书馆或已核验的 CARSI 平台入口并由用户登录
② 用户返回工作台，手动打开 DOI 或出版商原文页
```

公开机构配置只允许：机构 ID、显示名、图书馆首页、平台域名、公开说明页、已核验的 HTTPS CARSI 入口和受控 DOI 前缀。配置校验发现账号、密码、Cookie、Token、私钥、脚本 URL、非 HTTPS 外链或本机路径时构建失败。

`carsi_available` 只表示存在经过配置核验的入口，不表示学校已订购目标论文，也不表示用户已经登录。页面不能读取外部登录状态，不能把无法访问解释为论文不存在或认证失败。

### 6.3 候选队列

候选队列保存在：

```text
research-console.discovery-candidates.v1
```

状态机固定为：

```text
pending_screening
→ confirmed_for_archive
→ metadata_archived
```

规则如下：

- 搜索结果只有经用户点击才加入队列；
- 浏览器先按规范化 OpenAlex ID 和 DOI 阻止候选内部重复；
- `confirmed_for_archive` 必须由用户单独确认；
- 发起归档前再次展示本地 `paper_id`、目标来源、将写入的字段和“只创建 metadata.yaml，不下载全文”的说明；
- 只有归档和重建都成功后才能进入 `metadata_archived`；
- 构建失败、浏览器持久化失败或响应结构异常时不得提前改变阶段。

### 6.4 显式归档来源

本机配置增加可选但不允许推断的顶层字段：

```json
{
  "version": 1,
  "archive_source_id": "main_papers",
  "sources": [
    {
      "source_id": "main_papers",
      "path": "/本机/论文根目录",
      "catalog_path": "/本机/目录文件"
    }
  ]
}
```

`archive_source_id` 的语义是“唯一允许创建新 metadata-only 资料包的本地来源”，不是外部数据库名称。它必须精确等于 `sources` 中一个 `source_id`。

- 缺失时只禁用归档能力，扫描、构建和只读浏览仍可工作；
- 配置了未知、重复或无效 ID 时配置整体无效；
- 即使当前只有一个来源也不能默认选择第一项；
- API 请求必须再次携带当前 `archive_source_id`；请求值与重新加载的配置不一致时无写入失败；
- 浏览器从 `GET /api/v1/capabilities` 读取该 ID，只展示名称，不接触来源路径。

### 6.5 metadata-only 资料包

归档请求的顶层键严格为：

```json
{
  "version": 1,
  "confirmation": "create_metadata_only",
  "archive_source_id": "main_papers",
  "paper_id": "Zhao26-WIoT",
  "candidate": {
    "paperId": "W1234567890",
    "doi": "10.1234/example",
    "title": "Example Paper Title",
    "authors": ["Author A", "Author B"],
    "year": 2026,
    "source": "Example Journal",
    "citations": 0,
    "isOpenAccess": false,
    "openAccessUrl": null,
    "landingPageUrl": "https://doi.org/10.1234/example",
    "topics": ["Distributed optimization"],
    "abstract": null,
    "stage": "confirmed_for_archive"
  }
}
```

候选对象只允许示例中列出的 13 个键；服务端只接受规范化后的固定候选字段和 `stage: "confirmed_for_archive"`，使用目标来源根目录下的稳定 `paper_id` 创建一个新目录，并只生成 `metadata.yaml`。文件至少记录：

```yaml
paper_id: Zhao26-WIoT
title: "..."
authors:
  - "..."
year: 2026
venue: "..."
doi: "10...."
unit_type: article
archive_mode: metadata_only
archive_source_id: main_papers
candidate_source: openalex
openalex_id: W1234567890
landing_url: "https://..."
archived_at: "2026-08-30T...Z"
```

若没有 DOI，只记录规范 OpenAlex URL。可另外保存公开主题和开放入口线索，但不把候选摘要写成精读笔记、相关工作结论或证据卡。

资料包创建必须使用普通目录、同根真实路径校验、临时文件、排他创建和原子改名。目标目录或文件存在时不得覆盖、合并或自动生成 `_v2`。归档不会创建或下载 PDF、OCR、`article.md`、源码、笔记、图片、代码和仿真结果。

扫描器把直接包含合法 `metadata.yaml` 的普通目录识别为论文单元，并继续使用 `22dd` 的元数据优先级、分面、状态、预览和审计链。`metadata.yaml` 不是通用 YAML：只读取固定键、固定大小和固定标量/列表语法；未知或冲突身份按阻塞问题处理。

`archive_source_id` 必须与该资料包实际所在来源一致；不一致时扫描失败。外部 `openalex_id` 只进入私有归档身份审计，不进入个人标签、学术分面或经核验证据状态。

候选身份和本地论文身份不能直接比较：候选的 `paperId` 是 OpenAlex 的 `W…`，归档后的 `paper_id` 是用户确认的本地稳定 ID。浏览器刷新公开索引后，按以下顺序保守对账：

1. 候选有 DOI 时，只接受唯一的规范化 DOI 匹配；
2. 候选无 DOI 时，只接受公开 `doi_or_url` 中唯一的规范 OpenAlex `https://openalex.org/W…` URL 匹配；
3. 即时归档或恢复响应还必须用服务端返回的本地 `paper_id` 定位同一条公开索引记录；
4. 全部匹配后，候选存储仍以原 OpenAlex ID 调用 `markMetadataArchived`；缺失、多匹配或身份冲突一律保留 `confirmed_for_archive`。

不得按标题、作者、年份或“候选 ID 等于本地 paper_id”猜测。公开索引不为此增加独立 `openalex_id`、候选来源或私有审计字段。

### 6.6 多来源重复检查与 fail-closed

每次归档在取得共享写锁后重新加载配置并完整扫描所有来源，随后跨全部来源检查：

1. 本地稳定 `paper_id`；
2. 规范化 DOI；
3. `candidate_source + openalex_id`；
4. 目标来源中的同名资料包目录。

任一来源不可读、扫描不完整、审计身份有歧义、已有重复外部身份或构建上下文与请求不一致时，归档必须停止且不创建目录。系统不得因为目标来源可写就忽略其他来源，也不得只检查公开 `paper-index.json` 的上一版内容。

## 7. Phase C：Agent 输入中心

Agent 中心本轮是“任务输入整理器”，不是 Agent 运行器。页面只提供：

1. 当前研究方向快照预览；
2. 当前 P02 用途架中已选论文及公开书目、状态、用途预览；
3. 将已经核对的当前输入固定为不可变快照；
4. 按时间展示历史固定快照并切换当前快照。

方向快照固定使用：

```text
research-console.direction-snapshot.v1
```

固定输入使用：

```text
research-console.agent-task-input.v1
research-console.agent-task-input.v1.current
research-console.agent-task-input.v1.snapshot.<snapshot_id>
```

快照只允许包含：项目 ID、保存时间、受控方向轴、稳定论文 ID、公开书目字段、P02 用途、论文核验/证据/复现状态和空的 `note_fragment_refs`。固定后，后续修改方向或用途架不能反向修改历史快照。

以下内容不进入快照：

- PDF、OCR、笔记或代码正文；
- 绝对路径和原始相对路径；
- 浏览器候选摘要；
- 学校会话、URL 访问历史和个人标签；
- 自由 prompt、system prompt、环境变量或凭据。

页面不调用模型、不调用外部研究工具、不读取私有全文、不启动 shell、不写 Markdown 结果，也不自动判断创新性、正确性或可投稿性。`2c10` 的 mock 运行按钮、模拟候选结论和任务服务不进入本轮；“历史列表”只表示已经固定的输入快照，不伪装为已运行任务。

Agent 页面读取索引时复用 `22dd` 已兼容当前/上一版索引的严格加载器，不能引入 `paper-library-v2` 或更宽松的第二套 paper 校验。

## 8. Phase D：单一 Node 服务

### 8.1 运行方式

正式入口只绑定：

```text
http://127.0.0.1:4176
```

生产 CLI 不提供 `--host` 和任意端口参数。底层启动函数只为自动测试允许注入端口 `0`。端口被占用时明确退出，不探测、终止或替换现有进程。

服务启动前加载 `22dd` 本机配置并完成一次完整构建。首次构建失败时不监听。运行期间某次写操作重建失败时继续提供上一版完整生成物，并进入第 10 节定义的恢复状态。

### 8.2 精确静态 allowlist

静态处理器只接受 `GET` 和 `HEAD`。`/` 精确重定向到论文库。允许的资源只有：

| 路径 | 允许内容 |
| --- | --- |
| `/local_library_output/desktop/library.html` | 当前原子构建的论文库页面 |
| `/local_library_output/desktop/discovery.html` | 当前原子构建的发现页面 |
| `/local_library_output/desktop/state-transfer.html` | 不在主导航出现的白名单状态迁移页 |
| `/local_library_output/desktop/assets/<name>` | 构建器固定清单中的 CSS、MJS、公开 `nuist.institution.json`、KaTeX 文件和字体 |
| `/prototype/desktop/index.html` | 研究首页 |
| `/prototype/desktop/directions.html` | 方向探索 |
| `/prototype/desktop/p02.html` | 我的论文 |
| `/prototype/desktop/agent-tasks.html` | Agent 输入中心 |
| `/prototype/desktop/<approved-asset>` | 上述四页在固定清单中声明的 CSS、MJS 和受控字体 |
| `/local_library_data/paper-index.json` | 页面用脱敏论文索引 |
| `/local_library_data/notes/<slug>/<approved-preview>` | 构建器生成的笔记 HTML 和哈希图片 |
| `/local_library_data/sources/<slug>/<pdf-or-ocr-or-asset>` | 构建器生成的哈希 PDF、OCR HTML 和受控图片 |

`<name>` 和 `<approved-asset>` 不是目录通配：启动时由代码内固定资产清单与构建结果清单共同决定。笔记和原始材料路径必须满足既有 slug、类别、64 位小写哈希、扩展名及真实路径规则。

以下资源无条件 404：

- `local_library_data/paper-library-audit.json`；
- `local_library_config/`、机构源配置目录和任何本机目录文件；
- 论文源根、工作区其他文件、`.git/`、环境文件和日志；
- 未列入固定清单的新文件；
- 目录、目录列表、符号链接、路径穿越、编码后的父目录和反斜杠路径。

### 8.3 精确 API allowlist

仅存在以下路由：

| 方法与路径 | 职责 | 是否取得写锁 |
| --- | --- | --- |
| `GET /api/v1/capabilities` | 返回 API 版本、可用能力、材料类别和 `archive_source_id`，不返回路径 | 否 |
| `POST /api/v1/notes/inspect` | 检查 Markdown 并创建短期一次性 inspection | 否 |
| `POST /api/v1/notes/import` | 排他新建笔记并重建 | 是 |
| `POST /api/v1/papers/source-path` | 用户明确点击后返回一次源目录用于剪贴板 | 否 |
| `POST /api/v1/archive/candidates` | 二次确认后创建 metadata-only 资料包并重建 | 是 |
| `POST /api/v1/archive/rebuild` | 对已创建但未进入当前索引的受控资料包重试完整构建 | 是 |

OpenAlex、CARSI 和 Agent 中心没有本机 API。旧 `/api/archive-candidate`、`/api/tasks`、`/api/health`、任意文件读取和未知 `/api/*` 固定返回 404。

所有 POST 必须同时满足：

- `Host` 精确为当前 `127.0.0.1:4176`；
- `Origin` 精确同源；
- `Sec-Fetch-Site` 缺失或为 `same-origin`，浏览器请求必须为 `same-origin`；
- `Content-Type` 为 `application/json`；
- 请求体不超过该端点固定上限；
- 若端点声明操作头，`X-Research-Console-Action` 必须与该路由固定值相同；
- 不发送 CORS 允许头，响应使用 `Cache-Control: no-store`；
- 错误只返回固定码、`paper_id` 或文件基名，不返回堆栈和路径。

### 8.4 共享立即拒绝写锁

笔记导入、候选归档和归档恢复共用同一个进程内写锁。锁是 `tryAcquire` 语义，不是 Promise 队列：

- 锁空闲时，一项操作从重新加载上下文开始持有到源事务、构建、回滚或恢复结束；
- 锁已占用时立即返回 `409 LIBRARY_WRITE_BUSY`；
- 不建立后台队列、不在浏览器关闭后继续等待执行；
- 笔记检查、能力读取和源路径复制不占用写锁；
- 任一写操作不能绕过共享锁直接调用构建器。

这取代 `aa09` 的归档 Promise 队列，并延续笔记导入计划“忙碌不消费 inspection、真正取得锁后消费”的契约。

## 9. 浏览器状态与跨端口迁移

最终同源保留以下状态：

| 键 | 所有者 |
| --- | --- |
| `research-console.direction-snapshot.v1` | 方向探索 |
| `research-console.paper-library.v1` | 阅读状态与 P02 用途架 |
| `research-console.paper-user-tags.v1` | 个人标签 |
| `research-console.discovery-candidates.v1` | 候选队列 |
| `research-console.agent-task-input.v1` 及合法 current/snapshot 附属键 | Agent 固定输入历史 |

端口属于浏览器来源的一部分，因此 4177、4178 中的状态不会因为最终页面改到 4176 而自动出现。迁移采用用户可见的一次性导出/导入，不通过跨域读取或浏览器配置文件复制。

### 9.1 导出

切换前在每个确有数据的旧端口临时提供一个只含迁移工具的精确页面。页面只读取上述白名单键，并调用对应模块的公共验证器生成一个版本化 JSON 包：

- 不导出其他 localStorage、sessionStorage、Cookie、缓存和 IndexedDB；
- Agent 的 `.pending.*` 临时键不导出，先通过 store 读取器恢复为有效 committed snapshot；
- 不导出 PDF、笔记正文、候选访问历史、路径和本机配置；
- 数据包显示来源 origin、生成时间、各类记录数和 SHA-256，用户手动保存或复制。

迁移页的可执行依赖闭包也是固定白名单。除 `state-transfer.html` 外，旧端口临时服务和最终生成页只允许加载：`state-transfer.mjs`、`direction-snapshot.mjs`、`agent-task-input.mjs`、`paper-library-storage.mjs`、`paper-user-tags.mjs`、`candidate-storage.mjs`、`paper-library-model.mjs` 与 `styles.css`。构建、临时服务和最终服务必须分别测试每项可访问，并证明页面、测试源码、模板及其他仓库文件仍为 404。

### 9.2 导入

4176 的迁移页面先完整校验数据包，再预览冲突；任何未知键、额外字段、超限内容或单项结构错误都拒绝整包写入。

合并规则固定为：

- 个人标签调用既有 merge-only 导入；
- 候选按 OpenAlex ID 和 DOI 合并，身份相同而正文不同则拒绝；
- Agent 快照按 `snapshot_id` 合并，ID 相同而内容不同则拒绝，current 指针默认保留 4176 当前值；
- 单值方向快照默认保留 4176，只有用户在差异预览中明确选择才替换；
- 论文工作区状态默认保留 4176，冲突时按整份来源让用户二选一，不猜测阅读状态优先级。

写入使用各 store 的公共 API，不能直接批量 `setItem`。全部目标写入成功后才报告完成；失败时恢复导入前的白名单快照。验证工作台页面正常后，旧端口数据仍不自动删除。

## 10. 重建失败、last-good 与恢复

`buildPrivateLibrary` 继续先写暂存目录，全部成功后才原子替换 `local_library_data/` 和 `local_library_output/`。因此任何重建失败都不得破坏上一版可浏览结果。

### 10.1 笔记导入失败

沿用笔记计划：只有本次排他新建的 Markdown 的设备、inode、大小和哈希仍一致时才删除；回滚失败则停止后续写入并要求人工检查。网页永不显示源绝对路径。

### 10.2 候选归档重建失败

元数据资料包已经经过用户二次确认，因此重建失败后保留该资料包，不自动删除。响应明确区分：

```json
{
  "status": "created",
  "paper_id": "Zhao26-WIoT",
  "rebuild_status": "failed",
  "index_state": "last_good",
  "recovery_required": true
}
```

浏览器必须：

- 保持候选为 `confirmed_for_archive`；
- 显示“资料包已创建，论文库仍是上一版”；
- 不显示为已归档、已读、已核验或已进入证据库；
- 提供用户主动触发的“重新构建论文库”。

恢复请求只携带 `archive_source_id`、`paper_id`、`openalex_id` 和固定确认值。服务重新扫描所有来源，确认目标目录内是同一受控 metadata-only 资料包且身份完全一致，再执行构建；它不重写 metadata、不接受路径。恢复成功后候选才能进入 `metadata_archived`。

若用户刷新页面后再次提交同一候选，服务检测到完全匹配的受控资料包但当前索引尚未包含它时返回 `ARCHIVE_REBUILD_REQUIRED`，而不是普通重复冲突；不完全匹配仍返回 `ARCHIVE_CONFLICT`。

## 11. Phase E：验收、4176 切换与回退

### 11.1 切换前

1. 在临时来源和临时生成目录完成全部自动测试；
2. 底层 Node 服务使用系统分配端口完成静态与 API 集成；
3. 在独立浏览器上下文完成 1280×720、1440×900 视觉与交互验收；
4. 对 4177、4178 分别记录“迁移白名单状态”或“明确无需迁移”的决定；需要迁移时导出并保存校验摘要；
5. 记录 4176、4177、4178 每个现有监听进程的 PID、命令、工作目录和恢复命令，在停止后保留可逆恢复记录。

### 11.2 正式切换

只有全部验收通过后：

1. 再次确认占用 4176 的进程仍是记录的 Python 预览服务；
2. 对该精确进程发送正常终止信号并确认端口释放；
3. 从 `22dd` 启动 Node 服务；
4. 确认监听地址只有 `127.0.0.1:4176`，进程工作目录属于 `22dd`，并确认 4177、4178 均无监听；
5. 访问首页、方向、发现、论文库、我的论文和 Agent 中心；
6. 导入经过验证的跨端口白名单状态；
7. 重新执行同源状态、静态拒绝和 API 冒烟测试。

### 11.3 回退

从停止第一个旧端口监听进程开始，到 4176 状态包导出并校验、最终 Node 取得端口、能力检查通过、状态导入完成且 4177/4178 已确认无监听为止，整个过程设一个立即回退门。若迁移页启动、导出、JSON/SHA-256 校验、Node 启动、端口归属、能力检查或事务式导入任一步失败：

- 停止本次启动的精确迁移进程或 Node 进程；
- 确认 4176 已释放；
- 使用此前记录的工作目录和命令恢复旧 Python 4176；
- 对切换过程中已停止的原 4177/4178 服务逐一恢复原运行态；
- 冒烟确认旧只读页面可用后终止本次切换，不继续后面的导入或验收；
- 不删除源资料包、生成 last-good 或任何 localStorage；
- 保留已经导出的迁移包和 SHA-256 记录以便排查；
- 报告失败阶段和固定错误码后再修复。

该回退只能恢复切换前的旧只读界面，不能提供已经整合的发现、写入和 Agent 页面；因此它是可用性回退，不是整合完成状态。

成功切换后的回退演练也必须双向补偿：若旧 Python 无法启动或冒烟失败，立即恢复并验证刚停掉的 Node；若旧 Python 已经验证并停止、但 Node 重启失败，则再次恢复旧 Python 并保持其运行。任一补偿都用 PID、cwd、`lsof` 和页面冒烟证明，不能以“演练失败”结束在 4176 无监听的状态。

## 12. 隐私与安全边界

- 服务只绑定回环地址，不开放局域网和公网；
- 不集成 IEEE 全文 API，不保存任何 API key；
- 不保存或代填学校账号、密码、验证码、Cookie、Token 或会话；
- 不复用浏览器学校登录 Cookie 抓取出版商页面；
- 不自动下载 PDF、OCR、结构化全文、源码、图片或代码；
- 不绕过订阅、付费墙、验证码和数据库使用限制；
- 不把候选元数据当作原文核验、证据卡、理论结论或写作引用；
- 不把个人标签当作论文事实；
- 不让 Agent 中心读取全文、笔记正文、本机路径或凭据；
- 不提供任意路径、任意 URL、任意命令、任意 prompt 或通用文件上传接口；
- 生成网页、公开索引、浏览器存储迁移包和 GitHub 包不得包含绝对路径；HTTP 仅允许用户明确点击复制源目录后，`POST /api/v1/papers/source-path` 的成功、同源、`no-store` 响应返回该路径，DOM、localStorage、console、日志、错误响应和其他 API 响应仍不得包含路径；
- 私有审计可在磁盘保存定位信息，但不能通过静态服务或 API 返回。

## 13. 明确非目标

- 多学术来源聚合、自动相关论文扩展和引用网络；
- IEEE、Web of Science、Scopus 或知网自动检索、登录和下载；
- 自动获取 arXiv LaTeX、JATS、HTML 或 PDF；
- 自动 OCR、自动生成精读笔记或自动判断论文质量；
- Agent/模型调用、system prompt 执行、后台任务、任务队列和 Markdown 研究结果；
- 自动合并旧笔记正文或批量改写真实论文目录；
- 移动、改名或按方向重排现有论文资料包；
- 移动端、多人协作、云同步、账号系统和数据库；
- 把本地论文库、候选、学校入口使用记录或固定快照发布到 Quartz 或 GitHub。

## 14. 完整验收矩阵

### 14.1 主干与 schema

- 22dd 全量 Node 测试通过；
- symlink 定向用例继续 6/6 通过；
- 个人标签的存储隔离、搜索、导入导出和 XSS 边界通过；
- 分面目录迁移、三态显示、新旧索引兼容和真实构建审计通过；
- PDF、OCR、KaTeX、图片、多笔记和目录显示不回归；
- 构建失败保持 data/output 两棵 last-good 不变。

### 14.2 发现与学校入口

- OpenAlex 查询 URL、近五年、英文、非撤稿、最多十条和三种排序有单测；
- 未主动点击时不发送 OpenAlex 请求；
- 网络、429、无效 JSON、缺字段和零结果均保守呈现；
- DOI、题名、HTTPS 地址、平台冲突和未知平台按既定优先级处理；
- `nuist.json` 凭据扫描、HTTPS 校验、CARSI/说明页语义和公开打包通过；
- 所有外部按钮都有可见普通链接和新窗口说明。

### 14.3 候选与多来源归档

- 候选队列限制、跨标签页刷新、OpenAlex ID/DOI 去重和持久化失败恢复通过；
- 未确认候选、缺二次确认、无效 `paper_id` 和额外字段均被拒绝；
- 缺失 `archive_source_id` 时归档能力关闭；
- 未知或过期 `archive_source_id` 不写入；
- 任一来源扫描失败时不写入；
- 任一来源已有相同 paper ID、DOI 或 OpenAlex ID 时返回 409；
- 成功只在目标来源创建一个普通目录和一个 `metadata.yaml`；
- 路径穿越、symlink、目录碰撞、临时写失败和改名失败均不覆盖旧资料；
- metadata-only 单元进入 22dd 索引时仍为未读、未核验、无证据卡且无全文材料。

### 14.4 Agent 输入中心

- 缺方向、缺用途架、索引不可用、索引缺失 ID 和不安全元数据分别显示；
- 只有完整核对的实时输入可以固定；
- 固定快照不随来源改变；
- 历史快照稳定排序，重复 ID 不覆盖，损坏记录 fail-closed；
- 快照中没有路径、全文、笔记片段、个人标签、候选摘要和凭据；
- 网络记录证明页面没有模型、Agent 和任务 API 请求。

### 14.5 统一服务

- 服务只监听 `127.0.0.1:4176`；
- 固定静态资源正常，audit、config、源目录、未知资产和路径穿越均 404；
- 未知 API、旧 archive API 和 task API 均 404；
- Host、Origin、Sec-Fetch-Site、内容类型、操作头和请求大小负例全部通过；
- 写入并发时第二项立即得到 409，测试证明没有后台队列；
- 笔记导入与候选归档互相阻塞而不是并行构建；
- 响应、HTML、JSON 和日志的公开部分不泄漏本机路径。

### 14.6 last-good 与恢复

- 候选资料包创建成功、构建失败时旧索引和旧页面字节不变；
- 候选保持 confirmed 状态并显示 recovery；
- 相同受控资料包可通过恢复路由重建，恢复后才标记 archived；
- 不同身份或被人工改写的资料包不能通过恢复；
- 服务重启后临时 inspection 失效，源文件与生成 last-good 保持可解释状态。

### 14.7 状态迁移与浏览器视觉

- 4177/4178 导出只包含白名单和合法 snapshot 附属键；
- 非白名单、pending 暂存、路径和 Cookie 不进入迁移包；
- 4176 导入的冲突预览、合并规则、全包回滚和 SHA-256 检查通过；
- 六个主要页面在同一 origin 看到一致的方向、用途架、个人标签、候选和固定快照；
- 1280×720 与 1440×900 无非预期横向滚动、遮挡和不可达控件；
- 键盘焦点、对话框 Esc/返回焦点、目录显隐和错误 aria-live 通过；
- 页面控制台无未处理异常。

### 14.8 私有资料和发布包

- 所有写入测试只使用 `mkdtemp` 创建的临时论文根，不触碰真实论文库；
- 私有 E2E、学校入口 E2E、发现/归档 E2E、Agent 集成 E2E 和 GitHub 包审计全部通过；
- GitHub 包包含程序、测试、文档和公开机构配置；
- GitHub 包不包含本机配置、生成索引、论文、候选、个人标签、固定快照、审计和绝对路径。

## 15. 完成定义

只有同时满足以下条件，三工作区整合才算完成：

1. `22dd` 保持唯一权威，核心阅读和整理能力无回归；
2. OpenAlex、NUIST/CARSI、候选队列和 metadata-only 归档在受控边界内工作；
3. 多来源归档必须显式选择 `archive_source_id` 并跨全部来源 fail-closed 去重；
4. Agent 中心只完成输入预览、固定快照和历史列表；
5. 笔记导入、候选归档和恢复构建共用立即 409 的单写锁；
6. 所有页面和白名单浏览器状态统一到 `127.0.0.1:4176`；
7. Node 完成正式切换，Python 只保留可逆回退说明；
8. 自动测试、私有边界、桌面视觉、真实构建和发布审计全部通过。
