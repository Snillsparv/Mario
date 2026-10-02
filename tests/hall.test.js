// The Great Hall (world/hall/*), built as the game builds it (world/area.js buildArea at the
// hall's origin) with the real Player, CameraController and ObjectManager: its budgets (meshes,
// triangles, colliders, build time; the hall's objects too), a closed room (every ray from the
// open air inside hits a face looking back at it; at head height every ray out from the middle
// stops at the round plan's walls or the furniture against them), no spot to stand on under a
// ceiling lower than HEADROOM, jump / crouch / attack spam that never gets Jonas (or the
// camera) out of the room and seldom traps the camera, its entries (a floor with headroom, the
// camera behind him at the front door and in front of him on the dais's top, a walk from the
// front door up the steps of the dais without the camera getting stuck), walks round the
// bottle in the apse and C-button swings by the furniture (whichever way he faces) that never
// trap the camera or take it into a solid, walks into the books' north side whose camera turns
// round the bottle's neck and never into the glass, stepping off the dais's back losing him
// only until the camera turns, the routes (the books and the cork up to the cork's top, wall
// kicks up the slot collecting its coins, the banner pole's top onto the buttress for any aim
// near the wall's, the hop over the slot onto the mantel to the 1-up), signs read from the
// front only, every coin over a floor, the doors' triggers on their faces (the bottle's mouth
// into the first course), the bake's promises (darker along the walls, warm by the fire, as
// baked too, the long walls apart, the fill on the south wall, the warm vault, the nave not
// burnt white), the dais drawn where he stands on it, nothing drawn only standing more than 56
// out of a wall, and the look's promises (the transparent glass with its rim, the flickering
// flames, the panelling, the textures' mean colours, the lamp hidden until lit); the glossy
// marble (its sheen's weights, its shader, every column's shaft gleaming in a stripe from the
// arrival and the dais's foot); the polished floor (exactly when MIRROR: see-through over the
// room's lower part mirrored under it, in the mirrored faces' baked colours times their
// textures' means, under a lid in the mean colour of what is higher, nothing that moves in it;
// every look through the open floor meets the mirror); nothing framed, lit or inlaid on the
// axis or behind the bottle (the originality rules); the front door's leaves fill its opening
// shut (round its arch's head too) and swing aside onto a dark passage, and the lamp lights
// with setLit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as hall from '../src/world/hall/layout.js';
import * as hallTextures from '../src/world/hall/textures.js';
import { planPolygon, planRuns } from '../src/world/hall/plan.js';
import { windowSpots } from '../src/world/hall/shell.js';
import { makeHallLight } from '../src/world/hall/light.js';
import { SHADOW_RENDER_ORDER } from '../src/objects/BlobShadows.js';
import { BlobShadow } from '../src/player/model/shadow.js';
import { MIRROR, WOOD_MEAN } from '../src/world/hall/hall.js';
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
const inRoom = (p, slack = 0) => hall.inPlan(p.x, p.z, -slack) && p.y >= -slack && p.y <= HALL.ceilingY + slack;

// The plan's outline, and a point's distance to it (the nearest wall's line).
const outline = planPolygon(hall, 0);
function wallDistance(x, z) {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % outline.length];
    const [ex, ez] = [bx - ax, bz - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

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
// room: the chimney breast, the buttress, the steps of the dais (a half-cone up to its top),
// the engaged columns, the cork, the books (with their spines), the chart table, the signposts,
// the cradles, the bottle and the stand under it.
function inFurniture({ x, y, z }, pad = 10) {
  const box = (x0, x1, y0, y1, z0, z1) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad && z > z0 - pad && z < z1 + pad;
  const post = (cx, cz, r, top) => Math.hypot(x - cx, z - cz) < r + pad && y < top + pad;
  const { CHIMNEY: C, BUTTRESS: T, DAIS: D, BOOKS: K, CORK, CHART_TABLE, CRADLES: R, BOTTLE: B } = hall;
  if (box(C.x0, C.x1, 0, C.top, C.z0, C.z1) || box(T.x0, T.x1, 0, T.top, T.z0, T.z1)) return true;
  const r = Math.hypot(x - D.x, z - D.z);
  if (z > D.z - pad && r < D.rFoot + pad && y < D.top * Math.min(1, (D.rFoot - r) / (D.rFoot - D.rTop)) + pad) return true;
  if (hall.COLUMNS.some((c) => post(c.x, c.z, hall.COLUMN.r, HALL.ceilingY))) return true;
  if (post(CORK.x, CORK.z, CORK.r, CORK.top) || post(CHART_TABLE.x, CHART_TABLE.z, CHART_TABLE.r, CHART_TABLE.top)) return true;
  if (K.stack.some((b) => box(b.x0, K.x1, 0, b.top, K.z0 - 30, K.z1))) return true;
  if (hall.SIGNS.some((s) => post(s.x, s.z, 100, s.y + 220))) return true;
  if (R.zs.some((cz) => box(-R.halfX, R.halfX, 0, R.cheekTop, cz - R.depth / 2, cz + R.depth / 2))) return true;
  if (z < B.body[0] - pad || z > B.lip[1] + pad) return false;
  const k = (z - B.shoulder[0]) / (B.shoulder[1] - B.shoulder[0]);
  const rb = z < B.shoulder[0] ? B.bodyR : z < B.shoulder[1] ? B.bodyR + (B.neckR - B.bodyR) * k : z < B.lip[0] ? B.neckR : B.lipR;
  return Math.hypot(x, y - B.axisY) < rb + pad || (Math.abs(x) < rb && y < B.axisY);
}

// Stick input that walks him along world yaw `yaw` with the camera where it is.
function toward(cam, yaw) {
  const a = wrapAngle(cam.getYaw() - yaw);
  return { stickX: Math.sin(a), stickY: Math.cos(a) };
}

const meshes = [];
area.root.traverse((o) => o.isMesh && meshes.push(o));
const mesh = (name) => meshes.find((m) => m.name === name);

// A material's shaders as three.js compiles them (its onBeforeCompile hooks run on the basic
// material's source, as for every worldMaterial).
function compiled(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}

test('budgets: at most 14 meshes with baked colours, under 26k room triangles and 1.5k collider triangles of stone and wood, built in under a second', () => {
  assert.ok(meshes.length <= 14, `${meshes.length} meshes`);
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    assert.ok(g.attributes.color, `${m.name} has vertex colours`);
    assert.ok(g.attributes.position.count > 0, `${m.name} has vertices`);
    if (m.name !== 'hall-reflect') tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  assert.ok(tris < 26000, `${tris} room triangles`);
  const colliders = area.parts.flatMap((p) => p.colliders);
  const colliderTris = colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(colliderTris < 1500, `${colliderTris} collider triangles`);
  assert.deepEqual([...new Set(colliders.map((c) => c.terrain))].sort(), ['stone', 'wood']);
  assert.deepEqual([...new Set(colliders.map((c) => c.surface).filter(Boolean))].sort(), ['not_slippery', 'slippery'], 'the glass, the dais');
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
      // Open air: on the plan, not in a piece of furniture (every ray from inside a solid meets
      // the back of its faces) and nothing within 60 of it either way.
      if (!hall.inPlan(l.x, l.z, 100)) continue;
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

test('the shell is closed at head height: every ray out from the middle stops at the round walls (or a column, the buttress, the chimney breast)', () => {
  const from = world(0, 1300, -100);
  const footprint = (x, z) =>
    hall.COLUMNS.some((c) => Math.hypot(x - c.x, z - c.z) < 195) ||
    [hall.BUTTRESS, hall.CHIMNEY, hall.HOOD].some((b) => x >= b.x0 - 1 && x <= b.x1 + 1 && z >= b.z0 - 1 && z <= b.z1 + 1);
  const bad = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const hit = col.raycast(from, { x: Math.sin(a), y: 0, z: Math.cos(a) }, 20000, { floors: false, ceilings: false });
    if (!hit) {
      bad.push(`${deg} deg: no hit`);
      continue;
    }
    const p = local(hit.point);
    if (wallDistance(p.x, p.z) > 30 && !footprint(p.x, p.z)) bad.push(`${deg} deg: stopped at ${JSON.stringify(p)}, ${wallDistance(p.x, p.z).toFixed(0)} off the walls`);
  }
  assert.deepEqual(bad, []);
});

test(`no spot he can stand on lies under a ceiling lower than HEADROOM (${hall.HEADROOM}): the stand and the cradles leave no ledge under the glass`, () => {
  // Every floor on a grid over the plan, from the ceiling down: room for him under its ceiling
  // but less than HEADROOM is a pocket, unless the spot lies inside a solid (the floor under
  // the stand, a cradle's top under its cheek).
  const pockets = [];
  for (let x = -HALL.halfX + 7; x < HALL.halfX; x += 20) {
    for (let z = HALL.northZ + 7; z < HALL.southZ; z += 20) {
      if (!hall.inPlan(x, z, -60)) continue;
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

test('jump, crouch and attack spam (11 seeded runs of 900 ticks) never gets Jonas or the camera out of the room, and seldom traps the camera', (t) => {
  const starts = [
    [0, 0, 1550], // the front entry
    [hall.ONE_UP.x, hall.CHIMNEY.top, hall.ONE_UP.z], // the mantel
    [0, hall.DAIS.top, -1150], // the dais's top
    [hall.CORK.x, hall.CORK.top, hall.CORK.z],
    [hall.CHART_TABLE.x, hall.CHART_TABLE.top, hall.CHART_TABLE.z],
    [-1975, hall.BUTTRESS.top, 150], // the buttress's top
    [800, 0, -3700], // behind the bottle, east and west
    [-1700, 0, -2700],
    [985, hall.BOOKS.stack[1].top, -2150], // the top book
    [480, 0, -2000],
    [-800, 0, 850],
  ];
  const out = [];
  const trapped = [];
  starts.forEach(([x, y, z], run) => {
    const rng = makeRng(1000 + run);
    const { p, ctl } = hero(x, y, z, rng() * Math.PI * 2);
    const cam = camera(p);
    let sx = 0;
    let sy = 1;
    trapped[run] = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 20 === 0) {
        const a = rng() * Math.PI * 2;
        sx = Math.sin(a);
        sy = Math.cos(a);
      }
      const c = ctl.next({ stickX: sx, stickY: sy, A: rng() < 0.3, Z: rng() < 0.05, B: rng() < 0.05 });
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      if (cam.collider.trapped) trapped[run]++;
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
  const total = trapped.reduce((a, b) => a + b, 0);
  t.diagnostic(`trapped camera ticks per run: ${trapped.join(', ')} (${total} in all)`);
  assert.ok(total <= 80 && trapped.every((n) => n <= 35), `trapped camera ticks per run: ${trapped.join(', ')} (${total} in all)`);
});

test('each entry stands on a floor with at least 900 of headroom', () => {
  for (const [id, e] of Object.entries(area.entries)) {
    const floor = col.findFloor(e.x, e.y + 10, e.z);
    assert.ok(floor.surface && Math.abs(floor.y - e.y) < 1, `${id}: on its floor (${floor.y - O.y})`);
    const ceil = col.findCeil(e.x, e.y + 10, e.z);
    assert.ok(ceil.y - e.y >= 900, `${id}: ${ceil.y - e.y} of headroom`);
  }
});

test('the front entry: the camera behind him, clear; the walk on north up the steps of the dais onto its top never traps it', () => {
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
  assert.ok(Math.abs(end.y - hall.DAIS.top) < 1 && end.z < hall.LANDING.z1 && p.grounded, `on the dais's top: ${JSON.stringify(end)} (${p.action})`);
});

test("the bottle entry: he drops onto the dais's top facing south with the camera south of him (camYaw 0), clear", () => {
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
  assert.ok(Math.abs(end.y - hall.LANDING.top) < 1 && Math.abs(end.z - hall.ENTRIES.bottle.z) < 1, `on the dais's top: ${JSON.stringify(end)}`);
  const c = local(cam.pos);
  assert.ok(c.z > end.z + 800 && Math.abs(c.x) < 50, `camera south of him: ${JSON.stringify(c)}`);
  assert.equal(cam.collider.occluded, false);
});

test('walks round the bottle in the apse, along the round walls and by the furniture never trap the camera or take it into a solid', () => {
  const [N, E, W, S] = [Math.PI, Math.PI / 2, -Math.PI / 2, 0];
  // [what, start (x, z), legs [world yaw, ticks]]
  const walks = [
    ['north up the east side into the apse, west into the flank', [900, -2600], [[N, 90], [W, 80]]],
    ['north up the west side into the apse, east into the flank', [-900, -2600], [[N, 90], [E, 80]]],
    ['the same up the east side, and back out south', [900, -2600], [[N, 90], [W, 80], [S, 150]]],
    ['into the east wedge by the back cradle and out', [1100, -3300], [[N, 60], [W, 40], [S, 120]]],
    ['into the west wedge by the back cradle and out', [-1100, -3300], [[N, 60], [E, 40], [S, 120]]],
    ['along the apse wall east to west', [1800, -2600], [[N, 60], [W, 140], [S, 60]]],
    ['along the apse wall west to east', [-1800, -2600], [[N, 60], [E, 140], [S, 60]]],
    ['south out of the cradle corner', [600, -3870], [[S, 150]]],
    ['north along the east wall past the column into the apse', [1950, 1500], [[N, 160]]],
    ['north along the west wall from the buttress past the column', [-1950, -300], [[N, 120]]],
    ['east wall north and back south', [1950, -400], [[N, 120], [S, 120]]],
    ['round the south rounds to the door', [1900, 1500], [[S, 80], [W, 120]]],
    ['north between the books and the stand, and back', [480, -1600], [[N, 90], [S, 90]]],
    ["east past the books' pages, north, then west behind them", [900, -1700], [[E, 40], [N, 30], [W, 50]]],
    ["north by the dais's back, east, north, west and out", [300, -1500], [[N, 30], [E, 40], [N, 40], [W, 40], [S, 60]]],
    ['the west flank coin trail round the apse', [-1700, -1700], [[N, 60], [N + 0.5, 60], [E, 60]]],
    ["from the dais's west end north into the flank", [-1400, -1300], [[N, 120], [S, 120]]],
  ];
  const bad = [];
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
        if (insideSolid(cam.pos)) bad.push(`${what}: camera inside a solid at ${JSON.stringify(local(cam.pos))}`);
      }
    }
    if (n) bad.push(`${what}: ${n} trapped ticks`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test("stepping off the dais's back (a drop of 300 to 550, as off the old landing) loses him only until the camera turns round; jumping off the top's back corners, not at all", (t) => {
  // The camera behind him up on the dais cannot see over the edge he drops behind (no lift is
  // steep enough, no dolly gets past it): its trapped remedy turns the orbit to the side, in
  // about a second, as it did at HEAD's landing (x 300: 21 trapped, 34 occluded ticks). These
  // budgets keep it from getting worse. [x, trapped, occluded]: a walk north off the back at
  // 0.6 stick for 24 ticks from z -1150, then 66 ticks standing.
  const N = Math.PI;
  const run = (x, z, yaw, input) => {
    const { p, ctl } = hero(x, 0, z, yaw);
    p.teleport(x + O.x, col.findFloor(x + O.x, 2000 + O.y, z + O.z, 0).y, z + O.z, yaw);
    const cam = camera(p);
    let [trapped, occluded] = [0, 0];
    for (let i = 0; i < 90; i++) {
      const c = ctl.next(input(i, cam));
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      if (cam.collider.trapped) trapped++;
      if (cam.collider.occluded) occluded++;
    }
    return [trapped, occluded];
  };
  const slow = (cam) => {
    const { stickX, stickY } = toward(cam, N);
    return { stickX: stickX * 0.6, stickY: stickY * 0.6 };
  };
  const steps = [-1000, -800, -300, 300, 650, 900].map((x) => [x, ...run(x, -1150, N, (i, cam) => (i < 24 ? slow(cam) : {}))]);
  t.diagnostic(`stepping off the back [x, trapped, occluded]: ${JSON.stringify(steps)}`);
  for (const [x, trapped, occluded] of steps) assert.ok(trapped <= 30 && occluded <= 45, `x ${x}: ${trapped} trapped, ${occluded} occluded ticks`);
  for (const s of [-1, 1]) {
    const yaw = N - s * 0.6;
    const [trapped, occluded] = run(s * 400, -1250, yaw, (i, cam) => (i < 30 ? { ...toward(cam, yaw), A: i >= 3 && i < 10 } : {}));
    assert.ok(trapped === 0 && occluded === 0, `the jump off the ${s < 0 ? 'west' : 'east'} corner: ${trapped} trapped, ${occluded} occluded ticks`);
  }
});

test('C-button swings round Jonas by the bottle and the furniture, whichever way he faces, never trap the camera or take it into a solid', () => {
  // A full turn of the orbit (C-left every 20 ticks) at the bottle's mouth, on the dais's
  // steps, in the apse and its flanks (beside the stand, under the glass), by the walls and
  // rounds, by the cork and the books, by the fireplace and the chart table, with him facing
  // each of 8 ways. Trapped ticks count from the first swing (facing south, from the start):
  // facing another way, the camera's reset may first put it behind the bottle's lip for a few
  // ticks, which is no swing's doing.
  const spots = [
    [-300, 550, -1350], [1200, 0, -2600], [-1100, 206, -1000], [700, 345, -800], [0, 361, -500], [-1400, 0, 700], [-1400, 0, -200], [600, 0, -3900],
    [-600, 0, -3900], [1850, 0, -1350], [1300, 0, -1850], [-1700, 0, -3000], [0, 0, 2600], [1700, 0, 2300], [-1700, 0, 2300], [1700, 0, 150],
    [480, 0, -2150], [900, 0, -1800], [985, 255, -2150], [1300, 380, -2150], [-1640, 0, -2440], [-850, 0, 1150], [1250, 0, 300],
    [-750, 0, -3100], [-750, 0, -3300], [-750, 0, -2900], [1000, 0, -3300], [850, 0, -2330],
  ];
  const bad = [];
  for (const [x, y, z] of spots) {
    for (let k = 0; k < 8; k++) {
      const { p, ctl } = hero(x, y, z, (k * Math.PI) / 4);
      const cam = camera(p);
      let trapped = 0;
      for (let i = 0; i < 9 * 20; i++) {
        const c = ctl.next({ CL: i % 20 === 0 && i > 0 });
        p.update(cam.playerInput(c), cam.getYaw());
        cam.update(c, p);
        if (cam.collider.trapped && (k === 0 || i >= 20)) trapped++;
        if (insideSolid(cam.pos)) bad.push(`from (${x}, ${y}, ${z}) facing ${k * 45} deg, tick ${i}: camera at ${JSON.stringify(local(cam.pos))}`);
      }
      if (trapped) bad.push(`from (${x}, ${y}, ${z}) facing ${k * 45} deg: ${trapped} trapped ticks`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test("walks from the apse's east flank into the books' north side: the camera, its view of him cut off by the books, turns round the bottle's neck and never into the glass", (t) => {
  // [start (x, z), the way he faces, three legs of 60 ticks each along these world yaws]:
  // he ends up pressed against the books' north side (or on past them to the east wall), the
  // camera south of the books; its remedy for the lost view (the controller turning the orbit,
  // sight.js) carries it along the shoulder and the neck.
  const walks = [
    [[1444.7, -3022.8], 2.46, [5.746, 5.621, 1.801]],
    [[1342, -3565], 0.206, [6.138, 3.737, 0.611]],
  ];
  const bad = [];
  const trapped = [];
  for (const [[x, z], yaw, legs] of walks) {
    const { p, ctl } = hero(x, 0, z, yaw);
    const cam = camera(p);
    let n = 0;
    for (let i = 0; i < 60 * legs.length; i++) {
      const c = ctl.next(toward(cam, legs[Math.floor(i / 60)]));
      p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, p);
      if (cam.collider.trapped) n++;
      if (insideSolid(cam.pos)) bad.push(`from (${x}, ${z}) tick ${i}: camera at ${JSON.stringify(local(cam.pos))}, Jonas at ${JSON.stringify(local(p.pos))}`);
    }
    trapped.push(n);
  }
  t.diagnostic(`trapped camera ticks (the books hiding him): ${trapped.join(', ')}`);
  assert.deepEqual(bad.slice(0, 10), []);
});

test('routes: the books hop up to the cork, a coin on each', () => {
  // A walk east along the books, a jump up onto each in turn, then onto the cork's top.
  const K = hall.BOOKS;
  const east = Math.PI / 2;
  const books = hero(K.stack[0].x0 - 450, 0, hall.CORK.z, east, { objects: true });
  const edges = [...K.stack.map((b) => b.x0), hall.CORK.x - hall.CORK.r];
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
    if (y === hall.CORK.top && books.p.grounded) break;
  }
  assert.deepEqual(floors, [0, ...K.stack.map((b) => b.top), hall.CORK.top], 'book by book');
  assert.equal(books.log.filter((e) => e === 'coin').length, 3, 'the books\' coins and the cork\'s');
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
  const bottle = hall.SIGNS.find((s) => s.id === 'bottle');
  assert.equal(bottle.pages[2], 'Climb the steps, walk into the neck of the bottle and join it!');
  const problems = [];
  for (const s of hall.SIGNS) {
    for (const [side, off] of [['front', 0], ['front-left', 0.6], ['front-right', -0.6], ['behind', Math.PI]]) {
      const a = s.yaw + off;
      // As far out as the room allows: nothing between the spot and the signpost's box.
      const clear = (r) => !col.raycast(world(s.x + Math.sin(a) * (r + 60), s.y + 100, s.z + Math.cos(a) * (r + 60)), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, r - 50);
      const d = [400, 250].find(clear);
      assert.ok(d, `${s.id} ${side}: room to walk up to it`);
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
  assert.equal(hall.COINS.length, 25);
  const { SLOT, CHIMNEY } = hall;
  const inSlot = (c) => c.z > SLOT.z0 && c.z < SLOT.z1 && c.x > CHIMNEY.x0 && c.x < CHIMNEY.x1;
  for (const c of hall.COINS) {
    assert.ok(Number.isFinite(c.y), `${JSON.stringify(c)} has a height`);
    if (inSlot(c)) continue;
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y + O.y - floor.y <= 120 && c.y + O.y - floor.y >= 0, `${JSON.stringify(c)}: floor ${floor.y - O.y}`);
  }
  assert.equal(hall.COINS.filter(inSlot).length, 3);
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

test('the bake: the floor darker along the walls and warmer by the fire (as baked too), the long walls apart, the fill on the south wall, the vault warm, the nave not burnt white', () => {
  const light = makeHallLight(hall, windowSpots(hall, planRuns(hall)));
  const mean = ([r, g, b]) => (r + g + b) / 3;
  const ratio = ([r, , b]) => r / b;
  const up = [0, 1, 0];
  const middle = light.floor(0, 0, 0, ...up);
  const byWall = light.floor(2000, 0, -500, ...up);
  assert.ok(mean(byWall) < 0.9 * mean(middle), `200 from the east wall ${mean(byWall).toFixed(3)} vs the middle ${mean(middle).toFixed(3)}`);
  const fire = light.floor(-1450, 0, 1270, ...up);
  assert.ok(ratio(fire) > ratio(middle) + 0.05, `r/b by the fire ${ratio(fire).toFixed(3)} vs the middle ${ratio(middle).toFixed(3)}`);
  // The east wall faces the key light, the west wall away from it (measured 1.215: less 2%).
  const east = light.wall(2200, 1800, -1050, -1, 0, 0);
  const west = light.wall(-2200, 1800, -1050, 1, 0, 0);
  assert.ok(mean(east) >= 1.19 * mean(west), `east ${mean(east).toFixed(3)} vs west ${mean(west).toFixed(3)}`);
  // The south wall's round parts get a gradient from the apse side's fill: the face turned
  // north (toward the apse) is lit more than the one turned east.
  const north = light.wall(-470, 250, 2990, 0, 0, -1);
  const side = light.wall(-470, 250, 2990, 1, 0, 0);
  assert.ok(mean(north) - mean(side) >= 0.1, `the fill: ${mean(north).toFixed(3)} vs ${mean(side).toFixed(3)}`);
  // The vault, facing down, warm (without its bounce and ramp clamp it would be about 0.95).
  assert.ok(ratio(light.wall(0, 3500, 0, 0, -1, 0)) >= 1.1, `the vault's r/b ${ratio(light.wall(0, 3500, 0, 0, -1, 0)).toFixed(3)}`);
  // And as baked into the floor (its colours clamped as one, so a pool keeps its hue): the
  // floor before the fire warmer than the middle of the nave, which is not clamped at all (lit
  // about as the walls are, not a flat white).
  const floor = mesh('hall-floor').geometry;
  const [pos, col] = [floor.attributes.position, floor.attributes.color];
  const baked = (cx, cz, r) => {
    const sum = [0, 0, 0];
    let [n, top] = [0, 0];
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 1 || Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) > r) continue;
      const c = [col.getX(i), col.getY(i), col.getZ(i)];
      for (let k = 0; k < 3; k++) sum[k] += c[k];
      top = Math.max(top, ...c);
      n++;
    }
    return { rgb: sum.map((v) => v / n), top, n };
  };
  const [byFire, nave] = [baked(-1450, 1270, 250), baked(0, 0, 300)];
  assert.ok(byFire.n > 10 && nave.n > 10, `${byFire.n} and ${nave.n} floor vertices`);
  assert.ok(ratio(byFire.rgb) > ratio(nave.rgb) + 0.05, `baked r/b by the fire ${ratio(byFire.rgb).toFixed(3)} vs the nave's middle ${ratio(nave.rgb).toFixed(3)}`);
  assert.ok(nave.top < 1.149, `the nave's middle baked up to ${nave.top.toFixed(3)} (clamped at 1.15)`);
});

test('the steps of the dais are drawn where he stands: walking up them, on a corner of the collider\'s facets or between two, his feet stay within 30 of the tread drawn under him', (t) => {
  // Up from 1900 out toward the middle of the top, straight up the axis (a corner of the
  // collider's facets), up the middle of facets and near the flat back. The tread under him is
  // the drawn marble (the first hall-trim face straight down from over his head).
  const D = hall.DAIS;
  const run = (D.rFoot - D.rTop) / D.steps;
  const trim = mesh('hall-trim');
  area.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const tread = (x, z) => {
    ray.set(new THREE.Vector3(x + O.x, 2000 + O.y, z + O.z), down);
    return ray.intersectObject(trim, false)[0].point.y - O.y;
  };
  const off = [];
  const ranges = [];
  for (const deg of [0, 7.5, -37.5, 67.5, -80]) {
    const a = (deg * Math.PI) / 180;
    const yaw = a + Math.PI;
    const { p, ctl, at } = hero(D.x + Math.sin(a) * 1900, 0, D.z + Math.cos(a) * 1900, yaw);
    let checked = 0;
    let [lo, hi] = [Infinity, -Infinity];
    for (let i = 0; i < 300 && !(p.grounded && Math.abs(at().y - D.top) < 1 && Math.hypot(at().x - D.x, at().z - D.z) < D.rTop - 100); i++) {
      p.update(ctl.next({ stickY: 0.5 }), yaw);
      const q = at();
      const r = Math.hypot(q.x - D.x, q.z - D.z);
      if (!p.grounded || r < D.rTop || r > D.rFoot - run / 2) continue;
      const d = q.y - tread(q.x, q.z);
      checked++;
      [lo, hi] = [Math.min(lo, d), Math.max(hi, d)];
      if (Math.abs(d) > 30) off.push(`${deg} deg, r ${r.toFixed(0)}: feet ${d.toFixed(1)} off the tread`);
    }
    ranges.push(`${deg} deg ${lo.toFixed(1)} .. ${hi.toFixed(1)}`);
    assert.ok(checked > 20, `${deg} deg: ${checked} grounded ticks on the steps`);
    assert.ok(Math.abs(at().y - D.top) < 1, `${deg} deg: up on the top: ${JSON.stringify(at())}`);
  }
  t.diagnostic(`feet minus the drawn tread: ${ranges.join('; ')}`);
  assert.deepEqual(off, []);
});

test('nothing drawn only stands more than 56 out of the walls (the camera keeps 60 off them): deeper parts stand over colliders', () => {
  // Every trim, paint and dado vertex from 10 up to the collision ceiling within 120 of the
  // plan's walls is at most 56 into the room, but where a collider stands: the columns, the
  // buttress, the chimney breast and the hood (their footprints with a margin for the trims
  // round them), the cradles, the bottle and its stand (within 600 of its axis, along it), and
  // the doors' surrounds (door()'s collider, along the wall from the door's middle and up to its
  // top, and door()'s keystone: shared with the castle, it stands 10 past the collider's face
  // and 14 over its top). The front portal's archivolt, keystone and round pilasters and the
  // east doors' architraves and beads over their piers have no excuse.
  const { BUTTRESS: B, CHIMNEY: C, HOOD: H, FRONT_DOOR: F, EAST_DOORS: E, CRADLES: R, BOTTLE } = hall;
  const near = (x, z, [x0, x1, z0, z1], m) => x >= x0 - m && x <= x1 + m && z >= z0 - m && z <= z1 + m;
  const boxes = [
    [[B.x0, B.x1, B.z0, B.z1], 60],
    [[C.x0, C.x1, C.z0, C.z1], 60],
    [[H.x0, H.x1, H.z0, H.z1], 20],
    ...R.zs.map((z) => [[-R.halfX, R.halfX, z - R.depth / 2, z + R.depth / 2], 20]),
  ];
  // u along the wall from the door's middle, y up.
  const surround = (u, y, width, height) => (Math.abs(u) <= width / 2 + 70 && y <= height + 70) || (Math.abs(u) <= 36 && y <= height + 84);
  const door = (x, y, z) => (z > F.wallZ - 120 && surround(x - F.x, y, F.width, F.height)) || (x > HALL.halfX - 120 && E.zs.some((ez) => surround(z - ez, y, E.width, E.height)));
  const excused = (x, y, z) =>
    hall.COLUMNS.some((c) => Math.hypot(x - c.x, z - c.z) < 220) || (Math.abs(x) < 600 && z < BOTTLE.lip[1] + 100) || boxes.some(([b, m]) => near(x, z, b, m)) || door(x, y, z);
  const bad = [];
  for (const name of ['hall-trim', 'hall-paint', 'hall-dado']) {
    const pos = mesh(name).geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (y < 10 || y >= HALL.ceilingY || !hall.inPlan(x, z)) continue;
      const d = wallDistance(x, z);
      if (d > 56 + 1e-6 && d <= 120 && !excused(x, y, z)) bad.push(`${name} (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}): ${d.toFixed(1)} out`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} vertices`);
});

test('the look: the glass is see-through (front faces, no depth write) with a rim, the flames flicker with update(time), the walls panelled, every texture with its mean colour, the lamp waits unlit', () => {
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
  const flicker = compiled(glow.material);
  assert.equal(flicker.uniforms.flameTime, glow.material.userData.flameTime);
  assert.match(flicker.vertexShader, /attribute float flame;/);
  assert.match(flicker.vertexShader, /vColor\.rgb \*= .*sin\(flameTime \* /);
  const rim = compiled(glass);
  assert.match(rim.vertexShader, /vGlassRim = 1\.0 - abs\(dot\(normalize\(normalMatrix \* normal\)/);
  assert.match(rim.fragmentShader, /diffuseColor\.a = mix\(diffuseColor\.a, [0-9.]+, glassRim\);/);
  assert.notEqual(glow.material.customProgramCacheKey(), glass.customProgramCacheKey());
  // The panelling has a mesh of its own; every texture of the hall's carries the mean of its
  // pixels (linear RGB), worked out without a canvas.
  assert.ok(mesh('hall-dado'), 'hall-dado');
  const makers = Object.entries(hallTextures);
  assert.ok(makers.length >= 5, `${makers.length} textures`);
  for (const [name, make] of makers) {
    const m = make().userData.mean;
    assert.ok(Array.isArray(m) && m.length === 3 && m.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${name}: ${m}`);
  }
  assert.equal(mesh('hall-lamp').visible, false);
  assert.equal(area.root.getObjectByName('hall').children.length, meshes.length);
});

test("the glossy marble: its sheen weight 1 on the column and pilaster shafts and 0.6 on the hearth's surround, a rim and a highlight from a light near the eye in a program of its own, so from the arrival and the dais's foot every column's shaft gleams in a stripe", () => {
  const [trim, glow, glass] = [mesh('hall-trim'), mesh('hall-glow'), mesh('hall-bottle')];
  assert.equal(trim.material.customProgramCacheKey(), 'hall-sheen');
  assert.equal(new Set([glow.material, glass.material, trim.material].map((m) => m.customProgramCacheKey())).size, 3, 'three programs of their own');
  // The weights: 1 on the shafts of the columns and of the portal's pilasters, 0.6 on the
  // hearth's surround, none on the skirting, and none anywhere else.
  const weight = trim.geometry.attributes.sheen;
  assert.ok(weight && !trim.geometry.attributes.darkGlow, "the weights are the trim's 'sheen'");
  const [pos, nrm] = [trim.geometry.attributes.position, trim.geometry.attributes.normal];
  const { COLUMNS, COLUMN, FRONT_DOOR: F, PORTAL: P, CHIMNEY: C, HEARTH_FIRE: H } = hall;
  const seen = { shaft: 0, pilaster: 0, surround: 0, skirting: 0 };
  const wrong = [];
  const weights = new Set();
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z, k] = [pos.getX(i), pos.getY(i), pos.getZ(i), weight.getX(i)];
    weights.add(k);
    const part = (name, want) => {
      seen[name]++;
      if (k !== Math.fround(want)) wrong.push(`${name} (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}): ${k}`);
    };
    const pilaster = (r) => [-1, 1].some((sx) => Math.abs(Math.hypot(x - sx * P.pilasterU, z - F.wallZ - P.sink) - r) < 1);
    if (y > 300 && y < 2200 && COLUMNS.some((c) => Math.hypot(x - c.x, z - c.z) < COLUMN.r - 60)) part('shaft', 1);
    // (a pilaster's shaft by its top ring, r 66 at 350 under the gilt capital: its foot's ring
    // is the base's too)
    else if (Math.abs(y - 350) < 1 && pilaster(66)) part('pilaster', 1);
    else if (x > C.x1 + 1 && x < C.x1 + 50 && Math.abs(z - H.z) < 440 && y > 170 && y < 760) part('surround', 0.6);
    else if (y < 100 && wallDistance(x, z) <= 36) part('skirting', 0);
    else if (k > 0) {
      const onColumn = COLUMNS.some((c) => Math.hypot(x - c.x, z - c.z) <= COLUMN.r);
      const onPilaster = y <= 400 && [-1, 1].some((sx) => Math.hypot(x - sx * P.pilasterU, z - F.wallZ - P.sink) <= P.baseR + 1);
      const onSurround = x > C.x1 - 1 && x < C.x1 + 60 && Math.abs(z - H.z) < 460 && y < 800;
      if (!onColumn && !onPilaster && !onSurround) wrong.push(`${k} off the shafts and the surround (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
    }
  }
  assert.deepEqual(wrong.slice(0, 10), [], `${wrong.length} vertices`);
  for (const [name, n] of Object.entries(seen)) assert.ok(n >= 20, `${n} ${name} vertices`);
  assert.deepEqual([...weights].sort(), [0, 0.6, 1].map(Math.fround).sort(), 'no other weight');
  // The shader three.js compiles, per vertex: the normal and the view in view space, a Fresnel
  // rim (its base clamped: |n.v| of two unit vectors can round past 1, and pow of a negative is
  // undefined) and a highlight from a light near the eye (the view reflected about the normal),
  // their weighted sum whitening the colour toward a warm white.
  const sheen = compiled(trim.material);
  const vs = sheen.vertexShader;
  assert.match(vs, /attribute float sheen;/);
  assert.match(vs, /varying float vSheen;/);
  assert.match(vs, /vec3 sheenN = normalize\(normalMatrix \* normal\);/);
  assert.match(vs, /vec3 sheenV = normalize\(-mvPosition\.xyz\);/);
  assert.match(sheen.fragmentShader, /varying float vSheen;/);
  const numbers = (re, source) => {
    const m = source.match(re);
    assert.ok(m, `${re}`);
    return m.slice(1).map((t) => t.split(',').map(Number));
  };
  const [[rimPower]] = numbers(/float sheenRim = pow\(max\(1\.0 - abs\(dot\(sheenN, sheenV\)\), 0\.0\), ([0-9.]+)\);/, vs);
  const [light, [spotPower]] = numbers(/float sheenSpot = pow\(max\(dot\(reflect\(-sheenV, sheenN\), vec3\(([-0-9., ]+)\)\), 0\.0\), ([0-9.]+)\);/, vs);
  const [[rim], [spot]] = numbers(/vSheen = sheen \* \(([0-9.]+) \* sheenRim \+ ([0-9.]+) \* sheenSpot\);/, vs);
  const [white, [mix]] = numbers(/diffuseColor\.rgb = mix\(diffuseColor\.rgb, vec3\(([0-9., ]+)\), min\(vSheen, 1\.0\) \* ([0-9.]+)\);/, sheen.fragmentShader);
  assert.ok(white[0] >= white[1] && white[1] >= white[2] && white[2] > 0.8, `a warm white ${white}`);
  // The light near the eye and nearly level (on an upright shaft the view reflected about the
  // normal has no up in it: a higher light could never make it shine).
  assert.ok(Math.abs(Math.hypot(...light) - 1) < 0.01 && Math.abs(light[1]) < 0.3 && light[2] > 0.8, `the light ${light}`);
  // Worked out as the shader does, with the camera where the game puts it at the arrival and at
  // the dais's foot: on every column's shaft (1000 .. 1400 up) the vertices facing the eye are
  // whitened by at least 0.4 in its gleam and by less than 0.3 on average (a stripe, not a coat
  // of white).
  const L = new THREE.Vector3(...light);
  const [n, v, r] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const [where, z] of [['the arrival', hall.ENTRIES.front.z], ["the dais's foot", 600]]) {
    const { p } = hero(0, 0, z, Math.PI);
    const cam = camera(p);
    cam.apply(1);
    cam.camera.updateMatrixWorld();
    area.root.updateMatrixWorld(true);
    const modelView = new THREE.Matrix4().multiplyMatrices(cam.camera.matrixWorldInverse, trim.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(modelView);
    COLUMNS.forEach((c, ci) => {
      const whitened = [];
      for (let i = 0; i < pos.count; i++) {
        if (weight.getX(i) !== 1 || pos.getY(i) < 1000 || pos.getY(i) > 1400 || Math.hypot(pos.getX(i) - c.x, pos.getZ(i) - c.z) > COLUMN.r) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(modelView).negate().normalize();
        n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        const facing = n.dot(v);
        if (facing <= 0) continue;
        r.copy(v).negate().reflect(n);
        const sum = rim * Math.max(1 - Math.abs(facing), 0) ** rimPower + spot * Math.max(r.dot(L), 0) ** spotPower;
        whitened.push(Math.min(sum, 1) * mix);
      }
      const most = Math.max(...whitened);
      const mean = whitened.reduce((a, b) => a + b, 0) / whitened.length;
      assert.ok(whitened.length >= 20 && most >= 0.4 && mean < 0.3, `${where}: column ${ci}'s shaft whitened by up to ${most.toFixed(2)}, ${mean.toFixed(2)} on average (${whitened.length} vertices)`);
    });
  }
});

test("the polished floor (MIRROR): see-through over the room's lower part mirrored under it, each face in its baked colour times its texture's mean, under a lid in the mean colour of what is higher; nothing that moves in it", () => {
  const reflect = mesh('hall-reflect');
  const floor = mesh('hall-floor');
  assert.equal(!!reflect, MIRROR, 'hall-reflect exactly when MIRROR');
  assert.equal(floor.material.transparent, MIRROR, 'the floor see-through exactly when MIRROR');
  if (!MIRROR) return;
  // The floor over it: see-through, still writing depth, drawn first of the see-through meshes
  // (before the lamp in the bottle, the glass round it, the blob shadows and his own).
  assert.ok(floor.material.opacity > 0.7 && floor.material.opacity < 0.9, `opacity ${floor.material.opacity}`);
  assert.equal(floor.material.depthWrite, true);
  const [lamp, glass] = [mesh('hall-lamp'), mesh('hall-bottle')];
  assert.ok(floor.renderOrder < lamp.renderOrder && lamp.renderOrder < glass.renderOrder, `${floor.renderOrder}, ${lamp.renderOrder}, ${glass.renderOrder}`);
  const hisShadow = new BlobShadow().mesh.renderOrder;
  assert.ok(floor.renderOrder < SHADOW_RENDER_ORDER && floor.renderOrder < hisShadow, `before the blob shadows (${SHADOW_RENDER_ORDER}) and his own (${hisShadow})`);
  // The mirror: flipped under the floor, untextured vertex colours, opaque.
  assert.deepEqual([reflect.scale.x, reflect.scale.y, reflect.scale.z], [1, -1, 1]);
  assert.ok(reflect.material.vertexColors && !reflect.material.map && !reflect.material.transparent);
  const rpos = reflect.geometry.attributes.position;
  const rcol = reflect.geometry.attributes.color;
  const corner = (t, d) => [rpos.getX(3 * t + d), rpos.getY(3 * t + d), rpos.getZ(3 * t + d)];
  // The lid, its last two faces (in its source's terms: the mesh flips them): flat at the
  // cornice, facing down (up once flipped, toward the eye over the floor), over the room's box
  // and well past it.
  const n = rpos.count / 3 - 2;
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const t of [n, n + 1]) {
    const [a, b, c] = [0, 1, 2].map((d) => corner(t, d));
    assert.deepEqual([a[1], b[1], c[1]], [HALL.ceilingY, HALL.ceilingY, HALL.ceilingY], `lid face ${t}`);
    assert.ok((c[0] - a[0]) * (b[2] - a[2]) - (b[0] - a[0]) * (c[2] - a[2]) < 0, 'facing down');
    for (const q of [a, b, c]) [x0, x1, z0, z1] = [Math.min(x0, q[0]), Math.max(x1, q[0]), Math.min(z0, q[2]), Math.max(z1, q[2])];
  }
  assert.ok(x0 < -HALL.halfX - 2000 && x1 > HALL.halfX + 2000 && z0 < HALL.northZ - 2000 && z1 > HALL.southZ + 2000, `the lid over ${[x0, x1, z0, z1]}`);
  assert.ok(n > 5000 && n < 12000, `${n} mirrored triangles`);
  // Every other face from the floor up, reaching 8 above it (no rugs or inlays), its lowest
  // corner at most 1600 high, all of it under the lid.
  for (let t = 0; t < n; t++) {
    const ys = [0, 1, 2].map((d) => corner(t, d)[1]);
    assert.ok(Math.min(...ys) >= -1 && Math.min(...ys) <= 1600 && Math.max(...ys) >= 8 && Math.max(...ys) < HALL.ceilingY, `face ${t}: ${ys}`);
  }
  // And they are exactly those faces of the baked wall, dado, trim, wood, paint, cloth and the
  // glow's steady faces (not its flames, not the rose window's glass from the rose texture),
  // each in its colour times its source's texture mean, dimmed by 0.9 (the castle wood's mean
  // is WOOD_MEAN; the paint has no texture; the glow as it is): no leaf, sign, glass or lamp.
  // The lid is in the mean of the same colours of the faces left out above 1600, by area.
  assert.ok(WOOD_MEAN.length === 3 && WOOD_MEAN[0] > WOOD_MEAN[1] && WOOD_MEAN[1] > WOOD_MEAN[2] && WOOD_MEAN[2] > 0 && WOOD_MEAN[0] < 1, 'a brown');
  const dim = (m) => m.map((c) => c * 0.9);
  const sources = [
    ['hall-wall', dim(hallTextures.plasterTexture().userData.mean)],
    ['hall-dado', dim(hallTextures.panelTexture().userData.mean)],
    ['hall-trim', dim(hallTextures.marbleTexture().userData.mean)],
    ['hall-wood', dim(WOOD_MEAN)],
    ['hall-paint', dim([1, 1, 1])],
    ['hall-cloth', dim(hallTextures.bannerTexture().userData.mean)],
    ['hall-glow', [1, 1, 1]],
  ];
  const key = (p, i) => [i, i + 1, i + 2].map((j) => `${p.getX(j)},${p.getY(j)},${p.getZ(j)}`).join(';');
  const left = new Map();
  for (let t = 0; t < n; t++) {
    const k = key(rpos, 3 * t);
    if (!left.has(k)) left.set(k, []);
    left.get(k).push(3 * t);
  }
  const missing = [];
  let expected = 0;
  const above = [0, 0, 0];
  let aboveArea = 0;
  for (const [name, f] of sources) {
    const g = mesh(name).geometry;
    const [pos, col, uv, flame] = [g.attributes.position, g.attributes.color, g.attributes.uv, g.attributes.flame];
    for (let i = 0; i < pos.count; i += 3) {
      const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
      if (Math.min(...ys) < 0 || Math.max(...ys) < 8) continue;
      if (flame && [i, i + 1, i + 2].some((j) => flame.getX(j) > 0 || uv.getX(j) !== 0.5 || uv.getY(j) !== 0.5)) continue;
      const want = (j, c) => [col.getX(j) * c[0], col.getY(j) * c[1], col.getZ(j) * c[2]];
      if (Math.min(...ys) > 1600) {
        const [a, b, c] = [i, i + 1, i + 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, j));
        const area2 = b.sub(a).cross(c.sub(a)).length() / 2;
        for (let j = i; j < i + 3; j++) want(j, f).forEach((v, d) => (above[d] += (area2 / 3) * v));
        aboveArea += area2;
        continue;
      }
      expected++;
      const same = (r) => [0, 1, 2].every((d) => want(i + d, f).every((v, c) => Math.abs(rcol.getComponent(r + d, c) - v) < 1e-6));
      const candidates = left.get(key(pos, i)) ?? [];
      const at = candidates.findIndex(same);
      if (at < 0) missing.push(`${name} face ${i / 3} (${ys.map((y) => y.toFixed(0))})`);
      else candidates.splice(at, 1);
    }
  }
  assert.deepEqual(missing.slice(0, 10), [], `${missing.length} of ${expected} faces not mirrored in their colour`);
  assert.equal(expected, n, 'nothing else in the mirror');
  const lidColour = above.map((v) => v / aboveArea);
  for (let j = 3 * n; j < rpos.count; j++) {
    assert.ok([0, 1, 2].every((d) => Math.abs(rcol.getComponent(j, d) - lidColour[d]) < 1e-5), `the lid's colour ${[0, 1, 2].map((d) => rcol.getComponent(j, d))} vs ${lidColour}`);
  }
  // (a warm cream: the plaster's, the marble's and the vault's)
  assert.ok(lidColour[0] > lidColour[1] && lidColour[1] > lidColour[2] && lidColour[2] > 0.15, `${lidColour}`);
});

test('every look through the open floor meets the mirror under it (a mirrored face or the lid), never the clear colour: from 1500 eyes all over the room', () => {
  if (!MIRROR) return;
  // An eye anywhere in the room's open air, 100 to 1100 up (the camera's heights; every fifth
  // up to 2050, the perches'), and a point of the floor it sees past the colliders, 60 or more
  // from the walls (the skirting stands over the floor's edge); the line of sight goes on
  // through the floor into the flipped mesh under it.
  const reflect = mesh('hall-reflect');
  const fpos = mesh('hall-floor').geometry.attributes.position;
  area.root.updateMatrixWorld(true);
  const rng = makeRng(2026);
  const ray = new THREE.Raycaster();
  const missed = [];
  let looks = 0;
  while (looks < 1500) {
    const [ex, ez] = [(rng() * 2 - 1) * HALL.halfX, HALL.northZ + rng() * (HALL.southZ - HALL.northZ)];
    const ey = 100 + rng() * (looks % 5 ? 1000 : 1950);
    const t = 3 * Math.floor(rng() * (fpos.count / 3));
    let [a, b] = [rng(), rng()];
    if (a + b > 1) [a, b] = [1 - a, 1 - b];
    const [fx, fy, fz] = [0, 1, 2].map((d) => fpos.getComponent(t, d) + a * (fpos.getComponent(t + 1, d) - fpos.getComponent(t, d)) + b * (fpos.getComponent(t + 2, d) - fpos.getComponent(t, d)));
    if (!hall.inPlan(ex, ez, 150) || inFurniture({ x: ex, y: ey, z: ez }) || !hall.inPlan(fx, fz, 60) || Math.abs(fy) > 1) continue;
    const eye = world(ex, ey, ez);
    const to = { x: fx - ex, y: 2 - ey, z: fz - ez };
    const length = Math.hypot(to.x, to.y, to.z);
    const dir = { x: to.x / length, y: to.y / length, z: to.z / length };
    if (col.raycast(eye, dir, length)) continue; // (hidden from the eye)
    looks++;
    ray.set(new THREE.Vector3(eye.x, eye.y, eye.z), new THREE.Vector3(dir.x, dir.y, dir.z));
    if (ray.intersectObject(reflect, false).length === 0) missed.push(`(${[ex, ey, ez].map(Math.round)}) to (${[fx, fz].map(Math.round)})`);
  }
  assert.deepEqual(missed.slice(0, 5), [], `${missed.length} of ${looks} looks through the floor meet nothing`);
});

test('nothing framed, lit or inlaid on the axis or behind the bottle (the originality rules): plain panelling behind the bottle, no rug on the axis, a plain ring on the dais\'s top, no pool of light on the axis floor', () => {
  const { APSE, RUGS, DAIS: D, DAIS_APRON: A, ENTRIES } = hall;
  const where = (name, inside) => {
    const pos = mesh(name).geometry.attributes.position;
    const found = [];
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (inside(x, y, z)) found.push(`${name} (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
    }
    return found;
  };
  // The headboard behind the bottle (the apse's wall between its gold returns, over the chair
  // rail, whose top edge lies on the wall at 1080, and under the stepped-up rail): its teal
  // panelling and nothing gold or glowing on it (no picture, emblem, window or light).
  const headboard = (x, y, z) => {
    const deg = (Math.atan2(APSE.z - z, x - APSE.x) * 180) / Math.PI;
    return Math.hypot(x - APSE.x, z - APSE.z) >= 2160 && deg > 68.5 && deg < 111.5 && y > 1080 && y <= 1695;
  };
  assert.deepEqual([...where('hall-glow', headboard), ...where('hall-paint', headboard)].slice(0, 10), []);
  assert.ok(where('hall-dado', headboard).length > 10, 'the panelling');
  // From the dais's foot to the front entry no rug comes within 300 of the axis, and the floor's
  // only inlay there is the apron's half ring round the dais's foot.
  const [z0, z1] = [D.z, ENTRIES.front.z];
  for (const r of RUGS) if (r.z + r.r > z0 && r.z - r.r < z1) assert.ok(Math.abs(r.x) - r.r >= 300, `the ${r.kind} rug at (${r.x}, ${r.z})`);
  const axisFloor = (x, y, z) => y < 10 && Math.abs(x) <= 300 && z > z0 && z < z1;
  const apron = (x, z) => Math.hypot(x - D.x, z - D.z) >= A.r0 - 1 && Math.hypot(x - D.x, z - D.z) <= A.r1 + 1;
  assert.deepEqual(where('hall-paint', (x, y, z) => axisFloor(x, y, z) && !apron(x, z)).slice(0, 10), []);
  assert.ok(where('hall-paint', axisFloor).length > 0, 'the apron');
  // The dais's top: a plain inlaid ring (420 .. 500 out), nothing inside it (inside its inner
  // edge's vertices).
  const inRing = (x, y, z) => y >= D.top + 2 && y <= D.top + 10 && z >= D.z && Math.hypot(x - D.x, z - D.z) < 419;
  assert.deepEqual([...where('hall-paint', inRing), ...where('hall-glow', inRing)].slice(0, 10), []);
  // No pool of light on the axis's floor: nothing glowing low there.
  assert.deepEqual(where('hall-glow', (x, y, z) => y < 600 && Math.abs(x) <= 300 && z > z0 && z < z1).slice(0, 10), []);
});

test('the front door swings: its leaves turn into the south wall on their hinges onto a dark passage (shut, they fill the opening); the lamp in the bottle lights with setLit', () => {
  const { FRONT_DOOR: D } = hall;
  const left = mesh('hall-door-left');
  const right = mesh('hall-door-right');
  assert.ok(left && right, 'two leaves of their own');
  assert.equal(left.material, mesh('hall-wood').material, 'the wood\'s look');
  // Rays from the room toward the door (north of it, looking south) at points of its opening:
  // what they hit first.
  const ray = new THREE.Raycaster();
  const hit = (x, y) => {
    area.root.updateMatrixWorld(true);
    ray.set(new THREE.Vector3(x + O.x, y + O.y, D.wallZ - 600 + O.z), new THREE.Vector3(0, 0, 1));
    const h = ray.intersectObjects(meshes.filter((m) => m.visible), false)[0];
    return h && { name: h.object.name, z: h.point.z - O.z };
  };
  const opening = [];
  for (const x of [-170, -90, -30, 30, 90, 170]) for (const y of [40, 200, 380, 500]) opening.push([x, y]);
  // And round the arch's head, 2.5 inside its round (16 segments, in the wall's hole and in the
  // leaves alike): halfway along each chord of an arch of 8 segments, which would leave a gap.
  const hw = D.width / 2;
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 8;
    opening.push([Math.cos(a) * (hw - 2.5), D.height - hw + Math.sin(a) * (hw - 2.5)]);
  }
  area.setDoorOpen(0);
  for (const [x, y] of opening) {
    const h = hit(x, y);
    assert.ok(/^hall-door-/.test(h?.name) && h.z < D.wallZ && h.z > D.wallZ - 14, `shut: ${x},${y} -> ${JSON.stringify(h)}`);
  }
  // Beside it and above it, the plaster (the portal, the panelling and the rail lie lower).
  for (const [x, y] of [[-900, 1300], [900, 1300], [0, 1300]]) assert.equal(hit(x, y)?.name, 'hall-wall', `${x},${y}`);
  area.setDoorOpen(1);
  assert.ok(left.rotation.y > 1.2 && right.rotation.y < -1.2, `${left.rotation.y}, ${right.rotation.y}`);
  for (const [x, y] of opening.filter(([x]) => Math.abs(x) < 100)) {
    const h = hit(x, y);
    assert.ok(h?.name === 'hall-wood' && h.z > D.wallZ + 100, `open: ${x},${y} -> ${JSON.stringify(h)}`);
  }
  // On the way the swing eases in and out (smoothstep of t), the leaves turning alike.
  const full = left.rotation.y;
  for (const t of [0.25, 0.5, 0.8]) {
    area.setDoorOpen(t);
    assert.ok(Math.abs(left.rotation.y - full * t * t * (3 - 2 * t)) < 1e-9 && right.rotation.y === -left.rotation.y, `eased at ${t}: ${left.rotation.y}`);
  }
  area.setDoorOpen(0);
  assert.ok(left.rotation.y === 0 && right.rotation.y === 0, 'shut again');
  // The lamp of the little lighthouse.
  area.setLit(true);
  assert.equal(mesh('hall-lamp').visible, true);
  area.setLit(false);
  assert.equal(mesh('hall-lamp').visible, false);
});

test('the lit lamp in the bottle shows from the room: a warm deep gold lantern (not the cream of the wall behind it) and two hazy beams turning round it, inside the glass whichever way they point, drawn before it', () => {
  const lamp = mesh('hall-lamp');
  const glass = mesh('hall-bottle');
  const { BOTTLE: B } = hall;
  const g = lamp.geometry;
  const col = g.attributes.color;
  assert.equal(col.itemSize, 4, 'see-through: the beams fade out');
  assert.ok(lamp.material.transparent && lamp.material.depthWrite === false && lamp.renderOrder < glass.renderOrder, 'before the glass round it');
  // The lantern (opaque): saturated gold, far from the plaster's cream (linear colours).
  const wall = new THREE.Color(0xfff0d6);
  let lantern = 0;
  let beams = 0;
  for (let i = 0; i < col.count; i++) {
    const [r, gr, b, a] = [col.getX(i), col.getY(i), col.getZ(i), col.getW(i)];
    if (a === 1) {
      lantern++;
      assert.ok(r > 0.9 && gr < 0.6 * r && b < 0.1 * r, `lantern ${[r, gr, b].map((v) => v.toFixed(2))}`);
      assert.ok(gr < wall.g - 0.3 && b < wall.b - 0.4, 'not the wall\'s cream');
    } else {
      beams++;
      assert.ok(a >= 0 && a < 0.9, `beam ${a}`);
    }
  }
  assert.ok(lantern >= 8 * 6 && beams >= 4 * 4, `${lantern} lantern and ${beams} beam vertices`);
  // Lit, the beams turn with the time; wherever they point, inside the bottle's glass.
  area.setLit(true);
  const p = new THREE.Vector3();
  const pos = g.attributes.position;
  let reach = 0;
  for (let k = 0; k < 16; k++) {
    area.update(k * 0.7);
    assert.ok(Math.abs(lamp.rotation.y - k * 0.7 * 0.55) < 1e-9, 'turning');
    area.root.updateMatrixWorld(true);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(lamp.matrixWorld);
      const q = local(p);
      const r = Math.hypot(q.x, q.y - B.axisY);
      reach = Math.max(reach, Math.hypot(q.x - lamp.position.x, q.z - lamp.position.z));
      assert.ok(r < B.bodyR - 40 && q.z > B.body[0] + 40 && q.z < B.body[1], `inside the glass: ${JSON.stringify(q)} (${r.toFixed(0)} off its axis)`);
    }
  }
  assert.ok(reach > 300, `the beams reach out ${reach.toFixed(0)}`);
  area.setLit(false);
});

test("the hall's objects (its coins, the 1-up, their shadows and sparkles) stay within an area's 8 meshes", () => {
  const { om } = hero(0, 0, 1550, Math.PI, { objects: true });
  let n = 0;
  om.group.traverse((o) => o.isMesh && n++);
  assert.ok(n > 0 && n <= 8, `${n} meshes`);
});
