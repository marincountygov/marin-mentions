"use strict";

const crypto = require("crypto");

const NAMED_HTML_ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (entity, body) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    return NAMED_HTML_ENTITIES[body] ?? entity;
  });
}

// Jetpack/WordPress.com's default RSS template appends this to every
// excerpt; it's boilerplate, not part of the story.
const WORDPRESS_APPEARED_FIRST_ON = /\s*The post .* appeared first on .*?\.\s*$/;

function cleanText(text) {
  return decodeEntities(text).replace(WORDPRESS_APPEARED_FIRST_ON, "").replace(/\s+/g, " ").trim();
}

/** Google News appends " - <Outlet Name>" to every item title; strip it so
 * the title matches what the publisher itself would show, since the outlet
 * is already shown separately as the source badge. */
function stripGoogleNewsSuffix(title, sourceName) {
  if (!sourceName) return title;
  const suffix = ` - ${sourceName}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableId(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

const SOURCE_TYPE_BY_METHOD = {
  rss: "news",
  "google-news": "news",
  youtube: "video",
  bluesky: "social",
  reddit: "social",
  nextdoor: "social",
};

/**
 * Normalize a raw connector item into the common MediaItem shape.
 *
 * MediaItem = {
 *   id, platform, source, sourceType, title, text, author, url, image,
 *   publishedAt, matchedTerms: [], matchedMonitors: [], sourceMethod,
 * }
 *
 * matchedTerms/matchedMonitors are filled in by build/match.js — every item
 * starts with them empty.
 */
function normalizeItem(raw) {
  const title = cleanText(
    raw.sourceMethod === "google-news" ? stripGoogleNewsSuffix(raw.title, raw.sourceName) : raw.title
  );
  const publishedAt = toIsoDate(raw.publishedAt) || new Date().toISOString();

  return {
    id: stableId(raw.link),
    platform: raw.platform || raw.sourceMethod,
    source: raw.sourceName,
    sourceId: raw.sourceId,
    sourceType: SOURCE_TYPE_BY_METHOD[raw.sourceMethod] || "news",
    title,
    text: cleanText(raw.description),
    author: raw.author,
    handle: raw._authorHandle,
    url: raw.link,
    image: raw.image,
    publishedAt,
    matchedTerms: [],
    matchedMonitors: [],
    sourceMethod: raw.sourceMethod,
    engagement: raw._engagement,
    // Reddit only: "post" or "comment", and the t3_<id> of the post itself
    // (a comment's own permalink always contains its parent post's id, even
    // if that post has since aged out of the connector's own feed window —
    // see build/connectors/reddit.js). undefined for every other source.
    redditType: raw.redditType,
    redditPostId: raw.redditPostId,
    // The outlet's own homepage (not the specific article) — e.g.
    // "https://www.kqed.org" — so the UI can link a card's source name to
    // where that outlet actually lives, not just the article/feed URL.
    // For direct RSS this is derived from the article URL's own host; for
    // Google News, raw.sourceUrl already gives us the real publisher
    // domain via the <source url> element (see connectors/google-news.js).
    sourceUrl: raw.sourceUrl || (hostnameOf(raw.link) ? `https://${hostnameOf(raw.link)}` : undefined),
    // Carried through for dedupe only; stripped before writing final output.
    _contentId: raw._contentId,
  };
}

function hostnameOf(url) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

module.exports = { normalizeItem, cleanText, hostnameOf, stableId };
