// Camera framing regressions from the final polish pass: the published focus point, rising
// over a crest that hides the hero's legs, the swimmer under a low bridge deck, the star
// celebration close-up, and a reset beside a swimmer whose water flag is stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { CameraController } from '../src/camera/CameraController.js';
import { INTRO_TICKS, LOOK_HEIGHT } from '../src/camera/cameraConfig.js';
import { NO_WATER } from '../src/core/constants.js';
import { angleDiff } from '../src/core/math.js';
import { neutralController } from '../src/core/input.js';

const DEG = Math.PI / 180;

function quad(a, b, c, d) {
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

// Closed axis-aligned box, outward faces.
function box(x0, x1, y0, y1, z0, z1) {
  return [
    ...quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]), // top
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // bottom
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]), // -z
    ...quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]), // +x
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
  ];
}

function makeHero(x, y, z, faceYaw = Math.PI) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, forwardVel: 0, faceYaw, action: 'idle', floor: { y, surface: null } };
}

function ctrl(over = {}) {
  const c = neutralController();
  for (const [k, v] of Object.entries(over)) c[k] = typeof v === 'boolean' ? { down: v, pressed: v, released: false } : v;
  return c;
}

function makeCam(world) {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 20, 40000);
  const cam = new CameraController({ collision: world, camera, events: { emit() {} } });
  return { cam, camera };
}

// Whether the straight line from the camera to (x, y, z) is clear (opts: raycast kinds).
function sees(world, cam, x, y, z, opts) {
  const c = cam.pos;
  const d = { x: x - c.x, y: y - c.y, z: z - c.z };
  const len = Math.hypot(d.x, d.y, d.z);
  return !world.raycast({ x: c.x, y: c.y, z: c.z }, d, len - 5, opts);
}

test('apply() publishes the interpolated focus LOOK_HEIGHT above the feet, null without a hero', () => {
  const w = new CollisionWorld();
  w.addTriangles(quad([-5000, 0, 5000], [5000, 0, 5000], [5000, 0, -5000], [-5000, 0, -5000]));
  w.finalize();
  const { cam, camera } = makeCam(w);
  const hero = makeHero(0, 0, 0);
  cam.reset(hero);
  cam.update(ctrl(), hero);
  hero.pos.x = 100;
  hero.pos.y = 20;
  cam.update(ctrl(), hero);
  cam.apply(0.5);
  const f = camera.userData.focus;
  assert.ok(f, 'focus published');
  assert.ok(Math.abs(f.x - 50) < 1e-9 && Math.abs(f.y - (10 + LOOK_HEIGHT)) < 1e-9 && f.z === 0, JSON.stringify(f));
  cam.apply(1);
  assert.equal(camera.userData.focus, f, 'one object, reused (no per-frame garbage)');
  assert.equal(f.x, 100);

  // First-person look: no hero to keep in view.
  hero.pos.y = 0;
  for (let i = 0; i < 5; i++) cam.update(ctrl(), hero);
  cam.update(ctrl({ CU: true }), hero);
  for (let i = 0; i < 20; i++) cam.update(ctrl(), hero);
  assert.ok(cam.firstPerson);
  cam.apply(1);
  assert.equal(camera.userData.focus, null, 'first person');
  cam.update(ctrl({ CD: true }), hero);
  cam.apply(1);
  assert.ok(camera.userData.focus, 'back in the orbit');

  cam.titleOrbit(3);
  cam.apply(1);
  assert.equal(camera.userData.focus, null, 'title orbit');
  cam.startIntro(hero);
  cam.apply(1);
  assert.equal(camera.userData.focus, null, 'intro fly-in');
  for (let i = 0; i < INTRO_TICKS + 1; i++) cam.update(ctrl(), hero);
  cam.apply(1);
  assert.ok(camera.userData.focus, 'after the intro');
});

// A plateau (y = 300, z > 0) whose edge at z = 0 drops away in a 25 deg slope toward -z.
function ridgeWorld() {
  const w = new CollisionWorld();
  const k = Math.tan(25 * DEG);
  const h = (z) => (z > 0 ? 300 : 300 + z * k);
  for (let z = -3000; z < 3000; z += 250) {
    w.addTriangles(quad([-4000, h(z + 250), z + 250], [4000, h(z + 250), z + 250], [4000, h(z), z], [-4000, h(z), z]));
  }
  w.finalize();
  return { w, h };
}

test("the camera rises over a crest that hides the hero's legs, and never dollies in for it", () => {
  for (const withCrest of [false, true]) {
    const { w, h } = ridgeWorld();
    const { cam } = makeCam(w);
    if (!withCrest) cam.collider.crest.needed = () => 0; // the defect, for comparison
    // Walking down past the edge (toward -z) with the camera trailing on the plateau behind:
    // the sight fan to the look point stays clear while the edge hides the legs.
    const hero = makeHero(0, h(-120), -120, Math.PI);
    cam.reset(hero);
    let hidden = 0;
    let minDist = Infinity;
    let prevY = cam.pos.y;
    let maxStep = 0;
    for (let i = 0; i < 70; i++) {
      const moving = i < 20;
      hero.pos.z -= moving ? 10 : 0;
      hero.vel.z = moving ? -10 : 0;
      hero.forwardVel = moving ? 10 : 0;
      hero.pos.y = hero.floor.y = h(hero.pos.z);
      cam.update(ctrl(), hero);
      if (i >= 10 && !sees(w, cam, hero.pos.x, hero.pos.y + 30, hero.pos.z, { walls: false, ceilings: false })) hidden++;
      minDist = Math.min(minDist, Math.hypot(cam.pos.x - hero.pos.x, cam.pos.z - hero.pos.z));
      maxStep = Math.max(maxStep, Math.abs(cam.pos.y - prevY));
      prevY = cam.pos.y;
    }
    if (!withCrest) {
      assert.ok(hidden > 30, `the test ridge hides the legs without the fix (${hidden} ticks)`);
      continue;
    }
    assert.equal(hidden, 0, `legs hidden for ${hidden} ticks`);
    assert.ok(minDist > 1100, `the camera kept its distance (${minDist.toFixed(0)})`);
    assert.ok(maxStep < 65, `smooth rise (${maxStep.toFixed(1)} per tick)`);
  }
});

test('a rock or bush hiding only the feet is not a crest (too narrow)', () => {
  const w = new CollisionWorld();
  w.addTriangles(quad([-5000, 0, 5000], [5000, 0, 5000], [5000, 0, -5000], [-5000, 0, -5000]));
  // A small mound (sloped faces are floors) hiding the hero's feet, not his body.
  const top = [0, 150, 300];
  const ring = [[-60, 0, 240], [60, 0, 240], [60, 0, 360], [-60, 0, 360]];
  for (let i = 0; i < 4; i++) w.addTriangles([...ring[(i + 1) % 4], ...ring[i], ...top]);
  w.finalize();
  const { cam } = makeCam(w);
  const hero = makeHero(0, 0, 0, Math.PI);
  cam.reset(hero);
  for (let i = 0; i < 30; i++) cam.update(ctrl(), hero);
  assert.equal(cam.collider.crestRise, 0);
});

// A moat along x (water 0, bed -900, banks at z = +-1100) under a low deck (x -350..350,
// underside 60) on stringers and a trestle across it at z = 300, like the drawbridge.
function bridgeWorld() {
  const w = new CollisionWorld();
  w.addTriangles(quad([-6000, -900, 1100], [6000, -900, 1100], [6000, -900, -1100], [-6000, -900, -1100]));
  w.addTriangles(box(-6000, 6000, -900, 100, 1100, 1400)); // south bank
  w.addTriangles(box(-6000, 6000, -900, 100, -1400, -1100)); // north bank
  w.addTriangles(box(-350, 350, 60, 100, -1400, 1400)); // deck
  for (const s of [-1, 1]) {
    w.addTriangles(box(s * 230 - 25, s * 230 + 25, 0, 60, -1100, 1100)); // stringers
    w.addTriangles(box(s * 230 - 30, s * 230 + 30, -900, -40, 270, 330)); // trestle posts
  }
  w.addTriangles(box(-310, 310, -40, 10, 264, 336)); // trestle cap
  w.setWaterLevelFn((x, z) => (Math.abs(z) < 1100 ? 0 : NO_WATER));
  w.finalize();
  return w;
}

test('a swimmer under a low deck: the camera ducks under the surface to keep him in view', () => {
  for (const withCover of [false, true]) {
    const w = bridgeWorld();
    const { cam } = makeCam(w);
    if (!withCover) cam.cover.lowCover = () => false; // the defect, for comparison
    const hero = makeHero(1600, -80, 150, -Math.PI / 2); // surface swimmer heading west
    hero.inWater = true;
    cam.reset(hero);
    let hidden = 0;
    let under = 0;
    for (let i = 0; i < 260; i++) {
      // Swim under the deck, idle there, then swim out west and wait.
      const v = i < 80 ? -20 : i >= 140 && i < 220 ? -20 : 0;
      hero.pos.x += v;
      hero.vel.x = v;
      hero.forwardVel = Math.abs(v);
      cam.update(ctrl(), hero);
      if (Math.abs(hero.pos.x) < 330) {
        under++;
        if (!sees(w, cam, hero.pos.x, hero.pos.y + 50, hero.pos.z) && !sees(w, cam, hero.pos.x, hero.pos.y + 130, hero.pos.z)) hidden++;
      }
    }
    if (!withCover) {
      assert.ok(hidden > under / 2, `the test deck hides the swimmer without the fix (${hidden}/${under})`);
      continue;
    }
    assert.ok(under > 60);
    assert.ok(hidden <= 3, `hidden ${hidden} of ${under} ticks under the deck`);
    assert.equal(cam.underwater, false, 'back above the water once clear of the deck');
    assert.ok(cam.pos.x > hero.pos.x + 800, 'trailing the swimmer again');
  }
});

test('under the deck the camera stays below the water and sees past the trestle', () => {
  const w = bridgeWorld();
  const { cam } = makeCam(w);
  // Pressed against the trestle's south side, the camera starting diagonally behind it.
  const hero = makeHero(0, -80, 390, 0);
  hero.inWater = true;
  cam.reset(hero);
  cam._setOrbitYaw(150 * DEG);
  for (let i = 0; i < 60; i++) cam.update(ctrl(), hero);
  assert.equal(cam.hero.covered, true);
  assert.equal(cam.underwater, true);
  assert.ok(cam.pos.y < -20 && cam.pos.y > -300, `camera height ${cam.pos.y.toFixed(0)}`);
  assert.ok(sees(w, cam, hero.pos.x, hero.pos.y + 50, hero.pos.z), 'hips in view');
});

test('the star celebration swings round to the hero front, then back', () => {
  const w = new CollisionWorld();
  w.addTriangles(quad([-5000, 0, 5000], [5000, 0, 5000], [5000, 0, -5000], [-5000, 0, -5000]));
  w.addTriangles(box(-2000, 2000, 0, 1500, -1000, -800)); // a facade 800 in front of the hero
  w.finalize();
  const { cam } = makeCam(w);
  const hero = makeHero(0, 0, 0, Math.PI); // faces the facade, camera behind
  cam.reset(hero);
  for (let i = 0; i < 20; i++) cam.update(ctrl(), hero);
  const yaw0 = cam.yaw;
  hero.action = 'star_dance';
  for (let i = 0; i < 40; i++) cam.update(ctrl({ CL: i === 5 }), hero);
  const toCam = Math.atan2(cam.pos.x - hero.pos.x, cam.pos.z - hero.pos.z);
  assert.ok(Math.abs(angleDiff(hero.faceYaw, toCam)) < 60 * DEG, `camera ${(angleDiff(hero.faceYaw, toCam) / DEG).toFixed(0)} deg off the front`);
  assert.ok(Math.hypot(cam.pos.x, cam.pos.z) < 650, 'close-up');
  assert.ok(cam.pos.z > -800, 'in front of the facade');
  hero.action = 'idle';
  for (let i = 0; i < 30; i++) cam.update(ctrl(), hero);
  assert.equal(cam.celebration, null);
  assert.ok(Math.abs(angleDiff(cam.yaw, yaw0)) < 2 * DEG, `back to the orbit it left (${(angleDiff(cam.yaw, yaw0) / DEG).toFixed(1)} deg)`);

  // Running off right after the dance hands the camera straight back to the player.
  hero.action = 'star_dance';
  for (let i = 0; i < 40; i++) cam.update(ctrl(), hero);
  hero.action = 'walking';
  hero.forwardVel = 20;
  cam.update(ctrl(), hero);
  cam.update(ctrl(), hero);
  assert.equal(cam.celebration, null);
});

test('a reset beside a swimmer whose water flag is stale still follows it under water', () => {
  const w = bridgeWorld();
  const { cam } = makeCam(w);
  const hero = makeHero(2000, -500, 0, 0);
  hero.inWater = false; // right after a teleport, before the player's next tick
  cam.reset(hero);
  assert.equal(cam.hero.submerged, true);
  assert.equal(cam.underwater, true);
});

test('the camera sits lower over an open slope falling toward the hero, but not over a drop-off', () => {
  const k = Math.tan(12 * DEG);
  // Flat ground (y = 0) for z < 200, then either a 12 deg slope or a 300-high step behind the
  // hero (who faces -z, so the camera trails over it).
  for (const shape of ['slope', 'step']) {
    const w = new CollisionWorld();
    w.addTriangles(quad([-4000, 0, 200], [4000, 0, 200], [4000, 0, -4000], [-4000, 0, -4000]));
    if (shape === 'slope') {
      w.addTriangles(quad([-4000, k * 3800, 4000], [4000, k * 3800, 4000], [4000, 0, 200], [-4000, 0, 200]));
    } else {
      w.addTriangles(quad([-4000, 300, 4000], [4000, 300, 4000], [4000, 300, 900], [-4000, 300, 900]));
      w.addTriangles(quad([-4000, 0, 900], [4000, 0, 900], [4000, 300, 900], [-4000, 300, 900])); // faces -z
    }
    w.finalize();
    const { cam } = makeCam(w);
    const hero = makeHero(0, 0, 0, Math.PI);
    cam.reset(hero);
    for (let i = 0; i < 60; i++) cam.update(ctrl(), hero);
    const ground = w.findFloor(cam.pos.x, cam.pos.y, cam.pos.z).y;
    const clearance = cam.pos.y - ground;
    if (shape === 'slope') assert.ok(clearance > 50 && clearance < 110, `slope: ${clearance.toFixed(0)} over the ground`);
    else assert.ok(clearance > 140, `step: ${clearance.toFixed(0)} over the ground`);
  }
});
