// Heavy slanted rain: thin streaks in a box that travels with the camera, animated entirely
// on the GPU (one instanced draw, no per-frame uploads).
//
// Every streak has a fixed random spot in a periodic box (BOX wide, BOX_HEIGHT tall). Its
// world position is spot + fall offset, wrapped into the box around the camera, so the drops
// stay put in the world (correct parallax when the camera moves) and wrap round at the box
// edges, where they are faded out. The fall offsets are computed on the CPU in double
// precision and wrapped to the box (the shader never sees large times); four speed classes
// give the sheets some depth. Streaks are camera-facing quads at least ~1 px wide at any
// distance, so they read at the retro filter's 240 lines as well as at native resolution.
//
// Embers (AI RACE's meltdown, setEmbers(t)): a share t of the streaks (by a per-streak hash)
// turns into drifting embers and ash instead: speed classes 0-1 become glowing embers rising
// on the wind (short, flickering orange, some hidden so they stay sparse), classes 2-3 flakes
// of pale ash drifting down; both sway in little loops. Same mesh and draw call; their own
// wrapped offsets (EMBERS).

import * as THREE from 'three';
import { makeRng } from '../core/math.js';

export const RAIN = Object.freeze({
  maxStreaks: 4200,
  box: 2600, // horizontal size of the rain volume around the camera
  boxHeight: 2400,
  below: 0.62, // share of the box below the camera (most of the view looks down)
  fall: 2900, // units/s
  windX: 1050, // slant (units/s), the storm blows from the west-south-west
  windZ: 380,
  length: 105, // streak length (units), +-30%
  halfWidth: 0.9, // world half-width (units); the pixel minimum dominates beyond ~300 units
  color: 0x9aaabb,
  speedClasses: [0.84, 0.95, 1.05, 1.17],
});

// The meltdown's embers and ash (setEmbers): velocities (units/s, per speed class like the
// rain), look and share of the streaks shown.
export const EMBERS = Object.freeze({
  rise: [240, 170, 90], // embers: up on the wind
  ash: [280, -150, 100], // ash: drifting down
  sway: 55, // units of looping sway
  emberLength: 16,
  ashLength: 6,
  emberHalfWidth: 2.2,
  ashHalfWidth: 3.4,
  emberShown: 0.55, // share of the ember streaks drawn
  ashShown: 0.35,
  emberColor: 0xffa040,
  emberGain: 2.4, // linear brightness of an ember at full flicker
  ashColor: 0x6a625c,
  emberAlpha: 0.9,
  ashAlpha: 0.45,
});

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;          // xyz: spot in the box (0..1), w: speed class + length variation
uniform vec3 uCam;
uniform vec3 uOffsets[4];      // fall offset of each speed class, wrapped to the box
uniform vec3 uEmberOffsets[4]; // the same for embers (classes 0-1) and ash (2-3)
uniform vec3 uBox;             // width, height, share below the camera
uniform vec3 uDir;             // unit fall direction
uniform vec3 uEmberDir;        // unit direction of a rising ember
uniform vec3 uAshDir;          // unit direction of falling ash
uniform float uLen;
uniform float uHalfWidth;
uniform float uPixel;
uniform float uEmber;          // share of the streaks turned to embers and ash
uniform float uTime;
varying float vFade;
varying vec2 vCorner;
varying float vKind;           // 0 rain, 1 ember, 2 ash
varying float vGlow;

void main() {
  float cls = floor(aSeed.w);
  bool ember = fract(aSeed.w * 7.31 + aSeed.x * 13.7 + aSeed.y * 3.1) < uEmber;
  vec3 off = ember ? uEmberOffsets[int(cls)] : uOffsets[int(cls)];
  vec3 box = vec3(uBox.x, uBox.y, uBox.x);
  vec3 origin = uCam - vec3(uBox.x * 0.5, uBox.y * uBox.z, uBox.x * 0.5);
  vec3 top = origin + mod(aSeed.xyz * box + off - origin, box);
  float len = uLen * (0.7 + 0.6 * fract(aSeed.w));
  vec3 dir = uDir;
  float halfWidth = uHalfWidth;
  vKind = 0.0;
  vGlow = 1.0;
  if (ember) {
    bool rising = cls < 1.5;
    float ph = aSeed.y * 40.0 + uTime * (0.9 + fract(aSeed.w * 3.1));
    top.x += sin(ph) * ${EMBERS.sway.toFixed(1)};
    top.z += cos(ph * 0.83) * ${EMBERS.sway.toFixed(1)};
    dir = rising ? uEmberDir : uAshDir;
    len = rising ? ${EMBERS.emberLength.toFixed(1)} * (0.6 + fract(aSeed.w)) : ${EMBERS.ashLength.toFixed(1)};
    halfWidth = rising ? ${EMBERS.emberHalfWidth.toFixed(2)} : ${EMBERS.ashHalfWidth.toFixed(2)};
    vKind = rising ? 1.0 : 2.0;
    float shown = step(fract(aSeed.z * 7.7 + aSeed.x * 3.3), rising ? ${EMBERS.emberShown.toFixed(2)} : ${EMBERS.ashShown.toFixed(2)});
    vGlow = shown * (rising ? 0.55 + 0.45 * sin(uTime * (5.0 + 8.0 * fract(aSeed.z * 5.3)) + aSeed.x * 60.0) : 0.6 + 0.4 * fract(aSeed.y * 9.7));
  }

  // Fade out at the box's walls (where drops wrap) and near its top and bottom.
  vec3 rel = (top - origin) / box;
  vec2 edge = min(rel.xz, 1.0 - rel.xz);
  vFade = smoothstep(0.0, 0.12, edge.x) * smoothstep(0.0, 0.12, edge.y) * smoothstep(0.0, 0.08, rel.y) * smoothstep(0.0, 0.08, 1.0 - rel.y);

  vec4 a = viewMatrix * vec4(top, 1.0);
  vec4 b = viewMatrix * vec4(top + dir * len, 1.0);
  vec2 d = b.xy / max(-b.z, 1.0) - a.xy / max(-a.z, 1.0);
  float dl = length(d);
  vec2 ax = dl > 1e-6 ? d / dl : vec2(0.0, -1.0);
  vec2 side = vec2(ax.y, -ax.x); // ax turned -90 degrees: counter-clockwise quad
  vec4 mvPosition = mix(a, b, position.y);
  float depth = max(-mvPosition.z, 1.0);
  mvPosition.xy += side * position.x * max(halfWidth, uPixel * depth * 0.7);
  // Drops right at the lens would be big blurry bars.
  vFade *= smoothstep(140.0, 420.0, depth);
  vCorner = position.xy;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uEmberColor;
uniform vec3 uAshColor;
varying float vFade;
varying vec2 vCorner;
varying float vKind;
varying float vGlow;

void main() {
  vec3 color = uColor;
  float a = uAlpha * vFade * (1.0 - vCorner.x * vCorner.x) * mix(0.25, 1.0, vCorner.y);
  if (vKind > 0.5) {
    // An ember glows along its whole length (brightest in the middle); ash is a soft flake.
    bool ash = vKind > 1.5;
    float along = 1.0 - abs(vCorner.y * 2.0 - 1.0) * 0.7;
    color = ash ? uAshColor : uEmberColor * (0.45 + 0.55 * vGlow) * ${EMBERS.emberGain.toFixed(2)};
    a = (ash ? ${EMBERS.ashAlpha.toFixed(2)} : ${EMBERS.emberAlpha.toFixed(2)}) * vGlow * vFade * (1.0 - vCorner.x * vCorner.x) * along;
  }
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  if (a < 0.003) discard;
  vec4 c = linearToOutputTexel(vec4(color, 1.0));
  gl_FragColor = vec4(c.rgb * a, 0.0); // additive
}`;

export class RainStreaks {
  constructor({ seed = 7, ...opts } = {}) {
    this.opts = { ...RAIN, ...opts };
    const o = this.opts;
    const rng = makeRng(seed);
    const n = o.maxStreaks;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seeds[i * 4] = rng();
      seeds[i * 4 + 1] = rng();
      seeds[i * 4 + 2] = rng();
      seeds[i * 4 + 3] = (i % 4) + rng() * 0.999; // class + length variation
    }
    const geo = new THREE.InstancedBufferGeometry();
    // x: across (-1..1), y: along (0 = top/tail, 1 = head).
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = 0;
    this.geometry = geo;

    const dir = new THREE.Vector3(o.windX, -o.fall, o.windZ).normalize();
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uCam: { value: new THREE.Vector3() },
        uOffsets: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uBox: { value: new THREE.Vector3(o.box, o.boxHeight, o.below) },
        uDir: { value: dir },
        uLen: { value: o.length },
        uHalfWidth: { value: o.halfWidth },
        uPixel: { value: 0.0035 },
        uColor: { value: new THREE.Color(o.color) },
        uAlpha: { value: 0 },
        uEmberOffsets: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uEmberDir: { value: new THREE.Vector3(...EMBERS.rise).normalize() },
        uAshDir: { value: new THREE.Vector3(...EMBERS.ash).normalize() },
        uEmber: { value: 0 },
        uTime: { value: 0 },
        uEmberColor: { value: new THREE.Color(EMBERS.emberColor) },
        uAshColor: { value: new THREE.Color(EMBERS.ashColor) },
      },
    ]);
    this.material = new THREE.ShaderMaterial({
      name: 'fxRain',
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // sprites are never culled, whichever way a quad turns
      forceSinglePass: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'fxRain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    this.amount = 0;
    this.embers = 0;
    this.clock = 0;
    this.fallVel = [o.windX, -o.fall, o.windZ];
    this.emberVel = [EMBERS.rise, EMBERS.rise, EMBERS.ash, EMBERS.ash];
  }

  // Streak count and opacity for a rain amount t (0..1). Pure, for tests and tuning.
  static countFor(t, max = RAIN.maxStreaks) {
    if (!(t > 0)) return 0;
    return Math.ceil(max * Math.min(1, t) ** 1.15);
  }

  static alphaFor(t) {
    return t > 0 ? 0.2 + 0.33 * Math.min(1, t) : 0;
  }

  setAmount(t) {
    this.amount = t > 0 ? Math.min(1, t) : 0;
    this.geometry.instanceCount = RainStreaks.countFor(Math.max(this.amount, this.embers), this.opts.maxStreaks);
    this.material.uniforms.uAlpha.value = RainStreaks.alphaFor(this.amount);
  }

  // The meltdown: a share t (0..1) of the streaks drift as embers and ash instead of rain.
  setEmbers(t) {
    this.embers = t > 0 ? Math.min(1, t) : 0;
    this.material.uniforms.uEmber.value = this.embers;
    this.setAmount(this.amount);
  }

  // Advances the fall (dt seconds) and centres the volume on `camPos`. `hidden` (e.g. the
  // camera is under water) skips the draw.
  update(dt, camPos, hidden = false) {
    this.clock += dt;
    const visible = this.geometry.instanceCount > 0 && !hidden;
    this.mesh.visible = visible;
    if (!visible) return;
    const u = this.material.uniforms;
    if (camPos) u.uCam.value.copy(camPos);
    const o = this.opts;
    const fall = this.fallVel;
    const fx = fall[0];
    const fy = fall[1];
    const fz = fall[2];
    const classes = o.speedClasses;
    const offs = u.uOffsets.value;
    for (let c = 0; c < 4; c++) {
      const t = this.clock * classes[c];
      offs[c].set(wrap(fx * t, o.box), wrap(fy * t, o.boxHeight), wrap(fz * t, o.box));
    }
    if (this.embers > 0) {
      const eo = u.uEmberOffsets.value;
      for (let c = 0; c < 4; c++) {
        const t = this.clock * classes[c];
        const v = this.emberVel[c];
        eo[c].set(wrap(v[0] * t, o.box), wrap(v[1] * t, o.boxHeight), wrap(v[2] * t, o.box));
      }
      u.uTime.value = wrap(this.clock, 1000);
    }
  }

  setPixelScale(fovDeg, heightPx) {
    this.material.uniforms.uPixel.value = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function wrap(v, m) {
  return v - Math.floor(v / m) * m;
}
