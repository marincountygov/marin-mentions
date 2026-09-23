#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { loadSources, loadMonitors } = require("./config");
const { fetchSource, refreshIntervalFor } = require("./connectors");
const { normalizeItem, hostnameOf } = require("./normalize");
const { matchItems } = require("./match");
const { dedupeItems } = require("./dedupe");

const PRUNE_DAYS = 60;

// Every sourceMethod that build/normalize.js's SOURCE_TYPE_BY_METHOD maps
// to sourceType "social" — kept in sync with that map, not derived from it,
// so a mismatch is a build-time error instead of a silent drift between
// the two files.
const SOCIAL_METHODS = new Set(["bluesky", "reddit", "nextdoor"]);

/** Guards the News/Video/Social split the UI's content-type tabs rely on
 * entirely (assets/app.js's matchesFilters() trusts item.sourceType with
 * no further check) — fail the build loudly if a social-method item isn't
 * classified sourceType: "social", or vice versa, instead of letting a
 * misclassification quietly leak a social post into the News or Video
 * tab (or a news item into Social). */
function assertSocialClassification(items) {
  for (const item of items) {
    const isSocialMethod = SOCIAL_METHODS.has(item.sourceMethod);
    const isSocialType = item.sourceType === "social";
    if (isSocialMethod !== isSocialType) {
      throw new Error(
        `Social classification mismatch: "${item.title || item.url}" has sourceMethod ` +
          `"${item.sourceMethod}" but sourceType "${item.sourceType}"`
      );
    }
  }
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = /^--([\w-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function loadPrevious(source) {
  if (!source) return { items: [], sources: {} };
  try {
    const text = /^https?:\/\//.test(source)
      ? await (await fetch(source)).text()
      : fs.existsSync(source)
        ? fs.readFileSync(source, "utf8")
        : null;
    if (!text) return { items: [], sources: {} };
    const parsed = JSON.parse(text);
    const sourcesById = Object.fromEntries((parsed.sources || []).map((s) => [s.id, s]));
    return { items: parsed.items || [], sources: sourcesById };
  } catch (error) {
    console.warn(`Could not load previous snapshot from ${source}: ${error.message}`);
    return { items: [], sources: {} };
  }
}

function isDue(previousHealth, refreshIntervalMinutes, now) {
  if (!previousHealth?.lastFetchedAt) return true;
  const elapsedMinutes = (now - new Date(previousHealth.lastFetchedAt).getTime()) / 60_000;
  return elapsedMinutes >= refreshIntervalMinutes;
}

// Google's own site: search is a ranked subset, not a complete index of a
// domain — the same story can turn up via a broad discovery query (e.g.
// "Marin County") while NOT appearing in that outlet's own site:-scoped
// query, purely due to Google's ranking on their end (confirmed directly:
// an article whose real publisher is marincounty.gov showed up via the
// generic "Marin County" query but not via site:marincounty.gov's own
// query at the same moment). Left alone, that item stays permanently
// attributed to the generic discovery source and never shows up when
// filtering by the specific outlet, even though it's genuinely theirs.
//
// Fix: re-attribute every item to whichever CONFIGURED source's domain
// actually matches its real publisher (sourceUrl), regardless of which
// connector call happened to fetch it. Only affects items whose true
// domain matches a MORE SPECIFIC configured source than the one that
// fetched them — a source can't lose items to itself.
function buildDomainIndex(sources) {
  const index = new Map();
  for (const source of sources) {
    let domain;
    if (source.type === "rss" && source.url) {
      domain = hostnameOf(source.url);
    } else if (source.type === "google-news" && source.query) {
      // A query can scope to a path, not just a domain (e.g.
      // site:marincounty.gov/news-releases) — strip that path back off so
      // this index key stays a bare hostname, matching what hostnameOf()
      // returns for an item's real publisher URL.
      const match = /site:([^\s"]+)/i.exec(source.query);
      if (match) domain = match[1].split("/")[0].replace(/^www\./i, "").toLowerCase();
    }
    if (domain) index.set(domain, source);
  }
  return index;
}

function reattributeBySourceDomain(items, domainIndex) {
  for (const item of items) {
    const domain = hostnameOf(item.sourceUrl);
    const specificSource = domain && domainIndex.get(domain);
    if (specificSource && specificSource.id !== item.sourceId) {
      item.sourceId = specificSource.id;
      item.source = specificSource.name;
    }
  }
}

async function buildOnce({ previousSnapshotPath, outPath, env = process.env }) {
  const sources = loadSources();
  const monitors = loadMonitors();
  const previous = await loadPrevious(previousSnapshotPath);
  const now = Date.now();

  const context = {
    monitors,
    apiKey: env.YOUTUBE_API_KEY,
    clientId: env.REDDIT_CLIENT_ID,
    clientSecret: env.REDDIT_CLIENT_SECRET,
    redditUsername: env.REDDIT_USERNAME,
    redditPassword: env.REDDIT_PASSWORD,
    blueskyHandle: env.BLUESKY_HANDLE,
    blueskyPassword: env.BLUESKY_APP_PASSWORD,
  };
  
  const health = [];
  const allItems = [];

  for (const source of sources) {
    const previousHealth = previous.sources[source.id];
    const previousItems = previous.items.filter((item) => item.sourceId === source.id);

    if (!source.enabled) {
      health.push({ ...healthDefaults(source), status: "disabled", itemCount: 0 });
      continue;
    }

    const refreshIntervalMinutes = refreshIntervalFor(source);
    const due = isDue(previousHealth, refreshIntervalMinutes, now);

    if (!due) {
      allItems.push(...previousItems);
      health.push({
        ...healthDefaults(source),
        status: previousHealth?.status === "error" ? "error" : "connected",
        lastFetchedAt: previousHealth?.lastFetchedAt ?? null,
        itemCount: previousItems.length,
        cached: true,
      });
      continue;
    }

    try {
      const { items: rawItems } = await fetchSource(source, context);
      const normalized = rawItems.map(normalizeItem);
      // Merge with what this source contributed last snapshot, not just this
      // fetch's raw results — matchItems/dedupeItems below already dedupe
      // safely across a re-processed previousItems (proven by the !due and
      // catch branches above, which already push previousItems through the
      // same pipeline). Without this, a source whose fetch doesn't inherently
      // overlap with its own prior results — searchPosts returns only the
      // top-N *latest* matches per term, not a stable feed — loses any
      // previously-captured item that's aged out of that window the moment
      // it next fetches successfully, even though it's still within the
      // 60-day retention window. That silently reset Bluesky's whole known
      // dataset to a single snapshot on every lucky (non-rate-limited) fetch
      // instead of accumulating across polls, contradicting the "merge into
      // the previous snapshot" behavior this file documents at the top.
      allItems.push(...normalized, ...previousItems);
      health.push({
        ...healthDefaults(source),
        status: "connected",
        lastFetchedAt: new Date(now).toISOString(),
        itemCount: normalized.length + previousItems.length,
      });
    } catch (error) {
      console.warn(`[${source.id}] fetch failed: ${error.message}`);
      allItems.push(...previousItems);
      health.push({
        ...healthDefaults(source),
        status: "error",
        statusDetail: error.message,
        lastFetchedAt: previousHealth?.lastFetchedAt ?? null,
        itemCount: previousItems.length,
      });
    }
  }

  reattributeBySourceDomain(allItems, buildDomainIndex(sources));

  const matched = matchItems(allItems, monitors);
  const deduped = dedupeItems(matched);

  const cutoff = now - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const pruned = deduped.filter((item) => new Date(item.publishedAt).getTime() >= cutoff);

  assertSocialClassification(pruned);

  pruned.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  pruned.forEach((item) => {
    delete item._contentId;
  });

  const output = {
    generatedAt: new Date(now).toISOString(),
    monitors: monitors.map((m) => ({
      id: m.id,
      name: m.name,
      group: m.group || "General",
      include: m.include,
      exclude: m.exclude || [],
    })),
    sources: health,
    items: pruned,
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output));
  }

  return output;
}

// A single human-visitable URL for the source, resolved server-side so the
// UI doesn't need type-specific knowledge of sources.yaml's shape. Not
// every source type has one worth linking (youtube/bluesky/reddit/nextdoor
// scan broadly, with no single "the source" page) — those get none.
function sourceLink(source) {
  // An explicit override always wins — e.g. pointing a google-news source
  // at the outlet's own listing page instead of the generic auto-derived
  // Google search URL, when there's a more directly useful destination.
  if (source.link) return source.link;
  if (source.type === "rss" && source.url) return source.url;
  if (source.type === "google-news" && source.query) {
    return `https://news.google.com/search?q=${encodeURIComponent(source.query)}&hl=en-US&gl=US&ceid=US:en`;
  }
  if (source.type === "youtube-rss" && source.channelId) {
    return `https://www.youtube.com/channel/${source.channelId}`;
  }
  return undefined;
}

function healthDefaults(source) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    region: source.region,
    enabled: source.enabled,
    costCategory: source.costCategory,
    official: source.official,
    note: source.note,
    link: sourceLink(source),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || path.join(__dirname, "..", "dist", "data.json");
  const previousSnapshotPath = args.previous;

  const output = await buildOnce({ previousSnapshotPath, outPath });
  console.log(
    `Wrote ${output.items.length} items from ${output.sources.filter((s) => s.enabled).length} enabled sources to ${outPath}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildOnce };
