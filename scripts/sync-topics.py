#!/usr/bin/env python3
"""Copy the monitor-to-topic mapping from marin-data into config/.

Which topic a monitor is about, and how to search for it, is recorded in marin-data, on the topic. config/topics.json
is a copy. Never edit it here.

  python3 scripts/sync-topics.py           copy ../marin-data/organizations/topics.json
  python3 scripts/sync-topics.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "organizations" / "topics.json"
COPY = ROOT / "config" / "topics.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/topics.json differs from marin-data. Run: python3 scripts/sync-topics.py")
    print("ok: config/topics.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/topics.json from marin-data")
