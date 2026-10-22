import test from "node:test"
import assert from "node:assert/strict"

import { ROOT_GROUP, buildProjectModel, buildSectionGuide, defaultProjectPath, groupProjectFiles, resolveProjectLink, sectionModels, sourceLinks, splitValues, tableFilesByPath } from "./paper-project-model.mjs"

const PAPERS = [
  {
    paper_id: "Liu24-LCT",
    title_original: "Linear convergence over unbalanced graphs",
    authors: ["Liu Y"],
    publication_year: 2024,
    doi_or_url: "https://doi.org/10.1109/tcns.2024.1",
    source_documents: {
      pdf: [{ url: "../../local_library_data/sources/liu24-lct/pdf/a.pdf" }],
      ocr: [{ url: "../../local_library_data/sources/liu24-lct/ocr/b.html" }],
    },
    artifact_availability: { note: true },
  },
  { paper_id: "Wei25-DPZO", title_original: "A different local paper", authors: ["Other A"], publication_year: 2023, doi_or_url: null, source_documents: { pdf: [], ocr: [] } },
]

const reference = (code, location = null, known = true) => ({ text: location ? `${code}·${location}` : code, reference: { code, location, known } })

const PROJECT = {
  references: [
    { 短码: "Liu24-LCT", 作者: "Liu Y；Chen X", 年份: "2024", 题名: "Linear convergence over unbalanced graphs", DOI: "10.1109/tcns.2024.1", 核实: "已核实（PDF）" },
    { 短码: "Wei25-DPZO", 作者: "Wei M", 年份: "2025", 题名: "Privacy zeroth-order optimization", DOI: "", 核实: "未核实" },
    { 短码: "Kim20-ABC", 作者: "Kim J", 年份: "2020", 题名: "Something not local", DOI: "", 核实: "已核实（题录）" },
  ],
  tables: [
    { key: "references", title: "文献清单", path: "相关论文/文献清单.md", tables: [
      { heading: "文献", status: "ok", headers: ["短码", "作者"], rows: [[[reference("Liu24-LCT")], [{ text: "Liu Y" }]]] },
    ] },
    { key: "benchmark", title: "期刊基准表", path: "03_范文对照/期刊基准表.md", tables: [
      { heading: "检查项", status: "ok", headers: ["检查项", "Liu24-LCT", "本刊常见水平"], code_columns: ["Liu24-LCT"],
        rows: [[[{ text: "是否有朴素基线" }], [{ text: "无" }, { text: "〔p.7〕", reference: { code: "Liu24-LCT", location: "p.7", known: true } }], [{ text: "多数没有" }]]] },
      { heading: "硬性规定", status: "missing" },
    ] },
    { key: "mapping", title: "小节范文映射表", path: "03_范文对照/小节范文映射表.md", tables: [
      { heading: "映射", status: "ok", headers: ["小节编号", "本文小节", "稿件文件", "本刊范文", "非本刊范文", "本刊容忍度要点", "目标篇幅", "起草方式"],
        rows: [[[{ text: "2.1" }], [{ text: "网络模型" }], [{ text: "02_问题描述.md" }], [reference("Liu24-LCT", "§II-A")], [], [{ text: "一句带过" }], [{ text: "600字" }], [{ text: "整节" }]]] },
    ] },
  ],
  reviews: [],
  drafts: [{ path: "01_稿件/02_问题描述.md", codes: ["Liu24-LCT"] }],
}

test("multiple values split on the full-width semicolon", () => {
  assert.deepEqual(splitValues("Liu Y；Chen X；"), ["Liu Y", "Chen X"])
})

test("only a unique DOI confirms a local paper; an equal short code is a hint", () => {
  const { references } = buildProjectModel(PROJECT, PAPERS)
  const liu = references.get("Liu24-LCT").library
  assert.equal(liu.status, "confirmed")
  assert.equal(liu.paperId, "Liu24-LCT")
  assert.equal(liu.pdfUrl, "../../local_library_data/sources/liu24-lct/pdf/a.pdf")
  assert.equal(liu.hasOcr, true)
  assert.equal(liu.hasNote, true)

  const wei = references.get("Wei25-DPZO").library
  assert.equal(wei.status, "code_hint")
  assert.equal(wei.pdfUrl, null)
  assert.match(wei.reason, /人工核对/)

  assert.equal(references.get("Kim20-ABC").library.status, "not_found")
})

test("every table and draft use of a code is listed once, except the reference row itself", () => {
  const { uses } = buildProjectModel(PROJECT, PAPERS)
  assert.deepEqual(uses.get("Liu24-LCT"), [
    { path: "03_范文对照/期刊基准表.md", title: "期刊基准表", heading: "检查项", row: "是否有朴素基线", column: "Liu24-LCT", location: "p.7" },
    { path: "03_范文对照/小节范文映射表.md", title: "小节范文映射表", heading: "映射", row: "2.1", column: "本刊范文", location: "§II-A" },
    { path: "01_稿件/02_问题描述.md", title: "稿件", heading: null, row: "01_稿件/02_问题描述.md", column: null, location: null },
  ])
})

test("page locations open the PDF page; other locations open the library source tab", () => {
  const { references } = buildProjectModel(PROJECT, PAPERS)
  const liu = references.get("Liu24-LCT")
  assert.deepEqual(sourceLinks({ code: "Liu24-LCT", location: "p.7" }, liu), {
    pdfPage: "../../local_library_data/sources/liu24-lct/pdf/a.pdf#page=7",
    library: "../../local_library_output/desktop/library.html?paper_id=Liu24-LCT&tab=source",
    projectPdfs: [],
  })
  assert.equal(sourceLinks({ code: "Liu24-LCT", location: "§V" }, liu).pdfPage, null)
  const hint = sourceLinks({ code: "Wei25-DPZO", location: "p.3" }, references.get("Wei25-DPZO"))
  assert.equal(hint.pdfPage, null)
  assert.match(hint.library, /paper_id=Wei25-DPZO/)
  assert.deepEqual(sourceLinks({ code: "Kim20-ABC", location: "p.1" }, references.get("Kim20-ABC")), { pdfPage: null, library: null, projectPdfs: [] })
})

test("an unavailable library index leaves every reference unmatched", () => {
  const { references } = buildProjectModel(PROJECT, null)
  assert.equal(references.get("Liu24-LCT").library.status, "unknown")
})

test("mapping rows become per-section models", () => {
  const [section] = sectionModels(PROJECT)
  assert.equal(section.id, "2.1")
  assert.equal(section.title, "网络模型")
  assert.equal(section.journalExamples[0].reference.location, "§II-A")
  assert.deepEqual(section.otherExamples, [])
  assert.deepEqual([section.tolerance, section.length, section.mode], ["一句带过", "600字", "整节"])
  assert.deepEqual(sectionModels({ tables: [] }), [])
})

test("files group by workflow folder in skill order, root first, others last", () => {
  const project = { files: [
    { path: "code/run.py" }, { path: "审稿/修改说明.md" }, { path: "README.md" }, { path: "01_稿件/引言草稿.md" },
    { path: "相关论文/文献清单.md" }, { path: "相关论文/[01] A.pdf" }, { path: "相关论文/[02] B.pdf" }, { path: "02_规划与记录/讨论记录.md" },
  ] }
  assert.deepEqual(groupProjectFiles(project), [
    { name: ROOT_GROUP, markdown: ["README.md"], otherCount: 0 },
    { name: "01_稿件", markdown: ["01_稿件/引言草稿.md"], otherCount: 0 },
    { name: "02_规划与记录", markdown: ["02_规划与记录/讨论记录.md"], otherCount: 0 },
    { name: "审稿", markdown: ["审稿/修改说明.md"], otherCount: 0 },
    { name: "相关论文", markdown: ["相关论文/文献清单.md"], otherCount: 2 },
    { name: "code", markdown: [], otherCount: 1 },
  ])
})

test("the reader opens a parsed table first, then README, then the first Markdown file", () => {
  const parsed = { files: [{ path: "README.md" }], tables: [{ path: "相关论文/文献清单.md", status: "ok", tables: [{ status: "ok" }] }], reviews: [] }
  assert.equal(defaultProjectPath(parsed), "相关论文/文献清单.md")
  const legacy = { files: [{ path: "README.md" }, { path: "01_稿件/引言草稿.md" }], tables: [{ path: "相关论文/文献清单.md", status: "partial", tables: [{ status: "missing" }] }], reviews: [] }
  assert.equal(defaultProjectPath(legacy), "README.md")
  assert.equal(defaultProjectPath({ files: [{ path: "01_稿件/引言草稿.md" }], tables: [], reviews: [] }), "01_稿件/引言草稿.md")
  assert.equal(defaultProjectPath({ files: [], tables: [], reviews: [] }), null)
  assert.deepEqual([...tableFilesByPath(legacy).keys()], ["相关论文/文献清单.md"])
})

test("Markdown links resolve to project files relative to the file they are in", () => {
  assert.equal(resolveProjectLink("README.md", "01_稿件/引言草稿.md"), "01_稿件/引言草稿.md")
  assert.equal(resolveProjectLink("相关论文/文献清单.md", "../02_规划与记录/引言框架.md"), "02_规划与记录/引言框架.md")
  assert.equal(resolveProjectLink("README.md", "./02_%E8%A7%84%E5%88%92.md#part"), "02_规划.md")
  assert.equal(resolveProjectLink("README.md", "01_稿件/"), "01_稿件")
  for (const target of ["https://example.org/a.md", "../outside.md", "/etc/passwd", "#section", "mailto:a@b.c"]) {
    assert.equal(resolveProjectLink("README.md", target), null, target)
  }
})

test("projects without fixed headers still give each cited code its PDF, citation and uses", () => {
  const project = {
    references: [],
    tables: [],
    reviews: [],
    drafts: [],
    sources: {
      "Liu24-LCT": { citation: "Liu Y. Linear convergence. IEEE TCNS, 2024, doi: 10.1109/tcns.2024.1.", listed: true, pdfs: ["相关论文/[03] Liu24-LCT - Linear.pdf"] },
      "Wei25-DPZO": { citation: null, listed: false, pdfs: [] },
    },
    mentions: { "Liu24-LCT": ["01_稿件/引言草稿.md", "02_规划与记录/讨论记录.md"] },
  }
  const { references, uses } = buildProjectModel(project, PAPERS)
  const liu = references.get("Liu24-LCT")
  assert.equal(liu.row, null)
  assert.equal(liu.citation, "Liu Y. Linear convergence. IEEE TCNS, 2024, doi: 10.1109/tcns.2024.1.")
  assert.equal(liu.library.status, "confirmed", "a DOI inside the citation still confirms the local paper")
  assert.equal(references.get("Wei25-DPZO").library.status, "code_hint")
  assert.deepEqual(uses.get("Liu24-LCT").map((use) => use.path), ["01_稿件/引言草稿.md", "02_规划与记录/讨论记录.md"])
  assert.deepEqual(sourceLinks({ code: "Liu24-LCT", location: "p.4" }, liu, { projectId: "v10" }).projectPdfs, [{
    path: "相关论文/[03] Liu24-LCT - Linear.pdf",
    url: `/api/v1/paper-projects/v10/pdf/${encodeURIComponent("相关论文/[03] Liu24-LCT - Linear.pdf")}#page=4`,
  }])
  assert.deepEqual(sourceLinks({ code: "Wei25-DPZO", location: null }, references.get("Wei25-DPZO"), { projectId: "v10" }).projectPdfs, [])
})

test("the section guide links each section to the exemplar notes that explicitly name it", () => {
  const project = {
    tables: [],
    section_guide: {
      outline_path: "02_规划与记录/正文框架_v3.md",
      sections: [
        { id: "2", label: "2 问题描述", contents: "2.1 系统模型", references: "DePsFL（框内公式）；李天成 2025" },
        { id: "4", label: "4 分析", contents: "", references: "—" },
      ],
      notes: [
        { path: "03_范文对照/应用类.md", title: "应用类对照", sections: [], headings: ["1. Zhao25-DePsFL（车联网）"],
          passages: [{ heading: "1. Zhao25-DePsFL（车联网）", sections: ["2.2"], text: "本文 2.2 照它写" }] },
        { path: "03_范文对照/隐私.md", title: "隐私分析（第 4.2 节用）", sections: ["4.2"], headings: [], passages: [] },
      ],
    },
  }
  const guide = buildSectionGuide(project)
  assert.equal(guide.source, "outline")
  const [problem, analysis] = guide.sections
  assert.deepEqual(problem.exemplars, [
    { text: "DePsFL（框内公式）", name: "DePsFL", links: [{ path: "03_范文对照/应用类.md", title: "应用类对照", heading: "1. Zhao25-DePsFL（车联网）" }] },
    { text: "李天成 2025", name: "李天成", links: [] },
  ])
  assert.deepEqual(problem.passages.map((passage) => passage.text), ["本文 2.2 照它写"])
  assert.deepEqual(problem.files, [])
  assert.deepEqual(analysis.files, [{ path: "03_范文对照/隐私.md", title: "隐私分析（第 4.2 节用）" }])
  assert.deepEqual(guide.byExemplar, [{ path: "03_范文对照/应用类.md", title: "应用类对照", heading: "1. Zhao25-DePsFL（车联网）", sections: ["2 问题描述"] }])
  assert.equal(buildSectionGuide({ tables: [] }).source, null)
})
