// The houses of Sparrow Lane (lane/layout.js HOUSES, LINK, CARPORT), written into the course's
// kit (lane/build.js): render faces into its material builders, colliders into kit.solids. The
// panes go into kit.glass and the painted parts (frames, doors, garage doors, fascias, soffits,
// barge boards, railings) into kit.paint: render's own builder in the classic look, builders of
// their own in the realistic one, which also hangs a dim room behind every pane (ROOM: the
// window frame's panel would show through the glass).
//
//   frame(h) -> { at(u, y, w), dir(du, dy, dw), face(name) }   // a house's own frame
//   house(kit, h)          // by h.kit: 'villa' | 'chain' | 'garage'
//   link(kit, l), carport(kit, c, g)   // the flat-roofed link, and the carport between the chain
//                                      // houses with the store room under it (layout.GARAGE)
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
// The realistic look draws the chain houses with ids, the villas' walls (with their windows,
// doors, bays and balconies) and the garage doors itself (world/lane/real/house.js, villas.js):
// those draw into kit.drawn('chain' | 'villas' | 'villaWindows' | 'garageDoors') there, a kit
// drawing nothing; the colliders are made the same.
//
// Colliders: each house one convex solid, its walls and its roof (to the eaves, then the hip or
// gable up to the ridge); the drawn overhangs have none. The link a solid block to its flat roof
// (stone), the garage row its roof slab, its fascia, its store room's door wall (each leaf
// named), lining filler, back wall and props (wood; the roofs' tops are walkable).

import { archContour, beamPolys, localBoxPolys, wallFrame } from '../castle/geom.js';
import { brickSpans, chainFaces, chainWindows } from './real/plan.js';
import { DORMERS, FACADES, FRAME, GABLES, ROOF, WEST_FRONTS, dormerOf, hipOf, hipSolid, outlineOf } from './facades.js';

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
function band(b, frame, u0, u1, v0, v1, holes = [], opts = {}, w = 0) {
  const cuts = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.v1 > v0 && o.v0 < v1).sort((p, q) => p.u0 - q.u0);
  let u = u0;
  for (const o of cuts) {
    if (o.u0 > u) b.panel(frame, rect(u, v0, o.u0, v1), w, opts);
    if (o.v0 > v0) b.panel(frame, rect(o.u0, v0, o.u1, o.v0), w, opts);
    if (o.v1 < v1) b.panel(frame, rect(o.u0, o.v1, o.u1, v1), w, opts);
    u = o.u1;
  }
  if (u < u1) b.panel(frame, rect(u, v0, u1, v1), w, opts);
}

// ---------------------------------------------------------------- houses

export function house(kit, h) {
  if (h.kit === 'villa') villa(kit, h);
  else if (h.kit === 'garage') garage(kit, h);
  else chain(kit, h);
}

function villa(kit, h) {
  const { roof } = kit;
  // (The realistic look draws the walls, the door, the bays and the balcony itself, with real
  // openings: world/lane/real/villas.js; the roof and the colliders stay these.)
  const walls = kit.drawn('villas');
  const { render, brick, paint } = walls;
  const F = frame(h);
  const y0 = h.y0 ?? 22;
  const P = FACADES[h.id];
  const wallH = h.eave - y0;
  const renderTop = (P?.render ?? h.render) - y0;
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
  const W = WIN.villa;
  const glazed = kit.drawn('villaWindows'); // (the realistic look's own: world/lane/real/villas.js)
  if (P) facade(kit, walls, glazed, h, F, P, wallH);
  else if (WEST_FRONTS[h.id]) westFront(kit, h, F, WEST_FRONTS[h.id], wallH);
  else {
    // (The west end's, rendered to its eaves: a row of windows on its front.)
    for (const u of [-550, 0, 550]) villaWindow(glazed, front, u, { ...W, sill: wallH - 230 }, false);
    for (const name of ['left', 'right']) villaWindow(glazed, F.face(name).frame, 0, { ...W, sill: wallH - 230 }, false);
  }
  if (h.balcony !== undefined) {
    // A dark railing box on the left (west) gable at the upper floor, its middle `balcony` along
    // the face (toward the front), solid (its floor more than 300 over the side yard: no low
    // ceiling for the camera).
    const { frame: f } = F.face('left');
    const v0 = renderTop + 140;
    const u = h.balcony;
    paint.color(0x3a2a20); // (W6: dark-stained wood, photo 17)
    paint.solid(localBoxPolys(f, u - 300, u + 300, v0, v0 + 100, 0, 150, { bottom: true }), { faceShade: (n) => (n[1] < -0.5 ? 0.5 : 1) });
    kit.solids.solid(localBoxPolys(f, u - 300, u + 300, v0, v0 + 100, -10, 150, { bottom: true }), 'stone');
  }
  hipRoof(kit, F, h);
  for (const u of h.roofWindows ?? []) {
    // A dark roof window on the front slope, half way up.
    const k = 0.45;
    const wTop = h.d / 2 - (h.d / 2) * k;
    const yAt = (w) => h.eave + (h.d / 2 - w) * tan + 3;
    roof.color(0x30363c);
    roof.poly([F.at(u - 70, yAt(wTop + 60), wTop + 60), F.at(u + 70, yAt(wTop + 60), wTop + 60), F.at(u + 70, yAt(wTop - 60), wTop - 60), F.at(u - 70, yAt(wTop - 60), wTop - 60)], { facing: F.dir(0, 1, tan) });
  }
  // The collider: walls and hipped roof (W6: a programmed block's under its drawn slopes).
  kit.solids.solid(P ? hipSolid(h, F.at, y0) : hipPolys(F, h.w / 2, h.d / 2, y0, h.eave, ridge), 'stone');
}

// The west end's villa's front (W8, facades.js WEST_FRONTS, photos 04-07), both looks (the
// realistic look's worker draws its plain walls and its doors): the white blockwork's ribs (a
// shaded line under each course, on every face), the split-face panels at its south-west corner,
// the white ribbed sectional doors (the classic look's), the covered entrance on the west face
// (two white posts at the soffit's edge, solid; a glazed door in a white frame).
function westFront(kit, h, F, P, wallH) {
  const { render, blocks, paint, glass, solids } = kit;
  render.color(0xd2cec6);
  const soffit = hipOf(h).Y - ROOF_THICK - (h.y0 ?? 22);
  for (const name of FACES) {
    const { frame: f, half } = F.face(name);
    for (let v = P.ribs - 2; v < soffit; v += P.ribs) render.panel(f, rect(-half, v, half, v + 2.5), 0.6);
  }
  const front = F.face('front').frame;
  blocks.color(0xf2f0ea, kit.look === 'real' ? 1.75 : 1.15); // (white split-face: the blocks' grey set brightened)
  for (const [u0, u1] of P.rough) blocks.panel(front, rect(u0, 0, u1, wallH - 2), 1);
  const doors = kit.drawn('garageDoors').paint;
  for (const d of P.doors) {
    doors.color(TINT.white);
    doors.panel(front, rect(d.u - d.w / 2 - 10, 0, d.u + d.w / 2 + 10, d.h + 10), 1.4);
    doors.color(d.tint);
    doors.panel(front, rect(d.u - d.w / 2, 0, d.u + d.w / 2, d.h), 2, { shade: [0.9, 0.9, 1, 1] });
    doors.color(d.tint, 0.8);
    for (let v = 20; v < d.h - 8; v += 20) doors.panel(front, rect(d.u - d.w / 2, v - 1.2, d.u + d.w / 2, v + 1.2), 2.6);
  }
  const C = P.porch;
  const { frame: west } = F.face('left');
  const top = soffit;
  paint.color(P.trim);
  for (const u of C.posts) {
    paint.solid(localBoxPolys(west, u - 12, u + 12, -4, top, C.out - 12, C.out + 12), { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
    solids.solid(localBoxPolys(west, u - 14, u + 14, -4, top, C.out - 14, C.out + 14), 'stone');
  }
  const D = C.door;
  paint.panel(west, rect(D.u - D.w / 2 - 12, 0, D.u + D.w / 2 + 12, D.h + 12), 1);
  paint.color(0x24282c); // (the hall behind it, both looks: no room of the realistic look's)
  paint.panel(west, rect(D.u - D.w / 2, 4, D.u + D.w / 2, D.h), 1.5);
  glass.color(TINT.pane);
  glass.panel(west, rect(D.u - D.w / 2, 4, D.u + D.w / 2, D.h), 2, { shade: [1, 1, 1.4, 1.4] });
  paint.color(P.trim);
  paint.panel(west, rect(D.u - 4, 4, D.u + 4, D.h), 3);
}

// A north villa's street face from its program (facades.js; the classic look's: flat panels on
// the walls, the oriel a canted box standing out): the garage's white reveal and its door, the
// oriel over it, a round-headed window under a brick ring with an iron grille, an open loggia (a
// dark recess, its bars or its flower box), a niche with its board door, a plain door, the
// upper windows, the lamps; a window on each other face (`sides`). Frames dark.
function facade(kit, walls, glazed, h, F, P, wallH) {
  const { paint, glass, brick } = walls;
  const f = F.face('front').frame;
  const dark = P.frame ?? FRAME;
  const W = WIN.villa;
  const g = P.garage;
  if (g) {
    const doors = kit.drawn('garageDoors').paint;
    doors.color(TINT.white);
    doors.panel(f, outlineOf(g.u, 0, g.w + 20, g.h + 10, { rise: g.rise && g.rise + 4, round: g.round && g.round + 8 }), 1);
    doors.color(g.tint);
    const door = outlineOf(g.u, 0, g.w, g.h, g);
    doors.panel(f, door, 2, { shade: door.map(([, v]) => 0.85 + (0.15 * v) / g.h) });
    doors.color(g.tint, 0.7);
    const spring = g.h - (g.rise || g.round || 0);
    for (let i = 1; i < 5; i++) doors.panel(f, rect(g.u - g.w / 2, (spring * i) / 5 - 2, g.u + g.w / 2, (spring * i) / 5 + 2), 3);
  }
  if (P.oriel) oriel(walls, f, P.oriel, wallH, dark);
  if (P.arch) {
    const a = P.arch;
    brick.color(h.brick ?? 0xb05a3c, 1.12);
    brick.panel(f, outlineOf(a.u, a.sill - 4, a.w + 24, a.crown - a.sill + 16, { rise: a.w / 2 + 12 }), 0.5);
    villaWindow(glazed, f, a.u, { w: a.w, sill: a.sill, h: a.crown - a.sill, frame: 8, tint: dark }, true);
    paint.color(0x141414);
    for (const v of [a.sill + 8, a.sill + 40]) paint.panel(f, rect(a.u - a.w / 2 - 6, v, a.u + a.w / 2 + 6, v + 5), 4);
  }
  if (P.loggia) {
    const l = P.loggia;
    const pts = outlineOf(l.u, l.sill, l.w, l.crown - l.sill, { rise: l.w / 2 });
    brick.color(h.brick ?? 0xb05a3c, 1.12);
    brick.panel(f, outlineOf(l.u, l.sill, l.w + 24, l.crown - l.sill + 12, { rise: l.w / 2 + 12 }), 0.5);
    paint.color(l.boards ? 0x5a3c2a : 0x4a4440);
    paint.panel(f, pts, 1);
    paint.color(l.boards ? 0x8d5a3a : 0xd8d2c6, 0.9);
    paint.panel(f, outlineOf(l.u, l.crown - l.w / 2 - 20, l.w, l.w / 2 + 20, { rise: l.w / 2 }), 1.5);
    paint.color(0x2a2220);
    if (l.bars) for (let i = 0; i < l.bars; i++) paint.panel(f, rect(l.u - l.w / 2, l.sill + 20 + i * 34, l.u + l.w / 2, l.sill + 26 + i * 34), 2);
    if (l.box) paint.panel(f, rect(l.u - l.w / 2 + 6, l.sill, l.u + l.w / 2 - 6, l.sill + 40), 2);
  }
  if (P.niche) {
    const n = P.niche;
    paint.color(0xb8b4ac);
    paint.panel(f, outlineOf(n.u, 0, n.w, n.h, { rise: n.w / 2 }), 1);
    paint.color(n.tint);
    paint.panel(f, outlineOf(n.u, 6, n.w - 20, n.h - 16, { rise: n.w / 2 - 10 }), 2);
  }
  if (P.door) {
    const d = P.door;
    paint.color(dark);
    paint.panel(f, rect(d.u - d.w / 2 - 8, 0, d.u + d.w / 2 + 8, d.h + 8), 1);
    paint.color(d.tint);
    paint.panel(f, rect(d.u - d.w / 2, 0, d.u + d.w / 2, d.h), 2);
    if (d.vent) {
      paint.color(0x8a8c8e);
      paint.panel(f, rect(d.u - 14, d.h + 24, d.u + 14, d.h + 40), 1);
    }
  }
  for (const w of P.windows ?? []) {
    const [u, ww, sill, hh] = Array.isArray(w) ? w : [w, W.w, W.sill, W.h];
    villaWindow(glazed, f, u, { w: ww, sill, h: hh, frame: W.frame, tint: dark }, false);
  }
  for (const [u, v, kind] of P.lamps ?? []) {
    if (kind === 'globe') {
      paint.color(TINT.white);
      paint.solid(localBoxPolys(f, u - 12, u + 12, v, v + 24, 4, 28, { bottom: true }));
    } else wallLamp(paint, f, u, v);
  }
  // A window on the back and the sides (`sides`: not where the villa's other block stands).
  for (const name of h.sides ?? []) villaWindow(glazed, F.face(name).frame, 0, { ...W, tint: dark }, false);
}

// A canted oriel (the classic look's: drawn only): its two cheeks and its front, framed dark
// round the glass, a dark cap under the soffit, a brick foot stepping in under it.
function oriel({ paint, glass, brick }, f, o, wallH, dark) {
  const top = wallH - 20;
  const [hw, hf] = [o.w / 2, o.front / 2];
  const plan = [[o.u - hw, 0], [o.u - hf, o.out], [o.u + hf, o.out], [o.u + hw, 0]];
  for (let i = 0; i < 3; i++) {
    const [[ua, wa], [ub, wb]] = [plan[i], plan[i + 1]];
    const l = Math.hypot(ub - ua, wb - wa);
    const n = [(wa - wb) / l, (ub - ua) / l];
    paint.color(dark);
    paint.poly([f.at(ua, o.v0, wa), f.at(ub, o.v0, wb), f.at(ub, top, wb), f.at(ua, top, wa)], { facing: f.dir(n[0], 0, n[1]) });
    const k = 0.12;
    const p = (s, v) => f.at(ua + (ub - ua) * s + n[0] * 0.8, v, wa + (wb - wa) * s + n[1] * 0.8);
    glass.color(TINT.pane);
    glass.poly([p(k, o.v0 + 30), p(1 - k, o.v0 + 30), p(1 - k, top - 24), p(k, top - 24)], { facing: f.dir(n[0], 0, n[1]) });
  }
  paint.color(0x2a2a2c);
  paint.poly(plan.map(([u, w]) => f.at(u, top, w)).reverse(), { facing: [0, 1, 0] });
  brick.color(0xa05832);
  const foot = plan.map(([u, w]) => [o.u + (u - o.u) * 0.86, w * 0.5]);
  brick.poly(plan.map(([u, w]) => f.at(u, o.v0, w)), { facing: [0, -1, 0], shade: 0.6 });
  for (let i = 0; i < 3; i++) {
    const [[ua, wa], [ub, wb]] = [plan[i], plan[i + 1]];
    const l = Math.hypot(ub - ua, wb - wa);
    brick.poly([f.at(ua, o.v0, wa), f.at(foot[i][0], o.v0 - 50, foot[i][1]), f.at(foot[i + 1][0], o.v0 - 50, foot[i + 1][1]), f.at(ub, o.v0, wb)], { facing: f.dir((wa - wb) / l, -0.6, (ub - ua) / l), shade: 0.8 });
  }
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
  const holes = door ? [{ u0: door.u - door.w / 2, u1: door.u + door.w / 2, v0: door.sill ?? 0, v1: door.h }] : [];
  for (const name of chainFaces(h)) {
    const { frame: f, half } = F.face(name);
    const cut = name === 'front' ? holes : [];
    const gable = name === 'left' || name === 'right';
    for (const [a, b, full] of brickSpans(h, name, half)) {
      brick.color(TINT.whiteBrick);
      brick.shade = PLINTH_SHADE(y0);
      band(brick, f, a, b, 0, full || (gable && h.gableEnds) ? wallH : plinth, cut);
      brick.shade = null;
      if (!full && !(gable && h.gableEnds)) {
        boards.color(h.boards);
        band(boards, f, a, b, plinth, wallH, cut, { shade: [1, 1, 0.84, 0.84] });
      }
    }
    if (gable) {
      // The gable's triangle in boards.
      boards.color(h.gableBoards ?? h.boards);
      boards.panel(f, [[-half, wallH], [half, wallH], [0, h.ridge - y0]], 0, { shade: [0.84, 0.84, 0.95] });
    }
  }
  // (A house out of the course, id-less, the realistic look draws nothing of: its windows plain
  // panes in paint, opaque, no room behind them, each where its `panes` put it.)
  const wk = h.id ? drawn : { ...drawn, glass: drawn.paint, look: '' };
  // (W8: a gable's own panels, proud of its brick, and its windows: facades.js GABLES, or an
  // id-less house's own `gables`.)
  for (const [name, G] of Object.entries(GABLES[h.id] ?? h.gables ?? {})) {
    const { frame: f } = F.face(name);
    const holes = G.windows.map((o) => ({ u0: o.u - o.w / 2 - 10, u1: o.u + o.w / 2 + 10, v0: o.sill - 10, v1: o.sill + o.h + 10 }));
    for (const P of G.panels) {
      boards.color(P.tint);
      // (W8 fix: a shiplap panel's boards across it, the plank texture turned, 25 a course, in a
      // black frame: its edges and a flashing under it.)
      const [o0, R] = [f.at(0, 0, 0), boards.repeat];
      const uv = P.shiplap && ((p) => [((p[1] - o0[1]) * 3) / R, ((p[0] - o0[0]) * f.right[0] + (p[2] - o0[2]) * f.right[2]) / R]);
      band(boards, f, P.u0, P.u1, P.v0, P.v1, holes, { shade: [1, 1, 0.9, 0.9], uv: uv || undefined }, 1);
      if (!P.shiplap) continue;
      paint.color(TINT.frame);
      for (const r of [rect(P.u0 - 7, P.v0 - 7, P.u0, P.v1), rect(P.u1, P.v0 - 7, P.u1 + 7, P.v1), rect(P.u0, P.v0 - 7, P.u1, P.v0)]) paint.panel(f, r, 2);
    }
    for (const o of G.windows) chainWindow(wk, f, o.u, o, h.id ? 'bare' : 'far', h.frame);
  }
  // Windows and the door on the front; a row on the back (the front's, or its own); a house's
  // own windows (h.win: six lights) with their own kinds (h.panes: the kitchen's blinds, a
  // frosted one).
  const front = F.face('front').frame;
  for (const name of ['front', 'back']) for (const o of chainWindows(h, name, WIN.chain)) chainWindow(wk, F.face(name).frame, o.u, h.win || !h.id ? o : null, h.id ? o.kind : 'far', h.frame);
  if (typeof h.door === 'number') {
    // (A neighbour's own door, `doorSize`: black boards up to its head, a glazed side light in the
    // same frame, its lantern where it hangs, a white plastic downpipe: W5.)
    const D = h.doorSize ?? { w: 116, h: 215 };
    const cs = 12;
    paint.color(TINT.frame);
    paint.panel(front, rect(h.door - D.w / 2 - cs, 0, h.door + D.w / 2 + cs, D.h + 10), 1);
    paint.color(TINT.door);
    paint.panel(front, rect(h.door - D.w / 2, 0, h.door + D.w / 2, D.h), 2);
    if (h.doorSize) {
      paint.color(0x161616);
      for (const k of [-2, -1, 0, 1, 2]) paint.panel(front, rect(h.door + (k * D.w) / 5.5 - 1.5, 6, h.door + (k * D.w) / 5.5 + 1.5, D.h - 6), 2.5);
    }
    if (h.sidelight) {
      const S = h.sidelight;
      paint.color(TINT.frame);
      paint.panel(front, rect(S.u - S.w / 2 - cs, 0, S.u + S.w / 2 + cs, D.h + 10), 1);
      drawn.glass.color(TINT.glint);
      drawn.glass.panel(front, rect(S.u - S.w / 2, 30, S.u + S.w / 2, D.h - 10), 2, { shade: [0.8, 0.8, 1.1, 1.1] });
      paint.color(TINT.frame);
      for (const k of [1, 2]) paint.panel(front, rect(S.u - S.w / 2, 30 + ((D.h - 40) * k) / 3 - 3, S.u + S.w / 2, 30 + ((D.h - 40) * k) / 3 + 3), 3);
    }
    const lamp = h.lantern ?? { u: h.door + 110, v: 200 };
    wallLamp(paint, front, lamp.u, lamp.v);
  }
  for (const u of h.pvc ?? []) {
    paint.color(TINT.white);
    paint.panel(front, rect(u - 5, 0, u + 5, wallH - 4), 4);
  }
  if (h.veranda) veranda(drawn, F, h, wallH);
  gableRoof(drawn, F, h, 'u');
  kit.solids.solid(gablePolys(F, hw, hd, y0, h.eave, h.ridge, 'u'), 'stone');
  if (DORMERS[h.id]) dormer(drawn, kit.solids, F, h, dormerOf(h), y0);
  // (A roof steeper than a ledge's top may be, the dad's: a flat lip `eaveLip` deep in front of
  // the front wall at the eave, its gutter's, so a standing jump at the wall still grabs the
  // eave and climbs onto the roof.)
  if (h.eaveLip) kit.solids.solid(localBoxPolys(front, -hw - (h.overhang ?? 60), hw + (h.overhang ?? 60), wallH - 30, wallH, 0, h.eaveLip, { bottom: true }), 'stone');
  // A wing's roof on past its wall to the valleys: a wedge over the main roof's back slope (its
  // underside on that slope), from the wall's top to the ridge's end at the apex.
  if (h.join) {
    const [a, b, c, d] = [F.at(hw, h.eave, -hd), F.at(hw, h.eave, hd), F.at(hw, h.ridge, 0), F.at(h.join.apex, h.ridge, 0)];
    kit.solids.solid([[a, b, c], [b, a, d], [a, c, d], [c, b, d]], 'stone');
  }
}

function garage(kit, h) {
  const { render, boards, blocks, paint } = kit;
  const F = frame(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const apex = h.ridge - y0;
  // (W8, photos 25, 29, 30: the double garage's front: split-face pillars at its corners up to a
  // white beam across them, cream boards over it to the roof, the doors between the pillars in
  // white casings either side of a white render pier with a wallbox, a white lintel over them.)
  const [p0, p1] = h.pillars;
  const beam = h.beam - y0;
  for (const name of FACES) {
    const { frame: f, half } = F.face(name);
    const front = name === 'front';
    render.color(TINT.render);
    render.shade = PLINTH_SHADE(y0);
    render.panel(f, rect(-half, 0, half, front ? beam : wallH), 0);
    render.shade = null;
    if (name === 'front' || name === 'back') {
      boards.color(0xece6d6);
      const lo = front ? beam + 22 : wallH;
      boards.panel(f, [[-half, lo], [half, lo], [half, wallH], [0, apex], [-half, wallH]], 0, { shade: [0.86, 0.86, 0.92, 1, 0.92] });
      for (let u = -half + 22; u < half; u += 22) {
        const top = wallH + (apex - wallH) * (1 - Math.abs(u) / half);
        boards.color(0xece6d6, 0.82);
        boards.panel(f, rect(u - 1.2, lo, u + 1.2, top - 2), 0.4);
      }
    }
  }
  const front = F.face('front').frame;
  // (P4, photos 29, 30: light grey-white split-face, not tan; P4 fix: the realistic tint cool, so
  // the blocks material's own warm shade, real/jobs.js, leaves them grey-white in the shade.)
  blocks.color(kit.look === 'real' ? 0xb0c5d4 : 0xdcdad4, kit.look === 'real' ? 1.5 : 1.15);
  for (const s of [-1, 1]) blocks.solid(localBoxPolys(front, s > 0 ? p0 : -p1, s > 0 ? p1 : -p0, -4, beam, 0, 14));
  paint.color(TINT.white);
  paint.solid(localBoxPolys(front, -p1 - 8, p1 + 8, beam, beam + 22, -2, 16), { faceShade: (n) => (n[1] < -0.5 ? 0.7 : 1) });
  const D = h.door;
  const doors = kit.drawn('garageDoors').paint; // (the realistic look's own: world/lane/real/villas.js)
  for (const u of h.doors) {
    doors.color(TINT.white);
    doors.panel(front, rect(u - D.w / 2 - 12, 0, u + D.w / 2 + 12, D.h + 12), 1);
    garageDoor(doors, front, u, { ...D, rib: 23 }, TINT.garage);
  }
  // The pier's wallbox and its coiled cable.
  paint.color(0x2c2e30);
  paint.solid(localBoxPolys(front, -20, 20, 230, 285, 0, 16), { faceShade: (n) => (n[1] < -0.5 ? 0.5 : 1) });
  paint.color(0x141414);
  paint.panel(front, Array.from({ length: 10 }, (_, i) => [-Math.sin(i * 0.628) * 22, 175 + Math.cos(i * 0.628) * 29]), 8);
  paint.solid(beamPolys(front.at(0, 230, 8), front.at(4, 204, 8), front.dir(0, 0, 1), 4, 4));
  gableRoof(kit, F, h, 'w');
  kit.solids.solid(gablePolys(F, h.w / 2, h.d / 2, y0, h.eave, h.ridge, 'w'), 'stone');
}

// ---------------------------------------------------------------- the flat-roofed link and carport

// The link between south_1 and the dad's (W5: as photos 41 and 42 have it): a block to its flat
// roof in yellow boards; its door wall set back under a deep dark fascia band (L.fascia up to the
// roof's top, L.out in front of the wall, a dark soffit under it): from the dad's corner a panel
// of the boards, then a black flat double door up to the fascia (two leaves, a seam between),
// a black downpipe against south_1's gable. Solid: the block (the fascia drawn only).
export function link(kit, L) {
  const { boards, paint, solids } = kit;
  const y0 = 22;
  boards.color(L.boards);
  boards.shade = PLINTH_SHADE(y0);
  boards.box(L.x0, L.x1, y0, L.top - L.slab, L.z0, L.z1, { bottom: false, top: false });
  boards.shade = null;
  const z = L.z0 - 1;
  const quad = (b, x0, x1, ya, yb, zz, facing = [0, 0, -1]) => b.poly([[x0, ya, zz], [x1, ya, zz], [x1, yb, zz], [x0, yb, zz]], { facing });
  // The double door: two black leaves, a dark seam and a frame round them, handles.
  const [d0, d1] = L.doors;
  paint.color(TINT.frame);
  quad(paint, d0 - 6, d1 + 6, y0, L.fascia, z);
  paint.color(TINT.door, 1.1);
  const mid = (d0 + d1) / 2;
  quad(paint, d0, mid - 2, y0 + 2, L.fascia - 4, z - 1);
  quad(paint, mid + 2, d1, y0 + 2, L.fascia - 4, z - 1);
  paint.color(0x8a8c8e);
  for (const x of [mid - 14, mid + 6]) paint.box(x, x + 8, y0 + 100, y0 + 108, z - 6, z - 1);
  // The downpipe against south_1's gable.
  paint.color(TINT.door);
  paint.box(L.pipe - 6, L.pipe + 6, y0, L.top - 4, L.z0 - 14, L.z0 - 2);
  // The fascia band (its face, its ends) and the soffit under it to the wall.
  const zf = L.z0 - L.out;
  paint.color(TINT.fascia);
  paint.box(L.x0, L.x1, L.fascia, L.top + 4, zf - 4, zf, { top: false, bottom: false });
  paint.color(TINT.soffit);
  paint.poly([[L.x0, L.fascia, zf], [L.x1, L.fascia, zf], [L.x1, L.fascia, L.z0], [L.x0, L.fascia, L.z0]], { facing: [0, -1, 0], shade: 0.6 });
  flatRoof(kit, L.x0, L.x1, zf, L.z1, L.top, L.slab);
  // (The fascia drawn only: within the camera's margin of the wall, and no low ceiling over
  // the drive.)
  solids.box(L.x0, L.x1, y0, L.top, L.z0, L.z1, 'stone');
}

// The garage row between the dad's and south_2 (C: layout.CARPORT) and the store room under it
// (G: layout.GARAGE): the roof slab from the dad's gable's back corner, a thin dark fascia board
// along its front edge down to the doors' tops (a wall under the whole lip: Jonas grabs the edge
// anywhere along it), and the door wall just behind it (W4: no open bay): its fixed boards and
// the lintels over the openings (their faces
// toward the drive in their tints, toward the room in the lining's), a frame round each opening,
// the grey downpipe, the four leaves (five boards each with their ledges and hardware: each board
// a piece the lane's chunk throws, objects/laneBoss/LaneGarage.js; kit.garage.pieces records each
// piece's vertex ranges in the builders it went into, by name: 'boards', 'paint'); behind it the
// room's lining (bare boards, darker low), a filler closing the slit at the dad's back corner,
// the back wall's outside face, the props' colliders (their drawing: the lane's chunk's in the
// classic look, the worker's in the realistic one) and a darker soffit over the room. Colliders
// are walls only wherever a top would be a floor under the low ceiling; each leaf's is named.
export function carport(kit, C, G) {
  const { boards, paint, solids } = kit;
  const y0 = 22;
  const { under, door } = G;
  const z0 = G.wall;
  const z1 = z0 + G.thick;
  const walls = { top: false, bottom: false };
  const ramp = (a, b) => (x, y) => a + b * Math.min(1, (y - y0) / 300);
  const quad = (b, x0, x1, ya, yb, za, zb, facing) => b.poly([[x0, ya, za], [x1, ya, zb], [x1, yb, zb], [x0, yb, za]], { facing });
  paint.color(TINT.fascia);
  paint.box(C.x0 - 4, C.x1 + 4, G.fascia, under, C.z0 - 4, C.z0, { top: false });
  solids.box(C.x0 - 4, C.x1 + 4, G.fascia, C.top, C.z0 - 4, C.z0, 'wood', walls);
  // The wall's spans: the fixed boards to the slab, a lintel over each opening.
  const span = (x0, x1, ya, t) => {
    const opts = { top: false, bottom: ya > y0 };
    boards.color(G.inside);
    boards.shade = ramp(0.35, 0.15);
    boards.box(x0, x1, ya, under, z0, z1, opts);
    boards.color(G.tints[t]);
    boards.shade = ramp(0.8, 0.2);
    quad(boards, x0, x1, ya, under, z0 - 1, z0 - 1, [0, 0, -1]);
    solids.box(x0, x1, ya, under, z0, z1, 'wood', opts);
  };
  for (const [x0, x1, t] of G.fixed) span(x0, x1, y0, t);
  const pieces = [];
  const mark = (b) => b.pos.length / 3;
  G.leaves.forEach((l, k) => {
    span(l.x0, l.x1, door, 0);
    // Its frame: dark strips round the opening, on the wall (the double doors share one).
    boards.shade = null;
    boards.color(G.tints[l.tint], 0.6);
    boards.box(l.x0 - 6, l.x1 + 6, door, door + 6, z0 - 2, z0);
    for (const [x, edge] of [[l.x0 - 6, l.x0], [l.x1, l.x1]]) if (!G.leaves.some((m) => m !== l && (m.x0 === edge || m.x1 === edge))) boards.box(x, x + 6, y0, door, z0 - 2, z0);
    // Five boards (a groove between), each with its two ledges behind and its hardware on the
    // drive side: strap hinges on the hinge side's board, the handle near the other edge, the
    // sign high on the east double door's east board.
    const w = (l.x1 - l.x0) / 5;
    for (let i = 0; i < 5; i++) {
      const a = l.x0 + i * w + 1;
      const b = a + w - 2;
      const s = mark(boards);
      boards.color(G.tints[l.tint]);
      boards.box(a, b, y0 + 2, door - 2, z0 + 1, z0 + 5, { faceShade: (n) => (n[2] > 0.5 ? 0.4 : 1) });
      for (const y of [72, 240]) boards.box(a - 1, b + 1, y, y + 22, z0 + 5, z0 + 9, { shade: 0.45 });
      const parts = [{ b: 'boards', start: s, count: mark(boards) - s }];
      const p = mark(paint);
      const hinge = l.hinge > 0 ? 4 : 0;
      paint.color(0x1a1a1a);
      if (i === hinge) for (const y of [80, 248]) paint.box(l.hinge > 0 ? l.x1 - 40 : l.x0 + 1, l.hinge > 0 ? l.x1 - 1 : l.x0 + 40, y, y + 6, z0 - 1, z0 + 1);
      const hx = l.hinge > 0 ? l.x0 + 12 : l.x1 - 12;
      if (l.handle && i === 4 - hinge) paint.box(hx - 4, hx + 4, 147, 177, z0 - 6, z0 + 1);
      if (l.sign && i === 4) {
        paint.color(0xb03a2a);
        paint.box(l.x1 - 50, l.x1 - 8, door - 74, door - 40, z0 - 2, z0 + 1);
        paint.color(0xf0dca0);
        paint.box(l.x1 - 47, l.x1 - 11, door - 71, door - 43, z0 - 3, z0 - 2);
      }
      if (mark(paint) > p) parts.push({ b: 'paint', start: p, count: mark(paint) - p });
      pieces.push({ leaf: k, at: [(a + b) / 2, (y0 + door) / 2, z0 + 3], parts });
    }
    solids.named(`garage_${k}`).box(l.x0, l.x1, y0, door, z0, z1, 'wood', walls);
  });
  kit.garage = { pieces };
  paint.color(0x8a8c8e);
  paint.box(G.pipe, G.pipe + 12, y0, under, z0 - 14, z0 - 2);
  // The room: its lining, the slit at the dad's back corner closed, the back wall's outside.
  const [xa, xb, zb] = [C.x0 + G.lining, C.x1 - G.lining, C.z1 - 20];
  boards.color(G.inside);
  boards.shade = ramp(0.35, 0.15);
  quad(boards, xa, xa, y0, under, z1, zb, [1, 0, 0]);
  quad(boards, xb, xb, y0, under, z1, zb, [-1, 0, 0]);
  quad(boards, xa, xb, y0, under, zb, zb, [0, 0, -1]);
  boards.color(C.back);
  boards.shade = ramp(0.62, 0.2);
  quad(boards, C.x0 - 10, C.x1, y0, under, C.z1, C.z1, [0, 0, 1]);
  quad(boards, C.x0 - 10, C.x0 - 10, y0, under, C.z1 - 45, C.z1, [-1, 0, 0]);
  boards.shade = null;
  solids.box(C.x0, C.x1, y0, under, zb, C.z1, 'wood');
  solids.box(C.x0 - 10, C.x0 + 10, y0, under, C.z1 - 50, C.z1, 'wood', walls);
  for (const [x0, x1, za, zc] of G.props) solids.box(x0, x1, y0, G.propTop, za, zc, 'wood', walls);
  flatRoof(kit, C.x0, C.x1, C.z0, C.z1, C.top, C.slab, z0);
  solids.box(C.x0, C.x1, under, C.top, C.z0, C.z1, 'wood', { bottom: true });
}

// A flat roof slab from y top - slab to top: felt on top, a dark fascia round its edge, its
// underside in shade.
// (room: the soffit darker from there on: the store room under the carport.)
function flatRoof(kit, x0, x1, z0, z1, top, slab, room = z1) {
  const { roof, paint } = kit;
  roof.color(TINT.felt);
  roof.poly([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], { facing: [0, 1, 0] });
  paint.color(TINT.fascia);
  paint.box(x0 - 4, x1 + 4, top - slab, top + 4, z0 - 4, z1 + 4, { bottom: false, top: false });
  paint.color(TINT.soffit);
  const y = top - slab;
  for (const [a, b, k] of [[z0, room, 0.6], [room, z1, 0.3]]) if (b > a) paint.poly([[x0, y, a], [x1, y, a], [x1, y, b], [x0, y, b]], { facing: [0, -1, 0], shade: k });
}

// ---------------------------------------------------------------- roofs

// A hipped roof (pan tiles) past the walls (facades.js hipOf: a north villa's eaves deep at the
// front, its rim over the eave, a boxed soffit; else `overhang` all round, its slopes through the
// walls' tops): the slopes up to the ridge (along the longer side; a point over a square), the
// soffit under the overhang and a fascia along the eaves.
function hipRoof(kit, F, h) {
  const { roof, paint } = kit;
  const R = hipOf(h);
  const at = ([u, y, w]) => F.at(u, y, w);
  roof.color(kit.look === 'real' ? (h.realRoof ?? h.roof) : h.roof); // (W8: a tint of its own in the realistic look, its tile set brighter)
  const shade = [0.92, 0.92, 1.04, 1.04];
  for (const [pts, [du, dy, dw]] of R.slopes) roof.poly(pts.map(at), { facing: F.dir(du, dy, dw), shade: pts.length === 4 ? shade : shade.slice(0, 3) });
  // The soffit under the overhang and the fascia along the eaves: boxed level at the fascia's
  // foot (a north villa's, in its brown boards) or along the slope (the others').
  const { a, b, rim } = R;
  const wall = [[-a, b], [a, b], [a, -b], [-a, -b]];
  const fd = R.deep ? ROOF.fascia : ROOF_THICK;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const [p, q] = [rim[i], rim[j]];
    const lo = (r) => F.at(r[0], r[1] - fd, r[2]);
    const wy = R.deep || R.knee !== R.rim ? R.Y - fd : h.eave - ROOF_THICK; // (boxed level: a north villa's, and a kicked eave's)
    paint.color(R.deep ? ROOF.soffit : (h.trim ?? TINT.soffit));
    paint.poly([lo(p), lo(q), F.at(wall[j][0], wy, wall[j][1]), F.at(wall[i][0], wy, wall[i][1])], { facing: [0, -1, 0], shade: 0.7 });
    paint.color(R.deep ? ROOF.board : (h.trim ?? TINT.fascia));
    paint.poly([lo(p), lo(q), at(q), at(p)], { facing: F.dir(p[0] + q[0], 0, p[2] + q[2]) });
  }
}

// A gable roof along u (the chain houses) or w (the garage): the two slopes past the walls by
// the overhang at the eaves and the verges, their undersides dark, a fascia along the eaves and
// barge boards up the verges.
function gableRoof(kit, F, h, axis) {
  const { roof, paint } = kit;
  const o = h.overhang ?? 60;
  const ov = h.verges ?? o; // (W8: the verges' own overhang, the double garage's)
  // (a: along the ridge, b: across it) -> local (u, w).
  const P = axis === 'u' ? (a, y, b) => F.at(a, y, b) : (a, y, b) => F.at(b, y, a);
  const [A, B] = axis === 'u' ? [h.w / 2, h.d / 2] : [h.d / 2, h.w / 2];
  const tan = (h.ridge - h.eave) / B;
  const lo = h.eave - o * tan;
  // (A wing's slopes run on at its +u end to the valleys with the main roof: the rim to
  // join.rim, the ridge to join.apex; no verge there.)
  const [rimEnd, ridgeEnd] = h.join ? [h.join.rim, h.join.apex] : [A + ov, A + ov];
  for (const s of [-1, 1]) {
    const edge = s * (B + o);
    const n = axis === 'u' ? F.dir(0, 1, s * tan) : F.dir(s * tan, 1, 0);
    roof.color(kit.look === 'real' ? (h.realRoof ?? h.roof) : h.roof);
    roof.poly([P(-A - ov, lo, edge), P(rimEnd, lo, edge), P(ridgeEnd, h.ridge, 0), P(-A - ov, h.ridge, 0)], { facing: n, shade: [0.92, 0.92, 1.04, 1.04] });
    paint.color(h.soffit ?? TINT.soffit);
    const d = ROOF_THICK;
    paint.poly([P(-A - ov, lo - d, edge), P(rimEnd, lo - d, edge), P(ridgeEnd, h.ridge - d, 0), P(-A - ov, h.ridge - d, 0)], { facing: [-n[0], -n[1], -n[2]], shade: h.soffit ? 0.8 : 0.55 }); // (a white soffit lighter: W8 fix)
    paint.color(h.verges ? TINT.white : TINT.fascia);
    const out = axis === 'u' ? F.dir(0, 0, s) : F.dir(s, 0, 0);
    const fd = h.verges ? 30 : d; // (the double garage's broad white fascias)
    paint.poly([P(-A - ov, lo - fd, edge), P(rimEnd, lo - fd, edge), P(rimEnd, lo, edge), P(-A - ov, lo, edge)], { facing: out });
    // Barge boards up both verges (a wing's far one), in the house's own tint (`verge`).
    paint.color(h.verge ?? (h.verges ? TINT.white : TINT.fascia));
    for (const e of h.join ? [-1] : [-1, 1]) {
      const a = e * (A + ov);
      const vout = axis === 'u' ? F.dir(e, 0, 0) : F.dir(0, 0, e);
      const deep = h.verges ? 30 : h.verge ? 22 : 4;
      paint.poly([P(a, lo - d - deep, edge), P(a, h.ridge - d - deep, 0), P(a, h.ridge + 3, 0), P(a, lo + 3, edge)], { facing: vout });
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

// A garage door: a grey panel with three darker joints across it (`rib`: fine ribs that far apart).
function garageDoor(b, f, u, { w, h, rib = 0 }, tint = TINT.garageLight) {
  b.color(TINT.white);
  b.panel(f, rect(u - w / 2 - 14, 0, u + w / 2 + 14, h + 14), 1);
  b.color(tint);
  b.panel(f, rect(u - w / 2, 0, u + w / 2, h), 2, { shade: [0.85, 0.85, 1, 1] });
  b.color(tint, 0.7);
  if (rib) for (let v = rib; v < h - 6; v += rib) b.panel(f, rect(u - w / 2, v - 1.2, u + w / 2, v + 1.2), 3);
  else for (let i = 1; i < 4; i++) b.panel(f, rect(u - w / 2, (h * i) / 4 - 3, u + w / 2, (h * i) / 4 + 3), 3);
}

// A villa's window: a white frame round a dark pane (a pale glint in its upper half), plain or
// arched.
function villaWindow(kit, f, u, W, arched) {
  const { paint, glass } = kit;
  const shape = (hw, v0, h) => (arched ? archContour(hw, h - hw, 6).map(([x, y]) => [u + x, v0 + y]) : rect(u - hw, v0, u + hw, v0 + h));
  paint.color(W.tint ?? TINT.white);
  paint.panel(f, shape(W.w / 2 + W.frame, W.sill - W.frame, W.h + 2 * W.frame), 1);
  room(kit, f, shape(W.w / 2, W.sill, W.h), 1.5);
  glass.color(TINT.pane);
  glass.panel(f, shape(W.w / 2, W.sill, W.h), 2, { shade: arched ? 1 : [1, 1, 1.5, 1.5] });
  paint.color(W.tint ?? TINT.white);
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
// and white curtains drawn to either side; `win` a house's own opening ({ w, h, sill }: the
// dad's, two casements of three lights: two bars across).
function chainWindow(kit, f, u, win = null, kind = null, frameTint = TINT.frame) {
  const { paint, glass } = kit;
  const W = win ? { ...WIN.chain, ...win } : WIN.chain;
  const hw = W.w / 2;
  paint.color(frameTint);
  paint.panel(f, rect(u - hw - W.frame, W.sill - W.frame, u + hw + W.frame, W.sill + W.h + W.frame), 1);
  if (kind === 'far') return glass.color(TINT.pane).panel(f, rect(u - hw, W.sill, u + hw, W.sill + W.h), 2);
  room(kit, f, rect(u - hw, W.sill, u + hw, W.sill + W.h), 1.5);
  if (kind === 'frosted') {
    // (Pebbled glass: pale and even, no curtains seen through it.)
    glass.color(0x9aa29e);
    glass.panel(f, rect(u - hw, W.sill, u + hw, W.sill + W.h), 2, { shade: [0.9, 0.9, 1.05, 1.05] });
  } else {
    glass.color(TINT.pane);
    glass.panel(f, rect(u - hw, W.sill, u + hw, W.sill + W.h / 2), 2);
    glass.color(TINT.glint);
    glass.panel(f, rect(u - hw, W.sill + W.h / 2, u + hw, W.sill + W.h), 2, { shade: [0.8, 0.8, 1.1, 1.1] });
  }
  paint.color(TINT.curtain);
  if (kind === 'blinds') {
    // (The kitchen's venetian blinds: pale slats across it.)
    for (let v = W.sill + 8; v < W.sill + W.h - 4; v += 12) paint.panel(f, rect(u - hw, v, u + hw, v + 5), 2.5);
  } else if (kind !== 'frosted' && kind !== 'bare') {
    paint.panel(f, rect(u - hw, W.sill, u - hw + 22, W.sill + W.h), 3);
    paint.panel(f, rect(u + hw - 22, W.sill, u + hw, W.sill + W.h), 3);
  }
  paint.color(frameTint);
  paint.panel(f, rect(u - 4, W.sill, u + 4, W.sill + W.h), 3);
  const bars = W.bars ?? (win ? 2 : 0);
  for (let k = 1; k <= bars; k++) paint.panel(f, rect(u - hw, W.sill + (W.h * k) / (bars + 1) - 3, u + hw, W.sill + (W.h * k) / (bars + 1) + 3), 3);
}

// A shed dormer on a chain house's front slope (W8, facades.js DORMERS: the east house's): its
// face and cheeks in boards, its windows, its roof rising back into the main roof, a white fascia
// along its front; solid (a wedge on the roof).
function dormer(kit, solids, F, h, D, y0) {
  const { boards, roof, paint } = kit;
  const f = wallFrame(F.at(D.u, y0, D.wf), F.dir(0, 0, 1));
  const [hw, v0, v1] = [D.w / 2, D.foot - y0, D.top - y0];
  const holes = D.windows.map((u) => ({ u0: u - D.win / 2 - 10, u1: u + D.win / 2 + 10, v0: v0 + D.sill - 10, v1: v0 + D.sill + D.high + 10 }));
  boards.color(D.boards);
  band(boards, f, -hw, hw, v0, v1, holes, { shade: [0.9, 0.9, 1, 1] });
  for (const [u, e] of [[D.u0, -1], [D.u1, 1]]) boards.poly([F.at(u, D.foot, D.wf), F.at(u, D.top, D.wf), F.at(u, D.yb, D.wb)], { facing: F.dir(e, 0, 0), shade: 0.85 });
  for (const u of D.windows) chainWindow(kit, f, u, { w: D.win, h: D.high, sill: v0 + D.sill, bars: 0 }, null, h.frame);
  const o = 30;
  const k = Math.tan((D.pitch * Math.PI) / 180);
  roof.color(kit.look === 'real' ? (h.realRoof ?? h.roof) : h.roof);
  roof.poly([F.at(D.u0 - o, D.top + 4 - o * k, D.wf + o), F.at(D.u1 + o, D.top + 4 - o * k, D.wf + o), F.at(D.u1 + o, D.yb + 4, D.wb), F.at(D.u0 - o, D.yb + 4, D.wb)], { facing: F.dir(0, 1, k) });
  paint.color(TINT.white);
  paint.poly([F.at(D.u0 - o, D.top - 22, D.wf + o), F.at(D.u1 + o, D.top - 22, D.wf + o), F.at(D.u1 + o, D.top + 4 - o * k, D.wf + o), F.at(D.u0 - o, D.top + 4 - o * k, D.wf + o)], { facing: F.dir(0, 0, 1) });
  const P = (u, y, w) => F.at(u, y, w);
  const [a0, a1, b0, b1, c0, c1] = [P(D.u0, D.foot, D.wf), P(D.u1, D.foot, D.wf), P(D.u0, D.top, D.wf), P(D.u1, D.top, D.wf), P(D.u0, D.yb, D.wb), P(D.u1, D.yb, D.wb)];
  solids.solid([[a0, a1, b1, b0], [b0, b1, c1, c0], [a0, c0, c1, a1], [a0, b0, c0], [a1, c1, b1]], 'stone');
}

// The glazed veranda round a chain house's corner under its own roof (W8 fix: the veranda house's
// north-west corner, photos 02, 03: its gable's end, +u, and its back's, -w): from the corner
// `gable` along the gable and `side` along the back, a white board parapet `sill` high under a
// white cap, the glazing over it to a white head under the soffit, white mullions and a transom,
// a white post at the corner; opaque (no room behind it), drawn only.
function veranda({ paint, boards }, F, h, wallH) {
  const V = h.veranda;
  const [hw, hd] = [h.w / 2, h.d / 2];
  for (const [name, a, b] of [['right', hd - V.gable, hd], ['back', -hw, -hw + V.side]]) {
    const f = F.face(name).frame;
    boards.color(TINT.white);
    boards.panel(f, rect(a, -4, b, V.sill), 2);
    paint.color(0x2a2e30);
    paint.panel(f, rect(a, V.sill, b, wallH - 20), 1.5);
    paint.color(TINT.white);
    for (const [v0, v1, w] of [[V.sill, V.sill + 9, 6], [wallH - 80, wallH - 73, 3], [wallH - 20, wallH, 3]]) paint.panel(f, rect(a, v0, b, v1), w);
    const n = Math.round((b - a) / 110);
    for (let i = 0; i <= n; i++) paint.panel(f, rect(a + ((b - a) * i) / n - 5, V.sill, a + ((b - a) * i) / n + 5, wallH - 20), 3);
  }
  paint.solid(localBoxPolys(F.face('right').frame, hd - 9, hd + 9, -4, wallH, -9, 9));
}
