// The castle door steps against the hero physics on the real level: walking slowly off their
// sides where the porch meets the ramp, and walking from beside the entrance towers (which
// stand on the porch) to the door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';

test('walking slowly off the door steps near the landing: no shove along them, never left inside them', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  const C = level.layout.CASTLE;
  const X = C.x;
  const B = C.baseY;
  // The steps' extent from the colliders: landing height, side edge, top and foot of the ramp.
  const top = col.findFloor(X, B + 300, C.frontZ + 60).y;
  let hw = 0;
  while (hw < 1500 && col.findFloor(X + hw + 5, top + 10, C.frontZ + 60).y > top - 1) hw += 5;
  let zTop = C.frontZ + 60;
  while (col.findFloor(X, top + 10, zTop + 5).y > top - 0.5) zTop += 5;
  let zFoot = zTop;
  while (col.findFloor(X, top + 10, zFoot + 5).y > B + 0.5) zFoot += 5;
  assert.ok(Math.abs(top - (B + 140)) < 1 && hw > 300 && zFoot > zTop + 150, 'found the steps');

  const p = new Player({ collision: col, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  const bad = [];
  let walkOffs = 0;
  for (const side of [-1, 1]) {
    for (let z = zTop - 60; z <= zTop + 100; z += 10) {
      const y0 = col.findFloor(X, top + 10, z).y;
      let edge = X;
      while (Math.abs(edge - X) < 1500 && col.findFloor(edge + side * 10, y0 + 50, z).y > y0 - 60) edge += side * 10;
      for (const turn of [0, 0.4, -0.4, 0.8, -0.8]) {
        for (const stick of [0.15, 0.25, 0.35]) {
          const yaw = side * (Math.PI / 2) + turn;
          const x = edge - side * 50;
          p.teleport(x, col.findFloor(x, top + 10, z).y, z, yaw);
          p.setAction('idle');
          const at = `side ${side} z ${z} turn ${turn} stick ${stick}`;
          let offZ = null;
          let landT = null;
          let pop = 0;
          let fv = 0;
          for (let t = 0; t < 120 && (landT === null || t < landT + 10); t++) {
            p.update(ctl.next({ stickX: -Math.sin(yaw) * stick, stickY: Math.cos(yaw) * stick }), 0);
            if (offZ === null && p.action === 'freefall') offZ = p.prevPos.z;
            const step = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
            pop = Math.max(pop, step - Math.max(fv, Math.abs(p.forwardVel)));
            fv = Math.abs(p.forwardVel);
            if (offZ === null || !p.grounded) continue;
            if (landT === null) {
              landT = t;
              // Walking straight off a side, the drop may slide him clear of the steps (and of
              // a tower's base) but not carry him along them.
              const carried = p.pos.z - offZ;
              if (turn === 0 && Math.abs(carried) > 30) bad.push(`${at}: carried ${carried.toFixed(0)} along the steps`);
            }
            // Standing on the ground beside a side at least 40 high: his body must be clear of it.
            const overlap = hw + 50 - Math.abs(p.pos.x - X);
            if (p.pos.y < B + 5 && p.pos.z < zFoot - 70 && overlap > 3) {
              bad.push(`${at}: stands ${overlap.toFixed(0)} inside the steps at (${p.pos.x.toFixed(0)}, ${p.pos.z.toFixed(0)})`);
              break;
            }
          }
          if (offZ === null) continue;
          walkOffs++;
          if (pop > 15) bad.push(`${at}: shoved ${pop.toFixed(1)} beyond his speed in one tick`);
        }
      }
    }
  }
  assert.ok(walkOffs > 60, `${walkOffs} walk-offs`);
  assert.deepEqual(bad, []);
});

test('the porch runs level from the door past the entrance towers: no crack, and walking from beside a tower to the door never drops or shoves', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  const C = level.layout.CASTLE;
  const X = C.x;
  const F = C.frontZ;
  const B = C.baseY;
  const top = col.findFloor(X, B + 300, F + 60).y;
  assert.ok(Math.abs(top - (B + 140)) < 1, `porch on the base course (${top})`);
  // The porch's extent, read at the door's centre line (depth) and along it (width).
  let zTop = F + 60;
  while (col.findFloor(X, top + 10, zTop + 5).y > top - 0.5) zTop += 5;
  let hw = 0;
  while (hw < 2500 && col.findFloor(X + hw + 5, top + 10, F + 60).y > top - 1) hw += 5;
  // The first wall met walking out from the door's centre line along the porch: a tower's.
  const wallAt = (side, z) => {
    const hit = col.raycast({ x: X, y: top + 100, z }, { x: side, y: 0, z: 0 }, 2500, { floors: false, ceilings: false });
    return hit ? hit.point.x : null;
  };
  // Level everywhere from the facade to its front, out to the towers (which stand on it, their
  // round plinths just above it) and on to its ends: nothing to fall into between the landing
  // and a tower's base.
  const holes = [];
  let towers = 0;
  for (let z = F + 5; z <= zTop - 5; z += 10) {
    for (const side of [-1, 1]) {
      const wx = wallAt(side, z);
      const tower = wx !== null && Math.abs(wx - X) < 1500; // (not a corner tower far beyond)
      if (tower) towers++;
      const end = tower ? Math.max(hw, Math.abs(wx - X) - 1) : hw;
      for (let d = 0; d <= end - 5; d += 5) {
        const y = col.findFloor(X + side * d, top + 20, z).y;
        if (y < top - 0.5 || y > top + 10.5) holes.push(`${side * d},${z}: ${y.toFixed(0)}`);
      }
    }
  }
  assert.ok(towers > 20, `towers beside the porch (${towers})`);
  assert.deepEqual(holes.slice(0, 10), []);

  // Pip standing beside either tower (clear of its wall), walking toward the door: he stays on
  // the porch, and a slow walk moves him no more than a slow walk (plus a slide round the tower).
  const p = new Player({ collision: col, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  const bad = [];
  let runs = 0;
  for (const side of [-1, 1]) {
    for (let z = F + 60; z <= zTop - 60; z += 20) {
      const wx = wallAt(side, z);
      if (wx === null || Math.abs(wx - X) > 1500) continue;
      for (const back of [60, 120]) {
        const x = wx - side * back;
        const k = col.findWalls(x, top, z, 60, 50);
        if (Math.hypot(k.x - x, k.z - z) > 0.5) continue; // within the tower's reach (or the door's)
        for (const turn of [0, 0.3, -0.3]) {
          for (const stick of [0.2, 0.4, 1]) {
            const yaw = -side * (Math.PI / 2) + turn;
            p.teleport(x, top, z, yaw);
            p.setAction('idle');
            runs++;
            const at = `side ${side} from (${x.toFixed(0)}, ${z}) turn ${turn} stick ${stick}`;
            let move = 0;
            let pop = 0;
            let fv = 0;
            for (let t = 0; t < 40 && Math.abs(p.pos.x - X) > 150; t++) {
              p.update(ctl.next({ stickX: -Math.sin(yaw) * stick, stickY: Math.cos(yaw) * stick }), 0);
              const step = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
              move = Math.max(move, step);
              pop = Math.max(pop, step - Math.max(fv, Math.abs(p.forwardVel)));
              fv = Math.abs(p.forwardVel);
              if (!p.grounded || (p.pos.z < zTop - 50 && Math.abs(p.pos.y - top) > 0.5)) {
                bad.push(`${at}: left the porch at (${p.pos.x.toFixed(0)}, ${p.pos.y.toFixed(0)}, ${p.pos.z.toFixed(0)}) ${p.action}`);
                break;
              }
            }
            if (stick < 1 && move > 13) bad.push(`${at}: moved ${move.toFixed(1)} in one tick`);
            if (pop > 10) bad.push(`${at}: shoved ${pop.toFixed(1)} beyond his speed`);
          }
        }
      }
    }
  }
  assert.ok(runs > 100, `${runs} runs`);
  assert.deepEqual(bad, []);
});
