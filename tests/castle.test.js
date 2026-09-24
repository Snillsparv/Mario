// Castle + drawbridge: builds in node, colliders are outward-wound and solid, the bridge is
// walkable end to end, the entrance steps are walkable and the door is closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../src/world/layout.js';
import { buildCastle } from '../src/world/castle.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { groundStep } from '../src/player/physics/step.js';
import { SURFACE_FLOAT_DEPTH } from '../src/player/physics/tuning.js';
import { PLAYER_HEIGHT } from '../src/core/constants.js';

const C = layout.CASTLE;
const BR = layout.BRIDGE;
const part = buildCastle(layout);
const world = new CollisionWorld();
for (const c of part.colliders) world.addCollider(c);
world.finalize();

const PLAYER_R = 50;
const midZ = (C.frontZ + C.backZ) / 2;

test('castle builds in node with few merged meshes and tagged colliders', () => {
  const meshes = [];
  part.object3D.traverse((n) => n.isMesh && meshes.push(n));
  assert.ok(meshes.length >= 5 && meshes.length <= 12, `mesh count ${meshes.length}`);
  for (const m of meshes) {
    assert.ok(m.geometry.attributes.position.count > 0, `${m.name} has vertices`);
    assert.ok(m.geometry.attributes.color, `${m.name} has baked vertex colours`);
  }
  const terrains = new Set(part.colliders.map((c) => c.terrain));
  assert.deepEqual([...terrains].sort(), ['stone', 'wood']);
  assert.equal(typeof part.update, 'function');
});

test('every collider face hit from outside faces the viewer (outward winding)', () => {
  let hits = 0;
  // Horizontal rays toward the castle from all around, at several heights.
  // Angles are offset so rays never graze exactly along a polygon edge.
  for (let a = 3; a < 360; a += 10) {
    const th = (a * Math.PI) / 180;
    for (const h of [300, 1200, 2000, 2800, 3600, 4500]) {
      const y = C.baseY + h;
      const origin = { x: C.x + Math.sin(th) * 7000, y, z: midZ + Math.cos(th) * 7000 };
      const dir = { x: C.x - origin.x, y: 0, z: midZ - origin.z };
      const hit = world.raycast(origin, dir, 8000);
      if (!hit) continue;
      hits++;
      const dot = hit.normal.x * dir.x + hit.normal.z * dir.z;
      assert.ok(dot < 0, `face at ${JSON.stringify(hit.point)} faces away from the ray (angle ${a}, h ${h})`);
    }
  }
  // Vertical rays from above: roofs, walkways, deck and steps all face up.
  for (let x = -2400; x <= 2400; x += 200) {
    for (let z = C.backZ - 100; z <= BR.southZ; z += 200) {
      const hit = world.raycast({ x, y: 9000, z }, { x: 0, y: -1, z: 0 }, 12000);
      if (!hit) continue;
      hits++;
      assert.ok(hit.normal.y > 0.1, `top face at ${JSON.stringify(hit.point)} has normal y ${hit.normal.y}`);
    }
  }
  assert.ok(hits > 300, `enough rays hit the castle (${hits})`);
});

test('walls push the player out all around the building', () => {
  const y = C.baseY + 200; // above the base course
  const probes = [];
  // Front wings (either side of the entrance towers).
  for (const x of [-1300, -1000, 1000, 1300]) probes.push({ x, z: C.frontZ + 30, out: [0, 1] });
  // Wing sides and rear block sides.
  for (const s of [-1, 1]) {
    for (const z of [C.frontZ - 800, C.frontZ - 1400]) probes.push({ x: s * (C.halfWidth - 350 + 30), z, out: [s, 0] });
    for (const z of [C.frontZ - 2200, C.frontZ - 3000]) probes.push({ x: s * (C.halfWidth - 500 + 30), z, out: [s, 0] });
    // Back wall beside the central bay.
    probes.push({ x: s * 1000, z: C.backZ + 200 - 30, out: [0, -1] });
  }
  for (const p of probes) {
    const r = world.findWalls(C.x + p.x, y, p.z, 60, PLAYER_R);
    assert.ok(r.walls.length > 0, `wall found near ${p.x},${p.z}`);
    const moved = (r.x - (C.x + p.x)) * p.out[0] + (r.z - p.z) * p.out[1];
    assert.ok(moved >= PLAYER_R - 30 - 1, `pushed outward near ${p.x},${p.z} (moved ${moved.toFixed(1)})`);
  }
  // Round towers push radially too (front corner tower, outward side).
  const tx = C.halfWidth - 350;
  const r = world.findWalls(tx + 350 + 20, y, C.frontZ - 100, 60, PLAYER_R);
  assert.ok(r.x > tx + 350 + 20, 'corner tower pushes outward');
});

test('the front door is solid at every height', () => {
  const doorFootY = C.baseY + 140; // landing on top of the base course
  for (let h = 20; h <= C.doorHeight - 40; h += 60) {
    const z = C.frontZ + 60;
    const r = world.findWalls(C.x, doorFootY + h - 60, z, 60, PLAYER_R);
    assert.ok(r.walls.length > 0 && r.z > z, `door blocks at height ${h}`);
    const origin = { x: C.x, y: doorFootY + h, z: C.frontZ + 800 };
    const hit = world.raycast(origin, { x: 0, y: 0, z: -1 }, 2000, { floors: false, ceilings: false });
    assert.ok(hit && hit.point.z >= C.frontZ - 1, `ray toward the door stops at the facade (h ${h})`);
  }
});

test('entrance steps rise smoothly to the door landing', () => {
  let prev = null;
  for (let z = C.frontZ + 600; z >= C.frontZ + 20; z -= 20) {
    const f = world.findFloor(C.x, (prev ?? C.baseY) + 70, z);
    if (!f.surface) {
      assert.ok(z > C.frontZ + 300, `floor under the steps at z ${z}`);
      continue;
    }
    assert.ok(f.surface.normal.y > 0.8, `step collider walkable at z ${z}`);
    if (prev !== null) assert.ok(f.y - prev < 40 && f.y >= prev - 0.01, `smooth rise at z ${z}`);
    prev = f.y;
  }
  assert.ok(Math.abs(prev - (C.baseY + 140)) < 1, `landing at the door is on the base course (${prev})`);
});

// The door steps' extent, read off the colliders: landing height, side edge, foot of the ramp.
function doorSteps() {
  const top = world.findFloor(C.x, C.baseY + 300, C.frontZ + 60).y;
  let hw = 0;
  while (hw < 1500 && world.findFloor(C.x + hw + 5, top + 10, C.frontZ + 60).y > top - 1) hw += 5;
  let zTop = C.frontZ + 60;
  while (world.findFloor(C.x, top + 10, zTop + 5).y > top - 0.5) zTop += 5;
  let zFoot = zTop;
  while (world.findFloor(C.x, top + 10, zFoot + 5).y > C.baseY + 0.5) zFoot += 5;
  return { top, hw, zTop, zFoot };
}

test('beside the door steps their side is the only wall: nothing buried where the landing meets the ramp', () => {
  const { top, hw, zTop, zFoot } = doorSteps();
  assert.ok(Math.abs(top - (C.baseY + 140)) < 1 && hw > 300 && zTop > C.frontZ + 100 && zFoot > zTop + 150, 'found the steps');
  // A knee probe (radius 24) touching either side, all along the landing's front half and the
  // ramp, is pushed straight out: a face inside the steps (the landing's front meeting the
  // ramp's back) would shove it along z and hide the side from it.
  let probes = 0;
  for (const s of [-1, 1]) {
    for (let z = zTop - 20; z <= zFoot - 60; z += 5) {
      const x = C.x + s * (hw + 10);
      const r = world.findWalls(x, C.baseY, z, 30, 24);
      probes++;
      assert.ok(r.walls.length > 0, `side wall at ${x},${z}`);
      assert.ok(Math.abs(r.z - z) < 0.01, `pushed ${(r.z - z).toFixed(1)} along z beside the steps at ${x},${z}`);
      assert.ok(Math.abs(r.x - (C.x + s * (hw + 24))) < 0.01, `pushed out to ${r.x.toFixed(1)} beside the steps at ${x},${z}`);
    }
  }
  assert.ok(probes > 60, `${probes} probes`);
  // A horizontal ray just inside a side, from in front of the ramp toward the door, meets no
  // wall until the base course under the landing's back.
  for (const s of [-1, 1]) {
    for (const h of [20, 70, 120]) {
      const hit = world.raycast({ x: C.x + s * (hw - 5), y: C.baseY + h, z: zFoot + 200 }, { x: 0, y: 0, z: -1 }, 2000, { floors: false, ceilings: false });
      assert.ok(hit && hit.point.z <= C.frontZ + 31, `wall buried in the steps at z ${hit?.point.z.toFixed(0)} (h ${h})`);
    }
  }
});

test('the bridge deck is a continuous wooden floor from the lawn to the island', () => {
  const yS = layout.groundHeight(BR.x, BR.southZ);
  const yN = layout.ISLAND_TOP;
  for (let z = BR.northZ + 10; z <= BR.southZ - 10; z += 40) {
    for (const dx of [-BR.width / 2 + 60, 0, BR.width / 2 - 60]) {
      const f = world.findFloor(BR.x + dx, 400, z);
      assert.ok(f.surface, `deck floor at ${dx},${z}`);
      assert.equal(f.surface.terrain, 'wood');
      // Level on the island and the lawn, sloping across the moat between the banks.
      const t = Math.min(1, Math.max(0, (z - layout.ISLAND.maxZ) / (layout.MOAT.maxZ - layout.ISLAND.maxZ)));
      const expected = yN + (yS - yN) * t;
      assert.ok(Math.abs(f.y - expected) < 6, `deck height ${f.y.toFixed(1)} vs ${expected.toFixed(1)} at z ${z}`);
      assert.ok(f.surface.normal.y > 0.99, 'deck is a gentle slope');
    }
  }
  // Ends meet the lawn and the island within a small step.
  assert.ok(Math.abs(world.findFloor(BR.x, 400, BR.southZ - 5).y - yS) < 8, 'south end meets the lawn');
  assert.ok(Math.abs(world.findFloor(BR.x, 400, BR.northZ + 5).y - yN) < 8, 'north end meets the island');
});

test('bridge rails block walking off the side but are low enough to jump over', () => {
  const z = (layout.ISLAND.maxZ + layout.MOAT.maxZ) / 2; // over the water
  const deck = world.findFloor(BR.x, 400, z).y;
  const railX = BR.width / 2 - 16;
  for (const s of [-1, 1]) {
    // Touching the rail's inner face pushes back onto the deck.
    const x = BR.x + s * (railX - 16 - 40);
    const r = world.findWalls(x, deck, z, 30, PLAYER_R);
    assert.ok(r.walls.length > 0, 'rail wall found');
    assert.ok((r.x - x) * s < 0, 'pushed back onto the deck');
    // A hero walking into the rail stays on the deck.
    const hero = { collision: world, pos: { x: BR.x, y: deck, z }, vel: { x: s * 30, y: 0, z: 0 }, floor: null, grounded: true };
    for (let i = 0; i < 30; i++) groundStep(hero);
    assert.ok(hero.grounded && Math.abs(hero.pos.y - deck) < 1, 'hero still on the deck');
    assert.ok(Math.abs(hero.pos.x - BR.x) < railX - 16, `hero held inside the rail (x ${hero.pos.x.toFixed(0)})`);
    // The rail top is a low ledge; just outside it there is no floor but the moat.
    const railTop = world.findFloor(BR.x + s * railX, deck + 300, z).y;
    assert.ok(railTop > deck + 60 && railTop < deck + 130, `rail top ${railTop - deck} above the deck`);
    assert.ok(world.findFloor(BR.x + s * (railX + 30), deck + 300, z).y < layout.WATER_LEVEL, 'no ledge outside the rail');
  }
});

test('timbers under the bridge are solid for swimmers', () => {
  // Horizontal rays under the deck from just off the south abutment toward the island: the
  // underwater tie and the trestle cap stop them well before the north abutment.
  const zStart = layout.MOAT.maxZ - 100;
  for (const y of [layout.WATER_LEVEL - 240, layout.WATER_LEVEL + 120]) {
    const hit = world.raycast({ x: BR.x, y, z: zStart }, { x: 0, y: 0, z: -1 }, 2000);
    assert.ok(hit && hit.surface.terrain === 'wood', `timber blocks the swimmer at y ${y}`);
    assert.ok(hit.point.z > layout.ISLAND.maxZ + 200, `hit a trestle in the moat (z ${hit.point.z.toFixed(0)})`);
  }
  // The trestle posts stand in the water, solid from the moat floor to above the surface.
  const zt = layout.ISLAND.maxZ + ((layout.MOAT.maxZ - layout.ISLAND.maxZ) * 2) / 3;
  const px = BR.x + BR.width / 2 - 120;
  for (const y of [layout.WATER_LEVEL - 600, layout.WATER_LEVEL - 90, layout.WATER_LEVEL + 30]) {
    const hit = world.raycast({ x: px + 400, y, z: zt }, { x: -1, y: 0, z: 0 }, 800);
    assert.ok(hit && hit.surface.terrain === 'wood' && Math.abs(hit.point.x - (px + 30)) < 1, `post face at y ${y}`);
  }
});

test('the moat surface under the bridge is open to a floating swimmer', () => {
  // A hero floating at the surface: feet SURFACE_FLOAT_DEPTH under it, PLAYER_HEIGHT tall,
  // wall probes 10 and 110 over his feet (the water step). Nothing but the trestle posts may
  // touch him anywhere between the abutments, and no ceiling may push him under.
  const feet = layout.WATER_LEVEL - SURFACE_FLOAT_DEPTH;
  const hw = BR.width / 2;
  const zA = layout.ISLAND.maxZ + 90 + PLAYER_R + 10; // clear of the abutment faces
  const zB = layout.MOAT.maxZ - 90 - PLAYER_R - 10;
  const posts = [];
  for (const f of [1 / 3, 2 / 3]) {
    const zt = layout.ISLAND.maxZ + (layout.MOAT.maxZ - layout.ISLAND.maxZ) * f;
    for (const s of [-1, 1]) posts.push({ x: BR.x + s * (hw - 120), z: zt });
  }
  // Within the post's half-size (30) + radius of a post, with a little slack.
  const nearPost = (x, z) => posts.some((p) => Math.abs(x - p.x) < 30 + PLAYER_R + 5 && Math.abs(z - p.z) < 30 + PLAYER_R + 5);
  let checked = 0;
  for (let x = BR.x - hw - 100; x <= BR.x + hw + 100; x += 25) {
    for (let z = zA; z <= zB; z += 20) {
      const ceil = world.findCeil(x, feet + 80, z).y;
      assert.ok(ceil >= feet + PLAYER_HEIGHT, `ceiling ${ceil.toFixed(0)} over a floating swimmer at ${x},${z}`);
      if (nearPost(x, z)) continue;
      checked++;
      for (const dy of [10, 110]) {
        const r = world.findWalls(x, feet, z, dy, PLAYER_R);
        assert.equal(r.walls.length, 0, `wall at ${x},${z} probe +${dy}`);
      }
    }
  }
  assert.ok(checked > 800, `checked ${checked} spots`);
});

test('flags wave over time', () => {
  const flags = part.object3D.getObjectByName('castle-flags');
  assert.ok(flags, 'flag mesh exists');
  part.update(0);
  const a = Array.from(flags.geometry.attributes.position.array);
  part.update(0.7);
  const b = flags.geometry.attributes.position.array;
  const moved = a.some((v, i) => Math.abs(v - b[i]) > 1);
  assert.ok(moved, 'flag vertices move');
});
