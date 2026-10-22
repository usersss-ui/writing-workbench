import assert from "node:assert/strict"
import test from "node:test"
import { initializeResearchHome, readHomeState, summarizeHome, summarizeProjects } from "./research-home.mjs"
import { createDirectionSnapshot, DIRECTION_STORAGE_KEY } from "./direction-snapshot.mjs"
import { createEmptyP02WorkflowState } from "./p02-workflow.mjs"

const papers = [{ paper_id: "Example24-One", note_status: "notes_ready" }, { paper_id: "Example25-Two", note_status: "pdf_only" }]
const direction = createDirectionSnapshot({ problem: ["分布式优化"], direction: ["有向网络"] })

test("home reads actual library totals and counts only existing manually read papers", () => {
  const view = summarizeHome({ direction, papers, workspace: { personalReading: { "Example24-One": "read", "Deleted23-Old": "read" } } })
  assert.equal(view.paperCount, "2")
  assert.equal(view.noteCount, "1")
  assert.equal(view.readCount, "1")
})

test("missing library and broken browser state never masquerade as zero or completed research", () => {
  const memory = new Map([["research-console.paper-library.v1", "{bad"]])
  const before = [...memory]
  const state = readHomeState({ getItem: (key) => memory.get(key) ?? null })
  assert.equal(state.trouble, true)
  assert.deepEqual([...memory], before)
  const view = summarizeHome({ ...state, papers: null })
  assert.equal(view.paperCount, "—")
  assert.equal(view.noteCount, "—")
})

test("existing notes alone do not imply the user has read or confirmed them", () => {
  const view = summarizeHome({ direction, papers, workspace: { personalReading: {}, selectedPaperId: "Example24-One" } })
  assert.equal(view.readCount, "0")
})

test("denied localStorage is shown as unavailable and is not cleared", () => {
  const state = readHomeState({ getItem() { throw new Error("denied") } })
  assert.equal(state.trouble, true)
  assert.equal(state.workspace, null)
  assert.equal(summarizeHome({ ...state, papers }).readCount, "—")
})

function homePageFixture() {
  const nodes = new Map()
  const events = new Map()
  return {
    nodes, events,
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id) } },
    window: { addEventListener(name, listener) { events.set(name, listener) } },
    storage: { getItem() { return null } },
  }
}

const indexResponse = (records) => ({ ok: true, json: async () => ({ version: 3, papers: records }) })

test("returning from the reading page and refocusing refreshes current note counts without a cached index", async () => {
  const page = homePageFixture()
  let current = [{ paper_id: "Example24-One", note_status: "pdf_only" }]
  const requests = []
  await initializeResearchHome({ ...page, fetchImpl: async (url, options) => { requests.push({ url, options }); return indexResponse(current) } })
  assert.equal(page.nodes.get("home-note-count").textContent, "0")
  current = papers
  await page.events.get("pageshow")({ persisted: true })
  assert.equal(page.nodes.get("home-paper-count").textContent, "2")
  assert.equal(page.nodes.get("home-note-count").textContent, "1")
  assert.equal(typeof page.events.get("focus"), "function")
  current = papers.map((paper) => ({ ...paper, note_status: "notes_ready" }))
  await page.events.get("focus")({})
  assert.equal(page.nodes.get("home-note-count").textContent, "2")
  assert.equal(requests.length, 3)
  assert.equal(requests.every(({ options }) => options?.cache === "no-store"), true)
})

test("a failed index refresh clears stale totals and can recover on the next focus", async () => {
  const page = homePageFixture()
  let fail = false
  await initializeResearchHome({ ...page, fetchImpl: async () => { if (fail) throw new Error("offline"); return indexResponse(papers) } })
  assert.equal(page.nodes.get("home-note-count").textContent, "1")
  fail = true
  await page.events.get("pageshow")({ persisted: true })
  assert.equal(page.nodes.get("home-paper-count").textContent, "—")
  assert.equal(page.nodes.get("home-note-count").textContent, "—")
  assert.match(page.nodes.get("home-status").textContent, /暂未载入|刷新失败/u)
  fail = false
  await page.events.get("focus")({})
  assert.equal(page.nodes.get("home-paper-count").textContent, "2")
  assert.doesNotMatch(page.nodes.get("home-status").textContent, /暂未载入|刷新失败/u)
})

test("a late old index response or failure cannot overwrite a newer homepage refresh", async () => {
  const page = homePageFixture()
  const pending = []
  let initial = true
  const controller = await initializeResearchHome({ ...page, fetchImpl: () => {
    if (initial) { initial = false; return Promise.resolve(indexResponse([])) }
    return new Promise((resolve, reject) => pending.push({ resolve, reject }))
  } })
  const oldRequest = controller.refresh()
  const newRequest = controller.refresh()
  assert.equal(pending.length, 2)
  pending[1].resolve(indexResponse(papers))
  await newRequest
  pending[0].resolve(indexResponse([]))
  await oldRequest
  assert.equal(page.nodes.get("home-paper-count").textContent, "2")
  const oldFailure = controller.refresh()
  const latest = controller.refresh()
  pending[3].resolve(indexResponse(papers))
  await latest
  pending[2].reject(new Error("late old failure"))
  await oldFailure
  assert.equal(page.nodes.get("home-note-count").textContent, "1")
  assert.doesNotMatch(page.nodes.get("home-status").textContent, /暂未载入|刷新失败/u)
})

test("registered writing projects link to their section guide; an unreadable list is not shown as empty", () => {
  assert.deepEqual(summarizeProjects({ version: 1, projects: [{ project_id: "v10", available: true }, { project_id: "old", available: false }] }), [
    { id: "v10", available: true, href: "./paper-project.html?project=v10" },
    { id: "old", available: false, href: "./paper-project.html?project=old" },
  ])
  assert.deepEqual(summarizeProjects({ version: 1, projects: [] }), [])
  assert.equal(summarizeProjects({ error: {} }), null)
})
