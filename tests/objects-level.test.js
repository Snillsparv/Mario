// Objects in the real level (built in node): draw order against the terrain decals and water,
// butterflies kept out of the castle, and the hidden 1-up placed in the open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';

const scene = new THREE.Scene();
const level = buildLevel(scene);
const collision = level.collision;

function makeObjects() {
  const events = new Events();
  const log = [];
  events.on('oneUp', (e) => log.push(e));
  const player = { pos: { x: 0, y: 0, z: 9000 }, collectCoin() {}, collectStar() {} };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: level.layout, player });
  return { objects, player, log };
}

// Inside a closed loop of walls: horizontal rays in all four directions hit a wall's back.
function insideWalls(p) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => {
    const hit = collision.raycast(p, { x: dx, y: 0, z: dz }, 4000, { floors: false, ceilings: false });
    return hit && hit.normal.x * dx + hit.normal.z * dz > 0;
  });
}

test('blob shadows draw after the path decal and before the water', () => {
  const { objects } = makeObjects();
  const order = {};
  scene.traverse((o) => {
    if (o.isMesh && (o.name === 'paths' || o.name === 'water')) order[o.name] = o.renderOrder;
  });
  assert.ok('paths' in order && 'water' in order, 'terrain has paths and water meshes');
  const shadows = objects.shadows.mesh.renderOrder;
  assert.ok(shadows > order.paths, `shadows ${shadows} after paths ${order.paths}`);
  assert.ok(shadows < order.water, `shadows ${shadows} before water ${order.water}`);
});

test('butterflies stay out of the castle, even when chased', () => {
  const { objects, player } = makeObjects();
  const list = objects.butterflies.list;
  assert.ok(list.every((b) => !insideWalls(b.pos)), 'no butterfly starts inside a building');
  let inside = 0;
  let touching = 0;
  for (let t = 0; t < 4000; t++) {
    // The hero runs at each butterfly in turn.
    const b = list[Math.floor(t / 400) % list.length];
    const p = player.pos;
    const dx = b.pos.x - p.x;
    const dz = b.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (t % 400 === 0 || d > 3000) {
      p.x = b.pos.x + 300;
      p.z = b.pos.z + 300;
    } else if (d > 1) {
      p.x += (dx / d) * 25;
      p.z += (dz / d) * 25;
    }
    p.y = collision.findFloor(p.x, 1e5, p.z).y;
    objects.update({ player });
    if (t % 5) continue;
    for (const bf of list) {
      if (insideWalls(bf.pos)) inside++;
      if (collision.findWalls(bf.pos.x, bf.pos.y, bf.pos.z, 0, 20).walls.length) touching++;
    }
  }
  assert.equal(inside, 0, 'samples inside a building');
  assert.equal(touching, 0, 'samples clipping into a wall');
});

test('the hidden 1-up hovers in the open behind the castle and can be picked up', () => {
  const { objects, player, log } = makeObjects();
  const gem = objects.oneUp.pos;
  const { CASTLE } = level.layout;
  assert.ok(gem.z < CASTLE.backZ, 'behind the castle');
  const floor = collision.findFloor(gem.x, gem.y, gem.z);
  assert.ok(floor.surface && gem.y - floor.y > 50 && gem.y - floor.y < 150, 'hovers just over the floor');
  assert.ok(collision.findFloor(gem.x, 1e5, gem.z).y < gem.y, 'nothing built above it');
  player.pos = { x: gem.x + 60, y: floor.y, z: gem.z };
  objects.update({ player });
  assert.equal(log.length, 1);
});
