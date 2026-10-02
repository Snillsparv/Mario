// The Great Hall (area 'hall', course name THE GREAT HALL): a warm, round gallery inside the
// castle, entered through the castle's front door. A nave with rounded south corners runs north
// into a half-round apse, under a barrel vault and a half-dome; at the top of a half-round
// stepped dais a giant ship in a bottle lies in the apse on two cradles, and walking up the
// steps into the bottle's neck is the way to the first course. Everything here is in the hall's
// own local frame: 1 unit = 1 cm, the origin at the middle of the floor, +x east, -z north
// (toward the bottle), the floor at y 0. world/areas.js places the hall at its origin (world =
// local + origin); world/area.js shifts these anchors into world coordinates for the collision
// world, the objects and the player.
//
//                             -Z (north)
//                    ____----  headboard  ----____
//                 /  window     BOTTLE      window  \
//          column    coins   on its stand   books, cork  column
//          |                     DAIS                       |
//          column            chandelier                column
//   west   | window                                  window |  east
//   (-X)   | buttress  pole                            door |  (+X)
//          | (slot)     welcome sign          sign    wheel |
//          | fireplace     chandelier    chart table   door |
//           \ round                                  round /
//            \______ banner  FRONT DOOR  banner _________/
//                (rose window over the door)
//                             +Z (south, the courtyard)
//
// Ownership: like world/layout.js, the anchors are shared contract: the builder
// (hall/hall.js and its parts: plan.js, shell.js, features.js, bottle.js, light.js), the
// objects (COINS, ONE_UP, SIGNS, DOORS, POLES) and the entries all read them. The builder owns
// everything drawn around them.

// ---------------------------------------------------------------- the room

// The plan's bounding box: side walls at x ±halfX, z northZ..southZ; the ceiling's underside
// (the collision ceiling: everything above it is drawn only) at ceilingY, more than 300 above
// any walkable spot so the follow camera never runs out of room under it; straight walls are
// `thick` slabs; the skirting `baseCourse` tall.
export const HALL = { halfX: 2200, northZ: -4200, southZ: 3000, ceilingY: 2600, thick: 200, baseCourse: 160 };

// The authoring rule for everything in the room: no spot Jonas can stand on lies under a
// ceiling lower than this above it (the follow camera needs the room; a lower overhang is
// filled solid, or too low for him to fit under at all).
export const HEADROOM = 400;

// The plan, convex and tangent-continuous (no inside corners for the camera to catch in): the
// nave's straight side walls (x ±halfX from APSE.z to ROUNDS.z), a half-round apse to the north
// (`facets` flat facets: facet i spans 180 - 11.25 i .. 180 - 11.25 (i + 1) degrees, measured
// from +x through north), and the two south corners rounded (quarter circles of `facets`
// facets centred at (±ROUNDS.x, ROUNDS.z)) into the flat south wall (x ±ROUNDS.x).
export const APSE = { x: 0, z: -2000, r: 2200, facets: 16 };
export const ROUNDS = { x: 1000, z: 1800, r: 1200, facets: 5 };

// The walls' bands, bottom to top: the skirting, the panelled dado (wainscot) under a gold chair
// rail, cream plaster up to the cornice (a bead at the collision ceiling and a cove out to the
// vault's spring); behind the bottle the panelling rises to `headboard`.
export const ELEVATION = { skirting: 160, dadoTop: 1000, railTop: 1070, corniceY: 2600, springY: 2800, headboard: 1700 };

// The barrel vault over the nave (elliptical: rising `rise` over the cornice's inner edge,
// `segments` round), the half-dome over the apse; transverse ribs at `ribs` (z; the first, over
// the apse's mouth, the heavy showcase arch) and ribs on the dome's meridians (`apseRibs`,
// degrees as APSE's facets).
export const VAULT = { spring: 2800, rise: 1100, segments: 16, ribs: [-2000, -1050, -100, 850, 1800], apseRibs: [30, 90, 150] };

// Engaged rose-marble columns on the wall line (half in the wall): either side of the apse's
// mouth and of the dais, and two in the apse (at 30 and 150 degrees). Collider: an 8-sided
// prism of radius r.
export const COLUMN = { r: 190, shaft: 122, base: 200 };
const onApse = (deg) => ({ x: APSE.x + Math.cos((deg * Math.PI) / 180) * APSE.r, z: APSE.z - Math.sin((deg * Math.PI) / 180) * APSE.r });
export const COLUMNS = [
  { x: -HALL.halfX, z: -2000 },
  { x: HALL.halfX, z: -2000 },
  { x: -HALL.halfX, z: -1050 },
  { x: HALL.halfX, z: -1050 },
  onApse(30),
  onApse(150),
];

// Key light for the bake (warm, high, from the south-east windows, so the two long walls bake
// apart).
export const HALL_SUN = (() => {
  const v = { x: -0.35, y: 0.8, z: 0.48 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// ---------------------------------------------------------------- south wall: the way out

// The inside of the castle's front door, in the south wall (its face stands 56 in front of the
// wall: the door's collider fills its surround), in a portal of round rose-marble pilasters
// (half columns at u ±pilasterU from the door's middle, their axis `sink` inside the wall, radius
// pilasterR at the shaft and baseR at the base), under a rose window, between two banners.
export const FRONT_DOOR = { x: 0, wallZ: HALL.southZ, faceZ: HALL.southZ - 56, width: 420, height: 620 };
export const PORTAL = { pilasterU: 470, pilasterR: 70, baseR: 76, sink: 20 };
export const ROSE_WINDOW = { y: 1800, r: 420 };
export const BANNERS = { xs: [-700, 700], top: 2400, bottom: 1200 };

// ---------------------------------------------------------------- windows

// Round-headed windows recessed in splayed bays (drawn only: the walls stay flat): two in each
// nave wall, two in the apse flanking the headboard (each in the middle of its facet: 118.125
// and 61.875 degrees, off the axis), one in the middle facet of each south round.
export const WINDOW = { width: 360, height: 1300, sill: 1150, splay: 110 };
export const WINDOWS = [
  { x: -HALL.halfX, z: -1525 },
  { x: -HALL.halfX, z: -575 },
  { x: HALL.halfX, z: -1525 },
  { x: HALL.halfX, z: -575 },
  { apseFacet: 5 },
  { apseFacet: 10 },
  { round: 1 },
  { round: -1 },
];

// ---------------------------------------------------------------- west wall

// Beside the arrival: the chimney breast (a cream marble pier, its top the mantel; the arched
// hearth in its face), the wall-kick slot north of it (open toward +x), a buttress (a pedestal)
// north of that, and a climbable brass banner pole in front of the buttress, whose tip is 150
// under its top: the jump off it toward the wall (it carries 730..850) clears the buttress's
// edge and stops against the wall over its top, so he drops onto it for any aim within 15
// degrees of straight at the wall. Above the mantel a plaster hood rises to the ceiling.
export const BUTTRESS = { x0: -2200, x1: -1750, z0: -80, z1: 380, top: 1700 };
export const SLOT = { z0: BUTTRESS.z1, z1: 740 }; // 360 wide
export const CHIMNEY = { x0: -2200, x1: -1750, z0: SLOT.z1, z1: ROUNDS.z, top: 1700, rc: 60, hearth: { z: 1270, width: 700, height: 640 } };
export const CREST = { x: -1748, y: 1180, z: CHIMNEY.hearth.z, r: 160 }; // a white pi on a red disc
// Where the fire in the hearth is heard from (the 'hall' ambience's crackles, world/areas.js
// def.audio.fires): the middle of the hearth's opening in the breast's face.
export const HEARTH_FIRE = { x: CHIMNEY.x1, y: CHIMNEY.hearth.height / 2, z: CHIMNEY.hearth.z };
export const HOOD = { x0: -2200, x1: -2130, z0: 930, z1: 1610, y0: CHIMNEY.top };
export const BANNER_POLE = { x: BUTTRESS.x1 + 250, z: (BUTTRESS.z0 + BUTTRESS.z1) / 2, y0: 0, y1: 1550, radius: 30 };

// ---------------------------------------------------------------- east wall

// Two arched doors still being built (the next courses), in teal niches framed by cream
// architraves standing `depth` out of the wall (their piers solid), a plaque over each (at
// plaqueV, above the chair rail) hinting at its world; a ship's wheel on the wall between them,
// and out in the room the round chart table.
export const EAST_DOORS = {
  faceX: 2144,
  yaw: -Math.PI / 2,
  width: 360,
  height: 600,
  depth: 56,
  zs: [BANNER_POLE.z, CHIMNEY.hearth.z],
  plaques: ['snowflake', 'cog'],
  plaqueV: 1190,
};
export const WHEEL = { x: HALL.halfX, y: 1500, z: (SLOT.z0 + SLOT.z1) / 2, r: 300 };
export const CHART_TABLE = { x: 1050, z: 750, r: 320, top: 90 };

// ---------------------------------------------------------------- north end: the ship in the bottle

// The bottle lies along x 0 with its axis at axisY: body, shoulder cone, neck, lip ring
// (z ranges north to south). Its end lies on the apse's crown: no gap behind it for the camera
// to get stuck in.
export const BOTTLE = {
  axisY: 760,
  bodyR: 520,
  body: [-4130, -2300],
  shoulder: [-2300, -1900],
  neckR: 240,
  neckInnerR: 210,
  neck: [-1900, -1400],
  lipR: 270,
  lip: [-1440, -1400],
};
// It lies on a stand (bottle.js: its whole length, rising round the glass to 45 degrees either
// side of straight down; the glass is HEADROOM or more over the floor beside it) and two gold
// cradles across it, level with the putty sea inside (top), whose cheeks rise round the glass
// from there into its widest band (cheekTop; their outer sides slope in from cheekFoot to
// cheekX): no ledge lies under the glass. The back cradle at the bottle's end closes the wedge
// between the glass and the apse wall.
export const CRADLES = { zs: [-4040, -2700], halfX: 700, top: 420, depth: 180, cheekFoot: 650, cheekX: 580, cheekTop: 640 };
// The dais: a half-round stepped podium up to the bottle's mouth, its flat back on the mouth's
// plane (z), `steps` steps from its foot (radius rFoot) to its top (rTop, at the neck's inner
// floor, 760 - 210). As a collider a smooth half-cone (not slippery); the drawn steps sit on it.
export const DAIS = { x: 0, z: BOTTLE.lip[1], top: 550, rTop: 560, rFoot: 1550, steps: 11 };
// A gold and rose half-ring inlaid in the floor round the dais's foot.
export const DAIS_APRON = { r0: 1680, r1: 1760 };
// The dais's top as a box (its square round the half-disc; the entries and tests stand on it).
export const LANDING = { x0: -DAIS.rTop, x1: DAIS.rTop, z0: DAIS.z, z1: DAIS.z + DAIS.rTop, top: DAIS.top };
// Tread i of the dais (0 at its foot): the radius of its middle and its height, on the
// collider's slope ((rFoot - rTop) / steps = 90 a tread, top / steps = 50 a rise).
export const daisTread = (i) => ({ r: DAIS.rFoot - ((DAIS.rFoot - DAIS.rTop) / DAIS.steps) * (i + 1), y: (DAIS.top / DAIS.steps) * (i + 1) });
// A giant cork standing upright in the east flank of the apse, and two giant books stacked
// like steps up to it (each lies on the one below, from x0 to x1, x1 tucked into the cork's
// foot): hop up book, book, cork.
export const CORK = { x: 1300, z: -2150, r: 190, top: 380 };
export const BOOKS = { z0: -2280, z1: -2020, x1: 1150, stack: [{ x0: 640, top: 130 }, { x0: 820, top: 255 }] };

// Three gold candle rings hanging from the vault along the axis: over the arrival, over the
// dais and over the bottle.
export const CHANDELIERS = { spots: [{ x: 0, z: 800 }, { x: 0, z: -1000 }, { x: 0, z: -3000 }], y: 2120, r: 420, candles: 12 };

// Inlays and rugs flat on the floor (drawn only): the compass rose under the chart table (off
// the entry axis), a half-round rug before the hearth, half-round mats before the front door
// and the two east doors (each toward the room: `dir`).
export const RUGS = [
  { kind: 'compass', x: CHART_TABLE.x, z: CHART_TABLE.z, r: 640 },
  { kind: 'hearth', x: CHIMNEY.x1, z: CHIMNEY.hearth.z, r: 560, dir: [1, 0] },
  { kind: 'mat', x: FRONT_DOOR.x, z: FRONT_DOOR.faceZ, r: 470, dir: [0, -1] },
  { kind: 'mat', x: EAST_DOORS.faceX, z: EAST_DOORS.zs[0], r: 420, dir: [-1, 0] },
  { kind: 'mat', x: EAST_DOORS.faceX, z: EAST_DOORS.zs[1], r: 420, dir: [-1, 0] },
];

// ---------------------------------------------------------------- entries, doors

// Where Jonas arrives (see world/area.js): through the front door he is put well inside it,
// facing north with the room behind him for the camera, and walks on for walkIn ticks; out of
// the bottle he pops out onto the dais's top facing south (with its sound: sfx, played by
// core/AreaSwitch.js as the wipe opens), the camera in front of him (camYaw), 280 out from the
// mouth's face: just off its re-arm apron (objects/Door.js REACH + APRON, 260), so the mouth is
// armed again and turning round walks him straight back in.
export const ENTRIES = {
  front: { x: 0, y: 0, z: 1550, yaw: Math.PI, walkIn: 10 },
  bottle: { x: 0, y: DAIS.top, z: -1120, yaw: 0, drop: 250, camYaw: 0, sfx: 'bottle_pop' },
};
// A respawn drops him in at the front entry from `drop` above (under the 2600 ceiling).
export const RESPAWN = { entry: 'front', drop: 400 };
// Height the ground probe starts from (below the ceiling, so it finds the floor, not the roof).
export const PROBE_Y = 2400;

// What the doors that do not open yet say (no laugh: nothing sinister, just not built yet; the
// door only rattles in its frame, objects/Door.js).
export const HALL_DOOR_SOON = Object.freeze({
  id: 'hall_door_soon',
  pages: Object.freeze(['This door is still being built.', 'Come back after the next update!']),
});

// The doors (objects/Door.js): the front door's inside leads back out onto the porch; the two
// east doors are still being built; the bottle's mouth (walked into from the dais's top, facing
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
  { id: 'bottle', x: 0, z: BOTTLE.lip[1], yaw: 0, width: 400, floorY: DAIS.top, kind: 'bottle', to: 'skerries', entry: 'arrival' },
];

// ---------------------------------------------------------------- pickups, signs, poles

// 25 coins, each at its floor + 60 (but the three hanging in the wall-kick slot, picked up on
// the way up it): a ring round the chart table (on the compass rose's red ring), up the slot,
// on three of the dais's treads and on its top, on the cork, on the buttress (the pole jump's
// reward), on the books, and a trail round the west side of the apse behind the bottle.
const TABLE_RING = 560;
const APSE_TRAIL = 1700;
export const COINS = [
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { x: CHART_TABLE.x + Math.sin(a) * TABLE_RING, y: 60, z: CHART_TABLE.z + Math.cos(a) * TABLE_RING };
  }),
  ...[450, 900, 1350].map((y) => ({ x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y, z: (SLOT.z0 + SLOT.z1) / 2 })),
  ...[2, 5, 8].map((i) => ({ x: 0, y: daisTread(i).y + 60, z: DAIS.z + daisTread(i).r })),
  { x: -250, y: DAIS.top + 60, z: -1150 },
  { x: 250, y: DAIS.top + 60, z: -1150 },
  { x: CORK.x, y: CORK.top + 60, z: CORK.z },
  { x: (BUTTRESS.x0 + BUTTRESS.x1) / 2, y: BUTTRESS.top + 60, z: BUTTRESS.z0 + 100 },
  { x: (BOOKS.stack[0].x0 + BOOKS.stack[1].x0) / 2, y: BOOKS.stack[0].top + 60, z: (BOOKS.z0 + BOOKS.z1) / 2 },
  { x: (BOOKS.stack[1].x0 + BOOKS.x1) / 2, y: BOOKS.stack[1].top + 60, z: (BOOKS.z0 + BOOKS.z1) / 2 },
  ...[180, 165, 150, 135, 120].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: APSE.x + Math.cos(a) * APSE_TRAIL, y: 60, z: APSE.z - Math.sin(a) * APSE_TRAIL };
  }),
];
// The 1-up gem on the mantel (the chimney breast's top).
export const ONE_UP = { x: (CHIMNEY.x0 + CHIMNEY.x1) / 2, y: CHIMNEY.top + 90, z: CHIMNEY.hearth.z };

// Signposts (props/decor.js addSignpost; each stands on the floor at its y), none between the
// arrival and the dais: the welcome sign to the left of the way in (off the line to the fire),
// the bottle's behind the chart table to the right, the wall kick's at the slot's mouth.
export const SIGNS = [
  {
    id: 'hall_welcome',
    x: -750,
    y: 0,
    z: 750,
    yaw: 0.75,
    pages: [
      'The Great Hall',
      'Welcome inside, Jonas! The castle has been waiting for you.',
      'Every door and bottle in here hides a world of its own. Start with the big bottle at the far end!',
    ],
  },
  {
    id: 'bottle',
    x: 1250,
    y: 0,
    z: 0,
    yaw: -0.68,
    pages: ['The Ship in the Bottle', 'A tiny boat sails a tiny sea in there...', 'Climb the steps, walk into the neck of the bottle and join it!'],
  },
  {
    id: 'wallkick',
    x: -1200,
    y: 0,
    z: SLOT.z0,
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

// ---------------------------------------------------------------- the plan as a test

// Whether (x, z) lies on the hall's floor plan at least `pad` inside its walls (negative: up
// to that far outside them): the samplers' authority (tests/hall.test.js).
export function inPlan(x, z, pad = 0) {
  if (Math.abs(x) > HALL.halfX - pad || z > HALL.southZ - pad) return false;
  if (z < APSE.z) return Math.hypot(x - APSE.x, z - APSE.z) <= APSE.r - pad;
  if (z > ROUNDS.z && Math.abs(x) > ROUNDS.x) return Math.hypot(Math.abs(x) - ROUNDS.x, z - ROUNDS.z) <= ROUNDS.r - pad;
  return true;
}
