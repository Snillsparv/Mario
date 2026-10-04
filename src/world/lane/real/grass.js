// The realistic look's grass blades (world/lane/real/detail.js builds them in the worker): the
// lawn texture carries the lawns from afar; near the camera a grid of blade clumps that follows
// it stands on them (render/real/materials.js grassMaterial places, turns and fades each clump in
// its vertex shader: no work on the main thread a frame but a uniform).
//
//   grassClump(tier) -> Geo | null     // one clump of blades round its foot (none on low)
//   lawnMask(L) -> { width, height, x0, z0, x1, z1, data }   // a top-down RGBA8 map of the lane
//                                      // (local x0..x1 across, z0..z1 down): R 255 where blades
//                                      // grow (the lawns and the terraces' gardens, clear of every
//                                      // road, path, drive, wall, house, hedge, bush, bed and
//                                      // post), G the ground's height / 4 (everywhere inside the
//                                      // boundary), B the road's wheel track (a darker, smoother
//                                      // band down its middle and a ring round the turning
//                                      // area), A where a lawn lies damp (along the hedges): the
//                                      // grass's map and the weathering's ground map
//                                      // (materials.js WEAR), made on every tier
//   GRASS = { high, mid }              // the grid per tier: side clumps a side, cell units each,
//                                      // radius (blades fade out from 0.7 of it)
//
// A clump: `blades` blades round its foot, each `segs` segments tapering to a tip, bending a
// little, 5 to 9.5 tall (a mown lawn), dark at the foot and lighter to the tip in the lawn
// texture's greens (look.js matches them), normals up (no dark back faces); the tips sway.

import { Geo } from './geo.js';
import { makeRng } from '../../../core/math.js';
import { frameOf } from './house.js';

export const GRASS = Object.freeze({
  high: Object.freeze({ side: 128, cell: 12, radius: 760, blades: 4, segs: 3 }),
  mid: Object.freeze({ side: 80, cell: 12, radius: 480, blades: 3, segs: 2 }),
});

export function grassClump(tier) {
  const G = GRASS[tier];
  if (!G) return null;
  const R = makeRng(1234);
  const g = new Geo();
  for (let b = 0; b < G.blades; b++) {
    const a = (b / G.blades) * Math.PI * 2 + R();
    const [ox, oz] = [Math.cos(a) * 2.5, Math.sin(a) * 2.5];
    const h = 5 + R() * 4.5;
    const [fx, fz] = [Math.cos(a + Math.PI / 2) * 1.3, Math.sin(a + Math.PI / 2) * 1.3];
    const [lx, lz] = [Math.cos(a) * 3, Math.sin(a) * 3];
    const at = (t, side) => [ox + fx * (1 - t) * side + lx * t * t, h * t, oz + fz * (1 - t) * side + lz * t * t];
    for (let s = 0; s < G.segs; s++) {
      const [t0, t1] = [s / G.segs, (s + 1) / G.segs];
      // (Lighter toward the tips: dark spiky tufts read against the lawn at a person's height.)
      const k0 = 0.7 + 0.55 * t0;
      const k1 = 0.7 + 0.55 * t1;
      const q = [at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)];
      const up = [0, 1, 0];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const k = i < 2 ? k0 : k1;
        g.rgb(0.15 * k, 0.33 * k, 0.055 * k);
        g.sway = (i < 2 ? t0 : t1) ** 2;
        g.vertex(q[i], up, [0, 0]);
      }
    }
  }
  g.sway = 0;
  return g;
}

const MASK = { width: 1024, height: 512, x0: -9200, x1: 8200, z0: -4200, z1: 3800, margin: 16 };

export function lawnMask(L) {
  const { width: W, height: H, x0, x1, z0, z1, margin: m } = MASK;
  const sx = (x1 - x0) / W;
  const sz = (z1 - z0) / H;
  const grow = new Uint8Array(W * H);
  const heights = new Float32Array(W * H);
  const ground = new Float32Array(W * H);
  const track = new Float32Array(W * H);
  // Where the ground is lawn: inside the boundary (row by row: where the row crosses its
  // edges), off the road, the turning area, the pavement and the footpath.
  const P = L.FOOTPATH;
  const segs = [];
  for (let i = 0; i + 1 < L.ROAD_DRAWN.length; i++) {
    const [ax, az] = L.ROAD_DRAWN[i];
    const [bx, bz] = L.ROAD_DRAWN[i + 1];
    segs.push([ax, az, bx - ax, bz - az, (bx - ax) ** 2 + (bz - az) ** 2]);
  }
  // The road's distance matters only below `reach` (the kerbs' and the pavement's): each row
  // asks the segments that come that near it (`near`, by z), the others being farther anyway.
  const reach = Math.max(L.ROAD.half + L.KERB.w, L.PAVEMENT.to) + m;
  let near = segs;
  const roadAt = (x, z) => {
    let best = Infinity;
    for (const [ax, az, ex, ez, l2] of near) {
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const dx = x - ax - ex * t;
      const dz = z - az - ez * t;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };
  const B = L.BOUNDS;
  const turn = (L.TURN.r + L.KERB.w + m) ** 2;
  for (let j = 0; j < H; j++) {
    const z = z0 + (j + 0.5) * sz;
    near = segs.filter(([, az, , ez]) => Math.min(az, az + ez) - reach < z && Math.max(az, az + ez) + reach > z);
    const cross = [];
    for (let e = 0; e < B.length; e++) {
      const [ax, az] = B[e];
      const [bx, bz] = B[(e + 1) % B.length];
      if (az > z !== bz > z) cross.push(ax + ((z - az) * (bx - ax)) / (bz - az));
    }
    cross.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cross.length; c += 2) {
      const i0 = Math.max(0, Math.ceil((cross[c] - x0) / sx - 0.5));
      const i1 = Math.min(W - 1, Math.floor((cross[c + 1] - x0) / sx - 0.5));
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * sx;
        const road = roadAt(x, z);
        const k0 = j * W + i;
        const tr = Math.hypot(x - L.TURN.x, z - L.TURN.z);
        // The ground's height everywhere (the road and the turning area at 0), and the wheel
        // track on them.
        const onRoad = road <= L.ROAD.half || tr <= L.TURN.r;
        ground[k0] = onRoad ? 0 : L.offRoadHeight(x, z);
        if (onRoad) track[k0] = Math.max(Math.exp(-((road / (0.42 * L.ROAD.half)) ** 2)) * (road <= L.ROAD.half ? 1 : 0), 0.75 * Math.exp(-(((tr - 0.55 * L.TURN.r) / (0.18 * L.TURN.r)) ** 2)) * (tr <= L.TURN.r ? 1 : 0));
        if (road < L.ROAD.half + L.KERB.w + m || (x - L.TURN.x) ** 2 + (z - L.TURN.z) ** 2 < turn) continue;
        // The pavement: along the bend and the straight on the north side.
        if (z < 0 && road < L.PAVEMENT.to + m && x < L.PAVEMENT.x1 + m) continue;
        const px = x - P.x;
        const pz = z - P.z;
        if (px * P.dir[0] + pz * P.dir[1] > P.from - m && Math.abs(-px * P.dir[1] + pz * P.dir[0]) < P.half + m) continue;
        const k = j * W + i;
        grow[k] = 1;
        heights[k] = L.offRoadHeight(x, z); // (off the road and the turning area)
      }
    }
  }
  // No blades where the ground steps (more than 12 in 30: the terraces' walls, the drives'
  // sides, the steps; the back gardens' ramp keeps them) or near the lawn's edge.
  const step = Math.ceil(30 / sx);
  const mask = new Uint8Array(W * H * 4);
  const level = (a, b, h) => a >= 0 && a < W && b >= 0 && b < H && grow[b * W + a] === 1 && Math.abs(heights[b * W + a] - h) <= 12;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const h = heights[k];
      const ok = grow[k] === 1 && level(i + step, j, h) && level(i - step, j, h) && level(i, j + step, h) && level(i, j - step, h);
      mask[k * 4] = ok ? 255 : 0;
      mask[k * 4 + 1] = Math.max(0, Math.min(255, Math.round((grow[k] ? h : ground[k]) / 4)));
      mask[k * 4 + 2] = Math.round(track[k] * 255);
      // Damp along the hedges (their shade, the drip from them).
      if (grow[k]) {
        const x = x0 + (i + 0.5) * sx;
        const z = z0 + (j + 0.5) * sz;
        let damp = 0;
        for (const e of L.HEDGES) {
          const d = Math.hypot(Math.max(e.x0 - x, 0, x - e.x1), Math.max(e.z0 - z, 0, z - e.z1));
          damp = Math.max(damp, 1 - Math.min(1, d / 160));
        }
        mask[k * 4 + 3] = Math.round(damp * damp * 255);
      }
    }
  }
  // Stamp out everything standing on the lawns.
  const clear = (inside, bx0, bx1, bz0, bz1) => {
    const i0 = Math.max(0, Math.floor((bx0 - m - x0) / sx));
    const i1 = Math.min(W - 1, Math.ceil((bx1 + m - x0) / sx));
    const j0 = Math.max(0, Math.floor((bz0 - m - z0) / sz));
    const j1 = Math.min(H - 1, Math.ceil((bz1 + m - z0) / sz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (inside(x0 + (i + 0.5) * sx, z0 + (j + 0.5) * sz)) mask[(j * W + i) * 4] = 0;
    }
  };
  const rect = ({ x0: a, x1: b, z0: c, z1: d }, pad = 0) => clear((x, z) => x > a - m - pad && x < b + m + pad && z > c - m - pad && z < d + m + pad, a - pad, b + pad, c - pad, d + pad);
  const disc = (cx, cz, r) => clear((x, z) => Math.hypot(x - cx, z - cz) < r + m, cx - r, cx + r, cz - r, cz + r);
  // A house's footprint in its own frame (u across w), with a margin for its plinth and pipes.
  const footprint = (h, w, d, pad = 30) => {
    const F = frameOf(h);
    const [ox, , oz] = F.at(0, 0, 0);
    const [ux, , uz] = F.dir(1, 0, 0);
    const reach = Math.hypot(w, d) / 2 + pad + m;
    clear((x, z) => Math.abs((x - ox) * ux + (z - oz) * uz) < w / 2 + pad + m && Math.abs(-(x - ox) * uz + (z - oz) * ux) < d / 2 + pad + m, ox - reach, ox + reach, oz - reach, oz + reach);
  };
  for (const h of L.HOUSES) footprint(h, h.w + (h.veranda ? 2 * h.veranda.depth : 0), h.d);
  for (const r of [L.LINK, L.CARPORT, L.DAD_PATH, L.DAD_DRIVE, L.LINK_DRIVE, L.PATIO]) rect(r, 10);
  const EG = L.EAST_GARAGE;
  rect({ x0: L.TURN.x + 800, x1: EG.cx, z0: EG.cz - EG.w / 2, z1: EG.cz + EG.w / 2 });
  const NW = L.NORTH_WEST;
  const D = L.NORTH_WEST_DRIVE;
  footprint({ ...NW, cx: NW.cx, cz: NW.cz }, 2 * Math.max(-D.u0, D.u1) + 60, 2 * D.w1 + 60, 0);
  for (const h of L.HEDGES) rect(h, 12);
  for (const b of L.FLOWER_BEDS) rect(b, 10);
  for (const p of L.PLOTS_N) rect({ x0: p.drive[0], x1: p.drive[1], z0: L.villaOf(p).front, z1: L.wallZAt(p.drive[0]) }, 10);
  for (const t of L.THUJAS) disc(t.x, t.z, L.THUJA.r + 20);
  for (const t of L.TREES) disc(t.x, t.z, 90);
  for (const t of L.GARDEN_TREES) disc(t.x, t.z, t.kind === 'shrub' ? t.r + 20 : 60);
  disc(L.ROUND_BED.x, L.ROUND_BED.z, L.ROUND_BED.r + 10);
  disc(L.RHODODENDRON.x, L.RHODODENDRON.z, L.RHODODENDRON.r * 0.9);
  disc(L.MAILBOX.x, L.MAILBOX.z, 40);
  disc(L.POT.x, L.POT.z, 40);
  for (const p of [...L.LAMPS, ...L.FLAGPOLES, ...L.SIGNS, L.CABINET, L.PATH_SIGN]) disc(p.x, p.z, 50);
  for (const b of L.BINS) disc(b.x, b.z, 90);
  disc(L.HOOP.x, L.HOOP.z, 40);
  return { width: W, height: H, x0, z0, x1, z1, data: mask };
}
