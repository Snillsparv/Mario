// The world builders must be importable and runnable in node (no canvas) so collision can
// be unit tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';

test('level builds in node and has a floor at spawn', () => {
  const scene = new THREE.Scene();
  const level = buildLevel(scene);
  const f = level.collision.findFloor(level.spawn.x, level.spawn.y + 100, level.spawn.z);
  assert.ok(f.surface, 'floor under spawn');
  assert.ok(Math.abs(f.y - level.spawn.y) < 30, `floor ${f.y} vs spawn ${level.spawn.y}`);
});
