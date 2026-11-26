"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { stripPublisherName } = require("../build/attribution");
const { applyMonitors } = require("../build/match");
const { fetchGoogleNewsSource } = require("../build/connectors/google-news");

test("the publisher's name at the end of the text is taken off", () => {
  assert.equal(
    stripPublisherName("Kilmar Abrego Garcia is self-deporting to Spain Marin Independent Journal", "Marin Independent Journal"),
    "Kilmar Abrego Garcia is self-deporting to Spain"
  );
});

test("a dash or colon before the name goes with it, and case is ignored", () => {
  assert.equal(stripPublisherName("Council votes - marin independent journal", "Marin Independent Journal"), "Council votes");
  assert.equal(stripPublisherName("Council votes: Marin Independent Journal", "Marin Independent Journal"), "Council votes");
});

test("the name inside the story is kept, and so is text that does not end with it", () => {
  assert.equal(stripPublisherName("Marin Independent Journal reports a fire", "Marin Independent Journal"), "Marin Independent Journal reports a fire");
  assert.equal(stripPublisherName("Fire in Novato", "Marin Independent Journal"), "Fire in Novato");
  assert.equal(stripPublisherName("Fire in Novato", ""), "Fire in Novato");
});

test("a story that is only the publisher's name becomes empty", () => {
  assert.equal(stripPublisherName("Marin Independent Journal", "Marin Independent Journal"), "");
});

test("a national story no longer matches Marin because of the publisher's name", () => {
  const monitors = [{ id: "marin-county", group: "Topics", include: ["Marin"] }];
  const before = { title: "Kilmar Abrego Garcia is self-deporting to Spain", text: "Kilmar Abrego Garcia is self-deporting to Spain Marin Independent Journal", matchedTerms: [], matchedMonitors: [] };
  applyMonitors(before, monitors, null);
  assert.deepEqual(before.matchedMonitors, ["marin-county"], "the old text matched only through the publisher's name");

  const after = { title: before.title, text: stripPublisherName(before.text, "Marin Independent Journal"), matchedTerms: [], matchedMonitors: [] };
  applyMonitors(after, monitors, null);
  assert.deepEqual(after.matchedMonitors, [], "without the name nothing matches");

  const local = { title: "Marin supervisors approve the budget", text: "Marin supervisors approve the budget Marin Independent Journal", matchedTerms: [], matchedMonitors: [] };
  local.text = stripPublisherName(local.text, "Marin Independent Journal");
  applyMonitors(local, monitors, null);
  assert.deepEqual(local.matchedMonitors, ["marin-county"], "a story about Marin still matches on its own words");
});

test("the Google News connector takes the name off new stories", async () => {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Story - Marin Independent Journal</title><link>https://news.google.com/rss/articles/x</link>
    <description>&lt;a href="https://news.google.com/rss/articles/x"&gt;Story&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Marin Independent Journal&lt;/font&gt;</description>
    <pubDate>Tue, 25 Nov 2026 04:55:33 GMT</pubDate><source url="https://www.marinij.com">Marin Independent Journal</source></item></channel></rss>`;
  const http = require("../build/http");
  const original = http.fetchText;
  http.fetchText = async () => feed;
  try {
    delete require.cache[require.resolve("../build/connectors/google-news")];
    const { fetchGoogleNewsSource: fresh } = require("../build/connectors/google-news");
    const { items } = await fresh({ id: "marin-ij", name: "Marin Independent Journal", query: "site:marinij.com" });
    assert.equal(items.length, 1);
    assert.equal(items[0].description, "Story");
  } finally {
    http.fetchText = original;
  }
});
