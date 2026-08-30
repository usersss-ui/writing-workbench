# 论文库手动整理层设计

## 设计状态

本设计覆盖论文库中的三项相互配合的能力：

1. 在当前论文详情页手动添加 Markdown 笔记；
2. 为论文维护独立于学术分面的“我的标签”；
3. 把空研究分面的笼统“待核验”拆成“未记录 / 不适用 / 待核验”。

交互采用已经确认的 A 方案：在论文阅读工具栏点击“添加笔记”后打开居中的模态对话框。当前版本只做桌面端。

## 目标

- 用户能够从网页选择一份本地 `.md` 或 `.markdown` 文件，先检查格式，再把它作为指定论文的一类材料保存到该论文目录。
- 新笔记成功写入后自动重建论文库，并直接回到当前论文的相应页签查看新增材料。
- 用户能够立即增删个人标签，并通过 JSON 导出和导入完成备份或迁移。
- 个人标签不进入受控学术分面，不会被误当成原文事实。
- 页面只在确有待核验任务时显示“待核验”；普通空值显示“未记录”，“不适用”只能显式标注。
- 所有写入都以稳定 `paper_id` 为入口；普通页面、索引和导入请求不接触、不提交也不显示源目录绝对路径。只有用户明确点击现有“复制原始路径”时，本地助手才一次性返回该论文路径用于剪贴板复制。

## 非目标

- 不在浏览器内编辑已有 Markdown 正文。
- 不覆盖、重命名或移动已有 PDF、OCR、笔记、代码或结果文件。
- 不自动从互联网下载图片，也不跨目录猜测图片来源。
- 不把个人标签同步到云端、GitHub 或受控 `paper-tags.json`。
- 不自动判断论文结论是否正确，也不把“已记录标签”解释为“原文已核验”。
- 不支持手机或平板布局。
- 不改动 4178 或其他工作树、端口中的独立版本。

## 总体架构

系统增加一个仅在本机运行的 Node 助手，取代手动添加笔记时使用的 Python 静态服务器。其余浏览功能仍保持静态生成模式。

```text
浏览器论文详情页
  ├─ 浏览器本地存储：我的标签
  └─ 同源本地 API：笔记检查与导入
          ↓
    稳定 paper_id → 当前扫描得到的受控论文目录
          ↓
    不覆盖写入新 Markdown
          ↓
    复用 buildPrivateLibrary 原子重建生成目录
          ↓
    浏览器刷新索引并打开新增材料
```

三个职责保持隔离：

- `paper-user-tags.mjs` 只管理个人标签和 JSON 交换；
- `note-import.mjs` 只检查并提交一份新笔记；
- 现有 `buildPrivateLibrary` 继续负责扫描、受控预览和生成目录的事务替换。

## 本地运行时

### 公共加载层

新增 `exporter/paper-library/runtime.mjs`，集中现有 CLI 中重复使用的本机上下文加载：

```js
loadPrivateLibraryContext({ repoRoot })
rebuildConfiguredLibrary({ repoRoot, context })
```

它加载：

- `local_library_config/library.local.json`；
- `local_library_config/paper-overrides.json`；
- `local_library_config/paper-tags.json`；
- 每个来源的可选目录文件；
- 当前扫描生成的 `paper_id → 受控源目录` 映射。

现有 `build-private-library.mjs` 和新本地服务共同调用该层，避免两套配置加载规则逐渐分叉。

### 服务入口

新增：

```text
node exporter/scripts/serve-private-library.mjs --port 4177
```

服务必须：

- 只绑定 `127.0.0.1`，不提供修改绑定地址的参数；
- 启动前先完成一次私有构建，构建失败则不监听端口；
- 只提供论文库需要的生成目录和桌面页面，不公开 `local_library_config/`、审计文件或源论文目录；
- 使用单写入锁，同一时刻最多处理一项导入和重建；锁已占用时立即返回 `409 IMPORT_BUSY`，不建立后台队列；
- 除显式的 `source-path` 剪贴板接口外，API 只返回脱敏错误码与文件名，不返回绝对路径。

静态模式仍可使用 Python 服务器浏览论文库，但检测不到本地 API 时，“添加笔记”和“复制原始路径”禁用，并说明需要使用本地论文库服务启动。浏览、筛选和个人标签不依赖本地 API。

现有页面不再直接读取 `paper-library-audit.json`。为保留明确的本地操作，本地助手增加：

```text
POST /api/v1/papers/source-path
{ "paper_id": "Zhao24-DFL" }
```

该接口只在用户点击“复制原始路径”后调用，使用与写接口相同的同源保护，响应设置 `Cache-Control: no-store`。绝对路径只短暂进入剪贴板流程，不写入 DOM、localStorage、日志响应或生成索引。

## 添加笔记对话框

### 入口

“添加笔记”按钮位于论文详情的阅读工具栏，而不是只放在右侧检查器。当前详情模式会隐藏右侧检查器，因此工具栏是始终可见的稳定入口。

对话框使用原生 `<dialog>`，并与现有图片查看对话框保持一致的焦点管理：

- 打开后焦点进入材料类型；
- `Esc` 或“取消”关闭；
- 关闭后焦点返回“添加笔记”；
- 导入期间关闭按钮禁用，避免重复提交；
- 成功后关闭对话框并回到新增材料所在页签。

### 固定字段

对话框包含：

1. 当前论文稳定编号，只读显示；
2. 材料类型；
3. Markdown 文件选择；
4. 格式检查结果；
5. 建议保存名；
6. 同名处理说明；
7. “取消”和“导入并重建论文库”。

材料类型沿用现有七类受控材料：

| 类型值 | 中文名称 | 默认文件名标记 | 阅读页签 |
|---|---|---|---|
| `note` | 论文精读 | `论文精读` | 论文精读 |
| `derivation` | 推导过程 | `推导过程` | 推导过程 |
| `source_map` | 来源映射 | `source_map` | 推导过程 |
| `modeling` | 建模复盘 | `建模复盘` | 仿真描述 |
| `simulation` | 仿真描述 | `仿真描述` | 仿真描述 |
| `code_compare` | 代码对照 | `代码对比` | 代码对照 |
| `reproduction_report` | 复现报告 | `复现报告` | 仿真描述 |

建议文件名使用：

```text
{paper_id}_{类型标记}.md
```

允许用户补充简短后缀，例如 `Zhao24-DFL_论文精读_补充.md`，但服务端必须保证文件名仍含所选类型的识别标记。文件名只允许单个基名，拒绝 `/`、`\`、`..`、控制字符和绝对路径形式。

### 格式检查

文件选择后，浏览器读取文本并调用检查接口。检查结果区逐项说明：

- 是否为 UTF-8 Markdown；
- 文件大小是否不超过现有受控笔记上限 1 MiB；
- frontmatter 是否闭合；
- 若 frontmatter 存在 `paper_id`，是否与当前论文一致；
- 若 frontmatter 标题、作者或年份与当前记录不同，显示非阻塞警告；只有 `paper_id` 不一致才阻止导入；
- LaTeX 分隔符结构是否闭合；
- Markdown 图片和 Obsidian 图片引用是否安全、是否缺失。

首版只检查 `$...$`、`$$...$$`、`\(...\)` 与 `\[...\]` 的分隔符结构，不宣称公式语法正确或一定可由 KaTeX 渲染。真正的渲染结果仍由构建后的现有受控预览给出，更不表示公式推导正确。

首版只导入 Markdown 本身。图片引用按“最终目标 Markdown 所在目录”解析，并复用现有预览器以论文单元根目录为上界的规则；检查阶段和构建阶段必须得到相同的相对目标。相对图片已存在于当前论文目录时可以继续使用；缺失图片显示警告，但不会从所选 Markdown 的原目录自动搬运，也不会请求外部 URL。包含绝对路径、`file://`、路径穿越或不安全协议的图片引用直接阻止导入。

### 同名处理

服务端永不覆盖现有文件。若建议名称已存在，自动选择：

```text
{原文件名}_v2.md
{原文件名}_v3.md
```

后续版本继续使用递增整数后缀。

版本选择与创建必须在服务端同一临界区内完成，并使用排他创建；浏览器给出的最终名称仅是建议，不能作为覆盖授权。

## 本地 API

### 能力检测

```text
GET /api/v1/capabilities
```

返回固定 API 版本、是否允许笔记导入和七类材料枚举，不返回文件系统信息。

### 检查

```text
POST /api/v1/notes/inspect
Content-Type: application/json

{
  "paper_id": "Zhao24-DFL",
  "category": "note",
  "original_file_name": "补充笔记.md",
  "markdown": "# 补充笔记\n\n## 方法\n\n这里记录算法要点。"
}
```

返回：

- `inspection_id`：内存中的短期一次性检查编号；
- `suggested_file_name`；
- `checks`：通过、警告和阻塞项；
- `target_tab`；
- `expires_at`。

检查记录最多保留 10 分钟。服务重启后失效。服务在内存中保存不可变的 UTF-8 原始字节、SHA-256、`paper_id`、材料类别、原文件名、建议文件名和检查结果；不保存浏览器路径。1 MiB 上限按 UTF-8 原始字节计算，完整 JSON 请求体上限固定为 1,100,000 字节。

### 导入

```text
POST /api/v1/notes/import
Content-Type: application/json

{
  "inspection_id": "一次性检查编号",
  "requested_file_name": "Zhao24-DFL_论文精读_补充.md",
  "conflict_policy": "version"
}
```

导入接口必须重新校验检查记录中的内容哈希、当前论文映射和目标目录状态，并且只能写入检查记录保存的原始字节。检查已过期或论文目录已变化时不写入任何文件。写入锁已占用时返回 `409 IMPORT_BUSY`，检查编号不消费，浏览器可在 10 分钟有效期内重试；一旦本次导入取得写入锁，无论最终成功或失败，该检查编号都立即失效。

成功响应包含：

- `paper_id`；
- 实际新建文件的基名；
- `target_tab`；
- 新增受控预览的相对 URL；
- 新索引版本标识。

### 请求边界

- 只接受 `application/json`；
- 检查请求体上限 1,100,000 字节，导入请求体上限 16 KiB；
- `Host` 必须是当前回环地址和端口；
- 有 `Origin` 时必须与当前服务同源；
- 不发送 CORS 允许头；
- 写请求拒绝跨站 `Sec-Fetch-Site`；
- 所有错误响应使用固定代码，不包含堆栈或本机路径。

## 安全写入与回滚

浏览器只提交 `paper_id`。服务端每次导入前根据当前本机配置重新扫描，使用 `audit.private_path_lookup` 定位论文单元，绝不接受客户端目标路径。

写入步骤：

1. 重新确认来源根、论文目录和其真实路径均在已注册来源内；
2. 拒绝符号链接目录、符号链接目标和任何路径穿越；
3. 使用 `O_CREAT | O_EXCL | O_NOFOLLOW` 排他创建新文件；
4. 记录新文件的设备、inode、大小和内容哈希；
5. 直接调用 `buildPrivateLibrary`；
6. 构建成功后返回新预览；
7. 构建失败时，只有当新文件指纹仍完全一致时才删除本次新建文件。

现有 `buildPrivateLibrary` 已经先生成暂存目录，再原子替换 `local_library_data/` 和 `local_library_output/`。因此构建失败不会替换上一版生成目录。源笔记回滚失败时，服务停止后续写入，终端记录需要人工检查的精确路径，网页只显示脱敏错误和新文件基名。

## 导入成功后的页面状态

成功后控制器必须使当前索引加载缓存失效，重新获取 `paper-index.json`，不得继续复用导入前的成功缓存。

刷新后保持：

- 当前 `paper_id`；
- 详情阅读模式；
- 对应材料页签；
- 右侧目录显隐设置。

材料选择器自动定位到实际新增的受控预览。若刷新失败，页面保留当前内容并提供“重新载入索引”，不伪装成导入失败；导入结果以服务端成功响应为准。

## “我的标签”

### 独立存储

个人标签不加入现有严格的 `research-console.paper-library.v1`，以免状态版本变化导致已有阅读标记和 P02 用途架被清空。新增独立键：

```text
research-console.paper-user-tags.v1
```

新增 `prototype/desktop/paper-user-tags.mjs`，暴露：

```js
createUserTagStore(storage)
  .read()
  .tagsFor(paperId)
  .add(paperId, label)
  .remove(paperId, label)
  .exportJson()
  .importJson(text, { mode: "merge", knownPaperIds })
  .clear()
```

浏览器状态结构：

```json
{
  "version": 1,
  "papers": {
    "Zhao24-DFL": ["必读", "可作基线"]
  }
}
```

单个标签经过 NFKC 规范化和首尾空白清理；禁止控制字符、换行和路径分隔符。单标签最多 24 个 Unicode 码点，每篇最多 20 个标签，整个库最多 500 个标签。比较时不区分拉丁字母大小写，保留首次输入的展示形式。

### 显示与操作

“我的标签”显示在：

- 论文列表选中项的右侧检查器；
- 论文详情“快速概览”顶部。

用户可添加标签，点击标签后的删除标记移除。个人标签参与标题搜索框的匹配，但不出现在受控学术分面筛选器，也不改变论文的研究画像。

### JSON 导入导出

导出文件结构：

```json
{
  "schema": "research-console.paper-user-tags",
  "version": 1,
  "papers": {
    "Zhao24-DFL": ["必读", "可作基线"]
  }
}
```

导入首版只提供“合并”模式：合法标签去重后加入现有状态，不删除已有标签。根字段、版本、论文 ID 和每个标签都严格校验；文件包含未知但格式合法的 `paper_id` 时不写入该部分，并在结果中列出未匹配数量。只要存在结构错误，整个导入不落盘。

导入导出文件不包含路径、书目全文、阅读笔记或正式学术分面。

## 研究画像空值语义

`local_library_config/paper-tags.json` 从版本 2 升级为版本 3。每篇论文记录在 `record_type`、`facets` 和 `source_terms` 同级增加必需但可为空的稀疏对象 `facet_states`：

```json
{
  "version": 3,
  "papers": {
    "Zhao24-DFL": {
      "record_type": "外部论文",
      "facets": {
        "research": { "domain": ["联邦学习"], "mode": ["在线优化"] },
        "objective": ["凸"],
        "constraints": { "scope": [], "form": [], "consistency": [] },
        "oracle": { "information": ["函数值反馈"], "estimation": ["单点估计"] },
        "methods": { "framework": ["对偶平均"], "coordination": ["Push-Sum"], "operator": [] },
        "network": { "direction": ["有向"], "time": ["时变"], "balance": ["不平衡"], "mixing": ["列随机"] },
        "privacy_robustness": [],
        "results": [],
        "applications": []
      },
      "facet_states": {
        "applications": "not_applicable",
        "results": "pending_verification"
      },
      "source_terms": []
    }
  }
}
```

`facet_states` 的键只能来自现有 `FACET_PATHS` 的 18 个正式叶路径：

```text
research.domain
research.mode
objective
constraints.scope
constraints.form
constraints.consistency
oracle.information
oracle.estimation
methods.framework
methods.coordination
methods.operator
network.direction
network.time
network.balance
network.mixing
privacy_robustness
results
applications
```

允许值：

- `unrecorded` → 未记录；
- `not_applicable` → 不适用；
- `pending_verification` → 待核验。

规则：

1. 分面数组为空且未写 `facet_states` 时，默认显示“未记录”；
2. “不适用”必须由标签目录显式给出；
3. “待核验”必须对应一项明确的原文检查任务，不能由空数组自动推断；
4. 分面已有一个或多个值时，禁止为同一路径设置空值状态；
5. 空的 `source_terms` 显示“未记录”，不显示“待核验”。

迁移脚本只做确定性变更：把目录顶层 `version` 改为 3，并为当前每条记录增加空对象 `facet_states: {}`；现有分面值和原文术语不变。本轮不批量猜测 52 条记录的“不适用”或“待核验”，以后在核验论文时逐项补充。

新构建将 `paper-index.json` 升级为版本 3，并在每个公开论文对象中输出稀疏 `facet_states`。`tag-catalog.mjs`、`validateGeneratedPaper`、构建器的公开字段序列化、前端 `PUBLIC_PAPER_FIELDS`、严格记录校验和 `metadata_provenance` 必须同步接受该字段。`facet_schema.version` 升级为 2，用来表明页面同时理解分面值与空值状态。过渡期前端可以读取旧索引版本 2，并把缺失的 `facet_states` 规范化为空对象；新构建只输出版本 3。

## 错误处理

| 场景 | 页面行为 | 文件系统行为 |
|---|---|---|
| 本地助手未运行 | 禁用添加笔记，显示启动说明 | 不写入 |
| Markdown 无法读取或超限 | 对话框显示阻塞项 | 不写入 |
| frontmatter 的 `paper_id` 与目标论文冲突 | 显示冲突字段 | 不写入 |
| frontmatter 的标题、作者或年份不同 | 显示警告，允许用户确认后继续 | 尚未写入 |
| 图片引用不安全 | 显示阻塞项 | 不写入 |
| 图片引用缺失 | 显示警告，允许继续导入正文 | 只写 Markdown |
| 同名文件存在 | 展示服务端选择的 `_vN` 名称 | 不覆盖旧文件 |
| 另一项导入正在执行 | 显示“正在重建，请稍后重试” | 返回 `409 IMPORT_BUSY`，不写入 |
| 构建失败 | 显示脱敏错误并保留对话框内容 | 回滚本次新建且指纹未变化的文件；旧生成目录保留 |
| 导入成功但页面刷新失败 | 提供重新载入索引 | 新笔记保留，构建结果保留 |
| 个人标签 JSON 无效 | 显示具体结构错误 | localStorage 不变化 |

## 交付阶段

本设计拆成三个可独立验收的阶段，按顺序交付：

1. **个人标签**：独立存储、增删、搜索和 JSON 导入导出；不得改变现有工作台存储结构，也不依赖本地助手。
2. **分面空值状态**：迁移标签目录版本、输出 `facet_states`、更新三态展示；不得依赖笔记导入。
3. **本地服务与笔记导入**：增加受限 Node 服务、A 方案对话框、安全写入、重建和索引刷新。

每个阶段完成自己的单元、浏览器或构建测试后才能进入下一阶段。第三阶段完成前，静态浏览、筛选、PDF/OCR 和已有笔记预览行为必须保持可用。

## 文件边界

预计新增：

- `exporter/paper-library/runtime.mjs`：公共本机上下文与重建入口；
- `exporter/paper-library/note-import.mjs`：导入检查、文件名、路径和提交事务；
- `exporter/paper-library/local-server.mjs`：受限静态服务、API 路由和单写入锁；
- `exporter/scripts/serve-private-library.mjs`：仅回环地址的命令行入口；
- `prototype/desktop/paper-user-tags.mjs`：个人标签存储与 JSON 交换；
- 对应的单元测试文件。

预计修改：

- `exporter/scripts/build-private-library.mjs`：复用公共运行时；
- `exporter/paper-library/tag-catalog.mjs`、`status.mjs`、`build.mjs`：验证并输出 `facet_states`；
- `prototype/desktop/library.template.html`：工具栏入口、A 方案对话框和标签 JSON 文件输入；
- `prototype/desktop/library.mjs`：能力检测、对话框流程、索引失效与个人标签事件；
- `prototype/desktop/paper-inspector.mjs`：个人标签和三态空值；
- `prototype/desktop/paper-library-model.mjs`：个人标签搜索；
- `prototype/desktop/styles.css`：桌面对话框、检查结果和个人标签样式；
- `README.md`：新的本地启动方式与静态模式差异；
- GitHub 固定打包清单与相关审计测试：只加入程序和脱敏文档，不加入真实标签数据、笔记或本机配置。

## 测试策略

### 单元测试

- 个人标签：规范化、去重、上限、增删、异常 storage、严格 JSON、合并导入和未知论文报告；
- 分面状态：默认“未记录”、显式“不适用”、显式“待核验”、有值时拒绝空值状态；
- 笔记检查：七类映射、文件名、frontmatter、1 MiB 上限、公式警告和图片引用；
- 安全路径：绝对路径、`..`、符号链接、来源外目标和过期 `paper_id` 全部拒绝；
- 冲突：已有文件永不覆盖，版本名按 `_v2`、`_v3` 递增；
- 回滚：构建失败时只删除本次新建且指纹一致的文件。

### 服务集成测试

- 服务只监听回环地址；
- 非同源写请求、错误 `Host`、错误内容类型和超限请求被拒绝；
- 第一项导入持有写入锁时，第二项得到 `409 IMPORT_BUSY`；第一项结束后使用仍有效的检查编号重试能够成功；
- 成功导入后生成索引出现新材料并可读取预览；
- 构建失败时上一版生成目录仍可访问；
- 公开索引、错误响应和普通 API 不泄露本机绝对路径；只有受同源保护的显式 `source-path` 操作返回所选论文路径，并带 `Cache-Control: no-store`。

### 浏览器测试

- 工具栏入口在详情模式可见；
- 对话框焦点、`Esc`、取消、校验和忙碌状态正确；
- 成功后仍停留当前论文并切换到目标页签；
- 个人标签增删后立即重渲染，阅读标记和 P02 用途不丢失；
- JSON 导入导出和错误提示可操作；
- 1280×720 与 1440×900 下对话框无水平溢出，正文、检查结果和底部操作均可见。

### 回归验证

运行现有 exporter、桌面 DOM、模型、存储、端到端和 GitHub 私有边界审计。不得以固定历史测试数量代替实际通过结果。

## 验收标准

- 使用本地 Node 服务打开论文库时，任意现有论文都能打开 A 方案“添加笔记”对话框。
- 七类 Markdown 均能得到正确文件名标记和目标页签。
- 文件写入前完成格式与路径检查，已有文件从不被覆盖。
- 构建成功后新增材料立即出现在当前论文的材料选择器；构建失败时旧生成页面仍可使用。
- 除用户明确触发的“复制原始路径”响应外，浏览器请求、生成数据和错误响应均不包含源目录绝对路径。
- “我的标签”可以增删、搜索、导出和合并导入，但不会进入正式分面。
- 已有阅读标记和 P02 用途架在个人标签功能启用后保持不变。
- 普通空分面显示“未记录”；只有显式状态显示“不适用”或“待核验”。
- 源 PDF、OCR、已有笔记、代码与结果文件均未被覆盖、移动或改名。
- 桌面浏览器测试、构建测试和私有边界审计全部通过。
