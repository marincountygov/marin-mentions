"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { filterExcludedTitles } = require("../build/exclude");
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
