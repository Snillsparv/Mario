// PLACEHOLDER — replaced by the castle implementation.
import * as THREE from 'three';

export function buildCastle(layout) {
  const C = layout.CASTLE;
  const w = C.halfWidth * 2;
  const d = C.frontZ - C.backZ;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, C.mainHeight, d), new THREE.MeshLambertMaterial({ color: 0xe8dcb0 }));
  mesh.position.set(C.x, C.baseY + C.mainHeight / 2, (C.frontZ + C.backZ) / 2);
  const group = new THREE.Group();
  group.add(mesh);
  group.add(new THREE.HemisphereLight(0xffffff, 0x445522, 1.5));
  return { object3D: group, colliders: [{ object3D: mesh, terrain: 'stone' }] };
}
