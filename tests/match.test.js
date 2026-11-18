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

// Stories that matched by accident in production (2026-10-26). Each must now match nothing.
test("look-alike words and other places no longer match the real monitors", () => {
  const { loadMonitors } = require("../build/config");
  const real = loadMonitors();
  const ids = (text, sourceMethod = "google-news") => {
    const item = { text, sourceMethod, matchedTerms: [], matchedMonitors: [] };
    applyMonitors(item, real, buildContextRules({}));
    return item.matchedMonitors;
  };
  // "Olema" inside "Coleman", and "Novato" inside "innovator"
  assert.deepEqual(ids("Microsoft offers voluntary buyouts, Chief People Officer Amy Coleman wrote in a blog post"), []);
  assert.deepEqual(ids("California aviation innovator Natilus wins government contract"), []);
  // The real places still match, including as hashtags
  assert.ok(ids("Road closed near Olema on Highway 1").includes("olema"));
  assert.ok(ids("Council meets in Novato tonight").includes("novato"));
  assert.ok(ids("Get ready for winter #NovatoMarinCounty", "bluesky").includes("novato"));
  // Bank of Marin is a bank, not the County
  assert.deepEqual(ids("Bank of Marin (BMRC) Q3 Earnings and Revenues Surpass Estimates"), []);
  assert.deepEqual(ids("Bank of Marin Bancorp reports small business loan growth and higher earnings"), []);
  // San Francisco's Civic Center is not Marin's
  assert.deepEqual(ids("Marin to the SF Civic Center, no Karl", "youtube"), []);
  assert.ok(ids("Events this week at the Marin County Civic Center").includes("civic-center"));
});

test("a post from an account blocked in config/context.yaml is dropped, even when it matches a monitor", () => {
  const real = buildContextRules(loadContext());
  const monitor = [{ id: "child-support", group: "Departments", include: ["child support"] }];
  const blocked = post("if she gets pregnant, get ready to pay child support", { handle: "steeltitan.bsky.social" });
  applyMonitors(blocked, monitor, real);
  assert.deepEqual(blocked.matchedMonitors, []);
  const other = post("Marin County child support office hours", { handle: "someone.bsky.social" });
  applyMonitors(other, monitor, real);
  assert.deepEqual(other.matchedMonitors, ["child-support"]);
});

const { dropMismatchedText } = require("../build/text-check");

test("Marin in a compound entry matches the whole word only", () => {
  const m = [{ id: "marshall", include: [["word:Marin", "word:Marshall"]] }];
  const run = (text) => { const it = { text, matchedTerms: [], matchedMonitors: [] }; applyMonitors(it, m, null); return it.matchedMonitors; };
  assert.deepEqual(run("Tracked on MarineTraffic, flagged in the Marshall Islands"), []);
  assert.deepEqual(run("Marin County, Marshall"), ["marshall"]);
  assert.deepEqual(run("Marshall news #larkspurcitymarincounty"), ["marshall"]);
  assert.deepEqual(run("Marshall at the Berkeley Marina"), []);
});

test("matchTextChars ignores related-story text at the end of a body", () => {
  const m = [{ id: "general", include: ["word:Marin"] }];
  const body = "A storm hit the coast. " + "x".repeat(400) + " Marin County flooded by high tides";
  const early = { title: "Storm", text: body, _matchChars: 300, matchedTerms: [], matchedMonitors: [] };
  const all = { title: "Storm", text: body, matchedTerms: [], matchedMonitors: [] };
  applyMonitors(all, m, null);
  assert.deepEqual(all.matchedMonitors, ["general"]);
  applyMonitors(early, m, null);
  assert.deepEqual(early.matchedMonitors, []);
});

test("text that belongs to another story is dropped", () => {
  const tanker = "Just hours after a tanker in New Orleans lost its steering and slammed into a cruise boat.";
  const items = [
    { url: "a", title: "Vallarta Supermarkets to open its first San Jose location", text: tanker },
    { url: "b", title: "Fire breaks out at abandoned warehouse in San Francisco", text: tanker },
    { url: "c", title: "Marin County sheriff warns of scam calls", text: "The Marin County sheriff's office warned residents about scam calls." },
  ];
  assert.equal(dropMismatchedText(items), 2);
  assert.equal(items[0].text, "");
  assert.equal(items[1].text, "");
  assert.notEqual(items[2].text, "");
});

test("a lone story whose text has no title words is dropped", () => {
  const items = [{ url: "a", title: "Denny's reinstalls plaque honoring former Nvidia CEO", text: "Outages affecting Apple services were resolved Tuesday night." }];
  assert.equal(dropMismatchedText(items), 1);
});
