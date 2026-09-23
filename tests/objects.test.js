// ObjectManager logic in node (no canvas): coin pickups, red coins -> star, star and 1-up
// pickups, butterflies fleeing, pause freeze, draw-call budget, placement on the real layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as realLayout from '../src/world/layout.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { COIN_HOVER, PICKUP_RADIUS } from '../src/objects/CoinField.js';
import { coinFaceShade, COIN_FRAMES } from '../src/objects/textures.js';

function flatWorld(y = 0, size = 4000) {
  const w = new CollisionWorld();
  w.addTriangles([-size, y, size, size, y, size, size, y, -size, -size, y, size, size, y, -size, -size, y, -size]);
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

function setup(layout = LAYOUT) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'redCoinsComplete', 'starCollected', 'oneUp', 'sfx']) events.on(name, (e) => log.push({ name, e }));
  const player = fakePlayer();
  const scene = new THREE.Scene();
  const objects = new ObjectManager({ scene, collision: flatWorld(), events, layout, player });
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
