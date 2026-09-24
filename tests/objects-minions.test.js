// Robot lizard minions in node: spawn timing (10 s after the beast has fully risen, then every
// ~5 s), the cap of five, spawn spots (700..1600 from the hero, on land only, clear of walls and
// the castle door), the chase over the terrain and the shore, the wind-up and lunge-bite (1
// wedge with knockback once per lunge, then a cooldown; never while he is invincible or
// reading), defeat by an attack or a stomp (not by landing on one while knocked back), the
// wreck blast, coin drops, burrowing when the mode ends, reset(), the single draw call and the
// allocation rules of the hot paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { NO_WATER } from '../src/core/constants.js';
import { makeRng } from '../src/core/math.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Minions, MINION, heroInvincible } from '../src/objects/Minions.js';
import { MINION_RIG } from '../src/objects/minionModel.js';
import { BEAST } from '../src/objects/RobotBeast.js';

const SIZE = 30000;

// Flat floor at y = 0; water (surface 50 over a floor at -400) where x > waterFromX; an
// optional solid block (four walls and a top).
function world({ waterFromX = Infinity, block = null } = {}) {
  const w = new CollisionWorld();
  const floor = (x0, x1, y) => w.addTriangles([x0, y, SIZE, x1, y, SIZE, x1, y, -SIZE, x0, y, SIZE, x1, y, -SIZE, x0, y, -SIZE]);
  if (Number.isFinite(waterFromX)) {
    floor(-SIZE, waterFromX, 0);
    floor(waterFromX, SIZE, -400);
    // The bank: a wall facing +X down from the lawn to the moat floor.
    w.addTriangles([waterFromX, -400, SIZE, waterFromX, -400, -SIZE, waterFromX, 0, -SIZE, waterFromX, -400, SIZE, waterFromX, 0, -SIZE, waterFromX, 0, SIZE]);
  } else {
    floor(-SIZE, SIZE, 0);
  }
  if (block) {
    const { x0, x1, z0, z1, h } = block;
    // Four outward walls of a tall block.
    w.addTriangles([x1, 0, z0, x1, h, z0, x1, h, z1, x1, 0, z0, x1, h, z1, x1, 0, z1]);
    w.addTriangles([x0, 0, z0, x0, 0, z1, x0, h, z1, x0, 0, z0, x0, h, z1, x0, h, z0]);
    w.addTriangles([x0, 0, z1, x1, 0, z1, x1, h, z1, x0, 0, z1, x1, h, z1, x0, h, z1]);
    w.addTriangles([x0, 0, z0, x0, h, z0, x1, h, z0, x0, 0, z0, x1, h, z0, x1, 0, z0]);
    // And its flat top (a floor).
    w.addTriangles([x0, h, z0, x0, h, z1, x1, h, z1, x0, h, z0, x1, h, z1, x1, h, z0]);
  }
  w.setWaterLevelFn((x) => (x > waterFromX ? 50 : NO_WATER));
  w.finalize();
  return w;
}

function fakeFx() {
  const log = [];
  return { log, explode: (x, y, z, o) => log.push({ x, y, z, ...o }), ignite: () => 1, extinguish() {}, clearFires() {} };
}

function fakePlayer(x = 0, y = 0, z = 0) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    faceYaw: 0,
    tick: 0,
    invincibleUntil: 0,
    coins: 0,
    stars: 0,
    hits: [],
    bounces: 0,
    attack: null,
    floor: { y: 0, surface: {} },
    takeDamage(n, from) {
      if (this.tick < this.invincibleUntil) return false;
      this.hits.push({ n, from: { ...from } });
      this.invincibleUntil = this.tick + 60;
      return true;
    },
    getAttack() {
      return this.attack;
    },
    bounce() {
      this.bounces++;
      return true;
    },
    collectCoin(v) {
      this.coins += v;
    },
    collectStar() {},
  };
}

// A Minions swarm on its own (no beast): `active` is passed straight in.
function swarm({ collision = world(), layout = {}, rng = makeRng(7), groundAt = () => 0 } = {}) {
  const events = new Events();
  const log = [];
  events.on('sfx', (e) => log.push(e.name));
  const fx = fakeFx();
  const coins = [];
  const minions = new Minions({ collision, events, fx, rng, layout, groundAt, onCoin: (x, y, z) => coins.push({ x, y, z }) });
  let tick = 0;
  const step = (player, n = 1, active = true) => {
    for (let i = 0; i < n; i++) {
      player.tick++;
      minions.update(player, null, ++tick, active);
      minions.animate(1, tick / 30, null);
    }
  };
  return { minions, events, log, fx, coins, step, collision };
}

const live = (minions) => minions.list.filter((m) => m.state !== 'free');

test('first minion 10 s after the beast has fully risen, then one every ~5 s, never more than five', () => {
  const events = new Events();
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9; // keep them from biting (they then only crowd round)
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { KAIJU: { x: 0, z: -9000, yaw: 0 }, groundHeight: () => 0 }, player, fx: fakeFx(), level: { trees: [], addScorch() {} } });
  const emerges = [];
  events.on('sfx', (e) => e.name === 'minion_emerge' && emerges.push(objects.tick));
  events.emit('darkMode', { on: true });
  let risenAt = null;
  let most = 0;
  for (let t = 0; t < BEAST.RISE_TICKS + 300 + 150 * 9; t++) {
    player.tick++;
    objects.update({ player });
    if (risenAt === null && objects.beast.state === 'active') risenAt = objects.tick;
    most = Math.max(most, objects.minions.alive);
  }
  assert.ok(risenAt !== null);
  assert.equal(emerges[0], risenAt + MINION.FIRST_DELAY - 1, 'first one 10 s after the beast is up');
  for (let i = 1; i < 5; i++) {
    const gap = emerges[i] - emerges[i - 1];
    assert.ok(gap >= MINION.EVERY[0] && gap <= MINION.EVERY[1], `gap ${gap}`);
  }
  assert.equal(most, MINION.MAX_ALIVE);
  assert.equal(emerges.length, MINION.MAX_ALIVE, 'no more while five are about');
});

test('no minions before the beast has risen, nor in normal mode', () => {
  const events = new Events();
  const player = fakePlayer();
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { KAIJU: { x: 0, z: -9000, yaw: 0 }, groundHeight: () => 0 }, player, fx: fakeFx(), level: { trees: [] } });
  for (let t = 0; t < 900; t++) objects.update({ player });
  assert.equal(objects.minions.spawned, 0);
  events.emit('darkMode', { on: true });
  for (let t = 0; t < BEAST.RISE_TICKS + MINION.FIRST_DELAY - 5; t++) objects.update({ player });
  assert.equal(objects.minions.spawned, 0);
});

test('spawn spots are 700..1600 from the hero, on land, clear of walls and the castle door', () => {
  const block = { x0: -1200, x1: -700, z0: -300, z1: 300, h: 600 };
  const layout = { CASTLE: { x: 0, frontZ: -1200 }, regionAt: (x, z) => (z > 1500 ? 'cliff' : 'lawn') };
  const { minions } = swarm({ collision: world({ waterFromX: 600, block }), layout });
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  const spots = [];
  for (let k = 0; k < 60; k++) {
    minions.clear();
    if (minions._trySpawn(player)) spots.push({ ...live(minions)[0] });
  }
  assert.ok(spots.length > 40, `${spots.length} spawns`);
  for (const m of spots) {
    const d = Math.hypot(m.x, m.z);
    assert.ok(d >= MINION.SPAWN_MIN - 1 && d <= MINION.SPAWN_MAX + 1, `distance ${d}`);
    assert.ok(m.x < 600, `not in the water: x ${m.x}`);
    assert.ok(m.z <= 1500, 'region lawn only');
    assert.ok(Math.hypot(m.x, m.z + 1200) >= MINION.DOOR_CLEAR, 'not at the door');
    const inBlock = m.x > block.x0 - MINION.CLEARANCE && m.x < block.x1 + MINION.CLEARANCE && m.z > block.z0 - MINION.CLEARANCE && m.z < block.z1 + MINION.CLEARANCE;
    assert.ok(!inBlock, `clear of walls: ${m.x}, ${m.z}`);
  }
  assert.equal(minions.spawnFloor(900, 0), null, 'water');
  assert.equal(minions.spawnFloor(-950, 0), null, 'inside a block');
  assert.ok(minions.spawnFloor(-300, 900), 'open lawn');
});

test('they burst out of the ground, then skitter after the hero at 12..16 per tick', () => {
  const { minions, step, log } = swarm();
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  const m = minions.spawnAt(1500, 0, -Math.PI / 2);
  assert.ok(log.includes('minion_emerge'));
  assert.equal(m.sink, -MINION.DEPTH);
  step(player, MINION.EMERGE);
  assert.equal(m.state, 'walk');
  assert.equal(m.sink, 0);
  const x0 = m.x;
  step(player, 30);
  const v = (x0 - m.x) / 30;
  assert.ok(v >= MINION.SPEED[0] * 0.8 && v <= MINION.SPEED[1] + 0.5, `speed ${v}`);
  step(player, 120);
  assert.ok(Math.hypot(m.x, m.z) < MINION.STOP + 30, 'reached the hero');
  assert.equal(m.y, 0, 'on the floor');
});

test('water stops them: they turn away at the shore and never step in', () => {
  const { minions, step } = swarm({ collision: world({ waterFromX: 400 }) });
  const player = fakePlayer(1500, 50, 0); // swimming out in the water
  const m = minions.spawnAt(-600, 0, Math.PI / 2);
  let maxX = -Infinity;
  for (let t = 0; t < 400; t++) {
    step(player);
    maxX = Math.max(maxX, m.x);
  }
  assert.ok(maxX <= 400, `max x ${maxX}`);
  assert.ok(maxX > 250, 'came down to the shore');
  assert.equal(m.state, 'walk');
});

test('walls push them out', () => {
  const block = { x0: -200, x1: 200, z0: 400, z1: 800, h: 600 };
  const { minions, step } = swarm({ collision: world({ block }) });
  const player = fakePlayer(0, 0, 2000);
  player.invincibleUntil = 1e9;
  const m = minions.spawnAt(0, -400, 0);
  for (let t = 0; t < 300; t++) {
    step(player);
    const inside = m.x > block.x0 + 5 && m.x < block.x1 - 5 && m.z > block.z0 + 5 && m.z < block.z1 - 5;
    assert.ok(!inside, `inside the block at ${m.x}, ${m.z}`);
  }
  assert.ok(m.z > block.z1, 'found its way round');
});

test('within reach they wind up and lunge: 1 wedge with knockback, once per lunge, then a cooldown', () => {
  const { minions, step, log } = swarm();
  const player = fakePlayer(0, 0, 0);
  const m = minions.spawnAt(0, -600, 0);
  let windup = -1;
  let lunge = -1;
  for (let t = 0; t < 200 && player.hits.length === 0; t++) {
    step(player);
    if (windup < 0 && m.state === 'windup') windup = t;
    if (lunge < 0 && m.state === 'lunge') lunge = t;
  }
  assert.ok(windup >= 0 && lunge - windup === MINION.WINDUP, 'wind-up, then the lunge');
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].n, 1);
  assert.ok(player.hits[0].from.z < 0, 'knocked back away from the minion');
  assert.ok(log.includes('minion_bite'));
  step(player, 12);
  assert.equal(player.hits.length, 1, 'one bite per lunge');
  // The cooldown: no new wind-up right after the recovery.
  const until = MINION.RECOVER + MINION.COOLDOWN;
  let again = -1;
  for (let t = 0; t < until + 60 && again < 0; t++) {
    step(player);
    if (m.state === 'windup') again = t;
  }
  assert.ok(again >= MINION.COOLDOWN - 12, `next wind-up after ${again} ticks`);
});

test('no bites while he blinks after a hit, reads a sign or drops in', () => {
  for (const setup of [(p) => (p.invincibleUntil = 1e9), (p) => (p.action = 'reading'), (p) => (p.action = 'spawn')]) {
    const { minions, step } = swarm();
    const player = fakePlayer(0, 0, 0);
    setup(player);
    minions.spawnAt(0, -500, 0);
    step(player, 300);
    assert.equal(player.hits.length, 0);
    assert.ok(!live(minions).some((m) => m.state === 'windup' || m.state === 'lunge'));
  }
  assert.equal(heroInvincible({ tick: 3, invincibleUntil: 10 }), true);
  assert.equal(heroInvincible({ invincible: false, tick: 3, invincibleUntil: 10 }), false);
});

test('while a dialog is up (Pip frozen) they neither bite nor close in; the beast holds its fire', () => {
  const events = new Events();
  const player = fakePlayer(0, 0, 0);
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { KAIJU: { x: 0, z: -9000, yaw: 0 }, groundHeight: () => 0 }, player, fx: fakeFx(), level: { trees: [] } });
  const m = objects.minions.spawnAt(0, -500, 0);
  events.emit('signRead', { sign: { id: 'castle_locked', pages: ['x'] } });
  for (let t = 0; t < 200; t++) {
    player.tick++;
    objects.update({ player });
  }
  assert.equal(player.hits.length, 0);
  assert.ok(Math.hypot(m.x, m.z) >= MINION.HOLD_OFF - 20, `kept its distance: ${Math.hypot(m.x, m.z)}`);
  assert.ok(objects.beast.grace > 0);
  events.emit('dialogClosed', { sign: { id: 'castle_locked' } });
  for (let t = 0; t < 200 && player.hits.length === 0; t++) {
    player.tick++;
    objects.update({ player });
  }
  assert.equal(player.hits.length, 1, 'back on the attack');
});

test('an attack touching one wrecks it: flip, blast (fx.explode radius 120), sfx, then gone', () => {
  const { minions, step, log, fx } = swarm();
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  const m = minions.spawnAt(0, -400, 0);
  step(player, MINION.EMERGE + 5);
  player.attack = { x: m.x, y: m.y + 60, z: m.z + 170, radius: 40, kind: 'punch' };
  step(player);
  assert.equal(m.state, 'walk', 'out of reach');
  player.attack = { x: m.x, y: m.y + 40, z: m.z + 90, radius: 40, kind: 'punch' };
  step(player);
  player.attack = null;
  assert.equal(m.state, 'wrecked');
  assert.equal(minions.wrecks, 1);
  assert.ok(log.includes('minion_wreck'));
  assert.equal(fx.log.length, 1);
  assert.equal(fx.log[0].radius, 120);
  step(player, MINION.FLIP_TICKS + 2);
  assert.ok(Math.abs(m.roll - Math.PI) < 1e-6, 'on its back');
  assert.equal(m.power, 0, 'eyes out');
  step(player, MINION.WRECK + MINION.VANISH);
  assert.equal(m.state, 'free');
  assert.equal(minions.alive, 0);
});

test('a stomp (falling onto its back) bounces the hero and wrecks it; landing on it while knocked back does not', () => {
  for (const [action, wrecked] of [['fall', true], ['ground_pound', true], ['hurt', false]]) {
    const { minions } = swarm();
    const player = fakePlayer(0, 0, 0);
    player.invincibleUntil = 1e9;
    const m = minions.spawnAt(0, -400, 0);
    let tick = 0;
    for (let t = 0; t < MINION.EMERGE + 2; t++) minions.update(player, null, ++tick, true);
    player.action = action;
    const top = m.y + MINION_RIG.BACK;
    const hero = { y: top + 40, vy: -30, air: true };
    player.pos = { x: m.x + 10, y: top - 5, z: m.z + 20 };
    player.vel = { x: 0, y: -34, z: 0 };
    minions.update(player, hero, ++tick, true);
    assert.equal(m.state === 'wrecked', wrecked, action);
    assert.equal(player.bounces, wrecked ? 1 : 0);
  }
  // Walking past it on the ground is no stomp.
  const { minions } = swarm();
  const player = fakePlayer(0, 0, 0);
  const m = minions.spawnAt(0, -400, 0);
  let tick = 0;
  for (let t = 0; t < MINION.EMERGE + 2; t++) minions.update(player, null, ++tick, true);
  player.pos = { x: m.x, y: 0, z: m.z };
  minions.update(player, { y: 0, vy: 0, air: false }, ++tick, true);
  assert.notEqual(m.state, 'wrecked');
});

test('about 30 % of wrecks drop a yellow coin where they vanish; the hero can pick it up', () => {
  const { minions, step, coins } = swarm({ rng: makeRng(99) });
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  let wrecks = 0;
  for (let k = 0; k < 60; k++) {
    const m = minions.spawnAt(0, -400, 0);
    step(player, MINION.EMERGE + 1);
    minions._wreck(m, player, false);
    wrecks++;
    step(player, MINION.WRECK + MINION.VANISH + 2);
  }
  assert.ok(coins.length >= wrecks * 0.15 && coins.length <= wrecks * 0.45, `${coins.length} coins from ${wrecks}`);
  // Through ObjectManager: the drop becomes a real coin.
  const events = new Events();
  const got = [];
  events.on('coin', (e) => got.push(e));
  const hero = fakePlayer(0, 0, 3000);
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { KAIJU: { x: 0, z: -9000, yaw: 0 }, groundHeight: () => 0 }, player: hero, fx: fakeFx(), level: { trees: [] } });
  objects.spawnCoin(500, 0, 500);
  objects.update({ player: hero });
  assert.equal(got.length, 0);
  hero.pos = { x: 500, y: 0, z: 500 };
  objects.update({ player: hero });
  assert.equal(got.length, 1);
  assert.equal(hero.coins, 1);
  objects.reset();
  assert.ok(objects.coins.drops.every((c) => !c.alive), 'drops do not come back');
});

test('when the mode ends they burrow back down; reset() clears them at once', () => {
  const { minions, step } = swarm();
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  step(player, 1, true);
  for (const x of [-800, 0, 800]) minions.spawnAt(x, -900, 0);
  step(player, 40, true);
  assert.equal(minions.alive, 3);
  step(player, 1, false);
  assert.ok(live(minions).every((m) => m.state === 'burrow'));
  step(player, MINION.BURROW + 1, false);
  assert.equal(live(minions).length, 0);
  assert.equal(minions.mesh.visible, false);
  // reset
  minions.spawnAt(0, -900, 0);
  step(player, 5, true);
  minions.clear();
  assert.equal(live(minions).length, 0);
  assert.equal(minions.activeTicks, 0);
  minions.animate(1, 0, null);
  assert.equal(minions.mesh.count, 0);
});

test('ObjectManager.reset() takes the minions away; the mode switching off sends them home', () => {
  const events = new Events();
  const player = fakePlayer();
  player.invincibleUntil = 1e9;
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { KAIJU: { x: 0, z: -9000, yaw: 0 }, groundHeight: () => 0 }, player, fx: fakeFx(), level: { trees: [] } });
  events.emit('darkMode', { on: true });
  for (let t = 0; t < BEAST.RISE_TICKS + MINION.FIRST_DELAY + 40; t++) objects.update({ player });
  assert.equal(objects.minions.alive, 1);
  events.emit('darkMode', { on: false });
  objects.update({ player });
  assert.equal(live(objects.minions)[0].state, 'burrow');
  objects.reset();
  assert.equal(live(objects.minions).length, 0);
});

test('all minions are one draw call', () => {
  const { minions, step } = swarm();
  const player = fakePlayer(0, 0, 0);
  player.invincibleUntil = 1e9;
  for (let i = 0; i < 5; i++) minions.spawnAt(Math.cos(i) * 900, Math.sin(i) * 900, 0);
  step(player, 30);
  let meshes = 0;
  minions.mesh.traverseVisible((o) => {
    if (o.isMesh) meshes++;
  });
  assert.equal(meshes, 1);
  assert.equal(minions.mesh.count, 5);
  assert.ok(minions.mesh.isInstancedMesh);
  const pos = minions.mesh.geometry.attributes.position.array;
  assert.ok(pos.every(Number.isFinite));
  // About 225 long, low to the ground.
  minions.mesh.geometry.computeBoundingBox();
  const bb = minions.mesh.geometry.boundingBox;
  const len = bb.max.z - bb.min.z;
  assert.ok(len > 200 && len < 250, `length ${len}`);
  assert.ok(bb.max.y < 70, `height ${bb.max.y}`);
});

test('minion hot paths avoid allocating constructs', () => {
  const hot = {
    'Minions.update': Minions.prototype.update,
    'Minions._chase': Minions.prototype._chase,
    'Minions._move': Minions.prototype._move,
    'Minions._lunge': Minions.prototype._lunge,
    'Minions._bites': Minions.prototype._bites,
    'Minions._struck': Minions.prototype._struck,
    'Minions._stomped': Minions.prototype._stomped,
    'Minions._wrecked': Minions.prototype._wrecked,
    'Minions.animate': Minions.prototype.animate,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
});
