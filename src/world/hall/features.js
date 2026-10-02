// The Great Hall's features (hall/layout.js), written into the hall's kit (hall/hall.js) after
// its shell (hall/shell.js): what stands on and against the walls, and out in the room.
//
//   features(kit, layout)          kit.leaves set (the front door's, for assemble())
//
// South wall: the inside of the castle's front door (castle/building.js door(), the same door
// the grounds see: its collider fills the surround, so the face stands at FRONT_DOOR.faceZ; its
// leaves swing into the wall onto a dark passage, through the opening the wall's dado leaves
// for it) in a portal: a marble archivolt in voussoirs, a gold bead and keystone, on round
// rose-marble pilasters (half columns: marble bases, gold capitals); over it the stained-glass
// rose window, a crimson banner either side. West wall, beside the arrival: the chimney breast
// (a cream marble pier, its front corners round, teal panels up its face either side of Jonas's
// pi crest) with the arched hearth in it (fire-lit reveals, an ember-glow back, round logs on
// glowing embers and seven tongues of flame; a rose-marble bullnose round the arch, a gilt
// keystone) and a bullnose mantel shelf (its top, with the 1-up), a plaster hood over it up to
// the ceiling; the wall-kick slot north of it; the buttress, a marble pedestal (round corners,
// a teal panel, a gold cap); the brass banner pole in front of it. East wall: two doors still
// being built (door()) in teal niches with cream architraves and gold beads (the piers solid),
// a plaque over each (a snowflake, a cog), a ship's wheel between them. Out in the room: the
// round oak chart table with a chart of the first course on it; the rugs and inlays on the
// floor (the compass rose under the table, the half-round hearth rug, mats before the doors,
// the apron round the dais's foot: hall-paint, flat, drawn only); three gold candle rings on
// the axis.
//
// Nothing drawn only stands more than 56 out of the wall behind it (the camera keeps 60 off
// the walls): deeper parts have colliders.

import { archContour, beamPolys, circleContour, contourPath, localBoxPolys, openingPolys, prismPolys, sweep, wallFrame } from '../castle/geom.js';
import { door } from '../castle/building.js';
import { roundWindow } from '../castle/parts.js';
import { vaultY } from './shell.js';

const TINT = {
  cream: 0xf0e6d2, // the trims, on the pale marble
  rose: 0xe3a08e, // rose marble (pilaster shafts, the hearth's surround)
  band: 0xc4745e, // the dais's apron (as the floor's border)
  gold: 0xe8b84a,
  teal: 0x2f6f6a,
  falu: 0xa8322a,
  panel: 0xffffff, // the dado (its texture is the panel)
  plaster: 0xfff0d6,
  oak: 0x8a6446,
  iron: 0x3a3634,
  hearth: 0xd08a5a,
  log: 0x7a5236, // bark
  embers: 0xd0581c, // the hearth's back, glowing
  ember: 0xff6a20,
  flames: [0xff7a22, 0xffa83a, 0xfff0a0], // outer, middle, core
  wax: 0xf2e6c8,
  crest: 0xc8202a,
  white: 0xf8f4ea,
  cream2: 0xf4e8cc, // the mats' cream ring
  parchment: 0xe8dcb4,
  chartSea: 0x9cc4cc,
  chartLand: 0xd9a58f,
  chartMeadow: 0x9cc480,
  ink: 0x5a3a2a,
  plaques: { snowflake: 0x3a6ab0, cog: 0x9a6a3a },
  // The compass rose's points: [lit half, dark half] (north, the other long points, the short).
  compass: { north: [0xd8483a, 0xa02a24], long: [0xf6ecd4, 0xd8c8a2], short: [0xf0c860, 0xc89a3a] },
};

// The front portal (layout PORTAL): the archivolt from `from` to `to` out of the door's opening
// (beyond door()'s own surround), `depth` deep; the gold bead outside it; the keystone; the
// pilasters' profiles ([r, v]: base, shaft, capital, round over 180 degrees) and shading.
const ARCHIVOLT = { from: 70, to: 190, depth: 50, bead: 20, beadDepth: 40, voussoirs: [1.03, 0.94], key: { half: 50, from: 150, to: 230, depth: 56 } };
const PILASTER = {
  base: [[76, 0], [76, 40], [72, 54], [74, 72], [70, 92], [70, 104]],
  shaft: [[70, 104], [66, 350]],
  capital: [[66, 350], [70, 360], [74, 386], [76, 402], [76, 410], [76, 410], [0, 410]],
  sides: 12,
  shade: [0.5, 0.5], // a + b cos(the angle off the room): round
};
const BANNER = { width: 300, pleats: 6, point: 150 };
// The fireplace: the hearth's depth; the surround's bullnose (out of the face, out from the
// arch); the keystone; the mantel shelf's profile; the panels either side of the crest; the
// fire's logs ([x from the back, y]) and flames.
const HEARTH = { depth: 140, surround: [44, 90], key: { half: 40, from: -6, to: 100, depth: 52 } };
const MANTEL = [[0, 1610], [28, 1622], [46, 1645], [50, 1668], [42, 1688], [24, 1698], [0, 1700]];
const SKIRTING = [[30, 0], [30, 100], [34, 118], [30, 136], [16, 152], [0, 160]]; // (as the walls')
const BREAST_PANELS = { u: [210, 440], v: [800, 1560] };
const LOGS = { size: 44, sides: 8, at: [[20, 4], [70, 4], [44, 46]], clear: 110 };
const FLAMES = { heights: [210, 290, 250, 340, 260, 300, 220], spacing: 78, foot: 24, back: 60, layers: [[96, 1, 0], [64, 0.74, 4], [34, 0.46, 8]] };
const BUTTRESS_TRIM = { round: 90, cap: [[0, 1600], [20, 1610], [34, 1630], [36, 1660], [26, 1690], [0, 1700]], panel: [230, 1520], panelInset: 20 };
const POLE_PROFILE = [[0, 0], [86, 0], [86, 0], [86, 14], [72, 30], [52, 40], [36, 56], [30, 70], [27, 1526], [36, 1536], [32, 1546], [0, 1550]];
// The east doors' surrounds out from their openings (the niche to the architrave, the
// architrave to its bead), springing 40 over the door's own arch.
const EAST = { niche: 150, architrave: 210, bead: 226, beadDepth: 40, raise: 40 };
const WHEEL_PARTS = { rim: 40, rimDepth: 40, hub: [50, 80], hubDepth: 50, spoke: 22, spokeTo: 70, handle: [40, 90], handleSize: 30, at: 30, spokes: 8 };
const PLAQUE = { gold: 96, field: 82 };
// Each kind of rug's rings, outside in ([from, to] in from its rim, to null: on in to `inner`),
// and the compass rose's star (its long and short points' [length, half-width], its height).
const RUG = {
  compass: { rings: [[0, 30, 'gold'], [30, 100, 'falu'], [100, 116, 'gold'], [116, null, 'teal']], inner: 0, sides: 32 },
  hearth: { rings: [[0, 28, 'gold'], [28, 110, 'falu'], [110, 126, 'gold'], [126, null, 'falu']], inner: 300, sides: 16 }, // (the hearthstone inside)
  mat: { rings: [[0, 24, 'gold'], [24, 100, 'teal'], [100, 120, 'cream2'], [120, null, 'teal']], inner: 0, sides: 16 },
};
const COMPASS = { long: [600, 90], short: [440, 60], star: 3 };
const CANDLE_RING = { sides: 24, baluster: 10, rod: 8, chain: 8, chains: 3 }; // every chains-th candle hangs a chain

export function features(kit, L) {
  southWall(kit, L);
  fireplace(kit, L);
  buttress(kit, L);
  eastWall(kit, L);
  chartTable(kit, L);
  rugs(kit, L);
  chandeliers(kit, L);
}

// ---------------------------------------------------------------- south wall

function southWall(kit, { FRONT_DOOR: D, PORTAL, ROSE_WINDOW, BANNERS }) {
  const { trim, paint } = kit;
  const frame = wallFrame([D.x, 0, D.wallZ], [0, 0, -1]);
  kit.leaves = door(kit, frame, D.width, D.height, { passage: kit.wood, segs: 16 });
  const hw = D.width / 2;
  const spring = D.height - hw;
  const A = ARCHIVOLT;
  trim.color(TINT.cream);
  const inner = archContour(hw + A.from, spring, 16);
  const voussoirs = inner.slice(1).map((_, i) => A.voussoirs[i % 2]);
  trim.moulding(frame, inner, archContour(hw + A.to, spring, 16), A.depth, { w0: -4, revealShade: 0.6, frontShade: voussoirs });
  paint.color(TINT.gold);
  paint.moulding(frame, archContour(hw + A.to, spring, 16), archContour(hw + A.to + A.bead, spring, 16), A.beadDepth, { w0: -4, revealShade: 0.7 });
  paint.solid(localBoxPolys(frame, -A.key.half, A.key.half, D.height + A.key.from, D.height + A.key.to, -4, A.key.depth), { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
  // The pilasters: half columns, their axis sunk into the wall, shaded round (brightest facing
  // the room, darker toward the wall: the bake alone lights their facets about alike).
  const [ox, , oz] = frame.out;
  const half = { a0: Math.atan2(ox, oz) - Math.PI / 2, arc: Math.PI, smoothProfile: true };
  for (const s of [-1, 1]) {
    const [cx, , cz] = frame.at(s * PORTAL.pilasterU, 0, -PORTAL.sink);
    const round = (px, py, pz) => PILASTER.shade[0] + (PILASTER.shade[1] * ((px - cx) * ox + (pz - cz) * oz)) / (Math.hypot(px - cx, pz - cz) || 1);
    trim.shade = round;
    paint.shade = round;
    trim.color(TINT.cream);
    trim.lathe(cx, cz, PILASTER.base, PILASTER.sides, half);
    trim.color(TINT.rose);
    trim.glow = 1; // the shaft's sheen weight (hall.js)
    trim.lathe(cx, cz, PILASTER.shaft, PILASTER.sides, half);
    trim.glow = 0;
    paint.color(TINT.gold);
    paint.lathe(cx, cz, PILASTER.capital, PILASTER.sides, half);
  }
  trim.shade = null;
  paint.shade = null;
  roundWindow(kit, frame, ROSE_WINDOW.y, ROSE_WINDOW.r, { glass: true, segs: 24 });
  for (const x of BANNERS.xs) banner(kit, wallFrame([x, 0, D.wallZ], [0, 0, -1]), BANNERS.top, BANNERS.bottom);
}

// A banner hanging from an iron rod just off a wall: the cloth in gentle pleats, its foot cut
// to a point (the whole banner texture across it).
function banner(kit, frame, top, bottom) {
  const { cloth, wood, paint } = kit;
  const { width, pleats, point } = BANNER;
  const hw = width / 2;
  const foot = (u) => bottom + point * (Math.abs(u) / hw);
  cloth.color(0xffffff);
  for (let c = 0; c < pleats; c++) {
    const u0 = -hw + (width * c) / pleats;
    const u1 = -hw + (width * (c + 1)) / pleats;
    const w0 = 22 + (c % 2) * 12;
    const w1 = 22 + ((c + 1) % 2) * 12;
    const v = (u, y) => [(u + hw) / width, (y - bottom) / (top - bottom)];
    cloth.poly([frame.at(u0, foot(u0), w0), frame.at(u1, foot(u1), w1), frame.at(u1, top, w1), frame.at(u0, top, w0)], {
      facing: frame.out,
      uvs: [v(u0, foot(u0)), v(u1, foot(u1)), v(u1, top), v(u0, top)],
      shade: c % 2 ? 0.86 : 1,
    });
  }
  wood.color(TINT.iron);
  wood.solid(localBoxPolys(frame, -hw - 40, hw + 40, top, top + 16, 14, 34));
  paint.color(TINT.gold);
  for (const u of [-hw - 52, hw + 52]) paint.solid(localBoxPolys(frame, u - 12, u + 12, top - 4, top + 20, 12, 36));
}

// ---------------------------------------------------------------- west wall

// The outline of a pier against the west wall (x0..x1 by z0..z1, its two corners in the room
// rounded to radius rc, `segs` segments each) as a sweep path, from the wall at z0 round to the
// wall at z1: n outward, b up.
function pierPath(x0, x1, z0, z1, rc, segs = 4) {
  const P = (x, z, nx, nz) => ({ p: [x, 0, z], n: [nx, 0, nz], b: [0, 1, 0] });
  const path = [P(x0, z0, 0, -1), P(x1 - rc, z0, 0, -1)];
  for (let k = 1; k < segs; k++) {
    const a = Math.PI - (k / segs) * (Math.PI / 2);
    path.push(P(x1 - rc + Math.sin(a) * rc, z0 + rc + Math.cos(a) * rc, Math.sin(a), Math.cos(a)));
  }
  path.push(P(x1, z0 + rc, 1, 0), P(x1, z1 - rc, 1, 0));
  for (let k = 1; k < segs; k++) {
    const a = Math.PI / 2 - (k / segs) * (Math.PI / 2);
    path.push(P(x1 - rc + Math.sin(a) * rc, z1 - rc + Math.cos(a) * rc, Math.sin(a), Math.cos(a)));
  }
  path.push(P(x1 - rc, z1, 0, 1), P(x0, z1, 0, 1));
  return path;
}

// A pier's faces: its two sides along z0 and z1, its front, its rounded corners, its flat top
// with the rounded outline; `front(u0, u1)` draws the front (z from z0 + rc to z1 - rc).
function pier(builder, x0, x1, z0, z1, top, rc, front) {
  builder.poly([[x0, 0, z0], [x1 - rc, 0, z0], [x1 - rc, top, z0], [x0, top, z0]], { facing: [0, 0, -1] });
  builder.poly([[x0, 0, z1], [x1 - rc, 0, z1], [x1 - rc, top, z1], [x0, top, z1]], { facing: [0, 0, 1] });
  builder.lathe(x1 - rc, z0 + rc, [[rc, 0], [rc, top]], 4, { a0: Math.PI / 2, arc: Math.PI / 2 });
  builder.lathe(x1 - rc, z1 - rc, [[rc, 0], [rc, top]], 4, { a0: 0, arc: Math.PI / 2 });
  front();
  builder.poly(pierPath(x0, x1, z0, z1, rc).map(({ p }) => [p[0], top, p[2]]), { facing: [0, 1, 0] });
}

function fireplace(kit, L) {
  const { trim, paint, glow, wall, dado, solids } = kit;
  const { CHIMNEY: C, CREST: CR, HOOD } = L;
  const { x0, x1, z0, z1, top, rc } = C;
  const hz = C.hearth.z;
  const hw = C.hearth.width / 2;
  const hh = C.hearth.height;
  const spring = hh - hw;
  const frame = wallFrame([x1, 0, hz], [1, 0, 0]); // u toward -z
  const uOf = (z) => hz - z;
  const arch = archContour(hw, spring, 16);
  // The breast: a cream marble pier, darker at its foot, the arched hearth cut from its face.
  trim.color(TINT.cream);
  trim.shade = (px, py) => 0.82 + 0.18 * Math.min(1, py / 400);
  pier(trim, x0, x1, z0, z1, top, rc, () => {
    for (const p of openingPolys(frame, uOf(z1 - rc), uOf(z0 + rc), 0, top, arch)) trim.poly(p, { facing: [1, 0, 0] });
  });
  trim.shade = null;
  solids.box(x0, x1, 0, top, z0, z1, 'stone');
  // Teal raised panels up its face either side of the crest.
  dado.color(TINT.panel);
  const [pu0, pu1] = BREAST_PANELS.u;
  const [pv0, pv1] = BREAST_PANELS.v;
  for (const s of [-1, 1]) {
    const [ua, ub] = s < 0 ? [-pu1, -pu0] : [pu0, pu1]; // left to right, seen from the room
    dado.panel(frame, [[ua, pv0], [ub, pv0], [ub, pv1], [ua, pv1]], 3, { uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
  // The hearth: its reveals lit warm by the fire from below; its back glowing from the embers
  // up into soot (full-bright, steady), in rows so the glow grades up it.
  const D = HEARTH.depth;
  trim.color(TINT.hearth);
  trim.shade = (px, py) => 1.25 - 0.85 * Math.min(1, py / hh);
  for (let k = 0; k + 1 < arch.length; k++) {
    const [ua, va] = arch[k];
    const [ub, vb] = arch[k + 1];
    trim.poly([frame.at(ua, va, 0), frame.at(ub, vb, 0), frame.at(ub, vb, -D), frame.at(ua, va, -D)], { facing: frame.dir(vb - va, -(ub - ua), 0) });
  }
  trim.shade = null;
  glow.color(TINT.embers);
  glow.glow = 0;
  const backShade = (v) => Math.max(0.12, 1 - v / (hh * 0.75));
  const rows = [0, spring / 3, (2 * spring) / 3, spring];
  for (let r = 0; r + 1 < rows.length; r++) {
    const [va, vb] = [rows[r], rows[r + 1]];
    glow.panel(frame, [[-hw, va], [hw, va], [hw, vb], [-hw, vb]], -D + 2, { shade: [backShade(va), backShade(va), backShade(vb), backShade(vb)] });
  }
  const crown = arch.slice(1, -1); // the arch, from its west foot over to its east foot, at the spring
  for (let k = 0; k + 1 < crown.length; k++) {
    glow.panel(frame, [[0, spring], crown[k], crown[k + 1]], -D + 2, { shade: [backShade(spring), backShade(crown[k][1]), backShade(crown[k + 1][1])] });
  }
  // The hearthstone, a cream half round before it.
  trim.color(TINT.cream);
  trim.lathe(x1, hz, [[310, 0], [300, 6], [0, 6]], 12, { a0: 0, arc: Math.PI, vMode: 'plan' });
  // The surround: a rose-marble bullnose round the arch, a gilt keystone over it.
  const [sw, sv] = HEARTH.surround;
  trim.color(TINT.rose);
  trim.glow = 0.6; // its sheen weight (hall.js)
  sweep(trim, contourPath(frame, arch), [[0, 0], [0.5 * sw, 0.03 * sv], [0.85 * sw, 0.16 * sv], [sw, 0.4 * sv], [0.92 * sw, 0.68 * sv], [0.62 * sw, 0.9 * sv], [0, sv]]);
  trim.glow = 0;
  const K = HEARTH.key;
  paint.color(TINT.gold);
  paint.solid(localBoxPolys(frame, -K.half, K.half, hh + K.from, hh + K.to, -4, K.depth), { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
  // The mantel shelf round its top, and the skirting round its foot either side of the hearth
  // (dying into the surround's feet).
  const outline = pierPath(x0, x1, z0, z1, rc);
  trim.color(TINT.cream);
  sweep(trim, outline, MANTEL);
  const front = outline.findIndex((P) => P.p[0] === x1);
  const foot = (z) => ({ p: [x1, 0, z], n: [1, 0, 0], b: [0, 1, 0] });
  const mid = hw + sv / 2; // the middle of the surround's foot
  sweep(trim, [...outline.slice(0, front + 1), foot(hz - mid)], SKIRTING);
  sweep(trim, [foot(hz + mid), ...outline.slice(front + 1)], SKIRTING);
  // The fire: three round logs (plain bark: the wood's texture would darken them to soot) on
  // a bed of embers, their sawn ends glowing with it; seven tongues of flame in three layers.
  const back = x1 - D;
  const lr = LOGS.size / 2;
  const bark = Array.from({ length: LOGS.sides + 1 }, (_, k) => {
    const a = ((k / LOGS.sides) * 2 - 0.5) * Math.PI; // round from underneath
    return [Math.cos(a) * lr, Math.sin(a) * lr];
  });
  const [za, zb] = [hz - hw + LOGS.clear, hz + hw - LOGS.clear];
  glow.color(TINT.ember);
  glow.glow = 0.37;
  for (const [dx, y] of LOGS.at) {
    const [cx, cy] = [back + dx + lr, y + lr];
    paint.color(TINT.log);
    sweep(paint, [za, zb].map((lz) => ({ p: [cx, cy, lz], n: [1, 0, 0], b: [0, 1, 0] })), bark);
    for (const [lz, f] of [[za, -1], [zb, 1]]) glow.poly(bark.slice(1).map(([w, v]) => [cx + w, cy + v, lz]), { facing: [0, 0, f] });
  }
  glow.poly([[back + 4, 5, hz - hw + 70], [x1 + 14, 5, hz - hw + 70], [x1 + 14, 5, hz + hw - 70], [back + 4, 5, hz + hw - 70]], { facing: [0, 1, 0] });
  const F = FLAMES;
  F.heights.forEach((fh, i) => {
    const fz = hz + (i - (F.heights.length - 1) / 2) * F.spacing;
    F.layers.forEach(([w, k, dx], layer) => {
      const fx = x1 - F.back + dx;
      const h = fh * k;
      glow.color(TINT.flames[layer]);
      glow.glow = 0.08 + i * 0.13;
      const tongue = [[fz - w * 0.4, 0], [fz + w * 0.4, 0], [fz + w / 2, h * 0.32], [fz, h], [fz - w / 2, h * 0.32]];
      glow.poly(tongue.map(([z, y]) => [fx, F.foot + y, z]), { facing: [1, 0, 0] });
    });
  });
  glow.glow = 0;
  // The crest: a red disc in a gold ring with Jonas's white pi.
  const crest = wallFrame([CR.x, CR.y, CR.z], [1, 0, 0]);
  paint.color(TINT.gold);
  paint.panel(crest, circleContour(0, 0, CR.r + 18, 24), 0);
  paint.color(TINT.crest);
  paint.panel(crest, circleContour(0, 0, CR.r, 24), 1);
  paint.color(TINT.white);
  const quad = (u0, v0, u1, v1, slant = 0) => paint.panel(crest, [[u0, v0], [u1, v0], [u1 + slant, v1], [u0 + slant, v1]], 2);
  quad(-100, 50, 100, 82);
  quad(-60, -92, -34, 50, 14);
  quad(34, -80, 60, 50);
  quad(34, -100, 92, -74);
  // The hood over the mantel, up to the ceiling (solid: he stands on the mantel before it).
  wall.color(TINT.plaster);
  wall.box(HOOD.x0, HOOD.x1, HOOD.y0, L.HALL.ceilingY, HOOD.z0, HOOD.z1, { bottom: false, top: false });
  solids.box(HOOD.x0, HOOD.x1, HOOD.y0, L.HALL.ceilingY, HOOD.z0, HOOD.z1, 'stone', { bottom: false, top: false });
}

// The buttress, the slot's far side: a cream marble pedestal with round corners, a teal panel
// up its face, a gold cap moulding, the skirting round its foot; the brass banner pole in front
// of it, with a small banner from a crossbar near its top (drawn from both sides).
function buttress(kit, { BUTTRESS: B, BANNER_POLE: P }) {
  const { trim, wood, paint, dado, cloth, solids } = kit;
  const T = BUTTRESS_TRIM;
  const rr = T.round;
  trim.color(TINT.cream);
  trim.shade = (px, py) => 0.82 + 0.18 * Math.min(1, py / 400);
  pier(trim, B.x0, B.x1, B.z0, B.z1, B.top, rr, () => {
    trim.poly([[B.x1, 0, B.z0 + rr], [B.x1, 0, B.z1 - rr], [B.x1, B.top, B.z1 - rr], [B.x1, B.top, B.z0 + rr]], { facing: [1, 0, 0] });
  });
  trim.shade = null;
  const outline = pierPath(B.x0, B.x1, B.z0, B.z1, rr);
  sweep(trim, outline, SKIRTING);
  const [v0, v1] = T.panel;
  dado.color(TINT.panel);
  const [pz0, pz1] = [B.z0 + rr + T.panelInset, B.z1 - rr - T.panelInset];
  dado.poly([[B.x1 + 4, v0, pz0], [B.x1 + 4, v0, pz1], [B.x1 + 4, v1, pz1], [B.x1 + 4, v1, pz0]], {
    facing: [1, 0, 0],
    uvs: [[1, 0], [0, 0], [0, 1], [1, 1]], // (u running to the right seen from the room: -z)
  });
  paint.color(TINT.gold);
  sweep(paint, outline, T.cap);
  solids.box(B.x0, B.x1, 0, B.top, B.z0, B.z1, 'stone');

  // The pole (its climbable pole is layout.POLES).
  paint.color(TINT.gold);
  paint.lathe(P.x, P.z, POLE_PROFILE, 12, { smoothProfile: true });
  wood.color(TINT.iron);
  const bar = P.y1 - 90;
  wood.box(P.x, P.x + 170, bar - 8, bar + 8, P.z - 8, P.z + 8);
  const u = (x) => (x - P.x - 20) / 140;
  const pts = [[P.x + 20, bar - 230, P.z], [P.x + 160, bar - 230, P.z], [P.x + 160, bar, P.z], [P.x + 20, bar, P.z]];
  const uvs = pts.map(([x, y]) => [u(x), (y - bar + 230) / 230]);
  cloth.color(0xffffff);
  cloth.poly(pts, { facing: [0, 0, 1], uvs });
  cloth.poly(pts, { facing: [0, 0, -1], uvs, shade: 0.85 });
}

// ---------------------------------------------------------------- east wall

function eastWall(kit, { HALL, EAST_DOORS: D, WHEEL }) {
  const { trim, paint, dado, wood, solids } = kit;
  const hw = D.width / 2;
  const spring = D.height - hw + EAST.raise; // the surrounds' arches spring over the door's own
  D.zs.forEach((z, i) => {
    const frame = wallFrame([HALL.halfX, 0, z], [-1, 0, 0]);
    door(kit, frame, D.width, D.height, { segs: 16 });
    const niche = archContour(hw + EAST.niche, spring, 16);
    dado.color(TINT.teal);
    dado.panel(frame, niche, 1, { uvs: niche.map(() => [0.5, 0.5]) });
    trim.color(TINT.cream);
    trim.moulding(frame, niche, archContour(hw + EAST.architrave, spring, 16), D.depth, { w0: -4, revealShade: 0.6 });
    paint.color(TINT.gold);
    paint.moulding(frame, archContour(hw + EAST.architrave, spring, 16), archContour(hw + EAST.bead, spring, 16), EAST.beadDepth, { w0: -4, revealShade: 0.7 });
    // The piers are solid, flush with the architrave's face.
    for (const s of [-1, 1]) {
      const [u0, u1] = s < 0 ? [-hw - EAST.bead, -hw - EAST.niche] : [hw + EAST.niche, hw + EAST.bead];
      solids.solid(localBoxPolys(frame, u0, u1, 0, spring, 0, D.depth, { bottom: false }), 'stone');
    }
    plaque(paint, frame, D.plaques[i], D.plaqueV);
  });
  // The ship's wheel: an oak rim, a gold hub, eight oak spokes running on out through the rim
  // to gold handles.
  const W = WHEEL_PARTS;
  const f = wallFrame([WHEEL.x, 0, WHEEL.z], [-1, 0, 0]);
  wood.color(TINT.oak);
  wood.moulding(f, circleContour(0, WHEEL.y, WHEEL.r - W.rim, 24), circleContour(0, WHEEL.y, WHEEL.r, 24), W.rimDepth, { closed: true });
  paint.color(TINT.gold);
  paint.moulding(f, circleContour(0, WHEEL.y, W.hub[0], 12), circleContour(0, WHEEL.y, W.hub[1], 12), W.hubDepth, { closed: true });
  for (let k = 0; k < W.spokes; k++) {
    const a = (k / W.spokes) * Math.PI * 2;
    const at = (r) => f.at(Math.cos(a) * r, WHEEL.y + Math.sin(a) * r, W.at);
    wood.solid(beamPolys(at(W.hub[1]), at(WHEEL.r + W.spokeTo), f.out, W.spoke, W.spoke));
    paint.solid(beamPolys(at(WHEEL.r + W.handle[0]), at(WHEEL.r + W.handle[1]), f.out, W.handleSize, W.handleSize));
  }
}

// A round plaque on a wall frame at height v: a gold rim, a coloured field and its sign (a white
// snowflake, or a bronze cog).
function plaque(paint, frame, kind, v) {
  const k = PLAQUE.field / 66; // (the sign drawn for a field of 66)
  paint.color(TINT.gold);
  paint.panel(frame, circleContour(0, v, PLAQUE.gold, 16), 3);
  paint.color(TINT.plaques[kind]);
  paint.panel(frame, circleContour(0, v, PLAQUE.field, 16), 4);
  const bar = (a, len, w, [cu, cv]) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const p = (du, dv) => [cu + (du * c - dv * s) * k, cv + (du * s + dv * c) * k];
    paint.panel(frame, [p(-len, -w), p(len, -w), p(len, w), p(-len, w)], 5);
  };
  if (kind === 'snowflake') {
    paint.color(TINT.white);
    for (let j = 0; j < 3; j++) {
      const a = (j * Math.PI) / 3 + Math.PI / 2;
      bar(a, 52, 5, [0, v]);
      for (const t of [-34, 34]) {
        const at = [Math.cos(a) * t * k, v + Math.sin(a) * t * k];
        bar(a + 0.8, 14, 4, at);
        bar(a - 0.8, 14, 4, at);
      }
    }
  } else {
    paint.color(0xd8b070);
    const ring = (r) => circleContour(0, v, r * k, 8);
    const out = ring(40);
    const inside = ring(20);
    for (let j = 0; j < 8; j++) {
      const n = (j + 1) % 8;
      paint.panel(frame, [inside[j], out[j], out[n], inside[n]], 5);
      const a = ((j + 0.5) * Math.PI) / 4;
      bar(a, 9, 9, [Math.cos(a) * 47 * k, v + Math.sin(a) * 47 * k]);
    }
  }
}

// ---------------------------------------------------------------- out in the room

// The round chart table: an oak top with a rounded edge on a pedestal, a chart of the first
// course on it (a sea with home island, the skerries, the lighthouse's islet, a dotted route and
// a compass mark).
function chartTable(kit, { CHART_TABLE: T }) {
  const { wood, paint, solids } = kit;
  const { x, z, r, top } = T;
  wood.color(TINT.oak);
  wood.lathe(x, z, [[0, top - 30], [r, top - 30], [r, top - 30], [r + 8, top - 15], [r, top], [r, top], [0, top]], 16, { smoothProfile: true, vMode: 'plan' });
  wood.lathe(x, z, [[120, 0], [120, 16], [60, 40], [44, top - 30]], 12);
  solids.solid(prismPolys(x, z, r, 8, 0, top), 'wood');

  // The chart, turned a little on the table: sheet (s, t) in -1..1 -> table top.
  const yaw = 0.18;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const hs = 210;
  const ht = 160;
  const at = (s, t, lift) => [x + s * hs * c + t * ht * sn, top + lift, z - s * hs * sn + t * ht * c];
  const flat = (pts, lift) => paint.poly(pts.map(([s, t]) => at(s, t, lift)), { facing: [0, 1, 0] });
  paint.color(TINT.parchment);
  flat([[-1, -1], [1, -1], [1, 1], [-1, 1]], 1);
  paint.color(TINT.chartSea);
  flat([[-0.9, -0.88], [0.9, -0.88], [0.9, 0.88], [-0.9, 0.88]], 2);
  const blob = (s, t, rs, tint) => {
    paint.color(tint);
    flat(Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return [s + Math.cos(a) * rs, t + Math.sin(a) * rs * 1.3];
    }), 3);
  };
  blob(0, 0.58, 0.3, TINT.chartLand);
  blob(0, 0.6, 0.18, TINT.chartMeadow);
  blob(0.02, -0.58, 0.22, TINT.chartLand);
  for (const [s, t] of [[-0.42, 0.42], [-0.55, 0.15], [-0.52, -0.12], [-0.4, -0.36]]) blob(s, t, 0.07, TINT.chartLand);
  blob(0.56, -0.08, 0.13, TINT.chartLand);
  blob(0.02, -0.62, 0.05, TINT.crest);
  // The route: dashes from home round the skerries to the lighthouse.
  paint.color(TINT.crest);
  const route = [[-0.12, 0.4], [-0.32, 0.3], [-0.46, 0.02], [-0.34, -0.3], [-0.12, -0.5]];
  for (let i = 0; i + 1 < route.length; i++) {
    const [s0, t0] = route[i];
    const [s1, t1] = route[i + 1];
    const ms = (s0 + s1) / 2;
    const mt = (t0 + t1) / 2;
    const ds = (s1 - s0) * 0.3;
    const dt = (t1 - t0) * 0.3;
    const len = Math.hypot(s1 - s0, t1 - t0);
    const ps = (-(t1 - t0) / len) * 0.016; // half its width, across it
    const pt = ((s1 - s0) / len) * 0.016;
    flat([[ms - ds - ps, mt - dt - pt], [ms + ds - ps, mt + dt - pt], [ms + ds + ps, mt + dt + pt], [ms - ds + ps, mt - dt + pt]], 4);
  }
  // A compass mark in the corner: a dark needle, north toward the lighthouse.
  paint.color(TINT.ink);
  flat([[0.72, -0.62], [0.76, -0.48], [0.8, -0.62], [0.76, -0.76]], 4);
}

// The rugs and inlays (layout RUGS, DAIS_APRON), flat on the floor: rings of colour, a whole
// one or the half toward `dir`; the compass rose's eight-point star (its north point red, at the
// bottle; each point lit on one half).
function rugs(kit, { RUGS, DAIS, DAIS_APRON: A }) {
  const { paint } = kit;
  const ring = (x, z, rOut, rIn, y, tint, span, sides) => {
    paint.color(tint);
    paint.lathe(x, z, [[rOut, y], [rIn, y]], sides, span);
  };
  const halfToward = ([dx, dz]) => ({ a0: Math.atan2(dx, dz) - Math.PI / 2, arc: Math.PI });
  for (const { kind, x, z, r, dir } of RUGS) {
    const { rings, inner, sides } = RUG[kind];
    for (const [a, b, tint] of rings) ring(x, z, r - a, b === null ? inner : r - b, 2, TINT[tint], dir ? halfToward(dir) : {}, sides);
    if (kind !== 'compass') continue;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI + (k / 8) * Math.PI * 2; // point 0 north
      const [len, w] = k % 2 === 0 ? COMPASS.long : COMPASS.short;
      const [lit, dark] = k === 0 ? TINT.compass.north : k % 2 === 0 ? TINT.compass.long : TINT.compass.short;
      const at = (d, b) => [x + Math.sin(b) * d, COMPASS.star, z + Math.cos(b) * d];
      const c = [x, COMPASS.star, z];
      paint.color(lit);
      paint.tri(at(w, a - Math.PI / 2), c, at(len, a), { facing: [0, 1, 0] });
      paint.color(dark);
      paint.tri(c, at(w, a + Math.PI / 2), at(len, a), { facing: [0, 1, 0] });
    }
  }
  // The apron round the dais's foot: a gold fillet, a rose band.
  const south = halfToward([0, 1]);
  ring(DAIS.x, DAIS.z, A.r0 + 20, A.r0, 1.5, TINT.gold, south, 24);
  ring(DAIS.x, DAIS.z, A.r1, A.r0 + 20, 1.5, TINT.band, south, 24);
}

// The three gold candle rings on the axis: a ring (round in section) of candles on a baluster,
// hanging on four chains and an iron rod from the vault; their flames flicker.
function chandeliers(kit, L) {
  const { wood, paint, glow } = kit;
  const { y, r, candles: n } = L.CHANDELIERS;
  const R = CANDLE_RING;
  L.CHANDELIERS.spots.forEach(({ x, z }, k) => {
    paint.color(TINT.gold);
    paint.lathe(x, z, [[r - 20, y - 10], [r + 10, y], [r, y + 16], [r - 30, y + 10], [r - 20, y - 10]], R.sides, { smoothProfile: true });
    paint.lathe(x, z, [[0, y - 160], [40, y - 120], [26, y - 60], [60, y], [30, y + 40], [16, y + 300]], R.baluster, { smoothProfile: true });
    wood.color(TINT.iron);
    wood.box(x - R.rod, x + R.rod, y + 300, vaultY(L, x, z) - 10, z - R.rod, z + R.rod, { top: false });
    for (let i = 0; i < n; i += R.chains) {
      const a = (i / n) * Math.PI * 2;
      wood.solid(beamPolys([x + Math.sin(a) * r, y + 10, z + Math.cos(a) * r], [x, y + 300, z], [Math.cos(a), 0, -Math.sin(a)], R.chain, R.chain));
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cx = x + Math.sin(a) * r;
      const cz = z + Math.cos(a) * r;
      paint.color(TINT.gold);
      paint.lathe(cx, cz, [[0, y + 10], [26, y + 12], [22, y + 22], [0, y + 22]], 8);
      paint.color(TINT.wax);
      paint.lathe(cx, cz, [[13, y + 22], [12, y + 82], [0, y + 84]], 8);
      glow.color(TINT.flames[1]);
      glow.glow = 0.05 + ((i * 7 + k * 3) % 16) / 17;
      glow.lathe(cx, cz, [[0, y + 88], [10, y + 104], [0, y + 140]], 6, { flat: true });
    }
  });
  glow.glow = 0;
}
