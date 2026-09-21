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
    time: "24h",
    selectedSources: new Set(),
    sourceSortKey: "name",
    sourceSortDirection: "ascending",
  };

  const elements = {
    monitorChips: document.querySelector("#monitor-chips"),
    feedSourceFilter: document.querySelector("#feed-source-filter"),
    contentTabs: document.querySelector("#content-tabs"),
    searchInput: document.querySelector("#filter-search"),
    timeSelect: document.querySelector("#filter-time"),
    filtersForm: document.querySelector("#filters"),
    refreshButton: document.querySelector("#refresh-button"),
    resetButton: document.querySelector("#reset-filters-button"),
    lastUpdated: document.querySelector("#last-updated"),
    activeFilters: document.querySelector("#active-filters"),
    counts: document.querySelector("#mention-counts"),
    feed: document.querySelector("#media-feed"),
    statusMessage: document.querySelector("#app-status-message"),
    sourcesWrap: document.querySelector("#sources-table-wrap"),
    sourceFilter: document.querySelector("#source-filter"),
    monitorsList: document.querySelector("#monitors-list"),
    copyEmailButton: document.querySelector("#copy-email-button"),
    copyLinkButton: document.querySelector("#copy-link-button"),
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
    reddit: "social",
    nextdoor: "social",
  };
  const CONTENT_TYPE_GROUP_LABELS = { news: "News", video: "Video", social: "Social" };
  const CONTENT_TYPE_GROUP_ORDER = ["news", "video", "social"];

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
    renderFeed();
    renderSourcesTable();
    renderMonitorsList();
  }

  function renderLastUpdated() {
    if (!state.data || !elements.lastUpdated) return;
    const date = new Date(state.data.generatedAt);
    elements.lastUpdated.innerHTML =
      `Last updated: <time datetime="${date.toISOString()}">${escapeHtml(
        date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      )}</time>` + ` (updates every 10&ndash;15 minutes)`;
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

  /** groupBy()'s Map, as [groupLabel, items] entries sorted alphabetically
   * by group label — every filter/subfilter panel orders both its groups
   * and the items within them alphabetically, so the sidebar is always
   * scannable regardless of config file order. */
  function sortedGroupEntries(groups, labelFn = (key) => key) {
    return Array.from(groups.entries())
      .map(([key, items]) => [key, labelFn(key), [...items].sort(byName)])
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: "base" }));
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
      sortedGroupEntries(groups)
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
      sortedGroupEntries(groups, (key) => CONTENT_TYPE_GROUP_LABELS[key] || key)
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
    if (state.contentType !== "all" && item.sourceType !== state.contentType) return false;
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

  function renderCard(item) {
    const date = new Date(item.publishedAt);
    const heading = item.title || item.text?.slice(0, 120) || item.source;
    const showSeparateSnippet = item.title && item.text;
    const favicon = faviconUrl(item);

    return (
      `<li class="app-card mm-card">` +
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

  function renderFeed() {
    if (!state.data || !elements.feed) return;
    const items = state.data.items.filter(matchesFilters);
    state.lastFilteredItems = items;

    if (elements.activeFilters) elements.activeFilters.textContent = `Showing: ${describeActiveFilters()}`;

    const counts = { news: 0, video: 0, social: 0 };
    items.forEach((item) => {
      counts[item.sourceType] = (counts[item.sourceType] || 0) + 1;
    });
    if (elements.counts) {
      elements.counts.textContent =
        `${items.length} mention${items.length === 1 ? "" : "s"} — ` +
        `News ${counts.news}, Video ${counts.video}, Social ${counts.social}`;
    }

    elements.feed.innerHTML = items.length
      ? items.map(renderCard).join("")
      : '<li class="app-empty">No mentions match the current filters.</li>';

    updateFacetCounts();
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

    elements.monitorsList.innerHTML = sortedGroupEntries(groups)
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
      const lines = [`${TITLE_EMOJI} ${heading}`, `${when} — ${item.source}`];
      if (item.title && item.text) lines.push(truncate(item.text, 220));
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
      const fieldLines = [
        `<b>${TITLE_EMOJI} <a href="${escapeHtml(item.url)}">${escapeHtml(heading)}</a></b>`,
        `<i>${escapeHtml(when)}</i> &mdash; ${escapeHtml(item.source)}`,
      ];
      if (item.title && item.text) fieldLines.push(escapeHtml(truncate(item.text, 220)));
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
    const items = state.lastFilteredItems || [];
    if (items.length === 0) {
      announce("No mentions to copy — adjust the filters first.");
      return;
    }

    const { text, html } = buildDigest(items);
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

  function copyCurrentLink() {
    const url = window.location.href;
    if (elements.copyFallback) elements.copyFallback.hidden = true;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => announce("Copied link to clipboard."))
        .catch(() => {
          showCopyFallback(url);
          announce("Couldn't copy automatically — select the text below and copy it manually.");
        });
      return;
    }

    try {
      const copied = copyRichTextToClipboard(url);
      if (!copied) throw new Error("execCommand(\"copy\") returned false");
      announce("Copied link to clipboard.");
    } catch (error) {
      console.error(error);
      showCopyFallback(url);
      announce("Couldn't copy automatically — select the text below and copy it manually.");
    }
  }

  elements.copyEmailButton?.addEventListener("click", copyDigestToClipboard);
  elements.copyLinkButton?.addEventListener("click", copyCurrentLink);

  // Delegated: #media-feed's cards are fully re-rendered on every filter
  // change, so listeners are attached once here rather than per-card.
  elements.feed?.addEventListener("click", (event) => {
    const badge = event.target.closest("[data-filter-monitor]");
    if (!badge) return;
    selectOnlyMonitor(badge.dataset.filterMonitor);
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
    const button = event.target.closest("[data-content-type]");
    if (!button) return;
    state.contentType = button.dataset.contentType;
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
  }

  loadData();
});
