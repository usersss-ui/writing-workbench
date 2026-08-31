import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  buildKeywordSearchExpression,
  createDiscoveryController,
  createKeywordDiscoveryController,
  loadInstitutionProfile,
} from "./discovery.mjs"

const template = await readFile(new URL("./discovery.template.html", import.meta.url), "utf8")

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
  assert.equal(typeof buildKeywordSearchExpression, "function")
  assert.equal(
    buildKeywordSearchExpression("时变有向网络中的低通信分布式约束优化"),
    '("time-varying directed graph" AND "distributed constrained optimization" AND "communication-efficient")',
  )
  assert.equal(buildKeywordSearchExpression("事件触发与耦合约束"), '("event-triggered" AND "coupled constraints")')
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
  assert.match(template, /元数据待核验/u)
  assert.match(template, /不代表已有 PDF 或阅读笔记/u)
  assert.doesNotMatch(template, /<iframe|<embed|<object/u)
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

function makeElement({ dataset = {}, attributes = {}, tagName = "div" } = {}) {
  const listeners = new Map()
  const attrs = new Map(Object.entries(attributes))
  return {
    dataset: { ...dataset }, tagName: tagName.toUpperCase(), value: "", textContent: "", hidden: false,
    disabled: false, children: [], options: [], href: "", focusCount: 0,
    addEventListener(type, listener) { listeners.set(type, listener) },
    dispatch(type) { return listeners.get(type)?.({ preventDefault() {}, currentTarget: this }) },
    setAttribute(name, value) { attrs.set(name, String(value)) },
    getAttribute(name) { return attrs.get(name) ?? null },
    removeAttribute(name) { attrs.delete(name) },
    appendChild(child) { this.children.push(child); return child },
    replaceChildren(...children) { this.children = children; this.options = children },
    append(child) { this.options.push(child) },
    focus() { this.focusCount += 1 },
  }
}

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

function keywordRoot() {
  const keywordTab = makeElement({ dataset: { discoveryMode: "keyword" }, attributes: { "aria-selected": "true" } })
  const accessTab = makeElement({ dataset: { discoveryMode: "access" }, attributes: { "aria-selected": "false", tabindex: "-1" } })
  const elements = new Map([
    ["#keyword-search-form", makeElement({ tagName: "form" })], ["#keyword-query", makeElement()], ["#english-query", makeElement()],
    ["#keyword-sort", makeElement()], ["#keyword-live-search", makeElement({ tagName: "button" })], ["#keyword-search-status", makeElement()],
    ["#keyword-search-results", makeElement()], ["#keyword-live-results-list", makeElement()], ["[data-live-result-count]", makeElement()],
    ["#keyword-discovery-panel", makeElement()], ["#known-paper-panel", makeElement()], ["#candidate-queue-panel", makeElement()],
    ["#access-guide-panel", makeElement()], ["#candidate-queue-status", makeElement()], ["#candidate-queue-list", makeElement()],
    ["[data-candidate-count]", makeElement()], ["[data-candidate-pending-count]", makeElement()], ["[data-candidate-confirmed-count]", makeElement()], ["[data-candidate-empty]", makeElement()],
    ["#institution-access-form", makeElement({ tagName: "form" })], ["#access-locator", makeElement()], ["#access-provider", makeElement()], ["#access-status", makeElement()], ["#access-result", makeElement()],
    ["[data-provider-name]", makeElement()], ["#institution-step-open", makeElement({ tagName: "a" })], ["#institution-step-auth", makeElement({ tagName: "a" })], ["#institution-step-library", makeElement({ tagName: "a" })],
    ["#access-copy-target", makeElement()], ["#access-copy", makeElement({ tagName: "button" })], ["#access-copy-status", makeElement()], ["#access-warnings", makeElement({ tagName: "ul" })],
  ])
  elements.get("#known-paper-panel").hidden = true
  elements.get("#access-guide-panel").hidden = true
  elements.get("#access-result").hidden = true
  elements.get("#keyword-query").value = "时变有向网络中的低通信分布式约束优化"
  elements.get("#keyword-sort").value = "relevance"
  return {
    querySelector(selector) { return elements.get(selector) ?? null },
    querySelectorAll(selector) { return selector === "[data-discovery-mode]" ? [keywordTab, accessTab] : [] },
    createElement(tagName) { return makeElement({ tagName }) }, elements, keywordTab, accessTab,
  }
}

test("关键词控制器切换键盘可达模式、搜索真实结果，并将结果放入待筛选队列", async () => {
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
  root.elements.get("#keyword-search-form").dispatch("submit")
  assert.match(root.elements.get("#english-query").value, /communication-efficient/u)
  await root.elements.get("#keyword-live-search").dispatch("click")
  assert.equal(calls[0].sort, "relevance")
  assert.equal(root.elements.get("[data-live-result-count]").textContent, "1 条真实结果")
  assert.equal(root.elements.get("#keyword-live-results-list").children[0].children[0].textContent, "安全标题")
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
