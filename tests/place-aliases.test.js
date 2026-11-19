"use strict";

// Run with: npm test
// Places, facilities, events and people are watched by names and search hints from marin-data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors, monitorsFromRows } = require("../build/config");

const row = (monitorId, name, extra = {}) => ({ monitorId, name, ...extra });
const one = (r, options) => monitorsFromRows([r], options)[0];

test("a record with a safe name is watched by its name", () => {
  assert.deepEqual(one(row("sausalito", "Sausalito")), { id: "sausalito", include: ["Sausalito"] });
});

test("a name that needs context is watched beside the word Marin", () => {
  assert.deepEqual(one(row("fairfax", "Fairfax", { needsContext: ["Fairfax"] })).include, [["word:Marin", "Fairfax"]]);
});

test("a name inside other words is a whole word, and a hashtag is added as it is", () => {
  const novato = one(row("novato", "Novato", { insideWords: ["Novato"], hashtags: ["#Novato"] }));
  assert.deepEqual(novato.include, ["word:Novato", "#Novato"]);
  const ross = one(row("ross", "Ross", { needsContext: ["Ross"], insideWords: ["Ross"] }));
  assert.deepEqual(ross.include, [["word:Marin", "word:Ross"]]);
});

test("other names are watched too, and a name that only repeats another is left out", () => {
  const fair = one(row("marin-county-fair", "Marin County Fair", { alternateNames: ["Marin Fair"], searchPhrases: ["Marin Fairgrounds"] }));
  assert.deepEqual(fair.include, ["Marin County Fair", "Marin Fair", "Marin Fairgrounds"]);
  const fairfax = one(row("fairfax", "Fairfax", { alternateNames: ["Town of Fairfax"], needsContext: ["Fairfax"] }));
  assert.deepEqual(fairfax.include, [["word:Marin", "Fairfax"]]);
  const market = one(row("marin-farmers-markets", "Marin Farmers Markets", { alternateNames: ["Marin Farmers Market", "Marin County Farmers Market"] }));
  assert.deepEqual(market.include, ["Marin Farmers Market", "Marin County Farmers Market"]);
});

test("a search phrase can join words with &, and then every word must be there", () => {
  const center = one(row("civic-center", "Civic Center", { searchPhrases: ["county & offices", "Frank Lloyd Wright"], needsContext: ["county & offices", "Frank Lloyd Wright"] }));
  assert.deepEqual(center.include, ["Civic Center", ["word:Marin", "county", "offices"], ["word:Marin", "Frank Lloyd Wright"]]);
});

test("names it is confused with are left out", () => {
  assert.deepEqual(one(row("civic-center", "Civic Center", { confusableNames: ["SF Civic Center"] })).exclude, ["SF Civic Center"]);
});

test("a short abbreviation is watched only when it needs context", () => {
  const district = one(row("marin-district-3", "District 3", { alternateNames: ["D3", "Marin District 3"] }));
  assert.deepEqual(district.include, ["District 3"], "D3 is skipped, and Marin District 3 only repeats District 3");
  const hall = one(row("marin-center", "Marin Center", { parts: [{ name: "Veterans Hall", alternateNames: ["VMA"], needsContext: ["VMA"], insideWords: ["VMA"] }] }));
  assert.deepEqual(hall.include, ["Marin Center", "Veterans Hall", ["word:Marin", "word:VMA"]]);
});

test("the facilities inside a facility are watched as the facility", () => {
  const center = one(row("marin-center", "Marin Center", { parts: [{ name: "Marin Showcase Theater" }, { name: "Marin Exhibit Hall" }] }));
  assert.deepEqual(center.include, ["Marin Center", "Marin Showcase Theater", "Marin Exhibit Hall"]);
});

test("match-options.yaml naming a record that marin-data does not have stops the build", () => {
  assert.throws(() => monitorsFromRows([row("civic-center", "Civic Center")], { "civic-centre": { youtubeSearch: true } }), /"civic-centre" is not a place, facility, event or person/);
  assert.equal(one(row("civic-center", "Civic Center"), { "civic-center": { youtubeSearch: true } }).youtubeSearch, true);
});

test("the real monitors come from marin-data, and monitors.yaml does not repeat them", () => {
  const byId = new Map(loadMonitors().map((m) => [m.id, m]));
  assert.deepEqual(byId.get("tamalpais-valley").include, ["Tamalpais Valley", "Tam Valley"]);
  assert.deepEqual(byId.get("fairfax").include, [["word:Marin", "Fairfax"]]);
  assert.deepEqual(byId.get("civic-center").exclude, ["SF Civic Center", "San Francisco Civic Center"]);
  assert.equal(byId.get("civic-center").youtubeSearch, true);
  assert.ok(byId.get("marin-center").include.some((e) => Array.isArray(e) && e.includes("word:VMA")));
  assert.deepEqual(byId.get("lisa-warhuus").include, ["Lisa Warhuus"]);
  assert.equal(byId.get("lisa-warhuus").group, "People");
  const yamlText = fs.readFileSync(path.join(__dirname, "..", "config", "monitors.yaml"), "utf8");
  for (const id of ["tamalpais-valley", "fairfax", "civic-center", "marin-center", "marin-county-fair", "lisa-warhuus", "mary-sackett"]) {
    assert.ok(!yamlText.includes(`  - id: ${id}\n`), `${id} is in monitors.yaml and from marin-data`);
  }
});
