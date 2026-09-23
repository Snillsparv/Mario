// Shared material + baked-lighting helpers so every world module has the same N64 look:
// level geometry is unlit (MeshBasicMaterial) and carries its lighting in vertex colours,
// exactly like the N64 era. Dynamic actors (the hero) use real lights instead.

import * as THREE from 'three';
import { SUN_DIR } from '../world/layout.js';

export function worldMaterial({
  map = null,
  color = 0xffffff,
  vertexColors = true,
  transparent = false,
  alphaTest = 0,
  side = THREE.FrontSide,
  depthWrite = true,
  fog = true,
} = {}) {
  return new THREE.MeshBasicMaterial({ map, color, vertexColors, transparent, alphaTest, side, depthWrite, fog });
}

// Bake simple directional + ambient lighting into a 'color' vertex attribute.
//   ambient + diffuse * max(0, n·sun)  (clamped to maxBright), multiplied by any existing
//   colour attribute and by occlusion(x, y, z, nx, ny, nz) -> 0..1 if given.
// The geometry must have normals (call computeVertexNormals first if needed). Works on
// non-indexed or indexed geometry. Positions are in the geometry's local space, so bake
// after applying transforms (geometry.applyMatrix4) when placement matters for occlusion.
export function bakeLighting(
  geometry,
  { sun = SUN_DIR, ambient = 0.58, diffuse = 0.55, maxBright = 1.0, tint = [1, 1, 1], occlusion = null } = {},
) {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  if (!nrm) geometry.computeVertexNormals();
  const n = geometry.attributes.normal;
  const existing = geometry.attributes.color;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = n.getX(i);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    let l = ambient + diffuse * Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
    if (occlusion) l *= occlusion(pos.getX(i), pos.getY(i), pos.getZ(i), nx, ny, nz);
    l = Math.min(l, maxBright);
    let r = l * tint[0];
    let g = l * tint[1];
    let b = l * tint[2];
    if (existing) {
      r *= existing.getX(i);
      g *= existing.getY(i);
      b *= existing.getZ(i);
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
