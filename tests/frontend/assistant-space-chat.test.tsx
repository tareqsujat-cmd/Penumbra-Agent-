import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantPanel } from "../../src/features/assistant/AssistantPanel";
import { setState } from "../../src/state/store";

type Body = { messages: { role: string; content: string }[] };

describe("space assistant (LLM provider via POST /api/chat)", () => {
  const sent: Body[] = [];
  let chatReply: () => Response;

  beforeEach(() => {
    sent.length = 0;
    chatReply = () => new Response(JSON.stringify({ reply: "**JWST** looks for the first galaxies.", model: "openai/gpt-oss-120b" }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/chat") {
          sent.push(JSON.parse(String(init?.body)));
          return chatReply();
        }
        return new Response(JSON.stringify({ available: false, reason: "no Claude key", chat: { configured: true, model: "openai/gpt-oss-120b" } }), { status: 200 });
      }),
    );
    setState({ mode: "about", assistantOpen: true, assistantStart: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setState({ assistantOpen: false });
  });

  const type = (text: string) => {
    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  };

  it("sends questions the guide doesn't recognise, with the session history, and renders the markdown reply", async () => {
    render(<AssistantPanel />);
    await screen.findByText(/your guide to Penumbra/);
    type("What does P10 mean?"); // the built-in guide answers this one itself
    await screen.findByText(/planning for a bad day/);
    expect(sent).toHaveLength(0);

    type("What is the James Webb Space Telescope looking for?");
    expect((await screen.findByText("JWST")).tagName).toBe("STRONG");
    expect(screen.getAllByText("Space assistant").length).toBeGreaterThan(0);
    const msgs = sent[0].messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "What is the James Webb Space Telescope looking for?" });
    expect(msgs.some((m) => m.content === "What does P10 mean?")).toBe(true); // earlier turns go along
    expect(msgs.every((m) => m.role !== "system")).toBe(true); // the system prompt is added on the server
  });

  it("shows a friendly message when the provider's rate limit is hit", async () => {
    chatReply = () => new Response(JSON.stringify({ error: { code: "LLM_RATE_LIMIT", message: "The space assistant has hit its rate limit. Please wait a minute and try again." } }), { status: 429 });
    render(<AssistantPanel />);
    await screen.findByText(/your guide to Penumbra/);
    type("Tell me about Saturn's rings");
    expect((await screen.findByRole("alert")).textContent).toContain("wait a minute");
  });
});
