"use strict";

const USER_AGENT =
  "Mozilla/5.0 (compatible; MarinMentions/1.0; +https://github.com/marincountygov/marin-mentions)";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetch a URL with a timeout and a real User-Agent (many outlets block the
 * default Node/undici UA). Throws on non-2xx so callers can catch and mark
 * the source unhealthy without crashing the whole build.
 */
async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, accept, headers } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        ...(accept ? { Accept: accept } : {}),
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options) {
  const text = await fetchText(url, { accept: "application/json", ...options });
  return JSON.parse(text);
}

module.exports = { fetchText, fetchJson, USER_AGENT, DEFAULT_TIMEOUT_MS };
