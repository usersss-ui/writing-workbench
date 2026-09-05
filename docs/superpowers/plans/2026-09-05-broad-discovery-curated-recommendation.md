# 多来源检索与分层推荐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一搜索页汇总宽检索与外部题录，保留全部线索、本地材料对照和证据驱动的严格推荐。

**Architecture:** 在现有 OpenAlex 查询与候选归档之间增加来源记录、身份汇总和检索批次层。推荐为纯函数，读取独立核验记录；旧候选及元数据归档协议不变。新增浏览器状态统一纳入 version 3 备份，界面最后接入，避免半成品污染现有入口。

**Tech Stack:** 现有无框架 JavaScript ES modules、Node.js 内置测试、浏览器 localStorage、Python Playwright 受控验收；不新增生产依赖、LLM 服务或数据库。

**Spec:** [已批准设计](../specs/2026-09-05-broad-discovery-curated-recommendation-design.md)。用户于 2026-09-05 确认此设计；下面细化实现，不重新定义产品范围。

## Global Constraints

- 搜索尽量全面，推荐保持严格。
- 搜索页默认显示“全部结果”，可切换“重点推荐”。
- OpenAlex 仍每次加载 25 条，一批最多 2 个并发请求；不无限自动翻页。
- 每批至多 6 条实际查询，未执行的建议保持可见，可按需继续。
- 手写高级检索式默认原样执行；只有用户明确选择扩展检索时才生成补充组合。
- 现有 OpenAlex 候选 v1、100 条容量限制、元数据归档 API、恢复协议和写入协调器保持不变。
- 首版导入格式限定为 BibTeX 和 RIS；JCR 核验另支持用户映射 CSV 列并预览确认。
- 每个外部文件 2 MiB、500 条；工作区持久化最多 1,000 条题录，总序列化大小不超过 4 MiB。
- 完整状态包升级为 version 3，继续读取 version 1／2；旧备份没有新 owner 时保留当前新状态。
- 不读取外部浏览器的认证信息，不绕过验证码，不后台下载付费全文，不写入源论文目录。
- PDF 自动下载、OCR、AI 全文分析、笔记生成、投稿判断和 App 打包不在本轮范围。
- JCR 使用 JIF Quartile Q1/Q2；主学科 Automation & Control Systems，默认使用已核验记录中的最新数据年；用户可以显式选择年份、主学科。
- 中文名单仅为 ISSN 0254-4156、1000-8152 对应的中文期刊；相似英文刊名不得自动取得资格。

---

## 执行环境、基线与提交纪律

所有命令在当前提供网页的既有工作树中运行，不在另一个同名 `html` 目录操作。启动实现时先读 `using-git-worktrees`，用 `git rev-parse --git-dir --git-common-dir` 确认已经是 linked worktree，保留当前分支。仓库有大量既有未提交改动，不创建一个缺少这些改动的新工作树来替代运行目录，不重置、不暂存全部文件。

2026-09-05 计划阶段运行以下基线：111 tests，111 pass，0 fail。实现开始时重跑，之后每项任务按先红后绿执行；此基线不是新功能验收。

```bash
node --test prototype/desktop/openalex-search.test.mjs prototype/desktop/local-paper-match.test.mjs prototype/desktop/discovery-dom.test.mjs prototype/desktop/candidate-storage.test.mjs prototype/desktop/state-transfer.test.mjs
```

每项任务的提交步骤均先审查本轮差异：新增文件可以按精确路径暂存；既有脏文件只暂存本任务补丁，不能整文件夹带旧改动。使用基线差异构造补丁并以 `git apply --cached` 暂存，经 `git diff --cached --check`、`git diff --cached` 核验后提交。补丁无法安全分离时保留未提交改动并记录原因，不为满足提交步骤改写用户历史。不得推送。

## 文件边界与依赖

| 单元 | 文件 | 职责 |
| --- | --- | --- |
| 来源记录 | `discovery-record.mjs` | 字段规范化、公开链接、来源和范围状态 |
| 身份汇总 | `discovery-identity.mjs` | 保留原记录、可追踪合并、冲突与拆分 |
| 题录导入 | `bibliography-import.mjs` | 有界 BibTeX/RIS 解析和导出 |
| 查询规划 | `discovery-query-plan.mjs` | 条件 ID、同义词、原始式、组合、外部链接 |
| 在线适配 | `openalex-search.mjs` | 保留旧接口；新增带来源证据的页面和 DOI 核验 |
| 本地召回 | `local-discovery.mjs`、`local-paper-match.mjs` | 主题线索和同篇材料标记分开 |
| 批次调度 | `discovery-batch.mjs` | 两并发、分页、重试和旧批次隔离 |
| 核验与推荐 | `journal-review.mjs`、`discovery-recommendation.mjs` | JCR 记录、范围/条件证据、名额与理由 |
| 新状态 | `discovery-workspace.mjs` | 独立 owner、校验、容量与安全持久化 |
| 界面 | `discovery-results-ui.mjs`、`discovery-review-ui.mjs` | 当前页的结果、导入和共用核验面板 |
| 衔接 | `discovery.mjs`、`directions.mjs`、`state-transfer.mjs` | 旧入口和备份衔接，不重写归档 |

上表新模块均放 `prototype/desktop/`，每个配同名 `.test.mjs`。集成界面测试继续放 `discovery-dom.test.mjs`，测试辅助放 `discovery-test-fixtures.mjs`，只含人工合成题录，禁止在生产模块中导入。任务 1–3 为数据基础；4–7 为检索；8 为纯推荐；9–10 为状态兼容；11–12 为界面与交付验收。该计划是同一检索流程的依赖链，不另立无关子产品。

任务 12 列出所有资源注册位置作为共用检查表：每次已有生产入口新增静态 import，都必须在该任务同步更新其实际依赖闭包和相应测试，不允许等到任务 12 才修复已经损坏的页面。任务 12 负责最后的完整枚举审计与浏览器验收。

## 共享数据契约

字段命名以下列契约为准，不在下游另起别名。类型用于文档及 JSDoc，运行代码仍是 `.mjs`。所有对象为纯数据、精确字段集合；未知值用 `null`，状态不靠真假值推断。

```ts
type Scope = { startYear: number|null; endYear: number|null; language: 'all'|'en'|'zh' };
type Condition = { id: string; label: string; terms: string[]; role: 'problem'|'network'|'method'|'other' };
type Query = { query_id: string; expression: string; condition_ids: string[]; kind: 'original'|'expanded'|'single' };
type QueryPlan = { conditions: Condition[]; selected: Query[]; suggested: Query[]; warnings: string[] };
type Provenance = { provider: 'openalex'|'scholar'|'cnki'|'local'|'manual';
  method: 'api'|'import'|'local'|'manual'; batch_id: string; query_id: string|null;
  import_id: string|null; retrieved_at: string; public_url: string|null;
  verification: 'api'|'user'|'declared' };
type Bibliography = { title: string; authors: string[]; year: number|null; doi: string|null;
  url: string|null; abstract: string|null; language: string|null; work_type: string|null;
  journal: { title: string|null; source_id: string|null; issns: string[]; source_type: string|null };
  citations: { count: number; provider: string; retrieved_at: string }|null };
type Record = { record_id: string; provider_id: string|null; bibliography: Bibliography;
  provenance: Provenance; retraction: { state: 'retracted'|'screened_clear'|'unknown';
    source_url: string|null; checked_at: string|null } };
type Result = { result_id: string; record_ids: string[]; preferred_record_id: string;
  alias_ids: string[]; identity_status: 'clear'|'conflict'; conflicts: string[] };
type Evidence = { record_ids: string[]; locator: string; reason: string;
  method: 'manual'|'local_tag'; checked_at: string };
type ConditionReview = { result_id: string; condition_id: string;
  status: 'confirmed'|'hint'|'false'|'unrecorded'; evidence: Evidence|null };
type ScopeReview = { result_id: string; field: 'language'|'work_type'|'retraction'|'journal_identity';
  value: string; evidence: Evidence };
type RepresentativeReview = { result_id: string; role: 'origin'|'baseline'|'survey'|'intersection'; evidence: Evidence };
type JournalReview = { review_id: string; title: string; issns: string[];
  identity_confirmed: boolean; metric: 'JIF'; data_year: number; release_year: number|null;
  category: string; quartile: 'Q1'|'Q2'|'Q3'|'Q4'; source_url: string|null;
  import_description: string|null; checked_at: string; method: 'user' };
type Rules = { version: 1; data_year: number|null; category: string; low_match_limit: 5 };
type ExternalCandidate = { result_id: string; selected_at: string; openalex_id: string|null };
type QueryState = { query: Query; cursor: string|null; total: number|null;
  accepted_cursors: string[]; loaded: number; status: 'idle'|'loading'|'ready'|'failed'|'finished'|'interrupted';
  error: string|null };
type Batch = { batch_id: string; created_at: string; scope: Scope; plan: QueryPlan; rule_snapshot: Rules;
  queries: QueryState[]; record_ids: string[]; excluded_record_ids: string[] };
type Workspace = { version: 1; revision: number; batches: Batch[]; records: Record[];
  results: Result[]; external_candidates: ExternalCandidate[]; condition_reviews: ConditionReview[];
  scope_reviews: ScopeReview[]; representative_reviews: RepresentativeReview[];
  journal_reviews: JournalReview[]; rules: Rules };
```

来源记录 ID 使用注入的 `idFactory()`，不以题名哈希冒充平台身份；同一个查询页重试不得重复产生记录。`verification:'api'` 只是保存时的来源说明，不是安全能力令牌：从备份/导入读回的字段永远不能替代归档转换时的真实请求。来源级记录只保留已规范化、白名单内的公开书目内容，不保存原始文件字节、账号或私有绝对路径。

## Task 1: 来源记录与范围状态

**Files:** 创建 `prototype/desktop/discovery-record.mjs`、`discovery-record.test.mjs`、`discovery-test-fixtures.mjs`；修改 `openalex-search.mjs` 仅导出当前已有 URL/DOI 规范化函数。

**Interfaces:** `normalizeDiscoveryRecord(input): Record`、`isValidDiscoveryRecord(value): boolean`、`classifyDiscoveryScope(record, scope): {status:'included'|'pending'|'excluded', reasons:string[]}`。现有内部 `safeHttpsUrl`/`normalizeDoi` 增加同名 export，不更改旧调用语义。

- [ ] **Step 1 — 写失败测试与合成数据工厂。** 工厂 `recordInput(patch={})` 返回下例对象再覆盖顶层 patch；后续任务可以直接导入它。另提供 `memoryStorage()`（Map + getItem/setItem/removeItem）和 `deferred()`（返回 promise/resolve/reject）。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiscoveryRecord, classifyDiscoveryScope } from './discovery-record.mjs';
import { recordInput } from './discovery-test-fixtures.mjs';
test('unknown metadata is pending, never a manufactured language or zero citations', () => {
  const record = normalizeDiscoveryRecord(recordInput());
  assert.equal(record.bibliography.citations, null);
  assert.equal(record.bibliography.language, null);
  assert.equal(classifyDiscoveryScope(record, {startYear:null,endYear:null,language:'zh'}).status, 'pending');
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-record.test.mjs`，应因新模块/导出尚不存在失败，不接受语法错误作为有效红灯。
- [ ] **Step 3 — 实现规范化与确切 fixture。** 以下是工厂默认输入；规范化须对顶层、书目、期刊、出处和撤稿对象校验确切字段，对 getter、非普通对象、危险原型字段直接拒绝。字符串上限：题名 1,000，摘要 20,000，作者 50×300，期刊 500，ISSN 10 项、ISO 年份 1000–9999、URL 2,048；身份非法拒绝而不截断。文献类型/语言未知可保留，不按题名推断。

```js
export function recordInput(patch = {}) {
  return { record_id:'r-1', provider_id:null,
    bibliography:{title:'Synthetic distributed optimization study',authors:['Example Author'],
      year:2024,doi:'10.1234/fixture.1',url:'https://example.org/paper/1',abstract:null,
      language:null,work_type:null,journal:{title:null,source_id:null,issns:[],source_type:null},citations:null},
    provenance:{provider:'manual',method:'manual',batch_id:'b-1',query_id:null,import_id:null,
      retrieved_at:'2026-09-05T00:00:00.000Z',public_url:'https://example.org/paper/1',verification:'declared'},
    retraction:{state:'unknown',source_url:null,checked_at:null}, ...patch };
}
```

范围判断顺序：可靠已撤稿→excluded；已知年份/语言不符→excluded；需要比较但缺值或撤稿未知→pending；其余 included。不限年份无需补年份，无语言限制无需补语言。不得把 pending 计入“已确认符合范围”。任何一条来源可靠报告撤稿均优先，后续人工覆写不得消除可靠撤稿冲突。

- [ ] **Step 4 — 验证绿灯与安全回归。** `node --test prototype/desktop/discovery-record.test.mjs prototype/desktop/openalex-search.test.mjs prototype/desktop/candidate-storage.test.mjs`。加入大小写 DOI、凭据 URL、多重编码、未知语言、类型、年份、0 引用与缺失引用不同、撤稿与范围组合用例。
- [ ] **Step 5 — 按提交纪律提交。** `feat: add provenance-aware discovery records`。

## Task 2: 身份合并、冲突与拆分

**Files:** 创建 `prototype/desktop/discovery-identity.mjs`、`discovery-identity.test.mjs`。

**Interfaces:** `mergeDiscoveryRecords({records,results,incoming,idFactory}): {records,results,changed_result_ids}`；`splitDiscoveryResult({records,results,result_id,groups,idFactory}): {records,results,invalidated_result_ids}`。`groups` 是旧 `record_ids` 的完整、互斥分区。不在模块内改写核验或候选；用返回 ID 通知状态层。

- [ ] **Step 1 — 写重复与冲突失败测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { recordInput } from './discovery-test-fixtures.mjs';
import { normalizeDiscoveryRecord } from './discovery-record.mjs';
import { mergeDiscoveryRecords } from './discovery-identity.mjs';
test('same DOI retains two source records and one result', () => {
  const a = normalizeDiscoveryRecord(recordInput());
  const b = normalizeDiscoveryRecord(recordInput({record_id:'r-2'}));
  let n=0;
  const merged=mergeDiscoveryRecords({records:[],results:[],incoming:[a,b],idFactory:()=>`result-${++n}`});
  assert.equal(merged.records.length,2);
  assert.equal(merged.results.length,1);
  assert.deepEqual(merged.results[0].record_ids,['r-1','r-2']);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-identity.test.mjs`。
- [ ] **Step 3 — 实现保守汇总。** 先比较规范 DOI；缺少 DOI 时只允许经真实 API 核实且 provider 相同的 ID。题名规范化仅用于查冲突：不同非空 DOI、不同明确年份/刊版、明显题名冲突均不自动合并；标题近似只返回冲突线索。合并选择既有 result_id，保留 alias_ids；preferred_record_id 按可信出处、完整度、稳定 ID 决定，不随响应顺序任意变动。

```js
const doiKey = r => r.bibliography.doi ? `doi:${r.bibliography.doi}` : null;
const verifiedKey = r => r.provenance.verification === 'api' && r.provider_id
  ? `${r.provenance.provider}:${r.provider_id}` : null;
// key 只找候选簇；逐对核对元数据后才允许合并。不能直接对 key 做传递闭包。
```

后到矛盾把既有结果标记 conflict，保留来源与 ID；显式拆分验证 groups 恰好覆盖旧记录，至少两组，不转移缺少来源定位的条件证据。重复 `record_id` 同体为 no-op，异体为冲突，不覆写。

- [ ] **Step 4 — 验证绿灯。** 补 DOI 相同但不相关题名、A/B 已合并后 C 冲突、疑似版本、输入乱序、重复页、别名引用、非法拆分、不修改输入测试，运行同文件。
- [ ] **Step 5 — 提交。** `feat: preserve source identities and discovery conflicts`。

## Task 3: BibTeX/RIS 导入与候选导出

**Files:** 创建 `prototype/desktop/bibliography-import.mjs`、`bibliography-import.test.mjs`。

**Interfaces:** `parseBibliography({text,format,provider,batch_id,import_id,now,idFactory}): {records:Record[],warnings:string[]}`；`exportBibliography(records,{format}): string`。format 仅 `bibtex|ris`；输入只允许 Scholar/CNKI/manual 声明来源，不能声明为 API。所有记录先预览，解析本身不持久化、不请求网址。

- [ ] **Step 1 — 写失败测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { parseBibliography, exportBibliography } from './bibliography-import.mjs';
test('RIS imports a declared record without inventing OpenAlex identity', () => {
  const text='TY  - JOUR\nTI  - Synthetic study\nDO  - 10.1234/fixture.1\nER  -\n';
  const {records}=parseBibliography({text,format:'ris',provider:'cnki',batch_id:'b-1',import_id:'i-1',now:'2026-09-05T00:00:00.000Z',idFactory:()=> 'r-1'});
  assert.equal(records[0].provider_id,null);
  assert.equal(records[0].provenance.verification,'declared');
  assert.equal(records[0].retraction.state,'unknown');
  assert.match(exportBibliography(records,{format:'ris'}), /DO  - 10\.1234\/fixture\.1/u);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/bibliography-import.test.mjs`。
- [ ] **Step 3 — 实现线性扫描解析器。** RIS 以 `TY` 开头、`ER` 结束，识别 TI/T1、AU/A1、PY/Y1、DO、UR、JO/JF/T2、SN、AB、LA，续行只附加前一已知字段。BibTeX 逐字符扫描 entry、key、字段值，支持花括号/双引号/数字及受限转义；嵌套深度最多 16；允许 `@comment` 忽略，拒绝 `@string`、`@preamble`、`#` 宏拼接和未闭合内容并指出位置。未知普通书目字段丢弃并警告，不把恶意指令当说明执行。`\write`、`\input` 等 TeX 不执行，不自动解析外链。下列循环界定解析资源；不要用一个巨型正则表达式读取嵌套 BibTeX。

```js
if (new TextEncoder().encode(text).byteLength > 2*1024*1024) throw new RangeError('导入文件超过 2 MiB');
let depth=0;
for (let offset=0; offset<text.length; offset+=1) {
  if (text[offset]==='{' && text[offset-1]!=='\\') depth+=1;
  if (text[offset]==='}' && text[offset-1]!=='\\') depth-=1;
  if (depth<0 || depth>16) throw new SyntaxError(`花括号层级无效：${offset}`);
}
```

实际扫描要同时跟踪连续反斜线奇偶和引号状态；上例资源检查不得取代完整语法状态机。全文解析失败/超过 500 条时不返回半批成功；缺少题名逐条警告并由预览明确排除，不补假题名。期刊名称不能单独证明期刊类型。导出转义语法字符，保持公开 DOI/来源，不导出认证内容。

- [ ] **Step 4 — 验证绿灯。** 覆盖中文、多作者、花括号题名、转义、BOM/CRLF、未知语言/年份、HTML 字符纯文本、2 MiB/500 条边界、嵌套攻击、畸形末条、无网络调用、BibTeX/RIS 往返。运行同文件及 `discovery-record.test.mjs`。
- [ ] **Step 5 — 提交。** `feat: import bounded bibliography records with provenance`。

## Task 4: 保留分组的查询规划与外部入口

**Files:** 创建 `prototype/desktop/discovery-query-plan.mjs`、`discovery-query-plan.test.mjs`；修改 `discovery.mjs` 的 `buildKeywordSearchExpression`、`directions.mjs` 的跳转参数及 `discovery-dom.test.mjs`。

**Interfaces:** `buildDiscoveryQueryPlan({raw,conditions,expand,primary_ids}): QueryPlan`；`directionToConditions(axes): {conditions,warnings}`；`buildExternalSearchLinks({query,scope}): {scholar:string,cnki:string,cnki_terms:string,scope_notice:string}`。`buildKeywordSearchExpression(value)` 保留导出，委托新模块里的 `translateDiscoveryKeywords(value): string`。

- [ ] **Step 1 — 写原样保留与条件计数失败测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { buildDiscoveryQueryPlan, translateDiscoveryKeywords } from './discovery-query-plan.mjs';
test('original Boolean query stays intact; 在线 is not damaged', () => {
  const raw='("online optimization" AND "gradient tracking")';
  const plan=buildDiscoveryQueryPlan({raw,conditions:[],expand:false,primary_ids:[]});
  assert.equal(plan.selected[0].expression,raw);
  assert.equal(plan.conditions.length,0);
  assert.match(translateDiscoveryKeywords('在线优化'),/online optimization/u);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-query-plan.test.mjs`。
- [ ] **Step 3 — 实现条件规划。** 中文翻译先最长词匹配再处理连接词，不在匹配前删除“在”；未知残余明确报错。原始式不解析时可以直接搜索，无条件 ID 则不生成 k/N。明确条件以稳定 ID 去重，同义词组合如下；需要引号转义的词先拒绝并要求修改，不让它逃逸成运算符。

```js
const conditionExpression = c => c.terms.length===1
  ? `"${c.terms[0]}"` : `(${c.terms.map(term=>`"${term}"`).join(' OR ')})`;
const combine = conditions => `(${conditions.map(conditionExpression).join(' AND ')})`;
```

方向页传递版本化、长度受限的 axes JSON 参数与原始关键词；发现页严格验证允许的 axis/value，不写回保存快照。同轴多个值先作为一个 OR 条件组，显示“分布式优化或在线优化”等 label；只有用户在预览明确拆成独立条件后才计两条 AND 条件。单个术语映射用固定 ID；未确认转换不得自动发起多查询。

扩展候选优先级：主问题组合、主问题+网络、主问题+方法、完整交集、按稳定 ID 排序的单条件。去重后取 6 条 selected，其余 suggested；至少保留完整交集，不截断而隐瞒建议。手写原式作为 original 保留，扩展须点击确认；URI 编码后超出请求边界时提示减短，不能静默裁词。

外部 Scholar URL 用 `https://scholar.google.com/scholar` 与 URLSearchParams 的 q/as_ylo/as_yhi；CNKI 固定官方检索入口并复制中文词。明确外部语言筛选未自动设置，来源页面仍需用户确认范围；不在 URL 放账号信息。所有外跳普通 HTTPS 链接、新窗口、noopener noreferrer。

- [ ] **Step 4 — 验证绿灯。** 覆盖 OR 同义词、同轴多选、5 条独立条件、超过 6 查询未执行提示、原式 NOT/括号完整保留、重复词、未知中文、方向参数污染/过长、空年份、外部链接范围说明。运行新测试及 `discovery-dom.test.mjs`、`direction-snapshot.test.mjs`、`desktop-pages.test.mjs`。
- [ ] **Step 5 — 提交。** `feat: plan transparent broad and intersection searches`。

## Task 5: 丰富 OpenAlex 题录与真实 DOI 转换边界

**Files:** 修改 `prototype/desktop/openalex-search.mjs`、`openalex-search.test.mjs`；创建 `discovery-candidate-bridge.mjs`、`discovery-candidate-bridge.test.mjs`。

**Interfaces:** 旧 `searchOpenAlexWorks(options)` 和 12 字段 work 不变；新增 `searchOpenAlexDiscoveryPage({...options,batch_id,query_id,now,idFactory}): Promise<{records,works,total,nextCursor}>`。新增 `fetchOpenAlexWorkByDoi({doi,fetchImpl,signal}): Promise<VerifiedWork>` 和 `readVerifiedOpenAlexWork(token): {work,bibliography,retraction}`；VerifiedWork 是此模块 WeakMap 品牌对象，JSON 复制失效。桥接 `prepareExternalCandidateConversion({result,records,fetchImpl,signal}): Promise<{status:'verified',token,work}|{status:'unverified'|'conflict',reason}>`，不写 store。

- [ ] **Step 1 — 写拒绝伪造 token 与元数据测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { readVerifiedOpenAlexWork, searchOpenAlexDiscoveryPage } from './openalex-search.mjs';
test('plain objects cannot acquire verified API identity', () => {
  assert.throws(()=>readVerifiedOpenAlexWork({paperId:'W123',verified:true}),TypeError);
});
test('discovery page is a separate public entry point', () => {
  assert.equal(typeof searchOpenAlexDiscoveryPage,'function');
});
```

在已有 `jsonResponse`/合成 payload 基础上再断言 missing cited_by_count 在 records 是 null，而旧 works 保持当前兼容表现；language/type/is_retracted 与 primary_location.source 的 id/type/issn/issn_l 都保留。

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/openalex-search.test.mjs prototype/desktop/discovery-candidate-bridge.test.mjs`。
- [ ] **Step 3 — 实现共享受控读取，不重复发请求。** 现有 payload 校验后分别生成 legacy works 与 Record；SELECT 增加 language/type/is_retracted，primary_location 已涵盖 source 信息。缺少嵌套来源字段保持未知，不额外循环抓取所有期刊。DOI 请求仅走固定官方 endpoint，禁止自动重定向到外部；404→unverified，429/网络错误明确可重试，AbortError 原样传播。

```js
const verifiedWorks = new WeakMap();
// 在成功请求并核对返回 DOI 后执行，绝不 export 此创建步骤：
const token=Object.freeze({});
verifiedWorks.set(token, structuredClone({work,bibliography,retraction}));
// readVerifiedOpenAlexWork：无 WeakMap 命中则抛 TypeError，命中返回深拷贝。
```

桥接要求：result identity clear、原 DOI 唯一、请求返回 DOI 一致、无明显标题/版本冲突、未撤稿。只有真实规范化响应生成 work；无 DOI 时本版返回 unverified，不根据标题猜测。复制 token 或持久化 verification 字段不能取得能力。确认前界面仍须重新检查 result/batch，旧 store 的 100 条/持久化失败语义保留。

实现参考已经核实的官方说明：[布尔搜索](https://help.openalex.org/api/searching/)、[按 DOI 取得单条记录](https://help.openalex.org/api/get-single-entities/)、[Work 字段](https://help.openalex.org/data/works/attributes/)、[Source 字段](https://help.openalex.org/data/sources/attributes/)。不据此承诺覆盖所有全文或永久免费无限请求。

- [ ] **Step 4 — 验证绿灯。** 固定响应覆盖 DOI 成功/不符/缺失、标题冲突、复制 token、伪 W ID、301/404/429/Abort、超长载荷、不安全 OA 链接、source ISSN 缺失、撤稿 true、旧 candidate exact keys。运行新测试、`candidate-storage.test.mjs` 与 `discovery-record.test.mjs`。
- [ ] **Step 5 — 提交。** `feat: verify external candidates through real OpenAlex records`。

## Task 6: 本地主题召回与材料状态

**Files:** 创建 `prototype/desktop/local-discovery.mjs`、`local-discovery.test.mjs`；修改 `local-paper-match.mjs`、`local-paper-match.test.mjs`、`discovery-dom.test.mjs`。

**Interfaces:** `searchLocalDiscovery({papers,conditions,raw,scope}): {paper,hint_condition_ids,matched_fields}[]`；`matchLocalPaper(work,papers)` 返回状态枚举不变，在 matches 每项增加 `hasNote:boolean`；主题搜索不调用这个函数决定相关性。

- [ ] **Step 1 — 写未同篇但主题相关测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { searchLocalDiscovery } from './local-discovery.mjs';
test('local topical evidence is a hint even without online identity', () => {
  const paper={paper_id:'Local-01',title_original:'Gradient tracking on networks',doi_or_url:''};
  const hits=searchLocalDiscovery({papers:[paper],raw:'',scope:{startYear:null,endYear:null,language:'all'},
    conditions:[{id:'gradient-tracking',label:'梯度跟踪',terms:['gradient tracking'],role:'method'}]});
  assert.equal(hits.length,1);
  assert.deepEqual(hits[0].hint_condition_ids,['gradient-tracking']);
  assert.ok(hits[0].matched_fields.includes('title_original'));
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/local-discovery.test.mjs`。
- [ ] **Step 3 — 实现有出处的本地线索。** 只读题名多个语言字段、已有摘要、笔记预览和结构化 facets。英文按词边界、NFKC/大小写匹配，中文术语按完整短语匹配；只做已知双语术语映射，不虚构全文翻译或语义向量召回。返回实际命中字段。`hint_condition_ids` 不自动变 confirmed；既有人工 facet 需保留其状态/出处，pending 标签不得当已确认。

```js
const hasNote = paper => (Array.isArray(paper.artifacts?.note) && paper.artifacts.note.length>0)
  || paper.artifact_availability?.note===true;
```

PDF 仍只根据可查看 source_documents.pdf URL；note 标记为“已索引”，不保证内容质量。papers 不是成功载入的数组时抛错，由界面显示 unknown，绝不退回空数组伪装无论文。复用身份核验但增加“同 DOI + 另一身份明显冲突”保护；不以 PDF 存在消除冲突。

- [ ] **Step 4 — 验证绿灯。** 运行新测试及 `local-paper-match.test.mjs`、`discovery-dom.test.mjs`；补笔记只有索引标记、PDF 缺失、索引失败、中文题名、否定/背景只为线索、无正文读取、私有路径不泄露测试。
- [ ] **Step 5 — 提交。** `feat: separate local topic recall from exact paper matching`。

## Task 7: 两并发多查询批次与分页

**Files:** 创建 `prototype/desktop/discovery-batch.mjs`、`discovery-batch.test.mjs`。

**Interfaces:** `createDiscoveryBatchController({searchPage,onChange,now,idFactory})` 返回 `start({plan,scope,sort,rules}): Promise<void>`、`loadMore(query_id): Promise<void>`、`retry(query_id): Promise<void>`、`cancel():void`、`read():{batch,records,results,generation}`、`acceptImported({generation,records}):boolean`。rules 可省略，默认为共享契约的空规则；生产控制器传入已确定数据年的规则，保存到 batch.rule_snapshot。searchPage 使用任务 5 的形状；onChange 只接收防御性副本；本地记录经相同 acceptImported 通路合并，不伪造成在线查询计数。

- [ ] **Step 1 — 写旧响应不能盖新批次测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { deferred } from './discovery-test-fixtures.mjs';
import { createDiscoveryBatchController } from './discovery-batch.mjs';
test('late page from A cannot replace B', async () => {
  const a=deferred(); let id=0;
  const c=createDiscoveryBatchController({searchPage:args=>args.query==='A'?a.promise:Promise.resolve({records:[],works:[],total:0,nextCursor:null}),
    onChange:()=>{},now:()=> '2026-09-05T00:00:00.000Z',idFactory:()=>`id-${++id}`});
  const plan=q=>({conditions:[],selected:[{query_id:q,expression:q,condition_ids:[],kind:'original'}],suggested:[],warnings:[]});
  const scope={startYear:null,endYear:null,language:'all'};
  const first=c.start({plan:plan('A'),scope,sort:'relevance'});
  await c.start({plan:plan('B'),scope,sort:'relevance'});
  a.resolve({records:[],works:[],total:100,nextCursor:null}); await first;
  assert.equal(c.read().batch.queries[0].query.query_id,'B');
  assert.equal(c.read().batch.queries[0].total,0);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-batch.test.mjs`。
- [ ] **Step 3 — 实现队列和令牌隔离。** 每次 start/cancel 增加 generation，取消旧 AbortController；每个 query/cursor 有独立 request token；队列调度 active<2，每条 selected 只取首页 25。loadMore/retry 入队不自动追下一页；相同正在请求的 cursor 不再入队。

```js
const expectedGeneration=generation;
const requestToken=Symbol(query.query_id);
inFlight.set(query.query_id,requestToken);
const current=()=>generation===expectedGeneration && inFlight.get(query.query_id)===requestToken;
try {
  const page=await searchPage(request);
  if (!current()) return;
  // 此分支内才接受 records、游标、计数并触发 onChange。
} finally {
  if (current()) inFlight.delete(query.query_id);
  // active 计数归属同一代调度器，不释放新批次的并发槽。
}
```

页只在全部校验、合并成功后加入 accepted_cursors；失败保留旧结果和游标。多步循环游标 a→b→a 标记 failed，不声称末页。来源 total 保持每条 query 的报告值；总页数/多源总数不求和冒充唯一文献数。导入确认携带 generation，过期时拒绝而非加入新批次。重复页计数 no-op，records 冲突可见且阻止推荐/转换。

- [ ] **Step 4 — 验证绿灯。** 除上例外测试 A→B→A、旧 catch/finally、两请求上限、批次 6 条上限、重复导入 token、部分失败/429、重试成功、循环游标、跨查询去重后量小于原始量、切换视图不调用 searchPage。运行新测试和任务 2 测试。
- [ ] **Step 5 — 提交。** `feat: manage independent discovery queries and pagination`。

## Task 8: JCR 核验与分层推荐纯函数

**Files:** 创建 `prototype/desktop/journal-review.mjs`、`journal-review.test.mjs`、`discovery-recommendation.mjs`、`discovery-recommendation.test.mjs`。

**Interfaces:** `parseJournalCsv({text,mapping,now,idFactory}): {rows:JournalReview[],warnings:string[]}`，mapping 为内部字段名到列名的显式映射；`validateJournalReview(value):boolean`；`evaluateJournalGate({bibliography,journal_reviews,rules,scope_reviews=[],result_id=null}):{status:'pass'|'pending'|'fail',basis:string[],missing:string[]}`；`evaluateDiscoveryRecommendation({result,records,conditions,condition_reviews,scope_reviews,representative_reviews,journal_reviews,rules,scope}):{result_id,status:'recommended'|'pending'|'not_recommended'|'excluded',confirmed_ids:string[],missing:string[],reasons:string[],group_id:string|null,limit:5|25|null}`；`selectDiscoveryRecommendations({evaluations,results,records,sort,page=1}):{visible_ids:string[],overflow_ids:string[],has_more:boolean}`。

- [ ] **Step 1 — 写未知 JCR 与错误指标失败测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluateJournalGate, validateJournalReview } from './journal-review.mjs';
import { recordInput } from './discovery-test-fixtures.mjs';
test('unknown quartile does not silently pass; SJR is not JIF', () => {
  const gate=evaluateJournalGate({bibliography:recordInput().bibliography,journal_reviews:[],
    rules:{version:1,data_year:null,category:'Automation & Control Systems',low_match_limit:5}});
  assert.equal(gate.status,'pending');
  assert.equal(validateJournalReview({metric:'SJR',quartile:'Q1'}),false);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/journal-review.test.mjs prototype/desktop/discovery-recommendation.test.mjs`。
- [ ] **Step 3 — 实现可追溯资格。** CSV 状态机支持引号、双引号转义、CRLF、多行字段；按 2 MiB/500 行限制，未知列只预览不执行公式。mapping 必須涵盖刊名/ISSN/JIF 指标/数据年/学科/Q/来源。无精确年份学科身份不通过；自动识别其他指标时拒绝而非改名 JIF。数据只是用户核验记录，不标为实时官方接口。

先按 scope/retraction/identity 决定 excluded 或 pending，再应用期刊门槛，最后计算条件和代表性；未知不得转为 false。多个来源语言或身份冲突要显示并待核验；原始已撤稿不可被更晚未报告撤稿覆盖。JCR 年份固定一批，默认从合法已确认记录取最大 data_year；相同年/类出现不同 Q 待核验，不挑最好。CSV 预览行 identity_confirmed=false，用户确认身份后才置 true 并可作为推荐依据。中文准入须中文书目语言及已确认期刊身份，无 ISSN 时只允许 scope_reviews 中该 result 的 journal_identity 记录，其 value 为精确中文刊名且 Evidence 指向相应来源；不因 IEEE/CAA 含相似词通过。

```js
const confirmed_ids=[...new Set(condition_reviews
  .filter(r=>r.result_id===result.result_id && r.status==='confirmed' && r.evidence)
  .map(r=>r.condition_id))].filter(id=>conditions.some(c=>c.id===id)).sort();
const k=confirmed_ids.length, n=conditions.length;
const highMatch=k>=4 && n>0 && k/n>=0.8;
const group_id=k ? confirmed_ids.join('|') : null;
const limit=highMatch ? 25 : 5;
```

证据定位必须引用当前无冲突 Result 的来源记录，不能只判断 evidence 对象非空；已拆分/来源不符则 pending。k=0 不推荐。k=1 接受 origin/baseline/survey；k≥2 且非 highMatch 需要 intersection 的可追溯角色；highMatch 不要求引用下限或代表性老资历。预印本/会议保持全部可见，不自动取期刊推荐资格。

分组使用完整已确认 ID 集合，跨组不复制。低匹配组取前 5，其他进 overflow；高匹配不截断。组合后统一按 page 每页 25 条，has_more 表示下一页仍有推荐，不能指向网上检索游标；低匹配超名额仍留全部结果和 overflow，不冒称不符合。相同比例/条件数按稳定组 ID；组内排序先显式模式：newest 按年份，citations 先按来源+同年分桶再比较引用，缺失排后；relevance 按本轮确认程度和稳定 ID，不把不同查询的分数混成一个精确分值。

- [ ] **Step 4 — 验证绿灯。** 完整矩阵：Q1/Q2/Q3/unknown；JIF/JCI/SJR；年份/学科不符和冲突；两中文 ISSN 及两相似英文刊；1/2/3/4/5 条与 4/10 条；1/1 仍需代表性；引文 0 的高匹配新作；同源不同查询/人工导入相同证据相同资格；hint/false/unrecorded；撤稿未知与 true；CSV 注入和取消预览。运行四个相关测试文件（含 record、identity）。
- [ ] **Step 5 — 提交。** `feat: add evidence-based journal gates and curated recommendations`。

## Task 9: 独立检索工作区状态与容量保护

**Files:** 创建 `prototype/desktop/discovery-workspace.mjs`、`discovery-workspace.test.mjs`。

**Interfaces:** 导出 `DISCOVERY_WORKSPACE_STORAGE_KEY='research-console.discovery-workspace.v1'`、`createEmptyDiscoveryWorkspaceState():Workspace`、`isValidDiscoveryWorkspaceState(value):boolean`、`createDiscoveryWorkspaceStore(storage)`。store 提供 `read()`、`reload()`、`getLoadStatus()`、`readValidatedState()`、`replaceValidated(nextState)`、`commit(nextState)`。

readValidatedState 返回 `{status:'valid'|'missing'|'invalid'|'unavailable',state}`，必须读取真实存储；missing 返回空值但不创建 key。replaceValidated 成功 `{replaced:true,state}`，失败 `{replaced:false,status:'stale'|'unavailable'|'invalid'|'persistence_failed'|'rollback_failed',state}`；非法输入先抛 TypeError。commit 是业务包装，成功 `{persisted:true,state}`，失败 `{persisted:false,reason,state}`；失败不让内存进入“已保存”假状态。

- [ ] **Step 1 — 写无键读取、复制与失败保存测试。**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { memoryStorage } from './discovery-test-fixtures.mjs';
import { createDiscoveryWorkspaceStore, DISCOVERY_WORKSPACE_STORAGE_KEY } from './discovery-workspace.mjs';
test('missing workspace is readable without creating a persisted key', () => {
  const storage=memoryStorage(); const store=createDiscoveryWorkspaceStore(storage);
  assert.equal(store.readValidatedState().status,'missing');
  assert.equal(storage.getItem(DISCOVERY_WORKSPACE_STORAGE_KEY),null);
  const copy=store.read(); copy.rules.category='Changed';
  assert.equal(store.read().rules.category,'Automation & Control Systems');
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-workspace.test.mjs`。
- [ ] **Step 3 — 实现原始字节基线与严格跨引用校验。** 参考 candidate-storage 的 readValidatedState/replaceValidated，不复制其失败仍内存新增的 add 语义。保存前比较 exact raw baseline，成功后读回证明，失败尝试恢复之前字节并区分无法证明回滚。revision 非负递增；replaceValidated 为恢复/备份可接受合法指定 revision，commit 必须由当前 revision+1 生成。恢复 loading 批次为 interrupted 仅在内存，用户重试才持久化，不能启动自动网络请求。

```js
export function createEmptyDiscoveryWorkspaceState() {
  return {version:1,revision:0,batches:[],records:[],results:[],external_candidates:[],
    condition_reviews:[],scope_reviews:[],representative_reviews:[],journal_reviews:[],
    rules:{version:1,data_year:null,category:'Automation & Control Systems',low_match_limit:5}};
}
```

校验每个 record/result/batch 的 ID 唯一、所有引用存在、aliases 无循环、拆分证据不能错误关联、外部候选只引用当前结果。上限约束记录数≤1,000（按来源记录计），UTF-8 整份≤4 MiB；每个结果最多 10 条来源、每条件核验理由≤2,000、locator≤2,048、工作区批次≤100、每批查询≤6，接受页/出处附加项也受总字节限制。超限拒绝整个持久化，不自动删除旧批次。会话中已加载的临时结果由 batch controller 保留且显示“未保存”，允许按选中记录导出 BibTeX/RIS；完整备份只导出当前合法持久状态，不能声称包含未保存超限内容。

清理必须显式确认具体 batch ID；删除只属于该批次且没有候选/核验/其他批次引用的来源记录，保留仍被引用的数据并显示无法清理数。不得触碰旧 candidate storage 或源目录。外部候选保留 openalex_id 交叉引用，阶段从旧 owner 派生。

- [ ] **Step 4 — 验证绿灯。** 覆盖 missing/invalid/unavailable、getter/symbol、无引用对象、deep clone、raw 字节相同语义不同仍 stale、写后抛错/回滚失败、4 MiB UTF-8 汉字边界、1,000/1,001、并发 tab、候选引用保护清理、恢复不自动查询。运行新测试和 candidate-storage 回归。
- [ ] **Step 5 — 提交。** `feat: persist bounded discovery workspaces safely`。

## Task 10: 完整备份 version 3 与旧版兼容

**Files:** 修改 `prototype/desktop/state-transfer.mjs`、`state-transfer.html`、`state-transfer.test.mjs`、`state-transfer-dom.test.mjs`；同步任务 12 注册表中迁移服务及新 owner 的静态依赖闭包。

**Interfaces:** 保留 `exportStateBundle({storage,originLabel,exportedAt})`、`validateStateBundle(raw)`、`previewStateMerge({current,bundles,knownPaperIds})`、`applyStateMerge({storage,plan,decisions})`。新增 owner `discovery_workspace`；v3 counts 增加 `discovery_results`、`discovery_external_candidates`。内部 merge plan 仍 version 1，不变更它的顶层键集。

- [ ] **Step 1 — 在现有测试中写 v3 失败断言。** 使用该文件已有的 `stateStorage`、`emptyState`、`bundleFor`，在 emptyState 增加任务 9 的合法空 owner；旧包工厂另行保留，不用删除断言掩盖兼容问题。

```js
test('new exports contain an empty seventh owner with verified counts', async () => {
  const bundle=await bundleFor(emptyState());
  assert.equal(bundle.version,3);
  assert.equal(bundle.counts.discovery_results,0);
  assert.equal(bundle.counts.discovery_external_candidates,0);
  assert.equal(bundle.state.discovery_workspace.version,1);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/state-transfer.test.mjs`，新 version/owner 断言必须失败。
- [ ] **Step 3 — 逐点更新版本分派与事务。** 明确 V1/V2/V3 的 STATE_KEYS、COUNT_KEYS；bundleShape/stateIsValid/countsFor/countsAreValid 按实际版本验证，旧包 hash 以其原结构校验后再参与预览。导出 current 必须 v3；导入接受 1/2/3。P02 仍只允许实际 valid，新 owner 允许 valid/missing，invalid/unavailable 阻止导出。

```js
const V3_STATE_KEYS=[...V2_STATE_KEYS,'discovery_workspace'];
const V3_COUNT_KEYS=[...V2_COUNT_KEYS,'discovery_results','discovery_external_candidates'];
const keysByVersion={1:V1_STATE_KEYS,2:V2_STATE_KEYS,3:V3_STATE_KEYS};
// P02 参与的输入：version >= 2；discovery_workspace 参与的输入：version === 3。
```

使用现有 wholeDocumentConflict 策略处理新 owner：保留 current 为默认，明确 replace 才整份替换，禁止自行 merge 内部别名/证据图。旧 v1/v2 不产生“空新 owner”覆盖。更新 decisionsFor、planIsStructurallyValid、所有最终 stateIsValid 调用；replacementOperations 加入新 owner，使成功复读及逆序 rollback 都包含它。保留 16 MiB 单包/32 MiB 输入、SHA256、stale plan 和单次消费约束。无实质变化不创建原本不存在的 key。

- [ ] **Step 4 — 验证绿灯。** 用显式 legacy 工厂删除对应 state/count 字段并重算 hash；覆盖 v1保留P02+新owner、v2保留新owner、v3整份冲突默认skip/明确replace、新 owner stale 零写入、后续 owner 失败全体回滚、新 owner 回滚失败、counts 漂移、非法跨引用、取消预览、摘要文案。运行两份 state-transfer 测试和 candidate-storage 测试。
- [ ] **Step 5 — 提交。** `feat: include discovery workspace in version three backups`。

## Task 11: 搜索页、外部导入、推荐核验与候选衔接

**Files:** 创建 `prototype/desktop/discovery-results-ui.mjs`、`discovery-results-ui.test.mjs`、`discovery-review-ui.mjs`、`discovery-review-ui.test.mjs`；修改 `discovery.mjs`、`discovery.template.html`、`styles.css`、`discovery-dom.test.mjs`。

**Interfaces:** `renderDiscoveryResults({root,results,records,evaluations,view,onSelect,onReview,localMatches})`；`createDiscoveryReviewController({root,getContext,onCommit})` 返回 `open(result_id)`、`close()`，onCommit 接收完整已校验的待更新工作区与期望 revision/generation，控制器不直接调用 localStorage。原 `createKeywordDiscoveryController` 增加可注入 `workspaceStore`、`searchPage`、`batchController`；保留 known-paper/access/recovery 的原接口及归档行为。`getWorks()` 继续返回旧 OpenAlex 记录投影，新增 `getDiscoverySnapshot()` 返回批次与全部/推荐视图状态。

- [ ] **Step 1 — 扩充 fake DOM 并写默认全结果测试。** keywordRoot 增加 `[data-discovery-view]` 两标签和 `#discovery-import-file`、`#discovery-import-preview`、`#discovery-query-plan`、`#discovery-review-panel`、`#discovery-source-status`。新的 results-ui 测试可复用 makeElement，但需先抽到合成 fixture 模块并保持旧行为。

```js
test('all view is default and switching to curated does not query again', async () => {
  const root=keywordRoot(); let calls=0;
  const controller=createKeywordDiscoveryController({root,candidateStore:candidateStore(),
    fetchImpl:async()=>({ok:false}),loadIndex:async()=>({papers:[]}),
    searchWorks:async()=>{calls+=1;return {total:1,works:[task11Candidate()],nextCursor:null};}});
  await controller.start(); await root.elements.get('#keyword-live-search').dispatch('click');
  assert.equal(controller.getDiscoverySnapshot().view,'all');
  await root.elements.get('[data-discovery-view="curated"]').dispatch('click');
  assert.equal(calls,1);
});
```

- [ ] **Step 2 — 验证红灯。** `node --test prototype/desktop/discovery-dom.test.mjs prototype/desktop/discovery-results-ui.test.mjs prototype/desktop/discovery-review-ui.test.mjs`。
- [ ] **Step 3 — 分段接入但同任务交付完整 UI。** 默认只展示搜索框/范围、全部/推荐、结果与候选。组合详情、来源计数、外部导入、核验放折叠区/共用面板，不增加主导航。全部视图分常规与待核验，显示唯一已加载数、来源/组合计数、排除原因；不要使用“领域共 N 篇”。推荐空态说明缺什么依据，提供回到全部入口。

```js
const label=root.createElement('p');
label.textContent=`去重后已加载 ${results.length} 篇；仅代表本轮已加载范围`;
const link=root.createElement('a');
link.href=verifiedPublicUrl;
link.target='_blank';
link.rel='noopener noreferrer';
// 外部/用户题名、摘要和 CSV 单元格全部通过 textContent，禁止 innerHTML。
```

Scholar/CNKI 外跳仅改为“待导入”，不增加结果数。选择文件→解析→来源/范围/排除预览→用户确认→检查 generation/revision→commit→结果重算；取消、过期或保存失败保留先前状态。手动表单使用同一规范化流程，不允许选择 API 来源；导出只包括实际选择记录。输入格式说明明确 BibTeX/RIS，不许把未知知网格式伪装成兼容。

核验面板合并三类输入：语言/类型/撤稿及出处，条件状态/定位/理由，期刊年度/学科/Q及代表性角色。JCR CSV 需字段映射和独立预览，确认后才保存；更换年度/学科固定规则快照并重算，无后台自动修改。对于自动关键词建议只能保存 hint；confirmed 必须经过人工确认且证据完整。

外部“加入候选”只写新 owner。点击“核验并转入归档候选”才调用任务 5 桥接；确认对话框结束后检查当前 generation/result/source ID/revision/冲突，失效则不写。旧 candidateStore.add 返回 added/persisted 后再记录交叉引用；persisted=false 不显示已保存，不删除外部记录；新 owner 保存失败时保留旧候选并提示“交叉引用待同步”，不以删除旧候选补偿。旧归档能力恢复 banner、索引核对、写入锁原样保留。

旧 searchWorks 注入仅用于旧测试/接口兼容，在新通用结果里元数据不足必须 pending，不得凭 legacy 引用0/缺失语言捏造富元数据。生产默认使用 searchOpenAlexDiscoveryPage；只有真实 API 归档对象能通过桥接。

- [ ] **Step 4 — 验证绿灯。** 覆盖键盘切换、焦点/aria-busy、取消导入、过期预览、同源多查询数量、不合门槛仍全结果可见、未知语言/撤稿分组、PDF/笔记分别标记、两窗口重载、身份冲突核验失效、转换临时保存与归档锁。运行新测试、discovery-dom、candidate-storage、state-transfer-dom、desktop-pages；旧已知论文入口必须通过。
- [ ] **Step 5 — 提交。** `feat: integrate broad results imports and curated review on discovery page`。

## Task 12: 静态闭包、合成验收与私有页面交付

**Files:** 修改下列注册与测试；更新 `README.md`、`prototype/desktop/README.md` 使用说明。所有生成输出经构建更新，不直接编辑。

- `exporter/paper-library/build.mjs` / `build.test.mjs` 的 REQUIRED_DESKTOP_ASSETS。
- `exporter/paper-library/local-server.mjs` / `local-server.test.mjs` 的 APPROVED_PROTOTYPE_FILES 与 APPROVED_GENERATED_ASSET_SET；方向页引用模块也要进入 prototype 白名单。
- `exporter/scripts/serve-state-transfer.mjs` / `.test.mjs` 的 STATE_TRANSFER_ASSET_FILES 及所有静态传递依赖。
- `exporter/config/github-package-files.json`；`exporter/paper-library/package-audit.mjs` / `.test.mjs` 的精确清单、GENERATED_ASSET_SOURCE、GENERATED_PAGE_CLOSURES。
- `exporter/paper-library/runtime.test.mjs`；`exporter/verification/integrated-server-fixture.mjs` 的独立复制清单。
- `exporter/verification/private_library_e2e.py` 中 StrictNetwork/OPENALEX_SELECT；`workbench_integration_e2e.py` 的 verify_search_and_local_matches。

**Interfaces:** 不新增后端写入端点；fixture 沿用 `createIntegratedRepositoryFixture`、`startIntegratedServerFixture`、`temporary_fixture`。浏览器新增固定响应按 `(query,cursor)` 分发，而不是只有 cursor。实际下载、登录、真实资料库写入均不进入测试。

- [ ] **Step 1 — 写资源及浏览器行为失败测试。** 资产测试对每个新模块 GET/HEAD 为 200，未批准路径为 404；公共包禁止出现真实题录/备份。扩展现有 Python 验收，使用固定 query→response 映射；下面检查加入已有 fixture 页面上下文。

```python
page.locator('[data-discovery-view="all"]').click()
before = network.openalex_requests
page.locator('[data-discovery-view="curated"]').click()
ensure(network.openalex_requests == before, 'curated_switch_no_request')
page.locator('[data-discovery-view="all"]').click()
ensure(not writes, 'discovery_no_archive_writes')
```

复用 verify_search_and_local_matches 中已初始化的 network（openalex_requests 为整数）和 writes 列表。计数只包含本搜索用例时间窗，不能拿整个包含其他归档 fixture 的回归累计 POST 作零写入断言。

- [ ] **Step 2 — 验证红灯。** `node --test exporter/paper-library/build.test.mjs exporter/paper-library/local-server.test.mjs exporter/scripts/serve-state-transfer.test.mjs exporter/paper-library/package-audit.test.mjs prototype/desktop/state-transfer-dom.test.mjs`。应出现资源枚举/闭包不匹配，记录确切失败。
- [ ] **Step 3 — 登记精确闭包并扩充合成验收。** 按最终静态 import 递归枚举运行模块，禁止将测试 fixture 加进生产 assets。清单排序，更新固定计数为新清单实际长度；不要删除精确列表测试。所有登记随依赖变化重新跑闭包审计。Python fixture 加入来源重叠/未知JCR/撤稿/本地已有PDF/本地仅笔记/无本地记录/外部导入/晚到冲突固定场景；1280×720、1440×900 两尺寸核查侧栏、列表、核验面板和无横向溢出。

```bash
node --test exporter/paper-library/*.test.mjs prototype/desktop/*.test.mjs exporter/scripts/*.test.mjs exporter/verification/*.test.mjs
node exporter/scripts/audit-github-package.mjs
```

先用工作区依赖定位工具确定可用 Python/Playwright，不猜解释器路径；以 `task_python` 保存绝对路径（不要重用 HOME）。执行：

```bash
"$task_python" -c 'import playwright'
"$task_python" exporter/verification/private_library_e2e.py --temporary-fixture
"$task_python" exporter/verification/institution_access_e2e.py
"$task_python" exporter/verification/workbench_integration_e2e.py
```

这三个回归管理自己的临时 fixture，其中可写入临时论文数据；不得给它们传入真实库路径或活动 origin。浏览器操作须先读适用 Playwright/浏览器技能，所有外部网络由 StrictNetwork 限制并使用固定响应。

- [ ] **Step 4 — 构建并只读查看活动页面。** 全套测试通过后检查活动服务/生成路径确属本工作树，运行现有守护构建 `node exporter/scripts/build-private-library.mjs`。它会更新派生索引与页面，不改源论文；重建失败保留旧生成物，不手动清空。不要停止或替换正在使用的服务；若运行时代码必须重启且存在活动任务，先说明再安排安全交接。

打开本机 discovery 页面做只读验收：资源加载、默认全部视图、检索组合预览、核验空态、本地链接、两尺寸布局；不确认导入、不归档、不恢复、不改用户真实浏览器存储。含交互持久化验证已在临时 fixture 完成。本机网络写入方法必须为零，输出实际截图/检查结果不得含私有路径或论文正文。

- [ ] **Step 5 — 更新说明、复核提交与交付。** 文案必须说明：外部入口+导入不是全自动抓取；质量未知仍可见；推荐需要证据；缺 OpenAlex 身份暂不正式归档；PDF/笔记不自动产生；来源计数不代表全领域；保存上限与未保存状态。运行 `git diff --check`，按提交纪律提交 `feat: deliver verified broad discovery workflow`。依 verification-before-completion 提供新功能测试数量、受控浏览器结果、本机只读验收结果与明确限制，不把计划完成算成功能完成。

## 自审覆盖索引与执行状态

| 设计要求 | 任务 |
| --- | --- |
| 全部/推荐同一结果、无新增主导航 | 8、11 |
| 中文转换、条件ID/同义词/同轴OR、原式和6查询 | 4 |
| OpenAlex25条/两并发/多来源计数/旧响应隔离 | 5、7 |
| 本地主题与同篇对照、PDF/笔记/unknown | 6、11 |
| BibTeX/RIS/手动题录、外跳待导入、来源与范围 | 1、3、4、11 |
| 合并冲突/晚到冲突/拆分证据/候选不丢失 | 2、9、11 |
| JCR年份/学科/JIF、中文名单、条件与代表性 | 8、11 |
| 外部候选与旧100条/OpenAlex归档安全界线 | 5、9、11 |
| 第七owner、UTF-8容量、备份v3、v1/v2保留 | 9、10 |
| 公开URL/恶意导入/无认证与正文上传 | 1、3、5、9、12 |
| 构建闭包、公开包隐私、固定响应与本机只读 | 12 |

本文件为实施计划，不表示上述任务已完成。实现按任务依赖顺序推进；独立纯模块可由干净上下文子代理并行处理，但共用 `discovery.mjs`、备份和资源清单的改动由主代理串行整合。每项验收、设计符合性与代码质量复核通过后再勾选步骤。未通过的任务保留未完成状态，不用跳过测试、虚构题录或扩大权限补齐。
