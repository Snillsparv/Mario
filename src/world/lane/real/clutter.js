// The realistic look's ground clutter and the blank street sign (world/lane/real/detail.js builds
// them in the worker; nothing of it is solid, the classic builders keep every collider): what
// makes a street lived in, from photos 19, 25 and 40's feel (never their pixels).
//
//   clutter(kit, L, ground)   // kit: detail.js's Geo per material (core: fallen leaves and the
//                             // weeds' grass blades; foliage: the weeds' leafy cards; patch: the
//                             // gutters' grit;
//                             // granite: the gravel strips; paint: the lawns' flowers);
//                             // ground: the lawn mask (grass.js lawnMask: where the lawns are,
//                             // the ground's height)
//   streetSign(kit, L)        // the street name sign at the junction: a grey post, a plate white
//                             // with a black border, both faces blank (no name: the repository
//                             // is public)
//   STREET_SIGN               // its place (x, z), the way its plate faces (yaw), the post's top
//                             // and the plate's size (tests)
//   SHARE = { high, mid, low } // the share of leaves and flowers per tier (no weeds, no flowers on
//                             // low)
//
// Fallen leaves drift along every kerb (on the road at the kerb's foot, a slow wave of density
// along it, most within 25 of the foot, strays to 70; fewer on the verge behind it), under the
// junction's trees, the birch and the apple tree, on the dad's path and his lawn's edge: flat
// diamonds in autumn colours (yellow, orange, browns, red, olive) lying on the ground, the tip
// curled up a little (plain, not leaf cards: the cards' light through the leaves made fallen
// ones glow when he looks toward the sun). A dark grit
// line wanders along the gutters (4 to 16 wide). Weeds stand in the kerbs' joints, at the feet of
// the terraces' walls and the houses' plinths, between the path's stones; dandelions and clover
// flower on the lawns. A gravel strip runs along the chain houses' walls where their lawns meet
// them (the grass stops short of a wall). No overhead wires and no road markings: the photos show
// none (a cul-de-sac with buried cables, an unmarked street).

import { roadPieces, normals, inside } from './plan.js';
import { frameOf } from './house.js';
import { makeRng } from '../../../core/math.js';

const CELL = { hedge: [0.5, 0] }; // (the leaf atlas's hedge cell: the weeds' leafy cards)
const UP = [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
// Fallen leaves' colours (linear): yellow, orange, brown, dark brown, red, olive.
const LEAF_COLOURS = [[0.55, 0.38, 0.07], [0.48, 0.2, 0.05], [0.3, 0.16, 0.06], [0.16, 0.09, 0.04], [0.42, 0.08, 0.04], [0.32, 0.27, 0.08]];
const RED_LEAVES = [[0.42, 0.08, 0.04], [0.32, 0.05, 0.03], [0.48, 0.2, 0.05]];
export const SHARE = Object.freeze({ high: 1, mid: 0.6, low: 0.25 });
const STEP = 8; // along the kerbs
const GRIT = { high: 24, mid: 48, low: 96 }; // the grit's pieces along them, per tier

// The street name sign: on the verge on the lane's north side, just in from the junction, its
// plate along the lane.
export const STREET_SIGN = Object.freeze({ x: -8030, z: 1415, yaw: Math.atan2(0.82, -0.573), top: 250, plate: [112, 26] });

// Inside a polygon ([x, z] points, any shape: crossings).
function within(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function clutter(kit, L, ground) {
  const R = makeRng(4243);
  const tier = kit.tier ?? 'high';
  const share = SHARE[tier] ?? 1;
  const low = tier === 'low';
  const lawnAt = (x, z) => {
    const i = Math.floor(((x - ground.x0) / (ground.x1 - ground.x0)) * ground.width);
    const j = Math.floor(((z - ground.z0) / (ground.z1 - ground.z0)) * ground.height);
    if (i < 0 || j < 0 || i >= ground.width || j >= ground.height) return null;
    const k = (j * ground.width + i) * 4;
    return ground.data[k] === 255 ? L.groundHeight(x, z) : null; // (a lawn's height, or none)
  };
  // (Never under a parked car: the east end's estate stands over the turning area's rim.)
  const underCar = (x, z) => L.CARS.some((c) => {
    const K = L.CAR_KINDS[c.kind];
    const along = (x - c.x) * Math.sin(c.yaw) + (z - c.z) * Math.cos(c.yaw);
    const across = (x - c.x) * Math.cos(c.yaw) - (z - c.z) * Math.sin(c.yaw);
    return Math.abs(along) < K.l / 2 + 12 && Math.abs(across) < K.w / 2 + 12;
  });
  // (Nor under a fence: the corner house's rails cross the side road's far end.)
  const fences = L.FENCES.map((f) => {
    const F = frameOf(L.HOUSES.find((h) => h.id === f.house));
    const [a, b] = [F.at(f.from[0], 0, f.from[1]), F.at(f.to[0], 0, f.to[1])];
    return [a[0], a[2], b[0], b[2]];
  });
  const byFence = (x, z) => fences.some(([ax, az, bx, bz]) => {
    const [ex, ez] = [bx - ax, bz - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(x - ax - ex * t, z - az - ez * t) < 40;
  });
  // A fallen leaf: a flat diamond (its tip, a side, its stem, the other side) in an autumn
  // colour, its tip curled up a little; `red`: the red-leaved trees' colours.
  const leaf = (x, y, z, s, red = false) => {
    if (underCar(x, z) || byFence(x, z)) return;
    const palette = red ? RED_LEAVES : LEAF_COLOURS;
    const t = palette[Math.floor(R() * palette.length)];
    const k = 0.8 + 0.3 * R();
    kit.core.rgb(t[0] * k, t[1] * k, t[2] * k);
    const turn = R() * Math.PI * 2;
    const [ax, az] = [Math.cos(turn) * s, Math.sin(turn) * s];
    const [cx, cz] = [-az * 0.42, ax * 0.42];
    const lift = R() * s * 0.18;
    const P = [[x + ax, y + lift, z + az], [x + cx, y, z + cz], [x - ax, y, z - az], [x - cx, y, z - cz]];
    // (Wound to face up.)
    const up = (P[1][2] - P[0][2]) * (P[3][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[3][2] - P[0][2]) > 0;
    if (up) kit.core.quad(P[0], P[1], P[2], P[3], { n: UP });
    else kit.core.quad(P[0], P[3], P[2], P[1], { n: UP });
  };
  // A weed: leafy cards crossed (a dandelion's rosette, a sprig) and a few grass blades.
  const weed = (x, y, z, h) => {
    if (low) return;
    const [u0, v0] = CELL.hedge;
    const g = 0.7 + 0.3 * R();
    kit.foliage.rgb(0.62 * g, 0.85 * g, 0.42 * g);
    for (let k = 0; k < 2; k++) {
      const a = R() * Math.PI + (k * Math.PI) / 2;
      const [dx, dz] = [Math.cos(a) * h * 0.55, Math.sin(a) * h * 0.55];
      kit.foliage.quad([x - dx, y - 1, z - dz], [x + dx, y - 1, z + dz], [x + dx, y + h * 0.8, z + dz], [x - dx, y + h * 0.8, z - dz], { uvs: [[u0 + 0.1, v0 + 0.1], [u0 + 0.4, v0 + 0.1], [u0 + 0.4, v0 + 0.4], [u0 + 0.1, v0 + 0.4]] });
    }
    for (let b = 0; b < 4; b++) {
      const a = R() * Math.PI * 2;
      const [lx, lz] = [Math.cos(a), Math.sin(a)];
      const hb = h * (0.8 + 0.6 * R());
      const tip = [x + lx * hb * 0.35, y + hb, z + lz * hb * 0.35];
      const [wx, wz] = [-lz * 1.2, lx * 1.2];
      const k = 0.75 + 0.3 * R();
      kit.core.rgb(0.1 * k, 0.2 * k, 0.04 * k);
      // (Both faces: the core material is one-sided.)
      kit.core.tri([x - wx, y - 1, z - wz], [x + wx, y - 1, z + wz], tip);
      kit.core.tri([x + wx, y - 1, z + wz], [x - wx, y - 1, z - wz], tip);
    }
  };

  // ---------------------------------------------------------------- along the kerbs
  const road = roadPieces(L, { round: true });
  const G = L.GROUND;
  for (const piece of road) {
    const ns = normals(piece);
    for (let i = 0; i < piece.length; i++) {
      const [ax, az] = piece[i];
      const [bx, bz] = piece[(i + 1) % piece.length];
      const n = ns[i];
      const len = Math.hypot(bx - ax, bz - az);
      const [tx, tz] = [(bx - ax) / len, (bz - az) / len];
      const steps = Math.max(1, Math.ceil(len / STEP));
      const phase = R() * 100;
      let grit = null;
      const flushGrit = (x1, z1, w1) => {
        if (!grit) return;
        const [x0, z0, w0] = grit;
        // (Wound up: from the kerb's foot out over the road, along the kerb.)
        const P = [[x0, z0, 0], [x1, z1, 0], [x1 - n[0] * w1, z1 - n[1] * w1, w1], [x0 - n[0] * w0, z0 - n[1] * w0, w0]];
        const q = P.map(([x, z]) => [x, 0.45, z]);
        const up = (q[1][0] - q[0][0]) * (q[3][2] - q[0][2]) - (q[1][2] - q[0][2]) * (q[3][0] - q[0][0]) < 0;
        kit.patch.rgb(0.3, 0.29, 0.27);
        if (up) kit.patch.quad(q[0], q[1], q[2], q[3], { n: UP, uvs: q.map((p) => [p[0], p[2]]) });
        else kit.patch.quad(q[1], q[0], q[3], q[2], { n: UP, uvs: [q[1], q[0], q[3], q[2]].map((p) => [p[0], p[2]]) });
        grit = null;
      };
      let joint = 0;
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        // (Not where this edge runs inside another piece, or within 15 of one: the junction, the
        // turning area's mouth, the sliver where the straight meets it; nor near the course's
        // bounds: the fog, the fences out there.)
        if (road.some((o) => o !== piece && inside(o, x + n[0] * 15, z + n[1] * 15)) || ![[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]].every(([dx, dz]) => within(L.BOUNDS, x + dx, z + dz))) {
          flushGrit(x, z, 0);
          continue;
        }
        // The grit: a dark band at the kerb's foot, its width wandering.
        const w = 12 + 7 * Math.sin(phase + k * 0.07) + 2 * Math.sin(phase * 2.3 + k * 0.31);
        if (!grit) grit = [x - tx * STEP * 0.5, z - tz * STEP * 0.5, w];
        else if ((k * STEP) % (GRIT[tier] ?? 24) < STEP) {
          flushGrit(x, z, w);
          grit = [x, z, w];
        }
        // Leaves: drifts along the kerb (a slow wave of density), most at its foot, a few strays
        // out on the road and on the verge behind it.
        const drift = Math.max(0, Math.sin(phase + k * 0.021) * 0.7 + Math.sin(phase * 1.7 + k * 0.053) * 0.5);
        const count = share * (drift * 5.5 + 0.4);
        const many = Math.floor(count + R()); // (rounded at random: on average `count`)
        for (let c = 0; c < many; c++) {
          const d = (piece.length > 8 ? 20 : 8) + Math.pow(R(), 2.2) * 62; // (the turning area drawn round, its colliders' 16-gon up to 11 inside it)
          const [lx, lz] = [x - n[0] * d + (R() - 0.5) * STEP, z - n[1] * d + (R() - 0.5) * STEP];
          const [y, s] = [0.65 + R() * 0.45, 3.5 + R() * 3.5];
          // (Its whole on the road, clear of every kerb: not in a corner where two meet.)
          if ([[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]].every(([dx, dz]) => road.some((o) => inside(o, lx + dx, lz + dz)))) leaf(lx, y, lz, s, R() < 0.2);
        }
        if (R() < share * drift * 0.35) {
          const d = L.KERB.w + 6 + R() * 40;
          const [vx, vz] = [x + n[0] * d, z + n[1] * d];
          const h = lawnAt(vx, vz);
          if (h !== null && Math.abs(h - G) < 2) leaf(vx, G + 0.8, vz, 3.5 + R() * 3.5, R() < 0.2);
        }
        // Weeds where two kerb stones meet (every ~150), now and then.
        joint += STEP;
        if (joint >= 150) {
          joint -= 150;
          if (R() < 0.45 * share) weed(x - n[0] * 1.5, 0.2, z - n[1] * 1.5, 7 + R() * 8);
        }
      }
      flushGrit(bx, bz, 8);
    }
  }

  // ---------------------------------------------------------------- under the trees
  const under = (x, z, r, n, red = false) => {
    for (let i = 0; i < Math.round(n * share); i++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R()) * r;
      const [px, pz] = [x + Math.sin(a) * d, z + Math.cos(a) * d];
      const h = lawnAt(px, pz);
      if (h !== null) leaf(px, h + 0.8, pz, 4 + R() * 3.5, red);
    }
  };
  for (const t of L.TREES) under(t.x, t.z, t.r * 0.9, 520);
  for (const t of L.GARDEN_TREES) if (t.kind !== 'shrub') under(t.x, t.z, t.r * 1.1, t.kind === 'birch' ? 200 : 260);
  // The dad's path and his lawn's edge along it (photo 40's leaves).
  const P = L.DAD_PATH;
  for (let i = 0; i < Math.round(70 * share); i++) {
    const x = P.x0 - 40 + R() * (P.x1 - P.x0 + 80);
    const z = P.z0 + 20 + R() * (P.z1 - P.z0 - 40);
    const onPath = x > P.x0 && x < P.x1;
    if (onPath || lawnAt(x, z) !== null) leaf(x, G + (onPath ? 1.2 : 0.8), z, 3.5 + R() * 3.5, R() < 0.5);
  }

  // ---------------------------------------------------------------- weeds by the walls
  // The terraces' walls' feet along the pavement (not at the drives' notches or the steps).
  for (const p of L.PLOTS_N) {
    for (let x = p.x0 + 40; x < p.x1 - 40; x += 90 + R() * 120) {
      if ((x > p.drive[0] - 30 && x < p.drive[1] + 30) || (x > p.steps[0] - 30 && x < p.steps[1] + 30)) continue;
      if (R() < 0.6 * share) weed(x, G + 0.3, L.wallZAt(x) + 4 + R() * 6, 8 + R() * 10);
    }
  }
  // The chain houses' plinths where a lawn meets them: a gravel strip and weeds in it.
  for (const h of L.HOUSES) {
    if (h.kit !== 'chain') continue;
    const F = frameOf(h);
    for (const name of ['front', 'back', 'left', 'right']) {
      const { f, half } = F.face(name);
      const W = 38;
      let run = null;
      const v = G + 0.5 - f.at(0, 0, 0)[1]; // (the strip just over the lawn)
      const flush = (u1) => {
        if (!run) return;
        const [u0] = run;
        const at = (u, w) => f.at(u, v, w);
        const q = [at(u1, 2), at(u0, 2), at(u0, W), at(u1, W)]; // (wound up)
        kit.granite.rgb(0.78, 0.76, 0.72);
        // (Its grain three times finer than the kerbs': gravel.)
        kit.granite.quad(q[0], q[1], q[2], q[3], { n: UP, uvs: q.map((p) => [p[0] * 3, p[2] * 3]) });
        run = null;
      };
      for (let u = -half; u < half; u += 40) {
        const [x, , z] = f.at(u + 20, 0, 70);
        const lawn = lawnAt(x, z) !== null;
        if (lawn && !run) run = [u];
        if (!lawn) flush(u);
        if (lawn && R() < 0.35 * share) {
          const [wx, , wz] = f.at(u + R() * 40, 0, 4 + R() * 10);
          weed(wx, G + 0.6, wz, 6 + R() * 7);
        }
      }
      flush(half);
    }
  }
  // Between the path's stones.
  for (let i = 0; i < 18; i++) weed(P.x0 + 10 + R() * (P.x1 - P.x0 - 20), G + 0.5, P.z0 + 40 + R() * (P.z1 - P.z0 - 80), 4 + R() * 4);

  // ---------------------------------------------------------------- the lawns' flowers
  if (!low) {
    const n = Math.round(380 * share);
    for (let i = 0; i < n; i++) {
      const x = -6000 + R() * 12000;
      const z = -3000 + R() * 6200;
      const h = lawnAt(x, z);
      if (h === null) continue;
      const dandelion = R() < 0.55;
      kit.paint.color(dandelion ? 0xf2c21a : 0xf4f2ea);
      const y = h + 4 + R() * 3;
      const r = dandelion ? 3.2 : 2.6;
      for (let p = 0; p < 5; p++) {
        const b = (p / 5) * Math.PI * 2;
        kit.paint.tri([x, y + 0.5, z], [x + Math.sin(b + 0.5) * r, y, z + Math.cos(b + 0.5) * r], [x + Math.sin(b - 0.5) * r, y, z + Math.cos(b - 0.5) * r]);
      }
    }
  }
}

export function streetSign({ steel, enamel, paint }, L) {
  const S = STREET_SIGN;
  const y0 = L.groundHeight(S.x, S.z);
  // The post, a cap.
  steel.color(0x8a8e92);
  steel.cyl('y', y0 - 6, y0 + S.top, S.x, S.z, 3.6, 8, { caps: true });
  // The plate: a white enamel box (both faces blank) on the post's top, its edges black.
  const [w, h] = S.plate;
  const [ux, uz] = [Math.sin(S.yaw + Math.PI / 2), Math.cos(S.yaw + Math.PI / 2)]; // (along the plate)
  const [nx, nz] = [Math.sin(S.yaw), Math.cos(S.yaw)]; // (the way its face looks)
  const at = (u, v, t) => [S.x + ux * u + nx * t, y0 + v, S.z + uz * u + nz * t];
  const v0 = S.top - h;
  const box = (g, u0, u1, a, b, t0, t1) => {
    const c = (i, j, k) => at(i ? u1 : u0, j ? b : a, k ? t1 : t0);
    g.quad(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1));
    g.quad(c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0));
    g.quad(c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0));
    g.quad(c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1));
    g.quad(c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0));
    g.quad(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1));
  };
  // (In front of the post: it is bolted to it behind the plate.)
  const [t0, t1] = [4, 5.6];
  enamel.color(0xf4f4f0);
  box(enamel, -w / 2, w / 2, v0, v0 + h, t0, t1);
  // The border: a black band round each face, just proud of it.
  paint.color(0x111214);
  for (const t of [t1 + 0.25, t0 - 0.25]) {
    const s = t > t1 ? 1 : -1;
    const band = (u0, u1, a, b) => {
      const q = [at(u0, a, t), at(u1, a, t), at(u1, b, t), at(u0, b, t)];
      if (s > 0) paint.quad(q[0], q[1], q[2], q[3]);
      else paint.quad(q[1], q[0], q[3], q[2]);
    };
    const e = 2.2;
    band(-w / 2, w / 2, v0, v0 + e);
    band(-w / 2, w / 2, v0 + h - e, v0 + h);
    band(-w / 2, -w / 2 + e, v0 + e, v0 + h - e);
    band(w / 2 - e, w / 2, v0 + e, v0 + h - e);
  }
  // The clamps holding it to the post.
  steel.color(0x6a6e72);
  for (const v of [v0 + 4, v0 + h - 7]) {
    const q = (u, t) => at(u, v, t);
    for (const [a, b] of [[3, 4], [-4, -3]]) {
      steel.quad(q(-4.5, a), q(4.5, a), at(4.5, v + 3, a), at(-4.5, v + 3, a));
      steel.quad(q(4.5, b), q(-4.5, b), at(-4.5, v + 3, b), at(4.5, v + 3, b));
    }
  }
}
