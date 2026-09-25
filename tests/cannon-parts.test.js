// The cannon's parts round the Player (docs/ARCHITECTURE.md "Cannon"): the object (three draw
// calls, its colliders and pad, the storm look), built by the ObjectManager from layout.CANNON;
// the server halls and the minions keeping clear of it; the muzzle blast (fx.muzzle); the
// cannon view (camera/cannon.js: rides the barrel, hides the hero, glides out behind the shot),
// the camera shake and the HUD's reticle; the sounds and the 'cannon_shot' anim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { makeRng, wrapAngle } from '../src/core/math.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { CANNON } from '../src/objects/Cannon.js';
import { CANNON_DIMS } from '../src/objects/cannonModel.js';
import { SLOT_RULES, planSlots, rectPointDistance } from '../src/objects/ServerHalls.js';
import { MINION, Minions } from '../src/objects/Minions.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { barrelDir } from '../src/player/actions/cannon.js';
import { CameraController } from '../src/camera/CameraController.js';
import { CameraShake } from '../src/camera/shake.js';
import { cannonPose } from '../src/camera/cannon.js';
import * as K from '../src/camera/cameraConfig.js';
import { HUD } from '../src/ui/HUD.js';
import { Effects } from '../src/fx/Effects.js';
import { KIND } from '../src/fx/kinds.js';
import { SFX, SFX_INFO } from '../src/audio/sfx.js';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIM_NAMES } from '../src/player/model/animations.js';

const level = buildLevel(new THREE.Scene());
const col = level.collision;
const L = level.layout;

// One ObjectManager (and so one cannon) for the file: each adds its colliders to the level.
const events = new Events();
const log = [];
for (const name of ['sfx', 'cannonFire', 'cannonView']) events.on(name, (e) => log.push({ event: name, ...e }));
let objects = null;
function setup() {
  log.length = 0;
  const player = new Player({ collision: col, events, spawn: level.spawn });
  objects ??= new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: L, player, level });
  objects.reset();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  const cam = new CameraController({ collision: col, camera, events });
  const ctl = new ScriptedController();
  const tick = (input = {}) => {
    const c = ctl.next(input);
    player.update(cam.playerInput(c), cam.getYaw());
    objects.update({ player, camera: cam });
    cam.update(c, player);
  };
  return { player, cam, camera, tick, cannon: objects.cannon };
}

test('the ObjectManager builds the cannon at layout.CANNON: three draw calls, one material, colliders for the drum, the turret and the pad', () => {
  const { cannon } = setup();
  assert.ok(cannon, 'layout.CANNON gives a cannon');
  assert.equal(cannon.x, L.CANNON.x);
  assert.equal(cannon.z, L.CANNON.z);
  assert.ok(Math.abs(wrapAngle(cannon.restYaw - Math.atan2(L.KEEP_TOP.x - cannon.x, L.KEEP_TOP.z - cannon.z))) < 1e-9, 'resting toward the keep');
  const meshes = [];
  cannon.mesh.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 3, 'base, turret, barrel');
  assert.equal(new Set(meshes.map((m) => m.material)).size, 1, 'one material');
  const tris = meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
  assert.ok(tris < 2500, `${tris} triangles`);
  for (const m of meshes) {
    for (const a of ['position', 'color', 'glow', 'wave']) assert.ok(m.geometry.attributes[a], `${m.name}: ${a}`);
    assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));
  }
  // The drum's flat top, the turret column's, and the pad's (a lip low enough to walk onto).
  const G = cannon.groundY;
  const top = (x, z) => col.findFloor(x, G + 1000, z, 0);
  assert.equal(top(cannon.x + 220, cannon.z).y, G + CANNON_DIMS.BASE_TOP);
  assert.equal(top(cannon.x, cannon.z + 40).y, G + CANNON_DIMS.TURRET_COLLIDER_TOP);
  const pad = top(cannon.pad.x, cannon.pad.z);
  assert.equal(pad.y, cannon.pad.y);
  assert.ok(cannon.padSurfaces.has(pad.surface));
  const ground = L.groundHeight(cannon.pad.x + CANNON_DIMS.PAD_R, cannon.pad.z);
  assert.ok(cannon.pad.y - ground <= CANNON_DIMS.PAD_LIP + 20, 'a small step up');
  assert.ok(col.findWalls(cannon.x + CANNON_DIMS.BASE_R + 30, G, cannon.z, 30, 50).walls.length > 0, 'the drum is solid');
  // The descriptor the Player gets.
  const d = cannon.desc;
  assert.equal(d.y, G + CANNON_DIMS.PIVOT_Y);
  assert.equal(d.muzzle, CANNON_DIMS.MUZZLE);
  assert.ok(Math.hypot(d.exit.x - cannon.pad.x, d.exit.z - cannon.pad.z) > CANNON_DIMS.PAD_R + 60, 'climbing out lands off the pad');
});

test('the storm dims the cannon but its pad keeps glowing (and pulses while armed); reset() puts the barrel back to rest', () => {
  const { cannon } = setup();
  const u = cannon.material.userData.uniforms;
  cannon.animate(1, 0.5);
  const lit = u.cannonGlow.value.r + u.cannonGlow.value.g + u.cannonGlow.value.b;
  assert.ok(lit > 0.3, 'glowing while armed');
  cannon.animate(1, 0.5 + Math.PI / 3.2);
  assert.notEqual(u.cannonGlow.value.g, 0, 'pulsing');
  objects.setDarkness(1);
  assert.ok(cannon.material.color.r < 0.6, 'dimmed');
  cannon.animate(1, 0.5);
  assert.ok(u.cannonGlow.value.r + u.cannonGlow.value.g + u.cannonGlow.value.b >= lit, 'the glow is not dimmed');
  objects.setDarkness(0);
  assert.equal(cannon.material.color.r, 1);
  cannon.yaw = 1;
  cannon.pitch = 0.2;
  cannon.armed = false;
  objects.reset();
  assert.equal(cannon.yaw, cannon.restYaw);
  assert.equal(cannon.pitch, cannon.restPitch);
  assert.ok(cannon.armed);
  assert.ok(Math.abs(cannon.barrel.rotation.x + cannon.restPitch) < 1e-9, 'the mesh shows it');
});

test('the camera: the cannon view rides the barrel, looking along it, the hero hidden; firing glides out to the flight camera behind the shot', () => {
  const { player, cam, tick, cannon } = setup();
  player.teleport(cannon.pad.x, cannon.pad.y, cannon.pad.z, 0);
  player.setAction('idle');
  cam.reset(player);
  tick();
  assert.equal(player.action, 'cannon', 'the pad (through the ObjectManager) put him in');
  assert.equal(cam.mode, 'follow', 'the hop into the barrel is watched from the orbit');
  assert.equal(cam.hideHero, false);
  for (let t = 0; t < 60 && player.cannon.phase !== 'aim'; t++) tick();
  assert.equal(cam.mode, 'cannon');
  assert.ok(cam.cannonView && cam.hideHero, 'the view is the cannon\'s, the hero hidden');
  assert.deepEqual(log.filter((e) => e.event === 'cannonView').map((e) => e.on), [true]);
  for (let t = 0; t < K.BLEND_TICKS + 2; t++) tick({ stickX: 0.5, stickY: 0.4 });
  // Looking along the barrel from behind and above it (square to the bore).
  const s = player.cannon;
  const d = barrelDir(s.yaw, s.pitch);
  const v = new THREE.Vector3().subVectors(cam.target, cam.pos).normalize();
  assert.ok(v.x * d.x + v.y * d.y + v.z * d.z > 0.9999, 'looks along the barrel');
  const off = new THREE.Vector3(cam.pos.x - s.desc.x, cam.pos.y - s.desc.y, cam.pos.z - s.desc.z);
  const along = off.x * d.x + off.y * d.y + off.z * d.z;
  assert.ok(Math.abs(along + K.CANNON_CAM_BACK) < 1, `behind the pivot along the bore (${along.toFixed(1)})`);
  assert.ok(Math.abs(wrapAngle(cam.getYaw() - s.yaw)) < 1e-6, 'stick-relative yaw = the aim');
  assert.ok(cam.camera.userData.focus === undefined || cam.camera.userData.focus === null);
  // Buttons that would turn the orbit buzz.
  log.length = 0;
  tick({ CL: true });
  assert.ok(log.some((e) => e.event === 'sfx' && e.name === 'camera_buzz'));
  // A steep aim: kept over the drum and the lawn.
  for (let t = 0; t < 80; t++) tick({ stickY: 1 });
  const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  cannonPose(player.cannon, pose.pos, pose.target, col);
  assert.ok(pose.pos.y >= col.findFloor(pose.pos.x, pose.pos.y + 200, pose.pos.z).y + K.CANNON_CAM_CLEAR - 1e-6);
  // Fire: out of the cannon view into the flight camera behind him.
  log.length = 0;
  tick({ A: true });
  assert.equal(player.action, 'cannon_shot');
  assert.equal(cam.mode, 'follow');
  assert.equal(cam.hideHero, false, 'he shows as he flies out');
  assert.deepEqual(log.filter((e) => e.event === 'cannonView').map((e) => e.on), [false]);
  assert.equal(cam.flight.w, 1, 'the flight camera');
  for (let t = 0; t < K.BLEND_TICKS + 4; t++) tick();
  const toHero = new THREE.Vector3(player.pos.x - cam.pos.x, 0, player.pos.z - cam.pos.z).normalize();
  assert.ok(toHero.x * player.vel.x + toHero.z * player.vel.z > 0, 'behind him');
});

test('firing: the barrel recoils, the muzzle blast (fx.muzzle) and the camera shake', () => {
  const { player, tick, cannon } = setup();
  player.teleport(cannon.pad.x, cannon.pad.y, cannon.pad.z, 0);
  player.setAction('idle');
  for (let t = 0; t < 60 && player.cannon?.phase !== 'aim'; t++) tick();
  tick({ A: true });
  tick();
  assert.ok(cannon.recoil > 0, 'recoil');
  for (let t = 0; t < CANNON.RECOIL_TICKS; t++) tick();
  assert.equal(cannon.recoil, 0, 'springs back');
  // fx.muzzle: a flash, fire and sparks out along the bore, a ring of smoke.
  const fx = new Effects({});
  const dir = barrelDir(0.3, 0.5);
  fx.muzzle(100, 400, -50, dir.x, dir.y, dir.z, { radius: 130 });
  const n = {};
  let ahead = 0;
  let sparks = 0;
  for (let i = 0; i < fx.pool.count; i++) {
    const k = fx.pool.kind[i];
    n[k] = (n[k] ?? 0) + 1;
    if (k === KIND.SPARK) {
      sparks++;
      if (fx.pool.vx[i] * dir.x + fx.pool.vy[i] * dir.y + fx.pool.vz[i] * dir.z > 0) ahead++;
    }
  }
  for (const k of [KIND.FLASH, KIND.FIREBALL, KIND.SPARK, KIND.DUST]) assert.ok(n[k] > 0, `kind ${k}`);
  assert.equal(ahead, sparks, 'sparks fly out of the mouth');
  for (let t = 0; t < 120; t++) fx.update(1 / 30, t / 30, null);
  assert.equal(fx.pool.count, 0, 'all settled after 4 s');
  // The shake: a boom right by the camera jolts it.
  const ev = new Events();
  const shake = new CameraShake(ev);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  ev.emit('cannonFire', { pos: { x: 100, y: 0, z: 0 }, yaw: 0, pitch: 0.5, dir });
  shake.apply(camera, 1 / 60);
  assert.ok(shake.amount > 0.5, 'jolted');
});

test('the HUD shows its reticle while the cannon view is up', () => {
  const ev = new Events();
  const hud = new HUD(null, { events: ev });
  assert.equal(hud.cannonView, false);
  ev.emit('cannonView', { on: true });
  assert.equal(hud.cannonView, true);
  assert.equal(hud.cannonHints, 'keys');
  ev.emit('cannonView', { on: false });
  assert.equal(hud.cannonView, false);
  hud.dispose();
});

test('server halls keep clear of the cannon (its drum, pad and exit spot) and of the reward on the keep', () => {
  const slots = planSlots(L, { collision: col, trees: level.trees });
  assert.ok(slots.length >= 24, `${slots.length} slots`);
  const c = objects?.cannon ?? setup().cannon;
  for (const s of slots) {
    assert.ok(rectPointDistance(s, L.CANNON.x, L.CANNON.z) >= SLOT_RULES.CANNON, `slot ${s.index} by the cannon`);
    for (const p of [c.pad, c.desc.exit]) assert.ok(rectPointDistance(s, p.x, p.z) >= SLOT_RULES.CANNON - CANNON_DIMS.EXIT_DIST - 1, `slot ${s.index} by the pad / exit`);
    const K2 = L.KEEP_TOP;
    assert.ok(rectPointDistance(s, K2.x, K2.z) > K2.halfZ + SLOT_RULES.CASTLE, `slot ${s.index} by the keep`);
  }
  assert.ok(SLOT_RULES.CANNON - CANNON_DIMS.EXIT_DIST >= 300, 'a wide berth past the exit spot');
});

test('minions never burst out of the cannon, its pad or where Pip climbs out', () => {
  const ev = new Events();
  const minions = new Minions({ collision: col, events: ev, rng: makeRng(5), layout: L, groundAt: L.groundHeight });
  const c = L.CANNON;
  let tried = 0;
  for (let r = 0; r <= MINION.CANNON_CLEAR - 10; r += 60) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      tried++;
      assert.equal(minions.spawnFloor(c.x + Math.sin(a) * r, c.z + Math.cos(a) * r), null, `spawn ${r} from the cannon`);
    }
  }
  assert.ok(tried > 200);
  assert.ok(MINION.CANNON_CLEAR >= CANNON_DIMS.EXIT_DIST + 200);
  // Open lawn beyond it still works.
  assert.ok(minions.spawnFloor(c.x + MINION.CANNON_CLEAR + 400, c.z + 600));
});

test('the cannon sounds exist with playback rules; the ratchet is quick and quiet, the boom carries', () => {
  for (const n of ['cannon_enter', 'cannon_turn', 'cannon_fire', 'cannon_whoosh']) {
    assert.equal(typeof SFX[n], 'function', n);
    assert.ok(SFX_INFO[n], `${n} rules`);
  }
  assert.ok(SFX_INFO.cannon_turn.gap <= 0.06 && SFX_INFO.cannon_turn.max <= 2);
  assert.ok(SFX_INFO.cannon_fire.range >= 2 && SFX_INFO.cannon_fire.max === 1);
});

test("'cannon_shot' is a documented anim that poses Pip laid out flat and rolling slowly, with finite transforms", () => {
  assert.ok(ANIM_NAMES.includes('cannon_shot'));
  const model = new PlayerModel();
  const rs = {
    pos: { x: 0, y: 1000, z: 0 }, yaw: 0.4, pitch: -0.7, roll: 0, action: 'cannon_shot', anim: 'cannon_shot', animTime: 0,
    cyclePhase: 0, forwardVel: 90, vy: 80, grounded: false, inWater: false, floorY: 0, floorNormal: { x: 0, y: 1, z: 0 },
    health: 8, invincible: false, punchStep: 0, headYaw: 0, wingHat: false, wingHatEnding: false,
  };
  const spins = [];
  for (let i = 0; i < 40; i++) {
    rs.animTime = i / 30;
    const pose = model.animator.update(rs, 1 / 30);
    model.update(rs, 1 / 30);
    spins.push(pose.flipYaw);
    assert.ok(pose.flipPitch > 1.3, 'laid out flat along the arc');
  }
  assert.ok(spins.at(-1) > spins[5] + 1, 'rolling');
  assert.ok(spins.at(-1) < 2 * Math.PI, 'slowly');
  model.object3D.updateMatrixWorld(true);
  model.object3D.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite), o.name));
});
