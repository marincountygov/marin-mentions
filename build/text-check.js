"use strict";

// Some publisher feeds put the wrong article body on a story: the same text on
// many items, or the text of a different story. NBC Bay Area's feed did this
// (a New Orleans tanker story under dozens of unrelated headlines). Matching
// monitors against that text produces false hits, so a source can opt in
// (`checkTextMatchesTitle: true` in config/sources.yaml) to have the text
// dropped when it plainly belongs to another story. The item is then matched
// on its title alone.

const STOP_WORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could",
  "should", "where", "being", "other", "first", "from", "with", "that", "this", "have", "will",
  "over", "into", "amid", "says", "said", "news", "local",
]);

function titleWords(title) {
  const words = String(title || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  return Array.from(new Set(words.filter((w) => !STOP_WORDS.has(w))));
}

/** Does the text mention at least one significant word from the title? A word
 * counts when the text has it, or a word that starts the same way (so "flooding"
 * finds "flooded"). */
function textSharesTitleWord(title, text) {
  const words = titleWords(title);
  if (words.length === 0) return true; // nothing to compare; do not drop on no evidence
  const haystack = String(text || "").toLowerCase();
  return words.some((word) => haystack.includes(word.length > 6 ? word.slice(0, 5) : word));
}

/** Blank the text of items whose text is shared by several different stories,
 * or shares no significant word with the item's own title. Mutates and returns
 * the number of items changed. `items` should all come from sources that opted in. */
function dropMismatchedText(items) {
  const urlsByText = new Map();
  for (const item of items) {
    if (!item.text) continue;
    if (!urlsByText.has(item.text)) urlsByText.set(item.text, new Set());
    urlsByText.get(item.text).add(item.url);
  }
  let changed = 0;
  for (const item of items) {
    if (!item.text) continue;
    const shared = urlsByText.get(item.text).size > 1;
    if (shared || !textSharesTitleWord(item.title, item.text)) {
      item.text = "";
      changed += 1;
    }
  }
  return changed;
}

module.exports = { dropMismatchedText, textSharesTitleWord, titleWords };
