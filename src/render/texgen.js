// Helpers for procedurally painting small, N64-style textures on a canvas.
// Keep textures small (32..128 px) and let bilinear filtering soften them, like the N64 did.

import * as THREE from 'three';
import { makeRng } from '../core/math.js';

// True when a 2D canvas is available (false in node unit tests).
export const HAS_CANVAS = typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// draw(ctx, w, h) paints the texture. Returns a THREE.CanvasTexture configured for
// repeating, bilinear, mipmapped sampling in sRGB. Without a canvas (node tests) it returns
// an empty texture so geometry/collision code can still run.
export function canvasTexture(w, h, draw, { repeat = true, nearest = false, mipmaps = true } = {}) {
  if (!HAS_CANVAS) return new THREE.Texture();
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

// Tileable value noise sampled on a w x h grid with `cells` lattice cells per side.
// Returns a function (x, y) -> 0..1 over pixel coords that tiles with period (w, h).
export function tileableNoise(w, h, cells, seed = 1) {
  const rng = makeRng(seed);
  const cx = Math.max(1, Math.round(cells));
  const cy = Math.max(1, Math.round((cells * h) / w));
  const grid = new Float32Array(cx * cy).map(() => rng());
  const at = (i, j) => grid[((j % cy) + cy) % cy * cx + (((i % cx) + cx) % cx)];
  return (x, y) => {
    const fx = (x / w) * cx;
    const fy = (y / h) * cy;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    let tx = fx - i;
    let ty = fy - j;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * ty;
  };
}

// Fractal sum of tileable noise, 0..1.
export function tileableFbm(w, h, baseCells, octaves = 3, seed = 1) {
  const layers = Array.from({ length: octaves }, (_, o) => tileableNoise(w, h, baseCells * 2 ** o, seed + o * 101));
  return (x, y) => {
    let v = 0;
    let amp = 0.5;
    let norm = 0;
    for (const n of layers) {
      v += n(x, y) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return v / norm;
  };
}

// Fill every pixel with fn(x, y) -> [r, g, b] or [r, g, b, a] (0..255).
export function paintPixels(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
