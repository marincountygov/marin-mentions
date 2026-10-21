#!/usr/bin/env python3
"""Browser test of the collapsible filter panels over HTTP. Needs Playwright for Python and a data.json
next to index.html (run `npm run dev` or download the live one). Run: python3 tests/browser_filters.py"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LOOK = "el => { const c = getComputedStyle(el); return [c.borderTopWidth, c.borderTopColor, c.borderRadius]; }"


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def mentions(page):
    return page.locator("#media-feed > li").count()


def run(base, page):
    page.goto(base)
    page.evaluate("localStorage.clear()")
    page.goto(base + "?time=all")
    page.wait_for_selector("#media-feed > li")
    # Icon only, first in the column, white, and open on wide screens.
    require(page.inner_text("#filter-toggle").strip() == "", "The Filters button shows an icon and no text")
    require(page.get_attribute("#filter-toggle", "aria-label") == "Filters, 1 active", page.get_attribute("#filter-toggle", "aria-label"))  # the time range is not the default
    require(page.evaluate("document.querySelector('#filters .search-side').firstElementChild.id") == "filter-toggle", "The button is first in the filter column")
    require(page.is_visible("#filter-panel") and page.get_attribute("#filter-toggle", "aria-expanded") == "true", "Filters start open on wide screens")
    require(page.is_visible("#filter-toggle [data-filter-icon=open]") and not page.is_visible("#filter-toggle [data-filter-icon=closed]"), "Open filters show the panel-right-open icon")
    require(abs(page.evaluate("document.getElementById('filter-toggle').getBoundingClientRect().right - document.getElementById('filter-panel').getBoundingClientRect().right")) < 1,
            "Open, the button sits at the right edge of the filter column")
    require(page.locator("#filter-toggle").evaluate(LOOK) == page.locator("#media-feed .action-group").first.evaluate(LOOK),
            "Same border and radius as the card button group")

    # An active filter is counted in the name, and hiding the panel keeps it applied.
    page.fill("#filter-search", "marin")
    page.wait_for_timeout(600)
    require(page.get_attribute("#filter-toggle", "aria-label") == "Filters, 2 active", page.get_attribute("#filter-toggle", "aria-label"))
    shown, summary, width_open = mentions(page), page.inner_text("#active-filters"), page.evaluate("document.querySelector('#filters .search-results').offsetWidth")
    page.focus("#filter-toggle")
    page.keyboard.press("Enter")
    require(not page.is_visible("#filter-panel") and page.get_attribute("#filter-toggle", "aria-expanded") == "false", "Enter hides the filters")
    require(page.is_visible("#filter-toggle") and page.evaluate("document.activeElement.id") == "filter-toggle", "The button stays and keeps focus")
    require(page.is_visible("#filter-toggle [data-filter-icon=closed]") and not page.is_visible("#filter-toggle [data-filter-icon=open]"), "Hidden filters show the panel-left-open icon")
    require(page.evaluate("document.getElementById('filter-toggle').getBoundingClientRect().left") < 40, "Hidden, the button sits at the left edge")
    require(mentions(page) == shown and page.inner_text("#active-filters") == summary, "Hiding the filters does not change what is shown")
    require(page.evaluate("document.querySelector('#filters .search-results').offsetWidth") > width_open, "The results use the freed width")
    page.reload()
    page.wait_for_selector("#media-feed > li")
    require(not page.is_visible("#filter-panel"), "The collapsed choice is remembered")
    page.click("#filter-toggle")
    require(page.is_visible("#filter-panel"), "The button opens the panel again")

    # Stats still draws and resizes with the panel.
    page.click("#stats-toggle")
    page.wait_for_selector("#stats-grid canvas")
    page.click("#filter-toggle")
    page.wait_for_timeout(300)
    require(page.locator("#stats-grid canvas").first.evaluate("c => c.getBoundingClientRect().width") > 100, "Charts keep their size when the panel is hidden")
    page.click("#filter-toggle")
    page.click("#stats-toggle")

    # Sources has its own panel and its own remembered choice.
    page.goto(base + "#sources")
    page.wait_for_selector("#source-filter-toggle")
    require(page.is_visible("#source-filter-panel"), "The Sources filter starts open")
    page.click("#source-filter-toggle")
    require(not page.is_visible("#source-filter-panel") and page.is_visible("#source-filter-toggle"), "The Sources filter hides")
    page.goto(base)
    page.wait_for_selector("#media-feed > li")
    require(page.is_visible("#filter-panel"), "Hiding the Sources filter does not hide the Latest filter")

    # Narrow screens: the button stays, the panel starts closed, and nothing overflows.
    page.evaluate("localStorage.clear()")
    page.set_viewport_size({"width": 360, "height": 740})
    page.goto(base)
    page.wait_for_selector("#media-feed > li")
    require(page.is_visible("#filter-toggle") and not page.is_visible("#filter-panel"), "Narrow screens start with the filters closed")
    require(page.evaluate("document.getElementById('filter-toggle').getBoundingClientRect().left") < 40, "Narrow, the button is at the left")
    page.click("#filter-toggle")
    require(page.is_visible("#filter-panel") and page.evaluate("document.getElementById('filter-toggle').getBoundingClientRect().bottom <= document.getElementById('filter-panel').getBoundingClientRect().top"),
            "The narrow button opens the filters below itself")
    require(not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "No horizontal scroll at 360 px")
    page.set_viewport_size({"width": 1280, "height": 1000})
    page.wait_for_timeout(200)
    require(page.is_visible("#filter-panel"), "Wide screens go back to the remembered choice")
    page.evaluate("localStorage.clear()")


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
            for scheme in ("light", "dark"):
                context = browser.new_context(color_scheme=scheme, viewport={"width": 1280, "height": 1000})
                page = context.new_page()
                page.on("pageerror", lambda e: problems.append(str(e)))
                page.on("console", lambda m: problems.append(m.text) if m.type == "error" and "lighthouse" not in m.text and "localhost:8935" not in m.text else None)
                run(base, page)
                context.close()
            browser.close()
    finally:
        server.shutdown()
    require(not problems, f"Console or page errors: {problems}")
    print("Filter panels browser workflow (light and dark): PASS")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
