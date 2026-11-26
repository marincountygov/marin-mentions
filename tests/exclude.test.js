"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { filterExcludedTitles, filterExcludedTitlesBySource } = require("../build/exclude");
const { loadExcludedTitles } = require("../build/config");

test("drops a Sports in Marin title and keeps others", () => {
  const items = [
    { id: "a", title: "Sports in Marin: Thursday, Friday" },
    { id: "b", title: "Board approves budget" },
  ];
  const kept = filterExcludedTitles(items, ["Sports in Marin"]);
  assert.deepEqual(kept.map((i) => i.id), ["b"]);
});

test("ignores case and matches inside the title", () => {
  const kept = filterExcludedTitles([{ id: "a", title: "Weekend: SPORTS IN MARIN roundup" }], ["Sports in Marin"]);
  assert.equal(kept.length, 0);
});

test("only the title counts, not the text", () => {
  const items = [{ id: "a", title: "Other story", text: "See Sports in Marin" }];
  assert.equal(filterExcludedTitles(items, ["Sports in Marin"]).length, 1);
});

test("the config lists Sports in Marin", () => {
  assert.ok(loadExcludedTitles().includes("Sports in Marin"));
});

test("the config drops sports labels and keeps other stories", () => {
  const items = [
    { id: "a", title: "Sports Briefs: Tam tennis wins" },
    { id: "b", title: "Girls tennis: Tam wins MCALs" },
    { id: "c", title: "Prep football: Redwood rolls" },
    { id: "d", title: "Boys water polo: Redwood falls" },
    { id: "e", title: "Board approves new stadium lighting rules" },
  ];
  const kept = filterExcludedTitles(items, loadExcludedTitles());
  assert.deepEqual(kept.map((i) => i.id), ["e"]);
});

test("a source's own phrases leave out that source's stories and no one else's", () => {
  const sources = [{ id: "marin-ij", excludeTitles: ["49ers", "NFL"] }, { id: "county" }];
  const items = [
    { id: "a", sourceId: "marin-ij", title: "49ers beat the Rams" },
    { id: "b", sourceId: "marin-ij", title: "Board approves budget" },
    { id: "c", sourceId: "county", title: "49ers fan day at the Civic Center" },
    { id: "d", sourceId: "marin-ij", title: "nfl draft preview" },
  ];
  assert.deepEqual(filterExcludedTitlesBySource(items, sources).map((i) => i.id), ["b", "c"]);
});

test("a source's phrase matches whole words only", () => {
  const sources = [{ id: "marin-ij", excludeTitles: ["NFL", "Warriors"] }];
  const items = [
    { id: "a", sourceId: "marin-ij", title: "Inflation remains high despite retreat in gas prices" },
    { id: "b", sourceId: "marin-ij", title: "Warriors' Draymond Green beefs with NBA player" },
    { id: "c", sourceId: "marin-ij", title: "NFL: Week 13 picks" },
    { id: "d", sourceId: "marin-ij", title: "Reunion of the Mill Valley warriorsmith guild" },
  ];
  assert.deepEqual(filterExcludedTitlesBySource(items, sources).map((i) => i.id), ["a", "d"]);
});

test("with no per-source phrases every story is kept", () => {
  const items = [{ id: "a", sourceId: "x", title: "49ers" }];
  assert.equal(filterExcludedTitlesBySource(items, [{ id: "x" }]).length, 1);
  assert.equal(filterExcludedTitlesBySource(items, undefined).length, 1);
});
