// Sparkle particles (coin bursts, the star's trail and twinkles, the star's glow halo), all in
// one blended sprite batch. Particles are evaluated analytically from their spawn time, so the
// simulation only has to spawn them; their records come from a fixed pool (no allocation).

import { SpriteBatch } from './SpriteBatch.js';
import { makeSparkleAtlas, sparkleUV, SPARKLE } from './textures.js';
import { TAU } from '../core/math.js';

const UV = [sparkleUV(SPARKLE.STAR), sparkleUV(SPARKLE.TWINKLE), sparkleUV(SPARKLE.GLOW)];
const CAPACITY = 160;

export const TINT = {
  coin: [1, 0.92, 0.5],
  red: [1, 0.55, 0.45],
  star: [1, 0.95, 0.62],
  life: [0.62, 1, 0.66],
};

// A particle record; the pool recycles them, so spawning allocates nothing.
function particle() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gy: 0, t0: 0, life: 1, size0: 0, size1: 0, cell: 0, tint: TINT.coin, twinkle: false, rot: 0, spin: 0 };
}

export class Sparkles {
  constructor(rng) {
    this.rng = rng;
    this.batch = new SpriteBatch(CAPACITY, { map: makeSparkleAtlas(), transparent: true, alphaCut: 0.01 });
    this.mesh = this.batch.mesh;
    this.mesh.renderOrder = 10; // over the water and other blended surfaces
    // Particle pool (one batch slot stays free for the glow): the first `count` are live.
    this.parts = Array.from({ length: CAPACITY - 1 }, particle);
    this.count = 0;
    // The star's halo, drawn behind the other sparkles (set every frame while it shows).
    this.glow = { visible: false, x: 0, y: 0, z: 0, size: 0, alpha: 0 };
  }

  setGlow(x, y, z, size, alpha) {
    const g = this.glow;
    g.visible = true;
    g.x = x;
    g.y = y;
    g.z = z;
    g.size = size;
    g.alpha = alpha;
  }

  // Drops every live particle and the glow (the records stay in the pool).
  clear() {
    this.count = 0;
    this.glow.visible = false;
  }

  // A recycled particle record born at t0 (the caller fills in the motion), or null when the
  // pool is full even after dropping the expired ones (e.g. many ticks without a frame).
  _spawn(t0, life, tint) {
    if (this.count === this.parts.length) this._prune(t0);
    if (this.count === this.parts.length) return null;
    const p = this.parts[this.count++];
    p.t0 = t0;
    p.life = life;
    p.tint = tint;
    p.gy = 0;
    p.twinkle = false;
    p.rot = this.rng() * TAU;
    p.spin = (this.rng() - 0.5) * 8;
    return p;
  }

  // Frees live particle i (the last live one takes its slot).
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

  // A ring of star sparkles flying outward plus a quick central flash (coin pickup).
  burst(pos, t0, tint, count = 7) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = ((i + rng() * 0.5) / count) * TAU;
      const speed = 240 + rng() * 80;
      const p = this._spawn(t0, 0.45 + rng() * 0.15, tint);
      if (!p) return;
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = Math.cos(a) * speed;
      p.vy = 140 + rng() * 120;
      p.vz = Math.sin(a) * speed;
      p.gy = -500;
      p.size0 = 38;
      p.size1 = 12;
      p.cell = 0;
    }
    const f = this._spawn(t0, 0.25, tint);
    if (!f) return;
    f.x = pos.x;
    f.y = pos.y;
    f.z = pos.z;
    f.vx = f.vy = f.vz = 0;
    f.size0 = f.size1 = 110;
    f.cell = 1;
    f.twinkle = true;
  }

  // Lingering sparkle left behind by a moving object.
  trail(pos, t0, tint) {
    const rng = this.rng;
    const p = this._spawn(t0, 0.7 + rng() * 0.4, tint);
    if (!p) return;
    p.x = pos.x + (rng() - 0.5) * 70;
    p.y = pos.y + (rng() - 0.5) * 70;
    p.z = pos.z + (rng() - 0.5) * 70;
    p.vx = (rng() - 0.5) * 35;
    p.vy = -30 - rng() * 40;
    p.vz = (rng() - 0.5) * 35;
    p.size0 = 44;
    p.size1 = 8;
    p.cell = rng() < 0.5 ? 0 : 1;
  }

  // A twinkle that grows and shrinks in place somewhere within `radius` of pos.
  twinkle(pos, radius, t0, tint) {
    const rng = this.rng;
    const p = this._spawn(t0, 0.4 + rng() * 0.2, tint);
    if (!p) return;
    const a = rng() * TAU;
    const r = radius * Math.sqrt(rng());
    p.x = pos.x + Math.cos(a) * r;
    p.y = pos.y + (rng() - 0.5) * radius * 1.6;
    p.z = pos.z + Math.sin(a) * r;
    p.vx = 0;
    p.vy = 20;
    p.vz = 0;
    p.size0 = 50 + rng() * 20;
    p.size1 = 0;
    p.cell = 1;
    p.twinkle = true;
  }

  animate(clock) {
    const b = this.batch;
    b.clear();
    const s = b.next;
    const g = this.glow;
    if (g.visible) {
      s.x = g.x;
      s.y = g.y;
      s.z = g.z;
      s.size = g.size;
      s.rot = 0;
      s.uv = UV[SPARKLE.GLOW];
      s.r = 1;
      s.g = 0.85;
      s.b = 0.4;
      s.a = g.alpha;
      b.push();
    }
    const parts = this.parts;
    for (let i = this.count - 1; i >= 0; i--) {
      const p = parts[i];
      const age = clock - p.t0;
      if (age >= p.life) {
        this._kill(i);
        continue;
      }
      if (age < 0) continue; // spawned by a tick that this frame has not reached yet
      const u = age / p.life;
      const tint = p.tint;
      s.x = p.x + p.vx * age;
      s.y = p.y + p.vy * age + 0.5 * p.gy * age * age;
      s.z = p.z + p.vz * age;
      s.size = p.twinkle ? p.size0 * Math.sin(Math.PI * u) : p.size0 + (p.size1 - p.size0) * u;
      s.rot = p.rot + p.spin * age;
      s.uv = UV[p.cell];
      s.r = tint[0];
      s.g = tint[1];
      s.b = tint[2];
      s.a = p.twinkle ? 1 : 1 - u * u;
      b.push();
    }
    b.commit();
  }
}
