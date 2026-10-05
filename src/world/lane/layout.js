// Sparrow Lane (area 'lane', course name SPARROW LANE), the second course, through the east door
// with the little house on its plaque in the Great Hall: a quiet residential cul-de-sac on a
// golden autumn afternoon, Jonas's own street. He steps out of his own black front door onto the
// grass-paver path of his red house; the course's star waits over the ridge of his roof, in view
// from the first second. The way up: hop onto a wheelie bin by the carport, onto the carport's
// flat roof and across onto the roof's slope (or jump at the front wall and grab the eave, or
// climb the red-leaf tree in the round bed and flip off its top onto the roof). Up the hill
// across the street stand split-level villas behind grey block walls, with drives cut into
// their gardens, steps and side yards up to the forest; along the dad's side long low chain
// houses linked by carports; a turning area at the east end with a double garage and a footpath
// out to the next street; the junction at the west end with its lamppost, big trees and a
// motorhome on the first villa's drive. Nothing here hurts: no critters, no water.
// Everything here is in the course's own local frame, the street frame: 1 unit = 1 cm (the
// street is drawn at 1.5 times its real size), +x along the lane's long straight toward the
// turning area, +z across it toward the dad's side, -z up the hill toward the forest, the road
// at y 0. world/areas.js places it at its origin (world = local + origin); world/area.js shifts
// these anchors into world coordinates.
//
//                               -Z (uphill: the forest)
//        ┌──────────────── forest bank, firs ──────────────────────┐
//        │ north_west   north_1  north_2  north_3  north_4  north_5│
//        │  (motorhome)   ┌wall┐  ┌wall┐  ┌wall┐  ┌wall┐ ╭── east_ │
//   west │ L1 junction ╲── street ── pavement ──────────── turning │ east_house
//        │  trees  F3   ╲  south_1 ┤link├ DAD ├carport┤ south_2 area│  F2
//        │ south_west    hedge   mailbox, red tree  bins      footpath ╲
//        └──────── back hedges ────────────────────────────────── barrier
//                               +Z (the dad's side)
//
// Ownership: like world/layout.js, the anchors are shared contract: the builders
// (lane/build.js, houses.js, props.js, door.js), the objects (COINS, STAR, SIGNS, DOORS, POLES)
// and the entries all read them. The builders own everything drawn around them.
//
// Privacy (the repository is public): nothing here names the real street, its houses' numbers,
// anyone's name but Jonas's, or a licence plate; the houses go by neutral ids (north_1 ..
// north_5 up the hill from west to east, north_west, south_west, south_1, south_dad, south_2,
// east_garage, east_house), and every texture is painted in code.

// ---------------------------------------------------------------- scale and heights

// Units per real metre (the aerial's 0.13 m a pixel is 19.5 units).
export const SCALE = 150;
// The road is flat at 0 (the real lane climbs a little eastward: dropped); kerb tops, the north
// pavement and the south lawns at GROUND; the north gardens' terraces at TERRACE.
export const GROUND = 22;
export const TERRACE = 150;

// ---------------------------------------------------------------- the street

// The carriageway: `half` either side of its centreline polyline (the west leg from the
// junction, a bend of three short segments, the long straight), mitred at its joints; the
// straight runs on into the turning area.
export const ROAD = {
  half: 450,
  line: [[-8640, 2550], [-5600, 425], [-5150, 150], [-4750, 25], [-4400, 0], [2400, 0]],
  beyond: 2200, // drawn on past the junction into the fog (out of bounds)
};
// The turning area at the east end: an asphalt disc of `sides`.
export const TURN = { x: 3500, z: -250, r: 1150, sides: 16 };
// The side road leaving the west leg at the junction (drawn only: its mouth is closed by the
// boundary).
export const SIDE_ROAD = { x: -7950, z: 2190, dir: [0.574, 0.819], half: 400, len: 1800 };
// Granite kerbs along the road's edges, a step of `h` (walked up without a jump), broken by
// every drive.
export const KERB = { h: GROUND, w: 30 };
// The north pavement (asphalt, a shade lighter) along the straight and on round the bend:
// from `from` to `to` off the centreline, on its north side.
export const PAVEMENT = { from: 450, to: 700, x1: TURN.x - TURN.r };
// The footpath out of the turning area to the next street: `half` wide either side of its line
// from its mouth (x, z) along dir (drawn from `from`, inside the turning area's rim); the play
// space ends at a low wooden barrier `barrier` along it, and the path runs on (drawn only) to
// `len`.
export const FOOTPATH = { x: 4700, z: 350, dir: [0.574, 0.819], half: 225, from: -300, len: 2600, barrier: 1300 };
// A point `t` along the footpath and `s` across it (s > 0: its west side).
export function footpathAt(t, s = 0) {
  const [dx, dz] = FOOTPATH.dir;
  return { x: FOOTPATH.x + dx * t - dz * s, z: FOOTPATH.z + dz * t + dx * s };
}

// ---------------------------------------------------------------- the north side (uphill)

// The villas' gardens are terraces behind a retaining wall of split-face grey blocks: from the
// pavement (wallZ) the wall rises to `top`; the gardens are flat back to flatZ, then rise 1 in 4
// to backTop at backZ (the forest's edge). Along the turning area the wall follows an arc of
// arcR round its middle, then runs on east at eastZ. Behind the gardens the forest bank rises
// (drawn only) to bankTop at bankZ.
export const NORTH = { wallZ: -700, top: TERRACE, flatZ: -3400, backZ: -4000, backTop: 300, arcR: 1400, eastZ: -1300, bankZ: -5200, bankTop: 1500 };

// The wall's line (z) at x: straight along the pavement, round the turning area, then east.
export function wallZAt(x) {
  if (x <= PAVEMENT.x1) return NORTH.wallZ;
  const dx = x - TURN.x;
  const r = NORTH.arcR;
  if (dx >= r) return NORTH.eastZ;
  const arc = TURN.z - Math.sqrt(r * r - dx * dx);
  return dx < 0 ? arc : Math.min(arc, NORTH.eastZ);
}

// The villas' plots, west to east: x0..x1; `drive` the notch cut into the garden at street level
// (cobbled, block walls either side) from the wall back to the villa's garage door; `steps` up
// from the street beside it to the terrace (a not-slippery ramp collider under the drawn steps,
// a railing on the drive's side), `run` deep.
export const STEPS = { run: 260, n: 5, rail: 90 };
// The steps' floor at z (on their ramp from the street up to the terrace).
export function stepsY(plot, z) {
  const k = (wallZAt(plot.steps[0]) - z) / STEPS.run;
  return GROUND + (TERRACE - GROUND) * Math.max(0, Math.min(1, k));
}
export const PLOTS_N = [
  { id: 'north_1', x0: -5700, x1: -3670, drive: [-4780, -4100], steps: [-5250, -5030] },
  { id: 'north_2', x0: -3670, x1: -1125, drive: [-2390, -1710], steps: [-2850, -2630] },
  { id: 'north_3', x0: -1125, x1: 1485, drive: [310, 990], steps: [0, 220] },
  { id: 'north_4', x0: 1485, x1: 3980, drive: [2730, 3410], steps: [1600, 1820] },
  { id: 'north_5', x0: 3980, x1: 6400, drive: [5200, 5880], steps: [4880, 5100] },
];

// The split-level villas (houses.js villa()): a white rendered lower floor with the garage door
// at drive level, a red-brown brick upper floor, a hipped roof of pan tiles with wide eaves.
// All VILLA.w across x by VILLA.d, their front (toward the street, +z) at `front`; `garage` the
// garage door's middle (u, from the front's middle); bay windows and arched windows on the
// upper floor (u); `brick` and `roof` their tints.
export const VILLA = { w: 1800, d: 1500, y0: GROUND, render: 412, eave: 822, pitch: 27, overhang: 110, garage: { w: 520, h: 250 } };
VILLA.ridge = VILLA.eave + (VILLA.d / 2) * Math.tan((VILLA.pitch * Math.PI) / 180);
const villa = (id, cx, front, garage, extras) => ({
  id,
  kit: 'villa',
  cx,
  cz: front - VILLA.d / 2,
  w: VILLA.w,
  d: VILLA.d,
  yaw: 0,
  y0: VILLA.y0,
  render: VILLA.render,
  eave: VILLA.eave,
  pitch: VILLA.pitch,
  overhang: VILLA.overhang,
  front,
  garage,
  ...extras,
});
export const VILLAS = [
  villa('north_1', -4890, -1600, 450, { bays: [-300], windows: [450, -650], brick: 0xb05a3c, roof: 0x2e2c2c }),
  villa('north_2', -2450, -1650, 400, { arches: [-450], bays: [350], door: -150, brick: 0x9c4a34, roof: 0x2e2c2c }),
  villa('north_3', 200, -1650, 450, { arches: [-450], bays: [200], balcony: true, brick: 0xa65036, roof: 0x4a3a32 }),
  villa('north_4', 2770, -1720, 300, { bays: [-350], windows: [350], brick: 0xa85438, roof: 0x4a3a32 }),
  villa('north_5', 5190, -1930, 420, { arches: [-450], bays: [400], door: -250, doorTint: 0x6a4a32, brick: 0xb4603e, roof: 0x4a3a32 }),
];

// ---------------------------------------------------------------- the west end

// The first villa up the hill (north_west): white render to its eaves, a light grey hipped roof
// with two roof windows, a double garage facing the west leg (its front: yaw, as the house kit
// turns it: local +w looks (sin yaw, cos yaw)), and a low wing behind it; a flagstone drive in
// front of it running on east to the motorhome.
const WEST_YAW = Math.atan2(0.574, 0.819);
export const NORTH_WEST = {
  id: 'north_west',
  kit: 'villa',
  cx: -6770,
  cz: -865,
  w: 1650,
  d: 1650,
  yaw: WEST_YAW,
  y0: GROUND,
  render: 462,
  eave: 462,
  pitch: 25,
  overhang: 90,
  garage: 0,
  garages: [-400, 400],
  roofWindows: [-350, 350],
  roof: 0xa4a6a8,
};
// Its wing, behind it (north), lower.
export const NORTH_WEST_WING = { id: 'north_west_wing', kit: 'villa', cx: -6770 - 0.574 * 1475, cz: -865 - 0.819 * 1475, w: 1300, d: 1300, yaw: WEST_YAW, y0: GROUND, render: 412, eave: 412, pitch: 15, overhang: 90, roof: 0xa4a6a8 };
// The flagstone drive in front of it (in its frame: u along the front, w out toward the road).
export const NORTH_WEST_DRIVE = { u0: -825, u1: 1250, w0: 825, w1: 1275 };
// The motorhome on the drive (a white box with a dark window band on four dark wheels), in front
// of the villa's east half (at (300, 1045) in its frame: clear of its front, of the road and of
// the first terrace's corner): l along its frame's u (along the road), w across it, h tall;
// solid to its roof (a coin spot, reached by a double jump and a grab of its edge; a running
// jump from the drive falls short: its top stands more than 160 over that jump's peak).
export const MOTORHOME = { cx: -5924, cz: -181, yaw: WEST_YAW, l: 930, w: 360, h: 500 };

// The corner house south of the west leg (south_west): red boards over white brick, a black
// gable roof, a glazed veranda on its west gable (veranda: along u past the gable, flat roof at
// `top`); a brown picket fence along its street side and a two-rail fence toward the junction.
const pitchRidge = (eave, d, deg) => Math.round(eave + (d / 2) * Math.tan((deg * Math.PI) / 180));
export const SOUTH_WEST = {
  id: 'south_west',
  kit: 'chain',
  cx: -5475,
  cz: 2375,
  w: 2100,
  d: 1300,
  yaw: Math.PI + WEST_YAW,
  y0: GROUND,
  eave: 412,
  ridge: pitchRidge(412, 1300, 20),
  boards: 0x983226,
  roof: 0x2c2c2e,
  door: -300,
  windows: [-750, 150, 600],
  veranda: { depth: 450, top: 352 },
};
// Fences (FENCES): [u0, w0, u1, w1] in a house's frame, `h` high; their colliders are slabs.
export const FENCES = [
  { house: 'south_west', kind: 'picket', from: [1500, 950], to: [-450, 950], h: 110 },
  { house: 'south_west', kind: 'rail', from: [1560, 950], to: [1560, -650], h: 90 },
];

// ---------------------------------------------------------------- the dad's side (south)

// The long chain houses (houses.js chain()): vertical boards over a white brick plinth
// (`plinth` high), black window frames, a low gable roof (20 degrees, ridge along the street),
// their fronts toward the street (-z: yaw pi, so their u runs toward -x).
export const CHAIN = { y0: GROUND, plinth: 135, eave: 412, pitch: 20, overhang: 60 };
const chain = (id, x0, x1, z0, z1, extras) => ({
  id,
  kit: 'chain',
  cx: (x0 + x1) / 2,
  cz: (z0 + z1) / 2,
  w: x1 - x0,
  d: z1 - z0,
  yaw: Math.PI,
  y0: CHAIN.y0,
  eave: CHAIN.eave,
  ridge: pitchRidge(CHAIN.eave, z1 - z0, CHAIN.pitch),
  ...extras,
});
// u along a south house's front of course x (its u runs toward -x).
const uS = (x0, x1, x) => (x0 + x1) / 2 - x;

// The dad's house (south_dad): red boards, the black front door (DOOR: its middle x, width,
// height; face at z0) in a white frame, six windows, the white brick gable ends with red boards
// in their triangles, black pan tiles.
export const DAD = chain('south_dad', -1100, 1600, 1330, 2605, { boards: 0x983226, roof: 0x262628 });
DAD.x0 = -1100;
DAD.x1 = 1600;
DAD.z0 = 1330;
DAD.z1 = 2605;
DAD.floor = GROUND;
DAD.ridgeZ = DAD.cz;
DAD.door = { x: 0, w: 150, h: 315, faceZ: DAD.z0, vestibule: 120 };
DAD.door.u = uS(DAD.x0, DAD.x1, DAD.door.x);
DAD.windows = [-880, -580, -300, 400, 800, 1200].map((x) => uS(DAD.x0, DAD.x1, x));
DAD.gableEnds = true; // white brick to the eaves at both ends
DAD.charger = { x: DAD.x1, z: 1500 };

// Its neighbours along the chain, west to east: the yellow house (south_1) and the flat-roofed
// link between it and the dad's; the carport between the dad's and the yellow house to the east
// (south_2, which faces the turning area with a wing behind it).
export const SOUTH_1 = chain('south_1', -3500, -1550, 1330, 2580, { boards: 0xd8b65e, roof: 0x2a2a2c, door: uS(-3500, -1550, -2300), windows: [-3250, -2900, -2600, -2000, -1750].map((x) => uS(-3500, -1550, x)), gableEnds: true });
export const LINK = { id: 'link', x0: -1550, x1: -1100, z0: 1330, z1: 2400, top: 370, slab: 25, boards: 0xd8b65e };
export const CARPORT = { id: 'carport', x0: 1600, x1: 2500, z0: 1800, z1: 2650, top: 370, slab: 25, posts: [1640, 2050, 2460], post: 40, back: 0xd8b65e, door: 0x983226 };
export const SOUTH_2 = chain('south_2', 2500, 4150, 1450, 2650, { boards: 0xd8b65e, roof: 0x3a302c, door: uS(2500, 4150, 3500), windows: [2800, 3150, 3850].map((x) => uS(2500, 4150, x)), gableEnds: true });
// Its wing behind it (ridge along z: turned a quarter, its front toward +x).
export const SOUTH_2_WING = { ...chain('south_2_wing', 3400, 4150, 2650, 3350, { boards: 0xd8b65e, roof: 0x3a302c }), w: 700, d: 750, yaw: Math.PI / 2, ridge: pitchRidge(CHAIN.eave, 750, CHAIN.pitch), windows: [0] };

// The dad's front garden: the grass-paver path from the kerb to the door, the round bed (a ring of
// `stones` round it, red leaves fallen in it, the red-leaf tree in it: a small ornamental tree,
// its trunk a climbable pole, its crown about as high as the house's eaves), the rhododendron at
// the house's west corner, a potted plant by the door; his drive (asphalt) east of the house to
// the carport; the two wheelie bins against the house's east gable (BINS: their middles; BIN:
// the body's size, its lid's top at `top`) by the car charger (DAD.charger); behind the house a
// patio of grey slabs. The link's own short drive in front of its garage door.
export const DAD_PATH = { x0: -90, x1: 90, z0: 450, z1: DAD.z0 };
export const ROUND_BED = { x: 1050, z: 850, r: 300, stones: 14 };
export const RED_TREE = { x: ROUND_BED.x, z: ROUND_BED.z, y0: GROUND, y1: 442, radius: 30, trunkTop: 420, canopy: { r: 290, y0: 330, y1: 700 } };
export const RHODODENDRON = { x: -960, z: 1180, r: 260, h: 300 };
export const POT = { x: -165, z: 1290 };
export const DAD_DRIVE = { x0: DAD.x1, x1: CARPORT.x1, z0: 450, z1: CARPORT.z0 };
export const LINK_DRIVE = { x0: LINK.x0, x1: LINK.x1, z0: 450, z1: LINK.z0 };
export const PATIO = { x0: -900, x1: 0, z0: DAD.z1, z1: 3100 };
export const BIN = { x: 110, z: 90, h: 160, top: GROUND + 160 };
export const BINS = [{ x: 1665, z: 1600 }, { x: 1665, z: 1710 }];
// The bins move (objects/laneBoss/LaneBins.js, once the lane's lazy chunk is in): pushed by
// walking into them, grabbed with the attack button and pulled, kept on the dad's drive and the
// room under the carport (BIN_LEASH: the box a bin's middle stays in; never the road, a lawn or a
// roof), and home again on every arrival, lost life and new game, or by themselves when left. Each
// movable bin: its home (BINS), its floor, its size (the handle and the wheels on +x), its
// collider's name (lane/props.js: the static build's box, named) and its leash. (Only the dad's
// two stand on the street: the photos show none by the other drives.)
export const BIN_LEASH = { x0: DAD_DRIVE.x0 + 4 + BIN.x / 2, x1: DAD_DRIVE.x1 - 4 - BIN.x / 2, z0: DAD_DRIVE.z0 + 10 + BIN.z / 2, z1: CARPORT.z1 - 50 - BIN.z / 2 };
export const MOVABLE_BINS = BINS.map((b, i) => ({ id: `bin_${i}`, x: b.x, y: GROUND, z: b.z, w: BIN.x, d: BIN.z, h: BIN.h, leash: BIN_LEASH }));

// ---------------------------------------------------------------- the east end

// A double garage at the turning area (east_garage: white render, a white vertical-board gable
// toward the turning area, two dark panel doors in it) in front of a one-and-a-half storey house
// (east_house, drawn and solid, mostly out of reach).
export const EAST_GARAGE = { id: 'east_garage', kit: 'garage', cx: 5775, cz: -375, w: 1050, d: 1050, yaw: -Math.PI / 2, y0: GROUND, eave: 412, ridge: pitchRidge(412, 1050, 35), doors: [-260, 260] };
export const EAST_HOUSE = { id: 'east_house', kit: 'chain', cx: 7100, cz: 50, w: 1700, d: 1600, yaw: -Math.PI / 2, y0: GROUND, eave: 522, ridge: pitchRidge(522, 1600, 40), boards: 0xd8b65e, roof: 0x2c2c2e, door: 0, windows: [-550, 550], plinth: 135 };

// Every house as houses.js builds it.
export const HOUSES = [...VILLAS, NORTH_WEST, NORTH_WEST_WING, SOUTH_WEST, SOUTH_1, DAD, SOUTH_2, SOUTH_2_WING, EAST_GARAGE, EAST_HOUSE];

// ---------------------------------------------------------------- hedges, trees, street furniture

// Hedges (solid leafy boxes, their tops walkable): [x0, x1, z0, z1, y0, top].
export const HEDGES = [
  { x0: -3500, x1: -1600, z0: 560, z1: 720, y0: GROUND, top: 187 }, // south_1's front
  { x0: 2550, x1: 4100, z0: 1180, z1: 1330, y0: GROUND, top: 187 }, // south_2's front, along the turning area
  { x0: -3800, x1: 4800, z0: 3450, z1: 3650, y0: GROUND, top: 242 }, // the south back hedges
  { x0: 6400, x1: 6600, z0: -1300, z1: -900, y0: GROUND, top: 202 }, // between north_5 and the east house
  { x0: -1100, x1: -170, z0: -900, z1: -820, y0: TERRACE, top: 230 }, // north_3's low box hedge
];
// Thuja columns (8-sided, tapering; solid): at north_1's drive mouth and the north_1 / north_2
// corner.
export const THUJA = { r: 80, h: 520 };
export const THUJAS = [
  { x: -4860, z: -820 },
  { x: -4020, z: -820 },
  { x: -3780, z: -880 },
  { x: -3620, z: -900 },
  { x: -3460, z: -880 },
];
// Big broad-leaved trees at the junction (trunks solid): r the canopy's radius, h its top.
export const TREES = [
  { x: -8500, z: 300, r: 750, h: 1900 },
  { x: -7700, z: -900, r: 650, h: 1700 },
  { x: -9500, z: -1600, r: 800, h: 2000 },
];
// The forest on the bank behind the north gardens (fir(): a seeded scatter of `count` firs and
// `birches` birches over the band), and the ring of trees drawn round the outside of the
// boundary (EDGE_FOREST: `count` firs `from`..`to` outside it), so the camera never looks out on
// nothing.
export const FOREST = { count: 34, birches: 10, x0: -7000, x1: 7500, z0: -4300, z1: -5600, seed: 0x5ba77 };
export const EDGE_FOREST = { count: 70, from: 900, to: 2200, seed: 0x5ba78 };

// Lampposts (grey, an arm and a flat lamp head; their colliders prisms): L1 at the junction and
// L6 at the turning area's north-west rim are climbable (POLES).
export const LAMP = { r: 14, top: 1050, arm: 150, collider: 30 };
export const LAMPS = [
  { id: 'L1', x: -8120, z: 1590, yaw: 1.97 },
  { id: 'L2', x: -5350, z: -300, yaw: 0 },
  { id: 'L3', x: -2900, z: -590, yaw: 0 },
  { id: 'L4', x: -300, z: -590, yaw: 0 },
  { id: 'L5', x: 2000, z: -590, yaw: 0 },
  { id: 'L6', x: 2600, z: -1240, yaw: 2.42 },
  { id: 'L7', ...footpathAt(200, 330), yaw: -2.2 },
];
// White flagpoles with a gold knob (climbable), each flying its `flag`: north_2's the blue and
// yellow cross flag (FLAG: len along the wind by h), the others long blue and yellow pennants
// (PENNANT), all streaming before the same light breeze (WIND: the way they stream, the waves
// running down them: amp at the tip, k per unit along, speed per second).
export const FLAGPOLE = { r: 14, top: 1350 };
export const FLAGPOLES = [
  { id: 'F1', x: -2900, z: -1150, y0: TERRACE, flag: 'flag' },
  { id: 'F2', x: 5100, z: 350, y0: GROUND, flag: 'pennant' },
  { id: 'F3', x: -7700, z: 100, y0: GROUND, flag: 'pennant' },
];
export const FLAG = { len: 300, h: 188 };
export const PENNANT = { len: 520, h: 64, droop: 70 };
export const WIND = { dir: [0.96, 0.28], amp: 34, k: 0.012, speed: 4.2 };
// The dad's mailbox by the street: a black house-shaped box on a post (body 90 x 70, 130 high,
// on a post `post` high, a 30-degree roof to `ridge`), facing the street; it is a sign of its own.
export const MAILBOX = { x: 230, z: 640, yaw: Math.PI, post: 110, body: [90, 70, 130] };
MAILBOX.eaves = GROUND + MAILBOX.post + MAILBOX.body[2];
MAILBOX.ridge = MAILBOX.eaves + 30;
// The grey electrical cabinet on a white brick pillar by the footpath, and the blue round
// pedestrian sign on its grey post on the footpath's west side; the low barrier across it.
export const CABINET = footpathAt(60, 520);
export const PATH_SIGN = footpathAt(520, 320);

// ---------------------------------------------------------------- cars, the hoop, the trampoline

// Cars parked on the drives (generic shapes, plate-less, no badges), each a kind (CAR_KINDS: l
// long, w wide, its body up to `belt`, its cabin up to `roof`, the bonnet `hood` long, the
// windscreen `screen` deep, the cabin's back `tail` in from the rear at its foot and `tailTop`
// at the roof, wheels of radius `wheel`) at (x, z), its nose toward yaw (0: +z), in its colour.
// Solid (the body and the cabin): a hop onto a bonnet, a grab of a roof's edge. The dad's two
// stand side by side before the carport, noses out (the bins and the way up to them clear on
// their west); the west neighbour's at the link; on the villas' drives (not north_4's: its
// coins) and at the double garage, noses in.
export const CAR_KINDS = {
  suv: { l: 660, w: 270, belt: 140, roof: 250, hood: 175, screen: 95, tail: 25, tailTop: 55, wheel: 58 },
  cross: { l: 630, w: 265, belt: 130, roof: 235, hood: 165, screen: 110, tail: 35, tailTop: 95, wheel: 55 },
  hatch: { l: 590, w: 255, belt: 115, roof: 215, hood: 155, screen: 120, tail: 30, tailTop: 85, wheel: 50 },
  estate: { l: 690, w: 260, belt: 115, roof: 210, hood: 180, screen: 115, tail: 20, tailTop: 45, wheel: 50 },
  van: { l: 700, w: 285, belt: 135, roof: 290, hood: 70, screen: 90, tail: 10, tailTop: 20, wheel: 55 },
};
const parked = (kind, x, noseZ, yaw, tint) => ({ kind, x, z: noseZ - Math.cos(yaw) * (CAR_KINDS[kind].l / 2), yaw, tint });
export const CARS = [
  // The dad's compact electric crossover (photos: nearest his gable): a lookalike of his own car,
  // no badge, no plate; the 'cross' kind's body (its collider unchanged), drawn in its own style
  // (lane/props.js, world/lane/real/cars.js STYLE.ev), and drawn last (hideable: part.hide). Its
  // tint a soft, greyish steel blue in the realistic look; the classic look's warm bake greys a
  // blue, so there it is a touch bluer (`classicTint`).
  { ...parked('cross', 1900, 1760 - CAR_KINDS.cross.l, Math.PI, 0x627d93), id: 'dad_ev', style: 'ev', classicTint: 0x5884a6 },
  parked('suv', 2300, 1760 - CAR_KINDS.suv.l, Math.PI, 0x2c3a52),
  parked('cross', -1360, 1300, 0, 0xeeeee8),
  parked('hatch', -4440, -1560, Math.PI, 0xb6babe),
  parked('cross', -2050, -1610, Math.PI, 0x45484c),
  parked('hatch', 650, -1610, Math.PI, 0x1f2124),
  parked('van', 5480, -1890, Math.PI, 0x24272b),
  { kind: 'estate', x: 5245 - CAR_KINDS.estate.l / 2, z: -115, yaw: Math.PI / 2, tint: 0x8e9296 },
];

// STOMPWATT, the lane's boss (objects/laneBoss/LaneBoss.js, in the lane's lazy chunk): the dad's
// car (`car`: its id in CARS) stands up into a robot made of its own panels when Jonas comes near
// it on the ground (`wake`: within r of its middle on the drive's level (his feet within `level`
// of its ground) for `dwell` ticks, or touching it), never while he is up on the bins, the carport
// or a roof; from `notice` its T lights blink at him. The fight (objects/laneBoss/fight.js): its
// `arena` (Jonas within r + 200 of its middle is in the fight), the ground it may walk on (`walk`:
// its middle stays in these boxes, [x0, x1, z0, z1]: the street and the lawns' fronts in front of
// the cars, and the drive between the dad's gable and the SUV, never behind the cars, under the
// carport or in a garden), where it kneels to charge (`charge`: at the wall charger, DAD.charger,
// facing it, its back to the open drive), where it folds back into the car once beaten
// (`prepark`, then reversing into its slot) and where its reward star hovers (`star`, in front
// of the car: a small jump reaches it).
export const LANE_BOSS = {
  car: 'dad_ev',
  wake: { r: 520, dwell: 20, level: 60 },
  notice: 900,
  arena: { x: 2050, z: 700, r: 1350 },
  walk: [[800, 3300, -400, 980], [1720, 2040, 980, 1660]],
  charge: { x: 1790, z: 1290, yaw: -0.75 },
  prepark: { x: 1900, z: 1145 },
  star: { x: 1900, y: GROUND + 320, z: 1000 },
  easy: false, // (the easier fight for the youngest: objects/laneBoss/tuning.js FIGHT.EASY)
};

// The basketball hoop on north_5's front wall west of its garage door, a children's one: a black
// post `out` in front of the wall, a white board (w by h, its foot at `board` up, at the top of
// the rendered floor) on an arm to the wall, an orange ring of `ring` radius at `rim` up; the
// board and its arm are one solid block from the wall (a perch: a double jump from the drive
// grabs its edge, a hop from the van's roof lands on it).
export const HOOP = { x: 5270, z: VILLAS[4].front, out: 70, board: GROUND + 390, w: 130, h: 110, rim: GROUND + 400, ring: 32 };

// The trampoline in north_5's front garden (objects/Trampoline.js bounces Jonas off its mat:
// within r of its middle, his feet coming down at y, its top), drawn by props.js: a dark mat in a
// padded blue ring on six legs, solid from the terrace up to its top. The secret 1-up floats
// high over it: only a bounce with the jump button held (BOUNCE_HELD_VY) rises to it.
export const TRAMPOLINE = { x: 4580, y: TERRACE + 90, z: -1650, r: 250, vy: 50, legs: 6 };
export const TRAMPOLINES = [TRAMPOLINE];
export const ONE_UP = { x: TRAMPOLINE.x, y: 1020, z: TRAMPOLINE.z };

// ---------------------------------------------------------------- gardens, the forest's edge

// A tree or two in the gardens (drawn by props.js, their trunks solid): an apple tree on
// north_4's terrace, a birch behind the corner house, a red-leaved shrub by the double garage.
export const GARDEN_TREES = [
  { kind: 'apple', x: 2200, z: -1250, r: 480, h: 850 },
  { kind: 'birch', x: -4050, z: 2780, r: 380, h: 1500 },
  { kind: 'shrub', x: 5450, z: 330, r: 160, h: 260 },
];
// Flower beds on the terraces (cosmos: tufts of leaves with pink and white flowers): north_3's
// behind its box hedge, north_4's along its wall.
export const FLOWER_BEDS = [
  { x0: -1000, x1: -300, z0: -1350, z1: -1050, n: 14, seed: 41 },
  { x0: 1880, x1: 2300, z0: -900, z1: -780, n: 7, seed: 43 },
];
// TV antennas on the chain houses' ridges (x along each ridge; drawn only).
export const ANTENNAS = [
  { house: 'south_1', x: -2900 },
  { house: 'south_dad', x: -900 },
  { house: 'south_2', x: 3800 },
];
// Two houses down the side road in the fog (drawn only, out of bounds): `t` along it, `s`
// across it (s > 0 its west side).
export const SIDE_BLOCKS = [
  { t: 900, s: 1100, w: 1600, d: 1100, tint: 0xece6d8 },
  { t: 2300, s: 1150, w: 1500, d: 1100, tint: 0xd8b65e },
];

// Butterflies over the dad's lawn and north_3's flower beds (ObjectManager), and small brown
// birds (BIRD_TINT) circling over the forest.
export const BUTTERFLY_SPOTS = [
  { x: 500, z: 900 },
  { x: -650, z: -1200 },
];
export const BIRD_CIRCLES = [
  { x: -2500, z: -5200, y: 2600, radius: 1300 },
  { x: 3000, z: -5600, y: 2900, radius: 1100 },
];
export const BIRD_TINT = 0x5a5048;

// ---------------------------------------------------------------- the boundary

// The play space: invisible walls (y -200 .. BOUNDS_TOP, facing in) along this polygon (clockwise
// seen from above, from the north-west), each a little inside a drawn edge (the forest bank, the
// hedges, the barrier, the trees round the outside) the camera cannot see over.
export const BOUNDS_TOP = 4500;
export const BOUNDS = [
  [-9000, 1300],
  [-8300, -2600],
  [-6000, -3700],
  [6600, -4000],
  [7900, -1500],
  [8000, 1300],
  [footpathAt(FOOTPATH.barrier, -FOOTPATH.half - 60).x, footpathAt(FOOTPATH.barrier, -FOOTPATH.half - 60).z],
  [footpathAt(FOOTPATH.barrier, FOOTPATH.half + 60).x, footpathAt(FOOTPATH.barrier, FOOTPATH.half + 60).z],
  [4600, 1600],
  [4800, 3500],
  [-3800, 3550],
  [-5300, 3600],
  [-7300, 3400],
  [-7800, 2700],
  [-9000, 2600],
];

// Whether (x, z) lies inside the boundary (even-odd).
export function inBounds(x, z) {
  let inside = false;
  for (let i = 0, j = BOUNDS.length - 1; i < BOUNDS.length; j = i++) {
    const [xi, zi] = BOUNDS[i];
    const [xj, zj] = BOUNDS[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- heights

// The road's centreline as drawn: on past the junction into the fog, and the side road.
const [W0, W1] = ROAD.line;
const westDir = [(W0[0] - W1[0]) / Math.hypot(W0[0] - W1[0], W0[1] - W1[1]), (W0[1] - W1[1]) / Math.hypot(W0[0] - W1[0], W0[1] - W1[1])];
export const ROAD_BEYOND = [W0[0] + westDir[0] * ROAD.beyond, W0[1] + westDir[1] * ROAD.beyond];
export const ROAD_DRAWN = [ROAD_BEYOND, ...ROAD.line];

// Distance from (x, z) to the road's centreline (its polyline; `line`: another, ROAD_DRAWN).
export function roadDistance(x, z, line = ROAD.line) {
  let best = Infinity;
  const L = line;
  for (let i = 0; i + 1 < L.length; i++) {
    const [ax, az] = L[i];
    const [bx, bz] = L[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

// The ground as the course stands on it (not the houses, hedges or props): the road and the
// turning area at 0, the north terraces (over their back gardens' ramp), the drive notches and
// everything else at GROUND, and outside the boundary to the north the forest bank (drawn).
export function groundHeight(x, z) {
  if (roadDistance(x, z) <= ROAD.half || Math.hypot(x - TURN.x, z - TURN.z) <= TURN.r) return 0;
  return offRoadHeight(x, z);
}
// The ground off the road and the turning area (groundHeight's, for a caller that knows the
// point is off them: the realistic look's lawn mask).
export function offRoadHeight(x, z) {
  const plot = PLOTS_N.find((p) => x >= p.x0 && x <= p.x1);
  if (plot && z < wallZAt(x)) {
    const inDrive = x >= plot.drive[0] && x <= plot.drive[1] && z > villaOf(plot).front;
    if (inDrive) return GROUND;
    if (z >= NORTH.flatZ) return NORTH.top;
    if (z >= NORTH.backZ) return NORTH.top + ((NORTH.flatZ - z) / (NORTH.flatZ - NORTH.backZ)) * (NORTH.backTop - NORTH.top);
    return bankHeight(z, NORTH.backTop);
  }
  if (z < NORTH.backZ && x > PLOTS_N[0].x0) return bankHeight(z, NORTH.backTop);
  return GROUND;
}
// The forest bank behind the back gardens, rising from `foot` at NORTH.backZ to bankTop.
export function bankHeight(z, foot) {
  const k = Math.max(0, Math.min(1, (NORTH.backZ - z) / (NORTH.backZ - NORTH.bankZ)));
  return foot + (NORTH.bankTop - foot) * k * (2 - k);
}
export const villaOf = (plot) => VILLAS.find((v) => v.id === plot.id);

// Golden hour, as in the photographs (an early October afternoon): the sun low in the
// south-west, so the villas' street faces and the turning area glow while the chain houses'
// fronts (the dad's too) stand in soft shade.
export const LANE_SUN = (() => {
  const v = { x: -0.16, y: 0.4, z: 0.9 };
  const l = Math.hypot(v.x, v.y, v.z);
  return Object.freeze({ x: v.x / l, y: v.y / l, z: v.z / l });
})();

const DEG = Math.PI / 180;

// The realistic look (world/lane/real/look.js, render/real/RealLook.js): the same golden hour,
// physically lit. Tuned by eye against the photographs (never sampled from them).
//   sky          the analytic sky's colours (linear: a blue zenith paling to a blue-white
//                horizon away from the sun, a peach band only near the horizon on its side, the
//                dim ground the environment's lower half shows), its brightness and cirrus, and
//                envTint: its light's colour beside its own (the environment only: a camera's
//                white balance, so the shade, the road and the white plinths read near neutral
//                as in the photos, not blue; G3)
//   exposure     before the output pass's Neutral tone mapping (1.3: the shade reads like the
//                phone photos without blowing out the sunlit villas)
//   environment  the sky's light on every realistic material (1.3: at 1 the shaded lawn is too
//                dark); haze: the aerial perspective's density per unit (exponential, toward the
//                sky's colour in each direction)
//   shadow       the sun's soft shadow (three's PCF with this radius; biases for the flat walls
//                at a grazing sun)
//   probe        the reflection probe's place: over the road in front of the dad's house
//   tiles        the houses whose roofs are real tile courses (world/lane/real/house.js: the dad's
//                and his neighbours', close to play; the rest the tile set's normal map)
//   atmosphere   the actors' look meanwhile (view.setAtmosphere): the sun (1, 0.82, 0.62) x 3
//                along LANE_SUN, a pale sky and green ground hemisphere for Jonas, the classic
//                objects' fog in the haze's horizon colour, far enough to match it
//   post         the screen-space effects' settings (render/real/post/*: which of them run is
//                the tier's level, tier.js): ao, the ambient occlusion from the depth buffer
//                (its reach in world units, ~0.7 m; strength; the angle bias against flat
//                surfaces darkening themselves; the widest it spreads, in half-res pixels);
//                bloom (the soft threshold and knee in linear HDR, the upsample's spread);
//                shafts (the radial blur's reach toward the sun, its decay per tap, the sky's
//                brightness that starts to shine)
//   grade        the output pass's composite and grade (render/real/OutputPass.js), tuned
//                against photos 19/40 and the GTA prototype (scratch p7): ao (the occlusion's
//                share) fading on bright pixels (aoLit), the bloom's mix and the shafts'
//                strength and tint, a filmic S-contrast, split toning (cool shadows, warm
//                highlights: more turns the Falu red brown in the house's shade), saturation,
//                vignette, and the lens touches kept subtle (edge colour fringing and grain:
//                stronger, they show on the white brick and the cars), a black-level lift
//   camera       the camera's profile in the realistic look (CameraController.setProfile): a
//                lower, wider third-person street view (the field of view 55, the look point
//                at his scaled chest, closer and flatter, gentler lags: the eye ~190 over his
//                feet at rest, an adult's; the classic camera's ~324), and first person's eye
//                at the smaller hero's (EYE_HEIGHT); the lane's camera tests pass with it too
//   hero         Jonas's model's size in the realistic look (the dad: "maybe a little smaller"):
//                only the model, scaled about his grip (player/model/scalePivot.js); his
//                collider and everything he does stay
export const LANE_REAL = Object.freeze({
  sky: Object.freeze({ zenith: [0.095, 0.215, 0.56], horizonAway: [0.56, 0.68, 0.84], horizonSun: [1.25, 0.82, 0.42], ground: [0.08, 0.085, 0.06], intensity: 1, clouds: 0.55, envTint: Object.freeze([1.08, 1, 0.8]) }),
  sunDir: LANE_SUN,
  exposure: 1.3,
  environment: 1.3,
  haze: 4e-5,
  shadow: Object.freeze({ radius: 2.5, bias: -0.0004, normalBias: 3 }),
  probe: Object.freeze({ x: 0, y: 260, z: 250 }),
  tiles: Object.freeze(['south_1', 'south_dad', 'south_2', 'south_2_wing']),
  atmosphere: Object.freeze({ fog: 0xbbd6f3, near: 3000, far: 45000, sun: 0xffeace, sunIntensity: 3, sunDir: LANE_SUN, sky: 0xcfe0ff, ground: 0x5a6040, ambientIntensity: 0.9 }),
  post: Object.freeze({
    ao: Object.freeze({ radius: 110, intensity: 2.6, bias: 0.12, maxPx: 90 }),
    bloom: Object.freeze({ threshold: 1.1, knee: 0.6, radius: 1 }),
    shafts: Object.freeze({ density: 0.9, decay: 0.965, threshold: 0.9 }),
  }),
  grade: Object.freeze({
    ao: 1,
    aoLit: 0.35,
    bloom: 0.07,
    shafts: 0.5,
    shaftTint: Object.freeze([1, 0.86, 0.62]),
    contrast: 0.25,
    split: 0.35,
    shadowTint: Object.freeze([0.97, 0.99, 1.02]),
    highTint: Object.freeze([1.07, 1, 0.9]),
    saturation: 1.08,
    vignette: 0.3,
    ca: 0.0015,
    grain: 0.015,
    black: 0,
  }),
  camera: Object.freeze({
    FOV: 55,
    LOOK_HEIGHT: 120,
    PIVOT_RATE: 0.18,
    LOOK_RATE: 0.45,
    ORBIT_MODES: Object.freeze({
      follow: Object.freeze({ dist: [1050, 1550], pitch: [4 * DEG, 9 * DEG], aim: [4 * DEG, 6 * DEG], swingGain: 0.02, swingMax: 0.8 * DEG, faceCamera: [100 * DEG, 155 * DEG] }),
      hero: Object.freeze({ dist: [700, 1050], pitch: [4 * DEG, 8 * DEG], aim: [3 * DEG, 5 * DEG], swingGain: 0.08, swingMax: 3 * DEG, faceCamera: [150 * DEG, 175 * DEG] }),
    }),
    EYE_HEIGHT: 115, // first person's eye over his feet: cameraConfig's 135 x the hero's 0.85
  }),
  hero: 0.85,
});

// ---------------------------------------------------------------- entries, doors, star

// Jonas comes out of his own front door, walking out onto the path toward the street (yaw pi),
// the camera in front of him over the lawn (camYaw), the door shutting behind him and the star
// over the ridge in view; that door (door: the one that swings as he arrives) is the way back
// into the hall. A lost life drops him in onto the path from `drop` above.
export const ENTRIES = {
  home: { x: DAD.door.x, y: DAD.floor, z: DAD.door.faceZ - 174, yaw: Math.PI, camYaw: Math.PI, walkIn: 8, door: 'lane_home' },
};
export const RESPAWN = { entry: 'home', drop: 1000 };
// Height the ground probe starts from (over every roof).
export const PROBE_Y = 4400;

// The dad's front door (objects/Door.js): walking into it takes him back into the Great Hall, out
// of its east door with the little house over it.
export const DOORS = [{ id: 'lane_home', x: DAD.door.x, z: DAD.door.faceZ, yaw: Math.PI, width: DAD.door.w, floorY: DAD.floor, to: 'hall', entry: 'east_2' }];

// The course's star waits over the dad's roof from the start, `over` the ridge (Star.js takes it
// from up to 270 under it: he takes it standing on the ridge).
export const STAR = { id: 'lane_star', x: -250, y: DAD.ridge + 180, z: DAD.ridgeZ, placed: true };

// ---------------------------------------------------------------- coins, signs, poles

// 50 coins, each at its floor + 60: down the path to the door, on the mailbox's roof, along the
// street both ways, round the turning area, along two wall tops and up north_3's steps, up
// north_4's drive, up the side yard between north_2 and north_3, on the motorhome's roof, along
// south_1's hedge, round the junction's lamppost, on the footpath, over the bins, on the
// carport's roof and up the roof's south-west slope.
const above = (y) => y + 60;
const roofAt = (z) => DAD.ridge - Math.abs(z - DAD.ridgeZ) * Math.tan((CHAIN.pitch * Math.PI) / 180);
const motorhome = (along) => ({ x: MOTORHOME.cx + Math.cos(MOTORHOME.yaw) * along, y: above(GROUND + MOTORHOME.h), z: MOTORHOME.cz - Math.sin(MOTORHOME.yaw) * along });
export const COINS = [
  ...[1080, 880, 680].map((z) => ({ x: 0, y: above(GROUND), z })),
  { x: MAILBOX.x, y: above(MAILBOX.ridge), z: MAILBOX.z },
  ...[-900, -1500, -2100, -2700, -3300].map((x) => ({ x, y: above(0), z: 0 })),
  ...[700, 1300, 1900].map((x) => ({ x, y: above(0), z: 0 })),
  ...Array.from({ length: 7 }, (_, k) => {
    const a = (k / 7) * Math.PI * 2;
    return { x: TURN.x + 650 * Math.sin(a), y: above(0), z: TURN.z + 650 * Math.cos(a) };
  }),
  ...[-3450, -3200, -2950].map((x) => ({ x, y: above(TERRACE), z: -750 })),
  ...[-800, -550, -300].map((x) => ({ x, y: above(TERRACE), z: -750 })),
  ...[-760, -880, -1000].map((z) => ({ x: 110, y: above(stepsY(PLOTS_N[2], z)), z })),
  ...[-1400, -1520, -1640].map((z) => ({ x: 3070, y: above(GROUND), z })),
  ...[-1900, -2300, -2700].map((z) => ({ x: -1125, y: above(TERRACE), z })),
  ...[-300, 0, 300].map(motorhome),
  ...[-3200, -2700, -2200].map((x) => ({ x, y: above(HEDGES[0].top), z: 640 })),
  { x: -8370, y: above(GROUND), z: 1590 },
  { x: -7995, y: above(GROUND), z: 1373 },
  { x: -7995, y: above(GROUND), z: 1807 },
  { ...footpathAt(500), y: above(GROUND) },
  { x: BINS[0].x, y: above(BIN.top), z: BINS[0].z },
  ...[2000, 2200, 2400].map((z) => ({ x: 1750, y: above(CARPORT.top), z })),
  { x: 1300, y: above(roofAt(2400)), z: 2400 },
  { x: 900, y: above(roofAt(2150)), z: 2150 },
];

// Signs: the dad's mailbox (post: false, the mailbox is the sign: no signpost drawn, its own
// collider within the sign's box), read from the street; the corner sign at the junction facing
// up the lane; the footpath's beside the blue sign, facing the turning area; the trampoline's at
// the turning area's rim below north_5's steps.
export const SIGNS = [
  {
    id: 'sparrow_mailbox',
    x: MAILBOX.x,
    y: GROUND,
    z: MAILBOX.z,
    yaw: MAILBOX.yaw,
    post: false,
    pages: ['SPARROW LANE', 'Welcome home, Jonas! A little blue sparrow keeps watch over the mailbox.', 'Something is twinkling up on the roof... Try the bins by the carport!'],
  },
  {
    id: 'lane_corner',
    x: -7800,
    y: GROUND,
    z: 1250,
    yaw: Math.PI - 1.17,
    pages: ['Sparrow Lane', 'Villas up the hill, the forest at the top and a turning area at the far end.', 'Every garden has something to find!'],
  },
  {
    id: 'lane_footpath',
    ...footpathAt(420, 480),
    y: GROUND,
    yaw: -2.43,
    pages: ['The footpath to the next street.', 'That is an adventure for another day!'],
  },
  {
    id: 'trampoline',
    x: 4780,
    y: GROUND,
    z: -1150,
    yaw: -0.96,
    pages: ['Up the steps: a trampoline!', 'Jump onto it and keep the jump button held to bounce sky high.'],
  },
];

// Climbable poles (CollisionWorld.addPole), each with the side the camera swings round to
// (camYaw) while he holds it: the junction's lamppost (looking along the west leg), the turning
// area's (at the dad's roof), the three flagpoles and the red-leaf tree (the roof ahead). Falls
// from a pole count from its foot.
const lampPole = (id, camYaw) => {
  const l = LAMPS.find((p) => p.id === id);
  return { x: l.x, z: l.z, y0: GROUND, y1: 1000, radius: 20, camYaw };
};
const flagPole = (id, camYaw) => {
  const f = FLAGPOLES.find((p) => p.id === id);
  return { x: f.x, z: f.z, y0: f.y0, y1: f.y0 + 1200, radius: 20, camYaw };
};
export const POLES = [
  lampPole('L1', -1.17),
  lampPole('L6', 2.42),
  flagPole('F1', -2.39),
  flagPole('F2', 1.5),
  flagPole('F3', -1.54),
  { x: RED_TREE.x, z: RED_TREE.z, y0: RED_TREE.y0, y1: RED_TREE.y1, radius: RED_TREE.radius, camYaw: Math.PI },
];
