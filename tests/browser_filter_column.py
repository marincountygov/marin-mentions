#!/usr/bin/env python3
"""Browser test of Marin Mentions' filter columns, drawn by the shell from filters.json and filters-sources.json.
It serves tests/fixtures/data.json as /data.json, so it needs no live data and no network. Needs Playwright for Python.
For the axe-core scan, set AXE_CORE to axe.min.js (otherwise it is skipped and says so).
Run: python3 tests/browser_filter_column.py"""
from __future__ import annotations

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "data.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
AXE = os.environ.get("AXE_CORE")
PANEL = "#latest-filter-panel"
MONITORS = {m["id"]: m for m in DATA["monitors"]}
# A division listed under its department, and two busy subjects for the legacy comma link.
KID = next(m for m in DATA["monitors"] if m.get("parent") in MONITORS and MONITORS[m["parent"]].get("facet") == m.get("facet"))
BUSY = ["marin-district-4", "marin-county"]


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split("?", 1)[0] == "/data.json":
            return str(FIXTURE)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def count(page):
    return page.locator("#media-feed > li[data-item-id], #media-feed > li.app-card").count()


def load(page, base, query="?time=all"):
    page.goto(base + query)
    page.wait_for_selector(f"{PANEL} #monitor-facet details", state="attached")
    page.wait_for_function("document.querySelectorAll('#media-feed > li').length > 0")


def run(base, page, scheme):
    load(page, base)
    page.evaluate("localStorage.clear()")
    load(page, base)

    # Every group shows its name, the column has the shell's words, and nothing is hand-written in the page.
    legends = page.eval_on_selector_all(f"{PANEL} legend", "els => els.map(e => e.textContent)")
    require(legends == ["Time ranges", "Subjects", "Sources"], f"Every group shows its name: {legends}")
    require(page.evaluate(f"[...document.querySelectorAll('{PANEL} legend')].every(e => e.getBoundingClientRect().width > 0 && !e.closest('.visually-hidden'))"), "No group name is hidden")
    require(page.inner_text(f"{PANEL}-title") == "Filter" and page.inner_text(f"{PANEL} .search-input-field label") == "Search", "Title and search label")
    require(page.evaluate(f"document.querySelectorAll('{PANEL} [placeholder]').length") == 0, "No placeholders")

    # A facet shows its total; a facet with several groups nests them; a division sits under its department.
    facets = page.eval_on_selector_all("#monitor-facet > div > details > summary", "els => els.map(e => e.textContent.replace(/\\s+/g, ' ').trim())")
    require(any(f.startswith("Place (") for f in facets) and any(f.startswith("Organization (") for f in facets), f"Facets show totals: {facets}")
    require(page.locator(f"#monitor-facet > div > details:has(> summary:text-matches('^Place')) > div > details").count() >= 2, "A facet with several groups nests them")
    page.evaluate("document.querySelectorAll('#monitor-facet details').forEach((d) => { d.open = true; })")
    nested = page.evaluate(f"(() => {{ const i = document.querySelector('#monitor-facet input[value=\"{KID['id']}\"]'); const li = i.closest('li'); return li.parentElement.closest('li')?.querySelector(':scope > label input')?.value; }})()")
    require(nested == KID["parent"], f"A division is listed under its department: {nested!r} vs {KID['parent']!r}")

    # Choosing a subject filters the list, and the address and the active count follow.
    total = count(page)
    page.check(f"#monitor-facet input[value='{BUSY[0]}']")
    page.wait_for_function(f"document.querySelectorAll('#media-feed > li').length < {total}")
    require(f"monitors={BUSY[0]}" in page.url, f"The choice reaches the address: {page.url}")
    require(page.get_attribute(f"{PANEL}-toggle", "aria-label") == "Filter, 2 active", page.get_attribute(f"{PANEL}-toggle", "aria-label"))
    # The app's own address parts are kept beside the column's.
    page.click("#stats-toggle")
    require("view=stats" in page.url and f"monitors={BUSY[0]}" in page.url and "time=all" in page.url, f"The app and the column share the address: {page.url}")
    page.click("#stats-toggle")

    # Reset: choices cleared, the tab back on All, the address clean, "(N selected)" gone.
    page.click('[data-content-type="news"]')
    page.click(f"{PANEL} .search-panel-header .action-button")
    page.wait_for_function("document.querySelector('[data-content-type=all]').getAttribute('aria-selected') === 'true'")
    require("monitors=" not in page.url and "type=" not in page.url and "view=" not in page.url, f"Reset clears the address: {page.url}")
    require(page.locator("#monitor-facet input:checked").count() == 0 and "selected" not in page.inner_text("#monitor-facet"), "Reset clears the choices and the selected counts")
    page.wait_for_function("document.querySelector('#app-status-message').textContent.includes('Filters reset.')")

    # A link written before the move (choices joined with commas) still works.
    load(page, base, f"?time=all&monitors={','.join(BUSY)}")
    require(page.locator("#monitor-facet input:checked").count() == 2, "A comma-joined link selects both subjects")
    require(page.evaluate("document.querySelector('#monitor-facet input:checked').closest('details').open"), "A group holding a choice starts open")

    # Sources: groups by content type; a switched-off source is still listed and reachable.
    sources = page.eval_on_selector_all("#source-facet > div > details > summary", "els => els.map(e => e.textContent.replace(/\\s+/g, ' ').trim())")
    require(sources and sources[0].startswith("News ("), f"Sources are grouped by content type with totals: {sources}")
    page.evaluate("document.querySelectorAll('#source-facet details').forEach((d) => { d.open = true; })")
    page.check("#source-facet input >> nth=0")
    require("sources=" in page.url, f"A source choice reaches the address: {page.url}")

    # The Reports view has its own dates, so the Time choice is dimmed and reads "Report dates"; neither is a filter.
    load(page, base, "?view=reports&time=all")
    page.wait_for_function(f"document.getElementById('latest-filter-panel-time').value === 'report'")
    require(page.evaluate("document.getElementById('time-facet').disabled"), "Time is dimmed while a report is open")
    require("time=report" not in page.url, f"'Report dates' is not written to the address: {page.url}")
    page.click('[data-content-type="all"]')
    page.wait_for_function("document.getElementById('latest-filter-panel-time').value === 'all'")
    require(not page.evaluate("document.getElementById('time-facet').disabled"), "Time comes back when the report closes")

    # The Sources page has its own column, with no search and nothing written to the address.
    page.goto(base + "?time=all#sources")
    page.wait_for_selector("#sources-filter-panel #admin-source-facet", state="attached")
    require(page.locator("#sources-filter-panel .search-input-field").count() == 0, "The Sources page filter has no search box")
    require(page.inner_text("#sources-filter-panel legend") == "Sources", "Its group shows its name")
    rows_before = page.locator("#sources-table-wrap tbody tr").count()
    page.evaluate("document.querySelectorAll('#admin-source-facet details').forEach((d) => { d.open = true; })")
    page.check("#admin-source-facet input >> nth=0")
    require(page.locator("#sources-table-wrap tbody tr").count() < rows_before, "A source choice filters the table")
    require("admin-source" not in page.url, f"Nothing from the Sources page reaches the address: {page.url}")

    # Accessibility scan (light and dark), with the groups open.
    if AXE:
        load(page, base)
        page.evaluate("document.querySelectorAll('#latest-filter-panel details').forEach((d) => { d.open = true; })")
        page.add_script_tag(path=AXE)
        result = page.evaluate("axe.run(document.querySelector('#latest-filter-panel'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })")
        found = [f"{v['id']}: {v['help']} ({', '.join(n['target'][0] for n in v['nodes'][:2])})" for v in result["violations"]]
        require(not found, f"axe-core ({scheme}): {found}")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"
    problems = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for scheme in ("light", "dark"):
                context = browser.new_context(color_scheme=scheme, viewport={"width": 1200, "height": 900})
                page = context.new_page()
                page.on("pageerror", lambda e: problems.append(str(e)))
                page.on("console", lambda m: problems.append(m.text) if m.type == "error" else None)
                run(base, page, scheme)
                context.close()
            browser.close()
    finally:
        server.shutdown()
    require(not problems, f"Console or page errors: {problems}")
    print("Marin Mentions filter column browser test (light and dark): PASS" + ("" if AXE else " (axe-core scan skipped)"))


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
