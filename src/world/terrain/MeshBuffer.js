// Growable indexed triangle buffer (position, normal, uv, colour [+ alpha]) that turns into a
// BufferGeometry. Vertices added with a key are shared (smooth heightfields); vertices added
// without one are unique (faceted walls).

import * as THREE from 'three';

export class MeshBuffer {
  constructor({ alpha = false } = {}) {
    this.alpha = alpha;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.index = [];
    this.shared = new Map();
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  // v = { x, y, z, nx, ny, nz, u, v, r, g, b, a? }. Returns the vertex index.
  vertex(v, key) {
    if (key !== undefined) {
      const found = this.shared.get(key);
      if (found !== undefined) return found;
    }
    const i = this.vertexCount;
    this.pos.push(v.x, v.y, v.z);
    this.nrm.push(v.nx, v.ny, v.nz);
    this.uv.push(v.u, v.v);
    this.col.push(v.r, v.g, v.b);
    if (this.alpha) this.col.push(v.a ?? 1);
    if (key !== undefined) this.shared.set(key, i);
    return i;
  }

  // Shared vertex stored under key, created with make() on first use.
  keyed(key, make) {
    const found = this.shared.get(key);
    return found !== undefined ? found : this.vertex(make(), key);
  }

  tri(i0, i1, i2) {
    this.index.push(i0, i1, i2);
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.alpha ? 4 : 3));
    geo.setIndex(this.index);
    geo.computeBoundingSphere();
    return geo;
  }
}
