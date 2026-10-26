// Sparrow Lane's street surface and kerbside furniture (W7, as photos 01, 05, 09, 12, 13, 17, 18,
// 21, 24, 25, 29, 33 and 41-44 have them: their wear, never their pixels), data and outlines for
// both looks: lane/build.js and lane/props.js (the classic build, the lane's chunk) and
// world/lane/real/garden.js and street.js (the realistic look's worker) read it; layout.js never
// imports it (builders' data: kept out of the main chunk).
//
//   roadAt(L, t, s)   the point t along ROAD.line from its west end, s across it (+ its left: the
//                     south side) -> [x, z, dx, dz] (dx, dz: the line's way there)
//   streetWear(L)     the road's wear (memoised per layout):
//       patches       [[x, z]...] the mended patches: blobby outlines (12-20 points, 150-900
//                     across), a quarter to a third of the carriageway, darker sealed asphalt
//       bands         [{ pts, w }] the meandering sealant bands along the road (20-50 wide, darker)
//       seals         [{ pts, w }] the crack-seal lines (4-6 wide, near black), one 15 m along the
//                     bend's south third
//       seam          { pts, w } the longitudinal seam a quarter in from the south edge west of the
//                     dad's (two layings)
//       covers        [{ x, z, r }] cast-iron manhole covers: two side by side at the bend, two at
//                     the side road's mouth, two in the straight's south half by the dad's, two on
//                     the turning area's line and one in its middle; none on the straight west of
//                     the link (photo 12)
//       gullies       [{ x, z, dx, dz }] rectangular grates at the north kerb only (along dx, dz)
//       sump          { x, z, r } the dark round patch with its small square grate (photos 33, 34)
//     (`n`: the blobs' points: 12 on low)
//   EDGING            the dad's lawn's weathered timber edging at the asphalt's edge (x0..x1,
//                     w wide, joints every `joint`) and, along its west edge by the link's drive,
//                     the small concrete edging stones with a moss strip (`west`)
//   SHOULDER          the light gravel shoulder along the bend's south edge (x0..x1, w)
//   KERBSIDE          the cabinets and posts at the lampposts' feet: each { lamp, kind, du, dw,
//                     w, d, h, tint } (du along the street from its lamppost, dw back from it):
//                     'cabinet' a metal box (`gable`: a gabled lid), 'post' a marker post or
//                     bollard (w across, a cap); solid where Jonas walks (boxes); `plate`: the
//                     sign plate clamped on L5's pole (blank: its back dark grey), y0..y1, facing
//   kerbside(L)       KERBSIDE placed: [{ ...item, x, z, yaw }] (yaw: its front's way, toward the
//                     street)

import { makeRng } from '../../core/math.js';

export function roadAt(L, t, s = 0) {
  const line = L.ROAD.line;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (t <= l || i + 2 === line.length) {
      const [dx, dz] = [(bx - ax) / l, (bz - az) / l];
      return [ax + dx * t - dz * s, az + dz * t + dx * s, dx, dz];
    }
    t -= l;
  }
}
const lineLength = (L) => L.ROAD.line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - L.ROAD.line[i][0], p[1] - L.ROAD.line[i][1]), 0);
// (The straight's line: t of a point on it at x.)
const tAtX = (L, x) => lineLength(L) - (L.ROAD.line.at(-1)[0] - x);

// A blob: n points round (cx, cz), radii a (along d) and b (across), its outline wandering.
function blob(R, cx, cz, a, b, d, n) {
  const ph = [R(), R(), R()].map((v) => v * 6.3);
  const [ux, uz] = d;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + 0.16 * Math.sin(2 * t + ph[0]) + 0.11 * Math.sin(3 * t + ph[1]) + 0.07 * Math.sin(5 * t + ph[2]);
    const [p, q] = [Math.cos(t) * a * k, Math.sin(t) * b * k];
    pts.push([cx + ux * p - uz * q, cz + uz * p + ux * q]);
  }
  return pts;
}

// A meandering line from t0 over `len` along the road at s0, drifting across (within the
// carriageway, `edge` in from its sides), a point every `step`.
function meander(L, R, t0, len, s0, drift, step, edge = 60) {
  const lim = L.ROAD.half - edge;
  const pts = [];
  let [s, v] = [s0, 0];
  for (let t = t0; t <= t0 + len; t += step) {
    const [x, z] = roadAt(L, t, s);
    pts.push([x, z]);
    v = v * 0.7 + (R() - 0.5) * drift;
    s = Math.max(-lim, Math.min(lim, s + v));
  }
  return pts;
}

const WEAR = new WeakMap();
export function streetWear(L, n = 12) {
  const key = WEAR.get(L) ?? {};
  if (key[n]) return key[n];
  const R = makeRng(7177);
  const half = L.ROAD.half;
  const total = lineLength(L);
  const patches = [];
  // Along the road from the junction: a blob every ~750, inside the carriageway.
  for (let t = 250; t < total - 200; ) {
    const [a, b] = [170 + R() * 330, 80 + R() * 190];
    const s = (R() * 2 - 1) * (half - 40 - b);
    const [x, z, dx, dz] = roadAt(L, t, s);
    const turn = (R() - 0.5) * 0.5;
    const [c, sn] = [Math.cos(turn), Math.sin(turn)];
    patches.push(blob(R, x, z, a, b, [dx * c - dz * sn, dz * c + dx * sn], n));
    t += a * 1.3 + 120 + R() * 380;
  }
  // On the turning area: a few more, each wholly on it.
  const A = L.APRON;
  for (let k = 0, tries = 0; k < 6 && tries < 60; tries++) {
    const [x, z, a, b, turn] = [A.x0 + 250 + R() * (A.x1 - A.x0 - 500), A.z0 + 250 + R() * (A.z1 - A.z0 - 500), 200 + R() * 260, 110 + R() * 160, R() * Math.PI];
    const pts = blob(R, x, z, a, b, [Math.cos(turn), Math.sin(turn)], n);
    if (pts.every(([px, pz]) => L.inApron(px, pz))) {
      patches.push(pts);
      k++;
    }
  }
  // The sealant bands and the crack seals: their starts along the road (t from the junction).
  const bands = [[3300, 1400, -150], [5800, 1900, 120], [7600, 1300, -260], [9900, 2000, 60], [12100, 1500, -60], [13600, 1100, 200]].map(([t, len, s]) => ({ pts: meander(L, R, t, len, s, 30, 90), w: 10 + R() * 18 }));
  // (The first: 15 m on from the bend's west end along its south third, photo 09.)
  const seals = [[tAtLine(L, -7500, 150), 2250, 240], [5300, 700, -230], [8800, 1300, 30], [11200, 700, -200], [14300, 600, 160]].map(([t, len, s]) => ({ pts: meander(L, R, t, len, s, 46, 32, 40), w: 3 + R() * 1.5 }));
  const seam = { pts: meander(L, R, tAtX(L, -5600), 4700, half / 2, 3, 150), w: 5 };
  // The covers (layout local; the bend's and the side road's mouth's along the line).
  // (By the side road's mouth: d along the leg from where its axis meets the leg's line.)
  const mouth = tAtLine(L, L.SIDE_ROAD.x, L.SIDE_ROAD.z);
  const [m1, m2] = [-260, 160].map((d) => roadAt(L, mouth + d, d < 0 ? -110 : 70));
  const covers = [
    { x: -7175, z: -232, r: 48 },
    { x: -7116, z: -112, r: 48 },
    { x: m1[0], z: m1[1], r: 50 },
    { x: m2[0], z: m2[1], r: 50 },
    { x: 363, z: 135, r: 48 },
    { x: 986, z: 93, r: 48 },
    { x: 3949, z: -280, r: 46 },
    { x: 5111, z: -280, r: 46 },
    { x: 3766, z: 231, r: 48 },
  ];
  // The gullies at the north kerb (clear of the drives' drops), two on the west leg.
  const kerbZ = L.ROAD.line.at(-1)[1] - half;
  const gullies = [-4950, -1900, 1500].map((x) => ({ x, z: kerbZ + 24, dx: 1, dz: 0 }));
  for (const d of [-900, 600]) {
    const [x, z, dx, dz] = roadAt(L, mouth + d, -half + 24);
    gullies.push({ x, z, dx, dz });
  }
  const out = { patches, bands, seals, seam, covers, gullies, sump: { x: 4453, z: 292, r: 90 } };
  key[n] = out;
  WEAR.set(L, key);
  return out;
}

// The arc length along ROAD.line of the point on it nearest (x, z).
function tAtLine(L, x, z) {
  const line = L.ROAD.line;
  let [best, at, acc] = [Infinity, 0, 0];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [ex, ez] = [line[i + 1][0] - ax, line[i + 1][1] - az];
    const l = Math.hypot(ex, ez);
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (l * l)));
    const d = Math.hypot(x - ax - ex * u, z - az - ez * u);
    if (d < best) [best, at] = [d, acc + u * l];
    acc += l;
  }
  return at;
}

export const EDGING = Object.freeze({ x0: -860, x1: 885, w: 18, joint: 300, west: { x: -860, z1: 1310, w: 10, moss: 50 } });
export const SHOULDER = Object.freeze({ x0: -7700, x1: -6080, w: 70 });

// At the lampposts' feet (photos 01, 09, 13, 16, 24, 34): du along the street (+ east), dw back
// toward the wall from the pole. (W7 fix, L2's as photo 09 has them: the cabinet just east of the
// pole toward north_1's drive, the white post at its east end nearer the wall; seen from the bend
// pole, cabinet and post left to right, the post's top over the cabinet's. Both a little back from
// the pole's line: on it they stood in the way of the pole's camera swinging round to its side.)
export const KERBSIDE = Object.freeze([
  { lamp: 'L1', kind: 'cabinet', du: -240, dw: 10, w: 70, d: 45, h: 110, tint: 0xd8d6d0 },
  { lamp: 'L2', kind: 'cabinet', du: 100, dw: 20, w: 70, d: 40, h: 105, tint: 0x9a9ea2, foot: 0x8a8884 },
  { lamp: 'L2', kind: 'post', du: 150, dw: 30, w: 12, h: 150, tint: 0xf2f2ee },
  { lamp: 'L3', kind: 'cabinet', du: -90, dw: 24, w: 60, d: 45, h: 160, tint: 0x6a8478, gable: true, foot: 0x2a2a2a },
  { lamp: 'L5', kind: 'cabinet', du: 60, dw: 30, w: 50, d: 35, h: 105, tint: 0x9aa8b2 },
  { lamp: 'L5', kind: 'post', du: 115, dw: 10, w: 16, h: 114, tint: 0xeeeeea, cap: 0x8a8c8e },
]);
export const PLATE = Object.freeze({ lamp: 'L5', w: 45, h: 77, y0: 304, out: 1 });

export function kerbside(L) {
  return KERBSIDE.map((k) => {
    const l = L.LAMPS.find((p) => p.id === k.lamp);
    // (The street's way at the lamppost: along the road's line nearest it; back = away from it.)
    const [fx, fz, dx, dz] = roadAt(L, tAtLine(L, l.x, l.z));
    const side = Math.sign((l.x - fx) * -dz + (l.z - fz) * dx) || -1;
    const [bx, bz] = [-dz * side, dx * side];
    return { ...k, x: l.x + dx * k.du + bx * k.dw, z: l.z + dz * k.du + bz * k.dw, yaw: Math.atan2(-bx, -bz) };
  });
}

// The street's flat pieces (lane/build.js surface draws them in both looks, picking a tint by `k`):
// each { k, pts: [[x, y, z]...] (convex, or star-shaped and fanned from its middle: `fan`), up? (a
// slanted one's way up), shade? }; k: 'patch', 'band', 'seal', 'cover' (the covers: an iron disc,
// its raised ring a shade lighter), 'sump', 'slot', 'bar', 'litter' (down the south edge's bevel
// and, in patches, a ragged way out onto the road, `runs`' edges but where a hedge stands at the
// edge: near the road's tone, each piece its own shade), 'sand' (the same along the young
// beeches, BEECH_ROW: their light sandy verge), 'moss', 'gravel'; and `boards` (the timber
// edging's [x0, x1] between its joints) and `stones` (the west edging's [z0, z1]). (`step`: the
// litter's pieces' length.)
export function surfaceParts(L, runs, step = 90) {
  const W = streetWear(L, 12);
  const G = L.GROUND;
  const out = [];
  const add = (k, pts, extra = {}) => out.push({ k, pts, ...extra });
  const flat = (pts, y) => pts.map(([x, z]) => [x, y, z]);
  const box = (k, x0, z0, x1, z1, y) => add(k, flat([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y));
  const disc = (k, x, z, r, y, extra) => add(k, flat(Array.from({ length: 14 }, (_, i) => [x + Math.cos(i * 0.4488) * r, z + Math.sin(i * 0.4488) * r]), y), { fan: true, ...extra });
  const strip = (k, pts, w, y) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, q] = [pts[i], pts[i + 1]];
      const l = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1;
      const [nx, nz] = [((a[1] - q[1]) / l) * (w / 2), ((q[0] - a[0]) / l) * (w / 2)];
      add(k, flat([[a[0] + nx, a[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz], [a[0] - nx, a[1] - nz]], y));
    }
  };
  for (const p of W.patches) add('patch', flat(p, 0.6), { fan: true });
  for (const b of [...W.bands, W.seam]) strip('band', b.pts, b.w, 0.7);
  for (const c of W.seals) strip('seal', c.pts, c.w, 0.8);
  for (const { x, z, r } of W.covers) {
    disc('cover', x, z, r, 0.85, { shade: 0.85 });
    disc('cover', x, z, r * 0.62, 1.1, { shade: 1.2 });
  }
  const S = W.sump;
  disc('sump', S.x, S.z, S.r, 0.75);
  box('slot', S.x - 19, S.z - 19, S.x + 19, S.z + 19, 0.9);
  for (let k = -14; k <= 14; k += 7) box('bar', S.x + k - 2, S.z - 18, S.x + k + 2, S.z + 18, 1.4);
  for (const { x, z, dx, dz } of W.gullies) {
    const P = (u, w, y) => [x + dx * u - dz * w, y, z + dz * u + dx * w];
    add('slot', [P(-40, -20, 0.7), P(40, -20, 0.7), P(40, 20, 0.7), P(-40, 20, 0.7)]);
    for (let k = -35; k <= 35; k += 10) add('bar', [P(k - 2.5, -20, 1.3), P(k + 2.5, -20, 1.3), P(k + 2.5, 20, 1.3), P(k - 2.5, 20, 1.3)]);
  }
  const hedged = (x) => L.HEDGES.some((h) => h.z0 === L.SOUTH_EDGE && x > h.x0 - 20 && x < h.x1 + 20);
  const Be = L.BEECH_ROW;
  const H = SHOULDER;
  const B = 22; // (the south edge's bevel: real/plan.js BEVEL)
  const R = makeRng(7181);
  for (const { p, q, n, kind } of runs) {
    if (kind !== 'edge') continue;
    const count = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    const at = (t, d, y) => [p[0] + (q[0] - p[0]) * t - n[0] * d, y, p[1] + (q[1] - p[1]) * t - n[1] * d];
    const far = (t) => {
      const u = (p[0] + (q[0] - p[0]) * t) * 0.013;
      return B + 8 + 14 * (0.5 + 0.5 * Math.sin(u) * Math.cos(u * 0.37 + 1.1)) + 6 * Math.sin(u * 4.1);
    };
    for (let k = 0; k < count; k++) {
      const [t0, t1] = [k / count, (k + 1) / count];
      const x = at((t0 + t1) / 2, 0, 0)[0];
      if (hedged(x)) continue;
      // (W7 fix, photos 11, 18-21, 41: the edge near the road's own tone, a little browner, in
      // patches; the young beeches' strip a light sandy verge.)
      const [piece, shade] = x > Be.x0 && x < Be.x1 ? ['sand', 0.94 + 0.12 * R()] : ['litter', 0.9 + 0.16 * R()];
      add(piece, [at(t0, -6, G + 0.6), at(t1, -6, G + 0.6), at(t1, 0, G + 0.6), at(t0, 0, G + 0.6)], { shade });
      add(piece, [at(t0, 0, G + 0.6), at(t1, 0, G + 0.6), at(t1, B, 1), at(t0, B, 1)], { up: [-n[0], 1, -n[1]], shade: shade * 1.05 });
      if (piece === 'sand' || R() > 0.35) add(piece, [at(t0, B, 1), at(t1, B, 1), at(t1, far(t1), 0.6), at(t0, far(t0), 0.6)], { shade });
    }
    if (Math.max(p[0], q[0]) < H.x0 || Math.min(p[0], q[0]) > H.x1) continue;
    const cut = (x) => [x, p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])];
    const [a, b] = [p[0] < H.x0 ? cut(H.x0) : p, q[0] > H.x1 ? cut(H.x1) : q];
    add('gravel', flat([a, b, [b[0] + n[0] * H.w, b[1] + n[1] * H.w], [a[0] + n[0] * H.w, a[1] + n[1] * H.w]], G + 0.5));
  }
  const E = EDGING;
  const V = E.west;
  const z0 = L.SOUTH_EDGE;
  box('moss', V.x - V.moss, z0, V.x, V.z1, G + 0.5);
  const boards = [];
  for (let x = E.x0; x < E.x1 - 1; x += E.joint) boards.push([x, Math.min(E.x1, x + E.joint) - 2]);
  const stones = [];
  for (let z = z0; z < V.z1 - 1; z += 60) stones.push([z + 1, Math.min(V.z1, z + 60) - 1]);
  return { parts: out, boards, stones };
}
