// The realistic look's chain houses (lane/layout.js HOUSES of kit 'chain': the dad's and his
// neighbours along the south side, the corner house, the east house), built in the worker
// (world/lane/real/detail.js) in place of everything lane/houses.js chain() draws for them (its
// collider stays the classic one: one convex solid to the eaves and the gable roof).
//
//   chainHouse(kit, L, h, { tiled, seg })   // kit: detail.js's Geo per material; tiled: its roof in
//                                      // real tile courses (else the normal-mapped tile set),
//                                      // seg segments a roll (TILE_SEG's tier's by default)
//   tileCourses(g, e0, e1, up, len, seg)   // pan tile courses on one roof slope (below)
//   frameOf(h) -> { at(u, y, w), dir(du, dy, dw), face(name) -> { f, half } }   // a house's own
//                                      // frame (lane/houses.js frame): f a wall frame
//   wallFrame(origin, out) -> { at(u, v, w), dir, out }   // u right seen from outside, v up, w out
//   fbox(g, f, u0, u1, v0, v1, w0, w1, skip?)   // a box in a wall frame (skip: 'fklrtb', the
//                                      // faces left out: front back left right top bottom)
//   wallWear(L, f, top, len?) -> (p) => wear   // a wall quad's weathering (Geo.wearAt; the
//                                      // materials' WEAR): how far under `top` (the sill or the
//                                      // eave over it, v in frame f), how high over the ground
//                                      // 40 out in front of the wall, its streaks' length
//   streakLength(u) -> 0.7 .. 1.3      // a sill's streaks' length, by where it is
//
// Walls: a white brick plinth standing 2 proud of the boards (a sloping black flashing on its
// top), the boards up to the eaves, or white brick to the eaves on gable ends, the gables'
// triangles in boards; real openings for the windows and the door, so the windows sit in the
// wall: a black casing proud of the boards, a reveal 10 deep, the frame and two casements with
// glazing bars, the glass (the reflection probe's street) over white curtains and a dim room, a
// sloping sheet-metal sill. Each wall quad carries the weathering's `wear` attribute (wallWear:
// how far under the sill over it, on down the plinth under a window, or under the eaves; the
// gables' triangles in two halves, so their distance under the verge is exact). The door: a
// black frame, the leaf set back with a handle, a lamp
// beside it; the dad's is door.js's (it swings: the realistic build leaves it its opening) with a
// glazed side light. The roof: pan tile courses (or the tile set; the courses sunk into the roof's
// plane, so Jonas stands on their crowns; the walls stop under it), a soffit, a black fascia, a
// half-round gutter with a downpipe at each end down the wall, black barge boards and a roll of
// verge tiles up the gables, a rounded ridge cap; the tile courses cast no shadow themselves
// (their rolls' self-shadow would shimmer at the shadow map's texels): a flat stand-in under
// them casts the roof's.

import { add, mul, sub, dot, cross, norm } from './geo.js';
import { brickSpans, chainFaces, chainWindows } from './plan.js';
import { GABLES, dormerOf } from '../facades.js';

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

const TINT = { brick: 0xf0ece8, black: 0x1a1b1d, door: 0x161718, curtain: 0xe8e2d6, sill: 0x2a2c2e, fascia: 0x18191b, soffit: 0x2a2624, gutter: 0x1c1d1f, lamp: 0xf2e6c4, handle: 0xa8a49a };
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
// A ridge tile's length (W2: ~33 cm at the street's 1.5, the 1.3 plan's longer ridges as many
// joints as before).
const RIDGE_TILE = 50;

export function wallWear(L, f, top, len = 1) {
  const y0 = f.at(0, 0, 0)[1];
  return (p) => [Math.max(0, top - (p[1] - y0)), p[1] - L.groundHeight(p[0] + f.out[0] * 40, p[2] + f.out[2] * 40), len];
}

export const streakLength = (u) => 0.7 + 0.6 * ((((Math.sin(u * 12.9898 + 4.1) * 43758.5453) % 1) + 1) % 1);

// A wall band on frame f from u0 to u1, v0 to v1 at w, with rectangular holes { u0, u1, v0, v1 }
// cut out of it; uvs in world units across the face. wear { L, eave }: each quad's weathering
// (under its hole's sill, or under the eave).
function band(g, f, u0, u1, v0, v1, w, holes, wear = null, turn = 0) {
  const rect = (a, b, c, d, under = null) => {
    if (wear) g.wearAt = wallWear(wear.L, f, under ? under.v0 : wear.eave, under ? streakLength(under.u0) : 0.5);
    // (`turn`: the set turned a quarter, its boards across the band, `turn` times as close.)
    const uvs = turn ? [[c * turn, a], [c * turn, b], [d * turn, b], [d * turn, a]] : [[a, c], [b, c], [b, d], [a, d]];
    g.quad(f.at(a, c, w), f.at(b, c, w), f.at(b, d, w), f.at(a, d, w), { uvs });
  };
  const cuts = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.v1 > v0 && o.v0 < v1).sort((p, q) => p.u0 - q.u0);
  // (Under a window over the band, its sill's streaks run on down it: the plinth's.)
  const sills = wear ? holes.filter((o) => o.v0 >= v1 && o.u1 > u0 && o.u0 < u1).sort((p, q) => p.u0 - q.u0) : [];
  const span = (a, b) => {
    let u = a;
    for (const o of sills) {
      if (o.u1 <= u || o.u0 >= b) continue;
      if (o.u0 > u) rect(u, o.u0, v0, v1);
      rect(Math.max(u, o.u0), Math.min(b, o.u1), v0, v1, o);
      u = Math.min(b, o.u1);
    }
    if (u < b) rect(u, b, v0, v1);
  };
  let u = u0;
  for (const o of cuts) {
    if (o.u0 > u) span(u, o.u0);
    if (o.v0 > v0) rect(o.u0, o.u1, v0, Math.min(v1, o.v0), o);
    if (o.v1 < v1) rect(o.u0, o.u1, Math.max(v0, o.v1), v1);
    u = o.u1;
  }
  if (u < u1) span(u, u1);
  g.wearAt = null;
}

export function chainHouse(kit, L, h, { tiled = false, seg = TILE_SEG[kit.tier] ?? 0 } = {}) {
  const F = frameOf(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const plinth = h.plinth ?? PLINTH;
  const dad = typeof h.door === 'object';
  const holes = { front: [], back: [], left: [], right: [] };
  // (A house's own openings, h.win: the dad's and his neighbours' bigger, two casements of three
  // lights; a front window's own kind, h.panes: plan.js chainWindows.)
  const win = (o) => ({ u0: o.u - o.w / 2, u1: o.u + o.w / 2, v0: o.sill, v1: o.sill + o.h, kind: o.kind });
  const wins = { front: chainWindows(h, 'front', WIN).map(win), back: chainWindows(h, 'back', WIN).map(win) };
  holes.front.push(...wins.front);
  holes.back.push(...wins.back);
  let side = null;
  if (dad) {
    // The door's opening from its sill (the landing's top) and the side light west of it in the
    // same dark frame.
    const D = h.door;
    holes.front.push({ u0: D.u - D.w / 2, u1: D.u + D.w / 2, v0: D.sill ?? 0, v1: D.h });
    side = { u0: D.u + D.w / 2 + 16 + WIN.casing, u1: D.u + D.w / 2 + 88, v0: (D.sill ?? 0) + 34, v1: D.h - WIN.casing };
    holes.front.push(side);
  } else if (typeof h.door === 'number') {
    const D = h.doorSize ?? DOOR;
    holes.front.push({ u0: h.door - D.w / 2, u1: h.door + D.w / 2, v0: 0, v1: D.h });
    // (A neighbour's side light west of its door, in the same dark frame: W5.)
    if (h.sidelight) {
      const S = h.sidelight;
      side = { u0: S.u - S.w / 2, u1: S.u + S.w / 2, v0: 30, v1: D.h - WIN.casing };
      holes.front.push(side);
    }
  }
  // (W8: a gable's own windows: facades.js GABLES.)
  const gables = GABLES[h.id] ?? {};
  for (const [name, G] of Object.entries(gables)) for (const o of G.windows) holes[name].push({ u0: o.u - o.w / 2, u1: o.u + o.w / 2, v0: o.sill, v1: o.sill + o.h, bars: o.bars });
  // The walls: the plinth (or the gable end, or a face's brick ranges: h.brick) in white brick, 2
  // proud, the boards over it, the gables' triangles; the flashing on the plinth's top. (A wing's
  // end inside the main body is not drawn: lane/houses.js chainFaces.)
  // (The walls stop TOP_GAP under the roof's plane: the tile courses sink into it, and a wall's
  // edge would show between their rolls.)
  const top = wallH - TOP_GAP;
  for (const name of chainFaces(h)) {
    const { f, half } = F.face(name);
    const gable = name === 'left' || name === 'right';
    const wear = { L, eave: top };
    for (const [a, b, full] of brickSpans(h, name, half)) {
      const brickTop = full || (gable && h.gableEnds) ? top : plinth;
      const [ea, eb] = [a === -half ? -2 : 0, b === half ? 2 : 0];
      kit.brick.color(TINT.brick);
      band(kit.brick, f, a + ea, b + eb, -4, brickTop, 2, holes[name], wear);
      // (A pier's side, where it stands 2 proud of the boards beside it.)
      for (const [u, s] of [[a, -1], [b, 1]]) if (full && Math.abs(u) < half) kit.brick.quad(f.at(u, plinth, s > 0 ? 2 : 0), f.at(u, plinth, s > 0 ? 0 : 2), f.at(u, top, s > 0 ? 0 : 2), f.at(u, top, s > 0 ? 2 : 0));
      if (brickTop < top) {
        kit.boards.color(h.boards);
        band(kit.boards, f, a, b, brickTop, top, 0, holes[name], wear);
        kit.metal.color(TINT.black);
        kit.metal.quad(f.at(a + ea, plinth - 3, 5), f.at(b + eb, plinth - 3, 5), f.at(b + eb, plinth + 3, 0), f.at(a + ea, plinth + 3, 0));
      }
    }
    if (gable) {
      // The gable's triangle in two halves (each one's distance under the verge over it is then
      // exact).
      const apex = h.ridge - y0 - TOP_GAP;
      const g = kit.boards;
      g.color(h.gableBoards ?? h.boards);
      const verge = wallWear(L, f, 0, 1.3);
      g.wearAt = (p) => {
        const u = (p[0] - f.at(0, 0, 0)[0]) * f.right[0] + (p[2] - f.at(0, 0, 0)[2]) * f.right[2];
        const w = verge(p);
        return [Math.max(0, apex - (Math.abs(u) / half) * (apex - top) - (p[1] - y0)), w[1], w[2]];
      };
      g.tri(f.at(-half, top, 0), f.at(0, top, 0), f.at(0, apex, 0), { uvs: [[-half, top], [0, top], [0, apex]] });
      g.tri(f.at(0, top, 0), f.at(half, top, 0), f.at(0, apex, 0), { uvs: [[0, top], [half, top], [0, apex]] });
      g.wearAt = null;
    }
  }
  // (W8: a gable's panels, boards proud of its brick round its windows (a shiplap panel's
  // courses dark lines across it); the windows in them.)
  for (const [name, G] of Object.entries(gables)) {
    const { f } = F.face(name);
    const wins = holes[name].filter((o) => o.bars !== undefined);
    const casing = wins.map((o) => ({ u0: o.u0 - WIN.casing, u1: o.u1 + WIN.casing, v0: o.v0 - WIN.casing, v1: o.v1 + WIN.casing }));
    for (const P of G.panels) {
      kit.boards.color(P.tint);
      band(kit.boards, f, P.u0, P.u1, Math.max(P.v0, -4), Math.min(P.v1, top), 3, casing, { L, eave: top }, P.shiplap ? 240 / 144 : 0);
      for (const [u, s] of [[P.u0, -1], [P.u1, 1]]) kit.boards.quad(f.at(u, P.v0, s > 0 ? 3 : 0), f.at(u, P.v0, s > 0 ? 0 : 3), f.at(u, Math.min(P.v1, top), s > 0 ? 0 : 3), f.at(u, Math.min(P.v1, top), s > 0 ? 3 : 0));
      if (P.v0 > 0) kit.boards.quad(f.at(P.u0, P.v0, 0), f.at(P.u1, P.v0, 0), f.at(P.u1, P.v0, 3), f.at(P.u0, P.v0, 3));
      if (!P.shiplap) continue;
      // (W8 fix: a black frame round it, its edges and a flashing under it; its courses the
      // boards' set turned across it, band's `turn`, 18 a course.)
      kit.paint.color(TINT.black);
      for (const [a, b, c, d] of [[P.u0 - 7, P.u0, P.v0 - 7, top], [P.u1, P.u1 + 7, P.v0 - 7, top], [P.u0, P.u1, P.v0 - 7, P.v0]]) kit.paint.quad(f.at(a, c, 3.6), f.at(b, c, 3.6), f.at(b, d, 3.6), f.at(a, d, 3.6));
      // (Each course's shadow line under its lap, on the set's joints: v 18 k; not on low.)
      if (kit.tier === 'low') continue;
      kit.paint.color(0x3a100e);
      for (let v = Math.ceil((P.v0 + 6) / 18) * 18; v < top - 4; v += 18) band(kit.paint, f, P.u0, P.u1, v - 3.6, v - 2.4, 3.3, casing);
    }
    for (const o of wins) windowAt(kit, f, { ...o, u: (o.u0 + o.u1) / 2, w: o.u1 - o.u0 }, { bars: kit.tier === 'low' ? 0 : o.bars, mullion: o.bars > 0 });
  }
  const front = F.face('front').f;
  const backF = F.face('back').f;
  const bars = kit.tier === 'low' ? 0 : 2;
  const frame = h.frame ?? TINT.black;
  for (const o of wins.front) windowAt(kit, front, o, { bars, curtains: !o.kind, blinds: o.kind === 'blinds', frosted: o.kind === 'frosted', frame });
  for (const o of wins.back) windowAt(kit, backF, o, { bars, frame });
  if (side) windowAt(kit, front, side, { bars, mullion: false, curtains: false, net: true });
  if (!dad && typeof h.door === 'number') doorAt(kit, front, h.door, h);
  // (A white plastic downpipe down the front from the gutter, a shoe at its foot: W5.)
  for (const u of h.pvc ?? []) {
    kit.metal.color(0xe8e6e0);
    const o = (h.overhang ?? ROOF.overhang) + 10;
    const lo = h.eave - (h.overhang ?? ROOF.overhang) * ((h.ridge - h.eave) / (h.d / 2));
    kit.metal.tube(front.at(u, lo - 12 - y0, o), front.at(u, lo - 70 - y0, 7), 5, 5, 6);
    kit.metal.tube(front.at(u, lo - 70 - y0, 7), front.at(u, 12, 7), 5, 5, 6);
    kit.metal.tube(front.at(u, 12, 7), front.at(u, 4, 17), 5, 5, 6, { caps: true });
  }
  gableRoof(kit, F, h, tiled, seg);
  const D = dormerOf(h);
  if (D) dormer(kit, L, F, h, D, y0, frame);
}

// A shed dormer on the front slope (W8, facades.js DORMERS: the east house's): its face in boards
// with real openings for its windows, its cheeks, its tiled roof rising back into the main roof,
// a white fascia and a gutter along its front.
function dormer(kit, L, F, h, D, y0, frame) {
  const f = wallFrame(F.at(D.u, y0, D.wf), F.dir(0, 0, 1));
  const [hw, v0, v1] = [D.w / 2, D.foot - y0, D.top - y0];
  const holes = D.windows.map((u) => ({ u0: u - D.win / 2, u1: u + D.win / 2, v0: v0 + D.sill, v1: v0 + D.sill + D.high }));
  kit.boards.color(D.boards);
  band(kit.boards, f, -hw, hw, v0 - 8, v1, 0, holes, { L, eave: v1 });
  for (const [u, e] of [[D.u0, -1], [D.u1, 1]]) {
    const t = [F.at(u, D.foot - 8, D.wf), F.at(u, D.top, D.wf), F.at(u, D.yb, D.wb)];
    if (dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), F.dir(e, 0, 0)) >= 0) kit.boards.tri(t[0], t[1], t[2]);
    else kit.boards.tri(t[0], t[2], t[1]);
  }
  for (const o of holes) windowAt(kit, f, o, { bars: 0, mullion: kit.tier !== 'low', frame });
  const o = 30;
  const k = Math.tan((D.pitch * Math.PI) / 180);
  const [e0, e1] = [F.at(D.u0 - o, D.top + 4 - o * k, D.wf + o), F.at(D.u1 + o, D.top + 4 - o * k, D.wf + o)];
  const [r0, r1] = [F.at(D.u0 - o, D.yb + 4, D.wb), F.at(D.u1 + o, D.yb + 4, D.wb)];
  kit.roof.color(h.realRoof ?? h.roof);
  const ex = norm(sub(e1, e0));
  const up = norm(sub(r0, e0));
  const uv = (p) => [dot(sub(p, e0), ex), dot(sub(p, e0), up)];
  kit.roof.quad(e0, e1, r1, r0, { uvs: [e0, e1, r1, r0].map(uv) });
  kit.paint.color(0xeceae4);
  kit.paint.quad(F.at(D.u0 - o, D.top - 22, D.wf + o), F.at(D.u1 + o, D.top - 22, D.wf + o), e1, e0);
  kit.paint.color(TINT.soffit);
  kit.paint.quad(F.at(D.u1 + o, D.top - 22, D.wf + o), F.at(D.u0 - o, D.top - 22, D.wf + o), F.at(D.u0, D.top - 22, D.wf), F.at(D.u1, D.top - 22, D.wf), { shade: 0.6 });
  kit.metal.color(0xe8e6e0);
  kit.metal.tube(F.at(D.u0 - o, D.top - 30, D.wf + o + 10), F.at(D.u1 + o, D.top - 30, D.wf + o + 10), 8, 8, 6, { a0: 0, arc: Math.PI });
}

// A window in the opening o of wall frame f (its glass 10 in, the casing proud).
function windowAt(kit, f, o, { bars = 2, mullion = true, curtains = true, net = false, blinds = false, frosted = false, frame = TINT.black } = {}) {
  const { paint, glass, cloth, core, metal } = kit;
  const { u0, u1, v0, v1 } = o;
  const cs = WIN.casing;
  const R = -WIN.reveal;
  paint.color(frame);
  // The casing: over the top and down the sides, 3 proud.
  fbox(paint, f, u0 - cs, u1 + cs, v1, v1 + cs, 0, 3, 'k');
  fbox(paint, f, u0 - cs, u0, v0, v1, 0, 3, 'kt');
  fbox(paint, f, u1, u1 + cs, v0, v1, 0, 3, 'kt');
  // The reveal: the opening's sides and head, into the wall to the frame.
  paint.color(frame, frame === TINT.black ? 1.4 : 0.85);
  paint.quad(f.at(u0, v0, R), f.at(u0, v0, 0), f.at(u0, v1, 0), f.at(u0, v1, R));
  paint.quad(f.at(u1, v0, 0), f.at(u1, v0, R), f.at(u1, v1, R), f.at(u1, v1, 0));
  paint.quad(f.at(u0, v1, 0), f.at(u1, v1, 0), f.at(u1, v1, R), f.at(u0, v1, R));
  // The frame and the casements (6 wide), their glazing bars.
  paint.color(frame);
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
    // (Five folds a side; two on low: W5, the tier's budget.)
    const folds = kit.tier === 'low' ? 2 : 5;
    for (const [ca, cb] of [[u0 + 4, u0 + 30], [u1 - 30, u1 - 4]]) {
      for (let i = 0; i < folds; i++) {
        const a = ca + ((cb - ca) * i) / folds;
        const b = ca + ((cb - ca) * (i + 1)) / folds;
        const [da, db] = [R - 6 - (i % 2) * 3, R - 6 - ((i + 1) % 2) * 3];
        cloth.color(TINT.curtain, i % 2 ? 0.47 : 0.55);
        cloth.quad(f.at(a, v0 + 2, da), f.at(b, v0 + 2, db), f.at(b, v1 - 2, db), f.at(a, v1 - 2, da));
      }
    }
  }
  // (The kitchen's venetian blinds: pale slats a little behind the glass, half drawn; pebbled
  // glass: a pale even sheet right behind it: W5.)
  if (blinds) {
    cloth.color(0xdcd8cc, 0.8);
    for (let v = v1 - 4; v > v0 + (v1 - v0) * 0.35; v -= 9) cloth.quad(f.at(u0 + 2, v - 6, R - 5), f.at(u1 - 2, v - 6, R - 5), f.at(u1 - 2, v, R - 3), f.at(u0 + 2, v, R - 3));
  }
  if (frosted) {
    cloth.color(0x8a8680, 0.75);
    cloth.quad(f.at(u0, v0, R - 2), f.at(u1, v0, R - 2), f.at(u1, v1, R - 2), f.at(u0, v1, R - 2));
  }
  // (A side light's net curtain: one pale sheet a little behind the glass.)
  if (net) {
    cloth.color(TINT.curtain, 0.5);
    cloth.quad(f.at(u0 + 2, v0 + 2, R - 5), f.at(u1 - 2, v0 + 2, R - 5), f.at(u1 - 2, v1 - 2, R - 5), f.at(u0 + 2, v1 - 2, R - 5));
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

// A front door at u (its opening DOOR wide, or the house's own: h.doorSize): a black frame, the
// leaf set back 6 (a neighbour's of black vertical boards: grooves down it), a handle, a lamp
// beside it (or where the house's hangs: h.lantern).
function doorAt(kit, f, u, h = {}) {
  const { paint, metal } = kit;
  const D = h.doorSize ?? DOOR;
  const [u0, u1] = [u - D.w / 2, u + D.w / 2];
  const cs = 12;
  // (With a side light west of it, +u: one frame round both.)
  const e1 = h.sidelight ? h.sidelight.u + h.sidelight.w / 2 : u1;
  paint.color(TINT.black);
  fbox(paint, f, u0 - cs, e1 + cs, D.h, D.h + cs, 0, 3, 'k');
  fbox(paint, f, u0 - cs, u0, 0, D.h, 0, 3, 'kt');
  // (The jamb between the door and its side light up to the light's own casing.)
  fbox(paint, f, u1, h.sidelight ? h.sidelight.u - h.sidelight.w / 2 - WIN.casing : u1 + cs, 0, D.h, 0, 3, 'kt');
  paint.color(TINT.black, 1.4);
  paint.quad(f.at(u0, 0, -6), f.at(u0, 0, 0), f.at(u0, D.h, 0), f.at(u0, D.h, -6));
  paint.quad(f.at(u1, 0, 0), f.at(u1, 0, -6), f.at(u1, D.h, -6), f.at(u1, D.h, 0));
  paint.quad(f.at(u0, D.h, 0), f.at(u1, D.h, 0), f.at(u1, D.h, -6), f.at(u0, D.h, -6));
  paint.color(TINT.door);
  paint.quad(f.at(u0, 0, -6), f.at(u1, 0, -6), f.at(u1, D.h, -6), f.at(u0, D.h, -6));
  if (h.doorSize && kit.tier !== 'low') {
    paint.color(0x050506);
    for (let k = 1; k < 5; k++) {
      const a = u0 + (D.w * k) / 5;
      paint.quad(f.at(a - 1, 4, -5.6), f.at(a + 1, 4, -5.6), f.at(a + 1, D.h - 4, -5.6), f.at(a - 1, D.h - 4, -5.6));
    }
  }
  metal.color(TINT.handle);
  fbox(metal, f, u1 - 22, u1 - 10, 100, 104, -6, 2, 'k');
  fbox(metal, f, u1 - 14, u1 - 10, 90, 118, -6, -3, 'k');
  if (h.lantern) lamp(kit, f, h.lantern.u, h.lantern.v);
  else lamp(kit, f, u1 + cs + 40, 200);
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
function gableRoof(kit, F, h, tiled, seg) {
  const o = h.overhang ?? ROOF.overhang;
  const ov = h.verges ?? o; // (W8 fix: the verges' own overhang, south_west's deep ones)
  const [A, B] = [h.w / 2, h.d / 2];
  const tan = (h.ridge - h.eave) / B;
  const lo = h.eave - o * tan;
  const y0 = h.y0 ?? 22;
  const T = ROOF.thick;
  // (A wing's slopes run on at its +u end to the valleys with the main roof: the rim to
  // join.rim, the ridge to join.apex; no verge there, no tile courses on it.)
  const J = h.join;
  const [rimEnd, ridgeEnd] = J ? [J.rim, J.apex] : [A + ov, A + ov];
  for (const s of [-1, 1]) {
    const edge = s * (B + o);
    const out = F.dir(0, 0, s);
    const [e0, e1] = [F.at(-A - ov, lo, edge), F.at(rimEnd, lo, edge)];
    const [r0, r1] = [F.at(-A - ov, h.ridge, 0), F.at(ridgeEnd, h.ridge, 0)];
    const up = norm(sub(r0, e0));
    const len = Math.hypot(...sub(r0, e0));
    // (Wound to face out: the side's order flips with s.)
    const slope = s > 0 ? [e0, e1, r1, r0] : [e1, e0, r0, r1];
    if (tiled && seg && !J) {
      kit.tiles.color(h.realRoof ?? h.roof);
      tileCourses(kit.tiles, e0, e1, up, len, seg);
      kit.shadow.quad(...slope.map((p) => sub(p, mul(F.dir(0, 1, s * tan), 3 + TILE.SINK))));
    } else {
      kit.roof.color(h.realRoof ?? h.roof);
      const ex = norm(sub(e1, e0));
      const uv = (p) => [dot(sub(p, e0), ex), dot(sub(p, e0), up)];
      kit.roof.quad(...slope, { uvs: slope.map(uv) });
    }
    // The soffit under the overhang (dark), the fascia along the eave.
    const dn = (p) => [p[0], p[1] - T, p[2]];
    kit.paint.color(h.soffit ?? TINT.soffit);
    kit.paint.quad(...[slope[1], slope[0], slope[3], slope[2]].map(dn), { shade: h.soffit ? 0.85 : 0.6 });
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
    const [ga, gb] = [gc(F.at(-A - ov + 4, 0, edge)), gc(F.at(rimEnd - 4, 0, edge))];
    g.tube(ga, gb, 9, 9, 6, { a0: 0, arc: Math.PI });
    g.tube(ga, gb, 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true });
    // (The downpipes at the eave's ends; h.pipes: only those listed, by side: e.g. none on an
    // eave that runs into a wing, a wing's at its far end.)
    for (const e of h.pipes?.[s > 0 ? 'front' : 'back'] ?? [-1, 1]) {
      const u = e * (A - 25);
      const top = gc(F.at(u, 0, edge));
      const wall = add(F.at(u, lo - 60, s * B), mul(out, 8));
      g.tube([top[0], top[1] - 6, top[2]], wall, 5, 5, 6);
      g.tube(wall, [wall[0], y0 + 14, wall[2]], 5, 5, 6);
      g.tube([wall[0], y0 + 14, wall[2]], add([wall[0], y0 + 4, wall[2]], mul(out, 10)), 5, 5, 6, { caps: true });
    }
  }
  // Barge boards up both gables (a wing's far one), a roll of verge tiles over each, the ridge
  // cap.
  for (const e of J ? [-1] : [-1, 1]) {
    const a = e * (A + ov);
    const vout = F.dir(e, 0, 0);
    for (const s of [-1, 1]) {
      const edge = s * (B + o);
      const [p, q] = [add(F.at(a, lo, edge), mul(vout, 1)), add(F.at(a, h.ridge, 0), mul(vout, 1))];
      kit.paint.color(h.verge ?? TINT.fascia);
      const deep = h.verge ? 40 : 22; // (the neighbours' verge boards broad, in their own tint: W5)
      const board = [[p[0], p[1] - deep, p[2]], [q[0], q[1] - deep, q[2]], [q[0], q[1] + 3, q[2]], [p[0], p[1] + 3, p[2]]];
      kit.paint.quad(...((e > 0) !== (s > 0) ? [board[1], board[0], board[3], board[2]] : board));
      kit.tiles.color(h.realRoof ?? h.roof, 0.85);
      kit.tiles.tube(add(p, [0, -5, 0]), add(q, [0, -5, 0]), 7, 7, 5, { a0: Math.PI, arc: Math.PI, caps: true });
    }
  }
  // (Low on the ridge, its top 2 over the collider's ridge line Jonas stands on: his feet sink
  // no deeper there than on the rolls' crowns.)
  kit.tiles.color(h.realRoof ?? h.roof, 0.9);
  const [ra, rb] = [F.at(-A - ov - 4, h.ridge - 10, 0), F.at(J ? ridgeEnd : A + ov + 4, h.ridge - 10, 0)];
  kit.tiles.tube(ra, rb, 12, 12, 8, { a0: Math.PI, arc: Math.PI, caps: true });
  // The ridge tiles' joints: thin dark rings every RIDGE_TILE (on low none on a wing's ridge,
  // behind the house).
  if (J && kit.tier === 'low') return;
  const run = Math.hypot(...sub(rb, ra));
  const ex = norm(sub(rb, ra));
  kit.paint.color(0x0a0a0a);
  for (let x = RIDGE_TILE; x < run; x += RIDGE_TILE) kit.paint.tube(add(ra, mul(ex, x)), add(ra, mul(ex, x + 2)), 12.4, 12.4, 8, { a0: Math.PI, arc: Math.PI });
}
