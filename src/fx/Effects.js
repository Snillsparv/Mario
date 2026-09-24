// Weather and fire effects for AI RACE mode: camera-following rain with splashes, lightning,
// burning fires and fireball blasts.
//
//   const fx = new Effects({ scene, events, collision, layout, view? })
//   fx.setRain(t)                              0..1 rain amount (follows the darkness fade)
//   fx.ignite(x, y, z, { radius = 150, duration = 8, intensity = 1 }) -> id
//   fx.extinguish(id)                          the fire dies down over ~1 s
//   fx.clearFires()                            every fire, blast and splash gone at once (reset)
//   fx.isBurning(id)                           still alight (not yet dying down)
//   fx.explode(x, y, z, { radius = 250 })      one-shot fiery blast (~0.8 s)
//   fx.strike(strength?)                       a lightning strike now (tests, scripted scenes)
//   fx.update(dt, time, camera)                per render frame; dt = 0 freezes everything
//   fx.lightningFlash                          current flash brightness 0..1 (decays)
//
// Lightning: while the rain is above 0.6, strikes come every 6-14 s. Each strike emits
// 'lightning' { strength (0.5..1), pos } on `events`, flashes the renderer (view.flash) and
// draws a jagged bolt in the distance for ~0.2 s. The renderer is `view` if given, else the
// N64Renderer that owns `scene` (it registers itself as scene.userData.view).
//
// Cost: two draw calls at most (fx/ParticleBatch.js: every sprite; fx/RainStreaks.js: the
// rain, animated on the GPU), none while nothing is alive and the rain is 0. Nothing is
// allocated per frame: particles live in a fixed pool (fx/ParticlePool.js), fires in fixed
// slots, splash heights come from a memoised grid (fx/HeightCache.js).

import * as THREE from 'three';
import { makeRng } from '../core/math.js';
import { ParticlePool } from './ParticlePool.js';
import { ParticleBatch } from './ParticleBatch.js';
import { RainStreaks } from './RainStreaks.js';
import { HeightCache, NOTHING_BELOW } from './HeightCache.js';
import { LightningScheduler, LIGHTNING, buildBolt } from './lightning.js';
import { KIND, MODE } from './kinds.js';
import { SHAPE, buildAtlas } from './atlas.js';

export const FX = Object.freeze({
  capacity: 2048, // particles
  maxFires: 32,
  fireFadeIn: 0.35, // seconds to full blaze
  fireFadeOut: 1, // seconds a fire takes to die down
  flameRate: 30, // flames per second per fire (about 22 alive)
  smokeRate: 4.5,
  emberRate: 6,
  splashRate: 300, // rain splashes per second at rain 1
  splashRange: 1500, // splashes land within this distance in front of the camera
  pixelHeight: 240, // picture height when no renderer is known (the retro filter's lines)
});

const TAU = Math.PI * 2;
const BOLT_SEGMENTS = 64;

// One fire slot (reused; `id` 0 = free).
function makeFire() {
  return {
    id: 0,
    x: 0,
    y: 0,
    z: 0,
    groundY: 0,
    radius: 150,
    duration: 8,
    intensity: 1,
    age: 0,
    aerial: false,
    level: 0, // 0..1 blaze (fade in / die down)
    flameAcc: 0,
    smokeAcc: 0,
    emberAcc: 0,
    seed: 0,
  };
}

// Blaze level of a fire `age` seconds old that burns `duration` seconds: ramps in, holds,
// dies down over FX.fireFadeOut. Pure.
export function fireLevel(age, duration) {
  if (age < 0) return 0;
  const inT = Math.min(1, age / FX.fireFadeIn);
  const rampIn = 0.3 + 0.7 * inT;
  if (age <= duration) return rampIn;
  return rampIn * Math.max(0, 1 - (age - duration) / FX.fireFadeOut);
}

export class Effects {
  constructor({ scene = null, events = null, collision = null, layout = null, view = null, seed = 20260924, capacity = FX.capacity } = {}) {
    this.scene = scene;
    this.events = events;
    this.collision = collision;
    this.layout = layout;
    this.view = view ?? scene?.userData?.view ?? null;
    this.rng = makeRng(seed);
    this.nextId = 1;
    this.clock = 0; // effects time (seconds, advances with dt)
    this.rainAmount = 0;
    this.dirty = false; // something changed while dt = 0 (paused): redraw the batch

    this.pool = new ParticlePool(capacity);
    this.batch = new ParticleBatch(capacity + FX.maxFires * 2, buildAtlas());
    this.rain = new RainStreaks();
    this.heights = new HeightCache({ collision, layout, cell: 50 });
    this.lightning = new LightningScheduler(this.rng);
    this.fires = Array.from({ length: FX.maxFires }, makeFire);
    this.bolt = new Float32Array(BOLT_SEGMENTS * 6);
    this.dir = { x: 0, y: 1, z: 0 }; // randomDir scratch (no allocation per particle)

    this.camPos = new THREE.Vector3();
    this.camDir = new THREE.Vector3(0, 0, -1);
    this.hasCamera = false;
    this.camYaw = 0;
    this.underwater = false;
    this.splashAcc = 0;
    this.windX = 0;
    this.windZ = 0;
    this.pixelHeight = 0;
    this.pixelFov = 0;

    if (scene) scene.add(this.batch.mesh, this.rain.mesh);
    this.view?.prewarm?.(this.batch.mesh);
    this.view?.prewarm?.(this.rain.mesh);
  }

  // ------------------------------------------------------------------ public API

  setRain(t) {
    const k = t > 0 ? Math.min(1, t) : 0;
    this.rainAmount = k;
    this.rain.setAmount(k);
    // Takes effect at once: update() does not run behind the title screen.
    if (!k) this.rain.mesh.visible = false;
  }

  // Current lightning flash brightness (0..1, decays over ~0.4 s).
  get lightningFlash() {
    return this.lightning.flash;
  }

  // Number of fires alight (including ones dying down).
  get fireCount() {
    let n = 0;
    for (const f of this.fires) if (f.id) n++;
    return n;
  }

  get particleCount() {
    return this.pool.count;
  }

  ignite(x, y, z, { radius = 150, duration = 8, intensity = 1 } = {}) {
    const f = this.freeFireSlot();
    const id = this.nextId++;
    f.id = id;
    f.x = x;
    f.y = y;
    f.z = z;
    f.radius = Math.max(10, radius);
    f.duration = Math.max(0, duration);
    f.intensity = Math.max(0, intensity);
    f.age = 0;
    f.level = fireLevel(0, f.duration);
    f.seed = this.rng();
    f.flameAcc = f.smokeAcc = f.emberAcc = 0;
    // On the ground, or up in the air (a tree canopy): flames fill a ball instead of a disc.
    const ground = this.heights.sample(x, z);
    f.groundY = ground > NOTHING_BELOW ? Math.min(ground, y) : y;
    f.aerial = y - f.groundY > Math.max(90, f.radius * 0.5);
    // Catch at once: a first handful of flames.
    const slot = this.fires.indexOf(f);
    for (let k = 0; k < 6; k++) this.spawnFlame(f, slot);
    this.dirty = true;
    return id;
  }

  // Makes fire `id` die down now (over ~1 s). Returns false if it is not burning.
  extinguish(id) {
    const f = this.fireById(id);
    if (!f) return false;
    if (f.age < f.duration) f.duration = f.age;
    return true;
  }

  // Every fire out at once, and every live particle with it (flames, smoke, blasts, splashes,
  // a bolt): the game-over reset. Takes effect at once, since update() does not run behind
  // the title screen.
  clearFires() {
    for (const f of this.fires) f.id = 0;
    this.pool.clear();
    this.writeBatch();
  }

  // True while fire `id` burns (not once it is dying down or gone).
  isBurning(id) {
    const f = this.fireById(id);
    return !!f && f.age < f.duration;
  }

  explode(x, y, z, { radius = 250 } = {}) {
    const R = Math.max(20, radius);
    const P = this.pool;
    const rng = this.rng;
    const sc = R / 250;
    let i = P.alloc();
    if (i >= 0) {
      P.kind[i] = KIND.FLASH;
      P.px[i] = x;
      P.py[i] = y;
      P.pz[i] = z;
      P.size0[i] = R * 0.35;
      P.size1[i] = R * 1.5;
      P.life[i] = 0.32;
      P.rot[i] = rng() * TAU;
    }
    for (let k = 0; k < 12; k++) {
      i = P.alloc();
      if (i < 0) break;
      randomDir(rng, 0.35, this.dir);
      const sp = R * (1.8 + rng() * 1.4);
      P.kind[i] = KIND.FIREBALL;
      P.px[i] = x + this.dir.x * R * 0.1;
      P.py[i] = y + this.dir.y * R * 0.1;
      P.pz[i] = z + this.dir.z * R * 0.1;
      P.vx[i] = this.dir.x * sp;
      P.vy[i] = this.dir.y * sp;
      P.vz[i] = this.dir.z * sp;
      P.drag[i] = 5;
      P.accel[i] = R * 0.6;
      P.size0[i] = R * (0.25 + rng() * 0.15);
      P.size1[i] = R * (0.55 + rng() * 0.25);
      P.life[i] = 0.45 + rng() * 0.3;
      P.age[i] = -rng() * 0.06;
      P.rot[i] = rng() * TAU;
      P.spin[i] = (rng() - 0.5) * 3;
      P.seed[i] = rng();
    }
    for (let k = 0; k < 36; k++) {
      i = P.alloc();
      if (i < 0) break;
      randomDir(rng, 0.25, this.dir);
      const sp = R * (3 + rng() * 3.5);
      P.kind[i] = KIND.SPARK;
      P.px[i] = x;
      P.py[i] = y;
      P.pz[i] = z;
      P.vx[i] = this.dir.x * sp;
      P.vy[i] = this.dir.y * sp;
      P.vz[i] = this.dir.z * sp;
      P.drag[i] = 1.2;
      P.accel[i] = -1800;
      P.size0[i] = (3.5 + rng() * 2.5) * Math.sqrt(sc);
      P.size1[i] = P.size0[i] * 0.6;
      P.stretch[i] = 0.035;
      P.life[i] = 0.35 + rng() * 0.5;
      P.seed[i] = rng();
    }
    for (let k = 0; k < 14; k++) {
      i = P.alloc();
      if (i < 0) break;
      randomDir(rng, 0.55, this.dir);
      const sp = R * (1.5 + rng() * 1.9);
      P.kind[i] = KIND.DEBRIS;
      P.px[i] = x;
      P.py[i] = y;
      P.pz[i] = z;
      P.vx[i] = this.dir.x * sp;
      P.vy[i] = this.dir.y * sp;
      P.vz[i] = this.dir.z * sp;
      P.drag[i] = 0.4;
      P.accel[i] = -2400;
      P.size0[i] = P.size1[i] = (8 + rng() * 10) * sc;
      P.rot[i] = rng() * TAU;
      P.spin[i] = (rng() - 0.5) * 20;
      P.life[i] = 0.8 + rng() * 0.45;
      P.seed[i] = rng();
    }
    for (let k = 0; k < 9; k++) {
      i = P.alloc();
      if (i < 0) break;
      randomDir(rng, 0.2, this.dir);
      const sp = R * (0.5 + rng() * 0.6);
      P.kind[i] = KIND.SMOKE;
      P.px[i] = x + this.dir.x * R * 0.3;
      P.py[i] = y + this.dir.y * R * 0.3;
      P.pz[i] = z + this.dir.z * R * 0.3;
      P.vx[i] = this.dir.x * sp;
      P.vy[i] = this.dir.y * sp + R * 0.4;
      P.vz[i] = this.dir.z * sp;
      P.drag[i] = 1.6;
      P.accel[i] = R * 0.35;
      P.wind[i] = 0.5;
      P.size0[i] = R * 0.3;
      P.size1[i] = R * (0.9 + rng() * 0.4);
      P.life[i] = 1.4 + rng() * 1;
      P.age[i] = -(0.08 + rng() * 0.12);
      P.rot[i] = rng() * TAU;
      P.spin[i] = (rng() - 0.5) * 1.2;
      P.seed[i] = rng();
    }
    const ground = this.heights.sample(x, z);
    if (ground > NOTHING_BELOW && y - ground < R * 1.2) {
      i = P.alloc();
      if (i >= 0) {
        P.kind[i] = KIND.SHOCKWAVE;
        P.px[i] = x;
        P.py[i] = ground + 6;
        P.pz[i] = z;
        P.size0[i] = R * 0.2;
        P.size1[i] = R * 1.9;
        P.life[i] = 0.45;
        P.rot[i] = rng() * TAU;
      }
    }
    this.dirty = true;
  }

  // A lightning strike now: flash, 'lightning' event, a bolt in the distance (in front of
  // the camera when one is known). Returns the strength.
  strike(strength = LIGHTNING.strength[0] + (LIGHTNING.strength[1] - LIGHTNING.strength[0]) * this.rng()) {
    const s = this.lightning.trigger(strength);
    this.onStrike(s);
    return s;
  }

  update(dt, time, camera) {
    if (!(dt > 0)) dt = 0;
    this.clock += dt;
    if (camera) this.readCamera(camera);

    // Storm wind (smoke and embers drift with it), rain and lightning.
    const storm = this.rainAmount;
    this.windX = 60 + 300 * storm;
    this.windZ = 20 + 110 * storm;
    this.rain.update(dt, this.hasCamera ? this.camPos : null, this.underwater);
    const s = this.lightning.update(dt, storm);
    if (s > 0) this.onStrike(s);

    if (dt > 0) {
      this.updateFires(dt);
      this.spawnSplashes(dt);
      this.pool.update(dt, this.windX, this.windZ);
    } else if (!this.dirty) {
      return; // frozen: the last frame's sprites stay as they are
    }
    this.dirty = false;
    this.writeBatch();
  }

  dispose() {
    this.scene?.remove(this.batch.mesh, this.rain.mesh);
    this.batch.dispose();
    this.rain.dispose();
    this.batch.material.uniforms.uAtlas.value?.dispose();
  }

  // ------------------------------------------------------------------ internals

  fireById(id) {
    if (!id) return null;
    for (const f of this.fires) if (f.id === id) return f;
    return null;
  }

  // A free slot, or the fire closest to going out.
  freeFireSlot() {
    let best = null;
    let bestLeft = Infinity;
    for (const f of this.fires) {
      if (!f.id) return f;
      const left = f.duration + FX.fireFadeOut - f.age;
      if (left < bestLeft) {
        bestLeft = left;
        best = f;
      }
    }
    return best;
  }

  readCamera(camera) {
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.camDir);
    this.hasCamera = true;
    this.camYaw = Math.atan2(this.camDir.x, this.camDir.z);
    const water = this.collision ? this.collision.waterLevelAt(this.camPos.x, this.camPos.z) : this.layout?.waterLevelAt?.(this.camPos.x, this.camPos.z);
    this.underwater = Number.isFinite(water) && this.camPos.y < water;
    // Streaks stay >= ~1 px wide at the picture's resolution.
    const view = this.view;
    let h = FX.pixelHeight;
    if (view?.internal && view.viewport) h = view.n64 ? view.internal.height : view.viewport.height * (view.pixelRatio || 1);
    const fov = camera.fov || 45;
    if (h !== this.pixelHeight || fov !== this.pixelFov) {
      this.pixelHeight = h;
      this.pixelFov = fov;
      this.batch.setPixelScale(fov, h);
      this.rain.setPixelScale(fov, h);
    }
  }

  updateFires(dt) {
    const fires = this.fires;
    const P = this.pool;
    for (let slot = 0; slot < fires.length; slot++) {
      const f = fires[slot];
      if (!f.id) continue;
      f.age += dt;
      if (f.age >= f.duration + FX.fireFadeOut) {
        f.id = 0;
        continue;
      }
      const level = fireLevel(f.age, f.duration);
      f.level = level;
      const k = level * f.intensity;
      f.flameAcc += dt * FX.flameRate * k * (f.aerial ? 1.7 : 1);
      while (f.flameAcc >= 1) {
        f.flameAcc -= 1;
        this.spawnFlame(f, slot);
      }
      // Smoke keeps coming (thinner) while the fire dies down; embers need a real blaze.
      const busy = P.load > 0.9;
      f.smokeAcc += dt * FX.smokeRate * f.intensity * (level > 0 ? Math.max(level, 0.5) : 0);
      while (f.smokeAcc >= 1) {
        f.smokeAcc -= 1;
        if (!busy) this.spawnSmoke(f, slot);
      }
      f.emberAcc += dt * FX.emberRate * k;
      while (f.emberAcc >= 1) {
        f.emberAcc -= 1;
        if (!busy) this.spawnEmber(f, slot);
      }
    }
  }

  spawnFlame(f, slot) {
    const P = this.pool;
    const i = P.alloc();
    if (i < 0) return;
    const rng = this.rng;
    const R = f.radius;
    const level = Math.max(f.level, 0.3);
    P.kind[i] = KIND.FLAME;
    P.owner[i] = slot + 1;
    if (f.aerial) {
      // A burning canopy: flames lick up from its outer shell (the ones inside the
      // foliage would be hidden), mostly on its top and sides.
      randomDir(rng, 0.45, this.dir);
      const rr = R * (0.8 + 0.25 * rng());
      const size = R * (0.2 + 0.13 * rng()) * (0.55 + 0.45 * level);
      P.px[i] = f.x + this.dir.x * rr;
      P.py[i] = f.y + this.dir.y * rr * 0.85 + size * 0.4;
      P.pz[i] = f.z + this.dir.z * rr;
      P.size0[i] = size;
    } else {
      const ang = rng() * TAU;
      const rr = Math.sqrt(rng()) * R * 0.72;
      const rim = 1 - 0.45 * (rr / R);
      const size = R * (0.36 + 0.2 * rng()) * (0.55 + 0.45 * level) * rim;
      P.px[i] = f.x + Math.cos(ang) * rr;
      P.pz[i] = f.z + Math.sin(ang) * rr;
      P.py[i] = f.y + size * 0.75;
      P.size0[i] = size;
    }
    const size = P.size0[i];
    P.vx[i] = (rng() - 0.5) * R * 0.3;
    P.vz[i] = (rng() - 0.5) * R * 0.3;
    P.vy[i] = R * (0.9 + 0.6 * rng());
    P.accel[i] = R * 0.8;
    P.drag[i] = 0.6;
    P.wind[i] = 0.3;
    P.stretch[i] = 0.17;
    P.size1[i] = size * 0.35;
    P.life[i] = 0.55 + 0.4 * rng();
    P.heat[i] = f.intensity > 1 ? 1 : 0.35 + 0.65 * f.intensity;
    P.seed[i] = rng();
  }

  spawnSmoke(f, slot) {
    const P = this.pool;
    const i = P.alloc();
    if (i < 0) return;
    const rng = this.rng;
    const R = f.radius;
    P.kind[i] = KIND.SMOKE;
    P.owner[i] = slot + 1;
    P.px[i] = f.x + (rng() - 0.5) * R * 0.6;
    P.pz[i] = f.z + (rng() - 0.5) * R * 0.6;
    P.py[i] = f.y + R * (f.aerial ? 0.5 : 0.9);
    P.vy[i] = R * (0.9 + 0.4 * rng());
    P.accel[i] = R * 0.3;
    P.drag[i] = 0.3;
    P.wind[i] = 0.8;
    P.size0[i] = R * 0.35;
    P.size1[i] = R * (1.2 + 0.5 * rng());
    P.life[i] = 2.2 + 1.2 * rng();
    P.rot[i] = rng() * TAU;
    P.spin[i] = (rng() - 0.5) * 0.8;
    P.heat[i] = 0.6 + 0.4 * f.level;
    P.seed[i] = rng();
  }

  spawnEmber(f, slot) {
    const P = this.pool;
    const i = P.alloc();
    if (i < 0) return;
    const rng = this.rng;
    const R = f.radius;
    P.kind[i] = KIND.EMBER;
    P.owner[i] = slot + 1;
    P.px[i] = f.x + (rng() - 0.5) * R;
    P.pz[i] = f.z + (rng() - 0.5) * R;
    P.py[i] = f.y + R * 0.3;
    P.vx[i] = (rng() - 0.5) * R * 1.2;
    P.vz[i] = (rng() - 0.5) * R * 1.2;
    P.vy[i] = R * (1.8 + rng());
    P.accel[i] = R * 0.5;
    P.drag[i] = 0.8;
    P.wind[i] = 1;
    P.size0[i] = 2.5 + rng() * 1.5;
    P.size1[i] = P.size0[i] * 0.5;
    P.stretch[i] = 0.05;
    P.life[i] = 0.9 + rng() * 0.9;
    P.heat[i] = f.intensity > 1 ? 1 : f.intensity;
    P.seed[i] = rng();
  }

  spawnSplashes(dt) {
    if (!(this.rainAmount > 0.05) || !this.hasCamera || this.underwater) {
      this.splashAcc = 0;
      return;
    }
    this.splashAcc += dt * FX.splashRate * this.rainAmount;
    const P = this.pool;
    const rng = this.rng;
    const cam = this.camPos;
    while (this.splashAcc >= 1) {
      this.splashAcc -= 1;
      if (P.load > 0.8) continue; // fires and blasts first
      const ang = this.camYaw + (rng() - 0.5) * 1.9;
      const d = 90 + Math.sqrt(rng()) * FX.splashRange;
      const x = cam.x + Math.sin(ang) * d;
      const z = cam.z + Math.cos(ang) * d;
      const y = this.heights.sample(x, z);
      if (y <= NOTHING_BELOW || y > cam.y + 400) continue;
      const water = this.heights.water;
      let i = P.alloc();
      if (i < 0) return;
      P.kind[i] = KIND.RING;
      P.px[i] = x;
      P.py[i] = y + 5;
      P.pz[i] = z;
      P.size0[i] = 4;
      P.size1[i] = (water ? 34 : 22) * (0.8 + 0.4 * rng());
      P.life[i] = 0.26 + 0.1 * rng();
      P.heat[i] = 0.75 + 0.25 * rng();
      P.rot[i] = rng() * TAU;
      for (let k = water ? 1 : 2; k > 0; k--) {
        i = P.alloc();
        if (i < 0) return;
        P.kind[i] = KIND.DROPLET;
        P.px[i] = x;
        P.py[i] = y + 4;
        P.pz[i] = z;
        P.vx[i] = (rng() - 0.5) * 140;
        P.vz[i] = (rng() - 0.5) * 140;
        P.vy[i] = 170 + rng() * 110;
        P.accel[i] = -1600;
        P.stretch[i] = 0.03;
        P.size0[i] = P.size1[i] = 1.6;
        P.life[i] = 0.2 + rng() * 0.1;
        P.heat[i] = 0.8;
      }
    }
  }

  onStrike(strength) {
    let pos = null;
    if (this.hasCamera) {
      const rng = this.rng;
      // In view: within ~30 degrees of the view direction, far off, reaching down from just
      // above the top of the picture (the foot is usually hidden behind the castle or cliffs).
      const ang = this.camYaw + (rng() - 0.5) * 1.0;
      const d = 8500 + rng() * 4500;
      const x = this.camPos.x + Math.sin(ang) * d;
      const z = this.camPos.z + Math.cos(ang) * d;
      const g = this.heights.sample(x, z);
      const ground = g > NOTHING_BELOW ? g : 0;
      const top = Math.max(ground + 2500, this.camPos.y + d * (0.45 + 0.1 * rng()));
      pos = { x, y: ground, z };
      const n = buildBolt(this.bolt, rng, x + (rng() - 0.5) * 1500, top, z + (rng() - 0.5) * 1500, x, ground, z, { levels: 4, branches: 2 });
      this.spawnBolt(n, strength);
    }
    this.view?.flash?.(strength);
    this.events?.emit('lightning', { strength, pos });
    this.dirty = true;
  }

  spawnBolt(n, strength) {
    const P = this.pool;
    const seg = this.bolt;
    for (let s = 0; s < n; s++) {
      const o = s * 6;
      for (let layer = 0; layer < 2; layer++) {
        const i = P.alloc();
        if (i < 0) return;
        P.kind[i] = layer ? KIND.BOLT_GLOW : KIND.BOLT;
        P.px[i] = (seg[o] + seg[o + 3]) / 2;
        P.py[i] = (seg[o + 1] + seg[o + 4]) / 2;
        P.pz[i] = (seg[o + 2] + seg[o + 5]) / 2;
        // A streak's velocity is its (half-extent / stretch): the whole segment.
        P.vx[i] = seg[o + 3] - seg[o];
        P.vy[i] = seg[o + 4] - seg[o + 1];
        P.vz[i] = seg[o + 5] - seg[o + 2];
        P.stretch[i] = 0.5;
        P.size0[i] = P.size1[i] = layer ? 90 : 16 + 10 * strength;
        P.life[i] = LIGHTNING.boltLife;
        P.heat[i] = strength;
      }
    }
  }

  writeBatch() {
    const b = this.batch;
    b.begin(this.clock);
    b.writePool(this.pool, 1); // smoke, debris
    b.writePool(this.pool, 0); // glows on top
    this.writeFireGlows();
    b.end();
  }

  // Each fire lights the ground under it and glows around its flames.
  writeFireGlows() {
    const b = this.batch;
    const s = b.next;
    const t = this.clock;
    for (const f of this.fires) {
      if (!f.id || f.level <= 0) continue;
      const k = f.level * Math.min(1, f.intensity);
      const flicker = 0.85 + 0.1 * Math.sin(t * 17 + f.seed * 40) + 0.05 * Math.sin(t * 43 + f.seed * 9);
      const R = f.radius;
      s.vx = s.vy = s.vz = s.stretch = 0;
      s.shape = SHAPE.GLOW;
      s.alpha = 0;
      s.fog = true;
      s.rot = 0;
      const lift = f.y - f.groundY;
      if (lift < 700) {
        const a = 0.34 * k * flicker * (f.aerial ? 0.5 : 1);
        s.mode = MODE.GROUND;
        s.x = f.x;
        s.y = f.groundY + 4;
        s.z = f.z;
        s.size = R * (f.aerial ? 1.8 : 2.4) * (0.96 + 0.04 * flicker);
        s.r = 1.3 * a;
        s.g = 0.5 * a;
        s.b = 0.12 * a;
        s.a = 1;
        b.push();
      }
      const a = 0.22 * k * flicker;
      s.mode = MODE.BILLBOARD;
      s.x = f.x;
      s.y = f.y + R * (f.aerial ? 0 : 0.45);
      s.z = f.z;
      s.size = R * 1.5;
      s.r = 1.2 * a;
      s.g = 0.45 * a;
      s.b = 0.1 * a;
      s.a = 1;
      b.push();
    }
  }
}

// Random unit vector into `out`, biased upward by `up` (0 = uniform sphere, 1 = straight up).
function randomDir(rng, up, out) {
  const a = rng() * TAU;
  const y = Math.min(1, rng() * 2 - 1 + up);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  out.x = Math.cos(a) * r;
  out.y = y;
  out.z = Math.sin(a) * r;
  return out;
}
