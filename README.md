# Marin Mentions

A live, stateless media-monitoring console for the San Francisco Bay Area, prioritizing Marin County. It combines direct publisher RSS, Google News RSS, YouTube, and Bluesky into one feed, matched against configurable keyword/phrase monitors — no database, no email/alerting infrastructure, no persistent archive.

- **Purpose:** Track Bay Area news/video/social mentions of configured monitors (e.g. "Marin County," "Marin Civic Center") as a live console, not an archive.
- **Audience:** Marin County staff.
- **Owner:** TBD
- **Repo:** marin-mentions
- **Status:** Prototype (Phase 1+2 of the implementation plan — see "Roadmap" below)

## What this app does

Every ~10–15 minutes, a scheduled build:

1. Fetches every enabled source in `config/sources.yaml` (direct RSS, Google News RSS, YouTube, Bluesky — Reddit and Nextdoor are disabled by default).
2. Normalizes results into a common shape (see "Common media shape" below).
3. Matches them against the monitors in `config/monitors.yaml` (include/exclude phrases, case-insensitive).
4. Deduplicates, preferring a direct publisher result over a Google News result for the same story.
5. Merges the result into the previously published snapshot, keeping items from the last 60 days.
6. Writes `data.json`, which the static site (`index.html` + `assets/app.js`) reads to render the console, `/sources` health page, and `/monitors` reference page.

## Architecture

**No database, no server, no framework.** This is a plain static site (same shell/nav/brand pattern as every other MarinOS app, scaffolded from `marin-app-template`) plus a Node build script that runs in CI, not in a request path.

```text
config/sources.yaml, config/monitors.yaml
              |
              v
build/connectors/*.js  (rss, google-news, youtube, bluesky, reddit*, nextdoor*)
              |
              v
build/normalize.js  ->  build/match.js  ->  build/dedupe.js
              |
              v
   merge with previous data.json (60-day rolling window)
              |
              v
        dist/data.json  +  static site  --(GitHub Actions)-->  GitHub Pages
              |
              v
       assets/app.js fetches data.json and renders the console
```

\* disabled by default; see "Reddit" and "Nextdoor" below.

### Why not a live per-request server (the plan's original Next.js proposal)?

The initial plan called for Next.js with server-side API routes, so the browser never calls third-party services directly (avoiding both CORS failures and exposed API keys). That reasoning is correct, but every other Marin app is a static site deployed to GitHub Pages, and GitHub Pages has no server runtime at all — it can't run API routes regardless of framework.

Rather than introduce a new hosting platform (Vercel/Cloudflare) just for this one app, the architecture moved the "server-side fetch" step from *request time* to *build time*: a GitHub Actions job (which is a server, just not one that handles user requests) does the fetching, and publishes a static `data.json` alongside the static site. This:

- Keeps the app on GitHub Pages like every other Marin app.
- Keeps API keys in GitHub Actions secrets — never in the browser, never committed.
- Turns the plan's suggested per-source cache windows (RSS 10 min, YouTube 15 min, Bluesky 5 min) into the actual refresh cadence, via `refreshIntervalMinutes` per source in `sources.yaml` (checked against the previous snapshot's timestamps — see `build/index.js`), instead of an in-memory cache that would need a long-running server to hold.
- Means **Refresh in the UI reloads the latest snapshot, not a fresh live fetch.** Data is at most ~10–15 minutes old. This is called out directly in the UI's Latest and About sections.

The trade-off: there's no true "fetch it right now" refresh, and if the scheduled workflow stops running (see "Limitations" below), the site keeps showing an aging snapshot rather than failing loudly. Both are accepted trade-offs for staying inside the org's existing, zero-cost hosting model.

## Source connectors

### RSS

`build/connectors/rss.js` fetches and parses RSS 2.0/Atom feeds with a real `User-Agent` (many outlets block the default Node UA) and a 10s timeout. See "Verified sources" below for exactly which outlets have a working direct feed vs. which fall back to Google News.

### Google News RSS

`build/connectors/google-news.js` queries `https://news.google.com/rss/search?q=...`. Two important, non-obvious things about it:

1. **Google News item links are not the canonical article URL.** They're a redirect page (`news.google.com/rss/articles/...`) that resolves to the real article only via client-side JavaScript in a browser — there's no static HTTP redirect to follow server-side (confirmed by testing: the URL 302-redirects to itself with a different query string, and the landing page is an Angular SPA with no static fallback link in the HTML). Clicking the link in a browser works fine; resolving it from a Node script does not, short of running a headless browser in CI, which was judged not worth the complexity for this. As a result, deduplication and canonical linking for Google News items rely on the `<source url="...">` element Google News includes with each item (the real publisher domain) plus the headline, not the URL.
2. Google News appends `" - <Outlet Name>"` to every title; `build/normalize.js` strips it, since the outlet is already shown as a separate source badge.

### YouTube

Two independent methods, two different cost profiles:

**Keyword search** (`type: youtube` in `sources.yaml`) — `build/connectors/youtube.js`'s `fetchYoutubeSource` uses `search.list` (cost: 100 quota units/call against a 10,000/day default quota). To stay well inside that, it makes **one combined search per refresh** (all monitors' phrases OR'd together via YouTube's `q=term1|term2` syntax) rather than one search per monitor, and defaults to a 60-minute refresh interval (24 calls/day = 2,400 units/day). `build/match.js` re-checks the real include/exclude phrases against the returned title+description afterward, so a broader YouTube-side query just means a few extra discarded results, not false positives. Disabled (shows `error` on `/sources`) until `YOUTUBE_API_KEY` is set.

**Selected channels** (`type: youtube-rss`) — every YouTube channel publishes its own free Atom feed at `https://www.youtube.com/feeds/videos.xml?channel_id=<id>`. `fetchYoutubeChannelRssSource` fetches that directly — no API key, no quota, at the same 10-minute cadence as regular RSS sources. `build/connectors/rss.js`'s Atom parser extracts the thumbnail and channel name from YouTube's `<media:group>`/`<author>` extensions. Currently configured (channel IDs verified 2026-09-17 via a live fetch of each feed): KQED, ABC7 Bay Area, KTVU, KRON4, NBC Bay Area, CBS News Bay Area, SFGATE, and San Francisco Standard. To add another channel, find its channel ID (visit the channel page and search the HTML for `channel_id=`) and add a `youtube-rss` entry to `sources.yaml` — no code changes needed.

### Bluesky

**Disabled** (`config/sources.yaml`'s `bluesky.enabled: false`) as of 2026-09-18. `build/connectors/bluesky.js` calls `app.bsky.feed.searchPosts` on `api.bsky.app` unauthenticated — no API key, app password, or OAuth needed for read-only search, per the AT Protocol's public read model. It's a complete, working connector: it searches once per monitor include-phrase (compound AND-clause entries are flattened to their individual phrases for the query, since `build/match.js` re-enforces the real AND requirement on the results afterward), normalizes matches into the common `MediaItem` shape (author, handle, post text, timestamp, post URL, engagement counts), and lets `build/index.js`'s per-source refresh interval (5 minutes by default) act as the cache. A Bluesky failure is isolated the same way every connector's is — it can never block RSS/news results from loading.

**Why it's disabled:** unauthenticated `searchPosts` returned `HTTP 403 Forbidden` consistently — tried both `public.api.bsky.app` and `api.bsky.app`, from this project's own sandbox, from a separate fetch tool's network path, and from a real developer machine on a different network entirely. One earlier test did get a clean `200` with real data from `api.bsky.app`, which is why the connector points there rather than `public.api.bsky.app` — but that result didn't reproduce, so treat it as inconclusive rather than proof the host is reliably open. Bottom line: public unauthenticated Bluesky search is not currently reliable enough to depend on.

**To re-enable:** first just retry — flip `bluesky.enabled: true` and run the build; Bluesky's access policy may have changed. If it's still 403ing, the connector needs App Password authentication instead of no-auth access:
1. Create a Bluesky account (if you don't have one) and generate an App Password at Settings → App Passwords (not your real password — this is scoped and revocable).
2. `build/connectors/bluesky.js` would need a session step added: `POST https://bsky.social/xrpc/com.atproto.server.createSession` with `{ identifier: handle, password: appPassword }` to get an access token, then send `Authorization: Bearer <token>` on the existing `searchPosts` call.
3. Add `BLUESKY_HANDLE`/`BLUESKY_APP_PASSWORD` as GitHub Actions secrets (same pattern as `YOUTUBE_API_KEY`).

This is still read-only and still not OAuth — an App Password only grants the same access a logged-in session has, nothing about posting or interactions.

### Reddit

Enabled in `config/sources.yaml`, scoped to `r/bayarea`, `r/sanfrancisco`, `r/Marin`, `r/oakland`, `r/berkeley`, `r/SanJose` (see `build/connectors/reddit.js`). Reddit's Data API requires an OAuth app (`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, client-credentials grant) and caps free-tier use at 100 queries/minute per OAuth client — workable for one low-frequency poll every 10–15 minutes, but Reddit's terms require a paid contract for higher-volume or commercial use. Without those two secrets set, it shows `error` on `/sources` and contributes no items, the same as YouTube without `YOUTUBE_API_KEY`.

### Nextdoor

Disabled, with no activation path. Nextdoor has no public, self-serve API for searching or reading neighborhood post content — its published developer surfaces (Creator/Ads API, Local Deals API) cover advertising and business listings, not keyword monitoring of resident posts. `build/connectors/nextdoor.js` is a stub that throws a clear error if ever called. Activating this connector for real would require a partner/approval relationship with Nextdoor granting content read access; there's no self-serve path to check periodically.

## Verified sources

Every `rss`-type source in `config/sources.yaml` was checked with a direct HTTP request (`curl -A "Mozilla/5.0 ..." <url>`) on **2026-09-17**: confirmed HTTP 200, valid RSS/Atom, and item `pubDate`s from the same day. Sources that returned 401/403/404 to that same direct request are **not** listed as `rss` — they use a `google-news` fallback entry instead, per the plan's "never scrape, always fall back to Google News" rule. Each has a `note:` in `sources.yaml` recording what was observed.

**Working direct RSS (21):** SFGATE, SF Standard, Mission Local, SFist, 48 Hills, Local News Matters/Bay City News, ABC7 Bay Area, KRON4, NBC Bay Area, KQED, Berkeleyside, The Oaklandside, Richmondside, East Bay Express, Berkeley Scanner, San José Spotlight, Palo Alto Online, Mountain View Voice, Pacific Sun, Point Reyes Light, Napa Valley Register.

**Blocked/no usable feed → Google News fallback (11):** Bay Area Reporter (403), KTVU FOX 2 (404, no discoverable endpoint), CBS News Bay Area/KPIX (404), East Bay Times (403), Mercury News (403), Marin Independent Journal (403), Marin Post (401), Press Democrat (403), North Bay Business Journal (redirects into Press Democrat, 403), Sonoma Index-Tribune (403), Sonoma County Gazette (403). These are mostly two chains — MediaNews Group and Sonoma Media Investments — that block generic bot/scraper traffic even for their own RSS endpoints.

**Considered and dropped, not faked:** Mill Valley Herald (DNS failure — doesn't appear to exist as an active outlet under that name) and The Six Fifty (no longer a standalone feed; merged into Palo Alto Online's "The 650" section — covered via a scoped Google News query instead of inventing a direct feed that doesn't exist).

Re-verify this list periodically — outlets change RSS providers/URLs without notice; see `AGENTS.md` for the check command.

## Configuration

```text
config/
├── sources.yaml    # every source: type, url/query, region, enabled, cost category
└── monitors.yaml   # keyword/phrase monitors: include/exclude
```

### Add an RSS source

1. Verify it first: `curl -A "Mozilla/5.0 (compatible; MarinMediaMonitor/1.0)" <candidate-url>` — confirm HTTP 200 and recent `pubDate`s.
2. Add an entry to `config/sources.yaml` with `type: rss` and the verified `url`.
3. If it fails verification, add `type: google-news` with a `query: site:<domain>` instead — don't scrape.

### Add a monitor

Add an entry to `config/monitors.yaml`:

```yaml
- id: my-monitor
  name: My Monitor
  include:
    - Some Phrase
  exclude:
    - Some Phrase Unrelated Context
```

No code changes needed — `/monitors` and the Latest tab's monitor chips pick it up automatically on the next build.

### Enable YouTube

Set the `YOUTUBE_API_KEY` repository secret (see "Environment variables"). It's already enabled in `sources.yaml`; without the key, it just shows `error` on `/sources` and contributes no items.

### Enable Bluesky

Nothing to configure — it's unauthenticated. See the "Bluesky" caveat above about possible upstream blocking.

## Common media shape

There's no TypeScript in this repo (see "Stack" below), so this is documented rather than declared. `build/normalize.js` produces:

```text
MediaItem = {
  id, platform, source, sourceId, sourceType ("news"|"video"|"social"),
  title?, text?, author?, handle?, url, image?,
  publishedAt, matchedTerms: [], matchedMonitors: [],
  sourceMethod ("rss"|"google-news"|"youtube"|"bluesky"|"reddit"|"nextdoor"),
  engagement?: { likes, reposts, replies },
}
```

## Stack

Plain HTML/CSS/vanilla JS for the site (matching every other MarinOS app's `marin-app-template` scaffold — no React/Next.js/build step for the frontend), plus plain Node (CommonJS, no TypeScript, no bundler) for the build-time ingestion pipeline — the same style as this org's `policy-knowledge-model`/`policy-learning-model` repos. `js-yaml` and `fast-xml-parser` are the only two runtime dependencies, both build-time only (never shipped to the browser).

## Environment variables

Set these as GitHub Actions repository secrets (Settings → Secrets and variables → Actions), not in a committed `.env`:

| Variable | Required for | Notes |
|---|---|---|
| `YOUTUBE_API_KEY` | YouTube connector | Get one from the Google Cloud Console (YouTube Data API v3, free quota). |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit connector | Reddit is enabled by default in `sources.yaml`; without these it just shows `error` on `/sources`. Create an OAuth app at reddit.com/prefs/apps. |

See `.env.example` for local development.

## Local development

```sh
npm install
npm run dev
python3 -m http.server 8000
```

Open `http://localhost:8000/` — see `docs/development.md` for details, testing checklist, and the deployment process.

## Deployment

GitHub Actions (`.github/workflows/build-and-deploy.yml`) on a `*/10 * * * *` schedule, `workflow_dispatch`, and pushes to `main` — builds `data.json` and deploys the static site to GitHub Pages via `actions/deploy-pages`. See `docs/development.md` for required repo settings and the 60-day scheduled-workflow inactivity limitation.

## Limitations of a stateless, no-database monitor

- **Refresh means "reload the latest snapshot," not "fetch live."** Data is at most ~10–15 minutes old (governed by the scheduled build's cadence and each source's `refreshIntervalMinutes`).
- **Time filters only apply to what the current snapshot holds.** An item that scrolled off a source's own feed before it was ever fetched will never appear, even within the selected time range — there's no way to retrieve it after the fact without a database. The 60-day rolling merge (carrying forward previously-seen items) mitigates this but doesn't eliminate it, especially right after the very first deploy, when there's no previous snapshot to carry forward from.
- **Story grouping is deferred**, per the plan's own guidance to defer clustering if it can't be done reliably without real complexity. Related stories from different outlets currently show as separate cards, not a grouped "5 sources" card.
- **Google News dedup is best-effort**, not URL-exact, because Google's redirect links can't be resolved to a canonical URL server-side (see "Google News RSS" above).
- **If the scheduled GitHub Actions workflow stops firing** (GitHub's own 60-day repo-inactivity auto-disable — a coincidental match with the 60-day data window above, not the same thing — or someone disables it), the site keeps serving an increasingly stale snapshot without any obvious in-app failure signal beyond an old "Last updated" timestamp — there's no alerting, by design (no email/SMS infrastructure in scope).

## Roadmap

This ships Phase 1 (foundation) and Phase 2 (RSS + Google News + matching + dedup + UI) of the original implementation plan, plus a working-but-unverified-in-production Phase 3 (YouTube, Bluesky — both need real credentials/traffic to fully confirm). Not yet done: researched YouTube channel IDs for channel-based monitoring, Sources/Monitors page polish, story clustering, and Reddit activation (code exists, disabled by default).
