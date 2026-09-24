// The real Player against the composed level's collision between neighbouring solid lumps
// (bushes, boulders): where two stand close together, running or jumping into the space
// between them from any direction never leaves the hero wedged inside their colliders.
// (Playtest: two bushes 284 apart left a 30..50-unit slot between their colliders; Pip,
// 100 across, jumped into it from the north-east and stuck there, pushed back and forth by
// both walls, 75 units deep. Close lumps now share one convex collider: decor.js SLOT_MIN.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { BUSHES, ROCKS, SLOT_MIN, slotClumps } from '../src/world/props/decor.js';

const RADIUS = 50;

test('close bushes share one collider; stepping stones and lone lumps keep their own', () => {
  const lumps = BUSHES.map((b) => ({ x: b.x, z: b.z, radius: b.r * 0.8 }));
  const clumps = slotClumps(lumps);
  const pair = [0, 1]; // the clump at -4200,1900
  assert.ok(clumps.some((c) => pair.every((i) => c.includes(i))), 'the bush pair at -4200,1900 is one clump');
  assert.equal(clumps.flat().length, BUSHES.length);
  // Any two lumps in different clumps leave room for the hero between their colliders.
  for (const c of clumps) {
    for (const d of clumps) {
      if (c === d) continue;
      for (const i of c) for (const j of d) {
        const [a, b] = [lumps[i], lumps[j]];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius >= SLOT_MIN);
      }
    }
  }
  assert.ok(SLOT_MIN > 2 * RADIUS);
});

test('running or jumping between neighbouring bushes and boulders never wedges the hero', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  const L = level.layout;
  const player = new Player({ collision: col, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  const solid = [...BUSHES, ...ROCKS.filter((r) => r.h > 60)];
  const pairs = [];
  solid.forEach((a, i) => {
    for (const b of solid.slice(i + 1)) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d - a.r - b.r < 2 * RADIUS + 150) pairs.push([a, b, d]);
    }
  });
  assert.ok(pairs.length >= 1, 'the bush pair at -4200,1900 is checked');
  const wedged = [];
  let runs = 0;
  for (const [a, b, d] of pairs) {
    // Aim at points across the space between them, from 16 directions, running and jumping.
    const ux = (b.x - a.x) / d;
    const uz = (b.z - a.z) / d;
    const along = (a.r + d - b.r) / 2;
    for (const across of [-80, 0, 80]) {
      const tx = a.x + ux * along - uz * across;
      const tz = a.z + uz * along + ux * across;
      for (let k = 0; k < 16; k++) {
        const yaw = (k / 16) * Math.PI * 2;
        const x = tx - Math.sin(yaw) * 380;
        const z = tz - Math.cos(yaw) * 380;
        if (L.regionAt(x, z) !== 'lawn') continue;
        for (const jump of [false, true]) {
          player.teleport(x, col.findFloor(x, 1e5, z).y, z, yaw);
          player.setAction('idle');
          runs++;
          let deep = 0;
          let worst = 0;
          let stuckEnd = true; // pushed > 10 on each of the last 6 ticks
          for (let t = 0; t < 48; t++) {
            player.update(ctl.next({ stickY: 1, A: jump && t === 6 }), yaw);
            const { x: px, y: py, z: pz } = player.pos;
            const w = col.findWalls(px, py, pz, 60, RADIUS);
            const push = Math.hypot(w.x - px, w.z - pz);
            worst = Math.max(worst, push);
            if (push > 10) deep++;
            if (t >= 42 && push <= 10) stuckEnd = false;
          }
          // Stuck (pushed on every one of the last ticks, or for many), not brushing past a
          // convex corner (a tick or three while sliding along or bumping off it).
          if (deep >= 10 || stuckEnd) wedged.push(`${a.x},${a.z} / ${b.x},${b.z} across ${across} yaw ${k * 22.5} jump ${jump}: pushed up to ${worst.toFixed(0)}`);
        }
      }
    }
  }
  assert.ok(runs >= 60, `only ${runs} run-ups`);
  assert.deepEqual(wedged.slice(0, 10), []);
});
