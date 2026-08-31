# 私有论文库桌面工作台

这是一个桌面端论文库工作台原型，由静态生成页和仅监听本机的 Node 服务组成，不使用数据库。它把外部论文阅读资料与“我的论文”写作任务分开：源论文目录默认只读扫描，生成的数据与页面只写入本项目的本地生成目录；只有用户明确确认的笔记导入、候选归档与恢复操作会经过受控本机 API 写入指定资料包。当前版本没有接入 Quartz。

## 第一次本地构建

所有命令都在本项目根目录运行。

1. 创建被忽略的本机配置目录，并复制示例配置：

   ```bash
   mkdir -p local_library_config
   cp exporter/config/library.example.json local_library_config/library.local.json
   ```

2. 编辑 `local_library_config/library.local.json`：把 `path` 的 `REPLACE_WITH_ABSOLUTE_PATH` 替换为论文源文件夹的绝对路径；如果该来源有 Markdown 目录，让 `catalog_path` 指向该目录的绝对路径，否则保持 `null`。不要修改稳定的 `source_id`。
3. 新建 `local_library_config/paper-overrides.json`，内容为：

   ```json
   {
     "version": 1,
     "papers": {}
   }
   ```

4. 执行私有构建：

   ```bash
   node exporter/scripts/build-private-library.mjs
   ```

5. 启动本地论文库服务。它只监听本机回环地址 `127.0.0.1:4176`，并会在监听前重新构建：

   ```bash
   node exporter/scripts/serve-private-library.mjs
   ```

6. 在浏览器打开：

   ```text
   http://127.0.0.1:4176/local_library_output/desktop/library.html
   ```

`local_library_data/` 与 `local_library_output/` 都是可删除、可重建的本地生成目录。删除后再次运行构建命令即可恢复；构建不会反向覆盖论文源目录。`paper-index.json` 是页面索引，`paper-library-audit.json` 是仅本地使用的详细审计，`paper-catalog.json` 是只含固定允许字段和来源相对键的脱敏目录快照。三者都不代替原始论文文件夹的物理来源记录。

### 研究画像空值

正式分面值仍来自 `local_library_config/paper-tags.json`。目录 version 3 为每篇记录增加稀疏 `facet_states`：空数组且没有状态时显示“未记录”；只有人工明确写入 `not_applicable` 或 `pending_verification` 时，页面才显示“不适用”或“待核验”。已有分面值与同路径状态不能同时存在，空的原文术语也只显示“未记录”。

旧 version-2 目录只迁移结构，不推断结论：

```bash
node exporter/scripts/migrate-paper-tags-v3.mjs local_library_config/paper-tags.json
node exporter/scripts/build-private-library.mjs
```

新构建输出 index version 3 和 facet schema version 2；桌面页面仍可临时读取旧的 `2/1` 生成物，并把缺失状态按“未记录”处理。

个人标签只保存在当前浏览器，不会进入论文目录、正式分面或公开包；导入为严格的仅合并 JSON。限额、备份和未知论文处理见[“我的标签”说明](prototype/desktop/README.md#我的标签)。

## 浏览 PDF 与 OCR

打开任意论文详情后，进入“原文材料”页签：

- 同时存在 PDF 和 OCR 时，默认左侧 PDF、右侧 OCR 并排阅读；也可以切换为单独 PDF 或单独 OCR。
- 只有 PDF 或 OCR 时，页面自动使用单栏，不显示无用的空白栏。
- 同一论文存在多份 PDF 或 OCR 时，页面保留全部版本并显示手动选择器，不自动猜测哪一份是正式版本。
- PDF 使用浏览器自带阅读器，并始终提供“新标签打开 PDF”；OCR 经过受控 Markdown、公式、表格和图片渲染。
- OCR 只用于检索与辅助阅读，关键公式、定理条件和结论仍以 PDF 原文为准。

构建时，PDF 与 OCR 只会复制或转换到 `local_library_data/sources/`。网页不会直接读取源文件夹，不会把本机绝对路径写入页面或论文索引；该生成目录仍不在 GitHub 打包范围内。

构建遇到同一字段的多个 Markdown frontmatter 值时，仍默认阻断。只有私有覆盖表或目录已明确给出该字段的更高优先级值时，构建才继续，并在本地审计的 `shadowed_metadata_conflicts` 中记录不含冲突值的警告。

## 移动或重命名源资料

- 如果只是整体移动论文源根目录，只需修改本机配置里的 `path`，并保留原来的 `source_id`。稳定 ID 会继续使用同一个来源身份。
- 如果某篇论文没有显式 ID，只能使用“来源 ID + 相对路径哈希”生成身份，那么重命名它的内部文件夹会改变哈希。重命名后，覆盖表的键必须使用**新的**相对路径，而值中的 `paper_id` 必须保留**旧的**稳定 ID。把下面三个占位符替换为真实值后，可直接放入私有 `paper-overrides.json`：

  ```json
  {
    "version": 1,
    "papers": {
      "${source_id}::${new_relative_path}": {
        "paper_id": "OLD_STABLE_PAPER_ID"
      }
    }
  }
  ```

  保存后重新构建，并检查未匹配覆盖警告：

  ```bash
  node exporter/scripts/build-private-library.mjs
  node -e 'const audit=require("./local_library_data/paper-library-audit.json"); console.log(audit.warnings.unmatched_overrides)'
  ```

  正确匹配时，新键不应出现在 `unmatched_overrides` 中；如果仍出现，请核对 `source_id` 和新相对路径后再次构建。系统不会自动跟踪文件夹重命名。
- 示例配置、真实本机配置与私有覆盖文件职责不同；不要把真实路径复制回示例配置。

## 本地验证

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs
node exporter/scripts/audit-github-package.mjs
```

GitHub 打包审计只验证 `exporter/config/github-package-files.json` 中列出的固定候选文件。它检查清单结构、路径边界、符号链接、常见私有路径、凭据特征和敏感 JSON 字段，但“审计通过”不等于已经批准公开。

未来的打包器必须读取同一份清单，并严格逐文件复制；不得把项目根目录整体打包，也不得使用目录通配符。`.gitignore` 只是额外防线，不是发布边界证明。审计会在读取前后复查路径、符号链接、真实路径和文件身份；它适用于稳定、非对抗的本地文件系统，不声称能够抵御恶意进程利用硬链接或极短时间竞争条件进行替换。

## 当前 GitHub 边界

未来可打包范围仅包括程序、页面模板、测试、脱敏示例和带 MIT 许可文件的 KaTeX 静态公式资源，不包括真实论文、PDF、OCR、全文翻译、深度阅读笔记、仿真结果、本机配置或任何生成目录。

真正准备 GitHub 项目时，用户只需要决定三件事：

1. 仓库名称；
2. 公开或私有；
3. 许可证。

本次工作只在当前本地工作分支保留了可审查、可回退的提交；没有创建压缩包或远程 GitHub 仓库，没有推送代码，也没有进行 Quartz 集成或公开部署。创建远程、推送、Quartz 集成和公开部署都需要另行确认。

## 本地运行、恢复与受控迁移

### 日常构建、启动、停止与回退

以下是日常操作，不会迁移旧端口的浏览器状态，也不应占用或停止其他服务。先在一个终端构建，再在另一个终端保持服务运行：

```bash
node exporter/scripts/build-private-library.mjs
node exporter/scripts/serve-private-library.mjs
```

服务地址固定为 `http://127.0.0.1:4176/local_library_output/desktop/library.html`。停止时，在运行服务的终端按 `Ctrl-C`；若必须由另一个终端停止，先核对 PID、命令与工作目录，再只对该 PID 发送正常终止信号：

```bash
lsof -nP -iTCP:4176 -sTCP:LISTEN
ps -ww -p <validated-pid> -o pid=,ppid=,command=
lsof -a -p <validated-pid> -d cwd -Fn
kill -TERM <validated-pid>
```

构建或服务启动失败时，不要删除已有生成物，也不要覆盖论文源目录；修正本机配置后重新运行构建即可。构建采用最后一次成功输出作为保护：归档后的重建失败会保留上一次可用的 `local_library_data/` 与 `local_library_output/`。若需要回到上一次正在运行的旧服务，只能按预先记录的命令和工作目录重新启动该服务；不要使用 `kill -9`，也不要把“停止所有 4176 服务”当作日常回退。

### 多来源与归档目标

`library.local.json` 的 `sources` 可列出多个互不重叠的论文根目录；每个根目录都要有稳定且唯一的 `source_id`。可选的 `catalog_path` 是与该来源关联的目录文件路径；配置时它必须是绝对路径，但不要求位于论文根目录内。`archive_source_id` 必须精确指定其中一个来源，只有这个来源接收候选论文归档。下面仅为占位示例，替换为自己的本机路径，不要把真实路径提交到仓库：

```json
{
  "version": 1,
  "archive_source_id": "primary_papers",
  "sources": [
    {
      "source_id": "primary_papers",
      "path": "REPLACE_WITH_ABSOLUTE_PATH",
      "catalog_path": null
    },
    {
      "source_id": "reference_papers",
      "path": "REPLACE_WITH_ANOTHER_ABSOLUTE_PATH",
      "catalog_path": "REPLACE_WITH_ANOTHER_CATALOG_PATH"
    }
  ]
}
```

扫描默认只读。候选归档只有在用户明确确认后，才会在 `archive_source_id` 对应来源排他新建一份带提交标记的元数据资料包；它不会批量移动、改名或覆盖已有论文。

### “待核验”与 `metadata-only`

“待核验”是正式研究画像某个分面由人工明确标记为尚未核实，表示现在没有足够证据下结论；它既不等于“不适用”，也不等于论文没有相关内容。`metadata-only` 是已归档候选只有题名、作者、来源、标识符等可追溯元数据，尚无受控 PDF、OCR 或笔记预览的状态。它同样不是“已读完”或“已纳入论文证据”。

正确顺序是先归档 `metadata-only` 候选以保留稳定论文 ID，之后在同一论文记录下补充 PDF，并通过“添加笔记”导入受控 Markdown/预览。补充材料会丰富同一条记录，而不是创建一条看似相同的新论文；在证据没有核实前，相关分面仍应保持“待核验”或“未记录”。

### 归档恢复与静态只读回退

归档、笔记导入和恢复重建共用一个写入协调器。出现“需要恢复”横幅时，普通写入会被拒绝；不要重复点击归档或手改生成目录。保留原资料包不动，核对横幅显示的固定 `archive_source_id`、`paper_id` 与 `openalex_id` 后点击“恢复重建”。恢复会先核验归档资料包身份和完整性，重建成功才解除锁定；身份不匹配、资料包被改动或重建再次失败都会继续拒绝写入并保留最后一次成功输出。

当 Node 服务暂时不能运行、且只需要浏览已经生成的内容时，可使用静态只读回退：

```bash
python3 -m http.server 4176 --bind 127.0.0.1
```

它只适合查看、筛选以及既有 PDF/OCR/预览；“添加笔记”、候选归档、恢复重建和复制原始路径均不可用。该临时静态服务器没有 Node 服务的精确资源白名单，只能绑定 `127.0.0.1`，不得改成局域网或公网地址。先停止任何已核验的 4176 监听者，避免端口冲突；回到完整功能时停止该 Python 服务，再运行 `node exporter/scripts/serve-private-library.mjs`。

### 浏览器本地状态备份与 Task 15 迁移

个人标签保存在浏览器的 localStorage；方向、书架角色、阅读状态、候选和 Agent 输入快照也属于浏览器来源状态。日常情况下，使用页面的“导出标签”或 `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html` 导出 JSON，并把文件保存在私有位置。个人标签导入只合并已知论文并统计跳过的未知论文；完整状态包则先生成预览，再要求用户对每个状态 owner 的冲突作出显式决定。两种导入都严格校验，也都不会自动删除原备份。

旧端口（4176、4177、4178）的导出/导入不是日常启动步骤，只能在 **Task 15 受控切换** 中执行：先记录每个旧进程的 PID、命令、cwd 与重启命令；再针对当前要迁移的那个端口，临时运行下列三个命令之一：

```bash
node exporter/scripts/serve-state-transfer.mjs --port 4176
node exporter/scripts/serve-state-transfer.mjs --port 4177
node exporter/scripts/serve-state-transfer.mjs --port 4178
```

打开该旧端口的 `http://127.0.0.1:<port>/state-transfer.html`，导出 JSON 并记录 SHA-256；确认端口释放后启动最终 Node 服务，再在 `http://127.0.0.1:4176/local_library_output/desktop/state-transfer.html` 逐份预览、核对摘要并按每个状态 owner 显式处理冲突后导入。任何导出、校验、端口所有权或最终服务检查失败，都停止本次切换启动的进程、按已记录命令恢复旧服务，并保留 JSON 与摘要，不进行静默跨源复制。

### GitHub 包边界

GitHub 候选包的 124 项固定清单只包含程序、页面模板、测试（包括六个只使用临时根目录的 Task 14 E2E 源文件）、脱敏示例、README 和获许可的 KaTeX 静态资源；打包器必须逐文件读取 `exporter/config/github-package-files.json`，不得用目录通配符或整体复制项目根目录。真实论文、PDF、OCR、全文翻译、深度阅读笔记、仿真结果、本机 `local_library_config/`、`local_library_data/`、`local_library_output/`、浏览器导出的状态 JSON、审计和截图均不在公开包内。运行 `node exporter/scripts/audit-github-package.mjs` 只能检查候选边界，不能替代人工确认公开范围。
