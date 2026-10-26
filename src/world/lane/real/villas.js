// The realistic look's villas up the hill (lane/houses.js villa(): their hipped roofs and their
// colliders stay the classic builder's), built in the worker (world/lane/real/detail.js) in place
// of their walls, windows, doors, oriels, loggias, balconies and garage doors:
//
//   villaHouses(kit, L)    // the walls (white render to the upper floor, brick over it, a white
//                          // band between) with openings cut for every opening of the block's
//                          // program (lane/facades.js FACADES, W6: photos 9-13, 16, 17, 23, 25-29):
//                          // the garage's (its segmental or rounded head, a white reveal, the
//                          // ribbed sectional door set back in it), a canted oriel over it (glass
//                          // on its three faces in dark frames, a dark panel under the glass, a
//                          // corbelled brick foot; a box bay on low), a round-headed window under a
//                          // brick rowlock ring behind an iron flower grille, an open loggia (its
//                          // reveal and vault lined, its back in shade, dark bars or an iron box of
//                          // flowers on its sill), a niche with its board door (one leaf or two)
//                          // and a threshold, a plain board door (a vent over it), the plain
//                          // windows (a casing, a reveal, a frame with a mullion and a transom, the
//                          // glass over a dim room, a stone sill; dark frames), the lamps (a white
//                          // globe, a black lantern); the west end's (no program): its windows over
//                          // its garage doors; north_3's balcony dark-stained wood (a slab, posts,
//                          // rails, flat balusters; the classic box's size: its top walkable)
//   garageDoors(kit, L)    // the west end's and the double garage's sectional doors: four
//                          // sections in a white frame, a handle
//   hipTrim(kit, L)        // half-round gutters round the hipped roofs' rims, a downpipe with a
//                          // swan neck at each programmed front corner, rounded caps along the
//                          // hips and the ridge (facades.js hipOf: the north villas' deep eaves),
//                          // the soffits' tongue-and-groove joints under the deep front eaves
//                          // (not on low)
//
// kit: detail.js's Geo per material (render, brick, paint, glass, core, enamel, metal, granite,
// trim, roof, tiles, foliage, boards, gloss; the villas' panes go into the kit's `glass@north`
// where it has one: their own probe). The walls carry the weathering's `wear` attribute (house.js
// wallWear): under each window's sill (on down the render under it), else under the eaves.

import { add, mul, sub, norm } from './geo.js';
import { frameOf, fbox, wallWear, streakLength, wallFrame, lamp } from './house.js';
import { boxPlants } from './foliage.js';
import { FACADES, FRAME, ROOF, hipOf, outlineOf } from '../facades.js';

const WHITE = 0xf6f4ee;
const WIN = { w: 220, sill: 520, h: 200, frame: 12 };
const IRON = 0x141414;

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
function proudWindow({ paint, glass, core, enamel, tier }, f, u, W, arched) {
  const hw = W.w / 2;
  const pts = outline(u, W.sill, hw, W.h, arched);
  core.rgb(0.1, 0.09, 0.08);
  fan(core, f, pts, 0.4);
  glass.color(0x9aa4a8);
  fan(glass, f, pts, 1.2);
  paint.color(WHITE);
  surround(paint, f, pts, W.frame, 0, 5);
  if (tier !== 'low') sashes(paint, f, u, W, arched, 3);
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
    // (A head: the wall filled back in its corners, from the right springing over to the left.)
    const head = o.head ?? (o.arch ? outline((o.u0 + o.u1) / 2, o.v0, (o.u1 - o.u0) / 2, o.v1 - o.v0, true).slice(2) : null);
    if (head && o.v1 <= v1) {
      const mid = (o.u0 + o.u1) / 2;
      for (let i = 0; i + 1 < head.length; i++) {
        const [p, q] = [head[i], head[i + 1]];
        const c = (p[0] + q[0]) / 2 >= mid ? [o.u1, o.v1] : [o.u0, o.v1];
        if (Math.abs((p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0])) > 0.5) tri2(g, f, c, p, q);
      }
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
// (On low the frame inside the reveal and the sashes left out: a casing round plain glass.)
function windowIn({ paint, glass, core, enamel, tier }, f, u, W, arched, tint = WHITE) {
  const pts = outline(u, W.sill, W.w / 2, W.h, arched);
  paint.color(tint);
  surround(paint, f, pts, W.frame, 0, 4);
  paint.color(tint, 0.82);
  lining(paint, f, pts, 0, -REVEAL);
  if (tier !== 'low') {
    paint.color(tint);
    surround(paint, f, shrink(pts, 7), 7, -REVEAL, 3);
    sashes(paint, f, u, W, arched, -REVEAL + 3);
  }
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

// ---------------------------------------------------------------- the kit (W6)

// A facet's own wall frame on frame f from (ua, wa) to (ub, wb) at the floor (u along it, w out
// of it): an oriel's cheeks and front.
function facetFrame(f, [ua, wa], [ub, wb]) {
  const d = norm(f.dir(ub - ua, 0, wb - wa));
  return { g: wallFrame(f.at(ua, 0, wa), [-d[2], 0, d[0]]), len: Math.hypot(ub - ua, wb - wa) };
}

// A canted oriel over the garage (o: facades.js), v0 up to `top` (the soffit): its cheeks and
// front glazed in dark frames over a dark panel, a dark cap, a corbelled brick foot of four
// courses stepping in to the wall; the room behind its opening in the wall. On low a box bay:
// its front glazed, its cheeks plain.
function oriel(kit, f, o, top, dark, tint) {
  const { paint, glass, core, brick, tier } = kit;
  const [hw, hf] = [o.w / 2, o.front / 2];
  const low = tier === 'low';
  const plan = low ? [[o.u - hw, 0], [o.u - hw, o.out], [o.u + hw, o.out], [o.u + hw, 0]] : [[o.u - hw, 0], [o.u - hf, o.out], [o.u + hf, o.out], [o.u + hw, 0]];
  const [g0, g1] = [o.v0 + 24, top - 18];
  for (let i = 0; i < 3; i++) {
    const { g, len } = facetFrame(f, plan[i], plan[i + 1]);
    const glazed = !low || i === 1;
    paint.color(dark);
    if (!glazed) {
      fbox(paint, g, 0, len, o.v0, top, -1, 0, 'klrtb');
      continue;
    }
    // The panel under the glass and the head over it, the posts at its ends, a mullion (the
    // front's), the glass between.
    fbox(paint, g, 0, len, o.v0, g0, -1, 0, 'klrtb');
    fbox(paint, g, 0, len, g1, top, -1, 0, 'klrtb');
    for (const [a, b] of [[0, 9], [len - 9, len]]) fbox(paint, g, a, b, g0, g1, -1, 1.5, 'ktb');
    if (i === 1 && tier === 'high') fbox(paint, g, len / 2 - 4, len / 2 + 4, g0, g1, -3, 1, 'ktb');
    fbox(paint, g, 9, len - 9, g0, g0 + 6, -2, 2, 'kb');
    glass.color(0x9aa4a8);
    glass.quad(g.at(9, g0 + 6, -2), g.at(len - 9, g0 + 6, -2), g.at(len - 9, g1, -2), g.at(9, g1, -2));
  }
  // The oriel's floor inside; the foot's courses under it (up to the soffit: no cap of its own).
  const P = (pts, v, k = 1) => pts.map(([u, w]) => f.at(o.u + (u - o.u) * k, v, w * k));
  core.rgb(0.12, 0.1, 0.08);
  const fl = P(plan, g0 + 1, 0.97);
  core.quad(fl[0], fl[1], fl[2], fl[3]);
  brick.color(tint, 0.95);
  const steps = low ? 1 : 4;
  for (let k = 0; k < steps; k++) {
    const [s0, s1] = [1 - k * 0.16, 1 - (k + 1) * 0.16];
    const [va, vb] = [o.v0 - k * 12, o.v0 - (k + 1) * 12];
    const up = P(plan, va, s0);
    const dn = P(plan, vb, s0);
    for (let i = 0; i < 3; i++) brick.quad(dn[i], dn[i + 1], up[i + 1], up[i]);
    const under = P(plan, vb, s0);
    const inner = P(plan, vb, s1);
    for (let i = 0; i < 3; i++) brick.quad(under[i + 1], under[i], inner[i], inner[i + 1]);
    if (k === steps - 1) brick.quad(inner[3], inner[2], inner[1], inner[0]);
  }
  room(core, f, [[o.u - hw + 10, g0], [o.u + hw - 10, g0], [o.u + hw - 10, g1], [o.u - hw + 10, g1]], -2);
}

// An open round-headed loggia in the brick (l: facades.js): a brick rowlock ring round it, its
// reveal and vault lined (brown boards, or white), its back in shade, a stone sill; dark bars
// across it, or an iron box of flowers on its sill (not on low).
function loggia(kit, f, l, tint) {
  const { brick, paint, boards, render, metal, enamel, tier } = kit;
  const pts = outline(l.u, l.sill, l.w / 2, l.crown - l.sill, true);
  brick.color(tint, 1.12);
  surround(brick, f, pts.slice(1).concat([pts[0]]), 12, 0, 1.5);
  const lin = l.boards ? boards : render;
  lin.color(l.boards ? 0x8d5a3a : 0xf0ece4, 0.92);
  lining(lin, f, pts, 0, -l.depth);
  brick.color(tint, 0.55);
  fan(brick, f, pts, -l.depth);
  sill(enamel, f, l.u, { w: l.w - 24, sill: l.sill + 12, frame: 12 });
  metal.color(l.boards ? 0x3a2a20 : IRON);
  const [u0, u1] = [l.u - l.w / 2, l.u + l.w / 2];
  for (let i = 0; i < (tier === 'low' ? 0 : l.bars ?? 0); i++) fbox(metal, f, u0, u1, l.sill + 22 + i * 34, l.sill + 28 + i * 34, -14, -8, 'k');
  if (l.box) {
    fbox(metal, f, u0 + 8, u1 - 8, l.sill + 4, l.sill + 34, -18, 6, 'k');
    if (tier !== 'low') boxPlants(kit, [0.2, 0.5, 0.8].map((t) => f.at(u0 + 8 + (l.w - 16) * t, l.sill + 30, -6)), Math.round(l.u));
  }
}

// A round-headed window (a: facades.js) under a brick rowlock ring, dark frames, a black iron
// flower grille across its foot with plants behind it (not on low).
function archWindow(kit, f, a, tint, dark) {
  const W = { w: a.w, sill: a.sill, h: a.crown - a.sill, frame: 8 };
  const pts = outline(a.u, a.sill, a.w / 2, W.h, true);
  kit.brick.color(tint, 1.15);
  surround(kit.brick, f, pts.slice(1).concat([pts[0]]).map(([u, v]) => [u, v]), 14, 0, 1.5);
  windowIn(kit, f, a.u, W, true, dark);
  if (!a.grille || kit.tier === 'low') return;
  const { metal } = kit;
  const [u0, u1] = [a.u - a.w / 2 - 6, a.u + a.w / 2 + 6];
  metal.color(IRON);
  for (const v of [a.sill + 4, a.sill + 60]) fbox(metal, f, u0, u1, v, v + 4, 10, 14, 'k');
  for (let k = 0; k <= 6; k++) fbox(metal, f, u0 + ((u1 - u0 - 3) * k) / 6, u0 + ((u1 - u0 - 3) * k) / 6 + 3, a.sill + 4, a.sill + 64, 10, 13, 'k');
  if (kit.tier !== 'low') boxPlants(kit, [0.2, 0.5, 0.8].map((t) => f.at(u0 + (u1 - u0) * t, a.sill + 6, 5)), Math.round(a.u) + 3);
}

// A niche at the floor (n: facades.js): its returns white, a board door filling it set back
// `depth` (one leaf or two, grooves between the boards on high and mid), a handle, a light
// concrete threshold.
function niche(kit, f, n) {
  const { render, paint, metal, granite, tier } = kit;
  const pts = outline(n.u, 0, n.w / 2, n.h, true);
  render.color(0xf0ece4, 0.9);
  lining(render, f, pts, 0, -n.depth);
  door(kit, f, pts, n.u, n.w, n.h, -n.depth, n.tint, n.leaves);
  granite.color(0xb8b4ac);
  fbox(granite, f, n.u - n.w / 2 - 6, n.u + n.w / 2 + 6, 0, 10, -n.depth, 20, 'k');
}

// A board door's leaf over an outline at depth w (`leaves` 1 or 2: a dark seam between them),
// its boards' grooves (not on low), a handle.
function door({ paint, metal, tier }, f, pts, u, w, h, d, tint, leaves = 1) {
  paint.color(tint);
  fan(paint, f, pts, d);
  if (tier !== 'low') {
    paint.color(tint, 0.6);
    const n = Math.round(w / 18);
    for (let k = 1; k < n; k++) {
      const x = u - w / 2 + (w * k) / n;
      const top = Math.min(h, h - w / 2 + Math.sqrt(Math.max(0, (w / 2) ** 2 - (x - u) ** 2)));
      paint.quad(f.at(x - 0.8, 2, d + 0.3), f.at(x + 0.8, 2, d + 0.3), f.at(x + 0.8, top - 2, d + 0.3), f.at(x - 0.8, top - 2, d + 0.3));
    }
  }
  if (leaves === 2) {
    paint.color(tint, 0.35);
    paint.quad(f.at(u - 1.5, 0, d + 0.4), f.at(u + 1.5, 0, d + 0.4), f.at(u + 1.5, h - 2, d + 0.4), f.at(u - 1.5, h - 2, d + 0.4));
  }
  if (tier === 'low') return;
  metal.color(0x9a968e);
  for (const s of leaves === 2 ? [-1, 1] : [1]) fbox(metal, f, u + s * (leaves === 2 ? 14 : w / 2 - 22) - 4, u + s * (leaves === 2 ? 14 : w / 2 - 22) + 4, h * 0.45, h * 0.45 + 22, d, d + 5, 'k');
}

// A plain board door at the floor (d: facades.js) in its dark frame, a vent grille over it.
function boardDoor(kit, f, d, dark) {
  const { paint } = kit;
  const pts = outline(d.u, 0, d.w / 2, d.h, false);
  paint.color(dark);
  surround(paint, f, pts, 8, 0, 2);
  lining(paint, f, pts, 0, -8);
  door(kit, f, pts, d.u, d.w, d.h, -8, d.tint);
  if (!d.vent) return;
  paint.color(0x8a8c8e);
  fbox(paint, f, d.u - 15, d.u + 15, d.h + 22, d.h + 42, 0, 2, 'k');
  paint.color(0x3a3c3e);
  for (let k = 0; k < 4; k++) fbox(paint, f, d.u - 12, d.u + 12, d.h + 25 + k * 4.5, d.h + 27 + k * 4.5, 2, 2.6, 'k');
}

// The garage's opening (g: facades.js): a slim white trim, its white reveal, the sectional door
// set back in it: fine horizontal ribs under the head (on high and mid; four plain sections on
// low), the head's part plain; a black seal at its foot.
function garage(kit, f, g) {
  const { paint, render, tier } = kit;
  const pts = outlineOf(g.u, 0, g.w, g.h, g);
  const D = -22;
  paint.color(WHITE);
  surround(paint, f, pts, 7, 0, 1.5);
  render.color(0xf0ece4, 0.85);
  lining(render, f, pts, 0, D);
  const spring = g.h - (g.rise || g.round || 0);
  const [u0, u1] = [g.u - g.w / 2, g.u + g.w / 2];
  paint.color(g.tint);
  const head = pts.slice(2);
  if (head.length > 2) fan(paint, f, [[u1, spring], ...head.slice(1, -1), [u0, spring]], D);
  const ribs = tier === 'low' ? 4 : Math.round(spring / (tier === 'high' ? 13 : 18));
  for (let k = 0; k < ribs; k++) {
    const [v0, v1] = [(spring * k) / ribs, (spring * (k + 1)) / ribs];
    const lip = tier === 'low' ? 2 : 1.6;
    paint.color(g.tint, 1.08);
    paint.quad(f.at(u0, v0 + lip, D + 1), f.at(u1, v0 + lip, D + 1), f.at(u1, v1, D + 1), f.at(u0, v1, D + 1));
    paint.color(g.tint, 0.55);
    paint.quad(f.at(u0, v0, D + 0.4), f.at(u1, v0, D + 0.4), f.at(u1, v0 + lip, D + 1), f.at(u0, v0 + lip, D + 1));
  }
  paint.color(0x0e0e0e);
  fbox(paint, f, u0, u1, 0, 4, D + 0.5, D + 1.6, 'k');
}

// A white globe lamp on a little dark bracket at (u, v).
function globe({ metal, enamel, tier }, f, u, v) {
  metal.color(0x2a2c2e);
  fbox(metal, f, u - 5, u + 5, v - 6, v + 6, 0, 14, 'k');
  enamel.color(0xf4f2ec);
  if (tier === 'low') return fbox(enamel, f, u - 13, u + 13, v - 9, v + 17, 14, 40, 'k');
  const seg = tier === 'high' ? 10 : 6;
  enamel.ellipsoid(f.at(u, v + 4, 26), f.dir(1, 0, 0), [0, 1, 0], f.dir(0, 0, 1), 15, 15, 15, seg, seg >> 1);
}

// The balcony on a gable (the classic box's place and size: solid, its top walkable): a dark
// slab, posts, a top and a bottom rail and flat balusters in dark-stained wood (photo 17); on low
// its sides panels.
function balcony(kit, f, v0, u = 0) {
  const { paint, tier } = kit;
  const [u0, u1, w1, top] = [u - 300, u + 300, 150, v0 + 100];
  const WOOD = 0x3a2a20;
  paint.color(WOOD, 0.85);
  fbox(paint, f, u0, u1, v0, v0 + 14, 0, w1, 'k');
  paint.color(WOOD);
  fbox(paint, f, u0 - 3, u1 + 3, top - 8, top, -2, w1 + 3, 'k');
  for (const p of [u0, u - 100, u + 100, u1]) fbox(paint, f, p - 5, p + 5, v0 + 14, top - 8, w1 - 10, w1, 'ktb');
  fbox(paint, f, u0, u1, v0 + 20, v0 + 26, w1 - 8, w1 - 2, 'k');
  if (tier === 'low') {
    paint.quad(f.at(u0, v0 + 14, w1 - 5), f.at(u1, v0 + 14, w1 - 5), f.at(u1, top - 8, w1 - 5), f.at(u0, top - 8, w1 - 5));
    return;
  }
  for (let x = u0 + 14; x < u1 - 8; x += 17) fbox(paint, f, x, x + 9, v0 + 26, top - 8, w1 - 7, w1 - 4, 'ktb');
  for (const s of [-1, 1]) {
    const e = s < 0 ? u0 : u1;
    for (let w = 14; w < w1 - 10; w += 17) fbox(paint, f, e - 3, e + 3, v0 + 26, top - 8, w, w + 9, 'tb');
  }
  paint.color(0x2a2a2a);
  paint.quad(f.at(u0, top - 1, w1), f.at(u1, top - 1, w1), f.at(u1, top - 1, 0), f.at(u0, top - 1, 0));
}

// A north villa's walls from its program (facades.js): the openings cut and filled (see the top).
function programmed(kit, L, h, P) {
  const F = frameOf(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const renderTop = (P.render ?? h.render) - y0;
  const dark = P.frame ?? FRAME;
  const tint = h.brick ?? 0xb05a3c;
  const top = h.eave + ROOF.lift - ROOF.fascia - y0;
  const holes = { front: [], back: [], left: [], right: [] };
  const plain = { front: [], back: [], left: [], right: [] };
  const rectHole = (u, w, v0, ht, head = null) => ({ u0: u - w / 2, u1: u + w / 2, v0, v1: v0 + ht, head });
  for (const w of P.windows ?? []) {
    const [u, ww, sill, ht] = Array.isArray(w) ? w : [w, WIN.w, WIN.sill, WIN.h];
    plain.front.push([u, { w: ww, sill, h: ht, frame: WIN.frame }]);
  }
  for (const name of h.sides ?? []) plain[name].push([0, WIN]);
  for (const [name, list] of Object.entries(plain)) for (const [u, W] of list) holes[name].push(rectHole(u, W.w, W.sill, W.h));
  const fr = holes.front;
  const headOf = (u, w, v0, ht, o) => outlineOf(u, v0, w, ht, o).slice(2);
  const { garage: g, oriel: o, arch: a, loggia: l, niche: n, door: d } = P;
  if (g) fr.push(rectHole(g.u, g.w, 0, g.h, g.rise || g.round ? headOf(g.u, g.w, 0, g.h, g) : null));
  if (o) fr.push(rectHole(o.u, o.w - 20, o.v0 + 24, top - 18 - o.v0 - 24));
  if (a) fr.push({ ...rectHole(a.u, a.w, a.sill, a.crown - a.sill), arch: true });
  if (l) fr.push({ ...rectHole(l.u, l.w, l.sill, l.crown - l.sill), arch: true });
  if (n) fr.push({ ...rectHole(n.u, n.w, 0, n.h), arch: true });
  if (d) fr.push(rectHole(d.u, d.w, 0, d.h));
  for (const name of ['front', 'back', 'left', 'right']) {
    const { f, half } = F.face(name);
    const wear = { L, eave: wallH };
    kit.render.color(0xf8f8f4); // (a cool white)
    wall(kit.render, f, -half, half, 0, Math.min(renderTop, wallH), holes[name], wear);
    kit.brick.color(tint);
    wall(kit.brick, f, -half, half, renderTop, wallH, holes[name], wear);
    kit.paint.color(WHITE);
    fbox(kit.paint, f, -half - 2, half + 2, renderTop - 6, renderTop + 6, 0, 2, 'k');
    for (const [u, W] of plain[name]) windowIn(kit, f, u, W, false, dark);
  }
  const f = F.face('front').f;
  if (g) garage(kit, f, g);
  if (o) oriel(kit, f, o, top, dark, tint);
  if (a) archWindow(kit, f, a, tint, dark);
  if (l) loggia(kit, f, l, tint);
  if (n) niche(kit, f, n);
  if (d) boardDoor(kit, f, d, dark);
  for (const [u, v, kind] of P.lamps ?? []) (kind === 'globe' ? globe : lamp)(kit, f, u, v);
  if (h.balcony !== undefined) balcony(kit, F.face('left').f, renderTop + 140, h.balcony);
}

// The west end's villa (no program: rendered to its eaves): its windows over its garage doors
// (those a garage door's frame would cross stand proud), one on each gable.
function westVilla(kit, L, h) {
  const F = frameOf(h);
  const y0 = h.y0 ?? 22;
  const wallH = h.eave - y0;
  const garages = (h.garages ?? []).map((u) => ({ u0: u - 274, u1: u + 274, v1: 264 }));
  const W = { ...WIN, sill: wallH - 230 };
  const faces = { front: [-550, 0, 550], back: [], left: [0], right: [0] };
  const proud = (u) => garages.some((g) => g.u0 < u + W.w / 2 + W.frame && g.u1 > u - W.w / 2 - W.frame && g.v1 > W.sill - W.frame);
  for (const name of ['front', 'back', 'left', 'right']) {
    const { f, half } = F.face(name);
    const us = faces[name];
    const holes = us.filter((u) => !proud(u)).map((u) => ({ u0: u - W.w / 2, u1: u + W.w / 2, v0: W.sill, v1: W.sill + W.h }));
    kit.render.color(0xf8f8f4);
    wall(kit.render, f, -half, half, 0, wallH, holes, { L, eave: wallH });
    for (const u of us) (proud(u) ? proudWindow : windowIn)(kit, f, u, W, false);
  }
}

export function villaHouses(kit, L) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const P = FACADES[h.id];
    if (P) programmed(kit, L, h, P);
    else westVilla(kit, L, h);
  }
}

// The west end's and the double garage's sectional doors (the north villas' are their kit's).
export function garageDoors({ paint, metal }, L) {
  for (const h of L.HOUSES) {
    if (FACADES[h.id]) continue;
    const villa = h.kit === 'villa';
    const doors = villa ? (h.garages ?? []) : h.kit === 'garage' ? h.doors : [];
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

export function hipTrim({ metal, paint, tiles, tier }, L) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const F = frameOf(h);
    const R = hipOf(h);
    const P = FACADES[h.id];
    const at = ([u, y, w]) => F.at(u, y, w);
    const rim = R.rim.map(at);
    const [R0, R1] = [at(R.R0), at(R.R1)];
    const { a, b } = R;
    // The gutters round the rim (each side out from the roof's middle), a downpipe with a swan
    // neck from the gutter back to the wall at each programmed front corner (else both).
    metal.color(P ? ROOF.gutter : 0x2a2c2e);
    const mid = F.at(0, R.Y, 0);
    for (let i = 0; i < 4; i++) {
      const [p, q] = [rim[i], rim[(i + 1) % 4]];
      const e = norm(sub(q, p));
      const c = mul(add(p, q), 0.5);
      const out = norm([c[0] - mid[0], 0, c[2] - mid[2]]);
      const g = (s) => add(add(s, mul(out, 10)), [0, -16, 0]);
      metal.tube(g(sub(p, mul(e, 6))), g(add(q, mul(e, 6))), 9, 9, 6, { a0: 0, arc: Math.PI });
      if (tier !== 'low') metal.tube(g(sub(p, mul(e, 6))), g(add(q, mul(e, 6))), 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true }); // (its inside, not on low)
    }
    const front = R.W1;
    for (const s of P?.pipes ?? [-1, 1]) {
      const wall = F.at(s * (a - 20), 0, b + 7);
      const lo = R.Y - (P ? ROOF.fascia : 0);
      const top = F.at(s * (a - 20), lo - 22, front + 10);
      metal.tube(top, [wall[0], lo - 80, wall[2]], 5, 5, 6);
      metal.tube([wall[0], lo - 80, wall[2]], [wall[0], (h.y0 ?? 22) + 12, wall[2]], 5, 5, 6, { caps: true });
    }
    // The deep front soffit's tongue-and-groove joints (across it, every 30; the east blocks', on
    // high).
    if (P && tier === 'high' && P.garage !== undefined) {
      paint.color(ROOF.board, 0.7);
      const y = R.Y - ROOF.fascia - 0.6;
      for (let u = R.U0 + 30; u < R.U1 - 10; u += 30) {
        const w0 = Math.abs(u) > a ? b + (Math.abs(u) - a) * ((R.W1 - b) / (R.U1 - a)) : b;
        paint.quad(F.at(u + 1.2, y, w0), F.at(u - 1.2, y, w0), F.at(u - 1.2, y, front), F.at(u + 1.2, y, front));
      }
    }
    // The caps: rounded tiles along the hips (from the rim's corners to the ridge's ends) and the
    // ridge.
    tiles.color(h.roof, 0.9);
    const ends = R.along ? [R0, R1, R1, R0] : [R1, R1, R0, R0];
    for (let i = 0; i < 4; i++) tiles.tube(add(rim[i], [0, 3, 0]), add(ends[i], [0, 3, 0]), 11, 11, 6, { a0: Math.PI, arc: Math.PI, caps: true });
    if (Math.hypot(...sub(R0, R1)) > 1) tiles.tube(add(R0, [0, 3, 0]), add(R1, [0, 3, 0]), 13, 13, 8, { a0: Math.PI, arc: Math.PI, caps: true });
  }
}
