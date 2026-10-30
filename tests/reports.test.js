"use strict";

// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../assets/reports/core.js");
const Render = require("../assets/reports/render.js");

const TODAY = "2026-10-06";
const mention = (over) => ({
  id: "abc123", title: "County approves winter plan", text: "County approves winter plan", source: "Marin IJ",
  sourceId: "marin-ij", sourceType: "news", url: "https://example.com/a", sourceUrl: "https://example.com",
  publishedAt: "2026-10-02T17:00:00.000Z", matchedMonitors: ["marin-county"], ...over,
});
const names = { "marin-county": "Marin County" };

function fresh(type = "media-coverage") { return Core.createReport(type, TODAY); }

test("period shortcuts and the readable period line", () => {
  assert.deepEqual(Core.periodFor("last-7", TODAY), { start: "2026-09-30", end: "2026-10-06" });
  assert.deepEqual(Core.periodFor("last-14", TODAY), { start: "2026-09-23", end: "2026-10-06" });
  assert.deepEqual(Core.periodFor("this-month", TODAY), { start: "2026-10-01", end: "2026-10-06" });
  assert.deepEqual(Core.periodFor("last-month", TODAY), { start: "2026-09-01", end: "2026-09-30" });
  assert.equal(Core.periodFor("custom", TODAY), null);
  assert.equal(Core.formatPeriod("2026-09-30", "2026-10-06"), "Wednesday, September 30, through Tuesday, October 6");
  assert.equal(Core.formatPeriod("2026-12-28", "2027-01-03"), "Monday, December 28, 2026, through Sunday, January 3, 2027");
});

test("days follow Pacific time, not UTC", () => {
  assert.equal(Core.pacificDate("2026-10-07T00:30:00Z"), "2026-10-06"); // 5:30 pm Pacific on Oct 6
  assert.equal(Core.pacificDate("2026-10-06T07:30:00Z"), "2026-10-06");
  assert.equal(Core.pacificDate("2026-10-06T06:59:00Z"), "2026-10-05");
  const period = { start: "2026-09-30", end: "2026-10-06" };
  assert.ok(Core.inPeriod(Core.pacificDate("2026-10-07T00:30:00Z"), period));
  assert.ok(!Core.inPeriod(Core.pacificDate("2026-10-07T07:30:00Z"), period));
  assert.ok(Core.inPeriod("2026-09-30", period) && Core.inPeriod("2026-10-06", period));
});

test("the media coverage template has the five sections", () => {
  const r = fresh();
  assert.deepEqual(r.sections.map((s) => s.id), ["news-releases", "older-releases", "other-coverage", "opinion", "upcoming"]);
  assert.deepEqual(r.sections.map((s) => s.type), ["release-coverage", "release-coverage", "coverage-list", "coverage-list", "manual-table"]);
  assert.equal(r.footer, "", "no closing note by default");
  assert.equal(fresh("custom").sections.length, 0);
  assert.equal(r.schemaVersion, "1.0");
});

test("a Mentions item is saved as a snapshot with Mentions' own fields", () => {
  const s = Core.snapshotFromMention(mention(), names);
  assert.equal(s.itemId, "abc123");
  assert.equal(s.date, "2026-10-02");
  assert.equal(s.headline, "County approves winter plan");
  assert.equal(s.source, "Marin IJ");
  assert.equal(s.contentType, "news");
  assert.deepEqual(s.monitors, ["Marin County"]);
  assert.equal(s.origin, "mentions");
});

test("the same item cannot be added twice, and manual items are separate", () => {
  let r = fresh();
  const s = Core.snapshotFromMention(mention(), names);
  r = Core.addUnplaced(r, s);
  r = Core.addUnplaced(r, Core.snapshotFromMention(mention(), names));
  assert.equal(r.unplaced.length, 1);
  r = Core.addUnplaced(r, Core.manualCoverage({ date: "2026-10-03", headline: "Offline story", source: "Radio" }));
  r = Core.addUnplaced(r, Core.manualCoverage({ date: "2026-10-03", headline: "Offline story", source: "Radio" }));
  assert.equal(r.unplaced.length, 3);
  assert.equal(r.unplaced[1].origin, "manual");
});

test("placing coverage in sections and on a release, and moving it", () => {
  let r = fresh();
  const a = Core.snapshotFromMention(mention({ id: "a" }), names);
  const b = Core.snapshotFromMention(mention({ id: "b", title: "Second story" }), names);
  const c = Core.snapshotFromMention(mention({ id: "c", title: "Third story" }), names);
  [a, b, c].forEach((x) => { r = Core.addUnplaced(r, x); });
  const release = Core.newRelease({ date: "2026-09-30", department: "CDA", title: "Winter readiness" });
  r = Core.addToSection(r, "news-releases", release);
  r = Core.placeItem(r, a.uid, "news-releases", release.uid);
  r = Core.placeItem(r, b.uid, "news-releases", release.uid);
  r = Core.placeItem(r, c.uid, "other-coverage");
  assert.deepEqual(Core.findSection(r, "news-releases").items[0].coverage.map((x) => x.itemId), ["a", "b"]);
  assert.equal(Core.findSection(r, "other-coverage").items[0].itemId, "c");
  assert.equal(r.unplaced.length, 0);
  r = Core.moveItemBy(r, b.uid, -1);
  assert.deepEqual(Core.findSection(r, "news-releases").items[0].coverage.map((x) => x.itemId), ["b", "a"]);
  r = Core.placeItem(r, a.uid, "opinion"); // from a release to another section
  assert.equal(Core.findSection(r, "opinion").items[0].itemId, "a");
  r = Core.unplaceItem(r, c.uid);
  assert.equal(r.unplaced[0].itemId, "c");
  // coverage cannot be placed into a manual table
  r = Core.placeItem(r, c.uid, "upcoming");
  assert.equal(r.unplaced.length, 1);
});

test("removing a release keeps its coverage; deleting a section does too", () => {
  let r = fresh();
  const a = Core.snapshotFromMention(mention({ id: "a" }), names);
  const release = Core.newRelease({ title: "R" });
  r = Core.addUnplaced(r, a);
  r = Core.addToSection(r, "news-releases", release);
  r = Core.placeItem(r, a.uid, "news-releases", release.uid);
  r = Core.removeItem(r, release.uid);
  assert.equal(r.unplaced.length, 1);
  r = Core.placeItem(r, a.uid, "other-coverage");
  r = Core.deleteSection(r, "other-coverage");
  assert.equal(r.unplaced.length, 1);
  assert.ok(!Core.findSection(r, "other-coverage"));
});

test("sections can be reordered, renamed, hidden, and added", () => {
  let r = fresh();
  r = Core.moveSectionBy(r, "opinion", -1);
  assert.deepEqual(r.sections.map((s) => s.id).slice(2, 4), ["opinion", "other-coverage"]);
  r = Core.moveSectionBy(r, "news-releases", -1); // already first: no change
  assert.equal(r.sections[0].id, "news-releases");
  r = Core.updateSection(r, "upcoming", { title: "Coming up", enabled: false });
  assert.equal(Core.findSection(r, "upcoming").title, "Coming up");
  assert.equal(Core.findSection(r, "upcoming").enabled, false);
  r = Core.addSection(r, "highlights", "Key takeaways");
  assert.equal(r.sections[r.sections.length - 1].type, "highlights");
  r = Core.addSection(r, "nonsense", "x");
  assert.equal(r.sections.length, 6);
});

test("releaseSectionFor sends older releases to the older section", () => {
  const r = fresh();
  assert.equal(Core.releaseSectionFor(r, "2026-10-01").id, "news-releases");
  assert.equal(Core.releaseSectionFor(r, "2026-08-01").id, "older-releases");
  assert.equal(Core.releaseSectionFor(fresh("custom"), "2026-10-01"), null);
});

test("links other than web and email are removed", () => {
  assert.equal(Core.safeUrl("https://example.com/x?y=1"), "https://example.com/x?y=1");
  assert.equal(Core.safeUrl("mailto:PIO@marincounty.gov"), "mailto:PIO@marincounty.gov");
  ["javascript:alert(1)", "data:text/html,<b>", "file:///etc/passwd", "not a url", "  "].forEach((bad) => assert.equal(Core.safeUrl(bad), ""));
  assert.equal(Core.manualCoverage({ headline: "x", url: "javascript:alert(1)" }).url, "");
});

test("validation: good reports pass, bad files give plain messages", () => {
  const ok = Core.validateReport(fresh());
  assert.ok(ok.ok && ok.errors.length === 0);
  assert.equal(Core.validateReport(null).ok, false);
  assert.match(Core.parseJson("{not json").errors[0], /not valid JSON/);
  assert.match(Core.parseJson("{}").errors.join(" "), /no report version/);
  const newer = { ...fresh(), schemaVersion: "2.0" };
  assert.match(Core.validateReport(newer).errors[0], /version 2\.0/);
  const badPeriod = { ...fresh(), period: { start: "2026-10-06", end: "2026-09-30" } };
  assert.match(Core.validateReport(badPeriod).errors.join(" "), /starts after it ends/);
  const noSections = { ...fresh(), sections: "x" };
  assert.match(Core.validateReport(noSections).errors.join(" "), /no list of sections/);
  const unknownType = fresh();
  unknownType.sections[0].type = "scary";
  assert.match(Core.validateReport(unknownType).errors.join(" "), /unknown section type/);
});

test("validation cleans what it keeps: unsafe links, extra fields, long text", () => {
  const r = fresh();
  const item = Core.manualCoverage({ headline: "Story", url: "https://ok.example/x" });
  item.url = "javascript:alert(1)";
  item.evil = "<script>";
  item.headline = "H".repeat(900);
  r.sections[2].items.push(item);
  const result = Core.validateReport(JSON.parse(JSON.stringify(r)));
  assert.ok(result.ok);
  const cleaned = result.report.sections[2].items[0];
  assert.equal(cleaned.url, "");
  assert.ok(!("evil" in cleaned));
  assert.equal(cleaned.headline.length, 300);
});

test("export, import, render gives the same report", () => {
  let r = fresh();
  const a = Core.snapshotFromMention(mention({ id: "a" }), names);
  const release = Core.newRelease({ date: "2026-09-30", department: "HHS", title: "Flu clinics", url: "https://marincounty.gov/flu" });
  r = Core.addUnplaced(r, a);
  r = Core.addToSection(r, "news-releases", release);
  r = Core.placeItem(r, a.uid, "news-releases", release.uid);
  r = Core.addToSection(r, "upcoming", Core.newRow({ when: "Oct 14", department: "DPW", topic: "Road work", description: "Details" }));
  const back = Core.parseJson(Core.toJson(r));
  assert.ok(back.ok);
  assert.equal(Render.renderReport(back.report), Render.renderReport(r));
  assert.equal(Render.toPlainText(back.report), Render.toPlainText(r));
});

test("a saved report still renders when the live item is gone", () => {
  let r = fresh();
  r = Core.addUnplaced(r, Core.snapshotFromMention(mention({ id: "gone" }), names));
  r = Core.placeItem(r, r.unplaced[0].uid, "other-coverage");
  const html = Render.renderReport(Core.parseJson(Core.toJson(r)).report);
  assert.match(html, /County approves winter plan/);
  assert.match(html, /Marin IJ/);
  assert.match(html, /href="https:\/\/example\.com\/a"/);
});

test("the renderer produces semantic, Word-friendly HTML", () => {
  let r = fresh();
  const a = Core.snapshotFromMention(mention({ id: "a" }), names);
  const release = Core.newRelease({ date: "2026-09-30", department: "CDA", title: "Winter <b>readiness</b>", url: "https://marincounty.gov/w" });
  r = Core.addUnplaced(r, a);
  r = Core.addToSection(r, "news-releases", release);
  r = Core.placeItem(r, a.uid, "news-releases", release.uid);
  r = Core.updateSection(r, "older-releases", { enabled: false });
  r.footer = "Know of an upcoming news opportunity or great story to tell?\n\nPlease reach out to PIO@marincounty.gov with details.";
  r.footerBold = true;
  const html = Render.renderReport(r);
  assert.match(html, /<h1>Marin Media Coverage and Outreach Report<\/h1>/);
  assert.match(html, /<p><em>Wednesday, September 30, through Tuesday, October 6<\/em><\/p>/);
  assert.match(html, /<h2>County-Issued News Releases and Resulting Coverage<\/h2>/);
  assert.match(html, /<table border="1" cellpadding="6" cellspacing="0">/);
  assert.match(html, /<th scope="col">News release<\/th>/);
  assert.match(html, /<ul><li><a href="https:\/\/example\.com\/a">County approves winter plan<\/a> \(Marin IJ, Oct 2, 2026\)<\/li><\/ul>/);
  assert.ok(!html.includes("Recent Coverage Resulting From Older News Releases"), "hidden sections are left out");
  assert.ok(html.includes("Winter &lt;b&gt;readiness&lt;/b&gt;"), "text is escaped");
  assert.ok(!/<(div|span|script|style)\b|class=|style=/.test(html), "no layout markup, classes, or styles");
  assert.match(html, /<a href="mailto:PIO@marincounty\.gov">PIO@marincounty\.gov<\/a>/);
  assert.match(html, /<p><strong>Know of an upcoming news opportunity/);
});

test("a section with its own text gets no 'nothing to report' line", () => {
  const r = fresh();
  r.sections.find((s) => s.id === "upcoming").intro = "Fair 2027 Theme";
  const html = Render.renderReport(r, { onlySectionId: "upcoming" });
  assert.ok(html.includes("Fair 2027 Theme"));
  assert.ok(!html.includes("<p>None</p>"));
  const text = Render.toPlainText(r);
  const start = text.indexOf("Fair 2027 Theme");
  assert.ok(start > -1);
  const chunk = text.slice(start).split("\n\n")[0];
  assert.ok(!/\nNone$/.test(chunk));
});

test("empty sections say so, and the manual table renders its rows", () => {
  let r = fresh();
  assert.match(Render.renderReport(r), /<p>None<\/p>/);
  r = Core.addToSection(r, "upcoming", Core.newRow({ when: "Oct 14", department: "DPW", topic: "Road work", description: "Lane closures", url: "https://marincounty.gov/dpw" }));
  const html = Render.renderReport(r, { onlySectionId: "upcoming" });
  assert.match(html, /<th scope="col">Tentative date<\/th>/);
  assert.match(html, /<td>Oct 14<\/td><td>DPW<\/td><td><a href="https:\/\/marincounty\.gov\/dpw">Road work<\/a><br>Lane closures<\/td>/);
});

test("one section can be rendered alone, without the title block or footer", () => {
  const r = fresh();
  const html = Render.renderReport(r, { onlySectionId: "opinion" });
  assert.match(html, /^<h2>Opinion Pieces About County-Related Work \/ Priorities<\/h2>/);
  assert.ok(!html.includes("<h1>") && !html.includes("PIO@"));
  const text = Render.toPlainText(r, { onlySectionId: "opinion" });
  assert.ok(text.startsWith("OPINION PIECES") && !text.includes("PIO@"));
});

test("plain text mirrors the report", () => {
  let r = fresh();
  r = Core.addUnplaced(r, Core.snapshotFromMention(mention({ id: "a" }), names));
  r = Core.placeItem(r, r.unplaced[0].uid, "other-coverage");
  r.footer = "Please reach out to PIO@marincounty.gov with details.";
  const text = Render.toPlainText(r);
  assert.match(text, /^County of Marin\nMarin Media Coverage and Outreach Report\nWednesday, September 30, through Tuesday, October 6/);
  assert.match(text, /Oct 2, 2026 \| County approves winter plan \| Marin IJ \| https:\/\/example\.com\/a/);
  assert.match(text, /PIO@marincounty\.gov with details\.$/);
});

test("the standalone document is complete and has no app chrome", () => {
  const html = Render.standaloneHtml(fresh());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Marin Media Coverage and Outreach Report<\/title>/);
  assert.ok(!html.includes("<script"));
  assert.match(html, /<main>[\s\S]*<h1>/);
});

test("custom reports use the same engine with text, highlights, and tables", () => {
  let r = fresh("custom");
  r = Core.updateDetails(r, { title: "Weekly brief", description: "Summary line.\n\nSecond paragraph." });
  r = Core.addSection(r, "text", "Overview");
  r = Core.updateSection(r, r.sections[0].id, { intro: "Hello team." });
  r = Core.addSection(r, "highlights", "Highlights");
  r = Core.addToSection(r, r.sections[1].id, Core.manualCoverage({ date: "2026-10-01", headline: "Big story", source: "Patch", url: "https://patch.com/x", notes: "Why it matters" }));
  const html = Render.renderReport(r);
  assert.match(html, /<h2>Overview<\/h2>\n<p>Hello team\.<\/p>/);
  assert.match(html, /<h2>Highlights<\/h2>\n<ul>/);
  assert.match(html, /Why it matters/);
  assert.match(html, /<p>Summary line\.<\/p>\n<p>Second paragraph\.<\/p>/);
  assert.ok(Core.validateReport(JSON.parse(Core.toJson(r))).ok);
});

test("a Stats section keeps its chosen charts and renders them as plain tables", () => {
  let r = fresh();
  r = Core.addSection(r, "stats", "Campaign numbers");
  const id = r.sections[r.sections.length - 1].id;
  assert.deepEqual(r.sections.at(-1).charts, ["totals", "timeline", "monitors", "sources"]);
  r = Core.updateSection(r, id, {
    charts: ["totals", "sources", "bogus"],
    stats: {
      basis: "Mentions from Oct 1 to Oct 7 · All monitors",
      totals: { mentions: 12, sources: 5, social: 2 },
      tables: { sources: [["KRON4 <b>", 7], ["Marin IJ", 3]], monitors: [["Topics", 9]] },
    },
  });
  assert.deepEqual(Core.findSection(r, id).charts, ["totals", "sources"]);
  const html = Render.renderReport(r, { onlySectionId: id });
  assert.match(html, /<h3>Totals<\/h3>/);
  assert.match(html, /<td>Mentions<\/td><td>12<\/td>/);
  assert.match(html, /<td>KRON4 &lt;b&gt;<\/td><td>7<\/td>/);
  assert.ok(!html.includes("Top monitors"), "unchecked charts stay out");
  assert.ok(!/<(div|span|script|canvas)\b|class=|style=/.test(html));
  assert.match(Render.toPlainText(r, { onlySectionId: id }), /Top news sources\n {2}KRON4 <b>: 7/);
  const again = Core.parseJson(Core.toJson(r));
  assert.ok(again.ok, again.errors.join());
  assert.deepEqual(Core.findSection(again.report, id).stats.totals, { mentions: 12, sources: 5, social: 2 });
});

test("a Stats section with no numbers says so", () => {
  const r = Core.addSection(fresh(), "stats", "");
  const html = Render.renderReport(r, { onlySectionId: r.sections.at(-1).id });
  assert.match(html, /<p>None<\/p>/);
});

test("uid never uses Math.random and stays unique with or without browser crypto", () => {
  const originalRandom = Math.random;
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const setCrypto = (value) => Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
  Math.random = () => { throw new Error("Math.random must not be used for ids"); };
  try {
    setCrypto({ getRandomValues: (array) => { array.fill(7); return array; } });
    const withCrypto = new Set(Array.from({ length: 50 }, () => Core.uid("c")));
    setCrypto(undefined);
    const without = new Set(Array.from({ length: 50 }, () => Core.uid("c")));
    assert.equal(withCrypto.size, 50);
    assert.equal(without.size, 50);
    assert.ok([...without].every((id) => id.startsWith("c")));
  } finally {
    Math.random = originalRandom;
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else delete globalThis.crypto;
  }
});
