/** cividis (matplotlib, sampled at i/8) — perceptually uniform and colour-vision-deficiency safe. */
const CIVIDIS = ["#00224e", "#1a386f", "#434e6c", "#61656f", "#7d7c78", "#9b9476", "#bcae6c", "#dec958", "#fee838"].map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

export function cividis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (CIVIDIS.length - 1);
  const i = Math.min(Math.floor(x), CIVIDIS.length - 2);
  const f = x - i;
  const a = CIVIDIS[i];
  const b = CIVIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function cividisCss(t: number): string {
  const [r, g, b] = cividis(t);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Grid (rows by ascending y) → canvas; image row 0 is the northern edge. */
export function gridToCanvas(grid: number[][], lo = 0, hi = 100): HTMLCanvasElement {
  const ny = grid.length;
  const nx = grid[0].length;
  const c = document.createElement("canvas");
  c.width = nx;
  c.height = ny;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [r, g, b] = cividis((grid[ny - 1 - j][i] - lo) / (hi - lo));
      const k = (j * nx + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/** Decode the 16-bit height PNG (R = high byte, G = low byte) into metres. */
export async function decodeHeights(src: string, hmin: number, hmax: number): Promise<{ h: Float32Array; n: number }> {
  const im = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, im.width, im.height).data;
  const n = im.width;
  const h = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) h[k] = hmin + ((d[k * 4] * 256 + d[k * 4 + 1]) / 65535) * (hmax - hmin);
  return { h, n };
}

/**
 * Shaded relief lit from azimuth `azDeg` (clockwise from grid north) at elevation `elDeg`.
 * Only the lighting direction follows the real Sun; the elevation is raised for legibility.
 */
export function hillshade(h: Float32Array, n: number, res: number, azDeg: number, elDeg: number, target: HTMLCanvasElement): void {
  target.width = n;
  target.height = n;
  const ctx = target.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(el);
  const ly = Math.cos(az) * Math.cos(el);
  const lz = Math.sin(el);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const cl = Math.max(c - 1, 0);
      const cr = Math.min(c + 1, n - 1);
      const ru = Math.max(r - 1, 0);
      const rd = Math.min(r + 1, n - 1);
      const dzdx = (h[r * n + cr] - h[r * n + cl]) / ((cr - cl) * res);
      const dzdy = (h[ru * n + c] - h[rd * n + c]) / ((rd - ru) * res);
      const nl = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / nl);
      const v = 18 + 210 * Math.pow(shade, 0.8);
      const k = (r * n + c) * 4;
      img.data[k] = v * 0.96;
      img.data[k + 1] = v * 0.98;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}
