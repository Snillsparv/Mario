// PLACEHOLDER — replaced by the terrain implementation. Coarse heightfield from layout.
import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../render/materials.js';

export function buildTerrain(layout) {
  const size = 18000;
  const seg = 120;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, layout.groundHeight(x, z));
    const r = layout.regionAt(x, z);
    const c = r === 'water' ? [0.4, 0.4, 0.5] : r === 'island' ? [0.6, 0.7, 0.4] : [0.35, 0.7, 0.25];
    colors.set(c, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  bakeLighting(geo);
  const mesh = new THREE.Mesh(geo, worldMaterial());
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3060c0, transparent: true, opacity: 0.6 }),
  );
  water.position.y = layout.WATER_LEVEL;
  water.position.z = -3000;
  const group = new THREE.Group();
  group.add(mesh, water);
  return { object3D: group, colliders: [{ object3D: mesh, terrain: 'grass' }] };
}
