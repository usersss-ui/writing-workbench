from __future__ import annotations

from typing import Any

from playwright.sync_api import Browser, Page, sync_playwright

from private_library_e2e import (
    BrowserAudit,
    StrictNetwork,
    VIEWPORTS,
    assert_browser_storage_privacy,
    assert_no_document_overflow,
    ensure,
    launch_chromium,
    openalex_payload,
    screenshot_path,
    temporary_fixture,
)


DISCOVERY_PATH = "/local_library_output/desktop/discovery.html"
EXPECTED_EXPRESSION = (
    '("time-varying directed graph" AND "distributed constrained optimization" '
    'AND "communication-efficient")'
)


def institution_profile() -> dict[str, Any]:
    return {
        "version": 1,
        "institution_id": "nuist",
        "display_name": "南京信息工程大学",
        "access_mode": "carsi",
        "library_home": "https://lib.nuist.edu.cn/",
        "fallback_page": "https://lib.nuist.edu.cn/zy1/wwsjk.htm",
        "providers": [
            {
                "provider_id": "ieee",
                "display_name": "IEEE Xplore",
                "hosts": ["ieeexplore.ieee.org"],
                "doi_prefixes": ["10.1109"],
                "library_page": "https://lib.nuist.edu.cn/info/1015/1430.htm",
                "carsi_entry_url": (
                    "https://ieeexplore.ieee.org/servlet/wayf.jsp?"
                    "entityId=https%3A%2F%2Fidp-lib.nuist.edu.cn%2Fidp%2Fshibboleth&"
                    "url=https%3A%2F%2Fieeexplore.ieee.org"
                ),
                "carsi_supported": True,
            },
            {
                "provider_id": "sciencedirect",
                "display_name": "ScienceDirect",
                "hosts": ["sciencedirect.com"],
                "doi_prefixes": ["10.1016"],
                "library_page": "https://lib.nuist.edu.cn/info/1015/1432.htm",
                "carsi_entry_url": (
                    "https://auth.elsevier.com/ShibAuth/institutionLogin?"
                    "appReturnURL=https%3A%2F%2Fwww.sciencedirect.com&"
                    "entityID=https%3A%2F%2Fidp-lib.nuist.edu.cn%2Fidp%2Fshibboleth"
                ),
                "carsi_supported": True,
            },
            {
                "provider_id": "springer",
                "display_name": "Springer Link",
                "hosts": ["link.springer.com"],
                "doi_prefixes": ["10.1007"],
                "library_page": "https://lib.nuist.edu.cn/zy1/wwsjk/1.htm",
                "carsi_entry_url": None,
                "carsi_supported": True,
            },
            {
                "provider_id": "wiley",
                "display_name": "Wiley Online Library",
                "hosts": ["onlinelibrary.wiley.com"],
                "doi_prefixes": ["10.1002", "10.1111"],
                "library_page": "https://lib.nuist.edu.cn/info/1341/4533.htm",
                "carsi_entry_url": None,
                "carsi_supported": True,
            },
            {
                "provider_id": "taylor-francis",
                "display_name": "Taylor & Francis Online",
                "hosts": ["tandfonline.com"],
                "doi_prefixes": ["10.1080"],
                "library_page": "https://lib.nuist.edu.cn/info/1341/4533.htm",
                "carsi_entry_url": None,
                "carsi_supported": True,
            },
            {
                "provider_id": "web-of-science",
                "display_name": "Web of Science",
                "hosts": ["webofscience.com"],
                "doi_prefixes": [],
                "library_page": "https://lib.nuist.edu.cn/info/1015/1436.htm",
                "carsi_entry_url": (
                    "https://www.webofknowledge.com/?DestApp=UA&"
                    "ShibFederation=ChineseFederation&auth=ShibbolethIdPForm&"
                    "entityID=https%3A%2F%2Fidp-lib.nuist.edu.cn%2Fidp%2Fshibboleth&"
                    "target=https%253A%252F%252Fwww.webofknowledge.com%252F%253FDestApp%253DUA"
                ),
                "carsi_supported": True,
            },
        ],
    }


def assert_discovery_layout(page: Page, width: int) -> None:
    metrics = page.evaluate(
        """
        () => {
          const rect = selector => document.querySelector(selector)?.getBoundingClientRect() ?? null;
          return {
            viewport: innerWidth,
            sidebar: rect('.sidebar'),
            main: rect('.discovery-main'),
            inspector: rect('.discovery-inspector'),
            formWidths: [...document.querySelectorAll('.discovery-form')].map(node => ({
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
            })),
          };
        }
        """
    )
    ensure(metrics["viewport"] == width, "discovery_viewport")
    ensure(all(metrics[key] for key in ("sidebar", "main", "inspector")), "discovery_layout_nodes")
    ensure(metrics["sidebar"]["right"] <= metrics["main"]["left"] + 1, "discovery_sidebar_overlap")
    ensure(metrics["main"]["right"] <= metrics["inspector"]["left"] + 1, "discovery_inspector_overlap")
    ensure(
        all(item["scrollWidth"] <= item["clientWidth"] for item in metrics["formWidths"]),
        "discovery_form_overflow",
    )
    assert_no_document_overflow(page, "discovery_document_overflow")


def run_keyword_discovery(page: Page) -> None:
    page.locator("#keyword-query").fill("时变有向网络、分布式约束优化、低通信")
    page.locator("#keyword-start-year").fill("2022")
    page.locator("#keyword-end-year").fill("2026")
    page.locator("#keyword-language").select_option("en")
    page.locator(".discovery-query-tools > summary").filter(has_text="可选：英文检索式").click()
    page.locator("#generate-english-query").click()
    ensure(page.locator("#english-query").input_value() == EXPECTED_EXPRESSION, "keyword_translation")
    ensure("已生成英文检索式" in page.locator("#keyword-search-status").inner_text(), "keyword_status")
    page.locator("#keyword-live-search").click()
    page.locator("#keyword-live-results-list .discovery-result-card").first.wait_for(state="visible")
    cards = page.locator("#keyword-live-results-list .discovery-result-card")
    ensure(cards.count() == 3, "openalex_card_count")
    ensure(page.locator("[data-live-result-count]").inner_text().strip() == "3 篇唯一已加载结果", "openalex_count")
    ensure("来源匹配 3 · 已加载 3" in page.locator("#discovery-source-status").text_content(), "openalex_source_status")
    ensure(page.evaluate("document.activeElement?.id") == "keyword-search-results", "openalex_result_focus")
    for paper_id in ("W9000000003", "W9000000004", "W9000000005"):
        ensure(
            page.locator(f'#keyword-live-results-list [data-paper-id="{paper_id}"]').count() == 1,
            f"openalex_card:{paper_id}",
        )


def add_candidate(page: Page, paper_id: str) -> Any:
    result = page.locator(f'#keyword-live-results-list [data-paper-id="{paper_id}"]')
    result.locator('[data-select-result]').click()
    ensure(page.locator('[data-candidate-count]').inner_text().strip() == '0', 'external_candidate_separate_owner')
    page.once('dialog', lambda dialog: dialog.accept())
    result.locator('[data-convert-result]').click()
    card = page.locator(f'[data-queue-paper="{paper_id}"]')
    card.wait_for(state="visible")
    ensure(page.locator("[data-candidate-count]").inner_text().strip() != "0", "candidate_count")
    ensure("待筛选" in card.inner_text(), "candidate_pending")
    return card


def confirm_candidate(card) -> None:
    card.get_by_role("button", name="确认待归档").click()
    ensure("元数据待核验 · 待归档" in card.inner_text(), "candidate_confirmed")
    ensure("仅归档书目信息，不含 PDF/OCR/证据核验" in card.inner_text(), "candidate_disclosure")


def archive_ordinary_candidate(page: Page) -> None:
    card = add_candidate(page, "W9000000005")
    confirm_candidate(card)
    local_id = card.locator('input[data-archive-paper-id="W9000000005"]')
    local_id.fill("Fixture26-New")
    archive = card.locator('button[data-archive-candidate="W9000000005"]')
    ensure(archive.is_enabled(), "candidate_archive_enabled")
    accepted_dialogs: list[str] = []

    def accept_confirmation(dialog) -> None:
        accepted_dialogs.append(dialog.message)
        dialog.accept()

    page.once("dialog", accept_confirmation)
    archive.click()
    page.wait_for_function(
        "() => document.querySelector('[data-queue-paper=\"W9000000005\"]')?.textContent.includes('元数据已归档')",
        timeout=30_000,
    )
    ensure(len(accepted_dialogs) == 1, "candidate_confirmation_once")
    ensure("Fixture26-New" in accepted_dialogs[0], "candidate_confirmation_id")
    ensure("仅归档书目信息，不含 PDF/OCR/证据核验" in accepted_dialogs[0], "candidate_confirmation_boundary")


def assert_keyboard_tabs(page: Page) -> None:
    keyword = page.locator("#discovery-mode-keyword")
    access = page.locator("#discovery-mode-access")
    keyword.focus()
    keyword.press("ArrowRight")
    ensure(access.get_attribute("aria-selected") == "true", "access_tab_keyboard")
    ensure(access.evaluate("node => document.activeElement === node"), "access_tab_focus")
    access.press("ArrowLeft")
    ensure(keyword.get_attribute("aria-selected") == "true", "keyword_tab_keyboard")
    ensure(keyword.evaluate("node => document.activeElement === node"), "keyword_tab_focus")


def assert_institution_access(page: Page) -> None:
    page.locator("#discovery-mode-access").click()
    panel = page.locator("#known-paper-panel")
    ensure(panel.is_visible(), "institution_panel")
    providers = page.locator("#access-provider option").evaluate_all("nodes => nodes.map(node => node.value)")
    ensure(providers == ["", "ieee", "sciencedirect", "springer", "wiley", "taylor-francis", "web-of-science"], "institution_providers")
    page.locator("#access-locator").fill("10.1109/5.771073")
    page.locator("#institution-access-form button[type='submit']").click()
    result = page.locator("#access-result")
    ensure(result.is_visible(), "institution_result")
    ensure(result.locator("[data-provider-name]").inner_text().strip() == "IEEE Xplore", "institution_provider")
    ensure(
        page.locator("#institution-step-open").get_attribute("href") == "https://doi.org/10.1109/5.771073",
        "institution_article_url",
    )
    ensure(
        (page.locator("#institution-step-auth").get_attribute("href") or "").startswith("https://ieeexplore.ieee.org/servlet/wayf.jsp?"),
        "institution_carsi_url",
    )
    ensure(
        page.locator("#institution-step-library").get_attribute("href") == "https://lib.nuist.edu.cn/info/1015/1430.htm",
        "institution_library_url",
    )
    ensure("学校入口不代表目标论文已订购" in page.locator("#access-warnings").inner_text(), "institution_warning")
    ensure(page.locator("#access-copy-target").input_value() == "10.1109/5.771073", "institution_copy_target")
    page.locator("#access-copy").click()
    page.wait_for_function("() => document.querySelector('#access-copy-status')?.textContent === '已复制'")
    ensure(
        page.evaluate("async () => await navigator.clipboard.readText()") == "10.1109/5.771073",
        "institution_clipboard",
    )
    result_metrics = result.evaluate(
        "node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })",
    )
    ensure(result_metrics["scrollWidth"] <= result_metrics["clientWidth"], "institution_result_overflow")
    assert_no_document_overflow(page, "institution_document_overflow")


def verify_discovery_viewport(
    browser: Browser,
    origin: str,
    width: int,
    height: int,
    *,
    archive_candidate: bool,
) -> None:
    context = browser.new_context(viewport={"width": width, "height": height})
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin)
    network = StrictNetwork(
        context,
        origin,
        openalex_response=openalex_payload(),
        openalex_doi_responses={work["doi"].removeprefix("https://doi.org/"): work for work in openalex_payload()["results"]},
        institution_response=institution_profile(),
    )
    page = context.new_page()
    audit = BrowserAudit(page, origin)
    try:
        response = page.goto(f"{origin}{DISCOVERY_PATH}", wait_until="networkidle")
        ensure(response is not None and response.status == 200, "discovery_page_status")
        assert_discovery_layout(page, width)
        assert_keyboard_tabs(page)
        run_keyword_discovery(page)
        if archive_candidate:
            archive_ordinary_candidate(page)
        else:
            confirm_candidate(add_candidate(page, "W9000000003"))
        page.screenshot(path=str(screenshot_path(width, height, "discovery-candidates.png")), full_page=True)

        assert_institution_access(page)
        page.screenshot(path=str(screenshot_path(width, height, "institution-access.png")), full_page=True)
        ensure(network.openalex_requests == 2 and network.openalex_verification_requests == 1, "openalex_search_and_verified_conversion_count")
        ensure(network.institution_requests == 1, "institution_request_count")

        with page.expect_navigation(wait_until="networkidle"):
            page.get_by_role("link", name="分析与笔记", exact=True).click()
        ensure(page.url == f"{origin}/local_library_output/desktop/library.html", "discovery_navigation")
        ensure(page.locator("#library-page-title").inner_text().strip() == "本地论文 · 分析与笔记", "discovery_navigation_target")
        assert_no_document_overflow(page, "discovery_navigation_overflow")
        assert_browser_storage_privacy(page, "discovery_storage_privacy")
        ensure(not network.problems, "discovery_network:" + ",".join(network.problems))
        ensure(not audit.problems, "discovery_browser:" + ",".join(audit.problems))
    finally:
        context.close()


def run_institution_acceptance() -> None:
    with temporary_fixture() as fixture:
        with sync_playwright() as playwright:
            browser = launch_chromium(playwright)
            try:
                for width, height in VIEWPORTS:
                    verify_discovery_viewport(
                        browser,
                        fixture.origin,
                        width,
                        height,
                        archive_candidate=width == 1280,
                    )
            finally:
                browser.close()
    print("temporary discovery and institution acceptance passed: 2 viewports")


def main() -> int:
    run_institution_acceptance()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
