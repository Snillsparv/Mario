// Sparrow Lane (area 'lane', course name SPARROW LANE), the second course, through the east door
// with the little house on its plaque in the Great Hall: a quiet residential cul-de-sac on a
// golden autumn afternoon, Jonas's own street. He steps out of his own black front door onto the
// grass-paver path of his red house; the course's star waits over the ridge of his roof, in view
// from the first second. The way up: hop onto a wheelie bin by the carport, onto the carport's
// flat roof and across onto the roof's slope (or jump at the front wall and grab the eave, or
// climb the red-leaf tree in the corner bed and flip off its top onto the roof). Up the hill
// across the street stand split-level villas behind grey block walls, with drives cut into
// their gardens, steps and side yards up to the forest; along the dad's side long low chain
// houses linked by carports; a turning area at the east end with a double garage and a footpath
// out to the next street; the junction at the west end with its lamppost, big trees and a
// motorhome on the first villa's drive. Nothing here hurts: no critters, no water.
// Everything here is in the course's own local frame, the street frame: 1 unit = 1 cm (the
// street is drawn at about 1.5 times its real size: its heights exactly, its plan close to it
// since W2, PLAN_K below), +x along the lane's long straight toward the turning area, +z
// across it toward the dad's side, -z up the hill toward the forest, the road at y 0.
// world/areas.js places it at its origin (world = local + origin); world/area.js shifts these
// anchors into world coordinates.
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

// Units per real metre of the heights (the houses, the steps, every climb rest on them).
export const SCALE = 150;
// The plan (W2): the aerial's readings (its 19.5 units a pixel, which is ~0.156 m, not 0.13)
// stretched by PLAN_K about the dad's north-east front corner (the aerial's (1600, 1220) is the
// game's (1600, 1330)), the heights kept: so the aerial, the photos taken against true lengths
// and those against the game's heights agree within ~5 %. plan(x, z) maps one reading.
export const PLAN_K = 1.3;
export const plan = (x, z) => [Math.round(1600 + PLAN_K * (x - 1600)), Math.round(1330 + PLAN_K * (z - 1220))];
// The road is flat at 0 (the real lane climbs a little eastward: dropped); the north pavement,
// the drives and the lawns at GROUND (a step walked up without a jump); the north gardens'
// terraces at TERRACE.
export const GROUND = 22;
export const TERRACE = 150;

// ---------------------------------------------------------------- the street

// The carriageway: `half` either side of its centreline polyline (the west leg from the
// junction, the bend round an arc of r ~1930, the long straight at z -90), mitred at its
// joints; the straight ends at the turning area's apron (APRON.x0), its south-east corner at the
// dad's drive's east edge. North of it the kerb (z -520) and the pavement to the terraces' wall
// (z -760); south of it no kerb (a bevelled asphalt edge, z 340), the lawns and drives a step up.
export const ROAD = {
  half: 430,
  line: [[-11712, 3179], [-7263, 230], [-7018, 92], [-6755, -8], [-6481, -69], [-6200, -90], [2766, -90]],
  beyond: 2860, // drawn on past the junction into the fog (out of bounds)
};
// The road's south edge along the straight (the lawns' and drives' front edge).
export const SOUTH_EDGE = ROAD.line.at(-1)[1] + ROAD.half;
// The turning area at the east end (the aerial's and the photos' apron): a rectangle from the
// straight's end (x0) to its east kerb (x1, in front of the double garage's forecourt), from its
// north edge (z0, in front of north_5's bed wall and the forecourts) to its south edge (z1,
// south_2's gravel); its west side open to the straight and the dad's drive; the straight's
// north kerb (`kerb`) runs on to curve[0], then curves out (an S) to the north edge at curve[1];
// its south-east corner rounded (se: toward the footpath's mouth), its south-west a little (sw).
// `ring`: the coins' ring on its asphalt. Its convex pieces: APRON.pieces (roadPieces' and
// groundHeight's): the rounded rectangle up to the kerb's line, and a quad under each piece of
// the S and of the north edge.
export const APRON = { x0: 2766, x1: 5190, z0: -880, z1: 1180, kerb: -520, curve: [4380, 4900], se: 400, sw: 150, ring: { x: 4050, z: 190, r: 600 } };
APRON.pieces = (() => {
  const A = APRON;
  const arc = (cx, cz, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [Math.round(cx + r * Math.cos(a)), Math.round(cz + r * Math.sin(a))];
  });
  const [c0, c1] = A.curve;
  // (The body's top edge leaves the kerb's line where the S starts, under the S's quads.)
  const body = [[A.x0, A.kerb], [c0, A.kerb], [A.x1, A.kerb + 100], ...arc(A.x1 - A.se, A.z1 - A.se, A.se, 0, Math.PI / 2, 8), ...arc(A.x0 + A.sw, A.z1 - A.sw, A.sw, Math.PI / 2, Math.PI, 4)];
  const kerb = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return [c0 + (c1 - c0) * t, Math.round(A.kerb + (A.z0 - A.kerb) * t * t * (3 - 2 * t))];
  }).concat([[A.x1, A.z0]]);
  const below = A.kerb + 100;
  const quads = [];
  for (let i = 0; i + 1 < kerb.length; i++) quads.push([kerb[i], kerb[i + 1], [kerb[i + 1][0], below], [kerb[i][0], below]]);
  return [body, ...quads];
})();
export const inApron = (x, z) => x >= APRON.x0 && x <= APRON.x1 && z >= APRON.z0 && z <= APRON.z1 && APRON.pieces.some((p) => inPolygon(p, x, z));
// The side road leaving the west leg at the junction (drawn only: its mouth is closed by the
// boundary).
export const SIDE_ROAD = { x: -10641, z: 2469, dir: [0.578, 0.816], half: 400, len: 2340 };
// Granite kerbs along the road's north edge and round the apron, a step of `h` (walked up
// without a jump), broken by every drive; along the south edge none.
export const KERB = { h: GROUND, w: 30 };
// The north pavement (asphalt, a shade lighter) along the west leg from the junction (`from`
// along it), the bend and the straight, `from`..`to` off the centreline, up to x1; on from there
// it narrows over the kerb's S to the terraces' wall (lane/build.js hardSurfaces).
export const PAVEMENT = { from: 430, to: 670, start: -11300, x1: 4420 };
// The footpath out of the turning area's south-east corner to the next street: `half` wide
// either side of its line from its mouth (x, z) along dir (drawn from `from`, inside the apron:
// the apron's asphalt cuts it), the footway behind the apron's east kerb (FOOTWAY: x0..x1) turning
// into it; the play space ends at a low wooden barrier `barrier` along it, and the path runs on
// (drawn only) to `len`.
export const FOOTPATH = { x: 5695, z: 1109, dir: [0.595, 0.804], half: 240, from: -1100, len: 3400, barrier: 1700 };
export const FOOTWAY = { x0: APRON.x1, x1: APRON.x1 + 210 };
// A point `t` along the footpath and `s` across it (s > 0: its west side).
export function footpathAt(t, s = 0) {
  const [dx, dz] = FOOTPATH.dir;
  return { x: FOOTPATH.x + dx * t - dz * s, z: FOOTPATH.z + dz * t + dx * s };
}

// ---------------------------------------------------------------- the north side (uphill)

// The villas' gardens are terraces behind a retaining wall of split-face grey blocks: from the
// pavement the wall (its face on the polyline `wall`, x and z: back behind the motorhome at the
// first villa's west end, straight along the pavement, then
// out along the apron's north edge in front of north_5's bed, then back behind the double
// garage's forecourt) rises to `top`; the gardens are flat back to flatZAt(x) (a line ~200..300
// behind the villas' backs: the forest's edge slopes away eastward), then rise 1 in 4 over `ramp`
// to backTop at backZAt(x), the forest's edge. Behind the gardens the forest bank rises (drawn
// only) to bankTop over `bank`.
export const NORTH = {
  wallZ: -760,
  wall: [[-1e5, -1100], [-7300, -1100], [-7300, -760], [4420, -760], [4700, -910], [5190, -910], [5190, -1179], [1e5, -1179]],
  top: TERRACE,
  flat0: -4564, // flatZAt(0)
  slope: -0.0394, // (the line's dz per unit x)
  ramp: 600,
  backTop: 300,
  bank: 1200,
  bankTop: 1500,
};
export const flatZAt = (x) => NORTH.flat0 + NORTH.slope * x;
export const backZAt = (x) => flatZAt(x) - NORTH.ramp;

// The wall's line (z) at x: NORTH.wall, linearly between its points; at a jog (two points at one
// x) the west side's.
export function wallZAt(x) {
  const W = NORTH.wall;
  for (let i = 0; i + 1 < W.length; i++) {
    const [ax, az] = W[i];
    const [bx, bz] = W[i + 1];
    if (x <= bx && bx > ax) return az + ((bz - az) * (Math.max(x, ax) - ax)) / (bx - ax);
  }
  return W.at(-1)[1];
}

// The villas' plots, west to east: x0..x1 (between the villas' middles); `drive` the notch cut
// into the garden at street level (cobbled, block walls either side) from the wall back to the
// villa's east block (its garage door), the east block's width or less; `steps` up from the
// street beside it on its east side to the terrace (a not-slippery ramp collider under the drawn
// steps, a railing on the drive's side), `run` deep.
export const STEPS = { run: 260, n: 5, rail: 90 };
// The steps' floor at z (on their ramp from the street up to the terrace).
export function stepsY(plot, z) {
  const k = (wallZAt(plot.steps[0]) - z) / STEPS.run;
  return GROUND + (TERRACE - GROUND) * Math.max(0, Math.min(1, k));
}
export const PLOTS_N = [
  { id: 'north_1', x0: -8150, x1: -5261, drive: [-6620, -5810], steps: [-5810, -5590] },
  { id: 'north_2', x0: -5261, x1: -2022, drive: [-3650, -2544], steps: [-2530, -2310] },
  { id: 'north_3', x0: -2022, x1: 1328, drive: [-402, 828], steps: [850, 1070] },
  { id: 'north_4', x0: 1328, x1: 4655, drive: [2936, 4142], steps: [4180, 4400] },
  { id: 'north_5', x0: 4655, x1: 7900, drive: [6196, 6579], steps: [4900, 5120] },
];

// The split-level villas (houses.js villa()): a white rendered lower floor with the garage door
// at drive level, a red-brown brick upper floor, a hipped roof of pan tiles with wide eaves.
// Each villa two blocks with their own hips (the aerial's L-shaped roofs): its east block (the
// garage's, forward, the villa's id) and its west block (`<id>_west`, set back), both from the
// villa's back; their fronts (toward the street, +z) at `front`; `garage` the garage door's
// middle (u, from the front's middle; north_5's east block has none: its doors at the drive's
// end); bay windows and arched windows on the upper floor (u);
// `sides` the faces with a window (not where the other block stands); `brick` and `roof` their
// tints; a balcony's middle along its block's west face (u).
export const VILLA = { y0: GROUND, render: 412, eave: 822, pitch: 27, overhang: 110, garage: { w: 520, h: 250 } };
const villa = (id, x0, x1, back, front, extras) => ({
  id,
  kit: 'villa',
  cx: (x0 + x1) / 2,
  cz: (back + front) / 2,
  w: x1 - x0,
  d: front - back,
  yaw: 0,
  y0: VILLA.y0,
  render: VILLA.render,
  eave: VILLA.eave,
  pitch: VILLA.pitch,
  overhang: VILLA.overhang,
  front,
  ...extras,
});
// A villa's two blocks from its aerial readings: x west, the step, east; z back, the west
// front, the east front.
const villaPair = (id, [xw, xs, xe, zb, zw, ze], east, west) => {
  const [x0, z0] = plan(xw, zb);
  const [x1, z1] = plan(xs, zw);
  const [x2, z2] = plan(xe, ze);
  return [villa(id, x1, x2, z0, z2, { sides: ['back', 'right'], ...east }), villa(`${id}_west`, x0, x1, z0, z1, { sides: ['back', 'left'], brick: east.brick, roof: east.roof, ...west })];
};
const PAIRS = [
  villaPair('north_1', [-5829, -5016, -4080, -2912, -1935, -1180], { garage: 200, bays: [70], arches: [-400], door: -400, brick: 0xac6036, roof: 0x2e2c2c }, { windows: [-250, 250] }),
  villaPair('north_2', [-3275, -2462, -1588, -2934, -2033, -1313], { garage: 265, bays: [265], arches: [-370], door: -260, brick: 0xa05832, roof: 0x2e2c2c }, { windows: [-200, 250] }),
  villaPair('north_3', [-785, 60, 1006, -2980, -1979, -1209], { garage: 250, bays: [150], arches: [-400], door: -420, balcony: 500, brick: 0xa45c34, roof: 0x4a3a32 }, { windows: [0] }),
  villaPair('north_4', [1776, 2628, 3555, -3050, -2075, -1302], { garage: 300, bays: [300], windows: [-350], door: -300, brick: 0xa85a32, roof: 0x4a3a32 }, { windows: [-200, 250] }),
  villaPair('north_5', [4345, 5135, 6095, -3312, -2382, -1620], { bays: [250], arches: [-430], door: -432, doorTint: 0x6a4a32, brick: 0xae6236, roof: 0x4a3a32 }, { windows: [-200, 200] }),
];
// The plots' villas (their east blocks) first, in the plots' order, then the west blocks.
export const VILLAS = [...PAIRS.map((p) => p[0]), ...PAIRS.map((p) => p[1])];

// ---------------------------------------------------------------- the west end

// The first villa up the hill (north_west): white render to its eaves, a light grey hipped roof
// with two roof windows, a double garage facing the west leg (its front: yaw, as the house kit
// turns it: local +w looks (sin yaw, cos yaw)), and a low wing behind it (its east wall flush
// with the house's); a flagstone drive in front of it out to the pavement (NORTH_WEST_DRIVE, in
// its frame: u along the front, w out toward the road; lane/build.js cuts it at the pavement).
const WEST_YAW = Math.atan2(0.574, 0.819);
const NW_U = [Math.cos(WEST_YAW), -Math.sin(WEST_YAW)];
const NW_W = [Math.sin(WEST_YAW), Math.cos(WEST_YAW)];
export const NORTH_WEST = {
  id: 'north_west',
  kit: 'villa',
  cx: -9448,
  cz: -1245,
  w: 1900,
  d: 1860,
  yaw: WEST_YAW,
  y0: GROUND,
  render: 462,
  eave: 462,
  pitch: 25,
  overhang: 90,
  garage: 0,
  garages: [-450, 450],
  roofWindows: [-400, 400],
  roof: 0xa4a6a8,
};
// Its wing, behind it (north), lower.
const NW_WING = { w: 1580, d: 1500 };
const nwWing = (du, dw) => [NORTH_WEST.cx + NW_U[0] * du + NW_W[0] * dw, NORTH_WEST.cz + NW_U[1] * du + NW_W[1] * dw];
export const NORTH_WEST_WING = { id: 'north_west_wing', kit: 'villa', cx: nwWing((NORTH_WEST.w - NW_WING.w) / 2, -(NORTH_WEST.d + NW_WING.d) / 2)[0], cz: nwWing((NORTH_WEST.w - NW_WING.w) / 2, -(NORTH_WEST.d + NW_WING.d) / 2)[1], w: NW_WING.w, d: NW_WING.d, yaw: WEST_YAW, y0: GROUND, render: 412, eave: 412, pitch: 15, overhang: 90, roof: 0xa4a6a8 };
export const NORTH_WEST_DRIVE = { u0: -950, u1: 1500, w0: NORTH_WEST.d / 2, w1: 1900, cut: [1075, 1250] };
// Its outline (convex, in the house's frame): its east end's back corner cut off along the
// first terrace's wall.
export const northWestDrive = () => {
  const D = NORTH_WEST_DRIVE;
  return [[D.u0, D.w0], [D.cut[0], D.w0], [D.u1, D.cut[1]], [D.u1, D.w1], [D.u0, D.w1]];
};
// The motorhome on the drive (a white box with a dark window band on four dark wheels),
// lengthwise on the drive's east part beside the garage: l along its frame's u (along the road),
// w across it, h tall; solid to its roof (a coin spot, reached by a double jump and a grab of its
// edge; a running jump from the drive falls short: its top stands more than 160 over that
// jump's peak).
export const MOTORHOME = { cx: -7841, cz: -527, yaw: WEST_YAW, l: 1090, w: 390, h: 500 };

// Falu red as the photos have it (W1): a cool, deep red (hue ~2 deg), the blue close to the green,
// so it stays red in the house's shade instead of turning brown.
const FALU = 0x7a2422;

// The corner house south of the west leg (south_west): red boards over white brick, a black
// gable roof, a glazed veranda on its west gable (veranda: along u past the gable, flat roof at
// `top`; the photos' veranda is the house's west of the side road: W8), a back wing behind its
// east part; a brown picket fence along its street side.
const pitchRidge = (eave, d, deg) => Math.round(eave + (d / 2) * Math.tan((deg * Math.PI) / 180));
export const SOUTH_WEST = {
  id: 'south_west',
  kit: 'chain',
  cx: -7809,
  cz: 2530,
  w: 2536,
  d: 1568,
  yaw: Math.PI + WEST_YAW,
  y0: GROUND,
  eave: 412,
  ridge: pitchRidge(412, 1568, 20),
  boards: FALU,
  roof: 0x2c2c2e,
  door: -360,
  windows: [-900, 180, 720],
  veranda: { depth: 450, top: 352 },
};
export const SOUTH_WEST_WING = { id: 'south_west_wing', kit: 'chain', cx: -6743, cz: 3237, w: 1574, d: 813, yaw: Math.PI + WEST_YAW, y0: GROUND, eave: 412, ridge: pitchRidge(412, 813, 20), boards: FALU, roof: 0x2c2c2e, windows: [-400, 400] };
// Fences (FENCES): [u0, w0, u1, w1] in a house's frame, `h` high; their colliders are slabs.
export const FENCES = [{ house: 'south_west', kind: 'picket', from: [1700, 1090], to: [-550, 1090], h: 110 }];

// ---------------------------------------------------------------- the dad's side (south)

// The long chain houses (houses.js chain()): vertical boards over a white brick plinth
// (`plinth` high), black window frames, a low gable roof (20 degrees, ridge along the street; a
// house's own `pitch` over it: the dad's), their fronts toward the street (-z: yaw pi, so their u
// runs toward -x).
export const CHAIN = { y0: GROUND, plinth: 135, eave: 412, pitch: 20, overhang: 60 };
const chain = (id, x0, x1, z0, z1, extras = {}) => ({
  id,
  kit: 'chain',
  cx: (x0 + x1) / 2,
  cz: (z0 + z1) / 2,
  w: x1 - x0,
  d: z1 - z0,
  yaw: Math.PI,
  y0: CHAIN.y0,
  eave: CHAIN.eave,
  ridge: pitchRidge(CHAIN.eave, z1 - z0, extras.pitch ?? CHAIN.pitch),
  ...extras,
});
// u along a south house's front of course x (its u runs toward -x).
const uS = (x0, x1, x) => (x0 + x1) / 2 - x;

// The dad's house (south_dad, W3: as the photos and the aerial have it): a shallow main body
// (930 deep) under a steeper roof (pitch 32: the ridge at ~700; the eaves stay at 412 and the
// rim at 393, so a standing jump still grabs the front eave; overhang 30: the back corner's eave
// clear of the carport's roof), red boards, white brick piers to the eaves at both ends of the
// front (`brick`: u ranges per face; the ivy over the east one) and on both gable ends (red
// boards in their triangles), black pan tiles. On the front, east to west: a window, the black
// board door (DOOR: its middle x, width, height over the floor, `sill` its foot over the floor: a
// concrete landing in front, LANDING; face at z0) with a glazed side light west of it in one dark
// frame and a lantern beyond, then four windows; every window (`win`: its opening, sill and
// height over the floor) two casements of three lights. At the back (backWindows: the back
// face's own u) two windows onto the patio between the wings. Two wings behind it (DAD_WINGS).
export const DAD = chain('south_dad', -860, 1600, 1330, 2260, { boards: FALU, roof: 0x262628, pitch: 32, overhang: 30 });
DAD.x0 = -860;
DAD.x1 = 1600;
DAD.z0 = 1330;
DAD.z1 = 2260;
DAD.floor = GROUND;
DAD.ridgeZ = DAD.cz;
DAD.door = { x: 1005, w: 150, h: 345, sill: 20, faceZ: DAD.z0, vestibule: 120 };
DAD.door.u = uS(DAD.x0, DAD.x1, DAD.door.x);
DAD.win = { w: 160, h: 202, sill: 145 };
DAD.windows = [1228, 623, 205, -67, -378].map((x) => uS(DAD.x0, DAD.x1, x));
DAD.backWindows = [130, 560].map((x) => x - DAD.cx);
DAD.brick = { front: [[uS(DAD.x0, DAD.x1, DAD.x1), uS(DAD.x0, DAD.x1, 1330)], [uS(DAD.x0, DAD.x1, -470), uS(DAD.x0, DAD.x1, DAD.x0)]] }; // (the west pier from the west window's outer edge: W3 fix)
DAD.gableEnds = true; // white brick to the eaves at both ends
DAD.pipes = { front: [-1, 1], back: [] }; // (the back eave's run into the wings)
DAD.eaveLip = 20; // (its roof is steeper than a ledge's top: lane/houses.js chain())
// The car charger on the east gable near its back corner (W4: under the gable's lamp, as photos
// 36/37 have it), and the round black bulkhead lamps on the two gables facing the drive (GABLE_LAMPS).
DAD.charger = { x: DAD.x1, z: 2125 };
// The landing in front of the door: concrete, `top` over the lawn (a step he walks up), a row
// of cobbles along its front edge; the blue glazed pot on its east end.
export const LANDING = { x0: 895, x1: 1150, z0: 1190, z1: DAD.z0, top: GROUND + DAD.door.sill };
// The wings (lane/houses.js chain() with `join`): chain records turned a quarter (yaw pi/2: their
// ridges along z, their fronts toward +x, their +u end toward the main body), as high and steep
// as the main roof, each running into its back slope (`join`: the valleys, where the wing's
// slopes meet it, from the wing's rim, `rim` along its u, up to its ridge at `apex`; past its
// wall the near gable stands inside the main body and is not drawn); the west one (x -860..-120)
// its front onto the patio, its back against the link; the east one (x 870..1600) flush with the
// east gable, white brick to the eaves along the drive (one white wall), its back onto the
// patio. Downpipes only at their far ends (`pipes`: the eaves' ends, -1 the far one).
const DAD_TAN = (DAD.ridge - DAD.eave) / (DAD.d / 2);
const backSlopeZ = (y) => DAD.ridgeZ + (DAD.ridge - y) / DAD_TAN; // (where the main roof's back slope is y high)
const dadWing = (id, x0, x1, z1, extras) => {
  const [w, d] = [z1 - DAD.z1, x1 - x0];
  const ridge = pitchRidge(DAD.eave, d, DAD.pitch);
  const tan = (ridge - DAD.eave) / (d / 2);
  const lo = DAD.eave - DAD.overhang * tan;
  return { id, kit: 'chain', cx: (x0 + x1) / 2, cz: (DAD.z1 + z1) / 2, w, d, yaw: Math.PI / 2, y0: GROUND, eave: DAD.eave, ridge, pitch: DAD.pitch, overhang: DAD.overhang, boards: FALU, roof: DAD.roof, gableEnds: true, win: DAD.win, join: { rim: w / 2 + DAD.z1 - backSlopeZ(lo), apex: w / 2 + DAD.z1 - backSlopeZ(ridge) }, ...extras };
};
export const DAD_WINGS = [
  dadWing('south_dad_west', DAD.x0, -120, 2850, { windows: [-80], backWindows: [], pipes: { front: [-1], back: [] } }),
  dadWing('south_dad_east', 870, DAD.x1, 3280, { windows: [], backWindows: [-250, 250], brick: { front: [[-1e4, 1e4]] }, pipes: { front: [-1], back: [-1] } }),
];

// Its neighbours along the chain, west to east: the yellow house (south_1, forward of the dad's)
// and the flat-roofed link between it and the dad's (set back); the garage row between the dad's
// and the yellow house to the east (south_2, set back, its wing behind its east end).
export const SOUTH_1 = chain('south_1', -4040, -1430, 905, 2090, { boards: 0xd8b65e, roof: 0x2a2a2c, door: uS(-4040, -1430, -2434), windows: [-3706, -3236, -2834, -2033, -1699].map((x) => uS(-4040, -1430, x)), gableEnds: true });
export const LINK = { id: 'link', x0: SOUTH_1.cx + SOUTH_1.w / 2, x1: DAD.x0, z0: 1425, z1: 2830, top: 370, slab: 25, boards: 0xd8b65e };
// The garage row between the dad's east wing and south_2 (W4: as photos 33-37 have it): a flat
// roof from his gable's back corner (z0, the fascia's face, level with his back wall) back over
// the store room, `top` just under his east wing's eave (its roof meets the wing's), no open bay:
// the door wall right behind the fascia. (Its id stays the carport's.)
export const CARPORT = { id: 'carport', x0: 1600, x1: 2766, z0: DAD.z1, z1: 3000, top: 392, slab: 25, back: 0xd8b65e };
// The store room under the garage row's roof (objects/laneBoss/LaneGarage.js breaks its doors):
// its door wall just behind the roof's front edge (`wall`: its face toward the drive, `thick`
// deep, up to the slab's underside `under`), a thin dark fascia board along the roof's edge down
// to `fascia` (the doors' tops), the room behind the wall back to the row's back wall (lined with
// bare boards `inside`, `lining` in from the gables). Along the wall, west (the dad's wing) to east
// (south_2's gable), as photos 36/37 have them: `fixed` boards [x0, x1, tint index] and the four
// leaves (`leaves`: x0..x1, tint index, `hinge` side -1 west / +1 east, `handle`, `sign`; each
// `door` high, its collider named garage_0 .. garage_3 in this order): a wide dark brown door
// (behind the dad's car, the climber over the board west of it), the red door (between the two
// cars from the drive), the red strip with the grey downpipe (`pipe`: its x), the dark brown
// double doors (behind the SUV, a small blank sign high on the east leaf) and the yellow end
// panel by south_2. Inside, along the walls, the room's things' boxes (`props`: x0, x1, z0, z1,
// each solid up to `propTop`, walls only: never a floor under the low ceiling): a workbench under
// a tool board, steel shelves, winter tyres, moving boxes, a lawn mower, a bike, garden tools (in
// this order: world/lane/garage.js ROOM draws them, with the fluorescent tube and the 1-up's
// place); five coins (COINS).
const ROOM_Z = 350; // (W4: the room moved back with its wall, everything in it with it)
export const GARAGE = {
  wall: CARPORT.z0 + 40,
  thick: 20,
  door: GROUND + 318,
  under: CARPORT.top - CARPORT.slab,
  fascia: GROUND + 318,
  lining: 10,
  tints: [0x3e2c24, FALU, CARPORT.back], // dark brown, the house's Falu red, yellow
  inside: 0x5e4e3e, // the lining's bare boards
  fixed: [[1600, 1712, 0], [2187, 2242, 1], [2606, CARPORT.x1, 2]],
  leaves: [
    { x0: 1712, x1: 2030, tint: 0, hinge: -1, handle: 1 },
    { x0: 2030, x1: 2187, tint: 1, hinge: 1, handle: 1 },
    { x0: 2242, x1: 2424, tint: 0, hinge: -1 },
    { x0: 2424, x1: 2606, tint: 0, hinge: 1, handle: 1, sign: 1 },
  ],
  pipe: 2196,
  props: [[1990, 2190, 2560, 2630], [2230, 2480, 2575, 2630], [2400, 2480, 2380, 2460], [2405, 2485, 2470, 2550], [1640, 1770, 2420, 2590], [1612, 1650, 2030, 2290], [1612, 1640, 1985, 2020]].map(([x0, x1, z0, z1]) => [x0, x1, z0 + ROOM_Z, z1 + ROOM_Z]),
  propTop: GROUND + 218,
};
export const SOUTH_2 = chain('south_2', 2770, 5410, 1980, 3080, { boards: 0xd8b65e, roof: 0x3a302c, door: uS(2770, 5410, 4370), windows: [3250, 3810, 4930].map((x) => uS(2770, 5410, x)), gableEnds: true });
// Its east wing behind it (ridge along z: turned a quarter, its front toward +x; the west one is
// W5's).
export const SOUTH_2_WING = { ...chain('south_2_wing', 4668, 5435, SOUTH_2.cz + SOUTH_2.d / 2, 3858, { boards: 0xd8b65e, roof: 0x3a302c }), w: 3858 - 3080, d: 5435 - 4668, yaw: Math.PI / 2, ridge: pitchRidge(CHAIN.eave, 5435 - 4668, CHAIN.pitch), windows: [0] };

// The dad's front garden (W3: everything on the door's line, as the photos have it): the mossy
// grass-paver path straight from the road's edge to the door's landing, the pedestal mailbox at
// its street end on its west side with a rose on stakes beside it (ROSE), the red-leaf bed east of
// the path (BED: a rounded rectangle of fallen russet leaves over a low ground cover from the
// path to the drive and from the street's edge back, edged all round with round field stones,
// right at the asphalt along the street (no kerb there); the big, open red-leaf tree in its
// middle, its trunk a climbable pole; the turning area's sign at its corner by the asphalt:
// TURN_SIGN), the ivy mound over the white pier at the house's north-east corner (IVY: drawn
// only), the rhododendron out from the west pier, the blue pot on the landing; his drive
// (asphalt, DAD_DRIVE) east of the house from the street to the garage row's doors, gable to
// south_2 (its west edge bending out round the ivy: DRIVE_NOTCH); the two big wheelie bins against
// the front of the house's east gable (BINS: their middles; BIN: the body's size, its lid's top at
// `top`), the car charger near the gable's back corner (DAD.charger) under its lamp (GABLE_LAMPS),
// a climber up the corner (CLIMBER: drawn only); behind the house between the wings a patio of
// grey slabs. The link's own short drive in front of its garage door.
export const DAD_PATH = { x0: 885, x1: 1125, z0: SOUTH_EDGE, z1: LANDING.z0 };
// The bed: a rectangle x0..x1 from the street's edge (z0) back to z1, its back corners rounded
// (r), its soil `raise` over the lawn (under the knee: walked onto from the road), field stones
// along all four edges (real/plan.js bedStones).
export const BED = { x0: DAD_PATH.x1, x1: DAD.x1, z0: SOUTH_EDGE, z1: 980, r: 120, raise: 6 };
// Its outline (convex, counter-clockwise from the street's west end): square at the street, the
// back corners rounded with n steps each.
export function bedOutline(n = 4) {
  const { x0, x1, z0, z1, r } = BED;
  const arc = (cx, cz, a0) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (i / n) * (Math.PI / 2);
    return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
  });
  return [[x0, z0], [x1, z0], ...arc(x1 - r, z1 - r, 0), ...arc(x0 + r, z1 - r, Math.PI / 2)];
}
export const inBed = (x, z) => {
  const { x0, x1, z0, z1, r } = BED;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  return z <= z1 - r || Math.hypot(x - cx, z - (z1 - r)) <= r;
};
// The red-leaf tree (an old purple-leaved crab apple): its trunk forking at `fork` into four
// leaning stems, a wide sparse crown (canopy: r, from y0 to y1) reaching over the street and the
// eaves; its trunk the climbable pole up to y1 (a flip from its top toward the house lands on the
// roof).
export const RED_TREE = { x: 1390, z: 690, y0: GROUND, y1: 440, radius: 28, trunkTop: 420, fork: 260, canopy: { r: 440, y0: 300, y1: 960 } };
// The turning area's sign at the bed's corner by the asphalt, facing the street's way in (west):
// a grey post (solid, `collider` round) carrying a yellow plate with a red rim (`plate`: w by h,
// its foot at y0), "Vänd-" over "plats" on it in black and under them the round no-parking sign
// (a blue disc in a red ring, one red stripe; world/lane/real/sign.js lays its face out), and
// under the plate a small blank blue plate (`sub`: its foot and height).
export const TURN_SIGN = { x: 1520, z: SOUTH_EDGE + 55, yaw: -Math.PI / 2, top: 492, r: 8, collider: 12, plate: { w: 84, h: 130, y0: 350 }, sub: { y0: 306, h: 34 } };
// The rhododendron out from the west pier (an ellipsoid, rx along the street, rz across, h
// high; solid), the ivy mound over the north-east pier and round the corner (drawn only), the
// rose on three stakes beside the mailbox (drawn only), the pot on the landing.
export const RHODODENDRON = { x: -650, z: 1020, rx: 210, rz: 330, h: 330 }; // (W3 fix: under the gutter, the west pier showing over it, as photos 19 and 41 have it)
export const IVY = { x: 1520, z: 1205, rx: 210, rz: 130, h: 420 };
export const ROSE = { x: 745, z: 525, r: 70, h: 250 };
export const POT = { x: 1118, z: 1292 };
export const DAD_DRIVE = { x0: DAD.x1, x1: CARPORT.x1, z0: SOUTH_EDGE, z1: CARPORT.z0 };
// The drive's west edge bends out round the ivy mound at the house's corner: lawn x0..x1 over
// z0..z1, its corners cut by `cut` (lane/build.js hardSurfaces: the drive's convex pieces).
export const DRIVE_NOTCH = { x0: DAD.x1, x1: 1750, z0: 1030, z1: 1230, cut: 40 };
// The drive's asphalt as convex pieces: east of the notch the whole length, west of it in front
// of and behind the lawn.
export const drivePieces = () => {
  const { x0, x1, z0, z1 } = DAD_DRIVE;
  const N = DRIVE_NOTCH;
  return [
    [[N.x1, z0], [x1, z0], [x1, z1], [N.x1, z1], [N.x1, N.z1], [N.x1, N.z0]], // (its west edge's corners: no T-joint)
    [[x0, z0], [N.x1, z0], [N.x1, N.z0], [x0, N.z0 - N.cut]],
    [[x0, N.z1 + N.cut], [N.x1, N.z1], [N.x1, z1], [x0, z1]],
  ];
};
export const LINK_DRIVE = { x0: LINK.x0, x1: LINK.x1, z0: SOUTH_EDGE, z1: LINK.z0 };
export const PATIO = { x0: DAD_WINGS[0].cx + DAD_WINGS[0].d / 2 + 20, x1: DAD_WINGS[1].cx - DAD_WINGS[1].d / 2 - 20, z0: DAD.z1, z1: 3250 };
// The bins (W4: the photos' four-compartment ones, a little bigger than the old, their lids split
// front and back, the handle and the wheels toward the street), their homes against the gable's
// front clear of the hose reel (W3's: z <= 1447) and the charger.
export const BIN = { x: 120, z: 105, h: 165, top: GROUND + 165 };
export const BINS = [{ x: 1680, z: 1552 }, { x: 1680, z: 1676 }]; // (W4 fix: 124 apart, each lid clear of the other's and the back one's handle and wheels of the front one: two bins, as photos 36 and 37 have them)
// The bins move (objects/laneBoss/LaneBins.js, once the lane's lazy chunk is in): pushed by
// walking into them, grabbed with the attack button and pulled, kept on the dad's drive (BIN_LEASH:
// the box a bin's middle stays in, 20 off the gable (its charger and cable stand out of it); never
// the road, a lawn, a roof or the store room: its back stops 110 short of the door wall, so a bin
// never stands in a doorway; pushed back along the gable to the garage row it is the star climb's
// step up onto its roof), and home again on every arrival, lost life and new game, or by
// themselves when left. Each movable bin: its home (BINS), its floor, its size, its collider's name
// (lane/props.js: the static build's box, named) and its leash. (Only the dad's two stand on the
// street: the photos show none by the other drives.)
export const BIN_LEASH = { x0: DAD_DRIVE.x0 + 20 + BIN.x / 2, x1: DAD_DRIVE.x1 - 4 - BIN.x / 2, z0: DAD_DRIVE.z0 + 10 + BIN.z / 2, z1: GARAGE.wall - 110 - BIN.z / 2 };
// The round black bulkhead lamps (a ribbed cage over a pale glass) on the two gables facing the
// drive near the garage row: the dad's (x: its wall, out +x) and south_2's (out -x); y their
// middles.
export const GABLE_LAMPS = [{ x: DAD.x1, y: 350, z: 2140, out: 1 }, { x: 2770, y: 360, z: 2140, out: -1 }];
// The climber up the gable's back corner and over the fascia's west end (drawn only): x0..x1
// out from the wall, z0..z1 along it, up to `top`.
export const CLIMBER = { x0: DAD.x1, x1: DAD.x1 + 100, z0: 2195, z1: 2275, top: 400 };
// The slim steel flue (a rain cap on it) on the east wing's drive-side slope near its back end,
// seen over the garage row's fascia from the drive (photos 36/37): drawn only, its foot on the
// slope at (x, z), `h` over the slope.
export const FLUE = { x: 1460, z: 3245, r: 11, cap: 19, h: 265 };
export const MOVABLE_BINS = BINS.map((b, i) => ({ id: `bin_${i}`, x: b.x, y: GROUND, z: b.z, w: BIN.x, d: BIN.z, h: BIN.h, leash: BIN_LEASH }));

// ---------------------------------------------------------------- the east end

// A double garage behind its forecourt east of the turning area (east_garage: white render, a
// white vertical-board gable toward the apron, two dark panel doors in it; its ridge along x) in
// front of a one-and-a-half storey house (east_house, drawn and solid, mostly out of reach).
export const EAST_GARAGE = { id: 'east_garage', kit: 'garage', cx: (6579 + 7853) / 2, cz: (-1179 - 113) / 2, w: 1066, d: 1274, yaw: -Math.PI / 2, y0: GROUND, eave: 412, ridge: pitchRidge(412, 1066, 35), doors: [-260, 260] };
export const EAST_HOUSE = { id: 'east_house', kit: 'chain', cx: (8022 + 9699) / 2, cz: (-906 + 1473) / 2, w: 2379, d: 1677, yaw: -Math.PI / 2, y0: GROUND, eave: 522, ridge: pitchRidge(522, 1677, 40), boards: 0xd8b65e, roof: 0x2c2c2e, door: 0, windows: [-770, 770], plinth: 135 };
// The forecourt in front of the double garage (asphalt at GROUND, from the apron's east kerb to
// the garage's doors, as wide as the garage) and north_5's drive on from its north-west corner.
export const FORECOURT = { x0: APRON.x1, x1: EAST_GARAGE.cx - EAST_GARAGE.d / 2, z0: EAST_GARAGE.cz - EAST_GARAGE.w / 2, z1: EAST_GARAGE.cz + EAST_GARAGE.w / 2 };

// Every house as houses.js builds it.
export const HOUSES = [...VILLAS, NORTH_WEST, NORTH_WEST_WING, SOUTH_WEST, SOUTH_WEST_WING, SOUTH_1, DAD, ...DAD_WINGS, SOUTH_2, SOUTH_2_WING, EAST_GARAGE, EAST_HOUSE];

// ---------------------------------------------------------------- hedges, trees, street furniture

// Hedges (solid leafy boxes, their tops walkable): [x0, x1, z0, z1, y0, top].
export const HEDGES = [
  { x0: SOUTH_1.cx - SOUTH_1.w / 2, x1: LINK.x0, z0: SOUTH_EDGE, z1: SOUTH_EDGE + 130, y0: GROUND, top: 187 }, // south_1's front, at the asphalt's edge
  { x0: -5400, x1: 5800, z0: 4100, z1: 4300, y0: GROUND, top: 242 }, // the south back hedges
  { x0: 7950, x1: 8150, z0: -1600, z1: -1000, y0: GROUND, top: 202 }, // between north_5 and the east house
  { x0: -1300, x1: -500, z0: -960, z1: -880, y0: TERRACE, top: 230 }, // north_3's low box hedge
];
// Thuja columns (8-sided, tapering; solid): a tall group on north_1's terrace along its drive's
// west side, behind the wall.
export const THUJA = { r: 70, h: 900 };
export const THUJAS = [
  { x: -6750, z: -900 },
  { x: -6690, z: -975 },
  { x: -6745, z: -1050 },
  { x: -6685, z: -1120 },
  { x: -6740, z: -1190 },
];
// Big broad-leaved trees off the junction, at the forest's edge north-west of the curve (outside
// the play space: drawn only, no collider): r the canopy's radius, h its top.
export const TREES = [
  { x: -12570, z: 1760, r: 750, h: 1900 },
  { x: -13910, z: -1820, r: 800, h: 2000 },
];
// The forest on the bank behind the north gardens (fir(): a seeded scatter of `count` firs and
// `birches` birches over the band x0..x1, from z0 + slope x back to z1 + slope x: following the
// gardens' sloping back edge), and the ring of trees drawn round the outside of the boundary
// (EDGE_FOREST: `count` firs `from`..`to` outside it), so the camera never looks out on nothing;
// none in `clear` (x0..x1 beyond z0: W4, the sky the photos show over the garage row and the
// dad's roof from his drive; its seeded spots are skipped, the others stay where they were),
// only the columnar tree there far behind (COLUMN_TREES: drawn only, out of bounds: the Lombardy
// poplar over the garage row in photo 37, out on the field on that photo's line of sight (W4
// fix: far enough that photos 33 and 35 no longer show it over south_2's roof, near enough that
// the haze leaves it near as dark as 37 has it; photo 36, which shows none, has it near its
// edge), its outline as 37 has it: r its crown's widest, h its height).
export const FOREST = { count: 34, birches: 10, x0: -9600, x1: 9300, z0: NORTH.flat0 - 150, z1: NORTH.flat0 - 1850, slope: NORTH.slope, seed: 0x5ba77 };
export const EDGE_FOREST = { count: 70, from: 900, to: 2600, seed: 0x5ba78, clear: { x0: -1100, x1: 5000, z0: 4300 } };
export const COLUMN_TREES = [{ x: 1415, z: 6000, r: 230, h: 1650 }];

// Lampposts (grey, an arm and a flat lamp head) where the photos have them, every one a climbable
// pole (POLES; no collider of its own but the pole's trunk) up to its very top (a handstand on its
// cap): the arm leaves the post `root` under the top and rises out to the lamp head (clear of him
// as he climbs past it on his side of the post and stands on the cap), out along its yaw over the
// street: L1 at the junction (the west leg's pavement's back edge), L2 at the bend's east end,
// L3 east of north_2's drive, L5 by north_4, L7 down the footpath.
export const LAMP = { r: 14, top: 1050, arm: 150, root: 60, collider: 30 };
export const LAMPS = [
  { id: 'L1', x: -11070, z: 1630, yaw: 1.95 },
  { id: 'L2', x: -6145, z: -570, yaw: 0 },
  { id: 'L3', x: -2250, z: -720, yaw: 0 },
  { id: 'L5', x: 2200, z: -720, yaw: 0 },
  { id: 'L7', ...footpathAt(800, 300), yaw: -2.2 },
];
// White flagpoles with a gold knob (climbable) where the real ones stand, each flying a long
// blue and yellow pennant (PENNANT, drooping), all before the same light breeze (WIND: the way
// they stream, the waves running down them: amp at the tip, k per unit along, speed per second;
// a pole's `limp` scales its waves): F1 behind north_2's bed (taller, its pennant limp), F2 in the
// east house's front garden, F3 behind the corner house's back wing; `h` the pole's height.
export const FLAGPOLE = { r: 14, h: 1200 };
export const FLAGPOLES = [
  { id: 'F1', x: -4070, z: -1420, y0: TERRACE, h: 1460, flag: 'pennant', limp: 0.15 },
  { id: 'F2', x: 7120, z: 840, y0: GROUND, h: 1200, flag: 'pennant' },
  { id: 'F3', x: -6650, z: 3800, y0: GROUND, h: 1100, flag: 'pennant' },
];
export const FLAG = { len: 300, h: 188 };
export const PENNANT = { len: 520, h: 64, droop: 310 };
export const WIND = { dir: [-0.97, 0.24], amp: 34, k: 0.012, speed: 4.2 };
// The dad's mailbox at the path's street end: one anthracite pedestal box standing on the lawn
// (body 60 x 45, 160 to its eaves: no post of its own, post 0), a gable lid (37 degrees, its gable
// toward the street) up to `ridge`, facing the street; it is a sign of its own.
export const MAILBOX = { x: 840, z: 465, yaw: Math.PI, post: 0, body: [60, 45, 160] };
MAILBOX.eaves = GROUND + MAILBOX.post + MAILBOX.body[2];
MAILBOX.ridge = MAILBOX.eaves + 22;
// The grey electrical cabinet on a white brick pillar by the footpath, and the blue round
// pedestrian sign on its grey post at the footpath's mouth, its west side; the low barrier
// across it.
export const CABINET = footpathAt(60, 520);
export const PATH_SIGN = footpathAt(100, 300);

// ---------------------------------------------------------------- cars, the hoop, the trampoline

// Cars parked on the drives (generic shapes, plate-less, no badges), each a kind (CAR_KINDS: l
// long, w wide, its body up to `belt`, its cabin up to `roof`, the bonnet `hood` long, the
// windscreen `screen` deep, the cabin's back `tail` in from the rear at its foot and `tailTop`
// at the roof, wheels of radius `wheel`) at (x, z), its nose toward yaw (0: +z), in its colour.
// Solid (the body and the cabin): a hop onto a bonnet, a grab of a roof's edge. The dad's two
// stand side by side deep on his drive up to the garage row's doors (W4, as photos 33-37 have
// them: the drive's front half empty), the electric one nose out, the SUV nose in, the red door
// and its strip between them, a strip one Jonas wide behind them along the doors (CAR_GAP); the
// west neighbour's at the link; on the villas'
// drives (north_4's the van: its coins on its forecourt's west part; north_5's none) and at the
// double garage, noses in.
export const CAR_KINDS = {
  suv: { l: 660, w: 270, belt: 140, roof: 250, hood: 175, screen: 95, tail: 25, tailTop: 55, wheel: 58 },
  cross: { l: 630, w: 265, belt: 130, roof: 235, hood: 165, screen: 110, tail: 35, tailTop: 95, wheel: 55 },
  hatch: { l: 590, w: 255, belt: 115, roof: 215, hood: 155, screen: 120, tail: 30, tailTop: 85, wheel: 50 },
  estate: { l: 690, w: 260, belt: 115, roof: 210, hood: 180, screen: 115, tail: 20, tailTop: 45, wheel: 50 },
  van: { l: 700, w: 285, belt: 135, roof: 290, hood: 70, screen: 90, tail: 10, tailTop: 20, wheel: 55 },
};
const parked = (kind, x, noseZ, yaw, tint) => ({ kind, x, z: noseZ - Math.cos(yaw) * (CAR_KINDS[kind].l / 2), yaw, tint });
export const CAR_GAP = 2 * 50 + 10; // (the dad's cars off the garage doors: Jonas's width and a little)
// A villa's garage door's middle (x) and its east block's front (z).
const garageAt = (id) => {
  const v = VILLAS.find((h) => h.id === id);
  return { x: v.cx + v.garage, front: v.front };
};
export const CARS = [
  // The dad's compact electric crossover (photos: nearest his gable): a lookalike of his own car,
  // no badge, no plate; the 'cross' kind's body (its collider unchanged), drawn in its own style
  // (lane/props.js, world/lane/real/cars.js STYLE.ev), and drawn last (hideable: part.hide). Its
  // tint a soft, greyish steel blue in the realistic look; the classic look's warm bake greys a
  // blue, so there it is a touch bluer (`classicTint`).
  // (W4: its tail and the SUV's nose CAR_GAP short of the doors: a clean strip one Jonas wide
  // behind them, so every door is reached and walked through; the photos' 0.3 .. 0.6 m left
  // squeeze gaps by the bumpers' slopes. The gap between them on the red door and its strip.)
  { ...parked('cross', 1975, GARAGE.wall - CAR_GAP - CAR_KINDS.cross.l, Math.PI, 0x627d93), id: 'dad_ev', style: 'ev', classicTint: 0x5884a6 },
  parked('suv', 2445, GARAGE.wall - CAR_GAP, 0, 0x3a4c66),
  parked('cross', (LINK.x0 + LINK.x1) / 2, LINK.z0 - 30, 0, 0xeeeee8),
  parked('hatch', garageAt('north_1').x, garageAt('north_1').front + 40, Math.PI, 0xb6babe),
  parked('cross', garageAt('north_2').x, garageAt('north_2').front + 40, Math.PI, 0x45484c),
  parked('hatch', garageAt('north_3').x, garageAt('north_3').front + 40, Math.PI, 0x1f2124),
  // north_4's van, nose in beside its garage door (the hoop's perch from its roof: HOOP).
  parked('van', garageAt('north_4').x - 130, garageAt('north_4').front + 40, Math.PI, 0x24272b),
  { kind: 'estate', x: FORECOURT.x1 - 5 - CAR_KINDS.estate.l / 2, z: EAST_GARAGE.cz + 260, yaw: Math.PI / 2, tint: 0x8e9296 },
];

// STOMPWATT, the lane's boss (objects/laneBoss/LaneBoss.js, in the lane's lazy chunk): the dad's
// car (`car`: its id in CARS) stands up into a robot made of its own panels when Jonas comes near
// it on the ground (`wake`: within r of its middle on the drive's level (his feet within `level`
// of its ground) for `dwell` ticks, or touching it), never while he is up on the bins, the carport
// or a roof; from `notice` its T lights blink at him. The fight (objects/laneBoss/fight.js): its
// `arena` (Jonas within r + 200 of its middle is in the fight), the ground it may walk on (`walk`:
// its middle stays in these boxes, [x0, x1, z0, z1]: the street; its own slot between the bins'
// strip by the gable and the SUV, short of the garage row (the second: the narrow part's foot is
// the drive's "mouth" it walks in by); the drive's empty front half (W4: the cars parked deep)
// short of the bins at home, and the apron's west end by it; never behind the cars, at the garage
// doors, in a garden or over the dad's corner bed and its sign), where it kneels to charge
// (`charge`: at the wall charger,
// DAD.charger, facing it, its back to the open drive), where it folds back into the car once
// beaten (`prepark`, then reversing into its slot) and where its reward star hovers (`star`, in
// front of the car: a small jump reaches it).
const EV = CARS[0];
const EV_NOSE = EV.z - CAR_KINDS[EV.kind].l / 2;
export const LANE_BOSS = {
  car: 'dad_ev',
  wake: { r: 520, dwell: 20, level: 60 },
  notice: 900,
  arena: { x: 2050, z: 850, r: 1350 },
  walk: [[800, 3300, -480, 255], [1860, 2170, 1330, 2000], [1690, 2640, 255, 1330], [2640, 3300, 255, 980]],
  charge: { x: 1860, z: 1800, yaw: -0.675 }, // (W4: in its own slot, its feet clear of the bins at home, its back to the drive's open front)
  prepark: { x: EV.x, z: EV.z - 300 },
  star: { x: EV.x, y: GROUND + 320, z: EV_NOSE - 130 },
  easy: false, // (the easier fight for the youngest: objects/laneBoss/tuning.js FIGHT.EASY)
};

// The basketball hoop on north_4's front wall west of its garage door (W2: the photos' hoop
// house), a children's one: a black post `out` in front of the wall, a white board (w by h, its
// foot at `board` up, at the top of the rendered floor) on an arm to the wall, an orange ring of
// `ring` radius at `rim` up; the board and its arm are one solid block from the wall (a perch: a
// double jump from the forecourt grabs its edge, a hop from the van's roof lands on it).
export const HOOP = { x: garageAt('north_4').x - 340, z: garageAt('north_4').front, out: 70, board: GROUND + 390, w: 130, h: 110, rim: GROUND + 400, ring: 32 };

// The trampoline in north_5's front garden (objects/Trampoline.js bounces Jonas off its mat:
// within r of its middle, his feet coming down at y, its top), drawn by props.js: a dark mat in a
// padded blue ring on six legs, solid from the terrace up to its top. The secret 1-up floats
// high over it: only a bounce with the jump button held (BOUNCE_HELD_VY) rises to it.
export const TRAMPOLINE = { x: 5380, y: TERRACE + 90, z: -2300, r: 250, vy: 50, legs: 6 };
export const TRAMPOLINES = [TRAMPOLINE];
export const ONE_UP = { x: TRAMPOLINE.x, y: 1020, z: TRAMPOLINE.z };

// ---------------------------------------------------------------- gardens, the forest's edge

// A tree or two in the gardens (drawn by props.js, their trunks solid): an apple tree on
// north_4's terrace, a birch behind the corner house, a red-leaved shrub by the double garage.
export const GARDEN_TREES = [
  { kind: 'apple', x: 2185, z: -2011, r: 480, h: 850 },
  { kind: 'birch', x: -5550, z: 3300, r: 380, h: 1500 },
  { kind: 'shrub', x: 6750, z: 120, r: 160, h: 260 },
];
// Flower beds on the terraces (cosmos: tufts of leaves with pink and white flowers): north_3's
// behind its box hedge, north_4's along its wall.
export const FLOWER_BEDS = [
  { x0: -1200, x1: -500, z0: -1400, z1: -1100, n: 14, seed: 41 },
  { x0: 1700, x1: 2400, z0: -960, z1: -840, n: 7, seed: 43 },
];
// TV antennas on the chain houses' ridges (x along each ridge; drawn only); the dad's clamped to
// his east gable's apex (`gable`: its mast on a bracket under the apex, out from the wall).
export const ANTENNAS = [
  { house: 'south_1', x: -2900 },
  { house: 'south_dad', x: DAD.x1 + 14, gable: true },
  { house: 'south_2', x: 3800 },
];
// Two houses down the side road in the fog (drawn only, out of bounds): `t` along it, `s`
// across it (s > 0 its west side; the first's near end clear of the west leg drawn on past the
// junction, which crosses the side road's west side at t ~0).
export const SIDE_BLOCKS = [
  { t: 1500, s: 1430, w: 1600, d: 1100, tint: 0xece6d8 },
  { t: 3350, s: 1500, w: 1500, d: 1100, tint: 0xd8b65e },
];

// Butterflies over the dad's lawn and north_3's flower beds (ObjectManager), and small brown
// birds (BIRD_TINT) circling over the forest.
export const BUTTERFLY_SPOTS = [
  { x: 500, z: 900 },
  { x: -850, z: -1250 },
];
export const BIRD_CIRCLES = [
  { x: -3200, z: -6600, y: 2600, radius: 1300 },
  { x: 3800, z: -7100, y: 2900, radius: 1100 },
];
export const BIRD_TINT = 0x5a5048;

// ---------------------------------------------------------------- the boundary

// The play space: invisible walls (y -200 .. BOUNDS_TOP, facing in) along this polygon (clockwise
// seen from above, from the north-west), each a little inside a drawn edge (the forest bank, the
// hedges, the barrier, the trees round the outside) the camera cannot see over: north of the
// gardens just onto the ramp up to the forest's edge; round the east house; across the
// footpath at its barrier; along the back hedges; round the corner house's garden, across the
// side road's mouth and the west leg past the junction.
export const BOUNDS_TOP = 4500;
const barrier = (s) => {
  const p = footpathAt(FOOTPATH.barrier, s);
  return [Math.round(p.x), Math.round(p.z)];
};
const northBound = (x) => [x, Math.round(flatZAt(x) - 60)];
export const BOUNDS = [
  [-11900, -3300],
  [-10300, -4300],
  northBound(-8150),
  northBound(7950),
  [9850, -1400],
  [9850, 1650],
  barrier(-FOOTPATH.half - 60),
  barrier(FOOTPATH.half + 60),
  [5700, 2400],
  [5850, 4200],
  [-5400, 4200],
  [-6100, 4450],
  [-8500, 4450],
  [-9002, 4126],
  [-9984, 2739],
  [-10700, 3300],
  [-11900, 3950],
];

// Whether (x, z) lies inside a polygon (even-odd: any shape); inBounds: inside the boundary.
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export const inBounds = (x, z) => inPolygon(BOUNDS, x, z);

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
// turning area's apron at 0, the north terraces (over their back gardens' ramp), the drive
// notches and everything else at GROUND, and outside the boundary to the north the forest bank
// (drawn).
export function groundHeight(x, z) {
  if (roadDistance(x, z) <= ROAD.half || inApron(x, z)) return 0;
  return offRoadHeight(x, z);
}
// The ground off the road and the apron (groundHeight's, for a caller that knows the point is
// off them: the realistic look's lawn mask).
export function offRoadHeight(x, z) {
  const plot = PLOTS_N.find((p) => x >= p.x0 && x <= p.x1);
  if (plot && z < wallZAt(x)) {
    const inDrive = x >= plot.drive[0] && x <= plot.drive[1] && z > villaOf(plot).front;
    if (inDrive) return GROUND;
    const flat = flatZAt(x);
    if (z >= flat) return NORTH.top;
    if (z >= flat - NORTH.ramp) return NORTH.top + ((flat - z) / NORTH.ramp) * (NORTH.backTop - NORTH.top);
    return bankHeight(x, z, NORTH.backTop);
  }
  if (z < backZAt(x) && x > PLOTS_N[0].x0) return bankHeight(x, z, NORTH.backTop);
  return GROUND;
}
// The forest bank behind the back gardens, rising from `foot` at backZAt(x) to bankTop over
// NORTH.bank.
export function bankHeight(x, z, foot) {
  const k = Math.max(0, Math.min(1, (backZAt(x) - z) / NORTH.bank));
  return foot + (NORTH.bankTop - foot) * k * (2 - k);
}
export const villaOf = (plot) => VILLAS.find((v) => v.id === plot.id);

// Golden hour, as in the photographs (an early October afternoon, a little after four): the sun
// low in the west-south-west (45 deg from +z toward -x, ~12 deg up: the photos' 5 deg lifted for
// play), so the villas' street faces and the treetops glow while the chain houses' fronts (the
// dad's too) and most of the street stand in soft shade.
export const LANE_SUN = (() => {
  const v = { x: -0.67, y: 0.21, z: 0.71 };
  const l = Math.hypot(v.x, v.y, v.z);
  return Object.freeze({ x: v.x / l, y: v.y / l, z: v.z / l });
})();

const DEG = Math.PI / 180;

// The realistic look (world/lane/real/look.js, render/real/RealLook.js): the same golden hour,
// physically lit. Tuned by eye against the photographs (never sampled from them).
//   sky          the analytic sky's colours (linear: W1, the photos' hazy golden hour: a pale
//                blue zenith paling to a near white horizon away from the sun, a peach glow
//                rising from the horizon only on its side, the dim ground the environment's
//                lower half shows), its brightness and thin cirrus, and
//                envTint: its light's colour beside its own (the environment only: a camera's
//                white balance, so the shade, the road and the white plinths read near neutral
//                as in the photos, not blue; G3)
//   exposure     before the output pass's Neutral tone mapping (1.3: the shade reads like the
//                phone photos without blowing out the sunlit villas)
//   environment  the sky's light on every realistic material (1.3: at 1 the shaded lawn is too
//                dark); haze: the aerial perspective's density per unit (exponential, toward the
//                sky's colour in each direction), the sky's glow on the sun's side coming into it
//                over hazeGlow (W4 fix: near the camera the sky's colour away from the sun; mixed
//                in linear light on high and mid the glow had veiled the dark bins brown in photos
//                36 and 37's views toward the sun, low's display-space mix hardly at all)
//   shadow       the sun's soft shadow (three's PCF with this radius; biases for the flat walls
//                at a grazing sun, both in world units: RealLook turns the depth bias into its
//                share of the near shadow camera's depth, -4e-4 over the old 16000)
//   probe        the reflection probe's place: over the road in front of the dad's house
//   tiles        the houses whose roofs are real tile courses (world/lane/real/house.js: the dad's
//                and his neighbours', close to play, the neighbours' rolls a little plainer; the
//                rest the tile set's normal map); tilesMid: on the mid tier only these (W2: the
//                plan's longer neighbours would cost mid ~50k triangles)
//   atmosphere   the actors' look meanwhile (view.setAtmosphere): the golden sun (1, 0.48,
//                0.19) x 2.9 along LANE_SUN (W1; no brighter: Jonas's red shirt, his back to the
//                low sun, would burn out pink), a neutral sky and ground hemisphere, the classic
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
  sky: Object.freeze({ zenith: [0.27, 0.37, 0.53], horizonAway: [0.68, 0.72, 0.76], horizonSun: [1.3, 0.86, 0.5], ground: [0.08, 0.08, 0.06], intensity: 1, clouds: 0.25, envTint: Object.freeze([1.04, 1, 0.88]) }),
  sunDir: LANE_SUN,
  exposure: 1.3,
  environment: 1.3,
  haze: 2.5e-5,
  hazeGlow: 6000,
  shadow: Object.freeze({ radius: 2.5, bias: -6.4, normalBias: 3 }),
  probe: Object.freeze({ x: 0, y: 260, z: 250 }),
  tiles: Object.freeze(['south_1', 'south_dad', 'south_2']),
  tilesMid: Object.freeze(['south_dad']),
  atmosphere: Object.freeze({ fog: 0xd0d8e0, near: 3000, far: 45000, sun: 0xffb878, sunIntensity: 2.9, sunDir: LANE_SUN, sky: 0xe2e2e0, ground: 0x5a5850, ambientIntensity: 0.9 }),
  post: Object.freeze({
    ao: Object.freeze({ radius: 110, intensity: 2.6, bias: 0.12, maxPx: 90, fade: Object.freeze([4500, 9000]) }),
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
    saturation: 1.1,
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
// from up to 270 under it: he takes it standing on the ridge), west of the door far enough to
// be clear of the red-leaf tree's crown and near enough to be in the arrival's picture (W3).
export const STAR = { id: 'lane_star', x: 300, y: DAD.ridge + 180, z: DAD.ridgeZ, placed: true };

// ---------------------------------------------------------------- coins, signs, poles

// 55 coins, each at its floor + 60: down the path to the door, on the mailbox's roof, along the
// street both ways, round the turning area's apron, along two wall tops (north_2's west of its
// drive, north_3's in front of its west block) and up north_3's steps, across north_4's forecourt
// west of the van, up the side yard between north_2 and north_3, on the motorhome's roof, along
// south_1's hedge, round the junction's lamppost, on the footpath, over the bins, on the
// carport's roof, up the east wing's slope and the main roof's back slope (W3: the way up from the
// carport), and a row of five across the store room behind the garage doors (GARAGE).
const above = (y) => y + 60;
const roofAt = (z) => DAD.ridge - Math.abs(z - DAD.ridgeZ) * DAD_TAN;
const wingAt = (w, x) => w.ridge - (Math.abs(x - w.cx) * (w.ridge - w.eave)) / (w.d / 2);
const motorhome = (along) => ({ x: MOTORHOME.cx + Math.cos(MOTORHOME.yaw) * along, y: above(GROUND + MOTORHOME.h), z: MOTORHOME.cz - Math.sin(MOTORHOME.yaw) * along });
const STREET_Z = ROAD.line.at(-1)[1];
const wallTop = (x) => ({ x, y: above(TERRACE), z: wallZAt(x) - 50 });
const upSteps = (plot, d) => {
  const z = wallZAt(plot.steps[0]) - d;
  return { x: (plot.steps[0] + plot.steps[1]) / 2, y: above(stepsY(plot, z)), z };
};
export const COINS = [
  ...[1080, 880, 680].map((z) => ({ x: DAD.door.x, y: above(GROUND), z })),
  { x: MAILBOX.x, y: above(MAILBOX.ridge), z: MAILBOX.z },
  ...[-900, -1500, -2100, -2700, -3300].map((x) => ({ x, y: above(0), z: STREET_Z })),
  ...[700, 1300, 1900].map((x) => ({ x, y: above(0), z: STREET_Z })),
  ...Array.from({ length: 7 }, (_, k) => {
    const a = (k / 7) * Math.PI * 2;
    const R = APRON.ring;
    return { x: R.x + R.r * Math.sin(a), y: above(0), z: R.z + R.r * Math.cos(a) };
  }),
  ...[-4600, -4350, -4100].map(wallTop),
  ...[-1200, -950, -700].map(wallTop),
  ...[60, 180, 300].map((d) => upSteps(PLOTS_N[2], d)),
  ...[-1300, -1450, -1600].map((z) => ({ x: PLOTS_N[3].drive[0] + 220, y: above(GROUND), z })),
  ...[-1900, -2300, -2700].map((z) => ({ x: PLOTS_N[1].x1, y: above(TERRACE), z })),
  ...[-300, 0, 300].map(motorhome),
  ...[0.2, 0.45, 0.7].map((k) => ({ x: Math.round(HEDGES[0].x0 + (HEDGES[0].x1 - HEDGES[0].x0) * k), y: above(HEDGES[0].top), z: (HEDGES[0].z0 + HEDGES[0].z1) / 2 })),
  ...[[-250, 0], [125, -217], [125, 217]].map(([dx, dz]) => ({ x: LAMPS[0].x + dx, y: above(GROUND), z: LAMPS[0].z + dz })),
  { ...footpathAt(500), y: above(GROUND) },
  { x: BINS[0].x, y: above(BIN.top), z: BINS[0].z },
  ...[140, 340, 540].map((d) => ({ x: 1750, y: above(CARPORT.top), z: CARPORT.z0 + d })),
  { x: 1420, y: above(wingAt(DAD_WINGS[1], 1420)), z: 2450 },
  { x: DAD_WINGS[1].cx, y: above(roofAt(1850)), z: 1850 },
  ...[1800, 1950, 2085, 2250, 2380].map((x) => ({ x, y: above(GROUND), z: GARAGE.wall + 300 })),
];

// Signs: the dad's mailbox (post: false, the mailbox is the sign: no signpost drawn, its own
// collider within the sign's box), read from the street; the corner sign at the junction facing
// up the lane; the footpath's beside the blue sign, facing the turning area; the trampoline's on
// the pavement's end short of north_5's steps.
export const SIGNS = [
  {
    id: 'sparrow_mailbox',
    x: MAILBOX.x,
    y: GROUND,
    z: MAILBOX.z,
    yaw: MAILBOX.yaw,
    post: false,
    pages: ['SPARROW LANE', 'Welcome home, Jonas! A little blue sparrow keeps watch over the mailbox.', 'Something is twinkling up on the roof... Try pushing a bin back to the garages!'],
  },
  {
    id: 'lane_corner',
    x: LAMPS[0].x + 416,
    y: GROUND,
    z: LAMPS[0].z - 442,
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
    x: 4450,
    y: GROUND,
    z: -680,
    yaw: -0.96,
    pages: ['Up the steps: a trampoline!', 'Jump onto it and keep the jump button held to bounce sky high.'],
  },
];

// Climbable poles (CollisionWorld.addPole), each with the side the camera swings round to
// (camYaw) while he holds it: the junction's lamppost (looking along the west leg), the three
// flagpoles and the red-leaf tree (the roof ahead); then (the dad: "I want to climb ALL the
// lampposts") the other four lampposts, each side across its arm (he climbs past its root on his
// own side of the post), the camera along the street (the bend's looking west to the junction,
// the straight's two looking east up the lane) or by the double garage (the footpath's). Falls
// from a pole count from its foot.
const lampPole = (id, camYaw) => {
  const l = LAMPS.find((p) => p.id === id);
  return { x: l.x, z: l.z, y0: GROUND, y1: LAMP.top, radius: 20, camYaw };
};
const flagPole = (id, camYaw) => {
  const f = FLAGPOLES.find((p) => p.id === id);
  return { x: f.x, z: f.z, y0: f.y0, y1: f.y0 + (f.h ?? FLAGPOLE.h), radius: 20, camYaw };
};
export const POLES = [
  lampPole('L1', -1.17),
  flagPole('F1', -2.39),
  flagPole('F2', 1.5),
  flagPole('F3', Math.PI / 2),
  { x: RED_TREE.x, z: RED_TREE.z, y0: RED_TREE.y0, y1: RED_TREE.y1, radius: RED_TREE.radius, camYaw: Math.PI },
  lampPole('L2', Math.PI / 2),
  lampPole('L3', -Math.PI / 2),
  lampPole('L5', -Math.PI / 2),
  lampPole('L7', 2.51),
];
