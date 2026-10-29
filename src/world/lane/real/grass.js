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
// little, 2.2 to 4.5 tall and slim (P1, photos 19, 21, 41: a short mown lawn, no tall dark
// spikes at a person's height), a little darker at the foot than at the tip in the lawn
// texture's greens (look.js matches them; the lawn's mean tone kept), normals up (no dark back
// faces); the tips sway.

import { Geo } from './geo.js';
import { makeRng } from '../../../core/math.js';
import { frameOf } from './house.js';
import { GRASS } from './grassTiers.js';
import { STRIP } from '../facades.js';
import { forestSpots } from './spots.js';
import { SHOULDER } from '../surface.js';
import { LINE_HEDGES, GRAVEL_PATH, GARDEN_THINGS, FORECOURT_WALL } from '../ends.js';

export { GRASS }; // (its data lives in grassTiers.js, which the realLook chunk imports)

export function grassClump(tier) {
  const G = GRASS[tier];
  if (!G) return null;
  const R = makeRng(1234);
  const g = new Geo();
  for (let b = 0; b < G.blades; b++) {
    const a = (b / G.blades) * Math.PI * 2 + R();
    const [ox, oz] = [Math.cos(a) * 2.5, Math.sin(a) * 2.5];
    const h = 2.2 + R() * 2.3;
    const [fx, fz] = [Math.cos(a + Math.PI / 2) * 0.85, Math.sin(a + Math.PI / 2) * 0.85];
    const [lx, lz] = [Math.cos(a) * 2, Math.sin(a) * 2];
    const at = (t, side) => [ox + fx * (1 - t) * side + lx * t * t, h * t, oz + fz * (1 - t) * side + lz * t * t];
    for (let s = 0; s < G.segs; s++) {
      const [t0, t1] = [s / G.segs, (s + 1) / G.segs];
      // (A little lighter toward the tips: P1, 0.8 -> 1.05, the old 0.7 -> 1.25's mean over the
      // tapering blade.)
      const k0 = 0.8 + 0.25 * t0;
      const k1 = 0.8 + 0.25 * t1;
      const q = [at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)];
      const up = [0, 1, 0];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const k = i < 2 ? k0 : k1;
        g.rgb(0.125 * k, 0.21 * k, 0.018 * k);
        g.sway = (i < 2 ? t0 : t1) ** 2;
        g.vertex(q[i], up, [0, 0]);
      }
    }
  }
  g.sway = 0;
  return g;
}

const MASK = { width: 1280, height: 608, x0: -12000, x1: 9900, z0: -5000, z1: 4600, margin: 16 };

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
  // Which side of the road's line (x, z) lies: negative north of it (its segments run east).
  const roadSide = (x, z) => {
    let best = Infinity;
    let side = 0;
    for (const [ax, az, ex, ez, l2] of near) {
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2;
      if (d < best) {
        best = d;
        side = ex * (z - az) - ez * (x - ax);
      }
    }
    return side;
  };
  const B = L.BOUNDS;
  const A = L.APRON;
  // (The apron's distance: none inside it; its kerbs' margin out from its outline.)
  const apronNear = (x, z, d) => x > A.x0 - d && x < A.x1 + d && z > A.z0 - d && z < A.z1 + d && (L.inApron(x, z) || [[d, 0], [-d, 0], [0, d], [0, -d], [d * 0.7, d * 0.7], [-d * 0.7, d * 0.7], [d * 0.7, -d * 0.7], [-d * 0.7, -d * 0.7]].some(([dx, dz]) => L.inApron(x + dx, z + dz)));
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
        // The ground's height everywhere (the road and the apron at 0), and the wheel track on
        // them (the apron's: a ring round its coins' ring, where cars turn).
        const apron = L.inApron(x, z);
        const onRoad = road <= L.ROAD.half || apron;
        ground[k0] = onRoad ? 0 : L.offRoadHeight(x, z);
        if (onRoad) {
          const R = A.ring;
          const tr = Math.hypot(x - R.x, z - R.z);
          track[k0] = Math.max(Math.exp(-((road / (0.42 * L.ROAD.half)) ** 2)) * (road <= L.ROAD.half ? 1 : 0), apron ? 0.75 * Math.exp(-(((tr - R.r) / (0.25 * R.r)) ** 2)) : 0);
        }
        if (road < L.ROAD.half + L.KERB.w + m || apronNear(x, z, L.KERB.w + m)) continue;
        // The pavement: along the west leg, the bend and the straight on the north side, and on
        // over the apron's kerb's S to the wall.
        if (x < L.PAVEMENT.x1 + m && road < L.PAVEMENT.to + m && roadSide(x, z) < 0) continue;
        if (x >= L.PAVEMENT.x1 - m && x < L.APRON.curve[1] + m && z < L.APRON.kerb + m && z > L.wallZAt(x) - m) continue;
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
  for (const h of L.HOUSES) footprint(h, h.w, h.d);
  for (const r of [L.LINK, L.CARPORT, L.DAD_DRIVE, L.LINK_DRIVE, L.PATIO]) rect(r, 10);
  const [p0, p1] = L.DAD_PATH.drawn; // (P2: the dad's path drawn narrower, the lawn over its outer strips)
  rect({ ...L.DAD_PATH, x0: p0, x1: p1 }, 6);
  rect(L.FORECOURT, 10);
  // (W8: the forecourt's setts on down to its wall, the wall and its pillar; the hedges along a
  // line; the gravel path north from the side road's mouth; the shed and the picnic table.)
  const strip = ([ax, az], [bx, bz], half) => {
    const [ex, ez] = [bx - ax, bz - az];
    const l2 = ex * ex + ez * ez;
    clear((x, z) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      return Math.hypot(x - ax - ex * t, z - az - ez * t) < half + m;
    }, Math.min(ax, bx) - half, Math.max(ax, bx) + half, Math.min(az, bz) - half, Math.max(az, bz) + half);
  };
  const FW = FORECOURT_WALL;
  rect({ x0: L.FORECOURT.setts, x1: L.FORECOURT.x1, z0: L.FORECOURT.z1, z1: Math.max(FW.from[1], FW.to[1]) }, 10);
  strip(FW.from, FW.to, FW.thick / 2 + 12);
  disc(L.CABINET.x, L.CABINET.z, FW.pillar * 0.75);
  for (const h of LINE_HEDGES) strip(h.from, h.to, h.depth / 2 + 12);
  const GP = GRAVEL_PATH;
  strip([GP.x, GP.z], [GP.x + GP.dir[0] * GP.len, GP.z + GP.dir[1] * GP.len], GP.half + 6);
  for (const t of GARDEN_THINGS) if (t.kind === 'shed' || t.kind === 'picnic') disc(t.x, t.z, t.kind === 'shed' ? 380 : 170);
  rect({ x0: L.FOOTWAY.x0, x1: L.FOOTWAY.x1, z0: L.FORECOURT.z1, z1: L.FOOTPATH.z }, 10);
  const NW = L.NORTH_WEST;
  const D = L.NORTH_WEST_DRIVE;
  const mid = (D.u0 + D.u1) / 2; // (round 2: the drive's own span along the front, the house's middle moved west)
  footprint({ ...NW, cx: NW.cx + Math.cos(NW.yaw) * mid, cz: NW.cz - Math.sin(NW.yaw) * mid }, D.u1 - D.u0 + 60, 2 * D.w1 + 60, 0);
  for (const h of L.HEDGES) rect(h, 12);
  for (const b of L.FLOWER_BEDS) rect(b, 10);
  for (const p of L.PLOTS_N) rect({ x0: p.drive[0], x1: p.drive[1], z0: L.villaOf(p).front, z1: L.wallZAt(p.drive[0]) }, 10);
  // (The steps up to the terraces: their ramp is no lawn.)
  for (const p of L.PLOTS_N) {
    const [w0, w1] = [L.wallZAt(p.steps[0]), L.wallZAt(p.steps[1])];
    rect({ x0: p.steps[0], x1: p.steps[1], z0: Math.min(w0, w1) - L.STEPS.run, z1: Math.max(w0, w1) }, 10);
  }
  for (const t of L.THUJAS) disc(t.x, t.z, L.THUJA.r + 20);
  for (const t of L.TREES) disc(t.x, t.z, 90);
  for (const t of L.GARDEN_TREES) disc(t.x, t.z, t.kind === 'shrub' ? t.r + 20 : 60);
  // (W7: the side yards' forest trees, the bend's gravel shoulder on the lawn by the south edge;
  // the kerbside furniture stands on the pavement.)
  const F = forestSpots(L);
  for (const t of [...F.broad, ...F.pines]) if (t.solid) disc(t.x, t.z, 60);
  clear((x, z) => x > SHOULDER.x0 && x < SHOULDER.x1 && L.roadDistance(x, z) < L.ROAD.half + SHOULDER.w + 10, SHOULDER.x0, SHOULDER.x1, -1000, 1000);
  // The dad's front garden (W3): the bed (its outline and its stones' row round it), the
  // rhododendron, the ivy mound, the rose, the mailbox, the landing.
  const bed = L.BED;
  rect(bed, 30);
  const rh = L.RHODODENDRON;
  clear((x, z) => ((x - rh.x) / (rh.rx * 0.9 + m)) ** 2 + ((z - rh.z) / (rh.rz * 0.9 + m)) ** 2 < 1, rh.x - rh.rx, rh.x + rh.rx, rh.z - rh.rz, rh.z + rh.rz);
  const iv = L.IVY;
  clear((x, z) => ((x - iv.x) / (iv.rx + m)) ** 2 + ((z - iv.z) / (iv.rz + m)) ** 2 < 1, iv.x - iv.rx, iv.x + iv.rx, iv.z - iv.rz, iv.z + iv.rz);
  disc(L.ROSE.x, L.ROSE.z, L.ROSE.r * 0.6);
  disc(L.MAILBOX.x, L.MAILBOX.z, 45);
  rect(L.LANDING, 14);
  for (const p of [...L.LAMPS, ...L.FLAGPOLES, ...L.SIGNS, L.CABINET, L.PATH_SIGN]) disc(p.x, p.z, 50);
  for (const b of L.BINS) disc(b.x, b.z, 90);
  // (W5: south_2's gravel, path, raised bed and bed; its shrubs; the beech row's soil strip.)
  const S2 = L.S2_GARDEN;
  for (const r of [S2.gravel, S2.path, S2.raised, S2.bed, S2.paving]) rect(r, 8);
  rect({ x0: S2.edging.x0, x1: S2.edging.x1, z0: S2.edging.z, z1: S2.edging.z + S2.edging.w }, 6);
  const s2 = S2.rhododendron;
  clear((x, z) => ((x - s2.x) / (s2.rx + m)) ** 2 + ((z - s2.z) / (s2.rz + m)) ** 2 < 1, s2.x - s2.rx, s2.x + s2.rx, s2.z - s2.rz, s2.z + s2.rz);
  disc(S2.yew.x, S2.yew.z, S2.yew.r);
  const BR = L.BEECH_ROW;
  rect({ x0: BR.x0, x1: BR.x1, z0: BR.soil[0], z1: BR.soil[1] }, 6);
  disc(L.HOOP.x, L.HOOP.z, 40);
  // (W6: the planted strip behind the terraces' low bed walls: drawn lower than the terrace.)
  const x0n = L.PLOTS_N[0].x0;
  const x1n = L.PLOTS_N.at(-1).x1;
  clear((x, z) => x > x0n && x < x1n && z < L.wallZAt(x) + m && z > L.wallZAt(x) - STRIP - 25 - m, x0n, x1n, -1300 - STRIP, -700);
  return { width: W, height: H, x0, z0, x1, z1, data: mask };
}
