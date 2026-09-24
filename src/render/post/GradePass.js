// Native-resolution counterpart of the N64 pass's storm grade: while the AI RACE darkness or
// a lightning flash is active in native mode, the scene is drawn into a full-size target and
// this pass copies it to the canvas through the same grade (post/storm.js). Without either,
// native mode draws straight to the canvas as before (no target, no extra pass).

import * as THREE from 'three';
import { fullscreenTriangle } from './N64Pass.js';
import { GRADE_GLSL } from './storm.js';

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  ${GRADE_GLSL}

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 c = linearToSrgb(texelFetch(tScene, ivec2(gl_FragCoord.xy), 0).rgb);
    gl_FragColor = vec4(stormGrade(c), 1.0); // display colour, written as is
  }
`;

export class GradePass {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uStorm: { value: 0 }, uFlash: { value: 0 } },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.target = null; // created on first use, sized to the drawing buffer
  }

  // The full-resolution scene target (created or resized on demand).
  targetFor(width, height) {
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(width, height, {
        colorSpace: THREE.SRGBColorSpace,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
        generateMipmaps: false,
        depthBuffer: true,
      });
    } else if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }
    return this.target;
  }

  render(renderer, texture, storm, flash) {
    const u = this.material.uniforms;
    u.tScene.value = texture;
    u.uStorm.value = storm;
    u.uFlash.value = flash;
    renderer.render(this.scene, this.camera);
  }

  // Frees the full-size target (it comes back on the next use).
  release() {
    this.target?.dispose();
    this.target = null;
  }

  dispose() {
    this.release();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
