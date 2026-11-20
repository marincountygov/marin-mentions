"use strict";

/** Lowercase, normalize curly quotes/dashes to straight ones, and collapse
 * whitespace, so "Marin's" / "Marin’s" and multi-space runs all match
 * the same way. Deliberately simple string matching — no NLP. */
function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// item._matchChars (set by build/index.js from a source's matchTextChars) limits
// matching to the title plus the first N characters of the text. Full article
// bodies end in related-story links, captions and photo credits that name other
// places; the start of the text is what the story is about. Not written to output.
function textFieldsOf(item) {
  const text = item._matchChars > 0 ? String(item.text || "").slice(0, item._matchChars) : item.text;
  return [item.title, text].filter(Boolean).join(" ");
}

// Opt-in prefix for a single term: "word:MCA" matches "MCA" only as a whole
// word, not as a substring of anything else (plain "MCA" would also match
// inside "MCAL", the athletic league — a real false positive found in
// production). Every other term keeps the default plain-substring behavior
// unchanged; this only applies where a term is short/ambiguous enough that
// substring matching causes collisions like that one.
const WORD_BOUNDARY_PREFIX = "word:";

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Extra spellings that count as a whole-word match. Local accounts tag posts with
// place hashtags like #larkspurcitymarincounty; as one run-together word they would
// miss word:Marin, though they are clearly about Marin.
const WORD_ALIASES = { marin: /#\w*marincounty\b/ };

function singleTermMatches(term, haystack) {
  if (typeof term === "string" && term.startsWith(WORD_BOUNDARY_PREFIX)) {
    const word = normalizeForMatch(term.slice(WORD_BOUNDARY_PREFIX.length));
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`).test(haystack)) return true;
    return Boolean(WORD_ALIASES[word] && WORD_ALIASES[word].test(haystack));
  }
  return haystack.includes(normalizeForMatch(term));
}

/** An include/exclude entry is normally a single phrase (string). It can
 * also be a list of phrases, e.g. `["word:MCA", "Marin"]`, meaning ALL of
 * those phrases must be present — a compound AND clause for terms too
 * generic to use alone (a bare "MCA" would match unrelated content; "MCA"
 * appearing alongside "Marin" is specific enough). */
function entryMatches(entry, haystack) {
  const terms = Array.isArray(entry) ? entry : [entry];
  return terms.every((term) => singleTermMatches(term, haystack));
}

function stripWordPrefix(term) {
  return typeof term === "string" && term.startsWith(WORD_BOUNDARY_PREFIX)
    ? term.slice(WORD_BOUNDARY_PREFIX.length)
    : term;
}

function labelFor(entry) {
  return Array.isArray(entry) ? entry.map(stripWordPrefix).join(" + ") : stripWordPrefix(entry);
}

/** Turn config/context.yaml into the lookups applyMonitors() needs. Returns null
 * when there is no config, which means no extra rules. */
function buildContextRules(config) {
  if (!config) return null;
  const lower = (list) => new Set((list || []).map((v) => String(v).toLowerCase()));
  return {
    sourceMethods: new Set(config.sourceMethods || []),
    contextTerms: config.context || [],
    ambiguousTerms: new Set((config.ambiguousTerms || []).map((t) => normalizeForMatch(stripWordPrefix(t)))),
    ambiguousGroups: new Set(config.ambiguousGroups || []),
    trustedAuthors: lower(config.trustedAuthors),
    blockedAuthors: lower(config.blockedAuthors),
  };
}

function hasLocalContext(rules, haystack) {
  return rules.contextTerms.some((term) => singleTermMatches(term, haystack));
}

/** Does this item skip some matches because of the context rules? Returns
 * "blocked" (drop the item), "open" (no extra requirement), or "strict"
 * (ambiguous terms and groups need context the item does not have). */
function contextModeFor(item, rules, haystack) {
  if (!rules || !rules.sourceMethods.has(item.sourceMethod)) return "open";
  const handle = String(item.handle || item._authorHandle || "").toLowerCase();
  if (handle && rules.blockedAuthors.has(handle)) return "blocked";
  if (handle && rules.trustedAuthors.has(handle)) return "open";
  return hasLocalContext(rules, haystack) ? "open" : "strict";
}

function isAmbiguousHit(entry, monitor, rules) {
  if (rules.ambiguousGroups.has(monitor.group)) return true;
  // Only a plain single term can be ambiguous; a compound entry has its own context.
  return typeof entry === "string" && rules.ambiguousTerms.has(normalizeForMatch(stripWordPrefix(entry)));
}

/**
 * Apply every configured monitor to one normalized item, mutating
 * item.matchedTerms / item.matchedMonitors. Matching order per monitor:
 * normalize -> check include terms -> check exclude terms -> include/discard.
 * A monitor matches if ANY include entry is found and NO exclude entry is
 * found.
 */
function applyMonitors(item, monitors, contextRules = null) {
  const haystack = normalizeForMatch(textFieldsOf(item));
  const mode = contextModeFor(item, contextRules, haystack);
  if (mode === "blocked") {
    item.matchedTerms = [];
    item.matchedMonitors = [];
    return false;
  }
  const matchedTerms = new Set();
  const matchedMonitors = [];

  for (const monitor of monitors) {
    // Optional: a monitor can restrict itself to specific sourceMethods
    // (e.g. a broader/noisier catch-all meant only for one loose-chatter
    // platform, not News/Video precision) — omitted means "applies
    // everywhere," same as before this field existed.
    if (monitor.sourceMethods && !monitor.sourceMethods.includes(item.sourceMethod)) continue;

    const excluded = (monitor.exclude || []).some((entry) => entryMatches(entry, haystack));
    if (excluded) continue;

    let hits = (monitor.include || []).filter((entry) => entryMatches(entry, haystack));
    if (mode === "strict") hits = hits.filter((entry) => !isAmbiguousHit(entry, monitor, contextRules));
    if (hits.length === 0) continue;

    matchedMonitors.push(monitor.id);
    hits.forEach((entry) => matchedTerms.add(labelFor(entry)));
  }

  item.matchedTerms = Array.from(matchedTerms);
  item.matchedMonitors = matchedMonitors;
  return matchedMonitors.length > 0;
}

/** Filter a list of normalized items down to those matching at least one
 * monitor, annotating each with matchedTerms/matchedMonitors.
 *
 * officialSourceIds (optional) bypasses that requirement for items from an
 * official: true source (config/sources.yaml) — applyMonitors() still runs
 * first so a genuine match still gets real matchedTerms/matchedMonitors for
 * display, but a real phrase match is no longer required to survive. An
 * official account's own posts/videos/releases are relevant because of
 * where they're from, not because they happen to contain a monitor phrase
 * — confirmed directly this was silently dropping real content otherwise
 * (e.g. every one of marin-parks-youtube's 15 fetched videos was being
 * discarded, since none of their titles happened to say "Marin" or
 * "Parks"). Defaults to an empty Set so any caller that doesn't pass this
 * keeps today's exact behavior. */
function matchItems(items, monitors, officialSourceIds = new Set(), contextRules = null) {
  return items.filter((item) => applyMonitors(item, monitors, contextRules) || officialSourceIds.has(item.sourceId));
}

/** A district is matched by every place in it. places is the map from config.js's loadPlaces(): each place may
 * list the districts it is in. An item that matched a place also matches those districts, so the places in a
 * district are kept in marin-data and not repeated in the district's own phrases. monitors gives the order the
 * matched list keeps. Call after matchItems(); it adds to item.matchedMonitors and never removes. */
function addDistrictsFromPlaces(items, places, monitors) {
  const order = new Map(monitors.map((monitor, index) => [monitor.id, index]));
  for (const item of items) {
    const found = new Set(item.matchedMonitors);
    for (const id of item.matchedMonitors) {
      for (const district of (places.get(id) || {}).districts || []) found.add(district.monitorId);
    }
    if (found.size !== item.matchedMonitors.length) {
      item.matchedMonitors = [...found].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    }
  }
  return items;
}

/** A department is matched by its divisions. A monitor may name its parent (a division names its department); an item
 * that matched the division also matches the department, and its department's department, so choosing a department
 * in the filter finds what its divisions caught too. Call after matchItems(); it adds to item.matchedMonitors and
 * never removes. monitors gives the order the matched list keeps. */
function addParentsFromChildren(items, monitors) {
  const order = new Map(monitors.map((monitor, index) => [monitor.id, index]));
  const parentOf = new Map(monitors.filter((monitor) => monitor.parent).map((monitor) => [monitor.id, monitor.parent]));
  for (const item of items) {
    const found = new Set(item.matchedMonitors);
    for (const id of item.matchedMonitors) {
      for (let parent = parentOf.get(id), guard = 0; parent && guard < 10; parent = parentOf.get(parent), guard++) found.add(parent);
    }
    if (found.size !== item.matchedMonitors.length) {
      item.matchedMonitors = [...found].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    }
  }
  return items;
}

module.exports = { addDistrictsFromPlaces, addParentsFromChildren, matchItems, applyMonitors, normalizeForMatch, buildContextRules, hasLocalContext };
