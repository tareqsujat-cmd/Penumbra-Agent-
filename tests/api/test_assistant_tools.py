"""Assistant analysis tools and the tool-runner stream, with the science calls replaced (no data, no Claude API)."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from anthropic.lib.tools import ToolError

from backend.app.assistant import agent as AG
from backend.app.assistant import tools as T
from backend.app.science.errors import DatasetMissing, OutOfCoverage

VIPER = {"id": "viper", "name": "VIPER-class rover", "basis": "verified", "batteryWh": 5420, "baseLoadW": 250, "hibernateW": 100,
         "reservePct": 20, "panels": [{"azOffsetDeg": 90, "watts": 320}, {"azOffsetDeg": 180, "watts": 320}, {"azOffsetDeg": 270, "watts": 320}]}


def params(**kw):
    base = {"site": "cr1", "aim": {"x": -260, "y": -210}, "aimKind": "brightest", "landingIdx": 4309, "windowDays": 30,
            "model": {"kind": "circular", "radius": 100}, "percentile": 10, "vehicleId": "viper", "vehicles": [VIPER]}
    return T.MissionParams(**{**base, **kw})


def tool(name, p=None):
    return next(t for t in T.make_tools(p or params()) if t.name == name)


def call(name, args=None, p=None):
    return json.loads(asyncio.run(tool(name, p).call(args or {})))


RISK = {"nominal": 88.0, "pq": 71.2, "p": {50: 84.0, 20: 77.0, 10: 71.2, 5: 66.0}, "mean": 80.0, "earth_pq": 50.0, "n": 2000, "inside_fraction": 1.0}


def test_risk_defaults_to_current_settings_and_accepts_overrides(monkeypatch):
    seen = {}

    def fake_risk(site, aim, model, q, year, **kw):
        seen.update(site=site, aim=aim, kind=model.kind, radius=model.radius, q=q, **kw)
        return RISK

    monkeypatch.setattr(T.A, "risk", fake_risk)
    out = call("get_landing_risk")
    assert seen["site"] == "cr1" and seen["aim"] == (-260, -210) and seen["radius"] == 100 and seen["q"] == 10 and seen["start"] is None
    assert out["nominal_sunlight_pct"] == 88.0 and out["loss_if_you_miss_pp"] == 16.8
    assert out["sunlight_pct_by_percentile"] == {"P50": 84.0, "P20": 77.0, "P10": 71.2, "P05": 66.0}
    assert "brightest point" in out["inputs"]["aim"]

    out = call("get_landing_risk", {"radius_m": 400, "percentile": 5, "period": "mission_window", "landing_date": "2027-07-15"})
    assert seen["radius"] == 400 and seen["q"] == 5 and seen["start"] == T.Ctx(params()).landing_idx("2027-07-15", 30) and seen["hours"] == 720
    assert out["inputs"]["period"].startswith("30 days from 15 Jul 2027")


def test_tool_input_is_validated():
    with pytest.raises(Exception):  # radius outside 25-400 m never reaches the science code
        asyncio.run(tool("get_landing_risk").call({"radius_m": 5000}))


def test_science_errors_become_tool_errors(monkeypatch):
    def coverage(*a, **k):
        raise OutOfCoverage("more than 5% of the landing zone falls outside the performance grid", inside_fraction=0.9)

    monkeypatch.setattr(T.A, "risk", coverage)
    with pytest.raises(ToolError, match="OUT_OF_COVERAGE"):
        asyncio.run(tool("get_landing_risk").call({}))

    def missing(*a, **k):
        raise DatasetMissing("PDS product missing: ldem_80s_80m")

    monkeypatch.setattr(T.A, "risk", missing)
    with pytest.raises(ToolError, match="not installed"):
        asyncio.run(tool("get_landing_risk").call({}))


def test_dates_sites_and_vehicles_are_checked():
    c = T.Ctx(params())
    assert c.landing_idx("2027-01-02", 30) == 24 + 13  # keeps the current landing hour (13:00)
    assert c.landing_idx("2027-01-02T05", 30) == 29
    for bad in ("2028-01-05", "2027-12-20", "soon"):
        with pytest.raises(ToolError):
            c.landing_idx(bad, 30)
    assert c.site("Shackleton rim") == "shk" and c.site("NOB") == "nob"
    with pytest.raises(ToolError, match="Unknown site"):
        c.site("Tycho")
    with pytest.raises(ToolError, match="Unknown vehicle"):
        c.vehicle("rocket")


def test_another_site_uses_its_brightest_point(monkeypatch):
    monkeypatch.setattr(T.A, "robust", lambda *a, **k: {"best_nominal": {"x": 50.0, "y": 0.0, "value": 70, "pq": 40},
                                                       "robust": {"x": 0.0, "y": 50.0, "value": 65, "pq": 55}, "candidates": 10})
    seen = {}
    monkeypatch.setattr(T.A, "risk", lambda site, aim, *a, **k: seen.update(site=site, aim=aim) or RISK)
    out = call("get_landing_risk", {"site": "shk"})
    assert seen == {"site": "shk", "aim": (50.0, 0.0)} and out["inputs"]["aim"].startswith("brightest point, 50 m grid-east")
    call("get_landing_risk", {"site": "shk", "aim": "robust"})
    assert seen["aim"] == (0.0, 50.0)


def test_robust_aim_reports_gain_and_cost(monkeypatch):
    monkeypatch.setattr(T.A, "robust", lambda *a, **k: {"best_nominal": {"x": 0.0, "y": 0.0, "value": 90, "pq": 60.5},
                                                       "robust": {"x": 30.0, "y": 0.0, "value": 88, "pq": 72.0}, "candidates": 6361})
    out = call("find_robust_aim")
    assert out["P10_gain_pp"] == 11.5 and out["nominal_cost_pp"] == 2 and out["robust_aim"]["offset_from_brightest"] == "30 m grid-east"


def test_compare_needs_two_sites(monkeypatch):
    with pytest.raises(ToolError, match="at least two"):
        asyncio.run(tool("compare_sites").call({"sites": ["cr1", "CR1"]}))


def test_best_dates_are_spread_out_and_rank_the_current_date(monkeypatch):
    daily = [10.0] * 365
    for d in (100, 101, 102, 200):
        daily[d] = 100.0
    monkeypatch.setattr(T.A, "visibility", lambda *a, **k: {"daily_sun_pct": daily})
    monkeypatch.setattr(T.A, "endurance_by_landing_day", lambda *a, **k: {"days": list(range(365)), "endurance_days": [None] * 365})
    out = call("find_best_landing_dates", {"window_days": 3, "count": 3})
    dates = [d["date"] for d in out["best_dates"]]
    assert dates[0] == "11 Apr 2027" and "21 Apr 2027" not in dates[1:2] and len(dates) == 3  # day 100 first, neighbours skipped
    assert out["best_dates"][0]["energy_endurance_days"].startswith("more than 3")
    assert out["current_landing_date"]["rank_among_days"].endswith("of 363")


# ---------------------------------------------------------------------------------------------- the stream loop
class FakeStream:
    def __init__(self, events, final):
        self.events, self.final = events, final

    def __aiter__(self):
        async def gen():
            for e in self.events:
                yield e
        return gen()

    async def get_final_message(self):
        return self.final


class FakeRunner:
    def __init__(self, streams):
        self.streams, self.closed = streams, False

    def __aiter__(self):
        async def gen():
            for s in self.streams:
                yield s
        return gen()

    async def close(self):
        self.closed = True


def msg(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type=b) for b in blocks],
                           usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def test_stream_emits_tool_progress_and_separates_turns(monkeypatch):
    turn1 = FakeStream([SimpleNamespace(type="text", text="Let me check."),
                        SimpleNamespace(type="content_block_start", content_block=SimpleNamespace(type="tool_use", name="get_landing_risk"))],
                       msg("tool_use", "text", "tool_use"))
    turn2 = FakeStream([SimpleNamespace(type="text", text="P10 is 71%.")], msg("end_turn", "text"))
    runner = FakeRunner([turn1, turn2])
    seen = {}

    def fake_tool_runner(**kw):
        seen.update(kw)
        return runner

    monkeypatch.setattr(AG, "client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=fake_tool_runner))))
    req = AG.AssistantRequest(messages=[{"role": "user", "content": "what if"}], params=params())

    async def collect():
        return [e async for e in AG.stream_reply(req)]

    events = asyncio.run(collect())
    assert {"type": "tool", "name": "get_landing_risk", "label": T.TOOL_LABELS["get_landing_risk"]} in events
    assert "".join(e.get("text", "") for e in events) == "Let me check.\n\nP10 is 71%."
    assert events[-1] == {"type": "done"} and runner.closed
    assert seen["stream"] is True and seen["max_iterations"] == T.MAX_ITERATIONS and len(seen["tools"]) == 7


def test_stream_stops_on_refusal(monkeypatch):
    runner = FakeRunner([FakeStream([], msg("refusal")), FakeStream([SimpleNamespace(type="text", text="never")], msg("end_turn"))])
    monkeypatch.setattr(AG, "client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=lambda **k: runner))))

    async def collect():
        return [e async for e in AG.stream_reply(AG.AssistantRequest(messages=[{"role": "user", "content": "x"}]))]

    events = asyncio.run(collect())
    assert not any(e.get("text") == "never" for e in events) and events[-2]["type"] == "notice" and events[-1] == {"type": "done"}


# ---------------------------------------------------------------------------------------------- phase 3: proposals
def propose(args, p=None):
    sink = []
    t = next(t for t in T.make_tools(p or params(), sink) if t.name == "propose_app_changes")
    return json.loads(asyncio.run(t.call(args))), sink


def test_proposals_are_normalised_described_and_not_applied():
    out, sink = propose({"summary": "Try Shackleton in mid July with a loose zone", "site": "Shackleton", "landing_date": "2027-07-15",
                         "radius_m": 390, "percentile": 5, "section": "planner", "dsn_mask_deg": 10})
    (pr,) = sink
    assert "NOT applied" in out["status"] and out["card"]["title"] == pr["summary"]
    ch = pr["changes"]
    assert ch["site"] == "shk" and ch["mode"] == "planner" and ch["percentile"] == 5 and ch["dsnMaskDeg"] == 10.1
    assert ch["uncertainty"] == {"enabled": True, "model": "circular", "radius": 400}  # snapped to the slider's 25 m steps
    assert ch["landingIdx"] == T.Ctx(params()).landing_idx("2027-07-15", 30)
    assert any(l.startswith("Site: Connecting Ridge → Shackleton rim") for l in pr["lines"])
    assert "Robustness level: P10 → P05" in pr["lines"]


def test_proposals_reject_no_ops_and_incomplete_aims():
    with pytest.raises(ToolError, match="Nothing would change"):
        propose({"summary": "Keep it", "site": "cr1", "percentile": 10})
    with pytest.raises(ToolError, match="aim_x_m and aim_y_m"):
        propose({"summary": "Custom aim", "aim": "custom", "aim_x_m": 10})
    with pytest.raises(ToolError, match="Unknown vehicle"):
        propose({"summary": "Use a rocket", "vehicle_id": "rocket"})


def test_robust_aim_proposal_and_analysis_tools_only_without_sink():
    _, sink = propose({"summary": "Command the robust aim", "aim": "robust"})
    assert sink[0]["changes"] == {"aim": {"kind": "robust"}} and "then command the robust aim" in sink[0]["lines"][0]
    assert "propose_app_changes" not in {t.name for t in T.make_tools(params())}


def test_stream_sends_proposals_made_between_turns(monkeypatch):
    class ToolCallingRunner(FakeRunner):
        def __init__(self, streams, tools):
            super().__init__(streams)
            self.tools = tools

        def __aiter__(self):
            async def gen():
                yield self.streams[0]
                await next(t for t in self.tools if t.name == "propose_app_changes").call({"summary": "Go to Compare", "section": "compare"})
                yield self.streams[1]
            return gen()

    streams = [FakeStream([], msg("tool_use", "tool_use")), FakeStream([SimpleNamespace(type="text", text="Click Apply.")], msg("end_turn", "text"))]
    monkeypatch.setattr(AG, "client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
        tool_runner=lambda **k: ToolCallingRunner(streams, k["tools"])))))

    async def collect():
        return [e async for e in AG.stream_reply(AG.AssistantRequest(messages=[{"role": "user", "content": "take me to compare"}], params=params()))]

    events = asyncio.run(collect())
    (pr,) = [e for e in events if e["type"] == "proposal"]
    assert pr["changes"] == {"mode": "compare"} and pr["lines"] == ["Go to 04 Compare"]
    assert events.index(pr) < next(i for i, e in enumerate(events) if e.get("text") == "Click Apply.")
