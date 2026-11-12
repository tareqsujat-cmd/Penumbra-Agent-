import * as Popover from "@radix-ui/react-popover";
import { useLayoutEffect, useRef, useState } from "react";
import { getState, setState, useApp } from "../state/store";
import { useSite, useStrings } from "../hooks/useMission";
import { loadSite, siteListSync, siteLoaded } from "../api/client";
import { brightest } from "../utils/field";
import { Prov } from "../components/ui";
import { fmtDate } from "../utils/format";
import type { SiteId } from "../types";
import type { Mode } from "../state/store";
import { AssistantButton } from "../features/assistant/AssistantButton";


const LOAD_STAGES = ["Loading 5 m terrain and the performance grid…", "Computing Sun/Earth geometry…", "Evaluating the landing zone…"];

export async function selectSite(id: SiteId) {
  if (getState().siteId === id) return;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  setState({ siteLoading: LOAD_STAGES[0] });
  const pending = loadSite(id);
  for (const msg of LOAD_STAGES.slice(1)) {
    if (siteLoaded(id)) break;
    await wait(220);
    setState({ siteLoading: msg });
  }
  let s;
  try {
    s = await pending;
  } catch (e) {
    setState({ siteLoading: null, toast: `Site unavailable: ${(e as Error).message}` });
    return;
  }
  const b = brightest(s.field);
  setState({ siteId: id, siteLoading: null, aim: { x: b.x, y: b.y }, aimKind: "brightest", robust: { status: "idle", stage: 0, result: null, revealed: false }, heatMetric: "nominal" });
}

function SiteMenu() {
  const site = useSite();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="pn-hdr__picker" aria-label="Choose lunar site">
        <span className="pn-hdr__k">Site</span>
        <b>{site.name}</b>
        <span aria-hidden="true">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pn-menu" sideOffset={6} align="start">
          <div className="ids-overline pn-menu__title">Lunar south-pole sites</div>
          {siteListSync().map((s) => ({ id: s.id, name: s.name, meta: `${Math.abs(s.lat).toFixed(2)}°S ${s.lon.toFixed(2)}°E · PGDA 78 ${s.tile} 5 m` })).map((s) => (
            <button key={s.id} className={`pn-menu__item${s.id === site.id ? " is-on" : ""}`} onClick={() => { setOpen(false); selectSite(s.id); }}>
              <b>{s.name}</b>
              <small>{s.meta}</small>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The sections of the system, in story order. */
export const SECTIONS: { mode: Mode; n: string; label: string; hint: string }[] = [
  { mode: "globe", n: "01", label: "Explore", hint: "Fly around the Moon, inspect any place" },
  { mode: "planner", n: "02", label: "Mission", hint: "Plan a landing: uncertainty, robust aim, calendar, skyline" },
  { mode: "simple", n: "03", label: "Briefing", hint: "The plain-language summary for a site and date" },
  { mode: "compare", n: "04", label: "Compare", hint: "Rank two or more sites (or all five) by their worst likely sunlight" },
  { mode: "science", n: "05", label: "Science", hint: "Validation against NASA products and published studies" },
  { mode: "report", n: "06", label: "Research", hint: "The research report: problem, gaps, method, findings, references" },
  { mode: "about", n: "07", label: "System", hint: "How Penumbra works, its data and its limits" },
];

/** Switch section (Briefing always shows a landing zone, as a member of the public would expect). */
export function goTo(mode: Mode) {
  setState((s) => ({
    mode,
    view: mode === "planner" ? (s.view === "sky" ? "sky" : "map") : s.view,
    uncertainty: mode === "simple" ? { ...s.uncertainty, enabled: true, model: "circular" } : s.uncertainty,
  }));
}

function NavMenu({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="pn-nav__menu" aria-label="Sections">
        <span className="pn-nav__burger" aria-hidden="true" />
        <span>{SECTIONS.find((x) => x.mode === mode)?.label ?? "Menu"}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pn-menu pn-menu--nav" sideOffset={8} align="start">
          {SECTIONS.map((x) => (
            <button
              key={x.mode}
              className={`pn-menu__item${x.mode === mode ? " is-on" : ""}`}
              onClick={() => {
                setOpen(false);
                goTo(x.mode);
              }}
            >
              <b>
                <span className="pn-nav__n">{x.n}</span> {x.label}
              </b>
              <small>{x.hint}</small>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Header() {
  const { t } = useStrings();
  const mode = useApp((s) => s.mode);
  const landingIdx = useApp((s) => s.landingIdx);
  const loading = useApp((s) => s.siteLoading);
  const step = (dh: number) =>
    setState((s) => {
      const idx = Math.min(Math.max(s.landingIdx + dh, 13), (365 - s.windowDays) * 24 + 13);
      return { landingIdx: idx, cursorIdx: idx + Math.min(s.cursorIdx - s.landingIdx, s.windowDays * 24 - 1) };
    });
  const context = mode === "planner" || mode === "simple" || mode === "compare";
  // one underline that glides to the active section
  const navRef = useRef<HTMLElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>(".pn-nav__item.is-on");
      if (!el || !el.offsetWidth) return setInk(null);
      setInk({ x: el.offsetLeft + 12, w: el.offsetWidth - 24 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [mode, context]);
  return (
    <header className={`pn-hdr${mode === "globe" ? " pn-hdr--overlay" : ""}`}>
      <button className="pn-hdr__brand" onClick={() => goTo("globe")} title="Back to the Moon">
        <svg viewBox="0 0 32 32" className="pn-logo" aria-hidden="true">
          <circle cx="16" cy="16" r="14.5" className="pn-logo__corona" />
          <circle cx="16" cy="16" r="12" className="pn-logo__disc" />
          <path d="M16 4a12 12 0 0 1 0 24a8.4 12 0 0 0 0-24z" className="pn-logo__lit" />
        </svg>
        <div>
          <div className="pn-hdr__name">PENUMBRA</div>
          <div className="pn-hdr__tag">{t.tagline}</div>
        </div>
      </button>
      <nav className="pn-nav" aria-label="Sections" ref={navRef}>
        <span className="pn-nav__ink" aria-hidden="true" style={ink ? { transform: `translateX(${ink.x}px)`, width: ink.w } : { opacity: 0 }} />
        {SECTIONS.map((x) => (
          <button key={x.mode} className={`pn-nav__item${x.mode === mode ? " is-on" : ""}`} data-mode={x.mode} aria-current={x.mode === mode ? "page" : undefined} title={x.hint} onClick={() => goTo(x.mode)}>
            <span className="pn-nav__n">{x.n}</span>
            {x.label}
          </button>
        ))}
      </nav>
      <NavMenu mode={mode} />
      {context && (
        <div className="pn-hdr__controls" aria-label="Mission controls">
          <SiteMenu />
          <div className="pn-hdr__date">
            <span className="pn-hdr__k">{t.landingDate}</span>
            <div className="pn-hdr__stepper">
              <button className="pn-tool pn-tool--sm" onClick={() => step(-24)} aria-label="One day earlier">‹</button>
              <b className="ids-num">{fmtDate(landingIdx)}</b>
              <button className="pn-tool pn-tool--sm" onClick={() => step(24)} aria-label="One day later">›</button>
            </div>
          </div>
        </div>
      )}
      <div className="pn-hdr__status">
        {loading && <span className="ids-indicator" data-state="busy">Computing</span>}
        <AssistantButton />
        <button className="pn-hdr__data" onClick={() => setState({ dialog: "data" })} title="Data and provenance">
          <span className="ids-overline">{t.data}</span>
          <span className="pn-hdr__frame">MOON_ME · NASA/JPL</span>
          <Prov kind="verified" />
        </button>
        <button className="ids-btn pn-hdr__export" onClick={() => setState({ dialog: "export", progress: { ...getState().progress, export: true } })}>{t.export}</button>
      </div>
    </header>
  );
}
