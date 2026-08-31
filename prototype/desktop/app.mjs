function setCurrentNavigation(targetHash) {
  const currentPage = location.pathname.split("/").pop()
  // P02 的页内锚点是工作区步骤，不应取代“我的论文”的当前页状态。
  if (currentPage === "p02.html" && targetHash !== "#dashboard") return
  const dashboardHref = currentPage === "p02.html" ? "./p02.html" : "./index.html"
  const navHref = targetHash === "#dashboard" ? dashboardHref : targetHash
  const currentNav = document.querySelector(`.nav-item[href="${navHref}"]`)
  if (!currentNav) return

  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item === currentNav
    item.classList.toggle("nav-item--active", active)
    if (active) item.setAttribute("aria-current", "page")
    else item.removeAttribute("aria-current")
  })
}

function navigateToHash(targetHash, { updateHistory = true, behavior = "smooth" } = {}) {
  const target = document.querySelector(targetHash)
  if (!target) return false

  if (updateHistory) {
    const nextUrl = targetHash === "#dashboard"
      ? `${location.pathname}${location.search}`
      : targetHash
    history.replaceState(null, "", nextUrl)
  }

  setCurrentNavigation(targetHash)

  if (target.matches(".main-column")) {
    target.scrollTo({ top: 0, behavior })
  } else {
    target.scrollIntoView({ behavior, block: "start" })
  }

  return true
}

document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]')
  if (!link) return
  const requestedHash = link.getAttribute("href")
  const targetHash = requestedHash === "#" ? "#dashboard" : requestedHash
  if (!navigateToHash(targetHash)) return
  event.preventDefault()
})

const dialog = document.querySelector("#search-dialog")
const toast = document.querySelector("#toast")
const globalSearch = document.querySelector("#global-search")
const searchTopic = document.querySelector("#search-topic")

function openSearchDialog() {
  const query = globalSearch?.value.trim()
  if (query && searchTopic) searchTopic.value = query
  dialog?.showModal()
}

document.querySelector("#search-new-paper")?.addEventListener("click", openSearchDialog)
globalSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  openSearchDialog()
})
document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
  event.preventDefault()
  if (!dialog?.open) globalSearch?.focus()
})
document.querySelector("#save-search")?.addEventListener("click", () => {
  toast?.classList.add("toast--visible")
  window.setTimeout(() => toast?.classList.remove("toast--visible"), 2200)
})

requestAnimationFrame(() => {
  navigateToHash(location.hash || "#dashboard", { updateHistory: false, behavior: "auto" })
})
