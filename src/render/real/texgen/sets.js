// The realistic look's procedural PBR texture sets: every material's maps painted in code from
// seeded noise (texgen/noise.js), never sampled from a photograph. Pure functions on typed
// arrays (no DOM, no three.js): they run in the texture worker (render/real/laneRealWorker.js)
// and in node tests, deterministic to the byte.
//
//   GENERATORS[kind](size, opts) -> { size, albedo, normal, orm }
//   generate({ kind, size, opts }) -> the same (a job, as the worker gets it; texgen/jobs.js
//                                                       // names it: jobKey)
//   TEXGEN_VERSION                                      // bump by hand whenever any generator's
//                                                       // output changes (tests/real-texgen
//                                                       // pins every set's hash with it)
//
// Each set is three RGBA8 maps, row 0 at v 0, tiling (every noise is periodic over the
// texture): albedo (sRGB colour; alpha 255), normal (tangent space, OpenGL: +y up the texture),
// ORM (R ambient occlusion, G roughness, B metalness). The colours are neutral or near it where
// a vertex tint gives the material its colour (the boards' Falu red or yellow, the roofs'
// greys): the material catalogue (world/lane/real/look.js) multiplies them.
//
// Kinds: boards (vertical board-and-batten cladding), brick (sand-lime brick in running bond;
// grey split-face blocks with other options), tiles (concrete double-roll pan tiles), asphalt,
// grass (a lawn from above; with leaves 0, the hedges' leafy mass), pavers (concrete grass
// pavers; cobbles with more columns), render (white trowelled render), soil (bark mulch with
// fallen leaves: the trunks' and posts' rough brown), granite (the kerbs), bark (a trunk's
// fissured bark; birch 1: a birch's white bark), and two cut-outs for the leaf cards (their
// albedo's alpha the leaves' coverage, alpha-tested, with mips that keep it: `mips`, the
// albedo's levels 1 .. down to 1 x 1, noise.js coverageMips): leaves (an atlas of four kinds,
// LEAF_CELLS) and fir (a spruce twig).

import { hash, rng, makeFbm, makeCells, cavity, pack, coverageMips, clamp01, smooth, field, rgbField, setRgb } from './noise.js';

export const TEXGEN_VERSION = 1;

// Vertical board-and-batten cladding (Falu paint): `boards` boards across, each with a batten
// over its joint. A light neutral colour: the vertex tint gives red or yellow.
export function boardsSet(n = 512, { boards = 8, seed = 11 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const bw = n / boards;
  const batten = bw * 0.28;
  const grains = [];
  for (let k = 0; k < boards; k++) grains.push(makeFbm(48, 3, seed + k * 3, 3));
  const fine = makeFbm(96, 2, seed + 50, 6);
  const paintNoise = makeFbm(6, 3, seed + 90);
  const weatherNoise = makeFbm(3, 2, seed + 97, 24);
  for (let y = 0; y < n; y++) {
    const t = y / n;
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const k = Math.floor(x / bw);
      const lx = x - k * bw; // 0..bw: the batten centred on lx 0 (the joint)
      const db = Math.min(lx, bw - lx); // from the batten's middle
      const bev = smooth(batten / 2, batten / 2 - 2.2, db); // 1 on the batten, eased edges
      const grain = grains[k](s, t) * 0.6 + fine(s, t) * 0.4;
      const plank = hash(k, 0, seed) * 0.08;
      const i = y * n + x;
      h[i] = bev * 3.2 + grain * 0.5 - (db > batten / 2 + 1 && db < batten / 2 + 2.6 ? 0.25 : 0);
      const paint = 0.82 + 0.1 * paintNoise(s, t) - 0.08 * grain + plank * (bev > 0.5 ? -0.5 : 1);
      const v = paint * (0.96 + 0.04 * weatherNoise(s, t));
      setRgb(col, i, v, v * 0.985, v * 0.975);
      rough[i] = 0.78 + 0.12 * grain;
    }
  }
  const ao = cavity(h, n, 6, 0.35);
  return pack(n, { col, h, strength: 1.4, ao, rough });
}

// Brick in running bond (`cols` bricks x `rows` courses) in recessed mortar, a grainy face, a
// few chipped arrises: the white sand-lime brick by default; `tone`, `mortar` and `jitter` give
// the grey split-face blocks.
export function brickSet(n = 512, { cols = 5, rows = 16, seed = 21, tone = [0.78, 0.77, 0.74], mortar = [0.55, 0.55, 0.53], jitter = 0.05 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const ch = n / rows;
  const cw = n / cols;
  const m = Math.max(1.5, ch * 0.12);
  const gritNoise = makeFbm(64, 3, seed);
  const chipNoise = makeFbm(24, 2, seed + 5);
  for (let y = 0; y < n; y++) {
    const row = Math.floor(y / ch);
    const ly = y - row * ch;
    const off = row % 2 ? cw / 2 : 0;
    for (let x = 0; x < n; x++) {
      const xx = (x + off) % n;
      const c = Math.floor(xx / cw);
      const lx = xx - c * cw;
      const edge = Math.min(lx, cw - lx, ly, ch - ly);
      const face = smooth(m * 0.5, m * 1.4, edge);
      const s = x / n;
      const t = y / n;
      const grit = gritNoise(s, t) - 0.5;
      const id = hash(c + row * 31, row, seed);
      const chip = chipNoise(s, t);
      const i = y * n + x;
      h[i] = face * (2.2 + (chip > 0.72 ? -1.2 * (chip - 0.72) * 4 : 0)) + grit * 0.6;
      const b = 1 + (id - 0.5) * jitter * 2 + grit * 0.08;
      setRgb(col, i, mortar[0] + (tone[0] * b - mortar[0]) * face, mortar[1] + (tone[1] * b - mortar[1]) * face, mortar[2] + (tone[2] * b - mortar[2]) * face);
      rough[i] = 0.82 + 0.1 * face + grit * 0.1;
    }
  }
  const ao = cavity(h, n, 3, 0.5);
  return pack(n, { col, h, strength: 1.2, ao, rough });
}

// Concrete double-roll pan tiles: `waves` across, `rows` courses (v 0 at the eaves' side: each
// course's lower edge stands proud with a shadowed lap under it). A neutral mid grey: the vertex
// tint gives black, brown or light grey. Satin. `relief` 0 keeps only the lap's line (for tile
// geometry that has its own rolls).
export function tilesSet(n = 512, { waves = 6, rows = 5, seed = 31, relief = 1 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const ww = n / waves;
  const rh = n / rows;
  const grainNoise = makeFbm(128, 2, seed);
  const blotNoise = makeFbm(12, 3, seed + 9);
  for (let y = 0; y < n; y++) {
    const row = Math.floor(y / rh);
    const ly = (y - row * rh) / rh; // 0 at the course's lower (exposed) edge .. 1 under the next
    const jog = (hash(row, 3, seed) - 0.5) * 3; // pan tiles line up in columns, a little jitter
    for (let x = 0; x < n; x++) {
      const xo = x + jog;
      const lx = (((xo % ww) + ww) % ww) / ww;
      // The double roll: a big soft roll and a shallow pan (no sharp crease).
      const prof = 0.5 + 0.5 * Math.cos(lx * Math.PI * 2);
      const tileId = hash(Math.floor(xo / ww), row, seed);
      // Up the slope each course tilts (its lower nose proud), the nose rounded at ly 0.
      const lift = (1 - ly) * 1.6;
      const nose = ly < 0.08 ? Math.sin((ly / 0.08) * Math.PI * 0.5) : 1;
      const s = x / n;
      const t = y / n;
      const grain = grainNoise(s, t) - 0.5;
      const i = y * n + x;
      h[i] = (prof * 3.2 + lift) * nose * relief + (1 - relief) * (ly < 0.05 ? -1.2 * (1 - ly / 0.05) : 0) + grain * 0.25;
      // Charcoal concrete: a tone per tile, paler on the rolls' tops, darker in the pans and in
      // the lap's shadow (the dark line between courses), faint lichen.
      let v = (0.5 + 0.22 * tileId + grain * 0.12) * (0.82 + 0.3 * prof);
      if (ly < 0.12) v *= 0.55 + 0.45 * (ly / 0.12);
      if (ly > 0.8) v *= 1 - 0.6 * smooth(0.8, 0.9, ly) * (1 - relief * 0.5);
      const lich = smooth(0.66, 0.8, blotNoise(s, t));
      setRgb(col, i, v * (1 + lich * 0.35), v * (1 + lich * 0.32), v * (0.97 + lich * 0.12));
      rough[i] = 0.72 + 0.1 * tileId - 0.08 * prof + lich * 0.12 + grain * 0.06;
    }
  }
  const ao = cavity(h, n, 10, 0.18);
  return pack(n, { col, h, strength: 0.7, ao, rough });
}

// Asphalt: a dark matrix with light and dark aggregate, fine pits; rough.
export function asphaltSet(n = 512, { seed = 41, tone = 0.085 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const c = { f1: 0, f2: 0, id: 0 };
  const stones = makeCells(96, seed);
  const mottleNoise = makeFbm(4, 3, seed + 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const t = y / n;
      stones(s, t, c);
      const stone = smooth(0.42, 0.3, c.f1); // the aggregate (rounded tops)
      const kind = c.id;
      const fine = hash(x, y, seed + 9);
      let v = tone * (0.85 + 0.3 * mottleNoise(s, t));
      if (stone > 0.2) v = v * (1 - stone) + stone * (kind < 0.25 ? 0.2 : kind < 0.6 ? 0.12 : 0.06);
      v *= 0.92 + fine * 0.16;
      const i = y * n + x;
      h[i] = stone * 1.2 + (fine < 0.04 ? -0.8 : 0);
      setRgb(col, i, v, v * 0.99, v * 0.97);
      rough[i] = 0.92 - stone * 0.12 * (kind < 0.25 ? 1 : 0.4);
    }
  }
  const ao = cavity(h, n, 2, 0.4);
  return pack(n, { col, h, strength: 1.6, ao, rough });
}

// A lawn from above: short blades in several greens (a few dry ones), soft dark gaps between
// the tufts, a few fallen leaves (`leaves`: how many; 0 for the hedges' leafy mass).
export function grassSet(n = 512, { seed = 61, leaves = 0.6 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const ground = makeFbm(6, 3, seed);
  for (let i = 0; i < n * n; i++) {
    const m = ground((i % n) / n, Math.floor(i / n) / n);
    setRgb(col, i, 0.06 + 0.03 * m, 0.14 + 0.06 * m, 0.03);
    rough[i] = 0.95;
  }
  // Blades: short strokes in random directions, each lighter toward its tip.
  const R = rng(seed);
  const wrap = (v) => ((v % n) + n) % n;
  const count = Math.round(n * n * 0.09);
  for (let b = 0; b < count; b++) {
    const x0 = R() * n;
    const y0 = R() * n;
    const a = R() * Math.PI * 2;
    const len = 3 + R() * 7;
    const hue = R();
    const dry = R() < 0.08;
    const br = dry ? 0.26 : 0.07 + hue * 0.07;
    const bg = dry ? 0.24 : 0.18 + hue * 0.12;
    const bb = dry ? 0.08 : 0.03 + hue * 0.02;
    const ca = Math.cos(a) * len;
    const sa = Math.sin(a) * len;
    const steps = Math.ceil(len * 1.5);
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const i = wrap(Math.round(y0 + sa * f)) * n + wrap(Math.round(x0 + ca * f));
      const hh = 1 + f * 2 + R() * 0.3;
      if (hh > h[i]) {
        h[i] = hh;
        const lit = 0.85 + f * 0.3;
        setRgb(col, i, br * lit, bg * lit, bb * lit);
      }
    }
  }
  // Fallen leaves: small ellipses in browns, oranges and a few reds.
  const nl = Math.round(((n * n) / 4000) * leaves);
  for (let l = 0; l < nl; l++) {
    const cx = R() * n;
    const cy = R() * n;
    const rx = 3 + R() * 4;
    const ry = rx * (0.45 + R() * 0.2);
    const a = R() * Math.PI;
    const tone = R();
    const [lr, lg, lb] = tone < 0.4 ? [0.3, 0.12, 0.03] : tone < 0.75 ? [0.4, 0.2, 0.04] : [0.35, 0.05, 0.03];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const u = (dx * ca + dy * sa) / rx;
        const v = (-dx * sa + dy * ca) / ry;
        const e = u * u + v * v;
        if (e > 1) continue;
        const i = wrap(Math.round(cy + dy)) * n + wrap(Math.round(cx + dx));
        h[i] = 3.5 - e;
        setRgb(col, i, lr, lg, lb);
        rough[i] = 0.7;
      }
    }
  }
  const ao = cavity(h, n, 3, 0.3);
  for (let i = 0; i < n * n; i++) {
    const k = 0.75 + 0.25 * clamp01(h[i] / 3);
    col[i * 3] *= k;
    col[i * 3 + 1] *= k;
    col[i * 3 + 2] *= k;
  }
  return pack(n, { col, h, strength: 0.9, ao, rough });
}

// Concrete pavers: `cols` square slabs a side with mossy green joints (the dad's grass-paver
// path at 4; cobbles at 10).
export function paversSet(n = 512, { cols = 4, seed = 71 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const cw = n / cols;
  const jw = cw * 0.07;
  const mossNoise = makeFbm(8, 4, seed + 2);
  const gritNoise = makeFbm(64, 2, seed);
  const jointNoise = makeFbm(128, 1, seed + 8);
  for (let y = 0; y < n; y++) {
    const ly = y % cw;
    for (let x = 0; x < n; x++) {
      const lx = x % cw;
      const e = Math.min(lx, cw - lx, ly, cw - ly);
      const slab = smooth(jw * 0.5, jw * 1.3, e);
      const s = x / n;
      const t = y / n;
      const moss = mossNoise(s, t);
      const grit = gritNoise(s, t) - 0.5;
      const sid = hash(Math.floor(x / cw), Math.floor(y / cw), seed);
      const mossy = smooth(0.48, 0.7, moss + (1 - slab) * 0.5 + (e < cw * 0.2 ? 0.08 : 0));
      const g = 1 + grit * 0.25;
      const k = slab * (1 - mossy * 0.85);
      const gr = 0.05;
      const gg = 0.1 + moss * 0.05;
      const gb = 0.02;
      const i = y * n + x;
      setRgb(col, i, gr + ((0.28 + sid * 0.06) * g - gr) * k, gg + ((0.28 + sid * 0.05) * g - gg) * k, gb + ((0.25 + sid * 0.04) * g - gb) * k);
      h[i] = slab * 2 + grit * 0.4 + (1 - slab) * jointNoise(s, t) * 1.2;
      rough[i] = 0.85 + 0.1 * mossy;
    }
  }
  const ao = cavity(h, n, 4, 0.35);
  return pack(n, { col, h, strength: 1.3, ao, rough });
}

// Smooth white render: a fine trowelled grain.
export function renderSet(n = 256, { seed = 81 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const grainNoise = makeFbm(64, 3, seed);
  const waveNoise = makeFbm(6, 2, seed + 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const t = y / n;
      const g = grainNoise(s, t);
      const v = 0.8 + 0.06 * waveNoise(s, t) - 0.05 * g;
      const i = y * n + x;
      h[i] = g * 1.2;
      setRgb(col, i, v, v * 0.99, v * 0.97);
    }
  }
  return pack(n, { col, h, strength: 1.2, ao: null, rough: 0.88 });
}

// Soil with bark mulch chips and fallen red leaves (the trunks' and posts' rough brown too).
export function soilSet(n = 256, { seed = 91 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const c = { f1: 0, f2: 0, id: 0 };
  const chips = makeCells(24, seed);
  const mottleNoise = makeFbm(16, 3, seed + 1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const t = y / n;
      chips(s, t, c);
      const chip = smooth(0.15, 0.05, c.f2 - c.f1);
      const leaf = c.id > 0.82;
      const m = mottleNoise(s, t);
      let r = 0.06 + 0.05 * m;
      let g = 0.04 + 0.03 * m;
      let b = 0.025;
      if (leaf) [r, g, b] = c.id > 0.92 ? [0.32, 0.05, 0.03] : [0.22, 0.06, 0.03];
      const k = 1 - chip * 0.6;
      const i = y * n + x;
      setRgb(col, i, r * k, g * k, b * k);
      h[i] = (1 - chip) * (0.6 + c.id) + m;
      rough[i] = leaf ? 0.65 : 0.95;
    }
  }
  const ao = cavity(h, n, 3, 0.4);
  return pack(n, { col, h, strength: 1.5, ao, rough });
}

// Granite (the kerbs): a light grey speckled with black mica and white and pale pink feldspar.
export function graniteSet(n = 256, { seed = 51 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const c = { f1: 0, f2: 0, id: 0 };
  const grains = makeCells(48, seed);
  const mottleNoise = makeFbm(8, 3, seed + 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const t = y / n;
      grains(s, t, c);
      const k = c.id;
      const m = mottleNoise(s, t);
      const v = 0.85 + 0.3 * m;
      const [r, g, b] = k < 0.18 ? [0.04, 0.04, 0.045] : k < 0.35 ? [0.5, 0.42, 0.4] : k < 0.6 ? [0.42, 0.42, 0.42] : [0.28, 0.28, 0.29];
      const i = y * n + x;
      setRgb(col, i, r * v, g * v, b * v);
      h[i] = (c.f2 - c.f1) * 0.6 + m * 0.6;
      rough[i] = k < 0.18 ? 0.35 : 0.62;
    }
  }
  return pack(n, { col, h, strength: 0.8, ao: null, rough });
}

// Bark: vertical ridges between dark fissures, grey-brown, rough (the trunks and limbs); birch 1:
// a birch's chalky white with dark horizontal lenticels and black patches.
export function barkSet(n = 256, { seed = 151, birch = 0 } = {}) {
  const h = field(n);
  const col = rgbField(n);
  const rough = field(n);
  const ridgeNoise = makeFbm(12, 3, seed, 2);
  const fineNoise = makeFbm(48, 2, seed + 3);
  const patchNoise = makeFbm(4, 3, seed + 6);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const t = y / n;
      const i = y * n + x;
      const fine = fineNoise(s, t);
      if (birch) {
        const patch = smooth(0.6, 0.68, patchNoise(s, t));
        const v = 0.72 + 0.1 * fine;
        setRgb(col, i, v * (1 - patch * 0.92), v * (0.99 - patch * 0.92), v * (0.95 - patch * 0.9));
        h[i] = fine * 0.6 - patch * 0.5;
        rough[i] = 0.75 + 0.15 * patch;
      } else {
        const ridge = ridgeNoise(s, t);
        const fissure = smooth(0.42, 0.3, ridge);
        const v = (0.13 + 0.07 * fine) * (1 - 0.7 * fissure);
        setRgb(col, i, v, v * 0.82, v * 0.66);
        h[i] = (1 - fissure) * 3 + fine;
        rough[i] = 0.9;
      }
    }
  }
  if (birch) {
    // Lenticels: short dark dashes across the trunk (along u), in rows.
    const R = rng(seed + 9);
    for (let k = 0, count = Math.round((n * n) / 260); k < count; k++) {
      const cx = R() * n;
      const cy = R() * n;
      const len = 3 + R() * 9;
      for (let d = 0; d < len; d++) {
        for (const dy of [0, 1]) {
          const i = (((Math.round(cy) + dy) % n) * n) + (Math.round(cx + d) % n);
          setRgb(col, i, 0.05, 0.045, 0.04);
          h[i] = -0.6;
        }
      }
    }
  }
  const ao = cavity(h, n, 3, 0.3);
  return pack(n, { col, h, strength: 1.4, ao, rough });
}

// The leaf atlas's cells (u0, v0: each half the texture a side): rhodo (the rhododendron's
// whorls of long glossy leaves, a few yellowing), hedge (small dense leaves: the hedges, the
// thujas, the birches' tinted yellow), tree (sprays of rounded leaves, a quarter turning: the
// apple and the junction's trees), red (sprays of the red-leaf tree's dark purple-red leaves).
export const LEAF_CELLS = Object.freeze({ rhodo: [0, 0], hedge: [0.5, 0], tree: [0, 0.5], red: [0.5, 0.5] });

// A leaf's half width along it (u 0 at the stem .. 1 at the tip), in LEAF_STEPS.
const LEAF_STEPS = 256;
const LEAF_HALF = Float32Array.from({ length: LEAF_STEPS + 1 }, (_, i) => Math.sin(Math.PI * Math.pow(i / LEAF_STEPS, 0.8)));

// One leaf from its stem at (cx, cy) along angle a, len long and wid wide, into the cut-out's
// maps, clipped to the box [bx0, bx1) x [by0, by1).
function leaf(m, box, cx, cy, len, wid, a, c, gloss) {
  const { n, h, col, rough, alpha } = m;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Its box: from the stem to the tip, the width either side.
  const [ex, ey] = [cx + ca * len, cy + sa * len];
  const x0 = Math.max(box[0], Math.floor(Math.min(cx, ex) - wid - 1));
  const x1 = Math.min(box[1] - 1, Math.ceil(Math.max(cx, ex) + wid + 1));
  const y0 = Math.max(box[2], Math.floor(Math.min(cy, ey) - wid - 1));
  const y1 = Math.min(box[3] - 1, Math.ceil(Math.max(cy, ey) + wid + 1));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const u = (dx * ca + dy * sa) / len; // 0 at the stem .. 1 at the tip
      if (u < 0 || u > 1) continue;
      const v = (-dx * sa + dy * ca) / wid;
      const half = LEAF_HALF[Math.round(u * LEAF_STEPS)];
      if (Math.abs(v) > half) continue;
      const i = y * n + x;
      const dome = 1 - (v / half) ** 2;
      const rib = Math.abs(v) < 0.08;
      const hh = 2 + dome * 1.5 + (rib ? -0.3 : 0) + u * 0.5;
      if (alpha[i] > 0 && h[i] > hh) continue;
      h[i] = hh;
      alpha[i] = 1;
      const shade = 0.75 + 0.35 * dome + (rib ? 0.15 : 0);
      col[i * 3] = c[0] * shade;
      col[i * 3 + 1] = c[1] * shade;
      col[i * 3 + 2] = c[2] * shade;
      rough[i] = gloss;
    }
  }
}

// A thin line (a twig) of colour c into the cut-out's maps.
function twig(m, box, x0, y0, x1, y1, c, w) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
  for (let k = 0; k <= steps; k++) {
    const x = x0 + ((x1 - x0) * k) / steps;
    const y = y0 + ((y1 - y0) * k) / steps;
    for (let d = 0; d < w; d++) {
      const xi = Math.round(x + d * 0.5);
      const yi = Math.round(y);
      if (xi < box[0] || xi >= box[1] || yi < box[2] || yi >= box[3]) continue;
      const i = yi * m.n + xi;
      if (m.alpha[i] && m.h[i] > 1.5) continue;
      m.alpha[i] = 1;
      m.h[i] = 1.5;
      setRgb(m.col, i, c[0], c[1], c[2]);
      m.rough[i] = 0.85;
    }
  }
}

const cutout = (n) => ({ n, h: field(n), col: rgbField(n), rough: field(n), alpha: field(n) });

// The cut-out's maps, its background (where no leaf is) the dark green of a leafy mass's depths,
// with its coverage-keeping mips.
function packCutout(m, { strength, ao }) {
  const { n, col, alpha, rough } = m;
  for (let i = 0; i < n * n; i++) {
    if (alpha[i]) continue;
    col[i * 3] = 0.05;
    col[i * 3 + 1] = 0.08;
    col[i * 3 + 2] = 0.03;
    rough[i] = 0.8;
  }
  const set = pack(n, { col, alpha, h: m.h, strength, ao: cavity(m.h, n, ao[0], ao[1]), rough: m.rough });
  set.mips = coverageMips(set.albedo, n);
  return set;
}

export function leavesSet(n = 1024, { seed = 101 } = {}) {
  const m = cutout(n);
  const half = n / 2;
  const R = rng(seed);
  for (const [kind, [u0, v0]] of Object.entries(LEAF_CELLS)) {
    const [ox, oy] = [u0 * n, v0 * n];
    const pad = Math.max(2, half * 0.02);
    const box = [ox + pad, ox + half - pad, oy + pad, oy + half - pad];
    const at = (k) => [ox + half * (0.12 + 0.76 * R()), oy + half * (0.12 + 0.76 * R()), k];
    if (kind === 'rhodo') {
      for (let w = 0; w < 16; w++) {
        const [cx, cy] = at();
        const k = 5 + Math.floor(R() * 3);
        const a0 = R() * Math.PI * 2;
        for (let j = 0; j < k; j++) {
          const a = a0 + (j / k) * Math.PI * 2 + R() * 0.3;
          const t = R();
          const c = R() < 0.05 ? [0.42, 0.32, 0.04] : [0.06 + t * 0.05, 0.14 + t * 0.09, 0.04 + t * 0.03];
          leaf(m, box, cx, cy, half * (0.11 + R() * 0.04), half * 0.034, a, c, 0.45);
        }
      }
    } else if (kind === 'hedge') {
      for (let l = 0; l < 520; l++) {
        const [cx, cy] = at();
        const t = R();
        const len = half * (0.035 + R() * 0.02);
        leaf(m, box, cx, cy, len, len * 0.42, R() * Math.PI * 2, [0.07 + t * 0.06, 0.15 + t * 0.1, 0.035 + t * 0.03], 0.55);
      }
    } else {
      // Sprays: a twig aimed into the cell, leaves alternating along it.
      const red = kind === 'red';
      for (let k = 0; k < 12; k++) {
        const [x0, y0] = at();
        const a = Math.atan2(oy + half / 2 - y0, ox + half / 2 - x0) + (R() - 0.5) * 1.6;
        const len = half * (0.28 + R() * 0.14);
        const [x1, y1] = [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len];
        twig(m, box, x0, y0, x1, y1, red ? [0.08, 0.03, 0.03] : [0.09, 0.07, 0.05], 2);
        let side = R() < 0.5 ? -1 : 1;
        for (let f = 0.12; f < 1; f += 0.085) {
          const [px, py] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
          const t = R();
          const turn = R() < (red ? 0.15 : 0.25);
          const c = red ? (turn ? [0.5, 0.1, 0.03] : [0.16 + t * 0.14, 0.025 + t * 0.03, 0.03 + t * 0.03]) : turn ? [0.32, 0.2, 0.04] : [0.07 + t * 0.06, 0.15 + t * 0.1, 0.035 + t * 0.03];
          const ll = half * (0.075 + R() * 0.03) * (1 - f * 0.35);
          leaf(m, box, px, py, ll, ll * (red ? 0.42 : 0.5), a + side * (0.55 + R() * 0.45), c, red ? 0.5 : 0.6);
          side = -side;
        }
      }
    }
  }
  return packCutout(m, { strength: 1.2, ao: [6, 0.25] });
}

// A spruce branch for the fir cards: a twig from u 0 (the trunk) to u 1 drooping a little, side
// twigs angled forward, all thick with short needles (dark blue-green, paler new growth at the
// tips).
export function firSet(n = 256, { seed = 141 } = {}) {
  const m = cutout(n);
  const box = [1, n - 1, 1, n - 1];
  const R = rng(seed);
  const line = (x0, y0, x1, y1, c, hh) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / steps);
      const y = Math.round(y0 + ((y1 - y0) * k) / steps);
      if (x < box[0] || x >= box[1] || y < box[2] || y >= box[3]) continue;
      const i = y * n + x;
      if (m.alpha[i] && m.h[i] > hh) continue;
      m.alpha[i] = 1;
      m.h[i] = hh;
      setRgb(m.col, i, c[0], c[1], c[2]);
      m.rough[i] = 0.8;
    }
  };
  const branch = (x0, y0, ang, len, depth) => {
    const segs = Math.ceil(len / 3);
    let [x, y] = [x0, y0];
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      const a = ang + (R() - 0.5) * 0.08;
      const [nx, ny] = [x + Math.cos(a) * (len / segs), y + Math.sin(a) * (len / segs)];
      line(x, y, nx, ny, [0.05, 0.035, 0.02], 1.5);
      const nl = (depth ? 5 : 7) * (1 - 0.45 * t) * (n / 256);
      for (const side of [-1, 1]) {
        for (let q = 0; q < 2; q++) {
          const na = a + side * (0.9 + R() * 0.4);
          const tip = t > 0.8 && R() < 0.6;
          const g = R();
          const c = tip ? [0.1 + g * 0.04, 0.2 + g * 0.06, 0.06] : [0.025 + g * 0.02, 0.06 + g * 0.04, 0.035 + g * 0.02];
          line(nx, ny, nx + Math.cos(na) * nl, ny + Math.sin(na) * nl, c, 2 + R());
        }
      }
      [x, y] = [nx, ny];
    }
  };
  const len = n * 0.92;
  branch(2, n * 0.5, 0.06, len, 0);
  for (let k = 0; k < 9; k++) {
    const t = 0.08 + (k / 9) * 0.82;
    for (const side of [-1, 1]) branch(2 + len * t, n * 0.5 + len * t * 0.06, side * (0.75 + R() * 0.25), n * 0.38 * (1 - t * 0.6) * (0.8 + R() * 0.3), 1);
  }
  return packCutout(m, { strength: 1, ao: [4, 0.3] });
}

export const GENERATORS = Object.freeze({ boards: boardsSet, brick: brickSet, tiles: tilesSet, asphalt: asphaltSet, grass: grassSet, pavers: paversSet, render: renderSet, soil: soilSet, granite: graniteSet, bark: barkSet, leaves: leavesSet, fir: firSet });

export function generate({ kind, size, opts = {} }) {
  const fn = GENERATORS[kind];
  if (!fn) throw new Error(`texgen: no generator '${kind}'`);
  return fn(size, opts);
}
