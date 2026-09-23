"use strict";

const { normalizeForMatch } = require("./match");
const { hostnameOf } = require("./normalize");

// Lower number = kept over a higher number when the same story collides.
// google-news is lowest priority because its link is a redirect, never the
// canonical publisher URL — direct RSS (or a platform API) is always the
// better link to show, per the plan's "prefer the direct KQED result" rule.
const METHOD_PRIORITY = { rss: 0, youtube: 0, bluesky: 0, reddit: 0, nextdoor: 0, "google-news": 1 };

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    parsed.hash = "";
    const params = new URLSearchParams(parsed.search);
    for (const key of Array.from(params.keys())) {
      if (/^utm_|^fbclid$|^gclid$|^oc$/.test(key)) params.delete(key);
    }
    const sortedParams = new URLSearchParams(Array.from(params.entries()).sort());
    const query = sortedParams.toString();
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

function dedupeKeys(item) {
  const keys = [];
  // 1. canonical/normalized URL — real publisher links only; a Google News
  //    redirect link can't be trusted as canonical (see google-news.js).
  if (item.sourceMethod !== "google-news") {
    keys.push(`url:${normalizeUrl(item.url)}`);
  }
  // 2. platform/content ID, when a connector provides one (YouTube video ID,
  //    Bluesky post URI).
  if (item._contentId) {
    keys.push(`content:${item.platform}:${item._contentId}`);
  }
  // 3. source domain + normalized title — catches "same story, direct RSS
  //    vs. Google News" pairs, since we can't resolve the Google News link.
  // 4. normalized title + publish date alone, as a last resort.
  // Both need a real title to mean anything — an item with no title (every
  // Bluesky post; normalizeItem() coerces title: undefined to "") produces
  // the *same* key as every other title-less item sharing that domain (key
  // 3, not even date-scoped) or that day (key 4), so the first one "claims"
  // the key and every later one is wrongly treated as its duplicate. This
  // was collapsing Bluesky's results to effectively one surviving item
  // across the whole retained window — confirmed directly, not inferred.
  // Skip a key entirely rather than build it from an empty title; a
  // title-less item is already correctly deduplicated by keys 1 (URL) and
  // 2 (content ID), both of which every real post has.
  const normalizedTitle = normalizeForMatch(item.title);
  if (normalizedTitle) {
    const sourceDomain = hostnameOf(item.sourceUrl);
    if (sourceDomain) keys.push(`domain-title:${sourceDomain}:${normalizedTitle}`);
    const day = (item.publishedAt || "").slice(0, 10);
    keys.push(`title-day:${normalizedTitle}:${day}`);
  }
  return keys;
}

/** Deduplicate items in place, preferring direct RSS/API results over
 * Google News when the same story appears from both. Returns a new array;
 * does not mutate the input. */
function dedupeItems(items) {
  const sorted = [...items].sort(
    (a, b) => (METHOD_PRIORITY[a.sourceMethod] ?? 0) - (METHOD_PRIORITY[b.sourceMethod] ?? 0)
  );
  const seenKeys = new Set();
  const kept = [];

  for (const item of sorted) {
    const keys = dedupeKeys(item);
    if (keys.some((key) => seenKeys.has(key))) continue;
    keys.forEach((key) => seenKeys.add(key));
    kept.push(item);
  }

  return kept;
}

module.exports = { dedupeItems, normalizeUrl, dedupeKeys };
