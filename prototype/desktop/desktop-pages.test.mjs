import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { createDirectionSnapshot, DIRECTION_STORAGE_KEY } from "./direction-snapshot.mjs"

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function createStaticServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    let requestedPath = decodeURIComponent(url.pathname)
    if (requestedPath.endsWith("/")) requestedPath += "index.html"

    const filePath = path.resolve(workspaceRoot, `.${requestedPath}`)
    if (!filePath.startsWith(`${workspaceRoot}${path.sep}`)) {
      response.writeHead(403).end("Forbidden")
      return
    }

    try {
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile()) throw new Error("Not a file")
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(await readFile(filePath))
    } catch {
      response.writeHead(404).end("Not found")
    }
  })
}

test("研究首页与方向探索页可以通过公开链接互相到达", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`

  const homeResponse = await fetch(`${baseUrl}/`)
  const homeHtml = await homeResponse.text()
  assert.equal(homeResponse.status, 200)
  assert.match(homeHtml, /href="\.\/directions\.html"/)
  assert.match(homeHtml, /id="global-search"/)
  assert.doesNotMatch(homeHtml, /aria-labelledby="search-dialog-title"/)

  const directionsResponse = await fetch(`${baseUrl}/directions.html`)
  const directionsHtml = await directionsResponse.text()
  assert.equal(directionsResponse.status, 200)
  assert.match(directionsHtml, /href="\.\/index\.html"/)
  assert.match(directionsHtml, /输入关键词，直接搜索论文/)
  assert.doesNotMatch(directionsHtml, /aria-labelledby="search-dialog-title"/)
})

test("论文发现页可从工作台主导航到达，并与论文库双向链接", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`

  const homeHtml = await (await fetch(`${baseUrl}/`)).text()
  const discoveryResponse = await fetch(`${baseUrl}/discovery.template.html`)
  const discoveryHtml = await discoveryResponse.text()
  assert.match(homeHtml, /href="\.\.\/\.\.\/local_library_output\/desktop\/discovery\.html"/u)
  assert.equal(discoveryResponse.status, 200)
  assert.match(discoveryHtml, /href="\.\/library\.html"/u)
  assert.match(discoveryHtml, /论文发现/u)
})

test("四个检索入口进入真实论文发现页，不再保存假的检索任务", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const [homeHtml, directionsHtml, p02Html, libraryHtml] = await Promise.all([
    fetch(`${baseUrl}/prototype/desktop/`).then((response) => response.text()),
    fetch(`${baseUrl}/prototype/desktop/directions.html`).then((response) => response.text()),
    fetch(`${baseUrl}/prototype/desktop/p02.html`).then((response) => response.text()),
    fetch(`${baseUrl}/prototype/desktop/library.template.html`).then((response) => response.text()),
  ])

  assert.match(homeHtml, /id="home-online-search" href="\.\.\/\.\.\/local_library_output\/desktop\/discovery\.html"/u)
  assert.match(homeHtml, /id="home-local-search" href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html"/u)
  for (const html of [directionsHtml, p02Html]) {
    assert.match(
      html,
      /<a class="button button--(?:primary|secondary)" id="search-new-paper" href="\.\.\/\.\.\/local_library_output\/desktop\/discovery\.html\?q=[^"]+">/u,
    )
    assert.doesNotMatch(html, /id="save-search"|aria-labelledby="search-dialog-title"/u)
  }
  assert.match(
    libraryHtml,
    /<a class="button button--secondary" id="search-new-paper" href="\.\/discovery\.html">搜索新论文<\/a>/u,
  )
  assert.doesNotMatch(libraryHtml, /id="search-new-paper"[^>]*disabled/u)
})

test("桌面页不会把尚未实现的装饰和状态继续伪装成可点击按钮", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`
  const pages = await Promise.all(
    ["index.html", "directions.html", "p02.html", "agent-tasks.html", "p02-writing.html"]
      .map((name) => fetch(`${baseUrl}/${name}`).then((response) => response.text())),
  )

  for (const html of pages) {
    assert.doesNotMatch(html, /<button[^>]*aria-label="(?:通知|用户菜单)"/u)
  }
  const [homeHtml, , p02Html] = pages
  assert.match(homeHtml, /id="home-continue" href="\.\/directions\.html"/u)
  assert.doesNotMatch(homeHtml, /<button[^>]*>查看全部项目<\/button>|<button[^>]*>查看章节映射 →<\/button>/u)
  assert.doesNotMatch(homeHtml, /<button[^>]*aria-label="课题设置"/u)
  assert.doesNotMatch(p02Html, /<button[^>]*aria-label="课题设置"/u)
})

test("方向页搜索快捷键只聚焦当前页检索框，不再引用已删除的对话框", async () => {
  const source = await readFile(path.join(workspaceRoot, "prototype/desktop/directions.mjs"), "utf8")
  assert.doesNotMatch(source, /\bdialog\?\.open\b/u)
  assert.match(
    source,
    /if \(!\(event\.metaKey \|\| event\.ctrlKey\) \|\| event\.key\.toLowerCase\(\) !== "k"\) return[\s\S]*?document\.querySelector\("#paper-search"\)\?\.focus\(\)/u,
  )
})

test("方向页以真实 GET 检索表单为主入口，研究条件默认折叠且无内置样例统计", async () => {
  const html = await readFile(path.join(workspaceRoot, "prototype/desktop/directions.html"), "utf8")
  const form = html.match(/<form\b[^>]*id="direction-search-form"[^>]*>([\s\S]*?)<\/form>/u)
  assert.ok(form, "a native form must submit the user's search")
  assert.match(form[0], /method="get"/u)
  assert.match(form[0], /action="\.\.\/\.\.\/local_library_output\/desktop\/discovery\.html"/u)
  assert.match(form[0], /<input[^>]*id="paper-search"[^>]*name="q"[^>]*required/u)
  assert.match(form[0], /<input[^>]*name="search"[^>]*value="1"/u)
  for (const name of ["startYear", "endYear"]) {
    const input = form[0].match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "u"))?.[0]
    assert.ok(input)
    assert.doesNotMatch(input, /\brequired\b|\bvalue="\d/u)
  }
  assert.match(form[0], /<select[^>]*name="language"/u)
  for (const value of ["all", "en", "zh"]) assert.match(form[0], new RegExp(`<option value="${value}"`, "u"))
  const advanced = html.match(/<details\b[^>]*id="direction-advanced"[^>]*>([\s\S]*?)<\/details>/u)
  assert.ok(advanced)
  assert.doesNotMatch(advanced[0].split(">")[0], /\bopen\b/u)
  for (const id of ["direction-filters", "save-candidate", "save-candidate-side", "selected-count", "use-direction-in-search", "search-new-paper"]) {
    assert.match(advanced[1], new RegExp(`id="${id}"`, "u"))
  }
  assert.doesNotMatch(html, /id="(?:paper-list|paper-sort|metric-matches|metric-completed|metric-reading|gap-list)"|class="inspector"/u)
})

function createDirectionPageFixture(savedSelection) {
  const values = new Map(savedSelection ? [[DIRECTION_STORAGE_KEY, JSON.stringify(createDirectionSnapshot(savedSelection, { savedAt: "2026-09-01T00:00:00.000Z" }))]] : [])
  let writes = 0
  class Element {
    constructor() { this.value = ""; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.textContent = ""; this.classList = { add() {}, remove() {} } }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    setAttribute(name, value) { this.attributes.set(name, value) }
    removeAttribute(name) { this.attributes.delete(name) }
    querySelectorAll() { return [] }
    replaceChildren(...children) { this.children = children }
    append(...children) { this.children.push(...children) }
    focus() { this.focused = true }
    setCustomValidity(message) { this.validationMessage = message }
    reportValidity() { return !this.validationMessage }
    click() { this.listeners.get("click")?.({ preventDefault() {} }) }
  }
  const ids = new Map([
    "direction-search-form", "paper-search", "search-start-year", "search-end-year", "search-language", "direction-filters", "toast",
    "direction-save-state", "direction-save-axes", "selected-count", "search-new-paper", "search-local-library",
    "reset-direction", "clear-direction", "use-direction-in-search", "save-candidate", "save-candidate-side",
  ].map((id) => [id, new Element()]))
  ids.get("search-language").value = "all"
  const documentListeners = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes += 1; values.set(key, value) },
  }
  const document = {
    querySelector(selector) { return ids.get(selector.replace(/^#/u, "")) ?? null },
    createElement() { return new Element() },
    addEventListener(name, listener) { documentListeners.set(name, listener) },
  }
  const window = { localStorage: storage, clearTimeout() {}, setTimeout() {}, location: { hash: "", search: "" }, requestAnimationFrame(callback) { callback() } }
  return { document, window, ids, values, writeCount: () => writes, documentListeners }
}

test("已保存方向恢复但不混入自由关键词，只有主动带入或按条件搜索才使用高级条件", async () => {
  const directions = await import("./directions.mjs")
  assert.equal(typeof directions.initializeDirections, "function")
  const fixture = createDirectionPageFixture({ problem: ["在线优化"], direction: ["无向网络"] })
  fixture.ids.get("paper-search").value = "my independent keyword"
  directions.initializeDirections(fixture)
  assert.equal(fixture.ids.get("paper-search").value, "my independent keyword")
  assert.equal(fixture.ids.get("selected-count").textContent, "2 个条件")
  assert.equal(fixture.writeCount(), 0)
  const online = new URL(fixture.ids.get("search-new-paper").href, "https://workbench.example/prototype/desktop/")
  assert.equal(online.searchParams.get("q"), "在线优化 无向网络")
  assert.equal(online.searchParams.get("search"), "1")
  assert.deepEqual(JSON.parse(online.searchParams.get('axes')), { version: 1, axes: { problem: ['在线优化'], direction: ['无向网络'] } })
  const local = new URL(fixture.ids.get("search-local-library").href, online)
  assert.equal(local.searchParams.get("q"), "my independent keyword")
  fixture.ids.get("use-direction-in-search").click()
  assert.equal(fixture.ids.get("paper-search").value, "在线优化 无向网络")
  fixture.ids.get("reset-direction").click()
  assert.equal(fixture.ids.get("paper-search").value, "在线优化 无向网络")
  assert.equal(fixture.writeCount(), 0)
  fixture.ids.get("save-candidate-side").click()
  assert.equal(fixture.writeCount(), 1)
  assert.equal(JSON.parse(fixture.values.get(DIRECTION_STORAGE_KEY)).axes.problem[0], "分布式优化")
})

test("原生检索提交保留关键词与选定筛选，空词和倒置年份不会进入检索", async () => {
  const { initializeDirections } = await import("./directions.mjs")
  assert.equal(typeof initializeDirections, "function")
  const fixture = createDirectionPageFixture()
  initializeDirections(fixture)
  const query = fixture.ids.get("paper-search")
  const submit = fixture.ids.get("direction-search-form").listeners.get("submit")
  assert.equal(typeof submit, "function")
  const event = () => ({ prevented: false, preventDefault() { this.prevented = true } })
  query.value = "  "
  const empty = event()
  submit(empty)
  assert.equal(empty.prevented, true)
  query.value = "  distributed control  "
  fixture.ids.get("search-start-year").value = "2025"
  fixture.ids.get("search-end-year").value = "2020"
  const reversed = event()
  submit(reversed)
  assert.equal(reversed.prevented, true)
  fixture.ids.get("search-start-year").value = "2018"
  fixture.ids.get("search-language").value = "en"
  const valid = event()
  submit(valid)
  assert.equal(valid.prevented, false)
  assert.equal(query.value, "distributed control")
  assert.equal(fixture.ids.get("search-language").value, "en")
  assert.equal(fixture.writeCount(), 0)
})

test('带入方向后原生表单传递 OR 分组，手改词清除旧 axes', async () => {
  const { initializeDirections } = await import('./directions.mjs')
  const fixture = createDirectionPageFixture({ problem: ['分布式优化', '在线优化'] })
  initializeDirections(fixture)
  assert.equal(fixture.ids.get('selected-count').textContent, '1 个条件')
  fixture.ids.get('use-direction-in-search').click()
  const form = fixture.ids.get('direction-search-form')
  const axesInput = form.children.find(child => child.name === 'axes')
  assert.ok(axesInput)
  assert.equal(axesInput.disabled, false)
  assert.deepEqual(JSON.parse(axesInput.value), { version: 1, axes: { problem: ['分布式优化', '在线优化'] } })
  fixture.ids.get('paper-search').value = 'my manual NOT query'
  fixture.ids.get('paper-search').listeners.get('input')()
  assert.equal(axesInput.disabled, true)
  assert.equal(axesInput.value, '')
  assert.equal(fixture.writeCount(), 0)
})

test("论文发现与论文库生成模板都保留学位论文导航", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`

  const [discoveryHtml, libraryHtml] = await Promise.all([
    fetch(`${baseUrl}/discovery.template.html`).then((response) => response.text()),
    fetch(`${baseUrl}/library.template.html`).then((response) => response.text()),
  ])

  for (const html of [discoveryHtml, libraryHtml]) {
    assert.match(
      html,
      /<a class="nav-item" href="\.\.\/\.\.\/prototype\/desktop\/index\.html#thesis"><span aria-hidden="true">◇<\/span><span>学位论文<\/span><\/a>/u,
    )
  }
})

test("所有主工作台页面内嵌 data favicon，不触发未授权的 favicon 路由", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`
  const pageNames = [
    "library.template.html",
    "discovery.template.html",
    "directions.html",
    "agent-tasks.html",
  ]

  for (const pageName of pageNames) {
    const response = await fetch(`${baseUrl}/${pageName}`)
    const pageHtml = await response.text()
    const favicon = pageHtml.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*>/u)?.[1]
    assert.equal(response.status, 200, pageName)
    assert.ok(favicon, pageName)
    assert.equal(new URL(favicon).protocol, "data:", pageName)
  }
})

test("研究任务输入页从五个工作台表面可达且方向页公开显式保存状态", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`

  const [homeHtml, directionsHtml, p02Html, libraryHtml, discoveryHtml, agentResponse] = await Promise.all([
    fetch(`${baseUrl}/`).then((response) => response.text()),
    fetch(`${baseUrl}/directions.html`).then((response) => response.text()),
    fetch(`${baseUrl}/p02.html`).then((response) => response.text()),
    fetch(`${baseUrl}/library.template.html`).then((response) => response.text()),
    fetch(`${baseUrl}/discovery.template.html`).then((response) => response.text()),
    fetch(`${baseUrl}/agent-tasks.html`),
  ])
  const agentHtml = await agentResponse.text()

  for (const html of [homeHtml, directionsHtml, p02Html]) assert.match(html, /href="\.\/agent-tasks\.html"/u)
  for (const html of [libraryHtml, discoveryHtml]) {
    assert.match(html, /href="\.\.\/\.\.\/prototype\/desktop\/agent-tasks\.html"/u)
  }
  assert.equal(agentResponse.status, 200)
  assert.match(agentHtml, /研究任务输入/u)
  assert.match(agentHtml, /href="\.\/directions\.html"/u)
  assert.match(agentHtml, /href="\.\.\/\.\.\/local_library_output\/desktop\/library\.html"/u)
  assert.match(directionsHtml, /id="direction-save-state"/u)
  assert.match(directionsHtml, /id="direction-save-axes"/u)
})

test("P02 工作台从首页可达并区分算法材料与理论结果", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`

  const homeResponse = await fetch(`${baseUrl}/`)
  const homeHtml = await homeResponse.text()
  assert.equal(homeResponse.status, 200)
  assert.match(homeHtml, /href="\.\/p02\.html"/)
  assert.match(homeHtml, /理论待系统核验/)
  assert.doesNotMatch(homeHtml, /理论 62%/)
  assert.doesNotMatch(homeHtml, /引理 3\.2/)

  const p02Response = await fetch(`${baseUrl}/p02.html`)
  const p02Html = await p02Response.text()
  assert.equal(p02Response.status, 200)
  assert.match(p02Html, /href="\.\/index\.html"/)
  assert.match(p02Html, /id="material-algorithm"/)
  assert.match(p02Html, /id="material-theory"/)
  assert.match(p02Html, /role="radiogroup"/)
  assert.match(p02Html, /href="#writing-entry"/)
  assert.match(p02Html, /算法材料/)
  assert.match(p02Html, /理论结果待补层/)
  assert.match(p02Html, /收敛性/)
  assert.match(p02Html, /收敛率/)
  assert.match(p02Html, /约束违背/)
  assert.match(p02Html, /遗憾界/)
  assert.match(p02Html, /通信复杂度/)
  assert.match(p02Html, /未检查原文/)
  assert.match(p02Html, /已定位/)
  assert.match(p02Html, /已核验/)
  assert.match(p02Html, /可用于 P02/)
  assert.match(p02Html, /不适用/)
  assert.match(p02Html, /动态网络不等于在线目标/)
  assert.match(
    p02Html,
    /<strong>共识与跟踪误差<\/strong>[\s\S]*?evidence-state--unchecked">未检查原文<\/span>/,
  )
  assert.doesNotMatch(p02Html, /Not Reported|Unknown/)
})

test("P02 工作台提供从算法到写作的五阶段可操作闭环", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`
  const response = await fetch(`${baseUrl}/p02.html`)
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /id="workflow-loop"/u)
  assert.match(html, /id="workflow-stage-summary"/u)
  for (const stage of ["algorithm", "theory_target", "theory_analysis", "simulation", "writing"]) {
    assert.match(html, new RegExp(`data-workflow-stage="${stage}"`, "u"))
    assert.match(html, new RegExp(`data-action="accept-stage" data-stage="${stage}"`, "u"))
  }
  for (const role of ["algorithm_mechanism", "theory_evidence", "simulation_baseline", "related_work"]) {
    assert.match(html, new RegExp(`data-workflow-role="${role}"`, "u"))
  }
  assert.match(html, /id="workflow-generate-writing"/u)
  assert.equal([...html.matchAll(/data-next-action/gu)].length, 3)
  for (const section of ["algorithm", "theory", "simulation"]) {
    assert.match(html, new RegExp(`data-writing-entry-status="${section}"`, "u"))
  }
  for (const field of ["problem_algorithm", "theory_section", "experiment_section"]) {
    assert.match(html, new RegExp(`data-material-readiness="${field}"`, "u"))
  }
  assert.match(html, /src="\.\/p02-workflow-ui\.mjs"/u)
})

test("P02 投稿与写作材料页双向可达并显式分流两类文献", async (context) => {
  const server = createStaticServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/prototype/desktop`
  const [p02Response, writingResponse] = await Promise.all([
    fetch(`${baseUrl}/p02.html`),
    fetch(`${baseUrl}/p02-writing.html`),
  ])
  const [p02Html, writingHtml] = await Promise.all([p02Response.text(), writingResponse.text()])

  assert.equal(p02Response.status, 200)
  assert.equal(writingResponse.status, 200)
  assert.match(p02Html, /href="\.\/p02-writing\.html"/u)
  assert.match(p02Html, /id="workflow-open-writing-page"[^>]*href="\.\/p02-writing\.html"/u)
  assert.match(p02Html, /id="writing-entry"[\s\S]*?href="\.\/p02-writing\.html"/u)
  assert.match(writingHtml, /href="\.\/p02\.html"/u)
  assert.match(writingHtml, /同类论文 · 不同期刊/u)
  assert.match(writingHtml, /相关工作与实质证据/u)
  assert.match(writingHtml, /TCNS 同刊相似论文/u)
  assert.match(writingHtml, /仅用于排版与写作风格/u)
  assert.match(writingHtml, /id="cross-venue-evidence"/u)
  assert.match(writingHtml, /id="in-venue-style-samples"/u)
  assert.match(writingHtml, /id="writing-materials"/u)
  assert.match(writingHtml, /id="claim-summary"/u)
  assert.match(writingHtml, /id="submission-blockers"/u)
  assert.equal([...writingHtml.matchAll(/data-writing-material-card/gu)].length, 6)
  assert.match(writingHtml, /src="\.\/p02-writing\.mjs"/u)
})

test("P02 页面初始化后保持我的论文为当前导航", async () => {
  const navItems = [
    createFakeNavItem("./index.html"),
    createFakeNavItem("./p02.html", true),
    createFakeNavItem("#materials"),
  ]
  const dashboard = {
    matches: (selector) => selector === ".main-column",
    scrollTo() {},
  }
  const materials = {
    matches: () => false,
    scrollIntoView() {},
  }
  const source = await readFile(path.join(workspaceRoot, "prototype/desktop/app.mjs"), "utf8")

  vm.runInNewContext(source, {
    document: {
      addEventListener() {},
      getElementById(id) { return id === "dashboard" ? dashboard : id === "materials" ? materials : null },
      querySelector(selector) {
        if (selector === "#dashboard") return dashboard
        if (selector === "#materials") return materials
        const href = selector.match(/^\.nav-item\[href="(.+)"\]$/)?.[1]
        return href ? navItems.find((item) => item.href === href) ?? null : null
      },
      querySelectorAll(selector) {
        return selector === ".nav-item" ? navItems : []
      },
    },
    history: { replaceState() {} },
    location: { hash: "#materials", pathname: "/prototype/desktop/p02.html", search: "" },
    requestAnimationFrame(callback) { callback() },
    window: { setTimeout() {}, clearTimeout() {} },
  })

  assert.equal(navItems[0].attributes.has("aria-current"), false)
  assert.equal(navItems[1].attributes.get("aria-current"), "page")
  assert.equal(navItems[2].attributes.has("aria-current"), false)
})

test("首页全局搜索按 Enter 后把研究词带到论文发现页", async () => {
  const inputListeners = new Map()
  const globalSearch = {
    value: "事件触发 耦合约束",
    addEventListener(type, listener) { inputListeners.set(type, listener) },
    focus() {},
  }
  const dashboard = {
    matches: (selector) => selector === ".main-column",
    scrollTo() {},
  }
  const documentListeners = new Map()
  const location = {
    hash: "",
    pathname: "/prototype/desktop/index.html",
    search: "",
    href: "http://127.0.0.1:4176/prototype/desktop/index.html",
  }
  const source = await readFile(path.join(workspaceRoot, "prototype/desktop/app.mjs"), "utf8")

  vm.runInNewContext(source, {
    document: {
      addEventListener(type, listener) { documentListeners.set(type, listener) },
      getElementById(id) { return id === "dashboard" ? dashboard : null },
      querySelector(selector) {
        if (selector === "#dashboard") return dashboard
        if (selector === "#global-search") return globalSearch
        return null
      },
      querySelectorAll() { return [] },
    },
    history: { replaceState() {} },
    location,
    requestAnimationFrame(callback) { callback() },
    window: { setTimeout() {}, clearTimeout() {} },
  })

  let prevented = false
  inputListeners.get("keydown")({ key: "Enter", preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(
    location.href,
    "../../local_library_output/desktop/discovery.html?q=%E4%BA%8B%E4%BB%B6%E8%A7%A6%E5%8F%91%20%E8%80%A6%E5%90%88%E7%BA%A6%E6%9D%9F",
  )
})

function createFakeNavItem(href, active = false) {
  const attributes = new Map(active ? [["aria-current", "page"]] : [])
  const classes = new Set(active ? ["nav-item--active"] : [])
  return {
    href,
    attributes,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name)
        else classes.delete(name)
      },
    },
    setAttribute(name, value) { attributes.set(name, value) },
    removeAttribute(name) { attributes.delete(name) },
  }
}
