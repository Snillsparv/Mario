// Sparkle particles (coin bursts, the star's trail and twinkles, the star's glow halo), all in
// one blended sprite batch. Particles are evaluated analytically from their spawn time, so the
// simulation only has to spawn them.

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

export class Sparkles {
  constructor(rng) {
    this.rng = rng;
    this.batch = new SpriteBatch(CAPACITY, { map: makeSparkleAtlas(), transparent: true, alphaCut: 0.01 });
    this.mesh = this.batch.mesh;
    this.mesh.renderOrder = 10; // over the water and other blended surfaces
    this.list = [];
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

  // p: { x, y, z, vx, vy, vz, gy, t0, life, size0, size1, cell, tint, twinkle? }
  spawn(p) {
    if (this.list.length >= CAPACITY - 1) this._prune(p.t0); // e.g. many ticks without a frame
    if (this.list.length < CAPACITY - 1) this.list.push({ rot: this.rng() * TAU, spin: (this.rng() - 0.5) * 8, ...p });
  }

  _prune(now) {
    this.list = this.list.filter((p) => now - p.t0 < p.life);
  }

  // A ring of star sparkles flying outward plus a quick central flash (coin pickup).
  burst(pos, t0, tint, count = 7) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = ((i + rng() * 0.5) / count) * TAU;
      const speed = 240 + rng() * 80;
      this.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(a) * speed,
        vy: 140 + rng() * 120,
        vz: Math.sin(a) * speed,
        gy: -500,
        t0,
        life: 0.45 + rng() * 0.15,
        size0: 38,
        size1: 12,
        cell: 0,
        tint,
      });
    }
    this.spawn({ ...pos, vx: 0, vy: 0, vz: 0, gy: 0, t0, life: 0.25, size0: 110, size1: 110, cell: 1, tint, twinkle: true });
  }

  // Lingering sparkle left behind by a moving object.
  trail(pos, t0, tint) {
    const rng = this.rng;
    const j = () => (rng() - 0.5) * 70;
    this.spawn({
      x: pos.x + j(),
      y: pos.y + j(),
      z: pos.z + j(),
      vx: j() * 0.5,
      vy: -30 - rng() * 40,
      vz: j() * 0.5,
      gy: 0,
      t0,
      life: 0.7 + rng() * 0.4,
      size0: 44,
      size1: 8,
      cell: rng() < 0.5 ? 0 : 1,
      tint,
    });
  }

  // A twinkle that grows and shrinks in place somewhere within `radius` of pos.
  twinkle(pos, radius, t0, tint) {
    const rng = this.rng;
    const a = rng() * TAU;
    const r = radius * Math.sqrt(rng());
    this.spawn({
      x: pos.x + Math.cos(a) * r,
      y: pos.y + (rng() - 0.5) * radius * 1.6,
      z: pos.z + Math.sin(a) * r,
      vx: 0,
      vy: 20,
      vz: 0,
      gy: 0,
      t0,
      life: 0.4 + rng() * 0.2,
      size0: 50 + rng() * 20,
      size1: 0,
      cell: 1,
      tint,
      twinkle: true,
    });
  }

  animate(clock) {
    const b = this.batch;
    b.clear();
    const g = this.glow;
    if (g.visible) b.push(g.x, g.y, g.z, g.size, 0, UV[SPARKLE.GLOW], 1, 0.85, 0.4, g.alpha);
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const age = clock - p.t0;
      if (age >= p.life) {
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      if (age < 0) continue; // spawned by a tick that this frame has not reached yet
      const u = age / p.life;
      const size = p.twinkle ? p.size0 * Math.sin(Math.PI * u) : p.size0 + (p.size1 - p.size0) * u;
      const alpha = p.twinkle ? 1 : 1 - u * u;
      const tint = p.tint;
      b.push(
        p.x + p.vx * age,
        p.y + p.vy * age + 0.5 * p.gy * age * age,
        p.z + p.vz * age,
        size,
        p.rot + p.spin * age,
        UV[p.cell],
        tint[0],
        tint[1],
        tint[2],
        alpha,
      );
    }
    b.commit();
  }
}
