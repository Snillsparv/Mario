// The meltdown's light (fx/Meltdown.js, AI RACE): a blinding point that swells into a rising
// fireball over a pillar of light, and a shockwave wall of glowing dust racing out across the
// ground from under it. All original, cartoon-styled shapes; everything is drawn by shaders.
//
//   const doom = new DoomLight()        // meshes: doom.orb (fireball + pillar), doom.wave
//   doom.set(levels)                    // Meltdown levels: lit, glow, light, seconds, the
//                                       // fireball lx, ly, lz, lr, the ground point gx, gy,
//                                       // gz and the shockwave's radius ring
//
// Cost: two draw calls while the light shows (none before: both meshes hidden). The fireball
// and pillar are one mesh of two camera-facing quads (the pillar turns round its upright axis
// only); the wave is an open cylinder of WAVE.segments panels, scaled in the vertex shader.
// Unfogged (the light is far past the fog), depth-tested (the castle and the cliffs stand in
// front of it), no depth writes; the wave is additive, the fireball premultiplied (its body
// covers the burning sky behind it, its halo and the pillar add).

import * as THREE from 'three';
import { MELTDOWN } from './Meltdown.js';

export const DOOM = Object.freeze({
  orbQuad: 2.6, // the fireball's quad half size in radii (core + halo)
  pillarWidth: 0.26, // pillar half width in fireball radii
  pillarGrow: 1.4, // s for the pillar to reach down to the ground
  wave: { segments: 96, base: -300, height: 2700, fadeFrom: 1.2, fadeTo: 2.4 }, // fade: radius / LIGHT_DIST
});

const NOISE_GLSL = /* glsl */ `
  float dHash(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794) + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * (p.x + p.y));
  }
  float dNoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float dFbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      s += a * dNoise(p);
      p = p * 2.07 + vec2(1.3, -0.7);
      a *= 0.5;
    }
    return s;
  }
`;

const ORB_VERT = /* glsl */ `
  attribute float aKind;     // 0: the fireball, 1: the pillar
  uniform vec4 uOrb;         // centre, radius
  uniform vec3 uFoot;        // the pillar's lower end
  uniform float uPillarW;
  varying vec2 vCorner;
  varying float vKind;
  varying float vY;
  void main() {
    vCorner = position.xy;
    vKind = aKind;
    vY = 0.0;
    vec4 mv;
    if (aKind < 0.5) {
      mv = viewMatrix * vec4(uOrb.xyz, 1.0);
      mv.xy += position.xy * uOrb.w * ${DOOM.orbQuad.toFixed(2)};
    } else {
      float t = position.y * 0.5 + 0.5;
      vec3 p = mix(uFoot, uOrb.xyz, t);
      vec3 toCam = cameraPosition - p;
      vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
      p += side * position.x * uPillarW * mix(1.7, 0.75, t);
      mv = viewMatrix * vec4(p, 1.0);
      vY = t;
    }
    gl_Position = projectionMatrix * mv;
  }
`;

const ORB_FRAG = /* glsl */ `
  uniform float uGlow;
  uniform float uHeat;       // 0: a white point of light .. 1: a roiling fireball
  uniform float uTime;
  varying vec2 vCorner;
  varying float vKind;
  varying float vY;
  ${NOISE_GLSL}
  void main() {
    vec3 c;
    float a = 0.0; // premultiplied: the fireball's body covers what is behind it, glows add
    if (vKind < 0.5) {
      float r = length(vCorner) * ${DOOM.orbQuad.toFixed(2)}; // in fireball radii
      float ang = atan(vCorner.y, vCorner.x);
      // Roiling: cells of fire churning outward, a ragged rim.
      float churn = dFbm(vec2(ang * 3.0 + uTime * 0.35, r * 3.0 - uTime * 1.6));
      float cells = dFbm(vCorner * 9.0 + vec2(uTime * 0.7, -uTime * 1.1));
      float edge = 1.0 + (churn - 0.5) * 0.4 * uHeat;
      float disc = 1.0 - smoothstep(0.86 * edge, 1.0 * edge, r);
      float hot = 1.0 - smoothstep(0.05, mix(1.0, 0.7, uHeat) * edge, r + (cells - 0.5) * 0.35 * uHeat);
      vec3 rim = mix(vec3(0.85, 0.2, 0.03), vec3(1.0, 0.55, 0.1), cells);
      vec3 body = mix(rim, vec3(1.0, 0.96, 0.82), hot);
      float halo = exp(-max(r - 0.8, 0.0) * 2.2) * (1.0 - disc);
      a = disc * uGlow;
      c = body * a + vec3(1.0, 0.7, 0.4) * halo * 0.8 * uGlow;
      c *= 1.0 - smoothstep(${(DOOM.orbQuad - 0.3).toFixed(2)}, ${DOOM.orbQuad.toFixed(2)}, r);
    } else {
      float x = vCorner.x;
      float beam = exp(-x * x * 5.0);
      float core = exp(-x * x * 40.0);
      float streaks = 0.7 + 0.3 * dNoise(vec2(x * 5.0, vY * 9.0 - uTime * 3.0));
      float ends = smoothstep(0.0, 0.06, vY) * (1.0 - smoothstep(0.9, 1.0, vY) * 0.5);
      c = (vec3(1.0, 0.75, 0.45) * beam * streaks + vec3(1.0, 0.97, 0.9) * core * 1.5) * ends * 1.6 * uGlow;
      a = core * ends * 0.8 * uGlow;
    }
    gl_FragColor = vec4(c, a);
  }
`;

const WAVE_VERT = /* glsl */ `
  attribute float aU;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uBase;
  uniform float uHeight;
  varying float vU;
  varying float vV;
  varying float vDist;
  void main() {
    vec3 p = vec3(uCenter.x + position.x * uRadius, uBase + position.y * uHeight, uCenter.z + position.z * uRadius);
    vU = aU;
    vV = position.y;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const WAVE_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  varying float vU;
  varying float vV;
  varying float vDist;
  ${NOISE_GLSL}
  void main() {
    // Billowing dust: brightest low down, a ragged top edge, rolling as it goes.
    float n = dFbm(vec2(vU * 170.0, vV * 3.2 - uTime * 1.4));
    float top = 0.35 + 0.6 * n;
    float a = pow(1.0 - vV, 1.4) * (0.5 + 0.9 * n) * smoothstep(0.0, 0.2, top - vV);
    a *= uAlpha * smoothstep(60.0, 900.0, vDist);
    vec3 c = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.9, 0.72), clamp((1.0 - vV) * n * 1.3, 0.0, 1.0));
    gl_FragColor = vec4(c * a * 1.3, 0.0); // additive
  }
`;

// Premultiplied alpha: alpha 0 adds (glows), alpha 1 covers.
const premultiplied = {
  transparent: true,
  depthWrite: false,
  depthTest: true,
  fog: false,
  side: THREE.DoubleSide,
  forceSinglePass: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: true,
  fog: false,
  side: THREE.DoubleSide,
  forceSinglePass: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

function orbGeometry() {
  const geo = new THREE.BufferGeometry();
  const quad = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...quad, ...quad], 3));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
  // The pillar first (the fireball's glow adds over its top).
  geo.setIndex([4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3]);
  return geo;
}

function waveGeometry(n) {
  const pos = [];
  const u = [];
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 1, Math.sin(a));
    u.push(i / n, i / n);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 2, k + 3, k, k + 3, k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
  geo.setIndex(idx);
  return geo;
}

export class DoomLight {
  constructor() {
    this.orbMaterial = new THREE.ShaderMaterial({
      name: 'fxDoomLight',
      uniforms: {
        uOrb: { value: new THREE.Vector4(0, 0, 0, 1) },
        uFoot: { value: new THREE.Vector3() },
        uPillarW: { value: 0 },
        uGlow: { value: 0 },
        uHeat: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      ...premultiplied,
    });
    this.orb = new THREE.Mesh(orbGeometry(), this.orbMaterial);
    this.orb.name = 'fxDoomLight';
    this.orb.frustumCulled = false;
    this.orb.renderOrder = 12;
    this.orb.visible = false;

    this.waveMaterial = new THREE.ShaderMaterial({
      name: 'fxShockwave',
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: 1 },
        uBase: { value: DOOM.wave.base },
        uHeight: { value: DOOM.wave.height },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      ...additive,
    });
    this.wave = new THREE.Mesh(waveGeometry(DOOM.wave.segments), this.waveMaterial);
    this.wave.name = 'fxShockwave';
    this.wave.frustumCulled = false;
    this.wave.renderOrder = 11;
    this.wave.visible = false;
  }

  get meshes() {
    return [this.orb, this.wave];
  }

  set(levels) {
    const lit = !!levels?.lit && levels.glow > 0;
    this.orb.visible = lit;
    const ring = lit ? levels.ring || 0 : 0;
    this.wave.visible = ring > 0;
    if (!lit) return;
    const t = levels.seconds || 0;
    const u = this.orbMaterial.uniforms;
    u.uOrb.value.set(levels.lx, levels.ly, levels.lz, levels.lr);
    // The pillar reaches down from the fireball to the ground over its first moments.
    const since = Math.max(0, t - MELTDOWN.LIGHT);
    const grow = Math.min(1, since / DOOM.pillarGrow);
    const foot = levels.ly + (levels.gy - levels.ly) * (1 - (1 - grow) ** 2);
    u.uFoot.value.set(levels.gx, foot, levels.gz);
    u.uPillarW.value = levels.lr * DOOM.pillarWidth * grow;
    u.uGlow.value = levels.glow;
    u.uHeat.value = Math.min(1, levels.light * 4);
    u.uTime.value = t;
    if (ring > 0) {
      const w = this.waveMaterial.uniforms;
      w.uCenter.value.set(levels.gx, levels.gy, levels.gz);
      w.uRadius.value = ring;
      const k = ring / MELTDOWN.LIGHT_DIST;
      w.uAlpha.value = 1 - Math.min(1, Math.max(0, (k - DOOM.wave.fadeFrom) / (DOOM.wave.fadeTo - DOOM.wave.fadeFrom)));
      w.uTime.value = t;
    }
  }

  dispose() {
    this.orb.geometry.dispose();
    this.orbMaterial.dispose();
    this.wave.geometry.dispose();
    this.waveMaterial.dispose();
  }
}
