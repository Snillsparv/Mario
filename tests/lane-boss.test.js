// STOMPWATT, Sparrow Lane's boss (objects/laneBoss/LaneBoss.js, the lane's lazy chunk attached by
// hand: om.attachLane(chunk, area)), B2: the dad's car parts into the robot's pieces in both
// looks (every triangle on one piece, each where it belongs), its car form is exactly the parked
// car (classic and the realistic tiers), the rig (rigid skinning, proper turns, standing 650 ..
// 750 tall and at most 480 wide on its feet, the morph's ends, the pieces' order), the wake (its
// dwell, touching it, its notice blinks; never on the bins, the carport, a roof or the car, away,
// blinking or in a dialog; not again until he has gone and come back), the first wake's intro
// (Jonas held 150 ticks, the camera's own, its name card once; later wakes quick, nobody held),
// folding back and parking (him away 10 s, a lost life; at once on an arrival and a new game;
// shooing him off its spot, lifting him onto it in the end), the car's collider parked while it
// is up and back exactly, he cannot walk through it, its sounds, the camera overlay, both looks'
// models (G mid-morph), determinism (never 'bossDefeated'), and the hot paths' guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { PLAYER_RADIUS } from '../src/core/constants.js';
import { SFX, SFX_INFO } from '../src/audio/sfx.js';
import * as chunk from '../src/objects/laneBoss/index.js';
import { LaneBoss, BOSS } from '../src/objects/laneBoss/index.js';
import { RobotModel, Rig, classicCar } from '../src/objects/laneBoss/model.js';
import { ATTACH, BONE, BONES, STAGGER, SPAN, arrive } from '../src/objects/laneBoss/rig.js';
import { ROBOT_SFX, ROBOT_SFX_INFO } from '../src/objects/laneBoss/audio.js';
import { LaneBossCam, INTRO_CAM } from '../src/objects/laneBoss/camera.js';
import { PIECES, PIECE } from '../src/world/lane/real/pieces.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { GROUND, LANE_BOSS } = lane;
const CAR = lane.CARS.find((c) => c.id === LANE_BOSS.car);
const K = lane.CAR_KINDS[CAR.kind];
const [HW, HL] = [K.w / 2, K.l / 2];
const N = Math.PI;
const S = 0;
const DETAIL = { high: buildLaneDetail(lane, 'high'), mid: buildLaneDetail(lane, 'mid'), low: buildLaneDetail(lane, 'low') };

// Jonas at a local point with the course's objects and the chunk attached.
function hero(x, z, yaw, { y = GROUND } = {}) {
  const events = new Events();
  const log = [];
  for (const name of ['laneBoss', 'bossCard', 'bossDefeated', 'bossImpact']) events.on(name, (e) => log.push({ name, ...e }));
  const sounds = [];
  events.on('sfx', (e) => sounds.push(e.name));
  const p = new Player({ collision: area.collision, events, spawn: area.respawn, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events, layout: area.objectsLayout, player: p, area: 'lane' });
  om.attachLane(chunk, area);
  const ctl = new ScriptedController();
  let frame = 0;
  const tick = (input = {}) => {
    p.update(ctl.next(input), 0);
    om.update({ player: p });
    om.animate(++frame / 30, 1, null);
  };
  const run = (n, input = {}, each = null) => {
    for (let i = 0; i < n; i++) {
      tick(typeof input === 'function' ? input(i) : input);
      if (each?.(i) === false) return i + 1;
    }
    return n;
  };
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const put = (px, pz, py = GROUND, pyaw = 0) => {
    p.teleport(px + O.x, py + O.y, pz + O.z, pyaw);
    p.setAction('idle');
  };
  return { p, om, boss: om.laneBoss, log, sounds, tick, run, at, put, events };
}
// The stick toward a world yaw (camera yaw 0).
const toward = (yaw) => ({ stickX: -Math.sin(yaw), stickY: Math.cos(yaw) });
// Ticks until the boss is in `state` (at most n); -1 if never.
function until(h, state, n = 600, input = {}) {
  for (let i = 0; i < n; i++) {
    if (h.boss.state === state) return i;
    h.tick(input);
  }
  return h.boss.state === state ? n : -1;
}
// The car's collider as it stands (every surface's numbers).
const colliderNow = () => JSON.stringify(area.named.dad_ev.surfaces.map((s) => [s.a, s.b, s.c, s.d, s.minY, s.maxY, s.ys, s.pu]));
const COLLIDER = colliderNow();
const roofAt = () => area.collision.findFloor(CAR.x + O.x, 1000 + O.y, CAR.z + O.z).y - O.y;

// A model's vertices where its skeleton puts them (world), per mesh.
function skinned(model) {
  model.group.updateMatrixWorld(true);
  const out = [];
  const v = new THREE.Vector3();
  for (const mesh of model.meshes) {
    const pos = mesh.geometry.attributes.position;
    const list = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      list.set([v.x, v.y, v.z], i * 3);
    }
    out.push(list);
  }
  return out;
}
// The triangles of `arrays` (flat corner lists) not found in `others` (each corner within `tol`,
// in any order): a spatial hash of the others' middles.
function missing(arrays, others, tol = 0.02) {
  const cell = 2;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const mid = (a, t) => [0, 1, 2].map((k) => (a[t + k] + a[t + 3 + k] + a[t + 6 + k]) / 3);
  for (const a of others) {
    for (let t = 0; t < a.length; t += 9) {
      const m = mid(a, t);
      const k = key(...m);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([a, t]);
    }
  }
  const same = (a, t, b, u) => [0, 1, 2].every((i) => [0, 1, 2].some((j) => Math.abs(a[t + i * 3] - b[u + j * 3]) < tol && Math.abs(a[t + i * 3 + 1] - b[u + j * 3 + 1]) < tol && Math.abs(a[t + i * 3 + 2] - b[u + j * 3 + 2]) < tol));
  let n = 0;
  for (const a of arrays) {
    for (let t = 0; t < a.length; t += 9) {
      const m = mid(a, t);
      let found = false;
      for (let dx = -1; dx <= 1 && !found; dx++) {
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dz = -1; dz <= 1 && !found; dz++) {
            for (const [b, u] of grid.get(key(m[0] + dx * cell, m[1] + dy * cell, m[2] + dz * cell)) ?? []) if (same(a, t, b, u)) found = true;
          }
        }
      }
      if (!found) n++;
    }
  }
  return n;
}
const count = (arrays) => arrays.reduce((n, a) => n + a.length / 9, 0);
const stateOf = (st) => ({ x: st.x, y: st.y, z: st.z, yaw: st.yaw, m: st.m, lift: st.lift, bob: st.bob, turns: Array.from(st.turns), blinkL: st.blinkL, blinkR: st.blinkR });
const carPose = (x, y, z) => ({ ...stateOf({ x, y, z, yaw: CAR.yaw, m: 0, lift: 0, bob: 0, turns: new Float32Array(BONES.length * 3), blinkL: 0, blinkR: 0 }), turns: new Float32Array(BONES.length * 3), hatch: 0 });
const realPieces = (tier) => ({ ...DETAIL[tier].robot, tier, meshes: DETAIL[tier].robot.meshes.map((m) => ({ name: m.material, material: new THREE.MeshStandardMaterial(), buffers: m.buffers })) });

test('the dad\'s car parts into STOMPWATT\'s pieces in both looks: every triangle (but the realistic contact shadow) on one piece, each where it belongs on the car', () => {
  const looks = { classic: classicCar(lane, area.parts[0]), ...Object.fromEntries(['high', 'mid', 'low'].map((t) => [t, DETAIL[t].robot])) };
  for (const [look, pieces] of Object.entries(looks)) {
    const K2 = pieces.cuts;
    const box = {};
    for (const m of pieces.meshes) {
      const { position, part } = m.buffers;
      assert.equal(position.length, part.length * 3, `${look}: a piece for every vertex`);
      for (let v = 0; v < part.length; v += 3) {
        assert.ok(part[v] === part[v + 1] && part[v] === part[v + 2], `${look}: a triangle on one piece`);
        const b = (box[PIECES[part[v]]] ??= { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], n: 0 });
        b.n++;
        for (let k = 0; k < 9; k++) {
          b.lo[k % 3] = Math.min(b.lo[k % 3], position[v * 3 + k]);
          b.hi[k % 3] = Math.max(b.hi[k % 3], position[v * 3 + k]);
        }
      }
    }
    for (const name of PIECES) assert.equal(box[name]?.n > 0, name !== 'shadow' || look === 'classic', `${look}: ${name} has triangles (the soft shadow only in the classic look)`);
    const mid = (n, k) => (box[n].lo[k] + box[n].hi[k]) / 2;
    assert.ok(box.head.lo[2] > K2.head - 25 && box.head.hi[2] > HL - 2, `${look}: the head is the front clip`);
    assert.ok(box.tail.hi[2] < K2.tail + 15 && box.tail.lo[2] < -HL + 2, `${look}: the backpack is the rear clip`);
    assert.ok(box.canopy.lo[1] > K2.belt - 4, `${look}: the chest is the greenhouse`);
    for (const s of ['L', 'R']) {
      const sign = s === 'L' ? 1 : -1;
      for (const d of ['F', 'R']) assert.ok(sign * mid(`door${d}${s}`, 0) > HW - 40, `${look}: door${d}${s} on its side`);
      assert.ok(mid(`doorF${s}`, 2) > mid(`doorR${s}`, 2), `${look}: the front door ahead of the rear one`);
      assert.ok(Math.abs(mid(`wheelF${s}`, 2) - K2.axles[0]) < 3 && Math.abs(mid(`wheelR${s}`, 2) - K2.axles[1]) < 3, `${look}: the wheels on their axles`);
      assert.ok(sign * mid(`eye${s}`, 0) > 30 && box[`eye${s}`].lo[2] > HL - 50, `${look}: eye${s} on the nose`);
    }
    assert.ok(box.hatch.lo[2] < -HL + 5 && box.hatch.hi[1] > K2.hatch + 30, `${look}: the hatch over the bumper at the back`);
  }
});

test('car form is exactly the parked car: the classic look\'s pieces are lane-render\'s tail range, the realistic tiers\' the detail meshes\' tail ranges (but the contact shadow, left drawn until the car parts)', () => {
  // Classic: the robot's car form where the car stands, against the static mesh's range.
  const classic = new RobotModel('classic', classicCar(lane, area.parts[0]), { tint: CAR.classicTint, light: area.parts[0].light });
  const y0 = lane.groundHeight(CAR.x, CAR.z);
  classic.pose(carPose(CAR.x + O.x, y0 + O.y, CAR.z + O.z));
  const robot = skinned(classic);
  // (The frame's parts are scaled to nothing in car form: only the car's are compared.)
  const carOnly = (model, arrays) => arrays.map((a, i) => {
    const part = model.meshes[i].geometry.attributes.part.array;
    const keep = [];
    for (let v = 0; v < part.length; v++) if (part[v] < PIECES.length) keep.push(a[v * 3], a[v * 3 + 1], a[v * 3 + 2]);
    return Float32Array.from(keep);
  });
  const render = area.parts[0].object3D.getObjectByName('lane-render');
  const first = area.parts[0].hide.dad_ev['lane-render'];
  const pos = render.geometry.attributes.position.array;
  const parked = Float32Array.from(pos.subarray(first * 3)).map((v, i) => v + [O.x, O.y, O.z][i % 3]);
  const ours = carOnly(classic, robot);
  // (The doors' own windows are the robot's, hidden inside the cabin in car form.)
  assert.equal(count([parked]), count(ours) - 8, 'the classic car (its soft shadow too: the shadow piece)');
  assert.equal(missing(ours, [parked]), 8, 'every robot triangle is a parked car\'s but the doors\' windows');
  // Realistic: each tier's detail meshes' ranges.
  for (const tier of ['high', 'mid', 'low']) {
    const d = DETAIL[tier];
    const model = new RobotModel(tier, realPieces(tier), { tint: CAR.tint });
    model.pose(carPose(CAR.x, y0, CAR.z));
    const ours = carOnly(model, skinned(model));
    const ranges = [];
    for (const m of d.meshes) {
      const at = d.hide.dad_ev[m.name];
      if (at === undefined || m.material === 'contact') continue;
      ranges.push(m.buffers.position.subarray(at * 3));
    }
    assert.equal(count(ours), count(ranges), `${tier}: as many triangles as the parked car`);
    assert.equal(missing(ours, ranges), 0, `${tier}: the same triangles`);
  }
});

test('the rig: rigid skinning (each vertex on one bone, weight 1), its turns proper rotations, the pieces\' order; standing it is 650 .. 750 tall, at most 480 wide, its feet on the ground; the morph\'s ends exact', () => {
  for (const [p, [bone, , axes]] of Object.entries(ATTACH)) {
    assert.ok(BONE[bone] >= PIECES.length, `${p} rides on a frame bone`);
    const m = new THREE.Matrix4().makeBasis(...axes.map((a) => new THREE.Vector3(...a)));
    assert.ok(Math.abs(m.determinant() - 1) < 1e-9, `${p}: a proper rotation`);
    for (const a of axes) assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9, `${p}: unit axes`);
  }
  // The pieces leave the car in order (the core first, the head last), each arriving within the morph.
  const order = Object.entries(STAGGER).sort((a, b) => a[1] - b[1]).map(([p]) => p);
  assert.equal(order[0], 'core');
  assert.equal(order.at(-1), 'head');
  for (const p of order) {
    assert.equal(arrive(p, 0), 0, `${p} in the car at 0`);
    assert.equal(arrive(p, 1), 1, `${p} in place at 1`);
    assert.ok(STAGGER[p] + SPAN <= 1, `${p} arrives by the end`);
  }
  const models = [new RobotModel('classic', classicCar(lane, area.parts[0]), { tint: CAR.classicTint, light: area.parts[0].light }), ...['high', 'low'].map((t) => new RobotModel(t, realPieces(t), { tint: CAR.tint }))];
  for (const model of models) {
    for (const mesh of model.meshes) {
      const w = mesh.geometry.attributes.skinWeight.array;
      const idx = mesh.geometry.attributes.skinIndex.array;
      for (let i = 0; i < w.length; i += 4) {
        assert.ok(w[i] === 1 && w[i + 1] === 0 && w[i + 2] === 0 && w[i + 3] === 0, `${mesh.name}: weight 1 on one bone`);
        assert.ok(idx[i] < model.rig.bones.length, `${mesh.name}: a real bone`);
      }
      assert.equal(mesh.skeleton, model.rig.skeleton);
      assert.equal(mesh.frustumCulled, false);
    }
    // Standing (m 1) at the origin facing +z.
    const st = carPose(0, 0, 0);
    st.yaw = 0;
    st.m = 1;
    model.pose(st);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const a of skinned(model)) {
      for (let i = 0; i < a.length; i++) {
        assert.ok(Number.isFinite(a[i]), `${model.look}: finite`);
        lo[i % 3] = Math.min(lo[i % 3], a[i]);
        hi[i % 3] = Math.max(hi[i % 3], a[i]);
      }
    }
    assert.ok(hi[1] >= 650 && hi[1] <= 750, `${model.look}: ${hi[1].toFixed(0)} tall`);
    assert.ok(hi[0] - lo[0] <= 480, `${model.look}: ${(hi[0] - lo[0]).toFixed(0)} wide`);
    assert.ok(lo[1] > -2 && lo[1] < 6, `${model.look}: its feet on the ground (${lo[1].toFixed(1)})`);
  }
});

test('it wakes when he stays near it on the drive (the dwell) and blinks at him from further off; its first wake is the intro: Jonas held 150 ticks, the camera its own, the name card once; the car\'s collider parked while it is up', () => {
  const h = hero(CAR.x, CAR.z - HL - 150, N);
  const { boss } = h;
  assert.equal(boss.state, 'parked');
  // The notice: a blink and a soft chirp (the car form shown for it).
  h.tick();
  assert.equal(boss.state, 'notice');
  assert.ok(h.sounds.includes('ev_chirp'));
  // The dwell: it wakes on the 20th tick near it.
  let woke = -1;
  h.run(40, {}, (i) => {
    if (boss.state === 'wake') {
      woke = i;
      return false;
    }
    return true;
  });
  assert.ok(woke >= LANE_BOSS.wake.dwell - 3 && woke <= LANE_BOSS.wake.dwell + 1, `woke after ${woke} ticks`);
  assert.equal(boss.cinematic, true, 'the intro holds him');
  assert.equal(h.om.cinematic, true);
  assert.equal(h.om.cameraOverlay, boss.camera);
  assert.notEqual(colliderNow(), COLLIDER, 'the car\'s collider parked');
  assert.ok(roofAt() < 30, 'no car to stand on');
  let held = 0;
  h.run(200, {}, () => {
    if (boss.cinematic) held++;
    return boss.state === 'wake';
  });
  assert.ok(held >= 148 && held <= 150, `the intro: 150 ticks (${held})`);
  assert.equal(boss.state, 'show');
  assert.deepEqual(h.log.filter((e) => e.name === 'bossCard').map((e) => e.lines[0][0]), ['STOMPWATT'], 'its name card once');
  assert.deepEqual(h.log.filter((e) => e.name === 'laneBoss').map((e) => e.phase), ['wake', 'show']);
  for (const s of ['robot_power_up', 'robot_clunk', 'robot_horn']) assert.ok(h.sounds.includes(s), s);
  assert.equal(h.sounds.filter((s) => s === 'robot_clunk').length, 12, 'a clunk as each piece locks in');
  assert.equal(boss.cur.m, 1);
  assert.equal(h.log.some((e) => e.name === 'bossDefeated'), false);
  boss.enter();
  assert.equal(colliderNow(), COLLIDER, 'back exactly');
});

test('touching the car wakes it at once (his feet against its side, his punch); never while he is on the bins, the carport, a roof or the car, reading, blinking or in a dialog', () => {
  // Pushed against its left side.
  let h = hero(CAR.x + HW + PLAYER_RADIUS + 3, CAR.z, -Math.PI / 2);
  h.tick();
  assert.equal(h.boss.state, 'wake', 'against its side');
  // A punch at its nose from in front.
  h = hero(CAR.x, CAR.z - HL - PLAYER_RADIUS - 30, S);
  h.run(2);
  assert.equal(h.boss.state === 'wake', false, 'not yet (no dwell)');
  h.tick({ B: true });
  h.run(4);
  assert.equal(h.boss.state, 'wake', 'punched');
  // Never: on a bin, the carport, the dad's roof, the car's roof; reading; blinking; a dialog.
  const never = [
    ['on a bin', () => hero(lane.BINS[0].x, lane.BINS[0].z, N, { y: lane.BIN.top })],
    ['on the carport', () => hero(1900, 2000, N, { y: lane.CARPORT.top })],
    ['on the car', () => hero(CAR.x, CAR.z, N, { y: GROUND + K.roof })],
    ['on its bonnet', () => hero(CAR.x, CAR.z - 200, N, { y: GROUND + K.belt })],
  ];
  for (const [label, make] of never) {
    h = make();
    h.run(60);
    assert.notEqual(h.boss.state, 'wake', label);
    assert.equal(colliderNow(), COLLIDER, `${label}: its collider in place`);
  }
  h = hero(CAR.x, CAR.z - HL - 200, N);
  h.p.invincibleUntil = h.p.tick + 1000;
  h.run(60);
  assert.notEqual(h.boss.state, 'wake', 'blinking after a hit');
  h = hero(CAR.x, CAR.z - HL - 200, N);
  h.om.dialogOpen = true;
  h.run(60);
  assert.notEqual(h.boss.state, 'wake', 'in a dialog');
  h = hero(CAR.x, CAR.z - HL - 200, N);
  h.p.action = 'reading'; // (reading a sign: he stays put)
  for (let i = 0; i < 60; i++) h.om.update({ player: h.p });
  assert.notEqual(h.boss.state, 'wake', 'reading');
});

test('it stands and watches him (turning on the spot to face him, stepping), then folds back and parks when he has been away 10 s; once parked it wakes no more until he has gone and come back, then quickly (60 ticks, nobody held)', () => {
  const h = hero(CAR.x, CAR.z - HL - 150, N);
  const { boss } = h;
  until(h, 'show', 300);
  // He walks round to its left: it turns to face him, stepping.
  h.put(CAR.x - 260, CAR.z - 250, -Math.PI / 2);
  h.run(80);
  const face = Math.atan2(h.p.pos.x - boss.cur.x, h.p.pos.z - boss.cur.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(face - boss.cur.yaw), Math.cos(face - boss.cur.yaw))) < 0.6, 'facing him');
  assert.ok(h.sounds.includes('robot_step'), 'stepping round');
  // Away (beyond its reach) for 10 s: home.
  h.put(CAR.x, CAR.z - 2600, N);
  const n = until(h, 'home', 400);
  assert.ok(n >= BOSS.AWAY - 2 && n <= BOSS.AWAY + 2, `home after ${n} ticks away`);
  until(h, 'parked', 400);
  assert.equal(colliderNow(), COLLIDER, 'its collider back exactly');
  assert.equal(roofAt(), GROUND + K.roof, 'the car to stand on again');
  assert.deepEqual(h.log.filter((e) => e.name === 'laneBoss').map((e) => e.phase), ['wake', 'show', 'home', 'parked']);
  // Next to it again at once: it stays parked (he may climb it) ...
  h.put(CAR.x, CAR.z - HL - 200, N);
  h.run(80);
  assert.equal(boss.state === 'wake', false, 'not re-armed');
  // ... until he has been away and comes back: a quick wake, nobody held.
  h.put(CAR.x, CAR.z - 2600, N);
  h.run(2);
  h.put(CAR.x, CAR.z - HL - 200, N);
  until(h, 'wake', 60);
  let len = 0;
  let held = 0;
  h.run(200, {}, () => {
    len++;
    if (boss.cinematic) held++;
    return boss.state === 'wake';
  });
  assert.ok(len >= 59 && len <= 61, `a quick wake (${len})`);
  assert.equal(held, 0, 'nobody held');
  assert.equal(h.log.filter((e) => e.name === 'bossCard').length, 1, 'no card again');
});

test('a lost life sends it home; an arrival parks it at once; a new game parks it and brings its intro back', () => {
  const h = hero(CAR.x, CAR.z - HL - 150, N);
  const { boss } = h;
  until(h, 'show', 300);
  h.p.loseLife();
  until(h, 'home', 120);
  until(h, 'parked', 300);
  assert.equal(colliderNow(), COLLIDER);
  // An arrival mid-show: parked at once.
  h.put(CAR.x, CAR.z - 2600, N);
  h.run(2);
  h.put(CAR.x, CAR.z - HL - 150, N);
  until(h, 'show', 300);
  h.om.enter(h.p);
  assert.equal(boss.state, 'parked');
  assert.equal(boss.shown, false);
  assert.equal(colliderNow(), COLLIDER);
  // A new game mid-intro.
  h.put(CAR.x, CAR.z - HL - 150, N);
  until(h, 'show', 300);
  h.om.reset();
  assert.equal(boss.state, 'parked');
  assert.equal(boss.introDone, false);
  assert.equal(colliderNow(), COLLIDER);
  h.run(30);
  assert.equal(boss.cinematic, true, 'the intro again');
  boss.enter();
});

test('folding back with him on its parking spot it shoos him off with its horn and waits; stepping off lets it park; staying, it parks anyway and lifts him onto its roof', () => {
  let h = hero(CAR.x, CAR.z - HL - 150, N);
  until(h, 'show', 300);
  // He stands where the car will be: it goes home (lost life cannot be used: walk away and come back
  // onto the spot).
  h.boss.leave = true;
  h.put(CAR.x + 120, CAR.z + 200, N);
  until(h, 'shoo', 200);
  h.run(BOSS.SHOO_EVERY * 2);
  assert.ok(h.sounds.filter((s) => s === 'robot_horn').length >= 2, 'it honks');
  assert.equal(h.boss.state, 'shoo', 'and waits');
  h.put(CAR.x + 700, CAR.z, N);
  h.run(2);
  assert.equal(h.boss.state, 'unmorph', 'he stepped off: it folds');
  until(h, 'parked', 200);
  h.boss.enter();
  // Staying put: after SHOO_MAX it parks anyway, lifting him onto the car.
  h = hero(CAR.x, CAR.z - HL - 150, N);
  until(h, 'show', 300);
  h.boss.leave = true;
  const spot = [CAR.x + 60, CAR.z + 150];
  h.put(...spot, GROUND, N);
  until(h, 'shoo', 200);
  until(h, 'parked', BOSS.SHOO_MAX + 200);
  assert.equal(colliderNow(), COLLIDER);
  h.run(3);
  assert.ok(h.at().y > GROUND + K.belt - 5, `lifted onto the car (${h.at().y.toFixed(0)})`);
});

test('he cannot walk through it: walking into it from in front he stops at its feet; the car rising, its footprint', () => {
  const h = hero(CAR.x, CAR.z - HL - 150, N);
  const { boss } = h;
  until(h, 'show', 300);
  let closest = Infinity;
  h.run(120, toward(0), () => {
    closest = Math.min(closest, Math.hypot(h.p.pos.x - boss.cur.x, h.p.pos.z - boss.cur.z));
  });
  assert.ok(closest > BOSS.BUMP.body + PLAYER_RADIUS - 30, `kept out of its body (${closest.toFixed(0)})`);
  boss.enter();
});

test('both looks\' models: the realistic one built with its part (mid-morph G swaps which draws, the parked car hidden in both looks\' meshes alike); the classic one always', () => {
  const h = hero(CAR.x, CAR.z - HL - 150, N);
  const { boss } = h;
  // A realistic part: its robot pieces and a mesh holding the dad's car's range.
  const object3D = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = 'lane-detail-carPaint@0';
  object3D.add(mesh);
  const part = { object3D, hide: { dad_ev: { 'lane-detail-carPaint@0': 1234 } }, robot: realPieces('high') };
  until(h, 'wake', 60);
  h.run(60);
  assert.ok(boss.cur.m > 0 && boss.cur.m < 1, 'mid-morph');
  h.om.setLook(part);
  assert.ok(boss.realModel, 'built with the part');
  assert.equal(boss.realModel.group.visible, true);
  assert.equal(boss.classic.group.visible, false);
  assert.equal(mesh.geometry.drawRange.count, 1234, 'the parked car hidden in the realistic mesh');
  const render = area.parts[0].object3D.getObjectByName('lane-render');
  assert.equal(render.geometry.drawRange.count, area.parts[0].hide.dad_ev['lane-render'], 'and in the classic one');
  h.run(5);
  h.om.setLook(null);
  assert.equal(boss.realModel.group.visible, false);
  assert.equal(boss.classic.group.visible, true);
  assert.equal(boss.realModel.meshes.length, 6, 'high: paint, glass, black, lamp, metal, glow');
  until(h, 'show', 200);
  boss.enter();
  assert.equal(render.geometry.drawRange.count, Infinity);
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  // Slots per tier.
  assert.equal(new RobotModel('mid', realPieces('mid'), { tint: CAR.tint }).meshes.length, 3);
  assert.equal(new RobotModel('low', realPieces('low'), { tint: CAR.tint }).meshes.length, 2);
  assert.equal(boss.classic.meshes.length, 2);
});

test('deterministic: two lanes fed the same ticks wake, stand, turn and fold alike; never \'bossDefeated\'', () => {
  const runOne = () => {
    const h = hero(CAR.x, CAR.z - HL - 150, N);
    const trace = [];
    for (let i = 0; i < 900; i++) {
      const input = i < 300 ? {} : i < 360 ? toward(Math.PI / 2) : {};
      if (i === 520) h.put(CAR.x, CAR.z - 2600, N);
      h.tick(input);
      trace.push([h.boss.state, stateOf(h.boss.cur)]);
    }
    h.boss.enter();
    return { trace, log: h.log };
  };
  const a = runOne();
  const b = runOne();
  assert.deepEqual(a.trace, b.trace);
  assert.equal(a.log.some((e) => e.name === 'bossDefeated'), false);
  assert.ok(a.trace.some(([s]) => s === 'parked') && a.trace.some(([s]) => s === 'show'));
});

test('its camera: the intro shot blends in from the drive\'s mouth, rises, hands back; a cut drops it', () => {
  const lc = new LaneBossCam();
  const spot = { x: CAR.x, y: GROUND, z: CAR.z };
  const cam = { pos: new THREE.Vector3(0, 100, 0), target: new THREE.Vector3(), fov: 55 };
  lc.update(cam);
  assert.equal(lc.w, 0);
  lc.intro(spot, CAR.yaw, 150);
  for (let i = 0; i < 20; i++) {
    lc.tick();
    cam.pos.set(0, 100, 0);
    cam.fov = 55;
    lc.update(cam);
  }
  assert.equal(lc.w, 1);
  const A = INTRO_CAM.A.at;
  // (The car's frame to the world: x along its right... its yaw.)
  const ax = spot.x + A[0] * Math.cos(CAR.yaw) + A[2] * Math.sin(CAR.yaw);
  const az = spot.z - A[0] * Math.sin(CAR.yaw) + A[2] * Math.cos(CAR.yaw);
  assert.ok(Math.hypot(cam.pos.x - ax, cam.pos.z - az) < 1 && Math.abs(cam.pos.y - spot.y - A[1]) < 1, 'at the drive\'s mouth');
  for (let i = 0; i < 110; i++) {
    lc.tick();
    lc.update(cam);
  }
  assert.ok(cam.pos.y > spot.y + INTRO_CAM.B.at[1] - 5, 'risen');
  assert.ok(Math.abs(cam.fov - 55 - INTRO_CAM.FOV) < 0.5, 'wider');
  for (let i = 0; i < 40; i++) {
    lc.tick();
    lc.update(cam);
  }
  assert.equal(lc.w, 0, 'handed back');
  lc.intro(spot, CAR.yaw, 150);
  lc.tick();
  lc.update(cam);
  lc.reset();
  assert.equal(lc.w, 0);
  assert.equal(lc.t, -1);
});

test('its sounds: registered into the game\'s table as the chunk attaches, each renders in a context and reports its length', () => {
  hero(-500, 900, S);
  for (const name of Object.keys(ROBOT_SFX)) {
    assert.equal(SFX[name], ROBOT_SFX[name], `${name} registered`);
    assert.ok(SFX_INFO[name], `${name}: its info`);
    const ctx = fakeContext();
    for (const opts of [{ p: 1 }, { p: 0.8, quiet: 1 }]) {
      const dur = SFX[name](ctx, ctx.createGain(), 1, opts);
      assert.ok(dur > 0.05 && dur < 3, `${name}: ${dur}`);
    }
  }
  assert.deepEqual(Object.keys(ROBOT_SFX_INFO).sort(), Object.keys(ROBOT_SFX).sort());
});

test('hot paths avoid allocating constructs; the parked car costs no query a tick but the notice\'s distance', () => {
  const hot = { LaneBoss: ['update', '_parked', '_read', '_touching', '_wake', '_showing', '_face', '_idle', '_home', '_unmorph', '_frame', '_bump', '_push', 'animate', '_copy'], Rig: ['pose'], RobotModel: ['pose'] };
  const classes = { LaneBoss, Rig, RobotModel };
  for (const [cls, names] of Object.entries(hot)) {
    for (const name of names) {
      const src = classes[cls].prototype[name].toString();
      assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, `${cls}.${name}`);
      assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, `${cls}.${name}`);
      assert.doesNotMatch(src, /new [A-Z]|\[\.\.\.|=>/, `${cls}.${name}: no allocation`);
    }
  }
  const h = hero(-500, 900, S);
  const col = area.collision;
  let n = 0;
  const wrap = ['findFloor', 'findWalls', 'findCeil', 'raycast'].map((k) => [k, col[k]]);
  for (const [k, f] of wrap) col[k] = (...a) => (n++, f.apply(col, a));
  try {
    for (let t = 0; t < 20; t++) h.boss.update(h.p, t, false);
  } finally {
    for (const [k] of wrap) delete col[k];
  }
  assert.equal(n, 0, `${n} queries`);
});

// A WebAudio context that records nothing but takes every call the recipes make.
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (...params) => {
    const n = { connect: (d) => d, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {} };
    for (const p of params) n[p] = param();
    return n;
  };
  return {
    sampleRate: 44100,
    currentTime: 0,
    createOscillator: () => node('frequency', 'detune'),
    createBiquadFilter: () => node('frequency', 'Q', 'gain'),
    createGain: () => node('gain'),
    createBufferSource: () => node('playbackRate'),
    createWaveShaper: () => node(),
    createBuffer: (ch, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    createPeriodicWave: () => ({}),
  };
}
void BONE;
void PIECE;
