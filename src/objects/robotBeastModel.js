// Geometry and material of the Rustmaw, the original giant robot beast of AI RACE mode.
//
// Design: a hulking, hunched, digitigrade walking machine of dark gunmetal plates held together
// by rust-red ball joints. A barrel chest with a glowing furnace grille, box shoulders carrying
// twin exhaust stacks, two coolant tanks on its back, long industrial arms ending in hooked
// three-fingered grabs, and a long segmented neck that arches forward to an anvil-shaped head:
// a heavy chisel snout, an overhanging brow over two slanted red optic slits, a mast with a
// beacon, and a massive hinged underbite jaw striped with hazard paint. Its tail is a thick
// segmented power cable ending in a two-pronged plug. Throat, palate, tongue plate and chest
// grille glow furnace-orange as it charges a shot.
//
// The rig is a handful of rigid parts (one mesh = one draw call each), all sharing one
// flat-shaded Lambert material with vertex colours and an extra per-vertex emission attribute:
//   legs (root), torso (waist) -> neck -> head -> jaw, armL, armR (shoulders), tailA -> tailB
// Local frame: feet on y = 0, facing +Z. Built at DESIGN scale; RobotBeast scales the root.

import * as THREE from 'three';
import { makeRng } from '../core/math.js';

// ---------------------------------------------------------------- palette

const GUN = [0.25, 0.27, 0.31];
const GUN_LIGHT = [0.36, 0.38, 0.43];
const GUN_DARK = [0.13, 0.14, 0.17];
const STEEL = [0.5, 0.52, 0.55];
const STEEL_DARK = [0.2, 0.2, 0.22];
const RUST = [0.78, 0.28, 0.1];
const RUST_DARK = [0.5, 0.16, 0.07];
const CLAW = [0.66, 0.64, 0.58];
const CABLE = [0.12, 0.11, 0.11];
const HAZARD = [0.92, 0.7, 0.12];
const EYE = [1, 0.14, 0.06];
const EMBER = [1, 0.42, 0.1];
const FURNACE = [1, 0.5, 0.12];

// Emission: [constant (scaled by the power uniform), charge-driven (scaled by uCharge)].
const E_NONE = [0, 0];
const E_EYE = [2.6, 0];
const E_EMBER = [0.9, 0.9];
const E_JOINT = [0.28, 0.35]; // the rust joints run red-hot (reads in the dark)
const E_GRILLE = [0.85, 1.6];
const E_CORE = [1.2, 1.4];
const E_THROAT = [0.2, 2.4];

// Rig pivots and landmarks in DESIGN units (see RobotBeast for the scale).
export const RIG = {
  WAIST: [0, 1380, -60], // torso pivot (root space)
  SHOULDER: [640, 700, 60], // arm pivots (torso space, x mirrored)
  NECK: [0, 800, 270], // neck pivot (torso space)
  NECK_PTS: [
    [0, 0, 0],
    [0, 170, 170],
    [0, 270, 370],
    [0, 300, 580],
    [0, 250, 780],
  ],
  NECK_R: [175, 160, 145, 132, 122],
  JAW: [0, -45, -60], // jaw hinge (head space)
  MOUTH: [0, -70, 430], // fireball spawn (head space)
  THROAT: [0, -55, 120], // charge glow (head space)
  EYES: [
    [-72, 86, 268],
    [72, 86, 268],
  ],
  BEACON: [-150, 405, -140], // mast tip (head space)
  STACKS: [
    [-700, 1250, -270],
    [-500, 1250, -260],
    [500, 1250, -260],
    [700, 1250, -270],
  ], // exhaust stack tops (torso space)
  TAIL: [0, 1260, -330], // tail pivot (root space)
  TAIL_A: [
    [0, 0, 0],
    [220, -160, -140],
    [500, -330, -210],
    [800, -480, -200],
  ],
  TAIL_A_R: [170, 158, 146, 134],
  TAIL_B: [
    [0, 0, 0],
    [270, -220, 20],
    [500, -430, 150],
    [690, -600, 320],
    [830, -700, 470],
  ],
  TAIL_B_R: [134, 120, 106, 94, 84],
  HIP: [330, 1250, -80],
  KNEE: [680, 800, 260],
  ANKLE: [1020, 330, -120],
  FOOT: [1120, 60, 60], // foot centre (sole on y = 0)
  // Arm (arm space, left arm; x mirrored for the right)
  ELBOW: [120, -620, 300],
  WRIST: [60, -1180, 700],
};

// ---------------------------------------------------------------- builder

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Collects flat-shaded primitives into one non-indexed geometry with colour and emission.
class PartBuilder {
  constructor(seed) {
    this.pos = [];
    this.col = [];
    this.emit = [];
    this.rng = makeRng(seed);
  }

  // Appends a three.js geometry transformed by `matrix`, coloured (with a slight random
  // per-piece variation so the plates read as separate panels) and with emission `emit`.
  add(geometry, matrix, color, emit = E_NONE, vary = 0.06) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const p = g.attributes.position.array;
    const k = 1 + (this.rng() - 0.5) * 2 * vary;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.col.push(color[0] * k, color[1] * k, color[2] * k);
      this.emit.push(emit[0], emit[1]);
    }
    g.dispose();
    geometry.dispose();
  }

  // A deformed box from 8 corners, indexed by bits (x+: 1, y+: 2, z+: 4).
  hexa(corners, color, emit, vary) {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const bit = (p.getX(i) > 0 ? 1 : 0) | (p.getY(i) > 0 ? 2 : 0) | (p.getZ(i) > 0 ? 4 : 0);
      const c = corners[bit];
      p.setXYZ(i, c[0], c[1], c[2]);
    }
    this.add(g, _m.identity(), color, emit, vary);
  }

  // A tapered box: bottom (y0) half sizes bx/bz, top (y1) half sizes tx/tz, centred on (cx, cz)
  // at the bottom and shifted by (sx, sz) at the top.
  slab(cx, cz, y0, y1, bx, bz, tx, tz, sx, sz, color, emit, vary) {
    const c = [];
    for (let bit = 0; bit < 8; bit++) {
      const top = bit & 2;
      const hx = top ? tx : bx;
      const hz = top ? tz : bz;
      c.push([cx + (top ? sx : 0) + (bit & 1 ? hx : -hx), top ? y1 : y0, cz + (top ? sz : 0) + (bit & 4 ? hz : -hz)]);
    }
    this.hexa(c, color, emit, vary);
  }

  // A box of size (w, h, d) centred at (x, y, z), rotated by Euler (rx, ry, rz).
  box(x, y, z, w, h, d, color, emit, rx = 0, ry = 0, rz = 0) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(w, h, d));
    this.add(new THREE.BoxGeometry(1, 1, 1), _m, color, emit);
  }

  // A cylinder from point a to point b (radius ra at a, rb at b).
  cyl(a, b, ra, rb, sides, color, emit) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _q.setFromUnitVectors(Y_AXIS, _v.set(dx / len, dy / len, dz / len));
    _m.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rb, ra, len, sides, 1), _m, color, emit);
  }

  // A short ring (collar) of radius r and length `len` around the axis a->b at point a.
  ring(a, b, r, len, color, emit) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const h = len / 2 / l;
    this.cyl([a[0] - dx * h, a[1] - dy * h, a[2] - dz * h], [a[0] + dx * h, a[1] + dy * h, a[2] + dz * h], r, r, 8, color, emit);
  }

  ball(c, r, color, emit, detail = 0) {
    _m.makeTranslation(c[0], c[1], c[2]);
    this.add(new THREE.IcosahedronGeometry(r, detail), _m, color, emit);
  }

  // A cone from base centre a (radius r) to tip b.
  cone(a, b, r, sides, color, emit) {
    this.cyl(a, b, r, 0.5, sides, color, emit);
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.emit, 2));
    geo.computeVertexNormals(); // flat: the geometry is non-indexed
    geo.computeBoundingSphere();
    return geo;
  }
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mirror = (p, s) => [p[0] * s, p[1], p[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------- parts

function buildLegs() {
  const b = new PartBuilder(11);
  // Pelvis block and a hanging front guard.
  b.slab(0, -60, 1120, 1440, 300, 230, 420, 260, 0, 0, GUN);
  b.slab(0, 215, 1040, 1360, 150, 30, 190, 30, 0, 10, GUN_LIGHT);
  b.box(0, 1180, 250, 260, 30, 20, HAZARD, E_NONE);
  for (const s of [-1, 1]) {
    const hip = mirror(RIG.HIP, s);
    const knee = mirror(RIG.KNEE, s);
    const ankle = mirror(RIG.ANKLE, s);
    const foot = mirror(RIG.FOOT, s);
    b.ball(hip, 175, RUST, E_JOINT, 1);
    // Thigh: a thick six-sided strut with an armour plate on the outside.
    b.cyl(hip, knee, 190, 150, 6, GUN);
    const mid = lerp3(hip, knee, 0.5);
    b.box(mid[0] + s * 150, mid[1], mid[2], 70, 420, 300, GUN_LIGHT, E_NONE, 0.8, 0, s * 0.5);
    b.ball(knee, 140, RUST, E_JOINT, 1);
    b.slab(knee[0], knee[2] + 110, knee[1] - 120, knee[1] + 170, 110, 40, 130, 30, 0, 30, GUN_LIGHT);
    // Shin with a hydraulic ram behind it.
    b.cyl(knee, ankle, 135, 100, 6, GUN);
    b.cyl(add3(knee, [0, 40, -150]), add3(ankle, [0, 120, -110]), 40, 40, 6, STEEL_DARK);
    b.cyl(add3(knee, [0, -120, -155]), add3(knee, [0, -420, -140]), 22, 22, 6, STEEL);
    b.ball(ankle, 115, RUST, E_JOINT, 1);
    // Metatarsal and the clawed foot.
    const heel = [foot[0], 150, foot[2] - 60];
    b.cyl(ankle, heel, 105, 95, 6, GUN);
    b.slab(foot[0], foot[2], 0, 130, 160, 240, 130, 200, 0, -20, GUN_DARK);
    b.slab(foot[0], foot[2] + 60, 110, 190, 120, 150, 90, 110, 0, -10, GUN);
    for (const t of [-1, 0, 1]) {
      const base = [foot[0] + t * 105, 55, foot[2] + 230];
      b.cone(base, [foot[0] + t * 135, 5, foot[2] + 430], 58, 5, CLAW);
    }
    b.cone([foot[0], 70, foot[2] - 230], [foot[0], 10, foot[2] - 380], 50, 5, CLAW);
  }
  return b.build();
}

function buildTorso() {
  const b = new PartBuilder(23);
  // Abdomen: a segmented core with rust bands.
  b.cyl([0, -60, 0], [0, 280, 30], 270, 320, 8, GUN_DARK);
  b.ring([0, 60, 10], [0, 280, 30], 300, 40, RUST_DARK);
  b.ring([0, 170, 20], [0, 280, 30], 318, 40, RUST_DARK);
  // Barrel chest: an oval eight-sided drum, wider at the top and pushed forward.
  _m.compose(_v.set(0, 560, 30), _q.setFromEuler(_e.set(0.12, 0, 0)), _s.set(1, 1, 0.66));
  b.add(new THREE.CylinderGeometry(560, 400, 680, 8, 1).rotateY(Math.PI / 8), _m, GUN);
  // Hunched back: a heavy armour hump over the shoulders.
  b.slab(0, -150, 700, 1010, 470, 200, 330, 150, 0, -60, GUN_LIGHT);
  // Chest armour: two angled plates and a raised sternum ridge.
  for (const s of [-1, 1]) {
    b.hexa(
      [
        [s * 70, 600, 330],
        [s * 470, 600, 250],
        [s * 70, 880, 400],
        [s * 500, 880, 300],
        [s * 70, 600, 400],
        [s * 470, 600, 300],
        [s * 70, 880, 460],
        [s * 500, 880, 350],
      ].map((p, i, all) => all[i ^ (s < 0 ? 1 : 0)]),
      GUN_LIGHT,
    );
  }
  b.slab(0, 400, 560, 900, 45, 40, 55, 50, 0, 60, GUN_DARK);
  // Furnace heart: a glowing core disc behind a grille of bars (brightens as it charges).
  b.cyl([0, 390, 250], [0, 390, 330], 170, 170, 8, GUN_DARK);
  b.cyl([0, 390, 300], [0, 390, 345], 130, 130, 8, FURNACE, E_CORE);
  for (let i = 0; i < 4; i++) b.box(0, 300 + i * 60, 352, 290 - Math.abs(i - 1.5) * 60, 18, 16, GUN_DARK, E_NONE);
  for (let i = 0; i < 3; i++) b.box(0, 175 + i * 40, 300, 330 - i * 40, 16, 20, FURNACE, E_GRILLE);
  // Shoulders: layered box pauldrons with rust trim, hazard edges and twin exhaust stacks.
  for (const s of [-1, 1]) {
    b.slab(s * 610, 30, 600, 940, 200, 240, 225, 255, s * 25, 0, GUN_LIGHT);
    b.slab(s * 700, 30, 520, 720, 150, 250, 180, 260, s * 40, 0, GUN);
    b.box(s * 620, 596, 30, 420, 40, 490, RUST, E_JOINT);
    b.box(s * 842, 790, 30, 16, 200, 400, HAZARD, E_NONE);
    for (const k of [0, 1]) {
      const top = RIG.STACKS[s < 0 ? k : 2 + k];
      const base = [top[0] * 0.92, 900, -130];
      b.cyl(base, top, 62, 54, 7, STEEL_DARK);
      b.ring(lerp3(base, top, 0.97), top, 62, 30, EMBER, E_EMBER);
      b.ring(lerp3(base, top, 0.3), top, 70, 40, RUST_DARK);
    }
  }
  // Two coolant tanks on the back.
  for (const s of [-1, 1]) {
    b.cyl([s * 230, 260, -360], [s * 230, 760, -380], 140, 140, 8, STEEL_DARK);
    b.ball([s * 230, 780, -380], 140, RUST_DARK);
    b.ball([s * 230, 250, -360], 138, RUST_DARK);
    b.ring([s * 230, 520, -370], [s * 230, 760, -380], 150, 36, RUST);
  }
  // Neck collar.
  b.ring(RIG.NECK, add3(RIG.NECK, [0, 150, 170]), 230, 130, RUST, E_JOINT);
  return b.build();
}

function buildNeck() {
  const b = new PartBuilder(37);
  const P = RIG.NECK_PTS;
  const R = RIG.NECK_R;
  for (let i = 0; i < P.length - 1; i++) {
    b.cyl(P[i], P[i + 1], R[i], R[i + 1], 8, i % 2 ? GUN_LIGHT : GUN);
    if (i > 0) b.ring(P[i], P[i + 1], R[i] + 22, 50, RUST, E_JOINT);
  }
  // Two thick cables slung under the neck.
  for (const s of [-1, 1]) {
    const pts = P.map((p, i) => [s * 60, p[1] - R[i] * 0.85, p[2] + 10]);
    for (let i = 0; i < pts.length - 1; i++) b.cyl(pts[i], pts[i + 1], 34, 34, 6, CABLE);
  }
  return b.build();
}

function buildHead() {
  const b = new PartBuilder(41);
  // Skull, tapering toward the snout.
  b.hexa(
    [
      [-170, -40, -130],
      [170, -40, -130],
      [-165, 190, -130],
      [165, 190, -130],
      [-140, -40, 260],
      [140, -40, 260],
      [-135, 115, 260],
      [135, 115, 260],
    ],
    GUN,
  );
  // Heavy chisel snout under the optics.
  b.hexa(
    [
      [-140, -40, 255],
      [140, -40, 255],
      [-140, 62, 255],
      [140, 62, 255],
      [-95, -30, 440],
      [95, -30, 440],
      [-95, 30, 440],
      [95, 30, 440],
    ],
    GUN_LIGHT,
  );
  // Overhanging brow visor (a scowl over the optics) with a rust edge.
  b.hexa(
    [
      [-178, 120, 60],
      [178, 120, 60],
      [-172, 205, 40],
      [172, 205, 40],
      [-160, 112, 318],
      [160, 112, 318],
      [-150, 150, 300],
      [150, 150, 300],
    ],
    GUN_DARK,
  );
  b.box(0, 110, 314, 300, 14, 18, RUST, E_NONE);
  // Optic slits, slanted down toward the middle.
  for (const [i, s] of [
    [0, -1],
    [1, 1],
  ]) {
    const e = RIG.EYES[i];
    b.box(e[0], e[1], e[2], 112, 22, 18, EYE, E_EYE, 0, 0, s * 0.24);
  }
  // Cheek armour.
  for (const s of [-1, 1]) b.box(s * 168, 40, 60, 34, 170, 300, GUN_LIGHT, E_NONE, 0, s * 0.08, 0);
  // Upper fangs along the snout's underside.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = 250 + k * 50;
      b.cone([s * (110 - k * 6), -35, z], [s * (108 - k * 6), -95, z + 8], 20, 4, CLAW);
    }
  }
  // Glowing palate and throat vent (the furnace shows when the jaw drops).
  b.box(0, -42, 180, 210, 10, 360, FURNACE, E_THROAT);
  b.box(0, -58, -30, 200, 16, 160, FURNACE, E_THROAT);
  for (let k = 0; k < 4; k++) b.box(0, -66, -90 + k * 40, 210, 10, 12, GUN_DARK, E_NONE);
  // Mast with a beacon, and two short exhaust pipes at the back of the skull.
  b.cyl([-110, 180, -80], RIG.BEACON, 14, 10, 5, STEEL);
  b.ball(RIG.BEACON, 28, EYE, E_EYE);
  for (const s of [-1, 1]) b.cyl([s * 90, 120, -120], [s * 110, 150, -270], 34, 30, 6, STEEL_DARK);
  return b.build();
}

function buildJaw() {
  const b = new PartBuilder(53);
  // Massive underbite jaw, hinged at its back (the part's origin).
  b.hexa(
    [
      [-155, -170, 0],
      [155, -170, 0],
      [-150, 0, 0],
      [150, 0, 0],
      [-112, -110, 470],
      [112, -110, 470],
      [-112, -8, 470],
      [112, -8, 470],
    ],
    GUN,
  );
  b.slab(0, 490, -110, -15, 95, 30, 85, 25, 0, 0, GUN_LIGHT);
  b.cyl([-175, -40, 0], [175, -40, 0], 62, 62, 8, RUST);
  // Hazard striping on both sides.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) b.box(s * 150, -85, 150 + k * 95, 14, 120, 40, HAZARD, E_NONE, -0.5, 0, 0);
  }
  // Lower fangs and the glowing tongue plate.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = 220 + k * 58;
      b.cone([s * (98 - k * 4), -6, z], [s * (96 - k * 4), 58, z - 6], 20, 4, CLAW);
    }
  }
  b.box(0, -10, 250, 170, 10, 390, FURNACE, E_THROAT);
  return b.build();
}

function buildArm(s) {
  const b = new PartBuilder(s < 0 ? 61 : 67);
  const E = mirror(RIG.ELBOW, s);
  const W = mirror(RIG.WRIST, s);
  b.ball([0, 0, 0], 165, RUST, E_JOINT, 1);
  b.cyl([0, 0, 0], E, 150, 120, 6, GUN);
  const m = lerp3([0, 0, 0], E, 0.45);
  b.box(m[0] + s * 110, m[1], m[2], 60, 460, 260, GUN_LIGHT, E_NONE, -0.4, 0, s * 0.18);
  b.ball(E, 125, RUST, E_JOINT, 1);
  // Forearm: heavy, widening toward the wrist, with a hydraulic ram along its back.
  b.cyl(E, W, 140, 175, 6, GUN_LIGHT);
  b.cyl(add3(E, [0, 90, -110]), add3(W, [0, 100, -140]), 34, 34, 6, STEEL_DARK);
  b.ring(lerp3(E, W, 0.9), W, 190, 60, RUST_DARK);
  // Grab: a palm block, three hooked fingers and a thumb.
  const d = [W[0] - E[0], W[1] - E[1], W[2] - E[2]];
  const dl = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  const f = [d[0] / dl, d[1] / dl, d[2] / dl];
  const palm = add3(W, [f[0] * 120, f[1] * 120, f[2] * 120]);
  b.box(palm[0], palm[1], palm[2], 250, 150, 230, GUN_DARK, E_NONE, Math.atan2(f[2], -f[1]) - Math.PI / 2, 0, 0);
  for (let k = -1; k <= 1; k++) {
    const root = add3(palm, [k * 85, f[1] * 110 - 20, f[2] * 110]);
    const knuckle = add3(root, [k * 20, f[1] * 170, f[2] * 170 + 40]);
    const tip = add3(knuckle, [k * 10, -130, -60]);
    b.cyl(root, knuckle, 44, 38, 5, CLAW);
    b.ball(knuckle, 40, RUST_DARK);
    b.cone(knuckle, tip, 36, 5, CLAW);
  }
  const t0 = add3(palm, [-s * 130, -20, -30]);
  const t1 = add3(t0, [-s * 60, -150, 90]);
  b.cyl(t0, t1, 40, 26, 5, CLAW);
  return b.build();
}

function buildTailPart(points, radii, seed, plug) {
  const b = new PartBuilder(seed);
  for (let i = 0; i < points.length - 1; i++) {
    b.cyl(points[i], points[i + 1], radii[i], radii[i + 1], 8, i % 2 ? GUN_DARK : CABLE);
    b.ring(points[i + 1], points[i], radii[i + 1] + 16, 40, i % 2 ? RUST : RUST_DARK);
  }
  if (plug) {
    // A heavy two-pronged plug on the tip.
    const n = points.length;
    const a = points[n - 2];
    const p = points[n - 1];
    const d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const u = [d[0] / l, d[1] / l, d[2] / l];
    const end = add3(p, [u[0] * 170, u[1] * 170, u[2] * 170]);
    b.cyl(p, end, 120, 110, 6, STEEL_DARK);
    b.ring(lerp3(p, end, 0.5), end, 128, 40, HAZARD);
    for (const s of [-1, 1]) {
      const o = [u[2] * s * 50, 0, -u[0] * s * 50];
      const base = add3(end, o);
      b.cyl(base, add3(base, [u[0] * 130, u[1] * 130, u[2] * 130]), 22, 22, 4, STEEL);
    }
  }
  return b.build();
}

// ---------------------------------------------------------------- material

// One Lambert material for every part: flat shaded, vertex coloured, plus
//   emission = colour * (aEmit.x * uPower + aEmit.y * uCharge)   (optics, embers, furnace)
//   + a cold rim light (keeps the silhouette readable against the storm sky)
//   + colour * uFlash                                           (lightning flashes)
export function makeBeastMaterial() {
  const uniforms = {
    uCharge: { value: 0 },
    uPower: { value: 0 },
    uFlash: { value: 0 },
    uRim: { value: new THREE.Color(0.26, 0.32, 0.46) },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aEmit;\nvarying vec2 vEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCharge;\nuniform float uPower;\nuniform float uFlash;\nuniform vec3 uRim;\nvarying vec2 vEmit;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '\ttotalEmissiveRadiance += diffuseColor.rgb * (vEmit.x * uPower + vEmit.y * uCharge + uFlash);',
          '\tfloat rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
          '\ttotalEmissiveRadiance += uRim * (rimK * rimK * rimK);',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'robotBeast';
  material.userData.uniforms = uniforms;
  return material;
}

// Builds every part's geometry: { legs, torso, neck, head, jaw, armL, armR, tailA, tailB }.
export function buildBeastGeometries() {
  return {
    legs: buildLegs(),
    torso: buildTorso(),
    neck: buildNeck(),
    head: buildHead(),
    jaw: buildJaw(),
    armL: buildArm(-1),
    armR: buildArm(1),
    tailA: buildTailPart(RIG.TAIL_A, RIG.TAIL_A_R, 71, false),
    tailB: buildTailPart(RIG.TAIL_B, RIG.TAIL_B_R, 73, true),
  };
}
