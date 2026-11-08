"""Validation results for the Science / Validation panel: computed by science/validation.py and cached on disk."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone

from ..config import CACHE, ROOT
from ..science import validation as V
from . import products as P

_lock = threading.Lock()
PATH = CACHE / "validation" / f"results_{P._key('validation-v3', P.TERRAIN_VERSION)}.json"


def results(refresh: bool = False) -> dict:
    with _lock:
        if PATH.exists() and not refresh:
            out = json.loads(PATH.read_text(encoding="utf-8"))
        else:
            out = {"v1_pgda69": V.run_v1(), "v2_glaser2018": V.run_v2(), "v4_spice_horizons": V.run_v4(),
                   "computed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "terrain_version": P.TERRAIN_VERSION}
            PATH.parent.mkdir(parents=True, exist_ok=True)
            PATH.write_text(json.dumps(out, indent=1), encoding="utf-8")
    rep = ROOT / "docs" / "test_results.json"  # written by `python tasks.py test`
    out["tests"] = json.loads(rep.read_text(encoding="utf-8")) if rep.exists() else None
    return out
