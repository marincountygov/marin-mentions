"use strict";

// Drops items whose title contains a phrase from config/exclude.yaml.

function filterExcludedTitles(items, phrases) {
  const needles = (phrases || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return items;
  return items.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    return !needles.some((needle) => title.includes(needle));
  });
}

/**
 * Per-source title exclusions: a source in config/sources.yaml may list `excludeTitles`, phrases that leave out that source's
 * own stories (any case) and no one else's. Use it where a phrase would be wrong for every source (a team name left out of a
 * local paper's feed but kept in a story from a county office). A phrase matches whole words only, so "NFL" does not match
 * "Inflation" (the global list in config/exclude.yaml matches inside words, as its phrases are long enough not to need this).
 */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, "iu");

function filterExcludedTitlesBySource(items, sources) {
  const bySource = new Map();
  for (const source of sources || []) {
    const needles = (source.excludeTitles || []).map((p) => String(p).trim()).filter(Boolean).map(wholeWord);
    if (needles.length) bySource.set(source.id, needles);
  }
  if (bySource.size === 0) return items;
  return items.filter((item) => {
    const needles = bySource.get(item.sourceId);
    if (!needles) return true;
    const title = String(item.title || "");
    return !needles.some((needle) => needle.test(title));
  });
}

module.exports = { filterExcludedTitles, filterExcludedTitlesBySource };
