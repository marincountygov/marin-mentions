#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR="$ROOT_DIR/../marin-app-shell"
RUN_BROWSER=0
case "${1:-}" in
  '') ;;
  --browser) RUN_BROWSER=1 ;;
  -h|--help)
    printf 'Usage: bash scripts/check.sh [--browser]\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
command -v python3 >/dev/null 2>&1 || { printf 'ERROR: Python 3 is required.\n' >&2; exit 1; }

bash -n "$ROOT_DIR/scripts/check.sh"
if [[ -f "$SHELL_DIR/scripts/install.py" ]]; then
  python3 "$SHELL_DIR/scripts/install.py" --check "$ROOT_DIR"
else
  printf 'SKIP: marin-app-shell is not next to this repo; shell integrity was not checked.\n' >&2
fi
# The button audit ships with the shell release; use the installed copy so it matches the installed shell.
python3 "$ROOT_DIR/vendor/marinos/audit-buttons.py" "$ROOT_DIR" --fail
if command -v node >/dev/null 2>&1; then
  node --check "$ROOT_DIR/assets/app.js"
  (cd "$ROOT_DIR" && node --test tests/match.test.js tests/reports.test.js)
else
  printf 'SKIP: Node is unavailable; JavaScript syntax and unit tests were not run.\n' >&2
fi

if [[ "$RUN_BROWSER" == 1 ]]; then
  python3 "$ROOT_DIR/tests/browser_filters.py"
  python3 "$ROOT_DIR/tests/browser_reports.py"
else
  printf 'SKIP: Browser tests not requested; run with --browser to include them.\n'
fi
printf 'Requested checks completed successfully.\n'
