// The realistic look's plants (world/lane/real/detail.js builds them in the worker; the classic
// builders keep every collider): leaf cards over the classic shapes, so each plant stands where
// its classic blob stood and Jonas meets it where he always did.
//
//   plants(kit, L)          // the hedges, the thujas, the junction's trees, the garden trees
//                           // (apple, birch, shrub), the dad's red-leaf tree, the rhododendron,
//                           // the pot by the door, the flower beds, the forest's birches; kit:
//                           // detail.js's Geo per material (foliage, core, bark, birch, paint,
//                           // enamel)
//   firGeometry(tier) -> { leaves, core }   // one spruce (unit radius and height, its foot
//                           // at 0): Geos (the core its dark inner cone and its trunk)
//   firInstances(L) -> { matrices, colors }        // the forest's firs (spots.js), a matrix and
//                           // a tint each
//
// A plant is clusters of two crossed cards (the leaf atlas's cells: texgen/sets.js LEAF_CELLS)
// on a shell: an ellipsoid (the bushes, each blob of a canopy), a box (the hedges) or a column
// (the thujas). Each card leans out of its shell, its normal bent out of the plant's middle and
// up (the mass shades as a volume), darker and duller the deeper and lower it sits; a dark core
// inside stops the sky showing through where a real bush is dense. A canopy's clusters inside
// another of its blobs are left out (only the canopy's outside is leafy). The cards' tips sway in
// the wind (`sway`, units: more on the trees than the bushes); low tier: half the clusters.

import { makeRng } from '../../../core/math.js';
import { Geo, add, mul, sub, dot, cross, norm } from './geo.js';
import { forestSpots } from './spots.js';

// The leaf atlas's cells (texgen/sets.js LEAF_CELLS: each half the atlas a side).
const CELL = { rhodo: [0, 0], hedge: [0.5, 0], tree: [0, 0.5], red: [0.5, 0.5] };
const CORE = { green: [0.03, 0.055, 0.018], red: [0.045, 0.012, 0.012] };
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
  const n = kit.tier === 'low' ? Math.round(count / 2) : count;
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

// A canopy: every blob's shell (only outside the others), cluster counts by its skin's area.
function canopy(kit, R, blobs, { size, cell, tints, density = 1.2, below = -0.4, sway = 8, core = CORE.green }) {
  for (const b of blobs) {
    const [a, h, c] = b.r;
    const area = 4 * Math.PI * Math.pow(((a * h) ** 1.6 + (a * c) ** 1.6 + (h * c) ** 1.6) / 3, 1 / 1.6);
    const count = Math.round((area / (size * size)) * density);
    shell(kit, R, { c: b.c, r: b.r, count, size, cell, tints, below, outside: blobs.filter((o) => o !== b), sway, core, coreK: 0.72 });
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
    const blobs = canopyBlobs(t.x, t.z, y0 + t.h * 0.32, y0 + t.h, t.r, Math.round(t.x * 7 + t.z));
    limbs(kit.bark, [t.x, top - 20, t.z], blobs, 26);
    canopy(kit, R, blobs, { size: 130, cell: CELL.tree, tints: leafy, sway: 10 });
  }
  for (const t of L.GARDEN_TREES) gardenTree(kit, R, L, t);
  redTree(kit, R, L);
  // The rhododendron at the house's west corner, its leaves down to the ground.
  const rh = L.RHODODENDRON;
  shell(kit, R, { c: [rh.x, G + rh.h * 0.45, rh.z], r: [rh.r, rh.h * 0.58, rh.r * 0.9], count: 560, size: 78, cell: CELL.rhodo, tints: [[0.9, 1, 0.8], [0.75, 0.85, 0.7], [1, 1.05, 0.85]], below: -0.8, sway: 2 });
  // The pot by the door: a glazed blue pot, a little leafy plant in it.
  const P = L.POT;
  kit.enamel.color(0x2e5f92);
  kit.enamel.loft([[16, G], [24, G + 4], [27, G + 36], [28, G + 40], [24, G + 40]].map(([r, y]) => ring(P.x, y, P.z, r, 12)), { capStart: true });
  kit.core.rgb(0.05, 0.035, 0.02);
  kit.core.cyl('y', G + 36, G + 37, P.x, P.z, 24, 12, { caps: true });
  shell(kit, R, { c: [P.x, G + 62, P.z], r: [30, 26, 30], count: 34, size: 26, cell: CELL.hedge, tints: leafy, below: -0.3, sway: 1 });
  for (const b of L.FLOWER_BEDS) flowerBed(kit, R, L, b);
  // The forest's birches.
  for (const t of forestSpots(L).birches) birch(kit, R, t.x, t.z, t.base, t.h, t.r, t.seed);
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
  const step = (kit.tier === 'low' ? 36 : 25) * (h.x1 - h.x0 > 4000 ? 1.3 : 1);
  const tint = () => {
    const k = 0.8 + 0.35 * R();
    foliage.rgb(0.95 * k, 1.05 * k, 0.85 * k);
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
  core.rgb(...CORE.green);
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
    kit.foliage.rgb(0.55 * k, 0.72 * k, 0.5 * k);
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
  const blobs = canopyBlobs(t.x, t.z, c0, y0 + t.h, t.r, 211, 5);
  limbs(kit.bark, [t.x, c0 + 40, t.z], blobs, 16);
  canopy(kit, R, blobs, { size: 90, cell: CELL.tree, tints: [[1, 1.05, 0.92], [0.9, 1, 0.85], [1.1, 1.08, 0.9]], density: 1.3, sway: 6 });
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
  canopy(kit, R, blobs, { size: 70, cell: CELL.hedge, tints: yellow, density: 0.85, below: -0.6, sway: 9, core: null });
}

// The dad's red-leaf tree in the round bed: its trunk (the climbable pole), six stems branching
// out of it, a crown of red sprays round the trunk's top (open over it, where Jonas stands).
function redTree(kit, R, L) {
  const { ROUND_BED: B, RED_TREE: T } = L;
  const bedTop = L.GROUND + 14;
  const C = T.canopy;
  kit.bark.color(0x8a6a60);
  kit.bark.tube([T.x, bedTop - 4, T.z], [T.x, T.trunkTop + 20, T.z], T.radius + 2, T.radius - 10, 8);
  const stems = [];
  for (const [a, out, y, w] of [[0.9, 0.62, 150, 16], [1.9, 0.6, 90, 14], [2.6, 0.5, 40, 12]]) {
    for (const e of [-1, 1]) {
      const [sx, sz] = [Math.sin(a * e), Math.cos(a * e)];
      const q = [T.x + sx * C.r * out, C.y0 + y, T.z + sz * C.r * out];
      kit.bark.tube([T.x, bedTop + 120, T.z], q, w * 0.5, w * 0.3, 6);
      kit.bark.tube(q, [q[0] + sx * 60, q[1] + 90, q[2] + sz * 60], w * 0.3, w * 0.12, 5);
      stems.push(q);
    }
  }
  const crown = [
    [0.7, 170, 520, 150, 120], [-0.7, 170, 520, 150, 120],
    [1.75, 190, 470, 140, 115], [-1.75, 190, 470, 140, 115],
    [2.6, 170, 430, 115, 95], [-2.6, 170, 430, 115, 95],
    [0, 150, 630, 135, 72], [1.3, 175, 605, 110, 72], [-1.3, 175, 605, 110, 72],
  ];
  const blobs = crown.map(([a, off, cy, r, ry]) => ({ c: [T.x + Math.sin(a) * off, cy, T.z + Math.cos(a) * off], r: [r, ry, r] }));
  canopy(kit, R, blobs, { size: 62, cell: CELL.red, tints: [[1.05, 1, 1], [0.85, 0.8, 0.85], [1.2, 1.05, 0.95]], density: 1.1, below: -0.5, sway: 5, core: null });
  // Red leaves fallen on the bed's soil.
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * (B.r - 30);
    const [x, z, s] = [B.x + Math.sin(a) * d, B.z + Math.cos(a) * d, 10 + R() * 7];
    const t = R();
    kit.foliage.rgb(1.2 - t * 0.4, 0.9, 0.9);
    const turn = R() * Math.PI;
    const [ca, sa] = [Math.cos(turn) * s, Math.sin(turn) * s];
    const y = bedTop + 4.5 + R() * 0.5;
    const [u0, v0] = CELL.red;
    kit.foliage.quad([x - ca, y, z - sa], [x + sa, y, z - ca], [x + ca, y, z + sa], [x - sa, y, z + ca], { n: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], uvs: [[u0 + 0.2, v0 + 0.2], [u0 + 0.3, v0 + 0.2], [u0 + 0.3, v0 + 0.3], [u0 + 0.2, v0 + 0.3]] });
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

// ---------------------------------------------------------------- firs

export function firGeometry(tier = 'high', seed = 7) {
  const R = makeRng(seed);
  const leaves = new Geo();
  const core = new Geo();
  const tiers = tier === 'low' ? 10 : 14;
  core.rgb(0.09, 0.06, 0.045);
  core.cyl('y', -0.02, 0.95, 0, 0, 0.03, 6);
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const y = 0.1 + 0.84 * t;
    const r = Math.pow(1 - t, 0.85) + 0.06;
    const n = Math.max(4, Math.round(7 * (1 - t * 0.4)));
    const a0 = k * 2.399;
    for (let b = 0; b < n; b++) {
      const a = a0 + (b / n) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const len = r * (0.85 + 0.3 * R());
      const p0 = [dir[0] * 0.02, y, dir[2] * 0.02];
      const p1 = [dir[0] * len, y - (0.05 + 0.08 * R()) * (0.6 + t), dir[2] * len];
      const axis = norm(sub(p1, p0));
      const across = norm(cross([0, 1, 0], axis));
      const w = 0.22 + 0.25 * r;
      const nOut = norm([dir[0], 0.55, dir[2]]);
      const g = 0.85 + 0.3 * R();
      leaves.rgb(g, g, g);
      for (const roll of [0.15, 1.4]) {
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
  }
  // The dark inner cone: no daylight through a dense spruce's middle (well inside its branches,
  // so their tips make its outline).
  core.rgb(0.02, 0.035, 0.022);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = ((i + 1) / 8) * Math.PI * 2;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    core.tri([cb * 0.36, 0.12, sb * 0.36], [ca * 0.36, 0.12, sa * 0.36], [0, 0.9, 0], { n: [norm([cb, 0.5, sb]), norm([ca, 0.5, sa]), [0, 1, 0]] });
  }
  return { leaves, core };
}

export function firInstances(L) {
  const { firs } = forestSpots(L);
  const matrices = new Float32Array(firs.length * 16);
  const colors = new Float32Array(firs.length * 3);
  const R = makeRng(99);
  firs.forEach((s, i) => {
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
