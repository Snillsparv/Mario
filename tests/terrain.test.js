// Terrain collision: the built colliders must match layout.groundHeight(), have no holes
// inside the perimeter, face the right way, and let a swimmer climb out of the water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as layout from '../src/world/layout.js';
import { buildTerrain } from '../src/world/terrain.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { makeRng } from '../src/core/math.js';

const L = layout;
const part = buildTerrain(L);
const world = new CollisionWorld();
for (const c of part.colliders) world.addCollider(c);
world.finalize();

const HIGH = L.CLIFF_TOP + 5000;
const inside = (x, z) => L.sdRoundRect(x, z, L.PERIMETER) < -1;

// Distance to the nearest contour where the ground height or material changes.
function edgeDistance(x, z) {
  return Math.min(
    Math.abs(L.sdRoundRect(x, z, L.PERIMETER)),
    Math.abs(L.sdRoundRect(x, z, L.ISLAND)),
    Math.abs(L.sdWater(x, z)),
  );
}

// Height tolerance: the 100-unit mesh follows the lawn/island within a few units, and merged
// collision floors may sit up to 3 above it; the pond's steep underwater ramp is curvier
// than the mesh can follow exactly.
const tolerance = (x, z) => (L.regionAt(x, z) === 'water' ? 16 : 8);

// The rendered ground as a collision world, to compare the (partly merged) floors against.
const rendered = new CollisionWorld();
part.object3D.traverse((o) => ['grass', 'courtyard', 'bed'].includes(o.name) && rendered.addObject(o));
rendered.finalize();

test('collider budget and orientation', () => {
  const tris = part.colliders.reduce((n, c) => n + c.positions.length / 9, 0);
  assert.ok(tris < 150000, `${tris} collision triangles`);
  const kinds = { floor: 0, wall: 0, ceil: 0 };
  for (const s of world.surfaces) kinds[s.kind]++;
  assert.equal(kinds.ceil, 0, 'terrain has no downward-facing triangles');
  assert.ok(kinds.floor > 5000 && kinds.floor < 25000 && kinds.wall > 1000, JSON.stringify(kinds));
  for (const c of part.colliders) assert.ok(['grass', 'stone', 'sand'].includes(c.terrain));
});

test('floors match groundHeight away from edges', () => {
  const rng = makeRng(7);
  let checked = 0;
  while (checked < 3000) {
    const x = L.PERIMETER.minX + rng() * (L.PERIMETER.maxX - L.PERIMETER.minX);
    const z = L.PERIMETER.minZ + rng() * (L.PERIMETER.maxZ - L.PERIMETER.minZ);
    if (!inside(x, z) || edgeDistance(x, z) < 50) continue;
    checked++;
    const gh = L.groundHeight(x, z);
    const f = world.findFloor(x, gh + 20, z);
    assert.ok(f.surface, `floor at ${x.toFixed(0)},${z.toFixed(0)}`);
    assert.ok(Math.abs(f.y - gh) < tolerance(x, z), `floor ${f.y.toFixed(1)} vs ground ${gh.toFixed(1)} at ${x.toFixed(0)},${z.toFixed(0)}`);
  }
});

test('merged collision floors never dip below the rendered ground, nor float above it', () => {
  const rng = makeRng(11);
  let checked = 0;
  while (checked < 20000) {
    const x = L.PERIMETER.minX + rng() * (L.PERIMETER.maxX - L.PERIMETER.minX);
    const z = L.PERIMETER.minZ + rng() * (L.PERIMETER.maxZ - L.PERIMETER.minZ);
    if (!inside(x, z) || edgeDistance(x, z) < 20) continue;
    checked++;
    const d = world.findFloor(x, HIGH, z).y - rendered.findFloor(x, HIGH, z).y;
    assert.ok(d > -0.1 && d < 3.1, `collision floor ${d.toFixed(2)} off the rendered ground at ${x.toFixed(0)},${z.toFixed(0)}`);
  }
});

test('walking across region boundaries never finds a missing floor', () => {
  const lines = [
    [0, 7300, 0, -7700], // spawn -> path -> moat -> courtyard -> castle -> rear cliff
    [-7500, 1500, 7500, 1500], // across the front lawn and the moat's front corners
    [-7500, -1900, 7500, -1900], // waterfall pool -> pond -> moat arms -> island -> east hill
    [-7500, -6000, 7500, -6000], // behind the castle
    [-7400, 700, -4000, -4800], // diagonally through the pond
    [4300, 3000, 7400, -6000], // over the east hill and moat corner
  ];
  for (const [x0, z0, x1, z1] of lines) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 10);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      if (!inside(x, z)) continue;
      const f = world.findFloor(x, HIGH, z);
      assert.ok(f.surface, `no floor at ${x.toFixed(0)},${z.toFixed(0)}`);
      if (edgeDistance(x, z) > 10) {
        const gh = L.groundHeight(x, z);
        assert.ok(Math.abs(f.y - gh) < tolerance(x, z), `floor ${f.y.toFixed(1)} vs ${gh.toFixed(1)} at ${x.toFixed(0)},${z.toFixed(0)}`);
      }
    }
  }
});

test('the moat rim is level (no hill climbs it) and the water lies close below it', () => {
  let checked = 0;
  for (let x = L.MOAT.minX - 20; x <= L.MOAT.maxX + 20; x += 20) {
    for (let z = L.MOAT.minZ; z <= L.MOAT.maxZ + 20; z += 20) {
      const d = L.sdRoundRect(x, z, L.MOAT);
      if (d < 1 || d > 20 || !inside(x, z) || L.sdCircle(x, z, L.POND) < 1000) continue;
      checked++;
      assert.ok(Math.abs(L.groundHeight(x, z) - L.LAWN_BASE) < 1, `rim at ${x},${z}: ${L.groundHeight(x, z)}`);
    }
  }
  assert.ok(checked > 500, `${checked} rim samples`);
  assert.ok(L.LAWN_BASE - L.WATER_LEVEL <= 200, 'moat water visible from the lawn');
});

test('no water is reported over dry ground, and the region split matches the mesh', () => {
  const P = L.PERIMETER;
  for (let x = P.minX + 10; x < P.maxX; x += 20) {
    for (let z = P.minZ + 10; z < P.maxZ; z += 20) {
      if (!inside(x, z)) continue;
      const floor = world.findFloor(x, HIGH, z).y;
      if (L.waterLevelAt(x, z) !== L.WATER_LEVEL) continue;
      assert.ok(L.groundHeight(x, z) < L.WATER_LEVEL, `dry water at ${x},${z}`);
      if (edgeDistance(x, z) > 30) assert.ok(floor < L.WATER_LEVEL + 12, `floor ${floor} under water at ${x},${z}`);
    }
  }
  // Where the pond meets the moat's west wall, groundHeight agrees with the collision floor.
  for (let z = -3200; z <= -600; z += 10) {
    for (let x = -4460; x <= -4200; x += 10) {
      if (edgeDistance(x, z) < 20) continue;
      const f = world.findFloor(x, HIGH, z).y;
      assert.ok(Math.abs(f - L.groundHeight(x, z)) < 40, `cusp ${x},${z}: floor ${f.toFixed(0)} vs ${L.groundHeight(x, z).toFixed(0)}`);
    }
  }
});

test('there is a floor under every point inside the perimeter', () => {
  const P = L.PERIMETER;
  for (let x = P.minX + 25; x < P.maxX; x += 50) {
    for (let z = P.minZ + 25; z < P.maxZ; z += 50) {
      if (!inside(x, z)) continue;
      assert.ok(world.findFloor(x, HIGH, z).surface, `hole at ${x},${z}`);
    }
  }
});

test('walls face the low side and push the hero out of them', () => {
  const r = 50;
  const cases = [
    { name: 'moat outer wall (front)', x: 2000, y: -700, z: L.MOAT.maxZ - 30, dz: -1 },
    { name: 'island wall (front)', x: 2000, y: -700, z: L.ISLAND.maxZ + 30, dz: 1 },
    { name: 'south cliff', x: 0, y: 1500, z: L.PERIMETER.maxZ - 30, dz: -1 },
    { name: 'rear cliff above the island', x: 0, y: 1500, z: L.PERIMETER.minZ + 30, dz: 1 },
    { name: 'west cliff above the pond', x: L.PERIMETER.minX + 30, y: -700, z: L.POND.z, dx: 1 },
  ];
  for (const c of cases) {
    const res = world.findWalls(c.x, c.y, c.z, 0, r);
    assert.ok(res.walls.length > 0, `${c.name}: touching a wall`);
    if (c.dz) assert.ok(Math.sign(res.z - c.z) === c.dz && Math.abs(res.z - c.z) > 10, `${c.name}: pushed along z ${res.z - c.z}`);
    if (c.dx) assert.ok(Math.sign(res.x - c.x) === c.dx && Math.abs(res.x - c.x) > 10, `${c.name}: pushed along x ${res.x - c.x}`);
  }
});

test('a swimmer can reach the pond shelf from the moat and walk out', () => {
  // Continuous water (no land bridge) from the deep moat's west arm into the pond.
  assert.ok(world.findFloor(-3850, HIGH, L.POND.z).y < L.WATER_LEVEL - 400, 'moat is deep');
  for (let x = -3850; x >= L.POND.x; x -= 20) {
    const z = L.POND.z;
    assert.equal(L.waterLevelAt(x, z), L.WATER_LEVEL, `water at ${x}`);
    assert.ok(world.findFloor(x, HIGH, z).y < L.WATER_LEVEL - 60, `submerged floor at ${x}`);
  }
  // Then north across the pond's bank: from wading depth up through the waterline the floor
  // rises on a walkable slope (< 30 degrees) and reaches the lawn with no wall in the way.
  let prev = null;
  let crossed = false;
  for (let z = L.POND.z; z >= L.POND.z - L.POND.radius - 300; z -= 20) {
    const y = world.findFloor(L.POND.x, HIGH, z).y;
    if (prev !== null && prev > L.WATER_LEVEL - 100) {
      assert.ok((y - prev) / 20 < Math.tan(Math.PI / 6), `slope at z=${z}: ${(y - prev) / 20}`);
    }
    if (prev !== null && prev < L.WATER_LEVEL && y >= L.WATER_LEVEL) crossed = true;
    prev = y;
  }
  assert.ok(crossed, 'the bank rises above the water');
  assert.equal(world.findWalls(L.POND.x, L.WATER_LEVEL + 40, L.POND.z - 1000, 0, 50).walls.length, 0, 'no wall on the shelf');
});

test('dry banks and beaches are walkable (no steep sliver floors above the water)', () => {
  const limit = Math.cos((38 * Math.PI) / 180);
  for (const s of world.surfaces) {
    if (s.kind !== 'floor') continue;
    const cx = (s.a[0] + s.b[0] + s.c[0]) / 3;
    const cy = (s.a[1] + s.b[1] + s.c[1]) / 3;
    const cz = (s.a[2] + s.b[2] + s.c[2]) / 3;
    if (L.regionAt(cx, cz) !== 'water' || cy < L.WATER_LEVEL) continue;
    assert.ok(s.normal.y > limit, `steep dry floor (${((Math.acos(s.normal.y) * 180) / Math.PI).toFixed(1)} deg) at ${cx.toFixed(0)},${cy.toFixed(0)},${cz.toFixed(0)}`);
  }
});

test('the drawn cliff face stays close to its collider within the hero\'s reach', () => {
  // Horizontal rays from inside the lawn toward the perimeter, at heights the hero can reach
  // from the foot of the cliff: the rendered rock is at most a few units behind the wall.
  const cliffs = part.object3D.getObjectByName('cliffs');
  const P = L.PERIMETER;
  const cx = (P.minX + P.maxX) / 2;
  const cz = (P.minZ + P.maxZ) / 2;
  const ray = new THREE.Raycaster();
  let checked = 0;
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let lo = 0;
    let hi = 20000;
    while (hi - lo > 0.5) {
      const m = (lo + hi) / 2;
      if (L.sdRoundRect(cx + dx * m, cz + dz * m, P) < 0) lo = m;
      else hi = m;
    }
    const sx = cx + dx * (lo - 300);
    const sz = cz + dz * (lo - 300);
    if (L.regionAt(sx, sz) !== 'lawn') continue;
    const foot = world.findFloor(cx + dx * (lo - 5), HIGH, cz + dz * (lo - 5)).y;
    for (const dh of [100, 300, 500, 650]) {
      const origin = { x: sx, y: foot + dh, z: sz };
      const wall = world.raycast(origin, { x: dx, y: 0, z: dz }, 1000, { floors: false, ceilings: false });
      ray.set(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(dx, 0, dz));
      const drawn = ray.intersectObject(cliffs, false)[0];
      assert.ok(wall && drawn, `cliff at angle ${k}`);
      const gap = drawn.distance - wall.distance;
      assert.ok(gap > -1 && gap < 20, `rock drawn ${gap.toFixed(0)} behind the collider at ${origin.x.toFixed(0)},${origin.y.toFixed(0)},${origin.z.toFixed(0)}`);
      checked++;
    }
  }
  assert.ok(checked > 300, `${checked} samples`);
});

test('terrain part has a scene graph and an animating water surface', () => {
  const names = [];
  part.object3D.traverse((o) => o.isMesh && names.push(o.name));
  for (const n of ['grass', 'paths', 'courtyard', 'bed', 'cliffs', 'masonry', 'water', 'waterGlint']) assert.ok(names.includes(n), n);
  assert.ok(names.length <= 10, `${names.length} draw calls`);
  part.update(12.5);
});
