import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
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
