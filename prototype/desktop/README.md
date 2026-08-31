# 桌面端学术研究工作台原型

本目录是桌面版设计原型，推荐在 1440 × 900 查看，并已验证 1280 × 720。它不包含手机端和平板端布局，也不读取私人 Vault。

## 本地预览

如需查看由本机论文目录生成的私有论文库，先在仓库根目录运行：

```bash
node exporter/scripts/build-private-library.mjs
```

本地生成页地址是：

```text
http://127.0.0.1:4176/local_library_output/desktop/library.html
```

该页面仍是本地静态输出；当前没有完成 Quartz 集成。

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

在仓库根目录运行：

```bash
python3 -m http.server 4176 --bind 127.0.0.1
```

然后打开：

```text
http://127.0.0.1:4176/prototype/desktop/
http://127.0.0.1:4176/prototype/desktop/directions.html
http://127.0.0.1:4176/prototype/desktop/p02.html
```

三个地址分别是研究首页、独立的“方向探索”页和 P02 个人论文工作台；页面可以通过左侧导航互相到达。

P02 工作台把旧阅读笔记定位为“算法机制库”，并把收敛性、收敛率、共识/跟踪误差、约束违背、通信复杂度与遗憾界放入独立的理论结果层。缺少整理时显示“未检查原文”，不等同于原论文没有报告；首页也不再用没有事实依据的百分比表示理论进度。

## 验证

```bash
node --test prototype/desktop/*.test.mjs
node --check prototype/desktop/*.mjs
```

方向筛选拆分为主题、网络方向、拓扑变化、权重平衡性、约束耦合、反馈、通信、隐私、算法家族和理论保证 10 个维度，采用“同维度 OR、跨维度 AND”，并提供阅读状态与研究贡献排序。页面中的论文和项目内容仅用于界面演示。
