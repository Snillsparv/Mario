// The routes of Sparrow Lane, played with scripted input on the real course (world/area.js
// buildArea at its origin) with the real Player and the course's own ObjectManager: the star
// climb (from the dad's drive onto a wheelie bin, onto the carport's flat roof with the stick
// pushed part way or all the way, a hop west onto the roof's south-west slope anywhere along the
// carport's back half, up to the ridge and along it to the star: 'starCollected' { id:
// 'lane_star', area: 'lane' }; walking into the gable from the carport gets him nowhere, and
// past the back wall he drops off); the front eave (a standing jump within 100 of the front wall
// grabs it and climbs on, from 150 or more it falls short); the red-leaf tree (climbed, a
// handstand on its top, a flip toward the house with the stick held 4 to 20 ticks lands on the
// roof; held on, he lands on its far side and walks on down into the back garden, unhurt); and
// the routes round the street, each collecting exactly its coins: down the path from the front
// door, onto the mailbox's roof (a single jump), along the street both ways, onto the villas'
// wall tops (a hop) and up north_3's steps, up the side yard between north_2 and north_3, onto
// the motorhome's roof (a double jump; a single one falls short from anywhere in front of it),
// round the junction's lamppost and up it, round the turning area, up north_4's drive, along the
// footpath, and along south_1's hedge top (a single jump up onto it). And the details: the
// trampoline (with the jump button held every bounce rises to 852, a 'boing' each time, and takes
// the 1-up high over it; a jump from its mat, bouncing without the button or a triple jump on the
// terrace beside it falls short of the 1-up; bouncing off it every way never leaves the
// boundary), the hoop's board as a perch (a hop from the van's roof), and the dad's cars (a jump
// from the drive onto the blue car's roof, a hop from there onto the carport's).
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
import { MAX_HEALTH } from '../src/player/physics/tuning.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { DAD, GROUND, TERRACE } = lane;

// Jonas at a local point (the camera looks along `yaw` each tick: stickY 1 pushes him that way),
// with the course's objects; `log` lists the events they emitted ({ name, ...payload }).
function hero(x, y, z, yaw) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'starCollected', 'oneUp', 'sfx']) events.on(name, (e) => log.push(name === 'sfx' ? { name, sound: e.name } : { name, ...e }));
  const p = new Player({ collision: area.collision, events, spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events, layout: area.objectsLayout, player: p, area: 'lane' });
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const tick = (input, camYaw) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
  };
  // Walks (or runs: speed 1) to each point in turn, the camera looking at it.
  const walk = (points, speed = 1, n = 400) => {
    for (const [x, z] of points) {
      for (let t = 0; t < n; t++) {
        const q = at();
        if (Math.hypot(x - q.x, z - q.z) < 40) break;
        tick({ stickY: speed }, Math.atan2(x - q.x, z - q.z));
      }
    }
  };
  const rest = (n = 20) => {
    for (let t = 0; t < n; t++) tick({}, 0);
  };
  return { p, ctl, om, log, tick, at, walk, rest, coins: () => log.filter((e) => e.name === 'coin').length };
}

// A jump from where he stands, pushing along `yaw` (stick `push`, A held while airborne), then
// `after` ticks more with the stick still on; ends when he is down (or after 90 ticks).
function jump(h, yaw, { push = 1, after = 10, A = true } = {}) {
  h.tick({ stickY: push, A: false }, yaw);
  h.tick({ stickY: push, A: true }, yaw);
  for (let t = 0; t < 90 && !(h.p.grounded && t > 2); t++) h.tick({ stickY: push, A }, yaw);
  for (let t = 0; t < after; t++) h.tick({ stickY: push }, yaw);
}

const E = Math.PI / 2; // +x
const W = -Math.PI / 2; // -x
const N = Math.PI; // -z (up the hill)
const S = 0; // +z (the dad's side)

test('the star climb: from the drive onto a bin, onto the carport (the stick part way or all the way), a hop west onto the roof\'s south-west slope, up to the ridge and along it to the star', () => {
  // Onto the bin from the drive.
  const a = hero(lane.BINS[0].x, GROUND, 1300, S);
  a.walk([[lane.BINS[0].x, 1450]], 0.5);
  jump(a, S, { push: 0.5, after: 0 });
  a.rest();
  assert.ok(Math.abs(a.at().y - lane.BIN.top) < 1 && a.p.grounded, `on the bin: ${JSON.stringify(a.at())}`);
  assert.equal(a.coins(), 1, "the bins' coin");
  // From the bin onto the carport's roof, with the stick part way or all the way.
  for (const push of [0.6, 1]) {
    const h = hero(lane.BINS[1].x, lane.BIN.top, lane.BINS[1].z - 40, S);
    h.rest(2);
    jump(h, S, { push, after: 0 });
    h.rest();
    const q = h.at();
    assert.ok(Math.abs(q.y - lane.CARPORT.top) < 1 && q.z > lane.CARPORT.z0, `stick ${push}: on the carport ${JSON.stringify(q)}`);
  }
  // Walking west into the gable gets him nowhere; a hop lands on the slope anywhere along the
  // carport's back half.
  for (const z of [2200, 2400, 2500, 2560]) {
    const w = hero(1800, lane.CARPORT.top, z, W);
    for (let t = 0; t < 40; t++) w.tick({ stickY: 1 }, W);
    assert.ok(Math.abs(w.at().y - lane.CARPORT.top) < 1 && w.at().x > DAD.x1, `z ${z}: walked into the gable, still on the carport ${JSON.stringify(w.at())}`);
    const h = hero(1800, lane.CARPORT.top, z, W);
    for (let t = 0; t < 4; t++) h.tick({ stickY: 1 }, W);
    jump(h, W, { after: 20 });
    const q = h.at();
    const roof = DAD.ridge - Math.abs(q.z - DAD.ridgeZ) * Math.tan((20 * Math.PI) / 180);
    assert.ok(q.x < DAD.x1 - 200 && Math.abs(q.y - roof) < 6 && h.p.grounded, `z ${z}: hopped onto the slope ${JSON.stringify(q)} (roof ${roof.toFixed(0)})`);
  }
  // Past the back wall a hop drops him off behind the house.
  const back = hero(1800, lane.CARPORT.top, DAD.z1 + 25, W);
  for (let t = 0; t < 4; t++) back.tick({ stickY: 1 }, W);
  jump(back, W, { after: 30 });
  assert.ok(back.at().y < GROUND + 1 && back.at().z > DAD.z1, `off behind the house: ${JSON.stringify(back.at())}`);
  // Up the slope and along the ridge to the star.
  const h = hero(1300, 450, 2560, N);
  h.walk([[1300, DAD.ridgeZ + 60], [lane.STAR.x, DAD.ridgeZ]], 1, 200);
  const got = h.log.find((e) => e.name === 'starCollected');
  assert.ok(got, `the star: at ${JSON.stringify(h.at())}`);
  assert.deepEqual([got.id, got.area], ['lane_star', 'lane']);
  assert.ok(h.coins() >= 1, 'the slope\'s coin on the way');
});

test('the front eave: a standing jump within 100 of the front wall grabs the eave and climbs onto the roof; from 150 or more it falls short', () => {
  for (const d of [60, 100, 150, 250]) {
    const h = hero(-500, GROUND, DAD.z0 - 50 - d, S);
    h.rest(2);
    for (let t = 0; t < 40; t++) h.tick({ stickY: 1, A: t < 15 }, S);
    h.rest(30);
    const q = h.at();
    const roof = DAD.ridge - Math.abs(q.z - DAD.ridgeZ) * Math.tan((20 * Math.PI) / 180);
    if (d <= 100) assert.ok(q.z > DAD.z0 && Math.abs(q.y - roof) < 4 && h.p.grounded, `from ${d}: on the roof ${JSON.stringify(q)}`);
    else assert.ok(Math.abs(q.y - GROUND) < 1 && q.z < DAD.z0, `from ${d}: still on the lawn ${JSON.stringify(q)}`);
    assert.equal(h.p.health, MAX_HEALTH);
  }
});

test('the red-leaf tree: climbed to a handstand on its top, a flip toward the house with the stick held 4 to 20 ticks lands on the roof; held on, he lands on its far side and walks on down into the back garden, unhurt', () => {
  const T = lane.RED_TREE;
  const flip = (hold, walkOn = false) => {
    const h = hero(T.x, GROUND, T.z - 250, S);
    h.rest(1);
    for (let t = 0; t < 10; t++) h.tick({ stickY: 1 }, S);
    h.tick({ stickY: 1, A: true }, S);
    for (let t = 0; t < 200 && h.p.action !== 'pole_top'; t++) h.tick({ stickY: 1 }, S);
    assert.equal(h.p.action, 'pole_top', `hold ${hold}: on the tree's top`);
    assert.ok(Math.abs(h.at().y - T.y1) < 1);
    h.rest(15);
    h.tick({ stickY: 1, A: true }, S);
    let peak = 0;
    for (let t = 0; t < (walkOn ? 240 : 90); t++) {
      h.tick({ stickY: t < hold ? 1 : 0 }, S);
      peak = Math.max(peak, h.at().y);
      if (!walkOn && t > 5 && h.p.grounded) break;
    }
    h.rest();
    return { h, q: h.at(), peak };
  };
  for (const hold of [4, 8, 12, 16, 20]) {
    const { h, q, peak } = flip(hold);
    assert.ok(peak > 900, `hold ${hold}: a high flip (${peak.toFixed(0)})`);
    assert.ok(q.y > DAD.eave && q.z > DAD.z0 && q.z < DAD.z1 && h.p.grounded, `hold ${hold}: on the roof ${JSON.stringify(q)}`);
    assert.equal(h.p.health, MAX_HEALTH);
  }
  const { h, q } = flip(Infinity, true);
  assert.ok(Math.abs(q.y - GROUND) < 1 && q.z > DAD.z1, `held on: down in the back garden ${JSON.stringify(q)}`);
  assert.equal(h.p.health, MAX_HEALTH);
});

test('welcome: out of the front door down the path to the street (its three coins), onto the mailbox\'s roof with a single jump (its coin)', () => {
  const e = lane.ENTRIES.home;
  const h = hero(e.x, e.y, e.z, e.yaw);
  h.walk([[e.x, 520]]);
  assert.equal(h.coins(), 3, 'the path');
  const M = lane.MAILBOX;
  const m = hero(M.x, GROUND, M.z - 260, S);
  m.walk([[M.x, M.z - 160]], 0.4);
  jump(m, S, { push: 0.4, after: 0 });
  m.rest();
  assert.ok(Math.abs(m.at().y - M.eaves) < 1 && m.p.grounded, `on the mailbox: ${JSON.stringify(m.at())}`);
  assert.equal(m.coins(), 1, "the mailbox's roof");
});

test('west: along the street (five coins), a hop onto north_2\'s wall top (three), north_3\'s steps (three) and its wall top (three), up the side yard between them (three)', () => {
  const st = hero(-300, 0, 0, W);
  st.walk([[-3500, 0]]);
  assert.equal(st.coins(), 5, 'the street west');
  // A hop up the wall from the pavement, then along its top.
  const w = hero(-3550, GROUND, -600, N);
  jump(w, N, { push: 0.6, after: 4 });
  assert.ok(Math.abs(w.at().y - TERRACE) < 1, `on the wall top: ${JSON.stringify(w.at())}`);
  w.walk([[-3550, -750], [-2850, -750]], 0.5);
  assert.equal(w.coins(), 3, "north_2's wall top");
  // Up north_3's steps from the pavement, then west along its wall top.
  const [s0, s1] = lane.PLOTS_N[2].steps;
  const u = hero((s0 + s1) / 2, GROUND, -560, N);
  u.walk([[(s0 + s1) / 2, -1060]], 0.6);
  assert.ok(Math.abs(u.at().y - TERRACE) < 1, `up the steps: ${JSON.stringify(u.at())}`);
  assert.equal(u.coins(), 3, "north_3's steps");
  u.walk([[-80, -1060], [-80, -750], [-900, -750]], 0.5);
  assert.equal(u.coins(), 6, "...and its wall top");
  // Up the side yard to the back garden.
  const y = hero(-1125, TERRACE, -1500, N);
  y.walk([[-1125, -3000]]);
  assert.equal(y.coins(), 3, 'the side yard');
});

test('the motorhome: a running double jump from the drive in front of it grabs its roof\'s edge (its three coins); a single running jump falls short from anywhere in front of it', () => {
  const M = lane.MOTORHOME;
  const yaw = M.yaw + Math.PI; // facing it from the road side (its frame's -w)
  const at = (w, u = 0) => [M.cx + Math.cos(M.yaw) * u + Math.sin(M.yaw) * w, M.cz - Math.sin(M.yaw) * u + Math.cos(M.yaw) * w];
  const start = (w) => {
    const [x, z] = at(w);
    return hero(x, lane.groundHeight(x, z), z, yaw);
  };
  for (const w of [450, 500, 600, 700, 800]) {
    const h = start(w);
    h.rest(1);
    jump(h, yaw, { after: 30 });
    assert.ok(h.at().y < GROUND + M.h - 100, `single from ${w}: not on its roof ${JSON.stringify(h.at())}`);
  }
  const h = start(600);
  h.rest(1);
  jump(h, yaw, { after: 0 });
  jump(h, yaw, { after: 0 });
  h.rest(30);
  assert.ok(Math.abs(h.at().y - GROUND - M.h) < 1, `double: on its roof ${JSON.stringify(h.at())}`);
  // Along its roof: its coins.
  const [x0, z0] = at(0, -360);
  const [x1, z1] = at(0, 360);
  h.walk([[x0, z0], [x1, z1]], 0.4);
  assert.equal(h.coins(), 3, "the motorhome's roof");
});

test('the junction: round the lamppost (three coins) and up it to a handstand on its top', () => {
  const L1 = lane.POLES[0];
  const h = hero(-8370, GROUND, 1300, S);
  h.walk([[-8370, 1590], [-7995, 1807], [-7995, 1373]], 0.6);
  assert.equal(h.coins(), 3, 'round the lamppost');
  const q = h.at();
  h.walk([[L1.x - 300, L1.z]], 0.6);
  for (let t = 0; t < 60 && h.p.action !== 'pole'; t++) h.tick({ stickY: 1, A: Math.hypot(h.at().x - L1.x, h.at().z - L1.z) < 130 && h.p.grounded }, E);
  assert.equal(h.p.action, 'pole', `grabbed it from ${JSON.stringify(q)}`);
  for (let t = 0; t < 400 && h.p.action !== 'pole_top'; t++) h.tick({ stickY: 1 }, E);
  assert.equal(h.p.action, 'pole_top');
  assert.ok(Math.abs(h.at().y - L1.y1) < 1);
});

test('east: along the street (three coins), round the turning area (seven), up north_4\'s drive (three), along the footpath (one)', () => {
  const st = hero(300, 0, 0, E);
  st.walk([[2200, 0]]);
  assert.equal(st.coins(), 3, 'the street east');
  const T = lane.TURN;
  const ring = hero(T.x, 0, T.z + 650, E);
  const pts = Array.from({ length: 29 }, (_, k) => {
    const a = ((k + 0.5) / 28) * Math.PI * 2;
    return [T.x + 650 * Math.sin(a), T.z + 650 * Math.cos(a)];
  });
  ring.walk(pts, 0.5);
  assert.equal(ring.coins(), 7, 'the turning area');
  const d = hero(3070, 0, -1000, N);
  d.walk([[3070, -1700]], 0.5);
  assert.equal(d.coins(), 3, "north_4's drive");
  const f = lane.footpathAt(100);
  const g = lane.footpathAt(900);
  const p = hero(f.x, GROUND, f.z, S);
  p.walk([[g.x, g.z]], 0.6);
  assert.equal(p.coins(), 1, 'the footpath');
});

test("the hedge walk: a single jump from the lawn up onto south_1's hedge (165 high), and along its top (three coins)", () => {
  const H = lane.HEDGES[0];
  assert.equal(H.top - GROUND, 165);
  const h = hero(-3300, GROUND, H.z0 - 120, S);
  jump(h, S, { push: 0.6, after: 4 });
  assert.ok(Math.abs(h.at().y - H.top) < 1 && h.p.grounded, `on the hedge: ${JSON.stringify(h.at())}`);
  h.walk([[-3300, (H.z0 + H.z1) / 2], [-2000, (H.z0 + H.z1) / 2]], 0.4);
  assert.ok(Math.abs(h.at().y - H.top) < 1, `along its top: ${JSON.stringify(h.at())}`);
  assert.equal(h.coins(), 3, 'its coins');
});

// The peaks (feet heights) of each arc he flies while `input` runs for n ticks.
function arcs(h, input, yaw, n) {
  const peaks = [];
  let vy = h.p.vel.y;
  for (let t = 0; t < n; t++) {
    h.tick(input(t), yaw);
    if (vy > 0 && h.p.vel.y <= 0) peaks.push(h.at().y);
    vy = h.p.vel.y;
  }
  return peaks;
}

test('the trampoline: with the jump button held every bounce rises to 852 with a boing and takes the 1-up; a jump from the mat, bounces without the button or a triple jump beside it fall short; bouncing off it every way stays in bounds', () => {
  const T = lane.TRAMPOLINE;
  const U = lane.ONE_UP;
  const ones = (h) => h.log.filter((e) => e.name === 'oneUp').length;
  // From the terrace beside it a hop onto the mat, the button held from then on.
  const h = hero(T.x - T.r - 120, TERRACE, T.z, E);
  h.rest(2);
  const peaks = arcs(h, (t) => ({ stickY: Math.hypot(h.at().x - T.x, h.at().z - T.z) < T.r - 80 ? 0 : 0.5, A: true }), E, 240);
  const bounces = peaks.slice(1);
  assert.ok(bounces.length >= 5, `${peaks.length} arcs`);
  for (const y of bounces) assert.ok(Math.abs(y - 852) <= 10, `a bounce to ${y.toFixed(0)}: ${peaks.map((p) => p.toFixed(0))}`);
  assert.equal(ones(h), 1, 'the 1-up');
  const sounds = h.log.filter((e) => e.name === 'sfx').map((e) => e.sound);
  assert.ok(sounds.filter((n) => n === 'boing').length >= bounces.length && !sounds.includes('stomp'), `a boing a bounce: ${sounds}`);
  // A jump from the mat (standing on it): its arc stays far under the 1-up.
  const j = hero(T.x, T.y, T.z, E);
  j.rest(2);
  j.tick({ A: true }, E);
  const [first] = arcs(j, () => ({ A: true }), E, 25);
  assert.ok(first < U.y - 200 - 50 && ones(j) === 0, `a jump from the mat peaks at ${first.toFixed(0)}`);
  // Dropped onto it without the button: the bounces stay low.
  const d = hero(T.x, T.y + 300, T.z, E);
  d.p.setAction('freefall');
  const low = arcs(d, () => ({}), E, 150);
  assert.ok(low.length >= 3 && Math.max(...low) < U.y - 200 - 100 && ones(d) === 0, `bounces without the button: ${low.map((p) => p.toFixed(0))}`);
  // A running triple jump on the terrace (up the yard west of it) peaks short of it.
  const tj = hero(3980, TERRACE, -1700, N);
  tj.rest(1);
  for (let t = 0; t < 10; t++) tj.tick({ stickY: 1 }, N);
  const tops = [];
  for (let k = 0; k < 3; k++) {
    tj.tick({ stickY: 1, A: false }, N);
    tj.tick({ stickY: 1, A: true }, N);
    let peak = 0;
    for (let t = 0; t < 60 && !(tj.p.grounded && t > 2); t++) {
      tj.tick({ stickY: 1, A: true }, N);
      peak = Math.max(peak, tj.at().y);
    }
    tops.push(peak);
  }
  assert.ok(tops[2] > tops[1] && tops[2] - TERRACE > 600 && tops[2] < U.y - 200, `the triple jump's peaks ${tops.map((p) => p.toFixed(0))}`);
  // Bouncing with the button held and the stick pushed every way: always in bounds, unhurt.
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    const b = hero(T.x, T.y + 300, T.z, yaw);
    b.p.setAction('freefall');
    for (let t = 0; t < 200; t++) {
      b.tick({ stickY: 1, A: true }, yaw);
      assert.ok(lane.inBounds(b.at().x, b.at().z), `toward ${k}: in bounds at ${JSON.stringify(b.at())}`);
    }
    assert.equal(b.p.health, MAX_HEALTH);
  }
});

test("the hoop's board, a perch: a hop from the van's roof toward it lands on its top (the stick part way or all the way), and a jump off it lands unhurt", () => {
  const H = lane.HOOP;
  const van = lane.CARS.find((c) => c.kind === 'van');
  const roof = GROUND + lane.CAR_KINDS.van.roof;
  for (const push of [0.5, 1]) {
    const yaw = Math.atan2(H.x - (van.x - 80), H.z + 40 - (van.z - 160));
    const h = hero(van.x - 80, roof, van.z - 160, yaw);
    h.rest(2);
    h.tick({ stickY: push, A: true }, yaw);
    for (let t = 0; t < 60; t++) h.tick({ stickY: push, A: true }, yaw);
    h.rest(30);
    const q = h.at();
    assert.ok(Math.abs(q.y - H.board - H.h) < 1 && h.p.grounded && Math.abs(q.x - H.x) <= H.w / 2, `stick ${push}: on the board ${JSON.stringify(q)}`);
    jump(h, S, { after: 30 });
    assert.ok(h.at().y < roof && h.p.health === MAX_HEALTH, `down again: ${JSON.stringify(h.at())}`);
  }
});

test("the dad's cars: from the drive a hop onto the blue car's bonnet, another onto its roof and one more from there onto the carport's (a way up besides the bins)", () => {
  const ev = lane.CARS[0];
  const K = lane.CAR_KINDS[ev.kind];
  const nose = ev.z - K.l / 2;
  const h = hero(ev.x, GROUND, nose - 180, S);
  h.rest(2);
  jump(h, S, { after: 0 });
  h.rest();
  assert.ok(Math.abs(h.at().y - GROUND - K.belt) < 1 && h.p.grounded, `on its bonnet: ${JSON.stringify(h.at())}`);
  jump(h, S, { push: 0.6, after: 0 });
  h.rest();
  assert.ok(Math.abs(h.at().y - GROUND - K.roof) < 1 && h.p.grounded, `on its roof: ${JSON.stringify(h.at())}`);
  h.walk([[ev.x, ev.z + 180]], 0.4);
  jump(h, S, { push: 0.6, after: 0 });
  h.rest();
  assert.ok(Math.abs(h.at().y - lane.CARPORT.top) < 1 && h.at().z > lane.CARPORT.z0, `on the carport: ${JSON.stringify(h.at())}`);
});

test('D1, the garage: from the street through the gap between the cars to the red door, B, B smashes it, in to the room\'s five coins and its 1-up, and out between the cars again; the double doors with one ground pound in the strip at their middle', async () => {
  const chunk = await import('../src/objects/laneBoss/index.js');
  const h = hero(2099, 0, 300, S);
  h.om.attachLane(chunk, area);
  h.om.laneBoss.armed = false;
  const g = h.om.garage;
  try {
    h.walk([[2099, 1500], [2085, 1850]], 0.6);
    h.rest(5);
    for (let t = 0; t < 14; t++) h.tick({ B: t === 0 || t === 6 }, S);
    assert.ok(g.leaves[1].broken, 'the red door smashed');
    h.walk([[2085, 2250], [1800, 2250], [2380, 2250], [2090, 2470]], 0.6);
    h.walk([[2090, 2560]], 0.4, 30);
    assert.equal(h.coins(), 5, 'the room\'s five coins');
    assert.equal(h.log.filter((e) => e.name === 'oneUp').length, 1, 'its 1-up');
    h.walk([[2085, 2100], [2085, 1850], [2099, 1500], [2099, 300]], 0.6);
    assert.ok(h.at().z < 400, `out to the street: ${JSON.stringify(h.at())}`);
    assert.equal(h.coins(), 5);
    // The double doors: one pound at their middle, from the strip.
    g.enter({ pos: { x: 1e7, y: 0, z: 1e7 } });
    h.p.teleport(2330 + O.x, GROUND + O.y, lane.GARAGE.wall - 90 + O.z, S);
    h.p.setAction('idle');
    h.rest(3);
    for (let t = 0; t < 50; t++) h.tick({ A: t < 9, Z: t === 9 }, S);
    assert.ok(g.leaves[2].broken && g.leaves[3].broken, 'both leaves');
  } finally {
    g.enter({ pos: { x: 1e7, y: 0, z: 1e7 } });
  }
});
