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

module.exports = { filterExcludedTitles };
