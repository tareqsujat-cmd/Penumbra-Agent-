"""API tests (Instructions §40): valid requests and every documented error path."""
import time

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M

client = TestClient(M.app, raise_server_exceptions=False)
VIPER = {"panels": [{"azOffsetDeg": 90, "watts": 320}, {"azOffsetDeg": 180, "watts": 320}, {"azOffsetDeg": 270, "watts": 320}],
         "batteryWh": 5420, "baseLoadW": 250, "hibernateW": 100, "reservePct": 20}
CIRC = {"kind": "circular", "radius": 100}


def err(r):
    return r.json()["error"]["code"]


# ---------------------------------------------------------------------------------------------- valid requests
def test_health_and_sites():
    assert client.get("/api/health").json()["frame"] == "MOON_ME"
    sites = client.get("/api/sites").json()
    assert {s["id"] for s in sites} == {"cr1", "shk", "mal", "mou", "nob"}


def test_site_bundle_is_computed():
    s = client.get("/api/sites/cr1").json()
    f = s["field"]
    assert f["kind"] == "computed" and f["nx"] == len(f["sun"][0]) and f["ny"] == len(f["sun"])
    assert 0 <= min(min(r) for r in f["sun"]) and max(max(r) for r in f["sun"]) <= 100
    assert len(s["skyline"]["deg"]) == 720 and s["ephem"]["n"] == 8760


def test_horizon_endpoint():
    r = client.get("/api/sites/cr1/horizon", params={"x": -260, "y": -210, "mast": 2})
    j = r.json()
    assert r.status_code == 200 and len(j["horizon_elevation_deg"]) == 720 and j["lat"] < -89


def test_landing_risk_percentiles_are_ordered():
    j = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": -260, "y": -210}, "model": CIRC, "percentile": 10}).json()
    p = j["p"]
    assert p["5"] <= p["10"] <= p["20"] <= p["50"] <= 100
    assert j["n"] == 2000 and len(j["samples"]) <= 500 and sum(j["histogram"]) == 2000


def test_landing_risk_is_deterministic():
    body = {"site": "shk", "aim": {"x": 0, "y": 0}, "model": {"kind": "gaussian", "sigmaE": 60, "sigmaN": 40, "rotDeg": 20}, "percentile": 20}
    a = client.post("/api/landing-risk", json=body).json()
    b = client.post("/api/landing-risk", json=body).json()
    assert a["p"] == b["p"]


def test_robust_aim_never_worse_in_the_lower_tail():
    j = client.post("/api/robust-aim", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "model": CIRC, "percentile": 10}).json()
    assert j["robust"]["pq"] >= j["best_nominal"]["pq"]
    assert j["best_nominal"]["value"] >= j["robust"]["value"]
    assert j["candidates"] > 100 and len(j["score"]) > 0


def test_visibility_window():
    j = client.post("/api/visibility", json={"site": "cr1", "aim": {"x": -260, "y": -210}, "startIdx": 4300, "hours": 720, "vehicle": VIPER}).json()
    assert j["hours"] == 720 and len(j["sun_frac"]) == 720 and len(j["station"]["madrid"]) == 720
    assert all(0 <= v <= 1 for v in j["sun_frac"]) and len(j["daily_sun_pct"]) == 365
    s = j["summary"]
    assert 0 <= s["dsn_pct"] <= s["earth_pct"] <= 100  # DSN opportunity requires Earth visibility


def test_compare_and_ranking():
    j = client.post("/api/compare", json={"sites": ["cr1", "mal"], "model": CIRC, "percentile": 10, "vehicle": VIPER}).json()
    assert [r["site"] for r in j["rows"]] == ["cr1", "mal"] and set(j["ranking"]) == {"cr1", "mal"}


def test_validation_and_provenance():
    v = client.get("/api/validation").json()
    assert {"v1_pgda69", "v2_glaser2018", "v4_spice_horizons"} <= set(v)
    p = client.get("/api/provenance").json()
    assert p["groups"] and all(len(g["sha_first"]) == 16 for g in p["groups"])


# ---------------------------------------------------------------------------------------------- errors
def test_unknown_site():
    r = client.get("/api/sites/zzz")
    assert r.status_code == 404 and err(r) == "UNKNOWN_SITE"


def test_invalid_coordinates():
    r = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": 3000, "y": 0}, "model": CIRC})
    assert r.status_code == 422 and err(r) == "OUT_OF_COVERAGE"
    r = client.get("/api/sites/cr1/horizon", params={"x": 2000, "y": 0})
    assert err(r) == "OUT_OF_COVERAGE"
    r = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": 1e6, "y": 0}, "model": CIRC})
    assert r.status_code == 422  # schema bounds


@pytest.mark.parametrize("model", [{"kind": "circular", "radius": -5}, {"kind": "gaussian", "sigmaE": 0, "sigmaN": 10}, {"kind": "hexagon"}])
def test_malformed_uncertainty(model):
    r = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "model": model})
    assert r.status_code == 422 and err(r) == "INVALID_UNCERTAINTY"


def test_dates_out_of_range():
    r = client.post("/api/visibility", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "startIdx": 9000, "hours": 24, "vehicle": VIPER})
    assert r.status_code == 422 and err(r) == "DATE_OUT_OF_RANGE"
    r = client.get("/api/sites/cr1", params={"year": 2200})
    assert err(r) == "DATE_OUT_OF_RANGE"


def test_missing_dataset(monkeypatch, tmp_path):
    from backend.app.science import terrain
    terrain.load_pgda78.cache_clear()
    monkeypatch.setattr(terrain, "RAW", tmp_path)
    from backend.app.services import sites
    sites.stack.cache_clear()
    try:
        r = client.get("/api/sites/nob/terrain", params={"layer": "height"})
        assert r.status_code == 503 and err(r) == "DATASET_MISSING" and "Site06" in r.json()["error"]["message"]
    finally:
        terrain.load_pgda78.cache_clear()
        sites.stack.cache_clear()


def test_compute_failure_is_reported_safely(monkeypatch):
    from backend.app.services import analysis

    def boom(*a, **k):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(analysis, "risk", boom)
    r = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "model": CIRC})
    assert r.status_code == 500 and err(r) == "COMPUTE_FAILED" and "trace_id" in r.json()["error"]["detail"]


def test_timeout(monkeypatch):
    from backend.app.services import analysis

    def slow(*a, **k):
        time.sleep(1.5)

    monkeypatch.setattr(analysis, "risk", slow)
    monkeypatch.setattr(M, "TIMEOUT_S", 0.3)
    r = client.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "model": CIRC})
    assert r.status_code == 500 and err(r) == "COMPUTE_FAILED" and "exceeded" in r.json()["error"]["message"]
