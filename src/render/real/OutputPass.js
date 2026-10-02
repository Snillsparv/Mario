// The realistic look's output pass (render/real/RealLook.js): one fullscreen triangle from the
// HDR scene target to the canvas (or to the grade's or the retro filter's target): the
// exposure and Khronos PBR Neutral tone mapping (three.js's NeutralToneMapping, which reads the
// renderer's toneMappingExposure), a touch more saturation, a soft vignette and an 8 x 8 ordered
// dither (no banding in the sky's long gradients).
//
//   const pass = new OutputPass({ saturation, vignette })
//   pass.render(renderer, texture, { encode })   // into the bound target; encode: sRGB out (the
//                                                // canvas), else linear (an sRGB-stored target
//                                                // encodes on write: the storm grade's, retro's)
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
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uEncode;
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

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 size = vec2(textureSize(tScene, 0));
    vec3 c = NeutralToneMapping(texelFetch(tScene, p, 0).rgb);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    vec2 d = gl_FragCoord.xy / size - 0.5;
    c = clamp(c * (1.0 - uVignette * dot(d, d) * 2.0), 0.0, 1.0);
    if (uEncode > 0.5) c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
    gl_FragColor = vec4(c + bayer(p) / 255.0, 1.0);
  }
`;

export class OutputPass {
  constructor({ saturation = 1.05, vignette = 0.15 } = {}) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uSaturation: { value: saturation }, uVignette: { value: vignette }, uEncode: { value: 1 } },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shader
  }

  render(renderer, texture, { encode = true } = {}) {
    const u = this.material.uniforms;
    u.tScene.value = texture;
    u.uEncode.value = encode ? 1 : 0;
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
