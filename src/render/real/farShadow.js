// The realistic look's far sun shadow (render/real/RealLook.js): one depth map of the whole
// area from the sun (an orthographic box fitted round `box`, the area's bounds, and reaching
// toward the sun for the casters outside them), drawn once when the build is readied (its
// static casters: the street, the houses, walls, trees, hedges, cars; Jonas hidden) and kept
// for every visit. Every realistic material samples it where the sun's own map (the near one,
// a tight box round the focus, re-drawn each frame) ends (materials.js sunShadowChunk: the
// look's haze uniforms carry `uniforms`). Drawn by three's own shadow pass (renderer.shadowMap:
// alpha-tested leaves, double-sided caps and every material's shadow side as the near map
// has them) for a light of its own that is never in the scene (no actor's program changes):
// inside a render of the scene (the pass needs the renderer's render state: the scene's
// lights, so its depth programs are the near map's) from a camera that sees only the lights (a
// layer of their own for the while: nothing is drawn), into a one-pixel target, the near map
// left as it is meanwhile. Its depth texture is made at once
// (and bound to the materials before it is drawn, a sampler of the right kind: uFarShadowParams
// says not to read it yet).
//
//   const far = new FarShadow({ size, sunDir, box, bias, normalBias })   // box { x0, x1, y0, y1,
//       z0, z1 } (world); bias: the depth bias; normalBias: world units along the normal
//   far.uniforms         // { uFarShadow (the depth texture), uFarMatrix (world to the map's
//                        // uv and depth), uFarShadowParams (on, bias, size, normal bias) }
//   far.take(renderer, scene, camera)   // draws it from what `scene` shows now
//   far.taken, far.draws, far.texel   // drawn; how many times (once a build); its texels'
//                        // size across the light (world units)
//   far.dispose()

import * as THREE from 'three';

const DISTANCE = 20000; // the light's distance from the box's middle, toward the sun
const REACH = 6000; // how far toward the sun past the box casters are drawn
const LIGHTS = 31; // the layer the scene's lights are on for the while (take)

export class FarShadow {
  constructor({ size, sunDir, box, bias = -0.0002, normalBias = 8 }) {
    const light = (this.light = new THREE.DirectionalLight(0xffffff, 0));
    light.name = 'farSun';
    light.castShadow = true;
    const shadow = light.shadow;
    shadow.mapSize.set(size, size);
    shadow.bias = bias;
    shadow.autoUpdate = false;
    // (Made as three's shadow pass makes a PCF map's, so it keeps it.)
    shadow.map = new THREE.WebGLRenderTarget(size, size);
    const depth = (shadow.map.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType));
    depth.name = 'farSun.shadowMap';
    depth.format = THREE.DepthFormat;
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    depth.needsUpdate = true; // (allocated on its first use, empty: a valid depth texture to bind)
    const d = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize();
    const middle = new THREE.Vector3((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
    light.position.copy(middle).addScaledVector(d, DISTANCE);
    light.target.position.copy(middle);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    // The box's corners in the light's view: its extents across the light and along it.
    const camera = shadow.camera;
    camera.position.copy(light.position);
    camera.lookAt(middle);
    camera.updateMatrixWorld();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const x of [box.x0, box.x1]) {
      for (const y of [box.y0, box.y1]) {
        for (const z of [box.z0, box.z1]) {
          p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          lo.min(p);
          hi.max(p);
        }
      }
    }
    Object.assign(camera, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(1, -hi.z - REACH), far: -lo.z + 100 });
    camera.updateProjectionMatrix();
    this.texel = Math.max(hi.x - lo.x, hi.y - lo.y) / size;
    this.uniforms = {
      uFarShadow: { value: depth },
      uFarMatrix: { value: new THREE.Matrix4() },
      uFarShadowParams: { value: new THREE.Vector4(0, bias, size, normalBias) },
    };
    this.taken = false;
    this.draws = 0;
  }

  take(renderer, scene, camera) {
    const shadows = renderer.shadowMap;
    const { autoUpdate, needsUpdate } = shadows;
    const shadow = this.light.shadow;
    const hook = scene.onAfterRender;
    const before = renderer.getRenderTarget();
    const pixel = new THREE.WebGLRenderTarget(1, 1);
    const blind = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
    blind.layers.set(LIGHTS);
    const lights = [];
    scene.traverse((o) => o.isLight && !o.layers.isEnabled(LIGHTS) && lights.push(o));
    for (const l of lights) l.layers.enable(LIGHTS);
    scene.onAfterRender = () => {
      shadow.needsUpdate = true;
      shadows.needsUpdate = true;
      shadows.render([this.light], scene, camera);
    };
    shadows.autoUpdate = false; // (the near map left as it is)
    shadows.needsUpdate = false;
    try {
      renderer.setRenderTarget(pixel);
      renderer.render(scene, blind);
    } finally {
      scene.onAfterRender = hook;
      for (const l of lights) l.layers.disable(LIGHTS);
      Object.assign(shadows, { autoUpdate, needsUpdate });
      renderer.setRenderTarget(before);
      pixel.dispose();
    }
    const u = this.uniforms;
    u.uFarMatrix.value.copy(shadow.matrix);
    u.uFarShadowParams.value.x = 1;
    this.taken = true;
    this.draws++;
  }

  dispose() {
    this.light.shadow.dispose();
    this.light.dispose();
  }
}
