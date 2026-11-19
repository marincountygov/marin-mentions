"use strict";

// Run with: npm test
// Districts and groups come from marin-data (config/places.json and the other link files).
const test = require("node:test");
const assert = require("node:assert/strict");
const { addDistrictsFromPlaces } = require("../build/match");
const { loadMonitors, loadPlaces, groupMonitors, loadDataFor } = require("../build/config");

const monitors = loadMonitors();
const places = loadPlaces();
const byId = new Map(monitors.map((m) => [m.id, m]));
const order = [{ id: "marin-district-2" }, { id: "marin-district-4" }, { id: "greenbrae" }, { id: "larkspur" }, { id: "san-rafael" }];
const guess = (...ids) => ({ matchedMonitors: ids });

test("an item that matches a place also matches the districts the place is in", () => {
  const some = new Map([["greenbrae", { districts: [{ monitorId: "marin-district-2", relation: "within" }] }],
    ["larkspur", { districts: [{ monitorId: "marin-district-2", relation: "overlaps" }, { monitorId: "marin-district-4", relation: "overlaps" }] }]]);
  const [a, b, c] = addDistrictsFromPlaces([guess("greenbrae"), guess("larkspur"), guess("san-rafael")], some, order);
  assert.deepEqual(a.matchedMonitors, ["marin-district-2", "greenbrae"]);
  assert.deepEqual(b.matchedMonitors, ["marin-district-2", "marin-district-4", "larkspur"]);
  assert.deepEqual(c.matchedMonitors, ["san-rafael"], "a place with no district adds nothing");
});

test("an item that already matched its district is not changed", () => {
  const some = new Map([["greenbrae", { districts: [{ monitorId: "marin-district-2", relation: "within" }] }]]);
  const [item] = addDistrictsFromPlaces([guess("marin-district-2", "greenbrae")], some, order);
  assert.deepEqual(item.matchedMonitors, ["marin-district-2", "greenbrae"]);
});

test("every district a place names is a monitor in the Districts group", () => {
  for (const [id, place] of places) {
    for (const district of place.districts || []) {
      assert.equal(byId.get(district.monitorId)?.group, "Districts", `${id} names ${district.monitorId}`);
    }
  }
});

test("a district's own phrases do not repeat the places in it", () => {
  const names = new Set([...places].filter(([, p]) => p.kind !== "district").map(([id]) => byId.get(id).name.toLowerCase()));
  const term = (entry) => (Array.isArray(entry) ? entry.filter((t) => t.toLowerCase() !== "word:marin")[0] : entry).replace(/^word:/, "").replace(/^#/, "").toLowerCase();
  for (const district of monitors.filter((m) => m.group === "Districts")) {
    const repeated = district.include.map(term).filter((t) => names.has(t));
    assert.deepEqual(repeated, [], `${district.id} lists places that marin-data already puts in it: ${repeated}`);
  }
});

test("monitors that marin-data describes get their group and name from there", () => {
  const fromData = loadDataFor();
  for (const [id, data] of fromData) {
    if (byId.has(id)) {
      assert.equal(byId.get(id).group, data.group, id);
      assert.equal(byId.get(id).name, data.name, id);
    }
  }
  assert.equal(byId.get("marin-district-3").group, "Districts");
  assert.equal(byId.get("marin-district-3").name, "District 3");
  assert.equal(byId.get("sausalito").group, "Cities and towns");
  assert.equal(byId.get("bolinas").group, "Communities");
  assert.equal(byId.get("civic-center").group, "Facilities");
  assert.equal(byId.get("marin-county-fair").group, "Events");
  assert.equal(byId.get("dennis-rodoni").group, "People");
});

test("a group or name written in monitors.yaml that disagrees with marin-data stops the build", () => {
  const fromData = new Map([["sausalito", { group: "Cities and towns", name: "Sausalito" }]]);
  const ok = { id: "sausalito", group: "Cities and towns", name: "Sausalito" };
  assert.deepEqual(groupMonitors([{ id: "sausalito" }], fromData), [ok]);
  assert.deepEqual(groupMonitors([{ id: "sausalito", group: "Cities and towns" }], fromData), [ok]);
  assert.throws(() => groupMonitors([{ id: "sausalito", group: "Districts" }], fromData), /group "Districts" in monitors.yaml, but marin-data says "Cities and towns"/);
  assert.throws(() => groupMonitors([{ id: "sausalito", name: "Sausalito city" }], fromData), /name "Sausalito city" in monitors.yaml, but marin-data says "Sausalito"/);
  assert.deepEqual(groupMonitors([{ id: "other", group: "Topics", name: "Other" }], fromData), [{ id: "other", group: "Topics", name: "Other" }]);
});

test("the groups are the plural names in place-kinds.json", () => {
  const { kinds } = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "config", "places.json"), "utf8"));
  const plural = Object.fromEntries(kinds.map((k) => [k.key, k.plural]));
  assert.equal(plural.city, "Cities and towns");
  assert.equal(plural.community, "Communities");
  for (const [, p] of places) assert.ok(["district", "city", "community"].includes(p.kind), p.kind);
});
