# 论文库统一目录与笔记整理设计规格

**状态：** 方案 A 已由用户于 2026-08-27 选择；本文件等待用户审核后进入实施计划。

## 1. 目标

在不批量改写旧笔记的前提下，为现有异构论文目录建立一层统一、可重建的本地论文记录：

```text
1.目录.md + 私有覆盖映射 + 现有论文文件（只读扫描）
→ 目录适配与冲突门禁
→ 统一 paper record
→ 已有笔记 / OCR 待精读 / 仅 PDF 待阅读
→ 本地静态论文库
```

用户所说的“数据库”指构建期生成的本地 JSON 目录，不引入数据库服务器或后端服务。生成目录删除后，必须能从现有目录、覆盖映射和 Markdown 重新构建。

## 2. 本轮边界

本轮包含：

1. 将 `1.目录.md` 中已经显式登记的身份和书目信息接入扫描器；
2. 统一全部纳入记录的稳定 `paper_id`、题名、作者、年份、期刊、DOI、材料路径和信息来源；
3. 修正当前把标题中的连字符普通词误判为论文 ID 的问题；
4. 正确区分精读笔记、推导、OCR、全文翻译、仿真、代码和结果；
5. 为已有笔记选择受控的主笔记入口，并在私人网页中浏览；
6. 将没有精读笔记的论文放入“待精读”或“待阅读”，不自动生成结论；
7. 建立学位论文母项与章节子项的稳定身份关系；
8. 对 Deng 错配附件执行可恢复清理；
9. 从当前网页目录显式排除连续时间论文；
10. 重新生成并验证本地桌面论文库。

本轮不包含：

- 批量重写或重命名旧笔记；
- 为无笔记论文自动 OCR、总结或精读；
- 根据正文猜测研究结论、贡献或证据状态；
- 删除连续时间论文的源文件；
- Quartz 公开发布、GitHub 发布或公开搜索索引接入；
- 修改除已确认错配附件以外的源论文文件。

## 3. 统一记录架构

### 3.1 事实来源及优先级

每条统一记录必须保留字段来源，固定优先级为：

```text
私有人工覆盖映射
> 1.目录.md 中通过精确 PDF/OCR 链接匹配的目录记录
> 文件内显式 frontmatter
> 规范短码笔记文件名
> 保守空值
```

PDF metadata、OCR 一级标题和目录名称只用于一致性检查和冲突提示，不在冲突时静默覆盖正式字段。普通笔记正文、文件修改时间和文件夹顺序不得用于猜测事实。

### 3.2 统一字段

每条记录至少包含：

```text
paper_id
title_original
title_zh
title_en
authors[]
publication_year
version_date
venue
doi_or_url
unit_type
parent_paper_id
source_id
relative_path
metadata_provenance{}
artifact_paths{}
note_status
preferred_note
include
exclude_reason
warnings[]
```

`title_original` 是语言中立字段。通用 `title:` 不再无条件写入 `title_en`。`publication_year` 与本地 PDF 或预印本的 `version_date` 分开，避免 Flaxman、Liu25-MC 等版本差异被覆盖。

### 3.3 生成产物

```text
local_library_data/paper-catalog.json
local_library_data/paper-index.json
local_library_data/paper-library-audit.json
local_library_data/notes/{paper_id}/index.html
```

这些文件均为私有构建产物，不是新的事实来源，也不得进入公开 Quartz 构建。

## 4. 目录适配与身份规则

### 4.1 目录记录匹配

目录适配器解析 `1.目录.md` 中每条论文的显式短码、题名、作者、年份、venue、DOI/arXiv，以及 PDF/OCR 的相对链接。记录只通过规范化后的精确相对路径与论文单元匹配，不进行模糊标题匹配。

以下情况进入阻塞冲突，不自动选择：

- 同一路径匹配多个目录记录；
- 同一稳定 ID 对应多个论文单元；
- 目录题名、PDF 身份和 OCR 身份明确互相矛盾；
- 学位论文章节指向不存在或非 thesis 的父项。

### 4.2 稳定 ID

稳定 ID 优先使用目录或笔记中已存在的 `{Author}{YY}-{Code}`。任意文件名中的普通连字符词不再作为 ID。

学位论文使用父子结构：

```text
Li25-TSGF       # thesis
Li25-TSGF-C03   # chapter
Li25-TSGF-C05   # chapter
```

仅在目录、覆盖和规范短码笔记都没有身份时，才生成路径哈希并显示“待整理身份”。

### 4.3 原文件夹分类的角色

有了统一论文记录和多维标签后，原文件夹层级不再承担网页分类、方向归属或筛选规则，只保留为物理存放位置和来源溯源路径。一篇论文可以同时属于多个研究方向、方法、网络、问题和写作用途，无需复制文件或强行选择唯一文件夹。

扫描器不得根据 `01_基础与网络机制`、`02_约束分布式优化` 等目录名称自动填写 `topic_l1`、`topic_l2`、`research_scopes`、`method_tags`、`network_tags` 或 `problem_tags`。这些语义字段只能来自目录中的显式标签、frontmatter 或人工覆盖。

本轮不删除、扁平化或批量移动原文件夹；统一目录稳定后，若用户仍希望整理磁盘结构，再建立独立、可回滚的迁移任务。

## 5. 笔记整理规则

“整理已有笔记”在本轮表示建立统一入口、分类和状态，不改写笔记正文。

主笔记选择顺序：

1. 私有覆盖中明确指定的 `preferred_note`；
2. 唯一的 `{paper_id}_论文精读.md`；
3. 唯一且被适配器明确识别的历史精读笔记；
4. 多份候选并存时不自动选择，显示“存在多份笔记，待选择”。

笔记分组固定为：

| 状态 | 条件 | 网页行为 |
|---|---|---|
| `notes_ready` | 有可识别精读笔记 | 进入“已有笔记”，允许打开受控 HTML 预览 |
| `ocr_only` | 无精读笔记，但有 OCR 正文 | 进入“OCR 待精读”，不把 OCR 当笔记 |
| `pdf_only` | 有 PDF，无精读笔记和 OCR | 进入“仅 PDF 待阅读” |
| `metadata_only` | 只有目录元数据，没有可用本地正文 | 进入“材料待补” |
| `conflict` | 身份或附件冲突 | 不进入普通列表，只进入私有审计 |

“有笔记”不等于“证据已核验”。未经 PDF/source map 核对的旧笔记继续标记为 `source_unverified`。

## 6. 显式排除规则

私有覆盖记录增加显式字段：

```json
{
  "include": false,
  "exclude_reason": "continuous_time_out_of_scope"
}
```

排除必须逐条绑定稳定 ID 或精确相对路径，不允许扫描器按关键词自动排除。排除记录不进入论文列表、搜索、计数和笔记输出，但必须在私有审计中保留 ID、相对路径和排除原因。

当前连续时间专项只排除一条：

```text
Liu22-FTCO
02_约束分布式优化/耦合约束与原始对偶/
Liu (2022) Continuous-time finite-time consensus distributed optimization
```

`Su22-NECPD` 和 `Tang26-DPPDS` 的 finite-time consensus 是离散有限步协议，不排除。其他只在相关工作中提到 continuous-time 的论文也不排除。`Liu22-FTCO` 的 PDF、OCR 和图片保留在源目录，以便以后恢复或作为对照材料。

## 7. Deng 错配附件清理

只读复核确认 Deng 单元共有 103 个文件，其中 99 个属于误放的 2024 CCC 论文附件，4 个 `Deng23-TSR_*` 笔记确实围绕目标 Deng 2023 Tseng 论文。

实施时将以下错配附件移动到带时间戳的 macOS 废纸篓子目录，不使用不可恢复删除：

```text
Distributed robust optimization with coupled constraints via Tseng’s splitting method.pdf
Distributed robust optimization with coupled constraints via Tseng’s splitting method.md
具有耦合不确定约束的分布式鲁棒优化问题.md
images/                         # 96 张随错配 OCR 生成的图片
```

保留：

```text
Deng23-TSR_论文精读.md
Deng23-TSR_推导过程.md
Deng23-TSR_仿真描述.md
Deng23-TSR_代码对比提示.md
```

清理后 Deng 单元没有正确 PDF，因此不进入本轮论文网页；四份笔记保留为“原文缺失、待重新核验”的孤立研究材料。未来放入正确 PDF 后，适配器可以重新建立 `Deng23-TSR` 记录。清理审计必须记录移动的精确文件数、原路径、废纸篓恢复位置和保留文件数。

## 8. 数据流与错误处理

```text
加载本机配置与私有覆盖
→ 解析 1.目录.md
→ 只读扫描论文单元和产物
→ 精确路径匹配目录记录
→ 验证身份、版本和父子关系
→ 应用逐条排除
→ 选择主笔记并计算 note_status
→ 生成 JSON、受控笔记 HTML 和桌面页面
→ 输出私有审计
```

阻塞错误包括重复 ID、路径越界、身份冲突、父子关系错误和排除键无法唯一解析。单个无法读取的历史 Markdown 只产生警告；不得阻断无关论文。任何冲突都不得用最后读取的值静默覆盖。

## 9. 页面变化

论文库默认先显示“已有笔记”，随后是“OCR 待精读”和“仅 PDF 待阅读”。每组显示数量，并可作为筛选条件。

列表和检查器使用中文明确状态：

```text
已有精读笔记
OCR 已有，等待精读
仅有 PDF，等待阅读
材料待补
存在多份笔记，待选择
原文尚未核验
```

页面不再显示 `Not Reported` 或 `Unknown`；书目信息确实缺失时显示“书目信息待补”。已有目录信息必须优先展示。

## 10. 测试与验收

所有行为修改采用测试先行：先写能复现旧错误的失败测试，确认失败原因，再写最小实现。

自动测试至少覆盖：

1. `1.目录.md` 精确路径解析及稳定 ID；
2. 中文通用 `title:` 不进入 `title_en`；
3. 普通连字符词不能成为 `paper_id`；
4. 元数据来源优先级与冲突阻塞；
5. 唯一规范笔记自动成为 `preferred_note`；
6. `notes_ready / ocr_only / pdf_only / metadata_only / conflict` 分类；
7. `include: false` 逐条排除并保留审计；
8. `Liu22-FTCO` 被排除，离散 finite-time 论文不被误排除；
9. thesis/chapter 身份与父子关系；
10. Deng 错配记录不进入重建索引；
11. 私有笔记 HTML、索引和绝对路径不进入公开打包；
12. 重新构建不修改保留的源 Markdown。

最终验证包括：

- 运行全部 Node 测试并确认零失败；
- 从空的生成目录完整重建；
- 检查 HTTP 路由和浏览器控制台；
- 在 1280×720 与 1440×900 检查分组、筛选、滚动和检查器；
- 对比源 Markdown 清单，除用户批准的错配附件移动外无变化；
- 确认公开 Quartz 输入、公开搜索索引和 Git 打包均不包含私有目录。

## 11. 实施文件边界

计划阶段预计新增或修改：

```text
exporter/paper-library/catalog-adapter.mjs
exporter/paper-library/catalog-adapter.test.mjs
exporter/paper-library/scanner.mjs
exporter/paper-library/scanner.test.mjs
exporter/paper-library/frontmatter.mjs
exporter/paper-library/frontmatter.test.mjs
exporter/paper-library/overrides.mjs
exporter/paper-library/overrides.test.mjs
exporter/paper-library/build.mjs
exporter/paper-library/build.test.mjs
prototype/desktop/library.template.html
prototype/desktop/library.mjs
prototype/desktop/paper-library.test.mjs
local_library_config/paper-overrides.json
audits/                              # 私有清理与排除审计
```

精确文件和接口由后续实施计划根据现有测试结构锁定。本轮遵循用户先前选择，不创建分支、不提交 Git、不发布网站。
