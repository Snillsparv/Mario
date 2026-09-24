// Procedural textures for the props, painted per pixel on small canvases: the trees' and
// bushes' leaves and bark, the flower billboard atlas, wood, the waterfall's streaks and
// foam puffs, and the soft ground shadow (rock comes from the terrain's textures). Every
// getter paints once and caches; in node (no canvas) canvasTexture returns an empty texture
// without painting.

import { canvasTexture, paintPixels, tileableFbm, tileableNoise, mixRgb } from '../../render/texgen.js';
import { clamp, makeRng, smoothstep } from '../../core/math.js';

const TAU = Math.PI * 2;
const cache = new Map();
function cached(name, make) {
  if (!cache.has(name)) cache.set(name, make());
  return cache.get(name);
}

// setup() runs only when a canvas exists and returns the per-pixel painter fn(x, y) -> rgba.
function painted(w, h, setup, opts) {
  return canvasTexture(w, h, (ctx) => paintPixels(ctx, w, h, setup()), opts);
}

// Piecewise-linear colour ramp over [t, [r, g, b]] stops.
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mixRgb(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

// Coverage from a signed distance in pixels (negative inside): a sub-texel edge, so the
// alpha-tested silhouette stays smooth under bilinear magnification.
const coverage = (sdPx) => clamp(0.5 - sdPx, 0, 1) * 255;

// Anisotropic tileable noise: cells are `stretch` times taller than wide (streaks, grain).
function streakNoise(w, h, cellsX, stretch, seed) {
  const n = tileableNoise(w, h / stretch, cellsX, seed);
  return (x, y) => n(x, y / stretch);
}

// ---------------------------------------------------------------- foliage (trees, bushes)

// Leaf tones, shadow to sunlit (flat bands, like a hand-painted era texture). The canopy's
// vertex colours do the big light and shade; the texture only adds the leafy clumps.
const LEAF_TONES = [
  [34, 82, 32],
  [48, 106, 40],
  [66, 130, 48],
  [90, 154, 58],
  [120, 178, 72],
];
const LEAF_GAP = [26, 64, 26];
const BARK_TONES = [
  [52, 34, 20],
  [84, 56, 32],
  [118, 82, 48],
  [146, 106, 64],
];

// Index into a list of flat tones for a light value in 0..1.
const band = (tones, lit) => tones[clamp(Math.floor(lit * tones.length), 0, tones.length - 1)];

// World units covered by one repeat of the leaf texture (box-projected onto the canopies):
// ~6.5 units per texel, a clump of leaves ~50 units across.
export const LEAF_TILE = 420;
export const LEAF_SIZE = 64;

// Tileable leafy canopy surface (64 x 64): a dense pile of small round leaf clumps, each
// domed (lighter toward its upper middle, a dark rim), painted in flat tone bands over dark
// gaps, with a few light flecks. Clumps wrap around the edges so the texture tiles.
export function leafTexture() {
  return cached('leaves', () =>
    painted(LEAF_SIZE, LEAF_SIZE, () => {
      const S = LEAF_SIZE;
      const rng = makeRng(5150);
      const clumps = Array.from({ length: 110 }, () => ({
        x: rng() * S,
        y: rng() * S,
        r: 3.6 + rng() * 2.8,
        squash: 0.72 + rng() * 0.28,
        tilt: rng() * Math.PI,
        tone: 0.85 + rng() * 0.3,
      }));
      const fleck = tileableNoise(S, S, S / 4, 5151);
      const wrap = (d) => d - S * Math.round(d / S);
      return (px, py) => {
        const x = px + 0.5;
        const y = py + 0.5;
        // Later clumps lie on top of earlier ones.
        for (let i = clumps.length - 1; i >= 0; i--) {
          const c = clumps[i];
          const dx = wrap(x - c.x);
          const dy = wrap(y - c.y);
          const u = dx * Math.cos(c.tilt) + dy * Math.sin(c.tilt);
          const v = (-dx * Math.sin(c.tilt) + dy * Math.cos(c.tilt)) / c.squash;
          const q = (u * u + v * v) / (c.r * c.r);
          if (q >= 1) continue;
          // Dome lit from above (canvas y runs down): brighter on the clump's upper side.
          let lit = (0.4 + 0.5 * Math.sqrt(1 - q) - 0.16 * (dy / c.r)) * c.tone;
          if (q > 0.75) lit -= 0.2; // darker rim between clumps
          lit += (fleck(px, py) - 0.5) * 0.3;
          return band(LEAF_TONES, lit);
        }
        return LEAF_GAP;
      };
    }),
  );
}

// Tileable bark (32 x 64, v along the trunk): dark vertical furrows between lighter ridges.
export function barkTexture() {
  return cached('bark', () =>
    painted(32, 64, () => {
      const ridges = streakNoise(32, 64, 8, 6, 811);
      const fine = streakNoise(32, 64, 16, 3, 812);
      const blotch = tileableFbm(32, 64, 4, 2, 813);
      return (x, y) => {
        let lit = 0.25 + 0.6 * ridges(x, y) + 0.3 * (fine(x, y) - 0.5) + 0.25 * (blotch(x, y) - 0.5);
        if (ridges(x, y) < 0.3) lit -= 0.25; // furrow
        return band(BARK_TONES, lit);
      };
    }),
  );
}

// Rectangle [u0, v0, u1, v1] of cell i in a 2 x 2 atlas (v up, as three.js samples it),
// optionally only the lower `height` fraction of the cell.
export function cellUV(i, height = 1) {
  const cx = i % 2;
  const cy = Math.floor(i / 2);
  const v0 = 1 - (cy + 1) / 2;
  return [cx / 2, v0, (cx + 1) / 2, v0 + height / 2];
}

// ---------------------------------------------------------------- flowers

export const FLOWER_CELL = 32;
// Petal / centre colours of the flower variants (2 x 2 cells).
const FLOWER_KINDS = [
  { petal: [232, 58, 52], centre: [252, 214, 60] },
  { petal: [250, 250, 244], centre: [246, 196, 40] },
  { petal: [252, 222, 64], centre: [226, 120, 30] },
  { petal: [176, 110, 226], centre: [252, 232, 110] },
];
export const FLOWER_VARIANTS = FLOWER_KINDS.length;

// A little five-petal flower on a stem with two leaves, in a 0..1 cell (y up).
function flowerCellPainter(size, kind) {
  const hx = 0.5;
  const hy = 0.7;
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = Math.PI / 2 + (i / 5) * TAU;
    return { x: hx + Math.cos(a) * 0.15, y: hy + Math.sin(a) * 0.15, r: 0.125 };
  });
  const leaves = [
    { x: 0.37, y: 0.26, rx: 0.12, ry: 0.05, tilt: 0.5 },
    { x: 0.63, y: 0.36, rx: 0.12, ry: 0.05, tilt: -0.5 },
  ];
  const outline = kind.petal.map((v) => v * 0.45);
  return (px, py) => {
    const x = (px + 0.5) / size;
    const y = 1 - (py + 0.5) / size;
    const centre = Math.hypot(x - hx, y - hy) - 0.075;
    let petal = Infinity;
    for (const p of petals) petal = Math.min(petal, Math.hypot(x - p.x, y - p.y) - p.r);
    const stemX = hx + 0.03 * Math.sin(y * 6);
    const stem = Math.max(Math.abs(x - stemX) - 0.035, y - hy, -y);
    let leaf = Infinity;
    for (const l of leaves) {
      const dx = x - l.x;
      const dy = y - l.y;
      const u = dx * Math.cos(l.tilt) + dy * Math.sin(l.tilt);
      const v = -dx * Math.sin(l.tilt) + dy * Math.cos(l.tilt);
      leaf = Math.min(leaf, (Math.hypot(u / l.rx, v / l.ry) - 1) * l.ry);
    }
    const green = Math.min(stem, leaf);
    const head = Math.min(petal, centre);
    const alpha = coverage(Math.min(green, head) * size);
    if (alpha <= 0) return [40, 90, 30, 0];
    if (head < 0.02) {
      if (centre < 0) return [...kind.centre, alpha];
      // Petals lighter toward the top, darker rim.
      const lit = 0.75 + 0.35 * clamp((y - hy) / 0.25, -1, 1);
      const rim = petal * size > -1.2 ? 0.7 : 1;
      return [...mixRgb(outline, kind.petal, clamp(lit * rim, 0, 1)), alpha];
    }
    const lit = green * size > -1 ? 0.55 : 0.85 + 0.2 * Math.sin(x * 40);
    return [...mixRgb([22, 60, 20], [80, 150, 50], clamp(lit, 0, 1)), alpha];
  };
}

// 2 x 2 flower variants.
export function flowerAtlas() {
  return cached('flowers', () =>
    painted(
      FLOWER_CELL * 2,
      FLOWER_CELL * 2,
      () => {
        const cells = FLOWER_KINDS.map((k) => flowerCellPainter(FLOWER_CELL, k));
        return (x, y) => {
          const i = Math.floor(x / FLOWER_CELL) + 2 * Math.floor(y / FLOWER_CELL);
          return cells[i](x % FLOWER_CELL, y % FLOWER_CELL);
        };
      },
      { repeat: false },
    ),
  );
}

// ---------------------------------------------------------------- wood

// Brown wood with grain running along v and a couple of knots (32 x 64).
export function woodTexture() {
  return cached('wood', () =>
    painted(32, 64, () => {
      const grain = streakNoise(32, 64, 10, 8, 301);
      const fine = streakNoise(32, 64, 24, 4, 302);
      const knots = [
        { x: 9, y: 18 },
        { x: 23, y: 47 },
      ];
      return (x, y) => {
        let t = 0.35 + 0.45 * grain(x, y) + 0.25 * (fine(x, y) - 0.5);
        for (const k of knots) {
          const d = Math.hypot(x - k.x, (y - k.y) * 0.6);
          if (d < 3.2) t *= 0.55 + 0.1 * d;
        }
        if (x % 16 === 0) t *= 0.7; // board seam
        return ramp(
          [
            [0, [70, 42, 22]],
            [0.5, [122, 80, 44]],
            [1, [168, 120, 72]],
          ],
          t,
        );
      };
    }),
  );
}

// Boulders, crags and the spillway use the terrain's cliff rock, at the cliffs' texel scale
// (terrain/walls.js maps it at u 640 x v 1280 world units), so they read as the same stone.
export { rockTexture } from '../terrainTextures.js';
export const ROCK_TILE = { u: 640, v: 1280 };

// ---------------------------------------------------------------- water, foam, shadow

// Falling-water streaks: white/pale-blue vertical streaks of varying opacity, tileable both
// ways (64 x 128). v runs along the flow.
export function waterfallTexture() {
  return cached('waterfall', () =>
    painted(64, 128, () => {
      const wide = streakNoise(64, 128, 8, 10, 601);
      const thin = streakNoise(64, 128, 24, 12, 602);
      const clumps = tileableFbm(64, 128, 4, 2, 603);
      return (x, y) => {
        const s = clamp(0.55 * wide(x, y) + 0.45 * thin(x, y) + 0.5 * (clumps(x, y) - 0.5), 0, 1);
        const foam = smoothstep(0.55, 0.85, s);
        const rgb = mixRgb([150, 196, 238], [255, 255, 255], 0.35 + 0.65 * foam);
        return [...rgb, 255 * (0.42 + 0.58 * smoothstep(0.25, 0.8, s))];
      };
    }),
  );
}

// Soft, lumpy white puff for splash, spray, mist and foam sprites (64 x 64).
export function puffTexture() {
  return cached('puff', () =>
    painted(
      64,
      64,
      () => {
        const lumps = tileableFbm(64, 64, 6, 3, 701);
        return (x, y) => {
          const dx = (x + 0.5) / 32 - 1;
          const dy = (y + 0.5) / 32 - 1;
          const r = Math.hypot(dx, dy);
          const d = r + (lumps(x, y) - 0.5) * 0.45;
          const a = (1 - smoothstep(0.35, 0.95, d)) * (1 - smoothstep(0.75, 1, r)); // 0 at the rim
          const shade = 0.86 + 0.14 * clamp(-(dx + dy), -1, 1); // brighter upper-left
          return [...mixRgb([196, 214, 232], [255, 255, 255], shade), 255 * a];
        };
      },
      { repeat: false },
    ),
  );
}

// Round blurry ground shadow: black with a soft radial alpha falloff (32 x 32).
export function shadowTexture() {
  return cached('shadow', () =>
    painted(
      32,
      32,
      () => (x, y) => {
        const d = Math.hypot((x + 0.5) / 16 - 1, (y + 0.5) / 16 - 1);
        return [0, 0, 0, 255 * (1 - smoothstep(0.25, 1, d))];
      },
      { repeat: false },
    ),
  );
}
