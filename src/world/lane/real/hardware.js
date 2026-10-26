// The realistic look's house hardware (world/lane/real/detail.js builds it in the worker; the
// classic builders keep every collider): the small things a lived-in house carries, from photos
// 19, 36 and 40's feel.
//
//   hardware(kit, L)   // kit: detail.js's Geo per material (metal, paint, steel, granite, enamel,
//                      // gloss, core, foliage, tyre, contact)
//
// On the chain houses' roofs: snow guards along the street side's eaves (a law in Sweden: two
// rails on brackets a tile course up), the gutters' brackets every 60 (high), the dad's two vent pipes
// and his ventilation hood, a black roof ladder up the dad's and south_2's street slopes (all
// low over the roof: Jonas walks its plane), and the TV antennas redrawn as real masts (a mast
// clamped at the ridge, a boom of elements, a reflector: lane/props.js antenna()'s are the
// classic look's, REAL_DRAWN 'antennas'). On their walls: air bricks in the plinths, vents under
// the soffits, a letter slot and a doorbell at the front doors (none at the dad's: his mailbox;
// his bell beside it), concrete splash blocks under the downpipes' shoes, an outdoor socket and
// a hose reel on the dad's east gable by the drive, window handles, two pot plants on the dad's
// inner sills (W6: the villas' lamps and seals are their kit's, villas.js; no dish on north_2's
// front); on the double garage gutters along its eaves (their brackets
// on high), a downpipe at each front corner and faint rust streaks under the pipes' clips (not on
// low); and the terraces' walls a coping of stones standing 4 proud with joints.

import { frameOf, fbox } from './house.js';
import { makeRng } from '../../../core/math.js';
import { terraceSpans, chainWindows } from './plan.js';
import { WALL_DRAWN, wallDrawnAt } from '../facades.js';

const CHAIN = { overhang: 60, thick: 18, plinth: 135, win: { w: 150, sill: 170, h: 130 }, door: { w: 116, h: 215 } };
// The dad's roof vents (W3): the hood's and the two pipes' x.
const DAD_VENTS = { hood: 475, pipes: [1095, -244] };
const BLACK = 0x161718;
const ANTENNA = 0x9a9ea2;

export function hardware(kit, L) {
  const R = makeRng(5150);
  const fine = kit.tier !== 'low';
  const finest = kit.tier === 'high';
  for (const h of L.HOUSES) if (h.kit === 'chain') chainHardware(kit, L, h, fine, R, finest);
  for (const a of L.ANTENNAS) antenna(kit, L, a, fine);
  for (const m of L.MAILBOXES ?? []) mailbox(kit, L, m);
  for (const h of L.HOUSES) if (h.kit === 'garage') garageGutters(kit, L, h, fine, finest, R);
  coping(kit, L);
}

// The double garage (lane/houses.js garage(): its roof along w, the eaves on its sides, the
// gables front and back): a half-round gutter along each eave from barge board to barge board
// (its verges, W8 fix), the brackets under it every 60 (high), and a downpipe at each back corner
// of the gable (the front's corners are its pillars: photos 29, 30 show none there), a swan neck
// from the gutter's outlet down under the deep eave to the render, three clips holding it; and
// (not on low) faint rust streaks down the white render from each clip's screws: contact's
// multiply, a rust tint fading to nothing.
function garageGutters(kit, L, h, fine, finest, R) {
  const F = frameOf(h);
  const o = h.overhang ?? CHAIN.overhang;
  const [A, B] = [h.d / 2, h.w / 2]; // (along the ridge: w; across it: u)
  const ve = A + (h.verges ?? o); // (the barge boards' outer faces)
  const tan = (h.ridge - h.eave) / B;
  const lo = h.eave - o * tan;
  const y0 = h.y0 ?? L.GROUND;
  const { metal, contact } = kit;
  metal.color(BLACK);
  for (const s of [-1, 1]) {
    const at = (w) => F.at(s * (B + o + 10), lo - 16, w);
    metal.tube(at(-ve), at(ve), 9, 9, 6, { a0: 0, arc: Math.PI });
    metal.tube(at(-ve), at(ve), 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true });
    if (finest) {
      for (let w = -ve + 30; w <= ve - 30; w += 60) {
        const [a, b] = [F.at(s * (B + o), lo - 26, w - 1.2), F.at(s * (B + o + 20), lo - 26, w + 1.2)];
        metal.box(Math.min(a[0], b[0]), Math.max(a[0], b[0]), lo - 27, lo - 25, Math.min(a[2], b[2]), Math.max(a[2], b[2]), { skip: 't' });
      }
    }
    // The downpipe at the back gable's corner (5 out of the render): from the outlet a short drop,
    // the neck back to the wall at 45 degrees under the eave, then down the corner.
    const u = s * (B - 16);
    const wp = -A - 7;
    const [px, , pz] = F.at(u, 0, wp);
    const drop = F.at(s * (B + o + 10), lo - 40, wp);
    const bend = lo - 40 - (o + 26);
    metal.tube(F.at(s * (B + o + 10), lo - 22, wp), drop, 5, 5, 6);
    metal.tube(drop, [px, bend, pz], 5, 5, 6);
    metal.tube([px, bend, pz], [px, y0 + 12, pz], 5, 5, 6, { caps: true });
    const clips = [y0 + 70, y0 + 170, bend - 30];
    for (const y of clips) {
      const [a, b] = [F.at(u - 6.5, 0, -A - 0.5), F.at(u + 6.5, 0, -A - 13)];
      metal.box(Math.min(a[0], b[0]), Math.max(a[0], b[0]), y - 2, y + 2, Math.min(a[2], b[2]), Math.max(a[2], b[2]));
    }
    if (!fine || !contact) continue;
    // Rust: a thin streak from each clip's screws (either side of the pipe), on the render 0.4
    // proud (contact's polygon offset keeps it over the wall).
    const streak = (uc, ytop, len, wid) => {
      const k = 0.85 + 0.15 * R();
      const rust = [1 - 0.15 * k, 1 - 0.3 * k, 1 - 0.42 * k];
      const P = (du, y) => F.at(uc + du, y, -A - 0.4);
      const q = [P(wid / 2, ytop - len), P(-wid / 2, ytop - len), P(-wid / 2, ytop), P(wid / 2, ytop)];
      const fade = [[1, 1, 1], [1, 1, 1], rust, rust];
      contact.rgb(1, 1, 1);
      // (Facing out of the back gable: -w.)
      if (dot3(cross(sub(q[1], q[0]), sub(q[3], q[0])), F.dir(0, 0, -1)) >= 0) contact.quad(q[0], q[1], q[2], q[3], { shade: fade });
      else contact.quad(q[1], q[0], q[3], q[2], { shade: [fade[1], fade[0], fade[3], fade[2]] });
    };
    for (const y of clips) for (const e of [-1, 1]) streak(u + e * 9, y - 2, 40 + 70 * R(), 3 + 1.5 * R());
  }
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
  if (fine && !h.join) {
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
  // The dad's roof (W3, photos 19-21): two thin vent pipes and a sheet-metal vent hood on the
  // street slope just under the ridge (DAD_VENTS: their x), a ladder up it; south_2's ladder.
  if (dad) {
    const V = DAD_VENTS;
    steel.color(0x2c2e30);
    for (const x of V.pipes) {
      const [u, w] = [h.cx - x, B * 0.22];
      const [px, , pz] = F.at(u, 0, w);
      steel.cyl('y', roof.y(w) - 6, roof.y(w) + 40, px, pz, 5, 10, { caps: true });
      steel.cyl('y', roof.y(w) + 38, roof.y(w) + 44, px, pz, 6.5, 10, { caps: true });
    }
    // The hood: a dark grey box on a sloping base, its flat cap overhanging.
    const [uh, w] = [h.cx - V.hood, B * 0.2];
    paint.color(0x3a3d42);
    const hood = (u0, u1, w0, w1, ya, yb) => {
      const c = (i, j, k) => F.at(i ? u1 : u0, j ? yb : ya, k ? w1 : w0);
      for (const q of [[c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)], [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)], [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0)]]) paint.quad(...orientOut(q, F, (u0 + u1) / 2, (ya + yb) / 2, (w0 + w1) / 2));
    };
    hood(uh - 60, uh + 60, w - 25, w + 25, roof.y(w + 25) - 4, roof.y(w - 25) + 40);
    hood(uh - 66, uh + 66, w - 31, w + 31, roof.y(w - 25) + 40, roof.y(w - 25) + 45);
  }
  if (fine && dad) ladder(kit, F, roof, 160);
  // The neighbours' roofs (W5, photos 14, 15 and 32: h.roofKit): thin vent pipes, a vent cap with
  // a hood (south_1's), a roof hatch (south_2's), a ladder up from the eave to the cap or hatch.
  const K = h.roofKit;
  if (K) {
    steel.color(0x2c2e30);
    for (const x of K.pipes) {
      const [u, w] = [h.cx - x, B * 0.18];
      const [px, , pz] = F.at(u, 0, w);
      steel.cyl('y', roof.y(w) - 6, roof.y(w) + 36, px, pz, 4.5, fine ? 10 : 6, { caps: true });
    }
    const [u, w] = [h.cx - K.at, B * 0.28];
    paint.color(K.hatch ? 0x23272b : 0x3a3d42);
    if (K.hatch) {
      // (A dark framed hatch flush on the slope, its glass a little lighter.)
      onSlope(paint, u - 38, u + 38, w - 34, w + 34, 2.5);
      kit.glass.color(0x4a5058);
      onSlope(kit.glass, u - 30, u + 30, w - 26, w + 26, 3);
    } else {
      const P = (uu, ww, dy) => F.at(uu, roof.y(ww) + dy, ww);
      const box = (u0, u1, w0, w1, ya, yb) => {
        const c = (i, j, k) => P(i ? u1 : u0, k ? w1 : w0, j ? yb : ya);
        for (const q of [[c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)], [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)], [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0)]]) paint.quad(...orientOut(q, F, (u0 + u1) / 2, roof.y((w0 + w1) / 2) + (ya + yb) / 2, (w0 + w1) / 2));
      };
      box(u - 25, u + 25, w - 25, w + 25, -4, 30);
      box(u - 30, u + 30, w - 30, w + 30, 30, 35);
    }
    if (fine) ladder(kit, F, roof, u, w + 40);
  }
  // The walls: air bricks in the plinth, vents under the soffit, splash blocks under the
  // downpipes.
  const plinth = h.plinth ?? CHAIN.plinth;
  const backWins = h.backWindows ?? (h.windows ?? []).map((u) => -u);
  for (const name of ['front', 'back']) {
    const { f, half } = F.face(name);
    const holes = (name === 'front' ? (h.windows ?? []) : backWins).map((u) => [u - 100, u + 100]);
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
    // The downpipes' splash blocks (house.js gableRoof: a pipe at each end of each eave, or those
    // h.pipes lists).
    granite.color(0xb8b4ac);
    for (const e of h.pipes?.[name] ?? [-1, 1]) {
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
    // (A neighbour's bell on the side away from its side light.)
    const dw = (h.doorSize ?? CHAIN.door).w / 2 + 22;
    bell(kit, front, h.door + (h.sidelight ? -dw : dw), 112);
  } else if (typeof h.door === 'object') bell(kit, front, h.door.u - h.door.w / 2 - 26, 118);
  if (fine) {
    kit.metal.color(0xc8c4bc);
    for (const [f, name] of [[front, 'front'], [F.face('back').f, 'back']]) {
      for (const W of chainWindows(h, name, CHAIN.win)) for (const du of [-12, 12]) fbox(kit.metal, f, W.u + du - 1, W.u + du + 1, W.sill + W.h * 0.45, W.sill + W.h * 0.45 + 11, -7, -5, 'k');
    }
  }
  if (dad) {
    // The outdoor socket and the hose reel on the east gable by the drive (W3: past the ivy at the
    // corner, short of the car charger: the socket at z 1405, the reel at 1435, clear of the
    // charger's box, cable and holster from 1470 on).
    const side = F.face('left').f;
    const u = h.cz - 1405;
    kit.enamel.color(0xe8e6e0);
    fbox(kit.enamel, side, u - 6, u + 6, 150, 166, 2, 6, 'k');
    paint.color(BLACK);
    fbox(paint, side, u - 4, u + 4, 152, 160, 6, 6.6, 'k');
    // The reel: a green drum on a bracket, its hose wound on it, a loop hanging.
    const [x, , z] = side.at(u - 30, 0, 22);
    const out = side.out;
    paint.color(0x2f6a3a);
    const c = [x, y0 + 105, z];
    const axis = [side.right[0], 0, side.right[2]];
    kit.paint.tube([c[0] - axis[0] * 12, c[1], c[2] - axis[2] * 12], [c[0] + axis[0] * 12, c[1], c[2] + axis[2] * 12], 20, 20, 12, { caps: true });
    kit.tyre.color(0x1d4a28);
    kit.tyre.tube([c[0] - axis[0] * 9, c[1], c[2] - axis[2] * 9], [c[0] + axis[0] * 9, c[1], c[2] + axis[2] * 9], 22, 22, 12);
    paint.color(0x2f6a3a);
    fbox(paint, side, u - 36, u - 24, 70, 125, 0, 6, 'k');
    void out;
    // Two pot plants on the inner sills of the third and fourth windows from the east.
    for (const wu of [h.windows[2], h.windows[3]]) {
      if (wu === undefined) continue;
      const W = h.win ?? CHAIN.win;
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
function ladder({ metal }, F, roof, u, w1 = 60) {
  metal.color(BLACK);
  const w0 = roof.B + roof.o - 30;
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

// A neighbour's mailbox (W5: layout MAILBOXES): a black steel box on its house's plinth, or on a
// black post (a pale lid on south_1's by the hedge).
function mailbox({ paint, steel }, L, m) {
  paint.color(0x18191b);
  if (m.wall) {
    const f = frameOf(L.HOUSES.find((h) => h.id === m.house)).face('front').f;
    fbox(paint, f, m.u - m.w / 2, m.u + m.w / 2, m.v, m.v + m.h, 2, 2 + m.d);
    paint.color(0x2a2c30);
    fbox(paint, f, m.u - m.w / 2 + 6, m.u + m.w / 2 - 6, m.v + m.h - 18, m.v + m.h - 14, 2 + m.d, 3 + m.d, 'k');
    return;
  }
  steel.color(m.y0 ? 0x8a7a68 : 0x1c1d1f); // (W6: north_5's weathered wooden posts)
  steel.cyl('y', (m.y0 ?? L.GROUND) - 4, m.top - m.h, m.x, m.z, m.y0 ? 5 : 3, 6, { caps: true });
  const [x0, x1, z0, z1] = [m.x - m.w / 2, m.x + m.w / 2, m.z - m.d / 2, m.z + m.d / 2];
  paint.color(m.tint ?? 0x18191b);
  paint.box(x0, x1, m.top - m.h, m.top - (m.lid ? 6 : 0), z0, z1);
  if (m.lid) {
    paint.color(m.lid);
    paint.box(x0 - 2, x1 + 2, m.top - 6, m.top, z0 - 2, z1 + 2);
  }
  paint.color(0x2a2c30);
  paint.box(m.x - m.w / 2 + 6, m.x + m.w / 2 - 6, m.top - m.h + 22, m.top - m.h + 25, z0 - 1, z0, { skip: '+z' });
}

// A TV antenna on a chain house's ridge (layout.js ANTENNAS: lane/props.js antenna()'s place):
// a mast clamped at the ridge, a boom of nine elements, a reflector of three rods, a second
// small array lower down.
function antenna({ steel, paint }, L, { house, x, gable }, fine) {
  const H = L.HOUSES.find((h) => h.id === house);
  const [y, z] = [H.ridge, H.cz];
  const top = y + (gable ? 300 : 250);
  steel.color(ANTENNA);
  steel.cyl('y', y - (gable ? 90 : 20), top, x, z, 3, fine ? 8 : 5, { caps: true });
  if (gable) {
    // (Clamped to the gable's apex: a dark bracket board on the wall under it, two clamps.)
    const wall = H.cx + H.w / 2;
    paint.color(0x1e1f21);
    paint.box(wall, wall + 3, y - 92, y - 62, z - 22, z + 22, { skip: '-x' });
    steel.color(ANTENNA);
    for (const yc of [y - 84, y - 70]) steel.box(wall + 3, x + 4, yc - 2, yc + 2, z - 4, z + 4);
  } else steel.box(x - 7, x + 7, y - 2, y + 14, z - 9, z + 9, { skip: 'b' }); // (the clamp on the ridge)
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

// The terraces' walls' coping (lane/build.js terraces: their fronts along the wall's line but at
// the drives' notches and the steps: plan.js terraceSpans), W6: on the low bed walls' drawn tops
// (facades.js wallDrawnAt), irregular flat slabs 60 .. 110 long and 13 thick, standing 4 proud of
// the face, a little out of line, joints between them.
function coping({ granite }, L) {
  const R = makeRng(2390);
  for (const { spans } of terraceSpans(L)) {
    for (const { a: xa, b: xb, kind } of spans) {
      if (kind !== 'wall') continue;
      for (let x = xa; x < xb - 1; ) {
        let x1 = Math.min(xb, x + 60 + R() * 50);
        const top = L.GROUND + wallDrawnAt(x + 1) + 1.5;
        // (A slab ends where the wall's drawn height steps.)
        for (const [bx] of WALL_DRAWN) if (bx > x + 1 && bx < x1) x1 = bx;
        const out = 3 + R() * 3;
        const t = 11 + R() * 4;
        const [za, zb] = [L.wallZAt(x + 0.01), L.wallZAt(x1 - 0.01)];
        granite.color(0xc8c2b8, 0.86 + 0.16 * R());
        const F = (xx, zz, y) => [xx, y, zz];
        const xe = x1 - 0.8;
        granite.quad(F(x, za + out, top - t), F(xe, zb + out, top - t), F(xe, zb + out, top), F(x, za + out, top));
        granite.quad(F(x, za + out, top), F(xe, zb + out, top), F(xe, zb - 30, top), F(x, za - 30, top));
        granite.quad(F(x, za - 30, top - t), F(x, za + out, top - t), F(x, za + out, top), F(x, za - 30, top), { shade: 0.7 });
        granite.quad(F(xe, zb + out, top - t), F(xe, zb - 30, top - t), F(xe, zb - 30, top), F(xe, zb + out, top), { shade: 0.7 });
        granite.quad(F(x, za, top - t), F(xe, zb, top - t), F(xe, zb + out, top - t), F(x, za + out, top - t), { shade: 0.5 });
        x = x1;
      }
    }
  }
}
