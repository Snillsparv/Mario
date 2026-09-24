// Hero model attack swells: the striking mitten / boot balloons during punches and kicks
// (cartoon readability), stays attached at its pivot, deflates smoothly even when the
// strike is cut short, and is exactly normal size in every other anim. The punching fist
// lands out beside the body, where the follow camera behind Pip can see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIM_NAMES } from '../src/player/model/animations.js';
import { applyPose } from '../src/player/model/rig.js';
import { createPose, copyPose } from '../src/player/model/pose.js';
import { BOOT_PIVOT_Y, HAND_R, SHIN } from '../src/player/model/dims.js';

const UP = { x: 0, y: 1, z: 0 };
const ATTACKS = ['punch1', 'punch2', 'kick', 'jump_kick', 'dive'];
const PARTS = [['hand L', (r) => r.armL.wrist], ['hand R', (r) => r.armR.wrist], ['foot L', (r) => r.legL.boot], ['foot R', (r) => r.legR.boot]];

const rs = (anim, animTime, extra = {}) => ({
  pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim, animTime, floorY: 0, floorNormal: UP, forwardVel: 0, vy: 0, cyclePhase: 0, ...extra,
});

// Scales of [handL, handR, footL, footR].
const scales = (model) => PARTS.map(([, get]) => get(model.rig).scale.x);

// Runs an anim from t0 for `seconds` at `fps`, calling f(model, t) after every frame.
function play(model, anim, seconds, f = () => {}, { fps = 60, t0 = 0, extra } = {}) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) {
    const t = t0 + i / fps;
    model.update(rs(anim, t, extra), 1 / fps);
    f(model, t);
  }
}

test('punches swell the fist to ~2.1x, kicks the boot to ~1.8x (the dive a subtle ~1.25x)', () => {
  const peak = (anim, extra) => {
    const model = new PlayerModel();
    const max = [0, 0, 0, 0];
    play(model, anim, 0.35, (m) => scales(m).forEach((s, i) => { max[i] = Math.max(max[i], s); }), { extra });
    return max;
  };
  const near = (v, lo, hi, label) => assert.ok(v >= lo && v <= hi, `${label}: ${v.toFixed(3)}`);
  const [p1L, p1R, p1fL, p1fR] = peak('punch1');
  near(p1R, 2.05, 2.3, 'punch1 right fist');
  assert.deepEqual([p1L, p1fL, p1fR], [1, 1, 1], 'punch1 swells only the right fist');
  const [p2L, p2R] = peak('punch2');
  near(p2L, 2.05, 2.3, 'punch2 left fist');
  assert.equal(p2R, 1);
  const [, , kL, kR] = peak('kick');
  near(kR, 1.75, 1.95, 'kick boot');
  assert.equal(kL, 1, 'planted boot keeps its size');
  near(peak('jump_kick', { pos: { x: 0, y: 60, z: 0 } })[3], 1.75, 1.95, 'jump kick boot');
  const [dL, dR] = peak('dive', { pos: { x: 0, y: 60, z: 0 }, forwardVel: 30 });
  near(dL, 1.15, 1.35, 'dive left mitten');
  near(dR, 1.15, 1.35, 'dive right mitten');
});

test('the fist is at full size when the punch is at full extension', () => {
  const model = new PlayerModel();
  play(model, 'punch1', 0.1); // jab out by 0.06 s, held to ~0.14 s
  assert.ok(Math.abs(model.rig.armR.wrist.scale.x - 2.1) < 0.06, `fist ${model.rig.armR.wrist.scale.x}`);
});

test('every other anim keeps mittens and boots at normal size, boots on the ankle', () => {
  for (const anim of ANIM_NAMES) {
    if (ATTACKS.includes(anim)) continue;
    const model = new PlayerModel();
    play(model, anim, 2.5, (m, t) => {
      const s = scales(m);
      for (let i = 0; i < 4; i++) assert.equal(s[i], 1, `${anim} t=${t.toFixed(2)}: ${PARTS[i][0]} scale ${s[i]}`);
      for (const side of ['L', 'R']) {
        const b = m.rig[`leg${side}`].boot.position;
        assert.ok(b.x === 0 && Math.abs(b.y + SHIN) < 1e-9 && Math.abs(b.z) < 1e-9, `${anim}: boot ${side} off the ankle`);
      }
    }, { fps: 30, extra: { forwardVel: 20, vy: -10 } });
  }
});

test('after an attack the swell is fully gone by the time the next anim settles', () => {
  // The Player's punch steps last 7 / 7 / 10 ticks; the dive and jump kick end on landing.
  for (const [anim, ends, next] of [['punch1', 7 / 30, 'idle'], ['punch2', 7 / 30, 'walk'], ['kick', 10 / 30, 'idle'],
    ['jump_kick', 0.2, 'land'], ['dive', 0.25, 'belly_slide']]) {
    const model = new PlayerModel();
    play(model, anim, ends);
    play(model, next, 0.3);
    assert.deepEqual(scales(model), [1, 1, 1, 1], `${anim} -> ${next}`);
  }
});

test('a punch cut short deflates smoothly (no pop) at any frame rate', () => {
  for (const fps of [30, 60, 144]) {
    for (const next of ['triple_jump', 'jump', 'idle', 'hurt']) {
      const model = new PlayerModel();
      play(model, 'punch1', 0.1, () => {}, { fps });
      let prev = model.rig.armR.wrist.scale.x;
      assert.ok(prev > 1.7);
      let frames = 0; // frames still swollen after the switch
      play(model, next, 0.3, (m) => {
        const s = m.rig.armR.wrist.scale.x;
        assert.ok(s <= prev + 1e-9, `${next} @${fps}: fist grew back (${prev} -> ${s})`);
        assert.ok(prev - s <= 8 / fps + 1e-9, `${next} @${fps}: fist shrank ${(prev - s).toFixed(3)} in one frame`);
        if (s > 1) frames++;
        prev = s;
      }, { fps, extra: { vy: 10 } });
      assert.ok((frames + 1) / fps >= 0.1 - 1e-9, `${next} @${fps}: deflated in ${frames + 1} frames`);
      assert.equal(prev, 1, `${next} @${fps}: fist back to normal`);
    }
  }
});

test('the punch-punch-kick combo hands the swell from fist to fist to boot without pops', () => {
  // Each strike pops its own part out with the blow (authored); nothing ever shrinks abruptly.
  const model = new PlayerModel();
  const fps = 60;
  let prev = scales(model);
  const check = (m) => {
    const s = scales(m);
    for (let i = 0; i < 4; i++) assert.ok(prev[i] - s[i] <= 8 / fps + 1e-9, `${PARTS[i][0]} dropped ${prev[i]} -> ${s[i]}`);
    prev = s;
  };
  play(model, 'idle', 0.2, check);
  play(model, 'punch1', 7 / 30, check);
  assert.ok(prev[1] > 1.2, 'right fist still swollen as punch2 starts');
  play(model, 'punch2', 7 / 30, check);
  play(model, 'kick', 10 / 30, check);
  play(model, 'idle', 0.4, check);
  assert.deepEqual(prev, [1, 1, 1, 1]);
});

test('the swollen fist lands out beside the body, not hidden behind it', () => {
  // Seen from the follow camera straight behind Pip, the torso (and the round belly) hides
  // whatever is in front of it; the jab must end with most of the fist past its silhouette.
  const v = new THREE.Vector3();
  for (const [anim, side, sign] of [['punch1', 'R', -1], ['punch2', 'L', 1]]) {
    const model = new PlayerModel();
    play(model, anim, 0.1);
    model.object3D.updateMatrixWorld(true);
    const fist = model.rig[`arm${side}`].hand.getWorldPosition(new THREE.Vector3());
    const r = HAND_R * model.rig[`arm${side}`].wrist.scale.x;
    // Widest point of the torso and skirt at the fist's height, on the punching side.
    let body = 0;
    for (const bone of [model.rig.torso, model.rig.hips]) {
      const pos = bone.children.find((o) => o.isMesh).geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(bone.matrixWorld);
        if (Math.abs(v.y - fist.y) < r) body = Math.max(body, v.x * sign);
      }
    }
    assert.ok(fist.x * sign > body, `${anim}: fist centre ${(fist.x * sign).toFixed(1)} inside the body (${body.toFixed(1)})`);
    assert.ok(fist.x * sign + r - body > 1.2 * r, `${anim}: only ${(fist.x * sign + r - body).toFixed(1)} of the fist shows`);
    assert.ok(fist.z > 35, `${anim}: fist ${fist.z.toFixed(1)} not out ahead`);
  }
});

test('swelling keeps the mitten on the wrist and the boot on the shin', () => {
  const pivots = (model) => {
    model.object3D.updateMatrixWorld(true);
    return [
      model.rig.armL.wrist.getWorldPosition(new THREE.Vector3()),
      model.rig.armR.wrist.getWorldPosition(new THREE.Vector3()),
      model.rig.legL.boot.localToWorld(new THREE.Vector3(0, BOOT_PIVOT_Y, 0)),
      model.rig.legR.boot.localToWorld(new THREE.Vector3(0, BOOT_PIVOT_Y, 0)),
    ];
  };
  const flat = createPose();
  for (const [anim, t] of [['punch1', 0.1], ['punch2', 0.1], ['kick', 0.15], ['jump_kick', 0.2], ['dive', 0.2]]) {
    const model = new PlayerModel();
    play(model, anim, t);
    const swollen = pivots(model);
    copyPose(flat, model.animator.pose);
    flat.handLSwell = flat.handRSwell = flat.footLSwell = flat.footRSwell = 0;
    applyPose(model.rig, flat, 0, 0, 0);
    const normal = pivots(model);
    for (let i = 0; i < 4; i++) {
      assert.ok(swollen[i].distanceTo(normal[i]) < 1e-6, `${anim}: ${PARTS[i][0]} pivot moved ${swollen[i].distanceTo(normal[i])}`);
    }
  }
});

test('the swollen kicking boot stays above the floor for the whole kick', () => {
  const model = new PlayerModel();
  const v = new THREE.Vector3();
  play(model, 'idle', 0.3);
  play(model, 'kick', 10 / 30, (m, t) => {
    if (m.rig.legR.boot.scale.x === 1) return; // (only the swell is under test)
    m.object3D.updateMatrixWorld(true);
    let low = Infinity;
    m.rig.legR.boot.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y);
    });
    assert.ok(low > -1, `t=${t.toFixed(3)}: kicking boot ${low.toFixed(1)} below the floor`);
  });
});

test('swell channels are sanitized: finite transforms even from extreme values', () => {
  const model = new PlayerModel();
  const p = createPose();
  for (const v of [-5, 0, 0.8, 40]) {
    p.handLSwell = p.handRSwell = p.footLSwell = p.footRSwell = v;
    applyPose(model.rig, p, 0, 0, 0);
    model.object3D.updateMatrixWorld(true);
    model.object3D.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${v}: ${o.name}`));
    for (const s of scales(model)) assert.ok(s >= 0.5 && s <= 2.5, `${v}: scale ${s}`);
  }
});
