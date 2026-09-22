"use strict";

const { fetchJson, fetchText } = require("../http");
const { parseFeed } = require("./rss");

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const CHANNEL_FEED_URL = "https://www.youtube.com/feeds/videos.xml";

/**
 * YouTube Data API v3 quota costs: search.list = 100 units, videos.list /
 * playlistItems.list = 1 unit. The default daily quota is 10,000 units.
 *
 * To stay well inside that on a single search.list call per refresh, build
 * ONE combined query across every monitor's primary phrase (YouTube's `q`
 * supports `|` as OR between terms) instead of one search per monitor —
 * build/match.js re-checks the real include/exclude phrases against the
 * returned title+description afterward, so an overly-broad YouTube-side
 * query just means a few extra discarded results, not false positives.
 *
 * Channel-based monitoring does NOT use this API at all — see
 * fetchYoutubeChannelRssSource below, which uses YouTube's free per-channel
 * RSS feed instead, so it costs zero quota regardless of refresh frequency.
 */
async function fetchYoutubeSource(source, { monitors, apiKey }) {
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }

  // Flatten compound AND-clause entries (an array of phrases — see
  // match.js) into individual candidate terms; build/match.js is what
  // actually enforces the AND requirement on the results afterward. Strip
  // the "word:" whole-word-match prefix (match.js-only syntax) — left on,
  // it would search YouTube for the literal text "word:fire" instead of
  // "fire", silently losing recall for every monitor that uses it.
  const terms = monitors
    .flatMap((monitor) => monitor.include || [])
    .flat()
    .map((term) => term.replace(/^word:/, ""));
  if (terms.length === 0) return { items: [] };

  const query = Array.from(new Set(terms)).map((term) => `"${term}"`).join("|");
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const searchUrl =
    `${SEARCH_URL}?part=snippet&type=video&order=date&maxResults=25` +
    `&q=${encodeURIComponent(query)}&publishedAfter=${publishedAfter}&key=${apiKey}`;
  const search = await fetchJson(searchUrl);
  const videoIds = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
  if (videoIds.length === 0) return { items: [] };

  // One extra 1-unit call to get accurate durations/stats isn't needed for
  // the MVP fields (title/description/thumbnail/publishedAt already come
  // back from search.list) — skip videos.list entirely to save quota.
  return {
    items: search.items.map((item) => ({
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
    })),
  };
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
