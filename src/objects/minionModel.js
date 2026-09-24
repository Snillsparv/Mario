// Geometry and material of the robot lizard minions: small original mechanical lizards, the
// Rustmaw's mini cousins (same gunmetal plating, rust-red joints and palette), each ~225 long.
//
// Design: a low, flattened gunmetal body with a row of short steel dorsal spikes and a rust
// power cell on the back; a wedge head with a glowing red eye stripe wrapped round it like a
// visor, ember nostrils and a hinged lower jaw, both lined with small steel teeth; four
// splayed legs with rust ball joints and three-clawed feet; and a whip tail banded in rust,
// ending in a small blade fin.
//
// All minions are ONE InstancedMesh (one draw call). The legs, tail and jaw are animated in the
// vertex shader, so every instance can walk at its own gait without a rig:
//   per vertex    aPart = (kind, param), aPivot (the part's joint), aEmit (glow: power, charge)
//                 kind 0 body/head (rigid), 1 leg (param: gait phase offset), 2 tail (param:
//                 0 at the root .. 1 at the tip), 3 jaw
//   per instance  aAnim  = (gait phase, stride 0..1, jaw open 0..1, tail phase)
//                 aAnim2 = (eye power 0..1, eye flare 0..1, tail swing (radians), unused)
// Legs swing fore and aft about a vertical axis through the shoulder/hip (diagonal pairs in
// step) and lift while swinging forward; the tail's swing travels from the root to the tip; the
// jaw drops about its hinge. Flat shading comes from screen-space derivatives, so the deformed
// normals need no extra work. Rig space: soles on y = 0, facing +Z, units = world units.

import * as THREE from 'three';
import { PartBuilder, PALETTE, scaledFog } from './robotBeastModel.js';

const { GUN, GUN_LIGHT, GUN_DARK, STEEL, STEEL_DARK, RUST, RUST_DARK, CLAW, TOOTH, EYE, EMBER } = PALETTE;

export const MINION_SCALE = 0.84;

// Emission presets [eye power channel, flare channel] (see aAnim2).
const E_NONE = [0, 0];
const E_EYE = [2.4, 2.2];
const E_JOINT = [0.25, 0.3];
const E_EMBER = [0.8, 1.2];

const S = MINION_SCALE;
// Landmarks (rig space, already scaled).
export const MINION_RIG = {
  EYE: [0, 40 * S, 73 * S], // the eye stripe's centre (glow sprite)
  SNOUT: 100 * S, // snout tip ahead of the origin
  TAIL_TIP: -172 * S,
  BACK: 56 * S, // top of the back (stomps land here)
  BODY_Y: 34 * S, // body axis height
  LENGTH: (100 + 172) * S,
};

const KIND = { BODY: 0, LEG: 1, TAIL: 2, JAW: 3 };

// Linear interpolation of a polyline value table [[z, v], ...] at z.
function along(table, z) {
  if (z <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i];
    if (z <= z1) {
      const [z0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return table[table.length - 1][1];
}

const BODY_PTS = [
  [0, 30, -52],
  [0, 34, -26],
  [0, 36, 6],
  [0, 35, 32],
  [0, 33, 50],
];
const BODY_R = [
  [19, 14],
  [29, 19],
  [31, 21],
  [27, 18],
  [19, 14],
];
const BACK_TOP = BODY_PTS.map((p, i) => [p[2], p[1] + BODY_R[i][1]]);

// Head wedge half-width, bottom and top at z (from the neck at 46 to the snout at 100).
const headHalf = (z) => 20.5 + ((9.5 - 20.5) * (z - 46)) / 54;
const headTop = (z) => 51 + ((36 - 51) * (z - 46)) / 54;
const headBottom = (z) => 21 + ((24 - 21) * (z - 46)) / 54;

function wedge(b, z0, z1, half, bottom, top, color, emit, grow = 0) {
  const c = [];
  for (let bit = 0; bit < 8; bit++) {
    const z = bit & 4 ? z1 : z0;
    const hx = half(z) + grow;
    c.push([bit & 1 ? hx : -hx, bit & 2 ? top(z) + grow : bottom(z) - grow, z]);
  }
  b.hexa(c, color, emit, 0.04);
}

function buildBody() {
  const b = new PartBuilder(301);
  b.tube(BODY_PTS, BODY_R, 8, (i, sn) => (sn < -0.35 ? GUN_DARK : GUN), E_NONE);
  // Dorsal spikes and a rust power cell.
  for (const [z, color] of [[-38, STEEL], [-19, GUN_LIGHT], [21, GUN_LIGHT], [37, STEEL]]) {
    const top = along(BACK_TOP, z);
    b.cone([0, top - 3, z + 3], [0, top + 11, z - 7], 6, 4, color);
  }
  b.box(0, along(BACK_TOP, 1) + 1, 1, 15, 8, 22, RUST, E_JOINT);
  b.box(0, along(BACK_TOP, 1) + 5.5, 1, 9, 2, 16, EMBER, E_EMBER);
  // Shoulder and hip plates.
  for (const s of [-1, 1]) {
    b.box(s * 19, 47, 29, 16, 5, 22, GUN_LIGHT, E_NONE, 0, 0, s * 0.55);
    b.box(s * 19, 45, -33, 16, 5, 22, GUN_LIGHT, E_NONE, 0, 0, s * 0.55);
  }
  // Neck collar.
  b.ring([0, 34, 47], [0, 34, 60], 17.5, 9, RUST_DARK, E_JOINT, 8);
  // Head: a wedge with a raised brow plate, the eye stripe wrapped round it, ember nostrils and
  // small teeth under the upper jaw.
  wedge(b, 46, 100, headHalf, headBottom, headTop, GUN);
  wedge(b, 48, 70, (z) => headHalf(z) - 3, (z) => headTop(z) - 2, (z) => headTop(z) + 3, GUN_LIGHT, E_NONE);
  wedge(b, 64, 82, headHalf, () => 36.5, (z) => headTop(z) - 1, EYE, E_EYE, 1.6);
  for (const s of [-1, 1]) {
    b.box(s * 4, 35, 98.5, 3.5, 3, 3, EMBER, E_EMBER);
    for (const z of [70, 80, 90]) b.cone([s * 7, 24, z], [s * 7, 17, z + 2], 2.6, 4, TOOTH);
  }
  return b;
}

function buildJaw() {
  const b = new PartBuilder(302);
  wedge(b, 50, 98, (z) => 15 + ((7 - 15) * (z - 50)) / 48, (z) => 13 + ((20 - 13) * (z - 50)) / 48, () => 24, GUN_DARK);
  b.box(0, 14, 70, 17, 4, 26, RUST_DARK, E_JOINT);
  for (const s of [-1, 1]) for (const z of [66, 76, 86, 94]) b.cone([s * 6, 23, z], [s * 6, 30, z + 1], 2.4, 4, TOOTH);
  return b;
}

// A leg from the shoulder/hip joint out to the elbow/knee, down to the foot, clawed.
function buildLeg(s, front) {
  const b = new PartBuilder(310 + (front ? 0 : 2) + (s > 0 ? 1 : 0));
  const fz = front ? 1 : -1;
  const top = [s * 22, 32, front ? 30 : -34];
  const mid = [s * 50, 36, front ? 38 : -44];
  const low = [s * 60, 8, front ? 46 : -48];
  const foot = [s * 62, 3, front ? 51 : -45];
  b.ball(top, 10, RUST, E_JOINT, 1);
  b.cyl(top, mid, 8, 7, 6, GUN);
  b.bonePlate(top, mid, [0, 1, 0], 6, 11, 4, GUN_LIGHT);
  b.ball(mid, 7.5, RUST, E_JOINT, 0);
  b.cyl(mid, low, 6.5, 5, 6, GUN_LIGHT);
  b.cyl([mid[0] + s * 3, mid[1] - 6, mid[2] - fz * 4], [low[0] + s * 2, low[1] + 10, low[2] - fz * 4], 2.5, 2.5, 4, STEEL_DARK);
  b.ball(low, 5.5, RUST, E_JOINT, 0);
  b.slab(foot[0], foot[2], 0, 7, 9, 11, 7, 8, 0, 0, GUN_DARK, E_NONE, 0.04);
  for (const a of [-0.45, 0, 0.45]) {
    const dx = Math.sin(a + s * 0.25);
    const dz = Math.cos(a + s * 0.25);
    const root = [foot[0] + dx * 7, 3, foot[2] + dz * 9];
    b.cone(root, [root[0] + dx * 12, 0.5, root[2] + dz * 12], 3, 4, CLAW);
  }
  return { b, pivot: top, phase: (s < 0) === front ? 0 : Math.PI };
}

function buildTail() {
  const b = new PartBuilder(320);
  const pts = [
    [0, 30, -50],
    [0, 27, -80],
    [0, 23, -108],
    [0, 19, -132],
    [0, 16, -154],
  ];
  const radii = [
    [15, 12],
    [11, 9],
    [8, 6.5],
    [5, 4.5],
    [2.5, 2.5],
  ];
  b.tube(pts, radii, 6, (i) => (i % 2 ? RUST_DARK : GUN), E_NONE, { capStart: false, emitAt: (i) => (i % 2 ? E_JOINT : E_NONE) });
  for (const [z, h] of [[-70, 9], [-96, 7], [-120, 5]]) {
    const top = along([[-50, 42], [-80, 36], [-108, 29.5], [-132, 23.5]], z);
    b.cone([0, top - 2, z + 2], [0, top + h, z - 5], 3.5, 4, STEEL);
  }
  // Blade fin at the tip.
  b.hexa(
    [
      [-1.5, 11, -148],
      [1.5, 11, -148],
      [-1.5, 22, -150],
      [1.5, 22, -150],
      [-1, 14, -172],
      [1, 14, -172],
      [-1, 19, -170],
      [1, 19, -170],
    ],
    RUST,
    E_JOINT,
  );
  b.ring([0, 30, -50], [0, 30, -40], 16.5, 7, RUST_DARK, E_JOINT, 8);
  return { b, pivot: [0, 30, -50] };
}

// One non-indexed geometry for the whole minion with the animation attributes (see header).
export function buildMinionGeometry() {
  const parts = [];
  parts.push({ b: buildBody(), kind: KIND.BODY, pivot: [0, 0, 0], param: () => 0 });
  parts.push({ b: buildJaw(), kind: KIND.JAW, pivot: [0, 25, 50], param: () => 0 });
  for (const front of [true, false]) {
    for (const s of [-1, 1]) {
      const { b, pivot, phase } = buildLeg(s, front);
      parts.push({ b, kind: KIND.LEG, pivot, param: () => phase });
    }
  }
  const tail = buildTail();
  parts.push({ b: tail.b, kind: KIND.TAIL, pivot: tail.pivot, param: (z) => Math.min(1, Math.max(0, (-50 - z) / 122)) });

  const n = parts.reduce((k, p) => k + p.b.pos.length / 3, 0);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const emit = new Float32Array(n * 2);
  const pivot = new Float32Array(n * 3);
  const part = new Float32Array(n * 2);
  let v = 0;
  for (const p of parts) {
    const { pos: bp, col: bc, emit: be } = p.b;
    for (let i = 0; i < bp.length / 3; i++, v++) {
      pos[v * 3] = bp[i * 3] * S;
      pos[v * 3 + 1] = bp[i * 3 + 1] * S;
      pos[v * 3 + 2] = bp[i * 3 + 2] * S;
      col.set([bc[i * 3], bc[i * 3 + 1], bc[i * 3 + 2]], v * 3);
      emit[v * 2] = be[i * 2];
      emit[v * 2 + 1] = be[i * 2 + 1];
      pivot[v * 3] = p.pivot[0] * S;
      pivot[v * 3 + 1] = p.pivot[1] * S;
      pivot[v * 3 + 2] = p.pivot[2] * S;
      part[v * 2] = p.kind;
      part[v * 2 + 1] = p.param(bp[i * 3 + 2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aEmit', new THREE.BufferAttribute(emit, 2));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const VERT_PARS = /* glsl */ `
attribute vec3 aPivot;
attribute vec2 aPart;
attribute vec2 aEmit;
attribute vec4 aAnim;
attribute vec4 aAnim2;
varying vec2 vEmit;
vec3 minionRotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
vec3 minionRotX(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
`;

const VERT_DEFORM = /* glsl */ `
{
  float kind = aPart.x;
  vec3 rel = transformed - aPivot;
  if (kind > 0.5 && kind < 1.5) {
    // Leg: swing fore/aft about the joint (forward while sin(phase) > 0), lift the foot while
    // it swings forward.
    float ph = aAnim.x + aPart.y;
    float side = aPivot.x < 0.0 ? -1.0 : 1.0;
    float reach = clamp(length(rel.xz) / 30.0, 0.0, 1.0);
    rel = minionRotY(rel, -side * sin(ph) * 0.55 * aAnim.y);
    rel.y += max(cos(ph), 0.0) * 13.0 * aAnim.y * reach;
    transformed = aPivot + rel;
  } else if (kind < 2.5 && kind > 1.5) {
    // Tail: a swing that travels from the root to the tip.
    float w = aPart.y;
    rel = minionRotY(rel, sin(aAnim.w - w * 2.4) * aAnim2.z * w);
    transformed = aPivot + rel;
  } else if (kind > 2.5) {
    transformed = aPivot + minionRotX(rel, aAnim.z * 0.65);
  }
  vEmit = aEmit * aAnim2.xy;
}
`;

export function makeMinionMaterial() {
  const uniforms = {
    uRim: { value: new THREE.Color(0.28, 0.34, 0.46) },
    uFogScale: { value: 0.6 },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_DEFORM);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uFogScale;\nvarying vec2 vEmit;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '\ttotalEmissiveRadiance += diffuseColor.rgb * (vEmit.x + vEmit.y);',
          '\tfloat rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
          '\ttotalEmissiveRadiance += uRim * (rimK * rimK);',
        ].join('\n'),
      )
      .replace('#include <fog_fragment>', scaledFog('uFogScale', false));
  };
  material.customProgramCacheKey = () => 'robotMinion';
  material.userData.uniforms = uniforms;
  return material;
}
