// The realistic look's garden toys and the bigger things on the drives (world/lane/real/detail.js
// builds them in the worker in place of lane/props.js's; their colliders stay the classic ones):
//
//   trampoline(kit, L)  // a steel tube frame on six legs, the dark woven mat sagging a touch in
//                       // its ring of springs, a padded dark grey cover over them, the black
//                       // safety net round it (W6: poles, a top hoop, a mesh of strands)
//   hoop(kit, L)        // north_5's: a black post, the white board on its arm, the orange ring
//                       // and its white net of strands
//   motorhome(kit, L)   // a rounded white body (its cab end's sloping screen under the bed's
//                       // overhang), a dark window band, a door, the stripe, wheels in arches,
//                       // the ladder up its back
//   cabinet(kit, L)     // the grey electrical cabinet: folded steel, its doors' seams, a lock
//   treeLine(L, tier) -> { matrices, colors }   // a far ring of firs where the lane's ground
//                       // ends in the haze (fir instances: foliage.js firGeometry)
//
// kit: detail.js's Geo per material (paint, steel, tyre, rim, carGlass, metal, cloth).

import { makeRng } from '../../../core/math.js';
import { frameOf, fbox, wallFrame } from './house.js';
import { add, mul, norm, sub, dot, cross } from './geo.js';
import { oldDrawn, offTheEnds } from './spots.js';
import { FORECOURT_WALL } from '../ends.js';

const PAD = 0x2a2c30; // (W6: the photos' dark grey pad)
const MAT = 0x1c2026;

// A ring of points round (x, z) at y, radius r, `sides` round (counter-clockwise seen from
// below: a loft from the bottom up faces out).
const ring = (x, y, z, r, sides) => Array.from({ length: sides }, (_, i) => {
  const a = -(i / sides) * Math.PI * 2;
  return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
});

export function trampoline({ paint, steel, tier }, L) {
  const T = L.TRAMPOLINE;
  const y0 = L.groundHeight(T.x, T.z);
  const pad = 45;
  const mat = T.r - pad;
  // The frame: a steel ring under the pad, six legs down to the terrace (a hoop between pairs).
  steel.color(0x6a6e70);
  const frame = ring(T.x, T.y - 30, T.z, T.r - 8, 24);
  for (let i = 0; i < 24; i++) steel.tube(frame[i], frame[(i + 1) % 24], 4, 4, 6);
  for (let i = 0; i < T.legs; i++) {
    const a = ((i + 0.5) / T.legs) * Math.PI * 2;
    const [sx, sz] = [Math.sin(a), Math.cos(a)];
    steel.tube([T.x + sx * (T.r - 8), T.y - 30, T.z + sz * (T.r - 8)], [T.x + sx * (T.r - 4), y0 - 4, T.z + sz * (T.r - 4)], 4, 4, 6);
  }
  // The mat, sagging a touch in its middle; the pad's cover in blue over the springs.
  paint.color(MAT);
  paint.loft([ring(T.x, T.y - 2, T.z, mat, 24), ring(T.x, T.y - 5, T.z, mat * 0.5, 24), ring(T.x, T.y - 6, T.z, 1, 24)]);
  paint.color(PAD);
  paint.loft([ring(T.x, T.y - 26, T.z, T.r, 24), ring(T.x, T.y - 6, T.z, T.r + 1, 24), ring(T.x, T.y + 1, T.z, T.r - 10, 24), ring(T.x, T.y + 1, T.z, mat + 8, 24), ring(T.x, T.y - 1, T.z, mat, 24)]);
  net({ paint, steel, tier }, T);
}

// The safety net (W6, photos 27, 28: drawn only, the bounce to the 1-up is never blocked): eight
// black poles from the frame bowing out and up to a top hoop NET over the mat, between them a
// see-through black mesh of thin upright strands (not on low), its door gap toward the street.
export const NET = 236;
function net({ paint, steel, tier }, T) {
  const top = T.y + NET;
  const r = T.r - 6;
  const at = (a, y, rr) => [T.x + Math.sin(a) * rr, y, T.z + Math.cos(a) * rr];
  steel.color(0x1a1b1d);
  const low = tier === 'low';
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const pts = low ? [at(a, T.y - 28, T.r - 8), at(a, top, r - 4)] : [at(a, T.y - 28, T.r - 8), at(a, T.y + 40, r + 10), at(a, T.y + 150, r + 6), at(a, top, r - 4)];
    for (let k = 0; k + 1 < pts.length; k++) steel.tube(pts[k], pts[k + 1], 3.5, 3.5, low ? 3 : 5);
  }
  const hoop = ring(T.x, top, T.z, r - 4, low ? 12 : 24);
  for (let i = 0; i < hoop.length; i++) steel.tube(hoop[i], hoop[(i + 1) % hoop.length], 2.5, 2.5, low ? 3 : 4);
  if (low) return;
  paint.color(0x0c0d0e);
  const radius = (y) => r + 8 - 12 * Math.max(0, (y - T.y - 150) / (NET - 150));
  const door = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.22;
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    if (door(a)) continue;
    const [p, q] = [at(a, T.y + 4, radius(T.y)), at(a, top, radius(top))];
    const t = [Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9];
    paint.quad([p[0] - t[0], p[1], p[2] - t[2]], [p[0] + t[0], p[1], p[2] + t[2]], [q[0] + t[0], q[1], q[2] + t[2]], [q[0] - t[0], q[1], q[2] - t[2]]);
  }
}

export function hoop({ paint, steel, cloth }, L) {
  const H = L.HOOP;
  const G = L.GROUND;
  const zf = H.z + H.out;
  const top = H.board + H.h;
  steel.color(0x1e1e1e);
  steel.tube([H.x, G - 5, H.z + 12], [H.x, top - 8, H.z + 12], 9, 7, 10, { caps: true });
  steel.tube([H.x, H.board + 37, H.z + 12], [H.x, H.board + 37, zf], 5, 5, 8);
  const f = wallFrame([H.x, 0, zf], [0, 0, 1]);
  paint.color(0xf4f4f0);
  fbox(paint, f, -H.w / 2, H.w / 2, H.board, top, 0, 14);
  paint.color(0xe8642a);
  fbox(paint, f, -30, 30, H.board + 14, H.board + 62, 14, 15.5, 'k');
  paint.color(0xf4f4f0);
  fbox(paint, f, -26, 26, H.board + 18, H.board + 58, 15.5, 16, 'k');
  // The ring and its net: white strands hanging in a cone.
  const rz = zf + 14 + H.ring + 8;
  steel.color(0xe8642a);
  const rim = ring(H.x, H.rim, rz, H.ring, 16);
  for (let i = 0; i < 16; i++) steel.tube(rim[i], rim[(i + 1) % 16], 2.2, 2.2, 5);
  cloth.color(0xf4f4f0);
  const low = ring(H.x, H.rim - 50, rz, H.ring * 0.62, 16);
  for (let i = 0; i < 16; i++) {
    cloth.tube(rim[i], low[(i + 1) % 16], 0.7, 0.7, 3);
    cloth.tube(rim[(i + 1) % 16], low[i], 0.7, 0.7, 3);
  }
}

export function motorhome({ paint, carGlass, tyre, rim, steel, metal }, L) {
  const M = L.MOTORHOME;
  const G = L.GROUND;
  const F = frameOf({ cx: M.cx, cz: M.cz, yaw: M.yaw, w: M.l, d: M.w });
  const [hl, hw] = [M.l / 2, M.w / 2];
  const top = G + M.h;
  // The body: rounded sections along it (u); W8: an integrated motorhome (photos 01-07), its cab
  // toward the road (+u; round 2: broadside to the street); its fix: its front upright as photo
  // 06 has it, the nose, the windscreen leaning back a little over it, a cap rounding up to the
  // roof's edge (the collider's: lane/props.js motorhome).
  const section = (u, y0, y1, half, r) => {
    const pts = [];
    for (const [cw, cy, a0] of [[half - r, y0 + r, -Math.PI / 2], [half - r, y1 - r, 0], [-half + r, y1 - r, Math.PI / 2], [-half + r, y0 + r, Math.PI]]) {
      for (let i = 0; i <= 3; i++) {
        const a = a0 + (i / 3) * (Math.PI / 2);
        pts.push(F.at(u, cy + Math.sin(a) * r, cw + Math.cos(a) * r));
      }
    }
    return pts;
  };
  const [nose, fy] = [G + M.nose, G + M.front];
  const [edge, brow] = [hl - M.cab, hl - M.lean]; // (the roof's edge, the windscreen's top)
  const stations = [
    [-hl, G + 50, top - 8, hw - 6, 34],
    [-hl + 18, G + 45, top, hw, 34],
    [edge - 20, G + 45, top, hw, 34],
    [edge, G + 45, top - 4, hw - 2, 32],
    [(edge + brow) / 2, G + 45, fy + (top - fy) * 0.55, hw - 4, 30],
    [brow, G + 45, fy + 2, hw - 7, 27],
    [hl, G + 52, nose, hw - 14, 22],
  ];
  paint.color(M.tint);
  paint.loft(stations.map(([u, a, b, h, r]) => section(u, a, b, h, r)).map((s) => s.slice().reverse()), { capStart: true, capEnd: true });
  // The windscreen on its lean, the framed windows along both sides, the swoosh, the stripe, the
  // door on its right (+w, toward the house) behind the cab.
  const slope = (k, w) => {
    const [u0, y0] = [brow + 4, fy - 6];
    const [u1, y1] = [hl - 3, nose + 12];
    const n = norm(F.dir(y0 - y1, u1 - u0, 0));
    const p = F.at(u0 + (u1 - u0) * k, y0 + (y1 - y0) * k, w);
    return add(p, mul(n, 3));
  };
  carGlass.rgb(0.004, 0.005, 0.006);
  const screen = [slope(0.05, -hw + 28), slope(0.05, hw - 28), slope(0.94, hw - 24), slope(0.94, -hw + 24)];
  const out = F.dir(1, 1, 0);
  if (dot(cross(sub(screen[1], screen[0]), sub(screen[3], screen[0])), out) >= 0) carGlass.quad(...screen);
  else carGlass.quad(screen[1], screen[0], screen[3], screen[2]);
  const side = (s) => wallFrame(F.at(0, 0, s * (hw + 0.6)), F.dir(0, 0, s));
  for (const s of [-1, 1]) {
    const f = side(s);
    const U = (u) => s * u;
    const win = (a, b, v0, v1) => {
      const [u0, u1] = [Math.min(U(a), U(b)), Math.max(U(a), U(b))];
      paint.color(0xd4d6d4);
      fbox(paint, f, u0 - 6, u1 + 6, v0 - 6, v1 + 6, 0, 1.4, 'k');
      carGlass.quad(f.at(u0, v0, 1.6), f.at(u1, v0, 1.6), f.at(u1, v1, 1.6), f.at(u0, v1, 1.6));
    };
    for (const [a, b] of [[-hl + 90, -hl + 250], [-hl + 360, -hl + 520], [hl - 440, hl - 350]]) win(a, b, G + 260, G + 330);
    win(hl - 215, hl - 175, G + 250, G + 330);
    paint.color(0x8a7a68);
    const [a0, a1] = [Math.min(U(-hl + 20), U(hl - 140)), Math.max(U(-hl + 20), U(hl - 140))];
    paint.quad(f.at(a0, G + 150, 0.4), f.at(a1, G + 150, 0.4), f.at(a1, G + 164, 0.4), f.at(a0, G + 164, 0.4));
    paint.color(0x7a2224);
    for (const [u0, u1, dv] of [[-hl + 260, -hl + 600, 30], [-hl + 540, -hl + 760, -20]]) {
      const q = [f.at(U(u0), G + 176, 0.5), f.at(U(u1), G + 176 + dv, 0.5), f.at(U(u1), G + 186 + dv, 0.5), f.at(U(u0), G + 186, 0.5)];
      if (s > 0) paint.quad(q[0], q[1], q[2], q[3]);
      else paint.quad(q[1], q[0], q[3], q[2]);
    }
  }
  const right = side(1); // (its door side)
  paint.color(0xe2e4e0);
  fbox(paint, right, hl - 340, hl - 260, G + 52, G + 360, 0, 1.2, 'k');
  carGlass.quad(right.at(hl - 328, G + 260, 1.8), right.at(hl - 272, G + 260, 1.8), right.at(hl - 272, G + 330, 1.8), right.at(hl - 328, G + 330, 1.8));
  metal.color(0xb0aca4);
  fbox(metal, right, hl - 282, hl - 270, G + 170, G + 178, 1, 3, 'k');
  // The nose: headlights, a dark grille band, the bumper.
  const front = wallFrame(F.at(hl + 0.5, 0, 0), F.dir(1, 0, 0));
  paint.color(0x8a8e90);
  paint.quad(front.at(-hw + 18, G + 50), front.at(hw - 18, G + 50), front.at(hw - 18, G + 78), front.at(-hw + 18, G + 78));
  paint.color(0x2a2c30);
  paint.quad(front.at(-hw + 70, G + 100, 0.2), front.at(hw - 70, G + 100, 0.2), front.at(hw - 70, G + 120, 0.2), front.at(-hw + 70, G + 120, 0.2));
  metal.color(0xe8eaec);
  for (const s of [-1, 1]) {
    const [u0, u1] = s > 0 ? [hw - 68, hw - 22] : [-hw + 22, -hw + 68];
    metal.quad(front.at(u0, G + 96, 0.4), front.at(u1, G + 96, 0.4), front.at(u1, G + 122, 0.4), front.at(u0, G + 122, 0.4));
  }
  // The roof rail along its left and its back, the awning's box along its right edge (round 2
  // fix: the collider's, lane/props.js motorhome).
  const [rh, rt] = M.rail;
  steel.color(0xa4a8aa);
  fbox(steel, side(-1), -edge, hl, top - 24, top + rh, -rt - 0.6, 0);
  const back = wallFrame(F.at(-hl, 0, 0), F.dir(-1, 0, 0));
  fbox(steel, back, -hw, hw, top - 24, top + rh, -rt, 0.6);
  paint.color(0xc4c8c8);
  fbox(paint, right, -hl + 60, hl - 300, top - 8, top + M.awning[0], -M.awning[1] - 0.6, 5.4);
  // The roof's hatches.
  paint.color(0xe0e0dc);
  for (const u of [-hl + 220, -hl + 560]) {
    const c = F.at(u, top, 0);
    paint.box(c[0] - 34, c[0] + 34, top - 2, top + 14, c[2] - 34, c[2] + 34);
  }
  // Wheels in dark arches.
  for (const u of [-hl + 170, hl - 230]) {
    for (const s of [-1, 1]) {
      const c = F.at(u, G + 42, s * (hw - 12));
      const o = F.dir(0, 0, s * 12);
      tyre.rgb(0.03, 0.03, 0.03);
      tyre.tube([c[0] - o[0], c[1], c[2] - o[2]], [c[0] + o[0], c[1], c[2] + o[2]], 42, 42, 16, { caps: true });
      rim.rgb(0.5, 0.5, 0.52);
      rim.tube([c[0] + o[0], c[1], c[2] + o[2]], [c[0] + o[0] * 1.08, c[1], c[2] + o[2] * 1.08], 24, 24, 12, { caps: true });
    }
  }
  // The back: a small window, the ladder up to the rail.
  carGlass.quad(back.at(-60, G + 280, 0.6), back.at(20, G + 280, 0.6), back.at(20, G + 330, 0.6), back.at(-60, G + 330, 0.6));
  steel.color(0x9a9ea0);
  for (const u of [60, 110]) steel.tube(back.at(u, G + 100, 10), back.at(u, top + rh, 10), 3, 3, 6);
  for (let v = 120; v < M.h; v += 80) steel.tube(back.at(57, G + v, 10), back.at(113, G + v, 10), 2.5, 2.5, 6);
}

// (W8: the light grey mailbox on the forecourt wall's pillar, photos 29-31: a folded steel box
// under a curved lid, its slot and a lock, blank.)
export function cabinet({ steel, metal }, L) {
  const C = L.CABINET;
  const W = FORECOURT_WALL;
  const d = [W.to[0] - W.from[0], W.to[1] - W.from[1]];
  const f = frameOf({ cx: C.x, cz: C.z, yaw: Math.atan2(d[0], d[1]) });
  const y = W.pillarTop;
  const front = wallFrame(f.at(25, 0, 0), f.dir(1, 0, 0));
  steel.color(0xcdc8c2);
  fbox(steel, front, -37, 37, y, y + 42, -50, 0, 'b');
  // The lid: an arc across it, its ends closed.
  const arc = Array.from({ length: 7 }, (_, i) => [-25 + (50 * i) / 6, y + 42 + Math.sin((i / 6) * Math.PI) * 12]);
  for (let i = 0; i < 6; i++) {
    const [p, q] = [arc[i], arc[i + 1]];
    steel.quad(f.at(q[0], q[1], -39), f.at(p[0], p[1], -39), f.at(p[0], p[1], 39), f.at(q[0], q[1], 39));
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const [p, q] = [arc[i], arc[i + 1]];
      const t = [f.at(0, y + 42, s * 39), f.at(p[0], p[1], s * 39), f.at(q[0], q[1], s * 39)];
      if (s > 0) steel.tri(t[0], t[2], t[1]);
      else steel.tri(t[0], t[1], t[2]);
    }
  }
  metal.rgb(0.03, 0.03, 0.03);
  metal.quad(front.at(-24, y + 30, 0.3), front.at(24, y + 30, 0.3), front.at(24, y + 34, 0.3), front.at(-24, y + 34, 0.3));
  metal.color(0xb0aca4);
  fbox(metal, front, 20, 26, y + 12, y + 20, 0, 2, 'k');
}

// The far tree line: firs in a ring out where the lane's ground ends in the haze, so no edge of
// it shows from up on a roof; a seeded scatter, none on the road running on into the fog.
export function treeLine(L, tier) {
  const R = makeRng(0x5ba79);
  const count = tier === 'low' ? 60 : 110;
  const [cx, cz] = [-1050, -200];
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  let n = 0;
  const clear = L.EDGE_FOREST.clear;
  for (let tries = 0, placed = 0; placed < count && tries < count * 4; tries++) {
    const a = R() * Math.PI * 2;
    const d = 11500 + R() * 4500;
    const [x, z] = [cx + Math.cos(a) * d * 1.15, cz + Math.sin(a) * d * 0.8];
    const [h, r, turn, t] = [1300 + R() * 900, 330 + R() * 160, R(), R()];
    // (Not on the road on into the fog, not up the forest's bank (it rises on past its heights),
    // not off the lane's ground; none in the edge forest's clear sector, W4: the sky over the
    // garage row from the dad's drive (its spots dropped, the others where they were).)
    if (L.roadDistance(x, z, oldDrawn(L)) < L.ROAD.half + 600 || z < -6000 || Math.abs(x) > 15500 || z > 9500) continue;
    placed++;
    if ((clear && x > clear.x0 && x < clear.x1 && z > clear.z0) || offTheEnds(L, x, z, 600)) continue;
    const base = L.groundHeight(x, z) - 10;
    const [c, s] = [Math.cos(turn * Math.PI * 2), Math.sin(turn * Math.PI * 2)];
    matrices.set([c * r, 0, -s * r, 0, 0, h, 0, 0, s * r, 0, c * r, 0, x, base, z, 1], n * 16);
    colors.set([0.8 + 0.25 * t, 0.85 + 0.2 * t, 0.8 + 0.2 * t], n * 3);
    n++;
  }
  return { matrices: matrices.slice(0, n * 16), colors: colors.slice(0, n * 3) };
}
