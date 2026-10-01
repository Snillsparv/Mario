// Midsummer Skerries' props (skerries/layout.js MAYPOLE, COTTAGE, FLAGPOLE, HUT, FIRS,
// SANDBAR, WRECK), written into the course's kit (skerries/build.js): render faces into its
// material builders, colliders into kit.solids.
//
//   buildProps(kit, layout)
//   fir(kit, x, z, base, h, r, { a0, solid })   // one dark fir (build.js's cliffs have them
//                                               // too, without colliders)
//
// On Home Island's meadow: the maypole, wrapped in leaves (kit.leaves) with its crossbar, two
// leafy hoops hanging from the bar's ends, garlands of flowers and a little pennant on top; the
// red cottage (houses.js) with its chimney; the flagpole by the boardwalk with a blue and
// yellow pennant (cloth). On the islet's second terrace the keeper's hut (houses.js) and two
// firs. In the Sound: the sand bar (a sand mound up to wading depth) and the sunken rowing boat
// on the seabed (weathered paint, its planked floor and two thwarts; the coins and the 1-up in
// it are the objects').
//
// Colliders: the firs (a steep frustum round the trunk and the needles), the sand bar (sand),
// the sunken boat's hull up to its floor (wood: the gunwales and thwarts above it are drawn
// only), the houses (houses.js). The maypole and the flagpole are climbable poles
// (layout.POLES).

import { beamPolys, orientedBoxPolys } from '../castle/geom.js';
import { house } from './houses.js';

const TINT = {
  leaf: 0x8ec45a,
  flower: [0xf6e04a, 0xf2f0f0, 0xe0503c, 0x7a6ae0],
  pole: 0xf4f2ec,
  gold: 0xe8b84a,
  blue: 0x2a5cb0,
  yellow: 0xf6cc2c,
  fir: 0x3e5e3c,
  trunk: 0x5a4030,
  sand: 0xfff0dc,
  hull: 0x4e6458,
  inside: 0x8a7258,
};
const HOOP_SEGS = 12;
const FIR_FOOT = 0.85; // a fir's collider's radius at the ground, of its needles' widest
const FIR_LEAN = 0.09; // its sides' inward lean per unit up (a face's normal.y about 0.08)
const PENNANT = { len: 360, height: 70, droop: 60 };

export function buildProps(kit, layout) {
  maypole(kit, layout);
  flagpole(kit, layout);
  house(kit, { ...layout.COTTAGE, y0: layout.HOME.top, door: 's', windows: { s: 2, n: 2, e: 1, w: 1 }, chimney: true });
  house(kit, { ...layout.HUT, y0: layout.TERRACES[1].top, door: 's', windows: { s: 1, e: 1 }, chimney: true });
  for (const f of layout.FIRS) fir(kit, f.x, f.z, layout.TERRACES[1].top, f.h, f.r, { a0: f.x * 0.01 });
  sandbar(kit, layout);
  wreck(kit, layout);
}

// A dark fir: a short trunk under two tiers of needles (kit.leaves); with `solid`, its collider an
// octagonal frustum round the trunk and the needles from the ground up to the tip, leaning in
// FIR_LEAN per unit up: its sides stay steeper than the steepest floor (CollisionWorld's
// FLOOR_MIN_NY), so they stop him like walls (a cone round the tiers would be a slope he walks
// straight up), and its small flat top at the tip is out of a jump's reach from the ground.
export function fir(kit, x, z, base, h, r, { a0 = 0, solid = true } = {}) {
  kit.wood.color(TINT.trunk);
  kit.wood.lathe(x, z, [[r * 0.16, base - 10], [r * 0.12, base + h * 0.2]], 6, { flat: true });
  kit.leaves.color(TINT.fir);
  kit.leaves.lathe(x, z, [[0, base + h * 0.12], [r, base + h * 0.12], [r * 0.5, base + h * 0.5], [r * 0.78, base + h * 0.45], [0, base + h]], 7, { flat: true, a0 });
  if (solid) kit.solids.solid(frustumPolys(x, z, r * FIR_FOOT, r * FIR_FOOT - h * FIR_LEAN, 8, base, base + h), 'wood');
}

// A closed regular frustum round (cx, cz): radius r0 at y0 up to r1 at y1, a flat top (no
// bottom).
function frustumPolys(cx, cz, r0, r1, sides, y0, y1) {
  const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
  const lo = ring(r0, y0);
  const hi = ring(r1, y1);
  return [hi, ...lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]])];
}

// ---------------------------------------------------------------- Home Island's meadow

// The maypole: a pole wrapped in leaves (its climbable pole is layout.POLES), a leafy crossbar
// along x (clear of the climbing hero, who holds it from its south side) and a hoop hanging
// from each end, garlands of flowers round them, a blue and yellow pennant on a little staff on
// top.
function maypole(kit, { MAYPOLE: M }) {
  const { leaves, paint, cloth, wood } = kit;
  leaves.color(TINT.leaf);
  leaves.lathe(M.x, M.z, [[M.radius + 4, M.y0 - 10], [M.radius, M.y1 - 20], [0, M.y1]], 8);
  leaves.box(M.x - M.arm, M.x + M.arm, M.bar - 14, M.bar + 14, M.z - 14, M.z + 14);
  for (const s of [-1, 1]) {
    // The hoop: a ring of leafy segments in the pole's plane, hanging from the bar's end.
    const cx = M.x + s * (M.arm - 20);
    const cy = M.bar - 14 - M.hoop;
    const at = (t) => [cx + Math.sin(t) * M.hoop, cy + Math.cos(t) * M.hoop, M.z];
    leaves.color(TINT.leaf);
    for (let i = 0; i < HOOP_SEGS; i++) {
      leaves.solid(beamPolys(at((i / HOOP_SEGS) * Math.PI * 2), at(((i + 1) / HOOP_SEGS) * Math.PI * 2), [0, 0, 1], 28, 28));
    }
    // Flowers round it and on the bar.
    for (let i = 0; i < 8; i++) {
      const p = at(((i + 0.5) / 8) * Math.PI * 2);
      for (const f of [1, -1]) flower(paint, [p[0], p[1], p[2] + f * 16], [0, 0, f], i + (s > 0 ? 3 : 0));
    }
    for (const f of [1, -1]) flower(paint, [M.x + s * M.arm * 0.55, M.bar, M.z + f * 16], [0, 0, f], s > 0 ? 1 : 2);
  }
  // A garland of flowers spiralling up the pole below the bar.
  for (let y = M.y0 + 200, i = 0; y < M.bar - 60; y += 160, i++) {
    const t = i * 2.4;
    flower(paint, [M.x + Math.sin(t) * (M.radius + 4), y, M.z + Math.cos(t) * (M.radius + 4)], [Math.sin(t), 0, Math.cos(t)], i);
  }
  // The little staff and pennant on top.
  wood.color(TINT.pole);
  wood.lathe(M.x, M.z, [[7, M.y1 - 4], [5, M.y1 + 120], [0, M.y1 + 124]], 6, { flat: true });
  pennant(cloth, M.x, M.y1 + 110, M.z, 0.5);
}

// A flower: a small bright diamond of petals at p facing horizontal direction `out`, in one of
// the flower tints (painted: kit.paint's planks are nearly white).
function flower(paint, p, out, i) {
  const r = 17;
  const [rx, rz] = [out[2], -out[0]];
  paint.color(TINT.flower[i % TINT.flower.length]);
  paint.poly([[p[0] - rx * r, p[1], p[2] - rz * r], [p[0], p[1] - r, p[2]], [p[0] + rx * r, p[1], p[2] + rz * r], [p[0], p[1] + r, p[2]]], { facing: out });
}

// A pennant (cloth, both faces) from a staff at (x, top, z) streaming toward +x and drooping a
// little: blue over yellow, tapering to a point; `k` scales it.
function pennant(cloth, x, top, z, k = 1) {
  const len = PENNANT.len * k;
  const hh = (PENNANT.height * k) / 2;
  const droop = PENNANT.droop * k;
  const mid = top - hh;
  const tip = [x + len, mid - droop, z];
  const half = (u) => hh * (1 - u * 0.94);
  const at = (u, v) => [x + len * u, mid - droop * u * u + v * half(u), z];
  cloth.color(TINT.blue);
  cloth.poly([at(0, 0), at(0.5, 0), at(0.5, 1), at(0, 1)], { facing: [0, 0, 1], uvs: [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] });
  cloth.poly([at(0.5, 0), tip, at(0.5, 1)], { facing: [0, 0, 1], uvs: [[0.5, 0.5], [1, 0.5], [0.5, 1]] });
  cloth.color(TINT.yellow);
  cloth.poly([at(0, -1), at(0.5, -1), at(0.5, 0), at(0, 0)], { facing: [0, 0, 1], uvs: [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]] });
  cloth.poly([at(0.5, -1), tip, at(0.5, 0)], { facing: [0, 0, 1], uvs: [[0.5, 0], [1, 0.5], [0.5, 0.5]] });
}

// The flagpole: a white pole with a gold knob (its climbable pole is layout.POLES), the pennant
// streaming from its top.
function flagpole(kit, { FLAGPOLE: F }) {
  const { paint, cloth } = kit;
  paint.color(TINT.pole);
  paint.lathe(F.x, F.z, [[F.radius + 30, F.y0 - 10], [F.radius + 30, F.y0 + 30], [F.radius, F.y0 + 40], [F.radius - 8, F.y1 - 16]], 8, { flat: true });
  paint.color(TINT.gold);
  paint.lathe(F.x, F.z, [[F.radius - 8, F.y1 - 16], [F.radius + 2, F.y1 - 4], [F.radius - 2, F.y1 + 10], [0, F.y1 + 14]], 8, { flat: true });
  pennant(cloth, F.x + F.radius - 6, F.y1 - 30, F.z);
}

// ---------------------------------------------------------------- in the Sound

// The sand bar: a mound of sand from the seabed up to its flat top just under the surface (a
// regular octagon, its top's corners at r, its foot's at `foot`).
function sandbar(kit, { SANDBAR: S, BAY }) {
  const { sand, solids } = kit;
  const ring = (r, y) => Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return [S.x + Math.sin(a) * r, y, S.z + Math.cos(a) * r];
  });
  const top = ring(S.r, S.top);
  const foot = ring(S.foot, BAY.bedY);
  const polys = [top, ...top.map((p, i) => [p, top[(i + 1) % 8], foot[(i + 1) % 8], foot[i]])];
  sand.color(TINT.sand);
  sand.shade = (x, y) => 0.7 + 0.3 * Math.max(0, 1 + (y - S.top) / 600);
  sand.solid(polys);
  sand.shade = null;
  solids.solid(polys, 'sand');
}

// The sunken rowing boat on the seabed along WRECK.yaw: a pointed bow (+along) and a square
// transom (-along), its hull sinking a little into the sand; inside, a planked floor and two
// thwarts. Points in the boat's frame: (along, across) -> local (x, z).
function wreck(kit, { WRECK: W, BAY }) {
  const { paint, wood, solids } = kit;
  const s = Math.sin(W.yaw);
  const c = Math.cos(W.yaw);
  const at = ([a, b], y) => [W.x + s * a + c * b, y, W.z + c * a - s * b];
  const L = W.length / 2;
  const B = W.beam / 2;
  const outline = [[L, 0], [L * 0.45, B * 0.92], [-L * 0.25, B], [-L, B * 0.78], [-L, -B * 0.78], [-L * 0.25, -B], [L * 0.45, -B * 0.92]];
  const keel = outline.map(([a, b]) => [a * 0.82, b * 0.45]);
  const inner = outline.map(([a, b]) => [a * 0.9, b * 0.84]);
  const n = outline.length;
  const gun = outline.map((p) => at(p, W.gunwale));
  const bottom = keel.map((p) => at(p, BAY.bedY - 30));
  const floor = inner.map((p) => at(p, W.floor));
  const rim = inner.map((p) => at(p, W.gunwale));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mid = [(outline[i][0] + outline[j][0]) / 2, (outline[i][1] + outline[j][1]) / 2];
    const out = at(mid, 0);
    const facing = [out[0] - W.x, 0, out[2] - W.z];
    paint.color(TINT.hull);
    paint.poly([bottom[i], bottom[j], gun[j], gun[i]], { facing: [facing[0], -60, facing[2]], shade: [0.6, 0.6, 1, 1] });
    // The gunwale's top and the hull's inside.
    paint.color(TINT.hull, 1.25);
    paint.poly([rim[i], rim[j], gun[j], gun[i]], { facing: [0, 1, 0] });
    wood.color(TINT.inside);
    wood.poly([floor[i], floor[j], rim[j], rim[i]], { facing: [-facing[0], 0, -facing[2]], shade: 0.65 });
  }
  wood.color(TINT.inside);
  wood.poly(floor, { facing: [0, 1, 0], shade: 0.9 });
  // Two thwarts across, between the coins.
  for (const a of [-50, 65]) wood.solid(orientedBoxPolys(at([a, 0], 0), [c, 0, -s], B * 1.7, W.gunwale - 26, W.gunwale - 14, 24), { shade: 0.85 });
  // The hull up to its floor (the gunwales and thwarts above it are drawn only).
  const deck = outline.map((p) => at(p, W.floor));
  const base = outline.map((p) => at(p, BAY.bedY - 30));
  solids.solid([deck, base, ...deck.map((p, i) => [p, deck[(i + 1) % n], base[(i + 1) % n], base[i]])], 'wood');
}
