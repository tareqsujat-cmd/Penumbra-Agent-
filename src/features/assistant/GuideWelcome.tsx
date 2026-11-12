/** First-visit welcome: a small bubble by the Ask button offering a quick tour. Shown once per browser, only when the
 *  free built-in guide is active, never to automated test browsers, and it never blocks the app. */
import { useEffect, useState } from "react";
import { getState, setState, useApp } from "../../state/store";
import { assistantStatus } from "../../api/assistant";
import { GUIDE_NAME } from "./guide/util";
import { GuideAvatar } from "./GuideAvatar";

const KEY = "pn-guide-welcomed";

export function GuideWelcome() {
  const open = useApp((s) => s.assistantOpen);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 72, right: 16 });

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.webdriver) return; // automated browsers (tests)
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      return; // storage blocked: don't nag on every visit
    }
    let alive = true;
    const t = setTimeout(async () => {
      const st = await assistantStatus();
      if (!alive || st.available || getState().assistantOpen) return;
      const btn = document.querySelector(".pn-hdr__ask");
      if (btn) {
        const r = btn.getBoundingClientRect();
        setPos({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right) });
      }
      setShow(true);
    }, 1800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (open && show) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* not remembered */
    }
  }

  if (!show) return null;
  return (
    <div className="pn-welcome" role="dialog" aria-label={`${GUIDE_NAME}, your guide`} style={{ top: pos.top, right: pos.right }}>
      <div className="pn-welcome__head">
        <GuideAvatar size={32} />
        <div>
          <b>Hi, I'm {GUIDE_NAME}, your guide.</b>
          <p>New to Penumbra? I can show you around in about two minutes, in plain words. No space background needed.</p>
        </div>
      </div>
      <div className="pn-welcome__actions">
        <button
          className="ids-btn ids-btn--primary"
          onClick={() => {
            dismiss();
            setState({ assistantOpen: true, assistantStart: "tour" });
          }}
        >
          Show me around
        </button>
        <button className="ids-btn ids-btn--ghost" onClick={dismiss}>
          Maybe later
        </button>
      </div>
    </div>
  );
}
