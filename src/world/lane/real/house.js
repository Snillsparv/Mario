// The realistic look's chain houses (lane/layout.js HOUSES of kit 'chain': the dad's and his
// neighbours along the south side, the corner house, the east house), built in the worker
// (world/lane/real/detail.js) in place of everything lane/houses.js chain() draws for them (its
// collider stays the classic one: one convex solid to the eaves and the gable roof).
//
//   chainHouse(kit, L, h, { tiled })   // kit: detail.js's Geo per material; tiled: its roof in
//                                      // real tile courses (else the normal-mapped tile set)
//   tileCourses(g, e0, e1, up, len, seg)   // pan tile courses on one roof slope (below)
//   frameOf(h) -> { at(u, y, w), dir(du, dy, dw), face(name) -> { f, half } }   // a house's own
//                                      // frame (lane/houses.js frame): f a wall frame
//   wallFrame(origin, out) -> { at(u, v, w), dir, out }   // u right seen from outside, v up, w out
//   fbox(g, f, u0, u1, v0, v1, w0, w1, skip?)   // a box in a wall frame (skip: 'fklrtb', the
//                                      // faces left out: front back left right top bottom)
//
// Walls: a white brick plinth standing 2 proud of the boards (a sloping black flashing on its
// top), the boards up to the eaves, or white brick to the eaves on gable ends, the gables'
// triangles in boards; real openings for the windows and the door, so the windows sit in the
// wall: a black casing proud of the boards, a reveal 10 deep, the frame and two casements with
// glazing bars, the glass (the reflection probe's street) over white curtains and a dim room, a
// sloping sheet-metal sill. The door: a black frame, the leaf set back with a handle, a lamp
// beside it; the dad's is door.js's (it swings: the realistic build leaves it its opening) with a
// glazed side light. The roof: pan tile courses (or the tile set; the courses sunk into the roof's
// plane, so Jonas stands on their crowns; the walls stop under it), a soffit, a black fascia, a
// half-round gutter with a downpipe at each end down the wall, black barge boards and a roll of
// verge tiles up the gables, a rounded ridge cap; the tile courses cast no shadow themselves
// (their rolls' self-shadow would shimmer at the shadow map's texels): a flat stand-in under
// them casts the roof's.

import { add, mul, sub, dot, cross, norm } from './geo.js';

export function wallFrame(origin, out) {
  const l = Math.hypot(out[0], out[2]);
  const o = [out[0] / l, 0, out[2] / l];
  const right = [o[2], 0, -o[0]];
  const at = (u, v, w = 0) => [origin[0] + right[0] * u + o[0] * w, origin[1] + v, origin[2] + right[2] * u + o[2] * w];
  const dir = (du, dv, dw) => [right[0] * du + o[0] * dw, dv, right[2] * du + o[2] * dw];
  return { at, dir, out: o, right };
}

export function frameOf(h) {
  const c = Math.cos(h.yaw ?? 0);
  const s = Math.sin(h.yaw ?? 0);
  const at = (u, y, w) => [h.cx + u * c + w * s, y, h.cz - u * s + w * c];
  const dir = (du, dy, dw) => [du * c + dw * s, dy, -du * s + dw * c];
  const y0 = h.y0 ?? 0;
  const face = (name) => {
    if (name === 'front') return { f: wallFrame(at(0, y0, h.d / 2), dir(0, 0, 1)), half: h.w / 2 };
    if (name === 'back') return { f: wallFrame(at(0, y0, -h.d / 2), dir(0, 0, -1)), half: h.w / 2 };
    if (name === 'right') return { f: wallFrame(at(h.w / 2, y0, 0), dir(1, 0, 0)), half: h.d / 2 };
    return { f: wallFrame(at(-h.w / 2, y0, 0), dir(-1, 0, 0)), half: h.d / 2 };
  };
  return { at, dir, face };
}

export function fbox(g, f, u0, u1, v0, v1, w0, w1, skip = '') {
  const c = (i, j, k) => f.at(i ? u1 : u0, j ? v1 : v0, k ? w1 : w0);
  const faces = {
    f: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    k: [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)],
    l: [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    r: [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)],
    t: [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0)],
    b: [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
  };
  for (const [k, q] of Object.entries(faces)) if (!skip.includes(k)) g.quad(q[0], q[1], q[2], q[3]);
}

const TINT = { brick: 0xece8de, black: 0x1a1b1d, door: 0x161718, curtain: 0xe8e2d6, sill: 0x2a2c2e, fascia: 0x18191b, soffit: 0x2a2624, gutter: 0x1c1d1f, lamp: 0xf2e6c4, handle: 0xa8a49a };
const WIN = { w: 150, sill: 170, h: 130, casing: 9, reveal: 10 };
const DOOR = { w: 116, h: 215 };
const PLINTH = 135;
const ROOF = { overhang: 60, thick: 18, fascia: 22 };
// The tile courses: COURSE up the slope a course, WAVE across a roll, each course's nose NOSE proud
// of the one below it, the rolls ROLL high, all sunk SINK into the roof's plane (the collider
// Jonas walks on: so he stands on the rolls' crowns, at most 1.5 over it, not among them); SEG
// segments a roll per tier (none on low).
const TILE = { COURSE: 54, WAVE: 45, NOSE: 3.2, ROLL: 5.5, LAP: 6, SINK: 7.2 };
const TOP_GAP = 10;
export const TILE_SEG = { high: 5, mid: 4, low: 0 };

// A wall band on frame f from u0 to u1, v0 to v1 at w, with rectangular holes { u0, u1, v0, v1 }
// cut out of it; uvs in world units across the face.
function band(g, f, u0, u1, v0, v1, w, holes) {
  const rect = (a, b, c, d) => g.quad(f.at(a, c, w), f.at(b, c, w), f.at(b, d, w), f.at(a, d, w), { uvs: [[a, c], [b, c], [b, d], [a, d]] });
  const cuts = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.v1 > v0 && o.v0 < v1).sort((p, q) => p.u0 - q.u0);
  let u = u0;
  for (const o of cuts) {
    if (o.u0 > u) rect(u, o.u0, v0, v1);
    if (o.v0 > v0) rect(o.u0, o.u1, v0, Math.min(v1, o.v0));
    if (o.v1 < v1) rect(o.u0, o.u1, Math.max(v0, o.v1), v1);
    u = o.u1;
  }
  if (u < u1) rect(u, u1, v0, v1);
}

export function chainHouse(kit, L, h, { tiled = false } = {}) {
  const F = frameOf(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const plinth = h.plinth ?? PLINTH;
  const dad = typeof h.door === 'object';
  const holes = { front: [], back: [], left: [], right: [] };
  const win = (u) => ({ u0: u - WIN.w / 2, u1: u + WIN.w / 2, v0: WIN.sill, v1: WIN.sill + WIN.h });
  for (const u of h.windows ?? []) {
    holes.front.push(win(u));
    holes.back.push(win(-u));
  }
  let side = null;
  if (dad) {
    const D = h.door;
    holes.front.push({ u0: D.u - D.w / 2, u1: D.u + D.w / 2, v0: 0, v1: D.h });
    side = { u0: D.u + D.w / 2 + 14, u1: D.u + D.w / 2 + 78, v0: 40, v1: D.h };
    holes.front.push(side);
  } else if (typeof h.door === 'number') holes.front.push({ u0: h.door - DOOR.w / 2, u1: h.door + DOOR.w / 2, v0: 0, v1: DOOR.h });
  // The walls: the plinth (or the gable end) in white brick, 2 proud, the boards over it, the
  // gables' triangles; the flashing on the plinth's top.
  // (The walls stop TOP_GAP under the roof's plane: the tile courses sink into it, and a wall's
  // edge would show between their rolls.)
  const top = wallH - TOP_GAP;
  for (const name of ['front', 'back', 'left', 'right']) {
    const { f, half } = F.face(name);
    const gable = name === 'left' || name === 'right';
    const brickTop = gable && h.gableEnds ? top : plinth;
    kit.brick.color(TINT.brick);
    band(kit.brick, f, -half - 2, half + 2, -4, brickTop, 2, holes[name]);
    if (brickTop < top) {
      kit.boards.color(h.boards);
      band(kit.boards, f, -half, half, brickTop, top, 0, holes[name]);
      kit.metal.color(TINT.black);
      kit.metal.quad(f.at(-half - 2, plinth - 3, 5), f.at(half + 2, plinth - 3, 5), f.at(half + 2, plinth + 3, 0), f.at(-half - 2, plinth + 3, 0));
    }
    if (gable) {
      kit.boards.color(h.gableBoards ?? h.boards);
      kit.boards.tri(f.at(-half, top, 0), f.at(half, top, 0), f.at(0, h.ridge - y0 - TOP_GAP, 0), { uvs: [[-half, top], [half, top], [0, h.ridge - y0 - TOP_GAP]] });
    }
  }
  const front = F.face('front').f;
  const back = F.face('back').f;
  const bars = kit.tier === 'low' ? 0 : 2;
  for (const u of h.windows ?? []) {
    windowAt(kit, front, win(u), { bars });
    windowAt(kit, back, win(-u), { bars });
  }
  if (dad) windowAt(kit, front, side, { bars, mullion: false, curtains: false });
  else if (typeof h.door === 'number') doorAt(kit, front, h.door);
  gableRoof(kit, F, h, tiled);
}

// A window in the opening o of wall frame f (its glass 10 in, the casing proud).
function windowAt(kit, f, o, { bars = 2, mullion = true, curtains = true } = {}) {
  const { paint, glass, cloth, core, metal } = kit;
  const { u0, u1, v0, v1 } = o;
  const cs = WIN.casing;
  const R = -WIN.reveal;
  paint.color(TINT.black);
  // The casing: over the top and down the sides, 3 proud.
  fbox(paint, f, u0 - cs, u1 + cs, v1, v1 + cs, 0, 3, 'k');
  fbox(paint, f, u0 - cs, u0, v0, v1, 0, 3, 'kt');
  fbox(paint, f, u1, u1 + cs, v0, v1, 0, 3, 'kt');
  // The reveal: the opening's sides and head, into the wall to the frame.
  paint.color(TINT.black, 1.4);
  paint.quad(f.at(u0, v0, R), f.at(u0, v0, 0), f.at(u0, v1, 0), f.at(u0, v1, R));
  paint.quad(f.at(u1, v0, 0), f.at(u1, v0, R), f.at(u1, v1, R), f.at(u1, v1, 0));
  paint.quad(f.at(u0, v1, 0), f.at(u1, v1, 0), f.at(u1, v1, R), f.at(u0, v1, R));
  // The frame and the casements (6 wide), their glazing bars.
  paint.color(TINT.black);
  const fr = 6;
  const sash = (a, b) => {
    fbox(paint, f, a, b, v1 - fr, v1, R, R + 3, 'k');
    fbox(paint, f, a, b, v0, v0 + fr, R, R + 3, 'k');
    fbox(paint, f, a, a + fr, v0 + fr, v1 - fr, R, R + 3, 'ktb');
    fbox(paint, f, b - fr, b, v0 + fr, v1 - fr, R, R + 3, 'ktb');
    for (let k = 1; k <= bars; k++) {
      const v = v0 + ((v1 - v0) * k) / (bars + 1);
      fbox(paint, f, a + fr, b - fr, v - 1.5, v + 1.5, R, R + 2, 'klr');
    }
  };
  const mid = (u0 + u1) / 2;
  if (mullion) {
    sash(u0, mid);
    sash(mid, u1);
  } else sash(u0, u1);
  glass.color(0x9aa4a8);
  glass.quad(f.at(u0, v0, R - 1), f.at(u1, v0, R - 1), f.at(u1, v1, R - 1), f.at(u0, v1, R - 1));
  // White curtains in folds either side, a little behind the glass.
  if (curtains) {
    for (const [ca, cb] of [[u0 + 4, u0 + 30], [u1 - 30, u1 - 4]]) {
      for (let i = 0; i < 5; i++) {
        const a = ca + ((cb - ca) * i) / 5;
        const b = ca + ((cb - ca) * (i + 1)) / 5;
        const [da, db] = [R - 6 - (i % 2) * 3, R - 6 - ((i + 1) % 2) * 3];
        cloth.color(TINT.curtain, i % 2 ? 0.47 : 0.55);
        cloth.quad(f.at(a, v0 + 2, da), f.at(b, v0 + 2, db), f.at(b, v1 - 2, db), f.at(a, v1 - 2, da));
      }
    }
  }
  // The room behind: a dim box.
  const RB = R - 140;
  core.rgb(0.1, 0.085, 0.07);
  core.quad(f.at(u0, v0, RB), f.at(u1, v0, RB), f.at(u1, v1, RB), f.at(u0, v1, RB));
  core.rgb(0.12, 0.1, 0.08);
  core.quad(f.at(u0, v0, R - 2), f.at(u0, v0, RB), f.at(u0, v1, RB), f.at(u0, v1, R - 2));
  core.quad(f.at(u1, v0, RB), f.at(u1, v0, R - 2), f.at(u1, v1, R - 2), f.at(u1, v1, RB));
  core.rgb(0.14, 0.12, 0.1);
  core.quad(f.at(u0, v0, R - 2), f.at(u1, v0, R - 2), f.at(u1, v0, RB), f.at(u0, v0, RB));
  core.quad(f.at(u0, v1, RB), f.at(u1, v1, RB), f.at(u1, v1, R - 2), f.at(u0, v1, R - 2));
  // The sill: sheet metal sloping out from the frame's foot past the casing, a drip edge.
  metal.color(TINT.sill);
  const [sa, sb] = [u0 - cs - 4, u1 + cs + 4];
  metal.quad(f.at(sa, v0 + 1, R + 1), f.at(sa, v0 - 2, 9), f.at(sb, v0 - 2, 9), f.at(sb, v0 + 1, R + 1));
  metal.quad(f.at(sa, v0 - 2, 9), f.at(sa, v0 - 7, 9.5), f.at(sb, v0 - 7, 9.5), f.at(sb, v0 - 2, 9));
}

// A front door at u (its opening DOOR wide): a black frame, the leaf set back 6, a handle, a
// lamp beside it.
function doorAt(kit, f, u) {
  const { paint, metal } = kit;
  const [u0, u1] = [u - DOOR.w / 2, u + DOOR.w / 2];
  const cs = 12;
  paint.color(TINT.black);
  fbox(paint, f, u0 - cs, u1 + cs, DOOR.h, DOOR.h + cs, 0, 3, 'k');
  fbox(paint, f, u0 - cs, u0, 0, DOOR.h, 0, 3, 'kt');
  fbox(paint, f, u1, u1 + cs, 0, DOOR.h, 0, 3, 'kt');
  paint.color(TINT.black, 1.4);
  paint.quad(f.at(u0, 0, -6), f.at(u0, 0, 0), f.at(u0, DOOR.h, 0), f.at(u0, DOOR.h, -6));
  paint.quad(f.at(u1, 0, 0), f.at(u1, 0, -6), f.at(u1, DOOR.h, -6), f.at(u1, DOOR.h, 0));
  paint.quad(f.at(u0, DOOR.h, 0), f.at(u1, DOOR.h, 0), f.at(u1, DOOR.h, -6), f.at(u0, DOOR.h, -6));
  paint.color(TINT.door);
  paint.quad(f.at(u0, 0, -6), f.at(u1, 0, -6), f.at(u1, DOOR.h, -6), f.at(u0, DOOR.h, -6));
  metal.color(TINT.handle);
  fbox(metal, f, u1 - 22, u1 - 10, 100, 104, -6, 2, 'k');
  fbox(metal, f, u1 - 14, u1 - 10, 90, 118, -6, -3, 'k');
  lamp(kit, f, u1 + cs + 40, 200);
}

// A small black wall lantern at (u, v) on frame f, its glass lit warm.
export function lamp({ paint, gloss }, f, u, v) {
  paint.color(TINT.black);
  fbox(paint, f, u - 9, u + 9, v, v + 35, 4, 20, 'k');
  fbox(paint, f, u - 11, u + 11, v + 35, v + 40, 2, 22, 'k');
  fbox(paint, f, u - 3, u + 3, v + 8, v + 26, 0, 4, 'k');
  gloss.color(TINT.lamp);
  gloss.quad(f.at(u - 7, v + 4, 20.5), f.at(u + 7, v + 4, 20.5), f.at(u + 7, v + 32, 20.5), f.at(u - 7, v + 32, 20.5));
}

// ---------------------------------------------------------------- the roof

// Pan tile courses on one slope: its eave from e0 to e1, rising along `up` (unit) for `len`;
// each course a strip of the double roll across (smooth analytic normals), tilted so its lower
// nose stands NOSE proud of the course below, lapping LAP under the next, and the nose's face
// (down to the batten at the eave); `seg` segments a roll. Each quad wound to face out (the
// slope's outward normal, up): both slopes of a roof were culled away once.
export function tileCourses(g, e0, e1, up, len, seg) {
  const { COURSE, WAVE, NOSE, ROLL, LAP, SINK } = TILE;
  const run = Math.hypot(...sub(e1, e0));
  const ex = norm(sub(e1, e0));
  let nrm = norm(cross(ex, up));
  if (nrm[1] < 0) nrm = mul(nrm, -1);
  const prof = (x) => ROLL * (0.5 + 0.5 * Math.cos((x * 2 * Math.PI) / WAVE)) - SINK;
  const dprof = (x) => -ROLL * 0.5 * Math.sin((x * 2 * Math.PI) / WAVE) * ((2 * Math.PI) / WAVE);
  const P = (x, s, off) => add(add(add(e0, mul(ex, x)), mul(up, s)), mul(nrm, off));
  const N = (x, slope) => {
    let n = norm(cross(add(ex, mul(nrm, dprof(x))), sub(up, mul(nrm, slope))));
    if (dot(n, nrm) < 0) n = mul(n, -1);
    return n;
  };
  const flip = dot(cross(ex, up), nrm) < 0;
  const q = (a, b, c, d, n, uvs, shade = 1) => (flip ? g.quad(b, a, d, c, { n: [n[1], n[0], n[3], n[2]], uvs: [uvs[1], uvs[0], uvs[3], uvs[2]], shade }) : g.quad(a, b, c, d, { n, uvs, shade }));
  const xs = [];
  for (let x = 0; x < run + 1e-6; x += WAVE / seg) xs.push(Math.min(x, run));
  if (xs[xs.length - 1] < run - 1e-3) xs.push(run);
  const courses = Math.ceil(len / COURSE);
  const nose = mul(up, -1);
  const nn = norm(add(nose, mul(nrm, 0.35)));
  for (let k = 0; k < courses; k++) {
    const s0 = k * COURSE;
    const s1 = Math.min(len, s0 + COURSE + LAP);
    const slope = NOSE / (s1 - s0);
    for (let i = 0; i + 1 < xs.length; i++) {
      const [a, b] = [xs[i], xs[i + 1]];
      const [pa, pb] = [prof(a), prof(b)];
      const [na, nb] = [N(a, slope), N(b, slope)];
      q(P(a, s0, pa + NOSE), P(b, s0, pb + NOSE), P(b, s1, pb), P(a, s1, pa), [na, nb, nb, na], [[a, s0], [b, s0], [b, s1], [a, s1]]);
      const [la, lb] = k === 0 ? [-3 - SINK, -3 - SINK] : [pa, pb];
      q(P(a, s0, la), P(b, s0, lb), P(b, s0, pb + NOSE), P(a, s0, pa + NOSE), [nn, nn, nn, nn], [[a, s0 - 4], [b, s0 - 4], [b, s0], [a, s0]], 0.7);
    }
  }
}

// The gable roof along u (lane/houses.js gableRoof's shape): its slopes (tile courses over a
// flat shadow stand-in, or the tile set), soffits, fascias, gutters and downpipes, barge boards
// and verge rolls, the ridge cap.
function gableRoof(kit, F, h, tiled) {
  const o = h.overhang ?? ROOF.overhang;
  const [A, B] = [h.w / 2, h.d / 2];
  const tan = (h.ridge - h.eave) / B;
  const lo = h.eave - o * tan;
  const y0 = h.y0 ?? 22;
  const T = ROOF.thick;
  const seg = TILE_SEG[kit.tier] ?? 0;
  for (const s of [-1, 1]) {
    const edge = s * (B + o);
    const out = F.dir(0, 0, s);
    const [e0, e1] = [F.at(-A - o, lo, edge), F.at(A + o, lo, edge)];
    const [r0, r1] = [F.at(-A - o, h.ridge, 0), F.at(A + o, h.ridge, 0)];
    const up = norm(sub(r0, e0));
    const len = Math.hypot(...sub(r0, e0));
    // (Wound to face out: the side's order flips with s.)
    const slope = s > 0 ? [e0, e1, r1, r0] : [e1, e0, r0, r1];
    if (tiled && seg) {
      kit.tiles.color(h.roof);
      tileCourses(kit.tiles, e0, e1, up, len, seg);
      kit.shadow.quad(...slope.map((p) => sub(p, mul(F.dir(0, 1, s * tan), 3 + TILE.SINK))));
    } else {
      kit.roof.color(h.roof);
      const ex = norm(sub(e1, e0));
      const uv = (p) => [dot(sub(p, e0), ex), dot(sub(p, e0), up)];
      kit.roof.quad(...slope, { uvs: slope.map(uv) });
    }
    // The soffit under the overhang (dark), the fascia along the eave.
    const dn = (p) => [p[0], p[1] - T, p[2]];
    kit.paint.color(TINT.soffit);
    kit.paint.quad(...[slope[1], slope[0], slope[3], slope[2]].map(dn), { shade: 0.6 });
    kit.paint.color(TINT.fascia);
    const fa = add(e0, mul(out, 1));
    const fb = add(e1, mul(out, 1));
    const fq = [[fa[0], lo - T - 4, fa[2]], [fb[0], lo - T - 4, fb[2]], [fb[0], lo + 1, fb[2]], [fa[0], lo + 1, fa[2]]];
    kit.paint.quad(...(s > 0 ? fq : [fq[1], fq[0], fq[3], fq[2]]));
    // The gutter: a half-round trough hung on the fascia; a downpipe at each end, a swan neck
    // back to the wall and down it to a shoe at the ground.
    const g = kit.metal;
    g.color(TINT.gutter);
    const gc = (p) => add([p[0], lo - 12, p[2]], mul(out, 10));
    const [ga, gb] = [gc(F.at(-A - o + 4, 0, edge)), gc(F.at(A + o - 4, 0, edge))];
    g.tube(ga, gb, 9, 9, 6, { a0: 0, arc: Math.PI });
    g.tube(ga, gb, 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true });
    for (const e of [-1, 1]) {
      const u = e * (A - 25);
      const top = gc(F.at(u, 0, edge));
      const wall = add(F.at(u, lo - 60, s * B), mul(out, 8));
      g.tube([top[0], top[1] - 6, top[2]], wall, 5, 5, 6);
      g.tube(wall, [wall[0], y0 + 14, wall[2]], 5, 5, 6);
      g.tube([wall[0], y0 + 14, wall[2]], add([wall[0], y0 + 4, wall[2]], mul(out, 10)), 5, 5, 6, { caps: true });
    }
  }
  // Barge boards up both gables, a roll of verge tiles over each, the ridge cap.
  for (const e of [-1, 1]) {
    const a = e * (A + o);
    const vout = F.dir(e, 0, 0);
    for (const s of [-1, 1]) {
      const edge = s * (B + o);
      const [p, q] = [add(F.at(a, lo, edge), mul(vout, 1)), add(F.at(a, h.ridge, 0), mul(vout, 1))];
      kit.paint.color(TINT.fascia);
      const board = [[p[0], p[1] - 22, p[2]], [q[0], q[1] - 22, q[2]], [q[0], q[1] + 3, q[2]], [p[0], p[1] + 3, p[2]]];
      kit.paint.quad(...((e > 0) !== (s > 0) ? [board[1], board[0], board[3], board[2]] : board));
      kit.tiles.color(h.roof, 0.85);
      kit.tiles.tube(add(p, [0, -5, 0]), add(q, [0, -5, 0]), 7, 7, 5, { a0: Math.PI, arc: Math.PI, caps: true });
    }
  }
  // (Low on the ridge, its top 2 over the collider's ridge line Jonas stands on: his feet sink
  // no deeper there than on the rolls' crowns.)
  kit.tiles.color(h.roof, 0.9);
  const [ra, rb] = [F.at(-A - o - 4, h.ridge - 10, 0), F.at(A + o + 4, h.ridge - 10, 0)];
  kit.tiles.tube(ra, rb, 12, 12, 8, { a0: Math.PI, arc: Math.PI, caps: true });
  // The ridge tiles' joints: thin dark rings every 40.
  const run = Math.hypot(...sub(rb, ra));
  const ex = norm(sub(rb, ra));
  kit.paint.color(0x0a0a0a);
  for (let x = 40; x < run; x += 40) kit.paint.tube(add(ra, mul(ex, x)), add(ra, mul(ex, x + 2)), 12.4, 12.4, 8, { a0: Math.PI, arc: Math.PI });
}
