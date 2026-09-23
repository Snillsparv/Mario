import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ANCHORED_ACTION } from '../src/camera/cameraConfig.js';
import { NO_WATER } from '../src/core/constants.js';
import { angleDiff, makeRng, stickToWorldYaw } from '../src/core/math.js';
import { neutralController } from '../src/core/input.js';

const DEG = Math.PI / 180;

// Two CCW triangles (viewed from the side the face points to).
function quad(a, b, c, d) {
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

// Axis-aligned box with outward-facing sides and top.
function box(x0, x1, y0, y1, z0, z1) {
  return [
    ...quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]), // top
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]), // -z
    ...quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]), // +x
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
  ];
}

// Flat ground at y = 0, a tall wall at x = 1000..1200, a pool (water -60, floor -900)
// over x < -2000, and bumpy terrain for z > 4000.
function makeWorld() {
  const w = new CollisionWorld();
  w.addTriangles(quad([-2000, 0, 4000], [6000, 0, 4000], [6000, 0, -6000], [-2000, 0, -6000]));
  w.addTriangles(quad([-6000, -900, 4000], [-2000, -900, 4000], [-2000, -900, -6000], [-6000, -900, -6000]));
  w.addTriangles(box(1000, 1200, 0, 2000, -4000, 4000));
  // Bumpy strip: a sawtooth of ridges along z.
  for (let z = 4000; z < 9000; z += 500) {
    const h0 = (z / 500) % 2 ? 0 : 300;
    const h1 = 300 - h0;
    w.addTriangles(quad([-2000, h1, z + 500], [6000, h1, z + 500], [6000, h0, z], [-2000, h0, z]));
  }
  w.setWaterLevelFn((x, z) => (x < -2000 && z < 4000 ? -60 : NO_WATER));
  w.finalize();
  return w;
}

function makeHero(x, y, z, faceYaw = Math.PI) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

function ctrl(over = {}) {
  const c = neutralController();
  for (const [k, v] of Object.entries(over)) {
    if (typeof v === 'boolean') c[k] = { down: v, pressed: v, released: false };
    else c[k] = v;
  }
  return c;
}

function makeCam(world = makeWorld()) {
  const sfx = [];
  const events = { emit: (name, data) => name === 'sfx' && sfx.push(data.name) };
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 20, 40000);
  const cam = new CameraController({ collision: world, camera, events });
  return { cam, sfx, world, camera };
}

// Moves a fake hero like a simple player: stick relative to the camera, on the floor.
function moveHero(hero, world, stickX, stickY, camYaw, speed = 32) {
  const mag = Math.min(1, Math.hypot(stickX, stickY));
  if (mag > 0.1) {
    hero.faceYaw = stickToWorldYaw(stickX, stickY, camYaw);
    hero.forwardVel = speed * mag;
  } else hero.forwardVel = 0;
  hero.pos.x += Math.sin(hero.faceYaw) * hero.forwardVel;
  hero.pos.z += Math.cos(hero.faceYaw) * hero.forwardVel;
  const walls = world.findWalls(hero.pos.x, hero.pos.y, hero.pos.z, 60, 50);
  hero.pos.x = walls.x;
  hero.pos.z = walls.z;
  hero.floor = world.findFloor(hero.pos.x, hero.pos.y + 100, hero.pos.z);
  hero.pos.y = hero.floor.y;
}

test('C-left/C-right rotate the orbit by 45 degrees within ~6 ticks', () => {
  const { cam, sfx } = makeCam();
  const hero = makeHero(0, 0, 0);
  cam.reset(hero);
  const yaw0 = cam.getYaw();
  cam.update(ctrl({ CR: true }), hero);
  for (let i = 0; i < 6; i++) cam.update(ctrl(), hero);
  assert.ok(Math.abs(Math.abs(angleDiff(yaw0, cam.getYaw())) - 45 * DEG) < 0.5 * DEG, `rotated ${angleDiff(yaw0, cam.getYaw()) / DEG}`);
  assert.deepEqual(sfx, ['camera_move']);
  // The rotation is eased: no single tick turns more than a third of the step.
  const yaw1 = cam.getYaw();
  let maxStep = 0;
  let last = yaw1;
  cam.update(ctrl({ CL: true }), hero);
  for (let i = 0; i < 8; i++) {
    maxStep = Math.max(maxStep, Math.abs(angleDiff(last, cam.getYaw())));
    last = cam.getYaw();
    cam.update(ctrl(), hero);
  }
  assert.ok(Math.abs(angleDiff(yaw0, cam.getYaw())) < 0.5 * DEG, 'C-left undoes C-right');
  assert.ok(maxStep < 15 * DEG, `max step ${maxStep / DEG}`);
});

test('C-right moves the camera to its own right', () => {
  const { cam, camera } = makeCam();
  const hero = makeHero(0, 0, 0);
  cam.reset(hero);
  cam.apply(1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const before = cam.pos.clone();
  cam.update(ctrl({ CR: true }), hero);
  const moved = cam.pos.clone().sub(before);
  assert.ok(moved.dot(right) > 0);
});

test('getYaw basis matches stickToWorldYaw (stick up = away from camera, right = screen right)', () => {
  const { cam, camera } = makeCam();
  const hero = makeHero(300, 0, -200, 1.1);
  cam.reset(hero);
  for (let i = 0; i < 40; i++) cam.update(ctrl({ mouseDX: 7 }), hero);
  cam.apply(1);
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = stickToWorldYaw(0, 1, cam.getYaw());
  const rt = stickToWorldYaw(1, 0, cam.getYaw());
  const flat = (v) => new THREE.Vector2(v.x, v.z).normalize();
  const upDir = new THREE.Vector2(Math.sin(up), Math.cos(up));
  const rtDir = new THREE.Vector2(Math.sin(rt), Math.cos(rt));
  assert.ok(upDir.dot(flat(fwd)) > 0.999, 'stick up follows the view direction');
  assert.ok(rtDir.dot(flat(right)) > 0.999, 'stick right follows the screen right');
});

test('yaw only swings toward the hero while it moves, and running at the camera does not spin it', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(-1000, 0, 2000, 0);
  cam.reset(hero);
  hero.faceYaw = Math.PI / 2; // turn sideways without moving
  const yaw0 = cam.getYaw();
  for (let i = 0; i < 60; i++) cam.update(ctrl(), hero);
  assert.ok(Math.abs(angleDiff(yaw0, cam.getYaw())) < 1e-6, 'idle hero: camera stays put');

  // Run toward the camera for 2 s: the camera backs up instead of swinging around.
  for (let i = 0; i < 60; i++) {
    moveHero(hero, world, 0, -1, cam.getYaw());
    cam.update(ctrl(), hero);
  }
  assert.ok(Math.abs(angleDiff(yaw0, cam.getYaw())) < 5 * DEG, `drift ${angleDiff(yaw0, cam.getYaw()) / DEG}`);
  const d = Math.hypot(cam.pos.x - hero.pos.x, cam.pos.z - hero.pos.z);
  assert.ok(d > 1000, `kept its distance (${d})`);
});

test('sideways running circles the camera smoothly (bounded yaw rate)', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(-1000, 0, -2000, Math.PI);
  cam.reset(hero);
  let last = cam.getYaw();
  let total = 0;
  for (let i = 0; i < 120; i++) {
    moveHero(hero, world, 1, 0, cam.getYaw());
    cam.update(ctrl(), hero);
    const step = angleDiff(last, cam.getYaw());
    assert.ok(Math.abs(step) < 5 * DEG, `step ${step / DEG}`);
    total += step;
    last = cam.getYaw();
  }
  assert.ok(Math.abs(total) > 60 * DEG, `camera followed the circle (${total / DEG})`);
});

test('jumping does not lift the camera until the hero leaves the band', () => {
  const { cam } = makeCam();
  const hero = makeHero(-1000, 0, 0);
  cam.reset(hero);
  const y0 = cam.target.y;
  let vy = 42;
  let maxLift = 0;
  while (hero.pos.y >= 0) {
    hero.pos.y += vy;
    hero.vel.y = vy;
    vy -= 4;
    cam.update(ctrl(), hero);
    maxLift = Math.max(maxLift, cam.target.y - y0);
    if (hero.pos.y <= 0) break;
  }
  assert.ok(maxLift < 1, `single jump lifted the target by ${maxLift}`);
  // A much higher jump is followed once it leaves the band.
  vy = 80;
  hero.pos.y = 0;
  for (let i = 0; i < 20; i++) {
    hero.pos.y += vy;
    hero.vel.y = vy;
    vy -= 4;
    cam.update(ctrl(), hero);
  }
  assert.ok(cam.target.y - y0 > 200);
});

test('wall avoidance keeps the camera on the hero side of a wall', () => {
  const { cam, world } = makeCam();
  // Hero stands just west of the wall (x = 1000) facing west, so "behind" is inside the wall.
  const hero = makeHero(850, 0, 0, -Math.PI / 2);
  cam.reset(hero);
  const rng = makeRng(7);
  for (let i = 0; i < 400; i++) {
    const c = ctrl({ mouseDX: (rng() - 0.5) * 60, CL: rng() < 0.03, CR: rng() < 0.03 });
    moveHero(hero, world, Math.sin(i * 0.05), Math.cos(i * 0.031) * 0.5, cam.getYaw(), 12);
    hero.pos.x = Math.min(hero.pos.x, 940);
    cam.update(c, hero);
    assert.ok(cam.pos.x < 1000 - 20, `tick ${i}: camera x ${cam.pos.x.toFixed(1)} crossed the wall`);
  }
});

test('C-rotation into a wall is refused with a buzz', () => {
  const { cam, sfx } = makeCam();
  // Camera looks along the wall (hero faces -z); rotating toward +x would bury it.
  const hero = makeHero(900, 0, 0, Math.PI);
  cam.reset(hero);
  const yaw0 = cam.getYaw();
  // Camera sits at +z of the hero; C-right moves it toward +x (into the wall).
  cam.update(ctrl({ CR: true }), hero);
  for (let i = 0; i < 8; i++) cam.update(ctrl(), hero);
  assert.equal(sfx.at(-1), 'camera_buzz');
  assert.ok(Math.abs(angleDiff(yaw0, cam.getYaw())) < 1 * DEG);
});

test('never below the floor, and above the water unless the hero is submerged', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(0, 0, 3000, 0);
  cam.reset(hero);
  const rng = makeRng(3);
  for (let i = 0; i < 900; i++) {
    const c = ctrl({ mouseDY: (rng() - 0.3) * 40, mouseDX: (rng() - 0.5) * 30, CD: rng() < 0.01, CU: rng() < 0.01 });
    moveHero(hero, world, Math.sin(i * 0.02), 1, cam.getYaw(), 28);
    cam.update(c, hero);
    const floor = world.findFloor(cam.pos.x, cam.pos.y + 100, cam.pos.z).y;
    assert.ok(cam.pos.y > floor + 30, `tick ${i}: camera ${cam.pos.y.toFixed(1)} vs floor ${floor.toFixed(1)}`);
    if (!cam.firstPerson) assert.equal(cam.underwater, false, `tick ${i}: camera under water while hero is dry`);
  }
});

test('camera follows a submerged hero under water, and comes back up', () => {
  const { cam } = makeCam();
  const hero = makeHero(-4000, -80, 0, Math.PI);
  hero.inWater = true;
  cam.reset(hero);
  for (let i = 0; i < 30; i++) cam.update(ctrl(), hero);
  assert.equal(cam.underwater, false, 'swimming at the surface keeps the camera above');
  hero.pos.y = -500;
  let seen = false;
  for (let i = 0; i < 40; i++) {
    cam.update(ctrl(), hero);
    seen ||= cam.underwater;
  }
  assert.ok(seen && cam.underwater, 'camera dives with the hero');
  hero.pos.y = -80;
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  assert.equal(cam.underwater, false);
});

test('zoom steps, first-person look and hero-cam toggle', () => {
  const { cam, sfx } = makeCam();
  const hero = makeHero(-1000, 0, 0);
  cam.reset(hero);
  const dist = () => cam.pos.distanceTo(cam.target);
  const d0 = dist();
  cam.update(ctrl({ CD: true }), hero);
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  assert.ok(dist() > d0 + 400, 'C-down zooms out');
  cam.update(ctrl({ CD: true }), hero);
  assert.equal(sfx.at(-1), 'camera_buzz', 'no further zoom');
  cam.update(ctrl({ CU: true }), hero);
  cam.update(ctrl({ CU: true }), hero);
  assert.equal(cam.firstPerson, true);
  const yaw0 = cam.getYaw();
  for (let i = 0; i < 10; i++) cam.update(ctrl({ stickX: 1 }), hero);
  assert.ok(angleDiff(yaw0, cam.getYaw()) < -0.3, 'stick right looks right');
  cam.update(ctrl({ A: true }), hero);
  assert.equal(cam.firstPerson, false);
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  const lakitu = dist();
  cam.update(ctrl({ R: true }), hero);
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  assert.equal(cam.mode, 'hero');
  assert.ok(dist() < lakitu - 200, 'hero cam is tighter');
});

test('intro fly-in starts above the castle and settles behind the hero', async () => {
  const layout = await import('../src/world/layout.js');
  const { cam } = makeCam();
  const hero = makeHero(0, 0, 2500, Math.PI);
  cam.startIntro(hero);
  assert.ok(cam.pos.y > layout.CASTLE.keepTopY);
  let last = cam.pos.clone();
  for (let i = 0; i < 120; i++) {
    cam.update(ctrl(), hero);
    assert.ok(cam.pos.distanceTo(last) < 500, 'no jumps along the path');
    last = cam.pos.clone();
  }
  assert.equal(cam.mode, 'lakitu');
  assert.ok(cam.pos.z > hero.pos.z + 800, 'ends behind the hero');
  cam.titleOrbit(12.3);
  assert.ok(cam.pos.y >= 1500 && cam.pos.y <= 2500);
});

test('no NaN under random input and random hero motion', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(0, 0, 0);
  cam.reset(hero);
  const rng = makeRng(99);
  const btn = () => rng() < 0.05;
  for (let i = 0; i < 3000; i++) {
    if (rng() < 0.01) Object.assign(hero.pos, { x: (rng() - 0.5) * 12000, y: (rng() - 0.5) * 3000, z: (rng() - 0.5) * 12000 });
    hero.vel.y = (rng() - 0.5) * 80;
    hero.inWater = rng() < 0.2 ? undefined : rng() < 0.3;
    hero.faceYaw = rng() * 20 - 10;
    moveHero(hero, world, rng() * 2 - 1, rng() * 2 - 1, cam.getYaw(), rng() * 60);
    if (rng() < 0.2) hero.pos.y += rng() * 600;
    const c = ctrl({ A: btn(), B: btn(), R: btn(), CL: btn(), CR: btn(), CU: btn(), CD: btn(), mouseDX: (rng() - 0.5) * 400, mouseDY: (rng() - 0.5) * 400, stickX: rng() * 2 - 1, stickY: rng() * 2 - 1 });
    cam.update(c, hero);
    cam.apply(rng());
    for (const v of [cam.pos.x, cam.pos.y, cam.pos.z, cam.target.x, cam.target.y, cam.target.z, cam.getYaw()]) {
      assert.ok(Number.isFinite(v), `tick ${i}: non-finite camera state`);
    }
  }
});

// ---------------------------------------------------------------- follow lag, first person

test('the camera lags when the hero sets off and drifts to a stop after it halts', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(0, 0, 0, Math.PI);
  cam.reset(hero);
  const flat = () => Math.hypot(cam.pos.x - hero.pos.x, cam.pos.z - hero.pos.z);
  const d0 = flat();
  let maxGrow = 0;
  let firstStep = null;
  for (let i = 0; i < 60; i++) {
    const before = cam.pos.clone();
    moveHero(hero, world, 0, 1, cam.getYaw());
    cam.update(ctrl(), hero);
    firstStep ??= cam.pos.distanceTo(before);
    maxGrow = Math.max(maxGrow, flat() - d0);
  }
  assert.ok(firstStep < 32 * 0.5, `camera does not start with the hero (${firstStep.toFixed(1)})`);
  assert.ok(maxGrow > 50 && maxGrow < 110, `distance grew by ${maxGrow.toFixed(0)}`);
  const stopAt = cam.pos.clone();
  moveHero(hero, world, 0, 0, cam.getYaw());
  cam.update(ctrl(), hero);
  assert.ok(cam.pos.distanceTo(stopAt) > 5, 'keeps drifting after the hero halts');
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  assert.ok(Math.abs(flat() - d0) < 5, `settles back (${(flat() - d0).toFixed(1)})`);
});

test('first-person look only while standing still on the ground', () => {
  const { cam, sfx, world } = makeCam();
  const hero = makeHero(-1000, 0, 0);
  cam.reset(hero);
  // Running: refused with a buzz.
  for (let i = 0; i < 20; i++) {
    moveHero(hero, world, 0, 1, cam.getYaw());
    cam.update(ctrl(), hero);
  }
  cam.update(ctrl({ CU: true }), hero);
  assert.equal(cam.firstPerson, false);
  assert.equal(sfx.at(-1), 'camera_buzz');
  // Airborne: refused.
  hero.forwardVel = 0;
  hero.pos.y = 200;
  hero.vel.y = 20;
  cam.update(ctrl({ CU: true }), hero);
  assert.equal(cam.firstPerson, false);
  // Standing: allowed; starting to move leaves it again.
  hero.pos.y = 0;
  hero.vel.y = 0;
  cam.update(ctrl({ CU: true }), hero);
  assert.equal(cam.firstPerson, true);
  hero.forwardVel = 10;
  cam.update(ctrl(), hero);
  assert.equal(cam.firstPerson, false);
});

test('only pole / ledge hold actions count as standing', () => {
  for (const a of ['pole', 'ledge_hang', 'ledge_climb']) assert.ok(ANCHORED_ACTION.test(a), a);
  for (const a of ['pole_jump', 'ledge_grab_fall', 'jump', 'climbing_fall']) assert.ok(!ANCHORED_ACTION.test(a), a);
});

// ---------------------------------------------------------------- collision regressions

// Fake hero with gravity and swimming, walking along its facing (independent of the stick).
function stepFall(hero, world, speed) {
  hero.vel.x = Math.sin(hero.faceYaw) * speed;
  hero.vel.z = Math.cos(hero.faceYaw) * speed;
  hero.forwardVel = speed;
  hero.pos.x += hero.vel.x;
  hero.pos.z += hero.vel.z;
  hero.floor = world.findFloor(hero.pos.x, hero.pos.y + 100, hero.pos.z);
  const water = world.waterLevelAt(hero.pos.x, hero.pos.z);
  hero.inWater = water !== NO_WATER && hero.pos.y < water - 40;
  if (hero.inWater) hero.vel.y = hero.pos.y > water - 300 ? Math.max(hero.vel.y * 0.85, -15) : 0;
  else hero.vel.y = Math.max(hero.vel.y - 4, -75);
  hero.pos.y += hero.vel.y;
  if (hero.pos.y <= hero.floor.y) {
    hero.pos.y = hero.floor.y;
    hero.vel.y = 0;
  }
}

function headVisible(world, cam, hero) {
  const d = { x: hero.pos.x - cam.pos.x, y: hero.pos.y + 120 - cam.pos.y, z: hero.pos.z - cam.pos.z };
  return !world.raycast(cam.pos, d, Math.hypot(d.x, d.y, d.z));
}

function heroVisible(world, cam, hero) {
  const d = { x: hero.pos.x - cam.pos.x, y: hero.pos.y + 80 - cam.pos.y, z: hero.pos.z - cam.pos.z };
  return !world.raycast(cam.pos, d, Math.hypot(d.x, d.y, d.z));
}

test('walking up a clear 25 degree ramp does not pull the camera in', () => {
  // Flat ground for z > 0, then a ramp rising toward -z.
  const w = new CollisionWorld();
  const rise = 4000 * Math.tan(25 * DEG);
  w.addTriangles(quad([-3000, 0, 4000], [3000, 0, 4000], [3000, 0, 0], [-3000, 0, 0]));
  w.addTriangles(quad([-3000, 0, 0], [3000, 0, 0], [3000, rise, -4000], [-3000, rise, -4000]));
  w.finalize();
  const { cam } = makeCam(w);
  const hero = makeHero(0, 0, 1500, Math.PI);
  cam.reset(hero);
  for (let i = 0; i < 130; i++) {
    stepFall(hero, w, 30);
    cam.update(ctrl(), hero);
    assert.equal(cam.collider.viewRatio, 1, `tick ${i}: the line of sight is clear`);
    assert.ok(cam.collider.ratio > 0.9, `tick ${i}: ratio ${cam.collider.ratio.toFixed(2)} on a clear ramp`);
  }
  assert.ok(hero.pos.y > 900, 'the hero climbed the ramp');
});

test('dropping off a high ledge into water: smooth pull-in, hero stays in view', () => {
  // Plateau at y = 520 for z > 0 with a sheer face down to a pool (floor -800, water 0).
  const w = new CollisionWorld();
  w.addTriangles(quad([-3000, 520, 6000], [3000, 520, 6000], [3000, 520, 0], [-3000, 520, 0]));
  w.addTriangles(quad([3000, -800, 0], [-3000, -800, 0], [-3000, 520, 0], [3000, 520, 0])); // faces -z
  w.addTriangles(quad([-3000, -800, 0], [3000, -800, 0], [3000, -800, -4000], [-3000, -800, -4000]));
  w.setWaterLevelFn((x, z) => (z < 0 ? 0 : NO_WATER));
  w.finalize();
  const { cam } = makeCam(w);
  const hero = makeHero(0, 520, 1500, Math.PI);
  cam.reset(hero);
  let hidden = 0;
  let prev = cam.pos.clone();
  for (let i = 0; i < 120; i++) {
    const h0 = { ...hero.pos };
    stepFall(hero, w, i < 70 ? 30 : 0);
    cam.update(ctrl(), hero);
    const heroStep = Math.hypot(hero.pos.x - h0.x, hero.pos.y - h0.y, hero.pos.z - h0.z);
    const step = cam.pos.distanceTo(prev);
    assert.ok(step - heroStep < 150, `tick ${i}: camera jumped ${step.toFixed(0)} (hero ${heroStep.toFixed(0)})`);
    if (!heroVisible(w, cam, hero)) hidden++;
    prev = cam.pos.clone();
  }
  assert.ok(hero.pos.y < 0, 'the hero fell into the pool');
  assert.ok(hidden <= 3, `hero hidden for ${hidden} ticks`);
});

test('a thin plank grazed by the view ray does not make the camera shake', () => {
  // A thin tall plank beside the hero; the orbit sweeps slowly back and forth across the
  // yaw (~16.7 deg) at which the view ray grazes the plank's end.
  const w = new CollisionWorld();
  w.addTriangles(quad([-4000, 0, 4000], [4000, 0, 4000], [4000, 0, -4000], [-4000, 0, -4000]));
  w.addTriangles(box(300, 340, 0, 1500, 200, 1000));
  w.finalize();
  const { cam } = makeCam(w);
  const hero = makeHero(0, 0, 0, 12 * DEG + Math.PI);
  cam.reset(hero);
  let reversals = 0;
  let lastMove = 0;
  let bigSteps = 0;
  let blocked = 0;
  let prev = cam.pos.clone();
  for (let i = 0; i < 450; i++) {
    const yawRate = 5 * DEG * ((2 * Math.PI) / 150) * Math.sin((2 * Math.PI * i) / 150);
    cam.update(ctrl({ mouseDX: -yawRate / 0.006 }), hero);
    const p = cam.pos;
    assert.ok(!(p.x > 290 && p.x < 350 && p.z > 190 && p.z < 1010 && p.y < 1500), `tick ${i}: camera inside the plank`);
    const move = p.distanceTo(cam.target) - prev.distanceTo(cam.target);
    if (Math.abs(move) > 30) {
      if (lastMove && Math.sign(move) !== Math.sign(lastMove)) reversals++;
      lastMove = move;
    }
    if (p.distanceTo(prev) > 100) bigSteps++;
    if (cam.collider.viewRatio < 1) blocked++;
    prev = p.clone();
  }
  assert.ok(blocked > 50, `the plank blocks the view part of the time (${blocked} ticks)`);
  // Three sweeps cross the edge six times: the camera may pull in (and later ease out) once
  // per crossing, but must not flip back and forth every tick.
  assert.ok(reversals <= 6, `${reversals} in/out reversals`);
  assert.ok(bigSteps <= 6, `${bigSteps} large steps`);
});

test('diving under and surfacing ramps the camera through the water line', () => {
  const { cam } = makeCam();
  const hero = makeHero(-4000, -80, 0, Math.PI);
  hero.inWater = true;
  cam.reset(hero);
  for (let i = 0; i < 20; i++) cam.update(ctrl(), hero);
  let prevY = cam.pos.y;
  let prevStep = 0;
  for (let i = 0; i < 120; i++) {
    hero.vel.y = i < 30 ? -18 : i >= 70 && i < 100 ? 18 : 0;
    hero.pos.y += hero.vel.y;
    cam.update(ctrl(), hero);
    const step = cam.pos.y - prevY;
    assert.ok(Math.abs(step) < 90, `tick ${i}: vertical step ${step.toFixed(0)}`);
    assert.ok(Math.abs(step - prevStep) < 45, `tick ${i}: vertical speed jumped ${prevStep.toFixed(0)} -> ${step.toFixed(0)}`);
    prevY = cam.pos.y;
    prevStep = step;
  }
});

// ---------------------------------------------------------------- narrow / low blockers

// Octagonal prism of outward-facing walls (a tree trunk or post collider).
function prism(x, z, y0, y1, r) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const a = [x + Math.cos(a0) * r, z + Math.sin(a0) * r];
    const b = [x + Math.cos(a1) * r, z + Math.sin(a1) * r];
    out.push(...quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]));
  }
  return out;
}

function flatWorld(...solids) {
  const w = new CollisionWorld();
  w.addTriangles(quad([-5000, 0, 5000], [5000, 0, 5000], [5000, 0, -5000], [-5000, 0, -5000]));
  for (const s of solids) w.addTriangles(s);
  w.finalize();
  return w;
}

// Pitch of the view (camera looking down at its target), degrees.
function viewPitch(cam) {
  const d = cam.target.clone().sub(cam.pos);
  return (Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
}

// Tracks the worst ratio, per-tick step and view pitch over a run.
function watch(cam) {
  const w = { minRatio: 1, maxStep: 0, maxPitch: 0, prev: cam.pos.clone() };
  w.sample = () => {
    w.minRatio = Math.min(w.minRatio, cam.collider.ratio);
    w.maxStep = Math.max(w.maxStep, cam.pos.distanceTo(w.prev));
    w.maxPitch = Math.max(w.maxPitch, viewPitch(cam));
    w.prev = cam.pos.clone();
  };
  return w;
}

test('a thin post passing between the hero and the camera does not pull the camera in', () => {
  for (const gap of [100, 120]) {
    const w = flatWorld(prism(0, gap, 0, 900, 45));
    const { cam } = makeCam(w);
    const hero = makeHero(-700, 0, 0, Math.PI); // faces -z: the camera trails at +z, beyond the post
    cam.reset(hero);
    const m = watch(cam);
    for (let i = 0; i < 140; i++) {
      hero.pos.x += 10;
      hero.vel.x = 10;
      hero.forwardVel = 10;
      cam.update(ctrl(), hero);
      m.sample();
    }
    assert.ok(m.minRatio >= 0.35, `gap ${gap}: ratio ${m.minRatio.toFixed(2)}`);
    assert.ok(m.maxStep <= 130, `gap ${gap}: step ${m.maxStep.toFixed(0)}`);
    assert.ok(m.maxPitch <= 45, `gap ${gap}: view pitch ${m.maxPitch.toFixed(0)}`);
  }
});

test('grabbing a pole on the far side of its trunk: no collapse, the camera swings round', () => {
  const w = flatWorld(prism(0, 0, 0, 900, 45));
  const { cam } = makeCam(w);
  // Hero on the north side of the trunk facing it (+z); the camera starts south, behind the trunk.
  const hero = makeHero(0, 0, -75, Math.PI);
  cam.reset(hero);
  hero.faceYaw = 0;
  hero.action = 'pole';
  const m = watch(cam);
  let seenAt = -1;
  for (let i = 0; i < 90; i++) {
    hero.pos.y = Math.min(400, i * 6); // climbing
    hero.vel.y = 6;
    hero.floor = { y: 0, surface: null };
    cam.update(ctrl(), hero);
    m.sample();
    if (seenAt < 0 && heroVisible(w, cam, hero)) seenAt = i;
  }
  assert.ok(m.minRatio >= 0.35, `ratio ${m.minRatio.toFixed(2)}`);
  assert.ok(m.maxStep <= 130, `step ${m.maxStep.toFixed(0)}`);
  assert.ok(m.maxPitch <= 45, `view pitch ${m.maxPitch.toFixed(0)}`);
  assert.ok(seenAt >= 0 && seenAt < 45, `hero came into view at tick ${seenAt}`);
});

test('a low wall between the hero and the camera tilts the view over it instead of dollying in', () => {
  for (const [dist, height] of [[150, 200], [400, 300]]) {
    // Long wall across the view (x -2000..2000) `dist` south of the hero, `height` tall.
    const w = flatWorld(box(-2000, 2000, 0, height, dist, dist + 30));
    const { cam } = makeCam(w);
    const hero = makeHero(0, 0, 0, Math.PI / 2); // camera starts west, in the open
    cam.reset(hero);
    // Drag the orbit round to the south, behind the wall (over its top).
    for (let i = 0; i < 30; i++) cam.update(ctrl({ mouseDX: -(Math.PI / 2) / 0.006 / 30 }), hero);
    const m = watch(cam);
    let visible = 0;
    for (let i = 0; i < 60; i++) {
      cam.update(ctrl(), hero);
      m.sample();
      if (i >= 30 && headVisible(w, cam, hero)) visible++;
    }
    assert.ok(Math.abs(angleDiff(cam.getYaw(), Math.PI)) < 5 * DEG, 'the camera is south of the hero');
    assert.ok(m.minRatio >= 0.35, `wall ${height}@${dist}: ratio ${m.minRatio.toFixed(2)}`);
    assert.ok(m.maxPitch <= 45, `wall ${height}@${dist}: view pitch ${m.maxPitch.toFixed(0)}`);
    assert.ok(m.maxStep <= 130, `wall ${height}@${dist}: step ${m.maxStep.toFixed(0)}`);
    assert.equal(visible, 30, `wall ${height}@${dist}: hero's head visible once settled`);
    assert.ok(cam.collider.lift > 5 * DEG, `wall ${height}@${dist}: the view was tilted`);
  }
});

test('reset turns to an open side when the spot behind the hero is walled in', () => {
  const w = flatWorld(box(-2000, 2000, 0, 300, 150, 180));
  const { cam } = makeCam(w);
  const hero = makeHero(0, 0, 0, Math.PI); // "behind" is south, past the wall
  cam.reset(hero);
  assert.ok(headVisible(w, cam, hero), 'hero in view right away');
  assert.ok(cam.collider.ratio > 0.9, `ratio ${cam.collider.ratio.toFixed(2)}`);
});

// ---------------------------------------------------------------- underwater cramped spots

// Pool (floor -900, water -60) with a square pier x -5000..-4800, z -100..100.
function pierWorld() {
  const w = new CollisionWorld();
  w.addTriangles(quad([-6000, -900, 4000], [-2000, -900, 4000], [-2000, -900, -4000], [-6000, -900, -4000]));
  w.addTriangles(box(-5000, -4800, -900, 200, -100, 100));
  w.setWaterLevelFn(() => -60);
  w.finalize();
  return w;
}

function insideBody(cam, hero) {
  const h = Math.hypot(cam.pos.x - hero.pos.x, cam.pos.z - hero.pos.z);
  const dy = cam.pos.y - hero.pos.y;
  return h < 70 && dy > -20 && dy < 190;
}

test('a submerged hero backing onto a pier: camera stays out of its body and recovers once clear', () => {
  const w = pierWorld();
  const { cam } = makeCam(w);
  // Hero faces east with the camera west of it, between the hero and the pier.
  const hero = makeHero(-3000, -500, 0, Math.PI / 2);
  hero.inWater = true;
  cam.reset(hero);
  let minRatio = 1;
  for (let i = 0; i < 180; i++) {
    // Drift backwards (west) until hugging the pier, then bob along its face.
    hero.vel.x = hero.pos.x > -4740 ? -16 : 0;
    hero.pos.x = Math.max(-4740, hero.pos.x - 16);
    hero.vel.z = i > 110 ? 2 * Math.cos(i * 0.1) : 0;
    hero.pos.z += hero.vel.z;
    cam.update(ctrl(), hero);
    minRatio = Math.min(minRatio, cam.collider.ratio);
    assert.ok(!insideBody(cam, hero), `tick ${i}: camera inside the hero`);
    assert.equal(cam.underwater, true, `tick ${i}: camera follows under water`);
  }
  assert.ok(minRatio < 0.75, `the pier pushed the camera in (${minRatio.toFixed(2)})`);
  // Swim away from the pier: once the orbit ray is clear the distance comes back within ~1 s.
  let clearAt = -1;
  for (let i = 0; i < 120 && cam.collider.ratio < 0.9; i++) {
    hero.pos.x += 16;
    hero.vel.x = 16;
    hero.vel.z = 0;
    cam.update(ctrl(), hero);
    assert.ok(!insideBody(cam, hero), `swim ${i}: camera inside the hero`);
    if (clearAt < 0 && cam.collider.viewRatio === 1 && cam.collider.hardRatio === 1) clearAt = i;
    if (clearAt >= 0) assert.ok(i - clearAt <= 35, `ratio ${cam.collider.ratio.toFixed(2)} ${i - clearAt} ticks after clearing`);
  }
  assert.ok(cam.collider.ratio >= 0.9, `recovered to ${cam.collider.ratio.toFixed(2)}`);
});

test('a hero bobbing at the submerge threshold does not pump the camera through the surface', () => {
  const { cam } = makeCam();
  const hero = makeHero(-4000, -130, 0, Math.PI); // pool: water -60
  hero.inWater = true;
  cam.reset(hero);
  let lo = Infinity;
  let hi = -Infinity;
  let flips = 0;
  let last = cam.underwater;
  for (let i = 0; i < 200; i++) {
    const y = -60 - 150 + 12 * Math.sin(i * 0.5);
    hero.vel.y = y - hero.pos.y;
    hero.pos.y = y;
    cam.update(ctrl(), hero);
    if (i >= 60) {
      lo = Math.min(lo, cam.pos.y);
      hi = Math.max(hi, cam.pos.y);
      if (cam.underwater !== last) flips++;
    }
    last = cam.underwater;
  }
  assert.ok(hi - lo < 50, `camera height swings ${(hi - lo).toFixed(0)}`);
  assert.equal(flips, 0, 'camera keeps to one side of the surface');
});

// ---------------------------------------------------------------- first person in the game loop

test('first-person look holds the hero still in the game loop order (playerInput)', () => {
  const { cam, world } = makeCam();
  const hero = makeHero(-1000, 0, 0);
  cam.reset(hero);
  const withheld = [];
  // main.js order: player.update (with cam.playerInput) then cam.update.
  const tick = (c) => {
    const pc = cam.playerInput(c);
    withheld.push(pc.A.pressed || pc.stickX !== 0);
    moveHero(hero, world, pc.stickX, pc.stickY, cam.getYaw());
    cam.update(c, hero);
  };
  tick(ctrl({ CU: true }));
  assert.equal(cam.firstPerson, true);
  const p0 = { ...hero.pos };
  const yaw0 = cam.getYaw();
  for (let i = 0; i < 20; i++) {
    tick(ctrl({ stickX: 1, stickY: 0.3 }));
    assert.equal(cam.mode, 'first_person', `tick ${i}`);
  }
  assert.equal(Math.hypot(hero.pos.x - p0.x, hero.pos.z - p0.z), 0, 'the hero did not walk');
  assert.ok(angleDiff(yaw0, cam.getYaw()) < -0.3, 'the stick turned the view');
  tick(ctrl({ A: true }));
  assert.equal(cam.firstPerson, false, 'A leaves first person');
  assert.deepEqual(withheld, new Array(22).fill(false), 'the hero never saw the stick or A');
  assert.strictEqual(cam.playerInput(ctrl({ A: true })).A.pressed, true, 'orbit modes pass input through');
});

test('entering and leaving first person never passes through the head', () => {
  const { cam } = makeCam();
  const hero = makeHero(-1000, 0, 0, 0.7);
  cam.reset(hero);
  const head = new THREE.Vector3(hero.pos.x, hero.pos.y + 120, hero.pos.z);
  const check = (label) => {
    const atEye = cam.firstPerson && !cam.blend;
    assert.equal(cam.hideHero, atEye, `${label}: hideHero`);
    if (atEye) return;
    // Every rendered frame between the last two ticks stays clear of the head.
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      cam.apply(a);
      const d = cam.camera.position.distanceTo(head);
      assert.ok(d > 110, `${label} alpha ${a}: ${d.toFixed(0)} from the head`);
    }
  };
  cam.update(ctrl({ CU: true }), hero);
  for (let i = 0; i < 20; i++) {
    check(`enter ${i}`);
    cam.update(ctrl({ stickX: i < 5 ? 0.5 : 0 }), hero);
  }
  assert.equal(cam.hideHero, true, 'model hidden at the eye');
  cam.update(ctrl({ B: true }), hero);
  for (let i = 0; i < 20; i++) {
    check(`exit ${i}`);
    cam.update(ctrl(), hero);
  }
  assert.equal(cam.firstPerson, false);
});
