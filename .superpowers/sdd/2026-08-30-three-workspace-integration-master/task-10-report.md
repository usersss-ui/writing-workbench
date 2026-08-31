# Task 10 实施报告：单一回环研究工作台服务

## 交付结果

- 基线：`469b62b`
- 功能提交：`42f553fb633ceadbb3724965655b4655688eb1b7`
- 质量修复提交：`d96c89dcba6d88a03e04f217142f0f81bc1c9ff7`
- 实现一个仅绑定 `127.0.0.1` 的本地服务，生产端口固定为 `4176`，测试只使用端口 `0`。
- 路由表严格限定为六条 API；API query、旧路由、未知路由、OPTIONS 和方法不匹配均为 404。
- `/` 仅在无 query 时 302 到 `/local_library_output/desktop/library.html`。
- prototype 与 generated 静态资源使用两组独立显式 allowlist；测试逐项请求 41 个 prototype 资源、36 个 generated 资源和两侧各 20 个 KaTeX WOFF2 字体，并证明 KaTeX LICENSE、模板、测试、配置、审计和未列资源继续 404。
- Host、可选 Origin、可选 Sec-Fetch-Site、JSON content type/content encoding、逐端点 body limit、路径解码、普通文件/非符号链接/realpath containment、无 CORS 和固定净化错误均在 HTTP 测试覆盖。
- 启动顺序为 load → build（沿用 builder 的 pre-swap 输出验证）→ create → listen；没有新增 fallible post-publish 验证。启动构建失败时不会 create/listen，旧输出字节保持不变。

## TDD 证据

### RED

- `candidate-archive-action.test.mjs` 首次运行因 `candidate-archive-action.mjs` 不存在而 `ERR_MODULE_NOT_FOUND`：0 pass / 1 fail。
- `local-server.test.mjs` 首次运行因 `local-server.mjs` 不存在而 `ERR_MODULE_NOT_FOUND`：0 pass / 1 fail。
- coordinator 新增 manual archive 用例首次运行为 10 pass / 2 fail，失败码为 `INVALID_RECOVERY_DETAILS`。
- candidate archive recovery proof 用例首次运行因缺少具名导出 `verifyArchiveRecoveryProof` 而失败：0 pass / 1 fail。
- server 新增 `ARCHIVE_SCAN_INCOMPLETE` HTTP 用例先稳定复现 500 而预期 409；随后仅修正固定状态映射。
- no-archive capability 用例先稳定复现 `archive_rebuild: true` 而预期 false；随后仅修正 normal/candidate/manual 三态表达式。
- baseline exact suite 的唯一上游失败来自 runtime 临时模板夹具未复制当前生产批准资源。按 controller 裁定仅在 `runtime.test.mjs` 加入 `direction-snapshot.mjs` 与随后确认同属生产固定集合的 `agent-task-input.mjs`；生产 resource union 未削弱。

### GREEN

执行 brief Step 8 的精确命令：

```bash
node --test exporter/paper-library/write-coordinator.test.mjs exporter/paper-library/runtime.test.mjs exporter/paper-library/note-import-transaction.test.mjs exporter/paper-library/candidate-archive.test.mjs exporter/paper-library/candidate-archive-action.test.mjs exporter/paper-library/local-server.test.mjs
```

首轮 GREEN 结果：exit 0，79 tests / 79 pass / 0 fail。组成如下：

- write coordinator：12 tests
- runtime：4 tests
- note import transaction：17 tests（含 4 个嵌套 schema boundary 子测试）
- candidate archive：22 tests
- candidate archive action：9 tests
- local server/CLI/integration：15 tests

明确的 Step 8 正向集成测试名为 `a temporary workbench completes archive-build-index then note inspect-import-build-preview`。它在临时 repo/source 中执行真实 archive transaction → 全源 scan → 真实 `rebuildConfiguredLibrary` → index 断言，再执行真实 inspect → coordinator import → note write → 真实 rebuild → preview 与源笔记字节断言。

## 质量修复轮 1

### RED

- recovery proof 组成组终验用例先稳定复现同 inode、同长度的 metadata 在分组验证中途改写仍被接受，报错为 `Missing expected rejection`。
- recovery action 用例先稳定复现 rebuild 内同时改写 metadata 与 commit 后仍清除 recovery，首个失败为 `Missing expected rejection: metadata and commit rewritten during rebuild`。
- recovery capabilities 用例先稳定复现 coordinator 已有 candidate recovery、blocking scan 抛错时返回 409 而非 200。
- 静态根 alias 用例先稳定复现外部 prototype root symlink 返回 200 而非 404；末端文件换位同样先返回 200。
- 慢速 chunked body 用例先稳定复现超限 413 仍返回 `Connection: keep-alive`。实现关闭连接后，测试曾把 Node 内部 `clearIncoming` 误当作应用 listener；按 controller 裁定，最终断言只要求本模块具名 `onData`、`onEnd`、`onError` listener 被移除。

### GREEN

- `verifyArchiveRecoveryProof` 现在执行两轮完整组成组验证；`rebuildArchivedCandidate` 在 rebuild 返回合法 `paperCount` 后、清除 recovery 前再次完整验证。验证中途同 inode/同长度改写，以及 rebuild 内改写 metadata+commit、替换 source root/package/metadata inode、增加 package 成员，均返回固定 conflict 且 coordinator/private store 保持不清。
- recovery capabilities 先从 coordinator 安全 tuple 生成固定 schema：candidate 可返回 source ID，manual 身份为 null；已有 recovery 时不依赖可能失败的 `loadContext`，normal 状态仍执行 load/validate。
- 静态读取锚定 canonical ordinary repo root；mapped root 的末端/中间 symlink、外部 realpath 和 repo alias 均 404。文件以 `O_NOFOLLOW` handle 读取，并在读取前后复核 handle/路径/root/repo 的 identity、size 与 realpath。
- body 超限立即移除本模块 data/end/error listener、暂停 request、固定返回 413 并关闭该连接；大量尾部不再被应用消费，另一独立请求继续正常返回。Node 自身 `clearIncoming` listener 保留。

质量修复后的 Step 8 精确命令结果：exit 0，85 tests / 85 pass / 0 fail。当前组成如下：

- write coordinator：12 tests
- runtime：4 tests
- note import transaction：17 tests（含 4 个嵌套 schema boundary 子测试）
- candidate archive：23 tests
- candidate archive action：10 tests
- local server/CLI/integration：19 tests

修复轮仅修改 `candidate-archive.mjs`、`candidate-archive.test.mjs`、`candidate-archive-action.mjs`、`candidate-archive-action.test.mjs`、`local-server.mjs`、`local-server.test.mjs`；没有新增 startup post-publish validation，也没有触碰 `build.mjs` 或 Task 11 客户端。

## 协调、归档与恢复

- note import、candidate archive 和 archive rebuild 共用 Task 8 coordinator；第二项写入即时 409，不排队。
- inspection token 在成功取得锁后、写文件/构建前消费；busy 请求不消费 token。
- 完整扫描要求 `audit.sources` 与配置 source ID/root 一一精确覆盖，且 `scanned_directories` 为正整数；scanner blocking 项仍阻断，warning 不会全局阻断归档。
- 归档保留 Task 5 的最终文件 `O_EXCL` 与 `.metadata.commit`，没有 rename rollback。
- 构建失败保留已提交 package 和 last-good data/output，并进入 `candidate_archive / ARCHIVE_REBUILD_FAILED`。
- 新增 process-private recovery proof：归档提交后立即捕获 source/package identity、精确目录成员，以及 metadata/commit 的 dev、ino、size、SHA-256 与复合身份；只有 rebuild 失败时保存在进程内，不进入 coordinator、capabilities、HTTP 或 logger。
- recovery 先验证请求 tuple、当前扫描与私有 proof，再重建；rebuild 返回合法计数后、clear 前再次完整验证。metadata+commit 同时重写并重哈希、inode replacement、root/package replacement、额外文件、tuple mismatch、fresh empty store 或 rebuild 期间篡改均拒绝且不清 recovery；未篡改恢复成功且终验通过后才清除。

## 必要的计划修复

controller 将 Task 10 边界明确扩展到 `write-coordinator.mjs` 与对应测试，用于 fail-closed `manual_archive / ARCHIVE_TRANSACTION_AMBIGUOUS`。归档在发生 post-mutation ambiguous 错误后、释放锁前标记该状态；此时 note import、candidate archive、archive rebuild 全部禁用，capabilities 保留 kind/reason，但三个归档身份字段均为 null。HTTP 用例证明返回固定 500 且状态已进入 manual archive。

这不是 `manual_note` 的复用。Task 10 没有修改 `prototype/desktop/library.mjs`；Task 11 必须明确扩展客户端 capability validator 以接受 `manual_archive`，否则旧客户端会安全拒绝整份能力并回退。

## 安全执行与边界审计

- 所有集成测试仅创建系统临时 repo/source；只复制公开 prototype 资源和读取公开 institution fixture。
- 未加载真实 `local_library_config`，未运行真实配置 build，未写真实论文源、真实笔记、private/generated/live output。
- 未启动或停止 4176/4177/4178；HTTP 测试全部监听 `127.0.0.1:0`，CLI 仅通过依赖注入和 import-safe guard 测试。
- 预存未跟踪 `audits/`、`tmp/` 始终保持未跟踪，未纳入 diff/提交。
- 首轮全部 10 个实际变更 `.mjs` 与修复轮 6 个变更 `.mjs` 均已通过 `node --check`。
- `git diff --check` 与 staged `git diff --cached --check` 均通过。
- staged 边界仅含 Task 10 列出的文件，以及 controller 明确批准扩展的 coordinator 两文件；未修改 `build.mjs`、真实内容、donor worktree 或 GitHub manifests。

## 已知延期与后续任务

- Task 11：扩展浏览器 capability validator 的 `manual_archive` 兼容，并保留三身份 null 的 fail-closed 表达。
- Task 12：统一加入 state-transfer 页面及其完整八文件依赖闭包；Task 10 没有猜测或提前放宽 allowlist。
- Task 13：统一更新 GitHub package manifests；Task 10 未修改 manifests。
- candidate recovery proof 有意仅在当前服务进程有效；进程重启后的空 store 即使磁盘 package 未篡改也拒绝自动恢复，避免把不可验证状态误判为安全。
