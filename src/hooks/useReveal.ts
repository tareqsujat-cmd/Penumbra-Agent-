/** Motion helpers: reveal-on-scroll and scroll-linked progress, both no-ops when the user prefers reduced motion. */
import { useEffect, type RefObject } from "react";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Adds `is-in` to every `[data-reveal]` element inside `root` as it scrolls into view (once). `deps` re-scan
 *  after content changes (e.g. data arriving). */
export function useReveal(root: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    if (reduced() || typeof IntersectionObserver === "undefined") {
      items.forEach((i) => i.classList.add("is-in"));
      return;
    }
    const scroller = el.closest(".pn-page") as HTMLElement | null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
      },
      { root: scroller, rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Writes the scroll progress (0 → 1 over `distance` px) of the nearest `.pn-page` into `--scroll` on `target`. */
export function useScrollProgress(target: RefObject<HTMLElement | null>, distance = 480) {
  useEffect(() => {
    const el = target.current;
    const scroller = el?.closest(".pn-page") as HTMLElement | null;
    if (!el || !scroller || reduced()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      el.style.setProperty("--scroll", Math.min(1, scroller.scrollTop / distance).toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [target, distance]);
}
