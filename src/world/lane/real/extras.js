// The realistic look's garden toys and the bigger things on the drives (world/lane/real/detail.js
// builds them in the worker in place of lane/props.js's; their colliders stay the classic ones):
//
//   trampoline(kit, L)  // a steel tube frame on six legs, the dark woven mat sagging a touch in
//                       // its ring of springs, a padded blue cover over them
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

const BLUE = 0x2f62b0;
const MAT = 0x1c2026;

// A ring of points round (x, z) at y, radius r, `sides` round (counter-clockwise seen from
// below: a loft from the bottom up faces out).
const ring = (x, y, z, r, sides) => Array.from({ length: sides }, (_, i) => {
  const a = -(i / sides) * Math.PI * 2;
  return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
});

export function trampoline({ paint, steel }, L) {
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
  paint.color(BLUE);
  paint.loft([ring(T.x, T.y - 26, T.z, T.r, 24), ring(T.x, T.y - 6, T.z, T.r + 1, 24), ring(T.x, T.y + 1, T.z, T.r - 10, 24), ring(T.x, T.y + 1, T.z, mat + 8, 24), ring(T.x, T.y - 1, T.z, mat, 24)]);
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

export function motorhome({ paint, carGlass, tyre, rim, steel }, L) {
  const M = L.MOTORHOME;
  const G = L.GROUND;
  const F = frameOf({ cx: M.cx, cz: M.cz, yaw: M.yaw, w: M.l, d: M.w });
  const [hl, hw] = [M.l / 2, M.w / 2];
  const top = G + M.h;
  // The body: rounded sections along it (u), the cab end (-u) a sloping screen under the bed's
  // overhang.
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
  const stations = [
    [-hl, G + 45, G + 300, hw - 20, 30],
    [-hl + 15, G + 45, G + 320, hw - 5, 30],
    [-hl + 60, G + 45, top - 40, hw, 30],
    [-hl + 110, G + 45, top, hw, 34],
    [hl - 20, G + 45, top, hw, 34],
    [hl, G + 50, top - 6, hw - 6, 34],
  ];
  paint.color(0xf4f4f0);
  paint.loft(stations.map(([u, a, b, h, r]) => section(u, a, b, h, r)).map((s) => s.slice().reverse()), { capStart: true, capEnd: true });
  // The window band round its living part, the screen, the door, the stripe.
  const side = (s) => wallFrame(F.at(0, 0, s * (hw + 0.6)), F.dir(0, 0, s));
  carGlass.rgb(0.004, 0.005, 0.006);
  for (const s of [-1, 1]) {
    const f = side(s);
    for (const [a, b] of [[-hl + 150, -hl + 380], [-hl + 470, hl - 160]]) {
      const [u0, u1] = s > 0 ? [a, b] : [-b, -a];
      carGlass.quad(f.at(u0, top - 190), f.at(u1, top - 190), f.at(u1, top - 120), f.at(u0, top - 120));
    }
    paint.color(0x8a7a68);
    paint.quad(f.at(-hl + 30, G + 140), f.at(hl - 30, G + 140), f.at(hl - 30, G + 158), f.at(-hl + 30, G + 158));
  }
  const cab = wallFrame(F.at(-hl - 0.5, 0, 0), F.dir(-1, 0, 0));
  carGlass.quad(cab.at(-hw + 40, G + 170), cab.at(hw - 40, G + 170), cab.at(hw - 44, G + 280), cab.at(-hw + 44, G + 280));
  const road = side(1);
  paint.color(0xd8dad6);
  paint.quad(road.at(-hl + 250, G + 60), road.at(-hl + 340, G + 60), road.at(-hl + 340, G + 330), road.at(-hl + 250, G + 330));
  // Wheels in dark arches.
  for (const u of [-hl + 140, hl - 160]) {
    for (const s of [-1, 1]) {
      const c = F.at(u, G + 42, s * (hw - 12));
      const o = F.dir(0, 0, s * 12);
      tyre.rgb(0.03, 0.03, 0.03);
      tyre.tube([c[0] - o[0], c[1], c[2] - o[2]], [c[0] + o[0], c[1], c[2] + o[2]], 42, 42, 16, { caps: true });
      rim.rgb(0.5, 0.5, 0.52);
      rim.tube([c[0] + o[0], c[1], c[2] + o[2]], [c[0] + o[0] * 1.08, c[1], c[2] + o[2] * 1.08], 24, 24, 12, { caps: true });
    }
  }
  // The ladder up its back.
  const back = wallFrame(F.at(hl, 0, 0), F.dir(1, 0, 0));
  steel.color(0x9a9ea0);
  for (const u of [50, 100]) steel.tube(back.at(u, G + 100, 10), back.at(u, top + 30, 10), 3, 3, 6);
  for (const v of [120, 220, 320, 420]) steel.tube(back.at(47, G + v, 10), back.at(103, G + v, 10), 2.5, 2.5, 6);
}

export function cabinet({ steel, metal }, L) {
  const { CABINET: C, FOOTPATH: P, GROUND: G } = L;
  const f = frameOf({ cx: C.x, cz: C.z, yaw: Math.atan2(P.dir[1], -P.dir[0]) });
  const front = wallFrame(f.at(0, 0, 20), f.dir(0, 0, 1));
  steel.color(0x8a8e8a);
  fbox(steel, front, -40, 40, G + 60, G + 200, -40, 0);
  fbox(steel, front, -43, 43, G + 200, G + 206, -43, 3);
  // The doors' seams and a lock.
  metal.rgb(0.03, 0.03, 0.03);
  for (const u of [-38, 0, 38]) metal.quad(front.at(u - 0.8, G + 64, 0.3), front.at(u + 0.8, G + 64, 0.3), front.at(u + 0.8, G + 196, 0.3), front.at(u - 0.8, G + 196, 0.3));
  metal.color(0xb0aca4);
  fbox(metal, front, 6, 12, G + 125, G + 140, 0, 2, 'k');
}

// The far tree line: firs in a ring out where the lane's ground ends in the haze, so no edge of
// it shows from up on a roof; a seeded scatter, none on the road running on into the fog.
export function treeLine(L, tier) {
  const R = makeRng(0x5ba79);
  const count = tier === 'low' ? 60 : 110;
  const [cx, cz] = [-800, -200];
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  let n = 0;
  for (let tries = 0; n < count && tries < count * 4; tries++) {
    const a = R() * Math.PI * 2;
    const d = 11500 + R() * 4500;
    const [x, z] = [cx + Math.cos(a) * d * 1.15, cz + Math.sin(a) * d * 0.8];
    const [h, r, turn, t] = [1300 + R() * 900, 330 + R() * 160, R(), R()];
    // (Not on the road on into the fog, not up the forest's bank (it rises on past its heights),
    // not off the lane's ground.)
    if (L.roadDistance(x, z, L.ROAD_DRAWN) < L.ROAD.half + 600 || z < -6000 || Math.abs(x) > 15500 || z > 9500) continue;
    const base = L.groundHeight(x, z) - 10;
    const [c, s] = [Math.cos(turn * Math.PI * 2), Math.sin(turn * Math.PI * 2)];
    matrices.set([c * r, 0, -s * r, 0, 0, h, 0, 0, s * r, 0, c * r, 0, x, base, z, 1], n * 16);
    colors.set([0.8 + 0.25 * t, 0.85 + 0.2 * t, 0.8 + 0.2 * t], n * 3);
    n++;
  }
  return { matrices: matrices.slice(0, n * 16), colors: colors.slice(0, n * 3) };
}
