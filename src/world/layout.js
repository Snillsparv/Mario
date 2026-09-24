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

export const WATER_LEVEL = -20; // moat + pond surface (120 below the lawn rim, so it shows from the path)
export const MOAT_FLOOR = -1100; // moat/pond bottom (deep enough to swim)
export const LAWN_BASE = 100; // lawn height at the moat edge / bridge
export const ISLAND_TOP = 160; // castle island plateau (castle base, courtyard, rim)
export const CLIFF_TOP = 1600; // top of the perimeter cliffs: out of reach, but below the castle's walls

// ---------------------------------------------------------------- regions

// Playable area is bounded by vertical cliffs along this rounded rectangle.
export const PERIMETER = { minX: -7600, maxX: 7600, minZ: -7800, maxZ: 7400, radius: 2600 };

// Castle island: rounded rectangle, extends into the rear cliff so the moat is a "U".
export const ISLAND = { minX: -3400, maxX: 3400, minZ: -9000, maxZ: 250, radius: 700 };

// Outer edge of the moat (the lawn's retaining wall). Also extends into the rear cliff.
export const MOAT = { minX: -4300, maxX: 4300, minZ: -9000, maxZ: 1150, radius: 1100 };

// Pond on the west side, fed by the waterfall, connected to the west arm of the moat.
export const POND = { x: -5900, z: -1900, radius: 1800 };
const POND_DIP = LAWN_BASE - (WATER_LEVEL + 50); // the lawn sinks to 50 above the water at the pond edge

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

// Paved flagstone courtyard on the island between the bridge landing and the castle door
// (terrain paints it; it tucks slightly under the facade so no grass shows at the wall base).
export const COURTYARD = { minX: -1050, maxX: 1050, minZ: CASTLE.frontZ - 80, maxZ: ISLAND.maxZ + 200, radius: 160 };

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

// Low-poly 3D trees (also climbable poles). y is computed from groundHeight().
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
  // line up the east hill, from just past the moat rim toward the red coin on its summit
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ x: 4600 + i * 320, z: -1450 - i * 175 })),
  // along the island front courtyard
  ...[-1, 0, 1].map((i) => ({ x: i * 700, z: -50 })),
];

// Red coins: collect all 8 to make the star appear at STAR.
export const RED_COINS = [
  { x: -6800, z: 5600 },
  { x: 6900, z: 5200 },
  { x: 6500, z: -2500 }, // east hill summit (east of EAST_HILL: the hill fades toward the moat)
  { x: -5900, z: -1900, y: WATER_LEVEL - 450 }, // underwater in the pond
  { x: 0, z: 850, y: WATER_LEVEL - 300 }, // underwater under the bridge
  { x: 3000, z: -5600 }, // behind the castle, east
  { x: -3000, z: -5600 }, // behind the castle, west
  { x: -6600, z: -3900 },
];

// Readable wooden signs. Walk up to a sign's face and press B (J) to read it; `yaw` is the
// direction the readable face looks (the reader stands in front of it). Each page is shown in
// the dialog box in turn. All text is original to this game.
export const SIGNS = [
  {
    id: 'welcome',
    x: 430,
    z: 5150,
    yaw: Math.atan2(SPAWN.x - 430, SPAWN.z - 5150),
    pages: [
      'Welcome to the Castle Grounds!',
      'Eight red coins are hidden around the grounds. Find them all and a star will appear before the castle door.',
      'Coins also refill your power meter, so grab them when you are hurt.',
    ],
  },
  {
    id: 'moat',
    x: -760,
    z: 1700,
    yaw: 0,
    pages: [
      'Castle Moat',
      'The water is deep but calm. Press jump to swim a stroke, or hold it to kick along.',
      'To climb back out, swim west to the pond and walk up its sandy shore.',
    ],
  },
  {
    id: 'pond',
    x: -5600,
    z: 500,
    yaw: 0,
    pages: [
      'Waterfall Pool',
      'Something red glitters at the bottom of the pool...',
      'Watch your power meter while you are underwater, and come up for air before it runs out!',
    ],
  },
  {
    id: 'hill',
    x: 4850,
    z: 780,
    yaw: -Math.PI / 4,
    pages: [
      'East Hill',
      'Long jump: while running, crouch and then jump right away.',
      'Wall kick: jump into a wall, then press jump again just as you touch it.',
    ],
  },
  {
    id: 'garden',
    x: 2400,
    z: -5000,
    yaw: Math.PI / 2,
    pages: [
      'Back Garden',
      'Trees can be climbed! Jump onto a trunk, then push up to shimmy to the top.',
      'Press jump at the top to leap off.',
    ],
  },
];

// "AI RACE" floor button: ground-pound it to switch the grounds into (and back out of) the
// stormy sci-fi horror version, with the robot monster on the castle. Objects owns it.
export const AI_BUTTON = { x: -950, z: 4550, radius: 140 };

// Where the robot monster stands in AI RACE mode: on the castle's main roof in front of
// the keep, facing south over the courtyard (objects finds the roof height by raycast).
export const KAIJU = { x: 0, z: -2300, yaw: 0 };

// A floating mystery box (hit it from below) that releases the winged hat: y is the
// height of the box's underside above the ground, low enough to bump with a standing jump.
export const MYSTERY_BOX = { x: 1900, z: 4300, y: 340, size: 130 };

export const STAR = { x: 0, z: -100, y: ISLAND_TOP + 450 }; // above the courtyard, in front of the entrance steps

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
//   'cliff'  outside the perimeter (the cliff-top plateau, height = cliffHeight)
//   'water'  moat or pond, inside sdWater (floor = waterFloorHeight: MOAT_FLOOR, rising along
//            the pond's banks; water surface WATER_LEVEL)
//   'island' castle island plateau (height = islandHeight: ISLAND_TOP at its edges)
//   'lawn'   everything else (height = lawnHeight)
export function regionAt(x, z) {
  if (sdRoundRect(x, z, PERIMETER) > 0) return 'cliff';
  if (sdRoundRect(x, z, ISLAND) <= 0) return 'island';
  if (sdWater(x, z) <= 0) return 'water';
  return 'lawn';
}

// Outline of the water (moat + pond, negative inside). The two shapes are blended with a
// small fillet where the pond crosses the moat's west wall, so the lawn between them never
// narrows to a knife-edge tip that a grid-based mesh could not follow.
const WATER_FILLET = 300;
export function sdWater(x, z) {
  const a = sdRoundRect(x, z, MOAT);
  const b = sdCircle(x, z, POND);
  const h = clamp(0.5 + (0.5 * (b - a)) / WATER_FILLET, 0, 1);
  return b + (a - b) * h - WATER_FILLET * h * (1 - h);
}

// ---------------------------------------------------------------- low-poly facets

// The open lawn and the cliff-top plateau are low-poly, like an N64 level: their heights are
// linear over the triangles of a coarse FACET-unit lattice, so hills and slopes read as big
// flat facets. Lattice cell (i, j) spans [i, i + 1] x [j, j + 1] * FACET and is split along
// its (0,1)-(1,0) diagonal when facetFlip(i, j), else along (0,0)-(1,1); terrain meshes split
// their grid cells the same way so they follow the facets exactly.
export const FACET = 500;
export const facetFlip = (i, j) => ((i + j) & 1) === 1;

// Piecewise-linear interpolation of fn(x, z) over the facet lattice (lattice values cached).
function faceted(fn) {
  const cache = new Map();
  const at = (i, j) => {
    const key = i * 8192 + j;
    let h = cache.get(key);
    if (h === undefined) {
      h = fn(i * FACET, j * FACET);
      cache.set(key, h);
    }
    return h;
  };
  return (x, z) => {
    const i = Math.floor(x / FACET);
    const j = Math.floor(z / FACET);
    const u = x / FACET - i;
    const v = z / FACET - j;
    const h00 = at(i, j);
    const h10 = at(i + 1, j);
    const h01 = at(i, j + 1);
    const h11 = at(i + 1, j + 1);
    if (facetFlip(i, j)) {
      return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
    }
    return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
  };
}

// Lawn height: faceted, except within ~700 of the water where it blends back to the smooth
// profile, so the moat rim stays exactly level and the pond banks stay smooth (valid anywhere).
const facetedLawn = faceted(smoothLawnHeight);
export function lawnHeight(x, z) {
  const w = smoothstep(100, 700, sdWater(x, z));
  if (w >= 1) return facetedLawn(x, z);
  const h = smoothLawnHeight(x, z);
  return w <= 0 ? h : h + (facetedLawn(x, z) - h) * w;
}

// The lawn's underlying smooth profile.
function smoothLawnHeight(x, z) {
  let h = LAWN_BASE;
  // Rises gently toward the perimeter cliffs.
  const edge = -sdRoundRect(x, z, PERIMETER); // distance inside the perimeter
  h += 320 * (1 - smoothstep(0, 2200, edge));
  // Soft undulation.
  h += 28 * Math.sin(x * 0.0011 + 0.7) * Math.cos(z * 0.0009 - 0.4);
  h += 16 * Math.sin(x * 0.0023 - z * 0.0017 + 1.3);
  // Keep the moat edge and bridge approach level.
  const nearWater = sdWater(x, z);
  const flatten = 1 - smoothstep(150, 1200, nearWater);
  h = h + (LAWN_BASE - h) * flatten;
  // Dip toward the pond so its banks can slope gently down into the water.
  h -= POND_DIP * (1 - smoothstep(0, 1000, sdCircle(x, z, POND)));
  // Hills, faded out toward the water so the moat rim stays level at LAWN_BASE. The fade is
  // wide enough to keep the east hill's moat-side flank walkable (< 34 degrees), which moves
  // its summit ~700 east of EAST_HILL's centre.
  h += (hill(x, z, EAST_HILL) + hill(x, z, WEST_MOUND)) * smoothstep(0, 2400, nearWater);
  return h;
}

// Floor of the 'water' region. The moat (and the pond next to the waterfall and the moat
// mouth) is a flat bed at MOAT_FLOOR behind vertical walls; elsewhere the pond has a natural
// bank: the lawn keeps sloping down (~22 degrees) past the waterline, so a swimmer can walk
// out, then curves down to the deep bed. The profile has a continuous slope so a 100-unit
// terrain mesh follows it closely.
export function waterFloorHeight(x, z) {
  const bank = smoothstep(150, 1250, -sdRoundRect(x, z, PERIMETER)) * smoothstep(0, 1050, sdRoundRect(x, z, MOAT));
  if (bank <= 0) return MOAT_FLOOR;
  const shelf = Math.max(MOAT_FLOOR, lawnHeight(x, z) - pondDrop(-sdCircle(x, z, POND)));
  return MOAT_FLOOR + (shelf - MOAT_FLOOR) * bank;
}

// Depth of the pond bank below the lawn at distance d inside the pond edge: a 0.4 slope
// (~22 degrees) from the lawn edge (50 above the water) down to ~130 units below the
// waterline (a sandy beach and wading shelf), then the slope ramps linearly up to POND_STEEP
// and back down to 0, landing tangentially on the bed at MOAT_FLOOR.
const BEACH = 450; // end of the constant-slope shelf
const RAMP_UP = 450;
const RAMP_DOWN = 650;
const POND_DROP = LAWN_BASE - POND_DIP - MOAT_FLOOR;
const POND_STEEP = (POND_DROP - 0.4 * BEACH - 0.2 * RAMP_UP) / ((RAMP_UP + RAMP_DOWN) / 2);
function pondDrop(d) {
  if (d <= 0) return 0;
  if (d <= BEACH) return 0.4 * d;
  if (d <= BEACH + RAMP_UP) {
    const t = d - BEACH;
    return 0.4 * BEACH + 0.4 * t + ((POND_STEEP - 0.4) * t * t) / (2 * RAMP_UP);
  }
  const t = Math.min(d - BEACH - RAMP_UP, RAMP_DOWN);
  return 0.4 * BEACH + ((0.4 + POND_STEEP) * RAMP_UP) / 2 + POND_STEEP * t - (POND_STEEP * t * t) / (2 * RAMP_DOWN);
}

// Cliff-top plateau (faceted): CLIFF_TOP near the rim, rolling up into low distant hills
// farther out. The rim itself swells by 0..300 in long, irregular waves (fading out over the
// first 800 units behind it) so the skyline undulates; it stays level around the waterfall's
// spillway.
export const cliffHeight = faceted((x, z) => {
  const sd = sdRoundRect(x, z, PERIMETER);
  let h = CLIFF_TOP;
  const crest = (1 - smoothstep(0, 800, sd)) * smoothstep(700, 1500, Math.hypot(x - WATERFALL.x, z - WATERFALL.z));
  if (crest > 0) {
    const wave = 0.5 + 0.3 * Math.sin(x * 0.0009 + z * 0.0005 + 0.8) + 0.2 * Math.sin(x * 0.0021 - z * 0.0016 + 2.3);
    h += 300 * crest * wave;
  }
  const ramp = smoothstep(2000, 6000, sd);
  if (ramp <= 0) return h;
  const roll =
    0.62 + 0.3 * Math.sin(x * 0.00061 + 1.1) * Math.cos(z * 0.00053 - 0.3) + 0.18 * Math.sin((x + 2 * z) * 0.0011);
  return h + ramp * 500 * roll;
});

// Castle island top: ISLAND_TOP along its retaining walls, around the castle and on the
// courtyard; the open lawns beside and behind the castle swell gently (up to ~+100 toward
// the rear cliff) so they aren't a dead-flat sheet.
const CASTLE_BOX = { minX: CASTLE.x - CASTLE.halfWidth, maxX: CASTLE.x + CASTLE.halfWidth, minZ: CASTLE.backZ, maxZ: CASTLE.frontZ, radius: 0 };
export function islandHeight(x, z) {
  const free =
    smoothstep(300, 1000, -sdRoundRect(x, z, ISLAND)) *
    smoothstep(300, 900, sdRoundRect(x, z, CASTLE_BOX)) *
    smoothstep(0, 500, sdRoundRect(x, z, COURTYARD));
  if (free <= 0) return ISLAND_TOP;
  const swell = 75 * smoothstep(CASTLE.backZ, PERIMETER.minZ, z) + 30 * Math.sin(x * 0.0017 + 0.4) * Math.cos(z * 0.0013 + 1.1);
  return ISLAND_TOP + free * swell;
}

// Height of a region's surface at (x, z); valid slightly past the region's edge so meshes can
// evaluate both sides of a boundary (the terrain builds vertical walls between them).
export function regionHeight(region, x, z) {
  switch (region) {
    case 'cliff':
      return cliffHeight(x, z);
    case 'island':
      return islandHeight(x, z);
    case 'water':
      return waterFloorHeight(x, z);
    default:
      return lawnHeight(x, z);
  }
}

function hill(x, z, H) {
  const d = Math.hypot(x - H.x, z - H.z) / H.radius;
  if (d >= 1) return 0;
  return H.height * 0.5 * (1 + Math.cos(Math.PI * d));
}

// Canonical ground height at (x, z) for placing things.
export function groundHeight(x, z) {
  return regionHeight(regionAt(x, z), x, z);
}

// Water surface height at (x, z), or NO_WATER (also on the pond's dry beach, which belongs
// to the 'water' region but lies above the surface).
export function waterLevelAt(x, z) {
  return regionAt(x, z) === 'water' && waterFloorHeight(x, z) < WATER_LEVEL ? WATER_LEVEL : NO_WATER;
}

// Sun used for baked vertex lighting and the character's directional light.
export const SUN_DIR = (() => {
  const v = { x: 0.45, y: 0.8, z: 0.4 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
