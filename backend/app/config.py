"""Paths and runtime settings (override with environment variables; see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("PENUMBRA_ROOT", Path(__file__).resolve().parents[2]))
DATA = ROOT / "data"
RAW = Path(os.environ.get("PENUMBRA_RAW", DATA / "raw"))
CACHE = Path(os.environ.get("PENUMBRA_CACHE", DATA / "cache"))
META = DATA / "metadata"
DIST = ROOT / "dist"
TILES = ROOT / "tiles"
PORT = int(os.environ.get("PENUMBRA_PORT", "4173"))
# year whose hourly geometry the planner uses by default (any year inside the kernel coverage can be requested)
DEFAULT_YEAR = int(os.environ.get("PENUMBRA_YEAR", "2027"))
