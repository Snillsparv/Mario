// Geometry and material of the Sporebots, the minions of AI RACE mode: small original walking
// machines with a mushroom-like build (a wide cap on a stout stem), plated in the Rustmaw's
// gunmetal, steel and rust palette. About 120 across and 130 tall (a little taller than wide).
//
// Design: a wide, low, faceted dome cap of riveted gunmetal plates joined by rust-red seams,
// with a steel hatch, three short vent fins and a little exhaust stack (ember tip) on top, and a
// thick rim carrying a ring of small red running lights. Under the rim sits a dark, recessed
// sensor band with two large round red optic lenses in steel lens rings (no mouth, no brows).
// Below it the cap's underside is ribbed like gills in dark rust and gunmetal. A stout, ribbed
// steel stem (a piston housing) with a slanted hazard-stripe band and a rust neck collar stands
// on a hexagonal hip hub, and three short piston legs (a tripod: one ahead, two behind) reach
// out and down from rust ball joints over raised knees to round rubber foot pads.
//
// All minions are ONE InstancedMesh (one draw call). The legs and the cap are animated in the
// vertex shader, so every instance scuttles at its own gait without a rig:
//   per vertex    aPart = (kind, param), aPivot (the part's joint), aEmit (glow: power, flare)
//                 kind 0 hub/stem (rigid), 1 leg (param: gait phase offset), 2 cap (sensor
//                 band, eyes, rim, dome)
//   per instance  aAnim  = (gait phase, stride 0..1, cap tilt (+1: tipped fully forward),
//                           wobble phase)
//                 aAnim2 = (eye power 0..1, eye flare 0..1, wobble amount, crouch (-1..1))
// Each leg steps at its own third of the gait: its foot slides back along the heading while
// planted and swings forward, lifted, in between (a shear about the hip, so the foot pad keeps
// its shape and the piston stretches). The hub and cap bob three times per gait cycle and
// crouch on bent legs (the feet stay put); the cap tilts forward about its neck (the attack),
// wobbles and nods with the gait. Flat shading comes from screen-space derivatives, so the
// deformed normals need no extra work. Rig space: soles on y = 0, facing +Z, units = world units.

import * as THREE from 'three';
import { PartBuilder, PALETTE, scaledFog } from './robotBeastModel.js';

const { GUN, GUN_LIGHT, GUN_DARK, STEEL, STEEL_DARK, RUST, RUST_DARK, CABLE, HAZARD, EYE, EMBER } = PALETTE;
const LENS_CORE = [1, 0.42, 0.26];

export const MINION_SCALE = 0.8;

// Emission presets [eye power channel, flare channel] (see aAnim2).
const E_NONE = [0, 0];
const E_EYE = [1.7, 2.2];
const E_CORE = [1.9, 2.2];
const E_LIGHT = [1.5, 1.1];
const E_JOINT = [0.25, 0.3];
const E_SEAM = [0.18, 0.5];
const E_EMBER = [0.8, 1.2];

const S = MINION_SCALE;
const TAU = Math.PI * 2;

// Design units (scaled by S into the landmarks and the geometry).
const HIP = { r: 23, y: 34 };
const KNEE = { r: 48, y: 54 };
const ANKLE = { r: 62, y: 12 };
const FOOT_R = 63;
const NECK_Y = 92; // the cap's pivot on the axis
const C = NECK_Y - 80; // the cap's heights below are written from a neck at 80
const BAND = { r: 54, y0: 84 + C, y1: 108 + C };
const LIP_R = 75.5;
const EYE_AT = [21, 94 + C, 63.5]; // right lens centre (the left one mirrored)
const TOP_Y = 150 + C; // the hatch top

// Landmarks (rig space, already scaled).
export const MINION_RIG = {
  EYE: EYE_AT.map((v) => v * S), // the right eye lens's centre (glow sprite); the left one at -x
  CAP_PIVOT: NECK_Y * S, // the cap tilts and wobbles about this height on the axis
  FRONT: LIP_R * S, // the cap's rim ahead of the origin (it rams with it on a lunge)
  RADIUS: LIP_R * S, // the cap's radius (the widest part)
  RIM_Y: (113 + C) * S, // the running lights round the cap's rim
  BACK: TOP_Y * S, // top of the cap (stomps land here)
  BODY_Y: EYE_AT[1] * S, // the sensor band's height (the ram's height)
  LENGTH: 2 * LIP_R * S, // front to back (the cap's diameter)
};

// Shader animation constants (world units, radians), shared with Minions.js (eye glows).
export const MINION_ANIM = {
  TILT: 0.42, // cap tilt at aAnim.z = 1
  BOB: 3.2 * S, // hub bob per stride, three times per gait cycle
  CAP_BOB: 2.4 * S, // the cap's extra, lagging bob
  CROUCH: 16 * S, // how far the hub sinks at crouch = 1
  STEP: 19, // foot travel either way along the heading at stride 1
  LIFT: 13, // foot lift in the swing at stride 1
  LEG_SPAN: (FOOT_R - HIP.r) * S, // hip to foot, across
};

const KIND = { BODY: 0, LEG: 1, CAP: 2 };

// Surface of revolution round the y axis. profile = [[r, y, twist?], ...] from one end to the
// other (r = 0 closes that end in a point; twist turns that ring by radians), angles = the
// division angles (ascending over one turn, from +Z toward +X). colorAt(i, k) / emitAt(i, k)
// pick the facet's colour and emission (profile segment i, division k); a division keeps one
// shade along the profile (plates read as panels). Facets face away from `inside`.
function lathe(b, profile, angles, colorAt, emitAt, inside, vary = 0.05) {
  const n = angles.length;
  const tints = new Map();
  const tint = (color, k) => {
    let m = tints.get(color);
    if (!m) tints.set(color, (m = new Map()));
    if (!m.has(k)) m.set(k, b.lin(color, vary));
    return m.get(k);
  };
  const at = (p, a) => [Math.sin(a + (p[2] ?? 0)) * p[0], p[1], Math.cos(a + (p[2] ?? 0)) * p[0]];
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i];
    const p1 = profile[i + 1];
    for (let k = 0; k < n; k++) {
      const a0 = angles[k];
      const a1 = k + 1 < n ? angles[k + 1] : angles[0] + TAU;
      const lin = tint(colorAt(i, k), k);
      const e = emitAt(i, k);
      const v00 = at(p0, a0);
      const v01 = at(p0, a1);
      const v10 = at(p1, a0);
      const v11 = at(p1, a1);
      if (p0[0] === 0) b.tri(v00, v11, v10, lin, e, inside);
      else if (p1[0] === 0) b.tri(v00, v01, v10, lin, e, inside);
      else b.quad(v00, v01, v11, v10, lin, e, inside);
    }
  }
}

// n equal divisions, the first centred on +Z turned by `offset`.
const even = (n, offset = 0) => Array.from({ length: n }, (_, k) => offset + ((k - 0.5) / n) * TAU);

// Alternating divisions: `count` wide ones and `count` narrow ones of `narrow` radians (the wide
// ones even, centred on +Z turned by `offset`); even k = wide, odd k = narrow.
function paired(count, narrow, offset = 0) {
  const step = TAU / count;
  const out = [];
  for (let j = 0; j < count; j++) {
    const a = offset + j * step - (step - narrow) / 2;
    out.push(a, a + step - narrow);
  }
  return out;
}

// A rivet head: a low four-sided stud (no base) at p on the dome's lower slope, facing out
// at angle a (radians from +Z toward +X); linear colour `lin`.
function stud(b, p, a, size, height, lin) {
  const n = [Math.sin(a) * 0.79, 0.61, Math.cos(a) * 0.79];
  const t1 = [Math.cos(a), 0, -Math.sin(a)];
  const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  const at = (u, v, h) => [p[0] + t1[0] * u + t2[0] * v + n[0] * h, p[1] + t1[1] * u + t2[1] * v + n[1] * h, p[2] + t1[2] * u + t2[2] * v + n[2] * h];
  const apex = at(0, 0, height);
  const c = [at(-size, -size, 0), at(size, -size, 0), at(size, size, 0), at(-size, size, 0)];
  const inside = at(0, 0, -height);
  for (let i = 0; i < 4; i++) b.tri(c[i], c[(i + 1) % 4], apex, lin, E_NONE, inside);
}

// The dome's profile [r, y] from its rim (tucked inside the lip) to the crown.
const DOME = [
  [69, 115 + C],
  [67, 123 + C],
  [59.5, 132.5 + C],
  [45, 140.5 + C],
  [25, 146 + C],
  [0, 148 + C],
];

// Height of the dome's surface at radius r (linear between the profile's rings).
function domeY(r) {
  for (let i = 1; i < DOME.length; i++) {
    const [r0, y0] = DOME[i - 1];
    const [r1, y1] = DOME[i];
    if (r >= r1) return y1 + ((y0 - y1) * (r - r1)) / (r0 - r1);
  }
  return DOME[DOME.length - 1][1];
}

// Hub, stem and neck collar: the rigid core the legs and the cap hang on.
function buildBody() {
  const b = new PartBuilder(401);
  // Hexagonal hip hub, a darker cone underneath.
  lathe(
    b,
    [
      [0, 20],
      [12, 23],
      [24.5, 29],
      [26.5, 34],
      [24.5, 41],
      [20, 43],
    ],
    even(6, Math.PI / 6),
    (i) => (i === 2 ? GUN : GUN_DARK),
    () => E_NONE,
    [0, 32, 0],
    0.08,
  );
  // Stem: a ribbed steel piston housing with a slanted hazard-stripe band.
  lathe(
    b,
    [
      [24, 40],
      [22.5, 94],
    ],
    even(10),
    () => STEEL,
    () => E_NONE,
    [0, 66, 0],
    0.04,
  );
  for (const y of [49, 82]) b.ring([0, y, 0], [0, y + 1, 0], 26.5, 3.5, GUN_LIGHT, E_NONE, 10);
  const stripes = even(12);
  lathe(
    b,
    [
      [24.6, 61],
      [24.2, 75, TAU / 14],
    ],
    stripes,
    (i, k) => (k % 2 ? CABLE : HAZARD),
    () => E_NONE,
    [0, 68, 0],
    0.02,
  );
  // Neck collar under the cap (hides the joint as the cap tilts).
  b.ring([0, NECK_Y, 0], [0, NECK_Y + 1, 0], 27.5, 7, RUST, E_JOINT, 10);
  return b;
}

// The cap: gills, sensor band and eyes, rim with running lights, plated dome and top fittings.
function buildCap() {
  const b = new PartBuilder(402);
  // Gill ribs under the cap, from the stem out to the sensor band.
  lathe(
    b,
    [
      [24, 77 + C],
      [BAND.r + 0.5, BAND.y0],
    ],
    even(20),
    (i, k) => (k % 2 ? RUST_DARK : GUN_DARK),
    () => E_NONE,
    [0, 96 + C, 0],
    0.05,
  );
  // Recessed sensor band: a plain dark visor round the eyes, louvred along the sides and back.
  lathe(
    b,
    [
      [BAND.r + 0.5, BAND.y0],
      [BAND.r, BAND.y1],
    ],
    even(16),
    (i, k) => (k <= 2 || k >= 14 || k % 2 ? STEEL_DARK : GUN_DARK),
    () => E_NONE,
    [0, 96 + C, 0],
    0.03,
  );
  // Two big optic lenses: a steel lens ring, the glowing lens and a hot core.
  for (const s of [-1, 1]) {
    const [x, y, z] = [s * EYE_AT[0], EYE_AT[1], EYE_AT[2]];
    b.cyl([x, y, z - 22], [x, y, z - 2], 14.5, 13.5, 10, STEEL, E_NONE);
    b.cyl([x, y, z - 4], [x, y, z], 11.2, 10.2, 10, EYE, E_EYE);
    b.cyl([x, y, z - 1], [x, y, z + 0.8], 4.4, 3.8, 8, LENS_CORE, E_CORE);
  }
  // The rim: a thick ring round the band, its outer face lined with small running lights.
  lathe(
    b,
    [
      [BAND.r - 1.5, 106.5 + C],
      [74, 108.5 + C],
      [LIP_R, 110 + C],
      [LIP_R, 116 + C],
      [74, 117.5 + C],
      [62, 119 + C],
    ],
    paired(12, 0.1),
    (i, k) => (i === 2 && k % 2 ? EYE : GUN_DARK),
    (i, k) => (i === 2 && k % 2 ? E_LIGHT : E_NONE),
    [0, 112 + C, 0],
    0.06,
  );
  // Dome: eight gunmetal plates with rust seams (glowing faintly).
  lathe(
    b,
    DOME,
    paired(8, 0.075, Math.PI / 8),
    (i, k) => (k % 2 ? RUST_DARK : GUN),
    (i, k) => (k % 2 ? E_SEAM : E_NONE),
    [0, 110 + C, 0],
    0.09,
  );
  // Rivets: two on each plate above the rim (the plates are flat: the surface lies at the
  // ring's radius times cos(half the plate's width) straight out from the plate's middle).
  const half = (TAU / 8 - 0.075) / 2;
  const rivet = b.lin(STEEL, 0.05);
  for (let j = 0; j < 8; j++) {
    for (const d of [-0.2, 0.2]) {
      const a = Math.PI / 8 + (j * TAU) / 8 + d;
      const r = (65.8 * Math.cos(half)) / Math.cos(d) - 0.5;
      stud(b, [Math.sin(a) * r, 124.5 + C, Math.cos(a) * r], a, 2.6, 3.2, rivet);
    }
  }
  // Top: a steel hatch, three vent fins behind it and a little exhaust stack with an ember tip.
  b.cyl([0, domeY(0) - 4, 0], [0, TOP_Y, 0], 14, 12, 8, STEEL, E_NONE);
  for (const x of [-11, 0, 11]) {
    const c = [];
    for (let bit = 0; bit < 8; bit++) {
      const z = bit & 4 ? -24 : -44;
      const top = bit & 2;
      const y0 = domeY(Math.sqrt(x * x + z * z)) - 2;
      c.push([x + (bit & 1 ? 1.3 : -1.3), top ? y0 + (z > -30 ? 10 : 7) : y0, z]);
    }
    b.hexa(c, GUN_LIGHT, E_NONE, 0.05);
  }
  const sx = 31;
  const sz = -24;
  const sy = domeY(Math.sqrt(sx * sx + sz * sz));
  b.cyl([sx, sy - 3, sz], [sx, sy + 13, sz], 5.5, 5, 6, GUN_DARK, E_NONE);
  b.cyl([sx, sy + 12, sz], [sx, sy + 16, sz], 6.8, 6.8, 6, EMBER, E_EMBER);
  return b;
}

// A tripod leg at angle `a` (radians from +Z toward +X): a rust hip joint on the hub, an
// armoured strut out and up to the knee, a piston (sleeve and rod) down to the ankle and a
// round rubber foot pad.
function buildLeg(a, seed) {
  const b = new PartBuilder(seed);
  const sn = Math.sin(a);
  const cs = Math.cos(a);
  const P = (r, y) => [sn * r, y, cs * r];
  const hip = P(HIP.r, HIP.y);
  const knee = P(KNEE.r, KNEE.y);
  const ankle = P(ANKLE.r, ANKLE.y);
  const mid = [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, (knee[2] + ankle[2]) / 2];
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  b.ball(hip, 7.5, RUST, E_JOINT, 0);
  b.cyl(hip, knee, 6.2, 5.2, 6, GUN, E_NONE);
  b.bonePlate(hip, knee, [0, 1, 0], 5, 10, 3, GUN_LIGHT, E_NONE, 0.75);
  b.ball(knee, 7, RUST, E_JOINT, 0);
  b.cyl(knee, lerp(knee, ankle, 0.58), 6.2, 5.6, 6, GUN_LIGHT, E_NONE);
  b.cyl(lerp(mid, knee, 0.2), ankle, 3.1, 3.1, 5, STEEL, E_NONE);
  b.ball(ankle, 5.2, RUST, E_JOINT, 0);
  const foot = P(FOOT_R, 0);
  b.cyl(foot, [foot[0], 6, foot[2]], 14, 12.5, 8, CABLE, E_NONE);
  b.cyl([foot[0], 5.5, foot[2]], [foot[0], 11, foot[2]], 10, 6, 6, STEEL_DARK, E_NONE);
  return { b, pivot: hip };
}

// One non-indexed geometry for the whole minion with the animation attributes (see header).
export function buildMinionGeometry() {
  const parts = [];
  parts.push({ b: buildBody(), kind: KIND.BODY, pivot: [0, 0, 0], param: 0 });
  parts.push({ b: buildCap(), kind: KIND.CAP, pivot: [0, NECK_Y, 0], param: 0 });
  for (let i = 0; i < 3; i++) {
    const { b, pivot } = buildLeg((i * TAU) / 3, 410 + i);
    parts.push({ b, kind: KIND.LEG, pivot, param: (i * TAU) / 3 });
  }

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
      part[v * 2 + 1] = p.param;
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

const f = (v) => v.toFixed(4);

const VERT_PARS = /* glsl */ `
attribute vec3 aPivot;
attribute vec2 aPart;
attribute vec2 aEmit;
attribute vec4 aAnim;
attribute vec4 aAnim2;
varying vec2 vEmit;
vec3 minionRotX(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
vec3 minionRotZ(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
`;

const A = MINION_ANIM;
const VERT_DEFORM = /* glsl */ `
{
  float kind = aPart.x;
  float ph = aAnim.x;
  float stride = aAnim.y;
  // Hub height: three bobs per gait cycle (one per step), lowered by the crouch.
  float bob = stride * ${f(A.BOB)} * cos(3.0 * ph) - aAnim2.w * ${f(A.CROUCH)};
  vec3 rel = transformed - aPivot;
  if (kind > 0.5 && kind < 1.5) {
    // Leg: the hip rides with the hub, the foot slides back along the heading while planted
    // (sin(phase) falling) and swings forward lifted (cos(phase) > 0); a shear about the hip.
    float lp = ph + aPart.y;
    float reach = clamp(length(rel.xz) / ${f(A.LEG_SPAN)}, 0.0, 1.0);
    rel.z += sin(lp) * ${f(A.STEP)} * stride * reach;
    rel.y += max(cos(lp), 0.0) * ${f(A.LIFT)} * stride * reach + bob * (1.0 - reach);
    transformed = aPivot + rel;
  } else if (kind > 1.5) {
    // Cap: tilts forward about the neck, wobbles, nods and rolls a little with the steps.
    float ax = aAnim.z * ${f(A.TILT)} + sin(aAnim.w) * aAnim2.z * 0.09 + sin(3.0 * ph - 1.0) * stride * 0.05;
    float az = sin(aAnim.w * 0.73 + 1.7) * aAnim2.z * 0.07 + sin(ph + 0.6) * stride * 0.05;
    rel = minionRotZ(minionRotX(rel, ax), az);
    transformed = aPivot + rel;
    transformed.y += bob + stride * ${f(A.CAP_BOB)} * cos(3.0 * ph - 0.9);
  } else {
    transformed.y += bob;
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
