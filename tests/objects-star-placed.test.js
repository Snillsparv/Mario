// A course's star (layout.STAR.placed): it waits idle on its spot from the start, with its
// shadow, and can be taken on the first tick without any red coins; taking it sends
// 'starCollected' { pos, id, area }; reset() (GAME OVER) puts it back and takes it off the
// hero's count. The red-coin star of the grounds names its area too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';

// Square floor at height y over x, z in [-size, size].
function flatWorld(y = 0, size = 4000) {
  const w = new CollisionWorld();
  w.addTriangles([-size, y, size, size, y, size, size, y, -size, -size, y, size, size, y, -size, -size, y, -size]);
  w.finalize();
  return w;
}

const STAR = Object.freeze({ id: 'test_star', x: 400, y: 300, z: -800, placed: true });

function fakePlayer(x = 3000, y = 0, z = 3000) {
  return {
    pos: { x, y, z },
    coins: 0,
    stars: 0,
    collectCoin(v) {
      this.coins += v;
    },
    collectStar() {
      this.stars++;
    },
  };
}

function setup(layout, area) {
  const events = new Events();
  const log = [];
  for (const name of ['redCoinsComplete', 'starCollected']) events.on(name, (e) => log.push({ name, e }));
  const player = fakePlayer();
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: flatWorld(), events, layout: { groundHeight: () => 0, ...layout }, player, area });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      objects.update({ player });
      objects.animate(0, 1, null);
    }
  };
  const got = (name) => log.filter((l) => l.name === name).map((l) => l.e);
  return { objects, player, step, got };
}

// Where the star's shadow is drawn (y) and how big (0 = hidden).
function starShadow(objects) {
  const m = new THREE.Matrix4();
  objects.shadows.mesh.getMatrixAt(objects.starShadow, m);
  const e = m.elements;
  return { y: e[13], size: Math.hypot(e[0], e[1], e[2]) };
}

test('a placed star waits idle on its spot from the start, with its shadow', () => {
  const { objects } = setup({ STAR }, 'skerries');
  const star = objects.star;
  assert.equal(star.state, 'idle');
  assert.equal(star.mesh.visible, true);
  assert.deepEqual({ ...star.pos }, { x: STAR.x, y: STAR.y, z: STAR.z });
  assert.deepEqual({ ...star.prev }, { ...star.pos });
  assert.deepEqual(star.mesh.position.toArray(), [STAR.x, STAR.y, STAR.z], 'drawn there before the first tick');
  assert.equal(star.mesh.scale.x, 1, 'full size');
  const shadow = starShadow(objects);
  assert.ok(shadow.size > 0 && Math.abs(shadow.y) < 5, `shadow on the floor (${shadow.y.toFixed(1)}, ${shadow.size.toFixed(0)})`);
});

test('it can be taken on the first tick, without red coins, and names its id and area', () => {
  const { objects, player, step, got } = setup({ STAR }, 'skerries');
  player.pos = { x: STAR.x + 30, y: STAR.y - 160, z: STAR.z };
  step();
  assert.equal(player.stars, 1);
  assert.equal(objects.star.state, 'collected');
  assert.equal(objects.star.mesh.visible, false);
  assert.deepEqual(got('starCollected'), [{ pos: { x: STAR.x, y: STAR.y, z: STAR.z }, id: 'test_star', area: 'skerries' }]);
  assert.equal(got('redCoinsComplete').length, 0, 'no appearance (and so no jingle)');
  step(30);
  assert.equal(player.stars, 1, 'once');
  assert.equal(starShadow(objects).size, 0, 'its shadow goes with it');
});

test('out of reach it just waits there', () => {
  const { objects, player, step } = setup({ STAR }, 'skerries');
  player.pos = { x: STAR.x, y: 0, z: STAR.z }; // right below, feet 300 down
  step(90);
  assert.equal(objects.star.state, 'idle');
  assert.equal(player.stars, 0);
});

test('reset() puts it back on its spot and takes it off the count', () => {
  const { objects, player, step, got } = setup({ STAR }, 'skerries');
  player.pos = { x: STAR.x, y: STAR.y - 100, z: STAR.z };
  step();
  assert.equal(player.stars, 1);
  objects.reset();
  assert.equal(player.stars, 0, 'taken back');
  assert.equal(objects.star.state, 'idle');
  assert.equal(objects.star.mesh.visible, true);
  assert.deepEqual({ ...objects.star.pos }, { x: STAR.x, y: STAR.y, z: STAR.z });
  objects.animate(0, 1, null); // (the title behind GAME OVER draws it)
  assert.ok(starShadow(objects).size > 0, 'with its shadow');
  step();
  assert.equal(player.stars, 1, 'and it can be won again');
  assert.equal(got('starCollected').length, 2);
  // A reset before it was taken changes nothing of the count.
  objects.reset();
  objects.reset();
  assert.equal(player.stars, 0);
  assert.equal(objects.star.state, 'idle');
});

test('the grounds red-coin star says where it was won', () => {
  const REDS = Array.from({ length: 8 }, (_, i) => ({ x: -1400 + i * 400, z: 1500 }));
  const { objects, player, step, got } = setup({ RED_COINS: REDS, STAR: { x: 0, y: 400, z: -1500 } });
  assert.equal(objects.area, 'grounds', 'the default area');
  assert.equal(objects.star.state, 'hidden', 'not placed: hidden until the red coins are in');
  for (const r of REDS) {
    player.pos = { x: r.x, y: 0, z: r.z };
    step();
  }
  player.pos = { x: 1000, y: 0, z: -1500 };
  step(60);
  player.pos = { x: 0, y: 250, z: -1500 };
  step();
  assert.deepEqual(got('starCollected'), [{ pos: { x: 0, y: 400, z: -1500 }, id: null, area: 'grounds' }]);
});
