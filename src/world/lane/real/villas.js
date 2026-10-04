// The realistic look's villas up the hill (lane/houses.js villa(): their hipped roofs and their
// colliders stay the classic builder's), built in the worker (world/lane/real/detail.js) in place
// of their walls, windows, doors, bays, balconies and garage doors:
//
//   villaHouses(kit, L)    // the walls (white render to the upper floor, brick over it, a white
//                          // band between) with openings cut for the windows and the door: in
//                          // each a white casing proud of the wall, a reveal, a frame with a
//                          // mullion and a transom, the glass (the reflection probe's street)
//                          // over a dim room, a stone sill (plain or arched, where the classic
//                          // ones are; one a garage door's frame would cross stands proud
//                          // instead); bay windows glazed on three sides over an opening, a
//                          // little tiled roof; the arched front door set back in its opening,
//                          // a step; the balcony a slab, dark posts and rails round dark glass,
//                          // a capping (the classic railing box's size: its top walkable), two
//                          // boxes of geraniums on its front rail (not on low)
//   garageDoors(kit, L)    // sectional doors (the villas' and the double garage's): four
//                          // sections in a white frame, a handle
//   hipTrim(kit, L)        // half-round gutters round the hipped roofs' eaves with a downpipe at
//                          // each front corner, rounded caps along the hips and the ridge
//
// kit: detail.js's Geo per material (render, brick, paint, glass, core, enamel, metal, granite,
// trim, roof, tiles, foliage; the villas' panes go into the kit's `glass@north` where it has one: their own
// probe). The walls carry the weathering's `wear` attribute (house.js wallWear): under each
// window's sill (on down the render under it), else under the eaves.

import { add, mul, sub, norm } from './geo.js';
import { frameOf, fbox, wallWear, streakLength } from './house.js';
import { boxPlants } from './foliage.js';

const WHITE = 0xf6f4ee;
const WIN = { w: 220, sill: 520, h: 200, frame: 12 };

// An opening's outline (u, v) on its wall: a rectangle, or one with a semicircular head;
// counter-clockwise seen from outside.
function outline(u, v0, hw, h, arched) {
  if (!arched) return [[u - hw, v0], [u + hw, v0], [u + hw, v0 + h], [u - hw, v0 + h]];
  const spring = v0 + h - hw;
  const pts = [[u - hw, v0], [u + hw, v0]];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    pts.push([u + hw * Math.cos(a), spring + hw * Math.sin(a)]);
  }
  return pts;
}

// A flat fan over an outline at w (it is convex).
function fan(g, f, pts, w) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    g.tri(f.at(c[0], c[1], w), f.at(a[0], a[1], w), f.at(b[0], b[1], w), { uvs: [c, a, b] });
  }
}

// A frame round an outline: a band `width` wide outside it, standing `depth` proud, its outer
// edge's side.
function surround(g, f, pts, width, w0, depth) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  const out = pts.map(([u, v], i) => {
    // Offset along the mean of the two edges' outward normals (mitred).
    const [pu, pv] = pts[(i + pts.length - 1) % pts.length];
    const [nu, nv] = pts[(i + 1) % pts.length];
    const n1 = norm([v - pv, -(u - pu), 0]);
    const n2 = norm([nv - v, -(nu - u), 0]);
    const m = norm(add(n1, n2));
    const k = width / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    const o = [u + m[0] * k, v + m[1] * k];
    // (Toward the outside: away from the middle.)
    return (o[0] - c[0]) * (u - c[0]) + (o[1] - c[1]) * (v - c[1]) >= 0 ? o : [u - m[0] * k, v - m[1] * k];
  });
  const W = w0 + depth;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    g.quad(f.at(pts[i][0], pts[i][1], W), f.at(out[i][0], out[i][1], W), f.at(out[j][0], out[j][1], W), f.at(pts[j][0], pts[j][1], W));
    g.quad(f.at(out[i][0], out[i][1], W), f.at(out[i][0], out[i][1], w0), f.at(out[j][0], out[j][1], w0), f.at(out[j][0], out[j][1], W));
    g.quad(f.at(pts[j][0], pts[j][1], W), f.at(pts[j][0], pts[j][1], w0), f.at(pts[i][0], pts[i][1], w0), f.at(pts[i][0], pts[i][1], W));
  }
}

// A window standing proud of the wall (no opening: where a garage door's frame would cross it).
function proudWindow({ paint, glass, core, enamel }, f, u, W, arched) {
  const hw = W.w / 2;
  const pts = outline(u, W.sill, hw, W.h, arched);
  core.rgb(0.1, 0.09, 0.08);
  fan(core, f, pts, 0.4);
  glass.color(0x9aa4a8);
  fan(glass, f, pts, 1.2);
  paint.color(WHITE);
  surround(paint, f, pts, W.frame, 0, 5);
  sashes(paint, f, u, W, arched, 3);
  sill(enamel, f, u, W);
}

// The sashes in an opening: a mullion and a transom, depth w (3 deep, from w - 2).
function sashes(paint, f, u, W, arched, w) {
  const hw = W.w / 2;
  const top = W.sill + W.h - (arched ? hw : 0);
  const bar = (u0, u1, v0, v1) => fbox(paint, f, u0, u1, v0, v1, w - 2, w, 'k');
  bar(u - 4, u + 4, W.sill, top);
  bar(u - hw, u + hw, W.sill + W.h * 0.68 - 3, W.sill + W.h * 0.68 + 3);
}

// The sill: a pale stone slab under an opening, sloping out.
function sill(enamel, f, u, W) {
  enamel.color(0xd8d4cc);
  const [a, b] = [u - W.w / 2 - W.frame - 10, u + W.w / 2 + W.frame + 10];
  const v = W.sill - W.frame;
  enamel.quad(f.at(a, v, 12), f.at(b, v, 12), f.at(b, v + 3, 0), f.at(a, v + 3, 0));
  enamel.quad(f.at(a, v - 9, 12), f.at(b, v - 9, 12), f.at(b, v, 12), f.at(a, v, 12));
  enamel.quad(f.at(b, v - 9, 12), f.at(a, v - 9, 12), f.at(a, v - 9, 0), f.at(b, v - 9, 0));
  enamel.quad(f.at(a, v - 9, 0), f.at(a, v - 9, 12), f.at(a, v, 12), f.at(a, v + 3, 0));
  enamel.quad(f.at(b, v - 9, 12), f.at(b, v - 9, 0), f.at(b, v + 3, 0), f.at(b, v, 12));
}

// A triangle in a wall frame's (u, v), turned to face out.
function tri2(g, f, a, b, c, w = 0) {
  const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
  const [p, q] = ccw ? [b, c] : [c, b];
  g.tri(f.at(a[0], a[1], w), f.at(p[0], p[1], w), f.at(q[0], q[1], w), { uvs: [a, p, q] });
}

// A wall band on frame f (u0..u1 across, v0..v1 up, at w 0) with openings cut out of it (each
// { u0, u1, v0, v1, arch }: an arched one's head a half circle its width, the wall filled back
// in its corners); uvs in world units. wear { L, eave }: each quad's weathering (under its
// opening's sill, or under the eaves: house.js wallWear).
function wall(g, f, u0, u1, v0, v1, holes, wear = null) {
  const rect = (a, b, c, d, under = null) => {
    if (d <= c) return;
    if (wear) g.wearAt = wallWear(wear.L, f, under ? under.v0 - 12 : wear.eave, under ? streakLength(under.u0) : 0.5);
    g.quad(f.at(a, c, 0), f.at(b, c, 0), f.at(b, d, 0), f.at(a, d, 0), { uvs: [[a, c], [b, c], [b, d], [a, d]] });
  };
  const cuts = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.v1 > v0 && o.v0 < v1).sort((p, q) => p.u0 - q.u0);
  // (Under a window over the band, its sill's streaks run on down it: the render's.)
  const sills = wear ? holes.filter((o) => o.v0 >= v1 && o.u1 > u0 && o.u0 < u1).sort((p, q) => p.u0 - q.u0) : [];
  const span = (a, b) => {
    let x = a;
    for (const o of sills) {
      if (o.u1 <= x || o.u0 >= b) continue;
      if (o.u0 > x) rect(x, o.u0, v0, v1);
      rect(Math.max(x, o.u0), Math.min(b, o.u1), v0, v1, o);
      x = Math.min(b, o.u1);
    }
    if (x < b) rect(x, b, v0, v1);
  };
  let u = u0;
  for (const o of cuts) {
    if (o.u0 > u) span(u, o.u0);
    rect(o.u0, o.u1, v0, Math.min(v1, o.v0), o);
    rect(o.u0, o.u1, Math.max(v0, o.v1), v1);
    if (o.arch && o.v1 <= v1) {
      const hw = (o.u1 - o.u0) / 2;
      const c = [o.u0 + hw, o.v1 - hw];
      const arc = Array.from({ length: 9 }, (_, i) => [c[0] + hw * Math.cos((Math.PI * i) / 8), c[1] + hw * Math.sin((Math.PI * i) / 8)]);
      for (let i = 0; i < 8; i++) tri2(g, f, i < 4 ? [o.u1, o.v1] : [o.u0, o.v1], arc[i], arc[i + 1]);
    }
    u = o.u1;
  }
  if (u < u1) span(u, u1);
  g.wearAt = null;
}

// An outline shrunk toward its middle by d (convex, near enough for a frame's inner edge).
function shrink(pts, d) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  return pts.map(([u, v]) => {
    const l = Math.hypot(u - c[0], v - c[1]) || 1;
    return [u - ((u - c[0]) / l) * d, v - ((v - c[1]) / l) * d];
  });
}

// Faces along an outline from depth w0 back to w1, facing into it (a reveal, a room's sides).
function lining(g, f, pts, w0, w1) {
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
    g.quad(f.at(q[0], q[1], w0), f.at(q[0], q[1], w1), f.at(p[0], p[1], w1), f.at(p[0], p[1], w0));
  }
}

// A window in its opening (the wall cut round it): a white casing proud of the wall, the reveal
// REVEAL deep, the frame and the sashes in it, the glass (the reflection probe's street) over a
// dim room, a stone sill.
const REVEAL = 12;
function windowIn({ paint, glass, core, enamel }, f, u, W, arched) {
  const pts = outline(u, W.sill, W.w / 2, W.h, arched);
  paint.color(WHITE);
  surround(paint, f, pts, W.frame, 0, 4);
  paint.color(WHITE, 0.82);
  lining(paint, f, pts, 0, -REVEAL);
  paint.color(WHITE);
  surround(paint, f, shrink(pts, 7), 7, -REVEAL, 3);
  sashes(paint, f, u, W, arched, -REVEAL + 3);
  glass.color(0x9aa4a8);
  fan(glass, f, pts, -REVEAL - 1);
  room(core, f, pts, -REVEAL - 2);
  sill(enamel, f, u, W);
}

// The dim room behind a pane: its back wall 140 in, its sides.
function room(core, f, pts, w) {
  core.rgb(0.1, 0.085, 0.07);
  fan(core, f, pts, w - 140);
  core.rgb(0.13, 0.11, 0.09);
  lining(core, f, pts, w, w - 140);
}

// A bay window standing BAY.out out of the wall over an opening as wide as its front's glass:
// a white box, glazed on its front and its sides in white frames with mullions, a stone foot,
// a little tiled roof; the room behind.
const BAY = { w: 420, out: 50, below: 30, above: 30, frame: 14 };
function bay(kit, f, u, W) {
  const { paint, glass, core, roof } = kit;
  const hw = BAY.w / 2;
  const [v0, v1] = [W.sill - BAY.below, W.sill + W.h + BAY.above];
  const [g0, g1] = [W.sill, W.sill + W.h];
  const o = BAY.out;
  const t = BAY.frame;
  paint.color(WHITE);
  // Its foot and its head (boxes the bay's width), the corner posts.
  fbox(paint, f, u - hw, u + hw, v0, g0, 0, o, 'k');
  fbox(paint, f, u - hw, u + hw, g1, v1, 0, o, 'k');
  for (const s of [-1, 1]) fbox(paint, f, s < 0 ? u - hw : u + hw - t, s < 0 ? u - hw + t : u + hw, g0, g1, o - t, o, 'ktb');
  // The front's glass in three lights, the sides' in one each.
  const front = [[u - hw + t, g0], [u + hw - t, g0], [u + hw - t, g1], [u - hw + t, g1]];
  glass.color(0x9aa4a8);
  fan(glass, f, front, o - 4);
  for (const k of [-1, 1]) fbox(paint, f, u + (k * (hw - t)) / 3 - 5, u + (k * (hw - t)) / 3 + 5, g0, g1, o - 6, o - 2, 'k');
  fbox(paint, f, u - hw + t, u + hw - t, g0 + W.h * 0.68 - 3, g0 + W.h * 0.68 + 3, o - 6, o - 2, 'k');
  for (const s of [-1, 1]) {
    const uu = u + s * hw;
    const side = (w0, w1) => [f.at(uu, g0, w0), f.at(uu, g0, w1), f.at(uu, g1, w1), f.at(uu, g1, w0)];
    const q = side(4, o - t);
    if (s > 0) glass.quad(q[1], q[0], q[3], q[2]);
    else glass.quad(q[0], q[1], q[2], q[3]);
  }
  // The room: behind the wall's opening, and the bay's own floor and ceiling inside.
  room(core, f, front, -2);
  core.rgb(0.16, 0.14, 0.11);
  core.quad(f.at(u + hw - t, g0 + 1, o - 6), f.at(u - hw + t, g0 + 1, o - 6), f.at(u - hw + t, g0 + 1, -2), f.at(u + hw - t, g0 + 1, -2));
  // The roof: a little slope of tiles over it.
  roof.color(0x3a3a3a);
  roof.quad(f.at(u - hw - 10, v1, o + 14), f.at(u + hw + 10, v1, o + 14), f.at(u + hw + 10, v1 + 40, 0), f.at(u - hw - 10, v1 + 40, 0));
  for (const s of [-1, 1]) {
    const uu = u + s * (hw + 10);
    const q = [f.at(uu, v1, 0), f.at(uu, v1, o + 14), f.at(uu, v1 + 40, 0)];
    if (s > 0) roof.tri(q[0], q[2], q[1]);
    else roof.tri(q[0], q[1], q[2]);
  }
}

// The arched front door in its opening: a white casing, the reveal, the leaf set back 10 in its
// tint with raised panels' shadows, a brass handle, a stone step.
function frontDoor({ paint, metal, granite, trim }, f, u, v, tint) {
  const hw = 55;
  const pts = outline(u, v, hw, 220, true);
  paint.color(WHITE);
  surround(paint, f, pts, 10, 0, 4);
  paint.color(WHITE, 0.82);
  lining(paint, f, pts, 0, -10);
  paint.color(tint);
  fan(paint, f, pts, -10);
  trim.color(tint, 0.55);
  for (const [a, b] of [[v + 20, v + 100], [v + 115, v + 175]]) {
    for (const s of [-1, 1]) {
      const [u0, u1] = [u + s * 8, u + s * (hw - 12)];
      const q = [f.at(Math.min(u0, u1), a, -9.5), f.at(Math.max(u0, u1), a, -9.5), f.at(Math.max(u0, u1), b, -9.5), f.at(Math.min(u0, u1), b, -9.5)];
      trim.quad(q[0], q[1], q[2], q[3]);
    }
  }
  metal.color(0xb8a060);
  fbox(metal, f, u + hw - 22, u + hw - 10, v + 100, v + 104, -10, -2, 'k');
  granite.color(0xb0aca4);
  fbox(granite, f, u - hw - 20, u + hw + 20, v - 14, v, 0, 40, 'k');
}

// The balcony on a gable (the classic railing box's place and size: solid, its top walkable): a
// slab, a frame of dark posts and rails round dark glass panes, a capping on top; and (not on
// low) two boxes of geraniums hung outside its front rail.
function balcony(kit, f, v0) {
  const { paint, glass, metal } = kit;
  const [u0, u1, w1, top] = [-300, 300, 150, v0 + 100];
  if (kit.tier !== 'low') {
    for (const [a, b] of [[-250, -95], [95, 250]]) {
      metal.color(0x303234);
      fbox(metal, f, a, b, top - 26, top - 5, w1 + 4, w1 + 20);
      kit.core.rgb(0.05, 0.035, 0.02);
      kit.core.quad(f.at(a + 2, top - 6, w1 + 18), f.at(b - 2, top - 6, w1 + 18), f.at(b - 2, top - 6, w1 + 6), f.at(a + 2, top - 6, w1 + 6));
      boxPlants(kit, [0.17, 0.5, 0.83].map((t) => f.at(a + (b - a) * t, top - 6, w1 + 12)), Math.round(a + 7));
    }
  }
  paint.color(0xd8d4cc);
  fbox(paint, f, u0, u1, v0, v0 + 14, 0, w1, 'k');
  metal.color(0x2a2c2e);
  fbox(metal, f, u0 - 3, u1 + 3, top - 6, top, -2, w1 + 3, 'kb');
  for (const u of [u0, -100, 100, u1]) fbox(metal, f, u - 4, u + 4, v0 + 14, top - 6, w1 - 8, w1, 'ktb');
  for (const s of [-1, 1]) fbox(metal, f, s < 0 ? u0 : u1 - 8, s < 0 ? u0 + 8 : u1, v0 + 14, top - 6, 0, w1 - 8, 'ktb');
  glass.color(0x5a6670);
  const pane = (a, b, c, d) => glass.quad(a, b, c, d);
  pane(f.at(u0 + 8, v0 + 14, w1 - 4), f.at(u1 - 8, v0 + 14, w1 - 4), f.at(u1 - 8, top - 6, w1 - 4), f.at(u0 + 8, top - 6, w1 - 4));
  pane(f.at(u0 + 4, v0 + 14, 0), f.at(u0 + 4, v0 + 14, w1 - 8), f.at(u0 + 4, top - 6, w1 - 8), f.at(u0 + 4, top - 6, 0));
  pane(f.at(u1 - 4, v0 + 14, w1 - 8), f.at(u1 - 4, v0 + 14, 0), f.at(u1 - 4, top - 6, 0), f.at(u1 - 4, top - 6, w1 - 8));
  paint.color(0x2a2a2a);
  paint.quad(f.at(u0, top - 1, w1), f.at(u1, top - 1, w1), f.at(u1, top - 1, 0), f.at(u0, top - 1, 0));
}

// A villa's walls (lane/houses.js villa(): the same render, brick, band, windows, door, bays and
// balcony, its roof and colliders staying the classic builder's): the walls with openings cut
// for the windows and the door.
function villaHouse(kit, L, h) {
  const F = frameOf(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const renderTop = h.render - y0;
  const garages = (h.garages ?? (h.garage !== undefined ? [h.garage] : [])).map((u) => ({ u0: u - 274, u1: u + 274, v1: 264 }));
  // The windows on each face: [u, W, arched]; those a garage door's frame would cross stand proud.
  const faces = { front: [], back: [], left: [], right: [] };
  if (renderTop < wallH) {
    for (const u of h.windows ?? []) faces.front.push([u, WIN, false]);
    for (const u of h.arches ?? []) faces.front.push([u, WIN, true]);
    for (const name of ['back', 'left', 'right']) faces[name].push([0, WIN, false]);
  } else {
    const W = { ...WIN, sill: wallH - 230 };
    for (const u of [-550, 0, 550]) faces.front.push([u, W, false]);
    for (const name of ['left', 'right']) faces[name].push([0, W, false]);
  }
  const proud = ([u, W]) => garages.some((g) => g.u0 < u + W.w / 2 + W.frame && g.u1 > u - W.w / 2 - W.frame && g.v1 > W.sill - W.frame);
  let door = null;
  if (h.door !== undefined) {
    const at = F.at(h.door, 0, h.d / 2 + 10);
    door = { u: h.door, v: Math.max(0, L.groundHeight(at[0], at[2]) - y0) };
  }
  for (const name of ['front', 'back', 'left', 'right']) {
    const { f, half } = F.face(name);
    const holes = faces[name].filter((w) => !proud(w)).map(([u, W, arch]) => ({ u0: u - W.w / 2, u1: u + W.w / 2, v0: W.sill, v1: W.sill + W.h, arch }));
    if (name === 'front') {
      for (const u of h.bays ?? []) holes.push({ u0: u - BAY.w / 2 + BAY.frame, u1: u + BAY.w / 2 - BAY.frame, v0: WIN.sill, v1: WIN.sill + WIN.h });
      if (door) holes.push({ u0: door.u - 55, u1: door.u + 55, v0: door.v, v1: door.v + 220, arch: true });
    }
    const wear = { L, eave: wallH };
    kit.render.color(0xf0ece4);
    wall(kit.render, f, -half, half, 0, Math.min(renderTop, wallH), holes, wear);
    if (renderTop < wallH) {
      kit.brick.color(h.brick ?? 0xb05a3c);
      wall(kit.brick, f, -half, half, renderTop, wallH, holes, wear);
      // The white band between the floors.
      kit.paint.color(WHITE);
      fbox(kit.paint, f, -half - 2, half + 2, renderTop - 6, renderTop + 6, 0, 2, 'k');
    }
    for (const w of faces[name]) (proud(w) ? proudWindow : windowIn)(kit, f, w[0], w[1], w[2]);
  }
  const front = F.face('front').f;
  for (const u of h.bays ?? []) bay(kit, front, u, WIN);
  if (door) frontDoor(kit, front, door.u, door.v, h.doorTint ?? 0xe8e4dc);
  if (h.balcony) balcony(kit, F.face('left').f, renderTop + 140);
}

export function villaHouses(kit, L) {
  for (const h of L.HOUSES) if (h.kit === 'villa') villaHouse(kit, L, h);
}

export function garageDoors({ paint, metal }, L) {
  for (const h of L.HOUSES) {
    const villa = h.kit === 'villa';
    const doors = villa ? (h.garages ?? (h.garage !== undefined ? [h.garage] : [])) : h.kit === 'garage' ? h.doors : [];
    const [w, ht, tint] = villa ? [520, 250, 0x5a6a72] : [440, 240, 0x3a3e42];
    const f = frameOf(h).face('front').f;
    for (const u of doors) {
      const [u0, u1] = [u - w / 2, u + w / 2];
      paint.color(WHITE);
      surround(paint, f, [[u0, 0], [u1, 0], [u1, ht], [u0, ht]], 14, 0, 3);
      // Four sections, each a shallow panel bevelled top and bottom.
      for (let k = 0; k < 4; k++) {
        const [v0, v1] = [(ht * k) / 4, (ht * (k + 1)) / 4];
        paint.color(tint, 1.1);
        paint.quad(f.at(u0, v0 + 3, 1), f.at(u1, v0 + 3, 1), f.at(u1, v1 - 3, 1), f.at(u0, v1 - 3, 1));
        paint.color(tint, 0.6);
        paint.quad(f.at(u0, v0, 0.5), f.at(u1, v0, 0.5), f.at(u1, v0 + 3, 1), f.at(u0, v0 + 3, 1));
        paint.color(tint, 1.3);
        paint.quad(f.at(u0, v1 - 3, 1), f.at(u1, v1 - 3, 1), f.at(u1, v1, 0.5), f.at(u0, v1, 0.5));
      }
      metal.color(0xb0aca4);
      metal.quad(f.at(u - 30, 40, 3), f.at(u + 30, 40, 3), f.at(u + 30, 48, 3), f.at(u - 30, 48, 3));
    }
  }
}

export function hipTrim({ metal, tiles }, L) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const F = frameOf(h);
    const tan = Math.tan((h.pitch * Math.PI) / 180);
    const o = h.overhang ?? 60;
    const [a, b] = [h.w / 2, h.d / 2];
    const lo = h.eave - o * tan;
    const ridge = h.eave + Math.min(a, b) * tan;
    const along = a >= b;
    const r = Math.abs(a - b);
    const [R0, R1] = along ? [F.at(-r, ridge, 0), F.at(r, ridge, 0)] : [F.at(0, ridge, -r), F.at(0, ridge, r)];
    const rim = [F.at(-a - o, lo, b + o), F.at(a + o, lo, b + o), F.at(a + o, lo, -b - o), F.at(-a - o, lo, -b - o)];
    // The gutters round the eaves (each side out from the roof's middle), a downpipe at each
    // front corner down the wall.
    metal.color(0x2a2c2e);
    const mid = F.at(0, lo, 0);
    for (let i = 0; i < 4; i++) {
      const [p, q] = [rim[i], rim[(i + 1) % 4]];
      const e = norm(sub(q, p));
      const c = mul(add(p, q), 0.5);
      const out = norm([c[0] - mid[0], 0, c[2] - mid[2]]);
      const at = (s) => add(add(s, mul(out, 10)), [0, -16, 0]);
      metal.tube(at(sub(p, mul(e, 6))), at(add(q, mul(e, 6))), 9, 9, 6, { a0: 0, arc: Math.PI });
      metal.tube(at(sub(p, mul(e, 6))), at(add(q, mul(e, 6))), 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true });
    }
    for (const s of [-1, 1]) {
      const wall = F.at(s * (a - 20), 0, b + 7);
      const top = add(F.at(s * (a - 20), lo - 22, b + o + 10), [0, 0, 0]);
      metal.tube(top, [wall[0], lo - 80, wall[2]], 5, 5, 6);
      metal.tube([wall[0], lo - 80, wall[2]], [wall[0], (h.y0 ?? 22) + 12, wall[2]], 5, 5, 6, { caps: true });
    }
    // The caps: rounded tiles along the hips (from the eaves' corners to the ridge's ends) and the
    // ridge.
    tiles.color(h.roof, 0.9);
    const ends = along ? [R0, R1, R1, R0] : [R1, R1, R0, R0];
    for (let i = 0; i < 4; i++) tiles.tube(add(rim[i], [0, 3, 0]), add(ends[i], [0, 3, 0]), 11, 11, 6, { a0: Math.PI, arc: Math.PI, caps: true });
    if (r > 1) tiles.tube(add(R0, [0, 3, 0]), add(R1, [0, 3, 0]), 13, 13, 8, { a0: Math.PI, arc: Math.PI, caps: true });
  }
}
