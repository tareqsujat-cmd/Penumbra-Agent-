"""Maintainer tool: write data/metadata/downloads.json, the file list used by scripts/download_data.py.

    python scripts/build_download_manifest.py

Inputs: data/metadata/datasets.json (path, URL, size and SHA-256 of every raw file) and the raw files themselves under
data/raw/ (needed only here, to read the Horizons and VizieR query parameters from their headers and to hash their
data rows). Downloaders never need this script; they use the JSON it writes.

Verification modes written for each file:
  sha256  byte-exact (static files from PDS, PGDA, NAIF, JPL DSN, NTRS)
  rows    hash of the data rows only (JPL Horizons between $$SOE and $$EOE; VizieR lines not starting with '#'),
          because API responses carry the request time and current EOP file name in their headers
  size    byte count only (imagery build inputs with no local reference copy)
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT.parent
META = ROOT / "data" / "metadata"
PGDA78 = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"
PDS_LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
VIZIER_CDS, VIZIER_MIRROR = "vizier.cds.unistra.fr", "vizier.cfa.harvard.edu"  # same rows (checked 2026-11-12)

GROUP_OF = {  # datasets.json group id -> download group
    "lola_ldem_80m": "lola", "lola_ldem_240m": "lola", "pgda69_visibility": "pgda69", "pgda78_readme": "pgda78",
    "naif_spice": "spice", "reference_documents": "docs", "jpl_horizons_tables": "horizons", "bsc5": "stars",
}
GROUPS = {
    "spice": ("NAIF SPICE kernels: DE440, lunar orientation, Earth orientation, DSN stations", "NASA JPL NAIF"),
    "lola": ("LRO LOLA south-polar DEMs LDEM_80S_80M and LDEM_75S_240M", "NASA PDS Geosciences Node"),
    "pgda78": ("PGDA Product 78: 5 m south-pole site DEMs, slopes, errors and 20 error clones", "NASA GSFC PGDA"),
    "pgda69": ("PGDA Product 69: average Sun and Earth visibility maps (validation V1)", "NASA GSFC PGDA (imbrium.mit.edu)"),
    "horizons": ("JPL Horizons topocentric Sun and Earth az/el tables (validation V4 and research points)", "JPL Horizons API"),
    "stars": ("Yale Bright Star Catalogue, 5th ed. (sky rendering)", "CDS VizieR V/50"),
    "imagery": ("LOLA north-polar DEMs and global LDEM_16, inputs for building the globe tiles", "NASA PDS Geosciences Node"),
    "docs": ("Reference papers and handbooks (PDF, not used by the app)", "JPL DSN, NASA NTRS"),
}
IMAGERY = [  # (path under data/raw, URL, legacy copy relative to the workspace)
    ("lola_north/ldem_80n_80m.img", PDS_LOLA + "polar/img/ldem_80n_80m.img", "penumbra_prep/data/raw/lola_north/ldem_80n_80m.img"),
    ("lola_north/ldem_80n_80m.lbl", PDS_LOLA + "polar/img/ldem_80n_80m.lbl", "penumbra_prep/data/raw/lola_north/ldem_80n_80m.lbl"),
    ("lola_north/ldem_75n_240m.img", PDS_LOLA + "polar/img/ldem_75n_240m.img", "penumbra_prep/data/raw/lola_north/ldem_75n_240m.img"),
    ("lola_north/ldem_75n_240m.lbl", PDS_LOLA + "polar/img/ldem_75n_240m.lbl", "penumbra_prep/data/raw/lola_north/ldem_75n_240m.lbl"),
    ("lola_global/ldem_16.img", PDS_LOLA + "cylindrical/img/ldem_16.img", "penumbra_prep/data/raw/lola_global/ldem_16.img"),
    ("lola_global/ldem_16.lbl", PDS_LOLA + "cylindrical/img/ldem_16.lbl", "penumbra_prep/data/raw/lola_global/ldem_16.lbl"),
]
IMAGERY_BYTES = {"lola_north/ldem_80n_80m.lbl": 4913}  # no local copy; size from the PDS server


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def rows_sha256(text: str, kind: str) -> str:
    """Hash of the data rows, line endings normalised (must match download_data.rows_sha256)."""
    text = text.replace("\r\n", "\n")
    if kind == "horizons":
        body = text[text.index("$$SOE"):text.index("$$EOE")]
    else:
        body = "\n".join(ln for ln in text.split("\n") if ln.strip() and not ln.startswith("#"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def horizons_url(text: str) -> str:
    """Rebuild the Horizons API request from the table header (verified to reproduce the data rows exactly)."""
    def get(pat: str) -> str:
        m = re.search(pat, text, re.M)
        if not m:
            raise ValueError(f"Horizons header field not found: {pat}")
        return m.group(1).strip()
    target = get(r"^Target body name: .*?\((\d+)\)")
    lon, lat, _alt = (s.strip() for s in get(r"^Center geodetic : (.*?)\s+\{").split(","))
    t0 = datetime.strptime(get(r"^Start time\s+: A\.D\. (\S+ \S+)")[:17], "%Y-%b-%d %H:%M")
    t1 = datetime.strptime(get(r"^Stop  time\s+: A\.D\. (\S+ \S+)")[:17], "%Y-%b-%d %H:%M")
    step = get(r"^Step-size\s+: (\d+) minutes")
    q = {
        "format": "text", "COMMAND": f"'{target}'", "OBJ_DATA": "'YES'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'", "SITE_COORD": f"'{lon},{lat},0'",
        "START_TIME": f"'{t0:%Y-%m-%d %H:%M}'", "STOP_TIME": f"'{t1:%Y-%m-%d %H:%M}'", "STEP_SIZE": f"'{step} m'",
        "QUANTITIES": "'4'", "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'", "APPARENT": "'AIRLESS'",
    }
    return HORIZONS + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def main() -> None:
    ds = json.loads((META / "datasets.json").read_text(encoding="utf-8"))
    files: dict[str, list[dict]] = {g: [] for g in GROUPS}
    for g in ds["groups"]:
        grp = GROUP_OF.get(g["id"], "pgda78" if g["id"].startswith("pgda78") else None)
        if grp is None:
            raise SystemExit(f"unmapped dataset group {g['id']}")
        for f in g["files"]:
            rel, local = f["path"], ROOT / f["path"]
            entry = {"path": rel, "url": f.get("url") or "", "bytes": f["bytes"], "check": "sha256", "sha256": f["sha256"]}
            if grp == "horizons":
                text = local.read_text(encoding="utf-8")
                entry.update(url=horizons_url(text), check="rows", rows_sha256=rows_sha256(text, "horizons"))
                del entry["sha256"]
            elif grp == "stars":
                text = local.read_text(encoding="utf-8")
                req = re.search(r"^#INFO\trequest=(\S+)", text, re.M)
                entry.update(url=req.group(1), check="rows", rows_sha256=rows_sha256(text, "vizier"),
                             mirrors=[req.group(1).replace(VIZIER_CDS, VIZIER_MIRROR)])
                del entry["sha256"]
            elif not entry["url"] and rel.startswith("data/raw/pgda78/"):
                entry["url"] = PGDA78 + rel.removeprefix("data/raw/pgda78/")
            if not entry["url"]:
                raise SystemExit(f"no URL for {rel}")
            files[grp].append(entry)
    for rel, url, legacy in IMAGERY:
        local = ROOT / "data/raw" / rel
        src = local if local.exists() else WS / legacy
        if src.exists():
            files["imagery"].append({"path": f"data/raw/{rel}", "url": url, "bytes": src.stat().st_size, "check": "sha256", "sha256": sha256(src)})
        else:
            files["imagery"].append({"path": f"data/raw/{rel}", "url": url, "bytes": IMAGERY_BYTES[rel], "check": "size"})
    out = {
        "note": "Raw public data for Penumbra, downloaded by scripts/download_data.py into data/raw/. "
                "Written by scripts/build_download_manifest.py; see DATA_DOWNLOAD_MANUAL.md.",
        "groups": [
            {"id": gid, "title": t, "source": s, "files": sorted(files[gid], key=lambda e: e["path"])}
            for gid, (t, s) in GROUPS.items()
        ],
    }
    (META / "downloads.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    for g in out["groups"]:
        print(f"{g['id']:9s} {len(g['files']):4d} files  {sum(f['bytes'] for f in g['files']) / 1e6:9.1f} MB")


if __name__ == "__main__":
    main()
