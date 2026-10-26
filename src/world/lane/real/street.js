// The realistic look's posts, fences and bins (world/lane/real/detail.js builds them in the worker
// in place of lane/props.js's lampposts, flagpoles, fences and wheelie bins; their colliders
// stay the classic ones, the flags their classic cloth, waving).
//
//   lampposts(kit, L)   // tapered steel poles on a collar, a curved arm, a flat luminaire with
//                       // its diffuser
//   flagpoles(kit, L)   // white tapered poles in a sleeve, a gilt ball, the halyard down the pole
//   fences(kit, L)      // the corner house's picket fence (pointed pickets with gaps on two
//                       // rails, posts) and its rail fence
//   bins(kit, L)        // a wheelie bin in its own frame (its foot's middle at the origin, +x
//                       // the handle side: the dad's two are movers, detail.js): a tapering body
//                       // with rounded corners, the lid over its rim, the hinge bar and handle,
//                       // two wheels
//   crazyPaving(kit, L) // north_west's drive and the strip along its west face (W8, photos 05-07):
//                       // irregular grey slate flags (a seeded Voronoi of the outlines, each
//                       // stone shrunk off its neighbours: the joints the drive's own dark face
//                       // under them), a few pale, dark and rusty ones; bigger stones on low
//
// kit: detail.js's Geo per material (steel, paint, boards, enamel, gloss, tyre, patch).

import { add, mul } from './geo.js';
import { frameOf } from './house.js';
import { fenceEnds } from './plan.js';
import { makeRng } from '../../../core/math.js';
import { FAR_LAMPS } from '../ends.js';

const STEEL = 0x8e8e8c; // (weathered galvanized: a neutral grey)
const HEAD = 0xa8acae; // (W7: the photos' light grey luminaires)
const WHITE = 0xf2f2f0;
const GOLD = 0xe8b84a;

// A smooth lathe round (x, z): profile [[r, y]] bottom to top (closed at the top when its last
// radius is 0), `sides` round.
function lathe(g, x, z, profile, sides) {
  const rings = profile.map(([r, y]) => Array.from({ length: sides }, (_, i) => {
    const a = -(i / sides) * Math.PI * 2;
    return [x + Math.cos(a) * Math.max(r, 0.01), y, z + Math.sin(a) * Math.max(r, 0.01)];
  }));
  g.loft(rings);
}

export function lampposts({ steel, paint, gloss, granite, tier }, L) {
  const { LAMP } = L;
  for (const { x, z, yaw } of [...L.LAMPS, ...FAR_LAMPS]) { // (W8: and lamppost B out past the junction)
    const y0 = L.groundHeight(x, z);
    // (W7, photos 05, 09, 12, 24: a slim galvanised pole tapering a little, on a concrete collar;
    // a short bracket from just under the cap out to a flat oval luminaire, light grey, its
    // clear lens under it.)
    granite.color(0x9a9890);
    lathe(granite, x, z, [[LAMP.r + 17, y0 - 6], [LAMP.r + 17, y0 + 7], [LAMP.r + 14, y0 + 10], [LAMP.r + 2, y0 + 11]], 12);
    steel.color(STEEL);
    lathe(steel, x, z, [[LAMP.r + 3, y0 - 10], [LAMP.r + 3, y0 + 42], [LAMP.r + 1, y0 + 50], [LAMP.r - 5, LAMP.top - 24], [LAMP.r - 6, LAMP.top - 5], [0, LAMP.top]], tier === 'low' ? 10 : 14);
    const [ax, az] = [Math.sin(yaw), Math.cos(yaw)];
    const y = LAMP.top - LAMP.root;
    const at = (t) => [x + ax * (LAMP.arm - 26) * t, y + 4 * Math.sin(t * Math.PI * 0.5), z + az * (LAMP.arm - 26) * t];
    for (let k = 0; k < 2; k++) steel.tube(at(k / 2), at((k + 1) / 2), 4.5, 4, 8);
    // The luminaire: a flat rounded oval (36 long either way of its middle, 15 across), the lens.
    const mid = [x + ax * LAMP.arm, y, z + az * LAMP.arm];
    const fw = [ax, 0, az];
    const side = [az, 0, -ax];
    paint.color(HEAD);
    const ring = (yy, k) => Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return add(add([mid[0], yy, mid[2]], mul(fw, Math.cos(a) * 36 * k)), mul(side, -Math.sin(a) * 15 * k));
    });
    paint.loft([ring(y - 6, 0.92), ring(y - 3, 1), ring(y + 5, 0.94), ring(y + 8, 0.55), ring(y + 9, 0.01)], { capStart: false });
    gloss.color(0xe8e8e4);
    gloss.loft([ring(y - 6.5, 0.86), ring(y - 6.5, 0.01)]);
  }
}

export function flagpoles({ steel, paint, gloss }, L) {
  const F = L.FLAGPOLE;
  for (const { x, z, y0, h } of L.FLAGPOLES) {
    const top = y0 + (h ?? F.h);
    paint.color(WHITE);
    lathe(paint, x, z, [[F.r + 22, y0 - 10], [F.r + 22, y0 + 40], [F.r + 8, y0 + 50], [F.r, y0 + 60], [F.r - 5, top], [F.r - 5.5, top + 2], [0, top + 3]], 16);
    gloss.color(GOLD);
    const ball = [x, top + 18, z];
    gloss.ellipsoid(ball, [1, 0, 0], [0, 1, 0], [0, 0, 1], 16, 16, 16, 14, 8);
    // The halyard: a thin line from the truck at the top down the pole to its cleat.
    steel.color(0xd8d8d0);
    const [wx, wz] = L.WIND.dir;
    const l = Math.hypot(wx, wz);
    const out = [wx / l, 0, wz / l];
    const s = [out[2], 0, -out[0]];
    const a = add([x, top - 10, z], mul(s, F.r - 3));
    const b = add([x, y0 + 130, z], mul(s, F.r + 3));
    steel.tube(a, b, 0.8, 0.8, 4);
    steel.color(STEEL);
    steel.tube(add(b, [0, -10, 0]), add(b, mul(s, 6)), 2, 2, 5, { caps: true });
  }
}

// (On low the pickets on the street side of the rails only, without their narrow ends.)
export function fences({ boards, tier }, L) {
  const y0 = L.GROUND;
  for (const f of L.FENCES) {
    const { kind, h } = f;
    const [a, b] = fenceEnds(L, f);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const d = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
    const n = [-d[2], 0, d[0]];
    const along = (t, s, y) => [a[0] + d[0] * t + n[0] * s, y, a[2] + d[2] * t + n[2] * s];
    // A box along the fence from t0 to t1, s0 to s1 across it, y0 to y1.
    const piece = (t0, t1, s0, s1, ya, yb, pointed = false, ends = true) => {
      const c = (t, s, y) => along(t, s, y);
      const tm = (t0 + t1) / 2;
      const peak = pointed ? yb + (t1 - t0) * 0.6 : yb;
      for (const [s, o] of [[s1, 1], [s0, -1]]) {
        const q = [c(t0, s, ya), c(t1, s, ya), c(t1, s, yb), c(t0, s, yb)];
        if (o > 0) boards.quad(q[0], q[1], q[2], q[3]);
        else boards.quad(q[1], q[0], q[3], q[2]);
        if (pointed) {
          const tri = [c(t0, s, yb), c(t1, s, yb), c(tm, s, peak)];
          if (o > 0) boards.tri(tri[0], tri[1], tri[2]);
          else boards.tri(tri[1], tri[0], tri[2]);
        }
      }
      if (ends) {
        boards.quad(c(t0, s0, ya), c(t0, s1, ya), c(t0, s1, yb), c(t0, s0, yb), { shade: 0.8 });
        boards.quad(c(t1, s1, ya), c(t1, s0, ya), c(t1, s0, yb), c(t1, s1, yb), { shade: 0.8 });
      }
      if (pointed) {
        boards.quad(c(t0, s1, yb), c(tm, s1, peak), c(tm, s0, peak), c(t0, s0, yb));
        boards.quad(c(tm, s1, peak), c(t1, s1, yb), c(t1, s0, yb), c(tm, s0, peak));
      } else boards.quad(c(t0, s1, yb), c(t1, s1, yb), c(t1, s0, yb), c(t0, s0, yb));
    };
    boards.color(kind === 'picket' ? 0x6a4630 : 0x8a6a4a);
    const rails = kind === 'picket' ? [y0 + 25, y0 + h - 35] : [y0 + 30, y0 + h - 14];
    for (const y of rails) piece(0, len, -4, 4, y, y + 10);
    for (let t = 0; t <= len + 1; t += 200) piece(Math.min(t, len) - 6, Math.min(t, len) + 6, -6, 6, y0 - 5, y0 + h + 4);
    if (kind === 'picket') {
      // Pickets 8 wide with 10 between, either side of the rails.
      // (s < 0: the side away from the house, its street side.)
      // (W8: one side only on mid, and the bend's (no house) on every tier; on low a picket every
      // 50: the two ends' fences are long.)
      const low = tier !== 'high' || !f.house;
      for (let t = 4; t + 8 < len; t += tier === 'low' ? 50 : 18) {
        for (const s of low ? [-1] : [-1, 1]) piece(t, t + 8, s > 0 ? 4 : -6.5, s > 0 ? 6.5 : -4, y0 + 2, y0 + h - 6, true, tier === 'high' && !!f.house);
      }
    }
  }
}

// The bins' near-black blue-grey plastic (W4 fix: as photos 36 and 37 have it in the gable's
// shade, ~(17, 25, 34) on every tier, once the haze's sun glow no longer veiled it brown on high
// and mid).
const BIN_TINT = 0x182434;
export function bins({ paint, tyre, steel }, L) {
  const { BIN } = L;
  const [hx, hz] = [BIN.x / 2, BIN.z / 2];
  const [x, z, G, top] = [0, 0, 0, BIN.h]; // (in the bin's own frame: its foot's middle)
  {
    // The body: rounded sections from its foot (narrower) to its rim.
    paint.color(BIN_TINT); // (W4: the photos' near-black blue-grey in the gable's shade)
    const sec = (y, k, r = 10) => {
      const pts = [];
      for (const [cx, cz, a0] of [[hx * k - r, -hz * k + r, -Math.PI / 2], [hx * k - r, hz * k - r, 0], [-hx * k + r, hz * k - r, Math.PI / 2], [-hx * k + r, -hz * k + r, Math.PI]]) {
        for (let i = 0; i <= 3; i++) {
          const a = a0 + (i / 3) * (Math.PI / 2);
          pts.push([x + cx + Math.cos(a) * r, y, z + 3 + cz + Math.sin(a) * r]);
        }
      }
      return pts.reverse();
    };
    paint.loft([sec(G + 2, 0.86), sec(G + 30, 0.9), sec(top - 14, 1), sec(top - 10, 1.03), sec(top - 9, 0.99)]);
    // The lid over the rim, a little wider, its front lip; split front and back (W4: the
    // photos' four-compartment bins): a dark seam across its middle.
    paint.color(BIN_TINT, 1.08);
    paint.loft([sec(top - 12, 1.06, 12), sec(top - 1, 1.06, 12), sec(top, 1.02, 12), sec(top + 0.5, 0.1, 2)]);
    paint.color(0x121412);
    paint.box(-hx * 1.06 - 1, hx * 1.06 + 1, top - 12, top + 0.8, z - 2, z + 2, { skip: 'b' });
    // The hinge bar and the handle along the back (toward the street: -z), two wheels.
    const back = z - hz - 2;
    paint.color(0x222622);
    paint.tube([x - hx + 8, top - 6, back], [x + hx - 8, top - 6, back], 4, 4, 8, { caps: true });
    paint.tube([x - hx + 14, top - 26, back - 6], [x + hx - 14, top - 26, back - 6], 3.5, 3.5, 8, { caps: true });
    for (const s of [-1, 1]) {
      const wx = x + s * (hx - 12);
      tyre.rgb(0.03, 0.03, 0.03); // (each colour set just before it draws: the movers' kit has
      // one builder for all three)
      tyre.tube([wx - s * 4, G + 13, back + 6], [wx + s * 6, G + 13, back + 6], 13, 13, 12, { caps: true });
      steel.color(0x6a6e70);
      steel.tube([wx - s * 10, G + 13, back + 6], [wx + s * 8, G + 13, back + 6], 2.5, 2.5, 6);
    }
  }
}

// A convex polygon [[u, w]] cut to where s(p) >= 0 (s linear).
function cut(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    const [sp, sq] = [s(p), s(q)];
    if (sp >= 0) out.push(p);
    if (sp * sq < 0) {
      const k = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out;
}

export function crazyPaving({ patch, tier }, L) {
  const F = frameOf(L.NORTH_WEST);
  const step = { high: 92, mid: 120 }[tier] ?? 260; // (W8: the stones larger on mid, larger still on low: the plan's levers)
  const J = 1.6; // (half a joint)
  const y = L.GROUND + 0.8;
  const R = makeRng(0x5f1a9);
  const UP = [0, 1, 0];
  for (const outline of L.northWestDrive()) {
    const us = outline.map((p) => p[0]);
    const ws = outline.map((p) => p[1]);
    const seeds = [];
    // (A jittered grid with a quarter of its points left out: stones of every size, 0.3 .. 0.8 m.)
    for (let u = Math.min(...us) - step / 2; u <= Math.max(...us) + step; u += step) {
      for (let w = Math.min(...ws) - step / 2; w <= Math.max(...ws) + step; w += step) {
        const p = [u + (R() - 0.5) * step * 0.95, w + (R() - 0.5) * step * 0.95];
        if (R() > 0.27) seeds.push(p);
      }
    }
    for (const a of seeds) {
      let cell = outline;
      for (const b of seeds) {
        if (b === a || Math.abs(b[0] - a[0]) > step * 2.2 || Math.abs(b[1] - a[1]) > step * 2.2) continue;
        const [nx, nw] = [b[0] - a[0], b[1] - a[1]];
        const l = Math.hypot(nx, nw);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        cell = cut(cell, (p) => -((p[0] - m[0]) * nx + (p[1] - m[1]) * nw) / l - J);
        if (cell.length < 3) break;
      }
      if (cell.length < 3) continue;
      const c = cell.reduce((s, p) => [s[0] + p[0] / cell.length, s[1] + p[1] / cell.length], [0, 0]);
      const area = cell.reduce((s, p, i) => s + p[0] * cell[(i + 1) % cell.length][1] - cell[(i + 1) % cell.length][0] * p[1], 0) / 2;
      if (Math.abs(area) < 120) continue;
      const pts = cell.map(([u, w]) => F.at(u, y, w));
      // (Slate grey, each stone its own shade; a few pale, dark, blue-grey or rusty ones.)
      const r = R();
      const v = 0.9 + R() * 0.2;
      const tint = r < 0.08 ? [1.2, 1.18, 1.14] : r < 0.11 ? [0.98, 0.8, 0.68] : r < 0.2 ? [0.68, 0.67, 0.66] : r < 0.4 ? [0.84, 0.87, 0.9] : [0.9, 0.88, 0.86];
      patch.rgb(tint[0] * v, tint[1] * v, tint[2] * v);
      const C = F.at(c[0], y, c[1]);
      for (let i = 0; i < pts.length; i++) {
        let [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        // (Counter-clockwise seen from above.)
        if ((p[0] - C[0]) * (q[2] - C[2]) - (p[2] - C[2]) * (q[0] - C[0]) > 0) [p, q] = [q, p];
        patch.tri(C, p, q, { n: [UP, UP, UP], uvs: [[C[0], C[2]], [p[0], p[2]], [q[0], q[2]]] });
      }
    }
  }
}
