"use strict";

const { fetchJson } = require("../http");

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const SEARCH_URL = "https://oauth.reddit.com/search";

const SUBREDDITS = ["bayarea", "sanfrancisco", "Marin", "oakland", "berkeley", "SanJose"];

/**
 * Reddit's free API tier (as of this writing) requires an OAuth app and
 * caps free/non-commercial use at 100 queries/minute per OAuth client —
 * workable for one low-frequency poll every 10-15 minutes, but Reddit's
 * terms require a paid contract for higher-volume or commercial use. This
 * connector is disabled by default (see config/sources.yaml) and only
 * activates when REDDIT_ENABLED=true plus REDDIT_CLIENT_ID/SECRET are set.
 */
async function fetchRedditSource(source, { monitors, clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "MarinMentions/1.0",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenResponse.ok) throw new Error(`Reddit auth failed: HTTP ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();

  // Flatten compound AND-clause entries (an array of phrases — see
  // match.js) into individual candidate terms; build/match.js is what
  // actually enforces the AND requirement on the results afterward.
  const terms = Array.from(new Set(monitors.flatMap((monitor) => monitor.include || []).flat()));
  const restrict = `(subreddit:${SUBREDDITS.join(" OR subreddit:")})`;
  const items = [];

  for (const term of terms) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(`"${term}" ${restrict}`)}&sort=new&limit=25`;
    const response = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    for (const child of response?.data?.children || []) {
      const post = child.data;
      items.push({
        title: post.title,
        link: `https://www.reddit.com${post.permalink}`,
        description: post.selftext,
        publishedAt: new Date(post.created_utc * 1000).toISOString(),
        author: post.author,
        image: post.thumbnail?.startsWith("http") ? post.thumbnail : undefined,
        sourceId: source.id,
        sourceName: `r/${post.subreddit}`,
        sourceMethod: "reddit",
        region: source.region,
        _contentId: post.id,
      });
    }
  }
  return { items };
}

module.exports = { fetchRedditSource };
