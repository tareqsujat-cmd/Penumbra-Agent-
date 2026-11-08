import * as THREE from "three";
import { contours } from "d3";
import { cividis } from "../../utils/color";

/** Bilinear upsample of a field grid (rows by ascending y) to n×n, returned north-row-first. */
function upsample(grid: number[][], n: number): Float64Array {
  const ny = grid.length;
  const nx = grid[0].length;
  const out = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    const gy = ((n - 1 - r) / (n - 1)) * (ny - 1);
    const j = Math.min(Math.floor(gy), ny - 2);
    const ty = gy - j;
    for (let c = 0; c < n; c++) {
      const gx = (c / (n - 1)) * (nx - 1);
      const i = Math.min(Math.floor(gx), nx - 2);
      const tx = gx - i;
      out[r * n + c] = grid[j][i] * (1 - tx) * (1 - ty) + grid[j][i + 1] * tx * (1 - ty) + grid[j + 1][i] * (1 - tx) * ty + grid[j + 1][i + 1] * tx * ty;
    }
  }
  return out;
}

/** Cividis field with 10 % contour lines (every 20 % drawn heavier), as a texture for draping. */
export function heatTexture(grid: number[][], opts: { size?: number; tint?: string } = {}): THREE.CanvasTexture {
  const size = opts.size ?? 512;
  const n = 160;
  const vals = upsample(grid, n);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const small = document.createElement("canvas");
  small.width = small.height = n;
  const sg = small.getContext("2d")!;
  const img = sg.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    // NaN = not evaluated (e.g. robust-score cells whose landing zone would leave the grid): transparent
    if (!Number.isFinite(vals[k])) continue;
    const [r, gg, b] = cividis(vals[k] / 100);
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = gg;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(small, 0, 0, size, size);
  const levels = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const cs = contours().size([n, n]).thresholds(levels)(Array.from(vals, (v) => (Number.isFinite(v) ? v : -1)));
  const k = size / (n - 1);
  for (const poly of cs) {
    g.beginPath();
    for (const ring of poly.coordinates.flat()) {
      ring.forEach(([x, y], i) => (i ? g.lineTo((x - 0.5) * k, (y - 0.5) * k) : g.moveTo((x - 0.5) * k, (y - 0.5) * k)));
    }
    g.lineWidth = poly.value % 20 === 0 ? 2.4 : 1.1;
    g.strokeStyle = poly.value % 20 === 0 ? "rgba(6,8,12,0.75)" : "rgba(6,8,12,0.45)";
    g.stroke();
  }
  g.lineWidth = 3;
  g.strokeStyle = opts.tint ?? "rgba(255,255,255,0.28)";
  g.strokeRect(1.5, 1.5, size - 3, size - 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Slope (deg) overlay: transparent below 5°, orange ramp above. */
export function slopeTexture(png: string, maxDeg: number): Promise<THREE.CanvasTexture> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = im.height;
      const g = c.getContext("2d")!;
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let k = 0; k < d.data.length; k += 4) {
        const s = (d.data[k] / 255) * maxDeg;
        const a = Math.min(1, Math.max(0, (s - 5) / 20));
        d.data[k] = 230;
        d.data[k + 1] = 110;
        d.data[k + 2] = 20;
        d.data[k + 3] = a * 235;
      }
      g.putImageData(d, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      resolve(t);
    };
    im.src = png;
  });
}
