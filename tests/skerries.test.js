// Midsummer Skerries (world/skerries/*), built as the game builds it (world/area.js buildArea at
// the course's origin) with the real Player, CameraController and ObjectManager: its budgets
// (meshes, triangles, colliders, build time; the course's own objects too), the arrival's open
// sky for the drop-in onto the jetty (the camera behind him over the jetty, clear), the sea
// (sea level across the bay, none outside it) over a seabed under all of it, every top Jonas
// can stand on low enough over the sea to get out of the water onto it (or with a gentle
// beach), the enclosure (jump, crouch and attack spam from every rock, the east route's decks,
// roofs and bridge and the meadow, and leaps off the lighthouse gallery never get Jonas or the
// camera out of the bay; nothing high near its walls), signs read from the front only, every
// coin over a floor but those in the air, the star waiting on the gallery, the 1-up in the
// sunken boat on the seabed, the sand bar he stands up on mid-Sound, the houses' walls solid
// where they stand, the firs stopping him like walls, the keeper's hut built into the rock (no
// crack beside it), the camera's moment behind the cottage's corners, the net mast and the
// maypole held from their south sides with the camera there, butterflies over the meadow and
// white gulls overhead, the lamp dark until the star is won, the camera keeping him in view
// when he walks off the gallery's gap and the signal mast catches him under its floor, and the
// critters' homes (on their level, dry, a safe knockback toward home from anywhere in their
// circles, clear of every route and of each other, the camera never losing him round them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as sk from '../src/world/skerries/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { makeRng, wrapAngle } from '../src/core/math.js';
import { CEIL_NONE, NO_WATER } from '../src/core/constants.js';
import { CRITTER } from '../src/objects/Critters.js';
import { CORRIDORS, corridorDistance } from './helpers/skerriesCorridors.js';

const O = AREA_DEFS.skerries.origin;
const t0 = performance.now();
const area = buildArea(new THREE.Scene(), AREA_DEFS.skerries);
const buildMs = performance.now() - t0;
const col = area.collision;
const { BAY } = sk;

// Local (course) <-> world coordinates.
const world = (x, y, z) => ({ x: x + O.x, y: y + O.y, z: z + O.z });
const local = (p) => ({ x: p.x - O.x, y: p.y - O.y, z: p.z - O.z });
const inBay = (p, slack = 0) => p.x >= BAY.x0 - slack && p.x <= BAY.x1 + slack && p.z >= BAY.z0 - slack && p.z <= BAY.z1 + slack;

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
  const om = objects ? new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'skerries' }) : null;
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

const meshes = [];
area.root.traverse((o) => o.isMesh && meshes.push(o));
const mesh = (name) => meshes.find((m) => m.name === name);
const lighthouse = area.parts.find((p) => p.name === 'skerries');

test('budgets: at most 13 meshes with baked colours, under 45k triangles and 8k collider triangles, built in under 1.5 s', () => {
  assert.ok(meshes.length <= 13, `${meshes.length} meshes`);
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    assert.ok(g.attributes.color, `${m.name} has vertex colours`);
    assert.ok(g.attributes.position.count > 0, `${m.name} has vertices`);
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  assert.ok(tris < 45000, `${tris} triangles`);
  const colliders = area.parts.flatMap((p) => p.colliders);
  const colliderTris = colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(colliderTris < 8000, `${colliderTris} collider triangles`);
  assert.deepEqual([...new Set(colliders.map((c) => c.terrain))].sort(), ['grass', 'sand', 'stone', 'wood']);
  assert.deepEqual([...new Set(colliders.map((c) => c.surface).filter(Boolean))], ['not_slippery'], 'the stair');
  assert.ok(buildMs < 1500, `built in ${buildMs.toFixed(0)} ms`);
  assert.deepEqual(area.parts.map((p) => p.name), ['skerries', 'sea']);
});

test('the arrival: on the jetty facing north up the Sound, open sky over it for the 1600 drop; he lands there with the camera behind him, clear', () => {
  const e = sk.ENTRIES.arrival;
  assert.equal(e.drop, 1600);
  assert.equal(e.yaw, Math.PI);
  const floor = col.findFloor(e.x + O.x, e.y + 10, e.z + O.z);
  assert.ok(floor.surface && Math.abs(floor.y - O.y - sk.JETTY.top) < 1e-6 && floor.surface.terrain === 'wood', `on the jetty: ${floor.y - O.y}`);
  assert.equal(col.findCeil(e.x + O.x, e.y + 10, e.z + O.z).y, CEIL_NONE);
  // Nothing over him or a body's width round him all the way up.
  for (const [dx, dz] of [[0, 0], [50, 0], [-50, 0], [0, 50], [0, -50]]) {
    assert.equal(col.raycast(world(e.x + dx, e.y + 10, e.z + dz), { x: 0, y: 1, z: 0 }, e.drop + 400), null, `clear over (${dx}, ${dz})`);
  }
  const { p, ctl, at } = hero(0, 0, 0, 0);
  p.placeAt(area.entries.arrival);
  assert.equal(p.action, 'spawn');
  const cam = camera(p, { yaw: area.entries.arrival.camYaw });
  for (let i = 0; i < 60; i++) {
    const c = ctl.next({});
    p.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, p);
  }
  const end = at();
  assert.ok(p.grounded && Math.abs(end.y - sk.JETTY.top) < 1 && Math.abs(end.z - e.z) < 1, `landed on the jetty: ${JSON.stringify(end)}`);
  const c = local(cam.pos);
  assert.ok(c.z > end.z + 800 && Math.abs(c.x - end.x) < 100, `camera behind him (south): ${JSON.stringify(c)}`);
  assert.equal(cam.collider.occluded, false);
  // Looking north, toward the lighthouse.
  assert.ok(Math.abs(wrapAngle(cam.getYaw() - Math.PI)) < 0.2, `camera yaw ${cam.getYaw()}`);
  // The first push: the stick held straight forward (running, or walking at half tilt) takes
  // him up the jetty past the welcome sign, nothing in his way, through its five coins.
  for (const stickY of [1, 0.45]) {
    const run = hero(0, 0, 0, 0, { objects: true });
    run.p.placeAt(area.entries.arrival);
    const view = camera(run.p, { yaw: area.entries.arrival.camYaw });
    let t = 0;
    for (; t < 400 && run.at().z > 600; t++) {
      const c = run.ctl.next(run.p.grounded || t < 40 ? { stickY } : {});
      run.p.update(view.playerInput(c), view.getYaw());
      view.update(c, run.p);
      run.om.update({ player: run.p });
    }
    const q = run.at();
    assert.ok(q.z <= 600 && Math.abs(q.y - sk.JETTY.top) < 1, `stick ${stickY}: up the jetty past the sign to ${JSON.stringify(q)} (${run.p.action})`);
    assert.equal(run.log.filter((n) => n === 'coin').length, 5, `stick ${stickY}: the jetty's coins`);
  }
});

test('the sea: sea level across the bay (the Sound, the gaps between the skerries, by the walls), no water outside it', () => {
  for (const [x, z] of [[0, 400], [0, -1000], [1500, -500], [-2800, 1100], [-3000, -2300], [5150, 0], [-5150, -6550], [0, 5300], [3000, 3000]]) {
    assert.equal(area.waterFn(x + O.x, z + O.z), O.y + sk.SEA_LEVEL, `water at (${x}, ${z})`);
  }
  for (const [x, z] of [[5300, 0], [-5300, 0], [0, -6700], [0, 5500], [9000, 9000]]) {
    assert.equal(area.waterFn(x + O.x, z + O.z), NO_WATER, `none at (${x}, ${z})`);
  }
  assert.equal(sk.waterLevelAt(0, 0), sk.SEA_LEVEL);
});

test('a seabed under the whole bay: from the sea surface, 200 sampled points all find a floor, none under the seabed', () => {
  const rng = makeRng(77);
  for (let i = 0; i < 200; i++) {
    const x = BAY.x0 + 1 + rng() * (BAY.x1 - BAY.x0 - 2);
    const z = BAY.z0 + 1 + rng() * (BAY.z1 - BAY.z0 - 2);
    const floor = col.findFloor(x + O.x, sk.SEA_LEVEL + O.y, z + O.z);
    assert.ok(floor.surface && floor.y - O.y >= BAY.bedY - 1e-6, `(${x.toFixed(0)}, ${z.toFixed(0)}): ${floor.y - O.y}`);
  }
});

test('every top he can stand on is at most 260 over the sea, or the islet with its beach of at most 38 degrees', () => {
  for (const s of [...sk.SKERRIES.filter((s) => s.id !== 'great_rock'), ...sk.REEF]) assert.ok(s.top - sk.SEA_LEVEL <= 260, `${s.id ?? `reef (${s.x}, ${s.z})`}: ${s.top}`);
  assert.ok(sk.HOME.top <= 260 && sk.JETTY.top <= 260 && sk.BOAT.deck <= 260);
  assert.ok(sk.EAST_ROCK.top <= 260 && sk.BOARDWALK.top <= 260, 'East Rock and the boardwalk');
  // The boardwalk's floors (its stretches and the narrow plank) are where the layout says: the
  // last at East Rock's height, a step over the rest.
  for (const w of sk.BOARDWALK.stretches) {
    const floor = col.findFloor((w.x0 + w.x1) / 2 + O.x, 600, (w.z0 + w.z1) / 2 + O.z);
    assert.ok(Math.abs(floor.y - O.y - (w.top ?? sk.BOARDWALK.top)) < 1e-6 && floor.surface.terrain === 'wood', `stretch ${JSON.stringify(w)}: ${floor.y - O.y}`);
  }
  assert.equal(sk.BOARDWALK.stretches.at(-1).top, sk.EAST_ROCK.top);
  // Great Rock is the islet's first terrace's west spur: the islet has its beach.
  assert.equal(sk.skerry('great_rock').top, sk.TERRACES[0].top);
  const slope = (rise, run) => (Math.atan2(rise, run) * 180) / Math.PI;
  const B = sk.ISLET_BEACH;
  assert.ok(slope(B.top - B.foot, B.z1 - B.z0) <= 38, `the islet's beach: ${slope(B.top - B.foot, B.z1 - B.z0).toFixed(1)} degrees`);
  assert.ok(slope(sk.HOME.top - sk.HOME_BEACH.foot, sk.HOME_BEACH.run) <= 38, 'Home Island\'s beach');
  // The beaches' real floors: walkable, sand.
  for (const [x, z] of [[0, (B.z0 + B.z1) / 2], [B.x0 + 20, B.z0 + 100], [B.x1 - 20, B.z1 - 50]]) {
    const hit = col.raycast(world(x, 600, z), { x: 0, y: -1, z: 0 }, 2000);
    assert.ok(hit && hit.surface.terrain === 'sand' && (Math.acos(hit.normal.y) * 180) / Math.PI <= 38, `the islet's beach at (${x}, ${z})`);
  }
});

// Spam (jump, crouch, attack, the stick turning every 20 ticks) from `start` for n ticks; the
// first tick Jonas or the camera left the bay (with `slack`), or null.
function spam(start, seed, n, slack = 0) {
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
    if (!inBay(local(p.pos), slack)) return `tick ${i}: Jonas at ${JSON.stringify(local(p.pos))} (${p.action})`;
    if (!inBay(local(cam.pos), slack)) return `tick ${i}: camera at ${JSON.stringify(local(cam.pos))}`;
  }
  return null;
}

test('the enclosure holds: jump, crouch and attack spam from every rock, deck and roof never gets Jonas or the camera out of the bay', () => {
  const { ENTRIES, HOME, ISLET, TERRACES, LIGHTHOUSE: L, BOAT, EAST_ROCK: E, NET_SHED: N, PINNACLE: P, BRIDGE: B, MAYPOLE: M, SANDBAR: S } = sk;
  const starts = [
    [ENTRIES.arrival.x, ENTRIES.arrival.y, ENTRIES.arrival.z],
    [0, HOME.top, 3800],
    [-2000, HOME.top, 4800],
    [M.x + 200, HOME.top, M.z + 200],
    [1900, HOME.top, 4200],
    [(BOAT.x0 + BOAT.x1) / 2, BOAT.deck, 900],
    ...sk.SKERRIES.map((s) => [s.x, s.top, s.z]),
    ...sk.REEF.map((s) => [s.x, s.top, s.z]),
    [ISLET.x - 1700, TERRACES[0].top, ISLET.z - 600],
    [ISLET.x + 900, TERRACES[1].top, ISLET.z - 900],
    [ISLET.x - 400, TERRACES[2].top, ISLET.z + 400],
    [L.x - 430, L.gallery, L.z],
    ...sk.BOARDWALK.stretches.filter((w) => !w.narrow).map((w) => [(w.x0 + w.x1) / 2, w.top ?? sk.BOARDWALK.top, (w.z0 + w.z1) / 2]),
    [E.x + 600, E.top, E.z - 200],
    [E.x - 300, E.top, E.z - 700],
    [(N.x0 + N.x1) / 2, N.top, (N.z0 + N.z1) / 2],
    [(P.x0 + P.x1) / 2, P.top, (P.z0 + P.z1) / 2],
    [(B.head.x + B.foot.x) / 2 + (B.head.x - B.foot.x) * 0.3, B.head.y - (B.head.y - B.foot.y) * 0.2, (B.head.z + B.foot.z) / 2 + (B.head.z - B.foot.z) * 0.3],
    [S.x, S.top, S.z],
  ];
  const out = [];
  starts.forEach((s, run) => {
    const bad = spam(s, 3000 + run, 600);
    if (bad) out.push(`run ${run} from ${JSON.stringify(s)}: ${bad}`);
  });
  assert.deepEqual(out, []);
});

test('the farthest leaps of all, long jumps at full speed off the gallery railing\'s top in 16 directions, never carry him out of the bay (most end at its walls)', () => {
  const L = sk.LIGHTHOUSE;
  const out = [];
  let walls = 0;
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    const r = L.galleryR - L.railThick / 2;
    const { p, ctl, at } = hero(L.x + Math.sin(yaw) * r, L.gallery + L.rail, L.z + Math.cos(yaw) * r, yaw);
    p.forwardVel = 32;
    p.setAction('long_jump');
    let far = 0;
    for (let i = 0; i < 300 && !p.inWater && !(p.grounded && i > 2); i++) {
      p.update(ctl.next({ stickY: 1 }), yaw);
      const a = at();
      far = Math.max(far, Math.abs(a.x) / BAY.x1, a.z / BAY.z0);
      if (!inBay(a)) {
        out.push(`toward ${Math.round((yaw * 180) / Math.PI)}: out at ${JSON.stringify(a)}`);
        break;
      }
    }
    if (far > 0.98) walls++;
  }
  assert.deepEqual(out, []);
  assert.ok(walls >= 8, `${walls} of the leaps reached a wall`);
});

test(`nothing high near the walls: no spot to stand on over ${sk.EDGE_RULE.y} and no pole tip over it lies within ${sk.EDGE_RULE.dist} of the enclosure`, () => {
  const { dist, y: max } = sk.EDGE_RULE;
  const near = (x, z) => Math.min(x - BAY.x0, BAY.x1 - x, z - BAY.z0, BAY.z1 - z) < dist;
  const high = [];
  for (let x = BAY.x0 + 5; x < BAY.x1; x += 50) {
    for (let z = BAY.z0 + 5; z < BAY.z1; z += 50) {
      if (!near(x, z)) continue;
      const floor = col.findFloor(x + O.x, BAY.wallTop + O.y, z + O.z);
      if (floor.surface && floor.y - O.y > max) high.push(`(${x}, ${z}): ${Math.round(floor.y - O.y)}`);
    }
  }
  assert.deepEqual(high.slice(0, 10), [], `${high.length} spots`);
  for (const pole of sk.POLES) assert.ok(pole.y1 <= max || !near(pole.x, pole.z), `pole at (${pole.x}, ${pole.z})`);
});

test('every sign is read from in front of its face, never from behind', () => {
  const problems = [];
  for (const s of sk.SIGNS) {
    for (const [side, off] of [['front', 0], ['front-left', 0.6], ['front-right', -0.6], ['behind', Math.PI]]) {
      const a = s.yaw + off;
      // As far out as there is a floor at most a step under the sign's (the jetty's sign is read
      // from the boat's deck too) and nothing between the spot and the signpost's box.
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
});

test('58 coins, each over a floor within 120, but those in the air: the long jump\'s arc over the water, up the two masts\' axes and the chimney', () => {
  assert.equal(sk.COINS.length, 58);
  const { MAST, MAYPOLE, CHIMNEY } = sk;
  const onAxis = (c, p) => c.x === p.x && c.z === p.z;
  const inChimney = (c) => c.x > CHIMNEY.x0 && c.x < CHIMNEY.x1 && c.z > CHIMNEY.z0 && c.z < CHIMNEY.z1;
  const air = { mast: [], maypole: [], chimney: [], arc: [] };
  for (const c of sk.COINS) {
    if (onAxis(c, MAST)) air.mast.push(c);
    else if (onAxis(c, MAYPOLE)) air.maypole.push(c);
    else if (inChimney(c)) air.chimney.push(c);
    else if (col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0).y - O.y < sk.SEA_LEVEL && c.y > sk.SEA_LEVEL) air.arc.push(c);
  }
  assert.equal(air.arc.length, 5, 'the five over the long jump\'s gap');
  for (const c of air.arc) assert.ok(c.y >= 350 && c.y <= 450, `arc coin at ${c.y}`);
  assert.deepEqual([air.mast.length, air.maypole.length, air.chimney.length], [3, 4, 3]);
  // Up the chimney: spread over its height, in its middle.
  assert.deepEqual(air.chimney.map((c) => c.y), [450, 800, 1150]);
  const inAir = new Set([...air.arc, ...air.mast, ...air.maypole, ...air.chimney]);
  for (const c of sk.COINS) {
    assert.ok(Number.isFinite(c.y), `${JSON.stringify(c)} has a height`);
    if (inAir.has(c)) continue;
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y + O.y - floor.y <= 120 && c.y + O.y - floor.y >= 0, `${JSON.stringify(c)}: floor ${floor.y - O.y}`);
  }
  // Five of them in the sunken boat, on the seabed.
  assert.equal(sk.COINS.filter((c) => c.y < sk.BAY.bedY + 200).length, 5);
});

test("the star waits on the gallery's east side from the start, 160 over its floor, idle; the course's objects stay within 9 meshes", () => {
  const S = sk.STAR;
  assert.equal(S.placed, true);
  assert.equal(S.id, 'skerries_star');
  const L = sk.LIGHTHOUSE;
  const r = Math.hypot(S.x - L.x, S.z - L.z);
  assert.ok(r > L.lanternR + 100 && r < L.galleryR - 100, `on the gallery ring: ${r}`);
  assert.equal(col.findFloor(S.x + O.x, S.y + O.y, S.z + O.z, 0).y - O.y, L.gallery);
  assert.equal(S.y - L.gallery, 160);
  const { om } = hero(0, sk.HOME.top, 3800, 0, { objects: true });
  assert.equal(om.star.state, 'idle');
  assert.equal(om.star.mesh.visible, true);
  let n = 0;
  om.group.traverse((o) => o.isMesh && n++);
  assert.ok(n > 0 && n <= 9, `${n} meshes`);
});

test('the course\'s objects: the 1-up waits in the sunken boat on the seabed, butterflies flutter over Home Island\'s meadow, white gulls circle over the island and round the lighthouse', () => {
  const { WRECK, ONE_UP, BUTTERFLY_SPOTS, BIRD_CIRCLES, BIRD_TINT } = sk;
  const { om } = hero(0, sk.HOME.top, 3800, 0, { objects: true });
  const gem = om.oneUp;
  assert.ok(gem && gem.alive, 'the 1-up');
  assert.deepEqual([gem.pos.x, gem.pos.y, gem.pos.z], [ONE_UP.x + O.x, ONE_UP.y + O.y, ONE_UP.z + O.z]);
  const floor = col.findFloor(gem.pos.x, gem.pos.y, gem.pos.z);
  assert.ok(floor.surface.terrain === 'wood' && Math.abs(floor.y - O.y - WRECK.floor) < 1e-6, `on the boat's floor: ${floor.y - O.y}`);
  assert.ok(Math.hypot(ONE_UP.x - WRECK.x, ONE_UP.z - WRECK.z) < WRECK.length / 2 - 20, 'inside the boat');
  assert.ok(ONE_UP.y < sk.SEA_LEVEL - 500, 'a dive down');
  // Three butterflies a spot, each spot over the meadow (grass).
  assert.equal(om.butterflies.list.length, 3 * BUTTERFLY_SPOTS.length);
  for (const b of BUTTERFLY_SPOTS) assert.equal(col.findFloor(b.x + O.x, 1000, b.z + O.z).surface.terrain, 'grass', `spot (${b.x}, ${b.z})`);
  // The gulls: a flock a circle, white bodies (the tint) over a little darker wings, high over
  // everything under them.
  const birds = om.birds.birds;
  assert.ok(birds.length >= 3 * BIRD_CIRCLES.length && birds.length <= 5 * BIRD_CIRCLES.length, `${birds.length} gulls`);
  const white = new THREE.Color(BIRD_TINT);
  const colour = om.birds.mesh.geometry.attributes.color;
  assert.deepEqual([colour.getX(0), colour.getY(0), colour.getZ(0)].map((v) => +v.toFixed(4)), [white.r, white.g, white.b].map((v) => +v.toFixed(4)), 'body');
  const last = colour.count - 1;
  assert.ok(colour.getX(last) < white.r && colour.getX(last) > 0.5 * white.r, 'wings a shade darker');
  for (const b of birds) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const under = col.findFloor(b.c.x + Math.cos(a) * b.radius, 1e5, b.c.z + Math.sin(a) * b.radius).y;
      assert.ok(b.alt > under + 300, `a gull at ${b.alt.toFixed(0)} over ${under.toFixed(0)}`);
    }
  }
});

test('the props: the sand bar mid-Sound is shallow enough to stand on (he swims in over its edge and stands up on it); the houses and the plank bridge are solid; five climbable poles', () => {
  const S = sk.SANDBAR;
  for (const [dx, dz] of [[0, 900], [900, 0], [-900, -300]]) {
    const yaw = Math.atan2(-dx, -dz);
    const { p, ctl, at } = hero(S.x + dx, 0, S.z + dz, yaw);
    p.teleport(S.x + dx + O.x, -80 + O.y, S.z + dz + O.z, yaw);
    p.setAction('water_surface');
    let t = 0;
    for (; t < 300 && (p.inWater || !p.grounded); t++) p.update(ctl.next(p.inWater ? { A: t % 12 === 0 } : {}), yaw);
    for (let k = 0; k < 20; k++) p.update(ctl.next({}), yaw);
    assert.ok(p.grounded && !p.inWater && Math.abs(at().y - S.top) < 1e-6, `from (${dx}, ${dz}): ${JSON.stringify(at())} (${p.action})`);
    assert.ok(Math.hypot(at().x - S.x, at().z - S.z) < S.r, 'on its top');
    assert.equal(p.health, 8);
  }
  // A horizontal ray at each of every house's walls from 200 outside it (in the open, at its
  // middle or as near it as the open goes) hits that wall, there: not something else in the way,
  // nor a wall further in. The only wall with no open in front of it is the keeper's hut's west
  // wall, built into the rock (next test).
  const buried = [];
  for (const [name, h, y0] of [['cottage', sk.COTTAGE, sk.HOME.top], ['hut', sk.HUT, sk.TERRACES[1].top], ['boathouse', sk.BOATHOUSE, sk.EAST_ROCK.top], ['net shed', sk.NET_SHED, sk.EAST_ROCK.top]]) {
    const y = (h.eaves ?? h.top) - 100;
    for (const [side, dx, dz, wall] of [['west', 1, 0, h.x0], ['east', -1, 0, h.x1], ['north', 0, 1, h.z0], ['south', 0, -1, h.z1]]) {
      const start = (k) => (dx ? [wall - dx * 200, h.z0 + (h.z1 - h.z0) * k] : [h.x0 + (h.x1 - h.x0) * k, wall - dz * 200]);
      const k = [0.5, 0.35, 0.65, 0.2, 0.8].find((f) => col.findFloor(start(f)[0] + O.x, 1e4, start(f)[1] + O.z).y - O.y < y0 + 1);
      if (k === undefined) {
        buried.push(`${name} ${side}`);
        continue;
      }
      const [x, z] = start(k);
      const hit = col.raycast(world(x, y, z), { x: dx, y: 0, z: dz }, 400);
      assert.ok(hit && Math.abs(hit.distance - 200) < 2 && hit.surface.terrain === 'wood', `the ${name}'s ${side} wall from (${x}, ${z}): ${hit?.distance}`);
    }
    if (h.ridge) assert.ok(Math.abs(col.findFloor((h.x0 + h.x1) / 2 + O.x, 1e4, (h.z0 + h.z1) / 2 + O.z).y - O.y - h.ridge) < 1, `the ${name}'s ridge at ${h.ridge}`);
  }
  assert.deepEqual(buried, ['hut west']);
  // The bridge's decks: a floor at the deck's height a quarter and three quarters down it, none in
  // its gap's middle (the water, far under).
  const B = sk.BRIDGE;
  const deck = (k) => col.findFloor(B.head.x + (B.foot.x - B.head.x) * k + O.x, 3000, B.head.z + (B.foot.z - B.head.z) * k + O.z).y - O.y;
  for (const k of [0.25, 0.75]) assert.ok(Math.abs(deck(k) - (B.head.y + (B.foot.y - B.head.y) * k)) < 1, `deck at ${k}: ${deck(k)}`);
  assert.ok(deck(0.5) < 0, `the gap: ${deck(0.5)}`);
  // The poles as built (moved to the course's place): the boat's mast, the signal mast, the
  // net mast, the maypole and the flagpole, the three over Home Island and East Rock standing on
  // their floors; the signal mast, the net mast and the maypole with sides of their own.
  assert.equal(col.poles.length, 5);
  const built = col.poles.map((p) => ({ x: p.x - O.x, z: p.z - O.z, y0: p.y0 - O.y, y1: p.y1 - O.y, camYaw: p.camYaw }));
  const want = [[sk.BOAT_MAST, sk.BOAT.deck], [sk.MAST, sk.TERRACES[2].top], [sk.NET_MAST, sk.EAST_ROCK.top], [sk.MAYPOLE, sk.HOME.top], [sk.FLAGPOLE, sk.HOME.top]];
  want.forEach(([p, floor], i) => {
    assert.deepEqual([built[i].x, built[i].z, built[i].y1], [p.x, p.z, p.y1], `pole ${i}`);
    assert.equal(built[i].y0, floor, `pole ${i} stands on its floor`);
    assert.ok(Math.abs(col.findFloor(p.x + O.x, floor + 10 + O.y, p.z + O.z).y - O.y - floor) < 1, `a floor under pole ${i}`);
  });
  assert.deepEqual(built.map((p) => p.camYaw), [undefined, 0, 0, 0, undefined]);
});

test('the firs on the second terrace stop him like walls: walked into from any side, he is never carried up them, and stays on the terrace beside them', () => {
  const T2 = sk.TERRACES[1].top;
  const problems = [];
  let walks = 0;
  for (const f of sk.FIRS) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const d = f.r + 150;
      const [x, z] = [f.x + Math.sin(a) * d, f.z + Math.cos(a) * d];
      // A start on the terrace, with the fir the first thing in the way.
      if (Math.abs(col.findFloor(x + O.x, T2 + 100 + O.y, z + O.z).y - O.y - T2) > 1) continue;
      const yaw = a + Math.PI;
      const first = col.raycast(world(x, T2 + 60, z), { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, d);
      if (!first || Math.hypot(first.point.x - O.x - f.x, first.point.z - O.z - f.z) > f.r) continue;
      for (const stickY of [1, 0.5]) {
        walks++;
        const { p, ctl, at } = hero(x, T2, z, yaw);
        let top = 0;
        let near = Infinity;
        let off = 0;
        for (let t = 0; t < 40; t++) {
          p.update(ctl.next({ stickY }), yaw);
          const q = at();
          const r = Math.hypot(q.x - f.x, q.z - f.z);
          top = Math.max(top, q.y);
          near = Math.min(near, r);
          if (r < f.r + 150 && (!p.grounded || Math.abs(q.y - T2) > 1)) off++;
        }
        if (top > T2 + 1 || near < f.r * 0.8 || off > 0) problems.push(`fir at (${f.x}, ${f.z}) from ${k * 22.5} degrees, stick ${stickY}: up to ${top.toFixed(0)}, ${near.toFixed(0)} from its trunk, ${off} ticks off the terrace by it`);
      }
    }
  }
  assert.ok(walks >= 16, `${walks} walks`);
  assert.deepEqual(problems, []);
});

test("the keeper's hut is built into the third terrace's corner: the rock runs on over its whole west wall (no crack between them to squeeze into); walked at it and along the rock beside it from round about, with the follow camera, he is never hidden", () => {
  const H = sk.HUT;
  const T2 = sk.TERRACES[1].top;
  const T3 = sk.TERRACES[2].top;
  for (let z = H.z0; z <= H.z1; z += 25) {
    const floor = col.findFloor(H.x0 + 5 + O.x, 1e4, z + O.z);
    assert.ok(Math.abs(floor.y - O.y - T3) < 1 && floor.surface.terrain !== 'wood', `the rock over its west wall at z ${z}: ${floor.y - O.y}`);
  }
  // Under the terrace's top: nothing of it to stand on up there.
  assert.ok(H.ridge < T3);
  const hidden = [];
  for (const [x, z] of [[750, -3600], [934, -3476], [1100, -3650], [1150, -3900], [950, -4200]]) {
    for (const [tx, tz] of [[700, -4000], [840, -3900], [800, -4300]]) {
      const { p, ctl, at } = hero(x, T2, z, Math.atan2(tx - x, tz - z));
      const cam = camera(p);
      let n = 0;
      for (let t = 0; t < 80; t++) {
        const q = at();
        const a = wrapAngle(cam.getYaw() - Math.atan2(tx - q.x, tz - q.z));
        const c = ctl.next({ stickX: Math.sin(a), stickY: Math.cos(a) });
        p.update(cam.playerInput(c), cam.getYaw());
        cam.update(c, p);
        const d = { x: p.pos.x - cam.pos.x, y: p.pos.y + 100 - cam.pos.y, z: p.pos.z - cam.pos.z };
        if (col.raycast(cam.pos, d, Math.hypot(d.x, d.y, d.z) - 5)) n++;
      }
      assert.ok(p.grounded && Math.abs(at().y - T2) < 1, `from (${x}, ${z}) toward (${tx}, ${tz}): on the terrace (${JSON.stringify(at())})`);
      if (n > 0) hidden.push(`from (${x}, ${z}) toward (${tx}, ${tz}): ${n} ticks hidden, at ${JSON.stringify(at())}`);
    }
  }
  assert.deepEqual(hidden, []);
});

test("walked round the cottage close to its walls, either way, with the follow camera: at each corner the camera trailing behind is hidden by the house for a moment, until it is trapped and turns back to a clear view (sight.js), never more than 24 ticks; he is in view again on every side", () => {
  const H = sk.COTTAGE;
  const m = 70;
  const out = [];
  for (const way of [1, -1]) {
    let corners = [[H.x0 - m, H.z1 + m], [H.x1 + m, H.z1 + m], [H.x1 + m, H.z0 - m], [H.x0 - m, H.z0 - m]];
    if (way < 0) corners = corners.reverse();
    const [a, b] = corners;
    const { p, ctl, at } = hero(a[0], sk.HOME.top, a[1], Math.atan2(b[0] - a[0], b[1] - a[1]));
    const cam = camera(p);
    let streak = 0;
    let longest = 0;
    for (let i = 1; i <= 4; i++) {
      const [tx, tz] = corners[i % 4];
      for (let t = 0; t < 200 && Math.hypot(tx - at().x, tz - at().z) > 40; t++) {
        const q = at();
        const yaw = wrapAngle(cam.getYaw() - Math.atan2(tx - q.x, tz - q.z));
        const c = ctl.next({ stickX: Math.sin(yaw), stickY: Math.cos(yaw) });
        p.update(cam.playerInput(c), cam.getYaw());
        cam.update(c, p);
        const d = { x: p.pos.x - cam.pos.x, y: p.pos.y + 100 - cam.pos.y, z: p.pos.z - cam.pos.z };
        streak = col.raycast(cam.pos, d, Math.hypot(d.x, d.y, d.z) - 5) ? streak + 1 : 0;
        longest = Math.max(longest, streak);
      }
      // At the next corner, along this side: on the meadow, in view.
      if (Math.hypot(tx - at().x, tz - at().z) > 40 || Math.abs(at().y - sk.HOME.top) > 1 || streak > 0) out.push(`${way > 0 ? 'one way' : 'the other way'}, side ${i}: at ${JSON.stringify(at())}, ${streak} ticks hidden`);
    }
    if (longest > 24) out.push(`${way > 0 ? 'one way' : 'the other way'}: hidden ${longest} ticks in a row`);
  }
  assert.deepEqual(out, []);
});

test("the net mast and the maypole have a side of their own: grabbed from any side with the follow camera, he works round to the south and the camera swings round behind him there; the flagpole, without one, is held where he grabbed it", () => {
  const holds = {};
  // (The net mast's east side: 200 out, short of the boathouse.)
  for (const [name, P, east] of [['net mast', sk.NET_MAST, 200], ['maypole', sk.MAYPOLE, 400], ['flagpole', sk.FLAGPOLE, 400]]) {
    for (const [side, dx, dz] of [['south', 0, 400], ['east', east, 0], ['west', -400, 0], ['north', 0, -200]]) {
      const { p, ctl, at } = hero(P.x + dx, P.y0, P.z + dz, Math.atan2(-dx, -dz));
      const cam = camera(p);
      const tick = (input) => {
        const c = ctl.next(input);
        p.update(cam.playerInput(c), cam.getYaw());
        cam.update(c, p);
      };
      // Walked at and jumped onto, then held still.
      for (let k = 0; k < 200 && p.action !== 'pole'; k++) {
        const q = at();
        const a = wrapAngle(cam.getYaw() - Math.atan2(P.x - q.x, P.z - q.z));
        tick({ stickX: Math.sin(a), stickY: Math.cos(a), A: Math.hypot(q.x - P.x, q.z - P.z) < 130 && p.grounded });
      }
      assert.equal(p.action, 'pole', `${name} from the ${side}: grabbed it`);
      for (let k = 0; k < 120; k++) tick({});
      const q = at();
      const c = local(cam.pos);
      holds[`${name} from the ${side}`] = q.z > P.z + 20 && c.z > P.z + 800 && Math.abs(c.x - P.x) < 300 ? 'south' : 'elsewhere';
    }
  }
  assert.deepEqual(holds, {
    'net mast from the south': 'south',
    'net mast from the east': 'south',
    'net mast from the west': 'south',
    'net mast from the north': 'south',
    'maypole from the south': 'south',
    'maypole from the east': 'south',
    'maypole from the west': 'south',
    'maypole from the north': 'south',
    'flagpole from the south': 'south',
    'flagpole from the east': 'elsewhere',
    'flagpole from the west': 'elsewhere',
    'flagpole from the north': 'elsewhere',
  });
});

test('the look: the lighthouse lamp and its beams wait dark until setLit(true), sweep round once lit, and reset() puts them out', () => {
  const lamp = mesh('skerries-lamp');
  const beam = mesh('skerries-beam');
  assert.ok(lamp && beam);
  assert.equal(lighthouse.lit, false);
  assert.equal(lamp.visible, false);
  assert.equal(beam.visible, false);
  lighthouse.setLit(true);
  assert.equal(lighthouse.lit, true);
  assert.equal(lamp.visible && beam.visible, true);
  area.update(2, null);
  const a = beam.rotation.y;
  area.update(3, null);
  assert.notEqual(beam.rotation.y, a, 'the beams sweep');
  area.reset();
  assert.equal(lighthouse.lit, false);
  assert.equal(lamp.visible || beam.visible, false);
  // The beams fade out along their length (their vertex colours' alpha); the nets are cut out
  // of their texture; the sea shows from under the water too.
  assert.equal(beam.material.transparent, true);
  assert.equal(beam.geometry.attributes.color.itemSize, 4);
  const alpha = beam.geometry.attributes.color;
  const pos = beam.geometry.attributes.position;
  for (let i = 0; i < alpha.count; i++) assert.ok(Math.abs(pos.getX(i)) < 100 ? alpha.getW(i) > 0.4 : alpha.getW(i) < 0.01, `vertex ${i}`);
  assert.ok(mesh('skerries-nets').material.alphaTest > 0);
  assert.ok(mesh('skerries-leaves').material.map, 'the firs and the maypole\'s leaves: the leaf texture');
  assert.equal(mesh('skerries-sea').material.side, THREE.DoubleSide);
  assert.equal(mesh('skerries-sea').material.transparent, true);
});

test("walking off the gallery's gap, the signal mast catches him under its floor: the camera keeps him in view (it swings to the mast's south side, never over the gallery)", () => {
  const L = sk.LIGHTHOUSE;
  const out = {};
  // The camera behind him (north, over the gallery), in front of him (south) or beside him.
  for (const [name, yaw] of [['behind', Math.PI], ['in front', 0], ['beside', Math.PI / 2]]) {
    const h = hero(L.x, L.gallery, L.z + L.galleryR - 350, 0);
    const cam = camera(h.p, { yaw });
    let hidden = 0;
    let run = 0;
    let longest = 0;
    for (let k = 0; k < 200; k++) {
      // Walk south off the gap (the stick worked out from the camera), then hang on.
      const a = wrapAngle(cam.getYaw());
      const c = h.ctl.next(k < 30 ? { stickX: Math.sin(a), stickY: Math.cos(a) } : {});
      h.p.update(cam.playerInput(c), cam.getYaw());
      cam.update(c, h.p);
      const chest = { x: h.p.pos.x, y: h.p.pos.y + 100, z: h.p.pos.z };
      const d = { x: chest.x - cam.pos.x, y: chest.y - cam.pos.y, z: chest.z - cam.pos.z };
      const len = Math.hypot(d.x, d.y, d.z);
      run = col.raycast(cam.pos, d, len - 5) ? run + 1 : 0;
      hidden += run > 0 ? 1 : 0;
      longest = Math.max(longest, run);
    }
    assert.equal(h.p.action, 'pole', `${name}: caught by the mast`);
    assert.ok(h.at().y < L.gallery - 150, `${name}: under the gallery's floor (${Math.round(h.at().y)})`);
    out[name] = { hidden, longest };
    assert.ok(longest <= 5 && hidden <= 10, `${name}: hidden ${hidden} ticks, ${longest} in a row`);
    assert.ok(local(cam.pos).z > L.z + L.galleryR, `${name}: the camera south of the gallery (z ${Math.round(local(cam.pos).z)})`);
    assert.ok(h.at().z > sk.MAST.z + 40, `${name}: holding the mast from its south side, the trunk not between him and the camera`);
  }
});

test("the critters: two Wreath Frogs and two Mosquitoes on Home Island's meadow, a Tin Crab on the sand bar (wading) and one on the islet's first terrace, each home on its floor, its fight circle on its level and dry (a crab's where it can stand: wading at most 95 deep only where it may wade; the islet's ring a little narrower than its circle), a meadow critter's leash on level, a knockback toward home safe from anywhere he can stand in it, every route at least fight + 150 away, 1200 from the arrival, the meadow's south edge kept clear, no two circles touching; the frogs' rings, the mosquitoes' patrols (on level, clear of walls), their coins; the camera never loses him round them", () => {
  const C = sk.CRITTERS;
  assert.equal(C.length, 6);
  assert.deepEqual(C.map((c) => c.kind).sort(), ['crab', 'crab', 'frog', 'frog', 'mosquito', 'mosquito']);
  const LEASH = { frog: CRITTER.FROG.LEASH, crab: CRITTER.CRAB.LEASH, mosquito: CRITTER.MOSQUITO.LEASH };
  const floorAt = (x, z, y) => {
    const f = col.findFloor(x + O.x, y + 600 + O.y, z + O.z);
    return f.surface ? f.y - O.y : null;
  };
  // Dry (water at least 10 under the floor), or for a wading critter at most WADE_DEEP over it.
  const depth = (x, z, y) => col.waterLevelAt(x + O.x, z + O.z) - O.y - y;
  const dry = (x, z, y, wade = false) => (wade ? depth(x, z, y) <= CRITTER.SHARED.WADE_DEEP : depth(x, z, y) <= -10);
  const level = (x, z, y, dy) => {
    const f = floorAt(x, z, y);
    return f !== null && Math.abs(f - y) <= dy;
  };
  const disc = (c, r, fn) => {
    for (let dx = -r; dx <= r; dx += 25) for (let dz = -r; dz <= r; dz += 25) if (dx * dx + dz * dz <= r * r) fn(c.x + dx, c.z + dz);
  };
  const arrival = sk.ENTRIES.arrival;
  for (const c of C) {
    assert.ok(Math.abs(floorAt(c.x, c.z, c.y) - c.y) <= 1, `${c.id}: home on its floor`);
    const wade = c.wade === true;
    assert.equal(wade, c.id === 'crab_bar', `${c.id}: wading only on the sand bar`);
    // Its circle on its level and dry (a crab's: as far as it can stand, the islet's ring
    // narrower than its circle by a step); a meadow critter's whole leash disc on level.
    disc(c, c.kind === 'crab' ? 0.9 * c.fight : c.fight, (x, z) => assert.ok(level(x, z, c.y, 12) && dry(x, z, c.y, wade), `${c.id}: (${x}, ${z}) on level and dry`));
    disc(c, c.fight, (x, z) => {
      if (level(x, z, c.y, 12)) assert.ok(dry(x, z, c.y, wade), `${c.id}: (${x}, ${z}) dry where it can stand (${depth(x, z, c.y).toFixed(0)} deep)`);
    });
    if (wade) assert.ok(depth(c.x, c.z, c.y) > 0, `${c.id}: it does wade`);
    if (c.kind !== 'crab') disc(c, c.fight + LEASH[c.kind], (x, z) => assert.ok(level(x, z, c.y, 12), `${c.id}: leash at (${x}, ${z}) on level`));
    // From anywhere in the circle he can stand, knocked back toward home he lands on its level,
    // dry (wading at most WADE_DEEP at the bar).
    disc(c, c.fight, (x, z) => {
      if (!level(x, z, c.y, 12)) return;
      const d = Math.hypot(c.x - x, c.z - z);
      const ux = d > 1 ? (c.x - x) / d : 0;
      const uz = d > 1 ? (c.z - z) / d : 1;
      for (const k of [CRITTER.SHARED.KNOCK_NEAR, CRITTER.SHARED.KNOCK_FAR]) {
        const qx = x + ux * k;
        const qz = z + uz * k;
        assert.ok(level(qx, qz, c.y, CRITTER.SHARED.KNOCK_DY) && dry(qx, qz, c.y, wade), `${c.id}: knocked toward home from (${x}, ${z})`);
      }
    });
    for (const k of CORRIDORS) {
      if (Math.abs(k.y - c.y) > 100) continue;
      const d = corridorDistance(k, c.x, c.z);
      assert.ok(d >= c.fight + 150, `${c.id}: ${k.name} ${Math.round(d)} away`);
    }
    assert.ok(Math.hypot(c.x - arrival.x, c.z - arrival.z) >= 1200, `${c.id}: far from the arrival`);
    if (c.y === sk.HOME.top) assert.ok(c.z + c.fight <= 4800, `${c.id}: clear of the meadow's south edge`);
  }
  for (let i = 0; i < C.length; i++) {
    for (let j = i + 1; j < C.length; j++) assert.ok(Math.hypot(C[i].x - C[j].x, C[i].z - C[j].z) >= C[i].fight + C[j].fight, `${C[i].id} and ${C[j].id} apart`);
  }
  // In the course's objects: shifted by the origin, the frogs' rings kept, a coin slot each.
  assert.deepEqual(area.objectsLayout.CRITTERS.map((c) => [c.x - O.x, c.y - O.y, c.z - O.z]), C.map((c) => [c.x, c.y, c.z]));
  assert.equal(area.objectsLayout.CRITTERS[0].fight, C[0].fight);
  const { om } = hero(0, sk.HOME.top, 3800, 0, { objects: true });
  assert.equal(om.critters.alive, C.length);
  for (const r of om.critters.list) if (r.kind === 0) assert.ok(r.hopN >= 2, `${r.id}: ${r.hopN} ring points`);
  assert.ok(C.length <= om.coins.drops.length, 'a coin slot for each');
  // The mosquitoes' patrols (the closed form, sampled every 5 ticks for two minutes) over their
  // level, no wall within 60 of them.
  const M = CRITTER.MOSQUITO;
  for (const c of C.filter((q) => q.kind === 'mosquito')) {
    const k = c.roam / M.SWAY_X;
    const seed = C.indexOf(c) * 7.13 + 2;
    for (let L = 0; L <= 3600; L += 5) {
      const x = c.x + M.SWAY_X * k * Math.sin(M.SWAY_RATE * L + seed);
      const z = c.z + M.SWAY_Z * k * Math.sin(2 * M.SWAY_RATE * L + seed);
      const y = c.y + M.HOVER + M.BOB * Math.sin(M.BOB_RATE * L);
      assert.ok(level(x, z, c.y, 12), `${c.id}: over its level at ${L}`);
      assert.equal(col.findWalls(x + O.x, y + O.y, z + O.z, 0, 60).walls.length, 0, `${c.id}: no wall by it at ${L}`);
    }
    const r = om.critters.byId(c.id);
    assert.ok(Math.abs(r.seed - seed) < 1e-9, 'the seed as worked out here');
  }
  // The camera round each home: walked toward it from 8 sides then strafing round it, and
  // walked out from it 8 ways, while he is on its level (a walk off the sand bar or the islet's
  // ring into the sea ends there: the critter has let him go): never trapped, hidden at most 2
  // ticks.
  for (const c of C) {
    let occluded = 0;
    let trapped = 0;
    const run = (x, z, yaw, input, ticks) => {
      const h = hero(x, c.y, z, yaw);
      const cam = camera(h.p);
      for (let t = 0; t < ticks && !h.p.inWater && h.at().y > c.y - CRITTER.SHARED.LEVEL; t++) {
        const k = h.ctl.next(input(t));
        h.p.update(cam.playerInput(k), cam.getYaw());
        cam.update(k, h.p);
        if (cam.collider.occluded) occluded++;
        if (cam.collider.trapped) trapped++;
      }
    };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      let r = c.fight;
      if (!level(c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, c.y, 20)) r *= 0.6;
      const x = c.x + Math.sin(a) * r;
      const z = c.z + Math.cos(a) * r;
      run(x, z, Math.atan2(c.x - x, c.z - z), (t) => (t < 40 ? { stickY: 0.6 } : { stickX: 0.6 }), 90);
      run(c.x, c.z, a, (t) => (t < 25 ? { stickY: 0.6 } : {}), 50);
    }
    assert.equal(trapped, 0, `${c.id}: trapped ${trapped}`);
    assert.ok(occluded <= 2, `${c.id}: occluded ${occluded}`);
  }
});
