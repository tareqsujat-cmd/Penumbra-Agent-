"""Download the raw NASA/JPL data Penumbra needs into data/raw/ and verify every file (see DATA_DOWNLOAD_MANUAL.md).

    python scripts/download_data.py                  download everything (about 3.3 GB), skip what is already there
    python scripts/download_data.py --list           groups, file counts and sizes
    python scripts/download_data.py --only spice,lola
    python scripts/download_data.py --skip docs,imagery
    python scripts/download_data.py --check          verify the files on disk (full SHA-256), download nothing
    python scripts/download_data.py --jobs 3         parallel downloads (default 2, at most 3)

Uses the Python standard library only, so it runs before `pip install`. The file list, sources and checksums are in
data/metadata/downloads.json. Interrupted downloads resume from their *.part file when the server allows it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "metadata" / "downloads.json"
USER_AGENT = "penumbra-data-downloader/1.0"
CHUNK = 1 << 20
RETRIES = 4
PRINT = threading.Lock()


def say(msg: str) -> None:
    with PRINT:
        print(msg, flush=True)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1000 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1000
    return f"{n:.1f} GB"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(CHUNK), b""):
            h.update(b)
    return h.hexdigest()


def rows_sha256(p: Path, url: str) -> str | None:
    """Hash of the data rows only (same rule as scripts/build_download_manifest.py); None if there are no data rows."""
    text = p.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
    if "horizons" in url:
        if "$$SOE" not in text or "$$EOE" not in text:
            return None
        body = text[text.index("$$SOE"):text.index("$$EOE")]
    else:
        body = "\n".join(ln for ln in text.split("\n") if ln.strip() and not ln.startswith("#"))
        if not body:
            return None
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def verify(p: Path, f: dict) -> tuple[bool, str]:
    """(ok, note). A 'rows' mismatch is reported but not fatal: the online services may have updated their models."""
    if f["check"] == "sha256":
        good = p.stat().st_size == f["bytes"] and sha256(p) == f["sha256"]
        return good, "" if good else "SHA-256 mismatch"
    if f["check"] == "rows":
        h = rows_sha256(p, f["url"])
        if h is None:
            return False, "the response contains no data rows (service error or changed format)"
        return True, "" if h == f["rows_sha256"] else "data rows differ from the reference copy (kept; see the manual)"
    good = p.stat().st_size == f["bytes"]
    return good, "" if good else "size mismatch"


def present(p: Path, f: dict) -> bool:
    """Fast skip test: the file exists with the expected size (rows files: exists and is not empty)."""
    if not p.exists():
        return False
    return p.stat().st_size > 0 if f["check"] == "rows" else p.stat().st_size == f["bytes"]


def attempt_once(url: str, f: dict, part: Path, dest: Path, resumable: bool) -> tuple[str, str]:
    """One download attempt from one URL; raises on failure."""
    have = part.stat().st_size if resumable and part.exists() else 0
    if have >= f["bytes"]:  # a complete .part from an earlier run: verify it instead of asking for more bytes
        good, note = verify(part, f)
        if good:
            os.replace(part, dest)
            say(f"  done  {f['path']}  (resumed file verified)")
            return "ok", ""
        part.unlink()
        have = 0
    headers = {"User-Agent": USER_AGENT}
    if have:
        headers["Range"] = f"bytes={have}-"
    t0 = time.time()
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as r:
        append = have and r.status == 206
        with open(part, "ab" if append else "wb") as out:
            shutil.copyfileobj(r, out, CHUNK)
    size = part.stat().st_size
    if f["check"] != "rows" and size < f["bytes"]:
        raise OSError(f"connection closed early ({human(size)} of {human(f['bytes'])})")
    good, note = verify(part, f)
    if not good:
        part.unlink(missing_ok=True)
        raise OSError(note)
    os.replace(part, dest)
    rate = size / max(time.time() - t0, 1e-3)
    say(f"  done  {f['path']}  {human(size)}  ({human(rate)}/s){'  WARNING: ' + note if note else ''}")
    return ("warn" if note else "ok"), note


def fetch(f: dict, dest: Path) -> tuple[str, str]:
    """Download one file to dest (via dest.part), trying the mirrors in turn before waiting to retry.
    Returns (status, note) with status in ok / warn / fail."""
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    resumable = f["check"] != "rows"  # API responses are regenerated on every request
    urls = [f["url"], *f.get("mirrors", [])]
    last = ""
    for attempt in range(1, RETRIES + 1):
        for url in urls:
            try:
                return attempt_once(url, f, part, dest, resumable)
            except (urllib.error.URLError, OSError, TimeoutError) as e:
                last = f"{urllib.parse.urlsplit(url).netloc}: {getattr(e, 'reason', e)}"
        if attempt < RETRIES:
            wait = 5 * 3 ** (attempt - 1)
            say(f"  retry {f['path']}  ({last}; attempt {attempt + 1} of {RETRIES} in {wait} s)")
            time.sleep(wait)
    say(f"  FAIL  {f['path']}  ({last})")
    return "fail", last


def main() -> int:
    ap = argparse.ArgumentParser(description="Download and verify Penumbra's raw NASA/JPL data (see DATA_DOWNLOAD_MANUAL.md).")
    ap.add_argument("--list", action="store_true", help="list the download groups and exit")
    ap.add_argument("--only", default="", help="comma-separated groups to download (default: all)")
    ap.add_argument("--skip", default="", help="comma-separated groups to leave out")
    ap.add_argument("--match", default="", help="only files whose path contains this text")
    ap.add_argument("--check", action="store_true", help="verify files already on disk (full checksums); no downloads")
    ap.add_argument("--jobs", type=int, default=2, help="parallel downloads, 1-3 (default 2)")
    ap.add_argument("--dest", default=str(ROOT), help="folder that receives data/raw/ (default: this repository)")
    a = ap.parse_args()

    groups = json.loads(MANIFEST.read_text(encoding="utf-8"))["groups"]
    ids = [g["id"] for g in groups]
    only = [s for s in a.only.split(",") if s]
    skip = [s for s in a.skip.split(",") if s]
    unknown = [s for s in only + skip if s not in ids]
    if unknown:
        print(f"unknown group(s): {', '.join(unknown)}. Groups: {', '.join(ids)}")
        return 2
    if a.list:
        print(f"{'group':9s} {'files':>5s} {'size':>9s}  contents (source)")
        for g in groups:
            print(f"{g['id']:9s} {len(g['files']):5d} {human(sum(f['bytes'] for f in g['files'])):>9s}  {g['title']} ({g['source']})")
        total = sum(f["bytes"] for g in groups for f in g["files"])
        print(f"{'total':9s} {sum(len(g['files']) for g in groups):5d} {human(total):>9s}")
        return 0

    root = Path(a.dest).resolve()
    chosen = [f for g in groups if (not only or g["id"] in only) and g["id"] not in skip
              for f in g["files"] if a.match in f["path"]]
    if not chosen:
        print("nothing selected")
        return 2

    if a.check:
        bad = missing = 0
        for f in chosen:
            p = root / f["path"]
            if not p.exists():
                missing += 1
                print(f"  missing  {f['path']}")
                continue
            good, note = verify(p, f)
            bad += not good
            if note:
                print(f"  {'BAD ' if not good else 'note'}  {f['path']}: {note}")
        print(f"\n{len(chosen) - missing - bad} of {len(chosen)} files present and verified; {missing} missing, {bad} failed.")
        return 0 if not (bad or missing) else 1

    todo = [f for f in chosen if not present(root / f["path"], f)]
    need = sum(f["bytes"] for f in todo)
    print(f"{len(chosen)} files selected: {len(chosen) - len(todo)} already present, {len(todo)} to download ({human(need)}).")
    if not todo:
        print("Nothing to download. Use --check to verify checksums.")
        return 0
    (root / "data").mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(root / "data").free
    if free < need * 1.05:
        print(f"Not enough free disk space: {human(free)} free, {human(need)} needed.")
        return 1
    jobs = max(1, min(3, a.jobs))
    big_first = sorted(todo, key=lambda f: -f["bytes"])  # long transfers start early, small files fill the gaps
    with ThreadPoolExecutor(jobs) as pool:
        results = list(pool.map(lambda f: fetch(f, root / f["path"]), big_first))
    failed = [f["path"] for f, (st, _) in zip(big_first, results) if st == "fail"]
    warned = [f["path"] for f, (st, _) in zip(big_first, results) if st == "warn"]
    print(f"\nDownloaded {len(todo) - len(failed)} of {len(todo)} files. {len(warned)} with notes, {len(failed)} failed.")
    if failed:
        print("Run the same command again to retry the failed files (finished files are kept):")
        for p in failed:
            print(f"  {p}")
        return 1
    print("Next: python tasks.py precompute   (cached horizon grids)\n      python tasks.py imagery      (globe imagery tiles)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
