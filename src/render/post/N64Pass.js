// The single fullscreen pass of N64 mode. It turns the low-resolution scene render into
// something like a clean capture of the console's video output:
//   1. every source pixel is converted to sRGB and stored the way a 16-bit framebuffer
//      would hold it: 5 bits per channel with a 4x4 ordered dither;
//   2. a soft horizontal filter blends each pixel with its neighbours (the video
//      interface's smoothing, which also hides most of the dither);
//   3. the result is bilinearly upscaled to the output;
//   4. the AI RACE storm grade and lightning flash (post/storm.js), then the meltdown's fire
//      grade, glare and white-out (post/meltdown.js; its heat shimmer offsets where step 1
//      samples), all skipped at 0.
// Steps 1-2 must happen per source pixel, so the shader does its own bilinear filtering
// from 2 rows x 4 columns of texelFetch()es instead of relying on the sampler.

import * as THREE from 'three';
import { bayerMatrix } from './screen.js';
import { GRADE_GLSL } from './storm.js';
import { MELT_GLSL, MELT_OFF, meltUniforms, setMeltUniforms } from './meltdown.js';

// Look parameters (tuned by eye against the preview screenshots).
export const N64_LOOK = Object.freeze({
  levels: 31, // quantisation steps per channel (31 = RGB555); 0 disables quantisation
  viBlur: 0.16, // weight of each horizontal neighbour in the video filter
});

const BAYER = bayerMatrix(4)
  .map((v) => v.toFixed(5))
  .join(', ');

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene; // internal-resolution scene, linear colour
  uniform vec2 srcSize;
  uniform float levels;
  uniform float viBlur;
  varying vec2 vUv;
  ${GRADE_GLSL}
  ${MELT_GLSL}

  const float BAYER[16] = float[16](${BAYER});

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // One pixel as the 16-bit framebuffer holds it.
  vec3 framebuffer(ivec2 p) {
    p = clamp(p, ivec2(0), ivec2(srcSize) - 1);
    vec3 c = linearToSrgb(texelFetch(tScene, p, 0).rgb);
    if (levels > 0.0) {
      float threshold = BAYER[(p.y & 3) * 4 + (p.x & 3)];
      c = floor(c * levels + 0.5 + threshold) / levels;
    }
    return c;
  }

  // Video-filtered pixels p and p + (1, 0), linearly blended by fx.
  vec3 scanline(ivec2 p, float fx) {
    vec3 a = framebuffer(p + ivec2(-1, 0));
    vec3 b = framebuffer(p);
    vec3 c = framebuffer(p + ivec2(1, 0));
    vec3 d = framebuffer(p + ivec2(2, 0));
    vec3 left = b + (a + c - 2.0 * b) * viBlur;
    vec3 right = c + (b + d - 2.0 * c) * viBlur;
    return mix(left, right, fx);
  }

  void main() {
    vec2 st = (vUv + heatShimmer(vUv)) * srcSize - 0.5;
    vec2 base = floor(st);
    vec2 f = st - base;
    ivec2 p = ivec2(base);
    vec3 color = mix(scanline(p, f.x), scanline(p + ivec2(0, 1), f.x), f.y);
    color = stormGrade(color);
    color = meltGrade(color, vUv);
    gl_FragColor = vec4(color, 1.0); // already sRGB: written to the canvas as is
  }
`;

// Fullscreen triangle in clip space (covers the viewport with a single primitive).
export function fullscreenTriangle() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geo;
}

export class N64Pass {
  constructor({ levels = N64_LOOK.levels, viBlur = N64_LOOK.viBlur } = {}) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        srcSize: { value: new THREE.Vector2(1, 1) },
        levels: { value: levels },
        viBlur: { value: viBlur },
        uStorm: { value: 0 },
        uFlash: { value: 0 },
        ...meltUniforms(),
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shader
  }

  // Storm grade strength (darkness t) and lightning flash brightness, both 0 = off.
  setGrade(storm, flash) {
    const u = this.material.uniforms;
    u.uStorm.value = storm;
    u.uFlash.value = flash;
  }

  // The meltdown's grade state (post/meltdown.js setMeltUniforms; MELT_OFF = none).
  setMeltdown(g = MELT_OFF) {
    setMeltUniforms(this.material.uniforms, g);
  }

  // Draw `texture` (width x height) to the current render target (the canvas).
  render(renderer, texture, width, height) {
    const u = this.material.uniforms;
    u.tScene.value = texture;
    u.srcSize.value.set(width, height);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
