#!/usr/bin/env python3
"""Browser test of the collapsible filter panels over HTTP. Needs Playwright for Python. It serves tests/fixtures/data.json
as /data.json, so it needs no live data and no network. Run: python3 tests/browser_filters.py"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "data.json"  # served as /data.json
LOOK = "el => { const c = getComputedStyle(el); return [c.borderTopWidth, c.borderTopColor, c.borderRadius]; }"


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


def mentions(page):
    return page.locator("#media-feed > li").count()


def run(base, page):
    page.goto(base)
    page.evaluate("localStorage.clear()")
    page.goto(base + "?time=all")
    page.wait_for_selector("#media-feed > li")
    # Icon only, first in the column, white, and open on wide screens.
    require(page.inner_text("#latest-filter-panel-toggle").strip() == "", "The Filters button shows an icon and no text")
    require(page.get_attribute("#latest-filter-panel-toggle", "aria-label") == "Filter, 1 active", page.get_attribute("#latest-filter-panel-toggle", "aria-label"))  # the time range is not the default
    require(page.evaluate("document.querySelector('#filters .search-side').firstElementChild.id") == "latest-filter-panel-toggle", "The button is first in the filter column")
    require(page.is_visible("#latest-filter-panel") and page.get_attribute("#latest-filter-panel-toggle", "aria-expanded") == "true", "Filters start open on wide screens")
    require(page.is_visible("#latest-filter-panel-toggle [data-filter-icon=open]") and not page.is_visible("#latest-filter-panel-toggle [data-filter-icon=closed]"), "Open filters show the panel-right-open icon")
    require(abs(page.evaluate("document.getElementById('latest-filter-panel-toggle').getBoundingClientRect().right - document.getElementById('latest-filter-panel').getBoundingClientRect().right")) < 1,
            "Open, the button sits at the right edge of the filter column")
    require(page.locator("#latest-filter-panel-toggle").evaluate(LOOK) == page.locator("#media-feed .action-group").first.evaluate(LOOK),
            "Same border and radius as the card button group")

    # An active filter is counted in the name, and hiding the panel keeps it applied.
    page.fill("#filter-search", "marin")
    page.wait_for_timeout(600)
    require(page.get_attribute("#latest-filter-panel-toggle", "aria-label") == "Filter, 2 active", page.get_attribute("#latest-filter-panel-toggle", "aria-label"))
    shown, summary, width_open = mentions(page), page.inner_text("#active-filters"), page.evaluate("document.querySelector('#filters .search-results').offsetWidth")
    page.focus("#latest-filter-panel-toggle")
    page.keyboard.press("Enter")
    require(not page.is_visible("#latest-filter-panel") and page.get_attribute("#latest-filter-panel-toggle", "aria-expanded") == "false", "Enter hides the filters")
    require(page.is_visible("#latest-filter-panel-toggle") and page.evaluate("document.activeElement.id") == "latest-filter-panel-toggle", "The button stays and keeps focus")
    require(page.is_visible("#latest-filter-panel-toggle [data-filter-icon=closed]") and not page.is_visible("#latest-filter-panel-toggle [data-filter-icon=open]"), "Hidden filters show the panel-left-open icon")
    require(page.evaluate("document.getElementById('latest-filter-panel-toggle').getBoundingClientRect().left") < 40, "Hidden, the button sits at the left edge")
    require(mentions(page) == shown and page.inner_text("#active-filters") == summary, "Hiding the filters does not change what is shown")
    require(page.evaluate("document.querySelector('#filters .search-results').offsetWidth") > width_open, "The results use the freed width")
    page.reload()
    page.wait_for_selector("#media-feed > li")
    require(not page.is_visible("#latest-filter-panel"), "The collapsed choice is remembered")
    page.click("#latest-filter-panel-toggle")
    require(page.is_visible("#latest-filter-panel"), "The button opens the panel again")

    # Stats still draws and resizes with the panel.
    page.click("#stats-toggle")
    page.wait_for_selector("#stats-grid canvas")
    page.click("#latest-filter-panel-toggle")
    page.wait_for_timeout(300)
    require(page.locator("#stats-grid canvas").first.evaluate("c => c.getBoundingClientRect().width") > 100, "Charts keep their size when the panel is hidden")
    page.click("#latest-filter-panel-toggle")
    page.click("#stats-toggle")

    # Sources has its own panel and its own remembered choice.
    page.goto(base + "#sources")
    page.wait_for_selector("#sources-filter-panel-toggle")
    require(page.is_visible("#sources-filter-panel"), "The Sources filter starts open")
    page.click("#sources-filter-panel-toggle")
    require(not page.is_visible("#sources-filter-panel") and page.is_visible("#sources-filter-panel-toggle"), "The Sources filter hides")
    page.goto(base)
    page.wait_for_selector("#media-feed > li")
    require(page.is_visible("#latest-filter-panel"), "Hiding the Sources filter does not hide the Latest filter")

    # Narrow screens: the button stays, the panel starts closed, and nothing overflows.
    page.evaluate("localStorage.clear()")
    page.set_viewport_size({"width": 360, "height": 740})
    page.goto(base)
    page.wait_for_selector("#media-feed > li")
    require(page.is_visible("#latest-filter-panel-toggle") and not page.is_visible("#latest-filter-panel"), "Narrow screens start with the filters closed")
    require(page.evaluate("document.getElementById('latest-filter-panel-toggle').getBoundingClientRect().left") < 40, "Narrow, the button is at the left")
    page.click("#latest-filter-panel-toggle")
    require(page.is_visible("#latest-filter-panel") and page.evaluate("document.getElementById('latest-filter-panel-toggle').getBoundingClientRect().bottom <= document.getElementById('latest-filter-panel').getBoundingClientRect().top"),
            "The narrow button opens the filters below itself")
    require(not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "No horizontal scroll at 360 px")
    page.set_viewport_size({"width": 1280, "height": 1000})
    page.wait_for_timeout(200)
    require(page.is_visible("#latest-filter-panel"), "Wide screens go back to the remembered choice")
    page.evaluate("localStorage.clear()")

    # Copy and Download use the shell's helpers: the copied digest is clean HTML (no page styles), and the CSV starts with a
    # byte-order mark so Excel reads accents and apostrophes.
    page.goto(base + "?time=all")
    page.wait_for_selector("#media-feed > li")
    page.click("#copy-email-menu .menu-toggle")
    page.click("#copy-email-menu [data-copy-digest='text']")
    page.wait_for_function("/Copied/.test(document.querySelector('#app-status-message')?.textContent || '')")
    html = page.evaluate("""async () => { const [item] = await navigator.clipboard.read(); return await (await item.getType('text/html')).text(); }""")
    require("style=" not in html, f"The copied digest carries no page styles: {html[:200]}")
    for choice, marker in (("html", "<"), ("markdown", "](")):
        page.evaluate("document.querySelector('#app-status-message').textContent = ''")
        page.click("#copy-email-menu .menu-toggle")
        page.click(f"#copy-email-menu [data-copy-digest='{choice}']")
        page.wait_for_function("/Copied/.test(document.querySelector('#app-status-message')?.textContent || '')")
        copied = page.evaluate("navigator.clipboard.readText()")
        require(marker in copied, f"Copy as {choice} puts {choice} on the clipboard: {copied[:200]}")
    require(not page.evaluate("[...document.querySelectorAll('#copy-email-menu [data-copy-digest]')].some(b => b.closest('.menu-panel').hidden === false)"), "The Copy menu closes after a choice")
    with page.expect_download() as info:
        page.click("#download-data-button")
    require(Path(info.value.path()).read_bytes().startswith(b"\xef\xbb\xbf"), "The CSV download starts with a byte-order mark")


def main():
    require(FIXTURE.exists(), f"Missing {FIXTURE.relative_to(ROOT)}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"
    problems = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for scheme in ("light", "dark"):
                context = browser.new_context(color_scheme=scheme, viewport={"width": 1280, "height": 1000}, accept_downloads=True)
                context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base.rstrip("/"))
                page = context.new_page()
                page.route(lambda url: not url.startswith(base), lambda route: route.fulfill(status=200, content_type="image/png", body=b""))  # no network
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
