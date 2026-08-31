from __future__ import annotations

import argparse
import json
import os
import selectors
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, Route, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_LAUNCHER = REPO_ROOT / "exporter/verification/integrated-server-fixture.mjs"
SCREENSHOT_ROOT = REPO_ROOT / "output/playwright/workbench-integration"
VIEWPORTS = ((1280, 720), (1440, 900))
RICH_PAPER_ID = "Fixture24-Rich"
METADATA_PAPER_ID = "Fixture26-Meta"
PRIVATE_PATH_MARKER = "/" + "".join(("Us", "ers")) + "/"
FILE_SCHEME_MARKER = "fi" + "le" + "://"
PRIVATE_LOCATOR_MARKERS = (
    PRIVATE_PATH_MARKER,
    "/" + "ho" + "me" + "/",
    "/" + "v" + "ar" + "/" + "fold" + "ers" + "/",
    "/" + "t" + "mp" + "/",
)
OPENALEX_ENDPOINT = "https://api.openalex.org/works"
OPENALEX_SELECT = ",".join((
    "id",
    "doi",
    "title",
    "authorships",
    "publication_year",
    "primary_location",
    "cited_by_count",
    "open_access",
    "best_oa_location",
    "topics",
    "abstract_inverted_index",
))


def ensure(condition: bool, code: str) -> None:
    if not condition:
        raise AssertionError(code)


def normalized_local_origin(raw_origin: str) -> str:
    normalized = raw_origin[:-1] if raw_origin.endswith("/") else raw_origin
    try:
        parts = urlparse(normalized)
        port = parts.port
    except (TypeError, UnicodeError, ValueError):
        raise AssertionError("fixture_origin") from None
    canonical = f"http://127.0.0.1:{port}" if isinstance(port, int) and 1 <= port <= 65535 else ""
    ensure(
        bool(canonical)
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
        and not parts.fragment,
        "fixture_origin",
    )
    return canonical


def assert_no_private_locator(value: Any, code: str = "private_locator") -> None:
    if isinstance(value, bytes):
        text = value.decode("utf-8", errors="ignore")
    elif isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    decoded = text
    for _ in range(4):
        next_decoded = unquote(decoded)
        if next_decoded == decoded:
            break
        decoded = next_decoded
    normalized = decoded.replace("\\", "/").lower()
    for marker in PRIVATE_LOCATOR_MARKERS:
        ensure(marker.lower() not in normalized, code)
    ensure(FILE_SCHEME_MARKER not in normalized, code)
    ensure(str(REPO_ROOT).replace("\\", "/").lower() not in normalized, code)


def assert_browser_storage_privacy(page: Page, code: str) -> None:
    storage = page.evaluate(
        """
        () => ({
          localStorage: Object.fromEntries(
            Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
              .filter(key => key !== null)
              .map(key => [key, localStorage.getItem(key)]),
          ),
          sessionStorage: Object.fromEntries(
            Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
              .filter(key => key !== null)
              .map(key => [key, sessionStorage.getItem(key)]),
          ),
        })
        """
    )
    assert_no_private_locator(storage, code)


@dataclass(frozen=True)
class FixtureSession:
    origin: str


def _stop_fixture(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    else:
        process.wait(timeout=1)
    if process.stdin is not None:
        process.stdin.close()
    if process.stdout is not None:
        process.stdout.close()


@contextmanager
def temporary_fixture() -> Iterator[FixtureSession]:
    ensure(FIXTURE_LAUNCHER.is_file(), "fixture_launcher_missing")
    child_environment = os.environ.copy()
    child_environment.pop("PAPER_LIBRARY_ORIGIN", None)
    process = subprocess.Popen(
        ["node", str(FIXTURE_LAUNCHER)],
        cwd=REPO_ROOT,
        env=child_environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )
    try:
        ensure(process.stdout is not None, "fixture_stdout")
        readiness_selector = selectors.DefaultSelector()
        try:
            readiness_selector.register(process.stdout, selectors.EVENT_READ)
            ensure(bool(readiness_selector.select(timeout=30)), "fixture_readiness_timeout")
        finally:
            readiness_selector.close()
        line = process.stdout.readline()
        assert_no_private_locator(line, "fixture_readiness_privacy")
        try:
            readiness = json.loads(line)
        except json.JSONDecodeError:
            raise AssertionError("fixture_readiness_json") from None
        ensure(
            isinstance(readiness, dict)
            and set(readiness) == {"origin"}
            and isinstance(readiness["origin"], str),
            "fixture_readiness_shape",
        )
        origin = normalized_local_origin(readiness["origin"])
        ensure(process.poll() is None, "fixture_exited_after_readiness")
        yield FixtureSession(origin=origin)
    finally:
        _stop_fixture(process)


@dataclass(frozen=True)
class PublicResponse:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        try:
            return json.loads(self.body)
        except json.JSONDecodeError:
            raise AssertionError("public_response_json") from None


def public_request(
    origin: str,
    path: str,
    *,
    method: str = "GET",
    payload: Any | None = None,
    headers: dict[str, str] | None = None,
    expected_status: int | tuple[int, ...] = 200,
) -> PublicResponse:
    ensure(path.startswith("/") and not path.startswith("//"), "public_request_path")
    request_headers = dict(headers or {})
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = Request(f"{origin}{path}", data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            result = PublicResponse(
                status=response.status,
                headers={key.lower(): value for key, value in response.headers.items()},
                body=response.read(),
            )
    except HTTPError as error:
        result = PublicResponse(
            status=error.code,
            headers={key.lower(): value for key, value in error.headers.items()},
            body=error.read(),
        )
    allowed = (expected_status,) if isinstance(expected_status, int) else expected_status
    ensure(result.status in allowed, f"public_status_{result.status}")
    assert_no_private_locator(result.headers, "public_header_privacy")
    assert_no_private_locator(result.body, "public_body_privacy")
    return result


def _values_at_path(paper: dict[str, Any], path: str) -> list[Any]:
    value: Any = paper.get("facets")
    for segment in path.split("."):
        if not isinstance(value, dict):
            return []
        value = value.get(segment)
    return value if isinstance(value, list) else []


def fetch_fixture_index(origin: str) -> dict[str, Any]:
    index = public_request(origin, "/local_library_data/paper-index.json").json()
    ensure(isinstance(index, dict) and index.get("version") == 3, "index_version")
    papers = index.get("papers")
    schema = index.get("facet_schema")
    ensure(isinstance(papers, list) and papers, "index_papers")
    ensure(isinstance(schema, dict) and schema.get("version") == 2, "facet_schema_version")
    groups = schema.get("groups")
    ensure(isinstance(groups, list) and len(groups) == 18, "facet_schema_groups")
    paper_ids = [paper.get("paper_id") for paper in papers if isinstance(paper, dict)]
    ensure(len(paper_ids) == len(papers) and len(set(paper_ids)) == len(paper_ids), "index_paper_ids")
    ensure({RICH_PAPER_ID, METADATA_PAPER_ID}.issubset(set(paper_ids)), "fixture_paper_ids")
    allowed_states = {"unrecorded", "not_applicable", "pending_verification"}
    for group in groups:
        ensure(isinstance(group, dict) and isinstance(group.get("path"), str), "facet_group")
        path = group["path"]
        explicit_empty = [
            paper
            for paper in papers
            if isinstance(paper, dict)
            and _values_at_path(paper, path) == []
            and isinstance(paper.get("facet_states"), dict)
            and paper["facet_states"].get(path) in allowed_states
        ]
        ensure(bool(explicit_empty), f"facet_explicit_empty:{path}")
    return index


def openalex_payload() -> dict[str, Any]:
    works = []
    fixtures = (
        ("W9000000003", "10.5555/fixture-recover", "Recovery Candidate", 17),
        ("W9000000004", "10.5555/fixture-busy", "Concurrent Candidate", 11),
        ("W9000000005", "10.5555/fixture-new", "Ordinary Candidate", 5),
    )
    for paper_id, doi, title, citations in fixtures:
        slug = paper_id.lower()
        works.append({
            "id": f"https://openalex.org/{paper_id}",
            "doi": f"https://doi.org/{doi}",
            "title": title,
            "authorships": [{"author": {"display_name": "Fixture Author"}}],
            "publication_year": 2026,
            "primary_location": {
                "source": {"display_name": "Fixture Journal"},
                "landing_page_url": f"https://example.org/papers/{slug}",
            },
            "cited_by_count": citations,
            "open_access": {
                "is_oa": True,
                "oa_url": f"https://example.org/open/{slug}",
            },
            "best_oa_location": {
                "pdf_url": f"https://example.org/pdf/{slug}.pdf",
                "landing_page_url": f"https://example.org/open/{slug}",
            },
            "topics": [{"display_name": "Distributed optimization"}],
            "abstract_inverted_index": {
                "Deterministic": [0],
                "fixture": [1],
                "abstract": [2],
            },
        })
    return {"meta": {"count": len(works), "cost_usd": 0}, "results": works}


def confirmed_archive_candidate(paper_id: str) -> dict[str, Any]:
    normalized = {
        "W9000000003": ("10.5555/fixture-recover", "Recovery Candidate", 17),
        "W9000000004": ("10.5555/fixture-busy", "Concurrent Candidate", 11),
        "W9000000005": ("10.5555/fixture-new", "Ordinary Candidate", 5),
    }
    ensure(paper_id in normalized, "candidate_fixture_id")
    doi, title, citations = normalized[paper_id]
    slug = paper_id.lower()
    return {
        "paperId": paper_id,
        "doi": doi,
        "title": title,
        "authors": ["Fixture Author"],
        "year": 2026,
        "source": "Fixture Journal",
        "citations": citations,
        "isOpenAccess": True,
        "openAccessUrl": f"https://example.org/open/{slug}",
        "landingPageUrl": f"https://example.org/papers/{slug}",
        "topics": ["Distributed optimization"],
        "abstract": "Deterministic fixture abstract",
        "stage": "confirmed_for_archive",
    }


class StrictNetwork:
    def __init__(
        self,
        context: BrowserContext,
        origin: str,
        *,
        openalex_response: dict[str, Any] | None = None,
        institution_response: dict[str, Any] | None = None,
    ) -> None:
        self.origin = normalized_local_origin(origin)
        self.origin_parts = urlparse(self.origin)
        self.openalex_response = openalex_response
        self.institution_response = institution_response
        self.problems: list[str] = []
        self.openalex_requests = 0
        self.institution_requests = 0
        context.route("**/*", self._route)

    def _same_origin(self, parsed) -> bool:
        return parsed.scheme == self.origin_parts.scheme and parsed.netloc == self.origin_parts.netloc

    def _valid_openalex_request(self, route: Route) -> bool:
        parsed = urlparse(route.request.url)
        if (
            route.request.method != "GET"
            or f"{parsed.scheme}://{parsed.netloc}{parsed.path}" != OPENALEX_ENDPOINT
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
        ):
            return False
        query = parse_qs(parsed.query, keep_blank_values=True)
        expected_expression = '("time-varying directed graph" AND "distributed constrained optimization" AND "communication-efficient")'
        return query == {
            "search": [expected_expression],
            "filter": ["from_publication_date:2022-01-01,to_publication_date:2026-12-31,language:en,is_retracted:false"],
            "sort": ["relevance_score:desc"],
            "per_page": ["10"],
            "select": [OPENALEX_SELECT],
        }

    def _route(self, route: Route) -> None:
        parsed = urlparse(route.request.url)
        try:
            if self._same_origin(parsed):
                if (
                    self.institution_response is not None
                    and route.request.method == "GET"
                    and parsed.path == "/local_library_output/desktop/assets/nuist.institution.json"
                    and not parsed.query
                    and not parsed.fragment
                ):
                    self.institution_requests += 1
                    route.fulfill(
                        status=200,
                        headers={"Content-Type": "application/json; charset=utf-8"},
                        body=json.dumps(self.institution_response, ensure_ascii=False, separators=(",", ":")),
                    )
                    return
                route.continue_()
                return
            if parsed.scheme in {"data", "blob", "about", "chrome", "chrome-extension"}:
                route.continue_()
                return
            if self.openalex_response is not None and parsed.hostname == "api.openalex.org":
                if not self._valid_openalex_request(route):
                    self.problems.append("openalex_request_contract")
                    route.abort("blockedbyclient")
                    return
                self.openalex_requests += 1
                route.fulfill(
                    status=200,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": "application/json; charset=utf-8",
                    },
                    body=json.dumps(self.openalex_response, ensure_ascii=False, separators=(",", ":")),
                )
                return
            self.problems.append(f"unexpected_external:{parsed.hostname or 'unknown'}")
            route.abort("blockedbyclient")
        except Exception:
            self.problems.append("network_route_failure")
            try:
                route.abort("failed")
            except Exception:
                pass


class BrowserAudit:
    def __init__(self, page: Page, origin: str) -> None:
        self.origin = origin
        self.problems: list[str] = []
        self.expected_http: dict[tuple[str, str, int], int] = {}
        self.expected_console_status: dict[int, int] = {}
        page.on("console", self._console)
        page.on("pageerror", lambda _error: self.problems.append("pageerror"))
        page.on("requestfailed", lambda _request: self.problems.append("requestfailed"))
        page.on("response", self._response)

    def expect_http(self, method: str, path: str, status: int) -> None:
        key = (method, path, status)
        ensure(self.expected_http.get(key, 0) == 0, "duplicate_expected_http")
        self.expected_http[key] = 1
        self.expected_console_status[status] = self.expected_console_status.get(status, 0) + 1

    def _console(self, message) -> None:
        if message.type in {"warning", "error"}:
            for status, remaining in self.expected_console_status.items():
                if remaining > 0 and f"status of {status} " in message.text:
                    self.expected_console_status[status] = remaining - 1
                    return
            self.problems.append(f"console:{message.type}:{message.text[:200]}")

    def _response(self, response) -> None:
        try:
            assert_no_private_locator(response.headers, "browser_header_privacy")
        except AssertionError:
            self.problems.append("response_header_privacy")
        parsed = urlparse(response.url)
        if response.url.startswith(self.origin) and parsed.path.startswith("/api/v1/"):
            try:
                assert_no_private_locator(response.body(), "browser_body_privacy")
            except Exception:
                self.problems.append("response_body_privacy")
        key = (response.request.method, urlparse(response.url).path, response.status)
        if response.status >= 400:
            remaining = self.expected_http.get(key, 0)
            if remaining > 0:
                self.expected_http[key] = remaining - 1
            else:
                self.problems.append(f"http:{response.status}")

    def assert_complete(self) -> None:
        missing = [key for key, remaining in self.expected_http.items() if remaining != 0]
        ensure(not missing, "missing_expected_http")


def launch_chromium(playwright: Playwright) -> Browser:
    return playwright.chromium.launch(channel="chrome")


def screenshot_path(width: int, height: int, name: str) -> Path:
    target = SCREENSHOT_ROOT / f"{width}x{height}" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def assert_no_document_overflow(page: Page, code: str) -> None:
    metrics = page.evaluate(
        """
        () => ({
          innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
        })
        """
    )
    ensure(metrics["documentWidth"] <= metrics["innerWidth"], code)
    ensure(metrics["bodyWidth"] <= metrics["innerWidth"], code)


def assert_three_column_layout(page: Page, width: int) -> None:
    metrics = page.evaluate(
        """
        () => {
          const rect = selector => document.querySelector(selector)?.getBoundingClientRect() ?? null;
          return {
            viewport: innerWidth,
            sidebar: rect('.library-sidebar'),
            main: rect('.library-main'),
            inspector: rect('.library-inspector'),
            table: (() => {
              const node = document.querySelector('.library-table-wrap');
              return node ? { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: getComputedStyle(node).overflowX } : null;
            })(),
          };
        }
        """
    )
    ensure(metrics["viewport"] == width, "library_viewport")
    ensure(all(metrics[key] for key in ("sidebar", "main", "inspector", "table")), "library_layout_nodes")
    ensure(metrics["sidebar"]["right"] <= metrics["main"]["left"] + 1, "library_sidebar_overlap")
    ensure(metrics["main"]["right"] <= metrics["inspector"]["left"] + 1, "library_inspector_overlap")
    ensure(metrics["table"]["overflowX"] in {"auto", "scroll"}, "library_table_overflow_container")
    ensure(metrics["table"]["scrollWidth"] >= metrics["table"]["clientWidth"], "library_table_scroll_metrics")
    assert_no_document_overflow(page, "library_document_overflow")


def visible_paper_ids(page: Page) -> list[str]:
    return page.locator("#library-results [data-paper-id]").evaluate_all(
        "nodes => nodes.map(node => node.dataset.paperId)",
    )


def paper_row(page: Page, paper_id: str):
    row = page.locator(f'#library-results [data-paper-id="{paper_id}"]')
    ensure(row.count() == 1, f"paper_row:{paper_id}")
    return row


def select_paper(page: Page, paper_id: str) -> None:
    page.locator("#library-search").fill(paper_id)
    row = paper_row(page, paper_id)
    button = row.locator('[data-action="select-paper"]')
    button.focus()
    button.press("Enter")
    page.wait_for_function(
        "paperId => document.querySelector('#library-inspector [data-inspector-content] code')?.textContent === paperId",
        arg=paper_id,
    )
    ensure(button.evaluate("node => document.activeElement === node"), "paper_select_focus")


def open_paper(page: Page, paper_id: str) -> None:
    page.locator("#library-search").fill(paper_id)
    paper_row(page, paper_id).locator('[data-action="open-detail"]').click()
    page.locator("#library-detail").wait_for(state="visible")
    ensure(page.locator("#library-context-title").inner_text().strip() == paper_id, "reader_context")


def _select_first_material(page: Page, selector: str) -> None:
    select = page.locator(selector)
    if not select.is_visible():
        return
    options = select.locator("option").evaluate_all(
        "nodes => nodes.map(node => node.value).filter(Boolean)",
    )
    ensure(bool(options), f"material_options:{selector}")
    if not select.input_value():
        select.select_option(options[0])


def assert_reader_materials(page: Page, origin: str) -> None:
    open_paper(page, RICH_PAPER_ID)
    page.locator('[data-reader-tab="source"]').click()
    page.wait_for_function(
        "() => document.querySelector('#library-source-ocr-preview')?.children.length > 0 && !document.querySelector('#library-source-ocr-preview')?.textContent.includes('正在读取')",
    )
    pdf_frame = page.locator("#library-source-pdf-frame")
    page.wait_for_function("() => Boolean(document.querySelector('#library-source-pdf-frame')?.getAttribute('src'))")
    pdf_url = pdf_frame.get_attribute("src") or ""
    ensure(pdf_url.startswith(f"{origin}/local_library_data/sources/"), "reader_pdf_url")
    ensure(page.locator("#library-source-ocr-preview").inner_text().strip() != "", "reader_ocr_content")
    ensure(
        page.locator("#library-source-ocr-preview script, #library-source-ocr-preview iframe, #library-source-ocr-preview object").count() == 0,
        "reader_ocr_active_content",
    )
    ocr_images = page.locator("#library-source-ocr-preview img.note-image")
    ensure(ocr_images.count() >= 1, "reader_ocr_image")
    ocr_image_count = ocr_images.count()

    page.locator('[data-reader-tab="note"]').click()
    _select_first_material(page, "#library-note-material-select")
    page.wait_for_function(
        "() => document.querySelector('#library-note-preview')?.children.length > 0 && !document.querySelector('#library-note-preview')?.textContent.includes('正在读取')",
    )
    ensure(page.locator("#library-note-preview .katex").count() > 0, "reader_katex")
    ensure(page.locator("#library-note-preview .katex-error").count() == 0, "reader_katex_errors")
    ensure(page.locator("#library-note-preview pre .katex").count() == 0, "reader_code_not_typeset")
    note_images = page.locator("#library-note-preview img.note-image")
    ensure(note_images.count() >= 1, "reader_note_image")
    ensure(ocr_image_count + note_images.count() >= 2, "reader_multiple_image_previews")

    toc = page.locator("#library-reader-toc")
    toggle = page.locator("#library-reader-toc-toggle")
    ensure(toc.is_visible() and toggle.get_attribute("aria-expanded") == "true", "reader_toc_visible")
    toggle.click()
    ensure(not toc.is_visible() and toggle.get_attribute("aria-expanded") == "false", "reader_toc_hidden")
    toggle.click()
    ensure(toc.is_visible() and toggle.get_attribute("aria-expanded") == "true", "reader_toc_restored")

    page.locator('[data-reader-tab="code_compare"]').click()
    page.wait_for_function(
        "() => document.querySelector('#library-code-compare-preview')?.children.length > 0 && !document.querySelector('#library-code-compare-preview')?.textContent.includes('正在读取')",
    )
    ensure("fixture_simulation.py" in page.locator("#library-code-compare-preview").inner_text(), "reader_code_compare")
    page.locator('[data-reader-tab="note"]').click()
    _select_first_material(page, "#library-note-material-select")
    note_images.first.scroll_into_view_if_needed()
    page.wait_for_function(
        "() => [...document.querySelectorAll('#library-note-preview img.note-image')].every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)",
    )
    image_urls = note_images.evaluate_all("nodes => nodes.map(node => node.src)")
    ensure(all(url.startswith(f"{origin}/local_library_data/notes/") for url in image_urls), "reader_image_urls")
    trigger = page.locator("#library-note-preview [data-image-lightbox-trigger]").first
    trigger.focus()
    trigger.press("Enter")
    lightbox = page.locator("#library-image-lightbox")
    lightbox.wait_for(state="visible")
    ensure(page.evaluate("document.activeElement?.id") == "library-image-lightbox-close", "lightbox_focus")
    page.keyboard.press("Escape")
    lightbox.wait_for(state="hidden")
    ensure(trigger.evaluate("node => document.activeElement === node"), "lightbox_escape_focus")
    assert_no_document_overflow(page, "reader_document_overflow")


def assert_personal_tags(page: Page) -> None:
    page.locator("#library-detail-back").click()
    page.locator("#library-search").fill("")
    select_paper(page, RICH_PAPER_ID)
    tag_input = page.locator("#library-inspector [data-user-tag-input]")
    tag_input.fill("临时验收标签")
    tag_input.press("Enter")
    tag = page.locator("#library-inspector [data-user-tags]").get_by_text("临时验收标签", exact=True)
    ensure(tag.count() == 1, "user_tag_add")
    page.reload(wait_until="networkidle")
    ensure(
        page.locator("#library-inspector [data-user-tags]").get_by_text("临时验收标签", exact=True).count() == 1,
        "user_tag_persist",
    )
    page.locator("#library-inspector [data-action='remove-user-tag'][data-user-tag-label='临时验收标签']").click()
    ensure(
        page.locator("#library-inspector [data-user-tags]").get_by_text("临时验收标签", exact=True).count() == 0,
        "user_tag_remove",
    )


def assert_metadata_only(page: Page) -> None:
    page.locator("#library-search").fill(METADATA_PAPER_ID)
    row = paper_row(page, METADATA_PAPER_ID)
    group = page.locator('[data-note-group="metadata_only"]')
    ensure(group.count() == 1 and "材料待补" in group.inner_text(), "metadata_only_group")
    ensure(group.locator(f'[data-paper-id="{METADATA_PAPER_ID}"]').count() == 1, "metadata_only_row")
    row.locator('[data-action="open-detail"]').click()
    page.locator("#library-detail").wait_for(state="visible")
    page.locator('[data-reader-tab="source"]').click()
    ensure(page.locator("[data-source-pane='pdf']").inner_text().strip() != "", "metadata_only_pdf_empty")
    ensure(page.locator("#library-source-ocr-preview").inner_text().strip() != "", "metadata_only_ocr_empty")
    page.locator("#library-detail-back").click()


def verify_library_viewport(
    browser: Browser,
    origin: str,
    index: dict[str, Any],
    width: int,
    height: int,
) -> None:
    context = browser.new_context(viewport={"width": width, "height": height})
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin)
    network = StrictNetwork(context, origin)
    page = context.new_page()
    audit = BrowserAudit(page, origin)
    try:
        response = page.goto(
            f"{origin}/local_library_output/desktop/library.html",
            wait_until="networkidle",
        )
        ensure(response is not None and response.status == 200, "library_page_status")
        page.locator("#library-results [data-paper-id]").first.wait_for(state="visible")
        expected_ids = {paper["paper_id"] for paper in index["papers"]}
        ensure(set(visible_paper_ids(page)) == expected_ids, "library_initial_ids")
        assert_three_column_layout(page, width)

        page.locator("#library-sort").focus()
        page.keyboard.press("Meta+K")
        ensure(page.evaluate("document.activeElement?.id") == "library-search", "library_command_focus")

        assert_reader_materials(page, origin)
        page.screenshot(path=str(screenshot_path(width, height, "library-reader.png")), full_page=True)
        assert_personal_tags(page)
        assert_metadata_only(page)
        page.locator("#library-search").fill("")
        assert_three_column_layout(page, width)
        page.screenshot(path=str(screenshot_path(width, height, "library.png")), full_page=True)
        assert_browser_storage_privacy(page, "library_storage_privacy")
        ensure(not network.problems, "library_network:" + ",".join(network.problems))
        ensure(not audit.problems, "library_browser:" + ",".join(audit.problems))
    finally:
        context.close()


def assert_static_denials_and_privacy(origin: str) -> None:
    capabilities = public_request(origin, "/api/v1/capabilities").json()
    ensure(
        isinstance(capabilities, dict)
        and capabilities.get("api_version") == 1
        and capabilities.get("note_import") is True
        and capabilities.get("candidate_archive") is True
        and capabilities.get("archive_source_id") == "fixture_papers"
        and capabilities.get("recovery", {}).get("required") is False,
        "fixture_capabilities",
    )
    public_request(origin, "/local_library_data/paper-index.json", method="HEAD")
    denied = (
        "/local_library_config/library.local.json",
        "/local_library_data/paper-library-audit.json",
        "/local_library_output/desktop/assets/unlisted.mjs",
        "/prototype/desktop/library.template.html",
        "/prototype/desktop/state-transfer.mjs",
        "/%2e%2e/arbitrary.txt",
        "/local_library_data/notes/fixture/note/not-a-hash.html",
    )
    for path in denied:
        public_request(origin, path, expected_status=404)


def run_private_library_acceptance() -> None:
    with temporary_fixture() as fixture:
        index = fetch_fixture_index(fixture.origin)
        assert_static_denials_and_privacy(fixture.origin)
        with sync_playwright() as playwright:
            browser = launch_chromium(playwright)
            try:
                for width, height in VIEWPORTS:
                    verify_library_viewport(browser, fixture.origin, index, width, height)
            finally:
                browser.close()
    print(f"temporary paper-library acceptance passed: {len(index['papers'])} fixture papers, 2 viewports")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run isolated paper-library browser acceptance")
    parser.add_argument(
        "--temporary-fixture",
        action="store_true",
        help="launch the test-owned integrated server fixture on an ephemeral port",
    )
    arguments = parser.parse_args()
    if not arguments.temporary_fixture:
        parser.error("--temporary-fixture is required; a manually running server is never accepted")
    return arguments


def main() -> int:
    parse_arguments()
    run_private_library_acceptance()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
