// Hero model: every AnimName poses without throwing and yields finite transforms, unknown
// anims fall back to idle, the blob shadow follows the floor, and the budget holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIM_NAMES, resolveAnim } from '../src/player/model/animations.js';
import { Session } from 'node:inspector/promises';
import { CHANNELS, createPose, resetPose, copyPose, blendPose } from '../src/player/model/pose.js';
import { gaitAt, gaitLegs } from '../src/player/model/gait.js';
import { makeRng } from '../src/core/math.js';

// The complete AnimName list from docs/ARCHITECTURE.md.
const CONTRACT_ANIMS = `idle sleep walk run tiptoe skid turnaround push crouch crawl crouch_slide jump fall land
  double_jump triple_jump backflip sideflip long_jump dive belly_slide butt_slide ground_pound_spin
  ground_pound_fall ground_pound_land wallkick bonk hurt fall_damage ledge_hang ledge_climb pole_hold
  pole_climb pole_jump punch1 punch2 kick jump_kick swim_idle swim_stroke swim_flutter water_surface
  water_jump star_dance spawn death`.split(/\s+/);

function renderState(rng, anim, animTime) {
  const r = (a, b) => a + (b - a) * rng();
  const n = { x: r(-0.5, 0.5), y: 1, z: r(-0.5, 0.5) };
  return {
    pos: { x: r(-8000, 8000), y: r(-500, 3000), z: r(-8000, 8000) },
    yaw: r(-10, 10), pitch: r(-1.6, 1.6), roll: r(-0.5, 0.5),
    action: anim, anim, animTime, cyclePhase: r(0, 50),
    forwardVel: r(-20, 60), vy: r(-75, 60), grounded: rng() < 0.5, inWater: rng() < 0.2,
    floorY: rng() < 0.1 ? -11000 : r(-600, 2500), floorNormal: n,
    health: 8, invincible: rng() < 0.3, punchStep: 0, headYaw: r(-1, 1),
  };
}

function assertFinite(model, label) {
  model.object3D.updateMatrixWorld(true);
  model.object3D.traverse((o) => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite transform on ${o.name || o.type}`);
  });
}

test('every contract AnimName has a pose', () => {
  for (const name of CONTRACT_ANIMS) assert.ok(ANIM_NAMES.includes(name), `missing anim ${name}`);
});

test('update never throws and stays finite for every anim with random render states', () => {
  const rng = makeRng(7);
  const model = new PlayerModel();
  for (const anim of CONTRACT_ANIMS) {
    for (let i = 0; i < 25; i++) {
      const t = i < 20 ? i * 0.07 : rng() * 8;
      model.update(renderState(rng, anim, t), rng() < 0.1 ? 0 : 1 / 30 + rng() * 0.05);
    }
    assertFinite(model, anim);
  }
});

test('garbage and partial render states are tolerated', () => {
  const model = new PlayerModel();
  model.update({}, 1 / 60);
  model.update({ pos: { x: NaN, y: Infinity, z: 0 }, anim: 42, animTime: -3, floorNormal: null }, NaN);
  model.update({ anim: 'run', cyclePhase: undefined, forwardVel: 30 }, 1 / 60);
  assertFinite(model, 'garbage');
});

test('unknown anims fall back to idle', () => {
  assert.equal(resolveAnim('moonwalk'), 'idle');
  assert.equal(resolveAnim('toString'), 'idle');
  const a = new PlayerModel();
  const b = new PlayerModel();
  const rs = (anim) => ({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim, animTime: 1.2, floorY: 0 });
  for (let i = 0; i < 10; i++) {
    a.update(rs('idle'), 1 / 60);
    b.update(rs('not_an_anim'), 1 / 60);
  }
  for (const c of CHANNELS) assert.ok(Math.abs(a.animator.pose[c] - b.animator.pose[c]) < 1e-9, c);
});

test('root follows position and yaw; flips never leak into the shadow', () => {
  const model = new PlayerModel();
  const rs = { pos: { x: 100, y: 250, z: -40 }, yaw: 1.1, anim: 'backflip', animTime: 0.3, floorY: 200, floorNormal: { x: 0, y: 1, z: 0 } };
  for (let i = 0; i < 5; i++) model.update(rs, 1 / 60);
  const o = model.object3D;
  assert.deepEqual([o.position.x, o.position.y, o.position.z], [100, 250, -40]);
  assert.ok(Math.abs(o.rotation.y - 1.1) < 1e-9);
  o.updateMatrixWorld(true);
  const s = model.shadow.mesh;
  const p = s.getWorldPosition(o.position.clone());
  assert.ok(Math.abs(p.y - 202) < 1e-6, `shadow at ${p.y}`);
  assert.ok(Math.abs(p.x - 100) < 1e-6 && Math.abs(p.z + 40) < 1e-6);
  // Flat floor: the shadow lies flat whatever the hero is doing.
  const up = s.localToWorld(s.position.clone().set(0, 1, 0)).sub(p).normalize();
  assert.ok(up.y > 0.999, 'shadow tilted');
  assert.equal(s.parent, o, 'shadow must not sit under the flipping body');
});

test('shadow hides without a floor and shrinks with height', () => {
  const model = new PlayerModel();
  const at = (y, floorY) => {
    model.update({ pos: { x: 0, y, z: 0 }, anim: 'fall', animTime: 0.2, floorY }, 1 / 60);
    return model.shadow.mesh;
  };
  assert.equal(at(100, -11000).visible, false);
  const near = at(10, 0).scale.x;
  const far = at(1200, 0).scale.x;
  assert.equal(model.shadow.mesh.visible, true);
  assert.ok(far < near);
});

test('invincibility blinks the body, not the shadow', () => {
  const model = new PlayerModel();
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'idle', animTime: i / 60, floorY: 0, invincible: true }, 1 / 60);
    seen.add(model.rig.orient.visible);
    assert.equal(model.shadow.mesh.visible, true);
  }
  assert.deepEqual([...seen].sort(), [false, true]);
  model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'idle', animTime: 0.2, floorY: 0, invincible: false }, 1 / 60);
  assert.equal(model.rig.orient.visible, true);
});

test('no invincibility flicker while dying: Pip stays drawn for the whole collapse', () => {
  // The Player keeps its post-hit invincibility through 'death' (the hit took the last wedge).
  const model = new PlayerModel();
  for (let i = 0; i < 60; i++) {
    model.update({ pos: { x: 0, y: 0, z: 0 }, action: 'death', anim: 'death', animTime: i / 60, floorY: 0, invincible: true }, 1 / 60);
    assert.equal(model.rig.orient.visible, true, `hidden ${i} frames into the death anim`);
  }
  // ...and the flicker still runs for a knockback.
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    model.update({ pos: { x: 0, y: 0, z: 0 }, action: 'hurt', anim: 'hurt', animTime: i / 60, floorY: 0, invincible: true }, 1 / 60);
    seen.add(model.rig.orient.visible);
  }
  assert.equal(seen.size, 2);
});

test('a gait never inherits another gait\'s params (walk after tiptoe/run keeps heel-toe steps)', () => {
  const TIPTOE = { stance: 0.62, reach: 30, tiptoe: true, heelUp: 0.75, lift: 11, kick: 0, zMid: -2 };
  const RUN = { stance: 0.45, reach: 47, toeUp: 0.2, heelUp: 0.9, lift: 12, kick: 18, drive: 24, zMid: -2 };
  const WALK = { stance: 0.58, reach: 47, toeUp: 0.25, heelUp: 0.6, lift: 6, kick: 3, zMid: 3 };
  const p = createPose();
  gaitLegs(p, 0.3, gaitAt(TIPTOE, 48));
  gaitLegs(p, 0.3, gaitAt(RUN, 240));
  const g = gaitAt(WALK, 100);
  assert.equal(g.tiptoe, false, 'walk on tiptoe after a tiptoe step');
  assert.equal(g.drive, 0, 'walk with the run\'s knee drive');
  // At the left heel strike the boot lands heel first, toes raised by toeUp.
  gaitLegs(resetPose(p), 0, g);
  const bootPitch = p.ankleL + p.flipPitch + p.hipsPitch - p.legLSwing + p.kneeL; // + = toes down
  assert.ok(Math.abs(bootPitch + WALK.toeUp) < 1e-6, `boot pitch at heel strike ${bootPitch}`);
});

test('whole-pose helpers cover every channel', () => {
  const a = createPose();
  const b = createPose();
  CHANNELS.forEach((c, i) => {
    a[c] = 0.01 * (i + 1);
    b[c] = -0.02 * (i + 1);
  });
  b.face = 'happy';
  const copy = copyPose(createPose(), a);
  const mid = blendPose(createPose(), a, b, 0.5);
  for (const c of CHANNELS) {
    assert.equal(copy[c], a[c], `copyPose misses ${c}`);
    assert.ok(Math.abs(mid[c] - (a[c] + b[c]) / 2) < 1e-12, `blendPose misses ${c}`);
  }
  assert.equal(mid.face, 'happy');
  resetPose(a);
  for (const c of CHANNELS) assert.equal(a[c], 0, `resetPose misses ${c}`);
  assert.deepEqual(Object.keys(createPose()), [...CHANNELS, 'face'], 'all poses share one shape');
});

// Bytes allocated per call of fn once it is warm (V8 heap sampling).
async function bytesPerCall(fn, n = 20000) {
  for (let i = 0; i < n; i++) fn(i);
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  for (let i = 0; i < n; i++) fn(i);
  const { profile } = await session.post('HeapProfiler.stopSampling');
  session.disconnect();
  let total = 0;
  const walk = (node) => {
    total += node.selfSize;
    node.children.forEach(walk);
  };
  walk(profile.head);
  return total / n;
}

test('walking legs allocate little per frame (foot solutions reuse scratch records)', async () => {
  // Before the fix every leg solve returned fresh {z, y, pitch} records (~770 B per call).
  const p = createPose();
  const WALK = { stance: 0.58, reach: 47, toeUp: 0.25, heelUp: 0.6, lift: 6, kick: 3, zMid: 3 };
  const bytes = await bytesPerCall((i) => gaitLegs(p, i * 0.013, gaitAt(WALK, 100 + (i % 10))));
  assert.ok(bytes < 400, `${bytes.toFixed(0)} bytes per gaitLegs call`);
});

test('anim changes blend instead of snapping', () => {
  const model = new PlayerModel();
  const rs = (anim, animTime) => ({ pos: { x: 0, y: 0, z: 0 }, anim, animTime, cyclePhase: 0.25, forwardVel: 30, floorY: 0 });
  for (let i = 0; i < 20; i++) model.update(rs('run', i / 60), 1 / 60);
  const before = model.animator.pose.armRSwing;
  model.update(rs('double_jump', 0), 1 / 60);
  const during = model.animator.pose.armRSwing;
  for (let i = 1; i < 20; i++) model.update(rs('double_jump', i / 60), 1 / 60);
  const after = model.animator.pose.armRSwing;
  assert.ok(Math.abs(during - before) < Math.abs(after - before), 'first frame should be between the poses');
});

test('triangle budget stays N64-sized', () => {
  const model = new PlayerModel();
  const count = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  let tris = 0;
  model.object3D.traverse((o) => {
    if (!o.isMesh || o === model.shadow.mesh || o === model.smoke.mesh) return;
    tris += count(o.geometry);
  });
  assert.ok(tris >= 1500 && tris <= 3000, `triangles: ${tris}`);
  // The hot-foot smoke is one small instanced puff on top of that.
  assert.ok(count(model.smoke.mesh.geometry) <= 100, 'smoke puff');
});
