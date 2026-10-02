// Midsummer Skerries' critters played on the real course (world/area.js buildArea at its origin)
// with the real Player and the course's own ObjectManager: frog_north, the first one met (walked
// to from the jetty's foot), notices him, and standing still he takes one wedge and lands on
// the meadow; walked off past its circle, it hops home; back again, it winds up, and a jump at
// it as it takes off lands on it: it throws him high (bounce(72), far higher than a plain
// stomp), pops, and its wreath turns into a coin that heals him back to full. A life lost by
// frog_west: after he drops in again every frog left is calm at home, and one he defeated
// stays gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as sk from '../src/world/skerries/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { CRITTER } from '../src/objects/Critters.js';
import { Events } from '../src/core/events.js';

const O = AREA_DEFS.skerries.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.skerries);
const col = area.collision;
const spot = (id) => sk.CRITTERS.find((c) => c.id === id);

// Jonas at a local point with the course's objects (as tests/skerries-routes.test.js): tick(input,
// camYaw) runs one of main's ticks; `toward(x, z)` the camera yaw that has the stick's up push
// him at a local point.
function hero(x, y, z, yaw) {
  const events = new Events();
  const sfx = [];
  events.on('sfx', (e) => sfx.push(e.name));
  const p = new Player({ collision: col, events, spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'skerries' });
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const tick = (input, camYaw) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
  };
  const toward = (x1, z1) => {
    const q = at();
    return Math.atan2(x1 - q.x, z1 - q.z);
  };
  const frog = (id) => om.critters.byId(id);
  return { p, om, sfx, at, tick, toward, frog };
}

const local = (c) => ({ x: c.x - O.x, y: c.y - O.y, z: c.z - O.z });

test('frog_north, the first one met: it notices him walking up from the jetty; standing still he takes one wedge and lands on the meadow; walked away, it goes home; a jump at it as it leaps lands on it and throws him high; it pops, and its coin heals him to full', () => {
  const S = spot('frog_north');
  const h = hero(-830, sk.JETTY.top, 2000, 0);
  const f = h.frog('frog_north');
  // Up from the jetty's foot toward it, until it notices him.
  let t = 0;
  for (; t < 300 && f.state === 'idle'; t++) h.tick({ stickY: 0.5 }, h.toward(local(f).x, local(f).z));
  assert.equal(f.state, 'notice', `noticed after ${t} ticks`);
  assert.ok(h.sfx.includes('frog_croak'));
  // He stands still: one wedge, and he lands on the meadow.
  for (t = 0; t < 200 && h.p.health === 8; t++) h.tick({}, 0);
  assert.equal(h.p.health, 7, 'one wedge');
  assert.equal(h.om.critters.hits, 1);
  for (t = 0; t < 120 && !(h.p.grounded && h.p.action === 'idle'); t++) h.tick({}, 0);
  assert.ok(h.p.grounded && !h.p.inWater && Math.abs(h.at().y - sk.HOME.top) < 1, `landed on the meadow: ${JSON.stringify(h.at())} (${h.p.action})`);
  // Off past its circle (fight + 80): it lets him go and hops home.
  const out = S.fight + CRITTER.SHARED.OUT + 60;
  for (t = 0; t < 400 && Math.hypot(h.at().x - S.x, h.at().z - S.z) < out; t++) h.tick({ stickY: 1 }, h.toward(S.x - 2000, S.z - 2000));
  for (t = 0; t < 60 && f.state !== 'return'; t++) h.tick({}, 0);
  assert.equal(f.state, 'return', 'let go');
  for (t = 0; t < 600 && f.state !== 'idle'; t++) h.tick({}, 0);
  assert.equal(f.state, 'idle', 'home again');
  assert.ok(Math.hypot(f.x - f.hopX[0], f.z - f.hopZ[0]) < CRITTER.FROG.HOME_NEAR);
  // Back at it: it winds up; he waits for the leap and jumps at it.
  for (t = 0; t < 600 && f.state !== 'windup' && f.state !== 'leap'; t++) h.tick({ stickY: 0.5 }, h.toward(local(f).x, local(f).z));
  assert.equal(f.state, 'windup');
  for (t = 0; t < 60 && f.state !== 'leap'; t++) h.tick({}, 0);
  assert.equal(f.state, 'leap');
  const yaw = h.toward(local(f).x, local(f).z);
  let stomped = -1;
  let y0 = 0;
  let peak = -Infinity;
  for (t = 0; t < 80; t++) {
    h.tick({ stickY: 0.5, A: t < 17 }, yaw);
    if (stomped < 0 && f.state === 'squash') {
      stomped = t;
      y0 = h.p.pos.y;
    }
    if (stomped >= 0 && t <= stomped + 40) peak = Math.max(peak, h.p.pos.y);
  }
  assert.ok(stomped >= 0, `stomped it (${f.state})`);
  assert.equal(h.p.health, 7, 'not hurt');
  assert.ok(peak - y0 >= 650, `thrown up ${Math.round(peak - y0)}`);
  assert.ok(h.sfx.includes('frog_pop') && h.sfx.includes('stomp'));
  // Its coin, where it was: he walks over and it heals him.
  for (t = 0; t < 120 && f.state !== 'gone'; t++) h.tick({}, 0);
  assert.equal(f.state, 'gone');
  const coin = h.om.coins.drops.find((c) => c.alive);
  assert.ok(coin && Math.abs(coin.x - f.dropX) < 1e-6 && Math.abs(coin.z - f.dropZ) < 1e-6, 'its coin');
  for (t = 0; t < 300 && coin.alive; t++) h.tick({ stickY: 0.6 }, h.toward(coin.x - O.x, coin.z - O.z));
  assert.equal(coin.alive, false, 'picked up');
  assert.equal(h.p.health, 8, 'healed to full');
});

test('a life lost by frog_west: dropped in again, every frog left is calm at home; one he defeated stays gone', () => {
  const N = spot('frog_north');
  const W = spot('frog_west');
  const h = hero(N.x, N.y, N.z + 300, Math.PI);
  const north = h.frog('frog_north');
  const west = h.frog('frog_west');
  // Punch frog_north (beside it, facing it).
  const q = local(north);
  h.p.teleport(q.x + O.x, q.y + O.y, q.z + 90 + O.z, Math.PI);
  h.p.setAction('idle');
  for (let t = 0; t < 12; t++) h.tick({ B: t === 1 }, 0);
  assert.equal(north.state, 'tumble', 'punched over');
  for (let t = 0; t < 60; t++) h.tick({}, 0);
  assert.equal(north.state, 'gone');
  // To frog_west: it comes after him.
  h.p.teleport(W.x + O.x, W.y + O.y, W.z - 350 + O.z, 0);
  h.p.setAction('idle');
  for (let t = 0; t < 40 && west.state === 'idle'; t++) h.tick({}, 0);
  assert.notEqual(west.state, 'idle', 'it noticed him');
  // He runs out of health; drops in again.
  h.p.loseHealth(8);
  let t = 0;
  for (; t < 300 && h.p.action !== 'spawn'; t++) h.tick({}, 0);
  assert.equal(h.p.action, 'spawn');
  h.tick({}, 0);
  assert.equal(west.state, 'idle', 'calm');
  assert.ok(Math.abs(west.x - west.hopX[0]) < 1e-6 && Math.abs(west.z - west.hopZ[0]) < 1e-6, 'at home');
  assert.equal(h.om.critters.engaged, 0);
  assert.equal(north.state, 'gone', 'the defeated one stays gone');
  assert.equal(h.om.critters.alive, sk.CRITTERS.length - 1);
});
