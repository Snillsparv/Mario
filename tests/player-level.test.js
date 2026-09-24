// Player physics against the real castle-grounds collision (built by the world modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { Events } from '../src/core/events.js';

// Run-up length for the tree jumps: the run starts from rest and eases in (tiptoe -> walk ->
// run), so the jump window below is reached at a running speed of ~14-15.
const TREE_RUN_UP = 420;

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
      const x = pole.x + Math.sin(a) * TREE_RUN_UP;
      const z = pole.z + Math.cos(a) * TREE_RUN_UP;
      const floor = col.findFloor(x, pole.y0 + 400, z, 0);
      // Only clear run-ups on open, fairly level ground (nothing else in the way).
      if (!floor.surface || floor.surface.normal.y < 0.9 || Math.abs(floor.y - pole.y0) > 60) continue;
      const hit = col.raycast({ x, y: floor.y + 100, z }, { x: pole.x - x, y: 0, z: pole.z - z }, TREE_RUN_UP, { floors: false, ceilings: false });
      if (hit && hit.distance < TREE_RUN_UP - 100) continue;
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

let level = null;
const getLevel = () => (level ??= buildLevel(new THREE.Scene()));

// Climbing to the top of a tree ends in the handstand on its tip (round 3); Z there lets go.
test('Z in the handstand on top of any tree drops Pip to the ground without re-grabbing that trunk or getting hurt', () => {
  const col = getLevel().collision;
  const events = new Events();
  const p = new Player({ collision: col, events, spawn: getLevel().spawn });
  const hurts = [];
  events.on('hurt', (e) => hurts.push(e));
  const ctl = new ScriptedController();
  const regrabs = [];
  let tries = 0;
  for (const pole of col.poles) {
    for (let k = 0; k < 8; k++) {
      const yaw = (k / 8) * 2 * Math.PI;
      p.teleport(pole.x - Math.sin(yaw) * 90, pole.y1 - 260, pole.z - Math.cos(yaw) * 90, yaw);
      p.setAction('pole', pole);
      for (let t = 0; t < 203; t++) p.update(ctl.next({ stickY: t < 3 ? 0 : 1 }), 0);
      if (p.action !== 'pole_top') continue;
      tries++;
      p.update(ctl.next({ Z: true }), 0);
      const acts = [];
      hurts.length = 0;
      for (let t = 0; t < 90 && !p.grounded; t++) {
        p.update(ctl.next({}), 0);
        if (acts.at(-1) !== p.action) acts.push(p.action);
      }
      if (acts.lastIndexOf('pole') > acts.indexOf('freefall') || !p.grounded || hurts.length) regrabs.push(`(${pole.x}, ${pole.z}) facing ${k}: ${acts.join('>')}`);
    }
  }
  assert.ok(tries >= col.poles.length * 6, `only ${tries} climbs`);
  assert.deepEqual(regrabs, []);
});

test('walking slowly off the sides of the castle door steps: no sideways pop, never inside them', () => {
  const { collision: col, layout } = getLevel();
  const X = layout.CASTLE.x;
  const top = col.findFloor(X, 1e4, layout.CASTLE.frontZ + 100).y; // the landing in front of the door
  // The steps' ramp: where the floor at the door's centre line runs down from the landing.
  const ramp = [];
  for (let z = layout.CASTLE.frontZ; z < layout.CASTLE.frontZ + 800; z += 10) {
    const y = col.findFloor(X, 1e4, z).y;
    if (y < top - 20 && y > layout.CASTLE.baseY + 30) ramp.push(z);
  }
  assert.ok(ramp.length > 5, 'found the ramp');
  const p = new Player({ collision: col, events: null, spawn: getLevel().spawn });
  const ctl = new ScriptedController();
  const bad = [];
  let runs = 0;
  for (const side of [-1, 1]) {
    for (let z = layout.CASTLE.frontZ + 60; z <= ramp.at(-1) - 20; z += 30) {
      // The side edge at this z: walk out from the centre line until the floor drops away.
      let edge = X;
      const y0 = col.findFloor(X, 1e4, z).y;
      while (Math.abs(edge - X) < 1500 && col.findFloor(edge + side * 10, y0 + 50, z).y > y0 - 60) edge += side * 10;
      for (const turn of [0, 0.5, -0.5]) {
        for (const stick of [0.3, 0.5]) {
          const yaw = side * (Math.PI / 2) + turn;
          const x = edge - side * 60;
          p.teleport(x, col.findFloor(x, 1e4, z).y, z, yaw);
          p.setAction('idle');
          runs++;
          let pop = 0;
          let fv = 0;
          let offZ = null;
          for (let t = 0; t < 80; t++) {
            p.update(ctl.next({ stickX: -Math.sin(yaw) * stick, stickY: Math.cos(yaw) * stick }), 0);
            if (offZ === null && p.action === 'freefall') offZ = p.pos.z;
            const step = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
            pop = Math.max(pop, step - Math.max(fv, Math.abs(p.forwardVel)));
            fv = Math.abs(p.forwardVel);
            if (col.findFloor(p.pos.x, p.pos.y + 120, p.pos.z, 0).y > p.pos.y + 20) {
              bad.push(`side ${side} z ${z} turn ${turn} stick ${stick}: inside the steps at (${p.pos.x.toFixed(0)}, ${p.pos.y.toFixed(0)}, ${p.pos.z.toFixed(0)})`);
              break;
            }
          }
          // Off the ramp's sides (clear of its top end, whose corners the landing and the
          // towers' bases crowd) Pip slides clear while dropping, at most ~12 a tick.
          if (offZ !== null && offZ > ramp[0] + 50 && pop > 13) bad.push(`side ${side} z ${z} turn ${turn} stick ${stick}: popped ${pop.toFixed(0)}`);
        }
      }
    }
  }
  assert.ok(runs > 50, `${runs} runs`);
  assert.deepEqual(bad, []);
});

test('every sign in the level is read from in front of its face, never from behind', () => {
  const { collision: col, layout, spawn } = getLevel();
  const events = new Events();
  const reads = [];
  events.on('signRead', (e) => reads.push(e.sign.id));
  const p = new Player({ collision: col, events, spawn });
  const ctl = new ScriptedController();
  const problems = [];
  for (const s of layout.SIGNS) {
    for (const [side, off] of [['front', 0], ['front-left', 0.6], ['front-right', -0.6], ['behind', Math.PI]]) {
      const a = s.yaw + off;
      const x = s.x + Math.sin(a) * 400;
      const z = s.z + Math.cos(a) * 400;
      const yaw = Math.atan2(s.x - x, s.z - z);
      p.teleport(x, col.findFloor(x, 5000, z).y, z, yaw);
      p.setAction('idle');
      // Walk up to the board (the signpost's collider stops him), then press B.
      for (let t = 0; t < 90 && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > 95; t++) p.update(ctl.next({ stickY: 1 }), yaw);
      p.update(ctl.next({}), yaw);
      reads.length = 0;
      p.update(ctl.next({ B: true }), yaw);
      const want = side === 'behind' ? 'punch' : 'reading';
      if (p.action !== want || reads.length !== (side === 'behind' ? 0 : 1)) problems.push(`${s.id} ${side}: ${p.action}`);
      if (p.action === 'reading') p.endReading();
    }
  }
  assert.deepEqual(problems, []);
});
