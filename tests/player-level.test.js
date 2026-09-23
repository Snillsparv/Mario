// Player physics against the real castle-grounds collision (built by the world modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';

test('running jumps at every tree grab its trunk from all directions', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  assert.ok(col.poles.length > 0, 'the level has climbable trees');
  const p = new Player({ collision: col, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  const misses = [];
  let tries = 0;
  for (const pole of col.poles) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI + 0.1;
      const x = pole.x + Math.sin(a) * 300;
      const z = pole.z + Math.cos(a) * 300;
      const floor = col.findFloor(x, pole.y0 + 400, z, 0);
      // Only clear run-ups on open, fairly level ground (nothing else in the way).
      if (!floor.surface || floor.surface.normal.y < 0.9 || Math.abs(floor.y - pole.y0) > 60) continue;
      const hit = col.raycast({ x, y: floor.y + 100, z }, { x: pole.x - x, y: 0, z: pole.z - z }, 300, { floors: false, ceilings: false });
      if (hit && hit.distance < 200) continue;
      tries++;
      const yaw = Math.atan2(pole.x - x, pole.z - z);
      p.teleport(x, floor.y, z, yaw);
      p.setAction('idle');
      const acts = [];
      for (let t = 0; t < 60 && p.action !== 'pole'; t++) {
        const d = Math.hypot(p.pos.x - pole.x, p.pos.z - pole.z);
        p.update(ctl.next({ stickY: 1, A: d < 230 && d > 150 }), yaw);
        if (acts.at(-1) !== p.action) acts.push(p.action);
      }
      if (p.action !== 'pole') misses.push(`(${pole.x}, ${pole.z}) dir ${k}: ${acts.join('>')}`);
    }
  }
  assert.ok(tries >= col.poles.length * 8, `only ${tries} clear run-ups`);
  assert.deepEqual(misses, []);
});
