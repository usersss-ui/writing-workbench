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
