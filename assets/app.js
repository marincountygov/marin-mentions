// App-specific behavior only. Standard menu, dialog, and navigation behavior
// already come from shared/app-shell.js — do not reimplement them here.

document.addEventListener("DOMContentLoaded", () => {
  const state = {
    data: null,
    search: "",
    selectedMonitors: new Set(),
    // Individual sources selected in the Console's own sidebar filter
    // (distinct from selectedSources below, which filters the /sources
    // admin table).
    selectedFeedSources: new Set(),
    contentType: "all",
    // Stats view: toggled by the #stats-toggle button next to the content
    // type tabs — swaps the mention list for the charts in place, rather
    // than being its own page-level tab.
    statsView: false,
    time: "24h",
    selectedSources: new Set(),
    sourceSortKey: "name",
    sourceSortDirection: "ascending",
    // Clippings: itemId -> { releaseId: string | null }. Session-only, like
    // every other piece of state here — resets on reload.
    clippedItems: new Map(),
    // Source ids with official: true in sources.yaml (the County's own
    // first-party channels) — derived from data.json each load, not
    // hardcoded. See computeOfficialSourceIds().
    officialSourceIds: new Set(),
    // Items from the County's own first-party sources within the past 60
    // days — the Release dropdown's options. Computed once when data
    // loads, not per-render.
    releases: [],
    // Stats charts, kept around so a filter change/data refresh updates
    // them in place instead of stacking a new chart on the canvas.
    statsCharts: { timeline: null, sources: null, monitors: null },
  };

  const elements = {
    monitorChips: document.querySelector("#monitor-chips"),
    feedSourceFilter: document.querySelector("#feed-source-filter"),
    contentTabs: document.querySelector("#content-tabs"),
    statsToggle: document.querySelector("#stats-toggle"),
    statsGrid: document.querySelector("#stats-grid"),
    searchInput: document.querySelector("#filter-search"),
    timeSelect: document.querySelector("#filter-time"),
    filtersForm: document.querySelector("#filters"),
    resetButton: document.querySelector("#reset-filters-button"),
    lastUpdated: document.querySelector("#last-updated"),
    activeFilters: document.querySelector("#active-filters"),
    feed: document.querySelector("#media-feed"),
    selectAllCheckbox: document.querySelector("#select-all-checkbox"),
    selectAllField: document.querySelector("#select-all-field"),
    statusMessage: document.querySelector("#app-status-message"),
    sourcesWrap: document.querySelector("#sources-table-wrap"),
    sourceFilter: document.querySelector("#source-filter"),
    monitorsList: document.querySelector("#monitors-list"),
    statsTimelineCanvas: document.querySelector("#stats-timeline-chart"),
    statsSourcesCanvas: document.querySelector("#stats-sources-chart"),
    statsMonitorsCanvas: document.querySelector("#stats-monitors-chart"),
    copyEmailButton: document.querySelector("#copy-email-button"),
    copyLinkButton: document.querySelector("#copy-link-button"),
    copyStatsButton: document.querySelector("#copy-stats-button"),
    downloadDataButton: document.querySelector("#download-data-button"),
    downloadAllPngButton: document.querySelector("#download-all-png-button"),
    copyFormatSelect: document.querySelector("#copy-format-select"),
    // Wraps the select + its visually-hidden <label> — hide/show this, not
    // just the select, so the orphaned label doesn't linger in the a11y
    // tree pointing at a hidden control.
    copyFormatField: document.querySelector("#copy-format-field"),
    copyFallback: document.querySelector("#copy-fallback"),
    copyFallbackText: document.querySelector("#copy-fallback-text"),
  };

  const TIME_WINDOWS_MS = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "60d": 60 * 24 * 60 * 60 * 1000,
    all: null,
  };

  const PLATFORM_LABELS = {
    rss: "News",
    "google-news": "News",
    youtube: "YouTube",
    bluesky: "Bluesky",
    reddit: "Reddit",
    nextdoor: "Nextdoor",
  };

  const SOURCE_TYPE_LABELS = {
    rss: "RSS",
    "google-news": "Google News",
    youtube: "YouTube (search)",
    "youtube-rss": "YouTube (channel)",
    bluesky: "Bluesky",
    "bluesky-author": "Bluesky (official account)",
    reddit: "Reddit",
    nextdoor: "Nextdoor",
  };

  // Maps a source's connector type (config-level) to the same News/Video/
  // Social buckets a matched item's own sourceType ends up in (see
  // build/normalize.js's SOURCE_TYPE_BY_METHOD) — used to group the
  // Console's source-filter sidebar by content type.
  const CONTENT_TYPE_BY_CONNECTOR_TYPE = {
    rss: "news",
    "google-news": "news",
    youtube: "video",
    "youtube-rss": "video",
    bluesky: "social",
    "bluesky-author": "social",
    reddit: "social",
    nextdoor: "social",
  };
  const CONTENT_TYPE_GROUP_LABELS = { news: "News", video: "Video", social: "Social" };
  const CONTENT_TYPE_GROUP_ORDER = ["news", "video", "social"];

  // Explicit display order for monitor groups (sidebar chips and the
  // Monitors page) — config/monitors.yaml's own section-comment order,
  // not alphabetical. Any group not listed here falls back to alphabetical
  // and sorts after all of these (see sortedGroupEntries).
  const MONITOR_GROUP_ORDER = [
    "Topics",
    "Services",
    "Events & Places",
    "Towns",
    "Board & Courts",
    "Districts",
    "Departments",
    "Associations",
    "People",
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function announce(message) {
    if (elements.statusMessage) elements.statusMessage.textContent = message;
  }

  // Shareable filtered views: current filter state lives in the query
  // string (independent of the #latest/#sources/#monitors hash routing),
  // so copying the address bar reproduces the same view for whoever opens
  // it. Only include a param when it differs from the default, so a link
  // with nothing special selected has no query string at all.
  function syncUrlFromState() {
    const params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    if (state.selectedMonitors.size > 0) params.set("monitors", Array.from(state.selectedMonitors).join(","));
    if (state.selectedFeedSources.size > 0) params.set("sources", Array.from(state.selectedFeedSources).join(","));
    if (state.contentType !== "all") params.set("type", state.contentType);
    if (state.time !== "24h") params.set("time", state.time);
    if (state.statsView) params.set("view", "stats");

    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }

  // Runs once, right after data.json loads (needs state.data.monitors/
  // sources to validate IDs against) and before the first render — so
  // opening a shared link reproduces its filters immediately, not after
  // an extra click.
  function applyStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const validMonitorIds = new Set((state.data.monitors || []).map((m) => m.id));
    const validSourceIds = new Set((state.data.sources || []).map((s) => s.id));

    if (params.has("q")) state.search = params.get("q");
    if (params.has("monitors")) {
      state.selectedMonitors = new Set(params.get("monitors").split(",").filter((id) => validMonitorIds.has(id)));
    }
    if (params.has("sources")) {
      state.selectedFeedSources = new Set(
        params.get("sources").split(",").filter((id) => validSourceIds.has(id))
      );
    }
    if (params.has("type")) state.contentType = params.get("type");
    if (params.has("time")) state.time = params.get("time");
    if (params.get("view") === "stats") state.statsView = true;

    if (elements.searchInput) elements.searchInput.value = state.search;
    if (elements.timeSelect) elements.timeSelect.value = state.time;
    elements.contentTabs?.querySelectorAll("[data-content-type]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.contentType === state.contentType));
    });
  }

  async function loadData({ isRefresh = false } = {}) {
    announce(isRefresh ? "Refreshing…" : "Loading media monitor data…");
    try {
      const response = await fetch(`data.json?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      state.officialSourceIds = computeOfficialSourceIds();
      state.releases = computeReleases();
      if (!isRefresh) applyStateFromUrl();
      renderAll();
      announce(isRefresh ? "Refreshed." : "Loaded.");
    } catch (error) {
      console.error(error);
      announce("Could not load media monitor data. Try refreshing the page.");
      if (elements.feed) {
        elements.feed.innerHTML = `<li class="app-card"><p class="app-error">Could not load data.json (${escapeHtml(error.message)}).</p><p class="app-help-text">If you're developing locally, run <code>npm run dev</code> and serve this folder — don't open index.html directly.</p></li>`;
      }
    }
  }

  function renderAll() {
    renderLastUpdated();
    renderMonitorChips();
    renderFeedSourceFilter();
    renderFeed(); // also renders Stats, from the same filtered item list
    renderSourcesTable();
    renderMonitorsList();
  }

  function renderLastUpdated() {
    if (!state.data || !elements.lastUpdated) return;
    const date = new Date(state.data.generatedAt);
    elements.lastUpdated.innerHTML =
      `Last updated: <time datetime="${date.toISOString()}">${escapeHtml(
        date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      )}</time>` + ` (refreshes ~15 minutes)`;
  }

  /** Group a list by a key function, preserving first-seen group order. */
  function groupBy(list, keyFn) {
    const groups = new Map();
    list.forEach((item) => {
      const key = keyFn(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function byName(a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  }

  /** groupBy()'s Map, as [groupKey, groupLabel, items] entries — items
   * within each group always sorted alphabetically by name. Groups sort by
   * `order` (an array of raw keys, not labels) when given; any group not
   * listed in it falls back to alphabetical-by-label and sorts after every
   * explicitly ordered one. With no `order`, every group sorts
   * alphabetically by label, same as before. */
  function sortedGroupEntries(groups, labelFn = (key) => key, order = null) {
    const entries = Array.from(groups.entries()).map(([key, items]) => [key, labelFn(key), [...items].sort(byName)]);
    if (!order) {
      return entries.sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: "base" }));
    }
    return entries.sort((a, b) => {
      const indexA = order.indexOf(a[0]);
      const indexB = order.indexOf(b[0]);
      if (indexA === -1 && indexB === -1) return a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: "base" });
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  }

  function renderMonitorChips() {
    if (!state.data || !elements.monitorChips) return;
    const monitors = state.data.monitors || [];
    elements.monitorChips.dataset.loading = "false";

    if (monitors.length === 0) {
      elements.monitorChips.innerHTML =
        '<legend>Monitors</legend><p class="app-help-text">No monitors configured. Add one to config/monitors.yaml.</p>';
      return;
    }

    // Two-level filter: a simplified top-level list of groups (collapsed by
    // default, so the sidebar isn't overwhelmed by 30+ monitors at once),
    // each expanding to its individual monitor checkboxes.
    const groups = groupBy(monitors, (m) => m.group || "General");
    elements.monitorChips.innerHTML =
      "<legend>Monitors</legend>" +
      sortedGroupEntries(groups, (key) => key, MONITOR_GROUP_ORDER)
        .map(
          ([groupName, , groupMonitors]) => `
        <details class="mm-facet-group">
          <summary>${escapeHtml(groupName)} <span class="app-help-text" data-group-count="${escapeHtml(groupName)}"></span></summary>
          <ul class="search-facet-list">
            ${groupMonitors
              .map((monitor) => {
                const id = `monitor-${monitor.id}`;
                const checked = state.selectedMonitors.has(monitor.id);
                return (
                  `<li><label for="${id}">` +
                  `<input type="checkbox" id="${id}" data-monitor-id="${escapeHtml(monitor.id)}" ${checked ? "checked" : ""}>` +
                  `${escapeHtml(monitor.name)} <span class="search-facet-count" data-monitor-count="${escapeHtml(monitor.id)}"></span>` +
                  `</label></li>`
                );
              })
              .join("")}
          </ul>
        </details>`
        )
        .join("");

    elements.monitorChips.querySelectorAll("input[data-monitor-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.monitorId;
        if (checkbox.checked) state.selectedMonitors.add(id);
        else state.selectedMonitors.delete(id);
        syncUrlFromState();
        renderFeed();
      });
    });
  }

  // Two-level filter, same pattern as Monitors: a collapsed-by-default
  // group per content type (News/Video/Social), expanding to every
  // individual source in it — so you can narrow the feed to one specific
  // outlet (e.g. just SF Chronicle) instead of only a whole category.
  function renderFeedSourceFilter() {
    if (!state.data || !elements.feedSourceFilter) return;
    const sources = state.data.sources || [];
    elements.feedSourceFilter.dataset.loading = "false";

    const groups = groupBy(sources, (s) => CONTENT_TYPE_BY_CONNECTOR_TYPE[s.type] || "news");

    elements.feedSourceFilter.innerHTML =
      "<legend>Sources</legend>" +
      sortedGroupEntries(groups, (key) => CONTENT_TYPE_GROUP_LABELS[key] || key, CONTENT_TYPE_GROUP_ORDER)
        .map(([key, label, groupSources]) => {
          return `
        <details class="mm-facet-group">
          <summary>${escapeHtml(label)} <span class="app-help-text" data-content-type-count="${key}"></span></summary>
          <ul class="search-facet-list">
            ${groupSources
              .map((source) => {
                const id = `feed-source-${source.id}`;
                const checked = state.selectedFeedSources.has(source.id);
                return (
                  `<li><label for="${id}">` +
                  `<input type="checkbox" id="${id}" data-feed-source-id="${escapeHtml(source.id)}" ${checked ? "checked" : ""} ${source.enabled ? "" : "disabled"}>` +
                  `${escapeHtml(source.name)} <span class="search-facet-count" data-feed-source-count="${escapeHtml(source.id)}"></span>` +
                  `${source.enabled ? "" : ' <span class="app-help-text">(disabled)</span>'}` +
                  `</label></li>`
                );
              })
              .join("")}
          </ul>
        </details>`;
        })
        .join("");

    elements.feedSourceFilter.querySelectorAll("input[data-feed-source-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.feedSourceId;
        if (checkbox.checked) state.selectedFeedSources.add(id);
        else state.selectedFeedSources.delete(id);
        syncUrlFromState();
        renderFeed();
      });
    });
  }

  // skipMonitor/skipPlatform let the facet-count logic ask "how many items
  // would match if every OTHER filter stayed as-is" for a given dimension,
  // instead of collapsing to whatever's currently selected in that facet.
  function passesFilters(item, { skipMonitor = false, skipFeedSource = false } = {}) {
    if (
      !skipMonitor &&
      state.selectedMonitors.size > 0 &&
      !item.matchedMonitors.some((id) => state.selectedMonitors.has(id))
    ) {
      return false;
    }
    if (!skipFeedSource && state.selectedFeedSources.size > 0 && !state.selectedFeedSources.has(item.sourceId)) {
      return false;
    }
    // "All" means News + Video, not literally every sourceType — Social
    // (Bluesky/Reddit/Nextdoor) only ever shows up when the Social tab
    // itself is selected, never mixed into All/News/Video. "Official" isn't
    // a sourceType at all — it's cross-cutting (an official item can be
    // News, Video, or Social), so it checks state.officialSourceIds instead
    // of item.sourceType, and doesn't touch/replace the other content-type
    // tabs — an official item still shows under its own News/Video/Social
    // tab too, same as before.
    if (state.contentType === "official") {
      if (!state.officialSourceIds.has(item.sourceId)) return false;
    } else if (state.contentType === "all") {
      if (item.sourceType === "social") return false;
    } else if (item.sourceType !== state.contentType) {
      return false;
    }
    if (state.time !== "all") {
      const windowMs = TIME_WINDOWS_MS[state.time];
      if (Date.now() - new Date(item.publishedAt).getTime() > windowMs) return false;
    }
    if (state.search) {
      const haystack = `${item.title || ""} ${item.text || ""}`.toLowerCase();
      if (!haystack.includes(state.search.toLowerCase())) return false;
    }
    return true;
  }

  function matchesFilters(item) {
    return passesFilters(item);
  }

  function updateFacetCounts() {
    if (!state.data) return;

    // skipFeedSource too: a monitor's count is its total match count, not
    // limited to whichever Sources checkboxes happen to be checked right
    // now — otherwise unchecking a source would make a monitor look like
    // it has fewer matches than it really does.
    const forMonitors = state.data.items.filter((item) => passesFilters(item, { skipMonitor: true, skipFeedSource: true }));
    (state.data.monitors || []).forEach((monitor) => {
      const count = forMonitors.filter((item) => item.matchedMonitors.includes(monitor.id)).length;
      const el = elements.monitorChips?.querySelector(`[data-monitor-count="${monitor.id}"]`);
      if (el) el.textContent = `(${count})`;
    });

    // Group header count = items matching ANY monitor in that group (not
    // the number of monitors it contains).
    const monitorGroups = groupBy(state.data.monitors || [], (m) => m.group || "General");
    const groupCountEls = Array.from(elements.monitorChips?.querySelectorAll("[data-group-count]") || []);
    monitorGroups.forEach((groupMonitors, groupName) => {
      const groupMonitorIds = new Set(groupMonitors.map((m) => m.id));
      const count = forMonitors.filter((item) => item.matchedMonitors.some((id) => groupMonitorIds.has(id))).length;
      // Compared in JS, not as a CSS attribute-selector string — group
      // names can contain "&", which some CSS selector engines mishandle
      // even inside a quoted attribute value.
      const el = groupCountEls.find((span) => span.dataset.groupCount === groupName);
      if (el) el.textContent = `(${count})`;
    });

    const forFeedSources = state.data.items.filter((item) => passesFilters(item, { skipFeedSource: true }));
    const feedSourceCountEls = Array.from(
      elements.feedSourceFilter?.querySelectorAll("[data-feed-source-count]") || []
    );
    (state.data.sources || []).forEach((source) => {
      const count = forFeedSources.filter((item) => item.sourceId === source.id).length;
      const el = feedSourceCountEls.find((span) => span.dataset.feedSourceCount === source.id);
      if (el) el.textContent = `(${count})`;
    });

    CONTENT_TYPE_GROUP_ORDER.forEach((key) => {
      const count = forFeedSources.filter((item) => item.sourceType === key).length;
      const el = elements.feedSourceFilter?.querySelector(`[data-content-type-count="${key}"]`);
      if (el) el.textContent = `(${count})`;
    });
  }

  // Google's public favicon service — free, no key, works across every
  // outlet without this app needing to fetch/host icons itself. Derived
  // from sourceUrl (the outlet's homepage), not item.url, so Google News
  // items (whose url is a redirect page) still get the real publisher's
  // icon.
  function faviconUrl(item) {
    try {
      const hostname = new URL(item.sourceUrl).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
    } catch {
      return null;
    }
  }

  // Derived from data.json's sources (official: true in sources.yaml) each
  // time data loads, not hardcoded — so a future change to which sources
  // are official (in config, not here) doesn't silently drift out of sync
  // with the code. Used by both computeReleases() (release attribution)
  // and renderStats() (excluding the County's own volume from Top Sources).
  function computeOfficialSourceIds() {
    if (!state.data) return new Set();
    return new Set(state.data.sources.filter((source) => source.official).map((source) => source.id));
  }

  // Attributable releases: the County's own first-party items (official:
  // true in sources.yaml), not third-party coverage of them. Computed once
  // per data load, not per-card — the list only changes when data.json does.
  function computeReleases() {
    if (!state.data) return [];
    const cutoff = Date.now() - TIME_WINDOWS_MS["60d"];
    return state.data.items
      .filter((it) => state.officialSourceIds.has(it.sourceId) && new Date(it.publishedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  function formatReleaseDate(publishedAt) {
    return new Date(publishedAt).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  }

  /** Shown once a card is clipped — attributes it to the official County
   * release it's reporting on, listed by title over the past 60 days,
   * newest first (state.releases is already sorted that way). */
  function renderReleaseDropdown(item) {
    const clip = state.clippedItems.get(item.id);
    const heading = item.title || item.text?.slice(0, 120) || item.source;
    const options = state.releases
      .filter((release) => release.id !== item.id) // don't let a release attribute to itself
      .map((release) => {
        const selected = clip?.releaseId === release.id ? " selected" : "";
        const label = `${release.title} (${formatReleaseDate(release.publishedAt)})`;
        return `<option value="${escapeHtml(release.id)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return (
      `<div class="mm-card__release"${clip ? "" : " hidden"}>` +
      `<label for="release-${escapeHtml(item.id)}">Release</label>` +
      // aria-label supplements (doesn't replace) the short visible "Release"
      // label — a screen reader's "list all form fields" navigation mode
      // would otherwise show many identically-labeled "Release" selects
      // with nothing to tell them apart.
      `<select id="release-${escapeHtml(item.id)}" data-release-for="${escapeHtml(item.id)}" aria-label="Release for: ${escapeHtml(heading)}">` +
      `<option value="">None</option>${options}</select>` +
      `</div>`
    );
  }

  function renderCard(item) {
    const date = new Date(item.publishedAt);
    const heading = item.title || item.text?.slice(0, 120) || item.source;
    const showSeparateSnippet = item.title && item.text;
    const favicon = faviconUrl(item);
    const clipped = state.clippedItems.has(item.id);

    return (
      `<li class="app-card mm-card">` +
      `<span class="mm-card__select">` +
      // Includes the heading, not just "Clip this mention" — the checkbox
      // comes before the heading in reading order, so a generic label
      // would announce identically for every card with no way to tell
      // which story it's for without navigating past it first.
      `<label class="visually-hidden" for="clip-${escapeHtml(item.id)}">Clip: ${escapeHtml(heading)}</label>` +
      `<input type="checkbox" id="clip-${escapeHtml(item.id)}" data-clip-id="${escapeHtml(item.id)}"${clipped ? " checked" : ""}>` +
      `</span>` +
      (item.image ? `<img class="mm-card__image" src="${escapeHtml(item.image)}" alt="" loading="lazy">` : "") +
      `<div class="mm-card__body">` +
      `<div class="mm-card__meta">` +
      `<span class="app-badge">${escapeHtml(PLATFORM_LABELS[item.platform] || item.platform)}</span>` +
      `</div>` +
      `<h3 class="mm-card__title">` +
      `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(heading)}</a></h3>` +
      `<p class="mm-card__byline">` +
      `<time datetime="${date.toISOString()}" title="${escapeHtml(date.toLocaleString())}">${escapeHtml(
        date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      )}</time>` +
      ` — ` +
      (favicon ? `<img class="mm-card__favicon" src="${escapeHtml(favicon)}" alt="" loading="lazy">` : "") +
      `<span class="mm-card__source">${
        item.sourceUrl
          ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.source)}</a>`
          : escapeHtml(item.source)
      }</span>` +
      `</p>` +
      (showSeparateSnippet ? `<p class="mm-card__text">${escapeHtml(truncate(item.text, 220))}</p>` : "") +
      renderMonitorBadges(item.matchedMonitors) +
      renderReleaseDropdown(item) +
      `</div>` +
      `</li>`
    );
  }

  function truncate(text, max) {
    if (!text || text.length <= max) return text || "";
    return `${text.slice(0, max).trim()}…`;
  }

  function describeActiveFilters() {
    const parts = [];

    const timeLabel = elements.timeSelect?.options[elements.timeSelect.selectedIndex]?.text;
    parts.push(timeLabel || state.time);

    if (state.selectedMonitors.size > 0) {
      const names = state.data.monitors
        .filter((m) => state.selectedMonitors.has(m.id))
        .map((m) => m.name);
      parts.push(names.join(", "));
    } else {
      parts.push("All monitors");
    }

    if (state.selectedFeedSources.size > 0) {
      const names = state.data.sources
        .filter((s) => state.selectedFeedSources.has(s.id))
        .map((s) => s.name);
      parts.push(names.join(", "));
    } else {
      parts.push("All sources");
    }

    if (state.contentType !== "all") {
      const tabLabel = elements.contentTabs?.querySelector(`[data-content-type="${state.contentType}"]`)?.textContent;
      parts.push(tabLabel || state.contentType);
    }

    if (state.search) parts.push(`matching "${state.search}"`);

    return parts.join(" · ");
  }

  /** Reflects whether all/some/none of the currently filtered items are
   * clipped — the standard tri-state "select all" checkbox behavior. */
  function syncSelectAllCheckbox(items) {
    if (!elements.selectAllCheckbox) return;
    const clippedCount = items.filter((item) => state.clippedItems.has(item.id)).length;
    elements.selectAllCheckbox.disabled = items.length === 0;
    elements.selectAllCheckbox.checked = items.length > 0 && clippedCount === items.length;
    elements.selectAllCheckbox.indeterminate = clippedCount > 0 && clippedCount < items.length;
  }

  function renderFeed() {
    if (!state.data || !elements.feed) return;
    const items = state.data.items.filter(matchesFilters);
    state.lastFilteredItems = items;

    const counts = { news: 0, video: 0, social: 0 };
    items.forEach((item) => {
      counts[item.sourceType] = (counts[item.sourceType] || 0) + 1;
    });
    // One line: "Showing: ..." stays bold (the element's own style), the
    // mention counts are wrapped in a non-bold nested span so the two
    // read at different weights on the same line instead of stacking.
    if (elements.activeFilters) {
      const countsText =
        `${items.length} mention${items.length === 1 ? "" : "s"} — ` +
        `News ${counts.news}, Video ${counts.video}, Social ${counts.social}`;
      elements.activeFilters.innerHTML =
        `Showing: ${escapeHtml(describeActiveFilters())} ` +
        `<span class="mm-mention-counts">(${escapeHtml(countsText)})</span>`;
    }

    elements.feed.innerHTML = items.length
      ? items.map(renderCard).join("")
      : '<li class="app-empty">No mentions match the current filters.</li>';

    syncSelectAllCheckbox(items);
    updateFacetCounts();
    // Sync visibility first: Chart.js sizes a canvas at creation time, so
    // if a shared link opens straight into Stats (view=stats), the grid
    // needs to already be visible before renderStats() creates the charts
    // in it, or they'd size themselves against a hidden (0-width) canvas.
    syncStatsView();
    renderStats(items);
  }

  /** Shows the charts in place of the mention list, or vice versa, per
   * state.statsView (toggled by #stats-toggle, next to the content-type
   * tabs). renderStats() itself keeps the charts current regardless of
   * visibility, so this only ever needs to flip which one is hidden.
   *
   * #stats-toggle sits inside #content-tabs (role="tablist") for visual
   * position, but it isn't a content-type tab — it replaces the whole view
   * rather than filtering it — so it's a plain <button> with aria-pressed
   * (real toggle-button semantics), not role="tab"/aria-selected like its
   * siblings. aria-selected is only valid on tab/option/row/gridcell-type
   * roles; putting it on a roleless button would be invalid ARIA. */
  function syncStatsView() {
    if (elements.feed) elements.feed.hidden = state.statsView;
    if (elements.selectAllField) elements.selectAllField.hidden = state.statsView;
    if (elements.statsGrid) elements.statsGrid.hidden = !state.statsView;
    if (elements.statsToggle) elements.statsToggle.setAttribute("aria-pressed", String(state.statsView));
    // Stats isn't a content type — while it's active, none of All/News/
    // Video/Social should read as selected too; restore the real
    // selection (state.contentType) once Stats is toggled back off.
    elements.contentTabs?.querySelectorAll("[data-content-type]").forEach((tab) => {
      tab.setAttribute(
        "aria-selected",
        state.statsView ? "false" : String(tab.dataset.contentType === state.contentType)
      );
    });
    // The digest copy (format picker + "Copy") and the CSV download only
    // make sense for the mention list — on Stats, "Copy link" still works
    // (see copyCurrentLink(), which includes view=stats in the URL) and
    // the Stats "Copy" button takes over for copying the charts themselves.
    if (elements.copyEmailButton) elements.copyEmailButton.hidden = state.statsView;
    if (elements.copyFormatField) elements.copyFormatField.hidden = state.statsView;
    if (elements.downloadDataButton) elements.downloadDataButton.hidden = state.statsView;
    if (elements.copyStatsButton) elements.copyStatsButton.hidden = !state.statsView;
    if (elements.downloadAllPngButton) elements.downloadAllPngButton.hidden = !state.statsView;
  }

  function statusInfo(source) {
    if (!source.enabled) return { text: "Disabled", status: null };
    if (source.status === "error") return { text: "Temporarily unavailable", status: "error" };
    if (source.cached) return { text: "Connected (cached)", status: "success" };
    return { text: "Connected", status: "success" };
  }

  // Two-level filter, same pattern as the Monitors sidebar: a collapsed-by-
  // default group per source type, expanding to individual source
  // checkboxes — so you can narrow to one or more specific sources, not
  // just a whole type at once.
  function renderSourceFilter(sources) {
    if (!elements.sourceFilter) return;
    elements.sourceFilter.dataset.loading = "false";

    const groups = groupBy(sources, (s) => s.type);
    elements.sourceFilter.innerHTML =
      "<legend>Filter by source</legend>" +
      sortedGroupEntries(groups, (type) => SOURCE_TYPE_LABELS[type] || type)
        .map(([, groupLabel, groupSources]) => {
          return `
        <details class="mm-facet-group">
          <summary>${escapeHtml(groupLabel)} <span class="app-help-text">(${groupSources.length})</span></summary>
          <ul class="search-facet-list">
            ${groupSources
              .map((source) => {
                const id = `source-${source.id}`;
                const checked = state.selectedSources.has(source.id);
                return (
                  `<li><label for="${id}">` +
                  `<input type="checkbox" id="${id}" data-source-id="${escapeHtml(source.id)}" ${checked ? "checked" : ""}>` +
                  `${escapeHtml(source.name)} <span class="app-help-text">(${source.itemCount || 0})</span>` +
                  `</label></li>`
                );
              })
              .join("")}
          </ul>
        </details>`;
        })
        .join("");

    elements.sourceFilter.querySelectorAll("input[data-source-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.sourceId;
        if (checkbox.checked) state.selectedSources.add(id);
        else state.selectedSources.delete(id);
        // Re-render just the table, not the whole filter panel — otherwise
        // every checkbox click would collapse any <details> group you had
        // open, since renderSourceFilter() redraws it from scratch.
        renderSourceTableRows();
      });
    });
  }

  function renderSourceTableRows() {
    if (!state.data || !elements.sourcesWrap) return;
    const sources = state.data.sources || [];
    const visible =
      state.selectedSources.size === 0 ? sources : sources.filter((s) => state.selectedSources.has(s.id));

    elements.sourcesWrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th><button type="button" class="mm-sort-button" data-sort-key="name">Source</button></th>
            <th><button type="button" class="mm-sort-button" data-sort-key="region">Geography</button></th>
            <th><button type="button" class="mm-sort-button" data-sort-key="method">Ingestion</button></th>
            <th><button type="button" class="mm-sort-button" data-sort-key="status">Status</button></th>
            <th><button type="button" class="mm-sort-button" data-sort-key="lastchecked">Last checked</button></th>
            <th><button type="button" class="mm-sort-button" data-sort-key="items">Items</button></th>
            <th>Filter</th>
          </tr>
        </thead>
        <tbody>
          ${visible
            .map((source) => {
              const { text: statusText, status } = statusInfo(source);
              const statusMarkup = status
                ? `<span class="app-status" data-status="${status}">${escapeHtml(statusText)}</span>`
                : `<span class="app-badge">${escapeHtml(statusText)}</span>`;
              const lastChecked = source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleString() : "Never";
              const nameMarkup = source.link
                ? `<a href="${escapeHtml(source.link)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>`
                : escapeHtml(source.name);
              return `<tr
                data-sort-name="${escapeHtml(source.name)}"
                data-sort-region="${escapeHtml(source.region || "")}"
                data-sort-method="${escapeHtml(source.type)}"
                data-sort-status="${escapeHtml(statusText)}"
                data-sort-lastchecked="${escapeHtml(source.lastFetchedAt || "")}"
                data-sort-items="${source.itemCount || 0}"
              >
                <td>${nameMarkup}</td>
                <td>${escapeHtml(source.region || "—")}</td>
                <td>${escapeHtml(SOURCE_TYPE_LABELS[source.type] || source.type)}</td>
                <td>${statusMarkup}${source.statusDetail ? ` <span class="app-help-text">(${escapeHtml(source.statusDetail)})</span>` : ""}</td>
                <td>${escapeHtml(lastChecked)}</td>
                <td>${source.itemCount || 0}</td>
                <td><button type="button" class="secondary" data-goto-feed-source="${escapeHtml(source.id)}">Filter</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    wireSourceTableSort(elements.sourcesWrap.querySelector("table"));
  }

  function renderSourcesTable() {
    if (!state.data) return;
    renderSourceFilter(state.data.sources || []);
    renderSourceTableRows();
  }

  // shared/app-shell.js has a generic sortable-table behavior, but it only
  // wires up tables present at page load — this one is rendered later,
  // once data.json has loaded, so it needs its own (same technique: sort
  // rows by their data-sort-<key> attribute, toggle direction on repeat
  // clicks). Persisted on state so the sort survives switching source-type
  // tabs, which re-renders this table.
  function applySourceSort(table) {
    if (!state.sourceSortKey) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;
    const rows = Array.from(tbody.children);
    rows.sort((a, b) => {
      const valueA = a.getAttribute(`data-sort-${state.sourceSortKey}`) ?? "";
      const valueB = b.getAttribute(`data-sort-${state.sourceSortKey}`) ?? "";
      const result = valueA.localeCompare(valueB, undefined, { numeric: true, sensitivity: "base" });
      return state.sourceSortDirection === "ascending" ? result : -result;
    });
    tbody.append(...rows);
    table.querySelectorAll(".mm-sort-button").forEach((button) => {
      button.closest("th")?.setAttribute(
        "aria-sort",
        button.dataset.sortKey === state.sourceSortKey ? state.sourceSortDirection : "none"
      );
    });
  }

  function wireSourceTableSort(table) {
    if (!table) return;
    table.querySelectorAll(".mm-sort-button").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.sortKey;
        state.sourceSortDirection =
          state.sourceSortKey === key && state.sourceSortDirection === "ascending" ? "descending" : "ascending";
        state.sourceSortKey = key;
        applySourceSort(table);
      });
    });
    applySourceSort(table);
  }

  // An include/exclude entry is normally a single phrase, but can be a list
  // of phrases meaning ALL of them must appear together (see
  // config/monitors.yaml's header comment and build/match.js).
  // "word:MCA" (see build/match.js) means "match as a whole word" — strip
  // the prefix for display, same as the build pipeline does for
  // matchedTerms.
  function stripWordPrefix(term) {
    return typeof term === "string" && term.startsWith("word:") ? term.slice(5) : term;
  }

  function entryLabel(entry) {
    return Array.isArray(entry) ? entry.map(stripWordPrefix).join(" AND ") : stripWordPrefix(entry);
  }

  function renderTermList(entries) {
    return `<div class="mm-terms">${entries.map((entry) => `<span class="mm-term">${escapeHtml(entryLabel(entry))}</span>`).join("")}</div>`;
  }

  /** A card's matched-monitor badges — each one a button that jumps the
   * sidebar filter to just that monitor, so clicking "Marin County
   * Sheriff" on a card shows every other mention that monitor caught. */
  function renderMonitorBadges(matchedMonitorIds) {
    if (!matchedMonitorIds?.length) return "";
    return `<div class="mm-terms">${matchedMonitorIds
      .map((id) => {
        const monitor = state.data.monitors.find((m) => m.id === id);
        return `<button type="button" class="mm-term mm-term--button" data-filter-monitor="${escapeHtml(id)}">${escapeHtml(monitor?.name || id)}</button>`;
      })
      .join("")}</div>`;
  }

  /** Set the sidebar filter to exactly one monitor (replacing whatever was
   * selected), used by clicking a monitor badge on a card. Syncs the
   * sidebar's own checkboxes/open state so the UI doesn't show a filter
   * that's out of sync with what's actually applied. */
  function selectOnlyMonitor(monitorId) {
    state.selectedMonitors = new Set([monitorId]);
    elements.monitorChips?.querySelectorAll("input[data-monitor-id]").forEach((checkbox) => {
      checkbox.checked = checkbox.dataset.monitorId === monitorId;
    });
    const checkbox = elements.monitorChips?.querySelector(`input[data-monitor-id="${monitorId}"]`);
    const details = checkbox?.closest("details");
    if (details) details.open = true;
    syncUrlFromState();
    renderFeed();
  }

  /** Same as selectOnlyMonitor, for the Console's feed-source filter —
   * used by the Sources page's "Filter" button. */
  function selectOnlyFeedSource(sourceId) {
    state.selectedFeedSources = new Set([sourceId]);
    elements.feedSourceFilter?.querySelectorAll("input[data-feed-source-id]").forEach((checkbox) => {
      checkbox.checked = checkbox.dataset.feedSourceId === sourceId;
    });
    const checkbox = elements.feedSourceFilter?.querySelector(`input[data-feed-source-id="${sourceId}"]`);
    const details = checkbox?.closest("details");
    if (details) details.open = true;
    syncUrlFromState();
    renderFeed();
  }

  /** The Monitors and Sources pages' "Filter" buttons jump to the Latest
   * tab with that one monitor/source applied — switching the hash first
   * so app-shell's tab-section logic shows #latest before the filter
   * panel's own open/checked state gets updated underneath it. */
  function goToLatestFilteredBy(applyFilter) {
    window.location.hash = "latest";
    applyFilter();
  }

  function renderMonitorsList() {
    if (!state.data || !elements.monitorsList) return;
    const monitors = state.data.monitors || [];
    const groups = groupBy(monitors, (m) => m.group || "General");

    elements.monitorsList.innerHTML = sortedGroupEntries(groups, (key) => key, MONITOR_GROUP_ORDER)
      .map(
        ([groupName, , groupMonitors]) => `
      <section class="mm-monitor-group">
        <h3>${escapeHtml(groupName)}</h3>
        ${groupMonitors
          .map(
            (monitor) => `
          <article class="app-card">
            <h4><button type="button" class="mm-monitor-name" data-goto-monitor="${escapeHtml(monitor.id)}">${escapeHtml(monitor.name)}</button></h4>
            <p class="app-help-text">Include</p>
            ${renderTermList(monitor.include)}
            ${monitor.exclude.length ? `<p class="app-help-text">Exclude</p>${renderTermList(monitor.exclude)}` : ""}
          </article>`
          )
          .join("")}
      </section>`
      )
      .join("");
  }

  /** Count occurrences of each key across entries, most-frequent first. */
  function topCounts(entries, limit = 10) {
    const counts = new Map();
    entries.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  /** Round a date down to the start of its hour or day, as a timestamp —
   * the bucket a mention at that instant belongs to. */
  function bucketStart(date, granularity) {
    return granularity === "hour"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime()
      : new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /** One point per bucket across the whole selected time window — including
   * empty buckets — so the line reflects actual gaps instead of compressing
   * them away. Sub-day windows (1h/24h) bucket by hour; everything longer
   * (3d and up, including "all") buckets by day, matching the granularity
   * the time filter's own labels already use ("Past 24 hours" vs "Past 7
   * days"). "all" has no fixed window, so its range comes from the oldest/
   * newest item actually present — same approach digestRangeLabel() uses. */
  function buildTimeline(items) {
    const granularity = state.time === "1h" || state.time === "24h" ? "hour" : "day";
    const bucketMs = granularity === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    let start;
    let end;
    if (state.time === "all") {
      if (!items.length) return { granularity, buckets: [] };
      const times = items.map((item) => new Date(item.publishedAt).getTime());
      start = bucketStart(new Date(Math.min(...times)), granularity);
      end = bucketStart(new Date(Math.max(...times)), granularity);
    } else {
      end = bucketStart(new Date(), granularity);
      start = bucketStart(new Date(Date.now() - TIME_WINDOWS_MS[state.time]), granularity);
    }

    const counts = new Map();
    items.forEach((item) => {
      const key = bucketStart(new Date(item.publishedAt), granularity);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const buckets = [];
    for (let t = start; t <= end; t += bucketMs) buckets.push([t, counts.get(t) || 0]);
    return { granularity, buckets };
  }

  /** Stats view: #stats-toggle, positioned right after Social in the
   * content-type tablist, swaps the mention list for a timeline of
   * mentions over the selected time period, top sources (excluding every
   * official source — the County's own releases/channels, not third-party
   * coverage volume), and top monitors — see syncStatsView(). All three
   * are scoped to `items` (the currently filtered list — same one
   * renderFeed() just drew cards from), not the whole dataset, and stay
   * current even while hidden, since this runs on every renderFeed() call
   * regardless of which view is showing. */
  function renderStats(items) {
    if (!state.data) return;

    renderLineChart("timeline", elements.statsTimelineCanvas, buildTimeline(items));

    const sourceCounts = topCounts(
      items.filter((item) => !state.officialSourceIds.has(item.sourceId)).map((item) => item.source)
    );
    const monitorCounts = topCounts(items.flatMap((item) => item.matchedMonitors)).map(([id, count]) => [
      state.data.monitors.find((m) => m.id === id)?.name || id,
      count,
    ]);

    renderBarChart("sources", elements.statsSourcesCanvas, sourceCounts);
    renderBarChart("monitors", elements.statsMonitorsCanvas, monitorCounts);
  }

  /** Canvas charts have no text content of their own — a screen reader
   * sees an empty image unless given something to say. Rebuilt from
   * data-chart-title (the static heading, set once in index.html) plus a
   * plain-text summary of what's actually plotted, recomputed every
   * render so it never goes stale as filters change. */
  function describeChart(canvas, summary) {
    if (!canvas) return;
    const title = canvas.dataset.chartTitle || "Chart";
    canvas.setAttribute("aria-label", summary ? `${title}. ${summary}` : title);
  }

  function renderLineChart(key, canvas, { granularity, buckets }) {
    if (!canvas || typeof Chart === "undefined") return;
    const labelFormat =
      granularity === "hour" ? { hour: "numeric" } : { month: "short", day: "numeric" };
    const labels = buckets.map(([t]) => new Date(t).toLocaleString([], labelFormat));
    const counts = buckets.map(([, count]) => count);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const peakIndex = total > 0 ? counts.indexOf(Math.max(...counts)) : -1;
    describeChart(
      canvas,
      total === 0
        ? "No mentions in the selected period."
        : `${total} total, peaking at ${counts[peakIndex]} on ${labels[peakIndex]}.`
    );
    const data = {
      labels,
      datasets: [{ data: counts, borderColor: "#0777cf", backgroundColor: "#0777cf", tension: 0 }],
    };
    if (state.statsCharts[key]) {
      state.statsCharts[key].data = data;
      state.statsCharts[key].update();
      return;
    }
    state.statsCharts[key] = new Chart(canvas, {
      type: "line",
      data,
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { precision: 0 }, beginAtZero: true } },
      },
    });
  }

  function renderBarChart(key, canvas, entries) {
    if (!canvas || typeof Chart === "undefined") return;
    describeChart(
      canvas,
      entries.length === 0
        ? "No data for the current filters."
        : `Top: ${entries[0][0]} with ${entries[0][1]}, of ${entries.length} shown.`
    );
    const data = {
      labels: entries.map(([label]) => label),
      datasets: [{ data: entries.map(([, count]) => count), backgroundColor: "#0777cf" }],
    };
    if (state.statsCharts[key]) {
      state.statsCharts[key].data = data;
      state.statsCharts[key].update();
      return;
    }
    state.statsCharts[key] = new Chart(canvas, {
      type: "bar",
      data,
      options: {
        indexAxis: "y", // horizontal bars read best for a ranked list with long text labels
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { precision: 0 } } },
      },
    });
  }

  /** Build both clipboard flavors from the currently filtered items — the
   * exact list renderFeed() last showed on screen, same order. `text/html`
   * renders nicely when pasted into a rich-text email body; `text/plain`
   * is the fallback for plain-text clients. Mirrors what's on the cards
   * (source, time, title, snippet, link) — no matched-monitor/term detail,
   * to stay consistent with the cards themselves. */
  function matchedMonitorNames(item) {
    return item.matchedMonitors.map((id) => state.data.monitors.find((m) => m.id === id)?.name || id);
  }

  // Order (per request): heading, then date + source (date first), then
  // description, then which monitors matched.
  // "(Past 3 days)" — reuses the Time dropdown's own option text, so this
  // always matches what the sidebar/"Showing:" line say verbatim, for a
  // bounded time filter. "(since Aug 3, 2026)" for "All available data",
  // where there's no fixed window to name — derived from the oldest item
  // actually in the digest.
  function digestRangeLabel(items) {
    if (state.time !== "all") {
      const timeLabel = elements.timeSelect?.options[elements.timeSelect.selectedIndex]?.text;
      return `(${timeLabel || state.time})`;
    }
    if (!items.length) return "";
    const oldest = items.reduce((min, item) => Math.min(min, new Date(item.publishedAt).getTime()), Infinity);
    return `(since ${new Date(oldest).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })})`;
  }

  const DIGEST_EMOJI = "\u{1F514}"; // 🔔
  const COUNT_EMOJI = "\u{1F4A5}"; // 💥
  const TAG_EMOJI = "\u{1F3F7}\u{FE0F}"; // 🏷️
  const TITLE_EMOJI = "\u{1F7E2}"; // 🟢
  const RELEASE_EMOJI = "\u{1F4E3}"; // 📣

  function attributedRelease(item) {
    const releaseId = state.clippedItems.get(item.id)?.releaseId;
    if (!releaseId) return null;
    return state.releases.find((release) => release.id === releaseId) || null;
  }

  function digestMonitorsLine() {
    if (state.selectedMonitors.size === 0) return "";
    const names = state.data.monitors
      .filter((m) => state.selectedMonitors.has(m.id))
      .map((m) => m.name);
    return `${TAG_EMOJI} Monitors: ${names.join(", ")}`;
  }

  function buildDigest(items) {
    const now = new Date();
    const generatedDate = now.toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
    const headerLine1 = `${DIGEST_EMOJI} Marin Mentions — ${generatedDate}`;
    const headerLine2 = `${COUNT_EMOJI} ${items.length} mention${items.length === 1 ? "" : "s"} ${digestRangeLabel(items)}`;
    const monitorsLine = digestMonitorsLine();

    const textBlocks = items.map((item) => {
      const heading = item.title || item.text?.slice(0, 120) || item.source;
      const when = new Date(item.publishedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const monitors = matchedMonitorNames(item);
      const release = attributedRelease(item);
      const lines = [`${TITLE_EMOJI} ${heading}`, `${when} — ${item.source}`];
      if (item.title && item.text) lines.push(truncate(item.text, 220));
      if (release) {
        lines.push(`${RELEASE_EMOJI} Release: ${release.title} — ${release.url}`);
      }
      if (monitors.length) lines.push(`${TAG_EMOJI} ${monitors.join(", ")}`);
      lines.push(item.url);
      return lines.join("\n");
    });
    const text = [headerLine1, headerLine2, ...(monitorsLine ? [monitorsLine] : []), "", textBlocks.join("\n\n")].join(
      "\n"
    );

    // Gmail/Outlook/etc. paste-sanitizers routinely strip inline margin/
    // padding from pasted HTML, which silently ate the spacing here before
    // (div margins and an empty spacer div both vanished on paste). <br> is
    // structural content, not styling, so it survives — use it for every
    // gap that has to actually show up once pasted, not CSS margins. <i>/<b>
    // are plain inline formatting, not layout, so they survive too.
    const htmlBlocks = items.map((item) => {
      const heading = item.title || item.text?.slice(0, 120) || item.source;
      const when = new Date(item.publishedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const monitors = matchedMonitorNames(item);
      const release = attributedRelease(item);
      const fieldLines = [
        `<b>${TITLE_EMOJI} <a href="${escapeHtml(item.url)}">${escapeHtml(heading)}</a></b>`,
        `<i>${escapeHtml(when)}</i> &mdash; ${escapeHtml(item.source)}`,
      ];
      if (item.title && item.text) fieldLines.push(escapeHtml(truncate(item.text, 220)));
      if (release) {
        fieldLines.push(
          `${RELEASE_EMOJI} Release: <a href="${escapeHtml(release.url)}">${escapeHtml(release.title)}</a>`
        );
      }
      if (monitors.length) fieldLines.push(`${TAG_EMOJI} ${escapeHtml(monitors.join(", "))}`);
      return fieldLines.join("<br>");
    });
    const htmlHeaderLine1 = `${DIGEST_EMOJI} Marin Mentions — <i>${escapeHtml(generatedDate)}</i>`;
    const html =
      `<div><b>${htmlHeaderLine1}</b><br>${escapeHtml(headerLine2)}` +
      `${monitorsLine ? `<br>${escapeHtml(monitorsLine)}` : ""}<br><br>` +
      `${htmlBlocks.join("<br><br>")}</div>`;

    return { text, html };
  }

  /** "Releases + news": one release header per attributed release, followed
   * by every clipped story attributed to it (heading + byline only, no
   * per-story link/monitors — those collapse into one shared tags line per
   * group instead of repeating per story). Items with no attributed release
   * trail at the end as their own plain entries, same shape as buildDigest's. */
  function buildReleasesFirstDigest(items) {
    const now = new Date();
    const generatedDate = now.toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
    const headerLine1 = `${DIGEST_EMOJI} Marin Mentions — ${generatedDate}`;
    const headerLine2 = `${COUNT_EMOJI} ${items.length} mention${items.length === 1 ? "" : "s"} ${digestRangeLabel(items)}`;
    const monitorsLine = digestMonitorsLine();

    const byRelease = new Map(); // releaseId -> { release, items: [] }
    const ungrouped = [];
    items.forEach((item) => {
      const release = attributedRelease(item);
      if (!release) {
        ungrouped.push(item);
        return;
      }
      if (!byRelease.has(release.id)) byRelease.set(release.id, { release, items: [] });
      byRelease.get(release.id).items.push(item);
    });
    // state.releases is already newest-first — walk it instead of byRelease's
    // insertion order so groups come out newest-release-first regardless of
    // which order the items happened to be clipped in.
    const groups = state.releases.filter((release) => byRelease.has(release.id)).map((release) => byRelease.get(release.id));

    function groupMonitorNames(groupItems) {
      const names = new Set();
      groupItems.forEach((item) => matchedMonitorNames(item).forEach((name) => names.add(name)));
      return [...names];
    }

    function storyLines(item) {
      const heading = item.title || item.text?.slice(0, 120) || item.source;
      const when = new Date(item.publishedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const lines = [`${TITLE_EMOJI} ${heading}`, `${when} — ${item.source}`];
      if (item.title && item.text) lines.push(truncate(item.text, 220));
      return lines;
    }

    const textSections = groups.map(({ release, items: groupItems }) => {
      const lines = [`${RELEASE_EMOJI} Release: ${release.title}`, ""];
      groupItems.forEach((item) => lines.push(...storyLines(item)));
      const tags = groupMonitorNames(groupItems);
      if (tags.length) lines.push(`${TAG_EMOJI} ${tags.join(", ")}`);
      return lines.join("\n");
    });
    if (ungrouped.length) {
      textSections.push(
        ...ungrouped.map((item) => {
          const lines = storyLines(item);
          const monitors = matchedMonitorNames(item);
          if (monitors.length) lines.push(`${TAG_EMOJI} ${monitors.join(", ")}`);
          lines.push(item.url);
          return lines.join("\n");
        })
      );
    }
    const text = [
      headerLine1,
      headerLine2,
      ...(monitorsLine ? [monitorsLine] : []),
      "",
      textSections.join("\n\n"),
    ].join("\n");

    function storyHtmlLines(item) {
      const heading = item.title || item.text?.slice(0, 120) || item.source;
      const when = new Date(item.publishedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const lines = [
        `<b>${TITLE_EMOJI} <a href="${escapeHtml(item.url)}">${escapeHtml(heading)}</a></b>`,
        `<i>${escapeHtml(when)}</i> &mdash; ${escapeHtml(item.source)}`,
      ];
      if (item.title && item.text) lines.push(escapeHtml(truncate(item.text, 220)));
      return lines;
    }

    const htmlSections = groups.map(({ release, items: groupItems }) => {
      const lines = [`<b>${RELEASE_EMOJI} Release: <a href="${escapeHtml(release.url)}">${escapeHtml(release.title)}</a></b>`, ""];
      groupItems.forEach((item) => lines.push(...storyHtmlLines(item)));
      const tags = groupMonitorNames(groupItems);
      if (tags.length) lines.push(`${TAG_EMOJI} ${escapeHtml(tags.join(", "))}`);
      return lines.join("<br>");
    });
    if (ungrouped.length) {
      htmlSections.push(
        ...ungrouped.map((item) => {
          const lines = storyHtmlLines(item);
          const monitors = matchedMonitorNames(item);
          if (monitors.length) lines.push(`${TAG_EMOJI} ${escapeHtml(monitors.join(", "))}`);
          return lines.join("<br>");
        })
      );
    }
    const htmlHeaderLine1 = `${DIGEST_EMOJI} Marin Mentions — <i>${escapeHtml(generatedDate)}</i>`;
    const html =
      `<div><b>${htmlHeaderLine1}</b><br>${escapeHtml(headerLine2)}` +
      `${monitorsLine ? `<br>${escapeHtml(monitorsLine)}` : ""}<br><br>` +
      `${htmlSections.join("<br><br>")}</div>`;

    return { text, html };
  }

  function showCopyFallback(text) {
    if (!elements.copyFallback || !elements.copyFallbackText) return;
    elements.copyFallbackText.value = text;
    elements.copyFallback.hidden = false;
    elements.copyFallbackText.focus();
    elements.copyFallbackText.select();
  }

  /** Copy rich HTML to the clipboard the same way marin-magic's "Copy rich
   * text" button does: render it into a hidden contenteditable element,
   * select that element's contents, and let the browser's native
   * execCommand("copy") capture both the HTML and plain-text clipboard
   * flavors from the real selection — broader, longer-standing browser
   * support than writing multiple flavors via the async Clipboard API. */
  function copyRichTextToClipboard(html) {
    const temp = document.createElement("div");
    temp.contentEditable = "true";
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    temp.innerHTML = html;
    document.body.appendChild(temp);
    const range = document.createRange();
    range.selectNodeContents(temp);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const copied = document.execCommand("copy");
    selection.removeAllRanges();
    document.body.removeChild(temp);
    return copied;
  }

  function copyDigestToClipboard() {
    // Clipping is purely additive: with nothing clipped, Copy still means
    // "everything currently filtered," unchanged from before this feature.
    // Once at least one item is clipped, Copy narrows to just those.
    const allFiltered = state.lastFilteredItems || [];
    const items =
      state.clippedItems.size > 0 ? allFiltered.filter((item) => state.clippedItems.has(item.id)) : allFiltered;
    if (items.length === 0) {
      announce("No mentions to copy — adjust the filters first.");
      return;
    }

    const { text, html } =
      elements.copyFormatSelect?.value === "releases-news" ? buildReleasesFirstDigest(items) : buildDigest(items);
    if (elements.copyFallback) elements.copyFallback.hidden = true;

    try {
      const copied = copyRichTextToClipboard(html);
      if (!copied) throw new Error("execCommand(\"copy\") returned false");
      announce(`Copied ${items.length} mention${items.length === 1 ? "" : "s"} to clipboard.`);
    } catch (error) {
      console.error(error);
      showCopyFallback(text);
      announce("Couldn't copy automatically — select the text below and copy it manually.");
    }
  }

  /** Shared by copyCurrentLink() and copyStatsToClipboard()'s no-image-
   * support fallback — writeText when available, else the execCommand
   * contenteditable trick, else the visible textarea fallback. */
  function copyPlainTextToClipboard(text, successMessage) {
    if (elements.copyFallback) elements.copyFallback.hidden = true;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => announce(successMessage))
        .catch(() => {
          showCopyFallback(text);
          announce("Couldn't copy automatically — select the text below and copy it manually.");
        });
      return;
    }

    try {
      const copied = copyRichTextToClipboard(text);
      if (!copied) throw new Error("execCommand(\"copy\") returned false");
      announce(successMessage);
    } catch (error) {
      console.error(error);
      showCopyFallback(text);
      announce("Couldn't copy automatically — select the text below and copy it manually.");
    }
  }

  function copyCurrentLink() {
    copyPlainTextToClipboard(window.location.href, "Copied link to clipboard.");
  }

  /** Filesystem-safe date matching the digest header's own date format
   * ("Sep 22, 2026") — every downloaded filename uses it, so exports read
   * consistently with the in-app "Marin Mentions — {date}" heading. */
  function filenameDate() {
    return new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /** RFC 4180: quote a field (doubling any embedded quote) whenever it
   * contains a comma, quote, or newline; leave everything else bare. */
  function csvField(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(items) {
    const header = ["Title", "Source", "Published", "Type", "Monitors", "URL"];
    const rows = items.map((item) => [
      item.title || item.text?.slice(0, 120) || item.source,
      item.source,
      new Date(item.publishedAt).toISOString(),
      CONTENT_TYPE_GROUP_LABELS[item.sourceType] || item.sourceType,
      matchedMonitorNames(item).join("; "),
      item.url,
    ]);
    return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
  }

  /** Same item-selection rule as copyDigestToClipboard(): clipped-only
   * when anything's clipped, else everything currently filtered. */
  function downloadMentionsCsv() {
    const allFiltered = state.lastFilteredItems || [];
    const items =
      state.clippedItems.size > 0 ? allFiltered.filter((item) => state.clippedItems.has(item.id)) : allFiltered;
    if (items.length === 0) {
      announce("No mentions to download — adjust the filters first.");
      return;
    }
    triggerDownload(
      new Blob([toCsv(items)], { type: "text/csv;charset=utf-8" }),
      `Marin Mentions - ${filenameDate()}.csv`
    );
    announce(`Downloaded ${items.length} mention${items.length === 1 ? "" : "s"} as CSV.`);
  }

  function downloadChartPng(key) {
    const chart = state.statsCharts[key];
    if (!chart) return;
    const title = chart.canvas.dataset.chartTitle || "Chart";
    chart.canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `Marin Mentions - ${title} - ${filenameDate()}.png`);
    });
  }

  function downloadAllChartPngs() {
    // A tiny stagger between triggers — some browsers only reliably allow
    // one programmatic download per tick without treating the rest as
    // unrequested/blocked, even within the same click's user activation.
    ["timeline", "sources", "monitors"].forEach((key, index) => {
      setTimeout(() => downloadChartPng(key), index * 150);
    });
  }

  /** describeChart() sets aria-label to "{title}. {summary}" (or just
   * "{title}" if there's nothing to summarize) — strip the leading title
   * back off so it isn't repeated under a bold heading that already shows
   * it, for both the plain-text and HTML flavors below. */
  function chartSummaryOnly(canvas) {
    const title = canvas?.dataset.chartTitle || "";
    const label = canvas?.getAttribute("aria-label") || "";
    return label.startsWith(`${title}.`) ? label.slice(title.length + 1).trim() : "";
  }

  function buildStatsSummaryText() {
    const monitorsLine = digestMonitorsLine();
    const lines = [`${DIGEST_EMOJI} Marin Mentions Stats — ${filenameDate()}`, ...(monitorsLine ? [monitorsLine] : []), ""];
    [elements.statsTimelineCanvas, elements.statsSourcesCanvas, elements.statsMonitorsCanvas].forEach((canvas) => {
      if (!canvas) return;
      lines.push(canvas.dataset.chartTitle || "Chart");
      const summary = chartSummaryOnly(canvas);
      if (summary) lines.push(summary);
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  /** Same header treatment as the news digest's own HTML flavor
   * (buildDigest()) — bold "Marin Mentions — {date}", <br> for every gap
   * that has to survive a paste-sanitizer (see buildDigest()'s comment on
   * why <br> instead of CSS margins) — plus a bold heading per chart,
   * matching how each news item's own headline is bold there.
   *
   * The chart image itself is embedded per-chart, as a base64 <img>
   * (canvas.toDataURL(), synchronous — no Promise/Blob timing to manage),
   * not written as a separate competing "image/png" clipboard flavor. An
   * earlier version tried the ClipboardItem multi-flavor route (image/png
   * + text/html as siblings); paste targets that accept both consistently
   * picked text/html and discarded the image, so what pasted was text and
   * a chart's alt text, never a picture. Embedding the image inside the
   * HTML itself removes that choice — wherever text/html renders, the
   * picture renders with it, the same way copyRichTextToClipboard() below
   * already reliably copies the news digest's images-and-all HTML. */
  function buildStatsSummaryHtml() {
    const htmlHeaderLine = `${DIGEST_EMOJI} Marin Mentions Stats — <i>${escapeHtml(filenameDate())}</i>`;
    const monitorsLine = digestMonitorsLine();
    const chartBlocks = [elements.statsTimelineCanvas, elements.statsSourcesCanvas, elements.statsMonitorsCanvas]
      .filter(Boolean)
      .map((canvas) => {
        const title = canvas.dataset.chartTitle || "Chart";
        const summary = chartSummaryOnly(canvas);
        // width/height as HTML attributes, not a style="max-width:100%"
        // rule — inline style gets stripped by paste-sanitizers (same
        // lesson as buildDigest()'s <br>-not-margin comment above), which
        // let each chart's embedded image fall back to its full native
        // pixel size (Chart.js renders at devicePixelRatio, often larger
        // than the on-screen CSS size) with nothing constraining it —
        // exactly the "last chart doesn't wrap like the others" symptom
        // this fixes. clientWidth/clientHeight is the actual on-screen
        // size, not the raw (possibly 2x+) canvas pixel buffer.
        return (
          `<b>${escapeHtml(title)}</b>` +
          (summary ? `<br>${escapeHtml(summary)}` : "") +
          `<br><img src="${canvas.toDataURL("image/png")}" alt="${escapeHtml(title)}" width="${canvas.clientWidth}" height="${canvas.clientHeight}">`
        );
      });
    return (
      `<div><b>${htmlHeaderLine}</b>` +
      `${monitorsLine ? `<br>${escapeHtml(monitorsLine)}` : ""}<br><br>` +
      `${chartBlocks.join("<br><br>")}</div>`
    );
  }

  /** Copies all three charts (each embedded as a real image, not just
   * described in text) plus a text summary, using the exact same
   * execCommand-based copyRichTextToClipboard() the news digest already
   * uses successfully — see buildStatsSummaryHtml()'s comment for why
   * this replaced the original navigator.clipboard.write()/ClipboardItem
   * attempt. */
  function copyStatsToClipboard() {
    const text = buildStatsSummaryText();
    if (elements.copyFallback) elements.copyFallback.hidden = true;

    try {
      const copied = copyRichTextToClipboard(buildStatsSummaryHtml());
      if (!copied) throw new Error("execCommand(\"copy\") returned false");
      announce("Copied charts to clipboard.");
    } catch (error) {
      console.error(error);
      showCopyFallback(text);
      announce("Couldn't copy automatically — select the text below and copy it manually.");
    }
  }

  elements.copyEmailButton?.addEventListener("click", copyDigestToClipboard);
  elements.copyLinkButton?.addEventListener("click", copyCurrentLink);
  elements.copyStatsButton?.addEventListener("click", copyStatsToClipboard);
  elements.downloadDataButton?.addEventListener("click", downloadMentionsCsv);
  elements.downloadAllPngButton?.addEventListener("click", downloadAllChartPngs);
  document.querySelectorAll("[data-chart-download]").forEach((button) => {
    button.addEventListener("click", () => downloadChartPng(button.dataset.chartDownload));
  });

  // Delegated: #media-feed's cards are fully re-rendered on every filter
  // change, so listeners are attached once here rather than per-card.
  elements.feed?.addEventListener("click", (event) => {
    const badge = event.target.closest("[data-filter-monitor]");
    if (!badge) return;
    selectOnlyMonitor(badge.dataset.filterMonitor);
  });

  // Clipping and release attribution: toggle just the affected card's
  // release dropdown in place rather than a full renderFeed(), since a
  // single checkbox/select change doesn't affect which items match the
  // current filters.
  elements.feed?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-clip-id]");
    if (checkbox) {
      const id = checkbox.dataset.clipId;
      const releaseWrap = checkbox.closest(".mm-card")?.querySelector(".mm-card__release");
      if (checkbox.checked) {
        if (!state.clippedItems.has(id)) state.clippedItems.set(id, { releaseId: null });
        if (releaseWrap) releaseWrap.hidden = false;
      } else {
        state.clippedItems.delete(id);
        if (releaseWrap) {
          releaseWrap.hidden = true;
          const select = releaseWrap.querySelector("select");
          if (select) select.value = "";
        }
      }
      return;
    }

    const select = event.target.closest("[data-release-for]");
    if (select) {
      const clip = state.clippedItems.get(select.dataset.releaseFor);
      if (clip) clip.releaseId = select.value || null;
    }
  });

  // Delegated for the same reason as #media-feed above — renderMonitorsList()
  // and renderSourceTableRows() redraw their lists from scratch on every
  // data refresh/sort.
  elements.monitorsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-goto-monitor]");
    if (!button) return;
    goToLatestFilteredBy(() => selectOnlyMonitor(button.dataset.gotoMonitor));
  });

  elements.sourcesWrap?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-goto-feed-source]");
    if (!button) return;
    goToLatestFilteredBy(() => selectOnlyFeedSource(button.dataset.gotoFeedSource));
  });

  elements.contentTabs?.addEventListener("click", (event) => {
    const statsButton = event.target.closest("#stats-toggle");
    if (statsButton) {
      state.statsView = !state.statsView;
      syncStatsView();
      syncUrlFromState(); // so Copy Link's window.location.href includes view=stats
      // Chart.js sizes a canvas at creation time — the first renderStats()
      // call happens while #stats-grid is still hidden (0 width), so a
      // freshly-created chart needs an explicit resize once it's actually
      // visible, or it stays sized to nothing.
      if (state.statsView) Object.values(state.statsCharts).forEach((chart) => chart?.resize());
      return;
    }

    const button = event.target.closest("[data-content-type]");
    if (!button) return;
    state.contentType = button.dataset.contentType;
    state.statsView = false;
    elements.contentTabs.querySelectorAll("[data-content-type]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab === button));
    });
    syncUrlFromState();
    renderFeed();
  });

  let searchUrlSyncTimer;
  elements.searchInput?.addEventListener("input", () => {
    state.search = elements.searchInput.value.trim();
    // Debounced: this fires on every keystroke, and replaceState() on
    // every one of them is wasted work renderFeed() doesn't need to wait
    // on — the URL just needs to catch up shortly after typing settles.
    clearTimeout(searchUrlSyncTimer);
    searchUrlSyncTimer = setTimeout(syncUrlFromState, 300);
    renderFeed();
  });

  elements.timeSelect?.addEventListener("change", () => {
    state.time = elements.timeSelect.value;
    syncUrlFromState();
    renderFeed();
  });

  elements.filtersForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    loadData({ isRefresh: true });
  });

  function resetFilters() {
    state.search = "";
    if (elements.searchInput) elements.searchInput.value = "";
    state.selectedMonitors = new Set();
    state.selectedFeedSources = new Set();
    state.time = "24h";
    if (elements.timeSelect) elements.timeSelect.value = "24h";
    state.contentType = "all";
    state.statsView = false;
    elements.contentTabs?.querySelectorAll("[data-content-type]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.contentType === "all"));
    });
    // Full re-render, not just renderFeed(): the monitor/platform sidebars
    // need to redraw too, since resetting to empty Sets means "recompute
    // the default selection," and the monitor groups should collapse back
    // to closed the same way they start on first load.
    renderMonitorChips();
    renderFeedSourceFilter();
    syncUrlFromState();
    renderFeed();
    announce("Filters reset.");
  }

  elements.resetButton?.addEventListener("click", resetFilters);

  elements.selectAllCheckbox?.addEventListener("change", () => {
    const items = state.lastFilteredItems || [];
    if (elements.selectAllCheckbox.checked) {
      items.forEach((item) => {
        if (!state.clippedItems.has(item.id)) state.clippedItems.set(item.id, { releaseId: null });
      });
    } else {
      items.forEach((item) => state.clippedItems.delete(item.id));
    }
    renderFeed();
  });

  // shared/app-shell.js's tab-section logic only syncs aria-current on
  // #app-nav (also its mobile menu-toggle target) — #page-tabs is a
  // second, always-visible nav below the header for Latest/Sources/
  // Monitors, so it needs its own sync. Don't edit the vendored
  // app-shell.js for this; mirror its logic here instead.
  const pageTabs = document.querySelector("#page-tabs");
  if (pageTabs) {
    const pageTabNames = Array.from(pageTabs.querySelectorAll("a[href^='#']"), (a) => a.getAttribute("href").slice(1));
    const syncPageTabs = () => {
      const rawHash = window.location.hash.slice(1);
      const hash = pageTabNames.includes(rawHash) ? rawHash : "latest";
      pageTabs.querySelectorAll("a[href^='#']").forEach((link) => {
        if (link.getAttribute("href") === `#${hash}`) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    };
    window.addEventListener("hashchange", syncPageTabs);
    syncPageTabs();

    // Latest should always mean "start fresh" — reset every filter and
    // land on the All content-type tab, not whatever was last selected.
    const latestLink = pageTabs.querySelector('a[href="#latest"]');
    latestLink?.addEventListener("click", () => resetFilters());
  }

  // Clicking a tab link (Home in the header #app-nav, or any of
  // Latest/Monitors/Sources/Stats in #page-tabs) should always show that
  // tab from the top. Without this, clicking Home while already on #latest
  // but scrolled down into the filter form does nothing — the hash doesn't
  // change, so no hashchange event fires and the page stays wherever it
  // was scrolled. Scroll on click itself instead of on hashchange so the
  // same-hash case is covered too, not just an actual tab switch.
  function scrollToTopOnTabClick(nav) {
    nav?.addEventListener("click", (event) => {
      if (event.target.closest("a[href^='#']")) window.scrollTo({ top: 0, behavior: "instant" });
    });
  }
  scrollToTopOnTabClick(document.querySelector("#app-nav"));
  scrollToTopOnTabClick(pageTabs);

  loadData();
});
