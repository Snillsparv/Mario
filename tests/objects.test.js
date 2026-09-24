// ObjectManager logic in node (no canvas): coin pickups, red coins -> star, star and 1-up
// pickups, butterflies fleeing, pause freeze, title backdrop, reset for a new game after GAME
// OVER, draw-call budget, placement on
// the real layout, and the allocation-free hot paths (pooled sparkles, few collision queries,
// no boxing constructs in the per-tick / per-frame methods).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as realLayout from '../src/world/layout.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Butterflies } from '../src/objects/Butterflies.js';
import { Birds } from '../src/objects/Birds.js';
import { Sparkles, TINT } from '../src/objects/Sparkles.js';
import { CoinField } from '../src/objects/CoinField.js';
import { SpriteBatch } from '../src/objects/SpriteBatch.js';
import { angleDiff } from '../src/core/math.js';
import { COIN_HOVER, PICKUP_RADIUS } from '../src/objects/CoinField.js';
import { coinFaceShade, coinFrameUV, COIN_FRAMES } from '../src/objects/textures.js';
import { CEIL_NONE } from '../src/core/constants.js';

// Square floor at height y, plus optionally a ceiling (facing down) over x, z in [-s, s].
function flatWorld(y = 0, size = 4000, ceiling = null) {
  const w = new CollisionWorld();
  w.addTriangles([-size, y, size, size, y, size, size, y, -size, -size, y, size, size, y, -size, -size, y, -size]);
  if (ceiling) {
    const { y: cy, size: s } = ceiling;
    w.addTriangles([-s, cy, s, s, cy, -s, s, cy, s, -s, cy, s, -s, cy, -s, s, cy, -s]);
  }
  w.finalize();
  return w;
}

const REDS = Array.from({ length: 8 }, (_, i) => ({ x: -1400 + i * 400, z: 1500 }));
const LAYOUT = {
  COINS: [{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 600, z: 0, y: 500 }],
  RED_COINS: REDS,
  STAR: { x: 0, y: 400, z: -1500 },
  BUTTERFLY_SPOTS: [{ x: -2000, z: -2000 }],
  BIRD_CIRCLES: [{ x: 0, z: 0, y: 1500, radius: 800 }],
  ONE_UP: { x: 2500, z: -2500 },
  groundHeight: () => 0,
};

function fakePlayer(x = 3000, y = 0, z = 3000) {
  return {
    pos: { x, y, z },
    coins: 0,
    stars: 0,
    coinCalls: [],
    collectCoin(v) {
      this.coins += v;
      this.coinCalls.push(v);
    },
    collectStar() {
      this.stars++;
    },
  };
}

function setup(layout = LAYOUT, collision = flatWorld()) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'redCoinsComplete', 'starCollected', 'oneUp', 'sfx']) events.on(name, (e) => log.push({ name, e }));
  const player = fakePlayer();
  const scene = new THREE.Scene();
  const objects = new ObjectManager({ scene, collision, events, layout, player });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      objects.update({ player, frame: i });
      objects.animate(0, 1, null);
    }
  };
  return { objects, player, log, step, scene, events };
}

test('coins hover over the ground (or at their given y)', () => {
  const { objects } = setup();
  const [a, , c] = objects.coins.coins;
  assert.equal(a.y, COIN_HOVER);
  assert.equal(c.y, 500);
  assert.equal(objects.coins.coins.length, 3 + 8);
});

test('a coin under a low ceiling hangs clear of it', () => {
  const layout = { ...LAYOUT, COINS: [{ x: 0, z: 0, y: 150 }, { x: 300, z: 0 }], RED_COINS: [] };
  const { objects } = setup(layout, flatWorld(0, 4000, { y: 100, size: 1000 }));
  assert.deepEqual(objects.coins.coins.map((c) => c.y), [40, 40]);
});

test('a coin is collected exactly once', () => {
  const { player, log, step } = setup();
  player.pos = { x: 20, y: 0, z: 30 };
  step(3);
  assert.deepEqual(player.coinCalls, [1]);
  const coinEvents = log.filter((l) => l.name === 'coin');
  assert.equal(coinEvents.length, 1);
  assert.equal(coinEvents[0].e.red, false);
  assert.equal(coinEvents[0].e.value, 1);
  assert.deepEqual(coinEvents[0].e.pos, { x: 0, y: COIN_HOVER, z: 0 });
});

test('pickup respects the horizontal radius and vertical window', () => {
  const { player, step } = setup();
  player.pos = { x: 0, y: 0, z: PICKUP_RADIUS + 15 }; // too far sideways
  step();
  player.pos = { x: 600, y: 0, z: 0 }; // coin at y=500 is more than 200 above the feet
  step();
  player.pos = { x: 0, y: 150, z: 0 }; // coin at 60 is more than 40 below the feet
  step();
  assert.equal(player.coins, 0);
  player.pos = { x: 600, y: 320, z: 0 };
  step();
  assert.equal(player.coins, 1);
});

test('a hero visibly overlapping a coin collects it', () => {
  // Hero body radius 50 + coin disc radius ~42: centres 90 apart overlap on screen.
  const { player, step } = setup();
  player.pos = { x: 64, y: 0, z: 64 };
  step();
  assert.equal(player.coins, 1);
});

test('red coins count up, complete the set once and spawn the star', () => {
  const { objects, player, log, step } = setup();
  REDS.forEach((r, i) => {
    assert.equal(objects.star.state, 'hidden', `no star before red coin ${i + 1}`);
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  });
  const reds = log.filter((l) => l.name === 'coin' && l.e.red);
  assert.deepEqual(reds.map((l) => l.e.index), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(reds.every((l) => l.e.value === 2));
  assert.equal(player.coins, 16);
  assert.equal(log.filter((l) => l.name === 'redCoinsComplete').length, 1);
  assert.equal(objects.star.state, 'rising');
  step(10);
  assert.equal(log.filter((l) => l.name === 'redCoinsComplete').length, 1);
});

test('the star rises to its spot and is collected by touching it', () => {
  const { objects, player, log, step } = setup();
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  // Standing under the rising star does not collect it.
  player.pos = { x: 0, y: 200, z: -1500 };
  step(20);
  assert.equal(player.stars, 0);
  player.pos = { x: 1000, y: 0, z: -1500 };
  step(60);
  assert.equal(objects.star.state, 'idle');
  const s = objects.star.pos;
  assert.ok(Math.abs(s.x) < 1e-6 && Math.abs(s.y - 400) < 1e-6 && Math.abs(s.z + 1500) < 1e-6);
  assert.equal(player.stars, 0);
  player.pos = { x: 40, y: 200, z: -1480 };
  step();
  assert.equal(player.stars, 1);
  const got = log.filter((l) => l.name === 'starCollected');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].e.pos, { x: 0, y: 400, z: -1500 });
  assert.equal(objects.star.mesh.visible, false);
  step(30);
  assert.equal(player.stars, 1);
});

test('a standing jump under a low star reaches it with margin', () => {
  // Real layout: STAR.y 610 over a floor at 160; a standing jump peaks at feet ~370.
  const { objects, player, step } = setup({ ...LAYOUT, STAR: { x: 0, y: 610, z: -1500 } });
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  player.pos = { x: 1000, y: 0, z: -1500 };
  step(80);
  assert.equal(objects.star.state, 'idle');
  player.pos = { x: 30, y: 350, z: -1500 }; // 20 short of the jump's peak
  step();
  assert.equal(player.stars, 1);
});

test('the star is out of reach from the ground far below', () => {
  const { objects, player, step } = setup({ ...LAYOUT, STAR: { x: 0, y: 900, z: -1500 } });
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  player.pos = { x: 0, y: 0, z: -1500 };
  step(120);
  assert.equal(objects.star.state, 'idle');
  assert.equal(player.stars, 0);
});

test('butterflies flee from the hero and stay above the ground', () => {
  const { objects, player, step } = setup();
  step(30);
  const b = objects.butterflies.list[0];
  player.pos = { x: b.pos.x + 150, y: b.pos.y - 150, z: b.pos.z };
  const before = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
  step(30);
  const after = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
  assert.ok(after > before + 150, `fled from ${before.toFixed(0)} to ${after.toFixed(0)}`);
  for (const bf of objects.butterflies.list) assert.ok(bf.pos.y >= 60, 'above the ground');
});

test('the hidden 1-up emits oneUp once and disappears', () => {
  const { objects, player, log, step } = setup();
  assert.equal(objects.oneUp.pos.y, 90, 'hovers over the floor');
  player.pos = { x: 2500 + 90, y: 0, z: -2500 };
  step(5);
  const ups = log.filter((l) => l.name === 'oneUp');
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0].e, {});
  assert.equal(objects.oneUp.mesh.visible, false);
  assert.equal(player.coins, 0);
});

test('the 1-up defaults to a spot behind the castle', () => {
  const layout = { ...LAYOUT, ONE_UP: undefined, CASTLE: { x: 100, backZ: -3000 } };
  const { objects } = setup(layout);
  assert.equal(objects.oneUp.pos.x, 100);
  assert.ok(objects.oneUp.pos.z < -3000);
});

test('objects freeze while paused (no ticks, alpha keeps cycling)', () => {
  const { objects, step } = setup();
  step(40);
  objects.animate(0, 0.7, null);
  const snap = () => [
    ...objects.butterflies.positions.slice(0, 12),
    ...objects.coins.batch.uv.slice(0, 4),
    ...objects.birds.positions.slice(0, 9),
  ];
  const held = snap();
  for (const alpha of [0, 0.3, 0.5, 0.1, 0.7]) {
    objects.animate(0, alpha, null);
    assert.deepEqual(snap(), held, `alpha ${alpha}`);
  }
  // Play resumes normally after the next tick.
  step();
  objects.animate(0, 0, null);
  assert.notDeepEqual(snap(), held);
});

test('the first frame shows face-on coins and every butterfly', () => {
  const { objects } = setup();
  assert.deepEqual([...objects.coins.batch.uv.slice(0, 4)], coinFrameUV(COIN_FRAMES / 2, false));
  const wings = objects.butterflies.positions;
  for (let i = 0; i < wings.length; i += 3) assert.ok(wings[i] !== 0 || wings[i + 2] !== 0, `wing vertex ${i / 3} written`);
});

test('the title backdrop animates without pickups, and play carries on from it', () => {
  const { objects, player, step } = setup();
  player.pos = { x: 0, y: 0, z: 0 }; // standing on a coin
  const bird = objects.birds.birds[0].pos;
  const fly = objects.butterflies.list[0].pos;
  const start = { bird: { ...bird }, fly: { ...fly }, uv: objects.coins.batch.uv[0] };
  let last = null;
  for (let t = 20; t < 23; t += 1 / 60) {
    objects.animate(t, 0.3, null); // the caller's alpha is ignored here
    last = { ...bird };
  }
  assert.equal(player.coins, 0, 'no pickups behind the title');
  assert.ok(Math.abs(objects.tick - 90) <= 1, `ambient ticks ${objects.tick}`);
  assert.ok(Math.hypot(bird.x - start.bird.x, bird.z - start.bird.z) > 500, 'birds circle');
  assert.ok(Math.hypot(fly.x - start.fly.x, fly.z - start.fly.z) > 10, 'butterflies wander');
  assert.notEqual(objects.coins.batch.uv[0], start.uv, 'coins spin');
  // The first game tick picks the coin up and the clock continues without a jump.
  step();
  assert.equal(player.coins, 1);
  assert.ok(Math.hypot(bird.x - last.x, bird.y - last.y, bird.z - last.z) < 40, 'birds do not jump');
});

test('coin faces stay bright through the spin, symmetrically', () => {
  for (let k = 0; k < COIN_FRAMES; k++) {
    const phi = -Math.PI / 2 + ((k + 0.5) / COIN_FRAMES) * Math.PI;
    assert.ok(coinFaceShade(phi) >= 0.85, `frame ${k}`);
    assert.ok(Math.abs(coinFaceShade(phi) - coinFaceShade(-phi)) < 1e-9);
  }
});

test('bird normals are unit length and finite', () => {
  const { objects, step } = setup();
  step(3);
  const n = objects.birds.normals;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-4, `normal ${i / 3} length ${len}`);
  }
});

test('objects use at most 8 draw calls and finite geometry', () => {
  const { objects, step } = setup();
  step(5);
  let meshes = 0;
  objects.group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const p = o.geometry.attributes.position.array;
    assert.ok(p.every(Number.isFinite), `${o.type} positions finite`);
  });
  assert.ok(meshes <= 8, `${meshes} meshes`);
  assert.equal(objects.birds.birds.length >= 3 && objects.birds.birds.length <= 5, true);
  assert.equal(objects.butterflies.list.length, 3);
});

test('the real layout places every coin above the canonical ground', () => {
  const events = new Events();
  const collision = {
    findFloor: (x, y, z) => ({ y: realLayout.groundHeight(x, z), surface: { normal: { x: 0, y: 1, z: 0 } } }),
    findWalls: (x, y, z) => ({ x, z, walls: [] }),
    findCeil: () => ({ y: CEIL_NONE, surface: null }),
    waterLevelAt: realLayout.waterLevelAt,
  };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: realLayout, player: fakePlayer() });
  const coins = objects.coins.coins;
  assert.equal(coins.length, realLayout.COINS.length + realLayout.RED_COINS.length);
  assert.equal(objects.coins.redTotal, 8);
  for (const c of coins) {
    if (c.y !== undefined) assert.ok(Number.isFinite(c.y));
    const given = [...realLayout.COINS, ...realLayout.RED_COINS].find((k) => k.x === c.x && k.z === c.z)?.y;
    if (given === undefined) assert.ok(c.y >= realLayout.groundHeight(c.x, c.z) + COIN_HOVER - 1e-6);
  }
  assert.equal(objects.butterflies.list.length, realLayout.BUTTERFLY_SPOTS.length * 3);
});

// The per-tick and per-frame methods must not use what V8 allocates for in optimized code:
// Math.hypot and Math.max/min on doubles are called out of line (arguments and result boxed),
// iterators allocate below the top tier, and so do numbers passed to calls that are not
// inlined (hence SpriteBatch.push reads its sprite from batch.next).
test('hot object paths avoid allocating constructs', () => {
  const hot = {
    'Butterflies.update': Butterflies.prototype.update,
    'Butterflies.animate': Butterflies.prototype.animate,
    'Butterflies._probe': Butterflies.prototype._probe,
    'Butterflies._wanderTarget': Butterflies.prototype._wanderTarget,
    'Butterflies._pushOutOfWalls': Butterflies.prototype._pushOutOfWalls,
    'Birds.animate': Birds.prototype.animate,
    'Sparkles.animate': Sparkles.prototype.animate,
    'CoinField.animate': CoinField.prototype.animate,
    'CoinField.collect': CoinField.prototype.collect,
    'SpriteBatch.push': SpriteBatch.prototype.push,
    'ObjectManager._step': ObjectManager.prototype._step,
    'ObjectManager.animate': ObjectManager.prototype.animate,
    'ObjectManager._draw': ObjectManager.prototype._draw,
    'ObjectManager.ambient': ObjectManager.prototype.ambient,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
  assert.equal(SpriteBatch.prototype.push.length, 0, 'push() takes no numbers');
});

test('sparkles recycle a fixed pool of particle records', () => {
  const { objects, step } = setup();
  const sp = objects.sparkles;
  const pool = new Set(sp.parts);
  assert.equal(pool.size, sp.parts.length);
  // Far more sparkles than the pool holds, all in one tick: the extra ones are dropped.
  for (let i = 0; i < 40; i++) sp.burst({ x: 0, y: 100, z: 0 }, objects.time, TINT.coin);
  assert.equal(sp.count, sp.parts.length);
  objects.animate(0, 1, null);
  assert.ok(sp.batch.count <= sp.batch.capacity);
  step(60); // they expire; the 1-up keeps twinkling
  assert.ok(sp.count < 10, `${sp.count} live`);
  sp.burst({ x: 0, y: 100, z: 0 }, objects.time, TINT.red);
  assert.equal(sp.parts.length, pool.size);
  assert.ok(sp.parts.every((p) => pool.has(p)), 'no new particle records');
  objects.animate(0, 1, null);
  const n = sp.batch.count;
  assert.ok(n >= 8, `${n} sprites drawn`);
  const alpha = sp.batch.color;
  for (let i = 0; i < n; i++) assert.ok(alpha[i * 4 + 3] > 0 && Number.isFinite(sp.batch.pos[i * 3]), `sprite ${i}`);
});

test('butterflies query the water only over floors below the highest water surface', () => {
  const dry = flatWorld(0);
  let calls = 0;
  const waterLevelAt = dry.waterLevelAt.bind(dry);
  dry.waterLevelAt = (x, z) => {
    calls++;
    return waterLevelAt(x, z);
  };
  const { step } = setup({ ...LAYOUT, WATER_LEVEL: -20 }, dry);
  calls = 0;
  step(64);
  assert.equal(calls, 0, 'no water queries over dry land above the water level');

  // A deep pool: the butterflies fly over its surface, not its bed.
  const pool = flatWorld(-1000);
  pool.setWaterLevelFn(() => -20);
  const wet = setup({ ...LAYOUT, WATER_LEVEL: -20, groundHeight: () => -1000 }, pool);
  wet.step(120);
  for (const b of wet.objects.butterflies.list) {
    assert.equal(b.floor, -20);
    assert.ok(b.pos.y >= 40, `above the water (${b.pos.y.toFixed(0)})`);
  }
});

test('butterflies face their flight direction', () => {
  const { objects, player, step } = setup();
  step(40);
  const b = objects.butterflies.list[0];
  player.pos = { x: b.pos.x + 100, y: b.pos.y - 100, z: b.pos.z }; // make them flee
  step(20);
  for (const bf of objects.butterflies.list) {
    assert.ok(bf.yaw >= -Math.PI - 1e-9 && bf.yaw <= Math.PI + 1e-9, `yaw ${bf.yaw} wrapped`);
    if (Math.hypot(bf.vel.x, bf.vel.z) > 2) assert.ok(Math.abs(angleDiff(bf.yaw, Math.atan2(bf.vel.x, bf.vel.z))) < 0.3);
  }
});

test('coins keep one shape after pickups', () => {
  const { objects, player, step } = setup();
  player.pos = { x: REDS[0].x, y: 0, z: REDS[0].z };
  step();
  player.pos = { x: 0, y: 0, z: 0 };
  step();
  const keys = objects.coins.coins.map((c) => Object.keys(c).join());
  assert.equal(new Set(keys).size, 1, keys.join(' | '));
  assert.equal(objects.coins.coins.find((c) => c.red && !c.alive).index, 1);
});

test('the idle star needs no floor queries', () => {
  const layout = { ...LAYOUT, BUTTERFLY_SPOTS: [] };
  const collision = flatWorld();
  const { objects, player, step } = setup(layout, collision);
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  player.pos = { x: 1000, y: 0, z: 3000 };
  step(60);
  assert.equal(objects.star.state, 'idle');
  assert.equal(objects.starFloor.y, 0, 'shadow floor found');
  let calls = 0;
  const findFloor = collision.findFloor.bind(collision);
  collision.findFloor = (...a) => {
    calls++;
    return findFloor(...a);
  };
  step(30);
  assert.equal(calls, 0);
  assert.equal(objects.starFloor.y, 0);
});

// Whether blob shadow slot i is drawn (hidden slots hold a zero-scale matrix).
function shadowShown(objects, i) {
  const m = new THREE.Matrix4();
  objects.shadows.mesh.getMatrixAt(i, m);
  return m.elements[0] !== 0;
}

test('reset() brings back every pickup for a new game', () => {
  const { objects, player, log, step } = setup();
  const coinCount = objects.coins.coins.length;
  // Take a yellow coin, every red coin, the star and the 1-up.
  player.pos = { x: 0, y: 0, z: 0 };
  step();
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  player.pos = { x: 1000, y: 0, z: -1500 };
  step(60);
  player.pos = { x: 0, y: 300, z: -1500 };
  step();
  player.pos = { x: 2500, y: 0, z: -2500 };
  step();
  assert.equal(objects.star.state, 'collected');
  assert.equal(player.stars, 1);
  assert.equal(objects.oneUp.alive, false);
  assert.equal(objects.coins.coins.filter((c) => c.alive).length, coinCount - 9);
  assert.ok(objects.sparkles.count > 0);
  const tick = objects.tick;

  objects.reset();
  assert.ok(objects.coins.coins.every((c) => c.alive && c.index === 0), 'every coin back');
  assert.equal(objects.coins.redCollected, 0);
  assert.equal(objects.coins.allRedCollected, false);
  for (let i = 0; i < coinCount; i++) assert.ok(shadowShown(objects, i), `coin shadow ${i}`);
  assert.equal(objects.star.state, 'hidden');
  assert.equal(objects.star.mesh.visible, false);
  assert.equal(shadowShown(objects, objects.starShadow), false, 'no star shadow');
  assert.equal(objects.sparkles.glow.visible, false, 'no star glow');
  assert.equal(objects.oneUp.alive, true);
  assert.equal(objects.oneUp.mesh.visible, true);
  assert.ok(shadowShown(objects, objects.oneUpShadow), '1-up shadow');
  assert.equal(objects.sparkles.count, 0, 'sparkles cleared');
  assert.equal(player.stars, 0, 'the restored star is taken back off the count');
  assert.equal(objects.tick, tick, 'the clock keeps running');
  objects.animate(0, 1, null);
  assert.equal(objects.coins.batch.count, coinCount, 'every coin drawn');

  // Everything can be earned again, exactly as in the first game.
  log.length = 0;
  player.coins = 0;
  player.pos = { x: 0, y: 0, z: 0 };
  step();
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  assert.deepEqual(log.filter((l) => l.name === 'coin' && l.e.red).map((l) => l.e.index), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(player.coins, 17);
  assert.equal(log.filter((l) => l.name === 'redCoinsComplete').length, 1);
  assert.equal(objects.star.state, 'rising');
  player.pos = { x: 1000, y: 0, z: -1500 };
  step(60);
  player.pos = { x: 0, y: 300, z: -1500 };
  step();
  assert.equal(player.stars, 1, 'counted once');
  player.pos = { x: 2500, y: 0, z: -2500 };
  step();
  assert.equal(log.filter((l) => l.name === 'oneUp').length, 1);
  // A star count reset by the game as well never goes negative.
  player.stars = 0;
  objects.reset();
  assert.equal(player.stars, 0);
});

test('after reset() the objects run the backdrop again until play resumes, without a jump', () => {
  const { objects, player, step } = setup();
  step(200);
  const bird = objects.birds.birds[0].pos;
  objects.reset();
  player.pos = { x: 0, y: 0, z: 0 }; // on a coin: no pickups behind the title
  let prev = { ...bird };
  let maxJump = 0;
  for (let t = 500; t < 503; t += 1 / 60) {
    objects.animate(t, 1, null);
    maxJump = Math.max(maxJump, Math.hypot(bird.x - prev.x, bird.z - prev.z));
    prev = { ...bird };
  }
  assert.ok(Math.abs(objects.tick - 290) <= 1, `ambient ticks carry on from 200: ${objects.tick}`);
  assert.ok(maxJump < 40, `birds glide (largest step ${maxJump.toFixed(1)})`);
  assert.equal(player.coins, 0, 'no pickups behind the title');
  step();
  assert.equal(player.coins, 1, 'play picks the coin up');
  assert.ok(Math.hypot(bird.x - prev.x, bird.z - prev.z) < 40, 'birds do not jump into play');
});

test('ambient() keeps the objects moving behind a later title without a jump', () => {
  const { objects, player, step } = setup();
  step(100);
  const bird = objects.birds.birds[0].pos;
  let prev = { ...bird };
  let maxJump = 0;
  player.pos = { x: 0, y: 0, z: 0 };
  for (let t = 1000; t < 1002; t += 1 / 60) {
    const alpha = objects.ambient(t);
    assert.ok(alpha >= 0 && alpha <= 1);
    objects.animate(t, alpha, null);
    maxJump = Math.max(maxJump, Math.hypot(bird.x - prev.x, bird.z - prev.z));
    prev = { ...bird };
  }
  assert.ok(Math.abs(objects.tick - 160) <= 1, `ambient ticks ${objects.tick}`);
  assert.ok(maxJump < 40, `birds glide (largest step ${maxJump.toFixed(1)})`);
  assert.equal(player.coins, 0);
  // Play continues from the ambient clock; a later backdrop anchors afresh.
  step(30);
  objects.ambient(5000);
  assert.ok(Math.abs(objects.tick - 190) <= 1, `re-anchored at ${objects.tick}`);
});
