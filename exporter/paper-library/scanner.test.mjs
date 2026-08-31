import test from "node:test"
import assert from "node:assert/strict"
import { constants } from "node:fs"
import { appendFile, mkdtemp, mkdir, open as openFile, rename, symlink, writeFile } from "node:fs/promises"
import { dirname, join, win32 } from "node:path"
import { tmpdir } from "node:os"
import { classifyArtifact, scanPaperSources } from "./scanner.mjs"
import { summarizeArtifactAvailability } from "./artifacts.mjs"
import { parsePaperFrontmatter } from "./frontmatter.mjs"
import { makePathPaperId } from "./ids.mjs"

async function put(root, relativePath, content = "fixture") {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  return target
}

function scan(root, overrides = { version: 1, papers: {} }) {
  return scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides,
  })
}

function archiveMetadata({
  paperId = "Wang23-DIO",
  archiveSourceId = "main_papers",
  openalexId = "W4387886124",
  doi = null,
  title = "Distributed Interval Optimization Over Time-Varying Networks",
  authors = ["Yinghui Wang"],
  venue = "IEEE Access",
} = {}) {
  const lines = [
    `paper_id: ${paperId}`,
    `title: ${JSON.stringify(title)}`,
  ]
  if (authors.length === 0) lines.push("authors: []")
  else {
    lines.push("authors:")
    for (const author of authors) lines.push(`  - ${JSON.stringify(author)}`)
  }
  lines.push(
    "year: 2023",
    `venue: ${JSON.stringify(venue)}`,
    doi === null ? `url: "https://openalex.org/${openalexId}"` : `doi: "${doi}"`,
    "unit_type: article",
    "archive_mode: metadata_only",
    `archive_source_id: ${archiveSourceId}`,
    "candidate_source: openalex",
    `openalex_id: ${openalexId}`,
    'archived_at: "2026-08-30T04:05:06.000Z"',
    "",
  )
  return lines.join("\n")
}

function archiveMetadataAtBytes(targetBytes) {
  const authors = ["A"]
  let text = archiveMetadata({ authors })
  while (Buffer.byteLength(text, "utf8") < targetBytes) {
    const remaining = targetBytes - Buffer.byteLength(text, "utf8")
    const index = authors.length
    const prefix = `A${index}-`
    const maximumLength = Math.min(300, Math.max(prefix.length, remaining - 7))
    authors.push(`${prefix}${"x".repeat(maximumLength - prefix.length)}`)
    const next = archiveMetadata({ authors })
    if (Buffer.byteLength(next, "utf8") > targetBytes) {
      authors.pop()
      const exactLength = targetBytes - Buffer.byteLength(text, "utf8") - 7
      authors.push(`${prefix}${"x".repeat(exactLength - prefix.length)}`)
      text = archiveMetadata({ authors })
      break
    }
    text = next
  }
  assert.equal(Buffer.byteLength(text, "utf8"), targetBytes)
  return text
}

async function rejectedScan(run) {
  try {
    await run()
    assert.fail("expected scan to reject")
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error
    return error
  }
}

test("indexes a PDF leaf once and keeps multiple PDFs as versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Xi (2018) ADD-OPT/paper.pdf")
  await put(root, "Xi (2018) ADD-OPT/paper-v2.pdf")
  await put(root, "Xi (2018) ADD-OPT/Xi18-ADDOPT_论文精读.md", "# 精读")

  const result = await scan(root)
  assert.equal(result.papers.length, 1)
  assert.equal(result.papers[0].artifacts.pdf.length, 2)
  assert.equal(result.papers[0].artifacts.note.length, 1)
  assert.deepEqual(result.audit.warnings.multiple_versions, [`${result.papers[0].paper_id}:pdf`])
  assert.equal(result.audit.warnings.multiple_versions[0].includes(root), false)
  assert.equal(result.audit.warnings.multiple_versions[0].includes("Xi (2018)"), false)
})

test("keeps multiple OCR files as versions and records a path-free warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/paper.md", "# OCR v1")
  await put(root, "Paper/paper-ocr.md", "# OCR v2")

  const result = await scan(root)
  assert.equal(result.papers[0].artifacts.ocr.length, 2)
  assert.deepEqual(result.audit.warnings.multiple_versions, [`${result.papers[0].paper_id}:ocr`])
  assert.equal(result.audit.warnings.multiple_versions[0].includes(root), false)
  assert.equal(result.audit.warnings.multiple_versions[0].includes("Paper"), false)
})

test("does not index candidate tables, empty folders, or non-paper projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "候选表.md")
  await put(root, "website/index.html")
  await mkdir(join(root, "空目录"), { recursive: true })

  const result = await scan(root)
  assert.equal(result.papers.length, 0)
})

test("turns thesis chapter PDF directories into child units", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Doctoral Thesis/thesis.pdf")
  await put(root, "Doctoral Thesis/Chapter 03/chapter-03.pdf")

  const result = await scan(root, {
    version: 1,
    papers: { "main_papers::Doctoral Thesis": { paper_id: "THESIS-01", unit_type: "thesis" } },
  })
  assert.equal(result.papers.length, 2)
  const chapter = result.papers.find((paper) => paper.unit_type === "chapter")
  assert.equal(chapter.parent_paper_id, "THESIS-01")
  assert.equal(result.papers.find((paper) => paper.paper_id === "THESIS-01").artifacts.pdf.length, 1)
})

test("indexes an override-declared review container even without a PDF of its own", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Survey Container/Included Paper/paper.pdf")
  const result = await scan(root, {
    version: 1,
    papers: { "main_papers::Survey Container": { paper_id: "SURVEY-01", unit_type: "review" } },
  })
  const review = result.papers.find((paper) => paper.paper_id === "SURVEY-01")
  assert.equal(result.papers.length, 2)
  assert.equal(review.unit_type, "review")
  assert.equal(review.artifacts.pdf.length, 0)
})

test("indexes one direct metadata-only package conservatively without treating metadata.yaml as an artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-scan-"))
  await put(root, "Candidate/metadata.yaml", archiveMetadata())

  const result = await scan(root)
  assert.equal(result.papers.length, 1)
  const paper = result.papers[0]
  assert.equal(paper.paper_id, "Wang23-DIO")
  assert.equal(paper.identity_source, "frontmatter")
  assert.equal(paper.title_original, "Distributed Interval Optimization Over Time-Varying Networks")
  assert.equal(paper.doi_or_url, "https://openalex.org/W4387886124")
  assert.deepEqual({
    source_status: paper.source_status,
    evidence_status: paper.evidence_status,
    reproduction_status: paper.reproduction_status,
    note_status: paper.note_status,
    facet_states: paper.facet_states,
  }, {
    source_status: "not_checked",
    evidence_status: "none",
    reproduction_status: "none",
    note_status: "metadata_only",
    facet_states: {},
  })
  assert.equal(Object.values(paper.artifacts).flat().some((item) => item.file_name === "metadata.yaml"), false)
  assert.equal(result.audit.warnings.unrecognized_artifacts.includes("Candidate/metadata.yaml"), false)
  assert.deepEqual(result.audit.archive_identity_lookup, { "Wang23-DIO": "openalex:W4387886124" })
  for (const field of ["archive_source_id", "candidate_source", "openalex_id", "archive_identity"]) {
    assert.equal(Object.hasOwn(paper, field), false)
  }
})

test("reads metadata.yaml with O_NOFOLLOW and blocks metadata beyond the fixed size limit", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-safe-read-"))
  await put(root, "Candidate/metadata.yaml", archiveMetadata())
  let observedFlags = null
  const scanner = createPaperSourceScanner({
    metadataFileSystem: {
      open: async (path, flags) => {
        observedFlags = flags
        return openFile(path, flags)
      },
    },
  })
  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })
  assert.equal(result.papers.length, 1)
  if (typeof constants.O_NOFOLLOW === "number") {
    assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
  }

  const exactRoot = await mkdtemp(join(tmpdir(), "paper-metadata-exact-limit-"))
  await put(exactRoot, "Candidate/metadata.yaml", archiveMetadataAtBytes(8_000))
  assert.equal((await scan(exactRoot)).papers.length, 1)

  const oversizedRoot = await mkdtemp(join(tmpdir(), "paper-metadata-oversized-"))
  await put(oversizedRoot, "Candidate/metadata.yaml", `${archiveMetadata()}${"汉".repeat(2_700)}`)
  const error = await rejectedScan(() => scan(oversizedRoot))
  assert.equal(error.message, "扫描存在阻塞问题：frontmatter 元数据冲突")
  assert.deepEqual(error.blocking?.metadata_conflicts, ["main_papers::Candidate:metadata.yaml"])
})

test("fails closed when O_NOFOLLOW is unavailable or metadata bytes are invalid UTF-8", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  const noFollowRoot = await mkdtemp(join(tmpdir(), "paper-metadata-no-nofollow-"))
  await put(noFollowRoot, "Candidate/metadata.yaml", archiveMetadata())
  let opened = false
  const scanner = createPaperSourceScanner({
    metadataFileSystem: {
      noFollowFlag: null,
      open: async (path, flags) => {
        opened = true
        return openFile(path, flags)
      },
    },
  })
  const noFollowError = await rejectedScan(() => scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: noFollowRoot }] },
    overrides: { version: 1, papers: {} },
  }))
  assert.equal(opened, false)
  assert.deepEqual(noFollowError.blocking?.metadata_conflicts, ["main_papers::Candidate:metadata.yaml"])

  const invalidRoot = await mkdtemp(join(tmpdir(), "paper-metadata-invalid-utf8-"))
  const invalidBytes = Buffer.from(archiveMetadata(), "utf8")
  invalidBytes[invalidBytes.indexOf(Buffer.from("Distributed"))] = 0xff
  await put(invalidRoot, "Candidate/metadata.yaml", invalidBytes)
  const invalidError = await rejectedScan(() => scan(invalidRoot))
  assert.deepEqual(invalidError.blocking?.metadata_conflicts, ["main_papers::Candidate:metadata.yaml"])
})

test("ignores a metadata.yaml symlink instead of indexing or following it", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-symlink-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-metadata-outside-"))
  const outsideMetadata = await put(outside, "metadata.yaml", archiveMetadata())
  await mkdir(join(root, "Candidate"), { recursive: true })
  await symlink(outsideMetadata, join(root, "Candidate/metadata.yaml"))

  const result = await scan(root)
  assert.deepEqual(result.papers, [])
  assert.deepEqual(result.audit.warnings.external_symlinks, ["Candidate/metadata.yaml"])
})

test("ignores and audits an in-root metadata.yaml symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-internal-symlink-"))
  const target = await put(root, "holding/safe-metadata.txt", archiveMetadata())
  await mkdir(join(root, "Candidate"), { recursive: true })
  await symlink(target, join(root, "Candidate/metadata.yaml"))

  const result = await scan(root)
  assert.deepEqual(result.papers, [])
  assert.deepEqual(result.audit.warnings.internal_symlinks, ["Candidate/metadata.yaml"])
})

test("keeps one metadata identity when PDF and reading notes are added later", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-evolves-"))
  await put(root, "Candidate/metadata.yaml", archiveMetadata())
  await put(root, "Candidate/paper.pdf")
  await put(root, "Candidate/reading-note.md", "# Reading note")

  const result = await scan(root)
  const paper = result.papers[0]
  assert.equal(paper.paper_id, "Wang23-DIO")
  assert.equal(paper.note_status, "notes_ready")
  assert.equal(paper.artifacts.pdf.length, 1)
  assert.equal(paper.artifacts.note.length, 1)
  assert.deepEqual(result.audit.archive_identity_lookup, { "Wang23-DIO": "openalex:W4387886124" })
})

test("metadata participates in existing frontmatter conflict and higher-priority shadow rules", async () => {
  const equalRoot = await mkdtemp(join(tmpdir(), "paper-metadata-equal-"))
  await put(equalRoot, "Candidate/metadata.yaml", archiveMetadata())
  await put(equalRoot, "Candidate/reading-note.md", [
    "---",
    "paper_id: Wang23-DIO",
    "title: Distributed Interval Optimization Over Time-Varying Networks",
    "---",
  ].join("\n"))
  const equal = await scan(equalRoot)
  assert.equal(equal.papers[0].paper_id, "Wang23-DIO")
  assert.deepEqual(equal.audit.blocking.metadata_conflicts, [])

  const conflictRoot = await mkdtemp(join(tmpdir(), "paper-metadata-conflict-"))
  await put(conflictRoot, "Candidate/metadata.yaml", archiveMetadata())
  await put(conflictRoot, "Candidate/reading-note.md", "---\ntitle: Conflicting title\n---\n")
  const conflict = await rejectedScan(() => scan(conflictRoot))
  assert.deepEqual(conflict.blocking?.metadata_conflicts, ["main_papers::Candidate:title_original"])

  const shadowRoot = await mkdtemp(join(tmpdir(), "paper-metadata-shadow-"))
  await put(shadowRoot, "Candidate/metadata.yaml", archiveMetadata())
  await put(shadowRoot, "Candidate/reading-note.md", "---\ntitle: Conflicting title\n---\n")
  const shadow = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: shadowRoot }] },
    overrides: { version: 1, papers: {} },
    catalogs: {
      main_papers: {
        version: 1,
        papers: {
          "main_papers::Candidate": { paper_id: "Wang23-DIO", title_original: "Catalog title" },
        },
      },
    },
  })
  assert.equal(shadow.papers[0].title_original, "Catalog title")
  assert.deepEqual(shadow.audit.warnings.shadowed_metadata_conflicts, [
    "main_papers::Candidate:title_original:catalog",
  ])
})

test("blocks metadata whose archive source differs from the configured source", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-metadata-source-mismatch-"))
  await put(root, "Candidate/metadata.yaml", archiveMetadata({ archiveSourceId: "other_papers" }))

  const error = await rejectedScan(() => scan(root))
  assert.equal(error.message, "扫描存在阻塞问题：frontmatter 元数据冲突")
  assert.deepEqual(error.blocking?.metadata_conflicts, ["main_papers::Candidate:archive_source_id"])
  assert.equal(JSON.stringify(error.blocking).includes("other_papers"), false)
})

test("blocks one provider-qualified archive identity duplicated across configured sources", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-metadata-source-a-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-metadata-source-b-"))
  await put(firstRoot, "First/metadata.yaml", archiveMetadata({ paperId: "First23-Paper", archiveSourceId: "source_one" }))
  await put(secondRoot, "Second/metadata.yaml", archiveMetadata({
    paperId: "Second23-Paper",
    archiveSourceId: "source_two",
    doi: "10.1234/changed-record",
  }))

  const error = await rejectedScan(() => scanPaperSources({
    config: {
      version: 1,
      sources: [
        { source_id: "source_one", path: firstRoot },
        { source_id: "source_two", path: secondRoot },
      ],
    },
    overrides: { version: 1, papers: {} },
  }))
  assert.equal(error.message, "扫描存在阻塞问题：归档来源身份重复")
  assert.deepEqual(error.blocking?.duplicate_archive_source_ids, ["openalex:W4387886124"])
})

test("warns and refuses to read a symlink that resolves outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-outside-"))
  await put(outside, "secret.pdf")
  await mkdir(join(root, "Linked Paper"), { recursive: true })
  await symlink(join(outside, "secret.pdf"), join(root, "Linked Paper", "secret.pdf"))

  const result = await scan(root)
  assert.equal(result.papers.length, 0)
  assert.deepEqual(result.audit.warnings.external_symlinks, ["Linked Paper/secret.pdf"])
})

test("binds Markdown validation to O_NOFOLLOW open before parsing frontmatter", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  assert.equal(typeof createPaperSourceScanner, "function")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-race-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-markdown-outside-"))
  await put(root, "Paper/paper.pdf")
  const notePath = await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  const outsideNote = await put(outside, "outside.md", "---\npaper_id: Outside-01\n---\n")
  const backupPath = join(root, "Paper/note-before-open.md")
  let observedFlags = null
  let readCalls = 0
  let replaced = false
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      open: async (path, flags) => {
        observedFlags = flags
        if (!replaced) {
          replaced = true
          await rename(notePath, backupPath)
          await symlink(outsideNote, notePath)
        }
        const handle = await openFile(path, flags)
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => { readCalls += 1; return handle.read(...args) },
          close: () => handle.close(),
        }
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.notEqual(result.papers[0].paper_id, "Outside-01")
  assert.deepEqual(result.audit.warnings.unsafe_markdown, ["Paper/note.md"])
  assert.equal(readCalls, 0)
  if (typeof constants.O_NOFOLLOW === "number") {
    assert.equal(observedFlags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
  }
})

test("fails closed without opening Markdown when O_NOFOLLOW is unavailable", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-no-nofollow-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  let opened = false
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      noFollowFlag: null,
      open: async (path, flags) => {
        opened = true
        return openFile(path, flags)
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(opened, false)
  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.deepEqual(result.audit.warnings.unsafe_markdown, ["Paper/note.md"])
})

test("checks the opened handle fingerprint before reading a different regular file", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-handle-swap-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-markdown-handle-outside-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  const outsideNote = await put(outside, "outside.md", "---\npaper_id: Outside-01\n---\n")
  let readCalls = 0
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      open: async () => {
        const handle = await openFile(outsideNote, "r")
        return {
          stat: (...args) => handle.stat(...args),
          read: (...args) => { readCalls += 1; return handle.read(...args) },
          close: () => handle.close(),
        }
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(readCalls, 0)
  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.deepEqual(result.audit.warnings.unsafe_markdown, ["Paper/note.md"])
})

test("rejects size and mtime changes to the opened Markdown inode during reading", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-inode-change-"))
  await put(root, "Paper/paper.pdf")
  const notePath = await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      open: async (path, flags) => {
        const handle = await openFile(path, flags)
        return {
          stat: (...args) => handle.stat(...args),
          read: async (...args) => {
            const result = await handle.read(...args)
            await appendFile(notePath, "changed")
            return result
          },
          close: () => handle.close(),
        }
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.deepEqual(result.audit.warnings.unsafe_markdown, ["Paper/note.md"])
})

test("discards Markdown metadata when its path changes while the handle is open", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  assert.equal(typeof createPaperSourceScanner, "function")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-race-"))
  const outside = await mkdtemp(join(tmpdir(), "paper-markdown-outside-"))
  await put(root, "Paper/paper.pdf")
  const notePath = await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  const outsideNote = await put(outside, "outside.md", "---\npaper_id: Outside-01\n---\n")
  const backupPath = join(root, "Paper/note-during-read.md")
  let replaced = false
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      open: async (path, flags) => {
        const handle = await openFile(path, flags)
        return {
          stat: (...args) => handle.stat(...args),
          read: async (...args) => {
            const result = await handle.read(...args)
            if (!replaced) {
              replaced = true
              await rename(notePath, backupPath)
              await symlink(outsideNote, notePath)
            }
            return result
          },
          close: () => handle.close(),
        }
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.notEqual(result.papers[0].paper_id, "Inside-01")
  assert.notEqual(result.papers[0].paper_id, "Outside-01")
  assert.deepEqual(result.audit.warnings.unsafe_markdown, ["Paper/note.md"])
})

test("closes the Markdown handle in finally when prefix reading fails", async () => {
  const { createPaperSourceScanner } = await import("./scanner.mjs")
  assert.equal(typeof createPaperSourceScanner, "function")
  const root = await mkdtemp(join(tmpdir(), "paper-markdown-read-error-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/note.md", "---\npaper_id: Inside-01\n---\n")
  let closed = false
  const scanner = createPaperSourceScanner({
    markdownFileSystem: {
      open: async (path, flags) => {
        const handle = await openFile(path, flags)
        return {
          stat: (...args) => handle.stat(...args),
          read: async () => { throw new Error("injected read failure") },
          close: async () => { closed = true; await handle.close() },
        }
      },
    },
  })

  const result = await scanner({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
  })

  assert.equal(closed, true)
  assert.equal(result.papers[0].identity_source, "path_hash")
  assert.deepEqual(result.audit.warnings.unreadable_markdown, ["Paper/note.md"])
})

test("moving the configured source root preserves a path-hash ID", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-root-a-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-root-b-"))
  await put(firstRoot, "Same Relative Paper/paper.pdf")
  await put(secondRoot, "Same Relative Paper/paper.pdf")
  const first = await scan(firstRoot)
  const second = await scan(secondRoot)
  assert.equal(first.papers[0].paper_id, second.papers[0].paper_id)
  assert.equal(first.papers[0].identity_source, "path_hash")
})

test("catalog identity replaces a misleading hyphenated filename token", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-catalog-identity-"))
  await put(root, "Paper Unit/First-Order algorithm.pdf", "pdf")
  const config = { version: 1, sources: [{ source_id: "main_papers", path: root }] }
  const overrides = { version: 1, papers: {} }
  const catalogs = {
    main_papers: {
      version: 1,
      papers: {
        "main_papers::Paper Unit": {
          paper_id: "Shi15-EXTRA", title_original: "EXTRA", year: 2015,
          publication_year: 2015, authors: ["Shi W"], venue: "SIAM", doi_or_url: "",
          metadata_provenance: { paper_id: "catalog" },
        },
      },
      warnings: [],
    },
  }

  const result = await scanPaperSources({ config, overrides, catalogs })

  assert.equal(result.papers[0].paper_id, "Shi15-EXTRA")
  assert.equal(result.papers[0].identity_source, "catalog")
  assert.equal(result.papers[0].title_original, "EXTRA")
  assert.equal(result.papers[0].publication_year, 2015)
  assert.equal(result.papers[0].metadata_provenance.paper_id, "catalog")
})

test("an arbitrary hyphenated filename never becomes paper_id", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-hyphenated-name-"))
  await put(root, "Paper Unit/First-Order algorithm.pdf", "pdf")

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
    catalogs: {},
  })

  assert.match(result.papers[0].paper_id, /^LIB-[A-F0-9]{12}$/)
  assert.equal(result.papers[0].identity_source, "path_hash")
})

test("a canonical deep-reading note shortcode is an identity fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-note-shortcode-"))
  await put(root, "Paper Unit/paper.pdf", "pdf")
  await put(root, "Paper Unit/Shi15-EXTRA_论文精读.md", "# note")

  const result = await scan(root)

  assert.equal(result.papers[0].paper_id, "Shi15-EXTRA")
  assert.equal(result.papers[0].identity_source, "note_shortcode")
  assert.equal(result.papers[0].metadata_provenance.paper_id, "note_shortcode")
})

test("conflicting canonical note shortcodes block instead of selecting the first", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-note-shortcode-conflict-"))
  await put(root, "Paper Unit/paper.pdf", "pdf")
  await put(root, "Paper Unit/Alpha01-FIRST_论文精读.md", "# first")
  await put(root, "Paper Unit/Beta02-SECOND_论文精读.md", "# second")

  await assert.rejects(() => scan(root), /笔记短码冲突/)
})

test("folder hierarchy never becomes semantic classification", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-physical-hierarchy-"))
  await put(root, "02_约束分布式优化/耦合约束/Unit/paper.pdf", "pdf")

  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
    catalogs: {},
  })

  assert.equal(result.papers[0].topic_l1, "")
  assert.equal(result.papers[0].topic_l2, "")
  assert.deepEqual(result.papers[0].research_scopes, [])
})

test("rejects equal canonical source roots even when one path is a symlink alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-source-canonical-"))
  const aliasParent = await mkdtemp(join(tmpdir(), "paper-source-alias-"))
  const alias = join(aliasParent, "alias")
  await put(root, "Paper/paper.pdf")
  await symlink(root, alias)

  await assert.rejects(() => scanPaperSources({
    config: {
      version: 1,
      sources: [
        { source_id: "source_one", path: root },
        { source_id: "source_two", path: alias },
      ],
    },
    overrides: { version: 1, papers: {} },
  }), /来源根目录重复或重叠/)
})

test("treats a Windows cross-volume target as outside its source root", async () => {
  const { isPathInsideRoot } = await import("./scanner.mjs")
  assert.equal(typeof isPathInsideRoot, "function")
  const sourceRoot = ["C:", "papers"].join("\\")
  const crossVolume = ["D:", "other"].join("\\")
  assert.equal(isPathInsideRoot(sourceRoot, crossVolume, win32), false)
  assert.equal(isPathInsideRoot(sourceRoot, [sourceRoot, "Paper"].join("\\"), win32), true)
})

test("rejects ancestor and descendant canonical source roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-source-overlap-"))
  const nested = join(root, "Nested")
  await put(root, "Outer/paper.pdf")
  await put(nested, "Inner/paper.pdf")

  await assert.rejects(() => scanPaperSources({
    config: {
      version: 1,
      sources: [
        { source_id: "source_parent", path: root },
        { source_id: "source_child", path: nested },
      ],
    },
    overrides: { version: 1, papers: {} },
  }), /来源根目录重复或重叠/)
})

test("accepts multiple non-overlapping canonical source roots", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-source-one-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-source-two-"))
  await put(firstRoot, "First/paper.pdf")
  await put(secondRoot, "Second/paper.pdf")

  const result = await scanPaperSources({
    config: {
      version: 1,
      sources: [
        { source_id: "source_one", path: firstRoot },
        { source_id: "source_two", path: secondRoot },
      ],
    },
    overrides: { version: 1, papers: {} },
  })

  assert.deepEqual(result.papers.map((paper) => paper.source_id), ["source_one", "source_two"])
  assert.equal(result.audit.sources.length, 2)
})

test("renaming an internal directory preserves an explicit frontmatter ID", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-root-a-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-root-b-"))
  await put(firstRoot, "Old Name/paper.pdf")
  await put(firstRoot, "Old Name/note.md", "---\npaper_id: Xi18-ADDOPT\n---\n")
  await put(secondRoot, "New Name/paper.pdf")
  await put(secondRoot, "New Name/note.md", "---\npaper_id: Xi18-ADDOPT\n---\n")
  const first = await scan(firstRoot)
  const second = await scan(secondRoot)
  assert.equal(first.papers[0].paper_id, "Xi18-ADDOPT")
  assert.equal(second.papers[0].paper_id, "Xi18-ADDOPT")
  assert.equal(first.papers[0].identity_source, "frontmatter")
})

test("blocks a path-hash ID reused by override, frontmatter, or note-shortcode identity", async () => {
  const cases = [
    {
      label: "override",
      arrange: async (root, duplicateId) => ({
        version: 1,
        papers: { "main_papers::Collision": { paper_id: duplicateId } },
      }),
    },
    {
      label: "frontmatter",
      arrange: async (root, duplicateId) => {
        await put(root, "Collision/note.md", `---\npaper_id: ${duplicateId}\n---\n`)
        return { version: 1, papers: {} }
      },
    },
    {
      label: "note_shortcode",
      arrange: async (root, duplicateId) => {
        await put(root, `Collision/${duplicateId}_论文精读.md`)
        return { version: 1, papers: {} }
      },
    },
  ]

  for (const fixture of cases) {
    const root = await mkdtemp(join(tmpdir(), "paper-id-collision-"))
    await put(root, "Hashed/paper.pdf")
    await put(root, "Collision/paper.pdf")
    const duplicateId = makePathPaperId({ sourceId: "main_papers", relativePath: "Hashed" })
    const overrides = await fixture.arrange(root, duplicateId)
    const error = await rejectedScan(() => scan(root, overrides))

    assert.match(error.message, /重复论文 ID/, fixture.label)
    assert.deepEqual(error.blocking?.duplicate_ids, [duplicateId], fixture.label)
    assert.deepEqual(error.blocking?.duplicate_explicit_ids, [], fixture.label)
    assert.deepEqual(error.blocking?.slug_collisions, [], fixture.label)
  }
})

test("keeps duplicate final IDs separate from distinct-ID slug collisions", async () => {
  const duplicateRoot = await mkdtemp(join(tmpdir(), "paper-id-collision-"))
  await put(duplicateRoot, "First/paper.pdf")
  await put(duplicateRoot, "Second/paper.pdf")
  const duplicateError = await rejectedScan(() => scan(duplicateRoot, {
    version: 1,
    papers: {
      "main_papers::First": { paper_id: "Same-01" },
      "main_papers::Second": { paper_id: "Same-01" },
    },
  }))
  assert.deepEqual(duplicateError.blocking?.duplicate_ids, ["Same-01"])
  assert.deepEqual(duplicateError.blocking?.duplicate_explicit_ids, ["Same-01"])
  assert.deepEqual(duplicateError.blocking?.slug_collisions, [])

  const slugRoot = await mkdtemp(join(tmpdir(), "paper-slug-collision-"))
  await put(slugRoot, "First/paper.pdf")
  await put(slugRoot, "Second/paper.pdf")
  const slugError = await rejectedScan(() => scan(slugRoot, {
    version: 1,
    papers: {
      "main_papers::First": { paper_id: "Alpha-01" },
      "main_papers::Second": { paper_id: "ALPHA-01" },
    },
  }))
  assert.match(slugError.message, /slug 冲突/)
  assert.deepEqual(slugError.blocking?.duplicate_ids, [])
  assert.deepEqual(slugError.blocking?.duplicate_explicit_ids, [])
  assert.deepEqual(slugError.blocking?.slug_collisions, ["alpha-01"])
})

test("classifies every supported artifact category with ordered, path-aware rules", () => {
  const cases = [
    ["scan.pdf", "pdf"], ["source_map.md", "source_map"], ["复现报告.md", "reproduction_report"],
    ["simulation.md", "simulation"], ["代码对比.md", "code_compare"], ["run.py", "script"],
    ["results/plot.PNG", "result"], ["推导过程.md", "derivation"], ["modeling.md", "modeling"],
    ["论文精读.md", "note"], ["paper_zh.md", "translation"], ["paper.md", "ocr"],
  ]
  for (const [relativePath, expected] of cases) {
    assert.equal(classifyArtifact({ relativePath, siblingPdfStems: ["paper"] }), expected, relativePath)
  }
  assert.equal(classifyArtifact({ relativePath: "中文题名.md", siblingPdfStems: ["paper"] }), null)
  assert.equal(classifyArtifact({ relativePath: "paper.pdf", explicitCategory: "translation" }), "translation")
  assert.deepEqual(summarizeArtifactAvailability({ pdf: [{}], note: [], script: [{}] }), { pdf: true, note: false, script: true })
})

test("does not classify translation logs or OCR bodies as reading notes", () => {
  assert.equal(classifyArtifact({ relativePath: "translation.log", siblingPdfStems: [] }), null)
  assert.equal(classifyArtifact({ relativePath: "Paper Title.md", siblingPdfStems: ["Paper Title"] }), "ocr")
  assert.equal(classifyArtifact({ relativePath: "Paper01_论文精读_中文翻译.md", siblingPdfStems: [] }), "translation")
  assert.equal(classifyArtifact({ relativePath: "Paper01_论文精读.md", siblingPdfStems: ["Paper Title"] }), "note")
})

test("classifies legacy dependency and suffix reading-note Markdown without capturing OCR, translations, or non-Markdown", () => {
  const cases = [
    ["依赖式精读笔记.md", "note"],
    ["archive/依赖式精读-v2.md", "note"],
    ["archive/旧稿_精读.md", "note"],
    ["archive/旧稿_精读.markdown", "note"],
    ["archive/paper_OCR_精读.md", "ocr"],
    ["archive/旧稿_中文翻译_精读.md", "translation"],
    ["archive/旧稿_精读.txt", null],
  ]
  for (const [relativePath, expected] of cases) {
    assert.equal(classifyArtifact({ relativePath, siblingPdfStems: [] }), expected, relativePath)
  }
})

test("an explicit note category cannot override non-note eligibility", () => {
  const cases = [
    [{ relativePath: "Paper.md", siblingPdfStems: ["Paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "Paper.markdown", siblingPdfStems: ["Paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "paper_OCR.md", siblingPdfStems: ["paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "paper-ocr.md", siblingPdfStems: ["paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "paper-ocr.markdown", siblingPdfStems: ["paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "PaPeR_oCr.md", siblingPdfStems: ["paper"], explicitCategory: "note" }, "ocr"],
    [{ relativePath: "Paper_中文翻译.md", siblingPdfStems: [], explicitCategory: "note" }, "translation"],
    [{ relativePath: "proof-notes.md", siblingPdfStems: [], explicitCategory: "note" }, "derivation"],
    [{ relativePath: "simulation.md", siblingPdfStems: [], explicitCategory: "note" }, "simulation"],
    [{ relativePath: "translation.log", siblingPdfStems: [], explicitCategory: "note" }, null],
    [{ relativePath: "paper.pdf", siblingPdfStems: ["paper"], explicitCategory: "note" }, "pdf"],
    [{ relativePath: "run.py", siblingPdfStems: [], explicitCategory: "note" }, "script"],
    [{ relativePath: "historical.md", siblingPdfStems: ["paper"], explicitCategory: "note" }, "note"],
  ]
  for (const [input, expected] of cases) assert.equal(classifyArtifact(input), expected, input.relativePath)
})

test("blocks forbidden note artifact overrides with and without preferred_note", async () => {
  const cases = [
    { label: "sibling-ocr", pdf: "Paper.pdf", candidate: "Paper.md", pathOnly: false, expected: /笔记覆盖目标无效/ },
    { label: "sibling-ocr-markdown", pdf: "Paper.pdf", candidate: "Paper.markdown", pathOnly: false, expected: /笔记覆盖目标无效/ },
    { label: "underscore-ocr", pdf: "paper.pdf", candidate: "paper_OCR.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "hyphen-ocr", pdf: "paper.pdf", candidate: "paper-ocr.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "mixed-case-ocr", pdf: "paper.pdf", candidate: "PaPeR_oCr.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "translation", pdf: "paper.pdf", candidate: "Paper_中文翻译.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "derivation", pdf: "paper.pdf", candidate: "proof-notes.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "simulation", pdf: "paper.pdf", candidate: "simulation.md", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "log", pdf: "paper.pdf", candidate: "translation.log", pathOnly: true, expected: /artifact_overrides\.note/ },
    { label: "non-markdown", pdf: "paper.pdf", candidate: "legacy-note.txt", pathOnly: true, expected: /artifact_overrides\.note/ },
  ]

  for (const fixture of cases) {
    for (const withPreferred of [false, true]) {
      const root = await mkdtemp(join(tmpdir(), `paper-forbidden-note-${fixture.label}-`))
      await put(root, `Paper/${fixture.pdf}`, "pdf")
      await put(root, `Paper/${fixture.candidate}`, "PRIVATE_FORBIDDEN_BODY")
      const override = {
        paper_id: "Probe-01",
        artifact_overrides: { note: [`Paper/${fixture.candidate}`] },
        ...(withPreferred ? { preferred_note: fixture.candidate } : {}),
      }
      const error = await rejectedScan(() => scan(root, {
        version: 1,
        papers: { "main_papers::Paper": override },
      }))

      const expected = withPreferred && fixture.pathOnly ? /preferred_note/ : fixture.expected
      assert.match(error.message, expected, `${fixture.label}:${withPreferred}`)
      assert.equal(error.message.includes("PRIVATE_FORBIDDEN_BODY"), false)
    }
  }
})

test("blocks an explicitly preferred OCR body even without a note artifact override", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-forbidden-preferred-ocr-"))
  await put(root, "Paper/Paper.pdf", "pdf")
  await put(root, "Paper/Paper.md", "PRIVATE_OCR_BODY")
  const error = await rejectedScan(() => scan(root, {
    version: 1,
    papers: {
      "main_papers::Paper": { paper_id: "Probe-01", preferred_note: "Paper.md" },
    },
  }))

  assert.equal(error.message, "扫描存在阻塞问题：首选笔记目标无效")
  assert.deepEqual(error.blocking?.invalid_preferred_notes, ["main_papers::Paper"])
  assert.equal(error.message.includes("PRIVATE_OCR_BODY"), false)
})

test("preserves an unambiguous Markdown historical-note override", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-valid-note-override-"))
  await put(root, "Paper/paper.pdf", "pdf")
  await put(root, "Paper/historical.md", "# historical note")
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::Paper": {
        paper_id: "Probe-01",
        artifact_overrides: { note: ["Paper/historical.md"] },
        preferred_note: "historical.md",
      },
    },
  })

  assert.equal(result.papers[0].note_status, "notes_ready")
  assert.equal(result.papers[0].preferred_note, "historical.md")
  assert.deepEqual(result.papers[0].artifacts.note.map((item) => item.relative_path), ["historical.md"])
})

test("excludes only the exact configured unit and audits the reason", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-exclusion-"))
  await put(root, "Continuous Paper/paper.pdf", "pdf")
  await put(root, "Continuous Paper/a.md", "---\ntitle: A\n---")
  await put(root, "Continuous Paper/z.md", "---\ntitle: Z\n---")
  await put(root, "Continuous Mention/paper.pdf", "pdf")
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::Continuous Paper": {
        include: false,
        exclude_reason: "continuous_time_out_of_scope",
      },
    },
  })

  assert.deepEqual(result.papers.map((paper) => paper.relative_path), ["Continuous Mention"])
  assert.deepEqual(result.audit.excluded_units, [{
    source_id: "main_papers",
    relative_path: "Continuous Paper",
    reason: "continuous_time_out_of_scope",
  }])
})

test("classifies note, OCR, PDF-only, and metadata-only units without upgrading evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-note-status-"))
  await put(root, "A Notes/paper.pdf", "pdf")
  await put(root, "A Notes/Notes-01_论文精读.md", "# note")
  await put(root, "B OCR/OCR Body.pdf", "pdf")
  await put(root, "B OCR/OCR Body.md", "ocr")
  await put(root, "C PDF/paper.pdf", "pdf")
  await mkdir(join(root, "D Metadata"), { recursive: true })
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::D Metadata": { paper_id: "Metadata-01", unit_type: "review" },
    },
  })

  assert.deepEqual(result.papers.map((paper) => paper.note_status), [
    "notes_ready", "ocr_only", "pdf_only", "metadata_only",
  ])
  assert.ok(result.papers.every((paper) => paper.evidence_status === "none"))
})

test("selects an explicit note, then a unique canonical note, then a unique historical reading note", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-preferred-note-"))
  await put(root, "A Explicit/paper.pdf", "pdf")
  await put(root, "A Explicit/first-reading-note.md", "first")
  await put(root, "A Explicit/second-reading-note.md", "second")
  await put(root, "B Canonical/paper.pdf", "pdf")
  await put(root, "B Canonical/Canonical-01_论文精读.md", "canonical")
  await put(root, "B Canonical/old-reading-note.md", "old")
  await put(root, "C Historical/paper.pdf", "pdf")
  await put(root, "C Historical/legacy-reading-note.md", "legacy")
  await put(root, "D Ambiguous/paper.pdf", "pdf")
  await put(root, "D Ambiguous/first-reading-note.md", "first")
  await put(root, "D Ambiguous/second-reading-note.md", "second")
  await put(root, "E OCR/Paper.pdf", "pdf")
  await put(root, "E OCR/Paper.md", "ocr")
  await put(root, "E OCR/OCR-01_论文精读_中文翻译.md", "translation")

  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::A Explicit": { paper_id: "Explicit-01", preferred_note: "second-reading-note.md" },
      "main_papers::B Canonical": { paper_id: "Canonical-01" },
      "main_papers::C Historical": { paper_id: "Historical-01" },
      "main_papers::D Ambiguous": { paper_id: "Ambiguous-01" },
      "main_papers::E OCR": { paper_id: "OCR-01" },
    },
  })

  assert.deepEqual(result.papers.map((paper) => paper.preferred_note), [
    "second-reading-note.md",
    "Canonical-01_论文精读.md",
    "legacy-reading-note.md",
    null,
    null,
  ])
})

test("collects complete descendant artifacts, but never absorbs a nested unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Parent/paper.pdf")
  await put(root, "Parent/work/run.py")
  await put(root, "Parent/results/plot.png")
  await put(root, "Parent/Nested/nested.pdf")
  const result = await scan(root)
  const parent = result.papers.find((paper) => paper.relative_path === "Parent")
  assert.equal(result.papers.length, 2)
  assert.deepEqual(parent.artifacts.pdf.map((item) => item.relative_path), ["paper.pdf"])
  assert.equal(parent.artifacts.script.length, 1)
  assert.equal(parent.artifacts.result.length, 1)
})

test("uses explicit artifact overrides for a Chinese-title translation and warns without one", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/中文题名.md")
  const withoutOverride = await scan(root)
  assert.deepEqual(withoutOverride.papers[0].artifacts.translation, [])
  assert.equal(withoutOverride.audit.warnings.unrecognized_artifacts.length, 1)

  const withOverride = await scan(root, {
    version: 1,
    papers: { "main_papers::Paper": { artifact_overrides: { translation: ["Paper/中文题名.md"] } } },
  })
  assert.equal(withOverride.papers[0].artifacts.translation[0].relative_path, "中文题名.md")
})

test("reads scalar aliases and list aliases from safe frontmatter only", () => {
  const parsed = parsePaperFrontmatter(`---
title: "An English Title"
title_zh: 中文标题
year: 2024
doi: https://doi.org/example
unit_type: article
p02_relevance: 3
research_scope: ["scope a", scope-b]
authors:
  - Alice
  - "Bob"
method_tags: [tracking]
unknown: ignored
---
body`)
  assert.deepEqual(parsed.data, {
    title_original: "An English Title", title_zh: "中文标题", year: 2024, doi_or_url: "https://doi.org/example",
    unit_type: "article", p02_relevance: 3, research_scopes: ["scope a", "scope-b"], authors: ["Alice", "Bob"], method_tags: ["tracking"],
  })
  assert.deepEqual(parsed.warnings, ["unknown"])
})

test("frontmatter ignores unsafe or invalid YAML constructs", () => {
  const parsed = parsePaperFrontmatter("---\nyear: 24\nunit_type: booklet\np02_relevance: 4\nauthors: &x [Alice]\nmeta:\n  key: value\n---")
  assert.deepEqual(parsed.data, {})
  assert.deepEqual(parsed.warnings, ["year", "unit_type", "p02_relevance", "authors", "meta"])
})

test("keeps formal states conservative and records unreadable Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/paper.md", Buffer.from([0xff, 0xfe]))
  const result = await scan(root)
  const paper = result.papers[0]
  assert.equal(paper.source_status, "not_checked")
  assert.equal(paper.evidence_status, "none")
  assert.equal(paper.reproduction_status, "none")
  assert.equal(paper.writing_material_count, 0)
  assert.equal(result.audit.warnings.unreadable_markdown.length, 1)
})

test("rejects an invalid frontmatter paper_id instead of letting it replace the record identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/note.md", "---\npaper_id: ../escape\n---")
  const result = await scan(root)
  assert.match(result.papers[0].paper_id, /^LIB-/)
  assert.equal(Object.hasOwn(result.papers[0], "paper_id"), true)
  assert.ok(result.audit.warnings.broken_paths.some((warning) => warning.endsWith(":paper_id")))
})

test("rejects conflicting valid frontmatter paper IDs within one paper unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/one.md", "---\npaper_id: Alpha-01\n---")
  await put(root, "Paper/two.md", "---\npaper_id: Beta-02\n---")
  await assert.rejects(() => scan(root), /frontmatter paper_id 冲突/)
})

test("blocks conflicting scalar frontmatter metadata without exposing either value", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-scalar-conflict-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\ntitle: Alpha title\n---")
  await put(root, "Paper/z.md", "---\ntitle: Zeta title\n---")

  const error = await rejectedScan(() => scan(root))

  assert.equal(error.message, "扫描存在阻塞问题：frontmatter 元数据冲突")
  assert.deepEqual(error.blocking?.metadata_conflicts, ["main_papers::Paper:title_original"])
  assert.equal(error.message.includes("Alpha title"), false)
  assert.equal(error.message.includes("Zeta title"), false)
})

test("blocks structurally distinct list frontmatter metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-list-conflict-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\nauthors: [Alice, Bob]\n---")
  await put(root, "Paper/z.md", "---\nauthors: [Alice, Carol]\n---")

  const error = await rejectedScan(() => scan(root))

  assert.equal(error.message, "扫描存在阻塞问题：frontmatter 元数据冲突")
  assert.deepEqual(error.blocking?.metadata_conflicts, ["main_papers::Paper:authors"])
})

test("catalog scalar metadata shadows only its exact frontmatter conflict and records a value-free warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-catalog-shadow-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\ntitle: Auxiliary A\n---")
  await put(root, "Paper/z.md", "---\ntitle: Auxiliary Z\n---")
  const result = await scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
    catalogs: {
      main_papers: {
        version: 1,
        papers: { "main_papers::Paper": { paper_id: "Paper-01", title_original: "Catalog title" } },
        warnings: [],
      },
    },
  })

  assert.equal(result.papers[0].title_original, "Catalog title")
  assert.deepEqual(result.audit.blocking.metadata_conflicts, [])
  assert.deepEqual(result.audit.warnings.shadowed_metadata_conflicts, [
    "main_papers::Paper:title_original:catalog",
  ])
  assert.equal(JSON.stringify(result.audit).includes("Auxiliary A"), false)
  assert.equal(JSON.stringify(result.audit).includes("Auxiliary Z"), false)
})

test("override list metadata shadows only its exact frontmatter conflict and records the winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-override-shadow-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\nauthors: [Alice, Bob]\n---")
  await put(root, "Paper/z.md", "---\nauthors: [Alice, Carol]\n---")
  const result = await scan(root, {
    version: 1,
    papers: { "main_papers::Paper": { paper_id: "Paper-01", authors: ["Override Author"] } },
  })

  assert.deepEqual(result.papers[0].authors, ["Override Author"])
  assert.deepEqual(result.audit.blocking.metadata_conflicts, [])
  assert.deepEqual(result.audit.warnings.shadowed_metadata_conflicts, [
    "main_papers::Paper:authors:override",
  ])
})

test("catalog title shadowing does not suppress an unrelated frontmatter author conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-per-field-shadow-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\ntitle: Auxiliary A\nauthors: [Alice, Bob]\n---")
  await put(root, "Paper/z.md", "---\ntitle: Auxiliary Z\nauthors: [Alice, Carol]\n---")
  const error = await rejectedScan(() => scanPaperSources({
    config: { version: 1, sources: [{ source_id: "main_papers", path: root }] },
    overrides: { version: 1, papers: {} },
    catalogs: {
      main_papers: {
        version: 1,
        papers: { "main_papers::Paper": { paper_id: "Paper-01", title_original: "Catalog title" } },
        warnings: [],
      },
    },
  }))

  assert.equal(error.message, "扫描存在阻塞问题：frontmatter 元数据冲突")
  assert.deepEqual(error.blocking?.metadata_conflicts, ["main_papers::Paper:authors"])
})

test("allows repeated structurally equal scalar and list frontmatter metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-frontmatter-equal-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/a.md", "---\ntitle: Same title\nauthors: [Alice, Bob]\n---")
  await put(root, "Paper/z.md", "---\ntitle: Same title\nauthors: [Alice, Bob]\n---")

  const result = await scan(root)

  assert.equal(result.papers[0].title_original, "Same title")
  assert.deepEqual(result.papers[0].authors, ["Alice", "Bob"])
  assert.deepEqual(result.audit.blocking.metadata_conflicts, [])
})

test("rejects in-root file symlinks that target another paper unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "First/paper.pdf")
  await put(root, "Second/paper.pdf")
  const target = await put(root, "Second/reading-note.md", "# second")
  await symlink(target, join(root, "First/reading-note.md"))
  const result = await scan(root)
  const first = result.papers.find((paper) => paper.relative_path === "First")
  assert.equal(first.artifacts.note.length, 0)
  assert.ok(result.audit.warnings.broken_paths.includes("First/reading-note.md"))
})

test("skips an in-unit Markdown symlink alias while keeping its canonical note once", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  const target = await put(root, "Paper/主笔记_论文精读.md", "# canonical")
  await symlink(target, join(root, "Paper/旧入口_论文精读.md"))

  const result = await scan(root, {
    version: 1,
    papers: { "main_papers::Paper": { paper_id: "Paper-01" } },
  })
  const paper = result.papers.find((item) => item.paper_id === "Paper-01")

  assert.deepEqual(paper.artifacts.note.map((item) => item.relative_path), ["主笔记_论文精读.md"])
  assert.ok(result.audit.warnings.internal_symlinks.includes("Paper/旧入口_论文精读.md"))
})

test("skips in-root directory symlinks without traversing their descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "First/paper.pdf")
  const targetDirectory = join(root, "Second")
  await put(root, "Second/reading-note.md", "# second")
  await symlink(targetDirectory, join(root, "First/linked"))
  const result = await scan(root)
  const first = result.papers[0]
  assert.equal(first.artifacts.note.length, 0)
  assert.ok(result.audit.warnings.internal_symlinks.includes("First/linked"))
})

test("skips an in-root directory alias so its canonical PDF unit remains indexed once", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await mkdir(join(root, "First"), { recursive: true })
  await put(root, "Second/paper.pdf")
  await symlink(join(root, "Second"), join(root, "First/linked"))
  const result = await scan(root)
  assert.deepEqual(result.papers.map((paper) => paper.relative_path), ["Second"])
  assert.deepEqual(result.audit.warnings.internal_symlinks, ["First/linked"])
})

test("frontmatter-declared thesis parents descendant PDF leaves as chapters", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Thesis/thesis.pdf")
  await put(root, "Thesis/note.md", "---\npaper_id: Thesis-01\nunit_type: thesis\n---")
  await put(root, "Thesis/Chapter/chapter.pdf")
  const result = await scan(root)
  const parent = result.papers.find((paper) => paper.paper_id === "Thesis-01")
  const chapter = result.papers.find((paper) => paper.relative_path === "Thesis/Chapter")
  assert.equal(parent.unit_type, "thesis")
  assert.equal(chapter.unit_type, "chapter")
  assert.equal(chapter.parent_paper_id, "Thesis-01")
})

test("nested child override clears hierarchy-derived type and parent with matching provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-hierarchy-override-"))
  await put(root, "Thesis/thesis.pdf")
  await put(root, "Thesis/Child/paper.pdf")
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::Thesis": { paper_id: "Thesis-01", unit_type: "thesis" },
      "main_papers::Thesis/Child": { paper_id: "Child-01", unit_type: "article", parent_paper_id: null },
    },
  })

  const child = result.papers.find((paper) => paper.paper_id === "Child-01")
  assert.equal(child.unit_type, "article")
  assert.equal(child.parent_paper_id, null)
  assert.equal(child.metadata_provenance.unit_type, "override")
  assert.equal(child.metadata_provenance.parent_paper_id, "override")
})

test("accepts a same-source manual thesis and chapter relationship", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-parent-valid-"))
  await put(root, "Parent/paper.pdf")
  await put(root, "Child/paper.pdf")
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::Parent": { paper_id: "Thesis-01", unit_type: "thesis" },
      "main_papers::Child": { paper_id: "Chapter-01", unit_type: "chapter", parent_paper_id: "Thesis-01" },
    },
  })

  const chapter = result.papers.find((paper) => paper.paper_id === "Chapter-01")
  assert.equal(chapter.unit_type, "chapter")
  assert.equal(chapter.parent_paper_id, "Thesis-01")
})

test("blocks a chapter whose named parent does not exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-parent-missing-"))
  await put(root, "Child/paper.pdf")
  const error = await rejectedScan(() => scan(root, {
    version: 1,
    papers: {
      "main_papers::Child": { paper_id: "Chapter-01", unit_type: "chapter", parent_paper_id: "Missing-01" },
    },
  }))

  assert.match(error.message, /父项不存在/)
  assert.deepEqual(error.blocking?.parent_relationships, ["missing_parent:Chapter-01->Missing-01"])
})

test("blocks self-parenting and parent cycles", async () => {
  const selfRoot = await mkdtemp(join(tmpdir(), "paper-parent-self-"))
  await put(selfRoot, "Self/paper.pdf")
  const selfError = await rejectedScan(() => scan(selfRoot, {
    version: 1,
    papers: {
      "main_papers::Self": { paper_id: "Self-01", unit_type: "chapter", parent_paper_id: "Self-01" },
    },
  }))
  assert.match(selfError.message, /自引用/)
  assert.ok(selfError.blocking?.parent_relationships.includes("self_parent:Self-01"))

  const cycleRoot = await mkdtemp(join(tmpdir(), "paper-parent-cycle-"))
  await put(cycleRoot, "First/paper.pdf")
  await put(cycleRoot, "Second/paper.pdf")
  const cycleError = await rejectedScan(() => scan(cycleRoot, {
    version: 1,
    papers: {
      "main_papers::First": { paper_id: "CycleA-01", unit_type: "chapter", parent_paper_id: "CycleB-01" },
      "main_papers::Second": { paper_id: "CycleB-01", unit_type: "chapter", parent_paper_id: "CycleA-01" },
    },
  }))
  assert.match(cycleError.message, /成环/)
  assert.ok(cycleError.blocking?.parent_relationships.some((item) => item.startsWith("parent_cycle:")))
})

test("blocks parent links with the wrong parent or child unit type", async () => {
  const wrongParentRoot = await mkdtemp(join(tmpdir(), "paper-parent-type-"))
  await put(wrongParentRoot, "Parent/paper.pdf")
  await put(wrongParentRoot, "Child/paper.pdf")
  const wrongParent = await rejectedScan(() => scan(wrongParentRoot, {
    version: 1,
    papers: {
      "main_papers::Parent": { paper_id: "Article-01", unit_type: "article" },
      "main_papers::Child": { paper_id: "Chapter-01", unit_type: "chapter", parent_paper_id: "Article-01" },
    },
  }))
  assert.match(wrongParent.message, /父项必须是 thesis/)
  assert.ok(wrongParent.blocking?.parent_relationships.includes("parent_not_thesis:Chapter-01->Article-01"))

  const wrongChildRoot = await mkdtemp(join(tmpdir(), "paper-child-type-"))
  await put(wrongChildRoot, "Parent/paper.pdf")
  await put(wrongChildRoot, "Child/paper.pdf")
  const wrongChild = await rejectedScan(() => scan(wrongChildRoot, {
    version: 1,
    papers: {
      "main_papers::Parent": { paper_id: "Thesis-01", unit_type: "thesis" },
      "main_papers::Child": { paper_id: "Article-02", unit_type: "article", parent_paper_id: "Thesis-01" },
    },
  }))
  assert.match(wrongChild.message, /子项必须是 chapter/)
  assert.ok(wrongChild.blocking?.parent_relationships.includes("child_not_chapter:Article-02->Thesis-01"))
})

test("blocks cross-source parents and orphan chapters", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "paper-source-parent-"))
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-source-child-"))
  await put(firstRoot, "Parent/paper.pdf")
  await put(secondRoot, "Child/paper.pdf")
  const crossSource = await rejectedScan(() => scanPaperSources({
    config: {
      version: 1,
      sources: [
        { source_id: "source_parent", path: firstRoot },
        { source_id: "source_child", path: secondRoot },
      ],
    },
    overrides: {
      version: 1,
      papers: {
        "source_parent::Parent": { paper_id: "Thesis-01", unit_type: "thesis" },
        "source_child::Child": { paper_id: "Chapter-01", unit_type: "chapter", parent_paper_id: "Thesis-01" },
      },
    },
  }))
  assert.match(crossSource.message, /跨来源/)
  assert.ok(crossSource.blocking?.parent_relationships.includes("cross_source_parent:Chapter-01->Thesis-01"))

  const orphanRoot = await mkdtemp(join(tmpdir(), "paper-parent-orphan-"))
  await put(orphanRoot, "Child/paper.pdf")
  const orphan = await rejectedScan(() => scan(orphanRoot, {
    version: 1,
    papers: {
      "main_papers::Child": { paper_id: "Chapter-01", unit_type: "chapter" },
    },
  }))
  assert.match(orphan.message, /章节缺少父项/)
  assert.deepEqual(orphan.blocking?.parent_relationships, ["orphan_chapter:Chapter-01"])
})

test("global duplicate IDs block before parent relationship validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-parent-priority-"))
  await put(root, "First/paper.pdf")
  await put(root, "Second/paper.pdf")
  const error = await rejectedScan(() => scan(root, {
    version: 1,
    papers: {
      "main_papers::First": { paper_id: "Same-01", unit_type: "chapter" },
      "main_papers::Second": { paper_id: "Same-01" },
    },
  }))

  assert.match(error.message, /重复论文 ID/)
  assert.doesNotMatch(error.message, /父子引用/)
  assert.deepEqual(error.blocking?.parent_relationships, [])
})

test("prevents a parent artifact override from claiming a nested paper file", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Parent/paper.pdf")
  await put(root, "Parent/Child/child.pdf")
  await put(root, "Parent/Child/中文题名.md")
  await assert.rejects(() => scan(root, {
    version: 1,
    papers: { "main_papers::Parent": { artifact_overrides: { translation: ["Parent/Child/中文题名.md"] } } },
  }), /路径越界/)
})

test("rejects legacy and duplicate-style override keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await assert.rejects(() => scan(root, { version: 1, papers: { "main_papers:Paper": {} } }), /覆盖键/)
  await assert.rejects(() => scan(root, {
    version: 1,
    papers: { "main_papers:Paper": {}, "main_papers::Paper": {} },
  }), /覆盖键/)
})

test("rejects a generic PDF directly at the configured source root", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "paper.pdf")
  await assert.rejects(() => scan(root), /配置根目录不能直接包含论文 PDF/)
})

test("merges validated overrides over frontmatter and keeps formal availability conservative", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  await put(root, "Paper/reading-note.md", "---\ntitle_zh: frontmatter 标题\nyear: 2018\n---")
  await put(root, "Paper/simulation.md")
  await put(root, "Paper/run.py")
  const result = await scan(root, {
    version: 1,
    papers: {
      "main_papers::Paper": {
        paper_id: "Paper-01", title_zh: "人工确认标题", source_status: "located", evidence_status: "partial",
        reproduction_status: "results_recorded", writing_material_count: 2, preferred_note: "Paper/reading-note.md",
      },
    },
  })
  const paper = result.papers[0]
  assert.equal(paper.title_zh, "人工确认标题")
  assert.equal(paper.year, 2018)
  assert.equal(paper.source_status, "located")
  assert.equal(paper.evidence_status, "partial")
  assert.equal(paper.reproduction_status, "results_recorded")
  assert.equal(paper.writing_material_count, 2)
  assert.equal(paper.preferred_note, "reading-note.md")
  assert.deepEqual(paper.artifacts.script.map((item) => item.relative_path), ["run.py"])
})

test("uses only scripts or descriptions for conservative reproduction availability", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Comparison/paper.pdf")
  await put(root, "Comparison/代码对比.md")
  await put(root, "Description/paper.pdf")
  await put(root, "Description/simulation.md")
  await put(root, "Runnable/paper.pdf")
  await put(root, "Runnable/run.py")
  const result = await scan(root)
  assert.equal(result.papers.find((paper) => paper.relative_path === "Comparison").reproduction_status, "none")
  assert.equal(result.papers.find((paper) => paper.relative_path === "Description").reproduction_status, "description_only")
  assert.equal(result.papers.find((paper) => paper.relative_path === "Runnable").reproduction_status, "code_unrun")
  assert.deepEqual(result.papers.map((paper) => paper.relative_path), ["Comparison", "Description", "Runnable"])
})

test("warns for a canonical override key that has no scanned unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "Paper/paper.pdf")
  const result = await scan(root, { version: 1, papers: { "main_papers::Missing": { title_zh: "暂缺" } } })
  assert.deepEqual(result.audit.warnings.unmatched_overrides, ["main_papers::Missing"])
})

test("blocks an exclusion key that does not resolve to one exact scanned unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-exclusion-missing-"))
  await put(root, "Paper/paper.pdf")
  const error = await rejectedScan(() => scan(root, {
    version: 1,
    papers: {
      "main_papers::Missing": {
        include: false,
        exclude_reason: "continuous_time_out_of_scope",
      },
    },
  }))

  assert.equal(error.message, "扫描存在阻塞问题：排除键无法唯一解析")
  assert.deepEqual(error.blocking?.exclusion_targets, ["main_papers::Missing"])
  assert.equal(error.message.includes("Missing"), false)
  assert.equal(error.message.includes("continuous_time_out_of_scope"), false)
})

test("rejects a preferred note override outside its paper unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-scan-"))
  await put(root, "First/paper.pdf")
  await put(root, "Second/paper.pdf")
  await put(root, "Second/reading-note.md")
  await assert.rejects(() => scan(root, {
    version: 1,
    papers: { "main_papers::First": { preferred_note: "Second/reading-note.md" } },
  }), /路径越界/)
})
