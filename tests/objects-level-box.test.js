// The mystery box, the locked door and the minions in the real level (built in node) with the
// real hero: a standing jump under the box bumps it and he can walk into the hat; walking up the
// steps to the castle door laughs and opens the locked message; minion spawn spots round the
// lawn are all on dry land, on the real ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { makeRng } from '../src/core/math.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { MINION } from '../src/objects/Minions.js';
import { BOX } from '../src/objects/MysteryBox.js';
import { PLAYER_HEIGHT } from '../src/core/constants.js';

const level = buildLevel(new THREE.Scene());
const col = level.collision;
const layout = level.layout;

// One ObjectManager for the whole file: each one adds its colliders (the box, the button) to
// the level's collision world, and stale copies of the moving box would stay behind in it.
// Every test gets it reset, a fresh hero and a fresh log.
const events = new Events();
const log = [];
events.on('sfx', (e) => log.push(e.name));
events.on('signRead', (e) => log.push('sign:' + e.sign.id));
let objects = null;

function setup() {
  log.length = 0;
  const player = new Player({ collision: col, events, spawn: level.spawn });
  objects ??= new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout, player, level });
  objects.reset();
  const ctl = new ScriptedController();
  const tick = (input = {}, yaw = Math.PI) => {
    player.update(ctl.next(input), yaw);
    objects.update({ player, camera: { getYaw: () => yaw } });
  };
  return { events, log, player, objects, tick };
}

test('the box floats clear of the scenery at its layout height', () => {
  const { objects } = setup();
  const box = objects.box;
  const spot = layout.MYSTERY_BOX;
  assert.ok(Math.abs(box.bottomY - (layout.groundHeight(spot.x, spot.z) + spot.y)) < 30, 'spot.y above the ground');
  // Nothing else within the box's space or right under it (the hero must reach the underside).
  for (const [dx, dz] of [[0, 0], [60, 60], [-60, 60], [60, -60], [-60, -60]]) {
    const f = col.findFloor(spot.x + dx, box.bottomY - 1, spot.z + dz);
    assert.ok(f.y < box.groundY + 40, `ground under the box at ${dx}, ${dz}: ${f.y}`);
  }
});

test('the real hero bumps the box with a standing jump and walks into the hat', () => {
  const { log, player, objects, tick } = setup();
  const box = objects.box;
  player.teleport(box.x, col.findFloor(box.x, box.groundY + 50, box.z).y, box.z + 20, Math.PI);
  player.setAction('idle');
  tick();
  tick({ A: true });
  for (let t = 0; t < 30 && box.state === 'ready'; t++) tick({ A: true });
  assert.equal(box.state, 'empty', 'bumped');
  assert.ok(log.includes('box_hit'));
  for (let t = 0; t < 60; t++) tick();
  // The hat glides toward the camera (behind Pip: +Z) and hovers there.
  for (let t = 0; t < BOX.HAT_POP_TICKS + BOX.HAT_HOLD_TICKS + BOX.HAT_GLIDE_TICKS; t++) tick();
  assert.equal(box.hat.state, 'hover');
  let got = false;
  for (let t = 0; t < 90 && !got; t++) {
    tick({ stickY: -1 });
    got = box.state === 'recharging';
  }
  assert.ok(got, 'took the hat');
  assert.ok(!player.giveWingHat || player.wingHat > 0, 'wearing it');
});

// The box as drawn at the end of the latest tick (animate at alpha 1).
function drawnBox(objects) {
  objects.animate(0, 1, null);
  const box = objects.box;
  const y = box.boxGroup.position.y;
  return { top: y + box.half, bottom: y - box.half };
}

test('the real hero standing on the box rides its bob and the dip of a ground pound, feet on its top', () => {
  const { player, objects, tick } = setup();
  const box = objects.box;
  const hits0 = box.hits;
  player.teleport(box.x, box.topY + 300, box.z, Math.PI);
  player.setAction('freefall');
  for (let t = 0; t < 30; t++) tick();
  assert.equal(player.action, 'idle', 'landed on it');
  let worst = 0;
  for (let t = 0; t < 60; t++) {
    tick();
    worst = Math.max(worst, Math.abs(player.pos.y - drawnBox(objects).top));
  }
  // Jump and ground-pound its top: it dips under him, he stays on it.
  tick({ A: true });
  for (let t = 0; t < 8; t++) tick();
  tick({ Z: true });
  let dipped = false;
  for (let t = 0; t < 40; t++) {
    tick();
    if (player.action === 'ground_pound_land' || player.action === 'idle') worst = Math.max(worst, Math.abs(player.pos.y - drawnBox(objects).top));
    dipped ||= box.offset < -5;
  }
  assert.equal(box.hits, hits0 + 1, 'the pound hit it');
  assert.ok(dipped, 'it dipped');
  assert.ok(worst < 0.01, `feet off the drawn top by ${worst}`);
});

test("the real hero's head stops at the drawn underside; a jump kick beside the box knocks the hat out", () => {
  const { player, objects, tick } = setup();
  const box = objects.box;
  const hits0 = box.hits;
  player.teleport(box.x, col.findFloor(box.x, box.groundY + 50, box.z).y, box.z + 20, Math.PI);
  player.setAction('idle');
  tick();
  let closest = -Infinity;
  for (let t = 0; t < 30; t++) {
    tick({ A: true });
    closest = Math.max(closest, player.pos.y + PLAYER_HEIGHT - drawnBox(objects).bottom);
  }
  assert.equal(box.hits, hits0 + 1);
  assert.ok(Math.abs(closest) < 0.01, `head vs drawn underside: ${closest}`);
  // A grounded punch cannot reach the underside (340 up); a jump kick beside it does.
  objects.reset();
  const z = box.z + box.half + 60;
  player.teleport(box.x, col.findFloor(box.x, box.groundY + 50, z).y, z, Math.PI);
  player.setAction('idle');
  tick();
  tick({ B: true });
  for (let t = 0; t < 15; t++) tick();
  assert.equal(box.state, 'ready', 'a punch from the ground is out of reach');
  tick({ A: true });
  for (let t = 0; t < 6; t++) tick({ A: true });
  tick({ B: true });
  for (let t = 0; t < 15 && box.state === 'ready'; t++) tick();
  assert.equal(box.state, 'empty', 'jump kick');
  assert.equal(box.hits, hits0 + 2);
});

test('walking up the steps to the castle door: evil laugh and the locked message', () => {
  const { log, player, tick } = setup();
  const z0 = layout.CASTLE.frontZ + 700;
  player.teleport(0, col.findFloor(0, 2000, z0).y, z0, Math.PI);
  player.setAction('idle');
  for (let t = 0; t < 90 && !log.includes('sign:castle_locked'); t++) tick({ stickY: 1 });
  assert.ok(log.includes('evil_laugh'));
  assert.ok(log.includes('sign:castle_locked'));
  assert.ok(player.pos.y > layout.CASTLE.baseY + 100, 'on the porch');
});

test('minion spawn spots in the real level are on dry land, on the real ground', () => {
  const { objects } = setup();
  const m = objects.minions;
  const rng = makeRng(5);
  let ok = 0;
  for (let k = 0; k < 400; k++) {
    const x = (rng() - 0.5) * 16000;
    const z = (rng() - 0.5) * 16000;
    const f = m.spawnFloor(x, z);
    if (!f) continue;
    ok++;
    const region = layout.regionAt(x, z);
    assert.ok(region === 'lawn' || region === 'island', region);
    assert.ok(col.waterLevelAt(x, z) < f.y, 'dry');
    assert.ok(Math.abs(f.y - layout.groundHeight(x, z)) <= MINION.GROUND_TOLERANCE, 'on the ground');
    assert.ok(Math.hypot(x - layout.CASTLE.x, z - layout.CASTLE.frontZ) >= MINION.DOOR_CLEAR);
  }
  assert.ok(ok > 60, `${ok} spots`);
});
