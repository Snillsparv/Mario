// The Great Hall (area 'hall', course name THE GREAT HALL): a warm, tall, timber-roofed hall
// inside the castle, entered through the castle's front door. At its far end a giant ship in a
// bottle lies on two cradles; walking up the stairs into the bottle's neck is the way to the
// first course. Everything here is in the hall's own local frame: 1 unit = 1 cm, the origin at
// the middle of the floor, +x east, -z north (toward the bottle), the floor at y 0.
// world/areas.js places the hall at its origin (world = local + origin); world/area.js shifts
// these anchors into world coordinates for the collision world, the objects and the player.
//
//                    -Z (north)
//          ┌───────── bottle on cradles ─────────┐
//          │              landing                │
//   west   │ buttress        stairs         door │  east
//   (-X)   │ fireplace                      door │  (+X)
//          │                   chart table       │
//          │                                     │
//          └──────────── front door ─────────────┘
//                    +Z (south, the courtyard)
//
// Ownership: like world/layout.js, the anchors are shared contract: the builder
// (hall/hall.js, hall/bottle.js), the objects (COINS, ONE_UP, SIGNS, DOORS, POLES) and the
// entries all read them. The builder owns everything drawn around them.

// ---------------------------------------------------------------- the room

// Inner walls at x ±halfX, z northZ..southZ; the ceiling's underside (the collision ceiling)
// at ceilingY, more than 300 above any walkable spot so the follow camera never runs out of
// room under it. Walls, floor and ceiling are `thick` solid slabs (their faces toward the room
// are the boxes' outward faces).
export const HALL = { halfX: 2200, northZ: -4200, southZ: 3000, ceilingY: 2600, thick: 200, baseCourse: 140 };

// The authoring rule for everything in the room: no spot Jonas can stand on lies under a
// ceiling lower than this above it (the follow camera needs the room; a lower overhang is
// filled solid, or too low for him to fit under at all).
export const HEADROOM = 400;

// The open timber roof over it (drawn only, all above the collision ceiling): tie beams across
// the hall from ceilingY to eaveY every trussEvery (from firstTruss), each carrying a king-post
// truss up to the ridge, under plaster panels between the rafters.
export const ROOF = { eaveY: 2760, ridgeY: 3800, firstTruss: -3900, trussEvery: 900 };

// Stone pilasters on the side walls (120 along the wall, standing 60 out of it).
export const PILASTERS = { zs: [2500, 1300, -2900, -3700], width: 120, depth: 60 };

// Sun direction for the baked lighting (warm light from high up and a little from the south).
export const HALL_SUN = (() => {
  const v = { x: 0.1, y: 0.8, z: 0.6 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// ---------------------------------------------------------------- south wall: the way out

// The inside of the castle's front door, in the south wall (its face stands `face` in front
// of the wall: the door's collider fills its surround), with a rose window above it.
export const FRONT_DOOR = { x: 0, wallZ: HALL.southZ, faceZ: HALL.southZ - 56, width: 420, height: 620 };
export const ROSE_WINDOW = { y: 1800, r: 420 };
export const BANNERS = { xs: [-700, 700], top: 2400, bottom: 1200 };

// ---------------------------------------------------------------- side walls

// Two tall arched windows per side wall, and two more in the north wall either side of the
// bottle.
export const SIDE_WINDOWS = { zs: [1900, 700], width: 320, height: 1000, sill: 600 };
export const NORTH_WINDOWS = { xs: [-1500, 1500] };

// West wall: the chimney breast (its top is the mantel), a buttress beside it and the wall-kick
// slot between them (open toward +x), and a climbable banner pole whose tip is 150 under the
// buttress top. The pole stands out in the room level with the buttress's middle, 250 east of
// its face: the jump off its top toward the wall (it carries 730..850) clears the buttress's
// edge and stops against the west wall over its top, so he drops onto it, mid-top, for any aim
// within 15 degrees of straight at the wall.
export const CHIMNEY = { x0: -2200, x1: -1750, z0: -1260, z1: -200, top: 1700, hearth: { z: -730, width: 700, height: 600 } };
export const CREST = { x: -1748, y: 1150, z: -730, r: 160 }; // a white pi on a red disc
export const BUTTRESS = { x0: -2200, x1: -1750, z0: -2080, z1: -1620, top: 1700 };
export const SLOT = { z0: BUTTRESS.z1, z1: CHIMNEY.z0 }; // 360 wide
export const BANNER_POLE = { x: BUTTRESS.x1 + 250, z: (BUTTRESS.z0 + BUTTRESS.z1) / 2, y0: 0, y1: 1550, radius: 30 };

// East wall: two arched alcoves (a stone arch standing `depth` out of the wall) with doors that
// are still being built (the next courses), a plaque over each hinting at its world.
export const EAST_DOORS = { faceX: 2144, yaw: -Math.PI / 2, width: 300, height: 520, depth: 80, zs: [-600, -2000], plaques: ['snowflake', 'cog'] };
export const CHART_TABLE = { x: 1100, z: 700, r: 320, top: 90 };

// ---------------------------------------------------------------- north end: the ship in the bottle

// The bottle lies along x 0 with its axis at axisY: body, shoulder cone, neck, lip ring
// (z ranges north to south). Its end stands just off the north wall: no gap behind it for the
// camera to get stuck in.
export const BOTTLE = {
  axisY: 760,
  bodyR: 520,
  body: [-4190, -2300],
  shoulder: [-2300, -1900],
  neckR: 240,
  neckInnerR: 210,
  neck: [-1900, -1400],
  lipR: 270,
  lip: [-1440, -1400],
};
// It lies on a dark oak stand (bottle.js: its whole length, rising round the glass to 45
// degrees either side of straight down; the glass is HEADROOM or more over the floor beside
// it) and two carved cradles across it, level with the putty sea inside (top), whose cheeks
// rise round the glass from there into its widest band (cheekTop; their outer sides slope in
// from cheekFoot to cheekX): no ledge lies under the glass.
export const CRADLES = { zs: [-3600, -2600], halfX: 700, top: 420, depth: 180, cheekFoot: 650, cheekX: 580, cheekTop: 640 };
// The landing in front of the neck (its top is the neck's inner floor, 760 - 210) and the
// stairs up to it (a smooth 28.8 degree ramp as a collider, 11 steps drawn between two
// stringers `stringer` wide outside x0..x1, their tops along the ramp).
export const LANDING = { x0: -450, x1: 450, z0: -1400, z1: -900, top: 550 };
export const STAIRS = { x0: -320, x1: 320, z0: 100, z1: LANDING.z1, top: LANDING.top, steps: 11, stringer: 40 };
// A giant cork standing upright east of the landing (its top 170 under the landing, 60 from
// its edge), and three giant books stacked like stairs against the landing's west side (each
// lies on the one below, from x0 to the landing; tops 150, 300, 450).
export const CORK = { x: 700, z: -1150, r: 190, top: 380 };
export const BOOKS = {
  z0: -1380,
  z1: -1120,
  x1: LANDING.x0,
  stack: [
    { x0: -1100, top: 150 },
    { x0: -880, top: 300 },
    { x0: -660, top: 450 },
  ],
};

// Two iron candle rings hanging from the tie beams (spots on truss lines: ROOF).
export const CHANDELIERS = { spots: [{ x: 0, z: 1500 }, { x: 0, z: -300 }], y: 2050, r: 380, candles: 8 };

// ---------------------------------------------------------------- entries, doors

// Where Jonas arrives (see world/area.js): through the front door he is put well inside it,
// facing north with the room behind him for the camera, and walks on for walkIn ticks; out of
// the bottle he pops out onto the landing facing south (with its sound: sfx, played by
// core/AreaSwitch.js as the wipe opens), the camera in front of him (camYaw), 280 out from the
// mouth's face: just off its re-arm apron (objects/Door.js REACH + APRON, 260), so the mouth is
// armed again and turning round walks him straight back in.
export const ENTRIES = {
  front: { x: 0, y: 0, z: 1550, yaw: Math.PI, walkIn: 10 },
  bottle: { x: 0, y: LANDING.top, z: -1120, yaw: 0, drop: 250, camYaw: 0, sfx: 'bottle_pop' },
};
// A respawn drops him in at the front entry from `drop` above (under the 2600 ceiling).
export const RESPAWN = { entry: 'front', drop: 400 };
// Height the ground probe starts from (below the ceiling, so it finds the floor, not the roof).
export const PROBE_Y = 2400;

// What the doors that do not open yet say (no laugh: nothing sinister, just not built yet).
export const HALL_DOOR_SOON = Object.freeze({
  id: 'hall_door_soon',
  pages: Object.freeze(['This door is still being built.', 'Come back after the next update!']),
});

// The doors (objects/Door.js): the front door's inside leads back out onto the porch; the two
// east doors are still being built; the bottle's mouth (walked into from the landing, facing
// north) takes him to the first course, Midsummer Skerries (world/skerries/*).
export const DOORS = [
  { id: 'hall_front', x: FRONT_DOOR.x, z: FRONT_DOOR.faceZ, yaw: Math.PI, width: FRONT_DOOR.width, floorY: 0, to: 'grounds', entry: 'porch' },
  ...EAST_DOORS.zs.map((z, i) => ({
    id: `hall_east_${i + 1}`,
    x: EAST_DOORS.faceX,
    z,
    yaw: EAST_DOORS.yaw,
    width: EAST_DOORS.width,
    floorY: 0,
    to: null,
    locked: HALL_DOOR_SOON,
    laugh: false,
  })),
  { id: 'bottle', x: 0, z: BOTTLE.lip[1], yaw: 0, width: 400, floorY: LANDING.top, kind: 'bottle', to: 'skerries', entry: 'arrival' },
];

// ---------------------------------------------------------------- pickups, signs, poles

// 19 coins, each at its floor + 60 (but the three hanging in the wall-kick slot, picked up on
// the way up it): a ring round the chart table, up the slot, up the stairs and onto the
// landing, on the cork and on the top two books.
const TABLE_RING = 560;
export const COINS = [
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { x: CHART_TABLE.x + Math.sin(a) * TABLE_RING, y: 60, z: CHART_TABLE.z + Math.cos(a) * TABLE_RING };
  }),
  ...[450, 900, 1350].map((y) => ({ x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y, z: (SLOT.z0 + SLOT.z1) / 2 })),
  { x: 0, y: 170, z: -100 },
  { x: 0, y: 307, z: -350 },
  { x: 0, y: 445, z: -600 },
  { x: -250, y: LANDING.top + 60, z: -1150 },
  { x: 250, y: LANDING.top + 60, z: -1150 },
  { x: CORK.x, y: CORK.top + 60, z: CORK.z },
  { x: -770, y: BOOKS.stack[1].top + 60, z: (BOOKS.z0 + BOOKS.z1) / 2 },
  { x: -555, y: BOOKS.stack[2].top + 60, z: (BOOKS.z0 + BOOKS.z1) / 2 },
];
// The 1-up gem on the mantel (the chimney breast's top).
export const ONE_UP = { x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y: CHIMNEY.top + 90, z: CHIMNEY.hearth.z };

// Signposts (props/decor.js addSignpost; each stands on the floor at its y).
export const SIGNS = [
  {
    id: 'hall_welcome',
    x: -700,
    y: 0,
    z: 1300,
    yaw: 0,
    pages: [
      'The Great Hall',
      'Welcome inside, Jonas! The castle has been waiting for you.',
      'Every door and bottle in here hides a world of its own. Start with the big bottle at the far end!',
    ],
  },
  {
    id: 'bottle',
    x: 500,
    y: 0,
    z: 250,
    yaw: 0,
    pages: ['The Ship in the Bottle', 'A tiny boat sails a tiny sea in there...', 'Climb the stairs, walk into the neck of the bottle and join it!'],
  },
  {
    id: 'wallkick',
    x: -1400,
    y: 0,
    z: -1000,
    yaw: Math.PI / 2,
    pages: [
      'Wall kick',
      'Jump into a wall, then press jump again just as you touch it. Kick back and forth to climb!',
      'Too tricky? Climb the banner pole and jump off its top.',
    ],
  },
];

// Climbable poles (CollisionWorld.addPole): the banner pole by the buttress.
export const POLES = [BANNER_POLE];
