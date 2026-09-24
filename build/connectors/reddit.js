"use strict";

const { XMLParser } = require("fast-xml-parser");
const { USER_AGENT, DEFAULT_TIMEOUT_MS } = require("../http");
const { stripHtml } = require("./rss");
const { cleanText } = require("../normalize");

const SUBREDDITS = [
  "bayarea",
  "sanfrancisco",
  "Marin",
  "oakland",
  "berkeley",
  "SanJose",
  "Novato",
  "MillValley",
  "SanRafael",
];
const MULTI_PATH = `r/${SUBREDDITS.join("+")}`;
const PAGE_LIMIT = 100;

// Reddit's anonymous feed endpoints rate-limit hard and immediately
// (confirmed live: x-ratelimit-remaining hits 0.0 after a single request).
// A fixed delay isn't reliable — x-ratelimit-reset varied 7-49s across
// testing, and a flat 20s still produced a real 429 in an isolated test.
// Read the reset value Reddit itself reports and wait at least that long
// (clamped) before the second request, instead of guessing.
const MIN_FEED_DELAY_MS = 20_000;
const MAX_FEED_DELAY_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feedUrl(kind) {
  return `https://www.reddit.com/${MULTI_PATH}/${kind}/.rss?limit=${PAGE_LIMIT}`;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

// Reddit wraps a link/image submission's Atom <content> in a fixed table:
// thumbnail, then "submitted by /u/X to r/Y [link] [comments]" — boilerplate
// for every link post, not real content. Strip it (after HTML-tag removal)
// so it doesn't pollute match.js's text matching or a card's shown snippet.
// A genuine self-post's body sits right alongside this same wrapper, so this
// only removes the known Reddit-generated phrase, not the whole content.
const SUBMITTED_BY_BOILERPLATE = /\s*submitted by\s*\/u\/\S+\s*to\s*r\/\S+\s*(\[link\]\s*)?(\[comments\]\s*)?/gi;

function cleanPostContent(html) {
  // cleanText() decodes the HTML entities (Reddit's feed leaves "&#32;" etc.
  // as literal text after tag-stripping, not real whitespace) — has to run
  // before the boilerplate regex, which matches on real spaces.
  return cleanText(stripHtml(html)).replace(SUBMITTED_BY_BOILERPLATE, " ").replace(/\s+/g, " ").trim();
}

// A comment's permalink always contains its parent post's id, even when
// that post has since aged out of /new/.rss's own window — no fixed-length
// assumption, since Reddit lengthened/randomized comment (and post) ids in
// May 2026 (up to 13 base-36 chars, no longer monotonically increasing).
function postIdFromPermalink(link) {
  const match = /\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(link || "");
  return match ? `t3_${match[1]}` : null;
}

function parseEntries(xml) {
  const doc = parser.parse(xml);
  const entries = doc?.feed?.entry;
  if (!entries) return [];
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map((entry) => ({
    id: textOf(entry.id),
    link: entry.link?.["@_href"] || "",
    title: textOf(entry.title),
    content: textOf(entry.content),
    author: textOf(entry.author?.name).replace(/^\/u\//, ""),
    subreddit: entry.category?.["@_label"] || entry.category?.["@_term"] || "",
    publishedAt: textOf(entry.updated) || textOf(entry.published),
  }));
}

function toItem(entry, source) {
  const isComment = entry.id.startsWith("t1_");
  const isPost = entry.id.startsWith("t3_");
  if (!isComment && !isPost) return null;

  return {
    title: entry.title,
    link: entry.link,
    description: isPost ? cleanPostContent(entry.content) : stripHtml(entry.content),
    publishedAt: entry.publishedAt,
    author: entry.author,
    sourceId: source.id,
    sourceName: entry.subreddit || "Reddit",
    sourceMethod: "reddit",
    region: source.region,
    _contentId: entry.id,
    redditPostId: isPost ? entry.id : postIdFromPermalink(entry.link),
    redditType: isPost ? "post" : "comment",
  };
}

/**
 * Reddit's public per-subreddit Atom feeds, combined across all configured
 * subreddits via Reddit's own "r/a+b+c" multi-subreddit syntax — no OAuth,
 * no API key, no bot account. Posts (/new/.rss) and comments (/comments/.rss)
 * each need just one request total (not one per subreddit, not one per
 * monitor term), since match.js re-checks the real include/exclude phrases
 * against every entry's actual title/text afterward — same broad-fetch/
 * strict-match split every other connector already uses.
 */
// A plain fetchText() call (build/http.js) doesn't expose response headers,
// and reading x-ratelimit-reset needs them — so this talks to fetch()
// directly rather than going through that shared helper, reusing its same
// User-Agent/timeout conventions.
async function fetchFeedWithReset(kind) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl(kind), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml, application/xml, text/xml" },
    });
    const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return { xml: await response.text(), resetSeconds: Number.isFinite(resetSeconds) ? resetSeconds : null };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFeed(kind) {
  return fetchFeedWithReset(kind).then(
    (result) => ({ status: "fulfilled", value: result.xml, resetSeconds: result.resetSeconds }),
    (error) => ({ status: "rejected", reason: error })
  );
}

async function fetchRedditSource(source) {
  const postsResult = await fetchFeed("new");

  const resetMs = postsResult.resetSeconds != null ? postsResult.resetSeconds * 1000 : MIN_FEED_DELAY_MS;
  await sleep(Math.min(Math.max(resetMs, MIN_FEED_DELAY_MS), MAX_FEED_DELAY_MS));

  const commentsResult = await fetchFeed("comments");

  if (postsResult.status !== "fulfilled" && commentsResult.status !== "fulfilled") {
    throw new Error(postsResult.reason?.message || commentsResult.reason?.message || "both Reddit feeds failed");
  }

  const entries = [
    ...(postsResult.status === "fulfilled" ? parseEntries(postsResult.value) : []),
    ...(commentsResult.status === "fulfilled" ? parseEntries(commentsResult.value) : []),
  ];

  const items = entries.map((entry) => toItem(entry, source)).filter(Boolean);
  return { items };
}

module.exports = { fetchRedditSource };
