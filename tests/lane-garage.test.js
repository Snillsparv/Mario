// D1: Sparrow Lane's garage doors, kicked to pieces (objects/laneBoss/LaneGarage.js, the lane's
// lazy chunk attached by hand: om.attachLane(chunk, area); the door wall, the leaves and the store
// room's colliders built by the main chunk: world/lane/houses.js carport, layout.GARAGE), with the
// real Player on the real course: the layout (the wall tiled west to east, the red door between
// the cars from the drive, the coins and the 1-up inside, the bins and STOMPWATT short of the
// wall), the colliders (each leaf named, parked when smashed, back exactly), the piece table in
// both looks (the same pieces, the blank sign), every attack on every leaf (the jab cracks, the
// cross and everything else smash), the smash (its sound, splinters, the camera's kick, the room
// opened), the boards (thrown away from him, kept in the room or the strip, lying flat, gone; both
// looks written alike, deterministic), walking in (the coins, the 1-up once) and never through a
// shut door, coming back (an arrival, a lost life, a new game; never shutting him in), STOMPWATT
// (its slams rattle the doors, the room out of its reach, its fight hiding the 1-up outside), the
// room camera, the sounds and the hot paths' guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { buildLane } from '../src/world/lane/build.js';
import { ROOM, roomLight } from '../src/world/lane/garage.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { PLAYER_RADIUS } from '../src/core/constants.js';
import { SFX, SFX_INFO } from '../src/audio/sfx.js';
import * as chunk from '../src/objects/laneBoss/index.js';
import { LaneGarage, HP, GAP, LIE, SHRINK, PARK } from '../src/objects/laneBoss/LaneGarage.js';
import { GarageCam, laneOverlay } from '../src/objects/laneBoss/garageCam.js';
import { ROBOT_SFX } from '../src/objects/laneBoss/audio.js';
import { CameraController } from '../src/camera/CameraController.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const col = area.collision;
const { GROUND, GARAGE: G, CARPORT: C } = lane;
const classic = area.parts.find((p) => p.garage);
const real = buildLane(lane, { look: 'real', materials: {} });
const FAR = { pos: { x: 1e7, y: 0, z: 1e7 } };
const S = 0;
const N = Math.PI;
const E = Math.PI / 2;
const mid = (l) => (l.x0 + l.x1) / 2;

// Jonas at a local point with the lane's objects and the chunk attached (the boss unarmed unless
// `armed`); the last test's doors mended first (they share the area's collision world).
let last = null;
function hero(x, z, yaw = S, { y = GROUND, armed = false } = {}) {
  if (last) {
    // (Its leaves mended and every look it wrote put back at rest.)
    last.enter(FAR);
    for (const look of last.looks) {
      last.shown = look;
      last.animate(1);
    }
  }
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'oneUp', 'bossImpact']) events.on(name, (e) => log.push({ name, ...e }));
  const sounds = [];
  events.on('sfx', (e) => sounds.push(e.name));
  const p = new Player({ collision: col, events, spawn: area.respawn, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'lane' });
  om.attachLane(chunk, area);
  if (!armed) om.laneBoss.armed = false;
  last = om.garage;
  const ctl = new ScriptedController();
  let frame = 0;
  const h = { p, om, g: om.garage, log, sounds, events, ctl };
  h.tick = (input = {}, camYaw = 0) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
    om.animate(++frame / 30, 1, null);
  };
  h.run = (n, input = {}) => {
    for (let i = 0; i < n; i++) h.tick(typeof input === 'function' ? input(i) : input);
  };
  h.at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  h.put = (px, pz, pyaw = S, py = GROUND) => {
    p.teleport(px + O.x, py + O.y, pz + O.z, pyaw);
    p.setAction('idle');
  };
  h.coins = () => log.filter((e) => e.name === 'coin').length;
  h.state = () => h.g.leaves.map((l) => (l.broken ? 'X' : l.hp)).join('');
  return h;
}

// Every query in and round a doorway (the leaf's box widened by `m`), as numbers.
function queries(l, m = 150) {
  const out = [];
  for (let x = l.x0 - m; x <= l.x1 + m; x += 25) {
    for (let z = G.wall - 120; z <= G.wall + 140; z += 20) {
      const [px, pz] = [x + O.x, z + O.z];
      for (const y of [GROUND + 40, GROUND + 140]) {
        const w = col.findWalls(px, y + O.y, pz, 0, PLAYER_RADIUS);
        out.push(Math.round(w.x * 1000), Math.round(w.z * 1000), w.walls.length);
      }
      out.push(col.findFloor(px, 300 + O.y, pz).y, col.findCeil(px, GROUND + 50 + O.y, pz).y);
    }
  }
  return out.join(',');
}
const REST = G.leaves.map((l) => queries(l));
const REST_IN = G.leaves.map((l) => queries(l, -60));

// A stub attack sphere of `kind` at (x, y, z) (local), for the kinds a test cannot easily do.
const stub = (kind, x, y, z, radius = 90) => ({ pos: { x: x + O.x, y: GROUND + O.y, z: z - 80 + O.z }, action: 'idle', getAttack: () => ({ x: x + O.x, y: y + O.y, z: z + O.z, radius, kind }) });

test('the layout: the door wall tiles the carport\'s front west to east under the deep fascia; four leaves 140 .. 150 wide and 280 high under a 43 lintel; the red door between the cars from the drive; the coins and the 1-up inside, clear of the props; the bins and STOMPWATT short of the wall', () => {
  const spans = [...G.fixed.map(([x0, x1]) => [x0, x1]), ...G.leaves.map((l) => [l.x0, l.x1])].sort((a, b) => a[0] - b[0]);
  assert.equal(spans[0][0], C.x0);
  assert.equal(spans.at(-1)[1], C.x1);
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i][0], spans[i - 1][1], `no gap or overlap at ${spans[i][0]}`);
  for (const l of G.leaves) assert.ok(l.x1 - l.x0 >= 140 && l.x1 - l.x0 <= 150, `a leaf ${l.x1 - l.x0} wide`);
  assert.equal(G.door - GROUND, 280);
  assert.equal(G.under - G.door, 43);
  assert.ok(G.fascia > G.door - 30 && G.fascia < G.under, 'the fascia hangs to about the doors\' top');
  // From the drive's mouth (photo 37's camera), the gap between the cars falls on the red door.
  const [ev, suv] = lane.CARS.slice(0, 2);
  const half = (c) => lane.CAR_KINDS[c.kind].w / 2;
  const rear = ev.z + lane.CAR_KINDS[ev.kind].l / 2;
  const cam = { x: 2120, z: 220 };
  const onWall = (x) => cam.x + ((x - cam.x) * (G.wall - cam.z)) / (rear - cam.z);
  const red = G.leaves.find((l) => l.tint === 1);
  assert.ok(onWall(ev.x + half(ev)) >= red.x0 && onWall(suv.x - half(suv)) <= red.x1 + 40, `the gap ${onWall(ev.x + half(ev)).toFixed(0)} .. ${onWall(suv.x - half(suv)).toFixed(0)} on the red door ${red.x0} .. ${red.x1} and its strip`);
  // The room's five coins and its 1-up: inside, never in reach through a wall, clear of the props.
  const inRoom = lane.COINS.filter((c) => c.x > C.x0 && c.x < C.x1 && c.z > G.wall && c.z < C.z1 && c.y < G.door);
  assert.equal(inRoom.length, 5);
  for (const p of [...inRoom, ROOM.oneUp]) {
    assert.ok(p.z - G.wall >= 175 && C.z1 - p.z >= 60, `(${p.x}, ${p.z}): 175 inside the doors' face, clear of the back garden`);
    if (p !== ROOM.oneUp) for (const [x0, x1, z0, z1] of G.props) assert.ok(p.x < x0 - 60 || p.x > x1 + 60 || p.z < z0 - 60 || p.z > z1 + 60, `coin (${p.x}, ${p.z}) clear of a prop`);
  }
  assert.ok(lane.BIN_LEASH.z1 + lane.BIN.z / 2 <= G.wall - 110, 'a bin\'s back 110 short of the wall');
  for (const [, , , z1] of lane.LANE_BOSS.walk) assert.ok(z1 <= G.wall - 290, 'STOMPWATT\'s walking ground 290 short of the wall');
  assert.equal(ROOM.props.length, G.props.length);
});

test('the colliders: each leaf named (eight wall triangles), a wall in each doorway while whole, none once smashed (its neighbours stay), back exactly when mended; walls only (no floor in the wall, the fascia or a prop; a ceiling at 302 in each doorway, 345 in the room)', () => {
  const h = hero(-500, 900, S);
  G.leaves.forEach((l, k) => {
    assert.equal(area.named[`garage_${k}`].surfaces.length, 8);
    const at = [mid(l) + O.x, G.wall - 25 + O.z];
    for (const y of [GROUND + 40, GROUND + 140]) assert.ok(col.findWalls(at[0], y + O.y, at[1], 0, PLAYER_RADIUS).walls.length > 0, `leaf ${k}: a wall at ${y}`);
    assert.equal(col.findCeil(at[0], GROUND + 50 + O.y, at[1] + 35).y - O.y, G.door, `leaf ${k}: the lintel over the doorway`);
    h.g._smash(h.g.leaves[k], mid(l) + O.x, 1, 0);
    for (const y of [GROUND + 40, GROUND + 140]) assert.equal(col.findWalls(at[0], y + O.y, at[1], 0, PLAYER_RADIUS).walls.length, 0, `leaf ${k} smashed: no wall`);
    G.leaves.forEach((m, j) => j !== k && assert.equal(queries(m, -60), REST_IN[j], `leaf ${j} untouched`));
    h.g._mend(h.g.leaves[k]);
    assert.equal(queries(l), REST[k], `leaf ${k} back exactly`);
  });
  // No floor anywhere in the wall's, the fascia's or a prop's footprint over the ground; the room
  // 323 high.
  const spots = [[1650, 1960], [2000, 1955], [2400, 1798], [1800, 1798], ...G.props.map(([x0, x1, z0, z1]) => [(x0 + x1) / 2, (z0 + z1) / 2])];
  for (const [x, z] of spots) assert.equal(col.findFloor(x + O.x, 200 + O.y, z + O.z).y - O.y, GROUND, `(${x}, ${z}): only the ground`);
  assert.equal(col.findCeil(2050 + O.x, GROUND + 50 + O.y, 2300 + O.z).y - O.y, G.under);
});

test('the piece table in both looks: five boards a leaf, each a lane-boards range and the hardware a paint range (lane-render classic, lane-paint realistic), alike in both; every vertex inside its leaf\'s opening; the sign two plain boxes on the east double door', () => {
  const count = (part, name) => part.object3D.getObjectByName(name).geometry.attributes.position.count;
  for (const [part, paint] of [[classic, 'lane-render'], [real, 'lane-paint']]) {
    const P = part.garage.pieces;
    assert.equal(P.length, 20);
    P.forEach((p, i) => {
      assert.equal(p.leaf, Math.floor(i / 5));
      assert.equal(p.parts[0].b, 'boards');
      for (const q of p.parts) assert.ok(q.start + q.count <= count(part, q.b === 'boards' ? 'lane-boards' : paint));
    });
  }
  // The same pieces in both looks (their ranges each look's own: the realistic look draws less
  // into its builders before them).
  const shape = (part) => JSON.stringify(part.garage.pieces.map((p) => [p.leaf, p.at, p.parts.map((q) => [q.b, q.count])]));
  assert.equal(shape(classic), shape(real));
  // Inside the opening (the hardware a little proud of it; the sign overhangs the next board).
  const pos = classic.object3D.getObjectByName('lane-boards').geometry.attributes.position;
  const paint = classic.object3D.getObjectByName('lane-render').geometry.attributes.position;
  for (const p of classic.garage.pieces) {
    const l = G.leaves[p.leaf];
    for (const q of p.parts) {
      const a = q.b === 'boards' ? pos : paint;
      for (let v = q.start; v < q.start + q.count; v++) {
        assert.ok(a.getX(v) >= l.x0 - 1 && a.getX(v) <= l.x1 + 1 && a.getY(v) >= GROUND && a.getY(v) <= G.door && a.getZ(v) >= G.wall - 7 && a.getZ(v) <= G.wall + 10, `leaf ${p.leaf}: a vertex at ${a.getX(v)}, ${a.getY(v)}, ${a.getZ(v)}`);
      }
    }
  }
  // The hardware: straps on the hinge side's board, a handle on three leaves, the sign: two boxes.
  const hw = classic.garage.pieces.map((p) => p.parts[1]?.count ?? 0);
  assert.deepEqual(hw, [72, 0, 0, 0, 36, 36, 0, 0, 0, 72, 72, 0, 0, 0, 0, 36, 0, 0, 0, 144]);
});

// The attacks, each a script from in front of a leaf (local x, z); the leaf's state after.
const ATTACKS = {
  jab: (h) => h.run(14, (i) => ({ B: i === 0 })),
  'jab and cross': (h) => h.run(14, (i) => ({ B: i === 0 || i === 6 })),
  combo: (h) => h.run(30, (i) => ({ B: i % 7 === 0 && i < 21 })),
  'jump kick': (h) => h.run(34, (i) => ({ A: i < 4, B: i === 4 })),
  pound: (h) => h.run(50, (i) => ({ A: i < 9, Z: i === 9 })),
};

test('every attack on every leaf from the strip behind the cars: the jab cracks it (it rattles, its board askew, splinters, a crack), the cross smashes it, the combo, a jump kick and a ground pound smash it at once; a pound at the double doors\' middle smashes both', () => {
  G.leaves.forEach((l, k) => {
    for (const [name, script] of Object.entries(ATTACKS)) {
      const h = hero(mid(l), G.wall - 95, S);
      h.tick();
      script(h);
      const leaf = h.g.leaves[k];
      if (name === 'jab') {
        assert.equal(leaf.hp, HP - 1, `leaf ${k}: the jab cracks it`);
        assert.ok(h.sounds.includes('door_crack') && !h.sounds.includes('door_smash'));
        assert.ok(leaf.askew >= k * 5 && leaf.askew < k * 5 + 5, 'a board askew');
        const q = h.g.pieces[leaf.askew];
        assert.ok(q.z < -5 && Math.abs(q.q.x) > 0.02, 'leaning out toward him');
      } else {
        assert.ok(leaf.broken, `leaf ${k}: ${name} smashes it (${h.state()})`);
        assert.ok(h.sounds.includes('door_smash'));
      }
    }
  });
  const h = hero(2330, G.wall - 90, S);
  h.tick();
  ATTACKS.pound(h);
  assert.equal(h.state().slice(2), 'XX', 'both double doors');
});

test('a dive through the gap between the cars smashes the red door (and he slides into the room); diving earlier, its belly slide does; flying and the cannon\'s shot (stubbed) smash at once; one hit a leaf per GAP ticks; walking or pushing into a door does nothing', () => {
  const red = G.leaves.findIndex((l) => l.tint === 1);
  const x = 2099;
  for (const [diveZ, kind] of [[1650, 'dive'], [1300, 'belly_slide']]) {
    const h = hero(x, 300, S);
    while (h.at().z < diveZ) h.tick({ stickY: 1 });
    assert.ok(h.p.forwardVel >= 29, 'at full speed');
    h.tick({ stickY: 1, B: true });
    let by = null;
    for (let i = 0; i < 40 && !by; i++) {
      h.tick({ stickY: 1 });
      if (h.g.leaves[red].broken) by = h.p.getAttack()?.kind ?? h.p.action;
    }
    assert.equal(by, kind, `${kind}: smashed (${h.state()})`);
    h.run(30, { stickY: 1 });
    assert.ok(h.at().z > G.wall + 100, `on into the room: ${h.at().z.toFixed(0)}`);
  }
  for (const kind of ['flying', 'cannon_shot']) {
    const h = hero(-500, 900, S);
    const l = h.g.leaves[0];
    h.g.update(stub(kind, mid(G.leaves[0]), 150, G.wall - 40), 1);
    assert.ok(l.broken, kind);
  }
  // One hit per GAP: two jabs 3 ticks apart take one point.
  const h = hero(-500, 900, S);
  const l = h.g.leaves[3];
  for (let t = 0; t < 4; t++) h.g.update(stub('punch1', mid(G.leaves[3]), 100, G.wall - 30, 55), t);
  assert.equal(l.hp, HP - 1);
  for (let t = 4; t < GAP + 1; t++) h.g.update(FAR_PLAYER, t);
  h.g.update(stub('punch2', mid(G.leaves[3]), 100, G.wall - 30, 55), GAP + 1);
  assert.ok(l.broken, 'the cross after the gap');
  // Walking into a door (and pushing on it): nothing.
  const w = hero(mid(G.leaves[2]), G.wall - 200, S);
  w.run(60, { stickY: 1 });
  assert.equal(w.state(), '2222');
  assert.ok(w.at().z < G.wall - PLAYER_RADIUS + 1, 'held at the door');
});
const FAR_PLAYER = { pos: FAR.pos, action: 'idle', getAttack: () => null };

test('the smash: its collider parked, a crunch at the leaf, splinters, a small camera kick, the room opened (its classic mesh and the 1-up shown); the boards thrown into the room from the drive, out into the strip from inside, kept in their boxes, lying flat, then gone', () => {
  const h = hero(mid(G.leaves[1]), G.wall - 95, S);
  h.tick();
  const before = h.om.sparkles.count;
  ATTACKS['jump kick'](h);
  const l = h.g.leaves[1];
  assert.ok(l.broken);
  assert.ok(Math.abs(l.surfaces[0].a[1] - O.y - PARK) < 400, 'parked under the world');
  assert.ok(h.log.some((e) => e.name === 'bossImpact' && e.kind === 'door' && e.strength === 0.15));
  assert.ok(h.om.sparkles.count > before, 'splinters');
  assert.ok(h.g.opened && h.g.roomMesh.visible);
  h.tick();
  assert.ok(h.g.gem.mesh.visible, 'the 1-up shown');
  // Thrown in from the drive: every board's middle in the room's box, lying flat soon, gone after.
  const P = h.g.pieces.slice(5, 10);
  for (let t = 0; t < 200; t++) {
    h.tick();
    for (const p of P) {
      const z = p.at[2] + p.z;
      if (p.state === 1) assert.ok(z >= G.wall - 10 && z <= C.z1 - 20, `in the room: ${z}`);
      if (p.state === 2 && p.t > 10) {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.q);
        assert.ok(Math.abs(up.y) < 0.2, 'lying flat');
        assert.ok(Math.abs(p.at[1] + p.y - GROUND - 6) < 8, 'on the floor');
      }
    }
  }
  assert.ok(P.every((p) => p.state === 4 && p.s === 0), 'all gone');
  // From inside: out into the strip.
  const g = hero(mid(G.leaves[0]), G.wall + 110, N);
  g.g._smash(g.g.leaves[0], mid(G.leaves[0]) + O.x, -1, 0);
  g.run(30);
  for (const p of g.g.pieces.slice(0, 5)) assert.ok(p.at[2] + p.z < G.wall + 12 && p.at[2] + p.z >= 1770, `out into the strip: ${p.at[2] + p.z}`);
});

test('both looks\' boards written alike (a look shown later gets them as they stand); deterministic', () => {
  // (Each run checked before the next: the garages of one area share its meshes.)
  const pose = (h) => h.g.pieces.map((p) => [p.x, p.y, p.z, p.q.x, p.q.w].map((v) => v.toFixed(3)).join()).join('|');
  const poses = [];
  for (const when of ['mid', 'end']) {
    const h = hero(mid(G.leaves[2]), G.wall - 95, S);
    h.tick();
    ATTACKS['jump kick'](h);
    if (when === 'mid') h.om.setLook(real);
    h.run(6);
    if (when === 'end') h.om.setLook(real);
    h.om.animate(1, 1, null);
    poses.push(pose(h));
    // The realistic meshes as shown, against the classic's written once the classic is shown.
    const look = h.g.looks.find((l) => l.part === real);
    const shown = look.parts.map((q) => Array.from(look.meshes[q.m].pos.array.slice(q.start * 3, (q.start + q.count) * 3)));
    h.om.setLook(null);
    h.om.animate(1, 1, null);
    h.g.classic.parts.forEach((q, k) => {
      assert.equal(q.i, look.parts[k].i);
      const P = h.g.classic.meshes[q.m].pos.array;
      for (let v = 0; v < q.count * 3; v++) assert.ok(Math.abs(P[q.start * 3 + v] - shown[k][v]) < 0.01, `${when}: piece ${q.i} alike in both looks`);
    });
  }
  assert.equal(poses[0], poses[1], 'deterministic');
});

test('walking in through each doorway (the coin on his way), the five coins along the row and the 1-up from in front of the bench (once a game); with the doors shut nothing is taken from the strip or the back garden', () => {
  G.leaves.forEach((l, k) => {
    const h = hero(mid(l), G.wall - 95, S);
    h.tick();
    ATTACKS['jump kick'](h);
    h.run(40, { stickY: 1 });
    assert.ok(h.at().z > 2250, `leaf ${k}: in to ${h.at().z.toFixed(0)}`);
    assert.ok(h.g.in);
  });
  // The row and the 1-up.
  const h = hero(1800, G.wall - 95, S);
  h.tick();
  ATTACKS['jump kick'](h);
  while (h.at().z < 2230) h.tick({ stickY: 1 });
  h.run(15);
  h.run(60, { stickX: -1 });
  assert.equal(h.coins(), 5, `the room's five coins (${h.coins()})`);
  h.put(2090, 2400, S);
  h.run(20, { stickY: 1 });
  assert.equal(h.log.filter((e) => e.name === 'oneUp').length, 1, 'the 1-up');
  assert.equal(h.g.gem.alive, false);
  h.om.enter(h.p);
  h.put(1800, 1600);
  h.tick();
  assert.equal(h.g.gem.mesh.visible, false, 'gone for the game');
  // Shut: along the strip and along the back garden, nothing.
  const s = hero(1660, 1890, E);
  s.run(70, { stickX: -1 });
  const b = hero(1660, 2710, E);
  b.run(70, { stickX: -1 });
  for (const x of [s, b]) {
    assert.equal(x.coins(), 0);
    assert.equal(x.log.filter((e) => e.name === 'oneUp').length, 0);
    assert.ok(x.at().x > 2300, `walked along: ${x.at().x.toFixed(0)}`);
  }
});

test('coming back: an arrival, a lost life and a new game make every leaf whole (colliders exact, boards home and straight, the room closed); one he stands in waits until he is out; the 1-up back only on a new game', () => {
  const h = hero(mid(G.leaves[1]), G.wall - 95, S);
  h.tick();
  ATTACKS.jab(h);
  h.put(mid(G.leaves[0]), G.wall - 95);
  h.tick();
  ATTACKS['jump kick'](h);
  h.run(30);
  assert.equal(h.state(), 'X122');
  const away = () => h.put(-500, 900);
  away();
  h.om.enter(h.p);
  assert.equal(h.state(), '2222', 'an arrival');
  assert.ok(h.g.pieces.every((p) => p.state === 0 && p.q.w === 1 && p.x === 0 && p.z === 0), 'boards home and straight');
  assert.equal(queries(G.leaves[0]), REST[0]);
  assert.equal(h.g.roomMesh.visible, false);
  h.g._smash(h.g.leaves[2], mid(G.leaves[2]) + O.x, 1, 0);
  h.p.loseLife();
  h.run(2);
  assert.equal(h.state(), '2222', 'a lost life');
  h.g._smash(h.g.leaves[3], mid(G.leaves[3]) + O.x, 1, 0);
  h.g.gem.collect();
  h.om.reset();
  assert.equal(h.state(), '2222', 'a new game');
  assert.equal(h.g.gem.alive, true);
  // In the room (or by the door) on an arrival: that leaf waits until he is clear.
  h.g._smash(h.g.leaves[1], mid(G.leaves[1]) + O.x, 1, 0);
  h.put(2085, 2300);
  h.om.enter(h.p);
  assert.ok(h.g.leaves[1].pending && h.g.leaves[1].broken);
  h.run(3);
  assert.ok(h.g.leaves[1].broken, 'still open while he is in');
  h.put(2085, 1500);
  h.tick();
  assert.equal(h.state(), '2222', 'mended once he is out');
});

test('never shut in: from inside every door breaks (the boards fly out), the room\'s middle is free of colliders, and with both bins at their leash\'s edge in front of the broken door he walks out', () => {
  G.leaves.forEach((l, k) => {
    const h = hero(mid(l), G.wall + 115, N);
    h.tick();
    ATTACKS['jump kick'](h);
    assert.ok(h.g.leaves[k].broken, `leaf ${k} from inside`);
    assert.ok(h.g.pieces.slice(k * 5, k * 5 + 5).every((p) => p.vz <= 0 || p.state !== 1), 'out');
  });
  for (let x = 1720; x <= 2340; x += 40) for (let z = 2030; z <= 2320; z += 40) assert.equal(col.findWalls(x + O.x, GROUND + 60 + O.y, z + O.z, 0, PLAYER_RADIUS).walls.length, 0, `free at ${x}, ${z}`);
  const h = hero(2085, 2300, N);
  h.g._smash(h.g.leaves[1], mid(G.leaves[1]) + O.x, -1, 0);
  const L = lane.BIN_LEASH;
  h.om.bins._moveTo(h.om.bins.list[0], 2030 + O.x, L.z1 + O.z);
  h.om.bins._moveTo(h.om.bins.list[1], 2150 + O.x, L.z1 + O.z);
  h.run(40, { stickY: -1 });
  h.run(30, { stickX: 1 });
  assert.ok(h.at().z < G.wall - 40, `out of the room: ${h.at().z.toFixed(0)}`);
  h.om.bins.sendHome();
});

test('STOMPWATT: its slams rattle the whole doors near them (a rattle sound, no damage); with Jonas in the room it is out of reach (no attack starts); a lost life mid-fight brings the doors back; the 1-up hidden while it fights him outside the room', () => {
  const h = hero(1900, 1000, S, { armed: true });
  const K = h.om.laneBoss;
  for (let i = 0; i < 400 && K.state !== 'stand'; i++) h.tick();
  assert.equal(K.state, 'stand', 'up for the fight');
  h.events.emit('bossImpact', { pos: { x: 2050 + O.x, y: GROUND + O.y, z: 1500 + O.z }, strength: 0.9, kind: 'stomp' });
  assert.ok(h.g.leaves.every((l) => l.rattle > 0 && l.hp === HP), 'rattling, unhurt');
  assert.ok(h.sounds.includes('door_rattle'));
  // The red door smashed, Jonas in the room: nothing starts.
  h.g._smash(h.g.leaves[1], mid(G.leaves[1]) + O.x, 1, 0);
  h.put(2085, 2300);
  const attacks = new Set();
  for (let i = 0; i < 120; i++) {
    h.tick();
    if (/tell|dash|swipe|stomp/.test(K.state)) attacks.add(K.state);
    assert.ok(K.outside, 'out of its reach');
  }
  assert.equal(attacks.size, 0, [...attacks].join());
  assert.ok(h.g.gem.mesh.visible, 'the 1-up shown in the room');
  h.put(2085, 1400);
  h.tick();
  if (K.state !== 'home' && K.state !== 'parked') assert.equal(h.g.gem.mesh.visible, false, 'hidden while it fights him outside');
  h.p.loseLife();
  h.run(2);
  assert.equal(h.state(), '2222', 'a lost life: the doors back');
});

test('the room camera: in through a door (the stick held: he walks on in, never turned round by the cut) it takes over inside the room, high under the slab, never in a solid, his chest in sight; let go and pushed toward the door (in its own frame) he walks out and on, and it hands back', () => {
  const h = hero(mid(G.leaves[1]), G.wall - 95, S);
  h.tick();
  ATTACKS['jump kick'](h);
  const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(55, 16 / 9, 20, 45000), events: h.events });
  cam.overlay = h.om.cameraOverlay;
  cam.reset(h.p);
  // (As main does: the stick in the overlay's held frame, else the camera's.)
  const step = (input) => {
    const c = h.ctl.next(input);
    h.p.update(c, cam.overlay.moveYaw ?? cam.getYaw());
    h.om.update({ player: h.p });
    cam.update(c, h.p);
  };
  const gc = h.g.camera;
  let inTicks = -1;
  for (let i = 0; i < 60 && h.at().z < 2300; i++) {
    step({ stickY: 1 });
    if (gc.w === 1 && inTicks < 0) inTicks = i;
  }
  assert.ok(inTicks >= 0, 'took over');
  assert.ok(h.at().z >= 2300, `walked on in, the stick held: ${h.at().z.toFixed(0)}`);
  assert.ok(gc.moveYaw === null || Math.abs(Math.cos(gc.moveYaw)) > 0.9, 'the stick held in the frame it was pushed in');
  for (let i = 0; i < 40; i++) {
    step({});
    if (gc.w === 1) {
      const p = cam.pos;
      const [x, y, z] = [p.x - O.x, p.y - O.y, p.z - O.z];
      assert.ok(x > C.x0 + 40 && x < C.x1 - 40 && z > G.wall + G.thick + 30 && z < C.z1 - 40 && y < G.under - 30 && y > G.propTop, `in the room at ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`);
      const chest = { x: h.p.pos.x, y: h.p.pos.y + 110, z: h.p.pos.z };
      const d = { x: chest.x - p.x, y: chest.y - p.y, z: chest.z - p.z };
      const len = Math.hypot(d.x, d.y, d.z);
      assert.equal(col.raycast(p, { x: d.x / len, y: d.y / len, z: d.z / len }, len - 20), null, 'his chest in sight');
    }
  }
  assert.equal(gc.w, 1);
  assert.equal(gc.moveYaw, null, 'let go: the camera\'s frame again');
  // Toward the door in the room camera's frame (it looks from the room's far side: "up" is out).
  const toDoor = () => {
    const yaw = Math.atan2(mid(G.leaves[1]) + O.x - h.p.pos.x, 1850 + O.z - h.p.pos.z);
    const a = cam.getYaw() - yaw;
    return { stickX: Math.sin(a), stickY: Math.cos(a) };
  };
  const push = toDoor();
  for (let i = 0; i < 80 && h.at().z > 1700; i++) step(push);
  assert.ok(h.at().z <= 1700, `out and on to the drive, the stick held: ${JSON.stringify(h.at())}`);
  for (let i = 0; i < 10; i++) step({});
  assert.equal(gc.w, 0, 'handed back');
  assert.ok(laneOverlay(null, gc).list.length === 1 && gc instanceof GarageCam);
});

test('spam in the store room (every door broken, jump, crouch and attack, the stick turning, the room camera on): Jonas never inside the wall, a prop or the room\'s walls, never under the floor; the camera never in a wall', () => {
  const h = hero(2050, 2250, S);
  G.leaves.forEach((l, k) => h.g._smash(h.g.leaves[k], mid(l) + O.x, 1, 0));
  const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(55, 16 / 9, 20, 45000), events: h.events });
  cam.overlay = h.om.cameraOverlay;
  cam.reset(h.p);
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const boxes = [...G.fixed.map(([x0, x1]) => [x0, x1, G.wall, G.wall + G.thick]), ...G.props];
  let sx = 0;
  let sy = 1;
  for (let i = 0; i < 600; i++) {
    if (i % 20 === 0) {
      const a = rng() * Math.PI * 2;
      [sx, sy] = [Math.sin(a), Math.cos(a)];
    }
    const c = h.ctl.next({ stickX: sx, stickY: sy, A: rng() < 0.3, Z: rng() < 0.05, B: rng() < 0.05 });
    h.p.update(cam.playerInput(c), cam.getYaw());
    h.om.update({ player: h.p });
    cam.update(c, h.p);
    const q = h.at();
    assert.ok(q.y > GROUND - 2, `tick ${i}: under the floor ${JSON.stringify(q)}`);
    for (const [x0, x1, z0, z1] of boxes) assert.ok(!(q.x > x0 + 5 && q.x < x1 - 5 && q.z > z0 + 5 && q.z < z1 - 5 && q.y < G.propTop), `tick ${i}: inside a solid at ${JSON.stringify(q)}`);
    assert.ok(q.x > C.x0 - 5 && q.x < C.x1 + 5 && q.z < C.z1 - 15, `tick ${i}: through the room's walls ${JSON.stringify(q)}`);
    const k = { x: cam.pos.x - O.x, z: cam.pos.z - O.z };
    for (const [x0, x1, z0, z1] of boxes.slice(0, G.fixed.length)) assert.ok(!(k.x > x0 + 2 && k.x < x1 - 2 && k.z > z0 + 2 && k.z < z1 - 2 && cam.pos.y - O.y < G.under), `tick ${i}: the camera in the door wall`);
  }
});

test('the sounds: door_crack and door_smash registered as the chunk attaches, each renders in a context and reports its length', () => {
  hero(-500, 900, S);
  const ctx = fakeContext();
  for (const name of ['door_crack', 'door_smash']) {
    assert.equal(SFX[name], ROBOT_SFX[name]);
    assert.ok(SFX_INFO[name]);
    const dur = SFX[name](ctx, ctx.createGain(), 1, { p: 1 });
    assert.ok(dur > 0.1 && dur < 1, `${name}: ${dur}`);
  }
});

test('the room\'s light: dim at the back, brighter under the tube and by the doorways', () => {
  assert.ok(roomLight(2050, 100, 2300) > roomLight(1650, 100, 2600), 'the tube\'s pool');
  assert.ok(roomLight(1650, 100, 2000) > roomLight(1650, 100, 2600), 'the doorways\' daylight');
  for (const [x, y, z] of [[1620, 30, 2620], [2050, 300, 2300], [2480, 200, 1980]]) {
    const k = roomLight(x, y, z);
    assert.ok(k >= 0.12 && k <= 1, `${k}`);
  }
});

test('hot paths: idle (nothing moving, no attack) the doors cost no collision query and write nothing; the per-tick and per-frame methods avoid allocating constructs', () => {
  const h = hero(-500, 900, S);
  let n = 0;
  const wrap = ['findFloor', 'findWalls', 'findCeil', 'raycast'].map((k) => [k, col[k]]);
  for (const [k, f] of wrap) col[k] = (...a) => (n++, f.apply(col, a));
  const pos = h.g.classic.meshes[0].pos;
  const v0 = pos.version;
  try {
    for (let t = 0; t < 20; t++) {
      h.g.update(FAR_PLAYER, t);
      h.g.animate(1, t / 30);
    }
  } finally {
    for (const [k] of wrap) delete col[k];
  }
  assert.equal(n, 0, `${n} queries`);
  assert.equal(pos.version, v0, 'nothing written');
  for (const name of ['update', '_hit', '_step', '_fly', '_gem', 'animate', '_write']) {
    const src = LaneGarage.prototype[name].toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /new [A-Z]|\[\.\.\.|=>/, `${name}: no allocation`);
  }
  for (const name of ['update', '_pose', '_blocked']) assert.doesNotMatch(GarageCam.prototype[name].toString(), /new [A-Z]|\[\.\.\.|=>|for \((const|let|var) [^;]* of /, `GarageCam.${name}`);
  h.g.enter(FAR);
});

// A Web Audio stand-in that accepts the recipes' calls (as tests/lane-boss.test.js's).
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect: (d) => d, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {}, gain: param(), frequency: param(), detune: param(), Q: param(), playbackRate: param() });
  return { currentTime: 0, sampleRate: 44100, createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node, createWaveShaper: node, createBuffer: (c, n) => ({ length: n, getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}) };
}
