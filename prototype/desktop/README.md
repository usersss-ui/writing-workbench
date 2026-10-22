# 桌面端学术研究工作台原型

本目录是桌面版设计原型，推荐在 1440 × 900 查看，并已验证 1280 × 720。它不包含手机端和平板端布局，也不读取私人 Vault。

搜索页默认“全部结果”，质量未知和待核验论文仍可见；切换“重点推荐”使用同一批结果，不额外检索。展开“条件、检索组合与来源”可预览原式与扩展式：默认原样执行手写式，明确勾选扩展后每批最多六条查询、最多两路并发，每页 25 条，下一页需手动加载。唯一论文数、查询匹配数和来源记录数含义不同，都不代表全领域总量。

Scholar／知网入口与 BibTeX／RIS 导入需要人工操作，并非全自动抓取。导入先预览再确认，重复 DOI 合并来源；身份冲突留待核验。重点推荐需要可追溯期刊、范围、条件和代表性证据；JCR 使用明确年度的 JIF Q1/Q2，默认 Automation & Control Systems。没有证据不会因为关键词命中而推荐，撤稿结果不会推荐。缺 OpenAlex 身份的外部候选暂不能正式归档。PDF、OCR、笔记不会自动下载或生成，本地 PDF 和笔记状态独立显示。

外部文件限 2 MiB／500 条，新工作区保存上限为 1,000 条题录及 4 MiB 序列化数据；旧候选队列仍为 100 条。超限或写入失败显示未保存，当前临时结果可查看及选择导出，关闭页面可能丢失；完整备份只收录已保存状态。version 3 完整备份覆盖新工作区，可读取 version 1／2；旧备份缺少的新 owner 保留当前内容。

## 本地预览

如需查看由本机论文目录生成的私有论文库，先在仓库根目录运行：

```bash
node exporter/scripts/build-private-library.mjs
node exporter/scripts/serve-private-library.mjs
```

服务启动后，推荐从研究首页进入：

```text
http://127.0.0.1:4176/prototype/desktop/index.html
```

也可直接打开[本地论文库](http://127.0.0.1:4176/local_library_output/desktop/library.html)。页面由本地文件提供，笔记导入等功能使用本机服务；当前没有完成 Quartz 集成。

### 日常使用

主线是：方向 → 本地/在线搜索 → 阅读分析与笔记 → 期刊与写作。

1. 在“确定方向”填写关键词，可指定年份和语言并直接搜索真实论文。研究条件组合为折叠的可选工具，不再用固定样例和统计判断研究缺口。
2. 网上搜索每页 25 篇，可继续加载；年份留空、语言不限时不额外限制。每条结果标注本地已有 PDF、已收录但缺 PDF、未匹配或疑似重复，索引失败显示未知。唯一标识才确认已收录，相似题名须人工核对。搜索不上传本地论文、不自动下载；可直接进入本地阅读或打开公开全文来源。OpenAlex 单一来源不保证穷尽文献。
3. 使用“手工分析 / 笔记草稿”填写问题、方法和结果。这是手动模板，尚未接通 AI 全文分析；临时草稿只保留在当前页面。离开前下载 Markdown，并确认文件已经保存。要写回源资料，先点击“检查并导入笔记”，核对检查结果，再明确确认导入。
4. 到“期刊与写作”记录候选期刊与参考链接，人工核对官网要求，直接编辑正文、保存草稿或导出 Markdown。历史静态材料默认折叠，仅作参考。

写作页与现有 P02 研究记录（workflow）共用当前浏览器中的内容，不要求先完成全部研究阶段。更换浏览器、电脑或端口前，先用“更多工具 → 备份与恢复”导出浏览器状态，包含 P02 写作草稿；Markdown 导出只用于保留正文与研究材料。P02 高级记录、研究任务输入和备份等功能集中在“更多工具”。

[应用投稿项目](http://127.0.0.1:4176/prototype/desktop/submission-project.html)提供场景与数据集选择、实验清单、自填证据、候选期刊、研究材料和独立正文编辑。它通过本机 Node 服务保存到仓库根目录下的 `local_library_config/submission-project-state.json`，不覆盖 P02 的浏览器草稿。项目内完整 JSON 导出包含正文、证据与研究材料快照；浏览器状态备份不包含这个磁盘项目，迁移电脑前须另行导出项目 JSON。Python 静态预览不提供该项目的读取与保存 API。

### 本地运行、恢复与迁移边界

上面的 Node 服务固定监听 `127.0.0.1:4176`，并会在监听前执行一次受保护的重建。它是日常完整功能入口：PDF/OCR/预览、受控笔记导入、候选归档和恢复重建都应通过它使用。停止服务时在该终端按 `Ctrl-C`；从其他终端停止前必须核对并仅终止该服务 PID：

```bash
lsof -nP -iTCP:4176 -sTCP:LISTEN
ps -ww -p <validated-pid> -o pid=,ppid=,command=
lsof -a -p <validated-pid> -d cwd -Fn
kill -TERM <validated-pid>
```

启动或重建失败时，保留现有生成物并修正本机配置后重新运行 `node exporter/scripts/build-private-library.mjs`；不要删除源论文目录。归档重建若失败，最后一次成功的索引和页面仍会保留。出现“需要恢复”时，普通写入会锁定：不要重试归档或手改生成文件，应保留资料包，核对横幅显示的固定 `archive_source_id`、`paper_id` 和 `openalex_id` 后点击“恢复重建”。资料包身份/完整性不符或重建失败时会继续锁定，避免错误写入。

只需查看既有生成页面、并且 Node 服务无法运行时，可在确认 4176 空闲后使用只读回退：

```bash
python3 -m http.server 4176 --bind 127.0.0.1
```

这个模式可浏览、筛选及打开既有 PDF/OCR/预览，但不能添加笔记、归档候选、恢复重建或复制原始路径。该临时静态服务器没有 Node 服务的精确资源白名单，只能绑定 `127.0.0.1`，不得改成局域网或公网地址。要恢复完整功能，先停止该 Python 服务，再启动 `node exporter/scripts/serve-private-library.mjs`。

#### 多个来源、`metadata-only` 与待核验

本机 `library.local.json` 可以在 `sources` 中配置多个互不重叠的根目录；每项使用稳定唯一的 `source_id` 和占位符替换后的本机路径，`archive_source_id` 必须精确选择其中一个作为唯一归档目标。多个根目录不会自动合并为可写目录，扫描仍默认只读。

“待核验”表示某个正式分面还没有足够证据，不能把它读作“不适用”或“论文没有提及”。`metadata-only` 表示候选已保存可追溯元数据和稳定论文 ID，但还没有 PDF、OCR 或笔记预览。正确流程是先归档 `metadata-only` 候选，再在同一论文 ID 下补充 PDF，并用受控笔记导入补充 Markdown/预览；补料并不自动把研究结论改成已核验。

#### 研究状态备份与 Task 15 受控切换

个人标签以及方向、书架、阅读状态、候选、Agent 输入快照和广泛检索工作区由本机 Node 服务（`workbench-storage.mjs` 适配器与 `/api/v1/workbench-state`）同步写入 `local_library_config/workbench-state/`，换浏览器或端口不会丢失；P02 研究记录（含写作草稿）仍在浏览器 localStorage。旧浏览器 localStorage 中这些键的历史内容不会自动迁移。更换电脑前，复制 `local_library_config/workbench-state/`，或用“更多工具 → 备份与恢复”（`http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html`）导出状态 JSON 备份（含磁盘状态与 P02 研究记录），保存在私有位置。此备份不包含磁盘上的应用投稿项目；应从[项目页](http://127.0.0.1:4176/prototype/desktop/submission-project.html)另行导出包含正文、证据与材料快照的完整 JSON。“导出标签”只备份个人标签。个人标签导入只合并已知论文并统计跳过的未知论文；浏览器状态包 version 3 会先生成预览，再要求用户对每个状态 owner 的冲突作出显式决定。P02 与广泛检索工作区按各自整份文档冲突处理并默认保留当前状态；旧 version 1／2 缺少的 owner 不会清空当前内容。原备份不应自动删除。

日常启动不迁移旧端口。只有 **Task 15 受控切换** 才可迁移 4176/4177/4178 的状态：记录旧 PID、命令、cwd 和重启命令；针对当前端口临时执行 `node exporter/scripts/serve-state-transfer.mjs --port 4176`、`--port 4177` 或 `--port 4178` 中的一个命令，在 `http://127.0.0.1:<port>/state-transfer.html` 导出 JSON 并记录 SHA-256；释放端口、启动最终 Node 服务后，在 `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html` 预览、核对并按每个状态 owner 显式解决冲突再导入。若导出、摘要校验、端口所有权或新服务检查失败，停止本次切换进程，按记录恢复旧服务，保留备份；绝不静默跨源复制。

#### GitHub 包边界

公开候选包只收录 `exporter/config/github-package-files.json` 精确文件清单中的程序、模板、测试（包括六个只使用临时根目录的 Task 14 E2E 源文件）、脱敏示例、说明和获许可 KaTeX 资源，并由 `node exporter/scripts/audit-github-package.mjs` 检查。真实论文/PDF/OCR/笔记/仿真结果、本机配置与生成目录、状态导出 JSON、审计和截图一律排除；审计通过不等于已获准公开。

### 研究画像空值

正式分面值仍来自 `local_library_config/paper-tags.json`。目录 version 3 为每篇记录增加稀疏 `facet_states`：空数组且没有状态时显示“未记录”；只有人工明确写入 `not_applicable` 或 `pending_verification` 时，页面才显示“不适用”或“待核验”。已有分面值与同路径状态不能同时存在，空的原文术语也只显示“未记录”。

旧 version-2 目录只迁移结构，不推断结论：

```bash
node exporter/scripts/migrate-paper-tags-v3.mjs local_library_config/paper-tags.json
node exporter/scripts/build-private-library.mjs
```

新构建输出 index version 3 和 facet schema version 2；桌面页面仍可临时读取旧的 `2/1` 生成物，并把缺失状态按“未记录”处理。

### 我的标签

- 标签以 `research-console.paper-user-tags.v1` 保存在本机 `local_library_config/workbench-state/`，不会写入论文目录、`paper-tags.json` 或正式研究分面。
- 单标签最多 24 个 Unicode 码点；每篇论文最多 20 个；整个库最多 500 个标签记录。
- 标签参与页面顶部搜索，可在论文检查器或详情页“快速概览”中添加和移除。
- “导出标签”下载只含论文编号与个人标签的 JSON；“导入标签”只合并，不会删除已有标签。
- 导入文件中的未知论文编号会被跳过并计数；任一结构或标签错误会取消整次导入。
- 更换浏览器、浏览器配置或电脑前，请先导出 JSON；该功能不依赖本地笔记导入服务。

论文阅读器使用随项目保存的 KaTeX 0.16.47 静态资源排版行内与块级公式，不依赖外网。第三方许可保存在 `vendor/katex/LICENSE`；构建只复制样式实际引用的 WOFF2 字体。

若只想单独预览未生成的原型页面（研究首页、方向探索和 P02），可在确认没有完整论文库服务占用 4176 后，在仓库根目录运行：

```bash
python3 -m http.server 4176 --bind 127.0.0.1
```

然后打开：

```text
http://127.0.0.1:4176/prototype/desktop/index.html
http://127.0.0.1:4176/prototype/desktop/directions.html
http://127.0.0.1:4176/prototype/desktop/p02.html
http://127.0.0.1:4176/prototype/desktop/p02-writing.html
```

四个地址分别是研究首页、方向页、P02 高级研究记录和期刊与写作页；页面可以通过左侧导航及“更多工具”互相到达。此模式不提供论文库的归档、笔记导入或恢复 API，但写作页仍可编辑、保存浏览器草稿和导出 Markdown。需要完整论文库时，停止该 Python 服务后改用上文的 Node 服务。

P02 工作台把旧阅读笔记定位为“算法机制库”，并把收敛性、收敛率、共识/跟踪误差、约束违背、通信复杂度与遗憾界放入独立的理论结果层。缺少整理时显示“未检查原文”，不等同于原论文没有报告；首页也不再用没有事实依据的百分比表示理论进度。

需要深入整理算法、证明与实验时，可在“更多工具 → P02 研究记录”中使用 `算法规划 → 理论目标 → 理论分析 → 仿真验证 → 写作与期刊` 五个辅助阶段，并关联算法机制、理论分析、仿真基线和相关工作四类来源。它们不是日常主线的必经步骤。阶段“确认”只代表成为下一阶段输入；理论仍需逐项核验，仿真只记录用户手工执行的计划和结果。上游内容或论文用途改变时，下游文本会保留但标记为待复核。期刊与写作页可直接修改同一份写作内容、保存并导出 Markdown；原有静态审查材料折叠保留。候选期刊与同刊论文只用于学习结构与表达，投稿要求仍需人工核对官方来源。

## 验证

```bash
node --test prototype/desktop/*.test.mjs
node --check prototype/desktop/*.mjs
```

方向筛选拆分为主题、网络方向、拓扑变化、权重平衡性、约束耦合、反馈、通信、隐私、算法家族和理论保证 10 个维度，采用“同维度 OR、跨维度 AND”，并提供阅读状态与研究贡献排序。方向页的样例论文和项目内容用于界面演示，不代表已验证的研究缺口；本地论文库与写作页分别使用生成资料和当前浏览器研究记录。
