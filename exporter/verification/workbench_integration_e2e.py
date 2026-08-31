from __future__ import annotations

from typing import Any

from playwright.sync_api import Browser, Page, sync_playwright

from private_library_e2e import (
    BrowserAudit,
    RICH_PAPER_ID,
    StrictNetwork,
    VIEWPORTS,
    assert_browser_storage_privacy,
    assert_no_document_overflow,
    assert_no_private_locator,
    confirmed_archive_candidate,
    ensure,
    launch_chromium,
    screenshot_path,
    select_paper,
    temporary_fixture,
)


LIBRARY_PATH = "/local_library_output/desktop/library.html"
DIRECTIONS_PATH = "/prototype/desktop/directions.html"
AGENT_PATH = "/prototype/desktop/agent-tasks.html"
P02_PATH = "/prototype/desktop/p02.html"
HOME_PATH = "/prototype/desktop/index.html"


def assert_workspace_layout(page: Page, main_selector: str, inspector_selector: str | None, code: str) -> None:
    metrics = page.evaluate(
        """
        ({ mainSelector, inspectorSelector }) => {
          const rect = selector => selector ? document.querySelector(selector)?.getBoundingClientRect() ?? null : null;
          return {
            sidebar: rect('.sidebar'),
            main: rect(mainSelector),
            inspector: rect(inspectorSelector),
          };
        }
        """,
        {"mainSelector": main_selector, "inspectorSelector": inspector_selector},
    )
    ensure(metrics["sidebar"] is not None and metrics["main"] is not None, f"{code}_nodes")
    ensure(metrics["sidebar"]["right"] <= metrics["main"]["left"] + 1, f"{code}_sidebar_overlap")
    if inspector_selector is not None:
        ensure(metrics["inspector"] is not None, f"{code}_inspector")
        ensure(metrics["main"]["right"] <= metrics["inspector"]["left"] + 1, f"{code}_inspector_overlap")
    assert_no_document_overflow(page, f"{code}_overflow")


def archive_payload(local_paper_id: str, openalex_id: str) -> dict[str, Any]:
    return {
        "version": 1,
        "confirmation": "create_metadata_only",
        "archive_source_id": "fixture_papers",
        "paper_id": local_paper_id,
        "candidate": confirmed_archive_candidate(openalex_id),
    }


def browser_archive(page: Page, local_paper_id: str, openalex_id: str) -> dict[str, Any]:
    result = page.evaluate(
        """
        async body => {
          const response = await fetch('/api/v1/archive/candidates', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Research-Console-Action': 'archive-candidate',
            },
            body: JSON.stringify(body),
            cache: 'no-store',
            credentials: 'same-origin',
          });
          let payload = null;
          try { payload = await response.json(); } catch {}
          return { status: response.status, body: payload };
        }
        """,
        archive_payload(local_paper_id, openalex_id),
    )
    assert_no_private_locator(result, "archive_response_privacy")
    return result


def assert_dialog_centered(page: Page) -> None:
    metrics = page.locator("#library-note-import-dialog").evaluate(
        """
        node => {
          const rect = node.getBoundingClientRect();
          return {
            open: node.open,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            viewportCenterX: innerWidth / 2,
            viewportCenterY: innerHeight / 2,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          };
        }
        """
    )
    ensure(metrics["open"], "note_dialog_open")
    ensure(abs(metrics["centerX"] - metrics["viewportCenterX"]) <= 2, "note_dialog_center_x")
    ensure(abs(metrics["centerY"] - metrics["viewportCenterY"]) <= 2, "note_dialog_center_y")
    ensure(metrics["left"] >= 0 and metrics["top"] >= 0, "note_dialog_top_left")
    ensure(
        metrics["right"] <= metrics["viewportCenterX"] * 2
        and metrics["bottom"] <= metrics["viewportCenterY"] * 2,
        "note_dialog_viewport",
    )


def prepare_library_workspace(page: Page, origin: str) -> None:
    response = page.goto(f"{origin}{LIBRARY_PATH}", wait_until="networkidle")
    ensure(response is not None and response.status == 200, "workbench_library_status")
    page.locator("#library-results [data-paper-id]").first.wait_for(state="visible")
    select_paper(page, RICH_PAPER_ID)
    shelf = page.locator(
        '#library-inspector [data-action="toggle-shelf"][data-role="algorithm_mechanism"]',
    )
    ensure(shelf.get_attribute("aria-pressed") == "false", "workbench_shelf_initial")
    shelf.click()
    ensure(
        page.locator(
            '#library-inspector [data-action="toggle-shelf"][data-role="algorithm_mechanism"]',
        ).get_attribute("aria-pressed") == "true",
        "workbench_shelf_saved",
    )


def assert_note_dialog(page: Page, *, import_note: bool) -> None:
    page.locator(f'#library-results [data-paper-id="{RICH_PAPER_ID}"] [data-action="open-detail"]').click()
    page.locator("#library-detail").wait_for(state="visible")
    add_note = page.locator("#library-add-note")
    ensure(add_note.is_enabled(), "note_import_capability")
    add_note.click()
    dialog = page.locator("#library-note-import-dialog")
    dialog.wait_for(state="visible")
    assert_dialog_centered(page)
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")
    ensure(add_note.evaluate("node => document.activeElement === node"), "note_dialog_escape_focus")

    add_note.click()
    dialog.wait_for(state="visible")
    markdown = (
        "# Imported fixture note\n\n"
        "This deterministic note contains $x_{k+1}=x_k-\\alpha g_k$ and no private locator.\n"
    ).encode("utf-8")
    page.locator("#library-note-import-file").set_input_files({
        "name": "fixture-import.md",
        "mimeType": "text/markdown",
        "buffer": markdown,
    })
    page.wait_for_function(
        "() => !document.querySelector('#library-note-import-submit')?.disabled",
        timeout=15_000,
    )
    ensure(page.locator("#library-note-import-checks li").count() > 0, "note_inspection_checks")
    ensure("可以导入" in page.locator("[data-note-import-status]").inner_text(), "note_inspection_status")
    ensure(page.locator("#library-note-import-file-name").input_value().endswith(".md"), "note_suggested_name")
    assert_dialog_centered(page)
    if not import_note:
        page.locator("#library-note-import-cancel").click()
        dialog.wait_for(state="hidden")
        return

    page.locator("#library-note-import-submit").click()
    dialog.wait_for(state="hidden", timeout=30_000)
    page.wait_for_function(
        "() => document.querySelector('#library-note-material-select')?.querySelectorAll('option').length >= 2",
        timeout=30_000,
    )
    ensure(page.locator('[data-reader-tab="note"]').get_attribute("aria-selected") == "true", "note_import_target_tab")
    ensure("Imported fixture note" in page.locator("#library-note-preview").inner_text(), "note_import_preview")
    assert_no_document_overflow(page, "note_dialog_document_overflow")


def assert_recovery_flow(page: Page, audit: BrowserAudit, width: int, height: int) -> None:
    failed = browser_archive(page, "Fixture26-Recover", "W9000000003")
    ensure(failed == {
        "status": 201,
        "body": {
            "status": "created",
            "paper_id": "Fixture26-Recover",
            "folder_name": "Fixture26-Recover",
            "rebuild_status": "failed",
            "index_state": "last_good",
            "recovery_required": True,
        },
    }, "recovery_archive_failure")

    audit.expect_http("POST", "/api/v1/archive/candidates", 503)
    blocked = browser_archive(page, "Fixture26-New", "W9000000005")
    ensure(blocked["status"] == 503, "recovery_blocks_write_status")
    ensure(blocked["body"] == {
        "error": {"code": "RECOVERY_REQUIRED", "message": "论文库需要先完成恢复"},
    }, "recovery_blocks_write_body")

    page.reload(wait_until="networkidle")
    banner = page.locator("[data-library-recovery-banner]")
    banner.wait_for(state="visible")
    ensure("索引重建失败" in page.locator("[data-library-recovery-message]").inner_text(), "recovery_banner_message")
    tuple_text = page.locator("[data-library-recovery-tuple]").inner_text()
    ensure(
        tuple_text == "归档来源 fixture_papers · 本地论文 ID Fixture26-Recover · OpenAlex W9000000003",
        "recovery_banner_tuple",
    )
    rebuild = page.locator("#library-archive-rebuild")
    ensure(rebuild.is_visible() and rebuild.is_enabled(), "recovery_action")
    page.screenshot(path=str(screenshot_path(width, height, "library-recovery.png")), full_page=True)
    rebuild.click()
    page.wait_for_function(
        "() => document.querySelector('[data-library-recovery-message]')?.textContent.includes('恢复完成')",
        timeout=30_000,
    )
    ensure("恢复完成" in page.locator("[data-library-recovery-message]").inner_text(), "recovery_complete")
    page.locator("#library-archive-rebuild").wait_for(state="hidden", timeout=30_000)


def assert_busy_and_restored_writes(page: Page, audit: BrowserAudit) -> None:
    audit.expect_http("POST", "/api/v1/archive/candidates", 409)
    result = page.evaluate(
        """
        async ({ busyBody, blockedBody }) => {
          const request = body => fetch('/api/v1/archive/candidates', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Research-Console-Action': 'archive-candidate',
            },
            body: JSON.stringify(body),
            cache: 'no-store',
            credentials: 'same-origin',
          });
          const firstPromise = request(busyBody);
          await new Promise(resolve => setTimeout(resolve, 75));
          const second = await request(blockedBody);
          const secondBody = await second.json();
          const first = await firstPromise;
          const firstBody = await first.json();
          return {
            first: { status: first.status, body: firstBody },
            second: { status: second.status, body: secondBody },
          };
        }
        """,
        {
            "busyBody": archive_payload("Fixture26-Busy", "W9000000004"),
            "blockedBody": archive_payload("Fixture26-New", "W9000000005"),
        },
    )
    assert_no_private_locator(result, "busy_response_privacy")
    ensure(result["first"]["status"] == 201, "busy_first_status")
    ensure(result["first"]["body"].get("rebuild_status") == "complete", "busy_first_complete")
    ensure(result["second"] == {
        "status": 409,
        "body": {"error": {"code": "LIBRARY_WRITE_BUSY", "message": "论文库正在执行另一项写入"}},
    }, "busy_second_response")

    restored = browser_archive(page, "Fixture26-New", "W9000000005")
    ensure(restored["status"] == 201, "restored_write_status")
    ensure(restored["body"].get("rebuild_status") == "complete", "restored_write_complete")


def navigate_by_link(page: Page, label: str, expected_url: str) -> None:
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("link", name=label, exact=True).click()
    ensure(page.url == expected_url, f"navigation:{label}")


def assert_direction_and_agent_flow(page: Page, origin: str, width: int, height: int) -> None:
    if page.locator("#library-detail").is_visible():
        page.locator("#library-detail-back").click()
    navigate_by_link(page, "方向探索", f"{origin}{DIRECTIONS_PATH}")
    assert_workspace_layout(page, "#directions", ".inspector", "directions_layout")
    page.locator("#save-candidate").click()
    page.wait_for_function(
        "() => document.querySelector('#direction-save-state')?.textContent.startsWith('已显式保存')",
    )
    ensure(page.locator("#direction-save-axes span").count() == 6, "direction_saved_axes")
    ensure("6 个条件" in page.locator("#selected-count").inner_text(), "direction_selection_count")
    page.screenshot(path=str(screenshot_path(width, height, "directions.png")), full_page=True)

    navigate_by_link(page, "研究任务", f"{origin}{AGENT_PATH}")
    page.wait_for_function(
        "() => !document.querySelector('#save-input-snapshot')?.disabled",
        timeout=15_000,
    )
    assert_workspace_layout(page, ".agent-task-main", ".agent-task-inspector", "agent_layout")
    ensure("输入已经就绪" in page.locator("#agent-input-status").inner_text(), "agent_ready")
    ensure(page.locator("#agent-direction-tags span").count() == 6, "agent_direction_axes")
    ensure(RICH_PAPER_ID in page.locator("#agent-paper-list").inner_text(), "agent_shelf_paper")
    page.locator("#snapshot-confirm").check()
    page.locator("#save-input-snapshot").click()
    ensure("输入快照已固定" in page.locator("#agent-page-status").inner_text(), "agent_snapshot_status")
    history = page.locator("#snapshot-history .agent-history-item")
    ensure(history.count() == 1, "agent_snapshot_history")
    ensure("当前" in history.first.inner_text(), "agent_snapshot_current")
    ensure("1 篇论文" in history.first.inner_text(), "agent_snapshot_papers")
    assert_no_private_locator(page.locator("body").inner_text(), "agent_page_privacy")
    page.screenshot(path=str(screenshot_path(width, height, "agent-tasks.png")), full_page=True)

    navigate_by_link(page, "我的论文", f"{origin}{P02_PATH}")
    ensure(page.locator("#materials-title").inner_text().strip() == "从阅读笔记进入 P02", "p02_target")
    assert_workspace_layout(page, ".project-main", ".inspector", "p02_layout")
    navigate_by_link(page, "研究首页", f"{origin}{HOME_PATH}")
    ensure(page.locator("#research-path-title").inner_text().strip() == "当前研究路径", "home_target")
    assert_workspace_layout(page, "#dashboard", ".inspector", "home_layout")


def verify_workbench_viewport(
    browser: Browser,
    origin: str,
    width: int,
    height: int,
) -> None:
    context = browser.new_context(viewport={"width": width, "height": height})
    network = StrictNetwork(context, origin)
    page = context.new_page()
    audit = BrowserAudit(page, origin)
    try:
        prepare_library_workspace(page, origin)
        assert_note_dialog(page, import_note=True)
        page.screenshot(path=str(screenshot_path(width, height, "note-import.png")), full_page=True)
        assert_recovery_flow(page, audit, width, height)
        assert_busy_and_restored_writes(page, audit)
        assert_direction_and_agent_flow(page, origin, width, height)
        assert_browser_storage_privacy(page, "workbench_storage_privacy")
        ensure(not network.problems, "workbench_network:" + ",".join(network.problems))
        audit.assert_complete()
        ensure(not audit.problems, "workbench_browser:" + ",".join(audit.problems))
    finally:
        context.close()


def run_workbench_acceptance() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        try:
            for width, height in VIEWPORTS:
                with temporary_fixture() as fixture:
                    verify_workbench_viewport(
                        browser,
                        fixture.origin,
                        width,
                        height,
                    )
        finally:
            browser.close()
    print("temporary integrated workbench acceptance passed: 2 viewports")


def main() -> int:
    run_workbench_acceptance()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
