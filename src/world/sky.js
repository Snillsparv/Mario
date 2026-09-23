// PLACEHOLDER — replaced by the sky implementation.
import * as THREE from 'three';

export function buildSky() {
  const group = new THREE.Group();
  return {
    object3D: group,
    colliders: [],
    update(time, camera) {
      if (group.parent && !group.parent.background) group.parent.background = new THREE.Color(0x7fb2ff);
    },
  };
}
