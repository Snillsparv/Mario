// Drawbridge against the real level and the real hero: a swimmer floating at the surface can
// paddle under the bridge in every direction (the timbers under the deck stop above his head).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { SURFACE_FLOAT_DEPTH } from '../src/player/physics/tuning.js';

const level = buildLevel(new THREE.Scene());
const L = level.layout;
const BR = L.BRIDGE;
const hw = BR.width / 2;
const floatY = L.WATER_LEVEL - SURFACE_FLOAT_DEPTH;

// Paddles from (x, z) along `yaw` until past `done(pos)` or out of time; returns the trace.
function paddle(x, z, yaw, done) {
  const p = new Player({ collision: level.collision, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  p.teleport(x, floatY, z, yaw);
  p.setAction('water_surface');
  let lowest = p.pos.y;
  const actions = new Set();
  for (let t = 0; t < 300 && !done(p.pos); t++) {
    p.update(ctl.next({ stickY: 1 }), yaw);
    lowest = Math.min(lowest, p.pos.y);
    actions.add(p.action);
  }
  return { p, lowest, actions: [...actions].join(',') };
}

test('a surface swimmer paddles across under the bridge at every distance from the banks', () => {
  // Across the moat channel (east <-> west), between and beside the trestles, including the
  // strip by the lawn-side abutment that used to be sealed off by low stringers.
  for (const z of [400, 700, 960, 1000]) {
    for (const s of [-1, 1]) {
      const r = paddle(BR.x + s * (hw + 400), z, s > 0 ? -Math.PI / 2 : Math.PI / 2, (pos) => (pos.x - BR.x) * s < -(hw + 150));
      const where = `z ${z} from ${s > 0 ? 'east' : 'west'}`;
      assert.ok((r.p.pos.x - BR.x) * s < -(hw + 150), `${where}: crossed (stopped at x ${r.p.pos.x.toFixed(0)})`);
      assert.ok(r.lowest > floatY - 1, `${where}: never pushed under (lowest ${r.lowest.toFixed(0)})`);
      assert.equal(r.actions, 'water_surface', `${where}: stayed at the surface`);
    }
  }
});

test('a surface swimmer paddles the length of the bridge between and beside the posts', () => {
  const zN = L.ISLAND.maxZ + 90 + 60; // off the abutment faces
  const zS = L.MOAT.maxZ - 90 - 60;
  for (const dx of [0, -120, 120, -hw + 30, hw - 30]) {
    for (const [z0, yaw, done] of [
      [zS, Math.PI, (pos) => pos.z < zN],
      [zN, 0, (pos) => pos.z > zS],
    ]) {
      const r = paddle(BR.x + dx, z0, yaw, done);
      const where = `x ${dx} from z ${z0}`;
      assert.ok(done(r.p.pos), `${where}: got through (stopped at z ${r.p.pos.z.toFixed(0)})`);
      assert.ok(r.lowest > floatY - 1, `${where}: never pushed under (lowest ${r.lowest.toFixed(0)})`);
    }
  }
});
