/** Client for the assistant endpoints (backend/app/assistant). Replies stream as server-sent events. */
import type { Proposal } from "../features/assistant/applyProposal";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantStatus {
  available: boolean;
  reason: string;
  model?: string;
}

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "notice"; text: string }
  | { type: "tool"; name: string; label: string }
  | ({ type: "proposal" } & Proposal)
  | { type: "error"; message: string }
  | { type: "done" };

export async function assistantStatus(): Promise<AssistantStatus> {
  try {
    const r = await fetch("/api/assistant/status");
    if (!r.ok) return { available: false, reason: `The server does not offer the assistant (HTTP ${r.status}).` };
    return (await r.json()) as AssistantStatus;
  } catch {
    return { available: false, reason: "The Penumbra server could not be reached." };
  }
}

/** Split an SSE buffer into complete `data:` payloads; returns the events and the unfinished remainder. */
export function parseSse(buffer: string): { events: AssistantEvent[]; rest: string } {
  const events: AssistantEvent[] = [];
  const chunks = buffer.split(/\r?\n\r?\n/);
  const rest = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const data = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AssistantEvent);
    } catch {
      /* ignore a malformed line rather than breaking the whole reply */
    }
  }
  return { events, rest };
}

/** Send the conversation, a snapshot of the screen and the machine-readable settings the analysis tools default to;
 *  `onEvent` receives text deltas and tool progress as they arrive. */
export async function askAssistant(
  messages: ChatTurn[],
  context: unknown,
  params: unknown,
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context, params }),
    signal,
  });
  if (!r.ok || !r.body) {
    let message = `The assistant request failed (HTTP ${r.status}).`;
    try {
      const j = await r.json();
      if (j?.error?.message) message = j.error.message;
    } catch {
      /* not JSON */
    }
    onEvent({ type: "error", message });
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    for (const e of events) {
      if (e.type === "done" || e.type === "error") finished = true;
      onEvent(e);
    }
  }
  if (!finished) onEvent({ type: "error", message: "The reply was interrupted. Try again." });
}
