// AI RACE look-up (src/camera/lookup.js, cameraConfig LOOKUP_*): in AI RACE mode ('darkMode'
// { on }) the default follow view near the castle front tilts up so the robot beast on the front
// roof is in the picture while the hero stays at the bottom; the sunny framing is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { CameraController } from '../src/camera/CameraController.js';
import * as K from '../src/camera/cameraConfig.js';
import { Events } from '../src/core/events.js';
import { neutralController } from '../src/core/input.js';
import { angleDiff } from '../src/core/math.js';

const DEG = Math.PI / 180;
const scene = new THREE.Scene();
const level = buildLevel(scene);
scene.updateMatrixWorld(true);
const col = level.collision;
const L = level.layout;
const NEUTRAL = neutralController();

// Landmarks of the risen beast (objects/RobotBeast.js: sprawled along the front hall's ridge, its
// head out over the courtyard): hips, chest, neck, head.
const BEAST = [
  [0, 2770, -1650],
  [0, 3040, -1150],
  [0, 3150, -480],
  [0, 2770, 160],
].map((p) => new THREE.Vector3(...p));

function makeCam() {
  const events = new Events();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  return { events, camera, cam: new CameraController({ collision: col, camera, events }) };
}

function makeHero(x, z, faceYaw = Math.PI) {
  const y = col.findFloor(x, 3000, z).y;
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

// Pitch of the rendered view axis (deg, > 0 looking up), the hero's feet and head and the beast's
// landmarks on screen (NDC y, +1 = top edge).
function framing({ cam, camera }, hero) {
  cam.apply(1);
  camera.updateMatrixWorld();
  const d = cam.target.clone().sub(cam.pos);
  const ndc = (x, y, z) => new THREE.Vector3(x, y, z).project(camera).y;
  return {
    axis: Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG,
    feet: ndc(hero.pos.x, hero.pos.y, hero.pos.z),
    head: ndc(hero.pos.x, hero.pos.y + 175, hero.pos.z),
    beast: BEAST.map((p) => p.clone().project(camera).y),
  };
}

// A hero running along `path` (x, z waypoints) at 32 units per tick, on the floor.
function runner(hero, path) {
  let i = 0;
  return () => {
    const wp = path[Math.min(i, path.length - 1)];
    const dx = wp[0] - hero.pos.x;
    const dz = wp[1] - hero.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 40) {
      if (i < path.length - 1) i++;
      hero.forwardVel = 0;
      hero.vel.x = hero.vel.z = 0;
      return;
    }
    hero.faceYaw = Math.atan2(dx, dz);
    const s = Math.min(32, d);
    hero.forwardVel = s;
    hero.vel.x = (dx / d) * s;
    hero.vel.z = (dz / d) * s;
    hero.pos.x += hero.vel.x;
    hero.pos.z += hero.vel.z;
    hero.floor = col.findFloor(hero.pos.x, hero.pos.y + 100, hero.pos.z);
    hero.pos.y = hero.floor.y;
    hero.action = 'walking';
  };
}

test('in AI RACE mode near the castle front the view tilts up 10-18 deg: the beast comes into the picture, the hero stays at the bottom', () => {
  for (const z of [3000, 2200, 1500, 900, 0]) {
    const hero = makeHero(0, z);
    const sunny = makeCam();
    const dark = makeCam();
    sunny.cam.reset(hero);
    dark.cam.reset(hero);
    dark.events.emit('darkMode', { on: true });
    for (let i = 0; i < 150; i++) {
      sunny.cam.update(NEUTRAL, hero);
      dark.cam.update(NEUTRAL, hero);
    }
    const a = framing(sunny, hero);
    const b = framing(dark, hero);
    const tilt = b.axis - a.axis;
    const label = `z ${z}`;
    assert.ok(tilt > 10 && tilt < 18, `${label}: tilted up ${tilt.toFixed(1)} deg`);
    assert.ok(b.feet > -0.95 && b.feet < -0.8, `${label}: feet at ${b.feet.toFixed(2)}`);
    assert.ok(b.head < -0.4, `${label}: head at ${b.head.toFixed(2)}`);
    assert.ok(Math.abs(angleDiff(sunny.cam.getYaw(), dark.cam.getYaw())) < 0.01 * DEG, `${label}: same heading`);
    // The beast: out of the sunny picture (all but its hips from the lawn), in the dark one from
    // the lawn, its body at least from the bridge, the lower body right under it.
    const inFrame = (v) => v < 0.98;
    assert.ok(!inFrame(a.beast[2]) && !inFrame(a.beast[3]), `${label}: sunny view misses the beast's neck and head`);
    const shown = z >= 2200 ? 4 : z >= 900 ? 2 : 1;
    for (let k = 0; k < shown; k++) assert.ok(inFrame(b.beast[k]), `${label}: beast landmark ${k} at ${b.beast[k].toFixed(2)}`);
  }
});

test('the look-up waits for the beast to rise, eases in, and eases back out exactly when the mode ends', () => {
  const hero = makeHero(0, 2000);
  const sunny = makeCam();
  const dark = makeCam();
  sunny.cam.reset(hero);
  dark.cam.reset(hero);
  const tick = () => {
    sunny.cam.update(NEUTRAL, hero);
    dark.cam.update(NEUTRAL, hero);
    return framing(dark, hero).axis;
  };
  for (let i = 0; i < 30; i++) tick();
  const axis0 = framing(dark, hero).axis;
  dark.events.emit('darkMode', { on: true });
  let prev = axis0;
  let maxStep = 0;
  for (let i = 1; i <= 150; i++) {
    const axis = tick();
    if (i <= K.LOOKUP_DELAY) assert.equal(dark.cam.lookUp.w, 0, `tick ${i}: the beast is still rising`);
    maxStep = Math.max(maxStep, Math.abs(axis - prev));
    prev = axis;
    if (i === 90) assert.ok(dark.cam.lookUp.w > 0.9, `eased in by 3 s (${dark.cam.lookUp.w.toFixed(2)})`);
  }
  assert.ok(prev - axis0 > 10, `tilted up ${(prev - axis0).toFixed(1)} deg`);
  dark.events.emit('darkMode', { on: false });
  for (let i = 0; i < 300; i++) {
    const axis = tick();
    maxStep = Math.max(maxStep, Math.abs(axis - prev));
    prev = axis;
  }
  assert.ok(maxStep < 0.9, `eased (at most ${maxStep.toFixed(2)} deg per tick)`);
  assert.equal(dark.cam.lookUp.w, 0, 'back to exactly nothing');
  assert.equal(sunny.cam.lookUp.w, 0, 'never on without the mode');
  // The sunny framing is back: the same pose as a camera that never saw AI RACE mode.
  assert.ok(dark.cam.pos.distanceTo(sunny.cam.pos) < 0.5, `pose ${dark.cam.pos.distanceTo(sunny.cam.pos).toFixed(3)} apart`);
  assert.ok(dark.cam.target.distanceTo(sunny.cam.target) < 0.5, 'target');
});

test('leaving the zone, turning away from the castle, climbing high or flying eases the look-up out', () => {
  // Running away from the castle down the path, past ~4500 from the front.
  {
    const hero = makeHero(0, 1500);
    const { cam, events } = makeCam();
    cam.reset(hero);
    events.emit('darkMode', { on: true });
    for (let i = 0; i < 120; i++) cam.update(NEUTRAL, hero);
    assert.ok(cam.lookUp.w > 0.95, 'on at the bridge');
    // (He turns and runs south, the camera swings round behind him: facing away already.)
    const run = runner(hero, [[0, 6000]]);
    let w = [];
    for (let i = 0; i < 200; i++) {
      run();
      cam.update(NEUTRAL, hero);
      w.push(cam.lookUp.w);
    }
    assert.equal(cam.lookUp.w, 0, 'off away from the castle');
    for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i] - w[i - 1]) <= K.LOOKUP_OUT_RATE + 1e-9, 'eased');
  }
  // Facing away from the castle (the camera looks south over the lawn).
  {
    const hero = makeHero(0, 1500, 0);
    const { cam, events } = makeCam();
    cam.reset(hero);
    events.emit('darkMode', { on: true });
    for (let i = 0; i < 120; i++) cam.update(NEUTRAL, hero);
    assert.equal(cam.lookUp.w, 0, 'not while the camera faces away');
  }
  // Up high: on a roof over the courtyard.
  {
    const hero = makeHero(0, 1500);
    hero.pos.y = hero.floor.y = 1700;
    const { cam, events } = makeCam();
    cam.reset(hero);
    events.emit('darkMode', { on: true });
    for (let i = 0; i < 120; i++) cam.update(NEUTRAL, hero);
    assert.equal(cam.lookUp.w, 0, 'not from up high');
  }
  // Flying: the flight camera has its own framing.
  {
    const hero = makeHero(0, 2500);
    const { cam, events } = makeCam();
    cam.reset(hero);
    events.emit('darkMode', { on: true });
    for (let i = 0; i < 120; i++) cam.update(NEUTRAL, hero);
    assert.ok(cam.lookUp.w > 0.95);
    hero.action = 'flying';
    hero.pos.y += 500;
    hero.vel.z = -30;
    hero.forwardVel = 30;
    for (let i = 0; i < 60; i++) {
      hero.pos.z -= 20;
      cam.update(NEUTRAL, hero);
    }
    assert.equal(cam.flight.w, 1);
    assert.ok(cam.lookUp.w < 0.1, `eased out in flight (${cam.lookUp.w.toFixed(2)})`);
  }
});

test('the zone and the mode survive a respawn: a reset in the zone starts in the look-up, outside it without', () => {
  const { cam, events } = makeCam();
  events.emit('darkMode', { on: true });
  const hero = makeHero(0, 1500);
  cam.reset(hero);
  for (let i = 0; i <= K.LOOKUP_DELAY; i++) cam.update(NEUTRAL, hero);
  cam.update(NEUTRAL, hero);
  cam.reset(hero);
  cam.update(NEUTRAL, hero);
  assert.ok(cam.lookUp.w > 0.99, `set outright after a reset (${cam.lookUp.w.toFixed(2)})`);
  const s = level.spawn;
  const atSpawn = makeHero(s.x, s.z, s.yaw);
  cam.reset(atSpawn);
  cam.update(NEUTRAL, atSpawn);
  assert.equal(cam.lookUp.w, 0, 'the spawn is outside the zone');
  assert.ok(L.CASTLE.frontZ < 0);
});
