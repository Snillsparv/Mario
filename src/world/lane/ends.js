// Sparrow Lane's two ends past the plan's houses (W8: photos 01-08, 25, 29-31): the garden things,
// small plants and hedges along a line at the west end and by the double garage, and what stands
// out past the junction and beyond the footpath, drawn only. Builders' data only, so it lives in
// the lane's chunk and the realistic look's worker (lane/props.js, lane/build.js, lane/real/*),
// not in main with lane/layout.js; nothing here is read by the game's logic.

import { CABINET, GROUND } from './layout.js';

const WEST_YAW = Math.atan2(0.574, 0.819); // (layout.js's: the west leg's frame)
const FALU = 0x7a2422;
const ridgeOf = (eave, d, deg) => Math.round(eave + (d / 2) * Math.tan((deg * Math.PI) / 180));

// Garden things (both looks, lane/props.js gardenThings): north_west's white picnic table by its
// porch and its small white board shed far west on its lawn (photos 04, 05, 07), its black box
// mailbox on a post at its drive's corner (blank), the corner house's (south_west's) patio table,
// chairs and closed parasol by its west side (photo 05), the children's white football goal on
// the lawn west of the big birch (photos 08, 11); `yaw` the way each faces. The picnic table, the
// table, the shed and the mailbox solid; the rest drawn only.
export const GARDEN_THINGS = [
  { kind: 'picnic', x: -10420, z: -662, yaw: WEST_YAW }, // (W8 fix: 40 clear of the porch's post, 35 off the wall)
  { kind: 'shed', x: -11400, z: -2100, yaw: WEST_YAW + Math.PI / 2, w: 620, d: 420, h: 330 },
  { kind: 'postbox', x: -9620, z: 922, yaw: Math.PI + WEST_YAW },
  { kind: 'table', x: -8938, z: 3529, yaw: WEST_YAW },
  { kind: 'chair', x: -8952, z: 3404, yaw: WEST_YAW + 0.4 },
  { kind: 'chair', x: -8927, z: 3667, yaw: WEST_YAW + Math.PI - 0.3 },
  { kind: 'parasol', x: -8938, z: 3529 },
  { kind: 'goal', x: -6250, z: 1600, yaw: 2.36 },
];
// Small plants drawn only (both looks): the patio's red maple and tall grasses, an orange-yellow
// autumn shrub at south_1's west gable (photo 11), box balls and a small conifer behind the
// double garage's forecourt wall (photos 29, 30).
export const SMALL_PLANTS = [
  { kind: 'maple', x: -8685, z: 3681, r: 95, h: 200 },
  { kind: 'grass', x: -8976, z: 3214, r: 60, h: 190 },
  { kind: 'grass', x: -9135, z: 3423, r: 55, h: 170 },
  { kind: 'gold', x: -4200, z: 1180, r: 150, h: 250 },
  { kind: 'box', x: 5760, z: 440, r: 60, h: 95 },
  { kind: 'box', x: 6090, z: 360, r: 55, h: 85 },
  { kind: 'conifer', x: 6300, z: 330, r: 45, h: 190 },
];
// Hedges along a line, each from [x, z] to [x, z], `depth` thick, from GROUND to `top` (solid
// oriented boxes, their tops walkable), `kind` its leaves: north_west's low clipped yellow-green
// one at the pavement's back west of its drive (photos 02-05), the tall dark thuja hedge behind
// the bend's fence east of the corner house and a deciduous one on from it (photos 06, 09), the
// east house's dense dark one from the forecourt wall's pillar along the footway (photos 29, 30).
// (`side`: the face its leaves are drawn on in the realistic look, 1 its left seen from `from`, -1
// its right, 0 both; the other a dark core.)
export const LINE_HEDGES = [
  { from: [-10760, 1675], to: [-9669, 957], depth: 100, top: GROUND + 130, kind: 'clipped', side: 0 },
  { from: [-7350, 997], to: [-6932, 730], depth: 120, top: GROUND + 300, kind: 'thuja', side: 1 },
  { from: [-6932, 730], to: [-6640, 580], depth: 120, top: GROUND + 300, kind: 'thuja', side: 1 },
  { from: [-6640, 580], to: [-6406, 521], depth: 110, top: GROUND + 210, kind: 'beech', side: 1 },
  { from: [-6406, 521], to: [-6230, 513], depth: 110, top: GROUND + 210, kind: 'beech', side: 1 },
  { from: [5490, 300], to: [5908, 864], depth: 120, top: GROUND + 170, kind: 'dark', side: -1 }, // (W8 fix: along the footpath, its near face ~255 off its line: clear of its asphalt)
];
// The double garage's forecourt wall (photos 29-31: lane/props.js footpathProps, real/extras.js
// cabinet): from the garage's corner [x, z] to its square pillar at the footway (CABINET's spot),
// `thick`, its top and the pillar's (`pillar` square) over the ground; the setts run to it. (Its end
// by the pillar from layout.js CABINET, the pillar's middle.)
export const FORECOURT_WALL = { from: [6566, -104], to: [CABINET.x + 23, CABINET.z - 5], thick: 48, top: GROUND + 110, pillar: 72, pillarTop: GROUND + 118 };
// Out past the junction (photos 01-03; drawn only, out of bounds, fogged): the veranda house on
// the corner west of the side road (VERANDA_HOUSE: one storey, its north gable to the street in
// white brick under dark red-brown boards, a window in a panel of them (`gables`), a black tile
// roof, a glazed veranda round its north-west corner under that roof on a white board parapet
// (`veranda`: along the gable and along its west side from the corner; W8 fix: its gable 10 m,
// not 15, its far corner kept: photo 03 has it narrower), a tall dark chimney, a TV mast with
// two yagis on its apex, its long red-board west side along the curve); the lay-by on the
// curve's outside (LAYBY: its corners, two cars parked in it nose out to the road, drawn only:
// the realistic look's by real/cars.js), lamppost B on
// the verge by it carrying the blank street name plate (FAR_LAMPS: not a pole), the gravel
// footpath north from the side road's mouth to the forest (GRAVEL_PATH: from, dir, len, half);
// far houses beyond the footpath at the east end (BACKDROP: a grey-blue board house, a long
// two-storey terraced row, photos 25, 30, 31).
export const VERANDA_HOUSE = { kit: 'chain', cx: -10712, cz: 4702, w: 1800, d: 1500, yaw: 2.173, y0: GROUND, eave: 400, ridge: ridgeOf(400, 1500, 20), boards: FALU, gableBoards: 0x4a2a22, gableEnds: true, roof: 0x2a2a2c, frame: 0xf2f0ea, backWindows: [250, 600], windows: [-300, 300], veranda: { gable: 380, side: 800, sill: 140 }, gables: { right: { panels: [{ u0: -100, u1: 180, v0: -4, v1: 400 - GROUND, tint: 0x4a2a22 }], windows: [{ u: 40, w: 120, h: 170, sill: 120, bars: 0 }] } }, chimney: { u: 450, w: -200, top: 1050 } };
// (W8 fix: the pocket 720 along the road and 760 deep, so the cars stand wholly in it, nose out
// 50 short of the road's edge, 340 apart with a gap between them; every tier draws them.)
export const LAYBY = { pts: [[-13045, 3573], [-13501, 4130], [-14090, 3649], [-13634, 3092]], cars: [{ kind: 'estate', x: -13680, z: 3726, yaw: 0.885, tint: 0xa9adb1 }, { kind: 'suv', x: -13454, z: 3472, yaw: 0.885, tint: 0x2a4ab8 }] };
export const FAR_LAMPS = [{ id: 'LB', x: -13700, z: 4180, yaw: 0.885, plate: 500 }];
export const GRAVEL_PATH = { x: -11011, z: 1910, dir: [-0.578, -0.816], len: 3200, half: 60 };
// (P4, photos 30, 31: beyond the footpath a low two-storey terraced row, not a slab: four units
// along its line, each a little in or out, eaves ~520 under low dark roofs, the north-east end's
// grey vertical boards, the others light cream; two rows of windows on their fronts, none behind.)
const ROW_U = [-1275, -425, 425, 1275];
const ROW_OUT = [0, 70, -30, 50];
const ROW_TINT = [0xa8aeb2, 0xe2d8c2, 0xd8d0bc, 0xe6dece];
const rowUnit = (k) => {
  const [c, s] = [Math.cos(-2.287), Math.sin(-2.287)];
  const [u, o] = [ROW_U[k], ROW_OUT[k]];
  const win = k ? [-260, 40, 290] : [-200];
  return { kit: 'chain', cx: Math.round(12400 + c * u + s * o), cz: Math.round(6300 - s * u + c * o), w: 850, d: 900, yaw: -2.287, y0: GROUND, eave: 520 + (k % 2) * 15, ridge: 650 + (k % 2) * 15, boards: ROW_TINT[k], roof: 0x3a3c40, frame: 0xf2f0ea, plinth: 60, windows: [...win, ...win], backWindows: [], panes: win.map((_, i) => ({ i: i + win.length, sill: 300 })) };
};
export const BACKDROP = [
  { kit: 'chain', cx: 6900, cz: 3750, w: 1250, d: 900, yaw: -0.9, y0: GROUND, eave: 380, ridge: 540, boards: 0x8a96a0, roof: 0x6a6c70, frame: 0xf2f0ea, windows: [-300, 300] },
  ...[0, 1, 2, 3].map(rowUnit),
];
