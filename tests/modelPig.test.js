import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIM_NAMES } from '../src/player/model/animations.js';
import { HANG_DEPTH, WALL_DIST } from '../src/player/model/physicsLink.js';

const sole = limb => limb.hoof.localToWorld(new Vector3(0, -14, 0));

function advance(model, anim, frames, extras = {}) {
  for (let i = 0; i < frames; i++) {
    model.update({ anim, animTime: i / 60, ...extras }, 1 / 60);
  }
}

test('Grisen stands on four hooves, trots in diagonal pairs and compresses on landing', () => {
  const pig = new PlayerModel('pig');
  const { frontL, frontR, hindL, hindR, body } = pig.rig;
  advance(pig, 'idle', 20);
  for (const limb of [frontL, frontR, hindL, hindR]) assert.ok(Math.abs(sole(limb).y) < 0.1);
  for (let i = 0; i < 45; i++) {
    pig.update({ anim: 'run', animTime: i / 60, forwardVel: 32, cyclePhase: i / 45 }, 1 / 60);
    if (i === 12 || i === 33) {
      assert.ok(Math.abs(sole(frontL).y - sole(hindR).y) < 0.05);
      assert.ok(Math.abs(sole(frontR).y - sole(hindL).y) < 0.05);
      assert.ok(Math.abs(sole(frontL).y - sole(frontR).y) > 9);
    }
  }
  advance(pig, 'jump', 20, { vy: 38 });
  advance(pig, 'land', 4);
  assert.ok(body.scale.y < 0.9);
  advance(pig, 'idle', 30);
  assert.equal(body.scale.y, 1);
});

test('Grisen reaches the ledge and supports himself on the pole tip', () => {
  const pig = new PlayerModel('pig');
  advance(pig, 'ledge_hang', 30);
  for (const limb of [pig.rig.frontL, pig.rig.frontR]) {
    const p = sole(limb);
    assert.ok(p.y >= HANG_DEPTH && p.y < HANG_DEPTH + 9);
    assert.ok(p.z >= WALL_DIST && p.z < WALL_DIST + 12);
  }
  advance(pig, 'pole_handstand', 45);
  for (const limb of [pig.rig.frontL, pig.rig.frontR]) {
    const p = sole(limb);
    assert.ok(Math.abs(p.y) < 1 && Math.abs(p.z) < 1);
  }
  assert.ok(sole(pig.rig.hindL).y > 70);
});

test('the pig follows every game pose, blinks and wears the pickup only while powered up', () => {
  const pig = new PlayerModel('pig');
  for (const anim of ANIM_NAMES) {
    advance(pig, anim, 10, { pos: { x: 12, y: 100, z: -33 }, yaw: 0.8, floorY: 0 });
    pig.object3D.traverse(part => assert.ok(part.matrixWorld.elements.every(Number.isFinite), anim));
  }
  assert.deepEqual(pig.object3D.position.toArray(), [12, 100, -33]);
  assert.equal(pig.object3D.rotation.y, 0.8);
  assert.equal(pig.rig.hat.visible, false);
  advance(pig, 'fly', 40, { wingHat: true });
  assert.ok(pig.rig.hat.visible && pig.wings.mesh.visible);
  advance(pig, 'idle', 30);
  pig.blinkIn = 0;
  advance(pig, 'idle', 5);
  assert.ok(pig.rig.eyes.every(eye => eye.scale.y < 0.3));
  advance(pig, 'idle', 20);
  assert.ok(pig.rig.eyes.every(eye => eye.scale.y > 0.97));
  assert.equal(pig.rig.hat.visible, false);
});
