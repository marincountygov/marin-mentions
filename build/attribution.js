"use strict";

// Google News adds the publisher's name to the end of every story's text ("<title> Marin Independent Journal"). That name
// is not part of the story, but a monitor phrase found in it still matched: every story from the Marin Independent Journal
// matched "Marin", national wire stories and pro sports included. This takes the name off the end so only the story's own
// words are matched and shown.

/**
 * @param {string} text the story text, with the publisher's name possibly at the end
 * @param {string} publisher the publisher's name (Google News's <source>)
 * @returns {string} the text without that name at the end (also after a dash or colon); other text is untouched
 */
function stripPublisherName(text, publisher) {
  // The feed text can still carry &nbsp; where Google News put its spacing; it is a space.
  const value = String(text || "").replace(/&nbsp;|\u00a0/gi, " ");
  const name = String(publisher || "").trim();
  if (!name) return value;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`(?:(?:\\s*[-–—:|]\\s*|\\s+)|^)${escaped}\\s*$`, "i"), "").trim();
}

module.exports = { stripPublisherName };
