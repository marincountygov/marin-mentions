"use strict";

const { fetchJson } = require("../http");

// Same public, unauthenticated AppView host as build/connectors/bluesky.js
// (verified working for this endpoint too — 2026-09-24, real posts back for
// a real handle). getAuthorFeed is a different endpoint from searchPosts:
// it returns one account's own timeline directly, not a keyword search, so
// there's no query/term concept here at all — one account, one feed.
const AUTHOR_FEED_URL = "https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const PAGE_LIMIT = 25;

/**
 * An official account's own Bluesky posts, not a keyword search — for
 * sources with official: true in sources.yaml (see config/sources.yaml's
 * "handle" field). build/index.js's assertSocialClassification and
 * build/match.js's official-source bypass are what make this source's
 * posts show up regardless of whether they happen to contain a monitor
 * phrase — the same reasoning as any other official source.
 */
async function fetchBlueskyAuthorSource(source) {
  if (!source.handle) {
    throw new Error(`bluesky-author source "${source.id}" has no handle configured`);
  }

  const url = `${AUTHOR_FEED_URL}?actor=${encodeURIComponent(source.handle)}&limit=${PAGE_LIMIT}`;
  const data = await fetchJson(url);

  const items = (data.feed || [])
    .map((entry) => entry.post)
    .filter(Boolean)
    .map((post) => {
      const handle = post.author?.handle;
      const rkey = post.uri?.split("/").pop();
      return {
        title: undefined,
        link: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : post.uri,
        description: post.record?.text,
        publishedAt: post.record?.createdAt,
        author: post.author?.displayName || handle,
        image: post.embed?.images?.[0]?.thumb,
        sourceId: source.id,
        sourceName: source.name,
        sourceMethod: "bluesky",
        region: source.region,
        _contentId: post.uri,
        _engagement: {
          likes: post.likeCount,
          reposts: post.repostCount,
          replies: post.replyCount,
        },
        _authorHandle: handle,
      };
    });

  return { items };
}

module.exports = { fetchBlueskyAuthorSource };
