# Working on marin-mentions

## Architecture

This is a stateless media-monitoring console: a Node build script (`build/index.js`) fetches configured sources, matches them against configured monitors, deduplicates, and writes one `data.json` plus a set of static RSS feeds (`build/feeds.js`) built from that same item list. A GitHub Actions workflow runs that build on a schedule and deploys the static site (`index.html` + `assets/` + `vendor/` + `marin.yml` + `security.json` + `.well-known/` + the freshly-built `data.json` and `feeds/`) to GitHub Pages. There is no database, no server, and no client-side framework — `assets/app.js` is plain DOM code that fetches `data.json` and renders it.

This departs from `marin-app-template`'s default (a static site with no build step) because this app has a hard requirement the template doesn't: fetching RSS/Google News/YouTube/Bluesky server-side, both to avoid CORS failures (most publisher feeds don't send CORS headers) and to keep API keys out of the browser. See README.md's "Why not GitHub Pages alone / why not Next.js" section for the full reasoning — this was a deliberate, reviewed deviation, not a default to imitate elsewhere without the same justification.

## Where things live

- `config/sources.yaml` — every source: RSS URL, Google News query, or API type; region; enabled flag; verification notes. `official: true` marks the County's own first-party channels (`marincounty-gov`, `marin-county-youtube`, `marin-county-fire-youtube`) as opposed to third-party coverage of them. `assets/app.js`'s `computeOfficialSourceIds()` derives the live set of official source ids from `data.json`'s `sources` array on every load (not hardcoded), used by both the Clippings release-attribution dropdown (`computeReleases()`) and the Stats tab (`renderStats()` excludes official sources from Top Sources, since that's the County's own volume, not third-party coverage). No separate connector or fetch for this — those three sources already flow through the normal build like every other source; the flag just marks which existing items count as "the County's own."
- `config/monitors.yaml` — keyword/phrase monitors (include/exclude). Adding a monitor here needs no code change.
- `build/connectors/*.js` — one file per source type (`rss`, `google-news`, `youtube`, `bluesky`, `reddit`, `nextdoor`). Each returns raw items; `build/normalize.js` converts them to the common `MediaItem` shape.
- `build/match.js`, `build/dedupe.js` — monitor matching and dedup logic; see the comments there before changing matching semantics, dedup key priority, or story-grouping approach (grouping is deferred — not implemented).
- `build/feeds.js` — generates static RSS 2.0 files (one per monitor, one per content type matching the UI's tabs, plus a combined `all.xml`) from the same matched/deduped/pruned items that become `data.json`. Written into `feeds/` next to wherever `data.json` lands (`dist/feeds/` in production, `feeds/` at repo root under `npm run dev`) — both are gitignored, same as `data.json`. There is no feed for a source filter, search text, or more than one monitor selected at once — that would mean a static file per combination, which doesn't scale; `assets/app.js`'s `updateRssFeedLink()` disables the RSS button for those instead of guessing.
- `build/index.js` — orchestrator: loads config, decides which sources are due for refresh (`refreshIntervalMinutes` per source, checked against the previously published snapshot instead of a separate cache store), merges with the previous 60-day rolling window, writes `data.json`.
- `assets/app.js` / `assets/app.css` — the console, Sources page, Monitors page, and Stats page, all driven by the one `data.json`. `vendor/marinos/marinos.js`'s hash-based tab logic (`data-tab-section`) handles which section shows.
- `vendor/chart.min.js` - the app-specific Chart.js bundle used by Stats, outside the App Shell-managed files. Preserve its reviewed version and `vendor/CHART_LICENSE.md`; do not replace it as part of a shell update or load it from a CDN.

## App Shell ownership

- `vendor/marinos/` is the generated App Shell distribution. Its `manifest.json` records the version, hashes, and managed font/icon companions. `marin.yml` must declare the same version in `platform.shell`.
- `project.status` in `marin.yml` is the local source of truth for the Alpha/Beta/Live title badge. Always deploy `marin.yml` next to `index.html`; do not hardcode a second status in app markup or CSS.
- Load `vendor/marinos/marinos.css` before `assets/app.css` and deferred `vendor/marinos/marinos.js` before deferred `assets/app.js`. Pico and the shared Marin UI styles are already bundled.
- Keep app-specific styles and behavior in `assets/`. Reuse shell classes for both release-status and source-health badges. The scoped `.mm-card__meta .app-badge` override is app-specific and should remain scoped.
- Fix common components upstream, then use the App Shell installer's complete runtime install, including companion fonts and icons. Never directly edit the generated bundle or run an independent Marin UI consumer sync on this app. Upstream source paths in the shell's provenance are intentional; do not rewrite them.
- `TEMPLATE_VERSION` is scaffold history, not a shell version pin. See `docs/development.md` for the update procedure.

## Before making changes

- Adding a source: verify the feed actually works first (`curl -A "Mozilla/5.0" <url>`, check for a 200 and recent `pubDate`s) before adding it to `sources.yaml` — see README.md "Verified sources" for the log of what was checked and when, and keep it updated. If a feed 401s/403s/404s, use a `google-news` fallback entry instead of scraping.
- Adding a monitor: just edit `config/monitors.yaml`. No code changes needed.
- Changing YouTube query behavior: re-check the quota math in `build/connectors/youtube.js`'s comment and in README.md's "YouTube" section — search.list costs 100 units/call against a 10,000/day default quota; it's easy to blow through that by adding more calls per refresh.
- Bluesky: `public.api.bsky.app` returned HTTP 403 to this project's own test traffic during development (see README.md "Bluesky"), which may or may not reproduce from GitHub Actions runners. If the Bluesky source shows persistent `error` status on `/sources` in production, that's the likely cause — it's a WAF/bot-protection issue upstream, not a bug in `build/connectors/bluesky.js`, unless you've changed that file recently.
- Local dev: `npm run dev` writes `data.json` to the project root (gitignored) using the current live `data.json` (if reachable) as the previous snapshot; serve the folder with any static server (`python3 -m http.server`) and open it — don't open `index.html` via `file://`, since `fetch("data.json")` needs a real origin.

## Before finishing

- Run `npm test` to verify shell hashes and companions, version metadata, load order, status-style ownership, Pages staging, and staged runtime asset completeness.
- Run `npm run build` (or `npm run dev` for local iteration) and confirm it completes without throwing — a single source failing should never fail the whole build (each connector call is isolated in `build/index.js`).
- If you touched `assets/app.js`, manually verify in a browser (or an equivalent DOM harness) that: the Latest tab renders cards, monitor chips/platform checkboxes/content tabs/search/time filter all narrow the list, and Sources + Monitors render from the same `data.json`.
- Update README.md's "Verified sources" log if you added, removed, or re-verified a source.

## References

- `marin-app-template` — the scaffold this was built from (shell, nav, brand bundle): https://github.com/marincountygov/marin-app-template
- `marin-app-shell` - the released runtime and installer: https://github.com/marincountygov/marin-app-shell
- `marin-ui` - the upstream design system consumed through App Shell, not independently synchronized into this app: https://github.com/marincountygov/marin-ui
- `marin-digital-standards` — accessibility, content, brand, product-design requirements: https://github.com/marincountygov/marin-digital-standards
