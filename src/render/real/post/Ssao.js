// The realistic look's ambient occlusion (render/real/post/RealPost.js): scalable ambient
// obscurance (McGuire 2012) from the scene's depth buffer alone, no normal pass (a second
// draw of the ~760k-triangle street): each pixel's normal is rebuilt from its neighbours'
// depths (the smaller one-sided difference on each axis, so a silhouette makes no halo), and
// its `samples` taps (8 or 12, a define: two programs) on a golden-angle spiral within `radius`
// world units (~0.7 m) count what rises above its plane, faded with distance (a dimensionless
// falloff: max(cos - bias, 0) x (1 - d^2 / r^2)); the whole of it fades out with the pixel's
// own distance (`fade`: none past 9000, the far forest and the houses down the street: their
// occlusion there was noise over needle cards, a dark mottle on the forest). At half resolution, then blurred depth-aware
// (separable, 9 + 9 taps, 5 + 5 on the mid tier's level: `blur` 4 or 2, a define), keeping
// each texel's distance beside it for the output pass's depth-aware upsample (OutputPass.js).
// The sky (depth 1) is never occluded.
//
// **Whole texels** (the streaks fix): every depth it reads is a whole texel (`texelFetch`, the
// half-res pixel's own full-res texel from gl_FragCoord, one in from the edges, its neighbours
// and taps whole texels from it), each rebuilt at that texel's own centre. A half-res pixel's middle is the corner of
// four full-res texels wherever the picture's size is even; read there by uv, which texel came
// back was the GPU's rounding, the middle and a neighbour could be the same texel, its
// one-sided difference zero, "the smaller" then: the normal faced the camera and flat ground
// occluded itself across whole rows, the blur spreading them into the dark horizontal bands the
// dad saw over the road (on his GPU; in SwiftShader two lines).
//
//   const ssao = new Ssao({ radius, intensity, bias, maxPx, fade })   // layout.LANE_REAL.post.ao
//   ssao.render(renderer, screen, depth, camera, { ao, blur }) -> texture (half res: R the
//       occlusion's light, 1 = none; G the distance); ao: its taps (12 or 8: the level's
//       post.ao), blur: the blur's half width (4 or 2)
//   ssao.materials()        // every program it may draw with (RealPost.compile)
//   ssao.release()          // frees its targets (made again on the next render)
//   ssao.dispose()

import * as THREE from 'three';
import { DEPTH_GLSL, depthUniforms, passMaterial, passTarget, setDepth } from './fullscreen.js';

const AO_FS = /* glsl */ `
  ${DEPTH_GLSL}
  uniform vec2 uFull; // the depth's size
  uniform float uRadius;
  uniform float uIntensity;
  uniform float uBias;
  uniform float uMaxPx;
  uniform vec2 uFade; // the distances it fades out between
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  // The view-space point behind the depth's texel t, at that texel's own centre.
  vec3 texelPos(ivec2 t) {
    return viewPos((vec2(t) + 0.5) / uFull, texelFetch(tDepth, t, 0).r);
  }
  void main() {
    ivec2 hi = ivec2(uFull) - 1;
    // This half-res pixel's texel, in whole numbers (one in from the picture's edges: a
    // neighbour on each side).
    ivec2 q = clamp(ivec2(gl_FragCoord.xy) * 2, ivec2(1), hi - 1);
    float d = texelFetch(tDepth, q, 0).r;
    if (d >= 0.99999) {
      gl_FragColor = vec4(1.0, 6e4, 0.0, 1.0);
      return;
    }
    vec3 P = viewPos((vec2(q) + 0.5) / uFull, d);
    vec3 pr = texelPos(q + ivec2(1, 0)) - P;
    vec3 pl = P - texelPos(q - ivec2(1, 0));
    vec3 pu = texelPos(q + ivec2(0, 1)) - P;
    vec3 pd = P - texelPos(q - ivec2(0, 1));
    vec3 N = normalize(cross(abs(pr.z) < abs(pl.z) ? pr : pl, abs(pu.z) < abs(pd.z) ? pu : pd));
    float z = -P.z;
    float rPx = min(uMaxPx, 0.5 * uFull.y * uProj.y * uRadius / z);
    float r2 = uRadius * uRadius;
    float angle0 = ign(gl_FragCoord.xy) * 6.2831853;
    float sum = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float ang = angle0 + float(i) * 2.3999632;
      vec2 o = vec2(cos(ang), sin(ang)) * sqrt((float(i) + 0.5) / float(SAMPLES)) * rPx;
      vec3 v = texelPos(clamp(q + ivec2(floor(o + 0.5)), ivec2(0), hi)) - P;
      float vv = dot(v, v);
      sum += max(dot(v, N) / (sqrt(vv) + 1e-3) - uBias, 0.0) * max(1.0 - vv / r2, 0.0);
    }
    // (Faded out with distance: far off its taps span a few pixels of alpha-tested needles and
    // tile rolls, noise rather than occlusion, and the haze softens what is there anyway.)
    float fade = 1.0 - smoothstep(uFade.x, uFade.y, z);
    gl_FragColor = vec4(clamp(1.0 - uIntensity * 2.0 * fade * sum / float(SAMPLES), 0.0, 1.0), z, 0.0, 1.0);
  }
`;

// Depth-aware separable blur of the occlusion (R), keeping its distance (G).
const BLUR_FS = /* glsl */ `
  uniform sampler2D tAO;
  uniform vec2 uDir; // one texel along the axis
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    if (c.g > 5e4) {
      gl_FragColor = vec4(1.0, c.g, 0.0, 1.0);
      return;
    }
    float sum = c.r;
    float wsum = 1.0;
    for (int i = -BLUR; i <= BLUR; i++) {
      if (i == 0) continue;
      vec2 s = texture2D(tAO, vUv + uDir * float(i)).rg;
      float w = exp(-float(i * i) / (0.75 * float(BLUR * BLUR))) * max(0.0, 1.0 - abs(s.g - c.g) / (0.04 * c.g));
      sum += s.r * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
  }
`;

export class Ssao {
  constructor({ radius = 110, intensity = 2.6, bias = 0.12, maxPx = 90, fade = [4500, 9000] } = {}) {
    this.ao = {}; // samples -> material
    this.blur = {}; // blur radius -> material
    for (const samples of [12, 8]) {
      this.ao[samples] = passMaterial(AO_FS, { ...depthUniforms(), uFull: { value: new THREE.Vector2() }, uRadius: { value: radius }, uIntensity: { value: intensity }, uBias: { value: bias }, uMaxPx: { value: maxPx }, uFade: { value: new THREE.Vector2(fade[0], fade[1]) } }, { SAMPLES: samples });
    }
    for (const blur of [4, 2]) this.blur[blur] = passMaterial(BLUR_FS, { tAO: { value: null }, uDir: { value: new THREE.Vector2() } }, { BLUR: blur });
    this.a = null; // the half-res ping-pong targets
    this.b = null;
  }

  fit(width, height) {
    const w = Math.ceil(width / 2);
    const h = Math.ceil(height / 2);
    if (this.a?.width === w && this.a.height === h) return;
    this.release();
    this.a = passTarget(w, h);
    this.b = passTarget(w, h);
  }

  render(renderer, screen, depth, camera, { ao: samples = 12, blur = 4 } = {}) {
    this.fit(depth.image.width, depth.image.height);
    const ao = this.ao[samples] ?? this.ao[12];
    const u = ao.uniforms;
    setDepth(u, depth, camera);
    u.uFull.value.set(depth.image.width, depth.image.height);
    screen.draw(renderer, ao, this.a);
    const pass = this.blur[blur] ?? this.blur[4];
    const bu = pass.uniforms;
    bu.tAO.value = this.a.texture;
    bu.uDir.value.set(1 / this.a.width, 0);
    screen.draw(renderer, pass, this.b);
    bu.tAO.value = this.b.texture;
    bu.uDir.value.set(0, 1 / this.a.height);
    screen.draw(renderer, pass, this.a);
    return this.a.texture;
  }

  materials() {
    return [...Object.values(this.ao), ...Object.values(this.blur)];
  }

  release() {
    this.a?.dispose();
    this.b?.dispose();
    this.a = this.b = null;
  }

  dispose() {
    this.release();
    for (const m of this.materials()) m.dispose();
  }
}
