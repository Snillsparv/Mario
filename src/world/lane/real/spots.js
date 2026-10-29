// Where Sparrow Lane's forest stands (lane/layout.js FOREST, EDGE_FOREST), as one pure list, so the
// classic builder (lane/props.js forest) and the realistic look's worker (world/lane/real/foliage.js:
// card crowns; the spruces instanced, detail.js) plant the very same trees.
//
//   forestSpots(L) -> { firs, bank, birches, broad, pines }   (memoised per layout)
//     firs:    [{ x, z, base, h, r, a0 }]   the spruces: the bank's `bank` first, then the edge's
//     birches: [{ x, z, base, h, r, seed }]
//     broad:   [{ x, z, base, h, r, seed, solid? }]   oaks and aspens (rounded crowns r across)
//     pines:   [{ x, z, base, h, r, seed, solid? }]   Scots pines (a bare trunk, a flat crown r
//              across at the top)
//     h:       each tree's top over its foot (base); solid: a side yard's (its trunk a collider);
//              bank: on the bank behind the north gardens (seen only from the lane, far)
//
// W7 (photos 01, 09, 12, 24-31, 41-44): a tall continuous mixed canopy instead of the sparse
// short firs, its tops 16-21 m over the street (FOREST.top: under the shadows' box's top,
// look.js FAR_TOP); on the bank behind the north gardens rows of crowns that touch (FOREST.rows:
// each a share of the band's depth and a spacing along it, jittered), every spot a kind drawn by
// FOREST.mix (broadleaf, birch, pine, spruce: ~55 % broadleaf, ~30 % Scots pine, ~15 % spruce);
// a few in the side yards between the villas (FOREST.yards: solid trunks beside the yards' walking
// lines, off every route); the trees named in FOREST.special (a tall pine right behind north_1,
// one beyond the double garage, the big broadleaf south-east of the turning area by the footpath,
// out of bounds); the ring round the
// outside of the boundary (EDGE_FOREST: each a seeded way out from a seeded point on one of its
// edges, kept off the road drawn on past it, the bank and its clear sector) by its own mix (and
// in its `low` sector, south-east, lower trees by that sector's own mix, tops and least height).

import { makeRng } from '../../../core/math.js';
import { VERANDA_HOUSE, BACKDROP, LAYBY } from '../ends.js';

// Crown sizes per kind: r [min, max] (a spruce's its skirt's radius; a pine's its flat crown's),
// and the least height.
const KINDS = { broad: { r: [520, 760], h: 1400 }, birch: { r: [320, 460], h: 1300 }, pine: { r: [420, 600], h: 1500 }, spruce: { r: [260, 400], h: 900 } };
const ORDER = ['broad', 'birch', 'pine', 'spruce'];

const MEMO = new WeakMap();
export function forestSpots(L) {
  if (MEMO.has(L)) return MEMO.get(L);
  const { FOREST: F, EDGE_FOREST: E, BOUNDS } = L;
  const out = { firs: [], bank: 0, birches: [], broad: [], pines: [] };
  const into = { broad: out.broad, birch: out.birches, pine: out.pines, spruce: out.firs };
  const rng = makeRng(F.seed);
  const pick = (mix, r) => {
    let v = r * mix.reduce((s, m) => s + m, 0);
    for (let i = 0; i < mix.length; i++) if ((v -= mix[i]) < 0) return ORDER[i];
    return ORDER.at(-1);
  };
  const plant = (kind, x, z, top, r, extra = {}, least = KINDS[kind].h) => {
    const K = KINDS[kind];
    const base = L.groundHeight(x, z) - 10;
    const h = Math.max(least, top - base);
    const rr = K.r[0] + r() * (K.r[1] - K.r[0]);
    // (A spruce no wider than a fifth of its height; the others' crowns as they come.)
    const spot = { x, z, base, h, r: kind === 'spruce' ? Math.min(rr, h * 0.2) : rr, ...extra };
    if (kind === 'spruce') spot.a0 = r();
    else spot.seed = Math.floor(r() * 1e6);
    into[kind].push(spot);
  };
  const tops = (T, r) => T[0] + r() * (T[1] - T[0]);
  // (The band's z follows the gardens' sloping back edge: F.slope per unit x.)
  const band = (x, r) => F.z0 + F.slope * x + r * (F.z1 - F.z0);
  for (const [a, b, step] of F.rows) {
    for (let x = F.x0 + rng() * step; x < F.x1; x += step * (0.8 + 0.4 * rng())) {
      const kind = pick(F.mix, rng());
      plant(kind, x, band(x, a + (b - a) * rng()), tops(F.top, rng), rng, { bank: true });
    }
  }
  for (const s of F.special) plant(s.kind, s.x, s.z, s.top, rng, s.r ? { r: s.r } : {});
  for (const [x, z, kind, top] of F.yards) plant(kind, x, z, top, rng, { solid: true });
  out.bank = out.firs.length;
  const er = makeRng(E.seed);
  const edges = BOUNDS.map((p, i) => [p, BOUNDS[(i + 1) % BOUNDS.length]]);
  const lengths = edges.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const total = lengths.reduce((s, l) => s + l, 0);
  for (let i = 0, tries = 0; i < E.count && tries < E.count * 6; tries++) {
    let pickAt = er() * total;
    let k = 0;
    while (pickAt > lengths[k]) pickAt -= lengths[k++];
    const [p, q] = edges[k];
    const t = pickAt / lengths[k];
    const away = E.from + er() * (E.to - E.from);
    // The edge's outward normal (the polygon runs clockwise seen from above: out is its left).
    const nx = (q[1] - p[1]) / lengths[k];
    const nz = -(q[0] - p[0]) / lengths[k];
    const x = p[0] + (q[0] - p[0]) * t + nx * away;
    const z = p[1] + (q[1] - p[1]) * t + nz * away;
    if (L.inBounds(x, z) || L.roadDistance(x, z, oldDrawn(L)) < L.ROAD.half + 300 || (x > F.x0 && z < band(x, 0))) continue;
    const lo = E.low && x > E.low.x0 && z > E.low.z0 ? E.low : null;
    const kind = pick(lo?.mix ?? E.mix, er());
    const top = tops(lo ? lo.top : E.top, er);
    // (In the clear sector the spot is drawn and dropped: the ring's others keep their places.)
    const c = E.clear;
    const cleared = c && x > c.x0 && x < c.x1 && z > c.z0;
    if (!cleared && offTheEnds(L, x, z)) {
      er(); // (W8: dropped with plant's own two draws: the ring's later spots keep their trees)
      er();
    } else if (!cleared) {
      plant(kind, x, z, top, er, {}, lo ? Math.min(lo.least, KINDS[kind].h) : KINDS[kind].h);
      if (lo) into[kind].at(-1).r *= lo.r;
    }
    i++;
  }
  MEMO.set(L, out);
  return out;
}

// (W8: the road drawn on past the junction as it ran before (straight, 2860 on) decides which
// spots of the ring are drawn at all, so their trees keep their places (P1: the far tree line,
// which it decided too, gone); the
// spots on the curve it runs on now, its lay-by, by the veranda house and the far houses are
// drawn and dropped, as the clear sector's.)
function oldDrawn(L) {
  const [[ax, az], [bx, bz]] = L.ROAD.line;
  const l = Math.hypot(ax - bx, az - bz);
  return [[ax + ((ax - bx) / l) * 2860, az + ((az - bz) / l) * 2860], ...L.ROAD.line];
}
export function offTheEnds(L, x, z, pad = 300) {
  if (L.roadDistance(x, z, L.ROAD_DRAWN) < L.ROAD.half + pad) return true;
  const near = (h, r) => Math.hypot(x - h.cx, z - h.cz) < Math.hypot(h.w, h.d) / 2 + r;
  if (near(VERANDA_HOUSE, pad) || BACKDROP.some((h) => near(h, pad))) return true;
  return LAYBY.pts.some(([px, pz]) => Math.hypot(x - px, z - pz) < 600);
}
