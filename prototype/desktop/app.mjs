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
  // URL hashes are user input: malformed selector syntax must not break navigation.
  let target
  try { target = document.getElementById(decodeURIComponent(targetHash.slice(1))) } catch { return false }
  if (!target) return false

  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS") parent.open = true
  }
  if (target.tagName === "DETAILS") target.open = true

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

const globalSearch = document.querySelector("#global-search")

globalSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  const query = globalSearch.value.trim()
  location.href = `../../local_library_output/desktop/discovery.html${query ? `?q=${encodeURIComponent(query)}` : ""}`
})
document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
  event.preventDefault()
  globalSearch?.focus()
})

requestAnimationFrame(() => {
  navigateToHash(location.hash || "#dashboard", { updateHistory: false, behavior: "auto" })
})
