// Procedural textures for the props, painted per pixel on small canvases: the billboard
// atlases (round bushy trees and bushes, little flowers), wood, the waterfall's streaks and
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

// 64-px cells: a ~800-unit tree gets ~12 units per texel, as coarse as the grass and castle
// textures, so the billboards read as small, soft era sprites rather than crisp CG.
export const FOLIAGE_CELL = 64;
// 2 x 2 atlas cells: two round bushy trees, two round bushes.
export const FOLIAGE = { tree: [0, 1], bush: [2, 3] };
// Bushes only use the lower part of their cell (the quad is shorter than it is wide).
export const BUSH_CELL_HEIGHT = 0.68;

// Shapes (cell units, y up): canopy ellipse centre/radii, rim and inner clump counts, clump
// size (x the smaller radius), optional trunk, and a flat base for bushes. A handful of big
// clumps give the bumpy round outline.
const FOLIAGE_SHAPES = [
  { cx: 0.5, cy: 0.62, rx: 0.33, ry: 0.31, ring: 8, inner: 4, clump: 0.46, trunk: true, seed: 11 },
  { cx: 0.5, cy: 0.63, rx: 0.3, ry: 0.3, ring: 7, inner: 4, clump: 0.48, trunk: true, seed: 23 },
  { cx: 0.5, cy: 0.3, rx: 0.34, ry: 0.22, ring: 8, inner: 3, clump: 0.6, base: 0.03, seed: 37 },
  { cx: 0.5, cy: 0.28, rx: 0.3, ry: 0.2, ring: 7, inner: 3, clump: 0.65, base: 0.03, seed: 41 },
];

// Flat leaf tones, shadow to sunlit; each clump is painted in bands of these.
const LEAF_TONES = [
  [22, 54, 22],
  [38, 90, 30],
  [64, 128, 40],
  [108, 166, 56],
];
const LEAF_OUTLINE = [14, 36, 14];
const BARK_TONES = [
  [62, 40, 22],
  [100, 66, 36],
  [140, 98, 56],
];

// Light for the painted shading (image space: x right, y up, z toward the viewer). Upper
// right, matching the sun as seen from the default northward view.
const FOLIAGE_LIGHT = (() => {
  const l = Math.hypot(0.55, 0.62, 0.56);
  return [0.55 / l, 0.62 / l, 0.56 / l];
})();

// Index into a list of flat tones for a light value in 0..1.
const band = (tones, lit) => tones[clamp(Math.floor(lit * tones.length), 0, tones.length - 1)];

// One round, bushy tree or bush: the canopy is an ellipsoid body covered by big clump
// spheres (the visible clump at a pixel is the one that bulges furthest toward the viewer),
// lit by the clump and body normals and painted in a few flat tone bands, with dark creases
// between clumps, small leafy flecks and a crisp dark outline; trees get a short
// flared trunk below. Returns fn(px, py) for pixels in the cell.
function foliagePainter(size, shape) {
  const rng = makeRng(shape.seed);
  const { cx, cy, rx, ry } = shape;
  const rmin = Math.min(rx, ry);
  // Depth of a clump sitting on the body at normalised body radius q (0 centre .. 1 rim).
  const onBody = (q) => Math.sqrt(Math.max(0, 1 - q * q)) * rmin * 0.72;
  const clumps = [];
  for (let i = 0; i < shape.ring; i++) {
    const a = (i / shape.ring) * TAU + (rng() - 0.5) * 0.4;
    const q = 0.7 + rng() * 0.12;
    const sag = shape.trunk && Math.sin(a) < -0.5 ? 0.03 : 0; // hide the top of the trunk
    const r = rmin * shape.clump * (0.85 + rng() * 0.3);
    clumps.push({ x: cx + Math.cos(a) * q * rx, y: cy + Math.sin(a) * q * ry - sag, r, z: onBody(q) });
  }
  for (let i = 0; i < shape.inner; i++) {
    const a = rng() * TAU;
    const q = 0.5 * Math.sqrt(rng());
    const r = rmin * shape.clump * (0.85 + rng() * 0.3);
    clumps.push({ x: cx + Math.cos(a) * q * rx, y: cy + Math.sin(a) * q * ry + 0.03, r, z: onBody(q) });
  }
  const edgeNoise = tileableNoise(size, size, 12, shape.seed + 1);
  const fleck = tileableNoise(size, size, size / 4, shape.seed + 2);
  const bark = streakNoise(size, size, 12, 4, shape.seed + 3);
  const L = FOLIAGE_LIGHT;
  const base = shape.base ?? -1;

  const trunkTop = cy - ry * 0.4;
  const trunkHalf = (y) => 0.045 + 0.035 * (1 - smoothstep(0, 0.1, y));

  return (px, py) => {
    const x = (px + 0.5) / size;
    const y = 1 - (py + 0.5) / size;
    // Canopy: union of the body ellipse and the clump discs; track the two front-most.
    const gx = (x - cx) / rx;
    const gy = (y - cy) / ry;
    const g = Math.hypot(gx, gy);
    let sd = (g - 1) * rmin;
    let best = g < 1 ? Math.sqrt(1 - g * g) * rmin * 0.9 : -Infinity;
    let second = -Infinity;
    let top = g < 1 ? 'body' : null;
    for (const c of clumps) {
      const d = Math.hypot(x - c.x, y - c.y);
      sd = Math.min(sd, d - c.r);
      if (d < c.r) {
        const h = c.z + Math.sqrt(c.r * c.r - d * d);
        if (h > best) {
          second = best;
          best = h;
          top = c;
        } else if (h > second) second = h;
      }
    }
    sd += (edgeNoise(px, py) - 0.5) * 0.025; // leafy, slightly ragged outline
    sd = Math.max(sd, base - y); // bushes sit on a flat base
    const canopyPx = sd * size;

    // Trunk: a tapered column with a flared foot.
    const hw = trunkHalf(y);
    const trunkPx = shape.trunk ? Math.max(Math.abs(x - cx) - hw, y - trunkTop, 0.004 - y) * size : Infinity;

    const alpha = coverage(Math.min(canopyPx, trunkPx));
    if (alpha <= 0) return [...LEAF_OUTLINE, 0];

    if (canopyPx < 0.5) {
      // Outline, and fringe pulled out by the edge noise (outside every clump).
      if (!top || canopyPx > -1) return [...LEAF_OUTLINE, alpha];
      let n;
      if (top === 'body') n = [gx, gy, Math.sqrt(Math.max(0, 1 - g * g))];
      else {
        const dx = (x - top.x) / top.r;
        const dy = (y - top.y) / top.r;
        n = [dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy))];
      }
      const bz = Math.sqrt(Math.max(0, 1 - g * g));
      const clumpLit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const bodyLit = Math.max(0, gx * L[0] + gy * L[1] + bz * L[2]);
      let lit = 0.6 * clumpLit + 0.4 * bodyLit;
      lit *= 0.6 + 0.4 * smoothstep(cy - ry * 1.1, cy + ry * 0.3, y); // shaded underside
      if (second > -Infinity && best - second < 0.012) lit -= 0.3; // crease between clumps
      lit += (fleck(px, py) - 0.5) * 0.4; // leafy flecks a few texels across, a band up or down
      return [...band(LEAF_TONES, lit), alpha];
    }
    // Bark: lit from the right, darker under the canopy and at the edges.
    const across = clamp((x - cx) / hw, -1, 1);
    let lit = 0.35 + 0.4 * (across * 0.5 + 0.5) + (bark(px, py) - 0.5) * 0.3;
    lit -= 0.4 * smoothstep(trunkTop - 0.12, trunkTop, y);
    if (trunkPx > -1) lit = 0;
    return [...band(BARK_TONES, lit), alpha];
  };
}

export function foliageAtlas() {
  return cached('foliage', () =>
    painted(
      FOLIAGE_CELL * 2,
      FOLIAGE_CELL * 2,
      () => {
        const cells = FOLIAGE_SHAPES.map((s) => foliagePainter(FOLIAGE_CELL, s));
        return (x, y) => {
          const i = Math.floor(x / FOLIAGE_CELL) + 2 * Math.floor(y / FOLIAGE_CELL);
          return cells[i](x % FOLIAGE_CELL, y % FOLIAGE_CELL);
        };
      },
      { repeat: false },
    ),
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
