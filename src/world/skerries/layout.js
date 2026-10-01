// Midsummer Skerries (area 'skerries', course name MIDSUMMER SKERRIES), the first course,
// reached through the neck of the ship in the bottle in the Great Hall: a sheltered bay of
// pink-grey granite skerries in midsummer evening light. Jonas starts on the jetty of Home
// Island, where the red-sailed boat from the bottle is moored; far out on the last rock a white
// lighthouse with a red band holds the star on its lamp gallery, in view from the first second.
// The way there: hop across the stepping skerries to the west (one gap wants a long jump) or
// swim across the Sound to the islet's beach, climb its terraces, then the signal mast, and
// jump from its top onto the gallery. Water catches every missed jump.
// Everything here is in the course's own local frame: 1 unit = 1 cm, sea level at y 0, +x
// east, -z north (toward the lighthouse). world/areas.js places it at its origin (world =
// local + origin); world/area.js shifts these anchors into world coordinates.
//
//                         -Z (north)
//        ┌── net racks ── reef ── net racks ── reef ── net racks ──┐
//        │        great rock ┐  ┌ islet: three terraces            │
//        │        s5         └──┤  lighthouse (star), mast         │
//        │                      └ stair, blocks; south beach       │
//   west │  s4  (long jump)                                         │ east
//   cliff│  s3                  the Sound (open water)              │ cliff
//        │      s2                                                  │
//        │        s1     boat  jetty                                │
//        │           ┌── Home Island ─────────┐ beach               │
//        └───────────┴──── meadow ────────────┴─────────────────────┘
//                         +Z (south): the mainland cliffs
//
// Ownership: like world/layout.js, the anchors are shared contract: the builders
// (skerries/build.js, lighthouse.js, sea.js), the objects (COINS, STAR, SIGNS, POLES) and the
// entry all read them. The builders own everything drawn around them.

import { NO_WATER } from '../../core/constants.js';

// ---------------------------------------------------------------- the bay

// The bay: open water at SEA_LEVEL over a sand seabed at bedY, shut in by one enclosure of
// invisible walls up to wallTop (the mainland cliffs west, east and south, and the net racks
// along the outer reef in the north, are drawn just outside them). The walls stand higher than
// anything Jonas can reach (the gallery is at 2750, a jump from it peaks at about 3000) and
// seal off the cliff tops.
export const SEA_LEVEL = 0;
export const BAY = { x0: -5200, x1: 5200, z0: -6600, z1: 5400, bedY: -800, wallTop: 4500 };
// The authoring rule at the edges: no pole tip and no spot to stand on higher than `y` lies
// within `dist` of the enclosure (nothing up high to leap over it from).
export const EDGE_RULE = { dist: 1200, y: 900 };

// The water's surface: SEA_LEVEL inside the bay, none outside (local coordinates).
export function waterLevelAt(x, z) {
  return x >= BAY.x0 && x <= BAY.x1 && z >= BAY.z0 && z <= BAY.z1 ? SEA_LEVEL : NO_WATER;
}

// Golden-hour sun for the baked lighting: low in the west-south-west.
export const SKERRIES_SUN = (() => {
  const v = { x: -0.5, y: 0.45, z: 0.74 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// Rocks rise out of the water on sheer granite sides (a water jump slides up them onto the
// top, a hop that falls short grabs the edge) and flare out under the water down to the
// seabed. A skerry of size r is a regular polygon of `sides` (a reef rock of reefSides) whose
// walkable top's radius is SKERRY.topK times r (the hops' gaps are measured between tops) and
// its foot's SKERRY.footK times r; bigger rocks give their foot as a distance out from their
// top's edge (SHORE).
export const SKERRY = { sides: 10, reefSides: 8, topK: 0.72, footK: 1.25 };
export const SHORE = { foot: 420 };

// ---------------------------------------------------------------- Home Island (the start)

// A granite plateau with a meadow in the middle (MEADOW: the meadow's share of the top, toward
// its middle), its south side against the mainland cliffs. Its top outline is convex
// (clockwise seen from above, from the north-west corner).
export const HOME = {
  top: 150,
  outline: [[-1900, 2000], [1500, 1700], [2300, 3200], [1700, 5400], [-2100, 5400], [-2400, 3400]],
};
export const MEADOW = 0.72;
// A sand beach down into the water along the island's north-east edge (outline points 1 to 2),
// from the top's edge `run` out to `foot` under the water (30 degrees): wading in and out.
export const HOME_BEACH = { edge: 1, run: 700, foot: -250 };

// The jetty off the island's north shore, level with the island's top (it runs on over the
// island's flank into its top, so no steep bit lies between them), on a stone crib boarded down
// to the water (solid to the seabed: nothing to swim under); the red-sailed boat moored
// alongside to the west, its hull against the jetty's side (no crevice between them), its deck
// a step down, its mast a climbable pole.
export const JETTY = { x0: -1050, x1: -750, z0: 600, z1: 2000, top: HOME.top };
export const BOAT = { x0: -1430, x1: -1040, z0: 760, z1: 1700, deck: 80 };
export const BOAT_MAST = { x: (BOAT.x0 + BOAT.x1) / 2, z: 1230, y0: BOAT.deck, y1: 1350, radius: 30 };

// ---------------------------------------------------------------- the stepping skerries (west)

// Granite rocks from Home Island's north-west corner out to the islet's Great Rock, every top
// at most 260 over the sea (a water jump gets him out onto any of them; r is the rock's size:
// its top's radius is SKERRY.topK times that, its foot on the seabed wider). The gaps
// between their tops (443 to 607, a running jump clears 818) all but one: s4 is the runway
// for the 1039 gap to s5, a long jump. Great Rock is the islet's west spur (its top is the
// first terrace's).
export const SKERRIES = [
  { id: 's1', x: -2450, z: 1450, r: 380, top: 140 },
  { id: 's2', x: -3150, z: 750, r: 380, top: 190 },
  { id: 's3', x: -3450, z: -350, r: 360, top: 230 },
  { id: 's4', x: -3300, z: -1500, r: 600, top: 200 },
  { id: 's5', x: -2650, z: -3150, r: 420, top: 160 },
  { id: 'great_rock', x: -2000, z: -4300, r: 700, top: 300 },
];
export const skerry = (id) => SKERRIES.find((s) => s.id === id);

// Low reef rocks along the outer reef in the north (tops 60 to 120), in front of the net racks.
export const REEF = [
  { x: -4700, z: -6380, r: 260, top: 80 },
  { x: -3900, z: -6300, r: 320, top: 120 },
  { x: -3150, z: -6420, r: 220, top: 60 },
  { x: 2750, z: -6280, r: 240, top: 90 },
  { x: 3450, z: -6400, r: 300, top: 110 },
  { x: 4200, z: -6300, r: 260, top: 70 },
  { x: 4800, z: -6430, r: 220, top: 100 },
];

// ---------------------------------------------------------------- the lighthouse islet (north)

// A granite mound round (x, z) in three terraces, each a polygon of `sides` (r: its corners'
// radius; an edge faces south and east) with rock faces between them: the first's sides drop
// sheer into the water like a skerry's (its foot SHORE_ISLET out), the upper two stand on the
// one below.
export const ISLET = { x: 0, z: -4300 };
export const TERRACES = [
  { top: 300, r: 2000, sides: 16 },
  { top: 750, r: 1400, sides: 16 },
  { top: 1150, r: 900, sides: 12 },
];
export const SHORE_ISLET = { foot: 600 };
// The south beach up out of the Sound onto the first terrace (33 degrees): as wide as the
// terrace's south edge, from that edge (its top meets the terrace's top there) out under the
// water.
export const ISLET_BEACH = (() => {
  const t = TERRACES[0];
  const half = t.r * Math.sin(Math.PI / t.sides) - 10;
  return { x0: ISLET.x - half, x1: ISLET.x + half, z0: ISLET.z + t.r * Math.cos(Math.PI / t.sides), z1: -1500, top: t.top, foot: -250 };
})();
// First terrace to second, the easy way: two stone blocks against the second's east face
// (as deep as its flat east edge allows), steps of 150 (the hard way: a double jump up the
// face).
export const BLOCKS = [
  { x0: 1700, x1: 1950, z0: -4540, z1: -4060, top: 450 },
  { x0: 1340, x1: 1700, z0: -4540, z1: -4060, top: 600 },
];
// Second terrace to third: a wooden stair (a smooth ramp collider under drawn steps, 27
// degrees, on a stone base down to the first terrace) from its foot on the second terrace to a
// stone landing at its head, flush with the third terrace's top and reaching into it, so the
// stair meets the terrace along a straight edge.
export const STAIR = { foot: { x: -1080, y: 750, z: -3700 }, head: { x: -850, y: 1150, z: -4420 }, width: 240, steps: 12, landing: 220 };

// The lighthouse on the third terrace: a tapering white tower with a red band, the lamp gallery
// round its top (a floor out to galleryR behind a railing, open over `gap` facing south toward
// the signal mast), the lantern room (glass between corner posts; its glow and beam are lit
// once the star is won) and a red domed cap.
export const LIGHTHOUSE = {
  x: 0,
  z: -4600,
  foot: 1150,
  r0: 340,
  r1: 280,
  sides: 12,
  band: [2200, 2400],
  gallery: 2750,
  galleryR: 600,
  galleryThick: 60,
  rail: 100,
  railThick: 20,
  gap: (70 * Math.PI) / 180,
  lanternR: 250,
  lanternTop: 3350,
  capR: 300,
  capTop: 3650,
};
// The signal mast on the third terrace, south of the lighthouse: its tip 150 under the gallery
// floor and 400 from the gallery's edge. Up the mast, a handstand on its tip and the big jump
// off it toward the lighthouse: the lantern stops an overshoot and he drops onto the gallery.
// While he holds it the camera swings round to its south side (camYaw, the orbit yaw, as an
// entry's) and he works his way round to that side, so the camera looks past him at the
// lighthouse however he came to it (up the stair he grabs it facing south-east, his back to the
// lighthouse): pushing toward it is pushing the stick up. That also keeps the camera off the
// gallery when he walks off its gap onto the mast.
export const MAST = { x: 0, z: -3600, y0: TERRACES[2].top, y1: 2600, radius: 30, camYaw: 0 };

// ---------------------------------------------------------------- the edges (drawn only)

// The mainland cliffs (outside the enclosure's west, south and east walls): faceted granite up
// to about `top` under grass, firs on top; the side cliffs run on north past the reef to
// `northZ`, sinking to `tipTop`.
export const CLIFFS = { top: 1500, cap: 2600, step: 700, recess: 160, northZ: -7600, tipTop: 300, firs: 46 };
// Net-drying racks just outside the north wall: posts `height` tall every `every`, nets hung
// between them.
export const NETS = { z: BAY.z0 - 40, x0: -4800, x1: 4800, every: 600, height: 900, netLow: 180, netHigh: 860 };

// ---------------------------------------------------------------- entry, star, pickups, signs

// Out of the bottle Jonas drops in from the sky onto the jetty, facing north up the Sound toward
// the lighthouse (the camera behind him over the jetty and the island), in the lane up the
// jetty's east side that the welcome sign (its board out to x -902) leaves free: a straight push
// forward runs him up the jetty past the sign through its coins. A lost life drops him in
// there again.
const LANE_X = -830;
export const ENTRIES = {
  arrival: { x: LANE_X, y: JETTY.top, z: 1700, yaw: Math.PI, drop: 1600 },
};
export const RESPAWN = { entry: 'arrival', drop: 1600 };
// Height the ground probe starts from (under the lantern's roof).
export const PROBE_Y = 3300;

// The course's star waits on the gallery's east side from the start (160 over its floor).
export const STAR = { id: 'skerries_star', x: 440, y: LIGHTHOUSE.gallery + 160, z: LIGHTHOUSE.z, placed: true };

// No doors: the way out is the pause screen's (world/areas.js `leave`) or the star.
export const DOORS = [];

// 31 coins, each at its floor + 60 but those in the air (the long jump's arc, up the mast):
// along the jetty, one over each stepping skerry, an arc over the long jump's gap, on Great
// Rock, by and on the blocks, on the second terrace and the stair, up the mast (the climbing
// hero is 60 off its axis, inside the pickup radius) and round the gallery.
const above = (y) => y + 60;
const longJump = (() => {
  const a = skerry('s4');
  const b = skerry('s5');
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / d;
  const uz = (b.z - a.z) / d;
  const from = a.r * SKERRY.topK;
  const gap = d - from - b.r * SKERRY.topK;
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => {
    const s = from + gap * f;
    return { x: a.x + ux * s, y: 350 + 100 * Math.sin(Math.PI * f), z: a.z + uz * s };
  });
})();
const stairAt = (k) => {
  const { foot, head } = STAIR;
  return { x: foot.x + (head.x - foot.x) * k, y: above(foot.y + (head.y - foot.y) * k), z: foot.z + (head.z - foot.z) * k };
};
const gallery = [45, 135, 225, 315].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: LIGHTHOUSE.x + Math.sin(a) * 440, y: above(LIGHTHOUSE.gallery), z: LIGHTHOUSE.z + Math.cos(a) * 440 };
});
export const COINS = [
  ...[1450, 1250, 1050, 850, 650].map((z) => ({ x: LANE_X, y: above(JETTY.top), z })),
  ...SKERRIES.slice(0, 5).map((s) => ({ x: s.x, y: above(s.top), z: s.z })),
  ...longJump,
  { x: -2250, y: above(300), z: -4200 },
  { x: -2050, y: above(300), z: -4550 },
  { x: 1500, y: above(TERRACES[0].top), z: -3700 },
  { x: (BLOCKS[0].x0 + BLOCKS[0].x1) / 2, y: above(BLOCKS[0].top), z: -4300 },
  { x: (BLOCKS[1].x0 + BLOCKS[1].x1) / 2 + 60, y: above(BLOCKS[1].top), z: -4300 },
  { x: 1100, y: above(TERRACES[1].top), z: -4300 },
  { x: -1150, y: above(TERRACES[1].top), z: -3950 },
  stairAt(0.35),
  stairAt(0.7),
  ...[1500, 1900, 2300].map((y) => ({ x: MAST.x, y, z: MAST.z })),
  ...gallery,
];

// Signposts (props/decor.js addSignpost; each stands on the floor at its y): on the jetty by
// the arrival (148 of deck free beside it: the arrival's lane), on s4 west of the hop in and
// the runway out (the long jump), and on the third terrace by the signal mast, facing the
// stair's head.
export const SIGNS = [
  {
    id: 'skerries_welcome',
    x: -990,
    y: JETTY.top,
    z: 1200,
    yaw: 0,
    pages: [
      'Midsummer Skerries',
      'A star has landed on top of the old lighthouse, far out on the last rock.',
      'Hop across the skerries to the west, or swim across the sound. The water is cold but friendly!',
      'Press pause if you want to leave the course.',
    ],
  },
  {
    id: 'skerries_longjump',
    x: -3450,
    y: 200,
    z: -1500,
    yaw: Math.PI / 2,
    pages: ['The Long Jump', 'This gap is too wide for a normal jump.', 'Run, press crouch and jump at the same time to leap far!'],
  },
  {
    id: 'skerries_mast',
    x: -300,
    y: TERRACES[2].top,
    z: -3750,
    yaw: Math.atan2(STAIR.head.x + 300, STAIR.head.z + 3750),
    pages: ['The Signal Mast', 'Climb all the way up and stand on your hands on the top.', 'Then jump toward the lighthouse!'],
  },
];

// Climbable poles (CollisionWorld.addPole): the boat's mast and the signal mast.
export const POLES = [BOAT_MAST, MAST];
