"use strict";

const { fetchRssSource } = require("./rss");
const { fetchGoogleNewsSource } = require("./google-news");
const { fetchYoutubeSource, fetchYoutubeChannelRssSource } = require("./youtube");
const { fetchBlueskySource } = require("./bluesky");
const { fetchBlueskyAuthorSource } = require("./bluesky-author");
const { fetchRedditSource } = require("./reddit");
const { fetchNextdoorSource } = require("./nextdoor");

const DEFAULT_REFRESH_MINUTES = {
  rss: 10,
  "google-news": 10,
  youtube: 60,
  "youtube-rss": 10,
  bluesky: 5,
  "bluesky-author": 15,
  reddit: 15,
  nextdoor: 15,
};

/** Dispatch a source to its connector. `context` carries monitors and any
 * credentials the connector needs — each connector throws on failure so
 * the caller can isolate one bad source from the rest of the build. */
function fetchSource(source, context) {
  switch (source.type) {
    case "rss":
      return fetchRssSource(source);
    case "google-news":
      return fetchGoogleNewsSource(source);
    case "youtube":
      return fetchYoutubeSource(source, context);
    case "youtube-rss":
      return fetchYoutubeChannelRssSource(source);
    case "bluesky":
      return fetchBlueskySource(source, context);
    case "bluesky-author":
      return fetchBlueskyAuthorSource(source);
    case "reddit":
      return fetchRedditSource(source);
    case "nextdoor":
      return fetchNextdoorSource(source, context);
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
}

function refreshIntervalFor(source) {
  return source.refreshIntervalMinutes ?? DEFAULT_REFRESH_MINUTES[source.type] ?? 10;
}

module.exports = { fetchSource, refreshIntervalFor, DEFAULT_REFRESH_MINUTES };
