"""Data provenance (Instructions §25): the dataset groups with sources, frames, versions and checksums, plus the
processing state of the cached products."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from ..config import CACHE, META
from ..science import ephemeris as eph
from . import products as P


def provenance() -> dict:
    p = META / "datasets.json"
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"groups": []}
    groups = []
    for g in data.get("groups", []):
        files = g.get("files", [])
        groups.append({
            "id": g.get("id", ""), "title": g.get("title", ""), "source": g.get("source", ""),
            "page": g.get("product_page", ""), "frame": g.get("frame", ""), "resolution": g.get("resolution", ""),
            "version": g.get("version", ""), "usage": g.get("usage", ""), "files": len(files),
            "bytes": sum(f.get("bytes", 0) for f in files), "sha_first": (files[0].get("sha256", "")[:16] if files else ""),
            "file_list": [{"path": f["path"], "sha256": f.get("sha256", ""), "bytes": f.get("bytes", 0)} for f in files],
        })
    cached = sorted((CACHE / "horizons").glob("*.npz")) if (CACHE / "horizons").exists() else []
    last = max((f.stat().st_mtime for f in cached), default=None)
    return {
        "verified_utc": data.get("generated_utc", ""),
        "last_processed_utc": datetime.fromtimestamp(last, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if last else None,
        "frame": "MOON_ME (MOON_ME_DE440_ME421 via moon_de440_250416.tf; terrain in the DE421 ME frame, < 0.6 m apart)",
        "kernels": eph.kernel_list(), "terrain_version": P.TERRAIN_VERSION, "groups": groups,
    }
