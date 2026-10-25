// The realistic look's plants (world/lane/real/detail.js builds them in the worker; the classic
// builders keep every collider): leaf cards over the classic shapes, so each plant stands where
// its classic blob stood and Jonas meets it where he always did.
//
//   plants(kit, L)          // the hedges, the thujas, the junction's trees, the garden trees
//                           // (apple, birch, shrub), the dad's red-leaf tree, the rhododendron,
//                           // the pot by the door, the flower beds, the forest's birches, the
//                           // climber at the gable's back corner, the columnar tree; kit:
//                           // detail.js's Geo per material (foliage, core, bark, birch, paint,
//                           // enamel)
//   boxPlants(kit, spots, seed)   // a balcony box's leafy tufts and geraniums (villas.js)
//   firGeometry(tier, seed, shape) -> { leaves, core }   // one spruce (unit radius and
//                           // height, its foot at 0): Geos (the core its dark inner cone and
//                           // its trunk); shape: FIR_SHAPES.A (the forest's) or .B (the edge's
//                           // on high: more tiers, a hanging skirt, gaps)
//   firInstances(L, from, to) -> { matrices, colors }   // the forest's firs (spots.js; a range
//                           // of them), a matrix and a tint each
//
// A plant is clusters of two crossed cards (the leaf atlas's cells: texgen/sets.js LEAF_CELLS)
// on a shell: an ellipsoid (the bushes, each blob of a canopy), a box (the hedges) or a column
// (the thujas). Each card leans out of its shell, its normal bent out of the plant's middle and
// up (the mass shades as a volume), darker and duller the deeper and lower it sits; a dark core
// inside stops the sky showing through where a real bush is dense. A canopy's clusters inside
// another of its blobs are left out (only the canopy's outside is leafy). The cards' tips sway in
// the wind (`sway`, units: more on the trees than the bushes); mid tier 70 % of the clusters (the
// hedges' cards a little farther apart), low half.

import { makeRng } from '../../../core/math.js';
import { Geo, add, mul, sub, dot, cross, norm } from './geo.js';
import { forestSpots } from './spots.js';
import { redTreeStems, redTreeCrown, ivyMasses, climberMasses } from './plan.js';

// The leaf atlas's cells (texgen/sets.js LEAF_CELLS: each half the atlas a side).
const CELL = { rhodo: [0, 0], hedge: [0.5, 0], tree: [0, 0.5], red: [0.5, 0.5] };
const CORE = { green: [0.03, 0.055, 0.018], red: [0.045, 0.012, 0.012] };
// The hedges' cores a little lighter (under the ambient occlusion they read black-green).
const HEDGE_CORE = [0.05, 0.062, 0.02];
// The share of a shell's clusters per tier (mid a little sparser, low half); the broad trees',
// the birches' and the apple tree's canopies denser still on high (their outline from afar was
// the most "game" thing left in the street).
const CLUSTERS = { high: 1, mid: 0.7, low: 0.5 };
const DENSE = { high: 1.4, mid: 1, low: 1 };
const BARK = 0xb8aca0;
const BIRCH_BARK = 0xf4f2ec;

// Two crossed cards at c leaning out along d (unit), `size` across, from cell `cell`, the
// normals bent out (+ up): into g at its current colour (one card: `cards` 1, the hedges').
function cluster(g, R, c, d, size, cell, sway, cards = 2) {
  const n0 = norm(add(d, [0, 0.35, 0]));
  const helper = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0 = norm(cross(d, helper));
  const v0 = norm(cross(d, u0));
  const [cu, cv] = cell;
  const uvs = [[cu, cv], [cu + 0.5, cv], [cu + 0.5, cv + 0.5], [cu, cv + 0.5]];
  for (let q = 0; q < cards; q++) {
    const rot = R() * Math.PI + q * (Math.PI / 2);
    const uu = add(mul(u0, Math.cos(rot)), mul(v0, Math.sin(rot)));
    // Spanned by uu and a line between the shell's tangent and d: the card leans out.
    const vv = norm(add(mul(cross(uu, d), 0.85), mul(d, 0.55)));
    const u = mul(uu, size / 2);
    const v = mul(vv, size / 2);
    const p = (a, b) => add(add(c, mul(u, a)), mul(v, b));
    const nn = () => norm(add(n0, [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3]));
    // Its root edge (b -1) hardly moves, its far edge sways.
    const P = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
    const N = [nn(), nn(), nn(), nn()];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      g.sway = i >= 2 ? sway : sway * 0.25;
      g.vertex(P[i], N[i], uvs[i]);
    }
  }
  g.sway = 0;
}

// Clusters on an ellipsoid's skin: `count` of them `size` across, out of `outside` (other
// ellipsoids of the same canopy: clusters inside them are left out), its tints [[r, g, b]] by
// turns at random, darker deep and low; and its dark core.
function shell(kit, R, { c, r, count, size, cell, tints, below = -0.15, outside = [], sway = 3, core = CORE.green, coreK = 0.78 }) {
  const { foliage } = kit;
  const n = Math.round(count * (CLUSTERS[kit.tier] ?? 1));
  for (let i = 0; i < n; i++) {
    let d;
    do d = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1];
    while (dot(d, d) > 1 || dot(d, d) < 0.01 || d[1] < below);
    d = norm(d);
    const depth = 0.72 + 0.3 * Math.sqrt(R());
    const p = [c[0] + d[0] * r[0] * depth, c[1] + d[1] * r[1] * depth, c[2] + d[2] * r[2] * depth];
    if (outside.some((o) => ((p[0] - o.c[0]) / o.r[0]) ** 2 + ((p[1] - o.c[1]) / o.r[1]) ** 2 + ((p[2] - o.c[2]) / o.r[2]) ** 2 < 0.8)) continue;
    const t = tints[Math.floor(R() * tints.length)];
    const k = (0.55 + 0.45 * ((depth - 0.72) / 0.3)) * (0.72 + 0.28 * (d[1] * 0.5 + 0.5)) * (0.85 + 0.3 * R());
    foliage.rgb(t[0] * k, t[1] * k, t[2] * k);
    cluster(foliage, R, p, d, size * (0.75 + 0.5 * R()), cell, sway);
  }
  if (core) {
    kit.core.rgb(...core);
    kit.core.ellipsoid(c, [1, 0, 0], [0, 1, 0], [0, 0, 1], r[0] * coreK, r[1] * coreK, r[2] * coreK, 10, 6);
  }
}

// A canopy's blobs as the classic one draws them (lane/props.js canopy: the same seeded stream),
// each { c, r } (the blob's middle and radii).
function canopyBlobs(x, z, y0, y1, r, seed, n = 4) {
  const rng = makeRng(seed);
  const h = y1 - y0;
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const off = i === 0 ? 0 : r * (0.35 + rng() * 0.2);
    const br = i === 0 ? r * 0.62 : r * (0.45 + rng() * 0.15);
    const cy = i === 0 ? y0 + h * 0.5 : y0 + h * (0.35 + rng() * 0.3);
    const ry = i === 0 ? h * 0.5 : h * (0.32 + rng() * 0.1);
    rng(); // (its shade)
    rng(); // (its turn)
    blobs.push({ c: [x + Math.sin(a) * off, cy, z + Math.cos(a) * off], r: [br, ry, br] });
  }
  return blobs;
}

// A few smaller blobs round a canopy's outline (their own seeded stream: the classic blobs stay
// where the classic builder's stood), so it reads ragged instead of a lollipop: n of them on the
// biggest blob's skin, between a quarter and two-fifths of the canopy's radius each.
function ragged(blobs, n, seed, tier = 'high') {
  if (tier === 'low') return blobs; // (the phones' canopies as they were)
  const rng = makeRng(seed);
  const [main] = blobs;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 1.2;
    const up = -0.15 + rng() * 0.75;
    const r = main.r[0] * (0.42 + rng() * 0.25);
    const k = 0.95 + rng() * 0.25;
    out.push({ c: [main.c[0] + Math.sin(a) * main.r[0] * k * Math.cos(up), main.c[1] + Math.sin(up) * main.r[1] * k, main.c[2] + Math.cos(a) * main.r[2] * k * Math.cos(up)], r: [r, r * (0.7 + rng() * 0.3), r], outer: true });
  }
  return [...blobs, ...out];
}

// A canopy: every blob's shell (only outside the others), cluster counts by its skin's area.
function canopy(kit, R, blobs, { size, cell, tints, density = 1.2, below = -0.4, sway = 8, core = CORE.green }) {
  for (const b of blobs) {
    const [a, h, c] = b.r;
    const area = 4 * Math.PI * Math.pow(((a * h) ** 1.6 + (a * c) ** 1.6 + (h * c) ** 1.6) / 3, 1 / 1.6);
    const count = Math.round((area / (size * size)) * density);
    // (A ragged canopy's small outer blobs no core of their own: the light shows through them.)
    shell(kit, R, { c: b.c, r: b.r, count, size, cell, tints, below, outside: blobs.filter((o) => o !== b), sway, core: b.outer ? null : core, coreK: 0.72 });
  }
}

// Limbs from a trunk's top (p) out and up into each blob, tapering.
function limbs(g, p, blobs, r) {
  for (const b of blobs) {
    const q = [b.c[0] + (b.c[0] - p[0]) * 0.25, b.c[1] + b.r[1] * 0.1, b.c[2] + (b.c[2] - p[2]) * 0.25];
    if (Math.hypot(q[0] - p[0], q[2] - p[2]) < r) q[1] = b.c[1] + b.r[1] * 0.4;
    g.tube(p, q, r, r * 0.35, 6);
  }
}

export function plants(kit, L) {
  const R = makeRng(4242);
  const G = L.GROUND;
  const leafy = [[1, 1.04, 0.92], [0.86, 0.95, 0.8], [1.08, 1.1, 0.9]];
  // The hedges: cards over their faces and tops round a dark box.
  for (const h of L.HEDGES) hedge(kit, R, h);
  // The thujas: dark green columns.
  for (const t of L.THUJAS) thuja(kit, R, L, t);
  // The junction's trees.
  for (const t of L.TREES) {
    const y0 = L.groundHeight(t.x, t.z);
    const top = y0 + t.h * 0.45;
    kit.bark.color(BARK);
    kit.bark.tube([t.x, y0 - 10, t.z], [t.x, top, t.z], 60, 36, 8);
    const blobs = ragged(canopyBlobs(t.x, t.z, y0 + t.h * 0.32, y0 + t.h, t.r, Math.round(t.x * 7 + t.z)), 6, Math.round(t.x * 3 - t.z), kit.tier);
    limbs(kit.bark, [t.x, top - 20, t.z], blobs, 26);
    canopy(kit, R, blobs, { size: 130, cell: CELL.tree, tints: leafy, sway: 10, density: 1.2 * (DENSE[kit.tier] ?? 1) });
  }
  for (const t of L.GARDEN_TREES) gardenTree(kit, R, L, t);
  redTree(kit, R, L);
  // The rhododendron out from the west pier, its leaves down to the ground (W3: bigger, longer
  // across the lawn, lumpy, a dark glossy green with a few yellowing leaves): a main mass and a
  // lump at each end along it.
  const rh = L.RHODODENDRON;
  const rhodo = [[0.9, 1, 0.8], [0.72, 0.82, 0.66], [0.98, 1.04, 0.82], [0.85, 0.95, 0.75], [1.5, 1.35, 0.6]].map(([r, g, b]) => [r * 0.7, g * 0.72, b * 0.62]);
  const lumps = [
    { c: [rh.x, G + rh.h * 0.36, rh.z], r: [rh.rx, rh.h * 0.66, rh.rz * 0.8], n: 560 }, // (a dome on the ground, not a ball)
    { c: [rh.x - rh.rx * 0.15, G + rh.h * 0.34, rh.z - rh.rz * 0.55], r: [rh.rx * 0.72, rh.h * 0.4, rh.rz * 0.42], n: 140 },
    { c: [rh.x + rh.rx * 0.2, G + rh.h * 0.6, rh.z + rh.rz * 0.42], r: [rh.rx * 0.7, rh.h * 0.42, rh.rz * 0.42], n: 120 },
  ];
  for (const m of lumps) shell(kit, R, { c: m.c, r: m.r, count: m.n, size: 80, cell: CELL.rhodo, tints: rhodo, below: -0.8, sway: 2, outside: lumps.filter((o) => o !== m) });
  // The pot on the landing: a glazed blue pot, a little leafy plant in it.
  const P = L.POT;
  const pg = L.LANDING.top;
  kit.enamel.color(0x2e5f92);
  kit.enamel.loft([[16, pg], [24, pg + 4], [27, pg + 36], [28, pg + 40], [24, pg + 40]].map(([r, y]) => ring(P.x, y, P.z, r, 12)), { capStart: true });
  kit.core.rgb(0.05, 0.035, 0.02);
  kit.core.cyl('y', pg + 36, pg + 37, P.x, P.z, 24, 12, { caps: true });
  shell(kit, R, { c: [P.x, pg + 62, P.z], r: [30, 26, 30], count: 34, size: 26, cell: CELL.hedge, tints: leafy, below: -0.3, sway: 1 });
  ivy(kit, L);
  rose(kit, L);
  for (const b of L.FLOWER_BEDS) flowerBed(kit, R, L, b);
  // The forest's birches.
  for (const t of forestSpots(L).birches) birch(kit, R, t.x, t.z, t.base, t.h, t.r, t.seed);
  // (W4: their own streams, the others' kept.)
  climber(kit, L);
  for (const t of L.COLUMN_TREES ?? []) column(kit, L, t);
}

// The climber up the dad's gable's back corner and over the garage row's west end (CLIMBER, W4):
// small dark evergreen leaves, a little lighter where the low sun catches them; cards per tier.
const CLIMBER_CARDS = { high: 330, mid: 200, low: 50 };
function climber(kit, L) {
  const S = makeRng(9311);
  const n = CLIMBER_CARDS[kit.tier] ?? CLIMBER_CARDS.high;
  const k = CLUSTERS[kit.tier] ?? 1;
  const tints = [[0.22, 0.25, 0.14], [0.17, 0.2, 0.11], [0.3, 0.34, 0.18], [0.26, 0.3, 0.13]];
  const masses = climberMasses(L);
  const total = masses.reduce((a, m) => a + m.r[0] * m.r[1] + m.r[2] * m.r[1], 0);
  for (const m of masses) shell(kit, S, { c: m.c, r: m.r, count: Math.round((n * (m.r[0] + m.r[2]) * m.r[1]) / total / k), size: 30, cell: CELL.rhodo, tints, below: -0.9, sway: 1, outside: masses.filter((o) => o !== m), coreK: 0.75 });
}

// The columnar tree far behind the garage row (COLUMN_TREES, W4: out of bounds; W4 fix: the
// Lombardy poplar photo 37 shows over the row): a short trunk parting low into upright leaders
// (hidden in the leaves but where the sky shows through), the leaves in loose clumps over the
// crown, the outer ones poking past its outline: a slim, lacy column, widest low, ragged at its
// top, the sky through its gaps (no solid core: the old one's smooth frustum read as an ivy-clad
// chimney). Olive leaves, yellowing toward its top. Cards per tier (POPLAR); the crown's outline
// (CROWN: its radius, a share of r, at a share of h).
const POPLAR = { high: 2000, mid: 1400, low: 900 };
const CROWN = [[0.12, 0], [0.5, 0.16], [0.85, 0.3], [0.95, 0.42], [0.8, 0.49], [0.66, 0.55], [0.6, 0.65], [0.56, 0.75], [0.5, 0.83], [0.44, 0.9], [0.38, 0.95], [0.28, 0.985], [0.1, 1]];
function column(kit, L, { x, z, r, h }) {
  const S = makeRng(9377);
  const y0 = L.groundHeight(x, z);
  const crown = (f) => {
    for (let i = 0; i + 1 < CROWN.length; i++) {
      const [[ra, fa], [rb, fb]] = [CROWN[i], CROWN[i + 1]];
      if (f <= fb) return (ra + ((rb - ra) * (Math.max(f, 0) - fa)) / (fb - fa)) * r;
    }
    return 0;
  };
  // The trunk and the leaders up from its top, each leaning out toward its own side.
  const fork = h * 0.14;
  kit.bark.color(0x8a8278);
  kit.bark.tube([x, y0 - 10, z], [x, y0 + fork + 20, z], r * 0.09, r * 0.07, 7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + S() * 0.7;
    const tip = i === 0 ? 0.75 : 0.5 + 0.2 * S();
    const out = i === 0 ? 0.05 : 0.2 + 0.25 * S();
    let p = [x, y0 + fork, z];
    [0.3, 0.5, tip].forEach((f, j) => {
      const o = crown(f) * out;
      const q = [x + Math.sin(a) * o, y0 + f * h, z + Math.cos(a) * o];
      kit.bark.tube(p, q, r * (0.03 - j * 0.008), r * (0.022 - j * 0.006), 5);
      p = q;
    });
  }
  // The leaves: clumps over the crown (more where it is wide; the outer ones the most), each a
  // dozen cards round its middle, a few past the outline (its ragged lumps); darker deep inside
  // and low, yellower toward the top.
  // (Dark: seen ~35 m off through the haze, which brings its own pale blue to it.)
  const tints = [[0.95, 0.9, 0.42], [0.82, 0.82, 0.38], [1.1, 0.96, 0.4], [0.9, 0.86, 0.48]].map((t) => [t[0] * 0.42, t[1] * 0.4, t[2] * 0.28]);
  const count = POPLAR[kit.tier] ?? POPLAR.high;
  const per = 12;
  const area = (f) => crown(f) / r;
  for (let c = 0; c < count / per; c++) {
    let f;
    do f = 0.12 + 0.87 * S();
    while (S() > 0.35 + 0.65 * area(f)); // (the slim top a little denser than its share)
    const lim = crown(f);
    const a = S() * Math.PI * 2;
    const rho = lim * (0.4 + 0.55 * Math.sqrt(S()));
    const m = [x + Math.sin(a) * rho, y0 + f * h, z + Math.cos(a) * rho];
    const cr = lim * (0.34 + 0.12 * S());
    const deep = rho / Math.max(1, lim);
    const t = tints[Math.floor(S() * tints.length)];
    for (let k = 0; k < per; k++) {
      let d;
      do d = [S() * 2 - 1, S() * 2 - 1, S() * 2 - 1];
      while (dot(d, d) > 1 || dot(d, d) < 0.05);
      let p = [m[0] + d[0] * cr, m[1] + d[1] * cr * 1.7, m[2] + d[2] * cr];
      const fy = Math.min(1, Math.max(0, (p[1] - y0) / h));
      const ax = [p[0] - x, p[2] - z];
      const dist = Math.hypot(ax[0], ax[1]);
      const edge = crown(fy) * 1.08;
      if (dist > edge) p = [x + (ax[0] / dist) * edge, p[1], z + (ax[1] / dist) * edge];
      const out = dist > 1 ? [ax[0] / dist, 0, ax[1] / dist] : [Math.sin(a), 0, Math.cos(a)];
      const dd = norm([out[0] + d[0] * 0.6, 0.35 + 0.35 * fy, out[2] + d[2] * 0.6]);
      const kk = (0.5 + 0.5 * Math.min(1, dist / Math.max(1, edge))) * (0.75 + 0.35 * fy) * (0.88 + 0.24 * S()) * (0.9 + 0.1 * deep);
      const yel = 1 + 0.22 * fy * fy;
      kit.foliage.rgb(t[0] * kk * yel, t[1] * kk * (1 + 0.08 * fy * fy), t[2] * kk);
      cluster(kit.foliage, S, p, dd, r * (0.24 + 0.14 * S()) * (1 - 0.3 * fy), CELL.tree, 4);
    }
  }
}

// A ring of `sides` points round (x, z) at y, radius r (counter-clockwise seen from below:
// a loft from the bottom up faces out).
function ring(x, y, z, r, sides) {
  return Array.from({ length: sides }, (_, i) => {
    const a = -(i / sides) * Math.PI * 2;
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  });
}

function hedge(kit, R, h) {
  const { foliage, core } = kit;
  // (The long hedges behind the houses a little coarser.)
  const step = (kit.tier === 'low' ? 36 : kit.tier === 'mid' ? 29 : 25) * (h.x1 - h.x0 > 4000 ? 1.3 : 1);
  const tint = () => {
    const k = 0.8 + 0.35 * R();
    foliage.rgb(1.35 * k, 1 * k, 0.5 * k); // (an autumn olive, as the photos' hedges)
  };
  const card = (c, n, s) => {
    tint();
    cluster(foliage, R, c, norm(n), s, CELL.hedge, 1.5, 1);
  };
  const jit = () => (R() - 0.5) * step;
  const top = h.top + 8;
  for (let x = h.x0; x <= h.x1; x += step) {
    for (let y = h.y0 + 12; y <= top; y += step) {
      card([x + jit(), y + jit() * 0.5, h.z0 + 4 + R() * 6], [0, 0.1, -1], 50);
      card([x + jit(), y + jit() * 0.5, h.z1 - 4 - R() * 6], [0, 0.1, 1], 50);
    }
    for (let z = h.z0 + step / 2; z <= h.z1; z += step) card([x + jit(), top - 6 + R() * 8, z + jit() * 0.6], [0, 1, 0], 52);
  }
  for (const [xe, s] of [[h.x0, -1], [h.x1, 1]]) {
    for (let z = h.z0; z <= h.z1; z += step) for (let y = h.y0 + 12; y <= top; y += step) card([xe + s * (4 + R() * 6), y, z + jit() * 0.6], [s, 0.1, 0], 50);
  }
  core.rgb(...HEDGE_CORE);
  core.box(h.x0 + 8, h.x1 - 8, h.y0 - 4, top - 14, h.z0 + 8, h.z1 - 8, { skip: 'b' });
}

function thuja(kit, R, L, { x, z }) {
  const { r, h } = L.THUJA;
  const y0 = L.groundHeight(x, z);
  // The classic column's radius at each height (lane/props.js thuja).
  const prof = [[r * 0.8, 0], [r, h * 0.3], [r * 0.82, h * 0.7], [r * 0.3, h * 0.94], [0, h]];
  const radius = (y) => {
    for (let i = 0; i + 1 < prof.length; i++) {
      const [[ra, ya], [rb, yb]] = [prof[i], prof[i + 1]];
      if (y <= yb) return ra + ((rb - ra) * (y - ya)) / (yb - ya);
    }
    return 0;
  };
  const count = kit.tier === 'low' ? 110 : 220;
  for (let i = 0; i < count; i++) {
    const y = h * Math.pow(R(), 0.85) * 0.97;
    const a = R() * Math.PI * 2;
    const rr = radius(y) * (0.85 + 0.2 * R());
    const d = norm([Math.sin(a), 0.25 + (y / h) * 0.5, Math.cos(a)]);
    const k = (0.6 + 0.4 * (y / h)) * (0.85 + 0.3 * R());
    kit.foliage.rgb(0.62 * k, 0.6 * k, 0.3 * k);
    cluster(kit.foliage, R, [x + Math.sin(a) * rr, y0 + y, z + Math.cos(a) * rr], d, 46 * (0.8 + 0.4 * R()), CELL.hedge, 2);
  }
  kit.core.rgb(...CORE.green);
  kit.core.loft(prof.slice(0, 4).map(([pr, py]) => ring(x, y0 + py, z, pr * 0.72, 8)), { capEnd: true });
}

function gardenTree(kit, R, L, t) {
  const y0 = L.groundHeight(t.x, t.z);
  if (t.kind === 'birch') {
    birch(kit, R, t.x, t.z, y0, t.h, t.r, 7);
    return;
  }
  const reds = [[1, 0.95, 0.95], [0.85, 0.8, 0.85], [1.1, 1, 0.9]];
  if (t.kind === 'shrub') {
    for (const [dx, dz, s] of [[0, 0, 1], [t.r * 0.45, -t.r * 0.3, 0.7]]) {
      const [r, h] = [t.r * s, t.h * s];
      shell(kit, R, { c: [t.x + dx, y0 + h * 0.48, t.z + dz], r: [r, h * 0.55, r], count: Math.round(160 * s), size: 46, cell: CELL.red, tints: reds, below: -0.75, sway: 2, core: CORE.red });
    }
    return;
  }
  // The apple tree: a short trunk, limbs, a broad canopy hung with red apples.
  const c0 = y0 + t.h * 0.35;
  kit.bark.color(BARK);
  kit.bark.tube([t.x, y0 - 10, t.z], [t.x, c0 + 60, t.z], 36, 24, 7);
  const blobs = ragged(canopyBlobs(t.x, t.z, c0, y0 + t.h, t.r, 211, 5), 4, 2111, kit.tier);
  limbs(kit.bark, [t.x, c0 + 40, t.z], blobs, 16);
  canopy(kit, R, blobs, { size: 90, cell: CELL.tree, tints: [[1, 1.05, 0.92], [0.9, 1, 0.85], [1.1, 1.08, 0.9]], density: 1.3 * (DENSE[kit.tier] ?? 1), sway: 6 });
  kit.paint.color(0xb8281e);
  const A = makeRng(213);
  for (let i = 0; i < 26; i++) {
    const b = blobs[i % blobs.length];
    const a = i * 2.4 + A();
    const up = (A() - 0.35) * 0.9;
    const k = 0.92 + A() * 0.1;
    const p = [b.c[0] + Math.sin(a) * b.r[0] * k * Math.cos(up), b.c[1] + Math.sin(up) * b.r[1] * k, b.c[2] + Math.cos(a) * b.r[2] * k * Math.cos(up)];
    kit.paint.ellipsoid(p, [1, 0, 0], [0, 1, 0], [0, 0, 1], 7, 6.5, 7, 8, 5);
  }
}

// A birch: a white trunk ringed dark (the birch bark), slender, tapering into a tall airy
// canopy of small yellowing leaves (no core: the sky shows through).
function birch(kit, R, x, z, base, h, r, seed) {
  const t = r * 0.1;
  kit.birch.color(BIRCH_BARK);
  kit.birch.tube([x, base - 10, z], [x, base + h * 0.86, z], t * 1.1, t * 0.35, 7);
  const blobs = canopyBlobs(x, z, base + h * 0.36, base + h, r, seed, 4);
  for (const b of blobs) {
    const top = [b.c[0], b.c[1] + b.r[1] * 0.2, b.c[2]];
    if (Math.hypot(top[0] - x, top[2] - z) > t) kit.birch.tube([x, b.c[1] - b.r[1] * 0.5, z], top, t * 0.4, t * 0.15, 5);
  }
  const yellow = [[1.5, 1.35, 0.6], [1.1, 1.15, 0.7], [2.2, 1.6, 0.4], [1.3, 1.25, 0.65]];
  canopy(kit, R, blobs, { size: 70, cell: CELL.hedge, tints: yellow, density: 0.85 * (DENSE[kit.tier] ?? 1), below: -0.6, sway: 9, core: null });
}

// The red tree's bark tint over the bark set's dark brown (linear, a pale grey a little warm),
// and its lichen: a colour per vertex from a smooth hash of where it is (paler grey-green
// patches, a few darker), no stream of its own.
const RED_BARK = [2.35, 2.2, 2.7];
function lichen(p) {
  const w = Math.sin(p[0] * 0.071 + p[1] * 0.043) * Math.sin(p[2] * 0.067 - p[1] * 0.029 + 1.3) + 0.5 * Math.sin(p[1] * 0.11 + p[0] * 0.05 - p[2] * 0.04);
  if (w > 0.55) return [1.1, 1.18, 1.0]; // (grey-green lichen)
  if (w < -0.6) return [0.66, 0.64, 0.62];
  return 1 + 0.12 * w;
}

// A crooked limb through `pts` (its radii `rs` at each) in one skin: each ring square to the
// bend's bisector and carried along the limb on one frame, so no wedge of sky opens at a kink;
// the bark's uvs in world units (round it, along it); `tip`: its end rounded off (no open
// end); `tone(p)`: a colour (a number or [r, g, b]) at each vertex over the Geo's tint.
function limb(g, pts, rs, sides, { tip = false, tone = null } = {}) {
  const n = pts.length;
  const dirs = [];
  for (let k = 0; k + 1 < n; k++) dirs.push(norm(sub(pts[k + 1], pts[k])));
  const tan = pts.map((_, k) => (k === 0 ? dirs[0] : k === n - 1 ? dirs[n - 2] : norm(add(dirs[k - 1], dirs[k]))));
  let u = norm(cross(tan[0], Math.abs(tan[0][1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const len = [0];
  for (let k = 1; k < n; k++) len.push(len[k - 1] + Math.hypot(...sub(pts[k], pts[k - 1])));
  const rings = pts.map((c, k) => {
    const t = tan[k];
    if (k) u = norm(sub(u, mul(t, dot(u, t))));
    const v = cross(t, u);
    const [a, b] = [Math.max(0, k - 1), Math.min(n - 1, k + 1)];
    const lean = (rs[a] - rs[b]) / (len[b] - len[a] || 1);
    return Array.from({ length: sides + 1 }, (_, i) => {
      const ang = (Math.PI * 2 * i) / sides;
      const d = add(mul(u, Math.cos(ang)), mul(v, Math.sin(ang)));
      const p = add(c, mul(d, rs[k]));
      return { p, n: norm(add(d, mul(t, lean))), s: tone ? tone(p) : 1 };
    });
  });
  const step = (Math.PI * 2 * rs[0]) / sides;
  for (let k = 0; k + 1 < n; k++) {
    for (let i = 0; i < sides; i++) {
      const q = [rings[k][i], rings[k][i + 1], rings[k + 1][i + 1], rings[k + 1][i]];
      g.quad(q[0].p, q[1].p, q[2].p, q[3].p, { n: q.map((v) => v.n), shade: q.map((v) => v.s), uvs: [[i * step, len[k]], [(i + 1) * step, len[k]], [(i + 1) * step, len[k + 1]], [i * step, len[k + 1]]] });
    }
  }
  if (!tip) return;
  // (The end: a ring part way round a dome, its apex.)
  const t = tan[n - 1];
  const r = rs[n - 1];
  const last = rings[n - 1];
  const c = add(pts[n - 1], mul(t, r * 0.55));
  const apex = add(pts[n - 1], mul(t, r * 0.9));
  const mid = last.map((e) => {
    const d = norm(sub(e.p, pts[n - 1]));
    return { p: add(c, mul(d, r * 0.78)), n: norm(add(d, mul(t, 0.8))), s: e.s };
  });
  const L0 = len[n - 1];
  for (let i = 0; i < sides; i++) {
    const q = [last[i], last[i + 1], mid[i + 1], mid[i]];
    g.quad(q[0].p, q[1].p, q[2].p, q[3].p, { n: q.map((v) => v.n), shade: q.map((v) => v.s), uvs: [[i * step, L0], [(i + 1) * step, L0], [(i + 1) * step, L0 + r * 0.6], [i * step, L0 + r * 0.6]] });
    g.tri(mid[i].p, mid[i + 1].p, apex, { n: [mid[i].n, mid[i + 1].n, t], shade: [mid[i].s, mid[i + 1].s, mid[i].s], uvs: [[i * step, L0 + r * 0.6], [(i + 1) * step, L0 + r * 0.6], [(i + 0.5) * step, L0 + r]] });
  }
}

// The dad's red-leaf tree in the middle of the bed (W3: an old purple-leaved crab apple): its
// pale grey trunk with lichen on it (the climbable pole) forking into four leaning stems and on
// up as a slim leader that forks again at the pole's top, limbs from them up into the crown and
// fine twigs out through it; a wide, sparse crown of small dark purple-red and
// brown sprays (the sky shows through; open over the trunk's top, where Jonas stands). Its own
// streams (the plants' R stepped on as before, so every plant after it keeps its place).
// (The crown's sprays per tier: their size, their density over the blobs' skins.)
const RED_TREE_CARDS = { high: [30, 1.05], mid: [34, 0.55], low: [40, 0.26] };
const TWIGS = { high: 14, mid: 9, low: 2 };
const FALLEN = { high: 420, mid: 300, low: 110 };
function redTree(kit, R, L) {
  const { BED: B, RED_TREE: T } = L;
  const G = L.GROUND;
  const bedTop = G + B.raise;
  const fork = [T.x + 8, G + T.fork, T.z - 6];
  const S = makeRng(7331);
  const fine = kit.tier !== 'low';
  // (W3 fix: pale grey, lichen on it, as the photos have it: over the bark set's dark brown a
  // light tint, greener and paler in patches; slimmer, about 22 at the foot: the pole's radius
  // 28 is the post's plus 6, as a lamppost's.)
  kit.bark.rgb(...RED_BARK);
  const sides = fine ? 8 : 7;
  // The trunk, a little crooked, swelling at the fork and on up as the leader (thinner at once:
  // one stem among the others) to the pole's top, where Jonas stands, rounded off there: one skin.
  const top = [T.x + 2, T.trunkTop + 20, T.z + 4];
  limb(kit.bark, [[T.x, bedTop - 4, T.z], [T.x - 3, bedTop + 50, T.z + 2], [T.x + 3, G + 170, T.z - 3], fork, [T.x + 6, fork[1] + 40, T.z - 3], [T.x + 3, G + 370, T.z + 2], top], [24, 20.5, 18.5, 18, 12.5, 11, 9.5], sides, { tip: true, tone: lichen });
  // Four stems leaning out from inside the fork, each bending up toward its end (a little
  // crooked) in one skin, its end rounded; a side branch off each out toward the crown's rim.
  const ends = redTreeStems(T);
  const rims = [];
  const inside = [fork[0], fork[1] - 18, fork[2]];
  for (const [x, y, z, w] of ends) {
    const at = (t, lift) => [fork[0] + (x - fork[0]) * t + (S() - 0.5) * 24, fork[1] + (y - fork[1]) * (t * t * 0.6 + t * 0.4) - lift, fork[2] + (z - fork[2]) * t + (S() - 0.5) * 24];
    const [a, b] = [at(0.35, 10), at(0.7, 14)];
    limb(kit.bark, [inside, a, b, [x, y, z]], [w * 0.72, w * 0.6, w * 0.48, w * 0.4], fine ? 7 : 6, { tip: true, tone: lichen });
    const out = [x - T.x, z - T.z];
    const l = Math.hypot(out[0], out[1]);
    const turn = (S() - 0.5) * 1.4;
    const [ox, oz] = [(out[0] * Math.cos(turn) - out[1] * Math.sin(turn)) / l, (out[0] * Math.sin(turn) + out[1] * Math.cos(turn)) / l];
    const tip = [b[0] + ox * T.canopy.r * 0.45, b[1] + 60 + S() * 80, b[2] + oz * T.canopy.r * 0.45];
    kit.bark.tube(b, tip, w * 0.3, 2.5, 5);
    rims.push(tip);
  }
  // (Three branches from the leader's top up and out into the crown's middle, bending as they
  // go: the leader forks again there, not a sawn stub with spikes.)
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + S();
    const lift = S();
    const [dx, dz] = [Math.sin(a), Math.cos(a)];
    const p0 = [top[0], top[1] - 14, top[2]];
    limb(kit.bark, [p0, [p0[0] + dx * 55, p0[1] + 95, p0[2] + dz * 55], [p0[0] + dx * 150, p0[1] + 210 + lift * 60, p0[2] + dz * 150]], [7.5, 5, 2.5], fine ? 6 : 5, { tip: true, tone: lichen });
  }
  // Limbs from each stem's end up and out into the blobs nearest it, twigs out through each blob.
  const blobs = redTreeCrown(T);
  for (const b of blobs) {
    let best = ends[0];
    for (const t of ends) if (Math.hypot(t[0] - b.c[0], t[2] - b.c[2]) + Math.abs(t[1] - b.c[1]) < Math.hypot(best[0] - b.c[0], best[2] - b.c[2]) + Math.abs(best[1] - b.c[1])) best = t;
    const [x, y, z, w] = best;
    kit.bark.tube([x, y, z], b.c, w * 0.34, 2.6, fine ? 5 : 4);
    // (Each twig from a point along the limb, in two pieces, bent, out past the blob's skin
    // round it: a fine mesh, not spokes; on low two, straight.)
    for (let k = 0; k < (TWIGS[kit.tier] ?? TWIGS.high); k++) {
      const t = 0.35 + 0.65 * S();
      const p0 = [x + (b.c[0] - x) * t, y + (b.c[1] - y) * t, z + (b.c[2] - z) * t];
      const a = S() * Math.PI * 2;
      const up = (S() - 0.35) * 1.3;
      const reach = 0.7 + 0.5 * S();
      const q = [b.c[0] + Math.sin(a) * b.r[0] * reach * Math.cos(up), b.c[1] + Math.sin(up) * b.r[1] * reach, b.c[2] + Math.cos(a) * b.r[2] * reach * Math.cos(up)];
      const m = [(p0[0] + q[0]) / 2 + (S() - 0.5) * 34, (p0[1] + q[1]) / 2 + 6 + S() * 16, (p0[2] + q[2]) / 2 + (S() - 0.5) * 34];
      if (!fine) {
        kit.bark.tube(p0, q, 1.8, 0.5, 3);
        continue;
      }
      kit.bark.tube(p0, m, 1.7, 1.0, 3);
      kit.bark.tube(m, q, 1.0, 0.4, 3);
      // (On high a fork off each twig's middle.)
      if (kit.tier === 'high') {
        const f = [m[0] + (q[0] - m[0]) * 0.4 + (S() - 0.5) * 60, m[1] + (q[1] - m[1]) * 0.4 + 10 + S() * 30, m[2] + (q[2] - m[2]) * 0.4 + (S() - 0.5) * 60];
        kit.bark.tube(m, f, 0.9, 0.35, 3);
      }
    }
  }
  // The crown: sparse sprays on each blob's skin (no core: the light shows through).
  // (Over the atlas's dark purple-red sprays: duller and browner, a few orange-brown.)
  const tints = [[0.5, 0.72, 0.72], [0.4, 0.55, 0.56], [0.75, 1.25, 0.95], [0.55, 0.85, 0.8]];
  const [size, density] = RED_TREE_CARDS[kit.tier] ?? RED_TREE_CARDS.high;
  for (const b of blobs) {
    const [a, h, c] = b.r;
    const area = 4 * Math.PI * Math.pow(((a * h) ** 1.6 + (a * c) ** 1.6 + (h * c) ** 1.6) / 3, 1 / 1.6);
    const count = Math.round(((area / (size * size)) * density) / (CLUSTERS[kit.tier] ?? 1));
    shell(kit, S, { c: b.c, r: b.r, count, size, cell: CELL.red, tints, below: -0.6, outside: blobs.filter((o) => o !== b), sway: 5, core: null });
  }
  // (A few sprays out at the side branches' tips, past the blobs.)
  for (const t of rims) shell(kit, S, { c: t, r: [70, 45, 70], count: Math.round((kit.tier === 'low' ? 6 : 14) / (CLUSTERS[kit.tier] ?? 1)), size, cell: CELL.red, tints, below: -0.6, sway: 5, core: null });
  // Fallen leaves on the bed's soil (thickest under the crown), russet and brown, and its ground
  // cover (the photos: low leaves, brown-red overall, a little green): their own stream (the
  // plants' R stepped on as the old round bed's leaves took it).
  for (let i = 0; i < 360; i++) R();
  const F = makeRng(3311);
  // (Over the atlas's red: russet, dark brown-red and a pale brown, W3: brown, not red.)
  const leafTone = () => {
    const t = F();
    return t < 0.4 ? [1.2, 3.4, 2.4] : t < 0.75 ? [0.8, 1.9, 1.5] : [1.5, 4.3, 2.9];
  };
  const fallen = FALLEN[kit.tier] ?? FALLEN.high;
  for (let i = 0; i < 420; i++) {
    const a = F() * Math.PI * 2;
    const d = Math.sqrt(F()) * (i < 120 ? 330 : 700);
    const [x, z, s] = [T.x + Math.sin(a) * d, T.z + Math.cos(a) * d, 10 + F() * 7];
    if (!L.inBed(x + s, z - s) || !L.inBed(x - s, z + s) || !L.inBed(x - s, z - s) || !L.inBed(x + s, z + s)) continue;
    const tone = leafTone();
    const turn = F() * Math.PI;
    const y = bedTop + 4.5 + F() * 0.5;
    if (i % 420 >= fallen) continue; // (fewer on mid and low, the stream unchanged)
    kit.foliage.rgb(...tone);
    const [ca, sa] = [Math.cos(turn) * s, Math.sin(turn) * s];
    const [u0, v0] = CELL.red;
    kit.foliage.quad([x - ca, y, z - sa], [x + sa, y, z - ca], [x + ca, y, z + sa], [x - sa, y, z + ca], { n: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], uvs: [[u0 + 0.2, v0 + 0.2], [u0 + 0.3, v0 + 0.2], [u0 + 0.3, v0 + 0.3], [u0 + 0.2, v0 + 0.3]] });
  }
  const tufts = Math.round(110 * (CLUSTERS[kit.tier] ?? 1));
  for (let i = 0; i < tufts; i++) {
    const [x, z] = [B.x0 + 30 + F() * (B.x1 - B.x0 - 60), B.z0 + 30 + F() * (B.z1 - B.z0 - 60)];
    const [s, turn, green, t] = [26 + F() * 22, F() * Math.PI, F() < 0.3, F()];
    if (!L.inBed(x + s, z + s) || !L.inBed(x - s, z - s) || Math.hypot(x - T.x, z - T.z) < 70) continue;
    const [u0, v0] = green ? CELL.hedge : CELL.red;
    if (green) kit.foliage.rgb(0.72 + t * 0.25, 0.82, 0.62);
    else kit.foliage.rgb(0.9 + t * 0.4, 2.4 + t * 1.2, 1.8 + t * 0.6);
    for (const a of [turn, turn + Math.PI / 2]) {
      const [dx, dz] = [Math.cos(a) * s, Math.sin(a) * s];
      const n = [0, 1, 0];
      const top = bedTop + s * 0.6;
      kit.foliage.sway = 0;
      const uv = [[u0 + 0.05, v0 + 0.45], [u0 + 0.45, v0 + 0.45], [u0 + 0.45, v0 + 0.25], [u0 + 0.05, v0 + 0.25]];
      kit.foliage.vertex([x - dx, bedTop + 1, z - dz], n, uv[0]);
      kit.foliage.vertex([x + dx, bedTop + 1, z + dz], n, uv[1]);
      kit.foliage.sway = 2;
      kit.foliage.vertex([x + dx * 1.2, top, z + dz * 1.2], n, uv[2]);
      kit.foliage.sway = 0;
      kit.foliage.vertex([x - dx, bedTop + 1, z - dz], n, uv[0]);
      kit.foliage.sway = 2;
      kit.foliage.vertex([x + dx * 1.2, top, z + dz * 1.2], n, uv[2]);
      kit.foliage.vertex([x - dx * 1.2, top, z - dz * 1.2], n, uv[3]);
      kit.foliage.sway = 0;
    }
  }
}

// The ivy mound over the dad's north-east pier (IVY, W3): a dense mass of broad dark leaves,
// yellowing in patches, standing out from the wall up to the gutter and round the corner onto
// the gable (a second, narrower mass there); a dark core. Its own stream; cards per tier.
const IVY_CARDS = { high: 900, mid: 520, low: 100 };
function ivy(kit, L) {
  const S = makeRng(9127);
  const n = IVY_CARDS[kit.tier] ?? IVY_CARDS.high;
  const k = CLUSTERS[kit.tier] ?? 1;
  const tints = [[0.32, 0.34, 0.19], [0.24, 0.27, 0.15], [0.4, 0.42, 0.22], [0.9, 0.82, 0.32], [0.28, 0.31, 0.17]];
  const masses = ivyMasses(L);
  const total = masses.reduce((a, m) => a + m.r[0] * m.r[1], 0);
  for (const m of masses) shell(kit, S, { c: m.c, r: m.r, count: Math.round((n * m.r[0] * m.r[1]) / total / k), size: 44, cell: CELL.rhodo, tints, below: -0.9, sway: 1.5, outside: masses.filter((o) => o !== m), coreK: 0.8 });
}

// The rose beside the mailbox (ROSE, W3): three thin dark stakes leaning in, bare canes on them,
// a sparse mass of small yellow-green leaves and a few red hips; none on low.
const ROSE_CARDS = { high: 90, mid: 55, low: 0 };
function rose(kit, L) {
  const Ro = L.ROSE;
  const G = L.GROUND;
  const n = ROSE_CARDS[kit.tier] ?? 0;
  if (!n) return;
  const S = makeRng(5513);
  kit.paint.color(0x2a2a2a);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const [x, z] = [Ro.x + Math.sin(a) * Ro.r * 0.6, Ro.z + Math.cos(a) * Ro.r * 0.6];
    kit.paint.tube([x, G - 4, z], [Ro.x + Math.sin(a) * 8, G + Ro.h, Ro.z + Math.cos(a) * 8], 1.6, 1.2, 4);
  }
  kit.bark.color(0x6a5a40);
  for (let i = 0; i < 7; i++) {
    const a = S() * Math.PI * 2;
    kit.bark.tube([Ro.x, G, Ro.z], [Ro.x + Math.sin(a) * Ro.r * 0.9, G + Ro.h * (0.6 + 0.4 * S()), Ro.z + Math.cos(a) * Ro.r * 0.9], 2.4, 1, 3);
  }
  shell(kit, S, { c: [Ro.x, G + Ro.h * 0.58, Ro.z], r: [Ro.r, Ro.h * 0.42, Ro.r], count: Math.round(n / (CLUSTERS[kit.tier] ?? 1)), size: 26, cell: CELL.hedge, tints: [[1.7, 1.5, 0.55], [1.35, 1.3, 0.5], [2.0, 1.6, 0.5]], below: -0.7, sway: 2, core: null });
  kit.paint.color(0xb8281e);
  for (let i = 0; i < 9; i++) {
    const a = S() * Math.PI * 2;
    kit.paint.ellipsoid([Ro.x + Math.sin(a) * Ro.r * 0.8, G + Ro.h * (0.45 + 0.4 * S()), Ro.z + Math.cos(a) * Ro.r * 0.8], [1, 0, 0], [0, 1, 0], [0, 0, 1], 3.5, 4, 3.5, 6, 4);
  }
}

// A bed of cosmos on a terrace: leafy tufts (cards), pink, rose and white flowers on top.
function flowerBed(kit, R, L, bed) {
  const y = L.groundHeight((bed.x0 + bed.x1) / 2, (bed.z0 + bed.z1) / 2);
  const F = makeRng(bed.seed);
  const flowers = [0xe86aa8, 0xf0a0c8, 0xf4f0f4, 0xc83a8a];
  for (let i = 0; i < bed.n; i++) {
    const x = bed.x0 + 40 + F() * (bed.x1 - bed.x0 - 80);
    const z = bed.z0 + 40 + F() * Math.max(0, bed.z1 - bed.z0 - 80);
    const r = 40 + F() * 25;
    const h = 60 + F() * 40;
    shell(kit, R, { c: [x, y + h * 0.45, z], r: [r, h * 0.55, r], count: 22, size: 30, cell: CELL.hedge, tints: [[0.9, 1.1, 0.8]], below: -0.6, sway: 2, core: null });
    for (let k = 0; k < 6; k++) {
      const a = F() * Math.PI * 2;
      const [fx, fy, fz] = [x + Math.sin(a) * r * 0.6, y + h * (0.85 + F() * 0.3), z + Math.cos(a) * r * 0.6];
      kit.paint.color(flowers[(i + k) % flowers.length]);
      for (let p = 0; p < 5; p++) {
        const b = (p / 5) * Math.PI * 2;
        kit.paint.tri([fx, fy + 1, fz], [fx + Math.sin(b + 0.35) * 10, fy, fz + Math.cos(b + 0.35) * 10], [fx + Math.sin(b - 0.35) * 10, fy, fz + Math.cos(b - 0.35) * 10]);
      }
    }
  }
}

// A balcony box's plants (villas.js balcony): a leafy tuft at each of `spots` (world: the soil's
// middle there), geraniums over them (five-petal stars in `paint`).
export function boxPlants(kit, spots, seed) {
  const R = makeRng(seed);
  const flowers = [0xd8343a, 0xe8607a, 0xc42a30, 0xf2eeea];
  spots.forEach(([x, y, z], i) => {
    shell(kit, R, { c: [x, y + 9, z], r: [17, 12, 13], count: 14, size: 15, cell: CELL.hedge, tints: [[0.85, 1.05, 0.75], [0.75, 0.95, 0.68]], below: -0.4, sway: 1, core: null });
    for (let k = 0; k < 3; k++) {
      const a = R() * Math.PI * 2;
      const [fx, fy, fz] = [x + Math.sin(a) * 9, y + 17 + R() * 6, z + Math.cos(a) * 7];
      kit.paint.color(flowers[(i + k) % flowers.length]);
      for (let p = 0; p < 5; p++) {
        const b = (p / 5) * Math.PI * 2;
        kit.paint.tri([fx, fy + 0.8, fz], [fx + Math.sin(b + 0.4) * 4.5, fy, fz + Math.cos(b + 0.4) * 4.5], [fx + Math.sin(b - 0.4) * 4.5, fy, fz + Math.cos(b - 0.4) * 4.5]);
      }
    }
  });
}

// ---------------------------------------------------------------- firs

// The forest's spruce (A: every fir but the edge's on high) and the edge's (B, high only: the
// firs nearest the street): more, shorter tiers, the lower branches hanging (a Norway spruce's
// skirt), a narrower spire, branches more uneven and here and there one missing (a gap the sky
// shows through), so the edge is not one tree copied.
export const FIR_SHAPES = Object.freeze({
  A: Object.freeze({ tiers: 12, low: 8, branches: 5, droop: 0, spread: 0.3, gap: 0, power: 0.85 }),
  B: Object.freeze({ tiers: 15, low: 10, branches: 5, droop: 0.22, spread: 0.45, gap: 0.14, power: 1.05 }),
});

const DOWN = [0, -1, 0];

export function firGeometry(tier = 'high', seed = 7, shape = FIR_SHAPES.A) {
  const R = makeRng(seed);
  const leaves = new Geo();
  const core = new Geo();
  const tiers = tier === 'low' ? shape.low : shape.tiers;
  // The trunk, inside the crown (no bare pole over its top).
  core.rgb(1.5, 0.65, 0.9); // (dark bark brown over the twig texture's greens)
  core.cyl('y', -0.02, 0.84, 0, 0, 0.03, 6);
  core.rgb(0.95, 0.95, 0.95);
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const y = 0.1 + 0.84 * t;
    const r = Math.pow(1 - t, shape.power) + 0.06;
    const n = Math.max(3, Math.round(shape.branches * (1 - t * 0.4)));
    const a0 = k * 2.399;
    // The whorl's dense heart: a drooping skirt of needles (opaque: the twig's texture on it, a
    // twig a branch, its stem out along it; dark under it), its rim a star of branch tips
    // hanging down over the whorl below, so the crown is one dark mass in tiers (a spruce's
    // layered outline) and the sky never shows through its middle; the branch cards are its
    // fringe.
    const m = 5;
    const drop = (0.84 / tiers) * (1.3 + 0.4 * (1 - t)); // (down over the whorl below, however many)
    const rim = [];
    for (let i = 0; i < m; i++) {
      const a = a0 + (i / m) * Math.PI * 2 + (R() - 0.5) * 0.3;
      for (const tip of [true, false]) {
        const at = a + (tip ? 0 : Math.PI / m);
        const rr = r * (tip ? 0.66 + 0.14 * R() : 0.42 + 0.1 * R());
        const dy = drop * (tip ? 0.95 + 0.25 * R() : 0.6);
        rim.push({ p: [Math.cos(at) * rr, y - dy, Math.sin(at) * rr], n: norm([Math.cos(at), 1.1, Math.sin(at)]), g: (tip ? 0.46 : 0.32) * (0.85 + 0.3 * R()), u: tip ? 1 : 0.62, v: tip ? 0.5 : 0 });
      }
    }
    const top = [0, y + 0.012, 0];
    const under = [0, y - drop * 0.45, 0];
    for (let i = 0; i < 2 * m; i++) {
      const [a, b] = [rim[i], rim[(i + 1) % (2 * m)]];
      // (Each pair of triangles a twig: its stem from the trunk out to the tip, v 0.5.)
      const [va, vb] = a.v === 0.5 ? [0.5, 1] : [0, 0.5];
      core.tri(top, b.p, a.p, { n: [[0, 1, 0], b.n, a.n], uvs: [[0, 0.5], [b.u, vb], [a.u, va]], shade: [0.24, b.g, a.g] });
      // (Its underside dark: the shade under a spruce's branches.)
      core.tri(under, a.p, b.p, { n: [DOWN, DOWN, DOWN], uvs: [[0, 0.5], [a.u, va], [b.u, vb]], shade: [0.06, 0.12, 0.12] });
    }
    for (let b = 0; b < n; b++) {
      const a = a0 + (b / n) * Math.PI * 2 + (R() - 0.5) * 0.4;
      if (shape.gap && R() < shape.gap * (1 - t)) continue;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const len = r * (1 - shape.spread / 2 + shape.spread * R());
      const p0 = [dir[0] * 0.02, y, dir[2] * 0.02];
      const p1 = [dir[0] * len, y - (0.05 + 0.08 * R()) * (0.6 + t) - shape.droop * (1 - t) * len, dir[2] * len];
      const axis = norm(sub(p1, p0));
      const across = norm(cross([0, 1, 0], axis));
      const w = 0.24 + 0.25 * r;
      const nOut = norm([dir[0], 0.55, dir[2]]);
      const g = 0.85 + 0.3 * R();
      leaves.rgb(g, g, g);
      // One card a branch, turned most of the way up on edge (its needles out past the skirt's
      // rim as seen from the side), each its own roll.
      const roll = 0.9 + 0.5 * R();
      const up = norm(cross(axis, across));
      const hw = mul(add(mul(across, Math.cos(roll)), mul(up, Math.sin(roll))), w / 2);
      // The branch's tip sways (units of the fir's own size: scaled by its instance).
      const P = [sub(p0, hw), sub(p1, hw), add(p1, hw), add(p0, hw)];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        leaves.sway = i === 1 || i === 2 ? 0.012 : 0;
        leaves.vertex(P[i], nOut, uvs[i]);
      }
      leaves.sway = 0;
    }
  }
  // The leader: a short tuft of two crossed cards straight up from the top whorl, the twig's
  // stem up, so the crown ends in needles, not a pole.
  leaves.rgb(1.05, 1.05, 1.05);
  for (const a of [0.4, 0.4 + Math.PI / 2]) {
    const hw = [Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07];
    const [p0, p1] = [[0, 0.86, 0], [0, 1, 0]];
    const P = [sub(p0, hw), sub(p1, hw), add(p1, hw), add(p0, hw)];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      leaves.sway = i === 1 || i === 2 ? 0.006 : 0;
      leaves.vertex(P[i], norm([Math.cos(a + 1.57), 0.3, Math.sin(a + 1.57)]), uvs[i]);
    }
    leaves.sway = 0;
  }
  return { leaves, core };
}

// `from`, `to`: the spots' range (forestSpots' order: the bank's firs, then the edge's).
export function firInstances(L, from = 0, to = Infinity) {
  const { firs } = forestSpots(L);
  const list = firs.slice(from, to);
  const matrices = new Float32Array(list.length * 16);
  const colors = new Float32Array(list.length * 3);
  const R = makeRng(99);
  for (let i = 0; i < from; i++) R(); // (each fir's tint its own, wherever the range starts)
  list.forEach((s, i) => {
    // Column-major: a turn about y, scaled (r, h, r), at its foot.
    const a = s.a0 * Math.PI * 2;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    const sr = s.r * 1.05;
    matrices.set([c * sr, 0, -n * sr, 0, 0, s.h, 0, 0, n * sr, 0, c * sr, 0, s.x, s.base, s.z, 1], i * 16);
    const t = R();
    colors.set([0.85 + 0.3 * t, 0.9 + 0.25 * t, 0.85 + 0.2 * t], i * 3);
  });
  return { matrices, colors };
}
