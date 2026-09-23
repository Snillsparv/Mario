// Hero model: every AnimName poses without throwing and yields finite transforms, unknown
// anims fall back to idle, the blob shadow follows the floor, and the budget holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIM_NAMES, resolveAnim } from '../src/player/model/animations.js';
import { CHANNELS } from '../src/player/model/pose.js';
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
  let tris = 0;
  model.object3D.traverse((o) => {
    if (!o.isMesh || o === model.shadow.mesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  assert.ok(tris >= 1500 && tris <= 3000, `triangles: ${tris}`);
});
