"""Penumbra task runner (Instructions §56-57). Run with the backend's Python environment:

    python tasks.py doctor        check Python, Node, packages, datasets, SPICE kernels, caches, ports
    python tasks.py link          hard-link the raw NASA/JPL files into data/raw and write datasets.json
    python tasks.py precompute    build the cached horizon grids, geometry and metric fields (about 5 minutes)
    python tasks.py build         type-check and build the frontend into dist/
    python tasks.py dev           build if needed, then serve app + API + tiles on http://127.0.0.1:4173
    python tasks.py dev --vite    also run the Vite dev server on :5173 (hot reload, proxies /api)
    python tasks.py test          scientific + API (pytest) and frontend (vitest) tests; writes docs/test_results.json
    python tasks.py test --e2e    also the browser journeys A-C (needs the server running) with screenshots
"""
from __future__ import annotations

import importlib.metadata
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable
NPX = "npx.cmd" if os.name == "nt" else "npx"
NPM = "npm.cmd" if os.name == "nt" else "npm"
PORT = int(os.environ.get("PENUMBRA_PORT", "4173"))


def run(cmd: list[str], **kw) -> int:
    print("$", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=ROOT, **kw)


def ok(flag: bool, label: str, hint: str = "") -> bool:
    print(f"  [{'OK' if flag else 'FAIL'}] {label}" + ("" if flag or not hint else f"  -> {hint}"))
    return flag


# ---------------------------------------------------------------------------------------------- doctor
def doctor() -> int:
    good = True
    print("Python")
    good &= ok(sys.version_info >= (3, 11), f"Python {sys.version.split()[0]} (>= 3.11)")
    req = [ln.split("==") for ln in (ROOT / "backend/requirements.txt").read_text().splitlines() if "==" in ln]
    for name, ver in req:
        try:
            have = importlib.metadata.version(name)
            good &= ok(True, f"{name} {have}" + ("" if have == ver else f" (tested with {ver})"))
        except importlib.metadata.PackageNotFoundError:
            good &= ok(False, f"{name} missing", "pip install -r backend/requirements.txt")
    print("Node")
    node = shutil.which("node")
    good &= ok(bool(node), f"node {subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip() if node else 'missing'}", "install Node 20+")
    good &= ok((ROOT / "node_modules").exists(), "frontend dependencies (node_modules)", "npm ci")
    good &= ok((ROOT / "dist/index.html").exists(), "frontend build (dist/)", "python tasks.py build")
    print("Data")
    files = ROOT / "data/metadata/files.json"
    if ok(files.exists(), "data/metadata/files.json", "python tasks.py link"):
        fl = json.loads(files.read_text(encoding="utf-8"))["files"]
        missing = [f["path"] for f in fl if not (ROOT / f["path"]).exists()]
        good &= ok(not missing, f"{len(fl) - len(missing)}/{len(fl)} raw files present", f"missing e.g. {missing[:3]}")
    sys.path.insert(0, str(ROOT))
    from backend.app.science import ephemeris as eph  # noqa: E402
    for k in eph.KERNELS:
        good &= ok((ROOT / "data/raw/spice" / k).exists(), f"SPICE kernel {k}", "python tasks.py link")
    print("Cached products")
    hz = sorted((ROOT / "data/cache/horizons").glob("*.npz")) if (ROOT / "data/cache/horizons").exists() else []
    from backend.app.services.sites import SITES  # noqa: E402
    for sid in SITES:
        ok(any(p.name.startswith(sid + "_m2") for p in hz), f"horizon grid {sid}", "python tasks.py precompute (else built on first request)")
    print("Network")
    with socket.socket() as s:
        busy = s.connect_ex(("127.0.0.1", PORT)) == 0
    ok(True, f"port {PORT} {'in use (a server may already be running)' if busy else 'free'}")
    print("\nAll required checks passed." if good else "\nSome required checks failed (see hints above).")
    return 0 if good else 1


# ---------------------------------------------------------------------------------------------- build / dev
def build() -> int:
    return run([NPX, "tsc", "--noEmit", "-p", "."]) or run([NPX, "vite", "build"])


def dist_stale() -> bool:
    idx = ROOT / "dist/index.html"
    if not idx.exists():
        return True
    built = idx.stat().st_mtime
    return any(p.stat().st_mtime > built for p in (ROOT / "src").rglob("*") if p.is_file())


def dev(vite: bool) -> int:
    if dist_stale() and build():
        return 1
    procs = []
    if vite:
        procs.append(subprocess.Popen([NPX, "vite"], cwd=ROOT))
    print(f"\nPenumbra on http://127.0.0.1:{PORT}/  (Ctrl+C to stop)\n", flush=True)
    try:
        return run([PY, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", str(PORT)])
    finally:
        for p in procs:
            p.terminate()


# ---------------------------------------------------------------------------------------------- tests
def _pytest(path: str, name: str) -> dict:
    out = subprocess.run([PY, "-m", "pytest", path, "-q", "-p", "no:cacheprovider"], cwd=ROOT, capture_output=True, text=True)
    print(out.stdout[-2500:])
    m_pass = re.search(r"(\d+) passed", out.stdout)
    m_fail = re.search(r"(\d+) failed", out.stdout)
    m_err = re.search(r"(\d+) error", out.stdout)
    p = int(m_pass.group(1)) if m_pass else 0
    f = (int(m_fail.group(1)) if m_fail else 0) + (int(m_err.group(1)) if m_err else 0)
    return {"name": name, "passed": p, "total": p + f}


def test(e2e: bool) -> int:
    suites = [_pytest("tests/scientific", "Scientific (coordinates, horizons, geometry, uncertainty, power)"),
              _pytest("tests/api", "API (endpoints, errors, timeouts)")]
    v = subprocess.run([NPX, "vitest", "run", "--reporter=json", "--outputFile=data/vitest.json"], cwd=ROOT, capture_output=True, text=True)
    try:
        j = json.loads((ROOT / "data/vitest.json").read_text(encoding="utf-8"))
        suites.append({"name": "Frontend (Vitest)", "passed": j["numPassedTests"], "total": j["numTotalTests"]})
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        print(v.stdout[-2000:], v.stderr[-2000:])
        suites.append({"name": "Frontend (Vitest)", "passed": 0, "total": 0})
    if e2e:
        suites.append(_pytest("tests/e2e", "End-to-end journeys A-C (Playwright)"))
    report = {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "suites": suites}
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/test_results.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for s in suites:
        print(f"{s['name']}: {s['passed']} / {s['total']}")
    return 0 if all(s["passed"] == s["total"] and s["total"] > 0 for s in suites) else 1


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else "help"
    if cmd == "doctor":
        return doctor()
    if cmd == "link":
        return run([PY, "scripts/link_data.py"]) or run([PY, "scripts/build_datasets.py"])
    if cmd == "precompute":
        return run([PY, "scripts/precompute.py", *args[1:]])
    if cmd == "build":
        return build()
    if cmd == "dev":
        return dev("--vite" in args)
    if cmd == "test":
        return test("--e2e" in args)
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
