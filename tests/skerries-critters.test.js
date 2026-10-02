// Midsummer Skerries' critters played on the real course (world/area.js buildArea at its origin)
// with the real Player and the course's own ObjectManager: frog_north, the first one met (walked
// to from the jetty's foot), notices him, and standing still he takes one wedge and lands on
// the meadow; walked off past its circle, it hops home; back again, it winds up, and a jump at
// it as it takes off lands on it: it throws him high (bounce(72), far higher than a plain
// stomp), pops, and its wreath turns into a coin that heals him back to full. A life lost by
// frog_west: after he drops in again every frog left is calm at home, and one he defeated
// stays gone. mosquito_south: standing still, the ring is under him from its aim's first tick
// and the needle hits him as it dives; stepping aside after the 'ting', it sticks in the turf
// by its target and a punch pops it; walking at it mashing B, it never costs a wedge; walked
// into as it hovers it is bumped aside, and a held jump from beside it stomps it. crab_bar: it
// stays in its tin while he swims round the sand bar, wakes when he stands up on the bar, falls
// to a ground pound landing beside it, and its coin floats over the water where he picks it up
// standing. crab_islet: pinched by the first terrace's outer rim, he is knocked back onto the
// terrace, not into the sea.
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
import { CRITTER_RIG, CRITTER_PARTS, MODEL, critterBase } from '../src/objects/critterModel.js';
import { Events } from '../src/core/events.js';
import { PLAYER_RADIUS } from '../src/core/constants.js';

const O = AREA_DEFS.skerries.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.skerries);
const col = area.collision;
const spot = (id) => sk.CRITTERS.find((c) => c.id === id);

// Jonas at a local point with the course's objects (as tests/skerries-routes.test.js): tick(input,
// camYaw) runs one of main's ticks; `toward(x, z)` the camera yaw that has the stick's up push
// him at a local point; critter(id) the course's critter record.
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
  const critter = (id) => om.critters.byId(id);
  return { p, om, sfx, at, tick, toward, critter };
}

const local = (c) => ({ x: c.x - O.x, y: c.y - O.y, z: c.z - O.z });

test('frog_north, the first one met: it notices him walking up from the jetty; standing still he takes one wedge and lands on the meadow; walked away, it goes home; a jump at it as it leaps lands on it and throws him high; it pops, and its coin heals him to full', () => {
  const S = spot('frog_north');
  const h = hero(-830, sk.JETTY.top, 2000, 0);
  const f = h.critter('frog_north');
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
  const north = h.critter('frog_north');
  const west = h.critter('frog_west');
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

test('mosquito_south: standing still, the ring sits under him from its aim\'s first tick and the needle hits him as it dives; stepping aside after the ting, it sticks in the turf by its target and a punch pops it; walking at it mashing B from where it parks, it never costs a wedge; walked into as it hovers it is bumped aside (never inside him), and a held jump from beside it stomps it', () => {
  const S = spot('mosquito_south');
  // Up to it from the north until it sees him, then (play) from the moment its aim starts.
  const meet = () => {
    const h = hero(S.x, sk.HOME.top, S.z - 700, 0);
    const m = h.critter('mosquito_south');
    let t = 0;
    for (; t < 300 && m.state === 'patrol'; t++) h.tick({ stickY: 0.5 }, h.toward(local(m).x, local(m).z));
    assert.equal(m.state, 'spot', `spotted after ${t} ticks`);
    assert.ok(h.sfx.includes('mosquito_whine'));
    for (t = 0; t < 200 && m.state !== 'aim'; t++) h.tick({}, 0);
    assert.equal(m.state, 'aim');
    const d = Math.hypot(m.x - h.p.pos.x, m.z - h.p.pos.z);
    assert.ok(Math.abs(d - CRITTER.MOSQUITO.STAND) <= 20, `aiming ${d.toFixed(0)} from him`);
    return { h, m, yaw: h.toward(local(m).x, local(m).z) };
  };
  {
    const { h, m } = meet();
    h.tick({}, 0);
    assert.ok(m.markOn === 1 && Math.hypot(m.tx - h.p.pos.x, m.tz - h.p.pos.z) < 1e-6, 'the ring under him from aim tick 1');
    let t = 0;
    for (; t < 60 && h.p.health === 8; t++) {
      assert.ok(m.markOn === 1 && (m.state === 'aim' || m.state === 'dive'), `the ring there at ${t} (${m.state})`);
      h.tick({}, 0);
    }
    assert.equal(h.p.health, 7, 'hit');
    assert.equal(m.state, 'recoil', 'as it dove');
    assert.equal(m.markOn, 0);
  }
  {
    const { h, m, yaw } = meet();
    let t = 0;
    for (; t < 80 && m.state !== 'stuck'; t++) h.tick(t >= 2 && t < 22 ? { stickX: 1 } : {}, yaw);
    assert.equal(m.state, 'stuck', 'stuck in the turf');
    assert.equal(h.p.health, 8);
    const tip = { ...h.om.critters._at(m, ...CRITTER_RIG.mosquito.NEEDLE_TIP) };
    assert.ok(Math.hypot(tip.x - m.tx, tip.z - m.tz) < 30, 'by its target');
    for (t = 0; t < 120 && m.state === 'stuck'; t++) h.tick({ stickY: 0.5, B: Math.hypot(m.x - h.p.pos.x, m.z - h.p.pos.z) < 130 && t % 5 === 0 }, h.toward(local(m).x, local(m).z));
    assert.equal(m.state, 'deflate', 'popped with a punch');
    assert.equal(h.p.health, 8);
  }
  {
    const { h, m } = meet();
    for (let t = 0; t < 160 && m.state !== 'deflate'; t++) {
      h.tick({ stickY: 0.6, B: t % 5 === 0 }, h.toward(local(m).x, local(m).z));
      assert.equal(h.p.health, 8, `never a wedge (${m.state} at ${t})`);
    }
    assert.equal(m.state, 'deflate', 'struck');
  }
  {
    // He walks in under it as it hovers: it is bumped aside as his head reaches it (never inside
    // him), and a held jump where he stands, beside it, comes down on it.
    const h = hero(S.x, sk.HOME.top, S.z - 700, 0);
    const m = h.critter('mosquito_south');
    const R = CRITTER_RIG.mosquito;
    const reach = PLAYER_RADIUS + R.BUMP_R;
    const d = () => Math.hypot(m.x - h.p.pos.x, m.z - h.p.pos.z);
    const inside = () => h.p.pos.y < m.y + R.TOP && h.p.pos.y + CRITTER.SHARED.HERO_HIGH > m.y - R.UNDER && d() < 0.8 * reach;
    for (let t = 0; t < 300 && d() > reach + 10; t++) h.tick({ stickY: 1 }, h.toward(local(m).x, local(m).z));
    let bumped = 0;
    for (let t = 0; t < 30; t++) {
      const x0 = m.x;
      const z0 = m.z;
      h.tick({ stickY: 0.3 }, h.toward(local(m).x, local(m).z));
      if (m.x !== x0 || m.z !== z0) bumped++;
      assert.ok(!inside(), `never inside him (${d().toFixed(0)} at ${t})`);
    }
    assert.ok(m.state === 'chase' && bumped > 5, `bumped aside as he walks into it, hovering (${m.state}, ${bumped})`);
    for (let t = 0; t < 40 && m.state !== 'splat'; t++) {
      h.tick({ A: t < 17 }, 0);
      assert.ok(m.state === 'splat' || !inside(), `never inside him as he jumps (${d().toFixed(0)} at ${t})`);
    }
    assert.equal(m.state, 'splat', 'stomped');
    assert.ok(h.sfx.includes('stomp') && h.sfx.includes('mosquito_pop'));
    assert.equal(h.p.health, 8);
  }
});

// The crab's tin (model rig space, from its geometry): its yellow band's lowest point and its
// top; how far a rig height of crab c stands over the water now (riding its lift, squashed and
// poofing with it).
const TIN = (() => {
  const b = critterBase();
  const yellow = new THREE.Color(0xf3c433).toArray();
  const out = { band: Infinity, top: -Infinity };
  for (let v = 0; v < b.position.count; v++) {
    if (b.aPart.array[v * 3 + 2] !== MODEL.CRAB || b.aPart.array[v * 3] !== CRITTER_PARTS.crab.TIN) continue;
    const y = b.position.array[v * 3 + 1];
    out.top = Math.max(out.top, y);
    if (Math.abs(b.color.array[v * 3] - yellow[0]) + Math.abs(b.color.array[v * 3 + 1] - yellow[1]) + Math.abs(b.color.array[v * 3 + 2] - yellow[2]) < 1e-5) out.band = Math.min(out.band, y);
  }
  return out;
})();
const overWater = (c, y) => c.y + (y + CRITTER_RIG.crab.LIFT_SPAN * (c.b1 - 1)) * c.scale * c.sq * c.vis - col.waterLevelAt(c.x, c.z);

test('crab_bar: hidden in its tin while he swims round the sand bar (its yellow band over the water, its eyes on him), it wakes as he stands up on the bar; a ground pound landing beside it knocks it over, and stomped it dents: either way its tin floats over the water as it goes, its coin floats over the water, and he picks it up standing on the bar', () => {
  const S = spot('crab_bar');
  const h = hero(S.x, -40, S.z - 560, 0);
  const c = h.critter('crab_bar');
  assert.ok(overWater(c, TIN.band) >= 0, `hidden, its yellow band ${overWater(c, TIN.band).toFixed(1)} over the water`);
  let wet = 0;
  let watched = 0;
  for (let t = 0; t < 600; t++) {
    const q = h.at();
    const d = Math.hypot(q.x - S.x, q.z - S.z);
    h.tick({ stickX: 0.6, stickY: d > 560 ? 0.3 : d < 500 ? -0.3 : 0 }, h.toward(S.x, S.z));
    if (h.p.inWater) wet++;
    assert.equal(c.state, 'hidden', `in its tin at ${t} (he is ${d.toFixed(0)} from it)`);
    const a = Math.atan2(q.x - S.x, q.z - S.z);
    if (t > 60 && c.b0 > 0.6 && Math.abs(Math.atan2(Math.sin(c.yaw - a), Math.cos(c.yaw - a))) < 0.4) watched++;
  }
  assert.ok(wet >= 590, `swimming round it (${wet} ticks)`);
  assert.ok(watched > 400, `its eyes out after him (${watched} ticks)`);
  let t = 0;
  for (; t < 300 && c.state === 'hidden'; t++) h.tick({ stickY: 0.6 }, h.toward(S.x, S.z));
  assert.equal(c.state, 'wake', 'it wakes');
  assert.ok(!h.p.inWater && Math.abs(h.at().y - S.y) < 1, `standing on the bar: ${JSON.stringify(h.at())}`);
  // A ground pound right there: up, Z in the air, down beside it.
  for (t = 0; t < 30; t++) h.tick({}, 0);
  for (t = 0; t < 60 && c.state !== 'tumble'; t++) h.tick(t < 2 ? { A: true } : t === 8 ? { Z: true } : {}, 0);
  assert.equal(c.state, 'tumble', `knocked over (${h.p.action})`);
  assert.equal(h.p.action, 'ground_pound_land');
  assert.equal(h.p.health, 8);
  for (t = 0; t < 60 && c.state !== 'gone'; t++) {
    h.tick({}, 0);
    if (c.state !== 'gone') assert.ok(overWater(c, TIN.top) >= 20, `its tin over the water (${c.state} ${c.t}: ${overWater(c, TIN.top).toFixed(1)})`);
  }
  const coin = h.om.coins.drops.find((k) => k.alive);
  assert.ok(coin && coin.y - O.y >= 40, `its coin over the water: ${coin && coin.y - O.y}`);
  for (t = 0; t < 300 && coin.alive; t++) {
    h.tick({ stickY: 0.5 }, h.toward(coin.x - O.x, coin.z - O.z));
    assert.ok(!h.p.inWater, 'standing on the bar');
  }
  assert.equal(coin.alive, false, 'picked up');
  // Back again (a new arrival): stomped where it stands, its dented tin rattles and poofs over
  // the water, never sinking out of sight.
  h.om.critters.reset();
  const k = h.critter('crab_bar');
  for (t = 0; t < 200 && k.state !== 'strafe'; t++) h.tick({ stickY: 0.4 }, h.toward(S.x, S.z));
  assert.equal(k.state, 'strafe', 'after him');
  const top = k.y + (CRITTER_RIG.crab.TOP + h.om.critters._rise(k)) * k.scale;
  h.p.teleport(k.x, top + 40, k.z, 0);
  h.p.setAction('freefall');
  for (t = 0; t < 20 && k.state !== 'dent'; t++) h.tick({}, 0);
  assert.equal(k.state, 'dent', 'stomped');
  for (t = 0; t < 40 && k.state !== 'gone'; t++) {
    if (k.state !== 'gone') assert.ok(overWater(k, TIN.top) >= 20, `its dented tin over the water (${k.state} ${k.t}: ${overWater(k, TIN.top).toFixed(1)})`);
    h.tick({}, 0);
  }
  assert.equal(k.state, 'gone');
});

test("crab_islet: pinched by the first terrace's outer rim (the crab on the inner side, his natural knockback off the edge into the sea), he is sent back onto the terrace", () => {
  const S = spot('crab_islet');
  const ux = (S.x - sk.ISLET.x) / Math.hypot(S.x - sk.ISLET.x, S.z - sk.ISLET.z);
  const uz = (S.z - sk.ISLET.z) / Math.hypot(S.x - sk.ISLET.x, S.z - sk.ISLET.z);
  const onT1 = (x, z) => {
    const f = col.findFloor(x + O.x, 1000 + O.y, z + O.z);
    return f.surface && Math.abs(f.y - O.y - S.y) <= 1;
  };
  // The rim outward from the islet's middle through its home; he stands 40 inside it.
  let r = 0;
  while (r < 600 && onT1(S.x + ux * r, S.z + uz * r)) r += 2;
  const h = hero(S.x + ux * (r - 40), S.y, S.z + uz * (r - 40), 0);
  const c = h.critter('crab_islet');
  let t = 0;
  let from = null;
  for (; t < 400 && h.p.health === 8; t++) {
    h.tick({}, 0);
    if (h.p.health < 8) from = { crab: local(c), hero: h.at() };
  }
  assert.equal(h.p.health, 7, 'pinched');
  assert.equal(h.om.critters.hits, 1);
  // Knocked on away from the crab he would have gone over the edge.
  const ax = from.hero.x - from.crab.x;
  const az = from.hero.z - from.crab.z;
  const al = Math.hypot(ax, az);
  assert.ok(!onT1(from.hero.x + (ax / al) * CRITTER.SHARED.KNOCK_FAR, from.hero.z + (az / al) * CRITTER.SHARED.KNOCK_FAR), 'its natural knockback off the edge');
  // (Flying back, never through the crab: it stands no nearer than arm's length to him.)
  const reach = PLAYER_RADIUS + CRITTER_RIG.crab.BUMP_R * c.scale;
  for (t = 0; t < 120 && !(h.p.grounded && h.p.action === 'idle'); t++) {
    h.tick({}, 0);
    if (h.p.action === 'hurt') assert.ok(Math.hypot(c.x - h.p.pos.x, c.z - h.p.pos.z) >= 0.8 * reach, `clear of it in his flight (${t})`);
  }
  assert.ok(h.p.grounded && !h.p.inWater && Math.abs(h.at().y - S.y) < 1, `back on the terrace: ${JSON.stringify(h.at())} (${h.p.action})`);
});
