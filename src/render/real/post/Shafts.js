// The realistic look's sun shafts (render/real/post/RealPost.js; the high tier's level only):
// the sky's bright pixels near the sun (where the depth buffer says sky), at quarter
// resolution, blurred radially toward the sun (40 taps, each fainter by `decay`), so light
// streams through the trees' and roofs' gaps. Drawn only while the sun is near the picture
// (within 1.6 x the frame, the camera facing it): its strength fades out toward there.
//
//   const shafts = new Shafts({ density, decay, threshold })   // layout.LANE_REAL.post.shafts
//   shafts.render(renderer, screen, scene, depth, camera, sunDir) -> { texture, sun (uv), vis }
//       or null (the sun too far out of the picture: nothing drawn)
//   shafts.materials(), shafts.release(), shafts.dispose()

import * as THREE from 'three';
import { passMaterial, passTarget } from './fullscreen.js';

const MASK_FS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform sampler2D tScene;
  uniform vec2 uSun;
  uniform float uAspect;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float sky = step(0.99999, texture2D(tDepth, vUv).r);
    float near = 1.0 - smoothstep(0.0, 0.45, length((vUv - uSun) * vec2(uAspect, 1.0)));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * sky * near * min(max(l - uThreshold, 0.0), 4.0) / max(l, 1e-3), 1.0);
  }
`;

const RADIAL_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSun;
  uniform float uDensity;
  uniform float uDecay;
  varying vec2 vUv;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec2 step = (vUv - uSun) * uDensity / float(SAMPLES);
    vec2 uv = vUv - step * ign(gl_FragCoord.xy);
    float w = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      sum += texture2D(tSrc, uv).rgb * w;
      w *= uDecay;
      uv -= step;
    }
    gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
  }
`;

const SAMPLES = 40;
const REACH = 1.6; // the sun drawn for within this many half-frames of the middle

export class Shafts {
  constructor({ density = 0.9, decay = 0.965, threshold = 0.9 } = {}) {
    this.mask = passMaterial(MASK_FS, { tDepth: { value: null }, tScene: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThreshold: { value: threshold } });
    this.radial = passMaterial(RADIAL_FS, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uDensity: { value: density }, uDecay: { value: decay } }, { SAMPLES });
    this.a = null; // quarter resolution: the mask, then the rays
    this.b = null;
    this.out = { texture: null, sun: new THREE.Vector2(), vis: 0 };
    this.v = new THREE.Vector3();
    this.ahead = new THREE.Vector3();
  }

  fit(width, height) {
    const w = Math.ceil(width / 4);
    const h = Math.ceil(height / 4);
    if (this.a?.width === w && this.a.height === h) return;
    this.release();
    this.a = passTarget(w, h);
    this.b = passTarget(w, h);
  }

  // How much the sun (along sunDir) is in or near the picture: 0 (behind, or far out of it) to 1,
  // and its place (uv) into `sun`.
  visibility(camera, sunDir, sun) {
    const facing = camera.getWorldDirection(this.ahead).dot(sunDir);
    if (facing <= 0) return 0;
    const v = this.v.copy(sunDir).multiplyScalar(10000).add(camera.position).project(camera);
    sun.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    return (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(v.x), Math.abs(v.y)), 1, REACH)) * THREE.MathUtils.smoothstep(facing, 0, 0.35);
  }

  render(renderer, screen, scene, depth, camera, sunDir) {
    const out = this.out;
    out.vis = this.visibility(camera, sunDir, out.sun);
    if (out.vis < 0.001) return null;
    const { width, height } = scene.image;
    this.fit(width, height);
    const mu = this.mask.uniforms;
    mu.tDepth.value = depth;
    mu.tScene.value = scene;
    mu.uSun.value.copy(out.sun);
    mu.uAspect.value = width / height;
    screen.draw(renderer, this.mask, this.a);
    const ru = this.radial.uniforms;
    ru.tSrc.value = this.a.texture;
    ru.uSun.value.copy(out.sun);
    screen.draw(renderer, this.radial, this.b);
    out.texture = this.b.texture;
    return out;
  }

  materials() {
    return [this.mask, this.radial];
  }

  release() {
    this.a?.dispose();
    this.b?.dispose();
    this.a = this.b = null;
  }

  dispose() {
    this.release();
    this.mask.dispose();
    this.radial.dispose();
  }
}
