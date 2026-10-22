import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { makeElement, memoryStorage } from "./discovery-test-fixtures.mjs"
import { createDiscoveryWorkspaceStore } from "./discovery-workspace.mjs"
import {
  buildKeywordSearchExpression,
  createDiscoveryController,
  createKeywordDiscoveryController,
  loadInstitutionProfile,
} from "./discovery.mjs"

const template = await readFile(new URL("./discovery.template.html", import.meta.url), "utf8")
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8")
const absoluteUsersPath = (...parts) => ["", "Users", ...parts].join("/")

const institution = Object.freeze({
  version: 1,
  institution_id: "nuist",
  display_name: "南京信息工程大学",
  access_mode: "carsi",
  library_home: "https://lib.nuist.edu.cn/",
  fallback_page: "https://lib.nuist.edu.cn/zy1/wwsjk.htm",
  providers: [{
    provider_id: "ieee",
    display_name: "IEEE Xplore",
    hosts: ["ieeexplore.ieee.org"],
    doi_prefixes: ["10.1109"],
    library_page: "https://lib.nuist.edu.cn/info/1015/1430.htm",
    carsi_entry_url: "https://ieeexplore.ieee.org/servlet/wayf.jsp",
    carsi_supported: true,
  }],
})

test("中文研究意图生成可编辑的英文检索式，并拒绝无法可靠翻译的词", () => {
  assert.equal(buildKeywordSearchExpression("在线优化"), '("online optimization")')
  assert.equal(typeof buildKeywordSearchExpression, "function")
  assert.equal(
    buildKeywordSearchExpression("时变有向网络中的低通信分布式约束优化"),
    '("time-varying directed graph" AND "distributed constrained optimization" AND "communication-efficient")',
  )
  assert.equal(buildKeywordSearchExpression("事件触发与耦合约束"), '("event-triggered" AND "coupled constraints")')
  assert.equal(
    buildKeywordSearchExpression("分布式优化 有向网络 时变拓扑 非平衡网络 耦合约束 低通信"),
    '("distributed optimization" AND "directed network" AND "time-varying topology" AND "unbalanced network" AND "coupled constraints" AND "communication-efficient")',
  )
  assert.equal(
    buildKeywordSearchExpression("时变有向网络 低通信 耦合约束 收敛性"),
    '("time-varying directed graph" AND "coupled constraints" AND "communication-efficient" AND "convergence")',
  )
  assert.equal(buildKeywordSearchExpression("privacy-preserving distributed optimization"), "privacy-preserving distributed optimization")
  assert.throws(() => buildKeywordSearchExpression("量子通信"), /不能可靠转换全部中文关键词/u)
})

test("论文发现页面是中文桌面工作台，并包含可访问的双模式与候选归档边界", () => {
  assert.match(template, /lang="zh-CN"/u)
  assert.match(template, /class="app-window"/u)
  assert.match(template, /id="discovery-mode-tabs"[^>]*role="tablist"/u)
  assert.match(template, /data-discovery-mode="keyword"[^>]*aria-selected="true"/u)
  assert.match(template, /data-discovery-mode="access"[^>]*aria-selected="false"/u)
  assert.match(template, /id="keyword-discovery-panel"[^>]*role="tabpanel"/u)
  assert.match(template, /id="known-paper-panel"[^>]*role="tabpanel"[^>]*hidden/u)
  assert.match(template, /id="english-query"/u)
  assert.match(template, /id="keyword-sort"/u)
  assert.ok(template.includes('<option value="relevance">相关性</option><option value="citations">引用次数</option><option value="newest">发表时间</option>'))
  assert.match(template, /元数据待核验/u)
  assert.match(template, /不代表已有 PDF 或阅读笔记/u)
  assert.doesNotMatch(template, /<iframe|<embed|<object/u)
})

test("论文发现页保留完整研究流程导航并使用稳定的论文库图标", () => {
  assert.match(
    template,
    /<a class="nav-item" href="\.\.\/\.\.\/prototype\/desktop\/index\.html#thesis"><span aria-hidden="true">◇<\/span><span>学位论文<\/span><\/a>/u,
  )
  const libraryAction = template.match(
    /<a class="icon-button" href="\.\/library\.html" aria-label="打开论文库">([\s\S]*?)<\/a>/u,
  )?.[1]
  assert.ok(libraryAction)
  assert.match(libraryAction, /<svg[^>]*class="window-action-icon"[^>]*aria-hidden="true"[\s\S]*?<\/svg>/u)
  assert.equal(libraryAction.replace(/<svg[\s\S]*?<\/svg>/u, "").trim(), "")
  assert.match(
    styles,
    /\.window-actions \.icon-button,\s*\.window-actions \.avatar-button\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/u,
  )
  assert.match(styles, /\.window-action-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/u)
})

test("所有发现页外部目的地是可见 HTTPS 普通链接且没有登录嵌入", () => {
  const anchors = [...template.matchAll(/<a\b[^>]*>/gu)].map(([tag]) => tag)
  const external = anchors.filter((tag) => /href="https:\/\//u.test(tag))
  assert.ok(external.length >= 2)
  for (const anchor of external) {
    assert.match(anchor, /target="_blank"/u)
    assert.match(anchor, /rel="noopener noreferrer"/u)
  }
  assert.doesNotMatch(template, /document\.cookie|<form[^>]+action="https:/iu)
})

function candidateStore() {
  let candidates = []
  const state = () => ({ version: 1, candidates: structuredClone(candidates) })
  return {
    read: state, reload: () => ({ status: "ready", state: state() }), getLoadStatus: () => "ready",
    add(work) { candidates.push({ ...work, stage: "pending_screening" }); return { added: true, persisted: true, state: state() } },
    confirm(paperId) { candidates = candidates.map((item) => item.paperId === paperId ? { ...item, stage: "confirmed_for_archive" } : item); return { changed: true, persisted: true, state: state() } },
    moveToPending(paperId) { candidates = candidates.map((item) => item.paperId === paperId ? { ...item, stage: "pending_screening" } : item); return { changed: true, persisted: true, state: state() } },
    remove(paperId) { candidates = candidates.filter((item) => item.paperId !== paperId); return { changed: true, persisted: true, state: state() } },
  }
}

function task11Candidate(overrides = {}) {
  return {
    paperId: "W4387886124",
    doi: "10.1109/access.2023.3327199",
    title: "Distributed online optimization over directed networks",
    authors: ["Yinghui Wang", "Jiuwei Wang"],
    year: 2023,
    source: "IEEE Access",
    citations: 12,
    isOpenAccess: true,
    openAccessUrl: "https://example.org/open-paper",
    landingPageUrl: "https://openalex.org/W4387886124",
    topics: ["Distributed optimization"],
    abstract: "Discovery text",
    stage: "confirmed_for_archive",
    ...overrides,
  }
}

function task11CandidateStore(candidates = [task11Candidate()], transition = null) {
  let state = { version: 1, candidates: structuredClone(candidates) }
  const marked = []
  return {
    marked,
    read: () => structuredClone(state),
    reload: () => ({ status: "ready", state: structuredClone(state) }),
    getLoadStatus: () => "ready",
    confirm() { throw new Error("unexpected confirm") },
    moveToPending(paperId) {
      state = {
        version: 1,
        candidates: state.candidates.map((candidate) => (
          candidate.paperId === paperId ? { ...candidate, stage: "pending_screening" } : candidate
        )),
      }
      return { changed: true, persisted: true, reason: null, state: structuredClone(state) }
    },
    remove() { throw new Error("unexpected remove") },
    markMetadataArchived(openAlexId) {
      marked.push(openAlexId)
      if (transition) return transition(openAlexId, structuredClone(state))
      state = {
        version: 1,
        candidates: state.candidates.map((candidate) => (
          candidate.paperId === openAlexId ? { ...candidate, stage: "metadata_archived" } : candidate
        )),
      }
      return { changed: true, persisted: true, reason: null, state: structuredClone(state) }
    },
  }
}

const task11Categories = Object.freeze([
  ["note", "论文精读", "note"],
  ["derivation", "推导过程", "derivation"],
  ["source_map", "来源映射", "derivation"],
  ["modeling", "建模复盘", "simulation"],
  ["simulation", "仿真描述", "simulation"],
  ["code_compare", "代码对照", "code_compare"],
  ["reproduction_report", "复现报告", "simulation"],
].map(([value, label, target_tab]) => ({ value, label, target_tab })))

function task11Capabilities(overrides = {}) {
  return {
    api_version: 1,
    note_import: true,
    source_path: true,
    candidate_archive: true,
    archive_rebuild: true,
    discovery: true,
    agent_task_center: true,
    archive_source_id: "main_papers",
    categories: structuredClone(task11Categories),
    recovery: {
      required: false,
      kind: null,
      reason_code: null,
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
    ...overrides,
  }
}

function task11Response(payload, { ok = true, status = ok ? 200 : 400 } = {}) {
  return { ok, status, json: async () => structuredClone(payload) }
}

function findDescendant(root, predicate) {
  if (!root) return null
  if (predicate(root)) return root
  for (const child of root.children ?? []) {
    const match = findDescendant(child, predicate)
    if (match) return match
  }
  return null
}

function findCandidateControl(root, key, value) {
  return findDescendant(root.elements.get("#candidate-queue-list"), (element) => element.dataset?.[key] === value)
}

function keywordRoot() {
  const keywordTab = makeElement({ dataset: { discoveryMode: "keyword" }, attributes: { "aria-selected": "true" } })
  const accessTab = makeElement({ dataset: { discoveryMode: "access" }, attributes: { "aria-selected": "false", tabindex: "-1" } })
  const elements = new Map([
    ["#keyword-search-form", makeElement({ tagName: "form" })], ["#keyword-query", makeElement()], ["#english-query", makeElement()],
    ["#keyword-sort", makeElement()], ["#keyword-live-search", makeElement({ tagName: "button" })], ["#keyword-search-status", makeElement()],
    ["#keyword-start-year", makeElement()], ["#keyword-end-year", makeElement()], ["#keyword-language", makeElement()],
    ["#generate-english-query", makeElement({ tagName: "button" })], ["#keyword-load-more", makeElement({ tagName: "button" })],
    ["#local-match-status", makeElement()], ["#refresh-local-matches", makeElement({ tagName: "button" })], ["#actual-search-query", makeElement()],
    ["#keyword-search-results", makeElement()], ["#keyword-live-results-list", makeElement()], ["[data-live-result-count]", makeElement()],
    ["#keyword-discovery-panel", makeElement()], ["#known-paper-panel", makeElement()], ["#candidate-queue-panel", makeElement()],
    ["#access-guide-panel", makeElement()], ["#candidate-queue-status", makeElement()], ["#candidate-queue-list", makeElement()],
    ["[data-candidate-count]", makeElement()], ["[data-candidate-pending-count]", makeElement()], ["[data-candidate-confirmed-count]", makeElement()], ["[data-candidate-empty]", makeElement()],
    ["#institution-access-form", makeElement({ tagName: "form" })], ["#access-locator", makeElement()], ["#access-provider", makeElement()], ["#access-status", makeElement()], ["#access-result", makeElement()],
    ["[data-provider-name]", makeElement()], ["#institution-step-open", makeElement({ tagName: "a" })], ["#institution-step-auth", makeElement({ tagName: "a" })], ["#institution-step-library", makeElement({ tagName: "a" })],
    ["#access-copy-target", makeElement()], ["#access-copy", makeElement({ tagName: "button" })], ["#access-copy-status", makeElement()], ["#access-warnings", makeElement({ tagName: "ul" })],
  ])
  for (const name of ["discovery-import-file", "discovery-import-preview", "discovery-query-plan", "discovery-review-panel", "discovery-source-status", "discovery-status", "discovery-history"]) elements.set(`#${name}`, makeElement())
  const viewTabs = ["all", "curated"].map(view => makeElement({ dataset: { discoveryView: view } }))
  for (const tab of viewTabs) elements.set(`[data-discovery-view="${tab.dataset.discoveryView}"]`, tab)
  elements.get("#known-paper-panel").hidden = true
  elements.get("#access-guide-panel").hidden = true
  elements.get("#access-result").hidden = true
  elements.get("#keyword-query").value = "时变有向网络中的低通信分布式约束优化"
  elements.get("#keyword-sort").value = "relevance"
  elements.get("#keyword-language").value = "all"
  return {
    querySelector(selector) { return elements.get(selector) ?? null },
    querySelectorAll(selector) { return selector === "[data-discovery-mode]" ? [keywordTab, accessTab] : selector === "[data-discovery-view]" ? viewTabs : [] },
    createElement(tagName) { return makeElement({ tagName }) }, elements, keywordTab, accessTab,
  }
}

test('all view is default and switching to curated does not query again', async () => {
  const root = keywordRoot(); let calls = 0
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    workspaceStore: createDiscoveryWorkspaceStore(memoryStorage()), fetchImpl: async () => ({ ok: false }), loadIndex: async () => ({ papers: [] }),
    searchWorks: async () => { calls++; return { total: 1, works: [task11Candidate()], nextCursor: null } } })
  await controller.start(); await root.elements.get('#keyword-live-search').dispatch('click')
  assert.equal(controller.getDiscoverySnapshot().view, 'all')
  await root.elements.get('[data-discovery-view="curated"]').dispatch('click')
  assert.equal(calls, 1); assert.equal(controller.getDiscoverySnapshot().view, 'curated')
})

test("显式范围传入检索，加载更多沿用同一范围且合并重复结果", async () => {
  const root = keywordRoot()
  const calls = []
  const first = task11Candidate()
  const second = task11Candidate({ paperId: "W200", title: "Second paper" })
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }), loadIndex: async () => ({ papers: [] }),
    searchWorks: async (args) => { calls.push(args); return calls.length === 1
      ? { total: 30, works: [first], nextCursor: "cursor-2" }
      : { total: 30, works: [first, second], nextCursor: null } },
  })
  await controller.start()
  root.elements.get("#keyword-query").value = "distributed optimization"
  root.elements.get("#keyword-start-year").value = "2000"
  root.elements.get("#keyword-end-year").value = "2025"
  await root.elements.get("#keyword-search-form").dispatch("submit")
  assert.deepEqual(calls[0], { query: "distributed optimization", sort: "relevance", startYear: 2000, endYear: 2025, language: "all", cursor: "*", perPage: 25 })
  assert.equal(root.elements.get("#keyword-load-more").hidden, false)
  await root.elements.get("#keyword-load-more").dispatch("click")
  assert.equal(calls[1].cursor, "cursor-2")
  assert.equal(calls[1].startYear, 2000)
  assert.deepEqual(controller.getWorks().map((work) => work.paperId), [first.paperId, "W200"])
  assert.match(root.elements.get("#discovery-source-status").textContent, /来源匹配 30/u)
  assert.equal(root.elements.get("#keyword-load-more").hidden, true)
})

test("索引失败时结果本地状态未知，重试后根据PDF状态标记并提供本地阅读入口", async () => {
  const root = keywordRoot()
  let fail = true
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }),
    loadIndex: async () => { if (fail) throw new Error("offline"); return { papers: [{ paper_id: "Local-01", doi_or_url: "https://doi.org/10.1109/access.2023.3327199", title_original: "Local paper", source_documents: { pdf: [{ url: `../../local_library_data/sources/local-01/pdf/${"a".repeat(64)}.pdf` }] } }] } },
    searchWorks: async () => ({ total: 1, works: [task11Candidate()], nextCursor: null }),
  })
  await controller.start()
  await root.elements.get("#keyword-live-search").dispatch("click")
  let card = findDescendant(root.elements.get("#keyword-live-results-list"), element => Boolean(element.dataset?.resultId))
  assert.equal(card.dataset.localStatus, "unknown")
  assert.match(card.textContent, /状态未知/u)
  assert.doesNotMatch(card.textContent, /本地未匹配/u)
  fail = false
  await root.elements.get("#refresh-local-matches").dispatch("click")
  card = findDescendant(root.elements.get("#keyword-live-results-list"), element => Boolean(element.dataset?.resultId))
  assert.equal(card.dataset.localStatus, "existing_pdf")
  assert.match(card.textContent, /本地已有 PDF/u)
  const localLink = findDescendant(card, (element) => element.tagName === "A" && element.href.includes("paper_id=Local-01"))
  assert.ok(localLink)
})

test("同 DOI 的明显题名冲突保留核对提示，不因已索引 PDF 或笔记而锁定同篇", async () => {
  const root = keywordRoot()
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }),
    loadIndex: async () => ({ papers: [{ paper_id: 'Local-01', doi_or_url: task11Candidate().doi,
      title_original: 'Seasonal migration patterns of tropical birds', artifact_availability: { note: true },
      source_documents: { pdf: [{ url: './synthetic-paper.pdf' }] } }] }),
    searchWorks: async () => ({ total: 1, works: [task11Candidate()], nextCursor: null }),
  })
  await controller.start()
  await root.elements.get('#keyword-live-search').dispatch('click')
  const card = findDescendant(root.elements.get('#keyword-live-results-list'), element => Boolean(element.dataset?.resultId))
  assert.equal(card.dataset.localStatus, 'possible_match')
  assert.match(card.textContent, /题名.*冲突/u)
  assert.doesNotMatch(card.textContent, /无需重复下载|本地已收录/u)
  assert.equal(findDescendant(card, element => Boolean(element.dataset?.selectResult)).disabled, false)
})

test("更换范围让旧翻页结果失效，非法年份不发出搜索", async () => {
  const root = keywordRoot()
  let finish
  let calls = 0
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }), loadIndex: async () => ({ papers: [] }),
    searchWorks: async () => { calls += 1; if (calls === 1) return { total: 2, works: [task11Candidate()], nextCursor: "more" }; return new Promise((resolve) => { finish = resolve }) },
  })
  await controller.start()
  await root.elements.get("#keyword-live-search").dispatch("click")
  const paging = root.elements.get("#keyword-load-more").dispatch("click")
  root.elements.get("#keyword-start-year").value = "2026"
  root.elements.get("#keyword-start-year").dispatch("input")
  finish({ total: 2, works: [task11Candidate({ paperId: "W200" })], nextCursor: null })
  await paging
  assert.equal(controller.getWorks().length, 0)
  root.elements.get("#keyword-end-year").value = "2020"
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls, 2)
  assert.match(root.elements.get("#keyword-search-status").textContent, /年份/u)
})

test("年份输入尚未完成时不能按不限范围发出检索", async () => {
  const root = keywordRoot()
  let calls = 0
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }), loadIndex: async () => ({ papers: [] }),
    searchWorks: async () => { calls += 1; return { total: 0, works: [], nextCursor: null } },
  })
  await controller.start()
  root.elements.get("#keyword-start-year").validity = { badInput: true }
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls, 0)
  assert.match(root.elements.get("#keyword-search-status").textContent, /年份/u)
})

test("翻页失败保留已有结果与游标，重试后继续同一范围", async () => {
  const root = keywordRoot()
  const calls = []
  const first = task11Candidate()
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }), loadIndex: async () => ({ papers: [] }),
    searchWorks: async (args) => {
      calls.push(args)
      if (calls.length === 2) throw new Error("暂时限流")
      return calls.length === 1 ? { total: 2, works: [first], nextCursor: "cursor-2" }
        : { total: 2, works: [task11Candidate({ paperId: "W200" })], nextCursor: null }
    },
  })
  await controller.start()
  await root.elements.get("#keyword-live-search").dispatch("click")
  await root.elements.get("#keyword-load-more").dispatch("click")
  assert.deepEqual(controller.getWorks(), [Object.fromEntries(Object.entries(first).filter(([key]) => key !== "stage"))])
  assert.match(root.elements.get("#keyword-search-status").textContent, /已有结果已保留/u)
  assert.equal(root.elements.get("#keyword-load-more").disabled, false)
  await root.elements.get("#keyword-load-more").dispatch("click")
  assert.deepEqual(calls[2], calls[1])
  assert.equal(controller.getWorks().length, 2)
})

test("关键词控制器切换模式、搜索真实结果，并将结果放入待筛选队列", async () => {
  const root = keywordRoot()
  const calls = []
  const controller = createKeywordDiscoveryController({
    root, candidateStore: candidateStore(), prepareAccess() {},
    searchWorks: async (options) => {
      calls.push(options)
      return { total: 1, costUsd: 0, works: [{ paperId: "W100", doi: null, title: "安全标题", authors: [], year: 2025, source: "Journal", citations: 2, isOpenAccess: false, openAccessUrl: null, landingPageUrl: "https://openalex.org/W100", topics: [], abstract: null }] }
    },
  })
  controller.start()
  root.accessTab.dispatch("click")
  assert.equal(root.elements.get("#keyword-discovery-panel").hidden, true)
  assert.equal(root.elements.get("#known-paper-panel").hidden, false)
  assert.equal(root.accessTab.getAttribute("tabindex"), "0")
  root.keywordTab.dispatch("click")
  root.elements.get("#generate-english-query").dispatch("click")
  assert.match(root.elements.get("#english-query").value, /communication-efficient/u)
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls[0].sort, "relevance")
  assert.equal(root.elements.get("[data-live-result-count]").textContent, "1 篇唯一已加载结果")
  assert.equal(findDescendant(root.elements.get("#keyword-live-results-list"), element => Boolean(element.dataset?.resultId)).children[0].textContent, "安全标题")
})

test("关键词控制器把三种可见排序映射为 OpenAlex 检索契约", async () => {
  const root = keywordRoot()
  const calls = []
  const controller = createKeywordDiscoveryController({
    root, candidateStore: candidateStore(), prepareAccess() {},
    searchWorks: async (options) => { calls.push(options); return { total: 0, costUsd: 0, works: [] } },
  })
  controller.start()
  root.elements.get("#english-query").value = "directed optimization"
  for (const [visibleValue, expectedSort] of [["relevance", "relevance"], ["citations", "citations"], ["newest", "newest"]]) {
    root.elements.get("#keyword-sort").value = visibleValue
    await root.elements.get("#keyword-live-search").dispatch("click")
    assert.equal(calls.at(-1).sort, expectedSort)
  }
})

test("方向词可直接点击搜索，并在本地与网上检索之间保留当前意图", async () => {
  const root = keywordRoot()
  const localLink = makeElement({ tagName: "a" })
  root.elements.set("#search-local-library", localLink)
  const calls = []
  const controller = createKeywordDiscoveryController({
    root, initialQuery: "事件触发 耦合约束", candidateStore: candidateStore(),
    fetchImpl: async () => ({ ok: false }),
    searchWorks: async (options) => { calls.push(options); return { total: 0, works: [] } },
  })
  await controller.start()
  assert.equal(new URL(localLink.href, "https://example.org/").searchParams.get("q"), "事件触发 耦合约束")
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls[0]?.query, "事件触发 耦合约束")
  assert.match(root.elements.get("#keyword-search-status").textContent, /减少关键词|缩短检索/u)
  root.elements.get("#keyword-query").value = "联邦学习"
  root.elements.get("#keyword-query").dispatch("input")
  assert.equal(new URL(localLink.href, "https://example.org/").searchParams.get("q"), "联邦学习")
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls.at(-1).query, "联邦学习")
})

test("更换检索意图后不显示旧结果，失败可重试且保留手工英文检索式", async () => {
  const root = keywordRoot()
  let failure = false
  const calls = []
  const controller = createKeywordDiscoveryController({
    root, candidateStore: candidateStore(), fetchImpl: async () => ({ ok: false }),
    searchWorks: async ({ query }) => {
      calls.push(query)
      if (failure) throw new Error("网络连接失败")
      return { total: 1, works: [task11Candidate()] }
    },
  })
  await controller.start()
  root.elements.get("#english-query").value = "manual English query"
  root.elements.get("#english-query").dispatch("input")
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls.at(-1), "manual English query")
  assert.equal(controller.getWorks().length, 1)
  root.elements.get("#keyword-query").value = "联邦学习"
  root.elements.get("#keyword-query").dispatch("input")
  assert.equal(controller.getWorks().length, 0)
  assert.equal(root.elements.get("#keyword-live-results-list").children.length, 0)
  failure = true
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(root.elements.get("#keyword-live-search").disabled, false)
  assert.match(root.elements.get("#keyword-search-status").textContent, /网络连接失败/u)
  assert.match(root.elements.get("#keyword-search-status").textContent, /重试/u)
})

test("检索中修改关键词后，旧请求的迟到结果不能覆盖新意图", async () => {
  const root = keywordRoot()
  let resolveSearch
  const controller = createKeywordDiscoveryController({
    root, candidateStore: candidateStore(), fetchImpl: async () => ({ ok: false }),
    searchWorks: () => new Promise((resolve) => { resolveSearch = resolve }),
  })
  await controller.start()
  const operation = root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(root.elements.get("#keyword-live-search").disabled, true)
  assert.match(root.elements.get("#keyword-search-status").textContent, /正在检索/u)
  root.elements.get("#keyword-query").value = "联邦学习"
  root.elements.get("#keyword-query").dispatch("input")
  resolveSearch({ total: 1, works: [task11Candidate()] })
  await operation
  assert.equal(controller.getWorks().length, 0)
  assert.match(root.elements.get("#keyword-search-status").textContent, /关键词已更新/u)
  assert.equal(root.elements.get("#keyword-live-search").disabled, false)
})

test("模式 Tab 以箭头、Home 和 End 键移动焦点并激活对应面板", () => {
  const root = keywordRoot()
  const controller = createKeywordDiscoveryController({ root, candidateStore: candidateStore(), prepareAccess() {}, searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }) })
  controller.start()

  root.keywordTab.dispatch("keydown", { key: "ArrowRight" })
  assert.equal(root.accessTab.focusCount, 1)
  assert.equal(root.accessTab.getAttribute("aria-selected"), "true")
  assert.equal(root.elements.get("#known-paper-panel").hidden, false)

  root.accessTab.dispatch("keydown", { key: "ArrowLeft" })
  assert.equal(root.keywordTab.focusCount, 1)
  assert.equal(root.keywordTab.getAttribute("aria-selected"), "true")
  assert.equal(root.elements.get("#keyword-discovery-panel").hidden, false)

  root.keywordTab.dispatch("keydown", { key: "End" })
  assert.equal(root.accessTab.focusCount, 2)
  assert.equal(root.accessTab.getAttribute("aria-selected"), "true")

  root.accessTab.dispatch("keydown", { key: "Home" })
  assert.equal(root.keywordTab.focusCount, 2)
  assert.equal(root.keywordTab.getAttribute("aria-selected"), "true")
})

test("机构配置只从固定同源资源读取，并由发现控制器显式处理缺失配置", async () => {
  const calls = []
  const profile = await loadInstitutionProfile(async (...args) => { calls.push(args); return { ok: true, json: async () => institution } })
  assert.equal(profile.institution_id, "nuist")
  assert.deepEqual(calls, [["./assets/nuist.institution.json", { credentials: "same-origin", cache: "no-store" }]])

  const root = { querySelector() { return null }, querySelectorAll() { return [] }, createElement(tagName) { return makeElement({ tagName }) } }
  const controller = createDiscoveryController({ root, loadInstitution: async () => { throw new Error("missing") }, clipboard: undefined })
  await assert.doesNotReject(controller.start())
})

test("论文发现页从 q 深链预填研究意图，但不会自动发起外部检索", async () => {
  const root = keywordRoot()
  let searchCalls = 0
  const controller = createDiscoveryController({
    root,
    location: { search: "?q=%E4%BA%8B%E4%BB%B6%E8%A7%A6%E5%8F%91%20%E8%80%A6%E5%90%88%E7%BA%A6%E6%9D%9F" },
    loadInstitution: async () => institution,
    storage: undefined,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    searchWorks: async () => { searchCalls += 1; return { total: 0, costUsd: 0, works: [] } },
  })

  await controller.start()
  assert.equal(root.elements.get("#keyword-query").value, "事件触发 耦合约束")
  assert.equal(root.elements.get("#english-query").value, "")
  assert.equal(searchCalls, 0)
})

test("方向入口保持 OR 并暂停自动搜索，参数污染或过长输入显示错误", async () => {
  for (const axes of [JSON.stringify({ version: 1, axes: { problem: ['分布式优化', '在线优化'] } }), '{"version":1,"axes":{"__proto__":[]}}']) {
    const root = keywordRoot()
    const calls = []
    const controller = createDiscoveryController({ root, location: { search: '?' + new URLSearchParams({ q: '分布式优化 在线优化', search: '1', axes }) },
      loadInstitution: async () => institution, storage: undefined,
      fetchImpl: async (url) => { calls.push(String(url)); return { ok: false, status: 404, json: async () => ({}) } },
    })
    await controller.start()
    assert.equal(calls.some(url => url.includes('api.openalex.org')), false)
    if (axes.includes('__proto__')) assert.match(root.elements.get('#keyword-search-status').textContent, /方向参数无效/)
    else {
      assert.equal(root.elements.get('#english-query').value, '(("distributed optimization" OR "online optimization"))')
      assert.match(root.elements.get('#keyword-search-status').textContent, /确认/)
      assert.match(root.elements.get('#keyword-search-status').textContent, /分布式优化或在线优化/)
      root.elements.get('#keyword-query').value = 'manual NOT revised'
      await root.elements.get('#keyword-query').dispatch('input')
      assert.equal(root.elements.get('#english-query').value, '')
    }
  }
  const root = keywordRoot()
  const controller = createKeywordDiscoveryController({ root, initialQuery: 'x'.repeat(1001), autoSearch: true, candidateStore: candidateStore(),
    searchWorks: async () => { throw new Error('must not run') }, loadIndex: async () => ({ papers: [] }),
  })
  await controller.start()
  assert.equal(root.elements.get('#keyword-query').value.length, 1001)
  assert.match(root.elements.get('#keyword-search-status').textContent, /缩短/)
})

test("已知论文访问显示平台冲突警告，并只给出普通的新窗口 HTTPS 链接", async () => {
  const root = keywordRoot()
  const profile = structuredClone(institution)
  profile.providers.push({
    provider_id: "elsevier", display_name: "ScienceDirect", hosts: ["sciencedirect.com"], doi_prefixes: ["10.1016"],
    library_page: "https://lib.nuist.edu.cn/zy1/wwsjk/1.htm", carsi_entry_url: null, carsi_supported: false,
  })
  const controller = createDiscoveryController({ root, loadInstitution: async () => profile, clipboard: undefined })
  await controller.start()
  root.elements.get("#access-locator").value = "https://ieeexplore.ieee.org/document/1"
  root.elements.get("#access-provider").value = "elsevier"
  root.elements.get("#institution-access-form").dispatch("submit")
  assert.equal(root.elements.get("#access-result").hidden, false)
  assert.match(root.elements.get("#access-warnings").children[0].textContent, /不一致/u)
  const articleLink = root.elements.get("#institution-step-open")
  assert.match(articleLink.href, /^https:\/\//u)
  assert.equal(articleLink.getAttribute("target"), null, "链接属性在模板中固定为新窗口语义")
})

test("Task 11 RED2 confirmed card requires an explicit valid local ID and archives only after fresh-index identity reconciliation", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore()
  const fetchCalls = []
  const confirmations = []
  let indexLoads = 0
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push([url, options])
      if (url === "/api/v1/capabilities") return task11Response(task11Capabilities())
      if (url === "/api/v1/archive/candidates") {
        return task11Response({
          status: "created",
          paper_id: "Wang23-DIO",
          folder_name: "Wang23-DIO",
          rebuild_status: "complete",
          paper_count: 1,
        }, { status: 201 })
      }
      throw new Error(`unexpected ${url}`)
    },
    loadIndex: async () => {
      indexLoads += 1
      return { papers: [{ paper_id: "Wang23-DIO", doi_or_url: "https://doi.org/10.1109/ACCESS.2023.3327199" }] }
    },
    confirmArchive(message) { confirmations.push(message); return true },
  })
  await controller.start()

  const input = findCandidateControl(root, "archivePaperId", "W4387886124")
  const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  const help = findCandidateControl(root, "archivePaperIdHelp", "W4387886124")
  assert.ok(input)
  assert.equal(input.value, "", "local ID must never be inferred or prefilled")
  assert.match(findDescendant(root.elements.get("#candidate-queue-list"), (node) => node.tagName === "LABEL")?.textContent ?? "", /本地论文 ID/u)
  assert.match(help.textContent, /Wang23-DIO|LIB-[A-F0-9]/u)
  assert.equal(archive.disabled, true)

  input.value = "W4387886124"
  input.dispatch("input")
  assert.equal(archive.disabled, true, "OpenAlex W id is not a valid local paper id")
  input.value = "Wang23-DIO"
  input.dispatch("input")
  assert.equal(archive.disabled, false)
  await archive.dispatch("click")

  assert.equal(indexLoads, 2, "the public index is loaded at startup and freshly reloaded after the 201 response")
  assert.deepEqual(store.marked, ["W4387886124"])
  assert.equal(confirmations.length, 1)
  assert.match(confirmations[0], /Wang23-DIO/u)
  assert.match(confirmations[0], /main_papers/u)
  assert.match(confirmations[0], /仅归档书目信息，不含 PDF\/OCR\/证据核验/u)
  const currentCard = findDescendant(root.elements.get("#candidate-queue-list"), (node) => node.dataset?.queuePaper === "W4387886124")
  assert.match(currentCard.textContent, /元数据已归档/u)
  assert.doesNotMatch(currentCard.textContent, /待归档|移回待筛选/u)
  assert.equal(findDescendant(currentCard, (node) => node.dataset?.archiveCandidate === "W4387886124"), null)
  assert.deepEqual(Object.keys(store.read().candidates[0]).sort(), [
    "abstract", "authors", "citations", "doi", "isOpenAccess", "landingPageUrl", "openAccessUrl",
    "paperId", "source", "stage", "title", "topics", "year",
  ])
  assert.deepEqual(fetchCalls.map(([url]) => url), ["/api/v1/capabilities", "/api/v1/archive/candidates"])
})

test("Task 11 RED2 a 409 keeps the typed local ID and confirmed candidate without raw response leakage", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore()
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return task11Response(task11Capabilities())
      return task11Response({
        error: {
          code: "LIBRARY_WRITE_BUSY",
          message: `${absoluteUsersPath("alice", "private")} archive is busy`,
          source_path: absoluteUsersPath("alice", "private"),
        },
      }, { ok: false, status: 409 })
    },
    loadIndex: async () => { throw new Error("busy response must not load the index") },
    confirmArchive: () => true,
  })
  await controller.start()
  const input = findCandidateControl(root, "archivePaperId", "W4387886124")
  const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  const oldStatus = findCandidateControl(root, "archiveStatus", "W4387886124")
  input.value = "Wang23-DIO"
  input.dispatch("input")
  await archive.dispatch("click")
  const currentInput = findCandidateControl(root, "archivePaperId", "W4387886124")
  const currentStatus = findCandidateControl(root, "archiveStatus", "W4387886124")
  assert.notEqual(currentStatus, oldStatus, "assert the rerendered current tree, not a detached status node")
  assert.equal(currentInput.value, "Wang23-DIO")
  assert.equal(store.read().candidates[0].stage, "confirmed_for_archive")
  assert.deepEqual(store.marked, [])
  assert.match(currentStatus.textContent, /正在执行|稍后|冲突/u)
  assert.doesNotMatch(root.elements.get("#candidate-queue-panel").textContent, /Users|alice|private|source_path/iu)
})

test("Task 11 RED4 archive rechecks the live confirmed candidate after asynchronous confirmation", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore()
  let resolveConfirmation
  let archivePosts = 0
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") return task11Response(task11Capabilities())
      if (url === "/api/v1/archive/candidates") {
        archivePosts += 1
        throw new Error("stale candidate must not be posted")
      }
      throw new Error(`unexpected ${url}`)
    },
    confirmArchive: () => new Promise((resolve) => { resolveConfirmation = resolve }),
  })
  await controller.start()
  const input = findCandidateControl(root, "archivePaperId", "W4387886124")
  const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  input.value = "Wang23-DIO"
  input.dispatch("input")
  const pendingArchive = archive.dispatch("click")
  await Promise.resolve()

  const busyCard = findDescendant(root.elements.get("#candidate-queue-list"), (node) => node.dataset?.queuePaper === "W4387886124")
  const busyInput = findDescendant(busyCard, (node) => node.dataset?.archivePaperId === "W4387886124")
  assert.equal(busyInput.disabled, true, "candidate operations are locked while confirmation is pending")
  store.moveToPending("W4387886124")
  resolveConfirmation(true)
  await pendingArchive

  assert.equal(archivePosts, 0)
  assert.equal(store.read().candidates[0].stage, "pending_screening")
  const currentCard = findDescendant(root.elements.get("#candidate-queue-list"), (node) => node.dataset?.queuePaper === "W4387886124")
  assert.match(currentCard.textContent, /待筛选/u)
  assert.equal(findDescendant(currentCard, (node) => node.dataset?.archiveCandidate === "W4387886124"), null)
})

test("Task 11 RED3 archive 500 refreshes capabilities into fixed manual recovery and disables writes", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore()
  let capabilityReads = 0
  const manualArchive = task11Capabilities({
    note_import: false,
    candidate_archive: false,
    archive_rebuild: false,
    archive_source_id: null,
    recovery: {
      required: true,
      kind: "manual_archive",
      reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
      archive_source_id: null,
      paper_id: null,
      openalex_id: null,
    },
  })
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") {
        capabilityReads += 1
        return task11Response(capabilityReads === 1 ? task11Capabilities() : manualArchive)
      }
      if (url === "/api/v1/archive/candidates") return task11Response({
        error: {
          code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
          message: `${absoluteUsersPath("alice", "private")} archive transaction is ambiguous`,
          source_path: absoluteUsersPath("alice", "private"),
          raw_body: "do not render",
        },
      }, { ok: false, status: 500 })
      throw new Error(`unexpected ${url}`)
    },
    confirmArchive: () => true,
  })
  await controller.start()
  const input = findCandidateControl(root, "archivePaperId", "W4387886124")
  const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  const oldStatus = findCandidateControl(root, "archiveStatus", "W4387886124")
  input.value = "Wang23-DIO"
  input.dispatch("input")
  await archive.dispatch("click")

  const panel = root.elements.get("#candidate-queue-panel")
  const banner = findDescendant(panel, (node) => node.dataset?.archiveRecoveryBanner === "")
  const rebuiltArchive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  assert.equal(capabilityReads, 2, "a write failure can change server recovery state")
  assert.equal(banner.hidden, false)
  assert.match(banner.textContent, /候选归档事务状态不明确/u)
  assert.equal(findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild"), null)
  assert.equal(rebuiltArchive.disabled, true)
  assert.equal(store.read().candidates[0].stage, "confirmed_for_archive")
  assert.doesNotMatch(panel.textContent + oldStatus.textContent, /Users|alice|private|source_path|raw_body|do not render/iu)
})

test("Task 11 RED4 discovery treats exact rebuild 200 as final when index or candidate reconciliation fails", async (t) => {
  const fixedNotice = "恢复已完成，但新索引或本地候选状态尚未核对。"
  const scenarios = [
    {
      name: "fresh index fails",
      loadIndex: async () => { throw new Error("invalid fresh index") },
      transition: null,
    },
    {
      name: "candidate persistence is rejected",
      loadIndex: async () => ({ papers: [{ paper_id: "Wang23-DIO", doi_or_url: "10.1109/access.2023.3327199" }] }),
      transition: () => ({ changed: false, persisted: false, reason: "persistence_failed" }),
    },
    {
      name: "candidate persistence throws",
      loadIndex: async () => ({ papers: [{ paper_id: "Wang23-DIO", doi_or_url: "10.1109/access.2023.3327199" }] }),
      transition: () => { throw new Error("local storage unavailable") },
    },
  ]

  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const root = keywordRoot()
    const store = task11CandidateStore([task11Candidate()], scenario.transition)
    let capabilityReads = 0
    let rebuildCalls = 0
    const recovery = task11Capabilities({
      note_import: false,
      candidate_archive: false,
      recovery: {
        required: true,
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: "W4387886124",
      },
    })
    const controller = createKeywordDiscoveryController({
      root,
      candidateStore: store,
      prepareAccess() {},
      searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
      fetchImpl: async (url) => {
        if (url === "/api/v1/capabilities") {
          capabilityReads += 1
          return task11Response(capabilityReads === 1 ? recovery : task11Capabilities())
        }
        if (url === "/api/v1/archive/rebuild") {
          rebuildCalls += 1
          return task11Response({
            status: "recovered",
            paper_id: "Wang23-DIO",
            rebuild_status: "complete",
            paper_count: 1,
          })
        }
        throw new Error(`unexpected ${url}`)
      },
      loadIndex: scenario.loadIndex,
      confirmArchive: () => false,
    })
    await controller.start()
    const panel = root.elements.get("#candidate-queue-panel")
    const banner = findDescendant(panel, (node) => node.dataset?.archiveRecoveryBanner === "")
    const oldRebuild = findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild")
    assert.ok(oldRebuild)
    await oldRebuild.dispatch("click")

    assert.equal(rebuildCalls, 1)
    assert.equal(capabilityReads, 2, "post-200 verification failure must still refresh capabilities")
    assert.equal(store.read().candidates[0].stage, "confirmed_for_archive")
    assert.equal(banner.hidden, false)
    assert.match(banner.textContent, new RegExp(fixedNotice, "u"))
    assert.doesNotMatch(banner.textContent, /恢复未完成|正在重建/u)
    assert.equal(findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild"), null)

    const input = findCandidateControl(root, "archivePaperId", "W4387886124")
    const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
    input.value = "Wang23-DIO"
    input.dispatch("input")
    assert.equal(archive.disabled, false, "normal capabilities must re-enable eligible writes")
    await oldRebuild.dispatch("click")
    assert.equal(rebuildCalls, 1, "the consumed recovery tuple must never be retried")
  })
})

test("Task 11 recovery keeps a neutral visible result when no browser candidate exists", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore([])
  let capabilityReads = 0
  let rebuildCalls = 0
  const recovery = task11Capabilities({
    note_import: false,
    candidate_archive: false,
    recovery: {
      required: true,
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
  })
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") {
        capabilityReads += 1
        return task11Response(capabilityReads === 1 ? recovery : task11Capabilities())
      }
      if (url === "/api/v1/archive/rebuild") {
        rebuildCalls += 1
        return task11Response({
          status: "recovered",
          paper_id: "Wang23-DIO",
          rebuild_status: "complete",
          paper_count: 1,
        })
      }
      throw new Error(`unexpected ${url}`)
    },
    loadIndex: async () => ({ papers: [] }),
    confirmArchive: () => false,
  })
  await controller.start()
  const panel = root.elements.get("#candidate-queue-panel")
  const banner = findDescendant(panel, (node) => node.dataset?.archiveRecoveryBanner === "")
  const rebuild = findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild")
  assert.ok(rebuild)
  await rebuild.dispatch("click")

  assert.equal(rebuildCalls, 1)
  assert.equal(capabilityReads, 2)
  assert.deepEqual(store.marked, [])
  assert.equal(banner.hidden, false)
  assert.match(banner.textContent, /未找到本地候选|未更改本地候选/u)
  assert.doesNotMatch(banner.textContent, /元数据归档完成/u)
  assert.equal(findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild"), null)
  await rebuild.dispatch("click")
  assert.equal(rebuildCalls, 1, "the consumed no-candidate tuple must not be retried")
})

test("Task 11 RED2 capability matrices show rebuild only for candidate recovery and fixed manual blocking banners", async () => {
  const states = [
    ["normal", task11Capabilities(), false, true, ""],
    ["no-source", task11Capabilities({ candidate_archive: false, archive_rebuild: false, archive_source_id: null }), false, false, ""],
    ["candidate", task11Capabilities({
      note_import: false,
      candidate_archive: false,
      recovery: {
        required: true,
        kind: "candidate_archive",
        reason_code: "ARCHIVE_REBUILD_FAILED",
        archive_source_id: "main_papers",
        paper_id: "Wang23-DIO",
        openalex_id: "W4387886124",
      },
    }), true, false, "论文库索引重建失败"],
    ["manual-note", task11Capabilities({
      note_import: false,
      candidate_archive: false,
      archive_rebuild: false,
      archive_source_id: null,
      recovery: {
        required: true,
        kind: "manual_note",
        reason_code: "ROLLBACK_FAILED",
        archive_source_id: null,
        paper_id: null,
        openalex_id: null,
      },
    }), false, false, "笔记导入需要人工恢复"],
    ["manual-archive", task11Capabilities({
      note_import: false,
      candidate_archive: false,
      archive_rebuild: false,
      archive_source_id: null,
      recovery: {
        required: true,
        kind: "manual_archive",
        reason_code: "ARCHIVE_TRANSACTION_AMBIGUOUS",
        archive_source_id: null,
        paper_id: null,
        openalex_id: null,
      },
    }), false, false, "候选归档事务状态不明确"],
  ]

  for (const [name, capabilities, hasRebuild, archiveEnabled, message] of states) {
    const root = keywordRoot()
    const controller = createKeywordDiscoveryController({
      root,
      candidateStore: task11CandidateStore(),
      prepareAccess() {},
      searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
      fetchImpl: async () => task11Response(capabilities),
      confirmArchive: () => false,
    })
    await controller.start()
    const panel = root.elements.get("#candidate-queue-panel")
    const banner = findDescendant(panel, (node) => node.dataset?.archiveRecoveryBanner === "")
    const rebuild = findDescendant(panel, (node) => node.dataset?.archiveRecoveryAction === "rebuild")
    const input = findCandidateControl(root, "archivePaperId", "W4387886124")
    const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
    input.value = "Wang23-DIO"
    input.dispatch("input")
    assert.equal(Boolean(rebuild), hasRebuild, name)
    assert.equal(archive.disabled, !archiveEnabled, name)
    if (message) assert.match(banner.textContent, new RegExp(message, "u"), name)
    if (name === "candidate") {
      assert.match(banner.textContent, /main_papers/u)
      assert.match(banner.textContent, /Wang23-DIO/u)
      assert.match(banner.textContent, /W4387886124/u)
    }
  }
})

test("Task 11 RED2 failed immediate rebuild refreshes recovery, and explicit recovery reloads the index before marking", async () => {
  const root = keywordRoot()
  const store = task11CandidateStore()
  let capabilityReads = 0
  let indexLoads = 0
  const normal = task11Capabilities()
  const recovery = task11Capabilities({
    note_import: false,
    candidate_archive: false,
    recovery: {
      required: true,
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: "main_papers",
      paper_id: "Wang23-DIO",
      openalex_id: "W4387886124",
    },
  })
  const controller = createKeywordDiscoveryController({
    root,
    candidateStore: store,
    prepareAccess() {},
    searchWorks: async () => ({ total: 0, costUsd: 0, works: [] }),
    fetchImpl: async (url) => {
      if (url === "/api/v1/capabilities") {
        const capabilities = [normal, recovery, normal][capabilityReads] ?? normal
        capabilityReads += 1
        return task11Response(capabilities)
      }
      if (url === "/api/v1/archive/candidates") return task11Response({
        status: "created",
        paper_id: "Wang23-DIO",
        folder_name: "Wang23-DIO",
        rebuild_status: "failed",
        index_state: "last_good",
        recovery_required: true,
      }, { status: 201 })
      if (url === "/api/v1/archive/rebuild") return task11Response({
        status: "recovered",
        paper_id: "Wang23-DIO",
        rebuild_status: "complete",
        paper_count: 1,
      })
      throw new Error(`unexpected ${url}`)
    },
    loadIndex: async () => {
      indexLoads += 1
      return { papers: [{ paper_id: "Wang23-DIO", doi_or_url: "10.1109/access.2023.3327199" }] }
    },
    confirmArchive: () => true,
  })
  await controller.start()
  const input = findCandidateControl(root, "archivePaperId", "W4387886124")
  const archive = findCandidateControl(root, "archiveCandidate", "W4387886124")
  input.value = "Wang23-DIO"
  input.dispatch("input")
  await archive.dispatch("click")
  assert.deepEqual(store.marked, [], "a last-good response cannot mark the browser candidate")
  assert.equal(indexLoads, 1, "startup loads local status; failed rebuild must not reload the index")
  const banner = findDescendant(root.elements.get("#candidate-queue-panel"), (node) => node.dataset?.archiveRecoveryBanner === "")
  const rebuild = findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild")
  assert.ok(rebuild)
  assert.equal(findCandidateControl(root, "archiveCandidate", "W4387886124").disabled, true)
  await rebuild.dispatch("click")
  assert.equal(indexLoads, 2)
  assert.deepEqual(store.marked, ["W4387886124"])
  assert.equal(capabilityReads, 3, "successful recovery must re-read capabilities")
  assert.equal(banner.hidden, false, "the current session keeps a neutral recovery result")
  assert.match(banner.textContent, /元数据归档完成/u)
  assert.equal(findDescendant(banner, (node) => node.dataset?.archiveRecoveryAction === "rebuild"), null)
})
