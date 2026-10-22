# 浏览器状态改存本机磁盘 · 设计草案

日期：2026-10-22 · 状态：已实施（实现与草案的差异见“实施说明”）

## 目标

换浏览器、换端口或清理浏览器数据后，研究方向、阅读状态、个人标签、发现候选等不再丢失。做法是改由本机 Node 服务写入 `local_library_config/`，与应用投稿项目现有的保存方式一致。不引入数据库，不上传任何内容。

## 范围

当前页面共使用 7 个浏览器存储键：

| 存储键 | 内容 | 本次 |
| --- | --- | --- |
| `research-console.direction-snapshot.v1` | 研究方向 | 改存磁盘 |
| `research-console.paper-library.v1` | 阅读状态、P02 用途架 | 改存磁盘 |
| `research-console.paper-user-tags.v1` | 个人标签 | 改存磁盘 |
| `research-console.discovery-candidates.v1` | 旧候选队列（≤100 条） | 改存磁盘 |
| `research-console.discovery-workspace.v1` | 检索工作区（≤4 MiB） | 改存磁盘 |
| `research-console.agent-task-input.v1` | 研究任务输入 | 改存磁盘 |
| `research-console.p02-workflow.v1` | P02 研究记录，含写作草稿 | **不动**，仍在浏览器 |

写作草稿按你的要求暂不处理，因此整个 P02 研究记录键保持原样。

## 方案：同步接口的磁盘存储适配器

各模块已经通过参数接收 `storage`（只用 `getItem` / `setItem` / `removeItem`），校验与限额逻辑都在模块内部。所以只替换传进去的对象，不改各模块的业务逻辑。

**服务端**（新增 `exporter/paper-library/workbench-state.mjs`）

- `GET /api/v1/workbench-state`：一次返回上表 6 个键的当前值与 revision。
- `POST /api/v1/workbench-state`：请求体 `{ key, expectedRevision, value }`。只接受白名单内的键；revision 不一致时返回冲突。
- 每个键写入 `local_library_config/workbench-state/<key>.json`，采用投稿项目同样的写法：临时文件、fsync、rename、权限 0600，并经过现有写入协调器串行执行。
- 目录已被 `.gitignore` 排除，也不在 GitHub 打包白名单内。

**页面端**（新增 `prototype/desktop/server-storage.mjs`）

- 页面打开时拉取一次全部状态，生成一个内存快照，对外仍是同步的 `getItem` / `setItem` / `removeItem`。
- 写入以同步请求直接写盘，成功后才更新快照。失败时页面明确显示“未保存到磁盘”，不静默吞掉。
- 不在白名单内的键（即 P02 研究记录）直接转交 `localStorage`，所以同一页面可以混用。
- 多标签页同步：现有代码监听 `storage` 事件，改为由适配器通过 `BroadcastChannel` 发出同名事件。冲突时以磁盘为准，重新读取后提示。

**需要改动接入点的页面**：`library.template.html`、`discovery.mjs`、`directions.mjs`、`research-home.mjs`、`agent-tasks.mjs`、`p02-workflow-ui.mjs`、`p02-writing.mjs`、`state-transfer.mjs`。改动都只是把 `window.localStorage` 换成适配器。

## 实施说明

与草案相比，实现有以下调整：

- **写入改为同步请求。** 适配器用同步 `XMLHttpRequest` 写盘，`setItem` 在写入完成后才返回，失败时直接抛错。这样各模块原有的“未保存”提示能看到真实结果，关闭标签页也不会丢掉尚未发出的写入。本机回环请求只需毫秒级时间，Chrome 155 也不会因此输出控制台警告。读取仍来自页面打开时加载的快照。
- **写入接口是 `POST /api/v1/workbench-state`**，请求体 `{ key, expectedRevision, value }`，与服务端其他写接口共用同源、JSON 和请求体上限检查。统一请求体上限为 16 MiB；各键的业务上限仍由前端模块自己校验。
- **研究任务输入还使用派生键**（`.current`、`.snapshot.<id>`、`.pending.<id>`），白名单按模式匹配这些键；服务端和浏览器各写一份规则，由测试保证二者一致。
- **删除以 `value: null` 写入并保留 revision**，避免删除后重建的文件把 revision 归零。
- **状态写入不经过论文库写入协调器**，而是按键在模块内串行。论文库重建期间仍可保存阅读状态。
- **备份与恢复页**在主服务上使用适配器；在没有状态接口的独立旧端口导出服务上，回退到该来源的 localStorage。

## 旧数据

按“之前的内容可以不保存”处理：磁盘从空状态开始，不自动迁移浏览器里已有的数据。如果以后想保留，可以先用现有“备份与恢复”导出，再导入。

## 备份与恢复页

`state-transfer` 改用同一个适配器，导出和导入仍然覆盖全部键：6 个磁盘键加上浏览器里的 P02 记录。磁盘部分也可以直接复制 `local_library_config/workbench-state/` 目录来备份。

## 验证

- 服务端单元测试：键白名单、字节上限、revision 冲突、原子写入、损坏文件、符号链接拒绝。
- 适配器单元测试：同步读写、失败提示、写入排队、非白名单键转交、跨标签页通知。
- 更新现有页面测试中注入的 storage。端到端夹具使用临时配置目录，验证刷新和换端口后状态仍在。
- 全量 `node --test`、3 套 Playwright 验收和打包审计都要通过。

## 不做

- 写作草稿和 P02 研究记录。
- 自动迁移旧浏览器数据。
- 数据库、云同步、账号体系。
