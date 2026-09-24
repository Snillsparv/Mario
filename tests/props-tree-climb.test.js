// The real Player climbing the real trees (composed level): a trunk grabbed from a running
// jump or a standing jump still leaves a real climb before the top of the pole, where his hat
// meets the canopy. (Review: with the canopy at 550 the pole tops were 320..375 above the
// ground; a running jump grabbed at feet +198 and left ~7 units to climb.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { treeShapes } from '../src/world/props/trees.js';
import * as layout from '../src/world/layout.js';

const level = buildLevel(new THREE.Scene());
const col = level.collision;
const TREES = treeShapes(layout);

// Runs at tree t from `dist` away along direction a (radians, from the trunk), jumping per
// jumpAt(tick, distance), then holds up on the stick. Returns { grab, top } (feet above the
// tree's ground) or null when the run-up is not clear or he never grabs the trunk.
function climb(p, ctl, t, a, dist, stick, jumpAt) {
  const x = t.x + Math.sin(a) * dist;
  const z = t.z + Math.cos(a) * dist;
  const floor = col.findFloor(x, t.ground + 400, z, 0);
  if (!floor.surface || floor.surface.normal.y < 0.9 || Math.abs(floor.y - t.ground) > 40) return null;
  const hit = col.raycast({ x, y: floor.y + 100, z }, { x: t.x - x, y: 0, z: t.z - z }, dist, { floors: false, ceilings: false });
  if (hit && hit.distance < dist - 100) return null;
  const yaw = Math.atan2(t.x - x, t.z - z);
  p.teleport(x, floor.y, z, yaw);
  p.setAction('idle');
  for (let s = 0; s < 3; s++) p.update(ctl.next({}), yaw);
  for (let tick = 0; tick < 90 && p.action !== 'pole'; tick++) {
    const d = Math.hypot(p.pos.x - t.x, p.pos.z - t.z);
    p.update(ctl.next({ stickY: stick, A: jumpAt(tick, d) }), yaw);
  }
  if (p.action !== 'pole') return null;
  const grab = p.pos.y - t.ground;
  let top = -Infinity;
  for (let s = 0; s < 200; s++) {
    p.update(ctl.next({ stickY: 1 }), yaw);
    top = Math.max(top, p.pos.y - t.ground);
  }
  return { grab, top };
}

test('a trunk grabbed from a running jump or a standing jump leaves a real climb', () => {
  const p = new Player({ collision: col, events: null, spawn: level.spawn, signs: [] });
  const ctl = new ScriptedController();
  const short = [];
  let runs = 0;
  let stands = 0;
  TREES.forEach((t, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      // Running jump from a 420 run-up, jumping 150..230 from the trunk.
      const run = climb(p, ctl, t, a, 420, 1, (tick, d) => d < 230 && d > 150);
      if (run) {
        runs++;
        if (run.top - run.grab < 100) short.push(`tree ${i} dir ${k} running: grab +${run.grab.toFixed(0)}, top +${run.top.toFixed(0)}`);
      }
      // Standing jump right by the trunk.
      const stand = climb(p, ctl, t, a, 110, 0.3, (tick) => tick === 0);
      if (stand) {
        stands++;
        if (stand.top - stand.grab < 200) short.push(`tree ${i} dir ${k} standing: grab +${stand.grab.toFixed(0)}, top +${stand.top.toFixed(0)}`);
      }
    }
  });
  assert.ok(runs >= TREES.length * 3 && stands >= TREES.length * 3, `${runs} running, ${stands} standing climbs`);
  assert.deepEqual(short, []);
});
