// Hero model: the tree-top handstand (pole_handstand: rs.pos is the pole tip under his
// hands) with its cartwheel up from the climb and the carried switches back down, and the
// hot-foot reaction (burn) with its seat smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIMS } from '../src/player/model/animations.js';
import { HANG_DEPTH, POLE_GAP } from '../src/player/model/physicsLink.js';

const TREE_POLE_RADIUS = 40; // world/props/trees.js
const FLIP_DONE = 0.35; // the cartwheel up is over by then (s)

const world = (o) => o.getWorldPosition(new THREE.Vector3());
const headCentre = (m) => world(m.rig.head.children.find((c) => c.isGroup));
const hand = (m, s) => world(m.rig[`arm${s}`].hand);
const boot = (m, s) => world(m.rig[`leg${s}`].boot);

function assertFinite(model, label) {
  model.object3D.updateMatrixWorld(true);
  model.object3D.traverse((o) => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite transform on ${o.name || o.type}`);
  });
}

// Every drawn body vertex in world space (mittens flagged).
function eachVertex(model, f) {
  const v = new THREE.Vector3();
  model.object3D.updateMatrixWorld(true);
  model.rig.orient.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const mitten = /^wrist/.test(o.parent?.name ?? '');
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) f(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld), mitten, o);
  });
}

// Like the Player: pole_climb at the top of the climb, then pole_handstand with rs.pos
// jumping to the tip over one interpolated tick (frames at 60 fps). Returns the model and a
// step(anim, pos, animTime) helper that keeps going.
function climbToHandstand({ tip, yaw }) {
  const model = new PlayerModel();
  const back = TREE_POLE_RADIUS + POLE_GAP;
  const climb = { x: tip.x - Math.sin(yaw) * back, y: tip.y - HANG_DEPTH, z: tip.z - Math.cos(yaw) * back };
  const rs = { pos: { ...climb }, yaw, anim: 'pole_climb', animTime: 0, cyclePhase: 0, floorY: tip.y - 900 };
  const step = (anim, pos, animTime) => {
    rs.anim = anim;
    rs.pos = pos;
    rs.animTime = animTime;
    model.update(rs, 1 / 60);
    model.object3D.updateMatrixWorld(true);
  };
  for (let i = 0; i < 40; i++) {
    rs.cyclePhase += 0.04;
    step('pole_climb', { ...climb }, i / 60);
  }
  return { model, climb, step, rs };
}

const lerpPos = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

test('the new anims are registered: pole_handstand (carried, slow to leave) and burn', () => {
  assert.ok(ANIMS.pole_handstand && ANIMS.burn);
  assert.ok(ANIMS.pole_handstand.blendOut > 0.15, 'the handstand eases out into whatever follows');
  for (const a of ['pole_climb', 'pole_hold']) {
    assert.ok(ANIMS.pole_handstand.carryFrom.includes(a), `carried in from ${a}`);
    assert.ok(ANIMS[a].carryFrom.includes('pole_handstand'), `carried back into ${a}`);
  }
});

test('pole_handstand: mittens together on the tip, arms straight, upside down above it', () => {
  const tip = { x: 1200, y: 950, z: -700 };
  for (const yaw of [0, 1.1, -2.5]) {
    const model = new PlayerModel();
    for (let i = 0; i < 360; i++) {
      const t = FLIP_DONE + i / 60;
      model.update({ pos: tip, yaw, anim: 'pole_handstand', animTime: t, floorY: 0 }, 1 / 60);
      if (i % 45) continue;
      model.object3D.updateMatrixWorld(true);
      const label = `yaw ${yaw} t ${t.toFixed(2)}`;
      const hL = hand(model, 'L');
      const hR = hand(model, 'R');
      for (const h of [hL, hR]) {
        assert.ok(Math.hypot(h.x - tip.x, h.z - tip.z) < 9, `${label}: mitten off the tip`);
        assert.ok(h.y - tip.y > 5 && h.y - tip.y < 10, `${label}: mitten ${(h.y - tip.y).toFixed(1)} above the tip`);
      }
      assert.ok(hL.distanceTo(hR) < 18, `${label}: mittens apart`);
      const p = model.animator.pose;
      assert.ok(p.elbowL < 0.35 && p.elbowR < 0.35, `${label}: elbows bent ${p.elbowL.toFixed(2)} ${p.elbowR.toFixed(2)}`);
      // Upside down: the boots are high above the head, the head is above the tip.
      const head = headCentre(model);
      for (const s of ['L', 'R']) assert.ok(boot(model, s).y > head.y + 50, `${label}: ${s} boot not up`);
      assert.ok(head.y > tip.y + 15, `${label}: head at ${(head.y - tip.y).toFixed(1)}`);
      // Clear of the pole below the tip (a tip up to ~12 thick; the tree crown's leaves
      // curve away under the hat brim), and nothing hangs far below it.
      eachVertex(model, (v, mitten) => {
        if (mitten) return;
        assert.ok(v.y > tip.y - 22, `${label}: body ${(tip.y - v.y).toFixed(1)} below the tip`);
        if (v.y < tip.y - 1) assert.ok(Math.hypot(v.x - tip.x, v.z - tip.z) > 12, `${label}: body in the pole`);
      });
    }
    assertFinite(model, `handstand yaw ${yaw}`);
  }
});

test('pole_handstand sways about its hands', () => {
  const model = new PlayerModel();
  const tip = { x: 0, y: 500, z: 0 };
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let handDrift = 0;
  let start = null;
  for (let i = 0; i < 300; i++) {
    model.update({ pos: tip, yaw: 0, anim: 'pole_handstand', animTime: 1 + i / 60, floorY: 0 }, 1 / 60);
    model.object3D.updateMatrixWorld(true);
    const b = boot(model, 'L');
    lo.min(b);
    hi.max(b);
    const h = hand(model, 'L');
    start ??= h.clone();
    handDrift = Math.max(handDrift, h.distanceTo(start));
  }
  const sway = hi.sub(lo);
  assert.ok(Math.max(sway.x, sway.z) > 6, `boots sway only ${sway.x.toFixed(1)} x ${sway.z.toFixed(1)}`);
  assert.ok(Math.max(sway.x, sway.z) < 45, 'a gentle sway, not a tumble');
  assert.ok(handDrift < 0.5, `mitten slides ${handDrift.toFixed(2)} on the tip`);
});

test('cartwheel up from the top of the climb: continuous, then on the tip', () => {
  for (const yaw of [0, 0.7, -2]) {
    const tip = { x: 300, y: 1000, z: 200 };
    const { model, climb, step } = climbToHandstand({ tip, yaw });
    let prev = headCentre(model);
    let maxStep = 0;
    // The Player: anim switches on the tick rs.pos jumps to the tip; animTicks = 1 after that
    // tick, so animTime runs 0 -> 1/30 while the render interpolates pos across it.
    for (let f = 1; f <= 30; f++) {
      step('pole_handstand', lerpPos(climb, tip, Math.min(1, f / 2)), f / 60);
      const h = headCentre(model);
      maxStep = Math.max(maxStep, h.distanceTo(prev));
      prev = h;
    }
    assert.ok(maxStep < 30, `yaw ${yaw}: head jumps ${maxStep.toFixed(1)} in one frame`);
    for (const s of ['L', 'R']) {
      const h = hand(model, s);
      assert.ok(Math.hypot(h.x - tip.x, h.z - tip.z) < 9 && Math.abs(h.y - tip.y - 7.5) < 2, `yaw ${yaw}: ${s} mitten not on the tip`);
    }
    assertFinite(model, `cartwheel yaw ${yaw}`);
  }
});

test('the cartwheel starts where pole_climb left him (the carried entry offset)', () => {
  const tip = { x: 0, y: 800, z: 0 };
  const { model, climb, step } = climbToHandstand({ tip, yaw: 0.4 });
  step('pole_handstand', lerpPos(climb, tip, 0.5), 1 / 60);
  step('pole_handstand', tip, 2 / 60);
  const c = model.animator.ctx;
  // In the body frame: the climbing spot is HANG_DEPTH down and radius + POLE_GAP behind.
  assert.ok(Math.abs(c.entryY + HANG_DEPTH) < 1e-6, `entryY ${c.entryY}`);
  assert.ok(Math.abs(c.entryZ + TREE_POLE_RADIUS + POLE_GAP) < 1e-6, `entryZ ${c.entryZ}`);
  assert.ok(Math.abs(c.entryX) < 1e-6, `entryX ${c.entryX}`);
  // Entered from an anim it does not carry from (or teleported): nothing carried.
  const other = new PlayerModel();
  other.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'jump', animTime: 0.3 }, 1 / 60);
  other.update({ pos: { x: 0, y: 160, z: 70 }, anim: 'pole_handstand', animTime: 0 }, 1 / 60);
  assert.equal(other.animator.ctx.entryY, 0);
  const far = new PlayerModel();
  far.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'pole_climb', animTime: 0.3 }, 1 / 60);
  far.update({ pos: { x: 3000, y: 0, z: 0 }, anim: 'pole_handstand', animTime: 0 }, 1 / 60);
  assert.equal(far.animator.ctx.entryX, 0);
});

test('from the handstand back onto the trunk (rs.pos drops to the climbing spot): no jump', () => {
  const tip = { x: -400, y: 900, z: 250 };
  const { model, climb, step, rs } = climbToHandstand({ tip, yaw: 1.3 });
  for (let f = 0; f < 90; f++) step('pole_handstand', tip, f / 60);
  let prev = headCentre(model);
  let maxStep = 0;
  for (let f = 1; f <= 30; f++) {
    rs.cyclePhase += 0.04;
    step('pole_climb', lerpPos(tip, climb, Math.min(1, f / 2)), f / 60);
    const h = headCentre(model);
    maxStep = Math.max(maxStep, h.distanceTo(prev));
    prev = h;
  }
  // The body swings down over the handstand's blendOut (~180 units in ~0.3 s), no pops.
  assert.ok(maxStep < 25, `head jumps ${maxStep.toFixed(1)} in one frame`);
  assert.equal(model.animator.blendDur, ANIMS.pole_handstand.blendOut);
});

test('jumping off the handstand eases out instead of snapping (into a somersault too)', () => {
  // The Player's jump off the tip is pole_top_jump, shown as triple_jump (a forward flip).
  for (const [anim, t0] of [['jump', 1], ['triple_jump', 1], ['triple_jump', 1.37]]) {
    const tip = { x: 0, y: 500, z: 0 };
    const model = new PlayerModel();
    for (let i = 0; i < 60; i++) model.update({ pos: tip, anim: 'pole_handstand', animTime: t0 + i / 60 }, 1 / 60);
    const pos = { ...tip };
    model.object3D.updateMatrixWorld(true);
    let prev = headCentre(model);
    let maxStep = 0;
    for (let i = 1; i <= 30; i++) {
      pos.y += 20; // rising off the tip
      model.update({ pos, anim, animTime: i / 60, vy: 40 }, 1 / 60);
      model.object3D.updateMatrixWorld(true);
      const h = headCentre(model);
      maxStep = Math.max(maxStep, h.distanceTo(prev) - 20);
      prev = h;
    }
    assert.ok(maxStep < 25, `${anim}: head pops ${maxStep.toFixed(1)} beyond the rise in one frame`);
    assertFinite(model, `off the tip into ${anim}`);
  }
});

test('blends into a spinning flip stay continuous (no half-turn jump mid-blend)', () => {
  // A slow blend (out of the handstand) into a somersault whose rotation passes half a turn
  // from the start pose while the blend is still running.
  const model = new PlayerModel();
  for (let i = 0; i < 60; i++) model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'pole_handstand', animTime: 1 + i / 60 }, 1 / 60);
  let prev = model.animator.pose.flipPitch;
  let worst = 0;
  for (let i = 1; i <= 40; i++) {
    model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'triple_jump', animTime: i / 60 }, 1 / 60);
    const p = model.animator.pose.flipPitch;
    worst = Math.max(worst, Math.abs(p - prev));
    prev = p;
  }
  assert.ok(worst < 0.6, `flipPitch jumps ${worst.toFixed(2)} rad in one frame`);
});

test('burn: mittens clutch the seat, legs run about three strides a second, panic face', () => {
  const model = new PlayerModel();
  const swings = [];
  for (let i = 0; i <= 120; i++) {
    const t = 0.3 + i / 120;
    model.update({ pos: { x: 0, y: 200, z: 0 }, anim: 'burn', animTime: t, vy: 20, floorY: 0 }, 1 / 120);
    swings.push(model.animator.pose.legLSwing);
    if (i % 30) continue;
    model.object3D.updateMatrixWorld(true);
    const hips = world(model.rig.hips);
    for (const s of ['L', 'R']) {
      const h = hand(model, s);
      assert.ok(h.z < hips.z - 18, `t ${t.toFixed(2)}: ${s} mitten ${(h.z - hips.z).toFixed(1)} from the hips (not behind)`);
      assert.ok(Math.abs(h.y - hips.y) < 20, `t ${t.toFixed(2)}: ${s} mitten ${(h.y - hips.y).toFixed(1)} above the hips`);
    }
    assert.equal(model.animator.pose.face, 'panic');
  }
  const mean = swings.reduce((a, b) => a + b, 0) / swings.length;
  let crossings = 0;
  for (let i = 1; i < swings.length; i++) if ((swings[i] - mean) * (swings[i - 1] - mean) < 0) crossings++;
  assert.ok(crossings >= 4 && crossings <= 9, `${crossings / 2} leg cycles in a second`);
  assert.ok(Math.max(...swings) - Math.min(...swings) > 1.5, 'big running strides');
  // Leaning forward.
  assert.ok(model.animator.pose.flipPitch > 0.2);
  assertFinite(model, 'burn');
});

test('hot-foot smoke trails from the seat while he shoots up, and only then', () => {
  const model = new PlayerModel();
  const rs = { pos: { x: 0, y: 0, z: 0 }, yaw: 0.5, anim: 'idle', animTime: 0, vy: 0, floorY: 0 };
  for (let i = 0; i < 30; i++) {
    rs.animTime = i / 60;
    model.update(rs, 1 / 60);
  }
  assert.equal(model.smoke.mesh.count, 0, 'no smoke standing about');
  assert.equal(model.smoke.mesh.visible, false);
  Object.assign(rs, { anim: 'burn', vy: 45 });
  for (let i = 0; i < 18; i++) {
    rs.animTime = i / 60;
    rs.pos.y += rs.vy / 2;
    rs.vy -= 2;
    model.update(rs, 1 / 60);
  }
  const smoke = model.smoke.mesh;
  assert.ok(smoke.visible && smoke.count >= 5, `${smoke.count} puffs`);
  // The puffs stay in the air where they came out: below the rising seat.
  model.object3D.updateMatrixWorld(true);
  const seat = world(model.rig.hips).y;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let below = 0;
  for (let i = 0; i < smoke.count; i++) {
    smoke.getMatrixAt(i, m);
    p.setFromMatrixPosition(m).applyMatrix4(model.object3D.matrixWorld);
    if (p.y < seat - 20) below++;
    assert.ok(Number.isFinite(p.x + p.y + p.z));
  }
  assert.ok(below >= smoke.count / 2, `${below} of ${smoke.count} puffs trail below him`);
  // Paused (dt 0): frozen.
  const before = smoke.count;
  model.update(rs, 0);
  assert.equal(smoke.count, before);
  // Landed: the puffs clear within about half a second.
  Object.assign(rs, { anim: 'land', vy: 0 });
  for (let i = 0; i < 40; i++) {
    rs.animTime = i / 60;
    model.update(rs, 1 / 60);
  }
  assert.equal(smoke.count, 0);
  assert.equal(smoke.visible, false);
});
