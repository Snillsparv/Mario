// Procedural textures for the castle and drawbridge (small canvases, N64-style).
// All return an empty THREE.Texture in node (texgen.canvasTexture handles that).
// Tiling textures are painted at TILE px so that, with castle.js's repeats, a texel covers
// ~9-12 world units and bilinear filtering softens them like the N64's.

const TILE = 32;

import { canvasTexture, paintPixels, tileableFbm, mixRgb } from '../../render/texgen.js';
import { makeRng } from '../../core/math.js';

const clamp255 = (c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])];

// Rows of staggered blocks: returns (x, y) -> { tone, edge } where edge is 0 on a mortar
// line, 1 on the pixel just inside it, 2 elsewhere.
function blockPattern(w, h, rows, perRow, seed, spread) {
  const rng = makeRng(seed);
  const tones = Array.from({ length: rows * perRow }, () => 1 - spread / 2 + rng() * spread);
  const rh = h / rows;
  const bw = w / perRow;
  return (x, y) => {
    const row = Math.floor(y / rh);
    const xs = (x + (row % 2) * (bw / 2)) % w;
    const col = Math.floor(xs / bw);
    const ly = y - row * rh;
    const lx = xs - col * bw;
    const edge = Math.min(ly, lx) < 1 ? 0 : Math.min(ly, lx) < 2 ? 1 : 2;
    return { tone: tones[row * perRow + col], edge };
  };
}

// Cream ashlar walls: faint courses, gentle per-block tone, fine grain.
export function wallTexture() {
  return canvasTexture(TILE, TILE, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 8, 3, 11);
    const blocks = blockPattern(w, h, 4, 2, 5, 0.08);
    const base = [242, 228, 186];
    paintPixels(ctx, w, h, (x, y) => {
      const b = blocks(x, y);
      let k = b.tone * (0.93 + grain(x, y) * 0.14);
      if (b.edge === 0) k *= 0.89;
      else if (b.edge === 1) k *= 1.02;
      return clamp255(base.map((c) => c * k));
    });
  });
}

// Grey stone trims: bolder bricks with dark mortar.
export function stoneTexture() {
  return canvasTexture(TILE, TILE, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 8, 3, 23);
    const blocks = blockPattern(w, h, 4, 2, 9, 0.22);
    const base = [178, 174, 164];
    const mortar = [104, 100, 94];
    paintPixels(ctx, w, h, (x, y) => {
      const b = blocks(x, y);
      if (b.edge === 0) return mortar;
      const k = b.tone * (0.85 + grain(x, y) * 0.3) * (b.edge === 1 ? 1.06 : 1);
      return clamp255(base.map((c) => c * k));
    });
  });
}

// Deep red roof: overlapping fish-scale tiles, lighter at the top of each tile, dark rims.
// Canvas bottom = eave (texture v = 0) so tiles overlap downward.
export function roofTexture() {
  return canvasTexture(TILE, TILE, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 8, 2, 31);
    const rows = 4;
    const cols = 4;
    const rh = h / rows;
    const cw = w / cols;
    const light = [206, 58, 44];
    const mid = [170, 32, 28];
    const rim = [96, 14, 16];
    paintPixels(ctx, w, h, (x, y) => {
      let row = Math.floor(y / rh);
      let ly = y - row * rh;
      let lx = (x + (row % 2) * (cw / 2)) % cw;
      let dx = (lx + 0.5 - cw / 2) / (cw / 2);
      // Rounded tile bottom; below it we see the top of the tile in the next row.
      const edgeY = rh * 0.62 + rh * 0.38 * Math.sqrt(Math.max(0, 1 - dx * dx));
      let shadow = 1;
      if (ly + 0.5 > edgeY) {
        row = (row + 1) % rows;
        ly -= rh;
        lx = (x + (row % 2) * (cw / 2)) % cw;
        dx = (lx + 0.5 - cw / 2) / (cw / 2);
        shadow = 0.72; // tucked under the tile above
      }
      const t = (ly + rh) / (rh * 2); // 0 top of the tile .. 1 bottom rim
      let c = mixRgb(light, mid, Math.min(1, t * 1.4 + Math.abs(dx) * 0.35));
      const rimDist = edgeY - (ly + 0.5 + (shadow < 1 ? rh : 0));
      if (shadow === 1 && rimDist < 1.6) c = mixRgb(c, rim, 0.8);
      const k = shadow * (0.9 + grain(x, y) * 0.2);
      return clamp255(c.map((v) => v * k));
    });
  });
}

// Wooden planks running along v (4 planks), with grain, butt joints and nails.
export function woodTexture() {
  return canvasTexture(TILE, TILE, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 4, 3, 41);
    const fine = tileableFbm(w, h, 16, 2, 43);
    const rng = makeRng(17);
    const planks = 4;
    const pw = w / planks;
    const info = Array.from({ length: planks }, () => ({ tone: 0.85 + rng() * 0.3, joint: Math.floor(rng() * h) }));
    const base = [150, 102, 58];
    const dark = [58, 36, 20];
    paintPixels(ctx, w, h, (x, y) => {
      const p = Math.floor(x / pw);
      const lx = x - p * pw;
      const { tone, joint } = info[p];
      if (lx < 1) return dark;
      const jy = (y - joint + h) % h;
      if (jy === 0) return dark;
      const nail = (jy === 2 || jy === h - 3) && (lx === 2 || lx === pw - 3);
      if (nail) return [40, 34, 30];
      const streak = 0.85 + 0.15 * Math.sin(lx * 1.7 + grain(x, y) * 9 + p);
      const k = tone * streak * (0.85 + fine(x, y) * 0.3) * (lx === 1 ? 0.8 : 1);
      return clamp255(base.map((c) => c * k));
    });
  });
}

// Round stained-glass rose window: an original geometric sunburst — an eight-pointed
// golden star, a ring of petals, an outer ring of panes — with dark leading.
export function roseTexture() {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      const noise = tileableFbm(w, h, 16, 2, 51);
      const lead = [34, 28, 36];
      const gold = [255, 206, 70];
      const blue = [48, 92, 214];
      const red = [206, 40, 52];
      const green = [52, 170, 96];
      const violet = [140, 70, 190];
      const sky = [110, 190, 250];
      paintPixels(ctx, w, h, (x, y) => {
        const dx = x + 0.5 - w / 2;
        const dy = y + 0.5 - h / 2;
        const r = Math.hypot(dx, dy) / (w / 2); // 0..1 at the rim
        const a = Math.atan2(dy, dx) + Math.PI; // 0..2pi
        const seg = (n) => (a / (Math.PI * 2)) * n;
        const onLine = (v, width) => Math.abs(v - Math.round(v)) < width;
        let c;
        if (r > 0.97) return lead;
        const t8 = seg(8) % 1;
        const star = 0.13 + 0.2 * (1 - Math.abs(2 * t8 - 1));
        if (r < star) {
          c = r < 0.09 ? [255, 244, 190] : gold;
          if (Math.abs(r - star) < 0.02) return lead;
        } else if (r < 0.42) {
          if (Math.abs(r - 0.42) < 0.02 || onLine(seg(16), 0.05 / Math.max(r, 0.2))) return lead;
          c = Math.floor(seg(16)) % 2 ? blue : red;
          if (r < 0.26) c = mixRgb(c, sky, 0.35);
        } else if (r < 0.7) {
          const s = seg(16) + 0.5;
          if (Math.abs(r - 0.7) < 0.018 || onLine(s, 0.03 / r)) return lead;
          c = [green, gold, violet, gold][Math.floor(s) % 4];
          // A small lens in each pane.
          const lr = Math.hypot(r - 0.56, ((s % 1) - 0.5) * 0.3);
          if (lr < 0.07) c = mixRgb(c, [255, 255, 230], 0.45);
        } else {
          const s = seg(24);
          if (onLine(s, 0.05)) return lead;
          c = Math.floor(s) % 2 ? blue : sky;
          if (Math.abs(r - 0.84) < 0.1 && Math.hypot(r - 0.84, ((s % 1) - 0.5) * 0.26) < 0.06) c = red;
        }
        const k = 0.88 + noise(x, y) * 0.24;
        return clamp255(c.map((v) => v * k));
      });
    },
    { repeat: false },
  );
}

// Flag atlas: top half = keep banner (cream field, red border, golden sun emblem),
// bottom half = pennant (gold with a red stripe).
export function flagTexture() {
  return canvasTexture(
    64,
    64,
    (ctx, w, h) => {
      const hh = h / 2;
      paintPixels(ctx, w, h, (x, y) => {
        if (y < hh) {
          if (y < 3 || y >= hh - 3 || x >= w - 3) return [196, 36, 40];
          if (x < 5) return [240, 232, 210];
          const dx = x + 0.5 - 34;
          const dy = y + 0.5 - hh / 2;
          const r = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const ray = 7 + 5 * Math.max(0, Math.cos(a * 8)) ** 3;
          if (r < 5) return [255, 200, 50];
          if (r < 6) return [214, 120, 30];
          if (r < ray) return [250, 176, 40];
          return [246, 240, 222];
        }
        const ly = y - hh;
        if (Math.abs(ly + 0.5 - hh / 2) < 3) return [200, 38, 42];
        return [250, 208, 60];
      });
    },
    { repeat: false },
  );
}
