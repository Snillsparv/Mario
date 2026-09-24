// Lightning timing (pure) and the jagged bolt's shape.
//
// While the rain is heavier than LIGHTNING.minRain a strike comes every 6-14 s (the first
// one 2.5-6 s after the storm gets there). Time only runs with dt, so a paused game gets no
// strikes. Strength is 0.5..1.

import { flashEnvelope } from '../render/post/storm.js';

export const LIGHTNING = Object.freeze({
  minRain: 0.6,
  firstDelay: [2.5, 6],
  interval: [6, 14],
  strength: [0.5, 1],
  boltLife: 0.2, // seconds the bolt stays drawn
});

export class LightningScheduler {
  constructor(rng) {
    this.rng = rng;
    this.timer = -1; // seconds to the next strike; < 0 = not armed (rain too light)
    this.strikes = 0;
    // The flash as the effects see it (strength x envelope), for fx.lightningFlash.
    this.flashAge = 1e9;
    this.flashStrength = 0;
    this.flash = 0;
  }

  // Advances by dt at rain amount `rain`. Returns the strength of a strike that happens now,
  // or 0.
  update(dt, rain) {
    if (dt > 0) {
      this.flashAge += dt;
      this.flash = this.flashStrength * flashEnvelope(this.flashAge);
    }
    if (!(rain > LIGHTNING.minRain)) {
      this.timer = -1;
      return 0;
    }
    if (this.timer < 0) this.timer = this.pick(LIGHTNING.firstDelay);
    if (!(dt > 0)) return 0;
    this.timer -= dt;
    if (this.timer > 0) return 0;
    this.timer = this.pick(LIGHTNING.interval);
    return this.trigger(this.pick(LIGHTNING.strength));
  }

  // A strike of the given strength now (also used for manual strikes). Returns strength.
  trigger(strength) {
    this.strikes++;
    this.flashAge = 0;
    this.flashStrength = strength;
    this.flash = strength * flashEnvelope(0);
    return strength;
  }

  pick([lo, hi]) {
    return lo + (hi - lo) * this.rng();
  }
}

// Fills `out` (flat [x0,y0,z0, x1,y1,z1, ...] segment endpoints, reused) with a jagged bolt
// from (x, top, z) down to (x2, bottom, z2) with `levels` of midpoint displacement and up to
// two short branches. Returns the number of segments.
export function buildBolt(out, rng, x, top, z, x2, bottom, z2, { levels = 4, jag = 0.22, branches = 2 } = {}) {
  let n = 0;
  const push = (ax, ay, az, bx, by, bz) => {
    const o = n * 6;
    if (o + 6 > out.length) return;
    out[o] = ax;
    out[o + 1] = ay;
    out[o + 2] = az;
    out[o + 3] = bx;
    out[o + 4] = by;
    out[o + 5] = bz;
    n++;
  };
  // Recursive midpoint displacement: horizontal offsets proportional to the segment length.
  const split = (ax, ay, az, bx, by, bz, level, spread) => {
    if (level === 0) {
      push(ax, ay, az, bx, by, bz);
      return;
    }
    const len = Math.abs(ay - by);
    const mx = (ax + bx) / 2 + (rng() - 0.5) * len * spread;
    const mz = (az + bz) / 2 + (rng() - 0.5) * len * spread;
    const my = (ay + by) / 2 + (rng() - 0.5) * len * 0.15;
    split(ax, ay, az, mx, my, mz, level - 1, spread);
    split(mx, my, mz, bx, by, bz, level - 1, spread);
  };
  split(x, top, z, x2, bottom, z2, levels, jag * 2);
  const main = n;
  // Branches fork off the upper half of the main channel and die out in the air.
  for (let b = 0; b < branches && main > 2; b++) {
    const s = Math.floor(rng() * main * 0.6);
    const o = s * 6 + 3;
    const bx = out[o];
    const by = out[o + 1];
    const bz = out[o + 2];
    const drop = (by - bottom) * (0.25 + rng() * 0.25);
    const ang = rng() * Math.PI * 2;
    const reach = drop * (0.5 + rng() * 0.4);
    split(bx, by, bz, bx + Math.cos(ang) * reach, by - drop, bz + Math.sin(ang) * reach, levels - 2, jag * 2.4);
  }
  return n;
}
