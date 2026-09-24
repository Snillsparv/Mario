// Fixed-capacity particle store for the effects (flames, smoke, embers, sparks, debris,
// splashes, lightning segments). Pure logic, no three.js: the arrays are read by
// ParticleBatch, which turns them into one instanced draw.
//
// Structure of arrays, live particles packed at [0, count): alloc() hands out slot `count`,
// a dead particle is replaced by the last live one (swap-remove), so nothing is ever
// allocated after construction and the draw needs no free-list walk. Callers write the
// fields of the returned slot directly (numbers are never passed as arguments per particle).
//
// Motion per update(dt):   v.y += accel * dt;  v *= 1 / (1 + drag * dt);  p += v * dt
// A particle with age < 0 is waiting (a delayed spawn): it neither moves nor draws until its
// age reaches 0, then lives `life` seconds.

export const PARTICLE_FIELDS = [
  'px', 'py', 'pz', // position
  'vx', 'vy', 'vz', // velocity (units/s)
  'age', 'life', // seconds; age < 0 = delayed start
  'size0', 'size1', // half-size at birth / at death (linear in between)
  'rot', 'spin', // in-plane rotation (rad) and its rate (rad/s)
  'drag', // velocity damping per second
  'accel', // vertical acceleration (negative = gravity, positive = buoyancy)
  'stretch', // streak length per unit of speed (seconds); 0 = round sprite
  'heat', // brightness scale at spawn (fire die-down, strike strength)
  'wind', // how fast the velocity follows the wind (per second; 0 = not at all)
  'seed', // 0..1 random per particle (flicker phase, shape variant)
];

export class ParticlePool {
  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.count = 0;
    for (const f of PARTICLE_FIELDS) this[f] = new Float32Array(capacity);
    this.arrays = PARTICLE_FIELDS.map((f) => this[f]); // for swap-remove
    this.kind = new Uint8Array(capacity); // what it is (see fx/kinds.js): colour, shape, blend
    this.owner = new Int16Array(capacity); // fire slot + 1, or 0 (explosions, rain, lightning)
  }

  // Slot index of a fresh particle (fields zeroed except owner = 0), or -1 when full.
  alloc() {
    const i = this.count;
    if (i >= this.capacity) return -1;
    this.count = i + 1;
    this.px[i] = this.py[i] = this.pz[i] = 0;
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.age[i] = 0;
    this.life[i] = 1;
    this.size0[i] = this.size1[i] = 1;
    this.rot[i] = this.spin[i] = 0;
    this.drag[i] = this.accel[i] = this.stretch[i] = 0;
    this.heat[i] = 1;
    this.wind[i] = 0;
    this.seed[i] = 0;
    this.kind[i] = 0;
    this.owner[i] = 0;
    return i;
  }

  // Fraction of the capacity in use (0..1).
  get load() {
    return this.count / this.capacity;
  }

  // Advances every particle by dt seconds and removes the ones whose life is over.
  // The horizontal velocity eases toward the wind (windX, windZ units/s) at each particle's
  // `wind` rate (rising smoke and embers drift with it).
  update(dt, windX = 0, windZ = 0) {
    if (dt <= 0) return;
    const { px, py, pz, vx, vy, vz, age, life, drag, accel, rot, spin, wind } = this;
    let i = 0;
    while (i < this.count) {
      const a = age[i] + dt;
      if (a >= life[i]) {
        this.remove(i);
        continue; // slot i now holds the former last particle: process it too
      }
      age[i] = a;
      if (a > 0) {
        const t = a < dt ? a : dt; // a delayed particle only moves for the part after its start
        const damp = 1 / (1 + drag[i] * t);
        const up = accel[i];
        let x = vx[i];
        let z = vz[i];
        const w = wind[i];
        if (w > 0) {
          const k = Math.min(1, t * w);
          x += (windX - x) * k;
          z += (windZ - z) * k;
        }
        vx[i] = x * damp;
        vy[i] = (vy[i] + up * t) * damp;
        vz[i] = z * damp;
        px[i] += vx[i] * t;
        py[i] += vy[i] * t;
        pz[i] += vz[i] * t;
        rot[i] += spin[i] * t;
      }
      i++;
    }
  }

  // Removes particle i (the last live particle moves into its slot).
  remove(i) {
    const last = --this.count;
    if (i === last) return;
    const arrays = this.arrays;
    for (let f = 0; f < arrays.length; f++) arrays[f][i] = arrays[f][last];
    this.kind[i] = this.kind[last];
    this.owner[i] = this.owner[last];
  }

  // Removes every particle for which test(kind, owner) is true. Returns how many went.
  removeWhere(test) {
    let removed = 0;
    let i = 0;
    while (i < this.count) {
      if (test(this.kind[i], this.owner[i])) {
        this.remove(i);
        removed++;
      } else i++;
    }
    return removed;
  }

  clear() {
    this.count = 0;
  }
}
