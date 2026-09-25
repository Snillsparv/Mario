// The face screen's backdrop: the castle grounds' sky (the same blues as world/sky.js, deep
// overhead and pale at the horizon) with soft cumulus drifting slowly by, a warm glow behind
// Pip's head and a band of hazy green hills along the bottom. One fullscreen triangle drawn
// first (no depth), procedural in its fragment shader, so it costs one draw call and no
// texture; the renderer's retro filter quantises and dithers it like the rest of the frame.
//
//   const bg = new Backdrop();  scene.add(bg.mesh);  bg.update(timeSeconds, aspect);  bg.dispose();

import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uAspect;
uniform vec3 uZenith;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uCloud;
uniform vec3 uCloudShade;
uniform vec3 uHillFar;
uniform vec3 uHillNear;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
// Cloud cover at p (screen units, y up): puffy banks that thin out toward the top.
float cover(vec2 p) {
  float band = smoothstep(0.02, 0.35, p.y) * (1.0 - smoothstep(0.7, 1.05, p.y));
  float n = fbm(p * vec2(2.2, 3.6));
  return smoothstep(0.5, 0.66, n + 0.18 * band - 0.08);
}

void main() {
  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y);
  // Sky: pale haze at the bottom, blue overhead.
  vec3 col = mix(uHorizon, uSky, smoothstep(0.08, 0.5, vUv.y));
  col = mix(col, uZenith, smoothstep(0.5, 1.0, vUv.y));
  // A soft warm glow behind the head.
  float glow = 1.0 - smoothstep(0.0, 0.62, length((p - vec2(0.0, 0.56)) * vec2(0.8, 1.0)));
  col = mix(col, uGlow, glow * glow * 0.55);
  // Two layers of cloud drifting left at different speeds, lit from above.
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    vec2 q = p * (1.0 + fl * 0.6) + vec2(uTime * (0.012 + fl * 0.01) + fl * 7.3, fl * 0.21);
    float c = cover(q);
    float under = cover(q + vec2(0.0, 0.035));
    vec3 cloud = mix(uCloud, uCloudShade, clamp(under - c * 0.6, 0.0, 1.0) * 0.8 + (1.0 - vUv.y) * 0.15);
    col = mix(col, cloud, c * (0.85 - fl * 0.25));
  }
  // Hazy hills along the bottom: a far, paler row and a near, greener one.
  float far = 0.2 + 0.035 * sin(p.x * 3.1 + 1.3) + 0.025 * sin(p.x * 7.7 + 0.4);
  float near = 0.11 + 0.045 * sin(p.x * 2.3 - 0.8) + 0.02 * sin(p.x * 5.9 + 2.0);
  float aa = 1.5 / 240.0;
  col = mix(col, uHillFar, 1.0 - smoothstep(far - aa, far + aa, vUv.y));
  vec3 nearCol = uHillNear * (0.8 + 0.25 * smoothstep(near - 0.12, near, vUv.y));
  col = mix(col, nearCol, 1.0 - smoothstep(near - aa, near + aa, vUv.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const COLORS = {
  uZenith: 0x2c66da,
  uSky: 0x5892e8,
  uHorizon: 0xa9caee, // world/sky.js SKY_HORIZON_COLOR
  uGlow: 0xfff0c8,
  uCloud: 0xffffff,
  uCloudShade: 0xc4d4ea,
  uHillFar: 0x8fbf8a,
  uHillNear: 0x4f9d3c,
};

export class Backdrop {
  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const uniforms = { uTime: { value: 0 }, uAspect: { value: 4 / 3 } };
    for (const [k, hex] of Object.entries(COLORS)) uniforms[k] = { value: new THREE.Color(hex) };
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'faceBackdrop';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(time, aspect) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAspect.value = aspect;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
