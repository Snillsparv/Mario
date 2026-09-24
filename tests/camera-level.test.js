// Camera regressions on the real level (built once): the opening view at the spawn, a scripted
// hero running down the east hill, and a scripted swimmer rounding the island's front corners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { CameraController } from '../src/camera/CameraController.js';
import { neutralController } from '../src/core/input.js';

const scene = new THREE.Scene();
const level = buildLevel(scene);
scene.updateMatrixWorld(true);
const L = level.layout;
const DEG = Math.PI / 180;

function makeCam() {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000);
  return { cam: new CameraController({ collision: level.collision, camera, events: { emit() {} } }), camera };
}

function makeHero(x, y, z, faceYaw) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

// World-space vertices of the castle's front: its corner and facade towers with their roofs and
// flags (the keep further back is too tall to fit over the hero from the spawn).
const castleFront = [];
scene.traverse((o) => {
  if (!o.isMesh || !/castle/i.test(o.name)) return;
  const p = o.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
    if (v.z > -1500 && v.z < L.CASTLE.frontZ + 200 && v.y > 2000) castleFront.push(v.clone());
  }
});

// Screen height (NDC: +1 top) of the highest castle-front vertex and of the hero's feet.
function framing(cam, camera, hero) {
  cam.apply(1);
  camera.updateMatrixWorld();
  let top = -Infinity;
  const q = new THREE.Vector3();
  for (const v of castleFront) top = Math.max(top, q.copy(v).project(camera).y);
  const feet = q.set(hero.pos.x, hero.pos.y, hero.pos.z).project(camera).y;
  const head = q.set(hero.pos.x, hero.pos.y + 175, hero.pos.z).project(camera).y;
  return { top, feet, head };
}

test('the opening view: the castle towers and their flags fit under the top edge, the hero stands in the lower middle', () => {
  assert.ok(castleFront.length > 100, 'castle front found');
  const TOP = Math.tan(21.5 * DEG) / Math.tan(22.5 * DEG); // 1 deg inside the top edge
  const { cam, camera } = makeCam();
  const s = level.spawn;
  const hero = makeHero(s.x, L.groundHeight(s.x, s.z), s.z, s.yaw);
  const check = (label) => {
    const f = framing(cam, camera, hero);
    assert.ok(f.top < TOP, `${label}: castle top at ${f.top.toFixed(3)} (limit ${TOP.toFixed(3)})`);
    assert.ok(f.feet > -0.85 && f.feet < -0.5, `${label}: feet at ${f.feet.toFixed(2)}`);
    assert.ok(f.head < -0.2, `${label}: head at ${f.head.toFixed(2)}`);
  };
  cam.reset(hero);
  check('reset');
  for (let i = 0; i < 60; i++) cam.update(neutralController(), hero);
  check('standing');
  // The fly-in lands on the same view.
  cam.startIntro(hero);
  for (let i = 0; i < 140; i++) cam.update(neutralController(), hero);
  check('after the intro');
  // The lawn climbs ~12 deg behind the spawn: the camera sits lower than the usual 150 over it.
  const ground = L.groundHeight(cam.pos.x, cam.pos.z);
  assert.ok(cam.pos.y - ground < 100, `${(cam.pos.y - ground).toFixed(0)} over the lawn`);
});

test('running down the east hill: the camera never pops in (no single-tick dolly jumps)', () => {
  for (const [x0, z0, yaw] of [[6500, -2600, -Math.PI / 2], [6200, -2000, -2.3], [5000, -2600, Math.PI / 2]]) {
    const { cam } = makeCam();
    const hero = makeHero(x0, L.groundHeight(x0, z0), z0, yaw);
    cam.reset(hero);
    let prev = cam.pos.clone();
    let worst = 0;
    let ticks = 0;
    for (let i = 0; i < 90; i++) {
      const s = i < 4 ? 0 : 37; // a full run
      const nx = hero.pos.x + Math.sin(yaw) * s;
      const nz = hero.pos.z + Math.cos(yaw) * s;
      if (L.regionAt(nx, nz) !== 'lawn' || L.groundHeight(nx, nz) < 90) break; // down to the moat's rim
      const ny = L.groundHeight(nx, nz);
      hero.vel = { x: nx - hero.pos.x, y: ny - hero.pos.y, z: nz - hero.pos.z };
      hero.forwardVel = s;
      hero.action = s ? 'running' : 'idle';
      hero.pos = { x: nx, y: ny, z: nz };
      hero.floor.y = ny;
      cam.update(neutralController(), hero);
      if (i > 0) worst = Math.max(worst, cam.pos.distanceTo(prev));
      prev = cam.pos.clone();
      ticks++;
    }
    assert.ok(ticks > 50, `ran ${ticks} ticks`);
    // (Before the fix a pull-in moved the camera ~160 in a tick, over 4x the hero's step.)
    assert.ok(worst < 3 * 37, `from ${x0},${z0}: the camera moved ${worst.toFixed(0)} in a tick`);
  }
});

test("a swimmer rounding the island's front corners is not hidden behind its wall for long", () => {
  const water = L.WATER_LEVEL;
  for (const depth of [water - 80, water - 680]) {
    for (const side of [1, -1]) {
      const { cam } = makeCam();
      // Down the east (side 1) or west arm of the moat close to the island, round its rounded
      // corner and along the front.
      const R = L.ISLAND.radius + 70;
      const cx = side * (L.ISLAND.maxX - L.ISLAND.radius);
      const cz = L.ISLAND.maxZ - L.ISLAND.radius;
      const path = [];
      for (let z = cz - 2500; z < cz; z += 25) path.push([cx + side * R, z]);
      for (let a = 0; a <= Math.PI / 2; a += 25 / R) path.push([cx + side * Math.cos(a) * R, cz + Math.sin(a) * R]);
      for (let x = cx; Math.abs(x) > 900; x -= side * 25) path.push([x, cz + R]);
      const hero = makeHero(path[0][0], depth, path[0][1], 0);
      hero.inWater = true;
      hero.action = 'swim_stroke';
      cam.reset(hero);
      let run = 0;
      let longest = 0;
      for (let i = 1; i < path.length; i++) {
        const [x, z] = path[i];
        hero.vel = { x: x - path[i - 1][0], y: 0, z: z - path[i - 1][1] };
        hero.forwardVel = 25;
        hero.faceYaw = Math.atan2(hero.vel.x, hero.vel.z);
        hero.pos.x = x;
        hero.pos.z = z;
        cam.update(neutralController(), hero);
        const c = cam.pos;
        const d = { x: x - c.x, y: depth + 80 - c.y, z: z - c.z };
        const hidden = level.collision.raycast({ x: c.x, y: c.y, z: c.z }, d, Math.hypot(d.x, d.y, d.z) - 40);
        run = hidden ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      // (Before the fix: 37-41 ticks.)
      assert.ok(longest <= 12, `depth ${depth}, side ${side}: chest hidden for ${longest} ticks in a row`);
    }
  }
});
