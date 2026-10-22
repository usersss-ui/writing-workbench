from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright

from private_library_e2e import (
    BrowserAudit,
    METADATA_PAPER_ID,
    RICH_PAPER_ID,
    StrictNetwork,
    VIEWPORTS,
    WORKBENCH_STATE_PATH,
    assert_browser_storage_privacy,
    assert_no_document_overflow,
    assert_no_private_locator,
    confirmed_archive_candidate,
    ensure,
    fetch_fixture_index,
    launch_chromium,
    read_workbench_state,
    reset_workbench_state,
    screenshot_path,
    select_paper,
    temporary_fixture,
    workbench_state_script,
    write_workbench_state,
)


LIBRARY_PATH = "/local_library_output/desktop/library.html"
DIRECTIONS_PATH = "/prototype/desktop/directions.html"
AGENT_PATH = "/prototype/desktop/agent-tasks.html"
P02_PATH = "/prototype/desktop/p02.html"
HOME_PATH = "/prototype/desktop/index.html"
DISCOVERY_PATH = "/local_library_output/desktop/discovery.html"
P02_WORKFLOW_STORAGE_KEY = "research-console.p02-workflow.v1"
WORKSPACE_STORAGE_KEY = "research-console.paper-library.v1"
DISCOVERY_WORKSPACE_STORAGE_KEY = "research-console.discovery-workspace.v1"
P02_WORKFLOW_STAGES = (
    "algorithm",
    "theory_target",
    "theory_analysis",
    "simulation",
    "writing",
)


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


def assert_note_draft_import(page: Page, origin: str, width: int, height: int) -> None:
    page.goto(f"{origin}{LIBRARY_PATH}", wait_until="networkidle")
    page.locator("#library-results [data-paper-id]").first.wait_for(state="visible")
    select_paper(page, RICH_PAPER_ID)
    page.locator('#library-inspector [data-note-draft-action="open"]').click()
    editor = page.locator(".library-note-draft-dialog")
    editor.wait_for(state="visible")
    marker = f"Manual draft saved from {width}x{height} editor"
    markdown = (
        f"---\npaper_id: {RICH_PAPER_ID}\n---\n\n"
        "# 论文精读\n\n"
        f"{marker}\n\n"
        "## 研究问题\n\nOnly the fixture paper is used for this manual note.\n\n"
        "## 方法与结果\n\nThe recorded formula is $x_{k+1}=x_k-\\alpha g_k$.\n"
    )
    editor.locator("textarea").fill(markdown)
    editor.locator('[data-note-draft-action="import"]').click()
    dialog = page.locator("#library-note-import-dialog")
    dialog.wait_for(state="visible")
    page.wait_for_function(
        "() => !document.querySelector('#library-note-import-submit')?.disabled",
        timeout=15_000,
    )
    ensure(
        page.locator("#library-note-import-form").evaluate("node => node.checkValidity()"),
        "draft_native_form_valid_without_file_selection",
    )
    ensure(page.locator("#library-note-import-file").is_disabled(), "draft_file_picker_disabled")
    ensure(not page.locator("#library-note-import-file-label").is_visible(), "draft_file_picker_hidden")
    source = page.locator("#library-note-import-draft-source").inner_text()
    ensure("来自当前页面的笔记草稿" in source and "无需另选文件" in source, "draft_source_identified")
    ensure(f"{RICH_PAPER_ID}_论文精读.md" in source, "draft_source_filename")
    assert_dialog_centered(page)
    with page.expect_response(lambda response: response.request.method == "POST"
                              and response.url.endswith("/api/v1/notes/import")) as imported:
        page.locator("#library-note-import-submit").click()
    ensure(imported.value.ok, "draft_import_response_success")
    ensure(imported.value.json()["paper_id"] == RICH_PAPER_ID, "draft_import_same_paper")
    dialog.wait_for(state="hidden", timeout=30_000)
    page.wait_for_function(
        "marker => document.querySelector('#library-note-preview')?.textContent.includes(marker)",
        arg=marker,
        timeout=30_000,
    )
    ensure(page.locator('[data-reader-tab="note"]').get_attribute("aria-selected") == "true", "draft_import_preview_tab")
    ensure(marker in page.locator("#library-note-preview").inner_text(), "draft_import_saved_preview")
    page.locator("#library-add-note").click()
    dialog.wait_for(state="visible")
    ensure(page.locator("#library-note-import-file-label").is_visible(), "ordinary_file_picker_restored")
    ensure(page.locator("#library-note-import-file").is_enabled(), "ordinary_file_picker_enabled")
    ensure(page.locator("#library-note-import-file").evaluate("node => node.required"), "ordinary_file_required_restored")
    ensure(not page.locator("#library-note-import-draft-source").is_visible(), "ordinary_file_hides_draft_source")
    ensure(page.locator("#library-note-import-submit").is_disabled(), "ordinary_file_requires_new_inspection")
    page.locator("#library-note-import-cancel").click()
    dialog.wait_for(state="hidden")
    assert_no_document_overflow(page, "draft_import_document_overflow")
    page.screenshot(path=str(screenshot_path(width, height, "manual-note-import.png")), full_page=True)


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
    navigation = page.locator(".primary-nav")
    link = navigation.get_by_role("link", name=label, exact=True)
    if link.count() == 0:
        more_tools = navigation.locator(".nav-more")
        ensure(more_tools.count() == 1, f"navigation_more_tools:{label}")
        if more_tools.get_attribute("open") is None:
            more_tools.locator("summary").click()
    ensure(link.count() == 1, f"navigation_link:{label}")
    ensure(link.is_visible(), f"navigation_visible:{label}")
    with page.expect_navigation(wait_until="networkidle"):
        link.click()
    ensure(page.url == expected_url, f"navigation:{label}")


def assert_p02_stage_state(page: Page, stage: str, expected: str, code: str) -> None:
    ensure(
        page.locator(f'[data-workflow-stage="{stage}"]').get_attribute("data-workflow-state") == expected,
        code,
    )


def accept_p02_stage(page: Page, stage: str, next_stage: str | None) -> None:
    page.locator(f'[data-action="accept-stage"][data-stage="{stage}"]').click()
    assert_p02_stage_state(page, stage, "accepted", f"p02_{stage}_accepted")
    if next_stage is None:
        return
    assert_p02_stage_state(page, next_stage, "draft", f"p02_{next_stage}_draft")
    next_panel = page.locator(f'[data-workflow-stage="{next_stage}"]')
    ensure(next_panel.get_attribute("open") is not None, f"p02_{next_stage}_opened")
    ensure(not next_panel.locator("[data-stage-fields]").is_disabled(), f"p02_{next_stage}_enabled")


def assert_p02_workflow_flow(page: Page, width: int, height: int) -> None:
    workspace_state = {
        "version": 1,
        "shelf": {
            "Fixture24-Rich": ["algorithm_mechanism"],
            "Fixture25-Theory": ["theory_evidence"],
            "Fixture25-Simulation": ["simulation_baseline"],
            "Fixture25-Writing": ["related_work"],
        },
        "personalReading": {},
        "selectedPaperId": RICH_PAPER_ID,
    }
    page.evaluate("key => localStorage.removeItem(key)", P02_WORKFLOW_STORAGE_KEY)
    write_workbench_state(page, WORKSPACE_STORAGE_KEY, workspace_state)
    page.reload(wait_until="networkidle")
    page.locator("#workflow-loop").wait_for(state="visible")
    assert_p02_stage_state(page, "algorithm", "draft", "p02_workflow_boot")
    for role, paper_id in (
        ("algorithm_mechanism", "Fixture24-Rich"),
        ("theory_evidence", "Fixture25-Theory"),
        ("simulation_baseline", "Fixture25-Simulation"),
        ("related_work", "Fixture25-Writing"),
    ):
        card = page.locator(f'[data-workflow-role="{role}"]')
        ensure(card.locator("[data-role-count]").inner_text().strip() == "1 篇", f"p02_source_count:{role}")
        ensure(paper_id in card.locator("[data-role-papers]").inner_text(), f"p02_source_paper:{role}")

    algorithm = page.locator('[data-stage-form="algorithm"]')
    algorithm.locator('[name="problem_type"]').select_option("offline")
    algorithm.locator('[name="research_objective"]').fill(
        "在时变非平衡有向网络下减少通信并保持耦合约束可行性",
    )
    for mechanism in ("M01", "M03", "M04"):
        algorithm.locator(f'[name="mechanisms"][value="{mechanism}"]').check()
    algorithm.locator('[name="update_plan"]').fill(
        "先混合邻居保留状态，再完成局部原始对偶更新，最后按触发条件决定是否广播。",
    )
    algorithm.locator('[name="contribution_boundary"]').fill(
        "低通信触发机制是待核验差异，不提前声称新颖性或收敛结论。",
    )
    accept_p02_stage(page, "algorithm", "theory_target")

    theory_target = page.locator('[data-stage-form="theory_target"]')
    for outcome in ("convergence", "constraint", "communication"):
        theory_target.locator(f'[name="outcomes"][value="{outcome}"]').check()
    theory_target.locator('[name="theorem_target"]').fill(
        "希望证明算法收敛到最优可行解，并分别给出约束违背和通信次数的界。",
    )
    accept_p02_stage(page, "theory_target", "theory_analysis")

    theory_analysis = page.locator('[data-stage-form="theory_analysis"]')
    theory_analysis.locator('[name="assumptions"]').fill(
        "联合强连通、凸目标、Slater 条件；触发阈值条件仍待原文核验。",
    )
    theory_analysis.locator('[name="lemma_chain"]').fill(
        "混合误差 → 触发扰动可和性 → 原始对偶误差 → 主定理。",
    )
    theory_analysis.locator('[name="proof_gaps"]').fill(
        "尚未证明触发扰动在时变非平衡权重下可和。",
    )
    accept_p02_stage(page, "theory_analysis", "simulation")

    simulation = page.locator('[data-stage-form="simulation"]')
    simulation.locator('[name="metrics"]').fill("最优性误差、累计约束违背、累计通信次数")
    simulation.locator('[name="baselines"]').fill("无触发版本与固定周期通信版本")
    simulation.locator('[name="communication_budget"]').fill("统一消息次数、停止阈值与迭代预算")
    simulation.locator('[name="result_status"]').select_option("verified")
    simulation.locator('[name="result_summary"]').fill("夹具结果与实现已经人工核验。")
    accept_p02_stage(page, "simulation", "writing")

    writing = page.locator('[data-stage-form="writing"]')
    writing.locator('[name="target_venue"]').fill("IEEE Transactions on Automatic Control (候选)")
    writing.locator('[name="venue_references"]').fill("Fixture25-Writing；仅学习结构与表达。")
    page.locator("#workflow-generate-writing").click()
    ensure("拟研究" in writing.locator('[name="problem_algorithm"]').input_value(), "p02_writing_algorithm_generated")
    theory_material = writing.locator('[name="theory_section"]')
    simulation_material = writing.locator('[name="experiment_section"]')
    theory_text = theory_material.input_value()
    ensure(
        "理论目标" in theory_text
        and all(label in theory_text for label in ("收敛性", "约束违背", "通信复杂度")),
        "p02_writing_theory_targets",
    )
    ensure("尚未形成已经成立的理论结论" in theory_material.input_value(), "p02_writing_theory_boundary")
    ensure(theory_material.get_attribute("data-readiness") != "verified", "p02_theory_not_overstated")
    ensure(simulation_material.get_attribute("data-readiness") == "verified", "p02_simulation_verified_before_change")
    visible_theory_readiness = page.locator('[data-material-readiness="theory_section"]')
    ensure(visible_theory_readiness.is_visible(), "p02_visible_theory_readiness_visible")
    ensure(visible_theory_readiness.inner_text().strip() == "待核验", "p02_visible_theory_readiness")
    accept_p02_stage(page, "writing", None)
    ensure(
        page.locator("#workflow-stage-summary strong").inner_text().strip() == "首轮材料闭环已建立",
        "p02_workflow_complete_summary",
    )
    ensure("核验" in page.locator("[data-next-action]").first.inner_text(), "p02_complete_next_actions")
    ensure(
        page.locator('[data-writing-entry-status="algorithm"]').inner_text().strip() == "已有算法草稿",
        "p02_algorithm_entry_status",
    )
    ensure(
        page.locator('[data-writing-entry-status="theory"]').inner_text().strip() == "证明链待逐项核验",
        "p02_theory_entry_status",
    )
    ensure(
        page.locator('[data-writing-entry-status="simulation"]').inner_text().strip() == "用户标记已核验",
        "p02_simulation_entry_status",
    )
    assert_workspace_layout(page, ".project-main", ".inspector", "p02_workflow_complete_layout")
    page.screenshot(path=str(screenshot_path(width, height, "p02-workflow-complete.png")), full_page=True)

    page.reload(wait_until="networkidle")
    stored = page.evaluate("key => JSON.parse(localStorage.getItem(key))", P02_WORKFLOW_STORAGE_KEY)
    ensure(stored["accepted_stages"] == list(P02_WORKFLOW_STAGES), "p02_workflow_reload_storage")
    for stage in P02_WORKFLOW_STAGES:
        assert_p02_stage_state(page, stage, "accepted", f"p02_reload_{stage}_accepted")
    ensure(
        page.locator('[data-stage-form="writing"] [name="target_venue"]').input_value()
        == "IEEE Transactions on Automatic Control (候选)",
        "p02_reload_writing_value",
    )

    completed_state = stored
    page.locator("#workflow-stage-algorithm summary").click()
    changed_boundary = page.locator('[data-stage-form="algorithm"] [name="contribution_boundary"]')
    changed_boundary.fill("上游算法差异已改为质量守恒触发机制，后续材料必须重新核验。")
    page.reload(wait_until="networkidle")
    reloaded_boundary = page.locator('[data-stage-form="algorithm"] [name="contribution_boundary"]').input_value()
    ensure(
        reloaded_boundary == "上游算法差异已改为质量守恒触发机制,后续材料必须重新核验。",
        "p02_input_event_saved_without_blur",
    )
    assert_p02_stage_state(page, "algorithm", "draft", "p02_algorithm_draft_after_change")
    for stage in ("theory_target", "theory_analysis", "simulation", "writing"):
        assert_p02_stage_state(page, stage, "needs_review", f"p02_{stage}_needs_review")
    ensure(
        page.locator('[data-stage-form="writing"] [name="theory_section"]').get_attribute("data-readiness") != "verified",
        "p02_theory_readiness_downgraded",
    )
    ensure(
        page.locator('[data-stage-form="writing"] [name="experiment_section"]').get_attribute("data-readiness") != "verified",
        "p02_simulation_readiness_downgraded",
    )
    stored_after_change = page.evaluate("key => JSON.parse(localStorage.getItem(key))", P02_WORKFLOW_STORAGE_KEY)
    ensure(stored_after_change["accepted_stages"] == [], "p02_upstream_change_invalidates_acceptance")
    ensure(
        stored_after_change["writing"]["target_venue"] == "IEEE Transactions on Automatic Control (候选)",
        "p02_upstream_change_preserves_writing",
    )

    page.evaluate(
        """
        ({ key, state }) => {
          localStorage.setItem(key, JSON.stringify(state));
          window.dispatchEvent(new StorageEvent('storage', { key }));
        }
        """,
        {"key": P02_WORKFLOW_STORAGE_KEY, "state": completed_state},
    )
    for stage in P02_WORKFLOW_STAGES:
        assert_p02_stage_state(page, stage, "accepted", f"p02_multitab_restore_{stage}")

    workspace_after_source_change = read_workbench_state(page, WORKSPACE_STORAGE_KEY)
    del workspace_after_source_change["shelf"]["Fixture25-Theory"]
    write_workbench_state(page, WORKSPACE_STORAGE_KEY, workspace_after_source_change)
    assert_p02_stage_state(page, "algorithm", "accepted", "p02_source_change_keeps_algorithm")
    assert_p02_stage_state(page, "theory_target", "draft", "p02_source_change_reopens_theory")
    for stage in ("theory_analysis", "simulation", "writing"):
        assert_p02_stage_state(page, stage, "needs_review", f"p02_source_change_{stage}_needs_review")
    source_changed = page.evaluate("key => JSON.parse(localStorage.getItem(key))", P02_WORKFLOW_STORAGE_KEY)
    ensure(source_changed["accepted_stages"] == ["algorithm"], "p02_source_change_invalidates_prefix")
    ensure(source_changed["writing"]["target_venue"] == "IEEE Transactions on Automatic Control (候选)", "p02_source_change_preserves_writing")
    assert_workspace_layout(page, ".project-main", ".inspector", "p02_workflow_review_layout")
    assert_no_private_locator(page.locator("body").inner_text(), "p02_workflow_privacy")
    page.screenshot(path=str(screenshot_path(width, height, "p02-workflow-needs-review.png")), full_page=True)


def assert_direction_and_agent_flow(page: Page, origin: str, width: int, height: int) -> None:
    if page.locator("#library-detail").is_visible():
        page.locator("#library-detail-back").click()
    navigate_by_link(page, "确定方向", f"{origin}{DIRECTIONS_PATH}")
    assert_workspace_layout(page, "#directions", None, "directions_layout")
    page.locator("#direction-advanced > summary").click()
    page.locator("#save-candidate").click()
    page.wait_for_function(
        "() => document.querySelector('#direction-save-state')?.textContent.startsWith('已显式保存')",
    )
    ensure(page.locator("#direction-save-axes span").count() == 6, "direction_saved_axes")
    ensure("6 个条件" in page.locator("#selected-count").inner_text(), "direction_selection_count")
    page.screenshot(path=str(screenshot_path(width, height, "directions.png")), full_page=True)

    navigate_by_link(page, "研究任务输入", f"{origin}{AGENT_PATH}")
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

    navigate_by_link(page, "P02 研究记录", f"{origin}{P02_PATH}")
    ensure(page.locator("#materials-title").inner_text().strip() == "从阅读笔记进入 P02", "p02_target")
    assert_workspace_layout(page, ".project-main", ".inspector", "p02_layout")
    assert_p02_workflow_flow(page, width, height)
    navigate_by_link(page, "研究首页", f"{origin}{HOME_PATH}")
    ensure(page.get_by_role("heading", name="从找论文，到写论文", exact=True).is_visible(), "home_target")
    ensure(page.locator(".home-step").count() == 4, "home_research_steps")
    page.wait_for_function(
        "() => Number(document.querySelector('#home-paper-count')?.textContent) > 0",
        timeout=15_000,
    )
    assert_workspace_layout(page, "#dashboard", None, "home_layout")


def verify_search_and_local_matches(browser: Browser, origin: str, width: int, height: int) -> None:
    index = fetch_fixture_index(origin)
    papers = {paper["paper_id"]: paper for paper in index["papers"]}
    rich = papers[RICH_PAPER_ID]
    metadata = papers[METADATA_PAPER_ID]
    ensure(bool(rich["source_documents"]["pdf"]), "search_fixture_rich_has_pdf")
    ensure(not metadata["source_documents"]["pdf"], "search_fixture_metadata_has_no_pdf")

    def work(paper_id: str, title: str, doi: str | None, year: int = 2024) -> dict[str, Any]:
        return {
            "id": f"https://openalex.org/{paper_id}",
            "doi": f"https://doi.org/{doi}" if doi else None,
            "title": title,
            "authorships": [{"author": {"display_name": "Fixture Author"}}],
            "publication_year": year,
            "language": "en",
            "type": "article",
            "is_retracted": False,
            "primary_location": {
                "source": {"id": "https://openalex.org/S9100000001", "display_name": "Controlled Search Fixture", "type": "journal", "issn_l": "1234-5679", "issn": ["1234-5679"]},
                "landing_page_url": f"https://example.org/papers/{paper_id.lower()}",
            },
            "cited_by_count": 3,
            "open_access": {"is_oa": False, "oa_url": None},
            "topics": [],
            "best_oa_location": None,
            "abstract_inverted_index": None,
        }

    rich_work = work("W9100000011", rich["title_original"], "10.1234/fixture.rich")
    metadata_work = work("W9000000002", metadata["title_original"], None, 2026)
    missing_work = work("W9100000013", "Synthetic Mercury Spectral Experiment", "10.1234/unindexed.fixture")
    possible_work = work("W9100000014", rich["title_original"], "10.1234/different.fixture")
    last_work = work("W9100000015", "Synthetic Cedar Dynamics", "10.1234/second.fixture")
    next_cursor = "controlled+/page-two="
    query = "distributed fixture optimization"
    secondary_query = '("controlled secondary")'
    note_work = work("W9100000016", "Note-Only Controlled Search Fixture", "10.1234/fixture.note")
    retracted_work = {**work("W9100000017", "Withdrawn Synthetic Lunar Analysis", "10.1234/fixture.retracted"), "is_retracted": True}
    later_retraction_query = "controlled later retraction"
    later_retraction_work = work("W9100000018", "Synthetic Later Retraction Fixture", "10.1234/fixture.later-retraction")
    reset_workbench_state(origin)
    context = browser.new_context(viewport={"width": width, "height": height})
    network = StrictNetwork(
        context,
        origin,
        openalex_query=query,
        openalex_filter="from_publication_date:2022-01-01,to_publication_date:2026-12-31,language:en,is_retracted:false",
        openalex_pages={
            (query, "*"): {"meta": {"count": 5, "next_cursor": next_cursor}, "results": [rich_work, metadata_work, missing_work, possible_work]},
            (query, next_cursor): {"meta": {"count": 5, "next_cursor": None}, "results": [rich_work, last_work]},
            (secondary_query, "*"): {"meta": {"count": 3, "next_cursor": None}, "results": [rich_work, note_work, retracted_work]},
            (later_retraction_query, "*"): {"meta": {"count": 1, "next_cursor": "later-retraction"}, "results": [later_retraction_work]},
            (later_retraction_query, "later-retraction"): {"meta": {"count": 1, "next_cursor": None}, "results": [{**later_retraction_work, "is_retracted": True}]},
        },
    )
    page = context.new_page()
    audit = BrowserAudit(page, origin)
    writes: list[str] = []
    # Saving research state is expected; these checks guard library and archive writes.
    page.on("request", lambda request: writes.append(request.method) if request.method not in {"GET", "HEAD", "OPTIONS"} and urlparse(request.url).path != WORKBENCH_STATE_PATH else None)
    try:
        page.goto(f"{origin}{DIRECTIONS_PATH}", wait_until="networkidle")
        ensure(page.locator("#direction-advanced").get_attribute("open") is None, "search_direction_options_optional")
        page.locator("#paper-search").fill(query)
        page.locator("#search-start-year").fill("2022")
        page.locator("#search-end-year").fill("2026")
        page.locator("#search-language").select_option("en")
        with page.expect_navigation(wait_until="networkidle"):
            page.locator("#direction-search-submit").click()
        ensure(page.url.startswith(f"{origin}{DISCOVERY_PATH}?"), "search_direction_destination")
        page.wait_for_function("() => document.querySelectorAll('#keyword-live-results-list [data-paper-id]').length === 4")
        ensure(page.locator("#keyword-query").input_value() == query, "search_raw_query_transferred")
        ensure(page.locator("#english-query").input_value() == "", "search_no_forced_translation")
        ensure(network.openalex_cursors == ["*"], "search_no_automatic_next_page")
        ensure(query in page.locator("#actual-search-query").inner_text(), "search_actual_query_visible")
        ensure("去重后已加载 4 篇" in page.locator("#keyword-search-status").inner_text(), "search_first_page_unique_count")
        ensure("openalex 已加载来源记录 4" in page.locator("#discovery-source-status").text_content(), "search_first_page_source_count")
        ensure("已核对当前本地索引" in page.locator("#local-match-status").inner_text(), "search_index_ready")

        for paper_id, status, label, local_id in (
            ("W9100000011", "existing_pdf", "本地已有 PDF", RICH_PAPER_ID),
            ("W9000000002", "missing_pdf", "缺 PDF", METADATA_PAPER_ID),
            ("W9100000013", "not_found", "当前本地索引未匹配", None),
            ("W9100000014", "possible_match", "疑似重复", RICH_PAPER_ID),
        ):
            card = page.locator(f'#keyword-live-results-list [data-paper-id="{paper_id}"]')
            ensure(card.get_attribute("data-local-status") == status, f"search_local_status:{status}")
            ensure(label in card.inner_text(), f"search_local_visible:{status}")
            ensure(card.locator("[data-select-result]").is_enabled(), f"search_independent_candidate:{status}")
            if local_id:
                ensure(card.locator(f'a[href="./library.html?paper_id={local_id}"]').count() == 1, f"search_local_link:{status}")
        ensure("DOI 不一致" in page.locator('[data-paper-id="W9100000014"]').inner_text(), "search_doi_conflict_disclosed")

        more = page.locator("#keyword-load-more")
        ensure(more.is_visible() and more.is_enabled(), "search_next_page_available")
        more.click()
        page.wait_for_function("() => document.querySelectorAll('#keyword-live-results-list [data-paper-id]').length === 5")
        ensure(network.openalex_cursors == ["*", next_cursor], "search_explicit_cursor_only")
        ensure(page.locator('[data-paper-id="W9100000011"]').count() == 1, "search_cross_page_dedup")
        ensure(page.locator('[data-paper-id="W9100000013"]').is_visible(), "search_previous_page_preserved")
        ensure("去重后已加载 5 篇" in page.locator("#keyword-search-status").inner_text(), "search_total_unique_count")
        ensure("openalex 已加载来源记录 6" in page.locator("#discovery-source-status").text_content(), "search_page_observations")
        ensure("finished" in page.locator("#discovery-source-status").text_content() and not more.is_visible(), "search_end_of_pages")
        assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "search_layout")
        page.screenshot(path=str(screenshot_path(width, height, "search-local-matches.png")), full_page=True)

        index_url = f"{origin}/local_library_data/paper-index.json"
        audit.expect_http("GET", "/local_library_data/paper-index.json", 503)
        page.route(index_url, lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":"controlled_index_failure"}'))
        page.locator("#refresh-local-matches").click()
        page.wait_for_function("() => document.querySelector('#local-match-status')?.textContent.includes('读取失败')")
        ensure(page.locator('#keyword-live-results-list [data-local-status="unknown"]').count() == 5, "search_failed_index_marks_all_unknown")
        ensure("未匹配" not in page.locator("#keyword-live-results-list").inner_text(), "search_failure_not_absence")
        page.unroute(index_url)
        page.locator("#refresh-local-matches").click()
        page.wait_for_function("() => document.querySelector('[data-paper-id=\"W9100000011\"]')?.dataset.localStatus === 'existing_pdf'")
        ensure(network.openalex_cursors == ["*", next_cursor], "search_local_refresh_does_not_repeat_online_search")

        page.locator(".discovery-query-tools > summary").filter(has_text="可选：英文检索式").click()
        page.locator("#generate-english-query").click()
        ensure(page.locator("#english-query").input_value() == query, "search_optional_expression")
        ensure(network.openalex_requests == 2, "search_expression_generation_is_local")
        page.locator("#keyword-search-form").evaluate("form => form.requestSubmit()")
        page.wait_for_function("() => document.querySelectorAll('#keyword-live-results-list [data-paper-id]').length === 4")
        ensure(network.openalex_cursors == ["*", next_cursor, "*"], "search_form_submits_first_page")
        ensure(page.locator('[data-candidate-count]').inner_text().strip() == "0", "search_does_not_change_candidates")
        # A second selected expression shares one work, while independent source
        # observations and pending/excluded evidence must remain visible.
        page.locator(".discovery-query-tools > summary").filter(has_text="条件、检索组合与来源").click()
        page.get_by_role("button", name="添加条件", exact=True).click()
        row = page.locator(".discovery-condition-row").last
        row.get_by_label("条件名称", exact=True).fill("Controlled second expression")
        row.get_by_label("术语与同义词（分号分隔）", exact=True).fill("controlled secondary")
        row.locator("select").select_option("problem")
        page.locator("#discovery-expand").check()
        page.get_by_role("button", name="预览检索组合", exact=True).click()
        ensure(query in page.locator("#discovery-plan-preview").inner_text() and secondary_query in page.locator("#discovery-plan-preview").inner_text(), "broad_two_query_preview")
        before_batch = network.openalex_requests
        page.locator("#keyword-live-search").click()
        page.wait_for_function("() => !document.querySelector('#keyword-live-search').disabled && document.querySelectorAll('#keyword-live-results-list article').length === 5")
        ensure(network.openalex_requests == before_batch + 2, "broad_two_selected_requests")
        ensure(set(network.openalex_queries[-2:]) == {(query, "*"), (secondary_query, "*")}, "broad_exact_query_pairs")
        ensure(page.locator('#keyword-live-results-list [data-paper-id="W9100000011"]').count() == 1, "broad_cross_query_dedup")
        sources = page.locator("#discovery-source-status").inner_text()
        ensure("openalex 已加载来源记录 7" in sources and "来源匹配 5 · 已加载 4" in sources and "来源匹配 3 · 已加载 3" in sources, "broad_unique_vs_sources")
        note_card = page.locator('#keyword-live-results-list [data-paper-id="W9100000016"]')
        ensure(note_card.get_attribute("data-local-status") == "missing_pdf" and "本地索引已有笔记" in note_card.inner_text(), "broad_note_only_material")
        ensure("本地索引未标记笔记" in page.locator('#keyword-live-results-list [data-paper-id="W9000000002"]').inner_text(), "broad_metadata_no_material")
        ensure(page.locator('#keyword-live-results-list [data-paper-id="W9100000017"]').count() == 0, "broad_retracted_absent_from_cards")
        excluded = page.locator('[data-exclusion-summary]')
        ensure("已排除 1 篇" in excluded.inner_text() and "去重后已加载 5 篇" in page.locator('.discovery-loaded-summary').inner_text(), "broad_excluded_not_in_ordinary_count")
        excluded.locator('summary').click()
        ensure("Withdrawn Synthetic Lunar Analysis" in excluded.inner_text() and "来源已标记撤稿" in excluded.inner_text() and "openalex" in excluded.inner_text(), "broad_exclusion_basis_and_provenance")
        ensure(excluded.locator('[data-select-result], [data-convert-result], article').count() == 0, "broad_exclusion_has_no_ordinary_controls")
        missing_text = page.locator('#keyword-live-results-list [data-paper-id="W9100000013"]').inner_text()
        ensure("缺少已确认 JIF 数据年和期刊证据" in missing_text, "broad_unknown_jcr_pending")
        page.locator('[data-discovery-view="all"]').click()
        before = network.openalex_requests
        page.locator('[data-discovery-view="curated"]').click()
        ensure(page.locator("#keyword-live-results-list article").count() == 0, "broad_unverified_never_curated")
        ensure(page.locator("[data-return-all]").is_visible(), "broad_curated_actionable_empty")
        assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "broad_curated_layout")
        page.locator('[data-discovery-view="all"]').click()
        ensure(network.openalex_requests == before, "curated_switch_no_request")
        assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "broad_all_layout")
        assert_no_private_locator(page.locator("body").inner_text(), "broad_all_page_privacy")
        page.locator("#keyword-live-results-list").scroll_into_view_if_needed()
        page.screenshot(path=str(screenshot_path(width, height, "broad-discovery-all.png")), full_page=True)

        page.locator(".discovery-query-tools > summary").filter(has_text="导入题录与导出所选论文").click()
        page.locator("#discovery-import-provider").select_option("scholar")
        bibliography = ("@article{controlled, title={Rich Integrated Fixture for Distributed Optimization}, "
                        "doi={https://doi.org/10.1234/fixture.rich}, author={Fixture Author}, year={2024}, "
                        "journal={Controlled Search Fixture}}").encode("utf-8")
        page.locator("#discovery-import-file").set_input_files({"name": "controlled.bib", "mimeType": "application/x-bibtex", "buffer": bibliography})
        confirm = page.locator("#discovery-import-preview").get_by_role("button", name="确认导入", exact=True)
        confirm.wait_for(state="visible")
        ensure("scholar 已加载来源记录" not in page.locator("#discovery-source-status").inner_text(), "broad_import_preview_no_commit")
        confirm.click()
        ensure("scholar 已加载来源记录 1" in page.locator("#discovery-source-status").inner_text(), "broad_import_source_added")
        ensure(page.locator("#keyword-live-results-list article").count() == 5, "broad_import_identity_no_duplicate")
        rich_card = page.locator('#keyword-live-results-list [data-paper-id="W9100000011"]')
        ensure(any(set(text.split(" / ")) == {"openalex", "scholar"} for text in rich_card.locator("p").all_text_contents()), "broad_import_provenance")
        rich_card.locator("[data-review-result]").click()
        panel = page.locator("#discovery-review-panel")
        ensure(panel.is_visible(), "broad_review_open")
        panel.scroll_into_view_if_needed()
        ensure(panel.evaluate("panel => [...panel.querySelectorAll('input[type=checkbox]')].every(node => node.getBoundingClientRect().width <= 24) && [...panel.querySelectorAll('input:not([type=checkbox]), select')].every(node => node.getBoundingClientRect().height >= 32)"), "broad_review_control_dimensions")
        ensure("10.1234/fixture.rich" in panel.inner_text(), "broad_review_public_identity")
        assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "broad_review_layout")
        ensure(page.evaluate("() => { const main=document.querySelector('.discovery-main').getBoundingClientRect(); return ['#keyword-live-results-list','#discovery-review-panel'].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.left>=main.left && r.right<=main.right+1 && r.right<=innerWidth;}); }"), "broad_list_review_contained")
        page.screenshot(path=str(screenshot_path(width, height, "broad-discovery-review.png")), full_page=True)

        # Keep the old DOM confirmation handle across a generation change. An
        # accidental stale commit would add this conflicting DOI to saved state.
        page.locator("#discovery-import-file").set_input_files({"name": "stale.bib", "mimeType": "application/x-bibtex", "buffer": b'@article{stale, title={Stale Controlled Import}, doi={10.1234/stale.fixture}, year={2024}}'})
        confirm.wait_for(state="visible")
        stale_confirm = confirm.element_handle()
        page.locator("#keyword-query").fill(secondary_query)
        page.locator("#keyword-live-search").click()
        page.wait_for_function("() => !document.querySelector('#keyword-live-search').disabled && document.querySelectorAll('#keyword-live-results-list article').length === 2")
        stored_state = f"async () => JSON.stringify({{ disk: await ({workbench_state_script(DISCOVERY_WORKSPACE_STORAGE_KEY)})(), local: Object.entries(localStorage) }})"
        before_stale = page.evaluate(stored_state)
        stale_confirm.evaluate("button => button.click()")
        ensure(page.evaluate(stored_state) == before_stale, "broad_stale_confirmation_no_storage_change")
        ensure("stale.fixture" not in before_stale and "Stale Controlled Import" not in page.locator("#keyword-live-results-list").inner_text(), "broad_stale_record_not_committed")
        ensure(secondary_query in page.locator("#actual-search-query").inner_text() and page.locator('#keyword-live-results-list [data-paper-id="W9100000016"]').count() == 1, "broad_current_generation_preserved")
        current_identity = page.evaluate("""async () => {
          const response = await fetch('/api/v1/workbench-state', { cache: 'no-store' });
          const state = JSON.parse((await response.json()).entries['research-console.discovery-workspace.v1'].value);
          const batch = state.batches.at(-1);
          const record = state.records.find(record => batch.record_ids.includes(record.record_id) && record.provider_id === 'W9100000016');
          return { expression: batch.plan.selected[0].expression, title: record.bibliography.title, doi: record.bibliography.doi };
        }""")
        ensure(current_identity == {"expression": secondary_query, "title": "Note-Only Controlled Search Fixture", "doi": "10.1234/fixture.note"}, "broad_current_title_doi_pair")
        ensure(page.locator('[data-candidate-count]').inner_text().strip() == "0" and page.locator("#discovery-external-candidates article").count() == 0, "broad_no_implicit_candidates")
        assert_late_conflict_revokes_recommendation(page, network, writes, width, height)
        ensure(not writes, "discovery_no_archive_writes")
        ensure(not writes, "search_read_only_requests")
        with page.expect_navigation(wait_until="networkidle"):
            page.locator(f'[data-paper-id="W9100000011"] a[href="./library.html?paper_id={RICH_PAPER_ID}"]').click()
        ensure(page.url == f"{origin}{LIBRARY_PATH}?paper_id={RICH_PAPER_ID}", "search_local_reader_destination")
        page.locator("#library-detail").wait_for(state="visible")
        ensure(page.locator("#library-context-title").inner_text() == RICH_PAPER_ID, "search_local_reader_selected")
        assert_browser_storage_privacy(page, "search_storage_privacy")
        assert_later_retraction_excludes_saved_result(page, network, writes, origin, later_retraction_query, width, height)
        ensure(not network.problems, "search_network:" + ",".join(network.problems))
        audit.assert_complete()
        ensure(not audit.problems, "search_browser:" + ",".join(audit.problems))
    finally:
        context.close()


def assert_late_conflict_revokes_recommendation(
    page: Page, network: StrictNetwork, writes: list[str], width: int, height: int,
) -> None:
    """A valid later source must invalidate a previously evidenced recommendation.

    All state creation goes through the fixture UI. Storage reads below inspect
    identities/evidence; they never seed or overwrite browser state.
    """
    page.locator("#discovery-query-plan").get_by_role("button", name="添加条件", exact=True).click()
    row = page.locator(".discovery-condition-row").last
    row.get_by_label("条件名称", exact=True).fill("Controlled late-conflict condition")
    row.get_by_label("术语与同义词（分号分隔）", exact=True).fill("controlled secondary")
    row.locator("select").select_option("problem")
    page.locator("#keyword-live-search").click()
    page.wait_for_function("() => !document.querySelector('#keyword-live-search').disabled && document.querySelectorAll('#keyword-live-results-list article').length === 2")

    page.locator(".discovery-query-tools > summary").filter(has_text="期刊核验与推荐规则").click()
    journal_csv = (
        "title,issns,metric,data_year,category,quartile,source_url\n"
        "Controlled Search Fixture,1234-5679,JIF,2024,Automation & Control Systems,Q1,https://example.org/controlled-jcr-2024\n"
    ).encode("utf-8")
    page.locator("#discovery-journal-file").set_input_files({"name": "controlled-jcr.csv", "mimeType": "text/csv", "buffer": journal_csv})
    page.locator("#discovery-journal-preview-button").click()
    page.locator("[data-journal-identity]").check()
    page.locator("#discovery-journal-preview").get_by_role("button", name="确认保存 JCR 核验", exact=True).click()
    page.locator("#discovery-rule-year").fill("2024")
    page.locator("#discovery-apply-rules").click()

    note_card = page.locator('#keyword-live-results-list [data-paper-id="W9100000016"]')
    note_card.locator("[data-review-result]").click()
    review = page.locator("#discovery-review-panel")
    review.locator('[data-review-field^="condition:"]').select_option("confirmed")
    review.locator('[data-review-field="role"]').select_option("baseline")
    review.locator('[data-review-field="locator"]').fill("Controlled fixture statement 1")
    review.locator('[data-review-field="reason"]').fill("Synthetic manual evidence for the declared condition and baseline role")
    review.locator('[data-review-field="manual"]').check()
    review.locator('[data-review-field="save"]').click()
    ensure("核验已保存" in review.inner_text(), "late_conflict_manual_evidence_saved")
    note_card.locator("[data-select-result]").click()
    ensure(note_card.locator("[data-convert-result]").is_enabled(), "late_conflict_initial_conversion_eligible")

    read_state = workbench_state_script(DISCOVERY_WORKSPACE_STORAGE_KEY)
    before = page.evaluate(read_state)
    original_record = next(record for record in before["records"] if record["provider_id"] == "W9100000016")
    original_result = next(result for result in before["results"] if original_record["record_id"] in result["record_ids"])
    result_id = original_result["result_id"]
    original_candidate = next(candidate for candidate in before["external_candidates"] if candidate["result_id"] == result_id)
    condition_evidence = [entry for entry in before["condition_reviews"] if entry["result_id"] == result_id]
    representative_evidence = [entry for entry in before["representative_reviews"] if entry["result_id"] == result_id]
    ensure(original_result["identity_status"] == "clear" and not original_result["conflicts"], "late_conflict_initial_identity_clear")
    ensure(len(condition_evidence) == 1 and condition_evidence[0]["status"] == "confirmed" and condition_evidence[0]["evidence"]["record_ids"], "late_conflict_initial_condition_evidence")
    ensure(len(representative_evidence) == 1 and representative_evidence[0]["role"] == "baseline" and representative_evidence[0]["evidence"]["record_ids"], "late_conflict_initial_representative_evidence")
    ensure(any(row["identity_confirmed"] and row["quartile"] == "Q1" for row in before["journal_reviews"]) and before["batches"][-1]["rule_snapshot"]["data_year"] == 2024, "late_conflict_initial_journal_evidence")
    before_requests = network.openalex_requests
    page.locator('[data-discovery-view="curated"]').click()
    ensure(note_card.count() == 1 and page.locator("#keyword-live-results-list article").count() == 1, "late_conflict_initial_recommended")
    assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "late_conflict_before_layout")
    note_card.scroll_into_view_if_needed()
    page.screenshot(path=str(screenshot_path(width, height, "broad-discovery-before-late-conflict.png")), full_page=True)
    page.locator('[data-discovery-view="all"]').click()

    # This is a current-generation, explicitly confirmed import, unlike the
    # stale-preview case above. Its conflicting DOI arrives only after evidence
    # and a candidate have already been saved for the clear original result.
    conflicting_bib = (
        "@article{later, title={Note-Only Controlled Search Fixture}, "
        "doi={10.1234/fixture.note-conflicting}, author={Fixture Author}, "
        "year={2024}, journal={Controlled Search Fixture}}"
    ).encode("utf-8")
    page.locator("#discovery-import-file").set_input_files({"name": "controlled-later-conflict.bib", "mimeType": "application/x-bibtex", "buffer": conflicting_bib})
    late_confirm = page.locator("#discovery-import-preview").get_by_role("button", name="确认导入", exact=True)
    late_confirm.wait_for(state="visible")
    ensure(page.evaluate(read_state) == before, "late_conflict_preview_preserves_established_state")
    late_confirm.click()
    after = page.evaluate(read_state)
    after_result = next(result for result in after["results"] if result["result_id"] == result_id)
    ensure(after_result["identity_status"] == "conflict" and after_result["conflicts"], "late_conflict_valid_arrival_marks_original_conflict")
    ensure(all(record in after["records"] for record in before["records"]), "late_conflict_original_records_retained")
    ensure(original_candidate in after["external_candidates"], "late_conflict_original_candidate_retained")
    ensure(all(entry in after["condition_reviews"] for entry in condition_evidence) and all(entry in after["representative_reviews"] for entry in representative_evidence), "late_conflict_prior_evidence_retained")
    ensure(len(after["records"]) == len(before["records"]) + 1 and any(record["bibliography"]["doi"] == "10.1234/fixture.note-conflicting" for record in after["records"]), "late_conflict_new_source_retained")
    ensure("DOI 不一致" in note_card.inner_text() and "论文身份冲突待核验" in note_card.inner_text(), "late_conflict_identity_disclosed")
    ensure(note_card.locator("[data-convert-result]").is_disabled(), "late_conflict_conversion_withdrawn")
    page.locator('[data-discovery-view="curated"]').click()
    ensure(note_card.count() == 0 and page.locator("#keyword-live-results-list article").count() == 0, "late_conflict_recommendation_withdrawn")
    ensure(page.locator("[data-return-all]").is_visible(), "late_conflict_recommendation_empty_action")
    page.locator('[data-discovery-view="all"]').click()
    ensure(note_card.count() == 1 and page.locator("#discovery-external-candidates article").count() == 1, "late_conflict_all_and_candidate_retained")
    ensure(network.openalex_requests == before_requests and not writes, "late_conflict_no_network_or_archive_writes")
    assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "late_conflict_after_layout")
    assert_browser_storage_privacy(page, "late_conflict_storage_privacy")
    note_card.scroll_into_view_if_needed()
    page.screenshot(path=str(screenshot_path(width, height, "broad-discovery-late-conflict.png")), full_page=True)


def assert_later_retraction_excludes_saved_result(
    page: Page, network: StrictNetwork, writes: list[str], origin: str, query: str, width: int, height: int,
) -> None:
    """A later API observation excludes an evidenced, saved result without erasing it."""
    page.goto(f"{origin}{DISCOVERY_PATH}", wait_until="networkidle")
    page.locator("#keyword-query").fill(query)
    page.locator(".discovery-query-tools > summary").filter(has_text="条件、检索组合与来源").click()
    page.locator("#discovery-query-plan").get_by_role("button", name="添加条件", exact=True).click()
    row = page.locator(".discovery-condition-row").last
    row.get_by_label("条件名称", exact=True).fill("Controlled later retraction evidence")
    row.get_by_label("术语与同义词（分号分隔）", exact=True).fill(query)
    row.locator("select").select_option("problem")
    page.locator("#discovery-expand").uncheck()
    page.locator("#keyword-start-year").fill("2022")
    page.locator("#keyword-end-year").fill("2026")
    page.locator("#keyword-language").select_option("en")
    requests_before = network.openalex_requests
    page.locator("#keyword-live-search").click()
    card = page.locator('#keyword-live-results-list [data-paper-id="W9100000018"]')
    card.wait_for(state="visible")
    card.locator("[data-review-result]").click()
    panel = page.locator("#discovery-review-panel")
    panel.locator('[data-review-field^="condition:"]').select_option("confirmed")
    panel.locator('[data-review-field="role"]').select_option("baseline")
    panel.locator('[data-review-field="locator"]').fill("Controlled fixture abstract")
    panel.locator('[data-review-field="reason"]').fill("Explicit baseline evidence before later retraction")
    panel.locator('[data-review-field="manual"]').check()
    panel.locator('[data-review-field="save"]').click()
    ensure("核验已保存" in panel.inner_text(), "later_retraction_evidence_saved")
    card.locator("[data-select-result]").click()
    read_state = workbench_state_script(DISCOVERY_WORKSPACE_STORAGE_KEY)
    before = page.evaluate(read_state)
    original = next(record for record in before["records"] if record["provider_id"] == "W9100000018")
    result = next(result for result in before["results"] if original["record_id"] in result["record_ids"])
    candidate = next(candidate for candidate in before["external_candidates"] if candidate["result_id"] == result["result_id"])
    page.locator('[data-discovery-view="curated"]').click()
    ensure(card.count() == 1, "later_retraction_initial_recommendation")
    page.locator('[data-discovery-view="all"]').click()
    page.locator("#keyword-load-more").click()
    page.wait_for_function("() => !document.querySelector('#keyword-live-search').disabled && document.querySelectorAll('#keyword-live-results-list article').length === 0")
    after = page.evaluate(read_state)
    current = next(item for item in after["results"] if item["result_id"] == result["result_id"])
    ensure(len(current["record_ids"]) == 2 and current["identity_status"] == "clear", "later_retraction_source_joins_same_identity")
    ensure(all(record in after["records"] for record in before["records"]), "later_retraction_original_records_retained")
    ensure(any(record["record_id"] in current["record_ids"] and record["retraction"]["state"] == "retracted" for record in after["records"]), "later_retraction_positive_source_saved")
    ensure(candidate in after["external_candidates"] and all(entry in after["condition_reviews"] for entry in before["condition_reviews"]) and all(entry in after["representative_reviews"] for entry in before["representative_reviews"]), "later_retraction_candidate_and_evidence_retained")
    excluded = page.locator('[data-exclusion-summary]')
    ensure("已排除 1 篇" in excluded.inner_text(), "later_retraction_exclusion_count")
    excluded.locator("summary").click()
    ensure("Synthetic Later Retraction Fixture" in excluded.inner_text() and "来源已标记撤稿" in excluded.inner_text() and "openalex" in excluded.inner_text(), "later_retraction_exclusion_provenance")
    ensure(excluded.locator('[data-select-result], [data-convert-result], article').count() == 0, "later_retraction_no_ordinary_controls")
    ensure("去重后已加载 0 篇" in page.locator("#keyword-search-status").inner_text(), "later_retraction_ordinary_count_zero")
    page.locator('[data-discovery-view="curated"]').click()
    ensure(page.locator("#keyword-live-results-list article").count() == 0, "later_retraction_recommendation_withdrawn")
    ensure(network.openalex_requests == requests_before + 2 and not writes, "later_retraction_only_explicit_reads")
    assert_workspace_layout(page, ".discovery-main", ".discovery-inspector", "later_retraction_layout")
    assert_browser_storage_privacy(page, "later_retraction_storage_privacy")
    page.screenshot(path=str(screenshot_path(width, height, "broad-discovery-later-retraction.png")), full_page=True)


def verify_workbench_viewport(
    browser: Browser,
    origin: str,
    width: int,
    height: int,
) -> None:
    reset_workbench_state(origin)
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
        assert_note_draft_import(page, origin, width, height)
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
                    verify_search_and_local_matches(browser, fixture.origin, width, height)
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
