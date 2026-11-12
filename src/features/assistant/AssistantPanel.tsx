/** The Penumbra assistant panel. Two modes:
 *  - built-in guide (default; no AI, free, offline): greets you, walks you through planning step by step, explains
 *    each choice in plain words as you make it, explains anything you point at, answers common questions, helps you
 *    choose, and makes changes for you (with Undo);
 *  - AI assistant (when the server has a Claude API key): free-form chat with the same change cards. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getState, setState, subscribe, useApp, type AppState, type Mode } from "../../state/store";
import { useRisk, useVisibility } from "../../hooks/useMission";
import { api, ApiError, enduranceByDay, siteSync } from "../../api/client";
import { askAssistant, assistantStatus, type AssistantStatus, type ChatTurn } from "../../api/assistant";
import { buildParams, buildSnapshot, clearLiveMetrics, getLiveMetrics, setLiveMetrics } from "./snapshot";
import { activityFor, greeting, matchIntent, menuChips, nextStepIndex, respond, TOUR_STEPS, tourStep, type Chip, type GuideReply, type Intent } from "./guide/engine";
import { reaction } from "./guide/nlu";
import { spotlight, type SpotId } from "./guide/spotlight";
import { detectEvents, explainEvents, needsFreshNumbers, nudge, type GuideEvent } from "./guide/watch";
import { startWhatsThis } from "./guide/whatsthis";
import { TERM_LINKS, type TermId } from "./guide/content";
import { GUIDE_NAME, P, riskReady, SITE_NAMES, siteName, visReady, type GuideCtx } from "./guide/util";
import { Markdown } from "./Markdown";
import { GuideAvatar } from "./GuideAvatar";
import { fmtDate } from "../../utils/format";
import type { SiteId, Vehicle, XY } from "../../types";
import { applyProposal, captureUndo, restoreUndo } from "./applyProposal";
import { toHistory, type HistoryMsg, type ProposalState } from "./history";

interface Msg extends HistoryMsg {
  notice?: string;
  /** built-in guide: follow-up buttons */
  chips?: Chip[];
  spot?: SpotId;
  progress?: GuideReply["progress"];
  proactive?: boolean;
  /** what is being worked out right now */
  activity?: string;
  /** analyses run for this reply (AI assistant) */
  tools?: string[];
}

const SUGGESTIONS: Record<Mode, string[]> = {
  globe: ["What can I do on this screen?", "How do I start planning a landing?", "Which south-pole site should I look at first?"],
  planner: ["Explain my current results in plain language", "What should I do next?", "Which robustness level should I choose?"],
  simple: ["Explain this briefing in plain language", "What does “sunlight in 9 of 10 touchdowns” mean?", "Is this a good landing date?"],
  compare: ["How do I read this ranking?", "Which site is best for staying in contact with Earth?", "Why can the ranking change with the date?"],
  science: ["How was Penumbra validated?", "How accurate are the sunlight numbers?"],
  report: ["Summarise what Penumbra found", "What problem does Penumbra solve?"],
  about: ["How does Penumbra work?", "What are Penumbra's limitations?"],
};

const TIPS_KEY = "pn-guide-tips";
const MAX_MSGS = 80;
const NEEDS_NUMBERS = new Set<Intent["kind"]>(["explain", "choices", "choice"]);
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

/** Keeps the latest mission numbers for the guide (same requests as the visible views, so they are cache hits). */
function LiveMetricsProbe() {
  const risk = useRisk();
  const vis = useVisibility();
  useEffect(() => {
    const first = vis.sunFrac.slice(0, 72);
    const early72 = first.length ? (100 * first.reduce((a, b) => a + b, 0)) / first.length : undefined;
    setLiveMetrics({ risk, vis: { summary: vis.summary, loading: vis.loading, early72 } });
  }, [risk, vis.summary, vis.loading, vis.sunFrac]);
  useEffect(() => clearLiveMetrics, []);
  return null;
}

function currentSite() {
  try {
    return siteSync(getState().siteId);
  } catch {
    return null; // site bundle not loaded yet
  }
}

const ctx = (): GuideCtx => ({ s: getState(), site: currentSite(), m: getLiveMetrics() });

/** The backend calls the built-in guide may make: the views' own API client. */
const guideApi = { ...api, endurance: (site: SiteId, aim: XY, vehicle: Vehicle, windowDays: number) => enduranceByDay(site, aim, vehicle, windowDays) };

const GUIDE_FALLBACK =
  "Sorry, I didn't catch that. I understand questions and requests about Penumbra, such as “switch to Shackleton”, “what if I land on 15 July?”, “what does P10 mean?” or “show me the calendar”. You can also tap **What's this?** and point at anything. Or pick one of these:";

function readTips(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Wait (up to a few seconds) for the mission card's numbers, so explanations use fresh values. */
async function waitForNumbers(ms = 6000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const s = getState();
    const m = getLiveMetrics();
    const needVis = s.mode === "planner" || s.mode === "simple";
    if (riskReady(m) && (!needVis || visReady(m))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function dedupe(events: GuideEvent[]): GuideEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = e.kind === "choice" ? `choice:${e.id}` : e.kind === "section" ? "section" : e.kind;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Text to read aloud: the message without formatting marks. */
function speakable(m: Msg): string {
  const cards = (m.proposals ?? []).map((p) => `I can do this for you: ${p.summary}.`).join(" ");
  return `${m.content} ${cards}`.replace(/\*\*|__|[_*`]/g, "").replace(/^[-•]\s+/gm, "").replace(/±/g, "plus or minus ").replace(/\s+/g, " ").trim();
}

export function AssistantPanel() {
  const open = useApp((s) => s.assistantOpen);
  const start = useApp((s) => s.assistantStart);
  const mode = useApp((s) => s.mode);
  const globeSite = useApp((s) => s.globeSite);
  useApp((s) => s.siteId); // re-render the greeting when the site changes
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState(readTips);
  const [tour, setTour] = useState<{ step: number; start: AppState } | null>(null);
  const [pointing, setPointing] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const tourRef = useRef(tour);
  tourRef.current = tour;
  const tipsRef = useRef(tips);
  tipsRef.current = tips;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const muteUntil = useRef(0); // ignore app changes made by Undo
  const stopPointing = useRef<(() => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!status || !status.available) assistantStatus().then(setStatus);
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !pointing && !document.querySelector("[role=dialog][data-state=open]")) setState({ assistantOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pointing]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(
    () => () => {
      abort.current?.abort();
      stopPointing.current?.();
      if (canSpeak) window.speechSynthesis.cancel();
    },
    [],
  );

  // the AI assistant when the server has a Claude API key; otherwise the free built-in guide (no AI, works offline)
  const guideMode = status !== null && !status.available;

  // started from the welcome bubble ("Show me around")
  useEffect(() => {
    if (open && guideMode && start === "tour") {
      setState({ assistantStart: null });
      ask({ kind: "tour", step: 0 }, "Show me around");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guideMode, start]);

  // ------------------------------------------------------------------ built-in guide
  /** Add the guide's reply; a new proactive tip replaces an untouched previous one instead of piling up. */
  function post(r: GuideReply, replaceLast = false) {
    const msg: Msg = {
      role: "assistant",
      content: r.text,
      chips: r.chips,
      spot: r.spot,
      progress: r.progress,
      proactive: r.proactive,
      proposals: r.proposals?.map((p) => ({ ...p, status: "pending" as const })),
    };
    setMsgs((all) => {
      const last = all[all.length - 1];
      const untouched = last?.proactive && !last.proposals?.some((p) => p.status !== "pending");
      const base = replaceLast || (r.proactive && untouched) ? all.slice(0, -1) : all;
      return [...base, msg].slice(-MAX_MSGS);
    });
    if (r.tour !== undefined) setTour(r.tour === null ? null : { step: r.tour, start: getState() });
    // point at the control for each walkthrough step (not on phones, where the panel covers the screen)
    if (r.progress && r.spot && window.innerWidth > 640) setTimeout(() => spotlight(r.spot!), 350);
  }

  async function showSpot(id: SpotId) {
    const found = await spotlight(id);
    if (!found) post({ text: "I couldn't find that on this screen. It may only appear in **02 Mission**." });
  }

  function startPointing() {
    if (pointing) {
      stopPointing.current?.();
      setPointing(false);
      return;
    }
    setPointing(true);
    const phone = window.innerWidth <= 640;
    if (phone) setState({ assistantOpen: false }); // get out of the way so the screen can be tapped
    stopPointing.current = startWhatsThis(
      ctx,
      (r) => {
        setPointing(false);
        stopPointing.current = null;
        if (phone) setState({ assistantOpen: true });
        post(r ?? { text: "I don't have an explanation for that part yet. Try a number on the right, the calendar, the map, or a button at the top.", chips: [{ label: "Try again", intent: { kind: "whatsthis" }, primary: true }] });
      },
      () => {
        setPointing(false);
        stopPointing.current = null;
        if (phone) setState({ assistantOpen: true });
      },
    );
  }

  async function ask(intent: Intent, label: string) {
    if (busyRef.current) return;
    if (intent.kind === "spot") return showSpot(intent.id);
    if (intent.kind === "whatsthis") {
      setMsgs((m) => [...m, { role: "user", content: label } as Msg]);
      post({ text: "Tap anything on the screen (a number, the calendar, the map, a button) and I'll explain it. Press Esc to cancel." });
      startPointing();
      return;
    }
    const activity = activityFor(intent);
    setMsgs((m) => [...m, { role: "user", content: label } as Msg, { role: "assistant", content: "", pending: true, activity } as Msg].slice(-MAX_MSGS));
    setInput("");
    setBusy(true);
    try {
      if (NEEDS_NUMBERS.has(intent.kind) && (getState().mode === "planner" || getState().mode === "simple")) await waitForNumbers(5000);
      else if (!activity) await new Promise((r) => setTimeout(r, 250)); // a short pause reads more naturally than an instant wall of text
      const r = await respond(intent, ctx(), guideApi);
      post(r, true);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "something went wrong on my side";
      setMsgs((all) => [
        ...all.slice(0, -1),
        { role: "assistant", content: `Sorry, I couldn't work that out (${msg}). Let's try something else.`, chips: [{ label: "Try again", intent, primary: true }, { label: "Other topics", intent: { kind: "menu" } }] },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function lastAssistantMsg(): Msg | undefined {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i];
    return undefined;
  }

  /** Short replies ("yes", "no", "show me", "next", "more", "thanks") act on the guide's last message. */
  function handleReaction(q: string): boolean {
    const r = reaction(q);
    if (!r) return false;
    const last = lastAssistantMsg();
    const pendingCard = last?.proposals?.find((p) => p.status === "pending" || p.status === "failed");
    const primary = last?.chips?.find((c) => c.primary);
    const say = (text: string, chips?: Chip[]) => {
      setMsgs((m) => [...m, { role: "user", content: q } as Msg]);
      post({ text, chips });
    };
    setInput("");
    if (r === "affirm") {
      if (pendingCard) {
        setMsgs((m) => [...m, { role: "user", content: q } as Msg]);
        apply(pendingCard);
        return true;
      }
      if (primary) {
        ask(primary.intent, q);
        return true;
      }
      say("Great. What would you like to do next?", menuChips(getState()));
      return true;
    }
    if (r === "deny") {
      if (pendingCard) setProposal(pendingCard.id, { status: "dismissed" });
      if (tourRef.current) {
        ask({ kind: "tour", step: tourRef.current.step + 1 }, q);
        return true;
      }
      say("No problem. Anything else?", menuChips(getState()).slice(0, 5));
      return true;
    }
    if (r === "showme") {
      setMsgs((m) => [...m, { role: "user", content: q } as Msg]);
      if (last?.spot) showSpot(last.spot);
      else post({ text: "Show you what? For example: “show me the calendar” or “where is the landing date?”. Or tap **What's this?** and point at something." });
      return true;
    }
    if (r === "more") {
      const more = last?.chips?.find((c) => c.intent.kind === "more");
      if (more) ask(more.intent, q);
      else say("Happy to go deeper. Which part? For example: “explain the landing date” or “what does P10 mean?”.", [{ label: "Explain my choices", intent: { kind: "choices" }, primary: true }]);
      return true;
    }
    if (r === "next") {
      ask(tourRef.current ? { kind: "tour", step: tourRef.current.step + 1 } : { kind: "next" }, q);
      return true;
    }
    ask(r === "thanks" ? { kind: "thanks" } : { kind: "greet" }, q);
    return true;
  }

  // Proactive guidance: explain each change the person makes, and move the walkthrough on when a step is done.
  useEffect(() => {
    if (!open || !guideMode) return;
    let prev = getState();
    let pending: GuideEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const flush = async () => {
      const events = dedupe(pending);
      pending = [];
      if (!events.length) return;
      if (events.some(needsFreshNumbers)) await waitForNumbers();
      if (!alive) return;
      const c = ctx();
      const t = tourRef.current;
      if (t && t.step < TOUR_STEPS.length && TOUR_STEPS[t.step].done(t.start, c.s)) {
        const said = explainEvents(events, c);
        post(tourStep(t.step + 1, c, `✓ **Step ${t.step + 1} done.**${said ? ` ${said}` : ""}\n\n`));
        return;
      }
      if (!tipsRef.current || busyRef.current) return;
      const n = nudge(events, c);
      if (n) post(n);
    };
    const unsub = subscribe(() => {
      const cur = getState();
      const ev = detectEvents(prev, cur);
      prev = cur;
      if (!ev.length || Date.now() < muteUntil.current) return;
      pending.push(...ev);
      clearTimeout(timer);
      timer = setTimeout(flush, 900); // wait until the person stops dragging/clicking
    });
    return () => {
      alive = false;
      unsub();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guideMode]);

  function toggleTips() {
    const v = !tips;
    setTips(v);
    try {
      localStorage.setItem(TIPS_KEY, v ? "on" : "off");
    } catch {
      /* private mode: not remembered */
    }
  }

  function speak(i: number) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    if (speaking === i) return setSpeaking(null);
    const u = new SpeechSynthesisUtterance(speakable(msgs[i]));
    u.lang = "en-GB";
    u.rate = 0.98;
    u.onend = () => setSpeaking((cur) => (cur === i ? null : cur));
    setSpeaking(i);
    window.speechSynthesis.speak(u);
  }

  function onTerm(id: string, word: string) {
    if (guideMode) ask({ kind: "term", id: id as TermId }, `What does “${word}” mean?`);
    else send(`What does “${word}” mean?`);
  }

  // ------------------------------------------------------------------ both modes
  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !status) return;
    if (guideMode) {
      if (handleReaction(q)) return;
      const intent = matchIntent(q);
      if (intent) return ask(intent, q);
      setMsgs((m) => [...m, { role: "user", content: q } as Msg]);
      post({ text: GUIDE_FALLBACK, chips: menuChips(getState()) });
      setInput("");
      return;
    }
    const history: ChatTurn[] = [...toHistory(msgs), { role: "user", content: q }];
    setMsgs((m) => [...m, { role: "user", content: q } as Msg, { role: "assistant", content: "", pending: true } as Msg]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchLast = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])]);
    try {
      await askAssistant(
        history,
        buildSnapshot(getState(), currentSite()),
        buildParams(getState()),
        (e) => {
          if (e.type === "text") patchLast((m) => ({ ...m, content: m.content + e.text, activity: undefined }));
          else if (e.type === "tool")
            patchLast((m) => ({ ...m, activity: `${e.label}…`, tools: m.tools?.includes(e.label) ? m.tools : [...(m.tools ?? []), e.label] }));
          else if (e.type === "proposal") {
            const { type: _t, ...p } = e;
            patchLast((m) => ({ ...m, proposals: [...(m.proposals ?? []), { ...p, status: "pending" }] }));
          } else if (e.type === "notice") patchLast((m) => ({ ...m, notice: e.text }));
          else if (e.type === "error") patchLast((m) => ({ ...m, error: e.message, pending: false }));
          else patchLast((m) => ({ ...m, pending: false }));
        },
        ctrl.signal,
      );
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      patchLast((m) => ({ ...m, pending: false, ...(stopped ? { notice: "Stopped." } : { error: "Could not reach the Penumbra server." }) }));
    } finally {
      patchLast((m) => ({ ...m, pending: false, activity: undefined }));
      setBusy(false);
      abort.current = null;
    }
  }

  function setProposal(id: string, patch: Partial<ProposalState>) {
    setMsgs((all) => all.map((m) => (m.proposals?.some((p) => p.id === id) ? { ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : m)));
  }

  async function apply(p: ProposalState) {
    setProposal(p.id, { status: "applying", error: undefined });
    const undo = captureUndo();
    try {
      await applyProposal(p.changes);
      setProposal(p.id, { status: "applied", undo });
    } catch (e) {
      setProposal(p.id, { status: "failed", error: (e as Error).message || String(e) });
    }
  }

  async function undo(p: ProposalState) {
    if (!p.undo) return;
    muteUntil.current = Date.now() + 2500;
    try {
      await restoreUndo(p.undo);
      setProposal(p.id, { status: "undone" });
      post({ text: "Undone. Everything is back the way it was." });
    } catch (e) {
      post({ text: `Sorry, I couldn't undo that: ${(e as Error).message}` });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  function newChat() {
    abort.current?.abort();
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeaking(null);
    setMsgs([]);
    setTour(null);
  }

  if (!open) return null;
  const probe = mode === "planner" || mode === "simple" || (mode === "globe" && globeSite);
  const lastIdx = msgs.length - 1;
  const hello = guideMode && msgs.length === 0 ? greeting(getState(), siteName(ctx())) : null;
  const chipRow = (chips: Chip[], label: string) => (
    <div className="pn-asst__chips" role="group" aria-label={label}>
      {chips.map((c) => (
        <button key={c.label} className={`pn-asst__chip${c.primary ? " is-primary" : ""}${c.intent.kind === "spot" ? " is-spot" : ""}`} onClick={() => ask(c.intent, c.label)}>
          {c.intent.kind === "spot" && <span className="pn-asst__chip-icon" aria-hidden="true">◎</span>}
          {c.label}
        </button>
      ))}
    </div>
  );
  const terms = guideMode ? TERM_LINKS : undefined;
  return (
    <aside id="pn-assistant" className={`pn-asst${pointing ? " is-pointing" : ""}`} role="complementary" aria-label={guideMode ? `${GUIDE_NAME}, your Penumbra guide` : "Penumbra assistant"}>
      {probe && <LiveMetricsProbe />}
      <header className="pn-asst__head">
        <div className="pn-asst__who">
          {guideMode && <GuideAvatar size={34} />}
          <div>
            <div className="ids-overline">{guideMode ? "Your guide" : "AI assistant"}</div>
            <h2 className="pn-asst__title">{guideMode ? GUIDE_NAME : "Ask Penumbra"}</h2>
          </div>
        </div>
        <div className="pn-asst__tools">
          {guideMode && (
            <button className={`ids-btn ids-btn--ghost pn-asst__what${pointing ? " is-on" : ""}`} onClick={startPointing} aria-pressed={pointing} title="Tap this, then tap anything on the screen, and I'll explain it">
              {pointing ? "Cancel" : "What's this?"}
            </button>
          )}
          {guideMode && (
            <button className={`ids-btn ids-btn--ghost pn-asst__tips${tips ? " is-on" : ""}`} onClick={toggleTips} aria-pressed={tips} title="When on, I explain each change you make in plain words and suggest the next step">
              Tips {tips ? "on" : "off"}
            </button>
          )}
          {msgs.length > 0 && (
            <button className="ids-btn ids-btn--ghost" onClick={newChat} title="Start a new conversation">
              New chat
            </button>
          )}
          <button className="ids-btn ids-btn--ghost pn-icon-btn" onClick={() => setState({ assistantOpen: false })} aria-label="Close assistant">✕</button>
        </div>
      </header>

      {guideMode && <PlanStrip onStep={(i) => ask({ kind: "tour", step: i }, TOUR_STEPS[i].title)} onContinue={() => ask({ kind: "tour", step: nextStepIndex(getState()) ?? TOUR_STEPS.length }, "Continue")} busy={busy} />}

      {pointing && <div className="pn-asst__pointing" role="status">Tap anything on the screen and I'll explain it. Press Esc to cancel.</div>}

      <div className="pn-asst__log" ref={logRef} aria-live="polite">
        {hello && (
          <div className="pn-asst__msg is-assistant">
            <Markdown text={hello.text} />
            {chipRow(hello.chips ?? [], "Ways I can help")}
          </div>
        )}
        {msgs.length === 0 && !guideMode && (
          <div className="pn-asst__intro">
            <p>I can show you how to use Penumbra, help you choose a site, date or landing settings, and explain what your results mean.</p>
            <p className="pn-asst__muted">I see the screen you are on and the numbers already computed, so you can ask about them directly.</p>
            {status?.available && (
              <div className="pn-asst__chips" role="group" aria-label="Suggested questions">
                {SUGGESTIONS[mode].map((s) => (
                  <button key={s} className="pn-asst__chip" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`pn-asst__msg is-${m.role}${m.proactive ? " is-tip" : ""}`}>
            {m.role === "user" ? (
              <p>{m.content}</p>
            ) : (
              <>
                {m.progress && <TourProgress {...m.progress} />}
                {m.proactive && !m.progress && <div className="pn-asst__tip-tag">Tip</div>}
                {m.content && <Markdown text={m.content} terms={terms} onTerm={onTerm} />}
                {m.pending && (
                  <p className="pn-asst__typing" aria-label={m.activity ?? "Typing"}>
                    <span className="pn-asst__dots"><i /><i /><i /></span>
                    {m.activity && <span>{m.activity}</span>}
                  </p>
                )}
                {!m.pending && m.tools && m.tools.length > 0 && (
                  <p className="pn-asst__used" title="These results were computed by Penumbra's backend for this answer">
                    Computed: {m.tools.join(" · ")}
                  </p>
                )}
                {m.proposals?.map((p) => (
                  <ProposalCard key={p.id} p={p} guide={guideMode} onApply={() => apply(p)} onDismiss={() => setProposal(p.id, { status: "dismissed" })} onUndo={() => undo(p)} />
                ))}
                {m.notice && <p className="pn-asst__notice">{m.notice}</p>}
                {m.error && <p className="pn-asst__error" role="alert">{m.error}</p>}
                {!m.pending && canSpeak && m.content && (
                  <button className={`pn-asst__speak${speaking === i ? " is-on" : ""}`} onClick={() => speak(i)} aria-pressed={speaking === i}>
                    {speaking === i ? "■ Stop reading" : "▶ Read aloud"}
                  </button>
                )}
                {i === lastIdx && !busy && m.chips && m.chips.length > 0 && chipRow(m.chips, "Follow-up options")}
              </>
            )}
          </div>
        ))}
      </div>

      <form className="pn-asst__form" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          className="pn-input pn-asst__input"
          rows={2}
          placeholder={guideMode ? "Ask me anything about the app, e.g. “what if I land on 15 July?”" : "Ask about the app, a choice, or your results…"}
          value={input}
          maxLength={4000}
          disabled={!status}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Your question"
        />
        {busy && !guideMode ? (
          <button type="button" className="ids-btn" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button type="submit" className="ids-btn ids-btn--primary" disabled={!input.trim() || !status || busy}>Send</button>
        )}
      </form>
      <p className="pn-asst__foot" title={guideMode ? `AI assistant off: ${status?.reason}` : undefined}>
        {guideMode
          ? "Free built-in guide: works offline, no AI. Every number comes from Penumbra's own calculations."
          : "Answers come from Claude using the values on your screen. Check important numbers in the app."}
      </p>
    </aside>
  );
}

/** "Your plan" in one line, with the seven steps as dots and a Continue button. */
function PlanStrip({ onStep, onContinue, busy }: { onStep: (i: number) => void; onContinue: () => void; busy: boolean }) {
  const s = useApp((x) => x);
  const steps = TOUR_STEPS.map((d, i) => ({ title: d.title, done: i < 2 ? true : d.done(s, s) }));
  const done = steps.filter((x) => x.done).length;
  const next = nextStepIndex(s);
  const acc = s.uncertainty.enabled ? (s.uncertainty.model === "circular" ? `±${s.uncertainty.radius} m` : "oval zone") : "accuracy not set";
  return (
    <div className="pn-plan" aria-label="Your plan">
      <div className="pn-plan__line">
        <span className="ids-overline">Your plan</span>
        <span className="pn-plan__what">
          {SITE_NAMES[s.siteId]} · {fmtDate(s.landingIdx, false)} · {acc} · {P(s.percentile)}
        </span>
      </div>
      <div className="pn-plan__row">
        <ol className="pn-plan__dots">
          {steps.map((x, i) => (
            <li key={x.title}>
              <button className={`${x.done ? "is-done" : ""}${i === next ? " is-next" : ""}`} onClick={() => onStep(i)} disabled={busy} title={`${i + 1}. ${x.title}${x.done ? " (done)" : ""}`} aria-label={`Step ${i + 1}: ${x.title}${x.done ? ", done" : ""}`} />
            </li>
          ))}
        </ol>
        <span className="pn-plan__count">
          {done} of {steps.length} steps
        </span>
        <button className="ids-btn ids-btn--primary pn-plan__go" onClick={onContinue} disabled={busy}>
          {next === null ? "All done ✓" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function TourProgress({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="pn-asst__progress" aria-label={`Step ${step} of ${total}: ${title}`}>
      <div className="pn-asst__progress-head">
        <span className="ids-overline">Step {step} of {total}</span>
        <b>{title}</b>
      </div>
      <div className="pn-asst__progress-bar" aria-hidden="true">
        {Array.from({ length: total }, (_, k) => (
          <i key={k} className={k < step - 1 ? "is-done" : k === step - 1 ? "is-now" : ""} />
        ))}
      </div>
    </div>
  );
}

/** A change the assistant proposes; nothing happens until the person clicks, and it can be undone. */
function ProposalCard({ p, guide, onApply, onDismiss, onUndo }: { p: ProposalState; guide: boolean; onApply: () => void; onDismiss: () => void; onUndo: () => void }) {
  const done = p.status === "applied" || p.status === "dismissed" || p.status === "undone";
  const go = guide ? "Do it for me" : "Apply";
  return (
    <section className={`pn-asst__card is-${p.status}`} aria-label={`Proposed change: ${p.summary}`}>
      <div className="pn-asst__card-head">
        <span className="ids-overline">{guide ? "I can do this for you" : "Proposed change"}</span>
        {p.status === "applied" && <span className="pn-asst__badge is-ok">Done ✓</span>}
        {p.status === "dismissed" && <span className="pn-asst__badge">Skipped</span>}
        {p.status === "undone" && <span className="pn-asst__badge">Undone</span>}
      </div>
      <b className="pn-asst__card-title">{p.summary}</b>
      <ul className="pn-asst__card-lines">
        {p.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {p.status === "failed" && (
        <p className="pn-asst__error" role="alert">
          Could not apply: {p.error}
        </p>
      )}
      {!done && (
        <div className="pn-asst__card-actions">
          <button className="ids-btn ids-btn--primary" onClick={onApply} disabled={p.status === "applying"}>
            {p.status === "applying" ? "Working…" : p.status === "failed" ? "Try again" : go}
          </button>
          <button className="ids-btn ids-btn--ghost" onClick={onDismiss} disabled={p.status === "applying"}>
            {guide ? "No thanks" : "Dismiss"}
          </button>
        </div>
      )}
      {p.status === "applied" && p.undo && (
        <div className="pn-asst__card-actions">
          <button className="ids-btn ids-btn--ghost pn-asst__undo" onClick={onUndo}>
            ↶ Undo
          </button>
        </div>
      )}
    </section>
  );
}
