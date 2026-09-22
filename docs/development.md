# Development

## Run locally

```sh
npm install
npm run dev          # writes data.json to the project root
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Don't open `index.html` via `file://` — `fetch("data.json")` needs a real HTTP origin.

`npm run dev` re-reads `data.json` from the project root as its "previous snapshot" each time you run it, so running it twice in a row exercises the same rolling-merge logic production uses (see README.md "How refresh works"). Delete `data.json` to start from an empty snapshot.

To test YouTube or Reddit locally, export the relevant environment variables before running:

```sh
YOUTUBE_API_KEY=... npm run dev
REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... npm run dev
```

## Run the build directly

```sh
node build/index.js --out=dist/data.json --previous=data.json
```

`--previous` accepts either a local file path or an `http(s)://` URL (production points it at the live site's own `data.json`).

## Customize the starter

This project already has its real workflow built in — there's no starter `#start` section to replace. If you're extending it, the standard nav pattern still applies: `#console`, `#sources`, and `#monitors` are all in the default view's tab group; `#about` and `#updates` are their own tabs. See `marin-app-template`'s README for the general pattern.

## Use marin-ui

This project vendors a release of [`marin-ui`](https://github.com/marincountygov/marin-ui): `shared/app-brand.css`, `shared/app-shell.js`, `vendor/pico.min.css`, `vendor/fonts/Jost-wght.ttf`, and `BRAND_VERSION`.

Prefer existing marin-ui components and tokens (`.app-card`, `.app-badge`, `.app-status`, `.app-table-wrap`, `.app-empty`, `.app-form-grid`, etc.) over new CSS — `assets/app.css` only defines the pieces marin-ui doesn't have yet (filter chips, content tabs, media cards).

### Updating the marin-ui bundle

From a local checkout of `marin-ui`:

```sh
./scripts/sync-consumer.sh /path/to/marin-mentions
```

This copies `BRAND_VERSION`, `shared/app-brand.css`, `shared/app-shell.js`, `vendor/pico.min.css`, and `vendor/fonts/Jost-wght.ttf`. Don't edit the vendored `shared/`/`vendor/` files directly — fixes belong in `marin-ui`, then re-sync.

## Test changes

- Keyboard: tab through the page, confirm visible focus, and confirm the skip link, menu, and filter controls all work without a mouse.
- Reflow: check the page at a narrow viewport and at 200% zoom.
- Color mode: check both light and dark (the shell follows `prefers-color-scheme`, no manual toggle).
- Accessibility: run WAVE over HTTP — see marin-ui's `docs/accessibility-implementation.md`.
- Data pipeline: `node build/index.js --out=/tmp/data.json` and inspect the output — check `sources` for unexpected `error` entries and `items` for correct matching/dedup before assuming a UI bug is actually a data bug.

## Deployment

Deployment is a scheduled GitHub Actions workflow (`.github/workflows/build-and-deploy.yml`), not a plain "enable Pages on the repo" static deploy — see README.md and AGENTS.md for why. It runs on a cron schedule, on `workflow_dispatch`, and on pushes to `main`. Required repository secrets (Settings → Secrets and variables → Actions):

- `YOUTUBE_API_KEY` — optional; YouTube stays disabled (shows `error` on `/sources`) without it.
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` — optional; only relevant if Reddit is turned on in `config/sources.yaml`.

GitHub Pages must be configured for this repo to deploy from GitHub Actions (Settings → Pages → Source → "GitHub Actions"), not from a branch.

**Known GitHub Actions limitation:** GitHub disables scheduled workflows after 60 days with no repository activity. Since the build workflow itself doesn't commit anything (it deploys straight to Pages), a repo that goes quiet could have its cron silently stop firing. If `/sources` shows every source as stale (`lastFetchedAt` far in the past), check whether the scheduled workflow is still enabled under the Actions tab and re-enable or trigger it via `workflow_dispatch` if not.
