// Sparrow Lane (world/lane/*), built as the game builds it (world/area.js buildArea at the
// course's origin) with the real Player, CameraController and ObjectManager: its budgets (meshes,
// triangles, colliders, build time; the course's own objects too), the details (the 1-up over the
// trampoline, the butterflies and the birds, the cars parked on the drives, solid and clear of the
// way to the bins, the flags waving without allocating), the arrival out of the dad's
// front door (on the path, facing the street, the camera in front of him over the lawn after the
// walk-in, clear, the star over the ridge in the picture; a lost life's drop onto the path
// unhurt), no water anywhere and a floor everywhere inside the boundary, the boundary holding
// (jump, crouch and attack spam from all over the course, long jumps at full speed off the dad's
// ridge and the junction lamppost's top), the dad's house as measured (its roof's slopes, the
// carport's roof and the room under it) and no floor under a ceiling lower than 300, every coin
// over a floor (exactly 50), the star waiting over the ridge, every sign read from in front only
// (the mailbox is one, with no signpost), the nine climbable poles (every lamppost among them;
// grabbed from every open side with the follow camera, which swings round to the pole's own
// side, climbed to the top; jumping off them never hurts), the side yards between the villas
// walked up and back with the follow camera (never in a solid, seldom trapped) and C-button
// swings there, under the carport and on the roof, the privacy and originality rules in the
// course's sources, and the look (the sun from the south-west, the villas' street faces lit, the
// chain houses' in shade, the dad's walls Falu red under a dark roof, the red-leaf tree a small
// one, its crown in several reds about the house's height). The camera's tests (the arrival, the
// poles, the side yards) run twice: with the classic camera and with the realistic look's (its
// profile, layout.LANE_REAL.camera).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { hipOf, wallDrawnAt } from '../src/world/lane/facades.js';
import { FORECOURT_WALL, GARDEN_THINGS, LINE_HEDGES } from '../src/world/lane/ends.js';
import { redTreeCrown } from '../src/world/lane/real/plan.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { makeRng, wrapAngle } from '../src/core/math.js';
import { CEIL_NONE, NO_WATER } from '../src/core/constants.js';
import { MAX_HEALTH } from '../src/player/physics/tuning.js';

const O = AREA_DEFS.lane.origin;
const t0 = performance.now();
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const buildMs = performance.now() - t0;
const col = area.collision;
const { DAD, GROUND, BOUNDS } = lane;

// Local (course) <-> world coordinates.
const world = (x, y, z) => ({ x: x + O.x, y: y + O.y, z: z + O.z });
const local = (p) => ({ x: p.x - O.x, y: p.y - O.y, z: p.z - O.z });

// Inside the boundary, or within `slack` of it (the camera keeps a little off its walls).
function inside(p, slack = 0) {
  if (lane.inBounds(p.x, p.z)) return true;
  for (let i = 0; i < BOUNDS.length; i++) {
    const [ax, az] = BOUNDS[i];
    const [bx, bz] = BOUNDS[(i + 1) % BOUNDS.length];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / (ex * ex + ez * ez)));
    if (Math.hypot(p.x - ax - ex * t, p.z - az - ez * t) <= slack) return true;
  }
  return false;
}

// Jonas standing idle at a local point (with the course's signs), his scripted controller and,
// with objects, the course's own ObjectManager and the events it emitted.
function hero(x, y, z, yaw, { objects = false } = {}) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'signRead', 'starCollected']) events.on(name, () => log.push(name));
  const p = new Player({ collision: col, events, spawn: { ...world(x, y, z), yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = objects ? new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'lane' }) : null;
  return { p, ctl, om, log, at: () => local(p.pos) };
}

// The follow camera; with the realistic look's profile (layout.LANE_REAL.camera) while `profile`
// is (the camera tests run with each).
let profile = null;
function camera(p, opts) {
  const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events: new Events() });
  cam.setProfile(profile);
  cam.reset(p, opts);
  return cam;
}
// The camera tests' runs: the classic camera's, then the realistic look's (its profile).
const CAMERAS = [['', null], [' (the realistic look\'s camera)', lane.LANE_REAL.camera]];
const withCamera = (prof, fn) => () => {
  profile = prof;
  try {
    return fn();
  } finally {
    profile = null;
  }
};

// The stick toward world yaw `yaw` with the camera where it is.
function toward(cam, yaw) {
  const a = wrapAngle(cam.getYaw() - yaw);
  return { stickX: Math.sin(a), stickY: Math.cos(a) };
}

// Whether a world point lies inside a solid: two or more of the six axis rays from it hit a face
// from behind.
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => ({ x, y, z }));
function insideSolid(p) {
  let back = 0;
  for (const d of AXES) {
    const hit = col.raycast(p, d, 9000);
    if (hit && hit.normal.x * d.x + hit.normal.y * d.y + hit.normal.z * d.z > 0) back++;
  }
  return back >= 2;
}

const meshes = [];
area.root.traverse((o) => o.isMesh && meshes.push(o));
const mesh = (name) => meshes.find((m) => m.name === name);

// (45k triangles, from 42k, W8: the two ends as the photos have them, both looks drawing them in
// the classic build's meshes: north_west's ribbed front and doors, the motorhome, south_west's
// gable panels and windows, the bend's fence, the hedges along lines, the double garage's front
// and roof, the east house's dormer, the forecourt's wall, the veranda house, the lay-by's cars,
// lamppost B, the far houses: ~42.2k, the classic look's frame stays a small one.)
// (47k, from 45k, round 2b's P3: the street worn and patched as the photos have it, both looks
// drawing it in the shared asphalt mesh: the patches in groups with islands, the long seal bands,
// the grated covers (+1.1k); the bed walls' irregular cap slabs (+0.3k); the beds' new kinds and
// their flowers (+0.6k): 46.5k.)
test('budgets: at most 15 meshes named lane-* with baked colours (13 and the movers: the bins, instanced, and the charger\'s cable), under 47k triangles and 6.5k collider triangles, built in under 1200 ms; the course\'s objects within 9 meshes', () => {
  assert.ok(meshes.length <= 15, `${meshes.length} meshes`);
  assert.ok(mesh('lane-bins').isInstancedMesh && mesh('lane-bins').count === 2 && mesh('lane-cable'), 'the movers');
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    assert.match(m.name, /^lane-/);
    assert.ok(g.attributes.color, `${m.name} has vertex colours`);
    assert.ok(g.attributes.position.count > 0, `${m.name} has vertices`);
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  assert.ok(tris < 47000, `${tris} triangles`);
  const colliders = area.parts.flatMap((p) => p.colliders);
  const colliderTris = colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(colliderTris < 6500, `${colliderTris} collider triangles`);
  assert.deepEqual([...new Set(colliders.map((c) => c.terrain))].sort(), ['grass', 'stone', 'wood']);
  assert.deepEqual([...new Set(colliders.map((c) => c.surface).filter(Boolean))], ['not_slippery'], 'the steps');
  assert.ok(buildMs < 1200, `built in ${buildMs.toFixed(0)} ms`);
  assert.deepEqual(area.parts.map((p) => p.name), ['lane']);
  const { om } = hero(0, GROUND, 900, 0, { objects: true });
  let n = 0;
  om.group.traverse((o) => o.isMesh && n++);
  assert.ok(n > 0 && n <= 9, `${n} object meshes`);
});

// Bytes allocated per call of fn once it is warm (V8 heap sampling).
async function bytesPerCall(fn, n = 20000) {
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

test('the details: the 1-up high over the trampoline, butterflies over the dad\'s lawn and north_3\'s beds, brown birds over the forest; the flags wave (their tips swing, their hoists stay) without allocating', async () => {
  const T = lane.TRAMPOLINE;
  assert.deepEqual(lane.TRAMPOLINES, [T]);
  assert.deepEqual([lane.ONE_UP.x, lane.ONE_UP.z], [T.x, T.z]);
  // The trampoline's mat: a floor at its top over the terrace, all round its middle.
  for (const [dx, dz] of [[0, 0], [T.r - 20, 0], [0, -(T.r - 20)], [-(T.r - 20), 0], [0, T.r - 20]]) {
    assert.equal(col.findFloor(T.x + dx + O.x, T.y + 100 + O.y, T.z + dz + O.z).y - O.y, T.y, `the mat at (${dx}, ${dz})`);
  }
  assert.equal(lane.groundHeight(T.x, T.z), lane.TERRACE);
  const { om } = hero(0, GROUND, 900, 0, { objects: true });
  assert.ok(om.oneUp && om.oneUp.alive, 'the 1-up');
  assert.deepEqual([om.oneUp.pos.x - O.x, om.oneUp.pos.y - O.y, om.oneUp.pos.z - O.z], [T.x, lane.ONE_UP.y, T.z]);
  assert.ok(om.trampolines && om.trampolines.spots.length === 1, 'the trampoline\'s spring');
  assert.equal(om.butterflies.list.length, lane.BUTTERFLY_SPOTS.length * 3);
  assert.equal(lane.BUTTERFLY_SPOTS.length, 2);
  assert.ok(om.birds.birds.length > 0 && lane.BIRD_CIRCLES.every((c) => c.z < lane.backZAt(c.x) && !lane.inBounds(c.x, c.z)), 'birds over the forest');
  assert.equal(area.objectsLayout.BIRD_TINT, 0x5a5048);
  // The flags: lane-cloth (both faces) moves with the clock, its hoists still.
  const cloth = mesh('lane-cloth');
  assert.equal(cloth.material.side, THREE.DoubleSide);
  const pos = cloth.geometry.attributes.position;
  const at = (t) => {
    area.update(t);
    return Float32Array.from(pos.array);
  };
  const [a, b] = [at(0.4), at(1.3)];
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const f = lane.FLAGPOLES.reduce((m, q) => (Math.hypot(a[i * 3] - q.x, a[i * 3 + 2] - q.z) < Math.hypot(a[i * 3] - m.x, a[i * 3 + 2] - m.z) ? q : m));
    const d = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 2] - b[i * 3 + 2]);
    const out = Math.hypot(a[i * 3] - f.x, a[i * 3 + 2] - f.z);
    assert.equal(a[i * 3 + 1], b[i * 3 + 1], 'no vertex moves up or down');
    if (out < lane.FLAGPOLE.r + 2) assert.ok(d < 0.01, `a hoist still: ${d}`);
    if (out > 200 && d > 2) moved++;
  }
  assert.ok(moved > pos.count / 4, `${moved} of ${pos.count} vertices waving`);
  const bytes = await bytesPerCall((i) => area.update(i * 0.016));
  assert.ok(bytes < 16, `${bytes.toFixed(1)} bytes per frame`);
});

test('the cars parked on the drives: each on its drive and solid (a floor on its roof and on its bonnet), none in the way to the bins, the coins or the drives\' mouths', () => {
  assert.equal(lane.CARS.length, 9); // (W8: north_west's white estate at its wide door)
  for (const c of lane.CARS) {
    const K = lane.CAR_KINDS[c.kind];
    const y0 = lane.groundHeight(c.x, c.z);
    assert.ok(lane.inBounds(c.x, c.z) && Math.abs(y0 - GROUND) < 1e-6, `${c.kind} at (${c.x}, ${c.z}) on a drive`);
    const along = [Math.sin(c.yaw), Math.cos(c.yaw)];
    const roof = col.findFloor(c.x - along[0] * 40 + O.x, 1000, c.z - along[1] * 40 + O.z);
    assert.ok(Math.abs(roof.y - O.y - y0 - K.roof) < 1, `${c.kind} at (${c.x}, ${c.z}): its roof at ${roof.y - O.y}`);
    const front = K.l / 2 - (K.hood + 45) / 2; // (between the windscreen's foot and the nose)
    const bonnet = col.findFloor(c.x + along[0] * front + O.x, 1000, c.z + along[1] * front + O.z);
    assert.ok(Math.abs(bonnet.y - O.y - y0 - K.belt) < 1, `${c.kind} at (${c.x}, ${c.z}): its bonnet at ${bonnet.y - O.y}`);
    // No coin over it or within 60 of it.
    for (const k of lane.COINS) {
      const u = Math.abs((k.x - c.x) * along[0] + (k.z - c.z) * along[1]) - K.l / 2;
      const w = Math.abs((k.x - c.x) * along[1] - (k.z - c.z) * along[0]) - K.w / 2;
      assert.ok(Math.hypot(Math.max(0, u), Math.max(0, w)) > 60, `${c.kind} at (${c.x}, ${c.z}): clear of the coin at (${Math.round(k.x)}, ${Math.round(k.z)})`);
    }
  }
  // The way up the dad's drive to the bins is clear.
  const B = lane.BINS[0];
  for (const y of [40, 150, 260]) assert.equal(col.raycast(world(B.x, y, 900), { x: 0, y: 0, z: 1 }, B.z - 900 - lane.BIN.z / 2 - 5, { floors: false, ceilings: false }), null, `the way to the bins at ${y}`);
});

for (const [label, prof] of CAMERAS) {
  test('the arrival: out of the dad\'s front door onto the path facing the street; after the walk-in the camera stands in front of him over the lawn, clear, with the star over the ridge in the picture; a lost life drops him onto the path unhurt' + label, withCamera(prof, () => {
    const e = lane.ENTRIES.home;
    assert.deepEqual([e.x, e.y, e.z, e.yaw, e.camYaw, e.walkIn, e.door], [DAD.door.x, GROUND, DAD.door.faceZ - 174, Math.PI, Math.PI, 8, 'lane_home']);
    const floor = col.findFloor(e.x + O.x, e.y + 10, e.z + O.z);
    assert.ok(floor.surface && Math.abs(floor.y - O.y - GROUND) < 1e-6 && floor.surface.terrain === 'stone', `on the path: ${floor.y - O.y}`);
    // The door he comes out of is the way back in.
    const door = lane.DOORS[0];
    assert.deepEqual([door.id, door.to, door.entry, door.x, door.z, door.yaw], ['lane_home', 'hall', 'east_2', e.x, DAD.door.faceZ, Math.PI]);
    // Open lawn and street in front of him: a floor every 100 for 1800 (to the villas' wall).
    for (let d = 0; d <= 1800; d += 100) {
      const f = col.findFloor(e.x + O.x, 400, e.z - d + O.z);
      assert.ok(f.surface && f.y - O.y <= GROUND + 1e-6, `open ground ${d} in front of him`);
    }
    const { p, ctl, at } = hero(0, 0, 0, 0);
    p.placeAt(area.entries.home);
    const cam = camera(p, { yaw: e.camYaw });
    for (let i = 0; i < 14; i++) {
      const c = ctl.next(i < e.walkIn ? toward(cam, e.yaw) : {});
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      assert.ok(!insideSolid(cam.pos), `tick ${i}: the camera clear`);
    }
    const end = at();
    assert.ok(end.z < e.z - 30 && Math.abs(end.x - e.x) < 20 && Math.abs(end.y - GROUND) < 1, `walked out toward the street: ${JSON.stringify(end)}`);
    const c = local(cam.pos);
    assert.ok(c.z < end.z - 800 && Math.abs(c.x - end.x) < 200, `the camera in front of him: ${JSON.stringify(c)}`);
    assert.equal(cam.collider.occluded, false);
    // The star over the ridge projects inside the picture.
    cam.apply(1);
    cam.camera.updateMatrixWorld(true);
    const s = lane.STAR;
    const v = new THREE.Vector3(s.x + O.x, s.y + O.y, s.z + O.z).project(cam.camera);
    assert.ok(Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1, `the star in the picture: ${v.x.toFixed(2)}, ${v.y.toFixed(2)}`);
    // A lost life: the respawn drop (from 1000 up) lands him on the path, unhurt.
    assert.deepEqual(AREA_DEFS.lane.respawn, { entry: 'home', drop: 1000 });
    const r = hero(0, 0, 0, 0);
    r.p.spawn = { ...area.respawn };
    r.p.respawn();
    assert.equal(r.p.action, 'spawn');
    for (let i = 0; i < 90; i++) r.p.update(r.ctl.next({}), Math.PI);
    const q = r.at();
    assert.ok(r.p.grounded && Math.abs(q.y - GROUND) < 1 && Math.abs(q.z - e.z) < 5, `landed on the path: ${JSON.stringify(q)}`);
    assert.equal(r.p.health, MAX_HEALTH);
  }));
}

test('no water anywhere, and a floor everywhere inside the boundary (400 seeded points find one between -10 and 1300)', () => {
  const rng = makeRng(31);
  const xs = BOUNDS.map((b) => b[0]);
  const zs = BOUNDS.map((b) => b[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let i = 0; i < 200; i++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    assert.equal(area.waterFn(x + O.x, z + O.z), NO_WATER);
    assert.equal(lane.groundHeight(x, z) >= 0, true);
  }
  let n = 0;
  while (n < 400) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    if (!lane.inBounds(x, z)) continue;
    n++;
    const floor = col.findFloor(x + O.x, 1300 + O.y, z + O.z);
    assert.ok(floor.surface && floor.y - O.y >= -10 && floor.y - O.y <= 1300, `(${x.toFixed(0)}, ${z.toFixed(0)}): ${floor.y - O.y}`);
  }
});

// Spam (jump, crouch, attack, the stick turning every 20 ticks) from `start` for n ticks; the
// first tick Jonas or the camera left the boundary (the camera with a little slack), or null.
function spam(start, seed, n) {
  const rng = makeRng(seed);
  const [x, y, z] = start;
  const { p, ctl } = hero(x, y, z, rng() * Math.PI * 2);
  const cam = camera(p);
  let sx = 0;
  let sy = 1;
  for (let i = 0; i < n; i++) {
    if (i % 20 === 0) {
      const a = rng() * Math.PI * 2;
      sx = Math.sin(a);
      sy = Math.cos(a);
    }
    const c = ctl.next({ stickX: sx, stickY: sy, A: rng() < 0.3, Z: rng() < 0.05, B: rng() < 0.05 });
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
    if (p.action === 'reading') p.endReading();
    if (!inside(local(p.pos))) return `tick ${i}: Jonas at ${JSON.stringify(local(p.pos))} (${p.action})`;
    if (!inside(local(cam.pos), 80)) return `tick ${i}: camera at ${JSON.stringify(local(cam.pos))}`;
  }
  return null;
}

test('the boundary holds: jump, crouch and attack spam from all over the course never gets Jonas or the camera out of it', () => {
  const M = lane.MOTORHOME;
  // (W2: from the layout's anchors; each start's height its ground's.)
  const on = (x, z) => [x, lane.groundHeight(x, z), z];
  const SW = lane.HOUSES.find((h) => h.id === 'south_west');
  // (Its back garden by the bounds' south-west edge: 300 out past its back gable, 900 toward its
  // west side, in its own frame; W8 fix: the frame turned with the house, its u away from the
  // street.)
  const [c, sn, u] = [Math.cos(SW.yaw), Math.sin(SW.yaw), SW.w / 2 + 300];
  const [bx, bz] = [SW.cx + u * c + 900 * sn, SW.cz - u * sn + 900 * c];
  const starts = [
    on(lane.LAMPS[0].x + 300, lane.LAMPS[0].z), // the junction
    [M.cx, GROUND + M.h, M.cz], // the motorhome's roof
    on(lane.PLOTS_N[0].x1, -2500), // the side yards
    on(lane.PLOTS_N[1].x1, -2300),
    on(lane.PLOTS_N[2].x1, -2600),
    on(lane.PLOTS_N[3].x1, -2800),
    on(0, lane.flatZAt(0) - 30), // the forest's edge
    [lane.footpathAt(1150).x, GROUND, lane.footpathAt(1150).z], // the footpath's barrier
    [lane.TRAMPOLINE.x, lane.TRAMPOLINE.y, lane.TRAMPOLINE.z], // the trampoline
    [-250, DAD.ridge, DAD.ridgeZ], // the dad's ridge
    on(lane.APRON.ring.x, lane.APRON.ring.z), // the turning area
    on(lane.FORECOURT.x0 + 300, (lane.FORECOURT.z0 + lane.FORECOURT.z1) / 2), // the east end
    on(lane.EAST_HOUSE.cx - lane.EAST_HOUSE.w / 2 - 300, lane.EAST_HOUSE.cz),
    on(0, 3200), // the back gardens
    on(-9000, -2800), // behind the north-west villa
    on(bx, bz), // the corner house's garden
  ];
  const out = [];
  starts.forEach((s, run) => {
    const bad = spam(s, 4000 + run, 600);
    if (bad) out.push(`run ${run} from ${JSON.stringify(s)}: ${bad}`);
  });
  assert.deepEqual(out, []);
});

test('the farthest leaps, long jumps at full speed in 16 directions off the dad\'s ridge and off the junction lamppost\'s top, never carry him out of the boundary', () => {
  const L1 = lane.POLES[0];
  const out = [];
  for (const [name, x, y, z] of [['the ridge', -250, DAD.ridge, DAD.ridgeZ], ['the lamppost', L1.x, L1.y1, L1.z]]) {
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2;
      const { p, ctl, at } = hero(x + Math.sin(yaw) * 40, y, z + Math.cos(yaw) * 40, yaw);
      p.forwardVel = 32;
      p.setAction('long_jump');
      for (let i = 0; i < 300 && !(p.grounded && i > 2); i++) {
        p.update(ctl.next({ stickY: 1 }), yaw);
        if (!inside(at())) {
          out.push(`${name} toward ${Math.round((yaw * 180) / Math.PI)}: out at ${JSON.stringify(at())}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(out, []);
});

test('the dad\'s house (W3): its shallow main body, eaves at 412, its 32-degree roof up to the ridge at 703 over z 1795 (raycast down at 7 points on each slope), the two wings behind it, their ridges along z running into its back slope at the valleys; the garage row\'s roof at 392 with 300 or more over the store room\'s floor under it; no floor anywhere under a ceiling lower than 300', () => {
  assert.deepEqual([DAD.x0, DAD.x1, DAD.z0, DAD.z1, DAD.eave, Math.round(DAD.ridge), DAD.ridgeZ, DAD.pitch], [-860, 1600, 1330, 2260, 412, 703, 1795, 32]);
  const tan = (DAD.ridge - DAD.eave) / (DAD.d / 2);
  assert.ok(Math.abs(Math.atan(tan) * (180 / Math.PI) - 32) < 0.2, 'its pitch');
  assert.ok(DAD.eave - (DAD.overhang ?? 60) * tan <= 395, 'its rim within a standing jump\'s reach');
  for (const x of [-760, 250, 1500]) {
    for (const z of [1400, 1650, 1900, 2035, 2200]) {
      const hit = col.raycast(world(x, 2000, z), { x: 0, y: -1, z: 0 }, 3000);
      const want = DAD.ridge - Math.abs(z - DAD.ridgeZ) * tan;
      // (Over the main roof's back slope near a wing's valley, the wing's roof is the higher.)
      const wing = lane.DAD_WINGS.find((w) => Math.abs(x - w.cx) < w.d / 2 && z > DAD.z1 - (w.join.apex - w.w / 2) + Math.abs(x - w.cx));
      const top = wing ? Math.max(want, wing.ridge - (Math.abs(x - wing.cx) * (wing.ridge - wing.eave)) / (wing.d / 2)) : want;
      assert.ok(hit && Math.abs(hit.point.y - O.y - top) < 4, `the roof at (${x}, ${z}): ${hit && hit.point.y - O.y} for ${top.toFixed(0)}`);
    }
    // The eaves: at the walls' tops.
    assert.ok(Math.abs(col.findFloor(x + O.x, 600, DAD.z0 + 2 + O.z).y - O.y - DAD.eave) < 2, `the front eave at ${x}`);
  }
  // The wings: their slopes across them, their ridges along z out to the valleys' apex.
  for (const w of lane.DAD_WINGS) {
    const wt = (w.ridge - w.eave) / (w.d / 2);
    for (const dx of [-0.4, 0, 0.4]) {
      for (const z of [DAD.z1 + 120, w.cz, w.cz + w.w / 2 - 80]) {
        const x = w.cx + dx * w.d;
        const hit = col.raycast(world(x, 2000, z), { x: 0, y: -1, z: 0 }, 3000);
        const want = w.ridge - Math.abs(x - w.cx) * wt;
        assert.ok(hit && Math.abs(hit.point.y - O.y - want) < 4, `${w.id}'s roof at (${x}, ${z}): ${hit && hit.point.y - O.y} for ${want.toFixed(0)}`);
      }
    }
    // Along its ridge onto the main roof: no step at the valleys' apex.
    const apexZ = DAD.z1 - (w.join.apex - w.w / 2);
    for (const z of [apexZ + 40, apexZ - 40]) {
      const f = col.findFloor(w.cx + O.x, 2000 + O.y, z + O.z);
      const want = z > apexZ ? w.ridge : DAD.ridge - Math.abs(z - DAD.ridgeZ) * tan;
      assert.ok(Math.abs(f.y - O.y - want) < 4, `${w.id}'s ridge at z ${z}: ${f.y - O.y} for ${want.toFixed(0)}`);
    }
  }
  // The walls stand where the footprint says (a ray along the front at 200 up hits them there).
  const front = col.raycast(world(250, 200, 900), { x: 0, y: 0, z: 1 }, 1000, { floors: false, ceilings: false });
  assert.ok(front && Math.abs(front.point.z - O.z - DAD.z0) < 1, `the front wall at ${front && front.point.z - O.z}`);
  const C = lane.CARPORT;
  // (W4: the row's roof from the gable's back corner; the room behind the door wall under it.)
  const roomZ = (lane.GARAGE.wall + C.z1) / 2;
  assert.equal(col.findFloor(2000 + O.x, 600, roomZ + O.z).y - O.y, C.top);
  const ceil = col.findCeil(2000 + O.x, GROUND + 10, roomZ + O.z).y - O.y;
  assert.ok(ceil - GROUND >= 300 && ceil < C.top, `the store room under the carport: ${ceil - GROUND}`);
  // Every floor he can stand on (not too steep) has 300 or more over it, all over the course.
  const low = [];
  for (let x = -12000; x <= 10000; x += 100) {
    for (let z = -5000; z <= 4500; z += 100) {
      if (!lane.inBounds(x, z)) continue;
      let y = 4400;
      for (let k = 0; k < 6; k++) {
        const f = col.findFloor(x + O.x, y + O.y, z + O.z, 0);
        if (!f.surface) break;
        const fy = f.y - O.y;
        if (f.surface.normal.y > 0.78) {
          const c = col.findCeil(x + O.x, fy + 1 + O.y, z + O.z, 0);
          if (c.y !== CEIL_NONE && c.y - O.y - fy < 300) low.push(`(${x}, ${z}): floor ${Math.round(fy)}, ceiling ${Math.round(c.y - O.y)}`);
        }
        y = fy - 1;
      }
    }
  }
  assert.deepEqual(low.slice(0, 10), [], `${low.length} spots`);
});

test("the north villas (W6): each block under its drawn hipped roof (the front hip 34 degrees, the rim over the eave, the eaves drawn only) by raycast; the terraces still solid to TERRACE at their low bed walls; north_2's hedge on its bed wall solid to its walkable top, its three coins over it; north_2's bins and north_3's bin enclosure solid; north_2's car nose out on its drive; nothing over the trampoline's mat", () => {
  for (const v of lane.VILLAS) {
    const R = hipOf(v);
    assert.ok(R.deep && Math.abs(R.t - Math.tan((34 * Math.PI) / 180)) < 1e-9, `${v.id}: a programmed roof`);
    // (In the walls: the lowest slope over the point; the deep front eave's rim drawn only.)
    for (const [du, dw] of [[0, 0], [0.3, 0.35], [-0.35, -0.3], [0.4, -0.4]]) {
      const [u, w] = [du * v.w, dw * v.d];
      const hit = col.raycast(world(v.cx + u, 3000, v.cz + w), { x: 0, y: -1, z: 0 }, 4000);
      const want = Math.min(...R.planes.map((p) => p(u, w)));
      assert.ok(hit && Math.abs(hit.point.y - O.y - want) < 2, `${v.id}'s roof at (${u.toFixed(0)}, ${w.toFixed(0)}): ${hit && (hit.point.y - O.y).toFixed(0)} for ${want.toFixed(0)}`);
    }
    const eave = col.raycast(world(v.cx, 3000, v.front + R.o[0] / 2), { x: 0, y: -1, z: 0 }, 4000);
    assert.ok(!eave || eave.point.y - O.y < v.eave - 100, `${v.id}'s front eave drawn only (${eave && eave.point.y - O.y})`);
    assert.ok(R.ridge > v.eave + 300, `${v.id}'s ridge ${R.ridge.toFixed(0)}`);
  }
  // The bed walls drawn lower; their colliders at TERRACE (a hop's height from the pavement).
  for (const x of [-6900, -1200, 2400, 4800]) {
    assert.ok(wallDrawnAt(x) + GROUND < lane.TERRACE - 20, `drawn lower at ${x}`);
    assert.equal(col.findFloor(x + O.x, 600, lane.wallZAt(x) - 50 + O.z).y - O.y, lane.TERRACE, `the wall top at ${x}`);
  }
  const H = lane.HEDGES.find((h) => h.clipped);
  assert.ok(H.x1 <= lane.PLOTS_N[1].drive[0] && H.z1 < lane.NORTH.wallZ && H.top - lane.TERRACE === 190, 'north_2\'s hedge on its bed wall');
  for (const x of [H.x0 + 60, (H.x0 + H.x1) / 2, H.x1 - 60]) assert.equal(col.findFloor(x + O.x, 900, (H.z0 + H.z1) / 2 + O.z).y - O.y, H.top, `its top at ${x}`);
  const on = lane.COINS.filter((c) => c.x > H.x0 && c.x < H.x1 && c.z > H.z0 && c.z < H.z1);
  assert.ok(on.length === 3 && on.every((c) => c.y === H.top + 60), 'its three coins over it');
  for (const b of lane.VILLA_BINS) assert.ok(Math.abs(col.findFloor(b.x + O.x, 600, b.z + O.z).y - O.y - GROUND - lane.LINK_BIN.h) < 1, `a bin's lid at (${b.x}, ${b.z})`);
  const E = lane.ENCLOSURE;
  assert.equal(col.findFloor((E.x0 + E.x1) / 2 + O.x, 600, (E.z0 + E.z1) / 2 + O.z).y - O.y, E.top, 'the bin enclosure');
  assert.ok(E.x0 >= lane.PLOTS_N[2].drive[0] && E.z1 < lane.NORTH.wallZ, 'inside north_3\'s drive mouth');
  const car = lane.CARS.find((c) => c.x > lane.PLOTS_N[1].drive[0] && c.x < lane.PLOTS_N[1].drive[1] && c.z < 0);
  const K = lane.CAR_KINDS[car.kind];
  assert.ok(car.yaw === 0 && car.style === 'two' && car.z + K.l / 2 < lane.NORTH.wallZ - 300 && car.z - K.l / 2 > lane.villaOf(lane.PLOTS_N[1]).front, `north_2's car nose out on its drive (${car.z})`);
  const T = lane.TRAMPOLINE;
  for (const [dx, dz] of [[0, 0], [120, -80], [-150, 100]]) assert.equal(col.findFloor(T.x + dx + O.x, 2000, T.z + dz + O.z).y - O.y, T.y, 'nothing over the mat');
  // (Every vertex of the classic meshes finite: the kit's many-cornered outlines shaded per corner.)
  area.root.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('lane-')) return;
    for (const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite), `${o.name}: finite`);
  });
});

// (W8: the two ends' new solids, each where the photos have it, deliberately: the hedges along
// lines and the forecourt wall walkable boxes, the garden things, north_west's estate; none on the
// pavement, the footway or the drives' mouths.)
test('W8: the two ends\' new solids (the hedges along lines, the forecourt wall, its pillar and mailbox, the garden things, north_west\'s estate) solid to their walkable tops, and the pavement along the west leg and the footway past the wall clear at GROUND', () => {
  const floor = (x, z) => col.findFloor(x + O.x, 3000, z + O.z).y - O.y;
  // (W8 fix: each hedge's two faces sampled along it: on the street's north side behind the
  // pavement's back, on its south side behind the bend's fence, 80 off the road's edge; and off the
  // footpath's asphalt: none on a way.)
  const north = (x, z) => {
    let best = null;
    for (let i = 0; i + 1 < lane.ROAD.line.length; i++) {
      const [[ax, az], [bx, bz]] = [lane.ROAD.line[i], lane.ROAD.line[i + 1]];
      const l = Math.hypot(bx - ax, bz - az);
      const [ex, ez] = [(bx - ax) / l, (bz - az) / l];
      const t = Math.max(0, Math.min(l, (x - ax) * ex + (z - az) * ez));
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (!best || d < best.d) best = { d, north: (x - ax) * ez - (z - az) * ex > 0 };
    }
    return best.north;
  };
  const FP = lane.FOOTPATH;
  for (const h of LINE_HEDGES) {
    const [x, z] = [(h.from[0] + h.to[0]) / 2, (h.from[1] + h.to[1]) / 2];
    assert.ok(Math.abs(floor(x, z) - h.top) < 1, `the ${h.kind} hedge's top at ${floor(x, z)}`);
    const [dx, dz] = [h.to[0] - h.from[0], h.to[1] - h.from[1]];
    const len = Math.hypot(dx, dz);
    for (let k = 0; k <= 20; k++) {
      for (const e of [-1, 1]) {
        const [px, pz] = [h.from[0] + (dx * k) / 20 - (dz / len) * e * (h.depth / 2), h.from[1] + (dz * k) / 20 + (dx / len) * e * (h.depth / 2)];
        const r = lane.roadDistance(px, pz);
        assert.ok(r > (north(px, pz) ? lane.PAVEMENT.to : lane.ROAD.half + 80), `the ${h.kind} hedge off the street at (${px.toFixed(0)}, ${pz.toFixed(0)}): ${r.toFixed(0)}`);
        const [ft, fs] = [(px - FP.x) * FP.dir[0] + (pz - FP.z) * FP.dir[1], -(px - FP.x) * FP.dir[1] + (pz - FP.z) * FP.dir[0]];
        if (ft > FP.from && ft < FP.len) assert.ok(Math.abs(fs) > FP.half + 10, `the ${h.kind} hedge off the footpath at (${px.toFixed(0)}, ${pz.toFixed(0)}): ${fs.toFixed(0)}`);
      }
    }
  }
  const W = FORECOURT_WALL;
  assert.ok(Math.abs(floor((W.from[0] + W.to[0]) / 2, (W.from[1] + W.to[1]) / 2) - W.top) < 0.01, 'the forecourt wall\'s top');
  assert.ok(floor(lane.CABINET.x, lane.CABINET.z) > W.pillarTop, 'the mailbox on its pillar');
  for (let x = lane.FOOTWAY.x0 + 20; x < lane.FOOTWAY.x1; x += 40) assert.equal(floor(x, lane.FORECOURT.z1 + 30), GROUND, `the footway at x ${x}`);
  for (const t of GARDEN_THINGS) {
    const top = { picnic: 122, table: 114, parasol: 114, postbox: 185, shed: t.h }[t.kind]; // (the parasol through the table)
    assert.ok(Math.abs(floor(t.x, t.z) - GROUND - (top ?? 0)) < 0.01, `the ${t.kind} at ${floor(t.x, t.z)}`);
  }
  const car = lane.CARS.find((c) => c.cluster);
  assert.ok(Math.abs(floor(car.x, car.z) - GROUND - lane.CAR_KINDS[car.kind].roof) < 0.01, 'north_west\'s estate\'s roof');
  // The pavement along the west leg (its middle, 550 from the road's) at GROUND all the way.
  const [A, B] = lane.ROAD.line;
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const [dx, dz] = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
  for (let t = 300; t < len - 100; t += 100) {
    const [x, z] = [A[0] + dx * t + dz * 550, A[1] + dz * t - dx * 550];
    if (lane.inBounds(x, z)) assert.equal(floor(x, z), GROUND, `the pavement at (${Math.round(x)}, ${Math.round(z)})`);
  }
});

test("the neighbours (W5): south_1 and south_2 under their steeper roofs (28 and 29 degrees, eaves at 412, a lip along the front eave) by raycast on both slopes, each with two wings behind it running into its back slope; the link's door wall set back, its two bins solid; south_2's raised bed a step up from its gravel; the hedge at the asphalt's edge, lower by the link; the young beech row not solid", () => {
  for (const [h, deg, wings, yard] of [[lane.SOUTH_1, 28, lane.SOUTH_1_WINGS, -2900], [lane.SOUTH_2, 29, lane.SOUTH_2_WINGS, 4150]]) {
    const tan = (h.ridge - h.eave) / (h.d / 2);
    assert.ok(Math.abs(Math.atan(tan) * (180 / Math.PI) - deg) < 0.2, `${h.id}'s pitch`);
    assert.equal(h.eave, 412);
    const [x0, x1, z0, z1] = [h.cx - h.w / 2, h.cx + h.w / 2, h.cz - h.d / 2, h.cz + h.d / 2];
    // (The back slope where no wing stands over it: the courtyard's x.)
    for (const [x, z] of [[x0 + 150, z0 + 120], [h.cx, z0 + 300], [x1 - 150, h.cz - 60], [yard, h.cz + 200], [yard, z1 - 100]]) {
      const hit = col.raycast(world(x, 2000, z), { x: 0, y: -1, z: 0 }, 3000);
      const want = h.ridge - Math.abs(z - h.cz) * tan;
      assert.ok(hit && Math.abs(hit.point.y - O.y - want) < 4, `${h.id}'s roof at (${x}, ${z}): ${hit && hit.point.y - O.y} for ${want.toFixed(0)}`);
    }
    assert.ok(Math.abs(col.findFloor(h.cx + O.x, 600, z0 + 2 + O.z).y - O.y - h.eave) < 2, `${h.id}'s front eave`);
    assert.equal(wings.length, 2);
    for (const w of wings) {
      assert.ok(w.join && w.yaw === Math.PI / 2 && Math.abs(w.cz - w.w / 2 - z1) < 1e-6, `${w.id} against ${h.id}'s back wall`);
      const wt = (w.ridge - w.eave) / (w.d / 2);
      for (const dx of [-0.3, 0, 0.3]) {
        const x = w.cx + dx * w.d;
        const z = w.cz + w.w / 2 - 80;
        const hit = col.raycast(world(x, 2000, z), { x: 0, y: -1, z: 0 }, 3000);
        const want = w.ridge - Math.abs(x - w.cx) * wt;
        assert.ok(hit && Math.abs(hit.point.y - O.y - want) < 4, `${w.id}'s roof at (${x}, ${z}): ${hit && hit.point.y - O.y} for ${want.toFixed(0)}`);
      }
    }
  }
  // The link: its door wall at z0 (a ray along the drive at 150 up meets it), its fascia drawn
  // only; its bins solid to their lids.
  const L = lane.LINK;
  const door = col.raycast(world((L.doors[0] + L.doors[1]) / 2, 150, L.z0 - 400), { x: 0, y: 0, z: 1 }, 600, { floors: false, ceilings: false });
  assert.ok(door && Math.abs(door.point.z - O.z - L.z0) < 1, `the link's door wall at ${door && door.point.z - O.z}`);
  for (const b of lane.LINK_BINS) assert.ok(Math.abs(col.findFloor(b.x + O.x, 600, b.z + O.z).y - O.y - GROUND - lane.LINK_BIN.h) < 1, `a link bin's lid at (${b.x}, ${b.z})`);
  // south_2's raised bed (a step up from the gravel round it) and the gravel at GROUND.
  const R = lane.S2_GARDEN.raised;
  assert.ok(R.top - GROUND < 30, 'the raised bed a step under the knee');
  assert.equal(col.findFloor((R.x0 + R.x1) / 2 + O.x, 600, (R.z0 + R.z1) / 2 + O.z).y - O.y, R.top);
  assert.equal(col.findFloor(3600 + O.x, 600, 1600 + O.z).y - O.y, GROUND, 'the gravel');
  // (W5 fix: and slabs east of its path, at GROUND, hard.)
  const Pv = lane.S2_GARDEN.paving;
  const slab = col.findFloor(5000 + O.x, 600, 1570 + O.z);
  assert.ok(Pv.x0 < 5000 && Pv.x1 > 5000 && slab.y - O.y === GROUND && slab.surface.terrain === 'stone', `the slabs: ${slab.y - O.y} ${slab.surface.terrain}`);
  // The hedge right at the asphalt's edge, its walkable top 190 over the lawn, 110 at its east
  // end (W5 fix), which stops short of the link's drive (a corner of lawn open there); a taller
  // clump of it set back against south_1's east end, 140 high.
  const [H, E] = [lane.HEDGES[0], lane.HEDGES.find((e) => e.informal && e.x0 === lane.HEDGES[0].x1)];
  const C = lane.HEDGES.find((e) => e.informal && e.z0 > lane.SOUTH_EDGE);
  assert.ok(H.z0 === lane.SOUTH_EDGE && E.z0 === lane.SOUTH_EDGE && E.x1 < L.x0 - 100, 'one hedge along the edge, short of the link');
  assert.equal(col.findFloor(-3000 + O.x, 600, (H.z0 + H.z1) / 2 + O.z).y - O.y, GROUND + 190);
  assert.equal(col.findFloor(-1800 + O.x, 600, (E.z0 + E.z1) / 2 + O.z).y - O.y, GROUND + 110);
  assert.equal(col.findFloor((E.x1 + L.x0) / 2 + O.x, 600, (E.z0 + E.z1) / 2 + O.z).y - O.y, GROUND, 'the corner by the link open');
  assert.ok(C && C.z1 < lane.SOUTH_1.cz - lane.SOUTH_1.d / 2 && C.x1 < L.x0, "the clump in front of south_1's east end");
  assert.equal(col.findFloor((C.x0 + C.x1) / 2 + O.x, 600, (C.z0 + C.z1) / 2 + O.z).y - O.y, GROUND + 140);
  // The beech row: nothing to stand on (the garden behind it open).
  const B = lane.BEECH_ROW;
  for (let x = B.x0 + 20; x < B.x1; x += B.step) assert.equal(col.findFloor(x + O.x, 600, B.z + O.z).y - O.y, GROUND, `the beech row at ${x}`);
});

test('55 coins (D1: five in the store room behind the garage doors), each over a floor within 120; the star waits over the dad\'s ridge from the start, idle', () => {
  assert.equal(lane.COINS.length, 55);
  for (const c of lane.COINS) {
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y - (floor.y - O.y) <= 120 && c.y - (floor.y - O.y) >= 30, `coin at (${Math.round(c.x)}, ${Math.round(c.y)}, ${Math.round(c.z)}): floor ${floor.y - O.y}`);
    assert.ok(lane.inBounds(c.x, c.z), `coin at (${c.x}, ${c.z}) inside`);
  }
  const S = lane.STAR;
  assert.deepEqual([S.id, S.x, S.y, S.z, S.placed], ['lane_star', 300, 883, 1795, true]);
  assert.ok(Math.abs(col.findFloor(S.x + O.x, S.y + O.y, S.z + O.z, 0).y - O.y - 703) < 1, 'over the ridge');
  const { om } = hero(0, GROUND, 900, 0, { objects: true });
  assert.equal(om.star.state, 'idle');
  assert.equal(om.star.mesh.visible, true);
});

test('every sign is read from in front of its face, never from behind; the mailbox is a sign of its own (no signpost)', () => {
  const problems = [];
  for (const s of lane.SIGNS) {
    for (const [side, off] of [['front', 0], ['front-left', 0.6], ['front-right', -0.6], ['behind', Math.PI]]) {
      const a = s.yaw + off;
      const floorAt = (r) => col.findFloor(s.x + Math.sin(a) * r + O.x, s.y + 100 + O.y, s.z + Math.cos(a) * r + O.z);
      const fits = (r) => {
        const floor = floorAt(r);
        const clear = !col.raycast(world(s.x + Math.sin(a) * (r + 60), s.y + 100, s.z + Math.cos(a) * (r + 60)), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, r - 50);
        return floor.surface && floor.y - O.y > s.y - 78 && floor.y - O.y < s.y + 2 && clear;
      };
      const d = [400, 250, 170].find(fits);
      if (!d) {
        problems.push(`${s.id} ${side}: no room to stand`);
        continue;
      }
      const x = s.x + Math.sin(a) * d;
      const z = s.z + Math.cos(a) * d;
      const yaw = Math.atan2(s.x - x, s.z - z);
      const { p, ctl, log } = hero(x, floorAt(d).y - O.y, z, yaw);
      for (let t = 0; t < 90 && Math.hypot(p.pos.x - O.x - s.x, p.pos.z - O.z - s.z) > 95; t++) p.update(ctl.next({ stickY: 1 }), yaw);
      p.update(ctl.next({}), yaw);
      log.length = 0;
      p.update(ctl.next({ B: true }), yaw);
      const want = side === 'behind' ? 'punch' : 'reading';
      if (p.action !== want || log.length !== (side === 'behind' ? 0 : 1)) problems.push(`${s.id} ${side}: ${p.action}`);
    }
  }
  assert.deepEqual(problems, []);
  // The mailbox draws no signpost: nothing of the signs' mesh near it.
  const box = lane.SIGNS.find((s) => s.id === 'sparrow_mailbox');
  assert.equal(box.post, false);
  const pos = mesh('lane-signs').geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) assert.ok(Math.hypot(pos.getX(i) - box.x, pos.getZ(i) - box.z) > 300, 'no signpost at the mailbox');
  assert.equal(lane.SIGNS.filter((s) => s.post !== false).length, lane.SIGNS.length - 1, 'every other sign on a signpost');
});

for (const [label, prof] of CAMERAS) {
  test('nine climbable poles (every lamppost, R fixes: the dad wants to climb them all), each grabbed from every open side with the follow camera, which swings round to the pole\'s own side (camYaw) as he holds it, climbed to its top; jumping off one never hurts' + label, withCamera(prof, () => {
    // (To a thousandth: the footpath's lamppost stands at a computed point, moved by the origin.)
    const r = (v) => Math.round(v * 1000) / 1000;
    const built = col.poles.map((p) => ({ x: r(p.x - O.x), z: r(p.z - O.z), y0: r(p.y0 - O.y), y1: r(p.y1 - O.y), camYaw: p.camYaw }));
    assert.equal(built.length, 9); // (W2: the photos' five lampposts, the red-leaf tree, three flagpoles)
    assert.deepEqual(built, lane.POLES.map(({ x, z, y0, y1, camYaw }) => ({ x: r(x), z: r(z), y0: r(y0), y1: r(y1), camYaw })));
    for (const l of lane.LAMPS) assert.ok(lane.POLES.some((p) => p.x === l.x && p.z === l.z && p.y1 >= lane.LAMP.top - 60), `lamppost ${l.id} a pole up to its top`);
    const problems = [];
    for (const P of lane.POLES) {
      let sides = 0;
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const sx = P.x + Math.sin(a) * 350;
        const sz = P.z + Math.cos(a) * 350;
        // Only open sides: a floor level with the pole's foot and nothing between.
        const floor = col.findFloor(sx + O.x, P.y0 + 100 + O.y, sz + O.z);
        const blocked = col.raycast(world(sx, P.y0 + 60, sz), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, 300, { floors: false, ceilings: false });
        if (!floor.surface || Math.abs(floor.y - O.y - P.y0) > 30 || blocked) continue;
        sides++;
        const { p, ctl, at } = hero(sx, floor.y - O.y, sz, a + Math.PI);
        const cam = camera(p);
        const tick = (input) => {
          const c = ctl.next(input);
          p.update(cam.playerInput(c), cam.getYaw());
          cam.update(c, p);
        };
        for (let k = 0; k < 200 && p.action !== 'pole'; k++) {
          const q = at();
          const s = toward(cam, Math.atan2(P.x - q.x, P.z - q.z));
          tick({ ...s, A: Math.hypot(q.x - P.x, q.z - P.z) < 130 && p.grounded });
        }
        if (p.action !== 'pole') {
          problems.push(`(${P.x}, ${P.z}) from ${Math.round((a * 180) / Math.PI)}: not grabbed (${p.action})`);
          continue;
        }
        for (let k = 0; k < 120; k++) tick({});
        const c = local(cam.pos);
        const ahead = (c.x - P.x) * Math.sin(P.camYaw) + (c.z - P.z) * Math.cos(P.camYaw);
        if (ahead < 500) problems.push(`(${P.x}, ${P.z}) from ${Math.round((a * 180) / Math.PI)}: the camera ${Math.round(ahead)} toward its side`);
        // Up to its top, then a jump off it (away from its side, and back over it): unhurt.
        for (let k = 0; k < 400 && p.action !== 'pole_top'; k++) tick({ stickY: 1 });
        if (p.action !== 'pole_top' || p.pos.y - O.y < P.y1 - 5) problems.push(`(${P.x}, ${P.z}) from ${Math.round((a * 180) / Math.PI)}: not on its top (${p.action}, ${Math.round(p.pos.y - O.y)})`);
        for (let k = 0; k < 10; k++) tick({});
        tick({ ...toward(cam, a), A: true });
        for (let k = 0; k < 150 && !(p.grounded && k > 5); k++) tick({ ...toward(cam, a), A: true });
        for (let k = 0; k < 30; k++) tick({});
        if (p.health !== MAX_HEALTH) problems.push(`(${P.x}, ${P.z}) from ${Math.round((a * 180) / Math.PI)}: hurt jumping off (${p.health})`);
      }
      if (sides < 2) problems.push(`(${P.x}, ${P.z}): ${sides} open sides`);
    }
    assert.deepEqual(problems, []);
  }));
}

for (const [label, prof] of CAMERAS) {
  test('the red-leaf tree (P2 fix): climbed from the street to its top, Jonas is seen whole from the pole\'s camera, no blob of its crown across the view of him (the crown\'s underside lifted over him on the street\'s side)' + label, withCamera(prof, () => {
    const T = lane.RED_TREE;
    const blobs = redTreeCrown(T);
    // (Each blob whole: the realistic look's leaves fill it, the classic look's three lumps
    // stand inside it; the realistic look's hero 0.85 of the size.)
    const tall = prof ? 0.85 : 1;
    const { p, ctl, at } = hero(T.x, GROUND, T.z - 300, 0);
    const cam = camera(p);
    const tick = (input) => {
      const c = ctl.next(input);
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
    };
    for (let k = 0; k < 200 && p.action !== 'pole'; k++) {
      const q = at();
      tick({ ...toward(cam, Math.atan2(T.x - q.x, T.z - q.z)), A: Math.hypot(q.x - T.x, q.z - T.z) < 130 && p.grounded });
    }
    assert.equal(p.action, 'pole');
    for (let k = 0; k < 400 && p.action !== 'pole_top'; k++) tick({ stickY: 1 });
    assert.equal(p.action, 'pole_top');
    const hidden = new Set();
    for (let k = 0; k < 150; k++) {
      tick({});
      if (k % 10) continue;
      const c = local(cam.pos);
      for (const h of [10, 80, 140, 185]) {
        const e = [T.x, T.y1 + h * tall, T.z];
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const q = [c.x + (e[0] - c.x) * t, c.y + (e[1] - c.y) * t, c.z + (e[2] - c.z) * t];
          blobs.forEach((b, j) => {
            if (Math.hypot((q[0] - b.c[0]) / b.r[0], (q[1] - b.c[1]) / b.r[1], (q[2] - b.c[2]) / b.r[2]) < 1) hidden.add(`blob ${j} over his ${h}`);
          });
        }
      }
    }
    assert.deepEqual([...hidden], []);
  }));
}

for (const [label, prof] of CAMERAS) {
  test('the side yards between the villas: walked up to the back gardens and back (turning round in them) with the follow camera, it is never in a solid and seldom trapped; C-button swings in them, under the carport and on the roof never put it in a solid' + label, withCamera(prof, () => {
    const yards = lane.PLOTS_N.slice(0, 4).map((pl) => pl.x1); // (W2: on the plots' edges)
    const out = [];
    for (const x of yards) {
      const z0 = lane.wallZAt(x) - 200;
      const { p, ctl, at } = hero(x, lane.TERRACE, z0, Math.PI);
      const cam = camera(p);
      let trapped = 0;
      let occluded = 0;
      const leg = (tz, n) => {
        for (let t = 0; t < n && Math.abs(at().z - tz) > 60; t++) {
          const q = at();
          const c = ctl.next(toward(cam, Math.atan2(x - q.x, tz - q.z)));
          p.update(cam.playerInput(c), cam.getYaw());
          cam.update(c, p);
          if (cam.collider.trapped) trapped++;
          if (cam.collider.occluded) occluded++;
          if (insideSolid(cam.pos)) out.push(`yard ${x}: the camera in a solid at ${JSON.stringify(local(cam.pos))}`);
        }
      };
      const back = lane.flatZAt(x) + 120; // (the back gardens behind the villas)
      leg(back, 400);
      if (at().z > back + 300) out.push(`yard ${x}: stuck at ${JSON.stringify(at())}`);
      leg(z0, 300);
      if (at().z < z0 - 200) out.push(`yard ${x}: not back at ${JSON.stringify(at())}`);
      if (trapped > 35) out.push(`yard ${x}: trapped ${trapped} ticks (occluded ${occluded})`);
    }
    // C-button swings round him in the yards, under the carport and on the roof, facing 8 ways.
    const spots = [...yards.map((x, k) => [x, lane.TERRACE, [-2400, -2600, -2200, -2500][k]]), [2050, GROUND, lane.GARAGE.wall + 350], [0, DAD.ridge - 40, 1860]];
    for (const [x, y, z] of spots) {
      for (let k = 0; k < 8; k++) {
        const { p, ctl } = hero(x, y, z, (k / 8) * Math.PI * 2);
        const cam = camera(p);
        for (const button of ['CL', 'CL', 'CL', 'CR', 'CR', 'CR', 'CR', 'CR', 'CR']) {
          for (let t = 0; t < 12; t++) {
            const c = ctl.next(t === 0 ? { [button]: true } : {});
            p.update(cam.playerInput(c), cam.getYaw());
            cam.update(c, p);
            if (insideSolid(cam.pos)) {
              out.push(`swing at (${x}, ${y}, ${z}) facing ${k}: the camera in a solid at ${JSON.stringify(local(cam.pos))}`);
              break;
            }
          }
        }
      }
    }
    assert.deepEqual(out.slice(0, 10), [], `${out.length} problems`);
  }));
}

test('privacy and originality: the course\'s sources name no one but Jonas on its signs, carry no house numbers or licence plates on them, and paint every texture in code (no image files)', () => {
  const dir = new URL('../src/world/lane/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['build.js', 'door.js', 'ends.js', 'facades.js', 'garage.js', 'houses.js', 'index.js', 'layout.js', 'props.js', 'surface.js', 'textures.js']); // (W6: facades.js, the north villas' programs; W7: surface.js, the street's wear and kerbside furniture; W8: ends.js, the two ends' garden things, hedges and far houses)
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/\.(png|jpe?g|webp|gif)\b/i.test(src), `${f}: no image files`);
    assert.ok(!/TextureLoader|new Image\b|ImageLoader/.test(src), `${f}: no loaded images`);
    // (Swedish plates: three letters, two digits and a digit or letter.)
    assert.ok(!/\b[A-Z]{3} ?\d{2}[0-9A-Z]\b/.test(src), `${f}: no licence plates`);
  }
  const words = new Set(['Sparrow', 'Lane', 'SPARROW', 'LANE', 'Welcome', 'Jonas', 'A', 'Something', 'Try', 'Villas', 'Every', 'The', 'That', 'Up', 'Jump']);
  for (const s of lane.SIGNS) {
    for (const page of s.pages) {
      assert.ok(!/\d/.test(page) && !/plate/i.test(page), `${s.id}: no numbers or plates in "${page}"`);
      for (const w of page.match(/\b[A-Z][a-zA-Z]*\b/g) ?? []) assert.ok(words.has(w), `${s.id}: "${w}" is no name but Jonas`);
    }
  }
  // Houses go by neutral ids.
  for (const h of [...lane.HOUSES, ...lane.PLOTS_N]) assert.match(h.id, /^(north|south|east)_(\d|west|dad|garage|house)(_wing|_west|_east)?$/, h.id);
});

test('the look: the sun low in the west-south-west; the villas\' street faces lit, the chain houses\' in shade; the dad\'s walls Falu red under a dark roof', () => {
  const S = lane.LANE_SUN;
  // (The photos' golden hour: 45 deg from +z toward -x, ~12 deg up; not above ~14: W1.)
  const turn = (Math.atan2(-S.x, S.z) * 180) / Math.PI;
  const up = (Math.asin(S.y) * 180) / Math.PI;
  assert.ok(Math.abs(Math.hypot(S.x, S.y, S.z) - 1) < 1e-9 && turn > 35 && turn < 55 && up > 10 && up < 14, `${JSON.stringify(S)}: ${turn.toFixed(1)} deg toward -x, ${up.toFixed(1)} up`);
  assert.equal(AREA_DEFS.lane.atmosphere.sunDir, S);
  // The realistic look's own sun (R2-2): the same azimuth, lower (8-14 deg up): the photos' street
  // in the south houses' long shadow (~5 deg in the photos, lifted for play: the arrival and the
  // street readable); its preset's sun and the actors' the same.
  const R = lane.LANE_REAL_SUN;
  const rTurn = (Math.atan2(-R.x, R.z) * 180) / Math.PI;
  const rUp = (Math.asin(R.y) * 180) / Math.PI;
  assert.ok(Math.abs(Math.hypot(R.x, R.y, R.z) - 1) < 1e-9 && Math.abs(rTurn - turn) < 0.01 && rUp >= 8 && rUp <= 14, `the realistic sun: ${rTurn.toFixed(1)} deg toward -x, ${rUp.toFixed(1)} up`);
  assert.ok(lane.LANE_REAL.sunDir === R && lane.LANE_REAL.atmosphere.sunDir === R);
  // Mean brightness of a mesh's vertices on faces looking along `n`, in a box.
  const mean = (name, n, test) => {
    const g = mesh(name).geometry.attributes;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < g.position.count; i++) {
      const [nx, ny, nz] = [g.normal.getX(i), g.normal.getY(i), g.normal.getZ(i)];
      if (nx * n[0] + ny * n[1] + nz * n[2] < 0.95) continue;
      if (!test(g.position.getX(i), g.position.getY(i), g.position.getZ(i))) continue;
      sum += (g.color.getX(i) + g.color.getY(i) + g.color.getZ(i)) / 3;
      count++;
    }
    assert.ok(count > 0, name);
    return sum / count;
  };
  // The villas' white rendered fronts (their lower floors) against the dad's white brick plinth
  // (the same near-white tints, shaded alike toward their feet): the bake's light on each.
  const villas = mean('lane-render', [0, 0, 1], (x, y, z) => y < 400 && lane.VILLAS.some((v) => Math.abs(z - v.front) < 0.5 && Math.abs(x - v.cx) <= v.w / 2 + 1));
  const dad = mean('lane-brick', [0, 0, -1], (x, y, z) => Math.abs(z - DAD.z0) < 0.5 && x > DAD.x0 && x < DAD.x1);
  assert.ok(villas > 1.4 * dad, `villas' fronts ${villas.toFixed(3)} vs the dad's ${dad.toFixed(3)}`);
  // The dad's front: Falu red boards; his roof dark.
  const g = mesh('lane-boards').geometry.attributes;
  let red = 0;
  let all = 0;
  for (let i = 0; i < g.position.count; i++) {
    const [x, y, z] = [g.position.getX(i), g.position.getY(i), g.position.getZ(i)];
    if (Math.abs(z - DAD.z0) > 1 || x < DAD.x0 + 1 || x > DAD.x1 - 1 || y < 160) continue;
    all++;
    if (g.color.getX(i) > 2.5 * g.color.getY(i) && g.color.getX(i) > 2.5 * g.color.getZ(i)) red++;
  }
  assert.ok(all > 0 && red === all, `${red} of ${all} red`);
  const roof = mean('lane-roof', [0, 1, 0], () => true);
  const dadRoof = mean('lane-roof', [0, 0.94, -0.34], (x, y, z) => x > DAD.x0 - 100 && x < DAD.x1 + 100 && z > DAD.z0 - 100 && z < DAD.ridgeZ + 1);
  assert.ok(dadRoof < 0.12, `the dad's roof ${dadRoof.toFixed(3)} (all roofs' tops ${roof.toFixed(3)})`);
  // The red-leaf tree (W3: an old purple-leaved crab apple): its wide open crown from under the
  // eaves to well over the ridge (the canopy's y0..y1, out to about its r) in several reds.
  const T = lane.RED_TREE;
  const r = mesh('lane-render').geometry.attributes;
  const tones = new Set();
  let [lo, hi, wide] = [Infinity, -Infinity, 0];
  for (let i = 0; i < r.position.count; i++) {
    const [x, y, z] = [r.position.getX(i), r.position.getY(i), r.position.getZ(i)];
    const d = Math.hypot(x - T.x, z - T.z);
    const [cr, cg, cb] = [r.color.getX(i), r.color.getY(i), r.color.getZ(i)];
    if (d > T.canopy.r + 110 || y < 300 || cr < 2 * cg) continue;
    [lo, hi, wide] = [Math.min(lo, y), Math.max(hi, y), Math.max(wide, d)];
    tones.add(`${Math.round((10 * cg) / cr)},${Math.round((10 * cb) / cr)}`);
  }
  assert.ok(lo > T.canopy.y0 - 60 && lo < DAD.eave && hi > DAD.ridge && hi < T.canopy.y1 + 40 && wide < T.canopy.r + 130, `the crown from ${lo.toFixed(0)} to ${hi.toFixed(0)}, ${wide.toFixed(0)} wide`);
  assert.ok(tones.size >= 3, `${tones.size} reds: ${[...tones]}`);
});

test('the dad\'s car and the bins: their colliders the static build\'s, named (dad_ev: its body and cabin; bin_0, bin_1: a box each), the car drawn last into lane-render (part.hide: hiding from its first vertex removes exactly its faces), the bins one instanced mover at home', () => {
  const c = lane.CARS.find((k) => k.id === 'dad_ev');
  const K = lane.CAR_KINDS[c.kind];
  const w = (s) => [s.a, s.b, s.c].map(([x, y, z]) => [x - O.x, y - O.y, z - O.z]);
  assert.equal(area.named.dad_ev.surfaces.length, 20, 'two convex solids');
  for (const s of area.named.dad_ev.surfaces) for (const [x, , z] of w(s)) assert.ok(Math.abs(x - c.x) <= K.w / 2 + 0.01 && Math.abs(z - c.z) <= K.l / 2 + 0.01, 'within its footprint');
  for (const [i, b] of lane.BINS.entries()) {
    const named = area.named[`bin_${i}`];
    assert.equal(named.surfaces.length, 10, `bin_${i}: its top and four walls`);
    for (const s of named.surfaces) for (const [x, y, z] of w(s)) assert.ok(Math.abs(x - b.x) <= lane.BIN.x / 2 && Math.abs(z - b.z) <= lane.BIN.z / 2 && y <= lane.BIN.top, `bin_${i}: its box`);
    assert.equal(named.rest.length, 90);
  }
  const part = area.parts[0];
  const first = part.hide.dad_ev['lane-render'];
  const p = mesh('lane-render').geometry.attributes.position.array;
  const inCar = (i, pad) => Math.abs(p[i] - c.x) < K.w / 2 + pad && Math.abs(p[i + 2] - c.z) < K.l / 2 + pad;
  assert.ok(first > 0 && first < p.length / 3);
  for (let i = first * 3; i < p.length; i += 3) assert.ok(inCar(i, 25), 'its range only the car\'s');
  for (let i = 0; i < first * 3; i += 3) assert.ok(!(inCar(i, 2) && p[i + 1] > GROUND + 3), 'nothing of it before its range');
  const bins = part.movers.bins;
  assert.equal(bins.count, 2);
  const m = new THREE.Matrix4();
  for (const [i, b] of lane.BINS.entries()) {
    bins.getMatrixAt(i, m);
    assert.deepEqual([m.elements[12], m.elements[13], m.elements[14]], [b.x, GROUND, b.z], `bin ${i} at home`);
  }
  assert.ok(part.movers.charger_cable.isMesh, 'the charger\'s cable');
  // Without the chunk (nothing attaches it here) the lane is as it was: the bins stand still.
  const { p: hero, om } = hero2(lane.BINS[0].x, GROUND, 1480, 0);
  assert.equal(om.bins, null);
  assert.equal(hero.binGrip, null, 'no grip: B punches');
});

function hero2(x, y, z, yaw) {
  const events = new Events();
  const p = new Player({ collision: area.collision, events, spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events, layout: area.objectsLayout, player: p, area: 'lane' });
  return { p, om };
}
