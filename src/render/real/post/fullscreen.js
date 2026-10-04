// The realistic look's post chain's shared pieces (render/real/post/*: Ssao.js, Bloom.js,
// Shafts.js, run by RealPost.js): one fullscreen triangle every pass draws with, its vertex
// shader (vUv: 0..1 over the target), a pass's material, a pass's target (half float, linear
// filtering, no depth) and the depth helpers the passes that read the scene's depth share.
//
//   const screen = new Screen()
//   screen.draw(renderer, material, target)   // one triangle into `target` (null: the canvas)
//   screen.dispose()
//   passMaterial(fragmentShader, uniforms, defines) -> ShaderMaterial
//   passTarget(width, height) -> WebGLRenderTarget
//   depthUniforms() -> { tDepth, uNear, uFar, uProj }   // DEPTH_GLSL's; setDepth(uniforms,
//       depthTexture, camera) fills them in
//   DEPTH_GLSL   // linZ(d): a depth buffer value's distance in front of the camera (world units);
//                // viewPos(uv, d): the view-space point behind that pixel

import * as THREE from 'three';
import { fullscreenTriangle } from '../../post/N64Pass.js';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const DEPTH_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uProj; // the projection's [0][0] and [1][1]
  float linZ(float d) {
    float z = d * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }
  vec3 viewPos(vec2 uv, float d) {
    float z = linZ(d);
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * z / uProj.x, ndc.y * z / uProj.y, -z);
  }
`;

export function passMaterial(fragmentShader, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
}

export function passTarget(width, height) {
  return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
}

export const depthUniforms = () => ({ tDepth: { value: null }, uNear: { value: 1 }, uFar: { value: 2 }, uProj: { value: new THREE.Vector2(1, 1) } });

export function setDepth(uniforms, depth, camera) {
  uniforms.tDepth.value = depth;
  uniforms.uNear.value = camera.near;
  uniforms.uFar.value = camera.far;
  uniforms.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
}

export class Screen {
  constructor() {
    this.quad = new THREE.Mesh(fullscreenTriangle(), null);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shaders
  }

  draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.quad.geometry.dispose();
  }
}
