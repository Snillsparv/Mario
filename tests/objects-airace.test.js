// AI RACE mode objects in node: the floor button (only a ground-pound landing on its cap toggles
// the mode, the cap and the floor under the hero sink and pop back up, the cap reads "AI RACE"
// or "STOP"), the robot lizard (rises on 'darkMode', roars, tracks, shoots, sinks and hides; no
// colliders), the fireballs (ballistic
// aim, pool, expiry, ground / water / hero / tree impacts, blast and fire-zone damage, burning
// trees), setDarkness, reset() and the draw-call budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { NO_WATER } from '../src/core/constants.js';
import { makeRng } from '../src/core/math.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { AiButton, BUTTON } from '../src/objects/AiButton.js';
import { CAP_LABELS, hasGlyphs, lineCells } from '../src/objects/aiRaceTextures.js';
import { RobotBeast, BEAST, SHOT, aimVelocity, flightTicks } from '../src/objects/RobotBeast.js';
import { Fireballs, FIREBALL } from '../src/objects/Fireballs.js';
import { FireSprites } from '../src/objects/FireSprites.js';

const SIZE = 30000;

// A flat floor at y = 0, optionally with water (surface 50) where x > waterFromX.
function flatWorld({ waterFromX = Infinity } = {}) {
  const w = new CollisionWorld();
  w.addTriangles([-SIZE, 0, SIZE, SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, -SIZE]);
  w.setWaterLevelFn((x) => (x > waterFromX ? 50 : NO_WATER));
  w.finalize();
  return w;
}

function fakeFx() {
  let id = 1;
  const log = [];
  return {
    log,
    explode: (x, y, z, o) => log.push({ fn: 'explode', x, y, z, ...o }),
    ignite: (x, y, z, o) => {
      log.push({ fn: 'ignite', id, x, y, z, ...o });
      return id++;
    },
    extinguish: (i) => log.push({ fn: 'extinguish', id: i }),
    clearFires: () => log.push({ fn: 'clearFires' }),
  };
}

function fakePlayer(x = 0, y = 0, z = 6000) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    coins: 0,
    stars: 0,
    hits: [],
    takeDamage(n, from, opts) {
      this.hits.push({ n, from: { ...from }, opts });
      return true;
    },
    collectCoin() {},
    collectStar() {},
  };
}

const BTN = { x: 0, z: 3000, radius: 140 };
const TREES = [
  { x: 2000, z: 2000, groundY: 0, trunkTop: 600, canopy: { x: 2000, y: 800, z: 2000, radius: 350 } },
  { x: 2250, z: 2100, groundY: 0, trunkTop: 600, canopy: { x: 2250, y: 800, z: 2100, radius: 300 } },
  { x: -3000, z: 2000, groundY: 0, trunkTop: 600, canopy: { x: -3000, y: 800, z: 2000, radius: 350 } },
];

// ObjectManager on a flat world with the button and the beast; `main` mimics main.js's answer
// to 'aiRaceButton' (it emits 'darkMode').
function setup({ main = true, collision = flatWorld(), trees = TREES, player = fakePlayer() } = {}) {
  const events = new Events();
  const log = [];
  for (const name of ['sfx', 'aiRaceButton', 'darkMode', 'kaijuRoar']) events.on(name, (e) => log.push({ name, e }));
  if (main) events.on('aiRaceButton', ({ on }) => events.emit('darkMode', { on }));
  const fx = fakeFx();
  const scorches = [];
  const level = { trees, addScorch: (x, z, r) => scorches.push({ x, z, r }) };
  const layout = { AI_BUTTON: BTN, KAIJU: { x: 0, z: -2000, yaw: 0 }, groundHeight: () => 0, WATER_LEVEL: 50 };
  const scene = new THREE.Scene();
  const objects = new ObjectManager({ scene, collision, events, layout, player, fx, level });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      objects.update({ player });
      objects.animate(0, 1, null);
    }
  };
  const sfx = (name) => log.filter((l) => l.name === 'sfx' && l.e.name === name);
  return { objects, player, events, log, fx, scorches, step, sfx, collision, scene };
}

const pounds = (log) => log.filter((l) => l.name === 'aiRaceButton');

// ---------------------------------------------------------------- button

test('the button stands on the ground with a walkable collider', () => {
  const { objects, collision } = setup();
  const b = objects.button;
  assert.ok(b.baseTop - 0 <= BUTTON.BASE_HEIGHT + 1e-6 && b.baseTop > 0, `base top ${b.baseTop}`);
  assert.equal(b.capTop0, b.baseTop + BUTTON.CAP_HEIGHT);
  assert.equal(collision.findFloor(BTN.x, 500, BTN.z).y, b.capTop0, 'flat cap top');
  assert.equal(collision.findFloor(BTN.x + 130, 500, BTN.z).y, b.baseTop, 'base ring');
  // Side walls around it (a low flying body is pushed out).
  const walls = collision.findWalls(BTN.x + BTN.radius + 10, 10, BTN.z, 0, 30);
  assert.ok(walls.walls.length > 0 && walls.x > BTN.x + BTN.radius + 10);
  // The knee probe (30 up) clears the base, so the hero walks on from the lawn.
  assert.ok(b.baseTop < 30);
});

test('walking and jumping onto the button does nothing; a ground pound landing on it toggles', () => {
  const { objects, player, log, step, sfx } = setup();
  const b = objects.button;
  player.pos = { x: BTN.x + 20, y: b.capTop0, z: BTN.z };
  for (const action of ['walking', 'idle', 'jump', 'land', 'double_jump', 'land', 'ground_pound']) {
    player.action = action;
    step(3);
  }
  assert.equal(pounds(log).length, 0);
  assert.equal(b.state, 'up');
  // A ground pound landing next to the button does nothing either.
  player.pos = { x: BTN.x + 400, y: 0, z: BTN.z };
  player.action = 'ground_pound_land';
  step(5);
  player.action = 'idle';
  step();
  assert.equal(pounds(log).length, 0);
  // On the cap: pressed once, even though the landing lasts several ticks.
  player.pos = { x: BTN.x - 60, y: b.capTop0, z: BTN.z + 40 };
  player.action = 'ground_pound';
  step();
  player.action = 'ground_pound_land';
  step(8);
  assert.equal(pounds(log).length, 1);
  assert.deepEqual(pounds(log)[0].e, { on: true });
  assert.equal(sfx('button_press').length, 1);
  assert.deepEqual(sfx('button_press')[0].e.pos, { x: BTN.x, y: b.capTop0, z: BTN.z });
  assert.equal(objects.modeOn, true);
});

test('the pressed cap sinks with the floor under the hero, then pops back up to be pounded again', () => {
  const { objects, player, log, step, collision } = setup();
  const b = objects.button;
  player.pos = { x: BTN.x, y: b.capTop0, z: BTN.z };
  player.action = 'ground_pound_land';
  step(BUTTON.PRESS_TICKS + 1);
  assert.equal(b.state, 'down');
  assert.equal(b.capTop, b.capTop0 - BUTTON.SINK);
  assert.equal(collision.findFloor(BTN.x, 500, BTN.z).y, b.capTop0 - BUTTON.SINK, 'the floor sank with the cap');
  const hit = collision.raycast({ x: BTN.x + 10, y: 1000, z: BTN.z }, { x: 0, y: -1, z: 0 }, 2000);
  assert.ok(Math.abs(hit.point.y - b.capTop) < 1e-6, 'raycasts see the sunk cap');
  objects.animate(0, 1, null);
  assert.equal(b.capMesh.position.y, -BUTTON.SINK, 'the cap mesh sank');
  // Pounding again while it is down does nothing.
  player.action = 'idle';
  step();
  player.pos.y = b.capTop;
  player.action = 'ground_pound_land';
  step();
  assert.equal(pounds(log).length, 1);
  // ~1.5 s after the press it springs back up.
  player.action = 'idle';
  step(BUTTON.HOLD_TICKS + BUTTON.RISE_TICKS);
  assert.equal(b.state, 'up');
  assert.equal(b.capTop, b.capTop0);
  assert.equal(collision.findFloor(BTN.x, 500, BTN.z).y, b.capTop0);
  // Pound again: the mode goes back off.
  player.pos.y = b.capTop0;
  player.action = 'ground_pound_land';
  step();
  assert.deepEqual(pounds(log).map((l) => l.e.on), [true, false]);
});

test('the button toggles against the mode main reports (darkMode), e.g. after setDark()', () => {
  const { objects, player, events, log, step } = setup();
  events.emit('darkMode', { on: true }); // window.__game.setDark(true)
  const b = objects.button;
  player.pos = { x: BTN.x, y: b.capTop0, z: BTN.z };
  player.action = 'ground_pound_land';
  step();
  assert.deepEqual(pounds(log).at(-1).e, { on: false });
});

test('a pound needs the feet on top of the cap, within its rim', () => {
  const b = new AiButton({ spot: BTN, collision: flatWorld(), groundAt: () => 0 });
  const top = b.capTop0;
  assert.ok(b.onCap({ x: BTN.x + b.capRadius, y: top, z: BTN.z }));
  assert.ok(!b.onCap({ x: BTN.x + b.capRadius + BUTTON.POUND_MARGIN + 5, y: top, z: BTN.z }));
  assert.ok(!b.onCap({ x: BTN.x, y: b.baseTop, z: BTN.z }), 'on the base ring, not the cap');
  assert.ok(!b.onCap({ x: BTN.x, y: top + 200, z: BTN.z }), 'high above it');
});

// The cap tells the hero how to switch the mode the other way: "AI RACE" while it is off,
// "STOP" while it is on, whichever way the mode switched (a pound, window.__game.setDark(), a
// preview's full darkness, game over).
test('the cap reads AI RACE while the mode is off and STOP while it is on', () => {
  const { objects, player, events, step } = setup();
  const b = objects.button;
  const painted = [b.capTextures.off, b.capTextures.on];
  assert.notEqual(painted[0], painted[1]);
  assert.equal(b.label, 'AI RACE');
  assert.equal(painted[1].userData.label, 'STOP');
  // A pound switches the mode on (main answers with 'darkMode').
  player.pos = { x: BTN.x, y: b.capTop0, z: BTN.z };
  player.action = 'ground_pound_land';
  step();
  assert.equal(objects.modeOn, true);
  assert.equal(b.label, 'STOP');
  player.action = 'idle';
  step(BUTTON.HOLD_TICKS + BUTTON.RISE_TICKS);
  assert.equal(b.state, 'up');
  assert.equal(b.label, 'STOP', 'still STOP once the cap is back up');
  player.action = 'ground_pound_land';
  step();
  assert.equal(objects.modeOn, false);
  assert.equal(b.label, 'AI RACE');
  // setDark(on) from tests.
  events.emit('darkMode', { on: true });
  assert.equal(b.label, 'STOP');
  events.emit('darkMode', { on: false });
  assert.equal(b.label, 'AI RACE');
  // Full darkness without an event (previews) brings the beast, and the label with it.
  objects.setDarkness(1);
  assert.equal(b.label, 'STOP');
  // Game over: reset() switches everything off (main may report the mode off afterwards too).
  objects.reset();
  assert.equal(b.label, 'AI RACE');
  events.emit('darkMode', { on: false });
  assert.equal(b.label, 'AI RACE');
  events.emit('darkMode', { on: true });
  assert.equal(b.label, 'STOP');
  // Only the two textures painted at construction are ever shown.
  assert.ok(painted.includes(b.capMaterial.map));
});

test('both cap labels are spelt in block glyphs that fit the cap', () => {
  for (const label of [CAP_LABELS.off, CAP_LABELS.on]) assert.ok(hasGlyphs(label), label);
  assert.ok(!hasGlyphs('Q'));
  // STOP: four 5-wide letters with 1-cell gaps, every letter drawn.
  const stop = lineCells('STOP');
  assert.equal(stop.width, 23);
  for (let k = 0; k < 4; k++) assert.ok(stop.cells.some((c) => c.x >= k * 6 && c.x < k * 6 + 5), `letter ${k}`);
});

// ---------------------------------------------------------------- beast

test('the beast is hidden (no draw calls, no colliders) until the mode turns on', () => {
  const { objects, collision, step } = setup();
  const surfaces = collision.surfaces.length;
  step(30);
  assert.equal(objects.beast.state, 'hidden');
  assert.equal(objects.beast.mesh.visible, false);
  assert.equal(objects.fireballs.cores.visible, false);
  assert.equal(objects.fire.mesh.visible, false);
  assert.equal(collision.surfaces.length, surfaces, 'the beast adds no colliders');
});

test('the beast rises with a roar, stays, then sinks and hides when the mode turns off', () => {
  const { objects, events, log, step, sfx } = setup();
  const beast = objects.beast;
  events.emit('darkMode', { on: true });
  assert.equal(beast.state, 'rising');
  assert.equal(beast.mesh.visible, true);
  step(10);
  assert.ok(beast.root.position.y < beast.baseY - 500, 'starts below the roof');
  step(BEAST.RISE_TICKS);
  assert.equal(beast.state, 'active');
  assert.ok(Math.abs(beast.root.position.y - beast.baseY) < 40, 'standing on the roof');
  assert.equal(sfx('kaiju_roar').length, 1);
  assert.equal(log.filter((l) => l.name === 'kaijuRoar').length, 1);
  assert.ok(log.find((l) => l.name === 'kaijuRoar').e.pos.y > 0);
  events.emit('darkMode', { on: false });
  assert.equal(beast.state, 'sinking');
  step(BEAST.SINK_TICKS + 1);
  assert.equal(beast.state, 'hidden');
  assert.equal(beast.mesh.visible, false);
});

test('the beast stands in front of the anchor, facing its yaw, at the roof height under its feet', () => {
  const w = new CollisionWorld();
  const s = SIZE;
  w.addTriangles([-s, 0, s, s, 0, s, s, 0, -s, -s, 0, s, s, 0, -s, -s, 0, -s]);
  // A raised "roof" slab under where it stands.
  w.addTriangles([-2000, 1500, 0, 2000, 1500, 0, 2000, 1500, -3000, -2000, 1500, 0, 2000, 1500, -3000, -2000, 1500, -3000]);
  w.finalize();
  const beast = new RobotBeast({ anchor: { x: 0, z: -2300, yaw: 0 }, collision: w, events: new Events(), fire: null, rng: Math.random, launch() {} });
  assert.equal(beast.x, 0);
  assert.equal(beast.z, -2300 + BEAST.STANCE_FORWARD);
  assert.equal(beast.baseY, 1500);
  assert.equal(beast.root.rotation.y, 0);
});

test('the beast tracks the hero with its neck and head', () => {
  const { objects, player, events, step } = setup();
  events.emit('darkMode', { on: true });
  player.pos = { x: -5000, y: 0, z: 3000 };
  step(BEAST.RISE_TICKS + 60);
  const beast = objects.beast;
  const look = () => beast.torso.rotation.y + beast.neck.rotation.y + beast.head.rotation.y;
  const left = look();
  const neckLeft = beast.neck.rotation.y;
  player.pos = { x: 5000, y: 0, z: 3000 };
  step(60);
  const right = look();
  assert.ok(left < -0.6 && right > 0.6, `turns from ${left.toFixed(2)} to ${right.toFixed(2)}`);
  assert.ok(neckLeft < -0.3 && beast.neck.rotation.y > 0.3, 'the neck bends toward him');
  // Down at a hero right under the facade, level toward one far away.
  const pitch = () => beast.neck.rotation.x + beast.head.rotation.x;
  player.pos = { x: 0, y: 0, z: 13000 };
  step(60);
  const far = pitch();
  player.pos = { x: 0, y: 0, z: 1000 };
  step(60);
  assert.ok(pitch() > far + 0.4, `looks down from ${far.toFixed(2)} to ${pitch().toFixed(2)}`);
});

test('it charges (throat glow, sfx) and spits a fireball every few seconds', () => {
  const { objects, player, events, step, sfx } = setup();
  events.emit('darkMode', { on: true });
  const beast = objects.beast;
  let maxCharge = 0;
  const launches = [];
  for (let t = 0; t < 30 * 20; t++) {
    step();
    maxCharge = Math.max(maxCharge, beast.uniforms.uCharge.value);
    if (sfx('fireball_launch').length > launches.length) launches.push(objects.tick);
  }
  assert.ok(maxCharge > 0.9, 'the throat glows up');
  assert.ok(sfx('fireball_charge').length >= launches.length);
  assert.ok(launches.length >= 4 && launches.length <= 7, `${launches.length} shots in 20 s`);
  for (let i = 1; i < launches.length; i++) {
    const gap = launches[i] - launches[i - 1];
    assert.ok(gap >= BEAST.PERIOD[0], `gap ${gap}`);
  }
  // Every launch leaves from the mouth, out in front of the beast and above the roof.
  const from = sfx('fireball_launch')[0].e.pos;
  assert.ok(from.y > beast.baseY + 1000 && from.z > beast.z, JSON.stringify(from));
  assert.ok(player.hits.length > 0, 'a hero standing still gets hit');
});

test('it does not shoot at a hero behind it, far away, or dropping in', () => {
  for (const [pos, action] of [
    [{ x: 0, y: 0, z: -9000 }, 'idle'],
    [{ x: 0, y: 0, z: 20000 }, 'idle'],
    [{ x: 0, y: 0, z: 5000 }, 'spawn'],
  ]) {
    const { objects, player, events, step, sfx } = setup();
    player.pos = pos;
    player.action = action;
    events.emit('darkMode', { on: true });
    step(30 * 12);
    assert.equal(sfx('fireball_launch').length, 0, JSON.stringify(pos) + action);
    assert.equal(objects.beast.state, 'active');
  }
});

// ---------------------------------------------------------------- aim

test('the ballistic solution lands exactly on its target after T ticks', () => {
  const from = { x: 100, y: 3000, z: -1000 };
  const to = { x: -800, y: 120, z: 5200 };
  const T = flightTicks(Math.hypot(to.x - from.x, to.z - from.z));
  assert.ok(T >= SHOT.T_MIN && T <= SHOT.T_MAX);
  const v = aimVelocity(from, to, T, {});
  const p = { ...from };
  for (let i = 0; i < T; i++) {
    v.y -= SHOT.GRAVITY;
    p.x += v.x;
    p.y += v.y;
    p.z += v.z;
  }
  assert.ok(Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z) < 1e-6);
});

// Where the shots land relative to the hero at impact, over two minutes of play from each of
// four starting spots, each with its own aim randomness (pooled, so one random stream's luck
// does not decide the verdict).
function shotSpread(move) {
  const d = [];
  for (const [x0, seed] of [
    [600, 11],
    [-900, 23],
    [1800, 37],
    [-2200, 41],
  ]) {
    const player = fakePlayer(x0, 0, 5000);
    const { objects, events } = setup({ player, trees: [] });
    objects.beast.rng = makeRng(seed);
    events.on('sfx', (e) => {
      if (e.name === 'fireball_explode') d.push(Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z));
    });
    events.emit('darkMode', { on: true });
    for (let t = 0; t < 30 * 120; t++) {
      move(t, player.pos, x0);
      objects.update({ player });
    }
  }
  return d;
}

test('not unfair: about half of the shots land within 250 of a hero standing still or running straight', () => {
  const still = shotSpread(() => {});
  const run = shotSpread((t, p, x0) => {
    p.x = -3500 + ((t * 20 + x0 + 3500) % 7000);
  });
  for (const [name, d] of [
    ['still', still],
    ['running', run],
  ]) {
    const near = d.filter((x) => x < 250).length / d.length;
    assert.ok(d.length >= 100, `${name}: ${d.length} shots`);
    assert.ok(near >= 0.4 && near <= 0.7, `${name}: ${(near * 100).toFixed(0)} % within 250`);
  }
  // A hero who keeps changing direction dodges most of them.
  let dir = 0;
  const weave = shotSpread((t, p) => {
    if (t % 40 === 0) dir = (dir + 2.1) % (2 * Math.PI);
    p.x = Math.max(-3000, Math.min(3000, p.x + Math.cos(dir) * 22));
    p.z = Math.max(3000, Math.min(7000, p.z + Math.sin(dir) * 22));
  });
  assert.ok(weave.filter((x) => x < 250).length / weave.length < 0.35);
});

// ---------------------------------------------------------------- fireballs

function fireballs({ collision = flatWorld(), trees = TREES } = {}) {
  const events = new Events();
  const log = [];
  events.on('sfx', (e) => log.push(e));
  const fx = fakeFx();
  const scorches = [];
  const level = { trees, addScorch: (x, z, r) => scorches.push({ x, z, r }) };
  let seed = 3;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fire = new FireSprites(rng);
  const balls = new Fireballs({ collision, events, fx, level, layout: { groundHeight: () => 0 }, fire, rng });
  let tick = 0;
  const run = (player, n = 1) => {
    for (let i = 0; i < n; i++) {
      balls.update(player, ++tick);
      balls.animate(1, tick / 30);
      fire.animate(tick / 30);
    }
  };
  // Launch a ball that lands on (x, z) after T ticks.
  const lob = (x, z, T = 40, from = { x: 0, y: 2500, z: -1000 }, y = 0) => {
    const v = aimVelocity(from, { x, y, z }, T, {});
    return balls.launch(from.x, from.y, from.z, v.x, v.y, v.z);
  };
  return { balls, events, log, fx, scorches, run, lob, fire };
}

test('fireballs come from a pool of six and expire', () => {
  const { balls, run, fx } = fireballs({ collision: { findFloor: () => ({ y: -11000, surface: null }), waterLevelAt: () => NO_WATER, raycast: () => null } });
  const player = fakePlayer(0, 0, 90000);
  const got = [];
  for (let i = 0; i < 7; i++) got.push(balls.launch(0, 1000, 0, 5, 0, 5));
  assert.equal(got.filter(Boolean).length, FIREBALL.CAPACITY);
  assert.equal(got[6], null, 'the seventh waits for a free ball');
  assert.equal(balls.inFlight, 6);
  const records = new Set(balls.balls);
  run(player, 10);
  assert.equal(balls.cores.count, 6);
  assert.equal(balls.cores.visible, true);
  run(player, 400); // nothing to hit: they give up (or fall out of the world)
  assert.equal(balls.inFlight, 0);
  assert.equal(balls.cores.visible, false);
  assert.equal(fx.log.length, 0, 'no explosions in the void');
  assert.ok(balls.launch(0, 0, 0, 0, 0, 0) && records.has(balls.balls[0]), 'records are reused');
});

test('a ground impact explodes, scorches, leaves a fire zone and hurts the hero in the blast', () => {
  const { balls, log, fx, scorches, run, lob } = fireballs({ trees: [] });
  const player = fakePlayer(3000, 0, 3200);
  lob(3000, 3000, 40);
  run(player, 39);
  assert.equal(balls.inFlight, 1);
  assert.ok(balls.markers.visible, 'the landing spot glows');
  run(player, 3);
  assert.equal(balls.inFlight, 0);
  const ex = fx.log.find((c) => c.fn === 'explode');
  assert.ok(ex && Math.hypot(ex.x - 3000, ex.z - 3000) < 5 && Math.abs(ex.y) < 1, JSON.stringify(ex));
  assert.equal(ex.radius, FIREBALL.BLAST_FX);
  assert.equal(log.filter((e) => e.name === 'fireball_explode').length, 1);
  assert.ok(log.find((e) => e.name === 'fireball_explode').pos);
  assert.equal(scorches.length, 1);
  assert.equal(scorches[0].r, FIREBALL.SCORCH);
  const ig = fx.log.find((c) => c.fn === 'ignite');
  assert.equal(ig.radius, FIREBALL.ZONE_RADIUS);
  assert.equal(ig.duration, FIREBALL.ZONE_SECONDS);
  assert.equal(balls.zoneCount, 1);
  // Hero 200 from the impact: 2 wedges from the blast, from the impact point.
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].n, FIREBALL.BLAST_DAMAGE);
  assert.ok(Math.hypot(player.hits[0].from.x - 3000, player.hits[0].from.z - 3000) < 5);
  assert.equal(player.hits[0].opts, undefined);
});

test('the blast spares a hero 300 away; standing in the fire hurts (fire: true) until it burns out', () => {
  const { balls, run, lob } = fireballs({ trees: [] });
  const player = fakePlayer(3300, 0, 3000);
  lob(3000, 3000, 40);
  run(player, 42);
  assert.equal(player.hits.length, 0, 'outside the blast');
  player.pos = { x: 3050, y: 0, z: 3040 }; // walks into the flames
  run(player, 1);
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].n, FIREBALL.ZONE_DAMAGE);
  assert.deepEqual(player.hits[0].opts, { fire: true });
  assert.ok(Math.abs(player.hits[0].from.x - 3000) < 5 && Math.abs(player.hits[0].from.z - 3000) < 5, 'from the zone centre');
  player.pos.y = 300; // jumping over it
  run(player, 1);
  assert.equal(player.hits.length, 1);
  player.pos.y = 0;
  run(player, FIREBALL.ZONE_SECONDS * 30);
  assert.equal(balls.zoneCount, 0);
  const n = player.hits.length;
  run(player, 10);
  assert.equal(player.hits.length, n, 'no damage once it has burnt out');
});

test('a direct hit bursts on the hero: 2 wedges, no fire zone', () => {
  const { balls, fx, run, lob } = fireballs({ trees: [] });
  const player = fakePlayer(3000, 0, 3000);
  lob(3000, 3000, 40);
  run(player, 42);
  assert.equal(balls.inFlight, 0);
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].n, FIREBALL.HIT_DAMAGE);
  assert.equal(fx.log.filter((c) => c.fn === 'explode').length, 1);
  const ex = fx.log.find((c) => c.fn === 'explode');
  assert.ok(ex.y > 20, 'burst on his body, before the ground');
  assert.equal(balls.zoneCount, 0);
});

test('water puts a fireball out: steam, no explosion, fire or scorch', () => {
  const { balls, log, fx, scorches, run, lob } = fireballs({ collision: flatWorld({ waterFromX: 2000 }) });
  const player = fakePlayer(-5000, 0, 0);
  lob(4000, 3000, 40, undefined, 50);
  run(player, 42);
  assert.equal(balls.inFlight, 0);
  assert.equal(fx.log.length, 0);
  assert.equal(scorches.length, 0);
  assert.equal(balls.zoneCount, 0);
  assert.ok(log.some((e) => e.name === 'fireball_fizzle'));
  assert.ok(log.some((e) => e.name === 'splash' && e.big));
});

test('trees near an impact catch fire once at a time; others stay green', () => {
  const { balls, fx, log, run, lob } = fireballs();
  const player = fakePlayer(-9000, 0, -9000);
  lob(2150, 1800, 40); // within 350 of trees 0 and 1 (horizontally), under neither canopy
  run(player, 42);
  const fires = fx.log.filter((c) => c.fn === 'ignite' && c.duration === FIREBALL.TREE_SECONDS);
  assert.deepEqual(fires.map((f) => f.x).sort(), [TREES[0].canopy.x, TREES[1].canopy.x]);
  const f0 = fires.find((f) => f.x === TREES[0].canopy.x);
  assert.equal(f0.y, TREES[0].canopy.y);
  assert.ok(Math.abs(f0.radius - TREES[0].canopy.radius * 0.8) < 1e-9);
  assert.ok(balls.treeBurning(0) && balls.treeBurning(1) && !balls.treeBurning(2));
  assert.equal(log.filter((e) => e.name === 'tree_ignite').length, 2);
  // A second impact while they burn does not light them again.
  lob(2100, 1850, 40);
  run(player, 42);
  assert.equal(fx.log.filter((c) => c.fn === 'ignite' && c.duration === FIREBALL.TREE_SECONDS).length, 2);
  // Once burnt out they can catch again.
  run(player, FIREBALL.TREE_SECONDS * 30);
  assert.ok(!balls.treeBurning(0));
  lob(2100, 1850, 40);
  run(player, 42);
  assert.equal(fx.log.filter((c) => c.fn === 'ignite' && c.duration === FIREBALL.TREE_SECONDS).length, 4);
});

test('a fireball flying into a canopy bursts in it and sets it alight', () => {
  const { balls, fx, run } = fireballs();
  const player = fakePlayer(-9000, 0, -9000);
  // Level flight straight through tree 2's canopy.
  const b = balls.launch(-3000, 800, 1000, 0, SHOT.GRAVITY, 50);
  assert.ok(b);
  run(player, 30);
  assert.equal(balls.inFlight, 0);
  const ex = fx.log.find((c) => c.fn === 'explode');
  assert.ok(ex && Math.abs(ex.z - 2000) < 300 && Math.abs(ex.y - 800) < 150, JSON.stringify(ex));
  assert.ok(balls.treeBurning(2));
  assert.equal(balls.zoneCount, 0, 'no ground fire up in a tree');
});

// ---------------------------------------------------------------- mode, reset, budget

test('butterflies and birds keep away from the storm; the button glows in it', () => {
  const layout = {
    BUTTERFLY_SPOTS: [{ x: 0, z: 0 }],
    BIRD_CIRCLES: [{ x: 0, z: 0, y: 1500, radius: 800 }],
    AI_BUTTON: BTN,
    groundHeight: () => 0,
  };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: flatWorld(), events: new Events(), layout, player: fakePlayer() });
  objects.setDarkness(0.3);
  assert.ok(objects.butterflies.mesh.visible && objects.birds.mesh.visible);
  objects.setDarkness(0.8);
  assert.ok(!objects.butterflies.mesh.visible && !objects.birds.mesh.visible);
  objects.animate(0, 1, null);
  assert.ok(objects.button.capMaterial.color.r > 1, 'the cap glows');
  assert.ok(objects.button.baseMaterial.color.r < 1, 'the base darkens');
  objects.setDarkness(0);
  assert.ok(objects.butterflies.mesh.visible && objects.birds.mesh.visible);
});

test('full darkness without a darkMode event still brings the beast (previews)', () => {
  const { objects } = setup();
  objects.setDarkness(1);
  assert.equal(objects.beast.state, 'rising');
});

test('reset() clears the beast, fireballs, fire zones, burning trees and the button', () => {
  const { objects, player, events, fx, step } = setup();
  const b = objects.button;
  player.pos = { x: BTN.x, y: b.capTop0, z: BTN.z };
  player.action = 'ground_pound_land';
  step(BUTTON.PRESS_TICKS + 1);
  assert.equal(objects.modeOn, true);
  assert.equal(b.state, 'down');
  player.action = 'idle';
  player.pos = { x: 1900, y: 0, z: 1900 }; // under a tree, so impacts set trees alight
  let t = 0;
  while ((objects.fireballs.zoneCount === 0 || objects.fireballs.inFlight === 0) && t++ < 30 * 60) step();
  assert.ok(objects.fireballs.zoneCount > 0 && objects.fireballs.inFlight > 0, 'fires and a ball in flight');
  objects.setDarkness(1);
  const ignited = fx.log.filter((c) => c.fn === 'ignite').map((c) => c.id);

  objects.reset();
  assert.equal(objects.modeOn, false);
  assert.equal(objects.beast.state, 'hidden');
  assert.equal(objects.beast.mesh.visible, false);
  assert.equal(objects.fireballs.inFlight, 0);
  assert.equal(objects.fireballs.zoneCount, 0);
  assert.ok(!objects.fireballs.treeBurning(0));
  const out = new Set(fx.log.filter((c) => c.fn === 'extinguish').map((c) => c.id));
  assert.ok(ignited.slice(-1).every((id) => out.has(id)), 'its fires are put out');
  assert.equal(b.state, 'up');
  assert.equal(b.capTop, b.capTop0);
  assert.equal(objects.fire.count, 0);
  assert.ok(objects.butterflies.mesh.visible);
  // main then reports the mode off; the next pound switches it on again.
  events.emit('darkMode', { on: false });
  objects.animate(0, 1, null);
  assert.equal(objects.fireballs.cores.visible, false);
  player.pos = { x: BTN.x, y: b.capTop0, z: BTN.z };
  player.action = 'ground_pound_land';
  step();
  assert.equal(objects.modeOn, true);
  assert.equal(objects.beast.state, 'rising');
});

test('draw calls: the button adds two; the beast, fireballs, fire and minions only while shown', () => {
  const drawn = (objects) => {
    let n = 0;
    objects.group.traverseVisible((o) => {
      if (o.isMesh && (o.count === undefined || o.count > 0)) n++;
    });
    return n;
  };
  const plain = new ObjectManager({ scene: new THREE.Scene(), collision: flatWorld(), events: new Events(), layout: { groundHeight: () => 0 }, player: fakePlayer() });
  plain.update({ player: plain.player });
  plain.animate(0, 1, null);
  const { objects, events, step } = setup();
  step(2);
  const sunny = drawn(objects);
  assert.equal(sunny - drawn(plain), 2, 'button base and cap');
  events.emit('darkMode', { on: true });
  let most = 0;
  for (let t = 0; t < BEAST.RISE_TICKS + 300; t++) {
    step();
    most = Math.max(most, drawn(objects));
  }
  assert.ok(most - sunny <= 9 + 3 + 1, `${most - sunny} more while the beast shows (rig, cores, markers, fire, minions)`);
  events.emit('darkMode', { on: false });
  step(BEAST.SINK_TICKS + 120);
  assert.equal(drawn(objects), sunny);
});

// The per-tick and per-frame paths keep to the objects' allocation rules (see objects.test.js).
test('AI RACE hot paths avoid allocating constructs', () => {
  const hot = {
    'AiButton.update': AiButton.prototype.update,
    'AiButton.animate': AiButton.prototype.animate,
    'AiButton.setOn': AiButton.prototype.setOn,
    'RobotBeast.update': RobotBeast.prototype.update,
    'RobotBeast._pose': RobotBeast.prototype._pose,
    'RobotBeast.animate': RobotBeast.prototype.animate,
    'RobotBeast._glows': RobotBeast.prototype._glows,
    'RobotBeast._sparks': RobotBeast.prototype._sparks,
    'Fireballs.update': Fireballs.prototype.update,
    'Fireballs._stepHits': Fireballs.prototype._stepHits,
    'Fireballs._trail': Fireballs.prototype._trail,
    'Fireballs._marker': Fireballs.prototype._marker,
    'Fireballs.animate': Fireballs.prototype.animate,
    'FireSprites.animate': FireSprites.prototype.animate,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
});
