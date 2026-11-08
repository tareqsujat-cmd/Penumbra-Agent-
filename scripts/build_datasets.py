"""Write data/metadata/datasets.json: the dataset groups documented in the preparation pass
(penumbra_prep/data/metadata/datasets.json), with every file mapped to its link under data/raw and its SHA-256 from
data/metadata/files.json (written by scripts/link_data.py). Groups for raw files not described there are added.

    python scripts/build_datasets.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT.parent / "penumbra_prep" / "data" / "metadata" / "datasets.json"
FILES = ROOT / "data" / "metadata" / "files.json"
OUT = ROOT / "data" / "metadata" / "datasets.json"

EXTRA = [
    {"id": "pgda69", "title": "NASA PGDA Product 69: average Sun and Earth visibility, south pole (120 m)",
     "source": "NASA Goddard Planetary Geodesy Data Archive, Product 69 (Mazarico et al. 2011)",
     "product_page": "https://pgda.gsfc.nasa.gov/products/69",
     "frame": "MOON_ME (DE421), polar stereographic (south), sphere R = 1737.4 km", "resolution": "120 m/pixel",
     "version": "AVGVISIB_75S_120M_201608 (from the .lbl)", "usage": "Independent validation V1 of Sun/Earth visibility",
     "match": "pgda69/"},
    {"id": "horizons_tables", "title": "JPL Horizons apparent Sun/Earth azimuth-elevation tables at lunar surface points",
     "source": "NASA/JPL Horizons API (DE441)", "product_page": "https://ssd.jpl.nasa.gov/horizons/",
     "frame": "MEAN_ME, 1737.4 km sphere, airless", "resolution": "hourly (2027) and 2-hourly (2008-2036)",
     "version": "fetched 2026-09-28", "usage": "Validation V4: SPICE vs Horizons geometry", "match": "horizons/"},
    {"id": "bsc5", "title": "Yale Bright Star Catalogue, 5th revised edition (9,110 stars to V = 6.5)",
     "source": "Hoffleit & Warren (1991), via CDS VizieR catalogue V/50 (columns HR, RA/Dec J2000 deg, Vmag, B-V, Name)",
     "product_page": "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=V/50",
     "frame": "ICRS/J2000 equatorial; rotated to MOON_ME with SPICE pxform at display time", "resolution": "star positions to 1e-6 deg",
     "version": "fetched 2026-10-01", "usage": "Star field in the 3-D globe, terrain view and sky dome", "match": "stars/"},
    {"id": "pgda78_site01_04", "title": "NASA PGDA Product 78: 5 m south-pole terrain, Site01 and Site04 (surface, slope, error)",
     "source": "NASA Goddard Planetary Geodesy Data Archive, Product 78 (Barker et al. 2021)",
     "product_page": "https://pgda.gsfc.nasa.gov/products/78",
     "frame": "MOON_ME (DE421), polar stereographic (south), pixel-registered", "resolution": "5 m/pixel",
     "version": "final_adj (from the file names)", "usage": "Near-site terrain for horizons, slopes and the 3-D view",
     "match": "pgda78/Site0", "match_kinds": ("_surf.tif", "_slp.tif", "_toterr.tif")},
]


def main() -> None:
    files = json.loads(FILES.read_text(encoding="utf-8"))["files"]
    by_name: dict[str, dict] = {}
    for f in files:
        by_name.setdefault(Path(f["path"]).name, f)
    prep = json.loads(PREP.read_text(encoding="utf-8"))
    used: set[str] = set()
    groups = []
    for g in prep["groups"]:
        fl = []
        for f in g.get("files", []):
            name = Path(f.get("path", "")).name
            hit = by_name.get(name)
            if hit:
                fl.append({"path": hit["path"], "bytes": hit["bytes"], "sha256": hit["sha256"], "url": f.get("url", "")})
                used.add(hit["path"])
        if fl:
            groups.append({k: g.get(k, "") for k in ("id", "title", "source", "product_page", "frame", "projection",
                                                     "resolution", "version", "usage")} | {"files": fl})
    for e in EXTRA:
        kinds = e.get("match_kinds")
        fl = [{"path": f["path"], "bytes": f["bytes"], "sha256": f["sha256"], "url": ""} for f in files
              if e["match"] in f["path"] and f["path"] not in used and (not kinds or f["path"].endswith(kinds))]
        if fl:
            used.update(x["path"] for x in fl)
            groups.append({k: v for k, v in e.items() if k not in ("match", "match_kinds")} | {"files": fl})
    left = [f["path"] for f in files if f["path"] not in used]
    out = {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "note": "Raw public NASA/JPL files used by Penumbra (hard links under data/raw). Checksums: SHA-256.",
           "groups": groups, "unlisted_files": left}
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(groups)} groups, {sum(len(g['files']) for g in groups)} files; unlisted: {len(left)}")
    for p in left[:10]:
        print("  unlisted", p)


if __name__ == "__main__":
    main()
