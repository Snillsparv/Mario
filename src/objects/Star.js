// The star: an original chunky five-pointed star (puffy, bevelled, gold with a metallic sheen
// and an emissive glow). Hidden until spawned; rises in a spiral to its spot, then spins and
// bobs until the hero touches it.

import * as THREE from 'three';
import { TAU } from '../core/math.js';

const RISE_TICKS = 54; // spiral-in duration (30 Hz ticks)
const RISE_TURNS = 2.5;
const RISE_RADIUS = 260;
const SPIN = 2.6; // rad/s about Y
const BOB = 14; // units
// Hero feet vs star centre: `below` lets the hero's head (feet + 160) reach the star's lower
// points (centre - 95) with some slack, so a standing jump under a low star connects.
const STAR_HIT = { radius: 110, below: 270, above: 60 };

// Puffy star in the XY plane facing +Z: the outline is scaled toward the centre in rings that
// rise along a rounded profile, mirrored for the back, joined by a thin edge band.
export function buildStarGeometry({ outer = 95, inner = 44, thickness = 40, edge = 9 } = {}) {
  const N = 10;
  const rings = [1, 0.74, 0.46, 0.2];
  const outline = Array.from({ length: N }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const pos = [];
  const index = [];
  const sideBase = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    sideBase.push(base);
    for (const s of rings) {
      const z = side * (edge + (thickness - edge) * (1 - s * s) ** 0.75);
      for (const [x, y] of outline) pos.push(x * s, y * s, z);
    }
    const centre = pos.length / 3;
    pos.push(0, 0, side * thickness);
    // Counter-clockwise seen from the side's own direction.
    const tri = (a, b, c) => (side > 0 ? index.push(a, b, c) : index.push(a, c, b));
    const v = (ring, i) => base + ring * N + (i % N);
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let i = 0; i < N; i++) {
        tri(v(r, i), v(r, i + 1), v(r + 1, i + 1));
        tri(v(r, i), v(r + 1, i + 1), v(r + 1, i));
      }
    }
    for (let i = 0; i < N; i++) tri(v(rings.length - 1, i), v(rings.length - 1, i + 1), centre);
  }
  // Edge band between the front and back outlines.
  const [f, b] = sideBase;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    index.push(f + i, b + i, b + j, f + i, b + j, f + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export class Star {
  constructor(envMap) {
    const material = new THREE.MeshPhongMaterial({
      color: 0xffc81e,
      emissive: 0x7a4c00,
      specular: 0xfff2c0,
      shininess: 40,
      envMap,
      combine: THREE.MixOperation,
      reflectivity: 0.3,
    });
    this.mesh = new THREE.Mesh(buildStarGeometry(), material);
    this.mesh.visible = false;
    this.state = 'hidden'; // 'rising' | 'idle' | 'collected'
    this.age = 0; // ticks in the current state
    this.pos = { x: 0, y: 0, z: 0 };
    this.prev = { x: 0, y: 0, z: 0 };
    this.render = { x: 0, y: 0, z: 0, scale: 1 }; // last drawn transform (for shadow / glow)
  }

  get active() {
    return this.state === 'rising' || this.state === 'idle';
  }

  // Start the spiral rise from fromY up to target {x, y, z}.
  spawn(target, fromY) {
    if (this.state !== 'hidden') return;
    this.target = { ...target };
    this.fromY = fromY;
    this.state = 'rising';
    this.age = 0;
    this._setRisePos(0);
    Object.assign(this.prev, this.pos);
    this.mesh.visible = true;
  }

  _setRisePos(u) {
    const e = 1 - (1 - u) ** 3;
    const a = u * RISE_TURNS * TAU;
    const r = RISE_RADIUS * (1 - e);
    const t = this.target;
    this.pos.x = t.x + Math.cos(a) * r;
    this.pos.y = this.fromY + (t.y - this.fromY) * e;
    this.pos.z = t.z + Math.sin(a) * r;
    this.riseEase = e;
  }

  update() {
    if (!this.active) return;
    Object.assign(this.prev, this.pos);
    this.age++;
    if (this.state === 'rising') {
      this._setRisePos(this.age < RISE_TICKS ? this.age / RISE_TICKS : 1);
      if (this.age >= RISE_TICKS) {
        this.state = 'idle';
        this.age = 0;
      }
    }
  }

  // Hero feet at p touching the star?
  touches(p) {
    if (this.state !== 'idle') return false;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    return dx * dx + dz * dz < STAR_HIT.radius ** 2 && p.y >= this.pos.y - STAR_HIT.below && p.y <= this.pos.y + STAR_HIT.above;
  }

  collect() {
    this.state = 'collected';
    this.mesh.visible = false;
  }

  // Hidden again, ready to be spawned by the next full set of red coins (a new game).
  reset() {
    this.state = 'hidden';
    this.age = 0;
    this.mesh.visible = false;
  }

  animate(clock, alpha) {
    if (!this.active) return;
    const { prev, pos } = this;
    const rising = this.state === 'rising';
    const e = rising ? this.riseEase : 1;
    // Bob fades in after the rise so the hand-over is seamless.
    const fadeIn = (this.age + alpha) / 30;
    const bob = rising ? 0 : BOB * (fadeIn < 1 ? fadeIn : 1) * Math.sin(clock * 2.4);
    const r = this.render;
    r.x = prev.x + (pos.x - prev.x) * alpha;
    r.y = prev.y + (pos.y - prev.y) * alpha + bob;
    r.z = prev.z + (pos.z - prev.z) * alpha;
    r.scale = 0.25 + 0.75 * e;
    this.mesh.position.set(r.x, r.y, r.z);
    this.mesh.rotation.y = clock * SPIN + (1 - e) * 9;
    this.mesh.scale.setScalar(r.scale);
  }
}
