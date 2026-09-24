// Additive fire sprites for AI RACE mode in one instanced draw call: the fireballs' halos and
// flame trails, the monster's vent sparks, optic glows and throat charge glow, and steam puffs.
// Like Sparkles, particles are evaluated analytically from their spawn time (position, size and
// a colour ramp from birth to death), their records come from a fixed pool, and steady glows
// are queued per frame with glowSlot(). Nothing here allocates once the pool exists.

import * as THREE from 'three';
import { SpriteBatch } from './SpriteBatch.js';
import { makeFireAtlas, fireUV, FIRE } from './aiRaceTextures.js';
import { scaledFog } from './robotBeastModel.js';

const UV = [fireUV(FIRE.GLOW), fireUV(FIRE.FLAME), fireUV(FIRE.SPARK), fireUV(FIRE.PUFF)];
export const FIRE_CAPACITY = 420;
const GLOW_SLOTS = 32; // per-frame glows (fireball halos, the beast's and minions' eyes, charge)

// sRGB (as picked) -> the linear values the sprite shader expects.
export function lin(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Colour ramps [r0, g0, b0, r1, g1, b1] (linear): birth colour -> death colour (additive, so
// dark = faint).
export const RAMP = {
  flame: [1, 0.92, 0.55, 0.85, 0.2, 0.04].map(lin), // yellow-white core -> deep red
  ember: [1, 0.62, 0.2, 0.6, 0.12, 0.03].map(lin),
  spark: [1, 0.95, 0.7, 1, 0.45, 0.1].map(lin),
  steam: [0.72, 0.74, 0.78, 0.35, 0.36, 0.4].map(lin),
  smoke: [0.5, 0.36, 0.26, 0.2, 0.18, 0.18].map(lin),
};

// Glow tints (linear).
export const TINTS = {
  eye: [1, 0.16, 0.06].map(lin),
  core: [1, 0.45, 0.12].map(lin),
  ember: [1, 0.5, 0.16].map(lin),
  charge: [1, 0.62, 0.2].map(lin),
  ball: [1, 0.6, 0.18].map(lin),
};

function particle() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gy: 0, t0: 0, life: 1, size0: 0, size1: 0, cell: 0, ramp: RAMP.flame, a0: 1, rot: 0, spin: 0 };
}

export class FireSprites {
  constructor(rng) {
    this.rng = rng;
    this.batch = new SpriteBatch(FIRE_CAPACITY, { map: makeFireAtlas(), transparent: true, alphaCut: 0.004 });
    this.mesh = this.batch.mesh;
    this.mesh.name = 'fireSprites';
    const mat = this.mesh.material;
    mat.blending = THREE.AdditiveBlending;
    // Additive light fades to black in fog (not to the fog colour), and only partly: the glows
    // are what makes the beast and its fireballs readable through the storm.
    mat.fragmentShader = mat.fragmentShader.replace('#include <fog_fragment>', scaledFog('0.45', true));
    this.mesh.renderOrder = 11; // with the sparkles, over water and other blended surfaces
    this.mesh.visible = false;
    this.parts = Array.from({ length: FIRE_CAPACITY - GLOW_SLOTS }, particle);
    this.count = 0;
    // Glows queued for the next animate() (flat records, reused).
    this.glows = Array.from({ length: GLOW_SLOTS }, () => ({ x: 0, y: 0, z: 0, size: 0, r: 1, g: 1, b: 1, a: 1, cell: 0 }));
    this.glowCount = 0;
  }

  // A pooled particle born at t0 lasting `life` seconds, or null when the pool is full even
  // after dropping expired ones. The caller fills in position, motion, size and `ramp`.
  spawn(t0, life, cell) {
    if (this.count === this.parts.length) this._prune(t0);
    if (this.count === this.parts.length) return null;
    const p = this.parts[this.count++];
    p.t0 = t0;
    p.life = life;
    p.cell = cell;
    p.gy = 0;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.a0 = 1;
    p.ramp = RAMP.flame;
    p.rot = this.rng() * 6.283;
    p.spin = (this.rng() - 0.5) * 6;
    return p;
  }

  // A glow sprite record for the next animate() only (the caller sets x, y, z, size, r, g, b,
  // a; cell defaults to the soft glow), or null when every glow slot is taken this frame.
  glowSlot() {
    if (this.glowCount === GLOW_SLOTS) return null;
    const s = this.glows[this.glowCount++];
    s.cell = FIRE.GLOW;
    s.a = 1;
    return s;
  }

  clear() {
    this.count = 0;
    this.glowCount = 0;
    this.batch.clear();
    this.batch.commit();
    this.mesh.visible = false;
  }

  _kill(i) {
    const parts = this.parts;
    const last = --this.count;
    const p = parts[i];
    parts[i] = parts[last];
    parts[last] = p;
  }

  _prune(now) {
    for (let i = this.count - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (now - p.t0 >= p.life) this._kill(i);
    }
  }

  animate(clock) {
    const b = this.batch;
    b.clear();
    const s = b.next;
    for (let i = 0; i < this.glowCount; i++) {
      const g = this.glows[i];
      s.x = g.x;
      s.y = g.y;
      s.z = g.z;
      s.size = g.size;
      s.rot = 0;
      s.uv = UV[g.cell];
      s.r = g.r;
      s.g = g.g;
      s.b = g.b;
      s.a = g.a;
      b.push();
    }
    this.glowCount = 0;
    const parts = this.parts;
    for (let i = this.count - 1; i >= 0; i--) {
      const p = parts[i];
      const age = clock - p.t0;
      if (age >= p.life) {
        this._kill(i);
        continue;
      }
      if (age < 0) continue; // spawned by a tick this frame has not reached yet
      const u = age / p.life;
      s.x = p.x + p.vx * age;
      s.y = p.y + p.vy * age + 0.5 * p.gy * age * age;
      s.z = p.z + p.vz * age;
      s.size = p.size0 + (p.size1 - p.size0) * u;
      s.rot = p.rot + p.spin * age;
      s.uv = UV[p.cell];
      const k = p.ramp;
      s.r = k[0] + (k[3] - k[0]) * u;
      s.g = k[1] + (k[4] - k[1]) * u;
      s.b = k[2] + (k[5] - k[2]) * u;
      s.a = p.a0 * (1 - u * u);
      b.push();
    }
    b.commit();
    this.mesh.visible = b.count > 0;
  }
}
