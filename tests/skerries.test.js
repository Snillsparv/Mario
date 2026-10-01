// Midsummer Skerries (world/skerries/*), built as the game builds it (world/area.js buildArea at
// the course's origin) with the real Player, CameraController and ObjectManager: its budgets
// (meshes, triangles, colliders, build time; the course's own objects too), the arrival's open
// sky for the drop-in onto the jetty (the camera behind him over the jetty, clear), the sea
// (sea level across the bay, none outside it) over a seabed under all of it, every top Jonas
// can stand on low enough over the sea to get out of the water onto it (or with a gentle
// beach), the enclosure (jump, crouch and attack spam from every rock and leaps off the
// lighthouse gallery never get Jonas or the camera out of the bay; nothing high near its
// walls), signs read from the front only, every coin over a floor but those in the air, the
// star waiting on the gallery, the lamp dark until the star is won, and the camera keeping him
// in view when he walks off the gallery's gap and the signal mast catches him under its floor.
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

test('the enclosure holds: jump, crouch and attack spam from every rock never gets Jonas or the camera out of the bay', () => {
  const { ENTRIES, HOME, ISLET, TERRACES, LIGHTHOUSE: L, BOAT } = sk;
  const starts = [
    [ENTRIES.arrival.x, ENTRIES.arrival.y, ENTRIES.arrival.z],
    [0, HOME.top, 3800],
    [-2000, HOME.top, 4800],
    [(BOAT.x0 + BOAT.x1) / 2, BOAT.deck, 900],
    ...sk.SKERRIES.map((s) => [s.x, s.top, s.z]),
    ...sk.REEF.map((s) => [s.x, s.top, s.z]),
    [ISLET.x - 1700, TERRACES[0].top, ISLET.z - 600],
    [ISLET.x + 900, TERRACES[1].top, ISLET.z - 900],
    [ISLET.x - 400, TERRACES[2].top, ISLET.z + 400],
    [L.x - 430, L.gallery, L.z],
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

test('31 coins, each over a floor within 120, but those in the air: the long jump\'s arc over the water and up the mast', () => {
  assert.equal(sk.COINS.length, 31);
  const { MAST } = sk;
  const onMast = (c) => c.x === MAST.x && c.z === MAST.z;
  const arc = sk.COINS.filter((c) => !onMast(c) && col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0).y - O.y < sk.SEA_LEVEL);
  assert.equal(arc.length, 5, 'the five over the long jump\'s gap');
  for (const c of arc) assert.ok(c.y >= 350 && c.y <= 450, `arc coin at ${c.y}`);
  assert.equal(sk.COINS.filter(onMast).length, 3);
  for (const c of sk.COINS) {
    assert.ok(Number.isFinite(c.y), `${JSON.stringify(c)} has a height`);
    if (onMast(c) || arc.includes(c)) continue;
    const floor = col.findFloor(c.x + O.x, c.y + O.y, c.z + O.z, 0);
    assert.ok(floor.surface && c.y + O.y - floor.y <= 120 && c.y + O.y - floor.y >= 0, `${JSON.stringify(c)}: floor ${floor.y - O.y}`);
  }
});

test("the star waits on the gallery's east side from the start, 160 over its floor, idle; the course's objects stay within 8 meshes", () => {
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
  assert.ok(n > 0 && n <= 8, `${n} meshes`);
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
