"""Space assistant chat: a hosted LLM behind an OpenAI-compatible API (Groq by default), called from the server only.

The browser sends the conversation to POST /api/chat; this module adds the system prompt, trims the history and
calls the provider with the key from the server's environment. The key never reaches the browser and is never logged.
Switch provider by changing .env only (see .env.example for Groq, Gemini, OpenRouter and Ollama).

Settings (.env on the server):
    LLM_BASE_URL   the provider's OpenAI-compatible URL (default Groq)
    LLM_API_KEY    the provider's API key
    LLM_MODEL      model ID at that provider (default openai/gpt-oss-120b)
"""
import logging
import os
from typing import Literal

from pydantic import BaseModel, Field, field_validator

log = logging.getLogger("penumbra.chat")

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "openai/gpt-oss-120b"
MAX_TOKENS = 500  # longest reply, in tokens (roughly 350 words): caps reply length and therefore cost/quota
TEMPERATURE = 0.7  # randomness: 0 = always the most likely words, higher = more varied replies
MAX_HISTORY = 10  # only the last 10 messages go to the model (free tiers cap tokens per minute); the UI keeps them all

SYSTEM_PROMPT = (
    "You are the space assistant inside Penumbra, a lunar landing-planning app for the Moon's south pole "
    "(NASA Space Apps 2026). You help users with questions about space, astronomy, NASA missions and this app's "
    "features (a 3-D Moon globe; five south-pole landing sites on NASA 5 m terrain; terrain-aware sunlight and Earth "
    "visibility; landing uncertainty with 2,000 simulated touchdowns and the 'robust aim', the target that stays "
    "sunny even if you miss; a mission calendar with Sun, Earth, Deep Space Network and battery rows; the skyline "
    "view; a power scenario for rovers such as VIPER; site comparison; validation against NASA data; and export). "
    "Explain clearly for a general audience. If you're not sure of a fact, say so instead of guessing. If a "
    "question has nothing to do with space or the app, answer briefly and steer back. "
    # added after testing: the model answered a pasta-recipe request in full, and used tables in a narrow panel
    "Off-topic requests (recipes, homework, code and the like) should not be fulfilled: reply in one or two "
    "sentences that you're Penumbra's space assistant, and suggest a related space question instead. "
    "Your answers appear in a narrow chat panel: use short paragraphs and '- ' bullet lists rather than tables."
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=200)

    @field_validator("messages")
    @classmethod
    def last_is_user(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        if v[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return v


class ChatError(Exception):
    """A failure with a message that is safe and friendly to show in the chat."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def base_url() -> str:
    return os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL


def model() -> str:
    return os.environ.get("LLM_MODEL") or DEFAULT_MODEL


def configured() -> bool:
    return bool(os.environ.get("LLM_API_KEY"))


def status() -> dict:
    """For /api/assistant/status: whether the chat is set up, and with what (never the key)."""
    return {"configured": configured(), "model": model(), "base_url": base_url()}


def _scrub(text: str) -> str:
    key = os.environ.get("LLM_API_KEY")
    return text.replace(key, "<key>") if key else text


def chat(req: ChatRequest) -> str:
    """Send the system prompt plus the last MAX_HISTORY messages; return the model's reply (markdown)."""
    if not configured():
        raise ChatError(503, "CHAT_UNAVAILABLE", "The space assistant isn't set up on this server yet (LLM_API_KEY is missing in .env).")
    import openai
    from openai import OpenAI

    # max_retries=0: a rate-limited request is reported straight away instead of being retried automatically
    client = OpenAI(base_url=base_url(), api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
    recent = [{"role": m.role, "content": m.content} for m in req.messages[-MAX_HISTORY:]]
    try:
        response = client.chat.completions.create(
            model=model(),
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, *recent],
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
        )
    except openai.AuthenticationError:
        log.warning("LLM provider rejected the API key (401) at %s", base_url())
        raise ChatError(502, "LLM_AUTH", "The space assistant's API key is invalid. Check LLM_API_KEY in .env.") from None
    except openai.RateLimitError as e:
        log.warning("LLM provider rate limit (429) for %s: %s", model(), _scrub(str(e))[:300])
        raise ChatError(429, "LLM_RATE_LIMIT", "The space assistant has hit its rate limit. Please wait a minute and try again.") from None
    except (openai.NotFoundError, openai.BadRequestError) as e:
        text = _scrub(str(e)).lower()
        log.warning("LLM provider error %s for model %s: %s", getattr(e, "status_code", "?"), model(), text[:300])
        if isinstance(e, openai.NotFoundError) or "model" in text and ("not found" in text or "does not exist" in text or "decommissioned" in text):
            raise ChatError(502, "LLM_MODEL", f"The model \"{model()}\" wasn't found at this provider. Check LLM_MODEL in .env.") from None
        raise ChatError(502, "LLM_ERROR", "The space assistant couldn't get an answer right now. Please try again in a moment.") from None
    except Exception as e:  # noqa: BLE001  (network errors, 5xx…: details in the server log, never the key)
        log.error("space assistant failed: %s: %s", type(e).__name__, _scrub(str(e))[:300])
        raise ChatError(502, "LLM_ERROR", "The space assistant couldn't get an answer right now. Please try again in a moment.") from None
    reply = (response.choices[0].message.content or "").strip()
    return reply or "Sorry, I didn't get an answer that time. Could you ask again?"
