"use strict";

const { fetchJson, fetchText } = require("../http");
const { parseFeed } = require("./rss");

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const CHANNEL_FEED_URL = "https://www.youtube.com/feeds/videos.xml";

// YouTube Data API v3 quota costs: search.list = 100 units, videos.list /
// playlistItems.list = 1 unit. Default daily quota: 10,000 units.
//
// One search.list call per term below, not one combined OR query. That was
// the original design (build ONE "term1"|"term2"|... query across every
// monitor phrase) but live testing (2026-09-24) found a real bug in it: any
// single quoted phrase alone works fine, but as soon as a phrase that would
// return zero results on its own (e.g. the exact phrase "Marin Board of
// Supervisors" — no video used it verbatim in 30 days) gets OR'd with
// *anything else*, quoted or not, the entire combined result set collapses
// to items: [] even though pageInfo.totalResults stays nonzero — confirmed
// reproducible, not flaky, and confirmed to be that one phrase specifically
// (every pairing that included it broke; pairings that didn't, worked).
// There's no reliable way to know in advance which future monitor phrase
// might trigger this, so the fix is to never combine terms via OR at all.
//
// That makes quota the real constraint: 100 units × N terms × refreshes/day
// has to stay under 10,000. YOUTUBE_SEARCH_TERMS below is a small curated
// set (driven by monitors.yaml's youtubeSearch: true flag, not all ~130
// monitor phrases) paired with a 3-hour refresh interval (sources.yaml) —
// 10 terms × 100 units × 8 refreshes/day = 8,000/day, leaving headroom.
//
// Channel-based monitoring does NOT use this API at all — see
// fetchYoutubeChannelRssSource below, which uses YouTube's free per-channel
// RSS feed instead, so it costs zero quota regardless of refresh frequency.
async function fetchYoutubeSource(source, { monitors, apiKey }) {
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }

  // Each flagged monitor's first include entry — stripped of the "word:"
  // whole-word-match prefix (match.js-only syntax), and the first phrase if
  // it's an AND-clause array — as one unquoted search term. Unquoted, not
  // quoted: it returned real results even for the one phrase that broke
  // when OR'd, and build/match.js re-verifies the actual required phrase
  // against each result's real title/description afterward regardless, so
  // there's no correctness reason to risk YouTube's exact-phrase quoting.
  const terms = monitors
    .filter((monitor) => monitor.youtubeSearch)
    .map((monitor) => {
      const first = (monitor.include || [])[0];
      const phrase = Array.isArray(first) ? first[0] : first;
      return phrase?.replace(/^word:/, "");
    })
    .filter(Boolean);
  if (terms.length === 0) return { items: [] };

  const publishedAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const items = [];

  for (const term of terms) {
    const searchUrl =
      `${SEARCH_URL}?part=snippet&type=video&order=date&maxResults=25` +
      `&q=${encodeURIComponent(term)}&publishedAfter=${publishedAfter}&key=${apiKey}`;
    // Isolated per term — one bad/rejected term should only lose that
    // term's results, never zero out every other term's (the exact failure
    // mode this rewrite exists to fix).
    const search = await fetchJson(searchUrl).catch(() => null);
    for (const item of search?.items || []) {
      if (!item.id?.videoId) continue;
      items.push({
        title: item.snippet.title,
        link: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        image: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        author: item.snippet.channelTitle,
        sourceId: source.id,
        sourceName: item.snippet.channelTitle,
        sourceMethod: "youtube",
        region: source.region,
        _contentId: item.id.videoId,
      });
    }
  }

  return { items };
}

/**
 * Fetch a channel's own video feed — a plain Atom feed at a fixed URL, no
 * API key, no quota. This is how "selected channels" monitoring is
 * implemented; it never calls the Data API.
 * @param {{id: string, name: string, channelId: string, region?: string}} source
 */
async function fetchYoutubeChannelRssSource(source) {
  const url = `${CHANNEL_FEED_URL}?channel_id=${encodeURIComponent(source.channelId)}`;
  const xml = await fetchText(url, { accept: "application/atom+xml, application/xml, text/xml" });
  const items = parseFeed(xml);
  return {
    items: items
      .filter((item) => item.link)
      .map((item) => ({
        ...item,
        sourceId: source.id,
        sourceName: source.name,
        sourceMethod: "youtube",
        region: source.region,
      })),
  };
}

module.exports = { fetchYoutubeSource, fetchYoutubeChannelRssSource };
