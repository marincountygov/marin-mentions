"use strict";

// Generates static RSS 2.0 files from the same matched/deduped/pruned item
// list that becomes data.json — no separate fetch or matching logic, so a
// feed can never disagree with the console about what matched.
//
// This exists because marin-mentions has no server: an RSS reader fetches a
// URL and parses XML, it doesn't run assets/app.js, so "RSS for the current
// filters" can only mean one of a finite set of files built in advance, not
// an arbitrary client-side filter combination. Scope is monitors (a fixed,
// named, config-defined list) and content type (mirroring the UI's
// All/News/Video/Social/Official tabs) — not sources, search text, or
// multi-monitor selections, which are combinatorial and stay unsupported
// (assets/app.js disables the RSS button for those rather than guessing).

const fs = require("fs");
const path = require("path");

const SITE_URL = "https://marincountygov.github.io/marin-mentions/";

// Matches the UI's content-type tabs (index.html's data-content-type
// buttons) minus "all", which is handled separately below as the combined
// feed. "official" is cross-cutting (an item's source is official,
// independent of its sourceType) — see assets/app.js's
// computeOfficialSourceIds() and its own comment on why this can't be a
// plain sourceType check.
const CONTENT_TYPES = ["news", "video", "social", "official"];

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// RSS 2.0 requires an RFC 822 pubDate; Date#toUTCString() produces the
// equivalent RFC 7231 form ("Fri, 26 Sep 2026 15:36:15 GMT"), which every
// feed reader accepts — the same trick used across the RSS ecosystem to
// avoid hand-formatting dates. Falls back to the epoch on an unparseable
// date rather than emitting an invalid <pubDate> that could break a strict
// reader.
function rfc822(dateString) {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

function itemXml(item) {
  const description = item.text && item.text !== item.title ? item.text : item.title || "";
  return (
    "<item>" +
    `<title>${escapeXml(item.title || item.source || "Untitled")}</title>` +
    `<link>${escapeXml(item.url)}</link>` +
    `<guid isPermaLink="false">${escapeXml(item.id)}</guid>` +
    `<pubDate>${rfc822(item.publishedAt)}</pubDate>` +
    `<description>${escapeXml(description)}</description>` +
    "</item>"
  );
}

function channelXml({ title, description, link, items }) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    `<title>${escapeXml(title)}</title>` +
    `<link>${escapeXml(link)}</link>` +
    `<description>${escapeXml(description)}</description>` +
    items.map(itemXml).join("") +
    "</channel></rss>"
  );
}

// Not a general XML validator — this module only ever emits the fixed
// vocabulary of tags above, so a plain open/close count per tag name is
// enough to catch a real bug (an unescaped character breaking the
// structure, a template string typo) without a parsing dependency. Fails
// the build loudly, matching build/index.js's assertSocialClassification().
function assertWellFormed(xml, label) {
  for (const tag of ["rss", "channel", "item", "title", "link", "guid", "pubDate", "description"]) {
    const opens = (xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")) || []).length;
    const closes = (xml.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (opens !== closes) {
      throw new Error(`feeds: "${label}" produced malformed XML — <${tag}> opens=${opens} closes=${closes}`);
    }
  }
}

/** items: the same pruned/deduped list written to data.json.
 *  monitors: the same monitors list written to data.json.
 *  officialSourceIds: Set of source ids with official: true — build/index.js
 *  already computes this for matchItems(); reused here instead of
 *  recomputing, so the two can't drift apart.
 *  outDir: directory to write into (created if missing).
 *  Returns [{ filename, count }] for the caller to log. */
function buildFeeds({ items, monitors, officialSourceIds, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  function writeFeed(filename, title, description, feedItems) {
    const xml = channelXml({ title, description, link: SITE_URL, items: feedItems });
    assertWellFormed(xml, filename);
    fs.writeFileSync(path.join(outDir, filename), xml);
    results.push({ filename, count: feedItems.length });
  }

  writeFeed("all.xml", "Marin Mentions — All", "All mentions tracked by Marin Mentions.", items);

  for (const type of CONTENT_TYPES) {
    const typeItems =
      type === "official"
        ? items.filter((item) => officialSourceIds.has(item.sourceId))
        : items.filter((item) => item.sourceType === type);
    writeFeed(
      `type-${type}.xml`,
      `Marin Mentions — ${capitalize(type)}`,
      `${capitalize(type)} mentions tracked by Marin Mentions.`,
      typeItems
    );
  }

  for (const monitor of monitors) {
    const monitorItems = items.filter((item) => (item.matchedMonitors || []).includes(monitor.id));
    writeFeed(
      `monitor-${monitor.id}.xml`,
      `Marin Mentions — ${monitor.name}`,
      `Mentions matching the "${monitor.name}" monitor.`,
      monitorItems
    );
  }

  return results;
}

module.exports = { buildFeeds, escapeXml, rfc822, assertWellFormed };
