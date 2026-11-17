"use strict";

// Run with: npm test
// Project monitors come from the shared list of projects (config/projects.json, a copy from marin-data).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors, loadProjectMonitors } = require("../build/config.js");
const { applyMonitors } = require("../build/match.js");

const shared = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "projects.json"), "utf8")).projects;
const watched = shared.filter((p) => p.mentions);
const monitors = loadMonitors();

test("every shared project with a mentions entry has a monitor in the Projects group, and no other project does", () => {
  const projectMonitors = loadProjectMonitors();
  assert.deepEqual(projectMonitors.map((m) => m.id).sort(), watched.map((p) => `project-${p.id}`).sort());
  for (const p of watched) {
    const m = projectMonitors.find((x) => x.id === `project-${p.id}`);
    assert.equal(m.name, p.name);
    assert.equal(m.group, "Projects");
    assert.deepEqual(m.include, p.mentions.include);
  }
  const unwatched = shared.filter((p) => !p.mentions).map((p) => `project-${p.id}`);
  assert.deepEqual(unwatched.filter((id) => monitors.some((m) => m.id === id)), []);
});

test("the project monitors are in the full list, and every monitor id is unique", () => {
  for (const m of loadProjectMonitors()) assert.ok(monitors.some((x) => x.id === m.id), `${m.id} is loaded`);
  assert.equal(new Set(monitors.map((m) => m.id)).size, monitors.length);
});

test("the two new projects are watched by their exact names", () => {
  const ids = monitors.filter((m) => m.group === "Projects").map((m) => m.id);
  assert.ok(ids.includes("project-west-marin-visioning"));
  assert.ok(ids.includes("project-tam-junction-placemaking"));
});

function matchedIds(text) {
  const item = { title: text, text: "", sourceMethod: "rss", matchedTerms: [], matchedMonitors: [] };
  applyMonitors(item, monitors, null);
  return item.matchedMonitors;
}

test("a story that names a project matches its monitor, in any letter case", () => {
  assert.ok(matchedIds("County holds West Marin Visioning workshop in Point Reyes Station").includes("project-west-marin-visioning"));
  assert.ok(matchedIds("WEST MARIN VISIONING survey is open").includes("project-west-marin-visioning"));
  assert.ok(matchedIds("Tam Junction Placemaking meeting set for Wednesday").includes("project-tam-junction-placemaking"));
});

test("a story about the place alone does not match a project monitor", () => {
  assert.ok(!matchedIds("Traffic backs up at Tam Junction after crash").includes("project-tam-junction-placemaking"));
  const west = matchedIds("Fog rolls into West Marin this weekend");
  assert.ok(!west.includes("project-west-marin-visioning"));
});

test("a project monitor does not take stories from other monitors", () => {
  assert.ok(matchedIds("West Marin Visioning workshop").includes("west-marin"), "the West Marin town monitor still matches too");
});
