// Batched cylindrical billboards: many camera-facing textured quads (trees, flowers) in one
// mesh and one draw call. Like the N64 classics, every quad is kept parallel to the screen
// by rotating it about the vertical axis only; update(camera) rewrites the corner positions
// when the camera turns.

import * as THREE from 'three';

const fwd = new THREE.Vector3();

export class BillboardBatch {
  // sprites: [{ x, y, z, w, h, uv: [u0, v0, u1, v1], tint?: [r, g, b] }], y = bottom centre.
  constructor(name, sprites, material) {
    this.sprites = sprites;
    const n = sprites.length;
    this.positions = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const color = new Float32Array(n * 12);
    const index = [];
    sprites.forEach((s, i) => {
      const [u0, v0, u1, v1] = s.uv;
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const t = s.tint ?? [1, 1, 1];
      for (let k = 0; k < 4; k++) color.set(t, i * 12 + k * 3);
      const b = i * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = name;
    this.right = { x: NaN, z: NaN };
    this.orient(1, 0);
    // One bounding sphere valid for every orientation: centres grown by the widest sprite.
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += Math.max(0, ...sprites.map((s) => Math.max(s.w, s.h)));
  }

  // Quads span the horizontal unit vector (rx, 0, rz), the camera's right direction.
  orient(rx, rz) {
    if (Math.abs(rx - this.right.x) < 1e-4 && Math.abs(rz - this.right.z) < 1e-4) return;
    this.right = { x: rx, z: rz };
    const p = this.positions;
    this.sprites.forEach((s, i) => {
      const hx = (rx * s.w) / 2;
      const hz = (rz * s.w) / 2;
      const top = s.y + s.h;
      p.set([s.x - hx, s.y, s.z - hz, s.x + hx, s.y, s.z + hz, s.x + hx, top, s.z + hz, s.x - hx, top, s.z - hz], i * 12);
    });
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  update(camera) {
    if (!camera) return;
    camera.getWorldDirection(fwd);
    const l = Math.hypot(fwd.x, fwd.z);
    if (l < 1e-3) return; // looking straight up/down: keep the last orientation
    this.orient(-fwd.z / l, fwd.x / l);
  }
}
