// A picture fading out over the ones after it (render/N64Renderer.js crossfade: a realistic look
// coming or going, or its tier stepping, cross-fades instead of popping). The canvas as it stands
// is copied once (freeze), then drawn over each new frame at 1 - t until `seconds` have passed.
//
//   const fade = new FadePass()
//   fade.freeze(renderer, seconds)   // copy the drawing buffer (right after a frame was drawn to
//                                    // it, in the same task: it is not kept after)
//   fade.draw(renderer)              // over the frame just drawn to the canvas; frees the copy
//                                    // once the fade is over (release)
//   fade.active, fade.release(), fade.dispose()

import * as THREE from 'three';
import { fullscreenTriangle } from './N64Pass.js';

export class FadePass {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { tFrame: { value: null }, uAlpha: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tFrame; uniform float uAlpha; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tFrame, vUv).rgb, uAlpha); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shader
    this.size = new THREE.Vector2();
    this.texture = null;
    this.start = 0;
    this.seconds = 0;
  }

  get active() {
    return this.texture !== null;
  }

  freeze(renderer, seconds) {
    renderer.getDrawingBufferSize(this.size);
    const { x, y } = this.size;
    if (this.texture?.image.width !== x || this.texture.image.height !== y) {
      this.texture?.dispose();
      this.texture = new THREE.FramebufferTexture(x, y);
      this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(this.texture);
    this.start = performance.now();
    this.seconds = seconds;
  }

  draw(renderer) {
    const t = (performance.now() - this.start) / 1000 / this.seconds;
    if (t >= 1) {
      this.release();
      return;
    }
    this.material.uniforms.tFrame.value = this.texture;
    this.material.uniforms.uAlpha.value = 1 - t * t * (3 - 2 * t);
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = clear;
  }

  release() {
    this.texture?.dispose();
    this.texture = null;
  }

  dispose() {
    this.release();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
