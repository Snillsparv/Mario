// The "AI RACE" floor switch (layout.AI_BUTTON): a big round red-orange cap on a low hazard-
// striped steel base. A ground pound landing on the cap presses it: the cap sinks (and the
// floor under the hero with it), then pops back up after HOLD_TICKS so it can be pounded again.
// Walking or jumping onto it does nothing. ObjectManager turns a press into the mode toggle.
//
//   new AiButton({ spot: { x, z, radius }, collision, groundAt })
//   update(player) -> true on the tick it is pressed          (30 Hz)
//   animate(alpha, clock)                                      (render)
//   setDarkness(t)  0..1: the base dims, the cap glows and pulses (easy to find in the storm)
//   reset()         cap up, ready
//
// Collision: static triangles added to the world at construction (CollisionWorld.addTriangles
// works after finalize()): the base's side walls and top ring, and the cap's flat top. The cap
// has no side walls: it is a plain 20-unit step up from the ring, and walls there would catch
// the hero's knee-height wall probe (30 up) while he still stands on the lawn. The base top
// sits at most BASE_HEIGHT above the lowest ground under it, so that probe clears the base
// too and he walks on from any side of the sloping lawn. The cap top's floor triangles move
// with the cap (their documented Surface fields a/b/c, d, minY and maxY are shifted), so the
// hero sinks with it instead of hovering.

import * as THREE from 'three';
import { bakeLighting } from '../render/materials.js';
import { TAU } from '../core/math.js';
import {
  makeButtonCapTexture,
  makeButtonBaseTexture,
  CAP_DISC_RADIUS,
  CAP_TEXTURE_SIZE,
  CAP_SIDE_UV,
  BASE_METAL_UV,
} from './aiRaceTextures.js';

export const BUTTON = {
  BASE_HEIGHT: 26, // above the lowest ground under the base
  MIN_LIP: 8, // the base shows at least this much above the highest ground
  CAP_HEIGHT: 20,
  CAP_RATIO: 0.84, // cap radius / base radius
  SINK: 15, // how far the pressed cap sinks
  PRESS_TICKS: 3,
  HOLD_TICKS: 45, // ~1.5 s from the press until it pops back up
  RISE_TICKS: 9,
  SIDES: 24,
  COLLIDER_SIDES: 16,
  POUND_MARGIN: 15, // feet this far outside the cap's edge still count (the body overlaps it)
};

const BEVEL = 6;

// Appends triangle (a, b, c) to `out` wound so its normal points along (nx, ny, nz).
function tri(out, a, b, c, nx, ny, nz) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  if (cx * nx + cy * ny + cz * nz >= 0) out.push(...a, ...b, ...c);
  else out.push(...a, ...c, ...b);
  return out;
}

// Mesh builder for flat-shaded, textured, sun-baked pieces: quads/triangles with per-vertex UVs.
class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
  }

  // Triangle facing (nx, ny, nz), with uvs [u, v] per corner.
  tri(a, b, c, ta, tb, tc, nx, ny, nz) {
    const start = this.pos.length;
    tri(this.pos, a, b, c, nx, ny, nz);
    // tri() may have swapped b and c; keep the UVs with their corners.
    const swapped = this.pos[start + 3] !== b[0] || this.pos[start + 4] !== b[1] || this.pos[start + 5] !== b[2];
    this.uv.push(...ta, ...(swapped ? tc : tb), ...(swapped ? tb : tc));
  }

  quad(a, b, c, d, ta, tb, tc, td, nx, ny, nz) {
    this.tri(a, b, c, ta, tb, tc, nx, ny, nz);
    this.tri(a, c, d, ta, tc, td, nx, ny, nz);
  }

  build(bake) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals();
    bakeLighting(geo, bake);
    return geo;
  }
}

export class AiButton {
  constructor({ spot, collision, groundAt }) {
    this.x = spot.x;
    this.z = spot.z;
    this.radius = spot.radius ?? 140;
    this.capRadius = this.radius * BUTTON.CAP_RATIO;
    this.collision = collision;

    // Seat the base on the (possibly sloping) ground, found before our own colliders exist.
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r <= this.radius; r += this.radius / 4) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        const x = this.x + Math.cos(a) * r;
        const z = this.z + Math.sin(a) * r;
        const f = collision.findFloor(x, 1e5, z);
        const y = f.surface ? f.y : groundAt(x, z);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
        if (r === 0) break;
      }
    }
    this.groundLow = lo;
    this.bottomY = lo - 24;
    this.baseTop = Math.max(lo + BUTTON.BASE_HEIGHT, hi + BUTTON.MIN_LIP);
    this.capTop0 = this.baseTop + BUTTON.CAP_HEIGHT; // cap top when up
    this.pos = { x: this.x, y: this.capTop0, z: this.z }; // sfx position

    this.state = 'up'; // 'up' | 'pressing' | 'down' | 'rising'
    this.timer = 0;
    this.offset = 0; // cap height offset (0 = up, -SINK = fully pressed)
    this.prevOffset = 0;
    this.lastAction = null;
    this.darkT = 0;
    this.flash = 0; // brief brightening after a press (render)

    this.mesh = new THREE.Group();
    this.mesh.name = 'aiButton';
    this.mesh.position.set(this.x, 0, this.z);
    this._buildMeshes();
    this._capSurfaces = this._addColliders();
  }

  get capTop() {
    return this.capTop0 + this.offset;
  }

  _buildMeshes() {
    const R = this.radius;
    const r = this.capRadius;
    const N = BUTTON.SIDES;
    const bake = { ambient: 0.62, diffuse: 0.5 };

    // Base: side band (hazard stripes, repeated 4x around) and the steel top ring.
    const base = new Builder();
    const y0 = this.bottomY;
    const y1 = this.baseTop - 30;
    const y2 = this.baseTop;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = ((i + 1) / N) * TAU;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const cm = Math.cos((a0 + a1) / 2);
      const sm = Math.sin((a0 + a1) / 2);
      const u0 = (i / N) * 4;
      const u1 = ((i + 1) / N) * 4;
      // Upper band 30 high carries the stripes; below it (buried on the low side) plain rim.
      const lowTop = Math.max(y0, y1);
      base.quad([R * c0, y0, R * s0], [R * c1, y0, R * s1], [R * c1, lowTop, R * s1], [R * c0, lowTop, R * s0], [u0, 0.51], [u1, 0.51], [u1, 0.51], [u0, 0.51], cm, 0, sm);
      base.quad([R * c0, lowTop, R * s0], [R * c1, lowTop, R * s1], [R * c1, y2, R * s1], [R * c0, y2, R * s0], [u0, 0.5], [u1, 0.5], [u1, 1], [u0, 1], cm, 0, sm);
      // Top ring (between the cap and the rim), plus a thin chamfer at the outer edge.
      const ri = r + 1;
      const [mu, mv] = BASE_METAL_UV;
      const m = [mu, mv];
      base.quad([ri * c0, y2, ri * s0], [(R - 5) * c0, y2, (R - 5) * s0], [(R - 5) * c1, y2, (R - 5) * s1], [ri * c1, y2, ri * s1], m, m, m, m, 0, 1, 0);
      base.quad([(R - 5) * c0, y2, (R - 5) * s0], [R * c0, y2 - 4, R * s0], [R * c1, y2 - 4, R * s1], [(R - 5) * c1, y2, (R - 5) * s1], m, m, m, m, cm, 1, sm);
    }
    const baseGeo = base.build(bake);
    this.baseMaterial = new THREE.MeshBasicMaterial({ map: makeButtonBaseTexture(), vertexColors: true });
    this.baseMesh = new THREE.Mesh(baseGeo, this.baseMaterial);
    this.baseMesh.name = 'aiButtonBase';

    // Cap: side wall (reaching down into the base so no gap shows when pressed), a bevel ring
    // and the flat lettered top. Built at its "up" height; the mesh moves by `offset`.
    const cap = new Builder();
    const t = this.capTop0;
    const bottom = this.baseTop - BUTTON.SINK - 6;
    const side = CAP_SIDE_UV;
    const rt = r - BEVEL; // top disc radius
    const k = CAP_DISC_RADIUS / CAP_TEXTURE_SIZE; // texture units per disc radius
    const uvAt = (x, z) => [0.5 + (x / rt) * k, 0.5 - (z / rt) * k];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = ((i + 1) / N) * TAU;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const cm = Math.cos((a0 + a1) / 2);
      const sm = Math.sin((a0 + a1) / 2);
      cap.quad([r * c0, bottom, r * s0], [r * c1, bottom, r * s1], [r * c1, t - 5, r * s1], [r * c0, t - 5, r * s0], side, side, side, side, cm, 0, sm);
      cap.quad([r * c0, t - 5, r * s0], [r * c1, t - 5, r * s1], [rt * c1, t, rt * s1], [rt * c0, t, rt * s0], side, side, side, side, cm, 1, sm);
      const p0 = [rt * c0, t, rt * s0];
      const p1 = [rt * c1, t, rt * s1];
      cap.tri([0, t, 0], p0, p1, uvAt(0, 0), uvAt(p0[0], p0[2]), uvAt(p1[0], p1[2]), 0, 1, 0);
    }
    const capGeo = cap.build({ ambient: 0.8, diffuse: 0.3 });
    this.capMaterial = new THREE.MeshBasicMaterial({ map: makeButtonCapTexture(), vertexColors: true });
    this.capMesh = new THREE.Mesh(capGeo, this.capMaterial);
    this.capMesh.name = 'aiButtonCap';
    this.mesh.add(this.baseMesh, this.capMesh);
  }

  // Adds the static collider; returns the cap top's floor surfaces (moved as the cap sinks).
  _addColliders() {
    const col = this.collision;
    if (!col.addTriangles) return [];
    const N = BUTTON.COLLIDER_SIDES;
    const R = this.radius;
    const r = this.capRadius;
    const { x: cx, z: cz } = this;
    const at = (rad, a, y) => [cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad];
    const walls = [];
    const ring = [];
    const top = [];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = ((i + 1) / N) * TAU;
      const nx = Math.cos((a0 + a1) / 2);
      const nz = Math.sin((a0 + a1) / 2);
      // Base side (outward-facing walls).
      tri(walls, at(R, a0, this.bottomY), at(R, a1, this.bottomY), at(R, a1, this.baseTop), nx, 0, nz);
      tri(walls, at(R, a0, this.bottomY), at(R, a1, this.baseTop), at(R, a0, this.baseTop), nx, 0, nz);
      // Base top ring.
      tri(ring, at(r, a0, this.baseTop), at(R, a0, this.baseTop), at(R, a1, this.baseTop), 0, 1, 0);
      tri(ring, at(r, a0, this.baseTop), at(R, a1, this.baseTop), at(r, a1, this.baseTop), 0, 1, 0);
      // Cap top (a fan).
      tri(top, [cx, this.capTop0, cz], at(r, a0, this.capTop0), at(r, a1, this.capTop0), 0, 1, 0);
    }
    const opts = { terrain: 'stone' };
    col.addTriangles(walls, opts);
    col.addTriangles(ring, opts);
    const list = col.surfaces;
    const first = list ? list.length : 0;
    col.addTriangles(top, opts);
    return list ? list.slice(first) : [];
  }

  // Moves the cap top's floor triangles to the cap's current height.
  _moveCapFloor() {
    const y = this.capTop;
    const list = this._capSurfaces;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.a[1] = y;
      s.b[1] = y;
      s.c[1] = y;
      s.minY = y;
      s.maxY = y;
      s.d = -(s.normal.x * s.a[0] + s.normal.y * y + s.normal.z * s.a[2]);
    }
  }

  // Whether feet at `pos` stand on the cap (inside its rim, at its top).
  onCap(pos) {
    const dx = pos.x - this.x;
    const dz = pos.z - this.z;
    const reach = this.capRadius + BUTTON.POUND_MARGIN;
    const top = this.capTop;
    return dx * dx + dz * dz <= reach * reach && pos.y >= top - 12 && pos.y <= top + 60;
  }

  // One tick. Returns true when a ground pound lands on the cap (it starts sinking).
  update(player) {
    const action = player.action;
    const pounded = action === 'ground_pound_land' && this.lastAction !== 'ground_pound_land';
    this.lastAction = action;
    this.prevOffset = this.offset;
    this.timer++;
    const B = BUTTON;
    if (this.state === 'pressing') {
      this.offset = -B.SINK * (this.timer >= B.PRESS_TICKS ? 1 : this.timer / B.PRESS_TICKS);
      if (this.timer >= B.PRESS_TICKS) this.state = 'down';
    } else if (this.state === 'down') {
      if (this.timer >= B.HOLD_TICKS) {
        this.state = 'rising';
        this.timer = 0;
      }
    } else if (this.state === 'rising') {
      const u = this.timer / B.RISE_TICKS;
      // Springs up with a small overshoot.
      this.offset = u >= 1 ? 0 : -B.SINK * (1 - u) + 4 * Math.sin(u * Math.PI);
      if (u >= 1) this.state = 'up';
    }
    let pressed = false;
    if (pounded && this.state === 'up' && this.onCap(player.pos)) {
      this.state = 'pressing';
      this.timer = 0;
      this.offset = -B.SINK / B.PRESS_TICKS;
      this.flash = 1;
      pressed = true;
    }
    if (this.offset !== this.prevOffset) this._moveCapFloor();
    return pressed;
  }

  setDarkness(t) {
    this.darkT = t;
  }

  reset() {
    this.state = 'up';
    this.timer = 0;
    this.offset = 0;
    this.prevOffset = 0;
    this.lastAction = null;
    this.flash = 0;
    this._moveCapFloor();
  }

  animate(alpha, clock) {
    this.capMesh.position.y = this.prevOffset + (this.offset - this.prevOffset) * alpha;
    const t = this.darkT;
    // In the storm the base dims with the world while the cap glows and slowly pulses, so the
    // way back to the sunny grounds is easy to find.
    this.baseMaterial.color.setScalar(1 - 0.45 * t);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 3.2);
    this.flash = this.flash > 0.02 ? this.flash * 0.9 : 0;
    this.capMaterial.color.setScalar(1 + t * (0.1 + 0.35 * pulse) + 0.5 * this.flash);
  }
}
