"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMonitors, buildContextRules } = require("../build/match");
const { loadContext } = require("../build/config");
const { isEnglishOrUntagged, englishOnlyTerms, searchUrl } = require("../build/connectors/bluesky");

const monitors = [
  { id: "inverness", group: "Towns", include: ["Inverness"] },
  { id: "sausalito", group: "Towns", include: ["Sausalito"] },
  { id: "west-marin", group: "Districts", include: ["Olema", ["word:Marin", "Fallon"]] },
  { id: "derek-johnson", group: "People", include: ["Derek Johnson"] },
  { id: "mape", group: "Associations", include: ["word:MAPE"] },
];

const rules = buildContextRules({
  sourceMethods: ["bluesky"],
  context: ["word:Marin", "California", "word:CA", "#BayArea"],
  ambiguousTerms: ["Inverness", "Olema", "word:MAPE"],
  ambiguousGroups: ["People"],
  trustedAuthors: ["Local.News"],
  blockedAuthors: ["Jobs.Scotland"],
});

function post(text, extra = {}) {
  return { text, sourceMethod: "bluesky", handle: "someone.bsky.social", matchedTerms: [], matchedMonitors: [], ...extra };
}
function matched(item, ruleSet = rules) {
  applyMonitors(item, monitors, ruleSet);
  return item.matchedMonitors;
}

test("an ambiguous place name without local context is dropped", () => {
  assert.deepEqual(matched(post("Walking in Inverness today")), []);
});

test("the same place name with local context is kept", () => {
  assert.deepEqual(matched(post("Boil water notice for Inverness, California")), ["inverness"]);
  assert.deepEqual(matched(post("Inverness is lovely #BayArea")), ["inverness"]);
});

test("context words match whole words only", () => {
  assert.deepEqual(matched(post("Inverness, I can see the castle")), []);
  assert.deepEqual(matched(post("Inverness in the Marinade")), []);
});

test("an unambiguous place name needs no context", () => {
  assert.deepEqual(matched(post("Ducks in Sausalito")), ["sausalito"]);
});

test("a compound entry carries its own context", () => {
  assert.deepEqual(matched(post("Marin ranchers near Fallon")), ["west-marin"]);
});

test("a monitor in an ambiguous group needs context", () => {
  assert.deepEqual(matched(post("Derek Johnson on his comic")), []);
  assert.deepEqual(matched(post("Derek Johnson spoke in Marin")), ["derek-johnson"]);
});

test("a trusted author skips the context requirement; a blocked author is dropped", () => {
  assert.deepEqual(matched(post("Walking in Inverness", { handle: "local.news" })), ["inverness"]);
  assert.deepEqual(matched(post("Sausalito vacancy", { handle: "jobs.scotland" })), []);
});

test("only the listed source methods are affected", () => {
  assert.deepEqual(matched(post("Walking in Inverness", { sourceMethod: "rss" })), ["inverness"]);
});

test("with no rules, matching is unchanged", () => {
  assert.deepEqual(matched(post("Walking in Inverness"), null), ["inverness"]);
  assert.equal(buildContextRules(null), null);
});

test("the real config/context.yaml loads and covers the known noisy terms", () => {
  const real = buildContextRules(loadContext());
  assert.ok(real.sourceMethods.has("bluesky"));
  ["inverness", "las gallinas", "novato", "mape"].forEach((term) => assert.ok(real.ambiguousTerms.has(term), term));
  assert.ok(real.ambiguousGroups.has("People"));
  assert.ok(real.contextTerms.length > 5);
});

test("Bluesky language handling", () => {
  assert.equal(isEnglishOrUntagged({ record: { langs: ["en"] } }), true);
  assert.equal(isEnglishOrUntagged({ record: { langs: ["en-GB"] } }), true);
  assert.equal(isEnglishOrUntagged({ record: { langs: ["es"] } }), false);
  assert.equal(isEnglishOrUntagged({ record: { langs: ["et", "en"] } }), true);
  assert.equal(isEnglishOrUntagged({ record: {} }), true, "posts with no language tag are kept");
  const english = englishOnlyTerms();
  assert.ok(english.has("inverness") && english.has("novato") && !english.has("sausalito"));
  assert.match(searchUrl("Inverness", undefined, true), /[?&]lang=en(&|$)/);
  assert.doesNotMatch(searchUrl("Sausalito", undefined, false), /lang=/);
});

// The real monitors file: a headline that calls the Civic Center "Frank Lloyd Wright landmark".
test("a Marin headline about a Frank Lloyd Wright landmark reaches the Civic Center monitor", () => {
  const { loadMonitors } = require("../build/config");
  const real = loadMonitors();
  const ids = (title) => {
    const item = { text: title, sourceMethod: "google-news", matchedTerms: [], matchedMonitors: [] };
    applyMonitors(item, real, buildContextRules({}));
    return item.matchedMonitors;
  };
  assert.ok(ids("New Marin exhibit brings eco-friendly fashion to Frank Lloyd Wright landmark").includes("civic-center"));
  assert.ok(!ids("A new Frank Lloyd Wright exhibit opens in Phoenix").includes("civic-center"));
});
