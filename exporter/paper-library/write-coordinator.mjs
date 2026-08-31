import { AsyncLocalStorage } from "node:async_hooks"

const RECOVERY_EVENT = "library_write_recovery_required"
const CANDIDATE_RECOVERY_KEYS = [
  "archive_source_id",
  "kind",
  "openalex_id",
  "paper_id",
  "reason_code",
]
const MANUAL_RECOVERY_KEYS = ["kind", "reason_code"]
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function coordinatorError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, keys) {
  const actual = Object.getOwnPropertyNames(value).sort()
  return Object.getOwnPropertySymbols(value).length === 0
    && actual.length === keys.length
    && actual.every((key, index) => key === keys[index])
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor.enumerable && Object.hasOwn(descriptor, "value")
    })
}

function isSafeIdentifier(value) {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value)
}

function validateRecovery(details) {
  if (!isPlainObject(details)) return null

  if (
    hasExactKeys(details, CANDIDATE_RECOVERY_KEYS)
    && details.kind === "candidate_archive"
    && details.reason_code === "ARCHIVE_REBUILD_FAILED"
    && isSafeIdentifier(details.archive_source_id)
    && isSafeIdentifier(details.paper_id)
    && isSafeIdentifier(details.openalex_id)
  ) {
    return {
      kind: "candidate_archive",
      reason_code: "ARCHIVE_REBUILD_FAILED",
      archive_source_id: details.archive_source_id,
      paper_id: details.paper_id,
      openalex_id: details.openalex_id,
    }
  }

  if (
    hasExactKeys(details, MANUAL_RECOVERY_KEYS)
    && details.kind === "manual_note"
    && ["ROLLBACK_FAILED", "BUILD_OUTPUT_INVALID"].includes(details.reason_code)
  ) {
    return { kind: "manual_note", reason_code: details.reason_code }
  }

  return null
}

function cloneRecovery(recovery) {
  return recovery ? { ...recovery } : null
}

export function createWriteCoordinator({ logger = () => {} } = {}) {
  let busy = false
  let recovery = null
  let activeRecovery = null
  const recoveryContext = new AsyncLocalStorage()
  const writeLogger = typeof logger === "function" ? logger : () => {}

  function logRecovery(record) {
    try {
      Promise.resolve(writeLogger({
        event: RECOVERY_EVENT,
        kind: record.kind,
        reason_code: record.reason_code,
      })).catch(() => {})
    } catch {
      // Logging must never change a write or recovery decision.
    }
  }

  function markRecovery(details) {
    const record = validateRecovery(details)
    if (!record) return Promise.reject(coordinatorError("INVALID_RECOVERY_DETAILS"))
    if (recovery) return Promise.reject(coordinatorError("RECOVERY_REQUIRED"))

    recovery = record
    logRecovery(record)
    return Promise.resolve()
  }

  function getState() {
    return { busy, recovery: cloneRecovery(recovery) }
  }

  function clearRecovery(expectedKind) {
    if (
      expectedKind !== "candidate_archive"
      || recovery?.kind !== "candidate_archive"
      || !activeRecovery
      || recoveryContext.getStore() !== activeRecovery.token
    ) {
      return Promise.reject(coordinatorError("RECOVERY_CLEAR_FORBIDDEN"))
    }

    activeRecovery.clearRequested = true
    return Promise.resolve()
  }

  function run(operation) {
    if (busy) return Promise.reject(coordinatorError("LIBRARY_WRITE_BUSY"))
    if (recovery) return Promise.reject(coordinatorError("RECOVERY_REQUIRED"))
    if (typeof operation !== "function") return Promise.reject(coordinatorError("INVALID_WRITE_OPERATION"))

    busy = true
    return Promise.resolve()
      .then(operation)
      .finally(() => { busy = false })
  }

  function runRecovery(operation) {
    if (busy) return Promise.reject(coordinatorError("LIBRARY_WRITE_BUSY"))
    if (recovery?.kind !== "candidate_archive") return Promise.reject(coordinatorError("RECOVERY_REQUIRED"))
    if (typeof operation !== "function") return Promise.reject(coordinatorError("INVALID_WRITE_OPERATION"))

    busy = true
    const session = { token: Symbol("candidate-recovery"), clearRequested: false }
    activeRecovery = session

    return Promise.resolve()
      .then(() => recoveryContext.run(session.token, operation))
      .then((result) => {
        if (session.clearRequested && recovery?.kind === "candidate_archive") recovery = null
        return result
      })
      .finally(() => {
        if (activeRecovery === session) activeRecovery = null
        busy = false
      })
  }

  return { run, runRecovery, markRecovery, clearRecovery, getState }
}
