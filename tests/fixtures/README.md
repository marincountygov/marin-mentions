# Test data

`data.json` is a slice of the published `data.json` (https://marincountygov.github.io/marin-mentions/data.json), taken on 2026-11-17: every monitor and source, and the items published from 2026-10-02 to 2026-10-14. It is public data.

The browser tests (`tests/browser_filters.py` and `tests/browser_reports.py`) serve it as `/data.json`, so they do not depend on the live data, a local `data.json`, or the network. The Reports test fixes its clock to 2026-10-13, which falls inside this slice. If the monitors change, take a new slice the same way and run the browser tests.
