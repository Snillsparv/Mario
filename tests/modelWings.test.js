// Hero model, round 5: the winged hat (wings on Pip's hat while RenderState.wingHat, a
// blink while wingHatEnding, flap styles that follow the action), the 'fly' anim with its
// take-off somersault, the standalone buildWingedHat() pickup model, the stomp bounce, and
// a slightly rounder build that keeps his outfit, face and colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Session } from 'node:inspector/promises';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ANIMS } from '../src/player/model/animations.js';
import { CHANNELS, createPose, copyPose } from '../src/player/model/pose.js';
import { buildWingedHat, BOUND_R } from '../src/player/model/wings.js';
import { COLORS } from '../src/player/model/palette.js';
import { wrapAngle } from '../src/core/math.js';

const UP = { x: 0, y: 1, z: 0 };
const base = (over) => ({
  pos: { x: 0, y: 200, z: 0 }, yaw: 0, anim: 'idle', animTime: 0.5, floorY: 0, floorNormal: UP, ...over,
});

// Runs `frames` model frames at 60 fps, animTime advancing; returns the model.
function run(model, rs, frames, f) {
  for (let i = 0; i < frames; i++) {
    model.update(rs, 1 / 60);
    rs.animTime += 1 / 60;
    f?.(model, i);
  }
  return model;
}

const wingPos = (model) => model.wings.mesh.geometry.attributes.position.array;

// Brim top (hat space) at (x, z), from the hat's lathe in rig.js; -Infinity past the brim.
function brimTop(x, z) {
  const zs = z / 0.88;
  const r = Math.hypot(x, zs);
  if (r > 50) return -Infinity;
  return 1.4 + (r > 20 ? 6 * ((x * x) / (r * r)) * ((r - 20) / 30) : 0);
}

test('the wings appear only with the winged hat, as one mesh on the hat', () => {
  const model = new PlayerModel();
  const wings = model.wings.mesh;
  run(model, base({}), 10);
  assert.equal(wings.visible, false, 'no wings without the hat');
  run(model, base({ wingHat: true }), 30);
  assert.equal(wings.visible, true);
  assert.equal(wings.material, model.rig.material, 'shares the body material (no extra program)');
  let p = wings.parent;
  while (p && p !== model.rig.head) p = p.parent;
  assert.ok(p, 'rides on the head (the hat marker)');
  assert.equal(wings.parent, model.rig.hat);
  // Off again: hidden at once.
  run(model, base({ wingHat: false }), 1);
  assert.equal(wings.visible, false);
});

test('the wings pop open when the hat goes on', () => {
  const model = run(new PlayerModel(), base({}), 10);
  const rs = base({ wingHat: true });
  const reach = () => {
    const a = wingPos(model);
    let r = 0;
    for (let i = 0; i < a.length; i += 3) r = Math.max(r, Math.hypot(a[i], a[i + 1], a[i + 2]));
    return r;
  };
  run(model, rs, 1);
  const first = reach();
  run(model, rs, 40);
  const open = reach();
  assert.ok(first < open * 0.6, `first frame reach ${first.toFixed(1)} vs open ${open.toFixed(1)}`);
  assert.ok(open > 55, `open wings reach ${open.toFixed(1)} from the hat centre`);
});

test('wingHatEnding blinks the wings (the body stays drawn)', () => {
  const model = run(new PlayerModel(), base({ wingHat: true }), 30);
  const seen = new Set();
  run(model, base({ wingHat: true, wingHatEnding: true }), 30, (m) => {
    seen.add(m.wings.mesh.visible);
    assert.equal(m.rig.orient.visible, true);
  });
  assert.deepEqual([...seen].sort(), [false, true]);
  // Toggles about 10 times a second whatever the refresh rate.
  const toggles = (fps) => {
    const m = run(new PlayerModel(), base({ wingHat: true }), 10);
    let last = m.wings.mesh.visible;
    let n = 0;
    for (let i = 0; i < fps; i++) {
      m.update(base({ wingHat: true, wingHatEnding: true }), 1 / fps);
      if (m.wings.mesh.visible !== last) n++;
      last = m.wings.mesh.visible;
    }
    return n;
  };
  const at60 = toggles(60);
  assert.ok(at60 >= 8 && at60 <= 12, `${at60} toggles per second`);
  assert.ok(Math.abs(toggles(144) - at60) <= 1);
  // wingHatEnding without the hat means nothing.
  const bare = run(new PlayerModel(), base({ wingHatEnding: true }), 5);
  assert.equal(bare.wings.mesh.visible, false);
});

// Vertical travel of the left wing's outermost tip (hat space) over `frames` frames.
function tipTravel(rs, frames = 90) {
  const model = run(new PlayerModel(), rs, 60);
  let lo = Infinity;
  let hi = -Infinity;
  let back = 0;
  run(model, rs, frames, (m) => {
    const a = wingPos(m);
    let best = 0;
    for (let i = 3; i < a.length / 2; i += 3) if (a[i] > a[best]) best = i;
    lo = Math.min(lo, a[best + 1]);
    hi = Math.max(hi, a[best + 1]);
    let z = Infinity;
    for (let i = 0; i < a.length; i += 3) z = Math.min(z, a[i + 2]);
    back += z / frames;
  });
  return { travel: hi - lo, back };
}

test('flap styles: gentle on the ground, strong in flight (hardest climbing), folded back diving', () => {
  const idle = tipTravel(base({ wingHat: true }));
  const run48 = tipTravel(base({ wingHat: true, anim: 'run', forwardVel: 48 }));
  const glide = tipTravel(base({ wingHat: true, anim: 'fly', forwardVel: 40, pitch: 0.1 }));
  const climb = tipTravel(base({ wingHat: true, anim: 'fly', forwardVel: 40, pitch: -0.8 }));
  const dive = tipTravel(base({ wingHat: true, anim: 'fly', forwardVel: 60, pitch: 0.9 }));
  assert.ok(idle.travel > 2 && idle.travel < 15, `idle flutter ${idle.travel.toFixed(1)}`);
  assert.ok(run48.travel > idle.travel, 'a quicker, bigger flutter at a run');
  assert.ok(glide.travel > 2 * idle.travel, `flight beats ${glide.travel.toFixed(1)} vs idle ${idle.travel.toFixed(1)}`);
  assert.ok(climb.travel > glide.travel, `climb ${climb.travel.toFixed(1)} vs glide ${glide.travel.toFixed(1)}`);
  assert.ok(dive.travel < glide.travel * 0.6, `dive ${dive.travel.toFixed(1)}`);
  assert.ok(dive.back < glide.back - 8, `folded back: ${dive.back.toFixed(1)} vs ${glide.back.toFixed(1)}`);
});

test('the wings never dip into the brim and stay inside their fixed bounds', () => {
  const cases = [
    ['idle', 0, 0], ['run', 0, 48], ['jump', 0, 20], ['fall', 0, 0], ['dive', 0, 30], ['swim_stroke', 0, 8],
    ['fly', 0.1, 45], ['fly', -0.9, 40], ['fly', 0.9, 70], ['pole_handstand', 0, 0], ['star_dance', 0, 0],
  ];
  const sphere = new THREE.Sphere();
  for (const [anim, pitch, forwardVel] of cases) {
    const model = new PlayerModel();
    sphere.copy(model.wings.mesh.geometry.boundingSphere);
    assert.equal(sphere.radius, BOUND_R);
    const v = new THREE.Vector3();
    run(model, base({ wingHat: true, anim, pitch, forwardVel }), 150, (m, i) => {
      const a = wingPos(m);
      for (let k = 0; k < a.length; k += 3) {
        assert.ok(a[k + 1] > brimTop(a[k], a[k + 2]) + 1, `${anim} ${pitch}: wing through the brim (frame ${i})`);
        assert.ok(sphere.containsPoint(v.fromArray(a, k)), `${anim}: wing outside its bounds`);
      }
    });
  }
  // Popping open overshoots a little: still inside.
  const model = run(new PlayerModel(), base({ anim: 'fly', pitch: -0.9 }), 5);
  run(model, base({ wingHat: true, anim: 'fly', pitch: -0.9 }), 30, (m) => {
    const a = wingPos(m);
    for (let k = 0; k < a.length; k += 3) assert.ok(sphere.containsPoint(new THREE.Vector3().fromArray(a, k)));
  });
});

test('both wings are mirror images, facing out of the same sides', () => {
  const model = run(new PlayerModel(), base({ wingHat: true, anim: 'fly', pitch: -0.3 }), 45);
  const a = wingPos(model);
  const n = model.wings.mesh.geometry.attributes.normal.array;
  const half = a.length / 2;
  // Triangle t of the left wing is triangle t of the right wing with its 2nd and 3rd
  // vertices swapped (winding kept front-facing).
  for (let t = 0; t < half / 9; t++) {
    for (const [l, r] of [[0, 0], [1, 2], [2, 1]]) {
      const i = t * 9 + l * 3;
      const j = half + t * 9 + r * 3;
      assert.ok(Math.abs(a[i] + a[j]) < 1e-3 && Math.abs(a[i + 1] - a[j + 1]) < 1e-3 && Math.abs(a[i + 2] - a[j + 2]) < 1e-3);
      assert.ok(Math.abs(n[i] + n[j]) < 1e-3 && Math.abs(n[i + 1] - n[j + 1]) < 1e-3);
    }
  }
  // Front faces agree with their normals.
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let agree = 0;
  for (let i = 0; i < a.length; i += 9) {
    e1.set(a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2]);
    e2.set(a[i + 6] - a[i], a[i + 7] - a[i + 1], a[i + 8] - a[i + 2]);
    const c = e1.cross(e2);
    if (c.x * n[i] + c.y * n[i + 1] + c.z * n[i + 2] > 0 || c.y * (n[i + 1] - 0.5) > 0) agree++;
  }
  assert.ok(agree / (a.length / 9) > 0.8, 'winding matches the normals');
});

test('wing colours: soft white tops, cool grey undersides, a hint of teal at the root', () => {
  const model = new PlayerModel();
  const col = model.wings.mesh.geometry.attributes.color.array;
  const c = new THREE.Color();
  const lum = [];
  let teal = 0;
  for (let i = 0; i < col.length; i += 3) {
    c.setRGB(col[i], col[i + 1], col[i + 2]);
    lum.push(c.r + c.g + c.b);
    if (c.g > c.r + 0.1) teal++;
  }
  assert.ok(Math.max(...lum) > 2.6, 'white');
  assert.ok(Math.min(...lum) < 2.2, 'grey undersides');
  assert.ok(teal > 0 && teal < col.length / 3 / 5, 'teal only at the roots');
  for (const k of ['wing', 'wingTip', 'wingUnder', 'wingUnderTip', 'wingRoot']) assert.ok(k in COLORS);
});

// Bytes allocated per call of fn once it is warm (V8 heap sampling).
async function bytesPerCall(fn, n = 4000) {
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

test('flapping allocates nothing per frame', async () => {
  const model = run(new PlayerModel(), base({ wingHat: true, anim: 'fly' }), 30);
  const rs = model.rs;
  rs.wingHat = true;
  rs.anim = 'fly';
  const bytes = await bytesPerCall((i) => {
    rs.pitch = Math.sin(i * 0.01);
    rs.wingHatEnding = i % 200 > 150;
    model.wings.update(rs, 1 / 60, i / 60);
  });
  // At most a boxed number argument or two (anything per vertex would be kilobytes).
  assert.ok(bytes < 64, `${bytes.toFixed(1)} bytes per wings update`);
});

test('fly: registered, lies flat along the flight path with the lead fist ahead', () => {
  assert.ok(ANIMS.fly, 'fly anim');
  assert.equal(ANIMS.fly.flipIn, 1);
  const model = run(new PlayerModel(), base({ anim: 'fly', animTime: 0, forwardVel: 40, pitch: 0, wingHat: true }), 90);
  model.object3D.updateMatrixWorld(true);
  const w = (o) => o.getWorldPosition(new THREE.Vector3());
  const head = w(model.rig.head.children.find((c) => c.isGroup));
  const hips = w(model.rig.hips);
  const boots = [w(model.rig.legL.boot), w(model.rig.legR.boot)];
  assert.ok(head.z - hips.z > 45, `head ${(head.z - hips.z).toFixed(1)} ahead of the hips`);
  assert.ok(Math.abs(head.y - hips.y) < 45, `head ${(head.y - hips.y).toFixed(1)} above the hips`);
  for (const b of boots) assert.ok(b.z < hips.z - 20, 'legs trail behind');
  assert.ok(Math.abs(boots[0].x - boots[1].x) < 30, 'legs together');
  const fist = w(model.rig.armR.hand);
  assert.ok(fist.z > hips.z + 60, `lead fist ${(fist.z - hips.z).toFixed(1)} ahead`);
  // The Player's pitch tilts it: nose down lowers the head below the hips.
  const nose = run(new PlayerModel(), base({ anim: 'fly', animTime: 1, pitch: 0.8 }), 60);
  nose.object3D.updateMatrixWorld(true);
  assert.ok(w(nose.rig.head).y < w(nose.rig.hips).y - 20);
});

test('fly take-off: the triple jump somersault rolls on forward into the flight pose', () => {
  // From a run (the Player turns the triple jump press straight into the flight).
  const model = run(new PlayerModel(), base({ anim: 'run', forwardVel: 30, cyclePhase: 0 }), 30);
  const rs = base({ anim: 'fly', animTime: 0, forwardVel: 40, pitch: -0.9, wingHat: true });
  let prev = model.animator.pose.flipPitch;
  let turned = 0;
  let maxStep = 0;
  run(model, rs, 60, (m) => {
    const d = wrapAngle(m.animator.pose.flipPitch - prev);
    prev = m.animator.pose.flipPitch;
    assert.ok(d > -0.05, `pitched back ${d.toFixed(2)}`);
    turned += d;
    maxStep = Math.max(maxStep, d);
  });
  assert.ok(Math.abs(turned - (2 * Math.PI + 1.38)) < 0.35, `turned ${turned.toFixed(2)} rad`);
  assert.ok(maxStep < 0.6, `largest step ${maxStep.toFixed(2)} rad per frame`);
  // Entered from a triple jump already half way round: it carries on forward.
  for (const t0 of [0.12, 0.2, 0.3, 0.45]) {
    const m = run(new PlayerModel(), base({ anim: 'triple_jump', animTime: 0 }), Math.round(t0 * 60));
    let last = m.animator.pose.flipPitch;
    run(m, base({ anim: 'fly', animTime: 0, pitch: -0.9, wingHat: true }), 40, (mm) => {
      const d = wrapAngle(mm.animator.pose.flipPitch - last);
      last = mm.animator.pose.flipPitch;
      assert.ok(d > -0.05, `from triple_jump at ${t0}: pitched back ${d.toFixed(2)}`);
    });
  }
});

test('the scarf streams back along him in flight', () => {
  const model = run(new PlayerModel(), base({ anim: 'fly', animTime: 1, forwardVel: 45, wingHat: true }), 120);
  model.object3D.updateMatrixWorld(true);
  for (const tail of model.scarf.tails) {
    const root = tail.joints[0].getWorldPosition(new THREE.Vector3());
    const end = tail.joints.at(-1).localToWorld(new THREE.Vector3(0, -8, 0));
    assert.ok(end.z < root.z - 12, `tail end ${(end.z - root.z).toFixed(1)} behind the knot`);
  }
});

// Sum over the pose channels of |a - b|.
function poseDistance(a, b) {
  let d = 0;
  for (const c of CHANNELS) d += Math.abs(a[c] - b[c]);
  return d;
}

test('stomp bounce: the jump anim restarts from a fall with a blend, not a snap', () => {
  const jump0 = run(new PlayerModel(), base({ anim: 'jump', animTime: 0, vy: 50 }), 1).animator.pose;
  for (const from of ['fall', 'jump', 'ground_pound_fall', 'dive']) {
    const model = run(new PlayerModel(), base({ anim: from, animTime: 0.2, vy: -30 }), 30);
    const before = copyPose(createPose(), model.animator.pose);
    model.update(base({ anim: 'jump', animTime: 0, vy: 50 }), 1 / 60);
    const first = model.animator.pose;
    const jump = poseDistance(before, jump0);
    if (from !== 'jump') assert.ok(jump > 1, `${from} differs from the jump pose`);
    assert.ok(poseDistance(before, first) < 0.5 * jump + 1e-9, `${from}: the first frame snapped to the jump`);
    assert.equal(model.animator.anim, 'jump');
    run(model, base({ anim: 'jump', animTime: 1 / 60, vy: 48 }), 20);
    model.object3D.updateMatrixWorld(true);
    model.object3D.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
  }
});

test('buildWingedHat: the teal explorer hat with the same wings, flapping on request', () => {
  const hat = buildWingedHat();
  assert.ok(hat.isGroup);
  const meshes = hat.children.filter((o) => o.isMesh);
  assert.equal(meshes.length, 2, 'hat + wings');
  assert.equal(meshes[0].material, meshes[1].material);
  assert.ok(meshes[0].material.vertexColors);
  const box = new THREE.Box3().setFromObject(meshes[0]);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 90 && size.x < 110, `hat ${size.x.toFixed(1)} across`);
  assert.ok(box.min.y > -5 && box.max.y < 35, 'origin at the brim');
  // Teal: the hat's own colour is on it.
  const teal = new THREE.Color(COLORS.hat);
  const col = meshes[0].geometry.attributes.color.array;
  let found = false;
  for (let i = 0; i < col.length && !found; i += 3) {
    found = Math.abs(col[i] - teal.r) < 1e-6 && Math.abs(col[i + 1] - teal.g) < 1e-6;
  }
  assert.ok(found, 'teal hat');
  const wings = meshes[1];
  const a0 = wings.geometry.attributes.position.array.slice();
  hat.userData.flap(0.1);
  const a1 = wings.geometry.attributes.position.array.slice();
  hat.userData.flap(0.3, 1);
  const a2 = wings.geometry.attributes.position.array;
  let moved = 0;
  for (let i = 0; i < a1.length; i++) moved = Math.max(moved, Math.abs(a2[i] - a1[i]));
  assert.ok(moved > 5, 'the wings beat');
  assert.ok(a2.every(Number.isFinite) && a0.length === a2.length);
  hat.userData.flap(NaN, NaN);
  assert.ok(wings.geometry.attributes.position.array.every(Number.isFinite));
  hat.userData.flap(0);
  const wingBox = new THREE.Box3().setFromObject(wings, true);
  assert.ok(wingBox.max.x > 50 && wingBox.min.x < -50, 'spread out past the brim either side');
  assert.ok(wingBox.max.y > 45, 'rising above the crown');
  // The fixed culling bounds hold them.
  assert.ok(wings.geometry.boundingBox.containsBox(wingBox));
});

test('a slightly rounder Pip: the belly swells the tunic, colours and kit unchanged', () => {
  const model = run(new PlayerModel(), base({ pos: { x: 0, y: 0, z: 0 } }), 5);
  model.object3D.updateMatrixWorld(true);
  const torsoMesh = model.rig.torso.children.find((o) => o.isMesh);
  const box = new THREE.Box3().setFromObject(torsoMesh);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 44 && size.x < 52, `tunic ${size.x.toFixed(1)} wide`);
  // The belly: the front of the tunic sticks out past its back.
  const hips = model.rig.torso.getWorldPosition(new THREE.Vector3());
  assert.ok(box.max.z - hips.z > -(box.min.z - hips.z) + 2, 'belly in front');
  // Palette untouched (the design colours).
  assert.equal(COLORS.hat, 0x1d948c);
  assert.equal(COLORS.tunic, 0xd4631f);
  assert.equal(COLORS.scarf, 0xeeb52f);
});
