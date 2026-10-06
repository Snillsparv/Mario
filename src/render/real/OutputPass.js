// The realistic look's output pass (render/real/RealLook.js): one fullscreen triangle from the
// HDR scene target to the canvas (or to the grade's or the retro filter's target). It
// composites the post chain's effects (render/real/post/RealPost.js) into the HDR colour: the
// ambient occlusion (a depth-aware upsample of its half-res result: of the four nearest texels
// those at this pixel's distance; never on the sky, and fading on bright pixels: `aoLit`, so
// sunlit faces never look dirty), the bloom (mixed in: its share of the picture is the glow's,
// so what does not bloom is darkened by as much, as the GTA prototype's chosen grade had it)
// and the sun shafts (added); then the exposure and
// Khronos PBR Neutral tone mapping (three.js's NeutralToneMapping, which reads the renderer's
// toneMappingExposure); then the grade (a filmic S-contrast, split toning: cool shadows, warm
// highlights, saturation, a black-level lift), the lens (edge colour fringing toward the
// corners, a vignette, film grain) and an 8 x 8 ordered dither (no banding in the sky's long
// gradients).
//
//   const pass = new OutputPass({ grade })   // layout.LANE_REAL.grade (without one: R3's
//                                            // saturation 1.05 and vignette 0.15, nothing else)
//   pass.grade                  // the grade's uniforms, shared with whatever must look as the
//                               // classic look draws it through the look (materials.js
//                               // classicLook turns the grade and the bloom's mix back: the
//                               // signs' boards; the bloom's share is material.uniforms.uBloom)
//   pass.render(renderer, texture, { encode, fx, depth, camera, ca })   // into the bound target;
//       encode: sRGB out (the canvas), else linear (an sRGB-stored target encodes on write: the
//       storm grade's, retro's); fx: RealPost.render's (or none); depth: the scene's depth
//       texture (the occlusion's upsample); camera: the scene's (its near and far); ca: the
//       level's colour fringing on
//   pass.dispose()

import * as THREE from 'three';
import { fullscreenTriangle } from '../post/N64Pass.js';

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tAO;
  uniform sampler2D tBloom;
  uniform sampler2D tShafts;
  uniform float uEncode;
  uniform float uAO; // the occlusion's share (0: none)
  uniform float uAOLit; // how much of it bright pixels lose
  uniform float uBloom; // the bloom's (0: none)
  uniform float uShafts; // the shafts' strength x the sun's visibility (0: none)
  uniform vec3 uShaftTint;
  uniform float uCA; // edge colour fringing at the corners (uv)
  uniform float uGrain;
  uniform float uTime;
  uniform float uNear;
  uniform float uFar;
  #include <tonemapping_pars_fragment>

  // 8 x 8 Bayer threshold in (-0.5, 0.5).
  float bayer(ivec2 p) {
    int x = p.x & 7;
    int y = p.y & 7;
    int v = 0;
    int a = x ^ y;
    for (int b = 0; b < 3; b++) v = (v << 2) | (((a >> b) & 1) << 1) | ((y >> b) & 1);
    return (float(v) + 0.5) / 64.0 - 0.5;
  }
  // (No sin: fract(sin(x) * 43758) at a screen's coordinates is past where a GPU's sin keeps its
  // precision, and the grain then comes out in stripes.)
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float linZ(float d) {
    float z = d * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }
  // The half-res occlusion at this pixel: its four nearest texels, those at this distance.
  float aoAt(vec2 uv, float z) {
    vec2 hs = vec2(textureSize(tAO, 0));
    vec2 f = uv * hs - 0.5;
    vec2 b = floor(f);
    vec2 t = f - b;
    float sum = 0.0;
    float wsum = 1e-4;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 s = texture2D(tAO, (b + vec2(float(i), float(j)) + 0.5) / hs).rg;
        float w = (i == 0 ? 1.0 - t.x : t.x) * (j == 0 ? 1.0 - t.y : t.y) / (1e-3 + abs(s.g - z) / z * 30.0);
        sum += s.r * w;
        wsum += w;
      }
    }
    return sum / wsum;
  }

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 size = vec2(textureSize(tScene, 0));
    vec2 uv = gl_FragCoord.xy / size;
    vec2 d = uv - 0.5;
    vec3 c = texelFetch(tScene, p, 0).rgb;
    if (uCA > 0.0) {
      vec2 o = d * dot(d, d) * uCA * 4.0;
      c.r = texture2D(tScene, uv - o).r;
      c.b = texture2D(tScene, uv + o).b;
    }
    if (uAO > 0.0) {
      float depth = texelFetch(tDepth, p, 0).r;
      if (depth < 0.99999) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(1.0, aoAt(uv, linZ(depth)), uAO * (1.0 - uAOLit * smoothstep(0.6, 2.5, l)));
      }
    }
    if (uBloom > 0.0) c = mix(c, texture2D(tBloom, uv).rgb, uBloom);
    if (uShafts > 0.0) c += texture2D(tShafts, uv).rgb * uShaftTint * uShafts;
    c = grade(NeutralToneMapping(c), d);
    if (uGrain > 0.0) c += (hash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * uGrain * (1.0 - 0.6 * dot(c, vec3(0.2126, 0.7152, 0.0722)));
    if (uEncode > 0.5) c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
    gl_FragColor = vec4(c + bayer(p) / 255.0, 1.0);
  }
`;

// The grade (display-referred linear, after the tone mapping) and the vignette: d, the pixel's
// place from the picture's middle (uv - 0.5). The saturation is a vibrance: the more saturated a
// colour already is, the less it is boosted (s, its saturation: none for Jonas's red shirt in
// the sun, which would otherwise lose its last green and blue, most for the sky and the lawns).
// materials.js UNGRADE_GLSL turns it back.
export const GRADE_GLSL = /* glsl */ `
  uniform float uContrast; // the filmic S-curve's share
  uniform float uSplit; // split toning's strength
  uniform vec3 uShadowTint;
  uniform vec3 uHighTint;
  uniform float uSaturation;
  uniform float uBlack; // the black level's lift
  uniform float uVignette;
  float gradeSaturation(vec3 c) {
    float m = max(c.r, max(c.g, c.b));
    float s = m > 1e-4 ? (m - min(c.r, min(c.g, c.b))) / m : 0.0;
    return s * s;
  }
  vec3 gradeTint(float l) {
    return mix(vec3(1.0), uShadowTint, uSplit * (1.0 - l) * (1.0 - l)) * mix(vec3(1.0), uHighTint, uSplit * l * l);
  }
  vec3 grade(vec3 c, vec2 d) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, c * c * (3.0 - 2.0 * c), uContrast) * gradeTint(l);
    l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, mix(uSaturation, 1.0, gradeSaturation(c)));
    c = uBlack + c * (1.0 - uBlack);
    return clamp(c * (1.0 - uVignette * dot(d, d) * 2.0), 0.0, 1.0);
  }
`;

// R3's output, for a look without a grade of its own.
const PLAIN = { contrast: 0, split: 0, shadowTint: [1, 1, 1], highTint: [1, 1, 1], saturation: 1.05, black: 0, vignette: 0.15, ao: 0, aoLit: 0, bloom: 0, shafts: 0, shaftTint: [1, 1, 1], ca: 0, grain: 0 };

// The grade's uniforms (GRADE_GLSL's) for `grade` (LANE_REAL.grade's fields).
export function gradeUniforms(grade = PLAIN) {
  const g = { ...PLAIN, ...grade };
  return {
    uContrast: { value: g.contrast },
    uSplit: { value: g.split },
    uShadowTint: { value: new THREE.Vector3(...g.shadowTint) },
    uHighTint: { value: new THREE.Vector3(...g.highTint) },
    uSaturation: { value: g.saturation },
    uBlack: { value: g.black },
    uVignette: { value: g.vignette },
  };
}

export class OutputPass {
  constructor({ grade = null } = {}) {
    const g = { ...PLAIN, ...grade };
    this.settings = g;
    this.grade = gradeUniforms(g);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tAO: { value: null },
        tBloom: { value: null },
        tShafts: { value: null },
        uEncode: { value: 1 },
        uAO: { value: 0 },
        uAOLit: { value: g.aoLit },
        uBloom: { value: 0 },
        uShafts: { value: 0 },
        uShaftTint: { value: new THREE.Vector3(...g.shaftTint) },
        uCA: { value: 0 },
        uGrain: { value: g.grain },
        uTime: { value: 0 },
        uNear: { value: 1 },
        uFar: { value: 2 },
        ...this.grade,
      },
      vertexShader,
      fragmentShader: GRADE_GLSL + fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      precision: 'highp', // (the depth's distance, the grain's hash: whatever the renderer's default)
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shader
    this.frame = 0; // the grain's clock
  }

  render(renderer, texture, { encode = true, fx = null, depth = null, camera = null, ca = false } = {}) {
    const u = this.material.uniforms;
    const g = this.settings;
    u.tScene.value = texture;
    u.uEncode.value = encode ? 1 : 0;
    u.tDepth.value = depth;
    u.tAO.value = fx?.ao ?? null;
    u.uAO.value = fx?.ao && depth ? g.ao : 0;
    u.tBloom.value = fx?.bloom ?? null;
    u.uBloom.value = fx?.bloom ? g.bloom : 0;
    u.tShafts.value = fx?.shafts ?? null;
    u.uShafts.value = fx?.shafts ? g.shafts * fx.sunVis : 0;
    u.uCA.value = ca ? g.ca : 0;
    u.uTime.value = (this.frame = (this.frame + 1) % 997) * 0.618;
    if (camera) {
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
    }
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
