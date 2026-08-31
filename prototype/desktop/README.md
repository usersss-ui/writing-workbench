# 桌面端学术研究工作台原型

本目录是桌面版设计原型，推荐在 1440 × 900 查看，并已验证 1280 × 720。它不包含手机端和平板端布局，也不读取私人 Vault。

## 本地预览

如需查看由本机论文目录生成的私有论文库，先在仓库根目录运行：

```bash
node exporter/scripts/build-private-library.mjs
node exporter/scripts/serve-private-library.mjs
```

本地生成页地址是：

```text
http://127.0.0.1:4176/local_library_output/desktop/library.html
```

该页面仍是本地静态输出；当前没有完成 Quartz 集成。

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

#### localStorage 备份与 Task 15 受控切换

个人标签以及方向、书架、阅读状态、候选、Agent 输入快照都可能保存在浏览器 localStorage。更换浏览器、电脑或端口前，先从“导出标签”或 `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html` 导出严格 JSON 备份，保存在私有位置。个人标签导入只合并已知论文并统计跳过的未知论文；完整状态包会先生成预览，再要求用户对每个状态 owner 的冲突作出显式决定。原备份不应自动删除。

日常启动不迁移旧端口。只有 **Task 15 受控切换** 才可迁移 4176/4177/4178 的状态：记录旧 PID、命令、cwd 和重启命令；针对当前端口临时执行 `node exporter/scripts/serve-state-transfer.mjs --port 4176`、`--port 4177` 或 `--port 4178` 中的一个命令，在 `http://127.0.0.1:<port>/state-transfer.html` 导出 JSON 并记录 SHA-256；释放端口、启动最终 Node 服务后，在 `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html` 预览、核对并按每个状态 owner 显式解决冲突再导入。若导出、摘要校验、端口所有权或新服务检查失败，停止本次切换进程，按记录恢复旧服务，保留备份；绝不静默跨源复制。

#### GitHub 包边界

公开候选包只收录 124 项固定清单中的程序、模板、测试（包括六个只使用临时根目录的 Task 14 E2E 源文件）、脱敏示例、说明和获许可 KaTeX 资源，并由 `node exporter/scripts/audit-github-package.mjs` 检查。真实论文/PDF/OCR/笔记/仿真结果、本机配置与生成目录、状态导出 JSON、审计和截图一律排除；审计通过不等于已获准公开。

### 研究画像空值

正式分面值仍来自 `local_library_config/paper-tags.json`。目录 version 3 为每篇记录增加稀疏 `facet_states`：空数组且没有状态时显示“未记录”；只有人工明确写入 `not_applicable` 或 `pending_verification` 时，页面才显示“不适用”或“待核验”。已有分面值与同路径状态不能同时存在，空的原文术语也只显示“未记录”。

旧 version-2 目录只迁移结构，不推断结论：

```bash
node exporter/scripts/migrate-paper-tags-v3.mjs local_library_config/paper-tags.json
node exporter/scripts/build-private-library.mjs
```

新构建输出 index version 3 和 facet schema version 2；桌面页面仍可临时读取旧的 `2/1` 生成物，并把缺失状态按“未记录”处理。

### 我的标签

- 标签只保存在当前浏览器的 `research-console.paper-user-tags.v1`，不会写入论文目录、`paper-tags.json` 或正式研究分面。
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
http://127.0.0.1:4176/prototype/desktop/
http://127.0.0.1:4176/prototype/desktop/directions.html
http://127.0.0.1:4176/prototype/desktop/p02.html
```

三个地址分别是研究首页、独立的“方向探索”页和 P02 个人论文工作台；页面可以通过左侧导航互相到达。这同样是静态只读预览，不提供论文库的归档、笔记导入或恢复 API；需要完整论文库时，停止该 Python 服务后改用上文的 Node 服务。

P02 工作台把旧阅读笔记定位为“算法机制库”，并把收敛性、收敛率、共识/跟踪误差、约束违背、通信复杂度与遗憾界放入独立的理论结果层。缺少整理时显示“未检查原文”，不等同于原论文没有报告；首页也不再用没有事实依据的百分比表示理论进度。

## 验证

```bash
node --test prototype/desktop/*.test.mjs
node --check prototype/desktop/*.mjs
```

方向筛选拆分为主题、网络方向、拓扑变化、权重平衡性、约束耦合、反馈、通信、隐私、算法家族和理论保证 10 个维度，采用“同维度 OR、跨维度 AND”，并提供阅读状态与研究贡献排序。页面中的论文和项目内容仅用于界面演示。
