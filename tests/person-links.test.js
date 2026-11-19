"use strict";

// Run with: npm test
// Which person a monitor is about comes from marin-data (config/people.json, a copy).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors, loadPeople } = require("../build/config.js");

const links = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "people.json"), "utf8"));
const monitors = loadMonitors();
const byId = new Map(monitors.map((m) => [m.id, m]));

test("every person link names a monitor that exists, in the People group", () => {
  const bad = links.people.filter((p) => !byId.has(p.monitorId) || byId.get(p.monitorId).group !== "People").map((p) => p.monitorId);
  assert.deepEqual(bad, [], `in marin-data but missing or in another group: ${bad}`);
});

test("loadPeople gives the seat and district of each linked person", () => {
  const people = loadPeople();
  assert.equal(people.size, links.people.length);
  assert.deepEqual(people.get("dennis-rodoni"), { role: "Supervisor", district: "District 4" });
});

test("the five supervisors each carry a different district", () => {
  const districts = [...loadPeople().values()].map((p) => p.district).filter(Boolean).sort();
  assert.deepEqual(districts, ["District 1", "District 2", "District 3", "District 4", "District 5"]);
});
