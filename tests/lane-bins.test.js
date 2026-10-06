// Sparrow Lane's movable wheelie bins (objects/laneBoss/LaneBins.js, the lane's lazy chunk
// attached by hand: om.attachLane(chunk, area)) with the real Player on the real course: their
// colliders moved in place stay exact (every query as in a course built with the bin there),
// pushing (walking into one: 6 a tick along the pushed face's axis, his push anim; blocked by the
// other bin, the leash), the grab from each side (squared up to the face; never from the air,
// facing away or out of reach: a punch then), dragging (pulling and pushing along his facing at
// 6, the bin following at the grip distance, its collider parked while held and back after;
// blocked, he is held back), every way of letting go, home (at once on an arrival, a lost life
// and a new game; by itself left alone with him away, the stuck one put home unseen), both looks'
// instances written alike, the star climb from the movable bins (at home, and from one pushed
// under the carport's front edge), and the hot paths' guard.
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
import { BIN_HOLD, BIN_DRAG_SPEED, BIN_GRAB_SPEED, BIN_GRAB_HOLD } from '../src/player/physics/tuning.js';
import * as chunk from '../src/objects/laneBoss/index.js';
import { LaneBins, BINS_TUNING } from '../src/objects/laneBoss/index.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { GROUND, BIN, BINS } = lane;
const [HW, HD] = [BIN.x / 2, BIN.z / 2];
const E = Math.PI / 2;
const W = -Math.PI / 2;
const N = Math.PI;
const S = 0;

// Jonas at a local point with the course's objects and the chunk attached (the bins home first).
function hero(x, z, yaw, { y = GROUND } = {}) {
  const events = new Events();
  const log = [];
  events.on('coin', (e) => log.push(e));
  const p = new Player({ collision: area.collision, events, spawn: area.respawn, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events, layout: area.objectsLayout, player: p, area: 'lane' });
  om.attachLane(chunk, area);
  om.bins.sendHome();
  const ctl = new ScriptedController();
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const tick = (input = {}, camYaw = 0) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
  };
  const bin = (i) => ({ x: om.bins.list[i].x - O.x, z: om.bins.list[i].z - O.z });
  const put = (i, bx, bz) => om.bins._moveTo(om.bins.list[i], bx + O.x, bz + O.z);
  return { p, om, log, tick, at, bin, put, bins: om.bins };
}

// The top of what stands at (x, z) (local), probed from high up.
const topAt = (x, z) => area.collision.findFloor(x + O.x, 1000 + O.y, z + O.z).y - O.y;

test('the bins\' colliders are the static build\'s, named, and moved in place stay exact: every query round a moved bin as in a course built with the bin there', () => {
  assert.equal(area.named.bin_0.surfaces.length, 10, 'a box: its top and four walls');
  assert.equal(area.named.bin_1.surfaces.length, 10);
  assert.equal(area.named.dad_ev.surfaces.length, 20, 'the dad\'s car: its body and cabin');
  const h = hero(-500, 900, S);
  const b = h.bins.list[0];
  for (const [x, z] of [[1900, 860], [2300, 620], [1700, 1790], [1700, 1400], [BINS[0].x, BINS[0].z]]) {
    h.put(0, x, z);
    const fresh = buildArea(new THREE.Scene(), { ...AREA_DEFS.lane, layout: { ...lane, BINS: [{ x, z }, BINS[1]] } });
    const A = area.collision;
    const F = fresh.collision;
    for (let dx = -150; dx <= 150; dx += 25) {
      for (let dz = -130; dz <= 130; dz += 26) {
        const [px, pz] = [x + dx + O.x, z + dz + O.z];
        for (const y of [30, 120, 200, 400]) {
          const [fa, ff] = [A.findFloor(px, y, pz), F.findFloor(px, y, pz)];
          assert.equal(fa.y, ff.y, `floor at ${x + dx}, ${y}, ${z + dz}`);
          assert.equal(A.findCeil(px, y, pz).y, F.findCeil(px, y, pz).y, `ceiling at ${x + dx}, ${y}, ${z + dz}`);
        }
        for (const y of [GROUND + 40, GROUND + 140]) {
          const [wa, wf] = [A.findWalls(px, y, pz, 0, PLAYER_RADIUS), F.findWalls(px, y, pz, 0, PLAYER_RADIUS)];
          assert.ok(Math.abs(wa.x - wf.x) < 1e-6 && Math.abs(wa.z - wf.z) < 1e-6 && wa.walls.length === wf.walls.length, `walls at ${x + dx}, ${z + dz}`);
        }
      }
    }
    for (const [ox, oy, oz] of [[x - 400, 300, z - 300], [x + 350, 150, z], [x, 600, z + 5]]) {
      const o = { x: ox + O.x, y: oy + O.y, z: oz + O.z };
      const d = { x: x - ox, y: GROUND + 100 - oy, z: z - oz };
      const [ra, rf] = [A.raycast(o, d, 5000), F.raycast(o, d, 5000)];
      assert.ok(Math.abs((ra?.distance ?? -1) - (rf?.distance ?? -1)) < 1e-6, `a ray at the bin at ${x}, ${z}`);
    }
  }
  h.bins.sendHome();
  assert.equal(b.x - O.x, BINS[0].x);
  assert.equal(topAt(BINS[0].x, BINS[0].z), BIN.top, 'home again: its top at 182');
});

test('pushing: walking into a bin slides it 6 a tick along the pushed face\'s axis, away from him (his push anim), stopped by the leash and the other bin, and back along its slot', () => {
  // Out on the open drive, pushed east.
  const h = hero(1760, 860, E);
  h.put(0, 1900, 860);
  const xs = [];
  for (let t = 0; t < 60; t++) {
    h.tick({ stickY: 1 }, E);
    xs.push(h.bin(0).x);
  }
  const steps = xs.slice(20).map((x, i) => x - xs[19 + i]);
  assert.ok(steps.every((d) => d === BINS_TUNING.PUSH), `6 a tick once he leans on it: ${steps.join(' ')}`);
  assert.equal(h.bin(0).z, 860, 'along the face\'s axis only');
  assert.equal(h.p.anim, 'push');
  assert.ok(h.bin(0).x - HW - h.at().x <= PLAYER_RADIUS + BINS_TUNING.PUSH + 1, 'he keeps up with it (the bin a step ahead after his tick)');
  for (let t = 0; t < 200; t++) h.tick({ stickY: 1 }, E);
  assert.ok(Math.abs(h.bin(0).x - lane.BIN_LEASH.x1) <= BINS_TUNING.PUSH, `stopped at the leash's edge (${h.bin(0).x})`);
  assert.equal(h.p.anim, 'push', 'pushing against it');
  // At home: pushed south from the north end, into the other bin (it does not move it on).
  const g = hero(BINS[0].x, 1480, S);
  for (let t = 0; t < 60; t++) g.tick({ stickY: 1 }, S);
  const gap = BINS[1].z - HD - (g.bin(0).z + HD);
  assert.ok(gap >= 0 && gap < 2 * BINS_TUNING.PUSH + BINS_TUNING.FIT * 2 + 1, `up to the other bin (${gap.toFixed(1)} apart)`);
  assert.deepEqual(g.bin(1), BINS[1], 'which stays');
  // Pushed back south into its slot between the gable and the car (out of it, there is no room
  // beside it for him: only its ends): it slides back home along it.
  const w = hero(BINS[0].x, 1100, S);
  w.put(0, BINS[0].x, 1300);
  for (let t = 0; t < 80; t++) w.tick({ stickY: 1 }, S);
  assert.ok(w.bin(0).z > BINS[0].z - 2 * BINS_TUNING.PUSH && w.bin(0).x === BINS[0].x, `back home along its slot (${w.bin(0).z})`);
});

test('the grab: B next to a bin from any side squares him up to its face at the grip distance; never from the air, facing away or out of reach (a punch)', () => {
  const [bx, bz] = [2000, 760];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const half = nx ? HW : HD;
    const yaw = Math.atan2(-nx, -nz);
    const h = hero(bx + nx * (half + 70) + nz * 20, bz + nz * (half + 70) + nx * 15, yaw);
    h.put(0, bx, bz);
    h.tick();
    h.tick({ B: true }, yaw);
    assert.equal(h.p.action, 'bin_hold', `from ${nx}, ${nz}`);
    assert.equal(h.p.binGrip.held, 0);
    assert.ok(Math.abs(h.p.faceYaw - yaw) < 1e-9, 'facing its face');
    const d = nx ? (h.at().x - bx) * nx - HW : (h.at().z - bz) * nz - HD;
    assert.ok(Math.abs(d - BIN_HOLD) < 1e-6, `${d.toFixed(1)} from its face`);
  }
  const refused = (x, z, yaw, setup) => {
    const h = hero(x, z, yaw);
    h.put(0, bx, bz);
    h.tick();
    setup?.(h);
    h.tick({ B: true }, yaw);
    return h.p.action;
  };
  assert.equal(refused(bx, bz - HD - 70, 0, null), 'bin_hold', '(in reach, facing it)');
  assert.equal(refused(bx, bz - HD - 70, N, null), 'punch', 'facing away: a punch');
  assert.equal(refused(bx, bz - HD - 110, 0, null), 'punch', 'out of reach: a punch');
  assert.equal(refused(bx + HW + 60, bz - HD - 60, 0, null), 'punch', 'beside its corner: a punch');
  const air = refused(bx, bz - HD - 70, 0, (h) => h.tick({ A: true }, 0));
  assert.notEqual(air, 'bin_hold', 'never from the air');
});

test('dragging: the stick along his facing pulls (and pushes) the bin at 6 a tick, following at the grip distance, its collider parked while held and back where it stands after', () => {
  const h = hero(BINS[0].x, 1480, S);
  h.tick();
  h.tick({ B: true }, S);
  assert.equal(h.p.action, 'bin_hold');
  const z0 = h.bin(0).z;
  for (let t = 0; t < 40; t++) {
    h.tick({ stickY: -1 }, S);
    assert.ok(Math.abs(h.bin(0).z - HD - h.at().z - BIN_HOLD) < 1e-6, 'at the grip distance');
  }
  assert.equal(h.p.anim, 'bin_pull');
  assert.ok(Math.abs(z0 - h.bin(0).z - 40 * BIN_DRAG_SPEED) < 1e-6, `pulled ${z0 - h.bin(0).z} in 40 ticks`);
  assert.equal(h.bin(0).x, BINS[0].x, 'straight back along his facing');
  assert.ok(h.bins.list[0].tip > 0.2, 'tipped toward him');
  // Held: its collider out of the way (no top over it); pushed back a little.
  assert.ok(topAt(h.bin(0).x, h.bin(0).z) < GROUND + 1, 'its collider parked while held');
  for (let t = 0; t < 10; t++) h.tick({ stickY: 1 }, S);
  assert.equal(h.p.anim, 'bin_push');
  assert.ok(Math.abs(z0 - h.bin(0).z - 30 * BIN_DRAG_SPEED) < 1e-6, 'pushed back 60');
  // Sideways does nothing (he does not turn), then lets go.
  const before = { ...h.at() };
  for (let t = 0; t < 5; t++) h.tick({ stickX: 1 }, S);
  assert.deepEqual(h.at(), before);
  assert.equal(h.p.action, 'bin_hold');
  h.tick({ B: true }, S);
  assert.equal(h.p.action, 'idle', 'B lets go');
  h.tick();
  assert.equal(topAt(h.bin(0).x, h.bin(0).z), BIN.top, 'its collider back where it stands');
  assert.equal(h.p.binGrip.held, -1);
});

test('blocked: the held bin pushed into the other bin goes no further and holds him back; pulled back it follows again', () => {
  const h = hero(BINS[0].x, 1480, S);
  h.tick();
  h.tick({ B: true }, S);
  for (let t = 0; t < 30; t++) h.tick({ stickY: 1 }, S);
  assert.ok(h.bin(0).z + HD < BINS[1].z - HD, 'short of the other bin');
  assert.equal(h.p.binGrip.blocked, 1, 'blocked ahead');
  assert.ok(Math.abs(h.bin(0).z - HD - h.at().z - BIN_HOLD) < 1e-6, 'he stays at the grip distance');
  for (let t = 0; t < 10; t++) h.tick({ stickY: -1 }, S);
  assert.equal(h.p.binGrip.blocked, 0, 'free again');
  assert.ok(h.bin(0).z < BINS[0].z - 30, 'pulled out');
});

test('every way of letting go: B, Z, A (a jump), a stick held across, a hurt, the bin sent home', () => {
  const grab = () => {
    const h = hero(BINS[0].x, 1480, S);
    h.tick();
    h.tick({ B: true }, S);
    for (let t = 0; t < 6; t++) h.tick({ stickY: -1 }, S);
    assert.equal(h.p.action, 'bin_hold');
    return h;
  };
  const after = (fn) => {
    const h = grab();
    fn(h);
    h.tick();
    return h;
  };
  assert.equal(after((h) => h.tick({ B: true }, S)).p.action, 'idle', 'B');
  assert.equal(after((h) => h.tick({ Z: true }, S)).p.action, 'idle', 'Z (no crouch)');
  assert.ok(['jump', 'freefall', 'fall'].includes(after((h) => h.tick({ A: true }, S)).p.action), 'A: a jump');
  const side = grab();
  for (let t = 0; t < 12; t++) side.tick({ stickX: 1 }, S);
  assert.notEqual(side.p.action, 'bin_hold', 'a stick held across');
  const hurt = grab();
  hurt.p.takeDamage(1, { x: hurt.p.pos.x, y: hurt.p.pos.y, z: hurt.p.pos.z + 100 });
  hurt.tick();
  assert.notEqual(hurt.p.action, 'bin_hold', 'a hurt');
  const home = grab();
  home.om.enter(home.p);
  home.tick();
  assert.notEqual(home.p.action, 'bin_hold', 'sent home');
  for (const h of [side, hurt, home]) {
    h.tick();
    assert.equal(h.p.binGrip.held, -1);
    assert.ok(!h.bins.list[0].parked, 'its collider back');
  }
});

test('home: at once on an arrival, a lost life and a new game; by itself left alone with him away (the one stuck behind the other put home unseen)', () => {
  const out = (h) => {
    h.put(0, 1900, 800);
    h.put(1, 2200, 600);
  };
  const h = hero(-500, 900, S);
  out(h);
  h.om.enter(h.p);
  assert.deepEqual([h.bin(0), h.bin(1)], BINS, 'an arrival');
  out(h);
  h.p.loseLife();
  h.tick();
  assert.deepEqual([h.bin(0), h.bin(1)], BINS, 'a lost life');
  out(h);
  h.om.reset();
  assert.deepEqual([h.bin(0), h.bin(1)], BINS, 'a new game');
  // By themselves: both pulled out north (bin_1 can only get home before bin_0 does).
  const g = hero(BINS[0].x, 1480, S);
  g.tick();
  g.tick({ B: true }, S);
  for (let t = 0; t < 60; t++) g.tick({ stickY: -1 }, S);
  g.tick({ B: true }, S);
  g.p.teleport(BINS[0].x + 200 + O.x, GROUND + O.y, 1300 + O.z, S);
  g.put(1, 2300, 700); // (as if pulled out too)
  // Him near: they wait.
  for (let t = 0; t < BINS_TUNING.HOME_WAIT + 30; t++) g.tick();
  assert.notDeepEqual(g.bin(0), BINS[0], 'he is near: they stay');
  // Him away: home they go.
  g.p.teleport(-1500 + O.x, GROUND + O.y, 900 + O.z, S);
  let homing = false;
  for (let t = 0; t < 1400 && !(g.bins.list.every((b) => b.x - O.x === b.home.x - O.x && b.z === b.home.z)); t++) {
    g.tick();
    homing ||= g.bins.list.some((b) => b.homing > 0);
  }
  assert.ok(homing, 'they trundled');
  assert.deepEqual([g.bin(0), g.bin(1)], BINS, 'both home');
  assert.equal(topAt(BINS[0].x, BINS[0].z), BIN.top);
  assert.equal(topAt(BINS[1].x, BINS[1].z), BIN.top);
});

test('both looks\' bin instances are written alike as a bin moves and tips (and a look attached later gets the bins as they stand)', () => {
  const h = hero(BINS[0].x, 1480, S);
  const classic = area.parts[0].movers.bins;
  assert.ok(classic.isInstancedMesh && h.bins.meshes.includes(classic));
  h.tick();
  h.tick({ B: true }, S);
  for (let t = 0; t < 20; t++) h.tick({ stickY: -1 }, S);
  h.om.animate(0, 1, null);
  const real = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 2);
  h.om.setLook({ movers: { bins: real } });
  h.om.animate(0, 1, null);
  const [a, b] = [new THREE.Matrix4(), new THREE.Matrix4()];
  for (let i = 0; i < 2; i++) {
    classic.getMatrixAt(i, a);
    real.getMatrixAt(i, b);
    assert.ok(a.equals(b), `bin ${i}`);
  }
  classic.getMatrixAt(0, a);
  const p = new THREE.Vector3(0, 0, 0).applyMatrix4(a);
  assert.ok(Math.abs(p.z - (h.bin(0).z - HD * (1 - Math.cos(h.bins.list[0].tip)))) < 1 && a.elements[5] < 0.99, 'there, tipped');
});

test('the star climb from the movable bins: onto a bin at home (its coin), from the other onto the carport; and from a bin pushed under the carport\'s front edge', () => {
  const jump = (h, yaw, push = 1) => {
    h.tick({ stickY: push }, yaw);
    h.tick({ stickY: push, A: true }, yaw);
    for (let t = 0; t < 90 && !(h.p.grounded && t > 2); t++) h.tick({ stickY: push, A: true }, yaw);
    for (let t = 0; t < 20; t++) h.tick({}, yaw);
  };
  const a = hero(BINS[0].x, 1300, S);
  for (let t = 0; t < 400 && a.at().z < 1450 - 40; t++) a.tick({ stickY: 0.5 }, S);
  jump(a, S, 0.5);
  assert.ok(Math.abs(a.at().y - BIN.top) < 1 && a.p.grounded && a.log.length === 1, `on the bin, its coin: ${JSON.stringify(a.at())}`);
  assert.deepEqual(a.bin(0), BINS[0], 'it did not move');
  const b = hero(BINS[1].x, BINS[1].z - 40, S, { y: BIN.top });
  b.tick();
  jump(b, S);
  assert.ok(Math.abs(b.at().y - lane.CARPORT.top) < 1, `onto the carport ${JSON.stringify(b.at())}`);
  // A bin pushed under the carport's front edge anywhere along it (between its posts).
  for (const x of [1760, 2250]) {
    const c = hero(x, lane.CARPORT.z0 - HD - 30, S, { y: BIN.top });
    c.put(1, x, lane.CARPORT.z0 - HD + 15);
    c.p.teleport(x + O.x, BIN.top + O.y, lane.CARPORT.z0 - HD - 20 + O.z, S);
    c.tick();
    assert.ok(Math.abs(c.at().y - BIN.top) < 1, 'on its top');
    jump(c, S);
    assert.ok(Math.abs(c.at().y - lane.CARPORT.top) < 1, `x ${x}: onto the carport ${JSON.stringify(c.at())}`);
  }
});

test('idle bins cost nothing: no collision query a tick with him away from them; the hot paths avoid allocating constructs', () => {
  const h = hero(-500, 900, S);
  const col = area.collision;
  let n = 0;
  const wrap = ['findFloor', 'findWalls', 'findCeil', 'raycast'].map((k) => [k, col[k]]);
  for (const [k, f] of wrap) col[k] = (...a) => (n++, f.apply(col, a));
  try {
    for (let t = 0; t < 20; t++) h.bins.update(h.p, t, 0);
  } finally {
    for (const [k] of wrap) delete col[k];
  }
  assert.equal(n, 0, `${n} queries`);
  for (const name of ['update', 'animate', '_follow', '_push', '_homeByThemselves', 'free', '_place', '_knocks', '_jolt']) {
    const src = LaneBins.prototype[name].toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /new [A-Z]|\[\.\.\.|=>/, `${name}: no allocation`);
  }
});

test('the bins\' feel (B4): running at one a quick B punches (it rocks on its wheels with a lid clack and stays), held a moment B grabs it; standing or pushing it a press grabs at once; rolling it rumbles, stopping its lid clacks; a pound beside it rocks it harder', () => {
  const [bx, bz] = [2000, 760];
  const face = bz - HD;
  const setup = (z) => {
    const h = hero(bx, z, S);
    h.put(0, bx, bz);
    h.sounds = [];
    h.om.events.on('sfx', (e) => h.sounds.push(e));
    h.tick();
    return h;
  };
  // Running at it (faster than BIN_GRAB_SPEED), B pressed once in reach: a punch.
  const runIn = () => {
    const h = setup(face - 400);
    for (let t = 0; t < 60 && face - h.at().z > 76; t++) h.tick({ stickY: 0.75 }, S);
    assert.ok(face - h.at().z <= 76 && h.p.forwardVel > BIN_GRAB_SPEED, `running in reach (${(face - h.at().z).toFixed(0)} off, at ${h.p.forwardVel.toFixed(1)})`);
    return h;
  };
  const h = runIn();
  h.tick({ stickY: 0.75, B: true }, S);
  assert.equal(h.p.action, 'punch', 'a quick press running at it: a punch');
  let rocked = 0;
  for (let t = 0; t < 14; t++) {
    h.tick({}, S);
    rocked = Math.max(rocked, h.bins.list[0].rock);
  }
  assert.ok(h.sounds.some((e) => e.name === 'bin_lid'), 'its lid clacks');
  assert.ok(rocked > 0.02 && h.bins.list[0].tnz === 1, `it rocks away from him (${rocked.toFixed(3)})`);
  assert.deepEqual(h.bin(0), { x: bx, z: bz }, 'and stays where it is');
  assert.notEqual(h.p.action, 'bin_hold');
  // Held a moment: it grabs.
  const g = runIn();
  for (let t = 0; t < BIN_GRAB_HOLD - 1; t++) g.tick({ stickY: 0.75, B: true }, S);
  assert.notEqual(g.p.action, 'bin_hold', 'not yet');
  g.tick({ stickY: 0.75, B: true }, S);
  assert.equal(g.p.action, 'bin_hold', `B held ${BIN_GRAB_HOLD} ticks grabs it`);
  for (let t = 0; t < 20; t++) g.tick({ B: true }, S);
  assert.equal(g.p.action, 'bin_hold', 'still holding B: no let-go, no punch');
  g.tick({}, S);
  g.tick({ B: true }, S);
  assert.equal(g.p.action, 'idle', 'B lets go');
  for (let t = 0; t < 2 * BIN_GRAB_HOLD; t++) g.tick({ B: true }, S);
  assert.equal(g.p.action, 'idle', 'the press that let go never grabs again, held');
  // Standing in reach: a press grabs at once.
  const s = setup(face - 70);
  s.tick({ B: true }, S);
  assert.equal(s.p.action, 'bin_hold', 'standing: at once');
  // Pushing it (walking into it): it rumbles as it rolls; a press grabs at once; let go and
  // pushed on, stopped: its lid clacks.
  const p = setup(face - 60);
  for (let t = 0; t < 30; t++) p.tick({ stickY: 1 }, S);
  assert.ok(p.bin(0).z > bz + 60, `pushed (${p.bin(0).z - bz})`);
  assert.ok(p.sounds.filter((e) => e.name === 'bin_roll').length >= 3, 'its wheels rumble');
  p.tick({ stickY: 1, B: true }, S);
  assert.equal(p.p.action, 'bin_hold', 'pushing: a press grabs at once');
  p.tick({}, S);
  p.tick({ B: true }, S);
  assert.equal(p.p.action, 'idle', 'let go');
  for (let t = 0; t < 10; t++) p.tick({ stickY: 1 }, S);
  const lids = p.sounds.filter((e) => e.name === 'bin_lid').length;
  for (let t = 0; t < 6; t++) p.tick({}, S);
  assert.ok(p.sounds.filter((e) => e.name === 'bin_lid').length > lids, 'stopping: its lid clacks');
  // A ground pound beside it: rocked harder, a lower clack.
  const q = setup(face - 70);
  q.tick({ A: true }, S);
  for (let t = 0; t < 8; t++) q.tick({}, S);
  q.tick({ Z: true }, S);
  let pound = 0;
  for (let t = 0; t < 40; t++) {
    q.tick({}, S);
    pound = Math.max(pound, q.bins.list[0].rock);
  }
  const clack = q.sounds.find((e) => e.name === 'bin_lid');
  assert.ok(clack && clack.pitch < 1 && pound > rocked, `a pound beside it (${pound.toFixed(3)})`);
  assert.deepEqual(q.bin(0), { x: bx, z: bz });
});
