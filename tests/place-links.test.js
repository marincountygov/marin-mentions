"use strict";

// Run with: npm test
// Which place a monitor is about comes from marin-data (config/places.json, a copy).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors, loadPlaces } = require("../build/config.js");

const links = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "places.json"), "utf8"));
const monitors = loadMonitors();
const ids = new Set(monitors.map((m) => m.id));
const linked = new Set(links.places.map((p) => p.monitorId));
const facilities = new Set(links.facilities.map((f) => f.monitorId));
const notPlaces = new Set(links.notPlaces.map((p) => p.monitorId));
const PLACE_GROUPS = new Set(["Districts", "Cities and towns", "Communities"]);

test("every place link names a monitor that exists", () => {
  const missing = [...linked].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `in marin-data but not in monitors.yaml: ${missing}`);
});

test("every monitor listed as not a place exists", () => {
  const missing = [...notPlaces].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `listed in marin-data but not in monitors.yaml: ${missing}`);
});

test("every Districts, Cities and towns and Communities monitor is linked to a place or listed as not one", () => {
  const loose = monitors.filter((m) => PLACE_GROUPS.has(m.group) && !linked.has(m.id) && !notPlaces.has(m.id)).map((m) => m.id);
  assert.deepEqual(loose, [], `add a jurisdiction in marin-data, or list as not a place: ${loose}`);
});

test("a monitor linked to a place is in a place group, and a place is never also not a place", () => {
  const strays = [...linked].filter((id) => !PLACE_GROUPS.has(monitors.find((m) => m.id === id).group));
  assert.deepEqual(strays, [], `linked to a place but in another group: ${strays}`);
  assert.deepEqual([...linked].filter((id) => notPlaces.has(id)), []);
});

test("loadPlaces gives the kind and level of each linked monitor", () => {
  const places = loadPlaces();
  assert.equal(places.size, linked.size);
  assert.deepEqual(places.get("marin-district-1"), { kind: "district", governmentLevel: "subregional" });
  assert.deepEqual(places.get("san-rafael"), { kind: "city", governmentLevel: "municipal",
    districts: [{ monitorId: "marin-district-1", relation: "overlaps" }, { monitorId: "marin-district-2", relation: "overlaps" }, { monitorId: "marin-district-4", relation: "overlaps" }] });
  assert.deepEqual(places.get("bolinas"), { kind: "community", governmentLevel: "subregional", districts: [{ monitorId: "marin-district-4", relation: "within" }] });
});

test("every Facilities monitor is linked to a facility in marin-data, and every facility link is in the Facilities group", () => {
  const unlinked = monitors.filter((m) => m.group === "Facilities" && !facilities.has(m.id)).map((m) => m.id);
  assert.deepEqual(unlinked, [], `add a facility in marin-data: ${unlinked}`);
  const missing = [...facilities].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `in marin-data but not in monitors.yaml: ${missing}`);
  const strays = [...facilities].filter((id) => monitors.find((m) => m.id === id).group !== "Facilities");
  assert.deepEqual(strays, [], `linked to a facility but in another group: ${strays}`);
});
