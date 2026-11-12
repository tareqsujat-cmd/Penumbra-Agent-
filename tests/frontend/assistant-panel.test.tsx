import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../../src/features/assistant/AssistantPanel";
import { setState } from "../../src/state/store";

describe("assistant panel in guide mode (no API key)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: false, reason: "No Claude API credentials" }), { status: 200 })));
    // a section without live mission numbers, so the panel renders without a loaded site
    setState({ mode: "about", assistantOpen: true, assistantStart: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setState({ assistantOpen: false });
  });

  it("greets by name, shows the plan and answers through buttons and typing", async () => {
    render(<AssistantPanel />);
    await screen.findByText(/your guide to Penumbra/);
    expect(screen.getByRole("heading", { name: "Armstrong" })).toBeTruthy();
    expect(screen.getByLabelText("Your plan").textContent).toMatch(/2 of 7 steps/);
    expect(screen.getByRole("button", { name: "Walk me through it" }).className).toContain("is-primary");

    fireEvent.click(screen.getByRole("button", { name: "Help me choose a site" }));
    await screen.findByText(/What matters most for your mission\?/);

    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "What does P10 mean?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText(/planning for a bad day/);

    fireEvent.change(box, { target: { value: "write me a poem" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText(/Sorry, I didn't catch that/);
  });

  it("can be started on the walkthrough from the welcome bubble", async () => {
    await act(async () => setState({ assistantStart: "tour" }));
    render(<AssistantPanel />);
    await waitFor(() => expect(screen.getByLabelText(/Step 1 of 7: Choose a site/)).toBeTruthy(), { timeout: 3000 });
  });
});
