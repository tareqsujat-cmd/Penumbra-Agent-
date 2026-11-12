"""Penumbra assistant: streams Claude's answer to the person's question, grounded in a snapshot of their screen.

The browser sends the conversation, an <app_state> snapshot of the screen (site, settings, numbers already computed)
and a machine-readable copy of the settings. Claude explains what is on screen and, for anything not there ("what if
I land on 15 July?"), calls the analysis tools in tools.py, which run Penumbra's own science code.

Settings (environment or .env):
    ANTHROPIC_API_KEY             credentials (or ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile)
    PENUMBRA_ASSISTANT_MODEL      default claude-opus-5-5
    PENUMBRA_ASSISTANT_EFFORT     low | medium | high (default medium)
    PENUMBRA_ASSISTANT            set to 0 to switch the assistant off
    PENUMBRA_OFFLINE=1            also switches it off (it needs the Claude API)
"""
from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .guide import SYSTEM_PROMPT
from .tools import MAX_ITERATIONS, TOOL_LABELS, MissionParams, make_tools

log = logging.getLogger("penumbra.assistant")

MODEL = os.environ.get("PENUMBRA_ASSISTANT_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("PENUMBRA_ASSISTANT_EFFORT", "medium")
MAX_TOKENS = 16000
MAX_TURNS = 30  # messages kept from the conversation (older ones are dropped)
MAX_CONTEXT_CHARS = 12000  # serialized <app_state> size limit
FALLBACK_BETA = "server-side-fallback-2026-07-01"


# ---------------------------------------------------------------------------------------------- request schema
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class AssistantRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=200)
    context: dict | None = None
    # machine-readable copy of the settings: the analysis tools default to them
    params: MissionParams | None = None

    @field_validator("messages")
    @classmethod
    def last_is_user(cls, v: list[ChatTurn]) -> list[ChatTurn]:
        if v[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return v


# ---------------------------------------------------------------------------------------------- availability
def status() -> dict:
    """Whether the assistant can run here, and why not (shown in the panel instead of a broken chat)."""
    if os.environ.get("PENUMBRA_OFFLINE") == "1":
        return {"available": False, "reason": "The assistant needs the Claude API, so it is off in offline mode (PENUMBRA_OFFLINE=1)."}
    if os.environ.get("PENUMBRA_ASSISTANT", "1") == "0":
        return {"available": False, "reason": "The assistant is switched off on this server (PENUMBRA_ASSISTANT=0)."}
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return {"available": False, "reason": "The 'anthropic' Python package is not installed on the server (pip install -r backend/requirements.txt)."}
    if not _has_credentials():
        return {"available": False, "reason": "No Claude API credentials on the server. Set ANTHROPIC_API_KEY in the environment or in .env, then restart."}
    return {"available": True, "reason": "", "model": MODEL}


def _has_credentials() -> bool:
    if any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_IDENTITY_TOKEN_FILE")):
        return True
    # a profile stored by `ant auth login`
    cfg = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "anthropic"
    return cfg.is_dir() and any(cfg.iterdir())


# ---------------------------------------------------------------------------------------------- prompt assembly
def render_context(context: dict | None) -> str:
    """The screen snapshot as a compact, stable JSON block (sorted keys, so equal states give equal text)."""
    if not context:
        return "<app_state>\n{}\n</app_state>"
    text = json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False, default=str)
    if len(text) > MAX_CONTEXT_CHARS:
        text = text[:MAX_CONTEXT_CHARS] + "...(truncated)"
    return f"<app_state>\n{text}\n</app_state>"


def build_messages(turns: list[ChatTurn], context: dict | None) -> list[dict]:
    """Conversation for the API. The snapshot rides on the latest user turn only, after the cached prefix."""
    turns = turns[-MAX_TURNS:]
    while turns and turns[0].role != "user":  # the API requires a user turn first
        turns = turns[1:]
    out = [{"role": t.role, "content": t.content} for t in turns[:-1]]
    out.append({"role": "user", "content": f"{render_context(context)}\n\n{turns[-1].content}"})
    return out


def system_blocks() -> list[dict]:
    return [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]


# ---------------------------------------------------------------------------------------------- streaming
_client = None


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.AsyncAnthropic()
    return _client


async def stream_reply(req: AssistantRequest) -> AsyncIterator[dict]:
    """Yield events for the browser: {"type": "text"} deltas and {"type": "tool"} progress, then {"type": "done"} or
    {"type": "error"}. With settings attached, Claude may call the analysis tools; the SDK's tool runner runs them
    between model turns (one streamed turn per iteration)."""
    import anthropic

    proposals: list[dict] = []  # filled by propose_app_changes while the runner runs tools between turns
    sent = 0
    # the browser always sends params; the defaults are the app's start-up state
    tools = make_tools(req.params or MissionParams(), proposals)
    runner = client().beta.messages.tool_runner(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_blocks(),
        messages=build_messages(req.messages, req.context),
        tools=tools,
        stream=True,
        max_iterations=MAX_ITERATIONS,
        output_config={"effort": EFFORT},
        betas=[FALLBACK_BETA],
        fallbacks="default",  # if Claude declines, the API retries on a fallback model inside the same call
    )
    usage = {"in": 0, "cache_read": 0, "cache_write": 0, "out": 0}
    wrote_text = False
    final = None
    try:
        async for stream in runner:
            # tools of the previous turn have run by now: send any proposals they produced
            for pr in proposals[sent:]:
                yield {"type": "proposal", **pr}
            sent = len(proposals)
            turn_text = False
            async for ev in stream:
                if ev.type == "content_block_start" and ev.content_block.type == "tool_use":
                    name = ev.content_block.name
                    yield {"type": "tool", "name": name, "label": TOOL_LABELS.get(name, name)}
                elif ev.type == "text" and ev.text:
                    if wrote_text and not turn_text:
                        yield {"type": "text", "text": "\n\n"}  # text from a later turn starts a new paragraph
                    turn_text = wrote_text = True
                    yield {"type": "text", "text": ev.text}
            final = await stream.get_final_message()
            u = final.usage
            usage["in"] += u.input_tokens or 0
            usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
            usage["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
            usage["out"] += u.output_tokens or 0
            has_tool_use = any(b.type == "tool_use" for b in final.content)
            # never run tools for a refused turn or a tool call cut off by max_tokens
            if final.stop_reason == "refusal" or (final.stop_reason == "max_tokens" and has_tool_use):
                break
        for pr in proposals[sent:]:
            yield {"type": "proposal", **pr}
        log.info("assistant reply: stop=%s proposals=%d tokens=%s", final.stop_reason if final else None, len(proposals), usage)
        if final is not None and final.stop_reason == "refusal":
            yield {"type": "notice", "text": "The assistant could not answer that request. Try rephrasing it as a question about Penumbra."}
        elif final is not None and final.stop_reason == "max_tokens":
            yield {"type": "notice", "text": "The answer was cut short. Ask for the rest, or a shorter version."}
        elif final is not None and final.stop_reason == "tool_use":
            yield {"type": "notice", "text": "The assistant reached its limit of analysis steps for one question. Ask a narrower question."}
        yield {"type": "done"}
    except ValueError:
        # a tool request the SDK could not parse at all (streamed tool input); nothing was run for it
        log.exception("assistant: unparseable tool input")
        yield _error("The assistant produced an unreadable analysis request. Please ask again.")
    except anthropic.AuthenticationError:
        yield _error("The server's Claude API key was rejected. Check ANTHROPIC_API_KEY.")
    except anthropic.PermissionDeniedError:
        yield _error("The server's Claude API key is not allowed to use this model.")
    except anthropic.RateLimitError:
        yield _error("The Claude API is busy (rate limited). Wait a moment and try again.")
    except anthropic.APIStatusError as e:
        log.warning("assistant API error %s: %s", e.status_code, e.message)
        yield _error(f"The Claude API returned an error ({e.status_code}). Try again shortly.")
    except anthropic.APIConnectionError:
        yield _error("Could not reach the Claude API. Check the server's internet connection.")
    except Exception as e:  # never leave the browser waiting on a broken stream
        log.exception("assistant failed")
        yield _error(f"The assistant failed: {type(e).__name__}. Details are in the server log.")
    finally:
        await runner.close()


def _error(message: str) -> dict:
    return {"type": "error", "message": message}
