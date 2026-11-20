"use strict";

// Run with: npm test
// Places, facilities, events and people are watched by names and search hints from marin-data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors, loadFacets, monitorsFromRows } = require("../build/config");

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
  const fairfax = one(row("fairfax", "Fairfax", { alternateNames: ["Town of Fairfax"], needsContext: ["Fairfax", "Town of Fairfax"] }));
  assert.deepEqual(fairfax.include, [["word:Marin", "Fairfax"]]);
  const market = one(row("marin-farmers-markets", "Marin Farmers Markets", { alternateNames: ["Marin Farmers Market", "Marin County Farmers Market"] }));
  assert.deepEqual(market.include, ["Marin Farmers Market", "Marin County Farmers Market"]);
});

test("a longer name that needs no context is kept beside a shorter one that does", () => {
  const union = one(row("iatse-local-16", "IATSE Local 16", { alternateNames: ["IATSE"], needsContext: ["IATSE"] }));
  assert.deepEqual(union.include, ["IATSE Local 16", ["word:Marin", "IATSE"]]);
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

test("an organization is not searched by its own name, only by its other names and hints", () => {
  const counsel = one(row("marin-county-counsel", "County Counsel", { searchName: false, alternateNames: ["Marin County Counsel", "County Counsel Office"], searchPhrases: ["County attorney"], needsContext: ["County attorney"] }));
  assert.deepEqual(counsel.include, ["Marin County Counsel", "County Counsel Office", ["word:Marin", "County attorney"]]);
});

test("the abbreviation of a name does not hide the longer name that holds it", () => {
  const cda = one(row("marin-cda", "Community Development Agency", { searchName: false, alternateNames: ["Marin County Community Development Agency", "CDA", "Marin CDA"] }));
  assert.deepEqual(cda.include, ["Marin County Community Development Agency", "Marin CDA"]);
});

test("an organization is grouped by its classification: Departments, Divisions, Legislature, Courts, Offices, Authorities", () => {
  const byId = new Map(loadMonitors().map((m) => [m.id, m]));
  assert.equal(byId.get("marin-sheriff").group, "Departments");
  assert.equal(byId.get("marin-sheriff").name, "Sheriff");
  assert.equal(byId.get("marin-cda-planning").group, "Divisions");
  assert.equal(byId.get("marin-supervisors").group, "Legislature");
  assert.equal(byId.get("marin-grand-jury").group, "Departments");
  assert.equal(byId.get("marin-oem").group, "Offices");
  assert.equal(byId.get("marin-csa-6").group, "Authorities");
  assert.equal(byId.get("marin-sheriff").youtubeSearch, true);
  assert.equal(byId.get("marin-county-counsel").youtubeSearch, undefined);
});

test("every monitor has a facet named for its schema type, and a division is under its department", () => {
  const monitors = loadMonitors();
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const facets = new Map(loadFacets().map((f) => [f.key, f]));
  for (const m of monitors) {
    assert.ok(facets.has(m.facet), `${m.id} has the facet ${m.facet}`);
    assert.ok(facets.get(m.facet).groups.includes(m.group), `${m.id} is in the group ${m.group}, which is not in the ${m.facet} facet`);
  }
  assert.equal(byId.get("sausalito").facet, "place");
  assert.equal(byId.get("marin-sheriff").facet, "organization");
  assert.equal(byId.get("lisa-warhuus").facet, "person");
  assert.equal(byId.get("civic-center").facet, "facility");
  assert.equal(byId.get("marin-flooding-topic").facet, "topic");
  assert.equal(byId.get("marin-cda-planning").parent, "marin-cda");
  assert.equal(byId.get("marin-awm-agriculture").parent, "marin-ag-weights-measures");
  assert.equal(byId.get("marin-cda").parent, undefined);
  for (const m of monitors.filter((x) => x.parent)) assert.ok(byId.has(m.parent), `${m.id} names a parent that is a monitor`);
  assert.deepEqual([...facets.keys()].slice(0, 3), ["place", "organization", "person"]);
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
  for (const id of ["tamalpais-valley", "fairfax", "civic-center", "marin-center", "marin-county-fair", "lisa-warhuus", "mary-sackett", "marin-sheriff", "marin-cda-planning", "marin-supervisors"]) {
    assert.ok(!yamlText.includes(`  - id: ${id}\n`), `${id} is in monitors.yaml and from marin-data`);
  }
});

test("organizations outside the County, services and topics come from marin-data too", () => {
  const byId = new Map(loadMonitors().map((m) => [m.id, m]));
  assert.equal(byId.get("marin-transit").group, "Authorities");
  assert.ok(byId.get("marin-transit").include.includes("Marin Transit District") || byId.get("marin-transit").include.includes("Marin Transit"));
  assert.equal(byId.get("marin-superior-court").group, "Courts");
  assert.equal(byId.get("marin-superior-court").youtubeSearch, true);
  assert.equal(byId.get("mape").group, "Associations");
  assert.ok(byId.get("iatse-local-16").include.some((e) => Array.isArray(e) && e.includes("IATSE")));
  assert.equal(byId.get("fixitmarin").group, "Services");
  assert.deepEqual(byId.get("fixitmarin").include, ["FixItMarin", "Fix It Marin"]);
  assert.equal(byId.get("marin-flooding-topic").group, "Topics");
  assert.equal(byId.get("marin-flooding-topic").name, "Flooding");
  assert.ok(!byId.get("marin-fire-topic").include.includes("Fire"), "a topic's own name is not searched");
  assert.deepEqual(byId.get("marin-county").sourceMethods, ["rss", "google-news", "youtube"]);
  assert.ok(byId.get("marin-county").exclude.includes("Bank of Marin"));
  assert.ok(byId.get("marin-economic-development-topic").exclude.includes("Bank of Marin"));
});
