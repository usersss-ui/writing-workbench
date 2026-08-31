import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

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
  assert.match(homeHtml, /aria-labelledby="search-dialog-title"/)

  const directionsResponse = await fetch(`${baseUrl}/directions.html`)
  const directionsHtml = await directionsResponse.text()
  assert.equal(directionsResponse.status, 200)
  assert.match(directionsHtml, /href="\.\/index\.html"/)
  assert.match(directionsHtml, /按研究维度组合方向/)
  assert.match(directionsHtml, /aria-labelledby="search-dialog-title"/)
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
