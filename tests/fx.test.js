// Effects (src/fx/*): particle pool, fire lifetimes, blasts, rain, lightning timing, the
// splash height cache and the bolt shape. Pure logic in node; the look is checked with
// /preview.html?m=fx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ParticlePool } from '../src/fx/ParticlePool.js';
import { Effects, FX, fireLevel } from '../src/fx/Effects.js';
import { RainStreaks, RAIN, EMBERS } from '../src/fx/RainStreaks.js';
import { levelsAt, lightAnchor, placeOrb, meltdownLevels } from '../src/fx/Meltdown.js';
import { HeightCache } from '../src/fx/HeightCache.js';
import { LightningScheduler, LIGHTNING, buildBolt } from '../src/fx/lightning.js';
import { KIND, KIND_INFO, particleStyle, isAlphaKind } from '../src/fx/kinds.js';
import { SHAPE, cellRect } from '../src/fx/atlas.js';
import { Events } from '../src/core/events.js';
import { makeRng } from '../src/core/math.js';
import { NO_WATER, FLOOR_LOWER_LIMIT } from '../src/core/constants.js';

const DT = 1 / 60;

function run(fx, seconds, camera = null) {
  for (let t = 0; t < seconds - 1e-9; t += DT) fx.update(DT, 0, camera);
}

function camera() {
  const cam = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  cam.position.set(0, 720, 7300);
  cam.lookAt(0, 380, 0);
  cam.updateMatrixWorld();
  return cam;
}

// Flat lawn at y = 100 with a pond (water at -20 over a floor at -500) for x < -3000.
function fakeCollision() {
  const c = {
    floorCalls: 0,
    findFloor(x) {
      c.floorCalls++;
      return { y: x < -3000 ? -500 : 100, surface: {} };
    },
    waterLevelAt: (x) => (x < -3000 ? -20 : NO_WATER),
  };
  return c;
}

function makeFx(opts = {}) {
  const scene = new THREE.Scene();
  const events = new Events();
  const flashes = [];
  const view = { flash: (s) => flashes.push(s), prewarm() {} };
  const fx = new Effects({ scene, events, collision: fakeCollision(), view, ...opts });
  return { fx, scene, events, flashes };
}

// ------------------------------------------------------------------ ParticlePool

test('pool: alloc hands out packed slots up to capacity, then -1', () => {
  const pool = new ParticlePool(4);
  assert.deepEqual([pool.alloc(), pool.alloc(), pool.alloc(), pool.alloc()], [0, 1, 2, 3]);
  assert.equal(pool.alloc(), -1);
  assert.equal(pool.count, 4);
  assert.equal(pool.load, 1);
});

test('pool: particles die when their life is over; the last one fills the gap', () => {
  const pool = new ParticlePool(8);
  const lives = [0.5, 2, 0.5, 3];
  for (const [n, life] of lives.entries()) {
    const i = pool.alloc();
    pool.life[i] = life;
    pool.seed[i] = n; // identifies the particle
  }
  pool.update(1);
  assert.equal(pool.count, 2);
  assert.deepEqual([...pool.seed.slice(0, 2)].sort(), [1, 3], 'the long-lived ones survive');
  pool.update(1.5);
  assert.equal(pool.count, 1);
  assert.equal(pool.seed[0], 3);
  pool.update(1);
  assert.equal(pool.count, 0);
});

test('pool: motion integrates velocity, gravity, drag and spin; dt 0 changes nothing', () => {
  const pool = new ParticlePool(2);
  const i = pool.alloc();
  pool.life[i] = 10;
  pool.vx[i] = 100;
  pool.vy[i] = 0;
  pool.accel[i] = -1000;
  pool.spin[i] = 2;
  pool.update(0);
  assert.equal(pool.px[i], 0);
  assert.equal(pool.age[i], 0);
  for (let k = 0; k < 30; k++) pool.update(1 / 30);
  assert.ok(Math.abs(pool.px[i] - 100) < 1e-3, 'x moved 100 in 1 s');
  assert.ok(pool.py[i] < -450 && pool.py[i] > -520, `fell under gravity (${pool.py[i]})`);
  assert.ok(Math.abs(pool.rot[i] - 2) < 1e-4);
  const j = pool.alloc();
  pool.life[j] = 10;
  pool.vx[j] = 100;
  pool.drag[j] = 2;
  for (let k = 0; k < 30; k++) pool.update(1 / 30);
  assert.ok(pool.vx[j] < 20 && pool.vx[j] > 5, 'drag slows it down');
});

test('pool: a delayed particle (negative age) waits in place, then lives its full life', () => {
  const pool = new ParticlePool(2);
  const i = pool.alloc();
  pool.age[i] = -0.5;
  pool.life[i] = 1;
  pool.vy[i] = 100;
  pool.update(0.25);
  assert.equal(pool.py[i], 0, 'not started yet');
  assert.equal(particleStyle(pool, i, { clock: 0 }), false, 'not drawn while waiting');
  pool.update(0.5); // started 0.25 s ago
  assert.ok(Math.abs(pool.py[i] - 25) < 1e-3);
  pool.update(0.7);
  assert.equal(pool.count, 1, 'still alive at age 0.95');
  pool.update(0.1);
  assert.equal(pool.count, 0);
});

test('pool: wind drags only particles with a wind rate', () => {
  const pool = new ParticlePool(2);
  const a = pool.alloc();
  const b = pool.alloc();
  pool.life[a] = pool.life[b] = 10;
  pool.wind[b] = 1;
  for (let k = 0; k < 120; k++) pool.update(1 / 30, 300, -100);
  assert.equal(pool.vx[a], 0);
  assert.ok(pool.vx[b] > 290 && pool.vz[b] < -95, 'follows the wind');
});

test('pool: removeWhere and clear', () => {
  const pool = new ParticlePool(8);
  for (let k = 0; k < 6; k++) {
    const i = pool.alloc();
    pool.owner[i] = k % 2;
    pool.life[i] = 5;
  }
  assert.equal(pool.removeWhere((kind, owner) => owner === 1), 3);
  assert.equal(pool.count, 3);
  for (let i = 0; i < pool.count; i++) assert.equal(pool.owner[i], 0);
  pool.clear();
  assert.equal(pool.count, 0);
});

// ------------------------------------------------------------------ fires

test('fireLevel: catches quickly, holds, dies down over ~1 s', () => {
  assert.ok(fireLevel(0, 8) > 0 && fireLevel(0, 8) < 0.5);
  assert.equal(fireLevel(FX.fireFadeIn, 8), 1);
  assert.equal(fireLevel(5, 8), 1);
  assert.ok(Math.abs(fireLevel(8 + FX.fireFadeOut / 2, 8) - 0.5) < 1e-9);
  assert.equal(fireLevel(8 + FX.fireFadeOut, 8), 0);
  assert.equal(FX.fireFadeOut, 1);
});

test('ignite: unique ids, burns for its duration, then dies down and frees its slot', () => {
  const { fx } = makeFx();
  const a = fx.ignite(0, 100, 4800, { radius: 200, duration: 2 });
  const b = fx.ignite(500, 100, 4800);
  assert.notEqual(a, b);
  assert.equal(fx.fireCount, 2);
  assert.ok(fx.particleCount > 0, 'flames at once');
  run(fx, 1.9);
  assert.ok(fx.isBurning(a));
  assert.ok(fx.particleCount > 20, `a blaze (${fx.particleCount})`);
  run(fx, 0.2);
  assert.equal(fx.isBurning(a), false, 'dying down after its duration');
  assert.equal(fx.fireCount, 2, 'still drawn while it dies down');
  run(fx, FX.fireFadeOut);
  assert.equal(fx.fireCount, 1, 'gone after the fade');
  assert.ok(fx.isBurning(b), 'the default 8 s fire burns on');
});

test('extinguish: the fire dies down within ~1 s; unknown ids are ignored', () => {
  const { fx } = makeFx();
  const id = fx.ignite(0, 100, 4800, { duration: 30 });
  run(fx, 1);
  assert.equal(fx.extinguish(id), true);
  assert.equal(fx.isBurning(id), false);
  run(fx, FX.fireFadeOut + 0.05);
  assert.equal(fx.fireCount, 0);
  assert.equal(fx.extinguish(id), false);
  assert.equal(fx.extinguish(12345), false);
  assert.equal(fx.isBurning(0), false);
});

test('clearFires: every fire and particle gone at once, the batch hidden (no draw call)', () => {
  const { fx } = makeFx();
  for (let k = 0; k < 5; k++) fx.ignite(k * 300, 100, 4800, { duration: 30 });
  fx.explode(0, 200, 4000);
  run(fx, 0.5);
  assert.ok(fx.batch.mesh.visible);
  fx.clearFires();
  assert.equal(fx.fireCount, 0);
  assert.equal(fx.particleCount, 0);
  assert.equal(fx.batch.mesh.visible, false, 'hidden without another update (title screen)');
  assert.equal(fx.batch.geometry.instanceCount, 0);
});

test('up to 24+ fires at once in the fixed slots; beyond that the oldest makes room', () => {
  const { fx } = makeFx();
  const ids = [];
  for (let k = 0; k < 24; k++) ids.push(fx.ignite((k % 6) * 400, 100, 3000 + Math.floor(k / 6) * 400, { duration: 10 + k }));
  assert.equal(fx.fireCount, 24);
  run(fx, 1);
  assert.ok(fx.particleCount < fx.pool.capacity, 'the pool holds 24 blazes');
  for (let k = 0; k < 20; k++) ids.push(fx.ignite(0, 100, 0, { duration: 60 }));
  assert.equal(fx.fireCount, FX.maxFires);
  assert.ok(ids.slice(-20).every((id) => fx.isBurning(id)), 'the newest fires burn');
  assert.equal(fx.isBurning(ids[0]), false, 'the one closest to going out was replaced');
  assert.ok(fx.batch.count <= fx.batch.capacity);
});

test('a fire high above the ground burns as a ball (tree canopy), one on it as a disc', () => {
  const { fx } = makeFx();
  const ground = fx.ignite(0, 100, 4800, { radius: 150 });
  const canopy = fx.ignite(600, 650, 4800, { radius: 250 });
  const slot = (id) => fx.fires.find((f) => f.id === id);
  assert.equal(slot(ground).aerial, false);
  assert.equal(slot(canopy).aerial, true);
  assert.equal(slot(canopy).groundY, 100);
  run(fx, 1);
  const P = fx.pool;
  let above = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] === KIND.FLAME && P.owner[i] === fx.fires.indexOf(slot(ground)) + 1) assert.ok(P.py[i] >= 100, 'ground flames stand on the ground');
    if (P.kind[i] === KIND.FLAME && P.px[i] > 300 && P.py[i] > 650) above++;
  }
  assert.ok(above > 3, 'canopy flames lick up round the top');
});

test('update(0) freezes: nothing moves, spawns or dies while paused', () => {
  const { fx } = makeFx();
  fx.setRain(1);
  fx.ignite(0, 100, 4800);
  const cam = camera();
  run(fx, 0.5, cam);
  const count = fx.particleCount;
  const snapshot = Float32Array.from(fx.pool.py.subarray(0, count));
  const batchCount = fx.batch.count;
  for (let k = 0; k < 100; k++) fx.update(0, 0, cam);
  assert.equal(fx.particleCount, count);
  assert.deepEqual(Float32Array.from(fx.pool.py.subarray(0, count)), snapshot);
  assert.equal(fx.batch.count, batchCount);
  assert.equal(fx.lightning.strikes, 0);
});

// ------------------------------------------------------------------ blasts

test('explode: a burst of flash, fireballs, sparks, debris, smoke and a ground ring, gone in ~2.5 s', () => {
  const { fx } = makeFx();
  fx.explode(0, 200, 4000, { radius: 250 });
  const kinds = new Set();
  for (let i = 0; i < fx.pool.count; i++) kinds.add(fx.pool.kind[i]);
  for (const k of [KIND.FLASH, KIND.FIREBALL, KIND.SPARK, KIND.DEBRIS, KIND.SMOKE, KIND.SHOCKWAVE]) assert.ok(kinds.has(k), `kind ${k}`);
  run(fx, 0.8);
  for (let i = 0; i < fx.pool.count; i++) {
    assert.ok([KIND.SMOKE, KIND.DEBRIS].includes(fx.pool.kind[i]), 'the fire part of the blast is over by 0.8 s');
  }
  run(fx, 2);
  assert.equal(fx.particleCount, 0);
  assert.equal(fx.batch.mesh.visible, false);
});

test('explode high in the air: no ground ring', () => {
  const { fx } = makeFx();
  fx.explode(0, 2000, 4000, { radius: 250 });
  for (let i = 0; i < fx.pool.count; i++) assert.notEqual(fx.pool.kind[i], KIND.SHOCKWAVE);
});

// ------------------------------------------------------------------ rain

test('rain: streak count and opacity scale with t; no draw at 0', () => {
  assert.equal(RainStreaks.countFor(0), 0);
  assert.equal(RainStreaks.countFor(-1), 0);
  assert.equal(RainStreaks.countFor(1), RAIN.maxStreaks);
  let last = 0;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const n = RainStreaks.countFor(t);
    assert.ok(n > last);
    last = n;
  }
  assert.equal(RainStreaks.alphaFor(0), 0);
  assert.ok(RainStreaks.alphaFor(1) > RainStreaks.alphaFor(0.3));

  const { fx } = makeFx();
  const cam = camera();
  fx.update(DT, 0, cam);
  assert.equal(fx.rain.mesh.visible, false);
  assert.equal(fx.batch.mesh.visible, false, 'nothing alive: no draw calls at all');
  fx.setRain(1);
  fx.update(DT, 0, cam);
  assert.equal(fx.rain.mesh.visible, true);
  assert.equal(fx.rain.geometry.instanceCount, RAIN.maxStreaks);
  fx.setRain(0);
  assert.equal(fx.rain.mesh.visible, false, 'hidden at once (update() does not run behind the title)');
});

test('rain: the fall offsets stay inside the box however long it rains (no float drift)', () => {
  const rain = new RainStreaks();
  rain.setAmount(1);
  rain.clock = 1e6; // ~11.5 days of rain
  rain.update(DT, new THREE.Vector3(0, 500, 0));
  for (const o of rain.material.uniforms.uOffsets.value) {
    assert.ok(o.x >= 0 && o.x < RAIN.box && o.z >= 0 && o.z < RAIN.box && o.y >= 0 && o.y < RAIN.boxHeight);
  }
  assert.ok(rain.material.uniforms.uCam.value.y === 500, 'the volume follows the camera');
});

test('rain: splashes land on the ground and water in front of the camera, none under water', () => {
  const { fx } = makeFx();
  const cam = camera();
  fx.setRain(1);
  run(fx, 0.2, cam);
  const P = fx.pool;
  let rings = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== KIND.RING) continue;
    rings++;
    assert.ok(Math.abs(P.py[i] - 105) < 1e-3, 'on the lawn');
    assert.ok(P.pz[i] < cam.position.z + 200, 'in front of the camera');
  }
  assert.ok(rings > 20, `rings (${rings})`);
  run(fx, 10, cam);
  const queries = fx.heights.queries;
  run(fx, 5, cam); // ~1500 more splashes
  assert.ok(fx.heights.queries - queries < 150, 'heights come from the cache');

  const wet = makeFx();
  const under = camera();
  under.position.set(-4000, -200, 7300); // below the pond's surface (-20)
  wet.fx.setRain(1);
  run(wet.fx, 0.3, under);
  assert.equal(wet.fx.rain.mesh.visible, false, 'no rain drawn under water');
  for (let i = 0; i < wet.fx.pool.count; i++) assert.notEqual(wet.fx.pool.kind[i], KIND.RING);
});

// ------------------------------------------------------------------ lightning

test('lightning: none while the rain is light, then every 6-14 s with strength 0.5..1', () => {
  const sched = new LightningScheduler(makeRng(3));
  for (let k = 0; k < 60 * 60; k++) assert.equal(sched.update(DT, 0.6), 0, 'rain 0.6 is not enough');
  const times = [];
  let t = 0;
  for (let k = 0; k < 60 * 300; k++) {
    t += DT;
    const s = sched.update(DT, 1);
    if (s > 0) {
      assert.ok(s >= LIGHTNING.strength[0] && s <= LIGHTNING.strength[1]);
      times.push(t);
    }
  }
  assert.ok(times[0] >= LIGHTNING.firstDelay[0] - DT && times[0] <= LIGHTNING.firstDelay[1] + DT, `first at ${times[0]}`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= LIGHTNING.interval[0] - DT && gap <= LIGHTNING.interval[1] + DT, `gap ${gap}`);
  }
  assert.ok(times.length >= 20 && times.length <= 50, `${times.length} strikes in 5 min`);
  assert.equal(sched.strikes, times.length);
});

test('lightning: paused (dt 0) never strikes; the flash decays to 0', () => {
  const sched = new LightningScheduler(makeRng(5));
  for (let k = 0; k < 10000; k++) assert.equal(sched.update(0, 1), 0);
  sched.trigger(0.8);
  assert.equal(sched.flash, 0.8);
  sched.update(0.02, 1);
  assert.ok(sched.flash > 0.5);
  for (let k = 0; k < 40; k++) sched.update(DT, 1);
  assert.equal(sched.flash, 0);
});

test('Effects lightning: emits the event, flashes the renderer, draws a bolt that fades', () => {
  const { fx, events, flashes } = makeFx();
  const seen = [];
  events.on('lightning', (e) => seen.push(e));
  const cam = camera();
  fx.setRain(1);
  run(fx, 40, cam);
  assert.ok(seen.length >= 2, `${seen.length} strikes in 40 s`);
  assert.equal(flashes.length, seen.length, 'view.flash per strike');
  for (const e of seen) {
    assert.ok(e.strength >= 0.5 && e.strength <= 1);
    assert.equal(typeof e.pos.x, 'number');
    assert.ok(Math.hypot(e.pos.x - cam.position.x, e.pos.z - cam.position.z) > 6000, 'far away');
  }
  const s = fx.strike(0.9);
  assert.equal(s, 0.9);
  assert.equal(fx.lightningFlash, 0.9);
  let bolt = 0;
  for (let i = 0; i < fx.pool.count; i++) if (fx.pool.kind[i] === KIND.BOLT) bolt++;
  assert.ok(bolt >= 8, 'a jagged bolt');
  run(fx, 0.6, cam);
  assert.equal(fx.lightningFlash, 0);
  for (let i = 0; i < fx.pool.count; i++) assert.notEqual(fx.pool.kind[i], KIND.BOLT);
});

test('Effects finds the renderer through scene.userData.view when none is passed', () => {
  const scene = new THREE.Scene();
  const flashes = [];
  Object.defineProperty(scene.userData, 'view', { value: { flash: (s) => flashes.push(s) }, enumerable: false });
  const fx = new Effects({ scene, collision: fakeCollision() });
  fx.strike(0.7);
  assert.deepEqual(flashes, [0.7]);
  assert.equal(JSON.stringify(scene.userData), '{}', 'the renderer is not serialised with the scene');
});

test('buildBolt: a connected jagged path from the sky to the ground, plus branches', () => {
  const out = new Float32Array(64 * 6);
  const n = buildBolt(out, makeRng(9), 100, 8000, 200, 0, 0, 0, { levels: 4, branches: 2 });
  assert.ok(n >= 16 + 2, `${n} segments`);
  assert.deepEqual([out[0], out[1], out[2]], [100, 8000, 200], 'starts at the top');
  for (let s = 1; s < 16; s++) {
    assert.deepEqual([...out.slice(s * 6, s * 6 + 3)], [...out.slice(s * 6 - 3, s * 6)], 'main channel is connected');
  }
  assert.deepEqual([...out.slice(15 * 6 + 3, 15 * 6 + 6)], [0, 0, 0], 'ends on the ground');
  assert.equal(buildBolt(new Float32Array(6 * 4), makeRng(1), 0, 1000, 0, 0, 0, 0), 4, 'never overflows its buffer');
});

// ------------------------------------------------------------------ heights, styles, atlas

test('HeightCache: one collision query per cell, water surfaces win over the floor below', () => {
  const collision = fakeCollision();
  const cache = new HeightCache({ collision, cell: 100 });
  assert.equal(cache.sample(10, 10), 100);
  assert.equal(cache.water, false);
  cache.sample(60, 90);
  cache.sample(99, 1);
  assert.equal(collision.floorCalls, 1, 'same cell: cached');
  assert.equal(cache.sample(-4000, 0), -20);
  assert.equal(cache.water, true);
  assert.equal(cache.sample(-4000, 50), -20);
  assert.equal(cache.water, true, 'the water flag is cached too');
  assert.equal(collision.floorCalls, 2);
  cache.sample(50000, 0); // off the grid: answered, not cached
  cache.sample(50000, 0);
  assert.equal(collision.floorCalls, 4);
  const empty = new HeightCache({ collision: { findFloor: () => ({ y: FLOOR_LOWER_LIMIT }), waterLevelAt: () => NO_WATER } });
  assert.equal(empty.sample(0, 0), FLOOR_LOWER_LIMIT);
});

test('kinds: every kind has a style; flames fade out at the end of their life', () => {
  const pool = new ParticlePool(4);
  const out = { clock: 1.3 };
  for (const kind of Object.values(KIND)) {
    const i = pool.alloc();
    pool.kind[i] = kind;
    pool.life[i] = 1;
    pool.age[i] = 0.3;
    pool.size0[i] = pool.size1[i] = 10;
    assert.equal(particleStyle(pool, i, out), true, `kind ${kind}`);
    assert.ok(out.a > 0 && out.size > 0);
    assert.ok(KIND_INFO[kind], 'has info');
    pool.clear();
  }
  const i = pool.alloc();
  pool.kind[i] = KIND.FLAME;
  pool.life[i] = 1;
  pool.age[i] = 0.999;
  pool.size0[i] = 10;
  assert.ok(!particleStyle(pool, i, out) || out.a < 0.01);
  assert.equal(isAlphaKind(KIND.SMOKE), true);
  assert.equal(isAlphaKind(KIND.FLAME), false);
  assert.equal(KIND_INFO[KIND.BOLT].fog, 0, 'the distant bolt is never fogged away');
});

test('atlas cells tile the texture without overlap', () => {
  const rects = Object.values(SHAPE).map(cellRect);
  const keys = new Set(rects.map((r) => r.join(',')));
  assert.equal(keys.size, rects.length);
  for (const [u, v, du, dv] of rects) assert.ok(u >= 0 && v >= 0 && u + du <= 1 && v + dv <= 1);
});

test('effects draw with at most two meshes (draw calls), plus the meltdown light\'s two while it shows; all in the scene', () => {
  const { fx, scene } = makeFx();
  const meshes = [];
  scene.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 4);
  assert.ok(meshes.every((m) => m.frustumCulled === false && m.material.depthWrite === false));
  assert.deepEqual(fx.doom.meshes.map((m) => m.visible), [false, false], 'the light\'s meshes are hidden until it blooms');
  fx.dispose();
  const left = [];
  scene.traverse((o) => o.isMesh && left.push(o));
  assert.equal(left.length, 0);
});

// ------------------------------------------------------------------ AI RACE's meltdown

test('meltdown: the rain turns to embers and ash (same mesh), their offsets stay in the box; 0 = rain again', () => {
  const { fx } = makeFx();
  const cam = camera();
  fx.setRain(1);
  fx.setMeltdown(levelsAt(40.8));
  const u = fx.rain.material.uniforms;
  assert.ok(u.uEmber.value > 0 && u.uEmber.value < 1, 'part rain, part embers as the fire catches');
  fx.setMeltdown(levelsAt(42));
  assert.equal(u.uEmber.value, 1);
  fx.rain.clock = 1e5;
  fx.update(DT, 0, cam);
  for (const o of u.uEmberOffsets.value) assert.ok(o.x >= 0 && o.x < RAIN.box && o.y >= 0 && o.y < RAIN.boxHeight && o.z >= 0 && o.z < RAIN.box);
  assert.ok(u.uEmberDir.value.y > 0 && u.uAshDir.value.y < 0, 'embers rise, ash falls');
  assert.ok(EMBERS.emberShown < 1 && EMBERS.ashShown < 1, 'sparse');
  assert.match(fx.rain.material.vertexShader, /< uEmber;/);
  assert.equal(fx.rain.mesh.visible, true);
  // Embers alone (no rain) still draw.
  fx.setRain(0);
  fx.setMeltdown(levelsAt(42));
  assert.equal(fx.rain.geometry.instanceCount, RAIN.maxStreaks);
  fx.setMeltdown(meltdownLevels());
  assert.equal(u.uEmber.value, 0);
  assert.equal(fx.rain.geometry.instanceCount, 0);
});

test('meltdown: no lightning while the sky burns (the storm still counts until then)', () => {
  const { fx, events } = makeFx({ seed: 3 });
  const strikes = [];
  events.on('lightning', (e) => strikes.push(e));
  const cam = camera();
  fx.setRain(1);
  fx.setMeltdown(levelsAt(35)); // the warning: the storm goes on
  run(fx, 30, cam);
  const before = strikes.length;
  assert.ok(before >= 2, `${before} strikes in the warning`);
  fx.setMeltdown(levelsAt(41));
  run(fx, 60, cam);
  assert.equal(strikes.length, before);
});

test('meltdown light: the fireball and pillar show once it blooms, the shockwave once it leaves; uniforms follow the levels', () => {
  const { fx } = makeFx();
  const at = (s) => {
    const L = levelsAt(s);
    const a = lightAnchor(0, 500, 7000, Math.PI);
    Object.assign(L, { lit: s >= 46, gx: a.gx, gy: a.gy, gz: a.gz });
    return placeOrb(L.light, a, L);
  };
  fx.setMeltdown(at(44));
  assert.deepEqual(fx.doom.meshes.map((m) => m.visible), [false, false]);
  fx.setMeltdown(at(46.2));
  assert.deepEqual(fx.doom.meshes.map((m) => m.visible), [true, false], 'the point of light, no wave yet');
  const L = at(49);
  fx.setMeltdown(L);
  assert.deepEqual(fx.doom.meshes.map((m) => m.visible), [true, true]);
  const o = fx.doom.orbMaterial.uniforms;
  assert.deepEqual(o.uOrb.value.toArray(), [L.lx, L.ly, L.lz, L.lr]);
  assert.ok(o.uFoot.value.y < L.ly && o.uPillarW.value > 0, 'the pillar reaches down');
  assert.equal(o.uGlow.value, L.glow);
  const w = fx.doom.waveMaterial.uniforms;
  assert.equal(w.uRadius.value, L.ring);
  assert.deepEqual(w.uCenter.value.toArray(), [L.gx, L.gy, L.gz]);
  assert.ok(w.uAlpha.value > 0.9);
  assert.equal(fx.doom.orbMaterial.fog, false, 'far past the fog');
  fx.setMeltdown(meltdownLevels());
  assert.deepEqual(fx.doom.meshes.map((m) => m.visible), [false, false], 'reset: gone');
});
