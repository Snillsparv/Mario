// The effects' sprite atlas: 8 small procedural shapes (32 px cells, 4 x 2) painted once on
// a canvas, sampled bilinearly like the era's 32x32 effect textures.
//   alpha = coverage, red = "heat" / detail (flame core, smoke density). Raw data, no sRGB.

import * as THREE from 'three';
import { canvasTexture, paintPixels, tileableFbm } from '../render/texgen.js';
import { clamp, smoothstep } from '../core/math.js';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
export const ATLAS_CELL = 32;

// Cell indices (row-major from the top-left).
export const SHAPE = Object.freeze({
  FLAME_A: 0, // teardrop tongue, round base, tip up
  FLAME_B: 1, // a second tongue with another curl
  SMOKE: 2, // ragged soft puff
  GLOW: 3, // soft round glow / spark dot
  CHUNK: 4, // hard-edged irregular debris chunk
  RING: 5, // thin ring (splashes, shockwaves)
  LINE: 6, // soft line along v (lightning segments)
  STAR: 7, // blast flash: bright core with rays
});

// Atlas UV rectangle [u0, v0, du, dv] of a cell (texture v points up, the canvas is flipped).
export function cellRect(shape) {
  const cx = shape % ATLAS_COLS;
  const cy = Math.floor(shape / ATLAS_COLS);
  return [cx / ATLAS_COLS, (ATLAS_ROWS - 1 - cy) / ATLAS_ROWS, 1 / ATLAS_COLS, 1 / ATLAS_ROWS];
}

// One cell's pixel: u, v in [-1, 1] (v up), returns [heat 0..1, coverage 0..1].
function shapePixel(shape, u, v, fbm, px, py) {
  const d = Math.sqrt(u * u + v * v);
  switch (shape) {
    case SHAPE.FLAME_A:
    case SHAPE.FLAME_B: {
      const b = shape === SHAPE.FLAME_B;
      const h = (v + 0.92) / 1.86; // 0 at the base .. 1 at the tip
      if (h <= 0 || h >= 1) return [0, 0];
      const r = (b ? 0.56 : 0.62) * Math.sin(Math.PI * h ** (b ? 0.7 : 0.6));
      const curl = (b ? -0.16 : 0.13) * Math.sin(h * (b ? 8.5 : 6.5) + (b ? 1.3 : 0)) * h;
      const x = Math.abs(u - curl);
      const n = fbm(px, py) - 0.5;
      const edge = r * (1 + n * 0.5);
      const cov = smoothstep(edge, edge * 0.45, x) * smoothstep(0, 0.08, h);
      const heat = clamp((1 - x / Math.max(r, 1e-3)) * (1.25 - h) + n * 0.3, 0, 1);
      return [heat, cov];
    }
    case SHAPE.SMOKE: {
      const n = fbm(px, py);
      const cov = smoothstep(0.95, 0.25, d + (n - 0.5) * 0.7);
      return [0.4 + n * 0.6, cov * 0.9];
    }
    case SHAPE.GLOW: {
      const cov = Math.exp(-d * d * 4.2) * smoothstep(1, 0.8, d);
      return [1, cov];
    }
    case SHAPE.CHUNK: {
      const a = Math.atan2(v, u);
      const r = 0.62 + 0.2 * Math.sin(a * 3 + 0.7) + 0.12 * Math.sin(a * 5 + 2.1);
      const cov = smoothstep(r + 0.06, r - 0.06, d);
      const lit = clamp(0.55 + 0.45 * (-u * 0.6 + v * 0.8) / Math.max(r, 0.2), 0, 1);
      return [lit, cov];
    }
    case SHAPE.RING: {
      const w = Math.abs(d - 0.78);
      return [1, smoothstep(0.17, 0.03, w)];
    }
    case SHAPE.LINE: {
      const cov = Math.exp(-u * u * 7) * smoothstep(1, 0.8, Math.abs(v));
      return [1 - Math.min(1, Math.abs(u) * 1.5), cov];
    }
    case SHAPE.STAR: {
      const a = Math.atan2(v, u);
      const rays = Math.abs(Math.cos(a * 3)) ** 10 * Math.exp(-d * 2.2) * 0.7;
      const core = Math.exp(-d * d * 3.5);
      return [Math.exp(-d * d * 9), Math.min(1, core + rays) * smoothstep(1, 0.85, d)];
    }
    default:
      return [0, 0];
  }
}

// Paints the atlas (null-texture fallback in node, see texgen.canvasTexture).
export function buildAtlas() {
  const W = ATLAS_COLS * ATLAS_CELL;
  const H = ATLAS_ROWS * ATLAS_CELL;
  const tex = canvasTexture(
    W,
    H,
    (ctx, w, h) => {
      const fbm = tileableFbm(w, h, 8, 3, 29);
      paintPixels(ctx, w, h, (x, y) => {
        const shape = Math.floor(y / ATLAS_CELL) * ATLAS_COLS + Math.floor(x / ATLAS_CELL);
        // Pixel centre in the cell, -1..1; the outermost texel stays empty (no bleeding).
        const u = (((x % ATLAS_CELL) + 0.5) / ATLAS_CELL) * 2 - 1;
        const v = 1 - (((y % ATLAS_CELL) + 0.5) / ATLAS_CELL) * 2;
        const [heat, cov] = shapePixel(shape, u * 1.07, v * 1.07, fbm, x, y);
        return [Math.round(heat * 255), 0, 0, Math.round(clamp(cov, 0, 1) * 255)];
      });
    },
    { repeat: false, mipmaps: false },
  );
  tex.colorSpace = THREE.NoColorSpace; // shape data, not a colour
  tex.premultiplyAlpha = false;
  return tex;
}
