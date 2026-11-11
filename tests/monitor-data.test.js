"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildMonitorData, cardTitle, pacificDate, MAX_ITEMS } = require("../build/monitor-data.js");

const item = (n, over) => ({
  id: `i${n}`, title: `Story ${n}`, text: "", source: "Marin IJ", sourceType: "news", url: `https://example.com/${n}`,
  publishedAt: `2026-10-${String(n).padStart(2, "0")}T17:00:00.000Z`, matchedMonitors: ["marin-fire"], ...over,
});

function run(items, monitors = [{ id: "marin-fire", name: "Fire" }, { id: "marin-parks", name: "Parks" }]) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "monitors-"));
  const results = buildMonitorData({ items, monitors, generatedAt: "2026-11-03T00:00:00.000Z", outDir });
  return { outDir, results, read: (id) => JSON.parse(fs.readFileSync(path.join(outDir, `${id}.json`), "utf8")) };
}

test("one file per monitor, newest first, only that monitor's items", () => {
  const { read, results } = run([item(1), item(3), item(2, { matchedMonitors: ["marin-parks"] })]);
  assert.equal(results.length, 2);
  assert.deepEqual(read("marin-fire").items.map((i) => i.id), ["i3", "i1"]);
  assert.deepEqual(read("marin-parks").items.map((i) => i.id), ["i2"]);
  assert.equal(read("marin-fire").monitor.name, "Fire");
});

test("a monitor with no mentions still gets a file", () => {
  const { read } = run([item(1)]);
  assert.deepEqual(read("marin-parks").items, []);
  assert.equal(read("marin-parks").total, 0);
});

test("a file keeps the newest items and says how many matched", () => {
  const many = Array.from({ length: MAX_ITEMS + 5 }, (_, n) => item(n + 1, { publishedAt: `2026-09-${String((n % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));
  const file = run(many).read("marin-fire");
  assert.equal(file.items.length, MAX_ITEMS);
  assert.equal(file.total, MAX_ITEMS + 5);
});

test("a post with no title uses its text, shortened; the date is Pacific", () => {
  assert.equal(cardTitle({ title: "", text: "word ".repeat(100) }).endsWith("…"), true);
  assert.equal(cardTitle({ title: "", text: "Short post" }), "Short post");
  assert.equal(pacificDate("2026-11-03T03:30:00.000Z"), "2026-11-02");
});
