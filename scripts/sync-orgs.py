#!/usr/bin/env python3
"""Copy the monitor-to-organization mapping from marin-data into config/.

Which organization a monitor is about is recorded in marin-data, on the organization. config/organizations.json
is a copy. Never edit it here.

  python3 scripts/sync-orgs.py           copy ../marin-data/organizations/monitors.json
  python3 scripts/sync-orgs.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "organizations" / "monitors.json"
COPY = ROOT / "config" / "organizations.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/organizations.json differs from marin-data. Run: python3 scripts/sync-orgs.py")
    print("ok: config/organizations.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/organizations.json from marin-data")
