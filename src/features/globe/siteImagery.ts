/** Polar photo + relief imagery for the landing-site terrain (tiles/site/, built by scripts/prepare_site_images.py). */
import { useEffect, useState } from "react";
import * as THREE from "three";
import type { TileManifest } from "./tiles/MoonTiles";
import type { HeightGrid } from "../terrain3d/grids";

export type Box = [number, number, number, number];

let manifest: Promise<TileManifest | null> | null = null;
export function tileManifest(): Promise<TileManifest | null> {
  if (!manifest)
    manifest = fetch("./tiles/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<TileManifest>) : null))
      .catch(() => null);
  return manifest;
}

const texCache = new Map<string, Promise<THREE.Texture | null>>();
function loadTex(url: string): Promise<THREE.Texture | null> {
  let p = texCache.get(url);
  if (!p) {
    p = new Promise((resolve) =>
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          resolve(t);
        },
        undefined,
        () => resolve(null),
      ),
    );
    texCache.set(url, p);
  }
  return p;
}

type Layer = { tex: THREE.Texture; box: Box } | null;

export interface SiteImagery {
  /** 1.4 km box of the 5 m landing terrain, from the 4.2 m/px LROC NAC composites */
  detail: Layer;
  /** 30 km context box, ~7 m/px */
  ctx: Layer;
  /** +-200 km planner region, ~98 m/px */
  region: Layer;
}

const NONE: SiteImagery = { detail: null, ctx: null, region: null };

export function useSiteImagery(siteId: string | null): SiteImagery {
  const [img, setImg] = useState<SiteImagery>(NONE);
  useEffect(() => {
    let alive = true;
    setImg(NONE);
    if (!siteId) return;
    tileManifest().then(async (m) => {
      const boxes = m?.siteImages;
      if (!boxes || !alive) return;
      const v = m?.imageVersion ? `?v=${m.imageVersion}` : ""; // a rebuilt image gets a new URL, never a stale cache
      const get = (id: string): Promise<Layer> =>
        boxes[id] ? loadTex(`./tiles/site/${id}.jpg${v}`).then((tex) => (tex ? { tex, box: boxes[id] } : null)) : Promise.resolve(null);
      const [detail, ctx, region] = await Promise.all([get(`${siteId}_detail`), get(siteId), get("region_s")]);
      if (alive) setImg({ detail, ctx, region });
    });
    return () => {
      alive = false;
    };
  }, [siteId]);
  return img;
}

/** Replace a terrain mesh's UVs so an image covering `box` (stereographic metres) drapes onto it. */
export function setStereoUV(geo: THREE.BufferGeometry, g: HeightGrid, box: Box, step = 1): void {
  const m = Math.floor((g.n - 1) / step) + 1;
  const uv = new Float32Array(m * m * 2);
  for (let r = 0; r < m; r++)
    for (let c = 0; c < m; c++) {
      const sx = g.x0 + Math.min(c * step, g.n - 1) * g.res;
      const sy = g.y0 - Math.min(r * step, g.n - 1) * g.res;
      uv[(r * m + c) * 2] = (sx - box[0]) / (box[2] - box[0]);
      uv[(r * m + c) * 2 + 1] = (sy - box[1]) / (box[3] - box[1]);
    }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
