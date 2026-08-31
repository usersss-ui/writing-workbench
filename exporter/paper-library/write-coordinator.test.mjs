import test from "node:test"
import assert from "node:assert/strict"

import { createWriteCoordinator } from "./write-coordinator.mjs"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function candidateRecovery() {
  return {
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
    archive_source_id: "primary-source",
    paper_id: "Zhao26-WIoT",
    openalex_id: "W1234567890",
  }
}

function manualRecovery(reason_code = "ROLLBACK_FAILED") {
  return { kind: "manual_note", reason_code }
}

test("busy writes return an already-rejected promise and never queue a second operation", async () => {
  const coordinator = createWriteCoordinator()
  const first = deferred()
  const firstWrite = coordinator.run(() => first.promise)
  let secondRan = false

  let busyWrite
  assert.doesNotThrow(() => {
    busyWrite = coordinator.run(async () => { secondRan = true })
  })
  await assert.rejects(busyWrite, { code: "LIBRARY_WRITE_BUSY" })
  assert.equal(secondRan, false)

  first.resolve("first result")
  assert.equal(await firstWrite, "first result")
  await Promise.resolve()
  assert.equal(secondRan, false)
})

test("the lock releases after operations resolve, synchronously throw, or asynchronously reject", async () => {
  const coordinator = createWriteCoordinator()

  assert.equal(await coordinator.run(async () => "complete"), "complete")
  await assert.rejects(
    coordinator.run(() => { throw Object.assign(new Error("private failure"), { code: "SYNC_FAILURE" }) }),
    { code: "SYNC_FAILURE" },
  )
  assert.equal(await coordinator.run(async () => "after sync failure"), "after sync failure")

  await assert.rejects(
    coordinator.run(async () => Promise.reject(Object.assign(new Error("private failure"), { code: "ASYNC_FAILURE" }))),
    { code: "ASYNC_FAILURE" },
  )
  assert.equal(await coordinator.run(async () => "after async failure"), "after async failure")
  assert.deepEqual(coordinator.getState(), { busy: false, recovery: null })
})

test("markRecovery accepts only exact detached candidate and manual recovery records", async () => {
  const coordinator = createWriteCoordinator()
  const candidate = candidateRecovery()
  await coordinator.markRecovery(candidate)
  candidate.paper_id = "mutated-input"
  assert.deepEqual(coordinator.getState().recovery, candidateRecovery())

  const second = createWriteCoordinator()
  await second.markRecovery(manualRecovery("BUILD_OUTPUT_INVALID"))
  assert.deepEqual(second.getState().recovery, manualRecovery("BUILD_OUTPUT_INVALID"))
})

test("recovery details reject malformed, path-bearing, inherited, symbol, and extra fields", async () => {
  const coordinator = createWriteCoordinator()
  const nonEnumerableExtra = candidateRecovery()
  Object.defineProperty(nonEnumerableExtra, "hidden", { value: "extra", enumerable: false })
  const invalidDetails = [
    null,
    {},
    { ...candidateRecovery(), extra: true },
    { ...candidateRecovery(), paper_id: "/Users/example/private-paper" },
    { ...manualRecovery(), reason_code: "ARCHIVE_REBUILD_FAILED" },
    Object.assign(Object.create(candidateRecovery()), { kind: "candidate_archive" }),
    nonEnumerableExtra,
  ]
  const symbolDetails = candidateRecovery()
  symbolDetails[Symbol("hidden")] = "value"
  invalidDetails.push(symbolDetails)

  for (const details of invalidDetails) {
    await assert.rejects(coordinator.markRecovery(details), { code: "INVALID_RECOVERY_DETAILS" })
    assert.equal(coordinator.getState().recovery, null)
  }
})

test("normal writes are blocked by recovery while candidate recovery can clear only after a successful callback", async () => {
  const coordinator = createWriteCoordinator()
  await coordinator.markRecovery(candidateRecovery())

  await assert.rejects(coordinator.run(async () => "blocked"), { code: "RECOVERY_REQUIRED" })
  await assert.rejects(coordinator.clearRecovery("candidate_archive"), { code: "RECOVERY_CLEAR_FORBIDDEN" })

  let observedBusy = false
  const result = await coordinator.runRecovery(async () => {
    observedBusy = coordinator.getState().busy
    await coordinator.clearRecovery("candidate_archive")
    assert.deepEqual(coordinator.getState().recovery, candidateRecovery())
    return "rebuilt"
  })

  assert.equal(result, "rebuilt")
  assert.equal(observedBusy, true)
  assert.deepEqual(coordinator.getState(), { busy: false, recovery: null })
})

test("failed candidate recovery and incorrect clear attempts keep recovery active", async () => {
  const coordinator = createWriteCoordinator()
  await coordinator.markRecovery(candidateRecovery())

  await assert.rejects(
    coordinator.runRecovery(async () => {
      await coordinator.clearRecovery("manual_note")
    }),
    { code: "RECOVERY_CLEAR_FORBIDDEN" },
  )
  assert.deepEqual(coordinator.getState().recovery, candidateRecovery())

  await assert.rejects(
    coordinator.runRecovery(async () => {
      await coordinator.clearRecovery("candidate_archive")
      throw new Error("rebuild did not finish")
    }),
    /rebuild did not finish/u,
  )
  assert.deepEqual(coordinator.getState().recovery, candidateRecovery())
})

test("manual-note recovery cannot run or clear through the candidate archive route", async () => {
  const coordinator = createWriteCoordinator()
  await coordinator.markRecovery(manualRecovery())

  await assert.rejects(coordinator.runRecovery(async () => "should not run"), { code: "RECOVERY_REQUIRED" })
  await assert.rejects(coordinator.clearRecovery("manual_note"), { code: "RECOVERY_CLEAR_FORBIDDEN" })
  assert.deepEqual(coordinator.getState(), { busy: false, recovery: manualRecovery() })
})

test("state snapshots cannot mutate the coordinator's busy or recovery state", async () => {
  const coordinator = createWriteCoordinator()
  await coordinator.markRecovery(candidateRecovery())
  const state = coordinator.getState()
  state.busy = true
  state.recovery.paper_id = "mutated-clone"

  assert.deepEqual(coordinator.getState(), { busy: false, recovery: candidateRecovery() })
})

test("logger receives only a fixed sanitized event and cannot alter coordinator state", async () => {
  const events = []
  const coordinator = createWriteCoordinator({
    logger(event) {
      events.push({ ...event })
      event.kind = "manual_note"
      event.reason_code = "ROLLBACK_FAILED"
      event.path = "/Users/example/secret.md"
    },
  })
  const details = candidateRecovery()
  details.paper_id = "Paper-01"
  await coordinator.markRecovery(details)

  assert.deepEqual(events, [{
    event: "library_write_recovery_required",
    kind: "candidate_archive",
    reason_code: "ARCHIVE_REBUILD_FAILED",
  }])
  assert.deepEqual(coordinator.getState().recovery, details)
  assert.doesNotMatch(JSON.stringify(events), /Users|secret|Paper-01|W1234567890/u)
})

test("logger failures and operation error messages never leak or corrupt recovery state", async () => {
  const coordinator = createWriteCoordinator({ logger: () => { throw new Error("/Users/example/logger-secret") } })
  await coordinator.markRecovery(candidateRecovery())
  assert.deepEqual(coordinator.getState(), { busy: false, recovery: candidateRecovery() })

  const error = Object.assign(new Error("/Users/example/operation-secret"), { code: "WRITE_FAILED" })
  await assert.rejects(coordinator.runRecovery(async () => { throw error }), error)
  assert.deepEqual(coordinator.getState(), { busy: false, recovery: candidateRecovery() })
})

test("an asynchronously rejected logger never becomes an unhandled path-bearing rejection", async () => {
  const secret = "/Users/example/async-logger-secret"
  let unhandled = null
  const observeUnhandled = (reason) => { unhandled = reason }
  process.once("unhandledRejection", observeUnhandled)

  try {
    const coordinator = createWriteCoordinator({
      logger: async () => { throw new Error(secret) },
    })
    await coordinator.markRecovery(candidateRecovery())
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(unhandled, null)
    assert.deepEqual(coordinator.getState(), { busy: false, recovery: candidateRecovery() })
  } finally {
    process.removeListener("unhandledRejection", observeUnhandled)
  }
})
