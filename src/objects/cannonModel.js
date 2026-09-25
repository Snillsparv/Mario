// The cannon's look (objects/Cannon.js puts it on the lawn at layout.CANNON): an original
// design, low-poly and flat-shaded with baked vertex colours like the rest of the grounds.
//
//   emplacement  a round drum of weathered stone blocks (two staggered courses, a pale coping
//                on top) sunk into the lawn, with a brass swivel ring set into its top
//   turret       a squat teal-painted iron drum with a cream stripe and brass rivets that
//                turns on the ring (yaw), with a well in its top for the breech to swing down
//                into and two iron cheeks carrying the trunnion bearings (brass caps)
//   barrel       a thick dark-iron barrel on brass trunnions (pitch) with a round knob behind
//                the breech, a swelling muzzle with a brass lip and a dark bore, teal and cream
//                painted bands between brass hoops
//   loading pad  a round stone slab beside the emplacement (a 14-unit lip over the lawn) with
//                a brass rim, a glowing teal ring that pulses and a teal-and-cream compass
//                rose; a little teal-and-cream pennant flutters on a pole beside it
//
// Local frames: the base (emplacement, pad, pennant) and the turret have their origin at the
// emplacement centre on the ground (+Y up; the turret turns about +Y and its barrel points
// along +Z at yaw 0); the barrel's origin is its pivot (the trunnions), +Z along the bore.
// All three share one material (makeCannonMaterial): unlit vertex colours plus two shader
// extras driven by uniforms, a glow added to vertices with the `glow` attribute (the pad's
// ring; the storm's tint never dims it) and a flutter for vertices with the `wave` attribute
// (the pennant). Three draw calls: base, turret, barrel (~1.3k triangles in all).

import * as THREE from 'three';
import { bakeLighting } from '../render/materials.js';
import { makeRng, TAU } from '../core/math.js';

const DEG = Math.PI / 180;

// Sizes (units ~ cm) relative to the ground height G at the emplacement centre.
export const CANNON_DIMS = {
  BASE_R: 270, // emplacement drum radius
  BASE_TOP: 60, // its top (the flat stone floor) above G
  BASE_SINK: 70, // ...and how far it reaches below G
  RING_R: [150, 202], // brass swivel ring (inner, outer radius) on the drum top
  TURRET_R: 168,
  TURRET_BOTTOM: 70,
  TURRET_TOP: 134,
  WELL_R: 102, // the breech's well in the turret top...
  WELL_FLOOR: 84, // ...down to here
  PIVOT_Y: 240, // the trunnions (the barrel's pivot) above G
  MUZZLE: 345, // pivot -> centre of the muzzle mouth
  BREECH: 125, // pivot -> breech face (the knob reaches KNOB further)
  KNOB: 30,
  BARREL_R: 76, // at the breech (it tapers to ~60 before the muzzle swell)
  BORE_R: 42,
  CHEEK_X: 100, // the cheeks' inner faces this far either side of the pivot...
  CHEEK_T: 28, // ...this thick
  PAD_DIST: 480, // loading pad centre from the emplacement centre
  PAD_R: 100,
  PAD_LIP: 14, // pad top above the highest ground under it
  EXIT_DIST: 700, // climbing out lands this far out along the pad's direction
  REST_PITCH: 70 * DEG, // the idle barrel points up over the castle
  PAD_ANGLE: 120 * DEG, // default pad direction off the rest yaw (its left-rear)
  SIDES: 16,
  // Colliders: a 12-sided prism for the emplacement (flat top at BASE_TOP) and one round the
  // turret and breech (flat top at TURRET_COLLIDER_TOP, about the barrel's top), the pad's top.
  TURRET_COLLIDER_R: 150,
  TURRET_COLLIDER_TOP: 320,
};

const C = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
export const CANNON_COLORS = {
  stone: C(0xab9f8a),
  stoneDark: C(0x92876f),
  coping: C(0xc9bfa8),
  mortar: C(0x6d675c),
  brass: C(0xe3ac46),
  brassDark: C(0xa9762a),
  iron: C(0x3b424c),
  ironDark: C(0x23272e),
  teal: C(0x1fa89d),
  tealDark: C(0x167c75),
  cream: C(0xf2e4c0),
  bore: C(0x07070a),
  well: C(0x15171b),
  pole: C(0x5a544e),
  padStone: C(0xc6bfad),
  glow: C(0x4af2dd),
};

// ---------------------------------------------------------------- mesh builder

// Flat-shaded triangle soup with per-vertex colour, glow and wave attributes. Every polygon
// is wound so its normal points along `out` (a hint: any vector on its outer side).
class Mesher {
  constructor() {
    this.pos = [];
    this.col = [];
    this.glow = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  tri(a, b, c, col, out, glow = 0) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-9) return;
    const vs = nx * out[0] + ny * out[1] + nz * out[2] < 0 ? [a, c, b] : [a, b, c];
    for (const v of vs) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(col[0], col[1], col[2]);
      this.glow.push(glow);
    }
  }

  // Convex polygon (a fan) facing `out`.
  face(pts, col, out, glow = 0) {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], col, out, glow);
  }

  // Surface of revolution about +Y through (cx, cz): profile [[r, y], ...]; colorAt(band,
  // side) per quad. Each band faces along the profile's normal (dy, -dr) turned round the axis:
  // away from it where the profile runs up, toward it where it runs down (the inside of a well
  // or a bore), up where it runs in toward the axis, down where it runs out.
  lathe(cx, cz, profile, sides, colorAt, { a0 = 0, glowAt = null } = {}) {
    const p = (r, y, t) => [cx + Math.sin(t) * r, y, cz + Math.cos(t) * r];
    for (let j = 0; j + 1 < profile.length; j++) {
      const [r0, y0] = profile[j];
      const [r1, y1] = profile[j + 1];
      const dr = r1 - r0;
      const dy = y1 - y0;
      for (let i = 0; i < sides; i++) {
        const a = a0 + (i / sides) * TAU;
        const b = a0 + ((i + 1) / sides) * TAU;
        const m = (a + b) / 2;
        const out = [Math.sin(m) * dy, -dr, Math.cos(m) * dy];
        const col = colorAt(j, i);
        const glow = glowAt ? glowAt(j, i) : 0;
        const q = [p(r0, y0, a), p(r0, y0, b), p(r1, y1, b), p(r1, y1, a)];
        if (r0 < 1e-6) this.tri(q[0], q[2], q[3], col, out, glow);
        else if (r1 < 1e-6) this.tri(q[0], q[1], q[2], col, out, glow);
        else this.face(q, col, out, glow);
      }
    }
  }

  // Appends another mesher's triangles transformed by `matrix`.
  append(src, matrix) {
    const v = new THREE.Vector3();
    for (let i = 0; i < src.pos.length; i += 3) {
      v.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
    }
    this.col.push(...src.col);
    this.glow.push(...src.glow);
  }

  // `wave` (optional): a per-vertex flutter weight (0..1). The glowing faces keep their colour
  // (no sun shading).
  build(light, wave = null) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('glow', new THREE.Float32BufferAttribute(this.glow, 1));
    geo.setAttribute('wave', new THREE.Float32BufferAttribute(wave ?? new Array(this.count).fill(0), 1));
    geo.computeVertexNormals();
    bakeLighting(geo, light);
    const c = geo.attributes.color.array;
    for (let i = 0; i < this.glow.length; i++) {
      if (this.glow[i] <= 0) continue;
      for (let k = 0; k < 3; k++) c[i * 3 + k] = this.col[i * 3 + k];
    }
    geo.computeBoundingSphere();
    return geo;
  }
}

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// A fixed "sun" for the moving parts, baked in their own frames (up, a little to the front and
// side): they keep a readable top-lit shading however they turn.
const LOCAL_SUN = (() => {
  const v = [0.35, 0.85, 0.4];
  const l = Math.hypot(...v);
  return { x: v[0] / l, y: v[1] / l, z: v[2] / l };
})();

// ---------------------------------------------------------------- base

// The pad's top: PAD_LIP over the highest ground under it (`groundAt(lx, lz)`: ground height
// relative to G at a local point).
export function padTopY(groundAt, px, pz) {
  const R = CANNON_DIMS.PAD_R + 8;
  let hi = groundAt(px, pz);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    hi = Math.max(hi, groundAt(px + Math.sin(a) * R, pz + Math.cos(a) * R));
  }
  return hi + CANNON_DIMS.PAD_LIP;
}

// Emplacement, loading pad and pennant in the base frame. `padYaw`: the pad's direction from
// the centre (a world yaw: the base is not rotated). Returns { geometry, pad: { x, y, z } (its
// top centre), flagDir: [x, z] (the pennant's flutter direction) }.
export function buildBaseGeometry({ padYaw, groundAt = () => 0, seed = 7 }) {
  const D = CANNON_DIMS;
  const K = CANNON_COLORS;
  const m = new Mesher();
  const rng = makeRng(seed);
  const S = D.SIDES;
  // Stone drum: two courses of blocks, joints staggered, a tone per block, a recessed mortar
  // line between them, and a bevelled coping that overhangs a little.
  const tones = Array.from({ length: S * 2 }, () => 0.82 + rng() * 0.3);
  const R = D.BASE_R;
  const T = D.BASE_TOP;
  m.lathe(0, 0, [[R, -D.BASE_SINK], [R, 20]], S, (j, i) => shade(K.stoneDark, tones[i]));
  m.lathe(0, 0, [[R, 20], [R - 4, 22], [R - 4, 25], [R, 27]], S, () => K.mortar, { a0: Math.PI / S });
  m.lathe(0, 0, [[R, 27], [R, T - 12]], S, (j, i) => shade(K.stone, tones[S + i]), { a0: Math.PI / S });
  m.lathe(0, 0, [[R, T - 12], [R + 12, T - 8], [R + 12, T - 2], [R + 2, T], [D.RING_R[1] + 8, T]], S, (j, i) =>
    j === 3 ? shade(K.coping, 0.94 + 0.08 * (i % 2)) : j === 1 ? shade(K.coping, 1.04) : K.coping,
  );
  // Brass swivel ring: a raised studded band the turret turns on.
  const [ri, ro] = D.RING_R;
  m.lathe(0, 0, [[ro + 8, T], [ro, T + 7], [ri, T + 7], [ri - 6, T]], 24, (j) => (j === 1 ? K.brass : K.brassDark));
  m.lathe(0, 0, [[ri - 6, T], [0, T]], 12, () => K.ironDark);

  // Loading pad: a stone slab on the (sloping) lawn with a brass rim, the glowing ring and a
  // cream-and-brass boss, a compass rose inlaid round it.
  const px = Math.sin(padYaw) * D.PAD_DIST;
  const pz = Math.cos(padYaw) * D.PAD_DIST;
  const top = padTopY(groundAt, px, pz);
  const P = D.PAD_R;
  m.lathe(px, pz, [[P + 8, top - 36], [P + 8, top - 5], [P + 2, top], [P - 8, top]], 20, (j) => (j === 0 ? K.padStone : j === 1 ? K.brassDark : K.brass));
  m.lathe(px, pz, [[P - 8, top], [P - 22, top + 0.5]], 20, () => K.brassDark);
  m.lathe(px, pz, [[P - 22, top + 0.5], [P - 50, top + 0.5]], 20, () => K.glow, { glowAt: () => 1 });
  m.lathe(px, pz, [[P - 50, top + 0.5], [28, top + 1]], 20, (j, i) => shade(K.padStone, 0.95 + 0.06 * (i % 2)));
  m.lathe(px, pz, [[28, top + 1], [17, top + 6], [0, top + 7]], 10, (j) => (j ? K.cream : K.brass));
  for (let k = 0; k < 4; k++) {
    const a = padYaw + Math.PI + (k * Math.PI) / 2;
    const at = (d, da) => [px + Math.sin(a + da) * d, top + 1.3, pz + Math.cos(a + da) * d];
    m.tri(at(P - 54, 0), at(30, 0.55), at(30, -0.55), k === 0 ? K.cream : K.teal, [0, 1, 0]);
  }

  // Pennant pole beside the pad (on its left, seen from the cannon), a brass ball on top.
  const side = padYaw - Math.PI / 2;
  const fx = px + Math.sin(side) * (P + 42);
  const fz = pz + Math.cos(side) * (P + 42);
  const fy = padTopY(groundAt, fx, fz) - D.PAD_LIP;
  const poleTop = fy + 330;
  m.lathe(fx, fz, [[8, fy - 20], [6, poleTop]], 6, () => K.pole);
  m.lathe(fx, fz, [[0, poleTop - 2], [12, poleTop + 10], [0, poleTop + 24]], 6, (j) => (j ? K.brass : K.brassDark));
  // The pennant streams out away from the cannon: a tapering strip in three panels (teal,
  // cream, teal), drawn from both sides; the shader flutters it (wave 0 at the pole .. 1 at
  // the tip) across its plane.
  const ux = Math.sin(padYaw);
  const uz = Math.cos(padYaw);
  const len = 125;
  const hi = poleTop - 8;
  const lo = poleTop - 80;
  const first = m.count;
  const segs = 3;
  const n = [-uz, 0, ux];
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const pinch = (t) => (hi - lo) * 0.46 * t;
    const q = (t, y) => [fx + ux * len * t, y, fz + uz * len * t];
    const quad = [q(t0, hi - pinch(t0)), q(t1, hi - pinch(t1)), q(t1, lo + pinch(t1)), q(t0, lo + pinch(t0))];
    const col = s === 1 ? K.cream : K.teal;
    m.face(quad, col, n);
    m.face(quad, shade(col, 0.85), [-n[0], 0, -n[2]]);
  }
  const wave = new Array(m.count).fill(0);
  for (let i = first; i < m.count; i++) {
    const along = (m.pos[i * 3] - fx) * ux + (m.pos[i * 3 + 2] - fz) * uz;
    wave[i] = Math.max(0, along / len);
  }
  const geometry = m.build({ ambient: 0.62, diffuse: 0.5, maxBright: 1.1, occlusion: baseOcclusion }, wave);
  return { geometry, pad: { x: px, y: top, z: pz }, flagDir: [n[0], n[2]] };
}

// A dark foot where the drum meets the lawn (fake AO), like the castle's plinths.
function baseOcclusion(x, y) {
  return 0.7 + 0.3 * Math.min(1, Math.max(0, (y + 10) / 45));
}

// ---------------------------------------------------------------- turret

export function buildTurretGeometry() {
  const D = CANNON_DIMS;
  const K = CANNON_COLORS;
  const m = new Mesher();
  const y0 = D.TURRET_BOTTOM;
  const y1 = D.TURRET_TOP;
  const R = D.TURRET_R;
  // Drum: a brass foot bevel, teal walls with a cream stripe, a chamfered rim, the top annulus
  // and the dark well in it.
  m.lathe(
    0,
    0,
    [[R - 8, y0 - 6], [R, y0 + 4], [R, y0 + 20], [R, y0 + 36], [R, y1 - 8], [R - 10, y1], [D.WELL_R + 8, y1], [D.WELL_R, y1 - 4]],
    16,
    (j) => {
      if (j === 0) return K.brassDark;
      if (j === 2) return K.cream;
      if (j === 4) return K.tealDark;
      if (j >= 5) return K.brassDark;
      return K.teal;
    },
  );
  m.lathe(0, 0, [[D.WELL_R, y1 - 4], [D.WELL_R, D.WELL_FLOOR]], 16, () => K.well);
  m.lathe(0, 0, [[D.WELL_R, D.WELL_FLOOR], [0, D.WELL_FLOOR]], 12, () => K.well);
  // Brass rivets along the stripe's edges.
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * TAU;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    for (const y of [y0 + 12, y0 + 44]) {
      const s = 4.5;
      const c = [sa * R, y, ca * R];
      const tip = [sa * (R + 5), y, ca * (R + 5)];
      const t = [ca * s, 0, -sa * s];
      const corners = [
        [c[0] - t[0], y - s, c[2] - t[2]],
        [c[0] + t[0], y - s, c[2] + t[2]],
        [c[0] + t[0], y + s, c[2] + t[2]],
        [c[0] - t[0], y + s, c[2] - t[2]],
      ];
      for (let e = 0; e < 4; e++) m.tri(corners[e], corners[(e + 1) % 4], tip, e === 3 ? shade(K.brass, 1.1) : K.brass, [sa, 0, ca]);
    }
  }
  // Cheeks: iron plates either side of the barrel, rounded over the trunnions, brass bearing
  // caps outside.
  const P = D.PIVOT_Y;
  const outline = [[-78, y1], [78, y1]];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    outline.push([Math.cos(a) * 60, P + Math.sin(a) * 52]);
  }
  for (const s of [-1, 1]) {
    const xi = s * D.CHEEK_X;
    const xo = s * (D.CHEEK_X + D.CHEEK_T);
    m.face(outline.map(([z, y]) => [xi, y, z]), shade(K.iron, 0.9), [-s, 0, 0]);
    m.face(outline.map(([z, y]) => [xo, y, z]), K.iron, [s, 0, 0]);
    for (let k = 0; k < outline.length; k++) {
      const a = outline[k];
      const b = outline[(k + 1) % outline.length];
      const out = k === 0 ? [0, -1, 0] : [0, (a[1] + b[1]) / 2 - (P - 30), (a[0] + b[0]) / 2];
      m.face([[xi, a[1], a[0]], [xo, a[1], a[0]], [xo, b[1], b[0]], [xi, b[1], b[0]]], K.ironDark, out);
    }
    const cap = [];
    const rim = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      cap.push([xo + s * 9, P + Math.sin(a) * 25, Math.cos(a) * 25]);
      rim.push([xo, P + Math.sin(a) * 30, Math.cos(a) * 30]);
    }
    m.face(cap, K.brass, [s, 0, 0]);
    for (let k = 0; k < 10; k++) {
      const a = rim[k];
      const b = rim[(k + 1) % 10];
      const mid = [0, (a[1] + b[1]) / 2 - P, (a[2] + b[2]) / 2];
      m.face([a, cap[k], cap[(k + 1) % 10], b], K.brassDark, [s * 0.3, mid[1], mid[2]]);
    }
  }
  return m.build({ sun: LOCAL_SUN, ambient: 0.6, diffuse: 0.55, maxBright: 1.12 });
}

// ---------------------------------------------------------------- barrel

export function buildBarrelGeometry() {
  const D = CANNON_DIMS;
  const K = CANNON_COLORS;
  const B = D.BREECH;
  const M = D.MUZZLE;
  const R = D.BARREL_R;
  // Profile along the bore, [radius, z] from the knob to the muzzle and into the bore, with
  // the colour of the band that starts at each point.
  const prof = [
    [0, -B - D.KNOB, K.ironDark], // the knob (cascabel)
    [16, -B - D.KNOB + 2, K.ironDark],
    [24, -B - 14, K.ironDark],
    [14, -B - 6, K.ironDark],
    [50, -B - 3, K.ironDark],
    [R - 4, -B, K.iron], // breech face
    [R, -B + 8, K.brass],
    [R + 6, -B + 14, K.brass], // brass base ring
    [R + 6, -B + 32, K.brass],
    [R, -B + 38, K.iron],
    [R - 1, -44, K.brass],
    [R + 5, -38, K.brass], // hoop behind the trunnions
    [R + 5, -22, K.brass],
    [R - 2, -16, K.iron],
    [R - 4, 60, K.teal],
    [R - 6, 66, K.teal], // teal band
    [R - 8, 142, K.teal],
    [R - 2, 148, K.brass], // hoop
    [R - 2, 164, K.brass],
    [R - 9, 170, K.iron],
    [R - 11, 196, K.cream],
    [R - 12, 202, K.cream], // cream band
    [R - 14, 262, K.iron],
    [R - 15, 286, K.iron],
    [R - 9, 300, K.ironDark], // muzzle swell
    [R - 3, 318, K.ironDark],
    [R - 1, M - 12, K.brass],
    [R + 3, M - 7, K.brass], // brass lip
    [R + 3, M, K.brassDark],
    [D.BORE_R, M, K.bore], // mouth, into the bore
    [D.BORE_R, M - 40, K.bore],
    [0, M - 40, K.bore],
  ];
  const tube = new Mesher();
  tube.lathe(0, 0, prof.map(([r, z]) => [r, z]), 14, (j) => prof[j][2], { a0: Math.PI / 14 });
  // Trunnions: short brass pins through the pivot, into the cheeks.
  const pins = new Mesher();
  for (const s of [-1, 1]) {
    const a = s * (R - 8);
    const b = s * (D.CHEEK_X + D.CHEEK_T - 4);
    pins.lathe(0, 0, s < 0 ? [[0, b], [22, b], [22, a]] : [[22, a], [22, b], [0, b]], 8, () => K.brass);
  }
  const m = new Mesher();
  m.append(tube, new THREE.Matrix4().makeRotationX(Math.PI / 2)); // +Y -> +Z
  m.append(pins, new THREE.Matrix4().makeRotationZ(-Math.PI / 2)); // +Y -> +X
  return m.build({ sun: LOCAL_SUN, ambient: 0.55, diffuse: 0.62, maxBright: 1.15 });
}

// ---------------------------------------------------------------- material

// One material for the three parts: unlit vertex colours times `color` (the storm dims it),
// plus the pad ring's glow (uniform cannonGlow: its colour times the pulse, added on top, so
// the tint never dims it) and the pennant's flutter (cannonTime, seconds; cannonWaveDir, the
// horizontal direction across the pennant's plane). Uniforms: material.userData.uniforms.
export function makeCannonMaterial() {
  const uniforms = {
    cannonGlow: { value: new THREE.Color(0, 0, 0) },
    cannonTime: { value: 0 },
    cannonWaveDir: { value: new THREE.Vector2(1, 0) },
  };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.name = 'cannon';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float glow;
attribute float wave;
uniform float cannonTime;
uniform vec2 cannonWaveDir;
varying float vCannonGlow;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCannonGlow = glow;
if (wave > 0.0) {
  float f = sin(cannonTime * 6.0 - wave * 5.0) * 13.0 + sin(cannonTime * 10.7 - wave * 8.0) * 4.0;
  transformed.xz += cannonWaveDir * f * wave;
  transformed.y += sin(cannonTime * 4.3 - wave * 4.0) * 5.0 * wave;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 cannonGlow;
varying float vCannonGlow;`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb += cannonGlow * vCannonGlow;');
  };
  mat.customProgramCacheKey = () => 'cannon-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}
