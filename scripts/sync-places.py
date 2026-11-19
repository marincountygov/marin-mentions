#!/usr/bin/env python3
"""Copy the monitor-to-place mapping from marin-data into config/.

Which place a monitor is about is recorded in marin-data, on the jurisdiction. config/places.json
is a copy. Never edit it here.

  python3 scripts/sync-places.py           copy ../marin-data/organizations/places.json
  python3 scripts/sync-places.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "organizations" / "places.json"
COPY = ROOT / "config" / "places.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/places.json differs from marin-data. Run: python3 scripts/sync-places.py")
    print("ok: config/places.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/places.json from marin-data")
