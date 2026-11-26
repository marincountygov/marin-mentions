"use strict";

const { fetchText } = require("../http");
const { parseFeed } = require("./rss");
const { stripPublisherName } = require("../attribution");

const BASE_URL = "https://news.google.com/rss/search";

// Google News indexes auto-generated data pages alongside real editorial
// coverage — e.g. IQAir publishes a templated "<City>, Marin County air
// quality map" page for every town, which matches any monitor whose phrase
// is a place name even though it's not news. Filtered by the Google News
// <source> outlet name (case-insensitive), not by title/content, since
// that's the more stable signal and protects every monitor at once rather
// than needing an exclude phrase repeated on each one. Add another name
// here if a similar non-editorial aggregator turns up.
const EXCLUDED_SOURCE_NAMES = new Set(["iqair"]);

/**
 * Fetch a Google News RSS search. Note: Google News item <link> values are
 * redirect URLs (news.google.com/rss/articles/...) that resolve to the real
 * publisher article only via client-side JS in a browser — there is no
 * static HTTP redirect to follow server-side, so we cannot recover the
 * canonical publisher URL here. Dedup against direct-RSS items therefore
 * falls back to matching normalized title + the <source> outlet name that
 * Google News includes with each item (see build/dedupe.js), and the
 * "Read story" link for these items points at the Google redirect page,
 * which does resolve correctly for a human clicking it in a browser.
 *
 * @param {{id: string, name: string, query: string, region?: string}} source
 */
async function fetchGoogleNewsSource(source) {
  const url = `${BASE_URL}?q=${encodeURIComponent(source.query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(url, { accept: "application/rss+xml, application/xml, text/xml" });
  const items = parseFeed(xml);
  return {
    items: items
      .filter((item) => item.link)
      .filter((item) => !EXCLUDED_SOURCE_NAMES.has(String(item.sourceName || "").trim().toLowerCase()))
      .map((item) => ({
        ...item,
        // The publisher's name Google News adds to the end of the text is not part of the story (build/attribution.js).
        description: stripPublisherName(item.description, item.sourceName || source.name),
        sourceId: source.id,
        sourceName: item.sourceName || source.name,
        sourceMethod: "google-news",
        region: source.region,
      })),
  };
}

module.exports = { fetchGoogleNewsSource };
