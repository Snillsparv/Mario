// The camera's profiles (CameraController.setProfile: the numbers a look of an area changes,
// layout.LANE_REAL.camera for Sparrow Lane's realistic look). Without one the controller reads
// cameraConfig itself: scripted runs on the grounds, in the Great Hall and in the lane give
// exactly the poses the controller gave before profiles existed (pinned: a hash of every
// tick's position, target and field of view); setting the lane's profile and taking it off
// again leaves nothing behind; with it the field of view (in apply() and the AI RACE look-up),
// the look point's height, the distances, pitches, aims and lags are the profile's, and the
// lane's arrival puts the eye at an adult's height over his feet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { LookUp } from '../src/camera/lookup.js';
import * as K from '../src/camera/cameraConfig.js';
import { Events } from '../src/core/events.js';
import { wrapAngle } from '../src/core/math.js';

const level = buildLevel(new THREE.Scene());
const hall = buildArea(new THREE.Scene(), AREA_DEFS.hall);
const laneArea = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const PLACES = {
  grounds: { collision: level.collision, entry: { ...level.spawn }, signs: [] },
  hall: { collision: hall.collision, entry: hall.entries[AREA_DEFS.hall.respawn.entry], signs: hall.signs },
  lane: { collision: laneArea.collision, entry: laneArea.entries.home, signs: laneArea.signs },
};

// A scripted run (walking, turning, a jump, the C buttons, the tighter camera, standing still)
// from the place's entry; each tick's pose into `out` (numbers), the controller returned.
function run(name, { profile = null, before = null, ticks = 240, out = [] } = {}) {
  const { collision, entry, signs } = PLACES[name];
  const p = new Player({ collision, events: new Events(), spawn: { ...entry }, signs });
  p.placeAt(entry);
  const cam = new CameraController({ collision, camera: new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000), events: new Events() });
  before?.(cam);
  if (profile) cam.setProfile(profile);
  cam.reset(p, { yaw: entry.camYaw });
  const ctl = new ScriptedController();
  for (let i = 0; i < ticks; i++) {
    const phase = Math.floor(i / 30);
    const yaw = wrapAngle(entry.yaw + [0, 0.8, -0.6, 2.4, 0, 0, -1.2, 0][phase % 8]);
    const a = wrapAngle(cam.getYaw() - yaw);
    const move = phase !== 5 && phase !== 7;
    const c = ctl.next({ stickX: move ? Math.sin(a) : 0, stickY: move ? Math.cos(a) : 0, A: i % 50 === 20, CL: i === 100, CR: i === 130, CD: i === 160, R: i === 190 });
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
    cam.apply(0.5);
    const q = cam.camera.position;
    out.push(cam.pos.x, cam.pos.y, cam.pos.z, cam.target.x, cam.target.y, cam.target.z, cam.fov, q.x, q.y, q.z, cam.camera.fov);
  }
  return { cam, p, out };
}

// FNV-1a over the numbers' bits.
function hash(numbers) {
  const bytes = new Uint8Array(new Float64Array(numbers).buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// The poses the controller gave before profiles existed (650da15), per place.
const PINNED = { grounds: 'b3b1beef', hall: '3c74e247', lane: '82c6f121' };

test('without a profile the controller reads cameraConfig: the scripted runs on the grounds, in the hall and in the lane give the poses pinned before profiles existed', () => {
  for (const name of Object.keys(PLACES)) {
    const { cam, out } = run(name);
    assert.equal(cam.k, K, `${name}: cameraConfig itself`);
    assert.equal(hash(out), PINNED[name], `${name}: the same poses`);
  }
});

test('the lane\'s profile set and taken off again leaves nothing behind: the same poses, cameraConfig read, the look-up\'s field of view the classic one', () => {
  const profile = lane.LANE_REAL.camera;
  for (const name of Object.keys(PLACES)) {
    const plain = run(name, { ticks: 120 });
    const toggled = run(name, { ticks: 120, before: (cam) => {
      cam.setProfile(profile);
      assert.equal(cam.k.FOV, profile.FOV);
      cam.setProfile(null);
    } });
    assert.equal(toggled.cam.k, K);
    assert.equal(toggled.cam.lookUp.baseFov, K.FOV);
    assert.deepEqual(toggled.out, plain.out, `${name}: the same poses`);
  }
  // Mid-run: the profile's goals while it is set, cameraConfig's again after a reset.
  const { cam, p } = run('lane', { profile, ticks: 60 });
  cam.setProfile(null);
  cam.reset(p);
  const fresh = new CameraController({ collision: PLACES.lane.collision, camera: new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000), events: new Events() });
  fresh.reset(p);
  for (const key of ['dist', 'basePitch', 'aimPitch', 'fov', 'prevFov', 'zoom', 'mode']) assert.equal(cam[key], fresh[key], key);
  assert.deepEqual(cam.pos.toArray(), fresh.pos.toArray());
  assert.deepEqual(cam.target.toArray(), fresh.target.toArray());
});

test('the lane\'s profile: its field of view in apply() and the look-up, its look point, distances, pitches and aims; the arrival\'s eye at an adult\'s height over his feet (the classic camera\'s over twice his)', () => {
  const profile = lane.LANE_REAL.camera;
  assert.deepEqual(Object.keys(profile).sort(), ['FOV', 'LOOK_HEIGHT', 'LOOK_RATE', 'ORBIT_MODES', 'PIVOT_RATE']);
  assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.ORBIT_MODES.follow) && Object.isFrozen(profile.ORBIT_MODES.hero));
  for (const mode of ['follow', 'hero']) {
    for (const key of Object.keys(K.ORBIT_MODES[mode])) assert.ok(key in profile.ORBIT_MODES[mode], `${mode}.${key}`);
  }
  const { cam, p } = run('lane', { profile, ticks: 0 });
  assert.equal(cam.fov, profile.FOV);
  cam.apply(1);
  assert.equal(cam.camera.fov, profile.FOV, 'apply() sets the profile\'s field of view');
  assert.equal(cam.lookUp.fov, profile.FOV, 'the look-up starts from it');
  assert.equal(cam.dist, profile.ORBIT_MODES.follow.dist[0]);
  assert.equal(cam.basePitch, profile.ORBIT_MODES.follow.pitch[0]);
  assert.equal(cam.aimPitch, profile.ORBIT_MODES.follow.aim[0]);
  assert.equal(cam.camera.userData.focus.y, p.pos.y + profile.LOOK_HEIGHT, 'the published focus at its look point');
  // The look-up widens from the profile's field of view (AI RACE never runs in the lane, but the
  // numbers stay consistent).
  const up = new LookUp();
  up.setFov(profile.FOV);
  assert.equal(up.fov, profile.FOV);
  up.w = 1;
  up.u = 1;
  up._apply();
  assert.equal(up.fov, K.LOOKUP_FOV_MAX);
  up.u = 0.5;
  up._apply();
  assert.equal(up.fov, profile.FOV + 0.5 * (K.LOOKUP_FOV_MAX - profile.FOV));
  // The arrival (the walk-in, then standing): the eye over his feet.
  const eye = (prof) => {
    const r = run('lane', { profile: prof, ticks: 0 });
    const e = lane.ENTRIES.home;
    const ctl = new ScriptedController();
    for (let i = 0; i < 60; i++) {
      const a = wrapAngle(r.cam.getYaw() - e.yaw);
      const c = ctl.next(i < e.walkIn ? { stickX: Math.sin(a), stickY: Math.cos(a) } : {});
      r.p.update(r.cam.playerInput(c), r.cam.getYaw());
      r.cam.update(c, r.p);
    }
    return r.cam.pos.y - r.p.pos.y;
  };
  const real = eye(profile);
  const classic = eye(null);
  assert.ok(real > 150 && real < 240, `the realistic look's eye ${real.toFixed(0)} over his feet`);
  assert.ok(classic > 280 && classic < 370, `the classic camera's ${classic.toFixed(0)}`);
});
