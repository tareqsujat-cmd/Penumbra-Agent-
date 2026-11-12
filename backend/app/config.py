"""Paths and runtime settings (override with environment variables; see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("PENUMBRA_ROOT", Path(__file__).resolve().parents[2]))


def _load_dotenv(path: Path) -> None:
    """KEY=VALUE lines from .env (git-ignored) for variables not already set; comments and blanks are skipped."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():  # tolerate a byte-order mark (Windows editors)
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        val = val.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), val)


_load_dotenv(ROOT / ".env")

DATA = ROOT / "data"
RAW = Path(os.environ.get("PENUMBRA_RAW", DATA / "raw"))
CACHE = Path(os.environ.get("PENUMBRA_CACHE", DATA / "cache"))
META = DATA / "metadata"
DIST = ROOT / "dist"
TILES = ROOT / "tiles"
PORT = int(os.environ.get("PENUMBRA_PORT", "4173"))
# year whose hourly geometry the planner uses by default (any year inside the kernel coverage can be requested)
DEFAULT_YEAR = int(os.environ.get("PENUMBRA_YEAR", "2027"))
