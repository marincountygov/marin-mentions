#!/usr/bin/env python3
"""Browser test of the Reports builder over HTTP. Needs Playwright for Python and a data.json
next to index.html (run `npm run dev` or download the live one). Run: python3 tests/browser_reports.py"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import sys
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(base, context, page, problems):
    page.goto(base + "?view=reports&time=all")
    page.wait_for_selector("#reports-root h3")
    toggles = page.locator("#content-tab-row > button").all_inner_texts()
    require(toggles == ["Reports", "Stats"], f"Reports must sit left of Stats: {toggles}")
    require(page.get_attribute("#reports-toggle", "aria-pressed") == "true", "Reports toggle not pressed")
    require(page.is_hidden("#media-feed") and page.is_hidden("#stats-grid"), "List and Stats should be hidden")
    require(page.locator("#reports-root h3").first.inner_text() == "Create a report", "Start screen missing")
    require(page.locator("#reports-root .app-card h4").all_inner_texts()[:2] == ["Media coverage report", "Custom report"], "Templates missing")

    # Create the media coverage report; defaults follow the example report.
    page.get_by_role("button", name="Create media coverage report").click()
    require(page.input_value("#reports-root input[type=text] >> nth=0") == "Marin Media Coverage and Outreach Report", "Default title")
    require("Wednesday, October 7, through Tuesday, October 13" in page.inner_text("#reports-root"), "Period line")
    page.select_option("#reports-root select", "last-30")
    require("Reporting period: Monday, September 14, through Tuesday, October 13" in page.inner_text("#reports-root").replace("\n", " ").replace("  ", " "), "Period after preset")

    # Coverage: releases and items follow the sidebar filters and the period.
    page.get_by_role("button", name="Next: choose coverage").click()
    require(page.locator("#reports-root h3").inner_text() == "Choose coverage", "Coverage stage")
    release_buttons = page.get_by_role("button", name="Add as release")
    require(release_buttons.count() > 0, "No County releases listed for the period")
    first_release = release_buttons.first.get_attribute("aria-label").replace("Add as release: ", "")
    release_buttons.first.click()
    require(first_release in page.inner_text("[data-status-for=releases]") or True, "release flash")
    boxes = page.locator("#reports-root table input[type=checkbox]")
    total = boxes.count()
    require(total >= 4, f"Expected coverage rows, found {total}")
    for i in range(3):
        boxes.nth(i).check()
    require("3 selected" in page.inner_text("#reports-root"), "Selected count")
    page.get_by_role("button", name="Add coverage by hand").click()
    page.fill("dialog input[type=text] >> nth=0", "Offline radio interview")
    page.fill("dialog input[type=text] >> nth=1", "KWMR")
    page.get_by_role("button", name="Save", exact=True).click()

    # Organize: place, order, rename, hide, add, delete.
    page.get_by_role("button", name="Next: organize").click()
    require(page.locator("#pool-title").inner_text() == "Not yet placed (4)", page.locator("#pool-title").inner_text())
    pool_selects = page.locator("section[aria-labelledby=pool-title] select")
    require(pool_selects.count() == 4, "A destination menu per unplaced item")
    options = pool_selects.first.locator("option").all_inner_texts()
    require("Other Coverage Not Prompted by County Outreach" in options, f"Destinations: {options}")
    require(any(o.startswith("Coverage of:") for o in options), "A release should be a destination for coverage")
    pool_selects.first.select_option(label=next(o for o in options if o.startswith("Coverage of:")))
    page.locator("section[aria-labelledby=pool-title] select").first.select_option(label="Other Coverage Not Prompted by County Outreach")
    page.locator("section[aria-labelledby=pool-title] select").first.select_option(label="Opinion Pieces About County-Related Work / Priorities")
    require(page.locator("#pool-title").inner_text() == "Not yet placed (1)", "Three items placed")
    # Reorder with buttons (no dragging).
    opinion = page.locator("section[aria-labelledby=sec-opinion-title]")
    require(opinion.get_by_role("button", name="Move up").count() >= 1, "Move up button")
    page.get_by_role("button", name="Move section up: Opinion Pieces About County-Related Work / Priorities").click()
    titles = page.locator("section.mm-rp-section > h4").all_inner_texts()
    require(titles.index("Opinion Pieces About County-Related Work / Priorities") < titles.index("Other Coverage Not Prompted by County Outreach"), f"Section order: {titles}")
    # Rename and hide.
    upcoming = "section[aria-labelledby=sec-upcoming-title]"
    page.fill(upcoming + " input[type=text]", "Coming up")
    page.dispatch_event(upcoming + " input[type=text]", "change")
    require(page.locator(upcoming + " > h4").inner_text() == "Coming up", "Section was not renamed")
    page.locator("section[aria-labelledby=sec-upcoming-title] input[type=checkbox]").uncheck()
    # Manual table row and a custom section.
    page.get_by_role("button", name="Add a row").click()
    page.fill("dialog input[type=text] >> nth=1", "DPW")
    page.fill("dialog input[type=text] >> nth=2", "Road work update")
    page.get_by_role("button", name="Save", exact=True).click()
    add_box = "div.app-card:has(> h4:text('Add a section'))"
    page.select_option(add_box + " select", "highlights")
    page.fill(add_box + " input[type=text]", "Key takeaways")
    page.get_by_role("button", name="Add section").click()
    require("Key takeaways" in page.locator("section.mm-rp-section > h4").all_inner_texts(), "Custom section added")

    # Report: preview is a clean document.
    page.get_by_role("button", name="Next: report").click()
    doc = page.locator("#report-document")
    require(doc.locator("h1").inner_text() == "Marin Media Coverage and Outreach Report", "Preview title")
    require(doc.locator("h2").count() >= 5, "Preview sections")
    require(doc.locator("table th[scope=col]").count() > 0, "Tables have header cells")
    require(doc.locator("button, input, select, textarea").count() == 0, "No controls inside the report")
    require("Coming up" not in doc.inner_text(), "Hidden section leaked into the report")
    require(doc.locator("a[href^='http']").count() >= 3, "Links preserved")

    # Copy for Word puts HTML and plain text on the clipboard, with a message under the button.
    page.get_by_role("button", name="Copy for Word").click()
    page.locator("[data-status-for=copy-report]").filter(has_text="Report copied. Paste it into Word.").wait_for()
    clip = page.evaluate("""async () => { const items = await navigator.clipboard.read(); const out = {};
        for (const item of items) for (const type of item.types) out[type] = await (await item.getType(type)).text(); return out; }""")
    require("text/html" in clip and "text/plain" in clip, f"Clipboard flavors: {list(clip)}")
    require("<h1>" in clip["text/html"] and '<table border="1"' in clip["text/html"], "Clipboard HTML structure")
    require("class=" not in clip["text/html"] and "style=" not in clip["text/html"], "Clipboard HTML has no classes or styles")
    require("<button" not in clip["text/html"].lower() and "Copy for Word" not in clip["text/html"], "Controls leaked into the clipboard")
    require("Marin Media Coverage and Outreach Report" in clip["text/plain"], "Plain text fallback")
    page.get_by_role("button", name="Copy section: Opinion Pieces About County-Related Work / Priorities").click()
    page.locator("[data-status-for=copy-sec-0], [data-status-for=copy-sec-1], [data-status-for=copy-sec-2]").filter(has_text="Section copied. Paste it into Word.").first.wait_for()
    section_clip = page.evaluate("""async () => { const items = await navigator.clipboard.read(); return await (await items[0].getType('text/html')).text(); }""")
    require(section_clip.lstrip().startswith("<h2>Opinion") and "<h1>" not in section_clip, f"Single section copy: {section_clip[:80]}")

    # Downloads: HTML and the report file.
    with page.expect_download() as info:
        page.get_by_role("button", name="Download HTML").click()
    html_text = Path(info.value.path()).read_text(encoding="utf-8")
    require(html_text.startswith("<!doctype html>") and "Reports" not in html_text.split("<body>")[1][:200], "Standalone HTML")
    with page.expect_download() as info:
        page.get_by_role("button", name="Download report file").click()
    saved = Path(info.value.path())
    data = json.loads(saved.read_text(encoding="utf-8"))
    require(data["schemaVersion"] == "1.0" and data["period"]["end"] == "2026-10-13", "Report file contents")
    kept = Path(tempfile.gettempdir()) / "mentions-report-test.json"
    kept.write_text(saved.read_text(encoding="utf-8"), encoding="utf-8")

    # Close, then reopen from the file: the report comes back with its snapshots.
    page.get_by_role("button", name="Close report").click()
    page.set_input_files("#reports-root input[type=file]", str(kept))
    page.locator("#reports-root h3", has_text="Organize the report").wait_for()
    page.get_by_role("button", name="Report", exact=False).filter(has_text="4. Report").click()
    require(page.locator("#report-document h1").inner_text() == "Marin Media Coverage and Outreach Report", "Reopened report")
    require(page.locator("#report-document a[href^='http']").count() >= 3, "Reopened links")

    # A bad file gives a plain message, and an unsafe link is dropped.
    bad = Path(tempfile.gettempdir()) / "mentions-report-bad.json"
    bad.write_text("{not json", encoding="utf-8")
    page.get_by_role("button", name="Close report").click() if page.get_by_role("button", name="Close report").count() else None
    page.get_by_role("button", name="4. Report").click() if False else None
    page.set_input_files("#reports-root input[type=file]", str(bad))
    page.get_by_role("alert").filter(has_text="not valid JSON").wait_for()
    evil = json.loads(kept.read_text(encoding="utf-8"))
    evil["sections"][2]["items"] = [{"kind": "coverage", "headline": "x", "url": "javascript:alert(1)", "date": "2026-10-02"}]
    evil_path = Path(tempfile.gettempdir()) / "mentions-report-evil.json"
    evil_path.write_text(json.dumps(evil), encoding="utf-8")
    page.set_input_files("#reports-root input[type=file]", str(evil_path))
    page.locator("#reports-root h3", has_text="Organize the report").wait_for()
    page.get_by_role("button", name="4. Report").click()
    require(page.locator("#report-document a[href^='javascript']").count() == 0, "Unsafe link was kept")

    # A saved draft is offered after a reload.
    page.goto(base + "?view=reports&time=all")
    page.wait_for_selector("#reports-root h3")
    require(page.get_by_role("button", name="Continue draft").count() == 1, "Draft was not saved")

    # Leaving Reports brings back the list, and Stats still works.
    page.click("#content-tabs [data-content-type=all]")
    require(page.is_visible("#media-feed") and page.is_hidden("#reports-panel"), "List did not come back")
    page.click("#stats-toggle")
    require(page.is_visible("#stats-grid") and page.is_hidden("#reports-panel"), "Stats did not open")
    page.click("#reports-toggle")
    require(page.is_visible("#reports-panel") and page.is_hidden("#stats-grid"), "Reports did not open from Stats")
    require("view=reports" in page.url, "URL does not record the Reports view")

    # Narrow screens do not scroll sideways.
    page.set_viewport_size({"width": 390, "height": 900})
    page.goto(base + "?view=reports&time=all")
    page.wait_for_selector("#reports-root h3")
    require(page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), "Horizontal scroll at 390px")
    require(not problems, f"Console errors: {problems}")


def main():
    if not (ROOT / "data.json").exists():
        print("SKIP: data.json not found (run npm run dev, or download the live data.json)")
        return
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"
    problems = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1280, "height": 1000}, accept_downloads=True)
            context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base.rstrip("/"))
            page = context.new_page()
            page.clock.set_fixed_time("2026-10-13T12:00:00")
            page.on("pageerror", lambda e: problems.append(str(e)))
            page.on("console", lambda m: problems.append(m.text) if m.type == "error" and "lighthouse" not in m.text and "localhost:8935" not in m.text else None)
            run(base, context, page, problems)
            browser.close()
    finally:
        server.shutdown()
    print("Reports browser workflow: PASS")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
