// STOMPWATT's fight (objects/laneBoss/fight.js, B3), the lane's lazy chunk attached by hand
// (om.attachLane(chunk, area)), with the real Player: its attack sets per phase, each told (30 /
// 26 / 22 ticks) with its orange marker, its target locking 12 ticks before it can hurt, one at
// a time, GAP apart; the fairness rows R1-R8 (standing still the stomp's wave hits him, a jump 1
// .. 10 ticks before it arrives clears it; a sidestep 12 ticks into a dash's tell is never hit;
// a jump at the swipe clears it; walking in behind it and pressing B while it charges hits it
// within 20 ticks; nothing hurts him in the intro, low battery, the walk to the charger, the
// window or going home; nothing new while he is away, perched or blinking; one wedge an attack;
// the knockback lands him safely, sideways off a dash's line); a hit on the cells by each of his
// attacks; a tink outside the window; the zap (a light out, three coins, the next phase faster),
// no hit (it unplugs and runs the set again); the defeat (short-circuit, it folds back, reverses
// into its slot, its collider back, tame for the rest of the game) and its star (once a game,
// counted, no star exit, taken back by a new game); a lost life, an arrival and GAME OVER mid-
// fight; the bins shoved aside and home after; never in a solid through a whole fight; its
// camera; a scripted fight won (tests/helpers/laneBossPolicy.js) and deterministic; never
// 'bossDefeated'; the fight's hot paths allocate nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { PLAYER_RADIUS } from '../src/core/constants.js';
import { attackZone } from '../src/player/actions/attacks.js';
import * as chunk from '../src/objects/laneBoss/index.js';
import { LaneBoss } from '../src/objects/laneBoss/index.js';
import { FIGHT, BOSS } from '../src/objects/laneBoss/tuning.js';
import { FIGHT_METHODS } from '../src/objects/laneBoss/fight.js';
import { Markers, Cable } from '../src/objects/laneBoss/markers.js';
import { LaneBossCam, FIGHT_CAM } from '../src/objects/laneBoss/camera.js';
import { CameraController } from '../src/camera/CameraController.js';
import { policy } from './helpers/laneBossPolicy.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { GROUND, LANE_BOSS } = lane;
const CAR = lane.CARS.find((c) => c.id === LANE_BOSS.car);
const K = lane.CAR_KINDS[CAR.kind];
const N = Math.PI;

// Jonas at a local point with the lane's objects and the chunk attached.
function hero(x = CAR.x, z = 1000, yaw = 0) {
  const events = new Events();
  const log = [];
  for (const name of ['laneBoss', 'bossDefeated', 'starCollected', 'hurt']) events.on(name, (e) => log.push({ name, ...e }));
  const sounds = [];
  events.on('sfx', (e) => sounds.push(e.name));
  const p = new Player({ collision: area.collision, events, spawn: area.respawn, signs: area.signs });
  p.teleport(x + O.x, GROUND + O.y, z + O.z, yaw);
  p.setAction('idle');
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events, layout: area.objectsLayout, player: p, area: 'lane' });
  om.attachLane(chunk, area);
  const ctl = new ScriptedController();
  let frame = 0;
  const h = { p, om, boss: om.laneBoss, log, sounds, events };
  h.tick = (input = {}) => {
    p.update(ctl.next(input), 0);
    om.update({ player: p });
    om.animate(++frame / 30, 1, null);
  };
  h.run = (n, input = {}, each = null) => {
    for (let i = 0; i < n; i++) {
      h.tick(typeof input === 'function' ? input(i) : input);
      if (each?.(i) === false) return i + 1;
    }
    return n;
  };
  h.until = (state, n = 600, input = {}) => {
    for (let i = 0; i < n; i++) {
      if (h.boss.state === state) return i;
      h.tick(typeof input === 'function' ? input(i) : input);
    }
    return h.boss.state === state ? n : -1;
  };
  h.put = (px, pz, py = GROUND, pyaw = 0) => {
    p.teleport(px + O.x, py + O.y, pz + O.z, pyaw);
    p.setAction('idle');
  };
  // (Teleported in world coordinates.)
  h.putW = (px, pz, pyaw = 0) => {
    p.teleport(px, GROUND + O.y, pz, pyaw);
    p.setAction('idle');
  };
  h.hurts = () => log.filter((e) => e.name === 'hurt').length;
  h.phases = () => log.filter((e) => e.name === 'laneBoss').map((e) => e.phase);
  // Up and fighting (the intro run through): its state 'stand' at its spot.
  h.up = () => {
    assert.ok(h.until('stand', 400) >= 0, 'up for the fight');
  };
  return h;
}
// The stick toward a world yaw (camera yaw 0).
const toward = (yaw) => ({ stickX: -Math.sin(yaw), stickY: Math.cos(yaw) });
// The car's collider as it stands (every surface's numbers).
const colliderNow = () => JSON.stringify(area.named.dad_ev.surfaces.map((s) => [s.a, s.b, s.c, s.d, s.minY, s.maxY, s.ys, s.pu]));
const COLLIDER = colliderNow();
// Brings it to its charging window with him well out of the way (its set skipped), then puts
// him `d` behind it facing it.
function toWindow(h, d = 200) {
  h.up();
  h.boss.setIndex = 99;
  for (let i = 0; i < 900 && h.boss.state !== 'open'; i++) {
    h.put(2700, 600, GROUND, 0);
    h.tick();
  }
  assert.equal(h.boss.state, 'open', 'its window');
  const c = h.boss.cur;
  const bx = -Math.sin(c.yaw);
  const bz = -Math.cos(c.yaw);
  h.putW(c.x + bx * d, c.z + bz * d, Math.atan2(-bx, -bz));
  return { bx, bz };
}
// A whole fight with the scripted player (tests/helpers/laneBossPolicy.js); every tick's state.
function scriptedFight(h, ticks = 6000, each = null) {
  const trace = [];
  for (let i = 0; i < ticks; i++) {
    h.tick(policy(h.boss, h.p, 0, i, { FIGHT }));
    trace.push(h.boss.state);
    if (each?.(i) === false) break;
    if (h.log.some((e) => e.name === 'starCollected')) break;
  }
  return trace;
}

test('its attack sets per phase, each told 30 / 26 / 22 ticks with its orange marker and its target locked 12 ticks before it can hurt; one at a time, GAP apart; then its battery runs low', () => {
  for (const phase of [0, 1, 2]) {
    const h = hero();
    h.boss.hits = phase;
    h.up();
    const P = FIGHT.PHASES[phase];
    const tells = [];
    let state = h.boss.state;
    let t0 = 0;
    let lastEnd = -Infinity;
    const gaps = [];
    let ringAtLock = null;
    let ringMoved = false;
    for (let i = 0; i < 1600 && h.boss.state !== 'low'; i++) {
      // (He waits on the street, on the side further from it; for the swipe he steps up close in
      // front of it.)
      const c = h.boss.cur;
      const next = P.set[h.boss.setIndex + (h.boss.state === 'gap' ? 1 : 0)];
      if (next === 'swipe' && (h.boss.state === 'gap' || h.boss.state === 'stand')) h.putW(c.x + Math.sin(c.yaw) * 280, c.z + Math.cos(c.yaw) * 280, c.yaw + N);
      else if (h.boss.state === 'stand' || h.boss.state === 'gap' || h.boss.state === 'walk') {
        const [x, z] = Math.abs(c.x - O.x - 1600) > Math.abs(c.x - O.x - 2500) ? [1600, 350] : [2500, 350];
        if (Math.hypot(h.p.pos.x - O.x - x, h.p.pos.z - O.z - z) > 40) h.put(x, z, GROUND, 0);
      }
      h.p.health = 8;
      h.tick();
      const s = h.boss.state;
      if (s === 'stomp_tell') {
        const ring = h.boss.markers.ring;
        assert.equal(ring.on, true, 'its ring shows');
        assert.ok(ring.size >= FIGHT.STOMP.ring[0] - 1 && ring.size <= FIGHT.STOMP.ring[1] + 1, `its size ${ring.size}`);
        if (h.boss.t === P.tell - FIGHT.LOCK) ringAtLock = [ring.x, ring.z];
        // (Locked: he steps away, the ring stays.)
        if (h.boss.t > P.tell - FIGHT.LOCK) {
          h.p.pos.x += 30;
          if (ring.x !== ringAtLock[0] || ring.z !== ringAtLock[1]) ringMoved = true;
        }
      }
      if (s === 'dash_tell') assert.equal(h.boss.markers.lane.on, true, 'its chevrons show');
      if (s === 'swipe_tell') assert.equal(h.boss.markers.arc.on, true, 'its arc shows');
      if (s !== state) {
        if (state.endsWith('_tell')) tells.push([state, i - t0]);
        if (s.endsWith('_tell')) {
          gaps.push(i - lastEnd);
          t0 = i;
        }
        if (s === 'gap') lastEnd = i;
        state = s;
      }
    }
    assert.equal(h.boss.state, 'low', `phase ${phase + 1}: its battery runs low after its set`);
    assert.deepEqual(tells.map(([s]) => s.replace('_tell', '')), P.set, `phase ${phase + 1}: its set`);
    for (const [s, n] of tells) assert.equal(n, P.tell, `phase ${phase + 1}: ${s} told ${n} ticks`);
    assert.ok(P.tell >= 22 && FIGHT.LOCK >= 10, 'R2');
    for (const g of gaps.slice(1)) assert.ok(g >= FIGHT.GAP, `GAP ${g} between attacks`);
    assert.equal(ringMoved, false, 'the stomp\'s target locked');
    assert.equal(h.log.some((e) => e.name === 'bossDefeated'), false);
  }
});

test('the easier fight (LANE_BOSS.easy, off by default; the pause screen sets it): longer tells and windows, no dash in the second round', () => {
  const h = hero();
  assert.equal(h.boss.easy, LANE_BOSS.easy);
  assert.equal(LANE_BOSS.easy, false);
  h.boss.setEasy(true);
  for (let i = 0; i < 3; i++) {
    h.boss.hits = i;
    const P = h.boss._phase();
    assert.equal(P.tell, FIGHT.PHASES[i].tell + FIGHT.EASY.tell);
    assert.equal(P.window, FIGHT.PHASES[i].window + FIGHT.EASY.window);
  }
  h.boss.hits = 1;
  assert.equal(h.boss._phase().set.includes('dash'), false);
  h.boss.setEasy(false);
  assert.equal(h.boss._phase(), FIGHT.PHASES[1]);
  // (Chosen on the lane's pause screen: main sets LANE_BOSS.easy, the boss follows next tick.)
  try {
    LANE_BOSS.easy = true;
    h.tick();
    assert.equal(h.boss.easy, true, 'it follows LANE_BOSS.easy');
    assert.equal(h.boss._phase().window, FIGHT.PHASES[1].window + FIGHT.EASY.window);
  } finally {
    LANE_BOSS.easy = false;
  }
  h.tick();
  assert.equal(h.boss.easy, false);
});

test('R1/R2: the Wheel Stomp: standing still its wave hits him (one wedge, the stomp\'s foot or wave, never both); a jump 1 .. 10 ticks before the wave reaches him clears it, in phase 1 and phase 3', () => {
  for (const phase of [0, 2]) {
    const out = [];
    for (let k = 0; k <= 11; k++) {
      const h = hero();
      h.boss.hits = phase;
      h.up();
      h.until('stomp_tell', 200);
      h.until('stomp_hop', 200);
      const a = h.boss.atk;
      // (Out of the foot's reach, standing where the wave comes.)
      h.putW(a.dx, a.dz - 330);
      h.until('stomp_land', 40);
      const w = h.boss.markers.wave;
      assert.equal(w.on, true, 'the wave runs');
      const D = Math.hypot(h.p.pos.x - w.x, h.p.pos.z - w.z);
      const arrive = Math.ceil((D - FIGHT.STOMP.band / 2 - PLAYER_RADIUS) / FIGHT.STOMP.wave) - 1;
      const before = h.hurts();
      for (let t = 0; t < 60; t++) {
        const at = arrive - k;
        h.tick({ A: k > 0 && t >= at && (t === at || h.p.vel.y > 0) });
      }
      out.push(h.hurts() - before);
    }
    assert.equal(out[0], 1, `phase ${phase + 1}: standing still the wave hits him`);
    for (let k = 1; k <= 10; k++) assert.equal(out[k], 0, `phase ${phase + 1}: a jump ${k} ticks before it arrives clears it`);
  }
  // Standing on the ring: the foot hits him (once: not the wave too).
  const h = hero();
  h.up();
  h.until('stomp_land', 300);
  h.run(50);
  assert.equal(h.hurts(), 1, 'one wedge a stomp');
  assert.equal(h.p.health, 7);
});

test('R1/R2/R6: the Roll Dash: standing still its body hits him and knocks him sideways off its line; a sidestep 12 ticks into its tell is never hit (phases 2 and 3)', () => {
  for (const phase of [1, 2]) {
    for (const side of [0, 150]) {
      const h = hero();
      h.boss.hits = phase;
      h.up();
      h.boss.setIndex = phase === 1 ? 1 : 0;
      const c = h.boss.cur;
      h.putW(c.x, c.z - 650, 0);
      h.until('dash_tell', 200);
      const before = h.hurts();
      let off = 0;
      let at = null;
      for (let t = 0; t < 120 && (h.boss.state === 'dash_tell' || h.boss.state === 'dash' || t < 12); t++) {
        const a = h.boss.atk;
        off = (h.p.pos.x - h.boss.cur.x) * a.dz - (h.p.pos.z - h.boss.cur.z) * a.dx;
        const go = side > 0 && t >= 12 && Math.abs(off) < side;
        h.tick(go ? toward(Math.atan2(a.dz, -a.dx)) : {});
        if (h.hurts() > before && !at) at = { x: h.p.pos.x, z: h.p.pos.z, a: { ...a }, bx: h.boss.cur.x, bz: h.boss.cur.z };
      }
      if (side === 0) {
        assert.equal(h.hurts() - before, 1, `phase ${phase + 1}: standing on its line it hits him`);
        // (Thrown sideways: off the line, not along it.)
        h.run(20);
        const a = at.a;
        const along = (h.p.pos.x - at.x) * a.dx + (h.p.pos.z - at.z) * a.dz;
        const across = Math.abs((h.p.pos.x - at.x) * a.dz - (h.p.pos.z - at.z) * a.dx);
        assert.ok(across > Math.abs(along), `knocked sideways (${across.toFixed(0)} across, ${along.toFixed(0)} along)`);
      } else assert.equal(h.hurts() - before, 0, `phase ${phase + 1}: a sidestep of ${side} is never hit`);
    }
  }
});

test('R1/R2: the Wheel Swipe (phase 3, him close in front): standing still the fist hits him; a jump as it swings clears it; so does stepping back out of its arc', () => {
  const runSwipe = (input) => {
    const h = hero();
    h.boss.hits = 2;
    h.up();
    h.boss.setIndex = 1;
    const c = h.boss.cur;
    h.putW(c.x + Math.sin(c.yaw) * 280, c.z + Math.cos(c.yaw) * 280, c.yaw + N);
    h.tick();
    assert.equal(h.boss.state, 'swipe_tell');
    const before = h.hurts();
    for (let t = 1; t < 70; t++) h.tick(input(t, h));
    return h.hurts() - before;
  };
  const T = FIGHT.PHASES[2].tell;
  assert.equal(runSwipe(() => ({})), 1, 'standing still');
  for (const j of [0, 3, 6, 10]) assert.equal(runSwipe((t, h) => ({ A: t >= T - j && (t === T - j || h.p.vel.y > 0) })), 0, `a jump ${j} ticks before the swing`);
  assert.equal(runSwipe((t, h) => (t > 4 && t < 26 ? toward(Math.atan2(h.p.pos.x - h.boss.cur.x, h.p.pos.z - h.boss.cur.z)) : {})), 0, 'stepping back out of its arc');
});

test('R3/R4/R7: nothing hurts him through the intro, its battery low, the walk to the charger, kneeling, the window and going home; nothing new while he is away, perched on a bin or blinking; a tell under way when he goes away is called off', () => {
  // Beside it the whole time from the wake to the window's end.
  const h = hero(CAR.x, CAR.z - K.l / 2 - 150, N);
  h.until('stand', 300);
  assert.equal(h.hurts(), 0, 'the intro');
  h.boss.setIndex = 99;
  const quiet = new Set(['low', 'walk', 'kneel', 'plug', 'open']);
  let n = 0;
  for (let i = 0; i < 800 && h.boss.state !== 'unplug'; i++) {
    if (quiet.has(h.boss.state)) n++;
    // (Following it round at arm's length.)
    const c = h.boss.cur;
    h.putW(c.x + 260, c.z - 120, 0);
    h.tick();
  }
  assert.ok(n > 300, `${n} quiet ticks beside it`);
  assert.equal(h.hurts(), 0, 'low battery, the walk, kneeling, the window');
  // Going home after a lost life, beside it all the way.
  h.p.loseLife();
  h.run(5);
  for (let i = 0; i < 400 && h.boss.state !== 'parked'; i++) {
    const c = h.boss.cur;
    if (h.p.action !== 'spawn' && h.p.action !== 'spawn_land') h.putW(c.x + 260, c.z - 120, 0);
    h.tick();
  }
  assert.equal(h.boss.state, 'parked');
  assert.equal(h.hurts(), 0, 'going home');
  // Away (reading a sign) mid-tell: called off, nothing hurts him.
  const g = hero();
  g.up();
  g.until('stomp_tell', 100);
  g.p.action = 'reading';
  for (let i = 0; i < 80; i++) g.om.update({ player: g.p });
  assert.equal(g.boss.markers.ring.on, false, 'called off');
  assert.ok(g.boss.state === 'gap' || g.boss.state === 'watch', g.boss.state);
  assert.equal(g.hurts(), 0);
  // Perched on a bin: it watches him, no attack.
  const b = hero();
  b.up();
  b.put(lane.BINS[0].x, lane.BINS[0].z, lane.BIN.top, N);
  let attacks = 0;
  b.run(250, {}, () => {
    if (b.boss.state.endsWith('_tell')) attacks++;
  });
  assert.equal(attacks, 0, 'no attack while he is up on a bin');
  assert.equal(b.boss.state, 'watch');
  // Blinking after a hit: no new attack until he stops.
  const k = hero();
  k.up();
  k.boss._toGap();
  k.p.invincibleUntil = k.p.tick + 150;
  let early = 0;
  k.run(140, {}, () => {
    if (k.boss.state.endsWith('_tell')) early++;
  });
  assert.equal(early, 0, 'he blinks: it waits');
});

test('a hit on the glowing cells by each of his attacks (punch1, punch2, kick, jump_kick, dive, belly_slide, ground_pound_land) from behind it; walking in behind it and pressing B hits it within 20 ticks; outside the window its body only tinks', () => {
  const kinds = [
    ['punch', { punchStep: 0, actionTimer: 3 }, 180, 0],
    ['punch', { punchStep: 1, actionTimer: 3 }, 180, 0],
    ['punch', { punchStep: 2, actionTimer: 4 }, 180, 0],
    ['jump_kick', { actionTimer: 5 }, 200, 70],
    ['dive', { actionTimer: 3 }, 180, 0],
    ['belly_slide', { actionTimer: 3, forwardVel: 20 }, 180, 0],
    ['ground_pound_land', { actionTimer: 1 }, 200, 0],
  ];
  for (const [action, extra, d, up] of kinds) {
    const h = hero();
    const { bx, bz } = toWindow(h, d);
    h.boss.update(h.p, h.om.tick, false); // (a tick into the window)
    h.boss.t = 5;
    const fake = { action, punchStart: 0, faceYaw: Math.atan2(-bx, -bz), pos: { x: h.p.pos.x, y: h.p.pos.y + up, z: h.p.pos.z }, forwardVel: 0, ...extra };
    const out = { x: 0, y: 0, z: 0, radius: 0, kind: '' };
    const zone = attackZone(fake, out);
    assert.ok(zone, `${action}: an attack zone`);
    const kind = zone.kind;
    h.boss._cellsHit({ getAttack: () => zone });
    assert.equal(h.boss.state, 'zapped', `${kind}: a hit on the cells`);
    assert.equal(h.boss.hits, 1);
  }
  // The real thing: walking in from 300 behind it, then B.
  const h = hero();
  const { bx, bz } = toWindow(h, 300);
  const face = Math.atan2(-bx, -bz);
  let t = 0;
  for (; t < 60 && h.boss.state === 'open'; t++) {
    const d = Math.hypot(h.p.pos.x - h.boss.cur.x, h.p.pos.z - h.boss.cur.z);
    h.tick(d > 205 ? toward(face) : { B: t % 2 === 0 });
  }
  assert.equal(h.boss.state, 'zapped', `walked in and punched (${t} ticks)`);
  assert.ok(t <= 20, `within 20 ticks (${t})`);
  // Outside the window: a tink, no hit.
  const g = hero();
  g.up();
  g.boss._set('dizzy');
  const c = g.boss.cur;
  g.putW(c.x + Math.sin(c.yaw) * 180, c.z + Math.cos(c.yaw) * 180, c.yaw + N);
  g.run(12, (i) => ({ B: i % 2 === 0 }));
  assert.ok(g.sounds.includes('robot_tink'), 'a metal tink');
  assert.equal(g.boss.hits, 0, 'no hit');
});

test('the zap: a power light out, three coins in a fan behind it, dizzy, then the next phase (shorter tells, a faster walk); no hit in the window: it unplugs and runs the same set again', () => {
  const h = hero();
  toWindow(h, 200);
  // (Dropped: still there, or taken by him at once.)
  const drops = () => h.om.coins.drops.filter((c) => c.alive).length + h.p.coins;
  const coins0 = drops();
  h.run(12, (i) => ({ B: i % 2 === 0 }));
  assert.equal(h.boss.state, 'zapped');
  assert.equal(h.boss.hits, 1);
  assert.equal(h.boss.cur.lights, 2, 'a light out');
  assert.equal(drops() - coins0, FIGHT.COINS, 'three coins');
  assert.ok(h.sounds.includes('robot_zap'));
  assert.deepEqual(h.phases().slice(-1), ['hit']);
  h.until('dizzy', 40);
  h.put(2700, 600, GROUND, 0);
  h.until('stand', 100);
  assert.equal(h.boss._phase(), FIGHT.PHASES[1], 'the next phase');
  assert.ok(FIGHT.PHASES[1].tell < FIGHT.PHASES[0].tell && FIGHT.PHASES[1].walk > FIGHT.PHASES[0].walk && FIGHT.PHASES[1].window < FIGHT.PHASES[0].window);
  assert.equal(h.boss.setIndex, 0);
  // No hit: the window runs out.
  const g = hero();
  toWindow(g, 600);
  const n = g.until('unplug', 400, () => ({}));
  assert.ok(Math.abs(n - (FIGHT.OPEN + FIGHT.PHASES[0].window)) <= 3, `the window ${n} ticks`);
  g.until('stand', 60);
  assert.equal(g.boss.hits, 0);
  assert.equal(g.boss.setIndex, 0, 'the same set again');
  assert.equal(g.boss.plugged, false, 'unplugged');
});

test('the third hit: it short-circuits, walks off to the front of its slot, folds back into the car and reverses in (its collider back: he stands on its roof); its star rises in front of the car once a game, counted with no star exit; tame afterwards; a new game takes the star back and brings it back fresh', () => {
  const h = hero();
  toWindow(h, 200);
  h.boss.hits = 2;
  h.boss.cur.lights = 1;
  h.run(12, (i) => ({ B: i % 2 === 0 }));
  assert.equal(h.boss.hits, 3);
  h.put(2700, 400, GROUND, 0);
  h.until('shortout', 40);
  assert.equal(h.boss.beaten, true);
  assert.ok(h.sounds.includes('robot_power_down') && h.sounds.includes('boss_win'));
  assert.deepEqual(h.phases().slice(-2), ['hit', 'beaten']);
  const order = [];
  h.run(900, {}, () => {
    if (order.at(-1) !== h.boss.state) order.push(h.boss.state);
    return h.boss.state !== 'tame';
  });
  assert.deepEqual(order, ['shortout', 'walk', 'unmorph', 'reverse', 'settle', 'tame']);
  assert.ok(h.sounds.includes('ev_reverse'), 'reversing beeps');
  assert.equal(colliderNow(), COLLIDER, 'its collider back exactly');
  // Its star: rising in front of the car to (1900, 342, 1000).
  h.run(80);
  const star = h.boss.star.star;
  assert.equal(star.active, true);
  assert.ok(Math.abs(star.pos.x - O.x - LANE_BOSS.star.x) < 1 && Math.abs(star.pos.y - O.y - LANE_BOSS.star.y) < 1 && Math.abs(star.pos.z - O.z - LANE_BOSS.star.z) < 1, 'hovering in front of the car');
  // A small jump under it takes it: counted, boss: true (no star exit).
  h.put(LANE_BOSS.star.x, LANE_BOSS.star.z, GROUND, 0);
  h.run(30, (i) => ({ A: i < 8 }));
  const got = h.log.filter((e) => e.name === 'starCollected');
  assert.equal(got.length, 1);
  assert.equal(got[0].boss, true);
  assert.equal(h.p.stars, 1);
  // Tame: it never wakes again this game (it blinks hello).
  h.put(CAR.x, CAR.z - K.l / 2 - 150, N);
  h.run(300);
  assert.equal(h.boss.state, 'tame');
  assert.equal(colliderNow(), COLLIDER);
  // He stands on its roof.
  h.put(CAR.x, CAR.z, GROUND + K.roof + 40, N);
  h.run(10);
  assert.ok(Math.abs(h.p.pos.y - O.y - GROUND - K.roof) < 1, `on its roof (${(h.p.pos.y - O.y).toFixed(0)})`);
  // An arrival: still tame; a new game: fresh, the star taken back.
  h.om.enter(h.p);
  assert.equal(h.boss.state, 'tame');
  h.om.reset();
  assert.equal(h.boss.state, 'parked');
  assert.equal(h.boss.hits, 0);
  assert.equal(h.boss.beaten, false);
  assert.equal(h.boss.cur.lights, 3);
  assert.equal(h.boss.star.star.active, false);
  assert.equal(h.p.stars, 0, 'taken back off his count');
  assert.equal(h.log.some((e) => e.name === 'bossDefeated'), false, 'never bossDefeated');
});

test('a lost life mid-fight: it goes home with its hits kept (its collider back, the bins home) and the next wake goes on at its phase; an arrival mid-fight parks it at once; GAME OVER mid-fight resets it', () => {
  const h = hero();
  toWindow(h, 200);
  h.run(12, (i) => ({ B: i % 2 === 0 }));
  assert.equal(h.boss.hits, 1);
  h.put(2700, 600, GROUND, 0);
  h.until('stand', 200);
  h.p.loseLife();
  assert.ok(h.until('parked', 800) >= 0, 'home and parked');
  assert.equal(colliderNow(), COLLIDER);
  assert.equal(h.boss.hits, 1, 'its hits kept');
  assert.equal(h.boss.cur.lights, 2);
  assert.ok(h.om.bins.list.every((b) => b.x === b.home.x && b.z === b.home.z), 'the bins home');
  // Back near it: a quick wake, the fight at phase 2.
  h.put(CAR.x, 1000, GROUND, 0);
  h.until('stand', 200);
  assert.equal(h.boss._phase(), FIGHT.PHASES[1]);
  // An arrival mid-fight: parked at once, nothing left out (marker, cable, wave).
  h.until('stomp_tell', 200);
  h.om.enter(h.p);
  assert.equal(h.boss.state, 'parked');
  assert.equal(h.boss.markers.ring.on || h.boss.markers.wave.on || h.boss.plugged, false);
  assert.equal(colliderNow(), COLLIDER);
  // GAME OVER mid-window: fresh.
  const g = hero();
  toWindow(g, 600);
  g.om.reset();
  assert.equal(g.boss.state, 'parked');
  assert.equal(g.boss.plugged, false);
  assert.equal(g.boss.cables.every((c) => c.visible), true, 'the charger\'s own cable back');
  assert.equal(colliderNow(), COLLIDER);
});

test('a bin in its way is shoved aside with a clatter (never into him) and goes home after', () => {
  const h = hero();
  h.up();
  // A bin pulled out onto the drive where it walks to its charger.
  const bins = h.om.bins;
  const b = bins.list[0];
  bins._moveTo(b, LANE_BOSS.charge.x + O.x + 40, LANE_BOSS.charge.z + O.z - 60);
  h.boss.setIndex = 99;
  for (let i = 0; i < 600 && h.boss.state !== 'open'; i++) {
    h.put(2700, 600, GROUND, 0);
    h.tick();
  }
  assert.equal(h.boss.state, 'open', 'it got to its charger');
  assert.ok(h.sounds.includes('bin_clatter'), 'a clatter');
  const c = h.boss.cur;
  assert.ok(Math.hypot(b.x - c.x, b.z - c.z) > FIGHT.FEET, 'the bin out of its way');
  assert.equal(h.boss.shoved, true);
  // Going home: the bins home.
  h.p.loseLife();
  h.until('parked', 800);
  assert.ok(b.x === b.home.x && b.z === b.home.z, 'home');
});

test('a scripted fight (jumping waves, sidestepping dashes, backing off swipes, punching the cells) wins in three rounds losing at most 3 wedges; never in a solid: its feet 20 clear of every wall and its middle on its walking ground all the way; deterministic', () => {
  const runOne = () => {
    const h = hero();
    const boxes = LANE_BOSS.walk;
    let solid = 0;
    let outside = 0;
    const col = area.collision;
    const trace = scriptedFight(h, 6000, () => {
      const c = h.boss.cur;
      if (h.boss.cur.m === 1 && h.boss.state !== 'stomp_hop') {
        if (col.findWalls(c.x, c.y + 40, c.z, 0, FIGHT.FEET - 20).walls.length || col.findWalls(c.x, c.y + 200, c.z, 0, FIGHT.FEET - 20).walls.length) solid++;
        const x = c.x - O.x;
        const z = c.z - O.z;
        if (!boxes.some(([x0, x1, z0, z1]) => x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1)) outside++;
      }
    });
    return { h, trace, solid, outside };
  };
  const a = runOne();
  const { h } = a;
  assert.equal(h.boss.hits, 3, 'three hits');
  assert.equal(h.boss.state, 'tame');
  assert.equal(h.p.stars, 1, 'the star');
  assert.ok(h.hurts() <= 3, `${h.hurts()} wedges lost`);
  assert.equal(a.solid, 0, 'never in a wall');
  assert.equal(a.outside, 0, 'always on its walking ground');
  assert.deepEqual(h.phases(), ['wake', 'fight', 'charging', 'hit', 'charging', 'hit', 'charging', 'hit', 'beaten', 'parked']);
  const ticks = a.trace.length;
  assert.ok(ticks > 1500 && ticks < 5400, `a fight of ${(ticks / 30).toFixed(0)} s`);
  const b = runOne();
  assert.deepEqual(b.trace, a.trace, 'deterministic');
  assert.equal(h.log.some((e) => e.name === 'bossDefeated'), false);
});

test('its camera in the fight: the framing eases in near him (the look point raised, the camera back, kept out of walls by a ray), off when it is far; in the window the orbit turns to look past him at its back; a cut drops it', () => {
  const lc = new LaneBossCam(area.collision);
  const hero0 = { x: 2000 + O.x, y: GROUND + O.y, z: 400 + O.z };
  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55, yaw: 0, tween: null };
  const frame = () => {
    cam.target.set(hero0.x, hero0.y + 120, hero0.z);
    cam.pos.set(hero0.x, hero0.y + 300, hero0.z - 800);
    lc.update(cam, hero0);
  };
  lc.fight(true, 2000 + O.x, 1000 + O.z, 1);
  for (let i = 0; i < 120; i++) frame();
  assert.ok(Math.abs(lc.fw - FIGHT_CAM.W) < 0.01, `weight ${lc.fw}`);
  assert.ok(cam.target.y > hero0.y + 120 + FIGHT_CAM.RAISE * 0.5, 'the look point raised');
  assert.ok(cam.pos.distanceTo(cam.target) > 830, 'the camera back');
  lc.fight(true, 2000 + O.x, 2400 + O.z, 1);
  for (let i = 0; i < 200; i++) frame();
  assert.ok(lc.fw < 0.01, 'far: off');
  // The window: the orbit's yaw turns (a little a tick) to look from behind him at the robot.
  lc.fight(true, 2000 + O.x, 1000 + O.z, 2);
  cam.yaw = 1.2;
  const want = Math.atan2(hero0.x - (2000 + O.x), hero0.z - (1000 + O.z));
  for (let i = 0; i < 80; i++) frame();
  assert.ok(Math.abs(Math.atan2(Math.sin(cam.yaw - want), Math.cos(cam.yaw - want))) < 0.05, `turned to ${cam.yaw.toFixed(2)} (${want.toFixed(2)})`);
  // The C buttons win: a tween under way, no turn.
  cam.tween = { delta: 1, t: 0 };
  cam.yaw = 0.5;
  frame();
  assert.equal(cam.yaw, 0.5);
  lc.reset();
  assert.equal(lc.fw, 0);
});

// Whether a world point lies inside a solid: two or more of the six axis rays from it hit a face
// from behind (as tests/lane.test.js).
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => ({ x, y, z }));
function insideSolid(p) {
  let back = 0;
  for (const d of AXES) {
    const hit = area.collision.raycast(p, d, 9000);
    if (hit && hit.normal.x * d.x + hit.normal.y * d.y + hit.normal.z * d.z > 0) back++;
  }
  return back >= 2;
}

for (const [label, prof] of [['', null], [' (the realistic look\'s camera)', lane.LANE_REAL.camera]]) {
  test('the follow camera through a whole scripted fight (its overlay on, as main sets it): never in a solid, never trapped more than 30 ticks running, the robot mostly in front of it' + label, () => {
    const h = hero();
    const cam = new CameraController({ collision: area.collision, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events: h.events });
    cam.setProfile(prof);
    cam.reset(h.p);
    const ctl = new ScriptedController();
    let run = 0;
    let worst = 0;
    let solid = 0;
    let ahead = 0;
    let up = 0;
    for (let i = 0; i < 6000 && !h.log.some((e) => e.name === 'starCollected'); i++) {
      const c = ctl.next(policy(h.boss, h.p, cam.getYaw(), i, { FIGHT }));
      h.p.update(cam.playerInput(c), cam.getYaw());
      h.om.update({ player: h.p, camera: cam });
      cam.overlay = h.om.cameraOverlay;
      cam.update(c, h.p);
      run = cam.collider.trapped ? run + 1 : 0;
      worst = Math.max(worst, run);
      if (i % 15 === 0 && insideSolid(cam.pos)) solid++;
      if (h.boss.state === 'stand' || h.boss.state.endsWith('_tell') || h.boss.state === 'open') {
        up++;
        // (The robot in front of the camera: within 70 degrees of its look.)
        const yaw = cam.getYaw();
        const dx = h.boss.cur.x - cam.pos.x;
        const dz = h.boss.cur.z - cam.pos.z;
        if ((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / Math.hypot(dx, dz) > Math.cos(1.2)) ahead++;
      }
    }
    assert.equal(h.boss.hits, 3, 'won');
    assert.equal(solid, 0, 'never in a solid');
    assert.ok(worst <= 30, `trapped ${worst} ticks running`);
    assert.ok(ahead > up * 0.75, `the robot in front of the camera ${ahead} of ${up} ticks`);
  });
}

test('its overlays: the markers (ring, chevrons, arc, wave) in one draw while any shows, the cable from the charger to its chest while plugged in (the charger\'s own hidden); both looks alike', () => {
  const m = new Markers(() => 0);
  m.animate(0, 0);
  assert.equal(m.mesh.visible, false);
  Object.assign(m.ring, { on: true, x: 0, z: 0, size: 200, px: 0, pz: 0, psize: 200 });
  Object.assign(m.lane, { on: true, x: 0, z: 0, dx: 0, dz: 1, len: 900, w: 220 });
  Object.assign(m.arc, { on: true, x: 0, z: 0, yaw: 0, r: 380, half: 1.05 });
  Object.assign(m.wave, { on: true, x: 0, z: 0, r: 300, pr: 288, max: 600, h: 50 });
  m.animate(0.5, 1);
  assert.equal(m.mesh.visible, true);
  const n = m.mesh.geometry.drawRange.count;
  assert.ok(n > 0 && n % 3 === 0);
  const pos = m.mesh.geometry.attributes.position.array;
  for (let i = 0; i < n * 3; i++) assert.ok(Number.isFinite(pos[i]));
  m.clear();
  m.animate(0, 0);
  assert.equal(m.mesh.visible, false);
  const cable = new Cable();
  cable.set(true, { x: 0, y: 150, z: 0 }, { x: 300, y: 400, z: 100 }, { x: 10, y: 200, z: 0 });
  assert.equal(cable.mesh.visible, true);
  assert.ok(cable.mesh.geometry.drawRange.count > 0);
  // In the game: plugged in, the charger's own cable (each look's mover) hidden.
  const h = hero();
  toWindow(h, 600);
  h.run(15);
  h.boss.animate(1, 1, null);
  assert.equal(h.boss.cable.mesh.visible, true);
  assert.ok(h.boss.cables.length >= 1 && h.boss.cables.every((c) => !c.visible));
  assert.ok(h.boss.cur.hatch > 0.5, 'the hatch open');
  h.boss.enter();
  assert.ok(h.boss.cables.every((c) => c.visible));
});

test('hot paths avoid allocating constructs (the fight\'s too)', () => {
  const names = ['_ground', '_inside', '_fightRead', '_fightStep', '_stand', '_resolve', '_walkState', '_walkVia', '_at', '_stalled', '_walk', '_move', '_shoveBins', '_watch', '_tell', '_lane', '_arc', '_calledOff', '_toGap', '_gap', '_stompTell', '_hopTarget', '_stompHop', '_slam', '_waveTick', '_dashTell', '_dash', '_shoveSide', '_dashHit', '_dashEnd', '_swipeTell', '_swipe', '_sparksAt', '_hurtFrom', '_hurt', '_safe', '_low', '_open', '_cells', '_cellsHit', '_tink', '_zapped', '_dizzy', '_unplug', '_shortout', '_reverse', '_tame', '_fightFrame', '_fightAnimate'];
  for (const name of names) {
    const src = FIGHT_METHODS[name].toString();
    assert.equal(LaneBoss.prototype[name], FIGHT_METHODS[name], `${name} mixed in`);
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /new [A-Z]|\[\.\.\.|=>/, `${name}: no allocation`);
  }
  for (const name of ['animate', 'tick']) {
    const src = Markers.prototype[name].toString();
    assert.doesNotMatch(src, /new [A-Z]|\[\.\.\.|=>/, `Markers.${name}`);
  }
  assert.doesNotMatch(Cable.prototype.set.toString(), /new [A-Z]|\[\.\.\.|=>/, 'Cable.set');
  assert.doesNotMatch(LaneBossCam.prototype._fight.toString(), /new [A-Z]|\[\.\.\.|=>/, 'LaneBossCam._fight');
});

test('B4: its eyes\' moods (angry in a tell, tired with its battery low, spinning when dizzy, the car\'s lights again parked), rocking as it rises, its short circuit\'s big sparks off its joints', () => {
  const h = hero();
  // Rocking on its wheels as it rises (and level again once it parts).
  let rock = 0;
  for (let i = 0; i < 80 && h.boss.cur.m === 0; i++) {
    h.tick();
    rock = Math.max(rock, Math.abs(h.boss.cur.rock));
  }
  assert.ok(rock > 0.01 && rock <= BOSS.ROCK, `it rocks (${rock.toFixed(3)})`);
  assert.equal(h.boss.cur.rock, 0, 'level as it parts');
  h.up();
  // Angry in a stomp's tell: narrowed, its inner ends down.
  assert.ok(h.until('stomp_tell', 400) >= 0);
  h.run(12);
  const c = h.boss.cur;
  assert.ok(c.rollL > 0.25 && c.rollR > 0.25 && c.eyeLen === 1, `angry: turned ${c.rollL.toFixed(2)}`);
  assert.ok(c.blinkL === 1 || Math.abs(c.blinkL - BOSS.MOOD.angry[0]) < 1e-9, `narrowed (${c.blinkL})`);
  // Tired with its battery low: drooping.
  h.boss.setIndex = 99;
  for (let i = 0; i < 600 && h.boss.state !== 'low'; i++) h.tick();
  h.run(10);
  assert.ok(h.boss.cur.rollL < -0.15, `tired: drooping (${h.boss.cur.rollL.toFixed(2)})`);
  // Dizzy after a hit: short and spinning, opposite ways.
  for (let i = 0; i < 900 && h.boss.state !== 'open'; i++) {
    h.put(2700, 600, GROUND, 0);
    h.tick();
  }
  h.boss._zap();
  h.run(2);
  const r0 = [h.boss.cur.rollL, h.boss.cur.rollR];
  h.run(1);
  assert.equal(h.boss.state, 'zapped');
  assert.equal(h.boss.cur.eyeLen, BOSS.MOOD.dizzy[0], 'short');
  assert.ok(Math.abs(h.boss.cur.rollL - r0[0]) > 0.3 && Math.abs(h.boss.cur.rollR - r0[1]) > 0.3, 'spinning');
  // The short circuit: big sparks (2.2 times a burst's) off its joints, a crackle.
  h.boss.hits = 2;
  for (let i = 0; i < 900 && h.boss.state !== 'open'; i++) {
    h.put(2700, 600, GROUND, 0);
    h.tick();
  }
  h.boss._zap();
  assert.ok(h.until('shortout', 60) >= 0);
  const sp = h.om.sparkles;
  h.run(9);
  const big = sp.parts.slice(0, sp.count).filter((q) => q.cell === 0 && q.size0 > 38 * 2).length;
  assert.ok(big >= 12, `big sparks (${big})`);
  assert.ok(h.sounds.filter((s) => s === 'robot_zap').length >= 2, 'it crackles');
  // Parked again: the car's own lights, level.
  assert.ok(h.until('tame', 2000) >= 0, 'tame');
  assert.deepEqual([h.boss.cur.rollL, h.boss.cur.rollR, h.boss.cur.eyeLen, h.boss.cur.rock], [0, 0, 1, 0]);
});
