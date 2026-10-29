// Sparrow Lane's props (lane/layout.js LAMPS, FLAGPOLES, BINS, HEDGES, THUJAS, TREES,
// GARDEN_TREES, RED_TREE, RHODODENDRON, BED, TURN_SIGN, POT, MAILBOX, CARS, HOOP, TRAMPOLINE,
// MOTORHOME, FENCES, CABINET, PATH_SIGN, FLOWER_BEDS, ANTENNAS, FOREST, EDGE_FOREST,
// SIDE_BLOCKS, SIGNS), written into the course's kit (lane/build.js): render faces into its
// material builders (the painted things, from the poles and the bins to the mailbox, the cars and
// the trampoline, into kit.paint: render's own builder in the classic look), colliders into
// kit.solids, the signposts into kit.signs.
//
//   buildProps(kit, layout), propsSteps(kit, layout) (a few builders a step: lane/build.js laneSteps)
//   waveFlags(geometry, layout) -> update(time)   // lane-cloth's flags waving in the breeze
//
// Grey lampposts with a bent arm and a flat lamp head; white flagpoles with a gold knob, each
// flying a long blue and yellow pennant (kit.cloth; a cross flag where a pole's flag is 'flag'); the two big
// wheelie bins against the front of the dad's east gable; hedges (leafy boxes, a soft crown along their
// tops) and thuja columns; the big broad-leaved trees off the junction, an apple tree on north_4's
// terrace, a birch behind the corner house, a Virginia creeper on its pergola by the double garage; the dad's
// garden: the red-leaf bed (field stones along all four edges, russet leaves fallen in it) with
// the old crab apple in its middle (a slim pale trunk, four leaning stems, a wide sparse crown of
// small blobs over the eaves), the rhododendron, the ivy mound, the rose on its stakes, the
// concrete landing at the door with the blue pot on it; the dad's mailbox (one anthracite
// pedestal box on the lawn under a gable lid, the flap, a blank plate, the lower door and its
// lock, the little blue sparrow standing on its ridge; it is the welcome sign); the turning
// area's sign at the corner bed (a yellow plate, "Vänd-" over "plats", a no-parking sign:
// world/lane/real/sign.js lays its face out); the cars on the drives (generic, plate-less: a
// body, a glass cabin under a roof, four wheels, lights);
// north_4's basketball hoop and the trampoline in north_5's front
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
// Colliders: none for the lampposts (each a climbable pole: layout.POLES, as the flagpoles and
// the red-leaf tree; a lamppost that were not would get a prism), the bins, the hedges (boxes,
// their tops walkable), the thujas (steep frustums), the trees' trunks and the pergola's post, the
// rhododendron, the corner bed, the turning area's sign's post (a thin prism), the mailbox
// (a box to its eaves over its lid's footprint, within the sign's box), the landing (a slab, a
// step up), each car (its body and its cabin), the hoop's post and its board (a block from the
// wall: a perch), the trampoline (a prism up to its mat), the motorhome, the fences and the
// barrier (slabs), the cabinet and the sign's post, the signposts, the side road's houses
// (houses.js, out of reach).

import { beamPolys, centroid, hexaPolys, localBoxPolys, orientedBoxPolys, prismPolys, wallFrame } from '../castle/geom.js';
import { addSignpost } from '../props/decor.js';
import { makeRng } from '../../core/math.js';
import { fir } from '../courseKit.js';
import { frame, house } from './houses.js';
import { forestSpots } from './real/spots.js';
import { bedStones, redTreeStems, redTreeCrown, ivyMasses, climberMasses, BEVEL, terraceSpans, fenceEnds } from './real/plan.js';
import { bedSpots } from './facades.js';
import { kerbside, PLATE } from './surface.js';
import { signFace } from './real/sign.js';
import { LINE_HEDGES, GARDEN_THINGS, SMALL_PLANTS, VERANDA_HOUSE, LAYBY, FAR_LAMPS, BACKDROP, FORECOURT_WALL } from './ends.js';

const TINT = {
  lamp: 0x8c9092,
  lampHead: 0xb0b4b4, // (W7: the photos' light grey luminaires)
  collar: 0x9a9890, // (their concrete collars)
  plateBack: 0x4a4c50,
  signBack: 0x9a9c9e,
  flag: 0xf2f2f0,
  gold: 0xe8b84a,
  blue: 0x1e5aa8, // the flags' blue and yellow
  yellow: 0xf6c81c,
  bin: 0x1d2839, // (the photos' near-black blue-grey: W4)
  hedge: 0x9a9040, // (over the green leaf texture: an olive, W1)
  thuja: 0x5e5a30,
  rhodo: 0x4e5a34, // (P2: an olive green, photos 19, 41)
  canopy: 0x5f8a34,
  apple: 0x6a9a3a,
  fruit: 0xc8342a,
  birch: 0xa0a840,
  bark: 0xe8e4da,
  oak: [0x8a9038, 0x9a9440, 0x70883a], // (W7: the forest's broadleaves, golden-green in the low sun)
  pine: 0x9a6040, // (the Scots pines' orange-brown upper bark)
  pineCrown: 0x4e5e2c,
  cherry: [0x9a9a3c, 0xa88a3a, 0x8a9a40], // (the cherry's yellow-green, orange-tipped leaves)
  redLeaf: [0x7a3c2c, 0x5c3226, 0x8a4a30, 0xa8643a], // the red-leaf tree's tones (P2, photos 20, 38, 39: red-browns and an orange, not purple)
  ivy: 0x2e3c1c, // (P2: darker)
  climber: 0x333a22, // (the gable's back corner's: W4)
  flue: 0x9a9ea0, // the east wing's galvanised flue
  lampBody: 0x1c1e20, // the gables' bulkhead lamps
  lampGlass: 0xd8d4c4,
  column: 0x4a5428, // the columnar tree far behind the garage row
  rose: 0xa8a848,
  stake: 0x2a2a2a,
  landing: 0x4c4b4c, // (dark grey concrete, as the photos have it: W3 fix)
  shrub: [0xa83030, 0x8a2a2c],
  litter: 0x8a6c5c, // russet leaves fallen in the bed (W3: brown, not red)
  trunk: 0x6a5444,
  redTrunk: 0x847a70, // (the red-leaf tree's grey-brown bark, over the render texture: W3 fix, P2 darker)
  stones: 0xa8a49c,
  kerb: 0xb8b2a8, // (south_2's flush concrete edging: build.js's kerbs' light grey, W5 fix)
  pinkStone: 0xb89a8e, // (the corner bed's pinkish granite field stones)
  pot: 0x3a6a9a,
  potLeaves: 0x4a7a34,
  charger: 0x3a3e42, // (and the trampoline's legs)
  mailbox: 0x45484f, // (anthracite)
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
  pad: 0x2a2c30, // (W6: the photos' dark grey pad)
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
  kerbsideProps(kit, layout);
  for (const f of layout.FLAGPOLES) flagpole(kit, layout, f);
  layout.BINS.forEach((b, i) => bin(kit, layout, b, i));
  yield;
  for (const h of layout.HEDGES) hedge(kit, h, layout);
  for (const h of LINE_HEDGES) lineHedge(kit, h);
  for (const t of layout.THUJAS) thuja(kit, layout, t);
  yield;
  for (const t of layout.TREES) broadTree(kit, layout, t);
  for (const t of layout.GARDEN_TREES) gardenTree(kit, layout, t);
  for (const t of layout.COLUMN_TREES ?? []) columnTree(kit, layout, t);
  yield;
  dadsGarden(kit, layout);
  neighbours(kit, layout);
  beds(kit, layout);
  turnSign(kit, layout);
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
  gardenThings(kit, layout);
  smallPlants(kit, layout);
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

// A lamppost: a slim grey eight-sided pole on a concrete collar, a short bracket out along its yaw
// from just under the cap to a flat oval luminaire (W7, photos 05, 09, 12, 24: light grey, its
// lens under it); a prism collider unless it is a climbable pole (layout.POLES).
function lamppost(kit, layout, { x, z, yaw }, far = false) {
  const { paint, solids } = kit.drawn('posts');
  const { LAMP, POLES } = layout;
  const y0 = layout.groundHeight(x, z);
  paint.color(TINT.collar);
  paint.lathe(x, z, [[LAMP.r + 16, y0 - 4], [LAMP.r + 15, y0 + 9], [0, y0 + 10]], 8, { flat: true });
  paint.color(TINT.lamp);
  paint.lathe(x, z, [[LAMP.r + 3, y0 - 10], [LAMP.r + 3, y0 + 45], [LAMP.r, y0 + 55], [LAMP.r - 4, LAMP.top], [0, LAMP.top]], 8, { flat: true });
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const y = LAMP.top - LAMP.root;
  paint.solid(beamPolys([x + ax * 6, y, z + az * 6], [x + ax * (LAMP.arm - 30), y + 3, z + az * (LAMP.arm - 30)], [az, 0, -ax], 8, 8));
  paint.color(TINT.lampHead);
  paint.solid(orientedBoxPolys([x + ax * LAMP.arm, 0, z + az * LAMP.arm], [ax, 0, az], 72, y - 6, y + 8, 30), { faceShade: (n) => (n[1] < -0.5 ? 1.4 : 1) });
  if (far || POLES.some((p) => p.x === x && p.z === z)) return; // (lamppost B out past the junction: drawn only)
  solids.solid(prismPolys(x, z, LAMP.collider, 8, y0 - 10, LAMP.top), 'stone');
}

// The cabinets and posts at the lampposts' feet (W7, lane/surface.js KERBSIDE: a grey metal
// cabinet by L2 with a white marker post, a grey-green one with a gabled lid by L3, a pale
// blue-grey one and a white bollard at L5's, a small white box by L1), each solid (a box, a thin
// prism); the blank sign plate clamped on L5's pole facing east; drawn in both looks.
function kerbsideProps(kit, layout) {
  const { paint, solids } = kit; // (both looks: plain sheet-metal boxes)
  const G = layout.GROUND;
  for (const k of kerbside(layout)) {
    const [ux, uz] = [Math.cos(k.yaw), -Math.sin(k.yaw)];
    if (k.kind === 'post') {
      paint.color(k.tint);
      paint.lathe(k.x, k.z, [[k.w / 2, G - 4], [k.w / 2, G + k.h - 6], [0, G + k.h]], 6, { flat: true });
      if (k.cap) paint.color(k.cap).lathe(k.x, k.z, [[k.w / 2 + 1, G + k.h - 14], [k.w / 2 + 1, G + k.h - 4], [0, G + k.h - 2]], 6, { flat: true });
      solids.solid(prismPolys(k.x, k.z, k.w / 2 + 4, 6, G - 4, G + k.h), 'stone');
      continue;
    }
    const top = G + k.h;
    if (k.foot) paint.color(k.foot).solid(orientedBoxPolys([k.x, 0, k.z], [ux, 0, uz], k.w + 10, G - 4, G + 10, k.d + 10));
    paint.color(k.tint);
    paint.solid(orientedBoxPolys([k.x, 0, k.z], [ux, 0, uz], k.w, G + (k.foot ? 10 : 0), top, k.d), { faceShade: (n) => (n[1] > 0.5 ? 1.08 : 0.92) });
    // (A gabled lid: a slab over it, a ridge along it.)
    if (k.gable) {
      paint.solid(orientedBoxPolys([k.x, 0, k.z], [ux, 0, uz], k.w + 4, top, top + 5, k.d + 4));
      paint.solid(orientedBoxPolys([k.x, 0, k.z], [ux, 0, uz], k.w + 2, top + 5, top + 12, k.d * 0.45));
    }
    solids.solid(orientedBoxPolys([k.x, 0, k.z], [ux, 0, uz], k.w + 10, G - 4, top, k.d + 10), 'stone');
  }
  const P = PLATE;
  const l = layout.LAMPS.find((p) => p.id === P.lamp);
  paint.color(TINT.plateBack);
  paint.solid(orientedBoxPolys([l.x + P.out * (layout.LAMP.r + 2), 0, l.z], [0, 0, 1], P.w, G + P.y0, G + P.y0 + P.h, 3));
  paint.color(TINT.white);
  paint.solid(orientedBoxPolys([l.x + P.out * (layout.LAMP.r + 4), 0, l.z], [0, 0, 1], P.w - 6, G + P.y0 + 3, G + P.y0 + P.h - 3, 1));
}

// The turning area's sign at the bed's corner by the asphalt (TURN_SIGN): a grey post, the plate
// on its street side (a grey back, its face as world/lane/real/sign.js lays it out: the red rim
// on yellow, "Vänd-" over "plats", the round no-parking sign), the small blank blue plate under
// it; solid: a thin prism up the post.
function turnSign(kit, layout) {
  const { paint, solids } = kit.drawn('posts');
  const S = layout.TURN_SIGN;
  const P = S.plate;
  const y0 = layout.groundHeight(S.x, S.z);
  paint.color(TINT.lamp);
  paint.lathe(S.x, S.z, [[S.r + 1.5, y0 - 10], [S.r, y0 + 20], [S.r, S.top], [0, S.top + 2]], 8, { flat: true });
  const f = [Math.sin(S.yaw), 0, Math.cos(S.yaw)];
  const [rx, rz] = [Math.cos(S.yaw), -Math.sin(S.yaw)];
  const out = S.r + 2.5;
  const at = (u, v, d) => [S.x + f[0] * (out + d) + rx * (u - P.w / 2), P.y0 + v, S.z + f[2] * (out + d) + rz * (u - P.w / 2)];
  paint.color(TINT.signBack);
  paint.solid(orientedBoxPolys([S.x + f[0] * (out - 0.8), 0, S.z + f[2] * (out - 0.8)], f, 1.6, P.y0, P.y0 + P.h, P.w));
  for (const v of [12, P.h - 12]) paint.solid(orientedBoxPolys([S.x + f[0] * (out / 2), 0, S.z + f[2] * (out / 2)], f, out, P.y0 + v - 3, P.y0 + v + 3, 12));
  for (const { color, layer, poly } of signFace(P)) {
    paint.color(color);
    paint.poly(poly.map(([u, v]) => at(u, v, 0.15 + 0.15 * layer)), { facing: f });
  }
  // The small blank blue plate under it (W3).
  if (S.sub) {
    const [v0, v1] = [S.sub.y0 - P.y0, S.sub.y0 - P.y0 + S.sub.h];
    paint.color(TINT.signBack);
    paint.solid(orientedBoxPolys([S.x + f[0] * (out - 0.8), 0, S.z + f[2] * (out - 0.8)], f, 1.6, S.sub.y0, S.sub.y0 + S.sub.h, P.w));
    paint.color(TINT.sign);
    paint.poly([at(2, v0 + 2, 0.15), at(P.w - 2, v0 + 2, 0.15), at(P.w - 2, v1 - 2, 0.15), at(2, v1 - 2, 0.15)], { facing: f });
  }
  solids.solid(prismPolys(S.x, S.z, S.collider, 8, y0 - 10, S.top), 'stone');
}

// A white flagpole tapering to a gold knob (a climbable pole: no collider of its own), its flag
// or pennant (kit.cloth, seen from both sides) streaming from just under the knob along WIND.
function flagpole(kit, layout, f) {
  const { cloth } = kit;
  const { paint } = kit.drawn('posts');
  const { FLAGPOLE: F, WIND } = layout;
  const { x, z, y0 } = f;
  const top = y0 + (f.h ?? F.h);
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
    reach[i] = ((f.limp ?? 1) * WIND.amp * u) / FLAG_REACH;
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

// A wheelie bin (W4: the photos' big four-compartment kind): a dark body, its lid a little wider
// on top and split front and back, the handle and two wheels at its back toward the street (-z);
// solid to its lid's top. The bins move (objects/laneBoss/LaneBins.js), so the first one is drawn
// once in its own frame (origin at its foot's middle, -z the handle side) into the movers' kit
// (kit.mover('bins'): lane/build.js draws it once per bin, instanced, each at home until moved);
// each one's collider is named (bin_0, bin_1: LaneBins moves it in place).
function bin(kit, layout, { x, z }, i) {
  const { BIN, GROUND } = layout;
  const [hx, hz] = [BIN.x / 2, BIN.z / 2];
  if (i === 0) {
    const paint = kit.drawn('bins').mover('bins');
    const h = BIN.top - GROUND;
    paint.color(TINT.bin);
    paint.box(-hx + 4, hx - 4, 0, h - 10, -hz + 6, hz, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
    for (const [z0, z1] of [[-hz - 4, -1.5], [1.5, hz]]) paint.box(-hx, hx, h - 10, h, z0, z1, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
    paint.color(0x111111);
    paint.box(-hx + 16, hx - 16, h - 30, h - 22, -hz - 10, -hz - 4);
    for (const s of [-1, 1]) paint.box(s * (hx - 20) - 8, s * (hx - 20) + 8, 0, 26, -hz - 6, -hz + 16);
  }
  kit.solids.named(`bin_${i}`).box(x - hx, x + hx, GROUND, BIN.top, z - hz, z + hz, 'stone');
}

// ---------------------------------------------------------------- greenery

// A hedge: a leafy box, darker toward its foot, a soft crown along its top; solid, its top
// walkable (flat).
function hedge(kit, h, layout) {
  const { leaves, render, solids } = kit.drawn('plants');
  const { x0, x1, z0, z1, y0, top } = h;
  const foot = h.foot ?? y0; // (W6: north_2's drawn from its bed wall's top, under its collider's foot)
  leaves.color(TINT.hedge);
  leaves.shade = (x, y) => 0.75 + 0.25 * Math.min(1, (y - foot) / Math.max(1, top - foot));
  leaves.box(x0, x1, foot - 4, top, z0, z1, { bottom: false, top: false });
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
  // (An informal one, south_1's (W5): sprigs over its walkable top, up to `informal` higher, lumpy
  // along its face, the fallen leaves on the asphalt at its foot.)
  if (!h.informal) return;
  const rng = makeRng(Math.round(x0));
  for (let x = x0 + 40; x < x1 - 30; x += 110 + rng() * 60) {
    leaves.color(TINT.hedge, 0.92 + rng() * 0.2);
    blob(leaves, x, z0 + (z1 - z0) * (0.3 + rng() * 0.4), top + h.informal * (0.2 + rng() * 0.45), 45 + rng() * 25, h.informal * 0.7, rng() * 6, 5);
  }
  // (On the asphalt's bevelled edge up to the hedge, and a little way out over the road: where it
  // stands at the asphalt's edge.)
  if (z0 !== layout.SOUTH_EDGE) return;
  render.color(TINT.soil, 0.85); // (W5 fix: the photos' dark brown, not a brick-red kerb)
  const e = z0 - BEVEL;
  render.poly([[x0, 0.7, e - 14], [x1, 0.7, e - 14], [x1, 0.9, e], [x0, 0.9, e]], { facing: [0, 1, 0] });
  render.poly([[x0, 0.9, e], [x1, 0.9, e], [x1, y0 + 0.6, z0], [x0, y0 + 0.6, z0]], { facing: [0, 1, -1] });
}

// A hedge along a line (W8, lane/ends.js LINE_HEDGES): a leafy box along it, darker toward its
// foot, its clipped top a shade lighter; solid, its top walkable.
function lineHedge(kit, h) {
  const { leaves, solids } = kit.drawn('plants');
  const [a, b] = [h.from, h.to];
  const d = [b[0] - a[0], 0, b[1] - a[1]];
  const len = Math.hypot(d[0], d[2]);
  const c = [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2];
  const y0 = 22;
  leaves.color(LINE_TINT[h.kind]);
  leaves.shade = (x, y) => 0.75 + 0.25 * Math.min(1, (y - y0) / (h.top - y0));
  leaves.solid(orientedBoxPolys(c, d, len, y0 - 4, h.top - 6, h.depth, { bottom: false, top: false }));
  leaves.shade = null;
  leaves.color(LINE_TINT[h.kind], 1.08); // (its clipped top a shade lighter)
  leaves.solid(orientedBoxPolys(c, d, len, h.top - 6, h.top, h.depth, { bottom: false }));
  solids.solid(orientedBoxPolys(c, d, len, y0 - 4, h.top, h.depth), 'grass');
}
const LINE_TINT = { clipped: 0xa8a040, thuja: 0x5a5a2e, beech: 0x8a8238, dark: 0x5e6230 };

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

// A columnar tree far behind the garage row (COLUMN_TREES, out of bounds: drawn only): a tall
// narrow eight-sided column, widest low and slim above (photo 37's poplar), its top a little
// yellower.
function columnTree(kit, layout, { x, z, r, h }) {
  const { leaves } = kit.drawn('plants');
  const y0 = layout.groundHeight(x, z);
  leaves.color(TINT.column);
  leaves.shade = (px, y) => 0.7 + 0.45 * Math.min(1, (y - y0) / h);
  leaves.lathe(x, z, [[r * 0.12, y0], [r * 0.55, y0 + h * 0.16], [r * 0.92, y0 + h * 0.32], [r * 0.92, y0 + h * 0.42], [r * 0.66, y0 + h * 0.58], [r * 0.52, y0 + h * 0.8], [r * 0.32, y0 + h * 0.94], [0, y0 + h]], 8, { a0: 0.4 });
  leaves.shade = null;
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

// A prism round (cx, cz) with radii rx (along x) and rz, `sides` sides, from y0 to y1.
function ellipsePrism(cx, cz, rx, rz, sides, y0, y1) {
  const ring = (y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * rx, y, cz + Math.cos(a) * rz];
  });
  const [lo, hi] = [ring(y0), ring(y1)];
  return [hi, ...lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]])];
}

// One roughly round blob of leaves (a seven-sided lathe): r across, from cy - ry up to cy + ry
// (`plain`: no shoulder under its top, P1: the far ones, a fifth fewer triangles).
function blob(b, x, z, cy, r, ry, a0, sides = 7, plain = false) {
  b.lathe(x, z, [[0, cy - ry], [r * 0.72, cy - ry * 0.68], [r, cy - ry * 0.05], [r * 0.8, cy + ry * 0.6], ...(plain ? [] : [[r * 0.35, cy + ry * 0.95]]), [0, cy + ry]], sides, { a0 });
}

// A lumpy canopy: `n` overlapping blobs round (x, z) between y0 and y1, out to r, into `leaves`
// (the leaf texture's greens; a red one goes into render's plain white, as the green texture
// would darken it to brown), in `tint` (or turn by turn through a list of tints); darker
// underneath. P1 (photos 16, 23, 24, 28): `lobed`, in clumps, not a lollipop: one over the top,
// the others round it at different heights, gaps between them; `gold`: its top gilt (gilt).
function canopy(kit, x, z, y0, y1, r, tint, seed, n = 4, leaves = kit.leaves, { lobed = false, gold = 0, sides = 7 } = {}) {
  const rng = makeRng(seed);
  const h = y1 - y0;
  const tints = [].concat(tint);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const f = i ? (i - 1) / Math.max(1, n - 2) : 1;
    // (A lobe reaches in over the trunk's top: no blob floats, the classic tree has no limbs.)
    const off = i === 0 ? 0 : r * (lobed ? 0.34 + rng() * 0.1 : 0.35 + rng() * 0.2);
    const br = i === 0 ? r * (lobed ? 0.52 : 0.62) : r * (lobed ? 0.44 + rng() * 0.1 : 0.45 + rng() * 0.15);
    const cy = i === 0 ? y0 + h * (lobed ? 0.73 : 0.5) : y0 + h * (lobed ? 0.2 + 0.42 * f : 0.35 + rng() * 0.3);
    const ry = i === 0 ? h * (lobed ? 0.27 : 0.5) : h * (lobed ? 0.2 : 0.32 + rng() * 0.1);
    leaves.color(tints[i % tints.length], 0.9 + rng() * 0.2);
    gilt(leaves, y0, h, gold);
    blob(leaves, x + Math.sin(a) * off, z + Math.cos(a) * off, cy, br, ry, rng() * 6, sides);
  }
  leaves.shade = null;
}

// (P1, photos 04, 05, 12, 13, 23, 24: the low sun gilds the crowns' tops) The shade's ramp up a
// crown from y0 over h, its tint turned toward GOLD over the upper part (from 0.55 of its height
// to its top, by k): the builder reads its tint after the shade, so the shade sets it.
const GOLD = 0xd8a030;
function gilt(leaves, y0, h, k, lo = 0.68, span = 0.36) {
  const base = leaves.tint;
  const gold = k && leaves.color(GOLD).tint;
  leaves.tint = base;
  leaves.shade = (px, y) => {
    const f = Math.min(1, Math.max(0, (y - y0) / h));
    const m = k * Math.max(0, (f - 0.55) / 0.45);
    if (k) leaves.tint = base.map((c, i) => c + (gold[i] - c) * m);
    return lo + span * f;
  };
}

// A big broad-leaved tree off the junction: a stout trunk (solid where Jonas can reach it) under
// a lumpy canopy.
function broadTree(kit, layout, t) {
  const drawn = kit.drawn('plants');
  const { wood, solids } = drawn;
  const y0 = layout.groundHeight(t.x, t.z);
  const trunkTop = y0 + t.h * 0.45;
  wood.color(TINT.trunk);
  wood.lathe(t.x, t.z, [[60, y0 - 10], [45, y0 + 120], [38, trunkTop], [0, trunkTop]], 7, { flat: true });
  // (P1: in lobes, gilt; the west curve's, photos 01-03, plainer: four six-sided lobes.)
  canopy(drawn, t.x, t.z, y0 + t.h * (t.low ?? 0.32), y0 + t.h, t.r, TINT.canopy, Math.round(t.x * 7 + t.z), 4, drawn.leaves, { lobed: true, gold: 0.7, sides: layout.TREES.indexOf(t) > 1 ? 6 : 7 });
  if (layout.inBounds(t.x, t.z)) solids.solid(prismPolys(t.x, t.z, 45, 8, y0 - 10, trunkTop), 'wood');
}

// A garden tree (GARDEN_TREES): the apple tree (a short trunk under a broad canopy hung with red
// apples), the birch (white bark ringed dark under a tall yellowing canopy), a broadleaf or a
// cherry, or the Virginia creeper on its pergola (W8); trunks and the pergola's post solid.
function gardenTree(kit, layout, t) {
  const drawn = kit.drawn('plants');
  const { wood, render, paint, solids } = drawn;
  const y0 = layout.groundHeight(t.x, t.z);
  if (t.kind === 'birch') {
    // (W7: the big one's three stems leaning out from one foot under one broad crown.)
    const stems = t.stems ?? 1;
    for (let k = 0; k < stems; k++) {
      const a = (k / stems) * Math.PI * 2 + 0.6;
      const lean = stems > 1 ? 0.07 : 0;
      birchTrunk(drawn, t.x, t.z, y0, t.h * (1 - k * 0.06), t.r * 0.8, [Math.sin(a) * lean, Math.cos(a) * lean]);
    }
    canopy(drawn, t.x, t.z, y0 + t.h * 0.36, y0 + t.h, t.r, TINT.birch, 7, stems > 1 ? 5 : 4);
    solids.solid(prismPolys(t.x, t.z, stems > 1 ? 45 : 30, 6, y0 - 10, y0 + t.h * 0.6), 'wood');
    return;
  }
  if (t.kind === 'broad' || t.kind === 'cherry') {
    // The side yard's round broadleaf; the cherry's grey trunk forking low into leaning limbs
    // under a broad open crown, yellow-green with orange tips (W7).
    const cherry = t.kind === 'cherry';
    const fork = y0 + (cherry ? 195 : t.h * 0.4);
    wood.color(cherry ? TINT.redTrunk : TINT.trunk);
    wood.lathe(t.x, t.z, [[cherry ? 22 : 30, y0 - 10], [cherry ? 18 : 24, fork], [0, fork + 20]], 6, { flat: true });
    if (cherry) {
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + 0.4;
        wood.solid(beamPolys([t.x, fork - 10, t.z], [t.x + Math.sin(a) * t.r * 0.55, y0 + t.h * 0.62, t.z + Math.cos(a) * t.r * 0.55], [Math.cos(a), 0, -Math.sin(a)], 14, 14));
      }
    }
    canopy(drawn, t.x, t.z, y0 + t.h * (cherry ? 0.5 : 0.3), y0 + t.h, t.r, cherry ? TINT.cherry : TINT.oak, Math.round(t.x + t.z), 4, drawn.leaves, { lobed: !cherry, gold: 0.5 });
    solids.solid(prismPolys(t.x, t.z, cherry ? 30 : 36, 6, y0 - 10, fork), 'wood');
    return;
  }
  if (t.kind === 'creeper') {
    // (W8: the pergola's dark beam on its post, the creeper's red leaves hanging from it; round
    // 2, photo 29 and jD: as strands of leaves of uneven length with gaps between them, not
    // sheets; drawn only, the post solid.)
    const [a, b] = [t.from, t.to];
    wood.color(0x3a2a20);
    wood.solid(beamPolys([a[0], t.top, a[1]], [b[0], t.top, b[1]], [0, 1, 0], 14, 14));
    const post = beamPolys([b[0], y0 - 4, b[1]], [b[0], t.top + 7, b[1]], [1, 0, 0], 12, 12);
    wood.solid(post);
    solids.solid(post, 'wood'); // (W8 fix: its post solid, in the walkable garden)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [(b[1] - a[1]) / len, (a[0] - b[0]) / len];
    // (Twelve strands, each a thin three-sided column of leaf clumps (its profile beaded),
    // 120..330 long: a ragged bottom.)
    for (let k = 0; k < 12; k++) {
      const q = (k + 0.5 + 0.3 * Math.sin(k * 2.7)) / 12;
      const s = 7 * Math.sin(k * 1.9);
      const [x, z] = [a[0] + (b[0] - a[0]) * q + n[0] * s, a[1] + (b[1] - a[1]) * q + n[1] * s];
      const L = 120 + ((k * 71) % 211);
      const r = 17 + ((k * 7) % 9);
      const y = (f) => t.top - 4 - L * f;
      render.color(TINT.shrub[k % 2], 0.8 + 0.12 * (k % 3));
      render.lathe(x, z, [[0, y(1)], [r * 0.75, y(0.9)], [r * 0.45, y(0.72)], [r, y(0.55)], [r * 0.5, y(0.36)], [r * 0.9, y(0.18)], [0, y(0)]], 3, { flat: true, a0: k });
    }
    return;
  }
  // The apple tree.
  const top = y0 + t.h;
  const c0 = y0 + t.h * 0.35;
  wood.color(TINT.trunk);
  wood.lathe(t.x, t.z, [[40, y0 - 10], [32, y0 + 100], [26, c0 + 80], [0, c0 + 100]], 7, { flat: true });
  canopy(drawn, t.x, t.z, c0 - t.h * 0.05, top, t.r, TINT.apple, 211, 5, drawn.leaves, { lobed: true });
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

// A birch's trunk (a garden's): white bark with dark rings, slender, leaning `lean` (dx, dz a unit
// up) under its canopy.
function birchTrunk(kit, x, z, base, h, r, lean = [0, 0]) {
  const { wood } = kit;
  const t = r * 0.1;
  wood.color(TINT.bark);
  const ring = (k) => [[t * (1 - k * 0.4), base + h * k, 1], [t * (1 - k * 0.4), base + h * k, 0.45], [t * (1 - k * 0.4), base + h * (k + 0.03), 0.45], [t * (1 - k * 0.4), base + h * (k + 0.03), 1]];
  const before = wood.pos.length;
  wood.lathe(x, z, [[t * 1.1, base - 10, 1], ...ring(0.18), ...ring(0.4), ...ring(0.58), [t * 0.5, base + h * 0.85], [0, base + h * 0.86]], 6, { flat: true });
  // (Leant: each vertex out by its height over the foot.)
  if (lean[0] || lean[1]) for (let i = before; i < wood.pos.length; i += 3) {
    const up = wood.pos[i + 1] - base;
    wood.pos[i] += lean[0] * up;
    wood.pos[i + 2] += lean[1] * up;
  }
}

// The dad's front garden (W3): the red-leaf bed (BED: fallen russet leaves on its soil, a
// little step up, round field stones along all four edges: real/plan.js bedStones), the
// red-leaf tree in its middle (its trunk the climbable pole, forking into four leaning stems with
// their branches, a wide open crown of small blobs in dark purple-reds and browns with gaps
// between them, drawn in render, open over the trunk's top where Jonas stands on it; no
// collider), the rhododendron out from the west pier (a dark green dome, longer across the lawn,
// solid), the ivy mound over the north-east pier (dark green blobs, drawn only), the rose on its
// stakes beside the mailbox (drawn only), the concrete landing at the door (solid: a step up) with
// the blue pot on it, and the car charger on the east gable.
function dadsGarden(kit, layout) {
  const { render, paint, solids } = kit;
  const { leaves, render: crown, paint: pot } = kit.drawn('plants');
  const { RED_TREE: T, RHODODENDRON: R, POT: P, DAD, GROUND, BED: B, LANDING: Lg } = layout;
  const bedTop = GROUND + B.raise;
  const outline = layout.bedOutline();
  render.color(TINT.litter);
  render.poly(outline.map(([x, z]) => [x, bedTop, z]), { facing: [0, 1, 0] });
  // Its soil's sides over the lawn, the path and the drive (along the street, its first edge, the
  // kerbs' run draws it).
  render.color(TINT.soil);
  const [cx, cz] = [(B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2];
  for (let i = 1; i < outline.length; i++) {
    const [[x, z], [x2, z2]] = [outline[i], outline[(i + 1) % outline.length]];
    render.poly([[x, GROUND - 2, z], [x2, GROUND - 2, z2], [x2, bedTop, z2], [x, bedTop, z]], { facing: [(x + x2) / 2 - cx, 0, (z + z2) / 2 - cz] });
  }
  const rng = makeRng(331);
  for (let i = 0; i < 40; i++) {
    // A fallen leaf or two: small russet flecks over the bed.
    const [x, z, s] = [B.x0 + rng() * (B.x1 - B.x0), B.z0 + rng() * (B.z1 - B.z0), 14 + rng() * 10];
    if (!layout.inBed(x - s, z) || !layout.inBed(x + s, z)) continue;
    render.color(TINT.redLeaf[i % TINT.redLeaf.length], 1.1);
    render.poly([[x - s, bedTop + 3, z], [x, bedTop + 3, z - s * 0.6], [x + s, bedTop + 3, z], [x, bedTop + 3, z + s * 0.6]], { facing: [0, 1, 0] });
  }
  const stones = kit.drawn('plants').blocks;
  for (const st of bedStones(layout)) {
    stones.color(st.pink ? TINT.pinkStone : TINT.stones, st.k);
    stones.lathe(st.x, st.z, [[st.s, st.y], [st.s * 1.05, st.y + st.s * 0.5], [st.s * 0.6, st.y + st.s], [0, st.y + st.s * 1.1]], 6, { flat: true, a0: st.a });
  }
  const top = outline.map(([x, z]) => [x, bedTop, z]);
  solids.solid([top, ...outline.map(([x, z], i) => {
    const [x2, z2] = outline[(i + 1) % outline.length];
    return [[x, GROUND - 10, z], [x2, GROUND - 10, z2], [x2, bedTop, z2], [x, bedTop, z]];
  })], 'grass');
  // The tree: the trunk, its four stems from the fork leaning out and up into the crown, a
  // branch off each.
  // (Its pale grey bark in the render's builder: the wood texture's browns under any tint read
  // dark brown.)
  const C = T.canopy;
  crown.color(TINT.redTrunk);
  // (Slim, about 21 at the foot inside the pole's 28; rounded off at the pole's top, where Jonas
  // stands: W3 fix, P2 slimmer.)
  crown.lathe(T.x, T.z, [[T.radius - 7, bedTop - 4], [T.radius - 10, bedTop + 60], [T.radius - 16, T.trunkTop], [7, T.trunkTop + 15], [0, T.y1]], 7, { flat: true });
  for (const [x, y, z, w] of redTreeStems(T)) {
    const l = Math.hypot(x - T.x, z - T.z);
    crown.solid(beamPolys([T.x, GROUND + T.fork, T.z], [x, y, z], [(z - T.z) / l, 0, (T.x - x) / l], w, w));
  }
  // The crown: small blobs in a vase over the stems (gaps between them: it is sparse), in
  // red-browns and an orange, darker underneath; five-sided, like the ivy's and the rose's (the
  // classic look's few hundred triangles for the garden).
  crown.shade = (px, y) => 0.62 + 0.42 * Math.min(1, Math.max(0, (y - C.y0) / (C.y1 - C.y0)));
  redTreeCrown(T).forEach(({ c, r }, i) => {
    crown.color(TINT.redLeaf[i % TINT.redLeaf.length], 0.92 + (i % 3) * 0.06);
    blob(crown, c[0], c[2], c[1], r[0] * 0.8, r[1] * 0.85, i * 2.1, 5);
  });
  crown.shade = null;
  // The rhododendron (P2, photos 19, 41): two cones along it (it is longer across the lawn), an
  // olive green, solid in two steps (eight-sided prisms a little inside it: the wide foot to 0.4
  // of its height, the top's narrower one to 0.78, the gutter's rim clear over the wall).
  leaves.color(TINT.rhodo);
  leaves.shade = (x, y) => 0.7 + 0.3 * Math.min(1, (y - GROUND) / R.h);
  for (const k of [-1, 1]) {
    const [r, z] = [R.rx, R.z + k * (R.rz - R.rx) * 0.8];
    leaves.lathe(R.x, z, [[r * 0.85, GROUND - 6], [r, GROUND + R.h * 0.25], [r * 0.78, GROUND + R.h * 0.5], [r * 0.45, GROUND + R.h * 0.8], [0, GROUND + R.h]], 8, { a0: 0.3 + k });
  }
  leaves.shade = null;
  solids.solid(ellipsePrism(R.x, R.z, R.rx * 0.85, R.rz * 0.8, 8, GROUND - 6, GROUND + R.h * 0.4), 'grass');
  solids.solid(ellipsePrism(R.x, R.z - R.rz * 0.08, R.rx * 0.5, R.rz * 0.4, 8, GROUND + R.h * 0.35, GROUND + R.h * 0.78), 'grass');
  // The ivy over the north-east pier and round the corner (P2: a dark sheet up to the gutter).
  const I = layout.IVY;
  leaves.color(TINT.ivy);
  leaves.shade = (x, y) => 0.55 + 0.4 * Math.min(1, (y - GROUND) / I.h);
  // (Each mass one blob squashed to its own depth and width: a sheet on the wall, not a ball
  // through it.)
  ivyMasses(layout).forEach(({ c, r }, i) => {
    const at = leaves.pos.length;
    const big = Math.max(r[0], r[2]);
    blob(leaves, c[0], c[2], c[1], big, r[1], i * 2, 5);
    for (let k = at; k < leaves.pos.length; k += 3) {
      leaves.pos[k] = c[0] + ((leaves.pos[k] - c[0]) * r[0]) / big;
      leaves.pos[k + 2] = c[2] + ((leaves.pos[k + 2] - c[2]) * r[2]) / big;
    }
  });
  leaves.shade = null;
  // The rose beside the mailbox: three thin dark stakes, a sparse yellow-green bush on them.
  const Ro = layout.ROSE;
  pot.color(TINT.stake);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const [x, z] = [Ro.x + Math.sin(a) * Ro.r * 0.55, Ro.z + Math.cos(a) * Ro.r * 0.55];
    pot.box(x - 1.5, x + 1.5, GROUND, GROUND + Ro.h, z - 1.5, z + 1.5, { bottom: false });
  }
  leaves.color(TINT.rose);
  blob(leaves, Ro.x - 12, Ro.z, GROUND + Ro.h * 0.7, Ro.r * 0.7, Ro.h * 0.26, 1.2, 5);
  blob(leaves, Ro.x + 18, Ro.z + 10, GROUND + Ro.h * 0.42, Ro.r * 0.6, Ro.h * 0.22, 2.9, 5);
  // The landing at the door: a concrete slab (solid, its top a step up from the path), a row of
  // cobbles along its front edge.
  paint.color(TINT.landing);
  paint.box(Lg.x0, Lg.x1, GROUND - 2, Lg.top, Lg.z0, Lg.z1 - 1, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.05 : 0.8) });
  paint.color(TINT.stones, 0.9);
  const nc = Math.floor((Lg.x1 - Lg.x0) / 24);
  for (let k = 0; k < nc; k++) {
    const x = Lg.x0 + ((Lg.x1 - Lg.x0) * (k + 0.5)) / nc;
    paint.box(x - 10, x + 10, GROUND, GROUND + 6, Lg.z0 - 13, Lg.z0 - 1, { bottom: false });
  }
  solids.box(Lg.x0, Lg.x1, GROUND - 10, Lg.top, Lg.z0, Lg.z1, 'stone');
  // The blue pot on the landing's east end with a little green plant in it (drawn only).
  pot.color(TINT.pot);
  pot.lathe(P.x, P.z, [[16, Lg.top], [24, Lg.top + 4], [27, Lg.top + 40], [0, Lg.top + 40]], 8, { flat: true });
  leaves.color(TINT.potLeaves);
  leaves.lathe(P.x, P.z, [[22, Lg.top + 38], [32, Lg.top + 58], [22, Lg.top + 80], [0, Lg.top + 90]], 7);
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
  // The gables' bulkhead lamps over the drive (both looks), the climber up the gable's back corner
  // (drawn only: the realistic look's are cards), the steel flue on the east wing's slope.
  for (const l of layout.GABLE_LAMPS) gableLamp(paint, l);
  leaves.color(TINT.climber);
  leaves.shade = (x, y) => 0.6 + 0.4 * Math.min(1, (y - GROUND) / (layout.CLIMBER.top - GROUND));
  // (Each mass a row of round blobs along its longer side: a sheet, not a ball through the wall.)
  climberMasses(layout).forEach(({ c, r }, i) => {
    const [ax, az] = r[0] >= r[2] ? [1, 0] : [0, 1];
    const [lo, hi] = [Math.min(r[0], r[2]) + 6, Math.max(r[0], r[2])];
    const n = Math.max(1, Math.round(hi / lo));
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
      blob(leaves, c[0] + ax * t * (hi - lo), c[2] + az * t * (hi - lo), c[1], lo, r[1], i * 1.7 + k, 5);
    }
  });
  leaves.shade = null;
  const Fl = layout.FLUE;
  const W = layout.DAD_WINGS[1];
  const foot = W.ridge - (Math.abs(Fl.x - W.cx) * (W.ridge - W.eave)) / (W.d / 2);
  const cap = foot + Fl.h;
  paint.color(TINT.flue);
  paint.lathe(Fl.x, Fl.z, [[Fl.r, foot - 24], [Fl.r, cap - 12], [Fl.cap, cap - 12], [Fl.cap, cap - 6], [Fl.cap * 0.5, cap + 4], [0, cap + 6]], 8);
}

// The planted strips behind the terraces' low bed walls (W6: facades.js bedSpots, a plant every
// ~140): lumpy blobs, leafy greens and dark yews in leaves, the purple heucheras in render's plain
// white (the leaf texture would brown them), tan grass plumes tall and narrow; a rose a low green
// mound with three small deep pink flowers on it (round 2: not a pink ball).
const BED_TINTS = [0x8aa040, 0x4a5a2a, 0xb09868, 0x7a3a4a, 0x5e7a34];
function beds(kit, layout) {
  const { leaves, render } = kit.drawn('plants');
  for (const p of bedSpots(layout, terraceSpans(layout), 140)) {
    const b = p.kind === 3 ? render : leaves;
    b.color(BED_TINTS[p.kind]);
    const [r, ry] = [[36, 26], [40, 52], [22, 62], [28, 16], [34, 18]][p.kind];
    const cy = p.y + ry * p.s * 0.7;
    blob(b, p.x, p.z, cy, r * p.s, ry * p.s, p.x * 0.01, 5);
    if (p.kind !== 4) continue;
    render.color(0xc23a62);
    for (let i = 0; i < 3; i++) {
      const a = p.x * 0.013 + i * 2.1;
      const [d, y] = [r * p.s * (i ? 0.8 : 0.1), cy + ry * p.s * (i ? 0.6 : 0.98)]; // (on the mound's skin)
      render.lathe(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, [[0, y - 7], [7, y], [0, y + 7]], 4, { flat: true, a0: a });
    }
  }
}

// The neighbours' things (W5): the young beech hedge west of south_1's (single stems on bamboo
// canes in a strip of dark soil, a few leaves up each: drawn only), the link's two black bins
// (box colliders), the mailboxes (MAILBOXES: drawn only), south_2's front garden: its flush
// edging and its raised bed of grey blocks (a step up: solid), the bed west of its path edged with
// blocks, the rhododendron and the round yew (solid), dwarf conifers and hostas.
function neighbours(kit, layout) {
  const { GROUND: G, BEECH_ROW: B, LINK_BIN: K, S2_GARDEN: S } = layout;
  const { leaves, render, paint: pp, solids } = kit.drawn('plants');
  render.color(TINT.soil, 0.8);
  render.poly([[B.x0, G + 0.8, B.soil[0]], [B.x1, G + 0.8, B.soil[0]], [B.x1, G + 0.8, B.soil[1]], [B.x0, G + 0.8, B.soil[1]]], { facing: [0, 1, 0] });
  const rng = makeRng(611);
  for (let x = B.x0 + 20; x < B.x1; x += B.step) {
    const z = B.z + (rng() - 0.5) * 16;
    const h = B.h * (0.85 + rng() * 0.25);
    pp.color(TINT.trunk);
    pp.box(x - 2, x + 2, G, G + h, z - 2, z + 2, { bottom: false });
    pp.color(0xd8c890);
    pp.box(x + 4, x + 6, G, G + h * 0.9, z - 1, z + 1, { bottom: false });
    leaves.color(TINT.apple, 0.9 + rng() * 0.2);
    for (const k of [0.45, 0.8]) blob(leaves, x + (rng() - 0.5) * 14, z, G + h * k, 20 + rng() * 8, h * 0.16, rng() * 6, 5);
  }
  // The link's bins (their backs to the wall), solid.
  const { paint: bp, solids: bs } = kit.drawn('bins');
  for (const b of layout.LINK_BINS) {
    const [hx, hz, y1] = [K.x / 2, K.z / 2, G + K.h];
    bp.color(TINT.bin);
    bp.box(b.x - hx + 4, b.x + hx - 4, G, y1 - 10, b.z - hz, b.z + hz - 6, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
    bp.box(b.x - hx, b.x + hx, y1 - 10, y1, b.z - hz - 3, b.z + hz + 4, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
    bs.box(b.x - hx, b.x + hx, G, y1, b.z - hz, b.z + hz, 'stone');
  }
  // (W6: north_2's three, turned to its drive; north_3's white picket enclosure, its mailbox.)
  for (const b of layout.VILLA_BINS) {
    // (Turned to their drive, or W7's out on the pavement fronts to the street, yaw 0.)
    const side = Math.abs(Math.sin(b.yaw)) > 0.5;
    const [hx, hz, y1] = side ? [K.z / 2, K.x / 2, G + K.h] : [K.x / 2, K.z / 2, G + K.h];
    bp.color(b.tint ?? TINT.bin);
    if (side) {
      bp.box(b.x - hx + 6, b.x + hx, G, y1 - 10, b.z - hz + 4, b.z + hz - 4, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
      bp.box(b.x - hx - 3, b.x + hx + 4, y1 - 10, y1, b.z - hz, b.z + hz, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
    } else {
      bp.box(b.x - hx + 4, b.x + hx - 4, G, y1 - 10, b.z - hz + 6, b.z + hz, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.1 : 0.9) });
      bp.box(b.x - hx, b.x + hx, y1 - 10, y1, b.z - hz - 3, b.z + hz + 4, { faceShade: (n) => (n[1] > 0.5 ? 1.15 : 0.8) });
    }
    bs.box(b.x - hx, b.x + hx, G, y1, b.z - hz, b.z + hz, 'stone');
  }
  const N = layout.ENCLOSURE;
  bp.color(0xeeece6);
  bp.box(N.x0, N.x1, G, N.top, N.z0, N.z1, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.05 : 0.92) });
  bp.color(0x9a9890);
  for (let x = N.x0 + 9; x < N.x1 - 4; x += 11) bp.box(x, x + 3, G + 12, N.top - 8, N.z1, N.z1 + 0.6, { bottom: false });
  bp.color(0xc8ced2);
  bp.box((N.x0 + N.x1) / 2 - 22, (N.x0 + N.x1) / 2 + 22, N.top - 95, N.top - 15, N.z1, N.z1 + 30);
  bs.box(N.x0, N.x1, G, N.top, N.z0, N.z1, 'wood');
  // The mailboxes.
  const { paint: mp } = kit.drawn('mailbox');
  for (const m of layout.MAILBOXES) {
    mp.color(0x18191b);
    if (m.wall) {
      const f = frame(layout.HOUSES.find((h) => h.id === m.house)).face('front').frame;
      mp.solid(localBoxPolys(f, m.u - m.w / 2, m.u + m.w / 2, m.v, m.v + m.h, 2, 2 + m.d), { faceShade: (n) => (n[1] > 0.5 ? 1.2 : 1) });
      continue;
    }
    mp.box(m.x - 3, m.x + 3, m.y0 ?? G, m.top - m.h, m.z - 3, m.z + 3, { bottom: false });
    mp.color(m.tint ?? 0x18191b);
    mp.box(m.x - m.w / 2, m.x + m.w / 2, m.top - m.h, m.top - (m.lid ? 6 : 0), m.z - m.d / 2, m.z + m.d / 2);
    if (m.lid) {
      mp.color(m.lid);
      mp.box(m.x - m.w / 2 - 2, m.x + m.w / 2 + 2, m.top - 6, m.top, m.z - m.d / 2 - 2, m.z + m.d / 2 + 2);
    }
  }
  // south_2's garden: the edging (flush, a touch over the gravel), the raised bed and the bed's
  // block edging; the ground cover on the raised bed and the bed's soil.
  const { blocks } = kit;
  blocks.color(TINT.kerb, 0.95);
  const E = S.edging;
  blocks.box(E.x0, E.x1, G - 3, G + 1.2, E.z, E.z + E.w, { bottom: false });
  const R = S.raised;
  blocks.color(0xa8a6a2);
  blocks.box(R.x0, R.x1, G - 3, R.top, R.z0, R.z1, { bottom: false, top: false });
  solids.box(R.x0, R.x1, G - 10, R.top, R.z0, R.z1, 'stone', { bottom: false });
  const D = S.bed;
  render.color(TINT.soil);
  for (const [x0, x1, z0, z1, y] of [[R.x0 + 14, R.x1 - 14, R.z0 + 14, R.z1 - 14, R.top - 2], [D.x0, D.x1, D.z0, D.z1, G + 3]]) render.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], { facing: [0, 1, 0] });
  // (A rim of blocks round each: the raised bed's on its top, the bed's 10 over the gravel.)
  for (const [B2, w, y0, y1] of [[R, 14, R.top - 2, R.top], [D, 12, G - 2, G + 10]]) {
    for (const [x0, x1, z0, z1] of [[B2.x0, B2.x1, B2.z0, B2.z0 + w], [B2.x0, B2.x1, B2.z1 - w, B2.z1], [B2.x0, B2.x0 + w, B2.z0, B2.z1], [B2.x1 - w, B2.x1, B2.z0, B2.z1]]) blocks.box(x0, x1, y0, y1, z0, z1, { bottom: false });
  }
  // (W5 fix: the soil beds in the slabs east of the path, the rhododendron's rimmed with blocks
  // on its street and path sides.)
  render.color(TINT.soil, 0.9);
  for (const [x0, x1, z0, z1, rim] of S.beds) {
    render.poly([[x0, G + 1.5, z0], [x1, G + 1.5, z0], [x1, G + 1.5, z1], [x0, G + 1.5, z1]], { facing: [0, 1, 0] });
    if (rim) for (const [a, b, c, d] of [[x0, x1, z0, z0 + 12], [x0, x0 + 12, z0, z1]]) blocks.box(a, b, G - 2, G + 8, c, d, { bottom: false });
  }
  const gr = makeRng(613);
  for (let i = 0; i < 14; i++) {
    leaves.color(TINT.tuft, 0.7 + gr() * 0.25);
    blob(leaves, R.x0 + 60 + gr() * (R.x1 - R.x0 - 120), R.z0 + 60 + gr() * (R.z1 - R.z0 - 120), R.top + 14, 60 + gr() * 30, 22, gr() * 6, 5);
  }
  // The shrubs: the rhododendron (two domes, as the dad's) and the yew, solid; conifers, hostas.
  const Rh = S.rhododendron;
  leaves.color(TINT.rhodo);
  leaves.shade = (x, y) => 0.7 + 0.3 * Math.min(1, (y - G) / Rh.h);
  for (const k of [-1, 1]) leaves.lathe(Rh.x + k * (Rh.rx - Rh.rz) * 0.8, Rh.z, [[Rh.rz * 0.85, G - 6], [Rh.rz, G + Rh.h * 0.35], [Rh.rz * 0.8, G + Rh.h * 0.8], [Rh.rz * 0.3, G + Rh.h], [0, G + Rh.h + 6]], 8, { a0: 0.3 + k });
  const Y = S.yew;
  leaves.color(TINT.thuja, 0.9);
  blob(leaves, Y.x, Y.z, G + Y.h / 2, Y.r, Y.h / 2, 0.4, 8);
  leaves.shade = null;
  solids.solid(ellipsePrism(Rh.x, Rh.z, Rh.rx * 0.85, Rh.rz * 0.85, 8, G - 6, G + Rh.h * 0.85), 'grass');
  solids.solid(prismPolys(Y.x, Y.z, Y.r * 0.8, 8, G - 6, G + Y.h * 0.85), 'grass');
  for (const c of S.conifers) {
    const y0 = c.x > R.x0 && c.x < R.x1 && c.z > R.z0 && c.z < R.z1 ? R.top : G;
    leaves.color(TINT.thuja);
    leaves.lathe(c.x, c.z, [[c.r, y0], [c.r * 0.9, y0 + c.h * 0.4], [c.r * 0.4, y0 + c.h * 0.85], [0, y0 + c.h]], 6, { a0: c.x });
  }
  for (const [x, z] of S.hostas) {
    leaves.color(0xb8c048);
    blob(leaves, x, z, G + 18, 34, 18, x * 0.01, 6);
  }
}

// A round black bulkhead lamp on a wall (GABLE_LAMPS): a ring standing 9 out of the wall round a
// pale glass, two bars of its cage across it.
function gableLamp(b, { x, y, z, out, white }) {
  const f = wallFrame([x, 0, z], [out, 0, 0]);
  const k = white ? 1.5 : 1; // (south_1's white one bigger: W5)
  const ring = (r) => Array.from({ length: 10 }, (_, i) => [Math.sin((i / 10) * Math.PI * 2) * r * k, y + Math.cos((i / 10) * Math.PI * 2) * r * k]);
  b.color(white ? TINT.white : TINT.lampBody);
  b.moulding(f, ring(11), ring(16), 9, { closed: true });
  b.color(white ? 0xe4dcc0 : TINT.lampGlass);
  b.panel(f, ring(11), 6);
  b.color(white ? TINT.white : TINT.lampBody);
  if (!white) for (const dv of [-4.5, 4.5]) b.panel(f, [[-11, y + dv - 1.2], [11, y + dv - 1.2], [11, y + dv + 1.2], [-11, y + dv + 1.2]], 7);
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

// The dad's mailbox (W3): one anthracite pedestal box standing on the lawn, a gable lid
// overhanging it (its gable toward the street), at the street end the letter flap under the lid,
// a blank plate in the gable, the lower door with its lock; the little blue sparrow standing on
// its ridge at the street end; solid to its eaves (a coin waits over its roof).
function mailbox(kit, layout) {
  const { paint, solids } = kit.drawn('mailbox');
  const { MAILBOX: M, GROUND } = layout;
  const [bw, bd] = M.body;
  const f = frame({ cx: M.x, cz: M.z, yaw: M.yaw, w: bw, d: bd, y0: GROUND });
  const y1 = GROUND + M.post;
  paint.color(TINT.mailbox);
  if (M.post > 0) paint.solid(localBoxPolys(wallFrame(f.at(0, GROUND, 0), f.dir(0, 0, 1)), -7, 7, 0, M.post, -7, 7, { bottom: false }));
  const box = [f.at(-bw / 2, 0, bd / 2), f.at(bw / 2, 0, bd / 2), f.at(bw / 2, 0, -bd / 2), f.at(-bw / 2, 0, -bd / 2)];
  const at = (p, y) => [p[0], y, p[2]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const out = [box[i][0] + box[j][0] - 2 * M.x, 0, box[i][2] + box[j][2] - 2 * M.z];
    paint.poly([at(box[i], y1), at(box[j], y1), at(box[j], M.eaves), at(box[i], M.eaves)], { facing: out, shade: i === 0 ? 1 : 0.85 });
  }
  if (M.post > 0) paint.poly(box.map((p) => at(p, y1)), { facing: [0, -1, 0], shade: 0.5 });
  // The lid: its ridge running from the street end to the back, overhanging 8 all round, the
  // gable ends the box's.
  const ov = 8;
  const r0 = f.at(0, M.ridge, bd / 2 + ov);
  const r1 = f.at(0, M.ridge, -bd / 2 - ov);
  const drop = (ov * (M.ridge - M.eaves)) / (bw / 2);
  const e = (u, w) => f.at(u, M.eaves - drop, w);
  for (const s of [-1, 1]) paint.poly([e(s * (bw / 2 + ov), bd / 2 + ov), e(s * (bw / 2 + ov), -bd / 2 - ov), r1, r0], { facing: f.dir(s, 1.3, 0), shade: 0.75 });
  for (const s of [-1, 1]) paint.poly([f.at(-bw / 2, M.eaves, (s * bd) / 2), f.at(bw / 2, M.eaves, (s * bd) / 2), f.at(0, M.ridge - 2, (s * bd) / 2)], { facing: f.dir(0, 0, s) });
  // The street end: the flap under the lid, the plate in the gable, the door and its lock.
  const front = wallFrame(f.at(0, y1, bd / 2), f.dir(0, 0, 1));
  const h = M.eaves - y1;
  paint.color(TINT.mailbox, 1.25);
  paint.panel(front, [[-22, h - 32], [22, h - 32], [22, h - 8], [-22, h - 8]], 1);
  paint.panel(front, [[-26, 8], [26, 8], [26, h - 46], [-26, h - 46]], 0.5);
  paint.color(TINT.plate);
  paint.panel(front, [[-9, h + 3], [9, h + 3], [9, h + 10], [-9, h + 10]], 0.5);
  paint.color(TINT.brass);
  paint.panel(front, [[-20, h - 82], [-14, h - 82], [-14, h - 74], [-20, h - 74]], 1);
  sparrow(paint, f.at(0, M.ridge - 5, bd / 2 - 10), f.dir(1, 0, 0));
  // (Solid to its eaves over the lid's footprint, the overhang with it: a box 60 x 45 alone made
  // the single jump onto it a precision one.)
  const lid = [f.at(-bw / 2 - ov, 0, bd / 2 + ov), f.at(bw / 2 + ov, 0, bd / 2 + ov), f.at(bw / 2 + ov, 0, -bd / 2 - ov), f.at(-bw / 2 - ov, 0, -bd / 2 - ov)];
  solids.solid([lid.map((p) => at(p, M.eaves)), ...lid.map((p, i) => [at(p, GROUND), at(lid[(i + 1) % 4], GROUND), at(lid[(i + 1) % 4], M.eaves), at(p, M.eaves)])], 'wood');
}

// The little blue sparrow, its belly on the ridge at o, facing horizontal `fwd`: a blue body
// over a white belly, a round head with dark eyes and an orange beak, darker wings folded on its
// sides, its tail cocked up behind (in bird units, about 50 long).
function sparrow(b, o, fwd) {
  const K = 0.8; // (W3: the real bird's size on the pedestal box)
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
  block(TINT.sparrow, 0.85, -9, 17, 4, 4, -23, 27, 4, 13); // (its tail fanned wide)
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
  // (Two-tone, style 'two': its roof and pillars gloss black, W5.)
  const top = c.style === 'two' ? TINT.evRoof : c.tint;
  part(top, hexa(ring(r0 - 4, r1 + 6, hw - 28, roof - 12), ring(r0 - 2, r1 + 4, hw - 30, roof + 3)), (n) => (n[1] > 0.5 ? 1.15 : 0.9));
  part(top, hexa(ring(wm - 14, wm + 14, hw - 9, belt), ring(wm - 14, wm + 14, hw - 31, roof - 10), { bottom: false, top: false }));
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

// North_4's basketball hoop: a black post standing against its wall, a white board (an orange
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
  // (W6: its black safety net's eight poles and top hoop, drawn only: photos 27, 28.)
  paint.color(0x1a1b1d);
  const top = T.y + 236;
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const [sx, sz] = [Math.sin(a), Math.cos(a)];
    paint.solid(beamPolys([T.x + sx * (T.r - 8), T.y - 28, T.z + sz * (T.r - 8)], [T.x + sx * (T.r - 10), top, T.z + sz * (T.r - 10)], [sz, 0, -sx], 7, 7));
  }
  for (let i = 0; i < 16; i++) {
    const [a, b] = [(i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2];
    const [p, q] = [[T.x + Math.sin(a) * (T.r - 10), top, T.z + Math.cos(a) * (T.r - 10)], [T.x + Math.sin(b) * (T.r - 10), top, T.z + Math.cos(b) * (T.r - 10)]];
    paint.solid(orientedBoxPolys([(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2], [q[0] - p[0], 0, q[2] - p[2]], Math.hypot(q[0] - p[0], q[2] - p[2]) + 2, top - 3, top + 3, 6));
  }
}

// ---------------------------------------------------------------- the motorhome, fences

// The motorhome on the north-west villa's drive (W8, photos 01-07: an integrated one; round 2:
// broadside to the street, its cab toward the road, +u): a white box on a dark skirt, its roof's
// right edge rounded off under a long awning box (photos 06, 07), a roof rail along its left and
// its back; its front upright (round 2 fix, photo 06): a white nose with the headlights, the
// windscreen over it leaning back a little, a cap rounding up from its top to the roof; framed
// windows along both sides, the door on its right (+w, toward the house) behind the cab, dark red
// swoosh decals, two roof hatches, a small window and the ladder in its back; four dark wheels.
// Solid from the ground to its roof (a coin spot): its body, its cab (its front a wall up to the
// cap), the rails and the awning's box (its flat top the one ledge: a double jump's), convex each
// (the realistic look's too).
function motorhome(kit, layout) {
  const { paint, solids } = kit.drawn('motorhome');
  const { MOTORHOME: M, GROUND } = layout;
  const f = frame({ cx: M.cx, cz: M.cz, yaw: M.yaw, w: M.l, d: M.w });
  const top = GROUND + M.h;
  const [hl, hw] = [M.l / 2, M.w / 2];
  const [bw, bd] = M.bevel;
  const [rh, rt] = M.rail;
  const box = (u0, u1, y0, y1, w0, w1) => frameBox(f, u0, u1, y0, y1, w0, w1);
  const [nose, front] = [GROUND + M.nose, GROUND + M.front];
  const screen = hl - M.cab; // (where the roof's edge meets the cap)
  const brow = hl - M.lean; // (the windscreen's top, under the cap)
  // A convex prism: the outline `pts` ([a, b]) at t 0 and 1 (`at(a, b, t)`), and its sides.
  const prism = (pts, at) => [pts.map(([a, b]) => at(a, b, 0)), pts.map(([a, b]) => at(a, b, 1)), ...pts.map(([a, b], i) => {
    const [c, d] = pts[(i + 1) % pts.length];
    return [at(a, b, 0), at(a, b, 1), at(c, d, 1), at(c, d, 0)];
  })];
  const along = (u0, u1) => (w, y, t) => f.at(t ? u1 : u0, y, w); // (a section across it, from u0 to u1)
  const across = (w0, w1) => (u, y, t) => f.at(u, y, t ? w1 : w0); // (a profile along it, from w0 to w1)
  const body = (y0) => [[-hw, y0], [hw, y0], [hw, top - bd], [hw - bw, top], [-hw, top]];
  const rail = (o) => [[o, top - bd - 5], [o + rt, top - bd - 5], [o + rt, top + rh - 6], [o + rt / 2, top + rh], [o, top + rh - 6]];
  const rails = [prism(rail(-hw), along(-hl, screen)), prism(rail(-hl), across(-hw, hw))];
  const awning = (y0) => box(-hl + 60, hl - 300, y0, top + M.awning[0], hw - M.awning[1], hw + 6);
  paint.color(0x3a3c40);
  paint.solid(box(-hl + 10, hl - 10, GROUND + 22, GROUND + 50, -hw + 6, hw - 6));
  paint.color(M.tint);
  const shade = (n) => (n[1] > 0.5 ? 1.05 : n[1] < -0.5 ? 0.5 : 0.95);
  paint.solid(prism(body(GROUND + 45), along(-hl, screen)), { faceShade: shade });
  // (The cab: its nose, the windscreen's lean back to the brow, the cap up to the roof's edge.)
  paint.solid(prism([[screen, GROUND + 45], [hl, GROUND + 45], [hl, nose], [brow, front], [screen, top - 4]], across(-hw + 4, hw - 4)), { faceShade: shade });
  // The windscreen on its lean (just proud of it: it is nearly upright), the side cab windows.
  paint.color(0x1e2328);
  const q = (k, w) => f.at(hl - M.lean * k + 1.5, nose + (front - nose) * k, w);
  paint.poly([q(0.94, -hw + 18), q(0.94, hw - 18), q(0.08, hw - 14), q(0.08, -hw + 14)], { facing: f.dir(front - nose, M.lean, 0) });
  const quad = (fr, u0, v0, u1, v1, w, tint) => {
    paint.color(tint);
    paint.panel(fr, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], w);
  };
  const cab = wallFrame(f.at(hl, GROUND, 0), f.dir(1, 0, 0));
  quad(cab, -hw + 6, 40, hw - 6, 70, 1.5, 0x8a8e90);
  for (const s of [-1, 1]) quad(cab, s > 0 ? hw - 72 : -hw + 22, 92, s > 0 ? hw - 22 : -hw + 72, 118, 1.5, 0xe8eaec);
  // Along both sides: the framed windows, the swoosh, the skirt's stripe; the door on its right.
  for (const s of [-1, 1]) {
    const fr = wallFrame(f.at(0, GROUND, s * hw), f.dir(0, 0, s));
    const U = (u) => s * u; // (the frame's u runs the other way on the far side)
    const win = (a, b, v0, v1) => {
      quad(fr, Math.min(U(a), U(b)) - 6, v0 - 6, Math.max(U(a), U(b)) + 6, v1 + 6, 1, 0xd8d8d4);
      quad(fr, Math.min(U(a), U(b)), v0, Math.max(U(a), U(b)), v1, 1.6, 0x23282e);
    };
    for (const [a, b] of [[-hl + 90, -hl + 250], [-hl + 360, -hl + 520], [hl - 440, hl - 350]]) win(a, b, 260, 330);
    win(hl - 215, hl - 175, 250, 330); // (the cab's side window)
    quad(fr, Math.min(U(-hl + 20), U(hl - 140)), 150, Math.max(U(-hl + 20), U(hl - 140)), 164, 1.2, TINT.stripe);
    paint.color(0x8a2a2a);
    for (const [u0, u1, dv] of [[-hl + 260, -hl + 600, 30], [-hl + 540, -hl + 760, -20]]) paint.panel(fr, [[U(u0), 176], [U(u1), 176 + dv], [U(u1), 186 + dv], [U(u0), 186]], 1.3);
  }
  const right = wallFrame(f.at(0, GROUND, hw), f.dir(0, 0, 1));
  quad(right, hl - 340, 52, hl - 260, 360, 1.1, 0xe4e6e2);
  quad(right, hl - 328, 260, hl - 272, 330, 1.8, 0x23282e);
  // The awning's long box on the roof's right edge (just proud of the side: drawn from a little
  // under the roof, a shadow line under it over the rounded edge), the rails.
  paint.color(0xc4c8c8);
  paint.solid(awning(top - 8), { faceShade: shade });
  paint.color(0xa8acae);
  for (const r of rails) paint.solid(r);
  // The roof's hatches; the back's window and the ladder up to the rail.
  paint.color(0xe0e0dc);
  for (const u of [-hl + 220, -hl + 560]) paint.solid(box(u - 40, u + 40, top, top + 14, -45, 45));
  const back = wallFrame(f.at(-hl, GROUND, 0), f.dir(-1, 0, 0));
  quad(back, -60, 280, 20, 330, 1, 0x23282e);
  paint.color(0x6a6e72);
  for (const u of [60, 110]) paint.solid(localBoxPolys(back, u - 3, u + 3, 100, M.h + rh, 0, 12));
  for (let v = 120; v < M.h; v += 80) paint.solid(localBoxPolys(back, 57, 113, v, v + 6, 8, 14));
  paint.color(0x111111);
  for (const u of [-hl + 170, hl - 230]) for (const w of [-hw + 10, hw - 10]) paint.solid(box(u - 42, u + 42, GROUND, GROUND + 84, w - 18, w + 18));
  // (Solid: the body (its right edge's bevel), the cab (its front upright to the cap) and the rails.)
  solids.solid(prism(body(GROUND - 5), along(-hl, screen)), 'stone');
  solids.solid(prism([[screen, GROUND - 5], [hl, GROUND - 5], [hl, front], [screen, top]], across(-hw, hw)), 'stone');
  for (const r of [...rails, awning(top - bd - 12)]) solids.solid(r, 'stone');
}

// A box in a house frame's (u, y, w) from u0..u1, y0..y1, w0..w1.
const frameBox = (f, u0, u1, y0, y1, w0, w1) => hexaPolys([f.at(u0, y0, w0), f.at(u1, y0, w0), f.at(u1, y0, w1), f.at(u0, y0, w1), f.at(u0, y1, w0), f.at(u1, y1, w0), f.at(u1, y1, w1), f.at(u0, y1, w1)]);

// A fence along [from, to] (in its house's frame): a picket fence (pales on two rails, posts) or a
// two-rail fence on posts; its collider a slab as high.
function fence(kit, layout, f) {
  const { kind, h } = f;
  const { boards, solids } = kit.drawn('fences');
  const y0 = layout.GROUND;
  const [a, b] = fenceEnds(layout, f);
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

// The garden things at the two ends (W8, layout GARDEN_THINGS; both looks): a white picnic table
// (its top and benches on A-frames, solid), a small white board shed (a chain house: its gable
// roof, a black door), a black box mailbox on a post (blank), a patio table and chairs, a closed
// parasol, a children's white football goal (its frame, a grey net).
function gardenThings(kit, layout) {
  const { paint, boards, solids } = kit;
  const G = layout.GROUND;
  for (const t of GARDEN_THINGS) {
    const f = frame({ cx: t.x, cz: t.z, yaw: t.yaw ?? 0 });
    const box = (u0, u1, y0, y1, w0, w1) => frameBox(f, u0, u1, y0, y1, w0, w1);
    const shade = { faceShade: (n) => (n[1] < -0.5 ? 0.55 : 1) };
    if (t.kind === 'picnic') {
      boards.color(0xeeeeea);
      boards.solid(box(-145, 145, G + 110, G + 122, -65, 65), shade);
      for (const s of [-1, 1]) boards.solid(box(-145, 145, G + 66, G + 76, s * 95 - 22, s * 95 + 22), shade);
      for (const u of [-110, 110]) for (const s of [-1, 1]) boards.solid(beamPolys(f.at(u, G, s * 115), f.at(u, G + 112, s * 12), f.dir(1, 0, 0), 10, 8), shade);
      solids.solid(box(-145, 145, G - 4, G + 122, -118, 118), 'wood');
    } else if (t.kind === 'shed') {
      house(kit, { kit: 'chain', cx: t.x, cz: t.z, w: t.w, d: t.d, yaw: t.yaw, y0: G, eave: G + t.h - 70, ridge: G + t.h, boards: 0xeceae4, roof: 0x3a3a3c, plinth: 20, door: 0, doorSize: { w: 100, h: 200 }, windows: [] });
    } else if (t.kind === 'postbox') {
      paint.color(0x1e1f22);
      paint.solid(box(-4, 4, G - 4, G + 125, -4, 4));
      paint.solid(box(-35, 35, G + 125, G + 185, -25, 25), shade);
      solids.solid(prismPolys(t.x, t.z, 36, 6, G - 4, G + 185), 'stone');
    } else if (t.kind === 'table' || t.kind === 'chair') {
      // (Its top or seat on four thin legs; a chair's back.)
      const [a, h] = t.kind === 'table' ? [60, 108] : [30, 66];
      paint.color(0x2a2a2c);
      paint.solid(box(-a, a, G + h, G + h + 6, -a, a), shade);
      if (h < 100) paint.solid(box(-a, a, G + h + 6, G + 150, -a, 6 - a), shade);
      for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) paint.solid(box(u * (a - 6) - 3, u * (a - 6) + 3, G, G + h, w * (a - 6) - 3, w * (a - 6) + 3));
      if (h > 100) solids.solid(box(-a, a, G - 4, G + h + 6, -a, a), 'wood');
    } else if (t.kind === 'parasol') {
      paint.color(0x8a8e90);
      paint.lathe(t.x, t.z, [[3, G], [3, G + 330], [0, G + 332]], 6, { flat: true });
      paint.color(0x3e2e3a);
      paint.lathe(t.x, t.z, [[8, G + 150], [30, G + 220], [24, G + 300], [0, G + 322]], 8);
    } else if (t.kind === 'goal') {
      paint.color(0xf2f2f0);
      const [hw, hh, dd] = [210, 260, 130];
      const bar = (p, q) => paint.solid(beamPolys(p, q, f.dir(0, 0, 1), 9, 9));
      for (const s of [-1, 1]) {
        bar(f.at(s * hw, G, 0), f.at(s * hw, G + hh, 0));
        bar(f.at(s * hw, G + hh, 0), f.at(s * hw, G + 30, -dd));
        bar(f.at(s * hw, G + 4, 0), f.at(s * hw, G + 4, -dd));
      }
      bar(f.at(-hw, G + hh, 0), f.at(hw, G + hh, 0));
      bar(f.at(-hw, G + 4, -dd), f.at(hw, G + 4, -dd));
      paint.color(0xb8bab8, 0.8);
      for (let u = -hw + 30; u < hw; u += 30) paint.poly([f.at(u - 0.8, G + hh, 0), f.at(u + 0.8, G + hh, 0), f.at(u + 0.8, G + 30, -dd), f.at(u - 0.8, G + 30, -dd)], { facing: f.dir(0, 1, 1) });
    }
  }
}

// The small plants drawn only (W8, layout SMALL_PLANTS): a red maple, tall pale grasses, an
// orange-yellow autumn shrub, box balls, a small dark conifer.
const SMALL_TINT = { maple: 0x8a2a30, grass: 0xc8b07a, gold: 0xd09a3a, box: 0x4a5a2a, conifer: 0x3a4a26 };
function smallPlants(kit, layout) {
  const { leaves } = kit.drawn('plants');
  const G = layout.GROUND;
  for (const p of SMALL_PLANTS) {
    leaves.color(SMALL_TINT[p.kind]);
    const prof = { conifer: [[1, 0], [0.9, 0.4]], grass: [[0.3, 0], [1, 0.7], [0.6, 0.95]] }[p.kind] ?? [[0.7, 0], [1, 0.45], [0.75, 0.85]];
    leaves.lathe(p.x, p.z, [...prof, [0, 1]].map(([r, y]) => [p.r * r, G - 2 + (p.h + 2) * y]), 7, { a0: p.x * 0.01 });
  }
}

// A TV antenna on a chain house's ridge: a mast and a boom with five elements across it (drawn
// only).
function antenna(kit, layout, { house, x, gable }) {
  const { paint } = kit.drawn('antennas'); // (the realistic look's own: world/lane/real/hardware.js)
  const H = layout.HOUSES.find((h) => h.id === house);
  const [y, z] = [H.ridge, H.cz];
  const top = y + (gable ? 300 : 250);
  paint.color(TINT.antenna);
  paint.box(x - 4, x + 4, y - (gable ? 90 : 20), top, z - 4, z + 4);
  // (Clamped to a gable's apex: a bracket board to the wall under it.)
  if (gable) paint.box(H.cx + H.w / 2, x + 6, y - 82, y - 70, z - 10, z + 10);
  paint.box(x - 3, x + 3, top - 16, top - 10, z - 120, z + 80);
  [[110, -110], [95, -60], [85, -10], [75, 40], [65, 75]].forEach(([len, dz]) => paint.box(x - len / 2, x + len / 2, top - 15, top - 11, z + dz - 2, z + dz + 2));
}

// By the footpath: the double garage's forecourt wall (W8, photos 29-31: light grey split-face
// blocks, three courses under a smooth cap, its top walkable) from the garage's corner to its
// square pillar at the footway, the light grey mailbox on the pillar (a box under a curved lid,
// blank; the realistic look's own: world/lane/real/extras.js cabinet), the blue round sign on its
// grey post (a white walking figure on it) and the low two-rail barrier across the path where
// the play space ends.
function footpathProps(kit, layout) {
  const { paint, blocks, boards, solids } = kit;
  const { CABINET: C, PATH_SIGN: S, FOOTPATH: P, GROUND, footpathAt } = layout;
  const W = FORECOURT_WALL;
  const [wa, wb] = [W.from, W.to];
  const wd = [wb[0] - wa[0], 0, wb[1] - wa[1]];
  const wl = Math.hypot(wd[0], wd[2]);
  const wm = [(wa[0] + wb[0]) / 2, 0, (wa[1] + wb[1]) / 2];
  const shade = { faceShade: (n) => (n[1] > 0.5 ? 1.08 : 0.92) };
  blocks.color(0xbab0a3, kit.look === 'real' ? 1.4 : 1);
  paint.color(0xc8c2b8);
  for (const [at, l, t, top] of [[wm, wl, W.thick, W.top], [[C.x, 0, C.z], W.pillar, W.pillar, W.pillarTop]]) {
    blocks.solid(orientedBoxPolys(at, wd, l, GROUND - 5, top - 10, t, { bottom: false }), shade);
    paint.solid(orientedBoxPolys(at, wd, l + 6, top - 10, top, t + 6, { bottom: false }), shade); // (its cap)
  }
  solids.solid(orientedBoxPolys(wm, wd, wl, GROUND - 5, W.top, W.thick, { bottom: false }), 'stone');
  // The mailbox on the pillar: a box under its lid, rounded in steps (the realistic look's
  // curved).
  const y = W.pillarTop;
  const mb = kit.drawn('cabinet').paint;
  mb.color(0xcdc8c2);
  for (const [a, b, d] of [[0, 42, 50], [42, 49, 44], [49, 54, 26]]) mb.solid(orientedBoxPolys([C.x, 0, C.z], wd, 76, y + a, y + b, d, { bottom: false }), shade);
  solids.solid(orientedBoxPolys([C.x, 0, C.z], wd, W.pillar, GROUND - 5, y + 54, W.pillar, { bottom: false }), 'stone');
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

// The forest on the bank behind the north gardens, in the side yards and round the outside of the
// boundary (W7: world/lane/real/spots.js's mixed canopy, the realistic look plants the same trees):
// spruces (skerries/props.js fir()), birches, broadleaves (a short trunk under two golden-green
// blobs) and Scots pines (a tall orange-brown trunk under a flat dark crown), drawn only but the
// side yards' trunks (solid, beside the yards' walking lines: off every route): the boundary's
// walls stand inside the rest. P1: the crowns' tops gilt (gilt), the side yards' broadleaves in
// three lobes at different heights (photos 16, 23, 24, 28), the trunks in the back rows and round
// the outside three-sided (the triangles the lobes and the far masses take), and low wide masses
// behind the bank's band and round the west end (FAR_MASSES: the sky only over the forest,
// photos 04, 05, 13, 43).
const FAR_MASSES = [[-12800, -3900, 900], [-11200, -6300, 1000], [-8200, -7000, 1100], [-4200, -7400, 1100], [200, -7600, 1100], [4600, -7500, 1100], [-14800, -1200, 1000], [-16000, 3200, 1100]];
function forest(kit, layout) {
  const { leaves, wood, solids } = kit.drawn('forest');
  const { firs, birches, broad, pines } = forestSpots(layout);
  const F = layout.FOREST;
  for (const t of firs) fir({ leaves, wood }, t.x, t.z, t.base, t.h, t.r, { a0: t.a0, solid: false });
  for (const t of [...birches, ...broad, ...pines]) {
    const pine = pines.includes(t);
    const rng = makeRng(t.seed);
    const trunk = pine ? 0.86 : 0.5;
    // (Two blobs: the crown and a lump off it; a pine's flat, at its top; one deep in the bank
    // and round the outside, where the front rows hide them.)
    const front = t.solid || (t.z > F.z0 + F.slope * t.x - 600 && t.z < F.z0 + F.slope * t.x + 400);
    wood.color(pine ? TINT.pine : birches.includes(t) ? TINT.bark : TINT.trunk);
    wood.lathe(t.x, t.z, [[t.r * (pine ? 0.07 : 0.09), t.base - 10], [t.r * 0.05, t.base + t.h * trunk]], front ? 5 : 3, { flat: true });
    const tint = pine ? TINT.pineCrown : birches.includes(t) ? TINT.birch : TINT.oak[t.seed % TINT.oak.length];
    const lobed = t.solid && !pine;
    const blobs = lobed ? [[0, 0, 0.8, 0.55, 0.18], [1, 0.45, 0.58, 0.48, 0.16], [2, 0.46, 0.42, 0.46, 0.14]] : pine ? [[0, 0, 0.9, 1, 0.1], [1, 0.45, 0.8, 0.6, 0.08]] : [[0, 0, 0.66, 0.85, 0.32], [1, 0.42, 0.8, 0.6, 0.2]];
    for (const [k, off, up, rr, ry] of front ? blobs : blobs.slice(0, 1)) {
      const a = rng() * 6.3 + k * 2.1;
      leaves.color(tint, 0.92 + rng() * 0.16);
      gilt(leaves, t.base + t.h * 0.4, t.h * 0.6, pine ? 0.5 : 0.75, 0.7, 0.4);
      blob(leaves, t.x + Math.sin(a) * t.r * off, t.z + Math.cos(a) * t.r * off, t.base + t.h * up, t.r * rr, t.h * ry, a + k, 5, !front);
    }
    leaves.shade = null;
    if (t.solid) solids.solid(prismPolys(t.x, t.z, 40, 8, t.base, t.base + t.h * 0.4), 'wood');
  }
  // (P1 fix round: each on a skirt down to the ground, not a blob on its point: from the
  // junction a ball floating over the horizon.)
  for (const [x, z, r] of FAR_MASSES) {
    const y0 = layout.groundHeight(x, z);
    const h = 2900 - y0;
    leaves.color(TINT.oak[0], 0.8);
    gilt(leaves, y0, h, 0.6);
    leaves.lathe(x, z, [[r * 0.9, y0 - 10], [r * 0.96, y0 + h * 0.16], [r, y0 + h * 0.48], [r * 0.8, y0 + h * 0.8], [0, 2900]], 5, { a0: x * 0.001 });
  }
  leaves.shade = null;
}

// A house down the side road in the fog (SIDE_BLOCKS): a plain chain house (houses.js) along the
// road, out of reach.
function sideBlocks(kit, layout) {
  const { SIDE_ROAD: S, SIDE_BLOCKS, GROUND } = layout;
  const [dx, dz] = S.dir;
  for (const b of SIDE_BLOCKS) house(kit, { kit: 'chain', cx: S.x + dx * b.t - dz * b.s, cz: S.z + dz * b.t + dx * b.s, w: b.w, d: b.d, yaw: Math.atan2(-dz, dx), y0: GROUND, eave: 412, ridge: 412 + b.d * 0.18, boards: b.tint, roof: TINT.sideRoof });
  // (W8: past the junction and beyond the footpath, both looks: the veranda house, its chimney
  // and TV mast, the lay-by's two cars, lamppost B and its blank plate; the far houses.)
  const V = VERANDA_HOUSE;
  house(kit, V);
  const F = frame(V);
  const { paint } = kit;
  const C = V.chimney;
  paint.color(0x2e2a28);
  paint.solid(hexaPolys([V.eave + 100, C.top].flatMap((y) => [[-36, -36], [36, -36], [36, 36], [-36, 36]].map(([a, b]) => F.at(C.u + a, y, C.w + b)))));
  const apex = F.at(V.w / 2 - 20, V.ridge, 0);
  paint.color(TINT.antenna);
  paint.box(apex[0] - 4, apex[0] + 4, V.ridge - 40, V.ridge + 330, apex[2] - 4, apex[2] + 4);
  // (Two yagis on it, W8 fix, photo 03: each a boom along the gable's way, its elements across,
  // the reflector longest.)
  for (const y of [V.ridge + 240, V.ridge + 320]) {
    const u = (k) => V.w / 2 - 20 - 120 + k;
    paint.solid(beamPolys(F.at(u(0), y, 0), F.at(u(300), y, 0), [0, 1, 0], 4, 4));
    for (let k = 0; k < 8; k++) paint.solid(beamPolys(F.at(u(10 + k * 40), y, -(k ? 30 - k : 44)), F.at(u(10 + k * 40), y, k ? 30 - k : 44), [0, 1, 0], 2, 2));
  }
  for (const c of LAYBY.cars) car(kit, layout, c, 'draw'); // (the realistic look's own: real/cars.js)
  for (const l of FAR_LAMPS) {
    lamppost(kit, layout, l, true);
    // The blank street name plate clamped on it (the realistic look's own: real/clutter.js).
    const { paint: pp } = kit.drawn('posts');
    const n = [Math.sin(l.yaw + 2.4), 0, Math.cos(l.yaw + 2.4)];
    const side = [n[2], 0, -n[0]];
    pp.color(0xf4f4f0);
    pp.solid(orientedBoxPolys([l.x + n[0] * 20, 0, l.z + n[2] * 20], side, 112, GROUND + l.plate - 13, GROUND + l.plate + 13, 4));
  }
  for (const h of BACKDROP) house(kit, h);
}
