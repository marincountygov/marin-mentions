#!/usr/bin/env python3
"""Copy the monitor-to-event mapping from marin-data into config/.

Which event a monitor is about is recorded in marin-data, on the event. config/events.json
is a copy. Never edit it here.

  python3 scripts/sync-events.py           copy ../marin-data/organizations/events.json
  python3 scripts/sync-events.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "organizations" / "events.json"
COPY = ROOT / "config" / "events.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/events.json differs from marin-data. Run: python3 scripts/sync-events.py")
    print("ok: config/events.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/events.json from marin-data")
