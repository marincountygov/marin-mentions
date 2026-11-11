"use strict";

// Writes one small JSON file per monitor (monitors/<id>.json) from the same
// matched/deduped/pruned item list that becomes data.json.
//
// This exists so another site, such as a Marin Docs page for one County
// department, can show that monitor's recent mentions without downloading all
// of data.json. The files are static and read-only, like the RSS feeds, and
// carry only what a list of cards needs.
//
// Run on its own against an existing data.json:
//   node build/monitor-data.js [data.json] [outDir]

const fs = require("fs");
const path = require("path");

const MAX_ITEMS = 50;
const TITLE_LENGTH = 140;

// YYYY-MM-DD in Pacific time, the way the console dates things.
function pacificDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function cardTitle(item) {
  const title = (item.title || item.text || item.source || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : title;
}

function buildMonitorData({ items, monitors, generatedAt, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const monitor of monitors) {
    const matched = items
      .filter((item) => (item.matchedMonitors || []).includes(monitor.id))
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const file = {
      generatedAt,
      monitor: { id: monitor.id, name: monitor.name },
      total: matched.length,
      items: matched.slice(0, MAX_ITEMS).map((item) => ({
        id: item.id,
        title: cardTitle(item),
        source: item.source || "",
        sourceType: item.sourceType || "",
        url: item.url || "",
        publishedAt: item.publishedAt,
        date: pacificDate(item.publishedAt),
      })),
    };
    fs.writeFileSync(path.join(outDir, `${monitor.id}.json`), JSON.stringify(file));
    results.push({ id: monitor.id, count: file.items.length });
  }
  return results;
}

module.exports = { buildMonitorData, cardTitle, pacificDate, MAX_ITEMS };

if (require.main === module) {
  const input = process.argv[2] || path.join(__dirname, "..", "data.json");
  const outDir = process.argv[3] || path.join(path.dirname(input), "monitors");
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const results = buildMonitorData({ items: data.items, monitors: data.monitors, generatedAt: data.generatedAt, outDir });
  console.log(`Wrote ${results.length} monitor files to ${outDir}`);
}
