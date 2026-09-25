(() => {
  const menuToggle = document.querySelector("#menu-toggle");
  const navigation = document.querySelector("#app-nav");
  const menuQuery = window.matchMedia("(max-width: 720px)");

  function closeMenu() {
    menuToggle?.setAttribute("aria-expanded", "false");
    navigation?.removeAttribute("data-open");
  }

  if (menuToggle && navigation) {
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(open));
      navigation.toggleAttribute("data-open", open);
    });

    navigation.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement && menuQuery.matches) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menuToggle.focus();
      }
    });

    menuQuery.addEventListener("change", (event) => {
      if (!event.matches) closeMenu();
    });
  }

  document.querySelectorAll(".menu").forEach((menu) => {
    const toggle = menu.querySelector(":scope > .menu-toggle");
    const panel = menu.querySelector(":scope > .menu-panel");
    if (!toggle || !panel) return;

    function closeMenuPanel() {
      toggle.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      document.querySelectorAll(".menu-toggle[aria-expanded='true']").forEach((otherToggle) => {
        if (otherToggle !== toggle) {
          otherToggle.setAttribute("aria-expanded", "false");
          otherToggle.closest(".menu")?.querySelector(":scope > .menu-panel")?.setAttribute("hidden", "");
        }
      });
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });

    panel.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) closeMenuPanel();
    });

    document.addEventListener("click", (event) => {
      if (toggle.getAttribute("aria-expanded") === "true" && !menu.contains(event.target)) closeMenuPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        closeMenuPanel();
        toggle.focus();
      }
    });
  });

  // MarinOS banner menu: refresh from marinos/catalog.json so a new app
  // shows up in every other app's banner automatically, instead of every
  // app's HTML needing a hand edit. Falls back to the page's static links —
  // never touches the DOM — if the fetch fails, times out, or the response
  // isn't shaped as expected. Cached in localStorage for a few hours so a
  // visit doesn't refetch the catalog on every page load.
  const marinosMenuPanel = document.querySelector("#marinos-menu-panel");
  if (marinosMenuPanel) {
    const CATALOG_URL = "https://marincountygov.github.io/marin-os/catalog.json";
    // Bump this whenever the expected catalog shape or rendering changes
    // (for example, adding the `icon` field) so browsers holding an older
    // cached shape refetch immediately instead of waiting out the TTL.
    const CACHE_KEY = "marinos-catalog-cache-v2";
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

    function readCatalogCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== "number") return null;
        if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
        return parsed.entries;
      } catch {
        return null;
      }
    }

    function writeCatalogCache(entries) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, fetchedAt: Date.now() }));
      } catch {
        // Storage full or unavailable — refetching next load is fine.
      }
    }

    function renderMarinosMenu(entries) {
      if (!Array.isArray(entries)) return;
      const current = window.location.href;
      const items = entries.filter((entry) => entry && entry.url && entry.name && !current.startsWith(entry.url));
      if (!items.length) return;

      const allLink = marinosMenuPanel.querySelector(".marinos-menu__all");
      marinosMenuPanel.querySelectorAll("a:not(.marinos-menu__all)").forEach((link) => link.remove());
      const links = items
        .map((entry) => {
          const icon =
            entry.icon && entry.icon.viewBox && entry.icon.markup
              ? `<span class="marinos-menu__icon" aria-hidden="true"><svg viewBox="${entry.icon.viewBox}">${entry.icon.markup}</svg></span>`
              : "";
          return `<a href="${entry.url}">${icon}${entry.name}</a>`;
        })
        .join("");
      if (allLink) allLink.insertAdjacentHTML("beforebegin", links);
      else marinosMenuPanel.insertAdjacentHTML("beforeend", links);
    }

    // Stale-while-revalidate: the cache is only for instant paint on repeat
    // visits, never for skipping the network. Always fetch fresh in the
    // background and re-render if it differs, so a catalog.json fix reaches
    // a returning visitor on the next load instead of up to CACHE_TTL_MS
    // later — a stale-icon report once took hours to explain because of
    // this cache, before it revalidated on every load like this.
    const cachedEntries = readCatalogCache();
    if (cachedEntries) renderMarinosMenu(cachedEntries);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    fetch(CATALOG_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad response"))))
      .then((entries) => {
        writeCatalogCache(entries);
        if (JSON.stringify(entries) !== JSON.stringify(cachedEntries)) renderMarinosMenu(entries);
      })
      .catch(() => {
        // Leave whatever's already rendered (cache or static banner links) as-is.
      })
      .finally(() => clearTimeout(timeout));
  }

  const documentHeadings = document.querySelectorAll(
    ".docs-content h2, .docs-content h3, .docs-content h4, .content h2, .content h3, .content h4"
  );

  const claimedHeadingIds = new Set(Array.from(document.querySelectorAll("[id]"), (element) => element.id));

  function headingTargetId(heading) {
    if (heading.id) return heading.id;

    const section = heading.closest("section[id]");
    if (section && section.querySelector(":scope > h2, :scope > h3, :scope > h4") === heading) {
      return section.id;
    }

    const base = heading.textContent
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
    let id = base;
    let suffix = 2;
    while (claimedHeadingIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    heading.id = id;
    claimedHeadingIds.add(id);
    return id;
  }

  documentHeadings.forEach((heading) => {
    if (heading.querySelector(".heading-anchor")) return;
    const targetId = headingTargetId(heading);

    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${targetId}`;
    anchor.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
    anchor.textContent = "#";
    heading.append(" ", anchor);
  });

  const toc = document.querySelector(".docs-toc, .toc");
  const tocLinks = toc
    ? Array.from(toc.querySelectorAll('a[href^="#"]')).filter((link) => link.hash.length > 1)
    : [];
  const tocTargets = tocLinks
    .map((link) => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((item) => item.target);

  let scrollScheduled = false;

  function updateCurrentSection() {
    scrollScheduled = false;
    if (!tocTargets.length) return;

    const threshold = Math.max(96, window.innerHeight * 0.28);
    let current = tocTargets[0];

    tocTargets.forEach((item) => {
      if (item.target.offsetParent === null) return;
      if (item.target.getBoundingClientRect().top <= threshold) current = item;
    });

    tocTargets.forEach((item) => {
      if (item === current) item.link.setAttribute("aria-current", "location");
      else item.link.removeAttribute("aria-current");
    });
  }

  function scheduleCurrentSectionUpdate() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    window.requestAnimationFrame(updateCurrentSection);
  }

  if (tocTargets.length) {
    window.addEventListener("scroll", scheduleCurrentSectionUpdate, { passive: true });
    window.addEventListener("resize", scheduleCurrentSectionUpdate);
    window.addEventListener("hashchange", scheduleCurrentSectionUpdate);
    updateCurrentSection();
  }

  // Sortable table columns: a <thead> button[data-sort-key="foo"] sorts the
  // tbody's rows by their data-sort-foo attribute. Rows don't need any JS
  // registration — this reads whatever data-sort-* attributes are present.
  document.querySelectorAll("table").forEach((table) => {
    const sortButtons = table.querySelectorAll("thead button[data-sort-key]");
    const tbody = table.querySelector(":scope > tbody");
    if (!sortButtons.length || !tbody) return;

    let activeKey = null;
    let direction = "ascending";

    function applySort(key) {
      direction = activeKey === key && direction === "ascending" ? "descending" : "ascending";
      activeKey = key;

      const rows = Array.from(tbody.children);
      rows.sort((a, b) => {
        const valueA = a.getAttribute(`data-sort-${key}`) ?? "";
        const valueB = b.getAttribute(`data-sort-${key}`) ?? "";
        const result = valueA.localeCompare(valueB, undefined, { numeric: true, sensitivity: "base" });
        return direction === "ascending" ? result : -result;
      });
      tbody.append(...rows);

      sortButtons.forEach((button) => {
        button.closest("th")?.setAttribute("aria-sort", button.dataset.sortKey === key ? direction : "none");
      });
    }

    sortButtons.forEach((button) => {
      button.addEventListener("click", () => applySort(button.dataset.sortKey));
    });
  });

  // Copy-to-clipboard: any button[data-copy-value] copies that value and
  // shows brief feedback. Announces through #app-status-message if present
  // (the standard app-shell live region), otherwise a page-supplied
  // [data-copy-status] live region, if either exists.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-value]");
    if (!button) return;
    const value = button.dataset.copyValue;
    const status = document.querySelector("#app-status-message, [data-copy-status]");

    navigator.clipboard
      .writeText(value)
      .then(() => {
        button.classList.add("is-copied");
        clearTimeout(button.copyResetTimeout);
        button.copyResetTimeout = setTimeout(() => button.classList.remove("is-copied"), 1500);
        if (status) status.textContent = button.dataset.copyAnnounce || `Copied ${value}`;
      })
      .catch(() => {
        if (status) status.textContent = `Couldn't copy ${value} — copy it manually`;
      });
  });

  // Share: any button[data-action="share"] copies the current page URL and
  // reports through a sibling .doc-action-status inside the same
  // .doc-actions group, if present.
  document.querySelectorAll('[data-action="share"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.closest(".doc-actions")?.querySelector(".doc-action-status") ?? null;
      try {
        await navigator.clipboard.writeText(window.location.href);
        if (status) status.textContent = "Link copied";
      } catch {
        if (status) status.textContent = "Couldn't copy — copy the address bar link instead";
      }
    });
  });

  // Tab sections: elements sharing a data-tab-section="name" show together,
  // hidden unless "name" matches the current hash — everything else in the
  // group stays hidden, so a page reads as one section at a time (Help shows
  // only Help, Updates shows only Updates) instead of stacking under
  // whatever's already showing. An unrecognized or empty hash falls back to
  // the first name encountered in the page, so there's no need for an
  // explicit "Home" tab pointing at the default. Pairs automatically with
  // any #app-nav whose links use matching #name hashes — no per-page
  // JavaScript needed.
  const tabSections = document.querySelectorAll("[data-tab-section]");
  if (tabSections.length) {
    const tabNames = [];
    tabSections.forEach((section) => {
      const name = section.dataset.tabSection;
      if (!tabNames.includes(name)) tabNames.push(name);
    });
    const tabNav = document.querySelector("#app-nav");

    function showTabFromHash() {
      const hash = window.location.hash.slice(1);
      const activeName = tabNames.includes(hash) ? hash : tabNames[0];
      tabSections.forEach((section) => {
        section.hidden = section.dataset.tabSection !== activeName;
      });
      if (tabNav) {
        tabNav.querySelectorAll('a[href^="#"]').forEach((link) => {
          if (link.getAttribute("href") === `#${activeName}`) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      }
    }

    showTabFromHash();
    window.addEventListener("hashchange", showTabFromHash);
  }

  // Updates: any [data-updates-repo="repo"] section lazy-loads that repo's
  // 10 most recent commits from the GitHub API the first time it becomes
  // visible, and renders them into its own [data-updates-list]. Visibility
  // is detected by watching the section's `hidden` attribute, so it works
  // with whatever tab/hash-routing a page already has (or none, if the
  // section is never hidden) — no per-page JavaScript needed. A bare repo
  // name is assumed to be marincountygov/<repo>; pass "owner/repo" to
  // override. Add [data-app-name="App Name"] on the same section so the
  // status line reads "App Name release notes." once loaded, instead of the
  // generic "Latest commits loaded." — the single description the section
  // needs, not a separate static line plus a loading message.
  document.querySelectorAll("[data-updates-repo]").forEach((section) => {
    const repo = section.dataset.updatesRepo;
    const appName = section.dataset.appName;
    const loadedText = appName ? `${appName} release notes.` : "Latest commits loaded.";
    const status = section.querySelector("[data-updates-status]");
    const list = section.querySelector("[data-updates-list]");
    if (!repo || !list) return;

    const owner = repo.includes("/") ? repo : `marincountygov/${repo}`;
    let loaded = false;

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // Strips a leading Conventional Commits-style prefix ("fix:", "feat
    // (scope):", "chore:", etc.) and capitalizes what's left, so a title
    // like "fix: stale cache key" reads as "Stale cache key" instead of
    // exposing commit-message convention to a non-technical reader. This
    // is text cleanup, not real plain-language rewriting — a static page
    // has no way to genuinely rewrite arbitrary text at view time.
    const CONVENTIONAL_COMMIT_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s*/i;
    function cleanTitle(rawTitle) {
      const stripped = rawTitle.replace(CONVENTIONAL_COMMIT_PREFIX, "");
      return stripped ? stripped[0].toUpperCase() + stripped.slice(1) : rawTitle;
    }

    async function loadUpdates() {
      if (loaded) return;
      if (status) status.textContent = "Loading latest commits...";
      list.innerHTML = "";
      try {
        // Fetch more than we display: merge-PR commits are filtered out
        // below (they're noise, not a real change), so 15 fetched usually
        // leaves close to 10 real ones to show.
        const response = await fetch(`https://api.github.com/repos/${owner}/commits?per_page=15`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const commits = (await response.json()).filter(
          (commit) => !/^Merge pull request #\d+/.test(String(commit?.commit?.message ?? ""))
        );
        if (!Array.isArray(commits) || !commits.length) {
          if (status) status.textContent = "No recent commits found.";
          return;
        }
        loaded = true;
        if (status) status.textContent = loadedText;
        list.innerHTML = commits
          .slice(0, 10)
          .map((commit) => {
            const message = String(commit?.commit?.message ?? "").trim();
            const title = cleanTitle(message.split("\n")[0] || "Untitled commit");
            const bodyLines = message
              .split("\n")
              .slice(1)
              .map((line) => line.trim().replace(/^[-*]\s*/, ""))
              .filter(Boolean);
            const date = commit?.commit?.committer?.date
              ? new Date(commit.commit.committer.date).toLocaleString([], {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Date unavailable";
            const url = commit?.html_url || `https://github.com/${owner}/commits`;
            const body =
              bodyLines.length > 1
                ? `<ul>${bodyLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
                : bodyLines.length === 1
                  ? `<p>${escapeHtml(bodyLines[0])}</p>`
                  : "";
            const copyText = [title, ...bodyLines].join("\n");
            return (
              `<article class="app-card"><h3><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></h3>` +
              `<p class="app-help-text">${escapeHtml(date)}</p>` +
              body +
              `<button type="button" class="copy-button" data-copy-value="${escapeHtml(copyText)}" data-copy-announce="Update copied" aria-label="Copy this update">` +
              `<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>` +
              `<svg class="copy-check-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>` +
              `Copy` +
              `</button>` +
              `</article>`
            );
          })
          .join("");
      } catch (error) {
        console.error(error);
        if (status) status.textContent = "Could not load updates right now.";
      }
    }

    if (!section.hidden) loadUpdates();

    new MutationObserver(() => {
      if (!section.hidden) loadUpdates();
    }).observe(section, { attributes: true, attributeFilter: ["hidden"] });
  });
})();
