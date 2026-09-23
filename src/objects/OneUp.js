// Hidden extra-life pickup: an original emerald "life gem" (a faceted crystal with a flat top
// table) hovering over the ground, spinning and bobbing. Touching it gives an extra life.

import * as THREE from 'three';

const HOVER = 90; // gem centre above the floor
const SPIN = 2.2; // rad/s about Y
const BOB = 10;
const HIT = { radius: 105, below: 40, above: 200 }; // hero feet vs gem centre, like a coin

// Crystal around the Y axis: a small top table, a wide girdle just above the middle and a
// point underneath, with `sides` facets. Flat shaded, so every face reads as a cut facet.
export function buildGemGeometry({ sides = 6, table = 16, girdle = 34, top = 38, girdleY = 10, bottom = -50 } = {}) {
  const pos = [];
  const ring = (r, y, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, y, -Math.sin(a) * r];
  };
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < sides; i++) {
    const t0 = ring(table, top, i);
    const t1 = ring(table, top, i + 1);
    const g0 = ring(girdle, girdleY, i);
    const g1 = ring(girdle, girdleY, i + 1);
    tri([0, top, 0], t0, t1); // table
    tri(t0, g0, g1); // crown facets
    tri(t0, g1, t1);
    tri(g0, [0, bottom, 0], g1); // pavilion
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export class OneUp {
  // spot: { x, z, y? }; floorY: the floor under it (the gem hovers HOVER above unless y is given).
  constructor(spot, floorY) {
    const material = new THREE.MeshPhongMaterial({
      color: 0x34e07c,
      emissive: 0x0c5a2a,
      specular: 0xe0ffe8,
      shininess: 70,
      flatShading: true,
    });
    this.mesh = new THREE.Mesh(buildGemGeometry(), material);
    this.pos = { x: spot.x, y: spot.y ?? floorY + HOVER, z: spot.z };
    this.alive = true;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  // Hero feet at p touching the gem?
  touches(p) {
    if (!this.alive) return false;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    return dx * dx + dz * dz < HIT.radius ** 2 && this.pos.y >= p.y - HIT.below && this.pos.y <= p.y + HIT.above;
  }

  collect() {
    this.alive = false;
    this.mesh.visible = false;
  }

  animate(clock) {
    if (!this.alive) return;
    this.mesh.position.y = this.pos.y + BOB * Math.sin(clock * 2.8);
    this.mesh.rotation.y = clock * SPIN;
  }
}
