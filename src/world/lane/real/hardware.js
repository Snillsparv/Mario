// The realistic look's house hardware (world/lane/real/detail.js builds it in the worker; the
// classic builders keep every collider): the small things a lived-in house carries, from photos
// 19, 36 and 40's feel.
//
//   hardware(kit, L)   // kit: detail.js's Geo per material (metal, paint, steel, granite, enamel,
//                      // gloss, core, foliage, tyre)
//
// On the chain houses' roofs: snow guards along the street side's eaves (a law in Sweden: two
// rails on brackets a tile course up), the gutters' brackets every 60 (high), the dad's two vent pipes
// and his ventilation hood, a black roof ladder up the dad's and south_2's street slopes (all
// low over the roof: Jonas walks its plane), and the TV antennas redrawn as real masts (a mast
// clamped at the ridge, a boom of elements, a reflector: lane/props.js antenna()'s are the
// classic look's, REAL_DRAWN 'antennas'). On their walls: air bricks in the plinths, vents under
// the soffits, a letter slot and a doorbell at the front doors (none at the dad's: his mailbox;
// his bell beside it), concrete splash blocks under the downpipes' shoes, an outdoor socket and
// a hose reel on the dad's front at its east end, window handles, two pot plants on the dad's
// inner sills. On the villas: a satellite dish on north_2's wall, lamps beside the front doors,
// a seal under the garage doors; and the terraces' walls a coping of stones standing 4 proud
// with joints.

import { frameOf, fbox, lamp } from './house.js';
import { makeRng } from '../../../core/math.js';

const CHAIN = { overhang: 60, thick: 18, plinth: 135, win: { w: 150, sill: 170, h: 130 }, door: { w: 116, h: 215 } };
const BLACK = 0x161718;
const ANTENNA = 0x9a9ea2;

export function hardware(kit, L) {
  const R = makeRng(5150);
  const fine = kit.tier !== 'low';
  const finest = kit.tier === 'high';
  for (const h of L.HOUSES) if (h.kit === 'chain') chainHardware(kit, L, h, fine, R, finest);
  for (const a of L.ANTENNAS) antenna(kit, L, a, fine);
  villaHardware(kit, L, fine);
  coping(kit, L);
}

// A chain house's roof plane: its height at w across the ridge (the collider's plane).
const roofOf = (h) => {
  const B = h.d / 2;
  const tan = (h.ridge - h.eave) / B;
  return { B, tan, o: h.overhang ?? CHAIN.overhang, A: h.w / 2, y: (w) => h.ridge - Math.abs(w) * tan };
};

function chainHardware(kit, L, h, fine, R, finest = fine) {
  const F = frameOf(h);
  const roof = roofOf(h);
  const { A, B, o } = roof;
  const y0 = h.y0 ?? L.GROUND;
  const dad = h.id === 'south_dad';
  const { metal, paint, steel, granite } = kit;
  // A quad on the roof's front slope (+w), `lift` over its plane: u0..u1 along, w0..w1 across.
  const onSlope = (g, u0, u1, w0, w1, lift) => {
    const P = (u, w) => F.at(u, roof.y(w) + lift, w);
    g.quad(P(u1, w0), P(u0, w0), P(u0, w1), P(u1, w1));
  };
  // Snow guards on the street side (both rails on brackets every 120, a course up the eave).
  if (fine && h.id !== 'south_2_wing') {
    const w = B + o - 55;
    metal.color(BLACK);
    for (let u = -A - o + 40; u <= A + o - 40; u += 120) {
      const base = F.at(u, roof.y(w) - 1, w);
      metal.box(base[0] - 1.2, base[0] + 1.2, base[1], base[1] + 11, base[2] - 1.2, base[2] + 1.2, { skip: 'b' });
    }
    for (const lift of [6.5, 10]) metal.tube(F.at(-A - o + 30, roof.y(w) + lift, w), F.at(A + o - 30, roof.y(w) + lift, w), 1.3, 1.3, 5, { caps: true });
  }
  // The gutters' brackets, every 60 along both eaves (high only).
  if (finest) {
    metal.color(BLACK);
    const lo = h.eave - o * roof.tan;
    for (const s of [-1, 1]) {
      for (let u = -A - o + 30; u <= A + o - 30; u += 60) {
        const [ax, , az] = F.at(u - 1.2, 0, s * (B + o + 1));
        const [bx, , bz] = F.at(u + 1.2, 0, s * (B + o + 1));
        const out = F.dir(0, 0, s);
        const q = (p, d, y) => [p[0] + out[0] * d, y, p[2] + out[2] * d];
        const [a, b] = [[ax, 0, az], [bx, 0, bz]];
        // (Under the trough and up its outer side.)
        const under = [q(a, 0, lo - 21), q(b, 0, lo - 21), q(b, 19, lo - 21), q(a, 19, lo - 21)];
        if (s > 0) metal.quad(under[1], under[0], under[3], under[2]);
        else metal.quad(under[0], under[1], under[2], under[3]);
        const lip = [q(a, 19.3, lo - 21), q(b, 19.3, lo - 21), q(b, 19.3, lo - 11), q(a, 19.3, lo - 11)];
        if (s > 0) metal.quad(lip[0], lip[1], lip[2], lip[3]);
        else metal.quad(lip[1], lip[0], lip[3], lip[2]);
      }
    }
  }
  // The dad's roof: two vent pipes and a ventilation hood on the street slope (photo 19), a
  // ladder up it; south_2's ladder.
  if (dad) {
    steel.color(0x202224);
    for (const [u, w] of [[-260, B * 0.42], [520, B * 0.3]]) {
      const [x, , z] = F.at(u, 0, w);
      steel.cyl('y', roof.y(w) - 6, roof.y(w) + 46, x, z, 5.5, 10, { caps: true });
      steel.cyl('y', roof.y(w) + 44, roof.y(w) + 50, x, z, 7, 10, { caps: true });
    }
    // The hood: a black box on a sloping base, its cap overhanging.
    const w = B * 0.62;
    paint.color(BLACK);
    const hood = (u0, u1, w0, w1, ya, yb) => {
      const c = (i, j, k) => F.at(i ? u1 : u0, j ? yb : ya, k ? w1 : w0);
      for (const q of [[c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)], [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)], [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0)]]) paint.quad(...orientOut(q, F, (u0 + u1) / 2, (ya + yb) / 2, (w0 + w1) / 2));
    };
    hood(-660, -560, w - 25, w + 25, roof.y(w + 25) - 4, roof.y(w - 25) + 26);
    hood(-668, -552, w - 33, w + 33, roof.y(w - 25) + 26, roof.y(w - 25) + 31);
  }
  if (fine && (dad || h.id === 'south_2')) ladder(kit, F, roof, dad ? 160 : -200);
  // The walls: air bricks in the plinth, vents under the soffit, splash blocks under the
  // downpipes.
  const plinth = h.plinth ?? CHAIN.plinth;
  for (const name of ['front', 'back']) {
    const { f, half } = F.face(name);
    const holes = (name === 'front' ? (h.windows ?? []) : (h.windows ?? []).map((u) => -u)).map((u) => [u - 100, u + 100]);
    if (typeof h.door === 'number' && name === 'front') holes.push([h.door - 120, h.door + 120]);
    if (typeof h.door === 'object' && name === 'front') holes.push([h.door.u - 160, h.door.u + 160]);
    for (let u = -half + 150; u < half - 150; u += 420) {
      if (holes.some(([a, b]) => u > a && u < b)) continue;
      paint.color(0x2a2826);
      fbox(paint, f, u - 11, u + 11, 28, 36, 2, 2.6, 'k');
      if (fine) {
        paint.color(0x5a5650);
        for (const v of [30, 32.5]) fbox(paint, f, u - 10, u + 10, v, v + 0.8, 2.6, 3, 'k');
      }
    }
    // Soffit vents: dark slots under the overhang.
    if (fine) {
      paint.color(0x0c0c0c);
      const s = name === 'front' ? 1 : -1;
      for (let u = -A + 120; u < A - 60; u += 320) {
        const wa = s * (B + 12);
        const wb = s * (B + 24);
        const P = (uu, w) => F.at(uu, roof.y(w) - CHAIN.thick - 0.4, w);
        const q = [P(u + 22, wa), P(u - 22, wa), P(u - 22, wb), P(u + 22, wb)];
        if (s > 0) paint.quad(q[1], q[0], q[3], q[2]);
        else paint.quad(q[0], q[1], q[2], q[3]);
      }
    }
    // The downpipes' splash blocks (house.js gableRoof: a pipe at each end of each eave).
    granite.color(0xb8b4ac);
    for (const e of [-1, 1]) {
      const u = (name === 'front' ? 1 : -1) * e * (A - 25);
      fbox(granite, f, u - 14, u + 14, -1, 3, 4, 52, 'k');
    }
  }
  // At the front door: a letter slot and a bell (the dad's: a bell only, his mailbox by the
  // street); window handles.
  const front = F.face('front').f;
  if (typeof h.door === 'number') {
    kit.metal.color(0xa8a49a);
    fbox(kit.metal, front, h.door - 16, h.door + 16, 92, 99, -6, -5, 'k');
    bell(kit, front, h.door + CHAIN.door.w / 2 + 22, 112);
  } else if (typeof h.door === 'object') bell(kit, front, h.door.u - h.door.w / 2 - 26, 118);
  if (fine) {
    kit.metal.color(0xc8c4bc);
    const W = CHAIN.win;
    for (const [f, us] of [[front, h.windows ?? []], [F.face('back').f, (h.windows ?? []).map((u) => -u)]]) {
      for (const u of us) for (const du of [-12, 12]) fbox(kit.metal, f, u + du - 1, u + du + 1, W.sill + W.h * 0.45, W.sill + W.h * 0.45 + 11, -7, -5, 'k');
    }
  }
  if (dad) {
    // The outdoor socket and the hose reel at the east end of the front (by the carport).
    const u = -(A - 80);
    kit.enamel.color(0xe8e6e0);
    fbox(kit.enamel, front, u - 6, u + 6, 150, 166, 2, 6, 'k');
    paint.color(BLACK);
    fbox(paint, front, u - 4, u + 4, 152, 160, 6, 6.6, 'k');
    // The reel: a green drum on a bracket, its hose wound on it, a loop hanging.
    const [x, , z] = front.at(u - 70, 0, 22);
    const out = front.out;
    paint.color(0x2f6a3a);
    const c = [x, y0 + 105, z];
    const axis = [front.right[0], 0, front.right[2]];
    kit.paint.tube([c[0] - axis[0] * 12, c[1], c[2] - axis[2] * 12], [c[0] + axis[0] * 12, c[1], c[2] + axis[2] * 12], 20, 20, 12, { caps: true });
    kit.tyre.color(0x1d4a28);
    kit.tyre.tube([c[0] - axis[0] * 9, c[1], c[2] - axis[2] * 9], [c[0] + axis[0] * 9, c[1], c[2] + axis[2] * 9], 22, 22, 12);
    paint.color(0x2f6a3a);
    fbox(paint, front, u - 76, u - 64, 70, 125, 0, 6, 'k');
    void out;
    // Two pot plants on the inner sills of the windows each side of the door.
    for (const wu of [h.windows[2], h.windows[3]]) {
      if (wu === undefined) continue;
      const W = CHAIN.win;
      const [px, , pz] = front.at(wu + 30, 0, -24);
      kit.enamel.color(0xc8643a);
      kit.enamel.loft([[7, 0], [10, 14]].map(([r, v]) => ring(px, y0 + W.sill + 2 + v, pz, r, 10)), { capStart: true });
      kit.core.rgb(0.05, 0.11, 0.03);
      kit.core.ellipsoid([px, y0 + W.sill + 30, pz], [1, 0, 0], [0, 1, 0], [0, 0, 1], 14, 15, 14, 8, 5);
    }
  }
}

// A quad's corners wound to face out of a box's middle (u, v, w in frame F).
function orientOut(q, F, um, vm, wm) {
  const c = F.at(um, vm, wm);
  const n = cross(sub(q[1], q[0]), sub(q[3], q[0]));
  const m = [(q[0][0] + q[2][0]) / 2 - c[0], (q[0][1] + q[2][1]) / 2 - c[1], (q[0][2] + q[2][2]) / 2 - c[2]];
  return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0 ? q : [q[1], q[0], q[3], q[2]];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function ring(x, y, z, r, sides) {
  return Array.from({ length: sides }, (_, i) => {
    const a = -(i / sides) * Math.PI * 2;
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  });
}

// A black roof ladder up the street slope at u: two stringers on low brackets, rungs every 30.
function ladder({ metal }, F, roof, u) {
  metal.color(BLACK);
  const w0 = roof.B + roof.o - 30;
  const w1 = 60;
  for (const du of [-22, 22]) metal.tube(F.at(u + du, roof.y(w0) + 4.5, w0), F.at(u + du, roof.y(w1) + 4.5, w1), 1.6, 1.6, 5, { caps: true });
  for (let w = w0 - 15; w > w1; w -= 30) metal.tube(F.at(u - 22, roof.y(w) + 5, w), F.at(u + 22, roof.y(w) + 5, w), 1.1, 1.1, 4);
}

// A doorbell at (u, v) on wall frame f: a small plate, its button.
function bell({ enamel, paint }, f, u, v) {
  enamel.color(0xe8e6e0);
  fbox(enamel, f, u - 3, u + 3, v, v + 9, 0, 1.6, 'k');
  paint.color(BLACK);
  fbox(paint, f, u - 1.4, u + 1.4, v + 3, v + 6, 1.6, 2.2, 'k');
}

// A TV antenna on a chain house's ridge (layout.js ANTENNAS: lane/props.js antenna()'s place):
// a mast clamped at the ridge, a boom of nine elements, a reflector of three rods, a second
// small array lower down.
function antenna({ steel }, L, { house, x }, fine) {
  const H = L.HOUSES.find((h) => h.id === house);
  const [y, z] = [H.ridge, H.cz];
  const top = y + 250;
  steel.color(ANTENNA);
  steel.cyl('y', y - 20, top, x, z, 3, fine ? 8 : 5, { caps: true });
  steel.box(x - 7, x + 7, y - 2, y + 14, z - 9, z + 9, { skip: 'b' }); // (the clamp on the ridge)
  const boom = (yb, z0, z1, n, len0, len1) => {
    steel.tube([x, yb, z0], [x, yb, z1], 1.6, 1.6, fine ? 6 : 4, { caps: true });
    for (let k = 0; k < n; k++) {
      const zz = z0 + ((z1 - z0) * (k + 0.5)) / n;
      const half = (len0 + ((len1 - len0) * k) / Math.max(1, n - 1)) / 2;
      steel.tube([x - half, yb, zz], [x + half, yb, zz], 0.8, 0.8, 4);
    }
  };
  boom(top - 14, z - 125, z + 85, fine ? 9 : 5, 120, 60);
  if (fine) {
    // The reflector at the boom's back end, a second small array under it.
    for (const dy of [-18, 0, 18]) steel.tube([x - 70, top - 14 + dy, z - 135], [x + 70, top - 14 + dy, z - 135], 0.9, 0.9, 4);
    steel.tube([x, top - 32, z - 135], [x, top + 4, z - 135], 1, 1, 4);
    boom(top - 90, z - 60, z + 40, 5, 70, 40);
  }
}

function villaHardware(kit, L, fine) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const F = frameOf(h);
    const front = F.face('front').f;
    // A lamp beside the front door, at the steps.
    if (h.door !== undefined) {
      const at = F.at(h.door, 0, h.d / 2 + 10);
      const v = Math.max(0, L.groundHeight(at[0], at[2]) - (h.y0 ?? L.GROUND));
      lamp(kit, front, h.door + 95, v + 165);
    }
    // A black seal under each garage door.
    kit.paint.color(0x0e0e0e);
    for (const u of h.garages ?? (h.garage !== undefined ? [h.garage] : [])) fbox(kit.paint, front, u - 260, u + 260, 0, 4, 0.5, 1.6, 'k');
    // The satellite dish on north_2's wall under its eaves.
    if (fine && h.id === 'north_2') dish(kit, front, h.w / 2 - 260, h.eave - (h.y0 ?? L.GROUND) - 150);
  }
}

// A satellite dish on wall frame f at (u, v): a wall bracket, an arm out, the dish (a shallow
// bowl, grey-white, facing up toward the south-west sky), the receiver on its arm.
function dish({ paint, steel }, f, u, v) {
  steel.color(0x8a8e92);
  fbox(steel, f, u - 8, u + 8, v - 20, v + 20, 0, 3, 'k');
  steel.tube(f.at(u, v, 3), f.at(u, v + 8, 34), 2.2, 2.2, 6, { caps: true });
  // The bowl: rings round its axis (out of the wall and up), a loft from the rim to the middle.
  const c = f.at(u, v + 16, 40);
  const ax = norm3(f.dir(0.25, 0.45, 1));
  const ex = norm3(cross([0, 1, 0], ax));
  const ey = cross(ax, ex);
  const ringAt = (r, d) => Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return [c[0] + ex[0] * Math.cos(a) * r + ey[0] * Math.sin(a) * r + ax[0] * d, c[1] + ex[1] * Math.cos(a) * r + ey[1] * Math.sin(a) * r + ax[1] * d, c[2] + ex[2] * Math.cos(a) * r + ey[2] * Math.sin(a) * r + ax[2] * d];
  });
  paint.color(0xd8d8d4);
  paint.loft([ringAt(34, 9), ringAt(26, 4.5), ringAt(14, 1), ringAt(0.5, 0)]);
  paint.loft([ringAt(0.5, -1), ringAt(14, 0), ringAt(26, 3.5), ringAt(34, 8)]);
  // The receiver's arm and its head in front of the bowl.
  const tip = [c[0] + ax[0] * 40 - ey[0] * 6, c[1] + ax[1] * 40 - ey[1] * 6, c[2] + ax[2] * 40 - ey[2] * 6];
  steel.tube([c[0] - ey[0] * 30, c[1] - ey[1] * 30, c[2] - ey[2] * 30], tip, 1.2, 1.2, 4);
  paint.color(0x3a3c3e);
  paint.ellipsoid(tip, ex, ey, ax, 4, 4, 6, 6, 4);
}
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// The terraces' walls' coping (lane/build.js terraces: their fronts along the wall's line but at
// the drives' notches and the steps): stones 60 long standing 4 proud of the face, 1.5 over the
// top Jonas walks on, joints between them.
function coping({ granite }, L) {
  const top = L.NORTH.top;
  for (const p of L.PLOTS_N) {
    const spans = [[p.x0, p.steps[0]], [p.steps[1], p.drive[0]], [p.drive[1], p.x1]];
    for (const [xa, xb] of spans) {
      for (let x = xa; x < xb - 1; x += 60) {
        const x1 = Math.min(xb, x + 59.2);
        const [za, zb] = [L.wallZAt(x + 0.01), L.wallZAt(x1)];
        // Its front (toward the street, +z), its top, its ends.
        granite.color(0xcfcbc2, 0.9 + 0.12 * Math.abs(Math.sin(x * 0.37)));
        const F = (xx, zz, y) => [xx, y, zz];
        granite.quad(F(x, za + 4, top - 14), F(x1, zb + 4, top - 14), F(x1, zb + 4, top + 1.5), F(x, za + 4, top + 1.5));
        granite.quad(F(x, za + 4, top + 1.5), F(x1, zb + 4, top + 1.5), F(x1, zb - 30, top + 1.5), F(x, za - 30, top + 1.5));
        granite.quad(F(x, za - 30, top - 14), F(x, za + 4, top - 14), F(x, za + 4, top + 1.5), F(x, za - 30, top + 1.5), { shade: 0.7 });
        granite.quad(F(x1, zb + 4, top - 14), F(x1, zb - 30, top - 14), F(x1, zb - 30, top + 1.5), F(x1, zb + 4, top + 1.5), { shade: 0.7 });
        granite.quad(F(x, za, top - 14), F(x1, zb, top - 14), F(x1, zb + 4, top - 14), F(x, za + 4, top - 14), { shade: 0.5 });
      }
    }
  }
}
