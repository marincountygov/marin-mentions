"use strict";

const { XMLParser } = require("fast-xml-parser");
const { fetchText } = require("../http");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

/** A field can parse as a plain string, or as { "#text": "...", "@_attr": ... }
 * when the node has attributes/mixed content alongside CDATA. Normalize both
 * to a plain string. */
function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function firstImageUrl(item) {
  // RSS <enclosure>, Media RSS <media:content>/<media:thumbnail>, or a bare <image>.
  const enclosure = item.enclosure;
  if (enclosure) {
    const list = Array.isArray(enclosure) ? enclosure : [enclosure];
    const image = list.find((entry) => String(entry?.["@_type"] || "").startsWith("image/"));
    if (image?.["@_url"]) return image["@_url"];
  }
  const mediaContent = item["media:content"];
  if (mediaContent) {
    const list = Array.isArray(mediaContent) ? mediaContent : [mediaContent];
    const url = list.find((entry) => entry?.["@_url"])?.["@_url"];
    if (url) return url;
  }
  const mediaThumbnail = item["media:thumbnail"];
  if (mediaThumbnail?.["@_url"]) return mediaThumbnail["@_url"];
  return undefined;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse RSS 2.0 or Atom XML into a flat list of raw items. Callers
 * (rss.js / google-news.js) attach source-specific fields afterward.
 */
function parseFeed(xml) {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    const list = Array.isArray(rssItems) ? rssItems : [rssItems];
    return list.map((item) => ({
      title: textOf(item.title),
      link: textOf(item.link),
      description: stripHtml(textOf(item.description || item["content:encoded"])),
      publishedAt: textOf(item.pubDate) || textOf(item["dc:date"]),
      sourceName: textOf(item.source),
      sourceUrl: item.source?.["@_url"],
      image: firstImageUrl(item),
    }));
  }
  const atomEntries = doc?.feed?.entry;
  if (atomEntries) {
    const list = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    return list.map((entry) => {
      const link = Array.isArray(entry.link)
        ? entry.link.find((l) => l["@_rel"] === "alternate" || !l["@_rel"])?.["@_href"]
        : entry.link?.["@_href"];
      // YouTube's Atom feeds (and other Media RSS/Atom feeds) carry the
      // thumbnail/description/author under <media:group> and <author> —
      // plain blog Atom feeds rarely have these, so this is a no-op there.
      const mediaGroup = entry["media:group"];
      return {
        title: textOf(entry.title),
        link: link || "",
        description: stripHtml(textOf(mediaGroup?.["media:description"] || entry.summary || entry.content)),
        // <published> is an entry's true, fixed original date; <updated> is
        // a last-modified timestamp — confirmed directly (2026-09-30)
        // against a real YouTube channel feed that YouTube bumps <updated>
        // independently of the actual upload date, sometimes to
        // essentially "now," which was silently overriding a video's real
        // age by up to years whenever both fields were present (nearly
        // always). Prefer <published>; fall back to <updated> only for the
        // rare feed that omits it.
        publishedAt: textOf(entry.published || entry.updated),
        image: mediaGroup?.["media:thumbnail"]?.["@_url"],
        author: textOf(entry.author?.name),
      };
    });
  }
  return [];
}

/**
 * Fetch and parse a direct publisher RSS/Atom feed.
 * @param {{id: string, name: string, url: string, region?: string}} source
 * @returns {Promise<{items: object[]}>}
 */
async function fetchRssSource(source) {
  const xml = await fetchText(source.url, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
  const items = parseFeed(xml);
  return {
    items: items
      .filter((item) => item.link)
      .map((item) => ({
        ...item,
        sourceId: source.id,
        sourceName: source.name,
        sourceMethod: "rss",
        region: source.region,
      })),
  };
}

module.exports = { fetchRssSource, parseFeed, stripHtml };
