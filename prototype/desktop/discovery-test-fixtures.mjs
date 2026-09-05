export function recordInput(patch = {}) {
  return {
    record_id: "r-1",
    provider_id: null,
    bibliography: {
      title: "Synthetic distributed optimization study",
      authors: ["Example Author"],
      year: 2024,
      doi: "10.1234/fixture.1",
      url: "https://example.org/paper/1",
      abstract: null,
      language: null,
      work_type: null,
      journal: { title: null, source_id: null, issns: [], source_type: null },
      citations: null,
    },
    provenance: {
      provider: "manual",
      method: "manual",
      batch_id: "b-1",
      query_id: null,
      import_id: null,
      retrieved_at: "2026-09-05T00:00:00.000Z",
      public_url: "https://example.org/paper/1",
      verification: "declared",
    },
    retraction: { state: "unknown", source_url: null, checked_at: null },
    ...patch,
  }
}

export function memoryStorage(entries = []) {
  const data = new Map(entries)
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    removeItem(key) {
      data.delete(key)
    },
  }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function makeElement({ dataset = {}, attributes = {}, tagName = "div" } = {}) {
  const listeners = new Map()
  const attrs = new Map(Object.entries(attributes))
  return {
    dataset: { ...dataset }, tagName: tagName.toUpperCase(), value: "", ownText: "", hidden: false,
    disabled: false, checked: false, children: [], options: [], href: "", focusCount: 0,
    set textContent(value) { this.ownText = String(value); this.children = []; this.options = [] },
    get textContent() { return this.ownText + this.children.map((child) => child.textContent).join("") },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener) },
    dispatch(type, event = {}) { return Promise.all((listeners.get(type) ?? []).map(listener => listener({ preventDefault() {}, currentTarget: this, ...event }))) },
    setAttribute(name, value) { attrs.set(name, String(value)) },
    getAttribute(name) { return attrs.get(name) ?? null },
    removeAttribute(name) { attrs.delete(name) },
    appendChild(child) { this.children.push(child); return child },
    replaceChildren(...children) { this.ownText = ""; this.children = children; this.options = [...children] },
    append(...children) { this.children.push(...children); this.options.push(...children) },
    focus() { this.focusCount += 1 },
  }
}

export function findElement(root, predicate) {
  if (predicate(root)) return root
  for (const child of root?.children ?? []) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return null
}
