from __future__ import annotations

import json
import os
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from playwright.sync_api import Browser, Page, sync_playwright


DEFAULT_ORIGIN = "http://127.0.0.1:4176"


def normalized_local_origin(raw_origin: str) -> str:
    normalized = raw_origin[:-1] if raw_origin.endswith("/") else raw_origin
    try:
        parts = urlparse(normalized)
        port = parts.port
    except (TypeError, UnicodeError, ValueError):
        raise AssertionError("paper_library_origin") from None
    canonical = f"http://127.0.0.1:{port}" if isinstance(port, int) and 1 <= port <= 65535 else ""
    if not (
        canonical
        and normalized == canonical
        and raw_origin in (canonical, f"{canonical}/")
        and parts.scheme == "http"
        and parts.netloc == f"127.0.0.1:{port}"
        and parts.hostname == "127.0.0.1"
        and parts.username is None
        and parts.password is None
        and parts.path == ""
        and not parts.params
        and not parts.query
        and not parts.fragment
    ):
        raise AssertionError("paper_library_origin") from None
    return canonical


ORIGIN = normalized_local_origin(os.environ.get("PAPER_LIBRARY_ORIGIN", DEFAULT_ORIGIN))
ORIGIN_PARTS = urlparse(ORIGIN)
URL = f"{ORIGIN}/local_library_output/desktop/library.html"
INDEX_FILE = Path("local_library_data/paper-index.json")
OUT = Path("output/playwright")
STORAGE_KEY = "research-console.paper-library.v1"
P02_ROLES = (
    "algorithm_mechanism",
    "theory_evidence",
    "simulation_baseline",
    "related_work",
)
READING_MARKERS = ("unread", "reading", "read")
SORT_MODES = ("default", "title", "year", "contribution", "evidence")
NOTE_STATUS_ORDER = ("notes_ready", "ocr_only", "pdf_only", "metadata_only")
FACET_PANEL_LABELS = (
    ("research", "研究任务"),
    ("constraints", "约束结构"),
    ("oracle", "梯度与反馈"),
    ("methods", "方法体系"),
    ("more", "更多条件"),
)
REPRESENTATIVE_QUERY_SPECS = (
    (
        "coupled_inequality_dual",
        (
            ("constraints.scope", "耦合约束"),
            ("constraints.form", "不等式约束"),
            ("methods.framework", "对偶分解"),
        ),
    ),
    (
        "nonidentical_time_varying",
        (
            ("constraints.consistency", "本地非一致约束"),
            ("network.time", "时变"),
        ),
    ),
    (
        "online_one_point",
        (
            ("oracle.information", "函数值反馈"),
            ("oracle.estimation", "单点估计"),
            ("research.mode", "在线优化"),
        ),
    ),
    (
        "private_federated",
        (
            ("privacy_robustness", "差分隐私"),
            ("research.domain", "联邦学习"),
        ),
    ),
)
MATERIAL_FILTER_FIELDS = (
    ("sourceStatuses", "source_status"),
    ("evidenceStatuses", "evidence_status"),
    ("reproductionStatuses", "reproduction_status"),
)
REQUIRED_ASSETS = (
    "styles.css",
    "library.mjs",
    "paper-inspector.mjs",
    "paper-library-model.mjs",
    "paper-library-storage.mjs",
)
READER_PAPER_ID = "Xiong20-PDO"
IMAGE_PAPER_ID = "Liu24-LCT"


def ensure(condition: bool, code: str) -> None:
    if not condition:
        raise AssertionError(code)


def load_index() -> tuple[dict, list[dict]]:
    payload = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    ensure(payload.get("version") == 3, "index_version")
    facet_schema = payload.get("facet_schema")
    ensure(isinstance(facet_schema, dict), "facet_schema")
    ensure(facet_schema.get("version") == 2, "facet_schema_version")
    groups = facet_schema.get("groups")
    ensure(isinstance(groups, list) and len(groups) == 18, "facet_schema_groups")
    paths = [group.get("path") for group in groups if isinstance(group, dict)]
    ensure(len(paths) == len(groups) and len(set(paths)) == len(paths), "facet_schema_paths")
    papers = payload.get("papers")
    ensure(isinstance(papers, list) and papers, "index_papers")
    paper_ids = [paper.get("paper_id") for paper in papers]
    ensure(all(isinstance(paper_id, str) and paper_id for paper_id in paper_ids), "paper_ids")
    ensure(len(set(paper_ids)) == len(paper_ids), "paper_ids_unique")
    allowed_states = {"unrecorded", "not_applicable", "pending_verification"}

    def values_at_path(paper: dict, path: str) -> list[object]:
        current: object = paper.get("facets")
        for part in path.split("."):
            if not isinstance(current, dict):
                return []
            current = current.get(part)
        return current if isinstance(current, list) else []

    for paper in papers:
        states = paper.get("facet_states")
        ensure(isinstance(states, dict), "facet_states_object")
        ensure(set(states).issubset(set(paths)), "facet_states_paths")
        ensure(set(states.values()).issubset(allowed_states), "facet_states_values")
        for path, state in states.items():
            ensure(state in allowed_states, "facet_state_value")
            ensure(values_at_path(paper, path) == [], "facet_state_value_collision")
    return payload, papers


def expected_coverage_text(papers: list[dict]) -> str:
    records = papers if isinstance(papers, list) else []
    chinese_titles = sum(
        1
        for paper in records
        if isinstance(paper.get("title_zh"), str) and paper["title_zh"].strip()
    )
    pending_identities = sum(
        1 for paper in records if paper.get("identity_source") == "path_hash"
    )
    total = len(records)
    return f"中文标题 {chinese_titles}/{total}；待整理身份 {pending_identities}/{total}"


def is_safe_source_relative_path(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    candidate = value.strip()
    if "\\" in candidate or candidate.startswith("/"):
        return False
    if len(candidate) >= 3 and candidate[0].isalpha() and candidate[1] == ":" and candidate[2] == "/":
        return False
    prefix = candidate.split("/", 1)[0]
    if ":" in prefix:
        scheme = prefix.split(":", 1)[0]
        ascii_alpha = lambda character: "A" <= character <= "Z" or "a" <= character <= "z"
        ascii_alnum = lambda character: ascii_alpha(character) or "0" <= character <= "9"
        if scheme and ascii_alpha(scheme[0]) and all(ascii_alnum(character) or character in "+-." for character in scheme):
            return False
    return all(segment not in ("", ".", "..") for segment in candidate.split("/"))


INDEX, PAPERS = load_index()
FACET_SCHEMA = INDEX["facet_schema"]
FACET_GROUPS = FACET_SCHEMA["groups"]
FACET_GROUP_BY_PATH = {group["path"]: group for group in FACET_GROUPS}
ALL_IDS = {paper["paper_id"] for paper in PAPERS}
ensure(len(PAPERS) == 52, "paper_count_52")
EXPECTED_COVERAGE_TEXT = expected_coverage_text(PAPERS)
UNTITLED_PAPERS = [
    paper
    for paper in PAPERS
    if not (isinstance(paper.get("title_zh"), str) and paper["title_zh"].strip())
    and not (isinstance(paper.get("title_original"), str) and paper["title_original"].strip())
    and not (isinstance(paper.get("title_en"), str) and paper["title_en"].strip())
]
IDENTITY_PENDING_PAPERS = [
    paper for paper in PAPERS if paper.get("identity_source") == "path_hash"
]
ensure(
    all(is_safe_source_relative_path(paper.get("relative_path")) for paper in IDENTITY_PENDING_PAPERS),
    "identity_pending_relative_path",
)
UNTITLED_PAPER = UNTITLED_PAPERS[0] if UNTITLED_PAPERS else None
if UNTITLED_PAPER is not None:
    ensure(is_safe_source_relative_path(UNTITLED_PAPER.get("relative_path")), "untitled_relative_path")
UNTITLED_ID = UNTITLED_PAPER["paper_id"] if UNTITLED_PAPER is not None else None


def controlled_preview_path(paper: dict, kind: str) -> str | None:
    catalogs = paper.get("controlled_preview_documents")
    documents = catalogs.get(kind) if isinstance(catalogs, dict) else None
    if isinstance(documents, list):
        candidates = [item for item in documents if isinstance(item, dict)]
        defaults = [item for item in candidates if item.get("is_default") is True]
        selected = defaults[0] if len(defaults) == 1 else candidates[0] if len(candidates) == 1 else None
        candidate = selected.get("url") if isinstance(selected, dict) else None
        if isinstance(candidate, str) and candidate:
            return candidate
    previews = paper.get("controlled_previews")
    if isinstance(previews, dict):
        candidate = previews.get(kind)
        if isinstance(candidate, str) and candidate:
            return candidate
    if kind == "note":
        candidate = paper.get("note_preview_url")
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


PREVIEW_PAPER = next(
    (paper for paper in PAPERS if paper.get("paper_id") == READER_PAPER_ID),
    None,
)
ensure(isinstance(PREVIEW_PAPER, dict), "reader_paper_fixture")
ensure(
    all(
        controlled_preview_path(PREVIEW_PAPER, kind)
        for kind in ("note", "derivation", "simulation", "code_compare")
    ),
    "reader_preview_capabilities",
)
PREVIEW_ID = PREVIEW_PAPER["paper_id"]
ensure(PREVIEW_PAPER.get("identity_source") != "path_hash", "preview_identity")
CONTROLLED_PREVIEW_URLS = {
    kind: urljoin(URL, controlled_preview_path(PREVIEW_PAPER, kind))
    for kind in ("note", "derivation", "simulation", "code_compare")
}
ensure(
    all(urlparse(url).netloc == ORIGIN_PARTS.netloc for url in CONTROLLED_PREVIEW_URLS.values()),
    "preview_origin",
)

IMAGE_PAPER = next(
    (paper for paper in PAPERS if paper.get("paper_id") == IMAGE_PAPER_ID),
    None,
)
ensure(isinstance(IMAGE_PAPER, dict), "image_paper_fixture")
ensure(controlled_preview_path(IMAGE_PAPER, "code_compare"), "image_preview_capability")


def source_documents_for(paper: dict, kind: str) -> list[dict]:
    source_documents = paper.get("source_documents")
    if not isinstance(source_documents, dict):
        return []
    documents = source_documents.get(kind)
    return documents if isinstance(documents, list) else []


def source_document_url(paper: dict, kind: str, index: int = 0) -> str:
    documents = source_documents_for(paper, kind)
    ensure(0 <= index < len(documents), f"source_{kind}_fixture_index")
    candidate = documents[index].get("url")
    ensure(isinstance(candidate, str) and candidate, f"source_{kind}_fixture_url")
    resolved = urljoin(URL, candidate)
    ensure(urlparse(resolved).netloc == ORIGIN_PARTS.netloc, f"source_{kind}_fixture_origin")
    return resolved


SOURCE_PDF_PAPERS = [
    paper
    for paper in PAPERS
    if len(source_documents_for(paper, "pdf")) > 1
    and source_documents_for(paper, "ocr")
]
SOURCE_OCR_PAPERS = [
    paper
    for paper in PAPERS
    if len(source_documents_for(paper, "ocr")) > 1
    and source_documents_for(paper, "pdf")
]
ensure(SOURCE_PDF_PAPERS, "source_multi_pdf_fixture")
ensure(SOURCE_OCR_PAPERS, "source_multi_ocr_fixture")
SOURCE_PDF_PAPER = SOURCE_PDF_PAPERS[0]
SOURCE_OCR_PAPER = SOURCE_OCR_PAPERS[0]


def display_title_for_length(paper: dict) -> str:
    for field in ("title_zh", "title_original", "title_en"):
        value = paper.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "暂无书目信息"


LONGEST_ROW_ID = max(
    PAPERS,
    key=lambda paper: (
        len(paper["paper_id"]) + len(display_title_for_length(paper)),
        len(paper["paper_id"]),
        len(display_title_for_length(paper)),
    ),
)["paper_id"]


def note_count(paper: dict) -> int:
    notes = paper.get("artifacts", {}).get("note", [])
    return len(notes) if isinstance(notes, list) else 0


NO_NOTE_PAPERS = [paper for paper in PAPERS if note_count(paper) == 0]
MULTI_NOTE_PAPERS = [paper for paper in PAPERS if note_count(paper) > 1]
ensure(NO_NOTE_PAPERS, "no_note_fixture")
ensure(MULTI_NOTE_PAPERS, "multi_note_fixture")
NO_NOTE_ID = NO_NOTE_PAPERS[0]["paper_id"]
MULTI_NOTE_ID = MULTI_NOTE_PAPERS[0]["paper_id"]
MULTI_NOTE_DOCUMENT_COUNT = len(
    MULTI_NOTE_PAPERS[0].get("controlled_preview_documents", {}).get("note", [])
)


def first_scalar_case(field: str, label: str) -> tuple[str, str, str] | None:
    for paper in PAPERS:
        value = paper.get(field)
        if isinstance(value, str) and value.strip():
            return value, paper["paper_id"], label
    return None


def first_list_case(field: str, label: str) -> tuple[str, str, str] | None:
    for paper in PAPERS:
        values = paper.get(field)
        if isinstance(values, list):
            for value in values:
                if isinstance(value, str) and value.strip():
                    return value, paper["paper_id"], label
    return None


def facet_values(paper: dict, path: str) -> list[str]:
    current: object = paper.get("facets")
    for key in path.split("."):
        if not isinstance(current, dict):
            return []
        current = current.get(key)
    return current if isinstance(current, list) else []


def first_facet_case() -> tuple[str, str, str] | None:
    for group in FACET_GROUPS:
        path = group["path"]
        for paper in PAPERS:
            values = facet_values(paper, path)
            if values:
                return values[0], paper["paper_id"], group["label"]
    return None


def expected_facet_ids(selections: tuple[tuple[str, str], ...] | list[tuple[str, str]]) -> set[str]:
    return {
        paper["paper_id"]
        for paper in PAPERS
        if all(value in facet_values(paper, path) for path, value in selections)
    }


CHINESE_TITLE_CASE = first_scalar_case("title_zh", "中文标题")
SEARCH_CASES = [case for case in [
    CHINESE_TITLE_CASE,
    first_scalar_case("title_en", "英文标题"),
    first_list_case("authors", "作者"),
    (PREVIEW_ID, PREVIEW_ID, "论文 ID"),
    first_facet_case(),
    ("Tracking-ADMM", "Falsone20-TADMM", "原文术语"),
] if case is not None]
ensure(len(SEARCH_CASES) >= 2, "search_fixture_coverage")


REPRESENTATIVE_QUERY_IDS = {
    name: expected_facet_ids(selections)
    for name, selections in REPRESENTATIVE_QUERY_SPECS
}
ensure(all(REPRESENTATIVE_QUERY_IDS.values()), "representative_query_nonempty")
ensure("Falsone17-DD" in REPRESENTATIVE_QUERY_IDS["coupled_inequality_dual"], "coupled_reference")


def material_filter_fixtures() -> list[tuple[str, str, set[str]]]:
    fixtures: list[tuple[str, str, set[str]]] = []
    for axis, field in MATERIAL_FILTER_FIELDS:
        candidates = sorted({paper.get(field) for paper in PAPERS if isinstance(paper.get(field), str)})
        selected = next(
            (
                value
                for value in candidates
                if 0 < sum(paper.get(field) == value for paper in PAPERS) < len(PAPERS)
            ),
            candidates[0] if candidates else None,
        )
        ensure(isinstance(selected, str), f"material_filter_fixture_{axis}")
        fixtures.append((axis, selected, {paper["paper_id"] for paper in PAPERS if paper.get(field) == selected}))
    return fixtures


MATERIAL_FILTER_FIXTURES = material_filter_fixtures()

SORT_ORACLE_PROBE_PAPERS = [
    {
        "paper_id": "Probe-F",
        "title_zh": "相同",
        "year": 2024,
        "contribution_role": "foundational",
        "evidence_status": "none",
        "source_status": "located",
        "reproduction_status": "description_only",
        "p02_relevance": 0,
        "writing_material_count": 5,
    },
    {
        "paper_id": "Probe-C",
        "title_zh": "排序 1",
        "year": 2024,
        "contribution_role": "application",
        "evidence_status": "partial",
        "source_status": "verified",
        "reproduction_status": "consistency_verified",
        "p02_relevance": 2,
        "writing_material_count": None,
    },
    {
        "paper_id": "Probe-A",
        "title_zh": "排序 2",
        "year": 2020,
        "contribution_role": "foundational",
        "evidence_status": "none",
        "source_status": "verified",
        "reproduction_status": "none",
        "p02_relevance": 1,
        "writing_material_count": 0,
    },
    {
        "paper_id": "Probe-D",
        "title_zh": "",
        "title_en": "排序 3",
        "year": 2022,
        "contribution_role": "theory_improvement",
        "evidence_status": "core_verified",
        "source_status": "verified",
        "reproduction_status": "results_recorded",
        "p02_relevance": None,
        "writing_material_count": 2,
    },
    {
        "paper_id": "Probe-B",
        "title_zh": "排序 10",
        "year": None,
        "contribution_role": "key_method_turn",
        "evidence_status": "core_verified",
        "source_status": "not_checked",
        "reproduction_status": "none",
        "p02_relevance": 3,
        "writing_material_count": 1,
    },
    {
        "paper_id": "Probe-E",
        "title_zh": "相同",
        "year": 2024,
        "contribution_role": "foundational",
        "evidence_status": "none",
        "source_status": "located",
        "reproduction_status": "description_only",
        "p02_relevance": 0,
        "writing_material_count": 5,
    },
]
SORT_ORACLE_PROBE_SHELF = {
    "Probe-A": ["algorithm_mechanism"],
    "Probe-C": ["theory_evidence", "related_work"],
    "Probe-D": ["not_a_fixed_role"],
}
SORT_ORACLE_PROBE_EXPECTED = {
    "default": ["Probe-C", "Probe-A", "Probe-B", "Probe-E", "Probe-F", "Probe-D"],
    "title": ["Probe-C", "Probe-A", "Probe-D", "Probe-B", "Probe-E", "Probe-F"],
    "year": ["Probe-C", "Probe-E", "Probe-F", "Probe-D", "Probe-A", "Probe-B"],
    "contribution": ["Probe-E", "Probe-F", "Probe-A", "Probe-B", "Probe-D", "Probe-C"],
    "evidence": ["Probe-D", "Probe-B", "Probe-C", "Probe-A", "Probe-E", "Probe-F"],
}


def independent_expected_sort_ids(page: Page, papers: list[dict], mode: str, shelf: dict) -> list[str]:
    return page.evaluate(
        r"""
        ({ papers, mode, shelf, fixedRoles }) => {
          const collator = new Intl.Collator('zh-CN', {
            numeric: true,
            sensitivity: 'base',
            usage: 'sort',
          });
          const contributionWeight = {
            foundational: 5,
            key_method_turn: 4,
            theory_improvement: 3,
            application: 2,
            combination: 1,
            unclassified: 0,
          };
          const evidenceWeight = { none: 0, partial: 1, core_verified: 2 };
          const sourceWeight = { not_checked: 0, located: 1, verified: 2 };
          const reproductionWeight = {
            none: 0,
            description_only: 1,
            code_unrun: 2,
            ran_no_record: 3,
            results_recorded: 4,
            consistency_verified: 5,
          };
          const displayText = value => typeof value === 'string'
            ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
            : '';
          const displayTitle = paper => displayText(paper?.title_zh)
            || displayText(paper?.title_original)
            || displayText(paper?.title_en)
            || '暂无书目信息';
          const titleAndId = (left, right) => collator.compare(displayTitle(left), displayTitle(right))
            || collator.compare(displayText(left?.paper_id), displayText(right?.paper_id));
          const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
          const descendingNullLast = (left, right) => {
            const leftNumber = finiteNumber(left);
            const rightNumber = finiteNumber(right);
            if (leftNumber === null && rightNumber === null) return 0;
            if (leftNumber === null) return 1;
            if (rightNumber === null) return -1;
            return rightNumber - leftNumber;
          };
          const isShelved = paper => Array.isArray(shelf?.[paper?.paper_id])
            && shelf[paper.paper_id].some(role => fixedRoles.includes(role));
          const defaultComparator = (left, right) => Number(isShelved(right)) - Number(isShelved(left))
            || descendingNullLast(left?.p02_relevance, right?.p02_relevance)
            || (contributionWeight[right?.contribution_role] ?? 0) - (contributionWeight[left?.contribution_role] ?? 0)
            || descendingNullLast(left?.writing_material_count, right?.writing_material_count)
            || descendingNullLast(left?.year, right?.year)
            || titleAndId(left, right);
          let comparator;
          if (mode === 'title') comparator = titleAndId;
          else if (mode === 'year') {
            comparator = (left, right) => descendingNullLast(left?.year, right?.year) || titleAndId(left, right);
          } else if (mode === 'contribution') {
            comparator = (left, right) =>
              (contributionWeight[right?.contribution_role] ?? 0) - (contributionWeight[left?.contribution_role] ?? 0)
              || descendingNullLast(left?.year, right?.year)
              || titleAndId(left, right);
          } else if (mode === 'evidence') {
            comparator = (left, right) =>
              (evidenceWeight[right?.evidence_status] ?? 0) - (evidenceWeight[left?.evidence_status] ?? 0)
              || (sourceWeight[right?.source_status] ?? 0) - (sourceWeight[left?.source_status] ?? 0)
              || (reproductionWeight[right?.reproduction_status] ?? 0) - (reproductionWeight[left?.reproduction_status] ?? 0)
              || descendingNullLast(left?.writing_material_count, right?.writing_material_count)
              || titleAndId(left, right);
          } else comparator = defaultComparator;
          return [...papers].sort(comparator).map(paper => paper.paper_id);
        }
        """,
        {"papers": papers, "mode": mode, "shelf": shelf, "fixedRoles": list(P02_ROLES)},
    )


def grouped_visible_sort_ids(page: Page, papers: list[dict], mode: str, shelf: dict) -> list[str]:
    sorted_ids = independent_expected_sort_ids(page, papers, mode, shelf)
    paper_by_id = {paper["paper_id"]: paper for paper in papers}
    return [
        paper_id
        for status in NOTE_STATUS_ORDER
        for paper_id in sorted_ids
        if paper_by_id[paper_id].get("note_status") == status
    ]


SAFE_REQUEST_FAILURE_CODES = frozenset({
    "net::ERR_ABORTED",
    "net::ERR_BLOCKED_BY_CLIENT",
    "net::ERR_CONNECTION_CLOSED",
    "net::ERR_CONNECTION_REFUSED",
    "net::ERR_CONNECTION_RESET",
    "net::ERR_FAILED",
    "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_TIMED_OUT",
})


def safe_request_failure_code(raw_failure: object) -> str:
    if isinstance(raw_failure, str) and raw_failure in SAFE_REQUEST_FAILURE_CODES:
        return raw_failure
    return "unclassified-request-failure"


def assert_safe_request_failure_code_contract() -> None:
    ensure(
        safe_request_failure_code("net::ERR_ABORTED") == "net::ERR_ABORTED",
        "request_failure_code_allowlist",
    )
    private_root = "/" + "".join(("Us", "ers")) + "/local-marker"
    unknown_code = "net::ERR_" + "".join(("US", "ERS")) + "_LOCAL_MARKER"
    bare_private_token = "ERR_" + "".join(("US", "ERS")) + "_" + "".join(("TOKEN", "_SECRET"))
    adversarial_values = (
        "prefix net::ERR_ABORTED suffix",
        unknown_code,
        f"{private_root}/net::ERR_ABORTED",
        f"{private_root} free-form prefix {bare_private_token} suffix",
    )
    ensure(
        all(safe_request_failure_code(value) == "unclassified-request-failure" for value in adversarial_values),
        "request_failure_code_unclassified",
    )


def safe_request_failure_detail(request, phase: str) -> dict[str, str | bool]:
    parsed = urlparse(request.url)
    same_origin = (
        parsed.scheme == ORIGIN_PARTS.scheme
        and parsed.netloc == ORIGIN_PARTS.netloc
    )
    path = parsed.path if same_origin else ""
    if path == "/local_library_output/desktop/library.html":
        category = "page"
    elif path.startswith("/local_library_output/desktop/assets/"):
        category = "asset"
    elif path == "/local_library_data/paper-index.json":
        category = "index"
    elif path == "/local_library_data/paper-library-audit.json":
        category = "audit"
    elif path.startswith("/local_library_data/notes/"):
        category = "note"
    elif path.startswith("/local_library_data/sources/"):
        category = "source"
    elif same_origin:
        category = "same-origin-other"
    else:
        category = "cross-origin"
    raw_basename = Path(path).name if same_origin else ""
    basename = raw_basename if re.fullmatch(r"[A-Za-z0-9._-]{1,128}", raw_basename) else "redacted"
    failure = safe_request_failure_code(request.failure)
    method = request.method if request.method in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} else "OTHER"
    safe_phase = phase if re.fullmatch(r"[a-z0-9-]{1,64}", phase) else "unknown"
    resource_type = request.resource_type
    if not re.fullmatch(r"[a-z0-9-]{1,32}", resource_type):
        resource_type = "unknown"
    return {
        "phase": safe_phase,
        "resource_type": resource_type,
        "failure": failure,
        "method": method,
        "navigation": request.is_navigation_request(),
        "category": category,
        "basename": basename,
    }


def run_sort_oracle_probe(page: Page) -> None:
    orders = {}
    for mode in SORT_MODES:
        orders[mode] = independent_expected_sort_ids(
            page,
            SORT_ORACLE_PROBE_PAPERS,
            mode,
            SORT_ORACLE_PROBE_SHELF,
        )
        ensure(orders[mode] == SORT_ORACLE_PROBE_EXPECTED[mode], f"sort_oracle_probe_{mode}")
    ensure(len({tuple(order) for order in orders.values()}) == len(SORT_MODES), "sort_oracle_cross_mode")


class NetworkGuard:
    def __init__(self, page: Page) -> None:
        self.problems: list[str] = []
        self.phase = "initial"
        self.statuses: dict[str, list[int]] = {}
        self.content_types: dict[str, list[str]] = {}
        self.audit_requests = 0
        self.audit_statuses: list[int] = []
        self.preview_statuses: dict[str, list[int]] = {
            kind: [] for kind in CONTROLLED_PREVIEW_URLS
        }
        self.request_failure_details: list[dict[str, str | bool]] = []
        page.on("console", self._on_console)
        page.on("pageerror", lambda _error: self.problems.append("pageerror"))
        page.on("requestfailed", self._on_request_failed)
        page.on("request", self._on_request)
        page.on("response", self._on_response)

    def _on_request_failed(self, request) -> None:
        self.problems.append("requestfailed")
        self.request_failure_details.append(safe_request_failure_detail(request, self.phase))

    def _on_console(self, message) -> None:
        if message.type in ("warning", "error"):
            lowered = message.text.lower()
            category = "unclassified"
            for needle, label in (
                ("favicon", "favicon"),
                ("failed to load resource", "resource-load"),
                ("content security policy", "csp"),
                ("cross-origin", "cross-origin"),
                ("uncaught", "uncaught"),
                ("fetch", "fetch"),
                ("clipboard", "clipboard"),
                ("notallowederror", "not-allowed"),
                ("invalid", "invalid"),
            ):
                if needle in lowered:
                    category = label
                    break
            location = message.location or {}
            location_path = urlparse(location.get("url", "")).path
            status_match = re.search(r"status(?: code)?(?: of)?\s+(\d{3})", lowered)
            network_match = re.search(r"net::(err_[a-z_]+)", lowered)
            if location_path == "/favicon.ico":
                category = "favicon"
            elif status_match:
                category = f"resource-status-{status_match.group(1)}"
            elif network_match:
                category = network_match.group(1)
            source_name = Path(location_path).name
            if source_name not in {*REQUIRED_ASSETS, "library.html"}:
                source_name = "browser"
            line_number = location.get("lineNumber", 0)
            self.problems.append(
                f"console:{message.type}@{self.phase}:{category}:{source_name}:{line_number}",
            )

    def _on_request(self, request) -> None:
        decoded = unquote(request.url)
        if request.url.startswith("file:") or "/Users/" in decoded:
            self.problems.append("forbidden-request")
        allowed_image_prefixes = (
            f"{ORIGIN}/local_library_data/notes/",
            f"{ORIGIN}/local_library_data/sources/",
        )
        if request.resource_type == "image" and not request.url.startswith(allowed_image_prefixes):
            self.problems.append("forbidden-image-request")
        if urlparse(request.url).path == "/local_library_data/paper-library-audit.json":
            self.audit_requests += 1

    def _on_response(self, response) -> None:
        self.statuses.setdefault(response.url, []).append(response.status)
        self.content_types.setdefault(response.url, []).append(
            response.headers.get("content-type", ""),
        )
        if response.status >= 400:
            self.problems.append("http-status")
        if urlparse(response.url).path == "/local_library_data/paper-library-audit.json":
            self.audit_statuses.append(response.status)
        for kind, preview_url in CONTROLLED_PREVIEW_URLS.items():
            if response.url == preview_url:
                self.preview_statuses[kind].append(response.status)


def visible_ids(page: Page) -> list[str]:
    return page.locator("#library-results [data-paper-id]").evaluate_all(
        "nodes => nodes.map(node => node.dataset.paperId)",
    )


def row_for_id(page: Page, paper_id: str):
    ids = visible_ids(page)
    ensure(paper_id in ids, "target_row_visible")
    return page.locator("#library-results [data-paper-id]").nth(ids.index(paper_id))


def material_checkbox_for(page: Page, axis: str, value: str):
    inputs = page.locator(f'#library-filters input[name="{axis}"]')
    values = inputs.evaluate_all("nodes => nodes.map(node => node.value)")
    ensure(value in values, "material_filter_checkbox_visible")
    return inputs.nth(values.index(value))


def open_facet_panel(page: Page, panel: str) -> None:
    triggers = page.locator("[data-facet-panel-trigger]")
    target = page.locator(f'[data-facet-panel-trigger="{panel}"]')
    ensure(target.count() == 1, f"facet_trigger_{panel}")
    if target.get_attribute("aria-expanded") != "true":
        target.click()
    ensure(target.get_attribute("aria-expanded") == "true", f"facet_panel_{panel}_expanded")
    ensure(
        triggers.evaluate_all(
            "(nodes, active) => nodes.filter(node => node.getAttribute('aria-expanded') === 'true').map(node => node.dataset.facetPanelTrigger).join(',') === active",
            panel,
        ),
        f"facet_panel_{panel}_exclusive",
    )
    ensure(page.locator("[data-facet-panel]").is_visible(), f"facet_panel_{panel}_visible")


def facet_checkbox_for(page: Page, path: str, value: str):
    group = FACET_GROUP_BY_PATH.get(path)
    ensure(isinstance(group, dict), "facet_group_fixture")
    open_facet_panel(page, group["panel"])
    inputs = page.locator(
        f'[data-facet-panel] [data-facet-path="{path}"] input[data-filter-kind="facet"]',
    )
    values = inputs.evaluate_all("nodes => nodes.map(node => node.value)")
    ensure(value in values, f"facet_checkbox_{path}_{value}")
    return inputs.nth(values.index(value))


def facet_option_count(page: Page, path: str, value: str) -> int:
    option = facet_checkbox_for(page, path, value).locator("xpath=..")
    text = option.locator("small").inner_text()
    match = re.match(r"^(\d+) 篇", text)
    ensure(match is not None, "facet_option_count_text")
    return int(match.group(1))


def assert_result_ids(page: Page, expected: set[str], code: str) -> None:
    actual = set(visible_ids(page))
    ensure(actual == expected, f"{code}:expected={sorted(expected)}:actual={sorted(actual)}")
    ensure(
        page.locator("#library-count").inner_text().strip() == f"显示 {len(expected)} 篇，共 {len(PAPERS)} 篇",
        f"{code}_count",
    )


def inspector_status_signature(page: Page) -> list[str]:
    return page.locator("#library-inspector .library-status-badge").all_inner_texts()


def inspector_matches(page: Page, paper_id: str) -> bool:
    code = page.locator("#library-inspector [data-inspector-content] code")
    return code.count() == 1 and code.inner_text() == paper_id


def read_storage(page: Page) -> dict:
    raw = page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY)
    ensure(isinstance(raw, str) and raw, "storage_missing")
    value = json.loads(raw)
    ensure(isinstance(value, dict), "storage_shape")
    return value


def assert_focus_ring(page: Page) -> None:
    metrics = page.evaluate(
        """
        () => {
          const target = document.activeElement;
          if (!target || target === document.body) return null;
          const style = getComputedStyle(target);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow,
          };
        }
        """,
    )
    ensure(isinstance(metrics, dict), "focus_target")
    outlined = metrics["outlineStyle"] != "none" and metrics["outlineWidth"] != "0px"
    shadowed = metrics["boxShadow"] != "none"
    ensure(outlined or shadowed, "focus_ring")


def assert_required_http(guard: NetworkGuard) -> None:
    required = [
        URL,
        urljoin(URL, "../../local_library_data/paper-index.json"),
        *(urljoin(URL, f"./assets/{name}") for name in REQUIRED_ASSETS),
    ]
    for required_url in required:
        required_parts = urlparse(required_url)
        matching_statuses = [
            status
            for observed_url, statuses in guard.statuses.items()
            if (
                urlparse(observed_url).scheme,
                urlparse(observed_url).netloc,
                urlparse(observed_url).path,
            )
            == (required_parts.scheme, required_parts.netloc, required_parts.path)
            for status in statuses
        ]
        ensure(200 in matching_statuses, "required_http_200")


def assert_layout(page: Page, width: int, *, detail: bool = False) -> None:
    metrics = page.evaluate(
        """
        () => {
          const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
          const sidebar = rect('.library-sidebar');
          const main = rect('.library-main');
          const inspector = rect('.library-inspector');
          const app = rect('.app-window');
          const shelf = document.querySelector('.library-shelf-grid');
          const cards = [...document.querySelectorAll('.library-shelf-slot')].map(node => node.getBoundingClientRect());
          const table = document.querySelector('.library-table-wrap');
          const mainNode = document.querySelector('.library-main');
          const rowsDoNotOverlap = [...document.querySelectorAll('.library-paper-row')].every(row => {
            const select = row.querySelector('[data-action="select-paper"]')?.getBoundingClientRect();
            const detail = row.querySelector('[data-action="open-detail"]')?.getBoundingClientRect();
            return !select || !detail || select.right <= detail.left + 1;
          });
          const titlesOpenDetails = [...document.querySelectorAll('.library-paper-row')].every(row => {
            const title = row.querySelector('[data-field="title"]');
            const detail = row.querySelector('[data-action="open-detail"]');
            const select = row.querySelector('[data-action="select-paper"]');
            return detail?.tagName === 'BUTTON'
              && detail.contains(title)
              && !select?.contains(title)
              && detail.textContent.trim() === title?.textContent.trim();
          });
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            sidebarWidth: sidebar?.width ?? 0,
            mainWidth: main?.width ?? 0,
            inspectorWidth: inspector?.width ?? 0,
            sidebarRight: sidebar?.right ?? 0,
            mainLeft: main?.left ?? 0,
            mainRight: main?.right ?? 0,
            inspectorLeft: inspector?.left ?? 0,
            appHeight: app?.height ?? 0,
            shelfColumns: shelf ? getComputedStyle(shelf).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
            shelfRows: new Set(cards.map(card => Math.round(card.top))).size,
            tableOverflowX: table ? getComputedStyle(table).overflowX : '',
            tableClientWidth: table?.clientWidth ?? 0,
            tableScrollWidth: table?.scrollWidth ?? 0,
            mainClientHeight: mainNode?.clientHeight ?? 0,
            mainScrollHeight: mainNode?.scrollHeight ?? 0,
            mainBackground: mainNode ? getComputedStyle(mainNode).backgroundColor : '',
            rowsDoNotOverlap,
            titlesOpenDetails,
            legacyArrowCount: document.querySelectorAll('.library-open-detail').length,
          };
        }
        """,
    )
    ensure(metrics["viewportWidth"] == width, "viewport_width")
    ensure(metrics["documentWidth"] <= width and metrics["bodyWidth"] <= width, "page_horizontal_overflow")
    ensure(224 <= metrics["sidebarWidth"] <= 260, "sidebar_width")
    ensure(276 <= metrics["inspectorWidth"] <= 320, "inspector_width")
    ensure(metrics["sidebarRight"] <= metrics["mainLeft"] + 1, "sidebar_overlap")
    ensure(metrics["mainRight"] <= metrics["inspectorLeft"] + 1, "inspector_overlap")
    ensure(metrics["mainWidth"] >= 650, "main_width")
    ensure(metrics["appHeight"] >= page.viewport_size["height"] - 30, "app_height")
    ensure(metrics["shelfColumns"] == (4 if width == 1440 else 2), "shelf_columns")
    ensure(metrics["shelfRows"] == (1 if width == 1440 else 2), "shelf_rows")
    ensure(metrics["tableOverflowX"] in ("auto", "scroll"), "table_scroll_container")
    ensure(metrics["rowsDoNotOverlap"], "row_control_overlap")
    ensure(metrics["titlesOpenDetails"], "row_title_opens_detail")
    ensure(metrics["legacyArrowCount"] == 0, "row_legacy_arrow_removed")
    ensure(metrics["mainScrollHeight"] >= metrics["mainClientHeight"], "main_scroll_metrics")
    ensure(metrics["mainBackground"] == "rgb(255, 255, 255)", "main_background")
    if width == 1280 and not detail:
        ensure(metrics["tableScrollWidth"] > metrics["tableClientWidth"], "table_internal_overflow_fixture")
        scrolled = page.locator(".library-table-wrap").evaluate(
            "node => { node.scrollLeft = node.scrollWidth; return node.scrollLeft > 0; }",
        )
        ensure(scrolled, "table_internal_scroll")


def run_search_checks(page: Page) -> None:
    search = page.locator("#library-search")
    for query, paper_id, expected_hit in SEARCH_CASES:
        search.fill(query)
        row = row_for_id(page, paper_id)
        hits = row.get_attribute("data-hit-fields") or ""
        ensure(expected_hit in hits, "search_hit_field")
    search.fill("")
    ensure(set(visible_ids(page)) == ALL_IDS, "search_reset")


def run_sort_checks(page: Page) -> None:
    run_sort_oracle_probe(page)
    original_state = read_storage(page)
    ensure(original_state.get("shelf", {}) == {}, "sort_initial_shelf")
    no_shelf_order = grouped_visible_sort_ids(page, PAPERS, "default", {})
    shelf_probe_group = next(
        (
            [paper_id for paper_id in no_shelf_order if next(
                paper for paper in PAPERS if paper["paper_id"] == paper_id
            ).get("note_status") == status]
            for status in NOTE_STATUS_ORDER
            if sum(1 for paper in PAPERS if paper.get("note_status") == status) >= 2
        ),
        None,
    )
    ensure(isinstance(shelf_probe_group, list) and len(shelf_probe_group) >= 2, "sort_shelf_group_fixture")
    shelf_probe_id = shelf_probe_group[-1]
    probe_state = json.loads(json.dumps(original_state))
    probe_state["shelf"] = {shelf_probe_id: [P02_ROLES[0]]}
    page.evaluate(
        "([key, value]) => localStorage.setItem(key, JSON.stringify(value))",
        [STORAGE_KEY, probe_state],
    )
    response = page.reload(wait_until="networkidle")
    ensure(response is not None and response.status == 200, "sort_shelf_reload_http")
    expected_orders = {
        mode: grouped_visible_sort_ids(page, PAPERS, mode, probe_state["shelf"])
        for mode in SORT_MODES
    }
    expected_group_start = no_shelf_order.index(shelf_probe_group[0])
    ensure(expected_orders["default"][expected_group_start] == shelf_probe_id, "sort_shelf_binary_priority")
    ensure(no_shelf_order[expected_group_start] != shelf_probe_id, "sort_shelf_probe_discriminates")
    ensure(len({tuple(order) for order in expected_orders.values()}) >= 2, "sort_real_cross_mode")
    sort = page.locator("#library-sort")
    for mode in SORT_MODES:
        sort.select_option(mode)
        first_order = visible_ids(page)
        ensure(len(first_order) == len(PAPERS) and set(first_order) == ALL_IDS, "sort_membership")
        ensure(first_order == expected_orders[mode], f"sort_contract_{mode}")
        sort.dispatch_event("change")
        second_order = visible_ids(page)
        ensure(first_order == second_order, "sort_stability")
    page.evaluate(
        "([key, value]) => localStorage.setItem(key, JSON.stringify(value))",
        [STORAGE_KEY, original_state],
    )
    response = page.reload(wait_until="networkidle")
    ensure(response is not None and response.status == 200, "sort_restore_reload_http")
    ensure(set(visible_ids(page)) == ALL_IDS, "sort_restore_results")


def expected_filter_ids(selected: dict[str, set[str]]) -> set[str]:
    return {
        paper["paper_id"]
        for paper in PAPERS
        if all(
            any(value in facet_values(paper, path) for value in values)
            for path, values in selected.items()
            if values
        )
    }


def reset_filters(page: Page, code: str) -> None:
    page.locator("#library-reset").click()
    ensure(page.locator("#library-search").input_value() == "", f"{code}_search")
    ensure(page.locator('#library-filters input[type="checkbox"]:checked').count() == 0, f"{code}_checks")
    ensure(page.locator("[data-selected-facets] [data-remove-filter]").count() == 0, f"{code}_chips")
    ensure("尚未选择学术条件" in page.locator("[data-selected-facets]").inner_text(), f"{code}_empty_chip")
    assert_result_ids(page, ALL_IDS, f"{code}_results")


def select_facet(
    page: Page,
    selected: dict[str, set[str]],
    path: str,
    value: str,
    code: str,
) -> None:
    other_filters = {key: set(values) for key, values in selected.items() if key != path}
    option_expected = expected_filter_ids({**other_filters, path: {value}})
    ensure(facet_option_count(page, path, value) == len(option_expected), f"{code}_dynamic_count")
    checkbox = facet_checkbox_for(page, path, value)
    ensure(not checkbox.is_disabled(), f"{code}_enabled")
    checkbox.check()
    selected.setdefault(path, set()).add(value)
    ensure(facet_checkbox_for(page, path, value).is_checked(), f"{code}_checked")
    assert_result_ids(page, expected_filter_ids(selected), f"{code}_results")
    chip = page.locator(
        f'[data-selected-facets] [data-remove-filter][data-filter-kind="facet"]'
        f'[data-facet-path="{path}"][data-filter-value="{value}"]',
    )
    ensure(chip.count() == 1, f"{code}_chip")
    ensure(chip.get_attribute("aria-label") == f"移除{FACET_GROUP_BY_PATH[path]['label']}：{value}", f"{code}_chip_name")


def assert_facet_layout(page: Page, width: int) -> None:
    metrics = page.evaluate(
        """
        () => {
          const triggers = [...document.querySelectorAll('[data-facet-panel-trigger]')];
          const controls = [...document.querySelectorAll('[data-facet-panel] .facet-option')];
          const main = document.querySelector('.library-main')?.getBoundingClientRect();
          const rects = nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
          });
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            triggerRects: rects(triggers),
            controlRects: rects(controls),
            main,
            triggerRows: new Set(triggers.map(node => Math.round(node.getBoundingClientRect().top))).size,
          };
        }
        """,
    )
    ensure(metrics["viewportWidth"] == width, "facet_layout_viewport")
    ensure(metrics["documentWidth"] <= width, "facet_layout_horizontal_overflow")
    ensure(metrics["triggerRows"] == (2 if width == 1280 else 1), "facet_entry_rows")
    main = metrics["main"]
    ensure(isinstance(main, dict), "facet_layout_main")
    for rect in [*metrics["triggerRects"], *metrics["controlRects"]]:
        ensure(rect["left"] >= main["left"] - 1 and rect["right"] <= main["right"] + 1, "facet_control_clipped")
        ensure(rect["height"] >= 35, "facet_control_target_height")


def capture_facet_screenshot(page: Page, width: int) -> Path:
    page.locator(".facet-entry-bar").scroll_into_view_if_needed()
    page.locator(".library-main").evaluate(
        """
        node => {
          const target = document.querySelector('.facet-entry-bar');
          const mainRect = node.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          node.style.scrollBehavior = 'auto';
          node.scrollTop += targetRect.top - mainRect.top - 8;
        }
        """,
    )
    page.wait_for_timeout(100)
    visible = page.evaluate(
        """
        () => {
          const main = document.querySelector('.library-main').getBoundingClientRect();
          return ['.facet-entry-bar', '[data-selected-facets]', '[data-facet-panel]', '#library-count']
            .every(selector => {
              const node = document.querySelector(selector);
              const rect = node?.getBoundingClientRect();
              return node && !node.hidden && rect.top >= main.top - 1 && rect.bottom <= main.bottom + 1;
            });
        }
        """,
    )
    ensure(visible, f"facet_screenshot_visible_{width}")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"paper-library-facets-{width}.png"
    page.screenshot(path=str(path))
    return path


def run_facet_ui_checks(page: Page, width: int) -> Path:
    triggers = page.locator("[data-facet-panel-trigger]")
    ensure(triggers.count() == 5, "facet_entry_count")
    ensure(triggers.all_inner_texts() == [label for _, label in FACET_PANEL_LABELS], "facet_entry_labels")
    ensure(page.locator("[data-facet-panel]").count() == 1, "facet_panel_single")
    ensure(page.locator("[data-selected-facets]").count() == 1, "facet_chip_region_single")
    ensure(
        triggers.evaluate_all("nodes => nodes.every(node => node.getAttribute('aria-expanded') === 'false')"),
        "facet_initial_collapsed",
    )

    screenshot_path: Path | None = None
    for query_index, (name, selections) in enumerate(REPRESENTATIVE_QUERY_SPECS):
        selected: dict[str, set[str]] = {}
        for selection_index, (path, value) in enumerate(selections):
            select_facet(page, selected, path, value, f"facet_{name}_{selection_index}")
        assert_result_ids(page, REPRESENTATIVE_QUERY_IDS[name], f"facet_{name}_exact")
        ensure(
            page.locator("[data-selected-facets] [data-remove-filter]").count() == len(selections),
            f"facet_{name}_chip_count",
        )
        if query_index == 0:
            assert_facet_layout(page, width)
            screenshot_path = capture_facet_screenshot(page, width)
            remove_path, remove_value = selections[-1]
            page.locator(
                f'[data-selected-facets] [data-remove-filter][data-facet-path="{remove_path}"]'
                f'[data-filter-value="{remove_value}"]',
            ).click()
            remaining_chips = page.locator('[data-selected-facets] [data-remove-filter]')
            focus_state = remaining_chips.evaluate_all(
                """
                nodes => {
                  const active = document.activeElement;
                  const first = nodes[0] ?? null;
                  return {
                    count: nodes.length,
                    activeIsFirst: Boolean(first && active === first && active.isConnected),
                    kind: active?.dataset?.filterKind ?? '',
                    path: active?.dataset?.facetPath ?? '',
                    value: active?.dataset?.filterValue ?? '',
                  };
                }
                """,
            )
            expected_focus_path, expected_focus_value = selections[0]
            ensure(focus_state["count"] == len(selections) - 1, "facet_chip_remove_focus_count")
            ensure(
                focus_state == {
                    "count": len(selections) - 1,
                    "activeIsFirst": True,
                    "kind": "facet",
                    "path": expected_focus_path,
                    "value": expected_focus_value,
                },
                "facet_chip_remove_focus",
            )
            selected[remove_path].remove(remove_value)
            if not selected[remove_path]:
                del selected[remove_path]
            assert_result_ids(page, expected_filter_ids(selected), "facet_chip_remove_results")
            ensure(
                page.locator(
                    f'[data-selected-facets] [data-remove-filter][data-facet-path="{remove_path}"]'
                    f'[data-filter-value="{remove_value}"]',
                ).count() == 0,
                "facet_chip_removed",
            )
        reset_filters(page, f"facet_{name}_reset")

    selected = {}
    select_facet(page, selected, "constraints.form", "等式约束", "facet_same_path_first")
    select_facet(page, selected, "constraints.form", "不等式约束", "facet_same_path_second")
    expected_union = {
        paper["paper_id"]
        for paper in PAPERS
        if {"等式约束", "不等式约束"} & set(facet_values(paper, "constraints.form"))
    }
    assert_result_ids(page, expected_union, "facet_same_path_or")
    reset_filters(page, "facet_same_path_reset")

    search = page.locator("#library-search")
    search.fill("Tracking-ADMM")
    tracking_ids = {
        paper["paper_id"]
        for paper in PAPERS
        if "Tracking-ADMM" in paper.get("source_terms", [])
    }
    ensure(tracking_ids, "source_term_tracking_fixture")
    assert_result_ids(page, tracking_ids, "source_term_tracking_results")
    ensure("原文术语" in (row_for_id(page, "Falsone20-TADMM").get_attribute("data-hit-fields") or ""), "source_term_tracking_hit")
    for panel, _label in FACET_PANEL_LABELS:
        open_facet_panel(page, panel)
        values = page.locator('[data-facet-panel] input[data-filter-kind="facet"]').evaluate_all(
            "nodes => nodes.map(node => node.value)",
        )
        ensure("Tracking-ADMM" not in values, "source_term_not_facet")
    reset_filters(page, "source_term_reset")

    open_facet_panel(page, "more")
    record_types = page.locator('[data-facet-panel] input[data-filter-kind="recordType"]')
    ensure(record_types.count() == 4, "record_type_options")
    ensure(
        record_types.evaluate_all("nodes => nodes.every(node => !node.dataset.facetPath && !node.closest('[data-facet-path]'))"),
        "record_type_separate_axis",
    )
    record_type_value = "学位论文章节"
    record_type_values = record_types.evaluate_all("nodes => nodes.map(node => node.value)")
    ensure(record_type_value in record_type_values, "record_type_fixture")
    record_types.nth(record_type_values.index(record_type_value)).check()
    record_type_ids = {paper["paper_id"] for paper in PAPERS if paper.get("record_type") == record_type_value}
    assert_result_ids(page, record_type_ids, "record_type_results")
    ensure(
        page.locator('[data-selected-facets] [data-remove-filter][data-filter-kind="recordType"]').count() == 1,
        "record_type_chip",
    )
    reset_filters(page, "record_type_reset")
    ensure(screenshot_path is not None and screenshot_path.is_file(), f"facet_screenshot_{width}")
    return screenshot_path


def run_material_filter_checks(page: Page) -> None:
    for axis, value, expected_ids in MATERIAL_FILTER_FIXTURES:
        checkbox = material_checkbox_for(page, axis, value)
        checkbox.check()
        assert_result_ids(page, expected_ids, f"material_{axis}")
        reset_filters(page, f"material_{axis}_reset")


def select_with_keyboard(page: Page, paper_id: str) -> None:
    button = row_for_id(page, paper_id).locator('[data-action="select-paper"]')
    button.focus()
    page.keyboard.press("Enter")
    focus_matches = page.evaluate(
        """
        paperId => {
          const target = document.activeElement;
          return target?.dataset.action === 'select-paper'
            && target.closest('[data-paper-id]')?.dataset.paperId === paperId;
        }
        """,
        paper_id,
    )
    ensure(focus_matches, "selected_row_focus_restore")
    assert_focus_ring(page)
    ensure(inspector_matches(page, paper_id), "inspector_selection_sync")


def inspector_action(page: Page, action: str, attribute: str, value: str):
    return page.locator(
        f'#library-inspector [data-action="{action}"][data-{attribute}="{value}"]',
    )


def run_workspace_checks(page: Page, guard: NetworkGuard, paper_id: str) -> None:
    baseline_status = inspector_status_signature(page)
    ensure(len(baseline_status) == 3, "formal_status_badges")

    empty_paths = [
        path for path in FACET_GROUP_BY_PATH
        if facet_values(PREVIEW_PAPER, path) == []
    ]
    ensure(empty_paths, "facet_state_empty_fixture")
    for path in empty_paths:
        expected = {
            "unrecorded": "未记录",
            "not_applicable": "不适用",
            "pending_verification": "待核验",
        }[PREVIEW_PAPER.get("facet_states", {}).get(path, "unrecorded")]
        profile = page.locator(f'[data-profile-path="{path}"]')
        ensure(profile.count() == 1, f"facet_profile_{path}")
        ensure(expected in profile.inner_text(), f"facet_profile_state_{path}")
    expected_pending = sum(
        PREVIEW_PAPER.get("facet_states", {}).get(path) == "pending_verification"
        for path in empty_paths
    )
    ensure(
        page.locator(".library-profile-empty--pending-verification").count() == expected_pending,
        "facet_profile_pending_count",
    )

    for role in P02_ROLES:
        button = inspector_action(page, "toggle-shelf", "role", role)
        ensure(button.get_attribute("aria-pressed") == "false", "role_initial")
        button.click()
        button = inspector_action(page, "toggle-shelf", "role", role)
        ensure(button.get_attribute("aria-pressed") == "true", "role_add")
        ensure(
            page.evaluate("role => document.activeElement?.dataset.role === role", role),
            "role_focus_restore",
        )
        ensure(inspector_status_signature(page) == baseline_status, "role_formal_status")
        button.click()
        button = inspector_action(page, "toggle-shelf", "role", role)
        ensure(button.get_attribute("aria-pressed") == "false", "role_remove")

    for role in P02_ROLES:
        inspector_action(page, "toggle-shelf", "role", role).click()
        ensure(
            inspector_action(page, "toggle-shelf", "role", role).get_attribute("aria-pressed") == "true",
            "role_persist_fixture",
        )

    response = page.reload(wait_until="networkidle")
    ensure(response is not None and response.status == 200, "role_reload_http")
    ensure(inspector_matches(page, paper_id), "role_reload_selection")
    for role in P02_ROLES:
        ensure(
            inspector_action(page, "toggle-shelf", "role", role).get_attribute("aria-pressed") == "true",
            "role_reload_persistence",
        )
    ensure(inspector_status_signature(page) == baseline_status, "role_reload_formal_status")
    ensure(guard.audit_requests == 0, "audit_eager_role_reload")

    for role in P02_ROLES[2:]:
        inspector_action(page, "toggle-shelf", "role", role).click()
        ensure(
            inspector_action(page, "toggle-shelf", "role", role).get_attribute("aria-pressed") == "false",
            "role_reload_cleanup",
        )

    for marker in READING_MARKERS:
        button = inspector_action(page, "set-reading", "marker", marker)
        button.click()
        button = inspector_action(page, "set-reading", "marker", marker)
        ensure(button.get_attribute("aria-pressed") == "true", "reading_set")
        ensure(
            page.evaluate("marker => document.activeElement?.dataset.marker === marker", marker),
            "reading_focus_restore",
        )
        ensure(inspector_status_signature(page) == baseline_status, "reading_formal_status")
        response = page.reload(wait_until="networkidle")
        ensure(response is not None and response.status == 200, "reload_http")
        ensure(inspector_matches(page, paper_id), "reading_reload_selection")
        ensure(
            inspector_action(page, "set-reading", "marker", marker).get_attribute("aria-pressed") == "true",
            "reading_reload_persistence",
        )
        ensure(inspector_status_signature(page) == baseline_status, "reading_reload_formal_status")
        ensure(guard.audit_requests == 0, "audit_eager_reload")

    first_role, second_role = P02_ROLES[:2]
    first_slot = page.locator(f'#p02-shelf [data-shelf-role="{first_role}"]')
    second_slot = page.locator(f'#p02-shelf [data-shelf-role="{second_role}"]')
    first_slot.click()
    ensure(page.locator('#p02-shelf [aria-pressed="true"]').count() == 1, "shelf_exclusive_first")
    ensure(set(visible_ids(page)) == {paper_id}, "shelf_filter_first")
    second_slot.click()
    ensure(page.locator('#p02-shelf [aria-pressed="true"]').count() == 1, "shelf_exclusive_second")
    ensure(set(visible_ids(page)) == {paper_id}, "shelf_filter_second")
    second_slot.click()
    ensure(page.locator('#p02-shelf [aria-pressed="true"]').count() == 0, "shelf_filter_clear")
    ensure(set(visible_ids(page)) == ALL_IDS, "shelf_filter_all")

    material_checkbox_for(page, "personalReadingMarkers", "read").check()
    ensure(set(visible_ids(page)) == {paper_id}, "reading_material_filter")
    page.locator("#library-search").fill(paper_id)
    state_before_reset = read_storage(page)
    page.locator("#library-reset").click()
    state_after_reset = read_storage(page)
    ensure(state_after_reset == state_before_reset, "reset_workspace_state")
    ensure(page.locator("#library-search").input_value() == "", "reset_search")
    ensure(page.locator('#library-filters input[type="checkbox"]:checked').count() == 0, "reset_checkbox")
    ensure(set(visible_ids(page)) == ALL_IDS, "reset_all_results")
    ensure(state_after_reset.get("selectedPaperId") == paper_id, "reset_selection")
    ensure(state_after_reset.get("personalReading", {}).get(paper_id) == "read", "reset_reading")
    ensure(state_after_reset.get("shelf", {}).get(paper_id) == list(P02_ROLES[:2]), "reset_shelf")


def run_keyboard_checks(page: Page, paper_id: str) -> None:
    page.locator("#library-sort").focus()
    page.keyboard.press("Meta+K")
    ensure(page.evaluate("document.activeElement?.id") == "library-search", "meta_k")
    assert_focus_ring(page)

    page.locator("#library-search").fill(paper_id)
    select_button = row_for_id(page, paper_id).locator('[data-action="select-paper"]')
    select_button.focus()
    page.keyboard.press("Space")
    ensure(inspector_matches(page, paper_id), "space_select_activation")
    ensure(
        page.evaluate(
            "paperId => document.activeElement?.dataset.action === 'select-paper' && document.activeElement.closest('[data-paper-id]')?.dataset.paperId === paperId",
            paper_id,
        ),
        "space_select_focus_restore",
    )
    assert_focus_ring(page)
    page.keyboard.press("Tab")
    ensure(
        page.evaluate(
            "paperId => document.activeElement?.dataset.action === 'open-detail' && document.activeElement.closest('[data-paper-id]')?.dataset.paperId === paperId",
            paper_id,
        ),
        "tab_select_to_detail",
    )
    assert_focus_ring(page)
    page.keyboard.press("Space")
    ensure(page.locator("#library-detail").is_visible(), "space_detail_activation")
    assert_reader_context(page, paper_id, "space_detail_selection")
    page.locator("#library-detail-back").click()
    ensure(page.locator('[data-view="list"]').is_visible(), "keyboard_detail_return")
    page.keyboard.press("Shift+Tab")
    ensure(
        page.evaluate(
            "paperId => document.activeElement?.dataset.action === 'select-paper' && document.activeElement.closest('[data-paper-id]')?.dataset.paperId === paperId",
            paper_id,
        ),
        "shift_tab_detail_to_select",
    )
    assert_focus_ring(page)
    page.locator("#library-search").fill("")


def capture_table_screenshot(page: Page, width: int) -> None:
    page.locator("#library-reset").click()
    page.locator("#library-search").fill(LONGEST_ROW_ID)
    row = row_for_id(page, LONGEST_ROW_ID)
    row.locator('[data-action="select-paper"]').click()
    row.scroll_into_view_if_needed()
    wrap = page.locator(".library-table-wrap")
    wrap.evaluate(
        "node => { node.style.scrollBehavior = 'auto'; node.scrollLeft = node.scrollWidth - node.clientWidth; }",
    )
    metrics = page.evaluate(
        """
        paperId => {
          const row = document.querySelector(`[data-paper-id="${CSS.escape(paperId)}"]`);
          const wrap = document.querySelector('.library-table-wrap');
          const main = document.querySelector('.library-main');
          const detail = row?.querySelector('[data-action="open-detail"]');
          const rowRect = row?.getBoundingClientRect();
          const mainRect = main?.getBoundingClientRect();
          const detailRect = detail?.getBoundingClientRect();
          return {
            rowVisible: Boolean(rowRect && mainRect && rowRect.top >= mainRect.top && rowRect.bottom <= mainRect.bottom),
            detailVisible: Boolean(detailRect && detailRect.left >= 0 && detailRect.right <= innerWidth),
            scrollLeft: wrap?.scrollLeft ?? -1,
            maxScroll: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
          };
        }
        """,
        LONGEST_ROW_ID,
    )
    ensure(metrics["rowVisible"], "table_screenshot_row_visible")
    ensure(metrics["detailVisible"], "table_screenshot_detail_visible")
    ensure(metrics["scrollLeft"] == metrics["maxScroll"], "table_screenshot_scroll_state")
    if width == 1280:
        ensure(metrics["maxScroll"] > 0, "table_screenshot_internal_overflow")
    page.screenshot(path=str(OUT / f"paper-library-table-{width}.png"), full_page=True)


def open_detail(page: Page, paper_id: str) -> None:
    page.locator("#library-reset").click()
    page.locator("#library-search").fill(paper_id)
    row_for_id(page, paper_id).locator('[data-action="open-detail"]').click()
    ensure(page.locator("#library-detail").is_visible(), "detail_visible")
    assert_reader_context(page, paper_id, "detail_selection_sync")
    ensure(inspector_matches(page, paper_id), "detail_inspector_sync")


def assert_reader_context(page: Page, paper_id: str, code_prefix: str) -> None:
    context = page.locator("#library-context-title")
    ensure(context.count() == 1 and context.inner_text().strip() == paper_id, f"{code_prefix}_context")
    ensure(
        page.locator('#library-detail[aria-labelledby="library-context-title"]').count() == 1,
        f"{code_prefix}_labelled_region",
    )
    ensure(page.get_by_role("region", name=paper_id).count() == 1, f"{code_prefix}_region_name")
    ensure(page.locator("#library-detail [data-detail-content]").count() == 0, f"{code_prefix}_no_large_heading")


def return_from_detail(page: Page, paper_id: str) -> None:
    page.locator("#library-detail-back").click()
    ensure(page.locator('[data-view="list"]').is_visible(), "detail_return")
    ensure(page.locator("#library-context-title").inner_text().strip() == "论文库", "detail_context_reset")
    focus_matches = page.evaluate(
        """
        paperId => {
          const target = document.activeElement;
          return target?.dataset.action === 'open-detail'
            && target.closest('[data-paper-id]')?.dataset.paperId === paperId;
        }
        """,
        paper_id,
    )
    ensure(focus_matches, "detail_return_focus")
    page.locator("#library-search").fill("")


def assert_pending_identity(scope, code_prefix: str) -> None:
    badge = scope.locator('[data-identity-status="pending"]')
    ensure(badge.count() == 1 and badge.is_visible(), f"{code_prefix}_identity_badge")
    ensure(badge.inner_text().strip() == "待整理身份", f"{code_prefix}_identity_text")


def assert_source_directory(scope, expected: str, code_prefix: str) -> None:
    source = scope.locator("[data-source-directory]")
    ensure(source.count() == 1 and source.is_visible(), f"{code_prefix}_source_visible")
    ensure("来源目录" in source.inner_text(), f"{code_prefix}_source_label")
    value = source.locator("[data-relative-path]").inner_text().strip()
    ensure(value == expected, f"{code_prefix}_source_value")
    ensure(is_safe_source_relative_path(value), f"{code_prefix}_source_relative")


def run_metadata_display_checks(page: Page) -> None:
    ensure(
        page.locator("#library-coverage-summary").inner_text().strip() == EXPECTED_COVERAGE_TEXT,
        "metadata_coverage_summary",
    )
    search = page.locator("#library-search")
    for paper in IDENTITY_PENDING_PAPERS:
        paper_id = paper["paper_id"]
        relative_path = paper["relative_path"]
        search.fill(paper_id)
        row = row_for_id(page, paper_id)
        assert_pending_identity(row, "row")
        assert_source_directory(row, relative_path, "row")
        row.locator('[data-action="select-paper"]').click()
        inspector = page.locator("#library-inspector [data-inspector-content]")
        assert_pending_identity(inspector, "inspector")
        assert_source_directory(inspector, relative_path, "inspector")
        row_for_id(page, paper_id).locator('[data-action="open-detail"]').click()
        ensure(page.locator("#library-detail").is_visible(), "identity_detail_visible")
        assert_reader_context(page, paper_id, "identity_detail")
        return_from_detail(page, paper_id)

    if UNTITLED_PAPER is not None and UNTITLED_ID is not None:
        search.fill(UNTITLED_ID)
        untitled_row = row_for_id(page, UNTITLED_ID)
        ensure(
            untitled_row.locator('[data-field="title"]').inner_text().strip() == "暂无书目信息",
            "untitled_row_placeholder",
        )
        assert_source_directory(untitled_row, UNTITLED_PAPER["relative_path"], "untitled_row")
        untitled_row.locator('[data-action="select-paper"]').click()
        untitled_inspector = page.locator("#library-inspector [data-inspector-content]")
        ensure(
            untitled_inspector.locator(".library-inspector-paper-heading h3").inner_text().strip() == "暂无书目信息",
            "untitled_inspector_placeholder",
        )
        assert_source_directory(untitled_inspector, UNTITLED_PAPER["relative_path"], "untitled_inspector")
        row_for_id(page, UNTITLED_ID).locator('[data-action="open-detail"]').click()
        assert_reader_context(page, UNTITLED_ID, "untitled_detail")
        page.locator('[data-reader-tab="overview"]').click()
        ensure(
            page.locator("[data-reader-overview-content] .library-reader-summary-card h3").inner_text().strip()
            == "暂无书目信息",
            "untitled_detail_placeholder",
        )
        return_from_detail(page, UNTITLED_ID)


def reader_panel_metrics(page: Page, tab: str, preview_selector: str) -> dict:
    page.locator(f'[data-reader-tab="{tab}"]').click()
    page.wait_for_function(
        """
        selector => {
          const mount = document.querySelector(selector);
          return mount && mount.textContent.trim().length > 0 && mount.children.length > 0;
        }
        """,
        arg=preview_selector,
    )
    return page.evaluate(
        """
        ({ tab, previewSelector }) => {
          const panel = document.querySelector(`[data-reader-panel="${tab}"]`);
          const preview = document.querySelector(previewSelector);
          const style = preview ? getComputedStyle(preview) : null;
          const rect = preview?.getBoundingClientRect();
          const mathNodes = preview
            ? [...preview.querySelectorAll('.math-inline, .math-display')]
            : [];
          const renderedMath = mathNodes.filter(node =>
            node.querySelector(':scope > .katex, :scope > .katex-display')
          );
          const rawFallbackCount = mathNodes.filter(node => {
            const copy = node.cloneNode(true);
            copy.querySelectorAll('.katex').forEach(rendered => rendered.remove());
            return /\\\\[A-Za-z]+|[_^]\\{/.test(copy.textContent || '');
          }).length;
          const codeBlocks = preview ? [...preview.querySelectorAll('pre')] : [];
          return {
            selectedTabs: [...document.querySelectorAll('#library-reader-tabs [aria-selected="true"]')]
              .map(node => node.dataset.readerTab),
            visiblePanels: [...document.querySelectorAll('[data-reader-panel]')]
              .filter(node => !node.hidden)
              .map(node => node.dataset.readerPanel),
            directChildren: panel
              ? [...panel.children].map(node => {
                  if (node.classList.contains('library-reader-section-heading')) return 'heading';
                  if (node.classList.contains('library-reader-document')) return 'document';
                  return `other:${node.className}`;
                })
              : [],
            rect: rect ? { left: rect.left, width: rect.width } : null,
            style: style ? {
              paddingTop: style.paddingTop,
              paddingRight: style.paddingRight,
              paddingBottom: style.paddingBottom,
              paddingLeft: style.paddingLeft,
              borderTopWidth: style.borderTopWidth,
              borderRightWidth: style.borderRightWidth,
              borderBottomWidth: style.borderBottomWidth,
              borderLeftWidth: style.borderLeftWidth,
              backgroundColor: style.backgroundColor,
            } : null,
            mathCount: mathNodes.length,
            renderedMathCount: renderedMath.length,
            inlineKatexCount: preview?.querySelectorAll('.math-inline > .katex').length ?? 0,
            displayKatexCount: preview?.querySelectorAll('.math-display > .katex, .math-display > .katex-display').length ?? 0,
            katexErrorCount: preview?.querySelectorAll('.katex-error').length ?? 0,
            inlineScrollContainerCount: mathNodes.filter(node => {
              if (!node.classList.contains('math-inline')) return false;
              const inlineStyle = getComputedStyle(node);
              return inlineStyle.display !== 'inline'
                || inlineStyle.overflowX !== 'visible'
                || inlineStyle.overflowY !== 'visible';
            }).length,
            rawFallbackCount,
            fencedCodeCount: codeBlocks.length,
            fencedCodeWithTexCount: codeBlocks.filter(node => /\\\\[A-Za-z]+|[_^]\\{/.test(node.textContent || '')).length,
            fencedCodeMathCount: preview?.querySelectorAll('pre .katex, pre math').length ?? 0,
          };
        }
        """,
        {"tab": tab, "previewSelector": preview_selector},
    )


def wait_for_source_ocr(page: Page) -> None:
    page.wait_for_function(
        """
        () => {
          const mount = document.querySelector('#library-source-ocr-preview');
          return mount
            && !mount.classList.contains('library-preview-loading')
            && mount.children.length > 0
            && mount.textContent.trim().length > 0
            && !mount.textContent.includes('正在读取');
        }
        """,
    )


def source_response_checks(response, expected_url: str, kind: str) -> None:
    ensure(response.url == expected_url, f"source_{kind}_response_url")
    ensure(response.status == 200, f"source_{kind}_http_200")
    content_type = response.headers.get("content-type", "").lower()
    expected_type = "application/pdf" if kind == "pdf" else "text/html"
    ensure(content_type.startswith(expected_type), f"source_{kind}_content_type")


def wait_for_source_pdf_settled(page: Page, guard: NetworkGuard, expected_url: str, code: str) -> None:
    page.wait_for_load_state("networkidle")
    ensure(page.locator("#library-source-pdf-frame").get_attribute("src") == expected_url, f"{code}_src")
    statuses = guard.statuses.get(expected_url, [])
    ensure(statuses and all(status == 200 for status in statuses), f"{code}_http")
    expected_basename = Path(urlparse(expected_url).path).name
    ensure(
        not any(
            detail["category"] == "source" and detail["basename"] == expected_basename
            for detail in guard.request_failure_details
        ),
        f"{code}_request_failure",
    )


def source_view_metrics(page: Page) -> dict:
    return page.evaluate(
        """
        () => {
          const rect = selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const value = node.getBoundingClientRect();
            return {
              left: value.left,
              top: value.top,
              right: value.right,
              bottom: value.bottom,
              width: value.width,
              height: value.height,
            };
          };
          const visible = selector => {
            const node = document.querySelector(selector);
            return Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none');
          };
          const preview = document.querySelector('#library-source-ocr-preview');
          const unsafeOcrAttributes = preview
            ? [...preview.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || ['href', 'xlink:href', 'srcset'].includes(name)) return true;
                return name === 'src' && node.tagName !== 'IMG';
              }))
            : true;
          const mathNodes = preview
            ? [...preview.querySelectorAll('.math-inline, .math-display')]
            : [];
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            selectedTabs: [...document.querySelectorAll('#library-reader-tabs [aria-selected="true"]')]
              .map(node => node.dataset.readerTab),
            visiblePanels: [...document.querySelectorAll('[data-reader-panel]')]
              .filter(node => !node.hidden)
              .map(node => node.dataset.readerPanel),
            activeModes: [...document.querySelectorAll('[data-source-mode][aria-pressed="true"]')]
              .map(node => node.dataset.sourceMode),
            enabledModes: [...document.querySelectorAll('[data-source-mode]:not(:disabled)')]
              .map(node => node.dataset.sourceMode),
            mode: document.querySelector('[data-source-workspace]')?.dataset.sourceMode ?? null,
            panel: rect('[data-reader-panel="source"]'),
            toolbar: rect('.library-source-toolbar'),
            workspace: rect('[data-source-workspace]'),
            pdfPane: rect('[data-source-pane="pdf"]'),
            ocrPane: rect('[data-source-pane="ocr"]'),
            pdfFrame: rect('#library-source-pdf-frame'),
            ocrPreview: rect('#library-source-ocr-preview'),
            pdfVisible: visible('[data-source-pane="pdf"]'),
            ocrVisible: visible('[data-source-pane="ocr"]'),
            pdfFrameVisible: visible('#library-source-pdf-frame'),
            fallbackVisible: visible('#library-source-pdf-open'),
            tocVisible: visible('#library-reader-toc'),
            unsafeOcrTagCount: preview
              ? preview.querySelectorAll('script, iframe, object, embed, form, input, link, style').length
              : -1,
            unsafeOcrAttributes,
            imageSources: preview ? [...preview.querySelectorAll('img')].map(image => image.src) : [],
            mathCount: mathNodes.length,
            renderedMathCount: mathNodes.filter(node =>
              node.querySelector(':scope > .katex, :scope > .katex-display')
            ).length,
            katexErrorCount: preview?.querySelectorAll('.katex-error').length ?? -1,
          };
        }
        """,
    )


def assert_source_compare_geometry(metrics: dict, width: int, slug: str) -> None:
    ensure(metrics["viewportWidth"] == width, "source_viewport_width")
    ensure(metrics["documentWidth"] <= width, "source_horizontal_overflow")
    ensure(metrics["selectedTabs"] == ["source"], "source_selected_tab")
    ensure(metrics["visiblePanels"] == ["source"], "source_visible_panel")
    ensure(metrics["activeModes"] == ["compare"], "source_compare_active")
    ensure(set(metrics["enabledModes"]) == {"compare", "pdf", "ocr"}, "source_modes_enabled")
    ensure(metrics["mode"] == "compare", "source_workspace_compare")
    ensure(metrics["pdfVisible"] and metrics["ocrVisible"], "source_compare_panes_visible")
    ensure(metrics["pdfFrameVisible"] and metrics["fallbackVisible"], "source_pdf_entry_visible")
    ensure(not metrics["tocVisible"], "source_toc_hidden")

    panel = metrics["panel"]
    toolbar = metrics["toolbar"]
    workspace = metrics["workspace"]
    pdf_pane = metrics["pdfPane"]
    ocr_pane = metrics["ocrPane"]
    pdf_frame = metrics["pdfFrame"]
    ocr_preview = metrics["ocrPreview"]
    ensure(all(isinstance(value, dict) for value in (panel, toolbar, workspace, pdf_pane, ocr_pane, pdf_frame, ocr_preview)), "source_geometry_nodes")
    ensure(panel["left"] >= 0 and panel["right"] <= width + 1, "source_panel_inside_viewport")
    ensure(toolbar["left"] >= panel["left"] - 1 and toolbar["right"] <= panel["right"] + 1, "source_toolbar_inside_panel")
    ensure(workspace["left"] >= panel["left"] - 1 and workspace["right"] <= panel["right"] + 1, "source_workspace_inside_panel")
    ensure(pdf_pane["left"] >= workspace["left"] - 1 and ocr_pane["right"] <= workspace["right"] + 1, "source_panes_inside_workspace")
    ensure(pdf_pane["right"] <= ocr_pane["left"] + 1, "source_panes_do_not_overlap")
    ensure(pdf_pane["width"] > ocr_pane["width"] >= 360, "source_compare_column_widths")
    ensure(
        pdf_frame["left"] >= pdf_pane["left"] - 1
        and pdf_frame["right"] <= pdf_pane["right"] + 1
        and pdf_frame["bottom"] <= pdf_pane["bottom"] + 1
        and pdf_frame["height"] >= 300,
        "source_pdf_frame_geometry",
    )
    ensure(
        ocr_preview["left"] >= ocr_pane["left"] - 1
        and ocr_preview["right"] <= ocr_pane["right"] + 1
        and ocr_preview["bottom"] <= ocr_pane["bottom"] + 1
        and ocr_preview["height"] >= 250,
        "source_ocr_geometry",
    )
    ensure(metrics["unsafeOcrTagCount"] == 0 and not metrics["unsafeOcrAttributes"], "source_ocr_sanitized")
    ensure(metrics["katexErrorCount"] == 0, "source_ocr_katex_error_free")
    ensure(metrics["renderedMathCount"] == metrics["mathCount"], "source_ocr_katex_complete")
    expected_image_prefix = f"{ORIGIN}/local_library_data/sources/{slug}/assets/"
    ensure(
        all(source.startswith(expected_image_prefix) for source in metrics["imageSources"]),
        "source_ocr_image_paths",
    )


def run_source_material_checks(page: Page, guard: NetworkGuard, width: int) -> None:
    paper = SOURCE_PDF_PAPER
    paper_id = paper["paper_id"]
    pdf_documents = source_documents_for(paper, "pdf")
    ocr_documents = source_documents_for(paper, "ocr")
    first_pdf_url = source_document_url(paper, "pdf", 0)
    first_ocr_url = source_document_url(paper, "ocr", 0)

    open_detail(page, paper_id)
    with page.expect_response(lambda response: response.url == first_pdf_url) as pdf_info:
        with page.expect_response(lambda response: response.url == first_ocr_url) as ocr_info:
            page.locator('[data-reader-tab="source"]').click()
    source_response_checks(pdf_info.value, first_pdf_url, "pdf")
    source_response_checks(ocr_info.value, first_ocr_url, "ocr")
    wait_for_source_ocr(page)
    wait_for_source_pdf_settled(page, guard, first_pdf_url, "source_initial_pdf_settled")

    metrics = source_view_metrics(page)
    assert_source_compare_geometry(metrics, width, paper["slug"])
    fallback = page.locator("#library-source-pdf-open")
    ensure(fallback.get_attribute("href") == first_pdf_url, "source_pdf_fallback_href")
    ensure(fallback.get_attribute("target") == "_blank", "source_pdf_fallback_target")
    ensure(
        {"noopener", "noreferrer"}.issubset(set((fallback.get_attribute("rel") or "").split())),
        "source_pdf_fallback_rel",
    )
    ensure(page.locator("#library-source-pdf-frame").get_attribute("src") == first_pdf_url, "source_pdf_iframe_src")

    pdf_select = page.locator("#library-source-pdf-select")
    pdf_control = page.locator('[data-source-version-control="pdf"]')
    ocr_control = page.locator('[data-source-version-control="ocr"]')
    ensure(pdf_control.is_visible() and not pdf_select.is_disabled(), "source_multi_pdf_control")
    ensure(pdf_select.locator("option").count() == len(pdf_documents), "source_multi_pdf_options")
    ensure(not ocr_control.is_visible(), "source_single_ocr_control_hidden")
    second_pdf_url = source_document_url(paper, "pdf", 1)
    with page.expect_response(lambda response: response.url == second_pdf_url) as second_pdf_info:
        pdf_select.select_option("1")
    source_response_checks(second_pdf_info.value, second_pdf_url, "pdf")
    ensure(pdf_select.input_value() == "1", "source_multi_pdf_selected")
    ensure(page.locator("#library-source-pdf-frame").get_attribute("src") == second_pdf_url, "source_multi_pdf_iframe")
    ensure(fallback.get_attribute("href") == second_pdf_url, "source_multi_pdf_fallback")
    ensure(
        page.locator("[data-source-pdf-label]").inner_text().strip() == pdf_documents[1]["label"],
        "source_multi_pdf_label",
    )

    page.locator('[data-source-mode="pdf"]').click()
    page.wait_for_function("() => document.querySelector('[data-source-workspace]')?.dataset.sourceMode === 'pdf'")
    pdf_mode = source_view_metrics(page)
    ensure(pdf_mode["activeModes"] == ["pdf"], "source_pdf_mode_active")
    ensure(pdf_mode["pdfVisible"] and not pdf_mode["ocrVisible"], "source_pdf_mode_panes")
    ensure(pdf_mode["pdfFrameVisible"] and pdf_mode["fallbackVisible"], "source_pdf_mode_entry")

    page.locator('[data-source-mode="ocr"]').click()
    page.wait_for_function("() => document.querySelector('[data-source-workspace]')?.dataset.sourceMode === 'ocr'")
    wait_for_source_ocr(page)
    ocr_mode = source_view_metrics(page)
    ensure(ocr_mode["activeModes"] == ["ocr"], "source_ocr_mode_active")
    ensure(not ocr_mode["pdfVisible"] and ocr_mode["ocrVisible"], "source_ocr_mode_panes")
    ensure(not ocr_mode["pdfFrameVisible"] and not ocr_mode["fallbackVisible"], "source_ocr_mode_hides_pdf")
    ensure(
        page.locator("#library-source-pdf-frame").get_attribute("src") == second_pdf_url,
        "source_ocr_mode_preserves_iframe",
    )
    ensure(fallback.get_attribute("href") is None, "source_ocr_mode_clears_fallback")

    pdf_response_count_before_compare = len(guard.statuses.get(second_pdf_url, []))
    page.locator('[data-source-mode="compare"]').click()
    page.wait_for_function("() => document.querySelector('[data-source-workspace]')?.dataset.sourceMode === 'compare'")
    page.wait_for_timeout(250)
    ensure(source_view_metrics(page)["activeModes"] == ["compare"], "source_compare_mode_restored")
    ensure(
        page.locator("#library-source-pdf-frame").get_attribute("src") == second_pdf_url,
        "source_compare_preserves_iframe",
    )
    ensure(
        len(guard.statuses.get(second_pdf_url, [])) == pdf_response_count_before_compare,
        "source_compare_does_not_reload_pdf",
    )
    ensure(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "source_mode_horizontal_overflow")
    return_from_detail(page, paper_id)

    ocr_paper = SOURCE_OCR_PAPER
    ocr_paper_id = ocr_paper["paper_id"]
    ocr_versions = source_documents_for(ocr_paper, "ocr")
    initial_pdf_url = source_document_url(ocr_paper, "pdf", 0)
    initial_ocr_url = source_document_url(ocr_paper, "ocr", 0)
    open_detail(page, ocr_paper_id)
    with page.expect_response(lambda response: response.url == initial_pdf_url) as initial_pdf_info:
        with page.expect_response(lambda response: response.url == initial_ocr_url) as initial_ocr_info:
            page.locator('[data-reader-tab="source"]').click()
    source_response_checks(initial_pdf_info.value, initial_pdf_url, "pdf")
    source_response_checks(initial_ocr_info.value, initial_ocr_url, "ocr")
    wait_for_source_ocr(page)
    ocr_select = page.locator("#library-source-ocr-select")
    ensure(page.locator('[data-source-version-control="ocr"]').is_visible(), "source_multi_ocr_control")
    ensure(not ocr_select.is_disabled(), "source_multi_ocr_enabled")
    ensure(ocr_select.locator("option").count() == len(ocr_versions), "source_multi_ocr_options")
    ensure(not page.locator('[data-source-version-control="pdf"]').is_visible(), "source_single_pdf_control_hidden")
    second_ocr_url = source_document_url(ocr_paper, "ocr", 1)
    with page.expect_response(lambda response: response.url == second_ocr_url) as second_ocr_info:
        ocr_select.select_option("1")
    source_response_checks(second_ocr_info.value, second_ocr_url, "ocr")
    wait_for_source_ocr(page)
    ensure(ocr_select.input_value() == "1", "source_multi_ocr_selected")
    ensure(
        page.locator("[data-source-ocr-label]").inner_text().strip() == ocr_versions[1]["label"],
        "source_multi_ocr_label",
    )
    ensure(guard.statuses.get(second_ocr_url) and all(status == 200 for status in guard.statuses[second_ocr_url]), "source_multi_ocr_guard")
    ensure(
        guard.content_types.get(second_ocr_url)
        and all(content_type.lower().startswith("text/html") for content_type in guard.content_types[second_ocr_url]),
        "source_multi_ocr_guard_type",
    )
    ensure(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "source_multi_ocr_overflow")
    return_from_detail(page, ocr_paper_id)


def run_reader_acceptance_checks(page: Page, guard: NetworkGuard) -> None:
    failures: list[str] = []

    def check(condition: bool, code: str) -> None:
        if not condition:
            failures.append(code)

    open_detail(page, PREVIEW_ID)
    layout = page.evaluate(
        """
        () => {
          const toolbar = document.querySelector('.library-reader-toolbar')?.getBoundingClientRect();
          const tabs = document.querySelector('#library-reader-tabs')?.getBoundingClientRect();
          return {
            tabs: [...document.querySelectorAll('#library-reader-tabs [role="tab"]')].map(node => ({
              key: node.dataset.readerTab,
              label: node.textContent.trim(),
              controls: node.getAttribute('aria-controls'),
            })),
            toolbarBottom: toolbar?.bottom ?? null,
            tabsTop: tabs?.top ?? null,
            legacyHeadingCount: document.querySelectorAll('.library-reader-paper-heading, #library-detail-title').length,
          };
        }
        """
    )
    expected_tabs = [
        ("overview", "快速概览"),
        ("source", "原文材料"),
        ("note", "论文精读"),
        ("derivation", "推导过程"),
        ("simulation", "仿真描述"),
        ("code_compare", "代码对照"),
        ("writing", "写作用途"),
    ]
    check(
        [
            (tab["key"], tab["label"], tab["controls"])
            for tab in layout["tabs"]
        ]
        == [
            (key, label, f"library-reader-panel-{key}")
            for key, label in expected_tabs
        ],
        "reader_seven_tabs",
    )
    check(layout["legacyHeadingCount"] == 0, "reader_large_heading_removed")
    check(
        layout["toolbarBottom"] is not None
        and layout["tabsTop"] is not None
        and abs(layout["tabsTop"] - layout["toolbarBottom"]) <= 1,
        "reader_tabs_touch_toolbar",
    )

    note = reader_panel_metrics(page, "note", "#library-note-preview")
    derivation = reader_panel_metrics(page, "derivation", "#library-derivation-preview")
    simulation = reader_panel_metrics(page, "simulation", "#library-simulation-preview")
    simulation_request_count = len(guard.preview_statuses.get("simulation", []))
    check(simulation_request_count > 0, "reader_simulation_requested")
    check(not guard.preview_statuses.get("code_compare", []), "reader_simulation_does_not_load_code")
    code_compare = reader_panel_metrics(page, "code_compare", "#library-code-compare-preview")
    check(
        len(guard.preview_statuses.get("simulation", [])) == simulation_request_count,
        "reader_code_does_not_reload_simulation",
    )

    viewport = page.viewport_size or {}
    capture_reader = viewport.get("width") == 1280
    if capture_reader:
        page.locator('[data-reader-tab="note"]').click()
        page.wait_for_function(
            "() => !document.querySelector('#library-note-preview')?.textContent.includes('正在读取')",
        )
        page.locator(".library-main").evaluate("node => { node.scrollTop = 0; }")
        page.screenshot(path=str(OUT / "paper-reader-note-1280.png"))
        page.locator('[data-reader-tab="derivation"]').click()
        page.wait_for_function(
            "() => !document.querySelector('#library-derivation-preview')?.textContent.includes('正在读取')",
        )
        page.locator(".library-main").evaluate("node => { node.scrollTop = 0; }")
        page.screenshot(path=str(OUT / "paper-reader-derivation-1280.png"))
        page.locator("#library-derivation-preview .math-display").first.scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / "paper-reader-math-1280.png"))
        page.locator('[data-reader-tab="simulation"]').click()
        page.wait_for_function(
            "() => !document.querySelector('#library-simulation-preview')?.textContent.includes('正在读取')",
        )
        page.screenshot(path=str(OUT / "paper-reader-simulation-1280.png"))
        page.locator('[data-reader-tab="code_compare"]').click()
        page.wait_for_function(
            "() => !document.querySelector('#library-code-compare-preview')?.textContent.includes('正在读取')",
        )
        page.screenshot(path=str(OUT / "paper-reader-code-compare-1280.png"))

    metrics_by_kind = {
        "note": note,
        "derivation": derivation,
        "simulation": simulation,
        "code_compare": code_compare,
    }
    for kind, metrics in metrics_by_kind.items():
        check(metrics["selectedTabs"] == [kind], f"reader_{kind}_selected_tab")
        check(metrics["visiblePanels"] == [kind], f"reader_{kind}_visible_panel")
        check(metrics["directChildren"] == ["heading", "document"], f"reader_{kind}_flat_structure")
        check(metrics["style"] == note["style"], f"reader_{kind}_style_parity")
        check(metrics["inlineScrollContainerCount"] == 0, f"reader_{kind}_inline_math_no_scroll")
        check(metrics["katexErrorCount"] == 0, f"reader_{kind}_katex_error_free")
    check(
        all(
            metrics["rect"] is not None
            and abs(note["rect"]["left"] - metrics["rect"]["left"]) <= 1
            and abs(note["rect"]["width"] - metrics["rect"]["width"]) <= 1
            for metrics in metrics_by_kind.values()
        ),
        "reader_flat_geometry_parity",
    )

    for kind, metrics in (("note", note), ("derivation", derivation)):
        check(metrics["mathCount"] > 0, f"reader_{kind}_math_fixture")
        check(
            metrics["renderedMathCount"] == metrics["mathCount"],
            f"reader_{kind}_katex_complete",
        )
        check(metrics["inlineKatexCount"] > 0, f"reader_{kind}_inline_katex")
        check(metrics["displayKatexCount"] > 0, f"reader_{kind}_display_katex")
        check(metrics["rawFallbackCount"] == 0, f"reader_{kind}_raw_tex_hidden")
        check(metrics["fencedCodeCount"] > 0, f"reader_{kind}_fenced_code_fixture")
        check(metrics["fencedCodeMathCount"] == 0, f"reader_{kind}_fenced_code_not_typeset")
    check(
        note["fencedCodeWithTexCount"] > 0 or derivation["fencedCodeWithTexCount"] > 0,
        "reader_fenced_tex_fixture",
    )

    preview_statuses = {
        kind: guard.preview_statuses.get(kind, [])
        for kind in ("note", "derivation", "simulation", "code_compare")
    }
    check(
        all(statuses for statuses in preview_statuses.values())
        and all(status == 200 for statuses in preview_statuses.values() for status in statuses),
        "reader_controlled_previews_http_200",
    )

    toc = page.locator("#library-reader-toc")
    toggle = page.locator("#library-reader-toc-toggle")
    check(toggle.count() == 1, "reader_toc_toggle_present")
    if toggle.count() == 1:
        shown_width = page.locator(".library-main").evaluate("node => node.getBoundingClientRect().width")
        check(toc.is_visible(), "reader_toc_initial_visible")
        check(toggle.get_attribute("aria-controls") == "library-reader-toc", "reader_toc_controls")
        check(toggle.get_attribute("aria-expanded") == "true", "reader_toc_initial_expanded")
        check("隐藏目录" in toggle.inner_text(), "reader_toc_initial_label")
        check(not re.search(r"\\[A-Za-z]+", toc.inner_text()), "reader_toc_raw_tex_hidden")

        toggle.click()
        hidden_width = page.locator(".library-main").evaluate("node => node.getBoundingClientRect().width")
        check(not toc.is_visible(), "reader_toc_hidden")
        check(toggle.get_attribute("aria-expanded") == "false", "reader_toc_collapsed_state")
        check("显示目录" in toggle.inner_text(), "reader_toc_collapsed_label")
        check(hidden_width >= shown_width + 180, "reader_toc_content_expands")

        page.locator('[data-reader-tab="note"]').click()
        check(not toc.is_visible(), "reader_toc_hidden_across_tabs")
        if capture_reader:
            page.locator(".library-main").evaluate("node => { node.scrollTop = 0; }")
            page.screenshot(path=str(OUT / "paper-reader-note-toc-hidden-1280.png"))
        toggle.click()
        restored_width = page.locator(".library-main").evaluate("node => node.getBoundingClientRect().width")
        check(toc.is_visible(), "reader_toc_restored")
        check(toggle.get_attribute("aria-expanded") == "true", "reader_toc_restored_state")
        check("隐藏目录" in toggle.inner_text(), "reader_toc_restored_label")
        check(abs(restored_width - shown_width) <= 2, "reader_toc_layout_restored")

    ensure(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "reader_horizontal_overflow")
    return_from_detail(page, PREVIEW_ID)
    ensure(not failures, "reader_acceptance:" + ",".join(failures))


def run_note_state_checks(page: Page, guard: NetworkGuard) -> None:
    open_detail(page, MULTI_NOTE_ID)
    page.wait_for_function(
        "text => document.querySelector('#library-note-preview')?.textContent.trim() === text",
        arg="请选择一份材料后预览。",
    )
    note_select = page.locator("#library-note-material-select")
    ensure(note_select.is_visible(), "multi_note_selector_visible")
    ensure(note_select.locator("option").count() == MULTI_NOTE_DOCUMENT_COUNT + 1, "multi_note_selector_options")
    ensure(note_select.input_value() == "", "multi_note_selector_placeholder")
    note_select.select_option("note:0")
    page.wait_for_function(
        "() => document.querySelector('#library-note-preview')?.children.length > 0",
    )
    ensure(note_select.input_value() == "note:0", "multi_note_selector_selected")
    ensure(guard.audit_requests == 0, "audit_eager_multi_note")
    return_from_detail(page, MULTI_NOTE_ID)

    open_detail(page, NO_NOTE_ID)
    page.wait_for_function(
        "text => document.querySelector('#library-note-preview')?.textContent.trim() === text",
        arg="尚无论文精读材料。",
    )
    ensure(not page.locator("#library-note-material-select").is_visible(), "no_note_selector_hidden")
    ensure(guard.audit_requests == 0, "audit_eager_no_note")
    return_from_detail(page, NO_NOTE_ID)

    open_detail(page, PREVIEW_ID)
    page.wait_for_function(
        """
        () => {
          const mount = document.querySelector('#library-note-preview');
          return mount && mount.textContent.trim().length > 0 && mount.children.length > 0;
        }
        """,
    )
    note_statuses = guard.preview_statuses.get("note", [])
    ensure(note_statuses and all(status == 200 for status in note_statuses), "preview_http_200")
    ensure(
        page.locator(
            "#library-note-preview script, #library-note-preview iframe, #library-note-preview img, "
            "#library-note-preview a, #library-note-preview object, #library-note-preview embed, "
            "#library-note-preview form, #library-note-preview input, #library-note-preview button, "
            "#library-note-preview link, #library-note-preview style"
        ).count() == 0,
        "preview_safe_tags",
    )
    active_markup = page.locator("#library-note-preview *").evaluate_all(
        """
        nodes => nodes.some(node => [...node.attributes].some(attribute => {
          const name = attribute.name.toLowerCase();
          return name.startsWith('on') || name === 'src' || name === 'href' || name === 'xlink:href';
        }))
        """
    )
    ensure(not active_markup, "preview_active_markup")
    ensure(guard.audit_requests == 0, "audit_eager_preview")
    ensure(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "detail_horizontal_overflow")
    return_from_detail(page, PREVIEW_ID)


def run_image_preview_checks(page: Page, guard: NetworkGuard) -> None:
    open_detail(page, IMAGE_PAPER_ID)
    page.locator('[data-reader-tab="code_compare"]').click()
    page.wait_for_function(
        "() => !document.querySelector('#library-code-compare-preview')?.textContent.includes('正在读取')",
    )
    images = page.locator("#library-code-compare-preview img.note-image")
    ensure(images.count() == 7, "image_preview_count")
    ensure("![[" not in page.locator("#library-code-compare-preview").inner_text(), "image_embed_rewritten")
    for index in range(images.count()):
        images.nth(index).scroll_into_view_if_needed()
    page.wait_for_function(
        """
        () => [...document.querySelectorAll('#library-code-compare-preview img.note-image')]
          .every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
        """,
    )
    image_metrics = images.evaluate_all(
        """
        nodes => nodes.map(node => ({
          src: node.src,
          complete: node.complete,
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          right: node.getBoundingClientRect().right,
          parentRight: node.closest('.library-reader-document').getBoundingClientRect().right,
          hasUnsafeAttributes: [...node.attributes].some(attribute => {
            const name = attribute.name.toLowerCase();
            return name.startsWith('on') || name === 'srcset' || name === 'style';
          }),
        }))
        """
    )
    ensure(all(item["src"].startswith(f"{ORIGIN}/local_library_data/notes/liu24-lct/assets/") for item in image_metrics), "image_asset_path")
    ensure(all(item["complete"] and item["naturalWidth"] > 0 and item["naturalHeight"] > 0 for item in image_metrics), "image_decoded")
    ensure(all(item["right"] <= item["parentRight"] + 1 for item in image_metrics), "image_content_width")
    ensure(not any(item["hasUnsafeAttributes"] for item in image_metrics), "image_safe_attributes")
    ensure(all(guard.statuses.get(item["src"]) == [200] for item in image_metrics), "image_http_200")
    ensure(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "image_horizontal_overflow")

    image_triggers = page.locator("#library-code-compare-preview [data-image-lightbox-trigger]")
    ensure(image_triggers.count() == images.count(), "image_lightbox_trigger_count")
    trigger = image_triggers.nth(1)
    trigger.scroll_into_view_if_needed()
    trigger.focus()
    ensure(trigger.evaluate("node => node.tagName") == "BUTTON", "image_lightbox_native_button")
    ensure(trigger.get_attribute("type") == "button", "image_lightbox_button_type")
    ensure(trigger.get_attribute("aria-haspopup") == "dialog", "image_lightbox_trigger_semantics")
    ensure((trigger.get_attribute("aria-label") or "").startswith("放大查看："), "image_lightbox_trigger_name")
    ensure(trigger.get_attribute("aria-label") == "放大查看：论文原图", "image_lightbox_readable_name")
    trigger.press("Enter")
    lightbox = page.locator("#library-image-lightbox")
    lightbox.wait_for(state="visible")
    ensure(lightbox.get_attribute("open") is not None, "image_lightbox_open")
    ensure(
        page.locator("#library-image-lightbox-image").get_attribute("src")
        == images.nth(1).get_attribute("src"),
        "image_lightbox_same_source",
    )
    ensure(
        page.evaluate("document.activeElement?.id") == "library-image-lightbox-close",
        "image_lightbox_focus_enters",
    )
    ensure(
        page.locator("#library-image-lightbox-caption").inner_text().strip() == "论文原图",
        "image_lightbox_readable_caption",
    )
    ensure(page.locator("#library-detail").is_visible(), "image_lightbox_keeps_reader")
    lightbox_metrics = page.locator("#library-image-lightbox-image").evaluate(
        """
        node => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        }
        """
    )
    ensure(
        lightbox_metrics["left"] >= 0
        and lightbox_metrics["top"] >= 0
        and lightbox_metrics["right"] <= lightbox_metrics["viewportWidth"]
        and lightbox_metrics["bottom"] <= lightbox_metrics["viewportHeight"],
        "image_lightbox_inside_viewport",
    )
    viewport = page.viewport_size or {}
    if viewport.get("width") == 1280:
        page.screenshot(path=str(OUT / "paper-reader-image-lightbox-1280.png"))
    page.keyboard.press("Escape")
    lightbox.wait_for(state="hidden")
    ensure(page.locator("#library-detail").is_visible(), "image_lightbox_escape_keeps_reader")
    ensure(
        trigger.evaluate("node => document.activeElement === node"),
        "image_lightbox_focus_returns",
    )
    trigger.press("Space")
    lightbox.wait_for(state="visible")
    page.locator("#library-image-lightbox-close").click()
    lightbox.wait_for(state="hidden")
    ensure(trigger.evaluate("node => document.activeElement === node"), "image_lightbox_button_close_focus")
    trigger.click()
    lightbox.wait_for(state="visible")
    page.mouse.click(4, 4)
    lightbox.wait_for(state="hidden")
    ensure(trigger.evaluate("node => document.activeElement === node"), "image_lightbox_backdrop_focus")
    images.nth(1).scroll_into_view_if_needed()
    if viewport.get("width") == 1280:
        page.screenshot(path=str(OUT / "paper-reader-images-1280.png"))
    return_from_detail(page, IMAGE_PAPER_ID)


def run_copy_check(page: Page, guard: NetworkGuard) -> None:
    ensure(inspector_matches(page, PREVIEW_ID), "copy_selection")
    ensure(guard.audit_requests == 0, "audit_before_copy")
    page.locator('#library-inspector [data-action="copy-private-path"]').click()
    page.wait_for_function(
        "document.querySelector('#library-inspector [data-inspector-status]')?.textContent === '原始路径已复制'",
    )
    page.wait_for_timeout(100)
    ensure(guard.audit_requests == 1, "audit_lazy_exactly_once")
    ensure(guard.audit_statuses == [200], "audit_http_200")
    clipboard_has_value = page.evaluate(
        "async () => (await navigator.clipboard.readText()).length > 0",
    )
    ensure(clipboard_has_value, "clipboard_value")

    replacement_id = next(paper["paper_id"] for paper in PAPERS if paper["paper_id"] != PREVIEW_ID)
    page.locator("#library-search").fill(replacement_id)
    row_for_id(page, replacement_id).locator('[data-action="select-paper"]').click()
    ensure(page.locator('#library-inspector [data-inspector-status]').inner_text() == "", "copy_status_selection_change")
    ensure(guard.audit_requests == 1, "audit_no_extra_request")
    page.locator("#library-reset").click()


def exercise_page(page: Page, guard: NetworkGuard) -> None:
    guard.phase = "reader"
    run_reader_acceptance_checks(page, guard)
    guard.phase = "images"
    run_image_preview_checks(page, guard)
    guard.phase = "search"
    run_search_checks(page)
    guard.phase = "sort"
    run_sort_checks(page)
    guard.phase = "filter"
    run_material_filter_checks(page)
    guard.phase = "metadata"
    run_metadata_display_checks(page)
    guard.phase = "selection"
    select_with_keyboard(page, PREVIEW_ID)
    guard.phase = "workspace"
    run_workspace_checks(page, guard, PREVIEW_ID)
    guard.phase = "keyboard"
    run_keyboard_checks(page, NO_NOTE_ID)
    guard.phase = "notes"
    run_note_state_checks(page, guard)
    guard.phase = "copy"
    run_copy_check(page, guard)
    guard.phase = "final-layout"


def verify_page(browser: Browser, width: int, height: int, exercise: bool) -> None:
    context = browser.new_context(viewport={"width": width, "height": height})
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=ORIGIN)
    page = context.new_page()
    guard = NetworkGuard(page)
    try:
        response = page.goto(URL, wait_until="networkidle")
        ensure(response is not None and response.status == 200, "page_http_200")
        page.evaluate("key => localStorage.removeItem(key)", STORAGE_KEY)
        response = page.reload(wait_until="networkidle")
        ensure(response is not None and response.status == 200, "page_reload_http_200")
        page.locator("#library-results [data-paper-id]").first.wait_for(state="visible")
        ensure(len(visible_ids(page)) == len(PAPERS), "initial_paper_count")
        body_text = page.locator("body").inner_text()
        ensure("Unknown" not in body_text and "Not Reported" not in body_text, "english_placeholders")
        ensure(
            page.locator("#library-coverage-summary").inner_text().strip() == EXPECTED_COVERAGE_TEXT,
            "initial_metadata_coverage",
        )
        ensure(guard.audit_requests == 0, "audit_initial_load")
        assert_required_http(guard)
        assert_layout(page, width)

        guard.phase = f"source-{width}"
        run_source_material_checks(page, guard, width)

        guard.phase = f"facets-{width}"
        facet_screenshot = run_facet_ui_checks(page, width)
        ensure(facet_screenshot.is_file(), f"facet_screenshot_file_{width}")

        if exercise:
            exercise_page(page, guard)
            assert_layout(page, width)

        page.locator(".library-main").evaluate(
            "async node => { await document.fonts.ready; document.activeElement?.blur(); node.style.scrollBehavior = 'auto'; node.style.overflowAnchor = 'none'; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); node.scrollTop = 0; node.scrollLeft = 0; }"
        )
        page.locator(".library-table-wrap").evaluate(
            "node => { node.style.scrollBehavior = 'auto'; node.scrollLeft = 0; }"
        )
        ensure(page.locator(".library-main").evaluate("node => node.scrollTop") == 0, "screenshot_main_scroll_top")
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT / f"paper-library-{width}.png"), full_page=True)
        capture_table_screenshot(page, width)
        if guard.problems:
            summary = Counter(guard.problems)
            print("浏览器守卫问题：" + "，".join(f"{key}={summary[key]}" for key in sorted(summary)))
            for detail in guard.request_failure_details:
                print("请求失败安全诊断：" + json.dumps(detail, ensure_ascii=False, sort_keys=True))
        ensure(not guard.problems, "browser_guard")
    finally:
        context.close()
    print(f"桌面论文库自动验收：{width}×{height} 通过")


assert_safe_request_failure_code_contract()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome")
    try:
        verify_page(browser, 1280, 720, True)
        verify_page(browser, 1440, 900, False)
    finally:
        browser.close()

print(f"真实中文标题可检索记录：{1 if CHINESE_TITLE_CASE else 0}；未推断补录")
print(f"浏览器验收来源：{ORIGIN}（默认 {DEFAULT_ORIGIN}，仅允许本机 HTTP 端口覆盖）")
for query_name, _selections in REPRESENTATIVE_QUERY_SPECS:
    print(f"代表组合 {query_name}：{','.join(sorted(REPRESENTATIVE_QUERY_IDS[query_name]))}")
print("分面验收截图：output/playwright/paper-library-facets-1280.png，output/playwright/paper-library-facets-1440.png")
print("控制台、页面异常、失败请求、HTTP>=400 与禁止请求检查：通过")
