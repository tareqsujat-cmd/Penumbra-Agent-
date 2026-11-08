"""Hard-link the raw NASA/JPL files into data/raw/ (no extra disk space on the same NTFS volume) and write
data/metadata/datasets.json with SHA-256 checksums.

    python scripts/link_data.py

Sources: penumbra_prep/data/raw (downloaded and checksummed in the preparation pass) and the raw NASA files kept
under research/top3_probes/data (LOLA DEMs, PGDA 69 maps, PGDA 78 Site01/04 surfaces, JPL Horizons tables).
Only data files are linked; no research code is used.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT.parent
PREP = WS / "penumbra_prep" / "data" / "raw"
RES = WS / "research" / "top3_probes" / "data"
RAW = ROOT / "data" / "raw"
META = ROOT / "data" / "metadata"

# (destination relative to data/raw, source path, dataset id)
FILES: list[tuple[str, Path, str]] = []
for site in ("Site01", "Site04"):
    for kind in ("surf", "slp", "toterr"):
        FILES.append((f"pgda78/{site}/{site}_final_adj_5mpp_{kind}.tif", RES / f"lola5m/{site}_{kind}.tif", "pgda78"))
    FILES.append((f"pgda78/{site}/{site}_final_adj_5mpp_slperr.tif", PREP / f"pgda78/{site}/{site}_final_adj_5mpp_slperr.tif", "pgda78"))
    for k in range(1, 21):
        n = f"{site}_final_adj_5mpp_{k:04d}_err.tif"
        FILES.append((f"pgda78/{site}/Clones/{n}", PREP / f"pgda78/{site}/Clones/{n}", "pgda78_clones"))
for site in ("Site06", "Site20", "Site23"):
    for kind in ("surf", "slp", "toterr"):
        n = f"{site}_final_adj_5mpp_{kind}.tif"
        FILES.append((f"pgda78/{site}/{n}", PREP / f"pgda78/{site}/{n}", "pgda78"))
for n in ("ldem_80s_80m", "ldem_75s_240m"):
    for ext in (".img", ".lbl"):
        FILES.append((f"lola/{n}{ext}", RES / f"lola/{n}{ext}", "lola_south"))
for n in ("AVGVISIB_75S_120M_201608", "AVGVISIB_75S_120M_201608_EARTH"):
    for ext in (".IMG", ".LBL"):
        FILES.append((f"pgda69/{n}{ext}", RES / f"lola/{n}{ext}", "pgda69"))
for p in sorted((PREP / "spice").glob("*")):
    FILES.append((f"spice/{p.name}", p, "spice"))
for p in sorted((RES / "horizons").glob("*.txt")):
    FILES.append((f"horizons/{p.name}", p, "horizons"))
for p in sorted((PREP / "docs").glob("*")):
    FILES.append((f"docs/{p.name}", p, "docs"))
# downloaded directly into data/raw (VizieR V/50; see datasets.json)
FILES.append(("stars/bsc5_vizier.tsv", RAW / "stars/bsc5_vizier.tsv", "stars"))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    missing = [str(s) for _, s, _ in FILES if not s.exists()]
    if missing:
        print("missing source files:\n  " + "\n  ".join(missing))
        return 1
    files = []
    for dest, src, ds in FILES:
        d = RAW / dest
        d.parent.mkdir(parents=True, exist_ok=True)
        if not d.exists() and d.resolve() != src.resolve():
            try:
                os.link(src, d)
            except OSError:
                shutil.copy2(src, d)  # different volume: fall back to a copy
        files.append({"path": f"data/raw/{dest}", "dataset": ds, "bytes": d.stat().st_size, "sha256": sha256(d)})
    META.mkdir(parents=True, exist_ok=True)
    out = META / "files.json"
    out.write_text(json.dumps({"files": files}, indent=1), encoding="utf-8")
    print(f"{len(files)} files linked into {RAW}; checksums in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
