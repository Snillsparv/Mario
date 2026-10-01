// The Great Hall (world/hall/*), built as the game builds it (world/area.js buildArea at the
// hall's origin) with the real Player, CameraController and ObjectManager: its budgets (meshes,
// triangles, colliders, build time; the hall's objects too), a closed room (every ray from the
// open air inside hits a face looking back at it), no spot to stand on under a ceiling lower
// than HEADROOM, jump / crouch / attack spam that never gets Jonas (or the camera) out of the
// room, its entries (a floor with headroom, the camera behind him at the front door and in
// front of him on the landing, a walk from the front door up to the landing without the camera
// getting stuck), walks round the bottle's end and C-button swings by the furniture that never
// trap the camera or take it into a solid, the routes (the stairs, the cork and the books up
// to the landing, wall kicks up the slot collecting its coins, the banner pole's top onto the
// buttress for any aim near the wall's, the hop over the slot onto the mantel to the 1-up),
// signs read from the front only, every coin over a floor, the doors' triggers on their faces
// (the bottle's mouth into the first course), and the look's promises (the transparent glass
// with its rim, the flickering flames, the lamp hidden until lit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as hall from '../src/world/hall/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { makeRng, wrapAngle } from '../src/core/math.js';
import { PLAYER_HEIGHT } from '../src/core/constants.js';

const O = AREA_DEFS.hall.origin;
const t0 = performance.now();
const area = buildArea(new THREE.Scene(), AREA_DEFS.hall);
const buildMs = performance.now() - t0;
const col = area.collision;
const { HALL } = hall;

// Local (hall) <-> world coordinates.
const world = (x, y, z) => ({ x: x + O.x, y: y + O.y, z: z + O.z });
const local = (p) => ({ x: p.x - O.x, y: p.y - O.y, z: p.z - O.z });
const inRoom = (p, slack = 0) =>
  Math.abs(p.x) <= HALL.halfX + slack && p.z >= HALL.northZ - slack && p.z <= HALL.southZ + slack && p.y >= -slack && p.y <= HALL.ceilingY + slack;

// Jonas standing idle at a local point (with the hall's signs), his scripted controller, and
// (with objects) the hall's own ObjectManager and the events it emitted.
function hero(x, y, z, yaw, { objects = false } = {}) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'oneUp', 'signRead']) events.on(name, () => log.push(name));
  const p = new Player({ collision: col, events, spawn: { ...world(x, y, z), yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = objects ? new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'hall' }) : null;
  // One tick with the camera looking along `yaw` (so stickY pushes him that way).
  const tick = (input, yaw) => {
    p.update(ctl.next(input), yaw);
    om?.update({ player: p });
  };
  return { p, ctl, om, log, tick, at: () => local(p.pos) };
}

function camera(p, opts) {
  const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events: new Events() });
  cam.reset(p, opts);
  return cam;
}

// Whether a world point lies inside a solid: two or more of the six axis rays from it hit a face
// from behind.
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => ({ x, y, z }));
function insideSolid(p) {
  let back = 0;
  for (const d of AXES) {
    const hit = col.raycast(p, d, 6000);
    if (hit && hit.normal.x * d.x + hit.normal.y * d.y + hit.normal.z * d.z > 0) back++;
  }
  return back >= 2;
}

// Whether a local point lies inside (or within `pad` of) a piece of furniture standing in the
// room: the chimney breast, the buttress, the landing and the stairs, the books, the cork, the
// chart table, the signposts, the cradles, the bottle and the stand under it.
function inFurniture({ x, y, z }, pad = 10) {
  const box = (x0, x1, y0, y1, z0, z1) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad && z > z0 - pad && z < z1 + pad;
  const post = (cx, cz, r, top) => Math.hypot(x - cx, z - cz) < r + pad && y < top + pad;
  const { CHIMNEY: C, BUTTRESS: T, LANDING: L, STAIRS: S, BOOKS: K, CORK, CHART_TABLE, CRADLES: R, BOTTLE: B } = hall;
  if (box(C.x0, C.x1, 0, C.top, C.z0, C.z1) || box(T.x0, T.x1, 0, T.top, T.z0, T.z1) || box(L.x0, L.x1, 0, L.top, L.z0, L.z1)) return true;
  if (box(S.x0 - S.stringer, S.x1 + S.stringer, 0, S.top, S.z1, S.z0) && y < (S.top * (S.z0 - z)) / (S.z0 - S.z1) + pad) return true;
  if (K.stack.some((b) => box(b.x0, K.x1, 0, b.top, K.z0, K.z1))) return true;
  if (post(CORK.x, CORK.z, CORK.r, CORK.top) || post(CHART_TABLE.x, CHART_TABLE.z, CHART_TABLE.r, CHART_TABLE.top)) return true;
  if (hall.SIGNS.some((s) => post(s.x, s.z, 100, s.y + 220))) return true;
  if (R.zs.some((cz) => box(-R.halfX, R.halfX, 0, R.cheekTop, cz - R.depth / 2, cz + R.depth / 2))) return true;
  if (z < B.body[0] - pad || z > B.lip[1] + pad) return false;
  const k = (z - B.shoulder[0]) / (B.shoulder[1] - B.shoulder[0]);
  const r = z < B.shoulder[0] ? B.bodyR : z < B.shoulder[1] ? B.bodyR + (B.neckR - B.bodyR) * k : z < B.lip[0] ? B.neckR : B.lipR;
  return Math.hypot(x, y - B.axisY) < r + pad || (Math.abs(x) < r && y < B.axisY);
}

// Stick input that walks him along world yaw `yaw` with the camera where it is.
function toward(cam, yaw) {
  const a = wrapAngle(cam.getYaw() - yaw);
  return { stickX: Math.sin(a), stickY: Math.cos(a) };
}

const meshes = [];
area.root.traverse((o) => o.isMesh && meshes.push(o));
const mesh = (name) => meshes.find((m) => m.name === name);

test('budgets: at most 10 meshes with baked colours, under 12k triangles and 1.5k collider triangles of stone and wood, built in under a second', () => {
  assert.ok(meshes.length <= 10, `${meshes.length} meshes`);
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    assert.ok(g.attributes.color, `${m.name} has vertex colours`);
    assert.ok(g.attributes.position.count > 0, `${m.name} has vertices`);
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  assert.ok(tris < 12000, `${tris} triangles`);
  const colliders = area.parts.flatMap((p) => p.colliders);
  const colliderTris = colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(colliderTris < 1500, `${colliderTris} collider triangles`);
  assert.deepEqual([...new Set(colliders.map((c) => c.terrain))].sort(), ['stone', 'wood']);
  assert.deepEqual([...new Set(colliders.map((c) => c.surface).filter(Boolean))].sort(), ['not_slippery', 'slippery'], 'the glass, the stairs');
  assert.ok(buildMs < 1000, `built in ${buildMs.toFixed(0)} ms`);
});

test('a closed room: from 30 points in the open air inside (12 seeded draws), every ray in 26 directions hits a face looking back at it', () => {
  const dirs = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      for (const dz of [-1, 0, 1]) {
        const l = Math.hypot(dx, dy, dz);
        if (l > 0) dirs.push({ x: dx / l, y: dy / l, z: dz / l });
      }
    }
  }
  const bad = [];
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed);
    const points = [];
    while (points.length < 30) {
      const l = { x: (rng() * 2 - 1) * (HALL.halfX - 100), y: 50 + rng() * (HALL.ceilingY - 150), z: HALL.northZ + 100 + rng() * (HALL.southZ - HALL.northZ - 200) };
      // Open air: not in a piece of furniture (every ray from inside a solid meets the back of
      // its faces) and nothing within 60 of it either way.
      const p = world(l.x, l.y, l.z);
      if (!inFurniture(l) && dirs.every((d) => !col.raycast(p, d, 60))) points.push(p);
    }
    for (const p of points) {
      for (const d of dirs) {
        const hit = col.raycast(p, d, 20000);
        if (!hit || hit.normal.x * d.x + hit.normal.y * d.y + hit.normal.z * d.z >= 0) bad.push(`seed ${seed}: ${JSON.stringify(local(p))} -> ${JSON.stringify(d)}: ${hit ? 'back face' : 'no hit'}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test(`no spot he can stand on lies under a ceiling lower than HEADROOM (${hall.HEADROOM}): the stand and the cradles leave no ledge under the glass`, () => {
  // Every floor on a grid over the room, from the ceiling down: room for him under its ceiling
  // but less than HEADROOM is a pocket, unless the spot lies inside a solid (the floor under
  // the stand, a cradle's top under its cheek).
  const pockets = [];
  for (let x = -HALL.halfX + 7; x < HALL.halfX; x += 20) {
    for (let z = HALL.northZ + 7; z < HALL.southZ; z += 20) {
      for (let y = HALL.ceilingY - 10; ; ) {
        const floor = col.findFloor(x + O.x, y + O.y, z + O.z, 0);
        if (!floor.surface || floor.y - O.y < -50) break;
        const room = col.findCeil(x + O.x, floor.y + 80, z + O.z).y - floor.y;
        if (room >= PLAYER_HEIGHT && room < hall.HEADROOM && !insideSolid({ x: x + O.x, y: floor.y + 1, z: z + O.z })) {
          pockets.push(`(${x}, ${Math.round(floor.y - O.y)}, ${z}): ${Math.round(room)} of room`);
        }
        y = floor.y - O.y - 1;
      }
    }
  }
  assert.deepEqual(pockets.slice(0, 12), [], `${pockets.length} spots`);
});

test('jump, crouch and attack spam (6 seeded runs of 900 ticks) never gets Jonas or the camera out of the room', () => {
  const starts = [[0, 0, 1550], [hall.ONE_UP.x, hall.CHIMNEY.top, hall.ONE_UP.z], [0, hall.LANDING.top, -1150], [hall.CORK.x, hall.CORK.top, hall.CORK.z], [hall.CHART_TABLE.x, hall.CHART_TABLE.top, hall.CHART_TABLE.z], [-1975, hall.BUTTRESS.top, -1850]];
  const out = [];
  starts.forEach(([x, y, z], run) => {
    const rng = makeRng(1000 + run);
    const { p, ctl } = hero(x, y, z, rng() * Math.PI * 2);
    const cam = camera(p);
    let sx = 0;
    let sy = 1;
    for (let i = 0; i < 900; i++) {
      if (i % 20 === 0) {
        const a = rng() * Math.PI * 2;
        sx = Math.sin(a);
        sy = Math.cos(a);
      }
      const c = ctl.next({ stickX: sx, stickY: sy, A: rng() < 0.3, Z: rng() < 0.05, B: rng() < 0.05 });
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      if (p.action === 'reading') p.endReading();
      if (!inRoom(local(p.pos))) {
        out.push(`run ${run} tick ${i}: Jonas at ${JSON.stringify(local(p.pos))} (${p.action})`);
        break;
      }
      if (!inRoom(local(cam.pos))) {
        out.push(`run ${run} tick ${i}: camera at ${JSON.stringify(local(cam.pos))}`);
        break;
      }
    }
  });
  assert.deepEqual(out, []);
});

test('each entry stands on a floor with at least 900 of headroom', () => {
  for (const [id, e] of Object.entries(area.entries)) {
    const floor = col.findFloor(e.x, e.y + 10, e.z);
    assert.ok(floor.surface && Math.abs(floor.y - e.y) < 1, `${id}: on its floor (${floor.y - O.y})`);
    const ceil = col.findCeil(e.x, e.y + 10, e.z);
    assert.ok(ceil.y - e.y >= 900, `${id}: ${ceil.y - e.y} of headroom`);
  }
});

test('the front entry: the camera behind him, clear; the walk on north up the stairs onto the landing never traps it', () => {
  const e = hall.ENTRIES.front;
  const { p, ctl, at } = hero(e.x, e.y, e.z, e.yaw);
  const cam = camera(p);
  const c0 = local(cam.pos);
  assert.ok(c0.z > e.z + 1000 && Math.abs(c0.x) < 50, `camera behind him: ${JSON.stringify(c0)}`);
  assert.equal(cam.collider.occluded, false);
  let trapped = 0;
  let occluded = 0;
  for (let i = 0; i < 90; i++) {
    const c = ctl.next({ stickY: 1 });
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
    if (cam.collider.trapped) trapped++;
    if (cam.collider.occluded) occluded++;
    assert.ok(inRoom(local(cam.pos)), `tick ${i}: camera in the room`);
  }
  assert.equal(trapped, 0, 'trapped ticks');
  assert.equal(occluded, 0, 'occluded ticks');
  const end = at();
  assert.ok(Math.abs(end.y - hall.LANDING.top) < 1 && end.z < hall.LANDING.z1 && p.grounded, `on the landing: ${JSON.stringify(end)} (${p.action})`);
});

test("the bottle entry: he drops onto the landing facing south with the camera south of him (camYaw 0), clear", () => {
  const e = area.entries.bottle;
  const { p, ctl, at } = hero(0, 0, 0, 0);
  p.placeAt(e);
  assert.equal(p.action, 'spawn');
  const cam = camera(p, { yaw: e.camYaw });
  for (let i = 0; i < 40; i++) {
    const c = ctl.next({});
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
  }
  const end = at();
  assert.ok(Math.abs(end.y - hall.LANDING.top) < 1 && Math.abs(end.z - hall.ENTRIES.bottle.z) < 1, `on the landing: ${JSON.stringify(end)}`);
  const c = local(cam.pos);
  assert.ok(c.z > end.z + 800 && Math.abs(c.x) < 50, `camera south of him: ${JSON.stringify(c)}`);
  assert.equal(cam.collider.occluded, false);
});

test("walks along the north wall into the bottle's end and into its flanks never trap the camera (no corridor behind it)", () => {
  // (With the bottle's end 200 off the wall, the walk back out of the corridor behind it
  // trapped the camera for 46 ticks.)
  const [N, E, W] = [Math.PI, Math.PI / 2, -Math.PI / 2];
  // [what, start (x, z), legs [world yaw, ticks]]
  const walks = [
    ['west along the north wall, and back', [1200, -4100], [[W, 120], [E, 120]]],
    ['east along the north wall, and back', [-1200, -4100], [[E, 120], [W, 120]]],
    ['north up the east side, then west into the flank', [900, -2600], [[N, 70], [W, 80]]],
    ['north up the west side, then east into the flank', [-900, -2600], [[N, 70], [E, 80]]],
  ];
  const trapped = [];
  for (const [what, [x, z], legs] of walks) {
    const { p, ctl } = hero(x, 0, z, legs[0][0]);
    const cam = camera(p);
    let n = 0;
    for (const [yaw, ticks] of legs) {
      for (let i = 0; i < ticks; i++) {
        const c = ctl.next(toward(cam, yaw));
        p.update(cam.playerInput(c), cam.getYaw());
        cam.update(c, p);
        if (cam.collider.trapped) n++;
      }
    }
    if (n) trapped.push(`${what}: ${n} ticks`);
  }
  assert.deepEqual(trapped, []);
});

test('C-button swings round Jonas by the bottle and the furniture never take the camera into a solid', () => {
  // A full turn of the orbit (C-left every 20 ticks) at the bottle's mouth, east of its body, on
  // the stairs by its neck, by the chimney breast's south corner and by the landing's north face.
  const spots = [[-300, hall.LANDING.top, -1400], [1200, 0, -2600], [-300, 330, -500], [-1200, 0, -200], [-1200, 0, -1400]];
  const inside = [];
  for (const [x, y, z] of spots) {
    const { p, ctl } = hero(x, y, z, 0);
    const cam = camera(p);
    for (let i = 0; i < 9 * 20; i++) {
      const c = ctl.next({ CL: i % 20 === 0 && i > 0 });
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      if (insideSolid(cam.pos)) inside.push(`from (${x}, ${y}, ${z}) tick ${i}: camera at ${JSON.stringify(local(cam.pos))}`);
    }
  }
  assert.deepEqual(inside, []);
});

test('routes: the cork and the stack of books both lead up onto the landing', () => {
  // The cork: a run west across its top and a jump at its edge.
  const west = -Math.PI / 2;
  const cork = hero(hall.CORK.x + 140, hall.CORK.top, hall.CORK.z, west);
  let jumped = false;
  for (let i = 0; i < 60 && !(jumped && cork.p.grounded); i++) {
    if (!jumped && cork.at().x < hall.CORK.x - 60 && cork.p.grounded) jumped = true;
    cork.tick({ stickY: 1, A: jumped }, west);
  }
  const c = cork.at();
  assert.ok(Math.abs(c.y - hall.LANDING.top) < 1 && c.x < hall.LANDING.x1, `cork -> landing: ${JSON.stringify(c)}`);

  // The books: a walk east, a jump up onto each book in turn, then onto the landing.
  const east = Math.PI / 2;
  const books = hero(-1550, 0, (hall.BOOKS.z0 + hall.BOOKS.z1) / 2, east);
  const edges = [...hall.BOOKS.stack.map((b) => b.x0), hall.BOOKS.x1];
  const floors = [];
  let next = 0;
  let hold = 0;
  for (let i = 0; i < 300; i++) {
    let A = hold > 0;
    if (hold > 0) hold--;
    else if (next < edges.length && books.at().x > edges[next] - 150 && books.p.grounded) {
      A = true;
      hold = 8;
      next++;
    }
    books.tick({ stickY: 0.7, A }, east);
    const y = Math.round(books.at().y);
    if (books.p.grounded && floors.at(-1) !== y) floors.push(y);
    if (y === hall.LANDING.top && books.p.grounded) break;
  }
  assert.deepEqual(floors, [0, ...hall.BOOKS.stack.map((b) => b.top), hall.LANDING.top], 'book by book');
});

test('routes: wall kicks up the slot reach the top (collecting its three coins); the banner pole\'s top jump lands on the buttress and he stays there', () => {
  // Kicking back and forth across the slot (the kick.mjs script), from the middle of its depth.
  const { SLOT } = hall;
  const kick = hero((hall.CHIMNEY.x0 + hall.CHIMNEY.x1) / 2, 0, SLOT.z0 + 60, 0, { objects: true });
  let dir = 1;
  let kicks = 0;
  let top = 0;
  for (let i = 0; i < 300; i++) {
    const p = kick.p;
    const hit = p.action === 'air_hit_wall';
    if (hit) {
      dir = -dir;
      kicks++;
    }
    const mid = Math.abs(kick.at().z - (SLOT.z0 + SLOT.z1) / 2) < (SLOT.z1 - SLOT.z0) / 2 - 40;
    kick.tick({ stickY: dir, A: hit || (p.grounded && i > 2 && mid && kicks === 0 && p.forwardVel > 8) }, 0);
    top = Math.max(top, kick.at().y);
    if (p.grounded && kicks > 0 && i > 20) break;
  }
  assert.ok(kicks >= 4, `${kicks} kicks`);
  assert.ok(top >= hall.CHIMNEY.top, `up to ${top.toFixed(0)}`);
  assert.equal(kick.log.filter((e) => e === 'coin').length, 3, 'the slot\'s coins');

  // The pole: a running jump onto it, the climb to its top, then the jump off toward the wall
  // over the buttress, aimed straight at it or up to 15 degrees either side: he lands on the
  // buttress and stays up there, let go or still pushing on.
  const P = hall.BANNER_POLE;
  const B = hall.BUTTRESS;
  const yaw = Math.atan2((B.x0 + B.x1) / 2 - P.x, (B.z0 + B.z1) / 2 - P.z);
  const off = [];
  for (const deg of [-15, -10, 0, 10, 15]) {
    const aim = yaw + (deg * Math.PI) / 180;
    const pole = hero(P.x - Math.sin(yaw) * 250, 0, P.z - Math.cos(yaw) * 250, yaw);
    pole.tick({ stickY: 1 }, yaw);
    for (let k = 0; k < 60 && pole.p.action !== 'pole'; k++) pole.tick({ stickY: 1, A: k === 3 }, yaw);
    assert.equal(pole.p.action, 'pole', 'grabbed it');
    for (let k = 0; k < 400 && pole.p.action !== 'pole_top'; k++) pole.tick({ stickY: 1 }, yaw);
    assert.equal(pole.p.action, 'pole_top', 'up on its top');
    for (let k = 0; k < 4; k++) pole.tick({ stickY: 1 }, aim);
    let landed = null;
    for (let k = 0; k < 150 && !landed; k++) {
      pole.tick({ stickY: 1, A: true }, aim);
      if (k > 3 && (pole.p.grounded || pole.p.action === 'ledge_hang')) landed = pole.at();
    }
    assert.ok(landed && Math.abs(landed.y - B.top) < 1, `${deg} deg: on the buttress: ${JSON.stringify(landed)}`);
    for (const hold of [{}, { stickY: 1 }]) {
      for (let k = 0; k < 30; k++) {
        pole.tick(hold, aim);
        if (pole.at().y < B.top - 1) off.push(`${deg} deg, ${hold.stickY ? 'pushing on' : 'let go'}: off at ${JSON.stringify(pole.at())}`);
      }
    }
  }
  assert.deepEqual(off.slice(0, 5), []);
});

test('routes: from the buttress a running hop over the slot lands on the mantel, where the 1-up waits', () => {
  const B = hall.BUTTRESS;
  const run = hero((B.x0 + B.x1) / 2, B.top, B.z0 + 40, 0, { objects: true });
  let jumped = false;
  for (let i = 0; i < 120 && !run.log.includes('oneUp'); i++) {
    if (!jumped && run.at().z > B.z1 - 60 && run.p.grounded) jumped = true;
    run.tick({ stickY: 1, A: jumped }, 0);
    assert.ok(run.at().y > B.top - 100, `tick ${i}: never down into the slot (${JSON.stringify(run.at())})`);
  }
  assert.ok(run.log.includes('oneUp'), 'the 1-up');
  assert.ok(Math.abs(run.at().y - hall.CHIMNEY.top) < 1, 'on the mantel');
});

test('every sign is read from in front of its face, never from behind', () => {
  const problems = [];
  for (const s of hall.SIGNS) {
    for (const [side, off] of [['front', 0], ['front-left', 0.6], ['front-right', -0.6], ['behind', Math.PI]]) {
      const a = s.yaw + off;
      // As far out as the room allows (the wall-kick sign stands 350 from the chimney breast):
      // nothing between the spot and the signpost's box.
      const clear = (r) => !col.raycast(world(s.x + Math.sin(a) * (r + 60), s.y + 100, s.z + Math.cos(a) * (r + 60)), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, r - 50);
      const d = [400, 250].find(clear);
      const x = s.x + Math.sin(a) * d;
      const z = s.z + Math.cos(a) * d;
      const yaw = Math.atan2(s.x - x, s.z - z);
      const { p, ctl, log } = hero(x, s.y, z, yaw);
      for (let t = 0; t < 90 && Math.hypot(p.pos.x - O.x - s.x, p.pos.z - O.z - s.z) > 95; t++) p.update(ctl.next({ stickY: 1 }), yaw);
      p.update(ctl.next({}), yaw);
      log.length = 0;
      p.update(ctl.next({ B: true }), yaw);
      const want = side === 'behind' ? 'punch' : 'reading';
      if (p.action !== want || log.length !== (side === 'behind' ? 0 : 1)) problems.push(`${s.id} ${side}: ${p.action}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every coin hangs over a floor within 120 (the slot\'s three hang between its walls)', () => {
  assert.equal(hall.COINS.length, 19);
  const { SLOT, CHIMNEY } = hall;
  for (const c of hall.COINS) {
    assert.ok(Number.isFinite(c.y), `${JSON.stringify(c)} has a height`);
    const inSlot = c.z > SLOT.z0 && c.z < SLOT.z1 && c.x > CHIMNEY.x0 && c.x < CHIMNEY.x1;
    if (inSlot) continue;
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y + O.y - floor.y <= 120 && c.y + O.y - floor.y >= 0, `${JSON.stringify(c)}: floor ${floor.y - O.y}`);
  }
  assert.equal(hall.COINS.filter((c) => c.z > SLOT.z0 && c.z < SLOT.z1 && c.x > CHIMNEY.x0 && c.x < CHIMNEY.x1).length, 3);
  const gem = hall.ONE_UP;
  assert.equal(col.findFloor(gem.x + O.x, gem.y + O.y, gem.z + O.z).y - O.y, hall.CHIMNEY.top, 'the 1-up over the mantel');
});

test('every door\'s trigger stands on its face: the inner front door, the two east doors, the bottle\'s mouth', () => {
  assert.deepEqual(hall.DOORS.map((d) => d.id), ['hall_front', 'hall_east_1', 'hall_east_2', 'bottle']);
  for (const d of hall.DOORS) {
    const out = { x: Math.sin(d.yaw), y: 0, z: Math.cos(d.yaw) };
    const from = world(d.x + out.x * 150, d.floorY + 100, d.z + out.z * 150);
    const hit = col.raycast(from, { x: -out.x, y: 0, z: -out.z }, 400, { floors: false, ceilings: false });
    assert.ok(hit && Math.abs(hit.distance - 150) < 1, `${d.id}: face ${hit?.distance}`);
    assert.equal(col.findFloor(from.x, from.y, from.z).y - O.y, d.floorY, `${d.id}: its floor`);
  }
  const shut = hall.DOORS.filter((d) => d.to === null);
  assert.deepEqual(shut.map((d) => [d.id, d.locked.id, d.laugh]), [['hall_east_1', 'hall_door_soon', false], ['hall_east_2', 'hall_door_soon', false]]);
  // The bottle's mouth leads to the first course, out of the bottle's own kind.
  const mouth = hall.DOORS.find((d) => d.id === 'bottle');
  assert.deepEqual([mouth.to, mouth.entry, mouth.kind], ['skerries', 'arrival', 'bottle']);
  assert.ok(AREA_DEFS.skerries.entries[mouth.entry], 'a real entry of the course');
});

test('the look: the glass is see-through (front faces, no depth write) with a rim, the flames flicker with update(time), the lamp waits unlit', () => {
  const glass = mesh('hall-bottle').material;
  assert.equal(glass.transparent, true);
  assert.equal(glass.side, THREE.FrontSide);
  assert.equal(glass.depthWrite, false);
  assert.ok(glass.opacity > 0.1 && glass.opacity < 0.5);
  const glow = mesh('hall-glow');
  const flame = glow.geometry.attributes.flame;
  let flames = 0;
  for (let i = 0; i < flame.count; i++) if (flame.getX(i) > 0) flames++;
  assert.ok(flames >= hall.CHANDELIERS.spots.length * hall.CHANDELIERS.candles * 3, `${flames} flickering vertices`);
  area.update(1.25);
  assert.equal(glow.material.userData.flameTime.value, 1.25);
  // The hooks are in the shaders three.js compiles: the flames' wobble of that time on their
  // vertex colours, the glass's rim from the angle between its faces and the view.
  const compiled = (material) => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader);
    return shader;
  };
  const flicker = compiled(glow.material);
  assert.equal(flicker.uniforms.flameTime, glow.material.userData.flameTime);
  assert.match(flicker.vertexShader, /attribute float flame;/);
  assert.match(flicker.vertexShader, /vColor\.rgb \*= .*sin\(flameTime \* /);
  const rim = compiled(glass);
  assert.match(rim.vertexShader, /vGlassRim = 1\.0 - abs\(dot\(normalize\(normalMatrix \* normal\)/);
  assert.match(rim.fragmentShader, /diffuseColor\.a = mix\(diffuseColor\.a, [0-9.]+, glassRim\);/);
  assert.notEqual(glow.material.customProgramCacheKey(), glass.customProgramCacheKey());
  assert.equal(mesh('hall-lamp').visible, false);
  assert.equal(area.root.getObjectByName('hall').children.length, meshes.length);
});

test("the hall's objects (its coins, the 1-up, their shadows and sparkles) stay within an area's 8 meshes", () => {
  const { om } = hero(0, 0, 1550, Math.PI, { objects: true });
  let n = 0;
  om.group.traverse((o) => o.isMesh && n++);
  assert.ok(n > 0 && n <= 8, `${n} meshes`);
});
