// The realistic look's reflection probe (render/real/RealLook.js): one cube capture of the
// finished street from a point on it, prefiltered (PMREM) for the glossy materials' envMap (the
// windows, later the cars' paint), so they reflect the real houses and trees instead of only the
// sky. The capture's half-float cube is freed as soon as it is filtered.
//
//   captureProbe(renderer, scene, { at, size, near, far, hide }) -> WebGLRenderTarget (PMREM)
//       at: { x, y, z } (world); size: the cube's faces (px); hide: objects hidden while it is
//       taken (Jonas, who moves)
//   blankProbe(renderer, size) -> WebGLRenderTarget (PMREM)   // the same of an empty cube: a
//       stand-in of the probe's size, so the materials that will reflect it compile (and the
//       prefilter's programs are made) before the street is there to capture
//
// The shadow map is drawn once for all six faces (the sun does not move between them).

import * as THREE from 'three';

export function captureProbe(renderer, scene, { at, size = 256, near = 20, far = 40000, hide = [] }) {
  const cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const camera = new THREE.CubeCamera(near, far, cube);
  camera.position.set(at.x, at.y, at.z);
  camera.updateMatrixWorld();
  const shown = hide.map((o) => o.visible);
  for (const o of hide) o.visible = false;
  const shadows = renderer.shadowMap;
  const auto = shadows.autoUpdate;
  shadows.autoUpdate = false;
  shadows.needsUpdate = true;
  try {
    camera.update(renderer, scene);
  } finally {
    shadows.autoUpdate = auto;
    hide.forEach((o, i) => (o.visible = shown[i]));
  }
  return prefilter(renderer, cube);
}

export function blankProbe(renderer, size) {
  return prefilter(renderer, new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType }));
}

function prefilter(renderer, cube) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = pmrem.fromCubemap(cube.texture);
  pmrem.dispose();
  cube.dispose();
  return out;
}
