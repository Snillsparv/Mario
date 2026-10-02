// Sparrow Lane's props (lane/layout.js LAMPS, FLAGPOLES, BINS, HEDGES, THUJAS, TREES, RED_TREE,
// RHODODENDRON, ROUND_BED, MAILBOX, FENCES, CABINET, PATH_SIGN, FOREST, EDGE_FOREST, SIGNS),
// written into the course's kit (lane/build.js): render faces into its material builders,
// colliders into kit.solids, the signposts into kit.signs.
//
//   buildProps(kit, layout)
//
// Grey lampposts with a bent arm and a flat lamp head; white flagpoles with a gold knob; the two
// wheelie bins against the dad's east gable; hedges (leafy boxes, a soft crown along their tops)
// and thuja columns; the big broad-leaved trees at the junction (lumpy canopies on stout trunks),
// the red-leaf tree in the dad's round bed and the rhododendron at his house's corner; the dad's
// mailbox (a black house-shaped box on a post, a brass slot; it is the welcome sign); the corner
// house's picket and rail fences; by the footpath its grey cabinet, the blue round sign on its
// post and the low barrier across the path; the forest's firs on the bank behind the north
// gardens and a ring of firs round the outside of the boundary (skerries/props.js fir(), drawn
// only); the signposts (props/decor.js addSignpost; a sign with post: false has none).
//
// Colliders: the lampposts' prisms (the climbable two have their pole only, as the flagpoles and
// the red-leaf tree: layout.POLES), the bins, the hedges (boxes, their tops walkable), the thujas
// (steep frustums), the junction trees' trunks, the rhododendron, the round bed, the mailbox (a
// box to its eaves, within the sign's box), the fences and the barrier (slabs), the cabinet and
// the sign's post, the signposts.

import { hexaPolys, localBoxPolys, orientedBoxPolys, prismPolys, wallFrame } from '../castle/geom.js';
import { addSignpost } from '../props/decor.js';
import { makeRng } from '../../core/math.js';
import { fir } from '../skerries/props.js';
import { frame } from './houses.js';

const TINT = {
  lamp: 0x8c9092,
  lampHead: 0x4a4e50,
  flag: 0xf2f2f0,
  gold: 0xe8b84a,
  bin: 0x2c302c,
  hedge: 0x45682c,
  thuja: 0x2f4a24,
  rhodo: 0x34522a,
  canopy: 0x5f8a34,
  redLeaf: 0xb0442c,
  trunk: 0x6a5444,
  redTrunk: 0x4a3428,
  soil: 0x4a3a2c,
  stones: 0xa8a49c,
  mailbox: 0x2a2a2c,
  brass: 0xb08a40,
  post: 0x2a2a2c,
  picket: 0x5a3a2a,
  rail: 0x8a6a4a,
  cabinet: 0x8a8e8a,
  pillar: 0xece8de,
  sign: 0x2a62b8,
  white: 0xf4f4f0,
};
const THUJA_LEAN = 0.09; // the thujas' colliders lean in this much per unit up (walls, not floors)
const FIR_SIZE = { h: [900, 1700], r: [260, 420] };

export function buildProps(kit, layout) {
  for (const l of layout.LAMPS) lamppost(kit, layout, l);
  for (const f of layout.FLAGPOLES) flagpole(kit, layout, f);
  for (const b of layout.BINS) bin(kit, layout, b);
  for (const h of layout.HEDGES) hedge(kit, h);
  for (const t of layout.THUJAS) thuja(kit, layout, t);
  for (const t of layout.TREES) broadTree(kit, layout, t);
  dadsGarden(kit, layout);
  mailbox(kit, layout);
  motorhome(kit, layout);
  for (const f of layout.FENCES) fence(kit, layout, f);
  footpathProps(kit, layout);
  forest(kit, layout);
  for (const sign of layout.SIGNS) if (sign.post !== false) addSignpost(kit.signs, layout, sign);
}

// ---------------------------------------------------------------- street furniture

// A lamppost: a grey eight-sided pole on a wider foot, an arm out along its yaw at the top and a
// flat lamp head; a prism collider unless it is a climbable pole (layout.POLES).
function lamppost(kit, layout, { x, z, yaw }) {
  const { render, solids } = kit;
  const { LAMP, POLES } = layout;
  const y0 = layout.groundHeight(x, z);
  render.color(TINT.lamp);
  render.lathe(x, z, [[LAMP.r + 8, y0 - 10], [LAMP.r + 8, y0 + 60], [LAMP.r, y0 + 80], [LAMP.r - 3, LAMP.top], [0, LAMP.top]], 8, { flat: true });
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const end = [x + ax * LAMP.arm, LAMP.top + 10, z + az * LAMP.arm];
  render.solid(orientedBoxPolys([x + (ax * LAMP.arm) / 2, 0, z + (az * LAMP.arm) / 2], [ax, 0, az], LAMP.arm + 10, LAMP.top - 12, LAMP.top + 4, 10));
  render.color(TINT.lampHead);
  render.solid(orientedBoxPolys([end[0], 0, end[2]], [ax, 0, az], 90, LAMP.top - 24, LAMP.top - 4, 44), { faceShade: (n) => (n[1] < -0.5 ? 1.6 : 1) });
  if (POLES.some((p) => p.x === x && p.z === z)) return;
  solids.solid(prismPolys(x, z, LAMP.collider, 8, y0 - 10, LAMP.top), 'stone');
}

// A white flagpole tapering to a gold knob (a climbable pole: no collider of its own).
function flagpole(kit, layout, { x, z, y0 }) {
  const { render } = kit;
  const { FLAGPOLE: F } = layout;
  const top = y0 + 1200;
  render.color(TINT.flag);
  render.lathe(x, z, [[F.r + 26, y0 - 10], [F.r + 26, y0 + 30], [F.r, y0 + 40], [F.r - 4, top], [0, top]], 8, { flat: true });
  render.color(TINT.gold);
  render.lathe(x, z, [[0, top], [14, top + 6], [16, top + 18], [12, top + 30], [0, top + 34]], 8);
}

// A wheelie bin: a dark body, its lid a little wider on top, two wheels at its back; solid to its
// lid's top.
function bin(kit, layout, { x, z }) {
  const { render, solids } = kit;
  const { BIN, GROUND } = layout;
  const [hx, hz] = [BIN.x / 2, BIN.z / 2];
  render.color(TINT.bin);
  render.box(x - hx, x + hx - 6, GROUND, BIN.top - 10, z - hz + 4, z + hz - 4, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
  render.box(x - hx - 4, x + hx, BIN.top - 10, BIN.top, z - hz, z + hz, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
  render.color(0x111111);
  for (const s of [-1, 1]) render.box(x + hx - 16, x + hx + 6, GROUND, GROUND + 26, z + s * (hz - 18) - 8, z + s * (hz - 18) + 8);
  solids.box(x - hx, x + hx, GROUND, BIN.top, z - hz, z + hz, 'stone');
}

// ---------------------------------------------------------------- greenery

// A hedge: a leafy box, darker toward its foot, a soft crown along its top; solid, its top
// walkable (flat).
function hedge(kit, h) {
  const { leaves, solids } = kit;
  const { x0, x1, z0, z1, y0, top } = h;
  leaves.color(TINT.hedge);
  leaves.shade = (x, y) => 0.75 + 0.25 * Math.min(1, (y - y0) / Math.max(1, top - y0));
  leaves.box(x0, x1, y0 - 4, top, z0, z1, { bottom: false, top: false });
  leaves.shade = null;
  const crown = 16;
  const alongX = x1 - x0 >= z1 - z0;
  const mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  leaves.color(TINT.hedge, 1.08);
  if (alongX) {
    leaves.poly([[x0, top, z0], [x1, top, z0], [x1, top + crown, mid], [x0, top + crown, mid]], { facing: [0, 1, -0.3] });
    leaves.poly([[x0, top + crown, mid], [x1, top + crown, mid], [x1, top, z1], [x0, top, z1]], { facing: [0, 1, 0.3] });
    for (const x of [x0, x1]) leaves.poly([[x, top, z0], [x, top, z1], [x, top + crown, mid]], { facing: [x === x0 ? -1 : 1, 0, 0] });
  } else {
    leaves.poly([[x0, top, z0], [mid, top + crown, z0], [mid, top + crown, z1], [x0, top, z1]], { facing: [-0.3, 1, 0] });
    leaves.poly([[mid, top + crown, z0], [x1, top, z0], [x1, top, z1], [mid, top + crown, z1]], { facing: [0.3, 1, 0] });
    for (const z of [z0, z1]) leaves.poly([[x0, top, z], [x1, top, z], [mid, top + crown, z]], { facing: [0, 0, z === z0 ? -1 : 1] });
  }
  solids.box(x0, x1, y0 - 4, top, z0, z1, 'grass');
}

// A thuja: a dark green eight-sided column tapering to a point; its collider a steep frustum
// (its sides walls, its small top out of reach).
function thuja(kit, layout, { x, z }) {
  const { leaves, solids } = kit;
  const { r, h } = layout.THUJA;
  const y0 = layout.groundHeight(x, z);
  leaves.color(TINT.thuja);
  leaves.shade = (px, y) => 0.78 + 0.26 * Math.min(1, (y - y0) / h);
  leaves.lathe(x, z, [[r * 0.8, y0 - 6], [r, y0 + h * 0.3], [r * 0.82, y0 + h * 0.7], [r * 0.3, y0 + h * 0.94], [0, y0 + h]], 8, { a0: x * 0.01 });
  leaves.shade = null;
  solids.solid(frustum(x, z, r * 0.85, r * 0.85 - h * 0.85 * THUJA_LEAN, 8, y0 - 6, y0 + h * 0.85), 'grass');
}

// A closed regular frustum round (cx, cz): radius r0 at y0 up to r1 at y1, a flat top.
function frustum(cx, cz, r0, r1, sides, y0, y1) {
  const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
  const lo = ring(r0, y0);
  const hi = ring(r1, y1);
  return [hi, ...lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]])];
}

// A lumpy canopy: `n` overlapping blobs (seven-sided lathes, roughly round) round (x, z) between
// y0 and y1, out to r, into `leaves` (the leaf texture's greens; a red one goes into render's
// plain white, as the green texture would darken it to brown); darker underneath.
function canopy(kit, x, z, y0, y1, r, tint, seed, n = 4, leaves = kit.leaves) {
  const rng = makeRng(seed);
  const h = y1 - y0;
  leaves.shade = (px, y) => 0.68 + 0.36 * Math.min(1, Math.max(0, (y - y0) / h));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const off = i === 0 ? 0 : r * (0.35 + rng() * 0.2);
    const bx = x + Math.sin(a) * off;
    const bz = z + Math.cos(a) * off;
    const br = i === 0 ? r * 0.62 : r * (0.45 + rng() * 0.15);
    const cy = i === 0 ? y0 + h * 0.5 : y0 + h * (0.35 + rng() * 0.3);
    const ry = i === 0 ? h * 0.5 : h * (0.32 + rng() * 0.1);
    const prof = [[0, cy - ry], [br * 0.72, cy - ry * 0.68], [br, cy - ry * 0.05], [br * 0.8, cy + ry * 0.6], [br * 0.35, cy + ry * 0.95], [0, cy + ry]];
    leaves.color(tint, 0.9 + rng() * 0.2);
    leaves.lathe(bx, bz, prof, 7, { a0: rng() * 6 });
  }
  leaves.shade = null;
}

// A big broad-leaved tree at the junction: a stout trunk (solid) under a lumpy canopy.
function broadTree(kit, layout, t) {
  const { wood, solids } = kit;
  const y0 = layout.groundHeight(t.x, t.z);
  const trunkTop = y0 + t.h * 0.45;
  wood.color(TINT.trunk);
  wood.lathe(t.x, t.z, [[60, y0 - 10], [45, y0 + 120], [38, trunkTop], [0, trunkTop]], 7, { flat: true });
  canopy(kit, t.x, t.z, y0 + t.h * 0.32, y0 + t.h, t.r, TINT.canopy, Math.round(t.x * 7 + t.z));
  solids.solid(prismPolys(t.x, t.z, 45, 8, y0 - 10, trunkTop), 'wood');
}

// The dad's front garden: the round bed (dark soil in a ring of grey stones, a step up), the
// red-leaf tree in it (a climbable pole: its trunk drawn, its canopy of red-brown leaves over it,
// no collider), the rhododendron at the house's west corner (a dark green dome, solid).
function dadsGarden(kit, layout) {
  const { leaves, wood, blocks, cobbles, solids } = kit;
  const { ROUND_BED: B, RED_TREE: T, RHODODENDRON: R, GROUND } = layout;
  const bedTop = GROUND + 14;
  cobbles.color(TINT.soil);
  cobbles.lathe(B.x, B.z, [[B.r - 20, bedTop], [0, bedTop]], 12, { vMode: 'plan' });
  blocks.color(TINT.stones);
  blocks.lathe(B.x, B.z, [[B.r + 8, GROUND - 2], [B.r + 6, bedTop + 6], [B.r - 6, bedTop + 16], [B.r - 22, bedTop + 8], [B.r - 26, bedTop - 2]], 12, { flat: true });
  solids.solid(prismPolys(B.x, B.z, B.r, 12, GROUND - 10, bedTop), 'grass');
  wood.color(TINT.redTrunk);
  wood.lathe(T.x, T.z, [[T.radius + 6, bedTop - 4], [T.radius, bedTop + 60], [T.radius - 8, T.trunkTop], [0, T.trunkTop + 40]], 7, { flat: true });
  canopy(kit, T.x, T.z, T.canopy.y0, T.canopy.y1, T.canopy.r, TINT.redLeaf, 23, 6, kit.render);
  leaves.color(TINT.rhodo);
  leaves.shade = (x, y) => 0.7 + 0.3 * Math.min(1, (y - GROUND) / R.h);
  leaves.lathe(R.x, R.z, [[R.r * 0.85, GROUND - 6], [R.r, GROUND + R.h * 0.35], [R.r * 0.8, GROUND + R.h * 0.8], [R.r * 0.3, GROUND + R.h], [0, GROUND + R.h + 6]], 8, { a0: 0.3 });
  leaves.shade = null;
  solids.solid(prismPolys(R.x, R.z, R.r * 0.85, 8, GROUND - 6, GROUND + R.h * 0.85), 'grass');
}

// ---------------------------------------------------------------- mailbox, motorhome, fences

// The dad's mailbox: a black wooden box shaped like a little house (its gable end, with a brass
// slot, toward the street) on a black post; solid to its eaves (a coin waits over its roof).
function mailbox(kit, layout) {
  const { render, solids } = kit;
  const { MAILBOX: M, GROUND } = layout;
  const [bw, bd, bh] = M.body;
  const f = frame({ cx: M.x, cz: M.z, yaw: M.yaw, w: bw, d: bd, y0: GROUND });
  const y1 = GROUND + M.post;
  render.color(TINT.post);
  render.solid(localBoxPolys(wallFrame(f.at(0, GROUND, 0), f.dir(0, 0, 1)), -7, 7, 0, M.post, -7, 7, { bottom: false }));
  render.color(TINT.mailbox);
  const box = [f.at(-bw / 2, 0, bd / 2), f.at(bw / 2, 0, bd / 2), f.at(bw / 2, 0, -bd / 2), f.at(-bw / 2, 0, -bd / 2)];
  const at = (p, y) => [p[0], y, p[2]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const out = [box[i][0] + box[j][0] - 2 * M.x, 0, box[i][2] + box[j][2] - 2 * M.z];
    render.poly([at(box[i], y1), at(box[j], y1), at(box[j], M.eaves), at(box[i], M.eaves)], { facing: out, shade: i === 0 ? 1 : 0.85 });
  }
  render.poly(box.map((p) => at(p, y1)), { facing: [0, -1, 0], shade: 0.5 });
  // The roof: its ridge running from the street end to the back, the gable ends black too.
  const r0 = f.at(0, M.ridge, bd / 2 + 8);
  const r1 = f.at(0, M.ridge, -bd / 2 - 8);
  const e = (u, w) => f.at(u, M.eaves - 4, w);
  for (const s of [-1, 1]) render.poly([e(s * (bw / 2 + 8), bd / 2 + 8), e(s * (bw / 2 + 8), -bd / 2 - 8), r1, r0], { facing: f.dir(s, 1.7, 0), shade: 0.9 });
  for (const s of [-1, 1]) render.poly([f.at(-bw / 2, M.eaves, (s * bd) / 2), f.at(bw / 2, M.eaves, (s * bd) / 2), f.at(0, M.ridge - 4, (s * bd) / 2)], { facing: f.dir(0, 0, s) });
  render.color(TINT.brass);
  const slot = wallFrame(f.at(0, y1, bd / 2), f.dir(0, 0, 1));
  render.panel(slot, [[-28, 80], [28, 80], [28, 92], [-28, 92]], 1);
  solids.solid([box.map((p) => at(p, M.eaves)), ...box.map((p, i) => [at(p, GROUND), at(box[(i + 1) % 4], GROUND), at(box[(i + 1) % 4], M.eaves), at(p, M.eaves)])], 'wood');
}

// The motorhome on the north-west villa's drive: a white box (its cab end toward the junction)
// with a dark window band round it, on four dark wheels; solid from the ground to its roof (a
// coin spot).
function motorhome(kit, layout) {
  const { render, solids } = kit;
  const { MOTORHOME: M, GROUND } = layout;
  const f = frame({ cx: M.cx, cz: M.cz, yaw: M.yaw, w: M.l, d: M.w });
  const top = GROUND + M.h;
  const [hl, hw] = [M.l / 2, M.w / 2];
  const box = (u0, u1, y0, y1, w0, w1) => hexaPolys([f.at(u0, y0, w0), f.at(u1, y0, w0), f.at(u1, y0, w1), f.at(u0, y0, w1), f.at(u0, y1, w0), f.at(u1, y1, w0), f.at(u1, y1, w1), f.at(u0, y1, w1)]);
  render.color(TINT.white);
  render.solid(box(-hl, hl, GROUND + 45, top, -hw, hw), { faceShade: (n) => (n[1] > 0.5 ? 1.05 : n[1] < -0.5 ? 0.5 : 0.95) });
  render.color(0x2c3238);
  render.solid(box(-hl - 2, hl + 2, top - 190, top - 120, -hw - 2, hw + 2), { faceShade: (n) => (Math.abs(n[1]) > 0.5 ? 0 : 1) });
  render.color(0x111111);
  for (const u of [-hl + 140, hl - 160]) for (const w of [-hw + 10, hw - 10]) render.solid(box(u - 45, u + 45, GROUND, GROUND + 90, w - 18, w + 18));
  solids.solid(box(-hl, hl, GROUND - 5, top, -hw, hw).slice(1), 'stone'); // (no bottom: hexaPolys's first)
}

// A fence along [from, to] (in its house's frame): a picket fence (pales on two rails, posts) or a
// two-rail fence on posts; its collider a slab as high.
function fence(kit, layout, { house, kind, from, to, h }) {
  const { boards, solids } = kit;
  const H = layout.HOUSES.find((o) => o.id === house);
  const F = frame(H);
  const y0 = layout.GROUND;
  const a = F.at(from[0], 0, from[1]);
  const b = F.at(to[0], 0, to[1]);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const d = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
  const mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  const along = (t) => [a[0] + d[0] * t, 0, a[2] + d[2] * t];
  boards.color(kind === 'picket' ? TINT.picket : TINT.rail);
  for (const y of kind === 'picket' ? [y0 + 25, y0 + h - 35] : [y0 + 30, y0 + h - 14]) boards.solid(orientedBoxPolys(mid, d, len, y, y + 12, 8));
  for (let t = 0; t <= len; t += 200) boards.solid(orientedBoxPolys(along(t), d, 12, y0 - 5, y0 + h, 12));
  if (kind === 'picket') {
    // The pales: pointed boards either side of the rails.
    const n = [-d[2], 0, d[0]];
    const P = (p, du, y, s) => [p[0] + d[0] * du + n[0] * s, y, p[2] + d[2] * du + n[2] * s];
    for (let t = 9; t < len; t += 18) {
      const p = along(t);
      for (const s of [-5, 5]) {
        boards.poly([P(p, -4, y0 + 2, s), P(p, 4, y0 + 2, s), P(p, 4, y0 + h - 8, s), P(p, 0, y0 + h, s), P(p, -4, y0 + h - 8, s)], { facing: [n[0] * s, 0, n[2] * s], shade: s > 0 ? 1 : 0.85 });
      }
    }
  }
  solids.solid(orientedBoxPolys(mid, d, len, y0 - 5, y0 + h, 20, { bottom: false }), 'wood');
}

// By the footpath: the grey electrical cabinet on a white brick pillar, the blue round sign on its
// grey post (its white figure comes later) and the low two-rail barrier across the path where the
// play space ends.
function footpathProps(kit, layout) {
  const { render, brick, boards, solids } = kit;
  const { CABINET: C, PATH_SIGN: S, FOOTPATH: P, GROUND, footpathAt } = layout;
  // The cabinet stands on the path's west side, its doors toward the path.
  const cf = frame({ cx: C.x, cz: C.z, yaw: Math.atan2(P.dir[1], -P.dir[0]), w: 80, d: 40, y0: GROUND });
  const box = (u0, u1, y0, y1, w0, w1) => [cf.at(u0, y0, w0), cf.at(u1, y0, w0), cf.at(u1, y0, w1), cf.at(u0, y0, w1), cf.at(u0, y1, w0), cf.at(u1, y1, w0), cf.at(u1, y1, w1), cf.at(u0, y1, w1)];
  const hexa = (c) => hexaPolys(c);
  brick.color(TINT.pillar);
  brick.solid(hexa(box(-50, 50, GROUND - 5, GROUND + 60, -26, 26)));
  render.color(TINT.cabinet);
  render.solid(hexa(box(-40, 40, GROUND + 60, GROUND + 200, -20, 20)), { faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
  solids.solid(hexa(box(-50, 50, GROUND - 5, GROUND + 200, -26, 26)).slice(1), 'stone');
  // The sign: a grey post, a blue disc facing back up the path.
  render.color(TINT.lamp);
  render.lathe(S.x, S.z, [[7, GROUND - 5], [6, GROUND + 230], [0, GROUND + 232]], 6, { flat: true });
  const sf = wallFrame([S.x, GROUND + 200, S.z], [-P.dir[0], 0, -P.dir[1]]);
  const disc = Array.from({ length: 12 }, (_, i) => {
    const a = Math.PI / 2 - (i / 12) * Math.PI * 2;
    return [Math.cos(a) * 45, Math.sin(a) * 45];
  });
  render.color(TINT.white);
  render.panel(sf, disc.map(([u, v]) => [u * 1.12, v * 1.12]), 8);
  render.color(TINT.sign);
  render.panel(sf, disc, 9);
  solids.solid(prismPolys(S.x, S.z, 15, 6, GROUND - 5, GROUND + 232), 'stone');
  // The barrier: two rails across the path on three posts.
  const t = P.barrier;
  const a = footpathAt(t, P.half + 40);
  const b = footpathAt(t, -P.half - 40);
  const d = [b.x - a.x, 0, b.z - a.z];
  const len = Math.hypot(d[0], d[2]);
  const mid = [(a.x + b.x) / 2, 0, (a.z + b.z) / 2];
  boards.color(TINT.rail);
  for (const y of [GROUND + 40, GROUND + 80]) boards.solid(orientedBoxPolys(mid, d, len, y, y + 14, 10));
  for (const k of [0, 0.5, 1]) boards.solid(orientedBoxPolys([a.x + d[0] * k, 0, a.z + d[2] * k], d, 14, GROUND - 5, GROUND + 100, 14));
  solids.solid(orientedBoxPolys(mid, d, len, GROUND - 5, GROUND + 100, 24, { bottom: false }), 'wood');
}

// ---------------------------------------------------------------- the forest

// The forest on the bank behind the north gardens (a seeded scatter over FOREST's band) and a
// ring of firs round the outside of the boundary (EDGE_FOREST: each a seeded way out from a
// seeded point on one of its edges, kept off the road drawn on past it), all drawn only: the
// boundary's walls stand inside them.
function forest(kit, layout) {
  const { FOREST: F, EDGE_FOREST: E, BOUNDS } = layout;
  const rng = makeRng(F.seed);
  const tree = (x, z, r) => {
    const h = FIR_SIZE.h[0] + r() * (FIR_SIZE.h[1] - FIR_SIZE.h[0]);
    const rad = FIR_SIZE.r[0] + r() * (FIR_SIZE.r[1] - FIR_SIZE.r[0]);
    fir(kit, x, z, layout.groundHeight(x, z) - 10, h, rad, { a0: r(), solid: false });
  };
  for (let i = 0; i < F.count; i++) tree(F.x0 + rng() * (F.x1 - F.x0), F.z0 + rng() * (F.z1 - F.z0), rng);
  const er = makeRng(E.seed);
  const edges = BOUNDS.map((p, i) => [p, BOUNDS[(i + 1) % BOUNDS.length]]);
  const lengths = edges.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const total = lengths.reduce((s, l) => s + l, 0);
  for (let i = 0, tries = 0; i < E.count && tries < E.count * 6; tries++) {
    let pick = er() * total;
    let k = 0;
    while (pick > lengths[k]) pick -= lengths[k++];
    const [p, q] = edges[k];
    const t = pick / lengths[k];
    const out = E.from + er() * (E.to - E.from);
    // The edge's outward normal (the polygon runs clockwise seen from above: out is its left).
    const nx = (q[1] - p[1]) / lengths[k];
    const nz = -(q[0] - p[0]) / lengths[k];
    const x = p[0] + (q[0] - p[0]) * t + nx * out;
    const z = p[1] + (q[1] - p[1]) * t + nz * out;
    if (layout.inBounds(x, z) || layout.roadDistance(x, z, layout.ROAD_DRAWN) < layout.ROAD.half + 300 || (x > F.x0 && z < F.z0)) continue;
    tree(x, z, er);
    i++;
  }
}
