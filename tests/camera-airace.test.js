// AI RACE look-up (src/camera/lookup.js, cameraConfig LOOKUP_*): in AI RACE mode ('darkMode'
// { on }) the default follow view near the castle front tilts up (and, closer in, moves out and
// widens) so the robot beast's head on the front roof is in the picture while the hero stays at
// the bottom; the sunny framing is unchanged. The beast is the real one (objects/RobotBeast.js)
// risen on the real roof, its pose read from the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { CameraController } from '../src/camera/CameraController.js';
import { BEAST_HEAD } from '../src/camera/lookup.js';
import * as K from '../src/camera/cameraConfig.js';
import { Events } from '../src/core/events.js';
import { neutralController } from '../src/core/input.js';
import { angleDiff, makeRng } from '../src/core/math.js';
import { RobotBeast } from '../src/objects/RobotBeast.js';

const DEG = Math.PI / 180;
const scene = new THREE.Scene();
const level = buildLevel(scene);
scene.updateMatrixWorld(true);
const col = level.collision;
const L = level.layout;
const NEUTRAL = neutralController();

// The real beast risen onto the roof, having looked at the hero for a while (its neck and head
// track him); its landmarks: the head (pivot), the top of its head (crown) and the neck.
function risenBeast(hero) {
  const beast = new RobotBeast({ anchor: L.KAIJU, collision: col, events: new Events(), fire: null, rng: makeRng(5), launch() {} });
  beast.setMode(true);
  for (let t = 0; t < 160; t++) beast.update(hero, t);
  beast.animate(1, 160 / 30);
  const at = (o) => o.getWorldPosition(new THREE.Vector3());
  const head = at(beast.head);
  const crown = new THREE.Vector3(head.x, new THREE.Box3().setFromObject(beast.head).max.y, head.z);
  return { beast, head, crown, neck: at(beast.neck) };
}

function makeCam() {
  const events = new Events();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  return { events, camera, cam: new CameraController({ collision: col, camera, events }) };
}

function makeHero(x, z, faceYaw = Math.PI) {
  const y = col.findFloor(x, 3000, z).y;
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

// Pitch of the rendered view axis (deg, > 0 looking up), the field of view, and the hero's feet
// and head and the beast's landmarks on screen (NDC y, +1 = top edge).
function framing({ cam, camera }, hero, beast) {
  cam.apply(1);
  camera.updateMatrixWorld();
  const d = cam.target.clone().sub(cam.pos);
  const ndc = (v) => v.clone().project(camera).y;
  return {
    axis: Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG,
    fov: camera.fov,
    feet: ndc(new THREE.Vector3(hero.pos.x, hero.pos.y, hero.pos.z)),
    head: ndc(new THREE.Vector3(hero.pos.x, hero.pos.y + 175, hero.pos.z)),
    beastHead: beast ? ndc(beast.head) : 0,
    crown: beast ? ndc(beast.crown) : 0,
    neck: beast ? ndc(beast.neck) : 0,
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

test("in AI RACE mode the beast's head comes into the picture with the hero at the bottom: tilted up 10-20 deg, moved out and widened closer in", () => {
  // Lawn (z 1300 on), bridge and the island's edge: the whole head; the courtyard (right under
  // it): its neck.
  for (const z of [2800, 2200, 1500, 900, 600, 0]) {
    const hero = makeHero(0, z);
    const beast = risenBeast(hero);
    const sunny = makeCam();
    const dark = makeCam();
    sunny.cam.reset(hero);
    dark.cam.reset(hero);
    dark.events.emit('darkMode', { on: true });
    for (let i = 0; i < 150; i++) {
      sunny.cam.update(NEUTRAL, hero);
      dark.cam.update(NEUTRAL, hero);
    }
    const a = framing(sunny, hero, beast);
    const b = framing(dark, hero, beast);
    const tilt = b.axis - a.axis;
    const label = `z ${z}`;
    assert.equal(a.fov, K.FOV, `${label}: sunny field of view`);
    assert.ok(tilt > 10 && tilt < 20.5, `${label}: tilted up ${tilt.toFixed(1)} deg`);
    assert.ok(b.fov >= K.FOV && b.fov <= K.LOOKUP_FOV_MAX, `${label}: field of view ${b.fov.toFixed(1)}`);
    assert.ok(b.feet > -0.95 && b.feet < -0.8, `${label}: feet at ${b.feet.toFixed(2)}`);
    assert.ok(b.head < -0.4, `${label}: his head at ${b.head.toFixed(2)}`);
    assert.ok(Math.abs(angleDiff(sunny.cam.getYaw(), dark.cam.getYaw())) < 0.01 * DEG, `${label}: same heading`);
    // The sunny view misses the beast's head (and from the bridge in, its neck).
    assert.ok(a.beastHead > 1, `${label}: sunny view misses the head (${a.beastHead.toFixed(2)})`);
    if (z <= 1500) assert.ok(a.neck > 1, `${label}: sunny view misses the neck (${a.neck.toFixed(2)})`);
    assert.ok(b.neck < 0.95, `${label}: the neck in the picture (${b.neck.toFixed(2)})`);
    if (z >= 600) {
      assert.ok(b.beastHead < 0.85, `${label}: the head in the picture (${b.beastHead.toFixed(2)})`);
      assert.ok(b.crown < 0.95, `${label}: the top of the head in the picture (${b.crown.toFixed(2)})`);
    }
    // (Pulled out and widened only as far as it takes: from the far lawn a tilt nearly does.)
    if (z === 2800) assert.ok(dark.cam.lookUp.u < 0.4 && b.fov < 49, `${label}: barely widened (${b.fov.toFixed(1)})`);
  }
});

test("the look-up's framing target is where the model's head is", () => {
  for (const z of [2800, 1500, 900]) {
    const { head, crown } = risenBeast(makeHero(0, z));
    assert.ok(Math.abs(head.x - BEAST_HEAD.x) < 100, `head x ${head.x.toFixed(0)} vs ${BEAST_HEAD.x}`);
    assert.ok(BEAST_HEAD.y > head.y - 50 && BEAST_HEAD.y < crown.y, `head ${head.y.toFixed(0)}..${crown.y.toFixed(0)} vs ${BEAST_HEAD.y}`);
    assert.ok(Math.abs(head.z - BEAST_HEAD.z) < 150, `head z ${head.z.toFixed(0)} vs ${BEAST_HEAD.z}`);
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
  assert.equal(framing(dark, hero).fov, K.FOV, 'field of view');
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

test('a star celebration in AI RACE mode swings in as gently as in sunny mode: the look-up gives way, no dolly-in jump', () => {
  const run = (dark) => {
    const hero = makeHero(0, 300);
    const { cam, events } = makeCam();
    cam.reset(hero);
    if (dark) events.emit('darkMode', { on: true });
    for (let i = 0; i < 120; i++) cam.update(NEUTRAL, hero);
    const w0 = cam.lookUp.w;
    const trail = [cam.pos.clone()];
    hero.action = 'star_dance';
    for (let i = 0; i < 100; i++) {
      cam.update(NEUTRAL, hero);
      trail.push(cam.pos.clone());
    }
    const first = trail[1].distanceTo(trail[0]);
    let jerk = 0;
    for (let i = 2; i < trail.length; i++) jerk = Math.max(jerk, trail[i].clone().sub(trail[i - 1].clone().multiplyScalar(2)).add(trail[i - 2]).length());
    return { w0, w: cam.lookUp.w, first, jerk, dist: cam.dist, fov: cam.fov };
  };
  const sunny = run(false);
  const dark = run(true);
  assert.ok(dark.w0 > 0.95, `the look-up was on (${dark.w0.toFixed(2)})`);
  // (It swings round from further out in AI RACE mode, so it travels further, but it sets off
  // as gently: the first tick barely moves it, and no tick lurches.)
  assert.ok(sunny.first < 5 && dark.first < 5, `first tick of the swing: ${sunny.first.toFixed(1)} / ${dark.first.toFixed(1)} units`);
  assert.ok(sunny.jerk < 40 && dark.jerk < 55, `camera jerk ${sunny.jerk.toFixed(1)} / ${dark.jerk.toFixed(1)}`);
  // It made way for the close-up: the same framing as in sunny mode.
  assert.equal(dark.w, 0, 'the look-up has eased out');
  assert.equal(dark.fov, K.FOV, 'field of view');
  assert.ok(Math.abs(dark.dist - sunny.dist) < 2, `close-up distance ${dark.dist.toFixed(0)} vs ${sunny.dist.toFixed(0)}`);
});
