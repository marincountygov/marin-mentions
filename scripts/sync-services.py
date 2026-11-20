#!/usr/bin/env python3
"""Copy the monitor-to-service mapping from marin-data into config/.

Which service a monitor is about, and how to search for it, is recorded in marin-data, on the service. config/services.json
is a copy. Never edit it here.

  python3 scripts/sync-services.py           copy ../marin-data/organizations/services.json
  python3 scripts/sync-services.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "organizations" / "services.json"
COPY = ROOT / "config" / "services.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/services.json differs from marin-data. Run: python3 scripts/sync-services.py")
    print("ok: config/services.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/services.json from marin-data")
