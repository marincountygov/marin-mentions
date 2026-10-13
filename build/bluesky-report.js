"use strict";

// Shows how noisy the Bluesky results are and what config/context.yaml does to them.
//
//   npm run report:bluesky              reads ./data.json
//   node build/bluesky-report.js path/to/data.json
//
// It re-runs the monitors on the Bluesky items already in data.json, once without
// the context rules and once with them, and prints how many posts the rules remove,
// plus the monitored terms with the lowest share of posts that mention anything
// local. Use the last table to decide which terms belong in `ambiguousTerms`.
// Read-only: it never writes data.json.

const fs = require("fs");
const path = require("path");
const { loadMonitors, loadContext } = require("./config");
const { applyMonitors, buildContextRules } = require("./match");

const file = path.resolve(process.argv[2] || "data.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const monitors = loadMonitors();
const config = loadContext();
const rules = buildContextRules(config);
const bluesky = (data.items || []).filter((item) => item.sourceMethod === "bluesky" && item.sourceId === "bluesky");

function clone(item) {
  return { ...item, matchedTerms: [], matchedMonitors: [] };
}

const withoutRules = bluesky.filter((item) => applyMonitors(clone(item), monitors, null));
const keptByRules = new Set(bluesky.filter((item) => applyMonitors(clone(item), monitors, rules)).map((item) => item.id));
const removed = withoutRules.filter((item) => !keptByRules.has(item.id));

const blocked = new Set((config?.blockedAuthors || []).map((h) => h.toLowerCase()));
const byReason = { "blocked author": 0, "ambiguous term without local context": 0 };
removed.forEach((item) => {
  if (blocked.has(String(item.handle || "").toLowerCase())) byReason["blocked author"] += 1;
  else byReason["ambiguous term without local context"] += 1;
});

console.log(`File: ${file}`);
console.log(`Bluesky posts in the file: ${bluesky.length} of ${(data.items || []).length} items`);
console.log(`Match a monitor with no context rules: ${withoutRules.length}`);
console.log(`Match a monitor with the rules in config/context.yaml: ${keptByRules.size}`);
console.log(`Removed by the rules: ${removed.length} (${withoutRules.length ? Math.round((100 * removed.length) / withoutRules.length) : 0}%)`);
Object.entries(byReason).forEach(([reason, count]) => console.log(`  ${reason}: ${count}`));

// Per-term local-context share, using the same context list as the rules.
const { normalizeForMatch, hasLocalContext } = require("./match");
const groupOf = new Map(monitors.map((monitor) => [monitor.id, monitor.group]));
const ambiguousGroups = new Set(config?.ambiguousGroups || []);
const rows = new Map();
withoutRules.forEach((item) => {
  const probe = clone(item);
  applyMonitors(probe, monitors, null);
  const local = hasLocalContext(rules, normalizeForMatch([item.title, item.text].filter(Boolean).join(" ")));
  const grouped = probe.matchedMonitors.some((id) => ambiguousGroups.has(groupOf.get(id)));
  new Set(probe.matchedTerms).forEach((term) => {
    const row = rows.get(term) || { term, posts: 0, local: 0, grouped: false };
    row.posts += 1;
    if (local) row.local += 1;
    row.grouped = row.grouped || grouped;
    rows.set(term, row);
  });
});
const ambiguous = new Set((config?.ambiguousTerms || []).map((t) => normalizeForMatch(String(t).replace(/^word:/, ""))));
const list = [...rows.values()].filter((r) => r.posts >= 5).sort((a, b) => a.local / a.posts - b.local / b.posts || b.posts - a.posts).slice(0, 25);
console.log("\nTerms with the lowest share of posts that mention anything local (5+ posts):");
console.log("term".padEnd(30), "posts".padStart(6), "local".padStart(7), "  in ambiguousTerms?");
list.forEach((r) => {
  const flagged = ambiguous.has(normalizeForMatch(r.term)) ? "yes" : r.grouped ? "yes (group)" : "no  <- consider adding";
  console.log(r.term.padEnd(30), String(r.posts).padStart(6), `${Math.round((100 * r.local) / r.posts)}%`.padStart(7), " ", flagged);
});
