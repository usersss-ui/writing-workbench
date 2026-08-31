# 私有论文库桌面工作台

这是一个桌面端、纯静态的论文库工作台原型。它把外部论文阅读资料与“我的论文”写作任务分开：源论文目录始终按只读方式扫描，生成的数据与页面只写入本项目的本地生成目录。当前版本没有数据库，也没有接入 Quartz。

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

5. 只监听本机回环地址启动静态服务器：

   ```bash
   python3 -m http.server 4176 --bind 127.0.0.1
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

本次工作没有创建 Git 仓库、压缩包或远程仓库，没有提交或推送代码，也没有进行 Quartz 集成或部署。创建远程、推送、Quartz 集成和公开部署都需要另行确认。
