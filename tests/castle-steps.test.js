// The castle door steps against the hero physics on the real level: walking slowly off their
// sides where the landing meets the ramp, beside the entrance towers' bases.
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
