// Camera side of areas: setCollision points every probe the camera owns at another collision
// world (and drops the C-button probe made for the old one), so a wall of the old world no
// longer moves the camera; reset(player, { yaw }) snaps the orbit to a given yaw, which on the
// real castle porch puts the camera in front of Jonas instead of beside him.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { CameraController } from '../src/camera/CameraController.js';
import { Events } from '../src/core/events.js';
import { neutralController } from '../src/core/input.js';
import { Player } from '../src/player/Player.js';
import { CourseBuilder } from '../src/player/physics/testCourse.js';
import { buildLevel } from '../src/world/level.js';

// World A: open ground and a long wall across z -700..-500 (behind a hero at the origin facing
// +Z); world B: the same ground without the wall.
function worlds() {
  const a = new CourseBuilder();
  a.ground(8000);
  a.box(-2500, 0, -700, 2500, 3000, -500, { noBottom: true, terrain: 'stone' });
  const b = new CourseBuilder();
  b.ground(8000);
  return { A: a.build(), B: b.build() };
}

function makeCam(collision) {
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  return new CameraController({ collision, camera, events: new Events() });
}

function makeHero(x, y, z, faceYaw) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

function ctrl(over = {}) {
  const c = neutralController();
  for (const [k, v] of Object.entries(over)) c[k] = { down: v, pressed: v, released: false };
  return c;
}

// Every CollisionWorld reachable from `root` through own enumerable properties (not through
// three.js objects, event hubs, typed arrays or functions).
function worldsIn(root) {
  const found = new Set();
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof CollisionWorld) {
      found.add(v);
      return;
    }
    if (v.isObject3D || v.isVector3 || v instanceof Events || ArrayBuffer.isView(v)) return;
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(root);
  return [...found];
}

// The parts of the camera that probe the level.
const holders = (cam) => ({
  controller: cam.collision,
  collider: cam.collider.collision,
  crest: cam.collider.crest.collision,
  cover: cam.cover.collision,
  sight: cam.sight.collision,
  flight: cam.flight.collision,
  bossCam: cam.bossCam.collision,
});

test('setCollision: every probe follows the new world and the C-button probe is made again', () => {
  const { A, B } = worlds();
  const cam = makeCam(A);
  const hero = makeHero(0, 0, 3000, Math.PI);
  cam.reset(hero);
  cam.update(ctrl({ CL: true }), hero); // a C-button swing runs ahead on a probe collider
  assert.ok(cam._probe, 'the rotation probe exists');
  assert.equal(cam._probe.collision, A);
  assert.deepEqual(worldsIn(cam), [A]);

  cam.setCollision(B);
  for (const [name, world] of Object.entries(holders(cam))) assert.equal(world, B, name);
  assert.equal(cam._probe, null, 'the probe for the old world is dropped');
  assert.deepEqual(worldsIn(cam), [B], 'nothing reachable from the camera still holds world A');

  cam.reset(hero);
  for (let i = 0; i < 10; i++) cam.update(ctrl(), hero);
  cam.update(ctrl({ CR: true }), hero);
  assert.equal(cam._probe?.collision, B, 'a new probe in the new world');
  assert.deepEqual(worldsIn(cam), [B]);
});

test('a wall that exists only in the old world no longer moves the camera', () => {
  const { A, B } = worlds();
  const hero = makeHero(0, 0, 0, 0); // facing +Z: the orbit wants the camera at -Z, behind the wall in A
  const cam = makeCam(A);
  cam.reset(hero);
  const inA = cam.pos.clone();
  assert.ok(Math.abs(inA.x) > 500 || inA.z > -700, `in A the wall moves it: ${inA.toArray().map(Math.round)}`);

  cam.setCollision(B);
  cam.reset(hero);
  const check = (label) => {
    assert.ok(Math.abs(cam.pos.x) < 1, `${label}: straight behind (x ${cam.pos.x.toFixed(1)})`);
    assert.ok(cam.pos.z < -1000, `${label}: at full distance (z ${cam.pos.z.toFixed(0)})`);
    assert.equal(cam.collider.occluded, false, label);
  };
  check('after the reset');
  for (let i = 0; i < 30; i++) cam.update(ctrl(), hero);
  check('30 ticks later');
});

test('reset(player, { yaw }) on the real porch: the camera in front of Jonas, not beside him', () => {
  const level = buildLevel(new THREE.Scene());
  const player = new Player({ collision: level.collision, events: null, spawn: level.spawn });
  player.placeAt({ x: 0, y: 300, z: -470, yaw: 0 }); // on the landing, his back to the door
  assert.equal(player.action, 'idle');
  assert.ok(player.grounded && Math.abs(player.pos.y - 300) < 1, `on the porch (y ${player.pos.y})`);
  const cam = makeCam(level.collision);

  cam.reset(player);
  assert.ok(Math.abs(cam.pos.x) > 1000, `the default reset swings to the side (x ${cam.pos.x.toFixed(0)})`);

  cam.reset(player, { yaw: 0 });
  assert.ok(Math.abs(cam.pos.x) < 50, `x ${cam.pos.x.toFixed(0)}`);
  assert.ok(cam.pos.z > -470 + 1000, `in front of him (z ${cam.pos.z.toFixed(0)})`);
  assert.equal(cam.collider.occluded, false);
  let occluded = 0;
  for (let i = 0; i < 30; i++) {
    const c = neutralController();
    player.update(c, cam.getYaw());
    cam.update(c, player);
    occluded += cam.collider.occluded ? 1 : 0;
  }
  assert.equal(occluded, 0);
  assert.ok(cam.pos.z > -470 + 1000, 'it stays there');
});
