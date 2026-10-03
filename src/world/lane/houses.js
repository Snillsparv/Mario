// The houses of Sparrow Lane (lane/layout.js HOUSES, LINK, CARPORT), written into the course's
// kit (lane/build.js): render faces into its material builders, colliders into kit.solids. The
// panes go into kit.glass and the painted parts (frames, doors, garage doors, fascias, soffits,
// barge boards, railings) into kit.paint: render's own builder in the classic look, builders of
// their own in the realistic one, which also hangs a dim room behind every pane (ROOM: the
// window frame's panel would show through the glass).
//
//   frame(h) -> { at(u, y, w), dir(du, dy, dw), face(name) }   // a house's own frame
//   house(kit, h)          // by h.kit: 'villa' | 'chain' | 'garage'
//   link(kit, l), carport(kit, c)   // the flat-roofed link and carport between the chain houses
//   wallLamp(b, f, u, v)   // a little black lamp on a wall frame (beside the front doors)
//
// A house record: { cx, cz, w, d, yaw, y0, eave, ridge | pitch, ... } (layout.js): its footprint
// w along its own u by d along its w, turned by yaw (local u runs (cos yaw, -sin yaw), local w
// (sin yaw, cos yaw): yaw 0 has u along +x and its front, the +w face, looking +z), so a house
// set at an angle to the street (the west end's) is built like any other. Faces: 'front' (+w),
// 'back', 'left' (-u) and 'right' (+u); on each, u runs to the right seen from outside
// (castle/geom.js wallFrame).
//
// villa: the split-level houses up the hill: white render up to `render` (the lower floor, the
// garage door at drive level), red-brown brick on up to the eaves (none where render reaches the
// eaves), white-framed windows (plain, arched, bay windows standing out of the wall), an arched
// white front door; a hipped roof of pan tiles with wide eaves (overhang) and a dark soffit;
// roof windows (dark quads on the front slope). chain: the long low houses along the dad's side:
// a white brick plinth, vertical boards up to the eaves (or white brick gable ends with boards in
// their triangles), black window frames round dark panes (a pale glint over them, white curtains
// either side), a front door with a wall lamp beside it (or, for the dad's house, the opening
// door.js fills); a low gable roof along u. garage: white render walls under a gable roof along
// w, its front a gable of white boards with two dark panel doors and a white brick pier between
// them.
//
// The realistic look draws the chain houses with ids, the villas' windows and the garage doors
// itself (world/lane/real/house.js, villas.js): those draw into kit.drawn('chain' |
// 'villaWindows' | 'garageDoors') there, a kit drawing nothing; the colliders are made the same.
//
// Colliders: each house one convex solid, its walls and its roof (to the eaves, then the hip or
// gable up to the ridge); the drawn overhangs have none. The link a solid block to its flat roof
// (stone), the carport its roof slab, its posts and its back wall (wood; the roofs' tops are
// walkable).

import { archContour, localBoxPolys, wallFrame } from '../castle/geom.js';

const TINT = {
  render: 0xf0ece4,
  whiteBrick: 0xece8de,
  frame: 0x1e1e1e, // the chain houses' window frames
  white: 0xf6f4ee, // the villas' window frames, doors, fascias
  pane: 0x2c3a46,
  glint: 0x6c7c8a,
  curtain: 0xd8d2c6,
  door: 0x222222,
  garage: 0x3a3e42,
  garageLight: 0x5a6a72,
  soffit: 0x3a3634,
  fascia: 0x2a2624,
  felt: 0x3a3a3a, // the flat roofs
  railing: 0x2a2a2a,
  room: 0x4a4640, // (the realistic look's dim room behind a pane)
};
const WIN = { villa: { w: 220, sill: 520, h: 200, frame: 12 }, chain: { w: 150, sill: 170, h: 130, frame: 10 } };
const BAY = { w: 420, out: 50, below: 30, above: 30 };
const DOOR = { w: 110, h: 220, frame: 10 };
const GARAGE = { w: 520, h: 250 };
const ROOF_THICK = 18;
const PLINTH_SHADE = (y0) => (x, y) => 0.84 + 0.16 * Math.min(1, (y - y0) / 260);

// ---------------------------------------------------------------- the frame

export function frame(h) {
  const c = Math.cos(h.yaw ?? 0);
  const s = Math.sin(h.yaw ?? 0);
  const at = (u, y, w) => [h.cx + u * c + w * s, y, h.cz - u * s + w * c];
  const dir = (du, dy, dw) => [du * c + dw * s, dy, -du * s + dw * c];
  const y0 = h.y0 ?? 0;
  // A face's wall frame (origin at its middle on the floor) and its half width.
  const face = (name) => {
    if (name === 'front') return { frame: wallFrame(at(0, y0, h.d / 2), dir(0, 0, 1)), half: h.w / 2 };
    if (name === 'back') return { frame: wallFrame(at(0, y0, -h.d / 2), dir(0, 0, -1)), half: h.w / 2 };
    if (name === 'right') return { frame: wallFrame(at(h.w / 2, y0, 0), dir(1, 0, 0)), half: h.d / 2 };
    return { frame: wallFrame(at(-h.w / 2, y0, 0), dir(-1, 0, 0)), half: h.d / 2 };
  };
  return { at, dir, face };
}

const FACES = ['front', 'back', 'left', 'right'];
const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// A band of wall (u0..u1 across, v0..v1 up) on a face, with rectangular holes ({ u0, u1, v0, v1 })
// cut out of it: strips either side of each hole, and under and over it.
function band(b, frame, u0, u1, v0, v1, holes = [], opts = {}) {
  const cuts = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.v1 > v0 && o.v0 < v1).sort((p, q) => p.u0 - q.u0);
  let u = u0;
  for (const o of cuts) {
    if (o.u0 > u) b.panel(frame, rect(u, v0, o.u0, v1), 0, opts);
    if (o.v0 > v0) b.panel(frame, rect(o.u0, v0, o.u1, o.v0), 0, opts);
    if (o.v1 < v1) b.panel(frame, rect(o.u0, o.v1, o.u1, v1), 0, opts);
    u = o.u1;
  }
  if (u < u1) b.panel(frame, rect(u, v0, u1, v1), 0, opts);
}

// ---------------------------------------------------------------- houses

export function house(kit, h) {
  if (h.kit === 'villa') villa(kit, h);
  else if (h.kit === 'garage') garage(kit, h);
  else chain(kit, h);
}

function villa(kit, h) {
  const { render, brick, roof, paint } = kit;
  const F = frame(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const renderTop = h.render - y0;
  const tan = Math.tan((h.pitch * Math.PI) / 180);
  const ridge = h.eave + (Math.min(h.w, h.d) / 2) * tan;
  for (const name of FACES) {
    const { frame: f, half } = F.face(name);
    render.color(TINT.render);
    render.shade = PLINTH_SHADE(y0);
    render.panel(f, rect(-half, 0, half, renderTop), 0);
    render.shade = null;
    if (renderTop < wallH) {
      brick.color(h.brick ?? 0xb05a3c);
      brick.panel(f, rect(-half, renderTop, half, wallH), 0, { shade: [0.95, 0.95, 0.82, 0.82] });
      // A white band between the floors.
      paint.color(TINT.white);
      paint.panel(f, rect(-half, renderTop - 6, half, renderTop + 6), 1);
    }
  }
  const front = F.face('front').frame;
  // The garage door(s) at drive level: grey panels with darker joints.
  for (const u of h.garages ?? (h.garage !== undefined ? [h.garage] : [])) garageDoor(kit.drawn('garageDoors').paint, front, u, GARAGE);
  // The front door (at the floor of the garden it opens onto).
  if (h.door !== undefined) {
    const at = F.at(h.door, 0, h.d / 2 + 10);
    const v = Math.max(0, (kit.groundAt?.(at[0], at[2]) ?? y0) - y0);
    paint.color(TINT.white);
    paint.panel(front, archContour(DOOR.w / 2 + DOOR.frame, DOOR.h - DOOR.w / 2, 8).map(([u, w]) => [h.door + u, v + w]), 1);
    paint.color(h.doorTint ?? 0xe8e4dc);
    paint.panel(front, archContour(DOOR.w / 2, DOOR.h - DOOR.w / 2, 8).map(([u, w]) => [h.door + u, v + w]), 2);
  }
  // Upper-floor windows: plain, arched, bays.
  const W = WIN.villa;
  const glazed = kit.drawn('villaWindows'); // (the realistic look's own: world/lane/real/villas.js)
  if (renderTop < wallH) {
    for (const u of h.windows ?? []) villaWindow(glazed, front, u, W, false);
    for (const u of h.arches ?? []) villaWindow(glazed, front, u, W, true);
    for (const u of h.bays ?? []) bayWindow(kit, front, u, W);
    // A window or two on the back and the sides.
    for (const name of ['back', 'left', 'right']) villaWindow(glazed, F.face(name).frame, 0, W, false);
  } else {
    // Rendered to the eaves (the west end's): a row of windows over the garage doors.
    for (const u of [-550, 0, 550]) villaWindow(glazed, front, u, { ...W, sill: wallH - 230 }, false);
    for (const name of ['left', 'right']) villaWindow(glazed, F.face(name).frame, 0, { ...W, sill: wallH - 230 }, false);
  }
  if (h.balcony) {
    // A dark railing box on the left (west) gable at the upper floor, solid (its floor more than
    // 300 over the side yard: no low ceiling for the camera).
    const { frame: f } = F.face('left');
    const v0 = renderTop + 140;
    paint.color(TINT.railing);
    paint.solid(localBoxPolys(f, -300, 300, v0, v0 + 100, 0, 150, { bottom: true }), { faceShade: (n) => (n[1] < -0.5 ? 0.5 : 1) });
    kit.solids.solid(localBoxPolys(f, -300, 300, v0, v0 + 100, -10, 150, { bottom: true }), 'stone');
  }
  hipRoof(kit, F, h, ridge, tan);
  for (const u of h.roofWindows ?? []) {
    // A dark roof window on the front slope, half way up.
    const k = 0.45;
    const wTop = h.d / 2 - (h.d / 2) * k;
    const yAt = (w) => h.eave + (h.d / 2 - w) * tan + 3;
    roof.color(0x30363c);
    roof.poly([F.at(u - 70, yAt(wTop + 60), wTop + 60), F.at(u + 70, yAt(wTop + 60), wTop + 60), F.at(u + 70, yAt(wTop - 60), wTop - 60), F.at(u - 70, yAt(wTop - 60), wTop - 60)], { facing: F.dir(0, 1, tan) });
  }
  // The collider: walls and hipped roof.
  kit.solids.solid(hipPolys(F, h.w / 2, h.d / 2, y0, h.eave, ridge), 'stone');
}

function chain(kit, h) {
  // (The realistic look draws the course's own chain houses itself: world/lane/real/house.js.)
  const drawn = h.id ? kit.drawn('chain') : kit;
  const { brick, boards, paint } = drawn;
  const F = frame(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const plinth = h.plinth ?? 135;
  const hw = h.w / 2;
  const hd = h.d / 2;
  const door = typeof h.door === 'object' ? h.door : null; // the dad's: an opening door.js fills
  const holes = door ? [{ u0: door.u - door.w / 2, u1: door.u + door.w / 2, v0: 0, v1: door.h }] : [];
  for (const name of FACES) {
    const { frame: f, half } = F.face(name);
    const cut = name === 'front' ? holes : [];
    const gable = name === 'left' || name === 'right';
    brick.color(TINT.whiteBrick);
    brick.shade = PLINTH_SHADE(y0);
    band(brick, f, -half, half, 0, gable && h.gableEnds ? wallH : plinth, cut);
    brick.shade = null;
    if (!(gable && h.gableEnds)) {
      boards.color(h.boards);
      band(boards, f, -half, half, plinth, wallH, cut, { shade: [1, 1, 0.84, 0.84] });
    }
    if (gable) {
      // The gable's triangle in boards.
      boards.color(h.gableBoards ?? h.boards);
      boards.panel(f, [[-half, wallH], [half, wallH], [0, h.ridge - y0]], 0, { shade: [0.84, 0.84, 0.95] });
    }
  }
  // Windows and the door on the front; a row on the back.
  const front = F.face('front').frame;
  for (const u of h.windows ?? []) chainWindow(drawn, front, u);
  for (const u of h.windows ?? []) chainWindow(drawn, F.face('back').frame, -u);
  if (typeof h.door === 'number') {
    paint.color(TINT.frame);
    paint.panel(front, rect(h.door - 70, 0, h.door + 70, 225), 1);
    paint.color(TINT.door);
    paint.panel(front, rect(h.door - 58, 0, h.door + 58, 215), 2);
    wallLamp(paint, front, h.door + 110, 200);
  }
  if (h.veranda) veranda(kit, F, h);
  gableRoof(drawn, F, h, 'u');
  kit.solids.solid(gablePolys(F, hw, hd, y0, h.eave, h.ridge, 'u'), 'stone');
}

function garage(kit, h) {
  const { render, boards, brick, paint } = kit;
  const F = frame(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  for (const name of FACES) {
    const { frame: f, half } = F.face(name);
    render.color(TINT.render);
    render.shade = PLINTH_SHADE(y0);
    render.panel(f, rect(-half, 0, half, wallH), 0);
    render.shade = null;
    if (name === 'front' || name === 'back') {
      boards.color(0xf2f0ea);
      boards.panel(f, [[-half, wallH], [half, wallH], [0, h.ridge - y0]], 0, { shade: [0.86, 0.86, 1] });
    }
  }
  const front = F.face('front').frame;
  for (const u of h.doors) garageDoor(kit.drawn('garageDoors').paint, front, u, { w: 440, h: 240 }, TINT.garage);
  brick.color(TINT.whiteBrick);
  brick.panel(front, rect(-40, 0, 40, 260), 1);
  gableRoof(kit, F, h, 'w');
  kit.solids.solid(gablePolys(F, h.w / 2, h.d / 2, y0, h.eave, h.ridge, 'w'), 'stone');
}

// ---------------------------------------------------------------- the flat-roofed link and carport

// The link between south_1 and the dad's: a block to its flat roof, its front in yellow boards
// with a dark garage door, a dark fascia round the roof's edge.
export function link(kit, L) {
  const { boards, paint, solids } = kit;
  const y0 = 22;
  boards.color(L.boards);
  boards.shade = PLINTH_SHADE(y0);
  boards.box(L.x0, L.x1, y0, L.top - L.slab, L.z0, L.z1, { bottom: false, top: false });
  boards.shade = null;
  paint.color(TINT.garage);
  const mid = (L.x0 + L.x1) / 2;
  paint.poly([[mid - 180, y0, L.z0 - 1], [mid + 180, y0, L.z0 - 1], [mid + 180, y0 + 240, L.z0 - 1], [mid - 180, y0 + 240, L.z0 - 1]], { facing: [0, 0, -1] });
  flatRoof(kit, L.x0, L.x1, L.z0, L.z1, L.top, L.slab);
  solids.box(L.x0, L.x1, y0, L.top, L.z0, L.z1, 'stone');
}

// The carport between the dad's and south_2: its roof slab on three posts along its open front
// (toward the drive), against the two houses' gables, a back wall of yellow boards with a red
// board door; the drive's asphalt runs on under it.
export function carport(kit, C) {
  const { boards, paint, solids } = kit;
  const y0 = 22;
  const under = C.top - C.slab;
  paint.color(TINT.fascia);
  for (const x of C.posts) paint.box(x - C.post / 2, x + C.post / 2, y0, under, C.z0, C.z0 + C.post, { bottom: false, top: false });
  boards.color(C.back);
  boards.shade = (x, y) => 0.62 + 0.2 * Math.min(1, (y - y0) / 300);
  boards.box(C.x0, C.x1, y0, under, C.z1 - 20, C.z1, { bottom: false, top: false });
  boards.shade = null;
  boards.color(C.door);
  const dx = (C.x0 + C.x1) / 2 + 200;
  boards.poly([[dx - 70, y0, C.z1 - 21], [dx + 70, y0, C.z1 - 21], [dx + 70, y0 + 215, C.z1 - 21], [dx - 70, y0 + 215, C.z1 - 21]], { facing: [0, 0, -1], shade: 0.7 });
  flatRoof(kit, C.x0, C.x1, C.z0, C.z1, C.top, C.slab);
  solids.box(C.x0, C.x1, under, C.top, C.z0, C.z1, 'wood', { bottom: true });
  for (const x of C.posts) solids.box(x - C.post / 2, x + C.post / 2, y0, under, C.z0, C.z0 + C.post, 'wood');
  solids.box(C.x0, C.x1, y0, under, C.z1 - 20, C.z1, 'wood');
}

// A flat roof slab from y top - slab to top: felt on top, a dark fascia round its edge, its
// underside in shade.
function flatRoof(kit, x0, x1, z0, z1, top, slab) {
  const { roof, paint } = kit;
  roof.color(TINT.felt);
  roof.poly([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], { facing: [0, 1, 0] });
  paint.color(TINT.fascia);
  paint.box(x0 - 4, x1 + 4, top - slab, top + 4, z0 - 4, z1 + 4, { bottom: false, top: false });
  paint.color(TINT.soffit);
  paint.poly([[x0, top - slab, z0], [x1, top - slab, z0], [x1, top - slab, z1], [x0, top - slab, z1]], { facing: [0, -1, 0], shade: 0.6 });
}

// ---------------------------------------------------------------- roofs

// A hipped roof (pan tiles) with `overhang` past the walls: its eaves' edge, the slopes up to the
// ridge (along the longer side; a point over a square), a dark soffit under the overhang and a
// fascia along the eaves.
function hipRoof(kit, F, h, ridge, tan) {
  const { roof, paint } = kit;
  const o = h.overhang ?? 60;
  const a = h.w / 2;
  const b = h.d / 2;
  const lo = h.eave - o * tan;
  const along = a >= b;
  const r = along ? a - b : b - a;
  const R0 = along ? F.at(-r, ridge, 0) : F.at(0, ridge, -r);
  const R1 = along ? F.at(r, ridge, 0) : F.at(0, ridge, r);
  const rim = [F.at(-a - o, lo, b + o), F.at(a + o, lo, b + o), F.at(a + o, lo, -b - o), F.at(-a - o, lo, -b - o)];
  roof.color(h.roof);
  const up = (du, dw) => F.dir(du * tan, 1, dw * tan);
  const shade = [0.92, 0.92, 1.04, 1.04];
  // Front (+w), right (+u), back, left: a trapezoid or a triangle each.
  const faces = along
    ? [[rim[0], rim[1], R1, R0, up(0, 1)], [rim[1], rim[2], R1, null, up(1, 0)], [rim[2], rim[3], R0, R1, up(0, -1)], [rim[3], rim[0], R0, null, up(-1, 0)]]
    : [[rim[0], rim[1], R1, null, up(0, 1)], [rim[1], rim[2], R0, R1, up(1, 0)], [rim[2], rim[3], R0, null, up(0, -1)], [rim[3], rim[0], R1, R0, up(-1, 0)]];
  for (const [p, q, s, t, n] of faces) roof.poly(t ? [p, q, s, t] : [p, q, s], { facing: n, shade: t ? shade : shade.slice(0, 3) });
  // The soffit under the overhang (dark) and the fascia along the eaves.
  const wall = [F.at(-a, h.eave, b), F.at(a, h.eave, b), F.at(a, h.eave, -b), F.at(-a, h.eave, -b)];
  const drop = (p, d) => [p[0], p[1] - d, p[2]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    paint.color(TINT.soffit);
    paint.poly([drop(rim[i], ROOF_THICK), drop(rim[j], ROOF_THICK), drop(wall[j], ROOF_THICK), drop(wall[i], ROOF_THICK)], { facing: [0, -1, 0], shade: 0.7 });
    paint.color(TINT.fascia);
    const out = [rim[i][0] + rim[j][0] - 2 * h.cx, 0, rim[i][2] + rim[j][2] - 2 * h.cz];
    paint.poly([drop(rim[i], ROOF_THICK), drop(rim[j], ROOF_THICK), rim[j], rim[i]], { facing: out });
  }
}

// A gable roof along u (the chain houses) or w (the garage): the two slopes past the walls by
// the overhang at the eaves and the verges, their undersides dark, a fascia along the eaves and
// barge boards up the verges.
function gableRoof(kit, F, h, axis) {
  const { roof, paint } = kit;
  const o = h.overhang ?? 60;
  // (a: along the ridge, b: across it) -> local (u, w).
  const P = axis === 'u' ? (a, y, b) => F.at(a, y, b) : (a, y, b) => F.at(b, y, a);
  const [A, B] = axis === 'u' ? [h.w / 2, h.d / 2] : [h.d / 2, h.w / 2];
  const tan = (h.ridge - h.eave) / B;
  const lo = h.eave - o * tan;
  for (const s of [-1, 1]) {
    const edge = s * (B + o);
    const n = axis === 'u' ? F.dir(0, 1, s * tan) : F.dir(s * tan, 1, 0);
    roof.color(h.roof);
    roof.poly([P(-A - o, lo, edge), P(A + o, lo, edge), P(A + o, h.ridge, 0), P(-A - o, h.ridge, 0)], { facing: n, shade: [0.92, 0.92, 1.04, 1.04] });
    paint.color(TINT.soffit);
    const d = ROOF_THICK;
    paint.poly([P(-A - o, lo - d, edge), P(A + o, lo - d, edge), P(A + o, h.ridge - d, 0), P(-A - o, h.ridge - d, 0)], { facing: [-n[0], -n[1], -n[2]], shade: 0.55 });
    paint.color(TINT.fascia);
    const out = axis === 'u' ? F.dir(0, 0, s) : F.dir(s, 0, 0);
    paint.poly([P(-A - o, lo - d, edge), P(A + o, lo - d, edge), P(A + o, lo, edge), P(-A - o, lo, edge)], { facing: out });
    // Barge boards up both verges.
    for (const e of [-1, 1]) {
      const a = e * (A + o);
      const vout = axis === 'u' ? F.dir(e, 0, 0) : F.dir(0, 0, e);
      paint.poly([P(a, lo - d - 4, edge), P(a, h.ridge - d - 4, 0), P(a, h.ridge + 3, 0), P(a, lo + 3, edge)], { facing: vout });
    }
  }
}

// Collider polys (one convex solid): a box from y0 to the eaves under a hipped roof (its ridge
// along the longer side).
function hipPolys(F, a, b, y0, eave, ridge) {
  const top = [F.at(-a, eave, b), F.at(a, eave, b), F.at(a, eave, -b), F.at(-a, eave, -b)];
  const bot = top.map(([x, , z]) => [x, y0, z]);
  const polys = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    polys.push([bot[i], bot[j], top[j], top[i]]);
  }
  const r = Math.abs(a - b);
  const [R0, R1] = a >= b ? [F.at(-r, ridge, 0), F.at(r, ridge, 0)] : [F.at(0, ridge, -r), F.at(0, ridge, r)];
  if (a >= b) polys.push([top[0], top[1], R1, R0], [top[2], top[3], R0, R1], [top[1], top[2], R1], [top[3], top[0], R0]);
  else polys.push([top[0], top[1], R1], [top[1], top[2], R0, R1], [top[2], top[3], R0], [top[3], top[0], R1, R0]);
  return polys; // (over a square the ridge is a point: SolidBuilder skips the empty faces)
}

// ...and under a gable roof along `axis`.
function gablePolys(F, a, b, y0, eave, ridge, axis) {
  const top = [F.at(-a, eave, b), F.at(a, eave, b), F.at(a, eave, -b), F.at(-a, eave, -b)];
  const bot = top.map(([x, , z]) => [x, y0, z]);
  const polys = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    polys.push([bot[i], bot[j], top[j], top[i]]);
  }
  if (axis === 'u') {
    const R0 = F.at(-a, ridge, 0);
    const R1 = F.at(a, ridge, 0);
    polys.push([top[0], top[1], R1, R0], [top[2], top[3], R0, R1], [top[1], top[2], R1], [top[3], top[0], R0]);
  } else {
    const R0 = F.at(0, ridge, -b);
    const R1 = F.at(0, ridge, b);
    polys.push([top[1], top[2], R0, R1], [top[3], top[0], R1, R0], [top[0], top[1], R1], [top[2], top[3], R0]);
  }
  return polys;
}

// ---------------------------------------------------------------- doors and windows

// A little black wall lamp on a wall frame at (u, v): a box with a pale glass front.
export function wallLamp(b, f, u, v) {
  b.color(TINT.door);
  b.solid(localBoxPolys(f, u - 10, u + 10, v, v + 30, 0, 16), { faceShade: (n) => (n[1] < -0.5 ? 0.5 : 1) });
  b.color(0xe8dcb0);
  b.panel(f, rect(u - 6, v + 6, u + 6, v + 24), 17);
}

// A garage door: a grey panel with three darker joints across it.
function garageDoor(b, f, u, { w, h }, tint = TINT.garageLight) {
  b.color(TINT.white);
  b.panel(f, rect(u - w / 2 - 14, 0, u + w / 2 + 14, h + 14), 1);
  b.color(tint);
  b.panel(f, rect(u - w / 2, 0, u + w / 2, h), 2, { shade: [0.85, 0.85, 1, 1] });
  b.color(tint, 0.7);
  for (let i = 1; i < 4; i++) b.panel(f, rect(u - w / 2, (h * i) / 4 - 3, u + w / 2, (h * i) / 4 + 3), 3);
}

// A villa's window: a white frame round a dark pane (a pale glint in its upper half), plain or
// arched.
function villaWindow(kit, f, u, W, arched) {
  const { paint, glass } = kit;
  const shape = (hw, v0, h) => (arched ? archContour(hw, h - hw, 6).map(([x, y]) => [u + x, v0 + y]) : rect(u - hw, v0, u + hw, v0 + h));
  paint.color(TINT.white);
  paint.panel(f, shape(W.w / 2 + W.frame, W.sill - W.frame, W.h + 2 * W.frame), 1);
  room(kit, f, shape(W.w / 2, W.sill, W.h), 1.5);
  glass.color(TINT.pane);
  glass.panel(f, shape(W.w / 2, W.sill, W.h), 2, { shade: arched ? 1 : [1, 1, 1.5, 1.5] });
  paint.color(TINT.white);
  paint.panel(f, rect(u - 5, W.sill, u + 5, W.sill + W.h - (arched ? W.w / 2 : 0)), 3);
}

// The realistic look's dim room behind a pane (`contour` on frame f at offset w); none in the
// classic look.
function room(kit, f, contour, w) {
  if (kit.look !== 'real') return;
  kit.paint.color(TINT.room);
  kit.paint.panel(f, contour, w);
}

// A bay window: a white box standing BAY.out out of the wall (drawn only: within the camera's
// margin), panes on its front, a little pan-tile roof over it.
function bayWindow(kit, f, u, W) {
  const { paint, glass, roof } = kit;
  const v0 = W.sill - BAY.below;
  const v1 = W.sill + W.h + BAY.above;
  const hw = BAY.w / 2;
  paint.color(TINT.white);
  paint.solid(localBoxPolys(f, u - hw, u + hw, v0, v1, 0, BAY.out, { bottom: true }), { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
  room(kit, f, rect(u - hw + 16, W.sill, u + hw - 16, W.sill + W.h), BAY.out + 0.5);
  glass.color(TINT.pane);
  glass.panel(f, rect(u - hw + 16, W.sill, u + hw - 16, W.sill + W.h), BAY.out + 1, { shade: [1, 1, 1.5, 1.5] });
  paint.color(TINT.white);
  for (const k of [-1, 0, 1]) paint.panel(f, rect(u + k * (hw / 2.2) - 5, W.sill, u + k * (hw / 2.2) + 5, W.sill + W.h), BAY.out + 2);
  roof.color(0x3a3a3a);
  roof.poly([f.at(u - hw - 10, v1, BAY.out + 14), f.at(u + hw + 10, v1, BAY.out + 14), f.at(u + hw + 10, v1 + 40, 0), f.at(u - hw - 10, v1 + 40, 0)], { facing: f.dir(0, 1, 0.5) });
}

// A chain house's window: a black frame round a dark pane with a pale glint over its upper half
// and white curtains drawn to either side.
function chainWindow(kit, f, u) {
  const { paint, glass } = kit;
  const W = WIN.chain;
  const hw = W.w / 2;
  paint.color(TINT.frame);
  paint.panel(f, rect(u - hw - W.frame, W.sill - W.frame, u + hw + W.frame, W.sill + W.h + W.frame), 1);
  room(kit, f, rect(u - hw, W.sill, u + hw, W.sill + W.h), 1.5);
  glass.color(TINT.pane);
  glass.panel(f, rect(u - hw, W.sill, u + hw, W.sill + W.h / 2), 2);
  glass.color(TINT.glint);
  glass.panel(f, rect(u - hw, W.sill + W.h / 2, u + hw, W.sill + W.h), 2, { shade: [0.8, 0.8, 1.1, 1.1] });
  paint.color(TINT.curtain);
  paint.panel(f, rect(u - hw, W.sill, u - hw + 22, W.sill + W.h), 3);
  paint.panel(f, rect(u + hw - 22, W.sill, u + hw, W.sill + W.h), 3);
  paint.color(TINT.frame);
  paint.panel(f, rect(u - 4, W.sill, u + 4, W.sill + W.h), 3);
}

// The glazed veranda on the corner house's gable (its right face, +u): a box of panes in white
// frames under a flat roof, solid.
function veranda(kit, F, h) {
  const { paint, glass, roof, solids } = kit;
  const V = h.veranda;
  const y0 = h.y0 ?? 22;
  const u0 = h.w / 2;
  const u1 = u0 + V.depth;
  const b = h.d / 2;
  const corners = [F.at(u0, 0, b), F.at(u1, 0, b), F.at(u1, 0, -b), F.at(u0, 0, -b)];
  const at = (p, y) => [p[0], y, p[2]];
  for (let i = 0; i < 3; i++) {
    const p = corners[i];
    const q = corners[i + 1];
    const out = [p[0] + q[0] - 2 * F.at(u0 + V.depth / 2, 0, 0)[0], 0, p[2] + q[2] - 2 * F.at(u0 + V.depth / 2, 0, 0)[2]];
    paint.color(TINT.white);
    paint.poly([at(p, y0), at(q, y0), at(q, y0 + 90), at(p, y0 + 90)], { facing: out });
    glass.color(TINT.glint);
    glass.poly([at(p, y0 + 90), at(q, y0 + 90), at(q, V.top - 20), at(p, V.top - 20)], { facing: out, shade: [0.8, 0.8, 1.1, 1.1] });
    paint.color(TINT.white);
    paint.poly([at(p, V.top - 20), at(q, V.top - 20), at(q, V.top), at(p, V.top)], { facing: out });
  }
  roof.color(TINT.felt);
  roof.poly(corners.map((p) => at(p, V.top + 2)), { facing: [0, 1, 0] });
  const top = corners.map((p) => at(p, V.top));
  const bot = corners.map((p) => at(p, y0));
  solids.solid([top, ...bot.map((p, i) => [p, bot[(i + 1) % 4], top[(i + 1) % 4], top[i]])], 'stone');
}
