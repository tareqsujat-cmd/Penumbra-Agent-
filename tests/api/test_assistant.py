"""Assistant endpoint: prompt assembly, availability, validation and the event stream (no Claude API calls)."""
import json

from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app.assistant import agent as AG

client = TestClient(M.app, raise_server_exceptions=False)


def turns(*pairs):
    return [AG.ChatTurn(role=r, content=c) for r, c in pairs]


def test_snapshot_rides_on_latest_user_turn_only():
    msgs = AG.build_messages(turns(("user", "hi"), ("assistant", "hello"), ("user", "explain P10")), {"site": "cr1", "a": 1})
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[0]["content"] == "hi" and "<app_state>" not in msgs[1]["content"]
    last = msgs[-1]["content"]
    assert last.startswith("<app_state>\n{\"a\":1,\"site\":\"cr1\"}\n</app_state>") and last.endswith("explain P10")


def test_history_is_capped_and_starts_with_user():
    long = [("user" if i % 2 == 0 else "assistant", f"m{i}") for i in range(AG.MAX_TURNS + 6)] + [("user", "last")]
    msgs = AG.build_messages(turns(*long), None)
    assert len(msgs) <= AG.MAX_TURNS and msgs[0]["role"] == "user" and msgs[-1]["content"].endswith("last")


def test_system_prompt_is_cached_and_grounded():
    (block,) = AG.system_blocks()
    assert block["cache_control"] == {"type": "ephemeral"}
    assert "<app_state>" in block["text"] and "Never estimate" in block["text"]


def test_unavailable_when_offline(monkeypatch):
    monkeypatch.setenv("PENUMBRA_OFFLINE", "1")
    assert client.get("/api/assistant/status").json()["available"] is False
    r = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ASSISTANT_UNAVAILABLE"


def test_last_message_must_be_from_user():
    r = client.post("/api/assistant", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 422


def test_stream_is_server_sent_events(monkeypatch):
    seen = {}

    async def fake_stream(req):
        seen["context"] = req.context
        yield {"type": "text", "text": "Hello "}
        yield {"type": "text", "text": "there."}
        yield {"type": "done"}

    monkeypatch.setattr(AG, "status", lambda: {"available": True, "reason": "", "model": "test"})
    monkeypatch.setattr(AG, "stream_reply", fake_stream)
    r = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "hi"}], "context": {"site": "shk"}})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert "".join(e.get("text", "") for e in events) == "Hello there." and events[-1] == {"type": "done"}
    assert seen["context"] == {"site": "shk"}
