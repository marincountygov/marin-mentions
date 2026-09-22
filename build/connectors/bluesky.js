"use strict";

const { fetchJson } = require("../http");

// api.bsky.app is the AppView host that actually serves unauthenticated
// searchPosts right now (verified 2026-09-18 by direct request: 200 with
// real results). public.api.bsky.app — this connector's original host —
// returned 403 from every network path tested, apparently blocked by
// bot-protection rather than a real authentication requirement; it is
// NOT that unauthenticated search itself now requires auth (a claim found
// while researching this, but contradicted by api.bsky.app working fine
// unauthenticated). If this connector starts failing again, re-check both
// hosts directly before assuming auth is now required.
//
// Update (2026-09-22): a likely contributor to those 403s, found while
// debugging sparse social results — this connector fired one request PER
// monitor include-phrase (130+) via Promise.allSettled all at once, a
// burst plausible enough to trip rate-limiting on its own regardless of
// bot-protection. Now batched (see CONCURRENCY/BATCH_DELAY_MS below).
// Separately, even a fully successful fetch naturally yields few final
// matches: searchPosts is a loose/relevance search, not exact-phrase — most
// raw results don't contain the literal monitored phrase at all, and
// build/match.js's strict substring/AND matching correctly discards those.
// That's this connector working as designed against noisy upstream input,
// not a bug to fix here.
const SEARCH_URL = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";

// How many searchPosts calls run at once, and the pause between batches —
// keeps this connector from firing 130+ simultaneous requests at a public,
// presumably rate-limited endpoint in one burst.
const CONCURRENCY = 8;
const BATCH_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchInBatches(terms) {
  const results = [];
  for (let i = 0; i < terms.length; i += CONCURRENCY) {
    const batch = terms.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((term) => fetchJson(`${SEARCH_URL}?q=${encodeURIComponent(term)}&limit=25&sort=latest`))
    );
    results.push(...batchResults);
    if (i + CONCURRENCY < terms.length) await sleep(BATCH_DELAY_MS);
  }
  return results;
}

/**
 * Bluesky's public AppView exposes app.bsky.feed.searchPosts without
 * authentication for public post search — no API key/app password needed
 * for the MVP's read-only monitoring use case. No pagination (cursor) is
 * implemented — one page of up to 25 results per term per refresh, which
 * matches the plan's "don't overbuild" guidance; revisit if that proves
 * too shallow in practice.
 */
async function fetchBlueskySource(source, { monitors }) {
  // A monitor's include list can mix plain phrases with compound AND
  // clauses (an array of phrases — see match.js). For an upstream search
  // query we want each phrase as its own candidate term; match.js is what
  // actually enforces the AND requirement afterward, so widening here
  // just means a few more candidates get checked, not false positives.
  // Strip the "word:" whole-word-match prefix (match.js-only syntax) —
  // left on, it would search Bluesky for the literal text "word:fire"
  // instead of "fire", silently losing recall for every monitor that uses
  // it (see the identical fix in youtube.js).
  const terms = Array.from(
    new Set(
      monitors
        .flatMap((monitor) => monitor.include || [])
        .flat()
        .map((term) => term.replace(/^word:/, ""))
    )
  );
  if (terms.length === 0) return { items: [] };

  const results = await searchInBatches(terms);

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length === results.length) {
    throw new Error(failures[0].reason?.message || "all Bluesky searches failed");
  }

  const items = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const post of result.value.posts || []) {
      const handle = post.author?.handle;
      const rkey = post.uri?.split("/").pop();
      items.push({
        title: undefined,
        link: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : post.uri,
        description: post.record?.text,
        publishedAt: post.record?.createdAt,
        author: post.author?.displayName || handle,
        image: post.embed?.images?.[0]?.thumb,
        sourceId: source.id,
        sourceName: "Bluesky",
        sourceMethod: "bluesky",
        region: source.region,
        _contentId: post.uri,
        _engagement: {
          likes: post.likeCount,
          reposts: post.repostCount,
          replies: post.replyCount,
        },
        _authorHandle: handle,
      });
    }
  }
  return { items };
}

module.exports = { fetchBlueskySource };
