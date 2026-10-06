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
//
// kit: detail.js's Geo per material (steel, paint, boards, enamel, gloss, tyre).

import { add, mul } from './geo.js';
import { frameOf } from './house.js';

const STEEL = 0x9a9ea0;
const HEAD = 0x4a4e50;
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

export function lampposts({ steel, paint, gloss }, L) {
  const { LAMP } = L;
  for (const { x, z, yaw } of L.LAMPS) {
    const y0 = L.groundHeight(x, z);
    steel.color(STEEL);
    lathe(steel, x, z, [[LAMP.r + 9, y0 - 10], [LAMP.r + 9, y0 + 55], [LAMP.r + 4, y0 + 70], [LAMP.r + 1, y0 + 80], [LAMP.r - 5, LAMP.top - 30], [LAMP.r - 6, LAMP.top - 6], [0, LAMP.top]], 16);
    // The arm: out along yaw from under the pole's cap (LAMP.root), curving up to the head.
    const [ax, az] = [Math.sin(yaw), Math.cos(yaw)];
    const at = (t) => [x + ax * LAMP.arm * t, LAMP.top - LAMP.root + (LAMP.root + 4) * Math.sin(t * Math.PI * 0.5), z + az * LAMP.arm * t];
    for (let k = 0; k < 4; k++) steel.tube(at(k / 4), at((k + 1) / 4), 6, 5.5, 10);
    // The luminaire: a flat rounded head, its diffuser under it.
    const end = at(1);
    const fw = [ax, 0, az];
    const side = [az, 0, -ax];
    paint.color(HEAD);
    const ring = (w, y, k) => Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return add(add([end[0], y, end[2]], mul(fw, Math.cos(a) * 50 * k + 10)), mul(side, -Math.sin(a) * w * k));
    });
    paint.loft([ring(24, end[1] - 16, 0.9), ring(24, end[1] - 10, 1), ring(24, end[1] + 2, 0.92), ring(24, end[1] + 6, 0.5), ring(24, end[1] + 7, 0.01)], { capStart: false });
    gloss.color(0xe8e8e4);
    gloss.loft([ring(24, end[1] - 16.5, 0.86), ring(24, end[1] - 16.5, 0.01)]);
  }
}

export function flagpoles({ steel, paint, gloss }, L) {
  const F = L.FLAGPOLE;
  for (const { x, z, y0 } of L.FLAGPOLES) {
    const top = y0 + 1200;
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

export function fences({ boards }, L) {
  const y0 = L.GROUND;
  for (const { house, kind, from, to, h } of L.FENCES) {
    const F = frameOf(L.HOUSES.find((o) => o.id === house));
    const a = F.at(from[0], 0, from[1]);
    const b = F.at(to[0], 0, to[1]);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const d = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
    const n = [-d[2], 0, d[0]];
    const along = (t, s, y) => [a[0] + d[0] * t + n[0] * s, y, a[2] + d[2] * t + n[2] * s];
    // A box along the fence from t0 to t1, s0 to s1 across it, y0 to y1.
    const piece = (t0, t1, s0, s1, ya, yb, pointed = false) => {
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
      boards.quad(c(t0, s0, ya), c(t0, s1, ya), c(t0, s1, yb), c(t0, s0, yb), { shade: 0.8 });
      boards.quad(c(t1, s1, ya), c(t1, s0, ya), c(t1, s0, yb), c(t1, s1, yb), { shade: 0.8 });
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
      for (let t = 4; t + 8 < len; t += 18) {
        for (const s of [-1, 1]) piece(t, t + 8, s > 0 ? 4 : -6.5, s > 0 ? 6.5 : -4, y0 + 2, y0 + h - 6, true);
      }
    }
  }
}

export function bins({ paint, tyre, steel }, L) {
  const { BIN } = L;
  const [hx, hz] = [BIN.x / 2, BIN.z / 2];
  const [x, z, G, top] = [0, 0, 0, BIN.h]; // (in the bin's own frame: its foot's middle)
  {
    // The body: rounded sections from its foot (narrower) to its rim.
    paint.color(0x2c302c);
    const sec = (y, k, r = 10) => {
      const pts = [];
      for (const [cx, cz, a0] of [[hx * k - r, -hz * k + r, -Math.PI / 2], [hx * k - r, hz * k - r, 0], [-hx * k + r, hz * k - r, Math.PI / 2], [-hx * k + r, -hz * k + r, Math.PI]]) {
        for (let i = 0; i <= 3; i++) {
          const a = a0 + (i / 3) * (Math.PI / 2);
          pts.push([x - 3 + cx + Math.cos(a) * r, y, z + cz + Math.sin(a) * r]);
        }
      }
      return pts.reverse();
    };
    paint.loft([sec(G + 2, 0.86), sec(G + 30, 0.9), sec(top - 14, 1), sec(top - 10, 1.03), sec(top - 9, 0.99)]);
    // The lid over the rim, a little wider, its front lip.
    paint.color(0x2c302c, 1.08);
    paint.loft([sec(top - 12, 1.06, 12), sec(top - 1, 1.06, 12), sec(top, 1.02, 12), sec(top + 0.5, 0.1, 2)]);
    // The hinge bar and the handle along the back, two wheels.
    const back = x + hx + 2;
    paint.color(0x222622);
    paint.tube([back, top - 6, z - hz + 8], [back, top - 6, z + hz - 8], 4, 4, 8, { caps: true });
    paint.tube([back + 6, top - 26, z - hz + 14], [back + 6, top - 26, z + hz - 14], 3.5, 3.5, 8, { caps: true });
    for (const s of [-1, 1]) {
      const wz = z + s * (hz - 10);
      tyre.rgb(0.03, 0.03, 0.03); // (each colour set just before it draws: the movers' kit has
      // one builder for all three)
      tyre.tube([back - 6, G + 13, wz - s * 4], [back - 6, G + 13, wz + s * 6], 13, 13, 12, { caps: true });
      steel.color(0x6a6e70);
      steel.tube([back - 6, G + 13, wz - s * 10], [back - 6, G + 13, wz + s * 8], 2.5, 2.5, 6);
    }
  }
}
