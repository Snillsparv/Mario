// PLACEHOLDER — replaced by the props implementation (trees, fences, bridge rails, waterfall...).
import * as THREE from 'three';

export function buildProps(layout) {
  const group = new THREE.Group();
  const poles = layout.TREES.map((t) => {
    const y = layout.groundHeight(t.x, t.z);
    return { x: t.x, z: t.z, y0: y, y1: y + 700, radius: 40 };
  });
  return { object3D: group, colliders: [], poles };
}
