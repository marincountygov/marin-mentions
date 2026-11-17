#!/usr/bin/env python3
"""Copy the shared list of projects from marin-data into config/projects.json.

The projects Marin Mentions watches for are kept in marin-data (projects/projects.json). Each project with a
mentions entry becomes a monitor in the Projects group. config/projects.json is a copy. Never edit it here.

  python3 scripts/sync-projects.py           copy ../marin-data/projects/projects.json
  python3 scripts/sync-projects.py --check   fail if the copy differs. Skipped when marin-data is not next to this repo.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "marin-data" / "projects" / "projects.json"
COPY = ROOT / "config" / "projects.json"

if not SOURCE.is_file():
    if "--check" in sys.argv:
        print("skipped: marin-data is not next to this repo")
        sys.exit(0)
    sys.exit(f"not found: {SOURCE}")
if "--check" in sys.argv:
    if not COPY.exists() or COPY.read_bytes() != SOURCE.read_bytes():
        sys.exit("config/projects.json differs from marin-data. Run: python3 scripts/sync-projects.py")
    print("ok: config/projects.json matches marin-data")
else:
    shutil.copyfile(SOURCE, COPY)
    print("copied config/projects.json from marin-data")
