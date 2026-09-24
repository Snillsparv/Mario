// Winged-hat flight camera (src/camera/flight.js, cameraConfig FLY_*): a scripted fake flying
// hero (high-speed arcs, dives toward the ground, banking turns round a corner tower of the
// castle) and the real Player's flight over the real grounds, plus the collider's tolerant mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { CameraController } from '../src/camera/CameraController.js';
import { CameraCollider } from '../src/camera/CameraCollider.js';
import * as K from '../src/camera/cameraConfig.js';
import { Player } from '../src/player/Player.js';
import { Events } from '../src/core/events.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { angleDiff, approach } from '../src/core/math.js';
import { neutralController } from '../src/core/input.js';

const DEG = Math.PI / 180;
const scene = new THREE.Scene();
const level = buildLevel(scene);
scene.updateMatrixWorld(true);
const col = level.collision;

function makeCam(collision = col) {
  const sfx = [];
  const events = new Events();
  events.on('sfx', (e) => sfx.push(e.name));
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  return { cam: new CameraController({ collision, camera, events }), camera, sfx, events };
}

function ctrl(over = {}) {
  const c = neutralController();
  for (const [k, v] of Object.entries(over)) {
    if (typeof v === 'boolean') c[k] = { down: v, pressed: v, released: false };
    else c[k] = v;
  }
  return c;
}

// A fake flying hero, kinematics like the Player's flight (air speed along heading and pitch,
// pitch > 0 nose down, bank turns the heading) but scripted: step({ speed, pitch, bank }). It
// touches down on the first floor it reaches (a belly slide to a stop, then idle).
class Flyer {
  constructor(x, y, z, yaw, collision = col) {
    this.collision = collision;
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.faceYaw = yaw;
    this.forwardVel = 0;
    this.pitch = 0.1;
    this.roll = 0;
    this.action = 'flying';
    this.floor = collision.findFloor(x, y, z);
  }

  step({ speed = 40, pitch = 0.1, bank = 0 } = {}) {
    const p = this.pos;
    if (this.action === 'flying') {
      this.pitch = approach(this.pitch, pitch, 0.08);
      this.roll = approach(this.roll, bank, 0.07);
      this.faceYaw -= this.roll * 0.08;
      this.forwardVel = speed * Math.cos(this.pitch);
      this.vel.y = -speed * Math.sin(this.pitch);
    } else {
      this.pitch = this.roll = 0;
      this.forwardVel = Math.max(0, this.forwardVel - 3);
      this.vel.y = 0;
      this.action = this.forwardVel > 0 ? 'belly_slide' : 'idle';
    }
    this.vel.x = this.forwardVel * Math.sin(this.faceYaw);
    this.vel.z = this.forwardVel * Math.cos(this.faceYaw);
    p.x += this.vel.x;
    p.y += this.vel.y;
    p.z += this.vel.z;
    this.floor = this.collision.findFloor(p.x, p.y + 100, p.z);
    if (this.floor.surface && p.y <= this.floor.y) {
      p.y = this.floor.y;
      if (this.action === 'flying') this.action = 'belly_slide';
    }
  }
}

// Records per-tick camera metrics while `run(tick)` drives the hero and the camera.
function watch(cam, camera, hero) {
  const m = { rows: [], maxJerk: 0, maxTurn: 0, maxTurnAccel: 0, prev: null, prev2: null, dir: null, turn: 0 };
  m.sample = (label = '') => {
    cam.apply(1);
    camera.updateMatrixWorld();
    const p = cam.pos.clone();
    if (m.prev && m.prev2 && !cam.cut) m.maxJerk = Math.max(m.maxJerk, p.clone().sub(m.prev.clone().multiplyScalar(2)).add(m.prev2).length());
    const dir = cam.target.clone().sub(cam.pos).normalize();
    if (m.dir) {
      const turn = Math.acos(Math.min(1, dir.dot(m.dir))) / DEG;
      m.maxTurn = Math.max(m.maxTurn, turn);
      m.maxTurnAccel = Math.max(m.maxTurnAccel, Math.abs(turn - m.turn));
      m.turn = turn;
    }
    m.prev2 = m.prev;
    m.prev = p;
    m.dir = dir;
    const hx = cam.pos.x - hero.pos.x;
    const hz = cam.pos.z - hero.pos.z;
    const chest = new THREE.Vector3(hero.pos.x, hero.pos.y + 80, hero.pos.z);
    const ndc = chest.clone().project(camera);
    const hidden = !cam.collider.lineClear(chest, cam.pos);
    const row = {
      label,
      h: Math.hypot(hx, hz),
      d: cam.pos.distanceTo(chest),
      lag: angleDiff(hero.faceYaw + Math.PI, Math.atan2(hx, hz)) / DEG,
      down: Math.atan2(cam.pos.y - chest.y, Math.hypot(hx, hz)) / DEG, // view angle down to his chest
      ndcX: ndc.x,
      ndcY: ndc.y,
      hidden,
      w: cam.flight.w,
      camY: cam.pos.y,
    };
    m.rows.push(row);
    return row;
  };
  return m;
}

test('the flight camera swings to straight behind his heading, trails ~1100-1300 out, and lags a touch in a banked turn', () => {
  const { cam, camera } = makeCam();
  const f = new Flyer(0, 1500, 6300, Math.PI); // over the lawn, heading for the castle
  cam.reset(f);
  assert.equal(cam.flight.w, 1, 'a reset in flight starts in the flight camera');
  const m = watch(cam, camera, f);
  const run = (n, cmd, label) => {
    for (let i = 0; i < n; i++) {
      f.step(cmd);
      cam.update(ctrl(), f);
      m.sample(label);
    }
  };
  run(40, { speed: 45 }, 'straight');
  let r = m.rows.at(-1);
  assert.ok(Math.abs(r.lag) < 1, `straight behind (${r.lag.toFixed(1)} deg)`);
  assert.ok(r.h > 1100 && r.h < 1350, `trailing ${r.h.toFixed(0)}`);
  run(70, { speed: 45, bank: 0.75 }, 'turn'); // full bank right (~3.4 deg/tick)
  const turn = m.rows.filter((x) => x.label === 'turn').slice(30);
  for (const x of turn) {
    // (The camera is still behind where he was heading: turning right, it sits to his left-back.)
    assert.ok(x.lag > 4 && x.lag < 18, `turn lag ${x.lag.toFixed(1)} deg`);
    assert.ok(x.h > 1050 && x.h < 1350, `turn distance ${x.h.toFixed(0)}`);
  }
  run(40, { speed: 45 }, 'out');
  r = m.rows.at(-1);
  assert.ok(Math.abs(r.lag) < 2, `back behind him (${r.lag.toFixed(1)} deg)`);
  // Smooth: the view's turn rate is eased (no kinks) and never much faster than his own turn.
  assert.ok(m.maxTurn < 4.5, `view turn ${m.maxTurn.toFixed(2)} deg/tick`);
  assert.ok(m.maxTurnAccel < 0.6, `view turn acceleration ${m.maxTurnAccel.toFixed(2)} deg/tick^2`);
  assert.ok(m.maxJerk < 12, `camera jerk ${m.maxJerk.toFixed(1)}`);
  for (const x of m.rows) assert.ok(Math.abs(x.ndcX) < 0.6 && Math.abs(x.ndcY) < 0.6, `hero in frame (${x.ndcX.toFixed(2)}, ${x.ndcY.toFixed(2)})`);
});

test('the flight camera looks down on him in a dive and sits level-ish behind him in a climb', () => {
  const { cam, camera } = makeCam();
  const f = new Flyer(0, 3200, 6800, Math.PI);
  cam.reset(f);
  const m = watch(cam, camera, f);
  const run = (n, cmd) => {
    let r;
    for (let i = 0; i < n; i++) {
      f.step(cmd);
      cam.update(ctrl(), f);
      r = m.sample();
    }
    return r;
  };
  const level = run(40, { speed: 40, pitch: 0.1 });
  assert.ok(level.down > 7 && level.down < 16, `gliding: looking down ${level.down.toFixed(1)} deg`);
  const dive = run(25, { speed: 65, pitch: 0.9 });
  assert.ok(dive.down > 25 && dive.down < 50, `diving: looking down ${dive.down.toFixed(1)} deg`);
  const climb = run(30, { speed: 45, pitch: -0.8 });
  assert.ok(climb.down > 0 && climb.down < 9, `climbing: looking down ${climb.down.toFixed(1)} deg`);
  assert.ok(m.maxTurnAccel < 0.6, `view turn acceleration ${m.maxTurnAccel.toFixed(2)} deg/tick^2`);
  for (const x of m.rows) assert.ok(Math.abs(x.ndcY) < 0.75, `hero in frame (ndc y ${x.ndcY.toFixed(2)})`);
});

test('banking round the castle front and its corner tower at speed: always in view, no dolly, no pops', () => {
  // Along the front of the castle (600 in front of the facade) at 1500, then a full left bank round
  // the front-right corner tower (at 1950, -800) and on up the east side.
  const { cam, camera } = makeCam();
  const f = new Flyer(-1500, 1500, -100, Math.PI / 2);
  cam.reset(f);
  const m = watch(cam, camera, f);
  let phase = 0; // along the front, turning, up the side
  for (let i = 0; i < 150; i++) {
    if (phase === 0 && f.pos.x > 1950) phase = 1;
    if (phase === 1 && Math.abs(angleDiff(f.faceYaw, Math.PI)) < 0.1) phase = 2;
    f.step({ speed: 50, pitch: 0, bank: phase === 1 ? -0.75 : 0 });
    cam.update(ctrl(), f);
    m.sample();
  }
  assert.ok(f.pos.z < -2500, `rounded the corner (${f.pos.x.toFixed(0)}, ${f.pos.z.toFixed(0)})`);
  for (const r of m.rows) {
    assert.ok(!r.hidden, 'his chest in sight');
    assert.ok(Math.abs(r.ndcX) < 0.5 && Math.abs(r.ndcY) < 0.5, `in frame (${r.ndcX.toFixed(2)}, ${r.ndcY.toFixed(2)})`);
    assert.ok(r.h > 1150 && r.h < 1350, `trailing ${r.h.toFixed(0)}`);
  }
  assert.ok(m.maxJerk < 12, `camera jerk ${m.maxJerk.toFixed(1)}`);
});

test('circling a corner tower at rooftop height (stress): he stays in the picture, the camera stays out and rises', () => {
  // The front-right corner tower (r 350, top ~2410) at (1950, -800), circled at ~750 on a full left
  // bank at 2000, just over the wing roofs: the trailing camera sweeps across the roofs and
  // round the towers of the front.
  const { cam, camera } = makeCam();
  const f = new Flyer(2700, 2000, 2200, Math.PI);
  cam.reset(f);
  const m = watch(cam, camera, f);
  let crossed = 0;
  let rose = 0;
  let minRatio = 1;
  for (let i = 0; i < 280; i++) {
    const from = { x: f.pos.x, y: f.pos.y + 80, z: f.pos.z };
    f.step({ speed: 45, pitch: 0, bank: f.pos.z < -800 || i > 70 ? -0.75 : 0 });
    if (!cam.collider.lineClear(from, { x: f.pos.x, y: f.pos.y + 80, z: f.pos.z })) crossed++;
    cam.update(ctrl(), f);
    m.sample();
    rose = Math.max(rose, cam.flight.rise);
    minRatio = Math.min(minRatio, cam.collider.ratio);
  }
  assert.equal(crossed, 0, 'the scripted path is clear of the castle');
  assert.equal(f.action, 'flying');
  const rows = m.rows.slice(10);
  const hidden = rows.filter((r) => r.hidden).length;
  assert.ok(hidden <= rows.length * 0.05, `his chest hidden ${hidden} of ${rows.length} ticks`);
  for (const r of rows) {
    assert.ok(Math.abs(r.ndcX) < 0.9 && Math.abs(r.ndcY) < 0.9, `in frame (${r.ndcX.toFixed(2)}, ${r.ndcY.toFixed(2)})`);
    assert.ok(r.d > 600, `never pulled in hard (${r.d.toFixed(0)} from his chest)`);
  }
  assert.ok(minRatio > 0.75, `the dolly stayed out (ratio ${minRatio.toFixed(2)})`);
  assert.ok(rose > 5 * DEG, `rose over the roofs (${(rose / DEG).toFixed(1)} deg)`);
  // Grazing the towers and roofs costs a hitch now and then, never a lurch.
  assert.ok(m.maxJerk < 150, `camera jerk ${m.maxJerk.toFixed(1)}`);
});

test('a dive into the ground: looking down on him, above the ground, and a smooth hand-back to the follow camera', () => {
  const { cam, camera } = makeCam();
  const f = new Flyer(0, 1700, 6600, Math.PI);
  cam.reset(f);
  const m = watch(cam, camera, f);
  let landedAt = -1;
  let maxDown = 0;
  for (let i = 0; i < 200; i++) {
    const diving = f.pos.y > f.floor.y + 350;
    f.step({ speed: 55, pitch: diving ? 0.8 : 0.3 });
    cam.update(ctrl(), f);
    const r = m.sample(f.action);
    if (f.action === 'flying') maxDown = Math.max(maxDown, r.down);
    if (landedAt < 0 && f.action !== 'flying') landedAt = i;
    const floor = col.findFloor(cam.pos.x, cam.pos.y + 50, cam.pos.z).y;
    assert.ok(cam.pos.y > floor + 35, `tick ${i}: camera ${cam.pos.y.toFixed(0)} above the floor ${floor.toFixed(0)}`);
    assert.ok(Math.abs(r.ndcX) < 0.8 && Math.abs(r.ndcY) < 0.85, `tick ${i}: in frame (${r.ndcX.toFixed(2)}, ${r.ndcY.toFixed(2)})`);
  }
  assert.ok(landedAt > 0 && landedAt < 120, `landed at ${landedAt}`);
  assert.ok(maxDown > 25, `the dive looked down on him (${maxDown.toFixed(1)} deg)`);
  assert.equal(f.action, 'idle');
  const after = m.rows[landedAt + K.FLY_OUT_TICKS + 1];
  assert.equal(after.w, 0, 'handed back to the follow camera');
  assert.equal(cam.collider.tolerant, false);
  // No pop through the hand-back, and it settles into the normal follow framing.
  assert.ok(m.maxJerk < 25, `camera jerk ${m.maxJerk.toFixed(1)}`);
  assert.ok(m.maxTurnAccel < 1, `view turn acceleration ${m.maxTurnAccel.toFixed(2)} deg/tick^2`);
  const end = m.rows.at(-1);
  assert.ok(Math.abs(cam.dist - K.ORBIT_MODES.follow.dist[0]) < 5, `follow distance ${cam.dist.toFixed(0)}`);
  assert.ok(Math.abs(cam.basePitch - K.ORBIT_MODES.follow.pitch[0]) < 0.2 * DEG, `follow pitch ${(cam.basePitch / DEG).toFixed(1)}`);
  assert.ok(end.h > 1100 && end.h < 1350, `follow distance ${end.h.toFixed(0)}`);
});

test('in flight C-left/right do not step the orbit (buzz); C-down still zooms out; a take-off stops a C swing', () => {
  const { cam, camera, sfx } = makeCam();
  const f = new Flyer(0, 1500, 6300, Math.PI);
  cam.reset(f);
  const m = watch(cam, camera, f);
  const step = (c = ctrl()) => {
    f.step({ speed: 40 });
    cam.update(c, f);
    return m.sample();
  };
  for (let i = 0; i < 20; i++) step();
  step(ctrl({ CL: true }));
  assert.deepEqual(sfx, ['camera_buzz']);
  assert.equal(cam.tween, null);
  let r;
  for (let i = 0; i < 10; i++) r = step();
  assert.ok(Math.abs(r.lag) < 1, `still straight behind (${r.lag.toFixed(1)} deg)`);
  step(ctrl({ CD: true }));
  for (let i = 0; i < 40; i++) r = step();
  assert.equal(cam.zoom, 1);
  assert.ok(r.h > 1550, `zoomed out to ${r.h.toFixed(0)}`);
  assert.equal(sfx.at(-1), 'camera_move');

  // A C-button swing under way when he takes off stops where it is (the flight camera takes over).
  const g = new Flyer(0, 140, 3500, Math.PI);
  g.action = 'idle';
  const b = makeCam();
  b.cam.reset(g);
  b.cam.update(ctrl({ CR: true }), g);
  b.cam.update(ctrl(), g);
  assert.ok(b.cam.tween, 'swinging');
  g.action = 'flying';
  g.pos.y += 40;
  b.cam.update(ctrl(), g);
  assert.equal(b.cam.tween, null);
});

test("the real Player's flight over the grounds: take-off from a triple jump, the camera behind him, never lost", () => {
  const events = new Events();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  const cam = new CameraController({ collision: col, camera, events });
  const p = new Player({ collision: col, events, spawn: level.spawn });
  const pad = new ScriptedController();
  cam.reset(p);
  const m = watch(cam, camera, p);
  const tick = (input) => {
    const c = pad.next(input);
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
    return m.sample(p.action);
  };
  p.giveWingHat(40);
  for (let i = 0; i < 40; i++) tick({ stickY: 1 });
  for (let k = 0; k < 3; k++) {
    tick({ stickY: 1 });
    tick({ stickY: 1, A: true });
    for (let n = 0; k < 2 && !p.grounded && n < 100; n++) tick({ stickY: 1, A: true });
  }
  assert.equal(p.action, 'flying', 'took off');
  // Glide, bank right, bank left, porpoise; dive a little whenever slow, keep between 700 and 1800.
  const keep = (stickX, want) => ({ stickX, stickY: want ?? (p.flySpeed < 30 ? 0.7 : p.pos.y < 700 ? -0.6 : p.pos.y > 1800 ? 0.5 : 0) });
  const plan = [[20, 0, 'launch'], [45, 0, 'glide'], [45, 1, 'right'], [60, -1, 'left'], [20, 0, 'glide2']];
  const straight = [];
  for (const [n, sx, label] of plan) {
    for (let i = 0; i < n; i++) {
      const r = tick(keep(sx));
      if (p.action !== 'flying') break;
      if (label === 'glide' && i >= 25) straight.push(r);
    }
  }
  assert.ok(m.rows.some((r) => r.w === 1), 'the flight camera took over');
  assert.equal(straight.length, 20, 'still flying after the glide');
  for (const r of straight) assert.ok(Math.abs(r.lag) < 3, `straight behind (${r.lag.toFixed(1)} deg)`);
  for (const r of m.rows) {
    assert.ok(Number.isFinite(r.h + r.camY));
    assert.ok(Math.abs(r.ndcX) < 0.9 && Math.abs(r.ndcY) < 0.9, `in frame (${r.ndcX.toFixed(2)}, ${r.ndcY.toFixed(2)}) ${r.label}`);
  }
  const flying = m.rows.filter((r) => r.label === 'flying');
  assert.ok(flying.length > 100, `${flying.length} ticks in flight`);
  assert.ok(m.maxJerk < 30, `camera jerk ${m.maxJerk.toFixed(1)}`);
});

// Flat ground with a wall across the view `z0` south of the hero (x -2000..2000), `height` tall.
function wallWorld(height, z0 = 600) {
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const w = new CollisionWorld();
  w.addTriangles(quad([-6000, 0, 6000], [6000, 0, 6000], [6000, 0, -6000], [-6000, 0, -6000]));
  const [x0, x1, y1, z1] = [-2000, 2000, height, z0 + 50];
  if (height > 0) w.addTriangles([
    ...quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]),
    ...quad([x0, 0, z1], [x1, 0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...quad([x1, 0, z0], [x0, 0, z0], [x0, y1, z0], [x1, y1, z0]),
  ]);
  w.finalize();
  return w;
}

// Runs the collider for `ticks` with the hero at the origin and the orbit 1250 out at 10 deg,
// settled in the open before the wall comes between them (as when he flies past a tower).
function holdBehindWall(world, tolerant, ticks = 40) {
  const open = wallWorld(0);
  const sw = { world: open };
  for (const k of ['raycast', 'findFloor', 'findCeil', 'findWalls', 'waterLevelAt']) sw[k] = (...a) => sw.world[k](...a);
  const c = new CameraCollider(sw);
  const look = new THREE.Vector3(0, 150, 0);
  const desired = new THREE.Vector3(0, 150 + 1250 * Math.sin(10 * DEG), 1250 * Math.cos(10 * DEG));
  const hero = { x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0, speed: 0, inWater: false, submerged: false, covered: false };
  const out = new THREE.Vector3();
  const trail = [];
  c.tolerant = tolerant;
  for (let i = 0; i < 5; i++) c.resolve(look, desired, hero, out);
  sw.world = world;
  for (let i = 0; i < ticks; i++) {
    c.resolve(look, desired, hero, out);
    trail.push(out.clone());
  }
  return { c, trail };
}

test('tolerant collider (flight): lifts over a wall rather than dollying in, and pulls in gently when it must', () => {
  // A 450-high wall 600 behind the hero: clearing it takes a ~20 deg lift. The follow camera
  // dollies in front of it; the flight camera rises over it.
  const low = wallWorld(450);
  const normal = holdBehindWall(low, false);
  const tolerant = holdBehindWall(low, true);
  assert.ok(normal.c.ratio < 0.7 && normal.c.lift < 13 * DEG, `follow camera dollies in (ratio ${normal.c.ratio.toFixed(2)})`);
  assert.ok(tolerant.c.ratio > 0.95, `flight camera stays out (ratio ${tolerant.c.ratio.toFixed(2)})`);
  assert.ok(tolerant.c.lift > 15 * DEG, `and rises over the wall (lift ${(tolerant.c.lift / DEG).toFixed(1)} deg)`);

  // A wall too tall to rise over comes between them 900 behind him: both dolly in (as far as the
  // wall lets them without tunnelling), the flight camera gently (<= 30 per tick). (Closer than
  // ~650 the flight camera does not dolly in at all: see TOLERANT_MIN_DIST.)
  const tall = wallWorld(6000, 900);
  const maxStep = (t) => Math.max(...t.trail.slice(1).map((p, i) => p.distanceTo(t.trail[i])));
  const n = holdBehindWall(tall, false, 20);
  const t = holdBehindWall(tall, true, 20);
  assert.ok(maxStep(n) > 35, `follow camera pulls in fast (${maxStep(n).toFixed(0)} per tick)`);
  assert.ok(maxStep(t) <= 31, `flight camera pulls in gently (${maxStep(t).toFixed(0)} per tick)`);
  assert.ok(t.trail.at(-1).z < 1100, `but it does pull in (${t.trail.at(-1).z.toFixed(0)})`);
});
