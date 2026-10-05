# Third-party notices

## Marin App Shell

This app vendors the complete, unmodified Marin App Shell distribution in `vendor/marinos/`. Its version, Marin UI baseline, and release-file hashes are recorded in `vendor/marinos/manifest.json`.

Keep the notices distributed with that release:

- `vendor/marinos/licenses/MARIN_APP_SHELL_LICENSE.txt`
- `vendor/marinos/licenses/LUCIDE_LICENSE.txt`
- `vendor/marinos/licenses/OPEN_SANS_OFL.txt`

`vendor/marinos/marinos.css` includes the Pico CSS baseline and its embedded license attribution. Do not strip the notices when updating or redistributing the shell.

## Existing application font assets

Font assets remain under `vendor/fonts/`, outside the replaceable shell directory. Retain their accompanying license information, including `vendor/fonts/open-sans/OFL.txt`. The shell uses these local assets and can fall back to system fonts when they are unavailable.

## Chart.js

Vendored Chart.js bundle (`vendor/chart.min.js`) is used for rendering stats charts. See `vendor/CHART_LICENSE.md`.
