// Sparrow Lane (world/lane/*), built as the game builds it (world/area.js buildArea at the
// course's origin) with the real Player, CameraController and ObjectManager: its budgets (meshes,
// triangles, colliders, build time; the course's own objects too), the arrival out of the dad's
// front door (on the path, facing the street, the camera in front of him over the lawn after the
// walk-in, clear, the star over the ridge in the picture; a lost life's drop onto the path
// unhurt), no water anywhere and a floor everywhere inside the boundary, the boundary holding
// (jump, crouch and attack spam from all over the course, long jumps at full speed off the dad's
// ridge and the junction lamppost's top), the dad's house as measured (its roof's slopes, the
// carport's roof and the room under it) and no floor under a ceiling lower than 300, every coin
// over a floor (exactly 50), the star waiting over the ridge, every sign read from in front only
// (the mailbox is one, with no signpost), the six climbable poles (grabbed from every open side
// with the follow camera, which swings round to the pole's own side; jumping off them never
// hurts), the side yards between the villas walked up and back with the follow camera (never in
// a solid, seldom trapped) and C-button swings there, under the carport and on the roof, the
// privacy and originality rules in the course's sources, and the look (the sun from the
// south-west, the villas' street faces lit, the chain houses' in shade, the dad's walls Falu red
// under a dark roof).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
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

function camera(p, opts) {
  const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events: new Events() });
  cam.reset(p, opts);
  return cam;
}

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

test('budgets: at most 12 meshes named lane-* with baked colours, under 32k triangles and 5k collider triangles, built in under 800 ms; the course\'s objects within 9 meshes', () => {
  assert.ok(meshes.length <= 12, `${meshes.length} meshes`);
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    assert.match(m.name, /^lane-/);
    assert.ok(g.attributes.color, `${m.name} has vertex colours`);
    assert.ok(g.attributes.position.count > 0, `${m.name} has vertices`);
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  assert.ok(tris < 32000, `${tris} triangles`);
  const colliders = area.parts.flatMap((p) => p.colliders);
  const colliderTris = colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(colliderTris < 5000, `${colliderTris} collider triangles`);
  assert.deepEqual([...new Set(colliders.map((c) => c.terrain))].sort(), ['grass', 'stone', 'wood']);
  assert.deepEqual([...new Set(colliders.map((c) => c.surface).filter(Boolean))], ['not_slippery'], 'the steps');
  assert.ok(buildMs < 800, `built in ${buildMs.toFixed(0)} ms`);
  assert.deepEqual(area.parts.map((p) => p.name), ['lane']);
  const { om } = hero(0, GROUND, 900, 0, { objects: true });
  let n = 0;
  om.group.traverse((o) => o.isMesh && n++);
  assert.ok(n > 0 && n <= 9, `${n} object meshes`);
});

test('the arrival: out of the dad\'s front door onto the path facing the street; after the walk-in the camera stands in front of him over the lawn, clear, with the star over the ridge in the picture; a lost life drops him onto the path unhurt', () => {
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
});

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
  const starts = [
    [-8300, GROUND, 1300], // the junction
    [M.cx, GROUND + M.h, M.cz], // the motorhome's roof
    [-3670, lane.TERRACE, -2500], // the side yards
    [-1125, lane.TERRACE, -2300],
    [1485, lane.TERRACE, -2600],
    [3980, lane.TERRACE, -2800],
    [0, 237, -3750], // the forest's edge
    [lane.footpathAt(1150).x, GROUND, lane.footpathAt(1150).z], // the footpath's barrier
    [-250, DAD.ridge, DAD.ridgeZ], // the dad's ridge
    [lane.TURN.x, 0, lane.TURN.z], // the turning area
    [7200, GROUND, 1100], // the east end
    [0, GROUND, 3200], // the back gardens
    [-6500, GROUND, -2500], // behind the north-west villa
    [-6200, GROUND, 3100], // the corner house's garden
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

test('the dad\'s house: its footprint, eaves at 412, its 20-degree roof up to the ridge at 644 over z 1967.5 (raycast down at 9 points on each slope); the carport\'s roof at 370 with 300 or more over its floor; no floor anywhere under a ceiling lower than 300', () => {
  assert.deepEqual([DAD.x0, DAD.x1, DAD.z0, DAD.z1, DAD.eave, Math.round(DAD.ridge), DAD.ridgeZ], [-1100, 1600, 1330, 2605, 412, 644, 1967.5]);
  const tan = Math.tan((20 * Math.PI) / 180);
  for (const x of [-1000, 250, 1500]) {
    for (const z of [1400, 1650, 1900, 2035, 2300, 2550]) {
      const hit = col.raycast(world(x, 2000, z), { x: 0, y: -1, z: 0 }, 3000);
      const want = DAD.ridge - Math.abs(z - DAD.ridgeZ) * tan;
      assert.ok(hit && Math.abs(hit.point.y - O.y - want) < 4, `the roof at (${x}, ${z}): ${hit && hit.point.y - O.y} for ${want.toFixed(0)}`);
    }
    // The eaves: at the walls' tops.
    assert.ok(Math.abs(col.findFloor(x + O.x, 600, DAD.z0 + 2 + O.z).y - O.y - DAD.eave) < 2, `the front eave at ${x}`);
  }
  // The walls stand where the footprint says (a ray along the front at 200 up hits them there).
  const front = col.raycast(world(250, 200, 900), { x: 0, y: 0, z: 1 }, 1000, { floors: false, ceilings: false });
  assert.ok(front && Math.abs(front.point.z - O.z - DAD.z0) < 1, `the front wall at ${front && front.point.z - O.z}`);
  const C = lane.CARPORT;
  assert.equal(col.findFloor(2000 + O.x, 600, 2200 + O.z).y - O.y, C.top);
  const ceil = col.findCeil(2000 + O.x, GROUND + 10, 2200 + O.z).y - O.y;
  assert.ok(ceil - GROUND >= 300 && ceil < C.top, `the room under the carport: ${ceil - GROUND}`);
  // Every floor he can stand on (not too steep) has 300 or more over it, all over the course.
  const low = [];
  for (let x = -9000; x <= 8000; x += 100) {
    for (let z = -4000; z <= 3600; z += 100) {
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

test('50 coins, each over a floor within 120; the star waits over the dad\'s ridge from the start, idle', () => {
  assert.equal(lane.COINS.length, 50);
  for (const c of lane.COINS) {
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y - (floor.y - O.y) <= 120 && c.y - (floor.y - O.y) >= 30, `coin at (${Math.round(c.x)}, ${Math.round(c.y)}, ${Math.round(c.z)}): floor ${floor.y - O.y}`);
    assert.ok(lane.inBounds(c.x, c.z), `coin at (${c.x}, ${c.z}) inside`);
  }
  const S = lane.STAR;
  assert.deepEqual([S.id, S.x, S.y, S.z, S.placed], ['lane_star', -250, 824, 1967.5, true]);
  assert.ok(Math.abs(col.findFloor(S.x + O.x, S.y + O.y, S.z + O.z, 0).y - O.y - 644) < 1, 'over the ridge');
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
  assert.equal(lane.SIGNS.filter((s) => s.post !== false).length * 2, lane.SIGNS.length + 1, 'two signposts');
});

test('six climbable poles, each grabbed from every open side with the follow camera, which swings round to the pole\'s own side (camYaw) as he holds it; jumping off one never hurts', () => {
  const built = col.poles.map((p) => ({ x: p.x - O.x, z: p.z - O.z, y0: p.y0 - O.y, y1: p.y1 - O.y, camYaw: p.camYaw }));
  assert.equal(built.length, 6);
  assert.deepEqual(built, lane.POLES.map(({ x, z, y0, y1, camYaw }) => ({ x, z, y0, y1, camYaw })));
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
      for (let k = 0; k < 10; k++) tick({});
      tick({ ...toward(cam, a), A: true });
      for (let k = 0; k < 150 && !(p.grounded && k > 5); k++) tick({ ...toward(cam, a), A: true });
      for (let k = 0; k < 30; k++) tick({});
      if (p.health !== MAX_HEALTH) problems.push(`(${P.x}, ${P.z}) from ${Math.round((a * 180) / Math.PI)}: hurt jumping off (${p.health})`);
    }
    if (sides < 2) problems.push(`(${P.x}, ${P.z}): ${sides} open sides`);
  }
  assert.deepEqual(problems, []);
});

test('the side yards between the villas: walked up to the back gardens and back (turning round in them) with the follow camera, it is never in a solid and seldom trapped; C-button swings in them, under the carport and on the roof never put it in a solid', () => {
  const yards = [-3670, -1125, 1485, 3980];
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
    leg(-3300, 300);
    if (at().z > -3000) out.push(`yard ${x}: stuck at ${JSON.stringify(at())}`);
    leg(z0, 300);
    if (at().z < z0 - 200) out.push(`yard ${x}: not back at ${JSON.stringify(at())}`);
    if (trapped > 35) out.push(`yard ${x}: trapped ${trapped} ticks (occluded ${occluded})`);
  }
  // C-button swings round him in the yards, under the carport and on the roof, facing 8 ways.
  const spots = [[-3670, lane.TERRACE, -2400], [-1125, lane.TERRACE, -2600], [1485, lane.TERRACE, -2200], [3980, lane.TERRACE, -2500], [2050, GROUND, 2300], [0, DAD.ridge - 40, 1860]];
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
});

test('privacy and originality: the course\'s sources name no one but Jonas on its signs, carry no house numbers or licence plates on them, and paint every texture in code (no image files)', () => {
  const dir = new URL('../src/world/lane/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['build.js', 'door.js', 'houses.js', 'layout.js', 'props.js', 'textures.js']);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/\.(png|jpe?g|webp|gif)\b/i.test(src), `${f}: no image files`);
    assert.ok(!/TextureLoader|new Image\b|ImageLoader/.test(src), `${f}: no loaded images`);
    // (Swedish plates: three letters, two digits and a digit or letter.)
    assert.ok(!/\b[A-Z]{3} ?\d{2}[0-9A-Z]\b/.test(src), `${f}: no licence plates`);
  }
  const words = new Set(['Sparrow', 'Lane', 'SPARROW', 'LANE', 'Welcome', 'Jonas', 'A', 'Something', 'Try', 'Villas', 'Every', 'The', 'That']);
  for (const s of lane.SIGNS) {
    for (const page of s.pages) {
      assert.ok(!/\d/.test(page) && !/plate/i.test(page), `${s.id}: no numbers or plates in "${page}"`);
      for (const w of page.match(/\b[A-Z][a-zA-Z]*\b/g) ?? []) assert.ok(words.has(w), `${s.id}: "${w}" is no name but Jonas`);
    }
  }
  // Houses go by neutral ids.
  for (const h of [...lane.HOUSES, ...lane.PLOTS_N]) assert.match(h.id, /^(north|south|east)_(\d|west|dad|garage|house)(_wing)?$/, h.id);
});

test('the look: the sun low in the south-west; the villas\' street faces lit, the chain houses\' in shade; the dad\'s walls Falu red under a dark roof', () => {
  const S = lane.LANE_SUN;
  assert.ok(S.z > 0.8 && S.y < 0.5 && S.y > 0.2, JSON.stringify(S));
  assert.equal(AREA_DEFS.lane.atmosphere.sunDir, S);
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
});
