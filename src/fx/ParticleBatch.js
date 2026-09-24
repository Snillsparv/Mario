// All effect sprites in ONE instanced draw call: flames, smoke, embers, blast sparks and
// debris, splash rings, lightning segments and fire glows.
//
// Premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA) lets one draw mix additive
// sprites (alpha output 0: pure glow) with alpha-blended ones (smoke, debris). The batch
// writes the alpha-blended sprites first, so glows always add on top of smoke.
//
// Orientation modes (per sprite):
//   billboard  camera-facing quad, rotated in the screen plane
//   streak     quad stretched along the sprite's velocity as seen on screen (sparks, embers,
//              rising flame tongues, lightning segments); at least ~1 px wide at any distance
//   ground     horizontal quad (splash rings, shockwaves, fire light on the ground)
//
// Instance layout, 16 floats: [x y z size] [r g b a] [vx vy vz stretch] [shape rot mode flags]
// with flags = alphaBlended + 2 * noFog.

import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, ATLAS_CELL } from './atlas.js';
import { KIND_INFO, particleStyle } from './kinds.js';

export const STRIDE = 16;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 iPos;
attribute vec4 iCol;
attribute vec4 iVel;
attribute vec4 iMisc;
uniform float uPixel;   // world units per pixel at view distance 1
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vInfo;     // shape, alpha-blended, fog weight

const vec2 CELLS = vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
const float INSET = 0.5 / ${ATLAS_CELL}.0;

void main() {
  vec2 corner = position.xy; // -1..1
  float size = iPos.w;
  float mode = iMisc.z;
  vec4 mvPosition;
  if (mode > 1.5) {
    // Horizontal quad on the ground, rotated about +Y.
    float c = cos(iMisc.y);
    float s = sin(iMisc.y);
    vec3 wp = iPos.xyz + vec3(c * corner.x - s * corner.y, 0.0, s * corner.x + c * corner.y) * size;
    mvPosition = viewMatrix * vec4(wp, 1.0);
  } else if (mode > 0.5) {
    // Streak: long axis = the velocity (times stretch) as seen on screen.
    vec4 cv = viewMatrix * vec4(iPos.xyz, 1.0);
    vec3 dv = mat3(viewMatrix) * (iVel.xyz * iVel.w);
    vec4 e1 = cv + vec4(dv, 0.0);
    vec4 e0 = cv - vec4(dv, 0.0);
    vec2 d = e1.xy / max(-e1.z, 1.0) - e0.xy / max(-e0.z, 1.0);
    float dl = length(d);
    vec2 ax = dl > 1e-6 ? d / dl : vec2(0.0, 1.0);
    vec2 side = vec2(ax.y, -ax.x); // ax turned -90 degrees: counter-clockwise quad
    float halfW = max(size, uPixel * max(-cv.z, 1.0) * 0.6);
    mvPosition = mix(e0, e1, corner.y * 0.5 + 0.5);
    mvPosition.xy += side * (corner.x * halfW) + ax * (corner.y * size);
  } else {
    mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
    float c = cos(iMisc.y);
    float s = sin(iMisc.y);
    mvPosition.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  gl_Position = projectionMatrix * mvPosition;

  float shape = iMisc.x;
  vec2 cell = vec2(mod(shape, CELLS.x), CELLS.y - 1.0 - floor(shape / CELLS.x));
  vec2 local = clamp(corner * 0.5 + 0.5, INSET, 1.0 - INSET);
  vUv = (cell + local) / CELLS;
  vCol = iCol;
  float noFog = step(1.5, iMisc.w);
  vInfo = vec3(shape, iMisc.w - 2.0 * noFog, 1.0 - noFog);
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vInfo;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float cov = tex.a * vCol.a;
  if (cov < 0.004) discard;
  vec3 col = vCol.rgb;
  if (vInfo.x < 1.5) {
    // Flame tongues: red at the edges, the particle's colour (hotter, whiter) at the core.
    col *= mix(vec3(1.0, 0.26, 0.08), vec3(1.15, 1.05, 0.9), tex.r);
  } else {
    col *= mix(0.6, 1.0, tex.r);
  }
  float blend = vInfo.y;
  #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vFogDepth) * vInfo.z;
    col = mix(col, fogColor, fogF * blend); // smoke melts into the fog colour
    cov *= 1.0 - fogF * (1.0 - blend);      // glows fade out with distance
  #endif
  vec4 outCol = linearToOutputTexel(vec4(col, 1.0));
  gl_FragColor = vec4(outCol.rgb * cov, cov * blend);
}`;

export class ParticleBatch {
  constructor(capacity, atlas) {
    this.capacity = capacity;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(capacity * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    this.buffer = buffer;
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('iCol', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geo.setAttribute('iVel', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geo.setAttribute('iMisc', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
    geo.instanceCount = 0;
    this.geometry = geo;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uPixel: { value: 0.0035 } }]);
    uniforms.uAtlas.value = atlas; // merge() clones textures: assign after
    this.material = new THREE.ShaderMaterial({
      name: 'fxParticles',
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
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'fxParticles';
    this.mesh.frustumCulled = false; // sprites span the whole level
    this.mesh.renderOrder = 10; // after the world's own transparent sheets (water)
    this.mesh.visible = false;

    // Style scratch (particleStyle output) and the sprite template for push().
    this.style = { clock: 0, r: 0, g: 0, b: 0, a: 0, size: 0, shape: 0, mode: 0, alpha: 0, fog: 1, stretch: 0 };
    this.next = { x: 0, y: 0, z: 0, size: 0, r: 0, g: 0, b: 0, a: 0, vx: 0, vy: 0, vz: 0, stretch: 0, shape: 0, rot: 0, mode: 0, alpha: 0, fog: 1 };
  }

  begin(clock) {
    this.count = 0;
    this.style.clock = clock;
  }

  // Writes the pool's live particles of one blend group (alphaGroup 1: alpha-blended kinds,
  // 0: additive kinds).
  writePool(pool, alphaGroup) {
    const d = this.data;
    const st = this.style;
    const { kind, px, py, pz, vx, vy, vz, rot } = pool;
    for (let i = 0; i < pool.count; i++) {
      if (KIND_INFO[kind[i]].alpha !== alphaGroup) continue;
      if (this.count >= this.capacity) return;
      if (!particleStyle(pool, i, st)) continue;
      const o = this.count++ * STRIDE;
      d[o] = px[i];
      d[o + 1] = py[i];
      d[o + 2] = pz[i];
      d[o + 3] = st.size;
      d[o + 4] = st.r;
      d[o + 5] = st.g;
      d[o + 6] = st.b;
      d[o + 7] = st.a;
      d[o + 8] = vx[i];
      d[o + 9] = vy[i];
      d[o + 10] = vz[i];
      d[o + 11] = st.stretch;
      d[o + 12] = st.shape;
      d[o + 13] = rot[i];
      d[o + 14] = st.mode;
      d[o + 15] = st.alpha + (st.fog ? 0 : 2);
    }
  }

  // Appends a copy of this.next (fields set by the caller). False when full.
  push() {
    if (this.count >= this.capacity) return false;
    const s = this.next;
    const d = this.data;
    const o = this.count++ * STRIDE;
    d[o] = s.x;
    d[o + 1] = s.y;
    d[o + 2] = s.z;
    d[o + 3] = s.size;
    d[o + 4] = s.r;
    d[o + 5] = s.g;
    d[o + 6] = s.b;
    d[o + 7] = s.a;
    d[o + 8] = s.vx;
    d[o + 9] = s.vy;
    d[o + 10] = s.vz;
    d[o + 11] = s.stretch;
    d[o + 12] = s.shape;
    d[o + 13] = s.rot;
    d[o + 14] = s.mode;
    d[o + 15] = s.alpha + (s.fog ? 0 : 2);
    return true;
  }

  // Uploads the frame's sprites (the whole array: update ranges would allocate every frame)
  // and hides the mesh when there is nothing to draw (no draw call at all).
  end() {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) this.buffer.needsUpdate = true;
  }

  // World units per pixel at view distance 1 for a vertical fov (degrees) and picture height.
  setPixelScale(fovDeg, heightPx) {
    this.material.uniforms.uPixel.value = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
