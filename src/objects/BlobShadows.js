// N64-style round blob shadows (one instanced draw call) laid flat on the floor under coins, the
// star and the 1-up, tilted to the floor's slope.

import * as THREE from 'three';
import { makeShadowTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const LIFT = 2; // units above the floor (plus polygon offset) to avoid z-fighting
// Blended surfaces draw in renderOrder: after the terrain's path decal (0) so paths do not
// paint over the shadows, before the water (1) so underwater shadows show through it.
export const SHADOW_RENDER_ORDER = 0.5;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class BlobShadows {
  constructor(capacity) {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = SHADOW_RENDER_ORDER;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO);
  }

  // Shadow i on the floor point (x, y, z) with unit normal n, `size` units across.
  place(i, x, y, z, n, size) {
    _n.set(n.x, n.y, n.z);
    _q.setFromUnitVectors(UP, _n);
    _m.compose(_p.set(x, y + LIFT, z), _q, _s.set(size, 1, size));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(i) {
    this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Shadow diameter for an object `height` units above the floor: shrinks as it rises.
export function shadowSize(base, height) {
  const k = 1 - height / 1400;
  return base * (k > 0.35 ? k : 0.35);
}
