// The realistic look's post chain (render/real/RealLook.js), between the HDR scene and the
// output pass: screen-space effects from the scene's own colour and depth (a DepthTexture on
// the HDR target, resolved from its MSAA with the colour: no normal pass, no second draw of the
// scene): the ambient occlusion (Ssao.js, half res), the bloom (Bloom.js, a mip chain from half
// res) and the sun shafts (Shafts.js, quarter res). Which of them run, and how finely, is the
// tier's level's (tier.js ladder: level.post); their settings the look's (layout.LANE_REAL.post).
// The output pass composites them (OutputPass.js).
//
//   const post = new RealPost(settings)          // { ao, bloom, shafts }: LANE_REAL.post
//   post.render(renderer, target, camera, sunDir, level.post) -> fx
//       fx { ao, bloom, shafts (textures or null), sun (the sun's uv), sunVis (0..1) } (reused);
//       target: the HDR scene target (its texture, and its depthTexture for the occlusion and
//       the shafts: without one, or once the depth's resolve has failed (depthOk false: some
//       drivers refuse a multisampled depth blit), only the bloom runs)
//   post.drawn                  // the passes drawn in the last render (draw calls: high 14
//                               // facing the sun, 12 away from it; mid 10)
//   post.compile(renderer) -> Promise   // every program it may draw with (the build's link)
//   post.release()              // its targets freed (RealLook.detach; made again on use)
//   post.dispose()

import * as THREE from 'three';
import { Screen, passTarget } from './fullscreen.js';
import { Ssao } from './Ssao.js';
import { Bloom } from './Bloom.js';
import { Shafts } from './Shafts.js';

export class RealPost {
  constructor({ ao, bloom, shafts } = {}) {
    this.screen = new Screen();
    this.ssao = new Ssao(ao);
    this.bloom = new Bloom(bloom);
    this.shafts = new Shafts(shafts);
    this.fx = { ao: null, bloom: null, shafts: null, sun: new THREE.Vector2(), sunVis: 0 };
    this.drawn = 0;
    this.depthOk = true;
  }

  render(renderer, target, camera, sunDir, post) {
    const fx = this.fx;
    fx.ao = fx.bloom = fx.shafts = null;
    fx.sunVis = 0;
    const calls = renderer.info.render.calls;
    const depth = this.depthOk ? target.depthTexture : null;
    const { screen } = this;
    if (post.ao > 0 && depth) fx.ao = this.ssao.render(renderer, screen, depth, camera, post);
    if (post.bloom > 0) fx.bloom = this.bloom.render(renderer, screen, target.texture, { levels: post.bloom });
    if (post.shafts && depth) {
      const s = this.shafts.render(renderer, screen, target.texture, depth, camera, sunDir);
      if (s) {
        fx.shafts = s.texture;
        fx.sun.copy(s.sun);
        fx.sunVis = s.vis;
      }
    }
    this.drawn = renderer.info.render.calls - calls;
    return fx;
  }

  materials() {
    return [...this.ssao.materials(), ...this.bloom.materials(), ...this.shafts.materials()];
  }

  // Each program compiled as it will draw (into a half-float target), in parallel where the
  // browser can.
  compile(renderer) {
    const target = passTarget(1, 1);
    const before = renderer.getRenderTarget();
    const done = [];
    try {
      renderer.setRenderTarget(target);
      for (const m of this.materials()) {
        this.screen.quad.material = m;
        done.push(renderer.compileAsync(this.screen.scene, this.screen.camera));
      }
    } finally {
      renderer.setRenderTarget(before);
    }
    return Promise.all(done).finally(() => target.dispose());
  }

  release() {
    this.ssao.release();
    this.bloom.release();
    this.shafts.release();
  }

  dispose() {
    this.ssao.dispose();
    this.bloom.dispose();
    this.shafts.dispose();
    this.screen.dispose();
  }
}
