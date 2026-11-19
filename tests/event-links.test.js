"use strict";

// Run with: npm test
// Which event a monitor is about comes from marin-data (config/events.json, a copy).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors } = require("../build/config.js");

const links = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "events.json"), "utf8"));
const monitors = loadMonitors();
const linked = new Set(links.events.map((e) => e.monitorId));

test("every Events monitor is linked to an event in marin-data", () => {
  const unlinked = monitors.filter((m) => m.group === "Events" && !linked.has(m.id)).map((m) => m.id);
  assert.deepEqual(unlinked, [], `add an event in marin-data: ${unlinked}`);
});

test("every event link names a monitor that exists, in the Events group", () => {
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const bad = [...linked].filter((id) => !byId.has(id) || byId.get(id).group !== "Events");
  assert.deepEqual(bad, [], `in marin-data but missing or in another group: ${bad}`);
});
