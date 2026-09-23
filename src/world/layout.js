// Canonical layout of the castle grounds. Every world builder (terrain, castle, props,
// objects) reads positions and heights from here so the pieces line up.
//
// Orientation: the castle is to the north (-Z). The player spawns in the south (+Z)
// looking north across the lawn, down a path to the drawbridge over the moat.
//
//                  -Z (north)
//        ┌──────── rear cliff ─────────┐
//        │      │  castle island  │     │
//   west │ pond │▓▓▓▓ CASTLE ▓▓▓▓▓│ hill│ east
//  (-X)  │ ≈≈≈≈ │  moat wraps U   │     │ (+X)
//  wfall │      └────── bridge ───┘     │
//        │            path              │
//        │          SPAWN               │
//        └──────── south cliff ─────────┘
//                  +Z (south)
//
// Ownership: the terrain module owns the *shape* of groundHeight()/regionAt() (it may tune
// the internals so its mesh matches), but anchor constants (positions and sizes of the
// castle, bridge, island, moat, pond, waterfall, spawn, lists of trees/fences/coins) are
// shared contract and must not move without updating every consumer.

import { NO_WATER } from '../core/constants.js';
import { clamp, smoothstep } from '../core/math.js';

// ---------------------------------------------------------------- heights

export const WATER_LEVEL = -420; // moat + pond surface
export const MOAT_FLOOR = -1100; // moat/pond bottom (deep enough to swim)
export const LAWN_BASE = 100; // lawn height at the moat edge / bridge
export const ISLAND_TOP = 160; // castle island plateau (flat)
export const CLIFF_TOP = 2600; // top of the perimeter cliffs (not reachable)

// ---------------------------------------------------------------- regions

// Playable area is bounded by vertical cliffs along this rounded rectangle.
export const PERIMETER = { minX: -7600, maxX: 7600, minZ: -7800, maxZ: 7400, radius: 2600 };

// Castle island: rounded rectangle, extends into the rear cliff so the moat is a "U".
export const ISLAND = { minX: -3400, maxX: 3400, minZ: -9000, maxZ: 250, radius: 700 };

// Outer edge of the moat (the lawn's retaining wall). Also extends into the rear cliff.
export const MOAT = { minX: -4300, maxX: 4300, minZ: -9000, maxZ: 1150, radius: 1100 };

// Pond on the west side, fed by the waterfall, connected to the west arm of the moat.
export const POND = { x: -5900, z: -1900, radius: 1800 };

// Waterfall pours from the west perimeter cliff top into the pond.
export const WATERFALL = { x: -7600, z: -1900, width: 900, topY: CLIFF_TOP - 300, faceNormalX: 1 };

// East hill, a smooth grassy mound with trees on it.
export const EAST_HILL = { x: 5700, z: -2600, radius: 2500, height: 850 };

// Gentle mound in the south-west tree grove.
export const WEST_MOUND = { x: -4600, z: 4200, radius: 1900, height: 260 };

// ---------------------------------------------------------------- anchors

// The hero drops in here at the start, facing the castle.
export const SPAWN = { x: 0, z: 5700, yaw: Math.PI };

// Drawbridge from the lawn (south end) to the island (north end), centred on x = 0.
export const BRIDGE = { x: 0, width: 700, southZ: 1300, northZ: 150, deckY: LAWN_BASE + 20 };

// Castle footprint: the front facade is at frontZ, the building extends north to backZ.
// Door is centred on x = 0 in the front facade. Castle builder owns everything inside.
export const CASTLE = {
  x: 0,
  frontZ: -700,
  backZ: -4600,
  halfWidth: 2300,
  baseY: ISLAND_TOP,
  doorWidth: 420,
  doorHeight: 620,
  mainHeight: 1900, // height of the main body walls above baseY
  keepTopY: ISLAND_TOP + 5200, // tip of the central tower roof / flag
};

// Dirt/stone walking path from spawn to the bridge, and a loop around the front lawn.
export const PATHS = [
  {
    width: 520,
    points: [
      { x: 0, z: 6200 },
      { x: 0, z: 4600 },
      { x: -150, z: 3200 },
      { x: 0, z: 2000 },
      { x: 0, z: BRIDGE.southZ + 40 },
    ],
  },
  {
    width: 460,
    points: [
      { x: 3000, z: 2100 },
      { x: 1400, z: 2000 },
      { x: 0, z: 2000 },
      { x: -1500, z: 2150 },
      { x: -3200, z: 2000 },
    ],
  },
];

// Billboard trees (also climbable poles). y is computed from groundHeight().
export const TREES = [
  { x: -2600, z: 5200 },
  { x: -3900, z: 3500 },
  { x: -5200, z: 4700 },
  { x: -4700, z: 2600 },
  { x: -6100, z: 3200 },
  { x: -3300, z: 4400 },
  { x: 2700, z: 5000 },
  { x: 4200, z: 3800 },
  { x: 5600, z: 4600 },
  { x: 6200, z: 2800 },
  { x: 4900, z: -800 },
  { x: 6500, z: -1700 },
  { x: 5200, z: -3900 },
  { x: 6400, z: -4700 },
  { x: -6400, z: 700 },
  { x: -5000, z: -4400 },
  { x: -6600, z: -5100 },
  { x: 2900, z: -6200 },
  { x: -2900, z: -6300 },
];

// Wooden fences: polylines of posts along the moat's outer edge in front of the castle,
// leaving the bridge approach open.
export const FENCES = [
  {
    points: [
      { x: -4420, z: 300 },
      { x: -3400, z: 1250 },
      { x: -1200, z: 1420 },
      { x: -520, z: 1420 },
    ],
  },
  {
    points: [
      { x: 520, z: 1420 },
      { x: 1200, z: 1420 },
      { x: 3400, z: 1250 },
      { x: 4420, z: 300 },
    ],
  },
];

// Collectibles. Coins are placed at groundHeight + 60 unless y is given.
export const COINS = [
  // line leading up the path
  ...[0, 1, 2, 3, 4].map((i) => ({ x: 0, z: 4400 - i * 350 })),
  // ring in the west grove
  ...Array.from({ length: 8 }, (_, i) => ({
    x: -4600 + Math.cos((i / 8) * Math.PI * 2) * 500,
    z: 4200 + Math.sin((i / 8) * Math.PI * 2) * 500,
  })),
  // line up the east hill
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ x: 3600 + i * 380, z: -1400 - i * 230 })),
  // along the island front courtyard
  ...[-1, 0, 1].map((i) => ({ x: i * 700, z: -50 })),
];

// Red coins: collect all 8 to make the star appear at STAR.
export const RED_COINS = [
  { x: -6800, z: 5600 },
  { x: 6900, z: 5200 },
  { x: EAST_HILL.x, z: EAST_HILL.z }, // hill top
  { x: -5900, z: -1900, y: WATER_LEVEL - 450 }, // underwater in the pond
  { x: 0, z: 850, y: WATER_LEVEL - 300 }, // underwater under the bridge
  { x: 3000, z: -5600 }, // behind the castle, east
  { x: -3000, z: -5600 }, // behind the castle, west
  { x: -6600, z: -3900 },
];

export const STAR = { x: 0, z: 150 - 450, y: ISLAND_TOP + 450 }; // above the courtyard in front of the door

// Butterflies flutter around these spots; birds circle high overhead.
export const BUTTERFLY_SPOTS = [
  { x: -3600, z: 4000 },
  { x: 3500, z: 4200 },
  { x: -2000, z: -200 },
  { x: 5200, z: -2000 },
];
export const BIRD_CIRCLES = [
  { x: 0, z: -1000, y: 3600, radius: 2600 },
  { x: -4000, z: 3000, y: 3000, radius: 1400 },
];

// ---------------------------------------------------------------- SDF helpers

// Signed distance to a rounded rectangle in XZ (negative inside).
export function sdRoundRect(x, z, r) {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const hx = (r.maxX - r.minX) / 2 - r.radius;
  const hz = (r.maxZ - r.minZ) / 2 - r.radius;
  const qx = Math.abs(x - cx) - hx;
  const qz = Math.abs(z - cz) - hz;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r.radius;
}

export function sdCircle(x, z, c) {
  return Math.hypot(x - c.x, z - c.z) - c.radius;
}

// Distance from (x, z) to a polyline path (unsigned).
export function distToPath(x, z, path) {
  let best = Infinity;
  const pts = path.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

// 0..1 "how much path" at (x, z), for texture blending. 1 = centre of a path.
export function pathMask(x, z) {
  let m = 0;
  for (const p of PATHS) {
    const d = distToPath(x, z, p);
    m = Math.max(m, 1 - smoothstep(p.width * 0.35, p.width * 0.5, d));
  }
  return m;
}

// Which region a point belongs to:
//   'cliff'  outside the perimeter (the cliff-top plateau)
//   'water'  moat or pond (height = MOAT_FLOOR, water surface WATER_LEVEL)
//   'island' castle island plateau (height = ISLAND_TOP)
//   'lawn'   everything else (height = lawnHeight)
export function regionAt(x, z) {
  if (sdRoundRect(x, z, PERIMETER) > 0) return 'cliff';
  if (sdRoundRect(x, z, ISLAND) <= 0) return 'island';
  if (sdRoundRect(x, z, MOAT) <= 0 || sdCircle(x, z, POND) <= 0) return 'water';
  return 'lawn';
}

// Smooth lawn surface height (ignores region; valid anywhere).
export function lawnHeight(x, z) {
  let h = LAWN_BASE;
  // Rises gently toward the perimeter cliffs.
  const edge = -sdRoundRect(x, z, PERIMETER); // distance inside the perimeter
  h += 320 * (1 - smoothstep(0, 2200, edge));
  // Soft undulation.
  h += 28 * Math.sin(x * 0.0011 + 0.7) * Math.cos(z * 0.0009 - 0.4);
  h += 16 * Math.sin(x * 0.0023 - z * 0.0017 + 1.3);
  // Keep the moat edge and bridge approach level.
  const nearMoat = Math.min(sdRoundRect(x, z, MOAT), sdCircle(x, z, POND));
  const flatten = 1 - smoothstep(150, 900, nearMoat);
  h = h + (LAWN_BASE - h) * flatten;
  // Hills.
  h += hill(x, z, EAST_HILL);
  h += hill(x, z, WEST_MOUND);
  return h;
}

function hill(x, z, H) {
  const d = Math.hypot(x - H.x, z - H.z) / H.radius;
  if (d >= 1) return 0;
  return H.height * 0.5 * (1 + Math.cos(Math.PI * d));
}

// Canonical ground height at (x, z) for placing things.
export function groundHeight(x, z) {
  switch (regionAt(x, z)) {
    case 'cliff':
      return CLIFF_TOP;
    case 'island':
      return ISLAND_TOP;
    case 'water':
      return MOAT_FLOOR;
    default:
      return lawnHeight(x, z);
  }
}

// Water surface height at (x, z), or NO_WATER.
export function waterLevelAt(x, z) {
  return regionAt(x, z) === 'water' ? WATER_LEVEL : NO_WATER;
}

// Sun used for baked vertex lighting and the character's directional light.
export const SUN_DIR = (() => {
  const v = { x: 0.45, y: 0.8, z: 0.4 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
