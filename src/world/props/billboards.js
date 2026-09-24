// Batched cylindrical billboards: many camera-facing textured quads (the flowers) in one
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
    this.rx = NaN;
    this.rz = NaN;
    this.heightScale = 1;
    this.orient(1, 0);
    // One bounding sphere valid for every orientation: centres grown by the widest sprite.
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += Math.max(0, ...sprites.map((s) => Math.max(s.w, s.h)));
  }

  // Scales every sprite's height (and a little of its width), e.g. flowers wilting; the
  // quads are rebuilt at once.
  setHeightScale(k) {
    if (k === this.heightScale) return;
    this.heightScale = k;
    const rx = this.rx;
    const rz = this.rz;
    this.rx = NaN;
    this.orient(Number.isNaN(rx) ? 1 : rx, Number.isNaN(rz) ? 0 : rz);
  }

  // Quads span the horizontal unit vector (rx, 0, rz), the camera's right direction.
  orient(rx, rz) {
    if (Math.abs(rx - this.rx) < 1e-4 && Math.abs(rz - this.rz) < 1e-4) return;
    this.rx = rx;
    this.rz = rz;
    const p = this.positions;
    const sprites = this.sprites;
    const kh = this.heightScale;
    const kw = 0.5 + 0.5 * kh;
    for (let i = 0, o = 0; i < sprites.length; i++, o += 12) {
      const s = sprites[i];
      const hx = (rx * s.w * kw) / 2;
      const hz = (rz * s.w * kw) / 2;
      const top = s.y + s.h * kh;
      p[o] = s.x - hx;
      p[o + 1] = s.y;
      p[o + 2] = s.z - hz;
      p[o + 3] = s.x + hx;
      p[o + 4] = s.y;
      p[o + 5] = s.z + hz;
      p[o + 6] = s.x + hx;
      p[o + 7] = top;
      p[o + 8] = s.z + hz;
      p[o + 9] = s.x - hx;
      p[o + 10] = top;
      p[o + 11] = s.z - hz;
    }
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
