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

// Matches build/index.js's PRUNE_DAYS — no reason to spend a request
// fetching (and making match.js filter through) posts older than what the
// build keeps anyway.
const SINCE_DAYS = 60;

// searchPosts' actual max page size (verified live 2026-09-23: limit=100
// returns 100 posts with a cursor, same one request as limit=25 would've
// been) — a straight 4x recall increase per term for zero added requests,
// the highest-leverage lever before resorting to more requests via
// pagination.
const PAGE_LIMIT = 100;

// Terms broad enough that even a full 100-result page plausibly caps out
// before match.js's real AND/exclude matching even runs — worth a second
// page for. Kept small and explicit rather than paginating every term,
// which would double the total request count (130+ -> 260+) and
// reintroduce the rate-limit risk the batching above already addresses.
const PAGINATE_TERMS = new Set(["Marin County"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function searchUrl(term, cursor) {
  const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({ q: term, limit: String(PAGE_LIMIT), sort: "latest", since });
  if (cursor) params.set("cursor", cursor);
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchInBatches(terms) {
  const entries = [];
  for (let i = 0; i < terms.length; i += CONCURRENCY) {
    const batch = terms.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map((term) => fetchJson(searchUrl(term))));
    batchResults.forEach((result, index) => entries.push({ term: batch[index], result }));
    if (i + CONCURRENCY < terms.length) await sleep(BATCH_DELAY_MS);
  }

  // A second page for PAGINATE_TERMS only, run sequentially after the main
  // batch pass — the cursor isn't known until each term's first page comes
  // back, so this can't be folded into the batching above.
  for (const { term, result } of entries.slice()) {
    if (result.status !== "fulfilled" || !PAGINATE_TERMS.has(term) || !result.value.cursor) continue;
    try {
      const page2 = await fetchJson(searchUrl(term, result.value.cursor));
      entries.push({ term, result: { status: "fulfilled", value: page2 } });
    } catch {
      // A failed second page just means less recall for this one term —
      // isolated the same way a single failed first-page request already
      // is, not a reason to fail the whole source.
    }
  }

  return entries.map(({ result }) => result);
}

/**
 * Bluesky's public AppView exposes app.bsky.feed.searchPosts without
 * authentication for public post search — no API key/app password needed
 * for the MVP's read-only monitoring use case. One page of up to PAGE_LIMIT
 * results per term per refresh, since-scoped to SINCE_DAYS, with a second
 * page for PAGINATE_TERMS specifically (see searchInBatches above) rather
 * than blanket pagination.
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
