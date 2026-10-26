// The routes of Sparrow Lane, played with scripted input on the real course (world/area.js
// buildArea at its origin) with the real Player and the course's own ObjectManager: the star
// climb (from the dad's drive onto a wheelie bin, onto the carport's flat roof with the stick
// pushed part way or all the way, a hop west onto the east wing's roof (W3) or over the gable's
// back corner onto the main roof's back slope anywhere along the carport's back half, up the
// wing's ridge onto the main roof and along its ridge to the star: 'starCollected' { id:
// 'lane_star', area: 'lane' }; walking into the gable or the wing's wall from the carport gets
// him nowhere); the front eave (a standing jump within 100 of the front wall grabs it, its
// gutter's flat lip, and climbs on, from 150 or more it falls short); the red-leaf tree (climbed,
// a handstand on its top, a flip toward the house with the stick held 8 to 24 ticks lands on the
// roof; held on, he lands on its far side and walks on down into the back garden, unhurt; let go
// at once he lands in the garden); and
// the routes round the street, each collecting exactly its coins: down the path from the front
// door, onto the mailbox's roof (a single jump), along the street both ways, onto north_2's hedge
// (W6: a jump from the pavement), north_3's wall top (a hop) and up north_3's steps, up the side yard between north_2 and north_3, onto
// the motorhome's roof (a double jump; a single one from the ground round it falls short, at
// full speed and at its nose too; round 2: from north_1's terrace beside it a single one),
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
import { PLAYER_RADIUS } from '../src/core/constants.js';
import { ROOM } from '../src/world/lane/garage.js';
import { kerbside } from '../src/world/lane/surface.js';
import { forestSpots } from '../src/world/lane/real/spots.js';

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

// The dad's roofs (W3): the main roof's slopes (its pitch), and each wing's (its ridge along z)
// where it covers the main roof's back slope (past the valley) or its own footprint; the highest
// of them over (x, z), or null.
const roofOver = (x, z) => {
  const tan = (DAD.ridge - DAD.eave) / (DAD.d / 2);
  const ys = [];
  if (x >= DAD.x0 && x <= DAD.x1 && z >= DAD.z0 && z <= DAD.z1) ys.push(DAD.ridge - Math.abs(z - DAD.ridgeZ) * tan);
  for (const w of lane.DAD_WINGS) {
    const half = w.d / 2;
    const off = Math.abs(x - w.cx);
    const valley = DAD.z1 - (w.join.apex - w.w / 2) + off; // (the valley's z at this x)
    if (off <= half && z >= valley && z <= w.cz + w.w / 2) ys.push(w.ridge - (off * (w.ridge - w.eave)) / half);
  }
  return ys.length ? Math.max(...ys) : null;
};

test("the star climb (W4: the garage row's roof from the gable's back corner, just under the east wing's eave): from the drive onto a bin at home (its coin); up onto the row's roof by its edge (a standing jump in the gap between the cars grabs it: a bin pushed back to it, lane-bins, or the cars, below, are the other ways); walking west from it he walks up onto the east wing's roof anywhere along the row; up along the wing's ridge onto the main roof and along its ridge to the star", () => {
  // Onto the bin from the drive.
  const face = lane.BINS[0].z - lane.BIN.z / 2;
  const a = hero(lane.BINS[0].x, GROUND, face - 250, S);
  a.walk([[lane.BINS[0].x, face - 105]], 0.5);
  jump(a, S, { push: 0.5, after: 0 });
  a.rest();
  assert.ok(Math.abs(a.at().y - lane.BIN.top) < 1 && a.p.grounded, `on the bin: ${JSON.stringify(a.at())}`);
  assert.equal(a.coins(), 1, "the bins' coin");
  // Up by the row's edge from the gap between the cars: the grab, then A climbs.
  const [ev, suv] = lane.CARS.slice(0, 2);
  const gap = (ev.x + lane.CAR_KINDS[ev.kind].w / 2 + suv.x - lane.CAR_KINDS[suv.kind].w / 2) / 2;
  const g = hero(gap, GROUND, lane.CARPORT.z0 - 110, S);
  g.rest(2);
  for (let t = 0; t < 40 && g.p.action !== 'ledge_hang'; t++) g.tick({ stickY: 1, A: t < 15 }, S);
  assert.equal(g.p.action, 'ledge_hang', 'hanging from the row\'s edge');
  g.rest(6);
  g.tick({ A: true }, S);
  g.rest(40);
  assert.ok(Math.abs(g.at().y - lane.CARPORT.top) < 1 && g.at().z > lane.CARPORT.z0 && g.p.grounded, `up on the row's roof: ${JSON.stringify(g.at())}`);
  // Walking west from the row's roof anywhere along it he walks up onto the east wing's roof.
  for (const d of [60, 250, 450, 650]) {
    const z = lane.CARPORT.z0 + d;
    const w = hero(1800, lane.CARPORT.top, z, W);
    for (let t = 0; t < 40; t++) w.tick({ stickY: 1 }, W);
    const q = w.at();
    const roof = roofOver(q.x, q.z);
    assert.ok(q.x < DAD.x1 - 100 && roof !== null && Math.abs(q.y - roof) < 6 && w.p.grounded, `z ${z}: walked up onto a roof ${JSON.stringify(q)} (roof ${roof?.toFixed(0)})`);
  }
  // Up the wing's slope to its ridge, along it onto the main roof (its valleys) and along the
  // ridge to the star.
  const E = lane.DAD_WINGS[1];
  const h = hero(1450, roofOver(1450, 2500) + 2, 2500, W);
  h.rest(2);
  h.walk([[E.cx, 2450], [E.cx, DAD.ridgeZ + 60], [lane.STAR.x, DAD.ridgeZ]], 1, 300);
  const got = h.log.find((e) => e.name === 'starCollected');
  assert.ok(got, `the star: at ${JSON.stringify(h.at())}`);
  assert.deepEqual([got.id, got.area], ['lane_star', 'lane']);
  assert.ok(h.coins() >= 1, 'the slopes\' coins on the way');
});

test('the front eave: a standing jump within 100 of the front wall grabs the eave (its gutter\'s flat lip: the roof is steeper than a ledge) and climbs onto the roof; from 150 or more it falls short', () => {
  for (const x of [400, -100, 1250]) {
    for (const d of [60, 100, 150, 250]) {
      const h = hero(x, GROUND, DAD.z0 - 50 - d, S);
      h.rest(2);
      for (let t = 0; t < 40; t++) h.tick({ stickY: 1, A: t < 15 }, S);
      h.rest(30);
      const q = h.at();
      if (d <= 100) assert.ok(q.z > DAD.z0 && Math.abs(q.y - roofOver(q.x, q.z)) < 4 && h.p.grounded, `x ${x}, from ${d}: on the roof ${JSON.stringify(q)}`);
      else assert.ok(Math.abs(q.y - GROUND) < 1 && q.z < DAD.z0, `x ${x}, from ${d}: still on the lawn ${JSON.stringify(q)}`);
      assert.equal(h.p.health, MAX_HEALTH);
    }
  }
});

test("the neighbours (W5): a standing jump within 100 of south_1's and south_2's front walls grabs the eave (a lip, as the dad's: their roofs as steep) and climbs onto the roof; south_2's raised bed walked up onto from its gravel; on through the young beech row into the garden behind it", () => {
  for (const H of [lane.SOUTH_1, lane.SOUTH_2]) {
    const tan = (H.ridge - H.eave) / (H.d / 2);
    const z0 = H.cz - H.d / 2;
    for (const x of [H.cx - 500, H.cx + 700]) {
      const h = hero(x, GROUND, z0 - 50 - 80, S);
      h.rest(2);
      for (let t = 0; t < 40; t++) h.tick({ stickY: 1, A: t < 15 }, S);
      h.rest(30);
      const q = h.at();
      assert.ok(q.z > z0 && Math.abs(q.y - (H.ridge - Math.abs(q.z - H.cz) * tan)) < 4 && h.p.grounded, `${H.id} at x ${x}: on the roof ${JSON.stringify(q)}`);
      assert.equal(h.p.health, MAX_HEALTH);
    }
  }
  const R = lane.S2_GARDEN.raised;
  const b = hero((R.x0 + R.x1) / 2, GROUND, R.z1 + 120, N);
  b.walk([[(R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2]], 0.6);
  assert.ok(Math.abs(b.at().y - R.top) < 1 && b.p.grounded, `on the raised bed: ${JSON.stringify(b.at())}`);
  const B = lane.BEECH_ROW;
  const w = hero((B.x0 + B.x1) / 2 + B.step / 2, 0, lane.SOUTH_EDGE - 150, S);
  w.walk([[(B.x0 + B.x1) / 2 + B.step / 2, B.soil[1] + 300]], 0.6);
  assert.ok(w.at().z > B.soil[1] + 200 && Math.abs(w.at().y - GROUND) < 1, `through the beech row: ${JSON.stringify(w.at())}`);
  // (W5 fix: the hedge stops short of the link's drive: in from the street past its end onto the
  // lawn; its low east end (110) and the clump set back by the house (140) each a hop up.)
  const E = lane.HEDGES.find((e) => e.informal && e.x0 === lane.HEDGES[0].x1);
  const C = lane.HEDGES.find((e) => e.informal && e.z0 > lane.SOUTH_EDGE);
  const xc = (E.x1 + lane.LINK.x0) / 2;
  const c = hero(xc, 0, lane.SOUTH_EDGE - 150, S);
  c.walk([[xc, C.z0 - 120]], 0.6);
  assert.ok(c.at().z > C.z0 - 160 && Math.abs(c.at().y - GROUND) < 1, `in past the hedge's end: ${JSON.stringify(c.at())}`);
  for (const [K, x, z, yaw] of [[E, E.x1 - 150, E.z1 + 120, N], [C, (C.x0 + C.x1) / 2, C.z0 - 120, S]]) {
    const j = hero(x, GROUND, z, yaw);
    jump(j, yaw, { push: 0.5, after: 4 });
    assert.ok(Math.abs(j.at().y - K.top) < 1 && j.p.grounded, `up onto the hedge at ${K.x0}: ${JSON.stringify(j.at())}`);
    assert.equal(j.p.health, MAX_HEALTH);
  }
});

test('the red-leaf tree: climbed to a handstand on its top, a flip toward the house with the stick held 8 to 24 ticks lands on the roof (W3: its trunk 640 from the wall); held on, he lands on its far side and walks on down into the back garden, unhurt; let go early, he lands in the garden', () => {
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
  for (const hold of [8, 12, 16, 20, 24]) {
    const { h, q, peak } = flip(hold);
    assert.ok(peak > 900, `hold ${hold}: a high flip (${peak.toFixed(0)})`);
    assert.ok(q.y > DAD.eave && q.z > DAD.z0 && q.z < DAD.z1 && h.p.grounded, `hold ${hold}: on the roof ${JSON.stringify(q)}`);
    assert.equal(h.p.health, MAX_HEALTH);
  }
  const short = flip(2);
  assert.ok(short.h.p.grounded && short.q.y < GROUND + lane.BED.raise + 1 && short.q.z < DAD.z0, `let go at once: down in the garden ${JSON.stringify(short.q)}`);
  assert.equal(short.h.p.health, MAX_HEALTH);
  const { h, q } = flip(Infinity, true);
  assert.ok(Math.abs(q.y - GROUND) < 1 && q.z > DAD.z1, `held on: down in the back garden ${JSON.stringify(q)}`);
  assert.equal(h.p.health, MAX_HEALTH);
});

test('welcome: out of the front door down the path to the street (its three coins), onto the mailbox\'s roof with a single jump (its coin)', () => {
  const e = lane.ENTRIES.home;
  const h = hero(e.x, e.y, e.z, e.yaw);
  h.walk([[e.x, 520]]);
  assert.equal(h.coins(), 3, 'the path');
  // (Its collider is the lid's footprint, 76 x 61: walking up at 0.4 to 160 short of its middle,
  // a jump south lands on it for pushes about 0.53 to 0.63; three across that window's middle.)
  const M = lane.MAILBOX;
  for (const push of [0.55, 0.58, 0.61]) {
    const m = hero(M.x, GROUND, M.z - 260, S);
    m.walk([[M.x, M.z - 160]], 0.4);
    jump(m, S, { push, after: 0 });
    m.rest();
    assert.ok(Math.abs(m.at().y - M.eaves) < 1 && m.p.grounded, `on the mailbox (push ${push}): ${JSON.stringify(m.at())}`);
    assert.equal(m.coins(), 1, "the mailbox's roof");
  }
});

test('west: along the street (five coins), a jump onto north_2\'s hedge on its bed wall and along its top (three: W6), north_3\'s steps (three) and its wall top (three), up the side yard between them (three)', () => {
  // (W2: every start from the layout's anchors: the straight's centreline, the terraces' wall
  // line, the plots' steps and edges.)
  const Z = lane.ROAD.line.at(-1)[1];
  const top = (x) => lane.wallZAt(x) - 50; // (along a wall top, its coins' line)
  const pave = (x) => (lane.ROAD.line.at(-1)[1] - lane.ROAD.half - lane.KERB.w + lane.wallZAt(x)) / 2; // (the pavement's middle)
  const st = hero(-300, 0, Z, W);
  st.walk([[-3500, Z]]);
  assert.equal(st.coins(), 5, 'the street west');
  // (W6: north_2's clipped hedge on its bed wall, photos 13, 43, 44: its walkable top 190 over
  // the terrace.) A jump from the pavement grabs its top's edge and climbs on (or from the terrace
  // behind it, a single jump lands on it); then along its top, west of north_2's drive.
  const H = lane.HEDGES.find((e) => e.clipped);
  assert.equal(H.top - TERRACE, 190);
  const mid = (H.z0 + H.z1) / 2;
  const w = hero(-4650, GROUND, pave(-4650), N);
  jump(w, N, { push: 0.5, after: 4 });
  assert.ok(Math.abs(w.at().y - H.top) < 1 && w.p.grounded, `on the hedge: ${JSON.stringify(w.at())}`);
  w.walk([[-4650, mid], [-4050, mid]], 0.4, 600);
  assert.ok(Math.abs(w.at().y - H.top) < 1, `along its top: ${JSON.stringify(w.at())}`);
  assert.equal(w.coins(), 3, "north_2's hedge top");
  const b = hero(-4500, TERRACE, H.z0 - 110, S);
  jump(b, S, { push: 0.4, after: 4 });
  assert.ok(Math.abs(b.at().y - H.top) < 1 && b.p.grounded, `onto it from the terrace behind: ${JSON.stringify(b.at())}`);
  // Up north_3's steps from the pavement (east of its drive).
  const [s0, s1] = lane.PLOTS_N[2].steps;
  const u = hero((s0 + s1) / 2, GROUND, pave(s0), N);
  u.walk([[(s0 + s1) / 2, lane.wallZAt(s0) - lane.STEPS.run - 80]], 0.6);
  assert.ok(Math.abs(u.at().y - TERRACE) < 1, `up the steps: ${JSON.stringify(u.at())}`);
  assert.equal(u.coins(), 3, "north_3's steps");
  // Its wall top west of the drive (in front of its west block, short of the box hedge): a hop
  // from the pavement and along it.
  const v = hero(-1250, GROUND, pave(-1250), N);
  jump(v, N, { push: 0.6, after: 4 });
  assert.ok(Math.abs(v.at().y - TERRACE) < 1, `on north_3's wall top: ${JSON.stringify(v.at())}`);
  v.walk([[-1250, top(-1250)], [-650, top(-650)]], 0.5);
  assert.equal(v.coins(), 3, "north_3's wall top");
  // Up the side yard between north_2 and north_3 to the back garden.
  const X = lane.PLOTS_N[1].x1;
  const y = hero(X, TERRACE, -1500, N);
  y.walk([[X, -3000]]);
  assert.equal(y.coins(), 3, 'the side yard');
});

// (Round 2: the motorhome broadside to the street beside north_west's east wall, as photos 04-07
// have it, its cab toward the road: the rule re-derived in its own frame, u along it (+u its nose,
// toward the road), w across it (+w its right side, toward the house). Single jumps from the
// ground round it: from the drive on either side, at its nose from the pavement and the road
// (its windscreen too steep to stand on: no step up it), from the yard at its back; standing and
// at the run-ups each side allows (the estate at the wide door and north_1's terrace bound
// them; the road gives full speed). From north_1's terrace beside its back half (150 up, 25 off
// its side) a single jump does reach its roof: the photos' place puts it against that terrace's
// corner, and the garden above it is the one step up to it.)
test('the motorhome: a running double jump from the drive beside it lands on its roof (its three coins); a single jump from the ground round it falls short from a standstill or at full speed, at its nose too; from north_1\'s terrace beside it a single jump reaches it', () => {
  const M = lane.MOTORHOME;
  const at = (u, w) => [M.cx + Math.cos(M.yaw) * u + Math.sin(M.yaw) * w, M.cz - Math.sin(M.yaw) * u + Math.cos(M.yaw) * w];
  const local = (q) => {
    const [dx, dz] = [q.x - M.cx, q.z - M.cz];
    return [dx * Math.cos(M.yaw) - dz * Math.sin(M.yaw), dx * Math.sin(M.yaw) + dz * Math.cos(M.yaw)];
  };
  const heading = (du, dw) => Math.atan2(Math.cos(M.yaw) * du + Math.sin(M.yaw) * dw, -Math.sin(M.yaw) * du + Math.cos(M.yaw) * dw);
  const roof = GROUND + M.h;
  const start = (u, w, yaw) => {
    const [x, z] = at(u, w);
    return hero(x, lane.groundHeight(x, z), z, yaw);
  };
  // Standing single jumps at it, from each side.
  for (const [u, w, du, dw] of [[100, 300], [100, 500], [300, 400], [300, 650], [100, -300], [300, -450], [450, -600], [700, 0], [800, -100], [-700, 0], [-800, 120]].map(([u, w]) => [u, w, ...(Math.abs(u) > M.l / 2 ? [-Math.sign(u), 0] : [0, -Math.sign(w)])])) {
    const yaw = heading(du, dw);
    const h = start(u, w, yaw);
    h.rest(1);
    jump(h, yaw, { after: 30 });
    assert.ok(h.at().y < roof - 100, `single from (${u}, ${w}): not on its roof ${JSON.stringify(h.at())}`);
  }
  // Running ones: along lines at it from each side's ground, the take-off at every point of the
  // run-up; never a grab of its roof's edge, never on its roof.
  const runs = [
    ...[80, 260, 440].map((u) => ({ u, w: 1040, axis: 1, dir: -1, offs: [900, 300], least: 500 })), // (the drive between it and the estate)
    ...[300, 450].map((u) => ({ u, w: -720, axis: 1, dir: 1, offs: [-690, -300] })), // (the drive's east part, short of north_1's terrace)
    ...[-120, 0, 120].map((w) => ({ u: 1700, w, axis: 0, dir: -1, offs: [1400, 620], least: 1100 })), // (from the road at its nose)
    ...[-120, 120].map((w) => ({ u: -1150, w, axis: 0, dir: 1, offs: [-1050, -650] })), // (the yard behind it)
  ];
  let fastest = 0;
  for (const r of runs) {
    const yaw = r.axis ? heading(0, r.dir) : heading(r.dir, 0);
    for (let from = r.offs[0]; r.dir * (r.offs[1] - from) >= 0; from += r.dir * 50) {
      const h = start(r.u, r.w, yaw);
      h.rest(1);
      const along = () => local(h.at())[r.axis];
      for (let t = 0; t < 300 && r.dir * (from - along()) > 0; t++) {
        h.tick({ stickY: 1 }, yaw);
        assert.ok(h.at().y < GROUND + 1, `the run-up on the ground: ${JSON.stringify(h.at())}`);
      }
      const speed = h.p.forwardVel;
      if (r.least !== undefined && r.dir * (from - r.least) >= 0) assert.ok(speed > 28, `full speed by ${from}: ${speed}`);
      fastest = Math.max(fastest, speed);
      let grab = null;
      for (let t = 0; t < 120; t++) {
        h.tick({ stickY: 1, A: true }, yaw);
        if (!grab && /ledge/.test(h.p.action)) grab = h.at();
      }
      assert.ok(!grab && h.at().y < roof - 100, `running single from ${from} on (${r.u}, ${r.w}): no grab, not on its roof ${JSON.stringify(grab ?? h.at())}`);
    }
  }
  assert.ok(fastest > 31, `full speed reached: ${fastest}`);
  // From north_1's terrace beside its back half: a standing single jump grabs its roof's edge.
  const t = start(-250, -320, heading(0, 1));
  assert.equal(t.at().y, TERRACE, 'on the terrace');
  t.rest(1);
  let hung = false;
  t.tick({ stickY: 1 }, heading(0, 1));
  for (let k = 0; k < 90 && !hung; k++) {
    t.tick({ stickY: 1, A: true }, heading(0, 1));
    hung = /ledge/.test(t.p.action);
  }
  assert.ok(hung, `from the terrace: a grab of its roof's edge ${JSON.stringify(t.at())}`);
  // A running double jump from the drive beside it lands on its roof; along its roof, its coins.
  const yaw = heading(0, -1);
  const h = start(100, 1060, yaw);
  h.rest(1);
  jump(h, yaw, { after: 0 });
  jump(h, yaw, { after: 0 });
  h.rest(30);
  assert.ok(Math.abs(h.at().y - roof) < 1, `double: on its roof ${JSON.stringify(h.at())}`);
  h.walk([at(-360, 0), at(360, 0)], 0.4);
  assert.equal(h.coins(), 3, "the motorhome's roof");
});

test('the junction: round the lamppost (three coins) and up it to a handstand on its top', () => {
  const L1 = lane.POLES[0];
  const h = hero(L1.x - 250, GROUND, L1.z - 300, S);
  h.walk([[L1.x - 250, L1.z], [L1.x + 125, L1.z + 217], [L1.x + 125, L1.z - 217]], 0.6);
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
  const Z = lane.ROAD.line.at(-1)[1];
  const st = hero(300, 0, Z, E);
  st.walk([[2200, Z]]);
  assert.equal(st.coins(), 3, 'the street east');
  // Round the coins' ring on the apron.
  const R = lane.APRON.ring;
  const ring = hero(R.x, 0, R.z + R.r, E);
  const pts = Array.from({ length: 29 }, (_, k) => {
    const a = ((k + 0.5) / 28) * Math.PI * 2;
    return [R.x + R.r * Math.sin(a), R.z + R.r * Math.cos(a)];
  });
  ring.walk(pts, 0.5);
  assert.equal(ring.coins(), 7, 'the turning area');
  // Up north_4's drive west of the van, from the pavement to its garage door.
  const x = lane.PLOTS_N[3].drive[0] + 220;
  const z0 = lane.wallZAt(x) + 100;
  const d = hero(x, lane.groundHeight(x, z0), z0, N);
  d.walk([[x, -1700]], 0.5);
  assert.equal(d.coins(), 3, "north_4's drive");
  const f = lane.footpathAt(100);
  const g = lane.footpathAt(900);
  const p = hero(f.x, GROUND, f.z, S);
  p.walk([[g.x, g.z]], 0.6);
  assert.equal(p.coins(), 1, 'the footpath');
});

test("the hedge walk: a single jump from the lawn up onto south_1's hedge (190 high), and along its top (three coins)", () => {
  const H = lane.HEDGES[0];
  // (W5: the photos' informal hedge is ~225 tall: its walkable top kept at 190, a single jump's
  // reach, its ragged sprigs drawn over it.)
  assert.equal(H.top - GROUND, 190);
  // (W2: its street side is the road's south edge, a step down: up from the lawn behind it.)
  const h = hero(H.x0 + 440, GROUND, H.z1 + 120, N);
  jump(h, N, { push: 0.5, after: 4 }); // (a gentler push: the hedge is 130 deep, the road behind it)
  assert.ok(Math.abs(h.at().y - H.top) < 1 && h.p.grounded, `on the hedge: ${JSON.stringify(h.at())}`);
  h.walk([[H.x0 + 440, (H.z0 + H.z1) / 2], [H.x1 - 670, (H.z0 + H.z1) / 2]], 0.4, 1400); // (W5: it runs on west past south_1: a longer walk)
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
  // A running triple jump on the terrace (up the side yard west of it) peaks short of it.
  const tj = hero(T.x - 600, TERRACE, T.z + 600, N);
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

test("the dad's cars (W4: parked deep against the garage row, the SUV nose in): from the drive a hop onto the blue car's bonnet, another onto its roof and one more from there onto the row's roof; onto the SUV's roof from its tail and from its front end up onto the row's roof (by its edge: ways up besides the bins)", () => {
  const [ev, suv] = lane.CARS.slice(0, 2);
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
  assert.ok(Math.abs(h.at().y - lane.CARPORT.top) < 1 && h.at().z > lane.CARPORT.z0, `on the row's roof: ${JSON.stringify(h.at())}`);
  // The SUV, nose in: its boot toward the street.
  const Q = lane.CAR_KINDS[suv.kind];
  const rear = suv.z - Q.l / 2;
  const s = hero(suv.x, GROUND, rear - 180, S);
  s.rest(2);
  // (Its boot is short: the hop lands on its roof, or on the boot and one more onto the roof.)
  jump(s, S, { after: 0 });
  s.rest();
  if (Math.abs(s.at().y - GROUND - Q.belt) < 1) {
    jump(s, S, { push: 0.6, after: 0 });
    s.rest();
  }
  assert.ok(Math.abs(s.at().y - GROUND - Q.roof) < 1 && s.p.grounded, `on its roof: ${JSON.stringify(s.at())}`);
  // From its roof's front end a jump at the row's edge (onto its bonnet first if short), its
  // ledge grabbed and climbed.
  s.walk([[suv.x, suv.z + Q.l / 2 - Q.hood - Q.screen - 20]], 0.4);
  s.rest(10);
  for (let k = 0; k < 3 && !(Math.abs(s.at().y - lane.CARPORT.top) < 1 && s.p.grounded); k++) {
    for (let t = 0; t < 60 && s.p.action !== 'ledge_hang' && !(s.p.grounded && t > 2); t++) s.tick({ stickY: 1, A: t < 15 }, S);
    if (s.p.action === 'ledge_hang') {
      s.rest(6);
      s.tick({ A: true }, S);
    }
    s.rest(40);
  }
  assert.ok(Math.abs(s.at().y - lane.CARPORT.top) < 1 && s.at().z > lane.CARPORT.z0, `on the row's roof from the SUV: ${JSON.stringify(s.at())}`);
});

test('D1, the garage: from the street up the gap between the cars to the red door, B, B smashes it, in round the dad\'s car\'s tail to the room\'s five coins and its 1-up, and out between the cars again; a ground pound in the gap smashes the red door and the double doors\' west leaf', async () => {
  const chunk = await import('../src/objects/laneBoss/index.js');
  // (W4: the cars parked deep, CAR_GAP 110 off the doors: the gap between them faces the red door's
  // east part and its strip; he goes in round the dad's car's tail.)
  const G = lane.GARAGE;
  const [ev, suv] = lane.CARS.slice(0, 2);
  const hw = (c) => lane.CAR_KINDS[c.kind].w / 2;
  const R4 = PLAYER_RADIUS + 4;
  const [gx0, gx1] = [ev.x + hw(ev) + R4, suv.x - hw(suv) - R4];
  const red = G.leaves[1];
  const inX = red.x1 - R4 - 2;
  const row = G.wall + 300;
  const h = hero(gx0, 0, 300, S);
  h.om.attachLane(chunk, area);
  h.om.laneBoss.armed = false;
  const g = h.om.garage;
  try {
    h.walk([[gx0, 1300], [gx0, G.wall - 55]], 0.6);
    h.rest(5);
    for (let t = 0; t < 14; t++) h.tick({ B: t === 0 || t === 6 }, S);
    assert.ok(g.leaves[1].broken, 'the red door smashed');
    h.walk([[inX, G.wall - 10], [inX, row], [1760, row], [2420, row], [ROOM.oneUp.x, ROOM.oneUp.z - 115]], 0.6);
    h.walk([[ROOM.oneUp.x, ROOM.oneUp.z - 25]], 0.4, 30);
    assert.equal(h.coins(), 5, 'the room\'s five coins');
    assert.equal(h.log.filter((e) => e.name === 'oneUp').length, 1, 'its 1-up');
    h.walk([[inX, row], [inX, G.wall - 10], [gx0, G.wall - 55], [gx0, 1300], [gx0, 300]], 0.6);
    assert.ok(h.at().z < 400, `out to the street: ${JSON.stringify(h.at())}`);
    assert.equal(h.coins(), 5);
    // One pound in the gap: the red door and the double doors' west leaf.
    g.enter({ pos: { x: 1e7, y: 0, z: 1e7 } });
    h.p.teleport((gx0 + gx1) / 2 + O.x, GROUND + O.y, G.wall - 55 + O.z, S);
    h.p.setAction('idle');
    h.rest(3);
    for (let t = 0; t < 50; t++) h.tick({ A: t < 9, Z: t === 9 }, S);
    assert.ok(g.leaves[1].broken && g.leaves[2].broken, 'both leaves');
  } finally {
    g.enter({ pos: { x: 1e7, y: 0, z: 1e7 } });
  }
});

test('the side yards (W7 fix): walked up each yard\'s line (the side-yards walk\'s, on the plots\' edges) from the terrace to the back gardens and back, nothing in the way: he never strays off it, the yards\' forest trees\' trunks stand well clear of it', () => {
  const { broad, pines } = forestSpots(lane);
  const trunks = [...broad, ...pines].filter((s) => s.solid);
  assert.equal(trunks.length, lane.FOREST.yards.length);
  for (const x of lane.PLOTS_N.slice(0, 4).map((pl) => pl.x1)) {
    // (Jonas's radius 50 and a trunk's 40, with room for the follow camera behind him.)
    for (const t of trunks) assert.ok(Math.abs(t.x - x) >= 150, `the yard's tree at ${t.x}, ${t.z} ${Math.abs(t.x - x)} off the line at ${x}`);
    const z0 = lane.wallZAt(x) - 200;
    const back = lane.flatZAt(x) + 120;
    const h = hero(x, TERRACE, z0, N);
    let [drift, ticks] = [0, 0];
    for (const tz of [back, z0]) {
      for (let t = 0; t < 400 && Math.abs(h.at().z - tz) > 60; t++, ticks++) {
        h.tick({ stickY: 1 }, Math.atan2(x - h.at().x, tz - h.at().z));
        drift = Math.max(drift, Math.abs(h.at().x - x));
      }
      assert.ok(Math.abs(h.at().z - tz) <= 60, `yard ${x}: got to ${Math.round(h.at().z)} of ${Math.round(tz)}`);
    }
    assert.ok(drift < 1, `yard ${x}: ${drift.toFixed(1)} off the line (${ticks} ticks)`);
  }
});

test('the pavement (W7): walked along it from north_1 to the turning area past the lampposts (735 tall now), their cabinets and posts and the bins out for collection, each of those solid; the side yards\' trees\' trunks solid, off the side yards\' coins', () => {
  // (A Jonas in from the kerb: the bins stand 100 out from the wall.)
  const Z = lane.ROAD.line.at(-1)[1] - lane.PAVEMENT.from - 80;
  const h = hero(-6400, GROUND, Z, E);
  h.walk([[4300, Z]], 1, 3000);
  assert.ok(h.at().x > 4200 && Math.abs(h.at().z - Z) < 60, `along it to ${Math.round(h.at().x)}, ${Math.round(h.at().z)}`);
  const col = area.collision;
  const hits = (x, y, z, dir, d) => col.raycast({ x: x + O.x, y: y + O.y, z: z + O.z }, dir, d, { floors: false, ceilings: false });
  // (From the street side at knee height, toward the wall: each meets its box.)
  for (const k of kerbside(lane)) assert.ok(hits(k.x, GROUND + 40, k.z + 120, { x: 0, y: 0, z: -1 }, 120), `the ${k.kind} by ${k.lamp} solid`);
  for (const b of lane.VILLA_BINS.filter((v) => v.yaw === 0)) assert.ok(hits(b.x, GROUND + 40, b.z + 120, { x: 0, y: 0, z: -1 }, 120), `the bin at ${b.x} solid`);
  const { broad, pines } = forestSpots(lane);
  for (const t of [...broad, ...pines].filter((s) => s.solid)) {
    assert.ok(hits(t.x - 150, TERRACE + 60, t.z, { x: 1, y: 0, z: 0 }, 150), `the side yard's tree at ${t.x}, ${t.z} solid`);
    for (const c of lane.COINS) assert.ok(Math.hypot(c.x - t.x, c.z - t.z) > 200, `the tree at ${t.x}, ${t.z} off the coin at ${c.x}, ${c.z}`);
  }
});
