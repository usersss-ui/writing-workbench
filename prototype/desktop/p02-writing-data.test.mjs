import assert from "node:assert/strict"
import test from "node:test"

import { P02_WRITING_DATA, validateP02WritingData } from "./p02-writing-data.mjs"

function replaceFirst(items, changes) {
  return [{ ...items[0], ...changes }, ...items.slice(1)]
}

test("the reviewed P02 snapshot satisfies the closed writing-data contract", () => {
  assert.equal(validateP02WritingData(P02_WRITING_DATA), true)
  assert.equal(P02_WRITING_DATA.manuscript.submissionReadiness, "not_ready")
  assert.equal(P02_WRITING_DATA.crossVenueEvidence.length, 8)
  assert.equal(P02_WRITING_DATA.inVenueStyleSamples.length, 5)
  assert.equal(P02_WRITING_DATA.materials.length, 6)
})

test("the validator rejects unexpected or missing keys at every record boundary", () => {
  const cases = [
    { ...P02_WRITING_DATA, unexpected: true },
    {
      ...P02_WRITING_DATA,
      manuscript: { ...P02_WRITING_DATA.manuscript, unexpected: true },
    },
    {
      ...P02_WRITING_DATA,
      targetVenue: { ...P02_WRITING_DATA.targetVenue, unexpected: true },
    },
    {
      ...P02_WRITING_DATA,
      crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, { unexpected: true }),
    },
    {
      ...P02_WRITING_DATA,
      inVenueStyleSamples: replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, { unexpected: true }),
    },
    {
      ...P02_WRITING_DATA,
      materials: replaceFirst(P02_WRITING_DATA.materials, { unexpected: true }),
    },
    {
      ...P02_WRITING_DATA,
      claimSummary: replaceFirst(P02_WRITING_DATA.claimSummary, { unexpected: true }),
    },
    {
      ...P02_WRITING_DATA,
      blockers: replaceFirst(P02_WRITING_DATA.blockers, { unexpected: true }),
    },
    {
      ...P02_WRITING_DATA,
      crossVenueEvidence: P02_WRITING_DATA.crossVenueEvidence.map((record, index) => {
        if (index !== 0) return record
        const { sourceUrl: _sourceUrl, ...missingSource } = record
        return missingSource
      }),
    },
  ]

  for (const value of cases) assert.equal(validateP02WritingData(value), false)
})

test("substantive evidence and TCNS style samples cannot exchange evidence roles", () => {
  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
      usage: "format_and_style_only",
    }),
  }), false)

  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    inVenueStyleSamples: replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, {
      supportsClaims: true,
    }),
  }), false)
})

test("paper identifiers are globally unique across both evidence pools", () => {
  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    inVenueStyleSamples: replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, {
      paperId: P02_WRITING_DATA.crossVenueEvidence[0].paperId,
    }),
  }), false)
})

test("target-venue identity cannot enter the substantive evidence pool under common names", () => {
  const targetVenueNames = [
    "IEEE Transactions on Control of Network Systems",
    "TCNS",
    "IEEE Trans. Control Netw. Syst.",
  ]

  for (const venue of targetVenueNames) {
    assert.equal(validateP02WritingData({
      ...P02_WRITING_DATA,
      crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, { venue }),
    }), false)
  }
})

test("canonical publication identity is unique across and within evidence pools", () => {
  const duplicatedStyleSource = replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, {
    paperId: "fresh-paper-id",
    sourceUrl: P02_WRITING_DATA.inVenueStyleSamples[1].sourceUrl,
  })
  const targetPaperInCrossVenue = replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
    paperId: "fresh-cross-venue-id",
    title: P02_WRITING_DATA.inVenueStyleSamples[0].title,
    venue: "IEEE Trans. Control Netw. Syst.",
    sourceUrl: P02_WRITING_DATA.inVenueStyleSamples[0].sourceUrl,
  })
  const normalizedDuplicateDoi = replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
    paperId: "fresh-normalized-doi-id",
    sourceUrl: "https://doi.org/10.1016/J.NEUCOM.2022.05.024/",
  })

  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    inVenueStyleSamples: duplicatedStyleSource,
  }), false)
  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    crossVenueEvidence: targetPaperInCrossVenue,
  }), false)
  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    crossVenueEvidence: normalizedDuplicateDoi,
  }), false)
})

test("every paper record requires an HTTPS source", () => {
  const cases = [
    {
      ...P02_WRITING_DATA,
      crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, { sourceUrl: "" }),
    },
    {
      ...P02_WRITING_DATA,
      crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
        sourceUrl: "http://doi.org/10.1109/TETCI.2024.3393362",
      }),
    },
    {
      ...P02_WRITING_DATA,
      inVenueStyleSamples: replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, {
        sourceUrl: "not a URL",
      }),
    },
  ]

  for (const value of cases) assert.equal(validateP02WritingData(value), false)
})

test("valid HTTPS URLs from unreviewed hosts are not accepted as official paper sources", () => {
  assert.equal(validateP02WritingData({
    ...P02_WRITING_DATA,
    crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
      sourceUrl: "https://example.invalid/not-a-publisher-or-doi",
    }),
  }), false)
})

test("all workflow and verification statuses use closed enums", () => {
  const cases = [
    {
      ...P02_WRITING_DATA,
      manuscript: { ...P02_WRITING_DATA.manuscript, submissionReadiness: "ready" },
    },
    {
      ...P02_WRITING_DATA,
      targetVenue: { ...P02_WRITING_DATA.targetVenue, status: "accepted" },
    },
    {
      ...P02_WRITING_DATA,
      crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
        verificationStatus: "unknown",
      }),
    },
    {
      ...P02_WRITING_DATA,
      inVenueStyleSamples: replaceFirst(P02_WRITING_DATA.inVenueStyleSamples, {
        verificationStatus: "unknown",
      }),
    },
    {
      ...P02_WRITING_DATA,
      materials: replaceFirst(P02_WRITING_DATA.materials, { status: "unknown" }),
    },
    {
      ...P02_WRITING_DATA,
      claimSummary: replaceFirst(P02_WRITING_DATA.claimSummary, { status: "unknown" }),
    },
    {
      ...P02_WRITING_DATA,
      blockers: replaceFirst(P02_WRITING_DATA.blockers, { status: "unknown" }),
    },
  ]

  for (const value of cases) assert.equal(validateP02WritingData(value), false)
})

test("private paths are rejected recursively from every string field", () => {
  const privateValues = [
    "/Users/yangfan/private-note.md",
    "file:///private-note.md",
    "C:\\private\\note.md",
    "\\\\server\\share\\note.md",
  ]

  for (const privateValue of privateValues) {
    assert.equal(validateP02WritingData({
      ...P02_WRITING_DATA,
      manuscript: {
        ...P02_WRITING_DATA.manuscript,
        summary: `nested leak: ${privateValue}`,
      },
    }), false)
  }
})

test("Windows drive-root paths are rejected after punctuation and in nested records", () => {
  const embeddedPaths = [
    "leak=C:\\private\\note.md",
    "payload[C:\\private\\note.md]",
    "prefix:C:\\private\\note.md",
    "prefixC:\\private\\note.md",
    "prefixC:/private/note.md",
  ]

  for (const embeddedPath of embeddedPaths) {
    const cases = [
      {
        ...P02_WRITING_DATA,
        manuscript: { ...P02_WRITING_DATA.manuscript, summary: embeddedPath },
      },
      {
        ...P02_WRITING_DATA,
        crossVenueEvidence: replaceFirst(P02_WRITING_DATA.crossVenueEvidence, {
          dimensions: ["在线优化", embeddedPath],
        }),
      },
      {
        ...P02_WRITING_DATA,
        materials: replaceFirst(P02_WRITING_DATA.materials, { roleSummary: embeddedPath }),
      },
    ]

    for (const value of cases) assert.equal(validateP02WritingData(value), false)
  }
})

test("symbol and non-enumerable own properties cannot bypass exact-key validation", () => {
  const symbolRoot = { ...P02_WRITING_DATA }
  symbolRoot[Symbol("private")] = "/Users/yangfan/private-note.md"

  const nonEnumerableRoot = { ...P02_WRITING_DATA }
  Object.defineProperty(nonEnumerableRoot, "hidden", {
    value: "file:///private-note.md",
    enumerable: false,
  })

  const hiddenCrossRecord = { ...P02_WRITING_DATA.crossVenueEvidence[0] }
  Object.defineProperty(hiddenCrossRecord, "hidden", {
    value: "leak=C:\\private\\note.md",
    enumerable: false,
  })
  const nonEnumerableNested = {
    ...P02_WRITING_DATA,
    crossVenueEvidence: [hiddenCrossRecord, ...P02_WRITING_DATA.crossVenueEvidence.slice(1)],
  }

  for (const value of [symbolRoot, nonEnumerableRoot, nonEnumerableNested]) {
    assert.equal(validateP02WritingData(value), false)
  }
})
