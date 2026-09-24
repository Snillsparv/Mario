// Objects in the real level (built in node): draw order against the terrain decals and water,
// butterflies kept out of the castle, birds clear of the towers, coins clear of the scenery,
// and the hidden 1-up placed in the open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';

const scene = new THREE.Scene();
const level = buildLevel(scene);
const collision = level.collision;

function makeObjects() {
  const events = new Events();
  const log = [];
  events.on('oneUp', (e) => log.push(e));
  const player = { pos: { x: 0, y: 0, z: 9000 }, collectCoin() {}, collectStar() {} };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: level.layout, player });
  return { objects, player, log };
}

// Inside a closed loop of walls: horizontal rays in all four directions hit a wall's back.
function insideWalls(p) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => {
    const hit = collision.raycast(p, { x: dx, y: 0, z: dz }, 4000, { floors: false, ceilings: false });
    return hit && hit.normal.x * dx + hit.normal.z * dz > 0;
  });
}

test('blob shadows draw after the path decal and before the water', () => {
  const { objects } = makeObjects();
  const order = {};
  scene.traverse((o) => {
    if (o.isMesh && (o.name === 'paths' || o.name === 'water')) order[o.name] = o.renderOrder;
  });
  assert.ok('paths' in order && 'water' in order, 'terrain has paths and water meshes');
  const shadows = objects.shadows.mesh.renderOrder;
  assert.ok(shadows > order.paths, `shadows ${shadows} after paths ${order.paths}`);
  assert.ok(shadows < order.water, `shadows ${shadows} before water ${order.water}`);
});

test('butterflies stay out of the castle, even when chased', () => {
  const { objects, player } = makeObjects();
  const list = objects.butterflies.list;
  assert.ok(list.every((b) => !insideWalls(b.pos)), 'no butterfly starts inside a building');
  let inside = 0;
  let touching = 0;
  for (let t = 0; t < 4000; t++) {
    // The hero runs at each butterfly in turn.
    const b = list[Math.floor(t / 400) % list.length];
    const p = player.pos;
    const dx = b.pos.x - p.x;
    const dz = b.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (t % 400 === 0 || d > 3000) {
      p.x = b.pos.x + 300;
      p.z = b.pos.z + 300;
    } else if (d > 1) {
      p.x += (dx / d) * 25;
      p.z += (dz / d) * 25;
    }
    p.y = collision.findFloor(p.x, 1e5, p.z).y;
    objects.update({ player });
    if (t % 5) continue;
    for (const bf of list) {
      if (insideWalls(bf.pos)) inside++;
      if (collision.findWalls(bf.pos.x, bf.pos.y, bf.pos.z, 0, 20).walls.length) touching++;
    }
  }
  assert.equal(inside, 0, 'samples inside a building');
  assert.equal(touching, 0, 'samples clipping into a wall');
});

test('the hidden 1-up hovers in the open behind the castle and can be picked up', () => {
  const { objects, player, log } = makeObjects();
  const gem = objects.oneUp.pos;
  const { CASTLE } = level.layout;
  assert.ok(gem.z < CASTLE.backZ, 'behind the castle');
  const floor = collision.findFloor(gem.x, gem.y, gem.z);
  assert.ok(floor.surface && gem.y - floor.y > 50 && gem.y - floor.y < 150, 'hovers just over the floor');
  assert.ok(collision.findFloor(gem.x, 1e5, gem.z).y < gem.y, 'nothing built above it');
  player.pos = { x: gem.x + 60, y: floor.y, z: gem.z };
  objects.update({ player });
  assert.equal(log.length, 1);
});

test('circling birds keep clear of the castle towers and roofs', () => {
  const { objects } = makeObjects();
  const { birds } = objects.birds;
  let hits = 0;
  let minGap = Infinity;
  for (let t = 0; t < 600; t += 0.1) {
    objects.birds.animate(t);
    for (const { pos } of birds) {
      if (collision.findWalls(pos.x, pos.y, pos.z, 0, 120).walls.length) hits++;
      minGap = Math.min(minGap, pos.y - collision.findFloor(pos.x, 1e5, pos.z).y);
    }
  }
  assert.equal(hits, 0, 'samples with a wall within 120');
  assert.ok(minGap > 250, `lowest clearance over the scenery ${minGap.toFixed(0)}`);
});

test('every coin hangs clear of ceilings and walls', () => {
  const { objects } = makeObjects();
  for (const c of objects.coins.coins) {
    const where = `coin at ${c.x}, ${c.y.toFixed(0)}, ${c.z}`;
    assert.ok(collision.findCeil(c.x, c.y - 60, c.z, 0).y - c.y >= 55, `${where}: ceiling`);
    assert.equal(collision.findWalls(c.x, c.y, c.z, 0, 45).walls.length, 0, `${where}: wall`);
  }
});

// AI RACE mode on the real castle: the beast stands on the roof in front of the keep (layout.KAIJU),
// and while it rises through the roof (or sinks back) nothing of it shows in front of the front
// facade below the roof line (its neck and arms are tucked back until they clear it).
test('the beast stands on the castle roof and never pokes out through the front facade', () => {
  const events = new Events();
  const player = { pos: { x: 0, y: 100, z: 5700 }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', takeDamage() {}, collectCoin() {}, collectStar() {} };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: level.layout, player, fx: null, level });
  const beast = objects.beast;
  const { CASTLE, KAIJU } = level.layout;
  const roofLine = CASTLE.baseY + CASTLE.mainHeight;
  assert.ok(beast.baseY > roofLine - 400 && beast.baseY < roofLine + 200, `stands on the roof (${beast.baseY.toFixed(0)})`);
  assert.ok(beast.z > KAIJU.z && beast.z < CASTLE.frontZ, 'in front of the keep, behind the facade');
  const v = new THREE.Vector3();
  let worst = -Infinity;
  const check = () => {
    beast.root.updateMatrixWorld(true);
    for (const part of beast.parts) {
      const p = part.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        v.fromBufferAttribute(p, i).applyMatrix4(part.matrixWorld);
        if (v.y < roofLine && v.z > worst) worst = v.z;
      }
    }
  };
  events.emit('darkMode', { on: true });
  for (let t = 0; t < 100; t++) {
    objects.update({ player });
    objects.animate(0, 1, null);
    check();
  }
  // Standing: the beast towers well over the roof line (~1600-2200 units tall).
  beast.root.updateMatrixWorld(true);
  let top = -Infinity;
  for (const part of beast.parts) {
    const p = part.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(part.matrixWorld).y);
  }
  assert.ok(top - beast.baseY > 1600 && top - beast.baseY < 2200, `height ${(top - beast.baseY).toFixed(0)}`);
  events.emit('darkMode', { on: false });
  for (let t = 0; t < 80; t++) {
    objects.update({ player });
    objects.animate(0, 1, null);
    check();
  }
  assert.equal(beast.state, 'hidden');
  assert.ok(worst < CASTLE.frontZ, `a part below the roof line reaches z ${worst.toFixed(0)} (facade at ${CASTLE.frontZ})`);
});

test('the AI RACE button sits on the lawn by the path, clear of props, with its collider', () => {
  const { objects } = makeObjects();
  const b = objects.button;
  const { AI_BUTTON } = level.layout;
  assert.equal(b.x, AI_BUTTON.x);
  assert.ok(Math.abs(collision.findFloor(b.x, 1e4, b.z).y - b.capTop0) < 1e-6, 'its cap is the floor there');
  assert.ok(b.baseTop - b.groundLow <= 30, 'low enough to walk onto');
  for (let a = 0; a < 8; a++) {
    const x = b.x + Math.cos(a) * (AI_BUTTON.radius + 60);
    const z = b.z + Math.sin(a) * (AI_BUTTON.radius + 60);
    assert.ok(collision.findFloor(x, 1e4, z).y < b.baseTop, 'nothing built right next to it');
  }
});

// The real hero on the real lawn: he walks over the button from every side (onto the cap and
// off the far side), walking and jumping on it change nothing, and a jump + ground pound
// landing on the cap sinks it with him, emits the toggle, and it pops back up.
test('the real hero walks over the AI RACE button and ground-pounds it', () => {
  const lvl = buildLevel(new THREE.Scene());
  const col = lvl.collision;
  const events = new Events();
  const player = new Player({ collision: col, events, spawn: lvl.spawn });
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: lvl.layout, player, level: lvl });
  const toggles = [];
  events.on('aiRaceButton', (e) => toggles.push(e.on));
  const b = objects.button;
  const ctl = new ScriptedController();
  const tick = (input, yaw) => {
    player.update(ctl.next(input), yaw);
    objects.update({ player });
  };
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = b.x - Math.sin(yaw) * 420;
    const z = b.z - Math.cos(yaw) * 420;
    player.teleport(x, col.findFloor(x, 1e4, z).y, z, yaw);
    player.setAction('idle');
    let top = -Infinity;
    for (let t = 0; t < 45; t++) {
      tick({ stickY: 1 }, yaw);
      top = Math.max(top, player.pos.y);
    }
    const past = (player.pos.x - b.x) * Math.sin(yaw) + (player.pos.z - b.z) * Math.cos(yaw);
    assert.ok(Math.abs(top - b.capTop0) < 1e-6, `yaw ${yaw.toFixed(2)}: walked over the cap (top ${top.toFixed(1)})`);
    assert.ok(past > b.radius, `yaw ${yaw.toFixed(2)}: came off the far side (${past.toFixed(0)})`);
  }
  // Standing on the cap: a plain jump changes nothing.
  player.teleport(b.x, b.capTop0, b.z, Math.PI);
  player.setAction('idle');
  tick({}, Math.PI);
  tick({ A: true }, Math.PI);
  for (let t = 0; t < 40; t++) tick({}, Math.PI);
  assert.equal(player.action, 'idle');
  assert.deepEqual(toggles, []);
  // Jump, then Z at the top: the pound lands on the cap.
  tick({ A: true }, Math.PI);
  for (let t = 0; t < 6; t++) tick({}, Math.PI);
  tick({ Z: true }, Math.PI);
  let t = 0;
  while (player.action !== 'ground_pound_land' && t++ < 60) tick({}, Math.PI);
  assert.equal(player.action, 'ground_pound_land');
  assert.deepEqual(toggles, [true]);
  for (let k = 0; k < 6; k++) tick({}, Math.PI);
  assert.equal(b.capTop, b.capTop0 - 15);
  assert.ok(Math.abs(player.pos.y - b.capTop) < 1e-6, 'he sank with the cap');
  for (let k = 0; k < 60; k++) tick({}, Math.PI);
  assert.equal(b.state, 'up');
  assert.ok(Math.abs(player.pos.y - b.capTop0) < 1e-6, 'and rose with it');
  assert.deepEqual(toggles, [true]);
});
