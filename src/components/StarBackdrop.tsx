/** Page backdrop: the real sky toward which the lunar south pole points (RA ≈ 90°, Dec ≈ −66.5°, near Dorado and
 *  the Large Magellanic Cloud), drawn from the Yale Bright Star Catalogue in a stereographic projection. It turns very
 *  slowly about the pole, as the sky does over the Moon. */
import { useEffect, useRef } from "react";
import { bvToRgb, loadSky } from "../features/sky/stars";

const CENTER_RA = 90.0;
const CENTER_DEC = -66.54;
const D2R = Math.PI / 180;

function project(ra: number, dec: number, scale: number, cx: number, cy: number): [number, number, number] {
  // stereographic projection centred on (CENTER_RA, CENTER_DEC); returns [x, y, cos(angular distance)]
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = CENTER_RA * D2R;
  const d0 = CENTER_DEC * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const k = 2 / (1 + cosc);
  const x = k * Math.cos(d) * Math.sin(a - a0);
  const y = k * (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0));
  return [cx - x * scale, cy - y * scale, cosc];
}

export function StarBackdrop({ dim = 1 }: { dim?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const canvas = ref.current!;
    const draw = async () => {
      const sky = await loadSky();
      if (!alive || !sky) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const side = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)); // covers the screen while turning
      canvas.width = side * dpr;
      canvas.height = side * dpr;
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, side, side);
      const c = side / 2;
      const scale = side * 0.42; // about 110° across the diagonal
      // stars, faintest first so bright ones sit on top
      for (let i = sky.count - 1; i >= 0; i--) {
        const [x, y, cosc] = project(sky.ra[i], sky.dec[i], scale, c, c);
        if (cosc < 0 || x < -10 || y < -10 || x > side + 10 || y > side + 10) continue;
        const m = sky.vmag[i];
        const f = Math.pow(10, -0.4 * (m - 6.5));
        const r = Math.min(2.6, 0.45 + 0.34 * Math.log2(1 + f));
        const a = Math.min(1, (0.28 + 0.14 * Math.log2(1 + f)) * dim);
        const [cr, cg, cb] = bvToRgb(sky.bv[i]);
        g.fillStyle = `rgba(${(cr * 255) | 0}, ${(cg * 255) | 0}, ${(cb * 255) | 0}, ${a})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        if (m < 1.6) {
          // brightest stars get a faint halo (camera-like, not twinkle: there is no air on the Moon)
          const h = g.createRadialGradient(x, y, 0, x, y, r * 7);
          h.addColorStop(0, `rgba(${(cr * 255) | 0}, ${(cg * 255) | 0}, ${(cb * 255) | 0}, ${0.22 * dim})`);
          h.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = h;
          g.beginPath();
          g.arc(x, y, r * 7, 0, Math.PI * 2);
          g.fill();
        }
      }
      canvas.classList.add("is-ready");
    };
    draw();
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(draw, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
    };
  }, [dim]);
  return (
    <div className="pn-stars" aria-hidden="true">
      <canvas ref={ref} className="pn-stars__canvas" />
      <div className="pn-stars__vignette" />
    </div>
  );
}
