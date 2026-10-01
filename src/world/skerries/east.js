// Midsummer Skerries' east route (skerries/layout.js BOARDWALK, PINNACLE, NET_SHED, BOATHOUSE,
// NET_MAST, BRIDGE), written into the course's kit (skerries/build.js): render faces into its
// material builders, colliders into kit.solids. East Rock itself is one of build.js's rocks.
//
//   buildEast(kit, layout)
//
// The fishermen's boardwalk: plank decks (their planks across the walk) on cribs boarded down
// to the water over stone down to the seabed, piles along their sides, like the jetty; the
// single narrow plank across the water between two stretches. On East Rock: the granite
// pinnacle (sheer on its east face, the chimney's west wall; leaning in a little on its west
// and south) and the chimney's back wall, the tall net shed with its loft deck on top (a
// railing along two of its edges) and the boathouse (houses.js), and the net mast south of the
// shed (a pole with a crossbar under its tip, a net hung over one arm). The plank bridge from
// the chimney's back wall down to the islet's second terrace: planks across two dark
// stringers, a gap in its middle, on trestles (two posts and a cross beam: either side of the
// gap, and one near each end), a plank landing at each end, on the back wall and on the
// terrace.
//
// Colliders: each stretch of the boardwalk solid to the seabed (wood), the narrow plank a slab
// (water under it); the pinnacle and the back wall (stone); the houses (houses.js), the loft's
// railing; the bridge's two decks and two landings as slabs, its posts (wood). The net mast is
// a climbable pole (layout.POLES).

import { beamPolys, hexaPolys } from '../castle/geom.js';
import { house } from './houses.js';

const TINT = {
  deck: 0xd8dcdc,
  crib: 0xc0c4c4,
  post: 0x7a6650,
  granite: 0xf6dade,
  reef: 0xeed8dc,
  stringer: 0x6a4a32,
  plank: 0xc8b8a4,
  mast: 0x8a6446,
  iron: 0x34363a,
  net: 0xffffff,
};
const GAIN = 1.3; // (as build.js's: the granite's tints brighten the rock texture to pink-grey)
const LIFT = 2; // decks are drawn this far over their colliders
const BRIDGE_LIFT = 4; // the bridge's further (its head landing lies on the back wall's top)
const PLANK = 300; // world units per repeat of the planks (the wood builder's)
const NET_TILE = 160; // world size of one repeat of the net texture (as build.js's racks')
const PILE_EVERY = 350;
const DECK_THICK = 30; // the bridge's decks and landing
const POST = 12; // the bridge's posts' half width
// Granite shading by height (as build.js's): wet at the waterline, darker under the water.
const wet = (x, y) => (y > 30 ? 1 : y > -30 ? 0.74 : 0.6 + 0.14 * Math.max(0, 1 + y / 800));

export function buildEast(kit, layout) {
  for (const s of layout.BOARDWALK.stretches) stretch(kit, layout, s);
  pinnacle(kit, layout);
  const y0 = layout.EAST_ROCK.top;
  house(kit, { ...layout.NET_SHED, y0, eaves: layout.NET_SHED.top, door: 's', windows: { s: 2, n: 1 }, hatch: 'e' });
  loftRail(kit, layout);
  house(kit, { ...layout.BOATHOUSE, y0, door: 'e', windows: { s: 1, n: 1 } });
  netMast(kit, layout);
  bridge(kit, layout);
}

// ---------------------------------------------------------------- the boardwalk

// One stretch of the boardwalk (at its own top, if it has one): a plank deck whose planks run
// across the walk (the wood texture's boards run along v) on a boarded crib, stone under the
// water, piles along its long sides; or the narrow plank, a slab on its own.
function stretch(kit, { BOARDWALK: W, BAY }, s) {
  const { wood, granite, solids } = kit;
  const { x0, x1, z0, z1 } = s;
  const top = s.top ?? W.top;
  const alongZ = z1 - z0 >= x1 - x0;
  const uv = ([x, , z]) => (alongZ ? [z / PLANK, x / PLANK] : [x / PLANK, z / PLANK]);
  const deck = [[x0, top + LIFT, z0], [x1, top + LIFT, z0], [x1, top + LIFT, z1], [x0, top + LIFT, z1]];
  if (s.narrow) {
    wood.color(TINT.plank);
    wood.poly(deck, { facing: [0, 1, 0], uvs: deck.map(uv), shade: 1.06 });
    wood.box(x0, x1, top - 24, top + LIFT, z0, z1, { top: false, shade: 0.8 });
    solids.solid(hexaPolys([[x0, top - 24, z0], [x1, top - 24, z0], [x1, top - 24, z1], [x0, top - 24, z1], [x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]]), 'wood');
    return;
  }
  wood.color(TINT.deck);
  wood.poly(deck, { facing: [0, 1, 0], uvs: deck.map(uv), shade: 1.08 });
  wood.color(TINT.crib);
  wood.box(x0, x1, -60, top + LIFT, z0, z1, { top: false, bottom: false, shade: 0.86 });
  granite.color(TINT.reef, GAIN);
  granite.shade = wet;
  granite.box(x0 - 10, x1 + 10, BAY.bedY, -60, z0 - 10, z1 + 10, { bottom: false, top: false });
  granite.shade = null;
  // Piles along both long sides.
  wood.color(TINT.post);
  const len = alongZ ? z1 - z0 : x1 - x0;
  const n = Math.max(1, Math.round(len / PILE_EVERY));
  for (let i = 0; i <= n; i++) {
    const a = (alongZ ? z0 : x0) + 20 + ((len - 40) * i) / n;
    for (const side of alongZ ? [x0 - 14, x1 + 14] : [z0 - 14, z1 + 14]) {
      const [px, pz] = alongZ ? [side, a] : [a, side];
      wood.lathe(px, pz, [[22, -200], [22, top + 6], [0, top + 6]], 6, { flat: true });
    }
  }
  solids.box(x0, x1, BAY.bedY, top, z0, z1, 'wood');
}

// ---------------------------------------------------------------- East Rock

// The granite pinnacle: sheer and flat on its east face (the chimney's west wall: kicked off),
// leaning in a little on its west and south faces up to its flat top; the chimney's back wall
// across the chimney's north end from the pinnacle to the shed, as tall (their tops one with
// the loft's); darker low down, banded by joints.
function pinnacle(kit, { PINNACLE: P, CHIMNEY: C, NET_SHED: S, EAST_ROCK }) {
  const { granite, solids } = kit;
  const y0 = EAST_ROCK.top - 20;
  const lean = 40;
  const shapes = [
    [
      [P.x0, y0, P.z0], [P.x1, y0, P.z0], [P.x1, y0, P.z1], [P.x0, y0, P.z1],
      [P.x0 + lean, P.top, P.z0], [P.x1, P.top, P.z0], [P.x1, P.top, P.z1 - lean], [P.x0 + lean, P.top, P.z1 - lean],
    ],
    [
      [C.x0, y0, P.z0], [S.x0, y0, P.z0], [S.x0, y0, C.z0], [C.x0, y0, C.z0],
      [C.x0, P.top, P.z0], [S.x0, P.top, P.z0], [S.x0, P.top, C.z0], [C.x0, P.top, C.z0],
    ],
  ];
  const ys = [400, 650, 900, 1100];
  granite.color(TINT.granite, GAIN);
  granite.shade = (x, y) => (0.74 + 0.26 * Math.min(1, (y - y0) / (P.top - y0))) * (ys.some((j) => Math.abs(y - j) < 1) ? 0.88 : 1);
  for (const corners of shapes) granite.solid(hexaPolys(corners, { bottom: false, ys }));
  granite.shade = null;
  // The colliders: the back wall's first. In the chimney's corner he touches both, and a kick
  // goes off the last wall that pushed him: the pinnacle's face, which he meets head-on (were it
  // the back wall's, which he only grazes, he would stop against it and drop). The shed's wall
  // (houses.js) is wood, and the course's wood collider comes after its stone one, so the other
  // corner works the same.
  for (let i = shapes.length - 1; i >= 0; i--) solids.solid(hexaPolys(shapes[i], { bottom: false }), 'stone');
}

// The loft's railing: posts and two rails along its north and east edges; its collider a thin
// wall along each.
function loftRail(kit, { NET_SHED: S }) {
  const { wood, solids } = kit;
  const t = 20;
  const y = S.top;
  const runs = [
    { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z0 + t, post: (k) => [S.x0 + t / 2 + (S.x1 - S.x0 - t) * k, S.z0 + t / 2] },
    { x0: S.x1 - t, x1: S.x1, z0: S.z0, z1: S.z1, post: (k) => [S.x1 - t / 2, S.z0 + t / 2 + (S.z1 - S.z0 - t) * k] },
  ];
  wood.color(TINT.stringer);
  for (const r of runs) {
    wood.box(r.x0, r.x1, y + S.rail - 14, y + S.rail, r.z0, r.z1);
    wood.box(r.x0 + 4, r.x1 - 4, y + S.rail * 0.45, y + S.rail * 0.45 + 8, r.z0 + 4, r.z1 - 4);
    const n = Math.round(Math.max(r.x1 - r.x0, r.z1 - r.z0) / 150);
    for (let i = 0; i <= n; i++) {
      const [px, pz] = r.post(i / n);
      wood.box(px - 7, px + 7, y, y + S.rail - 14, pz - 7, pz + 7, { bottom: false, top: false });
    }
    solids.box(r.x0, r.x1, y, y + S.rail, r.z0, r.z1, 'wood', { bottom: false });
  }
}

// The net mast: a tarred pole on an iron foot ring, a crossbar under its tip (along x: clear of
// the climbing hero, who holds it from its south side) with a net hung over its east arm.
function netMast(kit, { NET_MAST: M }) {
  const { wood, nets } = kit;
  wood.color(TINT.iron);
  wood.lathe(M.x, M.z, [[60, M.y0], [60, M.y0 + 12], [M.radius + 4, M.y0 + 24]], 8, { flat: true });
  wood.color(TINT.mast);
  wood.lathe(M.x, M.z, [[M.radius, M.y0 + 20], [M.radius - 8, M.y1 - 6], [0, M.y1]], 8);
  const bar = M.y1 - 140;
  wood.color(TINT.stringer);
  wood.box(M.x - 170, M.x + 170, bar - 10, bar + 10, M.z - 9, M.z + 9);
  nets.color(TINT.net);
  const pts = [[M.x + 40, bar - 6, M.z], [M.x + 165, bar - 6, M.z], [M.x + 150, bar - 520, M.z], [M.x + 90, bar - 560, M.z], [M.x + 50, bar - 480, M.z]];
  nets.poly(pts, { facing: [0, 0, 1], uvs: pts.map(([x, y]) => [x / NET_TILE, y / NET_TILE]) });
}

// ---------------------------------------------------------------- the plank bridge

// The plank bridge: two sloping decks (a gap between them in the middle of its run) between
// flat landings at its head (on the chimney's back wall) and past its foot (on the terrace),
// each a slab of planks across two stringers; trestles under it.
function bridge(kit, layout) {
  const { wood, solids } = kit;
  const { head, foot, width, gap, landing } = layout.BRIDGE;
  const dx = foot.x - head.x;
  const dz = foot.z - head.z;
  const run = Math.hypot(dx, dz);
  const ux = dx / run;
  const uz = dz / run;
  const sx = uz; // across the bridge
  const sz = -ux;
  // A point s along the bridge (from its head), w across it, at height y; the deck's height.
  const P = (s, w, y) => [head.x + ux * s + sx * w, y, head.z + uz * s + sz * w];
  const deckY = (s) => (s <= 0 ? head.y : s >= run ? foot.y : head.y + ((foot.y - head.y) * s) / run);
  const half = width / 2;
  const g0 = (run - gap) / 2;
  const g1 = (run + gap) / 2;
  const uv = (s, w) => [s / PLANK, w / PLANK];

  for (const [s0, s1] of [[-landing, 0], [0, g0], [g1, run], [run, run + landing]]) {
    const y0 = deckY(s0);
    const y1 = deckY(s1);
    const corners = [
      P(s0, -half, y0 - DECK_THICK), P(s1, -half, y1 - DECK_THICK), P(s1, half, y1 - DECK_THICK), P(s0, half, y0 - DECK_THICK),
      P(s0, -half, y0), P(s1, -half, y1), P(s1, half, y1), P(s0, half, y0),
    ];
    solids.solid(hexaPolys(corners), 'wood');
    wood.color(TINT.deck);
    const top = [P(s0, -half, y0 + BRIDGE_LIFT), P(s1, -half, y1 + BRIDGE_LIFT), P(s1, half, y1 + BRIDGE_LIFT), P(s0, half, y0 + BRIDGE_LIFT)];
    wood.poly(top, { facing: [0, 1, 0], uvs: [uv(s0, -half), uv(s1, -half), uv(s1, half), uv(s0, half)], shade: 1.06 });
    // The planks' ends (at the gap) and underside, the stringers along both sides.
    wood.color(TINT.stringer);
    for (const s of [s0, s1]) {
      const y = deckY(s);
      wood.poly([P(s, -half, y - DECK_THICK), P(s, half, y - DECK_THICK), P(s, half, y + BRIDGE_LIFT), P(s, -half, y + BRIDGE_LIFT)], { facing: [s === s0 ? -ux : ux, 0, s === s0 ? -uz : uz], shade: 0.8 });
    }
    wood.poly([P(s0, -half, y0 - DECK_THICK), P(s1, -half, y1 - DECK_THICK), P(s1, half, y1 - DECK_THICK), P(s0, half, y0 - DECK_THICK)], { facing: [0, -1, 0], shade: 0.45 });
    for (const k of [-1, 1]) {
      wood.solid(beamPolys(P(s0, k * (half + 8), y0 - 26), P(s1, k * (half + 8), y1 - 26), [sx, 0, sz], 16, 44), { shade: 0.85 });
    }
  }

  // Trestles: near the head and the foot, and either side of the gap.
  const ground = groundUnder(layout);
  for (const s of [420, g0 - 60, g1 + 60, run - 420]) {
    const y = deckY(s) - DECK_THICK;
    const [cx, , cz] = P(s, 0, 0);
    const floor = ground(cx, cz);
    wood.color(TINT.post);
    for (const k of [-1, 1]) {
      const [px, , pz] = P(s, k * (half + POST + 6), 0);
      wood.box(px - POST, px + POST, floor - 20, y, pz - POST, pz + POST, { bottom: false });
      solids.box(px - POST, px + POST, floor - 20, y, pz - POST, pz + POST, 'wood');
    }
    wood.color(TINT.stringer);
    wood.solid(beamPolys(P(s, -half - 40, y - 14), P(s, half + 40, y - 14), [ux, 0, uz], 22, 28));
    // A brace across, corner to corner (drawn only).
    const low = Math.max(floor, y - 420);
    wood.solid(beamPolys(P(s, -half - POST - 6, low + 30), P(s, half + POST + 6, y - 40), [ux, 0, uz], 14, 14));
  }
}

// The floor under a point (local x, z), for the bridge's posts: East Rock's or the islet's
// first terrace's top where they are (their inscribed circles), else the seabed.
function groundUnder({ EAST_ROCK: E, ISLET, TERRACES, BAY }) {
  const inside = (x, z, cx, cz, r, sides) => Math.hypot(x - cx, z - cz) < r * Math.cos(Math.PI / sides);
  return (x, z) => {
    if (inside(x, z, E.x, E.z, E.r, E.sides)) return E.top;
    if (inside(x, z, ISLET.x, ISLET.z, TERRACES[0].r, TERRACES[0].sides)) return TERRACES[0].top;
    return BAY.bedY;
  };
}
