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

  /** Render html into a hidden contenteditable element, select it, and let
   * the browser's native execCommand("copy") capture both clipboard
   * flavors from the real selection. Kept only as a fallback for browsers
   * without the async Clipboard API's multi-flavor write() below — its
   * plain-text flavor is the browser's own derivation from the selected
   * DOM (visible text only, e.g. a link's href is dropped), not the exact
   * `text` a caller asked for, which write() gives explicit control over. */
  function copyRichTextViaExecCommand(html) {
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

  /** Write both clipboard flavors explicitly so a plain-text paste gets
   * exactly `text` (e.g. a link's URL, spelled out, not just its visible
   * label) and a rich-text paste gets exactly `html`. Falls back to the
   * execCommand technique above, then to plain writeText(text), for
   * browsers without ClipboardItem/clipboard.write support. */
  async function copyRich(text, html) {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return true;
      } catch {
        // Fall through to the older technique below (older browser, or a
        // permissions/user-gesture rejection ClipboardItem hit but
        // execCommand might not).
      }
    }
    try {
      if (copyRichTextViaExecCommand(html)) return true;
    } catch {
      // Fall through to plain-text writeText in the caller.
    }
    return false;
  }

  // Copy-to-clipboard: any button[data-copy-value] copies that value and
  // shows brief feedback. Announces through #app-status-message if present
  // (the standard app-shell live region), otherwise a page-supplied
  // [data-copy-status] live region, if either exists. A button that also
  // carries [data-copy-html] copies that richer formatting instead (falling
  // back to the plain data-copy-value text if the rich copy fails).
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-value]");
    if (!button) return;
    const value = button.dataset.copyValue;
    const html = button.dataset.copyHtml;
    const status = document.querySelector("#app-status-message, [data-copy-status]");

    const onCopied = () => {
      button.classList.add("is-copied");
      clearTimeout(button.copyResetTimeout);
      button.copyResetTimeout = setTimeout(() => button.classList.remove("is-copied"), 1500);
      if (status) status.textContent = button.dataset.copyAnnounce || `Copied ${value}`;
    };
    const onFailed = () => {
      if (status) status.textContent = `Couldn't copy ${value} — copy it manually`;
    };

    if (html) {
      copyRich(value, html).then((copied) => {
        if (copied) onCopied();
        else navigator.clipboard.writeText(value).then(onCopied).catch(onFailed);
      });
      return;
    }

    navigator.clipboard.writeText(value).then(onCopied).catch(onFailed);
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
    // GitHub Pages project sites always serve at
    // https://marincountygov.github.io/<repo-name>/, never the org root —
    // strip the owner off "owner/repo" overrides to get the bare repo name.
    const repoName = repo.includes("/") ? repo.split("/")[1] : repo;
    const siteUrl = `https://marincountygov.github.io/${repoName}/`;
    const SPARKLE_EMOJI = "✨"; // ✨
    const POINT_RIGHT_EMOJI = "\u{1F449}"; // 👉
    let loaded = false;

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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
            const rawBodyLines = message
              .split("\n")
              .slice(1)
              .map((line) => line.trim())
              .filter(Boolean);
            const commitDate = commit?.commit?.committer?.date ? new Date(commit.commit.committer.date) : null;
            const date = commitDate
              ? commitDate.toLocaleString([], {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Date unavailable";
            // Kicker date, same granularity as this project's own news
            // digest header ("Marin Mentions — Sep 25, 2026") — no time,
            // since the kicker line is app + date, not this exact commit's
            // timestamp (that's what the date line under the title is for).
            const kickerDate = commitDate
              ? commitDate.toLocaleString([], { year: "numeric", month: "short", day: "numeric" })
              : "Date unavailable";
            const url = commit?.html_url || `https://github.com/${owner}/commits`;

            // A commit body is either a real bullet list (lines starting
            // with -/*) or a hard-wrapped prose paragraph (this project's
            // own commit convention). Treating every raw line as its own
            // bullet, regardless of style, chopped wrapped sentences into
            // fragments that read as unrelated bullet points — a real
            // bullet's own wrapped continuation line isn't a new item, and
            // a prose paragraph's hard-wrap points usually fall mid-
            // sentence, not at a real boundary. Either way the list should
            // end up one <li> per actual point: for real bullets, that's
            // the bullet itself (with continuation lines merged back in);
            // for prose, it's each full sentence, found by reflowing the
            // wrapped lines back into one block first.
            const hasBullets = rawBodyLines.some((line) => /^[-*]\s+/.test(line));
            const bodyItems = [];
            if (hasBullets) {
              for (const line of rawBodyLines) {
                if (/^[-*]\s+/.test(line)) bodyItems.push(line.replace(/^[-*]\s+/, ""));
                else if (bodyItems.length) bodyItems[bodyItems.length - 1] += ` ${line}`;
                else bodyItems.push(line);
              }
            } else if (rawBodyLines.length) {
              // Split after ./!/? only when followed by whitespace then a
              // capital letter, "(", or "`" — keeps abbreviations ("e.g."),
              // decimals/versions ("1.17.2"), and dotted names ("Node.js")
              // intact (no space follows their periods), while still
              // splitting on genuine sentence boundaries.
              rawBodyLines
                .join(" ")
                .split(/(?<=[.!?])\s+(?=[A-Z(`])/)
                .map((sentence) => sentence.trim())
                .filter(Boolean)
                .forEach((sentence) => bodyItems.push(sentence));
            }
            const body = bodyItems.length
              ? `<ul>${bodyItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : "";
            // A commit copied or shared on its own (e.g. pasted into a
            // Slack message) loses the page context that says which app
            // it's about, so the copied text/HTML carries an app-name +
            // date kicker and a link back to the app's own site —
            // copy-only, not shown on the page itself, where that context
            // is already given by the page around the card. The kicker
            // already carries the date, so the copy drops the separate
            // date line the rendered card still shows under the title.
            const kicker = appName ? `${SPARKLE_EMOJI} ${appName} updates — ${kickerDate}` : "";
            const kickerHtml = appName
              ? `${SPARKLE_EMOJI} <b>${escapeHtml(appName)} updates — <i>${escapeHtml(kickerDate)}</i></b>`
              : "";
            const visitText = appName ? `${POINT_RIGHT_EMOJI} Visit ${appName}` : "";
            // Title and the full body content, as plain text - no link
            // markup (the title is never a hyperlink in the copied text,
            // only in the rendered card). A blank line sets the kicker
            // apart from the update itself, which stays single-spaced
            // internally (title/items/visit line).
            const updateBlock = [title, ...bodyItems, visitText && `${visitText}: ${siteUrl}`]
              .filter(Boolean)
              .join("\n");
            const copyText = [kicker, updateBlock].filter(Boolean).join("\n\n");
            // Rich version of the same content, formatted the same way this
            // project's own news-item copy is (bold title, then the
            // content) — so a paste into email/docs keeps that formatting
            // instead of landing as flat text.
            const copyHtml =
              (kickerHtml ? `${kickerHtml}<br><br>` : "") +
              `<b>${escapeHtml(title)}</b>` +
              body +
              // <ul> is already a block element with its own spacing, so no
              // <br> is needed before the visit line when a body list is
              // present (that would double the gap) — only when there's no
              // body list to provide that break itself.
              (visitText
                ? `${bodyItems.length ? "" : "<br>"}${POINT_RIGHT_EMOJI} <b><a href="${escapeHtml(siteUrl)}">Visit ${escapeHtml(appName)}</a></b>`
                : "");
            return (
              `<article class="app-card">` +
              `<h3><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></h3>` +
              `<p class="app-help-text">${escapeHtml(date)}</p>` +
              body +
              `<button type="button" class="copy-button" data-copy-value="${escapeHtml(copyText)}" data-copy-html="${escapeHtml(copyHtml)}" data-copy-announce="Update copied" aria-label="Copy this update">` +
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

  // Security: any [data-security-json="path"] section lazy-loads that path
  // (same-origin, same repo — unlike Updates, there's no cross-repo GitHub
  // API call needed) the first time it becomes visible, and renders its
  // security.json's publicSecurity block only — never the full document,
  // per marin-digital-standards/security/standard.md's public/internal
  // separation. An app with no security.json yet (fetch 404s) gets a plain
  // "not yet published" status instead of an error, since that's the
  // honest, expected state for most apps today.
  document.querySelectorAll("[data-security-json]").forEach((section) => {
    const jsonPath = section.dataset.securityJson;
    const status = section.querySelector("[data-security-status]");
    const content = section.querySelector("[data-security-content]");
    if (!jsonPath || !status || !content) return;

    let loaded = false;

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    const PROFILE_LABELS = {
      "public-web": "Public web application",
      "public-api": "Public API",
      authenticated: "Authenticated application",
      internal: "For County staff",
      custom: "Custom",
    };

    async function loadSecurity() {
      if (loaded) return;
      status.textContent = "Loading security information...";
      try {
        const response = await fetch(jsonPath, { cache: "no-store" });
        if (response.status === 404) {
          loaded = true;
          status.textContent = "No security information has been published for this application yet.";
          return;
        }
        if (!response.ok) throw new Error(`security.json fetch failed: ${response.status}`);
        const config = await response.json();
        const pub = config?.publicSecurity;
        loaded = true;
        if (!pub) {
          status.textContent = "This application's security.json has no public security summary yet.";
          return;
        }
        const profileLabel = pub.profile || PROFILE_LABELS[config.profile] || "Not set";
        status.textContent = pub.lastReviewed ? `Last reviewed ${escapeHtml(pub.lastReviewed)}.` : "Review date not recorded.";
        const controlsHtml =
          Array.isArray(pub.controls) && pub.controls.length
            ? `<ul>${pub.controls.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : "<p>No controls listed yet.</p>";
        const dataEntries = pub.data && typeof pub.data === "object" ? Object.entries(pub.data) : [];
        const dataHtml = dataEntries.length
          ? `<ul>${dataEntries
              .map(([key, value]) => `<li>${escapeHtml(key)}: ${escapeHtml(String(value))}</li>`)
              .join("")}</ul>`
          : "";
        content.innerHTML =
          `<p><b>Security profile:</b> ${escapeHtml(profileLabel)}</p>` +
          `<h4>Security controls</h4>${controlsHtml}` +
          (dataHtml ? `<h4>Data</h4>${dataHtml}` : "");
      } catch (error) {
        loaded = true;
        console.error(error);
        status.textContent = "Couldn't load security information right now.";
      }
    }

    if (!section.hidden) loadSecurity();

    new MutationObserver(() => {
      if (!section.hidden) loadSecurity();
    }).observe(section, { attributes: true, attributeFilter: ["hidden"] });
  });
})();
