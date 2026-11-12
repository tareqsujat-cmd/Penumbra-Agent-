"""Space assistant chat (POST /api/chat) with the OpenAI-compatible client replaced (no network, no key)."""
import httpx2
import openai
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app.assistant import llm_chat as LC

client = TestClient(M.app, raise_server_exceptions=False)
KEY = "gsk_TESTKEY_should_never_leak_0123456789"


class FakeOpenAI:
    """Stands in for openai.OpenAI; records how it was built and called, returns `reply` or raises `error`."""

    last = {}
    reply = "Hello from the space assistant."
    error = None

    def __init__(self, base_url=None, api_key=None, **kw):
        FakeOpenAI.last = {"base_url": base_url, "api_key": api_key, **kw}
        self.chat = self
        self.completions = self

    def create(self, **kw):
        FakeOpenAI.last.update(kw)
        if FakeOpenAI.error:
            raise FakeOpenAI.error
        msg = type("M", (), {"content": FakeOpenAI.reply})
        return type("C", (), {"choices": [type("Ch", (), {"message": msg})]})


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("LLM_API_KEY", KEY)
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    FakeOpenAI.error = None


def ask(*msgs):
    return client.post("/api/chat", json={"messages": [{"role": r, "content": c} for r, c in msgs]})


def api_error(cls, status, text="error"):
    resp = httpx2.Response(status, request=httpx2.Request("POST", "https://api.groq.com/openai/v1/chat/completions"))
    return cls(text, response=resp, body=None)


def test_reply_uses_provider_settings_system_prompt_and_constants():
    r = ask(("user", "hi"))
    assert r.status_code == 200 and r.json() == {"reply": "Hello from the space assistant.", "model": "openai/gpt-oss-120b"}
    call = FakeOpenAI.last
    assert call["base_url"] == "https://api.groq.com/openai/v1" and call["api_key"] == KEY and call["max_retries"] == 0
    assert call["model"] == "openai/gpt-oss-120b" and call["max_tokens"] == LC.MAX_TOKENS == 500 and call["temperature"] == LC.TEMPERATURE == 0.7
    assert call["messages"][0] == {"role": "system", "content": LC.SYSTEM_PROMPT}


def test_only_the_last_10_messages_are_sent():
    turns = [("user" if i % 2 == 0 else "assistant", f"m{i}") for i in range(14)] + [("user", "latest")]
    ask(*turns)
    sent = FakeOpenAI.last["messages"]
    assert sent[0]["role"] == "system" and len(sent) == 1 + LC.MAX_HISTORY == 11
    assert sent[-1]["content"] == "latest" and sent[1]["content"] == "m5"


def test_provider_and_model_come_from_env(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "llama3.2")
    assert ask(("user", "hi")).json()["model"] == "llama3.2" and FakeOpenAI.last["base_url"] == "http://localhost:11434/v1"
    monkeypatch.delenv("LLM_MODEL")
    monkeypatch.delenv("LLM_BASE_URL")
    assert ask(("user", "hi")).json()["model"] == LC.DEFAULT_MODEL and FakeOpenAI.last["base_url"] == LC.DEFAULT_BASE_URL


@pytest.mark.parametrize("cls,status,code,phrase", [
    (openai.AuthenticationError, 401, "LLM_AUTH", "API key is invalid"),
    (openai.RateLimitError, 429, "LLM_RATE_LIMIT", "wait a minute"),
    (openai.NotFoundError, 404, "LLM_MODEL", "Check LLM_MODEL"),
    (openai.InternalServerError, 500, "LLM_ERROR", "try again in a moment"),
])
def test_errors_become_friendly_messages(cls, status, code, phrase):
    FakeOpenAI.error = api_error(cls, status, f"provider said no for {KEY}")
    r = ask(("user", "hi"))
    e = r.json()["error"]
    assert e["code"] == code and phrase in e["message"] and KEY not in r.text
    assert "credit" not in e["message"].lower()  # the old Hugging Face credits message is gone


def test_model_not_found_as_bad_request_and_network_errors():
    FakeOpenAI.error = api_error(openai.BadRequestError, 400, "The model `foo` does not exist or you do not have access to it.")
    assert ask(("user", "hi")).json()["error"]["code"] == "LLM_MODEL"
    FakeOpenAI.error = ConnectionError("network down")
    assert ask(("user", "hi")).json()["error"]["code"] == "LLM_ERROR"


def test_not_configured_and_validation(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY")
    r = ask(("user", "hi"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "CHAT_UNAVAILABLE"
    assert client.get("/api/assistant/status").json()["chat"]["configured"] is False
    assert ask(("assistant", "hi")).status_code == 422


def test_key_is_never_in_status():
    st = client.get("/api/assistant/status")
    assert KEY not in st.text and st.json()["chat"] == {"configured": True, "model": "openai/gpt-oss-120b", "base_url": "https://api.groq.com/openai/v1"}
