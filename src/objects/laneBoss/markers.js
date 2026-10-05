// STOMPWATT's fight overlays (fight.js): its danger markers on the ground and its stomp's
// shockwave in one dynamic mesh (one draw call while any shows), and the charging cable from
// the dad's wall charger to the port on its chest (one more while it is plugged in). Unlit,
// vertex-coloured: they read the same in both looks (G swaps nothing here).
//
//   const mk = new Markers(heightAt)   heightAt(x, z): the ground's height there (world)
//   mk.ring = { on, x, z, size }       the Wheel Stomp's target: an orange ring `size` across
//   mk.lane = { on, x, z, dx, dz, len, w }   the Roll Dash's path: chevrons along (dx, dz) (a
//                                      unit) from (x, z) for len, w wide
//   mk.arc = { on, x, z, yaw, r, half } the Wheel Swipe's reach: an arc of radius r, half
//                                      wide either side of yaw
//   mk.wave = { on, x, z, r, pr, max, h }   the shockwave: a glowing band h tall at radius r
//                                      (pr last tick's: drawn between), fading toward max
//   mk.tick()                          30 Hz, after the descriptors are written (the ring's and
//                                      wave's last places, for drawing between ticks)
//   mk.animate(alpha, clock)           per frame: the geometry written (nothing allocated)
//   mk.mesh                            'lane-boss-markers'
//
//   const cable = new Cable()
//   cable.set(on, from, to)            on: drawn; from (the charger's box) and to (the plug's
//                                      end), world points, written each frame; its light blue
//   cable.mesh                         'lane-boss-cable'
//
// Colours: the critters' danger orange (sRGB 1, 0.45, 0.08) pulsing, steady in its first
// ticks; the wave white-hot at its foot fading up and out.

import * as THREE from 'three';

const MAX = 2400; // vertices (triangles, not indexed)
const ORANGE = new THREE.Color().setRGB(1, 0.45, 0.08, THREE.SRGBColorSpace);
const HOT = new THREE.Color().setRGB(1, 0.86, 0.6, THREE.SRGBColorSpace);
const TAU = Math.PI * 2;
const RING_SEGS = 24;
const WAVE_SEGS = 48;
const ARC_SEGS = 16;
const CHEVRONS = 6;

export class Markers {
  constructor(heightAt) {
    this.heightAt = heightAt;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    material.name = 'lane-boss-markers';
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'lane-boss-markers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0.6;
    this.mesh.visible = false;
    this.ring = { on: false, x: 0, z: 0, size: 0, px: 0, pz: 0, psize: 0, age: 0 };
    this.lane = { on: false, x: 0, z: 0, dx: 0, dz: 1, len: 0, w: 0, age: 0 };
    this.arc = { on: false, x: 0, z: 0, yaw: 0, r: 0, half: 0, age: 0 };
    this.wave = { on: false, x: 0, z: 0, r: 0, pr: 0, max: 1, h: 50 };
    this.n = 0;
  }

  clear() {
    this.ring.on = this.lane.on = this.arc.on = this.wave.on = false;
  }

  // (30 Hz: the ring's and the wave's places this tick, kept for drawing between ticks.)
  tick() {
    const r = this.ring;
    r.age = r.on ? r.age + 1 : 0;
    this.lane.age = this.lane.on ? this.lane.age + 1 : 0;
    this.arc.age = this.arc.on ? this.arc.age + 1 : 0;
  }

  // Remembers where the ring was (call before moving it).
  keep() {
    const r = this.ring;
    r.px = r.x;
    r.pz = r.z;
    r.psize = r.size;
    this.wave.pr = this.wave.r;
  }

  _v(x, y, z, c, a) {
    const i = this.n;
    if (i >= MAX) return;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 4] = c.r;
    this.col[i * 4 + 1] = c.g;
    this.col[i * 4 + 2] = c.b;
    this.col[i * 4 + 3] = a;
    this.n = i + 1;
  }

  // A quad on its four corners (a b c d round), each with its alpha.
  _quad(ax, ay, az, aa, bx, by, bz, ba, cx, cy, cz, ca, dx, dy, dz, da, c) {
    this._v(ax, ay, az, c, aa);
    this._v(bx, by, bz, c, ba);
    this._v(cx, cy, cz, c, ca);
    this._v(ax, ay, az, c, aa);
    this._v(cx, cy, cz, c, ca);
    this._v(dx, dy, dz, c, da);
  }

  // A flat band round (x, z) from radius r0 (alpha a0) to r1 (alpha a1), angles t0 .. t1.
  _band(x, z, r0, a0, r1, a1, t0, t1, segs, c, lift) {
    const h = this.heightAt;
    for (let i = 0; i < segs; i++) {
      const u0 = t0 + ((t1 - t0) * i) / segs;
      const u1 = t0 + ((t1 - t0) * (i + 1)) / segs;
      const s0 = Math.sin(u0);
      const c0 = Math.cos(u0);
      const s1 = Math.sin(u1);
      const c1 = Math.cos(u1);
      const ax = x + s0 * r0;
      const az = z + c0 * r0;
      const bx = x + s0 * r1;
      const bz = z + c0 * r1;
      const cx = x + s1 * r1;
      const cz = z + c1 * r1;
      const dx = x + s1 * r0;
      const dz = z + c1 * r0;
      this._quad(ax, h(ax, az) + lift, az, a0, bx, h(bx, bz) + lift, bz, a1, cx, h(cx, cz) + lift, cz, a1, dx, h(dx, dz) + lift, dz, a0, c);
    }
  }

  animate(alpha, clock) {
    this.n = 0;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const pulse = 0.82 + 0.18 * Math.sin(clock * TAU * 5);
    // The stomp's ring (steady for its first ticks, then pulsing).
    const ring = this.ring;
    if (ring.on) {
      const x = ring.px + (ring.x - ring.px) * a;
      const z = ring.pz + (ring.z - ring.pz) * a;
      const r = (ring.psize + (ring.size - ring.psize) * a) / 2;
      const k = ring.age < 6 ? 1 : pulse;
      _c.copy(ORANGE).multiplyScalar(k);
      this._band(x, z, 0, 0.22, r * 0.62, 0.22, 0, TAU, RING_SEGS, _c, 3);
      this._band(x, z, r * 0.62, 0.05, r * 0.82, 1, 0, TAU, RING_SEGS, _c, 3);
      this._band(x, z, r * 0.82, 1, r, 0, 0, TAU, RING_SEGS, _c, 3);
    }
    // The dash's chevrons along its line, a light running along them toward its end.
    const lane = this.lane;
    if (lane.on) {
      const h = this.heightAt;
      const w = lane.w / 2;
      const px = lane.dz; // (its left: the line turned a quarter)
      const pz = -lane.dx;
      const step = lane.len / CHEVRONS;
      for (let i = 0; i < CHEVRONS; i++) {
        const run = (clock * 2.4 - i / CHEVRONS) % 1;
        const k = (lane.age < 6 ? 1 : pulse) * (0.55 + 0.45 * (run < 0 ? run + 1 : run));
        _c.copy(ORANGE).multiplyScalar(k);
        const d = step * (i + 0.5);
        const tipX = lane.x + lane.dx * (d + step * 0.35);
        const tipZ = lane.z + lane.dz * (d + step * 0.35);
        for (let s = -1; s <= 1; s += 2) {
          // One arm of the chevron: from its back corner on that side to its tip, 34 thick.
          const bx = lane.x + lane.dx * (d - step * 0.15) + px * w * s;
          const bz = lane.z + lane.dz * (d - step * 0.15) + pz * w * s;
          const ex = lane.dx * 34;
          const ez = lane.dz * 34;
          this._quad(bx, h(bx, bz) + 3, bz, 0.9, tipX, h(tipX, tipZ) + 3, tipZ, 0.9, tipX + ex, h(tipX + ex, tipZ + ez) + 3, tipZ + ez, 0.9, bx + ex, h(bx + ex, bz + ez) + 3, bz + ez, 0.9, _c);
        }
      }
      // Its edges: two thin strips the whole way.
      _c.copy(ORANGE).multiplyScalar(lane.age < 6 ? 1 : pulse);
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < CHEVRONS; i++) {
          const d0 = step * i;
          const d1 = step * (i + 1);
          const ox = px * w * s;
          const oz = pz * w * s;
          const ix = px * (w - 14) * s;
          const iz = pz * (w - 14) * s;
          const ax = lane.x + lane.dx * d0;
          const az = lane.z + lane.dz * d0;
          const bx = lane.x + lane.dx * d1;
          const bz = lane.z + lane.dz * d1;
          this._quad(ax + ix, h(ax + ix, az + iz) + 3, az + iz, 0.15, bx + ix, h(bx + ix, bz + iz) + 3, bz + iz, 0.15, bx + ox, h(bx + ox, bz + oz) + 3, bz + oz, 0.85, ax + ox, h(ax + ox, az + oz) + 3, az + oz, 0.85, _c);
        }
      }
    }
    // The swipe's arc: a faint fill and a bright rim.
    const arc = this.arc;
    if (arc.on) {
      _c.copy(ORANGE).multiplyScalar(arc.age < 6 ? 1 : pulse);
      const t0 = arc.yaw - arc.half;
      const t1 = arc.yaw + arc.half;
      this._band(arc.x, arc.z, 110, 0.05, arc.r * 0.84, 0.28, t0, t1, ARC_SEGS, _c, 3);
      this._band(arc.x, arc.z, arc.r * 0.84, 0.28, arc.r * 0.94, 1, t0, t1, ARC_SEGS, _c, 3);
      this._band(arc.x, arc.z, arc.r * 0.94, 1, arc.r, 0, t0, t1, ARC_SEGS, _c, 3);
    }
    // The shockwave: white-hot at its foot, fading up its band and as it runs out.
    const wave = this.wave;
    if (wave.on) {
      const r = wave.pr + (wave.r - wave.pr) * a;
      const f = 1 - r / wave.max;
      const k = f < 0 ? 0 : f > 0.35 ? 1 : f / 0.35;
      const h = this.heightAt;
      _c.copy(HOT);
      _c2.copy(ORANGE);
      for (let i = 0; i < WAVE_SEGS; i++) {
        const u0 = (TAU * i) / WAVE_SEGS;
        const u1 = (TAU * (i + 1)) / WAVE_SEGS;
        const ax = wave.x + Math.sin(u0) * r;
        const az = wave.z + Math.cos(u0) * r;
        const bx = wave.x + Math.sin(u1) * r;
        const bz = wave.z + Math.cos(u1) * r;
        const ay = h(ax, az);
        const by = h(bx, bz);
        // (The band: its foot bright, its top fading.)
        this._v(ax, ay, az, _c, k);
        this._v(bx, by, bz, _c, k);
        this._v(bx, by + wave.h, bz, _c2, 0);
        this._v(ax, ay, az, _c, k);
        this._v(bx, by + wave.h, bz, _c2, 0);
        this._v(ax, ay + wave.h, az, _c2, 0);
      }
      this._band(wave.x, wave.z, r - 22 > 0 ? r - 22 : 0, 0, r, 0.8 * k, 0, TAU, WAVE_SEGS, _c2, 3);
      this._band(wave.x, wave.z, r, 0.8 * k, r + 22, 0, 0, TAU, WAVE_SEGS, _c2, 3);
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, this.n);
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.posAttr.addUpdateRange(0, this.n * 3);
      this.colAttr.addUpdateRange(0, this.n * 4);
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }
}
const _c = new THREE.Color();
const _c2 = new THREE.Color();

// ------------------------------------------------------------------ the charging cable

const CABLE_SEGS = 12;
const CABLE_MAX = CABLE_SEGS * 24 + 36 * 2 + 24;
const CABLE = new THREE.Color().setRGB(0.07, 0.075, 0.08, THREE.SRGBColorSpace);
const PLUG = new THREE.Color().setRGB(0.49, 1, 0.6, THREE.SRGBColorSpace);
const LIGHT = new THREE.Color().setRGB(0.3, 0.6, 1, THREE.SRGBColorSpace);

export class Cable {
  constructor() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(CABLE_MAX * 3);
    this.col = new Float32Array(CABLE_MAX * 3);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    material.name = 'lane-boss-cable';
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'lane-boss-cable';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.n = 0;
  }

  _v(x, y, z, c) {
    const i = this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.n = i + 1;
  }

  _box(x, y, z, h, c) {
    for (let f = 0; f < 6; f++) {
      const ax = f >> 1;
      const s = f & 1 ? 1 : -1;
      // The face's corners: its two other axes round it.
      for (let k = 0; k < 6; k++) {
        const q = QUAD[k];
        _p[ax] = s * h;
        _p[(ax + 1) % 3] = q[0] * h;
        _p[(ax + 2) % 3] = q[1] * h;
        this._v(x + _p[0], y + _p[1], z + _p[2], c);
      }
    }
  }

  // on: shown; from, to: world points (the charger's box, the plug's end); the charger's light
  // (blue while it charges) at `light` (a world point) when given.
  set(on, from, to, light = null) {
    this.mesh.visible = on;
    if (!on) return;
    this.n = 0;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sag = len * 0.12;
    for (let i = 0; i < CABLE_SEGS; i++) {
      at(from, dx, dy, dz, sag, i / CABLE_SEGS, _a);
      at(from, dx, dy, dz, sag, (i + 1) / CABLE_SEGS, _b);
      // A square tube 6 wide (its sides along x and y; the cable runs mostly across them).
      for (let s = 0; s < 4; s++) {
        const o0 = SIDES[s];
        const o1 = SIDES[(s + 1) % 4];
        this._v(_a.x + o0[0], _a.y + o0[1], _a.z + o0[2], CABLE);
        this._v(_b.x + o0[0], _b.y + o0[1], _b.z + o0[2], CABLE);
        this._v(_b.x + o1[0], _b.y + o1[1], _b.z + o1[2], CABLE);
        this._v(_a.x + o0[0], _a.y + o0[1], _a.z + o0[2], CABLE);
        this._v(_b.x + o1[0], _b.y + o1[1], _b.z + o1[2], CABLE);
        this._v(_a.x + o1[0], _a.y + o1[1], _a.z + o1[2], CABLE);
      }
    }
    // The plug at its end, glowing green; the charger's light blue.
    this._box(to.x, to.y, to.z, 9, PLUG);
    if (light) this._box(light.x, light.y, light.z, 6.5, LIGHT);
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, this.n);
    this.posAttr.addUpdateRange(0, this.n * 3);
    this.colAttr.addUpdateRange(0, this.n * 3);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
const SIDES = [[-3, -3, 0], [3, -3, 0], [3, 3, 0], [-3, 3, 0]].map(([x, y]) => [x, y, x * 0.5]);
const QUAD = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
const _p = [0, 0, 0];
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
// A point t (0 .. 1) along the cable, sagging in the middle.
function at(from, dx, dy, dz, sag, t, out) {
  out.x = from.x + dx * t;
  out.y = from.y + dy * t - Math.sin(Math.PI * t) * sag;
  out.z = from.z + dz * t;
  return out;
}
