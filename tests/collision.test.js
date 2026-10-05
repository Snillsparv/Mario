import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, moveSurfaces, restOf } from '../src/collision/CollisionWorld.js';
import { FLOOR_LOWER_LIMIT, CEIL_NONE } from '../src/core/constants.js';

// Quad helper: two CCW triangles (viewed from the side the normal points to).
function quad(a, b, c, d) {
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

function makeRoom() {
  const w = new CollisionWorld();
  // Floor at y=0 spanning -1000..1000, normal up (CCW seen from above: -Z is "up" on screen).
  w.addTriangles(quad([-1000, 0, 1000], [1000, 0, 1000], [1000, 0, -1000], [-1000, 0, -1000]));
  // Raised platform top at y=300 for x in [200, 600]
  w.addTriangles(quad([200, 300, 1000], [600, 300, 1000], [600, 300, -1000], [200, 300, -1000]));
  // Wall at x = 800 facing -X (toward the origin), from y=0 to 1000.
  w.addTriangles(quad([800, 0, -1000], [800, 0, 1000], [800, 1000, 1000], [800, 1000, -1000]));
  // Ceiling at y = 500 over x in [-600, -200], normal down.
  w.addTriangles(quad([-600, 500, -1000], [-200, 500, -1000], [-200, 500, 1000], [-600, 500, 1000]));
  w.finalize();
  return w;
}

test('floor classification and height', () => {
  const w = makeRoom();
  const f = w.findFloor(0, 50, 0);
  assert.equal(f.y, 0);
  assert.equal(f.surface.kind, 'floor');
  assert.ok(f.surface.normal.y > 0.99);
});

test('findFloor picks highest floor at or below y + tolerance', () => {
  const w = makeRoom();
  assert.equal(w.findFloor(400, 1000, 0).y, 300);
  assert.equal(w.findFloor(400, 250, 0).y, 300); // within 78 step tolerance
  assert.equal(w.findFloor(400, 100, 0).y, 0); // platform too high above
  assert.equal(w.findFloor(5000, 100, 5000).y, FLOOR_LOWER_LIMIT);
});

test('ceilings', () => {
  const w = makeRoom();
  assert.equal(w.findCeil(-400, 100, 0).y, 500);
  assert.equal(w.findCeil(0, 100, 0).y, CEIL_NONE);
});

test('walls push the point out to radius', () => {
  const w = makeRoom();
  const r = w.findWalls(780, 0, 0, 60, 50);
  assert.equal(r.walls.length, 1);
  assert.ok(Math.abs(r.x - 750) < 1e-6, `x=${r.x}`);
  const free = w.findWalls(600, 0, 0, 60, 50);
  assert.equal(free.walls.length, 0);
  // Above the wall top: no push.
  assert.equal(w.findWalls(780, 1100, 0, 60, 50).walls.length, 0);
});

test('raycast hits nearest surface', () => {
  const w = makeRoom();
  const hit = w.raycast({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, 2000);
  assert.ok(hit);
  assert.ok(Math.abs(hit.distance - 800) < 1e-6, `d=${hit.distance}`); // platform has no side faces -> wall at 800
  assert.ok(hit.normal.x < -0.99);
});

test('raycast crosses grid cells and respects maxDist', () => {
  const w = new CollisionWorld();
  // Floor far away diagonally: spans x,z in [2500, 3500].
  w.addTriangles(quad([2500, 0, 3500], [3500, 0, 3500], [3500, 0, 2500], [2500, 0, 2500]));
  w.finalize();
  const hit = w.raycast({ x: 0, y: 3000, z: 0 }, { x: 1, y: -1, z: 1 }, 10000);
  assert.ok(hit, 'hit through several cells');
  assert.ok(Math.abs(hit.point.y) < 1e-6 && Math.abs(hit.point.x - 3000) < 1e-6);
  assert.equal(w.raycast({ x: 0, y: 3000, z: 0 }, { x: 1, y: -1, z: 1 }, 1000), null);
  // Straight down, and repeated rays still find the same surface (stamps reset per ray).
  for (let i = 0; i < 3; i++) assert.equal(w.raycast({ x: 3000, y: 500, z: 3000 }, { x: 0, y: -1, z: 0 }, 1000).distance, 500);
});

test('diagonal walls use their true extent along the face', () => {
  const w = new CollisionWorld();
  // A 45-degree wall from (0,0) to (1000,1000) in XZ, facing +x/-z, 0..500 tall.
  w.addTriangles(quad([0, 0, 0], [1000, 0, 1000], [1000, 500, 1000], [0, 500, 0]));
  w.finalize();
  const s = w.surfaces[0];
  const n = s.hn;
  // A point just in front of the wall near its far end must still be pushed out.
  const px = 950 + n.x * 20;
  const pz = 950 + n.z * 20;
  const r = w.findWalls(px, 0, pz, 60, 50);
  assert.equal(r.walls.length, 1);
  const off = (r.x - 950) * n.x + (r.z - 950) * n.z;
  assert.ok(Math.abs(off - 50) < 1e-6, `pushed to radius, off=${off}`);
  // Beyond the end of the face: no push.
  assert.equal(w.findWalls(1100 + n.x * 20, 0, 1100 + n.z * 20, 60, 50).walls.length, 0);
});

test('grid cells work on both sides of the origin and far out', () => {
  const w = new CollisionWorld();
  for (const [cx, cz] of [[-20500, -31000], [-500, 700], [31000, -20500], [45000, 45000]]) {
    w.addTriangles(quad([cx - 200, 10, cz + 200], [cx + 200, 10, cz + 200], [cx + 200, 10, cz - 200], [cx - 200, 10, cz - 200]));
  }
  w.finalize();
  for (const [cx, cz] of [[-20500, -31000], [-500, 700], [31000, -20500], [45000, 45000]]) {
    assert.equal(w.findFloor(cx + 50, 100, cz - 50).y, 10, `floor at ${cx},${cz}`);
    assert.equal(w.findFloor(cx + 1500, 100, cz).surface, null, `nothing beside ${cx},${cz}`);
  }
  // A ray crossing from a negative into a positive cell index finds the floor it points at.
  const hit = w.raycast({ x: -1200, y: 300, z: 700 }, { x: 700, y: -290, z: 0 }, 5000);
  assert.ok(hit && Math.abs(hit.point.y - 10) < 1e-6 && hit.surface.kind === 'floor');
});

test('findWalls without contact returns an empty, read-only walls list; contacts get their own', () => {
  const w = makeRoom();
  const free = w.findWalls(0, 0, 0, 50, 50);
  assert.deepEqual([free.x, free.z, free.walls.length], [0, 0, 0]);
  const a = w.findWalls(780, 0, 0, 50, 50);
  const b = w.findWalls(790, 0, 10, 50, 50);
  assert.equal(a.walls.length, 1);
  assert.notEqual(a.walls, b.walls, 'each contact result has its own array');
  assert.ok(Math.abs(a.x - 750) < 1e-6);
});

test('raycast filters by surface kind and allows repeated calls', () => {
  const w = makeRoom();
  const down = { x: 0, y: -1, z: 0 };
  const floor = w.raycast({ x: 400, y: 800, z: 0 }, down, 2000);
  assert.equal(floor.surface.kind, 'floor');
  assert.equal(w.raycast({ x: 400, y: 800, z: 0 }, down, 2000, { floors: false }), null);
  const wall = w.raycast({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, 2000, { floors: false, ceilings: false });
  assert.equal(wall.surface.kind, 'wall');
  assert.ok(Math.abs(wall.distance - 800) < 1e-6);
  const again = w.raycast({ x: 400, y: 800, z: 0 }, down, 2000);
  assert.equal(again.distance, floor.distance);
  assert.notEqual(again, floor, 'results are fresh objects callers may keep');
});

test('raycast rejects non-finite rays instead of looping', () => {
  const w = new CollisionWorld();
  w.addTriangles(quad([-100, 0, 100], [100, 0, 100], [100, 0, -100], [-100, 0, -100]));
  w.finalize();
  assert.equal(w.raycast({ x: NaN, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100), null);
  assert.equal(w.raycast({ x: 0, y: 10, z: 0 }, { x: NaN, y: -1, z: 0 }, 100), null);
  assert.equal(w.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, Infinity), null);
});

// A box collider (top and four walls, outward) round (x, z): half sizes hx, hz, from y0 to y1.
function box(x, z, hx, hz, y0, y1) {
  const [x0, x1, z0, z1] = [x - hx, x + hx, z - hz, z + hz];
  return [
    ...quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]),
    ...quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]),
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]),
  ];
}

test('moveSurfaces: each moved surface\'s fields equal a fresh one at the moved corners (normals and face axes kept); parking is the same call', () => {
  const w = makeRoom();
  const first = w.surfaces.length;
  w.addTriangles(box(0, 0, 55, 45, 0, 160));
  const list = w.surfaces.slice(first);
  const rest = restOf(list);
  for (const [dx, dy, dz] of [[310, 0, -120], [-40, 0, 700], [0, -60000, 0], [0, 0, 0]]) {
    moveSurfaces(list, rest, dx, dy, dz);
    const fresh = new CollisionWorld();
    fresh.addTriangles(box(dx, dz, 55, 45, dy, 160 + dy));
    fresh.surfaces.forEach((f, i) => {
      const s = list[i];
      for (const k of ['kind', 'minY', 'maxY', 'hscale']) assert.equal(s[k], f[k], `${k} at ${dx}, ${dy}, ${dz}`);
      for (const k of ['a', 'b', 'c', 'ys', 'pu']) if (f[k]) for (let j = 0; j < 3; j++) assert.ok(Math.abs(s[k][j] - f[k][j]) < 1e-9, k);
      assert.ok(Math.abs(s.d - f.d) < 1e-9, 'd');
      assert.deepEqual(s.normal, f.normal);
      if (f.hn) assert.deepEqual([s.hn, s.tx, s.tz], [f.hn, f.tx, f.tz]);
    });
  }
});

test('cover: a box covered over a range is found exactly wherever it is moved in it (floors, walls, rays: each surface once)', () => {
  const w = new CollisionWorld();
  w.addTriangles(quad([-3000, 0, 3000], [3000, 0, 3000], [3000, 0, -3000], [-3000, 0, -3000]));
  const first = w.surfaces.length;
  w.addTriangles(box(0, 0, 55, 45, 0, 160));
  const list = w.surfaces.slice(first);
  const rest = restOf(list);
  w.cover(list, -1600, 1600, -1600, 1600);
  w.cover(list, -1600, 1600, -1600, 1600); // (again: nothing added twice)
  w.finalize();
  for (const cell of w.cells.values()) for (const k of ['floor', 'ceil', 'wall']) assert.equal(new Set(cell[k]).size, cell[k].length, 'once a cell');
  for (const [x, z] of [[1400, -1300], [-900, 1500], [10, 10]]) {
    moveSurfaces(list, rest, x, 0, z);
    assert.equal(w.findFloor(x, 300, z).y, 160, `its top at ${x}, ${z}`);
    assert.equal(w.findFloor(x + 80, 300, z).y, 0, 'the floor beside it');
    const push = w.findWalls(x + 55 + 30, 50, z, 0, 50);
    assert.ok(Math.abs(push.x - (x + 55 + 50)) < 1e-9 && push.walls.length > 0 && push.walls.every((s) => list.includes(s)), 'its wall pushes');
    const hit = w.raycast({ x: x - 2500, y: 80, z }, { x: 1, y: 0, z: 0 }, 5000);
    assert.ok(hit && Math.abs(hit.point.x - (x - 55)) < 1e-6, `a ray finds it at ${x}, ${z}`);
  }
});
