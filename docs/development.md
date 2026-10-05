# Development

## Run locally

```sh
npm ci
npm test
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

The ingestion command writes `data.json` and `feeds/`; it does not copy the static site:

```sh
node build/index.js --out=dist/data.json --previous=data.json
```

`--previous` accepts either a local file path or an `http(s)://` URL. Production points it at the live site's own `data.json`, preserving the existing rolling snapshot.

To reproduce the Pages staging and build locally (from a POSIX shell at the repository root):

```sh
npm ci
npm test
mkdir -p dist
cp -r index.html assets vendor security.json marin.yml .well-known dist/
node build/index.js --out=dist/data.json --previous=data.json
python3 -m http.server 8000 --directory dist
```

Keep this copy list aligned with the workflow's **Stage static site** step. Required files must fail loudly when missing; do not suppress copy errors or recreate a legacy directory to make the workflow pass. `marin.yml` is a runtime dependency, not just development metadata.

## Extend the application

The app has its real workflow, not a starter section to replace. `#latest`, `#sources`, and `#monitors` are separate `data-tab-section` views. The App Shell renders the standard About, Security, Accessibility, and Updates views, header navigation, and footer from the custom elements in `index.html`. The app owns its secondary `#page-tabs` navigation and its filter/card/chart behavior.

## Use Marin App Shell

This project uses App Shell **1.4.0**, with the Marin UI baseline and complete file hashes recorded in `vendor/marinos/manifest.json`. `marin.yml` pins the installed version in `platform.shell`.

The load order is:

```text
vendor/marinos/marinos.css -> assets/app.css
vendor/marinos/marinos.js (defer) -> assets/app.js (defer)
```

Chart.js remains an app-specific dependency in `vendor/chart.min.js`. The App Shell CSS already contains Pico and the shared Marin UI component styles. Prefer those bundled components and tokens (`.app-card`, `.app-badge`, `.app-status`, `.app-table-wrap`, `.app-empty`, `.app-form-grid`, etc.) over new CSS. `assets/app.css` holds only app-specific layouts and scoped overrides, such as the media-card badge's font weight; it must not define a second Alpha/Beta/Live style system.

The title badge reads `project.status` from the app's deployed `marin.yml`. Keep that file next to `index.html`. Catalog status is a compatibility fallback, not a replacement for publishing the local manifest. The Sources page reuses `.app-status` for connected/error health indicators; these do not change the application's release status.

### Update the complete App Shell runtime

Use a `marin-app-shell` source checkout at the reviewed release you intend to install. For this migration, retain **1.4.0**. From that checkout:

```sh
bash scripts/install.sh /path/to/marin-mentions
```

The installer copies `vendor/marinos/` and verifies/synchronizes its managed font and icon companions in `vendor/fonts/` and `vendor/icons/lucide/`. It needs the shell's verified font cache, a sibling `marin-ui` checkout, or an explicit font source as described in `vendor/marinos/README.md`; it does not download fonts from the network. Copying only `vendor/marinos/` is not a complete runtime installation. Preserve the companion licenses and the app-specific Chart.js bundle and icons.

Set `platform.shell` in `marin.yml` to the installed release, run `npm test`, and review the diff before publishing. `.gitattributes` preserves exact bytes for managed runtime files so Git line-ending conversion does not invalidate their release hashes. `TEMPLATE_VERSION` records the original scaffold version and is not a shell pin. Never edit the generated shell files or bypass manifest/hash failures by changing the recorded hashes. Shared component fixes belong upstream, followed by a reviewed shell release and installation, not an independent Marin UI sync into this consumer.

`vendor/marinos/brand-source.json` intentionally records upstream input filenames. Those provenance references are not application-level paths to recreate, deploy separately, or rewrite during cleanup.

## Test changes

`npm test` uses Node's built-in test runner with no additional dependencies. It checks shell version agreement, release-file and companion hashes, runtime load order, standard status-style ownership, the workflow's static copy inputs, and staged runtime asset completeness. It makes no external requests and needs no API credentials. It is a focused integration regression suite, not a data-ingestion or connector test suite.

The workflow runs it before staging or making live source requests. For browser checks, serve the repository or staged `dist/` over HTTP:

- Status: confirm `marin.yml` loads successfully and the title badge matches its `project.status`. In developer tools, the title badge should have `data-marinos-status="manifest"`; verify this with the catalog unavailable as well.
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
