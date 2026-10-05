// Sparrow Lane's props (lane/layout.js LAMPS, FLAGPOLES, BINS, HEDGES, THUJAS, TREES,
// GARDEN_TREES, RED_TREE, RHODODENDRON, ROUND_BED, POT, MAILBOX, CARS, HOOP, TRAMPOLINE,
// MOTORHOME, FENCES, CABINET, PATH_SIGN, FLOWER_BEDS, ANTENNAS, FOREST, EDGE_FOREST,
// SIDE_BLOCKS, SIGNS), written into the course's kit (lane/build.js): render faces into its
// material builders (the painted things, from the poles and the bins to the mailbox, the cars and
// the trampoline, into kit.paint: render's own builder in the classic look), colliders into
// kit.solids, the signposts into kit.signs.
//
//   buildProps(kit, layout), propsSteps(kit, layout) (a few builders a step: lane/build.js laneSteps)
//   waveFlags(geometry, layout) -> update(time)   // lane-cloth's flags waving in the breeze
//
// Grey lampposts with a bent arm and a flat lamp head; white flagpoles with a gold knob, flying
// north_2's blue and yellow cross flag and two long pennants (kit.cloth); the two wheelie bins
// against the dad's east gable by his car charger; hedges (leafy boxes, a soft crown along their
// tops) and thuja columns; the big broad-leaved trees at the junction, an apple tree on north_4's
// terrace, a birch behind the corner house, a red-leaved shrub by the double garage; the dad's
// garden: the round bed (a ring of stones, red leaves fallen in it) with the small red-leaved
// tree (several stems, a round crown of several reds about as high as the eaves), the
// rhododendron, a potted plant by the door; the dad's mailbox (a black house-shaped box on a
// post, a brass slot, a door, a blank name plate, the little blue sparrow standing on its ridge;
// it is the welcome sign); the cars on the drives (generic, plate-less: a body, a glass cabin
// under a roof, four wheels, lights); north_5's basketball hoop and the trampoline in its front
// garden; the motorhome (its cab's windscreen and lights, a door, a stripe, the ladder up its
// back); flower beds on the terraces; TV antennas on the chain houses' ridges; the corner
// house's picket and rail fences; by the footpath its grey cabinet, the blue round sign (a white
// walking figure) on its post and the low barrier across the path; the forest's firs and birches
// on the bank behind the north gardens and a ring of firs round the outside of the boundary
// (skerries/props.js fir(), drawn only); two plain chain houses down the side road in the fog
// (houses.js); the signposts (props/decor.js addSignpost; a sign with post: false has none).
//
// The realistic look draws most of these itself (lane/build.js REAL_DRAWN: the plants, the forest,
// the posts, the bins, the fences, the mailbox, the cars, the toys, the motorhome, the cabinet):
// those builders draw into kit.drawn(name), a kit drawing nothing there, and still make every
// collider; the forest's spots are world/lane/real/spots.js's, the same for both looks.
//
// Colliders: the lampposts' prisms (the climbable two have their pole only, as the flagpoles and
// the red-leaf tree: layout.POLES), the bins, the hedges (boxes, their tops walkable), the thujas
// (steep frustums), the trees' trunks and the shrub, the rhododendron, the round bed, the mailbox
// (a box to its eaves, within the sign's box), each car (its body and its cabin), the hoop's post
// and its board (a block from the wall: a perch), the trampoline (a prism up to its mat), the
// motorhome, the fences and the barrier (slabs), the cabinet and the sign's post, the signposts,
// the side road's houses (houses.js, out of reach).

import { beamPolys, centroid, hexaPolys, localBoxPolys, orientedBoxPolys, prismPolys, wallFrame } from '../castle/geom.js';
import { addSignpost } from '../props/decor.js';
import { makeRng } from '../../core/math.js';
import { fir } from '../skerries/props.js';
import { frame, house } from './houses.js';
import { forestSpots } from './real/spots.js';

const TINT = {
  lamp: 0x8c9092,
  lampHead: 0x4a4e50,
  flag: 0xf2f2f0,
  gold: 0xe8b84a,
  blue: 0x1e5aa8, // the flags' blue and yellow
  yellow: 0xf6c81c,
  bin: 0x2c302c,
  hedge: 0x45682c,
  thuja: 0x2f4a24,
  rhodo: 0x34522a,
  canopy: 0x5f8a34,
  apple: 0x6a9a3a,
  fruit: 0xc8342a,
  birch: 0xa0a840,
  bark: 0xe8e4da,
  redLeaf: [0xa83a2a, 0x8e2c22, 0x7a2834, 0xb8502e], // the red-leaf tree's tones
  shrub: [0xa83030, 0x8a2a2c],
  litter: 0x6a3430, // red leaves fallen in the round bed
  trunk: 0x6a5444,
  redTrunk: 0x4a3428,
  stones: 0xa8a49c,
  pot: 0x3a6a9a,
  potLeaves: 0x4a7a34,
  charger: 0x3a3e42, // (and the trampoline's legs)
  mailbox: 0x2a2a2c,
  brass: 0xb08a40,
  plate: 0xd8d4c8,
  sparrow: 0x3a6ab8,
  beak: 0xe8a030,
  glass: 0x2a323a,
  tyre: 0x17191b,
  hub: 0x8a8e92,
  taillight: 0xb02a24,
  shadow: 0x3a3a3a,
  hoop: 0xe8642a,
  mat: 0x1c2026,
  pad: 0x2f62b0,
  picket: 0x5a3a2a,
  rail: 0x8a6a4a,
  cabinet: 0x8a8e8a,
  pillar: 0xece8de,
  sign: 0x2a62b8,
  white: 0xf4f4f0,
  stripe: 0x8a7a68,
  soil: 0x5a4636,
  tuft: 0x4e7a34,
  flowers: [0xe86aa8, 0xf0a0c8, 0xf4f0f4, 0xc83a8a],
  antenna: 0x7a7e82,
  sideRoof: 0x34302e,
  chargerLight: 0x4cff78, // the wall charger's round status light
  cable: 0x1a1c1e,
  // The dad's crossover (CARS style 'ev'): its gloss black roof and pillars, the lamps, the T
  // lights, the black plastics, the grille panel's thin frame, the skid strip, the wheels' dark face.
  evRoof: 0x18191b,
  evLamp: 0x202428,
  evDrl: 0xffffff,
  evTail: 0xc0281f,
  evPlastic: 0x1c1e20,
  evFrame: 0x4a5058,
  evSkid: 0x9a9ea2,
  evWheel: 0x2a2c30,
};
const THUJA_LEAN = 0.09; // the thujas' colliders lean in this much per unit up (walls, not floors)
// The cross flag's cells along the wind (fractions of its length) and up it: the cross's arms in
// the second column and the second row.
const FLAG_COLS = [0, 5 / 16, 7 / 16, 0.62, 0.81, 1];
const FLAG_ROWS = [0, 0.4, 0.6, 1];
const PENNANT_SEGS = 6;
const FLAG_REACH = 400; // the waves' amplitude grows to WIND.amp this far down a flag
const WHEEL_SIDES = 8;
const CAR_CLEAR = 28; // a car's body above the ground

export function buildProps(kit, layout) {
  const steps = propsSteps(kit, layout);
  while (!steps.next().done);
}

// buildProps a few builders at a time (a generator: lane/build.js laneSteps).
export function* propsSteps(kit, layout) {
  for (const l of layout.LAMPS) lamppost(kit, layout, l);
  for (const f of layout.FLAGPOLES) flagpole(kit, layout, f);
  layout.BINS.forEach((b, i) => bin(kit, layout, b, i));
  yield;
  for (const h of layout.HEDGES) hedge(kit, h);
  for (const t of layout.THUJAS) thuja(kit, layout, t);
  yield;
  for (const t of layout.TREES) broadTree(kit, layout, t);
  for (const t of layout.GARDEN_TREES) gardenTree(kit, layout, t);
  yield;
  dadsGarden(kit, layout);
  mailbox(kit, layout);
  // (A car with an id, the dad's: its collider here, named; drawn last, below.)
  for (const c of layout.CARS) car(kit, layout, c, c.id ? 'solids' : 'all');
  yield;
  hoop(kit, layout);
  trampoline(kit, layout);
  motorhome(kit, layout);
  for (const b of layout.FLOWER_BEDS) flowerBed(kit, layout, b);
  for (const a of layout.ANTENNAS) antenna(kit, layout, a);
  yield;
  for (const f of layout.FENCES) fence(kit, layout, f);
  footpathProps(kit, layout);
  yield;
  forest(kit, layout);
  yield;
  sideBlocks(kit, layout);
  for (const sign of layout.SIGNS) if (sign.post !== false) addSignpost(kit.signs, layout, sign);
  // The dad's car, drawn last into every builder it shares (paint): its faces are the mesh's
  // tail, so it can be hidden by shortening the mesh's draw range (kit.hideAt: the first vertex
  // of it in each builder, by the kit's name; lane/build.js part.hide).
  for (const c of layout.CARS) {
    if (!c.id) continue;
    const drawn = kit.drawn('cars');
    if (drawn === kit) (kit.hideAt ??= {})[c.id] = { paint: kit.paint.pos.length / 3 };
    car(kit, layout, c, 'draw');
  }
}

// ---------------------------------------------------------------- street furniture

// A lamppost: a grey eight-sided pole on a wider foot, an arm out along its yaw at the top and a
// flat lamp head; a prism collider unless it is a climbable pole (layout.POLES).
function lamppost(kit, layout, { x, z, yaw }) {
  const { paint, solids } = kit.drawn('posts');
  const { LAMP, POLES } = layout;
  const y0 = layout.groundHeight(x, z);
  paint.color(TINT.lamp);
  paint.lathe(x, z, [[LAMP.r + 8, y0 - 10], [LAMP.r + 8, y0 + 60], [LAMP.r, y0 + 80], [LAMP.r - 3, LAMP.top], [0, LAMP.top]], 8, { flat: true });
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const end = [x + ax * LAMP.arm, LAMP.top + 10, z + az * LAMP.arm];
  paint.solid(orientedBoxPolys([x + (ax * LAMP.arm) / 2, 0, z + (az * LAMP.arm) / 2], [ax, 0, az], LAMP.arm + 10, LAMP.top - 12, LAMP.top + 4, 10));
  paint.color(TINT.lampHead);
  paint.solid(orientedBoxPolys([end[0], 0, end[2]], [ax, 0, az], 90, LAMP.top - 24, LAMP.top - 4, 44), { faceShade: (n) => (n[1] < -0.5 ? 1.6 : 1) });
  if (POLES.some((p) => p.x === x && p.z === z)) return;
  solids.solid(prismPolys(x, z, LAMP.collider, 8, y0 - 10, LAMP.top), 'stone');
}

// A white flagpole tapering to a gold knob (a climbable pole: no collider of its own), its flag
// or pennant (kit.cloth, seen from both sides) streaming from just under the knob along WIND.
function flagpole(kit, layout, f) {
  const { cloth } = kit;
  const { paint } = kit.drawn('posts');
  const { FLAGPOLE: F, WIND } = layout;
  const { x, z, y0 } = f;
  const top = y0 + 1200;
  paint.color(TINT.flag);
  paint.lathe(x, z, [[F.r + 26, y0 - 10], [F.r + 26, y0 + 30], [F.r, y0 + 40], [F.r - 4, top], [0, top]], 8, { flat: true });
  paint.color(TINT.gold);
  paint.lathe(x, z, [[0, top], [14, top + 6], [16, top + 18], [12, top + 30], [0, top + 34]], 8);
  const l = Math.hypot(WIND.dir[0], WIND.dir[1]);
  const [dx, dz] = [WIND.dir[0] / l, WIND.dir[1] / l];
  const at = (u, y) => [x + dx * (F.r + u), y, z + dz * (F.r + u)];
  const facing = [-dz, 0, dx];
  const hoist = top - 14;
  // A grid of cells along the wind (u) and up the cloth (v, 0..1), each blue or yellow: the cross
  // flag's arms in its second column and row; a pennant blue over yellow, tapering to a point
  // and drooping a little toward its tip.
  const flag = f.flag === 'flag';
  const { len, h, droop = 0 } = flag ? layout.FLAG : layout.PENNANT;
  const cols = flag ? FLAG_COLS : Array.from({ length: PENNANT_SEGS + 1 }, (_, i) => i / PENNANT_SEGS);
  const rows = flag ? FLAG_ROWS : [0, 0.5, 1];
  const p = (u, v) => at(u * len, flag ? hoist - h + v * h : hoist - h / 2 - droop * u * u + (2 * v - 1) * (h / 2) * (1 - u * 0.94));
  for (let i = 0; i + 1 < cols.length; i++) {
    for (let j = 0; j + 1 < rows.length; j++) {
      const [u0, u1, v0, v1] = [cols[i], cols[i + 1], rows[j], rows[j + 1]];
      cloth.color((flag ? i === 1 || j === 1 : j === 0) ? TINT.yellow : TINT.blue);
      cloth.poly([p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)], { facing, uvs: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] });
    }
  }
}

// The flags waving (lane/build.js calls it with lane-cloth's geometry; the returned update runs
// every frame with the clock, in seconds): each vertex swings across the wind, the more the
// farther it is down its flag from the pole, in a wave running down the flag (each flag a step
// out of phase with the next). No allocation per frame: the rest positions and each vertex's
// reach and phase sit in typed arrays.
export function waveFlags(geo, { FLAGPOLES, FLAGPOLE, WIND }) {
  const attr = geo.attributes.position;
  const pos = attr.array;
  const rest = Float32Array.from(pos);
  const n = attr.count;
  const reach = new Float32Array(n);
  const phase = new Float32Array(n);
  const l = Math.hypot(WIND.dir[0], WIND.dir[1]);
  const [dx, dz] = [WIND.dir[0] / l, WIND.dir[1] / l];
  for (let i = 0; i < n; i++) {
    const [x, z] = [rest[i * 3], rest[i * 3 + 2]];
    const near = FLAGPOLES.map((f) => Math.hypot(x - f.x, z - f.z));
    const k = near.indexOf(Math.min(...near));
    const f = FLAGPOLES[k];
    const u = Math.max(0, (x - f.x) * dx + (z - f.z) * dz - FLAGPOLE.r);
    reach[i] = (WIND.amp * u) / FLAG_REACH;
    phase[i] = WIND.k * u + k * 2.1;
  }
  return (time) => {
    const t = time * WIND.speed;
    for (let i = 0; i < n; i++) {
      const s = reach[i] * (Math.sin(t - phase[i]) + 0.3 * Math.sin(2.3 * t - 1.7 * phase[i]));
      pos[i * 3] = rest[i * 3] - dz * s;
      pos[i * 3 + 2] = rest[i * 3 + 2] + dx * s;
    }
    attr.needsUpdate = true;
  };
}

// A wheelie bin: a dark body, its lid a little wider on top, two wheels at its back (+x); solid
// to its lid's top. The bins move (objects/laneBoss/LaneBins.js), so the first one is drawn once
// in its own frame (origin at its foot's middle, +x the handle side) into the movers' kit
// (kit.mover('bins'): lane/build.js draws it once per bin, instanced, each at home until moved);
// each one's collider is named (bin_0, bin_1: LaneBins moves it in place).
function bin(kit, layout, { x, z }, i) {
  const { BIN, GROUND } = layout;
  const [hx, hz] = [BIN.x / 2, BIN.z / 2];
  if (i === 0) {
    const paint = kit.drawn('bins').mover('bins');
    const h = BIN.top - GROUND;
    paint.color(TINT.bin);
    paint.box(-hx, hx - 6, 0, h - 10, -hz + 4, hz - 4, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
    paint.box(-hx - 4, hx, h - 10, h, -hz, hz, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
    paint.color(0x111111);
    for (const s of [-1, 1]) paint.box(hx - 16, hx + 6, 0, 26, s * (hz - 18) - 8, s * (hz - 18) + 8);
  }
  kit.solids.named(`bin_${i}`).box(x - hx, x + hx, GROUND, BIN.top, z - hz, z + hz, 'stone');
}

// ---------------------------------------------------------------- greenery

// A hedge: a leafy box, darker toward its foot, a soft crown along its top; solid, its top
// walkable (flat).
function hedge(kit, h) {
  const { leaves, solids } = kit.drawn('plants');
  const { x0, x1, z0, z1, y0, top } = h;
  leaves.color(TINT.hedge);
  leaves.shade = (x, y) => 0.75 + 0.25 * Math.min(1, (y - y0) / Math.max(1, top - y0));
  leaves.box(x0, x1, y0 - 4, top, z0, z1, { bottom: false, top: false });
  leaves.shade = null;
  const crown = 16;
  const alongX = x1 - x0 >= z1 - z0;
  const mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  leaves.color(TINT.hedge, 1.08);
  if (alongX) {
    leaves.poly([[x0, top, z0], [x1, top, z0], [x1, top + crown, mid], [x0, top + crown, mid]], { facing: [0, 1, -0.3] });
    leaves.poly([[x0, top + crown, mid], [x1, top + crown, mid], [x1, top, z1], [x0, top, z1]], { facing: [0, 1, 0.3] });
    for (const x of [x0, x1]) leaves.poly([[x, top, z0], [x, top, z1], [x, top + crown, mid]], { facing: [x === x0 ? -1 : 1, 0, 0] });
  } else {
    leaves.poly([[x0, top, z0], [mid, top + crown, z0], [mid, top + crown, z1], [x0, top, z1]], { facing: [-0.3, 1, 0] });
    leaves.poly([[mid, top + crown, z0], [x1, top, z0], [x1, top, z1], [mid, top + crown, z1]], { facing: [0.3, 1, 0] });
    for (const z of [z0, z1]) leaves.poly([[x0, top, z], [x1, top, z], [mid, top + crown, z]], { facing: [0, 0, z === z0 ? -1 : 1] });
  }
  solids.box(x0, x1, y0 - 4, top, z0, z1, 'grass');
}

// A thuja: a dark green eight-sided column tapering to a point; its collider a steep frustum
// (its sides walls, its small top out of reach).
function thuja(kit, layout, { x, z }) {
  const { leaves, solids } = kit.drawn('plants');
  const { r, h } = layout.THUJA;
  const y0 = layout.groundHeight(x, z);
  leaves.color(TINT.thuja);
  leaves.shade = (px, y) => 0.78 + 0.26 * Math.min(1, (y - y0) / h);
  leaves.lathe(x, z, [[r * 0.8, y0 - 6], [r, y0 + h * 0.3], [r * 0.82, y0 + h * 0.7], [r * 0.3, y0 + h * 0.94], [0, y0 + h]], 8, { a0: x * 0.01 });
  leaves.shade = null;
  solids.solid(frustum(x, z, r * 0.85, r * 0.85 - h * 0.85 * THUJA_LEAN, 8, y0 - 6, y0 + h * 0.85), 'grass');
}

// A closed regular frustum round (cx, cz): radius r0 at y0 up to r1 at y1, a flat top.
function frustum(cx, cz, r0, r1, sides, y0, y1) {
  const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
  const lo = ring(r0, y0);
  const hi = ring(r1, y1);
  return [hi, ...lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]])];
}

// One roughly round blob of leaves (a seven-sided lathe): r across, from cy - ry up to cy + ry.
function blob(b, x, z, cy, r, ry, a0) {
  b.lathe(x, z, [[0, cy - ry], [r * 0.72, cy - ry * 0.68], [r, cy - ry * 0.05], [r * 0.8, cy + ry * 0.6], [r * 0.35, cy + ry * 0.95], [0, cy + ry]], 7, { a0 });
}

// A lumpy canopy: `n` overlapping blobs round (x, z) between y0 and y1, out to r, into `leaves`
// (the leaf texture's greens; a red one goes into render's plain white, as the green texture
// would darken it to brown), in `tint` (or turn by turn through a list of tints); darker
// underneath.
function canopy(kit, x, z, y0, y1, r, tint, seed, n = 4, leaves = kit.leaves) {
  const rng = makeRng(seed);
  const h = y1 - y0;
  const tints = [].concat(tint);
  leaves.shade = (px, y) => 0.68 + 0.36 * Math.min(1, Math.max(0, (y - y0) / h));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const off = i === 0 ? 0 : r * (0.35 + rng() * 0.2);
    const br = i === 0 ? r * 0.62 : r * (0.45 + rng() * 0.15);
    const cy = i === 0 ? y0 + h * 0.5 : y0 + h * (0.35 + rng() * 0.3);
    const ry = i === 0 ? h * 0.5 : h * (0.32 + rng() * 0.1);
    leaves.color(tints[i % tints.length], 0.9 + rng() * 0.2);
    blob(leaves, x + Math.sin(a) * off, z + Math.cos(a) * off, cy, br, ry, rng() * 6);
  }
  leaves.shade = null;
}

// A big broad-leaved tree at the junction: a stout trunk (solid) under a lumpy canopy.
function broadTree(kit, layout, t) {
  const drawn = kit.drawn('plants');
  const { wood, solids } = drawn;
  const y0 = layout.groundHeight(t.x, t.z);
  const trunkTop = y0 + t.h * 0.45;
  wood.color(TINT.trunk);
  wood.lathe(t.x, t.z, [[60, y0 - 10], [45, y0 + 120], [38, trunkTop], [0, trunkTop]], 7, { flat: true });
  canopy(drawn, t.x, t.z, y0 + t.h * 0.32, y0 + t.h, t.r, TINT.canopy, Math.round(t.x * 7 + t.z));
  solids.solid(prismPolys(t.x, t.z, 45, 8, y0 - 10, trunkTop), 'wood');
}

// A garden tree (GARDEN_TREES): the apple tree (a short trunk under a broad canopy hung with red
// apples), the birch (white bark ringed dark under a tall yellowing canopy) or the red-leaved
// shrub (two red domes, drawn in render); trunks and the shrub solid.
function gardenTree(kit, layout, t) {
  const drawn = kit.drawn('plants');
  const { wood, render, paint, solids } = drawn;
  const y0 = layout.groundHeight(t.x, t.z);
  if (t.kind === 'birch') {
    birch(drawn, t.x, t.z, y0, t.h, t.r, 7);
    solids.solid(prismPolys(t.x, t.z, 30, 6, y0 - 10, y0 + t.h * 0.6), 'wood');
    return;
  }
  if (t.kind === 'shrub') {
    render.shade = (x, y) => 0.7 + 0.35 * Math.min(1, (y - y0) / t.h);
    for (const [k, dx, dz, s] of [[0, 0, 0, 1], [1, t.r * 0.45, -t.r * 0.3, 0.7]]) {
      render.color(TINT.shrub[k]);
      render.lathe(t.x + dx, t.z + dz, [[t.r * s * 0.8, y0 - 4], [t.r * s, y0 + t.h * s * 0.4], [t.r * s * 0.7, y0 + t.h * s * 0.85], [0, y0 + t.h * s]], 8, { a0: k });
    }
    render.shade = null;
    solids.solid(prismPolys(t.x, t.z, t.r * 0.8, 8, y0 - 4, y0 + t.h * 0.7), 'grass');
    return;
  }
  // The apple tree.
  const top = y0 + t.h;
  const c0 = y0 + t.h * 0.35;
  wood.color(TINT.trunk);
  wood.lathe(t.x, t.z, [[40, y0 - 10], [32, y0 + 100], [26, c0 + 80], [0, c0 + 100]], 7, { flat: true });
  canopy(drawn, t.x, t.z, c0, top, t.r, TINT.apple, 211, 5);
  const rng = makeRng(213);
  paint.color(TINT.fruit);
  for (let i = 0; i < 18; i++) {
    // An apple: a small red diamond on the canopy's skin, facing out.
    const [sx, sz, y] = [Math.sin(i * 2.4), Math.cos(i * 2.4), c0 + (top - c0) * (0.25 + rng() * 0.5)];
    const [x, z] = [t.x + sx * t.r * 0.8, t.z + sz * t.r * 0.8];
    paint.poly([[x - sz * 12, y, z + sx * 12], [x, y - 12, z], [x + sz * 12, y, z - sx * 12], [x, y + 12, z]], { facing: [sx, 0, sz] });
  }
  solids.solid(prismPolys(t.x, t.z, 40, 8, y0 - 10, c0 + 100), 'wood');
}

// A birch (a garden's, or the forest's): white bark with dark rings, slender, under a tall
// yellowing canopy of four blobs.
function birch(kit, x, z, base, h, r, seed) {
  const { wood } = kit;
  const t = r * 0.1;
  wood.color(TINT.bark);
  const ring = (k) => [[t * (1 - k * 0.4), base + h * k, 1], [t * (1 - k * 0.4), base + h * k, 0.45], [t * (1 - k * 0.4), base + h * (k + 0.03), 0.45], [t * (1 - k * 0.4), base + h * (k + 0.03), 1]];
  wood.lathe(x, z, [[t * 1.1, base - 10, 1], ...ring(0.18), ...ring(0.4), ...ring(0.58), [t * 0.5, base + h * 0.85], [0, base + h * 0.86]], 6, { flat: true });
  canopy(kit, x, z, base + h * 0.36, base + h, r, TINT.birch, seed, 4);
}

// The dad's front garden: the round bed (red leaves fallen on its soil, a step up, ringed with
// small grey stones), the red-leaf tree in it (its trunk the climbable pole, six stems branching
// out of it, its round crown of blobs in several reds drawn in render, open over the trunk's top
// where Jonas stands on it; no collider), the rhododendron at the house's west corner (a dark
// green dome, solid), a potted plant by the door and the car charger on the east gable.
function dadsGarden(kit, layout) {
  const { render, paint, solids } = kit;
  const { leaves, wood, render: crown, paint: pot } = kit.drawn('plants');
  const { ROUND_BED: B, RED_TREE: T, RHODODENDRON: R, POT: P, DAD, GROUND } = layout;
  const bedTop = GROUND + 14;
  render.color(TINT.litter);
  render.lathe(B.x, B.z, [[B.r - 8, bedTop], [0, bedTop + 4]], 12, { vMode: 'plan' });
  const rng = makeRng(331);
  for (let i = 0; i < 26; i++) {
    // A fallen leaf or two: small red flecks over the bed.
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * (B.r - 40);
    const [x, z, s] = [B.x + Math.sin(a) * d, B.z + Math.cos(a) * d, 14 + rng() * 10];
    render.color(TINT.redLeaf[i % TINT.redLeaf.length], 1.1);
    render.poly([[x - s, bedTop + 5, z], [x, bedTop + 5, z - s * 0.6], [x + s, bedTop + 5, z], [x, bedTop + 5, z + s * 0.6]], { facing: [0, 1, 0] });
  }
  const stones = kit.drawn('plants').blocks;
  for (let i = 0; i < B.stones; i++) {
    const a = ((i + rng() * 0.4) / B.stones) * Math.PI * 2;
    const s = 22 + rng() * 12;
    stones.color(TINT.stones, 0.85 + rng() * 0.25);
    stones.lathe(B.x + Math.sin(a) * (B.r - 10), B.z + Math.cos(a) * (B.r - 10), [[s, GROUND - 4], [s * 1.05, GROUND + s * 0.5], [s * 0.6, GROUND + s], [0, GROUND + s * 1.1]], 6, { flat: true, a0: a });
  }
  solids.solid(prismPolys(B.x, B.z, B.r, 12, GROUND - 10, bedTop), 'grass');
  // The tree: the trunk and six stems branching out of it into the crown.
  const C = T.canopy;
  wood.color(TINT.redTrunk);
  wood.lathe(T.x, T.z, [[T.radius + 6, bedTop - 4], [T.radius, bedTop + 60], [T.radius - 8, T.trunkTop], [0, T.trunkTop + 40]], 7, { flat: true });
  for (const [a, out, y, w] of [[0.9, 0.62, 150, 16], [1.9, 0.6, 90, 14], [2.6, 0.5, 40, 12]]) {
    for (const e of [-1, 1]) {
      const [sx, sz] = [Math.sin(a * e), Math.cos(a * e)];
      wood.solid(beamPolys([T.x, bedTop + 120, T.z], [T.x + sx * C.r * out, C.y0 + y, T.z + sz * C.r * out], [sz, 0, -sx], w, w));
    }
  }
  // The crown: blobs round the trunk's top in a ring (the side away from the house lower), three
  // more over its back; four reds, darker underneath.
  const blobs = [
    [0.7, 170, 520, 150, 120], [-0.7, 170, 520, 150, 120],
    [1.75, 190, 470, 140, 115], [-1.75, 190, 470, 140, 115],
    [2.6, 170, 430, 115, 95], [-2.6, 170, 430, 115, 95],
    [0, 150, 630, 135, 72], [1.3, 175, 605, 110, 72], [-1.3, 175, 605, 110, 72],
  ];
  crown.shade = (px, y) => 0.62 + 0.42 * Math.min(1, Math.max(0, (y - C.y0) / (C.y1 - C.y0)));
  blobs.forEach(([a, off, cy, r, ry], i) => {
    crown.color(TINT.redLeaf[i % TINT.redLeaf.length], 0.92 + (i % 3) * 0.06);
    blob(crown, T.x + Math.sin(a) * off, T.z + Math.cos(a) * off, cy, r, ry, a * 3);
  });
  crown.shade = null;
  // The rhododendron.
  leaves.color(TINT.rhodo);
  leaves.shade = (x, y) => 0.7 + 0.3 * Math.min(1, (y - GROUND) / R.h);
  leaves.lathe(R.x, R.z, [[R.r * 0.85, GROUND - 6], [R.r, GROUND + R.h * 0.35], [R.r * 0.8, GROUND + R.h * 0.8], [R.r * 0.3, GROUND + R.h], [0, GROUND + R.h + 6]], 8, { a0: 0.3 });
  leaves.shade = null;
  solids.solid(prismPolys(R.x, R.z, R.r * 0.85, 8, GROUND - 6, GROUND + R.h * 0.85), 'grass');
  // A blue pot by the door with a little green plant in it (drawn only).
  pot.color(TINT.pot);
  pot.lathe(P.x, P.z, [[16, GROUND], [24, GROUND + 4], [27, GROUND + 40], [0, GROUND + 40]], 8, { flat: true });
  leaves.color(TINT.potLeaves);
  leaves.lathe(P.x, P.z, [[22, GROUND + 38], [32, GROUND + 58], [22, GROUND + 80], [0, GROUND + 90]], 7);
  // The car charger: a dark box on the white gable by the bins, a round green status light on its
  // face, its cable hanging in a loop from its underside to the plug in a holster below (the
  // cable a mover of its own: kit.mover('charger_cable'), drawn in both looks).
  const C2 = DAD.charger;
  paint.color(TINT.charger);
  paint.box(C2.x, C2.x + 14, GROUND + 130, GROUND + 215, C2.z - 30, C2.z + 30, { faceShade: (n) => (n[0] > 0.5 ? 1 : 0.8) });
  paint.box(C2.x, C2.x + 10, GROUND + 62, GROUND + 84, C2.z + 30, C2.z + 46, { faceShade: (n) => (n[0] > 0.5 ? 1 : 0.8) });
  paint.color(TINT.chargerLight);
  paint.poly(Array.from({ length: 8 }, (_, k) => [C2.x + 14.6, GROUND + 196 + Math.cos((k / 8) * Math.PI * 2) * 6, C2.z + Math.sin((k / 8) * Math.PI * 2) * 6]), { facing: [1, 0, 0] });
  chargerCable(kit.mover('charger_cable'), C2, GROUND);
}

// The charger's cable: a square tube 4 wide from the box's underside, sagging in a loop to its
// lowest 70 over the drive, up to the plug standing in its holster (12 segments).
function chargerCable(b, C, G) {
  const from = [C.x + 7, G + 130, C.z + 18];
  const to = [C.x + 6, G + 84, C.z + 38];
  const at = (t) => {
    const sag = Math.sin(Math.PI * t) * (from[1] - G - 70 - (from[1] - to[1]) * t);
    return [from[0] + (to[0] - from[0]) * t + Math.sin(Math.PI * t) * 3, from[1] + (to[1] - from[1]) * t - sag, from[2] + (to[2] - from[2]) * t];
  };
  b.color(TINT.cable);
  for (let k = 0; k < 12; k++) b.solid(beamPolys(at(k / 12), at((k + 1) / 12), [1, 0, 0], 4, 4));
  b.box(to[0] - 4, to[0] + 4, to[1] - 2, to[1] + 18, to[2] - 4, to[2] + 4);
}

// A bed of cosmos on a terrace: dark soil, tufts of leaves (seeded) each with a few pink, rose
// and white flowers on top (drawn only).
function flowerBed(kit, layout, bed) {
  const { cobbles } = kit;
  const { leaves, render } = kit.drawn('plants');
  const y = layout.groundHeight((bed.x0 + bed.x1) / 2, (bed.z0 + bed.z1) / 2);
  cobbles.color(TINT.soil);
  cobbles.poly([[bed.x0, y + 1, bed.z0], [bed.x1, y + 1, bed.z0], [bed.x1, y + 1, bed.z1], [bed.x0, y + 1, bed.z1]], { facing: [0, 1, 0], shade: 0.8 });
  const rng = makeRng(bed.seed);
  for (let i = 0; i < bed.n; i++) {
    const x = bed.x0 + 40 + rng() * (bed.x1 - bed.x0 - 80);
    const z = bed.z0 + 40 + rng() * Math.max(0, bed.z1 - bed.z0 - 80);
    const r = 40 + rng() * 25;
    const h = 60 + rng() * 40;
    leaves.color(TINT.tuft, 0.9 + rng() * 0.25);
    leaves.lathe(x, z, [[r, y - 2], [r * 0.9, y + h * 0.5], [r * 0.5, y + h], [0, y + h + 4]], 6, { a0: rng() * 3 });
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2;
      const [fx, fy, fz] = [x + Math.sin(a) * r * 0.5, y + h * (0.85 + rng() * 0.3), z + Math.cos(a) * r * 0.5];
      const s = 11;
      render.color(TINT.flowers[(i + k) % TINT.flowers.length]);
      render.poly([[fx - s, fy, fz], [fx, fy + 3, fz - s], [fx + s, fy, fz], [fx, fy + 3, fz + s]], { facing: [0, 1, 0] });
    }
  }
}

// ---------------------------------------------------------------- the mailbox and the sparrow

// The dad's mailbox: a black wooden box shaped like a little house (its gable end toward the
// street, with a brass slot, a door below it and a blank name plate) on a black post, the little
// blue sparrow standing on its ridge at the street end; solid to its eaves (a coin waits over its
// roof).
function mailbox(kit, layout) {
  const { paint, solids } = kit.drawn('mailbox');
  const { MAILBOX: M, GROUND } = layout;
  const [bw, bd] = M.body;
  const f = frame({ cx: M.x, cz: M.z, yaw: M.yaw, w: bw, d: bd, y0: GROUND });
  const y1 = GROUND + M.post;
  paint.color(TINT.mailbox);
  paint.solid(localBoxPolys(wallFrame(f.at(0, GROUND, 0), f.dir(0, 0, 1)), -7, 7, 0, M.post, -7, 7, { bottom: false }));
  paint.color(TINT.mailbox);
  const box = [f.at(-bw / 2, 0, bd / 2), f.at(bw / 2, 0, bd / 2), f.at(bw / 2, 0, -bd / 2), f.at(-bw / 2, 0, -bd / 2)];
  const at = (p, y) => [p[0], y, p[2]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const out = [box[i][0] + box[j][0] - 2 * M.x, 0, box[i][2] + box[j][2] - 2 * M.z];
    paint.poly([at(box[i], y1), at(box[j], y1), at(box[j], M.eaves), at(box[i], M.eaves)], { facing: out, shade: i === 0 ? 1 : 0.85 });
  }
  paint.poly(box.map((p) => at(p, y1)), { facing: [0, -1, 0], shade: 0.5 });
  // The roof: its ridge running from the street end to the back, the gable ends black too.
  const r0 = f.at(0, M.ridge, bd / 2 + 8);
  const r1 = f.at(0, M.ridge, -bd / 2 - 8);
  const e = (u, w) => f.at(u, M.eaves - 4, w);
  for (const s of [-1, 1]) paint.poly([e(s * (bw / 2 + 8), bd / 2 + 8), e(s * (bw / 2 + 8), -bd / 2 - 8), r1, r0], { facing: f.dir(s, 1.7, 0), shade: 0.9 });
  for (const s of [-1, 1]) paint.poly([f.at(-bw / 2, M.eaves, (s * bd) / 2), f.at(bw / 2, M.eaves, (s * bd) / 2), f.at(0, M.ridge - 4, (s * bd) / 2)], { facing: f.dir(0, 0, s) });
  // The street end: the slot, a blank plate over it, the door and its knob below.
  const front = wallFrame(f.at(0, y1, bd / 2), f.dir(0, 0, 1));
  paint.color(TINT.brass);
  paint.panel(front, [[-28, 80], [28, 80], [28, 92], [-28, 92]], 1);
  paint.panel(front, [[22, 30], [28, 30], [28, 40], [22, 40]], 1.5);
  paint.color(TINT.plate);
  paint.panel(front, [[-18, 104], [18, 104], [18, 116], [-18, 116]], 1);
  paint.color(TINT.mailbox, 1.35);
  paint.panel(front, [[-36, 8], [36, 8], [36, 68], [-36, 68]], 0.5);
  sparrow(paint, f.at(0, M.ridge - 9, bd / 2 - 16), f.dir(1, 0, 0));
  solids.solid([box.map((p) => at(p, M.eaves)), ...box.map((p, i) => [at(p, GROUND), at(box[(i + 1) % 4], GROUND), at(box[(i + 1) % 4], M.eaves), at(p, M.eaves)])], 'wood');
}

// The little blue sparrow, its belly on the ridge at o, facing horizontal `fwd`: a blue body
// over a white belly, a round head with dark eyes and an orange beak, darker wings folded on its
// sides, its tail cocked up behind (in bird units, about 50 long).
function sparrow(b, o, fwd) {
  const K = 1.3;
  const side = [-fwd[2], 0, fwd[0]];
  const P = (a, y, s) => [o[0] + (fwd[0] * a + side[0] * s) * K, o[1] + y * K, o[2] + (fwd[2] * a + side[2] * s) * K];
  const mid = P(0, 17, 0);
  const part = (tint, mul, ...polys) => {
    b.color(tint, mul);
    for (const p of polys) {
      const c = centroid(p);
      b.poly(p, { facing: [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]] });
    }
  };
  // A block from its end at a0 (y0 up h0, s0 either side) to its end at a1.
  const block = (tint, mul, a0, y0, h0, s0, a1, y1, h1, s1) => {
    b.color(tint, mul);
    b.solid(hexaPolys([P(a0, y0, -s0), P(a0, y0, s0), P(a0, y0 + h0, s0), P(a0, y0 + h0, -s0), P(a1, y1, -s1), P(a1, y1, s1), P(a1, y1 + h1, s1), P(a1, y1 + h1, -s1)]));
  };
  // The body: an eight-faced lump, blue above, white below; the head, the cocked tail.
  const [nose, back, top, bottom, l, r] = [P(14, 18, 0), P(-12, 19, 0), P(0, 29, 0), P(0, 6, 0), P(0, 17, -10.5), P(0, 17, 10.5)];
  part(TINT.sparrow, 1, [nose, top, l], [nose, r, top], [back, l, top], [back, top, r]);
  part(TINT.white, 1, [nose, l, bottom], [nose, bottom, r], [back, bottom, l], [back, r, bottom]);
  block(TINT.sparrow, 1.1, 9, 23, 13, 6, 20, 23, 13, 6);
  block(TINT.sparrow, 0.85, -9, 17, 4, 4, -21, 24, 3, 8);
  // The beak, the eyes and the folded wings.
  const tip = P(27, 30, 0);
  const [b0, b1, b2, b3] = [P(20, 28, -3), P(20, 33, -3), P(20, 33, 3), P(20, 28, 3)];
  part(TINT.beak, 1, [b0, b1, tip], [b1, b2, tip], [b2, b3, tip], [b3, b0, tip]);
  for (const s of [-1, 1]) {
    part(0x101010, 1, [P(15, 30, s * 6.2), P(18, 30, s * 6.2), P(18, 33, s * 6.2), P(15, 33, s * 6.2)]);
    part(TINT.sparrow, 0.75, [P(6, 24, s * 8.6), P(-13, 23, s * 8.6), P(-15, 17, s * 8.6), P(3, 14, s * 8.6)]);
  }
}

// ---------------------------------------------------------------- cars, the hoop, the trampoline

// A parked car (CARS, CAR_KINDS; generic, plate-less): its body from just over the ground up to
// the belt (the bonnet's front edge and the boot's rounded off), a glass cabin narrowing up to a
// roof in the body's colour with a pillar down each side, four wheels (dark tyres, grey hubs),
// pale headlights and red tail lights, a soft shadow on the ground under it; solid (the body and
// the cabin, each convex). `what`: 'all', or only its 'solids' or only its drawing ('draw': the
// dad's car is drawn last, its collider made in its place among the others'). The dad's
// crossover (style 'ev', id 'dad_ev': its collider named) is a lookalike of his own car: evCar.
// `mark`: draw it in its own frame instead (origin on the ground under its middle, +z its nose),
// telling mark(zone) each part of the drawing as it starts (dadCar).
function car(kit, layout, c, what = 'all', mark = null) {
  const { paint } = kit.drawn('cars');
  const K = layout.CAR_KINDS[c.kind];
  const f = frame(mark ? { cx: 0, cz: 0, yaw: 0 } : { cx: c.x, cz: c.z, yaw: c.yaw });
  const y0 = mark ? 0 : layout.groundHeight(c.x, c.z);
  const [hl, hw, belt, roof] = [K.l / 2, K.w / 2, y0 + K.belt, y0 + K.roof];
  // Rings of corners in the car's frame (u across, w along: the nose at +hl), and solids between
  // two of them.
  const ring = (w0, w1, u, y) => [f.at(-u, y, w0), f.at(u, y, w0), f.at(u, y, w1), f.at(-u, y, w1)];
  const hexa = (a, b, opts) => hexaPolys([...a, ...b], opts);
  const body = (yb) => hexa(ring(-hl, hl, hw, yb), ring(-hl + 18, hl - 45, hw, belt), { bottom: false });
  const cabin = (top) => hexa(ring(-hl + K.tail, hl - K.hood, hw - 10, belt), ring(-hl + K.tailTop, hl - K.hood - K.screen, hw - 32, roof), { bottom: false, top });
  if (what !== 'draw') {
    const solids = c.id ? kit.solids.named(c.id) : kit.solids;
    solids.solid(body(y0 - 5), 'stone');
    solids.solid(cabin(true), 'stone');
  }
  if (what === 'solids') return null;
  if (c.style === 'ev') return evCar(paint, f, K, c, y0, { ring, hexa, cabin, mark: mark ?? NOOP });
  const part = (tint, polys, faceShade) => {
    paint.color(tint);
    paint.solid(polys, { faceShade });
  };
  const [r0, r1] = [-hl + K.tailTop, hl - K.hood - K.screen];
  const wm = (K.tail - K.hood) / 2 - 20; // the pillar between the side windows
  paint.color(TINT.shadow);
  paint.poly(ring(-hl - 20, hl + 20, hw + 20, y0 + 1.5), { facing: [0, 1, 0], shade: 0.55 });
  part(c.tint, body(y0 + CAR_CLEAR), (n) => (n[1] > 0.5 ? 1.12 : 0.92));
  part(TINT.glass, cabin(false), (n) => (n[1] > 0.3 ? 1.25 : 1));
  part(c.tint, hexa(ring(r0 - 4, r1 + 6, hw - 28, roof - 12), ring(r0 - 2, r1 + 4, hw - 30, roof + 3)), (n) => (n[1] > 0.5 ? 1.15 : 0.9));
  part(c.tint, hexa(ring(wm - 14, wm + 14, hw - 9, belt), ring(wm - 14, wm + 14, hw - 31, roof - 10), { bottom: false, top: false }));
  // Pale headlights on the nose and red lights on the tail (on their sloping faces).
  for (const [tint, e, k] of [[TINT.white, 1, 45], [TINT.taillight, -1, 18]]) {
    const at = (u, y) => f.at(u, y, e * (hl - (k * (y - y0 - CAR_CLEAR)) / (K.belt - CAR_CLEAR) + 1.5));
    paint.color(tint);
    for (const s of [-1, 1]) paint.poly([at(s * (hw - 18), belt - 42), at(s * (hw - 70), belt - 42), at(s * (hw - 70), belt - 20), at(s * (hw - 18), belt - 20)], { facing: f.dir(0, 0.3, e) });
  }
  carWheels(paint, f, K, y0, TINT.hub);
  return null;
}
const NOOP = () => {};

// The dad's car (`c`: its CARS entry, style 'ev') drawn into `paint` (a GeoBuilder) in its own
// frame, origin on the ground under its middle (x across, + its left; z along, + its nose), as it
// is drawn on its drive; mark(zone) is told each part of the drawing as it starts. Returns its
// cuts (world/lane/real/pieces.js: STOMPWATT's pieces, the lane's lazy chunk).
export function dadCar(paint, layout, c, mark) {
  return car({ drawn: () => ({ paint }) }, layout, c, 'draw', mark);
}

// The wheels: a tyre (its face and its tread) round a hub (`hub`'s colour); `face(s, w, at)`
// draws over each hub (the dad's crossover's blades).
function carWheels(paint, f, K, y0, hub, face = null) {
  const [hl, hw] = [K.l / 2, K.w / 2];
  const R = K.wheel;
  const A = (Math.PI * 2) / WHEEL_SIDES;
  for (const w of [hl - K.l * 0.19, -hl + K.l * 0.2]) {
    for (const s of [-1, 1]) {
      const disc = (u, r) => Array.from({ length: WHEEL_SIDES }, (_, k) => f.at(s * u, y0 + R + Math.cos(k * A) * r, w + Math.sin(k * A) * r));
      const [o, i] = [disc(hw + 3, R), disc(hw - 30, R)];
      paint.color(TINT.tyre);
      paint.poly(o, { facing: f.dir(s, 0, 0) });
      o.forEach((p, k) => paint.poly([p, o[(k + 1) % WHEEL_SIDES], i[(k + 1) % WHEEL_SIDES], i[k]], { facing: f.dir(0, Math.cos((k + 0.5) * A), Math.sin((k + 0.5) * A)) }));
      paint.color(hub);
      paint.poly(disc(hw + 4, R * 0.55), { facing: f.dir(s, 0, 0) });
      face?.(s, w, (r, a) => f.at(s * (hw + 4.5), y0 + R + Math.cos(a) * r, w + Math.sin(a) * r));
    }
  }
}

// The dad's compact electric crossover (classic look): a lookalike of his car, no badge, no plate.
// Its body as the others' but for a bonnet that slopes down toward a more raked nose (drawn only:
// its collider is the kind's), the roof, the pillars and the mirror caps gloss black; on the nose
// slim dark lamps high at the bonnet's corners, swept back round them into the wings, each with a
// white sideways-T light, a closed panel in the body's colour in a thin frame between them, a dark
// slot under it, black corner inserts, a dark lower intake and a slim silver skid strip; black
// cladding over the arches and along the sills; the window line kinked up at the rear pillar;
// tall red lamps up the tail's corners and the rear pillars; two-tone wheels (five silver blades
// over a dark face).
const EV_DROP = 8; // the bonnet's front edge this much under the belt (drawn only)
function evCar(paint, f, K, car, y0, { ring, hexa, cabin, mark }) {
  const c = { tint: car.classicTint ?? car.tint }; // (the classic look's: its warm bake greys a blue)
  const [hl, hw, belt, roof] = [K.l / 2, K.w / 2, y0 + K.belt, y0 + K.roof];
  const yb = y0 + CAR_CLEAR;
  const cowl = hl - K.hood;
  const top = belt - EV_DROP; // the nose's top edge
  const at = (u, y, w) => f.at(u, y, w);
  const part = (tint, polys, faceShade) => {
    paint.color(tint);
    paint.solid(polys, { faceShade });
  };
  const bodyShade = (n) => (n[1] > 0.5 ? 1.12 : 0.92);
  const R = K.wheel;
  const axles = [hl - K.l * 0.19, -hl + K.l * 0.2];
  const [r0, r1] = [-hl + K.tailTop, hl - K.hood - K.screen];
  const wm = (K.tail - K.hood) / 2 - 20; // (the pillar between the side windows)
  mark('contact');
  paint.color(TINT.shadow);
  paint.poly(ring(-hl - 20, hl + 20, hw + 20, y0 + 1.5), { facing: [0, 1, 0], shade: 0.55 });
  // The body: behind the cowl as the others' (in three lengths: the tail, the rear doors, the
  // front doors, where STOMPWATT parts it), the bonnet sloping down to the nose's top edge.
  mark('body');
  const cuts = [-hl, axles[1] + R, wm, cowl];
  for (let i = 0; i < 3; i++) part(c.tint, hexa(ring(cuts[i], cuts[i + 1], hw, yb), ring(i ? cuts[i] : -hl + 18, cuts[i + 1], hw, belt), { bottom: false }), bodyShade);
  part(c.tint, hexaPolys([at(-hw, yb, cowl), at(hw, yb, cowl), at(hw, yb, hl), at(-hw, yb, hl), at(-hw, belt, cowl), at(hw, belt, cowl), at(hw, top, hl - 45), at(-hw, top, hl - 45)], { bottom: false }), bodyShade);
  mark('greenhouse');
  part(TINT.glass, cabin(false), (n) => (n[1] > 0.3 ? 1.25 : 1));
  // The black roof and the pillar between the side windows.
  part(TINT.evRoof, hexa(ring(r0 - 4, r1 + 6, hw - 28, roof - 12), ring(r0 - 2, r1 + 4, hw - 30, roof + 3)), (n) => (n[1] > 0.5 ? 1.15 : 0.9));
  part(TINT.evRoof, hexa(ring(wm - 14, wm + 14, hw - 9, belt), ring(wm - 14, wm + 14, hw - 31, roof - 10), { bottom: false, top: false }));
  // A point on the nose's sloping face at (u, y), `o` proud of it; a polygon there.
  const noseW = (y) => hl - (45 * (y - yb)) / (top - yb);
  const nose = (u, y, o) => at(u, y, noseW(y) + o);
  const face = (pts, o = 1.8) => paint.poly(pts.map(([u, y]) => nose(u, y, o)), { facing: f.dir(0, 0.45, 1) });
  mark('nose');
  // A point on side s at (w, y), `o` out from it.
  const side = (s, w, y, o) => at(s * (hw + o), y, w);
  const sidePoly = (s, pts, o = 1.5) => paint.poly(pts.map(([w, y]) => side(s, w, y, o)), { facing: f.dir(s, 0, 0) });
  // The lamps: slim, high at the bonnet's corners, rising a little toward their outer ends and
  // swept back round the corner into the wing, the T's bar along them and its stroke at the outer
  // end; the closed panel between them in its thin frame, the slot under it.
  const lampTop = (u) => top - 3 - 2 * Math.abs(u) / hw; // (under the bonnet's edge)
  for (const s of [-1, 1]) {
    const [ui, uo] = [s * hw * 0.4, s * (hw - 2)];
    paint.color(TINT.evLamp);
    face([[ui, lampTop(ui) - 13], [uo, lampTop(uo) - 9], [uo, lampTop(uo)], [ui, lampTop(ui)]]);
    sidePoly(s, [[noseW(lampTop(uo) - 9) + 1, lampTop(uo) - 9], [noseW(lampTop(uo)) - 34, lampTop(uo) - 3], [noseW(lampTop(uo)) - 34, lampTop(uo) + 1], [noseW(lampTop(uo)) + 1, lampTop(uo)]]);
    paint.color(TINT.evDrl);
    const bar = (u) => lampTop(u) - 6;
    const [bi, bo] = [s * hw * 0.44, s * (hw - 14)];
    face([[bi, bar(bi) - 1.5], [bo, bar(bo) - 1.5], [bo, bar(bo) + 1.5], [bi, bar(bi) + 1.5]], 3);
    face([[bo - s * 4, lampTop(bo) - 10], [bo, lampTop(bo) - 10], [bo, lampTop(bo) - 1.5], [bo - s * 4, lampTop(bo) - 1.5]], 3);
    // The black inserts at the bumper's corners (the fog lamps' surrounds), slanting in.
    paint.color(TINT.evPlastic);
    face([[s * (hw - 8), yb + 30], [s * (hw - 40), yb + 22], [s * (hw - 30), yb + 48], [s * (hw - 8), yb + 56]]);
  }
  const [gw, gTop, gLo, r] = [hw * 0.36, lampTop(hw * 0.36) + 1, lampTop(hw * 0.36) - 33, 6];
  const rounded = (a, y0r, y1r, rr) => {
    const pts = [];
    for (const [cu, cy, a0] of [[a - rr, y0r + rr, -Math.PI / 2], [a - rr, y1r - rr, 0], [-a + rr, y1r - rr, Math.PI / 2], [-a + rr, y0r + rr, Math.PI]]) {
      for (let i = 0; i <= 2; i++) pts.push([cu + Math.cos(a0 + (i / 2) * (Math.PI / 2)) * rr, cy + Math.sin(a0 + (i / 2) * (Math.PI / 2)) * rr]);
    }
    return pts;
  };
  paint.color(TINT.evFrame);
  face(rounded(gw + 2, gLo - 2, gTop + 2, r + 2), 1.2);
  paint.color(c.tint, 0.94);
  face(rounded(gw, gLo, gTop, r), 2.2);
  paint.color(TINT.evPlastic);
  face([[-gw * 0.9, gLo - 7], [gw * 0.9, gLo - 7], [gw * 0.94, gLo - 3], [-gw * 0.94, gLo - 3]]);
  // The lower intake, the skid strip, the black lip along the foot.
  face([[-hw * 0.62, yb + 9], [hw * 0.62, yb + 9], [hw * 0.55, yb + 24], [-hw * 0.55, yb + 24]]);
  paint.color(TINT.evSkid);
  face([[-hw * 0.4, yb + 3], [hw * 0.4, yb + 3], [hw * 0.38, yb + 7], [-hw * 0.38, yb + 7]], 2.4);
  paint.color(TINT.evPlastic);
  face([[-(hw - 2), yb], [hw - 2, yb], [hw - 2, yb + 3], [-(hw - 2), yb + 3]], 2);
  // Tall red lamps up the tail's corners (on its sloping face) and up the cabin's back beside
  // its window.
  const tail = (u, y, o) => at(u, y, -(hl - (18 * (y - yb)) / (belt - yb) + o));
  mark('tail');
  paint.color(TINT.evTail);
  for (const s of [-1, 1]) {
    paint.poly([[s * (hw - 10), belt - 60], [s * (hw - 34), belt - 60], [s * (hw - 34), belt - 2], [s * (hw - 10), belt - 2]].map(([u, y]) => tail(u, y, 1.8)), { facing: f.dir(0, 0.3, -1) });
    const back = -hl + K.tail;
    paint.poly([at(s * (hw - 12), belt + 2, back - 0.5), at(s * (hw - 30), belt + 2, back - 0.5), at(s * (hw - 34), belt + 50, back + 12), at(s * (hw - 16), belt + 50, back + 12)], { facing: f.dir(0, 0.2, -1) });
  }
  // The sides: black cladding over the arches and along the sills, the window line kinked up at
  // the rear pillar (the body's colour over the cabin's side), black mirror caps.
  for (const s of [-1, 1]) {
    mark('sides');
    paint.color(TINT.evPlastic);
    for (const [wa, wb] of [[axles[1] + R + 6, wm], [wm, axles[0] - R - 6]]) sidePoly(s, [[wa, yb], [wb, yb], [wb, yb + 13], [wa, yb + 13]]);
    mark('wheels');
    for (const w of axles) {
      for (let k = 0; k < 6; k++) {
        const [a0, a1] = [-Math.PI / 2 + (k / 6) * Math.PI, -Math.PI / 2 + ((k + 1) / 6) * Math.PI];
        const p = (a, rr) => [w + Math.sin(a) * rr, y0 + R + Math.cos(a) * rr];
        sidePoly(s, [p(a0, R + 3), p(a1, R + 3), p(a1, R + 11), p(a0, R + 11)], 1.2);
      }
    }
    // (The cabin's side: from the belt at hw - 10 in to the roof at hw - 32, its back edge from
    // -hl + tail at the belt to -hl + tailTop at the roof.)
    const cab = (w, y) => {
      const t = (y - belt) / (roof - belt);
      return at(s * (hw - 10 - 22 * t + 1.2), y, w);
    };
    const kink = (y) => -hl + K.tail + (K.tailTop - K.tail) * ((y - belt) / (roof - belt));
    const [k0, k1] = [-hl + K.tail + 70, belt + 34];
    mark('greenhouse');
    paint.color(c.tint);
    paint.poly([cab(k0, belt + 1), cab(kink(belt + 1) + 1, belt + 1), cab(kink(k1) + 1, k1)], { facing: f.dir(s, 0.4, 0) });
    mark('sides');
    paint.color(TINT.evRoof);
    const m = hl - K.hood - 20;
    paint.box(...boxAt(f, s * (hw + 6), belt + 12, m, 12, 9, 14));
  }
  // Two-tone wheels: five silver blades over the dark face.
  mark('wheels');
  carWheels(paint, f, K, y0, TINT.evWheel, (s, w, P) => {
    paint.color(TINT.hub);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      paint.poly([P(R * 0.15, a - 0.5), P(R * 0.15, a + 0.5), P(R * 0.52, a + 0.16), P(R * 0.52, a - 0.16)], { facing: f.dir(s, 0, 0) });
    }
  });
  mark(null);
  // (Its cuts in its own frame: world/lane/real/pieces.js.)
  return { hw, head: cowl - 0.5, tail: cuts[1], pillar: wm, axles, R, yC: R, tread: 34.5, mirror: hl - K.hood - 20, belt: K.belt, hatch: CAR_CLEAR + 30, floor: CAR_CLEAR, roof: K.roof };
}
const boxAt = (f, u, y, w, a, b, d) => {
  const p = f.at(u, y, w);
  return [p[0] - a, p[0] + a, p[1] - b, p[1] + b, p[2] - d, p[2] + d];
};

// North_5's basketball hoop: a black post standing against its wall, a white board (an orange
// square over the ring) held out on a dark arm, the orange ring and a white net hanging from it.
// The post and the board with its arm are solid (the board's top a perch; nothing under the
// board's front stops a jump at it).
function hoop(kit, layout) {
  const { paint, solids } = kit.drawn('toys');
  const { HOOP: H, GROUND } = layout;
  const zf = H.z + H.out; // the board's back, at the post
  const top = H.board + H.h;
  paint.color(0x1e1e1e);
  paint.lathe(H.x, H.z + 12, [[9, GROUND - 5], [8, top - 10], [0, top - 8]], 6, { flat: true });
  paint.box(H.x - 30, H.x + 30, H.board + 30, H.board + 44, H.z, zf, { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
  paint.color(TINT.white);
  paint.box(H.x - H.w / 2, H.x + H.w / 2, H.board, top, zf, zf + 14, { faceShade: (n) => (n[2] > 0.5 ? 1 : 0.8) });
  const bf = wallFrame([H.x, 0, zf + 14], [0, 0, 1]);
  paint.color(TINT.hoop);
  paint.panel(bf, [[-30, H.board + 14], [30, H.board + 14], [30, H.board + 62], [-30, H.board + 62]], 1);
  paint.color(TINT.white);
  paint.panel(bf, [[-26, H.board + 18], [26, H.board + 18], [26, H.board + 58], [-26, H.board + 58]], 2);
  // The ring (ten short beams round its middle) and the net under it.
  const rz = zf + 14 + H.ring + 8;
  const rp = (k) => [H.x + Math.sin((k / 10) * Math.PI * 2) * H.ring, H.rim, rz + Math.cos((k / 10) * Math.PI * 2) * H.ring];
  for (let k = 0; k < 10; k++) {
    const [p, q] = [rp(k), rp(k + 1)];
    paint.solid(orientedBoxPolys([(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2], [q[0] - p[0], 0, q[2] - p[2]], 26, H.rim - 3, H.rim + 3, 5));
  }
  paint.color(TINT.white, 0.95);
  paint.lathe(H.x, rz, [[H.ring - 2, H.rim - 3], [H.ring * 0.62, H.rim - 50], [0, H.rim - 50]], 8, { flat: true });
  solids.solid(prismPolys(H.x, H.z + 12, 12, 6, GROUND - 5, H.board), 'stone');
  solids.box(H.x - H.w / 2, H.x + H.w / 2, H.board, top, H.z, zf + 14, 'wood', { bottom: true });
}

// The trampoline (TRAMPOLINE): a dark mat sagging a touch inside a padded blue ring, a dark skirt
// under the pad and six steel legs down to the terrace; solid from the terrace up to the mat's
// top (objects/Trampoline.js does the bouncing).
function trampoline(kit, layout) {
  const { paint, solids } = kit.drawn('toys');
  const T = layout.TRAMPOLINE;
  const y0 = layout.groundHeight(T.x, T.z);
  const pad = 45;
  const mat = T.r - pad;
  paint.color(TINT.mat);
  paint.lathe(T.x, T.z, [[mat, T.y - 1], [mat * 0.5, T.y - 5], [0, T.y - 6]], 12, { flat: true, vMode: 'plan' });
  paint.color(TINT.pad);
  paint.lathe(T.x, T.z, [[T.r, T.y - 28, 0.7], [T.r, T.y - 6, 0.9], [T.r - 12, T.y + 2], [mat + 6, T.y + 1], [mat, T.y - 1]], 12, { flat: true });
  paint.color(TINT.charger);
  for (let i = 0; i < T.legs; i++) {
    const a = ((i + 0.5) / T.legs) * Math.PI * 2;
    const [sx, sz] = [Math.sin(a), Math.cos(a)];
    paint.solid(beamPolys([T.x + sx * (T.r - 5), y0, T.z + sz * (T.r - 5)], [T.x + sx * (T.r - 25), T.y - 28, T.z + sz * (T.r - 25)], [sz, 0, -sx], 12, 12));
  }
  solids.solid(prismPolys(T.x, T.z, T.r, 12, y0 - 5, T.y), 'grass');
}

// ---------------------------------------------------------------- the motorhome, fences

// The motorhome on the north-west villa's drive: a white box (its cab end toward the junction)
// with a dark window band round it, on four dark wheels: at the cab end the windscreen, the
// headlights and a bumper, along the road side its door and a stripe down both sides, a ladder up
// its back; solid from the ground to its roof (a coin spot).
function motorhome(kit, layout) {
  const { paint, solids } = kit.drawn('motorhome');
  const { MOTORHOME: M, GROUND } = layout;
  const f = frame({ cx: M.cx, cz: M.cz, yaw: M.yaw, w: M.l, d: M.w });
  const top = GROUND + M.h;
  const [hl, hw] = [M.l / 2, M.w / 2];
  const box = (u0, u1, y0, y1, w0, w1) => hexaPolys([f.at(u0, y0, w0), f.at(u1, y0, w0), f.at(u1, y0, w1), f.at(u0, y0, w1), f.at(u0, y1, w0), f.at(u1, y1, w0), f.at(u1, y1, w1), f.at(u0, y1, w1)]);
  paint.color(TINT.white);
  paint.solid(box(-hl, hl, GROUND + 45, top, -hw, hw), { faceShade: (n) => (n[1] > 0.5 ? 1.05 : n[1] < -0.5 ? 0.5 : 0.95) });
  paint.color(0x2c3238);
  paint.solid(box(-hl - 2, hl + 2, top - 190, top - 120, -hw - 2, hw + 2), { faceShade: (n) => (Math.abs(n[1]) > 0.5 ? 0 : 1) });
  paint.color(0x111111);
  for (const u of [-hl + 140, hl - 160]) for (const w of [-hw + 10, hw - 10]) paint.solid(box(u - 45, u + 45, GROUND, GROUND + 90, w - 18, w + 18));
  // The cab end: windscreen, headlights, bumper.
  const cab = wallFrame(f.at(-hl, GROUND, 0), f.dir(-1, 0, 0));
  const quad = (fr, u0, v0, u1, v1, w, tint) => {
    paint.color(tint);
    paint.panel(fr, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], w);
  };
  quad(cab, -hw + 22, 170, hw - 22, 300, 1, 0x2c3238);
  quad(cab, -hw, 45, hw, 80, 2, 0x8a8e90);
  for (const s of [-1, 1]) quad(cab, s > 0 ? hw - 70 : -hw + 22, 95, s > 0 ? hw - 22 : -hw + 70, 125, 2, TINT.white);
  // The road side's door (a window in it) and the stripe along both sides.
  const road = wallFrame(f.at(0, GROUND, hw), f.dir(0, 0, 1));
  quad(road, -hl + 250, 60, -hl + 340, 330, 1, 0xd8dad6);
  quad(road, -hl + 265, 230, -hl + 325, 300, 2, 0x2c3238);
  for (const s of [-1, 1]) quad(wallFrame(f.at(0, GROUND, s * hw), f.dir(0, 0, s)), -hl + 10, 140, hl - 10, 158, 1.5, TINT.stripe);
  // The ladder up its back: two rails and four rungs.
  const back = wallFrame(f.at(hl, GROUND, 0), f.dir(1, 0, 0));
  paint.color(0x6a6e72);
  for (const u of [50, 100]) paint.solid(localBoxPolys(back, u - 3, u + 3, 100, M.h + 30, 0, 12));
  for (const v of [120, 220, 320, 420]) paint.solid(localBoxPolys(back, 47, 103, v, v + 6, 8, 14));
  solids.solid(box(-hl, hl, GROUND - 5, top, -hw, hw).slice(1), 'stone'); // (no bottom: hexaPolys's first)
}

// A fence along [from, to] (in its house's frame): a picket fence (pales on two rails, posts) or a
// two-rail fence on posts; its collider a slab as high.
function fence(kit, layout, { house, kind, from, to, h }) {
  const { boards, solids } = kit.drawn('fences');
  const H = layout.HOUSES.find((o) => o.id === house);
  const F = frame(H);
  const y0 = layout.GROUND;
  const a = F.at(from[0], 0, from[1]);
  const b = F.at(to[0], 0, to[1]);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const d = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
  const mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  const along = (t) => [a[0] + d[0] * t, 0, a[2] + d[2] * t];
  boards.color(kind === 'picket' ? TINT.picket : TINT.rail);
  for (const y of kind === 'picket' ? [y0 + 25, y0 + h - 35] : [y0 + 30, y0 + h - 14]) boards.solid(orientedBoxPolys(mid, d, len, y, y + 12, 8));
  for (let t = 0; t <= len; t += 200) boards.solid(orientedBoxPolys(along(t), d, 12, y0 - 5, y0 + h, 12));
  if (kind === 'picket') {
    // The pales: pointed boards either side of the rails.
    const n = [-d[2], 0, d[0]];
    const P = (p, du, y, s) => [p[0] + d[0] * du + n[0] * s, y, p[2] + d[2] * du + n[2] * s];
    for (let t = 9; t < len; t += 18) {
      const p = along(t);
      for (const s of [-5, 5]) {
        boards.poly([P(p, -4, y0 + 2, s), P(p, 4, y0 + 2, s), P(p, 4, y0 + h - 8, s), P(p, 0, y0 + h, s), P(p, -4, y0 + h - 8, s)], { facing: [n[0] * s, 0, n[2] * s], shade: s > 0 ? 1 : 0.85 });
      }
    }
  }
  solids.solid(orientedBoxPolys(mid, d, len, y0 - 5, y0 + h, 20, { bottom: false }), 'wood');
}

// A TV antenna on a chain house's ridge: a mast and a boom with five elements across it (drawn
// only).
function antenna(kit, layout, { house, x }) {
  const { paint } = kit.drawn('antennas'); // (the realistic look's own: world/lane/real/hardware.js)
  const H = layout.HOUSES.find((h) => h.id === house);
  const [y, z] = [H.ridge, H.cz];
  const top = y + 250;
  paint.color(TINT.antenna);
  paint.box(x - 4, x + 4, y - 20, top, z - 4, z + 4);
  paint.box(x - 3, x + 3, top - 16, top - 10, z - 120, z + 80);
  [[110, -110], [95, -60], [85, -10], [75, 40], [65, 75]].forEach(([len, dz]) => paint.box(x - len / 2, x + len / 2, top - 15, top - 11, z + dz - 2, z + dz + 2));
}

// By the footpath: the grey electrical cabinet on a white brick pillar, the blue round sign on its
// grey post (a white walking figure on it) and the low two-rail barrier across the path where
// the play space ends.
function footpathProps(kit, layout) {
  const { paint, brick, boards, solids } = kit;
  const { CABINET: C, PATH_SIGN: S, FOOTPATH: P, GROUND, footpathAt } = layout;
  // The cabinet stands on the path's west side, its doors toward the path.
  const cf = frame({ cx: C.x, cz: C.z, yaw: Math.atan2(P.dir[1], -P.dir[0]), w: 80, d: 40, y0: GROUND });
  const box = (u0, u1, y0, y1, w0, w1) => [cf.at(u0, y0, w0), cf.at(u1, y0, w0), cf.at(u1, y0, w1), cf.at(u0, y0, w1), cf.at(u0, y1, w0), cf.at(u1, y1, w0), cf.at(u1, y1, w1), cf.at(u0, y1, w1)];
  const hexa = (c) => hexaPolys(c);
  brick.color(TINT.pillar);
  brick.solid(hexa(box(-50, 50, GROUND - 5, GROUND + 60, -26, 26)));
  kit.drawn('cabinet').paint.color(TINT.cabinet).solid(hexa(box(-40, 40, GROUND + 60, GROUND + 200, -20, 20)), { faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
  solids.solid(hexa(box(-50, 50, GROUND - 5, GROUND + 200, -26, 26)).slice(1), 'stone');
  // The sign: a grey post, a blue disc facing back up the path, the white figure walking on it
  // (head, body, legs and arms in stride).
  paint.color(TINT.lamp);
  paint.lathe(S.x, S.z, [[7, GROUND - 5], [6, GROUND + 230], [0, GROUND + 232]], 6, { flat: true });
  const sf = wallFrame([S.x, GROUND + 200, S.z], [-P.dir[0], 0, -P.dir[1]]);
  const disc = Array.from({ length: 12 }, (_, i) => {
    const a = Math.PI / 2 - (i / 12) * Math.PI * 2;
    return [Math.cos(a) * 45, Math.sin(a) * 45];
  });
  paint.color(TINT.white);
  paint.panel(sf, disc.map(([u, v]) => [u * 1.12, v * 1.12]), 8);
  paint.color(TINT.sign);
  paint.panel(sf, disc, 9);
  paint.color(TINT.white);
  paint.panel(sf, disc.slice(0, 8).map((_, i) => [3 + Math.cos((i / 8) * Math.PI * 2) * 6, 25 + Math.sin((i / 8) * Math.PI * 2) * 6]), 10);
  const figure = [
    [[-2, 17], [5, 17], [4, -2], [-3, -2]], // the body
    [[0, -2], [4, -2], [14, -30], [9, -31]], // the legs, in stride
    [[-3, -1], [1, -3], [-7, -31], [-12, -29]],
    [[3, 15], [6, 13], [13, 2], [10, 0]], // the arms
    [[-1, 15], [2, 16], [-8, 4], [-10, 6]],
  ];
  for (const part of figure) paint.panel(sf, part, 10);
  solids.solid(prismPolys(S.x, S.z, 15, 6, GROUND - 5, GROUND + 232), 'stone');
  // The barrier: two rails across the path on three posts.
  const t = P.barrier;
  const a = footpathAt(t, P.half + 40);
  const b = footpathAt(t, -P.half - 40);
  const d = [b.x - a.x, 0, b.z - a.z];
  const len = Math.hypot(d[0], d[2]);
  const mid = [(a.x + b.x) / 2, 0, (a.z + b.z) / 2];
  boards.color(TINT.rail);
  for (const y of [GROUND + 40, GROUND + 80]) boards.solid(orientedBoxPolys(mid, d, len, y, y + 14, 10));
  for (const k of [0, 0.5, 1]) boards.solid(orientedBoxPolys([a.x + d[0] * k, 0, a.z + d[2] * k], d, 14, GROUND - 5, GROUND + 100, 14));
  solids.solid(orientedBoxPolys(mid, d, len, GROUND - 5, GROUND + 100, 24, { bottom: false }), 'wood');
}

// ---------------------------------------------------------------- the forest, the side road

// The forest on the bank behind the north gardens (a seeded scatter of firs and birches over
// FOREST's band) and a ring of firs round the outside of the boundary (EDGE_FOREST: each a seeded
// way out from a seeded point on one of its edges, kept off the road drawn on past it), all drawn
// only: the boundary's walls stand inside them. Where they stand is world/lane/real/spots.js's
// (the realistic look plants the same trees).
function forest(kit, layout) {
  const { leaves, wood } = kit.drawn('forest');
  const { firs, birches } = forestSpots(layout);
  const plant = (t) => fir({ leaves, wood }, t.x, t.z, t.base, t.h, t.r, { a0: t.a0, solid: false });
  // (In the order the classic forest was always drawn: the bank's firs, its birches, the edge's.)
  firs.slice(0, layout.FOREST.count).forEach(plant);
  for (const t of birches) birch({ leaves, wood }, t.x, t.z, t.base, t.h, t.r, t.seed);
  firs.slice(layout.FOREST.count).forEach(plant);
}

// Two houses down the side road in the fog (SIDE_BLOCKS): plain chain houses (houses.js) along
// the road, out of reach.
function sideBlocks(kit, { SIDE_ROAD: S, SIDE_BLOCKS, GROUND }) {
  const [dx, dz] = S.dir;
  for (const b of SIDE_BLOCKS) house(kit, { kit: 'chain', cx: S.x + dx * b.t - dz * b.s, cz: S.z + dz * b.t + dx * b.s, w: b.w, d: b.d, yaw: Math.atan2(-dz, dx), y0: GROUND, eave: 412, ridge: 412 + b.d * 0.18, boards: b.tint, roof: TINT.sideRoof });
}
