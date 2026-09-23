// Hero model contacts: Pip's poses line up with where the physics puts him (ledge lip,
// trunk, wall, floor), planted boots keep pace with the ground, slides lie on slopes, and
// the body stays cheap to draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { gaitStride } from '../src/player/model/strides.js';
import { HAND_R, HEAD_R } from '../src/player/model/dims.js';
import {
  HANG_DEPTH, WALL_DIST, POLE_GAP, LEDGE_CLIMB_TIME, STROKE_TIME, climbProgress, physicsStride,
} from '../src/player/model/physicsLink.js';

const UP = { x: 0, y: 1, z: 0 };

// Poses a fresh model (blends settled) and returns it with world matrices current.
function posed(rs, frames = 40) {
  const model = new PlayerModel();
  const full = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, floorY: -500, floorNormal: UP, ...rs };
  for (let i = 0; i < frames; i++) model.update(full, 1 / 60);
  model.object3D.updateMatrixWorld(true);
  return model;
}

// World-space vertices of the hero's body (not the shadow).
function vertices(model) {
  const out = [];
  const v = new THREE.Vector3();
  model.rig.orient.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
  });
  return out;
}

const hand = (model, side) => model.rig[`arm${side}`].hand.getWorldPosition(new THREE.Vector3());
const headCentre = (model) => model.rig.head.children.find((c) => c.isGroup).getWorldPosition(new THREE.Vector3());
const maxOf = (list, f) => list.reduce((m, x) => Math.max(m, f(x)), -Infinity);

// Lip frame: y = 0 is the ledge top, z = 0 the wall face; the ledge block is y < 0, z > 0.
function ledgeModel(anim, u, inset = 65) {
  const { up, fwd } = climbProgress(u);
  const pos = { x: 0, y: -HANG_DEPTH * (1 - up), z: -WALL_DIST + inset * fwd };
  return posed({ pos, anim, animTime: anim === 'ledge_hang' ? 0.6 : u * LEDGE_CLIMB_TIME });
}

test('ledge_hang: mittens rest on the lip, body hangs clear of the wall', () => {
  const model = ledgeModel('ledge_hang', 0);
  for (const side of ['L', 'R']) {
    const h = hand(model, side);
    assert.ok(h.y > 2 && h.y < 8, `${side} mitten height over the lip ${h.y}`);
    assert.ok(h.z > 1 && h.z < 9, `${side} mitten past the edge ${h.z}`);
  }
  const buried = maxOf(vertices(model).filter((v) => v.y < -6), (v) => v.z);
  assert.ok(buried < 1, `body ${buried} units inside the wall`);
});

test('ledge_climb: follows the physics onto the top without sinking into it', () => {
  for (const inset of [50, 65, 80]) {
    for (let u = 0.05; u < 1; u += 0.05) {
      const model = ledgeModel('ledge_climb', u, inset);
      const inside = maxOf(vertices(model).filter((v) => v.y < -3), (v) => v.z);
      assert.ok(inside < 12, `inset ${inset} u ${u.toFixed(2)}: ${inside.toFixed(1)} units into the ledge`);
    }
  }
  // At the end of the action the lift is gone and Pip stands on rs.pos.
  const end = posed({ anim: 'ledge_climb', animTime: LEDGE_CLIMB_TIME, floorY: 0 }).animator.pose;
  for (const c of ['rootY', 'rootZ', 'hipsY']) assert.ok(Math.abs(end[c]) < 1e-6, `${c} = ${end[c]}`);
});

test('pole: mittens on the bark, face and hat brim clear of the trunk', () => {
  for (const anim of ['pole_hold', 'pole_climb']) {
    for (const ph of [0, 0.25, 0.5, 0.75]) {
      const model = posed({ anim, animTime: 0.5, cyclePhase: ph });
      const verts = vertices(model);
      for (const r of [30, 40]) {
        const axisZ = POLE_GAP + r;
        const inside = maxOf(verts, (v) => r - Math.hypot(v.x, v.z - axisZ));
        assert.ok(inside < 7, `${anim} ${ph} r${r}: ${inside.toFixed(1)} units inside the trunk`);
        for (const side of ['L', 'R']) {
          const h = hand(model, side);
          const gap = Math.hypot(h.x, h.z - axisZ) - r;
          assert.ok(gap > 0 && gap < HAND_R + 6, `${anim} ${ph} r${r} ${side} mitten gap ${gap.toFixed(1)}`);
        }
        const head = headCentre(model);
        assert.ok(Math.hypot(head.x, head.z - axisZ) > r + HEAD_R - 4, `${anim} head in the trunk`);
      }
    }
  }
});

test('push: shoulder and mitten meet the wall, nothing passes through it', () => {
  for (const t of [0.1, 0.35, 0.6]) {
    const model = posed({ anim: 'push', animTime: t, floorY: 0 });
    const front = maxOf(vertices(model), (v) => v.z);
    assert.ok(front < WALL_DIST + 1 && front > WALL_DIST - 4, `front of Pip at ${front.toFixed(1)}`);
    assert.ok(Math.abs(hand(model, 'R').z - (WALL_DIST - HAND_R)) < 1, 'right mitten flat on the wall');
  }
});

// Lowest vertex of a boot in world space, with its index (to follow it next frame).
function lowestOf(boot) {
  const pos = boot.children.find((o) => o.isMesh).geometry.attributes.position;
  let best = null;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(boot.matrixWorld);
    if (!best || v.y < best.v.y) best = { i, v };
  }
  return best;
}

// Body-space velocity of the vertex touching the floor, per gait cycle, across each gait's
// speed range (the stride changes with speed, and the run gains a flight phase).
test('gaits: planted boots keep pace with the ground', () => {
  for (const [anim, fv] of [['walk', 10], ['walk', 17], ['run', 12], ['run', 18], ['run', 32], ['run', 48],
    ['tiptoe', 5], ['crawl', 3]]) {
    const stride = gaitStride(anim, fv);
    const ratio = stride / (physicsStride(anim) || stride); // Player cycles per gait cycle
    const model = posed({ anim, animTime: 1, cyclePhase: 0, forwardVel: fv, floorY: 0 });
    const boots = ['L', 'R'].map((s) => model.rig[`leg${s}`].boot);
    const N = 200;
    let slip = 0;
    let samples = 0;
    let minY = Infinity;
    let prev = null;
    for (let k = 0; k <= N; k++) {
      model.update({ pos: { x: 0, y: 0, z: 0 }, anim, animTime: 1, cyclePhase: (k / N) * ratio, forwardVel: fv, floorY: 0 }, 0);
      model.object3D.updateMatrixWorld(true);
      const now = boots.map(lowestOf);
      now.forEach((c, b) => {
        minY = Math.min(minY, c.v.y);
        if (!prev || c.v.y > 1.5 || prev[b].v.y > 1.5) return;
        // Follow the vertex that was touching last step (the boot rolls heel to toe).
        const pos = boots[b].children.find((o) => o.isMesh).geometry.attributes.position;
        const same = new THREE.Vector3().fromBufferAttribute(pos, prev[b].i).applyMatrix4(boots[b].matrixWorld);
        slip += Math.abs((same.z - prev[b].v.z) * N + stride);
        samples++;
      });
      prev = now;
    }
    assert.ok(samples > N * 0.25, `${anim} ${fv}: boots hardly touch the floor`);
    assert.ok(slip / samples < stride * 0.12, `${anim} ${fv}: boots skate ${(slip / samples).toFixed(1)} per cycle`);
    assert.ok(minY > -2.5, `${anim} ${fv}: boot sinks to ${minY.toFixed(1)}`);
  }
});

test('gait cadence: a bounding run at full speed, no cadence jump from walk to run', () => {
  const cadence = (anim, fv) => (fv * 30) / gaitStride(anim, fv); // cycles per second
  assert.ok(Math.abs(cadence('run', 32) - 4) < 0.01, 'full-stick run: 4 strides per second');
  assert.equal(gaitStride('run', 32), 240);
  assert.ok(cadence('run', 48) < 5.5, `top-speed run ${cadence('run', 48)}`);
  const drop = cadence('run', 18) / cadence('walk', 17.9);
  assert.ok(drop > 0.8 && drop < 1.2, `walk -> run cadence ratio ${drop.toFixed(2)}`);
  for (let fv = 8; fv < 18; fv += 1) assert.ok(cadence('walk', fv) <= 4.6, `walk at ${fv}: ${cadence('walk', fv)}`);
});

test('gait phase stays continuous across gait switches and speed changes', () => {
  const model = new PlayerModel();
  const rs = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'tiptoe', animTime: 0, cyclePhase: 37.3, forwardVel: 6, floorY: 0 };
  let last = null;
  // Speed up from a tiptoe through the walk into a full run, as the Player would.
  for (let i = 0; i < 240; i++) {
    const fv = Math.min(32, 6 + i * 0.25);
    const anim = fv < 8 ? 'tiptoe' : fv < 18 ? 'walk' : 'run';
    if (anim !== rs.anim) rs.animTime = 0;
    rs.anim = anim;
    rs.forwardVel = fv;
    rs.animTime += 1 / 60;
    rs.cyclePhase += (fv / 2) / physicsStride(anim); // half a tick of travel per frame
    model.update(rs, 1 / 60);
    const ph = model.animator.gaitPhase;
    // Never more than the distance travelled over the gait's shortest stride.
    if (last !== null) assert.ok(ph - last >= 0 && ph - last < 0.2, `phase jumped by ${ph - last} at frame ${i}`);
    last = ph;
  }
});

test('footsteps line up: at the full-stick run the gait phase locks onto the Player cycle', () => {
  const model = new PlayerModel();
  const rs = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'walk', animTime: 0, cyclePhase: 5.1, forwardVel: 12, floorY: 0 };
  for (let i = 0; i < 60; i++) {
    rs.cyclePhase += 6 / physicsStride('walk');
    model.update(rs, 1 / 60);
  }
  rs.anim = 'run';
  rs.forwardVel = 32;
  for (let i = 0; i < 300; i++) {
    rs.cyclePhase += 16 / physicsStride('run');
    model.update(rs, 1 / 60);
  }
  const off = model.animator.gaitPhase - rs.cyclePhase;
  assert.ok(Math.abs(off - Math.round(off * 2) / 2) < 0.01, `heel strikes ${off} cycles off the footsteps`);
});

test('turn banking leans the body but keeps the boots planted', () => {
  const measure = (turnRate) => {
    const model = new PlayerModel();
    const rs = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'run', animTime: 0, cyclePhase: 0, forwardVel: 32, floorY: 0 };
    const low = { L: Infinity, R: Infinity };
    let minY = Infinity;
    for (let i = 0; i < 120; i++) {
      rs.yaw += turnRate / 60;
      rs.cyclePhase += 16 / physicsStride('run');
      rs.animTime += 1 / 60;
      model.update(rs, 1 / 60);
      if (i < 60) continue;
      model.object3D.updateMatrixWorld(true);
      for (const s of ['L', 'R']) {
        const y = lowestOf(model.rig[`leg${s}`].boot).v.y;
        low[s] = Math.min(low[s], y);
        minY = Math.min(minY, y);
      }
    }
    return { bank: model.bank, low, minY };
  };
  const turn = measure(((11.25 * Math.PI) / 180) * 30);
  assert.ok(Math.abs(turn.bank) > 0.2, `bank ${turn.bank}`);
  for (const s of ['L', 'R']) assert.ok(turn.low[s] < 1.5, `${s} boot never touches down (${turn.low[s].toFixed(1)})`);
  assert.ok(turn.minY > -2.5, `boot sinks to ${turn.minY.toFixed(1)}`);
});

test('slides lie on sloped floors instead of sinking into them', () => {
  for (const anim of ['belly_slide', 'butt_slide', 'crouch_slide']) {
    for (const deg of [0, 30, 45]) {
      const th = (deg * Math.PI) / 180;
      const n = { x: 0, y: Math.cos(th), z: Math.sin(th) }; // downhill ahead
      const model = posed({ anim, animTime: 0.3, pitch: th, forwardVel: 20, floorY: 0, floorNormal: n });
      const N = new THREE.Vector3(n.x, n.y, n.z);
      const lowest = vertices(model).reduce((m, v) => Math.min(m, v.dot(N)), Infinity);
      assert.ok(lowest > -2 && lowest < 5, `${anim} on ${deg} deg: lowest point ${lowest.toFixed(1)} off the floor`);
    }
  }
});

test('raised and reaching mittens stay out of the face', () => {
  const cases = [['jump', 0.25, 20], ['double_jump', 0.35, 15], ['water_jump', 0.2, 20], ['dive', 0.3, -5],
    ['long_jump', 0.3, 0], ['spawn', 0.5, -20], ['star_dance', 1.4, 0], ['ground_pound_fall', 0.3, -50]];
  for (const [anim, t, vy] of cases) {
    const model = posed({ anim, animTime: t, vy, forwardVel: 20 });
    const head = headCentre(model);
    for (const side of ['L', 'R']) {
      const d = hand(model, side).distanceTo(head);
      assert.ok(d > HEAD_R * 1.07 + HAND_R - 2, `${anim}: ${side} mitten ${d.toFixed(1)} from the head centre`);
    }
  }
});

test('spawn is an airborne pose (no landing squash); the stroke matches the physics', () => {
  for (let t = 0; t < 1.2; t += 0.05) {
    assert.ok(posed({ anim: 'spawn', animTime: t }, 2).animator.pose.squash >= 0, `spawn squashes at ${t}`);
  }
  const a = posed({ anim: 'swim_stroke', animTime: 0.1 }).animator.pose;
  const b = posed({ anim: 'swim_stroke', animTime: 0.1 + STROKE_TIME }).animator.pose;
  assert.ok(Math.abs(a.armLSwing - b.armLSwing) < 1e-6 && Math.abs(a.kneeL - b.kneeL) < 1e-6);
});

test('invincibility flicker rate does not depend on the display refresh', () => {
  const toggles = (fps) => {
    const model = new PlayerModel();
    let last = true;
    let n = 0;
    for (let i = 0; i < fps; i++) {
      model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'idle', animTime: i / fps, floorY: 0, invincible: true }, 1 / fps);
      if (model.rig.orient.visible !== last) n++;
      last = model.rig.orient.visible;
    }
    return n;
  };
  const at60 = toggles(60);
  assert.ok(at60 >= 13 && at60 <= 16, `${at60} toggles per second`);
  assert.ok(Math.abs(toggles(144) - at60) <= 1);
});

test('one body material and about a mesh per bone', () => {
  const model = new PlayerModel();
  const meshes = [];
  model.object3D.traverse((o) => o.isMesh && meshes.push(o));
  const materials = new Set(meshes.map((m) => m.material));
  assert.ok(meshes.length <= 22, `${meshes.length} meshes`);
  assert.equal(materials.size, 3, 'body + face + shadow');
});

// Frontmost point of the painted skull (the face) in body space.
function faceFront(model) {
  let front = -Infinity;
  const v = new THREE.Vector3();
  model.rig.orient.traverse((o) => {
    if (!o.isMesh || o.material !== model.faceMaterial) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) front = Math.max(front, v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).z);
  });
  return front;
}

test('forward-leaning ground poses keep the face inside the collision radius', () => {
  const cases = [['walk', 1, 12, 0.1], ['walk', 1, 17, 0.35], ['tiptoe', 1, 6, 0.2], ['crouch', 0.5, 0, 0],
    ['land', 0.06, 0, 0], ['punch1', 0.08, 0, 0], ['punch2', 0.1, 0, 0], ['turnaround', 0.1, 0, 0], ['crawl', 1, 3, 0.3]];
  for (const fv of [12, 18, 32, 48]) for (const ph of [0, 0.15, 0.3, 0.45]) cases.push(['run', 1, fv, ph]);
  for (const [anim, t, fv, cyclePhase] of cases) {
    const model = posed({ anim, animTime: t, forwardVel: fv, cyclePhase, floorY: 0 });
    const front = faceFront(model);
    assert.ok(front < WALL_DIST + 1, `${anim} fv ${fv} ph ${cyclePhase}: face ${front.toFixed(1)} forward`);
  }
});

test('a mid-air wall hit shows a brace: mittens on the wall, face clear, nothing through it', () => {
  for (const t of [0, 0.033, 0.066]) {
    const model = posed({ pos: { x: 0, y: 60, z: 0 }, action: 'air_hit_wall', anim: 'wallkick', animTime: t, floorY: 0 });
    assert.equal(model.animator.anim, 'wall_brace');
    const verts = vertices(model);
    const front = maxOf(verts, (v) => v.z);
    assert.ok(front < WALL_DIST + 1, `front of Pip at ${front.toFixed(1)}`);
    assert.ok(faceFront(model) < WALL_DIST - 15, 'face well back from the wall');
    for (const side of ['L', 'R']) assert.ok(Math.abs(hand(model, side).z - (WALL_DIST - 2 - HAND_R)) < 3, `${side} mitten on the wall`);
  }
  // The wall kick itself (A pressed) switches back to the push-off pose.
  const kick = posed({ pos: { x: 0, y: 60, z: 0 }, action: 'wallkick', anim: 'wallkick', animTime: 0.05 });
  assert.equal(kick.animator.anim, 'wallkick');
});

test('the idle glance gives way to the Player look-around (headYaw)', () => {
  const idleAt = (t, headYaw) => posed({ anim: 'idle', animTime: t, headYaw, floorY: 0 }, 1).animator.pose.headYaw;
  assert.ok(Math.abs(idleAt(4, 0)) > 0.5, 'built-in glance plays without a Player look');
  assert.equal(idleAt(4, 0.4), 0, 'no built-in glance on top of the Player look');
  // Once the Player drives the look, its zero crossings do not let the built-in glance pop in.
  const model = new PlayerModel();
  const rs = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'idle', animTime: 4, floorY: 0, headYaw: 0.4 };
  model.update(rs, 1 / 60);
  rs.headYaw = 0;
  rs.animTime += 1 / 60;
  model.update(rs, 1 / 60);
  assert.equal(model.animator.pose.headYaw, 0);
});
