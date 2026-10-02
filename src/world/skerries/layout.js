// Midsummer Skerries (area 'skerries', course name MIDSUMMER SKERRIES), the first course,
// reached through the neck of the ship in the bottle in the Great Hall: a sheltered bay of
// pink-grey granite skerries in midsummer evening light. Jonas starts on the jetty of Home
// Island, where the red-sailed boat from the bottle is moored; far out on the last rock a white
// lighthouse with a red band holds the star on its lamp gallery, in view from the first second.
// The way there: hop across the stepping skerries to the west (one gap wants a long jump),
// swim across the Sound to the islet's beach (diving on the way to the sunken rowing boat and
// its 1-up), or take the fishermen's boardwalk east to East Rock, wall-kick up the chimney
// beside the net shed (or climb the net mast) onto its loft and walk the plank bridge down onto
// the islet; then climb its terraces and the signal mast, and jump from its top onto the
// gallery. Water catches every missed jump. Home Island has a maypole, a cottage and a
// flagpole on its meadow, butterflies over it and gulls circling, and the course's critters:
// Wreath Frogs hopping on it and Mosquitoes over it; a Tin Crab hides on the sand bar in the
// Sound and another on the islet.
// Everything here is in the course's own local frame: 1 unit = 1 cm, sea level at y 0, +x
// east, -z north (toward the lighthouse). world/areas.js places it at its origin (world =
// local + origin); world/area.js shifts these anchors into world coordinates.
//
//                         -Z (north)
//        ┌── net racks ── reef ── net racks ── reef ── net racks ──┐
//        │        great rock ┐  ┌ islet: three terraces, firs, crab│
//        │        s5         └──┤  lighthouse (star), mast         │
//        │                      └ stair, blocks, hut; beach  ╲     │
//   west │  s4  (long jump)        sunken boat      plank bridge   │ east
//   cliff│  s3                  the Sound      net shed ┐ East Rock│ cliff
//        │      s2            sand bar (crab) chimney ──┘ boathouse│
//        │        s1     boat  jetty                  boardwalk    │
//        │      ┌ Home Island (frogs, mosquitoes) ┐ beach ──┘      │
//        └──────┴─────── maypole, cottage ────────┴─────────────────┘
//                         +Z (south): the mainland cliffs
//
// Ownership: like world/layout.js, the anchors are shared contract: the builders
// (skerries/build.js, lighthouse.js, east.js, props.js, sea.js), the objects (COINS, ONE_UP,
// STAR, SIGNS, POLES, BUTTERFLY_SPOTS, BIRD_CIRCLES, CRITTERS) and the entry all read them. The
// builders own everything drawn around them.

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
// The keeper's hut on the second terrace, north of the plank bridge's foot (Falu-red planks, a
// tarred board roof; solid), built into the third terrace's south-east corner: its west wall
// lies inside the rock all along, so no narrowing crack is left between them to squeeze into,
// and its ridge stays under the terrace's top. Two firs on the terrace's north-west side, past
// the stair's head.
export const HUT = { x0: 690, x1: 990, z0: -4070, z1: -3770, eaves: TERRACES[1].top + 260, ridge: TERRACES[2].top - 10 };
export const FIRS = [
  { x: -1200, z: -4600, h: 700, r: 170 },
  { x: -1000, z: -4950, h: 820, r: 190 },
];

// ---------------------------------------------------------------- the east route

// East Rock: a flat granite rock (a regular polygon of `sides` with corners at r, an edge facing
// south, rising sheer out of the sea like a skerry) carrying the fishermen's buildings: a red
// boathouse on its east side; the tall red net shed, its flat roof a loft Jonas can walk on
// (`top`, a railing `rail` high along its north and east edges); and west of it a granite
// pinnacle as tall. Between the pinnacle's east face and the shed's west wall runs the
// wall-kick chimney, 360 wide, open to the south, shut at its north end by a granite wall
// `back` thick from the pinnacle across to the shed, as tall: kicking back and forth up the
// chimney reaches the loft (or the pinnacle's top), and the back wall's top joins the two.
// The easier way up: the net mast south of the shed (a climbable pole 250 from the shed's
// south wall), whose tip jump lands on the loft. Its tip stands 300 under the loft (not 150:
// from there a jump with the stick held on carried him clean over the loft), so the jump lands
// on it whether the stick is let go or held on, and the railing stops a landing sliding on over
// the loft's far edges. Like the signal mast it has a side of its own (camYaw 0: the camera
// swings round to its south side, looking past him at the shed).
export const EAST_ROCK = { x: 3100, z: -1300, r: 1050, sides: 12, top: 150 };
export const PINNACLE = { x0: 2240, x1: 2540, z0: -1700, z1: -1300, top: 1250 };
export const NET_SHED = { x0: 2900, x1: 3500, z0: -1700, z1: -1100, top: 1250, rail: 100 };
export const CHIMNEY = { x0: PINNACLE.x1, x1: NET_SHED.x0, z0: PINNACLE.z0 + 200, z1: PINNACLE.z1, back: 200 };
export const BOATHOUSE = { x0: 3480, x1: 3880, z0: -1000, z1: -700, eaves: EAST_ROCK.top + 300, ridge: EAST_ROCK.top + 520 };
export const NET_MAST = { x: 3200, z: NET_SHED.z1 + 250, y0: EAST_ROCK.top, y1: NET_SHED.top - 300, radius: 30, camYaw: 0 };
// The fishermen's boardwalk out to it: from Home Island's east shore (over its beach) east, then
// north up to East Rock. A plank deck at `top` on a crib boarded down to the water and solid to
// the seabed (like the jetty: nothing to swim under), in stretches ([x0, x1, z0, z1], 280 wide)
// with water between them where planks are missing: a gap of 300 and one of 450 (running
// jumps), and between them one plank (`narrow`: 110 wide, nothing under it but water) to
// balance along. The stretch past the first gap is 800 long: a running jump over it lands
// about 500 past the gap, and he skids on to a stop before the plank. The last stretch, past
// the second gap, is a step higher (its own `top`, East Rock's: a running jump clears the
// rise) and runs on over East Rock's flank into its top, as the jetty does into Home
// Island's, so he walks straight on up onto the rock (a rise of 30 would be a wall to him).
export const BOARDWALK = {
  top: 120,
  stretches: [
    { x0: 1800, x1: 2560, z0: 2160, z1: 2440 },
    { x0: 2560, x1: 2840, z0: 1850, z1: 2440 },
    { x0: 2560, x1: 2840, z0: 750, z1: 1550 },
    { x0: 2645, x1: 2755, z0: 450, z1: 750, narrow: true },
    { x0: 2560, x1: 2840, z0: 200, z1: 450 },
    { x0: 2560, x1: 2840, z0: -460, z1: -250, top: EAST_ROCK.top },
  ],
};
// The plank bridge from the north edge of the chimney's back wall (just west of the loft,
// whose railing so has no gap where a landing off the net mast could slide off) down to the
// islet's second terrace (about 12 degrees): planks on two stringers, `width` wide, on
// trestles, with `gap` missing in its middle (a running jump across, downhill); at each end a
// flat landing `landing` long, lying on the back wall's top at its head (the bridge crosses the
// wall's edge at a slant: no hole beside it) and on the terrace at its foot.
export const BRIDGE = { head: { x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y: PINNACLE.top, z: PINNACLE.z0 }, foot: { x: 1040, y: TERRACES[1].top, z: -3370 }, width: 160, gap: 400, landing: 150 };

// ---------------------------------------------------------------- in the Sound, on Home Island

// A sand bar in the Sound, shallow enough to stand on for a rest on the swim: its top 88 under
// the surface, a little deeper than his feet float (80), so he swims in over its edge, and
// shallower than he wades (95), so he stands up on it; a rowing boat sunk on the seabed in the
// middle of the Sound, lying along `yaw`, with five coins and the course's 1-up in it (a dive:
// breath lasts eight wedges of 8.5 s).
export const SANDBAR = { x: 700, z: 400, r: 400, foot: 900, top: -88 };
export const WRECK = { x: 200, z: -700, yaw: 0.5, length: 480, beam: 180, floor: BAY.bedY + 40, gunwale: BAY.bedY + 110 };
// Home Island's midsummer meadow: the maypole (a climbable pole with a crossbar and two leafy
// hoops hanging from it, `bar` high; camYaw 0: held from its south side, the camera looking
// past him north up the bay), a red cottage (its long side along x), and the flagpole by the
// boardwalk's start with a blue and yellow pennant (climbable too).
export const MAYPOLE = { x: -500, z: 3400, y0: HOME.top, y1: 1650, radius: 30, camYaw: 0, bar: 1250, arm: 330, hoop: 150 };
export const COTTAGE = { x0: 500, x1: 1500, z0: 3150, z1: 3850, eaves: 630, ridge: 960 };
export const FLAGPOLE = { x: 1900, z: 2600, y0: HOME.top, y1: 1350, radius: 20 };

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

// 58 coins, each at its floor + 60 but those in the air (the long jump's arc, up the masts and
// the chimney): along the jetty, one over each stepping skerry, an arc over the long jump's
// gap, on Great Rock, by and on the blocks, on the second terrace and the stair, up the signal
// mast (the climbing hero is 60 off its axis, inside the pickup radius) and round the gallery;
// along the boardwalk, up the chimney, down the plank bridge, in the sunken boat, in a ring
// round the maypole and up it.
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
// A point on the plank bridge's deck (k: 0 at its head, 1 at its foot), over it; a point in the
// sunken boat (along its length from its middle, across it, at height y).
const bridgeAt = (k) => {
  const { head, foot } = BRIDGE;
  return { x: head.x + (foot.x - head.x) * k, y: above(head.y + (foot.y - head.y) * k), z: head.z + (foot.z - head.z) * k };
};
function wreckAt(along, across, y) {
  const s = Math.sin(WRECK.yaw);
  const c = Math.cos(WRECK.yaw);
  return { x: WRECK.x + s * along + c * across, y, z: WRECK.z + c * along - s * across };
}
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
  ...[[2150, 2300], [2450, 2300], [2700, 2050], [2700, 1150], [2700, 600], [2700, 330]].map(([x, z]) => ({ x, y: above(BOARDWALK.top), z })),
  ...[450, 800, 1150].map((y) => ({ x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y, z: (CHIMNEY.z0 + CHIMNEY.z1) / 2 })),
  ...[0.25, 0.68, 0.92].map(bridgeAt),
  ...[[-100, -40], [-100, 40], [10, 0], [120, -35], [120, 35]].map(([along, across]) => wreckAt(along, across, above(WRECK.floor))),
  ...[0, 1, 2, 3, 4, 5].map((i) => {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    return { x: MAYPOLE.x + Math.sin(a) * 450, y: above(HOME.top), z: MAYPOLE.z + Math.cos(a) * 450 };
  }),
  ...[500, 800, 1100, 1400].map((y) => ({ x: MAYPOLE.x, y, z: MAYPOLE.z })),
];
// The course's 1-up: in the sunken boat's stern, over its floor.
export const ONE_UP = wreckAt(-185, 0, WRECK.floor + 90);

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
      "Hop across the skerries to the west, follow the fishermen's boardwalk to the east, or swim across the sound. The water is cold but friendly!",
      'Watch out for the critters! A frog puffs up, a crab raises its claws, a mosquito whines: then they strike. Jump on them or punch them!',
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

// Climbable poles (CollisionWorld.addPole): the boat's mast, the signal mast, the net mast, the
// maypole and the flagpole.
export const POLES = [BOAT_MAST, MAST, NET_MAST, MAYPOLE, FLAGPOLE];

// Butterflies over Home Island's meadow (ObjectManager), and white gulls (BIRD_TINT) circling
// over the island and round the lighthouse's lantern.
export const BUTTERFLY_SPOTS = [
  { x: -1150, z: 3950 },
  { x: 250, z: 4500 },
];
export const BIRD_CIRCLES = [
  { x: -300, z: 3300, y: 2300, radius: 1250 },
  { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, y: 3300, radius: 1000 },
];
export const BIRD_TINT = 0xf4f2ec;

// Midsummer critters (objects/Critters.js): Wreath Frogs and Mosquitoes on Home Island's
// meadow, Tin Crabs on the sand bar in the Sound and on the islet's first terrace (its north-east
// ring). Each guards its fight circle round its home (x, y = its floor, z) on its own level,
// stays within fight + its kind's leash pad (frog 60, crab 40, mosquito 100), and is clear of
// every route (tests/skerries.test.js): its circle at least fight + 150 from every same-level
// route, 1200 from the arrival, on its level and dry (a crab's where it can stand: the sand bar
// and the terrace's ring are smaller than its circle, and it never steps off them). yaw: the way
// it faces at home (a frog's idle ring starts there); roam: a frog's ring size (0.6 roam across),
// a mosquito's patrol (roam / 160 of its 320 by 220 figure of eight); calm: a slower tell
// (frog_north, the first met, on the way back from the jetty's foot); wade: may stand in shallow
// water (the sand bar, 88 under the sea); scale / stand: its size and how much taller it stands
// on its legs (the bar's crab keeps its tin's bands out of the water).
export const CRITTERS = [
  { id: 'frog_north', kind: 'frog', x: 150, y: HOME.top, z: 2650, yaw: -2.22, roam: 200, fight: 500, calm: 1.3 },
  { id: 'frog_west', kind: 'frog', x: -1350, y: HOME.top, z: 4100, yaw: 2.26, roam: 200, fight: 500 },
  { id: 'mosquito_south', kind: 'mosquito', x: -150, y: HOME.top, z: 4300, yaw: Math.PI, roam: 160, fight: 400 },
  { id: 'mosquito_cottage', kind: 'mosquito', x: 1000, y: HOME.top, z: 4450, yaw: Math.PI, roam: 140, fight: 350 },
  { id: 'crab_bar', kind: 'crab', x: SANDBAR.x, y: SANDBAR.top, z: SANDBAR.z, yaw: Math.PI, roam: 100, fight: 330, wade: true, scale: 1.25, stand: 40 },
  { id: 'crab_islet', kind: 'crab', x: 1180, y: TERRACES[0].top, z: -5480, yaw: 0.5, roam: 100, fight: 300 },
];
