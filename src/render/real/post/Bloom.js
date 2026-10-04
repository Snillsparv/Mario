// The realistic look's bloom (render/real/post/RealPost.js): the glow round the low sun, the car
// lacquer's and the glass's highlights. A mip chain (Jimenez 2014): the HDR scene's bright part
// (a soft threshold with a knee, its first downsample Karis-weighted so a lone bright pixel
// never flickers) at half resolution, then `levels` 13-tap downsamples (5 on high, 4 on mid's
// level), each smaller one added back up with a 9-tap tent: the result, at half resolution, is
// what the output pass adds (OutputPass.js, LANE_REAL.grade.bloom of it).
//
//   const bloom = new Bloom({ threshold, knee, radius })   // layout.LANE_REAL.post.bloom
//   bloom.render(renderer, screen, texture, { levels }) -> texture (half res)
//   bloom.materials(), bloom.release(), bloom.dispose()

import * as THREE from 'three';
import { passMaterial, passTarget } from './fullscreen.js';

const DOWN_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel; // the source's texel
  uniform float uPrefilter;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  vec3 tap(vec2 o) { return min(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(64.0)); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
    float wa = 1.0 / (1.0 + luma(a));
    float wb = 1.0 / (1.0 + luma(b));
    float wc = 1.0 / (1.0 + luma(c));
    float wd = 1.0 / (1.0 + luma(d));
    return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  }
  void main() {
    vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
    vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
    vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
    vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
    vec3 o;
    if (uPrefilter > 0.5) {
      o = karis(j, k, l, m) * 0.5 + (karis(a, b, d, e) + karis(b, c, e, f) + karis(d, e, g, h) + karis(e, f, h, i)) * 0.125;
      float br = max(o.r, max(o.g, o.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      o *= max(soft, br - uThreshold) / max(br, 1e-4);
    } else {
      o = (j + k + l + m) * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + e * 0.125;
    }
    gl_FragColor = vec4(o, 1.0);
  }
`;

const UP_FS = /* glsl */ `
  uniform sampler2D tSmall;
  uniform sampler2D tLevel;
  uniform vec2 uTexel; // the small one's texel
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel * uRadius;
    vec3 s = texture2D(tSmall, vUv).rgb * 4.0;
    s += (texture2D(tSmall, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSmall, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSmall, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSmall, vUv + vec2(0.0, t.y)).rgb) * 2.0;
    s += texture2D(tSmall, vUv - t).rgb + texture2D(tSmall, vUv + t).rgb + texture2D(tSmall, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSmall, vUv + vec2(t.x, -t.y)).rgb;
    gl_FragColor = vec4(texture2D(tLevel, vUv).rgb + s / 16.0, 1.0);
  }
`;

const MAX_LEVELS = 5;

export class Bloom {
  constructor({ threshold = 1.1, knee = 0.6, radius = 1 } = {}) {
    this.down = passMaterial(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: threshold }, uKnee: { value: knee } });
    this.up = passMaterial(UP_FS, { tSmall: { value: null }, tLevel: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: radius } });
    this.downs = []; // half, quarter... resolution
    this.ups = [];
    this.size = '';
  }

  fit(width, height) {
    const key = `${width}x${height}`;
    if (this.size === key) return;
    this.release();
    this.size = key;
    let w = Math.ceil(width / 2);
    let h = Math.ceil(height / 2);
    for (let i = 0; i < MAX_LEVELS; i++) {
      this.downs.push(passTarget(w, h));
      if (i < MAX_LEVELS - 1) this.ups.push(passTarget(w, h));
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
    }
  }

  render(renderer, screen, texture, { levels = MAX_LEVELS } = {}) {
    const { width, height } = texture.image;
    this.fit(width, height);
    const n = Math.min(levels, MAX_LEVELS);
    const du = this.down.uniforms;
    let src = texture;
    du.uTexel.value.set(1 / width, 1 / height);
    for (let i = 0; i < n; i++) {
      const t = this.downs[i];
      du.tSrc.value = src;
      du.uPrefilter.value = i === 0 ? 1 : 0;
      screen.draw(renderer, this.down, t);
      src = t.texture;
      du.uTexel.value.set(1 / t.width, 1 / t.height);
    }
    const uu = this.up.uniforms;
    let small = this.downs[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      uu.tSmall.value = small.texture;
      uu.tLevel.value = this.downs[i].texture;
      uu.uTexel.value.set(1 / small.width, 1 / small.height);
      screen.draw(renderer, this.up, this.ups[i]);
      small = this.ups[i];
    }
    return small.texture;
  }

  materials() {
    return [this.down, this.up];
  }

  // The chain's targets freed (made again on the next render).
  release() {
    for (const t of [...this.downs, ...this.ups]) t.dispose();
    this.downs = [];
    this.ups = [];
    this.size = '';
  }

  dispose() {
    this.release();
    this.down.dispose();
    this.up.dispose();
  }
}
